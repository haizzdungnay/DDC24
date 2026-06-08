# Open Issues, Assumptions & Risks — MK-DDC-24
## SW/FW/HW Technical Issues Tracker

> **Document ID:** OPEN-ISSUES-MK-DDC-24-VI  
> **Phiên bản:** 1.0 | 2026-05-28  
> **Trạng thái:** Active — Updated by team as issues open/close  
> 📘 **Đọc cùng:** [README](README.md) — hướng dẫn + glossary · Đã đồng bộ **2026-05-30** (xem [REVIEW](DESIGN_READINESS_REVIEW_MK-DDC-24_VI.md))  
> **Tác giả:** KINEXUS Technologies

---

## Severity Definitions

| Priority | Mô tả |
|----------|-------|
| **P0 — Blocker** | Blocks GA release. PHẢI resolve trước khi ship |
| **P1 — Critical** | Ảnh hưởng nghiêm trọng chức năng. PHẢI resolve trước FAT |
| **P2 — Major** | Ảnh hưởng chức năng, có workaround. Resolve trong sprint hiện tại |
| **P3 — Minor** | Cải tiến / optimization. Schedule at PM discretion |

---

## 1. Open Issues — IOP Protocol

| ID | Priority | Tiêu đề | Mô tả | Impact | Owner | Deadline |
|----|----------|---------|-------|--------|-------|---------|
| IOP-Q-001 | P2 | UART baud rate vs ADUM1201 jitter | ADUM1201 ở 921,600 baud chưa đo jitter thực tế trên PCB. Datasheet spec OK nhưng chưa test với layout thật | Frame error rate unknown | HW | Trước prototype v1 |
| IOP-Q-002 | P2 | CRC mismatch giữa SW và FW test vector | CRC16/Modbus implementation SW (Python) vs FW (C) chưa có cross-validation test bằng shared test vectors | Khả năng frame bị drop silently | FW + SW | Sprint 2 |
| IOP-Q-003 | P3 | DI counter: uint16 hay uint32 | FW-IO-021 spec DI edge count là uint16 (max 65535). Nếu dùng high-frequency pulse counter → overflow nhanh | Functional gap với flow meter apps | FW | Sprint 3 |
| IOP-Q-004 | P2 | AO safe state: 0V hay 4mA khi 4-20mA mode | Spec hiện tại: safe state AO = 0V. Với 4-20mA mode, 0mA = wire break condition tại BMS. Nên là 4mA | Sai semantic với field device expectation | System Arch | Sprint 2 |
| IOP-Q-005 | P3 | SEQ field wrap-around behavior | Khi SEQ = 255 → 0, SOM cần detect đây là wrap (không phải out-of-order). Spec chưa nói rõ | Khả năng false IOP_FAULT khi wrap | SW | Sprint 3 |

---

## 2. Open Issues — Firmware

| ID | Priority | Tiêu đề | Mô tả | Impact | Owner | Deadline |
|----|----------|---------|-------|--------|-------|---------|
| FW-Q-001 | P3 | STM32G0B1 SPI DMA channel mapping | ✅ Giảm rủi ro sau khi đổi sang **STM32G0B1RB** (2× DMA controller + 3× SPI — đủ DMA đồng thời ADS131M08 + DAC8554 + USART1). Chỉ còn verify DMAMUX channel assignment khi bring-up. | Thấp | FW | Sprint 1 |
| FW-Q-002 | P2 | FreeRTOS stack sizing cho iop_rx_task | Hiện set 512 words. Task parse frame + CRC cần profile để confirm không stack overflow khi NACK handling path | Task crash risk | FW | Sprint 2 |
| FW-Q-003 | P3 | MCU temperature sensor calibration | STM32G0B1 internal temp sensor accuracy ±5°C. Chưa quyết định report raw hay calibrated. DS §3.1.2 nói "MCU temp" nhưng không specify accuracy | User confusion | FW | Sprint 3 |
| FW-Q-004 | P2 | ADS131M08 DRDY interrupt vs SPI polling | Hiện spec dùng periodic SPI polling (1ms). Nếu dùng DRDY interrupt → latency giảm còn ~4µs. Cần đánh giá PCB trace DRDY routing | Power + latency trade-off | FW + HW | Sprint 2 |

---

## 3. Open Issues — Software

