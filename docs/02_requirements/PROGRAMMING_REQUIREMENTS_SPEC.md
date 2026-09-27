# Đặc tả yêu cầu hệ thống Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `SRS-PROG-001` |
| Phiên bản | 1.3 |
| Trạng thái | **Active; 89 requirement, gồm 7 requirement PGM-02 v2.2 TARGET APPROVED FOR IMPLEMENTATION nhưng chưa verified/As-Built** |
| Ngày | 2026-08-20 |
| Chủ quản | Product + System Engineering |
| Reviewer | Software/Runtime Architect, UX/FE Lead, BE Lead, HW/FW Lead, Verification Lead |
| Approver | Product Owner |
| Nguồn | `PROD-PROG-001` v3.2; `AUTH-PROG-2026-08-20-04`; `AUTH-PROG-2026-08-24-05`; exact Candidate `413a043748dce3b44d2c5076412de761760ba17a`; `CR-PROG-PGM02-V22-001`; ADR-005/020/021/023; Modbus approval 2026-08-05 |
| Phạm vi | Một Product Programming: multi-Program; PROGRAM/FUNCTION/FUNCTION_BLOCK; ST/FBD; Control Library; Published Signal; Local/VP/MB_RTU |

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Baseline chốt 82 điều hệ thống; revision này phê duyệt thêm 7 điều PGM-02 v2.2 cho implementation, tổng 89 ID. Quyền code đã mở nhưng verification/As-Built vẫn phải chứng minh theo từng increment. |
| 2. Ai phải đọc file này? | Product Owner (duyệt phạm vi), mọi discipline lead (nhận phần được phân bổ ở §9), QA (dựng scenario từ tiêu chí chấp nhận). Dev đọc phần của layer mình trước khi đọc thiết kế. |
| 3. Hệ thống hiện tại đang có gì? | Chưa requirement nào được implement end-to-end. Đường control production vẫn là graph. Modbus RTU Point contract đã `Active` (approval 2026-08-05) và được dùng lại, không viết lại. `contracts/iop/iop_protocol.h` và safe-timeout `200 ms` trên MCU đã có mã nguồn. |
| 4. Thiết kế mới thay đổi điều gì? | Giữ 82 requirement baseline và phê duyệt `SYS-116`, `FE-119`, `BE-116/117`, `CORE-117/118`, `NFR-112` cho PGM-02 theo `R1 EDIT → R2 LIVE → R3 SIMULATE`. Detailed Design Target là `DDD-SW-PGM02-WORKSPACE-001`. |
| 5. Team phải sửa module/contract nào? | Phân bổ ở §9: FE → `apps/web-ui`; BE → `mkddc-web`; Core → `mkddc-core`; MCU → firmware STM32; HW → schematic/BOM/test point. Ranh giới không được vượt: FE không quyết quyền, BE không chạy control step, Core không sở hữu Project, MCU không biết Revision (§12). |
| 6. Điều gì còn bị chặn? | Không còn blocker authority để viết code PGM-02: `T59-801=DONE`, `T59-802=READY`, task sau `ORDERED` theo dependency. U13–U15, target/HIL, residual risk và release evidence vẫn là cổng riêng. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | Baseline trace tới 44 scenario; PGM-02 nối `VS-PROG-U13..U15`, tất cả `NOT_RUN`. Không kế thừa host/browser/docs thành Test Result hoặc target/HIL PASS. |

