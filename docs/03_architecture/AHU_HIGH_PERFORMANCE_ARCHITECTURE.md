# Kiến trúc ứng dụng AHU hiệu suất cao MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `ARCH-AHUHP-001` |
| Phiên bản | 0.1 |
| Trạng thái | **M3 — REVIEW READY / PROPOSED** |
| Ngày | 2026-08-13 |
| Chủ quản | System Architect |
| Người review | Product, HVAC, Controls, FW-SOM, FW-MCU, FE/BE, Platform, Security, QA/HIL |
| Người phê duyệt | CTO + Product Owner + System Architect |
| Nguồn | `PROD-AHUHP-001`; `SRS-AHUHP-001`; `ADR-005/010/012/014/020/023/024/026..031`; proposed `ADR-032` |
| Phạm vi | Context, component, ownership, timing, failure, deployment, compatibility và repository mapping của ứng dụng/simulator AHU |

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| Kiến trúc chọn gì? | Tách ba vai trò: production control trong Core/Programming; IOP/điện trong fake MCU; vật lý AHU trong plant simulator. Bốn VAV đi qua Modbus RTU production adapter. |
| Có thêm core process production không? | Không. Plant/fake VAV chỉ là lab services feature-gated; khi chuyển I/O thật chúng biến mất khỏi topology. |
| Vì sao không nhét plant vào fake MCU? | Để IOP emulator không sở hữu nhiệt/khí động, fault domain rõ và có thể thay plant first-order bằng FMU sau mà không đổi IOP. |
| Control chạy nhanh bao nhiêu? | Program Task 1 s đúng profile Rev A; Core/MCU safety giữ cadence hiện hành; plant model bước 100 ms; Web không nằm trong loop. |
| Gap lớn nhất? | `OD-AHUHP-001..013` chưa quyết định; machine-readable simulation contracts chưa tồn tại; EXT output cần watchdog/failsafe thiết bị. |
| Gate? | M3 candidate; `PLAN_READY`, `IMPLEMENT_READY`, `RELEASE_READY` đều BLOCKED. |

## 1. Context và constraint

MK-DDC-24 giữ ba process điều khiển chính:

- `mkddc-core`: Programming execution, process image, priority, interlock,
  safe-state và PLC SHM.
- `mkddc-iobus`: IOP master, electrical scaling, I/O SHM, Modbus RTU master và
  reliability.
- `mkddc-web`: auth/API/config/history/UI; không là control authority.

STM32 hoặc `fake_mcu` sở hữu sampling/actuation/IOP/watchdog ở biên MCU.
`ahu_plant_sim` và `fake_vav` chỉ tồn tại trong lab deployment. HMI tùy chọn
không tham gia control loop.

Các constraint không được phá:

1. IOP v2 `921600 baud`, poll 2 ms và board capability Rev A giữ nguyên.
2. SHM ABI/magic không đổi trong candidate simulator.
3. AO command tại Core/Iobus là đại lượng điện V/mA; chỉ Iobus đổi sang DAC raw.
4. Programming profile `revA-1t-1-5-30` chỉ một Task, một Program, chu kỳ
   1000/5000/30000 ms; AHU chọn 1000 ms.
5. Local output đi qua `PRIO_LOCAL_LOGIC`; safety/override có thể thắng.
6. Modbus Point phải có quality/timestamp/writable và write/readback; không blind
   replay.

## 2. As-Built và gap

| Lớp | As-Built 2026-08-13 | Gap target |
|---|---|---|
| IOP emulator | [`tools/fake_mcu/fake_mcu.cpp`](../../tools/fake_mcu/fake_mcu.cpp) xử lý handshake/get/set/diag/reset, raw UI waveform và fault injection | UI waveform không phụ thuộc AO/DO; chưa có plant coupling/profile AHU |
| No-board topology | [`21_VIRTUAL_COM_DECISION.md`](../03_implementation/21_VIRTUAL_COM_DECISION.md) khóa PTY → Iobus → SHM → Core → Web | Chưa có orchestrator AHU và fake VAV service |
| Physical capacity | [`mkddc_shm.h`](../../contracts/shm/mkddc_shm.h) có 16 UI/4 AO/4 DO/256 EXT | Bài toán có 8 actuator analog logical; cần 4 EXT VAV |
| Programming profile | [`rev_a_profile_v1.json`](../../contracts/programming/rev_a_profile_v1.json) có 1 Task/1 Program, PID và 1/5/30 s | Chưa có AHU source/artifact/binding/fixture |
| Process image | [`st_process_image.hpp`](../../apps/core/application/st/st_process_image.hpp) chụp input atomic, local output qua resolver, EXT qua PointWriter | EXT không có local priority release/TTL; cần VAV watchdog/failsafe |
| Modbus master | `apps/iobus/adapters/modbus_rtu/` có config, worker, cache, quality, write path và test fake | Chưa có standalone multi-slave VAV simulator/profile |
| Web | `apps/web-api`, `apps/web-ui` có auth, point, trend, Programming và Modbus surfaces | Chưa có AHU runtime route, simulation API/lab UI |
| Verification | Có unit/integration IOP/ST/Modbus supporting evidence | Chưa có 24 scenario AHUHP, target/HIL hay Test Result |

