# Yêu cầu đề xuất Programming v2.2

| Thuộc tính | Giá trị |
|---|---|
| Tập ID | 41 `PRG-*`; 24 `UX-REQ-*` |
| Phiên bản | 2.2-controlled-1 |
| Trạng thái | `PROPOSED / IN REVIEW` |
| Nguồn thiết kế duy nhất | Product v2.2 §25.1–25.8; UX v2.2 §44 |
| Baseline relation | Không thay `SYS/SWR/IF/NFR-REQ-PROG-*` Active |
| Evidence | `MISSING / VR RED` |

## Mục lục

1. Quy tắc
2. 41 requirement Product/Runtime đề xuất
3. 24 requirement UX đề xuất
4. Coverage và conflict
5. Thuật ngữ
6. Lịch sử
7. Phê duyệt

## 1. Quy tắc

Mỗi hàng là một câu có chủ thể, outcome kiểm chứng và `VS-PROG-*`. `PROPOSED`
không có nghĩa approved. Acceptance định lượng của proposal được đặt trong
scenario catalog, không tạo namespace requirement mới ngoài danh sách được phép.

## 2. Requirement Product/Runtime đề xuất — 41/41

| ID | Yêu cầu quy phạm đề xuất | Baseline upstream gần nhất | Verification | Trạng thái/evidence |
|---|---|---|---|---|
| PRG-BACS-001 | Programming phải hỗ trợ view/tag Nhóm chức năng→Point→Logic có truy nguyên mà không tạo entity bắt buộc. | PR-PROG-001, PR-PROG-007 | VS-PROG-001 | PROPOSED / MISSING |
| PRG-BACS-002 | Programming phải giữ mô tả chức năng và Point reference trong Revision; PDF đầy đủ phải ở ngoài Rev A. | PR-PROG-001, PR-PROG-007 | VS-PROG-001 | PROPOSED / MISSING |
| PRG-BACS-003 | UI phải cung cấp workflow Engineering→Check→Đưa vào vận hành→Run. | PR-PROG-006, PR-PROG-007, PR-PROG-008, PR-PROG-009 | VS-PROG-002 | PROPOSED / MISSING |
| PRG-BACS-004 | Rev A chỉ phải cung cấp Core Control Library có version; BACS Library nâng cao phải ở ngoài scope. | Chưa có PR trực tiếp; CONF-PROG-016 | VS-PROG-003 | PROPOSED / MISSING |
| PRG-BACS-005 | Trạng thái đang vận hành phải ghi active version, target, mapping, actor và timestamp từ authority. | PR-PROG-011, PR-PROG-013 | VS-PROG-004 | PROPOSED / MISSING |
| PRG-IEC-001 | ST và FBD phải dùng chung typed semantic/IR model. | PR-PROG-002, PR-PROG-006; SWR-REQ-PROG-002, SWR-REQ-PROG-003 | VS-PROG-005 | PROPOSED / MISSING |
| PRG-IEC-002 | POU phải hỗ trợ PROGRAM/FUNCTION/User FUNCTION_BLOCK cục bộ Project; Rev A phải từ chối package/catalogue/shared binary FB. | PR-PROG-002, PR-PROG-006 | VS-PROG-007 | PROPOSED / MISSING |
| PRG-IEC-003 | Runtime phải giữ Configuration/Resource/một Task/Program semantics nội bộ. | PR-PROG-005, PR-PROG-006 | VS-PROG-009 | PROPOSED / MISSING |
| PRG-IEC-004 | Validator phải trả diagnostic ổn định cho input quá limit hoặc construct không hỗ trợ và không được crash. | SWR-REQ-PROG-002, SWR-REQ-PROG-003 | VS-PROG-006 | PROPOSED / MISSING |
| PRG-IEC-005 | Pin/connection FBD phải typed, deterministic và thao tác được bằng bàn phím. | SWR-REQ-PROG-003 | VS-PROG-006 | PROPOSED / MISSING |
| PRG-RT-001 | Runtime phải chụp input snapshot coherent cho mỗi control cycle. | PR-PROG-005; SWR-REQ-PROG-006 | VS-PROG-009 | PROPOSED / MISSING |
| PRG-RT-002 | Runtime phải stage, arbitrate và commit Program output một lần ở Local logic mức 5/6. | PR-PROG-004, PR-PROG-005 | VS-PROG-010 | PROPOSED / MISSING |
| PRG-RT-003 | Runtime phải giữ active package hợp lệ khi Candidate không hợp lệ. | PR-PROG-009; SWR-REQ-PROG-008 | VS-PROG-011 | PROPOSED / MISSING |
| PRG-RT-004 | Commission/Restore lỗi phải giữ Last-Known-Good. | PR-PROG-009; SWR-REQ-PROG-008 | VS-PROG-011 | PROPOSED / MISSING |
| PRG-RT-005 | RT execution không được cấp phát không giới hạn hoặc thực hiện blocking external I/O. | SWR-REQ-PROG-006; NFR-REQ-PROG-002 | VS-PROG-012 | PROPOSED / MISSING |
| PRG-RT-006 | Runtime phải phơi overrun/fault; ba overrun chỉ degrade đúng Task, không tự kích plant safe-state, và Check load không được tranh RT path. | PR-PROG-005, PR-PROG-012; SWR-REQ-PROG-006, SWR-REQ-PROG-012 | VS-PROG-013 | PROPOSED / MISSING |
| PRG-RT-007 | Output binding phải phơi `program_value/actual_value/arbitration`; PI/PID phải back-calculate khi mức 5 thắng nhưng saturate, freeze khi thua và cấm track `actual_value`. | PR-PROG-004, PR-PROG-011; IF-REQ-PROG-001, IF-REQ-PROG-002 | VS-PROG-010 | PROPOSED / MISSING |
| PRG-RT-008 | Commission/Restore phải hold-last đóng góp mức 5, giữ IOP poll gap `<200 ms` và cấm sao chép `actual_value` của nguồn khác. | PR-PROG-009; SWR-REQ-PROG-008 | VS-PROG-014 | PROPOSED / MISSING |
| PRG-RT-009 | Graph và Programming không được active đồng thời; cutover phải fail closed và base-step/Task-period/WatchdogSec phải thỏa architecture contract. | PR-PROG-012, PR-PROG-014; SYS-REQ-PROG-001, SYS-REQ-PROG-003 | VS-PROG-015 | PROPOSED / MISSING |
| PRG-RT-010 | Timer phải dùng monotonic time; wall-clock/DST phải do Scheduler authority xử lý. | SWR-REQ-PROG-006, SWR-REQ-PROG-012 | VS-PROG-016 | PROPOSED / MISSING |
| PRG-PT-001 | Binding phải dùng discriminated identity đúng category; RTU phải dùng `{device_id, point_id}`. | PR-PROG-003, PR-PROG-004, PR-PROG-014; IF-REQ-PROG-001 | VS-PROG-017 | PROPOSED / MISSING |
| PRG-PT-002 | Binding phải validate type/direction/writable/unit theo ma trận Control Semantics. | SWR-REQ-PROG-004, SWR-REQ-PROG-005 | VS-PROG-017 | PROPOSED / MISSING |
| PRG-PT-003 | Runtime/UI không được biến Point missing/offline/stale thành valid zero. | PR-PROG-004, PR-PROG-012 | VS-PROG-018 | PROPOSED / MISSING |
| PRG-PT-004 | Programming phải chỉ cho Local Physical I/O, Virtual Point, Modbus RTU Point và từ chối TCP/BACnet. | PR-PROG-014 | VS-PROG-017 | PROPOSED / MISSING |
| PRG-COM-001 | Check phải tổng hợp source, Task, mapping, library, target và cutover readiness. | PR-PROG-006; SWR-REQ-PROG-007 | VS-PROG-019 | PROPOSED / MISSING |
| PRG-COM-002 | UI phải hiển thị structured change manifest và output/RETAIN impact trước execution. | PR-PROG-007, PR-PROG-013 | VS-PROG-019 | PROPOSED / MISSING |
| PRG-COM-003 | UI phải read-back authoritative runtime state trước khi báo kết quả thành công. | PR-PROG-008, PR-PROG-011 | VS-PROG-019 | PROPOSED / MISSING |
| PRG-COM-004 | Restore Previous phải atomic, hold-last mức 5 và được audit. | PR-PROG-009; SWR-REQ-PROG-008 | VS-PROG-011 | PROPOSED / MISSING |
| PRG-COM-005 | Capability/UX phải liệt kê mọi Local manual override active theo Revision/binding, gồm source/actor/TTL/value/priority và link module Chạy thử. | PR-PROG-004, PR-PROG-011; IF-REQ-PROG-001 | VS-PROG-020 | PROPOSED / MISSING |
| PRG-COM-006 | Replacement bundle chỉ được chứa source; importer phải reject artifact, build lại target, kiểm integrity/compatibility và không auto-activate. | PR-PROG-001, PR-PROG-007, PR-PROG-009; CONF-PROG-016 | VS-PROG-021 | PROPOSED / MISSING |
| PRG-SEC-001 | Server phải authorize edit/check/commission/restore theo role. | PR-PROG-008; IF-REQ-PROG-002 | VS-PROG-022 | PROPOSED / MISSING |
| PRG-SEC-002 | Artifact Rev A phải có cryptographic hash/integrity verification; trusted-origin signature phải ở ngoài scope. | PR-PROG-007, PR-PROG-009; SWR-REQ-PROG-008 | VS-PROG-023 | PROPOSED / MISSING |
| PRG-SEC-003 | Hệ thống phải audit critical engineering action và integrity/signature reject. | PR-PROG-013; SWR-REQ-PROG-011 | VS-PROG-022 | PROPOSED / MISSING |
| PRG-SEC-004 | Programming không được hỗ trợ arbitrary native code execution. | SWR-REQ-PROG-008 | VS-PROG-023 | PROPOSED / MISSING |
| PRG-SEC-005 | Draft mutation phải dùng optimistic concurrency và không được last-write-wins. | SWR-REQ-PROG-007; IF-REQ-PROG-002 | VS-PROG-024 | PROPOSED / MISSING |
| PRG-UX-001 | Workflow bình thường phải dùng copy tiếng Việt BACS qua i18n key và không dùng compiler/deployment làm primary term. | PR-PROG-011; SWR-REQ-PROG-010 | VS-PROG-025 | PROPOSED / MISSING |
| PRG-UX-002 | UI phải phân biệt Draft/Candidate với Active runtime truth. | PR-PROG-011 | VS-PROG-026 | PROPOSED / MISSING |
| PRG-UX-003 | UI phải hiển thị `Không xác định/—` khi thiếu producer data. | PR-PROG-012; NFR-REQ-PROG-001 | VS-PROG-026 | PROPOSED / MISSING |
| PRG-UX-004 | UI phải hỗ trợ persona/task độc lập RBAC role và trình bày quyền từ server. | PR-PROG-008, PR-PROG-011 | VS-PROG-022 | PROPOSED / MISSING |
| PRG-UX-005 | UI không được truyền đạt state chỉ bằng màu. | NFR-REQ-PROG-001 | VS-PROG-028 | PROPOSED / MISSING |
| PRG-UX-006 | UI phải dùng core `RUNNING/DEGRADED/UNREACHABLE`; khi cả controller offline thì UI không tải được. | PR-PROG-012; SWR-REQ-PROG-012 | VS-PROG-026 | PROPOSED / MISSING |

