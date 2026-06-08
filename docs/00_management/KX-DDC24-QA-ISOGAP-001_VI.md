# ISO Document-Control Gap Assessment & Restructure Plan — MK-DDC-24

> **Document ID:** KX-DDC24-QA-ISOGAP-001
> **Phiên bản:** 1.0 | 2026-06-08 · **Trạng thái:** Approved (Owner 2026-06-08) (chờ duyệt approach) · **Owner:** QA / Doc Control
> 📘 [docs/README](../README.md) · Liên quan: [QA-DOCCTRL](KX-DDC24-QA-DOCCTRL-001_VI.md) · [QA-REGISTER](KX-DDC24-QA-REGISTER-001_VI.md) · [QA-TRACE](KX-DDC24-QA-TRACE-001_VI.md)

> 🎯 Trả lời thẳng câu hỏi: *"Cấu trúc lộn xộn vậy mà đạt ISO?"* — **Chưa đạt.** Repo mới ở mức
> "ISO-aligned một phần" (có khung), chưa phải "certified". Doc này nêu gap theo điều khoản
> ISO 9001:2015 §7.5 / IEC 62443-4-1, và kế hoạch dọn 1 lần có kiểm soát.

---

## 1. Kết luận

Repo **có bộ khung** kiểm soát tài liệu (Master Register, Doc-Control procedure, Trace
matrix, doc-ID, version/status, ADR) → *nhìn* giống ISO. Nhưng ISO đánh giá **process được
thực thi nhất quán**, và hiện đang lủng ở nhiều điểm đo được → một auditor sẽ ghi **major +
minor nonconformity**, **chưa pass certification**.

## 2. Hiện trạng (đo được 2026-06-08)

- **179 file `.md`** rải trên **4+ cây song song**: `./`(6) · `spec/`(12) · `design/`(27:
  software 11 + interfaces 5 + firmware 9 + 2) · `docs/`(23) · `hardware-design/`(nhiều).
- **2 hệ định danh song song:** Kiểu A `PRD_MK-DDC-24_VI.md` (root/spec/design) vs Kiểu B
  `KX-DDC24-PM-GOAL-001_VI.md` (docs/, có doc-ID ISO).
- **Master Register thiếu:** `PRODUCT_DEFINITION`, `REVA_SCOPE_ROADMAP`, `GRAPH_SCHEMA`,
  toàn bộ **ADR-004..007** chưa đăng ký.
- **Status:** 53 Draft vs 34 Approved — nhiều Draft đang được trỏ như "nguồn-chuẩn".
- **Link rot:** vừa phải sửa 77 broken link (đợt dọn 2026-06-08).

## 3. Gap theo điều khoản

| # | Nonconformity | Bằng chứng | Clause | Mức |
|---|---------------|-----------|--------|-----|
| G1 | Định danh không nhất quán (2 scheme) | Kiểu A vs Kiểu B | ISO 9001 §7.5.2 | **Major** |
| G2 | Master list không đầy đủ | 5 doc pivot + ADR thiếu trong Register | §7.5.3 | **Major** |
| G3 | Tài liệu cùng loại rải nhiều nơi, khó truy xuất | root+spec+design chồng vai trò | §7.5.3 | Minor |
| G4 | Tài liệu không "available/suitable" | 77 broken link | §7.5.3 | Minor |
| G5 | Review/approval chưa đóng | 60% Draft, không có ngày duyệt/chữ ký | §7.5.2 | Minor |
| G6 | Định danh nội dung không nhất quán | `kinexus-*` vs `mkddc-*`, doc SUPERSEDED trộn lẫn | §7.5.2 | Minor (đang dọn) |

## 4. Gốc rễ

Repo trộn **2 triết lý không có chủ thống nhất**: (a) bộ *engineering* (`spec/`+`design/`+root,
Kiểu A) và (b) bộ *ISO management* (`docs/`, Kiểu B). Register chỉ quản nửa (b) + một phần (a)
→ link chéo giữa 2 bộ dễ gãy, định danh phân mảnh.

