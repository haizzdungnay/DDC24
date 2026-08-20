#!/usr/bin/env python3
"""Kiểm authority baseline Programming có còn khớp manifest đã ghim hay không.

Vì sao cần file này: manifest ghim SHA-256 của authority set, nhưng không có
gì ngăn một commit sau đó sửa một hồ sơ mà quên phát hành manifest
mới. Khi đó reviewer đọc working tree lại tưởng mình đang đọc đúng candidate —
đúng loại lỗi mà `DOC-GOV-001` §7 quy tắc 6 muốn chặn.

Script đọc bảng §2 của manifest, tính lại SHA-256 của từng đường dẫn trong cây
làm việc hiện tại, và báo mọi khác biệt.

Exit code `0` khi toàn bộ dòng khớp, `1` khi có drift hoặc thiếu file.
"""

from __future__ import annotations

import hashlib
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "docs/07_records/reviews/PROGRAMMING_UNIFIED_BASELINE_MANIFEST_2026-08-20.md"

ROW = re.compile(
    r"^\|\s*(\d+)\s*\|\s*`([^`]+)`\s*\|\s*`([0-9a-f]{64})`\s*\|\s*`([0-9a-f]{40})`\s*\|",
    re.M,
)


def main() -> int:
    text = MANIFEST.read_text(encoding="utf-8")
    section = text.split("## 2. Manifest authority baseline", 1)
    if len(section) != 2:
        print("KHÔNG TÌM THẤY §2 trong manifest")
        return 1
    body = section[1].split("## 3.", 1)[0]

    rows = ROW.findall(body)
    if not rows:
        print("KHÔNG ĐỌC ĐƯỢC dòng nào ở §2")
        return 1

    drift: list[str] = []
    missing: list[str] = []

    for _idx, rel, sha_pinned, _blob in rows:
        path = ROOT / rel
        if not path.is_file():
            missing.append(rel)
            continue
        sha_now = hashlib.sha256(path.read_bytes()).hexdigest()
        if sha_now != sha_pinned:
            drift.append(f"{rel}\n      ghim : {sha_pinned}\n      hiện : {sha_now}")

    print(f"hồ sơ trong manifest §2 : {len(rows)}")
    print(f"khớp                    : {len(rows) - len(drift) - len(missing)}")

    if missing:
        print("\n=== THIẾU FILE ===")
        for m in missing:
            print(" -", m)
    if drift:
        print("\n=== DRIFT so với candidate đã ghim ===")
        for d in drift:
            print(" -", d)

    if drift or missing:
        print(
            "\n=== KẾT LUẬN: FAIL ===\n"
            "Authority baseline đã đổi sau khi ghim. Phải phát hành manifest\n"
            "mới rồi review lại phần chịu ảnh hưởng — không được để\n"
            "reviewer đọc nội dung khác với revision họ sẽ ký."
        )
        return 1

    print("\n=== KẾT LUẬN: PASS — cây làm việc khớp candidate đã ghim ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
