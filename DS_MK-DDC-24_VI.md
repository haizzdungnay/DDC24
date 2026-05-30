# MK-DDC-24 — Data Sheet

> **Bộ điều khiển DDC 24 điểm cho FCU, VAV và AHU nhỏ** — BACnet native, lập trình IEC 61131-3, kiến trúc SOM Debian Linux, phù hợp retrofit và điều khiển tầng phòng.

**Revision:** 2.1 | 2026-05-28 | Bổ sung HMI TFT display

> ⚠ **CẬP NHẬT KIẾN TRÚC KẾT NỐI — 2026-05-30 (ARCH-R010):** Phần kết nối chuẩn đã đổi và **thay thế mọi đề cập cũ về "BACnet MS/TP" và "Modbus TCP/RTU slave" trong tài liệu này.**
> - **Northbound (lên BMS/cloud): chỉ qua IP (Ethernet/WiFi)** — BACnet/IP + MQTT + REST. **Bỏ BACnet MS/TP. Bỏ Modbus slave.**
> - **Southbound (RS-485): Modbus RTU MASTER** — DDC poll thiết bị phụ (module mở rộng I/O, màn hình phụ, thiết bị bên thứ 3).
> Các mục marketing/topology phía dưới còn nhắc MS/TP sẽ được biên tập lại ở Rev 2.2. Nguồn-chuẩn: §3.3 + [OPEN_ISSUES ARCH-R010](spec/OPEN_ISSUES_MK-DDC-24_VI.md).

---

## 1. Tổng quan Sản phẩm

MK-DDC-24 là bộ điều khiển DDC compact 24 điểm được thiết kế cho các ứng dụng HVAC phân tán như FCU, VAV box và AHU nhỏ. Thiết bị chạy trên kiến trúc **SOM Debian Linux quad-core** kết hợp MCU real-time STM32, tích hợp universal input tự nhận dạng loại cảm biến, điều khiển cục bộ theo **IEC 61131-3 (FBD + ST)**. Kết nối BMS/cloud (northbound, qua Ethernet/WiFi): **BACnet/IP, MQTT, REST API**; mở rộng thiết bị phụ (southbound, RS-485): **Modbus RTU master**. Phù hợp cho dự án retrofit hoặc tầng điều khiển phòng máy nhỏ, nơi chi phí đầu tư và không gian tủ điện cần được kiểm soát chặt.

### Ứng dụng Chính

- **FCU (Fan Coil Unit):** Điều khiển quạt 3 cấp, van nước nóng/lạnh, cảm biến nhiệt độ phòng
- **VAV Box:** Điều khiển damper, reheat coil và cảm biến CO₂/nhiệt độ zone
- **AHU nhỏ:** Điều khiển quạt supply/return, damper economizer và bảo vệ coil đóng băng
- **Retrofit Cabinet:** Thay controller cũ mà không thay đổi lớn phần cơ khí tủ điện

### Lợi ích Cạnh tranh

| Tính năng | Lợi thế | Lợi ích Khách hàng |
|-----------|---------|-------------------|
| Universal Input (UI) | 8 kênh tự nhận dạng DI/AI/RTD/NTC | Giảm inventory spare parts, commissioning nhanh hơn |
| BACnet MS/TP native | Không cần gateway | Tiết kiệm 200-300 USD/node, sơ đồ tủ sạch hơn |
| IEC 61131-3 FBD | Lập trình khối chức năng chuẩn quốc tế | Integrator dễ maintain, giảm vendor lock-in |
| DIN-rail compact | 150 × 90 × 55 mm | Phù hợp tủ điện chật, retrofit không phình tủ |

---

## 2. Tính năng Nổi bật

