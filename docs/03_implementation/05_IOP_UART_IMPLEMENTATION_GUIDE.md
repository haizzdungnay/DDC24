# 05 — IOP / UART Implementation Guide (hợp đồng MCU ↔ SOM)
## MK-DDC-24 — IOP v1.1 (tên cũ: Kinexus-IOP — rename policy: 15_CONTRACT_FREEZE §6)

> **Document ID:** IMPL-IOP-MK-DDC-24-VI
> **Phiên bản:** 1.2 | 2026-06-11 (Contract Freeze: FAULT bit6 VDD, bảng RESET reason, CRC vector đúng, header thắng)
> **Owner:** Dev 1 (MCU slave) + Dev 2 (SOM master) — **CẢ HAI bắt buộc đọc**
> **Nguồn-chuẩn CUỐI CÙNG:** [`shared/iop_protocol.h`](../../shared/iop_protocol.h) —
> mọi giá trị (opcode, payload, enum, FAULT bit, RESET reason, hằng số) lấy theo header.
> [SWFW_INTERFACE_SPEC](../01_specs/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md) và file này là
> **diễn giải**: lệch header → **header thắng**, sửa docs theo
> ([15_CONTRACT_FREEZE](15_CONTRACT_FREEZE.md)).

> ⚠️ File này là **HỢP ĐỒNG implement**. Nếu code MCU và code SOM bất đồng, sửa cho khớp
> `iop_protocol.h`. **KHÔNG fork/sửa 1 bên.** Đổi hợp đồng = bump `IOP_VER_*` +
> sửa cả 2 phía + cập nhật 15_CONTRACT_FREEZE + chạy lại cross-test.

---

## 0. Scope của tài liệu

```
File này CHỈ định nghĩa hợp đồng giao tiếp UART/IOP giữa MCU ↔ SOM:
- frame format
- CRC
- SEQ
- command list
- payload từng command
- timeout / retry
- startup sequence
- error handling
- state machine IOP
- public API tối thiểu 2 phía
- data structure dùng chung
- cross-test / negative test

File này KHÔNG mô tả toàn bộ mkddc-iobus (thread model, config service, shm với core,
build/install, metrics/alarm service-level...). Phần đó ở:
→ 06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md (SOM side, service)
→ 04_FW_MCU_IMPLEMENTATION_GUIDE.md (MCU side, firmware)

Ranh giới: 05 = "tầng protocol" (tái sử dụng được, test độc lập). 06/04 = "tầng service/app"
bọc quanh protocol này.
```

---

## 1. UART config (cả 2 phía phải khớp tuyệt đối)

| Thông số | Giá trị | MCU | SOM |
|----------|---------|-----|-----|
| Baud | **921600** | USART1 | `/dev/ttyS2` (CM3 UART2) |
| Frame | 8N1 (8 data, no parity, 1 stop) | | `cfsetspeed` + termios raw |
| Flow control | None | | tắt RTS/CTS, IXON/IXOFF |
| Pin MCU | PA9=TX, PA10=RX | AF1 | — |
| Isolation | ADUM1201 (2 GND tách biệt) | | |
| Hằng số | `IOP_BAUD=921600` | | dùng chung header |

> SOM mở port: `O_RDWR | O_NOCTTY | O_NONBLOCK`, set termios raw (cfmakeraw), VMIN/VTIME=0,
> flush RX/TX trước khi handshake.

---

## 2. Frame format

```
┌────┬─────┬─────┬─────┬──────────────┬──────────┐
│ SOF│ LEN │ CMD │ SEQ │   PAYLOAD    │  CRC16   │
│0xAA│ 1B  │ 1B  │ 1B  │ 0..252 B     │ 2B HI,LO │
└────┴─────┴─────┴─────┴──────────────┴──────────┘
Tổng frame = LEN + 6.  CRC tính trên SOF..PAYLOAD (big-endian: HI trước).
```

| Hằng số (`iop_protocol.h`) | Giá trị |
|------|---------|
| `IOP_SOF` | 0xAA |
| `IOP_HDR_LEN` | 4 |
| `IOP_CRC_LEN` | 2 |
| `IOP_MAX_PAYLOAD` | 252 |
| `IOP_MIN_FRAME` | 6 |

---

## 3. CRC rule (CRC-16/Modbus)

