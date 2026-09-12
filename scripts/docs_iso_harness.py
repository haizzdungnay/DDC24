#!/usr/bin/env python3
"""Harness kiểm chứng bộ hồ sơ Programming MK-DDC-24 — ISO-aligned document gate.

Chạy:
    python3 scripts/docs_iso_harness.py            # tóm tắt
    python3 scripts/docs_iso_harness.py -v         # kèm chi tiết từng vi phạm
    python3 scripts/docs_iso_harness.py --expect   # bật cả kiểm ngưỡng, dùng cho CI
    python3 scripts/docs_iso_harness.py --selftest # kiểm luật bóc của phép kiểm 8 và 9

Chín phép kiểm:
  1. Toàn bộ authority baseline thống nhất tồn tại tại đúng đường dẫn chuẩn
  2. Liên kết Markdown nội bộ và anchor phải phân giải được
  3. Trailing whitespace = 0
  4. Code fence cân bằng
  5. Không trùng Document ID
  6. Đếm ID theo họ: requirement / VS-PROG / RSK / UC / UJ / UX-REQ / OD
  7. Bất biến ma trận trace: không có `P=Y khi T=N`, không có `R=Y khi P=N`
  8. Link tương đối trên **mọi** file `docs/**/*.md` phải trỏ tới đích có thật
     (`docs_link_missing`). Khác phép kiểm 2 ở phạm vi: phép kiểm 2 chỉ soi
     danh sách cứng `BASELINE + EXTRA`, phép kiểm 8 quét toàn cây `docs/`.
  9. Khối metadata đầu hồ sơ phải khớp dòng mới nhất của bảng **Lịch sử sửa
     đổi** trong chính hồ sơ đó (`meta_revision_drift`), trên toàn cây `docs/`.
  Cộng: đường dẫn `docs/**` viết trong code span phải tồn tại; các record P0 và
  template Test Result và manifest ngoài baseline cũng được quét link/ID/format.

Phạm vi cố ý **không** kiểm `apps/**`, `firmware/**`, `contracts/**` trong code
span: đó là *Source Target sẽ tạo*, chưa tồn tại là đúng theo quy tắc ở
`TRACE-PROG-001` §6.

Exit code: 0 nếu mọi phép kiểm bắt buộc đạt; 1 nếu có vi phạm. Với `--expect`,
sai lệch so với ngưỡng ở EXPECT cũng làm exit 1.

Đây là kiểm **tài liệu**. Nó không chạy build, test, trình duyệt, target hay HIL,
và không chứng minh bất kỳ điều gì về implementation.
"""
import os
import re
import sys
import collections

# Repo root = thư mục cha của scripts/. Không hard-code đường dẫn tuyệt đối.
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Ngưỡng kỳ vọng hiện hành. Cập nhật cùng lúc với hồ sơ, không cập nhật sau.
EXPECT = {
    "baseline_files": 17,
    "support_files": 5,
    "link_missing": 0,
    "docs_link_missing": 0,
    "anchor_missing": 0,
    "trailing_ws": 0,
    "fence_bad": 0,
    "duplicate_doc_id": 0,
    "span_missing": 0,
    "meta_revision_drift": 0,
    "srs_requirements": 89,
    "trace_rows": 89,
    "trace_violations": 0,
    "vs_prog": 47,
    "rsk_prog": 23,
    "od_prog": 17,
    "uc_prog": 17,
    "uj_prog": 8,
    "ux_req": 29,
    "programming_visual_assets": 10,
}

BASELINE = [
    "docs/00_governance/CONTROL.md",
    "docs/00_governance/DECISIONS.md",
    "docs/00_governance/PROGRAMMING_OPEN_DECISIONS.md",
    "docs/00_governance/PROGRAMMING_DOCUMENT_READINESS_MATRIX.md",
    "docs/01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md",
    "docs/02_design/PROGRAMMING_DESIGN_INDEX.md",
    "docs/02_requirements/PROGRAMMING_REQUIREMENTS_SPEC.md",
    "docs/03_architecture/PROGRAMMING_ARCHITECTURE.md",
    "docs/02_design/software/PROGRAMMING_UNIFIED_PRODUCT_DETAILED_DESIGN.md",
    "docs/02_design/software/PROGRAMMING_PGM02_WORKSPACE_DETAILED_DESIGN.md",
    "docs/02_design/software/PROGRAMMING_LANGUAGE_COMPILER_DESIGN.md",
    "docs/04_uiux/PROGRAMMING_UI_UX_DESIGN.md",
    "docs/05_verification/PROGRAMMING_VERIFICATION_PLAN.md",
    "docs/07_records/PROGRAMMING_RISK_REGISTER.md",
    "docs/07_records/PROGRAMMING_TRACEABILITY_MATRIX.md",
    "docs/03_implementation/59_PROGRAMMING_DOC_TO_CODE_IMPLEMENTATION_PLAN.md",
    "docs/03_implementation/PROMPT_PLAN59_AUTONOMOUS_EXECUTION.md",
]
EXTRA = [
    "docs/06_operations/PROGRAMMING_OPERATIONS_RUNBOOK.md",
    "docs/07_records/reviews/PROGRAMMING_UNIFIED_BASELINE_MANIFEST_2026-08-20.md",
    "docs/07_records/reviews/README.md",
    "docs/07_records/test-results/programming/README.md",
    "docs/07_records/test-results/programming/RESULT_TEMPLATE.md",
]

