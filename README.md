# DGX Spark Inference Stack - serve the home!

🌍 **Read this in other languages**:
[Deutsch](README_DE.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Italiano](README_IT.md) | [日本語](README_JA.md) | [简体中文](README_ZH_CN.md) | [繁體中文](README_ZH_TW.md) | [Русский](README_RU.md) | [Українська](README_UK.md) | [Português](README_PT.md) | [한국어](README_KO.md) | [العربية](README_AR.md) | [Tiếng Việt](README_VI.md) | [Türkçe](README_TR.md)

Your Nvidia DGX Spark should not be another side project. Start using it! This is a Docker-based inference stack for serving large language models (LLMs) using NVIDIA vLLM with intelligent resource management. This stack provides on-demand model loading with automatic idle shutdown, a single main-model scheduling lane with an optional utility helper, and a unified API gateway.

The goal of the project is to provide an inference server for your home. After testing this and adding new models for a month, I decided to release it for the community. Please understand that this is a hobby project and that concrete help to improve it is highly appreciated. It is based on information I found on the Internet and on the NVIDIA Forums, I really hope it helps driving forward homelabs. This is mainly focused on the single DGX Spark setup and must work on it by default but adding support for 2 is welcome.

## Documentation

- **[Architecture & How It Works](docs/architecture.md)** - Understanding the stack, waker service, and request flow.
- **[Configuration](docs/configuration.md)** - Environment variables, network settings, and waker tuning.
- **[Model Selection Guide](docs/models.md)** - Current model catalog, quick chooser, and validation status.
- **[Integrations](docs/integrations.md)** - Guides for **Cline** (VS Code) and **OpenCode** (Terminal Agent).
- **[Security & Remote Access](docs/security.md)** - Hardening SSH and setting up restricted port forwarding.
- **[Troubleshooting & Monitoring](docs/troubleshooting.md)** - Debugging, logs, and common error solutions.
- **[Advanced Usage](docs/advanced.md)** - Adding new models, custom configurations, and persistent operation.
- **[Runtime Baseline](docs/runtime-baseline.md)** - Which local image tracks the repo expects and how to rebuild them.
- **[Tools & Validation Harness](tools/README.md)** - The supported smoke, soak, inspection, and manual probe scripts.
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
      # Build Avarok image (General Purpose) - MUST use this tag to use local version over upstream.
      # Build from the repo root so the manually downloaded tokenizer files are included.
      docker build -t avarok/vllm-dgx-spark:v11 -f custom-docker-containers/avarok/Dockerfile .

      # If you want compose services that default to the pinned upstream Avarok image
      # to use your local rebuild instead, export this override for the current shell
      # or place it in .env before running docker compose.
      export VLLM_TRACK_AVAROK=avarok/vllm-dgx-spark:v11

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
   *   **Note:** `vllm-node-tf5` is not built from a repo-local Dockerfile today. If you plan to run Gemma 4 or the newer TF5-track Qwen follow-ons, build it explicitly with the upstream helper flow above. See [docs/runtime-baseline.md](docs/runtime-baseline.md) for the exact reproduction notes and build-time network requirements. Compose defaults remain digest-pinned for external pulls, so local rebuilds of the Avarok lane require `VLLM_TRACK_AVAROK=avarok/vllm-dgx-spark:v11`.

5. **Start the stack**
   ```bash
   # Start gateway and waker only (models start on-demand)
   docker compose up -d

   # Pre-create all enabled model containers once the required local track images exist
   docker compose --profile models up --no-start
   ```

6. **Test the API**
   ```bash
    # Request to the shipped utility helper
   curl -X POST http://localhost:8009/v1/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" \
     -d '{
          "model": "qwen3.5-0.8b",
       "messages": [{"role": "user", "content": "Hello!"}]
     }'
   ```

7. **Use the supported validation harness**
   After the first manual curl succeeds, switch to the repo's maintained bring-up flow instead of ad hoc scripts:
   ```bash
   bash tools/validate-stack.sh
   bash tools/smoke-gateway.sh
   ```
   For model-specific bring-up, smoke, soak, and manual probe commands, see [tools/README.md](tools/README.md).

## Start Here If You Are New

- Read [docs/architecture.md](docs/architecture.md), then [tools/README.md](tools/README.md).
- Treat [tools/README.md](tools/README.md) plus [models.json](models.json) as the current operational source of truth.
- Treat this README as the short entry point, not the full model catalog. Use [docs/models.md](docs/models.md) for the broader catalog.

## Prerequisites
- Docker 20.10+ with Docker Compose
- NVIDIA GPU(s) with CUDA support and NVIDIA Container Toolkit
- Linux host (tested on Ubuntu)

## Contributing

Pull requests very welcome. :)
However, to ensure stability, I enforce a strict **Pull Request Template**.

Maintainer note: Docker base-image digest refreshes and GitHub Action pin refreshes are gated through Renovate's Dependency Dashboard and scheduled monthly in UTC. If you want one earlier, approve that update from the GitHub Renovate Dependency Dashboard issue.

## Current Status

The README only highlights the stack's current recommended defaults.

- **Validated main models:** `gpt-oss-20b`, `gpt-oss-120b`, and `glm-4.7-flash-awq`
- **Validated utility helper:** `qwen3.5-0.8b` for titles and session metadata
- **Everything else:** available in the repo, but not a README default until it is re-validated on the current harness

For the broader model catalog, experimental lanes, and manual-only paths, use [docs/models.md](docs/models.md) and [models.json](models.json).

For client caveats, runtime quirks, and troubleshooting notes, use [docs/integrations.md](docs/integrations.md) and [docs/troubleshooting.md](docs/troubleshooting.md).

## Credits

Special thanks to the community members whose Docker images and recipe work enables this stack:

- **Thomas P. Braun from Avarok**: For the general-purpose vLLM image (`avarok/vllm-dgx-spark`) with support for non-gated activations (Nemotron) and hybrid models and posts like this https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6.
- **Christopher Owen**: For the MXFP4-optimized vLLM images initial work (`christopherowen/vllm-dgx-spark`) enabling high-performance inference on DGX Spark.
- **eugr**: For the original community DGX Spark vLLM repo (`eugr/spark-vllm-docker`), its customizations, and the great postings on NVIDIA Forums.
- **Patrick Yi / scitrera.ai**: For the SGLang utility-model recipe that informed the local `qwen3.5-0.8b` helper path.
- **Raphael Amorim**: For the community AutoRound recipe shape that informed the experimental local `qwen3.5-122b-a10b-int4-autoround` lane.
- **Bjarke Bolding**: For the long-context AutoRound recipe shape that informed the experimental local `qwen3-coder-next-int4-autoround` lane.

## License

This project is licensed under the **Apache License 2.0**. See the [LICENSE](LICENSE) file for details.
