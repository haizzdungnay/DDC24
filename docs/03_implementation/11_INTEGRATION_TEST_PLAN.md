# 11 — Integration Test Plan
## MK-DDC-24 — Test plan thật trên board

> **Document ID:** IMPL-TESTPLAN-MK-DDC-24-VI
> **Phiên bản:** 1.2 | 2026-06-26 (Rev A + IOP v2 ADR-010: xoá DI/PT100, sửa bit FAULT, 500Hz, BOARD_CAP_MAP, UI×16, ADC2 test) · 1.1 | 2026-06-13 (thêm group 9 BACnet, group 10 Modbus) · 1.0 | 2026-06-10
> **Owner:** Tester (+ dev hỗ trợ)
> **Nguồn-chuẩn:** [TEST_SPEC](../01_specs/TEST_SPEC_MK-DDC-24_VI.md) · [SWFW_INTERFACE_SPEC §10](../01_specs/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md) · ADR-010 (IOP v2)

**Format mỗi test case:** Test ID / Mục tiêu / Thiết bị / Điều kiện ban đầu / Các bước / Kết quả mong đợi / Pass-Fail / Log cần kiểm.

---

## Thiết bị test chuẩn (test bench) — Rev A

```
- Board MK-DDC-24 Rev A (SOM + MCU STM32G0).
- ST-Link V3 (nạp/debug MCU).
- Đồng hồ vạn năng (đo V/mA AO).
- Nguồn DC chuẩn 0-10V × 2 kênh (cấp UI nhóm 0-10V).
- Nguồn dòng chuẩn 4-20mA × 2 kênh (cấp UI nhóm 4-20mA).
- NTC10K / NTC20K mẫu (kiểm scale nhiệt độ).
- Tải relay 4 kênh + đèn báo (DO).
- PC test harness (Python IOP, gửi frame thô) cho group 2.
- Logic analyzer / oscilloscope (đo latency IOP, LDAC).
- PC BACnet client (YABE hoặc BAC0) cho group 9.
- PC Modbus master (modpoll hoặc mbpoll) cho group 10.

Rev A KHÔNG có: DI hardware, PT100/PT1000 circuit (BOARD_CAP_RTD not set).
```

---

## Test group 0 — Build/CI

```
Test ID: TC-0-01
Mục tiêu: 4 phần build sạch (x86_64 + aarch64 cross)
Thiết bị: máy CI
Điều kiện ban đầu: repo clone mới
Các bước: build fw/, services/iobus, services/core, web/ — cả native và aarch64
Kết quả mong đợi: 4 artifact, 0 error, 240/240 unit test pass
Pass/Fail: tất cả build + test xanh
Log: CI log
```

---

## Test group 1 — MCU standalone

```
Test ID: TC-1-01  Bật DO relay
Thiết bị: relay + đèn
Điều kiện: MCU chạy, debug console
Các bước: console "do" bật từng DO1..DO4
Kết quả: relay thật đóng, đèn sáng, DO_FB_MASK khớp trong IO_RESP byte [72]
Pass/Fail: 4/4 + feedback đúng
Log: do_control, do_fb_mask

Test ID: TC-1-02  Xuất AO
Thiết bị: đồng hồ V
Các bước: set AO raw 0 / 32768 / 65535 trên cả 4 kênh
Kết quả: ~0V / ~5V / ~10V (sai số <2%); set mode 4-20mA: raw 0=4mA, max=20mA
Pass/Fail: 4/4 kênh tuyến tính V + mA
Log: ao_output

Test ID: TC-1-03  Đọc UI 16 kênh (2× ADS131M08)
Thiết bị: nguồn 0-10V chuẩn
Các bước:
  (a) Cấp 0/5/10V lần lượt vào UI1 (ADC1 ch1), UI5 (ADC1 ch5)
  (b) Cấp 0/5/10V lần lượt vào UI9 (ADC2 ch1), UI13 (ADC2 ch5)
Kết quả: raw tỉ lệ đúng, sample_cnt tăng, ADC1_STAT và ADC2_STAT = DRDY_OK
Pass/Fail: sai số <1%; cả 2 chip ADS131M08 hoạt động
Log: io_sample (IO_RESP byte [64]=ADC1_STAT, [65]=ADC2_STAT)

Test ID: TC-1-04  Watchdog + safe-state MCU
Các bước: treo io_sample (test hook); ngừng GET_IO >200ms
Kết quả: IWDG reset ~1s; safe-state sau 200ms (AO 0V, DO open)
Pass/Fail: cả 2 cơ chế chạy
Log: RCC_CSR cause, FAULT bit5 (IOP_FAULT_WDG_RESET sticky — clear khi GET_DIAG đầu sau boot)

Test ID: TC-1-05  VDD fault inject
Thiết bị: nguồn cung cấp điều chỉnh được
Các bước: hạ VDD xuống ngưỡng fault của MCU
Kết quả: IO_RESP FAULT_FLAGS bit7 (IOP_FAULT_VDD) set; SOM báo alarm critical
Pass/Fail: bit7 set + alarm critical
Log: FAULT_FLAGS byte [68..69]
```

