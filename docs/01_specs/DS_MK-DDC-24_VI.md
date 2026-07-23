# MK-DDC-24 — Data Sheet

> **Bộ điều khiển DDC 24 điểm cho FCU, VAV và AHU nhỏ** — BACnet native, **cấu hình component-based (graph.json)**, kiến trúc SOM Debian Linux, phù hợp retrofit và điều khiển tầng phòng.
>
> ⚠️ **RECONCILE (2026-07-23, ADR-018 supersedes ADR-004 cho câu hỏi ngôn ngữ):** mô hình
> đang **chạy thật hôm nay** là component-based graph (28 node, `graph.json`). Roadmap
> Rev A.0 đã quyết định (2026-07-23) bổ sung một **Program Runtime do Mekong sở hữu**,
> IEC 61131-3-aligned, scope **ST + FBD** — nhưng runtime này **đang trong giai đoạn C0
> (architecture/feasibility), chưa có code, chưa release, không được gọi "Compliant" hay
> "Certified"**. Toàn bộ mô tả "Soft PLC IEC 61131-3" trong tài liệu này (mục 3.5, 6.1, 8)
> là target roadmap, không phải capability đang bán. Nguồn-chuẩn:
> [ADR-018](../adr/ADR-018-mekong-owned-iec-aligned-program-runtime.md),
> [PROGRAM_SOM_FW_DRAFT_DESIGN](../02_design/PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md),
> [PRODUCT_DEFINITION](PRODUCT_DEFINITION_MK-DDC-24_VI.md).

**Revision:** 3.1 | 2026-07-22 | Local limited-operator HMI alignment to ADR-016

> ⚠ **CẬP NHẬT KIẾN TRÚC KẾT NỐI — 2026-05-30 (ARCH-R010):** Phần kết nối chuẩn đã đổi và **thay thế mọi đề cập cũ về "BACnet MS/TP" và "Modbus TCP/RTU slave" trong tài liệu này.**
> - **Northbound (lên BMS/cloud): chỉ qua IP (Ethernet/WiFi)** — BACnet/IP + MQTT + REST. **Bỏ BACnet MS/TP. Bỏ Modbus slave.**
> - **Southbound (RS-485): Modbus RTU MASTER** — DDC poll thiết bị phụ (module mở rộng I/O, màn hình phụ, thiết bị bên thứ 3).
> Các mục marketing/topology phía dưới còn nhắc MS/TP sẽ được biên tập lại ở Rev 2.2. Nguồn-chuẩn: §3.3 + [OPEN_ISSUES ARCH-R010](OPEN_ISSUES_MK-DDC-24_VI.md).

> **ADR-010 baseline (2026-06-25):** base SKU = **16 UI + 4 AO + 4 DO**, không có DI công nghiệp riêng; IOP v2 poll 2ms/500Hz. Dry-contact UI chỉ là auxiliary non-isolated input.

---

## 1. Tổng quan Sản phẩm

MK-DDC-24 là bộ điều khiển DDC compact 24 điểm được thiết kế cho các ứng dụng HVAC phân tán như FCU, VAV box và AHU nhỏ. Thiết bị chạy trên kiến trúc **SOM Debian Linux quad-core** kết hợp MCU real-time STM32, tích hợp universal input tự nhận dạng loại cảm biến, điều khiển cục bộ bằng component-based runtime hiện hành; roadmap Rev A.0 (ADR-018, đang C0) bổ sung **Mekong Program Runtime IEC 61131-3-aligned (ST + FBD)**, chưa release. Kết nối BMS/cloud (northbound, qua Ethernet/WiFi): **BACnet/IP, MQTT, REST API**; mở rộng thiết bị phụ (southbound, RS-485): **Modbus RTU master**. Phù hợp cho dự án retrofit hoặc tầng điều khiển phòng máy nhỏ, nơi chi phí đầu tư và không gian tủ điện cần được kiểm soát chặt.

### Ứng dụng Chính

