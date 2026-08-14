# Fake MCU cho ứng dụng AHU vòng kín — Detailed Design MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `DDD-FW-AHUHP-FMCU-001` |
| Phiên bản | 0.1 |
| Trạng thái | **M3 — REVIEW READY / PROPOSED** |
| Ngày | 2026-08-13 |
| Chủ quản | FW-SOM Lead + FW-MCU Lead |
| Người review | Iobus, Simulator, System Architect, QA/Safety, Platform |
| Người phê duyệt | CTO + System Architect |
| Nguồn | `ARCH-AHUHP-001`; `DDD-SW-AHUHP-PLANT-001`; `OD-AHUHP-003/007/010/013` |
| Requirement | `FW-REQ-AHUHP-FMCU-001..005`; `IF-REQ-AHUHP-002/005`; `SAFE-REQ-AHUHP-002/003/006` |
| Phạm vi | Mở rộng tool `fake_mcu` bằng AHU closed-loop profile/UDS adapter; giữ legacy waveform và IOP v2 byte-compatible |

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. Triển khai gì? | Mode `ahu_closed_loop` cho `fake_mcu`: chuyển applied AO/DO sang plant và sensor snapshot về ADC raw/IO_RESP. |
| 2. Ai đọc? | FW-SOM/FW-MCU/Iobus/Simulator/QA/Platform. |
| 3. As-Built? | Tool đã có IOP v2, PTY/UART, AO/DO state, feedback, safe timeout và fault injection; UI sinh waveform. |
| 4. Target? | Profile-driven electrical model + UDS join/heartbeat/generation; IOP contract không đổi. |
| 5. Sửa đâu? | `tools/fake_mcu`, `contracts/simulation`, tests và systemd lab. |
| 6. Blocker? | UDS choice và plant-loss/output TTL policy chưa duyệt; sensor profile site chưa HIL. |
| 7. Bằng chứng? | `TC-AHUHP-M01..M12`; chưa có Test Result. |

## 1. Mục tiêu, actor và phạm vi — `DD-02`

Mục tiêu là tái hiện đúng biên SOM↔MCU/electrical khi không có STM32, không biến
fake MCU thành control hoặc physics engine. Iobus phải nhìn thấy cùng IOP frame,
ADC raw, status, fault, AO/DO ACK/feedback như đường thật.

Trong phạm vi: PTY/UART, IOP v2, sensor electrical encoding, actuator applied
snapshot, plant UDS join, heartbeat, safe/degraded state và fault composition.
Ngoài phạm vi: đổi IOP/capability, emulation CPU STM32/HAL/ISR chính xác, physical
accuracy/HIL claim và VAV Modbus registers.

## 2. As-Built và khoảng trống — `DD-03`

| Nội dung | As-Built 2026-08-13 | Gap target |
|---|---|---|
| CLI | `--pty/--link/--uart`, CRC/timeout/NACK/seq/ADC/DAC/relay/WDG/temp/VDD/stuck UI/self-test | Chưa có `--profile`, `--plant-sock`, `--mode` |
| IOP | `build_frame`, parser loop, HANDSHAKE/GET_IO/SET_AO/SET_DO/CFG/DIAG/RESET | Phải giữ byte-compatible và bổ sung golden cross-test |
| UI data | `simulated_ui_raw(i,t)` waveform và vài hard-coded sensor meanings | Không nhận plant snapshot/schema/generation |
| Output | `McuState::ao_raw/do_state`, DO feedback, log SET | Không publish applied electrical state cho plant |
| Safety | 200 ms no-frame safe, RESET_IO, NACK SAFE_STATE | Plant heartbeat loss chưa có semantics |
| Packaging | `mkddc-fakemcu.service` lab/no-MCU | Chưa dependency/join với plant/fake VAV profile |

## 3. Thiết kế mục tiêu và quyền sở hữu — `DD-04`

```text
IOP RX thread/main loop
  parse/validate → update McuElectricalState → ACK/NACK
                     │ immutable applied snapshot
                     ▼
              PlantClient (UDS)
                     ▲ sensor snapshot
                     │
          SensorElectricalCodec → IO_RESP raw/status/fault
```

| State/policy | Owner | Boundary |
|---|---|---|
| IOP sequence/session/safe timeout | fake MCU | giống MCU contract; không phụ thuộc plant control |
| AO raw/mode, DO coil/feedback | fake MCU electrical state | updated only valid IOP command |
| Sensor physical engineering state | plant | fake MCU read-only consumer |
| Sensor electrical encoding/calibration/noise at MCU edge | fake MCU profile | deterministic, versioned |
| AHU mode/PID/setpoint | Core Program | fake MCU cấm sở hữu |
| Plant physics/scenario | plant service | fake MCU cấm cài lại |

