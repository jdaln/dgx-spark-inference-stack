# DGX Spark Inference Stack - Нехай він реально працює для дому!

🌍 **Читайте іншими мовами**:
[Deutsch](README_DE.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Italiano](README_IT.md) | [日本語](README_JA.md) | [简体中文](README_ZH_CN.md) | [繁體中文](README_ZH_TW.md) | [Русский](README_RU.md) | [Українська](README_UK.md) | [Português](README_PT.md) | [한국어](README_KO.md) | [العربية](README_AR.md) | [Tiếng Việt](README_VI.md) | [Türkçe](README_TR.md)

> **Позначка про AI-переклад:** Цей файл перекладено за допомогою ШІ на основі [README.md](README.md). У ньому можуть бути помилки, і він може відставати від англомовної версії. Якщо є сумніви, орієнтуйтеся на англійський README.

Ваш Nvidia DGX Spark не повинен бути ще одним побічним проєктом. Його варто реально використовувати. Це Docker-базований стек інференсу для обслуговування великих мовних моделей (LLM) за допомогою NVIDIA vLLM та розумного керування ресурсами. Стек надає завантаження моделей на вимогу з автоматичним вимкненням у разі простою, одну основну лінію планування для main-model з необов'язковим utility-helper та єдиний API gateway.

Мета проєкту — дати домашній сервер інференсу. Після місяця тестування та додавання нових моделей я вирішив опублікувати його для спільноти. Будь ласка, враховуйте, що це hobby-проєкт, і будь-яка конкретна допомога для покращення дуже вітається. Він спирається на інформацію, яку я знайшов в інтернеті та на форумах NVIDIA. Дуже сподіваюся, що це допоможе рухати вперед homelab-сценарії. Основний фокус — один DGX Spark, і за замовчуванням усе має працювати саме на ньому, але підтримка двох пристроїв теж вітається.

## Документація

- **[Архітектура і як це працює](docs/architecture.md)** - Зрозуміти стек, сервіс waker і потік запитів.
- **[Конфігурація](docs/configuration.md)** - Змінні середовища, мережеві налаштування та тюнінг waker.
- **[Посібник з вибору моделей](docs/models.md)** - Детальний список 29+ підтримуваних моделей, швидкий вибір і сценарії використання.
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

- Спочатку прочитайте [README.md](README.md), потім [docs/architecture.md](docs/architecture.md), потім [tools/README.md](tools/README.md).
- Вважайте [tools/README.md](tools/README.md) разом із [models.json](models.json) поточним операційним джерелом правди.
- Моделі поза validated-набором у цьому README вважайте експериментальними, доки harness не скаже інакше.

## Вимоги
- Docker 20.10+ з Docker Compose
- NVIDIA GPU з підтримкою CUDA та NVIDIA Container Toolkit
- Linux-хост (перевірено на Ubuntu)

## Внесок

Pull request'и дуже вітаються. :)
Але для стабільності я дотримуюся суворого **Pull Request Template**.

## ⚠️ Відомі проблеми

### Поточний стан валідації

З поточним harness і дефолтами репозиторію зараз є лише такі **валідовані основні моделі**:

- **`gpt-oss-20b`**
- **`gpt-oss-120b`**
- **`glm-4.7-flash-awq`**

Постачуваний малий helper `qwen3.5-0.8b` тепер є **валідованим utility helper** для заголовків і метаданих сесії, але не входить до цього validated main-model set.

Інші доступні моделі теж можуть працювати, але поза цим validated helper їх слід вважати **експериментальними**, а не рекомендованими дефолтами, доки вони не будуть повторно перевірені поточним інструментарієм.

### Експериментальні моделі (сумісність GB10 / CUDA 12.1)

Наведені нижче моделі позначені як **експериментальні** через періодичні падіння на DGX Spark (GPU GB10):

- **Qwen3-Next-80B-A3B-Instruct** - Випадково падає в шарі лінійної attention
- **Qwen3-Next-80B-A3B-Thinking** - Та сама проблема

**Коренева причина:** GPU GB10 використовує CUDA 12.1, але поточний стек vLLM / PyTorch підтримує лише CUDA ≤12.0. Через це після кількох успішних запитів виникає `cudaErrorIllegalInstruction`.