```
poly 0xA001 (reflected), init 0xFFFF, refin=yes, refout=yes, xorout=0x0000.
Scope: SOF + LEN + CMD + SEQ + PAYLOAD.
Trong frame: CRC_HI (bits15..8) trước, CRC_LO sau.
Hàm chung: iop_crc16() trong shared/iop_protocol.h — CẢ MCU lẫn SOM dùng đúng hàm này.
```
**Test vector BẮT BUỘC khớp 2 phía:**
```
{0xAA,0x00,0x01,0x00}  → 0x6C20    (GET_IO SEQ=0)
{0xAA,0x00,0x01,0x01}  → 0xACE1    (GET_IO SEQ=1; frame đầy đủ: AA 00 01 01 AC E1)
```
> IOP-SW-010 + IOP-FW-010: mỗi phía PHẢI có unit test ≥10 vector — dùng **bộ chuẩn 12 vector**
> trong [SWFW spec §10.1](../01_specs/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md) /
> [15_CONTRACT_FREEZE §5](15_CONTRACT_FREEZE.md). KHÔNG tự bịa vector khác làm chuẩn.
> ⚠️ Vector cũ `0x84C0`/`0x556B` (docs trước 2026-06-11) là SAI — nếu test của bạn pass với
> giá trị đó nghĩa là CRC implement sai thuật toán.

---

## 4. SEQ rule

```
- SOM: SEQ=0 sau reset; +1 mỗi frame gửi (wrap 255→0).
- MCU: LUÔN echo SEQ từ request vào response. MCU KHÔNG tự generate SEQ.
- SOM: verify SEQ trong response == SEQ request gần nhất. Lệch → bỏ frame, iop_seq_err++, log.
```

---

## 5. Command list (catalog)

| CMD | Tên | Hướng | LEN payload | Phản hồi |
|-----|-----|-------|-------------|----------|
| 0x01 | GET_IO | SOM→MCU | 0 | IO_RESP |
| 0x02 | IO_RESP | MCU→SOM | 34 | — |
| 0x10 | SET_AO | SOM→MCU | 8 | ACK |
| 0x11 | SET_DO | SOM→MCU | 2 | ACK |
| 0x12 | ACK | MCU→SOM | 1 | — |
| 0x13 | SET_AO_CFG | SOM→MCU | 1 | ACK (v1.1) |
| 0x20 | GET_DIAG | SOM→MCU | 0 | DIAG_RESP |
| 0x21 | DIAG_RESP | MCU→SOM | 20 | — |
| 0x30 | HANDSHAKE | SOM→MCU | 4 | HANDSHAKE_RESP |
| 0x31 | HANDSHAKE_RESP | MCU→SOM | 6 | — |
| 0x40 | RESET_IO | SOM→MCU | 1 | ACK |
| 0xFE | NACK | MCU→SOM | 2 | — |

---

## 6. Payload từng command (byte offset, big-endian)

### 6.1 IO_RESP (0x02) — 34 byte
```
[0..23]  UI1..UI8 raw : 8 × uint24 BE (3B/kênh)
[24]     DI_MASK      : bit0=DI1..bit7=DI8 (1=ON sau debounce)
[25]     DO_FB_MASK   : bit0=DO1..bit3=DO4 (1=relay đóng, feedback)
[26..27] MCU_TEMP     : int16 BE, ×10 (°C). 250=25.0°C
[28..29] FAULT_FLAGS  : uint16 BE (xem §6.8)
[30..31] SAMPLE_CNT   : uint16 BE (wrap) — phát hiện MCU hang
[32..33] RESERVED     : 0x0000
```
### 6.2 SET_AO (0x10) — 8 byte
```
[0..1] AO1, [2..3] AO2, [4..5] AO3, [6..7] AO4 : uint16 BE raw DAC (0=min,65535=max)
0-10V: V=(raw/65535)*10 ; 4-20mA: mA=4+(raw/65535)*16
```
### 6.3 SET_DO (0x11) — 2 byte
```
[0] DO_MASK : bit i =1 → áp dụng lệnh cho DOi
[1] DO_VALUE: bit i =1 → relay đóng, 0 → mở
Ví dụ đóng DO1, mở DO2, giữ DO3/4: MASK=0x03, VALUE=0x01
```
### 6.4 SET_AO_CFG (0x13) — 1 byte (v1.1)
```
[0] AO_MODE : bit0=AO1..bit3=AO4. 0=0-10V, 1=4-20mA
MCU: set relay/switch PD1..PD4, lưu mode, áp safe-state đúng mode mới.
```
### 6.5 HANDSHAKE (0x30, 4B) / HANDSHAKE_RESP (0x31, 6B)
```
HANDSHAKE:      [0..1] SOM_IOP_VERSION u16, [2..3] SOM_CAPABILITIES u16 (bit0=CAP_DIAG,bit1=CAP_RESET_IO)
HANDSHAKE_RESP: [0..1] MCU_IOP_VERSION, [2..3] MCU_FW_VERSION, [4] STATUS (0=OK,1=warn,2=incompat→abort), [5]=0
```
### 6.6 DIAG_RESP (0x21) — 20 byte
```
[0..1] FW_VERSION, [2..3] UPTIME_S, [4..5] IOP_RX_CNT, [6..7] IOP_CRC_ERR,
[8..9] IOP_SEQ_ERR, [10..11] WDG_RESET_CNT, [12..13] ADC_SAMPLE_RATE,
[14..15] MCU_TEMP_MAX, [16..17] VDD_MV, [18..19] RESERVED
```
### 6.7 ACK (0x12, 1B) / NACK (0xFE, 2B)
```
ACK : [0] ECHOED_CMD (CMD được ACK)
NACK: [0] REJECTED_CMD, [1] ERROR_CODE
```
### 6.8 FAULT_FLAGS bitmask (bảng chuẩn duy nhất — macro `IOP_FAULT_*` trong header)

