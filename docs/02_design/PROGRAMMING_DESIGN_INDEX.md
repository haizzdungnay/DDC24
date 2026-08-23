# Bộ hồ sơ thiết kế Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `PROG-DOCSET-001` |
| Phiên bản | 4.2 |
| Trạng thái | **APPROVED FOR IMPLEMENTATION — unified Product baseline** |
| Ngày | 2026-08-24 |
| Chủ quản | System Engineering |
| Phạm vi | Một Product Programming — Product/SRS/Architecture/DDD/FE/BE/Core/HW/FW/V&V/Ops |

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Xác định **hồ sơ nào là chủ quản của nội dung nào** trong bộ Programming. Khi hai file nói khác nhau về cùng một chủ đề, file được chỉ định ở §3 là bên đúng; file kia phải sửa theo. Đây cũng là điểm vào để biết đọc file nào trước. |
| 2. Ai phải đọc file này? | Bất kỳ ai chuẩn bị sửa một hồ sơ Programming, và mọi người mới vào dự án. Dev Lead đọc để biết hồ sơ upstream của một slice; Document Control đọc để kiểm register. |
| 3. Hệ thống hiện tại đang có gì? | Baseline cũ một Program được giữ để migration. Trên nhánh Plan59, W5 đã có sáu workspace, Monitor Signal/Point fail-closed, ST/FBD editor và real-backend E2E PASS ở mức HOST/LOCAL; source chưa merge và không được dùng để claim GitHub CI, target/HIL hay release. |
| 4. Thiết kế mới thay đổi điều gì? | ADR-050 thêm multi-Program, PROGRAM/FUNCTION/FUNCTION_BLOCK, Control Library, Published Signal, Enable/Disable, package activation và sáu workspace. Unified DDD khóa data/API/state/algorithm/migration/test. |
| 5. Team phải sửa module/contract nào? | File này không giao việc code. Nó chỉ tay tới hồ sơ chủ quản: `mkddc-web` (BE Design), `mkddc-core` (FW-SOM + Control Semantics), `mkddc-iobus` (không đổi), STM32 (FW MCU Design), `apps/web-ui` (FE + UI/UX Design). |
| 6. Điều gì còn bị chặn? | Không còn blocker tài liệu/quyết định cho implementation. Target/HIL/physical I/O/soak/provenance vẫn chặn release, không chặn code. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | Manifest baseline phải khớp `candidate_pin_check.py`; harness/diff/gates phải PASS. Release chỉ dựa trên VVP/Test Result W7, không dựa vào nhãn thiết kế hoặc supporting evidence lịch sử. |

Thuật ngữ điều hướng: **workspace** là một trong sáu màn hình `PGM-01..06`.
Journey legacy vẫn dùng cho regression; scenario unified `VS-PROG-U01..U12`
bao phủ Product Target mới.

Thuật ngữ dùng xuyên suốt bộ hồ sơ: **Draft** là bản đang sửa, có thể ghi đè;
**Revision** là bản đã niêm phong, bất biến; **Check** là biên dịch + kiểm tra
không đụng tới chương trình đang chạy; **Commission** là đưa một Revision vào
vận hành; **Active** là Revision đang điều khiển thật; **LKG** (Last-Known-Good)
là Revision tốt gần nhất dùng để quay lui.

## 1. Mục đích và thẩm quyền

Đây là điểm vào duy nhất cho bộ thiết kế Programming. Product authority là
[`PROD-PROG-001` v3.0](../01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md);
cross-cutting design authority là
[`DDD-SW-PROG-UNIFIED-001`](software/PROGRAMMING_UNIFIED_PRODUCT_DETAILED_DESIGN.md).
Khi hồ sơ cũ xung đột về một Program/Task, POU, library, signal, lifecycle hoặc
workspace, Unified DDD thắng. Bộ hồ sơ không tự chứng minh release.

Thứ tự thẩm quyền bắt buộc:

```text
Product/ADR Active
→ Requirement được phê duyệt
→ Design được phê duyệt
→ Contract machine-readable
→ Code + test + evidence trên đúng target
```

## 2. Luồng đọc theo vai trò

