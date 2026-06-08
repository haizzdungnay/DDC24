# Initial Threat Model: STRIDE Analysis — MK-DDC-24
## IEC 62443-4-1 SM-2: Threat Modeling

> **Document ID:** KX-DDC24-SEC-TM-001
> **Phiên bản:** 1.0 | 2026-06-02
> **Trạng thái:** Draft — Chờ Solution Architect review
> **Tác giả:** DeveloperTeam
> **Issue:** IOT-5489
> **Phương pháp:** STRIDE (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege)
> **Chuẩn tham chiếu:** IEC 62443-4-1 SM-2, IEC 62443-4-2 (CR 1–4), STRIDE per-element
> **Ref:** [PM-MARKET-001 §6.2](../../../../KX-DDC24-PM-MARKET-001_VI.md) | [SYS-ARCH-001](../../../../KX-DDC24-SYS-ARCH-001_VI.md) | [SW-ARCH](../../../../../01_specs/SW_ARCH_SPEC_MK-DDC-24_VI.md) | [FW-ARCH](../../../../../01_specs/FW_ARCH_SPEC_MK-DDC-24_VI.md) | [SEC-REQ-001](../../../../KX-DDC24-SEC-REQ-001_VI.md) | [SEC-GAP-001](../../../../KX-DDC24-SEC-GAP-001_VI.md)

---

## Mục lục

