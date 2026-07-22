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

HMI source có skeleton khả dụng nhưng chưa đạt production acceptance:

| Finding | Nội dung cần đóng |
|---|---|
| HMI-AUTH-001 | Define upstream alarm ACK/confirm contract, durable state and audit; local-only ACK is rejected |
| HMI-RBAC-001 | Replace local role-string authorization with authoritative identity/role, timeout and action audit |
| HMI-CTRL-001 | Implement authoritative point policy and setpoint/mode/override/release path through broker/core; include effective source/priority, bounded TTL, explicit release and idempotency |
| HMI-IA-001 | Refactor legacy six-screen/tab UI to Home/Points/Control/Alarms/Service while preserving communication/system diagnostics |
| HMI-PRIV-001 | Remove static role/PIN production privilege, direct core/iobus signals, `CAP_SYS_BOOT` and direct reboot; unsupported maintenance stays disabled |
| HMI-DATA-001 | Packaged DB corrected to UI16/AO4/DO4; add regression and capability-gate optional DI |
| HMI-TEL-001 | Define BACnet/Modbus/system telemetry and explicit unknown/unavailable behavior |
| HMI-FUNC-001 | Hide or implement/test backup/restore; verify reload checksum/rollback |
| HMI-HW-001 | Freeze schematic/DT/power/pin map and pass DRM/touch/button/backlight target tests |
| HMI-UX-001 | Pass five-surface operator scenarios and panel usability targets; IEC/ISA references are guidance, not certification evidence |

Evidence packages tối thiểu: `PWR-5V`, `PWR-3V3`, `PWR-SURGE`, `AO-COMP`, `EMC`, `MFG`. Mỗi package phải có owner, setup, acceptance limit, raw result, conclusion và reviewer approval.

## Release decision

Release chỉ `GO` khi requirement bắt buộc có trace, automated suites pass, target/HIL evidence hợp lệ, security/deployment checks hoàn tất và mọi gate P0/RED được đóng hoặc có waiver được phê duyệt. Hiện tại hardware/manufacturing status là `NO-GO`.