| Vai trò | Bắt đầu từ | Đọc tiếp bắt buộc |
|---|---|---|
| Product/PM/CTO | Product v3.0 + [SRS](../02_requirements/PROGRAMMING_REQUIREMENTS_SPEC.md) | ADR-050 → Unified DDD → Risk → Traceability |
| Kiến trúc sư | [Architecture](../03_architecture/PROGRAMMING_ARCHITECTURE.md) | Unified DDD → Data/Interface/FW-SOM → Verification |
| FE | [UI/UX](../04_uiux/PROGRAMMING_UI_UX_DESIGN.md) | FE Design → Interface → Data Model → Verification |
| BE | [BE Design](software/PROGRAMMING_BE_DESIGN.md) | Data Model → Interface → Operations → Verification |
| FW-SOM/Core | [FW-SOM Design](software/PROGRAMMING_FW_SOM_DESIGN.md) | Interface → ST/IR/Task component specs → Verification |
| FW MCU | [FW MCU Design](firmware/PROGRAMMING_FW_MCU_DESIGN.md) | IOP contract → HW Design → HIL scenarios |
| HW | [HW Design](../04_design/hardware/PROGRAMMING_HW_DESIGN.md) | MCU Design → IOP contract → HIL scenarios |
| QA/V&V | [Verification Plan](../05_verification/PROGRAMMING_VERIFICATION_PLAN.md) | Requirements → Traceability → Risk → Operations |
| Dev Lead | [Plan 59](../03_implementation/59_PROGRAMMING_DOC_TO_CODE_IMPLEMENTATION_PLAN.md) | Unified DDD → task READY theo dependency → test/evidence |

## 3. Danh mục hồ sơ có kiểm soát

| ID | Hồ sơ chủ quản | Trách nhiệm | Trạng thái |
|---|---|---|---|
| `PROG-DOCSET-001` | [Programming Design Index](PROGRAMMING_DESIGN_INDEX.md) | authority/register và luồng đọc | `Active` v4.1 |
| `SRS-PROG-001` | [Programming Requirements Specification](../02_requirements/PROGRAMMING_REQUIREMENTS_SPEC.md) | 82 requirement, acceptance và allocation | `Active` v1.0 |
| `DEC-PROG-REGISTER-001` | [Programming Decision Register](../00_governance/PROGRAMMING_OPEN_DECISIONS.md) | decision unified và lịch sử supersede | `Active`; `0 OPEN` |
| `ARCH-PROG-001` | [Programming Architecture](../03_architecture/PROGRAMMING_ARCHITECTURE.md) | context, ownership, package/POU/scheduler/signal/output/failure/migration boundary | `Active` v1.0 — unified Product architecture; **APPROVED FOR IMPLEMENTATION** |
| `DDD-SW-PROG-UNIFIED-001` | [Unified Product Detailed Design](software/PROGRAMMING_UNIFIED_PRODUCT_DETAILED_DESIGN.md) | multi-Program, POU, library, signal, enable, scheduler, output, migration, test | `Active` v1.1 — **IMPLEMENT_READY; DD-01..13 PASS** |
| `DM-PROG-001` | [Programming Data Model](software/PROGRAMMING_DATA_MODEL.md) | Project/Draft/Revision/Artifact/Runtime/Audit | `M3` v1.0 — SQLite v5 operation/Commission projection As-Built; target migration còn mở |
| `IFSPEC-PROG-001` | [Programming Interface Specification](interfaces/PROGRAMMING_INTERFACE_SPEC.md) | REST/WS/internal control/error/idempotency contracts | `M3` v1.9 — Monitor/Trace concrete; machine-readable OpenAPI hiện hành v1.27.0 và target corrective còn mở |
| `DDD-LANG-PROG-001` | [Language/Compiler Design](software/PROGRAMMING_LANGUAGE_COMPILER_DESIGN.md) | ST/FBD, user POU, purity/state/call graph, typed IR và compiler | `Active` v1.0 — implementation-ready; source migration theo Plan59 W1 |
| `IFSPEC-ART-PROG-001` | [Artifact/Loader Spec](interfaces/PROGRAMMING_ARTIFACT_LOADER_SPEC.md) | artifact layout, bounded loader, stage/load/swap/reject | `M3` v0.9 — verified file staging, O(1) swap/LKG và checkpoint recovery có source; target còn mở |
| `DDD-CTRL-PROG-001` | [Control Semantics](software/PROGRAMMING_CONTROL_SEMANTICS.md) | scan order, priority, PID, hold-last, overrun, transition | `M3` v1.1 — exclusive owner, TTL hold-last 60 s và first-output cutover/rollback As-Built; target/HIL còn mở |
| `DDD-LIFE-PROG-001` | [Runtime Lifecycle](software/PROGRAMMING_RUNTIME_LIFECYCLE_DESIGN.md) | Check/Commission/Restore/RETAIN/LKG/restart/power-loss | `M3` v0.6 — P4 operation/journal/cutover/restart recovery source/host hoàn tất; target còn mở |
| `UX-WEB-PROG-001` | [Programming UI/UX Design](../04_uiux/PROGRAMMING_UI_UX_DESIGN.md) | IA sáu workspace, POU tree, Control Library, lifecycle, copy, states, responsive, accessibility | `Active` v2.0 — target thống nhất; asset desktop/mobile PGM-02/PGM-04; lower legacy sections chỉ hỗ trợ migration |
| `DDD-FE-PROG-001` | [Programming FE Design](software/PROGRAMMING_FE_DESIGN.md) | React feature, state/query/mutation, error recovery | `M3` v1.4 — UUID/hash chạy được trên HTTP, auth deep-link, safe-state/RETAIN fail-closed, export/import và mobile nav đã qua host/target; chưa merge |
| `DDD-BE-PROG-001` | [Programming BE Design](software/PROGRAMMING_BE_DESIGN.md) | Go service, persistence, compiler job, RBAC/audit | `M3` v1.6 — Monitor/Trace bounded; target Monitor/read-back supporting evidence |
| `DDD-FWSOM-PROG-001` | [Programming FW-SOM Design](software/PROGRAMMING_FW_SOM_DESIGN.md) | compiler/runtime boundary, scheduler, activation, RETAIN | `M3` v1.0 — snapshot/task target read-back; positive binding còn mở |
| `DDD-FWMCU-PROG-001` | [Programming FW MCU Design](firmware/PROGRAMMING_FW_MCU_DESIGN.md) | IOP continuity, sampling/actuation, safe-timeout, diag | `M3` — **APPROVED FOR IMPLEMENTATION**; HIL là evidence P6 |
| `DDD-HW-PROG-001` | [Programming HW Design](../04_design/hardware/PROGRAMMING_HW_DESIGN.md) | electrical constraints và điểm đo HIL | `M3` — **APPROVED FOR IMPLEMENTATION**; HW/HIL triển khai song song |
| `DDD-SEC-PROG-001` | [Security Design](software/PROGRAMMING_SECURITY_DESIGN.md) | trust boundary, RBAC, integrity, sandbox, audit và abuse case | `M3` v0.6 — UDS peer/path/bounded-frame controls có source; TLS/target evidence còn mở |
| `VVP-PROG-001` | [Programming Verification Plan](../05_verification/PROGRAMMING_VERIFICATION_PLAN.md) | 32 scenario migration + 12 scenario Product thống nhất, evidence và release gate | `Active` v2.0 — implementation-ready; verdict release chờ W7 |
| `OPS-PROG-001` | [Programming Operations Runbook](../06_operations/PROGRAMMING_OPERATIONS_RUNBOOK.md) | backup, commission, restore, replacement, incident | `M3` v0.6 — API/runtime source có; chưa diễn tập trên target |
| `RSK-PROG-001` | [Programming Risk Register](../07_records/PROGRAMMING_RISK_REGISTER.md) | rủi ro, kiểm soát, owner và residual gate | `Active` v4.19 — 22/22 Open; source controls W5 có bằng chứng HOST/LOCAL, residual chưa hạ |
| `TRACE-PROG-001` | [Programming Traceability Matrix](../07_records/PROGRAMMING_TRACEABILITY_MATRIX.md) | Requirement → Design → Interface → Test → Evidence | `Active` v6.4 — nối 22 requirement unified với Plan59 và `VS-PROG-U01..U12`; không nâng `I/T/P/R` từ host evidence |
| `PLAN-PROG-059` | [Programming Implementation Plan 59](../03_implementation/59_PROGRAMMING_DOC_TO_CODE_IMPLEMENTATION_PLAN.md) | execution roadmap/task/gate/evidence tới release | `Active` v2.1; W5 hoàn tất HOST/LOCAL, authority công việc tương lai |

