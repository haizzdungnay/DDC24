# Hợp đồng mô phỏng AHU — Detailed Design MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `DDD-IF-AHUHP-SIM-001` |
| Phiên bản | 0.1 |
| Trạng thái | **M3 — REVIEW READY / PROPOSED** |
| Ngày | 2026-08-13 |
| Chủ quản | System/Contract Lead |
| Người review | Plant, Fake MCU, Iobus/Modbus, Web API/FE, Security, QA |
| Người phê duyệt | CTO + System Architect |
| Nguồn | `ARCH-AHUHP-001`; `OD-AHUHP-003/007/008/013` |
| Requirement | `IF-REQ-AHUHP-001..005`; `SEC-REQ-AHUHP-001..003`; `SAFE-REQ-AHUHP-005/006` |
| Phạm vi | JSON config/schema, UDS plant protocol, Modbus VAV map, Simulation REST/WS API, stable errors và version/deploy rules |

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. Triển khai gì? | Một bộ contract v1 duy nhất cho topology/scenario/message/VAV/API; producer không tự fork field. |
| 2. Ai đọc? | Contract implementers và consumer reviewers của plant/fake MCU/VAV/Web/UI. |
| 3. As-Built? | IOP/SHM/Modbus/OpenAPI có authority riêng; chưa có simulation contract. |
| 4. Target? | UDS `SOCK_SEQPACKET` JSON bounded; four-slave VAV map; lab-only REST/WS. |
| 5. Sửa đâu? | `contracts/simulation/`, OpenAPI, adapters và contract tests. |
| 6. Blocker? | `OD-AHUHP-003/007/008/013`; machine-readable files chưa tạo. |
| 7. Bằng chứng? | `TC-AHUHP-I01..I12`; hiện chưa có Test Result. |

## 1. Mục tiêu, actor và phạm vi — `DD-02`

Mục tiêu là loại bỏ suy đoán giữa năm consumer: plant, fake MCU, fake VAV,
Web API và FE. Contract phải versioned, bounded, fail-fast, có quality/timestamp/
generation, stable error và rollback. IOP/SHM/Programming/Modbus contracts hiện
hành vẫn là authority của lane production tương ứng.

Ngoài phạm vi: đổi IOP/SHM, public cloud API, Modbus slave product capability và
schema cho multi-building/multi-plant.

## 2. As-Built và khoảng trống — `DD-03`

| Interface | As-Built 2026-08-13 | Gap target |
|---|---|---|
| SOM↔MCU | `contracts/iop/iop_protocol.h` v2 | Không đổi; simulation phải join bên ngoài |
| SHM | `contracts/shm/mkddc_shm.h` v5, 256 EXT | Không đổi; bốn VAV dùng point profile |
| Modbus RTU | `fieldbus.conf`, device profile, master/cache/write path | Chưa có VAV simulator register profile |
| REST/OpenAPI | `contracts/openapi/openapi.yaml` | Chưa có lab Simulation API/feature flag |
| Simulation config/message | Chưa tồn tại | Phải tạo machine-readable v1 |

## 3. Thiết kế mục tiêu và quyền sở hữu — `DD-04`

| Contract | Producer owner | Consumer | Authority target | Failure boundary |
|---|---|---|---|---|
| Topology/parameters/scenario | System/HVAC config author | plant/fake adapters/Web | JSON Schema under `contracts/simulation` | validate before activate, LKG |
| Plant UDS v1 | plant for snapshot; fake adapters for actuator | reciprocal peers | message schemas + this spec | peer/message reject zero-mutation |
| VAV register map | fake/real VAV device | Iobus Modbus master | device profile + this spec | per slave offline/failsafe |
| Simulation REST/WS | Web API | FE/Ops | OpenAPI | auth/feature flag/audit |

## 4. Mô hình dữ liệu từng field — `DD-05`

### 4.1 Common JSON envelope

