# Verification and Release Gates

**ID:** VVP-001
**Trạng thái:** Active — hardware gate RED; Programming Rev A production gate RED
**Cập nhật:** 2026-09-16 (ghi tầng `LOOPBACK` vào thang bằng chứng BACnet — `T-BAC-013`, thi hành `ADR-060`)

## Chiến lược

| Level | Mục tiêu | Bằng chứng tối thiểu |
|---|---|---|
| Static | contract/layout/config correctness | compiler warnings-as-errors, static assertions, lint |
| Unit | node, scaling, validation, priority | deterministic automated tests |
| Integration | SHM, services, REST, protocol | multi-process tests và fault cases |
| HIL | IOP timing, ADC/AO/DO, watchdog | target logs + measured limits |
| System | commissioning, control continuity, recovery | scenario record trên target |
| Release | package, security, hardware/manufacturing gates | signed checklist + artifact hashes |

Không dùng số test pass lịch sử làm evidence hiện hành. Mỗi release record phải ghi commit, toolchain, target, command, result và artifact/evidence location.

## Thang bằng chứng BACnet — `HOST` / `LOOPBACK` / `TARGET`

Thi hành `ADR-060` (Accepted 2026-09-10). Ba tầng dưới đây **không thay thế được
cho nhau**, và nhãn bằng chứng của mỗi tầng là cố định:

| Tầng | Chạy ở đâu | Bắt được gì | Nhãn được phép ghi |
|---|---|---|---|
| `HOST` | Bất kỳ máy nào, kể cả `MKDDC_ENABLE_BACNET=OFF` | Logic thuần trong lớp C++. **Không byte nào ra card mạng** | Không phải bằng chứng BACnet |
| `LOOPBACK` | Cùng máy, UDP thật trên `127.0.0.1`, cần `BACNET=ON` | Lỗi nằm giữa `bacnet_server.cpp` và datalink: thiếu `apdu_set_confirmed_handler`, sai mã hoá APDU, không đáp ứng | **`VERIFIED-LOOPBACK`** — **không** được ghi `VERIFIED` |
| `TARGET` | Board thật + thiết bị/BMS thật | Liên thông thật, định thời thật, hạ tầng mạng thật | `VERIFIED` |

**Vì sao `HOST` không tính.** Với `BACNET=OFF`, bacnet-stack không được biên dịch
vào binary, nên mọi lời gọi API của nó nằm ngoài `#ifdef`. Bộ `HOST` vẫn xanh
toàn bộ. Số đo 2026-09-16 tại `main@550e420` cho thấy khoảng cách giữa hai cấu
hình đúng **một** test, trong khi có 82 test mang tên BACnet.

**Tầng `LOOPBACK` nằm ở đâu.**
[`apps/iobus/adapters/bacnet/tests/test_bacnet_loopback.cpp`](../../apps/iobus/adapters/bacnet/tests/test_bacnet_loopback.cpp).
Nó dựng `BacnetServer` thật, `bip_init` mở socket UDP thật trên `lo`, và một
socket client riêng gửi/nhận khung BACnet/IP thật. Mọi khẳng định đặt trên **gói
nhận được**, không trên trạng thái nội bộ. Cổng UDP xin lúc chạy, không ghim
47808, nên chạy song song được. Mỗi ca có timeout hữu hạn 3000 ms.

Chạy tầng này:

```
cmake --fresh -S . -B build/fw -DCMAKE_BUILD_TYPE=Release \
  -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON
cmake --build build/fw --parallel
ctest --test-dir build/fw -R BacnetLoopback --output-on-failure
```

Với `BACNET=OFF`, tầng này báo `SKIPPED` trong output `ctest` chứ **không** biến
mất khỏi danh sách — `ADR-060` điều (4) cấm để `BACNET=OFF` thành đường build duy
nhất được kiểm, và một tầng test tự tàng hình khi tắt cờ sẽ tái tạo đúng vấn đề
đó.

**Nợ đã ghi, chưa trả.** Ca `SubscribeCov…ExpectedFailureUntilTBac044` được đánh
dấu kỳ vọng-thất-bại bằng `EXPECT_NONFATAL_FAILURE`: PICS khai `DS-COV-B` nhưng
`bacnet_server.cpp` chưa đăng ký handler `SERVICE_CONFIRMED_SUBSCRIBE_COV`, nên
một BMS gửi SubscribeCOV hôm nay nhận về Reject. `T-BAC-044` sẽ gắn handler; khi
đó khẳng định bên trong hết thất bại và chính ca này chuyển đỏ, buộc người sửa
quay lại lật nó thành khẳng định thẳng.

