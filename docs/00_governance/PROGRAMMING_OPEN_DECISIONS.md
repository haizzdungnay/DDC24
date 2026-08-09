# Programming Open Decisions — DDC-24 Rev A

**ID:** PROG-OD-001
**Phiên bản:** 0.6
**Trạng thái:** M3 — Review Ready — gói quyết định đủ để ký; 17/17 vẫn OPEN
**Chủ quản:** Product / System Engineering
**Reviewer:** Runtime Architect, Controls/Safety, Security, UX, I/O, Ops, QA
**Approver:** Product Owner/CTO theo phạm vi quyết định
**Cập nhật:** 2026-08-10
**Product Spec:** [PROD-PROG-001](../01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md)

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Liệt kê **17 việc chưa ai quyết**, mỗi việc kèm phương án đề xuất, phương án thay thế và hậu quả nếu tiếp tục trì hoãn. Đây là file để họp và ký, không phải file thiết kế. |
| 2. Ai phải đọc file này? | Product Owner/CTO (ký `001..006`, `009..017`), Runtime/Controls/Safety (`002/004/005/009/012/013`), Security, UX, I/O, Ops và Verification Lead. Dev đọc để biết vì sao một con số trong thiết kế còn ghi `TARGET-PENDING`. |
| 3. Hệ thống hiện tại đang có gì? | Chỉ hai **phần** đã có quyết định: Modbus RTU Bus/Device/Point contract `Active` từ 2026-08-05 (phần Modbus của `OD-PROG-007/008`) và `DDD-SW-MBRTU-POINT-001`. Cả `007/008` vẫn chưa đóng toàn bộ; 15 mục khác chưa có quyết định ký. As-Built hiện dùng `INT=int32`, khác phương án IEC-aligned đang đề xuất. |
| 4. Thiết kế mới thay đổi điều gì? | Không thay gì cả — file này **không được** tự quyết. Nó chuẩn bị sẵn phương án target ở bảng “Decision package” để approver chỉ việc `ACCEPT`/`REJECT`/`REQUEST CHANGE` kèm lý do. |
| 5. Team phải sửa module/contract nào? | Không có. Nhưng cột “Hồ sơ downstream” cho biết **file nào phải sửa ngay sau khi một quyết định được ký**; owner downstream phải xác nhận đã cập nhật trước khi chuyển `DECIDED → CLOSED`. |
| 6. Điều gì còn bị chặn? | 17/17 `OPEN`. Nặng nhất: `OD-PROG-002` (bề rộng kiểu số — As-Built `INT=int32` vs đề xuất `INT=int16`, ảnh hưởng cả IR lẫn Point mapping) và `OD-PROG-015` (chưa ký thì **không hồ sơ nào** được dùng làm baseline implement). |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | Không phải test — là **record**. Mỗi mục đóng khi có decision record/ADR đủ trường theo mục “Nội dung bắt buộc của decision record”, cộng bằng chứng mở khóa ở cột cuối bảng Decision package (ví dụ `OD-PROG-008` cần HIL RS485 thật). |

Ba trạng thái và ý nghĩa: `OPEN` = chưa ai có thẩm quyền quyết; `DECIDED` = đã
quyết và có ADR/approval, nhưng tài liệu phụ thuộc chưa sửa xong; `CLOSED` =
quyết định, requirement, verification và traceability đã đồng bộ hết.

## Quy tắc sử dụng

Tài liệu này chỉ ghi vấn đề chưa có quyết định được phê duyệt. Nó không phải
Design và không phải Implementation Plan. Một mục chỉ được đóng khi có owner,
quyết định, lý do, ảnh hưởng requirement/verification và liên kết ADR hoặc hồ
sơ phê duyệt. Không được tự lấy hành vi của prototype hoặc host unit test làm
quyết định sản phẩm.

## Quyết định đang mở

