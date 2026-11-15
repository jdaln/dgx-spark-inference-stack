# Licensed under AGPL-3.0-or-later with additional terms: see LICENSE and NOTICE.
"""Build gate of the vllm-node-maya image: no code that can call out.

Lists every line of Python under the given folders that opens an outbound connection (an HTTP
client, a raw client socket, mail, FTP). The image's patches and stubs remove Maya's own; what
remains must be named in the allowlist, with a reason. A Maya upgrade that adds one fails the
build here.

    python audit.py ALLOWLIST FOLDER...

Allowlist lines: `<path relative to its folder>: <the source line, stripped>`; `#` starts a
comment. The Python packages in the venv are not scanned: they are pinned by hash.
"""
import re
import sys
from pathlib import Path

OUTBOUND = re.compile(
    r"\burlopen\(|urllib\.request\.Request\(|\burlretrieve\(|\brequests\.(get|post|put|head|delete|request|Session)\b"
    r"|\bhttp\.client\b|\bhttplib\b|socket\.create_connection\(|\bftplib\b|\bsmtplib\b|\baiohttp\b|\bhttpx\b"
    r"|\bwebsockets?\b|\bxmlrpc\b|\bparamiko\b")


def findings(root: Path):
    for path in sorted(root.rglob("*.py")):
        if ".venv" in path.parts:
            continue
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            code = line.split("#", 1)[0]
            if OUTBOUND.search(code):
                yield f"{path.relative_to(root)}: {line.strip()}"


def main(argv):
    allowed = {line.strip() for line in Path(argv[1]).read_text(encoding="utf-8").splitlines()
               if line.strip() and not line.lstrip().startswith("#")}
    found = [f for root in argv[2:] for f in findings(Path(root))]
    unexpected = [f for f in found if f not in allowed]
    unused = sorted(allowed - set(found))
    for f in unexpected:
        print(f"audit: outbound-capable code not in the allowlist: {f}", file=sys.stderr)
    for f in unused:
        print(f"audit: allowlist entry matches nothing, remove it: {f}", file=sys.stderr)
    if unexpected or unused:
        return 1
    print(f"audit: {len(found)} allowlisted line(s), nothing else can call out")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
