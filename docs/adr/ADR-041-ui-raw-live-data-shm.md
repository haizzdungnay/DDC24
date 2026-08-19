# ADR-041 — UI Raw Live Data In Shared Memory
> ## ⚠ ĐỔI SỐ — 2026-08-19
>
> Hồ sơ này **phát hành nhầm số `ADR-011`**, trùng với [ADR-011 — BACnet Reliability/Quality Mapping](ADR-011-bacnet-reliability-quality-mapping.md), vốn được viện dẫn ở `contracts/shm/mkddc_shm.h` và 13 chỗ trong `apps/`. Số mới cấp phát là
> **`ADR-041`** theo đúng luật ở [Decision Log](../00_governance/DECISIONS.md) ("lấy số cao
> nhất đã cấp phát rồi cộng một").
>
> Decision Log bản 2026-07-22 từng chuẩn hoá hồ sơ này thành `ADR-014`, nhưng **số đó đã bị
> chiếm** từ 2026-07-02 bởi [ADR-014 — Alarm Acknowledge Lifecycle](../02_design/adr/ADR-014-alarm-ack-lifecycle.md) và **đang được viện dẫn trong hợp đồng
> canonical** `contracts/openapi/openapi.yaml`. Theo quy tắc "hợp đồng thắng tài liệu",
> `ADR-014` giữ nguyên nghĩa cũ và hồ sơ này nhận `ADR-041`.


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

> **Superseding integration note (2026-07-01):** ADR-011 (BACnet Reliability) adds
> `ui_reliability[16]` without removing these raw-live fields and bumps the combined
> contract to `0x4B584404` (v4).

## Consequences

- `mkddc-iobus`, `mkddc-core`, and `mkddc-web` must be rebuilt and deployed together.
- Analog UI channels can expose true raw V/mA to REST/WS clients.
- Dry-contact, pulse, none, and disabled channels keep empty `ui_raw_unit`; web omits `raw`.