- ✅ **24 điểm I/O tích hợp** — đáp ứng bài toán FCU, VAV và AHU nhỏ trong một bộ điều khiển
- ✅ **8 kênh universal input tự nhận dạng** — NTC, PT100/1000, 0–10V, 4–20mA, dry contact — không cần cấu hình jumper
- ✅ **4 AO + 4 DO Relay** — điều khiển van modulating, damper, quạt và bơm không cần module trung gian
- ✅ **BACnet/IP + MS/TP song song** — tích hợp nhanh với BMS Siemens, Honeywell, Schneider — không cần gateway
- ✅ **Modbus TCP (port 502)** — kết nối SCADA/HMI đơn giản qua Ethernet cùng lúc với BACnet
- ✅ **MQTT v5.0 + REST API HTTPS** — đẩy dữ liệu IoT upstream, tích hợp dashboard và cloud
- ✅ **Soft PLC IEC 61131-3 FBD + ST** — KinexusET Web IDE, không cài phần mềm desktop
- ✅ **Debian Linux trên SOM quad-core** — OTA A/B partition, SSH, web UI, extensible
- ✅ **Màn hình TFT 2.4" local HMI** — ILI9341, 240×320 65K màu, dashboard gauge realtime; 6× nút điều hướng (không cần laptop khi vận hành)
- ✅ **Thiết kế compact DIN-rail 150×90×55 mm** — phù hợp tủ điện chật, retrofit không phình tủ

---

## 3. Thông số Kỹ thuật Đầy đủ

### 3.1 Phần cứng & Xử lý

**Kiến trúc hai tầng (Dual-Layer Architecture):**

| Tầng | Thành phần | Vai trò |
|------|-----------|---------|
| **Application Layer** | SOM Debian Linux | Soft PLC, BACnet stack, web UI, OTA |
| **Real-time I/O Layer** | MCU STM32G0 | Sampling ADC, relay control, hard real-time |
| **Bus nội bộ** | UART 921,600 baud isolated (Kinexus-IOP v1) | Giao tiếp SOM ↔ MCU |

#### 3.1.1 SOM Module (Application Processor)

| Thông số | Giá trị | Ghi chú |
|----------|---------|---------|
| **SOM** | Radxa CM3 (Rockchip RK3566) | Quad-core ARM Cortex-A55 @ 1.8 GHz |
| **CPU cores** | 4 core | ARM Cortex-A55 64-bit |
| **RAM** | 2 GB LPDDR4 | Đủ Debian + tất cả service đồng thời |
| **eMMC** | 8 GB | OS Debian + application + log |
| **microSD** | Slot dự phòng | Recovery image / factory reset |
| **OS** | Debian 12 (Bookworm) | Kernel 6.1 LTS, PREEMPT_RT patch |
| **RTC** | DS3231 external (I²C), battery backup | Lịch vận hành offline ≥ 30 ngày |
| **HMI Display** | TFT 2.4" ILI9341, 240×320, SPI | Dashboard gauge realtime (LVGL v9) |
| **HMI Input** | 6× nút nhấn (UP/DOWN/LEFT/RIGHT/ENTER/ESC) | Điều hướng menu local, không cần laptop |

#### 3.1.2 Real-time I/O MCU

| Thông số | Giá trị | Ghi chú |
|----------|---------|---------|
| **MCU** | STM32G0B1RB | Cortex-M0+, 64 MHz, 144 KB RAM |
| **Firmware** | Bare-metal RTOS (FreeRTOS) | Chu kỳ I/O sampling 1 ms |
| **Flash** | 128 KB | I/O firmware (cập nhật qua SOM) |
| **Giao tiếp SOM** | UART 921,600 baud, ADUM1201 isolated | Protocol nội bộ Kinexus-IOP v1 |

### 3.2 I/O tích hợp (24 điểm)