| Bit | Macro | Set khi | Clear khi | Sticky |
|-----|-------|---------|-----------|--------|
| 0 | `IOP_FAULT_ADC` | ADS131M08 không có mẫu hợp lệ trong 100ms | reinit OK + mẫu hợp lệ | Không |
| 1 | `IOP_FAULT_DAC` | DAC8554 không phản hồi SPI | ghi DAC OK trở lại | Không |
| 2 | `IOP_FAULT_UI_OV` | bất kỳ UI > 110% full scale | mọi UI ≤ 110% FS | Không |
| 3 | `IOP_FAULT_RELAY_STUCK` | DO feedback ≠ lệnh sau 20ms | feedback khớp lại | Không |
| 4 | `IOP_FAULT_WDG_RESET` | boot sau reset IWDG/WWDG (RCC_CSR) | MCU nhận GET_DIAG đầu tiên sau boot | **Sticky** |
| 5 | `IOP_FAULT_MCU_OVERTEMP` | MCU_TEMP > 85.0°C | < 80.0°C (hysteresis 5°C) | Không |
| 6 | `IOP_FAULT_VDD` | VDD ngoài [3.0, 3.6]V (MCU ngừng AO) | VDD trong dải | Không |
| 7–15 | reserved | luôn 0 | — | — |

> SOM: thấy bit4 → alarm `MCU_WATCHDOG_RESET` + gửi GET_DIAG để MCU clear. Mọi bit → mirror
> nguyên xi vào `kx_io_shm.fault_flags`; mapping alarm: [06 §9](06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md).

### 6.9 RESET_IO (0x40) reason — bảng chuẩn duy nhất (`IOP_RESET_REASON_*`)

| Giá trị | Macro | Ai gửi | Khi nào | MCU làm gì | SOM log/alarm |
|---------|-------|--------|---------|------------|----------------|
| `0x00` | `..._NORMAL` | iobus | startup sau handshake (đưa IO về safe đã biết) | safe-state + ACK + log | INFO `iop.reset reason=normal` |
| `0x01` | `..._CORE_WDG` | iobus | core/scan-loop chết — **Rev A: reserved** | nt | ERROR + alarm |
| `0x02` | `..._BMS_TIMEOUT` | core→iobus | policy BMS timeout — **Rev A: reserved** | nt | WARN + alarm |
| `0x03` | `..._OPERATOR` | web→core→iobus | commissioning của operator | nt | INFO + audit log |
| `0x04` | `..._OTA` | iobus | SOM sắp nạp firmware MCU | nt | INFO `reason=ota` |
| `0x05` | `..._IOP_FAULT` | iobus | FAULT path: >100ms không IO_RESP hợp lệ | nt | ERROR + alarm `IOP_TIMEOUT` |

> MCU hành vi GIỐNG NHAU mọi reason (AO safe theo mode, DO open, log reason, ACK 0x40);
> reason lạ (0x06–0xFF) vẫn safe-state + ACK + log. Reason CHỈ phục vụ log/diag.

---

## 7. ACK/NACK rule

