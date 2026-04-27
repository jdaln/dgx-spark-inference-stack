# DGX Spark Inference Stack - ¡Ponlo al servicio de tu casa!

🌍 **Lee esto en otros idiomas**:
[Deutsch](README_DE.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Italiano](README_IT.md) | [日本語](README_JA.md) | [简体中文](README_ZH_CN.md) | [繁體中文](README_ZH_TW.md) | [Русский](README_RU.md) | [Українська](README_UK.md) | [Português](README_PT.md) | [한국어](README_KO.md) | [العربية](README_AR.md) | [Tiếng Việt](README_VI.md) | [Türkçe](README_TR.md)

> **Aviso de traducción por IA:** Este archivo fue traducido por IA a partir de [README.md](README.md) y puede contener errores o ir por detrás de la versión en inglés. Si hay alguna duda, manda la README en inglés.

Tu Nvidia DGX Spark no debería ser otro proyecto secundario. Úsalo. Este es un stack de inferencia basado en Docker para servir modelos grandes de lenguaje (LLM) con NVIDIA vLLM y gestión inteligente de recursos. Este stack ofrece carga de modelos bajo demanda con apagado automático por inactividad, una sola vía de planificación para modelos principales con un ayudante utilitario opcional y una puerta de enlace API unificada.

El objetivo del proyecto es proporcionar un servidor de inferencia para tu casa. Después de probarlo durante un mes y añadir nuevos modelos, decidí publicarlo para la comunidad. Ten en cuenta que este es un proyecto hobby y que la ayuda concreta para mejorarlo es muy bienvenida. Está basado en información que encontré en Internet y en los foros de NVIDIA. Espero de verdad que ayude a impulsar los homelabs. El enfoque principal es una única DGX Spark y debe funcionar ahí por defecto, aunque el soporte para dos equipos también es bienvenido.

## Documentación

- **[Arquitectura y cómo funciona](docs/architecture.md)** - Entender el stack, el servicio waker y el flujo de peticiones.
- **[Configuración](docs/configuration.md)** - Variables de entorno, ajustes de red y ajuste del waker.
- **[Guía de selección de modelos](docs/models.md)** - Lista detallada de más de 29 modelos soportados, selector rápido y casos de uso.
- **[Integraciones](docs/integrations.md)** - Guías para **Cline** (VS Code) y **OpenCode** (agente de terminal).
- **[Seguridad y acceso remoto](docs/security.md)** - Endurecimiento de SSH y configuración de port forwarding restringido.
- **[Solución de problemas y monitorización](docs/troubleshooting.md)** - Depuración, logs y soluciones a errores comunes.
- **[Uso avanzado](docs/advanced.md)** - Añadir nuevos modelos, configuraciones personalizadas y operación persistente.
- **[Línea base de runtime](docs/runtime-baseline.md)** - Qué imágenes locales espera el repositorio y cómo reconstruirlas.
- **[Herramientas y arnés de validación](tools/README.md)** - Scripts soportados para smoke, soak, inspección y pruebas manuales.
- **[Notas TODO](TODO.md)** - Ideas sobre lo siguiente que quiero hacer.

## Inicio rápido

1. **Clonar el repositorio**
   ```bash
   git clone <repository-url>
   cd dgx-spark-inference-stack
   ```

2. **Crear los directorios necesarios**
   ```bash
   mkdir -p models vllm_cache_huggingface manual_download/openai_gpt-oss-encodings_fix
   ```

3. **Descargar los tokenizadores necesarios (CRÍTICO)**
   El stack requiere la descarga manual de archivos `tiktoken` para los modelos GPT-OSS.
   ```bash
   wget https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/cl100k_base.tiktoken
   wget https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/o200k_base.tiktoken
   ```