Mọi giới hạn một Task/một Program trong revision cũ chỉ còn là As-Built migration
input. `AUTH-PROG-2026-08-20-04` supersede quyết định phạm vi trái Product v3.0.

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
| `SYS-REQ-PROG-101` | Hệ thống phải hỗ trợ nhiều Program độc lập trên một controller, ST + FBD, đúng ba Point category `LOCAL/VP/MB-RTU` và period Program thuộc tập {10, 50, 100, 500, 1000, 5000, 10000, 50000} ms trên base step 10 ms (ADR-061); phải từ chối scope ngoài allowlist. | `PR-PROG-001/002/006/008` | Must | T+I | Package nhiều Program hợp lệ chạy qua Check; LD/SFC/Point type/period khác bị từ chối bằng mã ổn định. |
| `SYS-REQ-PROG-102` | Hệ thống phải tách `Draft/Candidate` khỏi `Active`; Save hoặc Check không được làm thay đổi control đang chạy. | PRG-BACS-003; PRG-UX-002 | Must | T+D | Hash/Revision active và output không đổi qua Save/Check thành công hoặc lỗi. |
| `SYS-REQ-PROG-103` | Commission/Restore phải là giao dịch atomic, chỉ báo thành công sau read-back authoritative; lỗi phải giữ Last-Known-Good. | PRG-RT-003/004; PRG-COM-003/004 | Must | T+HIL | Không có trạng thái active một phần; response và runtime status khớp cùng revision/correlation. |
| `SYS-REQ-PROG-104` | Hệ thống phải duy trì control local khi FE/BE/network mất, miễn core/iobus/MCU còn healthy. | NFR-PRG-PROP-006 | Must | Fault injection | Restart Web/BE không đổi active revision, output hoặc run counter ngoài sai số đã duyệt. |
| `SYS-REQ-PROG-105` | Hệ thống chỉ được có một owner Local logic: `GRAPH_ONLY` hoặc `PROGRAM_ONLY`; yêu cầu dual-run phải fail closed và giữ runtime hợp lệ đang có. | PRG-RT-009 | Must | T+HIL | Không có output mức 5 từ hai runtime; lỗi `PRG-ERR-CUTOVER-001`. |
| `SYS-REQ-PROG-106` | Hệ thống phải giữ audit cho mọi mutation lifecycle và security reject với actor/action/target/revision/time/result/correlation. | PRG-SEC-003; NFR-PRG-PROP-009 | Must | I+T | 100% mutation/reject có record; không log secret hoặc full source payload nhạy cảm. |
| `SYS-REQ-PROG-107` | Project replacement phải dùng bundle source-only, tạo Draft, Check/build lại trên target và không tự Commission. | PRG-COM-006 | Must | T+D | Artifact/IR/native/cache/trust material trong bundle bị từ chối; active revision không đổi sau import. |
| `SYS-REQ-PROG-108` | HMI local không được cung cấp authoring, Check, Commission, trace, replacement hoặc reset RETAIN của Product Programming. | UX-REQ-024 | Must | I+T | Không có route/action tương ứng trong build HMI; Web/HMI không nằm control path. |
| `SYS-REQ-PROG-109` | Hệ thống phải hỗ trợ `PROGRAM`, `FUNCTION`, `FUNCTION_BLOCK` trong ST/FBD với chung type system, registry, typed IR và runtime semantics. | `PR-PROG-002/003/005` | Must | T+I | Cross-language vectors tương đương; rule kind/side-effect/recursion fail closed. |
| `SYS-REQ-PROG-110` | Hệ thống phải quản lý Control Library SYSTEM/PROJECT versioned và khóa dependency acyclic trong Revision. | `PR-PROG-004` | Must | T | Library round-trip/version/upgrade/dependency và hostile import đạt. |
| `SYS-REQ-PROG-111` | Hệ thống phải hỗ trợ tối đa 32 Program/Revision và 16 Program Enabled; one-over bị từ chối trước Commission. | `PR-PROG-006` | Must | Boundary+target | 32/16 pass; Program 33 hoặc Enabled 17 trả mã ổn định, Active không đổi. |
| `SYS-REQ-PROG-112` | Hệ thống phải trao đổi Program-to-Program bằng Published Signal single-publisher, typed, snapshot/freshness; cấm shared writable memory. | `PR-PROG-007` | Must | T+target | Không torn read; stale policy/fault isolation đúng trên 10-Program fixture. |
| `SYS-REQ-PROG-113` | Commission package và Enable/Disable từng Program phải là lifecycle riêng, authoritative, idempotent và audit. | `PR-PROG-010..012/017` | Must | Integration+target | Program mới Disabled trừ khi có intent Enable đã lưu đi cùng ACTIVATE (ADR-062); enable/disable read-back đúng và không replay mutation. |
| `SYS-REQ-PROG-114` | Mọi Program output phải qua Candidate→Ownership→Arbitration→Interlock→Safe-State→I/O; xung đột owner bị Check reject. | `PR-PROG-008/013/022` | Must | T+HIL | Không direct I/O; AO/DO đo đúng; rollback/disable rút candidate đúng. |
| `SYS-REQ-PROG-115` | Scheduler phải phát hành Program theo deadline độc lập với creation order; fault/Disable một Program không mặc định dừng Program độc lập. | `PR-PROG-006/012/019` | Must | Target+fault | 10 Program/3 period đạt budget và fault containment; trace không có dependency ngầm. |
| `SYS-REQ-PROG-116` | PGM-02 phải là một Engineering Workspace tại route canonical `/eng/programming/programs`, triển khai theo ba increment độc lập `R1 EDIT → R2 LIVE → R3 SIMULATE`; EDIT chỉ sửa Draft, LIVE chỉ đọc sealed Active và SIMULATE không có physical output authority. | `PC-PROG-013`; `PR-PROG-025..030`; `CR-PROG-PGM02-V22-001` | Must | I+E2E+target/HIL | Route/mode/capability đúng; hoàn tất R1 không bật R2/R3; Save/Check/Simulation không đổi Active/LKG/output; zero-output Simulation có formal evidence. |

## 3. Yêu cầu FE

