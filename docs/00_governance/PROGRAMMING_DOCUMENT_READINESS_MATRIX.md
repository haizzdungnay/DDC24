# Ma trận sẵn sàng tài liệu Programming thống nhất

| Thuộc tính | Giá trị |
|---|---|
| ID | `PROG-DRM-001` |
| Phiên bản | 2.1 |
| Trạng thái | **Active — `PLAN_READY=PASS`, `IMPLEMENT_READY=PASS`** |
| Ngày | 2026-08-21 |
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
- CI account, board, credential, HIL và người ký là `EVIDENCE_QUEUE`; không dừng
  các task code khác, nhưng vẫn giữ `RELEASE_READY=NO-GO` đến khi có bằng chứng.
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
| Traceability | `TRACE-PROG-001` v4.0 | 22 target requirement nối Plan59 và `VS-PROG-U01..U12` | PASS |
| Risk | `RSK-PROG-001` v3.0 | 22 risk, thêm multi-Program/POU/library/signal/output/power-loss | PASS |
| Execution | `PLAN-PROG-059` v2.1 | 51 task, 8 Wave, một tracker duy nhất; W5 đã có source/evidence HOST/LOCAL | PASS cho implementation; `RELEASE_READY` vẫn NO-GO |
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

## 4. Cổng phát hành

`PLAN_READY` và `IMPLEMENT_READY` đã PASS **không đồng nghĩa** ứng dụng đã release.
`RELEASE_READY` chỉ GO khi W0..W6 hoàn tất trên cùng RC và W7 có CI, target/HIL,
AO/DO vật lý ST+FBD, power-cut/RETAIN/LKG, fresh install/upgrade/rollback, soak,
provenance, security và Test Result có thẩm quyền. Thiếu một evidence Must thì
NO-GO, nhưng team vẫn tiếp tục mọi việc implement/test còn khả thi.

## 5. Lịch sử

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0..1.2 | 2026-08-15 | Ma trận theo Plan 56, có ba hồ sơ thiếu và Product authority treo; superseded. |
| 2.0 | 2026-08-20 | Hợp nhất một Product; đóng mọi decision/document blocker; chuyển authority thực thi sang Plan59 và tách evidence queue khỏi implementation readiness. |
| 2.1 | 2026-08-21 | Đồng bộ Plan59 v2.1 và trạng thái W5 HOST/LOCAL; không đổi Product/SRS/DDD/VVP, không biến host test thành GitHub CI/target/HIL/Test Result và giữ `RELEASE_READY=NO-GO`. |