LINK_RE = re.compile(r"\[[^\]]*\]\(([^)]+)\)")

# Phép kiểm link toàn `docs/**` (phép kiểm 8) dùng regex RIÊNG, không dùng
# `LINK_RE`: `LINK_RE` không bóc được cú pháp ngoặc nhọn hợp lệ của Markdown
# `[nhãn](<đường/dẫn>)`, nên nó giữ luôn cặp `<>` trong đường dẫn và báo một
# mục không tồn tại ở
# `docs/04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/reviews/PGM02_ST_FBD_REDESIGN_IMPLEMENTATION_REVIEW.md:255`
# trong khi file ảnh đó có thật. Một cổng mà lần đầu bật đã báo sai một mục
# thì lần sau không ai tin nó — nên nhánh `<...>` phải được bóc riêng.
# Nhánh 1 `<...>`: cho phép dấu cách bên trong. Nhánh 2: đường dẫn trần.
DOCS_LINK_RE = re.compile(r"\[[^\]]*\]\(\s*(?:<([^>\n]*)>|([^()\s]*))\s*\)")

# Scheme không phải đường dẫn cục bộ nên không kiểm tồn tại. `file:` giữ
# nguyên hành vi của phép kiểm cũ.
LINK_SKIP_PREFIX = ("http://", "https://", "mailto:", "#", "file:")

HEAD_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*$")


def slugify(text):
    # GitHub-style anchor
    text = text.strip().lower()
    text = re.sub(r"[`*_~]", "", text)
    # strip markdown links -> keep label
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    out = []
    for ch in text:
        if ch.isalnum() or ch in "-_ ":
            out.append(ch)
        elif ord(ch) > 127:
            out.append(ch)
    text = "".join(out)
    text = text.replace(" ", "-")
    return text


def anchors_of(path):
    res = set()
    try:
        with open(path, encoding="utf-8") as fh:
            in_fence = False
            for line in fh:
                if line.lstrip().startswith("```"):
                    in_fence = not in_fence
                    continue
                if in_fence:
                    continue
                m = HEAD_RE.match(line.rstrip("\n"))
                if m:
                    res.add(slugify(m.group(2)))
    except OSError:
        pass
    return res


def extract_link_targets(line):
    """Bóc các link cục bộ cần kiểm tồn tại trong một dòng Markdown.

    Trả về danh sách `(target gốc, phần đường dẫn đã cắt anchor)`. Link ngoài
    (`http`, `mailto`, …), anchor thuần `#muc` và scheme `file:` bị bỏ qua —
    chúng không phải đường dẫn cục bộ.

    Tách riêng khỏi `scan_docs_links` để `--selftest` kiểm được luật bóc mà
    không cần dựng cây thư mục thật.
    """
    out = []
    for m in DOCS_LINK_RE.finditer(line):
        raw = m.group(1) if m.group(1) is not None else m.group(2)
        target = (raw or "").strip()
        if not target or target.startswith(LINK_SKIP_PREFIX):
            continue
        # Cắt anchor trước khi kiểm tồn tại: `a.md#muc` trỏ file `a.md`.
        path_part = target.split("#", 1)[0]
        if not path_part:
            continue
        out.append((target, path_part))
    return out