---

## Test group 2 — UART IOP v2 (cross-test SOM ↔ MCU)

```
Test ID: TC-2-01  CRC vector
Thiết bị: PC harness
Các bước: tính CRC 12 vector chuẩn (SWFW §10.1) cả MCU lẫn SOM
Kết quả: khớp; {AA 00 01 00}→0x6C20, {AA 00 01 01}→0xACE1
Pass/Fail: 10/10 khớp 2 phía
Log: unit test output

Test ID: TC-2-02  HANDSHAKE v2 + BOARD_CAP_MAP
Các bước: SOM gửi HANDSHAKE (CMD=0x01, IOP_VER=2.0)
Kết quả:
  HANDSHAKE_RESP 8B:
    byte [0..1] = IOP_VER 0x0200
    byte [2..3] = MCU FW ver 0x0200
    byte [4]    = STATUS 0x00 (OK)
    byte [5]    = 0x00
    byte [6..7] = BOARD_CAP_MAP = 0x000D (UI_16|DO_4|AO_4)
  SOM validate: bit0 (UI_16) phải set — nếu không abort với alarm critical
  major mismatch (SOM v2, MCU v1) → STATUS=0x02, SOM abort
Pass/Fail: BOARD_CAP_MAP đúng; version OK; mismatch abort đúng
Log: iop_client handshake

Test ID: TC-2-03  IO_RESP 74B latency
Thiết bị: oscilloscope (GPIO toggle)
Các bước: SOM gửi GET_IO, MCU toggle pin khi bắt đầu TX
Kết quả:
  IO_RESP đúng 74 byte (header 4B + payload 74B + CRC 2B = 80B total)
  Latency ≤5ms; 1000 lần 0 CRC/SEQ err
Pass/Fail: 74B payload + ≤5ms + 0 lỗi
Log: scope + iop metrics

Test ID: TC-2-04  IO_RESP payload layout (IOP v2)
Các bước: capture 1 frame IO_RESP, parse thủ công
Kết quả:
  byte [0..63]:  UI_RAW[16] × int32 BE signed
  byte [64]:     ADC1_STAT (ADS131M08 #1, ch1-8)
  byte [65]:     ADC2_STAT (ADS131M08 #2, ch9-16)
  byte [66..67]: MCU_TEMP × 0.1°C BE
  byte [68..69]: FAULT_FLAGS v2 BE (bit0=ADC1,bit1=ADC2,bit2=DAC,bit3=UI_OV,
                   bit4=RELAY_STUCK,bit5=WDG_RESET,bit6=OVERTEMP,bit7=VDD)
  byte [70..71]: SAMPLE_CNT BE (tăng mỗi mẫu)
  byte [72]:     DO_FB_MASK
  byte [73]:     reserved = 0x00
Pass/Fail: layout khớp ADR-010
Log: hex dump frame

Test ID: TC-2-05  SET_DO/SET_AO + ACK
Các bước: SOM gửi SET_DO (mask/value), SET_AO (raw×4), SET_AO_CFG (mode)
Kết quả: relay/AO thật đổi; ACK echo đúng SEQ; DO_FB_MASK trong IO_RESP tiếp theo phản ánh
Pass/Fail: output đổi + ACK đúng
Log: ACK frames

Test ID: TC-2-06  GET_DIAG / RESET_IO / SET_AO_CFG
Các bước: lần lượt gửi 3 lệnh
Kết quả: DIAG_RESP (size per spec); RESET_IO→AO 0V + DO open + ACK; AO mode đổi sang 4-20mA (đo 4mA)
Pass/Fail: 3/3 pass
Log: DIAG_RESP raw

Test ID: TC-2-07  Negative (NACK)
Các bước: gửi CRC hỏng / CMD lạ / LEN sai
Kết quả: NACK ERR_CRC_FAIL/ERR_UNKNOWN_CMD/ERR_BAD_LEN; SOM retry≤3→RECONNECT
Pass/Fail: NACK đúng code + SOM xử lý đúng
Log: NACK frames, counters

Test ID: TC-2-08  MCU safe-state khi SOM mất kết nối
Các bước: SOM dừng gửi GET_IO > 200ms (IOP_SAFE_TIMEOUT_MS)
Kết quả: MCU tự vào safe-state (AO 0V, DO open); SET_DO/SET_AO tiếp theo → NACK ERR_SAFE_STATE
         Sau khi SOM reconnect + HANDSHAKE → MCU thoát safe-state
Pass/Fail: safe-state đúng + thoát đúng
Log: NACK ERR_SAFE_STATE, handshake log
```

