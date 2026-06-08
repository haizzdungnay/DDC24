# ADR-008: Reposition as BMS Edge Automation Controller + expand Rev A component set

- Date: 2026-06-08
- Owner: Solution Architect / Product Owner
- Status: Accepted
- Builds on: [ADR-004](ADR-004-component-based-runtime.md) (component-based runtime),
  [ADR-005](ADR-005-three-process-architecture.md) (3-process `mkddc-*`),
  [ADR-006](ADR-006-rev-a-ui-form-json.md), [ADR-007](ADR-007-web-stack-go.md)
- Canonical references: [PRODUCT_DEFINITION](../01_specs/PRODUCT_DEFINITION_MK-DDC-24_VI.md),
  [REVA_SCOPE_ROADMAP](../01_specs/REVA_SCOPE_ROADMAP_MK-DDC-24_VI.md),
  [BMS_EDGE_STRATEGY](../01_specs/BMS_EDGE_STRATEGY_MK-DDC-24_VI.md)

## Context

ADR-004..007 fixed the *architecture* (component-based, 3-process, form/JSON, Go web) but
left the **product positioning** as a "DDC controller Linux 24 IO" with HVAC-leaning
application examples (AHU, FCU, fan, pump, valve) and a single HVAC acceptance demo.

That positioning is technically correct but **commercially too narrow**: it reads like an
"HVAC DDC with extras". The component-based runtime, dual controller+gateway role, and
local-first design are not HVAC-specific — they fit lighting, pump/water, energy, environment
monitoring, alarm/interlock and Modbus↔BACnet gateway work equally well.

Two gaps make the product look HVAC-only:

1. The Rev A fixed component set (24 types) defers several components that real BMS jobs need
   regardless of domain: `Interlock`, `AlarmDelay`, `RuntimeCounter`, `PulseCounter`.
2. The Rev A acceptance demo is a single HVAC sequence.

This decision is recorded before the documentation rebase (DOC-REBASE-2026-06-BMS-EDGE) so
every downstream edit traces to it.

## Decision

1. **Positioning.** MK-DDC-24 is a **Component-Based BMS Edge Automation Controller**.
   HVAC is the **first use-case, not the product boundary**. Target domains: HVAC,
   pump/water, lighting, energy, environment monitoring, alarm/interlock, Modbus/BACnet
   gateway, data acquisition. This is the canonical one-line in PRODUCT_DEFINITION §1.

2. **Rev A.0 fixed component set: 24 → 28 types.** Promote from deferred (Rev B/C) into the
   Rev A.0 fixed library:
   - `Interlock` (Control) — equipment interlock / safety chaining, needed by any real BMS.
   - `AlarmDelay` `[S]` (Alarm) — debounce to suppress false field alarms.
   - `RuntimeCounter` `[S]` (Timer/runtime) — accumulated run-hours for pump/fan maintenance.
   - `PulseCounter` `[S]` (Counter) — pulse counting for energy/water meters.

3. **Acceptance = 3-domain demo** (replaces single HVAC demo): Demo 1 HVAC mini,
   Demo 2 Pump/Water, Demo 3 Energy/Gateway. Each demonstrates local-first operation and
   stale/fallback. Detailed in REVA_SCOPE §6, illustrated by `examples/`.

The architecture (ADR-004..007), 90-day deadline, Milestone-A interpretation, and "no
BTL / no IEC 61131-3 / no HMI-OTA-MQTT in Rev A.0" constraints are **unchanged**.

## Rejected alternatives

1. **Keep components deferred, only reword docs as "general BMS".** Rejected: positioning
   would claim generality the locked component set cannot demonstrate — the gateway/energy
   and interlock stories need `PulseCounter`/`Interlock` to be real.
2. **Split Interlock+AlarmDelay into A.0, RuntimeCounter+PulseCounter into A.1.** Considered;
   Owner chose all four into A.0 so the 3-domain demo is fully buildable in one acceptance.
3. **Rebrand to a generic "edge gateway" and drop the controller/DDC framing.** Rejected:
   the local control runtime + priority resolver is the differentiator; gateway is one role,
   not the whole product.

## Consequences

- PRODUCT_DEFINITION → v1.1 (positioning, IS/IS-NOT table, Application Domains).
- New strategy doc BMS_EDGE_STRATEGY (product/sales narrative, not a spec).
- REVA_SCOPE §2/§3/§6 updated: component count 28, 4 types removed from CUT list, 3-domain
  acceptance.
- SW_COMPONENT_LIBRARY §2–§10 updated: +4 contracts, count 24 → 28.
- `examples/{hvac-mini,pump-water,energy-gateway}/` added to repo layout (REPO-001).
- Register, Traceability, README, Getting Started, Implementation Plan reconciled.

## Risks

- `R1` **Scope creep in 90 days.** Four extra components add implementation + test load to an
  already tight schedule. Mitigation: all are simple/stateful counters and a logic gate;
  tracked against Milestone A. If the schedule slips, RuntimeCounter/PulseCounter are the
  first candidates to push to Rev A.1 (they do not block Demo 1/2 control logic).
- `R2` Validator v1 (4 core checks) is unchanged; `Interlock`/`AlarmDelay` must be covered by
  existing safe-state/fallback checks, not a new validator rule, to avoid scope growth.