## 3. Requirement UX đề xuất — 24/24

| ID | Yêu cầu UX quy phạm đề xuất | UC/mục chủ quản | Verification | Trạng thái/evidence |
|---|---|---|---|---|
| UX-REQ-001 | Workflow/action phải dùng `Kiểm tra`→`Đưa vào vận hành`→`Đang vận hành`, không dùng Compile/Deploy/Activate làm mental model chính. | UC-03/06/08 | VS-PROG-002, VS-PROG-025 | PROPOSED / MISSING |
| UX-REQ-002 | IA phải có sáu navigation entry PGM-01..06; PGM-06 phải tách Runtime/Theo dõi/Phiên bản & Bảo trì, nhưng page count không là success metric. | UX §4/12/43 | VS-PROG-002 + usability | PROPOSED / MISSING |
| UX-REQ-003 | Persistent context phải hiện controller/project, Draft, Active Revision, dirty/readiness đồng thời; functional tag/view chỉ metadata tùy chọn. | UC-01/02 | VS-PROG-001, VS-PROG-004, VS-PROG-026 | PROPOSED / MISSING |
| UX-REQ-004 | ST editor phải keyboard-first, có source location/symbol/type/search/reference/diagnostic ổn định và không làm mất Draft khi lỗi. | UC-03/06 | VS-PROG-005, VS-PROG-006 | PROPOSED / MISSING |
| UX-REQ-005 | FBD Rev A phải là structured typed editor, có keyboard path add/connect/delete/order và không phụ thuộc free-form canvas/mouse-only. | UC-04 | VS-PROG-005, VS-PROG-006, VS-PROG-028 | PROPOSED / MISSING |
| UX-REQ-006 | Mapping UI phải dùng canonical identity/category, lọc type/direction/writable và chặn Commission tại binding sai. | UC-05/06 | VS-PROG-017 | PROPOSED / MISSING |
| UX-REQ-007 | Rev A phải hiện đúng một Task, cycle chỉ 1/5/30 s, không Add Task/Priority nhiều Task; runtime cũng chỉ hiện Task đó. | UC-07/12 | VS-PROG-009 | PROPOSED / MISSING |
| UX-REQ-008 | Check phải tổng hợp Logic/Type/FBD/Task/Point/Library/Target/RETAIN, có severity/source navigation và không đổi Active. | UC-06/09 | VS-PROG-006, VS-PROG-019 | PROPOSED / MISSING |
| UX-REQ-009 | Trang Đưa vào vận hành phải hiện manifest/impact/RETAIN/cutover, confirmation/progress/read-back; timeout thành Unknown rồi reconcile. | UC-08/09/13 | VS-PROG-011, VS-PROG-015, VS-PROG-019, VS-PROG-029 | PROPOSED / MISSING |
| UX-REQ-010 | Readiness phải liệt kê mọi override active với Point/source/actor/requested/actual/priority/TTL và link Chạy thử, không suy từ cache. | UC-08 | VS-PROG-020 | PROPOSED / MISSING |
| UX-REQ-011 | UI phải tách `program_value` mức 5 khỏi `actual_value`; khi mức 1–4 thắng phải hiện source/priority/TTL và không mô tả PID track actual. | UC-08/12 | VS-PROG-010, VS-PROG-014 | PROPOSED / MISSING |
| UX-REQ-012 | Core state chỉ `RUNNING/DEGRADED/UNREACHABLE`; khi controller mất thì UI không tải; UX không tự chốt Draft authority. | UC-10 | VS-PROG-026, VS-PROG-030 | PROPOSED / MISSING |
| UX-REQ-013 | Missing/Unknown/Stale/Unavailable và Point `OFFLINE` phải giữ nghĩa riêng; không valid zero hoặc dùng Offline làm core state. | UC-05/10/12 | VS-PROG-018, VS-PROG-026 | PROPOSED / MISSING |
| UX-REQ-014 | Runtime/Theo dõi phải hiện một Task, execution/max/overrun, bounded trace và task fault; không tự suy diễn plant safe-state. | UC-12/16 | VS-PROG-013, VS-PROG-027 | PROPOSED / MISSING |
| UX-REQ-015 | Khôi phục bản trước phải có review/strong confirmation/progress/authority result/audit và không optimistic success. | UC-11 | VS-PROG-011 | PROPOSED / MISSING |
| UX-REQ-016 | UI phải trình bày viewer/operator/admin theo server authorization; action cấm disabled có lý do, không hide runtime truth. | Mọi mutation | VS-PROG-022 | PROPOSED / MISSING |
| UX-REQ-017 | Mọi visible string phải qua i18n key VI/EN, tiếng Việt mặc định; spec phải dùng copy Việt đã chốt. | Mọi UC | VS-PROG-025 | PROPOSED / MISSING |
| UX-REQ-018 | State/action phải có text/icon ngoài màu, focus visible, table/tree/editor semantics và không critical hover-only. | Mọi page | VS-PROG-028 | PROPOSED / MISSING |
| UX-REQ-019 | UI không được tạo fake metric/health/runtime state; thiếu producer phải hiện `—/Không xác định` cùng freshness. | UC-01/10/12 | VS-PROG-018, VS-PROG-026 | PROPOSED / MISSING |
| UX-REQ-020 | Conflict 409, Commission timeout/reject và reconnect phải có recovery rõ; không overwrite/replay mutation/mất Draft. | UC-06/09 | VS-PROG-011, VS-PROG-024 | PROPOSED / MISSING |
| UX-REQ-021 | Replacement flow phải source-only, reject artifact/IR/native/corrupt/wrong-target, build lại target, tạo Draft, không auto-activate. | UC-17 | VS-PROG-021, VS-PROG-023 | PROPOSED / MISSING |
| UX-REQ-022 | Syntax/type/mapping/build là Engineering Diagnostic; runtime/task fault chỉ link Alarm khi authority có record; UI không duplicate alarm/tự kích safe-state. | UC-06/12/16 | VS-PROG-013 | PROPOSED / MISSING |
| UX-REQ-023 | User Function Block Rev A chỉ cục bộ Project; UI không expose global catalogue/package sharing/binary import/independent upgrade. | UC-04/14 | VS-PROG-003, VS-PROG-007 | PROPOSED / MISSING |
| UX-REQ-024 | Layout phải usable desktop và read/light-edit dưới 1024; HMI LVGL/DRM không có authoring/Check/Commission/trace/replacement route Rev A. | UX §31 | VS-PROG-028 | PROPOSED / MISSING |

## 4. Coverage và conflict

| Kiểm tra | Kết quả |
|---|---:|
| `PRG-*` unique | 41/41 |
| `UX-REQ-*` unique | 24/24 |
| Có `VS-PROG-*` | 65/65 |
| Evidence PASS | 0; tất cả MISSING/VR RED |

Các delta mạnh hơn/bổ sung baseline được giữ tại `CONF-PROG-016`. Product
approval, capacity/type/WCET/FBD/RETAIN/cutover vẫn bị chặn bởi Open Decision
tương ứng; file này không đóng bất kỳ OD nào.

## 5. Thuật ngữ

Xem [DICT-PROG-001](../00_document_control/02_TERMS_AND_DATA_DICTIONARY.md).

## 6. Lịch sử

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 2.2-controlled-1 | 2026-08-09 | Nhập 41 PRG và 24 UX requirement từ hai proposal v2.2, trạng thái PROPOSED. |

## 7. Phê duyệt

| Vai trò | Quyết định |
|---|---|
| Product Owner | `PENDING` |
| Software/Runtime Architect | `PENDING` |
| Controls/Safety Reviewer | `PENDING` |
| UX Lead | `PENDING` |
| Verification Lead | `PENDING` |