```
- SET_AO/SET_DO/SET_AO_CFG/RESET_IO thành công → ACK với ECHOED_CMD.
- CRC sai → NACK ERR_CRC_FAIL (0x03).
- LEN không khớp CMD → NACK ERR_BAD_LEN (0x02).
- CMD lạ → NACK ERR_UNKNOWN_CMD (0x01).
- MCU bận → NACK ERR_BUSY (0x04).
- MCU đang safe-state, nhận SET_* → NACK ERR_SAFE_STATE (0x05).
- Version không tương thích → NACK ERR_VERSION_INCOMPAT (0x06) / STATUS=0x02 ở handshake.
```

---

## 8. Timeout / retry rule (SOM side)

| Tham số | Giá trị | Hành động |
|---------|---------|-----------|
| Response timeout | 10 ms (`IOP_RESP_TIMEOUT_MS`) | retry lệnh (tối đa 3) |
| Max retry | 3 | sau 3: `iop_fault=TRUE`, log ERROR |
| GET_IO period | 10 ms (`IOP_GET_IO_PERIOD_MS`) | poll 100Hz |
| Fault timeout | 100 ms không IO_RESP hợp lệ | gửi RESET_IO, vào FAULT |
| Reconnect | mỗi 5 s khi fault | gửi lại HANDSHAKE |
| MCU safe timeout | 200 ms (`IOP_SAFE_TIMEOUT_MS`) | MCU tự safe-state |

---

## 9. Startup sequence (bắt buộc theo đúng thứ tự)

```
1. SOM mở /dev/ttyS2, 921600 8N1, flush RX/TX, SEQ=0.
2. SOM gửi HANDSHAKE (0x30) với SOM_IOP_VERSION=0x0101, capabilities (IOP_CAP_DIAG|IOP_CAP_RESET_IO).
3. MCU trả HANDSHAKE_RESP (0x31) với version + STATUS.
4. SOM kiểm version:
     STATUS=0x00 → tiếp tục
     STATUS=0x01 → log WARNING, tiếp tục
     STATUS=0x02 / timeout → log CRITICAL, retry 3 lần → fail thì raise IOP_INIT_FAIL + safe.
5. (tùy chọn, khuyến nghị) SOM gửi RESET_IO reason=IOP_RESET_REASON_NORMAL (0x00)
   → đưa IO về safe-state đã biết trước khi bắt đầu vận hành (xem §6.9).
6. SOM gửi SET_AO_CFG (0x13) nếu cần đổi mode (MCU chưa hỗ trợ → NACK UNKNOWN_CMD, giữ 0-10V).
7. SOM bắt đầu GET_IO poll loop (10ms timer).
8. MCU trả IO_RESP mỗi GET_IO.
9. Timeout → retry (≤3).
10. Retry fail → báo MCU fault (iop_status=FAULT, alarm bus).
```

---

## 10. Reference implementation layout (code 2 phía)

Protocol này có code tương đương ở 2 phía; **CRC + frame encode/decode + test vector dùng
chung logic** (không fork).

```
MCU (firmware):
fw/common/iop_protocol.h     ← COPY/symlink từ shared/iop_protocol.h (hằng số, CRC, enum)
fw/common/iop_crc.c          ← wrapper iop_crc16 + unit test host
fw/app/iop_comm.c            ← task slave: parse/build/dispatch (xem 04_FW_MCU §3)
fw/drivers/iop_drv.c         ← USART1 DMA RX(IDLE)+TX

SOM (mkddc-iobus):
services/iobus/iop/iop_protocol.hpp  ← include shared/iop_protocol.h + wrapper C++ (struct, enum)
services/iobus/iop/iop_crc.cpp       ← iop_crc16 + unit test (gtest/catch2)
services/iobus/iop/iop_frame.cpp     ← build/parse frame
services/iobus/iop/iop_client.cpp    ← state machine master + timeout/retry + SEQ
services/iobus/iop/iop_parser.cpp    ← IO_RESP/DIAG_RESP → struct
```
> `iop_protocol.h` là 1 nguồn duy nhất (hằng số, enum CMD/ERR, `iop_crc16`, helper BE). MCU
> include thẳng; SOM include qua `iop_protocol.hpp` (chỉ thêm lớp C++ tiện dụng, KHÔNG đổi
> giá trị).

---

## 11. Required public API (tối thiểu)

