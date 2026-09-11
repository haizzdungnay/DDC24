# BACnet PICS / EPICS — MK-DDC-24
## Protocol Implementation Conformance Statement — D-3

> **Document ID:** ICD-BACNET-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-05-30 · 📘 [README](../../01_specs/README.md)
> **Chuẩn:** ASHRAE 135-2020 · **Trace:** `BAC-001..011`, `SRS §5`, `DS §4`
> **Mục tiêu:** đủ chi tiết để (a) lập trình stack BACnet, (b) nộp BTL, (c) BMS engineer tích hợp.

---

## 1. Product Description
MK-DDC-24 là bộ điều khiển DDC 24 điểm cho HVAC, hỗ trợ **BACnet/IP** (qua Ethernet/WiFi); lập trình bằng component graph hôm nay, roadmap Program Runtime IEC 61131-3-aligned (ADR-020, đang C0, chưa release). *(MS/TP đã bỏ — ARCH-R010.)*

## 2. BACnet Standardized Device Profile
- **B-ASC** (BACnet Application Specific Controller) — mục tiêu Ver 1.0.
- Lộ trình: B-BC (Building Controller) khi bổ sung đủ scheduling/trending nâng cao.

## 3. BIBBs hỗ trợ (BACnet Interoperability Building Blocks)

> **Sửa 2026-09-11 — bảng này đã được hạ xuống đúng thực trạng mã.** Chín trong mười bốn
> dòng trước đây khai ✅ cho năng lực **chưa tồn tại trong mã**. `OD-BAC-001` **CLOSED
> 2026-09-10** (biên bản `DDC24-BACNET-APPROVAL-2026-09-10`) quyết định sửa hồ sơ xuống
> đúng thực trạng, áp chính nguyên tắc mà §4 của tài liệu này đã tự viết ngày 2026-08-07:
> *"với hồ sơ chứng nhận thì khai sai nguy hiểm hơn khai thiếu."*
>
> **Cột `Evidence` là bắt buộc cho cả 14 dòng, kể cả các dòng ✅.** Một dòng ✅ không có
> `file:line` là một dòng không ai kiểm lại được — đó chính là cách chín dòng sai sống sót
> qua nhiều đợt rà soát trước.
>
> **Lớp bằng chứng của bảng này là `HOST` (đọc mã).** Không dòng nào được ghi `VERIFIED`:
> `ADR-060` chốt `VERIFIED` chỉ cấp cho bằng chứng `TARGET` trên board thật, và Rev A chưa
> có bằng chứng `TARGET` nào. Cột Evidence dưới đây trỏ vị trí mã, **không** phải kết quả
> chạy trên thiết bị.

