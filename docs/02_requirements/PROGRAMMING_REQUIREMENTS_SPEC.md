# Đặc tả yêu cầu hệ thống Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `SRS-PROG-001` |
| Phiên bản | 0.6 |
| Trạng thái | **APPROVED FOR IMPLEMENTATION** — toàn bộ 60 requirement và giá trị target được duyệt theo `AUTH-PROG-2026-08-11-03` |
| Ngày | 2026-08-11 |
| Chủ quản | Product + System Engineering |
| Reviewer | Software/Runtime Architect, UX/FE Lead, BE Lead, HW/FW Lead, Verification Lead |
| Approver | Product Owner |
| Nguồn | `PROD-PROG-001`; Product proposal v2.2; UX proposal v2.2; ADR-005/020/021/023; Modbus approval 2026-08-05 |
| Phạm vi | MK-DDC-24 Rev A — một controller, ST + FBD, Local/VP/MB-RTU, một Task `1/5/30 s` |

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Chốt **60 điều hệ thống phải làm được** cho Programming Rev A, kèm tiêu chí chấp nhận đo được. Đây là cái mà thiết kế phải thỏa và là cái mà test phải chứng minh. Không phải nơi chọn API, schema hay thuật toán. |
| 2. Ai phải đọc file này? | Product Owner (duyệt phạm vi), mọi discipline lead (nhận phần được phân bổ ở §9), QA (dựng scenario từ tiêu chí chấp nhận). Dev đọc phần của layer mình trước khi đọc thiết kế. |
| 3. Hệ thống hiện tại đang có gì? | Chưa requirement nào được implement end-to-end. Đường control production vẫn là graph. Modbus RTU Point contract đã `Active` (approval 2026-08-05) và được dùng lại, không viết lại. `contracts/iop/iop_protocol.h` và safe-timeout `200 ms` trên MCU đã có mã nguồn. |
| 4. Thiết kế mới thay đổi điều gì? | Đưa vào 8 yêu cầu hệ thống, 15 FE, 10 BE, 10 Core, 4 MCU, 3 HW và 10 phi chức năng. Điểm cốt lõi: tách `Draft/Candidate` khỏi `Active` (`SYS-102`), Commission là giao dịch atomic có read-back (`SYS-103`), và chỉ **một** owner Local logic (`SYS-105`). |
| 5. Team phải sửa module/contract nào? | Phân bổ ở §9: FE → `apps/web-ui`; BE → `mkddc-web`; Core → `mkddc-core`; MCU → firmware STM32; HW → schematic/BOM/test point. Ranh giới không được vượt: FE không quyết quyền, BE không chạy control step, Core không sở hữu Project, MCU không biết Revision (§12). |
| 6. Điều gì còn bị chặn? | **Không còn blocker approval cho implementation.** Cả 17 decision đã `DECIDED`; 13 nhóm giá trị ở §10 là baseline được duyệt. Team được đưa chúng vào contract và code production. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | Mỗi requirement có cột “Kiểm chứng” và trace tới `VS-PROG-*` trong [`TRACE-PROG-001`](../07_records/PROGRAMMING_TRACEABILITY_MATRIX.md). Hiện **0/32 scenario có Test Result**, nên 0/60 requirement được đóng. §11 ghi rõ loại bằng chứng nào **không** đủ để đóng (ví dụ: host test thay cho target/HIL). |

Các nhãn `TARGET-PENDING` trước đây đã được thay bằng `DECIDED` tại §10 theo
`AUTH-PROG-2026-08-11-03`. Chúng được phép đưa vào contract và code production.

## 1. Quy tắc requirement

Từ “phải/không được” là quy phạm. Mỗi requirement dưới đây có nguồn, ưu tiên,
phương pháp kiểm chứng và tiêu chí chấp nhận. `T` = test, `D` = demonstration,
`A` = analysis, `I` = inspection. Các giá trị thuộc `OD-PROG-*` đã được duyệt
thành target baseline để triển khai.

Thứ tự authority: Product/ADR Active → SRS Approved → Detailed Design Approved →
contract machine-readable → implementation/test/evidence. Chỉ thị điều hành đã
duyệt SRS và mở implementation; contract machine-readable là deliverable P1,
không phải điều kiện xin phép trước P1.

## 2. Yêu cầu hệ thống và vòng đời

