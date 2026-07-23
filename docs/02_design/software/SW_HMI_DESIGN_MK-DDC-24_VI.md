# Service Design — `mkddc-hmi`
## Local limited-operator HMI — TFT 2.4 inch / LVGL v9 / DRM/KMS

**Document ID:** DDD-SWSVC-HMI-MK-DDC-24-VI
**Revision:** 3.3 — 2026-07-22
**Status:** Host control and ADR-017 network commissioning deployed/service-verified; connected-panel HIL acceptance pending
**Owner:** Software Lead
**Decision:** ADR-016, ADR-017
**Trace:** `HMI-REQ-001..017`, `IF-REQ-004`, `SWR-REQ-005..007`

## 1. Outcome and scope

`mkddc-hmi` is the optional local HMI for MK-DDC-24. It runs on the SOM and uses
the installed 2.4-inch panel. The selected product role is **limited operator HMI**:

- monitor controller, points, quality, age and alarms;
- acknowledge alarms through the authoritative alarm path;
- set setpoints/modes and create/release bounded overrides only for points that the
  authority marks commandable;
- show diagnostics and request approved service actions;
- let an authenticated Service user configure/recover Ethernet IPv4 through the
  approved SOM network transaction authority;
- remain outside the deterministic control and safety path.

This design does **not** place a full Web HMI, engineering graph, schedule editor,
alarm configuration, calibration, user administration or report workflow on the
320×240 panel. The ADR-017 Ethernet workflow is a narrow commissioning/recovery
exception, not general engineering access.

## 2. Current implementation versus acceptance target

| Area | Source state on 2026-07-22 | Target gap |
|---|---|---|
| DRM/LVGL, FT5436 evdev, six GPIO buttons | Implemented and covered by host mapping tests | Target panel/device-tree/FPS evidence |
| SHM telemetry | Read-only magic/seqlock reader implemented | Producer integration and latency evidence |
| Navigation | Five surfaces `Home/Points/Control/Alarms/Service` implemented | Target focus/clipping/glove inspection |
| Alarm | Broker snapshot and authoritative ACK implemented; local ACK cannot mutate state | Target broker/core loss, flood and history evidence |
| Control | Policy-gated AO/DO control, confirm, query, source and TTL implemented | Target lifecycle/latency/priority scenarios |
| Identity | Broker login/logout, RBAC, idle expiry, rate limit and durable audit implemented | Target deployment identity/group and recovery evidence |
| Service | Direct signal/reboot and static PIN/role removed; Ethernet status/static/DHCP stage/apply/confirm/rollback implemented through broker/netcfg | Target panel, live Ethernet, timeout recovery and usability evidence |
| Communication telemetry | Partial/default values | Authoritative telemetry or explicit unavailable |

Host-complete capability must not be reported as production-accepted until its target,
HIL, fault-recovery and usability evidence is complete.

## 3. Hardware and runtime constraints

| Item | Baseline |
|---|---|
| Panel | KD024QVFIA073-02-C021B |
| Display controller | JD9852, one-lane MIPI DSI |
| Resolution | 240×320 rotated to 320×240 landscape |
| Render path | LVGL v9 → DRM/KMS `/dev/dri/card0` |
| Touch | FT5436 I²C/evdev |
| Hard keys | UP/DOWN/LEFT/RIGHT/ENTER/ESC |
| Telemetry refresh | ≤1 second |
| Rendering | ≥10 FPS on target |
| Control response | accepted/rejected/timeout feedback ≤2 seconds nominal |

The HMI is best-effort and must not use real-time scheduling. A render/input failure
must not block `mkddc-core`, `mkddc-iobus` or MCU safe behavior.

## 4. Ownership and process boundaries

```text
IO/PLC SHM ──read-only──────────────────────────► mkddc-hmi
                                                     │
                                                     │ versioned local UDS
                                                     ▼
                                      mkddc-web local auth/audit broker
                                      identity · RBAC · policy · audit
                                                     │ validated request
                                                     ▼
                                               mkddc-core
                                   priority · interlock · safe-state
                                                     │
                                                     ▼
                                            iobus → MCU → output
```

