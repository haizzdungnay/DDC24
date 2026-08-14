# Đặc tả yêu cầu ứng dụng AHU hiệu suất cao MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `SRS-AHUHP-001` |
| Phiên bản | 0.1 |
| Trạng thái | **M3 — REVIEW READY / PROPOSED** |
| Ngày | 2026-08-13 |
| Chủ quản | System Engineering |
| Người review | Product, HVAC, Controls, FW-SOM, FW-MCU, FE/BE, Security, QA/HIL |
| Người phê duyệt | CTO + Product Owner + System Architect |
| Nguồn | `PROD-AHUHP-001`; `OD-AHUHP-001..012`; baseline MK-DDC-24 |
| Phạm vi | 51 requirement cho system, control, simulator, fake MCU, interface, FE, NFR, safety và security |

## 0. Quy tắc requirement

- Mỗi dòng là một nghĩa kiểm được; `phải/không được` là bắt buộc.
- `Test` không đồng nghĩa đã có Test Result. Tất cả evidence AHUHP hiện là
  `MISSING` cho tới khi implementation chạy và reviewer ký.
- Design allocation không biến solution chưa duyệt thành requirement Active;
  toàn bộ set giữ `Proposed` cho tới authority record.
- Acceptance dùng giá trị candidate. `OD-AHUHP-009` có thể sửa trước M5; sửa
  sau M5 phải qua change control và cập nhật trace/VVP.

## 1. Yêu cầu hệ thống

| ID | Phát biểu | Nguồn/rationale | Priority | Allocation | Verification và acceptance |
|---|---|---|---|---|---|
| `SYS-REQ-AHUHP-001` | Hệ thống **phải** cung cấp một ứng dụng AHU gồm hai fan, hai water coil và bốn air path FA/RA/SA/EA điều biến. | `PR-AHUHP-001`; đúng topology mục tiêu | Must | Core Programming + Iobus + simulator + Web | Test: point/actuator inventory đủ và scenario nominal chạy vòng kín |
| `SYS-REQ-AHUHP-002` | Hệ thống **phải** giữ `mkddc-core`, `mkddc-iobus`, `mkddc-web` và MCU đúng ownership; simulator không trở thành control authority. | ADR-005; local-first | Must | Architecture | Inspection + kill Web/simulator control-plane: local control/safe behavior đúng thiết kế |
| `SYS-REQ-AHUHP-003` | Hệ thống **phải** cho cùng control artifact chuyển từ simulator binding sang target/HIL binding bằng config có revision, không sửa thuật toán. | Giảm sai khác dev→HIL | Must | Programming Project/Binding | Hash source/artifact không đổi; chỉ binding/profile revision đổi |
| `SYS-REQ-AHUHP-004` | Hệ thống **phải** phân biệt host simulator, Foxlinx+fake MCU, MCU HIL và site validation trong UI/evidence. | Quy tắc trung thực | Must | Web + VVP + records | Inspection: lane/evidenceLevel hiện rõ; không có auto-promotion |
| `SYS-REQ-AHUHP-005` | Hệ thống **phải** fail closed khi config, binding, quality hoặc simulator contract không hợp lệ và không được publish output batch một phần. | Safety/data integrity | Must | Validator + process image + adapters | Negative test: toàn batch reject, output/generation trước đó giữ nguyên |

## 2. Yêu cầu control sequence