| ID | Yêu cầu quy phạm | Nguồn | Ưu tiên | Kiểm chứng | Tiêu chí chấp nhận |
|---|---|---|---|---|---|
| `SYS-REQ-PROG-101` | Hệ thống phải hỗ trợ một môi trường Programming cho một controller, ST + FBD, đúng ba Point category `LOCAL/VP/MB-RTU` và Task period `1/5/30 s`; phải từ chối mọi scope ngoài allowlist. | PRG-IEC-001; PRG-PT-004 | Must | T+I | Ca hợp lệ chạy qua Check; LD/SFC/TCP/BACnet Point/period khác bị từ chối bằng mã ổn định. |
| `SYS-REQ-PROG-102` | Hệ thống phải tách `Draft/Candidate` khỏi `Active`; Save hoặc Check không được làm thay đổi control đang chạy. | PRG-BACS-003; PRG-UX-002 | Must | T+D | Hash/Revision active và output không đổi qua Save/Check thành công hoặc lỗi. |
| `SYS-REQ-PROG-103` | Commission/Restore phải là giao dịch atomic, chỉ báo thành công sau read-back authoritative; lỗi phải giữ Last-Known-Good. | PRG-RT-003/004; PRG-COM-003/004 | Must | T+HIL | Không có trạng thái active một phần; response và runtime status khớp cùng revision/correlation. |
| `SYS-REQ-PROG-104` | Hệ thống phải duy trì control local khi FE/BE/network mất, miễn core/iobus/MCU còn healthy. | NFR-PRG-PROP-006 | Must | Fault injection | Restart Web/BE không đổi active revision, output hoặc run counter ngoài sai số đã duyệt. |
| `SYS-REQ-PROG-105` | Hệ thống chỉ được có một owner Local logic: `GRAPH_ONLY` hoặc `PROGRAM_ONLY`; yêu cầu dual-run phải fail closed và giữ runtime hợp lệ đang có. | PRG-RT-009 | Must | T+HIL | Không có output mức 5 từ hai runtime; lỗi `PRG-ERR-CUTOVER-001`. |
| `SYS-REQ-PROG-106` | Hệ thống phải giữ audit cho mọi mutation lifecycle và security reject với actor/action/target/revision/time/result/correlation. | PRG-SEC-003; NFR-PRG-PROP-009 | Must | I+T | 100% mutation/reject có record; không log secret hoặc full source payload nhạy cảm. |
| `SYS-REQ-PROG-107` | Project replacement phải dùng bundle source-only, tạo Draft, Check/build lại trên target và không tự Commission. | PRG-COM-006 | Must | T+D | Artifact/IR/native/cache/trust material trong bundle bị từ chối; active revision không đổi sau import. |
| `SYS-REQ-PROG-108` | HMI local không được cung cấp authoring, Check, Commission, trace, replacement hoặc reset RETAIN của Programming Rev A. | UX-REQ-024 | Must | I+T | Không có route/action tương ứng trong build HMI; Web/HMI không nằm control path. |

## 3. Yêu cầu FE