| ID | Yêu cầu quy phạm | Nguồn | Ưu tiên | Kiểm chứng | Tiêu chí chấp nhận |
|---|---|---|---|---|---|
| `SWR-REQ-PROG-FE-101` | FE phải cung cấp sáu workspace `PGM-01..06`: Tổng quan; Chương trình; Điểm & Ánh xạ; Thư viện điều khiển; Kiểm tra & Đưa vào vận hành; Runtime & Bảo trì. Route bốn-workspace cũ phải redirect có giữ context. | `PR-PROG-020` | Must | D+E2E | Route/breadcrumb/deep-link desktop/mobile đúng; redirect giữ `projectId`; không mất Draft/ETag. |
| `SWR-REQ-PROG-FE-102` | Context bar phải hiển thị đồng thời controller/project, Draft đang sửa, dirty/check state và Revision đang vận hành. | UX-REQ-003 | Must | E2E | Không có state `isRunning` gộp; Draft và Active khác revision vẫn đọc được. |
| `SWR-REQ-PROG-FE-103` | ST editor phải có keyboard-first, line/column diagnostics, symbol/type, tìm/tham chiếu và không làm mất Draft khi lỗi. | UX-REQ-004 | Must | Component+E2E | Diagnostic điều hướng đúng source range; reload phục hồi Draft từ BE. |
| `SWR-REQ-PROG-FE-104` | ST/FBD editor phải tạo và sửa PROGRAM/FUNCTION/FUNCTION_BLOCK, chỉ hiện property hợp lệ theo kind và hỗ trợ structured typed FBD bằng bàn phím. | `PR-PROG-002/003/005` | Must | Component+a11y | Function không thấy cycle/mapping/RETAIN; FB có instance interface; flow hoàn tất bằng bàn phím. |
| `SWR-REQ-PROG-FE-105` | Mapping UI phải dùng canonical identity, type, direction, writable, unit, quality và chỉ cho phép category trong allowlist. | UX-REQ-006/013 | Must | T+E2E | Invalid binding bị đánh đúng field, chặn Check/Commission, không đổi missing thành zero. |
| `SWR-REQ-PROG-FE-106` | FE phải cấu hình cycle trong tập ADR-061 {10…50000} ms và hiển thị enable intent/runtime state riêng cho từng Program; không expose internal Task order như product dependency. | `PR-PROG-005/006/011` | Must | T+E2E | Nhiều Program có period khác nhau; UI không có Program order tạo semantic dependency. |
| `SWR-REQ-PROG-FE-107` | Trang Commission phải hiện readiness, change manifest, output/RETAIN/cutover/override impact, confirmation mạnh, progress và read-back; timeout phải chuyển `UNKNOWN`. | UX-REQ-009/010/020 | Must | E2E | Không optimistic success; retry status không replay mutation. |
| `SWR-REQ-PROG-FE-108` | Runtime UI phải tách `program_value`, `actual_value`, `overridden_by`, `effective_priority`, actor và TTL khi có. | UX-REQ-011/014 | Must | E2E | Override mức 1–4 không bị trình bày như Program đang thắng. |
| `SWR-REQ-PROG-FE-109` | FE phải dùng core state `RUNNING/DEGRADED/UNREACHABLE`, Point freshness/quality riêng, và không tạo fake metric/default. | UX-REQ-012/013/019 | Must | T+E2E | Thiếu producer hiển thị `—/Không xác định`; data cũ có nhãn freshness. |
| `SWR-REQ-PROG-FE-110` | Mọi mutation phải gửi ETag/base revision và xử lý 403/409/422/timeout theo mã lỗi, không overwrite hoặc mất Draft. | UX-REQ-016/020 | Must | Integration+E2E | Hai client sửa cùng Draft tạo 409 và flow reload/merge. |
| `SWR-REQ-PROG-FE-111` | Chuỗi visible phải qua i18n VI/EN; state không chỉ dùng màu, focus nhìn thấy và không có critical hover-only action. | UX-REQ-017/018 | Must | Static+a11y | Scan i18n sạch; axe/keyboard gate đạt; contrast được đo. |
| `SWR-REQ-PROG-FE-112` | Engineering Problems phải tách Alarm store; chỉ link Alarm khi authority có record. | UX-REQ-022 | Must | T+E2E | Syntax/mapping/build error không xuất hiện như process alarm. |
| `SWR-REQ-PROG-FE-113` | Trang Commission chỉ được hiện ô xác nhận cho ảnh hưởng **có thật** trong lần thao tác đó; số ô xác nhận có thể bằng `0` nhưng xác thực lại, đọc ngược và đường quay lui **không được** bỏ. | UX-REQ-009; Product Spec §8.6 | Must | E2E+security | Không có impact thì không hiện ô; có impact nào thì phải có đúng ô đó; bỏ xác thực lại hoặc bỏ đọc ngược là FAIL ngay cả khi số click giảm. |
| `SWR-REQ-PROG-FE-114` | Thao tác thay đổi hệ thống đang chạy (Khôi phục, Nhập gói, Đặt lại RETAIN) phải nằm trong vùng tách biệt khỏi vùng chỉ đọc; người dùng không đủ quyền thấy vùng này ở chế độ đọc kèm lý do, **không** thấy một dãy nút bị vô hiệu hóa. | UX-REQ-016; Product Spec §8.6 | Must | E2E+a11y | Với `viewer`, số nút bị vô hiệu hóa hiển thị trong vùng nguy hiểm bằng `0` và có văn bản nêu lý do. |
| `SWR-REQ-PROG-FE-115` | Bộ lọc danh mục Point phải cho lọc theo **loại, hướng và khả năng ghi**; không bắt người dùng nhập lại thông tin hệ thống đã biết. | UX-REQ-006; Product Spec §8.5 | Must | Component+E2E | Ba bộ lọc hoạt động độc lập và kết hợp; danh mục rỗng sau lọc có gợi ý bỏ lọc. |
| `SWR-REQ-PROG-FE-116` | FE phải có Control Library search/filter/detail/version/usage cho SYSTEM và PROJECT Function/FB; SYSTEM read-only. | `PR-PROG-004/020` | Must | Component+E2E | Create/edit user entry, system edit reject, version lock/usage/deprecated state hiển thị đúng. |
| `SWR-REQ-PROG-FE-117` | Runtime UI phải có Enable/Disable từng Program, tách desired intent khỏi runtime state và xác nhận khi rút active candidate. | `PR-PROG-011/012/015` | Must | E2E+security | Direct API/FE role matrix đúng; read-back RUNNING chỉ sau cycle; Disable hiển thị candidate impact. |
| `SWR-REQ-PROG-FE-118` | FE phải hiển thị Published Signal producer/value/type/unit/quality/freshness và consumer policy, không trình bày stale như live. | `PR-PROG-007/015` | Must | E2E | GOOD/STALE/BAD/MISSING và producer Disabled/Faulted hiển thị đúng. |
| `SWR-REQ-PROG-FE-119` | FE PGM-02 phải dùng một Project resolver/POU Explorer với selection `objectId`, Quick Library authoritative và ba buffer/mode tách biệt; LIVE read-only, Simulation mutation chỉ hiện cho admin, `<768 px` read-only và mọi unknown/stale/offline/mismatch không thành dữ liệu tốt hay số 0. | `PR-PROG-025..030`; `UX-REQ-025..027` | Must | Component+real-BE E2E+a11y | Resolver 0/1/nhiều/invalid và legacy query đúng; ST/FBD insert một Undo; port order giữ nguyên; sáu state đầy đủ; dưới 768 px có 0 mutation control; role/capability matrix fail closed. |

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
| `SWR-REQ-PROG-BE-111` | Store phải persist POU kind/interface/dependency, library revision, signal definition và per-Program runtime intent bằng migration có backup. | `SYS-109..113` | Must | Store+restart | Round-trip/restart/migration v1→v2 không tự Commission hoặc mất Revision/audit. |
| `SWR-REQ-PROG-BE-112` | Check phải compile toàn package nhiều Program/POU, khóa library DAG, signal publisher, output owner và resource profile. Draft được chứa PROGRAM POU chưa xếp lịch; Check/Package phải fail closed bằng `PRG-ERR-CHECK-001` + `ST-POU-005`, cấm tự loại POU hoặc tự sinh chu kỳ `1000 ms`. | `SYS-109..116`; `F-P59-GHOST-POU-001` | Must | Integration | One-over/recursion/duplicate publisher-owner fail; PROGRAM POU thiếu cấu hình chạy trả đúng public/detail code và zero package mutation; Active/LKG không đổi. |
| `SWR-REQ-PROG-BE-113` | API phải cung cấp Library và Program Enable/Disable operation có RBAC, idempotency, audit, reconcile và read-back Core. | `PR-PROG-004/011/017` | Must | Contract+integration | Route mới khớp OpenAPI/FE/Core và timeout không replay. |
| `SWR-REQ-PROG-BE-114` | Monitor/trace phải đọc per-Program/signal/candidate từ Core authority; trace không được giả sub-cycle bằng BE polling. | `PR-PROG-015` | Must | Integration+load | Core trace bounded; sample sequence/timestamp monotonic; unavailable explicit. |
| `SWR-REQ-PROG-BE-115` | Compiler worker phải tạo artifact v2/package manifest/library lock deterministic cho ST/FBD và không tin metadata do FE tự tính. | `PR-PROG-002/004/009` | Must | Golden+negative | Rebuild byte/hash stable; tamper/version drift reject. |
| `SWR-REQ-PROG-BE-116` | BE phải công bố contract typed cho Draft v1/v2, SYSTEM/PROJECT signature, semantic reference/refactor và diagnostic SOURCE/FBD/POU/GLOBAL; đồng thời chỉ phát read model LIVE khi immutable Active document và runtime observation tuple coherent. | `PR-PROG-025..027`; `DDO-PGM02-002..009` | Must | Contract+integration+fault | OpenAPI/Go/TS cùng union/ID; rename/delete thành một transaction hoặc zero mutation; LIVE mismatch/gap/cutover thành RECONCILING/UNAVAILABLE, không fallback Revision gần nhất. |
| `SWR-REQ-PROG-BE-117` | BE phải quản Simulation session từ immutable Saved-Draft snapshot bằng capability versioned, server RBAC/audit, virtual-input allowlist, quota/TTL và supervisor worker riêng; viewer/operator/admin chỉ đọc, mọi mutation chỉ admin. | `PR-PROG-028..030`; `DDO-PGM02-010..014` | Must | Security+integration+target fault | 14/14 viewer/operator action mutation trả 403 và zero mutation; dirty Draft trả SAVE_REQUIRED; crash/expiry/restart reap worker; không có Core lifecycle/output side effect. |

