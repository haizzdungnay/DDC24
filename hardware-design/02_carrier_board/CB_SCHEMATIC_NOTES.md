# Carrier Board Schematic Notes & Design Guidelines

> **Document:** HW-DES-02-SCH | Rev 1.3 | 2026-06-23
> **Dung ket hop voi:** CB_BLOCK_DIAGRAM.md, IO_UI_CIRCUIT.md, MCU_STM32G0_SPEC.md
> **UI Rev A:** no field signal directly into mux/ADC

---

## Revision History

| Rev | Date | Changes |
|-----|------|---------|
| 1.0 | 2026-05-27 | Initial 8 UI + 8 DI architecture |
| 1.1 | 2026-06-23 | DI to UI migration, expanded 05_UI_INPUT to 16 channels |
| 1.2 | 2026-06-23 | Phase 1 cross-check updates |
| 1.3 | 2026-06-23 | UI architecture review: per-channel mode latch, protection/front-end before mux, 49.9R shunt, RTD removed from Rev A |

---

## 1. Reference Documents

| Document | Use |
|----------|-----|
| Radxa CM3 schematic/reference IO board | CM3 B2B and power reference |
| TI ADS131M08 datasheet/EVM | ADC power, SPI, reference and input guidance |
| TI TMUX1208 datasheet | Low-voltage mux constraints: signal path must stay within GND to VDD operating range |
| STM32G0B1 reference manual/design guide | MCU decoupling, boot, SPI, EXTI |
| IEC 61010-1 / IEC 61326-1 | Safety spacing and EMC basis |

---

## 2. Schematic Sheet Organization

| Sheet | Content |
|-------|---------|
| 01_TOP | Title block, hierarchy, revision history |
| 02_CM3 | Radxa CM3 B2B, CM3 decoupling, boot/reset support |
| 03_MCU | STM32G0B1, SWD, boot, clocks, mode latch interface |
| 04_POWER | 24VAC/DC input, DC/DC, LDOs, references |
| 05_UI_INPUT | 16 UI terminal protection, mode front-end, low-voltage mux/buffer, 2x ADS131M08 |
| 06_AO_OUTPUT | DAC8554 and AO output front-end |
| 07_DO_RELAY | Relay outputs and driver |
| 08_COMM | Ethernet, RS-485, USB |
| 09_PERIPHERAL | RTC, SD, DIP switch, LEDs, test points |
| 10_DI_ISOLATED_OPTION | Optional true DI isolated sheet if required by SKU |

`10_DI_ISOLATED_OPTION` is optional/product-dependent. UI dry contact must not be documented as a substitute for isolated DI.

---

## 3. CM3 Interface Checklist

- [ ] UART2_TX from CM3 crosses to STM32 USART1_RX PA10.
- [ ] UART2_RX from CM3 crosses to STM32 USART1_TX PA9.
- [ ] UART level is 3.3V CMOS; no JSON/float realtime payload is used.
- [ ] CM3 has no SPI connection to ADS131M08.
- [ ] CM3 reset/boot control of MCU is implemented only if OTA bootloader path is in scope.

---

## 4. MCU / ADC Checklist

- [ ] STM32 VDD/VDDA decoupling per datasheet, 100nF close to every supply pin.
- [ ] HSE 8MHz crystal and load caps placed close to MCU.
- [ ] SPI3 PC10/PC11/PC12 routes to both ADS131M08 devices.
- [ ] ADS #1: CS PB2, DRDY PA8.
- [ ] ADS #2: CS PA15, DRDY PA6.
- [ ] ADS #1/#2 have separate local decoupling and clean analog return.
- [ ] ADS DIN/MOSI is routed; read-only SPI is not acceptable because registers must be configured.
- [ ] ADC status words are available to firmware for `adc_status_1/2`.

---

## 5. UI Input Sheet Rules

### 5.1 Mandatory Signal Order

Every UI channel must follow this order:

```text
Terminal
-> ESD/TVS/PTC or fusible protection
-> EMC/current-limit/filter elements
-> mode-specific front-end
-> scaled low-voltage node
-> mux/buffer/filter
-> ADS131M08 input
```

A schematic that routes terminal field voltage directly to TMUX1208, any other low-voltage analog switch, or ADS input is not acceptable.

### 5.2 Per-Channel Mode Select

