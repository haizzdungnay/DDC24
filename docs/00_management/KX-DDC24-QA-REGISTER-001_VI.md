# Master Document Register — MK-DDC-24
## Danh mục kiểm soát toàn bộ tài liệu

> **⚠ Register này đã lỗi thời — kiểm 2026-08-08.** 23 liên kết trong tài liệu trỏ
> tới file **không tồn tại** trong corpus hiện tại: `CANONICAL_DECISIONS.md`, cụm
> `05_devguides/`, cụm `hardware-design/` ở gốc repo, `KX-DDC24-QA-DOCCTRL/ISOGAP/
> TRACE/SYS-ARCH-001_VI.md`, và ba ADR rời `ADR-015/016/019` (chỉ tồn tại dưới dạng
> dòng trong [Decision Log](../00_governance/DECISIONS.md)). Nguyên nhân: các đợt
> hợp nhất tài liệu và `PLAN-ARCH-RESTRUCT-002` diễn ra sau bản 1.4 (2026-07-15).
>
> **Register điều hành hiện hành là [Document Hub](../README.md) +
> [Document Control](../00_governance/CONTROL.md).** Dùng file này chỉ để truy
> nguyên lịch sử, cho tới khi nó được dựng lại từ cây tài liệu thật.

> **Document ID:** KX-DDC24-QA-REGISTER-001
> **Phiên bản:** 1.4 | 2026-07-15 · **Trạng thái:** In-Review · **Owner:** QA/PMO
> **Phê duyệt 2026-06-08 (Owner):** các tài liệu KHÔNG có banner RECONCILE/SUPERSEDED → `Approved (Owner 2026-06-08)`
> (owner sign-off, không thay cho design-review gate DR-1..DR-4 từng môn). Tài liệu CÓ banner →
> `Needs Reconciliation` (chưa được duyệt cho tới khi nội dung khớp [CANONICAL_DECISIONS](../CANONICAL_DECISIONS.md)).
> **Chuẩn:** ISO 9001:2015 §7.5.3 (kiểm soát thông tin dạng văn bản)
> 📘 [docs/README](../README.md) · Quy tắc ID/tên: [DOC_CONTROL](KX-DDC24-QA-DOCCTRL-001_VI.md)

> Đây là "sổ cái" tài liệu: mọi file đều có **Document ID, lĩnh vực, version, trạng thái, owner**. Khi thêm/đổi tài liệu → cập nhật bảng này + [CHANGELOG](../../CHANGELOG.md).
> Cột **Legacy file** giữ tên cũ (không đổi để tránh gãy link); cột **ID** là mã ISO mới.

### Bộ trạng thái (status vocabulary)

| Status | Nghĩa |
|--------|-------|
| **Canonical** | Nguồn-chuẩn — mâu thuẫn thì theo nó (Product Definition, Canonical Decisions, REVA_SCOPE) |
| **Active** | Đang hiệu lực, đúng hướng Rev A |
| **Approved / In-Review / Draft** | Trạng thái duyệt thông thường |
| **Needs Reconciliation** | Đã duyệt nhưng **nội dung còn lệch hướng mới** (có banner RECONCILE) — ⚠️ nguy hiểm hơn Draft |
| **Superseded** | Bị thay bằng tài liệu khác (giữ tham chiếu lịch sử) |
| **Legacy Reference** | Chỉ đọc tham chiếu, không dùng cho Rev A |
| **Deferred Rev B / Rev C** | Đúng nhưng phạm vi ở Rev sau |

> ⚠️ **Một tài liệu `Approved` nhưng sai hướng còn hại hơn `Draft`.** Tài liệu có banner RECONCILE
> được coi là **Needs Reconciliation** cho tới khi nội dung được sửa khớp [CANONICAL_DECISIONS](../CANONICAL_DECISIONS.md).

---

