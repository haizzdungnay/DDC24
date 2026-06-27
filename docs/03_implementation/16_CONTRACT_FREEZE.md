# 16 — Contract Freeze
## MK-DDC-24 — Bản chốt hợp đồng kỹ thuật Rev A (1 trang để tra, hết tranh cãi)

> **Document ID:** IMPL-FREEZE-MK-DDC-24-VI
> **Phiên bản:** 1.0 | **Freeze date: 2026-06-11**
> **Trạng thái:** FROZEN — đổi bất kỳ mục nào dưới đây = thay đổi hợp đồng, phải theo §7.
> **Đối tượng đọc:** mọi dev trước khi viết dòng code đầu tiên.

---

## 1. Rule nguồn-chuẩn (precedence — học thuộc)

```
1. shared/iop_protocol.h  = chuẩn CUỐI cho: opcode, payload layout/length, enum,
                            FAULT bit, RESET reason, CRC, hằng số timing/baud.
2. shared/mkddc_shm.h     = chuẩn CUỐI cho: SHM layout, magic, path, field ownership, seqlock.
3. Mọi tài liệu .md (spec 01_specs, design 02_design, guide 03_implementation)
   = DIỄN GIẢI. Docs lệch header → HEADER THẮNG → sửa docs, không sửa header theo docs.
4. Giữa các docs với nhau → thứ tự ở 00_IMPLEMENTATION_README §9 + CANONICAL_DECISIONS.
```

## 2. IOP version + timing (frozen)

| Mục | Giá trị |
|-----|---------|
| IOP version | **1.1** (`IOP_VER_MAJOR=1, IOP_VER_MINOR=1`) — v1.1 = base + `SET_AO_CFG` |
| UART | `/dev/ttyS2`, **921600** 8N1, no flow control |
| Poll | GET_IO mỗi **10ms** (100Hz) · response timeout **10ms** · retry ≤**3** |
| Fault | >**100ms** không IO_RESP hợp lệ → FAULT (gửi RESET_IO reason 0x05) |
| Reconnect | HANDSHAKE lại mỗi **5s** · handshake timeout **1000ms** |
| MCU safe | không nhận GET_IO **200ms** → MCU tự safe-state |

## 3. FAULT_FLAGS (frozen — bảng duy nhất, macro `IOP_FAULT_*`)

| Bit | Tên | Set | Clear | Sticky |
|-----|-----|-----|-------|--------|
| 0 | ADC_FAULT | ADS131M08 không có mẫu hợp lệ 100ms | reinit OK | — |
| 1 | DAC_FAULT | DAC8554 không phản hồi SPI | ghi OK lại | — |
| 2 | UI_OV | UI > 110% full scale | mọi UI ≤ 110% | — |
| 3 | RELAY_STUCK | DO feedback ≠ lệnh sau 20ms | khớp lại | — |
| 4 | MCU_WATCHDOG_RESET | boot sau IWDG/WWDG reset | MCU nhận GET_DIAG đầu tiên sau boot | **Sticky** |
| 5 | MCU_OVERTEMP | temp > 85.0°C | < 80.0°C (hysteresis) | — |
| 6 | VDD_FAULT | VDD ngoài [3.0,3.6]V (+ ngừng AO) | trong dải | — |
| 7–15 | reserved | luôn 0 | — | — |

> ⚠️ Trước freeze, header cũ định nghĩa bit2=RELAY_STUCK/bit3=OVERTEMP/bit4=VDD/bit5=WDG —
> **SAI**, đã sửa theo bảng trên (khớp SWFW spec §4.3.1). Code nào dùng layout cũ phải sửa.

## 4. RESET_IO reason (frozen — macro `IOP_RESET_REASON_*`)

| Hex | Tên | Ai gửi / khi nào |
|-----|-----|-------------------|
| 0x00 | NORMAL | iobus, startup sau handshake (đưa IO về safe đã biết) |
| 0x01 | CORE_WDG | reserved Rev A (core liveness) |
| 0x02 | BMS_TIMEOUT | reserved Rev A |
| 0x03 | OPERATOR | web→core→iobus (commissioning) |
| 0x04 | OTA | iobus, trước khi nạp firmware MCU |
| 0x05 | IOP_FAULT | iobus, đường FAULT >100ms |

