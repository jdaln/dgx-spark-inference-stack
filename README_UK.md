# DGX Spark Inference Stack - Нехай він реально працює для дому!

🌍 **Читайте іншими мовами**:
[Deutsch](README_DE.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Italiano](README_IT.md) | [日本語](README_JA.md) | [简体中文](README_ZH_CN.md) | [繁體中文](README_ZH_TW.md) | [Русский](README_RU.md) | [Українська](README_UK.md) | [Português](README_PT.md) | [한국어](README_KO.md) | [العربية](README_AR.md) | [Tiếng Việt](README_VI.md) | [Türkçe](README_TR.md)

> **Позначка про AI-переклад:** Цей файл перекладено за допомогою ШІ на основі [README.md](README.md). У ньому можуть бути помилки, і він може відставати від англомовної версії. Якщо є сумніви, орієнтуйтеся на англійський README.

Ваш Nvidia DGX Spark не повинен бути ще одним побічним проєктом. Його варто реально використовувати. Це Docker-базований стек інференсу для обслуговування великих мовних моделей (LLM) за допомогою NVIDIA vLLM та розумного керування ресурсами. Стек надає завантаження моделей на вимогу з автоматичним вимкненням у разі простою, одну основну лінію планування для main-model з необов'язковим utility-helper та єдиний API gateway.

Мета проєкту — дати домашній сервер інференсу. Після місяця тестування та додавання нових моделей я вирішив опублікувати його для спільноти. Будь ласка, враховуйте, що це hobby-проєкт, і будь-яка конкретна допомога для покращення дуже вітається. Він спирається на інформацію, яку я знайшов в інтернеті та на форумах NVIDIA. Дуже сподіваюся, що це допоможе рухати вперед homelab-сценарії. Основний фокус — один DGX Spark, і за замовчуванням усе має працювати саме на ньому, але підтримка двох пристроїв теж вітається.

## Документація

- **[Архітектура і як це працює](docs/architecture.md)** - Зрозуміти стек, сервіс waker і потік запитів.
- **[Конфігурація](docs/configuration.md)** - Змінні середовища, мережеві налаштування та тюнінг waker.
- **[Посібник з вибору моделей](docs/models.md)** - Поточний каталог моделей, швидкий вибір і статус валідації.
- **[Інтеграції](docs/integrations.md)** - Інструкції для **Cline** (VS Code) і **OpenCode** (термінальний агент).
- **[Безпека та віддалений доступ](docs/security.md)** - Посилення SSH і налаштування обмеженого port forwarding.
- **[Діагностика та моніторинг](docs/troubleshooting.md)** - Налагодження, логи та розв'язання типових помилок.
- **[Розширене використання](docs/advanced.md)** - Додавання нових моделей, власні конфігурації та постійна робота.
- **[Базова лінія runtime](docs/runtime-baseline.md)** - Які локальні image-track очікує репозиторій і як їх перебудувати.
- **[Інструменти та validation harness](tools/README.md)** - Підтримувані smoke, soak, inspection і manual probe скрипти.
- **[Нотатки TODO](TODO.md)** - Ідеї про те, що робити далі.

## Швидкий старт

1. **Склонуйте репозиторій**
   ```bash
   git clone <repository-url>
   cd dgx-spark-inference-stack
   ```

2. **Створіть потрібні каталоги**
   ```bash
   mkdir -p models vllm_cache_huggingface manual_download/openai_gpt-oss-encodings_fix
   ```

3. **Завантажте потрібні tokenizer'и (КРИТИЧНО)**
   Для GPT-OSS моделей стек вимагає вручну завантажити файли `tiktoken`.
   ```bash
   wget https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/cl100k_base.tiktoken
   wget https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/o200k_base.tiktoken
   ```

