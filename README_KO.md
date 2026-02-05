# DGX Spark Inference Stack - 가정을 위한 서비스!

> **면책 조항:** 이 문서는 AI에 의해 번역되었으며 오류가 포함될 수 있습니다.

NVIDIA vLLM과 지능형 리소스 관리를 사용하여 대규모 언어 모델(LLM)을 제공하기 위한 Docker 기반 추론 스택입니다. 이 스택은 유휴 시 자동 종료를 통한 온디맨드 모델 로딩, 단일 테넌트 GPU 스케줄링 및 통합 API 게이트웨이를 제공합니다.

이 프로젝트의 목표는 가정을 위한 추론 서버를 제공하는 것입니다. 한 달 동안 이것을 테스트하고 새 모델을 추가한 후, 커뮤니티에 공개하기로 결정했습니다. 이것은 취미 프로젝트이며 개선을 위한 구체적인 도움은 매우 환영한다는 점을 이해해 주십시오. 이것은 인터넷과 NVIDIA 포럼에서 찾은 정보를 기반으로 하며, 홈랩을 발전시키는 데 도움이 되기를 진심으로 바랍니다. 이것은 주로 단일 DGX Spark 설정에 중점을 두고 있으며 기본적으로 작동해야 하지만 2개에 대한 지원 추가는 환영합니다.

## 문서

- **[아키텍처 및 작동 방식](docs/architecture.md)** - 스택, waker 서비스 및 요청 흐름 이해.
- **[구성](docs/configuration.md)** - 환경 변수, 네트워크 설정 및 waker 튜닝.
- **[모델 선택 가이드](docs/models.md)** - 29개 이상의 지원 모델에 대한 상세 목록, 빠른 선택기 및 사용 사례.
- **[통합](docs/integrations.md)** - **Cline** (VS Code) 및 **OpenCode** (터미널 에이전트) 가이드.
- **[보안 및 원격 액세스](docs/security.md)** - SSH 강화 및 제한된 포트 포워딩 설정.
- **[문제 해결 및 모니터링](docs/troubleshooting.md)** - 디버깅, 로그 및 일반적인 오류 솔루션.
- **[고급 사용법](docs/advanced.md)** - 새 모델 추가, 사용자 지정 구성 및 지속적인 운영.
- **[TODO 노트](TODO.md)** - 다음에 무엇을 할지에 대한 아이디어.

## 빠른 시작

1. **리포지토리 복제**
   ```bash
   git clone <repository-url>
   cd dgx-spark-inference-stack
   ```

2. **필요한 디렉토리 생성**
   ```bash
   mkdir -p models vllm_cache_huggingface manual_download/openai_gpt-oss-encodings_fix
   ```

3. **필수 토크나이저 다운로드 (중요)**
   이 스택은 GPT-OSS 모델을 위한 tiktoken 파일의 수동 다운로드가 필요합니다.
   ```bash
   wget https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/cl100k_base.tiktoken
   wget https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/o200k_base.tiktoken
   ```

4. **사용자 지정 Docker 이미지 빌드 (필수)**
   이 스택은 최대 성능을 보장하기 위해 로컬에서 빌드해야 하는 사용자 지정 최적화된 vLLM 이미지를 사용합니다.
   *   **시간:** 이미지당 약 20분 예상.
   *   **인증:** 기본 이미지를 가져오려면 NVIDIA NGC에 인증해야 합니다.
       1.  [NVIDIA NGC Catalog](https://catalog.ngc.nvidia.com/)에서 개발자 계정을 생성합니다(제재 대상 국가에 잇어서는 안 됨).
       2.  자격 증명으로 `docker login nvcr.io`를 실행합니다.
   *   **빌드 명령:**
       ```bash
       # Avarok 이미지 빌드 (범용) - 업스트림 대신 로컬 버전을 사용하려면 이 태그를 사용해야 함
       docker build -t avarok/vllm-dgx-spark:v11 custom-docker-containers/avarok

       # Christopher Owen 이미지 빌드 (MXFP4 최적화)
       docker build -t christopherowen/vllm-dgx-spark:v12 custom-docker-containers/christopherowen
       ```

5. **스택 시작**
   ```bash
   # 게이트웨이 및 waker만 시작 (모델은 온디맨드로 시작)
   docker compose up -d

   # 모든 활성화된 모델 컨테이너 미리 생성 (권장)
   docker compose --profile models up --no-start
   ```

6. **API 테스트**
   ```bash
   # qwen2.5-1.5b에 요청 (자동으로 시작됨)
   curl -X POST http://localhost:8009/v1/qwen2.5-1.5b-instruct/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" \
     -d '{
       "model": "qwen2.5-1.5b-instruct",
       "messages": [{"role": "user", "content": "안녕하세요!"}]
     }'
   ```

## 전제 조건
- Docker Compose가 포함된 Docker 20.10+
- CUDA 지원 및 NVIDIA Container Toolkit이 있는 NVIDIA GPU(들)
- Linux 호스트 (Ubuntu에서 테스트됨)

## 기여

Pull Requests는 매우 환영합니다. :)
그러나 안정성을 보장하기 위해 엄격한 **Pull Request 템플릿**을 적용합니다.

## ⚠️ 알려진 문제

### 실험적 모델 (GB10/CUDA 12.1 호환성)

다음 모델은 DGX Spark(GB10 GPU)에서 산발적인 충돌로 인해 **실험적**으로 표시됩니다:

