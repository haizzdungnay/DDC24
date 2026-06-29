# ADR-010 — IOP V2 Poll + Capability Map

| Trường | Giá trị |
|--------|---------|
| **ID** | ADR-010 |
| **Ngày** | 2026-06-25 |
| **Status** | Accepted |
| **Người quyết định** | Owner (chuongpham06011989pt@gmail.com) |
| **Thay thế** | IOP v1.1 (shared/iop_protocol.h@Contract Freeze 2026-06-11) |

---

## Context

Sau khi hoàn thành HW Rev A (16 UI analog, 0 DI base SKU, PT100/PT1000 không lắp), bản phân tích gap/conflict 2026-06-25 xác định 3 vấn đề cần giải quyết trước khi viết MCU FW:

1. **Kênh UI tăng từ 8 → 16** — `IOP_IO_RESP_LEN=34` chỉ chứa 8 UI × 3 byte = 24 byte; cần 16 UI.
2. **Encoding sai** — SW dùng uint24 BE, rồi sign-extend trong `iop_s24()`; HW yêu cầu int32 signed trực tiếp.
3. **Không có capability map** — MCU không khai báo board variant; SOM không biết hardware đang kết nối hỗ trợ gì.

Song song tồn tại draft `IOP_PROTOCOL.md` Rev 2.0 (không phải contract) với frame push 86-byte không tương thích với mô hình poll hiện có.

Tất cả 3 vấn đề trên cần được giải quyết trong **một breaking change version** để tránh protocol versioning phức tạp.

## Candidates được đánh giá

| Option | Mô tả | Loại |
|--------|-------|------|
| A | Giữ v1.1, patch payload lên 8→16 UI | Patch — vẫn uint24, vẫn 8 channel count |
| B | **IOP V2 Poll + Capability Map** (được chọn) | Clean break, signed int32, 16 UI, capability map |
| C | Push frame 86-byte (IOP_PROTOCOL.md draft) | Đổi transport model → phá IopClient state machine |
| D | Dual protocol (v1 poll + v2 push song song) | Complexity không cần thiết |

## Decision

**Chọn Option B — IOP V2 Poll + Capability Map.**

### Quy tắc cố định

| Quy tắc | Giá trị |
|---------|---------|
| Transport model | **Poll** — SOM master, MCU slave, SOM gửi `CMD_GET_IO`, MCU trả lời `CMD_IO_RESP` |
| Version | `IOP_VER_MAJOR=2`, `IOP_VER_MINOR=0` |
| Endianness | **Big-endian** tất cả multi-byte field |
| CRC | CRC-16/Modbus, **HI trước LO sau** |
| UI raw encoding | **`int32_t` signed BE** (4 byte/channel, sign-extended từ ADS131M08 s24) |
| Frame envelope | **Không đổi**: `SOF | LEN | CMD | SEQ | PAYLOAD[LEN] | CRC_HI | CRC_LO` |
| IO_RESP payload | **74 byte** (xem bảng bên dưới) |

### IO_RESP payload v2 (74 byte)

```
offset  size  type     tên             mô tả
[0..63]  64   int32×16  UI_RAW[16]     ADS131M08 s24 sign-extended to int32, BE
[64]      1   uint8     ADC1_STAT      chip status ADS #1 (ch 1-8)
[65]      1   uint8     ADC2_STAT      chip status ADS #2 (ch 9-16)
[66..67]  2   int16 BE  MCU_TEMP       0.1°C
[68..69]  2   uint16 BE FAULT_FLAGS    IOP_FAULT_* v2
[70..71]  2   uint16 BE SAMPLE_CNT    wrap counter
[72]      1   uint8     DO_FB_MASK     bit0..3 = DO1..DO4 relay feedback
[73]      1   uint8     reserved       0x00
```

**Không có DI_MASK** — base SKU Rev A không có DI.

### FAULT_FLAGS v2 (bit layout mới)

