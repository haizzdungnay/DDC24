#!/usr/bin/env python3
"""Kiểm truy vết hai chiều cho bộ hồ sơ Programming Rev A.

Vì sao cần file này: `scripts/docs_iso_harness.py` chỉ đếm ID và kiểm bất biến
`P=Y khi T=N` / `R=Y khi P=N`. Nó **không** phát hiện được trường hợp một kịch
bản `VS-PROG-*` tồn tại trong `VVP-PROG-001` nhưng không dòng requirement nào ở
`TRACE-PROG-001` §6 dẫn tới nó — đúng lỗi mà consumer review 2026-08-10 tìm ra
với `VS-PROG-008` và `VS-PROG-032` (finding `F-CR-03`).

Ba phép kiểm:

1. mọi alias trong cột Requirement của §6 giải được về ID canonical trong SRS;
2. mọi requirement trong SRS có đúng một dòng ở §6 (chiều xuôi);
3. mọi kịch bản trong VVP được ít nhất một dòng §6 dẫn tới, và mọi kịch bản §6
   dẫn tới đều tồn tại trong VVP (chiều ngược).

Exit code `0` khi cả ba đạt, `1` khi có vi phạm.
"""

from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

SRS = ROOT / "docs/02_requirements/PROGRAMMING_REQUIREMENTS_SPEC.md"
VVP = ROOT / "docs/05_verification/PROGRAMMING_VERIFICATION_PLAN.md"
TRACE = ROOT / "docs/07_records/PROGRAMMING_TRACEABILITY_MATRIX.md"

# Alias dùng trong TRACE §6, khai báo ngay trong chính hồ sơ đó.
ALIAS = {
    "SYS": "SYS-REQ-PROG-",
    "FE": "SWR-REQ-PROG-FE-",
    "BE": "SWR-REQ-PROG-BE-",
    "CORE": "SWR-REQ-PROG-CORE-",
    "MCU": "FW-REQ-PROG-MCU-",
    "HW": "HW-REQ-PROG-",
    "NFR": "NFR-REQ-PROG-",
}

RE_REQ = r"\b((?:SYS|SWR|FW|NFR|HW)-REQ-PROG-[A-Z]*-?\d+)\b"
RE_VS = r"\b(VS-PROG-(?:\d{3}|U\d{2}))\b"


def section(text: str, start: str, end: str) -> str:
    """Cắt phần văn bản giữa hai heading; thiếu heading là lỗi cấu trúc."""
    if start not in text:
        raise SystemExit(f"KHÔNG TÌM THẤY heading: {start!r}")
    body = text.split(start, 1)[1]
    return body.split(end, 1)[0] if end in body else body


def main() -> int:
    srs_text = SRS.read_text(encoding="utf-8")
    vvp_text = VVP.read_text(encoding="utf-8")
    trace_text = TRACE.read_text(encoding="utf-8")

    srs_req = set(re.findall(RE_REQ, srs_text))
    vvp_vs = set(re.findall(RE_VS, vvp_text))

    sec6 = section(
        trace_text,
        "## 6. Trace chi tiết từng requirement",
        "## 7.",
    )
    rows = re.findall(
        r"^\|\s*`([^`]+)`\s*\|[^|]*\|[^|]*\|\s*([0-9U/\.\s]+?)\s*\|\s*"
        r"([YN](?:/[YN]){4})\s*\|",
        sec6,
        re.M,
    )

    failures: list[str] = []

    resolved: set[str] = set()
    row_scenarios: set[str] = set()
    for alias, scenarios, _status in rows:
        m = re.fullmatch(r"([A-Z]+)-(\d+)", alias)
        if not m or m.group(1) not in ALIAS:
            failures.append(f"alias không giải được ở §6: {alias!r}")
            continue
        resolved.add(ALIAS[m.group(1)] + m.group(2))
        for token in re.findall(r"\d{3}|U\d{2}", scenarios):
            row_scenarios.add("VS-PROG-" + token)

    missing_rows = sorted(srs_req - resolved)
    extra_rows = sorted(resolved - srs_req)
    orphan_vs = sorted(vvp_vs - row_scenarios)
    ghost_vs = sorted(row_scenarios - vvp_vs)

    if missing_rows:
        failures.append(f"requirement trong SRS thiếu dòng §6: {missing_rows}")
    if extra_rows:
        failures.append(f"dòng §6 không có requirement tương ứng: {extra_rows}")
    if orphan_vs:
        failures.append(f"kịch bản VVP không dòng §6 nào dẫn tới: {orphan_vs}")
    if ghost_vs:
        failures.append(f"kịch bản §6 dẫn tới nhưng VVP không có: {ghost_vs}")

    print(f"dòng §6                 : {len(rows)}")
    print(f"requirement SRS         : {len(srs_req)}")
    print(f"alias giải được         : {len(resolved)}")
    print(f"kịch bản VVP            : {len(vvp_vs)}")
    print(f"kịch bản được §6 phủ    : {len(row_scenarios & vvp_vs)}")

    if failures:
        print("\n=== KẾT LUẬN: FAIL ===")
        for line in failures:
            print(" -", line)
        return 1

    print("\n=== KẾT LUẬN: PASS — truy vết hai chiều đầy đủ ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
