# Bộ hồ sơ thiết kế Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `PROG-DOCSET-001` |
| Phiên bản | 2.6 |
| Trạng thái | **APPROVED FOR IMPLEMENTATION** — `PLAN_READY PASS`; mọi `IMPLEMENT_READY[*] PASS` theo `AUTH-PROG-2026-08-11-03`; maturity đo được vẫn M3 |
| Ngày | 2026-08-11 |
| Chủ quản | System Engineering |
| Phạm vi | Programming Rev A — FE, BE, FW-SOM, HW, FW MCU, V&V và vận hành |

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Xác định **hồ sơ nào là chủ quản của nội dung nào** trong bộ Programming. Khi hai file nói khác nhau về cùng một chủ đề, file được chỉ định ở §3 là bên đúng; file kia phải sửa theo. Đây cũng là điểm vào để biết đọc file nào trước. |
| 2. Ai phải đọc file này? | Bất kỳ ai chuẩn bị sửa một hồ sơ Programming, và mọi người mới vào dự án. Dev Lead đọc để biết hồ sơ upstream của một slice; Document Control đọc để kiểm register. |
| 3. Hệ thống hiện tại đang có gì? | Đường điều khiển production hiện chạy bằng **graph**. P1 đã khóa sáu contract/store/deploy; P2 đã hoàn tất `TASK-PROG-200..203`: ST/type/IR, FBD canonical/equivalence và artifact manifest/source map ST/FBD trên host. Route/flag vẫn `OFF`, Check/store wiring/runtime production chưa có. |
| 4. Thiết kế mới thay đổi điều gì? | Thêm một đường Programming song song (Project → Draft → Revision → Check → Commission → Active) và một **cutover độc quyền**: hoặc `GRAPH_ONLY`, hoặc `PROGRAM_ONLY`, không bao giờ cả hai. Bảy ranh giới bắt buộc ở §4 là phần không được thương lượng. Giao diện tổ chức theo **bốn workspace** và **tám user journey** `UJ-PROG-01..08` đã được `OD-PROG-016` quyết định. |
| 5. Team phải sửa module/contract nào? | File này không giao việc code. Nó chỉ tay tới hồ sơ chủ quản: `mkddc-web` (BE Design), `mkddc-core` (FW-SOM + Control Semantics), `mkddc-iobus` (không đổi), STM32 (FW MCU Design), `apps/web-ui` (FE + UI/UX Design). |
| 6. Điều gì còn bị chặn? | **Không còn blocker approval cho implementation.** P1 6/6 DONE; P2 4/8 và next `TASK-PROG-204`. Hai record VS-001/019 đang BLOCKED và 0/32 PASS chỉ chặn release, không chặn code. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | Register 22 dòng phải khớp harness. Evidence G2-203: build ST/FBD deterministic, targeted 35/35, mutation 7/7; regression CTest 927/927, FE 494/494 và Go PASS. 2 record BLOCKED, 0/32 PASS nên không suy host test thành release evidence. |

Thuật ngữ điều hướng: **workspace** là một trong bốn màn hình chính `PGM-01..04`;
**user journey** `UJ-PROG-01..08` là một công việc trọn vẹn của người dùng;
**use case** `UC-PROG-01..17` giờ là lớp kịch bản chi tiết bên dưới journey, mỗi
mục có trạng thái `MERGED`, `SCENARIO` hoặc `ROADMAP`.

Thuật ngữ dùng xuyên suốt bộ hồ sơ: **Draft** là bản đang sửa, có thể ghi đè;
**Revision** là bản đã niêm phong, bất biến; **Check** là biên dịch + kiểm tra
không đụng tới chương trình đang chạy; **Commission** là đưa một Revision vào
vận hành; **Active** là Revision đang điều khiển thật; **LKG** (Last-Known-Good)
là Revision tốt gần nhất dùng để quay lui.

## 1. Mục đích và thẩm quyền

Đây là điểm vào duy nhất cho bộ thiết kế Programming được chuẩn hóa từ hai đầu
vào yêu cầu:

- [`DDC24-PRG-PRODUCT-SPEC-001` v2.2](../CHUONG_YEU_CAU/PROGRAMMING_PRODUCT_SPEC_MK-DDC-24.md);
- [`DDC24-PRG-UX-DESIGN-001` v2.2](../CHUONG_YEU_CAU/PROGRAMMING_UI_UX_UC_DESIGN_MK-DDC-24.md).

