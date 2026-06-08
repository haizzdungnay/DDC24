# Tài liệu Mô tả Phần mềm — MK-DDC-24

> **Tài liệu:** KX-DDC24-SWDESC-001_VI  
> **Sản phẩm:** MK-DDC-24 — Bộ điều khiển DDC 24 điểm  
> **Phiên bản:** 1.0 | 2026-06-02  
> **Mục đích:** Mô tả kiến trúc phần mềm, phiên bản firmware và các giao thức — phục vụ hồ sơ CR Mark / QCVN (mục E5)

> ⚠️ **RECONCILE (2026-06-08).** Mô hình điều khiển là **component-based graph** (không
> phải IEC 61131-3 PLC), tầng SOM gồm **3 process `mkddc-*`** (web Go + core C++), UI Rev A
> là **form/JSON** (không Web IDE FBD). Nguồn-chuẩn: [PRODUCT_DEFINITION](../01_specs/PRODUCT_DEFINITION_MK-DDC-24_VI.md),
> [ADR-004..007](../adr/). Sơ đồ dưới đây cần cập nhật tên service/engine khi
> làm bản dossier kế tiếp; nội dung giao thức (BACnet/Modbus) vẫn đúng.

---

## 1. Tổng quan Kiến trúc Phần mềm

MK-DDC-24 chạy kiến trúc phần mềm hai tầng (dual-layer):

```
┌──────────────────────────────────────────────────────┐
│ Tầng 1 — SOM / Application (Debian 12 Linux)         │
│                                                       │
│  ┌────────────┐  ┌───────────┐  ┌──────────────────┐ │
│  │ KinexusET  │  │ BACnet    │  │ MQTT / REST API   │ │
│  │ Web IDE    │  │ Stack     │  │ (kinexus-agent)   │ │
│  └─────┬──────┘  └─────┬─────┘  └────────┬─────────┘ │
│        │               │                  │           │
│  ┌─────▼───────────────▼──────────────────▼─────────┐ │
│  │ Soft PLC Runtime (IEC 61131-3)                    │ │
│  │ FBD engine · ST engine · Scheduler · Data Model   │ │
│  └────────────────────────┬─────────────────────────┘ │
│                           │ Kinexus-IOP (UART)        │
└───────────────────────────│───────────────────────────┘
                            │
┌───────────────────────────▼───────────────────────────┐
│ Tầng 2 — MCU / Real-time (STM32G0, FreeRTOS)          │
│ ADC sampling · DAC output · GPIO · Relay driver        │
└────────────────────────────────────────────────────────┘
```

### 1.1 Tầng Application (SOM — Radxa CM3)

| Thành phần | Vai trò | Ngôn ngữ |
|------------|---------|----------|
| OS | Debian 12 Bookworm, kernel 6.1 LTS PREEMPT_RT | C / Shell |
| Component Graph Runtime (mkddc-core) | execution plan + PID/timer/priority resolver | C++17 |
| BACnet Stack | BACnet/IP (ASHRAE 135-2020), B-ASC profile | C |
| MQTT Agent | MQTT v3.1.1/v5.0, TLS 1.3 | Python / Go |
| REST API | HTTPS JSON API port 8443 | Python / Go |
| mkddc-web | Web cấu hình form/JSON + import graph.json | Go + React |
| HMI Display | LVGL v9 dashboard, TFT 2.4" ILI9341 | C |
| I/O Abstraction | Kinexus-IOP protocol SOM ↔ MCU qua UART | C |
| OTA Daemon | A/B partition, GPG-signed package | Python |
| Field Bus | Modbus RTU master (RS-485), device profile | C / Python |

### 1.2 Tầng Real-time (MCU — STM32G0B1RB)

| Thành phần | Vai trò |
|------------|---------|
| FreeRTOS | HĐH thời gian thực |
| ADC Driver | Sampling 8 UI (ADS131M08) |
| DAC Driver | Output 4 AO (DAC8554) |
| GPIO Driver | 8 DI, 4 DO relay |
| Kinexus-IOP Slave | Giao tiếp UART với SOM, chu kỳ 10 ms |

### 1.3 Giao tiếp nội bộ (Kinexus-IOP)

| Thông số | Giá trị |
|----------|---------|
| Physical | UART 921.600 baud, isolation ADUM1201 |
| Chu kỳ poll | SOM poll MCU mỗi 10 ms |
| Frame | CRC16, sequence number |
| Fail-safe | Timeout 100 ms → Fault flag; 5s → safe-state |