| Loại I/O | Số kênh | Thông số kỹ thuật |
|----------|:-------:|------------------|
| **Universal Input (UI)** | 8 | 0–10V / 4–20mA / PT100/1000 / NTC 10k/20k, tự nhận dạng |
| **Digital Input (DI)** | 8 | 24V DC, dry contact hoặc wet contact |
| **Analog Output (AO)** | 4 | 0–10V hoặc 4–20mA (cấu hình per kênh), 16-bit DAC |
| **Digital Output (DO)** | 4 | Relay SPDT 5A @ 250VAC, coil 5V DC |

### 3.3 Giao thức & Kết nối

> 🔼 **NORTHBOUND (lên BMS/cloud) — chỉ qua IP (Ethernet/WiFi):**

| Thông số | Giá trị |
|----------|---------|
| **BACnet/IP** | ✅ Native (Ethernet/WiFi, port 47808/UDP) — tích hợp BMS lớn |
| **MQTT** | ✅ v3.1.1 / v5.0 (IoT/cloud upstream, TLS) |
| **REST API** | ✅ HTTPS JSON API, port 8443 (cấu hình và giám sát) |

> 🔽 **SOUTHBOUND (xuống thiết bị phụ) — DDC là MASTER:**

| Thông số | Giá trị |
|----------|---------|
| **Modbus RTU Master** | ✅ DDC = master trên RS-485 (9600–115200 baud), poll **module mở rộng I/O, màn hình phụ, thiết bị bên thứ 3** (đồng hồ điện, biến tần…). Khung mở theo device profile. |

> 🔌 **Cổng vật lý:**

| Thông số | Giá trị |
|----------|---------|
| **Ethernet** | 1× Gigabit RJ-45 (BACnet/IP, MQTT, REST, Web UI) |
| **WiFi** | ✅ 2.4/5 GHz (northbound IP, tuỳ chọn) |
| **RS-485** | 1× port, terminal block, max 1200m @9600 baud — **dành cho Modbus RTU master** |

> ⚠ *Cập nhật 2026-05-30 (ARCH-R010): Đã **bỏ BACnet MS/TP** và **Modbus TCP/RTU slave**. DDC không còn là Modbus slave; RS-485 chỉ làm Modbus RTU master xuống thiết bị phụ. Giao thức northbound cụ thể sẽ chốt sau, nhưng transport là IP.*
| **USB** | 1× USB-A host (debug) + 1× USB-C (serial console, OTA) |
| **Wi-Fi** | Không (dùng external USB Wi-Fi adapter nếu cần) |

### 3.4 Điện & Môi trường

| Thông số | Giá trị |
|----------|---------|
| **Nguồn cấp** | 24 VAC/VDC ±20%, terminal block 2-pin |
| **Tiêu thụ điện** | < 5W điển hình, < 8W max (relay đóng hết) |
| **Nhiệt độ làm việc** | 0°C đến +55°C (đã xác nhận); mục tiêu -20°C đến +65°C (x. HW_SPEC §2.1) |
| **Nhiệt độ bảo quản** | -40°C đến +85°C |
| **Độ ẩm** | 10–90% RH, không ngưng tụ |
| **Cấp bảo vệ** | IP20 (indoor use) |
| **Kích thước** | 150 × 90 × 55 mm (W × H × D) |
| **Trọng lượng** | ~300g |
| **Kiểu lắp** | DIN-rail 35mm hoặc mounting flange |

### 3.5 Chứng nhận & Tuân thủ

| Tiêu chuẩn | Trạng thái |
|------------|-----------|
| **CE** | Dự kiến Q3/Y7 |
| **BACnet BTL** | Testing in progress, expected Q4/Y7 |
| **IEC 61131-3** | Compliant (FBD + ST programming) |
| **IEC 62443-4-1** | SDLC compliant (phát triển phần mềm) |
| **IEC 61709** | MTBF estimation methodology |
| **RoHS 3** | Compliant |
| **REACH** | Compliant |
| **MTBF** | 60.000 giờ @ 40°C (estimated per IEC 61709) |

---

## 4. BACnet Protocol Implementation (PICS Summary)

MK-DDC-24 hỗ trợ các BACnet object types sau:

| Object Type | Số lượng | Read | Write | COV | Ghi chú |
|-------------|:--------:|:----:|:-----:|:---:|---------|
| **Device** | 1 | ✅ | ✅ | — | Device ID, name, description, location |
| **Analog Input (AI)** | 8 | ✅ | — | ✅ | Ánh xạ 1:1 với UI1–UI8 (giá trị đã scale, đúng unit) |
| **Analog Output (AO)** | 4 | ✅ | ✅ | ✅ | Ánh xạ AO1–AO4, commandable |
| **Analog Value (AV)** | 32 | ✅ | ✅ | ✅ | Biến nội bộ soft PLC (setpoint, tính toán…) |
| **Binary Input (BI)** | 8 | ✅ | — | ✅ | Ánh xạ DI1–DI8 |
| **Binary Output (BO)** | 4 | ✅ | ✅ | ✅ | Ánh xạ DO1–DO4 relay, commandable |
| **Binary Value (BV)** | 16 | ✅ | ✅ | ✅ | Biến boolean soft PLC (flag, status…) |
| **Multi-state Value (MSV)** | 8 | ✅ | ✅ | ✅ | Trạng thái enum (vd: mode: Off/Heat/Cool/Auto) |
| **Trend Log** | 8 | ✅ | — | — | 1.000 records/log, interval cấu hình |
| **Schedule** | 8 | ✅ | ✅ | — | Ngày/tuần/exception day |
| **Calendar** | 2 | ✅ | ✅ | — | Holiday / special day list |
| **Notification Class** | 4 | ✅ | ✅ | — | Routing alarm đến BMS |
| **Event Enrollment** | 8 | ✅ | ✅ | — | Định nghĩa điều kiện alarm |

**BACnet/IP:** UDP port 47808, Max APDU 1476 bytes, Segmentation hỗ trợ  
**BACnet MS/TP:** Max APDU 480 bytes, Segmentation không hỗ trợ  
**Who-Is / I-Am / Time-Sync:** Hỗ trợ đầy đủ  

### 4.1 Modbus TCP/RTU Register Map (BẢNG CHUẨN)

> **Đây là register map chuẩn DUY NHẤT** (INT16 scaled ×100, 1 register/điểm — chốt IOP-Q-R009). Modbus TCP và RTU dùng **chung** map này. SRS §6.2 và SW-REQ §10 tham chiếu về đây.

| Vùng | Địa chỉ | Mô tả |
|------|:-------:|-------|
| **Coils (0x)** | 0–3 | DO1–DO4 (read/write) |
| **Discrete Inputs (1x)** | 0–7 | DI1–DI8 (read only) |
| **Input Registers (3x)** | 0–7 | AI1–AI8 (giá trị × 100, INT16) |
| **Input Registers (3x)** | 100–107 | DI1–DI8 (counter 0–65535) |
| **Input Registers (3x)** | 200–209 | System: uptime, fault code, firmware ver |
| **Holding Registers (4x)** | 0–3 | AO1–AO4 (0–10V → 0–10000, 0–20mA → 0–20000) |
| **Holding Registers (4x)** | 100–131 | AV1–AV32 (REAL × 100, INT16) |
| **Holding Registers (4x)** | 200–215 | BV1–BV16 (0=FALSE, 1=TRUE) |


---

## 5. Sơ đồ Kết nối Điển hình

### 5.1 Topology BACnet/IP (khuyến nghị)

```
┌──────────────────────────────────────┐
│  BMS Server (BACnet/IP, UDP/47808)   │
│  Siemens / Honeywell / Schneider...  │
└──────────────┬───────────────────────┘
               │ Ethernet LAN
    ┌──────────┼──────────┬──────────┐
    │          │          │          │
┌───▼───┐ ┌───▼───┐ ┌───▼───┐ ┌───▼───┐
│DDC-24 │ │DDC-24 │ │DDC-24 │ │DDC-24 │
│Zone 1 │ │Zone 2 │ │Zone 3 │ │Zone N │
└───────┘ └───────┘ └───────┘ └───────┘
  (không giới hạn số device trên IP network)
  (cùng Ethernet: MQTT → cloud, Modbus TCP → SCADA)
```

