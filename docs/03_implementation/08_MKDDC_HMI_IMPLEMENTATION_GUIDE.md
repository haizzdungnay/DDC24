# 08 — `mkddc-hmi` Implementation Guide
## ADR-016 limited-operator HMI — microtask plan

**Document ID:** IMPL-HMI-MK-DDC-24
**Revision:** 2.2 — 2026-07-22
**Status:** Existing host control implementation complete; ADR-017 network HMI planned; target/HIL and usability acceptance pending
**Owners:** Core, Go backend, HMI, QA
**Design:** [SW HMI Design](../02_design/software/SW_HMI_DESIGN_MK-DDC-24_VI.md)
**UX/UC:** [UX](../04_uiux/KX-DDC24-UX-HMI-001_VI.md) · [Use cases](../04_uiux/KX-DDC24-UC-HMI-001_VI.md)

## 1. Outcome

Refactor the existing six-screen service-panel skeleton into the selected five-surface
local HMI:

```text
Home → Points → Control → Alarms → Service
```

Add authoritative setpoint/mode/override/release and alarm ACK without putting HMI in
the control path. Telemetry remains read-only SHM. Mutation goes through a local
authenticated broker and existing/extended core IPC. Web UI/frontend is out of scope.

ADR-017 adds one narrow Service workflow: inspect active/pending Ethernet state and
request static/DHCP apply, confirm or rollback through the broker and SOM network
authority. This does not add a sixth surface or general engineering to the panel.

## 2. Non-negotiable rules

1. `mkddc-hmi` must never write command fields in SHM or hardware.
2. `mkddc-core` remains priority/interlock/safe-state authority.
3. `mkddc-web` backend owns local identity/RBAC/policy/audit broker; no browser is
   involved in the local HMI flow.
4. Local `point_db.json` is presentation metadata, not authorization.
5. Broker/core loss makes mutation read-only; do not queue blind replay.
6. No SHM ABI change is planned. If implementation discovers one is unavoidable,
   stop and open a separate contract decision/migration task.
7. Remove direct HMI reboot/signal privilege before enabling production Service action.
8. Each microtask is merged only with its unit tests, doc/trace impact and changelog
   entry for that work session.
9. HMI must not open the privileged network-authority socket, invoke `ip`/`networkctl`
   or edit Linux network files. It uses the authenticated broker only.

## 3. Existing source to preserve

| Capability | Existing owner/source |
|---|---|
| SHM read/magic/seqlock | `services/hmi/data/shm_reader.*` |
| DRM/LVGL/input/buttons | `services/hmi/drm`, `input`, `ui` |
| Core manual command socket | `services/core/web_ipc.*` |
| Priority arbitration | `services/core/priority_resolver.*`, `scan_loop.*` |
| Go core client | `web/backend/core_client.go` |
| Current alarm ring | `services/hmi/screens/alarm_model.cpp` |
| Current direct maintenance hooks | `services/hmi/platform/core_control.*` — to retire from production path |

Do not rewrite unrelated frontend or I/O work. Refactor existing HMI components in
small vertical slices.

### 3.1 Execution snapshot — 2026-07-22

| Slice | Host status | Evidence / remaining work |
|---|---|---|
| HOP-000..005 | Complete | Versioned JSON schema, reason/result vocabulary, point policy, RBAC/session and audit record frozen. |
| HOP-010..019 | Complete | Go UDS broker, peer credentials, login/logout, expiry/rate limit, policy, idempotency, durable audit, alarm snapshot/ACK and broker tests. |
| HOP-020..027 | Complete | Core query, validation, bounded TTL/release, idempotency and authoritative winner response with Core CTest coverage. |
| HOP-030..035 | Source complete; component coverage partial | Bounded C++ client, session/policy state and authoritative alarm refresh/ACK are implemented. Direct client/alarm tests pass; a fake-clock command-state suite remains part of HOP-073. |
| HOP-040..050 | Source complete; target coverage open | Five surfaces, Control confirmation, explicit setpoint/release, authoritative source/TTL display, EN/VI labels, 14 px body text and 40 px action geometry are implemented. Screen-state fixtures plus panel clipping/glove/light evidence remain open. |
| HOP-060..063 | Complete | Static PIN/role, direct signal/reboot hooks and `CAP_SYS_BOOT` removed; unsupported maintenance actions hidden. |
| HOP-064 | Deferred by design | Requires a separate approved privileged-maintenance architecture; it is not needed for Control or alarm ACK. |
| HOP-070..072 | Complete | HMI warnings-as-errors build/unit suite, Go vet/test/race subset and Core CTest recorded. |
| HOP-073 | Host complete | Real broker UDS plus real `CoreClient` against a deterministic Core socket stub covers login/policy/override/query/release; the C++ client independently covers broker loss/reconnect. Target orchestration remains open. |
| HOP-074 | Host simulation complete; target open | Core socket loss proves cached reject/no blind replay and explicit new-ID retry; broker restart invalidates the old session. systemd/target process-loss evidence is still required. |
| HOP-075..077 | Open | Target display/input, operator usability and final release-gate evidence are not available. HMI production gate remains **RED**. |
| HNW-000..013 | Planned | ADR-017 Ethernet status/static/DHCP/confirm/rollback; depends on frozen SOM contract and BE broker adapter. No source implementation yet. |

