# DGX Spark Inference Stack - Hãy để nó thật sự phục vụ ngôi nhà của bạn!

🌍 **Đọc bằng các ngôn ngữ khác**:
[Deutsch](README_DE.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Italiano](README_IT.md) | [日本語](README_JA.md) | [简体中文](README_ZH_CN.md) | [繁體中文](README_ZH_TW.md) | [Русский](README_RU.md) | [Українська](README_UK.md) | [Português](README_PT.md) | [한국어](README_KO.md) | [العربية](README_AR.md) | [Tiếng Việt](README_VI.md) | [Türkçe](README_TR.md)

> **Ghi chú dịch bằng AI:** Tệp này được AI dịch từ [README.md](README.md). Nội dung có thể còn lỗi hoặc chậm cập nhật hơn bản tiếng Anh. Nếu có điểm nào không chắc chắn, hãy ưu tiên README tiếng Anh.

Nvidia DGX Spark của bạn không nên chỉ là một dự án phụ nữa. Hãy dùng nó thật sự. Đây là một stack suy luận dựa trên Docker để phục vụ các mô hình ngôn ngữ lớn (LLM) bằng NVIDIA vLLM cùng cơ chế quản lý tài nguyên thông minh. Stack này cung cấp khả năng nạp mô hình theo nhu cầu với tự động tắt khi rảnh, một làn lập lịch duy nhất cho mô hình chính cùng một helper tiện ích tùy chọn, và một cổng API hợp nhất.

Mục tiêu của dự án là cung cấp một máy chủ suy luận cho môi trường gia đình. Sau khi thử nghiệm trong một tháng và bổ sung thêm mô hình mới, tôi quyết định phát hành nó cho cộng đồng. Xin lưu ý đây là một dự án hobby, vì vậy mọi hỗ trợ cụ thể để cải thiện nó đều rất đáng quý. Nó được xây dựng dựa trên thông tin tôi tìm thấy trên Internet và trên các diễn đàn NVIDIA. Tôi thật sự hy vọng nó sẽ giúp đẩy các homelab đi xa hơn. Trọng tâm chính là một DGX Spark đơn lẻ và mặc định phải hoạt động tốt trên cấu hình đó, nhưng hỗ trợ cho 2 máy cũng rất được hoan nghênh.

## Tài liệu

- **[Kiến trúc và cách hoạt động](docs/architecture.md)** - Hiểu stack, dịch vụ waker và luồng request.
- **[Cấu hình](docs/configuration.md)** - Biến môi trường, thiết lập mạng và tinh chỉnh waker.
- **[Hướng dẫn chọn mô hình](docs/models.md)** - Danh mục mô hình hiện tại, bộ chọn nhanh và trạng thái xác thực.
- **[Tích hợp](docs/integrations.md)** - Hướng dẫn cho **Cline** (VS Code) và **OpenCode** (tác tử terminal).
- **[Bảo mật và truy cập từ xa](docs/security.md)** - Gia cố SSH và thiết lập port forwarding có giới hạn.
- **[Khắc phục sự cố và giám sát](docs/troubleshooting.md)** - Gỡ lỗi, log và cách xử lý lỗi phổ biến.
- **[Sử dụng nâng cao](docs/advanced.md)** - Thêm mô hình mới, cấu hình tùy chỉnh và vận hành liên tục.
- **[Baseline runtime](docs/runtime-baseline.md)** - Những image track cục bộ mà repo kỳ vọng và cách build lại chúng.
- **[Công cụ và bộ harness kiểm thử](tools/README.md)** - Các script smoke, soak, inspection và probe thủ công được hỗ trợ.
- **[Ghi chú TODO](TODO.md)** - Những ý tưởng tôi muốn làm tiếp theo.

## Bắt đầu nhanh

1. **Clone repository**
   ```bash
   git clone <repository-url>
   cd dgx-spark-inference-stack
   ```

2. **Tạo các thư mục cần thiết**
   ```bash
   mkdir -p models vllm_cache_huggingface manual_download/openai_gpt-oss-encodings_fix
   ```

3. **Tải tokenizer cần thiết (RẤT QUAN TRỌNG)**
   Stack này yêu cầu tải thủ công các tệp `tiktoken` cho các mô hình GPT-OSS.
   ```bash
   wget https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/cl100k_base.tiktoken
   wget https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/o200k_base.tiktoken
   ```

