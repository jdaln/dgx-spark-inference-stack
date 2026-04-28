# DGX Spark Inference Stack - Evinize gerçekten hizmet etsin!

🌍 **Bunu diğer dillerde okuyun**:
[Deutsch](README_DE.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Italiano](README_IT.md) | [日本語](README_JA.md) | [简体中文](README_ZH_CN.md) | [繁體中文](README_ZH_TW.md) | [Русский](README_RU.md) | [Українська](README_UK.md) | [Português](README_PT.md) | [한국어](README_KO.md) | [العربية](README_AR.md) | [Tiếng Việt](README_VI.md) | [Türkçe](README_TR.md)

> **Yapay zeka çeviri notu:** Bu dosya [README.md](README.md) temel alınarak yapay zeka ile çevrildi. Hata içerebilir veya İngilizce sürümün gerisinde kalabilir. Tereddüt halinde İngilizce README esas alınmalıdır.

Nvidia DGX Spark'iniz bir yan proje daha olmamalı. Onu gerçekten kullanın. Bu, NVIDIA vLLM ve akıllı kaynak yönetimi kullanarak büyük dil modellerini (LLM) sunmak için hazırlanmış Docker tabanlı bir inference stack'idir. Bu stack, isteğe bağlı model yükleme ve boşta otomatik kapatma, isteğe bağlı bir yardımcı model eşliğinde tek bir ana model zamanlama hattı ve birleşik bir API gateway sunar.

Projenin amacı ev ortamı için bir inference sunucusu sağlamaktır. Bunu bir ay boyunca test edip yeni modeller ekledikten sonra toplulukla paylaşmaya karar verdim. Bunun bir hobi projesi olduğunu lütfen unutmayın; geliştirmeye dönük somut yardım çok değerlidir. İnternette ve NVIDIA forumlarında bulduğum bilgiler üzerine kuruldu. Homelab ortamlarını biraz daha ileri taşımasına gerçekten yardımcı olmasını umuyorum. Ana odak tek bir DGX Spark kurulumudur ve varsayılan olarak burada çalışmalıdır; ama iki cihaz desteği de memnuniyetle karşılanır.

## Dokümantasyon