| ID | Phát biểu | Nguồn/rationale | Priority | Allocation | Verification và acceptance |
|---|---|---|---|---|---|
| `SWR-REQ-AHUHP-CTRL-001` | Control **phải** dùng state machine tối thiểu `OFF/STARTUP/OCCUPIED/UNOCCUPIED/ECONOMIZER/HEATING/COOLING/DEHUMIDIFY/SHUTDOWN/FAULT/FROST/FIRE`. | Lifecycle xác định | Must | Program `AHU_ModeSafety` | State-transition table test đủ guard; transition không hợp lệ bị từ chối |
| `SWR-REQ-AHUHP-CTRL-002` | Fan enable **phải** chờ permissive và xác nhận proof trong timeout profile; mất proof khi chạy phải alarm/fault theo delay. | Tránh fan command giả | Must | `AHU_FanSequence` | Proof timeout mặc định 30 s; fault code ổn định; output theo safe policy |
| `SWR-REQ-AHUHP-CTRL-003` | Supply fan PID **phải** điều khiển duct static/airflow và setpoint phải hỗ trợ trim-and-respond theo VAV request. | Giảm năng lượng fan | Must | `AHU_SupplyFan` | Step test: error <=5%FS sau 5 phút, không sustained oscillation |
| `SWR-REQ-AHUHP-CTRL-004` | Return/exhaust fan **phải** tracking airflow hoặc building pressure theo topology; mất sensor không được tự suy thành 0. | Cân bằng áp suất | Must | `AHU_ReturnExhaust` | 95% occupied trong band profile; BAD chuyển fallback/fault xác định |
| `SWR-REQ-AHUHP-CTRL-005` | FA/RA/SA/EA command **phải** được phối hợp bằng constraint mass balance; cấm bốn loop độc lập cùng tranh một objective. | `PR-AHUHP-005` | Must | `AHU_AirflowCoordinator` | Residual <=5% SA_design sau settle; constraint test âm |
| `SWR-REQ-AHUHP-CTRL-006` | Ventilation **phải** giữ minimum outdoor airflow khi occupied và hỗ trợ DCV khi CO2/occupancy GOOD. | IAQ | Must | `AHU_Ventilation` | Không thiếu minimum >60 s; sensor BAD dùng configured conservative fallback |
| `SWR-REQ-AHUHP-CTRL-007` | Economizer **phải** có enable/disable guard theo sensor/limit profile và phối hợp coil; quality không GOOD phải disable hoặc fallback rõ. | Không free-cooling sai | Must | `AHU_Economizer` | Boundary/quality/fault scenarios; mode/readback đúng |
| `SWR-REQ-AHUHP-CTRL-008` | SAT control **phải** dùng split-range cooling/heating, deadband, rate limit và anti-windup theo actual applied output. | Ổn định và tránh overlap | Must | `AHU_SATCoils` + PID FB | SAT <=±0,5°C; overlap ngoài DEHUMIDIFY bằng 0 sau delay |
| `SWR-REQ-AHUHP-CTRL-009` | Override/safety priority **phải** thắng Program; PID bị override phải freeze/back-calculate và bumpless khi trả quyền. | ADR-029/control stability | Must | PriorityResolver + PID ACTUAL | Override step không windup; return bump <=10% span candidate |
| `SWR-REQ-AHUHP-CTRL-010` | FDD **phải** phát hiện tối thiểu fan no-proof, damper/valve stuck, sensor stuck/bias/out-of-range, VAV offline, filter high DP, freeze risk và unintended overlap. | `PC-AHUHP-005` | Must | `AHU_FDD` + alarm | Mỗi fault có detect delay, stable code, clear hysteresis và expected evidence |

## 3. Yêu cầu AHU plant simulator

