# BACnet Object/Property BTL Test Matrix

> **Document ID:** EVD-BTL-MATRIX-MK-DDC-24-VI · **Rev** 1.1 | 2026-06-30 (§2.10: Reliability 8 values per ADR-011; §3.2/3.8/3.13/3.14: AO Name+Units+Min+Max required per ADR-012; §14.1: R-01..R-11 Reliability test cases; §14.2: AO-01..AO-11 AO property test cases) · 1.0 | 2026-06-02
> **Objective:** Map all BACnet objects/properties for BTL pre-test (B-ASC profile)
> **Parent:** IOT-5466 · **Input:** [PICS](../../../02_design/interfaces/BACNET_PICS_EPICS_MK-DDC-24_VI.md), [SW Design](../../../02_design/software/SW_BACNET_DESIGN_MK-DDC-24_VI.md)
> **BTL Target Package:** v26.1-v2 · **Profile:** B-ASC (ASHRAE 135-2020)

---

## 1. Device Object

| # | Property | BTL Req | Writable | COV | Source | Notes |
|---|----------|:-------:|:--------:|:---:|--------|-------|
| 1.1 | Object_Identifier | M | — | — | PICS §7 | fixed per device |
| 1.2 | Object_Name | M | ✅ | — | PICS §4.3 | configurable via Web UI |
| 1.3 | Object_Type | M | — | — | PICS §7 | always DEVICE = 8 |
| 1.4 | System_Status | M | — | — | ASHRAE 135-2020 §12 | operational / non-operational |
| 1.5 | Vendor_Name | M | — | — | PICS §7 | "KINEXUS Technologies" |
| 1.6 | Vendor_Identifier | M | — | — | PICS §7 | **TBD** — ASHRAE registration pending |
| 1.7 | Model_Name | M | — | — | PICS §7 | "MK-DDC-24" |
| 1.8 | Firmware_Revision | M | — | — | — | from build system |
| 1.9 | Application_Software_Version | M | — | — | — | from build system |
| 1.10 | Protocol_Version | M | — | — | PICS §7 | 1 |
| 1.11 | Protocol_Revision | M | — | — | PICS §7 | ≥ 19 |
| 1.12 | Services_Supported | M | — | — | PICS §3 | bit map of supported BIBBs |
| 1.13 | Object_Types_Supported | M | — | — | PICS §4 | bit map of supported object types |
| 1.14 | Object_List | M | — | — | — | lists all device instances |
| 1.15 | Max_APDU_Length_Accepted | M | — | — | PICS §5 | 1476 |
| 1.16 | Segmentation_Supported | M | — | — | PICS §5 | segmented-both |
| 1.17 | APDU_Timeout | M | — | — | PICS §7 | 3000 ms |
| 1.18 | Number_Of_APDU_Retries | M | — | — | PICS §7 | 3 |
| 1.19 | Device_Address_Binding | M | — | — | — | BBMD/FD registration table |
| 1.20 | Database_Revision | M | — | — | — | increments on object add/delete |
| 1.21 | Configuration_Revision | O | ✅ | — | — | config version tracking |
| 1.22 | Description | O | ✅ | — | — | user-configurable device description |
| 1.23 | Location | O | ✅ | — | — | user-configurable location |
| 1.24 | Active_COV_Subscriptions | O | — | — | — | BTL may query for COV diagnostics |
| 1.25 | Last_Restore_Time | O | — | — | — | restore tracking |
| 1.26 | Backup_Failure_Timeout | O | ✅ | — | — | backup config |
| 1.27 | Day_of_Week | O | — | — | — | time sync reference |
| 1.28 | Time_Distance | O | — | — | — | time sync reference |
| 1.29 | UTC_Offset | O | — | — | — | time sync reference |
| 1.30 | Daylight_Savings_Status | O | — | — | — | time sync reference |
| 1.31 | Local_Date | O | — | — | — | time sync reference |
| 1.32 | Local_Time | O | — | — | — | time sync reference |

> **Device object count:** 1 instance

---

## 2. Analog Input (AI) — 16 instances (AI1–AI16)