The verification host identified on 2026-07-22 is an x86_64 Lenovo ThinkStation with
a PCI DRM device, no `/proc/device-tree/model`, and no active `mkddc-*` services. It is
not the RK3566/JD9852/FT5436 target and must not be used to close HOP-075/076.

Implementation artifacts are `shared/hmi_protocol_v1.schema.json`,
`web/backend/hmi_broker.go`, `web/backend/hmi_audit_store.go`,
`services/core/web_ipc.*`, `services/core/scan_loop.*`,
`services/hmi/api/hmi_api_client.*` and `services/hmi/screens/screen_control.*`.
Host results do not establish IEC conformity or replace target/HIL acceptance.

## 4. Dependency map

```text
P0 contract/policy
   ├─► P1 Go local broker ─► P3 HMI client/model ─► P4 five-surface UI
   └─► P2 core TTL/query/idempotency ──────────────┘

P1 + P2 + P4 ─► P5 privilege removal ─► P6 integration/target acceptance

NWC contract/SOM authority ─► BE broker adapter ─► HNW local-HMI client/UI ─► target recovery test
```

Only one contract owner edits a shared message shape at a time. Core and HMI UI work
may proceed in parallel only after P0 is frozen.

## 5. Microtasks

### P0 — Freeze contracts and fixtures

#### HOP-000 — Capture current HMI regression baseline

- **Files:** no production edit; current HMI tests and screenshots/logs.
- **Output:** exact build/test commands, source commit/worktree note, current six-screen
  behavior and known failures.
- **Verify:** run direct HMI host suite; record target tests as not run if unavailable.
- **Depends:** none.
- **Done:** baseline exists before refactor; historical pass is not called release evidence.

#### HOP-001 — Freeze local UDS envelope

- **Files:** `docs/04_design/INTERFACES.md`, then shared test fixtures under
  `web/backend/testdata/` and `services/hmi/tests/fixtures/`.
- **Output:** schema version, maximum frame size, action enum, request/response fields.
- **Verify:** the same valid/invalid fixture is parsed by Go and C++ tests.
- **Depends:** HOP-000.
- **Done:** unknown version/action/oversized/malformed frames have stable rejection.

#### HOP-002 — Freeze reason codes and lifecycle enums

- **Files:** new generated-or-duplicated constants with a single checked fixture;
  likely `web/backend/hmi_protocol.go`, `services/hmi/platform/hmi_protocol.hpp`.
- **Output:** `accepted/rejected/timeout`, command lifecycle and stable reason codes.
- **Verify:** cross-language golden JSON equality test.
- **Depends:** HOP-001.
- **Done:** UI text is mapped from stable codes, not parsed server strings.

#### HOP-003 — Freeze authoritative point-policy projection

- **Files:** `web/backend/hmi_policy.go`, config/schema owner selected after inspection,
  fixtures and validator tests.
- **Output:** commandable, allowed actions, role, min/max/unit, priority, default/max
  TTL, reason/audit requirements and revision.
- **Verify:** missing/non-finite/inverted range/unknown action/TTL overflow rejected.
- **Depends:** HOP-001.
- **Done:** local point DB cannot grant permission; authority projection is testable.

#### HOP-004 — Freeze role matrix and session limits

- **Files:** auth policy docs and `web/backend/hmi_session.go` test table.
- **Output:** Viewer/Operator/Service permissions, idle expiry ≤15 minutes, logout and
  lockout behavior.
- **Verify:** table-driven allow/deny matrix includes unknown/expired session.
- **Depends:** HOP-003.
- **Done:** no production privilege derives from `hmi.conf` role/PIN.

#### HOP-005 — Freeze audit record schema

- **Files:** `web/backend/hmi_audit.go`, migration/store tests.
- **Output:** actor, role, request ID, action, target, requested/effective old/new,
  reason, TTL, result, reason code and time quality.
- **Verify:** accepted, rejected, timeout, login and logout records round-trip.
- **Depends:** HOP-002, HOP-004.
- **Done:** secrets/credential material never enter audit.

### P1 — Go local auth/audit broker

#### HOP-010 — Add local socket lifecycle