| ID | Phát biểu | Nguồn/rationale | Priority | Allocation | Verification và acceptance |
|---|---|---|---|---|---|
| `SWR-REQ-AHUHP-SIM-001` | Plant simulator **phải** là chủ sở hữu duy nhất của thermal/airflow/zone physical state. | Tránh hai nguồn chân lý | Must | `tools/ahu_plant_sim` | Architecture/unit test không có writer khác |
| `SWR-REQ-AHUHP-SIM-002` | Plant **phải** mô hình hóa fan, damper, mixing, coil, zone/load và building pressure bằng phương trình bounded có parameter versioned. | Closed-loop đủ dùng | Must | Plant engine | Equation/unit/property tests; không NaN/Inf với valid domain |
| `SWR-REQ-AHUHP-SIM-003` | Plant step mặc định **phải** là 100 ms monotonic; cùng build/config/scenario/seed phải tạo trace sai khác <=1e-6. | Tái lập test | Must | Simulation clock | Replay comparison hai lần |
| `SWR-REQ-AHUHP-SIM-004` | Simulator **phải** hỗ trợ real-time, pause/single-step và accelerated <=60x mà không đổi thứ tự event. | Dev/QA usability | Should | Clock/scenario engine | Event order/hash bằng nhau giữa 1x và accelerated |
| `SWR-REQ-AHUHP-SIM-005` | Scenario **phải** hỗ trợ weather/load/occupancy step và fault fan/damper/valve/sensor/IOP/Modbus theo timeline. | Coverage | Must | Scenario engine | Schema + test từng event; invalid event reject zero-mutation |
| `SWR-REQ-AHUHP-SIM-006` | Plant **phải** enforce range, conservation tolerance và resource bound; invalid parameter không được activate. | Chống model phi vật lý/DoS | Must | Validator | Hostile corpus; RSS/CPU và max entity bound đạt NFR |
| `SWR-REQ-AHUHP-SIM-007` | Plant restart **phải** vào `READY` với outputs safe/unknown; resume chỉ khi snapshot version/generation khớp và operator xác nhận. | Restart an toàn | Must | Lifecycle | Crash/restart test; stale checkpoint không auto-resume |

## 4. Yêu cầu fake MCU AHU

| ID | Phát biểu | Nguồn/rationale | Priority | Allocation | Verification và acceptance |
|---|---|---|---|---|---|
| `FW-REQ-AHUHP-FMCU-001` | Fake MCU mode mới **phải** giữ nguyên byte contract IOP v2, command, timing constants và board capability Rev A. | `PR-AHUHP-002` | Must | `tools/fake_mcu` | Byte/golden/integration tests; contract diff bằng 0 |
| `FW-REQ-AHUHP-FMCU-002` | Fake MCU **phải** chuyển AO raw/mode và DO applied/feedback tới plant, đồng thời chuyển sensor engineering snapshot về ADC raw đúng sensor profile. | Mô phỏng electrical boundary | Must | Plant adapter | Round-trip boundary test 0/50/100% và negative range |
| `FW-REQ-AHUHP-FMCU-003` | Mất plant heartbeat >500 ms **phải** làm ADC status BAD/LOCK và health `DEGRADED`; không bịa giữ GOOD. | Fail closed | Must | Coupling state machine | Disconnect test trong <=600 ms; Core thấy input BAD |
| `FW-REQ-AHUHP-FMCU-004` | IOP safe timeout, RESET_IO, relay feedback, CRC/timeout/NACK/ADC/DAC/WDG fault injection hiện có **phải** không hồi quy. | Giữ test asset hiện hữu | Must | Existing fake MCU | Full fake-MCU regression + scenario composition |
| `FW-REQ-AHUHP-FMCU-005` | Legacy waveform mode **phải** giữ mặc định tương thích; AHU closed-loop chỉ bật bằng profile/flag tường minh. | Không phá lab/runbook cũ | Must | CLI/config/systemd | Start without new flag giữ output/golden cũ |

## 5. Yêu cầu interface và dữ liệu

| ID | Phát biểu | Nguồn/rationale | Priority | Allocation | Verification và acceptance |
|---|---|---|---|---|---|
| `IF-REQ-AHUHP-001` | Topology, parameter và scenario **phải** có JSON Schema version 1, canonical serialization, checksum và bounded limits. | Config integrity | Must | `contracts/simulation` | Schema/round-trip/corpus tests |
| `IF-REQ-AHUHP-002` | Plant coupling **phải** dùng local UDS `SOCK_SEQPACKET`, message <=16 KiB, schemaVersion/generation/seq/timestamp và stable error. | Framing/local isolation | Must | Plant/fake adapters | Producer-consumer join, malformed/oversize/order tests |
| `IF-REQ-AHUHP-003` | Bốn fake VAV **phải** có register map versioned gồm command, feedback, airflow, status/fault và readback; write phải ACK/NACK rõ. | EXT path thật | Must | Fake VAV + Modbus profile | FC03/06/16/exception/readback tests |
| `IF-REQ-AHUHP-004` | Simulation API **phải** có status/load/start/pause/step/reset/fault/trace operations, idempotency cho mutation và authoritative read-back. | FE/ops contract | Must | Web API/OpenAPI | Contract/API tests; timeout trả `UNKNOWN`, không toast giả |
| `IF-REQ-AHUHP-005` | Mọi point **phải** mang unit, quality, source, observedAt, generation và writable semantics; null/unknown không thành 0. | Data truth | Must | SHM/Point/API/FE | Contract normalization tests |

