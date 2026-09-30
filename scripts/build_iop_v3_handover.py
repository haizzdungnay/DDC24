#!/usr/bin/env python3
"""Dựng bản sao bàn giao IOP V3.0 từ tài liệu nguồn đã commit."""

from __future__ import annotations

import argparse
import hashlib
import re
import subprocess
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs/01_specs"
PACKAGE = ROOT / "fw-mcu-handover-2026-09-30"
ZIP_PATH = ROOT / "fw-mcu-handover-2026-09-30.zip"
TEMPLATE = ROOT / "scripts/templates/iop_v3_handover_README.md"
DOCS = (
    "SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md",
    "FW_REQUIREMENTS_MK-DDC-24_VI.md",
    "iop_protocol_v3_DRAFT.h",
    "IOP_V3_INTEGRATION_EXAMPLES_MK-DDC-24_VI.md",
    "IOP_V3_VERIFICATION_PLAN_MK-DDC-24_VI.md",
    "IOP_V3_HW_INPUT_FORM_MK-DDC-24_VI.md",
)
ASSETS = tuple(sorted((SOURCE / "assets/iop-v3").glob("*.dot"))) + tuple(
    sorted((SOURCE / "assets/iop-v3").glob("*.svg"))
)
LINK = re.compile(r"(!?)\[([^\]]+)\]\(([^)]+)\)")


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def git_bytes(commit: str, path: Path) -> bytes:
    rel = path.relative_to(ROOT)
    return subprocess.check_output(["git", "show", f"{commit}:{rel}"], cwd=ROOT)


def rewrite_links(content: str, allowed: set[str]) -> tuple[str, int, int]:
    internal = external = 0

    def change(match: re.Match[str]) -> str:
        nonlocal internal, external
        marker, label, target = match.groups()
        path = target.split("#", 1)[0]
        if not path or target.startswith(("https://", "http://", "mailto:")):
            return match.group(0)
        if path in allowed:
            internal += 1
            return match.group(0)
        if marker:
            raise ValueError(f"Ảnh ngoài gói: {target}")
        external += 1
        return f"{label} (ngoài gói: {target})"

    return LINK.sub(change, content), internal, external


