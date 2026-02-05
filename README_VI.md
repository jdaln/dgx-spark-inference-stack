# DGX Spark Inference Stack - Phục vụ ngôi nhà của bạn!

> **Lưu ý:** Tài liệu này được dịch bởi AI và có thể chứa lỗi.

Nvidia DGX Spark của bạn không nên chỉ là một dự án phụ khác. Hãy bắt đầu sử dụng nó! Đây là một ngăn xếp suy luận dựa trên Docker để phục vụ các mô hình ngôn ngữ lớn (LLM) sử dụng NVIDIA vLLM với quản lý tài nguyên thông minh. Ngăn xếp này cung cấp tải mô hình theo yêu cầu với tính năng tự động tắt khi không hoạt động, lập lịch GPU đơn thuê bao và cổng API hợp nhất.

Mục tiêu của dự án là cung cấp một máy chủ suy luận cho ngôi nhà của bạn. Sau khi thử nghiệm điều này và thêm các mô hình mới trong một tháng, tôi quyết định phát hành nó cho cộng đồng. Vui lòng hiểu rằng đây là một dự án sở thích và sự trợ giúp cụ thể để cải thiện nó rất được hoan nghênh. Nó dựa trên thông tin tôi tìm thấy trên Internet và trên các Diễn đàn NVIDIA; tôi thực sự hy vọng nó giúp thúc đẩy các homelab. Điều này chủ yếu tập trung vào thiết lập DGX Spark đơn lẻ và phải hoạt động trên đó theo mặc định nhưng việc thêm hỗ trợ cho 2 rất được hoan nghênh.

## Tài liệu

- **[Kiến trúc & Cách hoạt động](docs/architecture.md)** - Hiểu ngăn xếp, dịch vụ waker và luồng yêu cầu.
- **[Cấu hình](docs/configuration.md)** - Biến môi trường, cài đặt mạng và điều chỉnh waker.
- **[Hướng dẫn Chọn Mô hình](docs/models.md)** - Danh sách chi tiết hơn 29 mô hình được hỗ trợ, bộ chọn nhanh và các trường hợp sử dụng.
- **[Tích hợp](docs/integrations.md)** - Hướng dẫn cho **Cline** (VS Code) và **OpenCode** (Đại lý Terminal).
- **[Bảo mật & Truy cập Từ xa](docs/security.md)** - Tăng cường SSH và thiết lập chuyển tiếp cổng hạn chế.
- **[Khắc phục sự cố & Giám sát](docs/troubleshooting.md)** - Gỡ lỗi, nhật ký và giải pháp cho các lỗi phổ biến.
- **[Sử dụng Nâng cao](docs/advanced.md)** - Thêm mô hình mới, cấu hình tùy chỉnh và hoạt động liên tục.
- **[Ghi chú TODO](TODO.md)** - Ý tưởng của tôi cho những việc cần làm tiếp theo.

## Bắt đầu Nhanh

1. **Sao chép kho lưu trữ**
   ```bash
   git clone <repository-url>
   cd dgx-spark-inference-stack
   ```

2. **Tạo các thư mục cần thiết**
   ```bash
   mkdir -p models vllm_cache_huggingface manual_download/openai_gpt-oss-encodings_fix
   ```

3. **Tải xuống tokenizers cần thiết (QUAN TRỌNG)**
   Ngăn xếp yêu cầu tải xuống thủ công các tệp tiktoken cho các mô hình GPT-OSS.
   ```bash
   wget https://openaipublic.blob.core.windows.net/encodings/cl100k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/cl100k_base.tiktoken
   wget https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken -O manual_download/openai_gpt-oss-encodings_fix/o200k_base.tiktoken
   ```