4. **Construir las imágenes Docker personalizadas (OBLIGATORIO)**
   El stack usa imágenes vLLM optimizadas que conviene construir localmente para asegurar el máximo rendimiento.
   *   **Tiempo:** Cuenta con unos 20 minutos por imagen.
   *   **Autenticación:** Debes autenticarte en NVIDIA NGC para poder descargar las imágenes base.
       1.  Crea una cuenta de desarrollador en [NVIDIA NGC Catalog](https://catalog.ngc.nvidia.com/) (no puede estar en un país sancionado).
       2.  Ejecuta `docker login nvcr.io` con tus credenciales.
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
   *   **Nota:** `vllm-node-tf5` no se construye hoy desde un Dockerfile local del repo. Si piensas ejecutar Gemma 4 o los Qwen más nuevos sobre la vía TF5, constrúyelo explícitamente con el flujo helper upstream de arriba. Consulta [docs/runtime-baseline.md](docs/runtime-baseline.md) para los pasos exactos y los requisitos de red durante el build.

5. **Levantar el stack**
   ```bash
   # Start gateway and waker only (models start on-demand)
   docker compose up -d

   # Pre-create all enabled model containers once the required local track images exist
   docker compose --profile models up --no-start
   ```

6. **Probar la API**
   ```bash
    # Request to the shipped utility helper
    curl -X POST http://localhost:8009/v1/qwen3.5-0.8b/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" \
     -d '{
          "model": "qwen3.5-0.8b",
       "messages": [{"role": "user", "content": "Hola!"}]
     }'
   ```

7. **Usar el arnés de validación soportado**
   Después del primer `curl` manual exitoso, cambia al flujo de puesta en marcha mantenido por el repositorio en lugar de usar scripts ad hoc:
   ```bash
   bash tools/validate-stack.sh
   bash tools/smoke-gateway.sh
   ```
   Para comandos específicos de arranque, smoke, soak y pruebas manuales por modelo, consulta [tools/README.md](tools/README.md).

## Empieza por aquí si eres nuevo

- Lee [README.md](README.md), luego [docs/architecture.md](docs/architecture.md) y después [tools/README.md](tools/README.md).
- Toma [tools/README.md](tools/README.md) junto con [models.json](models.json) como la fuente operativa de verdad actual.
- Trata como experimentales los modelos fuera del conjunto validado en esta README hasta que el arnés diga lo contrario.

## Requisitos previos
- Docker 20.10+ con Docker Compose
- GPU(s) NVIDIA con soporte CUDA y NVIDIA Container Toolkit
- Host Linux (probado en Ubuntu)

## Contribuir

Los pull requests son muy bienvenidos. :)
Aun así, para mantener la estabilidad, impongo una **plantilla estricta de pull request**.

## ⚠️ Problemas conocidos

### Estado actual de validación

Con el arnés actual y los valores por defecto del repositorio, los únicos **modelos principales validados** en este momento son:

- **`gpt-oss-20b`**
- **`gpt-oss-120b`**
- **`glm-4.7-flash-awq`**

El pequeño ayudante `qwen3.5-0.8b` incluido ahora es el **helper utilitario validado** para títulos y metadatos de sesión, pero no forma parte de ese conjunto de modelos principales validados.

Otros modelos disponibles pueden seguir funcionando, pero más allá de ese helper utilitario validado deben tratarse como **experimentales** y no como opciones recomendadas por defecto hasta que se vuelvan a probar con el tooling actual.

### Modelos experimentales (compatibilidad GB10/CUDA 12.1)

Los siguientes modelos están marcados como **experimentales** por fallos esporádicos en DGX Spark (GPU GB10):

- **Qwen3-Next-80B-A3B-Instruct** - Falla aleatoriamente en la capa de atención lineal
- **Qwen3-Next-80B-A3B-Thinking** - El mismo problema

**Causa raíz:** La GPU GB10 usa CUDA 12.1, pero el stack actual de vLLM/PyTorch solo soporta CUDA ≤12.0. Eso provoca errores `cudaErrorIllegalInstruction` tras varias peticiones exitosas.

**Solución temporal:** Usa `gpt-oss-20b` o `gpt-oss-120b` para tool calling estable hasta que exista una imagen vLLM actualizada con soporte correcto para GB10.

### Nemotron 3 Nano 30B (NVFP4)