## 1. Quản lý (00_management)
| ID | Tài liệu | Ver | Trạng thái | Owner |
|----|----------|:---:|:----------:|-------|
| KX-DDC24-DEC-CANON-001 | [Canonical Decisions](../CANONICAL_DECISIONS.md) | 1.1 | **Canonical** | Architect |
| KX-DDC24-SYS-ARCH-001 | [System Handbook (hiểu hệ thống từ số 0)](KX-DDC24-SYS-ARCH-001_VI.md) | 1.0 | **Needs Reconciliation** | System Architect |
| KX-DDC24-PM-OVERVIEW-001 | [Project Overview](KX-DDC24-PM-OVERVIEW-001_VI.md) | 1.0 | **Needs Reconciliation** | PMO |
| KX-DDC24-PM-IMPLPLAN-001 | [Implementation Plan](KX-DDC24-PM-IMPLPLAN-001_VI.md) | 1.1 | **Active** | PM+Leads |
| KX-DDC24-QA-DOCCTRL-001 | [Document Control & Naming](KX-DDC24-QA-DOCCTRL-001_VI.md) | 1.0 | Approved | QA |
| KX-DDC24-QA-REGISTER-001 | Master Register (file này) | 1.4 | In-Review | QA |
| KX-DDC24-QA-TRACE-001 | [Traceability Matrix](KX-DDC24-QA-TRACE-001_VI.md) | 1.0 | Approved (Owner 2026-06-08) | QA |
| KX-DDC24-QA-ISOGAP-001 | [ISO Gap Assessment & Restructure Plan](KX-DDC24-QA-ISOGAP-001_VI.md) | 1.0 | Approved (Owner 2026-06-08) | QA |
| KX-DDC24-QA-CHANGELOG | [CHANGELOG](../../CHANGELOG.md) | 0.3.0 | Active | QA |

### Quyết định kiến trúc (ADR) — `docs/adr/`
| ID | Tài liệu | Ver | Trạng thái |
|----|----------|:---:|:----------:|
| ADR-001 | [ADC AVDD/VREF noise measurement contract](../adr/ADR-001-adc-avdd-noise-measurement-contract.md) | — | Accepted |
| ADR-002 | [Clock harmonics / GND boundary contract](../adr/ADR-002-clock-harmonics-gnd-boundary-contract.md) | — | Accepted |
| ADR-003 | [EMC pre-compliance measurement boundary](../adr/ADR-003-emc-pre-compliance-measurement-boundary-readiness-contract.md) | — | Accepted |
| ADR-004 | [Component-based runtime (drop IEC 61131-3)](../adr/ADR-004-component-based-runtime.md) | — | Accepted |
| ADR-005 | [Three-process architecture + mkddc naming](../adr/ADR-005-three-process-architecture.md) | — | Accepted |
| ADR-006 | [Rev A UI = form/JSON](../adr/ADR-006-rev-a-ui-form-json.md) | — | Accepted |
| ADR-007 | [Web stack Go](../adr/ADR-007-web-stack-go.md) | — | Accepted |
| ADR-008 | [BMS Edge positioning + Rev A component set 24→28](../adr/ADR-008-bms-edge-positioning-and-revA-component-set.md) | — | Accepted |
| ADR-009 | [ISA-101 HMI and navigation restructure](../adr/ADR-009-isa101-hmi-and-nav-restructure.md) | — | Accepted |
| ADR-010 | [IOP v2 poll + capability map](../adr/ADR-010-iop-v2-poll-capability-map.md) | — | Accepted |
| ADR-011 | [BACnet reliability/quality mapping](../adr/ADR-011-bacnet-reliability-quality-mapping.md) | — | Accepted |
| ADR-012 | [AO channel config model](../adr/ADR-012-ao-channel-config-model.md) | — | Accepted |
| ADR-015 | [Privileged system config apply](../adr/ADR-015-privileged-system-config-apply.md) | — | Accepted |
| ADR-016 | [Time authority model](../adr/ADR-016-time-authority-model.md) | — | Accepted |
| ADR-017 | [Settings/Network tabs and state contract](../adr/ADR-017-settings-network-tabs-and-state-contract.md) | — | Accepted |
| ADR-018 | [SQLite block historian + scheduled per-point policy](../adr/ADR-018-sqlite-block-historian.md) | 1.1 | Accepted |
| ADR-019 | [Independent global point tag/name namespaces](../adr/ADR-019-global-point-tag-namespace.md) | 1.1 | Accepted |

