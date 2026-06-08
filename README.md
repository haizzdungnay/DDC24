# MK-DDC-24 — Bộ Tài liệu Kỹ thuật

> **Sản phẩm:** MK-DDC-24 — Component-Based BMS Edge Automation Controller (24 IO, SOM Debian Linux)  
> **Phiên bản tài liệu:** Ver 2.1 | 2026-05-28  
> **Tổ chức:** KINEXUS Technologies JSC

> ⭐ **Nguồn-chuẩn định vị & phạm vi (đọc trước tiên, 2026-06-08):** [PRODUCT_DEFINITION](docs/01_specs/PRODUCT_DEFINITION_MK-DDC-24_VI.md) · [BMS_EDGE_STRATEGY](docs/01_specs/BMS_EDGE_STRATEGY_MK-DDC-24_VI.md) · [REVA_SCOPE_ROADMAP](docs/01_specs/REVA_SCOPE_ROADMAP_MK-DDC-24_VI.md) · Quyết định: [ADR-004..008](docs/adr/). Sản phẩm là **Component-Based BMS Edge Automation Controller** (HVAC là use-case đầu, không HVAC-only; không IEC 61131-3/PLC IDE), Linux 3-process `mkddc-*`.
> 🧭 **Cổng vào theo chuẩn ISO:** [docs/README](docs/README.md) (Document Hub) — điều hướng theo vòng đời, kế hoạch implement, UI/UX, register.
> 🌟 **Chưa hiểu sản phẩm? Đọc trước:** [**System Handbook — Hiểu hệ thống từ số 0**](docs/00_management/KX-DDC24-SYS-ARCH-001_VI.md) (kể chuyện + sơ đồ, không cần biết code).
> 🚀 **Người mới (dev):** [Project Overview](docs/00_management/KX-DDC24-PM-OVERVIEW-001_VI.md) → [Getting Started](docs/02_design/GETTING_STARTED_DEV.md) → [Implementation Plan](docs/00_management/KX-DDC24-PM-IMPLPLAN-001_VI.md).
> 📜 Lịch sử thay đổi: [CHANGELOG.md](CHANGELOG.md) · 🗂 Danh mục tài liệu: [Master Register](docs/00_management/KX-DDC24-QA-REGISTER-001_VI.md)

---

## Sản phẩm Rev A (chốt — xem [CANONICAL_DECISIONS](docs/CANONICAL_DECISIONS.md))

**MK-DDC-24 is a Component-Based BMS Edge Automation Controller** (HVAC là use-case đầu tiên, không HVAC-only; không phải IEC 61131-3 PLC).

Rev A runtime = **3 process**:
- **`mkddc-core`** — graph execution, component scheduler, state machine, priority/safe-state
- **`mkddc-iobus`** — STM32/IO (IOP) protocol, DI/DO/UI/AO scan, Modbus RTU/TCP, BACnet/IP
- **`mkddc-web`** — REST API, configuration UI (form/JSON), import/export `graph.json`

Rev A **explicitly does NOT implement**:
- IEC 61131-3 PLC runtime
- FBD/ST Web IDE (wiresheet canvas)
- production BTL certification
- HMI panel
- OTA / cloud (MQTT) agent

### Legacy / Superseded Architecture

Các nội dung sau là **legacy** — đã bị thay thế hoặc đẩy sang Rev sau bởi [ADR-004..008](docs/adr/).
Nếu gặp trong tài liệu cũ, đọc như tham chiếu lịch sử, **không phải** kiến trúc Rev A:

| Legacy | Thay bằng / Trạng thái |
|--------|------------------------|
| IEC 61131-3 PLC runtime, FBD/ST | component graph runtime — Rev C (ADR-004) |
| KinexusET / FBD-ST Web IDE (wiresheet) | `mkddc-web` form/JSON; canvas → Rev B (ADR-006) |
| Service `kinexus-*` (plc/agent/webide/hmi/ota…) | 3-process `mkddc-core/iobus/web` (ADR-005) |
| MQTT/cloud agent trong Rev A | Deferred Rev B+ |
| OTA A/B partition trong Rev A | Deferred Rev B+ |
| BACnet MS/TP, Modbus slave | bỏ theo ARCH-R010 |

---

## Danh mục Tài liệu

