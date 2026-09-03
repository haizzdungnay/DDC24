#!/usr/bin/env python3
"""Kiểm CHÍNH CỔNG `diagnostic_code_refs` (`ISS-STED-10`).

Cổng kia luôn xanh trên cây sạch, và "luôn xanh" có hai cách giải thích: nó
đang kiểm và mọi thứ đều đúng, hoặc nó đã ngừng kiểm. Ở đây khả năng thứ hai
không hề xa vời — cổng phải rút danh sách mã từ HAI nguồn có hình dạng khác
nhau, và một biểu thức chính quy hụt một dấu gạch nối là đủ để nó im lặng chấp
nhận mọi thứ (chính lỗi đó đã xảy ra khi viết cổng: regex `[A-Z0-9_]+` không
khớp `FBD-SEM-TYPE-REF-001`, làm cổng báo động thừa cho mã CÓ THẬT).

Bốn ca tiêm, mỗi ca một cách tài liệu có thể dẫn sai:
  1. mã bịa hoàn toàn;
  2. họ mã bịa (`ST-LIMIT-*`) — dạng đã sống trong DDD §7 nhiều revision;
  3. mã gần đúng nhưng sai hậu tố (`ST-SEM-999`);
  4. mã `FBD-*` CÓ THẬT phải được chấp nhận — chiều ngược lại, chống việc cổng
     báo động thừa rồi bị tắt.
"""

from __future__ import annotations

from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
GATE = ROOT / "scripts/verify_diagnostic_code_refs.py"


def run(doc: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(GATE), "--doc", str(doc)],
        capture_output=True, text=True, check=False,
    )


def main() -> int:
    failures: list[str] = []
    with tempfile.TemporaryDirectory() as work:
        root = Path(work)

        clean = root / "clean.md"
        clean.write_text(
            "Mã kiểu là `ST-SEM-002`; trần diagnostic gắn `ST-LIM-006`; "
            "họ `ST-WARN-*` không chặn.\n",
            encoding="utf-8",
        )
        baseline = run(clean)
        if baseline.returncode != 0:
            print("tiền đề hỏng — tài liệu sạch đã đỏ:\n" + baseline.stderr, file=sys.stderr)
            return 1

        cases: list[tuple[str, str, str]] = [
            ("mã bịa hoàn toàn", "Lỗi này trả `COMP-INTERNAL-001`.\n", "COMP-INTERNAL-001"),
            ("họ mã bịa", "Namespace ổn định gồm `ST-LIMIT-*`.\n", "ST-LIMIT"),
            ("mã sai hậu tố", "Kiểu không khớp trả `ST-SEM-999`.\n", "ST-SEM-999"),
        ]
        for name, body, needle in cases:
            doc = root / f"{name.replace(' ', '_')}.md"
            doc.write_text(body, encoding="utf-8")
            result = run(doc)
            if result.returncode == 0:
                failures.append(f"{name}: cổng KHÔNG nổ (thoát 0). Cổng đã ngừng kiểm chiều này.")
            elif needle not in result.stderr:
                failures.append(
                    f"{name}: cổng nổ nhưng thông điệp không nêu mã sai (thiếu {needle!r}):\n"
                    f"{result.stderr.strip()}"
                )

        # Chiều ngược lại: mã CÓ THẬT của validator FBD phải đi qua. Một cổng
        # kêu oan cho mã thật sẽ bị tắt, và lúc đó nó không bảo vệ gì nữa.
        real_fbd = root / "fbd_that.md"
        real_fbd.write_text(
            "Cycle tổ hợp bị `FBD-SEM-ORDER-001`; sai typeRef bị `FBD-SEM-TYPE-REF-001`; "
            "quá trần khối bị `FBD-LIMIT-BLOCK-001`.\n",
            encoding="utf-8",
        )
        result = run(real_fbd)
        if result.returncode != 0:
            failures.append(
                "mã FBD có thật bị báo nhầm là không tồn tại — cổng đang kêu oan:\n"
                + result.stderr.strip()
            )

    if failures:
        print("CỔNG HỎNG:\n  - " + "\n  - ".join(failures), file=sys.stderr)
        return 1
    print("OK: cổng dẫn mã diagnostic nổ đúng 3/3 ca tiêm và không kêu oan cho mã thật.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
