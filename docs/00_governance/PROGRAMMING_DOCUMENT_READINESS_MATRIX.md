# Ma trận sẵn sàng tài liệu Programming thống nhất

| Thuộc tính | Giá trị |
|---|---|
| ID | `PROG-DRM-001` |
| Phiên bản | 2.6 |
| Trạng thái | **Baseline ADR-050 và PGM-02 v2.2 exact-pinned cho implementation; `T59-801`/`T59-802=DONE`, `T59-803=READY`, R1→R2→R3; `RELEASE_READY=NO-GO`** |
| Ngày | 2026-08-25 |
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

- Mười hai quyết định unified của baseline vẫn CLOSED. Change request và exact
  pin PGM-02 đã đóng bằng `AUTH-PROG-2026-08-24-05` tại Candidate `413a043`.
  `F-P59-GHOST-POU-001` đã RESOLVED về policy và **đã sửa xong corrective
  source/test (2026-08-25)**; `IMPLEMENTATION_CLOSE` vẫn PENDING vì R1 mới đóng
  `T59-802`.
- `T59-801` đã hoàn tất formal DDD, machine-readable contract, `ADR-053`
  Accepted, 89 requirement/47 scenario, asset và 17-file pin set.
- `T59-802..817` là 16 task authority tách theo R1/R2/R3; quyền implementation
  đã mở nhưng scheduler chỉ cho task có predecessor hoàn tất chuyển `READY`.
  `T59-802` (vỏ/route/resolver/mobile read-only) đã `DONE (HOST/LOCAL)`;
  `T59-803` chuyển `READY`.
- Task phụ thuộc code dùng `ORDERED`, tự chuyển `READY` khi dependency hoàn tất.
- CI được Product Owner cho phép `WAIVED/DEFERRED BY OWNER` trong phạm vi đóng
  implementation; đây không phải CI PASS và không mở release.
- Lab Forlinx hiện dùng MCU FAKE vì chưa có MCU/FW/phần cứng; physical MCU/HIL
  được defer, không đổi scenario target/HIL thành PASS.
- Corrective `F-P59-GHOST-POU-001` đã có source/test fail-closed và đo lại
  2026-08-25 (`ctest` 1297/1297, Go vet/test PASS, pytest catalog 9/9, G1
  10/10). `IMPLEMENTATION_CLOSE` vẫn PENDING vì phần còn lại của R1
  (`T59-803..809`) chưa chạy.
- As-Built một Program/bốn workspace được giữ làm migration fact, không phải
  Product Target.

## 1. Ma trận authority

| Lớp | Authority hiện hành | Nội dung đã khóa | Gate |
|---|---|---|---|
| Product | `PROD-PROG-001` v3.0 | Một Product; capacity 32/16; POU; library; signal; lifecycle; six-workspace IA | PASS |
| Decision | `ADR-050`; `DEC-PROG-REGISTER-001` v1.4 + `ADR-053` Accepted | 12 unified CLOSED; change request/exact pin CLOSED; ghost policy RESOLVED, corrective pending | PASS cho implementation; release độc lập |
| Requirement | `SRS-PROG-001` v1.2 | 82 baseline + 7 PGM-02 = 89 requirement | PASS cho implementation; evidence pending |
| Detailed Design | `DDD-SW-PROG-UNIFIED-001` v1.3 + `DDD-SW-PGM02-WORKSPACE-001` v0.3 | Formal model/contract/state/algorithm/error/security/source/test/rollback PGM-02 đã exact-pin | M3 / AUTHORIZED FOR IMPLEMENTATION; không phải M4/M5 |
| UX | `UX-WEB-PROG-001` v2.2 + ba SVG/handoff v2.2 | Route/mode/POU/Quick Library/ST/FBD/LIVE/SIMULATE/mobile state Target | Target approved for implementation; chưa phải As-Built |
| Compiler | `DDD-LANG-PROG-001` v1.0 | User Function/FB, purity, instance state, call graph và artifact v2 | PASS |
| Verification | `VVP-PROG-001` v2.2 | 32 legacy + 12 unified + 3 PGM-02 = 47 scenario; `U13..U15` NOT_RUN | Plan authorized; evidence pending |
| Traceability | `TRACE-PROG-001` v6.9 | 89/89 requirement và 47/47 scenario join máy; bảy dòng PGM-02 chỉ `D=Y`, `I/T/P/R=N` | PASS consistency; implementation/evidence pending |
| Risk | `RSK-PROG-001` v4.24 | 23/23 risk Open; `RSK-PROG-023` nối DDD/ADR/U15/task R3; không residual nào được hạ | PASS register; release/cutover NO-GO |
| Execution | `PLAN-PROG-059` v2.7 | 69 authority card/9 Wave; `T59-801=DONE`, `T59-802=READY`; R2/R3 đợi dependency | PASS theo scheduler; release độc lập |
| Autonomous prompt | `PROMPT-PLAN59-AUTONOMOUS` v2.1 | Chọn task, thực thi, kiểm chứng, commit/PR và cập nhật tracker W0..W8 | READY |