Hai đầu vào trên và toàn bộ bộ thiết kế này được phê duyệt làm baseline
implementation bởi `AUTH-PROG-2026-08-11-03`; Product authority là
[`PROD-PROG-001`](../01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md) cùng
ADR-020/023. Bộ hồ sơ không tự chứng minh code đã chạy và không tạo tuyên bố
chứng nhận IEC/ISO.

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
| Product/PM/CTO | Product v2.2 + [SRS](../02_requirements/PROGRAMMING_REQUIREMENTS_SPEC.md) | Open Decisions → Risk → Traceability |
| Kiến trúc sư | [Architecture](../03_architecture/PROGRAMMING_ARCHITECTURE.md) | Data Model → Interface → FW-SOM → Verification |
| FE | [UI/UX](../04_uiux/PROGRAMMING_UI_UX_DESIGN.md) | FE Design → Interface → Data Model → Verification |
| BE | [BE Design](software/PROGRAMMING_BE_DESIGN.md) | Data Model → Interface → Operations → Verification |
| FW-SOM/Core | [FW-SOM Design](software/PROGRAMMING_FW_SOM_DESIGN.md) | Interface → ST/IR/Task component specs → Verification |
| FW MCU | [FW MCU Design](firmware/PROGRAMMING_FW_MCU_DESIGN.md) | IOP contract → HW Design → HIL scenarios |
| HW | [HW Design](../04_design/hardware/PROGRAMMING_HW_DESIGN.md) | MCU Design → IOP contract → HIL scenarios |
| QA/V&V | [Verification Plan](../05_verification/PROGRAMMING_VERIFICATION_PLAN.md) | Requirements → Traceability → Risk → Operations |
| Dev Lead | [Documentation Roadmap](../03_implementation/54_PROGRAMMING_DOCUMENTATION_ROADMAP.md) | trạng thái 22 hồ sơ → hồ sơ upstream của slice → [Implementation Plan](../03_implementation/53_PROGRAMMING_IMPLEMENTATION_PLAN.md) |

## 3. Danh mục hồ sơ có kiểm soát

