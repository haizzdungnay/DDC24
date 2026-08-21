#!/usr/bin/env python3
"""Sinh SBOM cho gói phát hành MK-DDC-24 (T59-606).

Vì sao cần: `provenance.json` trả lời "bản này build từ commit nào", nhưng không
trả lời "bản này CHỨA những gì". Khi có CVE trong một thư viện, câu hỏi đầu tiên
của người vận hành là "bo của tôi có dính không" — và không có SBOM thì câu trả
lời phải tìm bằng cách đọc lại mã nguồn của đúng commit đó.

SBOM ở đây liệt kê ba lớp phụ thuộc THẬT đi vào binary:
  - C/C++: thư viện hệ thống link động (libsodium, libmodbus) và nguồn kéo về
    lúc build (nlohmann/json, bacnet-stack);
  - Go: toàn bộ module trong build list, lấy từ `go list -m all`;
  - Frontend: dependency runtime của bundle, lấy từ `npm ls --omit=dev`.

Trường `resolvedFrom` ghi rõ số này ĐỌC TỪ ĐÂU, để người đọc sau biết mức tin cậy
của từng dòng thay vì phải đoán.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CORE_CMAKE = ROOT / "apps/core/CMakeLists.txt"
GO_DIR = ROOT / "apps/web-api"
WEB_UI_DIR = ROOT / "apps/web-ui"


def fetchcontent_pins() -> list[dict[str, str]]:
    """Nguồn kéo về lúc build — pin nằm ngay trong CMakeLists."""
    text = CORE_CMAKE.read_text(encoding="utf-8")
    found: list[dict[str, str]] = []
    for match in re.finditer(r"FetchContent_Declare\(\s*(\w+)(.*?)\)", text, re.S):
        name, body = match.group(1), match.group(2)
        url = re.search(r"URL\s+(\S+)", body)
        tag = re.search(r"GIT_TAG\s+(\S+)", body)
        version = ""
        if url:
            version_match = re.search(r"/(?:v|tags/v)?([0-9]+\.[0-9]+(?:\.[0-9]+)?)", url.group(1))
            version = version_match.group(1) if version_match else ""
        elif tag:
            version = tag.group(1)
        found.append({
            "name": name,
            "version": version,
            "ecosystem": "cmake-fetchcontent",
            "reference": url.group(1) if url else (tag.group(1) if tag else ""),
            "resolvedFrom": "apps/core/CMakeLists.txt",
        })
    return found


def go_modules() -> list[dict[str, str]]:
    result = subprocess.run(["go", "list", "-m", "all"], cwd=GO_DIR,
                            capture_output=True, text=True, check=True)
    modules: list[dict[str, str]] = []
    for line in result.stdout.splitlines():
        parts = line.split()
        if len(parts) < 2:
            continue  # module chính, không có version
        modules.append({
            "name": parts[0],
            "version": parts[1],
            "ecosystem": "go",
            "reference": f"https://pkg.go.dev/{parts[0]}@{parts[1]}",
            "resolvedFrom": "go list -m all",
        })
    return modules


def npm_packages() -> list[dict[str, str]]:
    result = subprocess.run(
        ["npm", "ls", "--all", "--omit=dev", "--json"],
        cwd=WEB_UI_DIR, capture_output=True, text=True)
    # `npm ls` trả exit code khác 0 khi có peer warning; JSON vẫn dùng được.
    try:
        tree = json.loads(result.stdout or "{}")
    except json.JSONDecodeError:
        return []
    packages: dict[str, str] = {}

    def walk(node: dict) -> None:
        for name, meta in (node.get("dependencies") or {}).items():
            version = meta.get("version", "")
            if version:
                packages[name] = version
            walk(meta)

    walk(tree)
    return [{
        "name": name,
        "version": version,
        "ecosystem": "npm",
        "reference": f"https://www.npmjs.com/package/{name}/v/{version}",
        "resolvedFrom": "npm ls --omit=dev",
    } for name, version in sorted(packages.items())]


def system_libraries() -> list[dict[str, str]]:
    """Thư viện hệ thống link ĐỘNG — phiên bản là của máy build, không của repo.

    Ghi rõ điều đó ở `resolvedFrom`: trên board Buildroot, số này sẽ khác, và một
    SBOM nói dối về điều đó còn tệ hơn không có SBOM.
    """
    entries = []
    for name, pkg in (("libsodium", "libsodium"), ("libmodbus", "libmodbus")):
        version = ""
        try:
            result = subprocess.run(["pkg-config", "--modversion", pkg],
                                    capture_output=True, text=True, check=True)
            version = result.stdout.strip()
        except (subprocess.CalledProcessError, FileNotFoundError):
            version = "unknown"
        entries.append({
            "name": name,
            "version": version,
            "ecosystem": "system",
            "reference": pkg,
            "resolvedFrom": "pkg-config trên MÁY BUILD (không phải trên target)",
        })
    return entries


def build(version: str, commit: str) -> dict:
    components = (fetchcontent_pins() + system_libraries() + go_modules() + npm_packages())
    return {
        "sbomVersion": 1,
        "product": "MK-DDC-24",
        "release": {"version": version, "gitCommit": commit},
        "componentCount": len(components),
        "components": components,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", default="0.0.0")
    parser.add_argument("--commit", default="unknown")
    parser.add_argument("--output", default=str(ROOT / "build/release/sbom.json"))
    args = parser.parse_args()

    document = build(args.version, args.commit)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"SBOM: {document['componentCount']} component -> {output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
