# ADR-013: Alarm Entity Model

| Field | Value |
|-------|-------|
| Status | Accepted |
| Date | 2026-07-02 |
| Scope | ALARM-01B Phase 1, design + contract only |
| Owner | Software architecture |

## Context

Alarm config must become an independent entity, not one row hard-bound to one physical point. One alarm may monitor many UI/AO/DO sources, while BACnet publication remains bounded by the published object capability.

Repo evidence:

- Rev A component library has `RuntimeCounter.alarm` at `docs/02_design/software/SW_COMPONENT_LIBRARY_MK-DDC-24_VI.md:51`, `Interlock.tripped` at `docs/02_design/software/SW_COMPONENT_LIBRARY_MK-DDC-24_VI.md:70`, and alarm primitives `AlarmHigh`, `AlarmLow`, `AlarmDelay` at `docs/02_design/software/SW_COMPONENT_LIBRARY_MK-DDC-24_VI.md:76`.
- Graph schema allows exactly one wire per input port at `docs/02_design/interfaces/GRAPH_SCHEMA_MK-DDC-24_VI.md:75`; runtime rejects duplicate input wiring at `services/core/graph_runtime.cpp:309`.
- BACnet capability is 4 Notification Class and 8 Event Enrollment objects at `docs/01_specs/DS_MK-DDC-24_VI.md:172`, `docs/01_specs/DS_MK-DDC-24_VI.md:173`, `docs/01_specs/SRS_MK-DDC-24_VI.md:160`, and `docs/01_specs/SRS_MK-DDC-24_VI.md:161`.
- Current OpenAPI `AlarmSetting` is per `pointId` at `docs/02_design/interfaces/openapi.yaml:1063`; backend DTO mirrors that shape at `web/backend/dto.go:83`.
- Current backend validates unique `pointId`, priority, delay, and threshold ordering only at `web/backend/alarmsettingsapi.go:57`; no max count or `alarmType` exists.
- Backend stores `alarm_settings.conf` via `ALARM_SETTINGS_CONF` fallback at `web/backend/config.go:40` and `web/backend/alarmsettingsstore.go:24`.
- Core reload loads `io_config.conf`, `io_safe_state.conf`, and `graph.json`, but not `alarm_settings.conf`, at `services/core/config_reload.hpp:3` and `services/core/config_reload.cpp:17`.
- SHM v4 has UI/AO/DO point fields but no alarm status/cmd array at `shared/mkddc_shm.h:71`, `shared/mkddc_shm.h:81`, `shared/mkddc_shm.h:83`, and `shared/mkddc_shm.h:122`.
- FE EasySet parity currently exposes demo enum `0..7` at `src/frontend/src/pages/AlarmSettingsPage.tsx:13`, but it is not authoritative runtime evidence.

## Decision

Alarm settings are stored as an array of alarm entities:

```json
[
  {
    "id": "ALM-001",
    "label": "Supply air temperature",
    "enabled": true,
    "alarmType": 1,
    "sources": [
      { "kind": "UI", "channel": 1, "pointId": "UI-01" },
      { "kind": "UI", "channel": 2, "pointId": "UI-02" }
    ],
    "priority": "high",
    "delayS": 10,
    "publishBacnet": true,
    "params": { "hh": 32, "h": 28, "l": 16, "ll": 12, "hysteresis": 0.5 }
  }
]
```

Required fields: `id`, `label`, `enabled`, `alarmType`, `sources`, `priority`, `delayS`, `params`.

Optional fields: `publishBacnet` (default `false`), `notificationClass` (1..4, only meaningful when `publishBacnet=true`).

`sources[]` entries reference physical point surfaces:

| Field | Rule |
|-------|------|
| `kind` | `UI`, `AO`, or `DO` |
| `channel` | UI 1..16, AO 1..4, DO 1..4 |
| `pointId` | Canonical API point id, example `UI-01`, `AO-01`, `DO-01` |

## Alarm Type Enum

| Value | Name | Status | Core path | Params |
|-------|------|--------|-----------|--------|
| 0 | disabled | ACTIVE | stored no-op; entity ignored even if `enabled=true` | `{}` |
| 1 | high_low_input | ACTIVE | per-source `AlarmHigh`/`AlarmLow` plus `AlarmDelay` | `hh`, `h`, `l`, `ll`, optional `hysteresis` |
| 2 | setpoint_deviation | DEFERRED | no current component for setpoint +/- deviation math without new evaluator | `setpoint`, `deviationHigh`, `deviationLow` |
| 3 | runtime_hours | ACTIVE | per-source `RuntimeCounter.alarm` | `runtimeHours` |
| 4 | fan_state_supervision | DEFERRED | needs command/feedback supervision contract beyond current graph primitives | `expectedState` |
| 5 | digital_output_supervision | DEFERRED | needs DO feedback supervision and fault semantics | `expectedState` |
| 6 | analog_output_supervision | DEFERRED | needs AO command/feedback tolerance semantics | `expectedValue`, `tolerance` |
| 7 | pi_sequence_supervision | DEFERRED | no PI sequence supervision primitive in current core | `sequence` |

