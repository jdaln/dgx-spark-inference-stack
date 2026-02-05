# DGX Spark Inference Stack - Sirva a sua casa!

> **Aviso:** Este documento foi traduzido por IA e pode conter erros.

O seu Nvidia DGX Spark não deve ser apenas mais um projeto paralelo. Comece a usá-lo! Esta é uma stack de inferência baseada em Docker para servir grandes modelos de linguagem (LLMs) usando NVIDIA vLLM com gestão inteligente de recursos. Esta stack fornece carregamento de modelos on-demand com encerramento automático em caso de inatividade, agendamento de GPU single-tenant e um gateway de API unificado.

O objetivo do projeto é fornecer um servidor de inferência para a sua casa. Depois de testar isto e adicionar novos modelos durante um mês, decidi lançá-lo para a comunidade. Por favor, compreenda que este é um projeto de hobby e que a ajuda concreta para melhorá-lo é muito apreciada. É baseado em informações que encontrei na Internet e nos fóruns da NVIDIA; espero realmente que ajude a impulsionar os homelabs. Isto foca-se principalmente na configuração única do DGX Spark e deve funcionar nela por padrão, mas o suporte para 2 é bem-vindo.

## Documentação

- **[Arquitetura e Como Funciona](docs/architecture.md)** - Compreender a stack, o serviço waker e o fluxo de pedidos.
- **[Configuração](docs/configuration.md)** - Variáveis de ambiente, definições de rede e ajuste do waker.
- **[Guia de Seleção de Modelos](docs/models.md)** - Lista detalhada de 29+ modelos suportados, seletor rápido e casos de uso.
- **[Integrações](docs/integrations.md)** - Guias para **Cline** (VS Code) e **OpenCode** (Agente de Terminal).
- **[Segurança e Acesso Remoto](docs/security.md)** - Endurecimento de SSH e configuração de reencaminhamento de portas restrito.
- **[Resolução de Problemas e Monitorização](docs/troubleshooting.md)** - Depuração, registos e soluções para erros comuns.
- **[Uso Avançado](docs/advanced.md)** - Adicionar novos modelos, configurações personalizadas e operação persistente.
- **[Notas TODO](TODO.md)** - Ideias que tenho para o futuro.

## Início Rápido

1. **Clonar o repositório**
   ```bash
   git clone <repository-url>
   cd dgx-spark-inference-stack
   ```

2. **Criar diretórios necessários**
   ```bash
   mkdir -p models vllm_cache_huggingface manual_download/openai_gpt-oss-encodings_fix
   ```

3. **Descarregar tokenizadores necessários (CRÍTICO)**
   A stack requer o download manual de ficheiros tiktoken para os modelos GPT-OSS.
   ```bash
   wget https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/cl100k_base.tiktoken
   wget https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/o200k_base.tiktoken
   ```

4. **Construir Imagens Docker Personalizadas (OBRIGATÓRIO)**
   A stack utiliza imagens vLLM otimizadas personalizadas que devem ser construídas localmente para garantir o máximo desempenho.
   *   **Tempo:** Conte com ~20 minutos por imagem.
   *   **Auth:** Deve autenticar-se com NVIDIA NGC para obter as imagens base.
       1.  Crie uma conta de programador no [NVIDIA NGC Catalog](https://catalog.ngc.nvidia.com/) (não deve estar num país sancionado).
       2.  Execute `docker login nvcr.io` com as suas credenciais.
   *   **Comandos de Build:**
       ```bash
       # Construir imagem Avarok (Uso Geral) - DEVE usar esta tag para usar a versão local em vez da upstream
       docker build -t avarok/vllm-dgx-spark:v11 custom-docker-containers/avarok

       # Construir imagem Christopher Owen (Otimizada MXFP4)
       docker build -t christopherowen/vllm-dgx-spark:v12 custom-docker-containers/christopherowen
       ```

5. **Iniciar a stack**
   ```bash
   # Iniciar apenas gateway e waker (os modelos iniciam on-demand)
   docker compose up -d

   # Pré-criar todos os contentores de modelos ativados (recomendado)
   docker compose --profile models up --no-start
   ```

6. **Testar a API**
   ```bash
   # Pedido para qwen2.5-1.5b (iniciará automaticamente)
   curl -X POST http://localhost:8009/v1/qwen2.5-1.5b-instruct/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" \
     -d '{
       "model": "qwen2.5-1.5b-instruct",
       "messages": [{"role": "user", "content": "Olá!"}]
     }'
   ```

## Pré-requisitos
- Docker 20.10+ com Docker Compose
- GPU(s) NVIDIA com suporte CUDA e NVIDIA Container Toolkit
- Host Linux (testado em Ubuntu)

## Contribuir

As Pull Requests são muito bem-vindas. :)
No entanto, para garantir a estabilidade, aplico um rigoroso **Modelo de Pull Request**.

## ⚠️ Problemas Conhecidos

