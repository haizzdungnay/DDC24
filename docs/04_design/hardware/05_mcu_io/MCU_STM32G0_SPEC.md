# MCU Specification - STM32G0B1RBT6

> **Document:** HW-DES-05-MCU | Rev 1.5 | 2026-07-22
> **Vai tro:** Real-time I/O controller, FreeRTOS, ADC acquisition, AO/DO control, binary IOP link to CM3
> **UI Rev A impact:** 16 UI with 2x ADS131M08 and per-channel mode latch

---

## Revision History

| Rev | Ngay | Thay doi |
|-----|------|----------|
| 1.0 | 2026-05-27 | Initial STM32G0B1RBT6 spec, 8 UI + 8 DI architecture |
| 1.1 | 2026-06-23 | DI to UI migration, PB4-PB11 repurposed, added ADS131M08 #2 pins |
| 1.2 | 2026-06-23 | Phase 1 cross-check updates |
| 1.3 | 2026-06-23 | UI architecture review: remove shared SEL, add per-channel mode latch, update ADC signed int32 protocol and sampling responsibilities |
| 1.4 | 2026-06-30 | Align IOP to 2 ms SOM poll; define HSE and reserved-pin release rules; clarify SWD pins |
| 1.5 | 2026-07-22 | Declared target-versus-implemented status and aligned cross-references to the controlled docs tree. |
| 1.6 | 2026-09-30 | §4–§8 thành tham khảo cho team MCU riêng; ràng buộc qua `FW-REQ-MK-DDC-24-VI` v3.0 và ICD `IOP-SPEC-MK-DDC-24-VI` v2.0. §2–§3 giữ nguyên. |

---

## 1. MCU Selection

STM32G0B1RBT6 remains the Rev A MCU.

Key reasons:

- ARM Cortex-M0+ at 64MHz is sufficient for 1ms ADC acquisition and a 2ms SOM-polled IOP response.
- 128KB Flash and 144KB SRAM leave room for double buffers, diagnostics, and OTA boot support.
- SPI1 drives DAC8554, SPI3 drives 2x ADS131M08, and spare serial/GPIO resources support UI mode latch.
- LQFP64 is manufacturable and has enough pins after DI opto removal.

> **Implementation status:** this section is target design. As of 2026-07-22,
> `firmware/stm32/Core/Src/main.c` contains only boot prints and an empty loop, while
> `firmware/stm32/mkddc-fw.ioc` contains no real peripheral/pin configuration. No statement in
> this document is evidence that FreeRTOS, SPI/ADC, AO/DO, IOP or watchdog behavior
> has been implemented or verified on target.

---

## 2. Electrical Summary

| Item | Value |
|------|-------|
| Core | ARM Cortex-M0+ |
| Clock | 64MHz from 8MHz HSE + PLL |
| Flash | 128KB |
| SRAM | 144KB |
| VDD | 3.3V |
| Main ADC interface | SPI3 to 2x ADS131M08 |
| IOP link | USART1 to CM3 UART2, 921600 8N1 |
| Safety output | FAULT_OUT to CM3 GPIO |

---

## 3. Pin Mapping STM32G0B1RBT6

This table is the hardware-design source for MCU pin use. Schematic, firmware pinout, and layout must match it before release.

### 3.1 UART

| Signal | Pin STM32 | Connection | Speed |
|--------|-----------|------------|------:|
| USART1_TX | PA9 | CM3 UART2_RX (IOP) | 921600 |
| USART1_RX | PA10 | CM3 UART2_TX (IOP) | 921600 |
| USART2_TX | PA2 | Debug/programming UART | 115200 |
| USART2_RX | PA3 | Debug/programming UART | 115200 |

### 3.2 SPI and ADC Interrupts

| Signal | Pin STM32 | Connection | Note |
|--------|-----------|------------|------|
| SPI1_CLK | PA5 | DAC8554 SCLK | AO DAC |
| SPI1_MOSI | PA7 | DAC8554 DIN | AO DAC |
| SPI1_CS | PA4 | DAC8554 SYNC | Active low |
| SPI1_LDAC | PB0 | DAC8554 LDAC | GPIO |
| SPI3_CLK | PC10 | ADS131M08 #1/#2 SCLK | Shared bus |
| SPI3_MISO | PC11 | ADS131M08 #1/#2 DOUT | Shared bus |
| SPI3_MOSI | PC12 | ADS131M08 #1/#2 DIN | Required for config writes |
| ADC1_CS | PB2 | ADS131M08 #1 !CS | Pull-up 10k |
| ADC1_DRDY | PA8 | ADS131M08 #1 !DRDY | EXTI input |
| ADC2_CS | PA15 | ADS131M08 #2 !CS | Pull-up 10k |
| ADC2_DRDY | PA6 | ADS131M08 #2 !DRDY | EXTI input |