- **[Mimari ve nasıl çalışır](docs/architecture.md)** - Stack'i, waker servisini ve istek akışını anlayın.
- **[Yapılandırma](docs/configuration.md)** - Ortam değişkenleri, ağ ayarları ve waker tuning.
- **[Model seçim kılavuzu](docs/models.md)** - Güncel model kataloğu, hızlı seçim ve doğrulama durumu.
- **[Entegrasyonlar](docs/integrations.md)** - **Cline** (VS Code) ve **OpenCode** (terminal ajanı) için kılavuzlar.
- **[Güvenlik ve uzak erişim](docs/security.md)** - SSH sertleştirme ve kısıtlı port forwarding kurulumu.
- **[Sorun giderme ve izleme](docs/troubleshooting.md)** - Hata ayıklama, loglar ve yaygın hata çözümleri.
- **[Gelişmiş kullanım](docs/advanced.md)** - Yeni modeller ekleme, özel yapılandırmalar ve kalıcı çalışma.
- **[Runtime baseline](docs/runtime-baseline.md)** - Depodaki beklenti olan yerel image track'leri ve bunları nasıl yeniden oluşturacağınız.
- **[Araçlar ve doğrulama harness'i](tools/README.md)** - Desteklenen smoke, soak, inspection ve manuel probe script'leri.
- **[TODO notları](TODO.md)** - Sonraki adımlar için fikirler.

## Hızlı başlangıç

1. **Depoyu klonlayın**
   ```bash
   git clone <repository-url>
   cd dgx-spark-inference-stack
   ```

2. **Gerekli dizinleri oluşturun**
   ```bash
   mkdir -p models vllm_cache_huggingface manual_download/openai_gpt-oss-encodings_fix
   ```

3. **Gerekli tokenizer'ları indirin (KRİTİK)**
   Bu stack, GPT-OSS modelleri için `tiktoken` dosyalarının elle indirilmesini gerektirir.
   ```bash
   wget https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/cl100k_base.tiktoken
   wget https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/o200k_base.tiktoken
   ```

4. **Özel Docker image'larını derleyin (ZORUNLU)**
   Stack, en yüksek performans için yerelde derlenmesi gereken optimize edilmiş vLLM image'ları kullanır.
   *   **Süre:** Her image için yaklaşık 20 dakika bekleyin.
   *   **Kimlik doğrulama:** Temel image'ları çekmek için NVIDIA NGC'ye giriş yapmanız gerekir.
       1.  [NVIDIA NGC Catalog](https://catalog.ngc.nvidia.com/) üzerinde bir geliştirici hesabı oluşturun (yaptırım altındaki bir ülkede olmamalıdır).
       2.  Kimlik bilgilerinizle `docker login nvcr.io` çalıştırın.
      **Build komutları:**
      ```bash
      # Build Avarok image (General Purpose) - MUST use this tag to use local version over upstream.
      # Build from the repo root so the manually downloaded tokenizer files are included.
      docker build -t avarok/vllm-dgx-spark:v11 -f custom-docker-containers/avarok/Dockerfile .

      # If you want compose services that default to the pinned upstream Avarok image
      # to use your local rebuild instead, export this override for the current shell
      # or place it in .env before running docker compose.
      export VLLM_TRACK_AVAROK=avarok/vllm-dgx-spark:v11

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
   *   **Not:** `vllm-node-tf5` şu anda depo içi bir Dockerfile'dan derlenmiyor. Gemma 4 veya daha yeni TF5 hattındaki Qwen modellerini çalıştırmayı planlıyorsanız, yukarıdaki upstream helper akışıyla açıkça derleyin. Tam yeniden üretim adımları ve build sırasındaki ağ gereksinimleri için [docs/runtime-baseline.md](docs/runtime-baseline.md) dosyasına bakın.

5. **Stack'i başlatın**
   ```bash
   # Start gateway and waker only (models start on-demand)
   docker compose up -d

   # Pre-create all enabled model containers once the required local track images exist
   docker compose --profile models up --no-start
   ```

6. **API'yi test edin**
   ```bash
    # Request to the shipped utility helper
    curl -X POST http://localhost:8009/v1/chat/completions\
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" \
     -d '{
          "model": "qwen3.5-0.8b",
       "messages": [{"role": "user", "content": "Merhaba!"}]
     }'
   ```

7. **Desteklenen doğrulama harness'ini kullanın**
   İlk manuel `curl` başarılı olduktan sonra geçici script'ler yerine deponun bakımını yaptığı bring-up akışına geçin:
   ```bash
   bash tools/validate-stack.sh
   bash tools/smoke-gateway.sh
   ```
   Modele özel bring-up, smoke, soak ve manuel probe komutları için [tools/README.md](tools/README.md) dosyasına bakın.

## Yeniyseniz buradan başlayın

- Önce [docs/architecture.md](docs/architecture.md), ardından [tools/README.md](tools/README.md) okuyun.
- [tools/README.md](tools/README.md) ile [models.json](models.json) dosyalarını mevcut operasyonel gerçek kaynağı olarak görün.
- Bu README'yi tam model kataloğu değil, kısa giriş noktası olarak görün. Daha geniş katalog için [docs/models.md](docs/models.md) dosyasını kullanın.

## Önkoşullar
- Docker 20.10+ ve Docker Compose
- CUDA destekli NVIDIA GPU(lar) ve NVIDIA Container Toolkit
- Linux ana makine (Ubuntu üzerinde test edildi)

## Katkı

Pull request'ler çok memnuniyetle karşılanır. :)
Ancak kararlılığı korumak için sıkı bir **Pull Request Template** uygularım.

## Güncel durum

Bu README artık yalnızca stack'in şu anda önerilen varsayılan yollarını kısa şekilde öne çıkarır.

- **Doğrulanmış ana modeller:** `gpt-oss-20b`, `gpt-oss-120b` ve `glm-4.7-flash-awq`
- **Doğrulanmış yardımcı model:** başlıklar ve oturum metaverisi için `qwen3.5-0.8b`
- **Diğer her şey:** Depoda bulunur, ancak mevcut harness ile yeniden doğrulanana kadar bu README'nin varsayılan seçimi değildir

Daha geniş model kataloğu, deneysel yollar ve manuel senaryolar için [docs/models.md](docs/models.md) ve [models.json](models.json) dosyalarını kullanın.

İstemci uyarıları, runtime ayrıntıları ve troubleshooting notları için [docs/integrations.md](docs/integrations.md) ile [docs/troubleshooting.md](docs/troubleshooting.md) dosyalarını kullanın.

## Katkı verenler

Bu stack'i şekillendiren Docker image ve reçete çalışmalarına katkı veren topluluk üyelerine özel teşekkürler:

- **Avarok'tan Thomas P. Braun**: non-gated activation (Nemotron), hibrit modeller desteği sunan genel amaçlı vLLM image'ı (`avarok/vllm-dgx-spark`) ve https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6 gibi paylaşımlar için.
- **Christopher Owen**: DGX Spark üzerinde yüksek performanslı inference sağlayan MXFP4 optimize vLLM image'ı (`christopherowen/vllm-dgx-spark`) için.
- **eugr**: Özgün DGX Spark topluluk vLLM deposu `eugr/spark-vllm-docker`, üzerindeki özelleştirme çalışmaları ve NVIDIA forumlarındaki harika paylaşımlar için.
- **Patrick Yi / scitrera.ai**: Yerel `qwen3.5-0.8b` helper yoluna ilham veren SGLang yardımcı model reçetesi için.
- **Raphael Amorim**: Deneysel yerel `qwen3.5-122b-a10b-int4-autoround` yoluna yön veren topluluk AutoRound reçete biçimi için.
- **Bjarke Bolding**: Deneysel yerel `qwen3-coder-next-int4-autoround` yoluna yön veren uzun bağlam AutoRound reçete biçimi için.

## Lisans

Bu proje **Apache License 2.0** lisansı ile sunulmaktadır. Ayrıntılar için [LICENSE](LICENSE) dosyasına bakın.