Plan 53/54/56 và tracker cũ giữ lịch sử tới 2026-08-20. Tiến độ tương lai chỉ
cập nhật trong Plan 59 để không tạo hai authority.

## 4. Ranh giới thiết kế bắt buộc

1. `mkddc-web` sở hữu auth, Draft/Revision store, compiler orchestration, audit
   và API; nó không nằm trên đường thực thi thời gian thực.
2. `mkddc-core` sở hữu active package, base control step, Program execution,
   priority mức 5, interlock/safe-state, RETAIN runtime và authoritative status.
3. `mkddc-iobus` tiếp tục sở hữu IOP, physical conversion, Modbus RTU và IO SHM;
   Commission Programming không được restart hoặc làm đói poll của iobus.
4. STM32 sở hữu sampling/actuation vật lý, IOP framing và safe-timeout độc lập
   `200 ms`; MCU không parse ST/FBD/IR và không biết Project/Revision.
5. Web/HMI mất không được dừng active Program. HMI LVGL/DRM không có authoring,
   Check, Commission, trace hoặc replacement route.
6. Graph và Programming không được cùng sở hữu Local logic. Cutover chỉ có
   `GRAPH_ONLY`, `PROGRAM_ONLY`, còn yêu cầu dual-run phải bị từ chối.
7. Mọi output Program đi qua priority resolver ở mức Local logic 5; không có
   đường tắt từ compiler/runtime ra IOP hoặc MCU.

## 5. Trạng thái hiện tại và cổng sử dụng

