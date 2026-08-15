# Programming Document Readiness Matrix

**ID:** PROG-DRM-001
**Phiên bản:** 1.0
**Trạng thái:** Active — Document Gate cho `56_PROGRAMMING_IMPLEMENTATION_MASTER_PLAN_2026Q3.md`
**Chủ quản:** System Engineering (agent kỹ thuật, theo lệnh CTO/Owner 2026-08-15)
**Cập nhật:** 2026-08-15
**Nguồn lệnh:** Quyết định CTO/Owner 2026-08-15 §III (theo sau
[`PROGRAMMING_OVERVIEW_DESIGN_FEATURE_GAP_REPORT_2026-08-15.md`](../07_records/reviews/PROGRAMMING_OVERVIEW_DESIGN_FEATURE_GAP_REPORT_2026-08-15.md))

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| File này dùng để làm gì? | Kiểm kê 14 tài liệu CTO/Owner yêu cầu (§III mục 3 của lệnh triển khai) trước khi cho phép code Phase 1+ của Master Plan. Đây là Document Gate, không phải Design/Implementation Plan. |
| Kết luận chính? | 9/14 hạng mục có tài liệu Active/current, khớp source đủ để dùng ngay. 3/14 **THIẾU HẲN** (chưa từng tồn tại). 1/14 có **hai bản mâu thuẫn thẩm quyền** (Product Spec Rev A Active vs candidate V2.2 Hybrid chưa duyệt) — tự nó là một quyết định treo, không phải lỗi tài liệu. 1/14 tên gọi CTO dùng không khớp tên file thật nhưng nội dung đã có. |
| Gate mở khi nào? | `DOC_READY = YES` theo Master Plan Phase 0 khi: (a) 3 tài liệu thiếu được tạo tối thiểu ở mức khung (không cần đầy đủ nội dung để mở Phase 1 các WP không phụ thuộc chúng — xem cột "Chặn WP nào"), và (b) PM/CTO chọn một trong hai Product Spec làm authority. |

---

## 1. Bảng kiểm kê 14 tài liệu

