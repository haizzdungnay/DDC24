# TISI Technical Dossier Template — MK-DDC-24

> **Purpose:** Technical documentation package for TISI/TIS Mark certification via e-TISI
> **Standard:** TIS 60335 series (aligned IEC 60335) — electrical safety for household and similar appliances
> **Product:** MK-DDC-24 DDC Controller (BACnet/IP Building Automation Controller)
> **Status:** Draft — agent-agnostic, can be completed before IOT-5460 resolves
> **Owner:** ComplianceExpert
> **Ref:** PM-MARKET-001 v1.1 §6.6 | regional-certification-research.md §1.2 | TISI official portal

---

## 1. Document Checklist

| # | Document | Required | Status | Notes |
|---|----------|:--------:|:------:|-------|
| 1.1 | Product description & specification | ✅ Mandatory | ⬜ Draft | |
| 1.2 | Circuit diagrams (schematic + PCB layout) | ✅ Mandatory | ⬜ Draft | |
| 1.3 | Bill of materials (BOM) | ✅ Mandatory | ⬜ Draft | Include component certs |
| 1.4 | Risk assessment report | ✅ Mandatory | ⬜ Draft | Per ISO 12100 or equivalent |
| 1.5 | Test reports (safety — EMC, LVD) | ✅ Mandatory | ⬜ Draft | |
| 1.6 | User manual / installation guide | ✅ Mandatory | ⬜ Draft | Thai language summary required |
| 1.7 | Declaration of Conformity (DoC) | ✅ Mandatory | ⬜ Draft | |
| 1.8 | Factory production control (FPC) doc | ⚠️ If applicable | ⬜ Draft | Depends on factory audit |
| 1.9 | CB test report (if available) | 🟢 Optional | ❌ N/A | Not yet CB certified |
| 1.10 | ISO 9001 certificate (manufacturer) | 🟢 Optional | ❌ N/A | Can reduce testing scope |

## 2. Product Description — §1.1

### 2.1 General Information

| Field | Value |
|-------|-------|
| Product name | MK-DDC-24 DDC Controller |
| Model number(s) | MK-DDC-24-xx |
| Rated voltage | 24 VAC/VDC ±10% |
| Rated frequency | 50/60 Hz |
| Rated power | TBD (measure) |
| Protection class | III (SELV) |
| Pollution degree | 2 |
| Overvoltage category | II |
| Ingress protection | IP20 (indoor) |
| Ambient temperature | 0–50°C operating |
| Standards applied | TIS 60335-1, TIS 60335-2-x (if applicable) |

### 2.2 Functional Description

Brief description of the DDC controller: BACnet/IP building automation controller with 24 I/O channels, IEC 61131-3 soft PLC, and Linux-based platform. Controls HVAC equipment (FCU, VAV, AHU).

### 2.3 Key Components

| Component | Part No. | Supplier | Safety-critical? |
|-----------|----------|----------|:----------------:|
| SOM | Radxa CM3 | Radxa | No (SELV) |
| ADC | ADS131M08 | TI | No |
| DAC | DAC8554 | TI | No |
| Power supply | TBD | TBD | Yes — 24VAC/DC input |
| Relays | TBD | TBD | Yes — isolation |
| MCU | STM32G0B1RBT6 | STMicro | No |

## 3. Circuit Diagrams — §1.2

Required:
- [ ] Complete schematic (PDF)
- [ ] PCB layout (top/bottom layers, PDF)
- [ ] Block diagram showing mains path if applicable

*Note: For SELV (24V) devices, trace separation and creepage/clearance still required per TIS 60335-1.*

## 4. Bill of Materials — §1.3

Required:
- [ ] Full BOM with part numbers, suppliers, RoHS status
- [ ] Component datasheets for safety-critical parts (power supply, relays, fuses)
- [ ] Certificates for critical components (UL/VDE/TIS-marked if required by Thai regulation)

## 5. Risk Assessment — §1.4

### 5.1 Applicable Clauses (TIS 60335-1)