## 6. Yêu cầu FE/UX

| ID | Phát biểu | Nguồn/rationale | Priority | Allocation | Verification và acceptance |
|---|---|---|---|---|---|
| `SWR-REQ-AHUHP-FE-001` | Route runtime **phải** hiển thị mimic FA/RA/SA/EA, fan, coil, sensor, setpoint, mode, quality/source/age và override. | Operator awareness | Must | `/ahu/:id` | Desktop/mobile browser E2E + visual review |
| `SWR-REQ-AHUHP-FE-002` | Simulation Lab **phải** tách khỏi runtime, có evidence lane, scenario controls và fault drawer. | Tránh nhầm demo/live | Must | `/eng/simulation/ahu/:id` | Lab banner/route/feature flag tests |
| `SWR-REQ-AHUHP-FE-003` | Loading/empty/error/permission/unknown/stale/offline/paused/faulted **phải** có state/copy riêng, không dùng màu đơn độc. | Usability/a11y | Must | FE state model | Component tests + WCAG 2.2 AA inspection |
| `SWR-REQ-AHUHP-FE-004` | Start/reset/fault injection **phải** có role, confirmation, focus trap, keyboard và audit reason. | Runtime mutation safety | Must | Dialog/drawer | RBAC/a11y/E2E negative tests |
| `SWR-REQ-AHUHP-FE-005` | Trend/KPI **phải** ghi source/evidence level và không suy GOOD từ HTTP 2xx hoặc dữ liệu minh họa. | Data truth | Must | Dashboard/trace | API failure/stale tests; screenshot có label minh họa trong fixture |

## 7. Yêu cầu phi chức năng

| ID | Phát biểu | Nguồn/rationale | Priority | Allocation | Verification và acceptance |
|---|---|---|---|---|---|
| `NFR-REQ-AHUHP-001` | Program Task Rev A **phải** dùng một Task 1000 ms; p99.9 WCET target phải nằm trong budget được duyệt và không làm trễ base step. | ADR-026/028 | Must | Core Programming | Foxlinx SCHED_FIFO benchmark; threshold khóa trước P3 exit |
| `NFR-REQ-AHUHP-002` | Plant real-time 100 ms **phải** không bỏ >1 step liên tiếp và CPU/RSS phải nằm dưới budget P2 được CTO duyệt. | Performance | Must | Plant service | 8 h soak host/Foxlinx; số liệu p99.9/RSS |
| `NFR-REQ-AHUHP-003` | Hệ thống **phải** chạy >=8 h simulator soak không NaN/Inf, unbounded queue, leak tăng tuyến tính hoặc generation rollback. | Reliability | Must | End-to-end | Sanitizer/soak metrics |
| `NFR-REQ-AHUHP-004` | Schema/protocol phải hỗ trợ backward-compatible minor; breaking change phải bump major và fail fast. | Compatibility | Must | Contracts | Version matrix tests |
| `NFR-REQ-AHUHP-005` | Mỗi algorithm/point/scenario/fault phải có stable ID và source mapping đủ để debug từ UI tới code/test. | Maintainability | Should | Docs/code/trace | Bidirectional trace/link check |

## 8. Yêu cầu safety

