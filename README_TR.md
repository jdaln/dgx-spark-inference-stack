# DGX Spark Inference Stack - Evinize hizmet verin!

> **Uyarı:** Bu belge yapay zeka tarafından çevrilmiştir ve hatalar içerebilir.

Nvidia DGX Spark'ınız sadece başka bir yan proje olmamalı. Kullanmaya başlayın! Bu, akıllı kaynak yönetimi ile NVIDIA vLLM kullanarak büyük dil modellerini (LLM'ler) sunmak için Docker tabanlı bir çıkarım yığınıdır. Bu yığın, boşta otomatik kapanma, tek kiracılı GPU zamanlama ve birleşik bir API ağ geçidi ile isteğe bağlı model yükleme sağlar.

Projenin amacı, eviniz için bir çıkarım sunucusu sağlamaktır. Bunu test ettikten ve bir ay boyunca yeni modeller ekledikten sonra, topluluk için yayınlamaya karar verdim. Lütfen bunun bir hobi projesi olduğunu ve onu geliştirmek için somut yardımların çok takdir edildiğini anlayın. İnternette ve NVIDIA Forumlarında bulduğum bilgilere dayanıyor; ev laboratuvarlarını ileriye taşımaya yardımcı olacağını gerçekten umuyorum. Bu, esas olarak tek DGX Spark kurulumuna odaklanmıştır ve varsayılan olarak üzerinde çalışmalıdır, ancak 2 desteği eklenmesi memnuniyetle karşılanır.

## Dokümantasyon

- **[Mimari ve Nasıl Çalışır](docs/architecture.md)** - Yığını, waker hizmetini ve istek akışını anlama.
- **[Yapılandırma](docs/configuration.md)** - Ortam değişkenleri, ağ ayarları ve waker ayarı.
- **[Model Seçim Kılavuzu](docs/models.md)** - 29+ desteklenen modelin ayrıntılı listesi, hızlı seçici ve kullanım durumları.
- **[Entegrasyonlar](docs/integrations.md)** - **Cline** (VS Code) ve **OpenCode** (Terminal Ajanı) için kılavuzlar.
- **[Güvenlik ve Uzaktan Erişim](docs/security.md)** - SSH güçlendirme ve kısıtlı port yönlendirme kurulumu.
- **[Sorun Giderme ve İzleme](docs/troubleshooting.md)** - Hata ayıklama, günlükler ve yaygın hata çözümleri.
- **[Gelişmiş Kullanım](docs/advanced.md)** - Yeni modeller ekleme, özel yapılandırmalar ve kalıcı çalışma.
- **[TODO Notları](TODO.md)** - Sırada ne yapacağıma dair fikirlerim.

## Hızlı Başlangıç

1. **Depoyu klonlayın**
   ```bash
   git clone <repository-url>
   cd dgx-spark-inference-stack
   ```

2. **Gerekli dizinleri oluşturun**
   ```bash
   mkdir -p models vllm_cache_huggingface manual_download/openai_gpt-oss-encodings_fix
   ```

3. **Gerekli tokenizerları indirin (KRİTİK)**
   Yığın, GPT-OSS modelleri için tiktoken dosyalarının manuel olarak indirilmesini gerektirir.
   ```bash
   wget https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/cl100k_base.tiktoken
   wget https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/o200k_base.tiktoken
   ```

