# DGX Spark Inference Stack - 让它真正为家庭服务！

🌍 **阅读其他语言版本**：
[Deutsch](README_DE.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Italiano](README_IT.md) | [日本語](README_JA.md) | [简体中文](README_ZH_CN.md) | [繁體中文](README_ZH_TW.md) | [Русский](README_RU.md) | [Українська](README_UK.md) | [Português](README_PT.md) | [한국어](README_KO.md) | [العربية](README_AR.md) | [Tiếng Việt](README_VI.md) | [Türkçe](README_TR.md)

> **AI 翻译提示：** 本文件基于 [README.md](README.md) 由 AI 翻译而来，可能包含错误，也可能落后于英文原版。如有疑问，请以英文 README 为准。

你的 Nvidia DGX Spark 不应该只是另一个搁置的副项目。把它真正用起来。这是一个基于 Docker 的推理栈，使用 NVIDIA vLLM 和智能资源管理来提供大语言模型（LLM）服务。该栈提供按需加载模型、空闲自动关闭、带可选工具辅助模型的单主模型调度通道，以及统一的 API 网关。

这个项目的目标是为家庭环境提供一个推理服务器。在测试一个月并添加了新模型之后，我决定把它发布给社区。请理解这只是一个业余项目，因此任何能实际改进它的帮助都非常欢迎。它基于我在互联网和 NVIDIA 论坛上找到的信息。我真心希望它能推动 homelab 继续向前发展。当前重点是单台 DGX Spark，并且默认必须在这种环境中可用，但也欢迎为两台设备提供支持。

## 文档

- **[架构与工作原理](docs/architecture.md)** - 了解整个栈、waker 服务以及请求流。
- **[配置](docs/configuration.md)** - 环境变量、网络设置和 waker 调优。
- **[模型选择指南](docs/models.md)** - 29+ 个受支持模型的详细清单、快速选择器和使用场景。
- **[集成](docs/integrations.md)** - 面向 **Cline**（VS Code）和 **OpenCode**（终端代理）的指南。
- **[安全与远程访问](docs/security.md)** - SSH 加固与受限端口转发配置。
- **[故障排查与监控](docs/troubleshooting.md)** - 调试、日志和常见错误解决方案。
- **[高级用法](docs/advanced.md)** - 添加新模型、自定义配置和持续运行。
- **[运行时基线](docs/runtime-baseline.md)** - 仓库当前预期的本地镜像轨道以及重建方式。
- **[工具与验证工具链](tools/README.md)** - 支持的 smoke、soak、检查和手动探测脚本。
- **[TODO 记录](TODO.md)** - 我接下来想做的事情。

## 快速开始

1. **克隆仓库**
   ```bash
   git clone <repository-url>
   cd dgx-spark-inference-stack
   ```

2. **创建必要目录**
   ```bash
   mkdir -p models vllm_cache_huggingface manual_download/openai_gpt-oss-encodings_fix
   ```

3. **下载必需的 tokenizer（关键）**
   这个栈要求你手动下载 GPT-OSS 模型所需的 `tiktoken` 文件。
   ```bash
   wget https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/cl100k_base.tiktoken
   wget https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/o200k_base.tiktoken
   ```

4. **构建自定义 Docker 镜像（必需）**
   该栈使用自定义优化过的 vLLM 镜像，应在本地构建以确保最佳性能。
   *   **时间：** 每个镜像大约需要 20 分钟。
   *   **认证：** 你必须登录 NVIDIA NGC 才能拉取基础镜像。
       1.  在 [NVIDIA NGC Catalog](https://catalog.ngc.nvidia.com/) 创建开发者账户（不能位于受制裁国家）。
       2.  使用你的凭据执行 `docker login nvcr.io`。
   *   **构建命令：**
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
   *   **说明：** `vllm-node-tf5` 目前不是通过仓库内的 Dockerfile 构建的。如果你计划运行 Gemma 4 或更新的 TF5 路线 Qwen 模型，请按上面的 upstream helper 流程显式构建。准确的复现步骤和构建时网络要求见 [docs/runtime-baseline.md](docs/runtime-baseline.md)。

5. **启动栈**
   ```bash
   # Start gateway and waker only (models start on-demand)
   docker compose up -d

   # Pre-create all enabled model containers once the required local track images exist
   docker compose --profile models up --no-start
   ```

6. **测试 API**
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

7. **使用受支持的验证工具链**
   第一次手动 `curl` 成功后，请切换到仓库维护的 bring-up 流程，而不是继续使用临时脚本：
   ```bash
   bash tools/validate-stack.sh
   bash tools/smoke-gateway.sh
   ```
   针对具体模型的 bring-up、smoke、soak 和手动 probe 命令，请参见 [tools/README.md](tools/README.md)。

## 如果你是新手，请从这里开始

- 先读 [README.md](README.md)，再读 [docs/architecture.md](docs/architecture.md)，然后读 [tools/README.md](tools/README.md)。
- 把 [tools/README.md](tools/README.md) 和 [models.json](models.json) 一起视为当前运行层面的事实来源。
- 本 README 中未列为已验证的模型，在验证工具链重新确认之前都应视为实验性模型。

## 前置要求
- Docker 20.10+ 和 Docker Compose
- 支持 CUDA 的 NVIDIA GPU 与 NVIDIA Container Toolkit
- Linux 主机（已在 Ubuntu 上测试）

## 贡献

非常欢迎 Pull Request。 :)
不过，为了保证稳定性，我会强制执行严格的 **Pull Request 模板**。

