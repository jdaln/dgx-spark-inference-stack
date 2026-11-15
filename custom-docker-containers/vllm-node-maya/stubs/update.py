# Licensed under AGPL-3.0-or-later with additional terms: see LICENSE and NOTICE.
"""Stand-in for Project Maya's serve/update.py in the vllm-node-maya image.

The image is built from a pinned commit and never updates itself, so upstream's update check (a
request to api.github.com) and its git fast-forward are not shipped. serve/server.py imports
these two names; the routes that would use the rest are not reachable in this image.
"""

RESTART_EXIT = 76


class Updater:
    def __init__(self, current=None, root=None):
        self.current = current

    def enabled(self) -> bool:
        return False

    def busy(self) -> bool:
        return False

    def __getattr__(self, name):
        raise AttributeError(f"updates are not part of this image (Updater.{name})")
