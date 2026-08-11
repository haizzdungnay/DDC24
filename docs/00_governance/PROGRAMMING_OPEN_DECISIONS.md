# Programming Open Decisions — DDC-24 Rev A

**ID:** PROG-OD-001
**Phiên bản:** 0.9
**Trạng thái:** **17 DECIDED, 0 OPEN, 0 CLOSED — APPROVED FOR IMPLEMENTATION** theo `AUTH-PROG-2026-08-11-03`; downstream sync là công việc triển khai, không còn là điều kiện cấp quyền code
**Chủ quản:** Product / System Engineering
**Reviewer:** Runtime Architect, Controls/Safety, Security, UX, I/O, Ops, QA
**Approver:** Product Owner/CTO theo phạm vi quyết định
**Cập nhật:** 2026-08-11
**Product Spec:** [PROD-PROG-001](../01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md)

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Quản lý 17 quyết định Product/System, phương án, thẩm quyền, hậu quả và việc đồng bộ downstream. Đây là file quyết định, không phải file thiết kế. |
| 2. Ai phải đọc file này? | Mọi owner triển khai đọc decision của lát cắt mình. Runtime/Controls/Safety, Security, UX, I/O, Ops và Verification cung cấp review hậu kiểm; không còn là điều kiện trước khi viết code. |
| 3. Hệ thống hiện tại đang có gì? | Phần Modbus của `OD-PROG-007/008` có contract `Active`. Product Owner/CTO + System Architect Phạm Đình Chương đã phê duyệt toàn bộ phương án target `OD-PROG-001..017` theo `AUTH-PROG-2026-08-11-03`. As-Built vẫn dùng `INT=int32`; target IEC-aligned chỉ thành As-Built sau khi code/migration/test hoàn tất. |
| 4. Thiết kế mới thay đổi điều gì? | File ghi lại quyết định có thẩm quyền, nhưng **không tự biến Target thành As-Built**. `DECIDED` chỉ khóa hướng thiết kế; source, contract, migration và test vẫn phải triển khai theo Plan 53. |
| 5. Team phải sửa module/contract nào? | Không có. Nhưng cột “Hồ sơ downstream” cho biết **file nào phải sửa ngay sau khi một quyết định được ký**; owner downstream phải xác nhận đã cập nhật trước khi chuyển `DECIDED → CLOSED`. |
| 6. Điều gì còn bị chặn? | **Không còn decision/sign-off nào chặn implementation.** `17 DECIDED`, `0 OPEN`; `PLAN_READY` và mọi `IMPLEMENT_READY[*]` là `PASS` theo `AUTH-PROG-2026-08-11-03`. Evidence sản phẩm vẫn được tạo trong lúc implement và chỉ tác động `RELEASE_READY`. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | Không phải test — là **record**. Mỗi mục đóng khi có decision record/ADR đủ trường theo mục “Nội dung bắt buộc của decision record”, cộng bằng chứng mở khóa ở cột cuối bảng Decision package (ví dụ `OD-PROG-008` cần HIL RS485 thật). |

Ba trạng thái và ý nghĩa: `OPEN` = chưa ai có thẩm quyền quyết; `DECIDED` = đã
quyết và có ADR/approval, nhưng tài liệu phụ thuộc chưa sửa xong; `CLOSED` =
quyết định, requirement, verification và traceability đã đồng bộ hết.

## Quy tắc sử dụng

Tài liệu này ghi vòng đời quyết định từ `OPEN` tới `DECIDED/CLOSED`. Nó không
phải Design và không phải Implementation Plan. Một mục chỉ được đóng khi có owner,
quyết định, lý do, ảnh hưởng requirement/verification và liên kết ADR hoặc hồ
sơ phê duyệt. Không được tự lấy hành vi của prototype hoặc host unit test làm
quyết định sản phẩm.

## Danh mục quyết định

