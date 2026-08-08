# Requirements Traceability

**ID:** TRACE-001
**Trạng thái:** Active
**Cập nhật:** 2026-08-05 (đồng bộ trạng thái Modbus RTU sau Track A và quyết định PM/CTO)

Ma trận chỉ ra vị trí thiết kế/code và loại evidence cần thu. `Planned` không phải bằng chứng pass.

Chuỗi truy vết đầy đủ riêng cho Modbus RTU (Capability → Product Requirement →
Use Case → Requirement → Design → VR → Test → Source As-Built) nằm tại
[Modbus RTU Traceability Matrix](MODBUS_RTU_TRACEABILITY_MATRIX.md).

Chuỗi normative riêng cho Programming Rev A nằm tại
[Programming Traceability Matrix](PROGRAMMING_TRACEABILITY_MATRIX.md):
Product Capability → Product Requirement → System Requirement → Verification
Requirement. Programming Design chưa được thực hiện và không có implementation
authority nào được gán trong lần đồng bộ này. ST host unit test không phải
bằng chứng runtime production.

| Requirement | Thiết kế / implementation authority | Verification | Trạng thái evidence |
|---|---|---|---|
| SYS-REQ-001 | `apps/core`, `apps/iobus`, `apps/web-api/internal/app/system.go`, systemd units | service-loss/system scenario | Partial — health endpoint host test và target process restart pass; binary mới chưa deploy |
| SYS-REQ-002 | contract capacities, `apps/iobus`, [Hardware](../04_design/HARDWARE.md) | layout + physical I/O | Partial |
| SYS-REQ-003 | `apps/core/domain/graph/graph_runtime.cpp` là As-Built legacy; migration thuộc OD-PROG-013 | compatibility/scope inspection | As-Built exists; không phải Programming evidence |
| SYS-REQ-004 | `apps/iobus` protocol adapters; Modbus RTU Device/Point config từ Web | BACnet/Modbus smoke + negative tests | Partial — RTU simulator/path host pass; RS485 slave thật còn mở |
| SYS-REQ-MBRTU-001 | [DDD-SW-MBRTU-POINT-001](../02_design/software/DDC24_MODBUS_RTU_POINT_DETAILED_DESIGN.md) — In Review | VR-MBRTU-001, 004, 011 | PARTIAL — Đ-01 chốt **một bus** nên Product/HW/source đã khớp; còn chờ schematic điều hướng RS-485 (`OD-MBRTU-EXT-04`) và evidence target/HIL |
| SYS-REQ-005 | `apps/hmi`, CMake option | enabled build + target smoke | Partial |
| SYS-REQ-PROG-001..003 | `PROD-PROG-001`, ADR-023, `REQUIREMENTS.md`; Programming Design chưa có | VR-PROG-001, VR-PROG-012, VR-PROG-013 | Documented; production evidence RED |
| SWR-REQ-001 | service entrypoints/CMake/system units | process isolation test | Planned |
| SWR-REQ-002 | core graph/priority/safety | timing + unit + fault test | Partial |
| SWR-REQ-003 | Web validators, atomic I/O bundle, Modbus profile writer và iobus config consumer | round-trip/reload/rollback test | Host implemented/tested; target power-cut và hardware apply còn mở |
| SWR-REQ-004 | `apps/web-api/internal/app/http.go` + auth middleware | API role/security tests | Partial |
| SWR-REQ-005 | ADR-017, `apps/netcfg`, Web adapter/FE, HMI broker/client | active/configured/pending/capability/management truth + negative UI/API tests | Code-local Web migration và target service/no-carrier negative path pass; real carrier/IP handoff/panel open |
| SWR-REQ-006 | `mkddc-netcfg` transaction journal/coordinator | static/DHCP/DNS/confirm/120 s rollback + restart fault tests | Target-dummy static confirm, process recovery, explicit/automatic rollback pass; physical DHCP/DNS/reboot/power/disk fault open |
| SWR-REQ-007 | netcfg + iobus BACnet address watcher + same-origin Web | multi-process continuity, BACnet `I-Am`, Web/Modbus reconnect | Target-dummy control continuity và live hot-rebind log pass; packet/Modbus/physical I/O/real-IP handoff evidence open |
| SWR-REQ-MBRTU-001..009 | DDD-SW-MBRTU-POINT-001 + [DDD-DM-MBRTU-001](MODBUS_RTU_TRACEABILITY_MATRIX.md) — mô hình Bus/Device/Point, scheduler, quality, atomic apply, write result, diagnostics | VR-MBRTU-002..009 | Design In Review bản 0.2; Track A đã đóng phần codec fail-closed, vòng đời write và lịch poll (`SWR-REQ-MBRTU-003/004/006` cải thiện); contract v2/target/HIL vẫn RED |
| SWR-REQ-MBRTU-010..011 | [DDD-BE-MBRTU-001 §6](../02_design/software/MODBUS_RTU_BE_DESIGN.md), [UX-WEB-MBRTU-001 §3.4/§5](../04_uiux/MODBUS_RTU_UI_UX_DESIGN.md) | VR-MBRTU-013 | RED — không có endpoint commissioning/import-export và không có page Mapping |
| NFR-REQ-MBRTU-004 | [DDD-FE-MBRTU-001 §5.1](../02_design/software/MODBUS_RTU_FE_DESIGN.md), [DDD-BE-MBRTU-001 §5](../02_design/software/MODBUS_RTU_BE_DESIGN.md), [DDD-FW-MBRTU-001 §11](../02_design/software/MODBUS_RTU_FW_SOM_DESIGN.md) | VR-MBRTU-014 | RED — toàn bộ số là PROPOSED, chưa đo trên target |
| NET-WEB-001 | Go netcfg adapter, OpenAPI, Network FE/E2E, [UC-WEB-NETWORK-001](../04_uiux/KX-DDC24-UC-WEB-NETWORK-001_VI.md), [UX-WEB-NETWORK-001](../04_uiux/KX-DDC24-UX-WEB-NETWORK-001_VI.md) | GET authenticated-read, POST Admin-only, strict DNS capability, authoritative UI/recovery | **Target E2E 2026-07-31 pass 38/39** trên phần cứng thật (stage/apply/confirm với kernel nhận địa chỉ, rollback last-known-good, DNS manual, RBAC viewer, reload thật) — [evidence](test-evidence/fw-som/2026-07-31-network-page-board-e2e.md). Browser reconnect sau đổi IP và packet capture vẫn open |
| NET-WEB-002 | `apps/iobus` fieldbus/BACnet telemetry → `kx_io_shm_t` (append-only) → `apps/web-api/internal/app/networkapi.go` → `NetworkPage.tsx` | Trang mạng không suy diễn: thiếu số đo hiển thị `—`/`unknown`, `bmsLink` từ cờ bind thật, per-slave metrics ghép theo địa chỉ Modbus | Unit pass (ctest/Go/vitest); target pass với 0 slave cấu hình — cần site có slave RTU thật để nghiệm thu đầy đủ bảng southbound |
| NET-WEB-003 | `apps/web-api/internal/app/reloadhelper_linux.go` + `platform/systemd/mkddc-reload-helper.service` | Lưu BACnet/WiFi phải có hiệu lực thật; allowlist unit; thông điệp lỗi dùng ngôn ngữ vận hành | Target pass 2026-07-31: `activeBacnetPort` 47808→47810 sau khi lưu |
| SWR-REQ-PROG-001..012 | Programming Design chưa thực hiện; không gán solution/process name | VR-PROG-002..012 theo ma trận Programming | Documented; production evidence RED |
| IF-REQ-001 | `contracts/iop/iop_protocol.h`, [Firmware](../04_design/FIRMWARE.md) | assertions + HIL timing/fault | Partial |
| IF-REQ-002 | `contracts/shm/mkddc_shm.h` + consumers; append-only Modbus RTU diagnostics | layout/magic tests | Implemented; 751/751 host pass, target binary mới chưa deploy |
| IF-REQ-003 | core/iobus AO path | physical-unit boundary regression + bench | Partial |
| IF-REQ-004 | [Interfaces](../04_design/INTERFACES.md), `contracts/config/netcfg_protocol_v1.schema.json` | cross-language strict fixtures + malformed/peer/state/DNS/capability tests | Contract/schema/clients code-local; target UID denial, socket permissions and allowlist pass; physical fault approval open |
| IF-REQ-PROG-001..002 | Interface Design chưa thực hiện; As-Built `st_io_map` host chưa đủ scope | VR-PROG-003, VR-PROG-007..010 | Documented; production evidence RED |
| IF-REQ-MBRTU-001..004 | DDD-SW-MBRTU-POINT-001 §9–12 — typed runtime v2, config/write IPC, REST/WS, zero-based address | VR-MBRTU-005..008, 010 | Design In Review; ABI/OpenAPI As-Built chưa conform |
| SAFE-REQ-001 | `firmware/stm32/src/app/ddc24_runtime.*` watchdog/startup safe-state, weak STM32 HAL boundary | disconnect HIL ≤200 ms | Source/host test pass; physical HIL và oscilloscope measurement còn thiếu |
| SAFE-REQ-002 | core/iobus validators | NaN/infinity/range negative tests | Partial |
| SEC-REQ-001 | web auth/RBAC/audit paths | security/API test | Partial |
| SEC-REQ-002 | deployment/config | secret/TLS review | Missing release evidence |
| SEC-REQ-003 | ADR-017, netcfg UDS/systemd sandbox, Web/HMI adapter boundary | local-HMI/Web Admin mutation + authenticated Web read, peer/RBAC/audit/bypass tests | Target UID/interface denial và unit/socket boundary pass; Web/local-HMI isolation code-local pass; target security review open |
| SEC-REQ-MBRTU-001 | DDD-SW-MBRTU-POINT-001 §10/14, ADR-021 RBAC baseline | VR-MBRTU-008, 010 | Design In Review; CRUD RBAC partial, commissioning/write audit v2 chưa có |
| NFR-REQ-001 | health endpoint, service PID/socket/SHM/MCU checks và systemd restart policy | restart/corruption scenarios | Partial — core/iobus/web SIGKILL recovery pass trên target cũ; SHM corruption và binary mới còn mở |
| NFR-REQ-002 | build provenance C++/Go/firmware, release manifest và installer | reproducible release record | Host bundle/checksum pass; worktree dirty và target provenance chưa đóng |
| NFR-REQ-MBRTU-001..003 | DDD-SW-MBRTU-POINT-001 §15–16 | VR-MBRTU-004, 011, 012 | RED — Đ-07 nâng capacity lên ≥256 (As-Built còn 64); HIL một bus chờ thiết bị (Đ-08); provenance target chưa đạt |
| NFR-REQ-PROG-001..002 | Programming Design chưa thực hiện | VR-PROG-006, VR-PROG-012 | Documented; production evidence RED |
| HW-REQ-001 | [hardware detail](../04_design/hardware/README.md) + schematic/BOM + iobus scaling | review + ADC/UI bench | Missing controlled evidence |
| HW-REQ-002 | [Hardware](../04_design/HARDWARE.md) | hardware gate packages | Blocked / RED |
| HW-REQ-003 | HMI source/target hardware | target integration | Partial |
| FW-REQ-MCU-001..002 | `firmware/stm32/src/iop`, `firmware/stm32/src/app/ddc24_runtime.*`, `firmware/stm32/Core/Src/main.c` và ARM build | host vectors + target protocol/HIL | Source/host/ARM build có; weak HAL chưa bind BSP production, target protocol/HIL và safe-state vật lý còn thiếu |
| HMI-REQ-001 | `apps/hmi`, ADR-005/015/016, HMI service design | process-loss + authority review | Partial |
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
| HMI-REQ-016 | ADR-017, surface Service network modal, broker/netcfg clients | Admin-only policy + UC-HMI-016..019 usability/target test | Host source/model/RBAC và target service path pass; Service không phải role; connected-panel acceptance pending |
| HMI-REQ-017 | HMI network model/state machine + netcfg transaction | helper/broker loss, double-confirm impact, monotonic countdown, no-success/no-replay tests | Code-local fail-closed/countdown pass plus target-dummy restart/120 s rollback; panel/physical inspection pending |

## Quy tắc cập nhật

Khi requirement đổi, cập nhật trong cùng change: requirement text, decision nếu cần, design contract, implementation/tests, hàng traceability và changelog. Evidence phải trỏ tới artifact bất biến hoặc release record; một câu mô tả trong tài liệu không thay thế log, measurement hoặc approval.