| Field | Type | Required/default | Range/enum | Null/unknown | Validation/lifecycle/version |
|---|---|---|---|---|---|
| `schemaVersion` | string | Y | `1.x` | cấm | unknown major reject |
| `type` | string enum | Y | §5.2 allowlist | cấm | dispatch key |
| `instanceId` | string | Y | `[a-z][a-z0-9-]{0,31}` | cấm | plant identity |
| `producerId` | string | Y | canonical <=32 | cấm | peer allowlist |
| `requestId` | UUIDv4 | mutation Y | RFC4122 v4 | read event có thể bỏ | idempotency/audit |
| `topologyRevision` | decimal string uint64 | Y | >=1 | cấm | exact match |
| `generation` | decimal string uint64 | Y | monotonic | cấm | complete snapshot epoch |
| `seq` | decimal string uint64 | Y | monotonic per producer/type | cấm | duplicate/order |
| `simTimeNs` | decimal string uint64 | Y | step-aligned | cấm | deterministic time |
| `observedMonoNs` | decimal string uint64 | Y | producer monotonic | `"0"`=never only in health | freshness |
| `payload` | object | Y | type schema | cấm | max whole packet 16 KiB |

Decimal strings tránh mất precision khi message đi qua Go/JavaScript. Unknown
required field/type reject; unknown optional field của same minor được bỏ qua có
diagnostic counter.

### 4.2 Point value

| Field | Type | Required | Enum/range | Semantics |
|---|---|---|---|---|
| `pointId` | string | Y | canonical <=64 | stable identity |
| `valueType` | enum | Y | BOOL/UINT/REAL | no coercion |
| `value` | bool/uint/double/null | Y | finite/range | null only when quality not GOOD |
| `unit` | string | Y | project unit allowlist | exact, no implicit conversion |
| `quality` | enum | Y | GOOD/STALE/BAD/OFFLINE/CONFIG_ERROR | producer truth |
| `source` | enum | Y | PLANT/FAKE_MCU/MODBUS/PROGRAM/OPERATOR/SAFETY | no UI inference |
| `writable` | bool | Y | true/false | output preflight |
| `observedAt` | RFC3339 or null | Y | UTC | null allowed simulator accelerated; use simTimeNs |

## 5. Interface và contract — `DD-06`

### 5.1 UDS transport

| Thuộc tính | Contract candidate |
|---|---|
| Socket | `/run/mkddc-sim/ahu-plant.sock` |
| Type | Unix domain `SOCK_SEQPACKET` |
| Owner/mode | `mkddc:mkddc`, directory 0750, socket 0660 |
| Framing | một JSON UTF-8 object/packet; max 16 KiB; NUL bị cấm |
| Auth | `SO_PEERCRED` UID/GID allowlist + `producerId` mapping |
| Timeout | HELLO 2 s; heartbeat 100 ms; peer stale 500 ms candidate |
| Retry | reconnect exponential 100 ms→5 s + jitter deterministic per producer |
| Idempotency | mutation `requestId`, cache 1024 key/10 phút; duplicate same hash returns prior result, khác hash→409 |
| Concurrency | seq monotonic per producer; one active connection/producerId |

### 5.2 Message types

| Type | Producer→consumer | Payload bắt buộc | Side effect/response |
|---|---|---|---|
| `hello` | peer↔plant | supportedVersions, buildId, profileSha256, capabilities | `hello.ack`; join only exact major/topology |
| `actuator.update` | fake MCU/VAV→plant | complete local/VAV applied state, safeState, quality | atomic apply next step; `operation.result` |
| `sensor.snapshot` | plant→fake MCU/VAV/Web adapter | complete sensor/feedback/energy point array | immutable generation; no response unless error |
| `health` | peer↔plant | state, lastSeq, counters, faults | no mutation |
| `clock.command` | Web adapter→plant | START/PAUSE/STEP/RESET/SPEED, reason | Admin, idempotent result/readback |
| `fault.command` | Web adapter→plant/fake peer | SET/CLEAR, faultCode,target,params,duration | Admin, audit, active-fault readback |
| `trace.command` | Web adapter→plant | START/STOP/EXPORT, reason | bounded trace operation |
| `operation.result` | target→requester | requestId,status,error,stateRevision | authoritative completion |

### 5.3 `actuator.update` payload

```json
{
  "local": {
    "aoRaw": [0, 0, 0, 0],
    "aoModeMask": 0,
    "aoElectrical": [0.0, 0.0, 0.0, 0.0],
    "doCommandMask": 0,
    "doFeedbackMask": 0,
    "safeState": false
  },
  "vav": [
    {"id":"vav-fa","commandPct":0.0,"feedbackPct":0.0,
     "quality":"GOOD","commandAgeMs":0}
  ]
}
```