def selftest():
    """Khoá lại luật bóc link của phép kiểm 8.

    Ca quan trọng nhất là cú pháp ngoặc nhọn `[nhãn](<đường/dẫn>)`: regex cũ
    `LINK_RE` giữ luôn cặp `<>` trong đường dẫn và biến một link ĐÚNG thành
    một báo động giả. Nếu ai đó gộp hai regex làm một trong tương lai, ca này
    phải đỏ ngay tại đây chứ không phải sau khi cổng đã báo sai cho cả repo.
    """
    cases = [
        # (dòng, danh sách path_part kỳ vọng)
        ("[a](<../assets/x.png>)", ["../assets/x.png"]),
        ("[a](<../assets/co dau cach.png>)", ["../assets/co dau cach.png"]),
        ("[a](./b.md)", ["./b.md"]),
        ("[a](./b.md#muc-1)", ["./b.md"]),
        ("[a](#chi-anchor)", []),
        ("[a](https://x/y) [b](http://x) [c](mailto:a@b)", []),
        ("[a](file:///C:/tmp/x.md)", []),
        ("[a](x.md) và [b](<y.md>)", ["x.md", "y.md"]),
        ("khong co link", []),
    ]
    failed = 0
    for line, expected in cases:
        got = [path for _, path in extract_link_targets(line)]
        if got != expected:
            failed += 1
            print(f"  FAIL {line!r}: kỳ vọng {expected}, thực tế {got}")
    # Anchor phải được giữ nguyên trong target gốc để thông báo lỗi đọc được.
    targets = extract_link_targets("[a](./b.md#muc-1)")
    if targets and targets[0][0] != "./b.md#muc-1":
        failed += 1
        print(f"  FAIL target gốc mất anchor: {targets[0][0]!r}")
    print(f"selftest phép kiểm 8: {len(cases) + 1 - failed}/{len(cases) + 1} đạt")
    return 1 if failed else 0


def selftest_meta_revision():
    """Khoá lại luật bóc của phép kiểm 9.

    Bốn ca dưới đây đều là hình dạng CÓ THẬT trong `docs/`, không phải ca giả
    định: bảng xếp không theo thứ tự (`WF-CLEAN-001`), phiên bản hai chữ số ở
    phần minor (`docs/07_records/reviews/README.md` đang ở 1.24, phải lớn hơn
    1.3), tiêu đề có tiền tố đánh số (`## 6. Lịch sử sửa đổi`), và tiêu đề
    khớp lỏng mà cổng PHẢI bỏ qua (`## 7. Persistence, revision và migration`).
    Ai sửa bộ bóc này mà làm hỏng một trong bốn ca sẽ thấy đỏ ngay tại đây,
    chứ không phải sau khi cổng đã báo sai cho cả cây tài liệu.
    """
    unordered = [
        "**Phiên bản:** 1.3",
        "**Cập nhật:** 2026-09-11 (ghi chú dài phía sau)",
        "## Lịch sử sửa đổi",
        "| Phiên bản | Ngày | Thay đổi |",
        "|---|---|---|",
        "| 1.0 | 2026-09-09 | a |",
        "| 1.3 | 2026-09-11 | b |",
        "| 1.2 | 2026-09-11 | c |",
        "| 1.1 | 2026-09-10 | d |",
    ]
    two_digit_minor = [
        "**Phiên bản:** 1.24",
        "## Revision history",
        "| 1.3 | 2026-08-11 | a |",
        "| 1.24 | 2026-09-11 | b |",
    ]
    numbered_heading = [
        "**Phiên bản:** 1.1",
        "## 6. Lịch sử sửa đổi",
        "| 1.0 | 2026-08-15 | a |",
        "| 1.1 | 2026-08-15 | b |",
    ]
    decoy_heading = [
        "**Phiên bản:** 9.9",
        "## 7. Persistence, revision và migration",
        "| 1.0 | 2026-08-05 | không phải bảng lịch sử |",
    ]
    fenced = [
        "**Phiên bản:** 1.0",
        "## Lịch sử sửa đổi",
        "```",
        "| 2.0 | 2026-01-01 | ví dụ trong code fence, không được tính |",
        "```",
        "| 1.0 | 2026-08-01 | thật |",
    ]
    cases = [
        # (tên, dòng, kỳ vọng (meta_version, meta_updated, top))
        ("bảng không xếp thứ tự", unordered, ("1.3", "2026-09-11", ("1.3", "2026-09-11"))),
        ("minor hai chữ số", two_digit_minor, ("1.24", None, ("1.24", "2026-09-11"))),
        ("tiêu đề có đánh số", numbered_heading, ("1.1", None, ("1.1", "2026-08-15"))),
        ("tiêu đề khớp lỏng bị bỏ qua", decoy_heading, ("9.9", None, None)),
        ("dòng trong code fence bị bỏ qua", fenced, ("1.0", None, ("1.0", "2026-08-01"))),
    ]
    failed = 0
    for name, lines, expected in cases:
        got = parse_meta_revision(lines)
        if got != expected:
            failed += 1
            print(f"  FAIL {name}: kỳ vọng {expected}, thực tế {got}")

    # Chuẩn hoá ô phiên bản: đuôi `<br>`, dấu nhấn mạnh, tiền tố `v`.
    clean_cases = [("2.3<br>", "2.3"), ("`1.6`", "1.6"), ("v0.2", "0.2"), ("1.0", "1.0")]
    for raw, expected in clean_cases:
        got = clean_meta_version(raw)
        if got != expected:
            failed += 1
            print(f"  FAIL clean_meta_version({raw!r}): kỳ vọng {expected!r}, thực tế {got!r}")

    total = len(cases) + len(clean_cases)
    print(f"selftest phép kiểm 9: {total - failed}/{total} đạt")
    return 1 if failed else 0