| # | File | Loại | Mô tả | Trạng thái |
|---|------|------|-------|-----------|
| 1 | [DS_MK-DDC-24_VI.md](docs/01_specs/DS_MK-DDC-24_VI.md) | **Data Sheet** | Thông số kỹ thuật, tính năng, mã đặt hàng | Rev 2.1 |
| 2 | [PRD_MK-DDC-24_VI.md](docs/01_specs/PRD_MK-DDC-24_VI.md) | **Product Requirements** | Mục tiêu, use cases, FR/NFR, acceptance criteria | Rev 1.1 |
| 3 | [SRS_MK-DDC-24_VI.md](docs/01_specs/SRS_MK-DDC-24_VI.md) | **Software Requirements** | OS, component graph runtime, BACnet, Modbus, security *(MQTT/OTA → Rev B+)* | Rev 1.1 |
| 4 | [HW_SPEC_MK-DDC-24_VI.md](docs/01_specs/HW_SPEC_MK-DDC-24_VI.md) | **Hardware Specification** | SOM, MCU, I/O circuits, power, cơ khí, EMC | Rev 1.1 |

### Bộ tài liệu SW/FW Spec (`docs/01_specs/`)

| # | File | Loại | Mô tả | Trạng thái |
|---|------|------|-------|-----------|
| 5 | [SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md](docs/01_specs/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md) | **IOP Interface Spec** | Kinexus-IOP v1: frame format, CRC, commands, timing, fault FSM | Rev 1.0 |
| 6 | [FW_REQUIREMENTS_MK-DDC-24_VI.md](docs/01_specs/FW_REQUIREMENTS_MK-DDC-24_VI.md) | **FW Requirements** | MCU I/O sampling, AO/DO, watchdog, IOP, boot, OTA requirements | Rev 1.0 |
| 7 | [FW_ARCH_SPEC_MK-DDC-24_VI.md](docs/01_specs/FW_ARCH_SPEC_MK-DDC-24_VI.md) | **FW Architecture** | FreeRTOS tasks, interrupt, memory map, data structures, fault FSM | Rev 1.0 |
| 8 | [SW_REQUIREMENTS_MK-DDC-24_VI.md](docs/01_specs/SW_REQUIREMENTS_MK-DDC-24_VI.md) | **SW Requirements** | Rev A modules: IOP driver, component graph runtime, BACnet, Modbus RTU/TCP, REST/web, security, logging *(MQTT/OTA/HMI → Deferred Rev B+)* | Rev 1.0 |
| 9 | [SW_ARCH_SPEC_MK-DDC-24_VI.md](docs/01_specs/SW_ARCH_SPEC_MK-DDC-24_VI.md) | **SW Architecture** | Process model, IPC (shm+seqlock), data flow, scaling, config, REST endpoints | Rev 1.0 |
| 10 | [TEST_SPEC_MK-DDC-24_VI.md](docs/01_specs/TEST_SPEC_MK-DDC-24_VI.md) | **Test Specification** | L1-L6 test cases, FAT/SAT checklist, traceability matrix PRD→SRS→Spec→Test | Rev 1.0 |
| 11 | [OPEN_ISSUES_MK-DDC-24_VI.md](docs/01_specs/OPEN_ISSUES_MK-DDC-24_VI.md) | **Open Issues** | P0/P1/P2 issues, assumptions, external dependencies, resolved issues | Rev 1.0 |
| 12 | [DESIGN_READINESS_REVIEW_MK-DDC-24_VI.md](docs/01_specs/DESIGN_READINESS_REVIEW_MK-DDC-24_VI.md) | **Design-Readiness Review** | Audit chéo toàn bộ tài liệu: P0/P1/P2 findings, khoảng trống, thứ tự xử lý trước thiết kế | Rev 1.0 |

---

## Tóm tắt Kiến trúc

```
┌──────────────────────────────────────────────┐
│  MK-DDC-24 — Kiến trúc Dual-Layer            │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │  SOM: Radxa CM3 — RK3566 A55, 2GB LPDDR4  │    │
│  │  Debian 12, PREEMPT_RT              │    │
│  │  ► Component graph (mkddc-core)     │    │
│  │  ► BACnet/IP server (bỏ MS/TP)      │    │
│  │  ► Modbus RTU x2/TCP (mkddc-iobus)  │    │
│  │  ► REST API + Web config form/JSON  │    │
│  │    (mkddc-web)                      │    │
│  │  ► MQTT v5.0 / OTA A/B → Rev B+     │    │
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
| **IEC 61131-3** | Lập trình PLC FBD/ST — *tầm nhìn Rev C* (Rev A dùng component graph) |
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