| ID | Vấn đề cần quyết định | Ảnh hưởng trước Programming Design | Owner đề xuất | Trạng thái |
|---|---|---|---|---|
| OD-PROG-001 | Role nào được xem, sửa Project, tạo Revision, Deployment, Activation và Rollback; cách ánh xạ vào baseline `viewer/operator/admin` hiện hành. | Chặn ma trận quyền và acceptance security. | Product + Security | **DECIDED** — `AUTH-PROG-2026-08-11-03` |
| OD-PROG-002 | Tập data type chính thức cho Variable/Point ST và FBD, quy tắc conversion, overflow và giá trị khởi tạo. | Chặn type system và I/O Mapping contract. | Product + Runtime | **DECIDED** — `AUTH-PROG-2026-08-11-03` |
| OD-PROG-003 | Capacity sản phẩm: số Project, Program, Revision, Point, Variable và kích thước logic tối đa. | Chặn sizing, persistence và performance acceptance. | Product | **DECIDED** — `AUTH-PROG-2026-08-11-03` |
| OD-PROG-004 | Một Project được có bao nhiêu Program active; cycle time áp dụng theo Program hay task; thứ tự chạy khi có nhiều Program cùng cycle. | Chặn scheduling requirement chi tiết. | Product + Runtime | **DECIDED** — `AUTH-PROG-2026-08-11-03` |
| OD-PROG-005 | Thư viện function/function block tối thiểu của ST và FBD, semantics dùng chung và chính sách versioning. | Chặn phạm vi ngôn ngữ có thể kiểm thử. | Product + Controls | **DECIDED** — `AUTH-PROG-2026-08-11-03` |
| OD-PROG-006 | Trải nghiệm authoring FBD, quy tắc kết nối block và format trao đổi Project/Program. | Chặn interaction và persistence Design; không thay đổi việc FBD thuộc Product Spec. | Product + UX | **DECIDED** — `AUTH-PROG-2026-08-11-03` |
| OD-PROG-007 | Thuộc tính bắt buộc của Local Physical I/O, Virtual Point và Modbus RTU Point: type, unit, quality, timestamp, direction và quyền ghi. Modbus slice đã Active theo approval 2026-08-05; Local/VP/unified mapping chưa khóa. | Chặn schema/contract I/O Mapping toàn Programming. | Product + I/O | **DECIDED** — `AUTH-PROG-2026-08-11-03` |
| OD-PROG-008 | Chi tiết Modbus RTU Point: function code, endian/word order, polling, timeout, stale quality, retry và xử lý lỗi thiết bị. `DDD-SW-MBRTU-POINT-001` đã Active; physical HIL còn mở. | Chặn negative/HIL gate, không chặn reuse contract Active trong design. | Product + Fieldbus | **DECIDED** — reuse contract Active; HIL là evidence release |
| OD-PROG-009 | Chính sách RETAIN cho warm restart, cold restart, power cycle, Revision change, kiểu dữ liệu không tương thích và giới hạn ghi bền vững. | Chặn persistence/recovery Design và acceptance. | Product + Runtime | **DECIDED** — `AUTH-PROG-2026-08-11-03` |
| OD-PROG-010 | Số Revision được giữ, điều kiện compatibility, quyền và điều kiện cho Deployment/Activation/Rollback, kể cả power loss giữa giao dịch. | Chặn lifecycle state machine và recovery acceptance. | Product + System | **DECIDED** — `AUTH-PROG-2026-08-11-03` |
| OD-PROG-011 | Online Monitor refresh rate, độ sâu trace, retention, timestamp/quality và chính sách write/force tách biệt. | Chặn monitor contract; Online Monitor mặc định chỉ quan sát. | Product + UX | **DECIDED** — `AUTH-PROG-2026-08-11-03` |
| OD-PROG-012 | Budget thực thi/WCET/overrun cho ba cycle time và hành vi khi Program lỗi, treo hoặc vượt budget. | Chặn performance/fault acceptance; không biến DDC-24 thành safety PLC. | Product + Runtime | **DECIDED** — `AUTH-PROG-2026-08-11-03` |
| OD-PROG-013 | Quan hệ migration của component graph 28-node As-Built với Project/Program Rev A, gồm các node Modbus TCP/BACnet ngoài scope. | Chặn compatibility strategy; các node cũ không tự trở thành Product Capability. | Product + Architecture | **DECIDED** — `AUTH-PROG-2026-08-11-03` |
| OD-PROG-014 | Quy tắc đồng tồn tại và chuyển đổi với dữ liệu/config cũ trên thiết bị đã triển khai. | Chặn upgrade/rollback compatibility. | Product + Operations | **DECIDED** — `AUTH-PROG-2026-08-11-03` |
| OD-PROG-015 | Hồ sơ Product approval và tiêu chí đóng readiness gate sau khi source foundation được sửa và target evidence có sẵn. | Chặn tuyên bố sẵn sàng bước Programming Design theo workflow đã duyệt. | Product + QA | **DECIDED — baseline approved for implementation** theo `AUTH-PROG-2026-08-11-03` |
| OD-PROG-016 | Có chấp thuận Amendment A1 của Product Spec không: rút sáu trang thành **bốn workspace** `PGM-01..04` và thay 17 use case bằng **tám user journey** `UJ-PROG-01..08`. | Chặn IA, route, FE/BE contract và toàn bộ trace của bộ thiết kế. Nếu từ chối, downstream phải quay lại IA sáu trang. | Product + UX | **DECIDED** — `AUTH-PROG-2026-08-11-03` |
| OD-PROG-017 | Có đưa **thư viện mẫu BMS** (AHU, pump, fan, valve, PID vòng đơn) vào Rev A hay để Roadmap; nếu có thì mẫu là template sinh code trong Draft hay function block trong Core Library. | Chặn phạm vi Core Library, hệ thống versioning thư viện và điểm cạnh tranh “Editor và tái sử dụng”. Không chặn bốn workspace. | Product + Controls | **DECIDED** — hoãn mẫu BMS theo `AUTH-PROG-2026-08-11-03` |