The broker is a local backend interface, not a browser or Web HMI. Operator commands
must not require an external network. Ownership is fixed as follows:

| State/policy | Owner |
|---|---|
| Physical sampling and actuation | STM32 MCU |
| Engineering/electrical conversion and IO SHM | `mkddc-iobus` |
| Priority winner, interlock, safe-state, effective output | `mkddc-core` |
| Identity, role, command policy projection and durable audit | local broker in `mkddc-web` |
| Alarm lifecycle/history and ACK result | alarm authority through the broker |
| Rendering, focus, pending/error presentation | `mkddc-hmi` |
| Local `point_db.json` | presentation only; never authorization |
| Active/pending network state and rollback | `mkddc-netcfg`; broker owns identity/audit, HMI presentation only |

## 5. Data and IPC contracts

### 5.1 Telemetry

The HMI continues reading `kx_io_shm_t` and `kx_plc_shm_t` read-only. It must verify
magic, seqlock consistency, timestamps and reliability. No command field is written
by HMI and ADR-016 does not require a SHM ABI change.

### 5.2 Local command IPC

The implemented contract is line-delimited JSON version 1 on
`/run/mkddc/hmi-api.sock`, maximum frame 8192 bytes. The broker creates the socket as
`0660`, checks `SO_PEERCRED` and may enforce `HMI_ALLOWED_UID`. Each frame has a
four-second broker deadline; core forwarding uses two seconds and the HMI client uses
2.5 seconds so a mutation fails closed with a visible timeout.

Request envelope:

```json
{
  "version": 1,
  "requestId": "hmi-42",
  "token": "opaque",
  "action": "override",
  "pointId": "AO-01",
  "value": 12.0,
  "reason": "functional test",
  "ttlS": 900
}
```

Response envelope:

```json
{
  "version": 1,
  "requestId": "hmi-42",
  "result": "accepted",
  "reasonCode": "OK",
  "point": {
    "id": "AO-01",
    "value": 12.0,
    "priority": "manual",
    "overrideExpiresInS": 899
  }
}
```

Mandatory properties:

- bounded frame length and read/write timeout;
- peer credential and socket permission checks;
- opaque, short-lived session token;
- idempotent `requestId` handling;
- stable machine-readable reject codes;
- finite/range validation and no silent coercion;
- no secret or raw credential in logs;
- no blind replay after reconnect.

### 5.3 Action allowlist

| Action | Minimum role | Authority result required |
|---|---|---|
| `login/logout` | all known users | identity/session authority |
| `policy`, `points`, `status`, `alarms`, `query` | Viewer | broker/core state |
| `setpoint` | Operator | broker + core |
| `mode` | Operator | broker + core |
| `override` | Operator, if point policy allows | broker + core |
| `release` | Operator, if policy allows | broker + core |
| `alarm_ack` | Operator | alarm authority |

`ping` is unauthenticated health probing. No `service_request` action exists in v1;
maintenance remains hidden until a separate authority is approved and implemented.

ADR-017 approves only the network-specific extension. The BE owner must version or
extend the broker contract with `network_status`, `network_validate`, `network_stage`,
`network_apply`, `network_confirm` and `network_rollback`, using the same bounded frame,
peer/session checks, idempotency and stable reason-code rules. Until cross-language
fixtures and broker adapter tests pass, the HMI must keep Network mutation hidden.

## 6. Point control policy

The authoritative projection for a commandable point contains at least:

```json
{
  "id": "AO-01",
  "kind": "analog",
  "min": 0,
  "max": 20,
  "actions": ["query", "setpoint", "mode", "override", "release"],
  "maxTtlS": 3600,
  "reasonRequired": true
}
```

The Operator role is enforced by the authenticated broker session; audit is mandatory
at the mutation boundary and is therefore not a client-selectable policy field.

Rules:

