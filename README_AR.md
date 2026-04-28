# DGX Spark Inference Stack - اجعله يخدم منزلك فعلاً!

🌍 **اقرأ هذا بلغات أخرى**:
[Deutsch](README_DE.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Italiano](README_IT.md) | [日本語](README_JA.md) | [简体中文](README_ZH_CN.md) | [繁體中文](README_ZH_TW.md) | [Русский](README_RU.md) | [Українська](README_UK.md) | [Português](README_PT.md) | [한국어](README_KO.md) | [العربية](README_AR.md) | [Tiếng Việt](README_VI.md) | [Türkçe](README_TR.md)

> **ملاحظة ترجمة بالذكاء الاصطناعي:** تمّت ترجمة هذا الملف بالذكاء الاصطناعي انطلاقاً من [README.md](README.md). قد يحتوي على أخطاء أو قد يتأخر عن النسخة الإنجليزية. عند الشك، اعتبر README الإنجليزية هي المرجع الأساسي.

لا ينبغي أن يكون جهاز Nvidia DGX Spark لديك مجرد مشروع جانبي آخر. استخدمه فعلاً. هذه حزمة استدلال مبنية على Docker لتقديم نماذج اللغة الكبيرة (LLMs) باستخدام NVIDIA vLLM مع إدارة ذكية للموارد. توفّر هذه الحزمة تحميل النماذج عند الطلب مع إيقاف تلقائي عند الخمول، ومسار جدولة واحد للنموذج الرئيسي مع مساعد اختياري للخدمات المساندة، وبوابة API موحّدة.

هدف المشروع هو توفير خادم استدلال منزلي. بعد أن اختبرته لمدة شهر وأضفت نماذج جديدة، قررت نشره للمجتمع. يرجى تفهّم أن هذا مشروع هواية، وأن أي مساعدة عملية لتحسينه مرحب بها جداً. يعتمد على معلومات وجدتها على الإنترنت وفي منتديات NVIDIA. آمل فعلاً أن يساعد في دفع مختبرات المنازل إلى الأمام. التركيز الأساسي هو إعداد DGX Spark واحد، ويجب أن يعمل عليه افتراضياً، لكن إضافة دعم لجهازين ستكون موضع ترحيب أيضاً.

## التوثيق

- **[البنية وكيف يعمل](docs/architecture.md)** - فهم الحزمة، وخدمة waker، ومسار الطلبات.
- **[الإعداد](docs/configuration.md)** - متغيرات البيئة، وإعدادات الشبكة، وضبط waker.
- **[دليل اختيار النماذج](docs/models.md)** - فهرس النماذج الحالي، والاختيار السريع، وحالة التحقق.
- **[التكاملات](docs/integrations.md)** - أدلة لـ **Cline** (في VS Code) و **OpenCode** (وكيل الطرفية).
- **[الأمان والوصول البعيد](docs/security.md)** - تقوية SSH وإعداد تحويل منافذ مقيّد.
- **[استكشاف الأخطاء والمراقبة](docs/troubleshooting.md)** - التصحيح، والسجلات، وحلول الأخطاء الشائعة.
- **[الاستخدام المتقدم](docs/advanced.md)** - إضافة نماذج جديدة، وإعدادات مخصصة، وتشغيل دائم.
- **[خط الأساس لوقت التشغيل](docs/runtime-baseline.md)** - أي مسارات صور محلية يتوقعها المستودع وكيفية إعادة بنائها.
- **[الأدوات وحزمة التحقق](tools/README.md)** - سكربتات smoke و soak و inspection و probe اليدوي المدعومة.
- **[ملاحظات TODO](TODO.md)** - أفكار لما أريد فعله لاحقاً.

## البدء السريع

1. **استنسخ المستودع**
   ```bash
   git clone <repository-url>
   cd dgx-spark-inference-stack
   ```

2. **أنشئ المجلدات المطلوبة**
   ```bash
   mkdir -p models vllm_cache_huggingface manual_download/openai_gpt-oss-encodings_fix
   ```

3. **نزّل ملفات tokenizer المطلوبة (حرج)**
   تتطلب الحزمة تنزيل ملفات `tiktoken` يدوياً لنماذج GPT-OSS.
   ```bash
   wget https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/cl100k_base.tiktoken
   wget https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/o200k_base.tiktoken
   ```