| BIBB | Tên | Rev A | Trạng thái thật trong mã | Evidence (`file:line` — đọc mã 2026-09-11) |
|------|-----|:-----:|--------------------------|---------------------------------------------|
| DS-RP-B | ReadProperty-B | ✅ | Có đăng ký handler `SERVICE_CONFIRMED_READ_PROPERTY` | `apps/iobus/adapters/bacnet/bacnet_server.cpp:117-118` |
| DS-RPM-B | ReadPropertyMultiple-B | ✅ | Có đăng ký handler `SERVICE_CONFIRMED_READ_PROP_MULTIPLE` | `apps/iobus/adapters/bacnet/bacnet_server.cpp:119-120` |
| DS-WP-B | WriteProperty-B | ✅ | Có đăng ký handler `SERVICE_CONFIRMED_WRITE_PROPERTY`; ghi AO/BO đi qua arbitration của core ở `PRIO_BACNET = 3` | `apps/iobus/adapters/bacnet/bacnet_server.cpp:121-122`, `apps/iobus/adapters/bacnet/bacnet_server.cpp:141-153` |
| DS-WPM-B | WritePropertyMultiple-B | ❌ | **NOT IMPLEMENTED** — `SERVICE_CONFIRMED_WRITE_PROP_MULTIPLE` không nằm trong danh sách đăng ký; request rơi vào `handler_unrecognized_service` và bị Reject | `apps/iobus/adapters/bacnet/bacnet_server.cpp:116-127` |
| DS-COV-B | COV-B (subscribe) | ❌ | **NOT IMPLEMENTED** — không có handler `SERVICE_CONFIRMED_SUBSCRIBE_COV`. BMS gửi SubscribeCOV sẽ nhận Reject. Lớp `bacnet_cov.cpp` có engine phát hiện thay đổi nhưng **không** có đường nhận đăng ký qua BACnet. Chuyển **V1.1** (`ADR-057`) | `apps/iobus/adapters/bacnet/bacnet_server.cpp:116`, `apps/iobus/adapters/bacnet/bacnet_server.cpp:116-127` |
| DS-COVU-B | COV unsolicited | ❌ | **PLACEHOLDER** — vòng phát notification chỉ `std::fprintf` ra stderr kèm comment *"bacnet-stack: Send_COV_Subscribe_Unconfirmed or confirmed COV notification"*; **không có lời gọi gửi gói nào**. Chuyển **V1.1** (`ADR-057`) | `apps/iobus/adapters/bacnet/bacnet_server.cpp:288-293` |
| AE-N-I-B | Alarm/Event Notification-Internal | ❌ | **PLACEHOLDER** — vòng dispatch chỉ log, comment trong mã ghi rõ *"Placeholder: log the dispatch"*; `targets_` luôn rỗng vì `add_target()` **không có caller nào trong repo**. Không có Notification Class object nào được tạo. Chuyển **V1.1** (`ADR-057`) | `apps/iobus/adapters/bacnet/bacnet_alarm.cpp:95-102`, `apps/iobus/adapters/bacnet/bacnet_alarm.cpp:67-70` |
| AE-ACK-B | Alarm Acknowledge | ❌ | **NOT IMPLEMENTED** — không có handler `SERVICE_CONFIRMED_ACKNOWLEDGE_ALARM`. Chuyển **V1.1** (`ADR-057`) | `apps/iobus/adapters/bacnet/bacnet_server.cpp:116-127` |
| SCHED-I-B | Scheduling-Internal | ❌ | **TEST-ONLY — 0 object.** Lớp `BacnetScheduleObjects` có tồn tại và có test host, nhưng `register_objects()` **không tạo Schedule object nào**; lớp này không được nối vào đường phục vụ BACnet. Chuyển **V1.1** (`ADR-057`) | `apps/iobus/adapters/bacnet/bacnet_server.cpp:214-226`, `apps/iobus/adapters/bacnet/bacnet_schedule.hpp:113` |
| T-VMT-I-B | Trend Viewing (internal buffer) | ❌ | **NOT IMPLEMENTED — 0 object.** Không có một dòng mã Trend Log nào trong `apps/`, `contracts/`, `firmware/`, `platform/`. Chuyển **V1.1** (`ADR-057`) | `apps/iobus/adapters/bacnet/bacnet_server.cpp:214-226` |
| DM-DDB-B | Dynamic Device Binding (Who-Is/I-Am) | ✅ | Có đăng ký handler `SERVICE_UNCONFIRMED_WHO_IS` (đáp về địa chỉ người gửi) và phát I-Am khi khởi động | `apps/iobus/adapters/bacnet/bacnet_server.cpp:127`, `apps/iobus/adapters/bacnet/bacnet_server.cpp:129` |
| DM-DOB-B | Dynamic Object Binding (Who-Has/I-Have) | ❌ | **NOT IMPLEMENTED** — không đăng ký `SERVICE_UNCONFIRMED_WHO_HAS`; chỉ `WHO_IS` được đăng ký trong khối handler | `apps/iobus/adapters/bacnet/bacnet_server.cpp:127` |
| DM-TS-B | TimeSync-B | ❌ | **PARTIAL, SAI VAI TRÒ — hai lý do độc lập.** (1) **Sai vai trò:** mã hiện có gọi `Send_TimeSync_Device()` = vai **master/TS-A (gửi)**, ngược hẳn với `DM-TS-B` (nhận) đang khai. (2) **Không có caller:** `send_time_sync()` không được gọi từ bất kỳ đâu trong repo — mã chết. Bỏ khỏi Rev A theo `OD-BAC-005` (CLOSED 2026-09-10): DDC làm time master trên mạng BMS là thứ tích hợp viên thường cấm. **Đồng hồ Rev A đồng bộ bằng NTP**, không qua BACnet | `apps/iobus/adapters/bacnet/bacnet_server.cpp:334-345` |
| DM-RD-B | ReinitializeDevice-B | ✅ | Có đăng ký handler `SERVICE_CONFIRMED_REINITIALIZE_DEVICE` (warm/cold restart, cần password — xem §8) | `apps/iobus/adapters/bacnet/bacnet_server.cpp:123-124` |

