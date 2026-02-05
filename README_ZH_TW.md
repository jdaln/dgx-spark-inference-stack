# DGX Spark Inference Stack - 服務家庭！

> **免責聲明：** 本文件由人工智能翻譯，可能包含錯誤。

一個基於 Docker 的推理堆疊，利用 NVIDIA vLLM 和智能資源管理來提供大語言模型 (LLM) 服務。該堆疊提供按需模型加載（閒置時自動關閉）、單租戶 GPU 調度和統一的 API 閘道。

該專案的目標是為您的家庭提供一個推理伺服器。在測試了一個月並添加了新模型之後，我決定將其發布給社群。請理解這是一個業餘專案，非常感謝具體的改進幫助。它基於我在網際網路和 NVIDIA 論壇上找到的資訊；我真的希望它有助於推動家庭實驗室的發展。這主要集中在單個 DGX Spark 設定上，預設情況下必須可以在其上運行，但也歡迎添加對 2 個的支援。

## 文件

- **[架構與運作原理](docs/architecture.md)** - 了解堆疊、喚醒服務和請求流程。
- **[設定](docs/configuration.md)** - 環境變數、網路設定和喚醒調優。
- **[模型選擇指南](docs/models.md)** - 29+ 支援模型的詳細列表、快速選擇器和使用案例。
- **[整合](docs/integrations.md)** - **Cline** (VS Code) 和 **OpenCode** (終端代理) 指南。
- **[安全與遠端存取](docs/security.md)** - SSH 加固和設定受限埠轉發。
- **[故障排除與監控](docs/troubleshooting.md)** - 除錯、日誌和常見錯誤解決方案。
- **[進階用法](docs/advanced.md)** - 添加新模型、自訂設定和持久化運行。
- **[TODO 筆記](TODO.md)** - 我對下一步的想法。

## 快速開始

1. **複製儲存庫**
   ```bash
   git clone <repository-url>
   cd dgx-spark-inference-stack
   ```

2. **建立必要的目錄**
   ```bash
   mkdir -p models vllm_cache_huggingface manual_download/openai_gpt-oss-encodings_fix
   ```

3. **下載所需的 Tokenizer (關鍵)**
   該堆疊需要手動下載 GPT-OSS 模型的 tiktoken 檔案。
   ```bash
   wget https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/cl100k_base.tiktoken
   wget https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/o200k_base.tiktoken
   ```

4. **建置自訂 Docker 映像 (強制)**
   該堆疊使用自訂最佳化的 vLLM 映像，應在本地建置以確保最大效能。
   *   **時間:** 每個映像預計約 20 分鐘。
   *   **認證:** 您必須通過 NVIDIA NGC 認證才能拉取基礎映像。
       1.  在 [NVIDIA NGC Catalog](https://catalog.ngc.nvidia.com/) 建立開發者帳戶 (不得在受制裁國家)。
       2.  使用您的憑證執行 `docker login nvcr.io`。
   *   **建置指令:**
       ```bash
       # 建置 Avarok 映像 (通用) - 必須使用此標籤以使用本地版本而非上游版本
       docker build -t avarok/vllm-dgx-spark:v11 custom-docker-containers/avarok

       # 建置 Christopher Owen 映像 (MXFP4 最佳化)
       docker build -t christopherowen/vllm-dgx-spark:v12 custom-docker-containers/christopherowen
       ```

5. **啟動堆疊**
   ```bash
   # 僅啟動閘道和喚醒器 (模型按需啟動)
   docker compose up -d

   # 預先建立所有啟用的模型容器 (推薦)
   docker compose --profile models up --no-start
   ```

6. **測試 API**
   ```bash
   # 請求 qwen2.5-1.5b (將自動啟動)
   curl -X POST http://localhost:8009/v1/qwen2.5-1.5b-instruct/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" \
     -d '{
       "model": "qwen2.5-1.5b-instruct",
       "messages": [{"role": "user", "content": "你好！"}]
     }'
   ```

## 先決條件
- Docker 20.10+ (帶 Docker Compose)
- 支援 CUDA 的 NVIDIA GPU 和 NVIDIA Container Toolkit
- Linux 主機 (在 Ubuntu 上測試)

## 貢獻

非常歡迎 Pull Requests。:)
但是，為了確保穩定性，我執行嚴格的 **Pull Request 範本**。

## ⚠️ 已知問題

### 實驗性模型 (GB10/CUDA 12.1 相容性)

