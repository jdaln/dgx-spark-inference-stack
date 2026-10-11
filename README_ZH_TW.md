# DGX Spark Inference Stack

🌍 **用其他語言閱讀**:
[Deutsch](README_DE.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Italiano](README_IT.md) | [日本語](README_JA.md) | [简体中文](README_ZH_CN.md) | [繁體中文](README_ZH_TW.md) | [Русский](README_RU.md) | [Українська](README_UK.md) | [Português](README_PT.md) | [한국어](README_KO.md) | [العربية](README_AR.md) | [Tiếng Việt](README_VI.md) | [Türkçe](README_TR.md)

> 本檔案由 AI 從 [README.md](README.md) 翻譯而來。如有出入，以英文版為準。

在一台 NVIDIA DGX Spark 上透過 OpenAI 相容 API 提供 LLM 服務。模型在收到第一個請求時啟動，
獨佔 GPU，閒置 20 分鐘後停止。可以在旁邊常駐一個小型輔助模型，用於工作階段標題等輕量任務。

這是針對單台 DGX Spark 的個人專案。雙節點設定未經測試。

## 運作方式

連接埠 `8009` 上的 nginx 閘道接收所有請求。請求驗證器檢查 API 金鑰，正規化請求本文，並請
waker 服務啟動所請求的模型。waker 啟動模型容器並等待其健康。如果另一個主模型正佔用 GPU，
用戶端會收到 HTTP 429，回應標頭說明是哪個模型佔用以及何時釋放。詳見
[docs/architecture.md](docs/architecture.md)。

## 環境需求