Array local phải đúng 4 phần tử. VAV array tối đa 4, ID unique và phải đủ set
topology trong batch complete; missing actuator làm reject toàn message.

### 5.4 VAV Modbus RTU profile v1

Bốn slave mặc định candidate `41=FA`, `42=RA`, `43=SA`, `44=EA`; địa chỉ là
configurable 1..247 và unique, chưa là production authority.

| Register | Loại | Field/type/unit | Quyền/range | Ghi chú |
|---:|---|---|---|---|
| 0 | Holding 4xxxx | `command_pct_x100` uint16/% | RW 0..10000 | FC06/16; ACK rồi readback |
| 1 | Holding | `command_mode` uint16 | RW 0=AUTO,1=SAFE_TEST | SAFE_TEST chỉ lab/profile flag |
| 2 | Holding | `command_seq` uint16 | RW wrap | chống duplicate trong simulator |
| 0 | Input 3xxxx | `feedback_pct_x100` uint16/% | RO 0..10000 | actuator feedback |
| 1..2 | Input | `airflow_m3h_x10` uint32 BE | RO 0..design×12 | two-register atomic snapshot |
| 3 | Input | `status_bits` uint16 | RO | bit0 online,1 moving,2 at_cmd,3 watchdog_safe |
| 4 | Input | `fault_bits` uint16 | RO | stuck/feedback/sensor/internal |
| 5 | Input | `command_age_100ms` uint16 | RO | saturating; watchdog evidence |
| 6 | Input | `profile_version` uint16 | RO `0x0100` | major/minor |

Device command watchdog/failsafe percent là immutable startup profile, không là
Program-writable register. Candidate timeout <=10 s chờ `OD-AHUHP-013`; timeout
đặt `watchdog_safe`, đi về failsafe theo rate và yêu cầu fresh write+seq để recover.

### 5.5 REST/WS lab API

Base `/api/v1/simulation/ahu`; mọi route trả 404 `feature_disabled` khi lab flag
OFF. GET yêu cầu viewer; mutation Admin; runtime AHU override dùng API point/
Programming hiện hành, không dùng Simulation API.

| Method/path | Request/response | Timeout/idempotency | Audit/error |
|---|---|---|---|
| `GET /instances` | summary + evidenceLevel | 2 s | viewer; no side effect |
| `GET /instances/{id}` | topology/state/health/hash | 2 s | 404 instance |
| `POST /instances/{id}/scenarios:load` | scenarioId/revision/hash/reason → operation | 5 s; `Idempotency-Key` UUIDv4 | admin + audit |
| `POST /instances/{id}:start|pause|step|reset` | reason/speedFactor as applicable | 5 s; idempotent | admin + audit/readback |
| `POST /instances/{id}/faults` | fault command | 5 s; idempotent | admin + audit |
| `DELETE /instances/{id}/faults/{faultId}` | reason | 5 s; idempotent | admin + audit |
| `GET /instances/{id}/trace` | bounded metadata/download handle | 10 s | viewer; no raw secret |
| `WS /instances/{id}/stream` | snapshot/status max 1 Hz | reconnect with generation | backpressure bounded |

Response operation:

```json
{
  "operationId":"uuid",
  "status":"APPLIED",
  "instanceState":"RUNNING",
  "topologyRevision":"7",
  "generation":"301",
  "evidenceLevel":"HOST_SIMULATOR",
  "error":null
}
```

`HTTP 202` chỉ nghĩa accepted; FE phải poll/WS tới APPLIED/FAILED/UNKNOWN. Timeout
trả `UNKNOWN`, không giả SUCCESS.

### 5.6 Stable error catalog

