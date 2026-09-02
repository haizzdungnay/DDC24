#!/usr/bin/env python3
"""Mọi mã diagnostic được dẫn trong tài liệu thiết kế phải CÓ THẬT (`ISS-STED-10`).

VÌ SAO CẦN
----------
`DDD-LANG-PROG-001` §7 công bố `ST-LIMIT-*`, `ST-LIMIT-DIAG-001`,
`COMP-INTERNAL-*` và ví dụ `ST-SEM-TYPE-001` suốt nhiều revision. Không mã nào
trong bốn thứ đó tồn tại ở bất kỳ đâu ngoài chính tài liệu ấy (`F-STED-012`).

Hỏng ở đây không dừng lại ở tài liệu. Người vận hành đọc runbook rồi `grep` log
tìm `ST-LIMIT-DIAG-001` sẽ KHÔNG RA GÌ, và kết luận sai rằng sự cố không xảy ra
— một mã lỗi không tồn tại tạo ra bằng chứng vắng mặt giả. Người viết client
đọc ví dụ rồi so `code` với `ST-SEM-*` sẽ không bao giờ khớp, vì `code` mang mã
công khai còn mã chi tiết nằm ở `detailCode`.

NGUỒN SỰ THẬT
-------------
Hai nguồn, vì mã đến từ hai nơi khác nhau:
  1. `contracts/programming/error_catalog_v1.json` — `publicErrors[].code` và
     `componentDetails[].detailCode`;
  2. validator FBD phía FE (`fbd/model.ts`) — họ `FBD-*` KHÔNG đi qua catalog.

Bỏ nguồn thứ hai sẽ làm cổng báo động thừa cho mọi mã `FBD-*` có thật, và một
cổng kêu oan là một cổng sắp bị tắt.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "contracts/programming/error_catalog_v1.json"
FBD_MODEL = ROOT / "apps/web-ui/src/features/programming/fbd/model.ts"

# Tài liệu thiết kế được soi. Chỉ soi nơi mã lỗi là HỢP ĐỒNG, không soi mọi
# ghi chép: một biên bản review trích lại mã sai để chỉ ra nó sai thì phải được
# phép giữ nguyên câu trích.
WATCHED = [
    "docs/02_design/software/PROGRAMMING_LANGUAGE_COMPILER_DESIGN.md",
    "docs/02_design/software/ST_SUBSET_SPEC_MK-DDC-24_VI.md",
]

# Chỉ những họ mã do hai nguồn trên định nghĩa. `PRG-ERR-*`, `IPC-*`, `IR-E-*`…
# cũng nằm trong catalog nên cùng được kiểm.
# Ký tự `*` PHẢI nằm trong lớp ký tự. Dạng họ mã `ST-LIMIT-*` chính là dạng đã
# sống trong DDD §7 suốt nhiều revision; một biểu thức không bắt được `*` sẽ bỏ
# lọt đúng cái nó sinh ra để bắt.
CODE = re.compile(r"`((?:ST|FBD|COMP)-[A-Z]+-[A-Z0-9*-]+)`")


def known_codes() -> set[str]:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    codes = {entry["code"] for entry in catalog["publicErrors"]}
    codes |= {entry["detailCode"] for entry in catalog["componentDetails"]}
    codes |= set(re.findall(r"'(FBD-[A-Z0-9-]+)'", FBD_MODEL.read_text(encoding="utf-8")))
    return codes


def known_prefixes(codes: set[str]) -> set[str]:
    """Tiền tố họ mã, để chấp nhận cách viết `ST-SEM-*` trong văn xuôi."""
    prefixes: set[str] = set()
    for code in codes:
        parts = code.split("-")
        if len(parts) >= 2:
            prefixes.add("-".join(parts[:2]))
    return prefixes


def scan(paths: list[Path], codes: set[str]) -> list[str]:
    prefixes = known_prefixes(codes)
    problems: list[str] = []
    for path in paths:
        if not path.exists():
            problems.append(f"{path} không tồn tại — danh sách tài liệu được soi đã lạc hậu.")
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            for token in CODE.findall(line):
                if token.endswith("-*"):
                    family = token[:-2]
                    if family not in prefixes:
                        problems.append(
                            f"{path.name}:{number} dẫn họ mã `{token}` nhưng không mã nào thuộc "
                            f"họ `{family}` tồn tại trong catalog hay validator FBD."
                        )
                    continue
                if token in codes:
                    continue
                # Cho phép hậu tố `*` kiểu `ST-LIM-00*`? Không — mơ hồ thì coi
                # như sai: một mã gần đúng vẫn dẫn người đọc `grep` trượt.
                problems.append(
                    f"{path.name}:{number} dẫn mã `{token}` KHÔNG tồn tại trong "
                    "`error_catalog_v1.json` lẫn validator FBD."
                )
    return problems


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--doc", action="append", default=None,
        help="tài liệu cần soi (chỉ dùng để tự kiểm cổng); mặc định là danh sách WATCHED",
    )
    args = parser.parse_args()

    paths = [Path(doc) for doc in args.doc] if args.doc else [ROOT / doc for doc in WATCHED]
    codes = known_codes()
    problems = scan(paths, codes)

    if problems:
        print(
            "TÀI LIỆU DẪN MÃ DIAGNOSTIC KHÔNG TỒN TẠI:\n  - " + "\n  - ".join(problems),
            file=sys.stderr,
        )
        return 1
    print(f"OK: mọi mã diagnostic được dẫn trong {len(paths)} tài liệu thiết kế đều có thật "
          f"({len(codes)} mã đã biết).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