| ID | Yêu cầu quy phạm | Nguồn | Ưu tiên | Kiểm chứng | Tiêu chí chấp nhận |
|---|---|---|---|---|---|
| `SWR-REQ-PROG-FE-101` | FE phải cung cấp **bốn workspace** `PGM-01..04`: Tổng quan; Thiết kế có ba tab `Chương trình`/`Điểm & Ánh xạ`/`Thực thi`; Kiểm tra & Đưa vào vận hành; Runtime & Bảo trì có ba tab. Route cũ phải chuyển hướng, không được xóa ngay. | UX-REQ-002; `OD-PROG-016` | Must | D+E2E | Route, breadcrumb và deep-link đúng cho desktop/mobile; đổi tab không mất nội dung đang gõ và không đổi ETag; mọi route cũ ở [UX §11.1](../04_uiux/PROGRAMMING_UI_UX_DESIGN.md) chuyển hướng đúng và giữ `projectId`. |
| `SWR-REQ-PROG-FE-102` | Context bar phải hiển thị đồng thời controller/project, Draft đang sửa, dirty/check state và Revision đang vận hành. | UX-REQ-003 | Must | E2E | Không có state `isRunning` gộp; Draft và Active khác revision vẫn đọc được. |
| `SWR-REQ-PROG-FE-103` | ST editor phải có keyboard-first, line/column diagnostics, symbol/type, tìm/tham chiếu và không làm mất Draft khi lỗi. | UX-REQ-004 | Must | Component+E2E | Diagnostic điều hướng đúng source range; reload phục hồi Draft từ BE. |
| `SWR-REQ-PROG-FE-104` | FBD Rev A phải là structured typed editor có add/connect/delete/order bằng bàn phím; không phụ thuộc free-form canvas hoặc chuột. | UX-REQ-005 | Must | Component+a11y | Toàn bộ flow UC-04 hoàn tất chỉ bằng bàn phím. |
| `SWR-REQ-PROG-FE-105` | Mapping UI phải dùng canonical identity, type, direction, writable, unit, quality và chỉ cho phép category trong allowlist. | UX-REQ-006/013 | Must | T+E2E | Invalid binding bị đánh đúng field, chặn Check/Commission, không đổi missing thành zero. |
| `SWR-REQ-PROG-FE-106` | FE phải hiển thị đúng một Task Rev A và chỉ cho chọn `1/5/30 s`; không có Add Task/Task priority. | UX-REQ-007 | Must | T+E2E | UI và request không tạo được task thứ hai hoặc period ngoài allowlist. |
| `SWR-REQ-PROG-FE-107` | Trang Commission phải hiện readiness, change manifest, output/RETAIN/cutover/override impact, confirmation mạnh, progress và read-back; timeout phải chuyển `UNKNOWN`. | UX-REQ-009/010/020 | Must | E2E | Không optimistic success; retry status không replay mutation. |
| `SWR-REQ-PROG-FE-108` | Runtime UI phải tách `program_value`, `actual_value`, `overridden_by`, `effective_priority`, actor và TTL khi có. | UX-REQ-011/014 | Must | E2E | Override mức 1–4 không bị trình bày như Program đang thắng. |
| `SWR-REQ-PROG-FE-109` | FE phải dùng core state `RUNNING/DEGRADED/UNREACHABLE`, Point freshness/quality riêng, và không tạo fake metric/default. | UX-REQ-012/013/019 | Must | T+E2E | Thiếu producer hiển thị `—/Không xác định`; data cũ có nhãn freshness. |
| `SWR-REQ-PROG-FE-110` | Mọi mutation phải gửi ETag/base revision và xử lý 403/409/422/timeout theo mã lỗi, không overwrite hoặc mất Draft. | UX-REQ-016/020 | Must | Integration+E2E | Hai client sửa cùng Draft tạo 409 và flow reload/merge. |
| `SWR-REQ-PROG-FE-111` | Chuỗi visible phải qua i18n VI/EN; state không chỉ dùng màu, focus nhìn thấy và không có critical hover-only action. | UX-REQ-017/018 | Must | Static+a11y | Scan i18n sạch; axe/keyboard gate đạt; contrast được đo. |
| `SWR-REQ-PROG-FE-112` | Engineering Problems phải tách Alarm store; chỉ link Alarm khi authority có record. | UX-REQ-022 | Must | T+E2E | Syntax/mapping/build error không xuất hiện như process alarm. |
| `SWR-REQ-PROG-FE-113` | Trang Commission chỉ được hiện ô xác nhận cho ảnh hưởng **có thật** trong lần thao tác đó; số ô xác nhận có thể bằng `0` nhưng xác thực lại, đọc ngược và đường quay lui **không được** bỏ. | UX-REQ-009; Product Spec §8.6 | Must | E2E+security | Không có impact thì không hiện ô; có impact nào thì phải có đúng ô đó; bỏ xác thực lại hoặc bỏ đọc ngược là FAIL ngay cả khi số click giảm. |
| `SWR-REQ-PROG-FE-114` | Thao tác thay đổi hệ thống đang chạy (Khôi phục, Nhập gói, Đặt lại RETAIN) phải nằm trong vùng tách biệt khỏi vùng chỉ đọc; người dùng không đủ quyền thấy vùng này ở chế độ đọc kèm lý do, **không** thấy một dãy nút bị vô hiệu hóa. | UX-REQ-016; Product Spec §8.6 | Must | E2E+a11y | Với `viewer`, số nút bị vô hiệu hóa hiển thị trong vùng nguy hiểm bằng `0` và có văn bản nêu lý do. |
| `SWR-REQ-PROG-FE-115` | Bộ lọc danh mục Point phải cho lọc theo **loại, hướng và khả năng ghi**; không bắt người dùng nhập lại thông tin hệ thống đã biết. | UX-REQ-006; Product Spec §8.5 | Must | Component+E2E | Ba bộ lọc hoạt động độc lập và kết hợp; danh mục rỗng sau lọc có gợi ý bỏ lọc. |

## 4. Yêu cầu BE

| ID | Yêu cầu quy phạm | Nguồn | Ưu tiên | Kiểm chứng | Tiêu chí chấp nhận |
|---|---|---|---|---|---|
| `SWR-REQ-PROG-BE-101` | BE phải là authority của Project, Draft, immutable Revision, change manifest, compiler job, artifact metadata và audit; browser cache không phải authority. | PRG-BACS-005; PRG-SEC-005 | Must | T+I | Persistence round-trip và restart giữ identity/revision; không mutable Revision. |
| `SWR-REQ-PROG-BE-102` | Mutation Draft phải dùng optimistic concurrency và idempotency; base cũ trả 409, cùng idempotency key không tạo duplicate. | PRG-SEC-005; NFR-PRG-PROP-007 | Must | Integration | Two-client/rerun test giữ đủ hai version và một side effect. |
| `SWR-REQ-PROG-BE-103` | Check phải tổng hợp source, type, FBD topology, Task, Point, library, target, RETAIN, cutover và resource compatibility; Check không activate. | PRG-COM-001 | Must | Integration | Kết quả có per-layer status/source range; active revision không đổi. |
| `SWR-REQ-PROG-BE-104` | Compiler job phải chạy ngoài RT path với timeout, size limit và resource isolation; output chỉ là immutable artifact cho đúng target. | PRG-RT-005/006 | Must | T+A | Timeout fail closed; concurrent worst-case Check không làm core/iobus vi phạm NFR. |
| `SWR-REQ-PROG-BE-105` | BE phải tính structured change manifest từ hai immutable Revision, không tin diff do FE gửi. | PRG-COM-002 | Must | T | Manifest phân loại source/mapping/task/library/RETAIN/output impact ổn định. |
| `SWR-REQ-PROG-BE-106` | Commission/Restore phải dùng một operation ID bền vững, stage artifact qua internal contract, reconcile runtime status và audit final result. | PRG-COM-003/004 | Must | Integration+HIL | Timeout/restart BE vẫn truy ra kết quả; không double activation. |
| `SWR-REQ-PROG-BE-107` | RBAC server-side phải giữ viewer/operator read-only và admin cho edit/check/commission/restore/reset RETAIN. | PRG-SEC-001 | Must | Security test | 403 đúng action; FE không thể mở quyền bằng route/state cục bộ. |
| `SWR-REQ-PROG-BE-108` | Bundle importer phải chống path traversal, zip bomb, executable/build payload và sai target; import luôn tạo Draft mới. | PRG-COM-006; PRG-SEC-004 | Must | Negative/security | Mọi payload không hợp lệ fail closed, không ghi ngoài vùng dữ liệu, không activate. |
| `SWR-REQ-PROG-BE-109` | Read model runtime/monitor phải giữ producer timestamp, freshness, quality và arbitration; không thay unknown bằng giá trị mặc định. | PRG-PT-003; PRG-UX-003 | Must | Integration | Contract test đủ GOOD/UNCERTAIN/BAD/STALE/OFFLINE/UNKNOWN. |
| `SWR-REQ-PROG-BE-110` | API phải versioned, có error envelope ổn định, correlation và không dùng message tự do làm logic FE. | NFR-PRG-PROP-009 | Must | Contract test | OpenAPI/handler/FE types cùng schema; mọi lỗi có code, retryability và keeps-running truth. |