---

## Test group 3 — mkddc-iobus

```
Test ID: TC-3-01  Service ổn định
Các bước: systemctl start mkddc-iobus, chạy 1h ở 500Hz
Kết quả: Restart=always, WatchdogSec kick, không crash; iop_crc_err=0
Pass/Fail: uptime 1h, 0 restart bất thường
Log: journalctl -u mkddc-iobus

Test ID: TC-3-02  SHM writer đúng (16 UI)
Thiết bị: shm_dump_io --watch
Các bước: cấp 0-10V lần lượt UI1..UI16; đọc kx_io_shm
Kết quả: ui_value[0..15] đổi đúng, seqlock không nửa-ghi, magic=0x4B584402
Pass/Fail: 16/16 kênh nhất quán, magic đúng v2
Log: shm dump

Test ID: TC-3-03  Scale sensor type
Thiết bị: nguồn 0-10V, nguồn 4-20mA, NTC10K, NTC20K
Các bước: cấp từng loại sensor, kiểm ui_value engineering
Kết quả:
  0-10V:   cấp 5V → ui_value ≈ 5.000 V (±1%)
  4-20mA:  cấp 12mA → ui_value ≈ 12.000 mA (±1%)
  NTC10K:  R=10kΩ (25°C) → ui_value ≈ 25.0°C (±1°C)
  NTC20K:  R=20kΩ (25°C) → ui_value ≈ 25.0°C (±1°C)
  dry-contact: short → 1.0, open → 0.0
  Rev A: PT100/PT1000 → quality=BAD (BOARD_CAP_RTD not set, không test thực)
Pass/Fail: 5/5 loại sensor đúng; PT100 chủ động báo BAD
Log: iop_parser, ui_unit, ui_quality

Test ID: TC-3-04  Output bridge
Các bước: test tool ghi do_cmd[0]=1
Kết quả: SET_DO gửi → relay đóng trong ≤2ms (1 poll cycle)
Pass/Fail: shm→MCU đúng
Log: output_command

Test ID: TC-3-05  Fault → metrics + alarm
Các bước: rút UART cáp
Kết quả: iop_status=FAULT trong ≤20ms (IOP_FAULT_TIMEOUT_MS), timeout++, alarm.sock phát JSON critical
Pass/Fail: fault ≤20ms + alarm đúng
Log: alarm.sock, metrics

Test ID: TC-3-06  BOARD_CAP_MAP validation
Các bước: giả lập MCU trả BOARD_CAP_MAP thiếu bit UI_16 (bit0=0)
Kết quả: iobus abort startup, alarm critical "board cap missing UI_16", không vào NORMAL_POLL
Pass/Fail: abort đúng
Log: iobus log startup
```

---

## Test group 4 — mkddc-core

```
Test ID: TC-4-01  Scan loop
Các bước: chạy core 10 phút
Kết quả: scan_count đều 1s, scan_overrun=0
Pass/Fail: không drift/overrun
Log: core_metrics

Test ID: TC-4-02  Point table IO
Các bước: đổi IO thật (16 UI + 4 AO + 4 DO)
Kết quả: point_table phản ánh đúng; DI fields = 0 (Rev A không có DI)
Pass/Fail: 24 điểm (16+4+4) đúng; DI luôn 0
Log: point dump

Test ID: TC-4-03  Priority resolver
Các bước: 2 nguồn (web prio3 + safety prio1) ghi DO1
Kết quả: safety thắng, output=safety value
Pass/Fail: priority đúng, conflict log
Log: priority_resolver

Test ID: TC-4-04  Safe-state + quality
Các bước: iobus FAULT (rút UART)
Kết quả: DO open, AO 0V/4mA, quality bad trong ≤1 scan
Pass/Fail: safe trong ≤1 scan
Log: safe_state

Test ID: TC-4-05  Không bypass
Các bước: thử ghi thẳng do_cmd từ web (phải fail/không có path)
Kết quả: chỉ core ghi shm IO; web đi qua core
Pass/Fail: không có đường bypass
Log: code review + runtime check
```

---

## Test group 5 — mkddc-web

