# DGX Spark Inference Stack - Serviere das Zuhause!

🌍 **Lies dies in anderen Sprachen**:
[Deutsch](README_DE.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Italiano](README_IT.md) | [日本語](README_JA.md) | [简体中文](README_ZH_CN.md) | [繁體中文](README_ZH_TW.md) | [Русский](README_RU.md) | [Українська](README_UK.md) | [Português](README_PT.md) | [한국어](README_KO.md) | [العربية](README_AR.md) | [Tiếng Việt](README_VI.md) | [Türkçe](README_TR.md)

> **Hinweis zur KI-Übersetzung:** Diese Datei wurde von einer KI aus [README.md](README.md) übersetzt und kann Fehler enthalten oder hinter der englischen Version zurückliegen. Im Zweifel ist die englische README maßgeblich.

Dein Nvidia DGX Spark sollte kein weiteres Nebenprojekt sein. Nutze ihn. Das ist ein Docker-basierter Inferenz-Stack zum Bereitstellen großer Sprachmodelle (LLMs) mit NVIDIA vLLM und intelligentem Ressourcenmanagement. Dieser Stack bietet On-Demand-Modellladen mit automatischer Abschaltung bei Inaktivität, eine einzelne Scheduling-Spur für Hauptmodelle mit optionalem Utility-Helfer und ein einheitliches API-Gateway.

Das Ziel des Projekts ist es, einen Inferenzserver für dein Zuhause bereitzustellen. Nachdem ich das einen Monat lang getestet und neue Modelle ergänzt habe, habe ich beschlossen, es für die Community zu veröffentlichen. Bitte beachte, dass dies ein Hobbyprojekt ist und konkrete Hilfe zur Verbesserung sehr willkommen ist. Es basiert auf Informationen aus dem Internet und den NVIDIA-Foren. Ich hoffe wirklich, dass es Homelabs voranbringt. Der Fokus liegt vor allem auf einem einzelnen DGX Spark und es sollte darauf standardmäßig funktionieren, aber Unterstützung für zwei Systeme ist willkommen.

## Dokumentation

- **[Architektur & Funktionsweise](docs/architecture.md)** - Verstehen, wie der Stack, der Waker-Dienst und der Request-Flow arbeiten.
- **[Konfiguration](docs/configuration.md)** - Umgebungsvariablen, Netzwerkeinstellungen und Waker-Tuning.
- **[Leitfaden zur Modellauswahl](docs/models.md)** - Detaillierte Liste von 29+ unterstützten Modellen, Schnellauswahl und Einsatzfälle.
- **[Integrationen](docs/integrations.md)** - Anleitungen für **Cline** (VS Code) und **OpenCode** (Terminal-Agent).
- **[Sicherheit & Fernzugriff](docs/security.md)** - SSH-Härtung und Einrichtung von eingeschränktem Port-Forwarding.
- **[Fehlerbehebung & Monitoring](docs/troubleshooting.md)** - Debugging, Logs und Lösungen für häufige Fehler.
- **[Fortgeschrittene Nutzung](docs/advanced.md)** - Neue Modelle hinzufügen, eigene Konfigurationen und dauerhafter Betrieb.
- **[Runtime-Baseline](docs/runtime-baseline.md)** - Welche lokalen Image-Tracks das Repo erwartet und wie du sie neu baust.
- **[Werkzeuge & Validierungsharness](tools/README.md)** - Unterstützte Smoke-, Soak-, Inspektions- und manuelle Probe-Skripte.
- **[TODO-Notizen](TODO.md)** - Ideen, was als Nächstes ansteht.

## Schnellstart

1. **Repository klonen**
   ```bash
   git clone <repository-url>
   cd dgx-spark-inference-stack
   ```

2. **Benötigte Verzeichnisse anlegen**
   ```bash
   mkdir -p models vllm_cache_huggingface manual_download/openai_gpt-oss-encodings_fix
   ```

3. **Erforderliche Tokenizer herunterladen (KRITISCH)**
   Der Stack benötigt für GPT-OSS-Modelle manuell heruntergeladene `tiktoken`-Dateien.
   ```bash
   wget https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/cl100k_base.tiktoken
   wget https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/o200k_base.tiktoken
   ```