## 5. Yêu cầu FW-SOM/Core

| ID | Yêu cầu quy phạm | Nguồn | Ưu tiên | Kiểm chứng | Tiêu chí chấp nhận |
|---|---|---|---|---|---|
| `SWR-REQ-PROG-CORE-101` | Core chỉ được nạp artifact đã verify magic/schema/target/profile/size/hash/section/control-flow/resource; không parse ST/FBD trên RT path. | PRG-IEC-001/004; PRG-SEC-002 | Must | Unit+fuzz | One-over/corrupt/wrong-target đều reject trước swap, không crash/OOM. |
| `SWR-REQ-PROG-CORE-102` | Base control step phải tách Task period, dùng coherent input snapshot, dispatch due task deterministic, stage output, resolve/interlock/safe-state rồi commit một lần. | PRG-RT-001/002/009 | Must | Unit+target | Thứ tự lặp lại được; Task 30 s không kéo dài step/sleep 30 s. |
| `SWR-REQ-PROG-CORE-103` | RT path sau init không được heap allocation, filesystem, DB, HTTP, DNS, blocking network hoặc dynamic native load. | PRG-RT-005 | Must | Static+instrumented | Allocation/blocking detector không ghi vi phạm trong 10.000 cycle/period. |
| `SWR-REQ-PROG-CORE-104` | Program output phải ghi mức Local logic 5, qua resolver hiện hữu; runtime phải publish program/actual/winner/priority/TTL riêng. | PRG-RT-002/007 | Must | Unit+HIL | Không có direct IOP write; override các mức 1–4 thắng đúng. |
| `SWR-REQ-PROG-CORE-105` | PI/PID phải back-calculate khi mức 5 thắng nhưng bị limit, và freeze integrator khi thua arbitration; không track `actual_value` ngoại lai. | PRG-RT-007 | Must | Unit+HIL | Test saturation/override/release đạt transition policy đã phê duyệt. |
| `SWR-REQ-PROG-CORE-106` | Activation/Restore phải hold-last trên `previous_program_value` mức 5, chỉ phát Revision mới sau cycle đầu không fault. | PRG-RT-008 | Must | Unit+HIL | Sai lệch first commit không quá độ phân giải binding; LKG giữ khi lỗi. |
| `SWR-REQ-PROG-CORE-107` | Overrun phải được đo theo Task; lần đầu warning, ba lần liên tiếp fault đúng Task; plant safe-state chỉ do SafetyManager condition độc lập. | PRG-RT-006 | Must | Unit+target | Không nuisance plant safe-state chỉ vì Check load/Task overrun. |
| `SWR-REQ-PROG-CORE-108` | Watchdog chỉ được kick sau base step hoàn tất và cấu hình phải thỏa công thức được phê duyệt. | PRG-RT-009 | Must | Target | Không restart loop ở `1/5/30 s`; log cadence và WCET chứng minh margin. |
| `SWR-REQ-PROG-CORE-109` | RETAIN phải versioned, có integrity, ghi atomic/bounded; mismatch/corrupt phải cold-init có diagnostic, không chặn boot. | PRG-IEC-003; PRG-COM-002 | Must | Unit+power fault | Không đọc sai layout; power loss không tạo record được chấp nhận một phần. |
| `SWR-REQ-PROG-CORE-110` | Online monitor mặc định read-only; trace phải bounded và không nằm critical path. | PRG-BACS-005; NFR-PRG-PROP-004/005 | Must | T+soak | 1 Hz mặc định; tối đa 10.000 sample/10 phút; dừng có reason. |

## 6. Yêu cầu FW MCU và HW