> **Cảnh báo cho người rà soát tự động.** Phép kiểm code-span của `scripts/docs_iso_harness.py`
> chỉ xác thực đường dẫn trỏ vào `docs/**`, **không** xác thực đường dẫn trỏ vào `apps/**`.
> Harness `PASS` **không** chứng minh cột Evidence ở trên còn đúng. Khi mã đổi, phải kiểm lại
> bảng này bằng `grep`/`sed` trên chính các file được dẫn.

## 4. Object Types & thuộc tính (EPICS rút gọn)

| Object | Số lượng | Map vật lý | Writable | COV |
|--------|:--------:|------------|:--------:|:---:|
| Device | 1 | — | một số prop | — |
| Analog Input (AI) | 16 | UI1–UI16 (đã scale) | Out_Of_Service | ✅ |
| Analog Output (AO) | 4 | AO1–AO4 | Present_Value (commandable) | ✅ |
| Analog Value (AV) | 32 | biến PLC | Present_Value | ✅ |
| Binary Input (BI) | 0 base / 8 optional | Optional isolated-DI SKU only; capability-gated | Out_Of_Service | ✅ |
| Binary Output (BO) | 4 | DO1–DO4 relay | Present_Value (commandable) | ✅ |
| Binary Value (BV) | 16 | biến PLC | Present_Value | ✅ |
| Multi-state Value (MSV) | 8 | enum PLC | Present_Value | ✅ |
| Trend Log | **0** | — | — | — |
| Schedule | **0** | — | — | — |
| Calendar | **0** | — | — | — |
| Notification Class | **0** | — | — | — |
| Event Enrollment | **0** | — | — | — |

> **Cập nhật 2026-09-11 — năm loại object dưới đây về `0` cho Rev A.** Trend Log, Schedule,
> Calendar, Notification Class và Event Enrollment trước đây khai lần lượt **8 / 64 / 16 / 4 / 8**
> đối tượng. Không loại nào trong năm loại đó được tạo: `register_objects()`
> (`apps/iobus/adapters/bacnet/bacnet_server.cpp:214-226`) chỉ tạo AI×16, BI×8, AO×4, BO×4,
> AV×32, BV×16, MSV×8 — **không một lời gọi `..._Create()` nào** cho năm loại trên, và Trend Log
> thì không có một dòng mã nào trong repo.
>
> **Khai ❌ mà vẫn để số lượng là vẫn đang hứa.** Vì vậy các con số được đưa về `0` chứ không chỉ
> đánh dấu chỉ-đọc. Cơ sở: `ADR-057` **Accepted 2026-09-10** — Alarm/Event Notification,
> Schedule, Calendar và Trend Log **chuyển V1.1**, PICS Rev A khai ❌ cho cả bốn. Đây là quyết
> định về **phạm vi phát hành**, không phải bỏ tính năng: cả bốn vẫn nằm trong lộ trình V1.1.
> Xem §3 để biết trạng thái mã của từng BIBB tương ứng kèm `file:line`.
>
> **Lịch sử để không lặp lại.** Bản 2026-08-07 (Plan 50 P4, `ADR-023` QĐ-4) đã từng sửa hai dòng
> Schedule/Calendar từ *"8 và 2 đối tượng, đều writable"* thành *"64 và 16, chỉ đọc"*, kèm nguyên
> tắc — vẫn đúng và nay được áp lần nữa — rằng *"với hồ sơ chứng nhận thì khai sai nguy hiểm hơn
> khai thiếu"*. Lần đó sửa con số nhưng **không kiểm lại mã**, nên hồ sơ vẫn hứa 64 Schedule
> object mà `register_objects()` chưa bao giờ tạo cái nào. Đó là lý do §3 nay bắt buộc cột
> `Evidence` với `file:line` cho **mọi** dòng, kể cả dòng ✅.
>
> **Khi bốn năng lực này về ở V1.1**, chuỗi validate → preview → publish → ACK của đặc tả §13 vẫn
> là ràng buộc thiết kế: Schedule/Calendar dự kiến **chỉ đọc qua BACnet**, `WriteProperty` trả
> `WRITE_ACCESS_DENIED` (40) kèm lý do. Ghi lại ở đây để quyết định thiết kế không bị mất cùng
> với con số; nó **chưa** phải hành vi của Rev A, vì Rev A không có object nào để ghi.

### 4.1 Thuộc tính bắt buộc mỗi loại

**Analog Input (AI):** `Object_Identifier, Object_Name, Object_Type, Present_Value, Status_Flags, Event_State, Out_Of_Service, Units, COV_Increment, Reliability`.

**Reliability enum (ASHRAE 135-2020 Table 12-4) — đầy đủ, gate BTL:**