| ID | Phát biểu | Nguồn/rationale | Priority | Allocation | Verification và acceptance |
|---|---|---|---|---|---|
| `SAFE-REQ-AHUHP-001` | Ứng dụng **không được** tự nhận là safety PLC hoặc thay hardwired fire/freeze interlock. | Scope safety | Must | Product/UI/docs | Inspection/copy test không có claim cấm |
| `SAFE-REQ-AHUHP-002` | Fire/freeze/safe-state authority **phải** thắng Program và rút/override output theo policy đã duyệt. | Priority safety | Must | SafetyManager/MCU | Fault integration test + HIL |
| `SAFE-REQ-AHUHP-003` | Input safety-relevant BAD/STALE/OFFLINE **phải** dẫn tới fallback/fault rõ; không dùng last value vô hạn. | Fail closed | Must | Program + point quality | Aging/disconnect tests có timeout định lượng |
| `SAFE-REQ-AHUHP-004` | Recovery từ fault **phải** yêu cầu N mẫu/giây GOOD liên tiếp và điều kiện clear; critical fault không auto-clear nếu policy yêu cầu ACK. | Chống dao động | Must | FDD/state machine | Flapping test không chatter |
| `SAFE-REQ-AHUHP-005` | Simulator mutation **không được** có đường tác động site/physical service khi lab feature flag OFF. | Isolation | Must | Packaging/API/systemd | Negative target test flag OFF |
| `SAFE-REQ-AHUHP-006` | Program fault/input batch reject **phải** có TTL rút local AO/DO được phê duyệt; VAV EXT **phải** có command watchdog/failsafe độc lập được HIL xác nhận. | EXT hiện không dùng PriorityResolver/release như local output | Must | Core policy + VAV profile/device | Fault-duration test; candidate local 3 s, VAV <=10 s chờ `OD-AHUHP-013` |

## 9. Yêu cầu security

| ID | Phát biểu | Nguồn/rationale | Priority | Allocation | Verification và acceptance |
|---|---|---|---|---|---|
| `SEC-REQ-AHUHP-001` | Simulation mutation **phải** yêu cầu `admin`; runtime override giữ policy operator/admin hiện hành; viewer chỉ đọc. | Least privilege | Must | Web API/FE | Route/API RBAC matrix tests |
| `SEC-REQ-AHUHP-002` | UDS **phải** kiểm peer UID/GID, mode 0660, bounded message/rate và không nhận path/network endpoint từ untrusted request. | Local trust boundary | Must | Plant/fake services | Peer/permission/fuzz tests |
| `SEC-REQ-AHUHP-003` | Scenario/config/upload **phải** chống path traversal, symlink, NaN/Inf, oversized/deep JSON và audit mutation không chứa secret. | Hostile input | Must | Validator/store/API | Security corpus zero-mutation |

## 10. Coverage và gate

| Nhóm | Số requirement | Design owner | Verification owner |
|---|---:|---|---|
| System | 5 | Architecture | QA/System |
| Control | 10 | Control App Design | Controls QA/HIL |
| Simulator | 7 | Plant Simulator Design | Simulator QA |
| Fake MCU | 5 | Fake MCU Design | FW-SOM/FW-MCU QA |
| Interface | 5 | Interface Spec | Contract QA |
| FE/UX | 5 | UI/UX Design | FE QA/UX |
| NFR | 5 | Architecture/Design | Performance QA |
| Safety | 6 | Safety/Control Design | Safety/HIL |
| Security | 3 | Interface/Ops | Security reviewer |
| **Tổng** | **51** |  |  |

| Gate | Trạng thái | Lý do/điều kiện mở |
|---|---|---|
| Requirements M3 | PASS candidate | 51/51 có source/rationale/priority/allocation/verification/acceptance |
| M4 | BLOCKED | Owner consumer leads; cần review và đóng P0/P1 |
| M5 | BLOCKED | CTO/Product/System chưa ký candidate revision/hash |
| Implementation | BLOCKED | `OD-AHUHP-*` chưa quyết định và contract machine-readable chưa được tạo |

## 11. Lịch sử và phê duyệt

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1 | 2026-08-13 | Tạo 51 requirement candidate cho CTO review |

| Vai trò | Trạng thái | Điều kiện ký |
|---|---|---|
| System Architect | Chưa ký | Requirement không mâu thuẫn baseline/ADR |
| Product Owner | Chưa ký | Product allocation/acceptance phù hợp |
| HVAC Lead | Chưa ký | Chấp nhận topology và KPI |
| QA/HIL Lead | Chưa ký | Testability và evidence lane đầy đủ |
