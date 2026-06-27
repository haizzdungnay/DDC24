# 10 — End-to-End Data Flow
## MK-DDC-24 — Các flow thật, từng bước

> **Document ID:** IMPL-E2EFLOW-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-06-10
> **Trạng thái:** Active
> **Dùng để:** hiểu đường dữ liệu để code đúng + debug khi sai. Mỗi flow = checklist khi lỗi.

> ⚠️ Mọi flow đi đúng: **Web ↔ core ↔ iobus ↔ UART/IOP ↔ MCU ↔ IO**. Không có shortcut.

---

## Flow 1 — DI hardware → Web (đọc trạng thái số)

```
1. Contact DI1 đóng (flow switch/relay phụ) → opto PC817 → MCU PB4 mức thay đổi.
2. MCU io_sample (1ms): debounce → di_mask bit0 = 1.
3. SOM iobus gửi GET_IO → MCU trả IO_RESP, byte[24] DI_MASK bit0=1.
4. iobus iop_parser → di_state[0]=1 → io_cache ghi kx_io_shm (seqlock).
5. core scan_loop đọc shm → point_table BI1.value=1, quality=good, ts mới.
6. web GET /api/v1/points/DI1 → core trả {value:true, quality:"good"}.
7. Web UI hiển thị DI1 = ON.
```
**Khi sai, kiểm:** opto/pin (1) → io_sample debounce (2) → IO_RESP byte24 (3) → shm di_state (4) → scan đọc shm (5) → REST (6).

---

## Flow 2 — UI analog → Web (đọc cảm biến)

```
1. Sensor (NTC/0-10V) → ADS131M08 kênh → MCU SPI3.
2. MCU io_sample: raw s24, moving average, spike reject.
3. GET_IO → IO_RESP byte[0..2]=UI1_RAW (uint24 BE).
4. iobus iop_parser: scale raw→engineering theo sensor_type (NTC10k Steinhart-Hart / 0-10V / 4-20mA).
5. io_cache ghi ui_value[0]=23.5, ui_unit="degC", ui_quality=good.
6. core point_table AI1.value=23.5.
7. web GET /points/UI1 → {value:23.5, unit:"°C", quality:"good"}.
```
**Khi sai, kiểm:** sensor_type config đúng? hệ số scale? raw có hợp lý không (UI_OV fault?).

---

## Flow 3 — Web → DO relay (bật relay thật)

```
1. User bấm "DO1 ON" trên web.
2. mkddc-web nhận PUT /api/v1/points/DO1 {value:true}.
3. web core_client gửi command cho mkddc-core (point=DO1, value=1, source=BACnet/Local prio).
4. core scan_loop bước 4: đưa vào command queue.
5. core priority_resolver: kiểm priority (nếu không bị fire/safety mức1 ghi đè) → DO1=ON.
6. core safe_state: IO không fault → giữ ON.
7. core output_writer: ghi kx_io_shm.do_cmd[0]=1.
8. iobus output_command: thấy do_cmd[0] đổi → build SET_DO {mask=0x01,value=0x01}.
9. iobus gửi SET_DO → MCU.
10. MCU iop_comm dispatch → xDoQueue → do_control bật PC0 → ULN2003 → relay đóng.
11. MCU trả ACK(0x11).
12. GET_IO kế: IO_RESP DO_FB_MASK bit0=1 (feedback).
13. iobus ghi do_feedback[0]=1 → core → web hiển thị DO1 ON (confirmed).
14. web audit log: {user, "DO1 ON", accepted}.
```
**Khi sai, kiểm:** web→core IPC (3)? priority ghi đè (5)? do_cmd shm (7)? SET_DO frame (8-9)? relay/feedback (10-12)?

---

## Flow 4 — Web → AO output (đặt analog)

