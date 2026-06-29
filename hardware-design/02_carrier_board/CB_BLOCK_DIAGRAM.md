# Carrier Board - Block Diagram & Design Specification

> **Document:** HW-DES-02-CB | Rev 1.3 | 2026-06-23
> **Ap dung cho:** MK-DDC-24 Carrier Board v1.x
> **PCB layers:** 4-layer minimum
> **UI Rev A:** 16 UI analog, per-channel mode latch, TMUX only on low-voltage conditioned nodes

---

## Revision History

| Rev | Date | Changes |
|-----|------|---------|
| 1.0 | 2026-05-27 | Initial 8 UI + 8 DI architecture |
| 1.1 | 2026-06-23 | DI to UI migration: 16 UI, 2x ADS131M08 |
| 1.2 | 2026-06-23 | Phase 1 cross-check updates |
| 1.3 | 2026-06-23 | UI architecture review: terminal protection/front-end before mux, per-channel mode latch, dry contact auxiliary only |

---

## 1. System Block Diagram

```text
                    CARRIER BOARD MK-DDC-24 Rev A

  24VAC/VDC
     |
     v
+-------------------+      +--------------------------------+
| Power input       |----->| 5V, 3.3V, 1.8V, analog refs    |
| fuse/TVS/bridge   |      | +15V only for AO op-amp rail   |
+-------------------+      +--------------------------------+
                                      |
                                      v
+---------------------------------------------------------------------+
| Radxa CM3                                                            |
| Debian/PREEMPT_RT, scaling/linearization, BACnet/Modbus/application  |
| UART2 921600 binary IOP                                              |
+-------------------------------+-------------------------------------+
                                |
                                v
+---------------------------------------------------------------------+
| STM32G0B1 MCU                                                        |
| SPI3 -> ADS131M08 #1/#2                                               |
| UI_MODE_DATA/CLK/LATCH/OE -> per-channel mode latch                  |
| SPI1 -> DAC8554 AO                                                    |
| GPIO -> relay driver DO                                               |
| FAULT_OUT -> CM3                                                      |
+--------+--------------------------+---------------------+-----------+
         |                          |                     |
         v                          v                     v
+----------------+        +------------------+    +-------------------+
| UI ADC cluster |        | AO output        |    | DO relay          |
| 2x ADS131M08   |        | DAC8554 + buffer |    | ULN2003 + relay   |
+-------+--------+        +--------+---------+    +---------+---------+
        |                          |                    |
        v                          v                    v
+---------------------------------------------------------------------+
| 16x Universal Input front-end                                        |
| Terminal -> protection/miswire/EMC -> mode front-end ->              |
| scaled low-voltage node -> mux/buffer/filter -> ADS131M08            |
+---------------------------------------------------------------------+
        ^
        |
  UI1-UI16 field terminals

Optional separate industrial DI, if required by SKU:
  DI terminal -> TVS/current limit -> opto/digital isolator -> MCU/IO expander
  This is not replaced by UI dry-contact mode.
```

---

## 2. Universal Input Rev A Boundary

The UI sheet must be drawn so that no one can route field voltage directly into an analog switch or ADC.

```text
Terminal
-> ESD/TVS/PTC/fusible element/EMC
-> mode-specific front-end
-> low-voltage conditioned node
-> mux/buffer/filter
-> ADS131M08
-> STM32
-> IOP
-> CM3
```

Allowed UI Rev A modes:

| Mode | Carrier-board support |
|------|-----------------------|
| 0-10V | Divider + RC + RRIO buffer |
| 4-20mA | Protected 49.9R shunt + buffer |
| NTC 10k/20k | Ratiometric or measured excitation |
| Auxiliary dry contact | Clean contact only, no isolation claim |

Not in Rev A UI claim: PT100/PT1000, wet 24V contact, safety DI, industrial isolated DI replacement.

---

## 3. PCB Stackup