| ID | Priority | Tiêu đề | Mô tả | Impact | Owner | Deadline |
|----|----------|---------|-------|--------|-------|---------|
| SW-Q-001 | P1 | BACnet BTL certification — chưa có plan | Chưa có kế hoạch chính thức, không có BTL accredited lab booked. BTL test thường 4-6 tuần lead time | P0 blocker cho GA nếu delay | SW Lead | Đặt lịch trước Month 3 |
| SW-Q-002 | P2 | IEC 61131-3 engine — tự build hay dùng open source | Chưa quyết định: (a) tự build minimal FBD/ST engine; (b) sử dụng open-source (OpenPLC, MATIEC). License compatibility với commercial product cần review | Build time vs legal risk | SW Lead + Legal | Sprint 1 |
| SW-Q-003 | P2 | LVGL memory consumption | LVGL v9 với frame buffer 320×240×16bpp = 150KB. RK3566 có 2GB RAM → OK, nhưng chưa đo actual heap usage trong production scenario | Memory leak risk | SW | Sprint 2 |
| SW-Q-004 | P3 | JWT secret storage trên Radxa CM3 | Hiện tại spec "HSM / secure key store". Radxa CM3 không có dedicated HSM. Phương án: (a) OP-TEE TrustZone; (b) TPM chip; (c) encrypted /data partition key | Security architecture gap | SW + HW | Sprint 2 |
| SW-Q-005 | P2 | OTA server URL chưa xác định | SW-OTA-001..008 cần biết OTA server endpoint để implement cert pinning và rollback prevention. Chưa có infrastructure decision | Cannot implement cert pinning | DevOps + PM | Sprint 2 |
| SW-Q-006 | P3 | Web IDE port 8080 vs enterprise firewall | LAN commissioning dùng port 8080 (HTTP). Nhiều enterprise firewall block non-standard ports. Cân nhắc dùng port 80 (redirect to 443) | Field deployment complication | SW | Sprint 3 |
| SW-Q-007 | P3 | NTC sensor coefficient library | SW-ARCH §4 dùng hệ số Murata NCP18XH103 cho NTC10k. Nếu dùng NTC khác nhà sản xuất → user phải nhập manual coefficients. Chưa có UI cho việc này | User experience gap | SW | Sprint 4 |

---

## 4. Open Issues — Hardware / Thermal

| ID | Priority | Tiêu đề | Mô tả | Impact | Owner | Deadline |
|----|----------|---------|-------|--------|-------|---------|
| HW-Q-001 | P1 | Thermal derating report chưa hoàn thành | DS §3.1 và HW_SPEC §2.1 nêu "target -20°C ~ +65°C" nhưng chưa có thermal test report. Validated range hiện tại chỉ là 0~55°C | Cannot claim industrial range on datasheet | HW | Trước GA |
| HW-Q-002 | P0 | CM3 extended temperature variant sourcing | Radxa CM3 consumer grade chỉ 0~50°C. Extended temp variant (-20~+80°C) chưa confirm availability từ Radxa. Nếu không available → cần đổi SOM | Có thể cần redesign major | HW + Procurement | Month 2 |
| HW-Q-003 | P2 | EMC testing (CE/FCC) chưa schedule | HW_SPEC §13.1/§13.2 liệt kê tiêu chuẩn nhưng chưa có EMC lab booking, không có pre-compliance test report | GA delay risk | HW + PM | Book lab Month 3 |

---

## 5. Open Decisions / Assumptions

### 5.1 Technical Decisions Pending

| ID | Quyết định | Options | Deadline | Owner |
|----|-----------|---------|---------|-------|
| DEC-001 | IEC 61131-3 engine: build vs open source | OpenPLC runtime vs tự build minimal | Sprint 1 | SW Lead |
| DEC-002 | AO safe state 4-20mA: 0mA vs 4mA | 4mA = "live zero" (recommended) vs 0mA = safe off | Sprint 2 | System Arch |
| DEC-003 | DI counter bit-width: uint16 vs uint32 | uint32 = no overflow for high-speed, costs 4 bytes in IO_RESP | Sprint 3 | FW Lead |
| DEC-004 | JWT secret storage: OP-TEE vs TPM vs encrypted FS | OP-TEE preferred if CM3 TrustZone confirmed functional | Sprint 2 | SW + HW |
| DEC-005 | OTA server infrastructure: self-hosted vs cloud | Cloud = AWS S3 + CloudFront cert; self-hosted = customer controlled | Month 2 | PM + DevOps |
| DEC-006 | BACnet BTL lab: ANNEXA, BACnet Testing Labs, hoặc khác | Depends trên budget và timeline | Book Sprint 3 | SW Lead + PM |

### 5.2 Technical Assumptions (hiện tại đang dùng, chưa validate)

| ID | Assumption | Risk nếu sai | Validation Plan |
|----|-----------|-------------|----------------|
| ASM-001 | ADUM1201 jitter tại 921,600 baud chấp nhận được (< 500ns) | Tăng frame error rate → giảm IOP reliability | PCB test HW prototype v1 |
| ASM-002 | FreeRTOS 10.5.1 stable trên STM32G0B1 tại 64MHz | Task scheduling issue, priority inversion | FW integration test |
| ASM-003 | SPI DMA trên STM32G0B1 đủ bandwidth cho ADC 1ksps + DAC 100Hz | ADC samples bị miss | FW Sprint 1 verification |
| ASM-004 | Radxa CM3 RK3566 PREEMPT_RT latency ≤ 100µs | IOP driver poll jitter > 1ms → scan error | OS bring-up benchmark |
| ASM-005 | LVGL v9 port cho fbtft/ILI9341 stable trên kernel 6.1 | HMI không boot | HMI bring-up test |
| ASM-006 | bacnet-stack 1.3.x pass BTL cho device profile này | BTL fail → cần custom stack | Conformance pre-test |

