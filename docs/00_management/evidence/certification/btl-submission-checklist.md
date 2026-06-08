# BTL Submission Checklist — MK-DDC-24

> **Parent:** IOT-5466 · **Prepared by:** DeveloperTeam (IOT-5478) · **Date:** 2026-06-02
> **Input:** `design/interfaces/BACNET_PICS_EPICS_MK-DDC-24_VI.md` (Rev 1.1)
> **Input:** `design/software/SW_BACNET_DESIGN_MK-DDC-24_VI.md` (Rev 1.0)
> **BTL Test Package:** v26.1-v2 (Nov 2025) — `btl.org/testing-documentation/`
> **Standard:** ASHRAE 135-2020 · **Profile:** B-ASC

---

## 1. Device Profile Declaration

| Item | Declaration | Status |
|------|-------------|:------:|
| BACnet Standardized Device Profile | **B-ASC** (BACnet Application Specific Controller) | ✅ |
| Protocol_Version | 1 | ✅ |
| Protocol_Revision | ≥ 19 (BTL min PR 18) | ✅ |
| BACnet Stack | bacnet-stack 1.3.x (open source) | ✅ |
| Max_APDU_Length_Accepted | 1476 | ✅ |
| Segmentation_Supported | segmented-both | ✅ |
| Vendor_Name | KINEXUS Technologies | ✅ |
| Vendor_Identifier | ❌ TBD — cần đăng ký ASHRAE (TBD-01) | ⚠️ |
| Model_Name | MK-DDC-24 | ✅ |

## 2. BIBBs (BACnet Interoperability Building Blocks)

| BIBB | Name | Required B-ASC | Supported | Notes |
|------|------|:--------------:|:---------:|-------|
| DS-RP-B | ReadProperty-B | ✅ Mandatory | ✅ | — |
| DS-RPM-B | ReadPropertyMultiple-B | Optional | ✅ | — |
| DS-WP-B | WriteProperty-B | ✅ Mandatory | ✅ | — |
| DS-WPM-B | WritePropertyMultiple-B | Optional | ✅ | — |
| DS-COV-B | COV-B (subscribe) | Optional | ✅ | — |
| DS-COVU-B | COV unsolicited | Optional | ✅ | AI/AO/BI/BO/AV/BV/MSV |
| AE-N-I-B | Alarm/Event Notification-Internal | Optional | ✅ | Notification Class |
| AE-ACK-B | Alarm Acknowledge | Optional | ✅ | — |
| SCHED-I-B | Scheduling-Internal | Optional | ✅ | Schedule object |
| T-VMT-I-B | Trend Viewing (internal buffer) | Optional | ✅ | Trend Log |
| DM-DDB-B | Dynamic Device Binding (Who-Is/I-Am) | ✅ Mandatory | ✅ | — |
| DM-DOB-B | Dynamic Object Binding (Who-Has/I-Have) | Optional | ✅ | — |
| DM-TS-B | TimeSync-B | Optional | ✅ | — |
| DM-RD-B | ReinitializeDevice-B | Optional | ✅ | warm/cold restart |

**Total BIBBs: 14** (3 mandatory B-ASC, 11 optional)

## 3. Object Types

| Object Type | Count | B-ASC Required | Supported | Commandable | COV |
|-------------|:-----:|:--------------:|:---------:|:-----------:|:---:|
| Device | 1 | ✅ Mandatory | ✅ | — | — |
| Analog Input (AI) | 8 | Minimum 1 | ✅ | — | ✅ |
| Analog Output (AO) | 4 | Minimum 0 | ✅ | ✅ Priority 16 | ✅ |
| Analog Value (AV) | 32 | Minimum 1 | ✅ | ✅ | ✅ |
| Binary Input (BI) | 8 | Minimum 1 | ✅ | — | ✅ |
| Binary Output (BO) | 4 | Minimum 0 | ✅ | ✅ Priority 16 | ✅ |
| Binary Value (BV) | 16 | Minimum 1 | ✅ | ✅ | ✅ |
| Multi-state Value (MSV) | 8 | Minimum 0 | ✅ | ✅ | ✅ |
| Trend Log | 8 | Minimum 0 | ✅ | — | — |
| Schedule | 8 | Minimum 0 | ✅ | — | — |
| Calendar | 2 | Minimum 0 | ✅ | — | — |
| Notification Class | 4 | Minimum 1 | ✅ | — | — |
| Event Enrollment | 8 | Minimum 0 | ✅ | — | — |

**Total objects: 103** (13 types, all ≥ B-ASC minimum)

## 4. Data Link / Networking

| Layer | Selection | Status |
|-------|-----------|:------:|
| BACnet/IP (Annex J) | ✅ UDP 47808 (Ethernet/WiFi) | ✅ |
| BBMD / Foreign Device | ✅ FD registration, BBMD table configurable | ✅ |
| MS/TP (Clause 9) | ❌ KHÔNG hỗ trợ (RS-485 = Modbus RTU master) | ✅ Per ARCH-R010 |
| Max APDU | 1476 | ✅ |
| Segmentation | segmented-both | ✅ |

## 5. Special Functionality