1. The HMI may use the projection to build widgets, but the broker and core must
   revalidate every mutation.
2. UI/BI/raw/feedback points are read-only.
3. PID, mapping, scaling, calibration, alarm settings, safe-state and electrical mode
   are not Operator actions.
4. Unsupported or incomplete policy disables the control with a visible reason.
5. A change in policy revokes stale cached permission immediately after refresh;
   an already accepted override follows its authoritative lifecycle.

## 7. Command lifecycle

```text
IDLE → EDITING → CONFIRMING → PENDING
                             ├─ ACCEPTED → ACTIVE
                             ├─ REJECTED → IDLE + reason
                             └─ TIMEOUT  → UNKNOWN + query authority

ACTIVE → RELEASE_PENDING → RELEASED/AUTO
ACTIVE → EXPIRED → AUTO
```

The HMI must not display `ACTIVE`, `ACKED`, `RELEASED` or a new effective value from
optimistic local state. Timeout results in `UNKNOWN` until an authoritative query
resolves the state. Duplicate request IDs must return the prior result without a
second actuation.

## 8. Five-surface information architecture

| Surface | Purpose | Mutation |
|---|---|---|
| Home | Controller/control health, alarm summary, I/O and communication summary | Navigate only |
| Points | All available points with value/unit/quality/age | Read-only |
| Control | Whitelisted points and point faceplate | Setpoint/mode/override/release |
| Alarms | Active/history snapshot, priority/state/source/response | Authoritative ACK |
| Service | System/communication diagnostics; approved Ethernet IPv4 commissioning/recovery | Network mutation: Service role only |

Communication and System content from the legacy screens must be consolidated into
Home and Service, not deleted.

## 9. Surface behavior

### 9.1 Home

Within 30 seconds an operator must be able to identify:

- controller state and data freshness;
- highest-priority unacknowledged alarm;
- number of active/unacknowledged alarms;
- I/O good/bad/stale summary;
- core/iobus/broker availability;
- active manual/override count;
- Ethernet/BACnet/Modbus summary without inventing connection semantics.

### 9.2 Points

Rows show point ID/name, value, unit, quality and age. Input/feedback points remain
read-only. Filter values: All, Bad, Stale, Overridden. Selecting a commandable point
may navigate to Control but must not execute a command.

### 9.3 Control

Only commandable points appear. The faceplate shows present/effective value, feedback
when available, mode, quality, source, priority and expiry. Setpoint/mode edits require
confirmation. Override requires reason and TTL. Release is explicit.

### 9.4 Alarms

Each alarm shows priority, lifecycle state, timestamp, source, message and response
text. ACK is disabled without a valid session/role or alarm authority. ACK does not
clear an active condition. The local list is a cache and must rehydrate after restart.

### 9.5 Service

Service contains communication details, versions, resource/process/watchdog state and
maintenance requests. Production HMI must not have direct `CAP_SYS_BOOT`, send raw
signals to core/iobus or execute reboot itself. Unsupported backup/restore/restart/
reboot actions stay hidden or disabled with reason.

Network detail separates `ACTIVE` kernel state, `PENDING` candidate/transaction and
`LAST KNOWN GOOD` recovery metadata. The edit flow is `view → Service login → DHCP or
static IPv4/subnet/gateway → local format check → impact summary → stage/apply →
awaiting confirmation → confirm or rollback`. HMI-side validation only improves
usability; broker and SOM authority revalidate. Wi-Fi credentials, DNS advanced
settings, BACnet ID/port, VLAN, routing and firewall are not shown. HMI never opens
`/run/mkddc-netcfg/netcfg.sock` directly.

## 10. Identity and audit

- Viewer can inspect without mutation.
- Operator session may perform only policy-approved operations.
- Service session may request approved maintenance operations.
- Unknown role and broker loss fail closed.
- Idle session expiry is configurable up to 15 minutes.
- Session expiry does not silently cancel or extend an accepted override; TTL remains
  authoritative and visible.
