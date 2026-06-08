# Example — HVAC mini (Demo 1)

> Acceptance: [REVA_SCOPE §6 Demo 1](../../docs/01_specs/REVA_SCOPE_ROADMAP_MK-DDC-24_VI.md) ·
> Schema: [GRAPH_SCHEMA](../../docs/02_design/interfaces/GRAPH_SCHEMA_MK-DDC-24_VI.md) ·
> Components: [SW_COMPONENT_LIBRARY](../../docs/02_design/software/SW_COMPONENT_LIBRARY_MK-DDC-24_VI.md)

Ví dụ điều khiển HVAC tối giản — chứng minh đường điều khiển AI→PID→AO + alarm + BACnet expose.

## Mục tiêu demo
- AI nhiệt độ → `Scale` → `PID` → AO valve (0-10V).
- DI fan status → `AlarmHigh`/logic → DO fan enable + alarm khi fan fail.
- BACnet/IP expose AI/BI/AO/BO/AV/BV; BMS ghi setpoint qua AV.

## Component dùng
`AI_Input` · `Scale` · `Setpoint` · `PID` · `AO_Output` · `DI_Input` · `DO_Output` ·
`AlarmHigh` · `BACnet_AV`

## IO / BACnet / Modbus map
| Signal | Kênh | BACnet |
|--------|------|--------|
| Nhiệt độ phòng | AI ch0 | AI (auto từ io_map) |
| Setpoint | (AV) | AV writable |
| Van | AO ch0 | AO |
| Fan status | DI ch0 | BI |
| Fan enable | DO ch0 | BO |

Không dùng Modbus trong demo này.

## graph.json (rút gọn)
```json
{
  "schema_version": "1.0",
  "device": { "bacnet_device_id": 1001, "name": "HVAC_MINI", "scan_ms": 1000 },
  "io_map": { "ai": ["temp@ch0"], "ao": ["valve@ch0"], "di": ["fan_sts@ch0"], "do": ["fan_en@ch0"] },
  "nodes": [
    { "id": "temp",  "type": "AI_Input",  "params": { "channel": 0, "sensor": "ntc10k" } },
    { "id": "sp",    "type": "Setpoint",  "params": { "default": 24.0, "min": 16, "max": 30 } },
    { "id": "sp_av", "type": "BACnet_AV", "params": { "instance": 1, "name": "RoomSetpoint", "writable": true } },
    { "id": "pid1",  "type": "PID",       "params": { "kp": 2.0, "ki": 0.5, "kd": 0.0, "out_lo": 0, "out_hi": 100, "direction": "reverse" }, "power_on": { "out": 0.0 } },
    { "id": "valve", "type": "AO_Output", "params": { "channel": 0, "mode": "0-10V", "limit_lo": 0, "limit_hi": 100 }, "power_on": { "in": 0.0 } },
    { "id": "fan_s", "type": "DI_Input",  "params": { "channel": 0 } },
    { "id": "fan_e", "type": "DO_Output", "params": { "channel": 0 }, "power_on": { "in": false } },
    { "id": "fanal", "type": "AlarmHigh", "params": { "limit": 0.5 } }
  ],
  "links": [
    { "from": "temp.out", "to": "pid1.pv" },
    { "from": "sp_av.out", "to": "pid1.sp" },
    { "from": "pid1.out", "to": "valve.in" }
  ],
  "meta": { "author": "example", "rev": 1 }
}
```

## Acceptance points
- [ ] Setpoint thay đổi qua BACnet AV → PID đổi output van.
- [ ] Mất fan status (DI=0 khi đang enable) → alarm.
- [ ] BMS đọc được AI/BI/AO/BO/AV; ghi AV.
- [ ] Mất điện bật lại → giữ config, AO về power_on rồi PID tiếp tục.

> ⚠️ graph.json đây là minh họa — chốt chính xác theo GRAPH_SCHEMA khi engine ổn định.