## 5. Yêu cầu FW-SOM/Core

| ID | Yêu cầu quy phạm | Nguồn | Ưu tiên | Kiểm chứng | Tiêu chí chấp nhận |
|---|---|---|---|---|---|
| `SWR-REQ-PROG-CORE-101` | Core chỉ được nạp artifact đã verify magic/schema/target/profile/size/hash/section/control-flow/resource; không parse ST/FBD trên RT path. | PRG-IEC-001/004; PRG-SEC-002 | Must | Unit+fuzz | One-over/corrupt/wrong-target đều reject trước swap, không crash/OOM. |
| `SWR-REQ-PROG-CORE-102` | Base control step phải tách Task period, dùng coherent input snapshot, dispatch due task deterministic, stage output, resolve/interlock/safe-state rồi commit một lần. | PRG-RT-001/002/009 | Must | Unit+target | Thứ tự lặp lại được; Program chu kỳ dài nhất (50 s, ADR-061) không kéo dài base step 10 ms hay sleep theo chu kỳ của nó. |
| `SWR-REQ-PROG-CORE-103` | RT path sau init không được heap allocation, filesystem, DB, HTTP, DNS, blocking network hoặc dynamic native load. | PRG-RT-005 | Must | Static+instrumented | Allocation/blocking detector không ghi vi phạm trong 10.000 cycle/period. |
| `SWR-REQ-PROG-CORE-104` | Program output phải ghi mức Local logic 5, qua resolver hiện hữu; runtime phải publish program/actual/winner/priority/TTL riêng. | PRG-RT-002/007 | Must | Unit+HIL | Không có direct IOP write; override các mức 1–4 thắng đúng. |
| `SWR-REQ-PROG-CORE-105` | PI/PID phải back-calculate khi mức 5 thắng nhưng bị limit, và freeze integrator khi thua arbitration; không track `actual_value` ngoại lai. | PRG-RT-007 | Must | Unit+HIL | Test saturation/override/release đạt transition policy đã phê duyệt. |
| `SWR-REQ-PROG-CORE-106` | Activation/Restore phải hold-last trên `previous_program_value` mức 5, chỉ phát Revision mới sau cycle đầu không fault. | PRG-RT-008 | Must | Unit+HIL | Sai lệch first commit không quá độ phân giải binding; LKG giữ khi lỗi. |
| `SWR-REQ-PROG-CORE-107` | Overrun phải được đo theo Task; lần đầu warning, ba lần liên tiếp fault đúng Task; plant safe-state chỉ do SafetyManager condition độc lập. | PRG-RT-006 | Must | Unit+target | Không nuisance plant safe-state chỉ vì Check load/Task overrun. |
| `SWR-REQ-PROG-CORE-108` | Watchdog chỉ được kick sau base step hoàn tất và cấu hình phải thỏa công thức được phê duyệt. | PRG-RT-009 | Must | Target | Không restart loop ở mọi chu kỳ của tập ADR-061 {10…50000} ms; log cadence và WCET chứng minh margin. |
| `SWR-REQ-PROG-CORE-109` | RETAIN phải versioned, có integrity, ghi atomic/bounded; mismatch/corrupt phải cold-init có diagnostic, không chặn boot. | PRG-IEC-003; PRG-COM-002 | Must | Unit+power fault | Không đọc sai layout; power loss không tạo record được chấp nhận một phần. |
| `SWR-REQ-PROG-CORE-110` | Online monitor mặc định read-only; trace phải bounded và không nằm critical path. | PRG-BACS-005; NFR-PRG-PROP-004/005 | Must | T+soak | 1 Hz mặc định; tối đa 10.000 sample/10 phút; dừng có reason. |
| `SWR-REQ-PROG-CORE-111` | Loader/runtime phải hỗ trợ artifact v2 nhiều POU/Program và giữ dual-reader v1 trong migration window. | `SYS-109..115` | Must | Unit+integration | Offset/count/DAG/layout/profile corrupt reject trước mutation; v1 LKG vẫn restore. |
| `SWR-REQ-PROG-CORE-112` | Scheduler phải quản lý due queue/per-Program state/period/budget/metrics và tối đa 16 Enabled, giữ semantics trên một hoặc nhiều worker lane. | `PR-PROG-006/019` | Must | Unit+target | 10-Program fixture, 10.000 cycle/period, deadline/fault isolation đạt. |
| `SWR-REQ-PROG-CORE-113` | Runtime phải dùng private Program/FB state và Published Signal double-buffer snapshot; cấm shared writable memory cross-Program. | `PR-PROG-003/007` | Must | Unit+TSan+target | Không torn read/data race; state 100 FB instance độc lập; stale policy đúng. |
| `SWR-REQ-PROG-CORE-114` | Core phải thực hiện Program Enable/Disable tại safe boundary, persist intent, audit result và rút candidate khi Disable/fault/TTL. | `PR-PROG-011/012` | Must | Unit+HIL | State/read-back/intent restart đúng; resolver chọn next owner/default/safe-state. |
| `SWR-REQ-PROG-CORE-115` | Package activation phải có barrier first-cycle toàn package, giữ Program cũ intent, Program mới Disabled (trừ Program có intent Enable đã lưu, áp tại boundary kích hoạt theo ADR-062) và rollback toàn package khi mandatory Program fault. | `PR-PROG-010` | Must | Fault+power | Không partial active/LKG; journal recovery deterministic tại mọi phase. |
| `SWR-REQ-PROG-CORE-116` | `TRACE_START/STOP` phải được Core implement bằng ring buffer bounded; contract không được chứa action không thực thi. | `PR-PROG-015` | Must | Unit+load | 10.000 sample/10 phút, no allocation/blocking RT, drop reason rõ. |
| `SWR-REQ-PROG-CORE-117` | Core phải publish Active Revision/artifact/observation identity và snapshot sequence coherent tại safe boundary để LIVE/Trace không ghép source/topology/value qua hai revision. | `PR-PROG-027`; `DDO-PGM02-008/009` | Must | Unit+TSan+target fault | Sequence monotonic; cutover kết thúc pin cũ và công bố pin mới atomic; IPC/BE read-back không thấy topology/value lai; RT path vẫn bounded. |
| `SWR-REQ-PROG-CORE-118` | Runtime Simulation phải là executable ephemeral tách production Core, dùng cùng compiler/executor semantics nhưng virtual process image/clock riêng và không link/mở production SHM, device, iobus/output writer hoặc RETAIN handle. | `PR-PROG-028/029`; `DDO-PGM02-010/012..014` | Must | Static+determinism+target/HIL | 100/100 replay cùng snapshot/input cho hash giống nhau ở 1×/10×/60×; sandbox probes bị từ chối; Active/LKG/counter và AO/DO/relay không đổi qua mọi action/fault. |

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
| `NFR-REQ-PROG-111` | 10-Program reference fixture phải chạy 24 h trên target, không deadline miss liên tiếp, leak, deadlock, signal torn-read hoặc output owner drift. | `PR-PROG-006/007/019/023` | Target soak + HIL; log raw, image/commit/config/hash và reviewer. |
| `NFR-REQ-PROG-112` | Mỗi increment PGM-02 phải giữ budget riêng: chunk gzip R1/R2/R3 `<=125/145/165 KiB`, typing p95 `<=50 ms`, pointer-to-paint p95 `<=32 ms`, open POU p95 `<=250 ms`, heap steady `<=96 MiB`, mode-switch growth `<=5 MiB`; responsive/a11y theo `UX-REQ-027`, Simulation worker `<=64 MiB RSS`, `<=25%` một core và timeout `2 s`. | `PR-PROG-030`; `PGM02-WORKSPACE-V1` | Bundle/performance/browser/target resource test trên fixture max `256` node/`512` edge; budget fail không được bật capability increment. |