- **Files:** new `web/backend/hmi_ipc.go`, `web/backend/hmi_ipc_test.go`, startup/shutdown
  wiring in the existing backend entrypoint.
- **Output:** bounded Unix socket listener with clean unlink/start/stop behavior.
- **Verify:** start/stop/restart, stale socket, bind failure and goroutine cleanup tests.
- **Depends:** HOP-001.
- **Done:** broker failure does not stop HTTP/core processes and reports actionable log.

#### HOP-011 — Enforce filesystem and peer credentials

- **Files:** `hmi_ipc.go`, packaging tmpfiles/systemd permissions.
- **Output:** restrictive owner/group/mode plus peer credential validation.
- **Verify:** allowed HMI user connects; wrong UID/group and world access fail.
- **Depends:** HOP-010.
- **Done:** possession of socket path alone does not grant mutation.

#### HOP-012 — Implement login/logout session issue

- **Files:** `web/backend/hmi_session.go`, tests.
- **Output:** authenticate against existing user store; return opaque token/role/expiry;
  logout revokes token.
- **Verify:** success, bad credential, locked user, disabled user and logout cases.
- **Depends:** HOP-004, HOP-010.
- **Done:** no password/token is logged or stored in HMI config.

#### HOP-013 — Implement idle expiry and rate limiting

- **Files:** `hmi_session.go`, fake-clock tests.
- **Output:** configurable idle limit capped at 15 minutes and bounded login attempts.
- **Verify:** exact boundary, clock advance, concurrent use and expired token denial.
- **Depends:** HOP-012.
- **Done:** expiry is deterministic and does not depend on wall-clock jumps.

#### HOP-014 — Implement point policy query

- **Files:** `hmi_policy.go`, config consumer/validator and tests.
- **Output:** revisioned projection containing only operator-visible fields.
- **Verify:** Viewer can query; missing/invalid policy returns non-commandable state.
- **Depends:** HOP-003, HOP-012.
- **Done:** HMI can construct Control without trusting `point_db.json`.

#### HOP-015 — Validate mutation envelope and RBAC

- **Files:** `hmi_ipc.go`, `hmi_policy.go`, tests.
- **Output:** action/role/point/range/reason/TTL validation before core call.
- **Verify:** table-driven allow/deny tests for every action and boundary.
- **Depends:** HOP-013, HOP-014.
- **Done:** invalid input is rejected with stable code and no core side effect.

#### HOP-016 — Add request idempotency cache

- **Files:** new `web/backend/hmi_idempotency.go`, fake-clock tests.
- **Output:** bounded TTL/LRU result cache keyed by actor/session/request ID.
- **Verify:** duplicate returns same result; conflicting payload with same ID rejects;
  cache remains bounded.
- **Depends:** HOP-002, HOP-015.
- **Done:** duplicate transport retry cannot double-actuate.

#### HOP-017 — Forward point command through existing core client

- **Files:** `web/backend/core_client.go`, `hmi_ipc.go`, tests with fake core.
- **Output:** setpoint/mode/override/release translation and authoritative response.
- **Verify:** accepted/rejected/timeout/core-disconnect cases; context cancellation bound.
- **Depends:** HOP-015, P2 command support.
- **Done:** broker never writes SHM and does not report success before core response.

#### HOP-018 — Persist audit for all mutation outcomes

- **Files:** `hmi_audit.go`, current SQLite/store migration owner, tests.
- **Output:** transactionally record attempt/result with request ID.
- **Verify:** accepted, rejected, timeout and duplicate behavior; DB failure fails closed.
- **Depends:** HOP-005, HOP-015.
- **Done:** audit failure cannot silently allow an audit-required action.

#### HOP-019 — Expose alarm snapshot and ACK

- **Files:** new `web/backend/hmi_alarm.go`, alarm store/handler integration, tests.
- **Output:** authoritative snapshot plus idempotent ACK response/audit.
- **Verify:** active/unacked, active/acked, cleared states, stale ID, role deny, timeout.
- **Depends:** HOP-012, HOP-016, HOP-018.
- **Done:** ACK never clears active condition and local restart can rehydrate state.

### P2 — Core authoritative command lifecycle

#### HOP-020 — Extend core IPC request ID and stable result

- **Files:** `services/core/web_ipc.*`, `tests/test_web_ipc.cpp`.
- **Output:** bounded UUID/string ID support and stable result/reason fields while
  preserving compatibility for existing numeric clients.
- **Verify:** old request fixtures still pass; malformed/new requests fail explicitly.
- **Depends:** HOP-001, HOP-002.
- **Done:** compatibility/migration behavior is documented and tested.

#### HOP-021 — Implement authoritative control-state query

