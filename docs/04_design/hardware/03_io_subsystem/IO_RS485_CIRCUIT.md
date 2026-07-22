# RS-485 Interface Circuit — MK-DDC-24 Rev A

> **Document:** HW-DES-03-RS485 | Rev 0.1 | 2026-06-30
> **Status:** Controlled draft; final schematic/BOM and EMC evidence required
> **Role:** Southbound Modbus RTU **master** only (ARCH-R010)

---

## 1. Interface contract

| Item | Rev A requirement |
|---|---|
| Physical layer | 2-wire half-duplex RS-485 plus signal COM; shield termination provided separately |
| Controller | Radxa CM3 UART4 through the selected direction-control/isolation path |
| Transceiver baseline | MAX13487E class, 3.3 V logic-compatible, internal fail-safe/auto-direction behavior verified at all supported baud rates |
| Baud rates | 9600, 19200, 38400, 57600, 115200 baud |
| Protocol role | Modbus RTU master; no BACnet MS/TP and no Modbus slave role |
| Nodes | Electrical load may allow more, but product limit is <=32 slave devices per segment unless a repeater/topology review approves otherwise |
| Cable | Shielded twisted pair, daisy chain; no star topology in the installation guide |

---

## 2. Schematic block

```text
CM3 UART4_TX/RX
      |
      +-> direction/auto-direction logic
      |
 [optional digital isolation] || [isolated DC/DC]
      |                       ||
      +-> RS-485 transceiver  || GND_RS485_ISO
              A ---- series/EMC ----+---- TVS ---- RS485_A terminal
              B ---- series/EMC ----+---- TVS ---- RS485_B terminal
                         |           |
                    120R TERM       bias network
                    jumper          (fit once per segment)

FIELD_COM terminal ---------------------- cable reference/common
SHIELD terminal/chassis clamp ---------- PE_CHASSIS at cable entry
```

Isolation is an assembly option only if the schematic includes both a suitable digital isolator and isolated power. Fitting an isolator while sharing DGND across the barrier is not isolation.

---

## 3. Termination and bias

- Provide a jumper/DIP-selectable **120 ohm** termination directly across A/B; default disabled unless this DDC is a physical bus endpoint.
- Provide one controlled fail-safe bias network per segment. The preliminary `560 ohm pull-up + 560 ohm pull-down` values from the system spec produce about 0.32 V differential with a 120 ohm termination at 3.3 V; final values must be checked against transceiver input thresholds, internal fail-safe behavior, common-mode range, total unit load, and worst-case resistor tolerance.
- Do not populate strong bias at multiple nodes. The installation guide must state which device owns bias and termination.
- Add optional 0 ohm/series-resistor footprints to tune edge rate/EMI only if signal-integrity measurements justify them.

---

## 4. Protection and grounding

| Item | Requirement |
|---|---|
| A/B TVS | Low-capacitance bidirectional RS-485 TVS at the connector. Select standoff/clamp/current from transceiver abs-max and IEC surge target; part number remains blocked pending calculation. |
| Common-mode stress | Verify A, B, and FIELD_COM remain in the transceiver common-mode range for the declared cable/ground offset. |
| Shield | Terminate to PE_CHASSIS at cable entry by the compliance-approved direct or hybrid scheme, never silently to DGND. |
| Isolation | Maintain creepage/clearance and isolated-power rating across the complete barrier. |
| EFT path | Common-mode choke/RC footprints may be provided, but must be validated for waveform distortion at 115200 baud. |

---

## 5. Connector and net naming

| Pin | Net | Label |
|---:|---|---|
| 1 | `RS485_A` | A / D+ |
| 2 | `RS485_B` | B / D- |
| 3 | `RS485_COM` or `GND_RS485_ISO` | COM |
| 4 (if fitted) | `PE_CHASSIS` | SHIELD |

Use `RS485_TX`, `RS485_RX`, `RS485_DE`, `RS485_RE_N`, `RS485_A`, `RS485_B`, `RS485_COM`, and `RS485_SHIELD` consistently. Never label this port BACnet/MS-TP.

---

## 6. Layout rules

- Place TVS and shield termination at the connector before routing toward the transceiver.
- Route A/B as a coupled pair with consistent spacing and minimal stubs; keep termination at the physical endpoint.
- Keep A/B and their surge return away from UI ADC/reference and IOP UART routes.
- Preserve isolation keepout under isolator and isolated DC/DC components when populated.
- Provide accessible `TP_RS485_A`, `TP_RS485_B`, `TP_RS485_COM`, logic-side TX/RX/DE test points without creating long bus stubs.

---

## 7. Verification and release gate

- [ ] Final transceiver, isolator, isolated supply, TVS, choke/filter, bias, and termination parts appear in schematic and BOM.
- [ ] Idle differential voltage and common-mode voltage pass with termination on/off and 1/32 configured slaves.
- [ ] Modbus exchanges pass at every supported baud/parity/stop-bit configuration and at both cable-end positions.
- [ ] Eye/waveform captures at 115200 baud show no excessive ringing or auto-direction truncation.
- [ ] Open/short/reversed A/B and missing-COM behavior is safe and diagnosable.
- [ ] IEC 61000-4-2/-4/-5 pre-compliance targets pass without damage, unsafe reset, or corruption of UI/AO/DO.
- [ ] HW, firmware, compliance, and QA owners sign the evidence links in the closure register.

This controlled draft closes the missing-RS-485-document finding. The hardware remains blocked until schematic/BOM and test evidence are attached.

---

**Document ID:** HW-DES-03-RS485 | Rev 0.1 | 2026-06-30