| ID | Vấn đề cần quyết định | Ảnh hưởng trước Programming Design | Owner đề xuất | Trạng thái |
|---|---|---|---|---|
| OD-PROG-001 | Role nào được xem, sửa Project, tạo Revision, Deployment, Activation và Rollback; cách ánh xạ vào baseline `viewer/operator/admin` hiện hành. | Chặn ma trận quyền và acceptance security. | Product + Security | OPEN |
| OD-PROG-002 | Tập data type chính thức cho Variable/Point ST và FBD, quy tắc conversion, overflow và giá trị khởi tạo. | Chặn type system và I/O Mapping contract. | Product + Runtime | OPEN |
| OD-PROG-003 | Capacity sản phẩm: số Project, Program, Revision, Point, Variable và kích thước logic tối đa. | Chặn sizing, persistence và performance acceptance. | Product | OPEN |
| OD-PROG-004 | Một Project được có bao nhiêu Program active; cycle time áp dụng theo Program hay task; thứ tự chạy khi có nhiều Program cùng cycle. | Chặn scheduling requirement chi tiết. | Product + Runtime | OPEN |
| OD-PROG-005 | Thư viện function/function block tối thiểu của ST và FBD, semantics dùng chung và chính sách versioning. | Chặn phạm vi ngôn ngữ có thể kiểm thử. | Product + Controls | OPEN |
| OD-PROG-006 | Trải nghiệm authoring FBD, quy tắc kết nối block và format trao đổi Project/Program. | Chặn interaction và persistence Design; không thay đổi việc FBD thuộc Product Spec. | Product + UX | OPEN |
| OD-PROG-007 | Thuộc tính bắt buộc của Local Physical I/O, Virtual Point và Modbus RTU Point: type, unit, quality, timestamp, direction và quyền ghi. Modbus slice đã Active theo approval 2026-08-05; Local/VP/unified mapping chưa khóa. | Chặn schema/contract I/O Mapping toàn Programming. | Product + I/O | OPEN — Modbus portion DECIDED |
| OD-PROG-008 | Chi tiết Modbus RTU Point: function code, endian/word order, polling, timeout, stale quality, retry và xử lý lỗi thiết bị. `DDD-SW-MBRTU-POINT-001` đã Active; physical HIL còn mở. | Chặn negative/HIL gate, không chặn reuse contract Active trong design. | Product + Fieldbus | OPEN — contract DECIDED, HIL OPEN |
| OD-PROG-009 | Chính sách RETAIN cho warm restart, cold restart, power cycle, Revision change, kiểu dữ liệu không tương thích và giới hạn ghi bền vững. | Chặn persistence/recovery Design và acceptance. | Product + Runtime | OPEN |
| OD-PROG-010 | Số Revision được giữ, điều kiện compatibility, quyền và điều kiện cho Deployment/Activation/Rollback, kể cả power loss giữa giao dịch. | Chặn lifecycle state machine và recovery acceptance. | Product + System | OPEN |
| OD-PROG-011 | Online Monitor refresh rate, độ sâu trace, retention, timestamp/quality và chính sách write/force tách biệt. | Chặn monitor contract; Online Monitor mặc định chỉ quan sát. | Product + UX | OPEN |
| OD-PROG-012 | Budget thực thi/WCET/overrun cho ba cycle time và hành vi khi Program lỗi, treo hoặc vượt budget. | Chặn performance/fault acceptance; không biến DDC-24 thành safety PLC. | Product + Runtime | OPEN |
| OD-PROG-013 | Quan hệ migration của component graph 28-node As-Built với Project/Program Rev A, gồm các node Modbus TCP/BACnet ngoài scope. | Chặn compatibility strategy; các node cũ không tự trở thành Product Capability. | Product + Architecture | OPEN |
| OD-PROG-014 | Quy tắc đồng tồn tại và chuyển đổi với dữ liệu/config cũ trên thiết bị đã triển khai. | Chặn upgrade/rollback compatibility. | Product + Operations | OPEN |
| OD-PROG-015 | Hồ sơ Product approval và tiêu chí đóng readiness gate sau khi source foundation được sửa và target evidence có sẵn. | Chặn tuyên bố sẵn sàng bước Programming Design theo workflow đã duyệt. | Product + QA | OPEN |
| OD-PROG-016 | Có chấp thuận Amendment A1 của Product Spec không: rút sáu trang thành **bốn workspace** `PGM-01..04` và thay 17 use case bằng **tám user journey** `UJ-PROG-01..08`. | Chặn IA, route, FE/BE contract và toàn bộ trace của bộ thiết kế. Nếu từ chối, downstream phải quay lại IA sáu trang. | Product + UX | OPEN |
| OD-PROG-017 | Có đưa **thư viện mẫu BMS** (AHU, pump, fan, valve, PID vòng đơn) vào Rev A hay để Roadmap; nếu có thì mẫu là template sinh code trong Draft hay function block trong Core Library. | Chặn phạm vi Core Library, hệ thống versioning thư viện và điểm cạnh tranh “Editor và tái sử dụng”. Không chặn bốn workspace. | Product + Controls | OPEN |

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

Bảng này ghi phương án target hiện có để approver ra quyết định; nó không tự đổi
trạng thái `OPEN`. Deadline là gate tài liệu, không phải ngày lịch giả định.

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
| `OD-PROG-015` | Phê duyệt Product v2.2 + SRS/design set sau review; không dùng host component làm readiness evidence | toàn bộ baseline 22 | `DOC-G4` | review record, finding closure, sign-off Product/Architect/QA |
| `OD-PROG-016` | Chấp thuận bốn workspace + tám journey; giữ nguyên toàn bộ hành vi an toàn Commission/Restore/RETAIN; giữ `UC-PROG-*` làm lớp scenario có trạng thái `MERGED/SCENARIO/ROADMAP` | Product Spec §8–§9, UX, FE, BE, IFSPEC, SRS, VVP, Trace, Plan 53 | Trước `DOC-G3` | bảng điểm heuristic ≥85, ma trận migration 17 UC không mồ côi, visual asset bốn workspace, và biên bản UX/Product review |
| `OD-PROG-017` | Hoãn thư viện mẫu BMS sang Roadmap sau Rev A; Rev A chỉ giữ Core Library và User FB cục bộ trong Project | Product Spec §8.5–§8.6, Language/Compiler, UX, Plan 53 | Trước `DOC-G3` | phân tích chi phí compiler/test/tài liệu cho mẫu, và quyết định Product về việc mẫu là template hay function block |

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

