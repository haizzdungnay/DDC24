# Quyết định — IEC 61131-3 Program/SOM FW

**Document ID:** KX-DDC24-DECISION-REQUEST-IEC61131-PROGRAM-SOM-FW-001
**Trạng thái:** **Decided/Closed** — CTO/Project Engineering Owner đã trả lời toàn bộ Q0–Q9
ngày 2026-07-23. Downstream doc update đang thực hiện (xem §"Theo dõi thực thi" cuối file).
**Người quyết định:** Phạm Đình Chương — Project Engineering Owner / CTO
**Ngày quyết định:** 2026-07-23
**Ngày tạo:** 2026-07-23
**Nguồn câu hỏi:** [`KX-DDC24-PROGRAM-SOM-FW-DESIGN-DOC-REVIEW-2026-07-23.md`](KX-DDC24-PROGRAM-SOM-FW-DESIGN-DOC-REVIEW-2026-07-23.md)
(mục 3, 5) và [`PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md`](../../02_design/PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md)
mục 15 (RD-IEC-001..007) + mục 12.1 (sizing).
**Quyết định đóng gói thành ADR:** [`ADR-018-mekong-owned-iec-aligned-program-runtime.md`](../../adr/ADR-018-mekong-owned-iec-aligned-program-runtime.md)

---

## Q0 — Directive bắt buộc IEC trong Rev A.0 (P0, chặn tất cả câu còn lại)

**Vấn đề (DOC-REV-001):** directive "bắt buộc IEC ngay trong Rev A.0" trong bản thiết kế
v0.2/0.3 không có decision record truy vết được, và mâu thuẫn với khuyến nghị của gap
assessment cùng ngày (giữ Rev A component-based, đẩy IEC sang Rev C).

- [x] **A — Directive có thật.**
  - Người ban hành: **Phạm Đình Chương**
  - Ngày: **2026-07-23**
  - Lý do override gap assessment: Mekong quyết định phát triển và sở hữu Program
    Runtime của MK-DDC, không dùng runtime IEC 61131-3 thương mại hoặc mã nguồn mở bên
    ngoài làm nền tảng chính sản phẩm, vì MK-DDC có kiến trúc riêng (thiết bị vừa là DDC
    controller vừa là web server; lập trình/cấu hình/giám sát qua trình duyệt; Program
    Runtime phải tích hợp trực tiếp I/O Manager, Virtual Variable, Tag Mapping, Alarm,
    Trend, Scheduler, Permission, Audit và hệ thống triển khai chương trình riêng của
    Mekong) và Mekong phải kiểm soát hoàn toàn định dạng chương trình, runtime,
    lifecycle, license, roadmap, khả năng mở rộng — không chấp nhận phụ thuộc runtime
    license/API/tool/roadmap của bên thứ ba. Gap assessment vẫn có giá trị cảnh báo
    effort/rủi ro nhưng không còn là kết luận kiến trúc cuối cùng.

**Trả lời:** Xác nhận directive có thật. Directive chính thức: *"Rev A.0 phải hình thành
nền tảng Program Runtime tương thích định hướng IEC 61131-3 do Mekong sở hữu. Phạm vi
Rev A phải thu hẹp thành một MVP triển khai được, không làm toàn bộ bốn ngôn ngữ và toàn
bộ chức năng PLC thương mại ngay trong một release."* → ghi thành ADR-018, ADR-004 chuyển
`Superseded by ADR-018`.

---

## Q1 (RD-IEC-001) — IEC 61131-3 có bắt buộc trong Rev A.0 không?

Đề xuất bản 0.3: Có — management directive, không defer.

- [x] **Modify:** IEC 61131-3-aligned là định hướng kiến trúc **bắt buộc**, nhưng Rev A.0
  chỉ triển khai một **tập con xác định rõ** (không phải toàn bộ 4 ngôn ngữ/toàn bộ
  feature PLC thương mại). Không quảng cáo "hỗ trợ đầy đủ IEC 61131-3", không claim
  certified. Release gate Rev A.0 = Program model + typed variable model + deterministic
  task execution + ST + FBD + standard function/FB nền tảng + build/validate/deploy/
  activate/run/diagnose + tích hợp I/O, tag, virtual variable, alarm, audit, permission.

---

## Q2 (RD-IEC-002) — Language scope nào?

Đề xuất bản 0.3: ST + LD + FBD + SFC trong cùng semantic/runtime.

- [x] **Modify:** Rev A.0 chỉ **ST** (ngôn ngữ chính, bắt buộc) và **FBD** (ngôn ngữ đồ
  họa chính trên Web IDE, bắt buộc). **LD và SFC không triển khai trong Rev A.0.** ST và
  FBD dùng chung type system, variable model, function/FB registry, semantic validation,
  IR, task scheduler, runtime execution model. IR và Program Schema phải mở rộng được cho
  LD/SFC sau này nhưng LD/SFC không nằm trong release gate Rev A.0.