def count_docs_md():
    """Số file `.md` dưới `docs/` — in kèm để người đọc thấy ngay phạm vi quét,
    thay vì phải tin một con số không nói mình đo trên bao nhiêu hồ sơ."""
    total = 0
    for root, dirs, filenames in os.walk(os.path.join(REPO, "docs")):
        dirs[:] = [d for d in dirs if d != "node_modules"]
        total += sum(1 for name in filenames if name.endswith(".md"))
    return total


def scan_docs_links():
    """Đếm link tương đối trỏ tới đường dẫn không tồn tại trên MỌI file
    `docs/**/*.md`.

    Phép kiểm `link_missing` (số 2) chỉ quét danh sách cứng `BASELINE + EXTRA`
    = 22 file, trong khi `docs/` có hơn 400 file `.md`. Nó in `0` và người đọc
    hiểu là "link trong docs/ đã được canh" — rộng hơn hẳn thứ nó thật sự đo.
    Phép kiểm này đóng đúng khoảng cách đó, và vì không dùng danh sách cứng
    nên mọi hồ sơ thêm sau này đều tự động nằm trong phạm vi.

    Cố ý CHỈ kiểm sự tồn tại của đích. Không mở rộng anchor/whitespace/fence
    sang tập rộng: chúng sẽ báo hàng nghìn mục và làm cổng mất tác dụng.
    """
    hits = []
    docs_root = os.path.join(REPO, "docs")
    for root, dirs, filenames in os.walk(docs_root):
        dirs[:] = [d for d in dirs if d != "node_modules"]
        for name in sorted(filenames):
            if not name.endswith(".md"):
                continue
            full = os.path.join(root, name)
            rel = os.path.relpath(full, REPO)
            try:
                with open(full, encoding="utf-8", errors="ignore") as fh:
                    lines = fh.read().split("\n")
            except OSError:
                continue
            in_fence = False
            for i, ln in enumerate(lines, 1):
                if ln.lstrip().startswith("```"):
                    in_fence = not in_fence
                    continue
                if in_fence:
                    continue
                for target, path_part in extract_link_targets(ln):
                    dest = os.path.normpath(os.path.join(root, path_part))
                    if not os.path.exists(dest):
                        hits.append(f"{rel}:{i} -> {target}")
    return hits


# --- Phép kiểm 9: metadata đầu hồ sơ vs bảng Lịch sử sửa đổi --------------
#
# Nền: `WF-CLEAN-001` bị nâng phiên bản ba lần liên tiếp (1.1 → 1.2 → 1.3) mà
# khối metadata đầu file vẫn đứng ở "1.0 / 2026-09-09". Ba phiên liên tiếp bỏ
# sót cùng một bước là khoảng trống cổng, không phải ba lần bất cẩn rời rạc:
# một hồ sơ authority khai sai phiên bản của chính nó thì người đọc không biết
# mình đang đọc bản nào, đúng lớp lỗi mà `DOC-CTRL-001` sinh ra để chặn.
#
# Phạm vi cố ý hẹp: chỉ những hồ sơ **tự khai** cả hai thứ — có dòng
# `**Phiên bản:**` trong khối metadata VÀ có bảng Lịch sử sửa đổi đọc được ít
# nhất một dòng. Hồ sơ không có bảng lịch sử thì không khai gì để mà lệch, nên
# không bị phép kiểm này đụng tới; ràng buộc "phải có revision history" thuộc
# `DD-01` và không thi hành ở đây.
META_VERSION_RE = re.compile(r"^\*\*(?:Phiên bản|Version)\:\*\*\s*(.+?)\s*$")
META_UPDATED_RE = re.compile(r"^\*\*Cập nhật\:\*\*\s*(\d{4}-\d{2}-\d{2})")

# Tiêu đề bảng lịch sử, so khớp CHÍNH XÁC sau khi bỏ tiền tố đánh số. Không
# dùng "chứa chữ lịch sử/revision": trong `docs/` có `## 7. Persistence,
# revision và migration`, `## 2. Hồ sơ lịch sử đã loại khỏi cây Markdown` và
# `## Bản ghi lịch sử 2026-09-05 — …`; khớp lỏng sẽ đọc nhầm bảng khác rồi báo
# động giả, mà một cổng báo sai ngay lần đầu bật thì lần sau không ai tin nó.
HISTORY_TITLES = ("lịch sử sửa đổi", "lịch sử", "revision history")

