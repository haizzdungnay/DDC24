# Example — Pump / Water (Demo 2)

> Acceptance: [REVA_SCOPE §6 Demo 2](../../docs/01_specs/REVA_SCOPE_ROADMAP_MK-DDC-24_VI.md) ·
> Schema: [GRAPH_SCHEMA](../../docs/02_design/interfaces/GRAPH_SCHEMA_MK-DDC-24_VI.md) ·
> Components: [SW_COMPONENT_LIBRARY](../../docs/02_design/software/SW_COMPONENT_LIBRARY_MK-DDC-24_VI.md)

Ví dụ bơm/nước — chứng minh sản phẩm **không HVAC-only**: interlock an toàn, chống báo giả,
đếm giờ chạy, và logic local chạy khi mất BMS.

## Mục tiêu demo
- DI level switch + AI pressure → quyết định chạy bơm (DO pump enable).
- `OnDelay`/`OffDelay` chống dao động đóng/cắt.
- `Interlock`: chặn bơm khi điều kiện an toàn sai (vd: low-level/dry-run permit).
- `AlarmDelay`: dry-run / pressure alarm có trễ → chống báo giả ngoài hiện trường.
- `RuntimeCounter`: tích lũy giờ chạy bơm → alarm bảo trì.
- Mất BMS: logic local vẫn chạy đầy đủ.

## Component dùng
`DI_Input` · `AI_Input` · `Compare_LT` · `OnDelay` · `OffDelay` · `Interlock` ·
`AlarmDelay` · `RuntimeCounter` · `DO_Output` · `BACnet_BV`

## IO / BACnet map
| Signal | Kênh | BACnet |
|--------|------|--------|
| Level switch (đủ nước) | DI ch1 | BI |
| Áp suất | AI ch1 | AI |
| Pump enable | DO ch1 | BO |
| Dry-run alarm | (BV) | BV |
| Pump run-hours | (AV) | AV |

## graph.json (rút gọn)
```json
{
  "schema_version": "1.0",
  "device": { "bacnet_device_id": 1002, "name": "PUMP_WATER", "scan_ms": 1000 },
  "io_map": { "ai": ["press@ch1"], "di": ["level@ch1"], "do": ["pump@ch1"] },
  "nodes": [
    { "id": "level",  "type": "DI_Input",       "params": { "channel": 1 } },
    { "id": "press",  "type": "AI_Input",        "params": { "channel": 1, "sensor": "4-20mA" } },
    { "id": "lowp",   "type": "Compare_LT",      "params": { "hysteresis": 0.2 } },
    { "id": "ond",    "type": "OnDelay",         "params": { "delay_s": 3 } },
    { "id": "ilk",    "type": "Interlock",       "params": { "latch": true } },
    { "id": "pump",   "type": "DO_Output",       "params": { "channel": 1 }, "power_on": { "in": false } },
    { "id": "dry",    "type": "AlarmDelay",      "params": { "on_delay_s": 5, "off_delay_s": 2 } },
    { "id": "rt",     "type": "RuntimeCounter",  "params": { "maint_hours": 2000 } },
    { "id": "dry_bv", "type": "BACnet_BV",       "params": { "instance": 2, "name": "DryRunAlarm" } }
  ],
  "links": [
    { "from": "level.out", "to": "ilk.permit" },
    { "from": "ond.out",   "to": "ilk.request" },
    { "from": "ilk.out",   "to": "pump.in" },
    { "from": "pump.in",   "to": "rt.run" },
    { "from": "ilk.tripped", "to": "dry.in" },
    { "from": "dry.out",   "to": "dry_bv.in" }
  ],
  "meta": { "author": "example", "rev": 1 }
}
```

## Acceptance points
- [ ] Level=false (cạn) → `Interlock` chặn bơm, `tripped=true` → dry-run alarm sau `on_delay_s`.
- [ ] Alarm không kích nếu nhiễu < `on_delay_s` (chống báo giả).
- [ ] `RuntimeCounter` cộng giờ khi bơm chạy; giữ qua mất điện; alarm khi ≥ `maint_hours`.
- [ ] Ngắt BMS → bơm vẫn được điều khiển bằng logic local.
- [ ] Mất điện bật lại → pump về power_on=false rồi logic tiếp tục; run-hours không reset.

> ⚠️ graph.json đây là minh họa — chốt chính xác theo GRAPH_SCHEMA khi engine ổn định.