---

## Q3 (RD-IEC-003) — Component graph 28-node hiện tại xử lý thế nào?

Đề xuất bản 0.3: Legacy/importer + nguồn vendor FB; không gọi là FBD.

- [x] **Approve.** Giữ làm legacy program importer, compatibility layer, nguồn chuyển
  đổi sang vendor function block `MKDDC_*`, và dữ liệu migration cho chương trình đã tồn
  tại. Không gọi component graph hiện tại là IEC FBD. Chương trình component-based muốn
  chạy trên runtime mới phải qua importer/translator có version để chuyển sang typed IR.

---

## Q4 (RD-IEC-004) — Runtime architecture nào?

Đề xuất bản 0.3: Typed deterministic IR interpreter trong Core; compiler library/CLI
versioned (`libmkddc_iec` + `mkddc-iec-compiler`).

- [x] **Modify:** Chấp thuận typed deterministic IR interpreter, nhưng đổi tên/role các
  thành phần:
  - `libmkddc_iec`: compiler + semantic core, có version;
  - `mkddc-program-core`: deterministic runtime interpreter (thay cho vai trò "Core loader"
    mô tả ở bản 0.3);
  - `mkddc-program-service`: backend service quản lý project/build/artifact/deployment/
    runtime state;
  - Web IDE gọi compiler qua backend API; CLI chỉ là công cụ kỹ thuật/test/CI/recovery,
    không phải giao diện sử dụng chính;
  - Program Artifact có schema version, compiler version, checksum, compatibility
    metadata;
  - runtime **không** thực thi trực tiếp source ST hay JSON graph — chỉ thực thi artifact
    đã validate và compile thành typed IR;
  - Mekong sở hữu toàn bộ source code, schema, compiler pipeline, IR, runtime.

---

## Q5 (RD-IEC-005) — Có online change trong Rev A.0 không?

Đề xuất bản 0.3: Không claim; chỉ build + atomic activation tại safe boundary.

- [x] **Approve.** Luồng bắt buộc: Edit draft → Validate → Build immutable artifact →
  Deploy artifact → Activate atomically tại safe task boundary → Rollback về artifact
  trước → ghi audit log đầy đủ. Không thay đổi trực tiếp code/program state trong khi
  artifact đang chạy.

---

## Q6 (RD-IEC-006) — External certification (PLCopen) có là release gate không?

Đề xuất bản 0.3: Có nếu datasheet/tender dùng "certified"; tối thiểu independent
conformity review nếu dùng "compliant".

- [x] **Modify:** PLCopen certification **không phải** release gate của Rev A.0. Cấm
  dùng "PLCopen Certified" / "IEC 61131-3 Certified" / "Fully IEC 61131-3 compliant" cho
  Rev A.0. Mô tả được phép duy nhất: *"Mekong-owned deterministic DDC programming runtime
  designed with an IEC 61131-3-aligned program, type, task and function-block model."*
  Trước khi phát hành thương mại phải có: independent architecture review, language
  conformance test cho đúng phạm vi ST+FBD đã công bố, deterministic timing test, fault
  containment test, artifact compatibility test, security/permission review, auditability
  review. Chứng nhận độc lập/PLCopen được xem xét ở revision sau khi runtime và language
  scope ổn định.

---

## Q7 (RD-IEC-007) — Firmware skeleton có được release cùng IEC runtime không?

Đề xuất bản 0.3: Không; MCU target/HIL là system release blocker độc lập.

- [x] **Approve.** Program Runtime chỉ release trên sản phẩm khi tối thiểu đạt: protocol
  SOM–MCU versioned; deterministic I/O image exchange; timeout/stale-data handling;
  output safe-state; watchdog; reboot recovery; HIL test; fault injection test; mapping
  consistency giữa physical I/O, virtual variable, tag, program variable.

---

## Q8 — Sizing/resourcing (mục 12.1, DOC-REV-006)

**Câu hỏi:** cung cấp sizing trước khi mở C0, hay chấp nhận mở C0 không sizing?