### Modelos Experimentais (Compatibilidade GB10/CUDA 12.1)

Os seguintes modelos estão marcados como **experimentais** devido a falhas esporádicas no DGX Spark (GPU GB10):

- **Qwen3-Next-80B-A3B-Instruct** - Falha aleatoriamente na camada de atenção linear
- **Qwen3-Next-80B-A3B-Thinking** - O mesmo problema

**Causa raiz:** A GPU GB10 usa CUDA 12.1, mas a stack vLLM/PyTorch atual suporta apenas CUDA ≤12.0. Isto causa erros `cudaErrorIllegalInstruction` após vários pedidos bem-sucedidos.

**Solução alternativa:** Utilize `gpt-oss-20b` ou `gpt-oss-120b` para chamadas de ferramentas estáveis até que esteja disponível uma imagem vLLM atualizada com suporte adequado para GB10.

### Nemotron 3 Nano 30B (NVFP4)

O modelo **`nemotron-3-nano-30b-nvfp4`** está atualmente desativado.
**Razão:** Incompatível com a build atual do vLLM no GB10. Requer suporte adequado do motor V1 ou implementação de backend atualizada.


### Suporte de Imagens/Capturas de Ecrã no OpenCode em Linux

O OpenCode (agente de IA de terminal) tem um bug conhecido em Linux onde **as imagens da área de transferência e as imagens de caminho de ficheiro não funcionam** com modelos de visão. O modelo responde com "The model you're using does not support image input" embora os modelos VL funcionem corretamente via API.

**Causa raiz:** O tratamento da área de transferência Linux do OpenCode corrompe os dados binários da imagem antes da codificação (usa `.text()` em vez de `.arrayBuffer()`). Não são enviados dados de imagem reais para o servidor.

**Estado:** Isto parece ser um bug do lado do cliente do OpenCode. A ajuda para investigar/corrigir é bem-vinda! A stack de inferência trata corretamente imagens base64 quando enviadas adequadamente (verificado via curl).

**Solução alternativa:** Utilize curl ou outros clientes API para enviar imagens diretamente para modelos VL como `qwen2.5-vl-7b`.

### Incompatibilidade Qwen 2.5 Coder 7B e OpenCode

O modelo `qwen2.5-coder-7b-instruct` tem um limite de contexto estrito de **32.768 tokens**. No entanto, o OpenCode normalmente envia pedidos muito grandes (buffer + entrada) que excedem **35.000 tokens**, causando `ValueError` e falhas no pedido.

**Recomendação:** Não utilize `qwen2.5-coder-7b` com o OpenCode para tarefas de contexto longo. Em vez disso, utilize **`qwen3-coder-30b-instruct`** que suporta **65.536 tokens** de contexto e lida confortavelmente com os grandes pedidos do OpenCode.

### Incompatibilidade Llama 3.3 e OpenCode

O modelo **`llama-3.3-70b-instruct-fp4`** **não é recomendado para uso com o OpenCode**.
**Razão:** Embora o modelo funcione corretamente via API, exibe um comportamento agressivo de chamada de ferramentas quando inicializado pelos prompts específicos do cliente do OpenCode. Isto leva a erros de validação e a uma experiência de utilizador degradada (por exemplo, tentar chamar ferramentas imediatamente após o cumprimento).
**Recomendação:** Utilize `gpt-oss-20b` ou `qwen3-next-80b-a3b-instruct` para sessões do OpenCode.

## Créditos

Um agradecimento especial aos membros da comunidade que fizeram as imagens Docker otimizadas utilizadas nesta stack:

- **Thomas P. Braun da Avarok**: Pela imagem vLLM de uso geral (`avarok/vllm-dgx-spark`) com suporte para ativações não controladas (Nemotron) e modelos híbridos, e publicações como esta https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6.
- **Christopher Owen**: Pela imagem vLLM otimizada para MXFP4 (`christopherowen/vllm-dgx-spark`) que permite inferência de alto desempenho no DGX Spark.
- **eugr**: Por todo o trabalho nas personalizações da imagem vLLM original (`eugr/vllm-dgx-spark`) e as excelentes publicações nos fóruns da NVIDIA.

### Fornecedores de Modelos

Um enorme obrigado às organizações que otimizam estes modelos para inferência FP4/FP8:

- **Fireworks AI** (`Firworks`): Por uma vasta gama de modelos otimizados, incluindo GLM-4.5, Llama 3.3 e Ministral.
- **NVIDIA**: Por Qwen3-Next, Nemotron e implementações padrão de FP4.
- **RedHat**: Por Qwen3-VL e Mistral Small.
- **QuantTrio**: Por Qwen3-VL-Thinking.
- **OpenAI**: Pelos modelos GPT-OSS.

## Licença

Este projeto está licenciado sob a **Licença Apache 2.0**. Veja o ficheiro [LICENSE](LICENSE) para mais detalhes.
