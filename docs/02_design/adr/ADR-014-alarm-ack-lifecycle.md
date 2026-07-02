# ADR-014: Alarm Acknowledge Lifecycle

| Field | Value |
|-------|-------|
| Status | Accepted |
| Date | 2026-07-02 |
| Scope | ALARM-3b Phase 1, design + contract only |
| Owner | Software architecture |

## Context

Phase 3b connects live alarm state from `services/core` to `web/backend` and makes
`POST /api/v1/alarms/{id}/ack` real.

Repo evidence:

- Core already owns runtime alarm evaluation through `AlarmRuntime`, wired in the scan loop at `services/core/main.cpp:186` and `services/core/scan_loop.cpp:83`.
- Current core alarm state is only `AlarmState{id, source_point_id, priority, active}` at `services/core/alarm_runtime.hpp:40`.
- Current core entity runtime stores `active` and `active_source`, but no ack state or timestamp, at `services/core/alarm_runtime.hpp:73`.
- `AlarmRuntime::active_states()` returns only active rows at `services/core/alarm_runtime.cpp:393`.
- Go already exposes `AlarmDTO{id,time,severity,status,message,source,value,detail}` at `web/backend/dto.go:165`.
- Go routes already exist for `GET /api/v1/alarms` and `POST /api/v1/alarms/{id}/ack` at `web/backend/http.go:135`.
- `CoreClient.ReadAlarms()` and `CoreClient.AckAlarm()` are TODO no-ops at `web/backend/core_client.go:565`.
- Core/web IPC is the existing Unix stream JSON-line socket at `services/core/web_ipc.hpp:3`, with point command parsing currently limited to `write` and `release` at `services/core/web_ipc.cpp:193`.
- The scan loop already drains web commands at a scan boundary and responds later in the same scan at `services/core/scan_loop.cpp:57` and `services/core/scan_loop.cpp:96`.
- ADR-013 says multi-source acknowledgement is entity-level unless later UX requires per-source acknowledge at `docs/02_design/adr/ADR-013-alarm-entity-model.md:82`.
- SHM has no alarm array and ADR-013 explicitly keeps alarm status out of SHM at `docs/02_design/adr/ADR-013-alarm-entity-model.md:144`.

## Decision

Use a latched-until-ack lifecycle for runtime alarms.

Public `AlarmDTO.status` values mean:

| Status | Condition | Ack state | List behavior |
|--------|-----------|-----------|---------------|
| `active` | alarm condition is true | not acked | shown, ack button enabled |
| `acked` | alarm condition is true | acked | shown, ack button disabled |
| `unack` | alarm condition has cleared | not acked | shown until user ack |
| `shelved` | deferred feature | deferred | not emitted in Phase 3b |

Normal alarms are not returned by `GET /api/v1/alarms`.

This is intentionally not pure auto-clear. If an alarm clears before an operator
acknowledges it, the row remains visible as `unack` so short HVAC faults are not
silently missed. Once an alarm is both clear and acknowledged, it is removed from
the list.

## Transitions

| From | Event | To | Notes |
|------|-------|----|-------|
| normal | condition asserts after delay | `active` | create occurrence, set `time`, source, value |
| `active` | user ack | `acked` | condition still active |
| `active` | condition clears before ack | `unack` | latched cleared alarm |
| `unack` | user ack | normal | remove from list |
| `unack` | condition asserts again before ack | `active` | same unresolved occurrence; keep first `time`, refresh source/value |
| `acked` | condition clears | normal | remove from list |
| normal after prior ack/clear | condition asserts again | `active` | new occurrence, new `time`, ack reset |

Ack is entity-level in Phase 3b. For a multi-source alarm, acknowledging `ALM-001`
acknowledges the entity, not one branch. The displayed `source` remains the current
or most recent trigger source.

Ack behavior:

- ack `active` -> status becomes `acked`;
- ack `acked` -> accepted no-op;
- ack `unack` -> row is removed;
- ack unknown/normal/not-in-list id -> rejected as `unknown_alarm`;
- retrigger after ack and clear -> new `active` occurrence, not acked.

## Shelving

`shelved` remains a public enum value for FE compatibility, but Phase 3b does not
implement shelving. Core must not emit `shelved` until a later ADR defines shelf
duration, restore rules, authorization, and audit behavior.

## Runtime State

Add ack lifecycle state inside `AlarmRuntime::Entity`, not SHM.

Minimum internal fields:

| Field | Purpose |
|-------|---------|
| `active` | current evaluated condition for the entity |
| `active_source` | current or most recent triggering source point id |
| `acked` | user acknowledged the current occurrence |
| `latched_clear` | condition cleared before ack and must remain visible |
| `first_active_at` | wall-clock ISO-8601 timestamp for occurrence start |
| `trigger_value` | source value captured at first assertion or source change |
| `last_status` | public status derived from active/acked/latched_clear |