| ID | Yêu cầu quy phạm | Nguồn | Ưu tiên | Kiểm chứng | Tiêu chí chấp nhận |
|---|---|---|---|---|---|
| `FW-REQ-PROG-MCU-101` | MCU không được biết ST/FBD/Project/Revision; chỉ thực hiện IOP command đã validate, sampling, actuation và diagnostics. | Architecture boundary | Must | I+HIL | Không có compiler/runtime dependency trong firmware; IOP byte contract đạt. |
| `FW-REQ-PROG-MCU-102` | MCU phải vào safe behavior độc lập nếu không nhận frame hợp lệ trong `200 ms`, kể cả SOM treo/restart/activation. | NFR-PRG-PROP-010 | Must | Fault-injection HIL | AO/DO đo được về safe state trong giới hạn, counter/diagnostic tăng. |
| `FW-REQ-PROG-MCU-103` | Frame lặp cùng sequence phải được trả lời lại nhưng không thực thi output hai lần. | IOP v2 | Must | Unit+HIL | Retry/loss test không double actuation. |
| `FW-REQ-PROG-MCU-104` | AO mode và actuation phải áp đúng mode đã ACK; conversion engineering→V/mA chỉ xảy ra một lần trên SOM/iobus boundary. | ADR-012 | Must | HIL | V/mA đo được đúng tolerance ở mọi mode/chuyển mode. |
| `HW-REQ-PROG-101` | HW phải cung cấp đường IOP/UART, reset, nguồn và test point đủ để đo poll gap, timeout, output continuity và MCU safe entry. | G6 | Must | Design review+HIL | Schematic/BOM/test-point map được phê duyệt; trace/scope probe khả dụng. |
| `HW-REQ-PROG-102` | AO/DO phải có safe behavior điện xác định khi MCU reset, mất SOM command hoặc nguồn chuyển tiếp. | Safety boundary | Must | Analysis+HIL | Không có xung nguy hiểm ngoài envelope phê duyệt. |
| `HW-REQ-PROG-103` | Watchdog/reset/power domain phải bảo đảm lỗi SOM không vô hiệu lớp an toàn độc lập MCU. | ADR-002 | Must | Analysis+fault HIL | Inject SOM hang/reset/brownout và ghi waveform/reset reason. |

## 7. Yêu cầu phi chức năng

| ID | Yêu cầu quy phạm | Nguồn | Phương pháp và tiêu chí |
|---|---|---|---|
| `NFR-REQ-PROG-101` | Giới hạn ST/FBD/binding/artifact phải bounded theo Product v2.2 và được khóa tại G0. | NFR-PROP-001 | Boundary + one-over; mã lỗi ổn định; không crash/OOM. |
| `NFR-REQ-PROG-102` | Check phải đạt `p95 <=2 s`, hard timeout `5 s` trên target ở giới hạn được phê duyệt. | NFR-PROP-002 | Benchmark ghi target/toolchain/commit/dataset; timeout không tạo candidate Ready. |
| `NFR-REQ-PROG-103` | Task/WCET/base-step/watchdog phải deterministic theo budget được phê duyệt. | NFR-PROP-003/010 | 10.000 cycle mỗi period, concurrent Check; ghi max/p99/jitter/overrun/poll gap. |
| `NFR-REQ-PROG-104` | Monitor freshness mặc định 1 Hz, stale sau 3 kỳ; trace tối đa 10.000 sample/10 phút. | NFR-PROP-004/005 | Clock-controlled integration + soak; memory bounded. |
| `NFR-REQ-PROG-105` | FE/BE restart không dừng active control và reconnect không replay mutation. | NFR-PROP-006 | Target fault injection; active/run/output continuity. |
| `NFR-REQ-PROG-106` | Concurrency conflict trả trong `<=1 s`; audit đầy đủ và không lộ secret. | NFR-PROP-007/009 | Two-client + log inspection. |
| `NFR-REQ-PROG-107` | UI phải có VI/EN, keyboard path, visible focus, text/icon state và responsive desktop/read-light-mobile. | NFR-PROP-008 | Vitest/lint/build/E2E + Chrome DevTools desktop/mobile/Console/Network. |
| `NFR-REQ-PROG-109` | Sản phẩm phải đạt bảy ngưỡng khả dụng `UX-A-01..07` khi đo bằng usability test có người dùng thật. | Product Spec §8.1; UX §14.1 | `UX-T-006` với `≥5` kỹ thuật viên BMS chưa từng dùng MK-DDC-24: nhận biết trạng thái `≤5 s` ở `≥4/5` người; dựng FBD + ánh xạ 2 Point + Check `≤15 phút`; hoàn thành tám journey `≥90%`; `0` lỗi nghiêm trọng ở Kiểm tra/Vận hành/Khôi phục; `100%` trả lời đúng bản đang sửa và bản đang chạy; `0` hiểu nhầm sau Check lỗi và `0` lần gửi lại sau timeout; và khi không có ô xác nhận nào, `0` người bỏ qua xác thực lại. |
| `NFR-REQ-PROG-110` | Thiết kế mục tiêu phải đạt `≥85/100` trên bảng điểm heuristic tám tiêu chí, trong đó an toàn Commission/rollback đạt `5/5` và không tiêu chí nào dưới `3,5/5`. | Product Spec §8.3 | Inspection bảng điểm có lý do từng điểm và nguồn benchmark chính thức. **Đây là kiểm tra thiết kế, không phải bằng chứng khả dụng** — không dùng thay `NFR-REQ-PROG-109`. |
| `NFR-REQ-PROG-108` | Activation/Restore phải giữ `max_iop_poll_gap <200 ms`, mục tiêu margin `<=100 ms`. | NFR-PROP-010 | Board HIL có timestamp/waveform; không MCU safe-timeout. |