Tại thời điểm 2026-08-09, cả 17 mục vẫn có trạng thái tổng thể `OPEN`; riêng phần
Modbus của `OD-PROG-007/008` đã có contract Active. Không được lấp khoảng trống
bằng hành vi supporting component hoặc giả định thiết kế.

## Lịch sử sửa đổi và sign-off

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1 | 2026-08-03 | Tạo 15 Open Decision Programming |
| 0.2 | 2026-08-09 | Thêm decision package, downstream/gate/unlock evidence; đồng bộ approval Modbus 2026-08-05 |
| 0.3 | 2026-08-09 | Bổ sung option/trade-off, hậu quả trì hoãn và schema decision record; giữ 15 mục OPEN chờ authority |
| 0.4 | 2026-08-09 | Thêm mục Đọc nhanh và phụ lục tự kiểm cổng M3 loại Open Decisions; giữ 15 mục OPEN |
| 0.5 | 2026-08-09 | Thêm `OD-PROG-016` (bốn workspace + tám journey) và `OD-PROG-017` (thư viện mẫu BMS) kèm option/trade-off/gate/bằng chứng mở khóa; tổng 17 mục OPEN |
| 0.6 | 2026-08-10 | Sửa mô tả hiện trạng: chỉ hai phần Modbus của `007/008` đã quyết định, còn 15 mục khác chưa ký; bổ sung đúng phạm vi ký Product tới `017`; không đổi trạng thái 17/17 `OPEN` |

| Vai trò | Trạng thái | Phạm vi ký |
|---|---|---|
| Product Owner/CTO | PENDING | `001..006`, `009..017` |
| Runtime/Controls/Safety | PENDING | `002/004/005/009/012/013` |
| Security/UX/I/O/Ops | PENDING | discipline decision tương ứng |
| Verification Lead | PENDING | acceptance và evidence plan của cả 17 mục |

## Phụ lục — Tự kiểm cổng M3 (loại: Open Decisions)

Cổng lấy theo [Plan 54 §7](../03_implementation/54_PROGRAMMING_DOCUMENTATION_ROADMAP.md).

| Cổng | Kết quả | Bằng chứng trong file / lý do |
|---|---|---|
| Context của từng quyết định | PASS | Bảng “Quyết định đang mở” cột “Vấn đề cần quyết định” + cột ảnh hưởng |
| Options và trade-off | PASS | Bảng “So sánh phương án và hậu quả nếu trì hoãn” có phương án đề xuất, phương án thay thế và hậu quả cho cả 17 mục |
| Decision authority | PASS | Cột “Owner đề xuất” + “Ma trận trách nhiệm ra quyết định” tách R/A/C |
| Deadline/gate | PASS | Bảng Decision package cột “Deadline/gate” gắn `DOC-G2/G3/G4`, không dùng ngày lịch giả định |
| Quyết định | **BLOCKED** | 17/17 `OPEN`. Owner: Product Owner/CTO và discipline authority theo bảng RACI. Ảnh hưởng: chặn `DOC-G2..G4` và toàn bộ baseline 22 hồ sơ. Gate: `DOC-G4`. Điều kiện mở: mỗi reviewer ghi `ACCEPT/REJECT/REQUEST CHANGE` kèm rationale và tạo decision record đủ trường |
| Rationale | N/A cho tới khi có quyết định | Không thể ghi rationale của một quyết định chưa được ra; schema bắt buộc đã định nghĩa ở “Nội dung bắt buộc của decision record” |
| Consequences | PASS | Cột “Hậu quả nếu chưa quyết định” cho 11 nhóm phủ đủ 17 mục |
| Tài liệu phụ thuộc phải đồng bộ | PASS | Bảng Decision package cột “Hồ sơ downstream”; điều kiện `DECIDED → CLOSED` yêu cầu owner downstream xác nhận |
| Bằng chứng mở khóa | PASS | Cột “Bằng chứng để mở khóa” cụ thể theo từng mục (ví dụ `OD-PROG-008` cần record HIL RS485 thật) |
| Link nội bộ sạch | PASS | harness: local link missing `0`, anchor missing `0` |

Một `BLOCKED` duy nhất còn lại là bản chất của loại tài liệu này: file đạt M3 khi
**gói quyết định đủ để ký**, không phải khi đã ký. Chuyển M4/M5 cần chữ ký thật.
