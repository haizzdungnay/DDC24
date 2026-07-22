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

HMI host implementation đã đóng các finding về authority/control/IA/privilege ở mức
source và unit test, nhưng chưa đạt production acceptance vì thiếu process-loss,
target/HIL và usability evidence:

| Finding | Host state | Evidence còn thiếu để đóng gate |
|---|---|---|
| HMI-AUTH-001 | Broker snapshot/ACK, Core result and durable audit implemented; local ACK cannot change state | Target reject/timeout/restart/history scenarios |
| HMI-RBAC-001 | Session token, Viewer/Operator/Admin RBAC, idle expiry, rate limit and audit tests pass | Deployment UID/group and target expiry/recovery evidence |
| HMI-CTRL-001 | Policy, query, setpoint/mode/override/release, Core TTL/idempotency/winner and host dual-socket lifecycle implemented | Target priority/latency and systemd process scenarios |
| HMI-IA-001 | Five surfaces implemented; diagnostics consolidated into Service | 320×240 target focus/clipping/operator inspection |
| HMI-PRIV-001 | Static role/PIN, direct signals/reboot and `CAP_SYS_BOOT` removed; maintenance hidden | Packaging/runtime negative test on target image |
| HMI-DATA-001 | Packaged DB aligned UI16/AO4/DO4 | Capability-gate optional hardware test |
| HMI-TEL-001 | Unknown/unavailable presentation retained | Authoritative BACnet/Modbus/system telemetry integration |
| HMI-FUNC-001 | Unsupported backup/restore/restart/reboot actions hidden | Separate approved maintenance authority if product requires it |
| HMI-HW-001 | Host DRM/touch rotation tests pass | Schematic/DT/power/pin freeze and panel/touch/button/backlight target tests |
| HMI-UX-001 | Host typography/action geometry implemented | Five-surface glove/light/flood/stale/localization usability record; IEC/ISA references are guidance, not certification evidence |

## Network commissioning release gate — RED

ADR-017 helper, local-HMI broker/UI và BACnet rebind đã được implement và host-tested.
Web REST cũ vẫn chỉ ghi desired config: `applySystem()` trả `pending B7` và frontend bỏ
qua `applied=false`. Gate vẫn RED cho tới khi target/HIL và Web migration được đóng:

| Finding | Hiện trạng | Evidence cần để đóng |
|---|---|---|
| NET-AUTH-001 | Host source/tests pass; target privilege review open | Target peer denial, unit sandbox and restart/reboot evidence |
| NET-STATE-001 | Helper reports kernel active/pending separately; Web GET vẫn có thể hiển thị desired IP | Target multi-address/link/route evidence and Web migration |
| NET-TXN-001 | Fake-platform static/DHCP/confirm/rollback/deadline tests pass | Actual NetworkManager static/DHCP, disk/process/host fault evidence |
| NET-CONT-001 | Chưa có continuity evidence | Core scan, IOP/UART and STM32 output trace xuyên suốt address change/rollback |
| NET-BAC-001 | Datalink-only hot-rebind source và BACnet build pass | Target old/new/rollback packet capture, broadcast refresh and `I-Am` evidence |
| NET-HMI-001 | Service modal/client/model and Admin mutation policy host-tested | UC-HMI-016..019 on connected target panel, countdown and glove/key usability |
| NET-WEB-001 | FE toast báo saved mà không đọc apply warnings | BE transaction adapter + FE reconnect/active-pending/error E2E evidence |

Evidence packages tối thiểu: `PWR-5V`, `PWR-3V3`, `PWR-SURGE`, `AO-COMP`, `EMC`, `MFG`. Mỗi package phải có owner, setup, acceptance limit, raw result, conclusion và reviewer approval.

## Release decision

Release chỉ `GO` khi requirement bắt buộc có trace, automated suites pass, target/HIL evidence hợp lệ, security/deployment checks hoàn tất và mọi gate P0/RED được đóng hoặc có waiver được phê duyệt. Hiện tại hardware/manufacturing status là `NO-GO`.
