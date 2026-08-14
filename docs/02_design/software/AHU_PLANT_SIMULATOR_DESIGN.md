# Bộ mô phỏng vật lý AHU vòng kín — Detailed Design MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `DDD-SW-AHUHP-PLANT-001` |
| Phiên bản | 0.1 |
| Trạng thái | **M3 — REVIEW READY / PROPOSED** |
| Ngày | 2026-08-13 |
| Chủ quản | Simulator Lead + HVAC Modeling Lead |
| Người review | Controls, System Architect, FW-SOM, QA/Performance, Security |
| Người phê duyệt | CTO + System Architect + HVAC Lead |
| Nguồn | `PROD-AHUHP-001`; `ARCH-AHUHP-001`; `OD-AHUHP-006/007/009` |
| Requirement | `SWR-REQ-AHUHP-SIM-001..007`; `NFR-REQ-AHUHP-002..005`; `IF-REQ-AHUHP-001/002/005` |
| Phạm vi | Deterministic first-order AHU plant model, scenario/clock/fault/trace; không sở hữu control sequence, IOP hay Web auth |

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. Triển khai gì? | Service lab `mkddc-ahu-plant` sở hữu duy nhất trạng thái vật lý gió–nhiệt–ẩm–zone của một AHU. |
| 2. Ai đọc? | Simulator/HVAC/Controls/QA/Performance và adapter owners. |
| 3. As-Built? | Chưa có plant service; `fake_mcu` chỉ phát waveform theo thời gian, không closed-loop. |
| 4. Target? | Fixed-step 100 ms deterministic solver, scenario timeline, fault injection, trace và UDS v1. |
| 5. Sửa đâu? | Tạo `tools/ahu_plant_sim`, contract/schema, tests, package/systemd lab. |
| 6. Blocker? | Fidelity/KPI/resource budget chờ `OD-AHUHP-006/009`; UDS choice chờ `OD-AHUHP-007`. |
| 7. Bằng chứng? | `TC-AHUHP-P01..P12`; hiện chưa có Test Result. |

## 1. Mục tiêu, actor và phạm vi — `DD-02`

Plant model phải đủ để phát hiện lỗi control sequence, không nhằm thay CFD hay
phần mềm sizing. Actor chính là Controls Engineer và QA: nạp topology/parameter/
scenario đã kiểm, chạy real-time hoặc accelerated, inject fault, export trace và
so sánh determinism.

Tiêu chí thành công:

- output sensor phản ứng nhân quả với actuator applied;
- bảo toàn lưu lượng/năng lượng trong tolerance;
- không NaN/Inf/divergence với mọi input hợp lệ;
- cùng build/config/scenario/seed tạo trace sai khác <=1e-6;
- crash/restart không tự phát snapshot GOOD hoặc resume output cũ.

Ngoài phạm vi: CFD/3D, compressor/chiller/boiler plant, pressure-network nhiều
tầng, calibration site tự động và control policy.

## 2. As-Built và khoảng trống — `DD-03`

| Nội dung | As-Built 2026-08-13 | Gap target |
|---|---|---|
| Fake inputs | `tools/fake_mcu/fake_mcu.cpp::simulated_ui_raw()` sinh waveform/ramp, có vài nhãn AHU | Không phụ thuộc AO/DO/VAV/load; không có conservation |
| Schedule simulation | `apps/core/application/schedule/schedule_sim_main.cpp` mô phỏng schedule, không phải physical plant | Không tái sử dụng làm physics engine |
| Web demo simulator | `apps/web-ui/src/shared/demo/simulator.ts` là fixture UI | Cấm dùng làm runtime truth/evidence |
| Modbus fake | `apps/iobus/adapters/modbus_rtu/tests/test_modbus_master_fake.cpp` là test hermetic | Chưa có standalone fake VAV nối chung plant state |
| Plant schema/service | Chưa tồn tại | Phải tạo theo §9 |

## 3. Thiết kế mục tiêu và quyền sở hữu — `DD-04`

```text
ScenarioStore ──validate──> ScenarioEngine ──events──┐
Topology/Parameters ──────> PlantEngine <──applied──┤ fake_mcu/fake_vav
Clock(real/accelerated) ──> fixed-step 100 ms       │
                                      │              │
                                      ├─snapshot─────┘
                                      └─TraceWriter/KPI
```

