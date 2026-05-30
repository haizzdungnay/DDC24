# Master Document Register — MK-DDC-24
## Danh mục kiểm soát toàn bộ tài liệu

> **Document ID:** KX-DDC24-QA-REGISTER-001
> **Phiên bản:** 1.0 | 2026-05-30 · **Trạng thái:** Approved · **Owner:** QA/PMO
> **Chuẩn:** ISO 9001:2015 §7.5.3 (kiểm soát thông tin dạng văn bản)
> 📘 [docs/README](../README.md) · Quy tắc ID/tên: [DOC_CONTROL](KX-DDC24-QA-DOCCTRL-001_VI.md)

> Đây là "sổ cái" tài liệu: mọi file đều có **Document ID, lĩnh vực, version, trạng thái, owner**. Khi thêm/đổi tài liệu → cập nhật bảng này + [CHANGELOG](../../CHANGELOG.md).
> Cột **Legacy file** giữ tên cũ (không đổi để tránh gãy link); cột **ID** là mã ISO mới.

---

## 1. Quản lý (00_management)
| ID | Tài liệu | Ver | Trạng thái | Owner |
|----|----------|:---:|:----------:|-------|
| KX-DDC24-PM-OVERVIEW-001 | [Project Overview](KX-DDC24-PM-OVERVIEW-001_VI.md) | 1.0 | Approved | PMO |
| KX-DDC24-PM-IMPLPLAN-001 | [Implementation Plan](KX-DDC24-PM-IMPLPLAN-001_VI.md) | 1.0 | Approved | PM+Leads |
| KX-DDC24-QA-DOCCTRL-001 | [Document Control & Naming](KX-DDC24-QA-DOCCTRL-001_VI.md) | 1.0 | Approved | QA |
| KX-DDC24-QA-REGISTER-001 | Master Register (file này) | 1.0 | Approved | QA |
| KX-DDC24-QA-TRACE-001 | [Traceability Matrix](KX-DDC24-QA-TRACE-001_VI.md) | 1.0 | Draft | QA |
| KX-DDC24-QA-CHANGELOG | [CHANGELOG](../../CHANGELOG.md) | 0.3.0 | Active | QA |

## 2. Yêu cầu (01_requirements) — legacy ở `../` và `spec/`
| ID | Tài liệu | Legacy file | Ver | Trạng thái |
|----|----------|-------------|:---:|:----------:|
| KX-DDC24-SYS-SPEC-001 | Product Requirements | [PRD_MK-DDC-24_VI](../../PRD_MK-DDC-24_VI.md) | 1.0 | Approved |
| KX-DDC24-SYS-SPEC-002 | System Requirements | [SRS_MK-DDC-24_VI](../../SRS_MK-DDC-24_VI.md) | 1.0 | Approved |
| KX-DDC24-SYS-SPEC-003 | Datasheet (Modbus map §4.1) | [DS_MK-DDC-24_VI](../../DS_MK-DDC-24_VI.md) | 2.1 | Approved |
| KX-DDC24-HW-SPEC-001 | Hardware Spec | [HW_SPEC_MK-DDC-24_VI](../../HW_SPEC_MK-DDC-24_VI.md) | 1.0 | Approved |
| KX-DDC24-FW-SPEC-001 | FW Requirements | [spec/FW_REQUIREMENTS](../../spec/FW_REQUIREMENTS_MK-DDC-24_VI.md) | 1.0 | In-Review |
| KX-DDC24-SW-SPEC-001 | SW Requirements | [spec/SW_REQUIREMENTS](../../spec/SW_REQUIREMENTS_MK-DDC-24_VI.md) | 1.0 | In-Review |

## 3. Kiến trúc (02_architecture) — `spec/`
| ID | Tài liệu | Legacy file | Ver | Trạng thái |
|----|----------|-------------|:---:|:----------:|
| KX-DDC24-FW-ARCH-001 | FW Architecture | [spec/FW_ARCH_SPEC](../../spec/FW_ARCH_SPEC_MK-DDC-24_VI.md) | 1.0 | In-Review |
| KX-DDC24-SW-ARCH-001 | SW Architecture | [spec/SW_ARCH_SPEC](../../spec/SW_ARCH_SPEC_MK-DDC-24_VI.md) | 1.0 | In-Review |
| KX-DDC24-IF-ICD-001 | IOP Interface (SOM↔MCU) | [spec/SWFW_INTERFACE_SPEC](../../spec/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md) | 1.0 | In-Review |
| KX-DDC24-PM-PLAN-002 | Design Plan SW/FW | [spec/DESIGN_PLAN_SWFW](../../spec/DESIGN_PLAN_SWFW_MK-DDC-24_VI.md) | 1.0 | Draft |
| KX-DDC24-QA-RPT-001 | Design Readiness Review | [spec/DESIGN_READINESS_REVIEW](../../spec/DESIGN_READINESS_REVIEW_MK-DDC-24_VI.md) | 1.0 | Approved |
| KX-DDC24-QA-LOG-001 | Open Issues / Decision Log | [spec/OPEN_ISSUES](../../spec/OPEN_ISSUES_MK-DDC-24_VI.md) | — | Active |
| — | Spec Reading Guide | [spec/README](../../spec/README.md) | 1.0 | Active |