def validate_package(manifest_names: list[str]) -> int:
    for path in PACKAGE.rglob("*.svg"):
        ET.parse(path)
    local_links = 0
    for path in PACKAGE.glob("*.md"):
        for marker, _label, target in LINK.findall(path.read_text(encoding="utf-8")):
            del marker
            name = target.split("#", 1)[0]
            if not name or target.startswith(("https://", "http://", "mailto:")):
                continue
            if not (path.parent / name).is_file():
                raise ValueError(f"Link hỏng: {path.name} -> {target}")
            local_links += 1
    manifest = (PACKAGE / "MANIFEST.sha256").read_text(encoding="utf-8").splitlines()
    if len(manifest) != len(manifest_names):
        raise ValueError("Manifest thiếu file")
    for line in manifest:
        expected, filename = line.split("  ", 1)
        if sha((PACKAGE / filename).read_bytes()) != expected:
            raise ValueError(f"Mã băm sai: {filename}")
    vvp = (PACKAGE / "IOP_V3_VERIFICATION_PLAN_MK-DDC-24_VI.md").read_text(
        encoding="utf-8"
    )
    matrix = re.findall(r"^\| `(FW-[A-Z]+-\d{3})` \|", vvp, re.M)
    if len(matrix) != 74 or len(set(matrix)) != 74:
        raise ValueError(f"Ma trận phải có 74 ID khác nhau, hiện có {len(matrix)}")
    for i in range(1, 17):
        if f"### ICD-T-{i:02d} —" not in vvp:
            raise ValueError(f"Thiếu quy trình ICD-T-{i:02d}")
    for i in range(1, 6):
        if f"`RSK-IOP-{i:03d}`" not in vvp:
            raise ValueError(f"Thiếu rủi ro RSK-IOP-{i:03d}")
    return local_links


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source-commit", help="Commit chứa đúng toàn bộ file nguồn; mặc định HEAD"
    )
    args = parser.parse_args()
    commit = args.source_commit or subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
    ).strip()
    inputs = [SOURCE / name for name in DOCS] + list(ASSETS) + [TEMPLATE]
    for path in inputs:
        if path.read_bytes() != git_bytes(commit, path):
            raise ValueError(f"Nguồn khác commit {commit[:12]}: {path.relative_to(ROOT)}")
    allowed = set(DOCS) | {str(path.relative_to(SOURCE)) for path in ASSETS}
    expected = allowed | {"README.md", "NGUON_GOC.md", "MANIFEST.sha256"}
    existing = {
        str(path.relative_to(PACKAGE)) for path in PACKAGE.rglob("*") if path.is_file()
    } if PACKAGE.exists() else set()
    if extra := existing - expected:
        raise ValueError(f"Gói có file ngoài manifest dự kiến: {sorted(extra)}")
    PACKAGE.mkdir(exist_ok=True)
    provenance = []
    for name in DOCS:
        source = SOURCE / name
        raw = source.read_bytes()
        if source.suffix == ".md":
            content, internal, external = rewrite_links(raw.decode("utf-8"), allowed)
            packed = content.encode("utf-8")
        else:
            packed, internal, external = raw, 0, 0
        (PACKAGE / name).write_bytes(packed)
        provenance.append((name, str(source.relative_to(ROOT)), sha(raw), sha(packed), internal, external))
    for source in ASSETS:
        name = source.relative_to(SOURCE)
        target = PACKAGE / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(source.read_bytes())
    readme = TEMPLATE.read_text(encoding="utf-8").replace("@SOURCE_COMMIT@", commit)
    (PACKAGE / "README.md").write_text(readme, encoding="utf-8")
    lines = [
        "# Nguồn gốc và mã băm gói tích hợp IOP V3.0",
        "",
        "**Bản gói:** R2 · **Ngày:** 2026-09-30",
        "",
        f"**Commit nguồn tài liệu:** `{commit}`",
        "",
        "**Trạng thái:** Draft để HW/FW MCU/SOM review, chưa ký và chưa gửi; P1/P2/P3 `NOT RUN`.",
        "",
        "| File gói | File nguồn | SHA-256 nguồn | SHA-256 gói | Link giữ | Link ngoài chuyển chữ |",
        "|---|---|---|---|---:|---:|",
    ]
    for name, src, src_hash, pkg_hash, keep, drop in provenance:
        lines.append(f"| `{name}` | `{src}` | `{src_hash}` | `{pkg_hash}` | {keep} | {drop} |")
    lines.extend([
        "",
        "Các file `assets/iop-v3/*.dot` và `*.svg` được sao nguyên byte từ commit nguồn. "
        "Mã băm của từng asset, `README.md` và file này ở `MANIFEST.sha256`; manifest không tự băm chính nó.",
        "",
        "Khác biệt SHA giữa Markdown nguồn và bản gói chỉ do thay link trỏ ra ngoài gói thành chú thích văn bản; "
        "byte giao thức, vector và tiêu chí không đổi. ZIP có timestamp cố định để dựng lại được từ commit nguồn.",
        "",
    ])
    (PACKAGE / "NGUON_GOC.md").write_text("\n".join(lines), encoding="utf-8")
    names = sorted(str(path.relative_to(PACKAGE)) for path in PACKAGE.rglob("*") if path.is_file() and path.name != "MANIFEST.sha256")
    manifest = "".join(f"{sha((PACKAGE / name).read_bytes())}  {name}\n" for name in names)
    (PACKAGE / "MANIFEST.sha256").write_text(manifest, encoding="utf-8")
    local_links = validate_package(names)
    with zipfile.ZipFile(ZIP_PATH, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in sorted(names + ["MANIFEST.sha256"]):
            info = zipfile.ZipInfo(f"{PACKAGE.name}/{name}", date_time=(2026, 9, 30, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, (PACKAGE / name).read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    print(
        f"Nguồn {commit[:12]}; gói {len(names)+1} file; {local_links} link nội bộ; "
        f"ma trận 74/74, quy trình 16/16; ZIP {ZIP_PATH.stat().st_size} byte, SHA-256 {sha(ZIP_PATH.read_bytes())}"
    )


if __name__ == "__main__":
    main()
