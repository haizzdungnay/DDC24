# Example — Energy / Gateway (Demo 3)

> Acceptance: [REVA_SCOPE §6 Demo 3](../../docs/01_specs/REVA_SCOPE_ROADMAP_MK-DDC-24_VI.md) ·
> Schema: [GRAPH_SCHEMA](../../docs/02_design/interfaces/GRAPH_SCHEMA_MK-DDC-24_VI.md) ·
> Components: [SW_COMPONENT_LIBRARY](../../docs/02_design/software/SW_COMPONENT_LIBRARY_MK-DDC-24_VI.md)

Ví dụ vai trò **gateway + đo đếm**: đọc energy meter qua Modbus RTU, đẩy lên BMS qua BACnet,
đếm xung, cảnh báo ngưỡng, và xử lý stale/fallback khi mất thiết bị Modbus.

## Mục tiêu demo
- `Modbus_RTU_Read` đọc energy meter → `Scale` → `BACnet_AV` expose cho BMS.
- `PulseCounter` đếm xung từ DI (energy/water meter pulse) → kWh/m³.
- `AlarmHigh` ngưỡng (vd: công suất vượt giới hạn).
- Mất thiết bị Modbus → giá trị mang `quality=stale`, dùng `fallback` (không kẹt graph).

## Component dùng
`Modbus_RTU_Read` · `Scale` · `BACnet_AV` · `DI_Input` · `PulseCounter` · `AlarmHigh`

## IO / Modbus / BACnet map
| Signal | Nguồn | BACnet |
|--------|-------|--------|
| Active power | Modbus RTU bus1 slave5 (FC4 addr 0) | AV |
| Energy pulse | DI ch2 | — |
| Pulse count (kWh) | `PulseCounter` | AV |
| Over-power alarm | `AlarmHigh` | BV |

## graph.json (rút gọn)
```json
{
  "schema_version": "1.0",
  "device": { "bacnet_device_id": 1003, "name": "ENERGY_GW", "scan_ms": 1000 },
  "io_map": { "di": ["pulse@ch2"] },
  "modbus": { "rtu": [ { "bus": 1, "slave": 5, "points": [ { "fc": 4, "addr": 0, "type": "int16" } ] } ] },
  "nodes": [
    { "id": "pwr",   "type": "Modbus_RTU_Read", "params": { "bus": 1, "slave": 5, "fc": 4, "addr": 0, "type": "int16", "scale": 0.1, "fallback": 0 } },
    { "id": "pwr_s", "type": "Scale",           "params": { "in_lo": 0, "in_hi": 1000, "out_lo": 0, "out_hi": 1000 } },
    { "id": "pwr_av","type": "BACnet_AV",       "params": { "instance": 10, "name": "ActivePower" } },
    { "id": "ovr",   "type": "AlarmHigh",       "params": { "limit": 800, "hysteresis": 20 } },
    { "id": "ovr_bv","type": "BACnet_BV",       "params": { "instance": 11, "name": "OverPowerAlarm" } },
    { "id": "pulse", "type": "DI_Input",        "params": { "channel": 2 } },
    { "id": "kwh",   "type": "PulseCounter",    "params": { "scale": 0.001 } },
    { "id": "kwh_av","type": "BACnet_AV",       "params": { "instance": 12, "name": "EnergyKWh" } }
  ],
  "links": [
    { "from": "pwr.out",   "to": "pwr_s.in" },
    { "from": "pwr_s.out", "to": "pwr_av.in" },
    { "from": "pwr_s.out", "to": "ovr.in" },
    { "from": "ovr.out",   "to": "ovr_bv.in" },
    { "from": "pulse.out", "to": "kwh.pulse" },
    { "from": "kwh.count", "to": "kwh_av.in" }
  ],
  "meta": { "author": "example", "rev": 1 }
}
```

## Acceptance points
- [ ] BMS đọc ActivePower (AV) cập nhật từ Modbus RTU.
- [ ] Vượt ngưỡng → OverPowerAlarm (BV) bật, có hysteresis.
- [ ] `PulseCounter` cộng theo cạnh lên DI; giữ qua mất điện.
- [ ] Rút meter Modbus → `pwr` thành stale, dùng `fallback`, graph vẫn chạy (không treo).

> ⚠️ graph.json đây là minh họa — chốt chính xác theo GRAPH_SCHEMA + MODBUS_REGISTER_MAP khi ổn định.
