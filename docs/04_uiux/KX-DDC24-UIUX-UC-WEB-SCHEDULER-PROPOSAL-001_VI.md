# Phương án thiết kế UI/UX/UC — Scheduler Engine v3.1 (Web)

> **Document ID:** KX-DDC24-UIUX-UC-WEB-SCHEDULER-PROPOSAL-001-VI
> **Trạng thái:** **DRAFT — chờ review**, chưa được phép code (theo `CLAUDE.md` §DOC TRƯỚC CODE SAU)
> **Phiên bản:** 0.1 · **Ngày lập:** 2026-08-07
> **Đầu vào:** `docs/CHUONG_YEU_CAU/scheduler.md` (Product Spec v3.1)
> **Đối chiếu mã nguồn:** commit `5fef0b9` (nhánh `main`)
> **Phạm vi:** Kiến trúc thông tin, use case và đặc tả trình bày cho họ trang
> `/eng/scheduler/*`; hợp đồng dữ liệu FE↔BE↔core ở mức đủ để chốt UI.
> **Không bao gồm:** Đặc tả chi tiết BACnet Schedule Object (BTL), triển khai MQTT,
> panel lịch trên HMI cục bộ.
> **Tài liệu nền:** [UX-SYSTEM-001](KX-DDC24-UX-SYSTEM-001_VI.md) (token, component) ·
> [UC-WEB-NETWORK-001](KX-DDC24-UC-WEB-NETWORK-001_VI.md) (mẫu văn bản UC) ·
> [UX-WEB-NETWORK-001](KX-DDC24-UX-WEB-NETWORK-001_VI.md) (mẫu văn bản UX)

---

## 1. Vì sao tài liệu này tồn tại