### Ánh xạ decision request của Modbus RTU Point proposal

Không tạo decision list song song. Các request `DR-MBRTU-*` trong
`DDD-SW-MBRTU-POINT-001` được quản lý bởi open decision hiện hữu như sau. Approval
2026-08-05 đã cho phép dùng Modbus contract Active; các mục chỉ đóng toàn bộ khi
Local/VP mapping, Programming integration và HIL được đồng bộ:

| Decision request | Open decision chủ quản |
|---|---|
| DR-MBRTU-001..007 | OD-PROG-007, OD-PROG-008 và OD-PROG-014; riêng xung đột hai production RS485 path còn là evidence/readiness của OD-PROG-015 |
| DR-MBRTU-008 | OD-PROG-003 và OD-PROG-008 |
| DR-MBRTU-009 | OD-PROG-001 |

## Decision package dùng cho review

Bảng này ghi phương án target đã được phê duyệt để team triển khai. Deadline/gate
giữ làm trace lịch sử; không còn là approval condition.

| ID | Phương án target cần phê duyệt | Hồ sơ downstream | Deadline/gate | Bằng chứng để mở khóa |
|---|---|---|---|---|
| `OD-PROG-001` | `viewer/operator` read-only Programming; `admin` edit/check/commission/restore/reset RETAIN; server là authority | SRS, Security, Interface, FE, BE, V&V | Trước `DOC-G2` | permission matrix ký + 403 negative test design |
| `OD-PROG-002` | Phê duyệt exact name/width cho signed/unsigned integer và bounded `ENUM/uINT`: As-Built đang dùng `INT=int32`, trong khi phương án IEC-aligned là `INT=int16`, `DINT=int32`, `UINT=uint16`; cùng `BOOL/REAL/TIME`. Explicit conversion, overflow/div-zero/non-finite fail; ARRAY/STRUCT/String OUT nếu chưa duyệt | Language, Data, Mapping, Artifact | Trước `DOC-G2` | type-name/bit-width/Point/IR encoding matrix, migration/profile và one-over cases |
| `OD-PROG-003` | 1 active Project package/controller; một Task; ST 64 KiB/512 variable/4096 statement; FBD 256 block/512 connection; artifact 1 MiB; binding 256 | SRS, Data, Language, Artifact, BE | Trước `DOC-G2` | sizing RAM/storage/latency analysis + Product acceptance |
| `OD-PROG-004` | Một Task Rev A, period `1/5/30 s`; Program Instance chạy theo order ổn định trong Task | Control, Runtime, FW-SOM | Trước `DOC-G2` | scheduler profile + base-step/watchdog review |
| `OD-PROG-005` | Core Library: logic/compare/math/select/limit/timer/edge/counter/scaling/deadband/PI/PID; version nằm trong artifact | Language, Control, UX | Trước `DOC-G2` | semantics/pin/state/version + equivalence test design |
| `OD-PROG-006` | FBD structured tree/list/inspector, typed pins/wires, explicit order/conversion, keyboard-complete; không free-form wiresheet | Language, Data, UX, FE | Trước `DOC-G2` | canonical schema, command model, source-map và a11y review |
| `OD-PROG-007` | Canonical discriminated identity `LOCAL/VP/MB-RTU`, type/direction/writable/unit/quality/timestamp/freshness; missing không thành zero | Data, Interface, FE, BE, FW-SOM | Trước `DOC-G2` | Point Catalog + Active Modbus contract cross-review |
| `OD-PROG-008` | Reuse toàn bộ Active Modbus Bus/Device/Point contract; Programming chỉ bind `{device_id,point_id}`, không tái định nghĩa endian/polling | Data, Interface, FW-SOM, V&V | Trước `DOC-G3`; HIL trước release | contract link sạch + real RS485 HIL record |
| `OD-PROG-009` | RETAIN theo stable variable identity/layout hash/version/CRC; mismatch/corrupt cold-init có diagnostic; atomic save tối thiểu cách 60 s; reset chỉ admin | Data, Runtime, Security, Ops | Trước `DOC-G2` | warm/cold/revision/power matrix + endurance review |
| `OD-PROG-010` | Giữ immutable Revision + active/LKG; retention count/quota do sizing chốt; stage/swap/LKG atomic; power-loss luôn phục hồi LKG hoặc no-active rõ | Data, Runtime, BE, Ops | Trước `DOC-G2` | persistence transaction + fault-at-each-step design |
| `OD-PROG-011` | Monitor 1 Hz, stale sau 3 kỳ; trace tối đa 10.000 sample/10 phút; read-only; write/force là capability khác | Interface, UX, FE, FW-SOM | Trước `DOC-G3` | memory/bandwidth/retention analysis + UX review |
| `OD-PROG-012` | Budget nhỏ hơn `20% period` và base-step/watchdog margin; 3 overrun liên tiếp fault đúng Task, không tự plant safe-state | Control, FW-SOM, V&V | Trước `DOC-G2` | WCET formula + Safety review + target benchmark plan |
| `OD-PROG-013` | Config mode `GRAPH_ONLY/PROGRAM_ONLY`; dual-run invalid; graph là migration source, không relabel FBD | Architecture, Runtime, Ops | Trước `DOC-G2` | inventory graph, cutover ADR, output/mapping compatibility report |
| `OD-PROG-014` | Backup trước migration; schema/version explicit; partial deploy fail closed; code/schema/artifact deploy order; rollback không xóa dữ liệu | Architecture, Data, Ops, Plan 53 | Trước `DOC-G4` | device inventory + migration/rollback rehearsal plan |
| `OD-PROG-015` | Phê duyệt Product v2.2 + SRS/design set sau review; không dùng host component làm readiness evidence | toàn bộ baseline 22 | `DOC-G4` | **DECIDED / APPROVED FOR IMPLEMENTATION** theo `AUTH-PROG-2026-08-11-03`; QA signature waived khỏi entry |
| `OD-PROG-016` | Chấp thuận bốn workspace + tám journey; giữ nguyên toàn bộ hành vi an toàn Commission/Restore/RETAIN; giữ `UC-PROG-*` làm lớp scenario có trạng thái `MERGED/SCENARIO/ROADMAP` | Product Spec §8–§9, UX, FE, BE, IFSPEC, SRS, VVP, Trace, Plan 53 | Trước `DOC-G3` | bảng điểm heuristic ≥85, ma trận migration 17 UC không mồ côi, visual asset bốn workspace, và biên bản UX/Product review |
| `OD-PROG-017` | Hoãn thư viện mẫu BMS sang Roadmap sau Rev A; Rev A chỉ giữ Core Library và User FB cục bộ trong Project | Product Spec §8.5–§8.6, Language/Compiler, UX, Plan 53 | Trước `DOC-G3` | phân tích chi phí compiler/test/tài liệu cho mẫu, và quyết định Product về việc mẫu là template hay function block |