## 4. Mô hình dữ liệu từng field — `DD-05`

### 4.1 `FakeMcuConfig`

| Field | Type/unit | Required/default | Range/enum/null | Validation/lifecycle/version |
|---|---|---|---|---|
| `schemaVersion` | string | Y/`1.0` | supported major | immutable activation |
| `mode` | enum | `legacy_waveform` | legacy_waveform/ahu_closed_loop | unknown reject |
| `instanceId` | string | Y in AHU | canonical <=32 | join identity |
| `plantSocket` | path | fixed default | absolute under `/run/mkddc-sim/`; no `..` | regular parent/UDS only |
| `heartbeatMs` | uint32/ms | 100 | 50..1000 | runtime timer |
| `plantTimeoutMs` | uint32/ms | 500 | heartbeat×2..5000 | transition DEGRADED |
| `sensorProfileSha256` | hex | Y in AHU | 64 lowercase | identity/provenance |
| `legacySeed` | uint64 string | optional | 0..2^64-1 | only legacy mode |

### 4.2 Sensor electrical mapping ×16

| Field | Type | Required/default | Range/enum | Null/unknown | Validation/lifecycle |
|---|---|---|---|---|---|
| `channel` | uint8 | Y | 1..16 unique | cấm | key |
| `sourceField` | string | Y in AHU | canonical plant field | missing reject config | immutable |
| `signalType` | enum | Y | V0_10/MA4_20/NTC10K/DRY_CONTACT/RATIO | cấm | selects codec |
| `engMin/engMax` | double | Y | finite, min<max | cấm | linear sensor only |
| `electricalMin/Max` | double | type default | finite hardware-safe | cấm | V/mA/ratio domain |
| `invert` | bool | false | true/false | cấm | dry contact/linear |
| `noiseSigma/bias/tauMs` | double | 0 | bounded profile | cấm | deterministic sensor model |
| `outOfRangePolicy` | enum | BAD | BAD/CLAMP_FOR_FAULT_TEST | cấm | production-like default BAD |

`BAD/STALE/OFFLINE` plant quality không được encode thành một raw hợp lệ. Fake
MCU hạ ADC status của group 1..8 hoặc 9..16 và giữ raw diagnostic-only; Iobus
phải publish quality BAD cho group theo contract hiện tại.

### 4.3 Applied actuator snapshot

| Field | Type/unit | Default/range | Producer/consumer | Lifecycle |
|---|---|---|---|---|
| `aoRaw[4]` | uint16 | 0..65535 | fake MCU→plant | updated valid SET_AO |
| `aoModeMask` | uint8 bitset | 0 | fake MCU→plant | updated SET_AO_CFG |
| `aoElectrical[4]` | double V/mA | mode-specific physical range | codec output | derived, finite |
| `doCommand/doFeedback` | uint8 bitmask | low 4 bit | fake MCU→plant | relay fault may diverge |
| `safeState` | bool | false | fake MCU→plant | no-frame/reset policy |
| `iopSeq/appliedSeq` | uint64 string | monotonic | join/order | increments committed command batch |
| `observedMonoNs` | uint64 string | monotonic | timestamp | producer time |

## 5. Interface và contract — `DD-06`

- IOP authority: [`contracts/iop/iop_protocol.h`](../../../contracts/iop/iop_protocol.h);
  candidate không thêm opcode, payload byte, fault bit hay capability.
- Plant coupling dùng `DDD-IF-AHUHP-SIM-001`: HELLO, ACTUATOR_UPDATE,
  SENSOR_SNAPSHOT, HEALTH; message max 16 KiB, version/generation/seq.
- CLI target:

```text
mkddc-fake-mcu (--pty [--link PATH] | --uart DEV)
  [--mode legacy_waveform|ahu_closed_loop]
  [--profile FILE] [--plant-sock PATH]
  [existing fault options]
```

- `--mode` default legacy; `ahu_closed_loop` thiếu profile/socket làm startup
  fail rõ, không fallback sang waveform.
- Config file chỉ read at startup/reload signal được quyết định sau; candidate
  cấm đổi sensor mapping giữa RUNNING generation.

## 6. State, thuật toán và timing — `DD-07`

### 6.1 Coupling state machine

