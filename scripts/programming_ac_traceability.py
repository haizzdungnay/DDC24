#!/usr/bin/env python3
"""Bảng truy nguyên `AC → task → file test` cho handoff PGM-02 v2.2 (`T59-822`).

Bảng này SINH TỪ CÂY LÀM VIỆC, không chép tay. Một bảng chép tay chỉ chứng minh
người viết đã tin điều gì tại thời điểm viết; bảng sinh ra chứng minh cây làm
việc HIỆN TẠI thật sự có tham chiếu đó.

Chạy không tham số để in bảng; `--check` để dùng làm cổng (thoát != 0 khi có AC
không còn file test nào trỏ tới).
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HANDOFF = ROOT / "docs/04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1"
HANDOFF_FILES = [
    HANDOFF / "PGM-02_PROGRAMS_FE_HANDOFF_v2_2.md",
    HANDOFF / "PGM-02A_ST_EDITOR_FE_HANDOFF_v2_2.md",
    HANDOFF / "PGM-02B_FBD_EDITOR_FE_HANDOFF_v2_2.md",
]
SEARCH_ROOTS = ["apps/web-ui/src", "apps/web-ui/e2e", "apps/web-api"]
AC_PATTERN = re.compile(r"AC-(?:PGM02|ST|FBD)-\d{3}")


def acs_with_text():
    """Đọc định danh AC và câu mô tả của nó THẲNG từ handoff."""
    found = {}
    for path in HANDOFF_FILES:
        for line in path.read_text(encoding="utf-8").splitlines():
            match = re.match(r"^- `(AC-(?:PGM02|ST|FBD)-\d{3})`\s+(.*)$", line.strip())
            if match:
                found.setdefault(match.group(1), match.group(2).rstrip("."))
    return dict(sorted(found.items()))


def references(ac):
    """File có tham chiếu tới `ac`, chỉ tính file test/spec."""
    try:
        out = subprocess.run(
            ["grep", "-rl", "--", ac, *SEARCH_ROOTS],
            cwd=ROOT, capture_output=True, text=True, check=False,
        ).stdout
    except OSError:
        return []
    files = [line for line in out.splitlines() if line]
    return sorted(f for f in files if ".test." in f or ".spec." in f)


def main():
    check = "--check" in sys.argv
    table = acs_with_text()
    missing = []
    print(f"| AC | Yêu cầu | File test |")
    print(f"|---|---|---|")
    for ac, text in table.items():
        files = references(ac)
        if not files:
            missing.append(ac)
            cell = "**KHÔNG CÓ FILE TEST NÀO**"
        else:
            cell = "<br>".join(f"`{f}`" for f in files)
        print(f"| `{ac}` | {text} | {cell} |")

    print()
    print(f"AC trong handoff v2.2 : {len(table)}")
    print(f"có file test          : {len(table) - len(missing)}")
    if missing:
        # Không tra được KHÁC HẲN tra được và thấy rỗng. Nói ra danh sách thật.
        print(f"THIẾU                 : {', '.join(missing)}")
        print("FAIL — có AC không còn file test nào trỏ tới")
        return 1 if check else 0
    print("PASS — mọi AC đều truy nguyên được tới ít nhất một file test")
    return 0


if __name__ == "__main__":
    sys.exit(main())