## Biên bản ủy quyền quyết định ngày 2026-08-10

- **Record:** `AUTH-PROG-2026-08-10-01`
- **Người ủy quyền:** **Phạm Đình Chương**
- **Vai trò do người dùng xác nhận:** **Product Owner/CTO + System Architect**
- **Cách ghi nhận:** người dùng chọn các phương án dưới đây và yêu cầu Codex “ký
thay tôi”. Codex chỉ ghi lại **ủy quyền điện tử** với vai trò thư ký hồ sơ; không
giả chữ ký viết tay, không cấp chứng thư số và không ký thay QA, Safety, Security
hoặc discipline authority khác.
- **Ngày hiệu lực:** 2026-08-10 đối với phạm vi quyền Product/Architect.
- **Candidate:** bộ 22 SHA-256 phát hành lại tại
[`PROG-P0-CANDIDATE-MANIFEST-2026-08-10`](../07_records/reviews/PROGRAMMING_P0_CANDIDATE_MANIFEST_2026-08-10.md)
v2.5 sau khi ghi biên bản này.
- **Rollback:** nếu người ủy quyền rút/chỉnh quyết định, tạo record mới dẫn record
này, chuyển mục bị ảnh hưởng về `OPEN`, vô hiệu candidate liên quan và không xóa
lịch sử.