### 11.1 SOM side (mkddc-iobus / `iop_client`)
```cpp
// Trả về IopResult cho mọi lệnh: { ok | timeout | crc_fail | seq_fail | nack(err) | not_open }
bool      iop_open(const std::string& dev);     // mở+cấu hình UART; false nếu lỗi
void      iop_close();

IopResult iop_handshake();                       // §9 bước 2-4; set status NORMAL/abort
IopResult iop_get_io(IopIoResp* out);            // GET_IO → parse IO_RESP vào *out
IopResult iop_set_do(uint8_t mask, uint8_t value);
IopResult iop_set_ao(const uint16_t ao_raw[4]);
IopResult iop_set_ao_cfg(uint8_t ao_mode_mask);  // bit i: 0=0-10V,1=4-20mA
IopResult iop_get_diag(IopDiagResp* out);
IopResult iop_reset_io(uint8_t reason);          // IOP_RESET_REASON_*

IopStatus iop_status();                          // INIT..RECONNECT (xem §13)
```
> Mọi hàm gửi-lệnh tự lo SEQ++, timeout, retry≤3 (theo §8). Caller chỉ xử lý IopResult.

### 11.2 MCU side (firmware / `iop_comm`)
```c
void     iop_comm_task(void *arg);                                  // FreeRTOS task Pri6
bool     iop_parse_frame(const uint8_t *buf, uint16_t len, iop_frame_t *out); // verify SOF/LEN/CRC
uint16_t iop_build_frame(uint8_t cmd, uint8_t seq,
                         const uint8_t *payload, uint8_t len, uint8_t *out);  // trả số byte
void     iop_handle_command(const iop_frame_t *frame);              // dispatch + build response
```
> `iop_parse_frame` trả false nếu SOF sai / LEN sai / CRC sai (caller gửi NACK tương ứng).
> `iop_handle_command` echo SEQ, gọi xAoQueue/xDoQueue/safe-state theo CMD.

---

## 12. Data structures (bắt buộc — khớp byte layout §6)

### 12.1 SOM side
```cpp
struct IopIoResp {              // parse từ IO_RESP 34B
    uint32_t ui_raw[8];         // uint24 thực, lưu trong uint32 (0..0xFFFFFF)
    uint8_t  di_mask;
    uint8_t  do_fb_mask;
    int16_t  mcu_temp_x10;      // 0.1°C
    uint16_t fault_flags;       // IOP_FAULT_*
    uint16_t sample_cnt;
};

struct IopDiagResp {            // parse từ DIAG_RESP 20B
    uint16_t fw_version;
    uint16_t uptime_s;
    uint16_t rx_count;
    uint16_t crc_error_count;
    uint16_t seq_error_count;
    uint16_t watchdog_reset_count;
    uint16_t adc_sample_rate;
    int16_t  mcu_temp_max_x10;
    uint16_t vdd_mv;
};

struct IopResult {
    enum Code { OK, TIMEOUT, CRC_FAIL, SEQ_FAIL, NACK, NOT_OPEN } code;
    uint8_t nack_err;           // hợp lệ khi code==NACK (ERR_*)
    uint8_t retries;            // số lần đã retry
};

enum class IopStatus { INIT, HANDSHAKE, NORMAL, FAULT, SAFE_STATE, RECONNECT };
```
### 12.2 MCU side
```c
typedef struct {
    uint8_t  sof;               // luôn 0xAA
    uint8_t  len;               // số byte payload
    uint8_t  cmd;
    uint8_t  seq;
    uint8_t  payload[IOP_MAX_PAYLOAD];
    uint16_t crc;               // CRC đã verify
} iop_frame_t;
```

---

## 13. State machine chi tiết (SOM master)

```
INIT → OPEN_UART → HANDSHAKE → CONFIG_AO → NORMAL_POLL
                                              ├─(timeout x3)→ FAULT → SAFE_STATE → RECONNECT → HANDSHAKE
                                              └─(STATUS=0x02)→ FAULT
```