# Ô đầu tiên là số phiên bản dạng chấm (cho phép ``, `v`), ô thứ hai là ngày
# ISO. Dòng nào không đúng dạng đó — kể cả `1.5-candidate` của `DOC-CTRL-001` —
# bị bỏ qua: bản candidate không phải mốc mà metadata phải khai.
HISTORY_ROW_RE = re.compile(
    r"^\|\s*`?[vV]?(\d+(?:\.\d+)*)`?\s*\|\s*(\d{4}-\d{2}-\d{2})\s*\|"
)
HEADING_NUM_RE = re.compile(r"^\s*\d+(?:\.\d+)*\.?\s+")


def normalize_heading(text):
    """Bỏ tiền tố đánh số và ký tự nhấn mạnh để so tiêu đề bảng lịch sử.

    `## 6. Lịch sử sửa đổi`, `## 10. Lịch sử sửa đổi` và `## Revision history`
    đều là cùng một mục; ba cách viết này cùng tồn tại trong `docs/`.
    """
    text = HEADING_NUM_RE.sub("", text.strip())
    return re.sub(r"[`*_]", "", text).strip().lower()


def parse_meta_revision(lines):
    """Bóc (phiên bản metadata, ngày cập nhật metadata, dòng lịch sử mới nhất).

    Dòng mới nhất lấy theo **số phiên bản lớn nhất**, không lấy dòng cuối bảng:
    bảng của `WF-CLEAN-001` xếp 1.0, 1.3, 1.2, 1.1 — lấy dòng cuối sẽ ra 1.1 và
    cổng sẽ đòi hạ phiên bản. So sánh theo tuple số nguyên nên 1.24 > 1.3, đúng
    với `docs/07_records/reviews/README.md` đang ở 1.24.

    Trả về `(meta_version, meta_updated, top_row)`; `top_row` là
    `(version_str, date_str)` hoặc `None` khi hồ sơ không có bảng lịch sử.
    """
    meta_version = None
    meta_updated = None
    rows = []
    history_level = None
    in_fence = False
    for ln in lines:
        if ln.lstrip().startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        head = HEAD_RE.match(ln)
        if head:
            level = len(head.group(1))
            # Ra khỏi mục lịch sử khi gặp tiêu đề cùng cấp hoặc cao hơn.
            if history_level is not None and level <= history_level:
                history_level = None
            if history_level is None and normalize_heading(head.group(2)) in HISTORY_TITLES:
                history_level = level
            continue
        if history_level is None:
            if meta_version is None:
                m = META_VERSION_RE.match(ln)
                if m:
                    meta_version = m.group(1)
            if meta_updated is None:
                m = META_UPDATED_RE.match(ln)
                if m:
                    meta_updated = m.group(1)
        else:
            m = HISTORY_ROW_RE.match(ln)
            if m:
                key = tuple(int(x) for x in m.group(1).split("."))
                rows.append((key, m.group(1), m.group(2)))
    if not rows:
        return meta_version, meta_updated, None
    top = max(rows)
    return meta_version, meta_updated, (top[1], top[2])


def clean_meta_version(raw):
    """Chuẩn hoá ô phiên bản ở metadata: bỏ ``, **, `v` đầu và đuôi `<br>`.

    `PGM-02_QUICK_LIBRARY_SIM_LIVE_SPEC_v2_2.md` viết `**Phiên bản:** 2.3<br>`;
    không bóc đuôi đó thì cổng báo lệch trong khi hồ sơ hoàn toàn đúng.
    """
    raw = re.sub(r"<br\s*/?>", "", raw or "")
    raw = re.sub(r"[`*_]", "", raw).strip()
    return re.sub(r"^[vV](?=\d)", "", raw)


def scan_meta_revision():
    """Đếm hồ sơ `docs/**/*.md` có metadata lệch bảng Lịch sử sửa đổi.

    Hai phép so:
      * `**Phiên bản:**` phải bằng số phiên bản của dòng lịch sử mới nhất —
        bắt buộc với mọi hồ sơ trong phạm vi.
      * `**Cập nhật:**` phải bằng ngày của chính dòng đó — chỉ áp dụng khi hồ
        sơ có khai `**Cập nhật:**`. `**Ngày:**` là ngày phát hành bản gốc, cố ý
        không kéo theo, nếu không mọi hồ sơ Modbus sẽ đỏ vì một trường mang
        nghĩa khác.
    """
    hits = []
    docs_root = os.path.join(REPO, "docs")
    for root, dirs, filenames in os.walk(docs_root):
        dirs[:] = [d for d in dirs if d != "node_modules"]
        for name in sorted(filenames):
            if not name.endswith(".md"):
                continue
            full = os.path.join(root, name)
            rel = os.path.relpath(full, REPO)
            try:
                with open(full, encoding="utf-8", errors="ignore") as fh:
                    lines = fh.read().split("\n")
            except OSError:
                continue
            meta_version, meta_updated, top = parse_meta_revision(lines)
            if meta_version is None or top is None:
                continue
            top_version, top_date = top
            if clean_meta_version(meta_version) != top_version:
                hits.append(
                    f"{rel}: metadata Phiên bản={clean_meta_version(meta_version)!r} "
                    f"nhưng dòng lịch sử mới nhất là {top_version!r}"
                )
            if meta_updated and meta_updated != top_date:
                hits.append(
                    f"{rel}: metadata Cập nhật={meta_updated} nhưng dòng lịch sử "
                    f"{top_version} ghi ngày {top_date}"
                )
    return hits