4. **Build các image Docker tùy chỉnh (BẮT BUỘC)**
   Stack dùng các image vLLM tối ưu hóa và nên được build cục bộ để đảm bảo hiệu năng tối đa.
   *   **Thời gian:** Hãy dự trù khoảng 20 phút cho mỗi image.
   *   **Xác thực:** Bạn phải đăng nhập NVIDIA NGC để pull các image nền.
       1.  Tạo tài khoản nhà phát triển tại [NVIDIA NGC Catalog](https://catalog.ngc.nvidia.com/) (không được ở quốc gia bị cấm vận).
       2.  Chạy `docker login nvcr.io` bằng thông tin đăng nhập của bạn.
      **Lệnh build:**
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
   *   **Lưu ý:** `vllm-node-tf5` hiện không được build từ Dockerfile nội bộ của repo. Nếu bạn định chạy Gemma 4 hoặc các nhánh Qwen TF5 mới hơn, hãy build nó một cách tường minh bằng luồng upstream helper ở trên. Xem [docs/runtime-baseline.md](docs/runtime-baseline.md) để biết đúng các bước tái tạo và yêu cầu mạng khi build.

5. **Khởi động stack**
   ```bash
   # Start gateway and waker only (models start on-demand)
   docker compose up -d

   # Pre-create all enabled model containers once the required local track images exist
   docker compose --profile models up --no-start
   ```

6. **Kiểm tra API**
   ```bash
    # Request to the shipped utility helper
    curl -X POST http://localhost:8009/v1/chat/completions\
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" \
     -d '{
          "model": "qwen3.5-0.8b",
       "messages": [{"role": "user", "content": "Xin chào!"}]
     }'
   ```

7. **Sử dụng bộ harness xác thực được hỗ trợ**
   Sau khi lệnh `curl` thủ công đầu tiên thành công, hãy chuyển sang luồng bring-up do repo duy trì thay vì dùng các script tạm thời:
   ```bash
   bash tools/validate-stack.sh
   bash tools/smoke-gateway.sh
   ```
   Với các lệnh bring-up, smoke, soak và probe thủ công theo từng mô hình, hãy xem [tools/README.md](tools/README.md).

## Nếu bạn là người mới, hãy bắt đầu từ đây

- Đọc [docs/architecture.md](docs/architecture.md), rồi tới [tools/README.md](tools/README.md).
- Xem [tools/README.md](tools/README.md) cùng với [models.json](models.json) là nguồn sự thật vận hành hiện tại.
- Xem README này là điểm vào ngắn gọn, không phải danh mục mô hình đầy đủ. Hãy dùng [docs/models.md](docs/models.md) cho danh mục rộng hơn.

## Điều kiện tiên quyết
- Docker 20.10+ cùng Docker Compose
- GPU NVIDIA hỗ trợ CUDA và NVIDIA Container Toolkit
- Máy Linux (đã thử nghiệm trên Ubuntu)

## Đóng góp

Pull request luôn được hoan nghênh. :)
Tuy vậy, để giữ ổn định, tôi áp dụng **mẫu Pull Request nghiêm ngặt**.

## Trạng thái hiện tại

README này hiện chỉ nêu bật các đường chạy mặc định đang được khuyến nghị của stack.

- **Mô hình chính đã được xác thực:** `gpt-oss-20b`, `gpt-oss-120b` và `glm-4.7-flash-awq`
- **Helper tiện ích đã được xác thực:** `qwen3.5-0.8b` cho tiêu đề và metadata phiên
- **Mọi thứ còn lại:** Có trong repo, nhưng chưa phải lựa chọn mặc định của README này cho tới khi được xác thực lại bằng harness hiện tại

Để xem danh mục mô hình rộng hơn, các đường chạy thử nghiệm và các trường hợp thủ công, hãy dùng [docs/models.md](docs/models.md) và [models.json](models.json).

Để xem các lưu ý phía client, đặc điểm runtime và ghi chú troubleshooting, hãy dùng [docs/integrations.md](docs/integrations.md) và [docs/troubleshooting.md](docs/troubleshooting.md).

## Ghi công

Xin cảm ơn đặc biệt tới các thành viên cộng đồng mà những Docker image và công thức của họ đã góp phần định hình stack này:

- **Thomas P. Braun từ Avarok**: Vì image vLLM đa dụng (`avarok/vllm-dgx-spark`) hỗ trợ non-gated activations (Nemotron), các mô hình hybrid và những bài viết như https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6.
- **Christopher Owen**: Vì image vLLM tối ưu cho MXFP4 (`christopherowen/vllm-dgx-spark`) giúp inference hiệu năng cao trên DGX Spark.
- **eugr**: Vì kho cộng đồng vLLM cho DGX Spark ban đầu (`eugr/spark-vllm-docker`), các tùy biến của nó và những bài đăng rất hay trên diễn đàn NVIDIA.
- **Patrick Yi / scitrera.ai**: Vì công thức utility-model SGLang đã góp phần định hình đường chạy helper `qwen3.5-0.8b` cục bộ.
- **Raphael Amorim**: Vì hình thái công thức AutoRound của cộng đồng đã định hình đường chạy cục bộ thử nghiệm `qwen3.5-122b-a10b-int4-autoround`.
- **Bjarke Bolding**: Vì hình thái công thức AutoRound cho ngữ cảnh dài đã định hình đường chạy cục bộ thử nghiệm `qwen3-coder-next-int4-autoround`.

## Giấy phép

Dự án này được cấp phép theo **Apache License 2.0**. Xem [LICENSE](LICENSE) để biết chi tiết.