| Component | State sở hữu | Thread/model | Failure boundary |
|---|---|---|---|
| `PlantEngine` | fan/damper/air/coil/zone state | một solver thread; không shared mutable writer | invariant fail→FAULTED, dừng publish GOOD |
| `ScenarioEngine` | event cursor, active fault, seed | cùng solver thread trước mỗi step | invalid event bị reject trước activation |
| `SimulationClock` | mode, simTimeNs, accumulator | steady monotonic; deterministic step count | wall-clock jump không đổi sim time |
| `CommandInbox` | bounded latest-by-actuator + generation | UDS reader đưa vào SPSC/bounded queue | overflow→stable error, không drop im lặng |
| `SnapshotPublisher` | immutable snapshot generation | sau complete step | consumer không thấy partial state |
| `TraceWriter` | rotated append-only trace | bounded async queue | queue full→alarm/pause theo policy, không block solver vô hạn |

## 4. Mô hình dữ liệu từng field — `DD-05`

### 4.1 `PlantInstance`

| Field | Type | Unit | Required/default | Range/enum | Null/unknown | Key/validation | Lifecycle/version |
|---|---|---|---|---|---|---|---|
| `schemaVersion` | string | — | Y/`1.0` | semver major.minor | cấm null | supported major | immutable |
| `instanceId` | string | — | Y | `[a-z][a-z0-9-]{0,31}` | cấm | primary identity | immutable |
| `topologyRevision` | uint64 string | — | Y | 1..2^64-1 | cấm | monotonic | activation |
| `parameterSha256` | hex string | — | Y | 64 lowercase hex | cấm | content identity | activation |
| `state` | enum | — | READY | STOPPED/READY/RUNNING/PAUSED/FAULTED | cấm | transition table | runtime |
| `simTimeNs` | uint64 string | ns | 0 | multiple of stepNs | cấm | monotonic | runtime/checkpoint |
| `stepNs` | uint64 string | ns | 100000000 | 10ms..1s | cấm | divides scenario times | activation |
| `speedFactor` | number | x | 1 | 0.1..60 | cấm | finite | runtime |
| `seed` | uint64 string | — | 1 | 0..2^64-1 | cấm | deterministic PRNG | activation |
| `generation` | uint64 string | — | 0 | monotonic | cấm | increments complete step | runtime |

### 4.2 `AirPathState` × FA/RA/SA/EA

| Field | Type | Unit | Default/range | Unknown semantics | Validation/lifecycle |
|---|---|---|---|---|---|
| `path` | enum | — | FA/RA/SA/EA | cấm | unique key |
| `damperCmdPct` | double | % | 0; 0..100 | no fresh command→watchdog/failsafe | applied input |
| `damperFbPct` | double | % | 0; 0..100 | sensor fault may set quality BAD | first-order actuator state |
| `flowM3h` | double | m³/h | 0; 0..1.2×design | invalid physics→FAULTED | solver output |
| `tempC` | double | °C | profile; -50..100 | BAD carried separately | solver output |
| `rhPct` | double | %RH | profile; 0..100 | BAD carried separately | solver output |
| `pressurePa` | double | Pa | 0; -2000..3000 | BAD separately | solver output |
| `quality` | enum | — | GOOD | GOOD/STALE/BAD/OFFLINE | producer truth |
| `observedMonoNs` | uint64 string | ns | required | 0 means never sampled | producer timestamp |

### 4.3 Fan/coil/zone state

| Entity.field | Type/unit | Required/default/range | Invariant/lifecycle |
|---|---|---|---|
| `Fan.id` | enum | supply/return | unique | immutable |
| `Fan.enable` | bool | false | applied input |
| `Fan.speedCmdPct/FbPct` | double/% | 0; 0..100 | fb first-order, 0 when disabled after coast |
| `Fan.pressurePa` | double/Pa | 0; 0..rated×1.2 | affinity law bounded |
| `Fan.powerKw` | double/kW | 0; 0..rated×1.2 | nonnegative |
| `Fan.proof/fault` | bool/bitset | false/0 | scenario can override |
| `Coil.id` | enum | cooling/heating | unique |
| `Coil.valveCmdPct/FbPct` | double/% | 0; 0..100 | rate/lag/stuck/leak model |
| `Coil.waterSupplyC/ReturnC` | double/°C | profile | bounded by profile |
| `Coil.heatKw` | double/kW | 0 | cooling negative, heating positive |
| `Zone.tempC/rhPct/co2Ppm` | double | 24/50/500 | finite bounded |
| `Zone.sensibleKw/latentKw/occupancy` | double | scenario | event-driven, bounded |
| `Building.pressurePa/leakCoeff` | double | profile | pressure derives mass imbalance |