| Clause | Hazard | Mitigation | Residual Risk |
|--------|--------|------------|:------------:|
| 7 | Marking & instructions | Label + user manual | Acceptable |
| 8 | Protection against electric shock | SELV design, no accessible hazardous voltage | Acceptable |
| 10 | Power input | TBD (measure) | |
| 11 | Heating | TBD (thermal test) | |
| 13 | Leakage current | TBD (measure) | |
| 14 | Transient voltages | TVS diode on input | Acceptable |
| 15 | Moisture resistance | Conformal coating (optional) | Acceptable |
| 19 | Abnormal operation | Current limit, thermal cutoff | Acceptable |
| 21 | Mechanical strength | Aluminum enclosure | Acceptable |
| 22 | Construction | Enclosed PCB, no sharp edges | Acceptable |
| 23 | Internal wiring | PCB traces per IPC-2221 | Acceptable |
| 24 | Components | Use TIS/UL-rated components | Pending review |
| 25 | Supply connection | Screw terminal, strain relief | Acceptable |
| 28 | Creepage/clearance | TBD (measure per PCB layout) | |
| 30 | Resistance to heat/fire | PCB FR4 rated ≥130°C | Acceptable |

## 6. Test Reports — §1.5

Required test categories (to be filled when test results available):

### 6.1 Electrical Safety

| Test | Standard | Result | Lab | Date |
|------|----------|:------:|-----|------|
| Dielectric strength | TIS 60335-1 §13 | — | — | — |
| Insulation resistance | TIS 60335-1 §16 | — | — | — |
| Leakage current | TIS 60335-1 §13 | — | — | — |
| Earth continuity (if applicable) | TIS 60335-1 §27 | — | — | — |

### 6.2 EMC

| Test | Standard | Result | Lab | Date |
|------|----------|:------:|-----|------|
| Conducted emissions | CISPR 14-1 / TIS 60335 | — | — | — |
| Radiated emissions | CISPR 14-1 / TIS 60335 | — | — | — |
| ESD immunity | IEC 61000-4-2 | — | — | — |
| EFT immunity | IEC 61000-4-4 | — | — | — |
| Surge immunity | IEC 61000-4-5 | — | — | — |

## 7. User Manual — §1.6

Required content:
- Safety instructions (Thai + English)
- Installation guide
- Wiring diagram
- Operating instructions
- Troubleshooting
- Technical specifications
- Manufacturer contact information

## 8. Declaration of Conformity — §1.7

Template to be completed when test data available:

```
DECLARATION OF CONFORMITY
TIS 60335 SERIES

Manufacturer: KINEXUS Vietnam Co., Ltd.
Address: [Address]
Product: MK-DDC-24 DDC Controller
Model(s): [Models]

We declare under sole responsibility that the product above
conforms to the following Thai Industrial Standards:
- TIS 60335-1: [Year] — Household and similar electrical appliances — Safety
- [Additional parts]

Name:
Title:
Date:
Signature:

[Company stamp]
```

## 9. Factory Production Control — §1.8

Required if TISI requires factory audit:
- [ ] Quality manual / policy
- [ ] Production process flow
- [ ] In-process inspection records
- [ ] Final inspection / testing records
- [ ] Calibration certificates for test equipment
- [ ] Non-conformance / corrective action procedures
- [ ] Traceability system description

## 10. e-TISI Submission Workflow

```
[Agent identified] → [Register e-TISI account] → [Upload dossier] →
[TISI review] → [Testing] → [Certificate issuance]
```

### 10.1 e-TISI Registration Requirements

| Item | Notes |
|------|-------|
| Agent company registration | Thai-registered company required |
| Power of attorney | KINEXUS → agent authorization letter |
| Product registration form | Via e-TISI portal |
| Upload all technical docs | PDF format, Thai or English |

### 10.2 Sample Shipment

| Item | Quantity | Notes |
|------|:--------:|-------|
| MK-DDC-24 units | 2–3 | Fully assembled, production-representative |
| Power supply | 2–3 | 24 VAC/VDC adapter |
| Accessories | Per unit | Terminal blocks, mounting brackets |
| Documentation | 2 sets | Printed user manual + schematics |

---

## Next Action

Complete §1.1 (Product description) with final specifications from engineering.
Remaining sections require: test data, final BOM, PCB layout measurements.

See also: [IOT-5460](../../../../../../../../IOT/issues/IOT-5460) — Local agent identification (blocker)