## Gate architecture conformance của repository

Entrypoint chuẩn là `scripts/verify-project.sh`. Component `layout` kiểm manifest
path, authority duy nhất trong `contracts/`, dependency Core/Iobus/firmware,
CMake boundary target, React public feature API và việc cô lập artifact dưới
`build/`; hai test negative chứng minh contract trùng hoặc import sai chiều làm
gate đỏ. CI phải chạy gate này trước build/test sản phẩm.

Sau migration ngày 2026-08-03, full host matrix, Go race, FE unit/lint/build,
Playwright network, firmware ARM và release checksum đều PASS tại
[`HOST_RESTRUCTURE_GATES_20260803.json`](../07_records/evidence/restructure/HOST_RESTRUCTURE_GATES_20260803.json).
Đây không phải target evidence: installer, startup order, crash/restart và
rollback trên board vẫn `NOT_RUN`, nên Plan 46 và release gate không được đóng.

Bộ host matrix này cũng không phải Programming evidence. Số ctest trong đó có
chứa host unit test của ST/IR/cyclic component; theo ADR-023 chúng chỉ là
As-Built development evidence và không được dùng để đổi bất kỳ `VR-PROG-*` hoặc
`VR-MBRTU-001/004/011/012` sang `PASS`.

## Ma trận kiểm tra bắt buộc

- Core: 28 node types, graph validation, scan/priority/safe-state và malformed config.
- Iobus: IOP frame/CRC/timing/retry/fault, scaling, reliability, AO single conversion, SHM layout.
- Web: Go tests, frontend build/lint, auth/role, config round-trip, points/history/alarm/schedule.
- HMI build: compile/test khi enabled; DRM/input/GPIO smoke trên target.
- HMI authority: login/session expiry, policy query, setpoint/mode/override/release, effective source/priority/TTL, upstream ACK/reject/timeout, idempotency và audit.
- HMI failure: broker/core/alarm authority loss phải chuyển mutation read-only, monitoring SHM tiếp tục và không blind replay; HMI không write SHM/hardware, signal process hoặc direct reboot.
- HMI usability: five-surface scenario trên panel thật với Viewer/Operator/Admin session; Service là surface, không phải role. Kiểm body ≥14 px, action ≥40×40 px hoặc hard-key equivalent, glove/light, alarm flood, stale/lost data, localization và wake-event suppression.
- Protocol product-wide: BACnet/IP discovery/read/write/reliability và Modbus
  RTU/TCP mapping/error paths. Modbus TCP/BACnet/IP không phải Programming Point
  Rev A.
- System: stop/restart từng service, corrupt/stale SHM, loss of UART/network, MCU 200 ms safe timeout.
- Network commissioning: active ≠ desired, static/DHCP validation, duplicate IP, staged
  apply, confirm, 120 s auto/manual rollback, helper/host restart recovery, least
  privilege, Web reconnect, BACnet hot-rebind/`I-Am`, Modbus TCP retry và continuous
  core/IOP/STM32 trace.
- Programming Rev A: kiểm chứng đúng scope Local Physical I/O, Virtual Point,
  Modbus RTU Point, ST, FBD và cycle 1 s/5 s/30 s theo các `VR-PROG-*` bên dưới.
  Negative scope test phải từ chối Modbus TCP Point, BACnet/IP Point, LD, SFC,
  motion và safety PLC.

## Programming Rev A — Verification Requirement

