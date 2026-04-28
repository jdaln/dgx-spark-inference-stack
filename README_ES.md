# DGX Spark Inference Stack - ¡Ponlo al servicio de tu casa!

🌍 **Lee esto en otros idiomas**:
[Deutsch](README_DE.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Italiano](README_IT.md) | [日本語](README_JA.md) | [简体中文](README_ZH_CN.md) | [繁體中文](README_ZH_TW.md) | [Русский](README_RU.md) | [Українська](README_UK.md) | [Português](README_PT.md) | [한국어](README_KO.md) | [العربية](README_AR.md) | [Tiếng Việt](README_VI.md) | [Türkçe](README_TR.md)

> **Aviso de traducción por IA:** Este archivo fue traducido por IA a partir de [README.md](README.md) y puede contener errores o ir por detrás de la versión en inglés. Si hay alguna duda, manda la README en inglés.

Tu Nvidia DGX Spark no debería ser otro proyecto secundario. Úsalo. Este es un stack de inferencia basado en Docker para servir modelos grandes de lenguaje (LLM) con NVIDIA vLLM y gestión inteligente de recursos. Este stack ofrece carga de modelos bajo demanda con apagado automático por inactividad, una sola vía de planificación para modelos principales con un ayudante utilitario opcional y una puerta de enlace API unificada.

El objetivo del proyecto es proporcionar un servidor de inferencia para tu casa. Después de probarlo durante un mes y añadir nuevos modelos, decidí publicarlo para la comunidad. Ten en cuenta que este es un proyecto hobby y que la ayuda concreta para mejorarlo es muy bienvenida. Está basado en información que encontré en Internet y en los foros de NVIDIA. Espero de verdad que ayude a impulsar los homelabs. El enfoque principal es una única DGX Spark y debe funcionar ahí por defecto, aunque el soporte para dos equipos también es bienvenido.

## Documentación

- **[Arquitectura y cómo funciona](docs/architecture.md)** - Entender el stack, el servicio waker y el flujo de peticiones.
- **[Configuración](docs/configuration.md)** - Variables de entorno, ajustes de red y ajuste del waker.
- **[Guía de selección de modelos](docs/models.md)** - Catálogo actual de modelos, selector rápido y estado de validación.
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
    curl -X POST http://localhost:8009/v1/chat/completions\
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

- Lee [docs/architecture.md](docs/architecture.md) y después [tools/README.md](tools/README.md).
- Toma [tools/README.md](tools/README.md) junto con [models.json](models.json) como la fuente operativa de verdad actual.
- Toma esta README como punto de entrada corto, no como catálogo completo de modelos. Usa [docs/models.md](docs/models.md) para el catálogo más amplio.

## Requisitos previos
- Docker 20.10+ con Docker Compose
- GPU(s) NVIDIA con soporte CUDA y NVIDIA Container Toolkit
- Host Linux (probado en Ubuntu)

## Contribuir

Los pull requests son muy bienvenidos. :)
Aun así, para mantener la estabilidad, impongo una **plantilla estricta de pull request**.

## Estado actual

Esta README solo destaca los valores por defecto actualmente recomendados del stack.

- **Modelos principales validados:** `gpt-oss-20b`, `gpt-oss-120b` y `glm-4.7-flash-awq`
- **Helper utilitario validado:** `qwen3.5-0.8b` para títulos y metadatos de sesión
- **Todo lo demás:** Está disponible en el repositorio, pero no es un valor por defecto de esta README hasta que se vuelva a validar con el arnés actual

Para el catálogo más amplio de modelos, las vías experimentales y los casos manuales, usa [docs/models.md](docs/models.md) y [models.json](models.json).

Para advertencias de cliente, particularidades del runtime y notas de troubleshooting, usa [docs/integrations.md](docs/integrations.md) y [docs/troubleshooting.md](docs/troubleshooting.md).

## Créditos

Gracias especialmente a los miembros de la comunidad cuyo trabajo en imágenes Docker y recetas inspiró este stack:

- **Thomas P. Braun de Avarok**: Por la imagen vLLM de propósito general (`avarok/vllm-dgx-spark`) con soporte para activaciones no gated (Nemotron), modelos híbridos y publicaciones como https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6.
- **Christopher Owen**: Por la imagen vLLM optimizada para MXFP4 (`christopherowen/vllm-dgx-spark`) que habilita inferencia de alto rendimiento en DGX Spark.
- **eugr**: Por el repositorio comunitario original de vLLM para DGX Spark (`eugr/spark-vllm-docker`), sus personalizaciones y sus excelentes publicaciones en los foros de NVIDIA.
- **Patrick Yi / scitrera.ai**: Por la receta SGLang para modelos utilitarios que inspiró la vía local del helper `qwen3.5-0.8b`.
- **Raphael Amorim**: Por la forma de receta comunitaria de AutoRound que informó la vía experimental local `qwen3.5-122b-a10b-int4-autoround`.
- **Bjarke Bolding**: Por la forma de receta AutoRound para contexto largo que informó la vía experimental local `qwen3-coder-next-int4-autoround`.

## Licencia

Este proyecto está licenciado bajo la **Apache License 2.0**. Consulta [LICENSE](LICENSE) para más detalles.