| State | Guard/action | IOP/quality behavior | Exit |
|---|---|---|---|
| `LEGACY` | mode legacy | As-Built waveform/fault behavior | process restart/config |
| `WAIT_PLANT` | AHU start, connect/HELLO | IOP handshake được; ADC groups BAD/LOCK; outputs accepted/applied electrical | valid matching HELLO→RUNNING |
| `RUNNING` | heartbeat/snapshot fresh | IO_RESP raw từ current complete plant snapshot | timeout→DEGRADED; version mismatch→FAULTED |
| `DEGRADED` | plant timeout >500 ms | ADC BAD/LOCK; no fabricated GOOD; AO/DO IOP semantics giữ | matching generation + N fresh snapshot→RUNNING |
| `FAULTED` | schema/major/invariant error | IOP health visible, inputs BAD; no auto fallback legacy | restart/validated config |
| `MCU_SAFE` | IOP idle >200 ms/reset policy | AO raw safe, DO open, SET NACK safe | HANDSHAKE→previous coupling state if plant valid |

### 6.2 Ordering

```text
on valid SET_AO/SET_DO/SET_AO_CFG:
  preflight payload and current MCU safe state
  commit electrical state atomically
  reply ACK
  publish immutable ACTUATOR_UPDATE with new appliedSeq

on GET_IO:
  select latest complete SENSOR_SNAPSHOT matching topologyRevision
  if missing/stale: set ADC status BAD/LOCK
  else encode all 16 channels using one profile revision
  compose metadata/fault/sampleCnt/DO feedback
  reply IO_RESP with IOP seq echo
```

Publish failure to plant does not roll back an already ACKed electrical output;
it raises coupling DEGRADED and retries latest complete snapshot with bounded
rate. Plant uses sequence/idempotency, never applies a partial channel update.

### 6.3 Electrical conversion

- AO raw→V/mA follows Iobus output test vectors in reverse for simulator field
  device; no change to production conversion boundary.
- Sensor engineering→electrical→ADC raw uses profile; 0–10 V respects divider,
  4–20 mA respects shunt, NTC uses approved resistance/curve and dry contact uses
  threshold profile.
- Round-trip tolerances are test-vector tolerances, not HIL accuracy claims.
- All calculations double until final signed 24-bit clamp; clamp only for valid
  in-range sensor; invalid engineering value makes quality BAD.

### 6.4 Timing/resource

| Path | Candidate |
|---|---|
| IOP | giữ 2 ms poll/3 ms response contract; PTY test timeout có thể riêng nhưng không đổi protocol constant |
| Plant heartbeat | 100 ms; timeout 500 ms |
| Snapshot | latest complete <=200 ms age when RUNNING |
| Allocation | no allocation per GET_IO/SET path after config load |
| Buffer | fixed IOP max frame; fixed UDS receive <=16 KiB; queue latest 32 snapshots |
| Watchdog | MCU safe timeout 200 ms giữ As-Built |

## 7. Luồng vận hành — `DD-08`

1. Validate profile/schema/hash/channel coverage 1..16 và socket root.
2. Start plant READY, then fake MCU AHU mode; inspect WAIT_PLANT→RUNNING.
3. Start Iobus; verify handshake/cap map/AO config and input quality GOOD only
   after fresh plant snapshot.
4. Read-back SET_AO/DO via fake MCU logs/health and plant applied snapshot.
5. Inject one fault at a time hoặc explicitly compose; log active injection set.
6. On plant disconnect, verify DEGRADED/ADC BAD; on rejoin require matching
   revision and fresh snapshots before GOOD.
7. Rollback: stop Iobus/fake MCU, restore legacy unit/config, verify waveform
   golden and symlink lifecycle; do not delete trace/config.

## 8. Error, safety và security — `DD-09`

| Mã | Detection | State/output | Recovery/evidence |
|---|---|---|---|
| `FMCU-AHU-400-PROFILE` | missing/type/range/hash/channel | startup fail; no PTY link ready | fix profile; validator log |
| `FMCU-AHU-409-REVISION` | plant topology mismatch | FAULTED/ADC BAD | restart/join matching candidate |
| `FMCU-AHU-409-SEQ` | old snapshot | discard; keep last fresh until age limit | producer resync |
| `FMCU-AHU-422-SENSOR` | nonfinite/out-of-range | group BAD; no valid raw claim | fix plant/profile |
| `FMCU-AHU-507-PLANT` | heartbeat timeout | DEGRADED, ADC BAD/LOCK | N fresh matching snapshot |
| Existing IOP errors | CRC/timeout/NACK/seq/ADC/DAC/relay/WDG | giữ As-Built behavior | existing fault controls |

Security: socket fixed/peer checked, file root fixed/no symlink, no network, no
secret; fault CLI lab only. Safety: fake MCU PASS không chứng minh STM32 timing,
ADC/AO accuracy, relay, watchdog hay electrical safe state; `MCU_SAFE` behavior
phải HIL lại trên firmware/board thật.

## 9. Ánh xạ repository — `DD-10`