| ID | Hồ sơ chủ quản | Trách nhiệm | Trạng thái |
|---|---|---|---|
| `PROG-DOCSET-001` | [Programming Design Index](PROGRAMMING_DESIGN_INDEX.md) | quyền tài liệu, danh mục 22 hồ sơ và luồng đọc | `M3` v2.6 — **APPROVED FOR IMPLEMENTATION**; P1 6/6, P2 4/8 |
| `SRS-PROG-001` | [Programming Requirements Specification](../02_requirements/PROGRAMMING_REQUIREMENTS_SPEC.md) | 60 requirement phân bổ theo layer, tiêu chí chấp nhận, ngưỡng khả dụng | `M3` v0.6 — **APPROVED FOR IMPLEMENTATION** |
| `PROG-OD-001` | [Programming Open Decisions](../00_governance/PROGRAMMING_OPEN_DECISIONS.md) | 17 quyết định Product/System | `M3` v0.9 — `17 DECIDED`, `0 OPEN`, `0 CLOSED` |
| `ARCH-PROG-001` | [Programming Architecture](../03_architecture/PROGRAMMING_ARCHITECTURE.md) | context, ownership, process, failure boundary, cutover | `M3` v0.7 — 6/6 ADR `Accepted`; **APPROVED FOR IMPLEMENTATION** |
| `DM-PROG-001` | [Programming Data Model](software/PROGRAMMING_DATA_MODEL.md) | Project/Draft/Revision/Artifact/Runtime/Audit | `M3` v0.5 — SQLite store/migration/backup As-Built; service/worker/target còn mở |
| `IFSPEC-PROG-001` | [Programming Interface Specification](interfaces/PROGRAMMING_INTERFACE_SPEC.md) | REST/WS/internal control/error/idempotency contracts | `M3` v0.9 — OpenAPI/IPC/error catalog foundation `TASK-PROG-100..103 DONE` |
| `DDD-LANG-PROG-001` | [Language/Compiler Design](software/PROGRAMMING_LANGUAGE_COMPILER_DESIGN.md) | ST/FBD subset, type, diagnostic, common IR và compiler | `M3` v0.7 — ST/FBD common IR + artifact provenance `TASK-PROG-200..203 DONE`; local POU/worker còn mở |
| `IFSPEC-ART-PROG-001` | [Artifact/Loader Spec](interfaces/PROGRAMMING_ARTIFACT_LOADER_SPEC.md) | artifact layout, bounded loader, stage/load/swap/reject | `M3` v0.7 — loader/type/manifest/source map host `TASK-PROG-102/200/203 DONE`; production stage/swap còn mở |
| `DDD-CTRL-PROG-001` | [Control Semantics](software/PROGRAMMING_CONTROL_SEMANTICS.md) | scan order, priority, PID, hold-last, overrun, transition | `M3` — **APPROVED FOR IMPLEMENTATION** |
| `DDD-LIFE-PROG-001` | [Runtime Lifecycle](software/PROGRAMMING_RUNTIME_LIFECYCLE_DESIGN.md) | Check/Commission/Restore/RETAIN/LKG/restart/power-loss | `M3` — **APPROVED FOR IMPLEMENTATION** |
| `UX-WEB-PROG-001` | [Programming UI/UX Design](../04_uiux/PROGRAMMING_UI_UX_DESIGN.md) | IA bốn workspace, tám journey, asset visual PGM-01..04, copy, states, responsive, accessibility | `M3` v0.8 — **APPROVED FOR IMPLEMENTATION**; browser evidence thu khi có FE runtime |
| `DDD-FE-PROG-001` | [Programming FE Design](software/PROGRAMMING_FE_DESIGN.md) | React feature, state/query/mutation, error recovery | `M3` v0.8 — FBD keyboard component Task 201; route/API/browser còn mở |
| `DDD-BE-PROG-001` | [Programming BE Design](software/PROGRAMMING_BE_DESIGN.md) | Go service, persistence, compiler job, RBAC/audit | `M3` v0.7 — store As-Built; wiring/service/worker còn mở |
| `DDD-FWSOM-PROG-001` | [Programming FW-SOM Design](software/PROGRAMMING_FW_SOM_DESIGN.md) | compiler/runtime boundary, scheduler, activation, RETAIN | `M3` — **APPROVED FOR IMPLEMENTATION**; target evidence thu theo task |
| `DDD-FWMCU-PROG-001` | [Programming FW MCU Design](firmware/PROGRAMMING_FW_MCU_DESIGN.md) | IOP continuity, sampling/actuation, safe-timeout, diag | `M3` — **APPROVED FOR IMPLEMENTATION**; HIL là evidence P6 |
| `DDD-HW-PROG-001` | [Programming HW Design](../04_design/hardware/PROGRAMMING_HW_DESIGN.md) | electrical constraints và điểm đo HIL | `M3` — **APPROVED FOR IMPLEMENTATION**; HW/HIL triển khai song song |
| `DDD-SEC-PROG-001` | [Security Design](software/PROGRAMMING_SECURITY_DESIGN.md) | trust boundary, RBAC, integrity, sandbox, audit và abuse case | `M3` — **APPROVED FOR IMPLEMENTATION**; TLS evidence theo security DoD |
| `VVP-PROG-001` | [Programming Verification Plan](../05_verification/PROGRAMMING_VERIFICATION_PLAN.md) | test level, 32 scenario gồm usability, evidence và release gate | `M3` v0.9 — **APPROVED FOR IMPLEMENTATION**; 2 record BLOCKED, 0/32 PASS |
| `OPS-PROG-001` | [Programming Operations Runbook](../06_operations/PROGRAMMING_OPERATIONS_RUNBOOK.md) | backup, commission, restore, replacement, incident | `M3` — **APPROVED FOR IMPLEMENTATION**; diễn tập theo P6 |
| `RSK-PROG-001` | [Programming Risk Register](../07_records/PROGRAMMING_RISK_REGISTER.md) | rủi ro, kiểm soát, owner và residual gate | `M3` v1.1 — RSK-006 treatment partial thêm artifact manifest/hash/source-map; residual giữ nguyên |
| `TRACE-PROG-001` | [Programming Traceability Matrix](../07_records/PROGRAMMING_TRACEABILITY_MATRIX.md) | Requirement → Design → Interface → Test → Evidence | `M3` v3.7 — 2/60 `I=Y`; 2 record BLOCKED, 0/32 PASS |
| `PLAN-PROG-053` | [Programming Implementation Plan](../03_implementation/53_PROGRAMMING_IMPLEMENTATION_PLAN.md) | slice, dependency, RACI, entry/exit gate | `M3` v0.27 — P2 4/8; next `TASK-PROG-204` |