4. **Özel Docker Görüntüleri Oluşturun (ZORUNLU)**
   Yığın, maksimum performansı sağlamak için yerel olarak oluşturulması gereken özel optimize edilmiş vLLM görüntüleri kullanır.
   *   **Süre:** Görüntü başına yaklaşık 20 dakika bekleyin.
   *   **Kimlik Doğrulama:** Temel görüntüleri çekmek için NVIDIA NGC ile kimlik doğrulaması yapmalısınız.
       1.  [NVIDIA NGC Catalog](https://catalog.ngc.nvidia.com/) adresinde bir geliştirici hesabı oluşturun (yaptırım uygulanan bir ülkede olmamalıdır).
       2.  Kimlik bilgilerinizle `docker login nvcr.io` çalıştırın.
   *   **Oluşturma Komutları:**
       ```bash
       # Avarok görüntüsü oluşturun (Genel Amaçlı) - Upstream yerine yerel sürümü kullanmak için bu etiketi kullanmalısınız
       docker build -t avarok/vllm-dgx-spark:v11 custom-docker-containers/avarok

       # Christopher Owen görüntüsü oluşturun (MXFP4 Optimize Edilmiş)
       docker build -t christopherowen/vllm-dgx-spark:v12 custom-docker-containers/christopherowen
       ```

5. **Yığını başlatın**
   ```bash
   # Yalnızca ağ geçidini ve waker'ı başlatın (modeller isteğe bağlı olarak başlar)
   docker compose up -d

   # Tüm etkin model konteynerlerini önceden oluşturun (önerilir)
   docker compose --profile models up --no-start
   ```

6. **API'yi test edin**
   ```bash
   # qwen2.5-1.5b'ye istek (otomatik olarak başlayacaktır)
   curl -X POST http://localhost:8009/v1/qwen2.5-1.5b-instruct/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" \
     -d '{
       "model": "qwen2.5-1.5b-instruct",
       "messages": [{"role": "user", "content": "Merhaba!"}]
     }'
   ```

## Ön Koşullar
- Docker Compose ile Docker 20.10+
- CUDA destekli NVIDIA GPU(lar) ve NVIDIA Container Toolkit
- Linux ana bilgisayarı (Ubuntu üzerinde test edilmiştir)

## Katkıda Bulunma

Pull Request'ler memnuniyetle karşılanır. :)
Ancak, kararlılığı sağlamak için katı bir **Pull Request Şablonu** uyguluyorum.

## ⚠️ Bilinen Sorunlar

### Deneysel Modeller (GB10/CUDA 12.1 Uyumluluğu)

Aşağıdaki modeller, DGX Spark (GB10 GPU) üzerindeki sporadik çökmeler nedeniyle **deneysel** olarak işaretlenmiştir:

- **Qwen3-Next-80B-A3B-Instruct** - Doğrusal dikkat katmanında rastgele çöküyor
- **Qwen3-Next-80B-A3B-Thinking** - Aynı sorun

**Kök neden:** GB10 GPU CUDA 12.1 kullanıyor, ancak mevcut vLLM/PyTorch yığını yalnızca CUDA ≤12.0'ı destekliyor. Bu, birkaç başarılı istekten sonra `cudaErrorIllegalInstruction` hatalarına neden olur.

**Geçici çözüm:** Uygun GB10 desteğine sahip güncellenmiş bir vLLM görüntüsü mevcut olana kadar kararlı araç çağırma için `gpt-oss-20b` veya `gpt-oss-120b` kullanın.

### Nemotron 3 Nano 30B (NVFP4)

**`nemotron-3-nano-30b-nvfp4`** modeli şu anda devre dışı.
**Neden:** GB10'daki mevcut vLLM yapısıyla uyumsuz. Uygun V1 motor desteği veya güncellenmiş arka uç uygulaması gerektirir.


### Linux'ta OpenCode Resim/Ekran Görüntüsü Desteği

OpenCode (terminal AI ajanı), Linux'ta **pano resimlerinin ve dosya yolu resimlerinin** vizyon modelleriyle **çalışmadığı** bilinen bir hataya sahiptir. Model, VL modelleri API aracılığıyla doğru şekilde çalışsa bile "Kullandığınız model resim girişini desteklemiyor" yanıtını verir.

**Kök neden:** OpenCode'un Linux pano işleme, kodlamadan önce ikili resim verilerini bozar (`.arrayBuffer()` yerine `.text()` kullanır). Sunucuya gerçek resim verisi gönderilmez.

**Durum:** Bu, istemci tarafı OpenCode hatası gibi görünüyor. Araştırma/düzeltme yardımı memnuniyetle karşılanır! Çıkarım yığını, düzgün gönderildiğinde base64 resimlerini doğru şekilde işler (curl ile doğrulanmıştır).

**Geçici çözüm:** Resimleri doğrudan `qwen2.5-vl-7b` gibi VL modellerine göndermek için curl veya diğer API istemcilerini kullanın.

### Qwen 2.5 Coder 7B ve OpenCode Uyumsuzluğu

`qwen2.5-coder-7b-instruct` modelinin katı bir **32.768 token** bağlam sınırı vardır. Ancak OpenCode genellikle **35.000 token**'ı aşan çok büyük istekler (tampon + giriş) göndererek `ValueError` ve istek başarısızlıklarına neden olur.

**Öneri:** Uzun bağlamlı görevler için OpenCode ile `qwen2.5-coder-7b` kullanmayın. Bunun yerine, **65.536 token** bağlamını destekleyen ve OpenCode'un büyük isteklerini rahatça işleyen **`qwen3-coder-30b-instruct`** kullanın.

### Llama 3.3 ve OpenCode Uyumsuzluğu

**`llama-3.3-70b-instruct-fp4`** modelinin **OpenCode ile kullanılması önerilmez**.
**Neden:** Model API üzerinden doğru çalışsa da, OpenCode'un belirli istemci istemleri tarafından başlatıldığında agresif araç çağırma davranışı sergiler. Bu, doğrulama hatalarına ve bozulmuş bir kullanıcı deneyimine (örneğin, selamlamadan hemen sonra araçları çağırmaya çalışma) yol açar.
**Öneri:** Bunun yerine OpenCode oturumları için `gpt-oss-20b` veya `qwen3-next-80b-a3b-instruct` kullanın.

## Krediler

Bu yığında kullanılan optimize edilmiş Docker görüntülerini yapan topluluk üyelerine özel teşekkürler:

- **Avarok'tan Thomas P. Braun**: Kapısız aktivasyonları (Nemotron) ve hibrit modelleri destekleyen genel amaçlı vLLM görüntüsü (`avarok/vllm-dgx-spark`) ve https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6 gibi gönderiler için.
- **Christopher Owen**: DGX Spark üzerinde yüksek performanslı çıkarım sağlayan MXFP4 optimize edilmiş vLLM görüntüsü (`christopherowen/vllm-dgx-spark`) için.
- **eugr**: Orijinal vLLM görüntüsü (`eugr/vllm-dgx-spark`) özelleştirmeleri üzerindeki tüm çalışmalar ve NVIDIA Forumlarında harika gönderiler için.

### Model Sağlayıcıları

Bu modelleri FP4/FP8 çıkarımı için optimize eden kuruluşlara kocaman teşekkürler:

- **Fireworks AI** (`Firworks`): GLM-4.5, Llama 3.3 ve Ministral dahil olmak üzere çok çeşitli optimize edilmiş modeller için.
- **NVIDIA**: Qwen3-Next, Nemotron ve standart FP4 uygulamaları için.
- **RedHat**: Qwen3-VL ve Mistral Small için.
- **QuantTrio**: Qwen3-VL-Thinking için.
- **OpenAI**: GPT-OSS modelleri için.

## Lisans

Bu proje **Apache Lisansı 2.0** kapsamında lisanslanmıştır. Ayrıntılar için [LICENSE](LICENSE) dosyasına bakın.