Sự tồn tại của các source trên chỉ chứng minh nền As-Built, không chứng minh ứng
dụng AHU đã implement.

## 3. Target context

```text
Operator/Engineer
       │ HTTPS/WebSocket
       ▼
mkddc-web ───── config/audit/history ────────────────┐
       │ core.sock / API                              │ lab-control UDS
       ▼                                              ▼
mkddc-core ─ process image/priority/safety       ahu_plant_sim
       │ /dev/shm                                  ▲        ▲
       ▼                                           │        │
mkddc-iobus ─ IOP/PTY ─ fake_mcu ─ plant UDS ─────┘         │
       │                                                    │
       └─ Modbus RTU/PTY ─ fake_vav[FA,RA,SA,EA] ───────────┘
```

Production/HIL cutover thay `fake_mcu`, `fake_vav`, `ahu_plant_sim` bằng MCU,
VFD/actuator/sensor thật; Core/Iobus/Web và control artifact giữ nguyên phiên bản
đã nghiệm thu.

## 4. Component và ownership

| Component | Mutable state/policy sở hữu | Input | Output/consumer | Process/failure boundary |
|---|---|---|---|---|
| `AHU_HIGH_PERFORMANCE` Program | Mode, PID state, setpoint reset, sequence, RETAIN counters | Atomic Point snapshot | AO/DO/VP/MB_RTU proposal | Trong `mkddc-core`; fault hủy output batch của cycle |
| SafetyManager/PriorityResolver | Safe-state/interlock/priority winner | Program/manual/BACnet/safety proposals | Resolved local AO/DO | Core authority; Program không bypass |
| `mkddc-iobus` | IOP session, electrical conversion, Modbus session/quality | Resolved local + EXT dirty setpoint | MCU raw/Modbus write; SHM snapshot | Process I/O; reconnect độc lập |
| `fake_mcu` AHU mode | IOP slave/electrical state, applied raw, MCU faults | IOP command + plant sensor snapshot | IO_RESP/diag + actuator electrical snapshot | Lab service; không sở hữu physics/control policy |
| `fake_vav` | Register state, command watchdog, Modbus exception/fault | Modbus request + plant feedback | Registers + actuator command | Lab service; mỗi slave fault cô lập |
| `ahu_plant_sim` | Air/thermal/zone physical state, scenario clock/event | Electrical/VAV applied commands | Sensor/feedback/energy snapshot | Lab service; single writer của physics |
| Simulation API | Scenario lifecycle và audit request | Authenticated Admin/operator request | Command tới plant; read-back | Web adapter; không ghi physical output |
| AHU UI | Presentation/local draft only | API/WS | User intent | Browser; mất UI không dừng control |

## 5. Deployment topology

### 5.1 Host developer

- `mkddc-fakemcu --pty --link /tmp/mkddc-iop-a --profile ahu-local-v1.json`
- `mkddc-fake-vav --pty --link /tmp/mkddc-vav-a --topology ...`
- `mkddc-ahu-plant --socket /run/user/$UID/mkddc-sim/ahu-plant.sock`
- Core/Iobus/Web chạy từ build tree với config dưới temp directory.

### 5.2 Foxlinx lab

- Package dưới `/usr/sbin`; config immutable candidate dưới
  `/data/config/simulation/ahu/`.
- Runtime socket `/run/mkddc-sim/`, owner `mkddc:mkddc`, mode `0750`; socket
  `0660`.
- `mkddc-ahu-plant.service`, `mkddc-fakemcu.service` và
  `mkddc-fake-vav.service` chỉ được enable khi
  `MKDDC_AHU_SIMULATION_LAB=1`; conflict với deployment MCU/RS485 thật.
- Không mở network listener mới cho plant/fake services.

### 5.3 Production/HIL

- Lab flag OFF và simulation services disabled/masked.
- Iobus mở UART MCU/RS485 thật; binding profile HIL đã ký.
- Không sao chép scenario/fault API vào site runtime package nếu release profile
  không cho phép.

## 6. Point topology candidate

