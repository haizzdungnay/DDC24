# Component Library (Rev A) — MK-DDC-24

> **Document ID:** DDD-COMPLIB-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-06-08
> **Trạng thái:** Draft — Nguồn-chuẩn DUY NHẤT cho `type` component Rev A
> 📘 **Đọc cùng:** [GRAPH_SCHEMA](../interfaces/GRAPH_SCHEMA_MK-DDC-24_VI.md) ·
> [SW_RUNTIME_EXECUTION_MODEL](SW_RUNTIME_EXECUTION_MODEL_MK-DDC-24_VI.md) · [REVA_SCOPE](../../01_specs/REVA_SCOPE_ROADMAP_MK-DDC-24_VI.md)

> ⚠️ Rev A là **bộ component CỐ ĐỊNH**. User composite component & component nâng cao
> → Rev B (xem REVA_SCOPE §3). Mỗi `type` ở đây là một `node.type` hợp lệ trong graph.json.

---

## 1. Quy ước contract

Mỗi component khai: **ports** (in/out, kiểu `float`/`bool`/`int`), **params** (tĩnh),
**state** (có/không), **power_on** (bắt buộc nếu output ra AO/DO).

Kiểu: `f`=float, `b`=bool, `i`=int. `[S]` = stateful (giữ state qua scan).

## 2. IO components

| type | in | out | params | ghi chú |
|------|----|----|--------|---------|
| `AI_Input` | — | `out:f` | `channel`, `sensor`, `filter?` | đọc 1 kênh AI (qua IOP), kèm quality |
| `DI_Input` | — | `out:b` | `channel`, `invert?` | đọc 1 kênh DI |
| `AO_Output` | `in:f` | — | `channel`, `mode`(0-10V/4-20mA), `limit_lo`, `limit_hi` | **power_on bắt buộc**; clamp theo limit |
| `DO_Output` | `in:b` | — | `channel` | **power_on bắt buộc** |
| `Setpoint` | — | `out:f` | `default`, `min?`, `max?` | giá trị chỉnh được (qua web/BACnet AV) |

## 3. Logic components

| type | in | out | params |
|------|----|----|--------|
| `AND` | `a:b`,`b:b` | `out:b` | — |
| `OR` | `a:b`,`b:b` | `out:b` | — |
| `NOT` | `in:b` | `out:b` | — |
| `Compare_GT` | `a:f`,`b:f` | `out:b` | `hysteresis?` |
| `Compare_LT` | `a:f`,`b:f` | `out:b` | `hysteresis?` |
| `ManualAuto` | `auto:f`,`manual:f`,`sel:b` | `out:f` | — (sel=true → manual) |

## 4. Timer components `[S]`

| type | in | out | params | state |
|------|----|----|--------|-------|
| `OnDelay` | `in:b` | `out:b` | `delay_s` | accumulator |
| `OffDelay` | `in:b` | `out:b` | `delay_s` | accumulator |

## 5. Math components

| type | in | out | params |
|------|----|----|--------|
| `Scale` | `in:f` | `out:f` | `in_lo`,`in_hi`,`out_lo`,`out_hi` (linear) |
| `Limit` | `in:f` | `out:f` | `lo`,`hi` (clamp) |

## 6. Control components

| type | in | out | params | state |
|------|----|----|--------|-------|
| `PID` `[S]` | `pv:f`,`sp:f`,`enable?:b` | `out:f` | `kp`,`ki`,`kd`,`out_lo`,`out_hi`,`direction`(direct/reverse) | integrator, prev_error; anti-windup clamp tại out_lo/out_hi |
| `SafeState` | `in:f`,`good:b` | `out:f` | `safe_value` | — (good=false → out=safe_value) |

## 7. Alarm components

| type | in | out | params |
|------|----|----|--------|
| `AlarmHigh` | `in:f` | `out:b` | `limit`,`hysteresis?` |
| `AlarmLow` | `in:f` | `out:b` | `limit`,`hysteresis?` |

## 8. Protocol components

| type | in | out | params | ghi chú |
|------|----|----|--------|---------|
| `Modbus_RTU_Read` | — | `out:f` | `bus`,`slave`,`fc`,`addr`,`type`,`scale`,`fallback` | giá trị từ cache (mkddc-iobus); quality theo poll |
| `Modbus_RTU_Write` | `in:f` | — | `bus`,`slave`,`fc`,`addr`,`type`,`scale` | đẩy vào write-queue |
| `Modbus_TCP_Read` | — | `out:f` | `host`,`unit`,`fc`,`addr`,`type`,`scale`,`fallback` | |
| `BACnet_AV` | `in:f?` | `out:f` | `instance`,`name`,`writable` | map Setpoint/command ↔ BACnet AV |
| `BACnet_BV` | `in:b?` | `out:b` | `instance`,`name`,`writable` | |

> BACnet AI/AO/BI/BO không cần component riêng: phát sinh tự động từ `io_map`
> (`AI_Input→AI`, `DI_Input→BI`, `AO_Output→AO`, `DO_Output→BO`) theo §11 product
> definition. `BACnet_AV/BV` dùng cho điểm ảo (setpoint/mode).

## 9. Đếm số component Rev A

IO 5 + Logic 6 + Timer 2 + Math 2 + Control 2 + Alarm 2 + Protocol 5 = **24 type**
(tập "~15 cốt lõi + protocol/mapping"). Khớp REVA_SCOPE §2.

## 10. KHÔNG có trong Rev A (→ Rev B/C)

`PulseCounter`,`VirtualPoint`,`Selector`,`PrioritySelect`,`PulseTimer`,`RuntimeCounter`,
`IntervalTimer`,`Add/Subtract/Multiply/Divide/Average/Min/Max/LowPassFilter`,
`TwoPositionControl`,`StageControl`,`LeadLag`,`SequenceStep`,`Interlock`,
`WeeklySchedule`,`HolidaySchedule`,`AlarmStatusMismatch`,`AlarmDelay`,`AlarmLatch`,
**user composite component**. (Danh sách đầy đủ tầm nhìn: product definition §8–9.)
