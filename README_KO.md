# DGX Spark Inference Stack - 집에서 제대로 돌리세요!

🌍 **다른 언어로 읽기**:
[Deutsch](README_DE.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Italiano](README_IT.md) | [日本語](README_JA.md) | [简体中文](README_ZH_CN.md) | [繁體中文](README_ZH_TW.md) | [Русский](README_RU.md) | [Українська](README_UK.md) | [Português](README_PT.md) | [한국어](README_KO.md) | [العربية](README_AR.md) | [Tiếng Việt](README_VI.md) | [Türkçe](README_TR.md)

> **AI 번역 안내:** 이 파일은 [README.md](README.md)를 기준으로 AI가 번역했습니다. 오류가 있을 수 있고 영어 원문보다 업데이트가 늦을 수 있습니다. 애매한 경우 영어 README를 기준으로 보세요.

당신의 Nvidia DGX Spark는 또 하나의 사이드 프로젝트로 남아 있으면 안 됩니다. 실제로 써야 합니다. 이것은 NVIDIA vLLM과 지능형 리소스 관리를 사용해 대형 언어 모델(LLM)을 서빙하기 위한 Docker 기반 추론 스택입니다. 이 스택은 유휴 시 자동 종료되는 온디맨드 모델 로딩, 선택적인 유틸리티 헬퍼를 곁들인 단일 메인 모델 스케줄링 레인, 그리고 통합 API 게이트웨이를 제공합니다.

이 프로젝트의 목표는 가정용 추론 서버를 제공하는 것입니다. 한 달 정도 테스트하고 새로운 모델을 추가한 뒤 커뮤니티에 공개하기로 했습니다. 이 프로젝트는 취미 프로젝트이므로, 개선을 위한 구체적인 도움은 매우 환영합니다. 인터넷과 NVIDIA 포럼에서 찾은 정보를 바탕으로 만들었고, 홈랩 환경을 조금이라도 더 앞으로 밀어주길 바랍니다. 주 대상은 단일 DGX Spark 구성이고 기본적으로 거기서 잘 동작해야 하지만, 2대 구성 지원도 환영합니다.

## 문서

- **[아키텍처와 동작 방식](docs/architecture.md)** - 스택, waker 서비스, 요청 흐름 이해하기.
- **[설정](docs/configuration.md)** - 환경 변수, 네트워크 설정, waker 튜닝.
- **[모델 선택 가이드](docs/models.md)** - 29개 이상의 지원 모델, 빠른 선택 가이드, 사용 사례 상세 설명.
- **[통합](docs/integrations.md)** - **Cline**(VS Code)과 **OpenCode**(터미널 에이전트) 가이드.
- **[보안 및 원격 접근](docs/security.md)** - SSH 하드닝과 제한된 포트 포워딩 설정.
- **[문제 해결 및 모니터링](docs/troubleshooting.md)** - 디버깅, 로그, 자주 발생하는 오류 해결법.
- **[고급 사용법](docs/advanced.md)** - 새 모델 추가, 사용자 정의 설정, 상시 운영.
- **[런타임 기준선](docs/runtime-baseline.md)** - 저장소가 기대하는 로컬 이미지 트랙과 재빌드 방법.
- **[도구와 검증 하네스](tools/README.md)** - 지원되는 smoke, soak, inspection, 수동 probe 스크립트.
- **[TODO 메모](TODO.md)** - 다음에 하고 싶은 일들.

## 빠른 시작

1. **저장소 클론**
   ```bash
   git clone <repository-url>
   cd dgx-spark-inference-stack
   ```

2. **필요한 디렉터리 생성**
   ```bash
   mkdir -p models vllm_cache_huggingface manual_download/openai_gpt-oss-encodings_fix
   ```

3. **필수 토크나이저 다운로드 (중요)**
   이 스택은 GPT-OSS 모델용 `tiktoken` 파일을 수동으로 내려받아야 합니다.
   ```bash
   wget https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/cl100k_base.tiktoken
   wget https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/o200k_base.tiktoken
   ```

