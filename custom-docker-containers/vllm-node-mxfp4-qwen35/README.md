This image exists to run the dedicated qwen3_5-capable TF5 runtime for `huihui-ai/Huihui-Qwen3.6-27B-abliterated`.

Pinned upstream sources:

- `huggingface/transformers` at `eb981ae8688d459f40f35b0e0c352b5ca3cb3613`
- `huggingface_hub==1.5.0`

The Dockerfile starts from the repo's TF5 runtime image, which already carries the qwen3_5-capable vLLM runtime, and then upgrades only the Transformers/Hugging Face Hub layer to exact pinned revisions. That keeps the TF5 base image's known-good compiled runtime while making the missing qwen3_5 Hugging Face support reproducible from a clean clone.