MCU: hành vi GIỐNG NHAU mọi reason (AO safe theo mode, DO open, log reason, ACK 0x40);
reason lạ → vẫn safe + ACK + log. **AO safe raw:** 0-10V → raw 0 (=0V); 4-20mA → **raw 0 (=4mA)**
(`IOP_AO_SAFE_CURR_RAW=0` — giá trị 13107 trong header cũ là SAI theo mapping spec).

## 5. CRC-16/Modbus (frozen)

Poly `0xA001` (reflected), init `0xFFFF`, scope SOF..PAYLOAD, truyền **HI trước LO sau**.
Hàm duy nhất: `iop_crc16()` trong header — không ai tự viết lại.

> 🔴 **Test vector cũ `0x84C0`/`0x556B` trong mọi tài liệu trước 2026-06-11 là SAI**
> (không khớp thuật toán). Bộ chuẩn 12 vector (đã verify bằng 2 implementation độc lập):
> [SWFW spec §10.1](../01_specs/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md). Hai vector tra nhanh:
> `{AA 00 01 00}→0x6C20` · `{AA 00 01 01}→0xACE1` · frame GET_IO SEQ=1 = `AA 00 01 01 AC E1`.

## 6. SHM + rename policy `kinexus → mkddc` (frozen)

| Mục | Quyết định Rev A |
|-----|-------------------|
| Header file | `shared/mkddc_shm.h` (renamed 2026-06-11). `shared/kinexus_shm.h` = shim deprecated, chỉ `#include`, sẽ xóa sau Rev A — code mới KHÔNG include nó |
| SHM path runtime | **`/dev/shm/mkddc_io_shm`** + **`/dev/shm/mkddc_plc_shm`** — KHÔNG alias, không còn `kinexus_*` |
| Struct/typedef/macro | **GIỮ** prefix `kx_`/`KX_` (binary + source contract, KHÔNG tự rename) |
| Magic | **GIỮ** `0x4B584401` ("KXD\1") |
| io_shm creator | `mkddc-iobus` (O_CREAT, init default, set magic cuối) — core/web chỉ attach |
| plc_shm creator | `mkddc-core` |
| Field ownership | duy nhất theo bảng [06 §5](06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md); ngoại lệ: core ghi `ao_setpoint[]/do_cmd[]`; iobus ghi `ao_mode[]` |
| Service/log/socket | `mkddc-core`/`mkddc-iobus`/`mkddc-web` · `/run/mkddc/` (alarm.sock, core.sock) |
| systemd order | iobus trước (tạo SHM) → core `After=mkddc-iobus` (Wants) → web sau core |
| `iop_protocol.h` | tên file giữ nguyên; guard đổi `MKDDC_IOP_PROTOCOL_H`; protocol gọi là "IOP" |

## 7. Quy trình đổi hợp đồng (khi BẮT BUỘC phải đổi)

```
1. Mở issue ghi rõ: field/bit/path đổi, lý do, ai bị ảnh hưởng (FW? iobus? core? web?).
2. Sửa header trong shared/ (1 commit riêng) + bump:
   - protocol đổi → IOP_VER_MINOR (tương thích) / IOP_VER_MAJOR (không tương thích)
   - SHM layout đổi → bump KX_SHM_MAGIC (vd "KXD\2") để reader cũ từ chối attach
3. Sửa docs diễn giải (spec + guide liên quan) CÙNG PR.
4. Cập nhật file này (bảng + freeze date mới).
5. Chạy lại cross-test CRC/parse 2 phía + integration test seqlock.
KHÔNG BAO GIỜ: sửa 1 bên, "tạm hardcode", hay fork header.
```

---
**Rev** 1.0 | 2026-06-11 · Header: [`iop_protocol.h`](../../shared/iop_protocol.h) ·
[`mkddc_shm.h`](../../shared/mkddc_shm.h) · Quick start: [17_QUICK_START_SOM_DEV](17_QUICK_START_SOM_DEV.md)
