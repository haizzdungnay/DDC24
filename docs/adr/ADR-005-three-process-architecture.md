# ADR-005: Three-Process Linux Architecture and MK-DDC-24 Service Naming

- Date: 2026-06-08
- Owner: Solution Architect
- Status: Accepted
- Related: ADR-004 (component runtime), ADR-007 (web stack)
- Amendment: ADR-016 đưa `mkddc-hmi` trở lại Rev A dưới dạng optional limited-operator client; quyết định ba process authority vẫn giữ nguyên.
- Canonical reference: `spec/PRODUCT_DEFINITION_MK-DDC-24_VI.md` (Phase 1)

## Context

The product definition ("Chốt tổng thể", section 5) lists seven systemd services
(`ddc-runtime`, `ddc-io`, `ddc-modbus`, `ddc-bacnet`, `ddc-web`, `ddc-validator`,
`ddc-watchdog`). Splitting by *function* this way forces the control loop to cross
a process boundary every scan to read IO, and makes the validator a long-running
service when it is only needed at deploy time.

Two naming systems also coexist: the existing code/headers use the codename
`kinexus-*` (`shared/kinexus_shm.h`, `kinexus-plc`, `kinexus-webide`), while the
product definition uses `ddc-*`. The owner has chosen to standardize on the
**MK-DDC-24** product brand and retire the `kinexus` codename.

## Decision

### Process topology — three processes, split by real-time boundary

```
mkddc-core   (real-time, SCHED_FIFO)   ── single process
  - IO driver / image-of-IO (24 IO via IO processor SHM)
  - graph execution engine (scan loop, default 1 s)
  - priority resolver + safe-state + power-on-state
  - Modbus value CACHE (read-only here), BACnet object table (in-memory)

mkddc-iobus  (non-real-time)            ── single process
  - Modbus RTU master x2 + Modbus TCP client (async poll → cache)
  - BACnet/IP network datalink (bacnet-stack)

mkddc-web    (non-real-time)            ── single process
  - engineering web + REST API (Go)
  - validator (LIBRARY invoked at deploy, not a service)
  - commissioning, backup/restore, SQLite config
```

- The control loop **never** crosses a process boundary to read onboard IO: IO and
  the engine live in `mkddc-core`.
- Slow field I/O (Modbus, VFDs at 100 ms+) is isolated in `mkddc-iobus`; the core
  reads cached values carrying `{value, quality, timestamp}` so staleness is visible.
- BACnet network I/O is in `mkddc-iobus`, but the object table is in-core for
  immediate read/write within a scan.
- Watchdog is **systemd `WatchdogSec=` + hardware watchdog**, not a separate service.

### Services from the prior design deferred out of the Rev A core

The 2026-05-30 design also defined `kinexus-hmi` (LVGL local display), `kinexus-agent`
(MQTT/REST cloud), and `kinexus-ota`. Cloud/OTA remain outside the Rev A three-process
core. The original local-HMI deferral in this paragraph was amended by ADR-016:
`mkddc-hmi` may be a feature-gated Rev A client, but it does not become a fourth
authority process; mutation still passes through the local broker and `mkddc-core`.

### Service naming — MK-DDC-24 brand

Retire `kinexus-*`. Service names:

| Old (codename) | New (MK-DDC-24 brand) |
|----------------|------------------------|
| `kinexus-plc`     | `mkddc-core` |
| (modbus/bacnet)   | `mkddc-iobus` |
| `kinexus-webide`  | `mkddc-web` |

SHM/header `kinexus_shm.h` → `mkddc_shm.h`, IOP protocol header retained by function.
Code/header rename is tracked as a follow-up implementation task; **documentation
leads, code follows.**

### Real-time posture

`mkddc-core` runs `SCHED_FIFO` with an absolute-time scan (`clock_nanosleep(TIMER_ABSTIME)`).
Rev A targets a **1 s** default scan; deterministic sub-100 ms fast IO and
PREEMPT_RT tuning are Rev B scope and noted as such, not silently assumed.

## Consequences

**Positive:**
- Fault isolation: crash in `mkddc-iobus` (UART fault) does not kill `mkddc-core` real-time loop.
- Restartability: each process can be independently restarted via systemd without full reboot.
- Real-time isolation: `mkddc-core` runs `SCHED_FIFO` free from network I/O jitter.
- Separation of concerns: BACnet/Modbus network latency is absorbed in `mkddc-iobus`, not core.

**Negative / Trade-offs:**
- IPC overhead via shared memory (seqlock) adds ~50–200 ns read/write per scan cycle.
- Header/code rename (`kinexus_shm.h` → `mkddc_shm.h`) requires tracked atomic change.
- Three-process deployment means three systemd units to maintain and monitor.

## Rejected alternatives

1. **Seven functional services (per product-definition section 5).** Rejected:
   IO-to-engine crosses a process boundary every scan (latency + failure modes),
   and the validator does not warrant a daemon.
2. **Single monolithic process.** Rejected: couples slow Modbus/BACnet network I/O
   into the real-time loop and reduces fault isolation / restartability.
3. **Keep `kinexus-*` naming.** Rejected by owner in favor of product-brand naming;
   accepted cost is a code/header rename tracked separately.

## Risks

- `R1` Header/code rename (`kinexus_shm.h` → `mkddc_shm.h`) touches built artifacts
  (BACnet stack integration) — must be a tracked, atomic implementation change.
- `R2` Core combines IO + engine + priority; it must stay lean to hold scan budget.

## Open questions

- IPC mechanism between `mkddc-core` and `mkddc-iobus` (shared memory vs. unix
  socket) — to be fixed in `spec/SW_ARCH_SPEC` and `SWFW_INTERFACE_SPEC`.