---

## 6. External Dependencies

| ID | Dependency | Status | Owner | Notes |
|----|-----------|--------|-------|-------|
| EXT-001 | Radxa CM3 extended temp variant availability | Unknown | Procurement | Critical path — HW-Q-002 |
| EXT-002 | BTL accredited test lab booking | Not started | SW Lead + PM | 4-6 weeks lead time |
| EXT-003 | EMC lab booking | Not started | HW + PM | 2-4 weeks lead time |
| EXT-004 | OTA server infrastructure provisioned | Not started | DevOps | Required for SW-OTA integration test |
| EXT-005 | SSH port 2222 whitelisted trong customer deployment config | Unknown | SI / Customer | Field deployment note — all deployments need firewall update |
| EXT-006 | IEC 61131-3 engine legal review (nếu dùng open source) | Not started | Legal | Required trước Sprint 2 decision |

---

## 7. Resolved Issues (Closed)

| ID | Tiêu đề | Giải pháp | Closed |
|----|---------|---------|-------|
| IOP-Q-R001 | SOM↔MCU bus: SPI + UART hay chỉ UART | Chốt: UART 921,600 baud only, ADUM1201 isolated. Xóa mọi reference tới SPI trong docs | 2026-05-28 |
| IOP-Q-R002 | BACnet Device ID: DIP vs Web UI | Chốt: DIP = bootstrap ID (1-127); Web UI = override full range; priority table trong HW_SPEC §16 | 2026-05-28 |
| IOP-Q-R003 | SSH port: 22 hay 2222 | Chốt: port 2222, key-only | 2026-05-28 |
| IOP-Q-R004 | Validated temp range vs target temp range | Chốt: validated 0~55°C; target -20~+65°C cần thermal derating report | 2026-05-28 |
| IOP-Q-R005 | OTA-006 vs OTA-007 contradiction | Chốt: OTA-006 = download in background (không interrupt operation); OTA-007 = reboot ≤ 60s | 2026-05-28 |
| IOP-Q-R006 | MCU: STM32G071RB (2×SPI, 1×DMA) có đủ resource không | Chốt: **đổi sang STM32G0B1RBT6** (3×SPI, 2×DMA, 144KB SRAM, pin-compatible LQFP64). Hợp thức hóa SPI3→ADS131M08 + SPI1→DAC8554 chạy DMA song song. +0.5 USD BOM | 2026-05-30 |
| IOP-Q-R007 | ADC architecture: SOM hay MCU đọc ADS131M08 | Chốt: **MCU là master DUY NHẤT** của ADS131M08 (SPI3). Xóa mọi đấu nối CM3-SPI2→ADS131M08 trong hardware-design. SOM nhận UI_RAW qua IOP (đúng IOP-Q-R001) | 2026-05-30 |
| IOP-Q-R008 | AO range select: jumper hay phần mềm | Chốt: **phần mềm per-kênh** (relay/analog-switch + lệnh SET_AO_CFG, IOP v1.1). Cập nhật HW_SPEC §6.1, IOP-SPEC §4.4 | 2026-05-30 |
| IOP-Q-R009 | Modbus register format | Chốt: **INT16 scaled (×100)**, 1 register/điểm. Map chuẩn = DS §4.1 / SRS §6.2. Sửa SW-MOD-003/005 (đang ghi FLOAT32) | 2026-05-30 |
| ARCH-R010 | **Kiến trúc kết nối: hướng Northbound vs Southbound** | Chốt (PO): **(1) Northbound lên BMS/cloud CHỈ qua Ethernet/WiFi (IP)** — giao thức: BACnet/IP + MQTT + REST (chốt loại sau, transport IP cố định). **BỎ Modbus TCP slave. BỎ BACnet MS/TP.** **(2) Southbound RS-485 = Modbus RTU MASTER** — DDC là master, poll thiết bị phụ (module mở rộng I/O, màn hình phụ, thiết bị bên thứ 3) theo **khung mở (device profile)**. Đảo ngược **RTU-006** ("không hỗ trợ master"). RS-485 dành 100% cho Modbus RTU master (không chia sẻ BACnet MS/TP nữa). **Ảnh hưởng:** SRS §5/§6.2/§6.3, SW-REQ §10, DS §3/§5, D-2 (viết lại thành RTU Master/Expansion), D-3 (BACnet IP-only), D-5 config, SW_DDD/agent/bacnet, thêm service `kinexus-fieldbus`. | 2026-05-30 |

---

**Document ID:** OPEN-ISSUES-MK-DDC-24-VI  
**Revision:** 1.0 | 2026-05-28  
**Next review:** Sprint planning meeting — KINEXUS Technologies