Ack state is volatile runtime state. It must survive SIGHUP config reload only for
the same alarm id when the alarm definition fingerprint is unchanged
(`alarmType`, `sources`, `params`, `delayS`). It is not written to
`alarm_settings.conf` and does not survive core process restart. A restart should
surface active alarms again as unacknowledged.

## Field Ownership

The core IPC response is a runtime record. Go maps it to public `AlarmDTO`.

| AlarmDTO field | Core supplies | Web derives |
|----------------|---------------|-------------|
| `id` | alarm entity id, used by ack path | no |
| `time` | `first_active_at`, ISO-8601 wall clock | fallback to receive time only if missing |
| `severity` | priority string from alarm config | map `critical/high/medium/low`; `info` reserved for system alarms |
| `status` | lifecycle status `active/unack/acked` | no |
| `message` | label from alarm config | fallback `Alarm <id>` |
| `source` | source point id | fallback `SYSTEM` only for non-entity future alarms |
| `value` | trigger/source value | stringify for DTO |
| `detail` | alarm type, source, and lifecycle inputs | format human-readable detail |

Core should also include `alarmSettingId`, `sourcePointId`, `priority`, and
`alarmType` as protocol fields so web can keep the public DTO stable without
re-reading settings files.

## IPC Protocol

Use the existing `web_ipc` Unix stream socket and JSON-line framing. Do not add SHM
fields for Phase 3b.

The existing numeric `id` field remains the command correlation id. Alarm target id
uses `alarmId`.

List request:

```json
{"id":101,"op":"alarm_list","user":"web"}
```

List response:

```json
{
  "id": 101,
  "result": "accepted",
  "alarms": [
    {
      "id": "ALM-001",
      "alarmSettingId": "ALM-001",
      "time": "2026-07-02T08:15:30Z",
      "status": "active",
      "priority": "high",
      "label": "Supply air temperature",
      "sourcePointId": "UI-01",
      "value": 31.8,
      "alarmType": 1
    }
  ]
}
```

Ack request:

```json
{"id":102,"op":"alarm_ack","alarmId":"ALM-001","user":"web"}
```

Ack accepted response:

```json
{"id":102,"result":"accepted","alarmId":"ALM-001","status":"acked"}
```

Ack rejected response follows existing `respond_rejected` shape:

```json
{"id":102,"result":"rejected","error":"unknown_alarm"}
```

Required errors:

| Error | Meaning |
|-------|---------|
| `bad_request` | missing/invalid command id, op, user, or alarmId |
| `unknown_alarm` | alarm id is normal, removed, disabled, or unknown |
| `busy` | command queue full |

`WebCommand` must be widened from point-only into a tagged command, for example
`kind = point_write | point_release | alarm_list | alarm_ack`. Existing point
command payload and responses remain compatible.

## Scan Safety

Alarm list and ack commands must be drained by `WebIpc::drain()` at the existing
scan boundary. Only the scan thread mutates `AlarmRuntime`; socket handling must
not mutate alarm state from another thread.

Recommended order in one scan:

1. drain web IPC lines;
2. apply point write/release commands as today;
3. execute graph;
4. evaluate alarms;
5. apply queued alarm ack commands and build alarm list responses;
6. continue resolve/safe-state/output write as today.

This makes ack deterministic for the current scan result and avoids mid-scan
condition/ack races.

## OpenAPI Contract

`GET /api/v1/alarms` returns only visible runtime alarms: `active`, `acked`,
`unack`, and future `shelved`. It is not history.

`POST /api/v1/alarms/{id}/ack` acknowledges one alarm entity id and returns the
current visible alarm list after the ack command is applied. Errors use existing
backend mapping: bad id -> 400, unknown alarm -> 404, rejected state conflict -> 409.

## Consequences

- Phase 3b can reuse `web_ipc`; no new transport is needed.
- Core ack lifecycle is the riskiest next change because clear/retrigger behavior
  must be correct before Go and FE can trust statuses.
- No SHM v4 magic, offset, or sizeof change is allowed for this phase.
- FE already has a live alarms page; it may need wording tweaks only if it wants to
  distinguish `active` from cleared-but-`unack`.

## Design Questions Closed

| Question | Answer |
|----------|--------|
| Latching or auto-clear | Latched until ack. Acked active rows auto-remove on clear; cleared-before-ack rows remain `unack`. |
| Ack after clear | If row is latched `unack`, ack removes it. If already normal/removed, reject `unknown_alarm`. |
| Retrigger after ack | After clear resets occurrence, next assertion becomes new `active` and unacknowledged. |
| `shelved` | Deferred; enum remains, core must not emit in Phase 3b. |
| Core vs web fields | Core owns runtime state/time/status/source/value/priority/label; web maps severity/message/source/value/detail for DTO. |
| Ack through reload | Survives SIGHUP only for unchanged alarm definitions; not persisted across core restart. |
