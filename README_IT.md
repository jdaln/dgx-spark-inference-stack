# DGX Spark Inference Stack - Servi la casa!

> **Avviso:** Questo documento è stato tradotto da un'IA e potrebbe contenere errori.

Il tuo Nvidia DGX Spark non dovrebbe essere un altro progetto secondario. Inizia a usarlo! Questo è uno stack di inferenza basato su Docker per servire grandi modelli linguistici (LLM) utilizzando NVIDIA vLLM con una gestione intelligente delle risorse. Questo stack fornisce caricamento di modelli su richiesta con spegnimento automatico in caso di inattività, pianificazione GPU single-tenant e un gateway API unificato.

L'obiettivo del progetto è fornire un server di inferenza per la tua casa. Dopo aver testato questo e aggiunto nuovi modelli per un mese, ho deciso di rilasciarlo per la community. Ti prego di capire che questo è un progetto hobbistico e che un aiuto concreto per migliorarlo è molto apprezzato. Si basa su informazioni che ho trovato su Internet e sui forum NVIDIA; spero davvero che aiuti a far progredire gli homelab. Questo è principalmente focalizzato sulla singola configurazione DGX Spark e deve funzionare per impostazione predefinita, ma l'aggiunta del supporto per 2 è benvenuta.

## Documentazione

- **[Architettura e Funzionamento](docs/architecture.md)** - Comprendere lo stack, il servizio waker e il flusso delle richieste.
- **[Configurazione](docs/configuration.md)** - Variabili d'ambiente, impostazioni di rete e ottimizzazione del waker.
- **[Guida alla Selezione dei Modelli](docs/models.md)** - Elenco dettagliato di oltre 29 modelli supportati, selezione rapida e casi d'uso.
- **[Integrazioni](docs/integrations.md)** - Guide per **Cline** (VS Code) e **OpenCode** (Agente Terminale).
- **[Sicurezza e Accesso Remoto](docs/security.md)** - Hardening SSH e configurazione del port forwarding limitato.
- **[Risoluzione dei Problemi e Monitoraggio](docs/troubleshooting.md)** - Debug, log e soluzioni agli errori comuni.
- **[Uso Avanzato](docs/advanced.md)** - Aggiunta di nuovi modelli, configurazioni personalizzate e operatività persistente.
- **[Note TODO](TODO.md)** - Idee che ho per il futuro.

## Avvio Rapido

1. **Clonare il repository**
   ```bash
   git clone <repository-url>
   cd dgx-spark-inference-stack
   ```

2. **Creare le directory necessarie**
   ```bash
   mkdir -p models vllm_cache_huggingface manual_download/openai_gpt-oss-encodings_fix
   ```

3. **Scaricare i tokenizzatori richiesti (CRITICO)**
   Lo stack richiede il download manuale dei file tiktoken per i modelli GPT-OSS.
   ```bash
   wget https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/cl100k_base.tiktoken
   wget https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/o200k_base.tiktoken
   ```

4. **Costruire Immagini Docker Personalizzate (OBBLIGATORIO)**
   Lo stack utilizza immagini vLLM ottimizzate personalizzate che devono essere costruite localmente per garantire le massime prestazioni.
   *   **Tempo:** Prevedi ~20 minuti per immagine.
   *   **Autenticazione:** Devi autenticarti con NVIDIA NGC per estrarre le immagini di base.
       1.  Crea un account sviluppatore su [NVIDIA NGC Catalog](https://catalog.ngc.nvidia.com/) (non deve trovarsi in un paese sanzionato).
       2.  Esegui `docker login nvcr.io` con le tue credenziali.
   *   **Comandi di Build:**
       ```bash
       # Costruire immagine Avarok (Scopo Generale) - DEVE usare questo tag per usare la versione locale invece di upstream
       docker build -t avarok/vllm-dgx-spark:v11 custom-docker-containers/avarok

       # Costruire immagine Christopher Owen (Ottimizzata MXFP4)
       docker build -t christopherowen/vllm-dgx-spark:v12 custom-docker-containers/christopherowen
       ```

5. **Avviare lo stack**
   ```bash
   # Avviare solo gateway e waker (i modelli si avviano su richiesta)
   docker compose up -d

   # Pre-creare tutti i container dei modelli abilitati (consigliato)
   docker compose --profile models up --no-start
   ```

6. **Testare l'API**
   ```bash
   # Richiesta a qwen2.5-1.5b (si avvierà automaticamente)
   curl -X POST http://localhost:8009/v1/qwen2.5-1.5b-instruct/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" \
     -d '{
       "model": "qwen2.5-1.5b-instruct",
       "messages": [{"role": "user", "content": "Ciao!"}]
     }'
   ```

## Prerequisiti
- Docker 20.10+ con Docker Compose
- GPU NVIDIA con supporto CUDA e NVIDIA Container Toolkit
- Host Linux (testato su Ubuntu)

## Contribuire

Le Pull Request sono molto benvenute. :)
Tuttavia, per garantire la stabilità, applico un rigoroso **Modello di Pull Request**.