| # | Property | BTL Req | Writable | COV | Source | Notes |
|---|----------|:-------:|:--------:|:---:|--------|-------|
| 2.1 | Object_Identifier | M | — | — | PICS §4 | instance 1–8 |
| 2.2 | Object_Name | M | ✅ | — | PICS §4.3 | default "AI1".."AI8" |
| 2.3 | Object_Type | M | — | — | | always ANALOG_INPUT = 0 |
| 2.4 | Present_Value | M | — | ✅ | PICS §4 | read from `plc_shm.ai` |
| 2.5 | Status_Flags | M | — | — | PICS §4 | IN_ALARM/FAULT/OVERRIDDEN/OUT_OF_SERVICE |
| 2.6 | Event_State | M | — | — | | NORMAL / FAULT / HIGH_LIMIT / LOW_LIMIT |
| 2.7 | Out_Of_Service | M | ✅ | — | PICS §4 | writable for test/bypass |
| 2.8 | Units | M | — | — | PICS §4.1 | per sensor config (°C, V, mA, etc.) |
| 2.9 | COV_Increment | O | ✅ | — | PICS §4 | writable for COV tuning |
| 2.10 | Reliability | M | — | — | PICS §4.1, ADR-011 | 8 values: NO_FAULT_DETECTED / OVER_RANGE / UNDER_RANGE / OPEN_LOOP / SHORTED_LOOP / UNRELIABLE_OTHER / **CONFIGURATION_ERROR** / **COMMUNICATION_FAILURE** |
| 2.11 | Update_Interval | O | — | — | | measurement sampling rate |
| 2.12 | Min_Pres_Value | O | — | — | | sensor min range |
| 2.13 | Max_Pres_Value | O | — | — | | sensor max range |
| 2.14 | Resolution | O | — | — | | sensor resolution |
| 2.15 | Profile_Name | O | — | — | | BTL standard object profile (TBD) |

---

## 3. Analog Output (AO) — 4 instances (AO1–AO4)

| # | Property | BTL Req | Writable | COV | Source | Notes |
|---|----------|:-------:|:--------:|:---:|--------|-------|
| 3.1 | Object_Identifier | M | — | — | PICS §4 | instance 1–4 |
| 3.2 | Object_Name | M | ✅ | — | PICS §4.3, ADR-012 | từ `ao[].name` trong io_config.conf; default "AO1".."AO4" |
| 3.3 | Object_Type | M | — | — | | always ANALOG_OUTPUT = 1 |
| 3.4 | Present_Value | M | ✅ | ✅ | PICS §4 | commandable via Priority_Array; engineering unit per min_pv/max_pv |
| 3.5 | Status_Flags | M | — | — | | |
| 3.6 | Event_State | M | — | — | | |
| 3.7 | Out_Of_Service | M | ✅ | — | | |
| 3.8 | Units | M | — | — | ADR-012 | từ `ao[].units`; auto: volts(5) khi 0-10V, milliamperes(2) khi 4-20mA |
| 3.9 | Priority_Array | M | — | — | PICS §4.2 | 16 levels |
| 3.10 | Relinquish_Default | M | — | — | PICS §4.2, io_safe_state.conf | fallback khi tất cả priority null; load từ io_safe_state.conf |
| 3.11 | COV_Increment | O | ✅ | — | | |
| 3.12 | Reliability | M | — | — | ADR-011 | NO_FAULT_DETECTED / COMMUNICATION_FAILURE (khi IOP fault) |
| 3.13 | Min_Pres_Value | M | — | — | ADR-012 | từ `ao[].min_pv`; default 0.0; **M per ASHRAE 135-2020 §12.4** |
| 3.14 | Max_Pres_Value | M | — | — | ADR-012 | từ `ao[].max_pv`; default 10.0V/20.0mA; **M per ASHRAE 135-2020 §12.4** |
| 3.15 | Resolution | O | — | — | | |
| 3.16 | Profile_Name | O | — | — | | |

---

## 4. Analog Value (AV) — 32 instances (AV1–AV32)

| # | Property | BTL Req | Writable | COV | Source | Notes |
|---|----------|:-------:|:--------:|:---:|--------|-------|
| 4.1 | Object_Identifier | M | — | — | PICS §4 | instance 1–32 |
| 4.2 | Object_Name | M | ✅ | — | | default "AV1".."AV32" |
| 4.3 | Object_Type | M | — | — | | always ANALOG_VALUE = 2 |
| 4.4 | Present_Value | M | ✅ | ✅ | PICS §4 | writable PLC variable |
| 4.5 | Status_Flags | M | — | — | | |
| 4.6 | Event_State | M | — | — | | |
| 4.7 | Out_Of_Service | M | ✅ | — | | |
| 4.8 | Units | M | — | — | | device-dependent (no_units=95 for PLC vars) |
| 4.9 | COV_Increment | O | ✅ | — | | |
| 4.10 | Reliability | M | — | — | | |
| 4.11 | Min_Pres_Value | O | — | — | | if bounded |
| 4.12 | Max_Pres_Value | O | — | — | | if bounded |
| 4.13 | Profile_Name | O | — | — | | |