4. **Зберіть кастомні Docker-образи (ОБОВ'ЯЗКОВО)**
   Стек використовує оптимізовані vLLM-образи, які варто збирати локально для максимальної продуктивності.
   *   **Час:** Закладайте приблизно 20 хвилин на один образ.
   *   **Автентифікація:** Потрібно увійти до NVIDIA NGC, щоб тягнути базові образи.
       1.  Створіть акаунт розробника в [NVIDIA NGC Catalog](https://catalog.ngc.nvidia.com/) (не з країни під санкціями).
       2.  Виконайте `docker login nvcr.io` зі своїми обліковими даними.
   *   **Команди збирання:**
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
   *   **Примітка:** `vllm-node-tf5` зараз не збирається з локального Dockerfile цього репозиторію. Якщо ви плануєте запускати Gemma 4 або новіші TF5-варіанти Qwen, зберіть його явно через upstream helper flow вище. Див. [docs/runtime-baseline.md](docs/runtime-baseline.md) для точних кроків і мережевих вимог під час збирання.

5. **Запустіть стек**
   ```bash
   # Start gateway and waker only (models start on-demand)
   docker compose up -d

   # Pre-create all enabled model containers once the required local track images exist
   docker compose --profile models up --no-start
   ```

6. **Перевірте API**
   ```bash
    # Request to the shipped utility helper
    curl -X POST http://localhost:8009/v1/qwen3.5-0.8b/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" \
     -d '{
          "model": "qwen3.5-0.8b",
       "messages": [{"role": "user", "content": "Привіт!"}]
     }'
   ```

7. **Використовуйте підтримуваний validation harness**
   Після першого успішного ручного `curl` переходьте на bring-up flow, який підтримується в репозиторії, замість ad hoc скриптів:
   ```bash
   bash tools/validate-stack.sh
   bash tools/smoke-gateway.sh
   ```
   Команди bring-up, smoke, soak і manual probe для конкретних моделей дивіться в [tools/README.md](tools/README.md).

## Якщо ви тут уперше

- Спочатку прочитайте [docs/architecture.md](docs/architecture.md), потім [tools/README.md](tools/README.md).
- Вважайте [tools/README.md](tools/README.md) разом із [models.json](models.json) поточним операційним джерелом правди.
- Вважайте цей README короткою точкою входу, а не повним каталогом моделей. Для ширшого каталогу використовуйте [docs/models.md](docs/models.md).

## Вимоги
- Docker 20.10+ з Docker Compose
- NVIDIA GPU з підтримкою CUDA та NVIDIA Container Toolkit
- Linux-хост (перевірено на Ubuntu)

## Внесок

Pull request'и дуже вітаються. :)
Але для стабільності я дотримуюся суворого **Pull Request Template**.

## Поточний стан

Цей README тепер коротко показує лише поточні рекомендовані варіанти за замовчуванням для стека.

- **Валідовані основні моделі:** `gpt-oss-20b`, `gpt-oss-120b` і `glm-4.7-flash-awq`
- **Валідований utility helper:** `qwen3.5-0.8b` для заголовків і метаданих сесії
- **Усе інше:** Є в репозиторії, але не вважається вибором за замовчуванням для цього README, доки не буде повторно перевірене поточним harness

Для ширшого каталогу моделей, експериментальних шляхів і ручних сценаріїв використовуйте [docs/models.md](docs/models.md) і [models.json](models.json).

Для клієнтських застережень, особливостей runtime і нотаток з troubleshooting використовуйте [docs/integrations.md](docs/integrations.md) та [docs/troubleshooting.md](docs/troubleshooting.md).

## Подяки

Окрема подяка учасникам спільноти, чиї Docker-образи й робота над рецептами вплинули на цей стек:

- **Thomas P. Braun з Avarok**: За універсальний vLLM image (`avarok/vllm-dgx-spark`) з підтримкою non-gated activations (Nemotron), гібридних моделей і публікації на кшталт https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6.
- **Christopher Owen**: За оптимізований для MXFP4 vLLM image (`christopherowen/vllm-dgx-spark`), який робить можливим високопродуктивний inference на DGX Spark.
- **eugr**: За оригінальний community-репозиторій vLLM для DGX Spark (`eugr/spark-vllm-docker`), його кастомізації та чудові дописи на форумах NVIDIA.
- **Patrick Yi / scitrera.ai**: За SGLang-рецепт utility-model, який вплинув на локальний шлях helper-моделі `qwen3.5-0.8b`.
- **Raphael Amorim**: За community-форму AutoRound-рецепта, яка вплинула на експериментальний локальний шлях `qwen3.5-122b-a10b-int4-autoround`.
- **Bjarke Bolding**: За форму AutoRound-рецепта для довгого контексту, яка вплинула на експериментальний локальний шлях `qwen3-coder-next-int4-autoround`.

## Ліцензія

Проєкт поширюється за ліцензією **Apache License 2.0**. Деталі див. у файлі [LICENSE](LICENSE).
