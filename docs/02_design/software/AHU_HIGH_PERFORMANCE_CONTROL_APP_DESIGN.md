# Ứng dụng điều khiển AHU hiệu suất cao — Detailed Design MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `DDD-SW-AHUHP-CTRL-001` |
| Phiên bản | 0.1 |
| Trạng thái | **M3 — REVIEW READY / PROPOSED** |
| Ngày | 2026-08-13 |
| Chủ quản | Controls Lead + FW-SOM Lead |
| Người review | HVAC Lead, System Architect, Safety, Programming Runtime, QA/HIL |
| Người phê duyệt | CTO + Product Owner + System Architect |
| Nguồn | `PROD-AHUHP-001`; `SRS-AHUHP-001`; `ARCH-AHUHP-001`; `OD-AHUHP-004/005/009/013` |
| Requirement | `SWR-REQ-AHUHP-CTRL-001..010`; `SYS-REQ-AHUHP-003/005`; `NFR-REQ-AHUHP-001`; `SAFE-REQ-AHUHP-001..006` |
| Phạm vi | Một Program ST/FBD, một Task 1000 ms; sequence, point binding, state, algorithm, fault và test; không thiết kế plant physics/UI |

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này triển khai gì? | Một Program `AHU_HIGH_PERFORMANCE` chạy Task 1 s, điều khiển hai fan, hai coil và bốn VAV phối hợp. |
| 2. Ai phải đọc? | Controls/HVAC, Programming Runtime, Core, QA/HIL và reviewer Safety. |
| 3. As-Built có gì? | ST parser/runtime có PID, timer, RETAIN, process image atomic, Local/VP/MB_RTU binding; chỉ có mẫu AHU một fan, chưa có full app/evidence. |
| 4. Thiết kế mới? | Một Program có section order cố định, state machine, reset loops, mass-balance coordinator, split-range coil và FDD. |
| 5. Sửa module nào? | Tạo source/artifact/io map/fixture AHU; chỉ sửa runtime nếu test chứng minh thiếu primitive, không mở rộng profile tùy tiện. |
| 6. Còn blocker? | `OD-AHUHP-004/005/009/013`, exact VAV device profile và HIL safe action chưa ký. |
| 7. Bằng chứng hoàn tất? | `TC-AHUHP-C01..C12`, target WCET, fault/override/HIL; hiện chưa có Test Result. |

## 1. Mục tiêu, actor và phạm vi — `DD-02`

### 1.1 Outcome

- Điều khiển vòng kín đạt band SAT/airflow/pressure đã phê duyệt.
- Mọi actuator có một owner logical; output đi qua production arbitration.
- Mất quality/fault không sinh partial output hoặc dữ liệu giả.
- Cùng source/artifact dùng cho simulator và HIL; chỉ binding đổi.

### 1.2 Trong phạm vi

- Một Task `AHUHP_TASK_1S`, một Program `AHU_HIGH_PERFORMANCE`, period 1000 ms,
  budget candidate 200 ms chờ target benchmark.
- State/mode, fan sequence, ventilation/economizer, airflow coordination,
  pressure reset, SAT/coils, FDD và RETAIN counters.
- Local/VP/MB_RTU bindings theo §4.

### 1.3 Ngoài phạm vi

- Safety PLC/life-safety certification, plant water loop control, physics model,
  Web/API và actuator sizing.
- Tạo Task 100 ms hoặc nhiều Program; profile Rev A không cho phép.

## 2. As-Built và khoảng trống — `DD-03`

| Nội dung | As-Built 2026-08-13 | Gap |
|---|---|---|
| Profile | [`rev_a_profile_v1.json`](../../../contracts/programming/rev_a_profile_v1.json): 1 Task, 1 Program, 1/5/30 s, PID/PI/timer | Chưa có AHU application profile/bundle |
| PID | `apps/core/application/st/st_exec.cpp` có PID ACTUAL/back-calculation; test unit/integration hiện hữu | Chưa tune/verify với AHU plant/HIL |
| I/O map | `st_io_map.*` validate Local/VP/MB_RTU, type/range/writable | Chưa có canonical 51+ binding AHU |
| Process image | `st_process_image.*`: required input atomic, output preflight/batch, local resolver, EXT PointWriter | EXT không có contribution TTL/release như local |
| Sample | [`ahu_fan_control.st`](../../../apps/core/application/st/samples/ahu_fan_control.st) điều khiển một fan từ SAT | Không có fan proof, VAV, coil, state, FDD |
| Runtime evidence | Programming host evidence có nhưng đang thay đổi trong worktree | Không dùng làm AHU target/HIL evidence |