```
Test ID: TC-5-01  Login
Các bước: login đúng/sai
Kết quả: JWT / 401; RBAC enforce
Pass/Fail: auth đúng
Log: audit

Test ID: TC-5-02  Point list/detail
Các bước: GET /points, /points/UI1
Kết quả: 24 điểm IO {value,quality,unit} — UI×16, AO×4, DO×4; DI field absent hoặc =0
Pass/Fail: hiển thị đúng
Log: REST

Test ID: TC-5-03  Commissioning test
Các bước: POST test DO1 / AO1=5V
Kết quả: relay thật bật; AO 5V; audit log
Pass/Fail: IO thật đổi qua core
Log: audit, core

Test ID: TC-5-04  Validator + deploy
Các bước: deploy graph thiếu limit AO
Kết quả: validate FAIL, deploy chặn; sửa→pass→deploy
Pass/Fail: 4 check Rev A chạy
Log: validator

Test ID: TC-5-05  Web KHÔNG mở UART
Các bước: lsof trên process mkddc-web
Kết quả: không có /dev/ttyS2
Pass/Fail: 0 fd serial
Log: lsof -p $(pidof mkddc-web)
```

---

## Test group 6 — End-to-end IO

```
Test ID: TC-E2E-01  Web bật DO1 → relay thật
Thiết bị: relay+đèn
Các bước: web bấm DO1 ON
Kết quả: relay đóng, đèn sáng, web confirm ON (DO_FB_MASK), audit log
Pass/Fail: relay thật bật + feedback
Log: web audit, core, iobus, MCU

Test ID: TC-E2E-02  Web tắt DO1
Các bước: web DO1 OFF
Kết quả: relay mở
Pass/Fail: relay thật tắt

Test ID: TC-E2E-03  Web AO set → analog thật
Thiết bị: đồng hồ
Các bước: web đặt AO2=7.5V
Kết quả: đo ~7.5V
Pass/Fail: sai số <2%

Test ID: TC-E2E-04  UI real sensor → web
Thiết bị: nguồn 0-10V chuẩn
Các bước: cấp 3V vào UI1 và 8V vào UI9 (kênh thuộc ADC2)
Kết quả: web hiển thị UI1≈3.0V, UI9≈8.0V trong ≤2s
Pass/Fail: cả ADC1 (ch1) và ADC2 (ch9) hiển thị đúng
Log: shm, core, web

Test ID: TC-E2E-05  Rút UART → web báo lỗi
Các bước: rút cáp UART
Kết quả: web alarm "Mất kết nối MCU" trong ≤20ms, IO safe-state, quality bad
Pass/Fail: báo lỗi + safe trong <100ms

Test ID: TC-E2E-06  Reset MCU → recover
Các bước: nhấn reset MCU (hoặc cắm lại UART)
Kết quả: handshake v2.0 lại, BOARD_CAP_MAP validate pass, IO trở lại normal, alarm clear
Pass/Fail: recover tự động <10s
```

---

## Test group 7 — Fault injection

```
TC-7-01  ADC1 lỗi (hở mạch UI1-8) → ADC1_STAT ≠ DRDY_OK → IOP_FAULT_ADC1 (bit0)
         → quality bad AI1-8 + alarm COMMUNICATION_FAILURE.
TC-7-02  ADC2 lỗi (hở mạch UI9-16) → IOP_FAULT_ADC2 (bit1)
         → quality bad AI9-16 + alarm; AI1-8 vẫn GOOD.
TC-7-03  UI over-range (vượt 110% FS) → IOP_FAULT_UI_OV (bit3) set
         → tất cả 16 AI Reliability=OVER_RANGE (aggregate flag, không phân kênh).
TC-7-04  Relay stuck (giữ relay) → IOP_FAULT_RELAY_STUCK (bit4) → alarm critical.
TC-7-05  VDD fault → IOP_FAULT_VDD (bit7) → alarm critical (xem TC-1-05).
TC-7-06  CRC nhiễu (chèn byte) → iop_crc_err tăng, không crash, retry đúng.
TC-7-07  Overtemp MCU → IOP_FAULT_MCU_OVERTEMP (bit6) → alarm critical.
TC-7-08  Priority override → fire/safety ghi đè web command, web hiển thị "bị ghi đè".
Mỗi case: Pass khi hệ thống an toàn + báo đúng + không crash; Log: alarm + metrics.
```

---

## Test group 8 — Long-run

```
TC-8-01  24h liên tục: poll 500Hz (2ms IOP v2), scan 1s.
Kết quả: 0 crash, 0 memory leak (RSS ổn định), scan_overrun=0,
         iop_crc_err/timeout trong ngưỡng, relay đóng/mở định kỳ OK,
         SAMPLE_CNT trong IO_RESP tăng đều (không reset bất thường).
Pass/Fail: 24h sạch.
Log: journalctl toàn kỳ + metrics snapshot mỗi giờ.
```

