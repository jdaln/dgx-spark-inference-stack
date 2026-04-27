# DGX Spark Inference Stack - Пусть он реально служит дому!

🌍 **Читайте на других языках**:
[Deutsch](README_DE.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Italiano](README_IT.md) | [日本語](README_JA.md) | [简体中文](README_ZH_CN.md) | [繁體中文](README_ZH_TW.md) | [Русский](README_RU.md) | [Українська](README_UK.md) | [Português](README_PT.md) | [한국어](README_KO.md) | [العربية](README_AR.md) | [Tiếng Việt](README_VI.md) | [Türkçe](README_TR.md)

> **Примечание об AI-переводе:** Этот файл переведён с помощью ИИ на основе [README.md](README.md). В нём могут быть ошибки, и он может отставать от английской версии. Если есть сомнения, ориентируйтесь на английский README.

Ваш Nvidia DGX Spark не должен быть ещё одним проектом «когда-нибудь потом». Используйте его по-настоящему. Это стек инференса на базе Docker для обслуживания больших языковых моделей (LLM) с помощью NVIDIA vLLM и умного управления ресурсами. Стек даёт загрузку моделей по требованию с автоматическим отключением при простое, одну основную линию планирования для main-model с опциональным utility-helper и единый API-шлюз.

Цель проекта — дать домашний сервер инференса. После месяца тестов и добавления новых моделей я решил выложить его для сообщества. Пожалуйста, учитывайте, что это hobby-проект, и любая конкретная помощь по улучшению очень приветствуется. Он основан на информации, которую я нашёл в интернете и на форумах NVIDIA. Очень надеюсь, что это поможет развитию homelab-сценариев. Основной фокус — одиночный DGX Spark, и по умолчанию всё должно работать именно на нём, но поддержка двух устройств тоже приветствуется.

## Документация

- **[Архитектура и как это работает](docs/architecture.md)** - Понять стек, сервис waker и поток запросов.
- **[Конфигурация](docs/configuration.md)** - Переменные окружения, сетевые настройки и тюнинг waker.
- **[Руководство по выбору моделей](docs/models.md)** - Подробный список 29+ поддерживаемых моделей, быстрый выбор и сценарии использования.
- **[Интеграции](docs/integrations.md)** - Гайды для **Cline** (VS Code) и **OpenCode** (терминальный агент).
- **[Безопасность и удалённый доступ](docs/security.md)** - Усиление SSH и настройка ограниченного проброса портов.
- **[Диагностика и мониторинг](docs/troubleshooting.md)** - Отладка, логи и решения типичных ошибок.
- **[Продвинутое использование](docs/advanced.md)** - Добавление новых моделей, кастомные конфигурации и постоянная работа.
- **[Базовая линия runtime](docs/runtime-baseline.md)** - Какие локальные image-track ожидает репозиторий и как их пересобрать.
- **[Инструменты и validation harness](tools/README.md)** - Поддерживаемые smoke, soak, inspection и manual probe скрипты.
- **[Заметки TODO](TODO.md)** - Идеи, что делать дальше.

## Быстрый старт

1. **Клонируйте репозиторий**
   ```bash
   git clone <repository-url>
   cd dgx-spark-inference-stack
   ```

2. **Создайте необходимые директории**
   ```bash
   mkdir -p models vllm_cache_huggingface manual_download/openai_gpt-oss-encodings_fix
   ```

3. **Скачайте необходимые tokenizers (КРИТИЧНО)**
   Для GPT-OSS моделей стек требует вручную скачать файлы `tiktoken`.
   ```bash
   wget https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/cl100k_base.tiktoken
   wget https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/o200k_base.tiktoken
   ```