## ⚠️ 已知问题

### 当前验证状态

在当前验证工具链和仓库默认配置下，目前唯一 **已验证的主模型** 是：

- **`gpt-oss-20b`**
- **`gpt-oss-120b`**
- **`glm-4.7-flash-awq`**

随仓库提供的小型辅助模型 `qwen3.5-0.8b` 现在已经是用于标题和会话元数据的 **已验证工具辅助模型**，但它不属于这组已验证主模型。

其他可用模型仍然可能工作，但除了这个已验证辅助模型之外，在使用当前工具链重新测试之前，都应被视为 **实验性**，而不是推荐默认值。

### 实验性模型（GB10 / CUDA 12.1 兼容性）

以下模型由于在 DGX Spark（GB10 GPU）上会出现偶发崩溃，因此被标记为 **实验性**：

- **Qwen3-Next-80B-A3B-Instruct** - 在线性注意力层中随机崩溃
- **Qwen3-Next-80B-A3B-Thinking** - 同样的问题

**根因：** GB10 GPU 使用 CUDA 12.1，而当前 vLLM / PyTorch 栈只支持 CUDA ≤12.0。这会在若干次成功请求之后触发 `cudaErrorIllegalInstruction` 错误。

**临时规避方案：** 在有正确 GB10 支持的新版 vLLM 镜像出现之前，如需稳定的 tool calling，请使用 `gpt-oss-20b` 或 `gpt-oss-120b`。

### Nemotron 3 Nano 30B（NVFP4）

**`nemotron-3-nano-30b-nvfp4`** 模型已经在更新后的 `vllm-node` 标准轨道中重新启用，但在当前验证工具链下仍应视为 **实验性**。
**当前状态：** 它现在可以在更新后的运行时中加载并响应请求，但还不属于已验证主模型集合，也不在仓库附带的 OpenCode 配置中。
**重要行为：** 可见的 assistant content 取决于非 thinking 请求形态。请求验证器现在会为普通网关请求注入这个默认值。
**当前保守客户端上限：** 手动 OpenCode / Cline 风格使用时，大约为 `100000` 个 prompt token。当前栈的五路 soak 在约 `101776` 个 prompt token 时可以稳定通过，而到约 `116298` 时已经相当接近边界。

### Linux 上的 OpenCode 图片/截图支持

OpenCode（终端 AI 代理）在 Linux 上有一个已知问题：**剪贴板图片和文件路径图片无法与视觉模型一起工作**。即使 VL 模型通过 API 能正常工作，模型仍会返回 "The model you're using does not support image input"。

**根因：** OpenCode 在 Linux 上处理剪贴板时，会在编码之前破坏图片二进制数据（使用 `.text()` 而不是 `.arrayBuffer()`）。也就是说，实际上根本没有图像数据被发送到服务器。

**状态：** 这看起来是 OpenCode 客户端自身的 bug。欢迎帮助调查或修复。推理栈本身在通过 `curl` 或其他 API 客户端正确发送时，可以正常处理 base64 图片。

**临时规避方案：** 使用 `curl` 或其他 API 客户端，将图片直接发送到 `qwen2.5-vl-7b` 这样的 VL 模型。

### Qwen 2.5 Coder 7B 与 OpenCode 不兼容

`qwen2.5-coder-7b-instruct` 模型的上下文限制严格为 **32,768 token**。但 OpenCode 通常会发送非常大的请求（buffer + input），超过 **35,000 token**，从而导致 `ValueError` 和请求失败。

**建议：** 不要在长上下文任务中将 `qwen2.5-coder-7b` 与 OpenCode 搭配使用。请改用 **`qwen3-coder-30b-instruct`**，它支持 **65,536 token** 上下文，并且能更稳妥地处理 OpenCode 的大请求。

### Llama 3.3 与 OpenCode 不兼容

**`llama-3.3-70b-instruct-fp4`** **不建议与 OpenCode 一起使用**。
**原因：** 虽然模型通过 API 可以正常工作，但在使用 OpenCode 特定客户端提示词初始化时，会表现出过于激进的 tool calling 行为。这会带来验证错误和较差的使用体验，例如刚打完招呼就试图调用工具。
**建议：** OpenCode 会话中请使用 `gpt-oss-20b` 或 `qwen3-next-80b-a3b-instruct`。

## 致谢

特别感谢为这个栈提供优化 Docker 镜像的社区成员：

- **Avarok 的 Thomas P. Braun**：感谢他提供通用型 vLLM 镜像 `avarok/vllm-dgx-spark`，支持非 gated activation（Nemotron）、混合模型，并分享了诸如 https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6 之类的文章。
- **Christopher Owen**：感谢他提供针对 MXFP4 优化的 vLLM 镜像 `christopherowen/vllm-dgx-spark`，使 DGX Spark 上的高性能推理成为可能。
- **eugr**：感谢他为原始 vLLM 镜像 `eugr/vllm-dgx-spark` 所做的大量定制工作，以及在 NVIDIA 论坛上的优秀分享。
- **Patrick Yi / scitrera.ai**：感谢他提供的 SGLang 工具模型方案，它启发了本地 `qwen3.5-0.8b` helper 路径。

## 许可证

本项目采用 **Apache License 2.0** 许可。详情见 [LICENSE](LICENSE)。