### 1.1 Scoped gate PGM-02 v2.2

| Scope | Change request | Work package được mở | `PLAN_READY` | `IMPLEMENT_READY` | `RELEASE_READY` |
|---|---|---|---|---|---|
| `PGM02-V22` | **OWNER + ARCHITECT APPROVED — `AUTH-PROG-2026-08-24-05`** | Candidate `413a043` exact-pinned; `T59-801=DONE`, `T59-802=READY`; task sau `ORDERED` theo dependency | **PASS** | **R1/R2/R3 GO; thực thi tuần tự** | **NO-GO** |

`T59-801` đã inventory/reconcile và lập baseline/task downstream. Quyền code
được mở ở revision exact-pinned, nhưng không task nào được vượt predecessor:
R1 phải đóng trước R2, R2 phải đóng trước R3. Waiver review chỉ áp dụng entry
implementation; không thay chữ ký Test Result, target/HIL hoặc release.

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
| `IMPLEMENTATION_CLOSE` | **PENDING** | Policy ghost-POU đã chốt; cần sửa compiler-packager/error catalog/test theo `ST-POU-005`, chạy affected/full gate + pin PASS |
| `TARGET_FAKE_MCU_DEPLOY` | **PARTIAL** | deploy/read-back `fa1f5f4` đã có trên Forlinx `MCU_MODE=FAKE`; còn rollback đầy đủ binary+DB trên bo |
| `TARGET_FAKE_MCU_SOAK` | **NOT_RUN** | chạy đủ 24 h, raw JSONL/hash/provenance, fault/signal/restart và `max_iop_poll_gap <200 ms` |
| `RELEASE_READY` | **NO-GO** | CI, formal Test Result, residual acceptance và mọi Must target/HIL/physical theo VVP; waiver đóng implementation không thay điều kiện release |

`PLAN_READY` và ba `IMPLEMENT_READY` của PGM-02 đã PASS theo AUTH; điều này chỉ
trao quyền làm việc trong scope exact-pinned, không chứng minh implementation.
`TARGET_FAKE_MCU_DEPLOY`
và soak chứng minh profile lab, không phải MCU vật lý/HIL. Formal VVP giữ 12
scenario unified `NOT_RUN` cho tới khi có Test Result đúng thẩm quyền.

## 5. Lịch sử

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 2.6 | 2026-08-25 | Ghi `T59-802 DONE (HOST/LOCAL)` cho vỏ/route canonical/resolver/mobile read-only PGM-02 và `T59-803 READY`; đóng corrective `F-P59-GHOST-POU-001` ở lớp source/test. `IMPLEMENTATION_CLOSE` giữ PENDING (còn `T59-803..809`), MCU FAKE PARTIAL và `RELEASE_READY=NO-GO` không đổi. |
| 2.5 | 2026-08-24 | Ghi `AUTH-PROG-2026-08-24-05`: exact pin Candidate `413a043`, `T59-801=DONE`, `T59-802=READY`, mở cả ba IMPLEMENT_READY nhưng giữ dependency R1→R2→R3; ghost-POU chỉ đóng quyết định, corrective/evidence/release vẫn PENDING/NO-GO. |
| 2.4-candidate | 2026-08-24 | Ghi review package PGM-02 gồm 17 authority file Candidate, 89 requirement/47 scenario, formal DDD/contract/ADR-053 và 16 card `T59-802..817`; chuyển `T59-801` sang REVIEW, giữ exact pin/PLAN_READY/IMPLEMENT_READY PENDING/NO-GO. |
| 2.3 | 2026-08-24 | Tách scoped gate PGM-02 v2.2: Owner approved change request và chỉ `T59-801` READY; Architect pin, `PLAN_READY[PGM02-V22]` và mọi `IMPLEMENT_READY[R1/R2/R3]` giữ PENDING/NO-GO. Đồng bộ Plan59 53 task/9 Wave, Risk 23/23 Open, Trace v6.7 và mở lại `IMPLEMENTATION_CLOSE=PENDING` vì `F-P59-GHOST-POU-001`; deploy MCU FAKE giữ PARTIAL, release NO-GO. |
| 2.2 | 2026-08-24 | Đồng bộ Plan59 52 task; thêm bốn lớp trạng thái implementation close/deploy MCU FAKE/soak/release; ghi CI owner-deferred, physical MCU/HIL deferred và soak 24 h chưa PASS. |
| 1.0..1.2 | 2026-08-15 | Ma trận theo Plan 56, có ba hồ sơ thiếu và Product authority treo; superseded. |
| 2.0 | 2026-08-20 | Hợp nhất một Product; đóng mọi decision/document blocker; chuyển authority thực thi sang Plan59 và tách evidence queue khỏi implementation readiness. |
| 2.1 | 2026-08-21 | Đồng bộ Plan59 v2.1 và trạng thái W5 HOST/LOCAL; không đổi Product/SRS/DDD/VVP, không biến host test thành GitHub CI/target/HIL/Test Result và giữ `RELEASE_READY=NO-GO`. |