## 8. Điều kiện phê duyệt baseline

- Mọi requirement có owner design và scenario trong `TRACE-PROG-001`.
- `OD-PROG-001..017` được đóng hoặc mỗi giá trị proposal có waiver/decision rõ.
- Không còn xung đột base-step/watchdog, graph cutover, Task capacity, RETAIN,
  FBD semantics, type/capacity và error namespace.
- Product, Architecture, Controls/Safety, HW/FW, UX và Verification ký.

Các điều trên đã được đáp ứng cho 82 requirement baseline. Bảy requirement
PGM-02 được Product Owner/CTO + System Architect phê duyệt cho implementation
bằng `AUTH-PROG-2026-08-24-05`, ghim exact Candidate
`413a043748dce3b44d2c5076412de761760ba17a`. `PLAN_READY[PGM02-V22]=PASS` và
ba `IMPLEMENT_READY=GO`; `T59-801=DONE`, `T59-802=READY`, các task sau
`ORDERED` và chỉ chạy khi dependency R1→R2→R3 thỏa. Điều này không đổi U13–U15
`NOT_RUN` hoặc `RELEASE_READY=NO-GO`.

## 9. Rationale và phân bổ theo nhóm

| Nhóm requirement | Rationale sản phẩm/an toàn | Owner thiết kế chính | Consumer bắt buộc |
|---|---|---|---|
| `SYS-101..116` | Tách engineering/control truth, multi-Program/POU/library/signal, bảo toàn LKG và ba mode PGM-02 không trộn authority | Unified DDD + `DDD-SW-PGM02-WORKSPACE-001` | mọi team |
| `FE-101..119` | Người dùng thấy đúng Draft/Active/intent/runtime/library/signal và PGM-02 mode/identity/capability | UX + Unified/PGM-02 DDD | BE/API, QA |
| `BE-101..117` | Authority bền vững, compiler/package/lifecycle; typed EDIT/LIVE join và Simulation supervisor ngoài RT path | BE + Data + Interface + Unified/PGM-02 DDD | FE, Core, Ops, Security |
| `CORE-101..118` | Runtime bounded/isolated; coherent LIVE producer và Simulation worker không nối physical output | Unified DDD + FW-SOM/Control/Lifecycle + PGM-02 DDD | BE, FW MCU, QA, Security |
| `MCU-101..104` | Lớp sampling/actuation và safe-timeout phải độc lập với Web/Program | FW MCU + IOP contract | iobus, HW, HIL |
| `HW-101..103` | Các claim timing/safe output cần test point và envelope điện thật | HW Design | FW MCU, QA |
| `NFR-101..112` | Chuyển quality attribute — gồm khả năng sử dụng và budget PGM-02 từng increment — thành ngưỡng đo | Architecture + discipline design + V&V | Release authority |