- [ ] Do not connect PB12/PB13/PB14 as shared SEL[2:0] to all muxes.
- [ ] Add latch/shift-register chain for `UI_MODE[0..15].S0/S1/S2`.
- [ ] Use PB12/PB13/PB14/PB15 as `UI_MODE_DATA/CLK/LATCH/OE` unless final pin review selects an equivalent mapping.
- [ ] Latch reset/default state is safe disabled.
- [ ] Mode bits are testable on at least representative channels.

### 5.3 0-10V Front-End

- [ ] Rtop = 100k 0.1% 25ppm or matched network equivalent.
- [ ] Rbot = 12.1k 0.1% 25ppm or matched network equivalent.
- [ ] Divider node at 10V is about 1.079V.
- [ ] RC filter is before the buffer.
- [ ] Rail-to-rail input/output buffer is present before ADC/mux low-voltage node.
- [ ] 24V miswire clamp and protection current are calculated.
- [ ] No +/-0.05% FS claim appears without final error budget.

### 5.4 4-20mA Front-End

- [ ] Rshunt = 49.9 Ohm, 0.1%, 25ppm/C, >=0.125W; 0.25W preferred.
- [ ] 4mA = 0.1996V, 20mA = 0.9980V, 22mA = 1.0978V, 24mA = 1.1976V.
- [ ] 24VDC miswire does not put 24V directly across the shunt indefinitely.
- [ ] PTC/fusible element and TVS/clamp path have power/current calculation.
- [ ] Firmware status covers warning at 22mA and fault/overrange at 24mA.

### 5.5 NTC Front-End

- [ ] NTC 10k B3950 is the default supported curve.
- [ ] NTC 20k or other curves require configuration or lookup table.
- [ ] Pull-up excitation is precision/ratiometric or measured by firmware.
- [ ] Do not assume CM3 PMIC 3.3V is a precision reference without measurement/compensation.
- [ ] Formula `R_ntc = R_pullup * Vadc / (Vexc - Vadc)` is valid for the chosen orientation.

### 5.6 Dry Contact Front-End

- [ ] Label as **Auxiliary Dry Contact** only.
- [ ] No 24V wet-contact support unless a dedicated compatible circuit is added.
- [ ] No isolation claim.
- [ ] Keep separate industrial DI isolated sheet/module if product requirements need true DI.

### 5.7 RTD/PT100/PT1000

- [ ] PT100/PT1000 are not populated as Universal Input Rev A modes.
- [ ] If RTD is required, create a dedicated 3-wire/4-wire RTD sheet with current source, Kelvin sense, and error budget.

---

## 6. I/O Protection Checklist

| Event | Required schematic evidence |
|-------|-----------------------------|
| 0-10V tied to 24VDC | Divider/clamp current and component power |
| 4-20mA tied to 24VDC | PTC/fuse/TVS/shunt power in fault |
| NTC short to GND | Pull-up current and ADC status |
| NTC short to 24V | Terminal protection path |
| Dry contact long cable | RC/debounce/ESD protection |
| ESD at terminal | TVS closest to connector |
| EFT/surge basic | TVS/EMC component values and return path |
| Reverse polarity | Clamp or bidirectional protection path |
| Open/short wire | Firmware-detectable state or explicit not-supported note |

---

## 7. Signal Naming Convention

| Signal type | Convention | Example |
|-------------|------------|---------|
| UI terminal field | `UIx_FIELD` | `UI1_FIELD` |
| UI protected node | `UIx_PROT` | `UI1_PROT` |
| UI low-voltage sense | `UIx_SENSE_LV` | `UI1_SENSE_LV` |
| ADC input | `ADCn_CHm_P/N` | `ADC1_CH0_P` |
| UI mode latch | `UI_MODE_x_Sy` | `UI_MODE_01_S0` |
| UART | `UART_DEVICE_DIR` | `UART_MCU_TX` |
| SPI | `SPI_DEVICE_SIG` | `SPI_ADC_CLK` |
| Relay drive | `DOx_DRV` | `DO1_DRV` |

---

## 8. Release Sign-Off

- [ ] HW Lead confirms analog front-end values and protection power.
- [ ] FW Lead confirms mode latch, sampling sequence, and signed int32 frame.
- [ ] QA confirms UI test plan and risk table are ready.
- [ ] PM confirms Rev A feature claims exclude RTD and isolated DI replacement.

---

**Document ID:** HW-DES-02-SCH | Rev 1.3 | 2026-06-23
