# bacnet-stack BTL Gap Analysis — MK-DDC-24

> **Document ID:** EVD-BTL-GAP-MK-DDC-24-VI · **Rev** 1.0 | 2026-06-02
> **Parent:** [IOT-5482] · **Upstream:** IOT-5466
> **Inputs:**
>   - `design/interfaces/BACNET_PICS_EPICS_MK-DDC-24_VI.md` (Rev 1.1)
>   - `design/software/SW_BACNET_DESIGN_MK-DDC-24_VI.md` (Rev 1.0)
>   - `docs/00_management/evidence/certification/btl-lab-candidate-analysis.md` (Rev 2.0)
>   - `docs/00_management/evidence/certification/btl-submission-checklist.md` (Rev 1.0)
>   - `docs/00_management/evidence/certification/bacnet-object-property-test-matrix.md` (Rev 1.0)
> **Profile target:** B-ASC (ASHRAE 135-2020) · **BTL Test Package:** v26.1-v2

---

## Severity Legend

| Severity | Meaning | Response |
|----------|---------|----------|
| **Critical** | Blocks BTL submission; no workaround | Must resolve before pre-test |
| **High** | Likely BTL CTT failure; workaround risky | Must resolve before formal submission |
| **Medium** | May cause BTL CTT failure or documentation reject | Resolve before formal submission |
| **Low** | Operational / process; does not block pass | Resolve before GA |

---

## Severity Summary

| Severity | Count | Section |
|:--------:|:-----:|---------|
| Critical | 2 | GAP-BIBB-08, GAP-PRE-01 |
| High | 9 | GAP-BIBB-01, GAP-BIBB-03, GAP-BIBB-05, GAP-BIBB-06, GAP-OBJ-02, GAP-PRE-02, GAP-DOC-01, GAP-DOC-02, GAP-SMP-02 |
| Medium | 7 | GAP-BIBB-02, GAP-BIBB-04, GAP-OBJ-01, GAP-OBJ-03, GAP-OBJ-04, GAP-OBJ-05, GAP-SMP-01 |
| Low | 2 | GAP-SMP-03, GAP-SMP-04 |
| **Total** | **20** | |

---

## 1. BIBB / Service Conformance Gaps

### GAP-BIBB-01: AE-ACK-B (AcknowledgeAlarm) handler not confirmed in SW design

| Field | Value |
|-------|-------|
| **BIBB** | AE-ACK-B (Alarm Acknowledge) |
| **Severity** | **High** |
| **Status** | ❌ Unconfirmed |
| **Gap** | PICS §3 (line 47) claims AE-ACK-B support, but SW design (§5) only documents Confirmed-Event-Notification via alarm.sock. No AcknowledgeAlarm callback handler is described. bacnet-stack provides `handler_ack_alarm.c` — must verify it is wired and tested with Notification Class. |
| **Owner suggestion** | SW Team: verify `handler_ack_alarm.c` is included, wired to Event Enrollment, and returns proper acknowledgment. |
| **Evidence** | PICS §3 AE-ACK-B line 47 vs SW design §5 lines 44–46 (no AcknowledgeAlarm mention) |
| **Recommended next issue** | **IOT-XXXX: Wire and test AE-ACK-B AcknowledgeAlarm handler** |

---

### GAP-BIBB-02: DM-DOB-B (Who-Has/I-Have) implementation scope unclear

| Field | Value |
|-------|-------|
| **BIBB** | DM-DOB-B (Dynamic Object Binding — Who-Has/I-Have) |
| **Severity** | **Medium** |
| **Status** | ⚠️ Unclear |
| **Gap** | PICS §3 (line 52) claims DM-DOB-B, but SW design (§5 line 44) only names "Who-Is/I-Am". Who-Has/I-Have is not explicitly called out. bacnet-stack provides `handler_whohas.c` / `handler_ihave.c` — must verify enabled and tested. B-ASC does not require DM-DOB-B, but if claimed in PICS, BTL CTT will test it. |
| **Owner suggestion** | SW Team: verify `handler_whohas.c` / `handler_ihave.c` are compiled, registered, and can respond to Who-Has queries. |
| **Evidence** | PICS §3 DM-DOB-B line 52 vs SW design §5 line 44 (only DM-DDB-B named) |
| **Recommended next issue** | **IOT-XXXX: Verify DM-DOB-B Who-Has/I-Have implementation** |

