#!/usr/bin/env python3
"""Chặn các biến thể breakpoint THUA cascade trong `apps/web-ui/src`.

VÌ SAO CẦN MỘT CỔNG RIÊNG CHO ĐÚNG MẤY CÚ PHÁP NÀY

Tailwind v4 xuất các biến thể `min-[…]` ARBITRARY **trước** mọi breakpoint có
tên. Khi một phần tử mang cả `md:fixed` lẫn `min-[1440px]:static`, hai rule có
cùng độ đặc hiệu và cùng khớp ở ≥1440 px, nên rule đứng SAU trong stylesheet —
bản `md:` — thắng. Ý định của người viết ("từ 1440 px trở lên thì static") bị
lật ngược trong im lặng.

Đây không phải giả thuyết. Đo trên Chrome 2026-09-13, trang Lập trình ở 1680 px:

  - `.min-[1440px]:static` nằm ở offset 59 927 của stylesheet;
  - `.md:fixed`            nằm ở offset 64 425;
  - `getComputedStyle(inspector-column).position === "fixed"`.

Hệ quả: cột Inspector nổi đè lên thanh hành động header (nút LIVE/SIMULATE
không bấm được), để lại một track lưới 240 px rỗng, và khay Mini Map không bao
giờ thành cột thứ ba.

Không có test nào bắt được chuyện này: jsdom không tính CSS thật, còn ảnh chụp
thì chỉ nói "trông sai" chứ không nói vì sao. Cổng này bắt đúng nguyên nhân, ở
đúng lúc người ta gõ ra nó.

KHAI TRONG `@theme` KHÔNG PHẢI THUỐC CHỮA

Đo tiếp cùng ngày: một breakpoint tự khai (`--breakpoint-wide: 1440px`) cũng rơi
vào đúng cụm ấy — thứ tự xuất là `wide` 765, `sm` 779, `md` 813, `lg` 848, `xl`
894. Nghĩa là `wide:` **cũng thua** `md:`/`lg:` khi hai bên tranh cùng một thuộc
tính. Nó chỉ an toàn khi đứng MỘT MÌNH (đấu với utility không tiền tố, vốn xuất
trước mọi biến thể).

Nên cổng này chặn HAI thứ:

1. Biến thể arbitrary `min-[…px]:` — cấm tuyệt đối.
2. `wide:` đứng chung một chuỗi class với `sm:`/`md:`/`lg:`/`xl:`/`2xl:` — vì
   đó chính là hình dạng của cả hai lỗi đã đo được.

CÁCH ĐI ĐÚNG

Ngưỡng ngoài thang mặc định thì cho JavaScript quyết (`useMinWidth` trong
`features/programming/layout/useProgrammingViewport.ts`) rồi áp bằng style nội
tuyến hoặc hai nhánh class LOẠI TRỪ NHAU. Không có hai rule cùng khớp thì không
có gì để thua.

Chạy `--selftest` để kiểm chính logic dò khi sửa tệp này.
"""

from __future__ import annotations

import argparse
import pathlib
import re
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_ROOT = REPO_ROOT / "apps" / "web-ui" / "src"
SUFFIXES = {".ts", ".tsx", ".css"}

# `min-[1440px]:` — chỉ bắt biến thể theo BỀ RỘNG. `min-h-[…]`, `min-w-[…]` và
# các arbitrary value khác không đi kèm dấu `:` kết thúc nên không dính.
PATTERN = re.compile(r"min-\[\s*\d+(?:px|rem|em)\s*\]:")

# Breakpoint TỰ KHAI đứng chung chuỗi với breakpoint MẶC ĐỊNH — hình dạng của cả
# hai lỗi đã đo. Dò trong phạm vi một chuỗi trích dẫn để không bắt nhầm hai class
# nằm ở hai thuộc tính `className` khác nhau trên cùng một dòng.
CUSTOM_BREAKPOINTS = ("wide",)
DEFAULT_BREAKPOINT = re.compile(r"(?<![\w-])(?:sm|md|lg|xl|2xl):")
QUOTED = re.compile(r"\"[^\"\n]*\"|'[^'\n]*'|`[^`\n]*`")