| ID / phạm vi | Quyết định được ủy quyền ghi nhận | Kết quả quyền hạn hiện tại |
|---|---|---|
| P0-01 | `ACCEPT` candidate sau khi chỉ thực hiện đúng các thay đổi ghi quyết định trong record này; target/HIL vẫn là gate sau | Product + Architect `ACCEPT`; Verification và consumer signatures còn thiếu |
| F-CR-02 | Gốc staging artifact là `${STATE_DIR}/programming/staging/` | System Architect `ACCEPT`; finding authority **DONE** |
| `OD-PROG-001` | `viewer/operator` chỉ đọc; `admin` edit/check/commission/restore/reset RETAIN; server là authority | Product `ACCEPT`; chờ Security |
| `OD-PROG-002` | IEC-aligned: `INT=int16`, `DINT=int32`, `UINT=uint16`, cùng `BOOL/REAL/TIME`; conversion tường minh; overflow/div-zero/non-finite fail | Product `ACCEPT`; chờ Runtime |
| `OD-PROG-003` | 1 active Project/controller; 1 Task; ST 64 KiB, 512 variable, 4096 statement; FBD 256 block/512 connection; artifact 1 MiB; 256 binding | **DECIDED** bởi Product; chờ downstream sync |
| `OD-PROG-004` | Một Task Rev A, period `1/5/30 s`; Program Instance chạy theo thứ tự ổn định | Product + Architect `ACCEPT`; chờ Runtime |
| `OD-PROG-005` | Core Library gồm logic/compare/math/select/limit/timer/edge/counter/scaling/deadband/PI/PID; version nằm trong artifact | Product `ACCEPT`; chờ Controls |
| `OD-PROG-006` | FBD structured tree/list/inspector, typed pin/wire, explicit order/conversion, keyboard-complete; không free-form wiresheet | Product `ACCEPT`; chờ UX |
| `OD-PROG-007` | Canonical identity `LOCAL/VP/MB-RTU`; có type/direction/writable/unit/quality/timestamp/freshness; missing không thành zero | Product `ACCEPT`; chờ I/O |
| `OD-PROG-009` | Stable variable identity + layout hash/version/CRC; mismatch/corrupt cold-init kèm diagnostic; atomic save tối thiểu 60 giây; reset chỉ admin | Product + Architect `ACCEPT`; chờ Runtime |
| `OD-PROG-010` | Revision immutable; giữ Active + LKG; stage/swap atomic; power loss phục hồi LKG hoặc trạng thái no-active rõ ràng | **DECIDED** bởi Product + System; chờ downstream sync |
| `OD-PROG-012` | Budget `<20% period`; ba overrun liên tiếp làm đúng Task chuyển `FAULT`, output mức 5 hold-last; chỉ SafetyManager được đưa toàn trạm vào safe-state | Product + Architect `ACCEPT`; chờ Runtime + Safety |
| `OD-PROG-013` | Chỉ `GRAPH_ONLY` hoặc `PROGRAM_ONLY`; dual-run invalid; graph cũ là nguồn migration, không relabel thành FBD | **DECIDED** bởi Product + Architect; chờ downstream sync |
| `OD-PROG-014` | Backup trước migration; schema/version explicit; mixed/partial deploy fail-closed; rollback không xóa DB/Revision/Artifact/audit | Product + Architect `ACCEPT`; chờ Operations |
| `OD-PROG-015` | Chấp thuận Product v2.2, SRS và design set làm baseline implement; host test không thay target/HIL | Product + Architect `ACCEPT`; chờ QA/Verification trước khi đóng |
| `OD-PROG-016` | Bốn workspace `PGM-01..04` và tám journey | Product `ACCEPT`; chờ UX |
| `OD-PROG-017` | Hoãn template AHU/pump/fan/valve sang Roadmap; Rev A giữ Core Library và User FB | Product `ACCEPT`; chờ Controls |
| `ADR-030` | Hai lớp mã: `PRG-ERR-*` công khai, mã nội bộ trong `detailCode`; mapping thiếu làm build fail | System Architect `ACCEPT`; chờ Verification |
| `ADR-031` | Rev A `HASH_ONLY`, SHA-256 bắt buộc, compiler/staging thuộc trusted local boundary; giữ layout chữ ký cho phase sau | System Architect `ACCEPT`; chờ Security |