- **Files:** `web_ipc.*`, `priority_resolver.*`, tests.
- **Output:** effective value/source/priority and manual override expiry for a point.
- **Verify:** default/graph/manual/BACnet/safety winner cases.
- **Depends:** HOP-020.
- **Done:** HMI need not infer winner from last command.

#### HOP-022 — Validate setpoint and mode operations

- **Files:** `web_ipc.*`, point table/policy adapter selected by code owner, tests.
- **Output:** finite/range/type validation and explicit setpoint/mode result.
- **Verify:** min/max, NaN/infinity, wrong type, read-only point and interlock cases.
- **Depends:** HOP-020.
- **Done:** no unsafe coercion or direct output bypass.

#### HOP-023 — Add bounded override TTL state

- **Files:** `priority_resolver.*` or a focused manual-command owner, scan-loop wiring,
  fake-monotonic-clock tests.
- **Output:** accepted override with expiry; automatic release at TTL.
- **Verify:** zero/max/overflow TTL, scan across expiry, restart policy and priority winner.
- **Depends:** HOP-021, HOP-022.
- **Done:** no indefinite default and no wall-clock dependence.

#### HOP-024 — Implement explicit release semantics

- **Files:** `web_ipc.*`, `priority_resolver.*`, tests.
- **Output:** release removes only the actor/source slot and reports the new winner.
- **Verify:** release active, already released, expired and higher-priority winner cases.
- **Depends:** HOP-023.
- **Done:** release never writes a replacement process value.

#### HOP-025 — Add core idempotency protection

- **Files:** `web_ipc.*`, bounded cache helper, tests.
- **Output:** duplicate request ID returns prior result without repeated mutation.
- **Verify:** duplicate same/different payload, cache expiry and memory bound.
- **Depends:** HOP-020, HOP-024.
- **Done:** protection remains even if broker retries after uncertain delivery.

#### HOP-026 — Report safety/interlock/priority outcome

- **Files:** `scan_loop.*`, `web_ipc.*`, tests.
- **Output:** distinguish request accepted from effective winner and provide reason code.
- **Verify:** safety, interlock, BACnet/manual and default conflicts.
- **Depends:** HOP-021, HOP-024.
- **Done:** UI can truthfully show accepted-but-not-effective command.

#### HOP-027 — Define restart/recovery of manual TTL state

- **Files:** state snapshot owner and tests; do not persist unless decision approves it.
- **Output:** explicit fail-safe policy for core restart while override exists.
- **Verify:** restart before/at/after expiry and corrupted snapshot.
- **Depends:** HOP-023.
- **Done:** behavior is deterministic, documented and audited; no accidental indefinite hold.

### P3 — HMI IPC client and presentation models

#### HOP-030 — Add bounded HMI API transport

- **Files:** new `services/hmi/api/hmi_api_client.*`, CMake and tests.
- **Output:** connect/send/receive with max frame, deadline and request correlation.
- **Verify:** partial read/write, malformed frame, oversized frame, disconnect and timeout.
- **Depends:** HOP-001, HOP-002, HOP-010.
- **Done:** transport has no unbounded block/allocation loop.

#### HOP-031 — Add broker availability/read-only state

- **Files:** HMI client/model and global status badge tests.
- **Output:** reconnect with bounded backoff; mutation disabled when unavailable.
- **Verify:** broker stop/start during idle and Pending; no blind replay.
- **Depends:** HOP-030.
- **Done:** SHM monitoring continues while command surfaces are read-only.

#### HOP-032 — Add session model

- **Files:** new `services/hmi/data/session_model.*`, tests.
- **Output:** login/logout/token/role/expiry state without persisting credential.
- **Verify:** success/deny/expiry/logout/reconnect; secret-redaction inspection.
- **Depends:** HOP-012, HOP-030.
- **Done:** static config role/PIN no longer grants production actions.

#### HOP-033 — Add authoritative point-control model

- **Files:** new `services/hmi/data/control_model.*`, tests.
- **Output:** policy projection, effective state, source, priority and expiry cache.
- **Verify:** invalid/missing policy becomes non-commandable; revision refresh revokes UI.
- **Depends:** HOP-014, HOP-030.
- **Done:** Control list derives only from authority projection.

#### HOP-034 — Add command UI state machine

- **Files:** `control_model.*`, tests with fake clock/transport.
- **Output:** Editing/Confirming/Pending/Accepted/Rejected/Timeout/Unknown/Expired/Released.
- **Verify:** every transition including timeout-query and duplicate response.
- **Depends:** HOP-031, HOP-033.
- **Done:** no optimistic effective-state update.

#### HOP-035 — Replace volatile alarm authority model

- **Files:** refactor `screens/alarm_model.*`, tests.
- **Output:** snapshot hydration, stream update, ACK pending/result and gap handling.
- **Verify:** restart hydrate, duplicate event, stale alarm, ACK reject/timeout.
- **Depends:** HOP-019, HOP-030.
- **Done:** local ring is cache only; ACK calls authority.