---

## 2. Phiên bản Firmware

### 2.1 Quy tắc đặt phiên bản

Phiên bản firmware tuân theo **Semantic Versioning** (MAJOR.MINOR.PATCH):

```
MAJOR.MINOR.PATCH-{build_metadata}
```

| Thành phần | Ý nghĩa | Khi nào tăng |
|-----------|---------|-------------|
| MAJOR | Thay đổi kiến trúc / giao thức không tương thích ngược | Phát hành Ver 2.0, 3.0... |
| MINOR | Thêm tính năng, tương thích ngược | Ver 1.1, 1.2... |
| PATCH | Sửa lỗi, vá bảo mật | Ver 1.0.1, 1.0.2... |

**Ví dụ:** `1.0.0-beta.1` — bản beta đầu tiên của Ver 1.0.
               `1.0.0` — bản GA đầu tiên.
               `1.1.0` — bản phát hành thêm MQTT, REST API đầy đủ.

### 2.2 Component versioning

Mỗi firmware release bao gồm các package riêng rẽ, mỗi package có phiên bản riêng:

| Package | Base version (Ver 1.0) | Mô tả |
|---------|----------------------|-------|
| `kinexus-os-image` | 1.0.0 | OS image Debian + kernel + U-Boot |
| `mkddc-core` | 1.0.0 | Component graph runtime |
| `kinexus-bacnet` | 1.0.0 | BACnet/IP stack |
| `kinexus-agent` | 1.0.0 | MQTT + REST API agent |
| `mkddc-web` | 1.0.0 | Web cấu hình (Go, form/JSON) |
| `kinexus-fieldbus` | 1.0.0 | Modbus RTU master driver |
| `kinexus-iohal` | 1.0.0 | I/O abstraction layer + IOP |
| `kinexus-hmi` | 1.0.0 | HMI TFT display app |
| `kinexus-mcu-fw` | 1.0.0 | MCU STM32 firmware (FreeRTOS) |

### 2.3 Phiên bản kế hoạch

| Phiên bản | Tính năng | Target |
|-----------|-----------|--------|
| **Ver 1.0 (MVP)** | BACnet/IP, component graph runtime, Web form/JSON, OTA A/B | Q4/Y7 |
| **Ver 1.1** | MQTT TLS, REST API đầy đủ, dashboard realtime | Q1/Y8 |
| **Ver 1.2** | BACnet/SC (Secure Connect), IEC 62443-4-2 | Q2/Y8 |
| **Ver 2.0** | Edge AI anomaly detection (NPU), advanced ST libs | Q4/Y8 |

### 2.4 Cập nhật firmware (OTA)

- Package dạng `.deb` ký GPG.
- A/B partition scheme: active + standby.
- Download qua HTTPS TLS 1.3, verify SHA-256 + GPG.
- Downtime khi reboot ≤ 60 giây.
- Rollback tự động nếu boot 2 lần thất bại.

---

## 3. Giao thức Kết nối

### 3.1 BACnet/IP

| Thông số | Giá trị |
|----------|---------|
| Chuẩn | ASHRAE 135-2020, BACnet/IP (Annex J) |
| Transport | UDP port 47808 |
| Max APDU | 1476 bytes |
| Segmentation | Hỗ trợ |
| BBMD | Có (Foreign Device registration) |
| Profile mục tiêu | B-ASC (BTL conformance) |

**Object types hỗ trợ:**

| Object Type | Số lượng | COV |
|-------------|:--------:|:---:|
| Device | 1 | — |
| Analog Input | 8 | ✅ |
| Analog Output | 4 | ✅ |
| Analog Value | 32 | ✅ |
| Binary Input | 8 | — |
| Binary Output | 4 | ✅ |
| Binary Value | 16 | ✅ |
| Multi-state Value | 8 | ✅ |
| Trend Log | 8 | — |
| Schedule | 8 | — |
| Calendar | 2 | — |
| Notification Class | 4 | — |
| Event Enrollment | 8 | — |

### 3.2 MQTT

| Thông số | Giá trị |
|----------|---------|
| Phiên bản | v3.1.1 / v5.0 |
| Transport | TCP, TLS 1.3 bắt buộc |
| Port | 8883 (TLS) |
| Topic pattern | `kinexus/{device_id}/io/{point_name}` |
| COV publish | Khi giá trị thay đổi |
| Last Will | Có (offline status) |

### 3.3 REST API

