# docker build -t avarok/vllm-dgx-spark:v11-tf5 .
FROM avarok/vllm-dgx-spark:v11@sha256:246723e9a74163e7828716c1587d6c5208a9cf0dc8d1195cbd33f68234b1024b
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir --upgrade --pre "transformers==5.0.0rc1"