| Nhóm | Point | Ý nghĩa | Owner producer | Consumer |
|---|---|---|---|---|
| Local UI | UI-01..06 | OA T/RH, RA T/RH, MA T, SA T | MCU/fake MCU | Program/UI/history |
| Local UI | UI-07..12 | SA static, building pressure, CHW/HW supply/return T | MCU/fake MCU | Program/FDD/UI |
| Local UI | UI-13..16 | supply/return fan proof, freeze-stat, filter DP | MCU/fake MCU | Safety/Program/FDD |
| Local AO | AO-01..04 | supply fan, return/exhaust fan, cooling valve, heating valve electrical command | Core resolver | Iobus→MCU/fake MCU |
| Local DO | DO-01..04 | fan enables và hai pump/interlock request | Core resolver | Iobus→MCU/fake MCU |
| EXT | `VAV-{FA,RA,SA,EA}-CMD` | writable damper/flow command | Program→PointWriter | Iobus→VAV |
| EXT | feedback/flow/status/fault | read-only VAV telemetry | VAV/fake VAV | Iobus→Core/UI |
| VP/EXT | occupancy, CO2, setpoint, mode request | supervisory inputs | Schedule/operator/sensor | Program |

Final tag/unit/range nằm trong Interface Spec; thay mapping phải bump topology
revision và chạy binding validation lại.

## 7. Runtime sequence và atomicity

```text
base step 1 s
  1. Safety/Core cập nhật priority và chụp coherent Point snapshot.
  2. Safe-boundary activation nếu có candidate hợp lệ.
  3. Nạp toàn bộ VAR_INPUT; một input required không GOOD => reject cả batch.
  4. Chạy đúng một Program AHU theo section order đã khóa.
  5. Preflight toàn bộ local/VP/EXT output.
  6. Một output lỗi => không publish output nào của cycle.
  7. Commit local qua PriorityResolver và EXT qua PointWriter.
  8. Iobus áp local electrical output và Modbus write/readback.
  9. Plant nhận applied state, chạy 10 step x 100 ms, phát snapshot generation mới.
```

Plant và IOP không khóa cùng mutex xuyên process. Mỗi message có `generation`,
`seq`, `simTimeNs`; consumer bỏ duplicate/out-of-order và không trộn generation.

## 8. Timing và resource budget candidate

| Lane | Cadence/deadline | Clock | Budget/gate |
|---|---|---|---|
| IOP GET_IO | 2 ms; timeout theo contract | MCU/Iobus monotonic | Không đổi; fake-MCU regression |
| Core base step/Program | 1 s | `CLOCK_MONOTONIC` | Program p99.9 WCET target phải được P3 benchmark/CTO khóa |
| Plant integration | 100 ms fixed step | deterministic simulation clock | Không bỏ >1 step real-time; <=60x accelerated |
| VAV Modbus | profile 200–1000 ms | Iobus monotonic | Bus admission <=70% candidate; offline probe không bỏ đói slave sống |
| WS/UI | snapshot 1 s; KPI 5 s | server timestamp | Backpressure bounded; UI không nằm control loop |
| FDD slow checks | counter trong Program 5/30 cycle | Program cycle count | Không tạo Task thứ hai |

Resource hard limit target: một AHU, bốn VAV, tối đa 256 points, scenario tối đa
10.000 event, message UDS 16 KiB, trace ring 100.000 sample trước khi rotate.

## 9. Failure containment

| Failure | Detection | State/output | Recovery |
|---|---|---|---|
| Web/browser chết | socket/session loss | Control không đổi | Reconnect/read current authoritative state |
| Program input BAD/cycle fault | process image/scheduler | Hủy cycle; local hold rồi TTL theo `OD-AHUHP-013`; EXT dựa VAV watchdog | N mẫu GOOD + clear policy; không replay mù |
| Plant link mất | fake MCU/fake VAV heartbeat | ADC BAD/LOCK, VAV offline; plant state không bịa | Handshake generation mới; operator start/resume |
| Fake MCU mất | Iobus timeout/reconnect | Core quality BAD; MCU safe policy | Handshake/reconfigure; output resend có kiểm soát |
| Một fake VAV chết | Modbus timeout/offline | Chỉ point/slave đó OFFLINE; coordinator fallback/fault | Offline probe + fresh readback trước write |
| Config/schema lỗi | validator | Reject zero-mutation, giữ LKG | Sửa candidate và apply revision mới |
| Plant NaN/Inf/divergence | solver invariant | `FAULTED`, không publish snapshot GOOD | Reset từ LKG; lưu trace incident |
| Partial deployment/version mismatch | handshake/schema major | Fail fast, service unhealthy | Rollback package đồng bộ |

