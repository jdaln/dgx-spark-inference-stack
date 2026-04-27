ARG BASE_IMAGE=local/vllm-node-tf5:cu131
FROM ${BASE_IMAGE}

COPY mods/fix-glm-4.7-flash-AWQ /workspace/mods/fix-glm-4.7-flash-AWQ
COPY tmp/transformers-upstream/src/transformers /workspace/transformers-overlay/transformers

RUN bash /workspace/mods/fix-glm-4.7-flash-AWQ/run.sh