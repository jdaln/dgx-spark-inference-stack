# DGX Spark Inference Stack

🌍 **Bunu diğer dillerde oku**:
[Deutsch](README_DE.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Italiano](README_IT.md) | [日本語](README_JA.md) | [简体中文](README_ZH_CN.md) | [繁體中文](README_ZH_TW.md) | [Русский](README_RU.md) | [Українська](README_UK.md) | [Português](README_PT.md) | [한국어](README_KO.md) | [العربية](README_AR.md) | [Tiếng Việt](README_VI.md) | [Türkçe](README_TR.md)

> Bu dosya [README.md](README.md) dosyasından yapay zekâ ile çevrildi. Çelişki olursa İngilizce sürüm geçerlidir.

Tek bir NVIDIA DGX Spark üzerinden, OpenAI uyumlu bir API ile LLM sunar. Bir model kendisine
gelen ilk istekte başlar, GPU'yu tek başına kullanır ve 20 dakika boşta kalınca durur. Yanında
oturum başlıkları gibi hafif işler için küçük bir yardımcı model yüklü kalabilir.

Tek bir DGX Spark için bir hobi projesidir. İki düğümlü kurulumlar test edilmedi.

## Nasıl çalışır

`8009` portundaki bir nginx ağ geçidi tüm istekleri alır. Bir istek doğrulayıcı API
anahtarını kontrol eder, gövdeyi normalleştirir ve waker servisinden istenen modeli
başlatmasını ister. Waker model konteynerini başlatır ve sağlıklı olana kadar bekler. GPU'yu
başka bir ana model tutuyorsa istemci, hangi modelin tuttuğunu ve GPU'nun ne zaman
boşalacağını söyleyen başlıklarla HTTP 429 alır. Ayrıntılar:
[docs/architecture.md](docs/architecture.md).

## Gereksinimler