- Audit records contain synchronized time, actor, role, request ID, action, target,
  old/new or requested/effective value, reason, TTL, result and reason code.

Static production privilege through `role=` or plaintext `service_pin=` in
`hmi.conf` is prohibited.

## 11. Interaction and visual requirements

- Body text ≥14 px; headings 16–18 px.
- Action touch target ≥40×40 px, or an equivalent hard-key path must exist.
- Touch and six keys must reach every action with visible focus.
- The first input after screen saver only wakes the display.
- Normal/available uses neutral styling. Saturated red/yellow is reserved for
  abnormal attention; override has a distinct style and `OVERRIDE` text.
- State is never communicated by color alone.
- Pending, rejected, timeout, stale, unavailable and expired states have explicit text.
- Destructive/maintenance requests show impact summary and hold-to-confirm where the
  approved maintenance contract requires it.

IEC 60073, IEC 62682 and ISA-101 are design/review guidance. Passing an inspection or
host test is not a certification claim.

## 12. Failure behavior

| Failure | Required HMI behavior |
|---|---|
| IO/PLC SHM missing or corrupt | Show data unavailable/fault; never use stale value as current |
| Broker unavailable | Disable Control/ACK/Service mutation; monitoring remains read-only |
| Network authority unavailable | Show active data if available; disable edit and never synthesize success |
| Apply awaiting confirmation | Show old/new address, monotonic rollback countdown and Confirm/Rollback |
| Confirm deadline/helper restart | Rehydrate transaction; authority automatically restores last-known-good |
| Core rejects command | Show stable reason; retain authoritative prior state |
| Command timeout | Show unknown/pending-resolve; query state; do not replay blindly |
| Session expired | Lock mutation and preserve visible override status |
| Alarm stream gap/restart | Rehydrate snapshot before enabling ACK |
| Point policy missing/invalid | Hide or disable control with reason |
| HMI crash/restart | No change to effective outputs or control continuity |

## 13. Performance and resource targets

| Metric | Acceptance target |
|---|---|
| Render rate | ≥10 FPS on target |
| Telemetry update | ≤1 second |
| Nominal command feedback | ≤2 seconds |
| Button debounce | 20 ms target; verify on hardware |
| Session idle expiry | configurable, maximum 15 minutes |
| Alarm list | at least 10 visible/recent records; authority retains durable history |

## 14. Verification gates

Required evidence includes:

- host unit tests for parser, request lifecycle, point policy, session state, alarm
  hydration, focus/navigation and failure rendering;
- integration tests for broker auth/RBAC/audit, core accept/reject, priority, TTL,
  release, idempotency and service loss;
- bypass inspection proving no HMI SHM/hardware write path;
- target tests for DRM/DSI, touch, six buttons, 10 FPS, wake suppression, glove/light,
  font/localization and 40×40 targets;
- operator scenarios for setpoint, override/release, alarm ACK, timeout and recovery.

Host tests cannot close target/HIL, IEC, EMC or production release gates.

## 15. Implementation authority

The microtask implementation plan is maintained in
[08 — mkddc-hmi Implementation Guide](../../03_implementation/08_MKDDC_HMI_IMPLEMENTATION_GUIDE.md).
Verification ownership is in [Verification](../../05_verification/VERIFICATION.md), and
requirement mapping is in [Traceability](../../07_records/TRACEABILITY.md).

## Revision history

| Revision | Date | Change |
|---|---|---|
| 2.4 | 2026-07-22 | Source-aligned service-panel design and production gaps. |
| 3.0 | 2026-07-22 | ADR-016: selected local limited-operator HMI, five surfaces, authoritative command lifecycle, session/RBAC/audit and microtask handoff. |
| 3.1 | 2026-07-22 | Aligned the controlled design with the implemented broker/Core/HMI protocol, five-surface host state and remaining target acceptance gates. |
| 3.2 | 2026-07-22 | Added ADR-017 narrow Ethernet commissioning/recovery target and separated it from implemented HMI protocol v1. |
