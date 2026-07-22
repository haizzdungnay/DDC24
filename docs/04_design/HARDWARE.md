# Hardware Design Baseline

**ID:** HW-DES-001
**Trạng thái:** Active — release evidence incomplete
**Cập nhật:** 2026-07-22

## Kiến trúc

- SOM Radxa CM3/RK3566 chạy Linux; STM32G0B1 là real-time I/O controller.
- STM32 là SPI master duy nhất của hai ADS131M08.
- Liên kết SOM–MCU dùng isolated UART/Kinexus-IOP.
- Nguồn vào 24 VAC/VDC; release phụ thuộc calculation và bench evidence cho rail/protection/thermal.

## I/O baseline

Base SKU Rev A là 16 UI + 4 AO + 4 DO.

| Khối | Thiết kế hiện hành |
|---|---|
| UI ×16 | 0–10 V; 4–20 mA với shunt 49.9 Ω; NTC 10k/20k/configurable; auxiliary dry contact |
| UI switching | mode latch từng kênh; TMUX chỉ nằm phía low-voltage sau protection |
| AO ×4 | DAC8554; 0–10 V / 4–20 mA theo cấu hình và compliance đã kiểm chứng |
| DO ×4 | relay output; terminal protection và inductive suppression phải được evidence |
| Optional DI | true isolated DI là option riêng, không thuộc base SKU |

PT100/PT1000 không thuộc Rev A UI baseline. Không được dùng baseline split-input legacy để đặt BOM, terminal hoặc test plan.

## HMI baseline

Màn KD024QVFIA073-02-C021B/JD9852 dùng MIPI DSI một lane; touch FT5436 dùng I²C; Linux render qua DRM/KMS. Thiết kế ILI9341/SPI đã superseded.

Carrier phải chứa ranh giới điện đầy đủ cho HMI: DSI CLK±/D0±, RESET#/TE,
FT5436 SDA/SCL/INT/RST, constant-current backlight/PWM, sáu GPIO button,
ESD tại connector, FPC retention và power/thermal budget. Chưa có schematic/PCB
được release nên pin B2B, rail logic và device-tree mapping vẫn là `TBD/blocked`.

## Mức bằng chứng hiện tại

| Hạng mục | Trạng thái 2026-07-22 | Ý nghĩa |
|---|---|---|
| I/O topology + IOP/SHM contract | Đồng bộ ở mức tài liệu/header/SOM code | Chưa thay thế schematic/HIL |
| STM32 firmware | Skeleton/placeholder | Task, pin, watchdog và actuation là target design |
| Schematic/PCB KiCad | Missing | Không thể ERC/DRC, SI, pin-map hoặc manufacturing review |
| Product BOM | Preliminary/TBD | Không thể sourcing/derating/release |
| Power/EMC/thermal/AO/DO | Blocked evidence | Hardware gate RED |
| JD9852/FT5436 HMI | SW skeleton + target design | Cần schematic, DT, target panel/touch/button test |

## Design controls

- Mọi pin/net/part value phải truy về schematic/BOM/revision được phê duyệt.
- Protection, creepage/clearance, thermal, derating, tolerances và alternate source cần evidence, không chỉ narrative.
- Test point và manufacturing outputs phải khớp revision được release.
- Hardware readiness hiện RED theo [Verification](../05_verification/VERIFICATION.md); hồ sơ này không phải manufacturing release authorization.

## Detailed design

Toàn bộ thiết kế SOM, carrier, I/O, power, MCU, BOM, EMC/thermal, mechanical, bring-up, manufacturing và PCB placement được điều hướng tại [Hardware Detailed Design Index](hardware/README.md). Source specification được giữ tại [HW Specification](../01_specs/HW_SPEC_MK-DDC-24_VI.md).