---

## 5. Binary Input (BI) — optional SKU only

Base SKU (`BOARD_CAP_MAP=0x000D`) has no physical industrial DI and shall not be certified as exposing DI1–DI8. Run the BI1–BI8 matrix below only on the optional isolated-DI SKU with the matching capability bit.

| # | Property | BTL Req | Writable | COV | Source | Notes |
|---|----------|:-------:|:--------:|:---:|--------|-------|
| 5.1 | Object_Identifier | M | — | — | PICS §4 | instance 1–8 |
| 5.2 | Object_Name | M | ✅ | — | | default "BI1".."BI8" |
| 5.3 | Object_Type | M | — | — | | always BINARY_INPUT = 3 |
| 5.4 | Present_Value | M | — | ✅ | PICS §4 | read from optional isolated DI1–DI8 |
| 5.5 | Status_Flags | M | — | — | | |
| 5.6 | Event_State | M | — | — | | |
| 5.7 | Out_Of_Service | M | ✅ | — | | |
| 5.8 | Polarity | M | — | — | | NORMAL / REVERSE |
| 5.9 | Inactive_Text | O | ✅ | — | | user-configurable label |
| 5.10 | Active_Text | O | ✅ | — | | user-configurable label |
| 5.11 | Reliability | M | — | — | | |
| 5.12 | Elapsed_Active_Time | O | — | — | | runtime tracking |
| 5.13 | Time_Of_Active_Time_Reset | O | — | — | | |
| 5.14 | Profile_Name | O | — | — | | |

---

## 6. Binary Output (BO) — 4 instances (DO1–DO4 via BO1–BO4)

| # | Property | BTL Req | Writable | COV | Source | Notes |
|---|----------|:-------:|:--------:|:---:|--------|-------|
| 6.1 | Object_Identifier | M | — | — | PICS §4 | instance 1–4 |
| 6.2 | Object_Name | M | ✅ | — | | default "BO1".."BO4" |
| 6.3 | Object_Type | M | — | — | | always BINARY_OUTPUT = 4 |
| 6.4 | Present_Value | M | ✅ | ✅ | PICS §4 | commandable via Priority_Array |
| 6.5 | Status_Flags | M | — | — | | |
| 6.6 | Event_State | M | — | — | | |
| 6.7 | Out_Of_Service | M | ✅ | — | | |
| 6.8 | Polarity | M | — | — | | NORMAL |
| 6.9 | Priority_Array | M | — | — | PICS §4.2 | 16 levels |
| 6.10 | Relinquish_Default | M | — | — | PICS §4.2 | |
| 6.11 | Inactive_Text | O | ✅ | — | | |
| 6.12 | Active_Text | O | ✅ | — | | |
| 6.13 | Reliability | M | — | — | | |
| 6.14 | Minimum_Off_Time | O | ✅ | — | | protective timing |
| 6.15 | Minimum_On_Time | O | ✅ | — | | protective timing |
| 6.16 | Profile_Name | O | — | — | | |

---

## 7. Binary Value (BV) — 16 instances (BV1–BV16)

| # | Property | BTL Req | Writable | COV | Source | Notes |
|---|----------|:-------:|:--------:|:---:|--------|-------|
| 7.1 | Object_Identifier | M | — | — | PICS §4 | instance 1–16 |
| 7.2 | Object_Name | M | ✅ | — | | default "BV1".."BV16" |
| 7.3 | Object_Type | M | — | — | | always BINARY_VALUE = 5 |
| 7.4 | Present_Value | M | ✅ | ✅ | PICS §4 | writable PLC variable |
| 7.5 | Status_Flags | M | — | — | | |
| 7.6 | Event_State | M | — | — | | |
| 7.7 | Out_Of_Service | M | ✅ | — | | |
| 7.8 | Inactive_Text | O | ✅ | — | | |
| 7.9 | Active_Text | O | ✅ | — | | |
| 7.10 | Reliability | M | — | — | | |
| 7.11 | Elapsed_Active_Time | O | — | — | | |
| 7.12 | Profile_Name | O | — | — | | |

