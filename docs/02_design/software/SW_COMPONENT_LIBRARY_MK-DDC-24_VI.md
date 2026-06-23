# Component Library (Rev A) — MK-DDC-24

> **Document ID:** DDD-COMPLIB-MK-DDC-24-VI
> **Phiên bản:** 1.1 | 2026-06-08
> **Trạng thái:** Approved (Owner 2026-06-08)
> 📘 **Đọc cùng:** [GRAPH_SCHEMA](../interfaces/GRAPH_SCHEMA_MK-DDC-24_VI.md) ·
> [SW_RUNTIME_EXECUTION_MODEL](SW_RUNTIME_EXECUTION_MODEL_MK-DDC-24_VI.md) · [REVA_SCOPE](../../01_specs/REVA_SCOPE_ROADMAP_MK-DDC-24_VI.md) ·
> [ADR-008](../../adr/ADR-008-bms-edge-positioning-and-revA-component-set.md)

> ⚠️ Rev A là **bộ component CỐ ĐỊNH (28 type)**. User composite component & component nâng cao
> → Rev B (xem REVA_SCOPE §3). Mỗi `type` ở đây là một `node.type` hợp lệ trong graph.json.
> 4 component BMS tổng quát (Interlock, AlarmDelay, RuntimeCounter, PulseCounter) được đưa
> vào Rev A.0 theo [ADR-008](../../adr/ADR-008-bms-edge-positioning-and-revA-component-set.md).

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

## 4. Timer / Counter components `[S]`

| type | in | out | params | state |
|------|----|----|--------|-------|
| `OnDelay` | `in:b` | `out:b` | `delay_s` | accumulator |
| `OffDelay` | `in:b` | `out:b` | `delay_s` | accumulator |
| `RuntimeCounter` | `run:b`,`reset?:b` | `hours:f`,`alarm:b` | `maint_hours?` | giờ tích lũy (giây→giờ); `alarm=true` khi ≥ `maint_hours`; snapshot/persist |
| `PulseCounter` | `pulse:b`,`reset?:b` | `count:f` | `scale?`,`rollover?` | đếm cạnh lên của `pulse` × `scale` (energy/water meter); snapshot/persist |

> `RuntimeCounter`/`PulseCounter` giữ state qua mất điện (snapshot + shutdown, theo
> SW_RUNTIME_EXECUTION_MODEL) để không mất giờ-chạy/số đếm. `reset` về 0 khi cạnh lên.

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
| `Interlock` | `request:b`,`permit:b` | `out:b`,`tripped:b` | `latch?` | out=request **chỉ khi** permit=true; permit=false → out=false (chặn) + tripped=true. `latch=true` → giữ trip tới khi `request` xuống (manual reset). State chỉ khi latch. |

## 7. Alarm components

| type | in | out | params |
|------|----|----|--------|
| `AlarmHigh` | `in:f` | `out:b` | `limit`,`hysteresis?` |
| `AlarmLow` | `in:f` | `out:b` | `limit`,`hysteresis?` |
| `AlarmDelay` `[S]` | `in:b` | `out:b` | `on_delay_s`,`off_delay_s?` |

> `AlarmDelay` debounce tín hiệu alarm: `out=true` chỉ khi `in` giữ true liên tục
> ≥ `on_delay_s` (chống báo giả ngoài công trình); nhả sau `off_delay_s`. State (accumulator)
> giữ qua scan, **không** persist qua mất điện (khác RuntimeCounter/PulseCounter).

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

IO 5 + Logic 6 + Timer 3 + Counter 1 + Math 2 + Control 3 + Alarm 3 + Protocol 5 = **28 type**.
(Timer 3 = OnDelay/OffDelay/RuntimeCounter; Counter 1 = PulseCounter; Control 3 =
PID/SafeState/Interlock; Alarm 3 = AlarmHigh/AlarmLow/AlarmDelay — ADR-008.) Khớp REVA_SCOPE §2.

## 10. KHÔNG có trong Rev A (→ Rev B/C)

`VirtualPoint`,`Selector`,`PrioritySelect`,`PulseTimer`,`IntervalTimer`,
`Add/Subtract/Multiply/Divide/Average/Min/Max/LowPassFilter`,
`TwoPositionControl`,`StageControl`,`LeadLag`,`SequenceStep`,
`WeeklySchedule`,`HolidaySchedule`,`AlarmStatusMismatch`,`AlarmLatch`,
**user composite component**. (Danh sách đầy đủ tầm nhìn: product definition §8–9.)

> Đã promote vào Rev A.0 (ADR-008, không còn deferred): `Interlock`, `AlarmDelay`,
> `RuntimeCounter`, `PulseCounter`.

## 11. Aux composites (Rev A parity)

Nhằm đáp ứng tính năng tương đương (parity) với EasySet trong Rev A (ADR-010), một số hàm phụ trợ (Auxiliary Functions) phức tạp được **compose** từ các node cơ bản trên. Giao diện (UI) chỉ đóng vai trò wizard tạo ra cụm node và link vào `graph.json`, KHÔNG tạo `type` mới.

Các cụm compose được định nghĩa:
- **Enable/Disable**: `DI_Input` hoặc `Setpoint` (bool) -> nối vào `permit` của `Interlock` (chặn output cuối).
- **Occupied/Unoccupied**: Nguồn bool (từ DI hoặc Setpoint) -> nối vào `sel` của `ManualAuto` để chọn giữa setpoint occupied và unoccupied.
- **Heating/Cooling switch**: Dùng `Compare_GT` / `Compare_LT` trên sai lệch để chọn nhánh PID heat hoặc cool.
- **Setpoint compensation**: Dùng `Scale` biến đổi OAT (Outdoor Air Temp) thành offset -> cộng vào setpoint gốc. Vì Rev A chưa có node Add/Subtract, giới hạn Rev A dùng `Scale` trực tiếp vào setpoint base (hoặc đánh dấu Rev A partial).
- **Economizer (Rev A partial)**: Dựng skeleton cơ bản: so sánh OAT < RAT bằng `Compare_LT` -> qua `Interlock` / `ManualAuto` -> điều khiển damper `AO_Output`. Economizer đầy đủ sẽ có trong Rev B.
