# DGX Spark Inference Stack - اجعله يخدم منزلك فعلاً!

🌍 **اقرأ هذا بلغات أخرى**:
[Deutsch](README_DE.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Italiano](README_IT.md) | [日本語](README_JA.md) | [简体中文](README_ZH_CN.md) | [繁體中文](README_ZH_TW.md) | [Русский](README_RU.md) | [Українська](README_UK.md) | [Português](README_PT.md) | [한국어](README_KO.md) | [العربية](README_AR.md) | [Tiếng Việt](README_VI.md) | [Türkçe](README_TR.md)

> **ملاحظة ترجمة بالذكاء الاصطناعي:** تمّت ترجمة هذا الملف بالذكاء الاصطناعي انطلاقاً من [README.md](README.md). قد يحتوي على أخطاء أو قد يتأخر عن النسخة الإنجليزية. عند الشك، اعتبر README الإنجليزية هي المرجع الأساسي.

لا ينبغي أن يكون جهاز Nvidia DGX Spark لديك مجرد مشروع جانبي آخر. استخدمه فعلاً. هذه حزمة استدلال مبنية على Docker لتقديم نماذج اللغة الكبيرة (LLMs) باستخدام NVIDIA vLLM مع إدارة ذكية للموارد. توفّر هذه الحزمة تحميل النماذج عند الطلب مع إيقاف تلقائي عند الخمول، ومسار جدولة واحد للنموذج الرئيسي مع مساعد اختياري للخدمات المساندة، وبوابة API موحّدة.

هدف المشروع هو توفير خادم استدلال منزلي. بعد أن اختبرته لمدة شهر وأضفت نماذج جديدة، قررت نشره للمجتمع. يرجى تفهّم أن هذا مشروع هواية، وأن أي مساعدة عملية لتحسينه مرحب بها جداً. يعتمد على معلومات وجدتها على الإنترنت وفي منتديات NVIDIA. آمل فعلاً أن يساعد في دفع مختبرات المنازل إلى الأمام. التركيز الأساسي هو إعداد DGX Spark واحد، ويجب أن يعمل عليه افتراضياً، لكن إضافة دعم لجهازين ستكون موضع ترحيب أيضاً.

## التوثيق

- **[البنية وكيف يعمل](docs/architecture.md)** - فهم الحزمة، وخدمة waker، ومسار الطلبات.
- **[الإعداد](docs/configuration.md)** - متغيرات البيئة، وإعدادات الشبكة، وضبط waker.
- **[دليل اختيار النماذج](docs/models.md)** - قائمة مفصلة تضم أكثر من 29 نموذجاً مدعوماً، واختياراً سريعاً، وحالات استخدام.
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
    curl -X POST http://localhost:8009/v1/qwen3.5-0.8b/chat/completions \
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

- اقرأ [README.md](README.md)، ثم [docs/architecture.md](docs/architecture.md)، ثم [tools/README.md](tools/README.md).
- اعتبر [tools/README.md](tools/README.md) مع [models.json](models.json) المصدر التشغيلي الحالي للحقيقة.
- تعامل مع النماذج خارج المجموعة الموثقة في هذا README على أنها تجريبية إلى أن تؤكدها الحزمة مرة أخرى.

## المتطلبات الأساسية
- Docker 20.10+ مع Docker Compose
- بطاقات NVIDIA GPU مع دعم CUDA و NVIDIA Container Toolkit
- مضيف Linux (تم الاختبار على Ubuntu)

## المساهمة

طلبات السحب مرحب بها جداً. :)
ومع ذلك، ولضمان الاستقرار، أفرض **قالب Pull Request صارماً**.

## ⚠️ المشاكل المعروفة

### حالة التحقق الحالية

مع حزمة التحقق الحالية والإعدادات الافتراضية للمستودع، فإن **النماذج الرئيسية الموثقة** حالياً هي فقط:

- **`gpt-oss-20b`**
- **`gpt-oss-120b`**
- **`glm-4.7-flash-awq`**

أصبح المساعد الصغير المرفق `qwen3.5-0.8b` الآن **المساعد الخدمي الموثق** لعناوين الجلسات وبياناتها الوصفية، لكنه ليس جزءاً من مجموعة النماذج الرئيسية الموثقة هذه.

قد تعمل نماذج أخرى متاحة أيضاً، لكن خارج هذا المساعد الخدمي الموثق يجب اعتبارها **تجريبية** لا خيارات افتراضية موصى بها، إلى أن تتم إعادة اختبارها بالأدوات الحالية.

### النماذج التجريبية (توافق GB10 / CUDA 12.1)

تم وضع النماذج التالية ضمن **التجريبية** بسبب أعطال متقطعة على DGX Spark (بطاقة GB10):

- **Qwen3-Next-80B-A3B-Instruct** - يتعطل عشوائياً في طبقة linear attention
- **Qwen3-Next-80B-A3B-Thinking** - المشكلة نفسها

**السبب الجذري:** تستخدم بطاقة GB10 إصدار CUDA 12.1، لكن حزمة vLLM / PyTorch الحالية لا تدعم إلا CUDA ≤12.0. وهذا يؤدي إلى أخطاء `cudaErrorIllegalInstruction` بعد عدة طلبات ناجحة.