Allocation trên không chuyển ownership mutable state: BE sở hữu Project/Revision,
Core sở hữu runtime/arbitration, iobus sở hữu IOP/fieldbus, MCU sở hữu actuation
vật lý. Một requirement chỉ được đóng khi tất cả consumer của contract đã test.

## 10. Quyết định đã duyệt và giá trị target baseline

| Requirement/giá trị | Trạng thái | Decision | Owner quyết định | Ghi chú thực thi/kiểm chứng |
|---|---|---|---|---|
| Type/conversion/ST limits/FBD `256/512` | `DECIDED` | `OD-PROG-002/003` | Product + Runtime | hiện thực boundary/one-over suite |
| Tối đa 32 Program/Revision, 16 Enabled; period {10…50000} ms trên base step 10 ms | `DECIDED` | `AUTH-PROG-2026-08-20-04`; period theo ADR-061 (2026-09-26) | Product + Runtime | due queue/per-Program state/WCET/watchdog/target fixture |
| Viewer/operator read-only; admin mutation | `DECIDED` | `OD-PROG-001` | Product + Security | hiện thực permission matrix và negative authorization cases |
| PROGRAM/FUNCTION/FUNCTION_BLOCK + SYSTEM/PROJECT Library | `DECIDED` | `AUTH-PROG-2026-08-20-04` | Product + Controls | registry/version/DAG/POU semantics; PID evidence gate riêng |
| Structured FBD keyboard editor | `DECIDED` | `OD-PROG-006` | Product + UX + Runtime | hiện thực canonical FBD schema/order/conversion/source map |
| Local/VP/MB-RTU identity/quality | `DECIDED` | `OD-PROG-007/008` | Product + I/O | hợp nhất Point Catalog + ADR-024; kiểm HIL ở P6 |
| RETAIN layout/restart/write interval | `DECIDED` | `OD-PROG-009` | Product + Runtime | hiện thực warm/cold/revision matrix và endurance test |
| Revision/LKG retention + power-loss | `DECIDED` | `OD-PROG-010` | Product + System | hiện thực migration/atomic transaction/rollback |
| Monitor `1 Hz`, stale 3 kỳ; trace `10k/10 phút` | `DECIDED` | `OD-PROG-011` | Product + UX | kiểm capacity/soak và retention |
| WCET `20%`, 3 overrun, Check p95/timeout | `DECIDED` | `OD-PROG-012` | Product + Runtime | benchmark target và fault test |
| Graph→Program cutover/config migration | `DECIDED` | `OD-PROG-013/014` | Product + Architecture + Ops | hiện thực inventory, backup/restore và cutover |
| Published Signal + output single-owner + Disable withdrawal | `DECIDED` | `AUTH-PROG-2026-08-20-04` | Product + Runtime/Safety | double buffer, freshness policy, Check ownership và HIL |
| IA sáu workspace `PGM-01..06` | `DECIDED` | `AUTH-PROG-2026-08-20-04` | Product + UX | migrate bốn-workspace routes; thêm Programs/Mapping/Library riêng |
| Baseline unified Product/SRS/DDD/Plan 59 | `DECIDED — APPROVED` | `AUTH-PROG-2026-08-20-04` | Product + System | consumer review waived for implementation; release evidence không waive |
| PGM-02 route/mode/increment và Simulation admin-only mutation | `DECIDED — APPROVED FOR IMPLEMENTATION` | `AUTH-PROG-2026-08-24-05` | Product Owner/CTO + System Architect | exact Candidate `413a043748dce3b44d2c5076412de761760ba17a`; route canonical, R1→R2→R3 và role matrix không được tự đổi; release vẫn NO-GO |
| PROGRAM POU chưa xếp lịch | `DECIDED — IMPLEMENTATION PENDING` | `AUTH-PROG-2026-08-24-05`; `F-P59-GHOST-POU-001` | Product Owner/CTO + System Architect | Draft cho phép; Check/Package fail closed `PRG-ERR-CHECK-001` + `ST-POU-005`; cấm exclude/synthesize 1000 ms; chỉ đóng implementation sau source/test |

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
| 1.0 | 2026-08-20 | Owner bỏ phân chia Rev A/B; bổ sung 22 requirement cho multi-Program, POU, library, signal, Enable/Disable, sáu workspace và target soak; tổng 82 requirement, không còn design-decision blocker. |
| 1.1-candidate | 2026-08-24 | Thêm 7 requirement PGM-02 v2.2 (`SYS-116`, `FE-119`, `BE-116/117`, `CORE-117/118`, `NFR-112`), tổng 89; nối R1/R2/R3 và Simulation admin-only theo Owner change request; Architect exact pin và code/release giữ PENDING/NO-GO. |
| 1.2 | 2026-08-24 | Ghi `AUTH-PROG-2026-08-24-05` pin exact Candidate `413a043748dce3b44d2c5076412de761760ba17a`, phê duyệt 7 requirement PGM-02 cho implementation, mở ba increment theo thứ tự R1→R2→R3; chốt Check/Package fail closed `ST-POU-005` cho PROGRAM POU chưa xếp lịch; giữ U13–U15 NOT_RUN và release NO-GO. |
| 1.3 | 2026-09-27 | Đồng bộ ADR-061 (tập chu kỳ {10…50000} ms trên base step 10 ms, thay `1/5/30 s`) vào `SYS-101`, `FE-106`, tiêu chí nghiệm thu của `CORE-102`/`CORE-108` và bảng quyết định; đồng bộ ADR-062 (Program mới có intent Enable đã lưu được bật tại boundary kích hoạt) vào `SYS-113` và `CORE-115`. Cả hai ADR đã Accepted 2026-09-26; bản 1.2 chưa phản ánh — lộ ra ở cổng `candidate-pin` khi tổng hợp release 2026-09-27. Không thêm/bỏ requirement (vẫn 89), không đổi priority/verification level, không nâng trạng thái verified. |

