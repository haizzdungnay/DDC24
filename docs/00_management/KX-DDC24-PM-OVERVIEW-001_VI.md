# Project Overview — MK-DDC-24
## Tổng quan dự án cho người mới

> **Document ID:** KX-DDC24-PM-OVERVIEW-001
> **Phiên bản:** 1.0 | 2026-05-30 · **Trạng thái:** Approved · **Owner:** PMO
> 📘 [docs/README](../README.md)

---

## 1. Sản phẩm là gì?
**MK-DDC-24** là **bộ điều khiển kỹ thuật số trực tiếp (DDC) cho HVAC** — "bộ não" điều khiển điều hòa/thông gió trong toà nhà. 24 điểm I/O, lập trình được (như PLC), nói chuyện với hệ thống quản lý toà nhà (BMS) qua **BACnet** và **Modbus**, lên cloud qua **MQTT**.

## 2. Hai "bộ não" (kiến trúc 2 lớp)
| Lớp | Phần cứng | Nhiệm vụ | Hệ điều hành | Ngôn ngữ |
|-----|-----------|----------|--------------|----------|
| **Real-time** | MCU STM32G0B1 | đọc cảm biến, xuất tín hiệu **mỗi 1ms** | FreeRTOS | C |
| **Application** | SOM Radxa CM3 (RK3566) | logic điều khiển, BACnet/Modbus/MQTT, web, màn hình | Debian 12 | C/C++/Python/TS |

Hai lớp nối nhau bằng **1 dây UART** chạy giao thức **IOP** (SOM = chủ, MCU = tớ).

```
Cảm biến/Van/Relay ─► MCU (1ms) ─IOP─► SOM ─► BACnet / Modbus / MQTT / Web / HMI ─► BMS / Cloud / Người dùng
```

## 3. I/O (24 điểm)
- **8× UI** (Universal Input): đọc nhiệt độ/áp suất/độ ẩm… (0–10V, 4–20mA, PT100/PT1000, NTC, dry contact).
- **8× DI** (Digital Input): tín hiệu bật/tắt (opto 24V).
- **4× AO** (Analog Output): điều khiển van/biến tần (0–10V hoặc 4–20mA).
- **4× DO** (Digital Output): relay bật/tắt thiết bị.

## 4. 4 nhóm công việc (discipline) khi làm sản phẩm
| Nhóm | Viết tắt | Làm gì |
|------|----------|--------|
| **Firmware** | FW | code C trên MCU: đọc ADC, IOP, relay, watchdog |
| **Backend** | BE | service trên SOM: io-driver, PLC, BACnet, agent (MQTT/REST/Modbus) |
| **Frontend** | FE | Web IDE trên trình duyệt: lập trình FBD/ST, cấu hình, giám sát |
| **UI/UX** | UX | thiết kế giao diện Web IDE + màn hình TFT (HMI) |

## 5. Tôi nên đọc gì tiếp?
1. [GETTING_STARTED_DEV](../../design/GETTING_STARTED_DEV.md) — cài môi trường + "muốn sửa X vào đâu".
2. [Implementation Plan](KX-DDC24-PM-IMPLPLAN-001_VI.md) — lộ trình code chi tiết.
3. Theo vai trò: [spec/README §1](../../spec/README.md) chỉ thứ tự đọc cho FW/SW/QA.

## 6. Tài liệu ở đâu?
→ [Master Document Register](KX-DDC24-QA-REGISTER-001_VI.md) liệt kê **toàn bộ** tài liệu kèm Document ID, version, owner.

---
## Revision History
| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 1.0 | 2026-05-30 | PMO | Phát hành đầu |