| ID | Verification Requirement | Phương pháp và acceptance tối thiểu | Gate hiện tại |
|---|---|---|---|
| VR-PROG-001 | Xác nhận scope Product/Requirement. | Inspection Product Spec, requirement và UI/API capability: chỉ đúng ba Point category, ST/FBD và ba cycle time; không có claim implementation/certification. | RED — docs pass, production chưa có |
| VR-PROG-002 | Xác nhận Project/Program/Revision. | Tạo, sửa, đóng/mở Project; nhiều Program theo capacity đã duyệt; Revision bất biến, identity và actor truy nguyên được; round-trip không mất dữ liệu. | RED |
| VR-PROG-003 | Xác nhận Point/Variable/I/O Mapping. | Positive/negative integration trên production path cho Local Physical I/O, Virtual Point và Modbus RTU Point; reject sai type/direction/access/quality và mọi Point category ngoài scope. | RED |
| VR-PROG-004 | Xác nhận ST production. | Program ST phải đi end-to-end từ Revision tới runtime production target, dùng I/O Mapping được phê duyệt và cho output/monitor đúng golden scenario. Host parser/unit test chỉ là supporting evidence. | RED |
| VR-PROG-005 | Xác nhận FBD production. | Program FBD phải đi end-to-end trên cùng production target/semantic, gồm lỗi block/connection/type và golden scenario tương đương ST. | RED |
| VR-PROG-006 | Xác nhận cycle time. | Đo trên production target cho 1 s/5 s/30 s, ghi jitter/WCET/overrun/fault với tải và acceptance limit được phê duyệt; reject mọi cycle khác. | RED |
| VR-PROG-007 | Xác nhận Revision và Deployment. | Artifact/Revision identity nhất quán, validate-before-deploy, authority ACK/reject/timeout và UI không false-success; power/process fault không tạo Revision active mơ hồ. | RED |
| VR-PROG-008 | Xác nhận Activation và Rollback. | Activation chỉ tại cyclic boundary; reject/corrupt/timeout/power-loss giữ Revision cũ; Rollback về known-compatible Revision và báo authoritative result. | RED |
| VR-PROG-009 | Xác nhận RETAIN. | Target restart/power scenarios theo policy đã duyệt; đúng value/type/Revision compatibility, non-RETAIN không nhận dữ liệu cũ, corrupt state fail rõ. | RED |
| VR-PROG-010 | Xác nhận Online Monitor. | So sánh live runtime với UI/API cho Revision, Program, Variable, Point, timestamp và quality; stale/unavailable đúng; mất client không ảnh hưởng control; không có implicit write/force. | RED |
| VR-PROG-011 | Xác nhận RBAC/audit. | Positive/negative theo từng lifecycle action; audit actor/action/Revision/time/result; bypass/replay/idempotency/timeout test. | RED |
| VR-PROG-012 | Xác nhận local continuity và fault behavior. | Mất/restart FE, Web, authority phụ; runtime fault, Point bad quality và overrun; không uncontrolled output, blind replay hoặc false-success. | RED |
| VR-PROG-013 | Xác nhận loại trừ scope. | Negative test trên UI/API/import/runtime từ chối LD, SFC, Modbus TCP Point, BACnet/IP Point, motion và safety PLC; không label hỗ trợ. | RED |

## Programming production release gate — RED

Product Spec và chuỗi traceability đã được documented, nhưng không gate
production nào được đóng bởi nhiệm vụ tài liệu này. Không được release hoặc
claim Programming đã implement, cũng không được claim `IEC 61131-3 compliant`,
`conformant` hoặc `certified`.

Host unit test cho ST parser/semantic, CLI, typed artifact, I/O-map component,
cyclic component hoặc trace ring chỉ chứng minh component development ở host.
Chúng không chứng minh production service, target scheduling, Local Physical
I/O/Virtual Point/Modbus RTU Point end-to-end, FBD, RETAIN, Deployment,
Activation, Rollback hoặc Online Monitor. Vì vậy chúng không được dùng để đóng
`VR-PROG-004`, `VR-PROG-006`, `VR-PROG-008` hay bất kỳ runtime production gate
nào.

Mỗi evidence production phải ghi commit, target identity, production process/
service, Revision/artifact identity, command/scenario, raw log/measurement,
acceptance limit, result và reviewer. Trạng thái chi tiết được truy tại
[Programming Traceability Matrix](../07_records/PROGRAMMING_TRACEABILITY_MATRIX.md).

## Modbus RTU Point — Verification Requirement

Design source: [DDD-SW-MBRTU-POINT-001](../02_design/software/DDC24_MODBUS_RTU_POINT_DETAILED_DESIGN.md).
Design đang `In Review`; bảng này định nghĩa gate, không tuyên bố test đã pass.

