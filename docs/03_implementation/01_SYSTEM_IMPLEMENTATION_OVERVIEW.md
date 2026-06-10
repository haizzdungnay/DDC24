# 01 — System Implementation Overview
## MK-DDC-24 — Hệ thống ở mức implement

> **Document ID:** IMPL-OVERVIEW-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-06-10
> **Đọc trước:** [00_README](00_IMPLEMENTATION_README.md)

---

## 1. Sơ đồ khối hệ thống (implement view)

```
              [User / BMS / Commissioning engineer]
                          │  HTTPS / BACnet/IP / Modbus
                          ▼
              ┌────────────────────────┐
              │       mkddc-web         │  Go + React
              │  REST API · UI · Config │  (web/)
              │  Validator · Audit log  │
              └───────────┬────────────┘
                          │  IPC: command/setpoint  (KHÔNG mở UART)
                          ▼
              ┌────────────────────────┐
              │       mkddc-core        │  C++17, SCHED_FIFO
              │  Point table · Scan loop│  (services/core/)
              │  Graph · Priority ·     │
              │  Safe-state · BACnet obj│
              └───────────┬────────────┘
            đọc kx_io_shm │ ▲ ghi ao_setpoint[]/do_cmd[]  (seqlock)
                          ▼ │
              ┌────────────────────────┐
              │      mkddc-iobus        │  C/C++17
              │  MASTER UART/IOP ·      │  (services/iobus/)
              │  Modbus RTU/TCP ·       │
              │  BACnet/IP datalink     │
              └───────────┬────────────┘
                          │  UART2 /dev/ttyS2 · 921600 8N1 · IOP frame + CRC16
                          ▼  (ADUM1201 isolation)
              ┌────────────────────────┐
              │     FW_MCU STM32G0B1    │  C11 / FreeRTOS
              │  io_sample · iop_comm · │  (fw/)
              │  ao_output · do_control │
              │  diagnostics · watchdog │
              └───────────┬────────────┘
                          │  SPI3/SPI1/GPIO
                          ▼
        ┌──────────────────────────────────────────┐
        │  8 UI (ADS131M08) · 8 DI (PC817 opto)     │
        │  4 AO (DAC8554)   · 4 DO (ULN2003→relay)  │
        └──────────────────────────────────────────┘
```

> ⚠️ Số kênh THẬT theo nguồn-chuẩn HW = **8 UI + 8 DI + 4 AO + 4 DO** (FW_PINOUT_MASTER,
> HW_SPEC). Bảng "24 IO" trong marketing = 8+8+4+4. Mọi code đi theo 8/8/4/4.

---

## 2. Giải thích từng khối

### 2.1 FW_MCU (STM32G0B1RBT6 / FreeRTOS)

| Hạng mục | Nội dung |
|----------|----------|
| **Nhiệm vụ** | Đọc UI/DI; ghi AO/DO; trả `IO_RESP` cho SOM; nhận `SET_DO`/`SET_AO`/`SET_AO_CFG`; safe-state khi lỗi |
| **KHÔNG làm** | Không chạy logic điều khiển hệ thống (PID/interlock/schedule), không tự quyết relay theo logic nghiệp vụ |
| **Vai trò IOP** | **Slave** — chỉ phản hồi, echo SEQ, không tự phát frame |
| **Real-time** | io_sample 1ms; IOP response ≤ 5ms |
| **Safe-state** | Không nhận `GET_IO` trong 200ms → AO=0V/4mA, DO=open tự động |
| Trace | [FW_DDD](../02_design/firmware/FW_DDD_MK-DDC-24_VI.md), [FW_PINOUT_MASTER](../02_design/firmware/FW_PINOUT_MASTER_MK-DDC-24_VI.md) |

### 2.2 mkddc-iobus (SOM, non-real-time)

| Hạng mục | Nội dung |
|----------|----------|
| **Nhiệm vụ** | **Master UART/IOP**: poll `GET_IO` 100Hz, parse `IO_RESP`, gửi `SET_DO`/`SET_AO`, handshake, báo lỗi timeout/CRC/SEQ |
| **Scale** | raw ADC/DAC ↔ engineering value (theo SW_ARCH §4) thực hiện ở đây, không ở core |
| **Ghi** | snapshot IO vào `kx_io_shm` (seqlock); đọc `ao_setpoint[]`/`do_cmd[]` từ shm để gửi MCU |
| **Cũng làm** | Modbus RTU x2 + Modbus TCP client (poll async → ext cache); BACnet/IP network datalink |
| **KHÔNG làm** | Không quyết định output theo logic (đó là việc core); chỉ thực thi lệnh đã được core quyết |
| Trace | [06_IOBUS](06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md), [SWFW_INTERFACE_SPEC](../01_specs/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md) |

### 2.3 mkddc-core (SOM, SCHED_FIFO)