| State | Entry action | Loop action | Exit condition | Timeout | Error transition | Log |
|-------|--------------|-------------|----------------|---------|------------------|-----|
| INIT | reset counters, SEQ=0 | — | config loaded | — | — | INFO iobus.start |
| OPEN_UART | open/cfg /dev/ttyS2, flush | — | fd ok | — | open fail → FAULT | INFO iop.open / ERROR iop.open_fail |
| HANDSHAKE | gửi HANDSHAKE | chờ HANDSHAKE_RESP | STATUS=0x00/0x01 | 1000ms | timeout x3 / STATUS=0x02 → FAULT | INFO iop.handshake |
| CONFIG_AO | gửi SET_AO_CFG (nếu cần) | chờ ACK | ACK / NACK UNKNOWN | 10ms | timeout → NORMAL (giữ default) | INFO iop.ao_cfg |
| NORMAL_POLL | start 10ms timer | GET_IO→parse→(output nếu có) | — | 10ms/lệnh, retry≤3 | 3 retry liên tiếp / >100ms no valid → FAULT | WARN rate-limited |
| FAULT | iop_status=FAULT, alarm | gửi RESET_IO (reason=IOP_FAULT 0x05) 1 lần | — | — | → SAFE_STATE | ERROR iop.fault |
| SAFE_STATE | ngừng SET_*; giữ retry GET_IO | thử GET_IO | nhận IO_RESP hợp lệ → RECONNECT | — | — | ERROR iop.safe_state |
| RECONNECT | timer 5s | gửi HANDSHAKE | HANDSHAKE_RESP OK → NORMAL_POLL | 5s/lần | — | INFO iop.reconnect |

Hằng số dùng: `IOP_RESP_TIMEOUT_MS=10`, fault 100ms, reconnect 5s, handshake 1000ms.

---

## 14. Timing budget

| Mục | Giá trị |
|-----|---------|
| GET_IO period | 10 ms |
| Response timeout | 10 ms |
| Retry count | 3 |
| MCU safe timeout | 200 ms |
| Reconnect interval | 5 s |
| HANDSHAKE timeout | 1000 ms |
| Max IO_RESP parse time | < 1 ms (SOM) |
| Max GET_IO → IO_RESP latency | ≤ 5 ms (MCU, FW-IOP-004) |
| Tổng byte/chu kỳ 10ms | ~82 B → ~0.89ms @921600 (≈9% băng thông) |

---

## 15. Negative test (bắt buộc — cross-test Phase 2)

| # | Inject | Phía test | Expected behavior |
|---|--------|-----------|-------------------|
| 1 | SOF sai (byte đầu ≠ 0xAA) | MCU & SOM | bỏ byte tới khi gặp 0xAA; không crash; không dispatch |
| 2 | LEN quá lớn (> MAX_PAYLOAD) | MCU | NACK ERR_BAD_LEN; SOM: drop, seq_err/parse_err++ |
| 3 | LEN sai theo CMD (vd GET_IO LEN≠0) | MCU | NACK ERR_BAD_LEN |
| 4 | CRC sai | MCU | NACK ERR_CRC_FAIL; SOM: crc_err++, retry |
| 5 | SEQ sai trong response | SOM | bỏ frame, seq_err++, retry/log |
| 6 | Unknown CMD | MCU | NACK ERR_UNKNOWN_CMD |
| 7 | ACK sai ECHOED_CMD | SOM | coi như fail lệnh, retry; log mismatch |
| 8 | Không trả lời (timeout) | SOM | retry≤3 → FAULT; MCU mất GET_IO 200ms → safe-state |
| 9 | NACK ERR_BUSY | SOM | retry sau backoff ngắn; không coi là fault ngay |
| 10 | NACK ERR_SAFE_STATE | SOM | ngừng SET_*; chờ IO_RESP báo hết safe; log |

Frame mẫu (GET_IO SEQ=1): `AA 00 01 01 AC E1` (CRC=0xACE1).

---

## 16. Phân nhiệm implement

| Yêu cầu | MCU (Dev 1) | SOM (Dev 2) |
|---------|-------------|-------------|
| CRC16 | IOP-FW-010 (crc16.c) | IOP-SW-010 (iop_crc.cpp) |
| DMA UART | IOP-FW-002 | termios raw + poll/epoll |
| Timeout/retry | — (slave) | IOP-SW-003 |
| HANDSHAKE | IOP-FW-009 | IOP-SW-007 |
| Safe-state | IOP-FW-006 (200ms) | IOP-SW-005 (RESET_IO) |
| Metrics | DIAG counters | IOP-SW-006 (/system/status) |
| State machine | FSM firmware (04 §7) | §13 file này |
| Negative test | §15 phía MCU | §15 phía SOM (fake MCU — 06 §11) |

---
**Rev** 1.2 | 2026-06-11 · Freeze: [15_CONTRACT_FREEZE](15_CONTRACT_FREEZE.md) ·
Service-level (thread/config/shm/build): [06_MKDDC_IOBUS](06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md)
