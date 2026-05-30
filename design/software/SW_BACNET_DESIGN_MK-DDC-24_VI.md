# Service Design — `kinexus-bacnet` (SW)
## BACnet/IP + MS/TP stack — code-ready

> **Document ID:** DDD-SWSVC-BAC-MK-DDC-24-VI · **Rev** 1.0 | 2026-05-30
> 📘 [spec/README](../../spec/README.md) · **Trace:** `SW-BAC-001..008`, [D-3 PICS](../interfaces/BACNET_PICS_EPICS_MK-DDC-24_VI.md)

---

## 1. Nhiệm vụ
Phục vụ BMS qua BACnet: trả/ghi object, COV, alarm, time-sync. Dữ liệu lấy từ `kinexus_plc_shm`.

## 2. Nền tảng: bacnet-stack 1.3.x
- Dùng thư viện **bacnet-stack** (open source, ứng viên BTL) — **không tự viết stack** (SW_ARCH §7).
- Implement các callback object (Read/Write_Property) trỏ vào `plc_shm`.

## 3. Khởi tạo
```c
// đọc bacnet.conf (D-5): bip enabled/port, mstp mac/baud
bip_init(udp_port=47808);            // BACnet/IP Annex J
dlmstp_init(mac, baud);             // MS/TP (nếu rs485_mode=bacnet-mstp)
Device_Set_Object_Instance_Number(device_id);   // từ device.conf, fallback DIP
// đăng ký object: AI8, AO4, AV32, BI8, BO4, BV16, MSV8, TrendLog8, Schedule8...
```

## 4. Ánh xạ object ↔ shared memory
| Object | Đọc từ | Ghi vào |
|--------|--------|---------|
| AI1–8 / BI1–8 | `plc_shm.ai/bi` | (read-only) |
| AO1–4 / BO1–4 | `plc_shm.ao/bo` | Write-Property → `plc_shm` (priority array) |
| AV/BV/MSV | `plc_shm.av/bv/msv` | Write-Property → `plc_shm` |

```c
// Read_Property callback (AI)
float Analog_Input_Present_Value(uint32_t inst){
    return plc_shm_read_ai(inst);    // seqlock read
}
// Write_Property callback (AO) → ghi shm, PLC scan sau áp dụng
void Analog_Output_Present_Value_Set(uint32_t inst, float v, uint8_t prio){
    plc_shm_write_ao(inst, v, prio); // priority array 16 mức
}
```

## 5. Dịch vụ BACnet (BIBBs — D-3)
- Who-Is/I-Am (≤100ms — SW-BAC-005), Read/Write-Property(-Multiple), Subscribe-COV.
- COV: AI/AO/AV theo COV_Increment; BI/BO/BV/MSV theo đổi trạng thái (SW-BAC-004).
- Confirmed-Event-Notification (alarm) qua Notification Class; nhận từ `alarm.sock`.
- Time-Sync (master/slave), ReinitializeDevice.

## 6. Reliability map (fault → BACnet)
| Fault | Reliability |
|-------|-------------|
| E201 over-range | OVER_RANGE |
| E203 open | OPEN_LOOP |
| E204 short | SHORTED_LOOP |
| IOP fault | giữ giá trị + Status_Flags FAULT |

## 7. Failsafe (SW-BAC-008)
Mất BMS > 30s → set alarm E301, PLC chuyển standalone (BACnet vẫn chạy local).

## 8. RS-485 chia sẻ
`rs485_mode` (D-5): `bacnet-mstp` (mặc định) HOẶC `modbus-rtu` — **không đồng thời**. Đổi cần reboot.

## 9. Test (gate G4 — bắt buộc)
- BTL conformance 100% (T-SW-056). Who-Is<100ms (T-SW-050). COV ≤200ms (T-SW-053).

## 10. Trace REQ
`SW-BAC-001..008`, `BAC-001..011`, `FR-020/021`, `NFR-009`.

---
**Rev** 1.0 | 2026-05-30