- NVIDIA DGX Spark (GB10)。已在 DGX OS 7 (Ubuntu 24.04) 上測試。
- 帶 Compose v2.20 或更新版本的 Docker，以及 NVIDIA Container Toolkit。
- `tools/` 中的指令稿需要 `jq`、`curl` 和 Node.js 20 或更新版本。
- 用於基礎映像的 NVIDIA NGC 帳號。在 [NGC 目錄](https://catalog.ngc.nvidia.com/) 註冊，
  然後執行 `docker login nvcr.io`。受制裁國家無法使用 NGC。
- `./models` 下存放權重的磁碟空間：每個模型約 2 GB 到 80 GB。
- 僅 `qwen3.8-flash-next-nvfp4` 需要：主機啟用 io_uring
  （`cat /proc/sys/kernel/io_uring_disabled` 輸出 `0`）。該模型的容器使用允許 io_uring 的
  seccomp 設定檔。請保持核心更新：io_uring 是核心漏洞的常見來源。見
  [docs/security.md](docs/security.md#seccomp)。

## 安裝

### 1. 複製儲存庫並建立執行目錄

```bash
git clone <repository-url>
cd dgx-spark-inference-stack
mkdir -p models manual_download/openai_gpt-oss-encodings_fix
```

### 2. 下載 GPT-OSS 斷詞器檔案

GPT-OSS 映像建置會把它們複製進去，缺少時建置失敗。

```bash
wget https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken \
  -O manual_download/openai_gpt-oss-encodings_fix/cl100k_base.tiktoken
wget https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken \
  -O manual_download/openai_gpt-oss-encodings_fix/o200k_base.tiktoken
```

### 3. 建置一個執行映像

模型執行在三個映像上。只有本機已建置對應映像的模型才能啟動。GPT-OSS 映像只需一條指令，
約 20 分鐘：

```bash
docker build -t vllm-node-mxfp4 -f custom-docker-containers/vllm-node-mxfp4/Dockerfile .
```

預設模型 `qwen3.8-27b-nvfp4-dflash2` 和輔助模型需要 `vllm-node-dflash2`；Gemma 模型和
`qwen3.8-flash-next-nvfp4` 需要 `vllm-node-b12x`。兩者的建置見
[docs/runtime-baseline.md](docs/runtime-baseline.md)。

### 4. 下載權重

模型容器無法存取網際網路。請在模型的第一個請求之前下載它的權重。`--list` 列出每個模型、其
權重是否存在以及映像是否已建置。存取受限的儲存庫需設定 `HF_TOKEN`。

```bash
bash tools/download-weights.sh --list
bash tools/download-weights.sh gpt-oss-20b
```

### 5. 啟動整套服務

```bash
# Gateway, validator and waker. Models stay down until requested.
docker compose up -d

# Create the containers of the models you built and downloaded, without starting them.
docker compose --profile models up --no-start --no-build vllm-oss20b
```

服務名稱就是 [models.json](models.json) 中的 `container` 值。三個映像都建置好後，去掉服務
名稱即可建立所有模型容器。

## 第一個請求

閘道只監聽 `127.0.0.1:8009`。遠端存取請透過 SSH 轉送連接埠：見
[docs/security.md](docs/security.md#remote-access)。

```bash
curl -X POST http://localhost:8009/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" \
  -d '{"model": "gpt-oss-20b", "messages": [{"role": "user", "content": "Hello!"}]}'
```

第一個請求會啟動模型，可能需要幾分鐘。把連接埠轉送給其他機器之前，請在儲存庫根目錄的
`.env` 檔案中設定你自己的 `VLLM_API_KEY`，然後重新執行第 5 步的兩條指令。

透過閘道檢查模型的對話、串流輸出和工具呼叫：

```bash
bash tools/test-lane.sh gpt-oss-20b
```

## 模型

| 模型 | 角色 | 上下文 | 映像 |
|---|---|---:|---|
| `qwen3.8-27b-nvfp4-dflash2` | 預設，開啟思考 | 262144 | `vllm-node-dflash2` |
| `qwen3.8-flash-next-nvfp4` | 最難的問題，獨佔 GPU | 262144 | `vllm-node-b12x` |
| `gemma4-26b-a4b` | 多語言對話，影像 | 262144 | `vllm-node-b12x` |
| `gpt-oss-20b` | 快速，較小 | 131072 | `vllm-node-mxfp4` |
| `lfm2.5-1.2b` | 輔助模型，常駐 | 32768 | `vllm-node-dflash2` |

[docs/models.md](docs/models.md) 列出全部 10 個模型及其限制。

## 文件

- [架構](docs/architecture.md)：元件、請求流程、端點、生命週期。
- [設定](docs/configuration.md)：環境變數和 `models.json` 欄位。
- [模型](docs/models.md)：目錄和各模型的限制。
- [執行基線](docs/runtime-baseline.md)：三個映像及其建置方法。
- [整合](docs/integrations.md)：Cline、OpenCode 和 pi。
- [安全](docs/security.md)：容器強化、seccomp、SSH 遠端存取。
- [疑難排解](docs/troubleshooting.md)：常見故障及處理方法。
- [進階用法](docs/advanced.md)：新增模型、排程策略、keep-alive。
- [錯誤約定](docs/error-contract.md)：錯誤格式和錯誤碼。
- [與 ComfyUI 共存](docs/comfyui-coexistence.md)：與 ComfyUI 共用 GPU。
- [工具](tools/README.md)：驗證、smoke、soak 和基準測試指令稿。

## 參與貢獻

歡迎提交 pull request。請填寫 pull request 範本。貢獻以
AGPL-3.0-or-later 接受。

Renovate 每月更新 Docker 基礎映像摘要和 GitHub Actions 固定版本。想提前取得某個更新，請在
Renovate Dependency Dashboard issue 中核准它。

## 致謝

- **Christopher Owen**：GPT-OSS 映像所基於的 vLLM MXFP4 分支。
- **eugr**：[`eugr/spark-vllm-docker`](https://github.com/eugr/spark-vllm-docker)，用於建置
  DFlash2 和 B12X 映像。
- **[local-inference-lab](https://github.com/local-inference-lab)**：B12X 映像所基於的、帶 GB10 核心的 vLLM 和 FlashInfer
  分支，以及 `qwen3.8-flash-next-nvfp4` 檢查點。
- **[z-lab](https://huggingface.co/z-lab)**：Qwen3.8 27B 和 Gemma 4 模型使用的 DFlash 草稿模型。

## 授權

AGPL-3.0-or-later。見 [LICENSE](LICENSE)。允許商業使用。如果你散布修改後的版本，或將其作為
網路服務執行，必須以同一授權提供其原始碼。

依據 AGPL 第 7(b) 條的附加條款：所有副本和修改版本都必須保留 [NOTICE](NOTICE) 中的署名聲明。

如果你 fork 或修改本專案，請在 GitHub 上公開你的修改，並透過
[fork 與修改公告](https://github.com/jdaln/dgx-spark-inference-stack/issues/new?template=fork-announcement.yml)告知。無論是否商用，本專案都請所有人這樣做。
程式設計代理必須這樣做：見 [AGENTS.md](AGENTS.md)。

以下檔案保留各自的授權（[LICENSES/](LICENSES/)）：

- `custom-docker-containers/vllm-node-mxfp4/Dockerfile`,
  `custom-docker-containers/vllm-node-b12x/b12x-build.patch`,
  `custom-docker-containers/vllm-node-dflash2/vendor-tiktoken.patch`: MIT
  (eugr/spark-vllm-docker).
- `custom-docker-containers/vllm-node-mxfp4/fastsafetensors_mxfp4.patch`,
  `shared/tool_chat_template_gemma4.jinja`: Apache-2.0 (vLLM).
- `custom-docker-containers/vllm-node-b12x/seccomp-io-uring.json`: Apache-2.0 (moby/profiles).
- `shared/gemma4-*-nvfp4-config/`: NVIDIA 對這些檢查點的模型授權。

2026-10-11 之前發布的版本以 Apache-2.0 發布，並繼續在該授權下可用。