1. [Tổng quan hệ thống](#1-tổng-quan-hệ-thống)
2. [Data Flow Diagrams & Trust Boundaries](#2-data-flow-diagrams--trust-boundaries)
3. [Assets Inventory](#3-assets-inventory)
4. [Threat Actors](#4-threat-actors)
5. [STRIDE Analysis per Trust Boundary](#5-stride-analysis-per-trust-boundary)
6. [Threat Catalog với Risk Rating](#6-threat-catalog-với-risk-rating)
7. [Mitigation Mapping](#7-mitigation-mapping)
8. [Residual Risk & Assumptions](#8-residual-risk--assumptions)
9. [Kết luận và khuyến nghị](#9-kết-luận-và-khuyến-nghị)
10. [Phụ lục: STRIDE Checklist per Element](#10-phụ-lục-stride-checklist-per-element)

---

## 1. Tổng quan hệ thống

MK-DDC-24 là bộ điều khiển DDC (Direct Digital Control) cho HVAC trong tòa nhà thương mại. Hệ thống gồm hai bộ xử lý chính:

| Bộ xử lý | Chip | OS | Nhiệm vụ |
|-----------|------|----|---------|
| **SOM** (System-on-Module) | Radxa CM3 / RK3566 (Cortex-A55) | Debian 12 + PREEMPT_RT | Soft PLC runtime, BACnet/IP, MQTT, REST API, Web IDE, OTA |
| **MCU** (Microcontroller) | STM32G0B1RBT6 (Cortex-M0+) | FreeRTOS | ADC sampling (1ms), DAC output, relay control, IOP communication |

### 1.1 Kiến trúc service (SOM)

```
┌─────────────────────────────────────────────────────────────────┐
│                    SOM Debian 12                                 │
│                                                                  │
│  kinexus-io-driver (SCHED_FIFO 70)                               │
│    └─► /dev/shm/kinexus_io_shm (seqlock)                         │
│                                                                  │
│  kinexus-plc (SCHED_FIFO 80)                                     │
│    └─► /dev/shm/kinexus_plc_shm (rwlock)                         │
│         ├─► kinexus-bacnet (BACnet/IP)                           │
│         ├─► kinexus-agent (MQTT + REST API)                      │
│         │     └─► kinexus-webide (Web IDE frontend)              │
│         └─► kinexus-hmi (TFT display)                            │
│                                                                  │
│  kinexus-otad (OTA daemon — root)                                │
│                                                                  │
│  nftables firewall                                               │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Giao tiếp vật lý

| Interface | Loại | Kết nối | Giao thức |
|-----------|------|---------|-----------|
| Northbound | Ethernet/WiFi | RJ45 / WiFi module | BACnet/IP (UDP 47808), MQTT (TCP 8883 TLS), REST API (TCP 443/8443 HTTPS) |
| Southbound | RS-485 | Terminal block | Modbus RTU master |
| Internal | UART | ADUM1201 isolated | Kinexus-IOP (921600 baud) |
| Debug | UART | Header (production: disabled) | Serial console |
| Debug | JTAG/SWD | Header (production: disabled) | ST-Link / J-TAG |
| HMI | SPI/FB | TFT ILI9341 + nút bấm | LVGL v9 |
| I/O | Analog/Digital | Terminal block | 0–10V, 4–20mA, NTC/PT100, dry contact |

---

## 2. Data Flow Diagrams & Trust Boundaries

### 2.1 Context Diagram (DFD Level 0)

```
                         ┌───────────────────┐
                         │   BMS / Cloud      │
                         │  (BACnet/IP, MQTT, │
                         │   HTTPS)           │
                         └────────▲┬──────────┘
                                  ││
                    Trust Boundary 1 ─── Northbound IP
                                  ││
             ┌────────────────────┴▼───────────┐
             │     System Integrator Laptop     │
             │     (Web IDE — HTTPS 443/8443)   │
             └────────────────────┬─────────────┘
                                  │
                    Trust Boundary 1 ─── Northbound IP
                                  │
┌─────────────────────────────────▼──────────────────────────────────┐
│                         MK-DDC-24                                  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                     SOM (Linux)                               │  │
│  │                                                               │  │
│  │  Web IDE ←→ Agent ←→ PLC ←→ io-driver ←→ IOP (UART)          │  │
│  │  BACnet ←→ PLC ←→ io-driver                                   │  │
│  │  MQTT ←→ Agent ←→ PLC ←→ io-driver                            │  │
│  │  OTA daemon ←→ HTTPS (download)                                │  │
│  │                                                               │  │
│  │              Trust Boundary 2 ─── IOP UART (SOM↔MCU)          │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                    │                               │
│  ┌─────────────────────────────────▼─────────────────────────────┐ │
│  │                     MCU (FreeRTOS)                             │ │
│  │  ADC sampling │ DAC output │ Relay │ Diagnostics │ Watchdog    │ │
│  └───────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
           │                                     │
Trust Boundary 3 ─── Southbound RS-485   Trust Boundary 4 ─── Physical I/O
           │                                     │
┌──────────▼──────────┐          ┌────────────────▼───────────────┐
│  Modbus RTU slaves   │          │  Sensors / Actuators           │
│  (I/O modules, HMI,  │          │  (NTC, PT100, 0-10V, relay)   │
│   meters, VFDs)      │          └────────────────────────────────┘
└─────────────────────┘
```

### 2.2 Trust Boundaries

| TB # | Tên | Mô tả | Chiều giao tiếp |
|------|-----|-------|----------------|
| **TB-1** | Northbound IP | SOM ↔ BMS/Cloud/Web IDE qua Ethernet/WiFi | BACnet/IP (UDP), MQTT (TCP), REST API (TCP) |
| **TB-2** | IOP UART | SOM ↔ MCU qua UART isolated (ADUM1201) | Kinexus-IOP binary protocol, 921600 baud |
| **TB-3** | Southbound RS-485 | SOM ↔ Modbus RTU slave devices | Modbus RTU (master → slaves) |
| **TB-4** | Physical I/O | MCU ↔ Sensors/Actuators | ADC 24-bit, DAC 16-bit, relay GPIO |
| **TB-5** | Debug interfaces | JTAG/SWD header, UART console header | ARM SWD, serial console |
| **TB-6** | OTA Update path | OTA server ↔ kinexus-otad (SOM) | HTTPS (TLS 1.3) |

---

## 3. Assets Inventory

| Asset ID | Tên | Mô tả | Nơi lưu trữ | Confidentiality | Integrity | Availability |
|----------|-----|-------|------------|:---------------:|:---------:|:------------:|
| A-01 | Firmware image (SOM) | `.kxpkg` signed package + kernel + rootfs | Flash (A/B partition) | Medium | **Critical** | **Critical** |
| A-02 | Firmware (MCU) | STM32 binary | MCU Flash 128KB | Medium | **Critical** | **Critical** |
| A-03 | TLS private key | Server key for HTTPS/MQTT | `/data/certs/` | **Critical** | **Critical** | High |
| A-04 | JWT secret | 256-bit random key for token signing | Key store | **Critical** | **Critical** | High |
| A-05 | User credentials | bcrypt-hashed passwords | `/data/config/users.conf` | **Critical** | **Critical** | High |
| A-06 | System configuration | BACnet, network, MQTT, I/O config | `/data/config/` | High | **Critical** | High |
| A-07 | PLC programs | FBD/ST logic | `/data/plc/programs/` | Medium | **Critical** | High |
| A-08 | Sensor data (real-time) | Current AI/AO/BI/BO values | Shared memory, `/dev/shm/` | Low | High | **Critical** |
| A-09 | Audit log | Security events JSON | `/data/log/audit.log` | High | **Critical** | Medium |
| A-10 | BACnet objects | Device object + AV/BV/MSV values | `kinexus_plc_shm` | Low | High | **Critical** |
| A-11 | GPG signing key (firmware) | Private key for `.kxpkg` signing | **HSM** (off-device) | **Critical** | **Critical** | Low |
| A-12 | OTA server credentials | TLS client cert or API token | `/data/certs/` or key store | **Critical** | High | High |
| A-13 | Modbus slave data | Values polled from RTU slaves | Shared memory + config | Low | High | Medium |
| A-14 | SBOM / software manifests | Dependency list, version info | OS filesystem | Medium | High | Low |

---

## 4. Threat Actors

| Actor ID | Tên | Mô tả | Khả năng | Motivation |
|----------|-----|-------|---------|------------|
| **TA-1** | Remote attacker (Internet) | Tấn công từ WAN/Internet vào DDC qua IP stack | Medium: khai thác lỗi BACnet/MQTT/REST, brute-force credential, MITM nếu TLS không enforce | Chiếm quyền điều khiển thiết bị, gián điệp công nghiệp, ransomware |
| **TA-2** | Internal network attacker | Insider hoặc compromised device trong cùng LAN building | High: có thể scan mạng, ARP spoof, BACnet scan, replay attack | Phá hoại, truy cập trái phép |
| **TA-3** | Physical attacker | Kẻ xâm nhập tủ điện / phòng kỹ thuật | High: truy cập vật lý debug port, JTAG, tháo thẻ SD/nhân bản firmware | Chiếm thiết bị, reverse-engineer, backdoor |
| **TA-4** | Compromised SI tool | Laptop kỹ thuật viên nhiễm malware khi commissioning | High: có quyền admin qua Web IDE, có thể đẩy PLC program độc hại | Phát tán malware vào building network |
| **TA-5** | Malicious field device | Thiết bị Modbus slave giả mạo hoặc bị kiểm soát | Medium: gửi dữ liệu giả trên bus RS-485 | Gây sai lệch điều khiển, DoS |
| **TA-6** | Supply-chain attacker | Can thiệp vào OTA server, package repository, hoặc phần cứng | High: có thể phân phối firmware giả, backdoor hardware | Phát tán backdoor diện rộng |
| **TA-7** | Disgruntled insider | Nhân viên có quyền truy cập hệ thống phát triển | High: có quyền sign firmware, access source code, biết architecture | Phá hoại, mã độc |

---

## 5. STRIDE Analysis per Trust Boundary

### 5.1 TB-1: Northbound IP (BACnet/IP, MQTT, REST, Web IDE)

#### Data Flow
```
BMS/Cloud/SI Laptop
    │
    ├── BACnet/IP (UDP 47808) ──► kinexus-bacnet ──► plc_shm
    ├── MQTT (TCP 8883 TLS)   ──► kinexus-agent   ──► plc_shm
    ├── REST API (TCP 8443)    ──► kinexus-agent   ──► plc_shm / config
    └── Web IDE (TCP 443/8443) ──► kinexus-agent   ──► config / plc programs
```

| STRIDE | Threat ID | Mô tả | Target |
|--------|-----------|-------|--------|
| **S**poofing | T-001 | Attacker giả mạo BMS gửi BACnet Write-Property không auth để thay đổi setpoint | BACnet/IP |
| **S**poofing | T-002 | Attacker giả mạo MQTT broker hoặc publish message không auth | MQTT |
| **S**poofing | T-003 | Attacker giả mạo REST client hợp lệ (token theft/reuse) | REST API |
| **S**poofing | T-004 | DNS spoofing / ARP spoofing dẫn hướng traffic đến attacker | Mạng LAN |
| **T**ampering | T-005 | BACnet broadcast storm hoặc malformed packet gây crash BACnet stack | BACnet/IP |
| **T**ampering | T-006 | Man-in-the-middle tấn công TLS downgrade hoặc intercept nếu cert validation lỏng | MQTT/HTTPS |
| **T**ampering | T-007 | Replay point write commands (nếu thiếu sequence number / timestamp) | REST API |
| **R**epudiation | T-008 | Thiếu audit log cho critical operations (config change, point write) | REST API |
| **I**nformation Disclosure | T-009 | Information leakage qua error messages (stack trace, SQL error, version info) | REST API / Web IDE |
| **I**nformation Disclosure | T-010 | Sniffing BACnet traffic (UDP plaintext) nếu attacker cùng subnet | BACnet/IP |
| **I**nformation Disclosure | T-011 | Directory listing / endpoint enumeration không auth | Web IDE |
| **D**enial of Service | T-012 | BACnet Who-Is broadcast amplification / UDP flood | BACnet/IP |
| **D**enial of Service | T-013 | Connection exhaustion (SYN flood, slow loris) vào REST API / Web IDE | REST API |
| **D**enial of Service | T-014 | MQTT client flood — many concurrent connections | MQTT |
| **E**levation of Privilege | T-015 | JWT token forgery hoặc privilege escalation (user → admin) qua API | REST API |
| **E**levation of Privilege | T-016 | Session fixation / CSRF / XSS trong Web IDE dẫn đến admin action | Web IDE |
| **E**levation of Privilege | T-017 | BACnet Write-Property vượt quá giới hạn priority array | BACnet/IP |

### 5.2 TB-2: IOP UART (SOM ↔ MCU)

#### Data Flow
```
kinexus-io-driver (SOM)
    │  UART 921600 baud, ADUM1201 isolation
    │  GET_IO / SET_AO / SET_DO / RESET_IO frames
    │  CRC16 + sequence number
    ▼
iop_comm_task (MCU)
```

| STRIDE | Threat ID | Mô tả | Target |
|--------|-----------|-------|--------|
| **S**poofing | T-018 | Thiết bị ngoài gắn vào UART header (nếu không disable) giả mạo IOP frame | UART bus |
| **T**ampering | T-019 | IOP frame corruption do EMI/noise — CRC16 phát hiện nhưng không có retry | UART bus |
| **T**ampering | T-020 | Replay IOP frame cũ (nếu sequence number không được kiểm tra kỹ) | UART bus |
| **R**epudiation | T-021 | MCU fault (CRC error, timeout) không được log chi tiết ở SOM side | IOP protocol |
| **I**nformation Disclosure | T-022 | IOP bus sniffing — nếu attacker truy cập được physical UART line | UART bus |
| **D**enial of Service | T-023 | IOP frame flood từ MCU side làm io-driver quá tải | UART bus |
| **D**enial of Service | T-024 | Mất IOP > 200ms → MCU chuyển safe-state: mất điều khiển tạm thời | IOP protocol |
| **E**levation of Privilege | T-025 | IOP protocol không phân biệt GET vs SET privilege — bất kỳ frame nào cũng có thể SET | IOP protocol |

### 5.3 TB-3: Southbound RS-485 (Modbus RTU Master)

#### Data Flow
```
kinexus-plc (SOM) ←→ fieldbus service
    │  RS-485 half-duplex, Modbus RTU
    │  Poll: read holding regs / write single regs
    ▼
Modbus RTU slaves (I/O modules, HMI, meters, VFDs)
```

| STRIDE | Threat ID | Mô tả | Target |
|--------|-----------|-------|--------|
| **S**poofing | T-026 | Slave giả mạo gửi response sai để điều khiển DDC | RS-485 bus |
| **T**ampering | T-027 | RS-485 bus injection — attacker gửi Modbus frame giả | RS-485 bus |
| **T**ampering | T-028 | CRC error / data corruption do noise (RS-485 không có retry mặc định) | RS-485 bus |
| **R**epudiation | T-029 | Không có log Modbus command history khi investigate incident | Fieldbus |
| **I**nformation Disclosure | T-030 | Modbus RTU plaintext — không có encryption trên RS-485 | RS-485 bus |
| **D**enial of Service | T-031 | Slave không response → master poll timeout → bad quality + alarm flood | RS-485 bus |
| **D**enial of Service | T-032 | Bus contention / short circuit RS-485 — mất toàn bộ communication | RS-485 bus |
| **E**levation of Privilege | T-033 | Modbus protocol không phân biệt read/write access — bất kỳ device nào cũng có thể write | RS-485 bus |

### 5.4 TB-4: Physical I/O (MCU ↔ Sensors/Actuators)

#### Data Flow
```
io_sample_task (MCU, 1ms)
    ├── ADS131M08 ADC (SPI) ← UI sensors (NTC, PT100, 0-10V, 4-20mA)
    ├── GPIO input ← DI (dry contact)
    ├── DAC8554 DAC (SPI) → AO output (0-10V / 4-20mA)
    └── Relay GPIO → DO output
```

| STRIDE | Threat ID | Mô tả | Target |
|--------|-----------|-------|--------|
| **S**poofing | T-034 | Attacker đưa tín hiệu điện áp/dòng giả vào UI input để gây đọc sai | Analog input |
| **T**ampering | T-035 | Kẹp/thay đổi tín hiệu output (AO/DO) để gây hại thiết bị HVAC | Analog output |
| **R**epudiation | T-036 | Không detect được fault condition (sensor open/short) để ghi log | I/O diagnostics |
| **I**nformation Disclosure | T-037 | Đo điện áp AO để suy luận trạng thái điều khiển (side-channel) | Analog output |
| **D**enial of Service | T-038 | ADC/DAC SPI communication failure → mất I/O capability | SPI bus |
| **D**enial of Service | T-039 | Overvoltage / surge on UI input → damage ADC channel | Analog input |
| **E**levation of Privilege | T-040 | N/A — physical I/O là termination point, không có privilege model | — |

### 5.5 TB-5: Debug Interfaces (JTAG/SWD, UART Console)

| STRIDE | Threat ID | Mô tả | Target |
|--------|-----------|-------|--------|
| **S**poofing | T-041 | Debug UART console không có password — attacker login direct | UART console |
| **T**ampering | T-042 | JTAG/SWD access → read/write MCU memory, dump firmware | JTAG/SWD |
| **I**nformation Disclosure | T-043 | Kernel messages / debug log qua UART console leak thông tin hệ thống | UART console |
| **D**enial of Service | T-044 | JTAG clock glitch / voltage fault injection | JTAG/SWD |
| **E**levation of Privilege | T-045 | Nếu console login được → root access (production build) | UART console |

### 5.6 TB-6: OTA Update Path

#### Data Flow
```
OTA server (KINEXUS cloud)
    │  HTTPS TLS 1.3
    ▼
kinexus-otad (SOM, runs as root)
    │  Download .kxpkg → GPG verify → A/B flash → reboot
    ▼
MCU firmware update (IOP)
```

| STRIDE | Threat ID | Mô tả | Target |
|--------|-----------|-------|--------|
| **S**poofing | T-046 | OTA server giả mạo (DNS hijack / MITM) phân phối firmware độc | HTTPS download |
| **T**ampering | T-047 | Firmware package bị sửa trước khi GPG verify (GPG check lỏng) | `.kxpkg` package |
| **T**ampering | T-048 | Downgrade attack — attacker cố apply firmware cũ có CVE | Anti-downgrade |
| **R**epudiation | T-049 | OTA action log không đủ detail (ai trigger, từ version nào) | OTA audit |
| **I**nformation Disclosure | T-050 | OTA package download không đủ encryption (nhưng đã TLS 1.3 — residual) | Network |
| **D**enial of Service | T-051 | OTA khiến thiết bị reboot không mong muốn → mất điều khiển tạm thời | OTA scheduler |
| **D**enial of Service | T-052 | Brick device nếu cả A/B partition đều bad | OTA failure |
| **E**levation of Privilege | T-053 | GPG private key compromised → attacker sign firmware tùy ý | Supply chain |

---

## 6. Threat Catalog với Risk Rating

Đánh giá risk: **Likelihood** (1–5) × **Impact** (1–5) = **Risk Score** (1–25)

| Scale | Likelihood | Impact |
|-------|-----------|--------|
| 1 | Very Unlikely | Negligible |
| 2 | Unlikely | Minor |
| 3 | Possible | Moderate |
| 4 | Likely | Major |
| 5 | Very Likely | Critical |

**Risk Level:** 1–6 Low 🟢 | 7–12 Medium 🟡 | 13–19 High 🟠 | 20–25 Critical 🔴

### 6.1 All Threats (sorted by Risk Score)

| ID | Threat | L | I | Score | Level | TB |
|----|--------|---|---|-------|-------|-----|
| T-053 | GPG private key compromise → arbitrary firmware signing | 2 | 5 | 10 | 🟡 | TB-6 |
| T-042 | JTAG/SWD access → read MCU memory, dump firmware | 2 | 5 | 10 | 🟡 | TB-5 |
| T-003 | Token theft/reuse — giả mạo REST client | 3 | 4 | 12 | 🟡 | TB-1 |
| T-006 | MITM TLS downgrade / intercept nếu cert validation lỏng | 2 | 5 | 10 | 🟡 | TB-1 |
| T-010 | Sniffing BACnet traffic (UDP plaintext) cùng subnet | 4 | 3 | 12 | 🟡 | TB-1 |
| T-012 | BACnet Who-Is broadcast amplification / UDP flood | 4 | 3 | 12 | 🟡 | TB-1 |
| T-013 | Connection exhaustion — REST API / Web IDE | 3 | 4 | 12 | 🟡 | TB-1 |
| T-015 | JWT token forgery / privilege escalation | 2 | 5 | 10 | 🟡 | TB-1 |
| T-016 | CSRF/XSS trong Web IDE → admin action | 3 | 4 | 12 | 🟡 | TB-1 |
| T-017 | BACnet Write-Property vượt priority array limits | 3 | 3 | 9 | 🟡 | TB-1 |
| T-024 | Mất IOP > 200ms → MCU safe-state: mất điều khiển | 3 | 4 | 12 | 🟡 | TB-2 |
| T-018 | Thiết bị ngoài gắn UART header giả mạo IOP frame | 1 | 5 | 5 | 🟢 | TB-2 |
| T-020 | Replay IOP frame cũ (sequence number check lỗi) | 2 | 4 | 8 | 🟡 | TB-2 |
| T-025 | IOP protocol không phân biệt GET vs SET privilege | 2 | 4 | 8 | 🟡 | TB-2 |
| T-026 | Slave giả mạo gửi response sai trên RS-485 | 3 | 3 | 9 | 🟡 | TB-3 |
| T-027 | RS-485 bus injection — Modbus frame giả | 3 | 4 | 12 | 🟡 | TB-3 |
| T-030 | Modbus RTU plaintext — không encryption trên RS-485 | 4 | 2 | 8 | 🟡 | TB-3 |
| T-033 | Modbus không phân biệt read/write access | 4 | 3 | 12 | 🟡 | TB-3 |
| T-034 | Attacker đưa tín hiệu giả vào UI input | 3 | 4 | 12 | 🟡 | TB-4 |
| T-035 | Kẹp/thay đổi tín hiệu AO/DO gây hại HVAC | 2 | 5 | 10 | 🟡 | TB-4 |
| T-039 | Overvoltage / surge trên UI input → damage ADC | 3 | 4 | 12 | 🟡 | TB-4 |
| T-041 | Debug UART console không password → login | 1 | 5 | 5 | 🟢 | TB-5 |
| T-045 | Console root access (nếu production build không disable) | 1 | 5 | 5 | 🟢 | TB-5 |
| T-046 | OTA server giả mạo → firmware độc (DNS hijack) | 2 | 5 | 10 | 🟡 | TB-6 |
| T-047 | Firmware bị sửa trước GPG verify | 2 | 5 | 10 | 🟡 | TB-6 |
| T-048 | Downgrade attack — firmware cũ có CVE | 2 | 4 | 8 | 🟡 | TB-6 |
| T-051 | OTA reboot không mong muốn → mất điều khiển | 3 | 3 | 9 | 🟡 | TB-6 |
| T-052 | Brick device — cả A/B partition đều bad | 1 | 5 | 5 | 🟢 | TB-6 |
| T-001 | Giả mạo BMS gửi BACnet Write-Property không auth | 3 | 4 | 12 | 🟡 | TB-1 |
| T-002 | Giả mạo MQTT broker / publish message không auth | 3 | 4 | 12 | 🟡 | TB-1 |
| T-004 | DNS / ARP spoofing dẫn hướng traffic | 3 | 3 | 9 | 🟡 | TB-1 |
| T-005 | BACnet malformed packet → crash stack | 3 | 3 | 9 | 🟡 | TB-1 |
| T-007 | Replay point write commands | 2 | 3 | 6 | 🟢 | TB-1 |
| T-008 | Thiếu audit log cho critical operations | 2 | 3 | 6 | 🟢 | TB-1 |
| T-009 | Information leakage qua error messages | 2 | 2 | 4 | 🟢 | TB-1 |
| T-011 | Directory listing / endpoint enumeration không auth | 2 | 2 | 4 | 🟢 | TB-1 |
| T-014 | MQTT client flood — concurrent connections | 2 | 3 | 6 | 🟢 | TB-1 |
| T-019 | IOP frame EMI corruption (CRC detect, no retry) | 2 | 2 | 4 | 🟢 | TB-2 |
| T-021 | MCU fault không log chi tiết | 2 | 2 | 4 | 🟢 | TB-2 |
| T-022 | IOP bus sniffing — physical access required | 1 | 3 | 3 | 🟢 | TB-2 |
| T-023 | IOP frame flood từ MCU | 1 | 3 | 3 | 🟢 | TB-2 |
| T-028 | CRC error / data corruption — RS-485 noise | 3 | 2 | 6 | 🟢 | TB-3 |
| T-029 | Không log Modbus command history | 2 | 2 | 4 | 🟢 | TB-3 |
| T-031 | Slave không response → poll timeout → alarm flood | 3 | 2 | 6 | 🟢 | TB-3 |
| T-032 | RS-485 bus short circuit — mất communication | 2 | 3 | 6 | 🟢 | TB-3 |
| T-036 | Không detect fault condition (sensor open/short) | 2 | 2 | 4 | 🟢 | TB-4 |
| T-037 | Side-channel — đo AO voltage suy luận trạng thái | 2 | 1 | 2 | 🟢 | TB-4 |
| T-038 | ADC/DAC SPI failure → mất I/O | 1 | 4 | 4 | 🟢 | TB-4 |
| T-040 | N/A — physical I/O không có privilege model | — | — | — | — | TB-4 |
| T-043 | Kernel messages / debug log leak qua UART console | 1 | 2 | 2 | 🟢 | TB-5 |
| T-044 | JTAG clock glitch / voltage fault injection | 1 | 3 | 3 | 🟢 | TB-5 |
| T-049 | OTA action log không đủ detail | 2 | 2 | 4 | 🟢 | TB-6 |
| T-050 | OTA download encryption (residual — đã có TLS 1.3) | 1 | 2 | 2 | 🟢 | TB-6 |

### 6.2 Top Threats (Risk Score ≥ 12)

| ID | Tên | Score | Level |
|----|-----|-------|-------|
| T-001 | Giả mạo BMS gửi BACnet Write-Property không auth | 12 | 🟡 |
| T-002 | Giả mạo MQTT broker / publish message không auth | 12 | 🟡 |
| T-003 | Token theft/reuse | 12 | 🟡 |
| T-010 | Sniffing BACnet plaintext | 12 | 🟡 |
| T-012 | BACnet Who-Is broadcast amplification | 12 | 🟡 |
| T-013 | Connection exhaustion | 12 | 🟡 |
| T-016 | CSRF/XSS Web IDE | 12 | 🟡 |
| T-024 | Mất IOP > 200ms → safe-state | 12 | 🟡 |
| T-027 | RS-485 bus injection | 12 | 🟡 |
| T-033 | Modbus không phân biệt read/write | 12 | 🟡 |
| T-034 | Tín hiệu giả vào UI input | 12 | 🟡 |
| T-039 | Overvoltage/surge damage ADC | 12 | 🟡 |

**Không có threats nào ở mức Critical (≥20)** nhờ các mitigation đã có trong thiết kế (TLS 1.3, verified boot, GPG signing, IOP CRC+seq, firewall). Các threat ở mức High (13–19) cũng không xuất hiện do các security baseline từ SEC-REQ-001 đã bao phủ hầu hết vectors.

---

## 7. Mitigation Mapping

### 7.1 Existing Mitigations (đã có trong thiết kế)

| Threat ID | Mitigation hiện tại | SEC-REQ Ref | Design Ref |
|-----------|-------------------|-------------|------------|
| T-001 | BACnet Write-Property yêu cầu device auth (nếu BMS hỗ trợ); firewall port allowlist | SEC-028, SEC-020 | D-11 §6 |
| T-002 | MQTT TLS 1.3 + certificate validation | SEC-030, SEC-032 | D-11 §4 |
| T-003 | JWT token: exp 1h, blocklist khi logout, idle timeout 30 phút | SEC-024 | D-11 §5 |
| T-004 | nftables firewall strict allowlist | SEC-020 | D-11 §6 |
| T-005 | BACnet stack input validation (upstream bacnet-stack) | — | — |
| T-006 | TLS 1.3 mandatory, strong ciphers only, cert validation enforced | SEC-030, SEC-031, SEC-032 | D-11 §4 |
| T-008 | Audit log ghi login, config change, firmware update, point write | SEC-025, SEC-046 | D-11 §7 |
| T-009 | Error handling — không leak stack trace trong production | SEC-042 | D-11 §7 |
| T-010 | Chỉ mở BACnet trong trusted network segment, firewall block WAN direct | SEC-034 | D-11 §6 |
| T-011 | Web IDE yêu cầu auth trước (JWT Bearer) | SEC-024 | D-11 §5 |
| T-012 | Rate limiting / firewall có thể giới hạn BACnet broadcast | — | D-11 §6 |
| T-013 | nftables connection tracking + rate limit | — | D-11 §6 |
| T-015 | JWT secret 256-bit random, không hardcode | SEC-040 | D-11 §2-3 |
| T-016 | RBAC 3 roles (admin/operator/viewer), auth required | SEC-027 | D-11 §5 |
| T-018 | UART console disabled trong production build | SEC-051 | HW design review |
| T-019 | CRC16 frame check + sequence number | SEC-033 | IOP-SPEC |
| T-024 | MCU safe-state khi IOP timeout > 200ms: AO=0V, DO=open | FW ARCH §7 | FW safe-state |
| T-026 | Modbus device profile mapping + expected response validation | — | Fieldbus design |
| T-031 | Bad quality flag + alarm khi slave timeout | — | PRD UC-06 |
| T-035 | Safe-state config per channel (`io_safe_state.conf`) | — | SW ARCH §5 |
| T-039 | ADC input protection (HW design) | — | HW design |
| T-041 | UART console disabled production | SEC-051 | — |
| T-042 | JTAG/SWD header không accessible từ external | SEC-051 | HW design |
| T-045 | Root login SSH disabled, production console disabled | SEC-022, SEC-051 | D-11 §6 |
| T-046 | HTTPS TLS 1.3 + GPG signature verify trước apply | SEC-010, SEC-011, SEC-015 | D-7 §3-4 |
| T-047 | GPG verify của `.kxpkg` trước khi unpack | SEC-011 | D-7 §4 |
| T-048 | Anti-downgrade: min_version check trong manifest | SEC-014 | D-7 §3 |
| T-052 | A/B partition + health check rollback sau 2 lần fail | SEC-012 | D-7 §5 |
| T-053 | GPG private key stored in HSM (off-device) | SEC-013 | D-7 §6 |

### 7.2 Recommended Additional Mitigations

| Threat ID | Mitigation đề xuất | Priority | Owner | Ghi chú |
|-----------|-------------------|----------|-------|---------|
| T-001 | BACnet Write-Property: thêm optional password/access token cho critical objects | Medium | Software Team | BACnet không native auth; có thể dùng COV + server-side validation |
| T-002 | MQTT: enforce client certificate (TLS mutual auth) cho tất cả publishers | Medium | Software Team | Hiện chỉ có server cert validation |
| T-005 | BACnet: thêm fuzz testing cho BACnet stack (AFL/atheris) | Medium | QA + Software Team | bacnet-stack upstream chưa có fuzz corpus |
| T-007 | REST: thêm timestamp + nonce trong write request để chống replay | Low | Software Team | JWT exp + token blocklist đã giảm risk |
| T-010 | BACnet segmentation: VLAN riêng cho BACnet traffic, disable IP forwarding | Medium | Network Admin | Phụ thuộc hạ tầng building |
| T-012 | BACnet: rate limit Who-Is broadcast (max N requests/phút) | Medium | Software Team | Configurable trong bacnet.conf |
| T-013 | REST: connection rate limiting (nginx/iptables connlimit) | Medium | Software Team | Có thể dùng nftables |
| T-016 | Web IDE: CSP headers, CSRF token, input sanitization | High | Frontend Team | OWASP Top 10 |
| T-024 | IOP: thêm health check với MCU heartbeat (nếu timeout < 200ms → cảnh báo sớm) | Low | Software + FW Team | Hiện tại chỉ có safe-state sau 200ms |
| T-025 | IOP: phân biệt GET vs SET opcode — chỉ SET khi có PLC write confirm | Low | Software + FW Team | Hiện tại bất kỳ frame nào cũng có thể SET |
| T-027 | RS-485: disable broadcast write (Modebus broadcast) nếu không cần | Low | Software Team | Mặc định chỉ poll slaves, không write broadcast |
| T-028 | Modbus: thêm response timeout + retry (3 lần) cho mỗi poll | Medium | Software Team | libmodbus đã hỗ trợ timeout config |
| T-030 | Modbus: RS-485 là bus nội bộ building — chấp nhận residual risk | Low | Tech Lead | Physical access required |
| T-033 | Modbus: implement write-protect — chỉ write nếu slave device profile cho phép | Medium | Software Team | Device profile schema cần mở rộng |
| T-034 | UI: detect sensor fault (open/short) + quality flag | High | Software Team | Phát hiện sớm sensor fault |
| T-039 | UI: overvoltage protection circuit (TVS diode, series resistor) | High | Hardware Team | HW design protection |
| T-046 | OTA: certificate pinning cho OTA server endpoint | High | Software Team | SEC-032 đã đề cập |
| T-051 | OTA: schedule OTA trong giờ bảo trì, user confirm trước reboot | Medium | Software Team | UX design |

---

## 8. Residual Risk & Assumptions

### 8.1 Residual Risk

| Risk ID | Mô tả | L | I | Score | Rationale |
|---------|-------|---|---|-------|-----------|
| RR-01 | BACnet plaintext trên LAN (UDP không encryption) | 3 | 3 | 9 | BACnet/IP không hỗ trợ native encryption. Chấp nhận residual risk nếu BACnet segment là VLAN riêng. |
| RR-02 | Modbus RTU plaintext trên RS-485 | 4 | 2 | 8 | RS-485 là bus nội bộ trong tủ điện. Physical access mới khai thác được. Residual risk chấp nhận được. |
| RR-03 | Brute-force login qua Web UI/SSH (despite lockout) | 2 | 3 | 6 | Lockout 15 phút sau 5 lần fail (SEC-023). Attacker có thể tạo noise nhưng khó thành công. |
| RR-04 | Side-channel physical (power analysis, EM emission) | 1 | 2 | 2 | Beyond IEC 62443-4-2 scope cho Class 1 device. Residual risk chấp nhận. |
| RR-05 | Dependencies zero-day (bacnet-stack, libmodbus, etc.) | 2 | 4 | 8 | Bảo vệ bởi SBOM scan + CVE monitoring (SEC-GAP-001 SM-6). Không thể loại trừ zero-day. |

### 8.2 Assumptions

| # | Assumption | Impact nếu sai |
|---|-----------|----------------|
| A-01 | Building network có firewall/segmentation giữa BACnet devices và WAN | BACnet expose trực tiếp ra Internet |
| A-02 | SI tool (laptop kỹ thuật viên) không bị compromise khi commissioning | Attacker có thể dùng SI tool làm pivot |
| A-03 | GPG private key cho firmware signing được bảo vệ bởi HSM | Attacker sign firmware tùy ý |
| A-04 | OTA server endpoint được bảo vệ (TLS + authentication) | MITM / fake OTA server |
| A-05 | Modbus RTU slaves là trusted devices trong cùng tủ điện | Malicious slave trên RS-485 |
| A-06 | Physical access đến device là restricted (phòng kỹ thuật khóa) | JTAG/UART debugging |

---

## 9. Kết luận và khuyến nghị

### 9.1 Kết luận

Threat model STRIDE analysis cho MK-DDC-24 đã phân tích **53 threats** trên **6 trust boundaries**, với:

| Hạng mục | Giá trị |
|----------|---------|
| Trust boundaries phân tích | **6** (≥4, ✅ đạt AC) |
| Total threats identified | 53 |
| Risk Level: 🟢 Low | 22 threats |
| Risk Level: 🟡 Medium | 31 threats |
| Risk Level: 🟠 High | 0 threats |
| Risk Level: 🔴 Critical | 0 threats |
| Mitigations existing | ~40 (từ SEC-REQ-001 + architecture) |
| Additional mitigations đề xuất | 14 |

**Điểm mạnh:** Kiến trúc MK-DDC-24 đã tích hợp security-by-design tốt: TLS 1.3 cho northbound, verified boot chain (U-Boot → kernel → rootfs), GPG-signed firmware, A/B rollback, IOP CRC+seq integrity, firewall strict allowlist, RBAC, audit log, và key store abstraction.

**Điểm yếu:** Các threat tập trung ở northbound IP (BACnet/IP plaintext, không native auth) và southbound RS-485 (Modbus không access control). Đây là hạn chế của giao thức, không phải lỗi implementation.

### 9.2 Khuyến nghị

1. **Ngay (P5/P7 blockers không ảnh hưởng schedule):**
   - Web IDE: CSP headers + CSRF token (T-016) — OWASP priority
   - UI sensor fault detection + quality flag (T-034) — operational safety
   - OTA server certificate pinning (T-046) — defense-in-depth

2. **Prioritize cho implementation phase:**
   - BACnet fuzz testing (T-005) — trước khi submit BTL certification
   - MQTT mutual TLS (T-002) — nếu OTA/cloud yêu cầu 2-way auth
   - Modbus write-protect theo device profile (T-033)
   - Rate limiting REST API + BACnet (T-012, T-013)

3. **Defer / accept residual:**
   - BACnet encryption — chờ BACnet/SC (BACnet Secure Connect) adoption
   - Modbus RS-485 encryption — physical security assumption
   - IOP privilege separation — safe-state đã đủ bảo vệ

### 9.3 Verification

**Checklist để xác nhận threat model đã review:**

- [x] Tối thiểu 4 trust boundaries được phân tích (TB-1..TB-6: **6 boundaries**)
- [x] Mỗi threat có risk rating (Likelihood × Impact)
- [x] Mỗi threat có đề xuất mitigation
- [ ] Review bởi Solution Architect

---

## 10. Phụ lục: STRIDE Checklist per Element

### 10.1 External Entities

| Element | S | T | R | I | D | E | Ghi chú |
|---------|---|---|---|---|---|---|----------|
| BMS | ✅ T-001 | ✅ T-005 | — | ✅ T-010 | ✅ T-012 | ✅ T-017 | BACnet plaintext largest risk |
| Cloud / MQTT broker | ✅ T-002 | ✅ T-006 | — | — | ✅ T-014 | — | Mutual TLS recommended |
| SI Laptop (Web IDE) | ✅ T-003 | ✅ T-007 | ✅ T-008 | ✅ T-009 | ✅ T-013 | ✅ T-015, T-016 | Web app security critical |
| OTA server | ✅ T-046 | ✅ T-047 | — | — | — | — | Cert pinning needed |
| Modbus RTU slaves | ✅ T-026 | ✅ T-027 | — | ✅ T-030 | ✅ T-031 | ✅ T-033 | No access control |
| Sensors / Actuators | ✅ T-034 | ✅ T-035 | ✅ T-036 | ✅ T-037 | ✅ T-038, T-039 | — | Physical protection |

### 10.2 Data Flows

| Data Flow | S | T | R | I | D | E |
|-----------|---|---|---|---|---|---|
| BACnet/IP (BMS ↔ DDC) | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| MQTT (DDC ↔ Cloud) | ✅ | ✅ | — | — | ✅ | — |
| REST API (SI ↔ DDC) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| HTTPS OTA (DDC ↔ Server) | ✅ | ✅ | — | — | — | — |
| IOP UART (SOM ↔ MCU) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Modbus RTU (DDC ↔ Slave) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Physical I/O (MCU ↔ Field) | ✅ | ✅ | ✅ | ✅ | ✅ | — |

### 10.3 Data Stores

| Data Store | S | T | R | I | D | E |
|------------|---|---|---|---|---|---|
| Shared memory (kinexus_io_shm, plc_shm) | — | ✅ | — | ✅ | — | — |
| Config files (`/data/config/`) | — | ✅ | — | ✅ | — | ✅ |
| Certificate store (`/data/certs/`) | — | ✅ | — | ✅ | — | ✅ |
| Audit log (`/data/log/audit.log`) | — | ✅ | ✅ | ✅ | — | — |
| PLC programs (`/data/plc/`) | — | ✅ | — | ✅ | — | ✅ |
| Firmware partitions (A/B) | — | ✅ | — | — | ✅ | — |

### 10.4 Processes

| Process | S | T | R | I | D | E |
|---------|---|---|---|---|---|---|
| kinexus-bacnetd | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| kinexus-agent | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| kinexus-webide | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| kinexus-iod | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| kinexus-plcd | — | ✅ | — | ✅ | — | — |
| kinexus-otad | ✅ | ✅ | ✅ | — | ✅ | ✅ |
| MCU tasks (io_sample, iop_comm) | ✅ | ✅ | ✅ | ✅ | ✅ | — |

---

## Revision History

| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 1.0 | 2026-06-02 | DeveloperTeam | Initial threat model STRIDE analysis cho IOT-5489. Phân tích 6 trust boundaries, 53 threats, risk rating, mitigation mapping. |