- [x] **Khác:** Mở **C0 — Architecture and Feasibility Baseline** ngay, có phạm vi/thời
  gian/đầu ra cố định, **không** mở C1–C10 trước khi C0 hoàn thành và được duyệt. C0 phải
  tạo ra: IEC scope matrix Rev A.0; ST subset; FBD semantic spec; type system; Program/
  Resource/Task/POU model; typed IR spec; compiler/runtime boundary; Web IDE/backend/
  device deployment architecture; deterministic scheduler model; standard function/FB
  baseline; security/permission/audit model; test & conformance strategy; build-vs-reuse
  assessment (không đổi quyết định Mekong sở hữu runtime); effort estimate cho C1–C10;
  nhân lực/timeline/dependency/chi phí/risk register; implementation backlog có
  acceptance criteria. C0 **không** viết production runtime quy mô lớn — chỉ prototype/
  spike giới hạn (ST parse→semantic→IR; FBD graph→cùng IR; IR execution theo cycle time;
  đọc input image/ghi output image; atomic artifact activation; basic trace/diagnostic),
  tách riêng khỏi production code.
  - Ai phụ trách ước lượng: Program Runtime Architect phối hợp SOM Backend Lead, Firmware
    Lead, QA/HIL Lead.

**Trả lời:** Mở C0 có giới hạn để chốt kiến trúc và sizing; chỉ mở implementation C1–C10
sau khi C0 được review và phê duyệt.

---

## Q9 — Reviewer identity cho Approval log

- Reviewer: **Phạm Đình Chương**
- Role: **Project Engineering Owner / CTO**
- Ngày: **2026-07-23**

---

## Quyết định cuối cùng (nguyên văn CTO)

> Tài liệu hiện tại đã đủ để chốt hướng kiến trúc và chuyển sang lập Implementation Plan.
> Không tiếp tục viết thêm các tài liệu thảo luận chung về việc có nên làm IEC hay có nên
> dùng runtime bên ngoài. Các tài liệu tiếp theo phải phục vụ trực tiếp việc triển khai.
> Chưa được viết production code C1–C10 trước khi C0 được duyệt.

## Theo dõi thực thi (do tôi — trợ lý — cập nhật khi hoàn tất từng mục)

| # | Việc | Tài liệu | Trạng thái |
|---|---|---|---|
| 1 | Ghi nhận quyết định (file này) | `KX-DDC24-PENDING-DECISIONS-IEC61131-PROGRAM-SOM-FW-2026-07-23.md` | Done |
| 2 | ADR mới + cập nhật `DECISIONS.md`/ADR-004/`PRODUCT.md`/`SOFTWARE.md` | `ADR-018-mekong-owned-iec-aligned-program-runtime.md` | Done |
| 3 | Nâng bản thiết kế lên revision mới (ST+FBD, kiến trúc mới) | `PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md` v0.4 | Done |
| 4 | C0 Architecture and Feasibility Plan | `KX-DDC24-PROGRAM-RUNTIME-C0-ARCHITECTURE-FEASIBILITY-PLAN.md` | Done |
| 5 | Implementation Plan C1–C10 | `KX-DDC24-PROGRAM-RUNTIME-IMPLEMENTATION-PLAN-C1-C10.md` | Done |
| 6 | Document conflict report toàn repo | `KX-DDC24-PROGRAM-RUNTIME-DOCUMENT-CONFLICT-REPORT-2026-07-23.md` v2.0 — 31/31 conflict Closed | Done |
| 7 | Cập nhật CHANGELOG/README index | `CHANGELOG.md`, `docs/README.md` | Done |
| 8 | Sync `REQUIREMENTS.md`/`VERIFICATION.md`/`TRACEABILITY.md` (ACTION-03) | 3 file `Active` cập nhật | Done |
| 9 | Datasheet bỏ claim Compliant (ACTION-04) | `DS_MK-DDC-24_VI.md` | Done |
| 10 | PM Plan làm rõ ST Text Editor vs FBD Canvas (ACTION-05) | `KX-DDC24-PM-IMPLPLAN-001_VI.md` | Done |
| 11 | Assign Owner thật cho 5 vai trò C0 (ACTION-06) | `KX-DDC24-PROGRAM-RUNTIME-C0-ARCHITECTURE-FEASIBILITY-PLAN.md` | **Blocked — cần CTO cung cấp tên thật, không tự đặt** |
| 12 | C0 workstream → READY sau khi có owner (ACTION-07) | C0 plan | Blocked bởi #11 |
| 13 | Báo cáo `PROGRAM_RUNTIME_READY_FOR_C0.md` (ACTION-08) | file mới | Done — kết luận C0_READY = NO, chờ #11 |

## 8. Revision history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-07-23 | Tạo file tổng hợp Q0 (governance, chặn) + Q1–Q7 (RD-IEC-001..007) + Q8 (sizing) + Q9 (reviewer identity) để chủ quản trả lời. |
| 2.0 | 2026-07-23 | Ghi nhận quyết định đầy đủ của CTO Phạm Đình Chương cho Q0–Q9; trạng thái chuyển Decided/Closed; thêm bảng theo dõi thực thi downstream doc. |
