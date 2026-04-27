# DGX Spark Inference Stack - Coloque-o para servir a casa!

🌍 **Leia isto em outros idiomas**:
[Deutsch](README_DE.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Italiano](README_IT.md) | [日本語](README_JA.md) | [简体中文](README_ZH_CN.md) | [繁體中文](README_ZH_TW.md) | [Русский](README_RU.md) | [Українська](README_UK.md) | [Português](README_PT.md) | [한국어](README_KO.md) | [العربية](README_AR.md) | [Tiếng Việt](README_VI.md) | [Türkçe](README_TR.md)

> **Aviso de tradução por IA:** Este arquivo foi traduzido por IA a partir de [README.md](README.md) e pode conter erros ou estar atrás da versão em inglês. Em caso de dúvida, a README em inglês é a referência.

Seu Nvidia DGX Spark não deveria ser apenas mais um projeto paralelo. Use-o de verdade. Esta é uma stack de inferência baseada em Docker para servir grandes modelos de linguagem (LLMs) com NVIDIA vLLM e gerenciamento inteligente de recursos. A stack oferece carregamento sob demanda com desligamento automático por ociosidade, uma única trilha de agendamento para o modelo principal com um helper utilitário opcional e um gateway de API unificado.

O objetivo do projeto é fornecer um servidor de inferência para a sua casa. Depois de testar isso por um mês e adicionar novos modelos, decidi liberar o projeto para a comunidade. Entenda que este é um projeto hobby e que ajuda concreta para melhorá-lo é muito bem-vinda. Ele se baseia em informações que encontrei na Internet e nos fóruns da NVIDIA. Espero sinceramente que isso ajude a impulsionar homelabs. O foco principal é uma única DGX Spark e isso precisa funcionar nela por padrão, mas suporte para duas máquinas é bem-vindo.

## Documentação

- **[Arquitetura e como funciona](docs/architecture.md)** - Entenda a stack, o serviço waker e o fluxo das requisições.
- **[Configuração](docs/configuration.md)** - Variáveis de ambiente, ajustes de rede e tuning do waker.
- **[Guia de seleção de modelos](docs/models.md)** - Lista detalhada de mais de 29 modelos suportados, seletor rápido e casos de uso.
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

- Leia [README.md](README.md), depois [docs/architecture.md](docs/architecture.md) e depois [tools/README.md](tools/README.md).
- Trate [tools/README.md](tools/README.md) junto com [models.json](models.json) como a fonte operacional de verdade atual.
- Trate os modelos fora do conjunto validado nesta README como experimentais até que o harness diga o contrário.

## Pré-requisitos
- Docker 20.10+ com Docker Compose
- GPU(s) NVIDIA com suporte a CUDA e NVIDIA Container Toolkit
- Host Linux (testado em Ubuntu)

## Contribuições

Pull requests são muito bem-vindos. :)
Ainda assim, para manter a estabilidade, eu imponho um **template rígido de pull request**.

## ⚠️ Problemas conhecidos

### Estado atual de validação

Com o harness atual e os padrões do repositório, os únicos **modelos principais validados** neste momento são:

- **`gpt-oss-20b`**
- **`gpt-oss-120b`**
- **`glm-4.7-flash-awq`**

O pequeno helper `qwen3.5-0.8b` que acompanha a stack agora é o **helper utilitário validado** para títulos e metadados de sessão, mas não faz parte desse conjunto de modelos principais validados.

Outros modelos disponíveis ainda podem funcionar, mas além desse helper utilitário validado eles devem ser tratados como **experimentais** em vez de defaults recomendados até serem testados novamente com o tooling atual.

### Modelos experimentais (compatibilidade GB10/CUDA 12.1)

Os modelos abaixo estão marcados como **experimentais** por causa de travamentos esporádicos no DGX Spark (GPU GB10):

- **Qwen3-Next-80B-A3B-Instruct** - Cai aleatoriamente na camada de atenção linear
- **Qwen3-Next-80B-A3B-Thinking** - Mesmo problema

**Causa raiz:** A GPU GB10 usa CUDA 12.1, mas a stack atual de vLLM/PyTorch só oferece suporte a CUDA ≤12.0. Isso provoca erros `cudaErrorIllegalInstruction` depois de várias requisições bem-sucedidas.