---

## 8. Multi-state Value (MSV) — 8 instances (MSV1–MSV8)

| # | Property | BTL Req | Writable | COV | Source | Notes |
|---|----------|:-------:|:--------:|:---:|--------|-------|
| 8.1 | Object_Identifier | M | — | — | PICS §4 | instance 1–8 |
| 8.2 | Object_Name | M | ✅ | — | | default "MSV1".."MSV8" |
| 8.3 | Object_Type | M | — | — | | always MULTI_STATE_VALUE = 19 |
| 8.4 | Present_Value | M | ✅ | ✅ | PICS §4 | writable PLC enum |
| 8.5 | Status_Flags | M | — | — | | |
| 8.6 | Event_State | M | — | — | | |
| 8.7 | Out_Of_Service | M | ✅ | — | | |
| 8.8 | Number_Of_States | M | — | — | | configurable per MSV |
| 8.9 | State_Text | O | ✅ | — | | user-configurable labels |
| 8.10 | Reliability | M | — | — | | |
| 8.11 | Profile_Name | O | — | — | | |

---

## 9. Trend Log — 8 instances

| # | Property | BTL Req | Writable | COV | Source | Notes |
|---|----------|:-------:|:--------:|:---:|--------|-------|
| 9.1 | Object_Identifier | M | — | — | PICS §4 | instance 1–8 |
| 9.2 | Object_Name | M | ✅ | — | | |
| 9.3 | Object_Type | M | — | — | | always TREND_LOG = 20 |
| 9.4 | Description | M | ✅ | — | | |
| 9.5 | Enable | M | ✅ | — | | start/stop logging |
| 9.6 | Log_DeviceObjectProperty | M | ✅ | — | | monitored object/property |
| 9.7 | Logging_Type | M | ✅ | — | | polled / COV / triggered |
| 9.8 | Log_Buffer_Size | M | — | — | | fixed per instance |
| 9.9 | Record_Count | M | — | — | | current records in buffer |
| 9.10 | Total_Record_Count | M | — | — | | lifetime records logged |
| 9.11 | Notification_Threshold | O | ✅ | — | | alarm when buffer fills |
| 9.12 | Records_Since_Notification | M | — | — | | |
| 9.13 | Last_Notify_Record | M | — | — | | |
| 9.14 | Notification_Class | O | ✅ | — | | alarm routing |
| 9.15 | Event_State | M | — | — | | |
| 9.16 | Log_Interval | O | ✅ | — | | polled-mode interval |
| 9.17 | Stop_When_Overflow | M | ✅ | — | | wrap or stop |
| 9.18 | Buffer_Size_Bytes | M | — | — | BTL | fixed RAM allocation |
| 9.19 | Event_Detection_Enable | O | ✅ | — | | |
| 9.20 | Notification_Filter | O | ✅ | — | | |
| 9.21 | Record_Filter | O | ✅ | — | | |
| 9.22 | Profile_Name | O | — | — | | |

> **Note:** Trend Log implementation details (buffer depth, logging intervals) depend on `bacnet-stack` configuration. BTL expects `Log_Buffer_Size` to match actual allocated capacity.

---

## 10. Schedule — 8 instances

| # | Property | BTL Req | Writable | COV | Source | Notes |
|---|----------|:-------:|:--------:|:---:|--------|-------|
| 10.1 | Object_Identifier | M | — | — | PICS §4 | instance 1–8 |
| 10.2 | Object_Name | M | ✅ | — | | |
| 10.3 | Object_Type | M | — | — | | always SCHEDULE = 17 |
| 10.4 | Description | M | ✅ | — | | |
| 10.5 | Present_Value | M | — | — | | effective value (derived) |
| 10.6 | Effective_Period | M | ✅ | — | | start/end date range |
| 10.7 | Weekly_Schedule | M | ✅ | — | | 7-day schedule |
| 10.8 | Schedule_Default | M | ✅ | — | | fallback outside effective period |
| 10.9 | List_Of_Object_Property_References | M | ✅ | — | | target objects for schedule output |
| 10.10 | Priority_For_Writing | M | ✅ | — | | priority to write at |
| 10.11 | Exception_Schedule | M | ✅ | — | | holiday/special day overrides |
| 10.12 | Status_Flags | M | — | — | | |
| 10.13 | Event_State | M | — | — | | |
| 10.14 | Reliability | M | — | — | | |
| 10.15 | Profile_Name | O | — | — | | |