**Rationale.** Các phương án giữ Rev A bounded, giảm độ phức tạp UI/operation,
tái sử dụng contract hiện hữu, fail-closed ở ranh giới dữ liệu/deploy và tách lỗi
Task khỏi safe-state toàn trạm. Đây là lựa chọn phù hợp nguồn lực hãng nhỏ nhưng
không loại bỏ gate an toàn, target/HIL hay kiểm chứng độc lập.

**Hệ quả lịch sử của record 01.** `OD-PROG-003/010/013` được chuyển `DECIDED`;
các mục khác từng giữ `OPEN`. Phần “chờ discipline đồng phê duyệt trước khi code”
được `AUTH-PROG-2026-08-11-03` supersede; không xóa lịch sử quyết định.

## Chỉ thị phê duyệt toàn bộ ngày 2026-08-11

- **Record:** `AUTH-PROG-2026-08-11-03`.
- **Người ủy quyền:** **Phạm Đình Chương**.
- **Vai trò:** **Product Owner/CTO + System Architect**.
- **Chỉ thị:** review và phê duyệt toàn bộ bộ Programming Rev A để team được
  implement, không chờ thêm chữ ký consumer/discipline/Verification, CI/CD,
  target hoặc HIL.
- **Quyết định:** chấp thuận nguyên trạng phương án target của
  `OD-PROG-001..017` trong bảng Decision package; chuyển toàn bộ sang `DECIDED`.
  Downstream sync được thực hiện trong task code tương ứng và không còn là điều
  kiện cấp quyền bắt đầu/tiếp tục implementation.
- **Gate:** `PLAN_READY = PASS`; mọi `IMPLEMENT_READY[*] = PASS`. Team được tạo
  nhánh, viết và merge code production, tạo/đổi contract và bật feature flag ở
  lab theo Plan 53 mà không cần một approval record bổ sung.
- **Review còn thiếu:** ghi `WAIVED FOR IMPLEMENTATION`, không giả chữ ký. Mọi
  comment về sau là finding hậu kiểm và được xử lý như lỗi trong phạm vi task,
  không hồi tố đóng quyền implementation đã cấp.
- **Release:** record này không đổi Test Result và không tuyên bố sản phẩm/site
  đã release; `RELEASE_READY` được đánh giá từ evidence sau implementation.

## So sánh phương án và hậu quả nếu trì hoãn

| Nhóm OD | Phương án đề xuất | Phương án thay thế cần đánh giá | Hậu quả nếu chưa quyết định |
|---|---|---|---|
| `001` RBAC | viewer/operator đọc; admin mutation | tách commissioning role hoặc operator Commission | FE/BE không thể khóa action/403 test; Commission bị chặn |
| `002/003` type/capacity | profile bounded theo §Decision package | giữ As-Built INT32 hoặc thu nhỏ capacity theo target | schema/IR/Point mapping và sizing không được freeze |
| `004/012` Task/timing | một Task 1/5/30 s, budget <20% | period tùy ý hoặc multi-Task | scheduler/WCET/watchdog/HIL không có acceptance ổn định |
| `005/006` library/FBD | library versioned + structured typed FBD | ST-only Rev A hoặc free-form canvas | compiler/FE/source-map không thể đồng triển khai |
| `007/008` Point | canonical identity, reuse Modbus contract | adapter riêng trong Programming | tạo hai truth và nguy cơ sai quality/endian/writable |
| `009/010` RETAIN/LKG | identity/hash/CRC + atomic journal | không RETAIN Rev A hoặc reset mọi activation | không thể chốt recovery/endurance/rollback behavior |
| `011` monitor/trace | 1 Hz, stale 3 kỳ, bounded 10k/10 phút | on-demand sampling hoặc capacity thấp hơn | FE/Core không chốt buffer/bandwidth/freshness |
| `013/014` cutover/migration | exclusive mode + backup/rollback | tiếp tục graph-only hoặc dual-run shadow không output | production cutover và package rollback bị chặn |
| `015` baseline | review rồi phê duyệt bộ 22 hồ sơ | thu hẹp Rev A và sửa lại SRS | không file nào được phép thành implementation baseline |
| `016` IA/journey | bốn workspace + tám journey | giữ sáu trang + 17 UC như hiện tại | FE không khóa được route/component; trace tồn tại hai lớp UC và UJ song song; điểm heuristic giữ `76/100` |
| `017` thư viện mẫu | hoãn sang Roadmap | đưa mẫu AHU/pump/valve vào Rev A | nếu hoãn: tiêu chí “Editor và tái sử dụng” giữ `3,5/5`. Nếu làm ngay: tăng phạm vi compiler/test/tài liệu và có nguy cơ trượt Rev A |

