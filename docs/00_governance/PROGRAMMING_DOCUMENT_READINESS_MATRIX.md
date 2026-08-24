# Ma trận sẵn sàng tài liệu Programming thống nhất

| Thuộc tính | Giá trị |
|---|---|
| ID | `PROG-DRM-001` |
| Phiên bản | 2.4-candidate |
| Trạng thái | **Baseline ADR-050 Active `PLAN/IMPLEMENT_READY=PASS`; PGM-02 v2.2 Candidate 17-file set đang REVIEW, R1/R2/R3 NO-GO; `RELEASE_READY=NO-GO`** |
| Ngày | 2026-08-24 |
| Chủ quản | System Engineering + Document Control |
| Product authority | [`PROD-PROG-001` v3.0](../01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md) |
| Design authority | [`DDD-SW-PROG-UNIFIED-001`](../02_design/software/PROGRAMMING_UNIFIED_PRODUCT_DETAILED_DESIGN.md) |
| Execution authority | [`PLAN-PROG-059`](../03_implementation/59_PROGRAMMING_DOC_TO_CODE_IMPLEMENTATION_PLAN.md) |

## 0. Kết luận

Programming chỉ có **một Product**, không chia phiên bản phạm vi kiểu A/B. Bộ tài
liệu đã khóa đủ quyết định để team triển khai ngay: đa Program, ba loại POU
`PROGRAM`/`FUNCTION`/`FUNCTION_BLOCK`, Control Library, Published Signal,
Enable/Disable, scheduling, output ownership, RETAIN, trace, sáu workspace và
cổng phát hành.

- Mười hai quyết định unified của baseline vẫn CLOSED. Hai record hiện OPEN:
  `CR-PROG-PGM02-V22-001` chờ Architect pin baseline sau `T59-801`, và
  `F-P59-GHOST-POU-001` chờ Owner chọn semantics package.
- `T59-801` đã tạo formal DDD, machine-readable contract, `ADR-053` Proposed,
  89 requirement/47 scenario, asset và 17-file Candidate pin set. Đây là
  **review package**, chưa phải exact pin hoặc quyền code.
- `T59-802..817` là 16 card downstream Candidate được tách theo R1/R2/R3; không
  card nào có execution authority hoặc tự chuyển `READY`/`ORDERED`.
- Task phụ thuộc code dùng `ORDERED`, tự chuyển `READY` khi dependency hoàn tất.
- CI được Product Owner cho phép `WAIVED/DEFERRED BY OWNER` trong phạm vi đóng
  implementation; đây không phải CI PASS và không mở release.
- Lab Forlinx hiện dùng MCU FAKE vì chưa có MCU/FW/phần cứng; physical MCU/HIL
  được defer, không đổi scenario target/HIL thành PASS.
- Corrective source tại `fa1f5f4` từng qua full host gate, nhưng
  `IMPLEMENTATION_CLOSE` hiện PENDING trở lại vì `F-P59-GHOST-POU-001` chưa có
  quyết định và affected gate theo semantics được duyệt.
- As-Built một Program/bốn workspace được giữ làm migration fact, không phải
  Product Target.

## 1. Ma trận authority

