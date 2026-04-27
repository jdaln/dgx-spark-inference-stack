# DGX Spark Inference Stack - 讓它真正為家庭服務！

🌍 **閱讀其他語言版本**：
[Deutsch](README_DE.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Italiano](README_IT.md) | [日本語](README_JA.md) | [简体中文](README_ZH_CN.md) | [繁體中文](README_ZH_TW.md) | [Русский](README_RU.md) | [Українська](README_UK.md) | [Português](README_PT.md) | [한국어](README_KO.md) | [العربية](README_AR.md) | [Tiếng Việt](README_VI.md) | [Türkçe](README_TR.md)

> **AI 翻譯提示：** 本檔案依據 [README.md](README.md) 由 AI 翻譯，可能包含錯誤，也可能落後於英文原版。如有疑問，請以英文 README 為準。

你的 Nvidia DGX Spark 不應該只是另一個被擱置的副專案。把它真正用起來。這是一個以 Docker 為基礎的推論堆疊，使用 NVIDIA vLLM 與智慧型資源管理來提供大型語言模型（LLM）服務。這個堆疊提供按需載入模型、閒置時自動關閉、帶有可選工具輔助模型的單一主模型排程通道，以及統一的 API 閘道。

這個專案的目標是為家庭環境提供一套推論伺服器。在測試了一個月並加入新模型之後，我決定把它釋出給社群。請理解這是一個興趣專案，因此任何能實際改善它的協助都非常歡迎。它建立在我從網路和 NVIDIA 論壇找到的資訊之上。我真心希望它能幫助 homelab 社群往前推進。目前的重點是一台 DGX Spark，並且預設必須能在這種環境中正常運作，但也歡迎加入雙機支援。

## 文件

- **[架構與運作方式](docs/architecture.md)** - 了解整個堆疊、waker 服務與請求流程。
- **[設定](docs/configuration.md)** - 環境變數、網路設定與 waker 調校。
- **[模型選擇指南](docs/models.md)** - 29+ 個支援模型的詳細清單、快速選擇器與使用情境。
- **[整合](docs/integrations.md)** - 針對 **Cline**（VS Code）與 **OpenCode**（終端代理）的指南。
- **[安全性與遠端存取](docs/security.md)** - SSH 強化與受限連接埠轉送設定。
- **[疑難排解與監控](docs/troubleshooting.md)** - 偵錯、日誌與常見錯誤的解法。
- **[進階用法](docs/advanced.md)** - 新增模型、自訂設定與持續運行。
- **[執行環境基線](docs/runtime-baseline.md)** - 儲存庫目前預期的本地映像軌道與重建方法。
- **[工具與驗證工具鏈](tools/README.md)** - 支援的 smoke、soak、檢查與手動 probe 腳本。
- **[TODO 筆記](TODO.md)** - 我接下來想做的事。

## 快速開始

1. **複製儲存庫**
   ```bash
   git clone <repository-url>
   cd dgx-spark-inference-stack
   ```

2. **建立必要目錄**
   ```bash
   mkdir -p models vllm_cache_huggingface manual_download/openai_gpt-oss-encodings_fix
   ```

3. **下載必要的 tokenizer（關鍵）**
   這個堆疊要求你手動下載 GPT-OSS 模型所需的 `tiktoken` 檔案。
   ```bash
   wget https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/cl100k_base.tiktoken
   wget https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/o200k_base.tiktoken
   ```