4. **ابنِ صور Docker المخصصة (إلزامي)**
   تستخدم الحزمة صور vLLM محسّنة ويجب بناؤها محلياً لضمان أفضل أداء ممكن.
   *   **الوقت:** توقّع حوالي 20 دقيقة لكل صورة.
   *   **المصادقة:** يجب أن تسجّل الدخول إلى NVIDIA NGC لسحب الصور الأساسية.
       1.  أنشئ حساب مطوّر في [NVIDIA NGC Catalog](https://catalog.ngc.nvidia.com/) (يجب ألا يكون في بلد خاضع للعقوبات).
       2.  شغّل `docker login nvcr.io` باستخدام بياناتك.
   *   **أوامر البناء:**
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
   *   **ملاحظة:** لا يتم حالياً بناء `vllm-node-tf5` من Dockerfile محلي داخل هذا المستودع. إذا كنت تنوي تشغيل Gemma 4 أو سلاسل Qwen الأحدث على مسار TF5، فابنه صراحةً عبر تدفق upstream helper أعلاه. راجع [docs/runtime-baseline.md](docs/runtime-baseline.md) لمعرفة خطوات إعادة الإنتاج الدقيقة ومتطلبات الشبكة وقت البناء.

5. **شغّل الحزمة**
   ```bash
   # Start gateway and waker only (models start on-demand)
   docker compose up -d

   # Pre-create all enabled model containers once the required local track images exist
   docker compose --profile models up --no-start
   ```

6. **اختبر API**
   ```bash
    # Request to the shipped utility helper
    curl -X POST http://localhost:8009/v1/chat/completions\
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" \
     -d '{
          "model": "qwen3.5-0.8b",
       "messages": [{"role": "user", "content": "مرحبا!"}]
     }'
   ```

7. **استخدم حزمة التحقق المدعومة**
   بعد نجاح أول أمر `curl` يدوي، انتقل إلى تدفق bring-up الذي يحافظ عليه المستودع بدلاً من السكربتات المؤقتة:
   ```bash
   bash tools/validate-stack.sh
   bash tools/smoke-gateway.sh
   ```
   لأوامر bring-up و smoke و soak و probe اليدوي الخاصة بكل نموذج، راجع [tools/README.md](tools/README.md).

## إذا كنت جديداً فابدأ من هنا

- اقرأ [docs/architecture.md](docs/architecture.md)، ثم [tools/README.md](tools/README.md).
- اعتبر [tools/README.md](tools/README.md) مع [models.json](models.json) المصدر التشغيلي الحالي للحقيقة.
- تعامل مع هذا README على أنه نقطة دخول مختصرة لا فهرساً كاملاً للنماذج. استخدم [docs/models.md](docs/models.md) للفهرس الأوسع.

## المتطلبات الأساسية
- Docker 20.10+ مع Docker Compose
- بطاقات NVIDIA GPU مع دعم CUDA و NVIDIA Container Toolkit
- مضيف Linux (تم الاختبار على Ubuntu)

## المساهمة

طلبات السحب مرحب بها جداً. :)
ومع ذلك، ولضمان الاستقرار، أفرض **قالب Pull Request صارماً**.

## الحالة الحالية

يركز هذا README الآن فقط على المسارات الافتراضية الموصى بها حالياً في هذه الحزمة.

- **النماذج الرئيسية الموثقة:** `gpt-oss-20b` و `gpt-oss-120b` و `glm-4.7-flash-awq`
- **المساعد الخدمي الموثق:** `qwen3.5-0.8b` لعناوين الجلسات وبياناتها الوصفية
- **كل ما عدا ذلك:** موجود في المستودع، لكنه ليس الخيار الافتراضي في هذا README إلى أن يُعاد التحقق منه بالحزمة الحالية

للوصول إلى فهرس النماذج الأوسع، والمسارات التجريبية، والحالات اليدوية، استخدم [docs/models.md](docs/models.md) و [models.json](models.json).

ولملاحظات العملاء، وخصوصيات runtime، وملاحظات استكشاف الأخطاء، استخدم [docs/integrations.md](docs/integrations.md) و [docs/troubleshooting.md](docs/troubleshooting.md).

## الشكر والتقدير

شكر خاص لأعضاء المجتمع الذين ألهمت صور Docker وأعمال الوصفات الخاصة بهم هذه الحزمة:

- **Thomas P. Braun من Avarok**: على صورة vLLM العامة (`avarok/vllm-dgx-spark`) التي تدعم non-gated activations (Nemotron) والنماذج الهجينة، وعلى منشورات مثل https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6.
- **Christopher Owen**: على صورة vLLM المحسّنة لـ MXFP4 (`christopherowen/vllm-dgx-spark`) التي تتيح inference عالي الأداء على DGX Spark.
- **eugr**: على مستودع vLLM المجتمعي الأصلي الخاص بـ DGX Spark (`eugr/spark-vllm-docker`)، وتخصيصاته، ومنشوراته الممتازة في منتديات NVIDIA.
- **Patrick Yi / scitrera.ai**: على وصفة نموذج utility في SGLang التي أثرت في مسار helper المحلي `qwen3.5-0.8b`.
- **Raphael Amorim**: على صيغة وصفة AutoRound المجتمعية التي ألهمت المسار المحلي التجريبي `qwen3.5-122b-a10b-int4-autoround`.
- **Bjarke Bolding**: على صيغة وصفة AutoRound للسياق الطويل التي ألهمت المسار المحلي التجريبي `qwen3-coder-next-int4-autoround`.

## الترخيص

هذا المشروع مرخّص تحت **Apache License 2.0**. راجع [LICENSE](LICENSE) للتفاصيل.