**حل مؤقت:** استخدم `gpt-oss-20b` أو `gpt-oss-120b` للحصول على tool calling مستقر إلى أن تتوفر صورة vLLM محدثة مع دعم صحيح لـ GB10.

### Nemotron 3 Nano 30B (NVFP4)

أعيد تفعيل نموذج **`nemotron-3-nano-30b-nvfp4`** على مسار `vllm-node` القياسي المحدّث، لكنه ما يزال يُعامل كخيار **تجريبي** مع حزمة التحقق الحالية.
**الحالة الحالية:** بات الآن يحمّل ويرد على الطلبات فوق runtime المحدّث، لكنه ليس ضمن مجموعة النماذج الرئيسية الموثقة ولا ضمن إعداد OpenCode المرفق.
**سلوك مهم:** يعتمد محتوى assistant content الظاهر على شكل الطلب غير المفكر. يقوم request validator الآن بحقن هذا الافتراضي في الطلبات العادية عبر gateway.
**الحد المحافظ الحالي للعميل:** حوالي `100000` prompt token عند الاستخدام اليدوي بأسلوب OpenCode / Cline. ينجح اختبار soak الخماسي النشط عند حوالي `101776` prompt token ويصبح قريباً من الحد عند حوالي `116298`.

### دعم الصور / لقطات الشاشة في OpenCode على Linux

يحتوي OpenCode (وكيل الذكاء الاصطناعي في الطرفية) على خلل معروف في Linux حيث إن **صور الحافظة وصور المسارات الملفية لا تعمل** مع نماذج الرؤية. يرد النموذج بعبارة "The model you're using does not support image input" رغم أن نماذج VL تعمل بشكل صحيح عبر API.

**السبب الجذري:** طريقة تعامل OpenCode مع الحافظة على Linux تفسد البيانات الثنائية للصورة قبل الترميز (تستخدم `.text()` بدلاً من `.arrayBuffer()`). عملياً لا يتم إرسال أي بيانات صورة إلى الخادم.

**الحالة:** يبدو أن هذا خلل في عميل OpenCode نفسه. أي مساعدة في التحقيق أو الإصلاح مرحب بها. أما حزمة الاستدلال نفسها فتتعامل بشكل صحيح مع صور base64 عندما تُرسل جيداً عبر `curl` أو أي عميل API آخر.

**حل مؤقت:** استخدم `curl` أو أي عميل API آخر لإرسال الصور مباشرة إلى نماذج VL مثل `qwen2.5-vl-7b`.

### عدم توافق Qwen 2.5 Coder 7B مع OpenCode

يمتلك النموذج `qwen2.5-coder-7b-instruct` حد سياق صارماً يبلغ **32,768 token**. لكن OpenCode يرسل عادةً طلبات كبيرة جداً (buffer + input) تتجاوز **35,000 token**، ما يؤدي إلى `ValueError` وفشل الطلبات.

**التوصية:** لا تستخدم `qwen2.5-coder-7b` مع OpenCode لمهام السياق الطويل. استخدم بدلاً منه **`qwen3-coder-30b-instruct`** الذي يدعم **65,536 token** من السياق ويتعامل مع طلبات OpenCode الكبيرة بهامش أفضل بكثير.

### عدم توافق Llama 3.3 مع OpenCode

النموذج **`llama-3.3-70b-instruct-fp4`** **غير موصى به مع OpenCode**.
**السبب:** رغم أن النموذج يعمل جيداً عبر API، فإنه يُظهر سلوك tool calling عدوانياً عند تهيئته بالمحفزات الخاصة بعميل OpenCode. وهذا يؤدي إلى validation errors وتجربة استخدام أسوأ، مثل محاولة استدعاء الأدوات فور التحية.
**التوصية:** استخدم `gpt-oss-20b` أو `qwen3-next-80b-a3b-instruct` في جلسات OpenCode.

## الشكر والتقدير

شكر خاص لأعضاء المجتمع الذين وفروا صور Docker المحسّنة المستخدمة في هذه الحزمة:

- **Thomas P. Braun من Avarok**: على صورة vLLM العامة (`avarok/vllm-dgx-spark`) التي تدعم non-gated activations (Nemotron) والنماذج الهجينة، وعلى منشورات مثل https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6.
- **Christopher Owen**: على صورة vLLM المحسّنة لـ MXFP4 (`christopherowen/vllm-dgx-spark`) التي تتيح inference عالي الأداء على DGX Spark.
- **eugr**: على كل العمل المتعلق بتخصيص صورة vLLM الأصلية (`eugr/vllm-dgx-spark`) وعلى منشوراته الممتازة في منتديات NVIDIA.
- **Patrick Yi / scitrera.ai**: على وصفة نموذج utility في SGLang التي أثرت في مسار helper المحلي `qwen3.5-0.8b`.

## الترخيص

هذا المشروع مرخّص تحت **Apache License 2.0**. راجع [LICENSE](LICENSE) للتفاصيل.
