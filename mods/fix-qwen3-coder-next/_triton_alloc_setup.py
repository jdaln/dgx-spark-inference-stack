try:
    import triton.runtime._allocation as _alloc
    import torch

    _alloc.NullAllocator.__call__ = staticmethod(
        lambda size, alignment, stream:
            torch.cuda.caching_allocator_alloc(size, stream=stream))
except Exception:
    pass