| Thông số | Giá trị |
|----------|---------|
| Protocol | HTTPS (TLS 1.3) |
| Port | 8443 |
| Auth | Bearer token JWT (exp 1 giờ) |
| Rate limit | 100 req/s/IP |

### 3.4 Modbus RTU Master (RS-485)

| Thông số | Giá trị |
|----------|---------|
| Vai trò | Master (DDC chủ động poll) |
| Physical | RS-485, terminal A/B/GND |
| Baud | 9600 / 19200 / 38400 / 57600 / 115200 |
| Parity | 8N1 / 8E1 / 8O1 |
| Max slaves | 16 (mở rộng được) |
| Khoảng cách | 1200 m @ 9600 baud |
| Device profile | Template register-map, thêm slave mới bằng cấu hình |

---

## 4. Bảo mật

| Tính năng | Mô tả |
|-----------|-------|
| Secure boot | U-Boot verify GPG signature kernel |
| Firmware signing | GPG-signed .deb package |
| A/B partition | Rollback tự động khi boot lỗi |
| TLS 1.3 | Toàn bộ REST API, MQTT, OTA |
| SSH hardening | Disable root login, key-only, non-default port |
| Firewall | nftables, chỉ mở port cần thiết |
| Web UI auth | Local account (admin/operator/viewer) |
| Audit log | Login, config change, firmware update, point write |
| Brute-force protection | Lockout 15 phút sau 5 lần sai |

---

## 5. Yêu cầu Hệ thống

### 5.1 Yêu cầu phần cứng tối thiểu

| Thành phần | Thông số |
|-----------|----------|
| SOM | Radxa CM3 (RK3566), 4× Cortex-A55 @ 1.8 GHz |
| RAM | 2 GB LPDDR4 |
| Storage | 8 GB eMMC + microSD |
| MCU | STM32G0B1RB, Cortex-M0+, 64 MHz |

### 5.2 Yêu cầu phần mềm (cho commissioning)

| Công cụ | Mô tả |
|---------|-------|
| Trình duyệt | Chrome 120+ / Edge 120+ / Firefox 120+ |
| mkddc-web | Web cấu hình form/JSON, không cần cài đặt — qua trình duyệt |
| Serial console (tùy chọn) | PuTTY / screen / minicom cho debug qua USB-C |

---

## 6. Danh sách Package Phần mềm (SBOM — Software Bill of Materials)

| Package | Loại | Phiên bản | Nguồn |
|---------|------|-----------|-------|
| Debian 12 Bookworm | OS | 12.x | debian.org |
| Linux kernel | Kernel | 6.1.x PREEMPT_RT | kernel.org |
| U-Boot | Bootloader | 2024.01 | u-boot.org |
| FreeRTOS | RTOS | 10.6.x | freertos.org |
| BACnet Stack | Protocol | nội bộ | KINEXUS |
| MQTT Agent | Service | nội bộ | KINEXUS |
| LVGL | Graphics | 9.x | lvgl.io |
| Node.js | Runtime | 20.x LTS | nodejs.org |
| Python | Runtime | 3.11.x | python.org |

> SBOM đầy đủ được tạo tự động khi build và đi kèm mỗi release.

---

## 7. Tuân thủ Tiêu chuẩn

| Tiêu chuẩn | Áp dụng |
|-----------|---------|
| IEC 61131-3:2013 | *(tầm nhìn Rev C — KHÔNG thuộc Rev A)* |
| ASHRAE 135-2020 | BACnet/IP (B-ASC target) |
| IEC 62443-4-1:2018 | SDLC security process |
| IEC 62443-4-2:2019 | Component security (mục tiêu) |
| IEC 61709:2017 | MTBF estimation |
| RoHS 3 / REACH | Material compliance |

---

## 8. Liên hệ

**KINEXUS Technologies JSC**  
Lô I-3, Khu Công nghệ Cao, Quận 9, TP. Hồ Chí Minh

📧 support@KINEXUS-tech.vn  
📞 1900-xxxx (8h–17h, T2–T6)

---

**Document ID:** KX-DDC24-SWDESC-001_VI  
**Revision:** 1.0 | 2026-06-02  
**Related docs:** [SRS_MK-DDC-24_VI](../01_specs/SRS_MK-DDC-24_VI.md) | [DS_MK-DDC-24_VI](../01_specs/DS_MK-DDC-24_VI.md) | [KX-DDC24-USER-001_VI](KX-DDC24-USER-001_VI.md)
