# ESD 4kV Contact Test Evidence — IOT-5888

> **Part of:** IOT-5874 (HW EMC Physical Pre-compliance)  
> **Test date:** ________________  
> **Operator:** ________________  
> **Equipment:** ________________ (ESD gun model)  
> **Calibration due:** ________________  
> **DUT SN:** ________________  
> **DUT HW rev:** Carrier Board v1.0 + Radxa CM3 2GB  
> **FW version:** ________________  
> **Supply:** 24VDC ___ / 24VAC ___  

## Pre-test Setup Checklist

- [ ] DUT powered ON, normal boot complete
- [ ] BACnet link active (verify MSTP LED / software status)
- [ ] Load simulator attached (all UI, DI, AO, DO terminals active)
- [ ] BACnet COV subscription active on at least 1 AI point
- [ ] UI inputs: stable known value (e.g. 10kΩ pot or signal generator)
- [ ] DO outputs: forced known state (e.g. DO-1 = ON, DO-2 = OFF)
- [ ] AO outputs: set to known level (e.g. AO-1 = 5V, AO-4 = 10V)
- [ ] ESD gun configured: **4kV contact discharge, single shot, 1s interval**
- [ ] Ground reference plane connected per IEC 61000-4-2
- [ ] Camera / phone ready for evidence photos

## Test Conditions

| Condition | Value |
|-----------|-------|
| Ambient temperature | ________ °C |
| Relative humidity | ________ % |
| Supply voltage | ________ V |
| ESD gun brand/model | ________ |
| Discharge mode | Contact @ 4kV |
| Interval | ≥ 1 s |

## Procedure per Test Point

For each test point, follow this sequence:

1. Position ESD gun perpendicular to test surface, tip in contact
2. Discharge at 4kV (single shot)
3. Wait 2 s
4. Check:
   - **BACnet COV**: did the subscribed point report a change? (Y/N)
   - **UI reading**: stable within ±1%? (Y/N)
   - **DO state**: unchanged from pre-test state? (Y/N)
   - **AO output**: no glitch / voltage within ±1%? (Y/N)
   - **BACnet link**: still up? (PING/COV refresh)
5. Record any anomaly
6. Take photo of discharge point + setup
7. Proceed to next test point (≥ 1 s between discharges)

## Test Results

### Terminal Block I/O

| # | Test Point | Discharge | BACnet COV | UI Stable | DO Unchanged | AO No Glitch | BACnet Link | Pass/Fail | Evidence File | Notes |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|---|
| 1 | UI-1 terminal | Contact 4kV | ⬜ Y/N | ⬜ Y/N | N/A | N/A | ⬜ Y/N | ⬜ P/F | `esd-ui1.jpg` | |
| 2 | UI-2 terminal | Contact 4kV | ⬜ Y/N | ⬜ Y/N | N/A | N/A | ⬜ Y/N | ⬜ P/F | `esd-ui2.jpg` | |
| 3 | UI-8 terminal | Contact 4kV | ⬜ Y/N | ⬜ Y/N | N/A | N/A | ⬜ Y/N | ⬜ P/F | `esd-ui8.jpg` | |
| 4 | DI-1 terminal | Contact 4kV | ⬜ Y/N | N/A | ⬜ Y/N | N/A | ⬜ Y/N | ⬜ P/F | `esd-di1.jpg` | |
| 5 | DI-8 terminal | Contact 4kV | ⬜ Y/N | N/A | ⬜ Y/N | N/A | ⬜ Y/N | ⬜ P/F | `esd-di8.jpg` | |
| 6 | AO-1 terminal | Contact 4kV | ⬜ Y/N | N/A | N/A | ⬜ Y/N | ⬜ Y/N | ⬜ P/F | `esd-ao1.jpg` | |
| 7 | AO-4 terminal | Contact 4kV | ⬜ Y/N | N/A | N/A | ⬜ Y/N | ⬜ Y/N | ⬜ P/F | `esd-ao4.jpg` | |
| 8 | DO-1 terminal | Contact 4kV | ⬜ Y/N | N/A | ⬜ Y/N | N/A | ⬜ Y/N | ⬜ P/F | `esd-do1.jpg` | |
| 9 | DO-4 terminal | Contact 4kV | ⬜ Y/N | N/A | ⬜ Y/N | N/A | ⬜ Y/N | ⬜ P/F | `esd-do4.jpg` | |

### Communication Ports

| # | Test Point | Discharge | BACnet COV | UI Stable | DO Unchanged | AO No Glitch | BACnet Link | Pass/Fail | Evidence File | Notes |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|---|
| 10 | RS-485 terminal | Contact 4kV | ⬜ Y/N | ⬜ Y/N | ⬜ Y/N | ⬜ Y/N | ⬜ Y/N | ⬜ P/F | `esd-rs485.jpg` | |
| 11 | RJ-45 shield | Contact 4kV | ⬜ Y/N | ⬜ Y/N | ⬜ Y/N | ⬜ Y/N | ⬜ Y/N | ⬜ P/F | `esd-rj45.jpg` | |
| 12 | USB-C shell | Contact 4kV | ⬜ Y/N | ⬜ Y/N | ⬜ Y/N | ⬜ Y/N | ⬜ Y/N | ⬜ P/F | `esd-usbc.jpg` | |
| 13 | USB-A shell | Contact 4kV | ⬜ Y/N | ⬜ Y/N | ⬜ Y/N | ⬜ Y/N | ⬜ Y/N | ⬜ P/F | `esd-usba.jpg` | |

### Power & Mechanical

| # | Test Point | Discharge | BACnet COV | UI Stable | DO Unchanged | AO No Glitch | BACnet Link | Pass/Fail | Evidence File | Notes |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|---|
| 14 | Power terminal (24V) | Contact 4kV | ⬜ Y/N | ⬜ Y/N | ⬜ Y/N | ⬜ Y/N | ⬜ Y/N | ⬜ P/F | `esd-power.jpg` | |
| 15 | DIN-rail mount | Contact 4kV | ⬜ Y/N | ⬜ Y/N | ⬜ Y/N | ⬜ Y/N | ⬜ Y/N | ⬜ P/F | `esd-dinrail.jpg` | |

## Global Checks After Full Sequence

- [ ] BACnet device object accessible (Who-Is / ReadProperty)
- [ ] All AI/AO values readable within normal range
- [ ] DO outputs still in forced state
- [ ] No unexpected log entries (syslog/application)
- [ ] No visible damage to DUT, connectors, or terminals
- [ ] DUT can cold-reboot and re-establish BACnet link
- [ ] UI readings return within ±1% after recovery

## Summary

| Metric | Value |
|--------|-------|
| Total test points | 15 |
| Passed | ___ |
| Failed | ___ |
| Criterion A met? | ⬜ Yes / ⬜ No |
| Safety anomalies? | ⬜ None / ⬜ See notes |

**Overall verdict:** ⬜ Pass / ⬜ Fail / ⬜ Needs investigation

**Operator signature:** ________________________________

## Notes / Anomalies

```
(Describe any deviations, unexpected behavior, or safety concerns here.
Include timestamps for each anomaly.)
```