| Vai trò | Trạng thái | Điều kiện ký |
|---|---|---|
| Product Owner | **ACCEPT ALL — Phạm Đình Chương, 2026-08-11** | `AUTH-PROG-2026-08-11-03` |
| System/Runtime Architect | **ACCEPT ALL — Phạm Đình Chương, 2026-08-11** | `AUTH-PROG-2026-08-11-03` |
| Controls/Safety Reviewer | **WAIVED FOR IMPLEMENTATION** | review hậu kiểm |
| UX/FE, BE, FW/HW Lead | **WAIVED FOR IMPLEMENTATION** | review theo task, không chặn code |
| Verification Lead | **WAIVED FOR IMPLEMENTATION** | evidence theo task, không chặn code |
| Product Owner/CTO + System Architect — PGM-02 v2.2 | **AUTHORIZED FOR IMPLEMENTATION — Phạm Đình Chương, 2026-08-24** | `AUTH-PROG-2026-08-24-05`; exact Candidate `413a043748dce3b44d2c5076412de761760ba17a`; không phải M4/M5 hay Test Result |

## 15. Phụ lục — Tự kiểm cổng M3 (loại: Requirements)

Cổng lấy theo [Plan 54 §7](../03_implementation/54_PROGRAMMING_DOCUMENTATION_ROADMAP.md).
Đây là tự kiểm của chủ quản; review liên chức năng nằm ở
[`PROG-REV-2026-08-09`](../07_records/reviews/PROGRAMMING_DESIGN_SET_REVIEW_2026-08-09.md).