**Solução temporária:** Use `gpt-oss-20b` ou `gpt-oss-120b` para tool calling estável até que exista uma imagem vLLM atualizada com suporte correto para GB10.

### Nemotron 3 Nano 30B (NVFP4)

O modelo **`nemotron-3-nano-30b-nvfp4`** foi reativado no caminho padrão atualizado `vllm-node`, mas ainda deve ser tratado como **experimental** no harness atual.
**Estado atual:** Ele agora carrega e responde requisições no runtime atualizado, mas não faz parte do conjunto de modelos principais validados nem da configuração OpenCode enviada com a stack.
**Comportamento importante:** O conteúdo visível do assistente depende do formato de requisição sem thinking. O validador de requisições agora injeta esse padrão para requisições normais pelo gateway.
**Teto conservador atual para cliente:** Cerca de `100000` tokens de prompt para uso manual no estilo OpenCode/Cline. O soak ativo de cinco vias da stack passa limpo por volta de `101776` tokens de prompt e já fica no limite em torno de `116298`.

### Suporte a imagens/capturas do OpenCode no Linux

OpenCode (agente de IA de terminal) tem um bug conhecido no Linux em que **imagens da área de transferência e imagens por caminho de arquivo não funcionam** com modelos de visão. O modelo responde com "The model you're using does not support image input" mesmo que modelos VL funcionem corretamente pela API.

**Causa raiz:** O tratamento de clipboard do OpenCode no Linux corrompe os dados binários da imagem antes da codificação (usa `.text()` em vez de `.arrayBuffer()`). Na prática, nenhum dado de imagem é enviado ao servidor.

**Status:** Isso parece ser um bug do cliente OpenCode. Ajuda para investigar ou corrigir é bem-vinda. A stack de inferência lida corretamente com imagens base64 quando elas são enviadas corretamente por `curl` ou outro cliente de API.

**Solução temporária:** Use `curl` ou outros clientes de API para enviar imagens diretamente a modelos VL como `qwen2.5-vl-7b`.

### Qwen 2.5 Coder 7B e incompatibilidade com OpenCode

O modelo `qwen2.5-coder-7b-instruct` tem um limite rígido de contexto de **32.768 tokens**. O OpenCode, porém, costuma enviar requisições muito grandes (buffer + input) acima de **35.000 tokens**, o que causa `ValueError` e falha nas requisições.

**Recomendação:** Não use `qwen2.5-coder-7b` com OpenCode para tarefas de contexto longo. Em vez disso, use **`qwen3-coder-30b-instruct`**, que suporta **65.536 tokens** de contexto e lida com folga maior com as requisições grandes do OpenCode.

### Llama 3.3 e incompatibilidade com OpenCode

O modelo **`llama-3.3-70b-instruct-fp4`** **não é recomendado para OpenCode**.
**Motivo:** Embora o modelo funcione corretamente pela API, ele exibe um comportamento agressivo de tool calling quando é inicializado pelos prompts específicos do cliente OpenCode. Isso leva a erros de validação e piora a experiência de uso, por exemplo tentando chamar ferramentas imediatamente após uma saudação.
**Recomendação:** Use `gpt-oss-20b` ou `qwen3-next-80b-a3b-instruct` para sessões OpenCode.

## Créditos

Agradecimentos especiais aos membros da comunidade que tornaram possíveis as imagens Docker otimizadas usadas nesta stack:

- **Thomas P. Braun da Avarok**: Pela imagem vLLM de uso geral (`avarok/vllm-dgx-spark`) com suporte a ativações não gated (Nemotron), modelos híbridos e posts como https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6.
- **Christopher Owen**: Pela imagem vLLM otimizada para MXFP4 (`christopherowen/vllm-dgx-spark`), que permite inferência de alto desempenho no DGX Spark.
- **eugr**: Por todo o trabalho nas customizações da imagem vLLM original (`eugr/vllm-dgx-spark`) e pelas ótimas postagens nos fóruns da NVIDIA.
- **Patrick Yi / scitrera.ai**: Pela receita SGLang para modelo utilitário que informou o caminho local do helper `qwen3.5-0.8b`.

## Licença

Este projeto está licenciado sob a **Apache License 2.0**. Veja [LICENSE](LICENSE) para mais detalhes.
