# DGX Spark Inference Stack – Serviere das Zuhause!

> **Haftungsausschluss:** Dieses Dokument wurde von einer KI übersetzt und kann Fehler enthalten.

Ihr Nvidia DGX Spark sollte kein weiteres Nebenprojekt sein. Starten Sie es! Dies ist ein Docker-basierter Inferenz-Stack zur Bereitstellung großer Sprachmodelle (LLMs) mit NVIDIA vLLM und intelligentem Ressourcenmanagement. Dieser Stack bietet On-Demand-Modellladen mit automatischer Abschaltung bei Inaktivität, Single-Tenant-GPU-Scheduling und ein einheitliches API-Gateway.

Das Ziel des Projekts ist es, einen Inferenzserver für Ihr Zuhause bereitzustellen. Nachdem ich dies einen Monat lang getestet und neue Modelle hinzugefügt habe, habe ich beschlossen, es für die Community freizugeben. Bitte haben Sie Verständnis dafür, dass dies ein Hobbyprojekt ist und konkrete Hilfe zur Verbesserung sehr willkommen ist. Es basiert auf Informationen, die ich im Internet und in den NVIDIA-Foren gefunden habe; ich hoffe sehr, dass es Homelabs voranbringt. Dies konzentriert sich hauptsächlich auf das einzelne DGX Spark-Setup und muss standardmäßig darauf funktionieren, aber Unterstützung für 2 ist willkommen.

## Dokumentation

- **[Architektur & Funktionsweise](docs/architecture.md)** - Verständnis des Stacks, des Waker-Dienstes und des Anfrageflusses.
- **[Konfiguration](docs/configuration.md)** - Umgebungsvariablen, Netzwerkeinstellungen und Waker-Tuning.
- **[Modellauswahl-Guide](docs/models.md)** - Detaillierte Liste von 29+ unterstützten Modellen, Schnellauswahl und Anwendungsfälle.
- **[Integrationen](docs/integrations.md)** - Anleitungen für **Cline** (VS Code) und **OpenCode** (Terminal Agent).
- **[Sicherheit & Fernzugriff](docs/security.md)** - SSH-Härtung und Einrichtung von eingeschränktem Port-Forwarding.
- **[Fehlerbehebung & Überwachung](docs/troubleshooting.md)** - Debugging, Logs und Lösungen für häufige Fehler.
- **[Erweiterte Nutzung](docs/advanced.md)** - Hinzufügen neuer Modelle, benutzerdefinierte Konfigurationen und dauerhafter Betrieb.
- **[TODO Notizen](TODO.md)** - Ideen, die ich für die nächsten Schritte habe.

## Schnellstart

1. **Repository klonen**
   ```bash
   git clone <repository-url>
   cd dgx-spark-inference-stack
   ```

2. **Notwendige Verzeichnisse erstellen**
   ```bash
   mkdir -p models vllm_cache_huggingface manual_download/openai_gpt-oss-encodings_fix
   ```

3. **Erforderliche Tokenizer herunterladen (WICHTIG)**
   Der Stack erfordert den manuellen Download von tiktoken-Dateien für GPT-OSS-Modelle.
   ```bash
   wget https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/cl100k_base.tiktoken
   wget https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/o200k_base.tiktoken
   ```

4. **Benutzerdefinierte Docker-Images erstellen (OBLIGATORISCH)**
   Der Stack verwendet benutzerdefinierte optimierte vLLM-Images, die lokal erstellt werden sollten, um maximale Leistung zu gewährleisten.
   *   **Zeit:** Rechnen Sie mit ca. 20 Minuten pro Image.
   *   **Auth:** Sie müssen sich bei NVIDIA NGC authentifizieren, um Basis-Images abzurufen.
       1.  Erstellen Sie ein Entwicklerkonto im [NVIDIA NGC-Katalog](https://catalog.ngc.nvidia.com/) (darf sich nicht in einem sanktionierten Land befinden).
       2.  Führen Sie `docker login nvcr.io` mit Ihren Anmeldedaten aus.
   *   **Build-Befehle:**
       ```bash
       # Avarok Image erstellen (Allzweck) - MUSS diesen Tag verwenden, um die lokale Version statt Upstream zu nutzen
       docker build -t avarok/vllm-dgx-spark:v11 custom-docker-containers/avarok

       # Christopher Owen Image erstellen (MXFP4 Optimiert)
       docker build -t christopherowen/vllm-dgx-spark:v12 custom-docker-containers/christopherowen
       ```

5. **Stack starten**
   ```bash
   # Nur Gateway und Waker starten (Modelle starten bei Bedarf)
   docker compose up -d

   # Alle aktivierten Modellcontainer vorab erstellen (empfohlen)
   docker compose --profile models up --no-start
   ```

6. **API testen**
   ```bash
   # Anfrage an qwen2.5-1.5b (startet automatisch)
   curl -X POST http://localhost:8009/v1/qwen2.5-1.5b-instruct/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" \
     -d '{
       "model": "qwen2.5-1.5b-instruct",
       "messages": [{"role": "user", "content": "Hallo!"}]
     }'
   ```

## Voraussetzungen
- Docker 20.10+ mit Docker Compose
- NVIDIA GPU(s) mit CUDA-Unterstützung und NVIDIA Container Toolkit
- Linux-Host (getestet auf Ubuntu)

## Mitwirken

Pull Requests sind sehr willkommen. :)
Um jedoch Stabilität zu gewährleisten, setze ich eine strenge **Pull Request-Vorlage** durch.