- **Qwen3-Next-80B-A3B-Instruct** - 선형 주의 계층에서 무작위로 충돌
- **Qwen3-Next-80B-A3B-Thinking** - 동일한 문제

**근본 원인:** GB10 GPU는 CUDA 12.1을 사용하지만 현재 vLLM/PyTorch 스택은 CUDA ≤12.0만 지원합니다. 이로 인해 여러 번의 성공적인 요청 후 `cudaErrorIllegalInstruction` 오류가 발생합니다.

**해결 방법:** 적절한 GB10 지원이 포함된 업데이트된 vLLM 이미지를 사용할 수 있을 때까지 안정적인 도구 호출을 위해 `gpt-oss-20b` 또는 `gpt-oss-120b`를 사용하십시오.

### Nemotron 3 Nano 30B (NVFP4)

**`nemotron-3-nano-30b-nvfp4`** 모델은 현재 비활성화되어 있습니다.
**이유:** GB10의 현재 vLLM 빌드와 호환되지 않습니다. 적절한 V1 엔진 지원 또는 업데이트된 백엔드 구현이 필요합니다.


### Linux에서의 OpenCode 이미지/스크린샷 지원

OpenCode(터미널 AI 에이전트)에는 **클립보드 이미지 및 파일 경로 이미지가 비전 모델에서 작동하지 않는** Linux상의 알려진 버그가 있습니다. VL 모델이 API를 통해 올바르게 작동하더라도 모델은 "The model you're using does not support image input"라고 응답합니다.

**근본 원인:** OpenCode의 Linux 클립보드 처리는 인코딩 전에 바이너리 이미지 데이터를 손상시킵니다(`.arrayBuffer()` 대신 `.text()` 사용). 실제 이미지 데이터가 서버로 전송되지 않습니다.

**상태:** 이것은 클라이언트 측 OpenCode 버그인 것 같습니다. 조사/수정에 대한 도움을 환영합니다! 추론 스택은 적절하게 전송될 때 base64 이미지를 올바르게 처리합니다(curl을 통해 확인됨).

**해결 방법:** curl 또는 다른 API 클라이언트를 사용하여 이미지를 `qwen2.5-vl-7b`와 같은 VL 모델로 직접 전송하십시오.

### Qwen 2.5 Coder 7B 및 OpenCode 비호환성

`qwen2.5-coder-7b-instruct` 모델에는 **32,768 토큰**의 엄격한 컨텍스트 제한이 있습니다. 그러나 OpenCode는 일반적으로 **35,000 토큰**을 초과하는 매우 큰 요청(버퍼 + 입력)을 전송하여 `ValueError` 및 요청 실패를 유발합니다.

**권장 사항:** 긴 컨텍스트 작업에는 OpenCode와 함께 `qwen2.5-coder-7b`를 사용하지 마십시오. 대신 **65,536 토큰** 컨텍스트를 지원하고 OpenCode의 대규모 요청을 편안하게 처리하는 **`qwen3-coder-30b-instruct`**를 사용하십시오.

### Llama 3.3 및 OpenCode 비호환성

**`llama-3.3-70b-instruct-fp4`** 모델은 **OpenCode 사용이 권장되지 않습니다**.
**이유:** 모델은 API를 통해 올바르게 작동하지만 OpenCode의 특정 클라이언트 프롬프트에 의해 초기화될 때 공격적인 도구 호출 동작을 보입니다. 이는 유효성 검사 오류 및 사용자 경험 저하(예: 인사 직후 도구 호출 시도)로 이어집니다.
**권장 사항:** 대신 OpenCode 세션에 `gpt-oss-20b` 또는 `qwen3-next-80b-a3b-instruct`를 사용하십시오.

## 크레딧

이 스택에 사용된 최적화된 Docker 이미지를 만든 커뮤니티 회원들에게 특별히 감사드립니다:

- **Avarok의 Thomas P. Braun**: 비 게이트 활성화(Nemotron) 및 하이브리드 모델을 지원하는 범용 vLLM 이미지(`avarok/vllm-dgx-spark`)와 https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6 와 같은 게시물에 대해 감사드립니다.
- **Christopher Owen**: DGX Spark에서 고성능 추론을 가능하게 하는 MXFP4 최적화 vLLM 이미지(`christopherowen/vllm-dgx-spark`)에 대해 감사드립니다.
- **eugr**: 원본 vLLM 이미지(`eugr/vllm-dgx-spark`) 사용자 정의에 대한 모든 작업과 NVIDIA 포럼의 훌륭한 게시물에 대해 감사드립니다.

### 모델 제공자

FP4/FP8 추론을 위해 이러한 모델을 최적화하는 조직에 깊이 감사드립니다:

- **Fireworks AI** (`Firworks`): GLM-4.5, Llama 3.3 및 Ministral을 포함한 다양한 최적화된 모델.
- **NVIDIA**: Qwen3-Next, Nemotron 및 표준 FP4 구현.
- **RedHat**: Qwen3-VL 및 Mistral Small.
- **QuantTrio**: Qwen3-VL-Thinking.
- **OpenAI**: GPT-OSS 모델.

## 라이선스

이 프로젝트는 **Apache License 2.0**에 따라 라이선스가 부여됩니다. 자세한 내용은 [LICENSE](LICENSE) 파일을 참조하십시오.