| ID | Verification Requirement | Acceptance tối thiểu | Gate hiện tại |
|---|---|---|---|
| VR-MBRTU-001 | Scope/hardware topology | Inspection Product/HW/Platform chứng minh **01 path RS485 production** (Đ-01) và role master-only; không dùng adapter lab thay thế. Bổ sung: xác nhận cơ chế điều khiển hướng half-duplex (Đ-02). | RED — chờ schematic Hardware Lead (`OD-MBRTU-EXT-04`) |
| VR-MBRTU-002 | Bus/Device/Point config | Positive/negative cho serial consistency, slave uniqueness, CRUD, import/export, stable ID/tag namespace và capacity; round-trip không mất field. | PARTIAL — Đ-06 và Đ-07 ĐÃ thi hành: `KX_N_EXT = 256` (`contracts/shm/mkddc_shm.h`), import CSV + export CSV/JSON có endpoint và test host. Còn thiếu: evidence round-trip trên target |
| VR-MBRTU-003 | Register codec | Golden vectors mọi register/data type/byte-word order/scale/offset/min-max; reject overlap, overflow, NaN/infinity, odd 32-bit. | PARTIAL — host codec pass, target chưa có |
| VR-MBRTU-004 | Scheduler và isolation | 16 device/bus, admission/load/deadline, retry/offline probe; lỗi bus không chặn IOP/core. Phần hai-bus-đồng-thời hoãn theo Đ-01. | PARTIAL — EDF + offline probe + retry thật đã có và có test host (D-04/D-05); thiếu admission control, counter deadline/duration và toàn bộ evidence target |
| VR-MBRTU-005 | Quality/timestamp | Fake-clock + target fault chứng minh GOOD→STALE→OFFLINE, BAD/reason, recovery, producer timestamp/sample age; không false-GOOD. | PARTIAL — contract ĐÃ đủ: `kx_ext_quality_t` 5 mức + 10 mã `quality_reason` + `sample_utc_ms`/`sample_mono_ns`, producer `bus_worker`/`ext_cache` ghi và `bacnet_objtable` đọc. Còn thiếu: target fault evidence |
| VR-MBRTU-006 | Typed runtime/Point Catalog | Cross-language ABI/version/sequence/generation; uint32 không mất chính xác; stable point_id không swap sau reorder/reboot; REST/WS đúng source/revision. | RED |
| VR-MBRTU-007 | Atomic config apply | Crash/power fault ở từng bước stage/apply/ACK/commit; stale revision/idempotency; chỉ old hoặc new revision active, rollback last-known-good. | RED — restart hiện tại không phải applied ACK |
| VR-MBRTU-008 | Write path | Coil/Holding 16/32-bit, RBAC/type/range/quality/revision, exception/timeout/readback/idempotency/queue-full; zero false-success và zero blind replay. | RED |
| VR-MBRTU-009 | Diagnostics/health | Bus/device/point counter/reason/latency/sample age/config revision/boot ID khớp fault đã inject; missing telemetry là unknown. | PARTIAL — host có một phần counter per slave |
| VR-MBRTU-010 | RBAC/audit/API/FE | Viewer/Operator/Admin positive/negative; operation correlation; FE candidate/apply/result/reconnect; không localStorage authority hoặc arbitrary FC. | PARTIAL — CRUD RBAC host có, transaction v2 chưa có |
| VR-MBRTU-011 | Real RS485/HIL/recovery | Chạy `MBRTU-HIL-01..12` + `TC-MBRTU-H-16`: một cổng, mọi serial mode, bốn register type, write/readback, CRC/timeout/wiring fault, điều khiển hướng, crash, reboot/power-cycle và 24 h soak. | RED — thiết bị đã duyệt cấp (Đ-08) nhưng chưa về |
| VR-MBRTU-012 | Provenance/deployment | Commit sạch; artifact/config/ABI version/checksum/toolchain truy được trên target; coordinated install/rollback và mismatch fail rõ. | RED — binary mới chưa deploy |
| VR-MBRTU-013 | Commissioning và import/export | Test connection, test read, test write trả kết quả giao tiếp thật có audit và không tạo revision; import/export round-trip không mất field, một dòng lỗi làm cả file bị từ chối. | PARTIAL — endpoint ĐÃ có: `/modbus/devices/{id}/test-connection`, `/modbus/read-test`, `/modbus/write-test`, `/modbus/import`, `/modbus/export`. Còn thiếu: kết quả giao tiếp THẬT trên RS-485 (chờ `G-C`) |
| VR-MBRTU-014 | Ngân sách vận hành và mapping gate | Đo refresh cadence, write rate limit, CPU/RAM fieldbus trên target, bus utilization và ngưỡng cảnh báo quá tải; mapping không hợp lệ bị chặn tại điểm lưu. | RED — mọi số hiện là PROPOSED |