---

## 11. Calendar — 2 instances

| # | Property | BTL Req | Writable | COV | Source | Notes |
|---|----------|:-------:|:--------:|:---:|--------|-------|
| 11.1 | Object_Identifier | M | — | — | PICS §4 | instance 1–2 |
| 11.2 | Object_Name | M | ✅ | — | | |
| 11.3 | Object_Type | M | — | — | | always CALENDAR = 16 |
| 11.4 | Description | M | ✅ | — | | |
| 11.5 | Present_Value | M | — | — | | derived: true if current date in Date_List |
| 11.6 | Date_List | M | ✅ | — | | list of calendar entries |
| 11.7 | Status_Flags | M | — | — | | |
| 11.8 | Event_State | M | — | — | | |
| 11.9 | Reliability | M | — | — | | |
| 11.10 | Profile_Name | O | — | — | | |

---

## 12. Notification Class — 4 instances

| # | Property | BTL Req | Writable | COV | Source | Notes |
|---|----------|:-------:|:--------:|:---:|--------|-------|
| 12.1 | Object_Identifier | M | — | — | PICS §4 | instance 1–4 |
| 12.2 | Object_Name | M | ✅ | — | | |
| 12.3 | Object_Type | M | — | — | | always NOTIFICATION_CLASS = 15 |
| 12.4 | Description | M | ✅ | — | | |
| 12.5 | Notification_Class | M | — | — | | class number (1–4) |
| 12.6 | Priority | M | ✅ | — | | array [3] for (acked, unack normal, unack high) |
| 12.7 | Ack_Required | M | ✅ | — | | array [3] of boolean |
| 12.8 | Recipient_List | M | ✅ | — | | list of (device, process) pairs |
| 12.9 | Profile_Name | O | — | — | | |

---

## 13. Event Enrollment — 8 instances

| # | Property | BTL Req | Writable | COV | Source | Notes |
|---|----------|:-------:|:--------:|:---:|--------|-------|
| 13.1 | Object_Identifier | M | — | — | PICS §4 | instance 1–8 |
| 13.2 | Object_Name | M | ✅ | — | | |
| 13.3 | Object_Type | M | — | — | | always EVENT_ENROLLMENT = 9 |
| 13.4 | Description | O | ✅ | — | | |
| 13.5 | Event_Type | M | — | — | | CHANGE_OF_STATE / FLOATING_LIMIT / OUT_OF_RANGE / COMMAND_FAILURE |
| 13.6 | Notify_Type | M | ✅ | — | | ALARM / EVENT / NOTIFICATION |
| 13.7 | Event_Parameters | M | ✅ | — | | threshold values per Event_Type |
| 13.8 | Object_Property_Reference | M | ✅ | — | | monitored object/property |
| 13.9 | Event_State | M | — | — | | |
| 13.10 | Acked_Transitions | M | ✅ | — | | TO_OFFNORMAL / TO_FAULT / TO_NORMAL |
| 13.11 | Notification_Class | M | ✅ | — | | 1–4 |
| 13.12 | Status_Flags | M | — | — | | |
| 13.13 | Reliability | M | — | — | | |
| 13.14 | Event_Enable | M | ✅ | — | | TO_OFFNORMAL / TO_FAULT / TO_NORMAL |
| 13.15 | Event_Time_Stamps | M | — | — | | array [3] of BACnetTimeStamp |
| 13.16 | Event_Detection_Enable | M | — | — | | enable/disable event detection |
| 13.17 | Fault_High_Limit | O | ✅ | — | | for floating limit type |
| 13.18 | Fault_Low_Limit | O | ✅ | — | | for floating limit type |
| 13.19 | Profile_Name | O | — | — | | |

---

## 14. BIBB-to-Object Mapping

