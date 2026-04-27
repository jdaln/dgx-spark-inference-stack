#!/bin/bash
set -e
SCRIPT_DIR="$(dirname "$0")"

# Detect vLLM installation path
VLLM_PATH=$(python3 -c "import vllm, os; print(os.path.dirname(vllm.__file__))")
SITE_PACKAGES_ROOT="$(dirname "$VLLM_PATH")"

TRANSFORMERS_OVERLAY_DIR="/workspace/transformers-overlay/transformers"
if [ -d "$TRANSFORMERS_OVERLAY_DIR" ]; then
	python3 -m pip install --no-deps 'huggingface_hub>=1.5.0,<2.0'
	python3 -m pip uninstall -y hf_xet >/dev/null 2>&1 || true
	rm -rf "$SITE_PACKAGES_ROOT/transformers"
	cp -a "$TRANSFORMERS_OVERLAY_DIR" "$SITE_PACKAGES_ROOT/transformers"
	python3 -c 'from transformers.models.auto.configuration_auto import CONFIG_MAPPING_NAMES; assert "glm4_moe_lite" in CONFIG_MAPPING_NAMES'
fi

# We need to construct the full path to triton_mla.py relative to root
TARGET_REL_PATH="${VLLM_PATH#/}/v1/attention/backends/mla/triton_mla.py"

# Update patch file on the fly and apply it
SPEED_PATCH_FILE="$(mktemp)"
sed "s|usr/local/lib/python3.12/dist-packages/vllm/v1/attention/backends/mla/triton_mla.py|$TARGET_REL_PATH|g" "$SCRIPT_DIR/glm47_flash.patch" > "$SPEED_PATCH_FILE"
if patch --dry-run -p1 -d / < "$SPEED_PATCH_FILE" >/dev/null 2>&1; then
	patch -p1 -d / < "$SPEED_PATCH_FILE"
else
	echo "=== GLM 4.7 speed patch no longer applies cleanly on this vLLM build, skipping"
fi
rm -f "$SPEED_PATCH_FILE"

# Apply the vendored upstream bug fix locally instead of fetching a patch at runtime.
TARGET_BUG_FILE="$VLLM_PATH/model_executor/layers/attention/mla_attention.py"
if [ ! -f "$TARGET_BUG_FILE" ]; then
	echo "=== GLM 4.7 bug patch target not present in this vLLM build, skipping"
elif grep -q 'hasattr(self.kv_b_proj, "weight")' "$TARGET_BUG_FILE" 2>/dev/null; then
	echo "=== GLM 4.7 bug patch already applied, skipping"
else
	patch -p1 -d "$SITE_PACKAGES_ROOT" < "$SCRIPT_DIR/glm47_vllm_bug.patch"
fi

if [ -f "$TARGET_BUG_FILE" ]; then
	python3 - "$TARGET_BUG_FILE" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
old = "self.kv_b_proj.weight.dtype"
new = '(self.kv_b_proj.weight.dtype if hasattr(self.kv_b_proj, "weight") else torch.bfloat16)'

if old in text:
	text = text.replace(old, new)
	path.write_text(text)
PY
fi

CUSTOM_OPS_FILE="$VLLM_PATH/_custom_ops.py"
python3 - "$CUSTOM_OPS_FILE" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
replacements = [
	(
		"""def cutlass_scaled_mm_supports_fp4(cuda_device_capability: int) -> bool:\n    return torch.ops._C.cutlass_scaled_mm_supports_fp4(cuda_device_capability)\n""",
		"""def cutlass_scaled_mm_supports_fp4(cuda_device_capability: int) -> bool:\n    try:\n        return torch.ops._C.cutlass_scaled_mm_supports_fp4(cuda_device_capability)\n    except AttributeError:\n        return False\n""",
	),
	(
		"""def cutlass_scaled_mm_supports_fp8(cuda_device_capability: int) -> bool:\n    return torch.ops._C.cutlass_scaled_mm_supports_fp8(cuda_device_capability)\n""",
		"""def cutlass_scaled_mm_supports_fp8(cuda_device_capability: int) -> bool:\n    try:\n        return torch.ops._C.cutlass_scaled_mm_supports_fp8(cuda_device_capability)\n    except AttributeError:\n        return False\n""",
	),
	(
		"""def cutlass_scaled_mm_supports_block_fp8(cuda_device_capability: int) -> bool:\n    return torch.ops._C.cutlass_scaled_mm_supports_block_fp8(cuda_device_capability)\n""",
		"""def cutlass_scaled_mm_supports_block_fp8(cuda_device_capability: int) -> bool:\n    try:\n        return torch.ops._C.cutlass_scaled_mm_supports_block_fp8(cuda_device_capability)\n    except AttributeError:\n        return False\n""",
	),
]

for old, new in replacements:
	if new in text:
		continue
	if old not in text:
		raise SystemExit(f"expected CUTLASS support helper not found in {path}")
	text = text.replace(old, new, 1)

path.write_text(text)
PY

python3 - "$VLLM_PATH" <<'PY'
from pathlib import Path
import re
import sys

root = Path(sys.argv[1])
targets = [
	root / "compilation/passes/fusion/matcher_utils.py",
	root / "compilation/passes/fusion/rms_quant_fusion.py",
]
pattern = re.compile(
	r'if current_platform\.is_cuda\(\):\n'
	r'\s+QUANT_OPS\[kFp8Dynamic128Sym\] = torch\.ops\._C\.per_token_group_fp8_quant\.default  # noqa: E501\n'
	r'\s+QUANT_OPS\[kFp8Dynamic64Sym\] = torch\.ops\._C\.per_token_group_fp8_quant\.default  # noqa: E501\n?',
)
replacement = """if current_platform.is_cuda() and hasattr(torch.ops._C, \"per_token_group_fp8_quant\"):
	QUANT_OPS[kFp8Dynamic128Sym] = torch.ops._C.per_token_group_fp8_quant.default  # noqa: E501
	QUANT_OPS[kFp8Dynamic64Sym] = torch.ops._C.per_token_group_fp8_quant.default  # noqa: E501
"""

for path in targets:
	text = path.read_text()
	if replacement in text:
		continue
	if "per_token_group_fp8_quant.default" not in text:
		raise SystemExit(f"expected grouped fp8 registration block not found in {path}")
	updated, count = pattern.subn(replacement, text, count=1)
	if count != 1:
		raise SystemExit(f"expected grouped fp8 registration block not found in {path}")
	path.write_text(updated)
PY