## 3. Thiết kế mục tiêu và quyền sở hữu — `DD-04`

### 3.1 Một Program, section order

```text
AHU_HIGH_PERFORMANCE (một cycle 1 s)
  S00 NormalizeSetpointsAndGuards
  S10 ModeAndSafetyState
  S20 FanStartStopProof
  S30 VentilationEconomizer
  S40 AirflowMassBalanceCoordinator
  S50 StaticAndBuildingPressureControl
  S60 SupplyAirTemperatureAndCoils
  S70 FaultDetectionDiagnostics
  S80 OutputClampRateLimitAndPublish
```

Thứ tự là contract: section sau đọc proposed state của section trước trong cùng
Program; không đọc lại PointTable giữa cycle. Output chỉ publish sau khi toàn
Program chạy và process-image preflight đạt.

### 3.2 Ownership

| State/policy | Owner | Không được sở hữu bởi |
|---|---|---|
| AHU operating mode, PID state, reset integrator | Program | Web/plant/fake MCU |
| Fire/freeze/safe priority | SafetyManager/MCU/hardwired interlock | Program optimization |
| Local output winner | PriorityResolver | Program trực tiếp |
| EXT setpoint/write quality | PointWriter/Iobus + device watchdog | Web/fake VAV bypass |
| Operator command/audit | Web/Core authoritative operation | Browser local state |

## 4. Mô hình dữ liệu từng field — `DD-05`

### 4.1 Local input binding

| Variable/Point | Type | Unit | Required | Range | Unknown semantics | Validation/lifecycle |
|---|---|---|---|---|---|---|
| `OaTemp/UI-01` | REAL | °C | Y | -40..70 | quality !=GOOD hủy input batch | Sample producer timestamp |
| `OaRh/UI-02` | REAL | %RH | Y | 0..100 | như trên | clamp bị cấm; out-of-range BAD |
| `RaTemp/UI-03` | REAL | °C | Y | -10..60 | như trên |  |
| `RaRh/UI-04` | REAL | %RH | Y | 0..100 | như trên |  |
| `MaTemp/UI-05` | REAL | °C | Y | -20..70 | như trên |  |
| `SaTemp/UI-06` | REAL | °C | Y | -20..70 | như trên | safety-relevant |
| `SaStatic/UI-07` | REAL | Pa | Y | -100..2500 | như trên |  |
| `BuildingPressure/UI-08` | REAL | Pa | Y | -100..100 | như trên |  |
| `ChwSupply/UI-09` | REAL | °C | Y | -5..30 | như trên | FDD/coil model |
| `ChwReturn/UI-10` | REAL | °C | Y | -5..40 | như trên |  |
| `HwSupply/UI-11` | REAL | °C | Y | 0..120 | như trên |  |
| `HwReturn/UI-12` | REAL | °C | Y | 0..120 | như trên |  |
| `SupplyFanProof/UI-13` | BOOL | — | Y | false/true | BAD hủy batch | electrical dry-contact profile |
| `ReturnFanProof/UI-14` | BOOL | — | Y | false/true | BAD hủy batch |  |
| `FreezeStat/UI-15` | BOOL | — | Y | false/true | BAD coi fault tại Safety boundary | Program input không thay hardwired interlock |
| `FilterDp/UI-16` | REAL | Pa | Y | 0..3000 | BAD hủy batch | alarm delay |

### 4.2 Local output binding