## 2. Yêu cầu (01_specs)
| ID | Tài liệu | Legacy file | Ver | Trạng thái |
|----|----------|-------------|:---:|:----------:|
| KX-DDC24-SYS-SPEC-001 | Product Requirements | [PRD_MK-DDC-24_VI](../01_specs/PRD_MK-DDC-24_VI.md) | 2.0 | **Needs Reconciliation** |
| KX-DDC24-SYS-SPEC-002 | System Requirements | [SRS_MK-DDC-24_VI](../01_specs/SRS_MK-DDC-24_VI.md) | 2.0 | **Needs Reconciliation** |
| KX-DDC24-SYS-SPEC-003 | Datasheet | [DS_MK-DDC-24_VI](../01_specs/DS_MK-DDC-24_VI.md) | 3.0 | **Needs Reconciliation** |
| KX-DDC24-HW-SPEC-001 | Hardware Spec | [HW_SPEC_MK-DDC-24_VI](../01_specs/HW_SPEC_MK-DDC-24_VI.md) | 2.0 | In-Review |
| KX-DDC24-SYS-DEF-001 | Product Definition (BMS Edge, component-based) | [PRODUCT_DEFINITION](../01_specs/PRODUCT_DEFINITION_MK-DDC-24_VI.md) | 2.0 | **Canonical** |
| KX-DDC24-PM-SCOPE-001 | Rev A Scope & 90-day Roadmap | [REVA_SCOPE_ROADMAP](../01_specs/REVA_SCOPE_ROADMAP_MK-DDC-24_VI.md) | 1.3 | **Canonical** |
| KX-DDC24-PM-STRATEGY-001 | BMS Edge Strategy (định vị/cạnh tranh) | [BMS_EDGE_STRATEGY](../01_specs/BMS_EDGE_STRATEGY_MK-DDC-24_VI.md) | 1.0 | Active |
| KX-DDC24-FW-SPEC-001 | FW Requirements | [FW_REQUIREMENTS](../01_specs/FW_REQUIREMENTS_MK-DDC-24_VI.md) | 2.0 | In-Review |
| KX-DDC24-SW-SPEC-001 | SW Requirements | [SW_REQUIREMENTS](../01_specs/SW_REQUIREMENTS_MK-DDC-24_VI.md) | 1.0 | **Needs Reconciliation** |

## 3. Kiến trúc (gộp trong `docs/01_specs/`)
| ID | Tài liệu | Legacy file | Ver | Trạng thái |
|----|----------|-------------|:---:|:----------:|
| KX-DDC24-FW-ARCH-001 | FW Architecture | [FW_ARCH_SPEC](../01_specs/FW_ARCH_SPEC_MK-DDC-24_VI.md) | 2.0 | In-Review |
| KX-DDC24-SW-ARCH-001 | SW Architecture | [SW_ARCH_SPEC](../01_specs/SW_ARCH_SPEC_MK-DDC-24_VI.md) | 1.0 | **Needs Reconciliation** |
| KX-DDC24-IF-ICD-001 | IOP v1 Interface (SOM↔MCU) | [SWFW_INTERFACE_SPEC](../01_specs/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md) | 1.2 | Superseded by ADR-010/shared header |
| KX-DDC24-PM-PLAN-002 | Design Plan SW/FW | [DESIGN_PLAN_SWFW](../01_specs/DESIGN_PLAN_SWFW_MK-DDC-24_VI.md) | 1.0 | Approved (Owner 2026-06-08) |
| KX-DDC24-QA-RPT-001 | Design Readiness Review | [DESIGN_READINESS_REVIEW](../01_specs/DESIGN_READINESS_REVIEW_MK-DDC-24_VI.md) | 1.0 | Approved |
| KX-DDC24-QA-LOG-001 | Open Issues / Decision Log | [OPEN_ISSUES](../01_specs/OPEN_ISSUES_MK-DDC-24_VI.md) | — | Active |
| — | Spec Reading Guide | [README](../01_specs/README.md) | 1.0 | Active |