| # | Document (tên CTO dùng) | File thật trong repo | Trạng thái hiện tại | Khớp source? | Owner | Hành động cần | Chặn WP nào |
|---|---|---|---|---|---|---|---|
| 1 | `PROGRAMMING_PRODUCT_SPEC` | [`docs/01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md`](../01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md) (`PROD-PROG-001` Rev A, **Active**) **+** [`PROGRAMMING_PRODUCT_SPEC_V2.2_HYBRID.md`](../01_product/PROGRAMMING_PRODUCT_SPEC_V2.2_HYBRID.md) (candidate, **In Review — READY FOR PM/CTO REVIEW**, tự ghi rõ "không supersede bản Active trước khi có phê duyệt") | **Hai bản, một authority + một candidate treo** | Rev A khớp source hiện hành; V2.2 Hybrid là đề xuất mở rộng chưa quyết | Product Owner | PM/CTO chọn: giữ Rev A, duyệt V2.2 Hybrid thành Rev B, hay yêu cầu sửa thêm. Không phải lỗi tài liệu — đây là quyết định còn treo từ trước phiên này, ghi lại ở đây để không mất dấu | `WP-MULTIPROGRAM-ARCH` (multi-Program có thể là nội dung chính của V2.2 Hybrid — cần biết trước khi viết Target Architecture) |
| 2 | `PROGRAMMING_BUSINESS_CORE_SPEC` | **Không tìm thấy file nào khớp tên hoặc nội dung này** | **MISSING** | — | Product | Tạo mới hoặc xác nhận với Product Owner rằng nội dung này đã nằm rải rác trong Product Spec (#1) + `PROGRAMMING_CONTROL_SEMANTICS.md` và không cần file riêng | Không chặn WP-01..04 (đã làm xong dựa trên gap report + source). Nên có trước `WP-MULTIPROGRAM-ARCH` |
| 3 | `PROGRAMMING_USE_CASE_SPEC` | Không có file độc lập; 17 use case (`UC-PROG-01..17`) nằm trong [`PROGRAMMING_UI_UX_DESIGN.md`](../04_uiux/PROGRAMMING_UI_UX_DESIGN.md) §17 | **MISSING như tài liệu riêng, nhưng nội dung đã có nơi khác** | Khớp — UC-PROG-01..17 đã dùng xuyên suốt các báo cáo audit | UX + Product | Xác nhận với Product Owner: giữ UC trong UI/UX Design (hiện trạng) hay tách file riêng theo đúng tên CTO liệt kê. Không có tác động kỹ thuật nếu giữ nguyên | Không chặn |
| 4 | `PROGRAMMING_UI_UX_DESIGN` | [`docs/04_uiux/PROGRAMMING_UI_UX_DESIGN.md`](../04_uiux/PROGRAMMING_UI_UX_DESIGN.md) (`UX-WEB-PROG-001`) | Current, dùng làm authority cho WP-01/WP-02/WP-11 | Khớp phần lớn; §16.2 layout 3 cột vẫn chưa khớp as-built (G-7, biết trước, WP-11 xử lý) | UX Lead | Không cần sửa trước Phase 1; WP-11 (Phase 3) sẽ đối chiếu lại khi làm layout | Không chặn WP-01..04; WP-11 cần đọc kỹ trước khi code |
| 5 | `PROGRAMMING_FE_DESIGN` | [`docs/02_design/software/PROGRAMMING_FE_DESIGN.md`](../02_design/software/PROGRAMMING_FE_DESIGN.md) (`DDD-FE-PROG-001`) | Current | Khớp — đã dùng làm authority cho gap report gốc | FE Lead | Không cần sửa trước Phase 1 | Không chặn |
| 6 | `FBD_EDITOR_DESIGN` | [`docs/02_design/software/FBD_EDITOR_DESIGN.md`](../02_design/software/FBD_EDITOR_DESIGN.md) (`DDD-FBD-EDITOR-PROG-001`, Rev 1.0) | **Tạo mới 2026-08-15** | Khớp — palette 9 nhóm + node giao diện + Inspector đối chiếu trực tiếp `kFuncs[]`/`binop_from_type_ref` trong `st_fbd_compile.cpp`, `st_program.cpp` | UX + FE | Đã xong. Gate #6 **mở** | Không còn chặn WP-05, WP-06, WP-07 |
| 7 | `FBD_LIBRARY_REGISTRY_SPEC` | **Không tồn tại — đây chính là gap kỹ thuật đã tìm thấy ở G-5** (registry hàm khai tay hai nơi độc lập, FE `model.ts` và C++ `st_program.cpp`, từng lệch nhau) | **MISSING**, xác nhận đúng như gap report dự đoán | WP-03 đã vá lệch bằng tay (bỏ SCALE/DEADBAND/CTU/PI, thêm SQRT) nhưng đây là **bản vá tạm**, không phải nguồn sự thật chung | Compiler + FE Lead | Thiết kế một registry sinh mã dùng chung (generator đọc từ một nguồn, xuất cả TS lẫn C++ constant, tương tự cách `contracts/programming/error_catalog_v1.json` đã làm cho error code) | **Chặn WP-05 nếu muốn tránh vá tay lần hai khi thêm block palette** — có thể làm WP-05 trước với danh sách hiện tại (đã đúng) rồi làm registry chung song song, không bắt buộc phải xong trước |
| 8 | `ST_SUBSET_SPEC` | [`docs/02_design/software/ST_SUBSET_SPEC_MK-DDC-24_VI.md`](../02_design/software/ST_SUBSET_SPEC_MK-DDC-24_VI.md) | **Đã đồng bộ trong phiên này (WP-04, Rev 1.0→1.1)** | Khớp source sau khi sửa (DINT/UINT/PID, INT=int16) | Compiler Lead | Đã xong. Cần Test Result/V&V chính thức cho DINT/UINT (không chặn Phase 1) | Không chặn |
| 9 | `PROGRAMMING_LANGUAGE_COMPILER_DESIGN` | [`docs/02_design/software/PROGRAMMING_LANGUAGE_COMPILER_DESIGN.md`](../02_design/software/PROGRAMMING_LANGUAGE_COMPILER_DESIGN.md) (`DDD-LANG-PROG-001`) | **Đã đồng bộ trong phiên này (WP-04, Rev 0.8→0.9)** | Khớp source sau khi sửa (PID "target"→"Implemented") | Compiler + Controls Lead | Đã xong phần đồng bộ tài liệu. Blocker "Unit/conversion/PID semantic chưa khóa" (Controls+Safety review) giữ nguyên, chưa đóng | Không chặn Phase 0/1. Chặn việc **công bố PID production-ready** |
| 10 | `API_DATA_CONTRACT_SPEC` | [`contracts/openapi/openapi.yaml`](../../contracts/openapi/openapi.yaml) + [`docs/02_design/interfaces/PROGRAMMING_INTERFACE_SPEC.md`](../02_design/interfaces/PROGRAMMING_INTERFACE_SPEC.md) (`IFSPEC-PROG-001`, v1.9) | Current; OpenAPI cập nhật trong phiên này (thêm `ProgrammingProject.latestCheck`, WP-01) | Khớp | BE + Compiler Lead | Không cần sửa thêm trước Phase 1. Đồng bộ lại phần Monitor/Trace nếu có thay đổi tương lai | Không chặn |
| 11 | `PROGRAMMING_RUNTIME_INTERFACE_SPEC` | Tên gần nhất trong repo: [`docs/02_design/software/PROGRAMMING_RUNTIME_LIFECYCLE_DESIGN.md`](../02_design/software/PROGRAMMING_RUNTIME_LIFECYCLE_DESIGN.md) (`DDD-RUNTIME-PROG-001`, Rev 0.6) | Tên khác CTO liệt kê nhưng nội dung tương ứng (lifecycle + interface Core↔BE) | Khớp phần lớn; target/HIL/power-cut còn mở (đã biết, ngoài phạm vi Document Gate) | Runtime Architect | Xác nhận với CTO đây đúng là tài liệu được nhắc tới trong lệnh (khác tên) — không tạo trùng lặp | Không chặn |
| 12 | `SECURITY_RBAC_AUDIT_SPEC` | [`docs/02_design/software/PROGRAMMING_SECURITY_DESIGN.md`](../02_design/software/PROGRAMMING_SECURITY_DESIGN.md) (Rev 0.6, **M3 — Review Ready**) **+** [`PROGRAMMING_ARTIFACT_TRUST_SECURITY_DESIGN.md`](../02_design/software/PROGRAMMING_ARTIFACT_TRUST_SECURITY_DESIGN.md) (**mới, Rev 1.0, Draft**) | Current + phần Artifact Trust **đã tạo** | Khớp RBAC 2-mức (Viewer/Admin) xác nhận ở gap report §4; Artifact Trust mới đối chiếu trực tiếp `st_loader.cpp`/`st_ir.cpp`/`st_public_key.hpp` (C++) và `runner.go` (Go) — phát hiện crypto sign+verify Ed25519 đã có sẵn cả hai chiều, khoảng thiếu thật là quy trình ký/custody khoá, không phải code | Security + Controls | Đã viết Draft. **Còn cần:** Security Architecture review + duyệt trước khi bật `integrityMode=SIGNED` (exit criteria WP-13 tự đặt) — chưa APPROVED FOR IMPLEMENTATION. TLS production cũng còn chặn mutation theo trạng thái hiện tại — cần xác nhận đã đóng hay còn mở trước Phase 4 | Gate #12 **mở** (tài liệu tồn tại) — WP-13 vẫn `DESIGN`, chưa `IMPLEMENTING` (chờ duyệt) |
| 13 | `REQUIREMENT_TRACEABILITY_MATRIX` | [`docs/07_records/PROGRAMMING_TRACEABILITY_MATRIX.md`](../07_records/PROGRAMMING_TRACEABILITY_MATRIX.md) (Rev 3.21, **APPROVED FOR IMPLEMENTATION**) | Current | Khớp tại thời điểm Rev 3.21; **chưa có dòng cho WP-01..13/`WP-MULTIPROGRAM-ARCH` mới** (bình thường, các WP này mới phát sinh hôm nay) | Verification Lead | Thêm dòng traceability cho từng WP khi WP đó chuyển `READY_TO_IMPLEMENT` — không làm ngay cho toàn bộ 14 WP cùng lúc, tránh mục rỗng vô nghĩa | Không chặn Phase 0/1; **chặn việc đóng bất kỳ WP nào thành DONE** (DoD yêu cầu truy vết được — xem Master Plan §IX) |
| 14 | `V_AND_V_ACCEPTANCE_TEST_SPEC` | [`docs/05_verification/PROGRAMMING_VERIFICATION_PLAN.md`](../05_verification/PROGRAMMING_VERIFICATION_PLAN.md) (`VVP-PROG-001`, Rev 1.9, **APPROVED FOR IMPLEMENTATION**) | Current | Khớp 32 kịch bản baseline; **chưa có kịch bản riêng cho G-1..G-10** (Overview state, FBD palette, v.v. — tất cả là finding mới 2026-08-15) | Verification Lead | Thêm kịch bản V&V cho từng WP khi WP đó vào `TESTING` — cùng nhịp với REQUIREMENT_TRACEABILITY_MATRIX | Không chặn Phase 0/1; **chặn `RELEASE_READY`** (đã BLOCKED sẵn từ trước, không đổi) |

---

## 2. Tổng hợp Document Gate

| Chỉ số | Giá trị |
|---|---|
| Current + khớp source, không cần sửa | #4, #5, #10 (3/14) |
| Đã đồng bộ **trong phiên này** (WP-04) | #8, #9 (2/14) |
| **Tạo mới trong phiên này** (mở Gate #6) | #6 (1/14) |
| Current nhưng có ghi chú/khoảng hở nhỏ | #11, #13, #14 (3/14) |
| **Mở rộng trong phiên này** (mở Gate #12) | #12 (1/14) |
| MISSING hẳn | #2, #3, #7 (3/14) |
| Mâu thuẫn thẩm quyền (2 bản) | #1 (1/14) |

**`DOC_READY` cho Phase 1 (WP-01..04): YES.** Không mục nào trong 4 WP đã triển khai
phụ thuộc tài liệu MISSING — WP-01..04 dùng trực tiếp source + gap report +
hai tài liệu đã đồng bộ (#8, #9) làm authority, đúng nguyên tắc "nếu WP chưa
có đủ requirement/design thì tự tạo/cập nhật tài liệu đó trước" (đã làm ở
WP-04) trước khi code (đã làm ở WP-01..03).

**`DOC_READY` cho Phase 2 (WP-05..09, FBD end-to-end): YES cho WP-05/06/07.**
#6 (`FBD_EDITOR_DESIGN`) đã tạo và đối chiếu source — Gate mở. #7
(`FBD_LIBRARY_REGISTRY_SPEC`, registry sinh mã dùng chung) vẫn MISSING nhưng
Master Plan đã ghi rõ không bắt buộc xong trước WP-05 (palette dùng danh sách
tay hiện tại, đã đúng theo WP-03) — có thể làm registry chung song song, không
chặn. WP-08/WP-09 vẫn `BLOCKED` chờ WP-06/WP-05..08 hoàn tất theo đúng chuỗi
phụ thuộc trong Tracker.

**`DOC_READY` cho Phase 4 WP-13 (Artifact Trust): Gate #12 đã mở** (đã viết
`PROGRAMMING_ARTIFACT_TRUST_SECURITY_DESIGN.md`), nhưng WP-13 vẫn không
được implement — exit criteria WP-13 tự đặt yêu cầu **Security Architecture
review và duyệt** tài liệu này trước khi bật `integrityMode=SIGNED` cho bất
kỳ target nào. Document Gate và Implementation Gate là hai cổng khác nhau ở
đây; mở Gate #12 chỉ giải quyết "tài liệu có tồn tại", không thay thế bước
duyệt bảo mật.

**`DOC_READY` cho `WP-MULTIPROGRAM-ARCH`: NO.** Chặn bởi #1 (PM/CTO chưa
chọn Product Spec authority — ảnh hưởng trực tiếp phạm vi kiến trúc đa
Program) và cần #2 nếu Product Owner quyết định tách file riêng.

---

## 3. Lịch sử sửa đổi

| Revision | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-08-15 | Tạo mới theo lệnh CTO/Owner §III. Kiểm kê 14 tài liệu: 9 current/đã đồng bộ, 4 MISSING, 1 mâu thuẫn thẩm quyền. `DOC_READY=YES` cho Phase 1, `NO` cho Phase 2/WP-13/WP-MULTIPROGRAM-ARCH. |
| 1.1 | 2026-08-15 | #6 `FBD_EDITOR_DESIGN` tạo mới (Rev 1.0) — Gate #6 mở. `DOC_READY=YES` cho WP-05/06/07. |
| 1.2 | 2026-08-15 | #12 mở rộng: `PROGRAMMING_ARTIFACT_TRUST_SECURITY_DESIGN.md` tạo mới (Rev 1.0, Draft) — Document Gate #12 mở, nhưng Implementation Gate WP-13 vẫn đóng (chờ Security Architecture duyệt). |