| Hạng mục | Nội dung |
|----------|----------|
| **Nhiệm vụ** | Giữ **point table** (24 IO + virtual); chạy **scan loop** (1s Rev A); chạy **graph/logic**; **resolve priority**; **quyết output cuối cùng** |
| **Đọc** | `kx_io_shm` (IO từ MCU qua iobus), ext cache (Modbus), BACnet command |
| **Ghi** | `ao_setpoint[]`/`do_cmd[]` vào `kx_io_shm`; `kx_plc_shm` (BACnet object table) |
| **An toàn** | Mọi DO/AO **bắt buộc qua priority resolver**; IO fault → point quality = bad |
| Trace | [07_CORE](07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md), [SW_RUNTIME_EXECUTION_MODEL](../02_design/software/SW_RUNTIME_EXECUTION_MODEL_MK-DDC-24_VI.md) |

### 2.4 mkddc-web (SOM, non-real-time)

| Hạng mục | Nội dung |
|----------|----------|
| **Nhiệm vụ** | REST API; Web UI; config (form/JSON); commissioning; validator (library); audit log |
| **Gửi lệnh** | qua IPC tới **core** (command/setpoint), **không** ghi thẳng IO |
| **KHÔNG làm** | Không mở UART; không nói chuyện trực tiếp với MCU; không bypass core |
| Trace | [08_WEB](08_MKDDC_WEB_IMPLEMENTATION_GUIDE.md), [REST_API_OPENAPI](../02_design/interfaces/REST_API_OPENAPI_MK-DDC-24_VI.md) |

---

## 3. Hợp đồng dữ liệu giữa các khối (IPC contract)

| Ranh giới | Cơ chế | Hợp đồng / file | Writer | Reader |
|-----------|--------|-----------------|--------|--------|
| MCU ↔ iobus | UART 921600 8N1 + IOP frame | [`shared/iop_protocol.h`](../../shared/iop_protocol.h) | cả hai | cả hai |
| iobus → core (IO in) | POSIX SHM seqlock `/dev/shm/mkddc_io_shm` | `kx_io_shm_t` ([`shared/kinexus_shm.h`](../../shared/kinexus_shm.h)) | iobus | core |
| core → iobus (output) | cùng SHM, field `ao_setpoint[]`/`do_cmd[]` | `kx_io_shm_t` | core | iobus |
| core → iobus (BACnet obj) | SHM `/dev/shm/mkddc_plc_shm` | `kx_plc_shm_t` | core | iobus (BACnet/IP) |
| web ↔ core | Unix socket / REST-internal (command/setpoint + read) | (định nghĩa ở [07_CORE §IPC](07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md)) | web→core (cmd), core→web (read) | |
| iobus → all | alarm bus `/run/mkddc/alarm.sock` (JSON lines) | SW_ARCH §2.3 | iobus/core | web |

> Rename theo ADR-005: `kinexus_*` → `mkddc_*`. Code follows docs. Hợp đồng struct/seqlock
> **không đổi**, chỉ đổi tên path/header.

---

## 4. Bản đồ IO vật lý (để mọi khối nói cùng một ngôn ngữ)

| Loại | Số | MCU peripheral | Pin (FW_PINOUT_MASTER) | Trong IO_RESP/SET_* | Trong kx_io_shm |
|------|----|----|------------------------|---------------------|-----------------|
| UI (universal input) | 8 | ADS131M08 / SPI3 | PC10/11/12, CS PB2, DRDY PA8 | `UI1..8_RAW` uint24 BE | `ui_value[8]`, `ui_quality[8]` |
| DI (digital input) | 8 | GPIO opto PC817 | PB4..PB11 | `DI_MASK` byte24 | `di_state[8]` |
| AO (analog output) | 4 | DAC8554 / SPI1 | PA4/5/7, LDAC PB0 | `SET_AO` 4×uint16 BE | `ao_setpoint[4]`, `ao_mode[4]` |
| DO (relay) | 4 | ULN2003 GPIO | PC0..PC3 | `SET_DO` mask+value; FB byte25 | `do_cmd[4]`, `do_feedback[4]` |
| AO mode select | 4 | GPIO relay/switch | PD1..PD4 | `SET_AO_CFG` 1 byte | `ao_mode[4]` |

---

## 5. Vòng đời một giá trị (tóm tắt — chi tiết ở 09)

**Lên (telemetry):** sensor → ADS131M08 → `io_sample` (1ms) → `IO_RESP` → iobus parse+scale
→ `kx_io_shm.ui_value` → core point table → `kx_plc_shm`/REST → web.

**Xuống (command):** web `PUT /points/DO1` → core command queue → priority resolver →
`kx_io_shm.do_cmd[0]` → iobus build `SET_DO` → MCU `do_control` → relay PC0.

---

## 6. Ranh giới real-time (vì sao chia 3 process)

```
HARD real-time (1ms)        ── FW_MCU (STM32)            : sampling + safe-state
SOFT real-time (10–100ms)   ── mkddc-iobus               : UART poll 100Hz, Modbus
DETERMINISTIC loop (1s)     ── mkddc-core (SCHED_FIFO)   : scan + priority
BEST EFFORT                 ── mkddc-web                 : UI/API/config
```

Lý do (ADR-005): vòng điều khiển (core) **không** băng qua ranh giới process để đọc IO; I/O
mạng chậm (Modbus/BACnet) bị cô lập trong iobus để không kéo trễ vòng core.

---
**Rev** 1.0 | 2026-06-10
