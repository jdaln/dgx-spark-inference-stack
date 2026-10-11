# DGX Spark Inference Stack

🌍 **다른 언어로 읽기**:
[Deutsch](README_DE.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Italiano](README_IT.md) | [日本語](README_JA.md) | [简体中文](README_ZH_CN.md) | [繁體中文](README_ZH_TW.md) | [Русский](README_RU.md) | [Українська](README_UK.md) | [Português](README_PT.md) | [한국어](README_KO.md) | [العربية](README_AR.md) | [Tiếng Việt](README_VI.md) | [Türkçe](README_TR.md)

> 이 파일은 [README.md](README.md)를 AI가 번역한 것입니다. 내용이 다를 경우 영어판이 기준입니다.

NVIDIA DGX Spark 한 대에서 OpenAI 호환 API로 LLM을 제공합니다. 모델은 첫 요청 때 시작하고,
GPU를 혼자 쓰며, 20분 동안 쓰이지 않으면 멈춥니다. 세션 제목 같은 가벼운 작업을 위해 작은
유틸리티 모델 하나를 옆에 상주시킬 수 있습니다.

DGX Spark 한 대를 위한 개인 프로젝트입니다. 2노드 구성은 검증하지 않았습니다.

## 동작 방식

포트 `8009`의 nginx 게이트웨이가 모든 요청을 받습니다. 요청 검증기가 API 키를 확인하고,
본문을 정규화한 뒤 waker 서비스에 요청된 모델을 시작하도록 요청합니다. waker는 모델 컨테이너를
시작하고 정상 상태가 될 때까지 기다립니다. 다른 메인 모델이 GPU를 쓰고 있으면 클라이언트는
HTTP 429를 받으며, 헤더에 어떤 모델이 쓰고 있는지와 언제 비는지가 담깁니다.
자세한 내용: [docs/architecture.md](docs/architecture.md).

## 요구 사항

