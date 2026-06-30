# Grounding and Return-Path Scheme — MK-DDC-24 Rev A

> **Document:** HW-DES-02-GND | Rev 0.1 | 2026-06-30
> **Status:** Controlled draft; schematic/layout evidence required before release
> **Applies to:** Carrier board, 16 UI, AO/DO, power input, Ethernet/USB, and RS-485

---

## 1. Ground domains

| Domain | Purpose | Connection rule |
|---|---|---|
| `PE_CHASSIS` | Protective/chassis reference, enclosure metal and cable-shield transient return | Enter at the power/field connector area. Do not use as normal logic-current return. |
| `DGND` | CM3, STM32, digital logic, UART/SPI and local regulated-power return | Continuous low-impedance reference plane. |
| `AGND` | ADS131M08, DAC/reference, UI/AO low-noise return | Same electrical 0 V as DGND in base Rev A, but route/placement must keep switching currents out of analog return paths. If separate net names are used, join once with a documented net tie beside the ADC/reference boundary. |
| `FIELD_COM` | Non-isolated UI/AO field return where the interface requires a common | Join to the approved AGND/DGND point only as shown by the final schematic; never let surge current traverse ADC/reference routes. |
| `GND_RS485_ISO` | Optional isolated RS-485 transceiver/cable-side return | No copper/DC connection to DGND when isolation is fitted; powered from an isolated DC/DC supply. |
| DO contacts | Floating relay contact circuits | No deliberate connection to logic ground or chassis; preserve creepage/clearance. |

`AGND` and `DGND` labels are current-routing disciplines, not permission to cut a reference plane beneath ADC/SPI signals. A split plane is allowed only when the layout review proves every crossing and return path.

---

## 2. Controlled topology

```text
24VAC/VDC connector
  PE/shield -------------------------------> PE_CHASSIS plane / enclosure bond
  power conductors -> fuse/bridge/TVS ------> DC_RAW return
                                         |
                                         +-> regulators -> DGND plane
                                                          |
                                                          +-> ADC/reference net-tie -> AGND island/routing zone
                                                          |                           -> UI/AO FIELD_COM
                                                          |
                                                          +-> digital isolator || isolated DC/DC -> GND_RS485_ISO

Relay COM/NO/NC ---------------------------------------------------------- floating
```

The input TVS/MOV, UI terminal clamps, USB/Ethernet shields, and RS-485 cable protection must return transients to the shortest approved chassis/field path. They must not dump surge current through the ADC reference, MCU ground pins, or narrow DGND necks.

---

## 3. Placement and routing rules

- Keep L2 as the continuous primary reference plane unless a signed layout review approves a different stack-up.
- Place the PE/chassis bond, input surge parts, and shield termination at the enclosure/connector entry boundary.
- Place UI terminal TVS/PTC parts before the low-voltage front-end; route their fault return directly to the field/chassis return strategy selected by the final schematic.
- Keep DC/DC switch loops, relay-coil return, USB load return, and CM3 peak-current paths outside the ADC/reference corridor.
- Join AGND/DGND once only if separate nets are used. Record the net-tie RefDes and XY location in the layout review.
- Route ADC differential inputs and reference as a compact group over an unbroken quiet reference.
- Keep relay contact copper and mains-class field wiring out of all SELV ground pours and obey the selected safety spacing.
- For RS-485 isolation, maintain the isolation keepout through copper, vias, test points, mounting hardware, and shield components.
- Connect a cable shield to PE/chassis at entry through the approved direct/RC/capacitive scheme; do not silently connect it to signal COM.

---

## 4. Schematic and layout evidence

| Evidence | Pass condition |
|---|---|
| Ground-domain netlist | Every connector return and shield pin maps to one named domain. |
| Net-tie record | AGND/DGND and any chassis coupling have RefDes/value/location and design rationale. |
| Return-path overlay | Power, relay, digital, analog, and surge-current loops are visibly separated. |
| Isolation review | Creepage/clearance and no unintended copper path across the RS-485/other isolation barrier. |
| DRC/ERC | No unconnected hidden power pins, duplicate ground labels, or keepout violations. |
| Bench evidence | Relay/load switching, DC/DC load step, UI noise floor, ESD/EFT pre-check, and shield-current behavior recorded. |

---

## 5. Release checklist

- [ ] HW Lead approves the ground-domain netlist and net-tie strategy.
- [ ] Compliance owner approves PE/chassis and cable-shield termination.
- [ ] Layout reviewer signs the current-return overlay.
- [ ] UI noise/error measurements pass while CM3, Ethernet, RS-485, AO, and all relays are active.
- [ ] ESD/EFT/surge tests show no unsafe current path or destructive reset.

This document closes the missing-grounding-document finding only. Hardware closure requires the evidence above.

---

**Document ID:** HW-DES-02-GND | Rev 0.1 | 2026-06-30