Spec v3.1 tuyên bố **loại bỏ hoàn toàn cơ chế thanh ghi `TSx`**. Mã nguồn hiện tại
không chỉ *dùng* mô hình TSx — nó **phơi TSx ra thẳng giao diện**: chế độ
`Parameters` của trang Scheduler hiển thị đúng 12 dòng nhãn `TSx 0` … `TSx 11`
([SchedulerPage.tsx:436-447](../../apps/web-ui/src/features/scheduler/SchedulerLayout.tsx#L436-L447)),
và wizard cũng gắn nhãn thanh ghi cho từng bước
([SchedulerPage.tsx:619-626](../../apps/web-ui/src/features/scheduler/SchedulerLayout.tsx#L619-L626)).

Vì vậy đây **không phải một đợt làm đẹp giao diện**. Đây là thay thế mô hình miền
(domain model) xuyên ba tầng FE / BE / core runtime, và giao diện chỉ là mặt cắt
nhìn thấy được của nó. Tài liệu này chốt **cái gì hiển thị, ai làm được gì, và
những quyết định kiến trúc nào phải có câu trả lời trước khi gõ dòng code đầu tiên**.

---

## 2. Hiện trạng mã nguồn (as-built, đã đọc — không suy diễn)

### 2.1 Ba tầng đang có

| Tầng | File | Mô hình hiện tại |
|---|---|---|
| FE | [`SchedulerPage.tsx`](../../apps/web-ui/src/features/scheduler/SchedulerLayout.tsx) (756 dòng, một file) | Danh sách trái + panel phải, 3 chế độ `summary` / `wizard` / `parameters`. Toàn bộ 64 lịch nạp một lần, sửa trong bộ nhớ, lưu bằng **một nút Save ghi đè cả mảng** |
| BE | [`dto.go:142-162`](../../apps/web-api/internal/app/dto.go#L142-L162), [`scheduleapi.go`](../../apps/web-api/internal/app/scheduleapi.go), [`schedulestore.go`](../../apps/web-api/internal/app/schedulestore.go) | `ScheduleRow` **phẳng**; chỉ 2 endpoint `GET`/`PUT /api/v1/schedules` ([http.go:218-219](../../apps/web-api/internal/app/http.go#L218-L219)); lưu `schedule.conf` dạng mảng JSON; áp dụng bằng **SIGHUP** tới core |
| Core | [`schedule_runtime.cpp`](../../apps/core/application/schedule/schedule_runtime.cpp) (527 dòng) | Đánh giá theo `week_minute` + ordinal ngày trong năm; ghi qua `PriorityResolver` ở **mức 4 cố định** |

### 2.2 Hình dạng dữ liệu hiện tại

```go
// dto.go:142 — MỘT lịch = MỘT khoảng thời gian = MỘT giá trị = MỘT target
type ScheduleRow struct {
    ID, Label, Notes string
    Enabled          bool
    ScheduleType     string   // 7 loại nghiệp vụ: not_active … holiday_period
    StartTime, EndTime string // "HH:MM"
    StartDate, EndDate string // "MM-DD"  (chỉ dùng cho holiday_period)
    Weekdays         []string
    Target           *ScheduleTarget // ĐÚNG MỘT
    Value            *float64        // ĐÚNG MỘT
}
```

### 2.3 Hành vi runtime cần biết trước khi thiết kế UI

Bốn điểm dưới đây quyết định giao diện phải nói gì với người dùng:

1. **Ngày lễ hiện tắt toàn bộ hệ thống.** Nếu bất kỳ lịch `holiday_period` nào đang
   trong khoảng ngày, `holiday_active = true` và **mọi lịch khác đều ngừng ghi**
   ([schedule_runtime.cpp:459-482](../../apps/core/application/schedule/schedule_runtime.cpp#L459-L482)).
   Spec v3.1 yêu cầu ngược lại: exception thuộc *từng* Schedule Object và chỉ ghi đè
   *lịch chứa nó*.
2. **Xung đột giải quyết bằng "khoảng vừa bắt đầu thì thắng"** — cùng target thì lịch
   có `age` nhỏ nhất thắng, hòa thì lịch đứng sau trong mảng thắng
   ([:469-481](../../apps/core/application/schedule/schedule_runtime.cpp#L469-L481)).
   Người dùng **không có cách nào nhìn thấy hoặc điều khiển** quy tắc này.
3. **Nhả quyền có thật** nhưng khác ngữ nghĩa BACnet: AO/DO gọi `release_ao/release_do`,
   còn AV/BV/MSV thì **giữ nguyên giá trị**, chỉ đổi `source` về `DEFAULT`
   ([point_table.hpp:44-46](../../apps/core/domain/graph/point_table.hpp#L44-L46)).
4. **Giờ lấy từ `localtime_r`** của tiến trình
   ([clock_snapshot.hpp](../../apps/core/domain/graph/clock_snapshot.hpp)) — không có
   timezone theo từng lịch, không phát hiện nhảy thời gian, không đánh giá lại khi NTP đồng bộ.

---

## 3. Bảng khoảng cách spec v3.1 ↔ as-built

Ký hiệu: 🔴 chưa có gì · 🟡 có một phần · 🟢 đã đủ.

| # | Yêu cầu spec | Hiện trạng | |
|---|---|---|---|
| G-01 | `weekly_schedule` = 7 ngày × N cặp Time-Value | 1 lịch = 1 khoảng `startTime→endTime` | 🔴 |
| G-02 | `exception_schedule[]` thuộc từng Schedule Object, có `event_priority` 1..16 | `holiday_period` là loại lịch riêng, tắt toàn cục | 🔴 |
| G-03 | `schedule_default` (giá trị khi không event nào hiệu lực) | Không có khái niệm | 🔴 |
| G-04 | `effective_period` (`start_date`/`end_date`, `end_date=null` = vô hạn) | Không có | 🔴 |
| G-05 | `value_type` ∈ BINARY/BOOLEAN/REAL/UNSIGNED/ENUMERATED | Suy ra ngầm từ `scheduleType` | 🔴 |
| G-06 | ≥32 target/lịch, kết quả ghi **lưu riêng từng target** | Đúng 1 target, không lưu kết quả ghi | 🔴 |
| G-07 | `priority_for_writing` 1..16 | Core cố định mức 4 trong thang **6 mức** ([priority_resolver.hpp:15-21](../../apps/core/domain/priority/priority_resolver.hpp#L15-L21)) | 🔴 |
| G-08 | Vòng đời DRAFT→VALIDATED→PUBLISHED→ACTIVE/INACTIVE + `OUT_OF_SYNC` | Chỉ có `enabled` true/false | 🔴 |
| G-09 | `revision`, ≥10 bản, diff, rollback | Không có | 🔴 |
| G-10 | Simulation 7/30 ngày trước khi publish | Không có | 🔴 |
| G-11 | 14 endpoint REST | 2 endpoint (GET/PUT cả bộ sưu tập) | 🟡 |
| G-12 | MQTT config/ack/state/event/diagnostic, QoS 1, idempotent | **Không có MQTT ở bất kỳ đâu trong repo** — transport hiện tại là SHM + Unix socket + SIGHUP | 🔴 |
| G-13 | Timezone IANA per-schedule, DST, phát hiện nhảy giờ, đánh giá lại sau NTP | `localtime_r` theo TZ tiến trình | 🔴 |
| G-14 | Audit đầy đủ: người, lý do, revision trước/sau, kết quả publish, IP | Một dòng `audit.Change(user,"schedules","schedule.conf","applied",ip)` ([scheduleapi.go:69](../../apps/web-api/internal/app/scheduleapi.go#L69)) | 🟡 |
| G-15 | 6 vai trò (Viewer…Auditor) | 3 vai trò: `viewer`/`operator`/`admin` ([auth/service.go:22-24](../../apps/web-api/internal/auth/service.go#L22-L24)) | 🟡 |
| G-16 | `bacnet_object.object_type = SCHEDULE` | Object map chỉ có AI/BI/AO/BO/AV/BV/MSV + Device ([bacnet_objects.hpp:4](../../apps/iobus/adapters/bacnet/bacnet_objects.hpp#L4)) — **không có type 17 (Schedule) hay type 6 (Calendar)** | 🔴 |
| G-17 | 3 chế độ Calendar / Grid / Logic | Có 3 chế độ nhưng là Summary / Wizard / **Parameters gắn nhãn TSx** | 🟡 |
| G-18 | 11 màn hình bắt buộc | 1 trang duy nhất | 🔴 |
| G-19 | Kéo thả khối thời gian, copy sang nhiều ngày | Không có | 🔴 |
| G-20 | Đánh giá 64 lịch < 100 ms; mở danh sách < 2 s | Chưa đo (mô hình hiện tại nhẹ hơn nhiều nên số cũ không dùng lại được) | 🟡 |

**Kết luận:** đây là viết lại, không phải sửa. Giữ lại được: khung phân trang, hệ
token màu, `PriorityResolver`, `PriorityArray[16]` phía BACnet
([bacnet_priority.hpp](../../apps/iobus/adapters/bacnet/bacnet_priority.hpp)), và
hạ tầng audit/reload của BE.

---

## 4. Sáu quyết định phải chốt trước khi thiết kế chi tiết

Đây là phần cần ý kiến của anh nhất. Mỗi mục có đề xuất kèm lý do.

### QĐ-1 — Priority 1..16 gặp thang 6 mức của core

Core dùng **6 mức** cho AO/DO, trong đó mức 1 là Fire/Safety và có ràng buộc an
toàn T7 (`any_active_above_default`). Spec đòi `priority_for_writing` 1..16.

> **Đề xuất:** giữ nguyên thang 6 mức là **sự thật vật lý ở core**; nhận `priority_for_writing`
> 1..16 trong hợp đồng và **ánh xạ** vào `PRIO_SCHEDULE` cho target nội bộ, đồng thời
> dùng đúng 1..16 trong `PriorityArray` khi target là đối tượng BACnet commandable.
> Giao diện hiển thị **cả hai**: "Priority ghi 16 (→ mức schedule của controller)".
> *Lý do:* nâng resolver lên 16 mức đụng vào đường an toàn và toàn bộ 743 test hiện có,
> trong khi không mang lại hành vi nào người dùng thấy khác trên một DDC 4 AO + 4 DO.

### QĐ-2 — MQTT

Repo **không có MQTT**. Spec §14 giả định MQTT là kênh chính giữa Backend và Controller.
Trên MK-DDC-24, Backend và Controller **nằm cùng một bo** — nói chuyện qua SHM và Unix socket.

> **Đề xuất:** pha 1–2 giữ transport hiện tại, nhưng **dựng đủ lớp ngữ nghĩa** mà spec đòi
> (`revision`, `correlation_id`, ACK/NACK, idempotent, timeout, retry) trong BE.
> Giao diện chỉ nói "đã publish / controller đã ACK / lệch revision" — **không nói transport**.
> Khi gắn MQTT về sau, UI không phải sửa một dòng.

### QĐ-3 — Quy mô 64 lịch × 32 target

Điểm ghi được của một DDC-24: AO×4, DO×4, AV×32, BV×16, MSV×8 = **64 điểm nội bộ**,
cộng EXT×256 cho Modbus RTU ([mkddc_shm.h:69-74](../../contracts/shm/mkddc_shm.h#L69-L74)).
64 lịch × 32 target = 2048 lệnh ghi là con số của một **gateway đa controller**, không
phải của một DDC đơn.

> **Đề xuất:** giữ trần 64 Schedule Object; đặt trần target **theo số điểm ghi thật**
> (≤ 64 nội bộ + EXT khi bật Modbus). Giao diện hiện đồng hồ đo dung lượng thật
> (`đã dùng 12/64 lịch · 7/64 điểm ghi`) thay vì hứa một con số không có phần cứng đỡ.

### QĐ-4 — BACnet Schedule Object (type 17) và Calendar (type 6)

Chưa tồn tại. Đây là hạng mục BTL, không phải hạng mục UI.

> **Đề xuất:** đẩy sang pha 3. Pha 1–2 vẫn sinh `bacnet_object.object_instance` trong
> hợp đồng để không phải migrate dữ liệu lần hai; giao diện hiển thị ô đó ở trạng thái
> chỉ đọc kèm nhãn "chưa phơi ra BACnet".

### QĐ-5 — 6 vai trò của spec vs 3 vai trò thật

> **Đề xuất:** **không đẻ thêm vai trò.** Giữ `viewer`/`operator`/`admin` và bổ sung
> *quyền hạn theo thao tác* (`schedule.publish`, `schedule.rollback`, `schedule.delete`,
> `schedule.priority`) như spec §19 đòi ở câu cuối. Sáu vai trò của spec là mô hình
> doanh nghiệp; ba vai trò cộng bốn quyền phủ đủ ngữ nghĩa mà không tăng bề mặt quản trị.
> Bảng ánh xạ ở §9.

### QĐ-6 — Di trú `schedule.conf` đang chạy trên bo

Bo lab đang chạy `schedule.conf` định dạng v1. Publish một định dạng mới đè lên là
mất cấu hình đang vận hành.

> **Đề xuất:** BE tự nhận diện định dạng lúc nạp, **chuyển đổi một chiều v1 → v3.1**
> (mỗi row v1 → 1 Schedule Object có `weekly_schedule` gồm 2 cặp Time-Value là
> `startTime:value` và `endTime:default`), ghi ra bản v3.1 và **giữ bản v1 làm `.bak`**.
> Giao diện hiện băng thông báo "N lịch đã được chuyển từ định dạng cũ — hãy kiểm tra
> và publish lại" cho tới khi người dùng xác nhận.

---

## 5. Hợp đồng dữ liệu đề xuất (mức đủ để chốt UI)

Bám JSON của spec §4.1, ba khác biệt có chủ ý, đều xuất phát từ mã nguồn thật:

```jsonc
{
  "schema_version": "3.1",
  "schedule_id": "SCH-001",
  "schedule_name": "HVAC Văn phòng — giờ hành chính",
  "enabled": true,
  "status": "PUBLISHED",              // DRAFT|VALIDATED|PUBLISHED|ACTIVE|INACTIVE|DISABLED|ERROR|OUT_OF_SYNC
  "timezone": "Asia/Ho_Chi_Minh",
  "effective_period": { "start_date": "2026-01-01", "end_date": null },
  "value_type": "BINARY",
  "priority_for_writing": 16,
  "core_priority_level": 4,           // (1) DẪN XUẤT, chỉ đọc — QĐ-1
  "schedule_default": { "value": "INACTIVE" },
  "weekly_schedule": { "MON": [ {"time":"08:00:00","value":"ACTIVE"},
                                {"time":"18:00:00","value":"INACTIVE"} ], "TUE": [], "…": [] },
  "exception_schedule": [ { "exception_id":"EXC-001", "name":"Quốc khánh",
                            "date_rule": {"type":"DATE","date":"2026-09-02"},
                            "event_priority": 1,
                            "time_values": [ {"time":"00:00:00","value":"INACTIVE"} ] } ],
  "target_objects": [ { "target_id":"TGT-001", "target_type":"INTERNAL_POINT",
                        "point_id":"DO-01", "point_kind":"BO", "channel":1 } ],
  "revision": 5,
  "runtime": {                        // (2) CHỈ ĐỌC, do controller trả về
    "effective_value": "ACTIVE",
    "value_source": "WEEKLY",         // WEEKLY|EXCEPTION|DEFAULT
    "next_transition_at": "2026-08-07T18:00:00+07:00",
    "targets": [ { "target_id":"TGT-001", "write_result":"OK",
                   "actual_value":"ACTIVE", "overridden_by": null } ]
  },
  "created_at": "…", "created_by": "…", "updated_at": "…", "updated_by": "…"
}
```

**(1)** `core_priority_level` là trường dẫn xuất để giao diện giải thích được vì sao một
lệnh priority 16 lại thua một lệnh tay — không có nó, "Priority 16" là con số vô nghĩa
với người vận hành đứng trước bo.

**(2)** `runtime` tách khỏi cấu hình. Cấu hình là *ý định*, runtime là *sự thật*. Trộn
hai thứ vào một khối chính là lớp lỗi FE-DIAG-01 đã ghi nhận trong đợt review 2026-08-06.

**(3)** `target_type: "INTERNAL_POINT"` là dạng mặc định trên MK-DDC-24 (spec §8.3).
Dạng `BACNET_OBJECT` để dành cho QĐ-4.

### 5.1 Biên dịch Start/End → Time-Value (spec §2.3)

Giao diện cho phép vẽ khối `08:00 → 18:00: BẬT`. **Frontend biên dịch ngay khi vẽ**,
và luôn hiển thị kết quả biên dịch bên cạnh:

```
Khối bạn vẽ                Cặp Time-Value được lưu
08:00 → 18:00  BẬT    ⇒    08:00:00 = ACTIVE
                           18:00:00 = INACTIVE   ← trở về schedule_default
```

Người dùng phải **thấy được** phép biên dịch này, nếu không họ sẽ không hiểu vì sao
lịch của mình có 2 sự kiện mà không phải 1. Đây là điểm dạy nghề quan trọng nhất của
toàn bộ trang.

---

## 6. Danh mục Use Case

Ba nhóm theo người dùng. Mã `UC-WEB-SCH-nnn`.

### 6.1 Nhóm Vận hành (Operator) — nhìn và bật/tắt

| Mã | Tên | Actor | Tiêu chí nghiệm thu |
|---|---|---|---|
| UC-WEB-SCH-001 | Xem lịch tuần dạng trực quan | viewer+ | 7 cột ngày, khối thời gian đúng tỉ lệ; đường "bây giờ" chạy theo giờ thật; ngày có exception được đánh dấu rõ |
| UC-WEB-SCH-002 | Xem giá trị đang hiệu lực và nguồn của nó | viewer+ | Hiện `giá trị` + `nguồn ∈ {Tuần, Ngoại lệ, Mặc định}` + `lần chuyển kế tiếp`. Thiếu số liệu ⇒ `—`, **không** bịa `0` |
| UC-WEB-SCH-003 | Bật/tắt một lịch | operator+ | Tắt ⇒ hộp thoại nêu rõ: relinquish tại priority nào, target nào, giá trị sau khi nhả. Xác nhận xong trạng thái về `DISABLED` |
| UC-WEB-SCH-004 | Thấy lịch đang bị override | viewer+ | Khi có nguồn ưu tiên cao hơn (tay/BACnet/safety) đang giữ target, thẻ hiện huy hiệu `BỊ GHI ĐÈ` + tên nguồn thắng |
| UC-WEB-SCH-005 | Thấy controller lệch revision | viewer+ | Trạng thái `OUT_OF_SYNC` kèm số revision hai bên và nút "publish lại" |

### 6.2 Nhóm Kỹ sư (Engineer) — dựng lịch

| Mã | Tên | Actor | Tiêu chí nghiệm thu |
|---|---|---|---|
| UC-WEB-SCH-010 | Tạo Schedule Object mới | engineer¹ | Chọn `value_type` **trước tiên** và **khoá sau khi có target** (spec §2.1) |
| UC-WEB-SCH-011 | Vẽ lịch tuần bằng kéo thả | engineer | Kéo tạo khối, kéo cạnh đổi thời lượng, kéo thân đổi giờ; bước nhảy 5 phút; **luôn hiện cặp Time-Value tương ứng** |
| UC-WEB-SCH-012 | Nhập lịch tuần dạng bảng Time-Value | engineer | Bàn phím thuần, không cần chuột; tự sắp xếp tăng dần; chặn trùng thời điểm (`SCH-CONFIG-002`) |
| UC-WEB-SCH-013 | Sao chép một ngày sang nhiều ngày | engineer | Chọn ngày nguồn → tick ngày đích → áp dụng; hoàn tác được |
| UC-WEB-SCH-014 | Đặt `schedule_default` | engineer | Bắt buộc; thiếu ⇒ chặn publish với `SCH-CONFIG-001` |
| UC-WEB-SCH-015 | Đặt `effective_period` | engineer | `end_date` rỗng = vô hạn, phải nói rõ bằng chữ "không có ngày kết thúc" |
| UC-WEB-SCH-016 | Thêm ngoại lệ (5 kiểu date_rule) | engineer | Mỗi kiểu có preview "sẽ rơi vào những ngày nào trong 12 tháng tới" |
| UC-WEB-SCH-017 | Xử lý xung đột hai ngoại lệ cùng priority | engineer | Hiện `SCH-CONFIG-003` chỉ đúng cặp xung đột; **không tự chọn theo thời gian tạo** (spec §7.3) |
| UC-WEB-SCH-018 | Gán nhiều target | commissioning² | Chặn target sai `value_type` (`SCH-TARGET-003`), không ghi được (`SCH-TARGET-002`), trùng nhau, hoặc không tồn tại (`SCH-TARGET-001`) |
| UC-WEB-SCH-019 | Đặt `priority_for_writing` | commissioning | Kèm giải thích mức core tương ứng (QĐ-1) và cảnh báo khi ≤ 2 |
| UC-WEB-SCH-020 | Validate | engineer | Danh sách lỗi có mã, bấm vào là nhảy tới đúng ô sai |
| UC-WEB-SCH-021 | Mô phỏng 7/30 ngày | engineer | Dòng thời gian nêu rõ nguồn từng đoạn; tô đỏ đoạn không có giá trị; liệt kê mọi thời điểm chuyển trạng thái |
| UC-WEB-SCH-022 | Nhân bản lịch | engineer | ID mới tự cấp, trạng thái `DRAFT`, target **không** sao chép (tránh hai lịch cùng ghi một điểm mà không ai để ý) |

¹ ánh xạ về `admin` ở pha 1, xem §9. ² quyền `schedule.publish`.

### 6.3 Nhóm Bàn giao & Kiểm toán

| Mã | Tên | Actor | Tiêu chí nghiệm thu |
|---|---|---|---|
| UC-WEB-SCH-030 | Xem diff trước khi publish | commissioning | Diff cạnh nhau bản đang chạy ↔ bản nháp; đổi target và đổi priority **luôn được làm nổi bật** |
| UC-WEB-SCH-031 | Publish + chờ ACK | commissioning | Có trạng thái chờ, có timeout, có NACK kèm mã lỗi. **Publish hỏng thì revision đang chạy không đổi** (spec §13.2) |
| UC-WEB-SCH-032 | Publish hàng loạt | commissioning | Kết quả **từng lịch** một, không phải một dòng "thành công" gộp |
| UC-WEB-SCH-033 | Xem lịch sử revision | auditor³ | ≥10 bản; ai, lúc nào, lý do |
| UC-WEB-SCH-034 | Rollback | admin | Bắt buộc nhập lý do; rollback tạo revision **mới**, không xoá lịch sử |
| UC-WEB-SCH-035 | Xoá lịch | admin | Hộp thoại nêu trình tự spec §9.3: nhả toàn bộ target → xác nhận không còn lệnh giữ → lưu bản cuối vào audit → mới xoá |
| UC-WEB-SCH-036 | Xem audit | auditor | Lọc theo lịch/người/khoảng thời gian; **chỉ đọc, không sửa được** |
| UC-WEB-SCH-037 | Xuất/nhập JSON | engineer | Nhập phải qua validate; xung đột ID hỏi ghi đè hay cấp ID mới |
| UC-WEB-SCH-038 | Chẩn đoán lỗi runtime | operator+ | Nhóm theo 14 mã lỗi spec §11; nêu target nào hỏng và **các target khác vẫn chạy** |

³ quyền đọc audit, xem §9.

---

## 7. Kiến trúc thông tin

Spec §17 liệt kê 11 màn hình. Dựng 11 route riêng là sai — người dùng sẽ mất dấu bối
cảnh giữa "lịch nào" và "màn nào". Gom thành **4 route + tab con**, theo đúng khuôn
`ModbusRtuLayout` đã dùng trong dự án ([App.tsx:128-137](../../apps/web-ui/src/app/App.tsx#L128-L137)):

```
/eng/scheduler                     ← Grid 64 lịch (Mode 2) + đo dung lượng
/eng/scheduler/runtime             ← Logic Cards (Mode 3), giám sát trực tiếp
/eng/scheduler/exceptions          ← Thư viện ngày lễ / nhóm ngoại lệ dùng chung
/eng/scheduler/:id                 ← Editor một lịch, 6 tab:
        ├── (index) Tuần           ← Weekly Calendar (Mode 1)
        ├── ngoại-lệ               ← Exception Manager của lịch này
        ├── target                 ← Target Mapping
        ├── mô-phỏng               ← Simulation Preview
        ├── revision               ← Revision History + Rollback
        └── audit                  ← Audit Log của lịch này
   (Publish Review là modal toàn màn hình, không phải route — nó là một
    khoảnh khắc quyết định, không phải một nơi để lui tới)
```

Ánh xạ ngược về spec §17 để không sót màn nào:

| Màn hình spec | Ở đâu |
|---|---|
| Schedule List | `/eng/scheduler` |
| Schedule Editor | `/eng/scheduler/:id` |
| Weekly Calendar | tab **Tuần** |
| Exception Manager | tab **Ngoại lệ** + thư viện `/eng/scheduler/exceptions` |
| Target Mapping | tab **Target** |
| Simulation Preview | tab **Mô phỏng** |
| Publish Review | modal diff |
| Runtime Monitor | `/eng/scheduler/runtime` |
| Revision History | tab **Revision** |
| Audit Log | tab **Audit** |
| Diagnostics | dải cảnh báo trên `/eng/scheduler/runtime` + huy hiệu lỗi trên từng thẻ |

---

## 8. Đặc tả trình bày

### 8.0 Nguyên tắc bắt buộc

| # | Nguyên tắc | Vì sao |
|---|---|---|
| S1 | **Không nhắc `TSx` ở bất kỳ đâu.** Không nhãn, không tooltip, không tên trường | Spec §23. Đây là tiêu chí nghiệm thu số 20 |
| S2 | **Ý định và sự thật luôn tách khối.** Cấu hình một bên, giá trị controller đang chạy một bên | FE-DIAG-01 (review 2026-08-06): trang bịa dữ liệu vì trộn hai nguồn |
| S3 | **Thiếu số liệu thì `—`.** Không `0`, không `OK`, không `online` | Kế thừa P1 của UX-WEB-NETWORK-001 |
| S4 | **Phép biên dịch Start/End → Time-Value luôn nhìn thấy được** | Không thấy thì không hiểu mô hình, và sẽ dựng sai lịch |
| S5 | **Thao tác ghi ra thiết bị phải xác nhận, kèm hậu quả cụ thể** — nêu đích danh target và giá trị sau thao tác | Tắt một lịch là ra lệnh thật cho quạt và van |
| S6 | **Lỗi mang mã.** Mọi thông báo kèm mã spec §11 và bấm được để nhảy tới ô sai | Kỹ thuật viên hiện trường không có log |
| S7 | **Kéo thả luôn có đường bàn phím tương đương** | Commissioning làm việc trên laptop bàn di chuột, và cần thao tác nhanh |

### 8.1 `/eng/scheduler` — Grid 64 lịch (Mode 2)

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ Lịch vận hành                          [12/64 lịch] [7/64 điểm ghi] [2 lệch]   │
│ Weekly Schedule · Ngoại lệ · Publish có kiểm chứng                             │
│                              [Tải lại] [Nhập] [Xuất] [+ Lịch mới] [Publish 3 ▾]│
├────────────────────────────────────────────────────────────────────────────────┤
│ ⚠ 4 lịch đã chuyển từ định dạng cũ — kiểm tra rồi publish lại.    [Xem] [Ẩn]  │ ← QĐ-6
├────────────────────────────────────────────────────────────────────────────────┤
│ [Tìm…]  Trạng thái ▾  Kiểu giá trị ▾  Target ▾  ☐ Chỉ lịch lệch revision       │
├──┬────────┬──────────────┬─────────┬──────────┬───────────┬─────┬────────┬─────┤
│☐ │ ID     │ Tên          │ Trạng   │ Tuần     │ Ngoại lệ  │ Tgt │ Hiện tại│Kế  │
├──┼────────┼──────────────┼─────────┼──────────┼───────────┼─────┼────────┼─────┤
│☐ │SCH-001 │HVAC Văn phòng│●PUBLISH │T2-T6 08-18│ 2         │ 3   │ BẬT    │18:00│
│☐ │SCH-002 │Đèn hành lang │●ACTIVE  │T2-CN 06-22│ 1         │ 2   │ BẬT    │22:00│
│☐ │SCH-003 │Setpoint AHU  │◐DRAFT   │T2-T6 07-19│ —         │ 1   │ —      │ —   │
│☐ │SCH-004 │Bơm nước      │▲OUT_SYNC│T2-T7 05-21│ 3         │ 2   │ TẮT    │05:00│
│  │        │              │  rev 7≠5│           │           │     │        │     │
└──┴────────┴──────────────┴─────────┴──────────┴───────────┴─────┴────────┴─────┘
   ↑ cột ID + Tên đóng băng khi cuộn ngang · ảo hoá hàng · chọn nhiều để publish/bật/tắt hàng loạt
```

Ghi chú thiết kế:

- **Cột `Tuần` là chữ tóm tắt, không phải mini-chart.** `T2-T6 08-18` đọc được ngay;
  một biểu đồ 7 ô 4 mm thì không. Lịch có nhiều hơn một khoảng/ngày hiển thị
  `T2-T6 08-12, 13-18` và cắt bằng `…` kèm tooltip đầy đủ.
- **`Hiện tại` và `Kế tiếp` đến từ khối `runtime`** của controller (S2). Chưa publish ⇒ `—`,
  không phải giá trị tính ở trình duyệt.
- **`OUT_OF_SYNC` chiếm hai dòng** vì nó là trạng thái duy nhất người dùng phải hành động
  ngay; nén nó bằng kích cỡ với các trạng thái khác là giấu nó đi.
- Sửa tại chỗ chỉ mở cho: Tên, Bật/Tắt, Priority. Mọi thứ khác vào Editor — sửa
  `weekly_schedule` trong một ô bảng là mời gọi lỗi.

### 8.2 `/eng/scheduler/:id` tab **Tuần** — Weekly Calendar (Mode 1)

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ ← SCH-001 · HVAC Văn phòng                    ●PUBLISHED rev 5  [Bật ●] [Lưu]  │
│ [Tuần] [Ngoại lệ 2] [Target 3] [Mô phỏng] [Revision] [Audit]                   │
├────────────────────────────────────────────────────────────────────────────────┤
│ Kiểu giá trị BINARY 🔒   Mặc định: TẮT   Hiệu lực: 01/01/2026 → không kết thúc  │
│ Priority ghi: 16  (mức schedule của controller)   Múi giờ: Asia/Ho_Chi_Minh     │
├──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬────────────────────────┤
│      │  T2  │  T3  │  T4  │  T5  │  T6  │  T7  │  CN  │  Cặp Time-Value  (S4)  │
│ 00 ──┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤  ┌──────────────────┐  │
│ 04 ──┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤  │ T2               │  │
│ 06 ──┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤  │ 08:00:00 = BẬT   │  │
│ 08 ──┼─▓▓▓▓─┼─▓▓▓▓─┼─▓▓▓▓─┼─▓▓▓▓─┼─▓▓▓▓─┼──────┼──────┤  │ 12:00:00 = TẮT   │  │
│ 10 ──┼─▓▓▓▓─┼─▓▓▓▓─┼─▓▓▓▓─┼─▓▓▓▓─┼─▓▓▓▓─┼──────┼──────┤  │ 13:00:00 = BẬT   │  │
│ 12 ──┼─░░░░─┼─░░░░─┼─░░░░─┼─░░░░─┼─░░░░─┼──────┼──────┤  │ 18:00:00 = TẮT   │  │
│ 13 ──┼─▓▓▓▓─┼─▓▓▓▓─┼─▓▓▓▓─┼─▓▓▓▓─┼─▓▓▓▓─┼──────┼──────┤  └──────────────────┘  │
│ 16 ━━┿━▓▓▓▓━┿━━━━━━┿━━━━━━┿━━━━━━┿━━━━━━┿━━━━━━┿━━━━━━┥   ← bây giờ 16:24      │
│ 18 ──┼──────┼──────┼──────┼──────┼──────┼──────┼──────┤  [Sao chép T2 sang…]   │
│ 24 ──┴──────┴──────┴──────┴──────┴──────┴──────┴──────┘  [+ Thêm khoảng]       │
│      ▓ BẬT   ░ TẮT (mặc định)   ▒ ngoại lệ ghi đè                              │
├────────────────────────────────────────────────────────────────────────────────┤
│ Đang hiệu lực: BẬT · nguồn: Lịch tuần · chuyển kế tiếp 18:00 hôm nay (còn 1h36) │ ← runtime (S2)
└────────────────────────────────────────────────────────────────────────────────┘
```

- **Bảng Time-Value nằm ngay cạnh lịch, không giấu sau tab.** Đây là hiện thân của S4:
  vẽ khối bên trái, cặp giá trị hiện bên phải theo thời gian thực.
- **`Kiểu giá trị BINARY 🔒`** — ổ khoá nói rằng đã có target thì không đổi được nữa,
  đúng nguyên tắc spec §2.1. Bấm vào khoá giải thích tại sao và cách đổi (gỡ hết target).
- **Dải runtime dưới cùng luôn hiện diện** ở mọi tab của Editor — người dùng không bao giờ
  sửa lịch mà không thấy lịch đang làm gì.
- Bàn phím (S7): `Tab` chọn khối → `←/→` dời 5 phút → `Shift+←/→` đổi thời lượng →
  `Enter` mở ô nhập giờ chính xác → `Delete` xoá.

### 8.3 tab **Ngoại lệ** — Exception Manager

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ Ngoại lệ của SCH-001            Ghi đè lịch tuần khi ngày khớp   [+ Thêm]       │
├────────────────────────────────────────────────────────────────────────────────┤
│ ⛔ SCH-CONFIG-003 — EXC-002 và EXC-003 cùng rơi vào 02/09/2026 và cùng          │
│    event_priority = 5. Hệ thống KHÔNG tự chọn. Hãy đổi priority một trong hai.  │
│    [Tới EXC-002]  [Tới EXC-003]                                                │
├─────┬─────────────────┬──────────────────┬──────┬──────────────────────────────┤
│ Ưu  │ Tên             │ Quy tắc ngày     │ Sự kiện │ 12 tháng tới rơi vào       │
├─────┼─────────────────┼──────────────────┼──────┼──────────────────────────────┤
│  1  │ Quốc khánh      │ NGÀY 02/09/2026  │ 00:00 TẮT │ 02/09/2026                │
│  3  │ Tết Nguyên đán  │ KHOẢNG 14→20/02  │ 00:00 TẮT │ 14,15,16,17,18,19,20/02   │
│  5  │ Bảo trì thứ 2   │ TUẦN N T2 đầu tháng│ 06:00 BẬT│ 07/09, 05/10, 02/11 …    │
│  5  │ Nhóm lễ công ty │ NHÓM "Lễ công ty"│ 00:00 TẮT │ 02/09 ⚠, 24/12, 31/12    │
└─────┴─────────────────┴──────────────────┴──────┴──────────────────────────────┘
```

Cột **"12 tháng tới rơi vào"** là điểm cốt lõi. `WEEK_N_DAY` và `HOLIDAY_GROUP` là hai
kiểu quy tắc mà con người **không** tính nhẩm được — không có cột này thì người dùng
publish một quy tắc mà không biết nó sẽ nổ vào ngày nào. Ngày đụng độ mang dấu ⚠ và
liên kết tới đúng dòng cảnh báo phía trên.

### 8.4 tab **Target** — Target Mapping

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ Target của SCH-001 · kiểu BINARY · priority ghi 16          [+ Thêm target]     │
│ Chỉ điểm ghi được và tương thích BINARY mới hiện trong danh sách.               │
├───┬──────────┬────────────┬──────────┬───────────────┬─────────────────────────┤
│   │ Điểm     │ Loại       │ Ghi được │ Giá trị thật   │ Kết quả ghi lần cuối    │
├───┼──────────┼────────────┼──────────┼───────────────┼─────────────────────────┤
│ ⣿ │ DO-01    │ Nội bộ / BO│ ✓        │ BẬT           │ OK · 16:00:00           │
│ ⣿ │ DO-02    │ Nội bộ / BO│ ✓        │ BẬT           │ OK · 16:00:00           │
│ ⣿ │ BV-03    │ Nội bộ / BV│ ✓        │ TẮT ⚠         │ SCH-WRITE-002 timeout   │
│   │          │            │          │               │ 3 lần · [Chi tiết]      │
├───┴──────────┴────────────┴──────────┴───────────────┴─────────────────────────┤
│ ℹ Một target lỗi không chặn các target khác (spec §11). SCH-001 vẫn đang chạy.  │
└────────────────────────────────────────────────────────────────────────────────┘
```

Danh sách chọn target **lọc sẵn** theo `value_type` và cờ ghi được, thay vì cho chọn tự
do rồi báo lỗi `SCH-TARGET-002`/`003` sau — chặn sớm tại chỗ nhập.

### 8.5 tab **Mô phỏng** — Simulation

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ Mô phỏng   ( • 7 ngày   ○ 30 ngày   ○ Ngày cụ thể [__/__/____] )   [Chạy lại]  │
├────────────────────────────────────────────────────────────────────────────────┤
│  T2 07/08 ░░░░░░░░▓▓▓▓▓▓▓▓░░░░▓▓▓▓▓▓▓▓░░░░░░  Tuần                             │
│  T3 08/08 ░░░░░░░░▓▓▓▓▓▓▓▓░░░░▓▓▓▓▓▓▓▓░░░░░░  Tuần                             │
│  T7 12/08 ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  Mặc định                          │
│  CN 13/08 ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  Ngoại lệ EXC-001                 │
│           0    4    8   12   16   20   24                                       │
├────────────────────────────────────────────────────────────────────────────────┤
│ 12 lần chuyển trạng thái · 0 khoảng trống · 0 xung đột                         │
│                                                                                 │
│ 07/08/2026 08:00  Tuần(T2)      → BẬT   → DO-01, DO-02, BV-03   prio 16        │
│ 07/08/2026 12:00  Tuần(T2)      → TẮT   → DO-01, DO-02, BV-03   prio 16        │
│ 13/08/2026 00:00  EXC-001       → TẮT   → DO-01, DO-02, BV-03   prio 16        │
└────────────────────────────────────────────────────────────────────────────────┘
```

Mô phỏng **chạy ở backend** bằng đúng đoạn mã mà controller dùng để đánh giá — mô phỏng
bằng một bản cài lại trong JavaScript là tự nói dối: nó sẽ đúng cho tới ngày hai bản lệch
nhau, và ngày đó không ai biết.

### 8.6 Publish Review — modal diff

```
┌──────────────────── Publish SCH-001 xuống controller ──────────────────────────┐
│                    ĐANG CHẠY rev 5          →          SẼ CHẠY rev 6           │
│ Lịch tuần T2-T6      08:00 BẬT / 18:00 TẮT     08:00 BẬT / 12:00 TẮT ▲        │
│                                                 13:00 BẬT / 18:00 TẮT ▲        │
│ Ngoại lệ                    1                          2 ▲                     │
│ ⚠ Target                DO-01, DO-02              DO-01, DO-02, BV-03 ▲        │
│ ⚠ Priority ghi              16                         16                      │
│ Mặc định                   TẮT                        TẮT                      │
├────────────────────────────────────────────────────────────────────────────────┤
│ Lý do thay đổi (bắt buộc, vào audit)                                           │
│ [ Bổ sung nghỉ trưa 12:00-13:00 theo yêu cầu BQL___________________________ ]  │
│                                                                                 │
│ Publish sẽ ghi BV-03 lần đầu tiên. Lịch cũ vẫn chạy tới khi controller ACK.     │
│                                             [Huỷ]  [Publish và chờ ACK]        │
└────────────────────────────────────────────────────────────────────────────────┘
```

Sau khi bấm: `Đang gửi… → Chờ ACK (đếm ngược 5 s) → ✓ Đã ACK, rev 6 đang chạy` hoặc
`✗ NACK: SCH-PUBLISH-001 — rev 5 vẫn đang chạy, không có gì thay đổi`. Dòng cuối là bắt
buộc: người dùng phải biết chắc là hệ thống **không** rơi vào trạng thái nửa vời.

### 8.7 `/eng/scheduler/runtime` — Logic Cards (Mode 3)

Mỗi thẻ vẽ đúng chuỗi của spec §16.3, đọc từ trái sang phải:

```
┌── SCH-001 · HVAC Văn phòng ────────────────────────── ●ACTIVE rev 6 ───────────┐
│                                                                                 │
│  Lịch tuần T2 ──┐                                                               │
│                 ├──→  BẬT  ──→  prio 16  ──┬──→ DO-01   BẬT   ✓                │
│  Ngoại lệ ──────┘     nguồn: Tuần          ├──→ DO-02   BẬT   ✓                │
│  (không áp dụng)      chuyển 18:00         └──→ BV-03   TẮT   ⚠ SCH-WRITE-002  │
│                                                                                 │
│  ⚠ DO-02 đang bị Local Manual (mức 2) giữ — lệnh lịch không tới được đầu ra.    │
└─────────────────────────────────────────────────────────────────────────────────┘
```

Dòng cảnh báo cuối là lý do trang này tồn tại: nó trả lời câu hỏi **"lịch bật rồi mà sao
quạt không chạy"** — câu hỏi tốn nhiều thời gian hiện trường nhất, và là câu mà giao diện
hiện tại hoàn toàn không trả lời được.

### 8.8 Trạng thái và màu

| Trạng thái | Trình bày | Token |
|---|---|---|
| `DRAFT` | ◐ viền đứt, chữ mờ | `--c-text-dim` |
| `VALIDATED` | ◑ viền liền, chưa tô | `--c-border` |
| `PUBLISHED` | ● chấm đặc | `--c-accent` |
| `ACTIVE` | ● chấm đặc + nhịp thở | `--c-good` |
| `INACTIVE` | ○ chấm rỗng | `--c-text-dim` |
| `DISABLED` | ⊘ gạch chéo | `--c-text-dim` |
| `ERROR` | ✕ nền cảnh báo | `--c-bad` |
| `OUT_OF_SYNC` | ▲ + hai số revision | `--c-warn` |

Không dùng màu làm kênh thông tin duy nhất — mỗi trạng thái có ký hiệu riêng, đọc được
khi in đen trắng và khi người dùng bị mù màu.

---

## 9. Phân quyền (theo QĐ-5)

| Vai trò spec | Vai trò thật | Quyền thao tác |
|---|---|---|
| Viewer | `viewer` | Đọc mọi thứ, kể cả runtime và audit |
| Operator | `operator` | + `schedule.enable` (bật/tắt lịch đã publish) |
| Engineer | `admin` | + tạo/sửa/xoá nháp, validate, simulate |
| Commissioning Engineer | `admin` + `schedule.publish` | + gán target, publish, đổi priority |
| Administrator | `admin` + `schedule.rollback` + `schedule.delete` | toàn quyền |
| Auditor | `viewer` + `schedule.audit.read` | đọc revision và audit (không sửa) |

Bốn quyền `schedule.publish` / `rollback` / `delete` / `priority` là **quyền riêng** đúng
như spec §19 câu cuối yêu cầu. Backend chặn bằng 403; giao diện làm mờ nút kèm tooltip
nêu quyền còn thiếu — không giấu nút, vì nút biến mất khiến người dùng tưởng chức năng
không tồn tại.

---

## 10. Lộ trình đề xuất

| Pha | Nội dung | Kết quả kiểm chứng |
|---|---|---|
| **P0** | Chốt tài liệu này + 6 quyết định §4 | Có chữ ký review |
| **P1 — Mô hình** | Hợp đồng v3.1 (`contracts/config/schedule_v3_1.schema.json`), `ScheduleRuntime` mới (weekly N-event + exception + default + effective period), bộ chuyển đổi v1→v3.1, 14 endpoint REST, revision + audit | ctest xanh; test round-trip v1→v3.1; đo lại thời gian đánh giá 64 lịch (spec đòi <100 ms) |
| **P2 — Giao diện** | Grid, Editor 6 tab, Weekly Calendar kéo thả, Exception Manager, Target Mapping, Simulation, Publish diff | vitest + `npx playwright test e2e/scheduler.spec.ts`; đo thời gian mở danh sách 64 lịch (spec đòi <2 s) |
| **P3 — Runtime & đồng bộ** | Timezone/DST, phát hiện nhảy giờ, đánh giá lại sau NTP, khôi phục sau mất điện, Logic Cards, Diagnostics | Test trên bo: đổi giờ, cắt điện, NTP đồng bộ lại |
| **P4 — BACnet** | Schedule Object (17) + Calendar (6), cập nhật PICS/EPICS/BTL matrix | Đối chiếu ma trận BTL hiện có |

`priority_for_writing` chỉ bật ở P2 sau khi QĐ-1 được chốt — phơi một ô priority mà core
chưa tôn trọng là hứa suông với người vận hành.

---

## 11. Rủi ro

| Rủi ro | Mức | Ứng phó |
|---|---|---|
| Mất cấu hình đang chạy trên bo khi di trú | **Cao** | QĐ-6: chuyển đổi tự động + `.bak` + băng thông báo bắt buộc xác nhận |
| Spec giả định MQTT, kiến trúc thật không có | Cao | QĐ-2: dựng ngữ nghĩa publish/ACK trước, transport sau |
| Priority 1..16 không có chỗ dựa vật lý ở core | Cao | QĐ-1: ánh xạ và **nói thật** trên giao diện |
| 64×32 target vượt xa số điểm ghi thật | Trung bình | QĐ-3: đo dung lượng thật hiển thị ngay đầu trang |
| Kéo thả trên màn hình chạm của tủ điện | Trung bình | S7: mọi thao tác đều có đường bàn phím và ô nhập giờ chính xác |
| Mô phỏng lệch với runtime thật | Trung bình | §8.5: mô phỏng chạy bằng đúng mã của controller, không cài lại ở FE |
| `SchedulerPage.tsx` 756 dòng phình tiếp | Thấp | Tách theo route/tab ngay từ P2, không để một file gánh cả 11 màn hình |

---

## 12. Cần anh chốt

1. **Sáu quyết định §4** — đặc biệt QĐ-1 (priority) và QĐ-2 (MQTT), vì chúng quyết định
   hợp đồng dữ liệu, và hợp đồng quyết định giao diện.
2. **Kiến trúc thông tin §7** — 4 route + tab, hay anh muốn khác.
3. **Phạm vi P1/P2** — làm trọn v3.1 hay cắt exception nâng cao (`WEEK_N_DAY`,
   `CALENDAR_REFERENCE`) sang P3.
4. **Số phận trang hiện tại** — thay thẳng, hay chạy song song sau cờ tính năng cho tới khi
   di trú xong.

Chốt xong sẽ tách thành hai tài liệu chuẩn `KX-DDC24-UC-WEB-SCHEDULER-001_VI.md` và
`KX-DDC24-UX-WEB-SCHEDULER-001_VI.md` theo khuôn của họ `WEB-NETWORK`, rồi mới vào code.

---

## Revision History

| Phiên bản | Ngày | Người | Nội dung |
|---|---|---|---|
| 0.1 | 2026-08-07 | Claude Code | Bản đầu: đối chiếu spec v3.1 với mã nguồn tại `5fef0b9`, 20 khoảng cách, 6 quyết định cần chốt, 26 use case, kiến trúc thông tin và wireframe 7 màn hình |