| Variable/Point | Type/unit | Range/default | Owner/side effect | Safe/release |
|---|---|---|---|---|
| `SupplyFanCmdV/AO-01` | REAL/V | 0..10; 0 | PriorityResolver→Iobus | withdraw sau TTL candidate; resolver default/safety quyết định |
| `ReturnFanCmdV/AO-02` | REAL/V | 0..10; 0 | như trên | như trên |
| `CoolingValveCmdV/AO-03` | REAL/V | 0..10; 0 | như trên | đóng/safe theo coil policy |
| `HeatingValveCmdV/AO-04` | REAL/V | 0..10; 0 | như trên | freeze override có thể mở |
| `SupplyFanEnable/DO-01` | BOOL | false | PriorityResolver→Iobus | de-energized khi safe |
| `ReturnFanEnable/DO-02` | BOOL | false | như trên | de-energized khi safe |
| `ChwRequest/DO-03` | BOOL | false | interlock/request | không thay plant authority |
| `HwRequest/DO-04` | BOOL | false | interlock/request | freeze policy riêng |

### 4.3 Modbus/VP field

| Field | Type/unit | Required/default/range | Identity/validation | Lifecycle |
|---|---|---|---|---|
| `Vav{Fa,Ra,Sa,Ea}Cmd` | REAL/% | Y; 0; 0..100 | category MB_RTU, deviceId `vav-*`, writable | output; readback required |
| `Vav*Feedback` | REAL/% | Y; no default; 0..100 | read-only EXT | GOOD timestamp required |
| `Vav*Flow` | REAL/m³/h | Y; no default; 0..design×1.2 | read-only EXT | coordinator input |
| `Vav*Fault` | UINT/bitset | Y; 0 | read-only EXT | FDD input |
| `Occupied/BV-01` | BOOL | Y; false | VP owner schedule/operator | retained source not in Program |
| `SaTempSp/AV-01` | REAL/°C | Y; 13; 8..35 | VP revision/audit | input snapshot |
| `VentMinSp/AV-02` | REAL/m³/h | Y; profile | VP | input snapshot |
| `BuildingPressureSp/AV-03` | REAL/Pa | Y; 10; -20..30 | VP | input snapshot |
| `Co2/EXT-or-UI-profile` | REAL/ppm | optional topology; fallback explicit | 0..5000 | DCV enable only when GOOD |

Technical tag cuối cùng và Modbus address thuộc `DDD-IF-AHUHP-SIM-001`.

### 4.4 RETAIN/local state

| Field | Type | Default/range | Retention | Reset/migration |
|---|---|---|---|---|
| `ModeState` | UINT enum | OFF | RETAIN only if approved; candidate non-retain for safety | unknown enum reject artifact |
| `StartCount*` | DINT | 0..INT32_MAX | RETAIN | saturate + alarm, không wrap |
| `RunSeconds*` | DINT | 0..INT32_MAX | RETAIN, checkpoint policy runtime | saturate |
| PID state ×4 | FB state | initialized bumpless | runtime/RETAIN theo profile | source/type rename mất state có audit |
| Trim/respond counters | INT | bounded | local | reset on mode/fault |
| Fault timers/latches | TON/BOOL | false | critical latch policy | clear guard/ACK |

## 5. Interface và contract — `DD-06`

- Artifact/profile: `revA-1t-1-5-30`, integrity `HASH_ONLY`, one Program, period
  1000 ms; source/artifact/manifest/profile hash phải cùng candidate.
- I/O map: mỗi VAR_INPUT/VAR_OUTPUT đúng một binding; direction/type/unit/range/
  category/deviceId/writable khớp Point Catalog; validation trả toàn bộ lỗi.
- Local AO/DO: chỉ qua `PriorityResolver` mức `PRIO_LOCAL_LOGIC`.
- VP/MB_RTU: chỉ qua `PointWriter`; EXT cần SHM, index hợp lệ, writable và
  generation; write failure hủy whole task batch.
- Program không gọi API/Web/UDS/serial; mọi external I/O qua process image.
- Stable public error dùng Programming error catalog; AHU/FDD diagnostic code
  nằm trong output/alarm domain, không thay loader code.

## 6. State, thuật toán và timing — `DD-07`

### 6.1 State machine