Mỗi reviewer phải ghi `ACCEPT`, `REJECT` hoặc `REQUEST CHANGE` cùng rationale.
Không dùng im lặng, merge code hoặc test PASS để suy ra một quyết định đã được
chấp thuận.

## Ma trận trách nhiệm ra quyết định

| Nhóm | R — chuẩn bị | A — quyết định | C — bắt buộc | Tài liệu ghi quyết định |
|---|---|---|---|---|
| Product scope/capacity/RBAC | Product + System | Product Owner/CTO | Security, Runtime, UX, QA | approval record/ADR + file này |
| Language/FBD/library | Compiler + Controls | Product + Runtime Architect | UX/FE, QA | ADR hoặc design approval record |
| Runtime/safety/RETAIN | Core + Controls | Runtime Architect + Safety Reviewer | Ops, HW/FW, QA | ADR + review record |
| Point/Modbus | I/O + Fieldbus | Product + I/O Architect | FE/BE/Core, QA | Active Modbus docs + Programming approval |
| Migration/release | Architect + Ops | Product/Release Owner | Security, QA, all consumers | ADR/runbook approval |

## Nội dung bắt buộc của decision record

Khi quyết định, record/ADR liên kết phải có: ID, ngày/authority, context, options,
decision, rationale, consequence tích cực/tiêu cực, requirement/design/API bị
ảnh hưởng, migration/rollback, verification update và thời điểm hiệu lực. Owner
downstream xác nhận đã cập nhật trước khi chuyển `DECIDED → CLOSED`.

## Điều kiện chuyển trạng thái

- `OPEN`: chưa có quyết định đủ thẩm quyền.
- `DECIDED`: đã có quyết định và liên kết ADR/approval, nhưng tài liệu phụ thuộc
  chưa đồng bộ.
- `CLOSED`: decision, requirement, verification và traceability đã đồng bộ.

Tại thời điểm 2026-08-11 sau `AUTH-PROG-2026-08-11-03`, có **`17 DECIDED`,
`0 OPEN`, `0 CLOSED`**. `CLOSED` vẫn chờ source/contract/test được đồng bộ thật;
trạng thái đó không còn là điều kiện cấp quyền implementation.

## Lịch sử sửa đổi và sign-off

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1 | 2026-08-03 | Tạo 15 Open Decision Programming |
| 0.2 | 2026-08-09 | Thêm decision package, downstream/gate/unlock evidence; đồng bộ approval Modbus 2026-08-05 |
| 0.3 | 2026-08-09 | Bổ sung option/trade-off, hậu quả trì hoãn và schema decision record; giữ 15 mục OPEN chờ authority |
| 0.4 | 2026-08-09 | Thêm mục Đọc nhanh và phụ lục tự kiểm cổng M3 loại Open Decisions; giữ 15 mục OPEN |
| 0.5 | 2026-08-09 | Thêm `OD-PROG-016` (bốn workspace + tám journey) và `OD-PROG-017` (thư viện mẫu BMS) kèm option/trade-off/gate/bằng chứng mở khóa; tổng 17 mục OPEN |
| 0.6 | 2026-08-10 | Sửa mô tả hiện trạng: chỉ hai phần Modbus của `007/008` đã quyết định, còn 15 mục khác chưa ký; bổ sung đúng phạm vi ký Product tới `017`; không đổi trạng thái 17/17 `OPEN` |
| 0.7 | 2026-08-10 | Ghi rõ `OD-PROG-015` đã đạt **2/3** điều kiện mở khóa (review record + `9/9` finding closure); điều kiện duy nhất còn thiếu là sign-off Product/Architect/QA. Trạng thái **không đổi**: 17/17 vẫn `OPEN` |
| 0.8 | 2026-08-10 | Ghi `AUTH-PROG-2026-08-10-01`: Phạm Đình Chương ủy quyền điện tử với vai trò Product Owner/CTO + System Architect; chuyển `OD-PROG-003/010/013` sang `DECIDED`, ghi partial `ACCEPT` cho các mục đã chọn; giữ `14 OPEN`, `0 CLOSED` và mọi gate bị chặn cho tới khi đủ đồng phê duyệt/downstream sync |
| 0.9 | 2026-08-11 | Ghi `AUTH-PROG-2026-08-11-03`: Product Owner/CTO + System Architect phê duyệt toàn bộ target `OD-PROG-001..017`; chuyển thành `17 DECIDED/0 OPEN/0 CLOSED`; mở `PLAN_READY` và mọi `IMPLEMENT_READY[*]` không điều kiện, review còn thiếu thành hậu kiểm |