## 8. Điều kiện phê duyệt baseline

- Mọi requirement có owner design và scenario trong `TRACE-PROG-001`.
- `OD-PROG-001..017` được đóng hoặc mỗi giá trị proposal có waiver/decision rõ.
- Không còn xung đột base-step/watchdog, graph cutover, Task capacity, RETAIN,
  FBD semantics, type/capacity và error namespace.
- Product, Architecture, Controls/Safety, HW/FW, UX và Verification ký.

## 9. Rationale và phân bổ theo nhóm

| Nhóm requirement | Rationale sản phẩm/an toàn | Owner thiết kế chính | Consumer bắt buộc |
|---|---|---|---|
| `SYS-101..108` | Giữ scope Rev A hữu hạn, tách engineering khỏi control truth và bảo toàn LKG | `ARCH-PROG-001` | mọi team |
| `FE-101..115` | Người dùng phải thấy đúng Draft/Active/quality/arbitration, phục hồi được khi lỗi, và hoàn tất công việc trong bốn workspace | UX + FE Design | BE/API, QA |
| `BE-101..110` | Controller cần authority bền vững, concurrency, audit và orchestration không nằm RT path | BE + Data + Interface + Security | FE, Core, Ops |
| `CORE-101..110` | Control phải bounded, deterministic, một owner và không bypass resolver/safe-state | FW-SOM + Language/Artifact/Control/Lifecycle | BE, FW MCU, QA |
| `MCU-101..104` | Lớp sampling/actuation và safe-timeout phải độc lập với Web/Program | FW MCU + IOP contract | iobus, HW, HIL |
| `HW-101..103` | Các claim timing/safe output cần test point và envelope điện thật | HW Design | FW MCU, QA |
| `NFR-101..110` | Chuyển quality attribute — gồm cả khả năng sử dụng — thành ngưỡng đo thay vì mô tả định tính | Architecture + discipline design + V&V | Release authority |

Allocation trên không chuyển ownership mutable state: BE sở hữu Project/Revision,
Core sở hữu runtime/arbitration, iobus sở hữu IOP/fieldbus, MCU sở hữu actuation
vật lý. Một requirement chỉ được đóng khi tất cả consumer của contract đã test.

## 10. Quyết định đã duyệt và giá trị target baseline

| Requirement/giá trị | Trạng thái | Decision | Owner quyết định | Ghi chú thực thi/kiểm chứng |
|---|---|---|---|---|
| Type/conversion/ST limits/FBD `256/512` | `DECIDED` | `OD-PROG-002/003` | Product + Runtime | hiện thực boundary/one-over suite |
| Một Task; period `1/5/30 s` | `DECIDED` | `OD-PROG-004/012` | Product + Runtime | hiện thực base-step/WCET/watchdog và target test |
| Viewer/operator read-only; admin mutation | `DECIDED` | `OD-PROG-001` | Product + Security | hiện thực permission matrix và negative authorization cases |
| Core Control Library tối thiểu/User FB cục bộ | `DECIDED` | `OD-PROG-005` | Product + Controls | version hóa block/function semantics |
| Structured FBD keyboard editor | `DECIDED` | `OD-PROG-006` | Product + UX + Runtime | hiện thực canonical FBD schema/order/conversion/source map |
| Local/VP/MB-RTU identity/quality | `DECIDED` | `OD-PROG-007/008` | Product + I/O | hợp nhất Point Catalog + ADR-024; kiểm HIL ở P6 |
| RETAIN layout/restart/write interval | `DECIDED` | `OD-PROG-009` | Product + Runtime | hiện thực warm/cold/revision matrix và endurance test |
| Revision/LKG retention + power-loss | `DECIDED` | `OD-PROG-010` | Product + System | hiện thực migration/atomic transaction/rollback |
| Monitor `1 Hz`, stale 3 kỳ; trace `10k/10 phút` | `DECIDED` | `OD-PROG-011` | Product + UX | kiểm capacity/soak và retention |
| WCET `20%`, 3 overrun, Check p95/timeout | `DECIDED` | `OD-PROG-012` | Product + Runtime | benchmark target và fault test |
| Graph→Program cutover/config migration | `DECIDED` | `OD-PROG-013/014` | Product + Architecture + Ops | hiện thực inventory, backup/restore và cutover |
| IA bốn workspace và tám journey `UJ-PROG-01..08` | `DECIDED` | `OD-PROG-016` | Product + UX | hiện thực Amendment A1, bốn workspace/tám journey |
| Thư viện mẫu BMS (AHU/pump/fan/valve/PID) | `DECIDED — ROADMAP` | `OD-PROG-017` | Product + Controls | Rev A chỉ có Core Library và User FB cục bộ |
| Toàn bộ SRS/design baseline | `DECIDED — APPROVED` | `OD-PROG-015` | Product + QA | `AUTH-PROG-2026-08-11-03`; QA signature waived for implementation |

