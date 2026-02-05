# DGX Spark Inference Stack - serve the home!

🌍 **Read this in other languages**:
[Deutsch](README_DE.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Italiano](README_IT.md) | [日本語](README_JA.md) | [简体中文](README_ZH_CN.md) | [繁體中文](README_ZH_TW.md) | [Русский](README_RU.md) | [Українська](README_UK.md) | [Português](README_PT.md) | [한국어](README_KO.md) | [العربية](README_AR.md) | [Tiếng Việt](README_VI.md) | [Türkçe](README_TR.md)

Your Nvidia DGX Spark should not be another side project. Start using it! This is a Docker-based inference stack for serving large language models (LLMs) using NVIDIA vLLM with intelligent resource management. This stack provides on-demand model loading with automatic idle shutdown, single-tenant GPU scheduling, and a unified API gateway.

The goal of the project is to provide an inference server for your home. After testing this and adding new models for a month, I decided to release it for the community. Please understand that this is a hobby project and that concrete help to improve it is highly appreciated. It is based on information I found on the Internet and on the NVIDIA Forums, I really hope it helps driving forward homelabs. This is mainly focused on the single DGX Spark setup and must work on it by default but adding support for 2 is welcome.

## Documentation

- **[Architecture & How It Works](docs/architecture.md)** - Understanding the stack, waker service, and request flow.
- **[Configuration](docs/configuration.md)** - Environment variables, network settings, and waker tuning.
- **[Model Selection Guide](docs/models.md)** - Detailed list of 29+ supported models, quick chooser, and use cases.
- **[Integrations](docs/integrations.md)** - Guides for **Cline** (VS Code) and **OpenCode** (Terminal Agent).
- **[Security & Remote Access](docs/security.md)** - Hardening SSH and setting up restricted port forwarding.
- **[Troubleshooting & Monitoring](docs/troubleshooting.md)** - Debugging, logs, and common error solutions.
- **[Advanced Usage](docs/advanced.md)** - Adding new models, custom configurations, and persistent operation.
- **[TODO Notes](TODO.md)** - Ideas I have for what to do next. 