| Cần tạo/sửa | Đường dẫn | Dependency được phép | Dependency bị cấm |
|---|---|---|---|
| Refactor state/protocol | `tools/fake_mcu/` bounded modules | `contracts/iop`, simulation DTO | link `iobus_lib`, Core internals |
| Electrical codec | `tools/fake_mcu/electrical_codec.*` hoặc shared simulation-only module | approved test vectors | production scaling duplicated without cross-test |
| Plant client | `tools/fake_mcu/plant_client.*` | UDS contract | TCP/Web API |
| Profile/schema | `contracts/simulation/ahu_fake_mcu_profile_v1.schema.json` | JSON Schema | ad-hoc CLI-only config |
| Tests | `tools/fake_mcu/tests/`, `apps/iobus/tests/` | PTY hermetic + golden | timing claim from sleep only |
| Systemd/package | `platform/systemd/mkddc-fakemcu.service`, lab drop-in | plant dependency/readiness | production enable default |

## 10. Verification — `DD-11`

| Scenario | Fixture/precondition | Bước/ca lỗi | Kỳ vọng định lượng | Target/evidence | Thẩm quyền |
|---|---|---|---|---|---|
| `TC-AHUHP-M01` | existing golden | legacy mode | byte/waveform/self-test không hồi quy | Host | Iobus/FW QA |
| `TC-AHUHP-M02` | PTY Iobus | all IOP commands | frame/ACK/NACK/seq/cap byte exact | Host integration | Iobus QA |
| `TC-AHUHP-M03` | valid plant snapshot | 16 channel boundary | raw/eng round-trip within vector tolerance | Host | FW/QA |
| `TC-AHUHP-M04` | AO modes | 0/50/100% commands | electrical snapshot correct, finite | Host | FW/Iobus |
| `TC-AHUHP-M05` | DO normal/stuck | set/read feedback | feedback/mismatch/fault exact | Host | FW |
| `TC-AHUHP-M06` | plant disconnect | wait timeout/rejoin | ADC BAD <=600 ms; GOOD only after N fresh | Host/Foxlinx | QA |
| `TC-AHUHP-M07` | revision/seq errors | inject older/mismatch | reject zero-mutation | Host | Contract QA |
| `TC-AHUHP-M08` | IOP idle | stop frames >200 ms | safe AO/DO and NACK SET | Host supporting; HIL required | Safety/FW |
| `TC-AHUHP-M09` | composed faults | CRC+plant+relay etc. | active set deterministic; no hidden precedence | Host | QA |
| `TC-AHUHP-M10` | malformed/oversize profile/message | fuzz | no crash/unbounded allocation; stable error | Host security | Security |
| `TC-AHUHP-M11` | service restart/symlink | restart order | link ready before Iobus; no missing-link race | Foxlinx | Platform |
| `TC-AHUHP-M12` | 8 h 500 Hz poll + plant | soak | no leak/spin/reconnect storm; counters monotonic | Foxlinx | Release/QA |

## 11. Compatibility, deploy và rollback — `DD-12`

- Default invocation keeps legacy behavior; new AHU mode explicit.
- IOP header/cap/version unchanged; simulation profile v1 independent.
- Package plant/profile first disabled; update fake MCU; run legacy regression;
  enable lab drop-in only after preflight.
- Partial deployment missing plant stays WAIT_PLANT/BAD, never waveform fallback.
- Rollback disable AHU flag, restore previous binary/unit/config, verify legacy
  golden and Iobus restart; preserve logs/trace/profile.

## 12. Blocker, lịch sử và phê duyệt — `DD-13`

| Blocker | Owner | Ảnh hưởng | Gate | Điều kiện mở khóa |
|---|---|---|---|---|
| `OD-AHUHP-007` | System/Security | Plant UDS chưa authority | `IMPLEMENT_READY[P1]` | Chấp thuận contract/schema |
| `OD-AHUHP-013` | Safety/Controls/HVAC | Plant-loss/output TTL chưa final | P3/HIL | Chốt TTL/safe per output |
| Sensor electrical profile chưa HIL | FW-MCU/HW/QA | Không claim raw accuracy/target | `RELEASE_READY` | Calibrated board HIL vectors |

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1 | 2026-08-13 | Tạo AHU closed-loop fake MCU design |

| Vai trò | Trạng thái | Điều kiện ký |
|---|---|---|
| FW-SOM/FW-MCU Lead | Chưa ký | IOP/electrical/state đúng contract |
| Simulator Lead | Chưa ký | Join/data/quality tương thích plant |
| Iobus Lead | Chưa ký | Không phá master/scaling/reconnect |
| QA/Safety | Chưa ký | Fault/legacy/HIL lanes đầy đủ |

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