4. **Eigene Docker-Images bauen (VERPFLICHTEND)**
   Der Stack verwendet lokal gebaute, optimierte vLLM-Images, damit die Performance stimmt.
   *   **Zeit:** Rechne mit ungefähr 20 Minuten pro Image.
   *   **Authentifizierung:** Du musst dich bei NVIDIA NGC anmelden, um Basis-Images ziehen zu können.
       1.  Erstelle ein Entwicklerkonto im [NVIDIA NGC Catalog](https://catalog.ngc.nvidia.com/) (nicht aus einem sanktionierten Land).
       2.  Führe `docker login nvcr.io` mit deinen Zugangsdaten aus.
   *   **Build-Befehle:**
       ```bash
       # Avarok-Image bauen (Allzweck) - muss dieses Tag verwenden, damit lokal statt Upstream genutzt wird
       docker build -t avarok/vllm-dgx-spark:v11 custom-docker-containers/avarok

      # Den repoeigenen MXFP4-Track bauen, der von GPT-OSS verwendet wird.
      # Dadurch werden die manuell heruntergeladenen tiktoken-Dateien ins Image eingebettet.
      docker build -t vllm-node-mxfp4 -f custom-docker-containers/vllm-node-mxfp4/Dockerfile .

      # Den aktualisierten TF5-Track bauen, der für GLM 4.7 verwendet wird.
      docker build -t local/vllm-node-tf5:cu131 -f custom-docker-containers/vllm-node-tf5/Dockerfile .

      # Den upstream-artigen TF5-Track bauen, der für Gemma 4 und neuere TF5-Rezepte verwendet wird.
      # Die aktiven Gemma-Compose-Dienste erwarten genau dieses lokale Image-Tag.
      git clone https://github.com/eugr/spark-vllm-docker tmp/spark-vllm-docker 2>/dev/null || git -C tmp/spark-vllm-docker pull --ff-only
      (cd tmp/spark-vllm-docker && bash build-and-copy.sh --pre-tf)
       ```
   *   **Hinweis:** `vllm-node-tf5` wird derzeit nicht aus einem repo-lokalen Dockerfile gebaut. Wenn du Gemma 4 oder neuere Qwen-Folgemodelle auf dem TF5-Track nutzen willst, baue es explizit mit dem obigen Upstream-Helper-Flow. In [docs/runtime-baseline.md](docs/runtime-baseline.md) stehen die genauen Reproduktionsschritte und die Netzwerkvoraussetzungen zur Build-Zeit.

5. **Stack starten**
   ```bash
   # Nur Gateway und Waker starten (Modelle starten bei Bedarf)
   docker compose up -d

   # Alle aktivierten Modellcontainer vorab anlegen, sobald die benötigten lokalen Track-Images existieren
   docker compose --profile models up --no-start
   ```

6. **API testen**
   ```bash
    # Anfrage an den ausgelieferten Utility-Helfer
    curl -X POST http://localhost:8009/v1/qwen3.5-0.8b/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" \
     -d '{
          "model": "qwen3.5-0.8b",
       "messages": [{"role": "user", "content": "Hallo!"}]
     }'
   ```

7. **Unterstützte Validierungsharness verwenden**
   Nach dem ersten erfolgreichen `curl` solltest du statt Ad-hoc-Skripten den gepflegten Bring-up-Flow des Repos verwenden:
   ```bash
   bash tools/validate-stack.sh
   bash tools/smoke-gateway.sh
   ```
   Für modellspezifische Bring-up-, Smoke-, Soak- und manuelle Probe-Befehle siehe [tools/README.md](tools/README.md).

## Hier anfangen, wenn du neu bist

- Lies zuerst [README.md](README.md), dann [docs/architecture.md](docs/architecture.md), dann [tools/README.md](tools/README.md).
- Behandle [tools/README.md](tools/README.md) zusammen mit [models.json](models.json) als aktuelle operative Quelle der Wahrheit.
- Behandle Modelle außerhalb des in dieser README validierten Sets als experimentell, bis das Harness etwas anderes sagt.

## Voraussetzungen
- Docker 20.10+ mit Docker Compose
- NVIDIA-GPU(s) mit CUDA-Unterstützung und NVIDIA Container Toolkit
- Linux-Host (getestet auf Ubuntu)

## Beiträge

Pull Requests sind sehr willkommen. :)
Um die Stabilität zu sichern, erzwinge ich jedoch ein strenges **Pull-Request-Template**.

## ⚠️ Bekannte Probleme

### Aktueller Validierungsstatus

Mit dem aktuellen Harness und den Standardwerten des Repos sind im Moment nur diese **validierten Hauptmodelle** bestätigt:

- **`gpt-oss-20b`**
- **`gpt-oss-120b`**
- **`glm-4.7-flash-awq`**

Der mitgelieferte kleine Helfer `qwen3.5-0.8b` ist inzwischen der **validierte Utility-Helfer** für Titel und Sitzungsmetadaten, gehört aber nicht zu diesem validierten Hauptmodell-Set.

Andere verfügbare Modelle können weiterhin funktionieren, sollten aber über diesen validierten Utility-Helfer hinaus bis zu erneuten Tests mit dem aktuellen Tooling als **experimentell** behandelt werden und nicht als empfohlene Standardwahl.

### Experimentelle Modelle (GB10/CUDA-12.1-Kompatibilität)

Die folgenden Modelle sind aufgrund sporadischer Abstürze auf DGX Spark (GB10-GPU) als **experimentell** markiert:

- **Qwen3-Next-80B-A3B-Instruct** - Stürzt zufällig in der linearen Attention-Schicht ab
- **Qwen3-Next-80B-A3B-Thinking** - Gleiches Problem

**Ursache:** Die GB10-GPU verwendet CUDA 12.1, aber der aktuelle vLLM/PyTorch-Stack unterstützt nur CUDA ≤12.0. Das führt nach mehreren erfolgreichen Requests zu `cudaErrorIllegalInstruction`.