## Quick Start

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd dgx-spark-inference-stack
   ```

2. **Create necessary directories**
   ```bash
   mkdir -p models vllm_cache_huggingface manual_download/openai_gpt-oss-encodings_fix
   ```

3. **Download required tokenizers (CRITICAL)**
   The stack requires manual download of tiktoken files for GPT-OSS models.
   ```bash
   wget https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/cl100k_base.tiktoken
   wget https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/o200k_base.tiktoken
   ```

4. **Build Custom Docker Images (MANDATORY)**
   The stack uses custom-optimized vLLM images that should be built locally to ensure maximum performance.
   *   **Time:** Expect ~20 minutes per image.
   *   **Auth:** You must authenticate with NVIDIA NGC to pull base images.
       1.  Create a developer account at [NVIDIA NGC Catalog](https://catalog.ngc.nvidia.com/) (must not be in a sanctioned country).
       2.  Run `docker login nvcr.io` with your credentials.
   *   **Build Commands:**
       ```bash
       # Build Avarok image (General Purpose) - MUST use this tag to use local version over upstream
       docker build -t avarok/vllm-dgx-spark:v11 custom-docker-containers/avarok

       # Build Christopher Owen image (MXFP4 Optimized)
       docker build -t christopherowen/vllm-dgx-spark:v12 custom-docker-containers/christopherowen
       ```

5. **Start the stack**
   ```bash
   # Start gateway and waker only (models start on-demand)
   docker compose up -d

   # Pre-create all enabled model containers (recommended)
   docker compose --profile models up --no-start
   ```

6. **Test the API**
   ```bash
   # Request to qwen2.5-1.5b (will auto-start)
   curl -X POST http://localhost:8009/v1/qwen2.5-1.5b-instruct/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" \
     -d '{
       "model": "qwen2.5-1.5b-instruct",
       "messages": [{"role": "user", "content": "Hello!"}]
     }'
   ```

## Prerequisites
- Docker 20.10+ with Docker Compose
- NVIDIA GPU(s) with CUDA support and NVIDIA Container Toolkit
- Linux host (tested on Ubuntu)

## Contributing

Pull requests very welcome. :)
However, to ensure stability, I enforce a strict **Pull Request Template**.

## ⚠️ Known Issues

### Experimental Models (GB10/CUDA 12.1 Compatibility)

The following models are marked as **experimental** due to sporadic crashes on DGX Spark (GB10 GPU):

- **Qwen3-Next-80B-A3B-Instruct** - Crashes randomly in linear attention layer
- **Qwen3-Next-80B-A3B-Thinking** - Same issue

**Root cause:** The GB10 GPU uses CUDA 12.1, but the current vLLM/PyTorch stack only supports CUDA ≤12.0. This causes `cudaErrorIllegalInstruction` errors after several successful requests.

**Workaround:** Use `gpt-oss-20b` or `gpt-oss-120b` for stable tool calling until an updated vLLM image with proper GB10 support is available.

### Nemotron 3 Nano 30B (NVFP4)

The **`nemotron-3-nano-30b-nvfp4`** model is currently disabled.
**Reason:** Incompatible with current vLLM build on GB10. Requires proper V1 engine support or updated backend implementation.


### OpenCode Image/Screenshot Support on Linux

OpenCode (terminal AI agent) has a known bug on Linux where **clipboard images and file path images do not work** with vision models. The model responds with "The model you're using does not support image input" even though VL models work correctly via API.

**Root cause:** OpenCode's Linux clipboard handling corrupts binary image data before encoding (uses `.text()` instead of `.arrayBuffer()`). No image data is actually sent to the server.

**Status:** This seems to be a client-side OpenCode bug. Help investigating/fixing is welcome! The inference stack correctly handles base64 images when properly sent (verified via curl).

**Workaround:** Use curl or other API clients to send images directly to VL models like `qwen2.5-vl-7b`.

### Qwen 2.5 Coder 7B & OpenCode Incompatibility

The `qwen2.5-coder-7b-instruct` model has a strict context limit of **32,768 tokens**. However, OpenCode typically sends very large requests (buffer + input) exceeding **35,000 tokens**, causing `ValueError` and request failures.

**Recommendation:** Do not use `qwen2.5-coder-7b` with OpenCode for long-context tasks. Instead, use **`qwen3-coder-30b-instruct`** which supports **65,536 tokens** context and handles OpenCode's large requests comfortably.

### Llama 3.3 & OpenCode Incompatibility

The **`llama-3.3-70b-instruct-fp4`** model is **not recommended for use with OpenCode**.
**Reason:** While the model works correctly via API, it exhibits aggressive tool calling behavior when initialized by OpenCode's specific client prompts. This leads to validation errors and a degraded user experience (e.g., trying to call tools immediately upon greeting).
**Recommendation:** Use `gpt-oss-20b` or `qwen3-next-80b-a3b-instruct` for OpenCode sessions instead.

## Credits

Special thanks to the community members who made optimized Docker images used in this stack:

- **Thomas P. Braun from Avarok**: For the general-purpose vLLM image (`avarok/vllm-dgx-spark`) with support for non-gated activations (Nemotron) and hybrid models and posts like this https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6.
- **Christopher Owen**: For the MXFP4-optimized vLLM image (`christopherowen/vllm-dgx-spark`) enabling high-performance inference on DGX Spark.
- **eugr**: For all the work on the original vLLM image (`eugr/vllm-dgx-spark`) customizations and the great postings on NVIDIA Forums.

### Model Providers

Huge thanks to the organizations optimizing these models for FP4/FP8 inference:

- **Firworks AI** (`Firworks`): For a wide range of optimized models including GLM-4.5, Llama 3.3, and Ministral.
- **NVIDIA**: For Qwen3-Next, Nemotron, and standard FP4 implementations.
- **RedHat**: For Qwen3-VL and Mistral Small.
- **QuantTrio**: For Qwen3-VL-Thinking.
- **OpenAI**: For the GPT-OSS models.

## License

This project is licensed under the **Apache License 2.0**. See the [LICENSE](LICENSE) file for details.