| BIBB | Applicable Objects | BTL Test Priority | Notes |
|------|-------------------|:-----------------:|-------|
| DS-RP-B (ReadProperty) | All | **Critical** | basic read for every object type |
| DS-RPM-B (ReadPropertyMultiple) | All | **High** | read multiple properties per request |
| DS-WP-B (WriteProperty) | AO, AV, BO, BV, MSV, Schedule, Calendar, NC, EE, Trend Log | **Critical** | commandable/writable objects |
| DS-WPM-B (WritePropertyMultiple) | AO, AV, BO, BV, MSV | **High** | batch write |
| DS-COV-B (COV subscribed) | AI, AO, AV, BI, BO, BV, MSV | **Critical** | subscription-based COV |
| DS-COVU-B (COV unsolicited) | AI, AO, AV, BI, BO, BV, MSV | **High** | unsolicited COV notifications |
| AE-N-I-B (Alarm/Event Notification) | Event Enrollment, Notification Class | **Critical** | alarm path end-to-end |
| AE-ACK-B (Alarm Acknowledge) | Notification Class, Event Enrollment | **High** | alarm acknowledgment |
| SCHED-I-B (Scheduling) | Schedule, Calendar | **High** | schedule execution |
| T-VMT-I-B (Trend Viewing) | Trend Log | **Medium** | trend data retrieval |
| DM-DDB-B (Dynamic Device Binding) | Device | **Critical** | Who-Is/I-Am |
| DM-DOB-B (Dynamic Object Binding) | All | **Medium** | Who-Has/I-Have |
| DM-TS-B (TimeSync) | Device | **Medium** | time synchronisation |
| DM-RD-B (ReinitializeDevice) | Device | **Medium** | warm/cold restart |

---

## 14.1 Reliability Fault Injection Test Cases (AI — 16 instances, per ADR-011)

> **Gate:** tất cả 8 Reliability values phải pass BTL test tool trước khi close BAC-008.

| # | Test Case | Input / Trigger | Expected BACnet Reliability | Expected Status_Flags.FAULT | Source |
|---|-----------|-----------------|----------------------------|:---------------------------:|----|
| R-01 | Normal — no fault | UI channel type≠none, signal in range, IOP OK | NO_FAULT_DETECTED (0) | 0 | ADR-011 |
| R-02 | CONFIGURATION_ERROR | UI channel `type=none` | CONFIGURATION_ERROR (10) | 1 | ADR-011 |
| R-03 | OVER_RANGE — voltage | 0-10V channel, signal > 11.0V | OVER_RANGE (2) | 1 | ADR-011 |
| R-04 | UNDER_RANGE — 2-10V | 2-10V channel, signal < 1.8V | UNDER_RANGE (3) | 1 | ADR-011 |
| R-05 | OPEN_LOOP — 4-20mA | 4-20mA channel, loop current < 3.5mA | OPEN_LOOP (4) | 1 | ADR-011 |
| R-06 | SHORTED_LOOP — 4-20mA | 4-20mA channel, loop current > 21.0mA | SHORTED_LOOP (5) | 1 | ADR-011 |
| R-07 | OVER_RANGE — NTC/PT | NTC10k/PT100, temperature calc > physical max | OVER_RANGE (2) | 1 | ADR-011 |
| R-08 | COMMUNICATION_FAILURE — IOP | IOP no response > 5s (simulated by stopping MCU serial) | COMMUNICATION_FAILURE (12) | 1 | ADR-011 |
| R-09 | UNRELIABLE_OTHER — stale | KX_Q_UNCERTAIN: data stale < 4 scan (simulated) | UNRELIABLE_OTHER (7) | 1 | ADR-011 |
| R-10 | Recovery R-02 → normal | Reconfigure channel to valid type → poll cycle | NO_FAULT_DETECTED (0) | 0 | ADR-011 |
| R-11 | Recovery R-08 → normal | IOP reconnect > 5s after fault | NO_FAULT_DETECTED (0) | 0 | ADR-011 |

## 14.2 AO Required Properties Test Cases (per ADR-012)

> **Gate:** AO Units/Min_Pres_Value/Max_Pres_Value phải populated correctly trước BTL.