4. **커스텀 Docker 이미지 빌드 (필수)**
   이 스택은 최적화된 vLLM 이미지를 사용하므로 최대 성능을 위해 로컬에서 빌드해야 합니다.
   *   **시간:** 이미지당 약 20분 정도를 예상하세요.
   *   **인증:** 베이스 이미지를 pull 하려면 NVIDIA NGC 인증이 필요합니다.
       1.  [NVIDIA NGC Catalog](https://catalog.ngc.nvidia.com/)에서 개발자 계정을 만드세요(제재 대상 국가는 불가).
       2.  자격 증명으로 `docker login nvcr.io`를 실행하세요.
   *   **빌드 명령:**
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
   *   **참고:** `vllm-node-tf5`는 현재 저장소 내부 Dockerfile로 빌드되지 않습니다. Gemma 4나 최신 TF5 계열 Qwen 모델을 돌릴 계획이라면 위의 upstream helper 흐름으로 명시적으로 빌드하세요. 정확한 재현 절차와 빌드 시 네트워크 요구사항은 [docs/runtime-baseline.md](docs/runtime-baseline.md)를 보세요.

5. **스택 시작**
   ```bash
   # Start gateway and waker only (models start on-demand)
   docker compose up -d

   # Pre-create all enabled model containers once the required local track images exist
   docker compose --profile models up --no-start
   ```

6. **API 테스트**
   ```bash
    # Request to the shipped utility helper
    curl -X POST http://localhost:8009/v1/qwen3.5-0.8b/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" \
     -d '{
          "model": "qwen3.5-0.8b",
       "messages": [{"role": "user", "content": "안녕하세요!"}]
     }'
   ```

7. **지원되는 검증 하네스 사용**
   첫 수동 `curl`이 성공하면, 임시 스크립트 대신 저장소에서 관리하는 bring-up 흐름으로 전환하세요.
   ```bash
   bash tools/validate-stack.sh
   bash tools/smoke-gateway.sh
   ```
   모델별 bring-up, smoke, soak, 수동 probe 명령은 [tools/README.md](tools/README.md)를 참고하세요.

## 처음이라면 여기부터

- 먼저 [README.md](README.md), 그다음 [docs/architecture.md](docs/architecture.md), 그다음 [tools/README.md](tools/README.md)를 읽으세요.
- [tools/README.md](tools/README.md)와 [models.json](models.json)을 현재 운영 기준의 사실 소스로 보세요.
- 이 README에서 검증된 집합 밖의 모델은 하네스가 다시 확인해 줄 때까지 실험적으로 취급하세요.

## 요구 사항
- Docker 20.10+ 및 Docker Compose
- CUDA 지원 NVIDIA GPU 및 NVIDIA Container Toolkit
- Linux 호스트(Ubuntu에서 테스트)

## 기여

Pull request는 매우 환영합니다. :)
다만 안정성을 위해 **엄격한 Pull Request Template**을 적용합니다.

## ⚠️ 알려진 이슈

### 현재 검증 상태

현재 하네스와 저장소 기본값 기준으로 지금 **검증된 메인 모델**은 다음뿐입니다.

- **`gpt-oss-20b`**
- **`gpt-oss-120b`**
- **`glm-4.7-flash-awq`**

함께 제공되는 소형 헬퍼 `qwen3.5-0.8b`는 이제 제목과 세션 메타데이터용 **검증된 유틸리티 헬퍼**이지만, 이 검증된 메인 모델 집합에는 포함되지 않습니다.

다른 모델도 동작할 수는 있지만, 이 검증된 유틸리티 헬퍼를 제외하면 현재 도구 체계로 다시 검증되기 전까지는 권장 기본값이 아니라 **실험적** 으로 취급해야 합니다.

### 실험적 모델 (GB10 / CUDA 12.1 호환성)

다음 모델은 DGX Spark(GB10 GPU)에서 간헐적으로 크래시가 발생하므로 **실험적** 으로 표시됩니다.

- **Qwen3-Next-80B-A3B-Instruct** - 선형 어텐션 레이어에서 무작위로 크래시 발생
- **Qwen3-Next-80B-A3B-Thinking** - 동일한 문제

**근본 원인:** GB10 GPU는 CUDA 12.1을 사용하지만 현재 vLLM/PyTorch 스택은 CUDA ≤12.0만 지원합니다. 그래서 여러 번 성공한 뒤 `cudaErrorIllegalInstruction` 오류가 발생합니다.

**우회 방법:** GB10을 제대로 지원하는 업데이트된 vLLM 이미지가 나오기 전까지는 안정적인 tool calling 용도로 `gpt-oss-20b` 또는 `gpt-oss-120b`를 사용하세요.

### Nemotron 3 Nano 30B (NVFP4)