| Layer | Name | Content |
|-------|------|---------|
| L1 | Signal_Top | CM3 B2B, MCU, ADC, DAC, low-voltage logic |
| L2 | GND | Continuous reference plane |
| L3 | Power | 5V, 3.3V, 1.8V, analog/reference rails |
| L4 | Signal_Bot | Terminal routing, relay contact traces, selected I/O routing |

High-current and transient return paths must not share narrow routes with ADC reference or ADS input return.

---

## 4. Layout Zones

| Zone | Area | Content |
|------|------|---------|
| Power | Top-left | 24V input, bridge, DC/DC, LDOs, input TVS |
| CM3 | Top-center | B2B connectors, keepout under module |
| MCU/ADC/DAC | Left/middle | STM32, 2x ADS131M08, DAC8554, references, crystals |
| UI field/front-end | Bottom-middle | UI terminals, protection, dividers, shunts, pull-ups, filters |
| Low-voltage UI mux/buffer | Between UI front-end and ADC | TMUX/analog switch only after scaling/clamp |
| Communications | Top-right | Ethernet, RS-485, USB |
| Relay | Bottom-right | Relay contacts with creepage/clearance |

---

## 5. Signal Routing Rules

### 5.1 SPI3 - STM32 to 2x ADS131M08

| Rule | Requirement |
|------|-------------|
| Max length | 50mm where practical within MCU/ADC cluster |
| Series resistors | 22-33R on SCLK/MOSI/MISO close to driver |
| CS | Independent CS1 PB2 and CS2 PA15, pull-up 10k |
| DRDY | DRDY1 PA8, DRDY2 PA6, clean EXTI routing |
| Reference | Continuous GND, avoid relay/power loops |

### 5.2 UI Field Routing

| Rule | Requirement |
|------|-------------|
| Terminal to protection | Shortest route, protection closest to connector |
| Protection to front-end | Field-rated spacing and current path sizing |
| Front-end to mux/buffer | Low-voltage only after divider/shunt/clamp |
| Mux/buffer to ADC | Short, quiet, guarded by analog ground where practical |
| 24V-capable field traces | Must not enter ADC/mux cluster directly |

### 5.3 UART2 IOP

| Rule | Requirement |
|------|-------------|
| Baud | 921600 8N1 |
| Format | Binary protocol, no JSON/float realtime payload |
| Max length | 80mm recommended |
| Series resistors | 33R on TX lines where needed |

---

## 6. Test Points

| Test point | Net | Purpose |
|------------|-----|---------|
| TP1 | VCC_5V | 5V rail |
| TP2 | VCC_3V3 | 3.3V rail |
| TP3 | GND | Ground reference |
| TP4 | UART0_TX | Debug console |
| TP5 | UART2_TX | IOP link |
| TP6 | SPI3_CLK | ADC SPI clock |
| TP7 | RS485_A | Fieldbus A |
| TP8 | RS485_B | Fieldbus B |
| TP9 | MCU_nRESET | Reset |
| TP10-TP25 | UI1-UI16 field side | Pre-conditioning terminal-side checks |
| TP26-TP41 | UI1-UI16 ADC node, representative or all if space permits | Low-voltage conditioned node checks |
| TP42-TP45 | UI_MODE_DATA/CLK/LATCH/OE | Mode latch debug |

---

## 7. Release Gates

Before schematic/layout release:

- [ ] Block diagram and schematic show terminal protection before front-end and low-voltage mux/buffer.
- [ ] TMUX1208 or equivalent analog switch is not exposed to field 0-10V/24V wiring.
- [ ] Per-channel UI mode latch exists and reset state is safe.
- [ ] 4-20mA shunt is 49.9R with 24mA headroom.
- [ ] Dry contact wording is auxiliary only.
- [ ] RTD is absent from Rev A UI claim or redesigned as dedicated 3/4-wire module.
- [ ] IOP protocol uses signed int32 raw ADC frame with CRC.
- [ ] QA has UI-specific test/risk/BOM documents.

---

**Document ID:** HW-DES-02-CB | Rev 1.3 | 2026-06-23