| State | Entry guard | Action | Exit/transition |
|---|---|---|---|
| `OFF` | disable hoặc unoccupied không optimum start | fan/coil requests off; damper safe/min theo policy | occupied→STARTUP; fire/freeze→priority state |
| `STARTUP` | permissive GOOD, no critical fault | open required dampers, start fan sequence | proof+delay→OCCUPIED; timeout→FAULT |
| `OCCUPIED` | fan proof, inputs GOOD | ventilation + pressure + SAT loops | economizer/heat/cool/dehumidify submode |
| `UNOCCUPIED` | schedule false | off hoặc night purge/optimum start policy | schedule/load guard |
| `ECONOMIZER` | OA condition eligible + sensor GOOD | maximize free cooling within ventilation/pressure constraints | limit/hysteresis fail→COOLING/OCCUPIED |
| `HEATING` | SAT demand below deadband | heating valve; cooling closed | deadband/hysteresis |
| `COOLING` | SAT demand above deadband | cooling valve; heating closed | economizer/deadband |
| `DEHUMIDIFY` | humidity guard + hot coil available | cooling + explicit reheat coordination | RH/dewpoint hysteresis |
| `SHUTDOWN` | stop request | ordered coil close, fan off after delays | proof off→OFF; timeout→FAULT |
| `FAULT` | task/equipment fault | alarm; output policy/TTL; no auto resume critical | N GOOD + ACK/clear→STARTUP/OFF |
| `FROST/FIRE` | authoritative interlock | Program proposal bị safety thắng | clear only by safety policy |

### 6.2 Pseudocode một cycle

```text
assert all required inputs already captured GOOD and same generation
normalize operator/profile setpoints; reject impossible configuration
evaluate fire/freeze/fault guards and mode transition
evaluate fan enable/proof timers
compute ventilation minimum and economizer limit
compute FA/RA/SA/EA feasible command set under mass-balance constraints
update static-pressure and building-pressure reset/PID using ACTUAL applied
update SAT split-range PID using ACTUAL valves and explicit dehumidify guard
update bounded FDD timers/latches and counters
rate-limit and clamp every proposed output
publish nothing here; process image preflights and commits atomically afterward
```

### 6.3 Airflow coordinator

Candidate constraint:

```text
saTarget = clamp(zoneDemand, saMin, saMax)
faTarget = clamp(max(ventMin, dcvDemand, economizerDemand), faMin, faMax)
raTarget = clamp(saTarget - faTarget, raMin, raMax)
eaTarget = clamp(faTarget + buildingPressureCorrection, eaMin, eaMax)
residual = saMeasured - faMeasured - raMeasured
```

Nếu constraint vô nghiệm hoặc quality required không GOOD, cycle fail/FAULT;
không âm thầm normalize bốn command độc lập.

### 6.4 Trim-and-respond candidate

- Mỗi 30 cycle, nếu không có VAV pressure request: giảm static SP một trim nhỏ.
- Nếu có request vượt threshold: tăng theo số request đã giới hạn.
- Setpoint kẹp `[spMin, spMax]`, reset integrator khi mode/fan off.
- Exact trim/respond/ignored-request là parameter chờ HVAC Lead ký; profile
  invalid bị reject trước activation.

### 6.5 Coil split range

- `satError = SaTempSp - SaTemp`.
- Trong deadband: hai valve về 0 theo rate limit.
- Error âm ngoài deadband: cooling PID, heating=0.
- Error dương ngoài deadband: heating PID, cooling=0.
- `DEHUMIDIFY` là nhánh duy nhất cho simultaneous cooling/reheat, cần humidity
  guard, minimum run/off và maximum reheat.
- PID `ACTUAL` lấy readback/resolved output, không lấy proposal chưa thắng.

### 6.6 Timing/resource

| Thuộc tính | Candidate |
|---|---|
| Period | 1000 ms |
| Budget | 200 ms cho validator; release budget khóa bằng p99.9 Foxlinx |
| Allocation | 0 heap allocation trong steady cycle |
| Program/profile limits | <=512 variables, <=4096 statements/instructions, <=64 FB, <=256 bindings |
| Slow logic | counter modulo 5/30 trong cùng Program; không thêm Task |
| Clock | monotonic từ runtime; không đọc wall clock trong Program |

## 7. Luồng vận hành — `DD-08`