### P4 — Five-surface LVGL UI

#### HOP-040 — Refactor navigation from six to five surfaces

- **Files:** `services/hmi/ui/nav_controller.*`, `main.cpp`, nav tests.
- **Output:** Home/Points/Control/Alarms/Service ring and large page chooser.
- **Verify:** touch and all six keys reach every surface; first-input wake suppression.
- **Depends:** HOP-000.
- **Done:** no narrow six-tab strip remains.

#### HOP-041 — Refactor Home summary

- **Files:** `screens/screen_home.*`, tests.
- **Output:** state/data/alarm/I/O/control/service/communication summaries.
- **Verify:** 30-second scenario fixture; missing telemetry renders unavailable.
- **Depends:** HOP-040, HOP-031, HOP-035.
- **Done:** highest-priority alarm and active override count are visible.

#### HOP-042 — Rename/refactor I/O screen to Points

- **Files:** `screen_io.*` renamed only if safe, point list tests.
- **Output:** All/Bad/Stale/Overridden filters and read-only detail.
- **Verify:** UI16/AO4/DO4, optional capability, quality/age and no input command action.
- **Depends:** HOP-040, existing SHM reader.
- **Done:** selecting commandable point navigates without executing command.

#### HOP-043 — Build Control list

- **Files:** new `screens/screen_control.*`, CMake/main/nav and tests.
- **Output:** authority-whitelisted list with value/mode/source/priority/expiry.
- **Verify:** policy add/remove/revision and read-only broker state.
- **Depends:** HOP-033, HOP-040.
- **Done:** no locally configured point can appear commandable by itself.

#### HOP-044 — Build point faceplate read state

- **Files:** `screen_control.*`, tests.
- **Output:** effective value, feedback, quality, mode, source, priority and expiry.
- **Verify:** unavailable fields, clipping, focus and hard-key navigation.
- **Depends:** HOP-043.
- **Done:** accepted command and effective winner are visually distinct.

#### HOP-045 — Add setpoint and mode edit flow

- **Files:** `screen_control.*`, numeric/select widgets, tests.
- **Output:** edit → old/new/range confirm → pending → result.
- **Verify:** min/max, cancel, reject, timeout and session expiry during edit.
- **Depends:** HOP-034, HOP-044, HOP-017.
- **Done:** no command fires before explicit confirm.

#### HOP-046 — Add override/reason/TTL/release flow

- **Files:** `screen_control.*`, locale strings and tests.
- **Output:** bounded TTL selection, required reason, override badge/expiry and release.
- **Verify:** empty reason, TTL limits, expiry, release, higher-priority winner.
- **Depends:** HOP-023, HOP-024, HOP-045.
- **Done:** indefinite default is impossible and release shows new authoritative winner.

#### HOP-047 — Refactor Alarms surface

- **Files:** `screen_alarm.*`, `alarm_model.*`, tests.
- **Output:** priority/state/time/source/message/response, filters and pending ACK.
- **Verify:** accepted/rejected/timeout, active count, alarm flood ordering.
- **Depends:** HOP-035, HOP-040.
- **Done:** ACK is disabled before hydration or without valid authority/session.

#### HOP-048 — Consolidate Communication/System into Service

- **Files:** refactor/reuse `screen_comm.*`, `screen_system.*`, `screen_service.*`.
- **Output:** summary/detail sections without loss of existing diagnostics.
- **Verify:** each unsupported field is unavailable, never default-OK.
- **Depends:** HOP-040.
- **Done:** five-surface navigation retains required communication/system information.

#### HOP-049 — Enforce typography, targets and focus

- **Files:** shared HMI style/component helpers and visual/unit tests.
- **Output:** body ≥14 px, actions ≥40×40 px or hard-key equivalent, visible focus.
- **Verify:** static geometry assertions plus target glove/light inspection.
- **Depends:** HOP-041..048.
- **Done:** no production action button remains at legacy 22–29 px size.

#### HOP-050 — Complete EN/VI strings and clipping tests

- **Files:** `services/hmi/i18n/locale.*`, all five screens, tests.
- **Output:** translated lifecycle/reason/session/override/alarm strings.
- **Verify:** missing-key, UTF-8 and 320×240 clipping fixtures; visual target test.
- **Depends:** HOP-041..049.
- **Done:** locale change does not alter session/command state.

### P5 — Remove unsafe direct privilege

#### HOP-060 — Remove static role/PIN authorization

- **Files:** `main.cpp`, `screen_service.*`, `packaging/hmi.conf`, tests.
- **Output:** production mutation uses SessionModel only; prototype path removed or
  compile-time test-only.