## 4. Thiết kế chi tiết (03_design) — `design/`
| ID | Tài liệu | Legacy file | Ver | Trạng thái |
|----|----------|-------------|:---:|:----------:|
| KX-DDC24-FW-DDD-001 | FW Detailed Design | [FW_DDD](../../design/firmware/FW_DDD_MK-DDC-24_VI.md) | 1.0 | Draft |
| KX-DDC24-SW-DDD-001 | SW Detailed Design | [SW_DDD](../../design/software/SW_DDD_MK-DDC-24_VI.md) | 1.0 | Draft |
| KX-DDC24-FW-DDD-002 | Pinout Master (D-1) | [FW_PINOUT_MASTER](../../design/firmware/FW_PINOUT_MASTER_MK-DDC-24_VI.md) | 1.0 | Draft |
| KX-DDC24-FW-DDD-010 | Module iop_comm | [FW_MOD_IOP_COMM](../../design/firmware/FW_MOD_IOP_COMM_MK-DDC-24_VI.md) | 1.0 | Draft |
| KX-DDC24-FW-DDD-011 | Module io_sample | [FW_MOD_IO_SAMPLE](../../design/firmware/FW_MOD_IO_SAMPLE_MK-DDC-24_VI.md) | 1.0 | Draft |
| KX-DDC24-FW-DDD-012 | Module ao_do | [FW_MOD_AO_DO](../../design/firmware/FW_MOD_AO_DO_MK-DDC-24_VI.md) | 1.0 | Draft |
| KX-DDC24-FW-DDD-013 | Module diag_wdg | [FW_MOD_DIAG_WDG](../../design/firmware/FW_MOD_DIAG_WDG_MK-DDC-24_VI.md) | 1.0 | Draft |
| KX-DDC24-OPS-DDD-001 | FW Bootloader/OTA (D-7 MCU) | [FW_BOOTLOADER_OTA](../../design/firmware/FW_BOOTLOADER_OTA_MK-DDC-24_VI.md) | 1.0 | Draft |
| KX-DDC24-BE-DDD-001 | io-driver | [SW_IODRIVER_DESIGN](../../design/software/SW_IODRIVER_DESIGN_MK-DDC-24_VI.md) | 1.0 | Draft |
| KX-DDC24-BE-DDD-002 | PLC Engine (D-6) | [SW_PLC_ENGINE_DESIGN](../../design/software/SW_PLC_ENGINE_DESIGN_MK-DDC-24_VI.md) | 1.0 | Draft |
| KX-DDC24-BE-DDD-003 | BACnet | [SW_BACNET_DESIGN](../../design/software/SW_BACNET_DESIGN_MK-DDC-24_VI.md) | 1.0 | Draft |
| KX-DDC24-BE-DDD-004 | Agent (MQTT/REST/Modbus) | [SW_AGENT_DESIGN](../../design/software/SW_AGENT_DESIGN_MK-DDC-24_VI.md) | 1.0 | Draft |
| KX-DDC24-FE-DDD-001 | Web IDE (backend+SPA) | [SW_WEBIDE_DESIGN](../../design/software/SW_WEBIDE_DESIGN_MK-DDC-24_VI.md) | 1.0 | Draft |
| KX-DDC24-BE-DDD-005 | HMI | [SW_HMI_DESIGN](../../design/software/SW_HMI_DESIGN_MK-DDC-24_VI.md) | 1.0 | Draft |
| KX-DDC24-OPS-DDD-002 | OTA (D-7 SOM) | [SW_OTA_DESIGN](../../design/software/SW_OTA_DESIGN_MK-DDC-24_VI.md) | 1.0 | Draft |
| KX-DDC24-SEC-DDD-001 | Security/Key-store (D-11) | [SW_SECURITY_KEYSTORE](../../design/software/SW_SECURITY_KEYSTORE_MK-DDC-24_VI.md) | 1.0 | Draft |