**Workaround:** Verwende `gpt-oss-20b` oder `gpt-oss-120b` für stabiles Tool-Calling, bis ein aktualisiertes vLLM-Image mit korrekter GB10-Unterstützung verfügbar ist.

### Nemotron 3 Nano 30B (NVFP4)

Das Modell **`nemotron-3-nano-30b-nvfp4`** ist auf dem aktualisierten `vllm-node`-Standard-Track wieder aktiviert, sollte mit dem aktuellen Harness aber weiterhin als **experimentell** betrachtet werden.
**Aktueller Status:** Es lädt jetzt und beantwortet Requests auf dem aktualisierten Runtime-Track, gehört aber weder zum validierten Hauptmodell-Set noch zur ausgelieferten OpenCode-Konfiguration.
**Wichtiges Verhalten:** Sichtbarer Assistant-Content hängt von der nicht-denkenden Request-Form ab. Der Request-Validator injiziert diesen Standard nun für normale Gateway-Requests.
**Aktuelle konservative Client-Obergrenze:** Ungefähr `100000` Prompt-Tokens für manuelle OpenCode/Cline-ähnliche Nutzung. Der aktive Fünfer-Soak des Stacks besteht sauber bei ungefähr `101776` Prompt-Tokens und ist bei ungefähr `116298` bereits grenzwertig.

### OpenCode Bild-/Screenshot-Unterstützung unter Linux

OpenCode (Terminal-KI-Agent) hat unter Linux einen bekannten Bug, bei dem **Clipboard-Bilder und Bilder über Dateipfade** mit Vision-Modellen nicht funktionieren. Das Modell antwortet mit "The model you're using does not support image input", obwohl VL-Modelle über die API korrekt funktionieren.

**Ursache:** Die Linux-Clipboard-Behandlung von OpenCode beschädigt binäre Bilddaten vor der Kodierung (es wird `.text()` statt `.arrayBuffer()` verwendet). Es werden also tatsächlich keine Bilddaten an den Server gesendet.

**Status:** Das scheint ein clientseitiger OpenCode-Bug zu sein. Hilfe bei Untersuchung oder Fix ist willkommen. Der Inferenz-Stack verarbeitet Base64-Bilder korrekt, wenn sie sauber per `curl` oder einem anderen API-Client gesendet werden.

**Workaround:** Verwende `curl` oder andere API-Clients, um Bilder direkt an VL-Modelle wie `qwen2.5-vl-7b` zu senden.

### Qwen 2.5 Coder 7B & OpenCode-Inkompatibilität

Das Modell `qwen2.5-coder-7b-instruct` hat ein hartes Kontextlimit von **32.768 Tokens**. OpenCode sendet jedoch typischerweise sehr große Requests (Buffer + Input) mit mehr als **35.000 Tokens**, was zu `ValueError` und fehlgeschlagenen Requests führt.

**Empfehlung:** Nutze `qwen2.5-coder-7b` nicht mit OpenCode für Long-Context-Aufgaben. Verwende stattdessen **`qwen3-coder-30b-instruct`**, das **65.536 Tokens** Kontext unterstützt und die großen OpenCode-Requests deutlich besser verkraftet.

### Llama 3.3 & OpenCode-Inkompatibilität

Das Modell **`llama-3.3-70b-instruct-fp4`** wird **nicht für OpenCode empfohlen**.
**Grund:** Obwohl das Modell über die API korrekt funktioniert, zeigt es mit den spezifischen Client-Prompts von OpenCode ein aggressives Tool-Calling-Verhalten. Das führt zu Validierungsfehlern und einer schlechteren Nutzererfahrung, zum Beispiel wenn direkt auf eine Begrüßung hin Tools aufgerufen werden sollen.
**Empfehlung:** Verwende für OpenCode-Sitzungen stattdessen `gpt-oss-20b` oder `qwen3-next-80b-a3b-instruct`.

## Credits

Besonderer Dank an die Community-Mitglieder, die optimierte Docker-Images für diesen Stack bereitgestellt haben:

- **Thomas P. Braun von Avarok**: Für das allgemeine vLLM-Image (`avarok/vllm-dgx-spark`) mit Unterstützung für nicht gegatete Aktivierungen (Nemotron), Hybridmodelle und Beiträge wie https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6.
- **Christopher Owen**: Für das MXFP4-optimierte vLLM-Image (`christopherowen/vllm-dgx-spark`), das performante Inferenz auf DGX Spark ermöglicht.
- **eugr**: Für die gesamte Arbeit an den Anpassungen des ursprünglichen vLLM-Images (`eugr/vllm-dgx-spark`) und die großartigen Beiträge in den NVIDIA-Foren.
- **Patrick Yi / scitrera.ai**: Für das SGLang-Rezept für Utility-Modelle, das den lokalen Pfad für den `qwen3.5-0.8b`-Helfer geprägt hat.

## Lizenz

Dieses Projekt ist unter der **Apache License 2.0** lizenziert. Details stehen in der Datei [LICENSE](LICENSE).