### 4.4 `ScenarioEvent`

| Field | Type | Required/default | Range/enum | Validation/lifecycle |
|---|---|---|---|---|
| `eventId` | string | Y | unique <=64 ASCII | key; duplicate reject |
| `atSimNs` | uint64 string | Y | multiple of stepNs; sorted nondecreasing | immutable |
| `kind` | enum | Y | WEATHER/LOAD/OCCUPANCY/FAULT_SET/FAULT_CLEAR/COMMAND | allowlist |
| `target` | string | Y | canonical component/field ID | must exist topology |
| `value` | typed JSON | Y | field-specific finite/range | no coercion |
| `durationNs` | uint64 string | N/0 | 0..scenarioEnd | auto-clear only allowed fault |

Maximum: 10.000 events, 64 MiB trace segment, 100.000 in-memory sample ring,
one active scenario and one plant instance per process Rev A.

## 5. Interface và contract — `DD-06`

- UDS/message/HTTP/VAV schemas do `DDD-IF-AHUHP-SIM-001` sở hữu; Plant không
  định nghĩa bản fork.
- Plant server socket candidate `/run/mkddc-sim/ahu-plant.sock`,
  `SOCK_SEQPACKET`, max 16 KiB, peer credential allowlist.
- Actuator update phải có matching `instanceId/topologyRevision`, monotonic
  `seq`, applied electrical/VAV values và timestamp. Duplicate idempotent;
  out-of-order reject `SIM-AHU-409-SEQ`.
- Snapshot chỉ publish sau full step, mang generation/checksum/quality.
- Config activate dùng stage→validate→checksum→atomic rename→LKG; parse lỗi giữ
  active model, không partial mutation.

## 6. State, thuật toán và timing — `DD-07`

### 6.1 Lifecycle

| State | Entry | Allowed action | Exit |
|---|---|---|---|
| `STOPPED` | process start/no config | stage config, health | valid activate→READY |
| `READY` | topology+parameter loaded, safe initial state | load scenario/start/reset | start→RUNNING; invalid→FAULTED/READY unchanged |
| `RUNNING` | peers joined, scenario active | pause, fault, trace, speed | pause→PAUSED; invariant/link policy→FAULTED; end→PAUSED |
| `PAUSED` | explicit pause/end | single-step, resume, reset/export | resume→RUNNING; reset→READY |
| `FAULTED` | solver/invariant/resource/checkpoint error | health/export/reset | validated reset→READY; cấm resume trực tiếp |

### 6.2 Step ordering

```text
for each fixed step k:
  apply all scenario events where atSimNs == k*stepNs in stable eventId order
  consume newest complete actuator batch with seq <= step boundary
  advance damper/valve/fan first-order actuator states with rate limits/faults
  solve fan pressure and path flows from current speed/damper/leak coefficients
  enforce/check FA+RA≈SA and exhaust/building-pressure relationship
  solve mixed-air temperature/humidity by mass-weighted balance
  solve cooling/heating coil effectiveness and water-side response
  solve zone temperature/humidity/CO2/load and return-air state
  compute sensor noise/bias/lag using deterministic PRNG
  validate finite/range/conservation/resource invariants
  atomically increment generation and publish immutable snapshot
  append trace/KPI record
```

### 6.3 Candidate equations

Fan and actuator:

```text
x_next = x + clamp((cmd-x)*dt/tau, -rateDown*dt, rateUp*dt)
fanPressure = ratedPressure * (speedPct/100)^2
fanPowerKw = ratedPowerKw * (speedPct/100)^3
pathFlow = damperKv(position) * sqrt(max(abs(deltaP), 0)) * sign(deltaP)
```

Mixing and coil:

```text
Tmix = (mFA*TFA + mRA*TRA) / max(mFA+mRA, epsilon)
wMix = (mFA*wFA + mRA*wRA) / max(mFA+mRA, epsilon)
effectiveness = 1 - exp(-UAeffective / max(mAir*cpAir, epsilon))
Tout = Tin + effectiveness * (Twater - Tin)
```

Zone/building:

```text
dTzone/dt = (Qinternal + Qenvelope + mSA*cp*(TSA-Tzone)) / Czone
dCO2/dt = generation - ventilationRemoval
dPbuilding/dt = Kp * (mFA - mEA - leakage(Pbuilding))
```

