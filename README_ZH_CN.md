# DGX Spark Inference Stack - 服务家庭！

> **免责声明：** 本文档由人工智能翻译，可能包含错误。

一个基于 Docker 的推理栈，利用 NVIDIA vLLM 和智能资源管理来提供大语言模型 (LLM) 服务。该栈提供按需模型加载（空闲时自动关闭）、单租户 GPU 调度和统一的 API 网关。

该项目的目标是为您的家庭提供一个推理服务器。在测试了一个月并添加了新模型之后，我决定将其发布给社区。请理解这是一个业余项目，非常感谢具体的改进帮助。它基于我在互联网和 NVIDIA 论坛上找到的信息；我真的希望它有助于推动家庭实验室的发展。这主要集中在单个 DGX Spark 设置上，默认情况下必须可以在其上运行，但也欢迎添加对 2 个的支持。

## 文档

- **[架构与工作原理](docs/architecture.md)** - 了解堆栈、唤醒服务和请求流程。
- **[配置](docs/configuration.md)** - 环境变量、网络设置和唤醒调优。
- **[模型选择指南](docs/models.md)** - 29+ 支持模型的详细列表、快速选择器和用例。
- **[集成](docs/integrations.md)** - **Cline** (VS Code) 和 **OpenCode** (终端代理) 指南。
- **[安全与远程访问](docs/security.md)** - SSH 加固和设置受限端口转发。
- **[故障排除与监控](docs/troubleshooting.md)** - 调试、日志和常见错误解决方案。
- **[高级用法](docs/advanced.md)** - 添加新模型、自定义配置和持久化运行。
- **[TODO 笔记](TODO.md)** - 我对下一步的想法。

## 快速开始

1. **克隆仓库**
   ```bash
   git clone <repository-url>
   cd dgx-spark-inference-stack
   ```

2. **创建必要的目录**
   ```bash
   mkdir -p models vllm_cache_huggingface manual_download/openai_gpt-oss-encodings_fix
   ```

3. **下载所需的 Tokenizer (关键)**
   该栈需要手动下载 GPT-OSS 模型的 tiktoken 文件。
   ```bash
   wget https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/cl100k_base.tiktoken
   wget https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/o200k_base.tiktoken
   ```

4. **构建自定义 Docker 镜像 (强制)**
   该栈使用自定义优化的 vLLM 镜像，应在本地构建以确保最大性能。
   *   **时间:** 每个镜像预计约 20 分钟。
   *   **认证:** 您必须通过 NVIDIA NGC 认证才能拉取基础镜像。
       1.  在 [NVIDIA NGC Catalog](https://catalog.ngc.nvidia.com/) 创建开发者帐户 (不得在受制裁国家)。
       2.  使用您的凭据运行 `docker login nvcr.io`。
   *   **构建命令:**
       ```bash
       # 构建 Avarok 镜像 (通用) - 必须使用此标签以使用本地版本而非上游版本
       docker build -t avarok/vllm-dgx-spark:v11 custom-docker-containers/avarok

       # 构建 Christopher Owen 镜像 (MXFP4 优化)
       docker build -t christopherowen/vllm-dgx-spark:v12 custom-docker-containers/christopherowen
       ```

5. **启动栈**
   ```bash
   # 仅启动网关和唤醒器 (模型按需启动)
   docker compose up -d

   # 预先创建所有启用的模型容器 (推荐)
   docker compose --profile models up --no-start
   ```

6. **测试 API**
   ```bash
   # 请求 qwen2.5-1.5b (将自动启动)
   curl -X POST http://localhost:8009/v1/qwen2.5-1.5b-instruct/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" \
     -d '{
       "model": "qwen2.5-1.5b-instruct",
       "messages": [{"role": "user", "content": "你好！"}]
     }'
   ```

##先决条件
- Docker 20.10+ (带 Docker Compose)
- 支持 CUDA 的 NVIDIA GPU 和 NVIDIA Container Toolkit
- Linux 主机 (在 Ubuntu 上测试)

## 贡献

非常欢迎 Pull Requests。:)
但是，为了确保稳定性，我执行严格的 **Pull Request 模板**。

## ⚠️ 已知问题

### 实验性模型 (GB10/CUDA 12.1 兼容性)