## 11. Verification allocation

| Layer | Verification tối thiểu | Không đủ để đóng requirement |
|---|---|---|
| Product/SRS | Inspection + trace review | việc file tồn tại hoặc prose được viết |
| FE/UX | component, a11y, E2E và Chrome desktop/mobile/Console/Network | screenshot hoặc mock không có backend authority |
| BE/API/Data/Security | unit, contract, integration, two-client, restart, malicious input | handler unit riêng lẻ không có persistence/Core |
| Compiler/loader/runtime | boundary, one-over, fuzz, no-allocation, deterministic/fault tests | host parser test thay target runtime |
| MCU/HW/IOP | host pure-logic + target/HIL/waveform/calibrated instrument | simulator hoặc schematic review thay đo điện |
| Operations/release | backup/restore/upgrade/rollback/replacement rehearsal | plan/runbook chưa thực thi |

## 12. Use case hệ thống và biên trách nhiệm

Sáu use case hệ thống dưới đây là **góc nhìn hệ thống**; góc nhìn người dùng là
tám journey `UJ-PROG-01..08` tại [Product Spec §9](../01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md).
Ánh xạ: “Tạo và sửa Draft” phủ `UJ-PROG-02/03/04`; “Check” là `UJ-PROG-05`;
“Commission” là `UJ-PROG-06`; “Runtime monitor” là `UJ-PROG-07`; “Restore” và
“Controller replacement” là `UJ-PROG-08`; `UJ-PROG-01` là đường đọc trạng thái
không có use case hệ thống riêng vì nó không thay đổi state nào.

| Use case hệ thống | Trigger/đầu vào | Xử lý bắt buộc | Kết quả/ngoại lệ | Requirement chính |
|---|---|---|---|---|
| Tạo và sửa Draft | admin + Project + base Revision | BE kiểm quyền/ETag, lưu canonical source/mapping/task | Draft mới; `403/409/422` không đổi Active | `SYS-101`, `FE-103..106`, `BE-101..104` |
| Check | immutable Revision | compile/semantic/mapping/target/retain readiness ngoài RT | PASS/FAIL/UNKNOWN + diagnostic ổn định; no active effect | `SYS-103`, `BE-105`, `CORE-102`, `NFR-103` |
| Commission | Ready Revision + ack + idempotency | stage/verify/safe-boundary swap/first-cycle/read-back/audit | Active mới hoặc active cũ/LKG; timeout phải reconcile | `SYS-103..105`, `BE-106..108`, `CORE-103..108` |
| Runtime monitor | viewer/operator/admin | đọc authoritative status/value/quality/owner/freshness | read-only; gap refetch; missing không thành zero | `FE-109..112`, `BE-109`, `CORE-109`, `NFR-104` |
| Restore | admin + known-good Revision | cùng transaction Commission, có retain/cutover impact | atomic result + audit; không optimistic | `SYS-104`, `BE-106..108`, `CORE-104..108` |
| Controller replacement | admin + source-only bundle | quarantine, rebuild target, remap, Check, Commission | Draft mới; reject binary/corrupt/wrong target | `SYS-106..108`, `BE-110`, `NFR-105/107` |

Biên loại trừ: FE không quyết định quyền hay Active; BE không chạy control step;
Core không parse source hoặc sở hữu Project; MCU không biết Revision; HW không
định nghĩa business lifecycle. Requirement làm thay đổi biên này phải quay lại
Architecture review, không sửa riêng ở code.

## 13. Tiêu chí chất lượng requirement và quản lý thay đổi

Mỗi dòng requirement chỉ được đưa vào baseline khi kiểm tra đủ:

1. một chủ thể và một hành vi có thể quan sát, không dùng “hỗ trợ/tối ưu” mơ hồ;
2. nguồn/rationale, owner thiết kế, consumer, verification method và scenario;
3. ngưỡng hoặc state/error cụ thể; giá trị chưa được duyệt ghi `TARGET-PENDING`;
4. negative case/safe behavior và compatibility khi có dữ liệu hay control path;
5. liên kết hai chiều trong `TRACE-PROG-001`, gồm cả risk và evidence status.

| Loại thay đổi | Phân tích tác động tối thiểu | Authority |
|---|---|---|
| Scope/capability/role | Product, UX, Security, V&V, roadmap | Product Owner |
| Type/schema/API/ABI | Data, Interface, compiler, FE/BE/Core, migration | System Architect + owner contract |
| Timing/watchdog/priority/safe-state | Core, MCU, HW, HIL, Ops | Runtime Architect + Safety Reviewer |
| Persistence/retention/rollback | BE, Core, Security, Ops, replacement | Architect + Operations |
| Copy/interaction/accessibility | UC, FE state, API error, browser test | UX + Product + QA |