| Code | HTTP/UDS | Nghĩa | Retry |
|---|---|---|---|
| `SIM-AHU-400-SCHEMA` | 400/NACK | type/range/schema invalid | sửa request |
| `SIM-AHU-401-AUTH` | 401 | chưa xác thực | login |
| `SIM-AHU-403-ROLE` | 403 | role thiếu | không retry |
| `SIM-AHU-404-INSTANCE` | 404 | ID không tồn tại | sửa ID |
| `SIM-AHU-404-FEATURE` | 404 | lab flag OFF | không bypass |
| `SIM-AHU-409-IDEMPOTENCY` | 409 | cùng key khác body | key mới sau review |
| `SIM-AHU-409-REVISION` | 409/NACK | stale topology/config | reload |
| `SIM-AHU-409-SEQ` | 409/NACK | old/out-of-order seq | resync |
| `SIM-AHU-422-STATE` | 422/NACK | action không hợp lệ ở state | đọc state |
| `SIM-AHU-422-PHYSICS` | 422/NACK | parameter/constraint phi vật lý | sửa config |
| `SIM-AHU-413-SIZE` | 413/NACK | vượt size/count/depth | giảm payload |
| `SIM-AHU-429-RATE` | 429/NACK | rate/queue bound | backoff |
| `SIM-AHU-503-PEER` | 503/NACK | plant/fake peer unavailable | bounded retry/readback |
| `SIM-AHU-504-TIMEOUT` | 504 | kết quả chưa xác định | query operation |

## 6. State, thuật toán và timing — `DD-07`

### 6.1 Config activation transaction

```text
receive candidate + expected active revision + idempotency key
validate size/schema/finite/identity/reference/unit/range
canonicalize and hash
stage regular file fsync
ask all required lab consumers to preflight candidate hash/version
if any NACK/timeout: delete stage, active/LKG unchanged
atomic rename candidate, fsync directory, increment revision
activate only at plant READY/PAUSED boundary
read back every consumer revision/hash
mark APPLIED or UNKNOWN; never report success from write alone
```

### 6.2 Message ordering/freshness

- Producer seq strictly monotonic within epoch; new HELLO creates new epoch.
- Consumer applies at most one complete actuator batch per plant step, newest
  seq not from future sim time.
- Snapshot stale threshold 2×step, offline at peer timeout; exact thresholds
  in profile and carried to UI.
- CRC/checksum applies to config/trace; UDS kernel framing plus JSON validation
  applies runtime messages. Add payload hash if security review requires.

### 6.3 Resource/concurrency

- Max 16 KiB packet, JSON depth 16 runtime/32 config, arrays per schema.
- One active mutation/instance; concurrent duplicate same idempotency joins
  result; different mutation returns 409 busy/state conflict.
- WS max 4 clients/instance, latest snapshot coalescing, slow client closed with
  stable reason; no unbounded backlog.

## 7. Luồng người dùng/vận hành — `DD-08`

- Viewer reads runtime/simulation state only.
- Admin loads/starts/pauses/steps/resets/faults through confirmation surfaces in
  `DDD-UX-AHUHP-001`; reason and current revision mandatory.
- FE shows `PENDING/APPLIED/FAILED/UNKNOWN`; UNKNOWN offers “Kiểm tra trạng thái”,
  not blind retry.
- Ops preflight/readback/rollback/incident at `OPS-AHUHP-001`.

## 8. Error, safety và security — `DD-09`

- Validate external data before allocation/activation; fail closed/fast on
  major mismatch, NaN/Inf, stale revision, non-regular file and invalid peer.
- Simulation API never accepts physical point IDs or arbitrary serial/socket
  paths; routes call plant control adapter only.
- Lab flag default OFF; package/service/route all enforce independently.
- Audit actor/requestId/idempotency/bodyHash/revision/result; internal path/UID
  detail not returned public; no token/header/cookie in logs.
- VAV safe register cannot disable watchdog at runtime; fake VAV is not HIL
  proof for real actuator failsafe.

## 9. Ánh xạ repository — `DD-10`

| Cần tạo/sửa | Đường dẫn | Dependency được phép | Dependency bị cấm |
|---|---|---|---|
| Schemas | `contracts/simulation/*.schema.json` | JSON Schema draft used by repo | prose-only contract |
| VAV profile | `contracts/simulation/vav_profile_v1.json` | Modbus data model | product Modbus slave claim |
| OpenAPI | `contracts/openapi/openapi.yaml` | existing auth/error conventions | hidden route absent contract |
| Plant/fake DTO | `tools/ahu_plant_sim`, `tools/fake_mcu`, `tools/fake_vav` | generated/shared contract DTO | private field forks |
| Web API | `apps/web-api/internal/simulation/` | auth/audit/idempotency | direct serial/SHM write |
| FE API | `apps/web-ui/src/features/ahu/api/` | generated OpenAPI client | handwritten divergent types |
| Contract tests | producer/consumer test directories + `scripts/verify_ahu_sim_contract.py` | schemas/golden corpus | mocks only |