---

### GAP-BIBB-03: Schedule object execution engine not documented

| Field | Value |
|-------|-------|
| **BIBB** | SCHED-I-B (Scheduling-Internal) |
| **Severity** | **High** |
| **Status** | ❌ Insufficient |
| **Gap** | PICS §4 declares 8 Schedule objects. SW design (§3 line 22) lists Schedule in the init object registration comment. However, the **schedule evaluation engine** — the periodic task that checks Weekly_Schedule, Exception_Schedule, Effective_Period, and writes Present_Value to the target object — is not described anywhere in SW design. BTL CTT configures a Schedule, writes Effective_Period + Weekly_Schedule, and verifies the target object value changes at the expected time. Without an evaluation engine, this will fail. |
| **Owner suggestion** | SW Team: design and document the schedule evaluation task (period, lock strategy, write-priority to target, Calendar exception integration). |
| **Evidence** | SW design §3 line 22 (mere object declaration); no schedule evaluator, no timer, no Calendar link described. |
| **Recommended next issue** | **IOT-XXXX: Implement Schedule object evaluation engine** |

---

### GAP-BIBB-04: Calendar/Schedule integration not documented

| Field | Value |
|-------|-------|
| **BIBB** | SCHED-I-B (via Calendar dependency) |
| **Severity** | **Medium** |
| **Status** | ❌ Insufficient |
| **Gap** | PICS §4 declares 2 Calendar objects. Calendar serves as exception-date input to Schedule. SW design mentions neither Calendar object handling nor the Schedule→Calendar linkage for exception days. bacnet-stack provides Calendar types; must confirm Date_List entry types (date, range, week-of-year, holiday) and how Schedule.Exception_Schedule references Calendar entries. |
| **Owner suggestion** | SW Team: implement Calendar object with supported Date_List entry types; document Schedule→Calendar exception resolution logic. |
| **Evidence** | PICS §4 Calendar row (no SW design mention); btl-submission-checklist.md §3; bacnet-object-property-test-matrix §11, §15 TBD-8 |
| **Recommended next issue** | **IOT-XXXX: Implement Calendar object with Schedule integration** |

---

### GAP-BIBB-05: Trend Log buffer implementation not documented

| Field | Value |
|-------|-------|
| **BIBB** | T-VMT-I-B (Trend Viewing — internal buffer) |
| **Severity** | **High** |
| **Status** | ❌ Insufficient |
| **Gap** | PICS §4 declares 8 Trend Log objects. SW design lists TrendLog in the init comment (§3 line 22). No circular buffer, storage strategy (RAM/disk), buffer depth, or log retrieval mechanism is described. BTL CTT configures a Trend Log with Log_DeviceObjectProperty + Log_Interval, waits for records, then reads Log_Buffer_Size, Record_Count, and individual trend data. Without a confirmed logging engine, this will fail. |
| **Owner suggestion** | SW Team: document Trend Log circular buffer design (memory allocation per instance, logging modes supported (polled/COV/triggered), stop-when-overflow behavior, buffer depth). |
| **Evidence** | SW design §3 line 22 (mere declaration); bacnet-object-property-test-matrix §9 with 22 properties, TBD-2 (buffer size), TBD-7 (logging modes) |
| **Recommended next issue** | **IOT-XXXX: Implement Trend Log buffer and logging engine** |

---

### GAP-BIBB-06: Event Enrollment parameter ranges not specified

| Field | Value |
|-------|-------|
| **BIBB** | AE-N-I-B (Alarm/Event Notification-Internal) |
| **Severity** | **High** |
| **Status** | ❌ Undefined |
| **Gap** | PICS §4 declares 8 Event Enrollment objects. SW design mentions alarm via Notification Class + alarm.sock (§5 line 46), but does not specify which Event_Type values (CHANGE_OF_STATE, FLOATING_LIMIT, OUT_OF_RANGE, COMMAND_FAILURE) are supported or their parameter ranges (High_Limit, Low_Limit, Time_Delay, Buffer_Size). BTL CTT configures Event_Type + Event_Parameters and verifies event state transitions. |
| **Owner suggestion** | SW Team: specify supported Event_Type values, parameter limits, and time-delay ranges for Event Enrollment. Document in SW design. |
| **Evidence** | PICS §4 Event Enrollment 8 instances; SW design §5 line 46 (alarm.sock generic); bacnet-object-property-test-matrix §13 with 16 properties, TBD-4 |
| **Recommended next issue** | **IOT-XXXX: Implement Event Enrollment parameter handling** |

