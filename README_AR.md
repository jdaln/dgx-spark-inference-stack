# DGX Spark Inference Stack - اخدم منزلك!

> **إخلاء مسؤولية:** تمت ترجمة هذه الوثيقة بواسطة الذكاء الاصطناعي وقد تحتوي على أخطاء.

مجموعة استنتاج تعتمد على Docker لخدمة نماذج اللغة الكبيرة (LLM) باستخدام NVIDIA vLLM مع إدارة ذكية للموارد. توفر هذه المجموعة تحميل النماذج عند الطلب مع إيقاف التشغيل التلقائي عند الخمول، وجدولة GPU لمستخدم واحد، وبوابة API موحدة.

الهدف من المشروع هو توفير خادم استدلال لمنزلك. بعد اختبار هذا وإضافة نماذج جديدة لمدة شهر، قررت إصداره للمجتمع. يرجى التفهم أن هذا مشروع هواية وأن المساعدة الملموسة لتحسينه موضع تقدير كبير. إنه يعتمد على معلومات وجدتها على الإنترنت وفي منتديات NVIDIA؛ آمل حقاً أن يساعد في دفع المختبرات المنزلية إلى الأمام. يركز هذا بشكل أساسي على إعداد DGX Spark الواحد ويجب أن يعمل عليه بشكل افتراضي، ولكن إضافة دعم لـ 2 مرحب به.

## الوثائق

- **[الهندسة المعمارية وكيف تعمل](docs/architecture.md)** - فهم المجموعة، وخدمة الإيقاظ (waker)، وتدفق الطلبات.
- **[التكوين](docs/configuration.md)** - متغيرات البيئة، وإعدادات الشبكة، وضبط خدمة الإيقاظ.
- **[دليل اختيار النموذج](docs/models.md)** - قائمة مفصلة بأكثر من 29 نموذجاً مدعوماً، ومحدد سريع، وحالات الاستخدام.
- **[التكاملات](docs/integrations.md)** - أدلة لـ **Cline** (VS Code) و **OpenCode** (وكيل الطرفية).
- **[الأمان والوصول عن بعد](docs/security.md)** - تقوية SSH وإعداد توجيه منفذ مقيد.
- **[استكشاف الأخطاء وإصلاحها والمراقبة](docs/troubleshooting.md)** - التصحيح، والسجلات، وحلول الأخطاء الشائعة.
- **[الاستخدام المتقدم](docs/advanced.md)** - إضافة نماذج جديدة، وتكوينات مخصصة، وتشغيل دائم.
- **[ملاحظات TODO](TODO.md)** - أفكار لدي لما يجب فعله بعد ذلك.

## البدء السريع

1. **استنساخ المستودع**
   ```bash
   git clone <repository-url>
   cd dgx-spark-inference-stack
   ```

2. **إنشاء الدلائل الضرورية**
   ```bash
   mkdir -p models vllm_cache_huggingface manual_download/openai_gpt-oss-encodings_fix
   ```

3. **تنزيل الرموز المطلوبة (حرج)**
   تتطلب المجموعة تنزيل ملفات tiktoken يدوياً لنماذج GPT-OSS.
   ```bash
   wget https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/cl100k_base.tiktoken
   wget https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/o200k_base.tiktoken
   ```

4. **بناء صور Docker المخصصة (إلزامي)**
   تستخدم المجموعة صور vLLM محسنة مخصصة يجب بناؤها محلياً لضمان أقصى أداء.
   *   **الوقت:** توقع حوالي 20 دقيقة لكل صورة.
   *   **المصادقة:** يجب عليك المصادقة مع NVIDIA NGC لسحب الصور الأساسية.
       1.  أنشئ حساب مطور في [NVIDIA NGC Catalog](https://catalog.ngc.nvidia.com/) (يجب ألا يكون في دولة خاضعة للعقوبات).
       2.  شغل `docker login nvcr.io` باستخدام بيانات اعتمادك.
   *   **أوامر البناء:**
       ```bash
       # بناء صورة Avarok (للأغراض العامة) - يجب استخدام هذا الوسم لاستخدام النسخة المحلية بدلاً من المنبع
       docker build -t avarok/vllm-dgx-spark:v11 custom-docker-containers/avarok

       # بناء صورة Christopher Owen (محسنة لـ MXFP4)
       docker build -t christopherowen/vllm-dgx-spark:v12 custom-docker-containers/christopherowen
       ```

5. **بدء المجموعة**
   ```bash
   # بدء البوابة وخدمة الإيقاظ فقط (تبدأ النماذج عند الطلب)
   docker compose up -d

   # الإنشاء المسبق لجميع حاويات النماذج الممكّنة (موصى به)
   docker compose --profile models up --no-start
   ```

6. **اختبار API**
   ```bash
   # طلب إلى qwen2.5-1.5b (سيبدأ تلقائياً)
   curl -X POST http://localhost:8009/v1/qwen2.5-1.5b-instruct/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" \
     -d '{
       "model": "qwen2.5-1.5b-instruct",
       "messages": [{"role": "user", "content": "مرحباً!"}]
     }'
   ```

## المتطلبات الأساسية
- Docker 20.10+ مع Docker Compose
- وحدة معالجة رسومات NVIDIA (GPUs) مع دعم CUDA و NVIDIA Container Toolkit
- مضيف Linux (تم اختباره على Ubuntu)

## المساهمة

طلبات السحب (Pull Requests) مرحب بها جداً. :)
ومع ذلك، لضمان الاستقرار، أفرض **قالب طلب سحب** صارم.

## ⚠️ مشاكل معروفة