## 10. Verification — `DD-11`

| Scenario | Fixture/precondition | Bước/ca lỗi | Kỳ vọng định lượng | Target/evidence | Thẩm quyền |
|---|---|---|---|---|---|
| `TC-AHUHP-I01` | all schemas/golden | validate/round-trip | canonical hash stable | Host | Contract QA |
| `TC-AHUHP-I02` | each producer/consumer | HELLO join | version/cap/hash exact | Host integration | System |
| `TC-AHUHP-I03` | malformed/oversize/deep/NaN | corpus/fuzz | reject zero-mutation/no crash | Host security | Security |
| `TC-AHUHP-I04` | seq/revision permutations | duplicate/old/future | exact ACK/no-op/NACK semantics | Host | Contract QA |
| `TC-AHUHP-I05` | UDS permission peers | allowed/denied UID | denied before payload action | Host/Foxlinx | Security |
| `TC-AHUHP-I06` | four Modbus slaves | FC03/06/16/readback | register/byte/order exact | Host/Foxlinx | Iobus QA |
| `TC-AHUHP-I07` | VAV watchdog | stop writes | safe <=approved TTL, status bit/readback | Host+HIL | Safety/HVAC |
| `TC-AHUHP-I08` | API roles/flag | viewer/admin/flag OFF | exact 401/403/404/no side effect | Go+browser+target | Security/FE QA |
| `TC-AHUHP-I09` | idempotency | same/different body | same result vs 409 | Go integration | BE QA |
| `TC-AHUHP-I10` | operation timeout | delay/drop response | FE/API UNKNOWN + later reconcile | Go/browser | FE/BE QA |
| `TC-AHUHP-I11` | WS slow/reconnect | backpressure | bounded clients/queue/generation resume | Integration | Performance QA |
| `TC-AHUHP-I12` | mixed version deploy | one peer old major | fail fast, no partial activation, rollback | Foxlinx | Release |

## 11. Compatibility, deploy và rollback — `DD-12`

- Major mismatch fail fast; minor only additive optional fields with default
  semantics documented and test matrix.
- Machine-readable schemas land before producer code; generated client checked
  for clean diff. API hidden behind lab flag until all consumers join.
- VAV profile version register/readback required before Program activation.
- Rollback OpenAPI/BE/FE/fake/plant as compatible set; active config/LKG/trace/
  audit retained. Unknown result reconciled before retry/rollback.

## 12. Blocker, lịch sử và phê duyệt — `DD-13`

| Blocker | Owner | Ảnh hưởng | Gate | Điều kiện mở khóa |
|---|---|---|---|---|
| `OD-AHUHP-003/007/008` | CTO/System/Product/Security | I/O/UDS/routes chưa authority | `PLAN_READY` | Authority record |
| `OD-AHUHP-013` | Safety/HVAC | VAV watchdog/safe value chưa final | P1/P5 | Chốt profile + HIL acceptance |
| Machine schemas chưa tồn tại | Contract Lead | Chưa cho code producer/consumer | `IMPLEMENT_READY[P1]` | Tạo schema/golden/codegen/contract review |

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1 | 2026-08-13 | Tạo simulation contract candidate v1 |

| Vai trò | Trạng thái | Điều kiện ký |
|---|---|---|
| Contract/System Lead | Chưa ký | Field/version/error/concurrency đủ |
| Producer Leads | Chưa ký | Plant/fake MCU/fake VAV implementable |
| Consumer Leads | Chưa ký | Iobus/Web/FE semantics khớp |
| Security/QA | Chưa ký | Bounds/RBAC/fuzz/version tests đủ |

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
| `DD-08` UX/operation flow | PASS | §7 |
| `DD-09` Error/safety/security | PASS | §8 |
| `DD-10` Repository mapping | PASS | §9 |
| `DD-11` Verification | PASS | §10 |
| `DD-12` Compatibility/deploy/rollback | PASS | §11 |
| `DD-13` Trace/risk/decision/sign-off | PASS | §12 |
