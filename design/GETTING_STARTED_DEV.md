# Getting Started — Hướng dẫn cho Developer mới
## MK-DDC-24 — "đọc là làm được"

> **Phiên bản:** 1.0 | 2026-05-30 · 📘 [spec/README](../spec/README.md) · [design/README](README.md)
> **Mục tiêu:** một người mới (kể cả chưa quen dự án) đọc xong là cài được môi trường, build, chạy, và biết bắt đầu sửa code ở đâu.

---

## 0. Bức tranh tổng thể trong 1 phút

Thiết bị có **2 bộ não**:
- **MCU** (chip STM32, nhỏ) — đọc cảm biến và bật/tắt relay **mỗi 1 mili-giây**. Code = **C/FreeRTOS**.
- **SOM** (máy tính Linux nhỏ, Radxa CM3) — chạy logic điều khiển, BACnet, web, MQTT… Code = **C/C++/Python/TypeScript** trên **Debian**.

Hai bộ não nói chuyện qua **1 dây UART** bằng giao thức **IOP** (giống như 2 người nhắn tin theo mẫu cố định). MCU gửi "giá trị cảm biến đây", SOM gửi "bật relay 1, đặt van 50%".

```
Cảm biến/van  ──►  MCU (1ms, C)  ──IOP/UART──►  SOM (Linux, app)  ──►  BACnet/MQTT/Web/Modbus  ──► BMS/Cloud
```

> 👉 Nếu bạn làm **firmware** → đọc nhánh MCU. Nếu làm **software** → đọc nhánh SOM. Cả hai phải tôn trọng **hợp đồng IOP** ([SWFW_INTERFACE_SPEC](../spec/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md)) và **bảng chân** ([D-1](firmware/FW_PINOUT_MASTER_MK-DDC-24_VI.md)).

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
sudo apt install build-essential cmake python3.11 python3-pip nodejs npm libmodbus-dev
pip install fastapi uvicorn paho-mqtt pymodbus pytest ruff mypy
# BACnet stack
git clone https://github.com/bacnet-stack/bacnet-stack
```

### 2.2 Kết nối vào thiết bị
```bash
# SSH vào SOM (port 2222, key-only — KHÔNG phải 22)
ssh -p 2222 kinexus@<ip-thiet-bi>
# Web IDE commissioning (trong LAN)
http://<ip-thiet-bi>:8080      # production sẽ redirect sang https://<ip>:8443
```

### 2.3 Các service (systemd) và file
| Service | Binary | Code |
|---------|--------|------|
| kinexus-io-driver | /usr/sbin/kinexus-iod | C/Rust |
| kinexus-plc | /usr/sbin/kinexus-plcd | C++ |
| kinexus-bacnet | /usr/sbin/kinexus-bacnetd | C |
| kinexus-agent | /usr/bin/kinexus-agent | Python |
| kinexus-webide | /usr/bin/kinexus-webide | Py+Svelte |
| kinexus-hmi | /usr/sbin/kinexus-hmid | C/LVGL |
| kinexus-ota | /usr/sbin/kinexus-otad | Python |

```bash
systemctl status kinexus-plc          # xem service
journalctl -u kinexus-io-driver -f    # xem log realtime
cat /dev/shm/kinexus_io_shm | xxd | head   # dữ liệu I/O (shared memory)
```

### 2.4 "Hello world" của software
Mục tiêu đầu tiên: **đọc được giá trị I/O từ shared memory** mà `kinexus-io-driver` ghi ra, in lên màn hình. Hiểu được `kinexus_io_shm` (định nghĩa ở [SW_ARCH §2](../spec/SW_ARCH_SPEC_MK-DDC-24_VI.md)) là nắm được mạch máu dữ liệu. → xem [SW_IODRIVER_DESIGN](software/SW_IODRIVER_DESIGN_MK-DDC-24_VI.md).

### 2.5 Luật bất di bất dịch
- Theo **[SW Coding Standard](software/SW_CODING_STANDARD_MK-DDC-24_VI.md)**: validate mọi input mạng, TLS 1.3, không hardcode secret, audit log.
- Đọc/ghi I/O **chỉ qua shared memory** (seqlock), không tự mở UART nói chuyện MCU (đó là việc của io-driver).

---

## 3. Bản đồ "tôi muốn sửa X thì vào đâu"

| Muốn làm… | Đọc tài liệu | Sửa code ở |
|-----------|--------------|------------|
| Thêm/sửa lệnh giao tiếp MCU↔SOM | [SWFW_INTERFACE_SPEC](../spec/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md) | iop_comm (FW) + kinexus-io-driver (SW) |
| Đổi chân cảm biến/relay | [D-1 Pinout](firmware/FW_PINOUT_MASTER_MK-DDC-24_VI.md) | CubeMX + gpio_drv |
| Thêm điểm Modbus | [D-2 Modbus Map](interfaces/MODBUS_REGISTER_MAP_MK-DDC-24_VI.md) | kinexus-agent |
| Thêm object BACnet | [D-3 PICS](interfaces/BACNET_PICS_EPICS_MK-DDC-24_VI.md) | kinexus-bacnet |
| Thêm API REST | [D-4 OpenAPI](interfaces/REST_API_OPENAPI_MK-DDC-24_VI.md) | kinexus-agent |
| Thêm tham số cấu hình | [D-5 Config Schema](interfaces/CONFIG_SCHEMA_MK-DDC-24_VI.md) | webide + service đọc config |
| Logic điều khiển (PID, FBD) | [D-6 PLC Engine](software/SW_PLC_ENGINE_DESIGN_MK-DDC-24_VI.md) | kinexus-plc |
| Cập nhật firmware từ xa | [D-7 OTA](software/SW_OTA_DESIGN_MK-DDC-24_VI.md) | kinexus-ota + FW bootloader |
| Màn hình TFT | [SW_HMI_DESIGN](software/SW_HMI_DESIGN_MK-DDC-24_VI.md) | kinexus-hmi |

---

## 4. Quy tắc làm việc (cho mọi người)
- Mỗi việc gắn với **REQ ID** (vd `FW-IO-001`). Ghi vào commit/PR.
- Trước khi code 1 module → đọc **design doc của module đó** trong `design/`.
- Khi 2 tài liệu mâu thuẫn → theo **bảng nguồn-chuẩn** ở [spec/README §3](../spec/README.md).
- Có gì chưa rõ/chưa quyết → ghi vào [OPEN_ISSUES](../spec/OPEN_ISSUES_MK-DDC-24_VI.md), đừng tự đoán.

---
**Rev** 1.0 | 2026-05-30
