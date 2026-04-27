# DGX Spark Inference Stack - Mettilo al servizio di casa!

🌍 **Leggi questo in altre lingue**:
[Deutsch](README_DE.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Italiano](README_IT.md) | [日本語](README_JA.md) | [简体中文](README_ZH_CN.md) | [繁體中文](README_ZH_TW.md) | [Русский](README_RU.md) | [Українська](README_UK.md) | [Português](README_PT.md) | [한국어](README_KO.md) | [العربية](README_AR.md) | [Tiếng Việt](README_VI.md) | [Türkçe](README_TR.md)

> **Nota di traduzione IA:** Questo file è stato tradotto tramite IA a partire da [README.md](README.md) e può contenere errori o essere meno aggiornato della versione inglese. In caso di dubbio, fa fede la README in inglese.

Il tuo Nvidia DGX Spark non dovrebbe essere l'ennesimo progetto laterale. Usalo davvero. Questo è uno stack di inferenza basato su Docker per servire grandi modelli linguistici (LLM) con NVIDIA vLLM e gestione intelligente delle risorse. Lo stack offre caricamento dei modelli on-demand con spegnimento automatico in caso di inattività, una singola corsia di scheduling per il modello principale con un helper di utilità opzionale e un gateway API unificato.

L'obiettivo del progetto è fornire un server di inferenza per la casa. Dopo averlo testato per un mese e aver aggiunto nuovi modelli, ho deciso di pubblicarlo per la community. Tieni presente che si tratta di un progetto hobbistico e che un aiuto concreto per migliorarlo è molto apprezzato. Si basa su informazioni trovate online e nei forum NVIDIA. Spero davvero che possa aiutare a far crescere gli homelab. L'attenzione principale è sul setup con un solo DGX Spark e deve funzionare lì per impostazione predefinita, ma il supporto a due unità è ben accetto.

## Documentazione

- **[Architettura e funzionamento](docs/architecture.md)** - Capire lo stack, il servizio waker e il flusso delle richieste.
- **[Configurazione](docs/configuration.md)** - Variabili d'ambiente, impostazioni di rete e tuning del waker.
- **[Guida alla scelta dei modelli](docs/models.md)** - Elenco dettagliato di oltre 29 modelli supportati, selettore rapido e casi d'uso.
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
   *   **Comandi di build:**
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
    curl -X POST http://localhost:8009/v1/qwen3.5-0.8b/chat/completions \
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

- Leggi [README.md](README.md), poi [docs/architecture.md](docs/architecture.md), poi [tools/README.md](tools/README.md).
- Considera [tools/README.md](tools/README.md) insieme a [models.json](models.json) come la fonte operativa di verità corrente.
- Considera sperimentali i modelli fuori dal set validato in questa README finché l'harness non dice il contrario.

## Prerequisiti
- Docker 20.10+ con Docker Compose
- GPU NVIDIA con supporto CUDA e NVIDIA Container Toolkit
- Host Linux (testato su Ubuntu)

## Contribuire

Le pull request sono molto benvenute. :)
Per garantire la stabilità, però, applico un **template di pull request rigoroso**.

## ⚠️ Problemi noti

### Stato attuale della validazione

Con l'harness attuale e i default del repository, gli unici **modelli principali validati** al momento sono:

- **`gpt-oss-20b`**
- **`gpt-oss-120b`**
- **`glm-4.7-flash-awq`**

Il piccolo helper `qwen3.5-0.8b` incluso ora è l'**helper di utilità validato** per titoli e metadati di sessione, ma non fa parte di quel set di modelli principali validati.

Altri modelli disponibili possono ancora funzionare, ma oltre a questo helper validato vanno trattati come **sperimentali** invece che come default raccomandati finché non vengono ritestati con gli strumenti attuali.

### Modelli sperimentali (compatibilità GB10/CUDA 12.1)

I seguenti modelli sono contrassegnati come **sperimentali** a causa di crash sporadici su DGX Spark (GPU GB10):

- **Qwen3-Next-80B-A3B-Instruct** - Va in crash casualmente nel layer di attenzione lineare
- **Qwen3-Next-80B-A3B-Thinking** - Stesso problema

**Causa radice:** La GPU GB10 usa CUDA 12.1, ma lo stack attuale vLLM/PyTorch supporta solo CUDA ≤12.0. Questo causa errori `cudaErrorIllegalInstruction` dopo varie richieste riuscite.

