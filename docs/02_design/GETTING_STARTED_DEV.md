# Getting Started — Hướng dẫn cho Developer mới
## MK-DDC-24 — "đọc là làm được"

> **Phiên bản:** 1.2 | 2026-06-13 (chuẩn hóa Modbus RTU master + link implementation docs 24/25) · 1.1 | 2026-06-08 · 📘 [README](../01_specs/README.md) · [README](README.md)
> **Mục tiêu:** một người mới (kể cả chưa quen dự án) đọc xong là cài được môi trường, build, chạy, và biết bắt đầu sửa code ở đâu.

> ℹ️ **Kiến trúc Rev A (canonical).** Lớp SOM Rev A là **3 process `mkddc-*`** (core C++ **component-graph**,
> không PLC 61131-3; web **Go**, không Python/Svelte). Nguồn-chuẩn: [PRODUCT_DEFINITION](../01_specs/PRODUCT_DEFINITION_MK-DDC-24_VI.md),
> [REVA_SCOPE](../01_specs/REVA_SCOPE_ROADMAP_MK-DDC-24_VI.md), [ADR-004..008](../adr/). Mọi tên `kinexus-*`/PLC/WebIDE còn sót đọc như **legacy reference**.

---

## 0. Bức tranh tổng thể trong 1 phút

Thiết bị có **2 bộ não**:
- **MCU** (chip STM32, nhỏ) — đọc cảm biến và bật/tắt relay **mỗi 1 mili-giây**. Code = **C/FreeRTOS**.
- **SOM** (máy tính Linux nhỏ, Radxa CM3) — chạy logic điều khiển, BACnet/IP, Modbus, web. Code = **C++17** (`mkddc-core`/`mkddc-iobus`) + **Go** (`mkddc-web`) + **React** (ui) trên **Debian**. *(MQTT/cloud → Rev B+.)*

Hai bộ não nói chuyện qua **1 dây UART** bằng giao thức **IOP** (giống như 2 người nhắn tin theo mẫu cố định). MCU gửi "giá trị cảm biến đây", SOM gửi "bật relay 1, đặt van 50%".

```
Cảm biến/van ─► MCU (1ms, C) ─IOP/UART─► SOM (Linux) ─► BACnet/IP·REST·Web ─► BMS (Ethernet)
                                              └─► Modbus RTU master (RS-485) ─► thiết bị phụ
```

> 👉 Nếu bạn làm **firmware** → đọc nhánh MCU. Nếu làm **software** → đọc nhánh SOM. Cả hai phải tôn trọng **hợp đồng IOP** ([SWFW_INTERFACE_SPEC](../01_specs/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md)) và **bảng chân** ([D-1](firmware/FW_PINOUT_MASTER_MK-DDC-24_VI.md)).

---

## 1. Nhánh FIRMWARE (MCU STM32G0B1)

### 1.1 Cần cài gì
| Công cụ | Dùng để | Lệnh/Link |
|---------|---------|-----------|
| STM32CubeIDE 1.15+ | IDE + compiler + nạp chip | tải từ st.com (free) |
| (hoặc) arm-none-eabi-gcc 12 + CMake | build dòng lệnh | `sudo apt install gcc-arm-none-eabi cmake` |
| ST-Link V3 | nạp/debug qua dây SWD | phần cứng |
| STM32CubeMX | tạo cấu hình chân/clock (.ioc) | trong CubeIDE |

### 1.2 Quy trình lần đầu
1. Mở CubeMX → chọn **STM32G0B1RBT6** → cấu hình chân **đúng theo [D-1 Pinout Master](firmware/FW_PINOUT_MASTER_MK-DDC-24_VI.md)** (USART1, SPI1, SPI3, DI, DO, mux…).
2. Bật **FreeRTOS** (CMSIS-RTOS v2), DMA cho USART1/SPI1/SPI3.
3. Generate code → mở project.
4. Thêm các task theo **[FW_DDD §4](firmware/FW_DDD_MK-DDC-24_VI.md)** (mỗi task 1 file `.c`).
5. Build → nạp qua ST-Link → xem log qua USART2 (115200 8N1).

### 1.3 Cây thư mục code FW đề xuất
```
fw/
├── Core/            # CubeMX sinh: main.c, clock, gpio init
├── drivers/         # adc_drv.c, dac_drv.c, iop_drv.c, gpio_drv.c
├── app/             # io_sample.c, iop_comm.c, ao_output.c, do_control.c, diagnostics.c, watchdog.c
├── common/          # iop_protocol.h (định nghĩa frame/CMD), crc16.c, fault.h
└── test/            # unit test host (Unity): crc, scale, fsm
```

### 1.4 "Hello world" của dự án này
Mục tiêu đầu tiên nên làm: **trả lời được 1 frame IOP**. Khi SOM (hoặc PC test) gửi `GET_IO`, MCU trả `IO_RESP` với CRC đúng. Có cái này là xương sống đã chạy. → xem [FW_MOD_IOP_COMM](firmware/FW_MOD_IOP_COMM_MK-DDC-24_VI.md).

### 1.5 Luật bất di bất dịch
- Theo **[FW Coding Standard](firmware/FW_CODING_STANDARD_MK-DDC-24_VI.md)** (MISRA): **không `malloc` sau khi RTOS chạy**, ISR phải ngắn, mọi HAL call check lỗi.
- Output an toàn khi lỗi: AO=0V/4mA, relay=mở (safe-state).

---

## 2. Nhánh SOFTWARE (SOM Debian)