4. **Xây dựng Hình ảnh Docker Tùy chỉnh (BẮT BUỘC)**
   Ngăn xếp sử dụng các hình ảnh vLLM được tối ưu hóa tùy chỉnh cần được xây dựng cục bộ để đảm bảo hiệu suất tối đa.
   *   **Thời gian:** Dự kiến ​​khoảng 20 phút cho mỗi hình ảnh.
   *   **Xác thực:** Bạn phải xác thực với NVIDIA NGC để kéo các hình ảnh cơ sở.
       1.  Tạo tài khoản nhà phát triển tại [NVIDIA NGC Catalog](https://catalog.ngc.nvidia.com/) (không được ở quốc gia bị trừng phạt).
       2.  Chạy `docker login nvcr.io` với thông tin đăng nhập của bạn.
   *   **Lệnh Xây dựng:**
       ```bash
       # Xây dựng hình ảnh Avarok (Mục đích chung) - PHẢI sử dụng thẻ này để sử dụng phiên bản cục bộ thay vì thượng nguồn
       docker build -t avarok/vllm-dgx-spark:v11 custom-docker-containers/avarok

       # Xây dựng hình ảnh Christopher Owen (Tối ưu hóa MXFP4)
       docker build -t christopherowen/vllm-dgx-spark:v12 custom-docker-containers/christopherowen
       ```

5. **Khởi động ngăn xếp**
   ```bash
   # Chỉ khởi động cổng và waker (mô hình khởi động theo yêu cầu)
   docker compose up -d

   # Tạo trước tất cả các container mô hình đã bật (được khuyến nghị)
   docker compose --profile models up --no-start
   ```

6. **Kiểm tra API**
   ```bash
   # Yêu cầu đến qwen2.5-1.5b (sẽ tự động khởi động)
   curl -X POST http://localhost:8009/v1/qwen2.5-1.5b-instruct/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer ${VLLM_API_KEY:-63TestTOKEN0REPLACEME}" \
     -d '{
       "model": "qwen2.5-1.5b-instruct",
       "messages": [{"role": "user", "content": "Xin chào!"}]
     }'
   ```

## Điều kiện tiên quyết
- Docker 20.10+ với Docker Compose
- NVIDIA GPU(s) có hỗ trợ CUDA và NVIDIA Container Toolkit
- Máy chủ Linux (đã thử nghiệm trên Ubuntu)

## Đóng góp

Rất hoan nghênh các Pull Requests. :)
Tuy nhiên, để đảm bảo tính ổn định, tôi áp dụng **Mẫu Pull Request** nghiêm ngặt.

## ⚠️ Các vấn đề đã biết

### Mô hình Thử nghiệm (Tương thích GB10/CUDA 12.1)

Các mô hình sau được đánh dấu là **thử nghiệm** do sự cố ngẫu nhiên trên DGX Spark (GPU GB10):

- **Qwen3-Next-80B-A3B-Instruct** - Sự cố ngẫu nhiên trong lớp attention tuyến tính
- **Qwen3-Next-80B-A3B-Thinking** - Vấn đề tương tự

**Nguyên nhân gốc rễ:** GPU GB10 sử dụng CUDA 12.1, nhưng ngăn xếp vLLM/PyTorch hiện tại chỉ hỗ trợ CUDA ≤12.0. Điều này gây ra lỗi `cudaErrorIllegalInstruction` sau một vài yêu cầu thành công.

**Cách khắc phục:** Sử dụng `gpt-oss-20b` hoặc `gpt-oss-120b` để gọi công cụ ổn định cho đến khi có hình ảnh vLLM cập nhật với hỗ trợ GB10 thích hợp.

### Nemotron 3 Nano 30B (NVFP4)

Mô hình **`nemotron-3-nano-30b-nvfp4`** hiện đã bị vô hiệu hóa.
**Lý do:** Không tương thích với bản dựng vLLM hiện tại trên GB10. Yêu cầu hỗ trợ động cơ V1 thích hợp hoặc triển khai backend cập nhật.


### Hỗ trợ Hình ảnh/Ảnh chụp màn hình OpenCode trên Linux

OpenCode (đại lý AI terminal) có một lỗi đã biết trên Linux, trong đó **hình ảnh clipboard và hình ảnh đường dẫn tệp không hoạt động** với các mô hình thị giác. Mô hình phản hồi "The model you're using does not support image input" mặc dù các mô hình VL hoạt động chính xác qua API.

