# ADR-011 — UI Raw Live Data In Shared Memory

**Status:** Accepted
**Date:** 2026-06-30
**Scope:** `kx_io_shm_t`, `mkddc-iobus`, `mkddc-web`, Inputs Summary Live Data

## Context

Inputs Summary needs to show both engineering value and raw electrical input. Before this ADR, `kx_io_shm_t` only carried `ui_value[]` and `ui_unit[][]`, so web consumers could not display true raw V/mA without guessing or reconstructing it after iobus scaling.

Dry-contact UI channels are boolean and do not have meaningful raw V/mA display.

## Decision

Extend `kx_io_shm_t` with:

- `float ui_raw[KX_N_UI]` — raw electrical value before engineering scale.
- `char ui_raw_unit[KX_N_UI][8]` — `"V"` or `"mA"`; empty string means raw display not applicable.

Bump `KX_SHM_MAGIC` from `0x4B584402` to `0x4B584403` so stale consumers reject the new layout.

## Consequences

- `mkddc-iobus`, `mkddc-core`, and `mkddc-web` must be rebuilt and deployed together.
- Analog UI channels can expose true raw V/mA to REST/WS clients.
- Dry-contact, pulse, none, and disabled channels keep empty `ui_raw_unit`; web omits `raw`.