| Function | Support Detail | Status |
|----------|---------------|:------:|
| Priority Array | 16-level + Relinquish_Default (AO/BO) | ✅ |
| COV | AI/AO/AV theo COV_Increment; BI/BO/BV/MSV theo state change | ✅ |
| Alarm/Event | Confirmed-Event-Notification qua Notification Class | ✅ |
| Scheduling | Schedule object (8), Calendar (2) | ✅ |
| Trending | Trend Log (8), internal buffer | ✅ |
| Time Sync | TimeSync-B (master/slave) | ✅ |
| Device Reinit | ReinitializeDevice (warm/cold), password-protected | ✅ |
| Failsafe | Mất BMS >30s → alarm E301, PLC standalone | ✅ |
| Object_Name | `<TYPE><n>` default, changeable via Web UI | ✅ |
| Character Set | UTF-8 (hỗ trợ tiếng Việt) | ✅ |
| Reliability | NO_FAULT / OVER_RANGE / UNDER_RANGE / OPEN_LOOP / SHORTED_LOOP | ✅ |

## 6. Device Object Properties (Configuration)

| Property | Value/Range | Status |
|----------|-------------|:------:|
| Device_Instance | 1 – 4,194,302 (config; DIP bootstrap 1–127) | ✅ |
| APDU_Timeout | 3000 ms | ✅ |
| Number_Of_APDU_Retries | 3 | ✅ |
| UDP Port | 47808 (configurable) | ✅ |
| BBMD Table | Configurable | ✅ |
| FD Registration | Supported | ✅ |

## 7. Firmware / Config Sample Requirements

### 7.1 Device Sample for RBTO
- [ ] Firmware image: `kinexus-bacnet` service + full stack (version TBD at submission)
- [ ] Default config: BACnet/IP enabled, UDP 47808, Device_Instance=1
- [ ] Pre-loaded objects: AI1–8, AO1–4, AV1–32, BI1–8, BO1–4, BV1–16, MSV1–8
- [ ] Network: DHCP or static IP (configurable per lab network)
- [ ] Physical: 1× unit with Ethernet port, PSU, test cable

### 7.2 Config Checklist for Lab
- [ ] Device_Instance set unique per lab network
- [ ] APDU_Timeout=3000, retries=3
- [ ] COV_Increment configured on AI/AO/AV (default 0.1 or per sensor)
- [ ] Notification Class entries configured for alarm routing
- [ ] Schedule objects with test entries
- [ ] Trend Log configured with sample intervals
- [ ] BBMD/FD disabled (single subnet lab)

### 7.3 Setup Instructions (IUT Special Test Instructions)
- [ ] Power-on sequence
- [ ] Network connection diagram
- [ ] BACnet browser (YABE/VTS) verification steps
- [ ] Factory reset procedure
- [ ] Firmware update method (if needed during test)

## 8. BTL Test Package v26.1-v2 Mapping

| BTL Document | Status | Note |
|-------------|:------:|------|
| BTL Functionality Checklist | ❌ Chưa điền | Cần QA điền dựa trên PICS §3 (BIBBs) và §4 (Objects) |
| BTL Test Plan | ❌ Chưa lập | Maps checklist items → executable tests |
| BTL Manual Testing | ❌ Chưa duyệt | Manual procedures backup |
| BTL Specified Tests | ❌ Chưa duyệt | Tests beyond ASHRAE 135.1 |
| BTL Testing Guide | 📖 Tham khảo | Walkthrough for test suite application |
| IUT Special Test Instructions | ❌ Chưa soạn | Device setup guide for RBTO |

## 9. Submission Readiness Summary

| Phase | Item | Owner | Target |
|-------|------|-------|--------|
| 🔴 Pre-submission | Vendor_Identifier (ASHRAE registration) | PMO | Sprint 1 |
| 🔴 Pre-submission | BACnet International membership | CEO | Sprint 1 |
| 🔴 Pre-submission | BTL pre-test tool acquisition | PM | Sprint 2 |
| 🟡 Pre-test | bacnet-stack build + unit test pass | SW Team | Sprint 1 |
| 🟡 Pre-test | Basic BACnet communication verified (YABE/Wireshark) | SW Team | Sprint 1 |
| 🟡 Pre-test | BTS trial run 100% B-ASC tests | QA | Sprint 2 |
| 🟢 Formal | RBTO selected (PTL/MBS/TÜV SÜD/KTC) | PMO | Sprint 2 |
| 🟢 Formal | Lab booked (4–6 tuần lead time) | PM | Sprint 2 |
| 🟢 Formal | Device sample + docs sent to lab | SW + PM | Sprint 3 |
| 🟢 Formal | BTL certification received | — | Sprint 4 |

## 10. Open TBDs

| Ref | Item | Impact if not resolved |
|:---:|------|------------------------|
| TBD-01 | Vendor_Identifier chưa đăng ký ASHRAE | Device Object không hợp lệ, BTL reject |
| TBD-02 | BACnet International membership chưa quyết định | Mất discount 35–50% trên pre-test tool, không priority queue |
| TBD-03 | RBTO chưa chọn | Không thể book lab, schedule trượt |
| TBD-04 | Pre-test tool chưa mua | Không thể pre-test nội bộ, risk BTL fail cao |
| TBD-05 | Lab chưa book | Lead time 4–6 tuần → risk GA delay |
| TBD-06 | BTL Functionality Checklist chưa điền | RBTO cần để mapping test |
| TBD-07 | IUT Special Test Instructions chưa soạn | RBTO không biết cách setup device |
| TBD-08 | Pre-test pass chưa đạt | Block gửi RBTO |

---

**Rev** 1.0 | 2026-06-02 · DeveloperTeam (IOT-5478)
