# ESD 4kV Contact Test Procedure — IEC 61000-4-2 Level 4

> **Issue:** IOT-5888 (part of IOT-5874)  
> **Audience:** HW Engineer (human operator with ESD gun)  
> **Goal:** Gather evidence for pre-compliance report §8.3

## Equipment Required

| Item | Specification |
|------|---------------|
| ESD gun | IEC 61000-4-2 compliant, contact mode ≥ 4kV |
| Ground reference plane | Metal sheet ≥ 0.25 mm, connected to PE |
| Load simulator | Active loads on UI/DI/AO/DO terminals |
| BACnet client (e.g. Yabe / BACnet Explorer) | For COV check after each discharge |
| Multimeter | For verifying AO/DO state |
| Camera | Evidence photos per test point |

## DUT Setup

1. Place DUT on ground reference plane (0.1m insulator spacing)
2. Connect 24V supply (DC or AC)
3. Connect BACnet MS/TP link active
4. Attach load simulator to all terminals
5. Power ON — wait for normal boot + BACnet link up
6. Subscribe BACnet COV on at least 1 AI object
7. Set DO-1 = ON, DO-2 = OFF (for state verification)
8. Set AO-1 = 5V, AO-4 = 10V (or known reference)

## ESD Gun Settings

| Parameter | Value |
|-----------|-------|
| Discharge mode | **Contact** (tip touches DUT metal) |
| Voltage | **4 kV** |
| Polarity | Positive (per IEC 61000-4-2) |
| Discharge type | Single discharge |
| Interval between shots | ≥ 1 second |
| Return cable | Connected to ground reference plane |

## 15 Test Points — Execution Sequence

### A) Terminal Block I/O (points 1–9)
1. UI-1 → discharge → check → photo
2. UI-2 → discharge → check → photo
3. UI-8 → discharge → check → photo
4. DI-1 → discharge → check → photo
5. DI-8 → discharge → check → photo
6. AO-1 → discharge → check → photo
7. AO-4 → discharge → check → photo
8. DO-1 → discharge → check → photo
9. DO-4 → discharge → check → photo

### B) Communication Ports (points 10–13)
10. RS-485 terminal A/B → discharge → check → photo
11. RJ-45 shield → discharge → check → photo
12. USB-C shell → discharge → check → photo
13. USB-A shell → discharge → check → photo

### C) Power & Mechanical (points 14–15)
14. Power terminal (24V +/−) → discharge → check → photo
15. DIN-rail mount points → discharge → check → photo

## Per-discharge Check (mandatory for each point)

| Check | Acceptable |
|-------|------------|
| BACnet COV event received? | No spurious COV |
| UI reading (if applicable) | Within ±1% of pre-test |
| DO state | Unchanged |
| AO output | No glitch, within ±1% |
| BACnet link up? | Yes (ping / read property) |

## Pass/Fail Criteria

| Criterion | Definition |
|-----------|------------|
| **Criterion A** (PASS) | No degradation, no loss of function during or after discharge |
| **Criterion B** | Temporary degradation, self-recovery after discharge |
| **Criterion C** | Loss of function requiring operator intervention or reset |
| **FAIL** | Any of: visible damage, sparkover, communication loss, output latch-up |

## Stop Conditions

Stop immediately if any:
- Visible arc/flash/sparkover beyond discharge point
- Smoke, odor, or component damage
- BACnet link lost and does not recover within 5 s
- DO/AO output latched to wrong state
- UI reading stuck or out of range after recovery
- DUT does not cold-reboot normally after test sequence

## Evidence Collected

Each test point must produce:
1. Photo showing ESD gun position relative to test point
2. Photo of DUT setup overview (before start)
3. Row filled in evidence template with pass/fail and observations

## Photo Content Rules

Photos must **not** contain:
- Lab facility identifiers (building name, address, security badges, company logos on walls)
- Operator faces or identifying personal items
- Credentials, keys, access cards, or passwords
- Screenshots of internal tools with proprietary data
- Any equipment not directly part of the ESD test

If any such content is unavoidable, crop or redact before storing.

## Post-test

- [ ] Cold reboot DUT
- [ ] Verify BACnet reconnection
- [ ] Verify all I/O functional
- [ ] Update pre-compliance-report.md §8.3 with results
- [ ] Store photos in `docs/00_management/evidence/emc/esd/`

---

*Template: iot-5888-esd-4kv-contact-evidence.md*