**`nemotron-3-nano-30b-nvfp4`** 모델은 갱신된 `vllm-node` 표준 트랙에서 다시 활성화되었지만, 현재 하네스 기준으로는 여전히 **실험적**으로 취급해야 합니다.
**현재 상태:** 새 런타임에서는 로드와 응답이 가능하지만, 검증된 메인 모델 집합이나 기본 OpenCode 설정에는 아직 포함되지 않습니다.
**중요한 동작:** 사용자에게 보이는 assistant content는 non-thinking 요청 형태에 따라 달라집니다. 요청 검증기가 일반 게이트웨이 요청에 그 기본값을 주입합니다.
**현재 보수적 클라이언트 한도:** OpenCode/Cline 스타일 수동 사용 기준으로 prompt token 약 `100000`. 스택의 5-way soak는 prompt token 약 `101776`에서 깔끔하게 통과하며, 약 `116298` 부근에서는 이미 한계에 가깝습니다.

### Linux에서의 OpenCode 이미지/스크린샷 지원

OpenCode(터미널 AI 에이전트)에는 Linux에서 **클립보드 이미지와 파일 경로 이미지가 비전 모델과 함께 동작하지 않는** 알려진 버그가 있습니다. VL 모델은 API로는 정상 동작하지만, 모델은 "The model you're using does not support image input"라고 응답합니다.

**근본 원인:** OpenCode의 Linux 클립보드 처리 과정이 인코딩 전에 이미지 바이너리를 망가뜨립니다(`.arrayBuffer()` 대신 `.text()` 사용). 실제로는 이미지 데이터가 서버에 전송되지 않습니다.

**상태:** OpenCode 클라이언트 측 버그로 보입니다. 조사나 수정에 대한 도움은 환영합니다. 추론 스택 자체는 `curl`이나 다른 API 클라이언트로 올바르게 전송된 base64 이미지를 정상 처리합니다.

**우회 방법:** `curl` 또는 다른 API 클라이언트를 사용해 `qwen2.5-vl-7b` 같은 VL 모델로 이미지를 직접 보내세요.

### Qwen 2.5 Coder 7B와 OpenCode 비호환

`qwen2.5-coder-7b-instruct` 모델은 **32,768 token**의 엄격한 컨텍스트 제한이 있습니다. 그런데 OpenCode는 보통 버퍼 + 입력을 합쳐 **35,000 token**이 넘는 큰 요청을 보내기 때문에 `ValueError`와 요청 실패가 발생합니다.

**권장 사항:** 긴 컨텍스트 작업에서 `qwen2.5-coder-7b`를 OpenCode와 함께 쓰지 마세요. 대신 **`qwen3-coder-30b-instruct`** 를 사용하세요. 이 모델은 **65,536 token** 컨텍스트를 지원하고 OpenCode의 큰 요청을 훨씬 여유 있게 처리합니다.

### Llama 3.3와 OpenCode 비호환

**`llama-3.3-70b-instruct-fp4`** 는 **OpenCode에 권장되지 않습니다**.
**이유:** API로는 정상 동작하지만, OpenCode 고유의 클라이언트 프롬프트로 초기화되면 tool calling 성향이 지나치게 공격적으로 나타납니다. 그 결과 인사 직후 도구를 호출하려 하는 식의 검증 오류와 사용자 경험 저하가 생깁니다.
**권장 사항:** OpenCode 세션에는 `gpt-oss-20b` 또는 `qwen3-next-80b-a3b-instruct`를 사용하세요.

## 크레딧

이 스택에서 사용하는 최적화된 Docker 이미지를 가능하게 해 준 커뮤니티 구성원들에게 특별히 감사드립니다.

- **Avarok의 Thomas P. Braun**: non-gated activation(Nemotron), 하이브리드 모델 지원을 포함한 범용 vLLM 이미지 `avarok/vllm-dgx-spark` 와 https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6 같은 글.
- **Christopher Owen**: DGX Spark에서 고성능 추론을 가능하게 하는 MXFP4 최적화 vLLM 이미지 `christopherowen/vllm-dgx-spark`.
- **eugr**: 원본 vLLM 이미지 `eugr/vllm-dgx-spark` 에 대한 각종 커스터마이징 작업과 NVIDIA 포럼에서의 훌륭한 공유.
- **Patrick Yi / scitrera.ai**: 로컬 `qwen3.5-0.8b` helper 경로에 영향을 준 SGLang 유틸리티 모델 레시피.

## 라이선스

이 프로젝트는 **Apache License 2.0** 라이선스를 따릅니다. 자세한 내용은 [LICENSE](LICENSE)를 참고하세요.