---

## Test group 9 — BACnet/IP

> Chi tiết task: [24_BACNET_IMPLEMENTATION_PLAN](24_BACNET_IMPLEMENTATION_PLAN.md).

```
TC-9-01  Who-Is/I-Am
Kết quả: I-Am phản hồi <=100ms, Device Instance đúng device.conf/DIP fallback.

TC-9-02  ReadProperty AI/BI/AO/BO
Kết quả: Present_Value, Units, Status_Flags, Reliability khớp core snapshot.
         AI instance 0-15 (16 kênh UI Rev A).

TC-9-03  ReadPropertyMultiple
Kết quả: nhiều object trả đúng, không timeout, Max APDU không vượt cấu hình.

TC-9-04  WriteProperty AO/BO priority
Kết quả: BACnet write -> Priority_Array[16] -> core mức 3 -> output resolved.

TC-9-05  Priority release
Kết quả: write NULL -> priority thấp hơn/default active đúng; release hết -> core release mức 3.

TC-9-06  Manual/safety override
Kết quả: manual/safety cao hơn đè BACnet; audit/core response ghi overridden.

TC-9-07  Reliability map (IOP v2 fault flags)
Kết quả:
  IOP_FAULT_ADC1/ADC2 → AI Reliability=COMMUNICATION_FAILURE
  IOP_FAULT_UI_OV     → tất cả 16 AI Reliability=OVER_RANGE (aggregate)
  quality=BAD         → COMMUNICATION_FAILURE

TC-9-08  COV
Kết quả: đổi value vượt increment -> notify; dưới increment không spam.

TC-9-09  Alarm event
Kết quả: alarm bus event -> Notification Class event; ack path hoạt động.

TC-9-10  BTL pretest
Kết quả: B-ASC smoke pass; log lưu evidence.
```

---

## Test group 10 — Modbus RTU Master

> Chi tiết task: [25_MODBUS_IMPLEMENTATION_PLAN](25_MODBUS_IMPLEMENTATION_PLAN.md).

```
TC-10-01  Profile parser
Kết quả: valid profile load; invalid fc/type/count reject rõ lỗi.

TC-10-02  Register codec
Kết quả: endian/scale vectors đúng cho bool/int16/uint16/int32/uint32/float32.

TC-10-03  RTU read FC01/02/03/04
Kết quả: fake slave data -> ext cache value/quality/timestamp đúng.

TC-10-04  RTU write FC05/06/15/16
Kết quả: pending write -> slave value đổi + result OK.

TC-10-05  Timeout/retry/offline
Kết quả: retry 2, offline, quality BAD, alarm E302.

TC-10-06  Bus error rate
Kết quả: lỗi >10% -> E303, service không crash, IOP 500Hz (2ms) không bị kéo trễ.

TC-10-07  16 slave poll
Kết quả: poll đúng lịch, không starve slave chậm.

TC-10-08  Core graph đọc ext
Kết quả: ext GOOD vào graph; ext BAD -> graph fallback/safe.

TC-10-09  Config reload
Kết quả: SIGHUP không đổi baud reload hot; đổi baud yêu cầu restart rõ log.

TC-10-10  Board RS-485 smoke
Kết quả: thiết bị thật đọc/ghi ổn định 1h.
```

---

## Ma trận test ↔ phase

| Group | Phase đóng | Gate |
|-------|-----------|------|
| 0 | P0 | P0→P1 |
| 1 | P1 | P1→P2 |
| 2 | P2 | P2→P3 |
| 3 | P3 | P3→P4 |
| 4 | P4 | P4→P5 |
| 5 | P5 | P5→P6 |
| 6,7,8 | P6 | Release |
| 9 | P4/P6 | BACnet production gate / BTL pretest |
| 10 | P3/P6 | Modbus production gate / fieldbus smoke |

---
**Rev** 1.2 | 2026-06-26 (Rev A + IOP v2 ADR-010: xoá DI/PT100 hardware absent, sửa FAULT bit map v2, 500Hz, BOARD_CAP_MAP test TC-2-02+TC-3-06, UI×16+ADC2 test TC-1-03+TC-E2E-04, VDD fault TC-1-05+TC-7-05, IO_RESP 74B layout TC-2-04, aggregate OV TC-7-03+TC-9-07) · 1.1 | 2026-06-13 (thêm group 9/10 cho BACnet/Modbus) · 1.0 | 2026-06-10