def main():
    if "--selftest" in sys.argv:
        return selftest() | selftest_meta_revision()

    problems = collections.defaultdict(list)
    files = [os.path.join(REPO, p) for p in BASELINE + EXTRA]

    # 1. existence
    missing_files = [p for p in BASELINE if not os.path.isfile(os.path.join(REPO, p))]
    missing_extra = [p for p in EXTRA if not os.path.isfile(os.path.join(REPO, p))]
    print("=== 1. Baseline file ===")
    print(f"exist: {len(BASELINE) - len(missing_files)}/{len(BASELINE)}")
    for p in missing_files:
        print(f"  MISSING {p}")
    print(f"support: {len(EXTRA) - len(missing_extra)}/{len(EXTRA)}")
    for p in missing_extra:
        print(f"  SUPPORT MISSING {p}")

    anchor_cache = {}
    link_missing = 0
    anchor_missing = 0
    trailing_ws = 0
    fence_bad = []
    doc_ids = collections.defaultdict(list)

    print("\n=== 2. Link / whitespace / fence ===")
    for full in files:
        rel = os.path.relpath(full, REPO)
        if not os.path.isfile(full):
            continue
        with open(full, encoding="utf-8") as fh:
            lines = fh.read().split("\n")
        # fence
        fences = sum(1 for ln in lines if ln.lstrip().startswith("```"))
        if fences % 2 != 0:
            fence_bad.append(rel)
        # trailing whitespace
        for i, ln in enumerate(lines, 1):
            if ln != ln.rstrip():
                trailing_ws += 1
                problems["ws"].append(f"{rel}:{i}")
        # doc id
        for i, ln in enumerate(lines, 1):
            m = re.match(r"^\|\s*ID(?: tài liệu)?\s*\|\s*`([^`]+)`\s*\|", ln)
            if m:
                doc_ids[m.group(1)].append(rel)
        # links
        in_fence = False
        for i, ln in enumerate(lines, 1):
            if ln.lstrip().startswith("```"):
                in_fence = not in_fence
                continue
            if in_fence:
                continue
            for target in LINK_RE.findall(ln):
                target = target.strip()
                if target.startswith(("http://", "https://", "mailto:")):
                    continue
                if target.startswith("#"):
                    anch = target[1:]
                    if full not in anchor_cache:
                        anchor_cache[full] = anchors_of(full)
                    if slugify(anch) not in anchor_cache[full]:
                        anchor_missing += 1
                        problems["anchor"].append(f"{rel}:{i} -> {target}")
                    continue
                path_part, _, anch = target.partition("#")
                dest = os.path.normpath(os.path.join(os.path.dirname(full), path_part))
                if not os.path.exists(dest):
                    link_missing += 1
                    problems["link"].append(f"{rel}:{i} -> {target}")
                elif anch and dest.endswith(".md"):
                    if dest not in anchor_cache:
                        anchor_cache[dest] = anchors_of(dest)
                    if slugify(anch) not in anchor_cache[dest]:
                        anchor_missing += 1
                        problems["anchor"].append(f"{rel}:{i} -> {target}")

    print(f"local link missing : {link_missing}")
    print(f"anchor missing     : {anchor_missing}")
    print(f"trailing whitespace: {trailing_ws}")
    print(f"code fence lệch    : {len(fence_bad)} {fence_bad}")

    # Phép kiểm 8 — link trên TOÀN BỘ `docs/**`, không dùng danh sách cứng.
    docs_md_total = count_docs_md()
    docs_link_hits = scan_docs_links()
    problems["docs_link"] = docs_link_hits
    print(f"docs/** link missing: {len(docs_link_hits)} (quét {docs_md_total} file .md)")
    for item in docs_link_hits[:20]:
        print(f"  {item}")

    print("\n=== 3. Duplicate document ID ===")
    dups = {k: v for k, v in doc_ids.items() if len(v) > 1}
    print(f"duplicate doc ID: {len(dups)}")
    for k, v in dups.items():
        print(f"  {k}: {v}")

    # counts
    print("\n=== 4. Đếm ID ===")
    srs = os.path.join(REPO, "docs/02_requirements/PROGRAMMING_REQUIREMENTS_SPEC.md")
    trace = os.path.join(REPO, "docs/07_records/PROGRAMMING_TRACEABILITY_MATRIX.md")
    vvp = os.path.join(REPO, "docs/05_verification/PROGRAMMING_VERIFICATION_PLAN.md")
    risk = os.path.join(REPO, "docs/07_records/PROGRAMMING_RISK_REGISTER.md")
    ux = os.path.join(REPO, "docs/04_uiux/PROGRAMMING_UI_UX_DESIGN.md")

    def read(p):
        try:
            return open(p, encoding="utf-8").read()
        except OSError:
            return ""

    srs_txt, trace_txt, vvp_txt, risk_txt, ux_txt = map(
        read, (srs, trace, vvp, risk, ux))

    req_re = re.compile(
        r"`((?:SYS|SWR|FW|HW|NFR)-REQ-PROG-(?:FE-|BE-|CORE-|MCU-)?\d{3})`")
    srs_ids = sorted(set(req_re.findall(srs_txt)))
    print(f"SRS requirement ID (canonical, unique): {len(srs_ids)}")

    vs_re = re.compile(r"`?(VS-PROG-(?:\d{3}|U\d{2}))`?")
    vs_vvp = sorted(set(vs_re.findall(vvp_txt)))
    print(f"VS-PROG trong VVP: {len(vs_vvp)}")

    rsk_re = re.compile(r"`?(RSK-PROG-\d{3})`?")
    rsk = sorted(set(rsk_re.findall(risk_txt)))
    print(f"RSK-PROG trong Risk Register: {len(rsk)}")

    uc_re = re.compile(r"`?(UC-PROG-\d{2,3})`?")
    uc = sorted(set(uc_re.findall(ux_txt)))
    print(f"UC-PROG trong UI/UX: {len(uc)}")

    uj_re = re.compile(r"`?(UJ-PROG-\d{2})`?")
    print(f"UJ-PROG trong UI/UX: {len(sorted(set(uj_re.findall(ux_txt))))}")
    prod = read(os.path.join(REPO, "docs/01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md"))
    print(f"UJ-PROG trong Product Spec: {len(sorted(set(uj_re.findall(prod))))}")
    print(f"UJ-PROG trong Trace: {len(sorted(set(uj_re.findall(trace_txt))))}")

    # Asset trực quan Programming theo gói FE Handoff được chủ sở hữu duyệt.
    import glob as _g
    handoff_assets_dir = os.path.join(
        REPO, "docs/04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/assets"
    )
    programming_visual_assets = [
        path for path in _g.glob(os.path.join(handoff_assets_dir, "*"))
        if os.path.splitext(path)[1].lower() in {".png", ".html"}
    ]
    print(f"Asset trực quan Programming: {len(programming_visual_assets)}")

    uxr_re = re.compile(r"`?(UX-REQ-\d{3})`?")
    uxr = sorted(set(uxr_re.findall(ux_txt)))
    print(f"UX-REQ trong UI/UX: {len(uxr)}")

    od_re = re.compile(r"`?(UD-PROG-\d{3})`?")
    od_txt = read(os.path.join(REPO, "docs/00_governance/PROGRAMMING_OPEN_DECISIONS.md"))
    od = sorted(set(od_re.findall(od_txt)))
    print(f"UD-PROG trong Decision Register: {len(od)}")

    # trace rows
    print("\n=== 5. Trace D/I/T/P/R ===")
    rows = re.findall(r"^\|\s*`([^`]+)`\s*\|.*\|\s*([YN])/([YN])/([YN])/([YN])/([YN])\s*\|",
                      trace_txt, re.M)
    print(f"trace rows có D/I/T/P/R: {len(rows)}")
    bad = [r for r in rows if (r[4] == "Y" and r[3] == "N") or (r[5] == "Y" and r[4] == "N")]
    print(f"vi phạm P=Y khi T=N hoặc R=Y khi P=N: {len(bad)} {bad}")

    # TBD / BLOCKED
    print("\n=== 6. TBD / BLOCKED ===")
    tbd_total = 0
    for full in files:
        rel = os.path.relpath(full, REPO)
        if not os.path.isfile(full):
            continue
        for i, ln in enumerate(open(full, encoding="utf-8").read().split("\n"), 1):
            if re.search(r"\bTBD\b|\bBLOCKED\b|TARGET-PENDING", ln):
                tbd_total += 1
    print(f"dòng chứa TBD/BLOCKED/TARGET-PENDING: {tbd_total}")

    # 7. code-span paths that look like repo files but do not exist
    print("\n=== 7. Đường dẫn tài liệu trong code span ===")
    # Chỉ kiểm đường dẫn tài liệu: `docs/**`. Đường dẫn `apps/**`, `firmware/**`,
    # `contracts/**` trong hồ sơ thiết kế là **Source Target sẽ tạo**, chưa tồn
    # tại là đúng — xem quy tắc "Source target là vị trí phải tạo/sửa" ở
    # TRACE-PROG-001 §6.
    SPAN_RE = re.compile(r"`(docs/[^`\s]+\.(?:md|json|yaml|yml|sha256))`")
    extra_scan = files + [os.path.join(REPO, x) for x in (
        "docs/CHUONG_YEU_CAU/PROGRAMMING_UI_UX_UC_DESIGN_MK-DDC-24.md",
        "docs/CHUONG_YEU_CAU/PROGRAMMING_PRODUCT_SPEC_MK-DDC-24.md",
        "docs/01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md",
        "docs/07_records/reviews/PROGRAMMING_DESIGN_SET_REVIEW_2026-08-09.md",
    )]
    span_missing = 0
    for full in extra_scan:
        if not os.path.isfile(full):
            continue
        rel = os.path.relpath(full, REPO)
        for i, ln in enumerate(open(full, encoding="utf-8").read().split("\n"), 1):
            for hit in SPAN_RE.findall(ln):
                if not os.path.exists(os.path.join(REPO, hit)):
                    span_missing += 1
                    problems["span"].append(f"{rel}:{i} -> {hit}")
    print(f"code-span docs/** không tồn tại: {span_missing}")
    for item in problems["span"][:20]:
        print(f"  {item}")

    # Phép kiểm 9 — metadata đầu hồ sơ phải khớp dòng lịch sử mới nhất.
    print("\n=== 8. Metadata vs bảng Lịch sử sửa đổi ===")
    meta_revision_hits = scan_meta_revision()
    problems["meta_revision"] = meta_revision_hits
    print(f"hồ sơ lệch metadata/lịch sử: {len(meta_revision_hits)}")
    for item in meta_revision_hits[:20]:
        print(f"  {item}")

    if "-v" in sys.argv:
        print("\n=== chi tiết ===")
        for k in ("link", "docs_link", "anchor", "ws", "span", "meta_revision"):
            for item in problems[k][:200]:
                print(f"  [{k}] {item}")

    # ---- kết luận ----
    actual = {
        "baseline_files": len(BASELINE) - len(missing_files),
        "support_files": len(EXTRA) - len(missing_extra),
        "link_missing": link_missing,
        "docs_link_missing": len(docs_link_hits),
        "anchor_missing": anchor_missing,
        "trailing_ws": trailing_ws,
        "fence_bad": len(fence_bad),
        "duplicate_doc_id": len(dups),
        "span_missing": span_missing,
        "meta_revision_drift": len(meta_revision_hits),
        "srs_requirements": len(srs_ids),
        "trace_rows": len(rows),
        "trace_violations": len(bad),
        "vs_prog": len(vs_vvp),
        "rsk_prog": len(rsk),
        "od_prog": len(od),
        "uc_prog": len(uc),
        "uj_prog": len(sorted(set(uj_re.findall(ux_txt)))),
        "ux_req": len(uxr),
        "programming_visual_assets": len(programming_visual_assets),
    }

    # Vi phạm bắt buộc: các phép kiểm phải bằng 0 hoặc đủ file baseline.
    hard = []
    if actual["baseline_files"] != EXPECT["baseline_files"]:
        hard.append("thiếu file baseline")
    if actual["support_files"] != EXPECT["support_files"]:
        hard.append("thiếu file hỗ trợ Programming")
    for k in ("link_missing", "docs_link_missing", "anchor_missing", "trailing_ws",
              "fence_bad", "duplicate_doc_id", "span_missing", "trace_violations",
              "meta_revision_drift"):
        if actual[k] != 0:
            hard.append(f"{k}={actual[k]}")

    print("\n=== KẾT LUẬN ===")
    if hard:
        print("FAIL — vi phạm bắt buộc: " + ", ".join(hard))
    else:
        print("PASS — mọi phép kiểm bắt buộc đạt")

    drift = []
    if "--expect" in sys.argv:
        for k, v in EXPECT.items():
            if actual.get(k) != v:
                drift.append(f"{k}: kỳ vọng {v}, thực tế {actual.get(k)}")
        if drift:
            print("DRIFT so với EXPECT:")
            for d in drift:
                print(f"  {d}")
            print("  → Nếu thay đổi là có chủ đích, cập nhật EXPECT trong script")
            print("    **cùng lúc** với hồ sơ, không cập nhật sau.")
        else:
            print("EXPECT: khớp toàn bộ ngưỡng")

    return 1 if (hard or drift) else 0


if __name__ == "__main__":
    sys.exit(main())