### Vòng đời lệnh ghi — chốt 2026-08-20 (`OD-MBRTU-005`)

Một lệnh ghi Modbus RTU kết thúc khi **TTL 30 s** hoặc **3 lần phát** — điều kiện
nào tới trước. Hết hạn hoặc hết lượt ⇒ bỏ lệnh, xoá trạng thái pending/dirty,
ghi diagnostic (`modbus.write_dropped_expired` / `modbus.write_dropped_attempts`)
và đếm vào `write_dropped`. Muốn ghi lại phải phát sinh command mới.

**Ranh giới phải đọc đúng:** TTL 30 s là **tuổi thọ của lệnh đang chờ/retry**,
KHÔNG phải "sau 30 s hoàn tác giá trị register". Slave đã ACK ⇒ lệnh hoàn tất và
giá trị nằm lại trên thiết bị. Cơ chế force/override tạm thời rồi tự trả về là
một thứ KHÁC, có lease/expiry riêng, và không thuộc đường ghi này.

Hai hằng số được khoá bằng test `WriteLifecycleConstantsMatchProductDecision`;
quy tắc "lệnh mới cùng giá trị vẫn phải xuống dây sau khi lệnh cũ bị bỏ" được
khoá bằng `DroppedWriteAllowsResendOfSameValue` (cả hai trong
`apps/iobus/adapters/modbus_rtu/tests/test_modbus_master_fake.cpp`).

`MODBUS_RTU_POINT_READY = YES` chỉ khi VR-MBRTU-001..014 đều PASS bằng evidence
hiện hành được review. CTest/Go/FE/simulator pass không được dùng để thay thế
VR-MBRTU-001, 004, 011 hoặc 012.

Test specification chi tiết (6 tầng, `TC-MBRTU-U/I/S/T/H/P-xx`) nằm tại
[VVP-MBRTU-001](MODBUS_RTU_VERIFICATION_PLAN.md). Tài liệu đó đang `In Review`,
định nghĩa gate và **không** tuyên bố test đã pass.

## Hardware release gate — RED

Các finding sau đang blocked; không được phát hành manufacturing/production claim trước khi đóng:

| Finding | Nội dung cần đóng |
|---|---|
| HW-DOC-001 | +5 V capacity |
| HW-DOC-002 | 3.3 V regulator thermal |
| HW-DOC-003 | surge coordination |
| HW-DOC-005 | +15 V converter qualification |
| HW-DOC-010 | DO terminal protection |
| HW-DOC-011 | inductive suppression |
| HW-DOC-012 | AO 4–20 mA compliance |
| HW-DOC-014 | EMC immunity evidence |
| HW-DOC-017 | manufacturing package |
| HW-DOC-024 | BOM completeness |
| HW-DOC-025 | alternate sources |
| HW-DOC-048 | HMI electrical/DT/power integration |
| HW-DOC-049 | STM32 firmware + CubeMX implementation and HIL |
| HW-DOC-050 | relay/driver worst-case compatibility |

## HMI release gate — RED

HMI implementation đã đóng các finding về authority/control/IA/privilege ở mức
source/unit và service deployment. Broker/helper process boundary, UID denial và
network recovery đã được chạy trên Orange Pi 5B (board lab di sản, đã ngưng sử dụng từ 2026-08-05); production acceptance vẫn thiếu panel,
touch/button, physical I/O và usability evidence:

| Finding | Host state | Evidence còn thiếu để đóng gate |
|---|---|---|
| HMI-AUTH-001 | Broker snapshot/ACK, Core result and durable audit implemented; local ACK cannot change state | Target reject/timeout/restart/history scenarios |
| HMI-RBAC-001 | Session token, Viewer/Operator/Admin RBAC, idle expiry, rate limit and audit tests pass; target sockets/UID denial pass | Target session expiry and operator recovery evidence |
| HMI-CTRL-001 | Policy, query, setpoint/mode/override/release, Core TTL/idempotency/winner and host dual-socket lifecycle implemented | Target priority/latency and systemd process scenarios |
| HMI-IA-001 | Five surfaces implemented; diagnostics consolidated into Service | 320×240 target focus/clipping/operator inspection |
| HMI-PRIV-001 | Static role/PIN, direct signals/reboot and `CAP_SYS_BOOT` removed; unit/package verified and HMI cannot access helper directly | Physical-panel runtime negative scenarios |
| HMI-DATA-001 | Packaged DB aligned UI16/AO4/DO4 | Capability-gate optional hardware test |
| HMI-TEL-001 | Unknown/unavailable presentation retained | Authoritative BACnet/Modbus/system telemetry integration |
| HMI-FUNC-001 | Unsupported backup/restore/restart/reboot actions hidden | Separate approved maintenance authority if product requires it |
| HMI-HW-001 | Host DRM/touch rotation tests pass | Schematic/DT/power/pin freeze and panel/touch/button/backlight target tests |
| HMI-UX-001 | Host typography/action geometry implemented | Five-surface glove/light/flood/stale/localization usability record; IEC/ISA references are guidance, not certification evidence |

