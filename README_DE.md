# DGX Spark Inference Stack - Serviere das Zuhause!

🌍 **Lies dies in anderen Sprachen**:
[Deutsch](README_DE.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Italiano](README_IT.md) | [日本語](README_JA.md) | [简体中文](README_ZH_CN.md) | [繁體中文](README_ZH_TW.md) | [Русский](README_RU.md) | [Українська](README_UK.md) | [Português](README_PT.md) | [한국어](README_KO.md) | [العربية](README_AR.md) | [Tiếng Việt](README_VI.md) | [Türkçe](README_TR.md)

> **Hinweis zur KI-Übersetzung:** Diese Datei wurde von einer KI aus [README.md](README.md) übersetzt und kann Fehler enthalten oder hinter der englischen Version zurückliegen. Im Zweifel ist die englische README maßgeblich.

Dein Nvidia DGX Spark sollte kein weiteres Nebenprojekt sein. Nutze ihn. Das ist ein Docker-basierter Inferenz-Stack zum Bereitstellen großer Sprachmodelle (LLMs) mit NVIDIA vLLM und intelligentem Ressourcenmanagement. Dieser Stack bietet On-Demand-Modellladen mit automatischer Abschaltung bei Inaktivität, eine einzelne Scheduling-Spur für Hauptmodelle mit optionalem Utility-Helfer und ein einheitliches API-Gateway.

Das Ziel des Projekts ist es, einen Inferenzserver für dein Zuhause bereitzustellen. Nachdem ich das einen Monat lang getestet und neue Modelle ergänzt habe, habe ich beschlossen, es für die Community zu veröffentlichen. Bitte beachte, dass dies ein Hobbyprojekt ist und konkrete Hilfe zur Verbesserung sehr willkommen ist. Es basiert auf Informationen aus dem Internet und den NVIDIA-Foren. Ich hoffe wirklich, dass es Homelabs voranbringt. Der Fokus liegt vor allem auf einem einzelnen DGX Spark und es sollte darauf standardmäßig funktionieren, aber Unterstützung für zwei Systeme ist willkommen.

## Dokumentation

- **[Architektur & Funktionsweise](docs/architecture.md)** - Verstehen, wie der Stack, der Waker-Dienst und der Request-Flow arbeiten.
- **[Konfiguration](docs/configuration.md)** - Umgebungsvariablen, Netzwerkeinstellungen und Waker-Tuning.
- **[Leitfaden zur Modellauswahl](docs/models.md)** - Aktueller Modellkatalog, Schnellauswahl und Validierungsstatus.
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
      **Build-Befehle:**
      ```bash
      # Avarok-Image bauen (Allzweck) - muss dieses Tag verwenden, damit lokal statt Upstream genutzt wird.
      # Vom Repo-Root bauen, damit die manuell heruntergeladenen Tokenizer-Dateien eingebunden werden.
      docker build -t avarok/vllm-dgx-spark:v11 -f custom-docker-containers/avarok/Dockerfile .

      # Wenn Compose-Dienste standardmäßig das gepinnte Upstream-Avarok-Image verwenden,
      # exportiere diese Überschreibung für die aktuelle Shell oder lege sie vor
      # docker compose in .env ab.
      export VLLM_TRACK_AVAROK=avarok/vllm-dgx-spark:v11

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
    curl -X POST http://localhost:8009/v1/chat/completions\
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

- Lies zuerst [docs/architecture.md](docs/architecture.md), dann [tools/README.md](tools/README.md).
- Behandle [tools/README.md](tools/README.md) zusammen mit [models.json](models.json) als aktuelle operative Quelle der Wahrheit.
- Behandle diese README als kurzen Einstieg statt als vollständigen Modellkatalog. Für den breiteren Katalog nutze [docs/models.md](docs/models.md).

## Voraussetzungen
- Docker 20.10+ mit Docker Compose
- NVIDIA-GPU(s) mit CUDA-Unterstützung und NVIDIA Container Toolkit
- Linux-Host (getestet auf Ubuntu)

## Beiträge

Pull Requests sind sehr willkommen. :)
Um die Stabilität zu sichern, erzwinge ich jedoch ein strenges **Pull-Request-Template**.

## Aktueller Stand

Diese README hebt nur die aktuell empfohlenen Standardpfade des Stacks hervor.

- **Validierte Hauptmodelle:** `gpt-oss-20b`, `gpt-oss-120b` und `glm-4.7-flash-awq`
- **Validierter Utility-Helfer:** `qwen3.5-0.8b` für Titel und Sitzungsmetadaten
- **Alles andere:** Im Repo vorhanden, aber kein README-Standard, bis es mit dem aktuellen Harness erneut validiert wurde

Für den breiteren Modellkatalog, experimentelle Pfade und manuelle Sonderfälle nutze [docs/models.md](docs/models.md) und [models.json](models.json).

Für Client-Hinweise, Runtime-Besonderheiten und Troubleshooting-Notizen nutze [docs/integrations.md](docs/integrations.md) und [docs/troubleshooting.md](docs/troubleshooting.md).

## Credits

Besonderer Dank an die Community-Mitglieder, deren Docker-Images und Rezeptarbeit diesen Stack geprägt haben:

- **Thomas P. Braun von Avarok**: Für das allgemeine vLLM-Image (`avarok/vllm-dgx-spark`) mit Unterstützung für nicht gegatete Aktivierungen (Nemotron), Hybridmodelle und Beiträge wie https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6.
- **Christopher Owen**: Für das MXFP4-optimierte vLLM-Image (`christopherowen/vllm-dgx-spark`), das performante Inferenz auf DGX Spark ermöglicht.
- **eugr**: Für das ursprüngliche Community-Repository `eugr/spark-vllm-docker`, seine Anpassungen und die großartigen Beiträge in den NVIDIA-Foren.
- **Patrick Yi / scitrera.ai**: Für das SGLang-Rezept für Utility-Modelle, das den lokalen Pfad für den `qwen3.5-0.8b`-Helfer geprägt hat.
- **Raphael Amorim**: Für die Community-AutoRound-Rezeptform, die den experimentellen lokalen `qwen3.5-122b-a10b-int4-autoround`-Pfad geprägt hat.
- **Bjarke Bolding**: Für die Long-Context-AutoRound-Rezeptform, die den experimentellen lokalen `qwen3-coder-next-int4-autoround`-Pfad geprägt hat.

## Lizenz

Dieses Projekt ist unter der **Apache License 2.0** lizenziert. Details stehen in der Datei [LICENSE](LICENSE).