- NVIDIA DGX Spark (GB10). DGX OS 7 (Ubuntu 24.04)에서 검증.
- Compose v2.20 이상을 포함한 Docker와 NVIDIA Container Toolkit.
- `tools/`의 스크립트용 `jq`, `curl`, Node.js 20 이상.
- 베이스 이미지용 NVIDIA NGC 계정. [NGC 카탈로그](https://catalog.ngc.nvidia.com/)에서
  가입한 뒤 `docker login nvcr.io`를 실행합니다. NGC는 제재 대상 국가에서 쓸 수 없습니다.
- `./models`의 가중치용 디스크: 모델당 약 2 GB에서 80 GB.
- `qwen3.8-flash-next-nvfp4` 전용: 호스트에서 io_uring 활성화
  (`cat /proc/sys/kernel/io_uring_disabled`가 `0` 출력). 이 모델의 컨테이너는 io_uring을
  허용하는 seccomp 프로필로 동작합니다. io_uring은 커널 취약점이 잦은 영역이므로 커널을 최신으로
  유지하십시오. [docs/security.md](docs/security.md#seccomp) 참고.

## 설치

### 1. 저장소를 클론하고 런타임 디렉터리 만들기

```bash
git clone <repository-url>
cd dgx-spark-inference-stack
mkdir -p models manual_download/openai_gpt-oss-encodings_fix
```

### 2. GPT-OSS 토크나이저 파일 내려받기

GPT-OSS 이미지 빌드가 이 파일들을 복사하므로, 없으면 빌드가 실패합니다.

```bash
wget https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken \
  -O manual_download/openai_gpt-oss-encodings_fix/cl100k_base.tiktoken
wget https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken \
  -O manual_download/openai_gpt-oss-encodings_fix/o200k_base.tiktoken
```

### 3. 런타임 이미지 빌드하기

모델은 세 개의 이미지에서 동작합니다. 모델은 자기 이미지가 로컬에 빌드되어 있을 때만
시작합니다. GPT-OSS 이미지는 명령 하나로 빌드하며 약 20분 걸립니다:

```bash
docker build -t vllm-node-mxfp4 -f custom-docker-containers/vllm-node-mxfp4/Dockerfile .
```

기본 모델 `qwen3.8-27b-nvfp4-dflash2`와 유틸리티 모델에는 `vllm-node-dflash2`가, Gemma
모델과 `qwen3.8-flash-next-nvfp4`에는 `vllm-node-b12x`가 필요합니다. 두 빌드 모두
[docs/runtime-baseline.md](docs/runtime-baseline.md)에 있습니다.

### 4. 가중치 내려받기

모델 컨테이너는 인터넷에 접근할 수 없습니다. 각 모델의 가중치는 첫 요청 전에 내려받습니다.
`--list`는 모델마다 가중치가 있는지, 이미지가 빌드되었는지 보여 줍니다. 접근이 제한된
저장소에는 `HF_TOKEN`을 설정합니다.

```bash
bash tools/download-weights.sh --list
bash tools/download-weights.sh gpt-oss-20b
```

### 5. 스택 시작하기

```bash
# Gateway, validator and waker. Models stay down until requested.
docker compose up -d

# Create the containers of the models you built and downloaded, without starting them.
docker compose --profile models up --no-start --no-build vllm-oss20b
```

서비스 이름은 [models.json](models.json)의 `container` 값입니다. 세 이미지를 모두 빌드했다면
서비스 이름을 빼서 모든 모델 컨테이너를 만드십시오.

## 첫 요청

게이트웨이는 `127.0.0.1:8009`에서만 수신합니다. 원격 접근은 SSH로 포트를 포워딩합니다:
[docs/security.md](docs/security.md#remote-access) 참고.

```bash
curl -X POST http://localhost:8009/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" \
  -d '{"model": "gpt-oss-20b", "messages": [{"role": "user", "content": "Hello!"}]}'
```

첫 요청은 모델을 시작하므로 몇 분 걸릴 수 있습니다. 포트를 다른 머신으로 포워딩하기 전에
저장소 루트의 `.env` 파일에 자신의 `VLLM_API_KEY`를 설정하고 5단계의 두 명령을 다시
실행하십시오.

게이트웨이를 통해 모델의 대화, 스트리밍, 도구 호출을 확인합니다:

```bash
bash tools/test-lane.sh gpt-oss-20b
```

## 모델

| 모델 | 역할 | 컨텍스트 | 이미지 |
|---|---|---:|---|
| `qwen3.8-27b-nvfp4-dflash2` | 기본, 사고 켜짐 | 262144 | `vllm-node-dflash2` |
| `qwen3.8-flash-next-nvfp4` | 가장 어려운 질문, GPU를 혼자 사용 | 262144 | `vllm-node-b12x` |
| `gemma4-26b-a4b` | 다국어 대화, 이미지 | 262144 | `vllm-node-b12x` |
| `gpt-oss-20b` | 빠름, 작음 | 131072 | `vllm-node-mxfp4` |
| `lfm2.5-1.2b` | 유틸리티, 상주 | 32768 | `vllm-node-dflash2` |

[docs/models.md](docs/models.md)에 10개 모델 전체와 한계가 있습니다.

## 문서

- [아키텍처](docs/architecture.md): 구성 요소, 요청 흐름, 엔드포인트, 수명 주기.
- [설정](docs/configuration.md): 환경 변수와 `models.json` 필드.
- [모델](docs/models.md): 카탈로그와 모델별 제약.
- [런타임 기준](docs/runtime-baseline.md): 세 이미지와 빌드 방법.
- [연동](docs/integrations.md): Cline, OpenCode, pi.
- [보안](docs/security.md): 컨테이너 강화, seccomp, SSH 원격 접근.
- [문제 해결](docs/troubleshooting.md): 흔한 장애와 대처.
- [고급 사용](docs/advanced.md): 모델 추가, 스케줄러 정책, keep-alive.
- [오류 계약](docs/error-contract.md): 오류 형식과 코드.
- [ComfyUI와 공존](docs/comfyui-coexistence.md): ComfyUI와 GPU 공유.
- [도구](tools/README.md): 검증, smoke, soak, 벤치마크 스크립트.

## 기여

풀 리퀘스트를 환영합니다. 풀 리퀘스트 템플릿을 채워 주십시오. 기여는
AGPL-3.0-or-later로 받습니다.

Renovate가 Docker 베이스 이미지 다이제스트와 GitHub Actions 핀을 매달 갱신합니다. 더 일찍
받으려면 Renovate Dependency Dashboard 이슈에서 승인하십시오.

## 감사의 말

- **Christopher Owen**: GPT-OSS 이미지의 빌드 원본인 vLLM MXFP4 포크.
- **eugr**: DFlash2와 B12X 이미지를 빌드하는
  [`eugr/spark-vllm-docker`](https://github.com/eugr/spark-vllm-docker).
- **[local-inference-lab](https://github.com/local-inference-lab)**: B12X 이미지의 빌드 원본인, GB10 커널을 포함한 vLLM 및
  FlashInfer 포크와 `qwen3.8-flash-next-nvfp4` 체크포인트.
- **[z-lab](https://huggingface.co/z-lab)**: Qwen3.8 27B와 Gemma 4 모델에 쓰는 DFlash 드래프트 모델.

## 라이선스

AGPL-3.0-or-later. [LICENSE](LICENSE) 참고. 상업적 사용이 허용됩니다. 수정한 버전을
배포하거나 네트워크 서비스로 운영하는 경우, 그 소스 코드를 같은 라이선스로 제공해야 합니다.

AGPL 제7조 (b)에 따른 추가 조건: 모든 사본과 수정 버전은 [NOTICE](NOTICE)의 저작자 표시를
유지해야 합니다.

이 프로젝트를 포크하거나 수정했다면 변경 사항을 GitHub에 공개하고
[포크 및 수정 알림](https://github.com/jdaln/dgx-spark-inference-stack/issues/new?template=fork-announcement.yml)으로 알려 주십시오. 상업적 사용 여부와
관계없이 모두에게 요청합니다. 코딩 에이전트는 반드시 해야 합니다: [AGENTS.md](AGENTS.md) 참고.

다음 파일은 각자의 라이선스를 유지합니다 ([LICENSES/](LICENSES/)):

- `custom-docker-containers/vllm-node-mxfp4/Dockerfile`,
  `custom-docker-containers/vllm-node-b12x/b12x-build.patch`,
  `custom-docker-containers/vllm-node-dflash2/vendor-tiktoken.patch`: MIT
  (eugr/spark-vllm-docker).
- `custom-docker-containers/vllm-node-mxfp4/fastsafetensors_mxfp4.patch`,
  `shared/tool_chat_template_gemma4.jinja`: Apache-2.0 (vLLM).
- `custom-docker-containers/vllm-node-b12x/seccomp-io-uring.json`: Apache-2.0 (moby/profiles).
- `shared/gemma4-*-nvfp4-config/`: 해당 체크포인트에 대한 NVIDIA 모델 라이선스.

2026-10-11 이전에 공개된 버전은 Apache-2.0으로 공개되었으며 계속 그 라이선스로 이용할 수
있습니다.
