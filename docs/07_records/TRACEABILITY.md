# Requirements Traceability

**ID:** TRACE-001
**Trạng thái:** Active
**Cập nhật:** 2026-07-23 (ADR-018: thêm hàng cho SYS/SWR/IF/SAFE/NFR/FW-REQ-IEC/MCU, tất cả Planned — chưa có code C1–C10)

Ma trận chỉ ra vị trí thiết kế/code và loại evidence cần thu. `Planned` không phải bằng chứng pass.

| Requirement | Thiết kế / implementation authority | Verification | Trạng thái evidence |
|---|---|---|---|
| SYS-REQ-001 | `services/core`, [System](../03_architecture/SYSTEM.md) | service-loss/system scenario | Planned |
| SYS-REQ-002 | shared capacities, `services/iobus`, [Hardware](../04_design/HARDWARE.md) | layout + physical I/O | Partial |
| SYS-REQ-003 | `services/core/graph_runtime.cpp`, [Software](../04_design/SOFTWARE.md) | node registry/unit/integration | Implemented; release record required |
| SYS-REQ-004 | `services/iobus` protocol adapters | BACnet/Modbus smoke + negative tests | Partial |
| SYS-REQ-005 | `services/hmi`, CMake option | enabled build + target smoke | Partial |
| SYS-REQ-IEC-001 | ADR-018, `PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md`, C0/C1–C10 plans (chưa có code) | inspection + conformance test ST+FBD | Planned — C0 chưa hoàn thành |
| SWR-REQ-001 | service entrypoints/CMake/system units | process isolation test | Planned |
| SWR-REQ-002 | core graph/priority/safety | timing + unit + fault test | Partial |
| SWR-REQ-003 | web validators + iobus config consumer | round-trip/reload test | Partial |
| SWR-REQ-004 | `web/backend/http.go` + auth middleware | API role/security tests | Partial |
| SWR-REQ-005 | ADR-017, `services/netcfg`, HMI broker/client | active/pending truth + negative UI/API tests | Orange Pi service path and target negative tests pass; Web REST migration/panel open |
| SWR-REQ-006 | `mkddc-netcfg` transaction journal/coordinator | static/DHCP/confirm/120 s rollback + restart fault tests | Target static confirm, process recovery, explicit/automatic rollback pass; DHCP/reboot/power fault open |
| SWR-REQ-007 | netcfg + iobus BACnet address watcher | multi-process continuity, BACnet `I-Am`, Web/Modbus reconnect | Target control continuity and live hot-rebind pass; packet/Modbus/physical I/O evidence open |
| SWR-REQ-IEC-001..009 | `libmkddc_iec`/`mkddc-program-service`/`mkddc-program-core` (chưa triển khai — C1+) | theo `KX-DDC24-PROGRAM-RUNTIME-IMPLEMENTATION-PLAN-C1-C10.md` mỗi slice | Planned — C0 chưa hoàn thành, C1–C10 blocked |
| IF-REQ-001 | `shared/iop_protocol.h`, [Firmware](../04_design/FIRMWARE.md) | assertions + HIL timing/fault | Partial |
| IF-REQ-002 | `shared/mkddc_shm.h` + consumers | layout/magic tests | Implemented; release record required |
| IF-REQ-003 | core/iobus AO path | physical-unit boundary regression + bench | Partial |
| IF-REQ-004 | [Interfaces](../04_design/INTERFACES.md), `shared/netcfg_protocol_v1.schema.json` | cross-language fixtures + malformed/peer/state tests | Schema/clients implemented; target UID denial, socket permissions and allowlist pass |
| IF-REQ-IEC-001 | `io_map.json` schema (chưa triển khai — C2) | mapping/round-trip/negative tests | Planned |
| SAFE-REQ-001 | MCU IOP/watchdog implementation | disconnect HIL ≤200 ms | Missing release evidence |
| SAFE-REQ-002 | core/iobus validators | NaN/infinity/range negative tests | Partial |
| SAFE-REQ-IEC-001 | `mkddc-program-core` priority/interlock boundary (chưa triển khai — C3) | bypass review + fault injection + HIL | Planned |
| SEC-REQ-001 | web auth/RBAC/audit paths | security/API test | Partial |
| SEC-REQ-002 | deployment/config | secret/TLS review | Missing release evidence |
| SEC-REQ-003 | ADR-017, netcfg UDS/systemd sandbox, Web/HMI adapter boundary | peer/RBAC/audit/privilege/bypass negative tests | Target UID/interface denial and unit/socket boundary pass; broader security review still required |
| NFR-REQ-001 | service/SHM failure handling | restart/corruption scenarios | Planned |
| NFR-REQ-002 | build/test/package pipeline | reproducible release record | Planned |
| NFR-REQ-IEC-001 | `mkddc-program-core` (chưa triển khai — C3) | multi-process fault test | Planned |
| HW-REQ-001 | [hardware detail](../04_design/hardware/README.md) + schematic/BOM + iobus scaling | review + ADC/UI bench | Missing controlled evidence |
| HW-REQ-002 | [Hardware](../04_design/HARDWARE.md) | hardware gate packages | Blocked / RED |
| HW-REQ-003 | HMI source/target hardware | target integration | Partial |
| FW-REQ-MCU-001..002 | `fw/` (skeleton, chưa triển khai) | host vectors + target protocol/HIL | Missing — firmware vẫn skeleton, độc lập gate với Program Runtime |
| HMI-REQ-001 | `services/hmi`, ADR-005/015/016, HMI service design | process-loss + authority review | Partial |
| HMI-REQ-002 | shared SHM capacities, point DB, I/O screen | inventory/capability integration | Base config aligned; target evidence missing |
| HMI-REQ-003 | alarm model + local broker/alarm authority contract | ACK/reject/timeout/audit scenarios | Host implemented/tested; target restart/history record pending |
| HMI-REQ-004 | Service screen + broker boundary | RBAC/audit/unsupported-action negative test | Direct privilege removed; approved maintenance authority deferred |
| HMI-REQ-005 | communication/system/service screens | unsupported/unknown negative tests | Partial |
| HMI-REQ-006 | UX system + alarm philosophy | IEC 60073/62682 inspection + usability | Planned |
| HMI-REQ-007 | target panel test plan | controlled FAT record | Missing target evidence |
| HMI-REQ-008 | ADR-016, HMI UX and five-surface nav controller | navigation/content inspection | Host implemented/tested; target inspection pending |
| HMI-REQ-009 | broker policy projection + Control surface | whitelist/read-only/negative policy tests | Host implemented/tested; target integration pending |
| HMI-REQ-010 | local broker, `core_client.go`, core `web_ipc`/priority path | IPC/bypass/failure integration | Host dual-socket lifecycle and Core-loss/no-replay tests pass; target systemd evidence pending |
| HMI-REQ-011 | Core priority/TTL/release + Control faceplate | lifecycle/boundary/idempotency tests | Host implemented/tested; target priority/expiry scenarios pending |
| HMI-REQ-012 | broker session/RBAC/durable audit + HMI client state | auth/expiry/denial/audit tests | Host implemented/tested; deployment identity evidence pending |
| HMI-REQ-013 | HMI API client and fail-closed degradation | broker/core loss and reconnect tests | Host broker OFFLINE/reconnect and broker-restart token invalidation pass; target record pending |
| HMI-REQ-014 | UX Rev 3.1 + shared HMI styles/input paths | geometry/focus/glove/light target test | Host geometry implemented; glove/light target test pending |
| HMI-REQ-015 | versioned IPC request lifecycle | latency + duplicate request integration | Host correlation/idempotency tested; target latency record pending |
| HMI-REQ-016 | ADR-017, Service network modal, broker/netcfg clients | UC-HMI-016..019 policy/usability/target test | Host source/model/RBAC and target service path pass; connected-panel acceptance pending |
| HMI-REQ-017 | HMI network model/state machine + netcfg transaction | helper/broker loss, countdown, no-success/no-replay tests | Host fail-closed tests plus target restart/120 s rollback pass; panel countdown inspection pending |

## Quy tắc cập nhật

Khi requirement đổi, cập nhật trong cùng change: requirement text, decision nếu cần, design contract, implementation/tests, hàng traceability và changelog. Evidence phải trỏ tới artifact bất biến hoặc release record; một câu mô tả trong tài liệu không thay thế log, measurement hoặc approval.