## 4. Thiết kế chi tiết (`docs/02_design/`)
| ID | Tài liệu | Legacy file | Ver | Trạng thái |
|----|----------|-------------|:---:|:----------:|
| KX-DDC24-FW-DDD-001 | FW Detailed Design | [FW_DDD](../02_design/firmware/FW_DDD_MK-DDC-24_VI.md) | 2.0 | In-Review |
| KX-DDC24-SW-DDD-001 | SW Detailed Design | [SW_DDD](../02_design/software/SW_DDD_MK-DDC-24_VI.md) | 1.2 | **Needs Reconciliation** |
| KX-DDC24-FW-DDD-002 | Pinout Master (D-1) | [FW_PINOUT_MASTER](../02_design/firmware/FW_PINOUT_MASTER_MK-DDC-24_VI.md) | 1.0 | Approved (Owner 2026-06-08) |
| KX-DDC24-FW-DDD-010 | Module iop_comm | [FW_MOD_IOP_COMM](../02_design/firmware/FW_MOD_IOP_COMM_MK-DDC-24_VI.md) | 1.0 | Approved (Owner 2026-06-08) |
| KX-DDC24-FW-DDD-011 | Module io_sample | [FW_MOD_IO_SAMPLE](../02_design/firmware/FW_MOD_IO_SAMPLE_MK-DDC-24_VI.md) | 1.0 | Approved (Owner 2026-06-08) |
| KX-DDC24-FW-DDD-012 | Module ao_do | [FW_MOD_AO_DO](../02_design/firmware/FW_MOD_AO_DO_MK-DDC-24_VI.md) | 1.0 | Approved (Owner 2026-06-08) |
| KX-DDC24-FW-DDD-013 | Module diag_wdg | [FW_MOD_DIAG_WDG](../02_design/firmware/FW_MOD_DIAG_WDG_MK-DDC-24_VI.md) | 1.0 | Approved (Owner 2026-06-08) |
| KX-DDC24-OPS-DDD-001 | FW Bootloader/OTA (D-7 MCU) | [FW_BOOTLOADER_OTA](../02_design/firmware/FW_BOOTLOADER_OTA_MK-DDC-24_VI.md) | 1.0 | Approved (Owner 2026-06-08) |
| KX-DDC24-BE-DDD-001 | io-driver | [SW_IODRIVER_DESIGN](../02_design/software/SW_IODRIVER_DESIGN_MK-DDC-24_VI.md) | 1.0 | Approved (Owner 2026-06-08) |
| KX-DDC24-BE-DDD-002 | Runtime Engine (D-6, component graph; lib 28 type) | [SW_RUNTIME_EXECUTION_MODEL](../02_design/software/SW_RUNTIME_EXECUTION_MODEL_MK-DDC-24_VI.md) · [SW_COMPONENT_LIBRARY](../02_design/software/SW_COMPONENT_LIBRARY_MK-DDC-24_VI.md) | 1.3 | Approved (Owner amendment 2026-07-15) |
| KX-DDC24-BE-DDD-003 | BACnet | [SW_BACNET_DESIGN](../02_design/software/SW_BACNET_DESIGN_MK-DDC-24_VI.md) | 1.0 | Approved (Owner 2026-06-08) |
| KX-DDC24-BE-DDD-004 | Agent (MQTT/REST) | [SW_AGENT_DESIGN](../02_design/software/SW_AGENT_DESIGN_MK-DDC-24_VI.md) | 1.1 | **Deferred Rev B** |
| KX-DDC24-BE-DDD-006 | Field bus (Modbus RTU master) | [SW_FIELDBUS_DESIGN](../02_design/software/SW_FIELDBUS_DESIGN_MK-DDC-24_VI.md) | 1.0 | Approved (Owner 2026-06-08) |
| KX-DDC24-FE-DDD-001 | mkddc-web (Go, form/JSON) | [ADR-006](../adr/ADR-006-rev-a-ui-form-json.md) · [ADR-007](../adr/ADR-007-web-stack-go.md) *(thay SW_WEBIDE_DESIGN đã gỡ)* | — | Active |
| KX-DDC24-BE-DDD-005 | HMI | [SW_HMI_DESIGN](../02_design/software/SW_HMI_DESIGN_MK-DDC-24_VI.md) | 2.3 | Active Rev A amendment |
| KX-DDC24-OPS-DDD-002 | OTA (D-7 SOM) | [SW_OTA_DESIGN](../02_design/software/SW_OTA_DESIGN_MK-DDC-24_VI.md) | 1.0 | **Deferred Rev B** |
| KX-DDC24-SEC-DDD-001 | Security/Key-store (D-11) | [SW_SECURITY_KEYSTORE](../02_design/software/SW_SECURITY_KEYSTORE_MK-DDC-24_VI.md) | 1.0 | Approved (Owner 2026-06-08) |

### Interfaces (ICD) — `docs/02_design/interfaces/`
| ID | Tài liệu | Legacy file | Ver | Trạng thái |
|----|----------|-------------|:---:|:----------:|
| KX-DDC24-IF-ICD-002 | Modbus RTU Master / Expansion Bus (D-2) | [MODBUS_REGISTER_MAP](../02_design/interfaces/MODBUS_REGISTER_MAP_MK-DDC-24_VI.md) | 2.0 | Approved (Owner 2026-06-08) |
| KX-DDC24-IF-ICD-003 | BACnet PICS/EPICS (D-3) | [BACNET_PICS_EPICS](../02_design/interfaces/BACNET_PICS_EPICS_MK-DDC-24_VI.md) | 1.0 | Approved (Owner 2026-06-08) |
| KX-DDC24-IF-ICD-004 | REST OpenAPI (D-4) | [REST_API_OPENAPI](../02_design/interfaces/REST_API_OPENAPI_MK-DDC-24_VI.md) + [openapi.yaml](../../contracts/openapi/openapi.yaml) | 1.3 / 1.6.0 | Approved (Owner amendment 2026-07-15) |
| KX-DDC24-IF-ICD-005 | Config JSON Schema (D-5) | [CONFIG_SCHEMA](../02_design/interfaces/CONFIG_SCHEMA_MK-DDC-24_VI.md) | 1.9 | Approved (Owner amendment 2026-07-15) |
| KX-DDC24-IF-ICD-006 | Graph Schema (graph.json) + deploy contract | [GRAPH_SCHEMA](../02_design/interfaces/GRAPH_SCHEMA_MK-DDC-24_VI.md) | 1.0 | Approved (Owner 2026-06-08) |