All parameters finite and positive where required. Solver uses double; no
implicit unit conversion. If denominator <epsilon or constraint impossible,
return stable model error instead of continuing with arbitrary value.

### 6.4 Clock/concurrency/resource

- Solver is single-thread deterministic. I/O/trace threads pass immutable
  messages through bounded queues; no callback executes solver policy.
- Real-time uses `CLOCK_MONOTONIC`; accelerated runs exact integer step count,
  never integrates using variable wall-clock delta.
- Queue capacities: command 256, control 64, trace 4096; overflow counter and
  `SIM-AHU-429-QUEUE` emitted. Control command may pause; actuator queue keeps
  latest complete batch per producer but logs all dropped superseded seq.
- No heap allocation in solver steady step after activation; schema loading and
  trace formatting may allocate outside solver critical section.

## 7. Luồng vận hành — `DD-08`

1. Preflight regular files, hashes, schema versions, free disk, socket owner and
   no active production I/O conflict.
2. `stage` topology/parameter/scenario; validate all references and calculate
   canonical checksum.
3. `activate` model into READY; inspect health/topologyRevision/parameter hash.
4. Start fake VAV/fake MCU peers; require HELLO/join and safe applied snapshot.
5. Start scenario; read generation advancing exactly each 100 ms step.
6. Pause before changing speed/fault timeline; mutation reason/audit required.
7. Export trace+manifest; reset returns safe initial state with generation epoch
   new, not generation rollback inside same epoch.
8. Incident: PAUSE/FAULTED, capture logs/trace/config hashes, stop downstream
   fake services, rollback LKG, restart join.

## 8. Error, safety và security — `DD-09`

| Mã | Detection | State/output | Recovery/audit |
|---|---|---|---|
| `SIM-AHU-400-SCHEMA` | schema/type/range/reference | stage reject; active unchanged | fix candidate; validation report |
| `SIM-AHU-409-REVISION` | topology/generation mismatch | message reject; no state change | peer rejoin current revision |
| `SIM-AHU-409-SEQ` | duplicate/out-of-order | duplicate ACK/no-op hoặc reject older | inspect producer counter |
| `SIM-AHU-422-PHYSICS` | invalid parameter/constraint | activation reject or FAULTED | correct parameter/reset LKG |
| `SIM-AHU-422-DIVERGED` | NaN/Inf/conservation beyond hard limit | FAULTED; last snapshot no longer GOOD | export trace/reset |
| `SIM-AHU-429-QUEUE` | bounded queue full | pause/fault per queue; no silent drop | reduce rate/restart |
| `SIM-AHU-507-PEER` | required peer heartbeat loss | quality OFFLINE; run/pause policy profile | peer rejoin generation |
| `SIM-AHU-507-TRACE` | disk/trace write fail | solver may continue only if profile allows; visible alarm | free disk/export/restart |

Security: no network listener; UDS peer credential; config root allowlist;
regular file/no symlink; JSON depth 32, 4 MiB config, 16 KiB message; finite-number
validation; no shell/path execution from scenario; deterministic seed is not a
secret.

## 9. Ánh xạ repository — `DD-10`

| Cần tạo/sửa | Đường dẫn | Dependency được phép | Dependency bị cấm |
|---|---|---|---|
| Engine/model | `tools/ahu_plant_sim/domain/` | C++17 STL, project contract DTO | Core/Iobus internals, Web client |
| Scenario/clock | `tools/ahu_plant_sim/application/` | domain + monotonic clock adapter | wall-clock integration |
| UDS/config/trace | `tools/ahu_plant_sim/adapters/` | contract schemas, bounded JSON lib đã duyệt | TCP listener, unbounded parser |
| Bootstrap | `tools/ahu_plant_sim/bootstrap/main.cpp` | ports/adapters | business rules trong CLI |
| Tests | `tools/ahu_plant_sim/tests/` | deterministic fixtures | sleeps làm timing assertion chính |
| Contracts | `contracts/simulation/` | JSON Schema + register map | duplicated private schema |
| Packaging | `platform/systemd/mkddc-ahu-plant.service`, `platform/packaging/` | lab flag/config | production enable mặc định |

## 10. Verification — `DD-11`