```
1. User đặt AO1 = 5.0V (hoặc commissioning test).
2. web PUT /points/AO1 {value:5.0} → core_client → core.
3. core priority_resolver → AO1 setpoint=5.0V (eng).
4. core output_writer ghi kx_io_shm.ao_setpoint[0]=5.0.
5. iobus output_command: eng→raw (0-10V: raw=(5.0/10)*65535=32768), build SET_AO.
6. iobus gửi SET_AO → MCU → ACK.
7. MCU ao_output: ghi DAC8554 kênh0=32768 → LDAC pulse → ra ~5.0V.
8. Đo bằng đồng hồ: 5.0V (±sai số).
```
**Khi sai, kiểm:** ao_mode đúng (0-10V/4-20mA)? eng→raw clamp? LDAC pulse? DAC_FAULT?

---

## Flow 5 — BACnet command → output

```
1. BMS gửi BACnet WriteProperty (AO1, priority N) tới DDC.
2. iobus bacnet_datalink nhận → cập nhật kx_plc_shm.ao[0].priority[N].
3. core bacnet_objtable đọc → command queue (source=BACnet, prio 3).
4. core priority_resolver gộp với các nguồn khác.
5. → output_writer → kx_io_shm.ao_setpoint → iobus SET_AO → MCU → AO thật.
```
**Lưu ý:** BACnet KHÔNG ghi thẳng IO — chỉ ghi vào priority array mức 3.

---

## Flow 6 — Modbus data → core (thiết bị phụ)

```
1. iobus modbus_master poll slave RS485 (VFD/meter) async.
2. iobus ghi ext cache {name, value, quality, online, ts}.
3. core iobus_reader đọc ext → virtual point (AV).
4. graph component (vd Modbus_Read→Scale→BACnet_AV) chạy trong core.
5. Giá trị lên BACnet object table / web.
```
**Lưu ý:** Modbus poll chậm (100ms+) cô lập trong iobus; core thấy {value,quality,ts} → biết stale.

---

## Flow 7 — MCU fault → Web alarm

```
1. MCU phát hiện lỗi (vd ADC_FAULT) → set FAULT_FLAGS bit0.
2. IO_RESP byte[28..29] FAULT_FLAGS bit0=1.
3. iobus iop_parser → fault_flags shm; iobus_metrics phát alarm bus JSON.
4. core point_quality: UI quality=BAD; core đẩy alarm vào eventlog.
5. web GET /alarms → {"code":"ADC_FAULT","severity":"critical","msg":"..."}.
6. Web UI hiển thị "Cảm biến lỗi / mất tín hiệu".
```

---

## Flow 8 — UART timeout → safe-state

```
1. Rút cáp UART (hoặc MCU treo).
2. iobus GET_IO không nhận IO_RESP → retry ≤3 → iop_timeout++.
3. >100ms không IO_RESP hợp lệ → iobus iop_status=FAULT, gửi RESET_IO.
4. Song song MCU: không nhận GET_IO 200ms → MCU tự safe-state (AO=0V/4mA, DO=open).
5. iobus ghi iop_status=FAULT vào shm.
6. core safe_state: thấy FAULT → ghi safe output + quality BAD.
7. web: alarm "Mất kết nối MCU" + point quality bad.
8. Cắm lại UART → iobus HANDSHAKE lại (mỗi 5s) → NORMAL → IO trở lại.
```

---

## Bảng tra cứu nhanh (debug)

| Triệu chứng | Nghi ngờ bước | Flow |
|-------------|---------------|------|
| DI không lên web | io_sample debounce / IO_RESP byte24 / shm | 1 |
| Sai giá trị cảm biến | sensor_type / scale | 2 |
| Bấm DO không bật relay | core priority / do_cmd shm / SET_DO / ULN2003 | 3 |
| AO sai điện áp | ao_mode / eng→raw / LDAC | 4 |
| Web không báo lỗi khi rút UART | iobus timeout / iop_status / alarm bus | 8 |
| Relay bật rồi tự tắt | safe-state trigger nhầm / IOP timeout | 8 |

---
**Rev** 1.0 | 2026-06-10
