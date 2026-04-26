This image exists to run Gemma 4 checkpoints on top of the repo's TF5 vLLM runtime.

Pinned upstream sources:

- `huggingface/transformers` at `c472755e79aac54d675845bff5e5c821c21260af`
- `huggingface_hub==1.5.0`

The Dockerfile starts from the repo's `vllm-node-tf5` image, keeps its local vLLM runtime and CUTLASS guard patch, and upgrades only the Transformers/Hugging Face Hub layer so `gemma4` model types are recognized reproducibly from a clean clone.