### 5.2 Topology BACnet MS/TP (retrofit, không có Ethernet)

```
┌──────────────────────────────────────┐
│  BMS Server hoặc BACnet IP/MS-TP     │
│  Router (Siemens PXG / Niagara AX)   │
└──────────────┬───────────────────────┘
               │ RS-485 (A/B/GND)
    ┌──────────┼──────────┬──────────┐
    │          │          │          │
┌───▼───┐ ┌───▼───┐ ┌───▼───┐ ┌───▼───┐
│DDC-24 │ │DDC-24 │ │DDC-24 │ │DDC-24 │
│Zone 1 │ │Zone 2 │ │Zone 3 │ │Zone N │
└───────┘ └───────┘ └───────┘ └───────┘
  (max 32 device/segment, term 120Ω ở 2 đầu)
  ⚠ Chế độ này: RS-485 dùng BACnet MS/TP,
    Modbus RTU KHÔNG dùng đồng thời
```

### 5.3 Wiring Example — FCU Điển hình

```
┌─────────────────────────────────────────────────────┐
│                   MK-DDC-24                          │
│                                                      │
│ POWER:                                               │
│   24VAC(+) ─────────────────────► [PWR+]            │
│   24VAC(-) ─────────────────────► [GND]             │
│                                                      │
│ UNIVERSAL INPUTS (UI):                               │
│   UI1 ◄── Room temp sensor    (NTC 10kΩ)            │
│   UI2 ◄── Supply air temp     (PT1000, 2-wire)      │
│   UI3 ◄── Chiller flow switch (dry contact)         │
│   UI4 ◄── Filter DP switch    (dry contact)         │
│   UI5 ◄── Humidity sensor     (4–20mA)              │
│   UI6 ◄── CO₂ sensor          (0–10V, 0–2000ppm)   │
│   UI7 ◄── (spare)                                   │
│   UI8 ◄── (spare)                                   │
│                                                      │
│ ANALOG OUTPUTS (AO):                                 │
│   AO1 ──► Cooling valve actuator  (0–10V)           │
│   AO2 ──► Heating valve actuator  (0–10V)           │
│   AO3 ──► Fan VFD speed reference (0–10V)           │
│   AO4 ──► (spare)                                   │
│                                                      │
│ DIGITAL OUTPUTS (DO — Relay SPDT 5A):               │
│   DO1 ──► Fan Low speed   (relay NO contact)        │
│   DO2 ──► Fan Med speed   (relay NO contact)        │
│   DO3 ──► Fan High speed  (relay NO contact)        │
│   DO4 ──► Alarm beacon    (relay NO contact)        │
│                                                      │
│ DIGITAL INPUTS (DI):                                 │
│   DI1 ◄── Fan run feedback   (24VDC aux contact)    │
│   DI2 ◄── Valve open feedback                       │
│   DI3–8 ◄── (spare)                                 │
│                                                      │
│ COMMUNICATION:                                       │
│   [RS-485 A/B/GND] ──► BACnet MS/TP bus (daisy)    │
│   [RJ-45 Ethernet] ──► LAN switch (BACnet/IP +      │
│                         Modbus TCP + MQTT)           │
│   [USB-C]          ──► Laptop (commissioning,       │
│                         serial console)              │
└─────────────────────────────────────────────────────┘
```

---

## 6. Lập trình & Commissioning

### 6.1 Programming Environment

