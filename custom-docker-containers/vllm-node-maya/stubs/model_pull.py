# Licensed under AGPL-3.0-or-later with additional terms: see LICENSE and NOTICE.
"""Stand-in for Project Maya's serve/model_pull.py in the vllm-node-maya image.

Upstream downloads and installs models from its server. This image serves the weights mounted
read-only at /models and nothing else, so no download code is shipped. serve/server.py imports
the module; the routes that would call into it are not reachable in this image.
"""


def __getattr__(name):
    raise AttributeError(f"model downloads are not part of this image (model_pull.{name})")
