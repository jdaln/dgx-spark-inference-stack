# DGX Spark Inference Stack - Coloque-o para servir a casa!

🌍 **Leia isto em outros idiomas**:
[Deutsch](README_DE.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Italiano](README_IT.md) | [日本語](README_JA.md) | [简体中文](README_ZH_CN.md) | [繁體中文](README_ZH_TW.md) | [Русский](README_RU.md) | [Українська](README_UK.md) | [Português](README_PT.md) | [한국어](README_KO.md) | [العربية](README_AR.md) | [Tiếng Việt](README_VI.md) | [Türkçe](README_TR.md)

> **Aviso de tradução por IA:** Este arquivo foi traduzido por IA a partir de [README.md](README.md) e pode conter erros ou estar atrás da versão em inglês. Em caso de dúvida, a README em inglês é a referência.

Seu Nvidia DGX Spark não deveria ser apenas mais um projeto paralelo. Use-o de verdade. Esta é uma stack de inferência baseada em Docker para servir grandes modelos de linguagem (LLMs) com NVIDIA vLLM e gerenciamento inteligente de recursos. A stack oferece carregamento sob demanda com desligamento automático por ociosidade, uma única trilha de agendamento para o modelo principal com um helper utilitário opcional e um gateway de API unificado.

O objetivo do projeto é fornecer um servidor de inferência para a sua casa. Depois de testar isso por um mês e adicionar novos modelos, decidi liberar o projeto para a comunidade. Entenda que este é um projeto hobby e que ajuda concreta para melhorá-lo é muito bem-vinda. Ele se baseia em informações que encontrei na Internet e nos fóruns da NVIDIA. Espero sinceramente que isso ajude a impulsionar homelabs. O foco principal é uma única DGX Spark e isso precisa funcionar nela por padrão, mas suporte para duas máquinas é bem-vindo.

## Documentação

- **[Arquitetura e como funciona](docs/architecture.md)** - Entenda a stack, o serviço waker e o fluxo das requisições.
- **[Configuração](docs/configuration.md)** - Variáveis de ambiente, ajustes de rede e tuning do waker.
- **[Guia de seleção de modelos](docs/models.md)** - Catálogo atual de modelos, seletor rápido e estado de validação.
- **[Integrações](docs/integrations.md)** - Guias para **Cline** (VS Code) e **OpenCode** (agente de terminal).
- **[Segurança e acesso remoto](docs/security.md)** - Hardening de SSH e configuração de encaminhamento de portas restrito.
- **[Solução de problemas e monitoramento](docs/troubleshooting.md)** - Depuração, logs e soluções para erros comuns.
- **[Uso avançado](docs/advanced.md)** - Adicionar novos modelos, configurações personalizadas e operação persistente.
- **[Baseline de runtime](docs/runtime-baseline.md)** - Quais tracks de imagem locais o repositório espera e como reconstruí-los.
- **[Ferramentas e harness de validação](tools/README.md)** - Scripts suportados para smoke, soak, inspeção e probes manuais.
- **[Notas TODO](TODO.md)** - Ideias para o que fazer em seguida.

## Início rápido

1. **Clone o repositório**
   ```bash
   git clone <repository-url>
   cd dgx-spark-inference-stack
   ```

2. **Crie os diretórios necessários**
   ```bash
   mkdir -p models vllm_cache_huggingface manual_download/openai_gpt-oss-encodings_fix
   ```

3. **Baixe os tokenizers necessários (CRÍTICO)**
   A stack requer o download manual dos arquivos `tiktoken` para os modelos GPT-OSS.
   ```bash
   wget https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/cl100k_base.tiktoken
   wget https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/o200k_base.tiktoken
   ```

