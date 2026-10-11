# DGX Spark Inference Stack

🌍 **Lies dies in anderen Sprachen**:
[Deutsch](README_DE.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Italiano](README_IT.md) | [日本語](README_JA.md) | [简体中文](README_ZH_CN.md) | [繁體中文](README_ZH_TW.md) | [Русский](README_RU.md) | [Українська](README_UK.md) | [Português](README_PT.md) | [한국어](README_KO.md) | [العربية](README_AR.md) | [Tiếng Việt](README_VI.md) | [Türkçe](README_TR.md)

> Diese Datei wurde von einer KI aus [README.md](README.md) übersetzt. Im Zweifel gilt die englische Fassung.

Stellt LLMs von einem NVIDIA DGX Spark über eine OpenAI-kompatible API bereit. Ein Modell
startet bei der ersten Anfrage, belegt die GPU allein und stoppt nach 20 Minuten ohne
Nutzung. Ein kleines Hilfsmodell darf daneben geladen bleiben, etwa für Sitzungstitel.

Ein Hobbyprojekt für einen einzelnen DGX Spark. Setups mit zwei Geräten sind ungetestet.

## Funktionsweise

Ein nginx-Gateway auf Port `8009` nimmt jede Anfrage an. Ein Request-Validator prüft den
API-Key, normalisiert den Body und bittet den Waker-Dienst, das angefragte Modell zu
starten. Der Waker startet den Modellcontainer und wartet, bis er gesund ist. Belegt ein
anderes Hauptmodell die GPU, bekommt der Client HTTP 429 mit Headern, die sagen, welches
Modell es ist und wann die GPU frei wird. Details: [docs/architecture.md](docs/architecture.md).

## Voraussetzungen