- **FCU (Fan Coil Unit):** Điều khiển quạt 3 cấp, van nước nóng/lạnh, cảm biến nhiệt độ phòng
- **VAV Box:** Điều khiển damper, reheat coil và cảm biến CO₂/nhiệt độ zone
- **AHU nhỏ:** Điều khiển quạt supply/return, damper economizer và bảo vệ coil đóng băng
- **Retrofit Cabinet:** Thay controller cũ mà không thay đổi lớn phần cơ khí tủ điện

### Lợi ích Cạnh tranh

| Tính năng | Lợi thế | Lợi ích Khách hàng |
|-----------|---------|-------------------|
| Universal Input (UI) | 16 kênh cấu hình độc lập 0–10V / 4–20mA / NTC / auxiliary dry contact | Giảm inventory spare parts, commissioning nhanh hơn |
| BACnet native | Không cần gateway | Tiết kiệm 200-300 USD/node, sơ đồ tủ sạch hơn |
| IEC 61131-3-aligned FBD *(roadmap Rev A.0, đang C0, chưa release)* | Lập trình khối chức năng chuẩn quốc tế, Mekong-owned runtime | Integrator dễ maintain, giảm vendor lock-in |
| DIN-rail compact | 150 × 90 × 55 mm | Phù hợp tủ điện chật, retrofit không phình tủ |

---

## 2. Tính năng Nổi bật

- ✅ **24 điểm I/O tích hợp** — đáp ứng bài toán FCU, VAV và AHU nhỏ trong một bộ điều khiển
- ✅ **16 kênh universal input cấu hình độc lập** — NTC, 0–10V, 4–20mA, auxiliary dry contact; PT100/PT1000 không thuộc Rev A
- ✅ **4 AO + 4 DO Relay** — điều khiển van modulating, damper, quạt và bơm không cần module trung gian
- ✅ **BACnet/IP** — tích hợp nhanh với BMS Siemens, Honeywell, Schneider — không cần gateway
- ✅ **MQTT v5.0 + REST API HTTPS** — đẩy dữ liệu IoT upstream, tích hợp dashboard và cloud
- 🔜 **Program Runtime IEC 61131-3-aligned FBD + ST** *(roadmap Rev A.0, ADR-018, đang C0 — chưa release, không certified/compliant)* — Web IDE, không cài phần mềm desktop
- ✅ **Debian Linux trên SOM quad-core** — OTA A/B partition, SSH, web UI, extensible
- ✅ **Màn hình TFT 2.4" limited-operator HMI** — JD9852 MIPI DSI, 240×320; CTP + 6× nút; setpoint/mode/override/release chỉ cho point được authority whitelist
- ✅ **Thiết kế compact DIN-rail 150×90×55 mm** — phù hợp tủ điện chật, retrofit không phình tủ

---

## 3. Thông số Kỹ thuật Đầy đủ

### 3.1 Phần cứng & Xử lý

**Kiến trúc hai tầng (Dual-Layer Architecture):**

| Tầng | Thành phần | Vai trò |
|------|-----------|---------|
| **Application Layer** | SOM Debian Linux | Soft PLC, BACnet stack, web UI, OTA |
| **Real-time I/O Layer** | MCU STM32G0 | Sampling ADC, relay control, hard real-time |
| **Bus nội bộ** | UART 921,600 baud (Kinexus-IOP v2, ADR-010) | SOM poll 2ms/500Hz; IO_RESP 74 byte |

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
| **HMI Display** | TFT 2.4" JD9852, 240×320, MIPI DSI | LVGL v9 via DRM/KMS |
| **HMI Input** | FT5436 capacitive touch + 6× nút (UP/DOWN/LEFT/RIGHT/ENTER/ESC) | Home/Points/Control/Alarms/Service; không phải full Web HMI/SCADA |

#### 3.1.2 Real-time I/O MCU