1. Preflight: topology/profile/point catalog GOOD; VAV writable/readback; no
   force/safety conflict; artifact/check result ghim hash.
2. Commission simulator: activate khi outputs bị safety/commission policy giữ;
   chạy scenario nominal, fault và recovery.
3. Read-back: mode, task state, output winner, VAV write result, PID ACTUAL,
   quality/generation và FDD code.
4. Cutover HIL: stop simulator, disable lab services, apply HIL binding revision,
   verify safe output, activate cùng artifact hash.
5. Rollback: restore LKG artifact/binding; release Program contribution; verify
   winner/safe output and audit.

## 8. Error, safety và security — `DD-09`

| Mã | Detection | State/output | Recovery/evidence |
|---|---|---|---|
| `AHU-CFG-001` | profile/setpoint/constraint invalid | Check reject; active revision unchanged | sửa draft; diagnostic path |
| `AHU-IO-001` | required point not GOOD/unmapped | input batch reject; Task fault/hold policy | N GOOD + mapped generation |
| `AHU-FAN-001` | enable nhưng no proof 30 s | FAULT; output theo shutdown/safety | proof GOOD + ACK/clear |
| `AHU-VAV-001` | cmd/fb mismatch >threshold/delay | affected FDD; coordinator fallback/fault | device readback + hysteresis |
| `AHU-COIL-001` | valve cmd nhưng no thermal response | alarm/fault per severity | sensor/valve inspection |
| `AHU-SNS-001` | stuck/bias/range/quality | no fabricated value; FDD/Task fault | N GOOD + calibration |
| `AHU-MASS-001` | mass residual >limit | coordinator clamp then FAULT if sustained | trace flows/commands |
| `AHU-OVL-001` | heating/cooling overlap forbidden | force lower-priority coil proposal 0; alarm | mode/guard clear |

Security: Program không parse file/network, không có secret, output range finite;
malicious config bị compiler/loader/io-map/PointWriter chặn. Safety: Program
không thay hardwired/MCU/Core authority; local output TTL và EXT watchdog chờ
`OD-AHUHP-013`.

## 9. Ánh xạ repository — `DD-10`

| Cần tạo/sửa | Đường dẫn | Dependency được phép | Dependency bị cấm |
|---|---|---|---|
| ST source | `apps/core/application/st/samples/ahu_high_performance.st` | ST subset/PID/timer | OS/network/file API |
| Canonical bundle | `contracts/programming/ahu_high_performance/` | profile/schema/compiler | hand-edited artifact |
| I/O map | `contracts/programming/ahu_high_performance/io_map_v1.json` | Point Catalog | flat/ambiguous MB identity |
| Control tests | `apps/core/application/st/tests/test_ahu_high_performance.cpp` | plant fixture/process image | Web mock làm control evidence |
| Build/manifest verification | `scripts/verify_ahu_high_performance_artifact.py` | canonical compiler | nondeterministic generation |

Không sửa `contracts/iop/iop_protocol.h`, `contracts/shm/mkddc_shm.h` hoặc
`rev_a_profile_v1.json` trong Plan 55 nếu chưa có decision/change request riêng.

## 10. Verification — `DD-11`

