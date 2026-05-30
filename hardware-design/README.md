# MK-DDC-24 — Hardware Design Documentation

> **SOM:** Radxa CM3 (Rockchip RK3566, Quad-core A55 @ 1.8GHz, **2GB LPDDR4**)  
> **MCU:** STM32G0B1RBT6 (3×SPI, 2×DMA, 144KB SRAM)  
> **Phiên bản:** HW-DES v1.1 | 2026-05-30  
> **Trạng thái:** Draft for Review (đã đồng bộ kiến trúc sau review — xem spec/DESIGN_READINESS_REVIEW)  
> **Tổ chức:** KINEXUS Technologies — Hardware Team

---

## Cấu trúc Thư mục

```
hardware-design/
├── README.md                        ← File này (index)
├── 01_som/
│   └── SOM_SPEC_RADXA_CM3.md       ← Thông số CM3, lý do chọn, ràng buộc, pin mapping (§3)
├── 02_carrier_board/
│   ├── CB_BLOCK_DIAGRAM.md         ← Block diagram tổng thể carrier board
│   └── CB_SCHEMATIC_NOTES.md       ← Ghi chú thiết kế mạch (design guidelines)
├── 03_io_subsystem/
│   ├── IO_UI_CIRCUIT.md            ← Universal Input (8 kênh) circuit design
│   ├── IO_DI_CIRCUIT.md            ← Digital Input (8 kênh) opto-isolated
│   ├── IO_AO_CIRCUIT.md            ← Analog Output (4 kênh) 0–10V / 4–20mA
│   └── IO_DO_RELAY.md              ← Digital Output / Relay SPDT 5A
├── 04_power_supply/
│   └── PWR_DESIGN.md               ← 24VAC/VDC → 5V SOM → 3.3V/1.8V
├── 05_mcu_io/
│   └── MCU_STM32G0_SPEC.md         ← MCU real-time I/O: STM32G0B1RB
├── 06_bom/
│   └── BOM_MK-DDC-24_v1.md        ← Bill of Materials phiên bản 1
└── 07_emc_thermal/
    └── EMC_THERMAL_NOTES.md        ← EMC design, nhiệt độ, giải nhiệt CM3
```

---

## Kiến trúc Tổng thể

```
                 ┌──────────────────────────────────────────────┐
                 │              CARRIER BOARD MK-DDC-24          │
                 │                                              │
  24VAC/VDC ────►│ [Power Supply]                               │
                 │   24V→5V (DC/DC) → CM3                      │
                 │   24V→3.3V (LDO) → MCU, peripherals         │
                 │                                              │
  RJ-45 ─────────►│ [Ethernet] ──────────────────► CM3 GMAC    │
                 │                                              │
  RS-485 A/B ───►│ [MAX13487E] ─── UART4 ──────► CM3           │
                 │  (BACnet MS/TP / Modbus RTU)                │
                 │                                              │
  USB-C ─────────►│ [USB OTG] ──────────────────► CM3          │
  USB-A ─────────►│ [USB 2.0 Host] ─────────────► CM3          │
                 │                                              │
                 │ ┌──────────────────────────────────────────┐ │
                 │ │          Radxa CM3  (55×40mm)            │ │
                 │ │ RK3566 Quad-core A55 @ 1.8GHz           │ │
                 │ │ 2GB LPDDR4 | 8GB eMMC | GbE PHY        │ │
                 │ │ Debian 12 + PREEMPT_RT                  │ │
                 │ └───────────────┬──────────────────────────┘ │
                 │                 │ UART2 921600 baud (IOP)     │
                 │ ┌───────────────▼──────────────────────────┐ │
                 │ │     STM32G0B1RB MCU (FreeRTOS)           │ │
                 │ │  SPI3→ADS131M08 24-bit×8 | SPI1→DAC8554 │ │
                 │ │     GPIO relay × 4 | DI opto × 8        │ │
                 │ └──┬────────┬──────────┬───────────────────┘ │
                 │    │        │           │                     │
                 │ [ADC   ] [DAC SPI ] [GPIO ]                  │
                 │    │      ADS131M08     │                     │
                 │    │        │           │                     │
  UI1-UI8 ───────►│ [Input   ] [AO1-AO4]  [DO relay 1-4]       │
  DI1-DI8 ───────►│ [Opto DI ]            [DO relay LED]◄────── │
                 │                                              │
  microSD ───────►│ [SD slot] ──────────► CM3 SDMMC            │
  DIP×8 ─────────►│ [DIP SW] ──────────► CM3 GPIO              │
                 └──────────────────────────────────────────────┘
```

---

## Tài liệu Liên quan

| File | Mô tả |
|------|-------|
| [../DS_MK-DDC-24_VI.md](../DS_MK-DDC-24_VI.md) | Data Sheet sản phẩm |
| [../HW_SPEC_MK-DDC-24_VI.md](../HW_SPEC_MK-DDC-24_VI.md) | Hardware Specification (top-level) |
| [../SRS_MK-DDC-24_VI.md](../SRS_MK-DDC-24_VI.md) | Software Requirements |
| [../PRD_MK-DDC-24_VI.md](../PRD_MK-DDC-24_VI.md) | Product Requirements |

---

## Lịch sử Revision

| Ngày | Rev | Thay đổi |
|------|-----|---------|
| 2026-05-27 | v1.0 | Khởi tạo — kiến trúc Radxa CM3 2GB + STM32G071 (part gốc) |
| 2026-05-30 | v1.1 | Đồng bộ sau Design-Readiness Review: **MCU → STM32G0B1RBT6**; **MCU là master duy nhất ADS131M08 (SPI3)**, CM3 SPI0→TFT; pinout MCU chuẩn (DI=PB4–11, DO=PC0–3); +15V rail; MCU-OTA UART bootloader Ver1; bỏ index SOM_PINMAP rời |