## Network commissioning release gate — RED

ADR-017 helper, local-HMI broker/UI, Web transaction adapter/FE và BACnet rebind đã được
implement code-local; service/dummy-interface evidence trước đây trên Orange Pi 5B (board lab di sản) cần tái lập trên Foxlinx SOM-DDC-24. Protocol v1
khóa strict unknown-field handling, exact capability `dns|management-hostname`, optional DNS
transaction và management hostname read-only. GET transaction status dùng permission `read`;
POST mutation chỉ Admin. Code-local pass không đóng physical HIL; gate vẫn RED.

Record HMI–FW SOM ngày 2026-07-22 chỉ là lịch sử trên target cũ và phục hồi tại
commit `b69fdf1`; nó không đóng gate Foxlinx hiện hành. Bằng chứng target mới
phải được đăng ký trong [chỉ mục review](../07_records/reviews/README.md) hoặc
`07_records/test-evidence/` và đáp ứng ma trận dưới đây.

| Finding | Hiện trạng | Evidence cần để đóng |
|---|---|---|
| NET-AUTH-001 | Strict v1 contract/capability, target unauthorized UID và `wlan0` allowlist denial, unit path/socket mode code-local/target-dummy pass | Reboot/power-loss và security approval của required capabilities |
| NET-STATE-001 | Active/configured/pending, admin/carrier/reason, DNS và management hostname shape code-local; target dummy/multi-address preservation pass | Real `end1` carrier/gateway/DNS và approved management-origin evidence |
| NET-TXN-001 | Real NetworkManager static confirm, process restart, explicit và 120 s automatic rollback pass trên isolated target interface | Physical `end1` DHCP/DNS, disk/host/power fault evidence |
| NET-CONT-001 | IOBus/Core/Web PIDs unchanged; IOP `NORMAL`, SHM fault-free/`RELIABLE` through address changes | Physical STM32/output trace and Modbus TCP reconnect |
| NET-BAC-001 | Target logs show datalink-only rebind on new/rollback addresses without iobus restart | Packet capture proving broadcast refresh and `I-Am` on real BMS segment |
| NET-HMI-001 | Surface Service; mutation Admin-only, double-confirm impact warning, monotonic countdown và confirm/rollback state code-local; target broker/helper path pass | UC-HMI-016..019 trên connected panel, countdown/glove/key usability và physical commissioning |
| NET-WEB-001 | BE adapter/FE authoritative migration, GET-read/POST-settings RBAC, active/configured/pending/DNS UI và intercepted E2E code-local pass | Browser REST/WebSocket reconnect qua stable hostname sau đổi IP thật, target failure/rollback record |
| NET-MGMT-001 | Same-origin/reconnect và hostname provisioning tool/template code-local; authority management field read-only | Install-only package verify, target `--check/--apply`, unique mDNS resolution, IP handoff và hostname rollback evidence |

Evidence packages tối thiểu: `PWR-5V`, `PWR-3V3`, `PWR-SURGE`, `AO-COMP`, `EMC`, `MFG`. Mỗi package phải có owner, setup, acceptance limit, raw result, conclusion và reviewer approval.

## Release decision

Release chỉ `GO` khi requirement bắt buộc có trace, automated suites pass, target/HIL evidence hợp lệ, security/deployment checks hoàn tất và mọi gate P0/RED được đóng hoặc có waiver được phê duyệt. Network không được claim GREEN từ host/mock/dummy-interface evidence: physical Ethernet DHCP/static/DNS, reboot/power-loss/disk fault, stable-hostname IP handoff, BACnet packet capture, Modbus reconnect, physical control continuity và connected-panel HMI vẫn mở. Hiện tại hardware/manufacturing status là `NO-GO`; Programming Rev A production status là `NO-GO`.