| Scenario | Fixture/precondition | Bước/ca lỗi | Kỳ vọng định lượng | Target/evidence | Thẩm quyền |
|---|---|---|---|---|---|
| `TC-AHUHP-C01` | canonical point snapshot | OFF→STARTUP→OCCUPIED | transition/outputs đúng từng cycle | Host trace | Controls QA |
| `TC-AHUHP-C02` | fan proof normal/late/missing | start/timeout | proof timeout 30 s candidate; no partial output | Host+HIL | HVAC/QA |
| `TC-AHUHP-C03` | VAV request step | trim/respond | pressure <=5%FS sau 5 phút | Plant+HIL | HVAC/QA |
| `TC-AHUHP-C04` | OA/RA condition sweep | economizer guards | no invalid enable; ventilation min giữ | Plant | HVAC |
| `TC-AHUHP-C05` | SAT load heat/cool | step load | <=±0,5°C sau settle | Plant+HIL | Controls/HVAC |
| `TC-AHUHP-C06` | dehumidify on/off | RH step | overlap chỉ trong mode; guards đúng | Plant | HVAC |
| `TC-AHUHP-C07` | four-flow constraints | infeasible/feasible | residual <=5%; infeasible reject/fault | Plant property test | Simulator/Controls |
| `TC-AHUHP-C08` | manual/safety override | override/release | anti-windup; bump <=10% span candidate | Host+HIL | Safety/QA |
| `TC-AHUHP-C09` | BAD/stale/unmapped/nonfinite | inject từng input | whole input/output batch zero-mutation | Host | Core QA |
| `TC-AHUHP-C10` | Program fault kéo dài | hold/TTL | local withdraw và VAV watchdog theo approved OD | Host+HIL | Safety |
| `TC-AHUHP-C11` | all FDD faults | inject/clear/flap | code/delay/hysteresis đúng, no chatter | Plant+HIL | HVAC/QA |
| `TC-AHUHP-C12` | Foxlinx SCHED_FIFO | 8 h soak | p99.9 WCET/budget, 0 allocation/leak | Target evidence | Release/QA |

## 11. Compatibility, deploy và rollback — `DD-12`

- Artifact schema/profile giữ version hiện hành; AHU bundle có riêng source/
  manifest hash.
- Binding simulator và HIL là hai revision không được merge ngầm.
- Activation theo stage→check→commission→activate safe boundary→first-cycle→LKG.
- Partial deploy thiếu point/profile làm Check fail; active artifact giữ nguyên.
- Rollback dùng LKG đã verify; rút output contribution/verify winner; RETAIN
  migration theo stable variable ID, không rename âm thầm.
- Không xóa trace/audit/bundle khi rollback.

## 12. Blocker, lịch sử và phê duyệt — `DD-13`

| Blocker | Owner | Ảnh hưởng | Gate | Điều kiện mở khóa |
|---|---|---|---|---|
| `OD-AHUHP-004/005/009` | CTO/HVAC/System/QA | Sequence/cadence/KPI chưa authority | M5/Implementation | Authority record candidate hash |
| `OD-AHUHP-013` | Safety/Controls/HVAC | Local/EXT fault output policy chưa đóng | `IMPLEMENT_READY[P3]` | Chốt per-output safe action/TTL và test |
| VAV hardware profile chưa chọn | HVAC/HW/Fieldbus | HIL binding/watchdog chưa cố định | `RELEASE_READY` | Device/register/failsafe HIL profile |

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1 | 2026-08-13 | Tạo Detailed Design một Program AHU 1 s |

| Vai trò | Trạng thái | Điều kiện ký |
|---|---|---|
| Controls Lead | Chưa ký | Algorithm/point/state/timing đủ implement |
| HVAC Lead | Chưa ký | Sequence/KPI/guards phù hợp hệ cơ |
| Runtime/Core Lead | Chưa ký | Profile/process image/priority đúng As-Built |
| Safety + QA/HIL | Chưa ký | Fault/TTL/HIL test đủ |

## 13. Tự kiểm `DD-01..DD-13`

| Mã | Kết quả | Mục/lý do |
|---|---|---|
| `DD-01` Metadata | PASS | Bảng đầu file + §12 |
| `DD-02` Mục tiêu/phạm vi | PASS | §1 |
| `DD-03` As-Built | PASS | §2 dẫn source thật, tách gap |
| `DD-04` Target ownership | PASS | §3 |
| `DD-05` Data từng field | PASS | §4 |
| `DD-06` Interface | PASS | §5 |
| `DD-07` State/algorithm/timing | PASS | §6 |
| `DD-08` UX/operation flow | PASS | §7 operation flow; UI thuộc hồ sơ riêng |
| `DD-09` Error/safety/security | PASS | §8 |
| `DD-10` Repository mapping | PASS | §9 |
| `DD-11` Verification | PASS | §10, 12 scenario |
| `DD-12` Compatibility/deploy/rollback | PASS | §11 |
| `DD-13` Trace/risk/decision/sign-off | PASS | §12; blocker đủ owner/ảnh hưởng/gate/unlock |
