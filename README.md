# MK-DDC-24 — Bộ Tài liệu Kỹ thuật

> **Sản phẩm:** MK-DDC-24 — Bộ điều khiển DDC 24 điểm, SOM Debian Linux  
> **Phiên bản tài liệu:** Ver 2.1 | 2026-05-28  
> **Tổ chức:** KINEXUS Technologies JSC

> 🧭 **Cổng vào theo chuẩn ISO:** [docs/README](docs/README.md) (Document Hub) — điều hướng theo vòng đời, kế hoạch implement, UI/UX, register.
> 🚀 **Người mới:** [Project Overview](docs/00_management/KX-DDC24-PM-OVERVIEW-001_VI.md) → [Getting Started](design/GETTING_STARTED_DEV.md) → [Implementation Plan](docs/00_management/KX-DDC24-PM-IMPLPLAN-001_VI.md).
> 📜 Lịch sử thay đổi: [CHANGELOG.md](CHANGELOG.md) · 🗂 Danh mục tài liệu: [Master Register](docs/00_management/KX-DDC24-QA-REGISTER-001_VI.md)

---

## Danh mục Tài liệu

| # | File | Loại | Mô tả | Trạng thái |
|---|------|------|-------|-----------|
| 1 | [DS_MK-DDC-24_VI.md](DS_MK-DDC-24_VI.md) | **Data Sheet** | Thông số kỹ thuật, tính năng, mã đặt hàng | Rev 2.1 |
| 2 | [PRD_MK-DDC-24_VI.md](PRD_MK-DDC-24_VI.md) | **Product Requirements** | Mục tiêu, use cases, FR/NFR, acceptance criteria | Rev 1.1 |
| 3 | [SRS_MK-DDC-24_VI.md](SRS_MK-DDC-24_VI.md) | **Software Requirements** | OS, soft PLC, BACnet, MQTT, security, OTA | Rev 1.1 |
| 4 | [HW_SPEC_MK-DDC-24_VI.md](HW_SPEC_MK-DDC-24_VI.md) | **Hardware Specification** | SOM, MCU, I/O circuits, power, cơ khí, EMC | Rev 1.1 |

### Bộ tài liệu SW/FW Spec (`spec/`)

| # | File | Loại | Mô tả | Trạng thái |
|---|------|------|-------|-----------|
| 5 | [spec/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md](spec/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md) | **IOP Interface Spec** | Kinexus-IOP v1: frame format, CRC, commands, timing, fault FSM | Rev 1.0 |
| 6 | [spec/FW_REQUIREMENTS_MK-DDC-24_VI.md](spec/FW_REQUIREMENTS_MK-DDC-24_VI.md) | **FW Requirements** | MCU I/O sampling, AO/DO, watchdog, IOP, boot, OTA requirements | Rev 1.0 |
| 7 | [spec/FW_ARCH_SPEC_MK-DDC-24_VI.md](spec/FW_ARCH_SPEC_MK-DDC-24_VI.md) | **FW Architecture** | FreeRTOS tasks, interrupt, memory map, data structures, fault FSM | Rev 1.0 |
| 8 | [spec/SW_REQUIREMENTS_MK-DDC-24_VI.md](spec/SW_REQUIREMENTS_MK-DDC-24_VI.md) | **SW Requirements** | 9 modules: IOP driver, PLC, BACnet, MQTT/REST, security, OTA, HMI, logging | Rev 1.0 |
| 9 | [spec/SW_ARCH_SPEC_MK-DDC-24_VI.md](spec/SW_ARCH_SPEC_MK-DDC-24_VI.md) | **SW Architecture** | Process model, IPC (shm+seqlock), data flow, scaling, config, REST endpoints | Rev 1.0 |
| 10 | [spec/TEST_SPEC_MK-DDC-24_VI.md](spec/TEST_SPEC_MK-DDC-24_VI.md) | **Test Specification** | L1-L6 test cases, FAT/SAT checklist, traceability matrix PRD→SRS→Spec→Test | Rev 1.0 |
| 11 | [spec/OPEN_ISSUES_MK-DDC-24_VI.md](spec/OPEN_ISSUES_MK-DDC-24_VI.md) | **Open Issues** | P0/P1/P2 issues, assumptions, external dependencies, resolved issues | Rev 1.0 |
| 12 | [spec/DESIGN_READINESS_REVIEW_MK-DDC-24_VI.md](spec/DESIGN_READINESS_REVIEW_MK-DDC-24_VI.md) | **Design-Readiness Review** | Audit chéo toàn bộ tài liệu: P0/P1/P2 findings, khoảng trống, thứ tự xử lý trước thiết kế | Rev 1.0 |

---

## Tóm tắt Kiến trúc