| Nội dung | As-Built đã xác nhận | Trạng thái thiết kế |
|---|---|---|
| Graph production path | Có, bootstrap nạp `graph.json` | Legacy; cần cutover contract |
| ST parser/semantic/IR/artifact/scheduler/RETAIN/trace component | Compiler/runtime, ST history/overlay và đường `TRACE_READ` có source/test host; invalid không thành zero | Supporting HOST/LOCAL; target timing/soak và Test Result còn mở |
| FBD | Compiler/editor có POU typed interface, keyboard flow và source/host evidence | User POU/library/multi-Program HOST/LOCAL; target Commission/HIL còn thiếu |
| Programming REST/WS + persistence | Store v11, OpenAPI v1.27.0; Project/Draft/Revision/Check/Commission/Restore/Enable/Disable/Runtime/Signal dùng service thật; lane E2E real-backend 1/1 PASS trên host | Source W0..W5 trên nhánh; GitHub CI/target/HIL/Test Result/release còn mở |
| MCU IOP safe timeout | Có code thuần `200 ms` | BSP/HIL vật lý còn RED |
| FE Programming | Sáu workspace, lifecycle, Monitor và ST/FBD editor PASS source/component/browser ở mức HOST/LOCAL | Source nhánh chưa merge; usability độc lập, GitHub CI, target/HIL và release còn mở |

Team được implement/merge theo ADR-050 và task card Plan59.
Không được cutover control path hoặc claim release cho tới khi implementation,
Test Result, residual risk và `RELEASE_READY` tương ứng đều PASS.

## 6. Ánh xạ mục tiêu chuẩn

| Họ chuẩn dùng làm hướng dẫn | Hồ sơ dự án tạo bằng chứng |
|---|---|
| ISO/IEC/IEEE 29148 | `SRS-PROG-001`, `TRACE-PROG-001`, acceptance theo từng ID |
| ISO/IEC/IEEE 15288 và 12207 | Architecture, Design, V&V, Operations, Plan, Change/Release gate |
| ISO/IEC 25010 | NFR hiệu năng, tin cậy, usability, security, maintainability trong SRS/V&V |
| ISO 9001 | metadata kiểm soát, document register, review/sign-off, changelog |
| IEC 62443 direction | RBAC, audit, integrity, least privilege, threat boundary |

Đây là căn chỉnh tài liệu theo hướng ISO, không phải tuyên bố chứng nhận.

## 7. Ma trận bàn giao và điều kiện đủ nội dung

| Hồ sơ | Đầu vào phải khóa | Đầu ra implementable bắt buộc | Consumer xác nhận |
|---|---|---|---|
| SRS/Open Decisions | Product/ADR/proposal/conflict | requirement atomic, rationale, acceptance, owner, decision dependency | tất cả lead + QA |
| Architecture | SRS + As-Built | process/component/data ownership, sequence, timing, deployment/rollback | BE/Core/IO/FE/Ops |
| Data/Interface | SRS + Architecture | field/schema/invariant/transaction/API/IPC/error/version | FE/BE/Core/Security |
| Language/Artifact/Control/Lifecycle | type/FBD/Task/Point decisions | grammar/IR/layout/algorithm/state/timing/fault/recovery | compiler/Core/Controls/QA |
| UI/UX + FE/BE | UC + API/Data | wireframe/state/copy/component/function/store/worker/error/test | Product/UX/FE/BE/QA |
| FW-SOM/MCU/HW | control/IOP/electrical authority | buffer/thread/ISR/DMA/pin/test-point/timing/safe behavior | Core/FW/HW/Safety/QA |
| Security | trust/RBAC/artifact/deploy | control/abuse/error/audit/key/cert/test | Security/Ops/BE/Core |
| V&V/Ops/Risk/Trace/Plan | toàn bộ design | scenario/procedure/evidence/treatment/trace/work package/gate | QA/Ops/Release/Document Control |

Một hồ sơ chỉ đủ nội dung vòng chi tiết khi có metadata, scope, As-Built, Target,
field/contract, state/algorithm/timing, error/safety/security, source ownership,
verification, compatibility/deploy/rollback và trace/risk/decision/sign-off phù
hợp loại tài liệu. Mục không áp dụng phải ghi lý do, không được bỏ trống.

## 8. Trạng thái kiểm soát mức trưởng thành

Ngày 2026-08-09 diễn ra hai lần thay đổi mức, ghi lại đầy đủ để không mất dấu:

1. **Hạ M3 → M2.** Nhãn `M3` trước đó là tự đánh giá, không có bằng chứng
   checklist từng mã, nên bị hạ về `M2 — Detailed Draft`.
2. **Nâng M2 → M3 có bằng chứng.** Sau vòng rà
   [`PROG-REV-2026-08-09`](../07_records/reviews/PROGRAMMING_DESIGN_SET_REVIEW_2026-08-09.md),
   22/22 hồ sơ đạt đúng định nghĩa `M3` tại
   [Plan 54 §3.1](../03_implementation/54_PROGRAMMING_DOCUMENTATION_ROADMAP.md):
   checklist áp dụng đã đủ và ghi thành bảng trong từng hồ sơ; mọi `TBD/BLOCKED`
   có owner, ảnh hưởng, gate và điều kiện mở khóa; link nội bộ sạch (đo được:
   link missing `0`, anchor missing `0`, duplicate ID `0`).

