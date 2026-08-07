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
| BIBB | Tên | Vai trò |
|------|-----|---------|
| DS-RP-B | ReadProperty-B | ✅ |
| DS-RPM-B | ReadPropertyMultiple-B | ✅ |
| DS-WP-B | WriteProperty-B | ✅ |
| DS-WPM-B | WritePropertyMultiple-B | ✅ |
| DS-COV-B | COV-B (subscribe) | ✅ |
| DS-COVU-B | COV unsolicited | ✅ (cho AI/AO/BI/BO/AV/BV/MSV) |
| AE-N-I-B | Alarm/Event Notification-Internal | ✅ (Notification Class) |
| AE-ACK-B | Alarm Acknowledge | ✅ |
| SCHED-I-B | Scheduling-Internal | ✅ (Schedule object 64 cái, **chỉ đọc** — xem §4) |
| T-VMT-I-B | Trend Viewing (internal buffer) | ✅ (Trend Log) |
| DM-DDB-B | Dynamic Device Binding (Who-Is/I-Am) | ✅ |
| DM-DOB-B | Dynamic Object Binding (Who-Has/I-Have) | ✅ |
| DM-TS-B | TimeSync-B | ✅ |
| DM-RD-B | ReinitializeDevice-B | ✅ (warm/cold restart) |

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
| Trend Log | 8 | — | config | — |
| Schedule | **64** | Scheduler Engine v3.1 | **❌ chỉ đọc** | — |
| Calendar | **16** | Nhóm ngày lễ | **❌ chỉ đọc** | — |
| Notification Class | 4 | — | ✅ | — |
| Event Enrollment | 8 | — | ✅ | — |

> **Cập nhật 2026-08-07 (Plan 50 P4, ADR-023 QĐ-4).** Hai dòng Schedule/Calendar trước đây khai
> **8 và 2 đối tượng, đều writable** — cả ba con số đều không khớp bản đã hiện thực, và với hồ sơ
> chứng nhận thì khai sai nguy hiểm hơn khai thiếu.
>
> Số thật: **Schedule 64** (bằng trần của Scheduler Engine) và **Calendar 16**.
>
> **Cả hai CHỈ ĐỌC.** Đây là lựa chọn có chủ ý, không phải hạn chế kỹ thuật: đặc tả §13 bắt mọi
> thay đổi lịch phải đi qua validate → preview → publish → ACK, có `revision` và nhật ký audit.
> Cho một BMS ngoài ghi thẳng `Weekly_Schedule` qua BACnet là bỏ qua toàn bộ chuỗi đó và biến
> nhật ký audit thành thứ không giải thích được. `WriteProperty` trả `WRITE_ACCESS_DENIED` (40)
> kèm lý do, chứ không nhận rồi lặng lẽ bỏ.
>
> `Present_Value` và `Priority_For_Writing` vẫn phản ánh trạng thái thật do controller báo, nên
> BMS **giám sát** được đầy đủ — chỉ không **sửa** được qua BACnet.
>
> Hệ quả cho BTL: bài kiểm ghi Schedule sẽ trả `WRITE_ACCESS_DENIED`. Đây là hành vi hợp lệ theo
> ASHRAE 135 cho đối tượng chỉ đọc, nhưng **phải khai đúng trong PICS** — nếu PICS nói writable
> mà thiết bị từ chối thì đó là sai lệch PICS, lỗi nặng hơn nhiều.

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

## 9. Kế hoạch test BTL
- Dùng **BACnet Stack Test Tool (BTL)** / Visual Test Shell.
- Pass 100% test cho B-ASC profile (gate G4, NFR-009) **trước GA**.
- Lab: đặt lịch (SW-Q-001, EXT-002), lead time 4–6 tuần.

## 10. Trace REQ
`BAC-001..011`, `SW-BAC-001..008`, `FR-020/021`, `NFR-009`, `UC-02`.

---
**Rev** 1.2 | 2026-06-30 (§4.1: Reliability enum đầy đủ 8 giá trị per ADR-011 — thêm CONFIGURATION_ERROR+COMMUNICATION_FAILURE+UNRELIABLE_OTHER; AO required properties Units/Min_Pres_Value/Max_Pres_Value per ADR-012; §10: trace thêm ADR-011/ADR-012) ·
1.1 | 2026-06-17 (§7: Vendor_Identifier placeholder = 9999, ghi chú cần đăng ký ASHRAE trước GA) ·
1.0 | 2026-05-30 · Ký: SW Lead (Protocol) ___
