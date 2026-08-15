# Programming Implementation Tracker

**Companion của:** [Plan 56 — Programming Implementation Master Plan 2026 Q3](56_PROGRAMMING_IMPLEMENTATION_MASTER_PLAN_2026Q3.md)
**Cập nhật lần cuối:** 2026-08-15 (phiên tạo — cập nhật sau mỗi iteration theo §XI.F Lệnh CTO/Owner)

Trạng thái chuẩn: `NOT_STARTED` · `DOC_REQUIRED` · `DESIGN` · `READY_TO_IMPLEMENT` ·
`IMPLEMENTING` · `CODE_REVIEW` · `TESTING` · `EVIDENCE_REQUIRED` · `DONE` · `BLOCKED`.
**Không WP nào được chuyển `IMPLEMENTING` nếu Requirement + Design + Acceptance
Criteria chưa `READY`.**

## 1. Bảng theo dõi WP

| WP | Requirement | Design | FE | BE | FW | Test | Evidence | Status | Owner | Blocker |
|---|---|---|---|---|---|---|---|---|---|---|
| WP-01 Overview State Model | READY (gap report §5.2) | READY (Master Plan §4) | DONE | DONE | N/A | PARTIAL — 4 FE test mới PASS, **BE unit test cho `GetLatestCheckForRevision` chưa viết** | Vitest PASS (xem báo cáo A-F); `go build`/`go vet` PASS; **thiếu `go test` cho path mới** | `EVIDENCE_REQUIRED` | FE + BE | Cần bổ sung `store`/`application` Go test trước khi đóng `DONE` thật sự |
| WP-02 Unsupported POU Guard | READY (gap report §7.4) | READY (Master Plan §4) | DONE | N/A | N/A | **Chưa có** — `ProgramInspector` không có test file từ trước | `tsc --noEmit`/lint PASS; đọc code xác nhận dropdown 1 lựa chọn | `EVIDENCE_REQUIRED` | FE | Thiếu test hồi quy — không có gì ngăn ai đó vô tình thêm lại option cũ |
| WP-03 FBD Registry Alignment | READY (gap report §8.4) | READY (Master Plan §4) | DONE | N/A (BE không đổi, FW là nguồn đối chiếu) | N/A | Phủ bởi test model/commands hiện có, không có test riêng cho việc bỏ 4 identifier | Vitest FBD suite PASS | `DONE` | FE + Compiler | Không — nhưng registry vẫn là bản vá tay, xem WP tương lai gắn với Document Gate #7 |
| WP-04 Language Documentation Alignment | READY | N/A (chính là design) | N/A | N/A | N/A | N/A (thay đổi tài liệu) | Diff 2 file + đối chiếu source trực tiếp | `DONE` | Compiler Lead | Không |
| WP-05 FBD Palette | DOC_REQUIRED | NOT_STARTED | NOT_STARTED | N/A | N/A | NOT_STARTED | — | `BLOCKED` | UX + FE | Document Gate #6 (`FBD_EDITOR_DESIGN` chưa tồn tại) |
| WP-06 INPUT/OUTPUT/CONSTANT | DOC_REQUIRED | NOT_STARTED | NOT_STARTED | N/A | N/A | NOT_STARTED | — | `BLOCKED` | UX + FE | Document Gate #6 |
| WP-07 FBD Inspector | DOC_REQUIRED | NOT_STARTED | NOT_STARTED | N/A | N/A | NOT_STARTED | — | `BLOCKED` | UX + FE | Document Gate #6 |
| WP-08 FBD → Mapping Integration | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED | N/A | NOT_STARTED | — | `BLOCKED` | FE + BE | WP-06 chưa xong |
| WP-09 FBD Check/Commission/Runtime E2E | NOT_STARTED | N/A (verify, không build) | N/A | N/A | N/A | NOT_STARTED | — | `BLOCKED` | QA + FE + BE + Core | WP-05..08 chưa xong |
| WP-10 ST Editor Upgrade | DOC_REQUIRED | NOT_STARTED | NOT_STARTED | N/A | N/A | NOT_STARTED | — | `NOT_STARTED` | UX + FE | Cần Technical Selection Record trước Design |
| WP-11 PGM-02 3-column Layout | READY (`PROGRAMMING_UI_UX_DESIGN.md` §16.2 đã đủ) | NOT_STARTED | NOT_STARTED | N/A | N/A | NOT_STARTED | — | `DESIGN` | UX + FE | Không — có thể bắt đầu Design ngay |
| WP-12 RETAIN Reset | DOC_REQUIRED | NOT_STARTED | NOT_STARTED | NOT_STARTED | N/A | NOT_STARTED | — | `DOC_REQUIRED` | Core + BE + FE + Safety | Cần xác nhận business semantics/permission/audit trước Design |
| WP-13 Artifact Trust | DOC_REQUIRED | NOT_STARTED | N/A | NOT_STARTED | NOT_STARTED | NOT_STARTED | — | `BLOCKED` | Security + Compiler + BE | Document Gate #12 (`PROGRAMMING_ARTIFACT_TRUST_SECURITY_DESIGN` chưa tồn tại) |
| WP-MULTIPROGRAM-ARCH | DOC_REQUIRED | NOT_STARTED | N/A | N/A | N/A | N/A | — | `BLOCKED` | System Architect + Product + Runtime + Compiler + Core + Security | Document Gate #1 (PM/CTO chưa chọn Product Spec authority) |