### Coding standards / hỗ trợ (05_devguides)
| ID | Tài liệu | Legacy file | Ver | Trạng thái |
|----|----------|-------------|:---:|:----------:|
| KX-DDC24-FW-STD-001 | FW Coding Standard | [FW_CODING_STANDARD](../02_design/firmware/FW_CODING_STANDARD_MK-DDC-24_VI.md) | 1.0 | Approved |
| KX-DDC24-SW-STD-001 | SW Coding Standard | [SW_CODING_STANDARD](../02_design/software/SW_CODING_STANDARD_MK-DDC-24_VI.md) | 1.0 | Approved |
| KX-DDC24-PM-STD-001 | Getting Started Dev | [GETTING_STARTED_DEV](../02_design/GETTING_STARTED_DEV.md) | 1.1 | Active |
| — | DDD Template | [_templates/TEMPLATE_DDD](../02_design/_templates/TEMPLATE_DDD.md) | — | Active |

## 4b. Developer Kit (05_devguides) — `docs/05_devguides/` + `shared/`
| ID | Tài liệu | Ver | Trạng thái |
|----|----------|:---:|:----------:|
| KX-DDC24-PM-REPO-001 | [Repository, Build & CI](../05_devguides/KX-DDC24-PM-REPO-001_VI.md) | 1.0 | Approved |
| KX-DDC24-FW-DEVGUIDE-001 | [FW Developer Guide & Backlog](../05_devguides/KX-DDC24-FW-DEVGUIDE-001_VI.md) | 1.0 | Approved |
| KX-DDC24-BE-DEVGUIDE-001 | [BE Developer Guide & Backlog](../05_devguides/KX-DDC24-BE-DEVGUIDE-001_VI.md) | 1.0 | **Needs Reconciliation** |
| KX-DDC24-FE-DEVGUIDE-001 | [FE Developer Guide & Backlog](../05_devguides/KX-DDC24-FE-DEVGUIDE-001_VI.md) | 1.0 | **Needs Reconciliation** |
| (code contract) | [`contracts/iop/iop_protocol.h`](../../contracts/iop/iop_protocol.h) · [`contracts/shm/kinexus_shm.h`](../../contracts/shm/kinexus_shm.h) | 1.1 / 1.0 | Active |

## 5. UI/UX (04_uiux) — `docs/04_uiux/`
| ID | Tài liệu | Ver | Trạng thái |
|----|----------|:---:|:----------:|
| KX-DDC24-UX-SYSTEM-001 | [Design System](../04_uiux/KX-DDC24-UX-SYSTEM-001_VI.md) | 1.0 | Approved (Owner 2026-06-08) |
| KX-DDC24-UX-WEBIDE-001 | UX web Rev A (form/JSON) → [ADR-006](../adr/ADR-006-rev-a-ui-form-json.md) *(thay UX-WEBIDE, đã gỡ)* | — | Superseded |
| KX-DDC24-UX-HMI-001 | [HMI TFT UI](../04_uiux/KX-DDC24-UX-HMI-001_VI.md) | 1.0 | Approved (Owner 2026-06-08) |

## 6. Kiểm thử (06_verification)
| ID | Tài liệu | Legacy file | Ver | Trạng thái |
|----|----------|-------------|:---:|:----------:|
| KX-DDC24-TST-SPEC-001 | Test Specification | [TEST_SPEC](../01_specs/TEST_SPEC_MK-DDC-24_VI.md) | 2.0 | In-Review |

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
| 1.2 | 2026-06-08 | QA/PMO | DOC-REBASE-2026-06-BMS-EDGE: +ADR-008, +BMS_EDGE_STRATEGY; Product Definition→1.1, REVA_SCOPE→1.1, SW_COMPONENT_LIBRARY→1.1 (28 type); IMPLPLAN-001 & GETTING_STARTED reconciled → Active |
| 1.3 | 2026-06-30 | QA/PMO | Registered ADR-009/010; reconciled Rev A 16 UI/no-base-DI/IOP-v2 revisions and HMI amendment; marked legacy IOP v1 spec superseded. |
| 1.4 | 2026-07-15 | QA/PMO | Registered ADR-011/012/015..019; updated Runtime, Config and REST/OpenAPI revisions for owner-approved historian scheduling and independent point display-name uniqueness. |