El modelo **`nemotron-3-nano-30b-nvfp4`** ya está reactivado en la vía estándar `vllm-node` actualizada, pero con el arnés actual debe seguir tratándose como **experimental**.
**Estado actual:** Ahora carga y responde peticiones sobre el runtime actualizado, pero no forma parte del conjunto de modelos principales validados ni de la configuración OpenCode distribuida.
**Comportamiento importante:** El contenido visible del asistente depende de la forma de petición sin thinking. El validador de peticiones ahora inyecta ese valor por defecto para las peticiones normales a través del gateway.
**Techo conservador actual para clientes:** Unos `100000` tokens de prompt para uso manual estilo OpenCode/Cline. El soak activo a cinco vías del stack pasa limpio en torno a `101776` tokens de prompt y ya va justo alrededor de `116298`.

### Soporte de imágenes/capturas en OpenCode sobre Linux

OpenCode (agente de IA en terminal) tiene un bug conocido en Linux por el que **las imágenes del portapapeles y las imágenes por ruta de archivo no funcionan** con modelos de visión. El modelo responde con "The model you're using does not support image input" aunque los modelos VL sí funcionan correctamente por API.

**Causa raíz:** El manejo del portapapeles en Linux dentro de OpenCode corrompe los datos binarios de la imagen antes de codificarlos (usa `.text()` en vez de `.arrayBuffer()`). En la práctica no se envía ningún dato de imagen al servidor.

**Estado:** Parece ser un bug del cliente OpenCode. Se agradece ayuda para investigarlo o arreglarlo. El stack de inferencia sí procesa imágenes base64 correctamente cuando se envían bien con `curl` u otros clientes API.

**Solución temporal:** Usa `curl` u otros clientes API para enviar imágenes directamente a modelos VL como `qwen2.5-vl-7b`.

### Qwen 2.5 Coder 7B e incompatibilidad con OpenCode

El modelo `qwen2.5-coder-7b-instruct` tiene un límite estricto de contexto de **32.768 tokens**. Sin embargo, OpenCode suele enviar peticiones muy grandes (buffer + input) que superan los **35.000 tokens**, lo que provoca `ValueError` y fallos de petición.

**Recomendación:** No uses `qwen2.5-coder-7b` con OpenCode para tareas de contexto largo. Usa en su lugar **`qwen3-coder-30b-instruct`**, que soporta **65.536 tokens** de contexto y maneja con más margen las peticiones grandes de OpenCode.

### Llama 3.3 e incompatibilidad con OpenCode

El modelo **`llama-3.3-70b-instruct-fp4`** **no está recomendado para OpenCode**.
**Motivo:** Aunque el modelo funciona correctamente por API, muestra un comportamiento agresivo de tool calling cuando se inicializa con los prompts específicos del cliente OpenCode. Eso genera errores de validación y una peor experiencia, por ejemplo cuando intenta llamar herramientas inmediatamente después de un saludo.
**Recomendación:** Usa `gpt-oss-20b` o `qwen3-next-80b-a3b-instruct` para sesiones OpenCode.

## Créditos

Gracias especialmente a los miembros de la comunidad que hicieron posibles las imágenes Docker optimizadas que usa este stack:

- **Thomas P. Braun de Avarok**: Por la imagen vLLM de propósito general (`avarok/vllm-dgx-spark`) con soporte para activaciones no gated (Nemotron), modelos híbridos y publicaciones como https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6.
- **Christopher Owen**: Por la imagen vLLM optimizada para MXFP4 (`christopherowen/vllm-dgx-spark`) que habilita inferencia de alto rendimiento en DGX Spark.
- **eugr**: Por todo el trabajo en las personalizaciones de la imagen vLLM original (`eugr/vllm-dgx-spark`) y sus excelentes publicaciones en los foros de NVIDIA.
- **Patrick Yi / scitrera.ai**: Por la receta SGLang para modelos utilitarios que inspiró la vía local del helper `qwen3.5-0.8b`.

## Licencia

Este proyecto está licenciado bajo la **Apache License 2.0**. Consulta [LICENSE](LICENSE) para más detalles.