| Scenario | Fixture/precondition | Bước/ca lỗi | Kỳ vọng định lượng | Target/evidence | Thẩm quyền |
|---|---|---|---|---|---|
| `TC-AHUHP-P01` | golden parameters | fan/damper step | monotonic bounded response, exact golden tolerance | Host unit | Simulator QA |
| `TC-AHUHP-P02` | four path model | sweep command/pressure | mass residual <=5% design after settle | Host property | HVAC/QA |
| `TC-AHUHP-P03` | mixing inputs | temperature/RH extremes | conservation/finite, analytic tolerance | Host unit | HVAC |
| `TC-AHUHP-P04` | coil profiles | valve/water/air sweep | expected direction/bound, no NaN | Host unit | HVAC |
| `TC-AHUHP-P05` | zone model | load/occupancy step | first-order response within golden band | Host | HVAC |
| `TC-AHUHP-P06` | same seed/config | run twice 1x | trace delta <=1e-6 | Host artifact | QA |
| `TC-AHUHP-P07` | same scenario | 1x vs 60x | event order/state hash equal | Host | QA |
| `TC-AHUHP-P08` | 10k events/max config | run/fuzz | bounded CPU/RSS/queue, invalid zero-mutation | Host perf/security | QA/Security |
| `TC-AHUHP-P09` | link loss/reorder | disconnect/rejoin | OFFLINE bound, no generation mix | Host integration | System QA |
| `TC-AHUHP-P10` | NaN/invariant corruption | inject | FAULTED before publish GOOD | Host fault | QA |
| `TC-AHUHP-P11` | crash/checkpoint mismatch | restart | READY safe; no auto resume stale | Host/Foxlinx | Platform/QA |
| `TC-AHUHP-P12` | Foxlinx lab | 8 h real-time soak | no >1 consecutive missed step, no linear leak | Target | Release/QA |

## 11. Compatibility, deploy và rollback — `DD-12`

- Schema/protocol `1.x`; breaking physics/state/message field đổi major.
- `legacy waveform` của fake MCU không phụ thuộc plant package.
- Config activation atomic/LKG; trace format carries schema/build/hash.
- Deploy plant/contracts trước adapters nhưng giữ disabled; version join fail
  fast. Partial deployment không auto-start scenario.
- Rollback binary+config LKG; keep trace/scenario/audit/checkpoint for incident;
  checkpoint incompatible bị bỏ có record, không tự migrate đoán.

## 12. Blocker, lịch sử và phê duyệt — `DD-13`

| Blocker | Owner | Ảnh hưởng | Gate | Điều kiện mở khóa |
|---|---|---|---|---|
| `OD-AHUHP-006` fidelity | CTO/HVAC/QA | Chưa freeze equations/estimate | `PLAN_READY` | Chấp thuận first-order Rev A/FMU future |
| `OD-AHUHP-007` UDS | System/Security | Chưa tạo machine contract | `IMPLEMENT_READY[P1]` | Chấp thuận UDS và schema review |
| `OD-AHUHP-009` KPI/budget | HVAC/QA/CTO | Exit thresholds chưa authority | P2/P5 exit | Ký profile và target budget |

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1 | 2026-08-13 | Tạo first-order deterministic plant design |

| Vai trò | Trạng thái | Điều kiện ký |
|---|---|---|
| HVAC Modeling Lead | Chưa ký | Equations/parameters/limits hợp lý |
| Simulator Lead | Chưa ký | Data/state/concurrency implementable |
| Controls Lead | Chưa ký | Plant đủ kích thích sequence |
| QA/Performance | Chưa ký | Determinism/fault/soak test đủ |

## 13. Tự kiểm `DD-01..DD-13`

| Mã | Kết quả | Mục/lý do |
|---|---|---|
| `DD-01` Metadata | PASS | Đầu file + §12 |
| `DD-02` Mục tiêu/phạm vi | PASS | §1 |
| `DD-03` As-Built | PASS | §2 |
| `DD-04` Target ownership | PASS | §3 |
| `DD-05` Data từng field | PASS | §4 |
| `DD-06` Interface | PASS | §5 |
| `DD-07` State/algorithm/timing | PASS | §6 |
| `DD-08` Operation flow | PASS | §7 |
| `DD-09` Error/safety/security | PASS | §8 |
| `DD-10` Repository mapping | PASS | §9 |
| `DD-11` Verification | PASS | §10 |
| `DD-12` Compatibility/deploy/rollback | PASS | §11 |
| `DD-13` Trace/risk/decision/sign-off | PASS | §12 |