Phân biệt cho đúng: maturity đo được vẫn **M3 = 22/22, M4 = 0/22, M5 = 0/22** vì
không giả chữ ký hoặc evidence. Theo `AUTH-PROG-2026-08-11-03`, M4/M5 được
`WAIVED FOR IMPLEMENTATION`: chúng không còn là điều kiện để bắt đầu hoặc merge
code; review/evidence thực được bổ sung trong task và trước release.

## 9. Phê duyệt

| Vai trò | Trạng thái | Điều kiện ký |
|---|---|---|
| Product Owner | **ACCEPT ALL — Phạm Đình Chương, 2026-08-11** | `AUTH-PROG-2026-08-11-03`; không kèm approval condition bổ sung |
| Software/Runtime Architect | **ACCEPT ALL — Phạm Đình Chương, 2026-08-11** | 6/6 ADR `Accepted`; baseline v2.8 |
| Controls/Safety Reviewer | **WAIVED FOR IMPLEMENTATION** | review hậu kiểm; không chặn code |
| HW/FW Lead | **WAIVED FOR IMPLEMENTATION** | review/HIL theo task P6; không chặn P1 |
| UX/FE Lead | **WAIVED FOR IMPLEMENTATION** | review hậu kiểm; không chặn code |
| Verification Lead | **WAIVED FOR IMPLEMENTATION** | test/evidence theo task; không chặn code |
| Product Owner/CTO + System Architect | **ACCEPT — 2026-08-20** | `AUTH-PROG-2026-08-20-04`; Product v3.0, ADR-050, Unified DDD và Plan59 |