## 2. Definition of Done — 15 mục (Lệnh CTO/Owner §XII)

| # | Tiêu chí | Trạng thái |
|---|---|---|
| 1 | Overview phản ánh đúng lifecycle state | **Đạt một phần** — 4/5 trạng thái khả thi đã cài (dirty/checking/failed/ready); `conflict` cố ý không cài, có lý do kỹ thuật ghi ở WP-01 |
| 2 | UI không expose capability backend không hỗ trợ | **Đạt một phần** — WP-02 đóng cho Program Kind; FBD palette (chưa tồn tại) nên chưa có gì để "expose sai" ở đó |
| 3 | FE/compiler FBD registry thống nhất | **Đạt tạm thời** — WP-03 vá tay khớp 1-1 tại thời điểm 2026-08-15; chưa có cơ chế tự động giữ đồng bộ (Document Gate #7) |
| 4 | FBD tạo được INPUT/OUTPUT/CONSTANT | Chưa đạt — WP-06 `BLOCKED` |
| 5 | FBD có block palette usable | Chưa đạt — WP-05 `BLOCKED` |
| 6 | FBD có Inspector cần thiết | Chưa đạt — WP-07 `BLOCKED` |
| 7 | FBD interface map được Point thật | Chưa đạt — WP-08 `BLOCKED` |
| 8 | FBD Check thật PASSED | Chưa đạt — WP-09 `BLOCKED` |
| 9 | FBD Commission thật thành công | Chưa đạt — WP-09 `BLOCKED` |
| 10 | Runtime quan sát được giá trị thật | Chưa đạt cho FBD (đã đạt cho ST theo D-07, ngoài phạm vi Master Plan này) |
| 11 | ST spec khớp implementation | **Đạt** — WP-04 DONE |
| 12 | PID có trạng thái approval rõ ràng | **Đạt về mặt tài liệu** — WP-04 ghi rõ "Implemented, chưa Controls+Safety review"; review thật **chưa xảy ra** |
| 13 | Requirement → Design → Code → Test → Evidence truy vết được | **Đạt một phần** — WP-01..04 truy vết được trong Master Plan/Tracker này; **chưa có dòng trong `PROGRAMMING_TRACEABILITY_MATRIX.md`** chính thức (Document Gate #13) |
| 14 | Master roadmap/tracker được cập nhật | **Đạt** — file này + Master Plan, tạo trong phiên này |
| 15 | Không còn finding High nào bị đóng mà thiếu E2E evidence | **Không vi phạm** — WP-01..04 đều mức Trung bình/Cao theo gap report nhưng đã đóng bằng vitest/go build thật, không tự nhận E2E; các gap Cao còn lại (G-2/G-3 FBD) **chưa đóng**, đúng thực tế |

**Kết luận tổng thể 2026-08-15:** Programming Overview/ST/FBD **CHƯA** đạt DoD
đầy đủ — đúng như kỳ vọng sau một phiên chỉ chạy hết Phase 0+1. Phase 2 (FBD
end-to-end, mục 4-10 DoD) là khối lượng công việc lớn nhất còn lại và bị
chặn Document Gate #6 một cách hợp lệ, không phải bị trì hoãn tuỳ tiện.

## 3. Iteration log

| Ngày | Hoàn thành | Đang làm | Blocked | Evidence | Tài liệu đã đổi | PR/commit | Regression | Bước kế tiếp |
|---|---|---|---|---|---|---|---|---|
| 2026-08-15 | Phase 0 (Document Gate) + Phase 1 (WP-01..04) | — | Phase 2 (WP-05..09) chờ Document Gate #6; WP-13 chờ #12; WP-MULTIPROGRAM-ARCH chờ #1 | Vitest FE PASS (xem báo cáo A-F mục B); `go build`/`go vet` PASS; BE Go test cho WP-01 **còn nợ** | `PROGRAMMING_DOCUMENT_READINESS_MATRIX.md` (mới), `56_PROGRAMMING_IMPLEMENTATION_MASTER_PLAN_2026Q3.md` (mới), file này (mới), `ST_SUBSET_SPEC_MK-DDC-24_VI.md` (1.0→1.1), `PROGRAMMING_LANGUAGE_COMPILER_DESIGN.md` (0.8→0.9), `openapi.yaml`, `model/types.ts`, `OverviewPage.tsx`(+test), `ProgramsTab.tsx`, `fbd/model.ts`, `checks.go`(store), `projects.go`(application), `projects.go`(http) | Chưa commit — chờ xác nhận theo quy trình "commit"/"merge" của dự án | Chưa chạy full `ctest`/`go test ./...`/Playwright toàn bộ trong phiên này — xem báo cáo A-F mục B để biết đúng phạm vi đã chạy | Viết BE Go test cho WP-01 (nợ kỹ thuật); UX Lead viết `FBD_EDITOR_DESIGN` để mở Document Gate #6; PM/CTO quyết Document Gate #1 (Product Spec authority) |
