# DGX Spark Inference Stack - Mettilo al servizio di casa!

🌍 **Leggi questo in altre lingue**:
[Deutsch](README_DE.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Italiano](README_IT.md) | [日本語](README_JA.md) | [简体中文](README_ZH_CN.md) | [繁體中文](README_ZH_TW.md) | [Русский](README_RU.md) | [Українська](README_UK.md) | [Português](README_PT.md) | [한국어](README_KO.md) | [العربية](README_AR.md) | [Tiếng Việt](README_VI.md) | [Türkçe](README_TR.md)

> **Nota di traduzione IA:** Questo file è stato tradotto tramite IA a partire da [README.md](README.md) e può contenere errori o essere meno aggiornato della versione inglese. In caso di dubbio, fa fede la README in inglese.

Il tuo Nvidia DGX Spark non dovrebbe essere l'ennesimo progetto laterale. Usalo davvero. Questo è uno stack di inferenza basato su Docker per servire grandi modelli linguistici (LLM) con NVIDIA vLLM e gestione intelligente delle risorse. Lo stack offre caricamento dei modelli on-demand con spegnimento automatico in caso di inattività, una singola corsia di scheduling per il modello principale con un helper di utilità opzionale e un gateway API unificato.

L'obiettivo del progetto è fornire un server di inferenza per la casa. Dopo averlo testato per un mese e aver aggiunto nuovi modelli, ho deciso di pubblicarlo per la community. Tieni presente che si tratta di un progetto hobbistico e che un aiuto concreto per migliorarlo è molto apprezzato. Si basa su informazioni trovate online e nei forum NVIDIA. Spero davvero che possa aiutare a far crescere gli homelab. L'attenzione principale è sul setup con un solo DGX Spark e deve funzionare lì per impostazione predefinita, ma il supporto a due unità è ben accetto.

## Documentazione

- **[Architettura e funzionamento](docs/architecture.md)** - Capire lo stack, il servizio waker e il flusso delle richieste.
- **[Configurazione](docs/configuration.md)** - Variabili d'ambiente, impostazioni di rete e tuning del waker.
- **[Guida alla scelta dei modelli](docs/models.md)** - Catalogo modelli attuale, selettore rapido e stato di validazione.
- **[Integrazioni](docs/integrations.md)** - Guide per **Cline** (VS Code) e **OpenCode** (agente da terminale).
- **[Sicurezza e accesso remoto](docs/security.md)** - Hardening SSH e configurazione di port forwarding limitato.
- **[Risoluzione problemi e monitoraggio](docs/troubleshooting.md)** - Debug, log e soluzioni agli errori comuni.
- **[Uso avanzato](docs/advanced.md)** - Aggiungere nuovi modelli, configurazioni personalizzate e operatività persistente.
- **[Baseline runtime](docs/runtime-baseline.md)** - Quali image locali si aspetta il repository e come ricostruirli.
- **[Strumenti e harness di validazione](tools/README.md)** - Script supportati per smoke, soak, ispezioni e probe manuali.
- **[Note TODO](TODO.md)** - Idee su cosa fare dopo.

## Avvio rapido

1. **Clona il repository**
   ```bash
   git clone <repository-url>
   cd dgx-spark-inference-stack
   ```

2. **Crea le directory necessarie**
   ```bash
   mkdir -p models vllm_cache_huggingface manual_download/openai_gpt-oss-encodings_fix
   ```

3. **Scarica i tokenizer richiesti (CRITICO)**
   Lo stack richiede il download manuale dei file `tiktoken` per i modelli GPT-OSS.
   ```bash
   wget https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/cl100k_base.tiktoken
   wget https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/o200k_base.tiktoken
   ```