| # | Test Case | Config input | Expected BACnet AO property | Expected value |
|---|-----------|-------------|----------------------------|---------------|
| AO-01 | Object_Name từ config | `ao[1].name="CW VALVE"` | Object_Name | "CW VALVE" |
| AO-02 | Object_Name default | `ao[]` absent / no name field | Object_Name | "AO1".."AO4" |
| AO-03 | Units — explicit | `ao[1].units="percent"` | Units | percent (98) |
| AO-04 | Units — auto 0-10V | `ao[1].mode="0-10V"`, no units | Units | volts (5) |
| AO-05 | Units — auto 4-20mA | `ao[2].mode="4-20mA"`, no units | Units | milliamperes (2) |
| AO-06 | Min_Pres_Value | `ao[1].min_pv=0.0` | Min_Pres_Value | 0.0 |
| AO-07 | Max_Pres_Value | `ao[1].max_pv=100.0` | Max_Pres_Value | 100.0 |
| AO-08 | Min default 0-10V | `ao[3].mode="0-10V"`, no min/max | Min_Pres_Value | 0.0 |
| AO-09 | Max default 0-10V | `ao[3].mode="0-10V"`, no min/max | Max_Pres_Value | 10.0 |
| AO-10 | Max default 4-20mA | `ao[4].mode="4-20mA"`, no min/max | Max_Pres_Value | 20.0 |
| AO-11 | Write engineering value | WriteProperty AO1 PV=50.0 (percent mode) | DAC output | 5.0V (50% × 10V) |

---

## 15. TBD / Unresolved Items

| # | Item | Impact | Action Needed | Owner |
|---|------|--------|---------------|-------|
| TBD-1 | Vendor_Identifier for Device Object | BTL test expects valid ASHRAE vendor ID | Register with ASHRAE or use temporary/test ID | SW Lead |
| TBD-2 | Trend Log buffer size per instance | `Log_Buffer_Size` must match firmware allocation | Confirm RAM budget and set fixed value per instance | SW Team |
| TBD-3 | Schedule `Weekly_Schedule` sub-second precision | BTL may test sub-minute resolution | Verify bacnet-stack Schedule resolution | SW Team |
| TBD-4 | Event Enrollment `Event_Parameters` range limits | BTL tests TO_OFFNORMAL thresholds | Document min/max for each event type | SW Team |
| TBD-5 | COV `COV_Increment` default values for AI/AO/AV | BTL expects sensible defaults | Define per AI/AO/AV instance | SW Lead |
| TBD-6 | BTL profile conformance for optional properties | BTL may test optional props if supported | Review BTL v26.1-v2 checklist for optional prop coverage | QA |
| TBD-7 | Trend Log `Logging_Type` supported modes | polled vs COV vs triggered | Confirm which modes are implemented | SW Team |
| TBD-8 | Calendar `Date_List` entry types | date, date-range, week-of-year, etc. | Confirm supported CalendarEntry types | SW Team |

---

## 16. Summary

| Object Type | Count | Required Properties | Writable | COV | Source Section |
|-------------|:-----:|:-------------------:|:--------:|:---:|:--------------:|
| Device | 1 | 20+ | partial | — | PICS §7 |
| Analog Input (AI) | 16 | 10 | OOS | ✅ | PICS §4, §4.1 |
| Analog Output (AO) | 4 | 12 | PV, OOS | ✅ | PICS §4, §4.2 |
| Analog Value (AV) | 32 | 10 | PV, OOS | ✅ | PICS §4 |
| Binary Input (BI) | 8 | 8 | OOS | ✅ | PICS §4 |
| Binary Output (BO) | 4 | 10 | PV, OOS | ✅ | PICS §4, §4.2 |
| Binary Value (BV) | 16 | 8 | PV, OOS | ✅ | PICS §4 |
| Multi-state Value (MSV) | 8 | 8 | PV, OOS, State_Text | ✅ | PICS §4 |
| Trend Log | 8 | 18+ | config | — | PICS §4 |
| Schedule | 8 | 14 | full | — | PICS §4 |
| Calendar | 2 | 9 | full | — | PICS §4 |
| Notification Class | 4 | 8 | full | — | PICS §4 |
| Event Enrollment | 8 | 16+ | full | — | PICS §4 |
| **Total** | **111 objects** | | | | |

**Total rows in matrix:** 13 object types × property tables + BIBB map + TBD list = **160 property rows** across all object types plus supporting sections.

---

## 17. Verification Checklist

- [ ] Matrix covers all 13 object types: Device, AI, AO, AV, BI, BO, BV, MSV, Trend Log, Schedule, Calendar, Notification Class, Event Enrollment
- [ ] Each object type row includes: object type name, instance count, required properties, writable flags, COV flags, source section reference
- [ ] TBD items explicitly listed in §15 for unresolved property/profile questions
- [ ] BIBB-to-object mapping cross-reference in §14
- [ ] All counts match PICS §4

---

*Generated for BTL pre-test (IOT-5479) · Rev 1.0 · 2026-06-02*