Debug uses two-wire SWD on PA13 (`SWDIO`) and PA14 (`SWCLK`). PA15 is not part of the Rev A debug connection and is assigned exclusively to `ADC2_CS`. CubeMX pin/alternate-function validation remains a schematic-release check.

### 3.3 UI Per-Channel Mode Latch

Shared direct `SEL[2:0]` is deprecated. PB12/PB13/PB14 no longer route as common address lines to all UI muxes.

| Signal | Pin STM32 | Direction | Connection |
|--------|-----------|-----------|------------|
| UI_MODE_DATA | PB12 | OUT | Serial data to 48-bit mode latch chain |
| UI_MODE_CLK | PB13 | OUT | Shift clock |
| UI_MODE_LATCH | PB14 | OUT | Output latch / register clock |
| UI_MODE_OE | PB15 | OUT | Optional output enable, active level per latch part |

Latch output assignment:

| Output group | Meaning |
|--------------|---------|
| UI_MODE[0].S0/S1/S2 | Mode bits for UI1 |
| UI_MODE[1].S0/S1/S2 | Mode bits for UI2 |
| ... | ... |
| UI_MODE[15].S0/S1/S2 | Mode bits for UI16 |

Recommended latch parts: 6x 74HC595/74HCS595 or equivalent 3.3V-compatible shift/latch devices. Outputs must default to safe disabled mode through reset behavior or external pulls.

### 3.4 Retired Direct UI Enable Pins

The previous Phase 1 mapping used direct STM32 pins for `UI_EN[0..15]`. Rev A per-channel mode latch removes the need to spend 16 MCU GPIOs on mux enables.

| Pin group | Retired use | Rev A status |
|-----------|-------------|----------------|
| PC4-PC9, PC13, PC15 | UI_EN[0..7] | **NC/reserved by default**; no schematic connection without an approved pinout change |
| PB4-PB11 | UI_EN[8..15] | **NC/reserved by default**; no longer DI and not required by the mode-latch design |

If the schematic still needs per-channel enable or analog-power gating, implement it through the latch chain or an IO expander, not by reintroducing shared SEL behavior. Reuse of any NC/reserved pin requires one controlled change that updates this file, the firmware pinout master, schematic, CubeMX `.ioc`, test plan, and revision history together.

### 3.5 Digital Output

| Signal | Pin STM32 | Connection |
|--------|-----------|------------|
| DO1_DRV | PC0 | ULN2003A IN1 |
| DO2_DRV | PC1 | ULN2003A IN2 |
| DO3_DRV | PC2 | ULN2003A IN3 |
| DO4_DRV | PC3 | ULN2003A IN4 |

### 3.6 Miscellaneous

| Signal | Pin STM32 | Connection | Direction |
|--------|-----------|------------|-----------|
| nRESET | NRST | CM3 reset control / SWD | IN |
| BOOT0 | BOOT0 | Pull-down 10k, CM3-controlled for OTA if fitted | IN |
| FAULT_OUT | PD5 | CM3 GPIO0_A6 | OUT |
| MCU_LED | PD6 | MCU alive LED | OUT |
| ADC_IN0 | PA0 | Board voltage monitor | IN |
| ADC_IN1 | PA1 | Board temperature or VREF_UI monitor | IN |

### 3.7 Clock and debug requirements

| Item | Rev A requirement |
|---|---|
| HSE frequency | 8.000 MHz fundamental-mode crystal on PF0/PF1 |
| Frequency tolerance | <= +/-20 ppm at 25 C; aging and temperature drift included in the selected-part review |
| Load capacitance | Select crystal CL and calculate each load capacitor using `CL ~= (C1*C2)/(C1+C2) + Cstray`; do not copy a nominal capacitor value without the calculation |
| Placement | Crystal and load capacitors adjacent to PF0/PF1, short symmetric traces, no fast/high-current route beneath |
| Bring-up | Measure 8.000 MHz and verify PLL/system clock; record probe method to avoid oscillator loading |
| Debug | PA13 SWDIO, PA14 SWCLK, NRST, 3V3 reference, GND on the factory header |

---

## 4. ADC Acquisition Responsibilities

> ⚠️ **Tham khảo, không ràng buộc team MCU (2026-09-30).** Firmware MCU do một team riêng thiết kế và thực hiện. Ràng buộc với team đó chỉ gồm [Yêu cầu FW MCU `FW-REQ-MK-DDC-24-VI` v3.1](../../../01_specs/FW_REQUIREMENTS_MK-DDC-24_VI.md) và [ICD SOM ↔ MCU `IOP-SPEC-MK-DDC-24-VI` v3.0](../../../01_specs/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md) (cả hai đang Draft, chờ ký). Nội dung dưới đây là ý đồ thiết kế cũ của dự án; khi khác hai tài liệu trên thì hai tài liệu đó thắng.
> Áp cho §4–§8 (trách nhiệm firmware, task, tóm tắt IOP, watchdog, OTA). §2–§3 (điện, clock, chân) vẫn là nguồn chuẩn phần cứng.

MCU responsibilities:

- Configure both ADS131M08 devices through SPI3 MOSI.
- Wait for DRDY1/DRDY2 or detect timeout.
- Read status words and 8 signed 24-bit channel values from each ADC.
- Sign-extend ADS raw samples to int32.
- Maintain `adc_status_1`, `adc_status_2`, `channel_status_bitmap`, sequence, and timestamp.
- Never send float values over UART.
- Respond to each valid SOM `CMD_GET_IO` poll with the latest complete snapshot; nominal poll period is 2ms.

See `FW-ADC-SAMPLING.md` for the detailed sampling sequence and timing terms.

---

## 5. FreeRTOS Task Structure

| Task | Priority | Period | Function |
|------|:--------:|:------:|----------|
| `io_sample_task` | 7 | 1ms | Acquire ADS #1/#2, update raw buffers and channel status |
| `iop_comm_task` | 6 | Event-driven; 2ms nominal request cadence | Parse request and build response, CRC, sequence, timeout handling |
| `ao_output_task` | 6 | 10ms | Apply AO commands through DAC8554 |
| `do_control_task` | 6 | 10ms | Relay drive and feedback checks |
| `diagnostics_task` | 2 | 1000ms | MCU temperature, VDD/VREF, counters, fault aggregation |
| `watchdog_task` | 1 | 500ms | IWDG kick and task health monitoring |

Minimum buffers:

| Buffer | Size |
|--------|------|
| Raw ADC active | 16 x int32 |
| Raw ADC publish copy | 16 x int32 |
| Channel status | 32-bit bitmap minimum; 64-bit preferred for extended status |
| ADC status words | 2 x uint32 |
| Timestamp | uint32 microseconds, wraps acceptable |

---

## 6. IOP Protocol Summary

The Rev A UI ADC transport is a binary frame defined in [IOP_PROTOCOL](IOP_PROTOCOL.md),
but the implementation authority for frame constants/layout is `contracts/iop/iop_protocol.h`.

Minimum UI ADC frame fields:

```text
SOF
version
sequence
timestamp_us
adc_status_1
adc_status_2
16 x int32 raw_adc
channel_status_bitmap
crc16
```

Protocol rules:

- Raw ADC is signed 24-bit two's complement sign-extended to int32.
- CRC16 is mandatory.
- Sequence gaps detect lost frames.
- CRC fail, ADC timeout, and DRDY timeout have counters/status bits.
- JSON and float are not allowed in realtime UART payloads.

---

## 7. Watchdog and Fault Handling

- IWDG timeout: 1s nominal.
- If `io_sample_task` misses ADC data beyond timeout, set ADC fault and continue publishing status frames.
- If `iop_comm_task` loses CM3 polling beyond safe timeout, AO/DO enter configured safe state.
- `FAULT_OUT` asserts for persistent unrecoverable faults and is mirrored in IOP diagnostics.

---

## 8. OTA / Programming MCU

Rev A keeps two programming paths:

1. Factory/debug through SWD header.
2. Field OTA through CM3-controlled boot/reset path and STM32 ROM UART bootloader where fitted.

All outputs must enter safe state before firmware flashing, and firmware image CRC must be verified before release from bootloader.

---

## 9. Release Checks Before Schematic/Layout

- [ ] No shared SEL[2:0] net goes directly to all UI muxes.
- [ ] UI mode latch reset/default state is safe and documented.
- [ ] SPI3 has independent CS/DRDY for both ADS131M08 devices.
- [ ] Firmware sampling design uses signed int32 raw buffer for 16 channels.
- [ ] IOP protocol document and implementation plan agree on frame length, CRC, and endian.
- [ ] PB4-PB11 are not documented as industrial DI inputs.
- [ ] Dry contact through UI is not claimed as isolated DI.

---

## 10. Cross-References

| Document | Required consistency |
|----------|----------------------|
| [UI circuit](../03_io_subsystem/IO_UI_CIRCUIT.md) | Pin mapping for UI mode latch, ADC devices and SPI3 configuration |
| [IOP protocol](IOP_PROTOCOL.md) | Human-readable protocol design; `contracts/iop/iop_protocol.h` remains implementation authority |
| [ADC sampling](FW-ADC-SAMPLING.md) | ADC sample rate, acquisition/poll timing and fault handling |
| [Carrier block](../02_carrier_board/CB_BLOCK_DIAGRAM.md) | Terminal-to-ADC signal chain and STM32 position |
| [Schematic notes](../02_carrier_board/CB_SCHEMATIC_NOTES.md) | UI sheet rules, SPI3 routing and DRDY/EXTI |
| [Product BOM](../06_bom/BOM_MK-DDC-24_v1.md) | STM32 part/configuration; currently preliminary |
| [UI hardware test](../09_hw_bringup/HW-TEST-UI-16CH.md) | Pin mapping, SPI3 timing and ADC timeout evidence |

**Document ID:** HW-DES-05-MCU | Rev 1.6 | 2026-09-30
