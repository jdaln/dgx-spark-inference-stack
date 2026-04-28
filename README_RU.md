# DGX Spark Inference Stack - Пусть он реально служит дому!

🌍 **Читайте на других языках**:
[Deutsch](README_DE.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Italiano](README_IT.md) | [日本語](README_JA.md) | [简体中文](README_ZH_CN.md) | [繁體中文](README_ZH_TW.md) | [Русский](README_RU.md) | [Українська](README_UK.md) | [Português](README_PT.md) | [한국어](README_KO.md) | [العربية](README_AR.md) | [Tiếng Việt](README_VI.md) | [Türkçe](README_TR.md)

> **Примечание об AI-переводе:** Этот файл переведён с помощью ИИ на основе [README.md](README.md). В нём могут быть ошибки, и он может отставать от английской версии. Если есть сомнения, ориентируйтесь на английский README.

Ваш Nvidia DGX Spark не должен быть ещё одним проектом «когда-нибудь потом». Используйте его по-настоящему. Это стек инференса на базе Docker для обслуживания больших языковых моделей (LLM) с помощью NVIDIA vLLM и умного управления ресурсами. Стек даёт загрузку моделей по требованию с автоматическим отключением при простое, одну основную линию планирования для main-model с опциональным utility-helper и единый API-шлюз.

Цель проекта — дать домашний сервер инференса. После месяца тестов и добавления новых моделей я решил выложить его для сообщества. Пожалуйста, учитывайте, что это hobby-проект, и любая конкретная помощь по улучшению очень приветствуется. Он основан на информации, которую я нашёл в интернете и на форумах NVIDIA. Очень надеюсь, что это поможет развитию homelab-сценариев. Основной фокус — одиночный DGX Spark, и по умолчанию всё должно работать именно на нём, но поддержка двух устройств тоже приветствуется.

## Документация

- **[Архитектура и как это работает](docs/architecture.md)** - Понять стек, сервис waker и поток запросов.
- **[Конфигурация](docs/configuration.md)** - Переменные окружения, сетевые настройки и тюнинг waker.
- **[Руководство по выбору моделей](docs/models.md)** - Актуальный каталог моделей, быстрый выбор и статус валидации.
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
    curl -X POST http://localhost:8009/v1/chat/completions\
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

- Сначала прочитайте [docs/architecture.md](docs/architecture.md), затем [tools/README.md](tools/README.md).
- Считайте [tools/README.md](tools/README.md) вместе с [models.json](models.json) текущим операционным источником истины.
- Считайте этот README краткой точкой входа, а не полным каталогом моделей. Для более широкого каталога используйте [docs/models.md](docs/models.md).

## Требования
- Docker 20.10+ с Docker Compose
- NVIDIA GPU с поддержкой CUDA и NVIDIA Container Toolkit
- Linux-хост (проверено на Ubuntu)

## Вклад

Pull request'ы очень приветствуются. :)
Но для стабильности я придерживаюсь строгого **Pull Request Template**.

## Текущее состояние

Этот README теперь кратко показывает только текущие рекомендуемые варианты по умолчанию для стека.

- **Валидированные основные модели:** `gpt-oss-20b`, `gpt-oss-120b` и `glm-4.7-flash-awq`
- **Валидированный utility helper:** `qwen3.5-0.8b` для заголовков и метаданных сессий
- **Всё остальное:** Есть в репозитории, но не считается выбором по умолчанию для этого README, пока не будет повторно проверено текущим harness

Для более широкого каталога моделей, экспериментальных путей и ручных сценариев используйте [docs/models.md](docs/models.md) и [models.json](models.json).

Для клиентских оговорок, особенностей runtime и заметок по troubleshooting используйте [docs/integrations.md](docs/integrations.md) и [docs/troubleshooting.md](docs/troubleshooting.md).

## Благодарности

Отдельное спасибо участникам сообщества, чьи Docker-образы и работа над рецептами повлияли на этот стек:

- **Thomas P. Braun из Avarok**: За универсальный vLLM image (`avarok/vllm-dgx-spark`) с поддержкой non-gated activations (Nemotron), гибридных моделей и публикации вроде https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6.
- **Christopher Owen**: За оптимизированный для MXFP4 vLLM image (`christopherowen/vllm-dgx-spark`), который делает возможным высокопроизводительный inference на DGX Spark.
- **eugr**: За исходный community-репозиторий vLLM для DGX Spark (`eugr/spark-vllm-docker`), его кастомизации и отличные публикации на форумах NVIDIA.
- **Patrick Yi / scitrera.ai**: За рецепт utility-model на SGLang, который повлиял на локальный путь helper-модели `qwen3.5-0.8b`.
- **Raphael Amorim**: За community-форму AutoRound-рецепта, которая повлияла на экспериментальный локальный путь `qwen3.5-122b-a10b-int4-autoround`.
- **Bjarke Bolding**: За форму AutoRound-рецепта для длинного контекста, которая повлияла на экспериментальный локальный путь `qwen3-coder-next-int4-autoround`.

## Лицензия

Проект распространяется по лицензии **Apache License 2.0**. Подробности см. в файле [LICENSE](LICENSE).
