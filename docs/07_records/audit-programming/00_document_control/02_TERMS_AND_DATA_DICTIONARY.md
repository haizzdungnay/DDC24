# Thuật ngữ và từ điển dữ liệu Programming

| Thuộc tính | Giá trị |
|---|---|
| ID | `DICT-PROG-001` |
| Phiên bản | 2.0 |
| Trạng thái | `CONTROLLED / IN REVIEW` |
| Chủ quản | Product + Architecture + UX |
| Nguồn amendment | Product v2.2 §Thuật ngữ; UX v2.2 §Thuật ngữ UX |

## Mục lục

1. Quy tắc dùng thuật ngữ
2. Vòng đời và authoring
3. Runtime, arbitration và cutover
4. Point, Variable và chất lượng
5. Trạng thái kết nối và UI
6. Lịch sử sửa đổi
7. Phê duyệt

## 1. Quy tắc dùng thuật ngữ

Mỗi thuật ngữ dưới đây có một nghĩa duy nhất trong bộ thiết kế. Tên field/API có
thể giữ tiếng Anh; copy người dùng mặc định dùng tiếng Việt. Không dùng
`build/deploy/activate`, `Check/Đưa vào vận hành`, `program_value/actual_value`
thay thế lẫn nhau.

## 2. Vòng đời và authoring

| Thuật ngữ | Nghĩa chuẩn |
|---|---|
| Project | Container kỹ thuật chứa Program, Variable, Point binding, một Task Rev A, metadata và lịch sử Revision. |
| Program | Đơn vị logic ST hoặc FBD được Check và chạy cyclic; không đồng nghĩa Project hay Task. |
| Draft / Đang sửa | Bản có thể thay đổi do backend store trên controller quản lý; browser cache không phải authority; chưa là runtime truth. |
| Check / Kiểm tra | Kiểm source, kiểu, FBD, mapping, Task, library, target, RETAIN và cutover; không thay đổi Active. |
| Candidate | Revision Check đạt và được stage để runtime thẩm định; chưa phải Active. |
| Revision | Snapshot bất biến của source, mapping, Task, library version và metadata. |
| Deployment | Chuyển một Revision đã xác thực tới runtime; chưa đồng nghĩa đang chạy. Thuật ngữ kỹ thuật, không phải primary UI copy. |
| Activation | Chuyển Candidate thành Active tại ranh giới điều khiển; chỉ thành công sau authoritative read-back. |
| Đưa vào vận hành | Primary label người dùng cho yêu cầu Commission/Activation có kiểm soát; khác module **Chạy thử**. |
| Chạy thử | Module Commissioning hiện hữu tạo/quan sát Local manual override mức 2 có TTL; không sửa Program hoặc tự Activate Revision. |
| Khôi phục bản trước | Rollback atomic về Revision tương thích/LKG; không phải online change. |
| Last-Known-Good (LKG) | Revision Active gần nhất được runtime xác nhận hợp lệ và có thể giữ/khôi phục. |
| Functional tag/view | Metadata/view tùy chọn nhóm Program/Point; không phải entity lifecycle thứ tư. |
| User Function Block | FUNCTION_BLOCK do người dùng định nghĩa chỉ cục bộ Project ở Rev A; không phải package/catalogue/shared binary. |

## 3. Runtime, arbitration và cutover

