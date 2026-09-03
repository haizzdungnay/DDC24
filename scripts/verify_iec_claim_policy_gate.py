#!/usr/bin/env python3
"""Kiểm CHÍNH CỔNG chính sách tuyên bố IEC (`ISS-STED-09`).

`iec_claim_policy` luôn xanh trên cây sạch, và "luôn xanh" có hai cách giải
thích: nó đang kiểm và mọi thứ đều đúng, hoặc nó đã ngừng kiểm. Cổng nào cũng
cần một cổng chứng minh nó còn nổ được — nhất là cổng này, vì thứ nó bảo vệ là
một tuyên bố PHÁP LÝ/THƯƠNG MẠI, và sai sót ở đó không lộ ra trong test kỹ
thuật nào cả.

Bốn ca tiêm, mỗi ca một cách nguyên tắc `ADR-020` mục 6 có thể bị phá:
  1. một câu khẳng định "IEC 61131-3 compliant" ở tài liệu bất kỳ;
  2. biến thể tiếng Việt "tuân thủ IEC 61131-3";
  3. một dòng §14.4 gắn nhãn IEC mà ô điều khoản để trống;
  4. mất hẳn câu chốt "IEC 61131-3-aligned" khỏi ma trận.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
GATE = ROOT / "scripts/verify_iec_claim_policy.py"
RTM = ROOT / "docs/07_records/PROGRAMMING_TRACEABILITY_MATRIX.md"


def run(docs_root: Path, rtm: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(GATE), "--docs-root", str(docs_root), "--rtm", str(rtm)],
        capture_output=True, text=True, check=False,
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.parse_args()

    rtm_text = RTM.read_text(encoding="utf-8")
    failures: list[str] = []

    with tempfile.TemporaryDirectory() as work:
        root = Path(work)

        clean_docs = root / "clean"
        clean_docs.mkdir()
        (clean_docs / "ok.md").write_text(
            "Sản phẩm là IEC 61131-3-aligned subset; không claim compliant.\n",
            encoding="utf-8",
        )

        # Tiền đề: cây sạch phải XANH. Nếu bước này đỏ thì mọi ca tiêm phía dưới
        # "đỏ đúng" vì lý do khác hẳn lý do đang kiểm.
        baseline = run(clean_docs, RTM)
        if baseline.returncode != 0:
            print("tiền đề hỏng — cây sạch đã đỏ:\n" + baseline.stderr, file=sys.stderr)
            return 1

        cases: list[tuple[str, Path, Path, str]] = []

        docs = root / "claim_en"
        docs.mkdir()
        (docs / "sales.md").write_text(
            "MK-DDC-24 is IEC 61131-3 compliant and ready to ship.\n", encoding="utf-8"
        )
        cases.append(("câu khẳng định tiếng Anh", docs, RTM, "IEC 61131"))

        docs = root / "claim_vi"
        docs.mkdir()
        (docs / "brochure.md").write_text(
            "Bộ điều khiển tuân thủ IEC 61131-3 và đã sẵn sàng bàn giao.\n", encoding="utf-8"
        )
        cases.append(("biến thể tiếng Việt", docs, RTM, "IEC 61131"))

        broken = root / "rtm_no_clause.md"
        broken.write_text(
            rtm_text + "\n### 14.4 tiêm\n\n| Requirement | Hạng mục | Phân loại | Điều khoản dẫn được |\n"
            "|---|---|---|---|\n| `X-999` | tiêm thử | **IEC 61131-3** | — |\n\n### 14.5 tiêm\n",
            encoding="utf-8",
        )
        cases.append(("nhãn IEC không dẫn được điều khoản", clean_docs, broken, "không được gắn nhãn"))

        stripped = root / "rtm_no_sentence.md"
        stripped.write_text(rtm_text.replace("IEC 61131-3-aligned", "IEC 61131-3"), encoding="utf-8")
        cases.append(("mất câu chốt về cụm được phép dùng", clean_docs, stripped, "câu chốt"))

        for name, docs_root, rtm, needle in cases:
            result = run(docs_root, rtm)
            if result.returncode == 0:
                failures.append(f"{name}: cổng KHÔNG nổ (thoát 0). Cổng đã ngừng kiểm chiều này.")
            elif needle not in result.stderr:
                failures.append(
                    f"{name}: cổng nổ nhưng thông điệp không nói vì sao (thiếu {needle!r}):\n"
                    f"{result.stderr.strip()}"
                )

    if failures:
        print("CỔNG HỎNG:\n  - " + "\n  - ".join(failures), file=sys.stderr)
        return 1
    print("OK: cổng chính sách tuyên bố IEC nổ đúng 4/4 ca tiêm.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
