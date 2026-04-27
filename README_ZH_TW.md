# DGX Spark Inference Stack - 讓它真正為家庭服務！

🌍 **閱讀其他語言版本**：
[Deutsch](README_DE.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Italiano](README_IT.md) | [日本語](README_JA.md) | [简体中文](README_ZH_CN.md) | [繁體中文](README_ZH_TW.md) | [Русский](README_RU.md) | [Українська](README_UK.md) | [Português](README_PT.md) | [한국어](README_KO.md) | [العربية](README_AR.md) | [Tiếng Việt](README_VI.md) | [Türkçe](README_TR.md)

> **AI 翻譯提示：** 本檔案依據 [README.md](README.md) 由 AI 翻譯，可能包含錯誤，也可能落後於英文原版。如有疑問，請以英文 README 為準。

你的 Nvidia DGX Spark 不應該只是另一個被擱置的副專案。把它真正用起來。這是一個以 Docker 為基礎的推論堆疊，使用 NVIDIA vLLM 與智慧型資源管理來提供大型語言模型（LLM）服務。這個堆疊提供按需載入模型、閒置時自動關閉、帶有可選工具輔助模型的單一主模型排程通道，以及統一的 API 閘道。

這個專案的目標是為家庭環境提供一套推論伺服器。在測試了一個月並加入新模型之後，我決定把它釋出給社群。請理解這是一個興趣專案，因此任何能實際改善它的協助都非常歡迎。它建立在我從網路和 NVIDIA 論壇找到的資訊之上。我真心希望它能幫助 homelab 社群往前推進。目前的重點是一台 DGX Spark，並且預設必須能在這種環境中正常運作，但也歡迎加入雙機支援。

## 文件

- **[架構與運作方式](docs/architecture.md)** - 了解整個堆疊、waker 服務與請求流程。
- **[設定](docs/configuration.md)** - 環境變數、網路設定與 waker 調校。
- **[模型選擇指南](docs/models.md)** - 目前模型目錄、快速選擇器與驗證狀態。
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

- 先讀 [docs/architecture.md](docs/architecture.md)，最後讀 [tools/README.md](tools/README.md)。
- 請將 [tools/README.md](tools/README.md) 與 [models.json](models.json) 視為目前運作層面的事實來源。
- 請把本 README 視為一個簡短入口，而不是完整模型目錄。更完整的目錄請看 [docs/models.md](docs/models.md)。

## 前置需求
- Docker 20.10+ 與 Docker Compose
- 支援 CUDA 的 NVIDIA GPU 與 NVIDIA Container Toolkit
- Linux 主機（已在 Ubuntu 上測試）

## 貢獻

非常歡迎 Pull Request。 :)
但為了維持穩定性，我會強制執行嚴格的 **Pull Request 模板**。

## 目前狀態

本 README 現在只突顯這個堆疊目前推薦的預設路徑。

- **已驗證的主模型：** `gpt-oss-20b`、`gpt-oss-120b` 和 `glm-4.7-flash-awq`
- **已驗證的工具輔助模型：** 用於標題與工作階段中繼資料的 `qwen3.5-0.8b`
- **其他所有內容：** 雖然都在儲存庫裡，但在以目前驗證工具鏈重新驗證之前，都不是這份 README 的預設選項

更完整的模型目錄、實驗性路徑與手動使用情境，請查看 [docs/models.md](docs/models.md) 和 [models.json](models.json)。

客戶端注意事項、執行環境特性與疑難排解說明，請查看 [docs/integrations.md](docs/integrations.md) 和 [docs/troubleshooting.md](docs/troubleshooting.md)。

## 致謝

特別感謝那些其 Docker 映像與配方工作啟發了這個堆疊的社群成員：

- **Avarok 的 Thomas P. Braun**：感謝他提供通用型 vLLM 映像 `avarok/vllm-dgx-spark`，支援 non-gated activation（Nemotron）、混合模型，並分享了像 https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6 這樣的文章。
- **Christopher Owen**：感謝他提供 MXFP4 最佳化 vLLM 映像 `christopherowen/vllm-dgx-spark`，讓 DGX Spark 上的高效能推論成為可能。
- **eugr**：感謝他提供原始的 DGX Spark 社群 vLLM 儲存庫 `eugr/spark-vllm-docker`、相關客製化工作，以及在 NVIDIA 論壇上的優秀分享。
- **Patrick Yi / scitrera.ai**：感謝他提供的 SGLang 工具模型配方，它啟發了本地 `qwen3.5-0.8b` helper 路徑。
- **Raphael Amorim**：感謝他提供的社群 AutoRound 配方形態，它啟發了實驗性的本地 `qwen3.5-122b-a10b-int4-autoround` 路徑。
- **Bjarke Bolding**：感謝他提供的長上下文 AutoRound 配方形態，它啟發了實驗性的本地 `qwen3-coder-next-int4-autoround` 路徑。

## 授權

本專案採用 **Apache License 2.0** 授權。詳細資訊請參見 [LICENSE](LICENSE)。