以下模型因在 DGX Spark (GB10 GPU) 上偶尔崩溃而被标记为 **实验性**：

- **Qwen3-Next-80B-A3B-Instruct** - 在线性注意力层随机崩溃
- **Qwen3-Next-80B-A3B-Thinking** - 同样的问题

**根本原因:** GB10 GPU 使用 CUDA 12.1，但当前的 vLLM/PyTorch 栈仅支持 CUDA ≤12.0。这会导致在几次成功请求后出现 `cudaErrorIllegalInstruction` 错误。

**解决方法:** 在具有适当 GB10 支持的更新 vLLM 镜像可用之前，使用 `gpt-oss-20b` 或 `gpt-oss-120b` 进行稳定的工具调用。

### Nemotron 3 Nano 30B (NVFP4)

**`nemotron-3-nano-30b-nvfp4`** 模型目前已禁用。
**原因:** 与 GB10 上当前的 vLLM 构建不兼容。需要适当的 V1 引擎支持或更新的后端实现。


### Linux 上的 OpenCode 图像/截图支持

OpenCode (终端 AI 代理) 在 Linux 上有一个已知错误，即 **剪贴板图像和文件路径图像无法工作** 于视觉模型。即使 VL 模型通过 API 正常工作，模型也会响应 "The model you're using does not support image input"。

**根本原因:** OpenCode 的 Linux 剪贴板处理在编码之前损坏了二进制图像数据 (使用 `.text()` 而不是 `.arrayBuffer()`)。实际上没有图像数据发送到服务器。

**状态:** 这似乎是客户端 OpenCode 错误。欢迎帮助调查/修复！推理栈在正确发送时可以正确处理 base64 图像 (通过 curl 验证)。

**解决方法:** 使用 curl 或其他 API 客户端将图像直接发送到 VL 模型，如 `qwen2.5-vl-7b`。

### Qwen 2.5 Coder 7B 与 OpenCode 不兼容

`qwen2.5-coder-7b-instruct` 模型有 **32,768 tokens** 的严格上下文限制。然而，OpenCode 通常发送超过 **35,000 tokens** 的非常大的请求 (缓冲区 + 输入)，导致 `ValueError` 和请求失败。

**建议:** 即使对于长上下文任务，也不要将 `qwen2.5-coder-7b` 与 OpenCode 一起使用。相反，使用 **`qwen3-coder-30b-instruct`**，它支持 **65,536 tokens** 上下文并能轻松处理 OpenCode 的大请求。

### Llama 3.3 与 OpenCode 不兼容

**`llama-3.3-70b-instruct-fp4`** 模型 **不建议与 OpenCode 一起使用**。
**原因:** 虽然该模型通过 API 正常工作，但在由 OpenCode 特定的客户端提示初始化时，它表现出激进的工具调用行为。这会导致验证错误和用户体验下降 (例如，试图在问候后立即调用工具)。
**建议:** 在 OpenCode 会话中改用 `gpt-oss-20b` 或 `qwen3-next-80b-a3b-instruct`。

## 致谢

特别感谢为此栈制作优化 Docker 镜像的社区成员：

- **来自 Avarok 的 Thomas P. Braun**: 通用 vLLM 镜像 (`avarok/vllm-dgx-spark`)，支持非门控激活 (Nemotron) 和混合模型，以及像这样的帖子 https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6。
- **Christopher Owen**: MXFP4 优化的 vLLM 镜像 (`christopherowen/vllm-dgx-spark`)，在 DGX Spark 上实现高性能推理。
- **eugr**: 为原始 vLLM 镜像 (`eugr/vllm-dgx-spark`) 定制所做的所有工作以及 NVIDIA 论坛上的精彩帖子。

### 模型提供商

衷心感谢优化这些模型以进行 FP4/FP8 推理的组织：

- **Fireworks AI** (`Firworks`): 提供各种优化模型，包括 GLM-4.5、Llama 3.3 和 Ministral。
- **NVIDIA**: Qwen3-Next、Nemotron 和标准 FP4 实现。
- **RedHat**: Qwen3-VL 和 Mistral Small。
- **QuantTrio**: Qwen3-VL-Thinking。
- **OpenAI**: GPT-OSS 模型。

## 许可证

本项目采用 **Apache License 2.0** 许可。详情请参阅 [LICENSE](LICENSE) 文件。