### GAP-BIBB-08: Vendor_Identifier not registered with ASHRAE

| Field | Value |
|-------|-------|
| **BIBB** | Device Object (all BIBBs depend on valid Vendor ID) |
| **Severity** | **Critical** |
| **Status** | ❌ Not registered |
| **Gap** | PICS §7 (line 102) records Vendor_Identifier as `<đăng ký ASHRAE — TBD>`. Without an ASHRAE-assigned Vendor ID, the Device Object is invalid per ASHRAE 135-2020 §21.1.2.1, and BTL will reject the submission outright. Registration requires annual fee payment and committee approval (~2–4 weeks). PICS §10 TBD-01 assigns this to PMO. |
| **Owner suggestion** | PMO: register with ASHRAE BACnet committee (https://bacnet.org/get-involved/join-bacnet/) to obtain Vendor ID. Budget ~$500–1000/yr for Vendor ID maintenance. |
| **Evidence** | PICS §7 line 102 (Vendor_Identifier TBD); PICS §10 TBD-01 line 152; btl-submission-checklist.md §7 line 22 and §9 line 143 |
| **Recommended next issue** | **IOT-XXXX: Register ASHRAE BACnet Vendor Identifier** |

---

## 2. Object / Property Conformance Gaps

### GAP-OBJ-01: Device Object optional properties may be missing

| Field | Value |
|-------|-------|
| **Object** | Device |
| **Severity** | **Medium** |
| **Status** | ⚠️ Unconfirmed |
| **Gap** | BTL CTT reads optional Device properties (Local_Date, Local_Time, UTC_Offset, Daylight_Savings_Status, Day_of_Week, Time_Distance, Active_COV_Subscriptions, Last_Restore_Time, Backup_Failure_Timeout). PICS §7 only lists the mandatory subset. bacnet-stack provides `device.c` with many of these; must verify all are populated with correct runtime values. |
| **Owner suggestion** | SW Team: walk `device.c` in bacnet-stack and confirm all optional Device properties return valid data at runtime. |
| **Evidence** | bacnet-object-property-test-matrix §1 rows 1.24–1.32 (9 optional Device properties) |
| **Recommended next issue** | **IOT-XXXX: Verify bacnet-stack Device optional property support** |

---

### GAP-OBJ-02: Trend Log Buffer_Size_Bytes allocation unknown

| Field | Value |
|-------|-------|
| **Object** | Trend Log |
| **Severity** | **High** |
| **Status** | ❌ Unknown |
| **Gap** | BTL CTT reads Trend_Log.Log_Buffer_Size and expects it to match actual allocated record capacity. The firmware RAM budget for trend buffers (8 instances × N records × record_size) is not specified. If BTL reads Log_Buffer_Size=100 but the buffer holds 50 records, the test fails. |
| **Owner suggestion** | SW Team: define per-instance log buffer size in records and ensure Log_Buffer_Size property returns the correct value. |
| **Evidence** | bacnet-object-property-test-matrix §9.18 (Buffer_Size_Bytes), §15 TBD-2 |
| **Recommended next issue** | **IOT-XXXX: Define Trend Log buffer allocation per instance** |

---

### GAP-OBJ-03: Binary Input Polarity property unconfirmed

| Field | Value |
|-------|-------|
| **Object** | BI |
| **Severity** | **Medium** |
| **Status** | ⚠️ Unconfirmed |
| **Gap** | BTL CTT expects BI objects to support Polarity property (NORMAL/REVERSE). PICS §4.1 lists AI properties as an example but does not mention BI Polarity. SW design does not describe BI Polarity. Must confirm bacnet-stack default (likely NORMAL) and verify BTL CTT passes. |
| **Owner suggestion** | SW Team: confirm BI Polarity default is NORMAL; verify bacnet-stack exposes the property. |
| **Evidence** | bacnet-object-property-test-matrix §5.8 (Polarity M for BI) |
| **Recommended next issue** | **IOT-XXXX: Verify BI Polarity default and BTL CTT pass** |

---

### GAP-OBJ-04: Reliability property on non-AI object types unconfirmed

| Field | Value |
|-------|-------|
| **Object** | AO, AV, BI, BO, BV, MSV, Schedule, Calendar, NC, EE |
| **Severity** | **Medium** |
| **Status** | ⚠️ Unconfirmed |
| **Gap** | PICS §4.1 describes Reliability only for AI with fault mapping (E201–E204). BTL CTT checks Reliability on all object types where ASHRAE 135-2020 marks it mandatory. bacnet-stack likely returns NO_FAULT_DETECTED for most non-sensor objects, but this must be confirmed per type. Event Enrollment and Schedule may need reliability transition logic. |
| **Owner suggestion** | SW Team: verify bacnet-stack returns valid Reliability for all mandatory object types. |
| **Evidence** | PICS §4.1 (AI only); bacnet-object-property-test-matrix marks Reliability as M on AO (§3.12), AV (§4.10), BI (§5.11), BO (§6.13), BV (§7.10), MSV (§8.10), Schedule (§10.14), Calendar (§11.9), NC (§12.9 — lower table), EE (§13.13) |
| **Recommended next issue** | **IOT-XXXX: Implement Reliability property on all mandatory object types** |

---

### GAP-OBJ-05: Device Object Services_Supported / Object_Types_Supported bitmaps

| Field | Value |
|-------|-------|
| **Object** | Device |
| **Severity** | **Medium** |
| **Status** | ⚠️ Unconfirmed |
| **Gap** | BTL CTT reads Device.Services_Supported and Device.Object_Types_Supported bitmaps and cross-checks them against the PICS declaration. If a BIBB is claimed in PICS but its service bit is not set, or vice versa, the CTT flags a conformance error. Must verify bacnet-stack `device.c` bitmaps are configured to match PICS §3 and §4 exactly. |
| **Owner suggestion** | SW Team: audit `dc_services` and `object_types_supported` arrays in bacnet-stack `device.c` against PICS BIBB/object tables. |
| **Evidence** | bacnet-object-property-test-matrix §1.12 (Services_Supported), §1.13 (Object_Types_Supported); PICS §3 (BIBBs), §4 (objects) |
| **Recommended next issue** | **IOT-XXXX: Align Device.Services_Supported / Object_Types_Supported bitmaps with PICS** |

---

## 3. Sample / Device Configuration Gaps

### GAP-SMP-01: Firmware versioning scheme for BTL submission

| Field | Value |
|-------|-------|
| **Category** | Sample config |
| **Severity** | **Medium** |
| **Status** | ❌ TBD |
| **Gap** | btl-submission-checklist.md §7.1 marks firmware version as "TBD at submission." BTL CTT reads Device.Firmware_Revision and Device.Application_Software_Version. These must be stable, semantic, and traceable to a build tag so the RBTO can identify the exact IUT. |
| **Owner suggestion** | SW Lead: define firmware version scheme (e.g., `1.0.0-btl-rc1`), tag in git, and bake into `device.c` at build time. |
| **Evidence** | btl-submission-checklist.md §7.1; bacnet-object-property-test-matrix §1.8, §1.9 |
| **Recommended next issue** | **IOT-XXXX: Define BTL sample firmware versioning and build tag scheme** |

---

### GAP-SMP-02: BACnet International membership (TBD-02)

| Field | Value |
|-------|-------|
| **Category** | Business/process |
| **Severity** | **High** |
| **Status** | ❌ Undecided |
| **Gap** | PICS §10 TBD-02 records membership as not decided. Without Silver membership, the BTL Lab (PTL) hourly rate is $150 vs $75 with membership, the BOTS pre-test tool license is ~$2K/yr without 35% discount, and there is no priority queue. btl-lab-candidate-analysis §6 shows membership pays for itself after ~67 hours of testing. Without membership, budget envelope $10K–20K may be exceeded. |
| **Owner suggestion** | CEO: authorize Silver membership application; PMO: handle paperwork. |
| **Evidence** | PICS §10 TBD-02; btl-lab-candidate-analysis.md §6 (RoI analysis), §5 (cost comparison) |
| **Recommended next issue** | **IOT-XXXX: Authorize BACnet International Silver Corporate membership** |

---

### GAP-SMP-03: Default Device Instance for lab sample undefined

| Field | Value |
|-------|-------|
| **Category** | Sample config |
| **Severity** | **Low** |
| **Status** | ❌ TBD |
| **Gap** | Device sample needs a fixed default Device_Instance for RBTO setup. PICS §7 specifies range 1–4194302 with DIP bootstrap 1–127. The lab sample should use a fixed value that avoids collision with production ranges. |
| **Owner suggestion** | SW Team: default Device_Instance = 4194301 for lab sample; document in IUT Special Test Instructions. |
| **Evidence** | PICS §7 line 108; btl-submission-checklist.md §7.2 |
| **Recommended next issue** | (Combine with GAP-SMP-04: IOT-XXXX — Set lab sample default configuration) |

---

### GAP-SMP-04: Lab network configuration (DHCP vs static, BBMD/FD)

| Field | Value |
|-------|-------|
| **Category** | Sample config |
| **Severity** | **Low** |
| **Status** | ❌ TBD |
| **Gap** | Device network config for lab is not fixed: DHCP vs static IP, BBMD/FD enabled/disabled. btl-submission-checklist.md §7.2 recommends BBMD/FD disabled (single subnet lab). Need a documented lab-configuration profile. |
| **Owner suggestion** | SW Team: document lab network profile (DHCP + BBMD/FD disabled + default IP fallback 192.168.1.100). |
| **Evidence** | btl-submission-checklist.md §7.2 (BBMD/FD disabled, DHCP or static IP) |
| **Recommended next issue** | (Combine with GAP-SMP-03: IOT-XXXX — Set lab sample default configuration) |

---

## 4. Documentation Gaps for BTL Submission

### GAP-DOC-01: BTL Functionality Checklist not completed

| Field | Value |
|-------|-------|
| **Category** | BTL submission doc |
| **Severity** | **High** |
| **Status** | ❌ Missing |
| **Gap** | PICS §9.3 and btl-submission-checklist.md §8 list the BTL Functionality Checklist as incomplete. This is a self-assessment document (template from BTL Test Package v26.1-v2) that maps PICS BIBBs/objects to BTL test cases. RBTO requires this to plan which tests to run. |
| **Owner suggestion** | QA/SW Lead: download BTL Test Package v26.1-v2 from btl.org, fill the Functionality Checklist per PICS §3 (BIBBs) and §4 (objects). |
| **Evidence** | PICS §9.3 line 141 (❏ BTL Functionality Checklist); btl-submission-checklist.md §8 (Not Started) |
| **Recommended next issue** | **IOT-XXXX: Fill BTL Functionality Checklist from BTL Test Package v26.1-v2** |

---

### GAP-DOC-02: IUT Special Test Instructions not written

| Field | Value |
|-------|-------|
| **Category** | BTL submission doc |
| **Severity** | **High** |
| **Status** | ❌ Missing |
| **Gap** | PICS §9.3 and btl-submission-checklist.md §7.3 list IUT Special Test Instructions as incomplete. This document tells the RBTO how to set up the device: power-on, network connection, verification with BACnet browser, factory reset, firmware update. Without this, the lab cannot test the device. |
| **Owner suggestion** | SW Lead: write IUT Special Test Instructions with power-on sequence, network diagram, YABE/VTS verification steps, factory reset, firmware update instructions. |
| **Evidence** | PICS §9.3 line 142 (❏ IUT Special Test Instructions); btl-submission-checklist.md §7.3 (6-step checklist) |
| **Recommended next issue** | **IOT-XXXX: Write BTL IUT Special Test Instructions** |

---

### GAP-DOC-03: BTL Test Plan not created

| Field | Value |
|-------|-------|
| **Category** | BTL submission doc |
| **Severity** | **Medium** |
| **Status** | ❌ Missing |
| **Gap** | btl-submission-checklist.md §8 lists BTL Test Plan as not started. This document maps BTL Functionality Checklist items to executable test procedures. |
| **Owner suggestion** | QA: create BTL Test Plan after the Functionality Checklist is completed (GAP-DOC-01). |
| **Evidence** | btl-submission-checklist.md §8 (BTL Test Plan: ❌) |
| **Recommended next issue** | **IOT-XXXX: Create BTL Test Plan** |

---

## 5. Pre-test / Infrastructure Gaps

### GAP-PRE-01: No BTL pre-test tool acquired (TBD-04)

| Field | Value |
|-------|-------|
| **Category** | Pre-test infrastructure |
| **Severity** | **Critical** |
| **Status** | ❌ Not acquired |
| **Gap** | PICS §10 TBD-04 records no pre-test tool purchased. Without BTS ($195/mo) or BOTS ($2K/yr), the team cannot run BTL CTT tests internally. The pre-test phase (PICS §9.1 steps 3–5) cannot begin, and G4 gate (NFR-009: pass 100% B-ASC before GA) cannot be verified. btl-lab-candidate-analysis §5 estimates BOTS at $2K/yr (recommended). |
| **Owner suggestion** | PM: acquire BOTS ($2K/yr) after SW team confirms bacnet-stack builds and responds to basic queries (YABE). |
| **Evidence** | PICS §9.1 steps 3–5, §10 TBD-04; btl-lab-candidate-analysis.md §5 ($3K–5K for conformance tool); btl-submission-checklist.md §9 |
| **Recommended next issue** | **IOT-XXXX: Acquire BTL pre-test conformance tool (BOTS)** |

---

### GAP-PRE-02: RBTO not selected, lab not booked (TBD-03 / TBD-05)

| Field | Value |
|-------|-------|
| **Category** | Formal certification |
| **Severity** | **High** |
| **Status** | ❌ Not started |
| **Gap** | PICS §10 TBD-03 (RBTO) and TBD-05 (lab booking) are both open. Lead time is 4–6 weeks. Without selecting an RBTO, the formal certification schedule cannot be locked. btl-lab-candidate-analysis §7 recommends P1 outreach to BTL Lab (PTL) and P2 to KTC by June 6, 2026. |
| **Owner suggestion** | PMO: send outreach emails to BTL Lab (PTL) and KTC per outreach templates in btl-lab-candidate-analysis §8. Target: send by June 6, 2026. |
| **Evidence** | PICS §10 TBD-03, TBD-05; btl-lab-candidate-analysis.md §7 (outreach priority), §8 (email templates) |
| **Recommended next issue** | **IOT-XXXX: Send RBTO outreach and book BTL test slot** |

---

## 6. Sample Device Requirements for BTL Lab Submission

### 6.1 Firmware Requirements

| Requirement | Specification | Owner |
|-------------|---------------|-------|
| **BACnet Stack** | bacnet-stack 1.3.x | SW Team |
| **Firmware Version** | `v1.0.0-btl-rc<N>` (semantic, git-tagged) | SW Lead |
| **Build Target** | Linux Debian 12 (arm64) | SW Team |
| **Pre-loaded Objects** | Device(1), AI(8), AO(4), AV(32), BI(8), BO(4), BV(16), MSV(8), TrendLog(8), Schedule(8), Calendar(2), NotificationClass(4), EventEnrollment(8) | SW Team |
| **Firmware_Revision** | Auto from build system (git describe) | SW Team |
| **Application_Software_Version** | Build date + CI run ID | SW Team |

### 6.2 Network Configuration

| Parameter | Lab Default | Notes |
|-----------|-------------|-------|
| **BIP Port** | UDP 47808 | Standard BACnet/IP |
| **IP Assignment** | DHCP (fallback: 192.168.1.100/24) | Simple lab network |
| **BBMD** | Disabled | Single subnet lab |
| **Foreign Device** | Disabled | Single subnet lab |
| **BACnet Device_Instance** | 4194301 | Clear non-production range |
| **APDU_Timeout** | 3000 ms | Per PICS §7 |
| **Number_Of_APDU_Retries** | 3 | Per PICS §7 |
| **Max_APDU_Length** | 1476 | Per PICS §5 |
| **Segmentation** | segmented-both | Per PICS §5 |

### 6.3 Physical Shipment

| Item | Quantity | Notes |
|------|:--------:|-------|
| MK-DDC-24 unit | 2 | Primary + spare |
| Power supply (24 VDC/VAC) | 2 | 1 per unit |
| Ethernet cable (CAT5e+) | 2 | 1 per unit |
| Quick-start sheet | 1 | Power + connect steps |
| Customs declaration | 1 | Value < $200 (sample), HS code 8537.10 |

### 6.4 Lab Setup Instructions (IUT Special Test Instructions Summary)

1. Connect power (24 VDC/VAC) — unit boots automatically
2. Connect Ethernet to lab network — obtains IP via DHCP
3. Find device IP via router DHCP list or mDNS
4. Verify with BACnet browser (YABE/VTS):
   - Send Who-Is → expect I-Am response
   - Read Device Object properties
5. Default Device_Instance = 4194301
6. Factory reset: hold BOOT button 10s during power-on
7. Firmware update: via microSD or network TFTP (details in IUT document)

---

## 7. Recommended Issues (Implementation Roadmap)

| Priority | Issue Title | Gap Ref | Owner | Target Sprint |
|:--------:|-------------|:-------:|-------|:-------------:|
| P0 | Register ASHRAE Vendor Identifier | GAP-BIBB-08 | PMO | Sprint 1 |
| P0 | Acquire BTL pre-test conformance tool (BOTS) | GAP-PRE-01 | PM | Sprint 1–2 |
| P1 | Implement Schedule object evaluation engine | GAP-BIBB-03 | SW Team | Sprint 2 |
| P1 | Implement Trend Log buffer and logging engine | GAP-BIBB-05 | SW Team | Sprint 2 |
| P1 | Implement Event Enrollment parameter handling | GAP-BIBB-06 | SW Team | Sprint 2 |
| P1 | Wire and test AE-ACK-B AcknowledgeAlarm handler | GAP-BIBB-01 | SW Team | Sprint 2 |
| P1 | Fill BTL Functionality Checklist | GAP-DOC-01 | QA/SW Lead | Sprint 2 |
| P1 | Write BTL IUT Special Test Instructions | GAP-DOC-02 | SW Lead | Sprint 2 |
| P1 | Send RBTO outreach and book BTL test slot | GAP-PRE-02 | PMO | Sprint 2 |
| P1 | Authorize BACnet International Silver membership | GAP-SMP-02 | CEO | Sprint 1–2 |
| P2 | Implement Calendar object with Schedule integration | GAP-BIBB-04 | SW Team | Sprint 2 |
| P2 | Define Trend Log buffer allocation per instance | GAP-OBJ-02 | SW Team | Sprint 2 |
| P2 | Align Device Services_Supported/Object_Types_Supported bitmaps | GAP-OBJ-05 | SW Team | Sprint 2 |
| P2 | Verify bacnet-stack Device optional property support | GAP-OBJ-01 | SW Team | Sprint 2–3 |
| P2 | Implementation Reliability on all mandatory object types | GAP-OBJ-04 | SW Team | Sprint 2–3 |
| P2 | Verify DM-DOB-B Who-Has/I-Have implementation | GAP-BIBB-02 | SW Team | Sprint 2–3 |
| P3 | Verify BI Polarity default and BTL CTT pass | GAP-OBJ-03 | SW Team | Sprint 3 |
| P3 | Define BTL sample firmware versioning and build tag scheme | GAP-SMP-01 | SW Lead | Sprint 2 |
| P3 | Set lab sample default configuration (Device_Instance + network) | GAP-SMP-03/04 | SW Team | Sprint 2–3 |
| P3 | Create BTL Test Plan | GAP-DOC-03 | QA | Sprint 3 |

---

## 8. Traceability

| Input | Section(s) Mapped |
|-------|:-----------------:|
| PICS §3 (BIBBs) | GAP-BIBB-01 through GAP-BIBB-06 |
| PICS §4 (Objects) | GAP-OBJ-01 through GAP-OBJ-05 |
| PICS §7 (Device Object) | GAP-BIBB-08, GAP-OBJ-01, GAP-OBJ-05 |
| PICS §9.3 (BTL docs) | GAP-DOC-01, GAP-DOC-02 |
| PICS §10 (TBDs) | GAP-BIBB-08, GAP-SMP-02, GAP-PRE-01, GAP-PRE-02, GAP-DOC-01, GAP-DOC-02 |
| SW design §3 (init) | GAP-BIBB-03, GAP-BIBB-05 |
| SW design §5 (services) | GAP-BIBB-01, GAP-BIBB-02 |
| btl-lab-candidate-analysis.md | GAP-SMP-02, GAP-PRE-01, GAP-PRE-02 |
| btl-submission-checklist.md | GAP-DOC-01, GAP-DOC-02, GAP-DOC-03, GAP-SMP-01, GAP-SMP-03, GAP-SMP-04 |
| bacnet-object-property-test-matrix.md | GAP-OBJ-01 through GAP-OBJ-05 |

---

> **Rev** 1.0 | 2026-06-02 · DeveloperTeam (IOT-5482)
> **Gap count:** 20 (2 critical, 9 high, 7 medium, 2 low)
> **Verification:** `grep -c '^\| \*\*' docs/00_management/evidence/certification/bacnet-stack-btl-gap-analysis.md`
