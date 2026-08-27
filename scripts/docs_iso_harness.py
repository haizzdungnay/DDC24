#!/usr/bin/env python3
"""Harness kiểm chứng bộ hồ sơ Programming MK-DDC-24 — ISO-aligned document gate.

Chạy:
    python3 scripts/docs_iso_harness.py            # tóm tắt
    python3 scripts/docs_iso_harness.py -v         # kèm chi tiết từng vi phạm
    python3 scripts/docs_iso_harness.py --expect   # bật cả kiểm ngưỡng, dùng cho CI

Bảy phép kiểm:
  1. Toàn bộ authority baseline thống nhất tồn tại tại đúng đường dẫn chuẩn
  2. Liên kết Markdown nội bộ và anchor phải phân giải được
  3. Trailing whitespace = 0
  4. Code fence cân bằng
  5. Không trùng Document ID
  6. Đếm ID theo họ: requirement / VS-PROG / RSK / UC / UJ / UX-REQ / OD
  7. Bất biến ma trận trace: không có `P=Y khi T=N`, không có `R=Y khi P=N`
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
    "anchor_missing": 0,
    "trailing_ws": 0,
    "fence_bad": 0,
    "duplicate_doc_id": 0,
    "span_missing": 0,
    "srs_requirements": 89,
    "trace_rows": 89,
    "trace_violations": 0,
    "vs_prog": 47,
    "rsk_prog": 23,
    "od_prog": 15,
    "uc_prog": 17,
    "uj_prog": 8,
    "ux_req": 27,
    "svg_assets": 14,
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


def main():
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

    # SVG assets
    import glob as _g
    svgs = _g.glob(os.path.join(REPO, "docs/04_uiux/assets/programming/*.svg"))
    print(f"SVG asset: {len(svgs)}")

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

    if "-v" in sys.argv:
        print("\n=== chi tiết ===")
        for k in ("link", "anchor", "ws", "span"):
            for item in problems[k][:200]:
                print(f"  [{k}] {item}")

    # ---- kết luận ----
    actual = {
        "baseline_files": len(BASELINE) - len(missing_files),
        "support_files": len(EXTRA) - len(missing_extra),
        "link_missing": link_missing,
        "anchor_missing": anchor_missing,
        "trailing_ws": trailing_ws,
        "fence_bad": len(fence_bad),
        "duplicate_doc_id": len(dups),
        "span_missing": span_missing,
        "srs_requirements": len(srs_ids),
        "trace_rows": len(rows),
        "trace_violations": len(bad),
        "vs_prog": len(vs_vvp),
        "rsk_prog": len(rsk),
        "od_prog": len(od),
        "uc_prog": len(uc),
        "uj_prog": len(sorted(set(uj_re.findall(ux_txt)))),
        "ux_req": len(uxr),
        "svg_assets": len(svgs),
    }

    # Vi phạm bắt buộc: các phép kiểm phải bằng 0 hoặc đủ file baseline.
    hard = []
    if actual["baseline_files"] != EXPECT["baseline_files"]:
        hard.append("thiếu file baseline")
    if actual["support_files"] != EXPECT["support_files"]:
        hard.append("thiếu file hỗ trợ Programming")
    for k in ("link_missing", "anchor_missing", "trailing_ws", "fence_bad",
              "duplicate_doc_id", "span_missing", "trace_violations"):
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