### 2.1 Cần cài gì (trên máy dev + trên SOM)
```bash
# Trên máy dev (Ubuntu/Debian)
sudo apt install build-essential cmake g++ libmodbus-dev   # mkddc-core / mkddc-iobus (C++17)
sudo apt install golang-go nodejs npm                      # mkddc-web (Go) + ui (React)
# BACnet stack
git clone https://github.com/bacnet-stack/bacnet-stack
```

### 2.2 Kết nối vào thiết bị
```bash
# SSH vào SOM (port 2222, key-only — KHÔNG phải 22)
ssh -p 2222 kinexus@<ip-thiet-bi>
# Web config UI / commissioning (mkddc-web, trong LAN)
http://<ip-thiet-bi>:8080      # production sẽ redirect sang https://<ip>:8443
```

### 2.3 Các service (Rev A — chỉ 3 process)
> Nguồn-chuẩn: [CANONICAL_DECISIONS](../CANONICAL_DECISIONS.md), [ADR-005](../adr/ADR-005-three-process-architecture.md).

| Service | Code dir | Vai trò |
|---------|----------|---------|
| `mkddc-core` | `services/core/` | graph engine + IO image + priority/safe-state + BACnet object table (C++17) |
| `mkddc-iobus` | `services/iobus/` | IOP/MCU scan + Modbus RTU master + BACnet/IP datalink (C/C++17) |
| `mkddc-web` | `web/` | REST + config form/JSON + import/export `graph.json` + validator (Go) |

```bash
systemctl status mkddc-core           # xem service lõi
journalctl -u mkddc-iobus -f          # log I/O realtime
cat /dev/shm/mkddc_io_shm | xxd | head # dữ liệu I/O (shared memory)
```

> ⛔ **Legacy — KHÔNG dùng cho Rev A:** `kinexus-io-driver/plc/bacnet/agent/webide/hmi/ota`.
> Các tên này superseded ([CANONICAL_DECISIONS](../CANONICAL_DECISIONS.md)). HMI/agent/OTA → Rev B+.

### 2.4 "Hello world" của software
Mục tiêu đầu tiên: **đọc được giá trị I/O từ shared memory** mà `mkddc-iobus` ghi ra, in lên màn hình. Hiểu được `mkddc_io_shm` (hợp đồng IOP ở [SW_ARCH §2](../01_specs/SW_ARCH_SPEC_MK-DDC-24_VI.md)) là nắm được mạch máu dữ liệu. → xem [06_IOBUS](../03_implementation/06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md) và [07_CORE](../03_implementation/07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md).

### 2.5 Luật bất di bất dịch
- Theo **[SW Coding Standard](software/SW_CODING_STANDARD_MK-DDC-24_VI.md)**: validate mọi input mạng, TLS 1.3, không hardcode secret, audit log.
- Đọc/ghi I/O **chỉ qua shared memory** (seqlock), không tự mở UART nói chuyện MCU (đó là việc của io-driver).

---

## 3. Bản đồ "tôi muốn sửa X thì vào đâu"

| Muốn làm… | Đọc tài liệu | Sửa code ở |
|-----------|--------------|------------|
| Thêm/sửa lệnh giao tiếp MCU↔SOM | [SWFW_INTERFACE_SPEC](../01_specs/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md) | iop_comm (FW) + `mkddc-iobus` (SW) |
| Đổi chân cảm biến/relay | [D-1 Pinout](firmware/FW_PINOUT_MASTER_MK-DDC-24_VI.md) | CubeMX + gpio_drv |
| Thêm thiết bị phụ Modbus RTU (mở rộng I/O) | [D-2 RTU Master/Expansion](interfaces/MODBUS_REGISTER_MAP_MK-DDC-24_VI.md) + [Implementation 25](../03_implementation/25_MODBUS_IMPLEMENTATION_PLAN.md) | `mkddc-iobus` |
| Thêm object BACnet | [D-3 PICS](interfaces/BACNET_PICS_EPICS_MK-DDC-24_VI.md) + [Implementation 24](../03_implementation/24_BACNET_IMPLEMENTATION_PLAN.md) | `mkddc-iobus` + object table trong `mkddc-core` |
| Thêm API REST | [D-4 OpenAPI](interfaces/REST_API_OPENAPI_MK-DDC-24_VI.md) | `mkddc-web` (Go) |
| Thêm tham số cấu hình | [D-5 Config Schema](interfaces/CONFIG_SCHEMA_MK-DDC-24_VI.md) | `mkddc-web` (form/JSON) + service đọc config |
| Logic điều khiển (PID, component graph) | [D-6 Runtime Execution Model](software/SW_RUNTIME_EXECUTION_MODEL_MK-DDC-24_VI.md) · [Component Library](software/SW_COMPONENT_LIBRARY_MK-DDC-24_VI.md) | `mkddc-core` |
| OTA / Màn hình TFT *(Rev B+)* | [SW_OTA_DESIGN](software/SW_OTA_DESIGN_MK-DDC-24_VI.md) · [SW_HMI_DESIGN](software/SW_HMI_DESIGN_MK-DDC-24_VI.md) | *deferred — không thuộc Rev A.0* |

---

## 4. Quy tắc làm việc (cho mọi người)
- Mỗi việc gắn với **REQ ID** (vd `FW-IO-001`). Ghi vào commit/PR.
- Trước khi code 1 module → đọc **design doc của module đó** trong `design/`.
- Khi 2 tài liệu mâu thuẫn → theo **bảng nguồn-chuẩn** ở [README §3](../01_specs/README.md).
- Có gì chưa rõ/chưa quyết → ghi vào [OPEN_ISSUES](../01_specs/OPEN_ISSUES_MK-DDC-24_VI.md), đừng tự đoán.

---
**Rev** 1.0 | 2026-05-30
