# DGX Spark Inference Stack - Hãy để nó thật sự phục vụ ngôi nhà của bạn!

🌍 **Đọc bằng các ngôn ngữ khác**:
[Deutsch](README_DE.md) | [Español](README_ES.md) | [Français](README_FR.md) | [Italiano](README_IT.md) | [日本語](README_JA.md) | [简体中文](README_ZH_CN.md) | [繁體中文](README_ZH_TW.md) | [Русский](README_RU.md) | [Українська](README_UK.md) | [Português](README_PT.md) | [한국어](README_KO.md) | [العربية](README_AR.md) | [Tiếng Việt](README_VI.md) | [Türkçe](README_TR.md)

> **Ghi chú dịch bằng AI:** Tệp này được AI dịch từ [README.md](README.md). Nội dung có thể còn lỗi hoặc chậm cập nhật hơn bản tiếng Anh. Nếu có điểm nào không chắc chắn, hãy ưu tiên README tiếng Anh.

Nvidia DGX Spark của bạn không nên chỉ là một dự án phụ nữa. Hãy dùng nó thật sự. Đây là một stack suy luận dựa trên Docker để phục vụ các mô hình ngôn ngữ lớn (LLM) bằng NVIDIA vLLM cùng cơ chế quản lý tài nguyên thông minh. Stack này cung cấp khả năng nạp mô hình theo nhu cầu với tự động tắt khi rảnh, một làn lập lịch duy nhất cho mô hình chính cùng một helper tiện ích tùy chọn, và một cổng API hợp nhất.

Mục tiêu của dự án là cung cấp một máy chủ suy luận cho môi trường gia đình. Sau khi thử nghiệm trong một tháng và bổ sung thêm mô hình mới, tôi quyết định phát hành nó cho cộng đồng. Xin lưu ý đây là một dự án hobby, vì vậy mọi hỗ trợ cụ thể để cải thiện nó đều rất đáng quý. Nó được xây dựng dựa trên thông tin tôi tìm thấy trên Internet và trên các diễn đàn NVIDIA. Tôi thật sự hy vọng nó sẽ giúp đẩy các homelab đi xa hơn. Trọng tâm chính là một DGX Spark đơn lẻ và mặc định phải hoạt động tốt trên cấu hình đó, nhưng hỗ trợ cho 2 máy cũng rất được hoan nghênh.

## Tài liệu

- **[Kiến trúc và cách hoạt động](docs/architecture.md)** - Hiểu stack, dịch vụ waker và luồng request.
- **[Cấu hình](docs/configuration.md)** - Biến môi trường, thiết lập mạng và tinh chỉnh waker.
- **[Hướng dẫn chọn mô hình](docs/models.md)** - Danh sách chi tiết hơn 29 mô hình được hỗ trợ, bộ chọn nhanh và các trường hợp sử dụng.
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
   *   **Lệnh build:**
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
    curl -X POST http://localhost:8009/v1/qwen3.5-0.8b/chat/completions \
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

- Đọc [README.md](README.md), sau đó [docs/architecture.md](docs/architecture.md), rồi tới [tools/README.md](tools/README.md).
- Xem [tools/README.md](tools/README.md) cùng với [models.json](models.json) là nguồn sự thật vận hành hiện tại.
- Các mô hình nằm ngoài tập đã được xác thực trong README này nên được xem là thử nghiệm cho tới khi harness xác nhận lại.

## Điều kiện tiên quyết
- Docker 20.10+ cùng Docker Compose
- GPU NVIDIA hỗ trợ CUDA và NVIDIA Container Toolkit
- Máy Linux (đã thử nghiệm trên Ubuntu)

## Đóng góp

Pull request luôn được hoan nghênh. :)
Tuy vậy, để giữ ổn định, tôi áp dụng **mẫu Pull Request nghiêm ngặt**.

## ⚠️ Vấn đề đã biết

### Trạng thái xác thực hiện tại

Với harness hiện tại và các mặc định của repo, hiện chỉ có các **mô hình chính đã được xác thực** sau đây:

- **`gpt-oss-20b`**
- **`gpt-oss-120b`**
- **`glm-4.7-flash-awq`**

Helper nhỏ `qwen3.5-0.8b` đi kèm hiện là **mô hình tiện ích đã được xác thực** cho tiêu đề và metadata phiên, nhưng nó không thuộc tập mô hình chính đã được xác thực này.

Những mô hình khác vẫn có thể hoạt động, nhưng ngoài helper tiện ích đã được xác thực này, chúng nên được xem là **thử nghiệm** chứ không phải mặc định được khuyến nghị cho tới khi được kiểm tra lại bằng bộ công cụ hiện tại.

### Mô hình thử nghiệm (tương thích GB10 / CUDA 12.1)

Các mô hình sau được đánh dấu là **thử nghiệm** do thỉnh thoảng bị crash trên DGX Spark (GPU GB10):

- **Qwen3-Next-80B-A3B-Instruct** - Crash ngẫu nhiên trong lớp linear attention
- **Qwen3-Next-80B-A3B-Thinking** - Cùng một vấn đề

