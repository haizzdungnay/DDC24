#!/usr/bin/env python3
"""Gate chặn chuỗi tiếng Việt viết KHÔNG DẤU trong giao diện web.

`T57-0.9` của Plan 57 — gate chặn `F-UX-01` tái diễn
(`REV-FE-UIUX-UC-2026-08-18` §7.1).

TRIỆU CHỨNG ĐÃ XẢY RA
    78 chuỗi giao diện được viết không dấu ("Dang tai alarm",
    "Trang thai cau hinh", "Chua co VP nao") nằm rải trên ba trang, nặng nhất ở
    `AlarmsPage` — màn hình quan trọng nhất khi có sự cố.

NGUYÊN NHÂN GỐC
    Không có gate nào kiểm NỘI DUNG chuỗi UI. `check:programming-*` chỉ kiểm
    hợp đồng của Programming; eslint không có luật nào về ngôn ngữ. Lỗi sống
    được nhiều tháng vì nó không làm hỏng build, không làm đỏ test, và người
    review đọc lướt qua vẫn hiểu nghĩa.

CÁCH KIỂM
    Quét đối số THỨ NHẤT của `pick('<vi>', '<en>')` — theo quy ước i18n của dự
    án, đó luôn là bản tiếng Việt. Một chuỗi bị coi là thiếu dấu khi:
      1. không chứa ký tự có dấu tiếng Việt nào, VÀ
      2. chứa ít nhất một từ nằm trong từ điển các từ tiếng Việt mà bản đúng
         BẮT BUỘC phải có dấu.

    Luật (2) là thứ giữ cho gate không báo nhầm: rất nhiều nhãn hợp lệ chỉ gồm
    thuật ngữ kỹ thuật tiếng Anh ("Severity", "Notification Class", "Auto",
    "Manual", "Hysteresis") hoặc mã ("ALM-", "UI-01") — chúng không có dấu và
    đúng là không được có dấu.
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "apps" / "web-ui" / "src"

VIETNAMESE_DIACRITICS = (
    "àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợ"
    "ùúủũụưừứửữựỳýỷỹỵđ"
    "ÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢ"
    "ÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ"
)

# HAI TẦNG TỪ ĐIỂN — vì tiếng Việt có rất nhiều từ ĐÚNG CHÍNH TẢ mà không dấu
# ("ghi", "an", "cho", "khi", "tay", "nam"), một danh sách phẳng sẽ báo nhầm.
#
# Tầng 1 `ALWAYS_WRONG`: dạng không dấu KHÔNG phải một từ tiếng Việt hợp lệ và
# cũng không phải từ tiếng Anh. Thấy MỘT từ là đủ kết luận.
ALWAYS_WRONG = {
    "khong", "duoc", "nguoi", "nguon", "hinh", "diem", "xoa", "luu", "kiem",
    "thiet", "phuc", "truoc", "duoi", "hieu", "lien", "khoi", "tiep", "buoc",
    "luong", "hoat", "vien", "lenh", "nghiem", "xep", "loai", "quyen", "neu",
    "tren", "ngoai", "giua", "khac", "kenh", "nhiet", "suat", "phut", "ket",
    "vuot", "gioi", "thieu", "lich", "tuong", "ung", "xac", "hoan", "chon",
    "dang", "loi", "nguyen", "thuc", "thong", "huong", "chuong", "truong",
    "khuyen", "phuong", "dieu", "kien", "chinh", "chua", "nhieu", "thoi",
    "gian", "trinh", "duyet", "quen", "muon", "buoi", "tiet", "luoc",
    # Bổ sung sau khi ĐO trên 81 chuỗi lỗi thật của bản trước (xem docstring
    # §"Hiệu lực đã đo"): các từ này một mình đã đủ kết luận vì dạng không dấu
    # của chúng không phải từ tiếng Việt hợp lệ, và cũng không phải thuật ngữ
    # kỹ thuật nào dự án đang dùng.
    "uu", "tien", "bien", "bam", "tong", "nhan", "tao", "them", "bat",
}

# Tầng 2 `AMBIGUOUS`: dạng không dấu CÓ THỂ là từ hợp lệ ("canh" = canh chua,
# "tai" = tai người, "bo" = bò). Một mình không kết luận được; nhưng hai từ trở
# lên cùng xuất hiện trong một chuỗi thì gần như chắc chắn là câu tiếng Việt bị
# lột dấu, không phải một nhãn tình cờ.
AMBIGUOUS = {
    "canh", "bao", "tai", "lai", "toan", "bo", "ban", "gia", "tri", "trang",
    "thai", "cau", "moi", "nhat", "cong", "quan", "sang", "hong",
    "muc", "nhan", "tham", "phan", "doc", "dat", "cai", "mang", "phai",
    "voi", "trong", "den", "bien", "noi", "mat", "lac", "tin", "cam", "ap",
    "qua", "han", "dong", "bat", "su", "ly", "tac", "bai", "dung", "sai",
    "le", "tra", "sua", "day", "hang", "gio", "ngay", "nam", "tuan", "lan",
    "tay", "nha", "chay", "thu", "cot", "san", "loc", "tim", "sap", "hien",
    "khi", "cho", "sau", "cung", "nay", "tu", "du", "mo", "toi", "da", "an",
    "doi", "hoac", "roi", "tat",
    # Bổ sung tầng 2 cùng đợt đo: một mình có thể là từ hợp lệ ("lon" = lon
    # nước, "nho" = quả nho, "trung" = trung tâm, "ca" = ca trực), hai từ trở
    # lên mới kết luận.
    "lon", "nho", "trung", "binh", "che", "bi", "it", "ca", "la", "so",
    "de", "ao", "can", "co", "do",
    # (G-01) Không lặp lại từ đã có ở ALWAYS_WRONG: tầng 1 luôn thắng nên luật
    # "cần hai từ" của tầng 2 sẽ âm thầm không áp dụng, gây hiểu nhầm khi đọc.
}

CALL_PATTERN = re.compile(r"pick\(\s*(['\"])((?:\\.|(?!\1).)*)\1")
# Từ điển `t()` trong `shared/i18n.tsx`: `  khoa: 'giá trị',` bên trong khối `vi:`.
DICT_ENTRY_PATTERN = re.compile(r"^\s*'?([A-Za-z][\w-]*)'?:\s*'((?:\\.|[^'])*)',?\s*$", re.M)
# (N-03) `pick(`…`)` dùng template literal — ~6,6 % lời gọi trên cây hiện tại.
# Bản đầu chỉ khớp nháy đơn/kép nên toàn bộ nhánh này lọt lưới.
TEMPLATE_PATTERN = re.compile(r"pick\(\s*`((?:\\.|[^`])*)`")
INTERPOLATION_PATTERN = re.compile(r"\$\{[^}]*\}")
WORD_PATTERN = re.compile(r"[A-Za-zĐđ]+")


def has_diacritics(text: str) -> bool:
    return any(ch in VIETNAMESE_DIACRITICS for ch in text)


def offending_words(text: str) -> list[str]:
    """Trả danh sách từ đáng ngờ, hoặc rỗng nếu chuỗi được coi là hợp lệ.

    Luật kết luận: MỘT từ tầng 1, hoặc HAI từ tầng 2 trở lên.
    """
    words = [word.lower() for word in WORD_PATTERN.findall(text)]
    hard = sorted({word for word in words if word in ALWAYS_WRONG})
    soft = sorted({word for word in words if word in AMBIGUOUS})
    if hard:
        return sorted(set(hard + soft))
    return soft if len(soft) >= 2 else []


def scan_pick_calls(text: str) -> list[tuple[int, str, list[str]]]:
    problems: list[tuple[int, str, list[str]]] = []
    for match in TEMPLATE_PATTERN.finditer(text):
        # Bỏ phần `${...}` trước khi chấm điểm: nội dung nội suy là biểu thức
        # TypeScript, không phải chuỗi hiển thị.
        vietnamese = INTERPOLATION_PATTERN.sub(" ", match.group(1))
        if has_diacritics(vietnamese):
            continue
        words = offending_words(vietnamese)
        if not words:
            continue
        problems.append((text.count("\n", 0, match.start()) + 1, match.group(1), words))
    for match in CALL_PATTERN.finditer(text):
        vietnamese = match.group(2)
        if has_diacritics(vietnamese):
            continue
        words = offending_words(vietnamese)
        if not words:
            continue
        problems.append((text.count("\n", 0, match.start()) + 1, vietnamese, words))
    return problems


def scan_vi_dictionary(text: str) -> list[tuple[int, str, list[str]]]:
    """Quét khối `vi: { ... }` của từ điển `t()` trong `shared/i18n.tsx`.

    BỔ SUNG SAU KIỂM TRA ĐỘC LẬP (2026-08-18). Bản đầu chỉ quét `pick(...)` và
    vì thế **mù đúng chỗ còn lỗi thật**: bốn khoá `alarmSettings*` trong từ điển
    `vi` vẫn không dấu, trong đó `alarmSettingsTitle` là chính `<h1>` của trang
    Cấu hình cảnh báo. Một gate được mô tả là "chặn F-UX-01 tái diễn" mà không
    nhìn thấy nửa số chuỗi giao diện thì lời mô tả đó sai, không phải gate sai.
    """
    start = text.find("vi: {")
    if start == -1:
        return []
    end = text.find("en: {", start)
    block = text[start:end if end != -1 else len(text)]
    problems: list[tuple[int, str, list[str]]] = []
    for match in DICT_ENTRY_PATTERN.finditer(block):
        vietnamese = match.group(2)
        if has_diacritics(vietnamese):
            continue
        words = offending_words(vietnamese)
        if not words:
            continue
        line = text.count("\n", 0, start + match.start()) + 1
        problems.append((line, vietnamese, words))
    return problems


def scan(path: pathlib.Path) -> list[tuple[int, str, list[str]]]:
    text = path.read_text(encoding="utf-8")
    problems = scan_pick_calls(text)
    if path.name == "i18n.tsx":
        problems += scan_vi_dictionary(text)
    return sorted(problems)


def main() -> int:
    if not SRC.is_dir():
        print(f"Không tìm thấy thư mục nguồn: {SRC}", file=sys.stderr)
        return 2

    total = 0
    for path in sorted(SRC.rglob("*.tsx")) + sorted(SRC.rglob("*.ts")):
        for line, text, words in scan(path):
            rel = path.relative_to(ROOT)
            print(f"{rel}:{line}: chuỗi tiếng Việt thiếu dấu: \"{text}\"  (từ: {', '.join(words)})")
            total += 1

    if total:
        print()
        print(f"THẤT BẠI — {total} chuỗi giao diện tiếng Việt bị viết không dấu.")
        print("Đây là gate T57-0.9, chặn finding F-UX-01 tái diễn.")
        print("Viết đủ dấu cho bản tiếng Việt: đối số thứ nhất của `pick(...)`,")
        print("hoặc giá trị trong khối `vi:` của từ điển `shared/i18n.tsx`.")
        return 1

    print("OK — không có chuỗi giao diện tiếng Việt nào bị viết thiếu dấu.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