| Lớp | Authority hiện hành | Nội dung đã khóa | Gate |
|---|---|---|---|
| Product | `PROD-PROG-001` v3.0 | Một Product; capacity 32/16; POU; library; signal; lifecycle; six-workspace IA | PASS |
| Decision | Baseline `ADR-050`; Candidate `DEC-PROG-REGISTER-001` v1.2 + `ADR-053` Proposed | 12 unified CLOSED; 2 scoped record OPEN; Simulation isolation decision chờ exact pin | PASS cho baseline; PGM-02 PENDING |
| Requirement | `SRS-PROG-001` v1.1-candidate | 82 baseline + 7 PGM-02 Candidate = 89 requirement | PASS baseline; Candidate review pending |
| Detailed Design | Baseline `DDD-SW-PROG-UNIFIED-001` v1.1; overlays v1.2-candidate + `DDD-SW-PGM02-WORKSPACE-001` | Formal model/contract/state/algorithm/error/security/source/test/rollback PGM-02 đã có; `DD-13` exact pin pending | PASS baseline; Candidate M2/REVIEW |
| UX | `UX-WEB-PROG-001` v2.1-candidate + ba SVG/handoff v2.2 | Route/mode/POU/Quick Library/ST/FBD/LIVE/SIMULATE/mobile state Target | PASS baseline; Candidate asset review/pin pending |
| Compiler | `DDD-LANG-PROG-001` v1.0 | User Function/FB, purity, instance state, call graph và artifact v2 | PASS |
| Verification | `VVP-PROG-001` v2.1-candidate | 32 legacy + 12 unified + 3 PGM-02 Candidate = 47 scenario; `U13..U15` NOT_RUN | PASS baseline; Candidate review/evidence pending |
| Traceability | `TRACE-PROG-001` v6.8-candidate | 89/89 requirement và 47/47 scenario join máy; bảy dòng PGM-02 chỉ `D=Y`, `I/T/P/R=N` | PASS consistency; PGM-02 implementation pending |
| Risk | `RSK-PROG-001` v4.22-candidate | 23/23 risk Open; `RSK-PROG-023` nối DDD/ADR/U15/card R3; không residual nào được hạ | PASS register; PGM-02 code/release NO-GO |
| Execution | `PLAN-PROG-059` v2.6-candidate | 69 card/9 Wave = 53 authority + 16 downstream Candidate; `T59-801` REVIEW | baseline theo task hiện hành; `T59-802..817` NO EXECUTION |
| Autonomous prompt | `PROMPT-PLAN59-AUTONOMOUS` v2.0 | Chọn task, thực thi, kiểm chứng, commit/PR và cập nhật tracker | READY |

### 1.1 Scoped gate PGM-02 v2.2

| Scope | Change request | Work package được mở | `PLAN_READY` | `IMPLEMENT_READY` | `RELEASE_READY` |
|---|---|---|---|---|---|
| `PGM02-V22` | **OWNER_APPROVED / ARCHITECT_PENDING** | Chỉ `PGM02-V22-WP-00` qua `T59-801=REVIEW`; `T59-802..817` chỉ Candidate | **PENDING** | **R1/R2/R3 NO-GO** | **NO-GO** |

`T59-801` chỉ được inventory/reconcile và lập baseline/card downstream. Việc tạo
Candidate không cho phép viết production code, đổi route Active, đưa Simulation
vào runtime hoặc tự gắn `READY`/`ORDERED` cho R1/R2/R3. Điều kiện mở là exact revision/hash của
Product/SRS/Architecture/DDD/UX/contracts/Risk/Trace/VVP/Plan59 được Product
Owner + System Architect review/pin và không còn conflict P0.

## 2. Disposition tài liệu cũ

| Hồ sơ | Disposition | Lý do |
|---|---|---|
| Candidate Product Spec Hybrid | **Removed** | Đã hợp nhất nội dung hợp lệ vào Product Spec v3.0; không giữ authority thứ hai. |
| Audit implementation/spec/roadmap chưa kiểm soát | **Removed** | Có overclaim và metric sai; finding đúng đã chuyển vào Product/SRS/DDD/Plan59. |
| Plan 53, Plan 54, Plan 56, tracker WP | **Superseded** | Chỉ giữ truy nguyên As-Built/commit cũ; không quản công việc tương lai. |
| Task G1 re-pin rời | **Removed** | Hợp nhất vào `T59-001`, tránh hai task authority cho cùng phạm vi. |
| Manifest candidate P0 cũ | **Superseded** | Thay bằng manifest baseline Programming thống nhất ngày 2026-08-20. |

Không xoá lịch sử đã merge nếu nó còn là bằng chứng của lần triển khai cũ. Khi
nội dung lịch sử xung đột với authority trong §1, authority mới thắng.

## 3. Definition of Ready tài liệu

