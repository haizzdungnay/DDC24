# 02 — Team Work Split
## MK-DDC-24 — Chia việc 3 nhóm dev

> **Document ID:** IMPL-WORKSPLIT-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-06-10
> **Đọc trước:** [00_README](00_IMPLEMENTATION_README.md), [01_OVERVIEW](01_SYSTEM_IMPLEMENTATION_OVERVIEW.md)

---

## 0. Tổng quan ranh giới sở hữu

| Nhóm | Sở hữu code | Không được đụng | Hợp đồng giáp ranh |
|------|-------------|------------------|---------------------|
| Dev 1 — FW_MCU | `fw/` | `services/`, `web/` | `shared/iop_protocol.h` (chung với Dev 2) |
| Dev 2 — SOM | `services/iobus/`, `services/core/`, `shared/` | `fw/`, `web/` | `iop_protocol.h` (với Dev 1), `kinexus_shm.h` (với Dev 3 đọc qua web→core) |
| Dev 3 — Web/BE | `web/` | `fw/`, `services/` | REST + IPC command/setpoint tới core (với Dev 2) |

> Quy tắc vàng: **`shared/iop_protocol.h` và `shared/kinexus_shm.h` là HỢP ĐỒNG**. Đổi 1
> bên = đổi cả hai bên + bump version + chạy lại cross-test. KHÔNG fork.

---

## 1. Dev 1 — FW_MCU

### 1.1 Phải làm (12 hạng mục)

```
1.  CubeMX / STM32 init (clock 64MHz, đúng FW_PINOUT_MASTER).
2.  FreeRTOS task (priority/period theo FW_ARCH §2.1).
3.  ADC ADS131M08 (SPI3 DMA, 8 kênh 24-bit).
4.  DAC8554 (SPI1 DMA, 4 kênh, LDAC sync).
5.  DI GPIO (8 kênh opto, debounce).
6.  DO relay (4 kênh ULN2003, feedback, stuck-detect).
7.  USART1 IOP (DMA RX/TX, IDLE line).
8.  CRC16 (CRC-16/Modbus, khớp test vector).
9.  ACK/NACK (đúng catalog).
10. Diagnostics (temp, VDD, counters, DIAG_RESP).
11. Watchdog (IWDG + IOP 200ms safe-state).
12. Safe-state (AO=0V/4mA, DO=open).
```

### 1.2 Module / file dự kiến

```
fw/app/io_sample.c       — đọc ADC/DI, filter, debounce
fw/app/iop_comm.c        — parse/build frame, CRC, SEQ, dispatch
fw/app/ao_output.c       — ghi DAC8554, AO mode, safe-state AO
fw/app/do_control.c      — ghi relay, feedback, stuck-detect
fw/app/diagnostics.c     — temp/VDD/counters, self-test
fw/app/watchdog.c        — liveness + IWDG kick

fw/drivers/adc_drv.c     — ADS131M08 SPI3 + DMA
fw/drivers/dac_drv.c     — DAC8554 SPI1 + DMA
fw/drivers/iop_drv.c     — USART1 DMA + IDLE
fw/drivers/gpio_drv.c    — DI/DO/mux/AO-mode GPIO

fw/common/iop_protocol.h — COPY/symlink từ shared/iop_protocol.h (KHÔNG sửa riêng)
fw/common/crc16.c        — wrapper iop_crc16
fw/test/                 — Unity host test: crc, scale, fsm
```

### 1.3 Kết quả đầu ra (acceptance)

```
1. MCU nhận HANDSHAKE → trả HANDSHAKE_RESP (version + STATUS).
2. MCU nhận GET_IO → trả IO_RESP 34 byte đúng format, CRC đúng, SEQ echo.
3. MCU nhận SET_DO → bật relay THẬT (đo bằng đồng hồ/đèn).
4. MCU nhận SET_AO → xuất AO THẬT (đo bằng đồng hồ V/mA).
5. MCU nhận SET_AO_CFG → đổi mode 0-10V/4-20mA per kênh.
6. MCU nhận GET_DIAG → trả DIAG_RESP 20 byte.
7. MCU nhận RESET_IO → vào safe-state, trả ACK.
8. MCU mất GET_IO 200ms → tự safe-state.
9. CRC sai / SEQ sai / LEN sai → NACK đúng error code.
```

### 1.4 Tài liệu phải đọc trước
[04_FW_MCU](04_FW_MCU_IMPLEMENTATION_GUIDE.md) · [05_IOP_UART](05_IOP_UART_IMPLEMENTATION_GUIDE.md) ·
[FW_DDD](../02_design/firmware/FW_DDD_MK-DDC-24_VI.md) · [FW_PINOUT_MASTER](../02_design/firmware/FW_PINOUT_MASTER_MK-DDC-24_VI.md) ·
[FW_CODING_STANDARD](../02_design/firmware/FW_CODING_STANDARD_MK-DDC-24_VI.md)

---

## 2. Dev 2 — SOM / IOP / Core

### 2.1 Phải làm (12 hạng mục)

```
mkddc-iobus:
1.  UART master (/dev/ttyS2, 921600 8N1, SCHED_FIFO ≥70).
2.  IOP client (frame build/parse, CRC, SEQ, timeout/retry).
3.  Poll GET_IO 100Hz.
4.  Parse IO_RESP + scale raw→engineering.
5.  IO cache / shared state (ghi kx_io_shm seqlock).
6.  Output command bridge (đọc ao_setpoint/do_cmd → SET_AO/SET_DO).

mkddc-core:
7.  mkddc-core skeleton (SCHED_FIFO, scan loop 1s, sd_notify READY).
8.  Point table (8 UI + 8 DI + 4 AO + 4 DO + virtual).
9.  Scan loop (read IO → graph → priority → write output).
10. Priority resolver (6 mức, BMS không ghi thẳng IO).
11. Safe-state resolver (IO fault / iobus stale → fallback).
12. Quality propagation (fault → quality bad).
```