4. **Construa as imagens Docker personalizadas (OBRIGATÓRIO)**
   A stack usa imagens vLLM otimizadas que devem ser construídas localmente para garantir o melhor desempenho.
   *   **Tempo:** Espere cerca de 20 minutos por imagem.
   *   **Autenticação:** Você precisa se autenticar no NVIDIA NGC para puxar as imagens base.
       1.  Crie uma conta de desenvolvedor em [NVIDIA NGC Catalog](https://catalog.ngc.nvidia.com/) (não pode estar em um país sancionado).
       2.  Execute `docker login nvcr.io` com suas credenciais.
   *   **Comandos de build:**
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
   *   **Nota:** `vllm-node-tf5` hoje não é construído a partir de um Dockerfile local do repositório. Se você pretende rodar Gemma 4 ou os Qwen mais novos na trilha TF5, construa-o explicitamente com o fluxo helper upstream acima. Veja [docs/runtime-baseline.md](docs/runtime-baseline.md) para os passos exatos e os requisitos de rede durante o build.

5. **Suba a stack**
   ```bash
   # Start gateway and waker only (models start on-demand)
   docker compose up -d

   # Pre-create all enabled model containers once the required local track images exist
   docker compose --profile models up --no-start
   ```

6. **Teste a API**
   ```bash
    # Request to the shipped utility helper
    curl -X POST http://localhost:8009/v1/qwen3.5-0.8b/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" \
     -d '{
          "model": "qwen3.5-0.8b",
       "messages": [{"role": "user", "content": "Olá!"}]
     }'
   ```

7. **Use o harness de validação suportado**
   Depois que o primeiro `curl` manual funcionar, mude para o fluxo de bring-up mantido pelo repositório em vez de usar scripts ad hoc:
   ```bash
   bash tools/validate-stack.sh
   bash tools/smoke-gateway.sh
   ```
   Para comandos de bring-up, smoke, soak e probes manuais específicos por modelo, veja [tools/README.md](tools/README.md).

## Comece por aqui se você for novo

- Leia [docs/architecture.md](docs/architecture.md) e depois [tools/README.md](tools/README.md).
- Trate [tools/README.md](tools/README.md) junto com [models.json](models.json) como a fonte operacional de verdade atual.
- Trate este README como um ponto de entrada curto, não como o catálogo completo de modelos. Use [docs/models.md](docs/models.md) para o catálogo mais amplo.

## Pré-requisitos
- Docker 20.10+ com Docker Compose
- GPU(s) NVIDIA com suporte a CUDA e NVIDIA Container Toolkit
- Host Linux (testado em Ubuntu)

## Contribuições

Pull requests são muito bem-vindos. :)
Ainda assim, para manter a estabilidade, eu imponho um **template rígido de pull request**.

## Estado atual

Este README destaca apenas os padrões atualmente recomendados da stack.

- **Modelos principais validados:** `gpt-oss-20b`, `gpt-oss-120b` e `glm-4.7-flash-awq`
- **Helper utilitário validado:** `qwen3.5-0.8b` para títulos e metadados de sessão
- **Todo o resto:** Está no repositório, mas não é um padrão deste README até ser validado novamente com o harness atual

Para o catálogo mais amplo de modelos, trilhas experimentais e casos manuais, use [docs/models.md](docs/models.md) e [models.json](models.json).

Para alertas de cliente, particularidades de runtime e notas de troubleshooting, use [docs/integrations.md](docs/integrations.md) e [docs/troubleshooting.md](docs/troubleshooting.md).

## Créditos

Agradecimentos especiais aos membros da comunidade cujo trabalho com imagens Docker e receitas inspirou esta stack:

- **Thomas P. Braun da Avarok**: Pela imagem vLLM de uso geral (`avarok/vllm-dgx-spark`) com suporte a ativações não gated (Nemotron), modelos híbridos e posts como https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6.
- **Christopher Owen**: Pela imagem vLLM otimizada para MXFP4 (`christopherowen/vllm-dgx-spark`), que permite inferência de alto desempenho no DGX Spark.
- **eugr**: Pelo repositório comunitário original de vLLM para DGX Spark (`eugr/spark-vllm-docker`), suas customizações e as ótimas postagens nos fóruns da NVIDIA.
- **Patrick Yi / scitrera.ai**: Pela receita SGLang para modelo utilitário que informou o caminho local do helper `qwen3.5-0.8b`.
- **Raphael Amorim**: Pelo formato de receita comunitária de AutoRound que informou o caminho local experimental `qwen3.5-122b-a10b-int4-autoround`.
- **Bjarke Bolding**: Pelo formato de receita AutoRound de contexto longo que informou o caminho local experimental `qwen3-coder-next-int4-autoround`.

## Licença

Este projeto está licenciado sob a **Apache License 2.0**. Veja [LICENSE](LICENSE) para mais detalhes.
