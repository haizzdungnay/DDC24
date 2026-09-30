# IOP Protocol Specification — MK-DDC-24 Rev A

> **Document:** IOP_PROTOCOL | Rev 2.1 | 2026-06-30
> **Scope:** SOM ↔ MCU communication protocol for 16 UI Rev A hardware
> **Trạng thái hiện nay:** Lịch sử V2.x; không là hợp đồng tích hợp mới. Trạng thái APPROVED dưới đây chỉ phản ánh thời điểm Rev 2.1. Nguồn mục tiêu là ICD V3.0 theo ADR-064.
> **Source hiện có:** `contracts/iop/iop_protocol.h` còn V2.0 và phải được thay trước P1; file này không có quyền thắng ICD V3.0.

> ⚠️ **SUPERSEDED cho tích hợp mới (2026-09-30).** Chủ dự án chọn IOP V3.0 duy nhất theo [ADR-064](../../../adr/ADR-064-iop-v3-hai-bien-the.md); [ICD V3.0](../../../01_specs/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md) là bản để hai team ký. File này chỉ giữ lịch sử V2.x, không là phương án fallback.

---

## 1. Transport Model

| Quy tắc | Giá trị |
|---------|---------|
| Model | **Poll** — SOM là master, MCU là slave |
| SOM → MCU | `CMD_GET_IO` (2ms cadence, 500 Hz) |
| MCU → SOM | `CMD_IO_RESP` (trả lời mỗi `CMD_GET_IO`) |
| MCU không tự push | MCU chỉ trả lời khi nhận lệnh từ SOM |

Không dùng push model. Không dùng dual protocol.

Timing source of truth is `contracts/iop/iop_protocol.h`:

| Constant | Value | Meaning |
|---|---:|---|
| `IOP_GET_IO_PERIOD_MS` | 2 ms | SOM sends `CMD_GET_IO` at 500 Hz. |
| `IOP_RESP_TIMEOUT_MS` | 3 ms | Response deadline for a transaction. |
| `IOP_FAULT_TIMEOUT_MS` | 20 ms | Ten consecutive poll periods without a valid response. |
| `IOP_SAFE_TIMEOUT_MS` | 200 ms | MCU forces outputs to their configured safe state when SOM polling is absent. |

---

## 2. Frame Envelope

Frame bất biến từ v1 — KHÔNG thay đổi trong v2:

```
SOF | LEN | CMD | SEQ | PAYLOAD[LEN] | CRC_HI | CRC_LO
```

| Field | Size | Value |
|-------|------|-------|
| SOF | 1 | `0xAA` |
| LEN | 1 | byte count của PAYLOAD |
| CMD | 1 | command code |
| SEQ | 1 | sequence counter (SOM tăng, MCU echo) |
| PAYLOAD | LEN | nội dung theo CMD |
| CRC | 2 | CRC-16/Modbus, **big-endian: HI trước, LO sau** |

**Endianness:** tất cả multi-byte field trong PAYLOAD đều big-endian.

---

## 3. Version

`IOP_VER_MAJOR = 2`, `IOP_VER_MINOR = 0`

Breaking changes so với v1.1:
- IO_RESP: 8 × uint24 (34B) → 16 × int32 (74B); bỏ DI_MASK; thêm ADC1_STAT, ADC2_STAT
- FAULT_FLAGS: restructured — bit positions thay đổi (xem §6)
- HANDSHAKE_RESP: 6B → 8B; thêm BOARD_CAP_MAP

---

## 4. IO_RESP Payload — 74 bytes

`CMD_GET_IO` (LEN=0) → `CMD_IO_RESP` (LEN=74)

```
offset  size  type       field          mô tả
[0..63]  64   int32×16  UI_RAW[16]    ADS131M08 s24 sign-extended to int32, BE
[64]      1   uint8     ADC1_STAT     chip status ADS131M08 #1 (ch1-8)
[65]      1   uint8     ADC2_STAT     chip status ADS131M08 #2 (ch9-16)
[66..67]  2   int16 BE  MCU_TEMP      0.1°C
[68..69]  2   uint16 BE FAULT_FLAGS   v2 bit layout (xem §6)
[70..71]  2   uint16 BE SAMPLE_CNT    wrap counter
[72]      1   uint8     DO_FB_MASK    bit0..3 = DO1..DO4 relay feedback
[73]      1   uint8     reserved      0x00
```

**Không có DI_MASK** — base SKU Rev A không có DI.

### 4.1 Command registry

This table mirrors `contracts/iop/iop_protocol.h`. A documentation change must not alter an opcode or length without changing the contract header, bumping IOP version, and updating ADR-010.

| Opcode | Command | Direction | LEN | Successful response |
|---:|---|---|---:|---|
| `0x01` | `CMD_GET_IO` | SOM -> MCU | 0 | `CMD_IO_RESP` (`0x02`, LEN 74) |
| `0x10` | `CMD_SET_AO` | SOM -> MCU | 8 | `CMD_ACK` with echoed command |
| `0x11` | `CMD_SET_DO` | SOM -> MCU | 2 | `CMD_ACK` with echoed command |
| `0x13` | `CMD_SET_AO_CFG` | SOM -> MCU | 1 | `CMD_ACK` with echoed command |
| `0x20` | `CMD_GET_DIAG` | SOM -> MCU | 0 | `CMD_DIAG_RESP` (`0x21`, LEN 20) |
| `0x30` | `CMD_HANDSHAKE` | SOM -> MCU | 4 | `CMD_HANDSHAKE_RESP` (`0x31`, LEN 8) |
| `0x40` | `CMD_RESET_IO` | SOM -> MCU | 1 | `CMD_ACK` with echoed command |

