#!/usr/bin/env python3
"""Trích bảng từ khoá ST của compiler ra một hằng số TypeScript.

`DEV-PROG-022` — trình soạn thảo ST của FE giữ danh sách từ khoá riêng để tô
màu. Danh sách ấy được CHÉP TAY từ `ST_SUBSET_SPEC` Rev A.0 rồi đứng yên, trong
khi `st_parser.cpp` mọc thêm `parse_case()`. Hệ quả: người dùng thấy `CASE`,
`OF`, `END_CASE` — và `END_FUNCTION_BLOCK` của mọi FB — hiện y hệt một biến chưa
khai báo, tức một máy trạng thái đúng cú pháp trông như đang hỏng.

Chú thích "nhớ cập nhật khi compiler đổi" đã có sẵn ở chỗ đó và không giúp gì.
Script này biến lời nhắc ấy thành một cổng: sinh ra tệp TS từ chính bảng
`kKeywords[]` của compiler, và `--check` làm đỏ khi bản chép trong repo lạc hậu.

Vì sao là tệp sinh, không phải một test đọc thẳng tệp C++: `apps/web-ui` không
cài `@types/node` (nên test TS không đọc được `node:fs`) và `server.fs.allow`
của Vite chặn nạp tệp ngoài thư mục app. Một tệp sinh đi qua được cả hai mà vẫn
giữ đúng một nguồn sự thật.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
PARSER_SOURCE = ROOT / "apps/core/application/st/st_parser.cpp"
TS_OUTPUT = ROOT / "apps/web-ui/src/features/programming/design/editor/stCoreReservedWords.generated.ts"

TABLE = re.compile(r"static const char\* kKeywords\[\] = \{(.*?)\};", re.S)
WORD = re.compile(r'"([A-Z_0-9]+)"')


def reserved_words() -> list[str]:
    source = PARSER_SOURCE.read_text(encoding="utf-8")
    table = TABLE.search(source)
    if table is None:
        raise SystemExit(
            f"không tìm thấy bảng kKeywords[] trong {PARSER_SOURCE}. "
            "Bảng đổi tên hay đổi cấu trúc thì cổng này phải ĐỎ, không được "
            "âm thầm sinh ra danh sách rỗng — một danh sách rỗng làm mọi "
            "assertion phía FE đều đúng và cổng tự tắt chính nó."
        )
    words = WORD.findall(table.group(1))
    if len(words) < 40:
        raise SystemExit(f"chỉ đọc được {len(words)} từ khoá — nghi ngờ trích sai, dừng lại")
    # Giữ nguyên thứ tự khai báo trong C++ để `--check` chỉ đỏ khi nội dung đổi
    # thật, không đỏ vì một lần sắp xếp lại.
    return words


def render(words: list[str]) -> str:
    entries = "\n".join(f"  '{word}'," for word in words)
    return f"""/* SINH TỰ ĐỘNG bởi `scripts/generate_st_reserved_words.py` — KHÔNG sửa tay.
 * Nguồn: `apps/core/application/st/st_parser.cpp`, bảng `kKeywords[]`.
 *
 * Đây là những từ compiler ST GIỮ CHỖ. Trình soạn thảo phải nhận ra tất cả —
 * hoặc là từ khoá, hoặc là tên kiểu, hoặc là tên FB chuẩn — nếu không người
 * dùng sẽ thấy từ khoá hiện như một biến chưa khai báo (`DEV-PROG-022`).
 */
export const ST_CORE_RESERVED_WORDS: readonly string[] = [
{entries}
]
"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="chỉ so, không ghi")
    args = parser.parse_args()

    rendered = render(reserved_words())
    if args.check:
        current = TS_OUTPUT.read_text(encoding="utf-8") if TS_OUTPUT.exists() else ""
        if current != rendered:
            print(
                f"LỆCH: {TS_OUTPUT.relative_to(ROOT)} không khớp bảng kKeywords[] của compiler.\n"
                "Chạy `python3 scripts/generate_st_reserved_words.py` rồi kiểm lại "
                "`ST_KEYWORDS` trong stEditorSupport.ts.",
                file=sys.stderr,
            )
            return 1
        print(f"OK: {TS_OUTPUT.relative_to(ROOT)} khớp compiler.")
        return 0

    TS_OUTPUT.write_text(rendered, encoding="utf-8")
    print(f"Đã ghi {TS_OUTPUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
