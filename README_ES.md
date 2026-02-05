# DGX Spark Inference Stack - ¡Sirve a tu hogar!

> **Aviso:** Este documento ha sido traducido por IA y puede contener errores.

Tu Nvidia DGX Spark no debería ser otro proyecto secundario. ¡Empieza a usarlo! Este es un stack de inferencia basado en Docker para servir grandes modelos de lenguaje (LLMs) usando NVIDIA vLLM con gestión inteligente de recursos. Este stack proporciona carga de modelos bajo demanda con apagado automático por inactividad, programación de GPU de un solo inquilino y una puerta de enlace API unificada.

El objetivo del proyecto es proporcionar un servidor de inferencia para tu hogar. Después de probar esto y agregar nuevos modelos durante un mes, decidí lanzarlo para la comunidad. Por favor, comprenda que este es un proyecto de hobby y que la ayuda concreta para mejorarlo es muy apreciada. Se basa en información que encontré en Internet y en los Foros de NVIDIA; realmente espero que ayude a impulsar los laboratorios domésticos. Esto se centra principalmente en la configuración de un solo DGX Spark y debe funcionar por defecto, pero agregar soporte para 2 es bienvenido.

## Documentación

- **[Arquitectura y Cómo Funciona](docs/architecture.md)** - Entendiendo el stack, el servicio waker y el flujo de solicitudes.
- **[Configuración](docs/configuration.md)** - Variables de entorno, configuración de red y ajuste del waker.
- **[Guía de Selección de Modelos](docs/models.md)** - Lista detallada de 29+ modelos soportados, selector rápido y casos de uso.
- **[Integraciones](docs/integrations.md)** - Guías para **Cline** (VS Code) y **OpenCode** (Agente de Terminal).
- **[Seguridad y Acceso Remoto](docs/security.md)** - Endurecimiento de SSH y configuración de reenvío de puertos restringido.
- **[Solución de Problemas y Monitoreo](docs/troubleshooting.md)** - Depuración, registros y soluciones a errores comunes.
- **[Uso Avanzado](docs/advanced.md)** - Agregar nuevos modelos, configuraciones personalizadas y operación persistente.
- **[Notas TODO](TODO.md)** - Ideas que tengo para lo siguiente.

## Inicio Rápido

1. **Clonar el repositorio**
   ```bash
   git clone <repository-url>
   cd dgx-spark-inference-stack
   ```

2. **Crear directorios necesarios**
   ```bash
   mkdir -p models vllm_cache_huggingface manual_download/openai_gpt-oss-encodings_fix
   ```

3. **Descargar tokenizadores requeridos (CRÍTICO)**
   El stack requiere la descarga manual de archivos tiktoken para los modelos GPT-OSS.
   ```bash
   wget https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/cl100k_base.tiktoken
   wget https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/o200k_base.tiktoken
   ```

4. **Construir Imágenes Docker Personalizadas (OBLIGATORIO)**
   El stack utiliza imágenes vLLM optimizadas y personalizadas que deben construirse localmente para garantizar el máximo rendimiento.
   *   **Tiempo:** Espere ~20 minutos por imagen.
   *   **Auth:** Debe autenticarse con NVIDIA NGC para obtener las imágenes base.
       1.  Cree una cuenta de desarrollador en [NVIDIA NGC Catalog](https://catalog.ngc.nvidia.com/) (no debe estar en un país sancionado).
       2.  Ejecute `docker login nvcr.io` con sus credenciales.
   *   **Comandos de Construcción:**
       ```bash
       # Construir imagen Avarok (Propósito General) - DEBE usar esta etiqueta para usar la versión local sobre upstream
       docker build -t avarok/vllm-dgx-spark:v11 custom-docker-containers/avarok

       # Construir imagen Christopher Owen (Optimizada MXFP4)
       docker build -t christopherowen/vllm-dgx-spark:v12 custom-docker-containers/christopherowen
       ```

5. **Iniciar el stack**
   ```bash
   # Iniciar solo puerta de enlace y waker (los modelos inician bajo demanda)
   docker compose up -d

   # Pre-crear todos los contenedores de modelos habilitados (recomendado)
   docker compose --profile models up --no-start
   ```

6. **Probar la API**
   ```bash
   # Solicitud a qwen2.5-1.5b (iniciará automáticamente)
   curl -X POST http://localhost:8009/v1/qwen2.5-1.5b-instruct/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" \
     -d '{
       "model": "qwen2.5-1.5b-instruct",
       "messages": [{"role": "user", "content": "¡Hola!"}]
     }'
   ```

## Requisitos Previos
- Docker 20.10+ con Docker Compose
- GPU(s) NVIDIA con soporte CUDA y NVIDIA Container Toolkit
- Host Linux (probado en Ubuntu)

## Contribuyendo

Las Pull Requests son muy bienvenidas. :)
Sin embargo, para garantizar la estabilidad, aplico una estricta **Plantilla de Pull Request**.

## ⚠️ Problemas Conocidos