Khi requirement đổi, owner tạo change record nêu ID cũ/mới, lý do, các link bị
ảnh hưởng và kế hoạch evidence lại. Không sửa acceptance sau khi test fail để
biến kết quả thành PASS nếu không có phê duyệt thay đổi baseline.

## 14. Lịch sử sửa đổi và phê duyệt

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1 | 2026-08-09 | Tạo system/FE/BE/Core/MCU/HW/NFR requirements từ proposal v2.2 |
| 0.2 | 2026-08-09 | Bổ sung authority, rationale/allocation, decision dependency và verification gate; sửa nguồn ADR |
| 0.3 | 2026-08-09 | Bổ sung use case hệ thống, biên trách nhiệm, tiêu chí chất lượng từng requirement và impact/change-control; chuyển Detailed Draft chờ review |
| 0.4 | 2026-08-09 | Thêm mục Đọc nhanh và phụ lục tự kiểm cổng M3 loại Requirements; đóng finding `F-PROG-001/003` |
| 0.5 | 2026-08-09 | Amendment A1: `FE-101` đổi sang bốn workspace kèm chuyển hướng route; thêm `FE-113` (xác nhận theo rủi ro thật), `FE-114` (tách vùng thao tác nguy hiểm), `FE-115` (lọc Point theo loại/hướng/khả năng ghi), `NFR-109` (sáu ngưỡng khả dụng `UX-A-01..06`) và `NFR-110` (bảng điểm heuristic ≥85); ánh xạ use case hệ thống sang tám journey; thêm phụ thuộc `OD-PROG-016/017`. Tổng 60 requirement |
| 0.6 | 2026-08-11 | Phê duyệt toàn bộ 60 requirement và 13 nhóm giá trị target theo `AUTH-PROG-2026-08-11-03`; 17/17 decision `DECIDED`; baseline được phép đưa vào contract/code production; chữ ký discipline/Verification còn thiếu được miễn cho implementation |

| Vai trò | Trạng thái | Điều kiện ký |
|---|---|---|
| Product Owner | **ACCEPT ALL — Phạm Đình Chương, 2026-08-11** | `AUTH-PROG-2026-08-11-03` |
| System/Runtime Architect | **ACCEPT ALL — Phạm Đình Chương, 2026-08-11** | `AUTH-PROG-2026-08-11-03` |
| Controls/Safety Reviewer | **WAIVED FOR IMPLEMENTATION** | review hậu kiểm |
| UX/FE, BE, FW/HW Lead | **WAIVED FOR IMPLEMENTATION** | review theo task, không chặn code |
| Verification Lead | **WAIVED FOR IMPLEMENTATION** | evidence theo task, không chặn code |

## 15. Phụ lục — Tự kiểm cổng M3 (loại: Requirements)

Cổng lấy theo [Plan 54 §7](../03_implementation/54_PROGRAMMING_DOCUMENTATION_ROADMAP.md).
Đây là tự kiểm của chủ quản; review liên chức năng nằm ở
[`PROG-REV-2026-08-09`](../07_records/reviews/PROGRAMMING_DESIGN_SET_REVIEW_2026-08-09.md).

| Cổng | Kết quả | Bằng chứng trong file / lý do |
|---|---|---|
| ID ổn định, không trùng | PASS | 60 ID canonical duy nhất (`SYS/SWR/FW/HW/NFR-REQ-PROG-*`); harness đếm 60, trùng `0` |
| Mỗi requirement một nghĩa | PASS | §2–§7 mỗi dòng một chủ thể + một hành vi quan sát được; §13.1 cấm “hỗ trợ/tối ưu” |
| Source và rationale | PASS | §2–§7 cột “Nguồn”; §9 rationale theo nhóm |
| Priority | PASS | §2–§6 cột “Ưu tiên” (`Must` cho toàn bộ Rev A baseline) |
| Allocation theo layer | PASS | §9 owner thiết kế + consumer; §12 biên loại trừ giữa FE/BE/Core/MCU/HW |
| Verification method | PASS | §2–§7 cột “Kiểm chứng” (`T/D/A/I`, HIL, fault injection); §11 phân bổ theo layer |
| Acceptance định lượng | PASS | §2–§7 cột “Tiêu chí chấp nhận”; ngưỡng số ở `NFR-101..108` (ví dụ Check `p95 ≤2 s`, poll gap `<200 ms`) |
| Không lẫn solution chưa duyệt | PASS | Toàn bộ giá trị target đã `DECIDED` và quy về `OD-PROG-*` tại §10 |
| Quyền implementation | PASS | §10 và §14: baseline đã phê duyệt; không còn approval blocker |
| Trace hai chiều | PASS | 60/60 requirement có dòng trong `TRACE-PROG-001` §6; ngược lại 60 dòng đều giải được về ID canonical |
| Link nội bộ sạch | PASS | harness: local link missing `0`, anchor missing `0` |

Maturity M4/M5 chưa được nâng vì không giả chữ ký/evidence, nhưng đã được
`WAIVED FOR IMPLEMENTATION`. Baseline được implement ngay; requirement chỉ được
đánh dấu verified sau khi `VS-PROG-*` tương ứng có Test Result.
