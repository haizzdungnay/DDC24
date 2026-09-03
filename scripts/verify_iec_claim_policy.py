#!/usr/bin/env python3
"""Cổng thi hành chính sách tuyên bố IEC 61131-3 (`ISS-STED-09` / `F-STED-015`).

VÌ SAO CẦN
----------
`ADR-020` mục 6 cấm gọi sản phẩm là `compliant`/`conformant`/`certified` với IEC
61131-3, và `ST_SUBSET_SPEC` §0 nhắc lại nguyên tắc đó. Nhưng cả hai chỉ là câu
chữ trong tài liệu KỸ THUẬT. Hồ sơ bán hàng, datasheet và hồ sơ chứng nhận do
người khác viết — người không đọc §0 — và không có gì ngăn một câu ngược lại
xuất hiện ở tài liệu khác. Đó chính là `F-STED-015`: nguyên tắc đúng mà không có
cơ chế giữ.

CÁCH LÀM
--------
Quét mọi tệp Markdown trong `docs/` tìm câu ĐẶT CẠNH NHAU "IEC 61131" và một từ
cấm. Một dòng như vậy chỉ hợp lệ khi nó nằm trong **ngữ cảnh cấm đoán** — tức
chính nó đang nói "không được claim". Ngữ cảnh cấm đoán được nhận bằng một dấu
phủ định trên cùng dòng (`không`, `cấm`, `not`, `no `, `prohibited`, `never`,
`chưa`, `bỏ claim`, `tránh`…).

Đây là heuristic, và nó cố ý nghiêng về phía BÁO ĐỘNG THỪA: một câu cấm viết
thiếu dấu phủ định trên cùng dòng sẽ bị bắt và phải viết lại cho rõ. Chiều sai
còn lại — bỏ lọt một câu khẳng định — mới là chiều gây hại thật, nên cổng không
được nới theo hướng đó.

Cổng thứ hai: bảng §14.4 của RTM. Mọi dòng gắn nhãn IEC phải dẫn được điều
khoản; một ô "Điều khoản dẫn được" trống hoặc `—` trên dòng nhãn IEC là đúng
thứ luật §14.2 cấm.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
RTM = DOCS / "07_records/PROGRAMMING_TRACEABILITY_MATRIX.md"

# "IEC 61131" và từ cấm cách nhau tối đa ~60 ký tự, theo cả hai thứ tự.
FORBIDDEN = r"(?:compliant|conformant|certified|compliance|conformance|tuân\s+thủ|đạt\s+chuẩn|được\s+chứng\s+nhận)"
IEC = r"IEC\s*61131"
NEAR = re.compile(
    rf"(?:{IEC}.{{0,60}}?{FORBIDDEN})|(?:{FORBIDDEN}.{{0,60}}?{IEC})",
    re.IGNORECASE,
)

# Dấu hiệu dòng đang CẤM chứ đang KHẲNG ĐỊNH.
NEGATION = re.compile(
    r"không|cấm|chưa|tránh|bỏ\s+claim|thiếu|\bnot\b|\bno\b|\bnever\b|prohibit|forbid|"
    r"must\s+not|cannot|can't|won't|ngăn|vi\s*phạm|-aligned|aligned\s+subset",
    re.IGNORECASE,
)


def scan_claims(docs_root: Path) -> list[str]:
    problems: list[str] = []
    for path in sorted(docs_root.rglob("*.md")):
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except UnicodeDecodeError:
            continue
        for number, line in enumerate(lines, start=1):
            if not NEAR.search(line):
                continue
            # Cửa sổ ngữ cảnh, không phải một dòng. Markdown ngắt dòng giữa câu,
            # nên một câu cấm hoàn toàn có thể để dấu phủ định ở dòng trước —
            # đúng bốn ca có thật trong repo, ví dụ "không được gọi 'Compliant'
            # hay / 'Certified'". Đọc một dòng sẽ báo động thừa cho cả bốn, và
            # một cổng kêu oan bốn lần là một cổng sắp bị tắt.
            window = "\n".join(lines[max(0, number - 3):number + 1])
            if NEGATION.search(window):
                continue
            problems.append(
                f"{path.relative_to(ROOT)}:{number} đặt 'IEC 61131' cạnh một từ cấm "
                f"mà không có ngữ cảnh cấm đoán trên cùng dòng:\n      {line.strip()[:200]}"
            )
    return problems


def scan_rtm_classification(rtm: Path) -> list[str]:
    problems: list[str] = []
    text = rtm.read_text(encoding="utf-8")

    if "IEC 61131-3-aligned" not in text:
        problems.append(
            f"{rtm.name} thiếu câu chốt về cụm được phép dùng ('IEC 61131-3-aligned'). "
            "Không có câu chốt thì trục phân loại §14 không nói được sản phẩm được gọi "
            "tên thế nào."
        )

    if "### 14.4" not in text:
        problems.append(f"{rtm.name} không có §14.4 — bảng phân loại đã biến mất.")
        return problems

    section = text.split("### 14.4", 1)[1].split("### 14.5", 1)[0]
    data_rows = [
        row for row in section.splitlines()
        if row.startswith("|") and not re.match(r"^\|\s*-+", row) and "Phân loại" not in row
    ]
    if len(data_rows) < 10:
        problems.append(
            f"§14.4 chỉ còn {len(data_rows)} dòng dữ liệu — bảng phân loại đã bị rút gọn "
            "tới mức không còn phủ được ST Editor."
        )
    for row in data_rows:
        cells = [cell.strip() for cell in row.strip().strip("|").split("|")]
        if len(cells) < 4 or not cells[2]:
            problems.append(f"§14.4 có dòng thiếu ô phân loại: {row.strip()[:120]}")

    # Luật §14.2 mục 1 áp cho MỌI dòng gắn nhãn IEC trong ma trận, không riêng
    # §14.4: một nhãn không dẫn được điều khoản thì sai ở bất kỳ chỗ nào nó
    # xuất hiện. Chỉ soi đúng một mục cũng là cách một cổng ngừng kiểm trong
    # im lặng — thêm một bảng thứ hai là đủ để đi vòng qua nó.
    for number, row in enumerate(text.splitlines(), start=1):
        if not row.startswith("|") or re.match(r"^\|\s*-+", row):
            continue
        cells = [cell.strip() for cell in row.strip().strip("|").split("|")]
        if len(cells) < 4 or "Phân loại" in row:
            continue
        classification, clause = cells[2], cells[3]
        if re.search(r"IEC\s*61131-3", classification) and (
            clause in ("", "—", "-") or not re.search(r"\d", clause)
        ):
            problems.append(
                f"{rtm.name}:{number} dòng {cells[0]} gắn nhãn IEC nhưng ô điều khoản là "
                f"{clause!r}. Luật §14.2 mục 1: không dẫn được điều khoản thì "
                "không được gắn nhãn."
            )
    return problems


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--docs-root", default=str(DOCS),
        help="thư mục docs cần quét (chỉ dùng để tự kiểm cổng)",
    )
    parser.add_argument(
        "--rtm", default=str(RTM),
        help="ma trận truy vết cần kiểm §14.4 (chỉ dùng để tự kiểm cổng)",
    )
    args = parser.parse_args()

    docs_root = Path(args.docs_root)
    problems = scan_claims(docs_root)
    problems += scan_rtm_classification(Path(args.rtm))

    if problems:
        print(
            "CHÍNH SÁCH TUYÊN BỐ IEC BỊ VI PHẠM:\n  - " + "\n  - ".join(problems),
            file=sys.stderr,
        )
        return 1
    print("OK: không có tuyên bố compliant/conformant/certified ngoài ngữ cảnh cấm đoán; "
          "§14.4 đủ ô phân loại và mọi nhãn IEC đều dẫn được điều khoản.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
