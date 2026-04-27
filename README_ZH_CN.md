# DGX Spark Inference Stack - 让它真正为家庭服务！

🌍 **阅读其他语言版本**：
[Deutsch](README_DE.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Italiano](README_IT.md) | [日本語](README_JA.md) | [简体中文](README_ZH_CN.md) | [繁體中文](README_ZH_TW.md) | [Русский](README_RU.md) | [Українська](README_UK.md) | [Português](README_PT.md) | [한국어](README_KO.md) | [العربية](README_AR.md) | [Tiếng Việt](README_VI.md) | [Türkçe](README_TR.md)

> **AI 翻译提示：** 本文件基于 [README.md](README.md) 由 AI 翻译而来，可能包含错误，也可能落后于英文原版。如有疑问，请以英文 README 为准。

你的 Nvidia DGX Spark 不应该只是另一个搁置的副项目。把它真正用起来。这是一个基于 Docker 的推理栈，使用 NVIDIA vLLM 和智能资源管理来提供大语言模型（LLM）服务。该栈提供按需加载模型、空闲自动关闭、带可选工具辅助模型的单主模型调度通道，以及统一的 API 网关。

这个项目的目标是为家庭环境提供一个推理服务器。在测试一个月并添加了新模型之后，我决定把它发布给社区。请理解这只是一个业余项目，因此任何能实际改进它的帮助都非常欢迎。它基于我在互联网和 NVIDIA 论坛上找到的信息。我真心希望它能推动 homelab 继续向前发展。当前重点是单台 DGX Spark，并且默认必须在这种环境中可用，但也欢迎为两台设备提供支持。

## 文档

- **[架构与工作原理](docs/architecture.md)** - 了解整个栈、waker 服务以及请求流。
- **[配置](docs/configuration.md)** - 环境变量、网络设置和 waker 调优。
- **[模型选择指南](docs/models.md)** - 当前模型目录、快速选择器和验证状态。
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

- 先读 [docs/architecture.md](docs/architecture.md)，然后读 [tools/README.md](tools/README.md)。
- 把 [tools/README.md](tools/README.md) 和 [models.json](models.json) 一起视为当前运行层面的事实来源。
- 把本 README 当作一个简短入口，而不是完整模型目录。更完整的目录请看 [docs/models.md](docs/models.md)。

## 前置要求
- Docker 20.10+ 和 Docker Compose
- 支持 CUDA 的 NVIDIA GPU 与 NVIDIA Container Toolkit
- Linux 主机（已在 Ubuntu 上测试）

## 贡献

非常欢迎 Pull Request。 :)
不过，为了保证稳定性，我会强制执行严格的 **Pull Request 模板**。

## 当前状态

本 README 现在只突出这个栈当前推荐的默认路径。

- **已验证的主模型：** `gpt-oss-20b`、`gpt-oss-120b` 和 `glm-4.7-flash-awq`
- **已验证的工具辅助模型：** 用于标题和会话元数据的 `qwen3.5-0.8b`
- **其他所有内容：** 虽然都在仓库里，但在用当前验证工具链重新验证之前，都不是这份 README 的默认选择

更完整的模型目录、实验性路径和手动使用场景，请查看 [docs/models.md](docs/models.md) 和 [models.json](models.json)。

客户端注意事项、运行时特性和故障排查说明，请查看 [docs/integrations.md](docs/integrations.md) 和 [docs/troubleshooting.md](docs/troubleshooting.md)。

## 致谢

特别感谢那些其 Docker 镜像和配方工作启发了这个栈的社区成员：

- **Avarok 的 Thomas P. Braun**：感谢他提供通用型 vLLM 镜像 `avarok/vllm-dgx-spark`，支持非 gated activation（Nemotron）、混合模型，并分享了诸如 https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6 之类的文章。
- **Christopher Owen**：感谢他提供针对 MXFP4 优化的 vLLM 镜像 `christopherowen/vllm-dgx-spark`，使 DGX Spark 上的高性能推理成为可能。
- **eugr**：感谢他提供原始的 DGX Spark 社区 vLLM 仓库 `eugr/spark-vllm-docker`、相关定制工作，以及在 NVIDIA 论坛上的优秀分享。
- **Patrick Yi / scitrera.ai**：感谢他提供的 SGLang 工具模型方案，它启发了本地 `qwen3.5-0.8b` helper 路径。
- **Raphael Amorim**：感谢他提供的社区 AutoRound 配方形态，它启发了实验性的本地 `qwen3.5-122b-a10b-int4-autoround` 路径。
- **Bjarke Bolding**：感谢他提供的长上下文 AutoRound 配方形态，它启发了实验性的本地 `qwen3-coder-next-int4-autoround` 路径。

## 许可证

本项目采用 **Apache License 2.0** 许可。详情见 [LICENSE](LICENSE)。