- **Verify:** `role=admin` and `service_pin=` cannot unlock production action.
- **Depends:** HOP-032, HOP-048.
- **Done:** HMI-REQ-012 is enforced by source, not only UI text.

#### HOP-061 — Remove direct core/iobus signals

- **Files:** retire `CoreControl::reload_services/restart_services`, callers and tests.
- **Output:** Service displays maintenance unavailable until a separately approved
  broker action exists; it never signals a process directly.
- **Verify:** repository scan finds no HMI `kill()`/raw process signal path.
- **Depends:** HOP-048.
- **Done:** presentation cannot directly stop core/iobus.

#### HOP-062 — Remove direct reboot capability

- **Files:** `core_control.*`, `mkddc-hmi.service`, packaging tests.
- **Output:** remove `reboot()` and `CAP_SYS_BOOT`; reboot remains disabled until an
  approved maintenance authority implements the full handshake.
- **Verify:** unit file capability scan and negative runtime test.
- **Depends:** HOP-061.
- **Done:** HMI cannot reboot host directly.

#### HOP-063 — Hide unsupported maintenance actions

- **Files:** `screen_service.*`, tests.
- **Output:** backup/restore/restart/reboot shown only when broker capability query says
  implemented and permitted; otherwise hidden/disabled with reason.
- **Verify:** every capability combination and authority loss.
- **Depends:** HOP-048, HOP-062.
- **Done:** no button calls a false/no-op callback while appearing functional.

#### HOP-064 — Implement approved maintenance authority separately

- **Files:** to be chosen by an explicit security/architecture review; do not grant
  broad privilege to HMI or core.
- **Output:** allowlisted one-shot maintenance operation with core safe-state handshake,
  audit and result.
- **Verify:** role deny, safe-state reject, timeout, partial failure and recovery on target.
- **Depends:** HOP-018, HOP-026, HOP-062.
- **Done:** only after separate approval; not required to enable point Control/ACK.

### P6 — Verification and release evidence

#### HOP-070 — Run HMI warnings-as-errors build and unit suite

- **Files:** isolated temporary build only; test updates belong with prior tasks.
- **Output:** exact command/result/toolchain record for HMI-enabled build.
- **Verify:** all HMI tests pass; no claim about target/HIL.
- **Depends:** HOP-030..063.
- **Done:** repeatable host result recorded.

#### HOP-071 — Run Go broker tests and vet

- **Files:** no production edit beyond discovered fixes.
- **Output:** `go test ./...`, race subset where supported, `go vet ./...`.
- **Verify:** auth/RBAC/audit/idempotency/session fake-clock suites included.
- **Depends:** HOP-010..019.
- **Done:** exact result recorded; failed/skipped checks stated.

#### HOP-072 — Run core command/priority tests

- **Files:** isolated build only.
- **Output:** core unit suite covering query/setpoint/mode/TTL/release/idempotency/safety.
- **Verify:** warnings-as-errors and CTest exact result.
- **Depends:** HOP-020..027.
- **Done:** no regression to existing Web/BACnet command behavior.

#### HOP-073 — Add broker–core–HMI IPC integration suite

- **Files:** test harness under existing service test structure.
- **Output:** full local path with fake clock and deterministic process control.
- **Verify:** accept/reject/timeout/duplicate/reconnect/session-expiry/TTL/release/audit.
- **Depends:** HOP-017, HOP-027, HOP-034, HOP-035.
- **Done:** no direct SHM mutation and no blind replay demonstrated.

#### HOP-074 — Add process-loss fault suite

- **Files:** integration harness/runbook.
- **Output:** stop broker/core/HMI at each command state and verify recovery.
- **Verify:** control continuity, read-only degradation, authoritative resync.
- **Depends:** HOP-073.
- **Done:** each failure boundary has an evidence record.

#### HOP-075 — Execute target display/input acceptance

- **Files:** immutable evidence record, not a design claim.
- **Output:** DRM/DSI, ≥10 FPS, FT5436, six buttons, first-input wake, backlight and
  cold/restart recovery results on identified hardware revision.
- **Verify:** raw logs/photos/video/hash/reviewer as defined by Verification.
- **Depends:** HOP-049, HOP-050, hardware integration gate.
- **Done:** target evidence exists; host tests cannot substitute.

#### HOP-076 — Execute operator usability scenarios

- **Files:** controlled test record.
- **Output:** UC-HMI-001..015 results with Viewer/Operator/Service, glove/light,
  alarm flood, stale/loss, setpoint, override/release and localization.
- **Verify:** acceptance criteria and observed issues signed by tester/reviewer.
- **Depends:** HOP-073, HOP-075.
- **Done:** HMI-REQ-006/007/014/015 evidence is reviewable.

