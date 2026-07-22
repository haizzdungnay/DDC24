# Verification and Release Gates

**ID:** VVP-001
**Trạng thái:** Active — hardware gate RED
**Cập nhật:** 2026-07-22

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

## Ma trận kiểm tra bắt buộc

- Core: 28 node types, graph validation, scan/priority/safe-state và malformed config.
- Iobus: IOP frame/CRC/timing/retry/fault, scaling, reliability, AO single conversion, SHM layout.
- Web: Go tests, frontend build/lint, auth/role, config round-trip, points/history/alarm/schedule.
- HMI build: compile/test khi enabled; DRM/input/GPIO smoke trên target.
- HMI authority: login/session expiry, policy query, setpoint/mode/override/release, effective source/priority/TTL, upstream ACK/reject/timeout, idempotency và audit.
- HMI failure: broker/core/alarm authority loss phải chuyển mutation read-only, monitoring SHM tiếp tục và không blind replay; HMI không write SHM/hardware, signal process hoặc direct reboot.
- HMI usability: five-surface scenario trên panel thật với viewer/operator/service roles, body ≥14 px, action ≥40×40 px hoặc hard-key equivalent, glove/light, alarm flood, stale/lost data, localization và wake-event suppression.
- Protocol: BACnet/IP discovery/read/write/reliability và Modbus RTU/TCP mapping/error paths.
- System: stop/restart từng service, corrupt/stale SHM, loss of UART/network, MCU 200 ms safe timeout.
- Network commissioning: active ≠ desired, static/DHCP validation, duplicate IP, staged
  apply, confirm, 120 s auto/manual rollback, helper/host restart recovery, least
  privilege, Web reconnect, BACnet hot-rebind/`I-Am`, Modbus TCP retry và continuous
  core/IOP/STM32 trace.

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
network recovery đã được chạy trên Orange Pi; production acceptance vẫn thiếu panel,
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

ADR-017 helper, local-HMI broker/UI và BACnet rebind đã được implement, deployed và
service-tested trên Orange Pi 5B.
Web REST cũ vẫn chỉ ghi desired config: `applySystem()` trả `pending B7` và frontend bỏ
qua `applied=false`. Gate vẫn RED cho tới khi physical HIL và Web migration được đóng:

Target evidence: [KX-DDC24 HMI–FW SOM deployment record](../07_records/reviews/KX-DDC24-HMI-FWSOM-DEPLOY-2026-07-22.md).

| Finding | Hiện trạng | Evidence cần để đóng |
|---|---|---|
| NET-AUTH-001 | Target unauthorized UID and `wlan0` allowlist denial pass; unit paths/socket modes verified | Reboot/power-loss and security approval of required capabilities |
| NET-STATE-001 | Target active/pending/multi-address state and management-route preservation pass | Real `end1` link/gateway evidence and Web migration |
| NET-TXN-001 | Real NetworkManager static confirm, process restart, explicit and 120 s automatic rollback pass on isolated target interface | Physical `end1` DHCP, disk/host/power fault evidence |
| NET-CONT-001 | IOBus/Core/Web PIDs unchanged; IOP `NORMAL`, SHM fault-free/`RELIABLE` through address changes | Physical STM32/output trace and Modbus TCP reconnect |
| NET-BAC-001 | Target logs show datalink-only rebind on new/rollback addresses without iobus restart | Packet capture proving broadcast refresh and `I-Am` on real BMS segment |
| NET-HMI-001 | Service modal/client/model/Admin policy host-tested; target broker/helper service path pass | UC-HMI-016..019 on connected panel, countdown and glove/key usability |
| NET-WEB-001 | FE toast báo saved mà không đọc apply warnings | BE transaction adapter + FE reconnect/active-pending/error E2E evidence |

Evidence packages tối thiểu: `PWR-5V`, `PWR-3V3`, `PWR-SURGE`, `AO-COMP`, `EMC`, `MFG`. Mỗi package phải có owner, setup, acceptance limit, raw result, conclusion và reviewer approval.

## Release decision

Release chỉ `GO` khi requirement bắt buộc có trace, automated suites pass, target/HIL evidence hợp lệ, security/deployment checks hoàn tất và mọi gate P0/RED được đóng hoặc có waiver được phê duyệt. Hiện tại hardware/manufacturing status là `NO-GO`.