### Interfaces (ICD) — `design/interfaces/`
| ID | Tài liệu | Legacy file | Ver | Trạng thái |
|----|----------|-------------|:---:|:----------:|
| KX-DDC24-IF-ICD-002 | Modbus Register Map (D-2) | [MODBUS_REGISTER_MAP](../../design/interfaces/MODBUS_REGISTER_MAP_MK-DDC-24_VI.md) | 1.0 | Draft |
| KX-DDC24-IF-ICD-003 | BACnet PICS/EPICS (D-3) | [BACNET_PICS_EPICS](../../design/interfaces/BACNET_PICS_EPICS_MK-DDC-24_VI.md) | 1.0 | Draft |
| KX-DDC24-IF-ICD-004 | REST OpenAPI (D-4) | [REST_API_OPENAPI](../../design/interfaces/REST_API_OPENAPI_MK-DDC-24_VI.md) + [openapi.yaml](../../design/interfaces/openapi.yaml) | 1.0 | Draft |
| KX-DDC24-IF-ICD-005 | Config JSON Schema (D-5) | [CONFIG_SCHEMA](../../design/interfaces/CONFIG_SCHEMA_MK-DDC-24_VI.md) | 1.0 | Draft |

### Coding standards / hỗ trợ (05_implementation)
| ID | Tài liệu | Legacy file | Ver | Trạng thái |
|----|----------|-------------|:---:|:----------:|
| KX-DDC24-FW-STD-001 | FW Coding Standard | [FW_CODING_STANDARD](../../design/firmware/FW_CODING_STANDARD_MK-DDC-24_VI.md) | 1.0 | Approved |
| KX-DDC24-SW-STD-001 | SW Coding Standard | [SW_CODING_STANDARD](../../design/software/SW_CODING_STANDARD_MK-DDC-24_VI.md) | 1.0 | Approved |
| KX-DDC24-PM-STD-001 | Getting Started Dev | [GETTING_STARTED_DEV](../../design/GETTING_STARTED_DEV.md) | 1.0 | Active |
| — | DDD Template | [_templates/TEMPLATE_DDD](../../design/_templates/TEMPLATE_DDD.md) | — | Active |

## 5. UI/UX (04_uiux) — `docs/04_uiux/`
| ID | Tài liệu | Ver | Trạng thái |
|----|----------|:---:|:----------:|
| KX-DDC24-UX-SYSTEM-001 | [Design System](../04_uiux/KX-DDC24-UX-SYSTEM-001_VI.md) | 1.0 | Draft |
| KX-DDC24-UX-WEBIDE-001 | [Web IDE UI/UX](../04_uiux/KX-DDC24-UX-WEBIDE-001_VI.md) | 1.0 | Draft |
| KX-DDC24-UX-HMI-001 | [HMI TFT UI](../04_uiux/KX-DDC24-UX-HMI-001_VI.md) | 1.0 | Draft |

## 6. Kiểm thử (06_verification)
| ID | Tài liệu | Legacy file | Ver | Trạng thái |
|----|----------|-------------|:---:|:----------:|
| KX-DDC24-TST-SPEC-001 | Test Specification | [spec/TEST_SPEC](../../spec/TEST_SPEC_MK-DDC-24_VI.md) | 1.0 | In-Review |

## 7. Phần cứng (07_hardware) — `hardware-design/`
| ID | Tài liệu | Legacy file |
|----|----------|-------------|
| KX-DDC24-HW-SPEC-010 | SOM Radxa CM3 | [SOM_SPEC_RADXA_CM3](../../hardware-design/01_som/SOM_SPEC_RADXA_CM3.md) |
| KX-DDC24-HW-SPEC-011 | Carrier block/schematic | [CB_BLOCK_DIAGRAM](../../hardware-design/02_carrier_board/CB_BLOCK_DIAGRAM.md), [CB_SCHEMATIC_NOTES](../../hardware-design/02_carrier_board/CB_SCHEMATIC_NOTES.md) |
| KX-DDC24-HW-SPEC-012 | I/O subsystem (DI/DO/UI/AO) | [IO_*](../../hardware-design/03_io_subsystem/) |
| KX-DDC24-HW-SPEC-013 | Power | [PWR_DESIGN](../../hardware-design/04_power_supply/PWR_DESIGN.md) |
| KX-DDC24-HW-SPEC-014 | MCU/IO | [MCU_STM32G0_SPEC](../../hardware-design/05_mcu_io/MCU_STM32G0_SPEC.md) |
| KX-DDC24-HW-REG-001 | BOM | [BOM_MK-DDC-24_v1](../../hardware-design/06_bom/BOM_MK-DDC-24_v1.md) |
| KX-DDC24-HW-RPT-001 | EMC/Thermal | [EMC_THERMAL_NOTES](../../hardware-design/07_emc_thermal/EMC_THERMAL_NOTES.md) |

---
## Revision History
| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 1.0 | 2026-05-30 | QA/PMO | Phát hành đầu — đăng ký toàn bộ 50+ tài liệu, cấp Document ID |