#### HOP-077 — Close traceability and release gate

- **Files:** `docs/05_verification/VERIFICATION.md`,
  `docs/07_records/TRACEABILITY.md`, release evidence and `CHANGELOG.md`.
- **Output:** every requirement maps to real tests/results; remaining gaps explicit.
- **Verify:** docs/link harness and `git diff --check`.
- **Depends:** HOP-070..076.
- **Done:** HMI gate changes from RED only with current approved target/security evidence.

### P7 — ADR-017 local Ethernet commissioning

This phase is planned work. `NWC-*` SOM tasks are owned in
[22 — SOM Source Implementation Plan](22_SOM_SRC_IMPLEMENTATION_PLAN.md). Go broker
and Web FE are separate-team dependencies; HMI implementation must not invent their
contract or call `mkddc-netcfg` directly.

**Schedule baseline (một HMI engineer):** H0 `HNW-000..003` 1–2 ngày sau NWC contract;
H1 `HNW-004..009` 3–4 ngày với fake broker; H2 `HNW-010..011` 2–3 ngày; H3 `HNW-012`
2–3 ngày sau NWC-016 + BE adapter; H4 `HNW-013` 2–3 ngày trên target. Đây là effort
estimate, không phải release commitment; exit gate quan trọng hơn ngày lịch.

#### HNW-000 — Freeze HMI network fixtures

- **Files:** controlled interface docs; future fixtures under existing HMI test tree.
- **Output:** golden request/response/state/reason fixtures for `network_status`,
  `network_validate`, `network_stage`, `network_apply`, `network_confirm`, rollback.
- **Verify:** fixtures validate against broker extension and SOM `netcfg` schema.
- **Depends:** NWC-000..003 and BE contract owner approval.
- **Done:** active/pending/last-known-good and all terminal states are unambiguous.

#### HNW-001 — Add read-only network presentation model

- **Files:** future `services/hmi/data/network_model.*` and tests.
- **Output:** bounded model for link, active IPv4/prefix/gateway/mode, transaction,
  deadline and last result; no config-file inference.
- **Verify:** parse normal/missing/malformed/stale/unknown fields and clock countdown.
- **Depends:** HNW-000.
- **Done:** desired value can never overwrite active value in presentation state.

#### HNW-002 — Add Network section under Service

- **Files:** `services/hmi/screens/screen_service.*`, navigation/focus tests.
- **Output:** read-only summary/detail; no sixth surface.
- **Verify:** Viewer can inspect; unavailable authority shows `UNAVAILABLE`, not `OK`.
- **Depends:** HNW-001.
- **Done:** existing system/communication diagnostics remain reachable.

#### HNW-003 — Gate configuration by Service session

- **Files:** Service/network presenter and session-policy tests.
- **Output:** Configure appears only for authoritative Service capability/session.
- **Verify:** Viewer/Operator/expired/unknown/broker-offline all deny mutation.
- **Depends:** HNW-002 and BE broker capability projection.
- **Done:** local metadata/config cannot grant network privilege.

#### HNW-004 — Implement static IPv4 editor

- **Files:** Service network form, numeric keyboard helpers, locale and tests.
- **Output:** IPv4, subnet/prefix and gateway editor with cancel/back behavior.
- **Verify:** valid boundaries, malformed octet/mask, network/broadcast/loopback and
  clipping/hard-key cases; authority still revalidates.
- **Depends:** HNW-003.
- **Done:** no request is emitted before explicit confirmation.

#### HNW-005 — Implement DHCP selection

- **Files:** same form/model/tests.
- **Output:** explicit DHCP choice and explanation that lease/address may change.
- **Verify:** mode switch does not retain/send stale static fields ambiguously.
- **Depends:** HNW-003.
- **Done:** returned active lease is authoritative; candidate is never shown as lease.

#### HNW-006 — Add impact confirmation

- **Files:** confirmation overlay, localization and geometry tests.
- **Output:** old/new/mode, Web/BACnet reconnect warning and hold-to-confirm.
- **Verify:** cancel, session expiry, duplicate ENTER/touch and first-wake suppression.
- **Depends:** HNW-004, HNW-005.
- **Done:** one user confirmation produces one idempotent stage/apply transaction.

#### HNW-007 — Render apply lifecycle and countdown

- **Files:** network model/screen and fake-monotonic-clock tests.
- **Output:** staged/applying/awaiting-confirmation/confirmed/failed/rolling-back/
  rolled-back states with transaction ID and rollback countdown.
- **Verify:** out-of-order/duplicate response, reconnect and deadline boundary.
- **Depends:** HNW-001, HNW-006 and BE adapter.
- **Done:** only `confirmed` is presented as applied success.

#### HNW-008 — Implement explicit confirm and rollback actions