## 5. Cấu trúc đích đề xuất (lifecycle-based, 1 cây)

```
docs/
  00_management/   PM, QA, SEC, evidence, adr        (giữ)
  01_specs/        requirements + architecture       ← từ root (PRD/SRS/DS/HW_SPEC) + spec/
                   (PRD, SRS, DS, HW_SPEC, PRODUCT_DEFINITION, REVA_SCOPE,
                    SW_ARCH, FW_ARCH, SW_REQUIREMENTS, FW_REQUIREMENTS,
                    SWFW_INTERFACE, DESIGN_PLAN, DESIGN_READINESS, OPEN_ISSUES, TEST_SPEC)
  02_design/       software/ firmware/ interfaces/ _templates/  ← từ design/
  03_manuals/      (giữ)
  04_uiux/         (giữ)
  05_implementation/ (giữ)
  adr/             ADR-001..00n                      (giữ)
hardware-design/   domain phần cứng riêng           (giữ — không gộp)
shared/            hợp đồng code (header)            (giữ — là contract)
```

> Dùng `01_specs/` + `02_design/` (không `01_product/02_architecture/03_design`) để **tránh đụng
> số** với `03_manuals/04_uiux/05_implementation` đã tồn tại trong `docs/`. Root chỉ còn
> `README.md` + `CHANGELOG.md` (trỏ vào `docs/`).

## 6. Quyết định định danh (cần chốt)

**Đề xuất:** mọi tài liệu (kể cả root/spec/design + ADR) mang **doc-ID `KX-DDC24-<DOMAIN>-NNN`**
trong header + được đăng ký trong Master Register. Tên file có thể giữ để tránh gãy git-history,
nhưng **Register là nguồn-chuẩn ánh xạ ID ↔ path**.

## 7. Hai cách thực thi B (chọn 1 — đây là quyết định gốc)

| | **B-1: Unify qua Register (low-risk)** | **B-2: Reorg vật lý toàn bộ (high-risk)** |
|---|---|---|
| Làm gì | Giữ nguyên file/đường dẫn; bổ sung doc-ID header; **Register hóa 100%**; thêm INDEX điều hướng + broken-link CI gate | Di chuyển 179 file vào cây §5; đổi tên theo 1 scheme; **viết lại toàn bộ link** |
| Đóng gap | G2,G4,G5,G6 + G1 (qua ID nhất quán trong register) | Đóng tất cả G1–G6 triệt để |
| Rủi ro | Thấp — không gãy link, giữ git-blame | **Cao** — đụng mọi path/link, mất git-blame, external bookmark gãy |
| Công sức | ~1 buổi | Lớn, nhiều vòng verify |
| ISO | Đủ pass phần "identification + controlled list" (ISO chấp nhận register làm SSOT) | "Đẹp" về cây thư mục, nhưng ISO **không bắt buộc** cây thư mục đẹp |

> ⚠️ **Lưu ý ISO:** §7.5 KHÔNG yêu cầu cây thư mục gọn — nó yêu cầu **định danh nhất quán +
> danh mục kiểm soát đầy đủ + truy xuất được**. B-1 đủ để đóng các nonconformity chính. B-2 là
> cải thiện về *tổ chức/ergonomics*, không phải điều kiện cần của ISO.

## 8. Verify (gate sau khi làm)

1. Broken-link = 0 (script rà toàn repo — đã có).
2. Register cover 100% (mỗi `.md` có 1 dòng ID↔path, status đúng).
3. Mỗi doc có header chuẩn: ID, version, status, ngày duyệt.
4. CI thêm bước check link + check "file mới phải có trong Register".

## 9. Rollback

Mọi thay đổi qua git (branch riêng `chore/doc-restructure`). B-2: nếu hỏng, `git reset` về commit
pivot (`0200ed0`). Backup non-doc đã tách ngoài repo.