```
bit 0  ADC1_FAULT       ADS131M08 #1 (ch1-8) no valid samples 100ms
bit 1  ADC2_FAULT       ADS131M08 #2 (ch9-16) no valid samples 100ms
bit 2  DAC_FAULT        DAC8554 no SPI response
bit 3  UI_OV            any UI > 110% FS
bit 4  RELAY_STUCK      DO feedback ≠ cmd after 20ms (sticky clear by GET_DIAG)
bit 5  WDG_RESET        sticky: boot after IWDG/WWDG reset
bit 6  MCU_OVERTEMP     MCU_TEMP > 85.0°C
bit 7  VDD_FAULT        VDD outside [3.0, 3.6]V
bit 8-15 reserved       always 0
```

### HANDSHAKE_RESP payload v2 (8 byte — tăng từ 6)

```
[0..1]  uint16 BE  MCU_IOP_VERSION   major<<8 | minor
[2..3]  uint16 BE  MCU_FW_VERSION    major<<8 | minor
[4]     uint8      HS_STATUS         OK=0x00 / WARN=0x01 / INCOMPAT=0x02
[5]     uint8      reserved          0x00
[6..7]  uint16 BE  BOARD_CAP_MAP     capability bits (xem bên dưới)
```

### BOARD_CAP_MAP bits

```
bit 0  UI_16   16 UI analog (2× ADS131M08)
bit 1  DI_8    8 DI industrial (optional SKU module — Rev A base: 0)
bit 2  DO_4    4 DO relay
bit 3  AO_4    4 AO (DAC8554)
bit 4  RTD     PT100/PT1000 circuit populated (Rev A: 0)
bit 5-15 reserved
```

**Rev A base SKU**: `BOARD_CAP_MAP = 0x000D` (UI_16 | DO_4 | AO_4)

### Rev A hardware constraints

- 16 UI analog — `KX_N_UI = 16`
- 0 DI base SKU — DI_MASK bị loại khỏi IO_RESP; `di_state[]` trong SHM luôn 0 cho base SKU
- PT100/PT1000 — circuit không lắp; SensorType enum giữ nguyên nhưng quality = BAD khi configure

## Consequences

### Positive
- Protocol sạch, không cần sign-extend trong SW (data đã signed khi nhận)
- SOM biết hardware variant ngay tại handshake → có thể validate config phù hợp board
- Một breaking change duy nhất, không có legacy dual-protocol
- ADC dual-chip có fault bit riêng (ADC1/ADC2)

### Negative / Risks
- **Breaking change**: MCU FW phải viết lại từ đầu theo v2 (không backward compatible v1.1)
- Test vector CRC cần cập nhật (payload size đổi)
- `shared/iop_protocol.h` Contract Freeze 2026-06-11 bị supersede bởi ADR này

### Files phải cập nhật

| File | Thay đổi |
|------|---------|
| `shared/iop_protocol.h` | v2.0, new payload, BOARD_CAP_MAP, new FAULT bits, `iop_be32s()` |
| `shared/mkddc_shm.h` | `KX_N_UI=16` |
| `services/iobus/io/io_types.hpp` | `int32_t ui_raw[16]`, `adc1_stat/adc2_stat`, remove `di_mask` |
| `services/iobus/io/io_scaling.hpp/.cpp` | `ui_to_eng(int32_t raw_s32, ...)` |
| `services/iobus/iop/iop_parser.cpp` | parse 74-byte payload |
| `services/iobus/config/iobus_config.hpp` | 16-element `ui_sensor[]` default |
| `services/iobus/iop/iop_client.cpp` | read BOARD_CAP_MAP từ HANDSHAKE_RESP[6..7] |
| `tools/fake_mcu/fake_mcu.cpp` | emit 74-byte IO_RESP, HANDSHAKE_RESP 8 byte + BOARD_CAP_MAP |
| `services/iobus/tests/test_iop_parser.cpp` | test cases theo layout mới |
| `services/iobus/tests/test_io_scaling.cpp` | gọi `ui_to_eng(int32_t, ...)` |
| `hardware-design/05_mcu_io/IOP_PROTOCOL.md` | finalize Rev 2.0 (không còn draft) |

## Revision history

| Rev | Ngày | Nội dung |
|-----|------|---------|
| 1.0 | 2026-06-25 | Initial — Status=Accepted (owner verbal approval) |