## ⚠️ Bekannte Probleme

### Experimentelle Modelle (GB10/CUDA 12.1 Kompatibilität)

Die folgenden Modelle sind als **experimentell** gekennzeichnet, da sie auf DGX Spark (GB10 GPU) sporadisch abstürzen:

- **Qwen3-Next-80B-A3B-Instruct** - Stürzt zufällig im linearen Attention-Layer ab
- **Qwen3-Next-80B-A3B-Thinking** - Gleiches Problem

**Ursache:** Die GB10 GPU verwendet CUDA 12.1, aber der aktuelle vLLM/PyTorch Stack unterstützt nur CUDA ≤12.0. Dies verursacht `cudaErrorIllegalInstruction` Fehler nach mehreren erfolgreichen Anfragen.

**Workaround:** Verwenden Sie `gpt-oss-20b` oder `gpt-oss-120b` für stabiles Tool Calling, bis ein aktualisiertes vLLM Image mit korrekter GB10 Unterstützung verfügbar ist.

### Nemotron 3 Nano 30B (NVFP4)

Das **`nemotron-3-nano-30b-nvfp4`** Modell ist derzeit deaktiviert.
**Grund:** Inkompatibel mit dem aktuellen vLLM Build auf GB10. Erfordert korrekte V1 Engine Unterstützung oder eine aktualisierte Backend Implementierung.


### OpenCode Bild/Screenshot Unterstützung unter Linux

OpenCode (Terminal AI Agent) hat einen bekannten Bug unter Linux, bei dem **Bilder aus der Zwischenablage und Dateipfad-Bilder nicht funktionieren** mit Vision-Modellen. Das Modell antwortet mit "The model you're using does not support image input", obwohl VL-Modelle über die API korrekt funktionieren.

**Ursache:** OpenCodes Linux Clipboard Behandlung beschädigt binäre Bilddaten vor der Kodierung (verwendet `.text()` statt `.arrayBuffer()`). Es werden keine tatsächlichen Bilddaten an den Server gesendet.

**Status:** Dies scheint ein clientseitiger OpenCode Bug zu sein. Hilfe bei der Untersuchung/Fehlerbehebung ist willkommen! Der Inferenz-Stack verarbeitet base64 Bilder korrekt, wenn sie richtig gesendet werden (verifiziert über curl).

**Workaround:** Verwenden Sie curl oder andere API-Clients, um Bilder direkt an VL-Modelle wie `qwen2.5-vl-7b` zu senden.

### Qwen 2.5 Coder 7B & OpenCode Inkompatibilität

Das `qwen2.5-coder-7b-instruct` Modell hat ein striktes Kontextlimit von **32.768 Token**. OpenCode sendet jedoch typischerweise sehr große Anfragen (Buffer + Input), die **35.000 Token** überschreiten, was zu `ValueError` und fehlgeschlagenen Anfragen führt.

**Empfehlung:** Verwenden Sie `qwen2.5-coder-7b` nicht mit OpenCode für Aufgaben mit langem Kontext. Verwenden Sie stattdessen **`qwen3-coder-30b-instruct`**, das **65.536 Token** Kontext unterstützt und OpenCodes große Anfragen problemlos bewältigt.

### Llama 3.3 & OpenCode Inkompatibilität

Das **`llama-3.3-70b-instruct-fp4`** Modell wird **nicht für die Verwendung mit OpenCode empfohlen**.
**Grund:** Während das Modell über die API korrekt funktioniert, zeigt es aggressives Tool-Calling-Verhalten, wenn es durch OpenCodes spezifische Client-Prompts initialisiert wird. Dies führt zu Validierungsfehlern und einer verschlechterten Benutzererfahrung (z.B. der Versuch, Tools sofort nach der Begrüßung aufzurufen).
**Empfehlung:** Verwenden Sie stattdessen `gpt-oss-20b` oder `qwen3-next-80b-a3b-instruct` für OpenCode-Sitzungen.

## Credits

Besonderer Dank an die Community-Mitglieder, die optimierte Docker-Images für diesen Stack beigesteuert haben:

- **Thomas P. Braun von Avarok**: Für das Allzweck-vLLM-Image (`avarok/vllm-dgx-spark`) mit Unterstützung für Non-Gated-Aktivierungen (Nemotron) und Hybridmodelle sowie Beiträge wie diesen https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6.
- **Christopher Owen**: Für das MXFP4-optimierte vLLM-Image (`christopherowen/vllm-dgx-spark`), das Hochleistungs-Inferenz auf DGX Spark ermöglicht.
- **eugr**: Für die gesamte Arbeit an den Anpassungen des ursprünglichen vLLM-Images (`eugr/vllm-dgx-spark`) und die großartigen Beiträge in den NVIDIA-Foren.

### Modellprovider

Riesigen Dank an die Organisationen, die diese Modelle für FP4/FP8 Inferenz optimieren:

- **Fireworks AI** (`Firworks`): Für eine breite Palette optimierter Modelle einschließlich GLM-4.5, Llama 3.3 und Ministral.
- **NVIDIA**: Für Qwen3-Next, Nemotron und Standard FP4 Implementierungen.
- **RedHat**: Für Qwen3-VL und Mistral Small.
- **QuantTrio**: Für Qwen3-VL-Thinking.
- **OpenAI**: Für die GPT-OSS Modelle.

## Lizenz

Dieses Projekt ist unter der **Apache License 2.0** lizenziert. Siehe die [LICENSE](LICENSE)-Datei für Details.