- **IDE:** KinexusET (web-based, truy cập qua IP Ethernet controller)
- **Ngôn ngữ:** IEC 61131-3 Function Block Diagram (FBD), Structured Text (ST)
- **Soft PLC runtime:** Chạy trên Debian Linux (Userspace), isolated cgroup
- **Real-time:** PREEMPT_RT kernel, jitter < 5 ms cho control loop
- **Function blocks chuẩn:** PID, hysteresis, time delay, counter, averaging, ramp
- **Chu kỳ scan:** 100 ms (default), cấu hình 50 ms – 2 s
- **Backup/Restore:** Export/import qua Web UI hoặc USB-C
- **OTA update:** Firmware SOM + MCU qua MQTT/HTTPS (A/B partition)

### 6.2 Commissioning Workflow

1. **Physical install:** Đấu dây nguồn 24VAC, I/O theo wiring diagram, RS-485 BACnet
2. **Power on:** Controller đọc BACnet Device ID từ DIP switch SW1–SW7 (bootstrap 1–127) nếu chưa có Web UI config; đặt Device ID đầy đủ (1–4.194.302) qua Web UI trong bước commissioning
3. **Network discovery:** BMS server gửi Who-Is, controller responds I-Am
4. **Point mapping:** Truy cập KinexusET IDE → cấu hình UI type (NTC/PT100/0-10V)
5. **Logic programming:** Upload FBD program (PID loop, interlock, schedule)
6. **Functional test:** Verify I/O, alarm, schedule theo checklist
7. **Trend log enable:** Kích hoạt trend cho troubleshooting

### 6.3 Commissioning Deliverables

- ✅ Point list (Excel) — mapping I/O physical → BACnet object
- ✅ Wiring diagram as-built
- ✅ FBD program source code (backup file)
- ✅ BACnet object list (Device ID, AI/AO/BI/BO instance numbers)
- ✅ Alarm matrix — which alarms route to which recipients
- ✅ Checklist FAT/SAT đã ký

---

## 7. Cybersecurity & Reliability

| Tính năng | Trạng thái | Ghi chú |
|-----------|-----------|---------|
| **Firmware signing** | ✅ | GPG-signed package, ngăn flash firmware không chính thức |
| **Secure boot** | ✅ | U-Boot verified boot (SOM), MCU code signing (STM32 RDP) |
| **BACnet/SC** | ⚠️ | BACnet Secure Connect — roadmap Y8 (Q2) |
| **TLS 1.3** | ✅ | Toàn bộ REST API, MQTT, OTA đều dùng TLS 1.3 |
| **SSH hardening** | ✅ | Disable root login, key-only, port non-default |
| **Firewall** | ✅ | nftables on Debian, chỉ mở port cần thiết |
| **IEC 62443-4-1** | ✅ | Quy trình phát triển tuân thủ SDLC theo IEC 62443-4-1 |
| **Watchdog timer** | ✅ | HW watchdog SOM + SW watchdog MCU, auto-reset nếu hang |
| **Failsafe behavior** | ✅ | Output hold last value khi mất BACnet; safe-state sau 30 s |
| **MTBF** | 60.000 h @ 40°C | Ước tính theo IEC 61709 / JESD47 |
| **A/B partition** | ✅ | Rollback tự động nếu boot mới thất bại |

---

## 8. So sánh với Đối thủ

| Tiêu chí | MK-DDC-24 | Schneider SBO | Siemens PXC4 |
|----------|-----------|---------------|--------------|
| **Giá** | 450–550 USD | ~600 USD | ~700 USD |
| **I/O** | 24 (8UI+8DI+4AO+4DO) | 24 | 24 |
| **BACnet** | MS/TP + IP native | MS/TP native | MS/TP + IP (gateway) |
| **UI channels** | 8 (tự nhận dạng) | 6 | 4 |
| **Programming** | IEC 61131-3 FBD + ST | Proprietary | Proprietary |
| **OS** | Debian 12 Linux | Bare-metal | Bare-metal |
| **MQTT / REST API** | ✅ Native | ❌ | ❌ |
| **OTA update** | ✅ A/B partition | Manual | Manual |
| **Local support VN** | ✅ | Limited | Limited |
| **Lead time** | 2–3 tuần | 8–12 tuần | 8–12 tuần |