4. **建置自訂 Docker 映像（必要）**
   這個堆疊使用自訂最佳化的 vLLM 映像，應在本地建置以確保最佳效能。
   *   **時間：** 每個映像約需 20 分鐘。
   *   **驗證：** 你必須登入 NVIDIA NGC 才能拉取基礎映像。
       1.  在 [NVIDIA NGC Catalog](https://catalog.ngc.nvidia.com/) 建立開發者帳號（不得位於受制裁國家）。
       2.  使用你的憑證執行 `docker login nvcr.io`。
   *   **建置指令：**
       ```bash
       # Build Avarok image (General Purpose) - MUST use this tag to use local version over upstream
       docker build -t avarok/vllm-dgx-spark:v11 custom-docker-containers/avarok

      # Build the repo MXFP4 track used by GPT-OSS.
      # This bakes the manually downloaded tiktoken files into the image.
      docker build -t vllm-node-mxfp4 -f custom-docker-containers/vllm-node-mxfp4/Dockerfile .

      # Build the refreshed TF5 track used by GLM 4.7.
      docker build -t local/vllm-node-tf5:cu131 -f custom-docker-containers/vllm-node-tf5/Dockerfile .

      # Build the upstream-style TF5 track used by Gemma 4 and newer TF5 recipe imports.
      # The active Gemma compose services expect this exact local image tag.
      git clone https://github.com/eugr/spark-vllm-docker tmp/spark-vllm-docker 2>/dev/null || git -C tmp/spark-vllm-docker pull --ff-only
      (cd tmp/spark-vllm-docker && bash build-and-copy.sh --pre-tf)
       ```
   *   **說明：** `vllm-node-tf5` 目前不是由儲存庫內的 Dockerfile 建置。如果你打算執行 Gemma 4 或更新的 TF5 路線 Qwen 模型，請依照上面的 upstream helper 流程明確建置。精確的重現步驟與建置時網路需求請參見 [docs/runtime-baseline.md](docs/runtime-baseline.md)。

5. **啟動堆疊**
   ```bash
   # Start gateway and waker only (models start on-demand)
   docker compose up -d

   # Pre-create all enabled model containers once the required local track images exist
   docker compose --profile models up --no-start
   ```

6. **測試 API**
   ```bash
    # Request to the shipped utility helper
    curl -X POST http://localhost:8009/v1/qwen3.5-0.8b/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" \
     -d '{
          "model": "qwen3.5-0.8b",
       "messages": [{"role": "user", "content": "你好！"}]
     }'
   ```

7. **使用受支援的驗證工具鏈**
   第一次手動 `curl` 成功之後，請切換到儲存庫維護的 bring-up 流程，而不是繼續使用臨時腳本：
   ```bash
   bash tools/validate-stack.sh
   bash tools/smoke-gateway.sh
   ```
   針對特定模型的 bring-up、smoke、soak 與手動 probe 指令，請參考 [tools/README.md](tools/README.md)。

## 如果你是新手，請從這裡開始

- 先讀 [README.md](README.md)，再讀 [docs/architecture.md](docs/architecture.md)，最後讀 [tools/README.md](tools/README.md)。
- 請將 [tools/README.md](tools/README.md) 與 [models.json](models.json) 視為目前運作層面的事實來源。
- 本 README 中未列為已驗證的模型，在驗證工具鏈重新確認之前都應視為實驗性模型。

## 前置需求
- Docker 20.10+ 與 Docker Compose
- 支援 CUDA 的 NVIDIA GPU 與 NVIDIA Container Toolkit
- Linux 主機（已在 Ubuntu 上測試）

## 貢獻

非常歡迎 Pull Request。 :)
但為了維持穩定性，我會強制執行嚴格的 **Pull Request 模板**。

## ⚠️ 已知問題

### 目前的驗證狀態

在目前的驗證工具鏈與儲存庫預設值下，當前唯一 **已驗證的主模型** 是：

- **`gpt-oss-20b`**
- **`gpt-oss-120b`**
- **`glm-4.7-flash-awq`**

隨堆疊提供的小型輔助模型 `qwen3.5-0.8b` 現在已是用於標題與工作階段中繼資料的 **已驗證工具輔助模型**，但它不屬於這組已驗證主模型。

其他可用模型仍有可能可以工作，但除了這個已驗證輔助模型之外，在以目前工具鏈重新測試之前，都應被視為 **實驗性**，而不是推薦的預設選項。

### 實驗性模型（GB10 / CUDA 12.1 相容性）

以下模型因為在 DGX Spark（GB10 GPU）上有零星當機情況，因此被標記為 **實驗性**：

- **Qwen3-Next-80B-A3B-Instruct** - 會在線性注意力層隨機崩潰
- **Qwen3-Next-80B-A3B-Thinking** - 同樣的問題

**根本原因：** GB10 GPU 使用 CUDA 12.1，但目前的 vLLM / PyTorch 堆疊只支援 CUDA ≤12.0。這會在若干次成功請求之後導致 `cudaErrorIllegalInstruction` 錯誤。