| `kx_reliability_t` | BACnet Reliability value | BACnet enum int | Trigger |
|--------------------|-------------------------|:---------------:|---------|
| `KX_REL_RELIABLE` | `NO_FAULT_DETECTED` | 0 | `KX_Q_GOOD`, tất cả check pass |
| `KX_REL_OVER_RANGE` | `OVER_RANGE` | 2 | 0-10V > 11V; 2-10V > 11V; NTC/PT nhiệt độ > max |
| `KX_REL_UNDER_RANGE` | `UNDER_RANGE` | 3 | 2-10V < 1.8V; NTC/PT nhiệt độ < min |
| `KX_REL_OPEN_LOOP` | `OPEN_LOOP` | 4 | 4-20mA < 3.5 mA (wire break) |
| `KX_REL_SHORTED_LOOP` | `SHORTED_LOOP` | 5 | 4-20mA > 21.0 mA (short circuit) |
| `KX_REL_UNRELIABLE_OTHER` | `UNRELIABLE_OTHER` | 7 | `KX_Q_UNCERTAIN` (data stale < 4 scan) |
| `KX_REL_CONFIGURATION_ERROR` | `CONFIGURATION_ERROR` | 10 | `type=none` hoặc type không nhận dạng được |
| `KX_REL_COMMUNICATION_FAILURE` | `COMMUNICATION_FAILURE` | 12 | IOP timeout > 5s; ADC hardware fault |

> **Mapping authority:** ADR-011. Implementation: `services/core/bacnet_objtable.cpp` (BAC-008).
> Field `ui_reliability[KX_N_UI]` trong `kx_io_shm_t`; core copy sang
> `kx_plc_shm_t.ai[].reliability` (`shared/mkddc_shm.h`).

**Units** (AI): theo cấu hình sensor — xem bảng sensor_type → BACnet Units tại CONFIG_SCHEMA §3.

**Analog Output (AO):** `Object_Identifier, Object_Name, Object_Type, Present_Value, Status_Flags, Event_State, Out_Of_Service, Units, Min_Pres_Value, Max_Pres_Value, Priority_Array, Relinquish_Default, COV_Increment, Reliability`.
- `Units`: theo `ao[].units` trong `io_config.conf`; auto-derive nếu absent (`0-10V`→volts=5, `4-20mA`→milliamperes=2).
- `Min_Pres_Value` / `Max_Pres_Value`: theo `ao[].min_pv` / `ao[].max_pv`.
- `Object_Name`: theo `ao[].name`; default `"AO{n}"`.
- Không writable qua BACnet — configured via `io_config.conf` (Web UI).

> **Config model authority:** ADR-012. Implementation: `services/core/bacnet_objtable.cpp` + `services/iobus/config/iobus_config.*`.

### 4.2 Commandable (AO/BO) — Priority Array
- Hỗ trợ **Priority_Array 16 mức** + `Relinquish_Default`. PLC ghi ở priority 16 (mặc định), BMS thường ghi 8.
- `Relinquish_Default` đọc từ `io_safe_state.conf` (mkddc-core loader).

### 4.3 Object_Name convention
`<TYPE><n>` mặc định (vd `AI1`, `AO2`), đổi được qua Web UI. Instance number = chỉ số (AI1→instance 1).

## 5. Data Link / Transport
> ⚠ **Chỉ BACnet/IP (ARCH-R010, 2026-05-30).** Đã **bỏ MS/TP** — RS-485 dành cho Modbus RTU master. BACnet chạy qua Ethernet/WiFi.

| Lớp | Hỗ trợ |
|-----|--------|
| BACnet/IP (Annex J) | ✅ UDP 47808 (Ethernet/WiFi), có thể đổi port |
| BBMD / Foreign Device | ✅ đăng ký FD; BBMD table cấu hình (cho liên mạng qua router) |
| MS/TP (Clause 9) | ❌ KHÔNG hỗ trợ (RS-485 = Modbus RTU master) |
| Max APDU | 1476 (BACnet/IP) |
| Segmentation | ✅ segmented-both (IP) |

## 6. Character Sets
UTF-8 (hỗ trợ tiếng Việt cho Object_Name/Description).

## 7. Device Object — giá trị mặc định
| Property | Giá trị |
|----------|---------|
| Vendor_Name | KINEXUS Technologies |
| Vendor_Identifier | **9999** *(placeholder — chờ đăng ký ASHRAE; thay bằng số thật trước GA)* |
| Model_Name | MK-DDC-24 |
| Protocol_Version | 1 |
| Protocol_Revision | ≥ 19 |
| Max_APDU_Length_Accepted | 1476 |
| Segmentation_Supported | segmented-both |
| Device_Instance | 1–4194302 (config; DIP bootstrap 1–127) |
| APDU_Timeout | 3000 ms |
| Number_Of_APDU_Retries | 3 |

