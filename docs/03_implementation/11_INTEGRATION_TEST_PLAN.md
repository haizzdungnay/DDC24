# 11 — Integration Test Plan
## MK-DDC-24 — Test plan thật trên board

> **Document ID:** IMPL-TESTPLAN-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-06-10
> **Owner:** Tester (+ dev hỗ trợ)
> **Nguồn-chuẩn:** [TEST_SPEC](../01_specs/TEST_SPEC_MK-DDC-24_VI.md) · [SWFW_INTERFACE_SPEC §10](../01_specs/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md)

**Format mỗi test case:** Test ID / Mục tiêu / Thiết bị / Điều kiện ban đầu / Các bước / Kết quả mong đợi / Pass-Fail / Log cần kiểm.

---

## Thiết bị test chuẩn (test bench)

```
- Board MK-DDC-24 Rev A (SOM + MCU).
- ST-Link V3 (nạp/debug MCU).
- Đồng hồ vạn năng (đo V/mA AO).
- Nguồn DC chuẩn 0-10V + nguồn dòng 4-20mA (cấp UI).
- Hộp công tắc 8 kênh (DI), tải relay 8 kênh + đèn báo (DO).
- PC test harness (Python IOP, gửi frame thô) cho group 2.
- Sensor mẫu: NTC10k, PT100 (kiểm scale).
- Logic analyzer / oscilloscope (đo latency IOP, LDAC).
```

---

## Test group 0 — Build/CI

```
Test ID: TC-0-01
Mục tiêu: 4 phần build sạch
Thiết bị: máy CI
Điều kiện ban đầu: repo clone mới
Các bước: build fw/, services/iobus, services/core, web/
Kết quả mong đợi: 4 artifact, 0 error
Pass/Fail: tất cả build xanh
Log: CI log
```

---

## Test group 1 — MCU standalone

```
Test ID: TC-1-01  Đọc DI
Thiết bị: hộp công tắc
Điều kiện: MCU chạy, debug console
Các bước: đóng/mở DI1..DI8 lần lượt
Kết quả: di_mask đổi đúng bit, debounce mượt (không rung)
Pass/Fail: 8/8 kênh đúng
Log: console io_sample

Test ID: TC-1-02  Bật DO relay
Thiết bị: relay + đèn
Các bước: console "do" bật từng DO1..DO4
Kết quả: relay thật đóng, đèn sáng, feedback khớp
Pass/Fail: 4/4 + feedback đúng
Log: do_control, do_fb_mask

Test ID: TC-1-03  Xuất AO
Thiết bị: đồng hồ V
Các bước: set AO raw 0 / 32768 / 65535
Kết quả: ~0V / ~5V / ~10V (sai số <2%)
Pass/Fail: 4/4 kênh tuyến tính
Log: ao_output

Test ID: TC-1-04  Đọc UI raw
Thiết bị: nguồn 0-10V chuẩn
Các bước: cấp 0/5/10V vào UI1
Kết quả: raw tỉ lệ đúng, sample_cnt tăng
Pass/Fail: sai số <1%
Log: io_sample

Test ID: TC-1-05  Watchdog + safe-state
Các bước: treo io_sample (test hook); ngừng GET_IO
Kết quả: IWDG reset ~1s; safe-state sau 200ms (AO 0V, DO open)
Pass/Fail: cả 2 cơ chế chạy
Log: RCC_CSR cause, FAULT bit4 (IOP_FAULT_WDG_RESET, sticky — clear khi GET_DIAG đầu sau boot)
```

---

## Test group 2 — UART IOP (cross-test)

```
Test ID: TC-2-01  CRC vector
Thiết bị: PC harness
Các bước: tính CRC 12 vector chuẩn (SWFW §10.1) cả MCU lẫn SOM
Kết quả: khớp; {AA 00 01 00}→0x6C20, {AA 00 01 01}→0xACE1
Pass/Fail: 10/10 khớp 2 phía
Log: unit test output

Test ID: TC-2-02  HANDSHAKE
Các bước: SOM gửi HANDSHAKE v1.1
Kết quả: HANDSHAKE_RESP STATUS=0x00
Pass/Fail: version OK; major mismatch → STATUS=0x02 abort
Log: iop_client

Test ID: TC-2-03  GET_IO/IO_RESP latency
Thiết bị: oscilloscope (GPIO toggle)
Các bước: SOM gửi GET_IO, MCU toggle pin khi bắt đầu TX
Kết quả: latency ≤5ms; 1000 lần 0 CRC/SEQ err
Pass/Fail: ≤5ms + 0 lỗi
Log: scope + iop metrics

Test ID: TC-2-04  SET_DO/SET_AO + ACK
Các bước: SOM gửi SET_DO, SET_AO
Kết quả: relay/AO thật đổi; ACK echo SEQ
Pass/Fail: output đổi + ACK đúng
Log: ACK frames

Test ID: TC-2-05  GET_DIAG / RESET_IO / SET_AO_CFG
Các bước: lần lượt gửi 3 lệnh
Kết quả: DIAG_RESP 20B; RESET_IO→safe+ACK; AO mode đổi (đo 4mA)
Pass/Fail: 3/3 pass
Log: DIAG_RESP

Test ID: TC-2-06  Negative (NACK)
Các bước: gửi CRC hỏng / CMD lạ / LEN sai
Kết quả: NACK 0x03/0x01/0x02; SOM retry≤3→fault
Pass/Fail: NACK đúng code + SOM xử lý
Log: NACK frames, counters
```

