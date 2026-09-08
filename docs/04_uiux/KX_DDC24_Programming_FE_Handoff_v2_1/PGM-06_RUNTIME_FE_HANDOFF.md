# PGM-06 — Runtime & Diagnostics — FE Handoff

**Route:** `/eng/programming/runtime`<br>
**Authority trực quan:** [`assets/PGM-06_runtime.png`](assets/PGM-06_runtime.png) theo `AUTH-UX-PROG-2026-09-08-01`<br>
**Giới hạn bằng chứng:** Target visual; không phải As-Built/runtime evidence.<br>
**Primary goal:** Show only what is actually executing on the controller and provide high-quality monitoring, trace, diagnostics and version/LKG context.

## 1. Workspace modes

Top sub-navigation:
- Live
- Watch
- Trace
- Versions

These are modes within PGM-06, not new primary pages.

## 2. Runtime header

Required:
- runtime state
- Active revision
- Last Known Good
- controller/core connection
- uptime or since-time if backend provides it

Actions are permission/policy dependent.

## 3. Live

Programs table:
`Program | State | Cycle | Execution Time | Last Exec | Health`

Rules:
- cycle and execution time are different fields.
- missing execution metric → `—`.
- CPU/core may appear only under advanced diagnostics if provided.
- fault of one independent Program does not automatically imply all Programs stopped.

## 4. Quick Watch

Columns:
`Variable | Value | Unit | Quality | Updated | Trend`

- values are read-only by default.
- small sparkline is acceptable for quick context.
- stale/unknown quality explicit.
- no hidden Force semantics.

## 5. Trace

Production requirements:
- multi-signal
- legend
- time cursor
- zoom/pan
- time window
- sample interval display
- trigger configuration when backend supports it
- start/stop capture
- tooltip values
- interrupted/stale capture state
- export only if backend/FE feature is real

Do not draw fake data if trace capability is unavailable.

## 6. Versions

Timeline/list:
- Draft
- Active
- LKG
- older commissioned revisions

Details:
- revision
- status
- timestamp
- actor
- Check result
- commission/change summary

Actions:
- Compare
- Inspect
- Prepare Restore

Restore remains a separate dangerous workflow with confirmation/re-auth and authoritative verification.

## 7. Diagnostics

Categories:
- Controller/Core
- Program
- Mapping/I/O
- Communication
- Resource/runtime
- Safety

Row:
`Severity | Component | Message | First Seen | Last Seen | Action`

Errors link to relevant Program/Point/Commission context.

## 8. Runtime state semantics

FE shall distinguish:
- Running
- Stopped/Disabled
- Fault
- Unknown
- Offline
- Stale
- Reconciling

Do not infer `desiredEnabled=true` as `RUNNING`.

## 9. Realtime subscription rules

- websocket/stream disconnect → existing values become `stale` after configured timeout.
- re-connect refreshes snapshot before returning to `live`.
- out-of-order events must not regress a newer authoritative state if sequence/timestamp exists.
- page unload must clean subscriptions.

## 10. Mobile

PGM-06 is a first-class mobile page:
- Runtime health
- Watch
- diagnostics
- versions
- read-only trace summary

Large interactive trace may open full-screen.

## 11. Acceptance criteria

- `AC-PGM06-01` Active and LKG always distinguishable.
- `AC-PGM06-02` missing metric is `—/Unknown`, never fabricated.
- `AC-PGM06-03` realtime disconnect transitions values to stale/offline.
- `AC-PGM06-04` Watch is read-only unless an explicitly approved write/force workflow exists elsewhere.
- `AC-PGM06-05` Trace supports cursor + zoom/pan for real capture.
- `AC-PGM06-06` diagnostics deep-link to owning page/context.
- `AC-PGM06-07` Restore cannot be triggered accidentally.
- `AC-PGM06-08` desired state is not displayed as actual RUNNING state.