Tiến độ tạo, hoàn thiện, review và phê duyệt đúng 22 hồ sơ trên được quản lý tại
[`PLAN-PROG-DOC-054`](../03_implementation/54_PROGRAMMING_DOCUMENTATION_ROADMAP.md).
Roadmap là tracker ngoài baseline, không được tính thành hồ sơ thứ 23.

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
   Check, Commission, trace hoặc replacement route Rev A.
6. Graph và Programming không được cùng sở hữu Local logic. Cutover chỉ có
   `GRAPH_ONLY`, `PROGRAM_ONLY`, còn yêu cầu dual-run phải bị từ chối.
7. Mọi output Program đi qua priority resolver ở mức Local logic 5; không có
   đường tắt từ compiler/runtime ra IOP hoặc MCU.

## 5. Trạng thái hiện tại và cổng sử dụng

| Nội dung | As-Built đã xác nhận | Trạng thái thiết kế |
|---|---|---|
| Graph production path | Có, bootstrap nạp `graph.json` | Legacy; cần cutover contract |
| ST parser/semantic/IR/artifact/scheduler/RETAIN/trace component | Task 200 đã đủ sáu type target, exact diagnostic/source map và host fuzz | Supporting component; FBD/worker/production wiring/target còn mở |
| FBD | Chưa có production compiler/editor | Thiết kế mới, gate G1 |
| Programming REST/WS + persistence | OpenAPI/route contract-only + SQLite store v1 + join contract có source; flag OFF, store chưa wiring | G1 GO; service/worker/API runtime thuộc G2 |
| MCU IOP safe timeout | Có code thuần `200 ms` | BSP/HIL vật lý còn RED |
| FE Programming | Chỉ có trang placeholder | Thiết kế mới, gate G3/G4 |

Team được implement/merge theo `AUTH-PROG-2026-08-11-03` và task card Plan 53.
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

## 11. Phụ lục — Tự kiểm cổng M3 (loại: Kiểm soát tài liệu)

Đây là **tự kiểm của chủ quản**, không phải review record. Review liên chức năng
nằm ở [`PROG-REV-2026-08-09`](../07_records/reviews/PROGRAMMING_DESIGN_SET_REVIEW_2026-08-09.md).

| Cổng | Kết quả | Bằng chứng trong file / lý do |
|---|---|---|
| Register đủ và không có file ẩn | PASS | §3 liệt kê đúng 22 hồ sơ; harness xác nhận 22/22 đường dẫn tồn tại |
| ID tài liệu ổn định, không trùng | PASS | 22 ID `*-PROG-*` duy nhất; harness `duplicate doc ID = 0` |
| Thẩm quyền từng nội dung là duy nhất | PASS | §3 cột “Trách nhiệm” gán một chủ quản cho mỗi chủ đề; §4 khóa 7 ranh giới |
| Luồng đọc theo vai trò | PASS | §2 phủ Product, Architect, FE, BE, FW-SOM, FW MCU, HW, QA, Dev Lead |
| Link nội bộ sạch | PASS | harness: local link missing `0`, anchor missing `0` |
| Trạng thái từng hồ sơ phản ánh đúng mức | PASS | §3 cột “Trạng thái” đồng bộ với bảng master Plan 54 §4 |
| Không claim chứng nhận | PASS | §6 ghi rõ “căn chỉnh theo hướng ISO, không phải tuyên bố chứng nhận” |
| Quyền implementation | PASS | §8–§9: maturity/signature còn thiếu được ghi trung thực nhưng đã `WAIVED FOR IMPLEMENTATION`; không còn blocker approval |

Cổng M4/M5 chưa có evidence để nâng maturity, nhưng đã được miễn khỏi entry
implementation. Toàn bộ hồ sơ trong register được dùng làm baseline v2.8 để
implement ngay theo `AUTH-PROG-2026-08-11-03`.
