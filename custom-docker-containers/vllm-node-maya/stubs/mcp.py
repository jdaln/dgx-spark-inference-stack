# Licensed under AGPL-3.0-or-later with additional terms: see LICENSE and NOTICE.
"""Stand-in for Project Maya's serve/mcp.py in the vllm-node-maya image.

Upstream's MCP client starts tool servers and calls them over HTTP for its web app. The image
ships none of it: serve/server.py imports these two names and gets no hub.
"""


class McpCancelled(Exception):
    pass


def hub_from_config(cfg, mcp_config=None):
    if (cfg or {}).get("mcp_servers") or mcp_config:
        raise SystemExit("MCP servers are not part of this image")
    return None