4. **Costruisci le immagini Docker personalizzate (OBBLIGATORIO)**
   Lo stack usa immagini vLLM ottimizzate che conviene costruire localmente per ottenere le massime prestazioni.
   *   **Tempo:** Considera circa 20 minuti per immagine.
   *   **Autenticazione:** Devi autenticarti su NVIDIA NGC per poter scaricare le immagini base.
       1.  Crea un account sviluppatore su [NVIDIA NGC Catalog](https://catalog.ngc.nvidia.com/) (non deve trovarsi in un paese soggetto a sanzioni).
       2.  Esegui `docker login nvcr.io` con le tue credenziali.
      **Comandi di build:**
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
   *   **Nota:** `vllm-node-tf5` al momento non viene costruito da un Dockerfile locale al repository. Se vuoi eseguire Gemma 4 o i nuovi derivati Qwen sul track TF5, costruiscilo esplicitamente con il flusso helper upstream qui sopra. Vedi [docs/runtime-baseline.md](docs/runtime-baseline.md) per i passaggi esatti e i requisiti di rete in fase di build.

5. **Avvia lo stack**
   ```bash
   # Start gateway and waker only (models start on-demand)
   docker compose up -d

   # Pre-create all enabled model containers once the required local track images exist
   docker compose --profile models up --no-start
   ```

6. **Testa l'API**
   ```bash
    # Request to the shipped utility helper
    curl -X POST http://localhost:8009/v1/chat/completions\
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" \
     -d '{
          "model": "qwen3.5-0.8b",
       "messages": [{"role": "user", "content": "Ciao!"}]
     }'
   ```

7. **Usa l'harness di validazione supportato**
   Dopo il primo `curl` manuale riuscito, passa al flusso di bring-up mantenuto dal repository invece di usare script ad hoc:
   ```bash
   bash tools/validate-stack.sh
   bash tools/smoke-gateway.sh
   ```
   Per comandi di bring-up, smoke, soak e probe manuali specifici per modello, consulta [tools/README.md](tools/README.md).

## Inizia da qui se sei nuovo

- Leggi [docs/architecture.md](docs/architecture.md), poi [tools/README.md](tools/README.md).
- Considera [tools/README.md](tools/README.md) insieme a [models.json](models.json) come la fonte operativa di verità corrente.
- Considera questa README come un punto di ingresso breve, non come il catalogo completo dei modelli. Usa [docs/models.md](docs/models.md) per il catalogo più ampio.

## Prerequisiti
- Docker 20.10+ con Docker Compose
- GPU NVIDIA con supporto CUDA e NVIDIA Container Toolkit
- Host Linux (testato su Ubuntu)

## Contribuire

Le pull request sono molto benvenute. :)
Per garantire la stabilità, però, applico un **template di pull request rigoroso**.

## Stato attuale

Questa README evidenzia solo i default attualmente consigliati dello stack.

- **Modelli principali validati:** `gpt-oss-20b`, `gpt-oss-120b` e `glm-4.7-flash-awq`
- **Helper di utilità validato:** `qwen3.5-0.8b` per titoli e metadati di sessione
- **Tutto il resto:** Presente nel repository, ma non un default di questa README finché non viene rivalidato con l'harness attuale

Per il catalogo modelli più ampio, i percorsi sperimentali e i casi manuali, usa [docs/models.md](docs/models.md) e [models.json](models.json).

Per avvertenze lato client, particolarità del runtime e note di troubleshooting, usa [docs/integrations.md](docs/integrations.md) e [docs/troubleshooting.md](docs/troubleshooting.md).

## Crediti

Un ringraziamento speciale ai membri della community il cui lavoro su immagini Docker e ricette ha ispirato questo stack:

- **Thomas P. Braun di Avarok**: Per l'immagine vLLM general purpose (`avarok/vllm-dgx-spark`) con supporto per attivazioni non gated (Nemotron), modelli ibridi e post come https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6.
- **Christopher Owen**: Per l'immagine vLLM ottimizzata MXFP4 (`christopherowen/vllm-dgx-spark`) che consente inferenza ad alte prestazioni su DGX Spark.
- **eugr**: Per il repository community vLLM per DGX Spark originale (`eugr/spark-vllm-docker`), le sue personalizzazioni e gli ottimi post nei forum NVIDIA.
- **Patrick Yi / scitrera.ai**: Per la ricetta SGLang per modelli di utilità che ha ispirato il percorso locale dell'helper `qwen3.5-0.8b`.
- **Raphael Amorim**: Per l'impostazione della ricetta AutoRound della community che ha ispirato il percorso locale sperimentale `qwen3.5-122b-a10b-int4-autoround`.
- **Bjarke Bolding**: Per l'impostazione della ricetta AutoRound per contesto lungo che ha ispirato il percorso locale sperimentale `qwen3-coder-next-int4-autoround`.

## Licenza

Questo progetto è distribuito con licenza **Apache License 2.0**. Vedi il file [LICENSE](LICENSE) per i dettagli.