### النماذج التجريبية (توافق GB10/CUDA 12.1)

تم وضع علامة على النماذج التالية بأنها **تجريبية** بسبب الأعطال المتفرقة على DGX Spark (وحدة معالجة الرسومات GB10):

- **Qwen3-Next-80B-A3B-Instruct** - تعطل عشوائي في طبقة الانتباه الخطية
- **Qwen3-Next-80B-A3B-Thinking** - نفس المشكلة

**السبب الجذري:** تستخدم وحدة معالجة الرسومات GB10 CUDA 12.1، لكن مجموعة vLLM/PyTorch الحالية تدعم فقط CUDA ≤12.0. يتسبب هذا في أخطاء `cudaErrorIllegalInstruction` بعد عدة طلبات ناجحة.

**الحل البديل:** استخدم `gpt-oss-20b` أو `gpt-oss-120b` لاستدعاء أداة مستقر حتى تتوفر صورة vLLM محدثة مع دعم GB10 مناسب.

### Nemotron 3 Nano 30B (NVFP4)

نموذج **`nemotron-3-nano-30b-nvfp4`** معطل حالياً.
**السبب:** غير متوافق مع بناء vLLM الحالي على GB10. يتطلب دعم محرك V1 مناسب أو تنفيذ خلفية محدث.


### دعم الصور/لقطات الشاشة في OpenCode على Linux

لدى OpenCode (وكيل الذكاء الاصطناعي الطرفي) خطأ معروف على Linux حيث **لا تعمل صور الحافظة وصور مسار الملف** مع نماذج الرؤية. يستجيب النموذج بـ "النموذج الذي تستخدمه لا يدعم إدخال الصور" على الرغم من أن نماذج VL تعمل بشكل صحيح عبر API.

**السبب الجذري:** تقوم معالجة حافظة Linux في OpenCode بإتلاف بيانات الصورة الثنائية قبل التشفير (تستخدم `.text()` بدلاً من `.arrayBuffer()`). لا يتم إرسال بيانات صورة فعلية إلى الخادم.

**الحالة:** يبدو أن هذا خطأ من جانب عميل OpenCode. المساعدة في التحقيق/الإصلاح مرحب بها! تتعامل مجموعة الاستدلال بشكل صحيح مع صور base64 عند إرسالها بشكل صحيح (تم التحقق منها عبر curl).

**الحل البديل:** استخدم curl أو عملاء API آخرين لإرسال الصور مباشرة إلى نماذج VL مثل `qwen2.5-vl-7b`.

### عدم توافق Qwen 2.5 Coder 7B و OpenCode

لدى نموذج `qwen2.5-coder-7b-instruct` حد سياق صارم يبلغ **32,768 رمزاً المميز**. ومع ذلك، يرسل OpenCode عادةً طلبات كبيرة جداً (مخزن مؤقت + إدخال) تتجاوز **35,000 رمزاً مميزاً**، مما يتسبب في `ValueError` وفشل الطلب.

**توصية:** لا تستخدم `qwen2.5-coder-7b` مع OpenCode للمهام ذات السياق الطويل. بدلاً من ذلك، استخدم **`qwen3-coder-30b-instruct`** الذي يدعم سياق **65,536 رمزاً مميزاً** ويتعامل مع طلبات OpenCode الكبيرة بشكل مريح.

### عدم توافق Llama 3.3 و OpenCode

نموذج **`llama-3.3-70b-instruct-fp4`** **غير موصى به للاستخدام مع OpenCode**.
**السبب:** بينما يعمل النموذج بشكل صحيح عبر API، فإنه يظهر سلوك استدعاء أداة عدواني عند تهيئته بواسطة مطالبات العميل المحددة لـ OpenCode. يؤدي هذا إلى أخطاء في التحقق من الصحة وتجربة مستخدم متدهورة (مثلاً، محاولة استدعاء الأدوات فور الترحيب).
**توصية:** استخدم `gpt-oss-20b` أو `qwen3-next-80b-a3b-instruct` لجلسات OpenCode بدلاً من ذلك.

## الاعتمادات

شكر خاص لأعضاء المجتمع الذين قاموا بإنشاء صور Docker المحسنة المستخدمة في هذه المجموعة:

- **Thomas P. Braun من Avarok**: للحصول على صورة vLLM للأغراض العامة (`avarok/vllm-dgx-spark`) مع دعم التنشيطات غير المبوبة (Nemotron) والنماذج الهجينة، ومنشورات مثل هذا https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6.
- **Christopher Owen**: للحصول على صورة vLLM المحسنة لـ MXFP4 (`christopherowen/vllm-dgx-spark`) التي تتيح استدلالاً عالي الأداء على DGX Spark.
- **eugr**: لكل العمل على تخصيصات صورة vLLM الأصلية (`eugr/vllm-dgx-spark`) والمنشورات الرائعة في منتديات NVIDIA.

### مقدمو النماذج

شكر كبير للمنظمات التي تحسن هذه النماذج لاستدلال FP4/FP8:

- **Fireworks AI** (`Firworks`): لمجموعة واسعة من النماذج المحسنة بما في ذلك GLM-4.5، و Llama 3.3، و Ministral.
- **NVIDIA**: لـ Qwen3-Next، و Nemotron، وتطبيقات FP4 القياسية.
- **RedHat**: لـ Qwen3-VL و Mistral Small.
- **QuantTrio**: لـ Qwen3-VL-Thinking.
- **OpenAI**: لنماذج GPT-OSS.

## الترخيص

هذا المشروع مرخص بموجب **رخصة Apache 2.0**. راجع ملف [LICENSE](LICENSE) للتفاصيل.