def _mixes_breakpoints(line: str) -> bool:
    for chunk in QUOTED.findall(line):
        has_custom = any(re.search(rf"(?<![\w-]){name}:", chunk) for name in CUSTOM_BREAKPOINTS)
        if has_custom and DEFAULT_BREAKPOINT.search(chunk):
            return True
    return False


def scan_text(text: str) -> list[tuple[int, str]]:
    """Trả về [(số dòng 1-based, nội dung dòng)] cho mỗi dòng vi phạm."""
    hits: list[tuple[int, str]] = []
    for index, line in enumerate(text.splitlines(), start=1):
        if PATTERN.search(line) or _mixes_breakpoints(line):
            hits.append((index, line.strip()))
    return hits


def scan_tree(root: pathlib.Path) -> list[tuple[pathlib.Path, int, str]]:
    findings: list[tuple[pathlib.Path, int, str]] = []
    for path in sorted(root.rglob("*")):
        if path.suffix not in SUFFIXES or not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for line_no, line in scan_text(text):
            findings.append((path, line_no, line))
    return findings


def selftest() -> int:
    cases: list[tuple[str, int]] = [
        ('className="md:fixed min-[1440px]:static"', 1),
        # Arbitrary value KHÔNG phải biến thể: không có dấu hai chấm kết thúc.
        ('className="min-h-[44px] min-w-[1440px]"', 0),
        ('className="min-[48rem]:grid"', 1),
        ("// nhắc tới min-[1280px]: trong chú thích cũng tính là vi phạm", 1),
        ('className="lg:grid-cols-2 xl:grid-cols-3"', 0),
        # `wide:` một mình (đấu với utility không tiền tố) vẫn hợp lệ.
        ('className="flex flex-wrap wide:flex-nowrap wide:py-0"', 0),
        # `wide:` đứng chung với breakpoint mặc định — đúng hình dạng đã gây lỗi.
        ('className="md:fixed wide:static"', 1),
        ('className="lg:grid-cols-2 wide:grid-cols-3"', 1),
        # Hai chuỗi TÁCH BIỆT trên cùng một dòng thì không phải trộn.
        ("""cx(a ? 'wide:static' : '', b ? 'lg:block' : '')""", 0),
    ]
    failures = 0
    for source, expected in cases:
        actual = len(scan_text(source))
        if actual != expected:
            failures += 1
            print(f"SELFTEST FAIL: {source!r} → {actual}, mong đợi {expected}", file=sys.stderr)
    if failures:
        print(f"selftest: {failures} ca hỏng", file=sys.stderr)
        return 1
    print(f"selftest: {len(cases)}/{len(cases)} ca đạt")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", type=pathlib.Path, default=DEFAULT_ROOT)
    parser.add_argument("--selftest", action="store_true", help="kiểm logic dò, không quét cây nguồn")
    args = parser.parse_args()

    if args.selftest:
        return selftest()

    if not args.root.exists():
        print(f"LỖI: không thấy thư mục nguồn {args.root}", file=sys.stderr)
        return 2

    findings = scan_tree(args.root)
    if not findings:
        print(f"OK: không có biến thể breakpoint thua cascade trong {args.root.relative_to(REPO_ROOT)}")
        return 0

    print("LỖI: biến thể breakpoint không an toàn.", file=sys.stderr)
    print("     Tailwind v4 xuất MỌI biến thể breakpoint không-mặc-định (arbitrary", file=sys.stderr)
    print("     `min-[…]:` lẫn breakpoint tự khai như `wide:`) vào một cụm đứng", file=sys.stderr)
    print("     TRƯỚC `sm/md/lg/xl`, nên chúng THUA khi tranh cùng một thuộc tính.", file=sys.stderr)
    print("     Cấm: (1) mọi `min-[…px]:`; (2) `wide:` đứng chung chuỗi class với", file=sys.stderr)
    print("     `sm:`/`md:`/`lg:`/`xl:`/`2xl:`.", file=sys.stderr)
    print("     Ngưỡng ngoài thang mặc định: dùng `useMinWidth()` rồi áp bằng style", file=sys.stderr)
    print("     nội tuyến hoặc hai nhánh class loại trừ nhau.", file=sys.stderr)
    print("", file=sys.stderr)
    for path, line_no, line in findings:
        print(f"  {path.relative_to(REPO_ROOT)}:{line_no}: {line}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