| Vai trò | Trạng thái | Phạm vi ký |
|---|---|---|
| Product Owner/CTO | **ACCEPT ALL — Phạm Đình Chương, 2026-08-11; `AUTH-PROG-2026-08-11-03`** | `OD-PROG-001..017`; cấp quyền implement toàn bộ Programming Rev A |
| System Architect | **ACCEPT ALL — Phạm Đình Chương, 2026-08-11; `AUTH-PROG-2026-08-11-03`** | Toàn bộ ownership/contract/ADR và lát cắt implementation |
| Runtime/Controls/Safety | **WAIVED FOR IMPLEMENTATION** | Review hậu kiểm; không chặn code |
| Security/UX/I/O/Ops | **WAIVED FOR IMPLEMENTATION** | Review hậu kiểm; không chặn code |
| Verification Lead | **WAIVED FOR IMPLEMENTATION** | Evidence vẫn được tạo/đánh giá trong task và release gate |

## Phụ lục — Tự kiểm cổng M3 (loại: Open Decisions)

Cổng lấy theo [Plan 54 §7](../03_implementation/54_PROGRAMMING_DOCUMENTATION_ROADMAP.md).

| Cổng | Kết quả | Bằng chứng trong file / lý do |
|---|---|---|
| Context của từng quyết định | PASS | Bảng “Quyết định đang mở” cột “Vấn đề cần quyết định” + cột ảnh hưởng |
| Options và trade-off | PASS | Bảng “So sánh phương án và hậu quả nếu trì hoãn” có phương án đề xuất, phương án thay thế và hậu quả cho cả 17 mục |
| Decision authority | PASS | Cột “Owner đề xuất” + “Ma trận trách nhiệm ra quyết định” tách R/A/C |
| Deadline/gate | PASS | Bảng Decision package cột “Deadline/gate” gắn `DOC-G2/G3/G4`, không dùng ngày lịch giả định |
| Quyết định | **PASS FOR IMPLEMENTATION** | `17 DECIDED`, `0 OPEN`, `0 CLOSED` theo `AUTH-PROG-2026-08-11-03`; downstream sync là DoD của task, không phải entry gate |
| Rationale | PASS cho record đã quyết; N/A cho mục chưa đủ quyền | §“Biên bản ủy quyền” ghi rationale chung; decision package giữ trade-off riêng từng nhóm |
| Consequences | PASS | Cột “Hậu quả nếu chưa quyết định” cho 11 nhóm phủ đủ 17 mục |
| Tài liệu phụ thuộc phải đồng bộ | PASS | Bảng Decision package cột “Hồ sơ downstream”; điều kiện `DECIDED → CLOSED` yêu cầu owner downstream xác nhận |
| Bằng chứng mở khóa | PASS | Cột “Bằng chứng để mở khóa” cụ thể theo từng mục (ví dụ `OD-PROG-008` cần record HIL RS485 thật) |
| Link nội bộ sạch | PASS | harness: local link missing `0`, anchor missing `0` |

File giữ M3 theo thang maturity vì chữ ký discipline được waive, không giả thành
M4/M5. Điều này **không chặn implementation**: `PLAN_READY` và mọi
`IMPLEMENT_READY[*]` đã `PASS` theo chỉ thị cấp điều hành.