**Workaround:** Usa `gpt-oss-20b` o `gpt-oss-120b` per un tool calling stabile finché non sarà disponibile un'immagine vLLM aggiornata con supporto corretto per GB10.

### Nemotron 3 Nano 30B (NVFP4)

Il modello **`nemotron-3-nano-30b-nvfp4`** è stato riabilitato sul percorso standard aggiornato `vllm-node`, ma con l'harness attuale va ancora trattato come **sperimentale**.
**Stato attuale:** Ora carica e risponde alle richieste sul runtime aggiornato, ma non fa parte né del set di modelli principali validati né della configurazione OpenCode distribuita.
**Comportamento importante:** Il contenuto visibile dell'assistente dipende dalla forma di richiesta non-thinking. Il validatore delle richieste ora inserisce quel default per le richieste normali che passano dal gateway.
**Soglia client conservativa attuale:** Circa `100000` token di prompt per uso manuale in stile OpenCode/Cline. Il soak attivo a cinque vie dello stack passa pulito intorno a `101776` token di prompt ed è già borderline intorno a `116298`.

### Supporto immagini/screenshot di OpenCode su Linux

OpenCode (agente AI da terminale) ha un bug noto su Linux per cui **le immagini negli appunti e le immagini tramite percorso file non funzionano** con i modelli vision. Il modello risponde con "The model you're using does not support image input" anche se i modelli VL funzionano correttamente via API.

**Causa radice:** La gestione degli appunti Linux in OpenCode corrompe i dati binari dell'immagine prima della codifica (usa `.text()` invece di `.arrayBuffer()`). In pratica non viene inviato alcun dato immagine al server.

**Stato:** Sembra un bug lato client OpenCode. Qualsiasi aiuto per investigarlo o correggerlo è benvenuto. Lo stack di inferenza gestisce correttamente immagini base64 quando vengono inviate bene con `curl` o altri client API.

**Workaround:** Usa `curl` o altri client API per inviare immagini direttamente ai modelli VL come `qwen2.5-vl-7b`.

### Qwen 2.5 Coder 7B e incompatibilità con OpenCode

Il modello `qwen2.5-coder-7b-instruct` ha un limite rigido di contesto di **32.768 token**. OpenCode però invia tipicamente richieste molto grandi (buffer + input) che superano i **35.000 token**, causando `ValueError` e il fallimento delle richieste.

**Raccomandazione:** Non usare `qwen2.5-coder-7b` con OpenCode per attività a lungo contesto. Usa invece **`qwen3-coder-30b-instruct`**, che supporta **65.536 token** di contesto e gestisce molto meglio le richieste grandi di OpenCode.

### Llama 3.3 e incompatibilità con OpenCode

Il modello **`llama-3.3-70b-instruct-fp4`** **non è consigliato con OpenCode**.
**Motivo:** Sebbene il modello funzioni correttamente via API, mostra un comportamento di tool calling aggressivo quando viene inizializzato con i prompt specifici del client OpenCode. Questo produce errori di validazione e peggiora l'esperienza d'uso, per esempio tentando di chiamare strumenti subito dopo un saluto.
**Raccomandazione:** Usa `gpt-oss-20b` o `qwen3-next-80b-a3b-instruct` per le sessioni OpenCode.

## Crediti

Un ringraziamento speciale ai membri della community che hanno reso disponibili le immagini Docker ottimizzate usate da questo stack:

- **Thomas P. Braun di Avarok**: Per l'immagine vLLM general purpose (`avarok/vllm-dgx-spark`) con supporto per attivazioni non gated (Nemotron), modelli ibridi e post come https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6.
- **Christopher Owen**: Per l'immagine vLLM ottimizzata MXFP4 (`christopherowen/vllm-dgx-spark`) che consente inferenza ad alte prestazioni su DGX Spark.
- **eugr**: Per tutto il lavoro sulle personalizzazioni dell'immagine vLLM originale (`eugr/vllm-dgx-spark`) e per gli ottimi post nei forum NVIDIA.
- **Patrick Yi / scitrera.ai**: Per la ricetta SGLang per modelli di utilità che ha ispirato il percorso locale dell'helper `qwen3.5-0.8b`.

## Licenza

Questo progetto è distribuito con licenza **Apache License 2.0**. Vedi il file [LICENSE](LICENSE) per i dettagli.