- NVIDIA DGX Spark (GB10). DGX OS 7 (Ubuntu 24.04) üzerinde test edildi.
- Compose v2.20 veya üstü ile Docker ve NVIDIA Container Toolkit.
- `tools/` içindeki betikler için `jq`, `curl` ve Node.js 20 veya üstü.
- Temel imajlar için bir NVIDIA NGC hesabı.
  [NGC Kataloğu](https://catalog.ngc.nvidia.com/) üzerinden kaydolun, ardından
  `docker login nvcr.io` çalıştırın. NGC yaptırım uygulanan ülkelerde kullanılamaz.
- `./models` altında ağırlıklar için disk: model başına yaklaşık 2 GB ile 80 GB.
- Yalnızca `qwen3.8-flash-next-nvfp4` için: ana makinede io_uring açık olmalı
  (`cat /proc/sys/kernel/io_uring_disabled` çıktısı `0`). Modelin konteyneri io_uring'e izin
  veren bir seccomp profiliyle çalışır. Çekirdeği güncel tutun: io_uring sık görülen bir
  çekirdek açığı kaynağıdır. Bkz. [docs/security.md](docs/security.md#seccomp).

## Kurulum

### 1. Depoyu klonlayın ve çalışma dizinlerini oluşturun

```bash
git clone <repository-url>
cd dgx-spark-inference-stack
mkdir -p models manual_download/openai_gpt-oss-encodings_fix
```

### 2. GPT-OSS tokenizer dosyalarını indirin

GPT-OSS imaj derlemesi bunları içine kopyalar ve bunlar olmadan başarısız olur.

```bash
wget https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken \
  -O manual_download/openai_gpt-oss-encodings_fix/cl100k_base.tiktoken
wget https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken \
  -O manual_download/openai_gpt-oss-encodings_fix/o200k_base.tiktoken
```

### 3. Bir çalışma imajı derleyin

Modeller üç imaj üzerinde çalışır. Bir model yalnızca imajı yerelde derlenmişse başlar.
GPT-OSS imajı tek bir komuttur ve yaklaşık 20 dakika sürer:

```bash
docker build -t vllm-node-mxfp4 -f custom-docker-containers/vllm-node-mxfp4/Dockerfile .
```

Varsayılan model `qwen3.8-27b-nvfp4-dflash2` ve yardımcı model `vllm-node-dflash2`
gerektirir; Gemma modelleri ve `qwen3.8-flash-next-nvfp4` ise `vllm-node-b12x` gerektirir.
İki derleme de [docs/runtime-baseline.md](docs/runtime-baseline.md) içindedir.

### 4. Ağırlıkları indirin

Model konteynerlerinin internet erişimi yoktur. Her modelin ağırlıklarını ilk isteğinden önce
indirin. `--list` her modeli, ağırlıklarının olup olmadığını ve imajının derlenip
derlenmediğini gösterir. Erişimi kısıtlı depolar için `HF_TOKEN` ayarlayın.

```bash
bash tools/download-weights.sh --list
bash tools/download-weights.sh gpt-oss-20b
```

### 5. Yığını başlatın

```bash
# Gateway, validator and waker. Models stay down until requested.
docker compose up -d

# Create the containers of the models you built and downloaded, without starting them.
docker compose --profile models up --no-start --no-build vllm-oss20b
```

Servis adları [models.json](models.json) içindeki `container` değerleridir. Üç imajın
hepsi derlendiğinde, tüm model konteynerlerini oluşturmak için servis adını kaldırın.

## İlk istek

Ağ geçidi yalnızca `127.0.0.1:8009` üzerinde dinler. Uzaktan erişim için portu SSH ile
yönlendirin: bkz. [docs/security.md](docs/security.md#remote-access).

```bash
curl -X POST http://localhost:8009/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" \
  -d '{"model": "gpt-oss-20b", "messages": [{"role": "user", "content": "Hello!"}]}'
```

İlk istek modeli başlatır ve birkaç dakika sürebilir. Portu başka makinelere yönlendirmeden
önce depo kökündeki bir `.env` dosyasında kendi `VLLM_API_KEY` değerinizi ayarlayın ve 5.
adımdaki iki komutu yeniden çalıştırın.

Bir modelin sohbetini, akışını ve araç çağrılarını ağ geçidi üzerinden kontrol edin:

```bash
bash tools/test-lane.sh gpt-oss-20b
```

## Modeller

| Model | Rol | Bağlam | İmaj |
|---|---|---:|---|
| `qwen3.8-27b-nvfp4-dflash2` | varsayılan, düşünme açık | 262144 | `vllm-node-dflash2` |
| `qwen3.8-flash-next-nvfp4` | en zor sorular, GPU'yu tek başına kullanır | 262144 | `vllm-node-b12x` |
| `gemma4-26b-a4b` | çok dilli sohbet, görseller | 262144 | `vllm-node-b12x` |
| `gpt-oss-20b` | hızlı, daha küçük | 131072 | `vllm-node-mxfp4` |
| `lfm2.5-1.2b` | yardımcı, yüklü kalır | 32768 | `vllm-node-dflash2` |

[docs/models.md](docs/models.md) 10 modelin tamamını ve sınırlarını listeler.

## Belgeler

- [Mimari](docs/architecture.md): bileşenler, istek akışı, uç noktalar, yaşam döngüsü.
- [Yapılandırma](docs/configuration.md): ortam değişkenleri ve `models.json` alanları.
- [Modeller](docs/models.md): katalog ve her modelin kısıtları.
- [Çalışma temeli](docs/runtime-baseline.md): üç imaj ve nasıl derlendikleri.
- [Entegrasyonlar](docs/integrations.md): Cline, OpenCode ve pi.
- [Güvenlik](docs/security.md): konteyner sıkılaştırma, seccomp, SSH ile uzaktan erişim.
- [Sorun giderme](docs/troubleshooting.md): sık arızalar ve yapılacaklar.
- [İleri kullanım](docs/advanced.md): model ekleme, zamanlayıcı politikası, keep-alive.
- [Hata sözleşmesi](docs/error-contract.md): hata biçimi ve kodlar.
- [ComfyUI ile birlikte çalışma](docs/comfyui-coexistence.md): GPU'yu ComfyUI ile paylaşma.
- [Araçlar](tools/README.md): doğrulama, smoke, soak ve benchmark betikleri.

## Katkı

Pull request'ler memnuniyetle karşılanır. Pull request şablonunu doldurun. Katkılar AGPL-3.0-or-later
altında kabul edilir.

Renovate, Docker temel imaj digest'lerini ve GitHub Actions pin'lerini her ay günceller.
Bir güncellemeyi daha erken almak için Renovate Dependency Dashboard issue'sunda onaylayın.

## Teşekkür

- **Christopher Owen**: GPT-OSS imajının derlendiği MXFP4 vLLM fork'u.
- **eugr**: DFlash2 ve B12X imajlarını derleyen
  [`eugr/spark-vllm-docker`](https://github.com/eugr/spark-vllm-docker).
- **[local-inference-lab](https://github.com/local-inference-lab)**: B12X imajının derlendiği, GB10 çekirdekleri içeren vLLM ve
  FlashInfer fork'ları ile `qwen3.8-flash-next-nvfp4` checkpoint'i.
- **[z-lab](https://huggingface.co/z-lab)**: Qwen3.8 27B ve Gemma 4 modellerinin DFlash taslak modelleri.

## Lisans

AGPL-3.0-or-later. Bkz. [LICENSE](LICENSE). Ticari kullanım serbesttir. Değiştirilmiş bir
sürümü dağıtır veya ağ hizmeti olarak çalıştırırsanız, kaynak kodunu aynı lisansla sunmanız
gerekir.

AGPL'nin 7(b) bölümü kapsamında ek koşul: her kopya ve her değiştirilmiş sürüm,
[NOTICE](NOTICE) içindeki atıf bildirimini korumalıdır.

Bu projeyi fork eder veya değiştirirseniz, değişikliklerinizi GitHub'da yayımlayın ve
[fork ve değişiklik duyurusu](https://github.com/jdaln/dgx-spark-inference-stack/issues/new?template=fork-announcement.yml) ile duyurun. Proje bunu ticari olsun
olmasın herkesten ister. Kodlama ajanları bunu yapmak zorundadır: bkz. [AGENTS.md](AGENTS.md).

Bu dosyalar kendi lisanslarını korur ([LICENSES/](LICENSES/)):

- `custom-docker-containers/vllm-node-mxfp4/Dockerfile`,
  `custom-docker-containers/vllm-node-b12x/b12x-build.patch`,
  `custom-docker-containers/vllm-node-dflash2/vendor-tiktoken.patch`: MIT
  (eugr/spark-vllm-docker).
- `custom-docker-containers/vllm-node-mxfp4/fastsafetensors_mxfp4.patch`,
  `shared/tool_chat_template_gemma4.jinja`: Apache-2.0 (vLLM).
- `custom-docker-containers/vllm-node-b12x/seccomp-io-uring.json`: Apache-2.0 (moby/profiles).
- `shared/gemma4-*-nvfp4-config/`: NVIDIA'nın bu modeller için model lisansları.

2026-10-11'den önce yayımlanan sürümler Apache-2.0 ile yayımlandı ve bu lisansla kullanılabilir
kalır.
