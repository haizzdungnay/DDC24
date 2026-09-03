#!/usr/bin/env python3
"""Kiểm CHÍNH CỔNG chống trôi hồ sơ ngôn ngữ ST (`ISS-STED-08`).

VÌ SAO CẦN
----------
`st_language_profile_contract` chạy `generate_st_language_profile.py --check`
mỗi lần `ctest`, và nó luôn xanh. Nhưng "luôn xanh" có hai cách giải thích:
cổng đang kiểm và mọi thứ đều đúng, hoặc cổng đã ngừng kiểm. Từ ngoài nhìn vào,
hai trường hợp ấy giống hệt nhau.

Đó không phải lo xa. `F-STED-005` — tài liệu nói một đằng, parser làm một nẻo —
sống sót qua nhiều revision đúng vì không ai kiểm phía kiểm. Và một cổng hỏng
im lặng còn tệ hơn không có cổng: nó phát ra tín hiệu "đã kiểm" cho một thứ
không còn được kiểm.

CÁCH LÀM
--------
Tiêm từng hồ sơ curated SAI MỘT CÁCH ĐÃ BIẾT rồi đòi generator phải thoát khác
0 kèm đúng thông điệp. Mỗi ca dưới đây là một chế độ hỏng có thật:

  1. khai loại trừ một CÂU LỆNH mà compiler vẫn nhận (đúng `F-STED-005` gốc);
  2. khai loại trừ một FUNCTION BLOCK mà thư viện đang có;
  3. khai loại trừ một KIỂU mà compiler nhận như kiểu cơ sở;
  4. bỏ trống lý do của một cấu trúc bị từ chối (loại trừ im lặng);
  5. dán nhãn "mở rộng nhà sản xuất" lên một cái tên không tồn tại;
  6. để một mục ở `plannedAdditions` mà compiler đã hiện thực hoá.

Ca 2, 3 và 6 là ba chiều `ISS-STED-08` bổ sung; ba ca còn lại giữ cho các chiều
cũ khỏi mục ruỗng.
"""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
GENERATOR = ROOT / "scripts/generate_st_language_profile.py"
CURATED = ROOT / "contracts/programming/st_language_profile_v1.curated.json"


def exclusion(construct: str, kind: str) -> dict[str, object]:
    return {
        "construct": construct,
        "kind": kind,
        "inIec": True,
        "reason": "tiêm thử để kiểm chính cổng đối chiếu; không phải hồ sơ thật.",
        "authority": "verify_st_profile_gate",
    }


def run(curated: dict[str, object], dump_binary: str) -> subprocess.CompletedProcess[str]:
    with tempfile.NamedTemporaryFile("w", suffix=".json", encoding="utf-8", delete=False) as handle:
        json.dump(curated, handle, ensure_ascii=False)
        path = handle.name
    try:
        return subprocess.run(
            [sys.executable, str(GENERATOR), "--cross-check-only",
             "--curated", path, "--dump-binary", dump_binary],
            capture_output=True, text=True, check=False,
        )
    finally:
        Path(path).unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dump-binary", default=str(ROOT / "build/fw/core/mkddc-st-profile-dump"))
    args = parser.parse_args()

    base = json.loads(CURATED.read_text(encoding="utf-8"))

    # Tiền đề: hồ sơ THẬT phải sạch. Nếu bước này đỏ thì mọi ca tiêm phía dưới
    # đều vô nghĩa — chúng sẽ "đỏ đúng" vì một lý do khác hẳn lý do đang kiểm.
    baseline = run(base, args.dump_binary)
    if baseline.returncode != 0:
        print("hồ sơ curated THẬT đã mâu thuẫn với compiler — sửa nó trước:\n"
              + baseline.stderr, file=sys.stderr)
        return 1

    cases: list[tuple[str, dict[str, object], str]] = []

    poisoned = copy.deepcopy(base)
    poisoned["deliberateExclusions"].append(exclusion("IF", "statement"))
    cases.append(("khai loại trừ câu lệnh compiler vẫn nhận", poisoned, "CHẤP NHẬN"))

    poisoned = copy.deepcopy(base)
    poisoned["deliberateExclusions"].append(exclusion("TON", "functionBlock"))
    cases.append(("khai loại trừ FB thư viện đang có", poisoned, "thư viện chuẩn"))

    poisoned = copy.deepcopy(base)
    poisoned["deliberateExclusions"].append(exclusion("REAL", "type"))
    cases.append(("khai loại trừ kiểu compiler đang nhận", poisoned, "kiểu cơ sở"))

    poisoned = copy.deepcopy(base)
    poisoned["deliberateExclusions"] = [
        item for item in poisoned["deliberateExclusions"] if item["construct"] != "FOR"
    ]
    cases.append(("bỏ lý do của một cấu trúc bị từ chối", poisoned, "không ghi lý do"))

    poisoned = copy.deepcopy(base)
    poisoned["vendorExtensions"].append({
        "name": "KHONG_TON_TAI", "kind": "function",
        "reason": "tiêm thử: nhãn trỏ vào khoảng không.",
        "authority": "verify_st_profile_gate",
    })
    cases.append(("nhãn mở rộng trỏ vào cái tên không có", poisoned, "khoảng không"))

    poisoned = copy.deepcopy(base)
    poisoned["plannedAdditions"].append({
        "construct": "TON", "wave": "đợt gần", "issue": None,
        "note": "tiêm thử: hứa một thứ đã giao.",
        "authority": "verify_st_profile_gate",
    })
    cases.append(("hứa một thứ compiler đã có", poisoned, "ĐÃ CÓ"))

    failures: list[str] = []
    for name, curated, needle in cases:
        result = run(curated, args.dump_binary)
        if result.returncode == 0:
            failures.append(f"{name}: cổng KHÔNG nổ (thoát 0). Cổng đã ngừng kiểm chiều này.")
        elif needle not in result.stderr:
            failures.append(
                f"{name}: cổng nổ nhưng thông điệp không nói vì sao "
                f"(thiếu {needle!r}):\n{result.stderr.strip()}"
            )

    if failures:
        print("CỔNG HỎNG:\n  - " + "\n  - ".join(failures), file=sys.stderr)
        return 1

    print(f"OK: cổng đối chiếu hồ sơ ngôn ngữ nổ đúng {len(cases)}/{len(cases)} ca tiêm.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
