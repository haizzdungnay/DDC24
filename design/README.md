# MK-DDC-24 — Hồ sơ Thiết kế Chi tiết (`design/`)
## Detailed Design Dossier — Software & Firmware

> **Phiên bản:** 1.0 | 2026-05-30
> **Theo kế hoạch:** [spec/DESIGN_PLAN_SWFW](../spec/DESIGN_PLAN_SWFW_MK-DDC-24_VI.md)
> 📘 **Cổng vào tài liệu:** [spec/README](../spec/README.md)

Thư mục này chứa **tài liệu thiết kế chi tiết** (chuyển từ yêu cầu/kiến trúc sang mức implement). Tài liệu yêu cầu & kiến trúc nằm ở [`../spec/`](../spec/); phần cứng ở [`../hardware-design/`](../hardware-design/).

> 🧭 Cổng quản lý ISO (plan/register/UI-UX/changelog): [docs/README](../docs/README.md) · Lộ trình code: [Implementation Plan](../docs/00_management/KX-DDC24-PM-IMPLPLAN-001_VI.md) · Giao diện: [UI/UX](../docs/04_uiux/).

---

## 1. Trạng thái Deliverable

Hợp lệ: ✅ xong · 🔄 đang làm · ⬜ chưa bắt đầu

**Onboarding:** [GETTING_STARTED_DEV](GETTING_STARTED_DEV.md) ✅ — đọc đầu tiên nếu mới vào dự án.

### Nền tảng (DP-0)
| ID | Tài liệu | Trạng thái |
|----|----------|:----------:|
| — | [_templates/TEMPLATE_DDD](_templates/TEMPLATE_DDD.md) | ✅ |
| D-1 | [firmware/FW_PINOUT_MASTER](firmware/FW_PINOUT_MASTER_MK-DDC-24_VI.md) | ✅ |
| D-2 | [interfaces/MODBUS_REGISTER_MAP](interfaces/MODBUS_REGISTER_MAP_MK-DDC-24_VI.md) | ✅ |
| — | [firmware/FW_CODING_STANDARD](firmware/FW_CODING_STANDARD_MK-DDC-24_VI.md) | ✅ |
| — | [software/SW_CODING_STANDARD](software/SW_CODING_STANDARD_MK-DDC-24_VI.md) | ✅ |
| — | [firmware/FW_DDD](firmware/FW_DDD_MK-DDC-24_VI.md) | ✅ |
| — | [software/SW_DDD](software/SW_DDD_MK-DDC-24_VI.md) | ✅ |

### Interfaces (DP-1)
| ID | Tài liệu | Trạng thái |
|----|----------|:----------:|
| D-3 | [interfaces/BACNET_PICS_EPICS](interfaces/BACNET_PICS_EPICS_MK-DDC-24_VI.md) | ✅ |
| D-4 | [interfaces/REST_API_OPENAPI](interfaces/REST_API_OPENAPI_MK-DDC-24_VI.md) + [openapi.yaml](interfaces/openapi.yaml) | ✅ |
| D-5 | [interfaces/CONFIG_SCHEMA](interfaces/CONFIG_SCHEMA_MK-DDC-24_VI.md) | ✅ |
| D-7 | [software/SW_OTA_DESIGN](software/SW_OTA_DESIGN_MK-DDC-24_VI.md) + [firmware/FW_BOOTLOADER_OTA](firmware/FW_BOOTLOADER_OTA_MK-DDC-24_VI.md) | ✅ |

### Module/Service design (DP-2)
| ID | Tài liệu | Trạng thái |
|----|----------|:----------:|
| D-6 | [software/SW_PLC_ENGINE_DESIGN](software/SW_PLC_ENGINE_DESIGN_MK-DDC-24_VI.md) | ✅ |
| D-11 | [software/SW_SECURITY_KEYSTORE](software/SW_SECURITY_KEYSTORE_MK-DDC-24_VI.md) | ✅ |
| FW | [FW_MOD_IOP_COMM](firmware/FW_MOD_IOP_COMM_MK-DDC-24_VI.md) · [FW_MOD_IO_SAMPLE](firmware/FW_MOD_IO_SAMPLE_MK-DDC-24_VI.md) · [FW_MOD_AO_DO](firmware/FW_MOD_AO_DO_MK-DDC-24_VI.md) · [FW_MOD_DIAG_WDG](firmware/FW_MOD_DIAG_WDG_MK-DDC-24_VI.md) | ✅ |
| SW | [SW_IODRIVER](software/SW_IODRIVER_DESIGN_MK-DDC-24_VI.md) · [SW_BACNET](software/SW_BACNET_DESIGN_MK-DDC-24_VI.md) · [SW_AGENT](software/SW_AGENT_DESIGN_MK-DDC-24_VI.md) · [SW_WEBIDE](software/SW_WEBIDE_DESIGN_MK-DDC-24_VI.md) · [SW_HMI](software/SW_HMI_DESIGN_MK-DDC-24_VI.md) | ✅ |

> **Toàn bộ bộ thiết kế SW/FW đã hoàn tất** (DP-0→DP-2). Bước kế: review DR-3/DR-4, rồi vào code.
> D-8/D-9/D-10 (cơ khí, schematic/PCB, thermal) thuộc track phần cứng → [`../hardware-design/`](../hardware-design/).

---

## 2. Đọc theo vai trò

- **Firmware:** `FW_PINOUT_MASTER` → `FW_CODING_STANDARD` → `FW_DDD` → (module designs).
- **Software:** `SW_CODING_STANDARD` → `SW_DDD` → `interfaces/*` → (service designs).
- **Tích hợp (BMS/SCADA):** `interfaces/MODBUS_REGISTER_MAP`, `BACNET_PICS_EPICS`, `REST_OPENAPI`.

## 3. Nguyên tắc
- Mỗi tài liệu theo **template IEEE 1016** (xem `_templates/`).
- Mỗi design unit có cột **Trace REQ**; cập nhật `../spec/TEST_SPEC §5`.
- Interface (D-1…D-5) là **hợp đồng** — đổi phải qua DR gate + version bump.

---
**Rev** 1.0 | 2026-05-30