### Modelos Experimentales (Compatibilidad GB10/CUDA 12.1)

Los siguientes modelos están marcados como **experimentales** debido a bloqueos esporádicos en DGX Spark (GPU GB10):

- **Qwen3-Next-80B-A3B-Instruct** - Se bloquea aleatoriamente en la capa de atención lineal
- **Qwen3-Next-80B-A3B-Thinking** - El mismo problema

**Causa raíz:** La GPU GB10 usa CUDA 12.1, pero el stack actual vLLM/PyTorch solo soporta CUDA ≤12.0. Esto causa errores `cudaErrorIllegalInstruction` después de varias solicitudes exitosas.

**Solución temporal:** Use `gpt-oss-20b` o `gpt-oss-120b` para llamadas a herramientas estables hasta que esté disponible una imagen vLLM actualizada con soporte adecuado para GB10.

### Nemotron 3 Nano 30B (NVFP4)

El modelo **`nemotron-3-nano-30b-nvfp4`** está actualmente deshabilitado.
**Razón:** Incompatible con la compilación actual de vLLM en GB10. Requiere soporte adecuado del motor V1 o implementación de backend actualizada.


### Soporte de Imágenes/Capturas de Pantalla en OpenCode en Linux

OpenCode (agente de IA de terminal) tiene un error conocido en Linux donde **las imágenes del portapapeles y las imágenes de ruta de archivo no funcionan** con modelos de visión. El modelo responde con "El modelo que estás usando no soporta entrada de imágenes" aunque los modelos VL funcionen correctamente vía API.

**Causa raíz:** El manejo del portapapeles de Linux de OpenCode corrompe los datos binarios de la imagen antes de codificarlos (usa `.text()` en lugar de `.arrayBuffer()`). No se envían datos de imagen reales al servidor.

**Estado:** Esto parece ser un error del lado del cliente de OpenCode. ¡Se agradece ayuda para investigar/arreglar! El stack de inferencia maneja correctamente imágenes base64 cuando se envían adecuadamente (verificado vía curl).

**Solución temporal:** Use curl u otros clientes API para enviar imágenes directamente a modelos VL como `qwen2.5-vl-7b`.

### Incompatibilidad Qwen 2.5 Coder 7B y OpenCode

El modelo `qwen2.5-coder-7b-instruct` tiene un límite de contexto estricto de **32,768 tokens**. Sin embargo, OpenCode típicamente envía solicitudes muy grandes (buffer + entrada) que exceden los **35,000 tokens**, causando `ValueError` y fallos en la solicitud.

**Recomendación:** No use `qwen2.5-coder-7b` con OpenCode para tareas de contexto largo. En su lugar, use **`qwen3-coder-30b-instruct`** que soporta **65,536 tokens** de contexto y maneja las grandes solicitudes de OpenCode cómodamente.

### Incompatibilidad Llama 3.3 y OpenCode

El modelo **`llama-3.3-70b-instruct-fp4`** **no se recomienda para uso con OpenCode**.
**Razón:** Aunque el modelo funciona correctamente vía API, exhibe un comportamiento agresivo de llamada a herramientas cuando es inicializado por los prompts específicos del cliente de OpenCode. Esto lleva a errores de validación y una experiencia de usuario degradada (por ejemplo, intentar llamar herramientas inmediatamente al saludar).
**Recomendación:** Use `gpt-oss-20b` o `qwen3-next-80b-a3b-instruct` para sesiones de OpenCode en su lugar.

## Créditos

Un agradecimiento especial a los miembros de la comunidad que hicieron las imágenes Docker optimizadas utilizadas en este stack:

- **Thomas P. Braun de Avarok**: Por la imagen vLLM de propósito general (`avarok/vllm-dgx-spark`) con soporte para activaciones no controladas (Nemotron) y modelos híbridos, y publicaciones como esta https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6.
- **Christopher Owen**: Por la imagen vLLM optimizada para MXFP4 (`christopherowen/vllm-dgx-spark`) que permite inferencia de alto rendimiento en DGX Spark.
- **eugr**: Por todo el trabajo en las personalizaciones de la imagen vLLM original (`eugr/vllm-dgx-spark`) y las excelentes publicaciones en los Foros de NVIDIA.

### Proveedores de Modelos

¡Muchas gracias a las organizaciones que optimizan estos modelos para inferencia FP4/FP8!

- **Fireworks AI** (`Firworks`): Por una amplia gama de modelos optimizados, incluyendo GLM-4.5, Llama 3.3 y Ministral.
- **NVIDIA**: Por Qwen3-Next, Nemotron e implementaciones estándar de FP4.
- **RedHat**: Por Qwen3-VL y Mistral Small.
- **QuantTrio**: Por Qwen3-VL-Thinking.
- **OpenAI**: Por los modelos GPT-OSS.

## Licencia

Este proyecto está licenciado bajo la **Licencia Apache 2.0**. Vea el archivo [LICENSE](LICENSE) para más detalles.