## 10. Lịch sử sửa đổi

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1 | 2026-08-09 | Tạo chỉ mục và bộ hồ sơ Programming ban đầu |
| 0.2 | 2026-08-09 | Chốt baseline 22 hồ sơ, chỉ rõ 5 file M0 và liên kết Roadmap Plan 54 |
| 0.3 | 2026-08-09 | R1 review-ready: đồng bộ trạng thái M3 của Index/SRS/Open Decisions/Architecture |
| 0.4 | 2026-08-09 | R2 review-ready: tạo đủ 5 hồ sơ lõi, nâng Data/Interface và liên kết source supporting specs |
| 0.5 | 2026-08-09 | R3 review-ready: hoàn thiện UI/UX, FE, BE, FW-SOM, FW MCU và HW tới mức implementable M3 |
| 0.6 | 2026-08-09 | R4 review-ready: V&V 30 scenario, Ops, Risk, Trace 55 requirement và Plan 53 đạt M3 |
| 0.7 | 2026-08-09 | Tái kiểm toán, hạ nhãn M3 chưa có peer review; bổ sung ma trận đầu vào/đầu ra/consumer và cổng nội dung Detailed Draft cho 22 hồ sơ |
| 0.8 | 2026-08-09 | Thêm mục Đọc nhanh và phụ lục tự kiểm cổng M3; đồng bộ trạng thái 22 hồ sơ lên `M3 — Review Ready` theo `PROG-REV-2026-08-09` |
| 0.9 | 2026-08-09 | Đồng bộ UI/UX v0.5 với rule visual mới: đủ asset render được PGM-01..06, landing desktop/mobile và screen-set modal/drawer; không nâng M4/M5 khi chưa có consumer review/browser evidence |
| 1.0 | 2026-08-09 | Amendment A1: bổ sung thuật ngữ workspace/journey/use case ba lớp; đồng bộ trạng thái và version của 13 hồ sơ IMPACTED; ghi `OD-PROG-016` là blocker của IA bốn workspace |
| 1.1 | 2026-08-10 | Đồng bộ vòng duyệt P0: Open Decisions v0.6, VVP v0.6, Plan 53 v0.8; ghi rõ gói P0 review-ready nhưng G0/PLAN_READY vẫn BLOCKED |
| 1.2 | 2026-08-10 | Ghim candidate P0 `e3e9fb2` bằng manifest 22 hồ sơ; đồng bộ Plan 53 v0.9 và giữ 22/22 ở M3 do chưa có consumer review/chữ ký |
| 1.3 | 2026-08-10 | Đồng bộ readiness P0: Plan 53 v0.10, host/evidence repo sẵn; CI billing, target SSH auth và HIL authority/fixture còn chặn; mức M3/M4/M5 không đổi |
| 1.4 | 2026-08-10 | Đồng bộ Plan 53 v0.11: 6/6 thẻ P1 đã đủ 11 trường, dependency và evidence đúng gate; vẫn 0/6 DoD, 0/32 Test Result và không đổi M3/M4/M5 |
| 1.5 | 2026-08-10 | Đồng bộ Plan 53 v0.12 và vòng consumer review kỹ thuật: 7 hồ sơ trong mẫu số 22 lên revision mới khi đóng `F-CR-01..08` (`ARCH-PROG-001` 0.5, `IFSPEC-PROG-001` 0.6, `DDD-SEC-PROG-001` 0.4, `DDD-BE-PROG-001` 0.6, `DDD-FE-PROG-001` 0.7, `UX-WEB-PROG-001` 0.7, `TRACE-PROG-001` 2.5); thêm `ADR-026..031` làm nguồn quyết định kiến trúc. Mức M3/M4/M5 **không đổi** — `0/22 M4` vì chữ ký người thật còn thiếu |
| 1.6 | 2026-08-10 | Đồng bộ Plan 53 v0.14 và manifest v2.3: câu 6 tách rõ “review kỹ thuật xong” khỏi “authority đã ký”, và ghi candidate định danh bằng 22 SHA-256 thay vì commit. Mức M3/M4/M5 **không đổi** — `0/22 M4` |
| 1.7 | 2026-08-10 | Ghi `AUTH-PROG-2026-08-10-01`: Product Owner/CTO + System Architect Phạm Đình Chương `ACCEPT`; Open Decisions v0.8 có `3 DECIDED`, `14 OPEN`; Plan 53 v0.15. Giữ `0/22 M4`, `0/22 M5` vì consumer/discipline/Verification và evidence còn thiếu |
| 1.8 | 2026-08-11 | Ghi `AUTH-PROG-2026-08-11-03`: phê duyệt toàn bộ baseline cho implementation; `17/17` decision `DECIDED`, 6/6 ADR `Accepted`, `PLAN_READY` và mọi `IMPLEMENT_READY[*]` `PASS`. Chữ ký còn thiếu ghi `WAIVED FOR IMPLEMENTATION`; maturity thực tế giữ 22/22 M3, 0/22 M4/M5; P1 được bắt đầu ngay |
| 1.9 | 2026-08-11 | Đồng bộ As-Built sau `TASK-PROG-102`: P1 đạt 3/6; OpenAPI/client, IPC v1 và profile/artifact/loader foundation đã có source; Artifact Spec v0.4, Trace v3.0 và Plan 53 v0.20. Giữ feature flag `OFF`, Test Result 0/32 và `RELEASE_READY BLOCKED` |
| 2.0 | 2026-08-11 | Đồng bộ As-Built sau `TASK-PROG-103`: P1 đạt 4/6; catalog 19 public/77 detail sinh C++/Go/TypeScript, OpenAPI v1.16 và fail-safe biên consumer đã có source. Interface v0.9, Artifact v0.5, Trace v3.1, Plan 53 v0.21; giữ flag `OFF`, Test Result 0/32 và `RELEASE_READY BLOCKED` |
| 2.1 | 2026-08-11 | Đồng bộ As-Built sau `TASK-PROG-104`: P1 đạt 5/6; SQLite store v1, migration checksum, ETag/immutable/idempotency/audit và backup/restore có source/fault test. Data v0.5, BE v0.7, Risk v0.6, Trace v3.2, Plan 53 v0.22; giữ flag OFF, Test Result 0/32 và RELEASE_READY BLOCKED |
| 2.2 | 2026-08-11 | Đồng bộ `TASK-PROG-105`: join sáu contract và deploy/rollback dry-run PASS; P1 6/6 DONE, G1 GO, next TASK-PROG-200. VVP v0.9, Risk v0.7, Trace v3.3, Plan v0.23; hai record VS-001/019 BLOCKED, 0/32 PASS, flag OFF và RELEASE_READY BLOCKED |
| 2.3 | 2026-08-11 | Đồng bộ `TASK-PROG-200`: compiler/runtime host đủ ST subset và sáu type target, source map strict, parser/loader mỗi bộ fuzz 10 triệu input; P2 1/8, next TASK-PROG-201. Language v0.4, Artifact v0.6, Risk v0.8, Trace v3.4, Plan v0.24; giữ 0/32 PASS và RELEASE_READY BLOCKED |
| 2.4 | 2026-08-11 | Đồng bộ `TASK-PROG-201` tại `52dfb57`: FBD canonical schema/golden/manifest/validator và FE keyboard model/reducer/component; P2 2/8, next TASK-PROG-202. Language v0.5, FE v0.8, Risk v0.9, Trace v3.5, Plan v0.25; giữ 0/32 PASS, flag OFF và RELEASE_READY BLOCKED |
| 2.5 | 2026-08-11 | Đồng bộ `TASK-PROG-202` tại `4819901`: FBD→typed IR/runtime chung, 20 cặp equivalence, fail-closed và fuzz 100.000 input; P2 3/8, next TASK-PROG-203. Language v0.6, Risk v1.0, Trace v3.6, Plan v0.26; giữ 0/32 PASS, flag OFF và RELEASE_READY BLOCKED |
| 2.6 | 2026-08-11 | Đồng bộ `TASK-PROG-203` tại `2c2bfb4`: SHA-256/build manifest/source map ST/FBD, UUID/unit provenance và verifier fail-closed; P2 4/8, next TASK-PROG-204. Language/Artifact v0.7, Risk v1.1, Trace v3.7, Plan v0.27; giữ 0/32 PASS, flag OFF và RELEASE_READY BLOCKED |
| 2.7 | 2026-08-11 | Đồng bộ `TASK-PROG-204` tại `66848a1`: wiring SQLite v2 và sáu Project/Draft/Revision operation, ETag/CAS, idempotency 24 giờ, immutable Revision, migration backup và RBAC; P2 5/8, next TASK-PROG-205. Data v0.6, Interface v1.0, BE v0.8, Risk v1.2, Trace v3.8, Plan v0.28; giữ 0/32 PASS, flag OFF và RELEASE_READY BLOCKED |
| 2.8 | 2026-08-11 | Đồng bộ `TASK-PROG-205` tại `e8c289e`: SQLite v3, Check request 24 giờ, lease/CAS retry một lần, compiler sandbox, diagnostic, Artifact content-address/read-back và hai route Check thật; P2 6/8, next TASK-PROG-206. Data v0.7, Interface v1.1, BE v0.9, Risk v1.3, Trace v3.9, Plan v0.29; giữ 0/32 PASS, flag OFF và RELEASE_READY BLOCKED |
| 2.9 | 2026-08-11 | Đồng bộ `TASK-PROG-206` tại `95b9388`: change manifest deterministic, ZIP source-only/hash/allowlist, import Project/Draft atomic và SQLite v4 bundle receipt; P2 7/8, next TASK-PROG-207. Data v0.8, Interface v1.2, BE v1.0, Risk v1.4, Trace v3.10, Plan v0.30; giữ 0/32 PASS, flag OFF và RELEASE_READY BLOCKED |
| 3.0 | 2026-08-11 | Đồng bộ `TASK-PROG-207` tại `3e5281d`: hostile corpus 25 lớp/zero-mutation 8 bảng, 23 alias audit-secret, compiler resource bounds và fuzz host; P2 8/8 source/DoD, next TASK-PROG-300. Data v0.9, Interface v1.3, BE v1.1, Security v0.5, VVP v1.0, Risk v1.5, Trace v3.11, Plan v0.31; giữ 0/32 PASS, flag OFF và RELEASE_READY BLOCKED |
| 3.1 | 2026-08-11 | Đồng bộ `TASK-PROG-300` tại `4f7e0ac`: prepared runtime image ngoài scan, boundary/LKG swap không cấp phát và post-link no-parser/compiler gate; P3 1/8, tổng 22/49, next TASK-PROG-301. Artifact v0.8, FW-SOM v0.5, VVP v1.1, Risk v1.6, Trace v3.12, Plan v0.32; giữ 0/32 PASS, flag OFF và RELEASE_READY BLOCKED |
| 3.2 | 2026-08-11 | Đồng bộ `TASK-PROG-301` tại `a831a0d`: profile Rev A 1/1/1, period 1/5/30 s, budget `<20%`, `on_base_step()`/missed release, capability/schema và watchdog ADR-028; P3 2/8, tổng 23/49, next TASK-PROG-302. Architecture v0.8, Control v0.4, FW-SOM v0.6, VVP v1.2, Risk v1.7, Trace v3.13, Plan v0.33; giữ 0/32 PASS, flag OFF và RELEASE_READY BLOCKED |
| 3.3 | 2026-08-13 | Đồng bộ `TASK-PROG-402` tại `3ca5d22`: RETAIN v2 stable identity/layout/full CRC/atomic/cold-init và scheduler/bootstrap wiring; P3 DONE, P4 3/6, tổng 32/49, next TASK-PROG-403. Lifecycle v0.5, FW-SOM v0.7, Scheduler v1.1, Artifact v1.2, Risk v1.8, Trace v3.14, Plan v0.43; giữ 0/32 PASS, flag OFF và RELEASE_READY BLOCKED. |
| 3.4 | 2026-08-13 | Đồng bộ `TASK-PROG-403..405` tại `c2f3189` + `10d9ad6`: P4 6/6 source/host, tổng 35/49; operation coordinator/SQLite v5/UDS/cutover/rollback/checkpoint recovery và fault tests đã có. Cập nhật 16 hồ sơ bị tác động; giữ 0/32 PASS, flag OFF và RELEASE_READY BLOCKED vì target/HIL/power-cut chưa chạy. |
| 3.5 | 2026-08-13 | Đồng bộ audit FE/UX và corrective `TASK-PROG-508..510`: cập nhật Interface v1.8, UX v0.9, FE v1.2, BE v1.5, FW-SOM v0.9, VVP v1.7, Trace v3.19 và Plan v0.53. Source 508/509 đã implement nhưng chưa merge/target read-back; P5 8/11, tổng 43/53, 0/32 Test Result PASS. |
| 3.6 | 2026-08-13 | Đồng bộ `EV-PROG-P5-510`: Interface v1.9, UX v1.0, FE v1.3, BE v1.6, FW-SOM v1.0, VVP v1.8, Trace v3.20 và Plan v0.54. Full host gate và Foxlinx deploy/read-back/rollback/Chrome/axe PASS; source chưa merge, positive binding target và release assurance còn mở. P5 giữ 8/11, tổng 43/53, 0/32 PASS. |
| 3.7 | 2026-08-13 | Đồng bộ vòng đóng audit live HTTP: UX v1.1, FE v1.4, VVP v1.9, Trace v3.21 và Plan v0.55. Loại bỏ phụ thuộc Web Crypto ở HTTP, giữ deep-link qua đăng nhập, khóa Restore/RETAIN fail-closed, thêm export/import và điều hướng mobile; redeploy Foxlinx, kiểm live ST save/restore, export, import lỗi `422`, desktop/mobile và axe 6/6 scan sạch. Source chưa merge, positive binding target và release assurance còn mở; P5 giữ 8/11, 0/32 PASS. |
| 4.0 | 2026-08-20 | Hợp nhất Product v3.0 theo ADR-050; thêm Unified DDD, 82 requirement, sáu workspace, 12 scenario unified và Plan59; Plan53/54/56/tracker thành Superseded, không còn decision/document blocker implementation. |
| 4.2 | 2026-08-24 | Đồng bộ theo `T60-016` (Plan 60): **OpenAPI `1.26.0` → `1.27.0`**. `GET /projects/{projectId}/programs` chuyển từ `ProgrammingProgramIntentList` (2 trường) sang `ProgrammingProgramsPage` — 6 trường mức trang + 19 trường mức item, mọi trường `required` kể cả khi nullable (server cố ý không dùng `omitempty`: `null` tường minh khác hẳn trường vắng mặt). Ba enum mới; `ProgrammingProgramRuntimeState` đúng **năm** giá trị — `STARTING`/`STOPPING` bị loại theo `ADR`/D-07 vì `start()`/`stop()`/`disable()` của scheduler đổi trạng thái đồng bộ tức thì. Generator nay **sinh type từ schema** thay vì chỉ sinh bảng endpoint, nên type FE không còn khai tay. Số operation giữ **32** (đổi hình dạng phản hồi, không thêm route). Pin G1 re-pin cùng PR. |
| 4.1 | 2026-08-21 | Đồng bộ revision authority sau W5: Unified DDD v1.1, Interface v1.9/OpenAPI v1.26.0, Control Semantics v1.1, Risk v4.19, Trace v6.4 và Plan59 v2.1. Ghi đúng W5 đã PASS ở mức HOST/LOCAL nhưng source chưa merge; `RELEASE_READY` giữ NO-GO vì chưa có GitHub CI, target/HIL, Test Result và residual risk được chấp nhận. |

