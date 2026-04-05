from pathlib import Path
import sys


def replace_once(path: Path, old: str, new: str, description: str) -> None:
    text = path.read_text()
    if old not in text:
        raise SystemExit(f"expected {description} not found in {path}")
    path.write_text(text.replace(old, new, 1))


def patch_cache_kernels(repo_root: Path) -> None:
    replace_once(
        repo_root / "csrc/cache_kernels.cu",
        """  CUmemcpyAttributes attr = {};
  attr.srcAccessOrder = CU_MEMCPY_SRC_ACCESS_ORDER_STREAM;
  size_t attrs_idx = 0;
  size_t fail_idx = 0;
  CUresult result = cuMemcpyBatchAsync(
      reinterpret_cast<CUdeviceptr*>(const_cast<int64_t*>(dst_data)),
      reinterpret_cast<CUdeviceptr*>(const_cast<int64_t*>(src_data)),
      reinterpret_cast<size_t*>(const_cast<int64_t*>(size_data)),
      static_cast<size_t>(n), &attr, &attrs_idx, 1, &fail_idx,
      static_cast<CUstream>(stream));
  TORCH_CHECK(result == CUDA_SUCCESS, "cuMemcpyBatchAsync failed at index ",
              fail_idx, " with error ", result);""",
        """  CUmemcpyAttributes attr = {};
  attr.srcAccessOrder = CU_MEMCPY_SRC_ACCESS_ORDER_STREAM;
  size_t attrs_idx = 0;
  CUresult result = cuMemcpyBatchAsync(
      reinterpret_cast<CUdeviceptr*>(const_cast<int64_t*>(dst_data)),
      reinterpret_cast<CUdeviceptr*>(const_cast<int64_t*>(src_data)),
      reinterpret_cast<size_t*>(const_cast<int64_t*>(size_data)),
      static_cast<size_t>(n), &attr, &attrs_idx, 1,
      static_cast<CUstream>(stream));
  TORCH_CHECK(result == CUDA_SUCCESS, "cuMemcpyBatchAsync failed with error ",
              result);""",
        "cuMemcpyBatchAsync CUDA 13 branch",
    )


def patch_setup(repo_root: Path) -> None:
    replace_once(
        repo_root / "setup.py",
        """if _build_custom_ops():
    ext_modules.append(CMakeExtension(name="vllm._C"))
    # also _is_hip() once https://github.com/vllm-project/vllm/issues/35163 is
    # fixed
    if _is_cuda():
        ext_modules.append(CMakeExtension(name="vllm._C_stable_libtorch"))
""",
        """if _build_custom_ops():
    ext_modules.append(CMakeExtension(name="vllm._C"))
""",
        "stable libtorch ext_modules block",
    )


def patch_cuda_platform(repo_root: Path) -> None:
    replace_once(
        repo_root / "vllm/platforms/cuda.py",
        """# import custom ops, trigger op registration
import vllm._C  # noqa
import vllm._C_stable_libtorch  # noqa
import vllm.envs as envs
""",
        """# import custom ops, trigger op registration
import vllm._C  # noqa
try:
    import vllm._C_stable_libtorch  # noqa
except ImportError:
    pass
import vllm.envs as envs
""",
        "stable libtorch import block",
    )


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch_cache_kernels.py <vllm-repo-root>")

    repo_root = Path(sys.argv[1])
    patch_cache_kernels(repo_root)
    patch_setup(repo_root)
    patch_cuda_platform(repo_root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())