| Thông số | Giá trị | Ghi chú |
|----------|---------|---------|
| **MCU** | STM32G0B1RB | Cortex-M0+, 64 MHz, 144 KB RAM |
| **Firmware** | Bare-metal RTOS (FreeRTOS) | Chu kỳ I/O sampling 1 ms |
| **Flash** | 128 KB | I/O firmware (cập nhật qua SOM) |
| **Giao tiếp SOM** | UART 921,600 baud | Kinexus-IOP v2, 2ms poll/response |

### 3.2 I/O tích hợp (24 điểm)

| Loại I/O | Số kênh | Thông số kỹ thuật |
|----------|:-------:|------------------|
| **Universal Input (UI)** | 16 | 0–10V / 4–20mA / NTC / auxiliary dry contact, per-channel mode |
| **Digital Input (DI)** | 0 base SKU | Optional isolated-DI module/SKU only; capability-gated |
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
| **IEC 61131-3** | Not certified/compliant — Mekong-owned Program Runtime, IEC 61131-3-aligned architecture (ST + FBD), theo ADR-018. Cấm dùng "Compliant"/"Certified" cho tới khi có gate G0–G6 đóng (`PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md` §14). |
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
| **Analog Input (AI)** | 16 | ✅ | — | ✅ | Ánh xạ 1:1 với UI1–UI16 (giá trị đã scale, đúng unit) |
| **Analog Output (AO)** | 4 | ✅ | ✅ | ✅ | Ánh xạ AO1–AO4, commandable |
| **Analog Value (AV)** | 32 | ✅ | ✅ | ✅ | Biến nội bộ soft PLC (setpoint, tính toán…) |
| **Binary Input (BI)** | 0 base / 8 optional | ✅ | — | ✅ | Chỉ tạo cho optional isolated-DI SKU khi capability map xác nhận |
| **Binary Output (BO)** | 4 | ✅ | ✅ | ✅ | Ánh xạ DO1–DO4 relay, commandable |
| **Binary Value (BV)** | 16 | ✅ | ✅ | ✅ | Biến boolean soft PLC (flag, status…) |
| **Multi-state Value (MSV)** | 8 | ✅ | ✅ | ✅ | Trạng thái enum (vd: mode: Off/Heat/Cool/Auto) |
| **Trend Log** | 8 | ✅ | — | — | 1.000 records/log, interval cấu hình |
| **Schedule** | 8 | ✅ | ✅ | — | Ngày/tuần/exception day |
| **Calendar** | 2 | ✅ | ✅ | — | Holiday / special day list |
| **Notification Class** | 4 | ✅ | ✅ | — | Routing alarm đến BMS |
| **Event Enrollment** | 8 | ✅ | ✅ | — | Định nghĩa điều kiện alarm |

**BACnet/IP:** UDP port 47808, Max APDU 1476 bytes, Segmentation hỗ trợ
**Who-Is / I-Am / Time-Sync:** Hỗ trợ đầy đủ

### 4.1 Modbus field role