**Nguyên nhân gốc:** GPU GB10 dùng CUDA 12.1, nhưng stack vLLM / PyTorch hiện tại chỉ hỗ trợ CUDA ≤12.0. Điều này gây ra lỗi `cudaErrorIllegalInstruction` sau vài request thành công.

**Cách tạm thời:** Dùng `gpt-oss-20b` hoặc `gpt-oss-120b` cho tool calling ổn định cho tới khi có image vLLM mới hỗ trợ đúng cho GB10.

### Nemotron 3 Nano 30B (NVFP4)

Mô hình **`nemotron-3-nano-30b-nvfp4`** hiện đã được bật lại trên đường chạy chuẩn `vllm-node` đã làm mới, nhưng với harness hiện tại nó vẫn nên được xem là **thử nghiệm**.
**Trạng thái hiện tại:** Giờ đây nó có thể load và trả lời request trên runtime mới, nhưng chưa nằm trong tập mô hình chính đã được xác thực cũng như chưa có trong cấu hình OpenCode đi kèm.
**Hành vi quan trọng:** Nội dung assistant hiển thị phụ thuộc vào dạng request non-thinking. Request validator giờ sẽ chèn mặc định đó cho các request đi qua gateway thông thường.
**Ngưỡng client bảo thủ hiện tại:** Khoảng `100000` prompt token cho cách dùng thủ công kiểu OpenCode / Cline. Bài soak 5 luồng hiện tại của stack vượt qua ổn định ở khoảng `101776` prompt token và đã khá sát ngưỡng ở khoảng `116298`.

### Hỗ trợ ảnh / ảnh chụp màn hình của OpenCode trên Linux

OpenCode (tác tử AI trên terminal) có một lỗi đã biết trên Linux khiến **ảnh từ clipboard và ảnh theo đường dẫn tệp không hoạt động** với các mô hình thị giác. Mô hình trả lời "The model you're using does not support image input" dù các mô hình VL vẫn hoạt động bình thường qua API.

**Nguyên nhân gốc:** Cách OpenCode xử lý clipboard trên Linux làm hỏng dữ liệu nhị phân của ảnh trước khi mã hóa (dùng `.text()` thay vì `.arrayBuffer()`). Nghĩa là thực tế không có dữ liệu ảnh nào được gửi tới máy chủ.

**Trạng thái:** Có vẻ đây là lỗi phía client OpenCode. Mọi trợ giúp để điều tra hoặc sửa lỗi đều được hoan nghênh. Bản thân stack inference vẫn xử lý đúng ảnh base64 khi chúng được gửi chuẩn qua `curl` hoặc client API khác.

**Cách tạm thời:** Dùng `curl` hoặc client API khác để gửi ảnh trực tiếp tới các mô hình VL như `qwen2.5-vl-7b`.

### Qwen 2.5 Coder 7B và sự không tương thích với OpenCode

Mô hình `qwen2.5-coder-7b-instruct` có giới hạn ngữ cảnh cứng là **32.768 token**. Nhưng OpenCode thường gửi những request rất lớn (buffer + input) vượt quá **35.000 token**, dẫn tới `ValueError` và request thất bại.

**Khuyến nghị:** Không dùng `qwen2.5-coder-7b` với OpenCode cho các tác vụ ngữ cảnh dài. Thay vào đó hãy dùng **`qwen3-coder-30b-instruct`**, hỗ trợ **65.536 token** ngữ cảnh và xử lý các request lớn của OpenCode tốt hơn nhiều.

### Llama 3.3 và sự không tương thích với OpenCode

Mô hình **`llama-3.3-70b-instruct-fp4`** **không được khuyến nghị cho OpenCode**.
**Lý do:** Dù mô hình hoạt động bình thường qua API, nó lại thể hiện hành vi tool calling quá hung hăng khi được khởi tạo bằng các prompt đặc thù của OpenCode. Điều này dẫn đến lỗi xác thực và trải nghiệm kém hơn, ví dụ cố gọi công cụ ngay sau lời chào.
**Khuyến nghị:** Với phiên OpenCode, hãy dùng `gpt-oss-20b` hoặc `qwen3-next-80b-a3b-instruct`.

## Ghi công

Xin cảm ơn đặc biệt tới các thành viên cộng đồng đã tạo ra những Docker image tối ưu được dùng trong stack này:

- **Thomas P. Braun từ Avarok**: Vì image vLLM đa dụng (`avarok/vllm-dgx-spark`) hỗ trợ non-gated activations (Nemotron), các mô hình hybrid và những bài viết như https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6.
- **Christopher Owen**: Vì image vLLM tối ưu cho MXFP4 (`christopherowen/vllm-dgx-spark`) giúp inference hiệu năng cao trên DGX Spark.
- **eugr**: Vì toàn bộ công sức tùy biến image vLLM gốc (`eugr/vllm-dgx-spark`) và những bài đăng rất tốt trên diễn đàn NVIDIA.
- **Patrick Yi / scitrera.ai**: Vì công thức utility-model SGLang đã góp phần định hình đường chạy helper `qwen3.5-0.8b` cục bộ.

## Giấy phép

Dự án này được cấp phép theo **Apache License 2.0**. Xem [LICENSE](LICENSE) để biết chi tiết.