---

## Test group 3 — mkddc-iobus

```
Test ID: TC-3-01  Service ổn định
Các bước: systemctl start mkddc-iobus, chạy 1h
Kết quả: Restart=always, WatchdogSec kick, không crash
Pass/Fail: uptime 1h, 0 restart bất thường
Log: journalctl -u mkddc-iobus

Test ID: TC-3-02  shm writer đúng
Thiết bị: tool đọc shm
Các bước: DI đổi ngoài → đọc kx_io_shm
Kết quả: di_state đổi, seqlock không nửa-ghi
Pass/Fail: reader đọc nhất quán
Log: shm dump

Test ID: TC-3-03  Scale
Các bước: cấp NTC10k/PT100/0-10V
Kết quả: ui_value eng đúng (±1%)
Pass/Fail: mọi sensor_type đúng
Log: iop_parser

Test ID: TC-3-04  Output bridge
Các bước: test tool ghi do_cmd[0]=1
Kết quả: SET_DO gửi → relay đóng
Pass/Fail: shm→MCU đúng
Log: output_command

Test ID: TC-3-05  Fault → metrics+alarm
Các bước: rút UART
Kết quả: iop_status=FAULT, timeout++, alarm.sock phát JSON
Pass/Fail: không giả lập IO, fault phản ánh đúng
Log: alarm.sock, metrics
```

---

## Test group 4 — mkddc-core

```
Test ID: TC-4-01  Scan loop
Các bước: chạy core 10 phút
Kết quả: scan_count đều 1s, scan_overrun=0
Pass/Fail: không drift/overrun
Log: core_metrics

Test ID: TC-4-02  Point table 24 IO
Các bước: đổi IO thật
Kết quả: point_table phản ánh, quality good
Pass/Fail: 24/24 đúng
Log: point dump

Test ID: TC-4-03  Priority resolver
Các bước: 2 nguồn (web prio3 + safety prio1) ghi DO1
Kết quả: safety thắng, output=safety value
Pass/Fail: priority đúng, conflict log
Log: priority_resolver

Test ID: TC-4-04  Safe-state + quality
Các bước: iobus FAULT (rút UART)
Kết quả: DO open, AO 0V/4mA, quality bad
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
Kết quả: 24 IO {value,quality,unit}
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
Kết quả: relay đóng, đèn sáng, web confirm ON (feedback), audit log
Pass/Fail: relay thật bật + feedback
Log: web audit, core, iobus, MCU

Test ID: TC-E2E-02  Web tắt DO1
Các bước: web DO1 OFF
Kết quả: relay mở
Pass/Fail: relay thật tắt

Test ID: TC-E2E-03  DI đổi ngoài → web
Các bước: đóng contact DI3 bằng tay
Kết quả: web cập nhật DI3=ON trong ≤2s
Pass/Fail: ≤2s

Test ID: TC-E2E-04  Web AO set → analog thật
Thiết bị: đồng hồ
Các bước: web đặt AO2=7.5V
Kết quả: đo ~7.5V
Pass/Fail: sai số <2%

Test ID: TC-E2E-05  Rút UART → web báo lỗi
Các bước: rút cáp UART
Kết quả: web alarm "Mất kết nối MCU", IO safe-state, quality bad
Pass/Fail: báo lỗi + safe trong <1s

Test ID: TC-E2E-06  Reset MCU → recover
Các bước: nhấn reset MCU (hoặc cắm lại UART)
Kết quả: handshake lại, IO trở lại normal, alarm clear
Pass/Fail: recover tự động <10s
```

---

## Test group 7 — Fault injection

```
TC-7-01  Sensor lỗi (hở mạch UI) → quality bad + alarm.
TC-7-02  Relay stuck (giữ relay) → RELAY_STUCK → alarm.
TC-7-03  CRC nhiễu (chèn byte) → iop_crc_err tăng, không crash.
TC-7-04  Overtemp MCU (làm nóng) → MCU_OVERTEMP, giảm sample.
TC-7-05  Priority override → fire/safety ghi đè web command, web hiển thị "bị ghi đè".
Mỗi case: Pass khi hệ thống an toàn + báo đúng + không crash; Log: alarm + metrics.
```

---

## Test group 8 — Long-run

```
TC-8-01  24h liên tục: poll 100Hz, scan 1s.
Kết quả: 0 crash, 0 memory leak (RSS ổn định), scan_overrun=0,
         iop_crc_err/timeout trong ngưỡng, relay đóng/mở định kỳ OK.
Pass/Fail: 24h sạch.
Log: journalctl toàn kỳ + metrics snapshot mỗi giờ.
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

---
**Rev** 1.0 | 2026-06-10