Rev A is a Modbus RTU/TCP **master/client**. It does not expose the local I/O image as a
Modbus slave register map. Device-specific downstream register maps are supplied by field
device profiles; the previous local-slave table is superseded by ARCH-R010.


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
  (cùng Ethernet: MQTT → cloud)
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
│   UI2 ◄── Supply air temp     (NTC profile)         │
│   UI3 ◄── Chiller flow switch (aux dry contact)     │
│   UI4 ◄── Filter DP switch    (dry contact)         │
│   UI5 ◄── Humidity sensor     (4–20mA)              │
│   UI6 ◄── CO₂ sensor          (0–10V, 0–2000ppm)   │
│   UI7–UI16 ◄── Additional analog/NTC/aux dry inputs │
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
│ OPTIONAL ISOLATED DI MODULE: not populated base SKU │
│                                                      │
│ COMMUNICATION:                                       │
│   [RS-485 A/B/GND] ──► Modbus RTU bus (daisy)         │
│   [RJ-45 Ethernet] ──► LAN switch (BACnet/IP +         │
│                         MQTT)           │
│   [USB-C]          ──► Laptop (commissioning,       │
│                         serial console)              │
└─────────────────────────────────────────────────────┘
```

---

## 6. Lập trình & Commissioning

> ⚠️ **Roadmap, chưa release (2026-07-23):** toàn bộ mục 6.1 mô tả Program Runtime
> IEC 61131-3-aligned (ADR-018) đang ở giai đoạn C0 (architecture/feasibility) — **chưa
> có code, chưa build, chưa test, không certified/compliant**. Commissioning thật hôm
> nay dùng component-based graph (`graph.json`, 28 node) qua trang Web `Programming`,
> hiện ở trạng thái demo/chưa deploy thật (xem
> `KX-DDC24-IEC61131-PROGRAM-SOMFW-GAP-2026-07-22.md`). Không dùng mục 6 này làm căn cứ
> chào bán năng lực hiện có.

### 6.1 Programming Environment *(roadmap Rev A.0 — chưa release)*

- **IDE:** Web IDE Mekong Program Runtime (roadmap; tên "KinexusET" chưa xác nhận chính thức)
- **Ngôn ngữ:** IEC 61131-3-aligned Function Block Diagram (FBD), Structured Text (ST) — LD/SFC hoãn
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
4. **Point mapping:** Truy cập web commissioning → cấu hình UI type (NTC/0-10V/4-20mA/aux dry contact)
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
| **I/O** | 24 (16 UI + 4 AO + 4 DO) | 24 | 24 |
| **BACnet** | BACnet/IP native | BACnet native | BACnet (gateway) |
| **UI channels** | 16 (cấu hình mode độc lập) | 6 | 4 |
| **Programming** | Component-based (nay); IEC 61131-3-aligned FBD+ST roadmap Rev A.0, chưa release | Proprietary | Proprietary |
| **OS** | Debian 12 Linux | Bare-metal | Bare-metal |
| **MQTT / REST API** | ✅ Native | ❌ | ❌ |
| **OTA update** | ✅ A/B partition | Manual | Manual |
| **Local support VN** | ✅ | Limited | Limited |
| **Lead time** | 2–3 tuần | 8–12 tuần | 8–12 tuần |

---

## 9. Mã Đặt hàng & Phụ kiện

| Mã sản phẩm | Mô tả | Giá (USD) |
|-------------|-------|:---------:|
| **MK-DDC-24** | Bộ điều khiển DDC 24 điểm (BACnet/IP, SOM Debian) | 450–550 |
| **MK-DDC-24-1G** | Variant RAM 2 GB LPDDR4 bản legacy (giữ tương thích mã đặt hàng cũ) | 500–600 |
| **MK-PWR-24V-30W** | Nguồn DIN-rail 24 VDC/30 W (optional) | 45 |
| **MK-RS485-RPTR** | RS-485 repeater (nếu > 32 devices/segment) | 80 |
| **MK-CABLE-BACNET** | Cáp RS-485 shielded 2×1.5 mm² (cuộn 100 m) | 120 |
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
- Vận hành ngoài dải được ghi trên nhãn/release certificate cuối cùng; hiện chưa có chamber evidence để gọi 55°C là validated operating limit

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
**Revision:** 3.1 | 2026-07-22
**Supersedes:** Rev 3.0 (2026-06-30)
**Status:** In-Review — engineering evidence gates remain open
**Related docs:** [PRD-MK-DDC-24-VI](PRD_MK-DDC-24_VI.md) | [SRS-MK-DDC-24-VI](SRS_MK-DDC-24_VI.md) | [HW-SPEC-MK-DDC-24-VI](HW_SPEC_MK-DDC-24_VI.md)

---

*Thông số kỹ thuật có thể thay đổi mà không cần thông báo trước. Vui lòng liên hệ sales để xác nhận specs mới nhất trước khi đặt hàng.*
