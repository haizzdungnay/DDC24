# Ma trận sẵn sàng tài liệu Programming thống nhất

| Thuộc tính | Giá trị |
|---|---|
| ID | `PROG-DRM-001` |
| Phiên bản | 2.2 |
| Trạng thái | **Active — `PLAN_READY=PASS`, `IMPLEMENT_READY=PASS`, `IMPLEMENTATION_CLOSE=PENDING`, `RELEASE_READY=NO-GO`** |
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

- Không còn Open Decision hoặc `TBD` chặn implementation.
- Task phụ thuộc code dùng `ORDERED`, tự chuyển `READY` khi dependency hoàn tất.
- CI được Product Owner cho phép `WAIVED/DEFERRED BY OWNER` trong phạm vi đóng
  implementation; đây không phải CI PASS và không mở release.
- Lab Forlinx hiện dùng MCU FAKE vì chưa có MCU/FW/phần cứng; physical MCU/HIL
  được defer, không đổi scenario target/HIL thành PASS.
- Corrective source POU/Signal/atomic/Web IPC/library đang ở current worktree;
  phải merge và chạy gate hiện hành trước `IMPLEMENTATION_CLOSE=PASS`.
- As-Built một Program/bốn workspace được giữ làm migration fact, không phải
  Product Target.

## 1. Ma trận authority

| Lớp | Authority hiện hành | Nội dung đã khóa | Gate |
|---|---|---|---|
| Product | `PROD-PROG-001` v3.0 | Một Product; capacity 32/16; POU; library; signal; lifecycle; six-workspace IA | PASS |
| Decision | `ADR-050`, `DEC-PROG-REGISTER-001` | 0 OPEN; compatibility, scheduling, safety, PID, trace và release boundary | PASS |
| Requirement | `SRS-PROG-001` v1.0 | 82 requirement: 60 legacy migration + 22 unified target | PASS |
| Detailed Design | `DDD-SW-PROG-UNIFIED-001` | DD-01..DD-13; model, contract, state, algorithm, error, security, source mapping, rollback | PASS |
| UX | `UX-WEB-PROG-001` v2.0 + asset PGM-02/PGM-04 desktop/mobile | Sáu workspace, POU tree, Control Library, lifecycle states và safe actions | PASS |
| Compiler | `DDD-LANG-PROG-001` v1.0 | User Function/FB, purity, instance state, call graph và artifact v2 | PASS |
| Verification | `VVP-PROG-001` v2.0 | 32 scenario migration + 12 scenario unified; target/HIL authority tách khỏi host | PASS cho implementation; release evidence chờ chạy |
| Traceability | `TRACE-PROG-001` v6.5 | 82/82 requirement và 44/44 scenario có join máy; formal T/P/R chưa nâng | PASS về tài liệu |
| Risk | `RSK-PROG-001` v4.20 | 22/22 risk Open; treatment corrective chưa hạ residual | PASS cho implementation; release NO-GO |
| Execution | `PLAN-PROG-059` v2.4 | 52 task, 8 Wave, một tracker duy nhất; corrective close và target MCU FAKE tách evidence | PASS cho implementation; close pending |
| Autonomous prompt | `PROMPT-PLAN59-AUTONOMOUS` v2.0 | Chọn task, thực thi, kiểm chứng, commit/PR và cập nhật tracker | READY |

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
| `IMPLEMENTATION_CLOSE` | **PENDING** | corrective source POU/Signal/atomic/Web IPC/library merge sạch; affected/full host gate, trace 82/82 và pin PASS |
| `TARGET_FAKE_MCU_DEPLOY` | **PENDING** | build đúng commit, backup/install/service/API/UI/read-back/rollback trên Forlinx; hồ sơ ghi rõ `MCU_MODE=FAKE` |
| `TARGET_FAKE_MCU_SOAK` | **NOT_RUN** | chạy đủ 24 h, raw JSONL/hash/provenance, fault/signal/restart và `max_iop_poll_gap <200 ms` |
| `RELEASE_READY` | **NO-GO** | CI, formal Test Result, residual acceptance và mọi Must target/HIL/physical theo VVP; waiver đóng implementation không thay điều kiện release |

`PLAN_READY` và `IMPLEMENT_READY` chỉ trao quyền làm việc. `TARGET_FAKE_MCU_DEPLOY`
và soak chứng minh profile lab, không phải MCU vật lý/HIL. Formal VVP giữ 12
scenario unified `NOT_RUN` cho tới khi có Test Result đúng thẩm quyền.

## 5. Lịch sử

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 2.2 | 2026-08-24 | Đồng bộ Plan59 52 task; thêm bốn lớp trạng thái implementation close/deploy MCU FAKE/soak/release; ghi CI owner-deferred, physical MCU/HIL deferred và soak 24 h chưa PASS. |
| 1.0..1.2 | 2026-08-15 | Ma trận theo Plan 56, có ba hồ sơ thiếu và Product authority treo; superseded. |
| 2.0 | 2026-08-20 | Hợp nhất một Product; đóng mọi decision/document blocker; chuyển authority thực thi sang Plan59 và tách evidence queue khỏi implementation readiness. |
| 2.1 | 2026-08-21 | Đồng bộ Plan59 v2.1 và trạng thái W5 HOST/LOCAL; không đổi Product/SRS/DDD/VVP, không biến host test thành GitHub CI/target/HIL/Test Result và giữ `RELEASE_READY=NO-GO`. |