---

## 9. Mã Đặt hàng & Phụ kiện

| Mã sản phẩm | Mô tả | Giá (USD) |
|-------------|-------|:---------:|
| **MK-DDC-24** | Bộ điều khiển DDC 24 điểm (BACnet MS/TP + IP, SOM Debian) | 450–550 |
| **MK-DDC-24-1G** | Variant RAM 2 GB LPDDR4 bản legacy (giữ tương thích mã đặt hàng cũ) | 500–600 |
| **MK-PWR-24V-30W** | Nguồn DIN-rail 24 VDC/30 W (optional) | 45 |
| **MK-RS485-RPTR** | RS-485 repeater (nếu > 32 devices/segment) | 80 |
| **MK-CABLE-BACNET** | Cáp BACnet MS/TP shielded 2×1.5 mm² (cuộn 100 m) | 120 |
| **MK-SD-RECOVERY** | microSD 8 GB với recovery image pre-loaded | 15 |

### Phụ kiện Khuyên dùng

- **Terminal block spare:** 5 bộ terminal 2-pin, 3-pin (free khi mua ≥ 10 units)
- **USB cable Mini-B:** Cho commissioning (không bao gồm)
- **KinexusET IDE license:** Free (web-based, không cần license key)

---

## 10. Bảo hành & Hỗ trợ

| Chính sách | Nội dung |
|------------|----------|
| **Bảo hành phần cứng** | 2 năm kể từ ngày xuất hàng |
| **Bảo hành phần mềm** | 90 ngày (firmware bug fix free) |
| **DOA replacement** | 7 ngày (dead on arrival, đổi mới 100%) |
| **RMA turnaround** | 5-7 ngày làm việc (repair hoặc replace) |
| **Technical support** | Email/phone 8h-17h T2-T6, response < 4h |
| **Firmware update** | OTA qua HTTPS (A/B partition, rollback tự động); backup qua USB-C |
| **Training** | Workshop commissioning 1 ngày (300 USD/người, min 5 người) |

### Điều kiện Không bảo hành

- Thiệt hại do sét đánh, nguồn điện surge (khuyên dùng surge protector)
- Sửa chữa, can thiệp phần cứng không được ủy quyền
- Vận hành ngoài dải đã xác nhận: nhiệt độ > 55°C (validated operating limit), humidity ngưng tụ, IP rating vi phạm

---

## 11. Liên hệ

**KINEXUS Technologies JSC**  
Lô I-3, Khu Công nghệ Cao, Quận 9, TP. Hồ Chí Minh, Việt Nam

📧 **Email:** sales@KINEXUS-tech.vn  
📞 **Hotline:** 1900-xxxx (8h-17h, T2-T6)  
🌐 **Website:** www.KINEXUS-tech.vn  
💬 **Zalo/WhatsApp:** +84-xxx-xxx-xxx

**Technical support:** support@KINEXUS-tech.vn  
**RMA request:** rma@KINEXUS-tech.vn

---

**Document ID:** DS-MK-DDC-24-VI  
**Revision:** 2.1 | 2026-05-28  
**Supersedes:** Rev 1.1 (2026-04-14)  
**Approved by:** CTO KINEXUS Technologies  
**Related docs:** [PRD-MK-DDC-24-VI](PRD_MK-DDC-24_VI.md) | [SRS-MK-DDC-24-VI](SRS_MK-DDC-24_VI.md) | [HW-SPEC-MK-DDC-24-VI](HW_SPEC_MK-DDC-24_VI.md)

---

*Thông số kỹ thuật có thể thay đổi mà không cần thông báo trước. Vui lòng liên hệ sales để xác nhận specs mới nhất trước khi đặt hàng.*