Only ACTIVE types may be created with `enabled=true` in Phase 2 backend validation. DEFERRED types may be documented for UI parity but must be rejected or forced disabled until their core path lands.

## Multi-Source Semantics

One alarm with N sources means:

- Evaluate each source independently using the same `alarmType`, `priority`, `delayS`, and `params`.
- Entity state is OR of per-source branch states: alarm is active if any source branch is active.
- Event payload must preserve the triggering `source.pointId`; acknowledgement is entity-level in Phase 2 unless later UX requires per-source acknowledge.
- Thresholds are shared across all sources in one entity. If one source needs different thresholds, create another alarm entity.

This keeps the JSON small, matches common HVAC grouping, and avoids a hidden per-source threshold table in Phase 1.

## Evaluation Architecture

Chosen approach: backend/core expand one alarm entity into N internal branches at core load time.

Rationale:

- Current graph/runtime already has tested single-input alarm primitives; multi-wire input is explicitly rejected.
- Entity expansion avoids changing graph input semantics.
- A separate evaluator would duplicate graph primitives and state handling.

Required Phase 2/3 implementation:

1. Backend validates schema, migrates old rows, and writes entity list.
2. Core loads `alarm_settings.conf` on boot and SIGHUP.
3. Core expands each enabled ACTIVE entity into per-source branches.
4. Type 1 uses `AlarmHigh`/`AlarmLow` then `AlarmDelay`.
5. Type 3 uses `RuntimeCounter` with source run value and `runtimeHours`.
6. `/api/v1/alarms` exposes entity id plus triggering source id.

## Counts And BACnet

Decision:

- `maxAlarms = 64` internal alarm entities.
- `maxSourcesPerAlarm = 16`.
- `maxBacnetPublishedAlarms = 8`.

BACnet Event Enrollment = 8 is a publication cap, not the internal alarm count. `publishBacnet=true` may be set on at most 8 enabled alarm entities. Non-published alarms remain available through local/API alarm surfaces.

Reason: repo has no evidence for "unlimited"; 64 gives useful engineering headroom over the 24 local IO points while keeping validation and memory bounded. If later performance testing proves higher capacity, raise this ADR and schema cap deliberately.

## Storage And Migration

Keep filename `alarm_settings.conf` because backend already has env/fallback plumbing for it.

Schema changes from old per-point rows:

```json
{ "pointId": "AI-01", "label": "Temp", "enabled": true, "hh": 30, "h": 28, "l": 18, "ll": 16, "delayS": 0, "priority": "high" }
```

to entity rows:

```json
{ "id": "ALM-AI-01", "label": "Temp", "enabled": true, "alarmType": 1, "sources": [{ "kind": "UI", "channel": 1, "pointId": "UI-01" }], "priority": "high", "delayS": 0, "publishBacnet": false, "params": { "hh": 30, "h": 28, "l": 18, "ll": 16 } }
```

Migration is automatic in Phase 2 backend:

- old `pointId` becomes `id = "ALM-" + normalized(pointId)`;
- source is inferred from point id prefix (`AI`/`UI` -> `UI`, `AO` -> `AO`, `DO` -> `DO`);
- `alarmType = 1`;
- `params = {hh,h,l,ll}`;
- old `enabled`, `label`, `delayS`, `priority` are preserved.

Malformed rows remain rejected; no silent data loss.

## SHM Impact

No SHM v4 change in this ADR. Alarm evaluation stays in core and is exposed through web/core API plumbing, not by adding alarm arrays to `kx_io_shm_t` or `kx_plc_shm_t`.

If a later phase needs alarm status/cmd in SHM, that is a separate high-risk ADR with magic/offset/sizeof/version impact.

## Consequences

- OpenAPI and CONFIG_SCHEMA now describe the entity-list contract.
- Current runtime is not compliant yet; backend/core work is required before enabling this contract.
- FE demo enum `0..7` is narrowed by backend/core status: only 0, 1, and 3 are ACTIVE.
- The OpenAPI/core contradiction is resolved by documenting current persist-only behavior and mandatory future core loader/evaluator work.

## Design Questions Closed

| Question | Answer |
|----------|--------|
| Multi-port semantics | Per-source evaluation, entity state = OR, shared thresholds/params. |
| Max alarm count | 64 internal entities; max 16 sources/entity; BACnet-published subset max 8. |
| ACTIVE vs DEFERRED types | ACTIVE: 0, 1, 3. DEFERRED: 2, 4, 5, 6, 7. |
| Core approach | Expand entity to per-source internal branches, not graph multi-wire and not a separate evaluator. |
| SHM impact | No SHM change for Phase 1/2 alarm entity model. |
| Migration | Automatic backend migration from per-point rows to entity list in Phase 2. |