- NVIDIA DGX Spark (GB10). Getestet unter DGX OS 7 (Ubuntu 24.04).
- Docker mit Compose v2.20 oder neuer und dem NVIDIA Container Toolkit.
- `jq`, `curl` und Node.js 20 oder neuer für die Skripte in `tools/`.
- Ein NVIDIA-NGC-Konto für die Basis-Images. Registriere dich im
  [NGC-Katalog](https://catalog.ngc.nvidia.com/) und führe dann `docker login nvcr.io` aus.
  NGC ist in sanktionierten Ländern nicht verfügbar.
- Speicherplatz für Gewichte unter `./models`: etwa 2 GB bis 80 GB pro Modell.
- Nur für `qwen3.8-flash-next-nvfp4`: io_uring auf dem Host aktiviert
  (`cat /proc/sys/kernel/io_uring_disabled` gibt `0` aus). Der Container des Modells läuft
  mit einem seccomp-Profil, das io_uring erlaubt. Halte den Kernel aktuell: io_uring ist eine
  häufige Quelle von Kernel-Exploits. Siehe [docs/security.md](docs/security.md#seccomp).

## Installation

### 1. Repository klonen und Laufzeitverzeichnisse anlegen

```bash
git clone <repository-url>
cd dgx-spark-inference-stack
mkdir -p models manual_download/openai_gpt-oss-encodings_fix
```

### 2. GPT-OSS-Tokenizer-Dateien herunterladen

Der Build des GPT-OSS-Images kopiert sie hinein und scheitert ohne sie.

```bash
wget https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken \
  -O manual_download/openai_gpt-oss-encodings_fix/cl100k_base.tiktoken
wget https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken \
  -O manual_download/openai_gpt-oss-encodings_fix/o200k_base.tiktoken
```

### 3. Ein Laufzeit-Image bauen

Die Modelle laufen auf drei Images. Ein Modell startet nur, wenn sein Image lokal gebaut
ist. Das GPT-OSS-Image ist ein Befehl und dauert etwa 20 Minuten:

```bash
docker build -t vllm-node-mxfp4 -f custom-docker-containers/vllm-node-mxfp4/Dockerfile .
```

Das Standardmodell `qwen3.8-27b-nvfp4-dflash2` und das Hilfsmodell brauchen
`vllm-node-dflash2`; die Gemma-Modelle und `qwen3.8-flash-next-nvfp4` brauchen
`vllm-node-b12x`. Beide Builds stehen in [docs/runtime-baseline.md](docs/runtime-baseline.md).

### 4. Gewichte herunterladen

Modellcontainer haben keinen Internetzugang. Lade die Gewichte eines Modells vor seiner
ersten Anfrage herunter. `--list` zeigt jedes Modell, ob seine Gewichte vorhanden sind und
ob sein Image gebaut ist. Setze `HF_TOKEN` für zugangsbeschränkte Repositories.

```bash
bash tools/download-weights.sh --list
bash tools/download-weights.sh gpt-oss-20b
```

### 5. Stack starten

```bash
# Gateway, validator and waker. Models stay down until requested.
docker compose up -d

# Create the containers of the models you built and downloaded, without starting them.
docker compose --profile models up --no-start --no-build vllm-oss20b
```

Die Dienstnamen sind die `container`-Werte in [models.json](models.json). Sind alle drei
Images gebaut, lass den Dienstnamen weg, um jeden Modellcontainer anzulegen.

## Erste Anfrage

Das Gateway lauscht nur auf `127.0.0.1:8009`. Für Fernzugriff leite den Port über SSH weiter:
siehe [docs/security.md](docs/security.md#remote-access).

```bash
curl -X POST http://localhost:8009/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" \
  -d '{"model": "gpt-oss-20b", "messages": [{"role": "user", "content": "Hello!"}]}'
```

Die erste Anfrage startet das Modell und kann mehrere Minuten dauern. Bevor du den Port an
andere Rechner weiterleitest, setze einen eigenen `VLLM_API_KEY` in einer `.env`-Datei im
Repo-Wurzelverzeichnis und führe beide Befehle aus Schritt 5 erneut aus.

Prüfe Chat, Streaming und Tool-Aufrufe eines Modells über das Gateway:

```bash
bash tools/test-lane.sh gpt-oss-20b
```

## Modelle

| Modell | Rolle | Kontext | Image |
|---|---|---:|---|
| `qwen3.8-27b-nvfp4-dflash2` | Standard, Thinking an | 262144 | `vllm-node-dflash2` |
| `qwen3.8-flash-next-nvfp4` | schwierigste Fragen, belegt die GPU allein | 262144 | `vllm-node-b12x` |
| `gemma4-26b-a4b` | mehrsprachiger Chat, Bilder | 262144 | `vllm-node-b12x` |
| `gpt-oss-20b` | schnell, kleiner | 131072 | `vllm-node-mxfp4` |
| `lfm2.5-1.2b` | Hilfsmodell, bleibt geladen | 32768 | `vllm-node-dflash2` |

[docs/models.md](docs/models.md) listet alle 10 Modelle und ihre Grenzen.

## Dokumentation

- [Architektur](docs/architecture.md): Komponenten, Request-Flow, Endpunkte, Lebenszyklus.
- [Konfiguration](docs/configuration.md): Umgebungsvariablen und `models.json`-Felder.
- [Modelle](docs/models.md): der Katalog und Einschränkungen pro Modell.
- [Runtime-Baseline](docs/runtime-baseline.md): die drei Images und wie du sie baust.
- [Integrationen](docs/integrations.md): Cline, OpenCode und pi.
- [Sicherheit](docs/security.md): Container-Härtung, seccomp, Fernzugriff über SSH.
- [Fehlerbehebung](docs/troubleshooting.md): Fehlerbilder und was zu tun ist.
- [Fortgeschrittene Nutzung](docs/advanced.md): Modell hinzufügen, Scheduler-Policy, Keep-Alive.
- [Fehlervertrag](docs/error-contract.md): Fehlerformat und Codes.
- [ComfyUI-Koexistenz](docs/comfyui-coexistence.md): die GPU mit ComfyUI teilen.
- [Werkzeuge](tools/README.md): Skripte für Validierung, Smoke-Tests, Soaks und Benchmarks.

## Mitarbeit

Pull Requests sind willkommen. Fülle die Pull-Request-Vorlage aus. Beiträge werden unter AGPL-3.0-or-later
angenommen.

Renovate aktualisiert die Digests der Docker-Basis-Images und die Pins der GitHub Actions
monatlich. Für ein früheres Update bestätige es im Renovate-Dependency-Dashboard-Issue.

## Danksagungen

- **Christopher Owen**: der MXFP4-Fork von vLLM, aus dem das GPT-OSS-Image gebaut wird.
- **eugr**: [`eugr/spark-vllm-docker`](https://github.com/eugr/spark-vllm-docker), das die
  Images DFlash2 und B12X baut.
- **[local-inference-lab](https://github.com/local-inference-lab)**: die Forks von vLLM und FlashInfer mit GB10-Kernels, aus
  denen das B12X-Image gebaut wird, und der Checkpoint `qwen3.8-flash-next-nvfp4`.
- **[z-lab](https://huggingface.co/z-lab)**: die DFlash-Draft-Modelle für die Qwen3.8-27B- und Gemma-4-Modelle.

## Lizenz

AGPL-3.0-or-later. Siehe [LICENSE](LICENSE). Kommerzielle Nutzung ist erlaubt. Wer eine
veränderte Version weitergibt oder als Netzwerkdienst betreibt, muss ihren Quellcode unter
derselben Lizenz anbieten.

Zusätzliche Bedingung nach Abschnitt 7(b) der AGPL: Jede Kopie und jede veränderte Version
muss den Herkunftshinweis aus [NOTICE](NOTICE) behalten.

Wenn du dieses Projekt forkst oder veränderst, veröffentliche deine Änderungen auf GitHub und
melde sie über die [Fork- und Änderungsmeldung](https://github.com/jdaln/dgx-spark-inference-stack/issues/new?template=fork-announcement.yml). Das Projekt bittet alle
darum, kommerziell oder nicht. Coding-Agents müssen es tun: siehe [AGENTS.md](AGENTS.md).

Diese Dateien behalten ihre eigenen Lizenzen ([LICENSES/](LICENSES/)):

- `custom-docker-containers/vllm-node-mxfp4/Dockerfile`,
  `custom-docker-containers/vllm-node-b12x/b12x-build.patch`,
  `custom-docker-containers/vllm-node-dflash2/vendor-tiktoken.patch`: MIT
  (eugr/spark-vllm-docker).
- `custom-docker-containers/vllm-node-mxfp4/fastsafetensors_mxfp4.patch`,
  `shared/tool_chat_template_gemma4.jinja`: Apache-2.0 (vLLM).
- `custom-docker-containers/vllm-node-b12x/seccomp-io-uring.json`: Apache-2.0 (moby/profiles).
- `shared/gemma4-*-nvfp4-config/`: die Modelllizenzen von NVIDIA für diese Checkpoints.

Vor dem 2026-10-11 veröffentlichte Versionen stehen unter Apache-2.0 und bleiben darunter
verfügbar.