4. **Соберите кастомные Docker-образы (ОБЯЗАТЕЛЬНО)**
   Стек использует оптимизированные образы vLLM, которые стоит собирать локально для максимальной производительности.
   *   **Время:** Закладывайте примерно 20 минут на образ.
   *   **Аутентификация:** Нужно войти в NVIDIA NGC, чтобы тянуть базовые образы.
       1.  Создайте аккаунт разработчика в [NVIDIA NGC Catalog](https://catalog.ngc.nvidia.com/) (не из страны под санкциями).
       2.  Выполните `docker login nvcr.io` со своими учётными данными.
   *   **Команды сборки:**
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
   *   **Примечание:** `vllm-node-tf5` сейчас не собирается из локального Dockerfile этого репозитория. Если вы планируете запускать Gemma 4 или более новые TF5-варианты Qwen, соберите его явно через upstream helper flow выше. См. [docs/runtime-baseline.md](docs/runtime-baseline.md) для точных шагов и сетевых требований во время сборки.

5. **Запустите стек**
   ```bash
   # Start gateway and waker only (models start on-demand)
   docker compose up -d

   # Pre-create all enabled model containers once the required local track images exist
   docker compose --profile models up --no-start
   ```

6. **Проверьте API**
   ```bash
    # Request to the shipped utility helper
    curl -X POST http://localhost:8009/v1/qwen3.5-0.8b/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" \
     -d '{
          "model": "qwen3.5-0.8b",
       "messages": [{"role": "user", "content": "Привет!"}]
     }'
   ```

7. **Используйте поддерживаемый validation harness**
   После первого успешного ручного `curl` переходите на поддерживаемый в репозитории bring-up flow вместо ad hoc скриптов:
   ```bash
   bash tools/validate-stack.sh
   bash tools/smoke-gateway.sh
   ```
   Команды bring-up, smoke, soak и manual probe для конкретных моделей смотрите в [tools/README.md](tools/README.md).

## Если вы здесь впервые

- Сначала прочитайте [README.md](README.md), потом [docs/architecture.md](docs/architecture.md), затем [tools/README.md](tools/README.md).
- Считайте [tools/README.md](tools/README.md) вместе с [models.json](models.json) текущим операционным источником истины.
- Модели вне validated-набора в этом README считайте экспериментальными, пока harness не скажет обратное.

## Требования
- Docker 20.10+ с Docker Compose
- NVIDIA GPU с поддержкой CUDA и NVIDIA Container Toolkit
- Linux-хост (проверено на Ubuntu)

## Вклад

Pull request'ы очень приветствуются. :)
Но для стабильности я придерживаюсь строгого **Pull Request Template**.

## ⚠️ Известные проблемы

### Текущий статус валидации

С текущим harness и дефолтами репозитория сейчас есть только следующие **валидированные основные модели**:

- **`gpt-oss-20b`**
- **`gpt-oss-120b`**
- **`glm-4.7-flash-awq`**

Поставляемый маленький helper `qwen3.5-0.8b` теперь является **валидированным utility helper** для заголовков и метаданных сессий, но не входит в этот validated main-model set.

Другие доступные модели тоже могут работать, но за пределами этого validated helper их стоит считать **экспериментальными**, а не рекомендованными дефолтами, пока они не будут повторно проверены текущим инструментарием.

### Экспериментальные модели (совместимость GB10 / CUDA 12.1)

Следующие модели помечены как **экспериментальные** из-за периодических падений на DGX Spark (GPU GB10):

- **Qwen3-Next-80B-A3B-Instruct** - Случайно падает в слое линейного attention
- **Qwen3-Next-80B-A3B-Thinking** - Та же проблема

**Корневая причина:** GPU GB10 использует CUDA 12.1, но текущий стек vLLM / PyTorch поддерживает только CUDA ≤12.0. Это вызывает `cudaErrorIllegalInstruction` после нескольких успешных запросов.

**Обходной путь:** Используйте `gpt-oss-20b` или `gpt-oss-120b` для стабильного tool calling, пока не появится обновлённый vLLM image с корректной поддержкой GB10.

### Nemotron 3 Nano 30B (NVFP4)

Модель **`nemotron-3-nano-30b-nvfp4`** снова включена на обновлённом стандартном треке `vllm-node`, но с текущим harness её всё ещё нужно считать **экспериментальной**.
**Текущий статус:** Она теперь загружается и отвечает на запросы в обновлённом runtime, но не входит ни в validated main-model set, ни в поставляемую конфигурацию OpenCode.
**Важное поведение:** Видимый assistant content зависит от non-thinking формы запроса. Теперь request validator подставляет это значение по умолчанию для обычных gateway-запросов.
**Текущий консервативный клиентский потолок:** Около `100000` prompt tokens для ручного использования в стиле OpenCode / Cline. Активный five-way soak проходит чисто примерно на `101776` prompt tokens и уже находится на грани примерно на `116298`.

### Поддержка изображений / скриншотов OpenCode на Linux

У OpenCode (терминальный ИИ-агент) есть известная проблема на Linux: **изображения из буфера обмена и изображения по файловому пути не работают** с vision-моделями. Модель отвечает "The model you're using does not support image input", хотя VL-модели корректно работают через API.

**Корневая причина:** Linux-обработка буфера обмена в OpenCode портит бинарные данные изображения до кодирования (используется `.text()` вместо `.arrayBuffer()`). В итоге данные изображения вообще не отправляются на сервер.

**Статус:** Похоже, это баг на стороне клиента OpenCode. Помощь в исследовании или исправлении приветствуется. Сам inference stack корректно обрабатывает base64-изображения, если они отправлены правильно через `curl` или другой API-клиент.

**Обходной путь:** Используйте `curl` или другие API-клиенты, чтобы отправлять изображения напрямую в VL-модели, например `qwen2.5-vl-7b`.

### Qwen 2.5 Coder 7B и несовместимость с OpenCode

Модель `qwen2.5-coder-7b-instruct` имеет жёсткий лимит контекста в **32 768 токенов**. Но OpenCode обычно отправляет очень большие запросы (buffer + input), превышающие **35 000 токенов**, что приводит к `ValueError` и сбоям запросов.

**Рекомендация:** Не используйте `qwen2.5-coder-7b` с OpenCode для задач с длинным контекстом. Вместо этого используйте **`qwen3-coder-30b-instruct`**, который поддерживает **65 536 токенов** контекста и заметно лучше справляется с большими запросами OpenCode.

### Llama 3.3 и несовместимость с OpenCode

Модель **`llama-3.3-70b-instruct-fp4`** **не рекомендуется для OpenCode**.
**Причина:** Хотя модель корректно работает через API, она показывает слишком агрессивное поведение tool calling при инициализации специфическими client prompts OpenCode. Это приводит к validation errors и ухудшает пользовательский опыт, например модель пытается вызвать инструменты сразу после приветствия.
**Рекомендация:** Для сессий OpenCode используйте `gpt-oss-20b` или `qwen3-next-80b-a3b-instruct`.

## Благодарности

Отдельное спасибо участникам сообщества, благодаря которым появились оптимизированные Docker-образы, используемые этим стеком:

- **Thomas P. Braun из Avarok**: За универсальный vLLM image (`avarok/vllm-dgx-spark`) с поддержкой non-gated activations (Nemotron), гибридных моделей и публикации вроде https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6.
- **Christopher Owen**: За оптимизированный для MXFP4 vLLM image (`christopherowen/vllm-dgx-spark`), который делает возможным высокопроизводительный inference на DGX Spark.
- **eugr**: За всю работу над кастомизацией оригинального vLLM image (`eugr/vllm-dgx-spark`) и отличные публикации на форумах NVIDIA.
- **Patrick Yi / scitrera.ai**: За рецепт utility-model на SGLang, который повлиял на локальный путь helper-модели `qwen3.5-0.8b`.

## Лицензия

Проект распространяется по лицензии **Apache License 2.0**. Подробности см. в файле [LICENSE](LICENSE).