**暫時替代方案：** 在有正確 GB10 支援的新版 vLLM 映像出現之前，若需要穩定的 tool calling，請使用 `gpt-oss-20b` 或 `gpt-oss-120b`。

### Nemotron 3 Nano 30B（NVFP4）

**`nemotron-3-nano-30b-nvfp4`** 模型已在更新後的 `vllm-node` 標準軌道中重新啟用，但在目前的驗證工具鏈下仍應視為 **實驗性**。
**目前狀態：** 它現在可以在更新後的執行環境中載入並回應請求，但仍不屬於已驗證主模型集合，也不在隨附的 OpenCode 設定中。
**重要行為：** 可見的 assistant content 取決於非 thinking 請求形態。請求驗證器現在會為一般閘道請求注入這個預設值。
**目前保守的用戶端上限：** 手動 OpenCode / Cline 風格使用時，大約為 `100000` 個 prompt token。當前堆疊的五路 soak 在約 `101776` 個 prompt token 時可以穩定通過，而到約 `116298` 時已經非常接近邊界。

### Linux 上的 OpenCode 圖片 / 截圖支援

OpenCode（終端 AI 代理）在 Linux 上有一個已知問題：**剪貼簿圖片與檔案路徑圖片無法與視覺模型正常搭配使用**。即使 VL 模型透過 API 可以正常運作，模型仍會回覆 "The model you're using does not support image input"。

**根本原因：** OpenCode 在 Linux 上處理剪貼簿時，會在編碼之前破壞圖片的二進位資料（使用 `.text()` 而不是 `.arrayBuffer()`）。也就是說，實際上根本沒有影像資料送到伺服器。

**狀態：** 這看起來是 OpenCode 用戶端本身的 bug。歡迎協助調查或修正。推論堆疊本身在透過 `curl` 或其他 API 用戶端正確傳送時，可以正常處理 base64 圖片。

**暫時替代方案：** 使用 `curl` 或其他 API 用戶端，直接把圖片送到像 `qwen2.5-vl-7b` 這樣的 VL 模型。

### Qwen 2.5 Coder 7B 與 OpenCode 不相容

`qwen2.5-coder-7b-instruct` 模型的上下文上限嚴格為 **32,768 token**。但 OpenCode 通常會送出非常大的請求（buffer + input），超過 **35,000 token**，進而導致 `ValueError` 與請求失敗。

**建議：** 不要在長上下文任務中把 `qwen2.5-coder-7b` 與 OpenCode 一起使用。請改用 **`qwen3-coder-30b-instruct`**，它支援 **65,536 token** 上下文，且能更穩妥地處理 OpenCode 的大型請求。

### Llama 3.3 與 OpenCode 不相容

**`llama-3.3-70b-instruct-fp4`** **不建議搭配 OpenCode 使用**。
**原因：** 雖然模型透過 API 可以正常運作，但當它用 OpenCode 特定的客戶端提示詞初始化時，會表現出過度積極的 tool calling 行為。這會造成驗證錯誤與較差的使用體驗，例如剛打完招呼就試圖呼叫工具。
**建議：** 在 OpenCode 工作階段中，請使用 `gpt-oss-20b` 或 `qwen3-next-80b-a3b-instruct`。

## 致謝

特別感謝那些讓這個堆疊能使用最佳化 Docker 映像的社群成員：

- **Avarok 的 Thomas P. Braun**：感謝他提供通用型 vLLM 映像 `avarok/vllm-dgx-spark`，支援 non-gated activation（Nemotron）、混合模型，並分享了像 https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6 這樣的文章。
- **Christopher Owen**：感謝他提供 MXFP4 最佳化 vLLM 映像 `christopherowen/vllm-dgx-spark`，讓 DGX Spark 上的高效能推論成為可能。
- **eugr**：感謝他對原始 vLLM 映像 `eugr/vllm-dgx-spark` 所做的大量客製化工作，以及在 NVIDIA 論壇上的優秀分享。
- **Patrick Yi / scitrera.ai**：感謝他提供的 SGLang 工具模型配方，它啟發了本地 `qwen3.5-0.8b` helper 路徑。

## 授權

本專案採用 **Apache License 2.0** 授權。詳細資訊請參見 [LICENSE](LICENSE)。