Một dev chưa tham gia thiết kế có thể bắt đầu task Plan59 mà không phải tự chọn
Product semantics:

1. capacity, ownership và lifecycle đã định lượng;
2. data/contract/state/error/rollback đã xác định;
3. source target và dependency cấm đã chỉ rõ;
4. positive/negative/fault/target acceptance đã có ID;
5. mọi dependency còn lại là output task trước, không phải quyết định con người.

Nếu implementation làm lộ constraint mới, team cập nhật cùng Product/SRS/DDD/
Plan59 trong change-set đó; không tạo Open Decision mới chỉ để trì hoãn sửa lỗi.

## 4. Phân lớp đóng implementation, target và phát hành

| Cổng | Trạng thái 2026-08-24 | Điều kiện đổi trạng thái |
|---|---|---|
| `IMPLEMENTATION_CLOSE` | **PENDING** | Owner chốt `F-P59-GHOST-POU-001`; đồng bộ semantics SRS/DDD/contract/compiler-packager/test và chạy affected/full gate + pin PASS |
| `TARGET_FAKE_MCU_DEPLOY` | **PARTIAL** | deploy/read-back `fa1f5f4` đã có trên Forlinx `MCU_MODE=FAKE`; còn rollback đầy đủ binary+DB trên bo |
| `TARGET_FAKE_MCU_SOAK` | **NOT_RUN** | chạy đủ 24 h, raw JSONL/hash/provenance, fault/signal/restart và `max_iop_poll_gap <200 ms` |
| `RELEASE_READY` | **NO-GO** | CI, formal Test Result, residual acceptance và mọi Must target/HIL/physical theo VVP; waiver đóng implementation không thay điều kiện release |

`PLAN_READY` và `IMPLEMENT_READY` của baseline ADR-050 chỉ trao quyền làm việc
trong scope đã pin; không tự áp dụng cho PGM-02 v2.2. `TARGET_FAKE_MCU_DEPLOY`
và soak chứng minh profile lab, không phải MCU vật lý/HIL. Formal VVP giữ 12
scenario unified `NOT_RUN` cho tới khi có Test Result đúng thẩm quyền.

## 5. Lịch sử

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 2.4-candidate | 2026-08-24 | Ghi review package PGM-02 gồm 17 authority file Candidate, 89 requirement/47 scenario, formal DDD/contract/ADR-053 và 16 card `T59-802..817`; chuyển `T59-801` sang REVIEW, giữ exact pin/PLAN_READY/IMPLEMENT_READY PENDING/NO-GO. |
| 2.3 | 2026-08-24 | Tách scoped gate PGM-02 v2.2: Owner approved change request và chỉ `T59-801` READY; Architect pin, `PLAN_READY[PGM02-V22]` và mọi `IMPLEMENT_READY[R1/R2/R3]` giữ PENDING/NO-GO. Đồng bộ Plan59 53 task/9 Wave, Risk 23/23 Open, Trace v6.7 và mở lại `IMPLEMENTATION_CLOSE=PENDING` vì `F-P59-GHOST-POU-001`; deploy MCU FAKE giữ PARTIAL, release NO-GO. |
| 2.2 | 2026-08-24 | Đồng bộ Plan59 52 task; thêm bốn lớp trạng thái implementation close/deploy MCU FAKE/soak/release; ghi CI owner-deferred, physical MCU/HIL deferred và soak 24 h chưa PASS. |
| 1.0..1.2 | 2026-08-15 | Ma trận theo Plan 56, có ba hồ sơ thiếu và Product authority treo; superseded. |
| 2.0 | 2026-08-20 | Hợp nhất một Product; đóng mọi decision/document blocker; chuyển authority thực thi sang Plan59 và tách evidence queue khỏi implementation readiness. |
| 2.1 | 2026-08-21 | Đồng bộ Plan59 v2.1 và trạng thái W5 HOST/LOCAL; không đổi Product/SRS/DDD/VVP, không biến host test thành GitHub CI/target/HIL/Test Result và giữ `RELEASE_READY=NO-GO`. |