## 11. Phụ lục — Tự kiểm cổng M3 (loại: Kiểm soát tài liệu)

Đây là **tự kiểm của chủ quản**, không phải review record. Review liên chức năng
nằm ở [`PROG-REV-2026-08-09`](../07_records/reviews/PROGRAMMING_DESIGN_SET_REVIEW_2026-08-09.md).

| Cổng | Kết quả | Bằng chứng trong file / lý do |
|---|---|---|
| Register đủ và không có file ẩn | PASS | §3 liệt kê authority hiện hành; manifest baseline và harness kiểm đường dẫn |
| ID tài liệu ổn định, không trùng | PASS | Harness yêu cầu `duplicate doc ID = 0` |
| Thẩm quyền từng nội dung là duy nhất | PASS | §3 cột “Trách nhiệm” gán một chủ quản cho mỗi chủ đề; §4 khóa 7 ranh giới |
| Luồng đọc theo vai trò | PASS | §2 phủ Product, Architect, FE, BE, FW-SOM, FW MCU, HW, QA, Dev Lead |
| Link nội bộ sạch | PASS | harness: local link missing `0`, anchor missing `0` |
| Trạng thái từng hồ sơ phản ánh đúng mức | PASS | §3 phân biệt authority Active, migration supporting design và evidence queue |
| Không claim chứng nhận | PASS | §6 ghi rõ “căn chỉnh theo hướng ISO, không phải tuyên bố chứng nhận” |
| Quyền implementation | PASS | §8–§9: maturity/signature còn thiếu được ghi trung thực nhưng đã `WAIVED FOR IMPLEMENTATION`; không còn blocker approval |

Cổng M4/M5 của hồ sơ lịch sử chưa có evidence để nâng maturity, nhưng không còn
là entry condition cho implementation. Baseline thống nhất được ghim bằng
manifest 2026-08-20 và được implement ngay theo ADR-050, Unified DDD và Plan59.