- **Files:** network screen/client tests.
- **Output:** transaction-bound Confirm/Rollback with pending/result states.
- **Verify:** wrong/stale ID, duplicate action, timeout, automatic rollback race.
- **Depends:** HNW-007.
- **Done:** no blind retry and final state is re-queried from authority.

#### HNW-009 — Add recovery guidance

- **Files:** Service messages/help and locale tests.
- **Output:** show active address for Web reconnect, rollback outcome and field-service
  instruction when both active address and authority are unavailable.
- **Verify:** static success, DHCP lease, auto rollback and failed rollback fixtures.
- **Depends:** HNW-007, HNW-008.
- **Done:** message never claims a rescue address unless deployment authority reports it.

#### HNW-010 — Complete EN/VI and 320×240 interaction QA

- **Files:** locale/style/focus tests for the new Service flow.
- **Output:** all labels/reason codes translated; ≥14 px body and ≥40×40 action or
  full six-button equivalent.
- **Verify:** missing key, UTF-8, clipping, focus, touch and key-only traversal.
- **Depends:** HNW-002..009.
- **Done:** every state/action is usable without color-only meaning.

#### HNW-011 — Add HMI unit/component suite

- **Files:** existing `services/hmi/tests` structure.
- **Output:** deterministic model, state-machine, form and screen coverage.
- **Verify:** warnings-as-errors HMI build/test with fake clock/transport.
- **Depends:** HNW-001..010.
- **Done:** normal, boundary, malformed and failure paths pass on host.

#### HNW-012 — Add broker/network-authority integration harness

- **Files:** existing integration harness; no direct HMI-to-netcfg shortcut.
- **Output:** HMI → real broker adapter → deterministic netcfg stub/full service.
- **Verify:** role deny, duplicate, apply/confirm, timeout/rollback, broker/helper loss,
  reconnect and audit correlation by transaction/request ID.
- **Depends:** HNW-011, NWC-016 and BE adapter completion.
- **Done:** integration proves HMI cannot mutate OS or bypass broker.

#### HNW-013 — Execute target commissioning/recovery acceptance

- **Files:** immutable target evidence and traceability only.
- **Output:** UC-HMI-016..019 on RK3566/panel with Ethernet peer/BMS traffic.
- **Verify:** glove/light/key-only use, old/new IP, DHCP, duplicate-IP reject, 120 s
  rollback, helper/broker restart, BACnet rediscovery and uninterrupted control trace.
- **Depends:** HNW-012, NWC-017, HOP-075.
- **Done:** reviewed evidence closes network-HMI findings; host pass is insufficient.

## 6. Recommended implementation order

1. HOP-000..005 — contract freeze.
2. HOP-020..027 and HOP-010..019 — core and broker, with golden fixtures shared.
3. HOP-030..035 — HMI transport/models.
4. HOP-040..050 — five-surface UI.
5. HOP-060..063 — privilege removal before production enablement.
6. HOP-070..077 — integration, target and usability gates.
7. HOP-064 only after a separate privileged-maintenance approval.
8. NWC-000..017 prepares SOM first; then BE broker adapter; then HNW-000..013. Web FE
   can integrate independently against the same transaction API after contract freeze.

The first demonstrable vertical slice should be: login → query one commandable point →
setpoint accepted/rejected → audit → HMI authoritative result. Do not start visual
polish before this slice proves the control boundary.

## 7. Definition of Done for the feature

- Five surfaces replace the legacy six-screen navigation.
- Monitoring continues with broker unavailable; mutation is read-only.
- Only authority-whitelisted points can be operated.
- Setpoint/mode/override/release are range/role/policy/priority/TTL validated and audited.
- ACK is authoritative and does not clear active alarm.
- Session expires fail-closed; local role/PIN cannot grant production privilege.
- HMI has no direct SHM write, hardware write, process signal or reboot capability.
- Host, integration, target and usability evidence is current and traceable.
- Unimplemented maintenance actions are not represented as working.
- Ethernet configuration is Service-only, transaction-backed and distinguishes active
  from pending; automatic rollback and control continuity have target evidence.
- Controlled docs, traceability and changelog are updated with the implementation.

## Revision history

| Revision | Date | Change |
|---|---|---|
| 1.2 | 2026-07-22 | Source-aligned six-screen implementation gap audit. |
| 2.0 | 2026-07-22 | ADR-016 microtask plan for five-surface limited-operator HMI, authoritative broker/core path, privilege removal and verification gates. |
| 2.1 | 2026-07-22 | Recorded host implementation, artifact mapping and the remaining target/HIL/usability RED gates. |
| 2.2 | 2026-07-22 | Added ADR-017 HNW-000..013 microtasks for local Ethernet commissioning after SOM and broker contract readiness. |