**Nguyên nhân gốc rễ:** Xử lý clipboard Linux của OpenCode làm hỏng dữ liệu hình ảnh nhị phân trước khi mã hóa (sử dụng `.text()` thay vì `.arrayBuffer()`). Không có dữ liệu hình ảnh thực tế nào được gửi đến máy chủ.

**Trạng thái:** Đây có vẻ là lỗi phía máy khách OpenCode. Hoan nghênh sự giúp đỡ điều tra/sửa lỗi! Ngăn xếp suy luận xử lý chính xác hình ảnh base64 khi được gửi đúng cách (đã xác minh qua curl).

**Cách khắc phục:** Sử dụng curl hoặc các ứng dụng khách API khác để gửi hình ảnh trực tiếp đến các mô hình VL như `qwen2.5-vl-7b`.

### Không tương thích Qwen 2.5 Coder 7B & OpenCode

Mô hình `qwen2.5-coder-7b-instruct` có giới hạn ngữ cảnh nghiêm ngặt là **32.768 tokens**. Tuy nhiên, OpenCode thường gửi các yêu cầu rất lớn (bộ đệm + đầu vào) vượt quá **35.000 tokens**, gây ra `ValueError` và yêu cầu thất bại.

**Khuyến nghị:** Không sử dụng `qwen2.5-coder-7b` với OpenCode cho các tác vụ ngữ cảnh dài. Thay vào đó, hãy sử dụng **`qwen3-coder-30b-instruct`** hỗ trợ ngữ cảnh **65.536 tokens** và xử lý các yêu cầu lớn của OpenCode một cách thoải mái.

### Không tương thích Llama 3.3 & OpenCode

Mô hình **`llama-3.3-70b-instruct-fp4`** **không được khuyến nghị sử dụng với OpenCode**.
**Lý do:** Mặc dù mô hình hoạt động chính xác qua API, nhưng nó thể hiện hành vi gọi công cụ tích cực khi được khởi tạo bởi các lời nhắc khách hàng cụ thể của OpenCode. Điều này dẫn đến lỗi xác thực và trải nghiệm người dùng bị suy giảm (ví dụ: cố gắng gọi công cụ ngay lập tức sau khi chào hỏi).
**Khuyến nghị:** Sử dụng `gpt-oss-20b` hoặc `qwen3-next-80b-a3b-instruct` cho các phiên OpenCode thay thế.

## Tín dụng

Đặc biệt cảm ơn các thành viên cộng đồng đã tạo ra các hình ảnh Docker được tối ưu hóa được sử dụng trong ngăn xếp này:

- **Thomas P. Braun từ Avarok**: Đối với hình ảnh vLLM đa năng (`avarok/vllm-dgx-spark`) hỗ trợ kích hoạt không cổng (Nemotron) và các mô hình lai, và các bài đăng như thế này https://blog.avarok.net/dgx-spark-nemotron3-and-nvfp4-getting-to-65-tps-8c5569025eb6.
- **Christopher Owen**: Đối với hình ảnh vLLM được tối ưu hóa MXFP4 (`christopherowen/vllm-dgx-spark`) cho phép suy luận hiệu suất cao trên DGX Spark.
- **eugr**: Đối với tất cả công việc tùy chỉnh hình ảnh vLLM gốc (`eugr/vllm-dgx-spark`) và các bài đăng tuyệt vời trên Diễn đàn NVIDIA.

### Nhà cung cấp Mô hình

Xin gửi lời cảm ơn to lớn đến các tổ chức tối ưu hóa các mô hình này cho suy luận FP4/FP8:

- **Fireworks AI** (`Firworks`): Đối với một loạt các mô hình được tối ưu hóa bao gồm GLM-4.5, Llama 3.3 và Ministral.
- **NVIDIA**: Đối với Qwen3-Next, Nemotron và triển khai FP4 tiêu chuẩn.
- **RedHat**: Đối với Qwen3-VL và Mistral Small.
- **QuantTrio**: Đối với Qwen3-VL-Thinking.
- **OpenAI**: Đối với các mô hình GPT-OSS.

## Giấy phép

Dự án này được cấp phép theo **Giấy phép Apache 2.0**. Xem tệp [LICENSE](LICENSE) để biết chi tiết.