以下模型因在 DGX Spark (GB10 GPU) 上偶爾崩潰而被標記為 **實驗性**：

- **Qwen3-Next-80B-A3B-Instruct** - 在線性注意力層隨機崩潰
- **Qwen3-Next-80B-A3B-Thinking** -同樣的問題

**根本原因:** GB10 GPU 使用 CUDA 12.1，但目前的 vLLM/PyTorch 堆疊僅支援 CUDA ≤12.0。這會導致在幾次成功請求後出現 `cudaErrorIllegalInstruction` 錯誤。

**解決方法:** 在具有適當 GB10 支援的更新 vLLM 映像可用之前，使用 `gpt-oss-20b` 或 `gpt-oss-120b` 進行穩定的工具調用。

### Nemotron 3 Nano 30B (NVFP4)

**`nemotron-3-nano-30b-nvfp4`** 模型目前已停用。
**原因:** 與 GB10 上目前的 vLLM 建置不相容。需要適當的 V1 引擎支援或更新的後端實作。


### Linux 上的 OpenCode 圖像/截圖支援

OpenCode (終端 AI 代理) 在 Linux 上有一個已知錯誤，即 **剪貼簿圖像和檔案路徑圖像無法運作** 於視覺模型。即使 VL 模型透過 API 正常運作，模型也會回應 "The model you're using does not support image input"。

**根本原因:** OpenCode 的 Linux 剪貼簿處理在編碼之前損壞了二進位影像資料 (使用 `.text()` 而不是 `.arrayBuffer()`)。實際上沒有影像資料傳送到伺服器。

**狀態:** 這似乎是使用者端 OpenCode 錯誤。歡迎協助調查/修復！推理堆疊在正確傳送時可以正確處理 base64 影像 (透過 curl 驗證)。

**解決方法:** 使用 curl 或其他 API 使用者端將影像直接傳送到 VL 模型，如 `qwen2.5-vl-7b`。

### Qwen 2.5 Coder 7B 與 OpenCode 不相容

`qwen2.5-coder-7b-instruct` 模型有 **32,768 tokens** 的嚴格上下文限制。然而，OpenCode 通常傳送超過 **35,000 tokens** 的非常大的請求 (緩衝區 + 輸入)，導致 `ValueError` 和請求失敗。

**建議:** 即使對於長上下文任務，也不要將 `qwen2.5-coder-7b` 與 OpenCode 一起使用。相反，使用 **`qwen3-coder-30b-instruct`**，它支援 **65,536 tokens** 上下文並能輕鬆處理 OpenCode 的大請求。

### Llama 3.3 與 OpenCode 不相容

**`llama-3.3-70b-instruct-fp4`** 模型 **不建議與 OpenCode 一起使用**。
**原因:** 雖然該模型透過 API 正常運作，但在由 OpenCode 特定的使用者端提示初始化時，它表現出激進的工具調用行為。這會導致驗證錯誤和使用者體驗下降 (例如，試圖在問候後立即調用工具)。
**建議:** 在 OpenCode 工作階段中改用 `gpt-oss-20b` 或 `qwen3-next-80b-a3b-instruct`。

## 致謝

特別感謝為此堆疊製作最佳化 Docker 映像的社群成員：

- **來自 Avarok 的 Thomas P. Braun**: 通用 vLLM 映像 (`avarok/vllm-dgx-spark`)，支援非門控啟用 (Nemotron) 和混合模型，以及像這樣的文章 https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6。
- **Christopher Owen**: MXFP4 最佳化的 vLLM 映像 (`christopherowen/vllm-dgx-spark`)，在 DGX Spark 上實現高效能推理。
- **eugr**: 為原始 vLLM 映像 (`eugr/vllm-dgx-spark`) 定制所做的所有工作以及 NVIDIA 論壇上的精彩文章。

### 模型提供商

衷心感謝最佳化這些模型以進行 FP4/FP8 推理的組織：

- **Fireworks AI** (`Firworks`): 提供各種最佳化模型，包括 GLM-4.5、Llama 3.3 和 Ministral。
- **NVIDIA**: Qwen3-Next、Nemotron 和標準 FP4 實作。
- **RedHat**: Qwen3-VL 和 Mistral Small。
- **QuantTrio**: Qwen3-VL-Thinking。
- **OpenAI**: GPT-OSS 模型。

## 許可證

本專案採用 **Apache License 2.0** 許可。詳情請參閱 [LICENSE](LICENSE) 檔案。