| Cổng | Kết quả | Bằng chứng trong file / lý do |
|---|---|---|
| ID ổn định, không trùng | PASS | 89 ID canonical duy nhất (`SYS/SWR/FW/HW/NFR-REQ-PROG-*`); harness kiểm trùng `0` |
| Mỗi requirement một nghĩa | PASS | §2–§7 mỗi dòng một chủ thể + một hành vi quan sát được; §13.1 cấm “hỗ trợ/tối ưu” |
| Source và rationale | PASS | §2–§7 cột “Nguồn”; §9 rationale theo nhóm |
| Priority | PASS | §2–§6 cột “Ưu tiên” (`Must` cho toàn bộ unified baseline) |
| Allocation theo layer | PASS | §9 owner thiết kế + consumer; §12 biên loại trừ giữa FE/BE/Core/MCU/HW |
| Verification method | PASS | §2–§7 cột “Kiểm chứng” (`T/D/A/I`, HIL, fault injection); §11 phân bổ theo layer |
| Acceptance định lượng | PASS | §2–§7 cột “Tiêu chí chấp nhận”; ngưỡng số ở `NFR-101..108` (ví dụ Check `p95 ≤2 s`, poll gap `<200 ms`) |
| Không lẫn solution chưa duyệt | PASS | 89 requirement được quyết định; PGM-02 Target được phê duyệt cho implementation nhưng chưa ghi thành As-Built |
| Quyền implementation | PASS toàn phạm vi PGM-02 | §8/§10/§14 ghi `AUTH-PROG-2026-08-24-05`, exact Candidate và thứ tự dependency |
| Trace hai chiều | PASS ở lớp thiết kế | 82 baseline nối 44 scenario; bảy PGM-02 requirement nối `VS-PROG-U13..U15`, mọi implementation/test/evidence giữ `N/NOT_RUN`. |
| Link nội bộ sạch | PASS | harness: local link missing `0`, anchor missing `0` |

Maturity M4/M5 không được nâng vì không giả consumer signature/evidence. Bảy
requirement PGM-02 được `AUTHORIZED FOR IMPLEMENTATION` theo chỉ thị điều hành;
discipline/Verification review còn thiếu là `WAIVED FOR IMPLEMENTATION`, không
phải PASS. Requirement chỉ verified khi `VS-PROG-*` tương ứng có Test Result
đúng lớp.