## ⚠️ Problemi Noti

### Modelli Sperimentali (Compatibilità GB10/CUDA 12.1)

I seguenti modelli sono contrassegnati come **sperimentali** a causa di crash sporadici su DGX Spark (GPU GB10):

- **Qwen3-Next-80B-A3B-Instruct** - Crash casuale nel layer di attenzione lineare
- **Qwen3-Next-80B-A3B-Thinking** - Stesso problema

**Causa principale:** La GPU GB10 utilizza CUDA 12.1, ma l'attuale stack vLLM/PyTorch supporta solo CUDA ≤12.0. Ciò causa errori `cudaErrorIllegalInstruction` dopo diverse richieste riuscite.

**Soluzione alternativa:** Usa `gpt-oss-20b` o `gpt-oss-120b` per chiamate di strumenti stabili fino a quando non sarà disponibile un'immagine vLLM aggiornata con un supporto GB10 adeguato.

### Nemotron 3 Nano 30B (NVFP4)

Il modello **`nemotron-3-nano-30b-nvfp4`** è attualmente disabilitato.
**Motivo:** Incompatibile con l'attuale build vLLM su GB10. Richiede un supporto adeguato del motore V1 o un'implementazione backend aggiornata.


### Supporto Immagini/Screenshot OpenCode su Linux

OpenCode (agente AI terminale) ha un bug noto su Linux in cui **le immagini dagli appunti e le immagini da percorso file non funzionano** con i modelli di visione. Il modello risponde con "Il modello che stai usando non supporta l'input di immagini" anche se i modelli VL funzionano correttamente tramite API.

**Causa principale:** La gestione degli appunti Linux di OpenCode corrompe i dati binari dell'immagine prima della codifica (usa `.text()` invece di `.arrayBuffer()`). Nessun dato immagine reale viene inviato al server.

**Stato:** Sembra essere un bug lato client di OpenCode. L'aiuto per indagare/risolvere è benvenuto! Lo stack di inferenza gestisce correttamente le immagini base64 quando inviate correttamente (verificato tramite curl).

**Soluzione alternativa:** Usa curl o altri client API per inviare immagini direttamente a modelli VL come `qwen2.5-vl-7b`.

### Incompatibilità Qwen 2.5 Coder 7B e OpenCode

Il modello `qwen2.5-coder-7b-instruct` ha un limite di contesto rigoroso di **32.768 token**. Tuttavia, OpenCode invia in genere richieste molto grandi (buffer + input) che superano **35.000 token**, causando `ValueError` e fallimenti della richiesta.

**Raccomandazione:** Non usare `qwen2.5-coder-7b` con OpenCode per attività a lungo contesto. Usa invece **`qwen3-coder-30b-instruct`** che supporta **65.536 token** di contesto e gestisce comodamente le grandi richieste di OpenCode.

### Incompatibilità Llama 3.3 e OpenCode

Il modello **`llama-3.3-70b-instruct-fp4`** **non è raccomandato per l'uso con OpenCode**.
**Motivo:** Sebbene il modello funzioni correttamente tramite API, mostra un comportamento aggressivo di chiamata degli strumenti quando inizializzato dai prompt specifici del client di OpenCode. Ciò porta a errori di convalida e a un'esperienza utente degradata (ad es. tentativo di chiamare strumenti immediatamente dopo il saluto).
**Raccomandazione:** Usa `gpt-oss-20b` o `qwen3-next-80b-a3b-instruct` per le sessioni OpenCode.

## Crediti

Un ringraziamento speciale ai membri della community che hanno realizzato le immagini Docker ottimizzate utilizzate in questo stack:

- **Thomas P. Braun di Avarok**: Per l'immagine vLLM generica (`avarok/vllm-dgx-spark`) con supporto per attivazioni non controllate (Nemotron) e modelli ibridi, e post come questo https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6.
- **Christopher Owen**: Per l'immagine vLLM ottimizzata MXFP4 (`christopherowen/vllm-dgx-spark`) che consente inferenza ad alte prestazioni su DGX Spark.
- **eugr**: Per tutto il lavoro sulle personalizzazioni dell'immagine vLLM originale (`eugr/vllm-dgx-spark`) e gli ottimi post sui forum NVIDIA.

### Fornitori di Modelli

Un enorme grazie alle organizzazioni che ottimizzano questi modelli per l'inferenza FP4/FP8:

- **Fireworks AI** (`Firworks`): Per una vasta gamma di modelli ottimizzati tra cui GLM-4.5, Llama 3.3 e Ministral.
- **NVIDIA**: Per Qwen3-Next, Nemotron e implementazioni FP4 standard.
- **RedHat**: Per Qwen3-VL e Mistral Small.
- **QuantTrio**: Per Qwen3-VL-Thinking.
- **OpenAI**: Per i modelli GPT-OSS.

## Licenza

Questo progetto è concesso in licenza sotto la **Licenza Apache 2.0**. Vedi il file [LICENSE](LICENSE) per i dettagli.