Invalid command, length, CRC, busy state, safe state, or incompatible version returns `CMD_NACK` (`0xFE`, LEN 2) with `[echoed_cmd][error_code]`.

### 4.2 AO/DO command payloads

`CMD_SET_AO` carries four unsigned 16-bit big-endian DAC values in AO1..AO4 order:

```text
[0..1] AO1_RAW  [2..3] AO2_RAW  [4..5] AO3_RAW  [6..7] AO4_RAW
```

- 0-10 V mode: `V = raw / 65535 * 10`.
- 4-20 mA mode: `mA = 4 + raw / 65535 * 16`.

`CMD_SET_DO` payload is `[mask][value]`; bits 0..3 address DO1..DO4. A bit changes only when its `mask` bit is 1.

`CMD_SET_AO_CFG` payload is one mode bitmask; bit `i` is 0 for 0-10 V and 1 for 4-20 mA on AO channel `i`.

### UI_RAW encoding

ADS131M08 là ADC 24-bit signed two's-complement. MCU sign-extends kết quả lên int32 trước khi truyền:

```
// MCU side (C pseudocode):
int32_t raw_s32 = sign_extend_24(adc_result);  // -8388608 .. +8388607
put_big_endian_int32(&frame[4 * ch], raw_s32);
```

SOM đọc bằng `iop_be32s()` helper — không cần sign-extend thêm.

### ADC_STAT bits

```
bit 0  DRDY_OK     DRDY pulse nhận trong cửa sổ mẫu gần nhất (normal = 1)
bit 1  LOCK        ADS131 LOCK bit — SPI communication error
bit 2  CRC_FAULT   ADS131 REGMAP_CRC_ERR
```

---

## 5. HANDSHAKE

### CMD_HANDSHAKE payload (SOM → MCU, LEN=4)

```
[0..1]  uint16 BE  SOM_IOP_VERSION  major<<8 | minor  (= 0x0200)
[2..3]  uint16 BE  SOM_CAP_MAP      IOP_CAP_DIAG(bit0) | IOP_CAP_RESET_IO(bit1)
```

### CMD_HANDSHAKE_RESP payload (MCU → SOM, LEN=8)

```
[0..1]  uint16 BE  MCU_IOP_VERSION  major<<8 | minor
[2..3]  uint16 BE  MCU_FW_VERSION   major<<8 | minor
[4]     uint8      HS_STATUS        0x00=OK / 0x01=WARN / 0x02=INCOMPAT
[5]     uint8      reserved         0x00
[6..7]  uint16 BE  BOARD_CAP_MAP    capability bits (xem §7)
```

---

## 6. FAULT_FLAGS v2 — bit layout

**BREAKING CHANGE** so với v1: ADC2_FAULT mới ở bit1; các bit còn lại shift +1.

```
bit  name              set khi                                   sticky?
 0   ADC1_FAULT        ADS131M08 #1 no valid samples 100ms       không
 1   ADC2_FAULT        ADS131M08 #2 no valid samples 100ms       không
 2   DAC_FAULT         DAC8554 no SPI response                   không
 3   UI_OV             any UI > 110% full scale                  không
 4   RELAY_STUCK       DO feedback ≠ cmd after 20ms              không
 5   WDG_RESET         boot sau IWDG/WWDG reset                  STICKY (clear by GET_DIAG)
 6   MCU_OVERTEMP      MCU_TEMP > 85.0°C                         không
 7   VDD_FAULT         VDD ngoài [3.0, 3.6]V                     không
8-15 reserved          luôn 0                                    —
```

---

## 7. BOARD_CAP_MAP

```
bit  name     mô tả                                    Rev A base SKU
 0   UI_16    16 UI analog (2× ADS131M08)              1
 1   DI_8     8 DI industrial (optional SKU module)    0
 2   DO_4     4 DO relay                               1
 3   AO_4     4 AO (DAC8554)                           1
 4   RTD      PT100/PT1000 circuit populated            0
5-15 reserved                                          0
```

**Rev A base SKU:** `BOARD_CAP_MAP = 0x000D` (UI_16 | DO_4 | AO_4)

---

## 8. CRC

CRC-16/Modbus: poly `0xA001`, init `0xFFFF`. Tính trên toàn frame từ SOF đến hết PAYLOAD. Truyền **HI trước, LO sau**.

Test vector:
```
{0xAA, 0x00, 0x01, 0x00} → CRC = 0x6C20
GET_IO SEQ=1 hoàn chỉnh: AA 00 01 01 AC E1
```

---

## 9. Rev A Hardware Constraints

| Constraint | Giá trị |
|-----------|---------|
| UI channels | 16 |
| DI (base SKU) | 0 — DI_MASK không có trong IO_RESP |
| DO | 4 relay |
| AO | 4 (DAC8554) |
| PT100/PT1000 | Circuit không lắp — SensorType vẫn parse nhưng quality = BAD |
| ADC | 2× ADS131M08, 8 ch/chip |

---

## Revision History

| Rev | Ngày | Nội dung |
|-----|------|---------|
| 1.0-draft | 2026-06-23 | Initial draft (push model, 86B frame) — SUPERSEDED |
| 2.0-draft | 2026-06-23 | Rev A 16 UI frame — SUPERSEDED |
| **2.0** | **2026-06-25** | **Approved: poll model, 74B IO_RESP, BOARD_CAP_MAP, v2 FAULT bits. Governing: ADR-010 + contracts/iop/iop_protocol.h** |
| **2.1** | **2026-06-30** | **Documented the 2 ms timing constants and AO/DO/diagnostic command registry from the shared header.** |
| 2.2 | 2026-09-30 | SUPERSEDED: nội dung chuyển sang ICD `IOP-SPEC-MK-DDC-24-VI` v2.0; không sửa thêm ở file này. |