> **Vendor_Identifier placeholder (2026-06-17):** ASHRAE chưa cấp số chính thức. Dùng `9999`
> (chưa được cấp cho tổ chức nào → an toàn dùng nội bộ / BTL pre-test). Việc cần làm trước
> GA: submit đơn đăng ký tại ashrae.org/standards-research--technology/standards-committee, update
> giá trị trong code và doc, bump Rev PICS_EPICS.

## 8. Hành vi đặc thù triển khai
- COV: AI/AO/AV theo `COV_Increment`; BI/BO/BV/MSV theo thay đổi trạng thái.
- Write AO/BO → vào shared memory → PLC scan kế tiếp áp dụng (≤500ms, UC-02).
- Failsafe: mất giao tiếp BMS >30s → BI/BO giữ/safe theo cấu hình; sinh alarm (E301).
- ReinitializeDevice: warmstart (restart service) / coldstart (reboot) — cần password.

> **Trạng thái COV trong Rev A — đọc cùng §3 trước khi cấu hình.** Dòng COV ở trên và cột `COV`
> của bảng §4 mô tả **thiết kế phát hiện thay đổi**, thứ đã có thật trong mã
> (`apps/iobus/adapters/bacnet/bacnet_cov.cpp`, `check_and_update`). Nhưng hai đầu còn lại của chuỗi **chưa có trong
> Rev A**: không có handler `SubscribeCOV` (`DS-COV-B` ❌) và khâu phát notification mới chỉ là
> `fprintf` chứ chưa gửi gói (`DS-COVU-B` ❌ — `apps/iobus/adapters/bacnet/bacnet_server.cpp:288-293`).
>
> **Hệ quả thực tế cho tích hợp viên:** đăng ký COV từ BMS sẽ bị Reject trong Rev A. Hãy
> **polling** qua ReadProperty / ReadPropertyMultiple. COV đầy đủ chuyển **V1.1** (`ADR-057`).

## 9. Kế hoạch test BTL
- Dùng **BACnet Stack Test Tool (BTL)** / Visual Test Shell.
- Pass 100% test cho B-ASC profile (gate G4, NFR-009) **trước GA**.
- Lab: đặt lịch (SW-Q-001, EXT-002), lead time 4–6 tuần.

## 10. Trace REQ
`BAC-001..011`, `SW-BAC-001..008`, `FR-020/021`, `NFR-009`, `UC-02`.

---
**Rev** 1.3 | 2026-09-11 (§3: bảng BIBB hạ xuống đúng thực trạng mã — 9/14 dòng đổi ✅→❌
(`DS-WPM-B`, `DS-COV-B`, `DS-COVU-B`, `AE-N-I-B`, `AE-ACK-B`, `SCHED-I-B`, `T-VMT-I-B`,
`DM-DOB-B`, `DM-TS-B`); **thêm cột `Evidence` bắt buộc `file:line` cho cả 14 dòng**, kể cả 5 dòng
còn ✅; §4: Trend Log/Schedule/Calendar/Notification Class/Event Enrollment về **0** object;
§4.1: sửa khai sai "AO không writable qua BACnet" — **AO writable ở `PRIO_BACNET = 3`** qua
arbitration của core; §8: thêm ghi chú COV Rev A bị Reject, dùng polling. Nguồn: `OD-BAC-001`,
`OD-BAC-005`, `OD-BAC-011` CLOSED 2026-09-10, `ADR-057`, `ADR-060`, biên bản
`DDC24-BACNET-APPROVAL-2026-09-10`. **Hồ sơ đối ngoại — bên đã nhận bản ≤1.2 phải được thông
báo lại.**) ·
1.2 | 2026-06-30 (§4.1: Reliability enum đầy đủ 8 giá trị per ADR-011 — thêm CONFIGURATION_ERROR+COMMUNICATION_FAILURE+UNRELIABLE_OTHER; AO required properties Units/Min_Pres_Value/Max_Pres_Value per ADR-012; §10: trace thêm ADR-011/ADR-012) ·
1.1 | 2026-06-17 (§7: Vendor_Identifier placeholder = 9999, ghi chú cần đăng ký ASHRAE trước GA) ·
1.0 | 2026-05-30 · Ký: SW Lead (Protocol) ___