```
┌──────────────────────────────────────────────┐
│  MK-DDC-24 — Kiến trúc Dual-Layer            │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │  SOM: Radxa CM3 — RK3566 A55, 2GB LPDDR4  │    │
│  │  Debian 12, PREEMPT_RT              │    │
│  │  ► Soft PLC (IEC 61131-3 FBD + ST)  │    │
│  │  ► BACnet MS/TP + BACnet/IP         │    │
│  │  ► MQTT v5.0 + REST API             │    │
│  │  ► KinexusET Web IDE                │    │
│  │  ► OTA A/B partition                │    │
│  └──────────────┬───────────────────────┘    │
│  │  ► Kinexus-IOP (UART 921,600 baud, isolated)  │    │
│  ┌──────────────▼───────────────────────┐    │
│  │  MCU: STM32G0B1RB, FreeRTOS          │    │
│  │  ► 8× Universal Input (NTC/PT/0-10V) │    │
│  │  ► 8× Digital Input (24VDC opto)     │    │
│  │  ► 4× Analog Output (0-10V / 4-20mA) │    │
│  │  ► 4× Digital Output (Relay SPDT 5A) │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

---

## Chuẩn Tuân thủ

| Chuẩn | Phạm vi |
|-------|---------|
| **IEC 61131-3** | Ngôn ngữ lập trình PLC (FBD, ST) |
| **IEC 62443-4-1** | Quy trình phát triển bảo mật |
| **IEC 62443-4-2** | Yêu cầu bảo mật component (roadmap) |
| **IEC 61709** | Ước tính MTBF |
| **IEC 61326-1** | EMC cho thiết bị đo lường/điều khiển |
| **IEC 61010-1** | Safety cho thiết bị điện công nghiệp |
| **BACnet BTL** | Conformance testing (target Q4/Y7) |
| **RoHS 3** | Hạn chế chất nguy hiểm trong điện tử |
| **REACH** | Hóa chất trong sản phẩm |

---

## Lịch sử Tài liệu

| Ngày | Phiên bản | Thay đổi |
|------|---------|---------|
| 2026-04-13 | DS Rev 1.0 | Khởi tạo datasheet ban đầu (STM32F303) |
| 2026-04-14 | DS Rev 1.1 | Bổ sung BACnet PICS, wiring example |
| 2026-05-26 | DS Rev 2.0 | Cập nhật kiến trúc SOM Debian, thêm BACnet/IP, MQTT |
| 2026-05-26 | PRD Rev 1.0 | Tạo mới — use cases, FR/NFR, acceptance criteria |
| 2026-05-26 | SRS Rev 1.0 | Tạo mới — software requirements per IEC 62443 |
| 2026-05-26 | HW_SPEC Rev 1.0 | Tạo mới — hardware specification đầy đủ |
| 2026-05-28 | DS Rev 2.1 | Bổ sung HMI TFT 2.4" vào spec + features |
| 2026-05-28 | HW_SPEC Rev 1.1 | Sửa số section, bổ sung bảng terminal + DIN-rail detail |
| 2026-05-28 | SRS Rev 1.1 | Bổ sung Section 11 (KinexusET IDE), 12 (HMI SW), 13 (Fault codes) |
| 2026-05-28 | PRD Rev 1.1 | Bổ sung Traceability Matrix (Section 8) |
| 2026-05-28 | ALL docs | Fix P0/P1 audit: version sync, Device ID priority, bus UART only, port policy, thermal claim, typo, EMC subsections, OTA spec |
| 2026-05-28 | spec/ (new) | Tạo bộ 7 tài liệu SW/FW spec: IOP Interface, FW-REQ, FW-ARCH, SW-REQ, SW-ARCH, TEST-SPEC, OPEN-ISSUES |
| 2026-05-30 | Design-Readiness Review | Audit chéo 24 tài liệu → tạo REVIEW doc (#12) |
| 2026-05-30 | ALL docs | **Đồng bộ P0+P1+P2:** MCU→**STM32G0B1RBT6**; **MCU master duy nhất ADS131M08** (gỡ CM3-SPI2→ADC), CM3 SPI0→TFT; Modbus map chuẩn **INT16 ×100**; MCU_SPEC §5 trỏ về IOP-SPEC; AO mode **phần mềm** (SET_AO_CFG); pinout MCU chuẩn; MCU-OTA UART Ver1; thống nhất FR/NFR ID; +15V rail; port 1883 chặn; MS/TP count; NTC β=3950; session 30′ |

---

## Hướng dẫn Cập nhật Tài liệu

**Nguyên tắc:** Mọi thay đổi cần cập nhật BOTH file liên quan và lịch sử bản này.

| Loại thay đổi | File cần cập nhật |
|--------------|--------------------|
| Thay đổi phần cứng (I/O, cơ khí, BOM) | HW_SPEC + DS + BOM trong hardware-design/ |
| Yêu cầu tính năng mới | PRD (FR/NFR) + SRS (requirement ID) + Traceability Matrix |
| Thay đổi phần mềm / protocol | SRS + DS (nếu ảnh hưởng spec bên ngoài) |
| Thay đổi tiêu chuẩn / chứng nhận | README + DS Section 3.5 + PRD constraints |

**Version numbering:**
- Rev X.0 — major revision (kiến trúc thay đổi)
- Rev X.Y — minor update (bổ sung, sửa lỗi)