### 2.2 Module / thư mục dự kiến

```
services/iobus/   — xem 06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md cho file list
services/core/    — xem 07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md cho file list
shared/           — iop_protocol.h, mkddc_shm.h (rename từ kinexus_shm.h)
```

### 2.3 Kết quả đầu ra (acceptance)

```
1. SOM mở được /dev/ttyS2, cấu hình 921600 8N1.
2. SOM handshake được với MCU (version OK).
3. SOM đọc được IO THẬT (DI đổi → kx_io_shm.di_state đổi).
4. SOM gửi được SET_DO/SET_AO (relay/AO thật đổi).
5. Core đọc được IO state từ kx_io_shm.
6. Core quyết định output qua priority resolver.
7. Output KHÔNG bypass core (web/BACnet/Modbus chỉ ghi command).
8. MCU fault / UART timeout → quality bad + safe-state.
```

### 2.4 Tài liệu phải đọc trước
[06_IOBUS](06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md) · [07_CORE](07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md) ·
[05_IOP_UART](05_IOP_UART_IMPLEMENTATION_GUIDE.md) · [SW_ARCH_SPEC](../01_specs/SW_ARCH_SPEC_MK-DDC-24_VI.md) ·
[SW_RUNTIME_EXECUTION_MODEL](../02_design/software/SW_RUNTIME_EXECUTION_MODEL_MK-DDC-24_VI.md)

---

## 3. Dev 3 — Web / BE

### 3.1 Phải làm (12 hạng mục)

```
1.  mkddc-web skeleton (Go HTTP server, systemd unit).
2.  REST API (xem danh sách §08).
3.  Login (JWT, bcrypt, users.conf).
4.  Point list (GET /points → 24 IO).
5.  Point detail (GET /points/{id}).
6.  Test point (commissioning: POST /commissioning/points/{id}/test).
7.  System status (GET /system/status → IOP metrics).
8.  Config IO (GET/PUT /system/config; sensor type per kênh).
9.  Alarm view (GET /alarms, POST /alarms/{id}/ack).
10. Graph validate (POST /graph/validate — validator library).
11. Graph deploy (POST /graph/deploy — chỉ khi validate pass).
12. Audit log (mọi command/deploy ghi log).
```

### 3.2 Thư mục dự kiến

```
web/backend/    — Go REST server, handlers, IPC client tới core
web/frontend/   — React UI (login, point list, detail, config, alarm, commissioning)
web/validator/  — Go library: kiểm graph.json trước deploy
web/storage/    — SQLite: config.sqlite, eventlog.sqlite, audit
```

### 3.3 Kết quả đầu ra (acceptance)

```
1. User xem được 24 IO (giá trị + unit + quality).
2. User test được DO (commissioning bật/tắt relay thật).
3. User test được AO (commissioning đặt V/mA thật).
4. User thấy lỗi MCU timeout (alarm + system status).
5. User deploy được graph.json SAU KHI validator pass.
6. Web KHÔNG mở UART.
7. Web KHÔNG gọi thẳng MCU.
```

### 3.4 Tài liệu phải đọc trước
[08_WEB](08_MKDDC_WEB_IMPLEMENTATION_GUIDE.md) · [REST_API_OPENAPI](../02_design/interfaces/REST_API_OPENAPI_MK-DDC-24_VI.md) ·
[CONFIG_SCHEMA](../02_design/interfaces/CONFIG_SCHEMA_MK-DDC-24_VI.md) · [GRAPH_SCHEMA](../02_design/interfaces/GRAPH_SCHEMA_MK-DDC-24_VI.md)

---

## 4. Ranh giới giao tiếp giữa các nhóm (interface freeze)

| Giáp ranh | Hợp đồng | Ai sửa được | Quy trình đổi |
|-----------|----------|-------------|---------------|
| FW ↔ iobus | `shared/iop_protocol.h` | Dev 1 + Dev 2 cùng đồng ý | bump `IOP_VER_*`, cross-test CRC/parse |
| iobus ↔ core | `shared/mkddc_shm.h` (`kx_io_shm_t`) | Dev 2 | bump magic nếu đổi layout |
| core ↔ web | IPC command/setpoint + REST read | Dev 2 (server) + Dev 3 (client) | đổi cùng nhau, version REST |
| web ↔ BMS | BACnet/IP, REST OpenAPI | Dev 3 | theo PICS/OpenAPI |

---

## 5. Việc làm song song được / phải nối tiếp

```
SONG SONG ngay từ Phase 0:
- Dev 1 dựng fw/ skeleton + CRC unit test.
- Dev 2 dựng services/ skeleton + SHM contract + IOP frame lib + CRC unit test.
- Dev 3 dựng web/ skeleton + REST stub + UI khung.

ĐỒNG BỘ BẮT BUỘC (cross-test) cuối mỗi phase:
- Cuối Phase 2: Dev 1 + Dev 2 cross-test IOP trên board thật (CRC, GET_IO, SET_*).
- Cuối Phase 4: Dev 2 nội bộ — core đọc/ghi shm đúng.
- Cuối Phase 5: Dev 3 + Dev 2 — web→core→shm command path.
- Phase 6: cả 3 — end-to-end.
```

---
**Rev** 1.0 | 2026-06-10
