#!/usr/bin/env python3
"""`T59-808` — cổng ngân sách bundle cho chunk Programming.

Ngân sách chunk đã được pin trong `contracts/programming/pgm02_workspace_v1.json`
§`nfr.frontend` từ `T59-801`, nhưng **không có gì thi hành nó**. Một con số nằm
trong hợp đồng mà không ai kiểm là một con số sẽ bị vượt trong im lặng — và
vượt ngân sách trên thiết bị nhúng không hiện ra như một test đỏ, nó hiện ra như
một trang tải chậm mà không ai biết đổ lỗi cho commit nào.

Script này đọc chính bản build vừa tạo, gzip đúng cách trình duyệt nhận, rồi so
với ngân sách của increment. Nó KHÔNG tự đoán increment: `--increment` là tham
số bắt buộc, vì chọn nhầm R3 cho một bản R1 là cách dễ nhất để cổng này trở nên
vô nghĩa.
"""

from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "contracts/programming/pgm02_workspace_v1.json"
DEFAULT_DIST = ROOT / "build/web-ui/dist/assets"

BUDGET_KEY = {
    "r1": "r1ProgrammingChunkGzipBudgetKiB",
    "r2": "r2ProgrammingChunkGzipBudgetKiB",
    "r3": "r3ProgrammingChunkGzipBudgetKiB",
}


def gzip_bytes(path: Path) -> int:
    """Kích thước gzip ở mức nén **mặc định của zlib (6)**.

    Không dùng mức 9: mức 9 là trường hợp TỐT NHẤT một máy chủ có thể làm, còn
    máy chủ tĩnh thường nén ở mặc định. Gate phải đo cái thực tế phục vụ, không
    phải cái đẹp nhất có thể.
    """
    return len(gzip.compress(path.read_bytes(), 6))


def find_chunk(assets: Path, stem: str) -> Path | None:
    matches = sorted(assets.glob(f"{stem}-*.js"))
    if not matches:
        return None
    if len(matches) > 1:
        # Nhiều bản băm cùng tên nghĩa là thư mục build còn rác của lần trước.
        # Đo nhầm bản cũ sẽ cho một con số "đạt" không thuộc về bản đang xét.
        raise SystemExit(
            f"FAIL: có {len(matches)} chunk `{stem}-*.js` trong {assets}; "
            "dọn thư mục build rồi chạy lại để không đo nhầm bản cũ:\n  " +
            "\n  ".join(item.name for item in matches)
        )
    return matches[0]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--increment", required=True, choices=sorted(BUDGET_KEY))
    parser.add_argument("--assets", type=Path, default=DEFAULT_DIST)
    parser.add_argument("--chunk", default="programming")
    args = parser.parse_args()

    contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
    frontend = contract["nfr"]["frontend"]
    budget = float(frontend[BUDGET_KEY[args.increment]])
    baseline = float(frontend["baselineProgrammingChunkGzipKiB"])

    if not args.assets.is_dir():
        print(f"FAIL: chưa có thư mục build `{args.assets}` — chạy `npm run build` trước.")
        return 2

    chunk = find_chunk(args.assets, args.chunk)
    if chunk is None:
        print(f"FAIL: không tìm thấy chunk `{args.chunk}-*.js` trong {args.assets}.")
        return 2

    raw = gzip_bytes(chunk)
    measured = raw / 1024
    headroom = budget - measured
    print(f"chunk      : {chunk.name}")
    # In CẢ HAI đơn vị có chủ đích. Log build của vite in **kB (1000)** còn hợp
    # đồng pin **KiB (1024)**; đọc con số này thành con số kia là sai ~2,4% —
    # đủ để một PR tưởng mình còn dư địa hoặc tưởng mình đã vượt.
    print(f"gzip       : {measured:.2f} KiB  ({raw / 1000:.2f} kB, {raw} bytes)")
    print(f"baseline   : {baseline:.2f} KiB")
    print(f"ngân sách  : {budget:.2f} KiB ({args.increment.upper()})")
    print(f"dư địa     : {headroom:.2f} KiB")

    if measured > budget:
        print(
            f"FAIL: chunk `{args.chunk}` vượt ngân sách {args.increment.upper()} "
            f"{measured - budget:.2f} KiB. Ngân sách là thứ bảo vệ thiết bị nhúng "
            "khỏi phình dần — nâng nó là quyết định sản phẩm, ghi ở "
            "`PROGRAMMING_OPEN_DECISIONS.md`, không phải sửa nhanh trong một PR."
        )
        return 1

    print(f"PASS: chunk `{args.chunk}` trong ngân sách {args.increment.upper()}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
