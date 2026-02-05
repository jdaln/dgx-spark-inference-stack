# docker build -t avarok/vllm-dgx-spark:v11-tf5 .
FROM avarok/vllm-dgx-spark:v11
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir --upgrade --pre "transformers==5.0.0rc1"