| Thuật ngữ | Nghĩa chuẩn |
|---|---|
| Priority resolver | Resolver sáu mức: 1 Fire/Safety, 2 Local manual, 3 BACnet, 4 Schedule, 5 Local logic, 6 Default. |
| `program_value` | Đóng góp lệnh của Program/Local logic ở mức 5 trước resolver; là trục của hold-last và anti-windup khi arbitration thua. |
| `actual_value` | Giá trị hiệu lực sau resolver/interlock/giới hạn cuối; có thể do mức 1–4 sở hữu và không được seed vào Program mức 5. |
| `overridden_by` | Định danh nguồn ưu tiên đang làm `actual_value` khác `program_value`; rỗng khi mức 5 có hiệu lực và không bị nguồn khác giữ. |
| `effective_priority` | Mức priority của nguồn đang thắng resolver tại sample authority. |
| Base control step | Bước điều khiển bounded của `ScanLoop::step()`; hoàn tất rồi mới kick watchdog; độc lập Task period. |
| Task period | Chu kỳ dispatch Task; Rev A chỉ `1 s`, `5 s`, `30 s`; không được dùng làm sleep/thời gian chờ của base step. |
| Task | Đơn vị lịch cyclic; Rev A có đúng một Task. Multi-task và limit 8/16/32 ngoài Rev A. |
| Cutover | Chuyển quyền sở hữu đóng góp Local logic mức 5 giữa graph legacy và Programming. |
| `GRAPH_ONLY` | Chỉ graph legacy active; không Commission package Programming. |
| `PROGRAM_ONLY` | Chỉ Programming active; graph không thực thi và không sở hữu scan period. |
| `DUAL_INVALID` | Yêu cầu dual-run; phải reject, giữ LKG và không trộn hai đóng góp mức 5. |
| Hold-last | Chụp `previous_program_value`; first `program_value` của Revision mới phải bằng nó trong độ phân giải binding. Không chụp `actual_value`. |
| Back-calculation | Anti-windup khi mức 5 thắng nhưng lệnh cùng đường bị clamp/saturate/rate-limit; tính theo chênh lệch cùng đường lệnh. |
| Freeze integrator | Anti-windup khi mức 5 thua arbitration; giữ integrator, cấm track/seed từ `actual_value` của nguồn thắng. |
| Overrun | Task vượt budget. Ba overrun liên tiếp chỉ fault/degrade Task; plant safe-state cần điều kiện SafetyManager độc lập đã duyệt. |
| `IOP_SAFE_TIMEOUT_MS` | Hard timeout MCU `200 ms`; mất poll làm AO/DO về safe độc lập SOM. Mục tiêu thiết kế `max_iop_poll_gap <=100 ms`, điều kiện bắt buộc `<200 ms`. |

## 4. Point, Variable và chất lượng

| Thuật ngữ | Nghĩa chuẩn |
|---|---|
| Point | Dữ liệu có identity/category/quality thuộc authority I/O/Point Table. Rev A chỉ Local Physical I/O, Virtual Point, Modbus RTU Point. |
| Variable | Dữ liệu có tên trong Program; không mặc nhiên là Point. |
| Binding / I/O Mapping | Quan hệ đã kiểm giữa Variable và Point, gồm identity, category, direction, type, access, unit/range và quality policy. |
| Modbus RTU Point | Point định danh bằng `{device_id, point_id}` trong Bus→Device→Point; không phải Modbus TCP/EXT chung. |
| RETAIN | Thuộc tính Variable yêu cầu phục hồi theo policy restart/compatibility đã phê duyệt; policy còn `OD-PROG-009`. |
| `GOOD/UNCERTAIN/BAD/STALE/OFFLINE/UNKNOWN` | Point quality; `OFFLINE` chỉ dùng cho producer/Point, không phải Programming/core state. Missing không thành valid zero. |

## 5. Trạng thái kết nối và UI

| Trạng thái | Nghĩa chuẩn |
|---|---|
| core `RUNNING` | Web nhận runtime truth có authority và freshness đạt. |
| core `DEGRADED` | Core còn phản hồi nhưng một phần capability/Task/freshness suy giảm; UI phải nêu producer và lý do. |
| core `UNREACHABLE` | Web còn reachable nhưng không liên lạc được core; không gọi là controller Offline. |
| Controller offline | Cả controller/web không truy cập được nên UI trên controller không thể tải; không phải một UI state nội bộ Programming. |
| Unknown / Không xác định | Không đủ authority để xác nhận kết quả/state; không được suy ra success/failure. |

## 6. Lịch sử sửa đổi

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-08 | Thuật ngữ audit ban đầu. |
| 2.0 | 2026-08-09 | Hợp nhất Product/UX v2.2; chuẩn hóa trục mức 5, base step, cutover, IOP và core state. |

## 7. Phê duyệt

| Vai trò | Quyết định |
|---|---|
| Product Owner | `PENDING` |
| Software/Runtime Architect | `PENDING` |
| Controls/Safety Reviewer | `PENDING` |
| UX Lead | `PENDING` |
