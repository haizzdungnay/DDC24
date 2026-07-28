# Verification and Release Gates

**ID:** VVP-001
**Trạng thái:** Active — hardware gate RED; Program Runtime gate RED, FW SOM ST host
execution opened by CTO for evidence collection (ADR-020, 2026-07-24)
**Cập nhật:** 2026-07-24

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
- HMI usability: five-surface scenario trên panel thật với Viewer/Operator/Admin session; Service là surface, không phải role. Kiểm body ≥14 px, action ≥40×40 px hoặc hard-key equivalent, glove/light, alarm flood, stale/lost data, localization và wake-event suppression.
- Protocol: BACnet/IP discovery/read/write/reliability và Modbus RTU/TCP mapping/error paths.
- System: stop/restart từng service, corrupt/stale SHM, loss of UART/network, MCU 200 ms safe timeout.
- Network commissioning: active ≠ desired, static/DHCP validation, duplicate IP, staged
  apply, confirm, 120 s auto/manual rollback, helper/host restart recovery, least
  privilege, Web reconnect, BACnet hot-rebind/`I-Am`, Modbus TCP retry và continuous
  core/IOP/STM32 trace.
- Program Runtime (ADR-020, ST+FBD): parser/semantic ST+FBD, POU/type conformance,
  standard/vendor FB golden vectors, deterministic task execution/WCET/overrun,
  artifact/activation/rollback fault injection, I/O binding/quality negative tests,
  FE authoritative state (không tự báo build/deploy thành công), RBAC/audit cho toàn bộ
  vòng đời. Không test layer nào cho LD/SFC (ngoài scope Rev A.0).

## Program Runtime release gate — RED; FW SOM ST host execution opened (ADR-020)

CTO/Project Engineering Owner đã mở next action FW SOM ST host execution ngày
2026-07-24 để tạo implementation/evidence đầu tiên trong `services/core`. Release gate
vẫn RED cho tới khi PR có kết quả build/CTest và evidence thật. Không được release/claim
`IEC 61131-3 compliant`, `conformant` hoặc `certified` cho tới khi các gate dưới đóng —
chi tiết đầy đủ ở
[`PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md`](../02_design/PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md) §14:

| Gate | Điều kiện đóng | Hiện tại |
|---|---|---|
| G0 Scope/ADR | Product + ADR + requirements phê duyệt ST+FBD trong Rev A.0. | **GREEN** — ADR-020 Accepted; `PRODUCT.md`/`SOFTWARE.md`/`DECISIONS.md`/`REQUIREMENTS.md`/`VERIFICATION.md`/`TRACEABILITY.md` cập nhật 2026-07-23; toàn bộ 31 document conflict đóng (`KX-DDC24-PROGRAM-RUNTIME-DOCUMENT-CONFLICT-REPORT-2026-07-23.md`) |
| G1 PSE | FE/Backend hỗ trợ project, ST+FBD, build/deploy thật. | RED |
| G2 Compiler | Type/POU/library/IR feature matrix pass. | RED — next action phải cung cấp ST subset/typed execution evidence đầu tiên |
| G3 Runtime | Deterministic task execution, activation, retain, fault behavior pass. | RED — next action phải chạy một ST program thật trên SOM host runtime |
| G4 I/O/MCU | Typed I/O integration + STM32 target/HIL pass. | RED |
| G5 Conformance | Normative trace matrix không open deviation trong claim scope. | RED |
| G6 Approval | Engineering/QA/Product sign-off. | RED |

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

ADR-017 helper, local-HMI broker/UI, Web transaction adapter/FE và BACnet rebind đã được
implement code-local; service/dummy-interface evidence đã có trên Orange Pi 5B. Protocol v1
khóa strict unknown-field handling, exact capability `dns|management-hostname`, optional DNS
transaction và management hostname read-only. GET transaction status dùng permission `read`;
POST mutation chỉ Admin. Code-local pass không đóng physical HIL; gate vẫn RED.

Target evidence: [KX-DDC24 HMI–FW SOM deployment record](../07_records/reviews/KX-DDC24-HMI-FWSOM-DEPLOY-2026-07-22.md).

| Finding | Hiện trạng | Evidence cần để đóng |
|---|---|---|
| NET-AUTH-001 | Strict v1 contract/capability, target unauthorized UID và `wlan0` allowlist denial, unit path/socket mode code-local/target-dummy pass | Reboot/power-loss và security approval của required capabilities |
| NET-STATE-001 | Active/configured/pending, admin/carrier/reason, DNS và management hostname shape code-local; target dummy/multi-address preservation pass | Real `end1` carrier/gateway/DNS và approved management-origin evidence |
| NET-TXN-001 | Real NetworkManager static confirm, process restart, explicit và 120 s automatic rollback pass trên isolated target interface | Physical `end1` DHCP/DNS, disk/host/power fault evidence |
| NET-CONT-001 | IOBus/Core/Web PIDs unchanged; IOP `NORMAL`, SHM fault-free/`RELIABLE` through address changes | Physical STM32/output trace and Modbus TCP reconnect |
| NET-BAC-001 | Target logs show datalink-only rebind on new/rollback addresses without iobus restart | Packet capture proving broadcast refresh and `I-Am` on real BMS segment |
| NET-HMI-001 | Surface Service; mutation Admin-only, double-confirm impact warning, monotonic countdown và confirm/rollback state code-local; target broker/helper path pass | UC-HMI-016..019 trên connected panel, countdown/glove/key usability và physical commissioning |
| NET-WEB-001 | BE adapter/FE authoritative migration, GET-read/POST-settings RBAC, active/configured/pending/DNS UI và intercepted E2E code-local pass | Browser REST/WebSocket reconnect qua stable hostname sau đổi IP thật, target failure/rollback record |
| NET-MGMT-001 | Same-origin/reconnect và hostname provisioning tool/template code-local; authority management field read-only | Install-only package verify, target `--check/--apply`, unique mDNS resolution, IP handoff và hostname rollback evidence |

Evidence packages tối thiểu: `PWR-5V`, `PWR-3V3`, `PWR-SURGE`, `AO-COMP`, `EMC`, `MFG`. Mỗi package phải có owner, setup, acceptance limit, raw result, conclusion và reviewer approval.

## Release decision

Release chỉ `GO` khi requirement bắt buộc có trace, automated suites pass, target/HIL evidence hợp lệ, security/deployment checks hoàn tất và mọi gate P0/RED được đóng hoặc có waiver được phê duyệt. Network không được claim GREEN từ host/mock/dummy-interface evidence: physical Ethernet DHCP/static/DNS, reboot/power-loss/disk fault, stable-hostname IP handoff, BACnet packet capture, Modbus reconnect, physical control continuity và connected-panel HMI vẫn mở. Hiện tại hardware/manufacturing status là `NO-GO`; Program Runtime release status là `NO-GO`.