## 10. Security/trust boundary

- Browser chỉ nói chuyện Web API; plant/fake services không mở TCP/HTTP.
- UDS kiểm `SO_PEERCRED`, allowlist UID/GID và length/schema/rate trước parse.
- Simulation mutation Admin-only; runtime point override theo RBAC hiện hành.
- File scenario/topology chỉ regular file dưới root cố định; cấm symlink/path
  traversal; JSON depth/size/count bounded; NaN/Inf reject.
- Lab flag OFF làm routes trả `404/feature_disabled` và services không start.
- Audit chứa actor/action/revision/hash/result; không chứa cookie/token/header.

## 11. Compatibility, deployment và rollback

- IOP/SHM/Programming artifact ABI giữ nguyên trong Plan 55.
- Simulation config/protocol v1 dùng `major.minor`; unknown major fail fast,
  unknown optional field minor được bỏ qua có log.
- Deploy order: contracts/profile → plant/fake services disabled → Core/Iobus/Web
  compatible → enable lab flag → preflight → start plant → fake VAV → fake MCU →
  Iobus → Core → Web.
- Rollback ngược thứ tự; stop Simulation Lab mutation trước; giữ config,
  scenario, trace và audit, không xóa user data.
- Trigger rollback: contract join fail, repeated service restart, output readback
  mismatch, plant divergence, CPU/RSS vượt budget hoặc regression safety.

## 12. Ánh xạ repository target

| Target | Vai trò |
|---|---|
| `tools/ahu_plant_sim/` | Plant engine, scenario clock, UDS server, trace |
| `tools/fake_vav/` | Four-slave Modbus RTU emulator + plant adapter |
| `tools/fake_mcu/` | AHU profile/plant adapter, giữ legacy mode |
| `contracts/simulation/` | topology/scenario/message schema và VAV register profile |
| `apps/core/application/st/samples/ahu_high_performance.st` | Một Program/Task 1 s |
| `contracts/programming/ahu_high_performance/` | Source/artifact/manifest/io map candidate |
| `apps/web-api/internal/simulation/` | Lab API, RBAC, audit, trace adapter |
| `apps/web-ui/src/features/ahu/` | Runtime dashboard và Simulation Lab |
| `platform/systemd/` và `platform/packaging/` | Lab-only services/config/package |
| `docs/07_records/test-results/ahu-high-performance/` | Test Result template và immutable evidence index |

Dependency bị cấm: Web→serial/SHM write trực tiếp; fake MCU→Core policy; plant→
physical output; simulator-only library link vào production Core/Iobus binary;
network listener trong fake services.

## 13. Verification kiến trúc

| Scenario | Kỳ vọng | Evidence lane |
|---|---|---|
| Kill Web | Program/control tiếp tục; chỉ UI unavailable | Host + Foxlinx |
| Kill plant | Input BAD/OFFLINE trong bound; no fabricated GOOD | Host + Foxlinx fake |
| Version mismatch | Join fail fast, không partial state | Contract integration |
| Program fault | Atomic reject; local/EXT safe timeout theo policy | Host + HIL |
| Cutover binding | Artifact hash giữ nguyên | Target/HIL |
| Lab flag OFF | Không service/route/mutation simulator | Foxlinx security |

Chi tiết định lượng tại `VVP-AHUHP-001`.

## 14. Blocker, risk và sign-off

| Blocker | Owner | Ảnh hưởng | Gate | Điều kiện mở khóa |
|---|---|---|---|---|
| `OD-AHUHP-001..013` OPEN | Authority theo Decision Register | Kiến trúc chưa là baseline | `PLAN_READY` | Authority record ghim revision/hash |
| Simulation contract chưa machine-readable | Contract Lead | Chưa cho producer/consumer code | `IMPLEMENT_READY[P1]` | Schema/register map sinh test và review xong |
| VAV physical watchdog/failsafe chưa chọn | Safety/HVAC/HW | Không đóng safe output/HIL | `RELEASE_READY` | Chọn thiết bị/profile và HIL timeout/readback |

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1 | 2026-08-13 | Tạo kiến trúc candidate ba lớp và deployment lab/HIL |

| Vai trò | Trạng thái | Điều kiện ký |
|---|---|---|
| System Architect | Chưa ký | Ownership/interface/failure/deploy được chấp thuận |
| Controls/HVAC Lead | Chưa ký | Sequence/timing/topology phù hợp |
| Security Lead | Chưa ký | Lab boundary và UDS policy đạt |
| CTO/Product | Chưa ký | Chấp thuận scope và mở gate |