**Обхідний шлях:** Використовуйте `gpt-oss-20b` або `gpt-oss-120b` для стабільного tool calling, доки не з'явиться оновлений vLLM image з коректною підтримкою GB10.

### Nemotron 3 Nano 30B (NVFP4)

Модель **`nemotron-3-nano-30b-nvfp4`** знову ввімкнена на оновленому стандартному треку `vllm-node`, але з поточним harness її все ще слід вважати **експериментальною**.
**Поточний статус:** Тепер вона завантажується і відповідає на запити в оновленому runtime, але не входить ані до validated main-model set, ані до постачуваної конфігурації OpenCode.
**Важлива поведінка:** Видимий assistant content залежить від non-thinking форми запиту. Тепер request validator підставляє це значення за замовчуванням для звичайних gateway-запитів.
**Поточна консервативна клієнтська стеля:** Близько `100000` prompt tokens для ручного використання в стилі OpenCode / Cline. Активний five-way soak проходить чисто приблизно на `101776` prompt tokens і вже наближається до межі біля `116298`.

### Підтримка зображень / скриншотів OpenCode на Linux

У OpenCode (термінальний AI-агент) є відома проблема на Linux: **зображення з буфера обміну та зображення за шляхом до файлу не працюють** з vision-моделями. Модель відповідає "The model you're using does not support image input", хоча VL-моделі коректно працюють через API.

**Коренева причина:** Обробка буфера обміну в OpenCode на Linux псує бінарні дані зображення до кодування (використовується `.text()` замість `.arrayBuffer()`). У результаті дані зображення взагалі не потрапляють на сервер.

**Статус:** Схоже, це баг на боці клієнта OpenCode. Допомога з розслідуванням або виправленням вітається. Сам inference stack коректно обробляє base64-зображення, якщо їх правильно надсилати через `curl` або інший API-клієнт.

**Обхідний шлях:** Використовуйте `curl` або інші API-клієнти, щоб надсилати зображення безпосередньо до VL-моделей, наприклад `qwen2.5-vl-7b`.

### Qwen 2.5 Coder 7B і несумісність з OpenCode

Модель `qwen2.5-coder-7b-instruct` має жорстке обмеження контексту в **32 768 токенів**. Але OpenCode зазвичай надсилає дуже великі запити (buffer + input), які перевищують **35 000 токенів**, що призводить до `ValueError` і збоїв запитів.

**Рекомендація:** Не використовуйте `qwen2.5-coder-7b` з OpenCode для завдань із довгим контекстом. Натомість використовуйте **`qwen3-coder-30b-instruct`**, що підтримує **65 536 токенів** контексту і значно краще справляється з великими запитами OpenCode.

### Llama 3.3 і несумісність з OpenCode

Модель **`llama-3.3-70b-instruct-fp4`** **не рекомендується для OpenCode**.
**Причина:** Хоча модель коректно працює через API, вона показує надто агресивну поведінку tool calling при ініціалізації специфічними client prompts OpenCode. Це призводить до validation errors і погіршує досвід користувача, наприклад модель намагається викликати інструменти одразу після привітання.
**Рекомендація:** Для сесій OpenCode використовуйте `gpt-oss-20b` або `qwen3-next-80b-a3b-instruct`.

## Подяки

Окрема подяка учасникам спільноти, завдяки яким з'явилися оптимізовані Docker-образи, що використовуються цим стеком:

- **Thomas P. Braun з Avarok**: За універсальний vLLM image (`avarok/vllm-dgx-spark`) з підтримкою non-gated activations (Nemotron), гібридних моделей і публікації на кшталт https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6.
- **Christopher Owen**: За оптимізований для MXFP4 vLLM image (`christopherowen/vllm-dgx-spark`), який робить можливим високопродуктивний inference на DGX Spark.
- **eugr**: За всю роботу над кастомізацією оригінального vLLM image (`eugr/vllm-dgx-spark`) та чудові дописи на форумах NVIDIA.
- **Patrick Yi / scitrera.ai**: За SGLang-рецепт utility-model, який вплинув на локальний шлях helper-моделі `qwen3.5-0.8b`.

## Ліцензія

Проєкт поширюється за ліцензією **Apache License 2.0**. Деталі див. у файлі [LICENSE](LICENSE).
