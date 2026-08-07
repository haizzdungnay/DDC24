# PRODUCT SPECIFICATION

## KinexusBMS Modern Scheduler Engine

**Sản phẩm:** KinexusBMS
**Module:** Scheduler Engine
**Phiên bản kiến trúc:** v3.1
**Mô hình:** Object-Oriented, BACnet Schedule Object–Aligned
**Giao tiếp:** REST API / MQTT JSON / BACnet
**Giới hạn:** Tối đa 64 Schedule Object trên mỗi Controller/Gateway
**Trạng thái:** Implementation Ready cho Backend, Frontend và Controller Runtime
**Thay thế:** Loại bỏ hoàn toàn cơ chế thanh ghi lịch TSx cũ

---

## 1. Mục tiêu sản phẩm

KinexusBMS Modern Scheduler Engine cung cấp chức năng lập lịch tự động cho các hệ thống:

* HVAC, AHU, FCU, VAV.
* Chiếu sáng.
* Bơm, quạt và thiết bị phụ trợ.
* Nhiệt độ, độ sáng và các setpoint vận hành.
* Chế độ ngày làm việc, cuối tuần, ngày lễ và ngày ngoại lệ.

Scheduler Engine chuyển hoàn toàn từ mô hình thanh ghi `TSx` sang mô hình đối tượng hiện đại:

```text
Schedule Object
├── Weekly Schedule
├── Exception Schedule
├── Effective Period
├── Schedule Default
├── Target Objects
└── Priority for Writing
```

Mục tiêu chính:

1. Quản lý tối đa 64 lịch trên mỗi Controller/Gateway.
2. Hỗ trợ lịch tuần, ngày lễ và ngoại lệ.
3. Tương thích mô hình BACnet Schedule Object.
4. Đồng bộ cấu hình qua REST API và MQTT JSON.
5. Cung cấp giao diện phù hợp cho cả kỹ sư SI và người vận hành.
6. Hỗ trợ kiểm tra, mô phỏng, publish, rollback và audit.
7. Loại bỏ hoàn toàn phụ thuộc vào địa chỉ thanh ghi lịch cũ.

---

## 2. Nguyên tắc thiết kế

### 2.1 Một Schedule Object điều khiển một kiểu dữ liệu

Một Schedule Object chỉ được sử dụng cho một kiểu giá trị thống nhất:

| Kiểu lịch  | Giá trị                    |
| ---------- | -------------------------- |
| Binary     | `ACTIVE`, `INACTIVE`       |
| Boolean    | `true`, `false`            |
| Real       | `24.0`, `50.0`             |
| Unsigned   | `0`, `1`, `100`            |
| Enumerated | Giá trị enum của đối tượng |

Không cho phép một Schedule Object đồng thời ghi:

```json
{
  "state": "ON",
  "setpoint": 24.0
}
```

Trường hợp cần vừa bật thiết bị vừa đặt nhiệt độ phải tạo hai lịch:

```text
SCH-HVAC-ENABLE      → Binary Output
SCH-HVAC-SETPOINT    → Analog Value
```

### 2.2 Lịch tuần và ngoại lệ thuộc cùng một Schedule Object

Không sử dụng `schedule_type` để tách thành ba loại lịch độc lập.

Mỗi Schedule Object có thể đồng thời chứa:

* Lịch tuần.
* Lịch ngày lễ.
* Lịch ngoại lệ.
* Khoảng thời gian hiệu lực.

### 2.3 UI có thể dùng Start/End, Backend lưu Time-Value

Người dùng có thể thao tác theo dạng:

```text
08:00 → 18:00: ON
```

Backend phải biên dịch thành danh sách Time-Value:

```json
[
  {
    "time": "08:00:00",
    "value": "ACTIVE"
  },
  {
    "time": "18:00:00",
    "value": "INACTIVE"
  }
]
```

---

## 3. Kiến trúc hệ thống

```text
┌───────────────────────────────────────────────────────┐
│                  FRONTEND SCHEDULER                   │
│ Weekly Calendar │ Grid │ Logic View │ Simulation      │
└──────────────────────────┬────────────────────────────┘
                           │ REST / WebSocket
┌──────────────────────────▼────────────────────────────┐
│                 SCHEDULER BACKEND                     │
│ Validation │ Versioning │ Audit │ Publish │ Rollback  │
│ BACnet Mapping │ MQTT Contract │ Conflict Detection   │
└──────────────────────────┬────────────────────────────┘
                           │ MQTT / Internal API
┌──────────────────────────▼────────────────────────────┐
│              CONTROLLER SCHEDULER RUNTIME             │
│ Time Engine │ Weekly/Exception Evaluation             │
│ Priority Write │ Relinquish │ Retry │ Diagnostics     │
└──────────────────────────┬────────────────────────────┘
                           │
┌──────────────────────────▼────────────────────────────┐
│                   TARGET OBJECTS                      │
│ BACnet Objects │ Internal Points │ Device Points      │
└───────────────────────────────────────────────────────┘
```

---

## 4. Mô hình dữ liệu Schedule Object

### 4.1 JSON Data Contract

```json
{
  "schema_version": "3.1",
  "schedule_id": "SCH-001",
  "bacnet_object": {
    "object_type": "SCHEDULE",
    "object_instance": 1
  },
  "schedule_name": "HVAC Office Working Hours",
  "description": "Lịch vận hành điều hòa khu vực văn phòng",
  "enabled": true,
  "status": "PUBLISHED",
  "timezone": "Asia/Ho_Chi_Minh",
  "effective_period": {
    "start_date": "2026-01-01",
    "end_date": null
  },
  "value_type": "BINARY",
  "priority_for_writing": 16,
  "schedule_default": {
    "value": "INACTIVE"
  },
  "weekly_schedule": {
    "MON": [
      {
        "time": "08:00:00",
        "value": "ACTIVE"
      },
      {
        "time": "18:00:00",
        "value": "INACTIVE"
      }
    ],
    "TUE": [
      {
        "time": "08:00:00",
        "value": "ACTIVE"
      },
      {
        "time": "18:00:00",
        "value": "INACTIVE"
      }
    ],
    "WED": [],
    "THU": [],
    "FRI": [],
    "SAT": [],
    "SUN": []
  },
  "exception_schedule": [
    {
      "exception_id": "EXC-001",
      "name": "Vietnam National Day",
      "date_rule": {
        "type": "DATE",
        "date": "2026-09-02"
      },
      "event_priority": 1,
      "time_values": [
        {
          "time": "00:00:00",
          "value": "INACTIVE"
        }
      ]
    }
  ],
  "target_objects": [
    {
      "target_id": "TGT-001",
      "device_id": "DDC-01",
      "device_instance": 1001,
      "object_type": "BINARY_OUTPUT",
      "object_instance": 1,
      "property_identifier": "PRESENT_VALUE",
      "array_index": null
    }
  ],
  "revision": 1,
  "created_at": "2026-08-06T10:00:00+07:00",
  "created_by": "admin",
  "updated_at": "2026-08-06T10:00:00+07:00",
  "updated_by": "admin"
}
```

---

## 5. Các thuộc tính bắt buộc

| Thuộc tính             | Kiểu    | Yêu cầu                                                |
| ---------------------- | ------- | ------------------------------------------------------ |
| `schedule_id`          | String  | Mã duy nhất từ `SCH-001` đến `SCH-064`                 |
| `schedule_name`        | String  | Tối đa 64 ký tự                                        |
| `enabled`              | Boolean | Cho phép bật hoặc tắt lịch                             |
| `status`               | Enum    | `DRAFT`, `VALIDATED`, `PUBLISHED`, `ERROR`, `DISABLED` |
| `timezone`             | String  | IANA timezone, mặc định `Asia/Ho_Chi_Minh`             |
| `effective_period`     | Object  | Khoảng ngày lịch có hiệu lực                           |
| `value_type`           | Enum    | `BINARY`, `BOOLEAN`, `REAL`, `UNSIGNED`, `ENUMERATED`  |
| `weekly_schedule`      | Object  | Đủ bảy ngày từ thứ Hai đến Chủ nhật                    |
| `exception_schedule`   | Array   | Ngày lễ và lịch ngoại lệ                               |
| `schedule_default`     | Object  | Giá trị mặc định khi không có event hiệu lực           |
| `target_objects`       | Array   | Danh sách point hoặc BACnet object mục tiêu            |
| `priority_for_writing` | Integer | Từ 1 đến 16, mặc định 16                               |
| `revision`             | Integer | Tăng sau mỗi lần cập nhật                              |
| `description`          | String  | Mô tả mục đích của lịch                                |

---

## 6. Weekly Schedule

### 6.1 Cấu trúc

Weekly Schedule luôn có đủ bảy ngày:

```json
{
  "MON": [],
  "TUE": [],
  "WED": [],
  "THU": [],
  "FRI": [],
  "SAT": [],
  "SUN": []
}
```

Mỗi ngày chứa danh sách Time-Value được sắp xếp tăng dần theo thời gian.

### 6.2 Quy tắc kiểm tra

* Thời gian dùng định dạng `HH:mm:ss`.
* Không được có hai event cùng thời điểm trong một ngày.
* Giá trị phải phù hợp với `value_type`.
* Các event phải được tự động sắp xếp theo thời gian.
* Không giới hạn UI ở một khung Start/End duy nhất.
* Một ngày có thể chứa nhiều lần chuyển trạng thái.

Ví dụ:

```json
[
  {
    "time": "07:30:00",
    "value": "ACTIVE"
  },
  {
    "time": "12:00:00",
    "value": "INACTIVE"
  },
  {
    "time": "13:00:00",
    "value": "ACTIVE"
  },
  {
    "time": "18:00:00",
    "value": "INACTIVE"
  }
]
```

---

## 7. Exception Schedule

Exception Schedule dùng để ghi đè lịch tuần.

### 7.1 Loại ngoại lệ

| Loại                 | Mô tả                            |
| -------------------- | -------------------------------- |
| `DATE`               | Một ngày cụ thể                  |
| `DATE_RANGE`         | Khoảng ngày                      |
| `WEEK_N_DAY`         | Ví dụ thứ Hai đầu tiên của tháng |
| `CALENDAR_REFERENCE` | Tham chiếu Calendar Object       |
| `HOLIDAY_GROUP`      | Nhóm ngày lễ của KinexusBMS      |

### 7.2 Event Priority

Mỗi ngoại lệ có `event_priority` từ 1 đến 16:

```text
1  = ưu tiên cao nhất
16 = ưu tiên thấp nhất
```

`event_priority` chỉ dùng để giải quyết nhiều ngoại lệ cùng hiệu lực.

Nó không phải là `priority_for_writing`.

### 7.3 Quy tắc ghi đè

Thứ tự tính toán:

```text
Exception Schedule hợp lệ
        ↓
Weekly Schedule
        ↓
Schedule Default
```

Khi nhiều exception cùng hiệu lực:

1. Chọn exception có `event_priority` cao hơn.
2. Nếu bằng priority, báo conflict cấu hình.
3. Không tự động chọn theo thời gian tạo.

---

## 8. Target Objects

### 8.1 Cấu trúc target

```json
{
  "target_id": "TGT-001",
  "device_id": "DDC-01",
  "device_instance": 1001,
  "object_type": "BINARY_OUTPUT",
  "object_instance": 1,
  "property_identifier": "PRESENT_VALUE",
  "array_index": null
}
```

### 8.2 Quy tắc target

* Một lịch có thể điều khiển nhiều target.
* Tất cả target phải tương thích cùng `value_type`.
* Property mục tiêu phải cho phép ghi.
* Target bị offline không được làm dừng toàn bộ lịch.
* Kết quả ghi phải được lưu riêng cho từng target.
* Không cho phép trùng cùng target trong một Schedule Object.
* Không cho phép target không tồn tại được publish.

### 8.3 Target nội bộ Kinexus

Ngoài BACnet Object, hệ thống được phép ánh xạ tới point nội bộ:

```json
{
  "target_type": "INTERNAL_POINT",
  "point_id": "DDC01.AHU01.ENABLE"
}
```

Backend chịu trách nhiệm chuyển đổi target nội bộ sang driver tương ứng.

---

## 9. Priority và relinquish

### 9.1 Priority for Writing

```json
{
  "priority_for_writing": 16
}
```

Giá trị từ 1 đến 16:

```text
1  = ưu tiên cao nhất
16 = ưu tiên lịch vận hành thông thường
```

### 9.2 Khi disable lịch

Khi người dùng tắt lịch, Runtime phải:

1. Ngừng đánh giá lịch.
2. Ghi `NULL` hoặc lệnh relinquish tại priority đang sử dụng.
3. Không giữ giá trị điều khiển cuối cùng.
4. Cập nhật trạng thái `DISABLED`.
5. Ghi audit log.
6. Cập nhật kết quả về Backend.

### 9.3 Khi xóa lịch

Trước khi xóa:

1. Relinquish toàn bộ target.
2. Xác nhận không còn command giữ tại priority của lịch.
3. Lưu phiên bản cuối trong audit.
4. Sau đó mới xóa Schedule Object.

---

## 10. Scheduler Runtime

### 10.1 Chu trình xử lý

```text
1. Đọc thời gian hệ thống.
2. Chuyển đổi theo timezone của lịch.
3. Kiểm tra effective period.
4. Kiểm tra exception schedule.
5. Nếu không có exception, tính weekly schedule.
6. Nếu chưa có event hợp lệ, dùng schedule default.
7. So sánh với giá trị effective trước đó.
8. Ghi giá trị tới target.
9. Lưu trạng thái và kết quả ghi.
10. Tính thời điểm chuyển trạng thái tiếp theo.
```

### 10.2 Điều kiện bắt buộc đánh giá lại lịch

Runtime phải tính lại lịch khi:

* Qua 00:00.
* Khởi động hoặc reset Controller.
* Thời gian hệ thống thay đổi.
* Timezone thay đổi.
* NTP đồng bộ lại thời gian.
* Lịch được publish.
* Lịch được enable hoặc disable.
* Weekly Schedule thay đổi.
* Exception Schedule thay đổi.
* Target hoặc priority thay đổi.
* Controller khôi phục sau mất điện.

### 10.3 Xử lý thời gian

Runtime phải hỗ trợ:

* RTC nội bộ.
* NTP synchronization.
* Timezone IANA.
* UTC timestamp khi lưu dữ liệu.
* Local time khi hiển thị.
* Thay đổi múi giờ.
* DST đối với các quốc gia có áp dụng.
* Phát hiện nhảy thời gian về trước hoặc về sau.

### 10.4 Khôi phục sau mất điện

Sau khi khởi động lại:

1. Đồng bộ thời gian.
2. Tải phiên bản lịch đã publish gần nhất.
3. Tính giá trị đang có hiệu lực.
4. Ghi lại giá trị tới target.
5. Không phát lại toàn bộ event đã bỏ lỡ.
6. Ghi sự kiện recovery vào audit log.

---

## 11. Xử lý lỗi

| Mã lỗi             | Mô tả                                 |
| ------------------ | ------------------------------------- |
| `SCH-CONFIG-001`   | Thiếu Schedule Default                |
| `SCH-CONFIG-002`   | Weekly Schedule không hợp lệ          |
| `SCH-CONFIG-003`   | Exception bị trùng hoặc xung đột      |
| `SCH-TARGET-001`   | Target không tồn tại                  |
| `SCH-TARGET-002`   | Property không cho phép ghi           |
| `SCH-TARGET-003`   | Kiểu dữ liệu target không tương thích |
| `SCH-TIME-001`     | Timezone không hợp lệ                 |
| `SCH-TIME-002`     | Thời gian hệ thống chưa đồng bộ       |
| `SCH-WRITE-001`    | Ghi target thất bại                   |
| `SCH-WRITE-002`    | Ghi target timeout                    |
| `SCH-RUNTIME-001`  | Scheduler Runtime không hoạt động     |
| `SCH-VERSION-001`  | Revision conflict                     |
| `SCH-PUBLISH-001`  | Publish thất bại                      |
| `SCH-ROLLBACK-001` | Rollback thất bại                     |

Một target ghi lỗi không được ngăn các target khác tiếp tục thực hiện.

---

## 12. Trạng thái Schedule

```text
DRAFT
  ↓
VALIDATED
  ↓
PUBLISHED
  ↓
ACTIVE / INACTIVE
```

Các trạng thái hệ thống:

| Trạng thái    | Ý nghĩa                                        |
| ------------- | ---------------------------------------------- |
| `DRAFT`       | Đang chỉnh sửa, chưa áp dụng                   |
| `VALIDATED`   | Đã kiểm tra hợp lệ                             |
| `PUBLISHED`   | Đã gửi xuống Controller                        |
| `ACTIVE`      | Lịch đang chạy và có hiệu lực                  |
| `INACTIVE`    | Đang ngoài effective period hoặc chưa có event |
| `DISABLED`    | Người dùng đã tắt                              |
| `ERROR`       | Lỗi cấu hình hoặc runtime                      |
| `OUT_OF_SYNC` | Backend và Controller khác revision            |

---

## 13. Publish và versioning

### 13.1 Workflow

```text
Create/Edit
    ↓
Validate
    ↓
Preview
    ↓
Publish
    ↓
Controller ACK
    ↓
Active Revision
```

### 13.2 Quy tắc publish

* Chỉ lịch hợp lệ mới được publish.
* Publish phải có `revision`.
* Controller phải trả ACK hoặc NACK.
* Không được ghi đè revision mới hơn.
* Lịch cũ vẫn hoạt động cho tới khi lịch mới được activate thành công.
* Publish thất bại phải giữ nguyên revision đang chạy.
* Mọi lần publish phải có audit log.

### 13.3 Rollback

Hệ thống phải lưu tối thiểu 10 revision gần nhất.

Người dùng có thể:

* Xem diff.
* Khôi phục revision trước.
* Validate lại.
* Publish revision rollback.
* Xem người thực hiện và lý do rollback.

---

## 14. MQTT Data Contract

### 14.1 Topic đề xuất

```text
kinexus/{site_id}/{controller_id}/scheduler/config/set
kinexus/{site_id}/{controller_id}/scheduler/config/ack
kinexus/{site_id}/{controller_id}/scheduler/state
kinexus/{site_id}/{controller_id}/scheduler/event
kinexus/{site_id}/{controller_id}/scheduler/diagnostic
```

### 14.2 Payload cấu hình

```json
{
  "message_id": "UUID",
  "correlation_id": "UUID",
  "schema_version": "3.1",
  "controller_id": "DDC-01",
  "schedule_id": "SCH-001",
  "revision": 5,
  "operation": "PUBLISH",
  "payload": {},
  "timestamp": "2026-08-06T03:00:00Z"
}
```

### 14.3 ACK

```json
{
  "message_id": "UUID",
  "correlation_id": "UUID",
  "schedule_id": "SCH-001",
  "revision": 5,
  "result": "ACCEPTED",
  "error_code": null,
  "error_message": null,
  "applied_at": "2026-08-06T03:00:02Z"
}
```

### 14.4 Yêu cầu MQTT

* QoS 1 cho cấu hình và ACK.
* Message phải có ID duy nhất.
* Controller xử lý idempotent.
* Chống áp dụng lặp cùng revision.
* Có timeout chờ ACK.
* Có retry giới hạn.
* Không lưu retained message cho command tạm thời.
* State topic có thể sử dụng retained message.
* Xác thực thiết bị và phân quyền topic.

---

## 15. REST API

| Method   | Endpoint                           | Chức năng                |
| -------- | ---------------------------------- | ------------------------ |
| `GET`    | `/api/v1/schedules`                | Danh sách lịch           |
| `POST`   | `/api/v1/schedules`                | Tạo lịch                 |
| `GET`    | `/api/v1/schedules/{id}`           | Chi tiết lịch            |
| `PUT`    | `/api/v1/schedules/{id}`           | Cập nhật lịch            |
| `DELETE` | `/api/v1/schedules/{id}`           | Xóa lịch                 |
| `POST`   | `/api/v1/schedules/{id}/validate`  | Kiểm tra cấu hình        |
| `POST`   | `/api/v1/schedules/{id}/simulate`  | Mô phỏng lịch            |
| `POST`   | `/api/v1/schedules/{id}/publish`   | Publish xuống Controller |
| `POST`   | `/api/v1/schedules/{id}/enable`    | Bật lịch                 |
| `POST`   | `/api/v1/schedules/{id}/disable`   | Tắt lịch                 |
| `GET`    | `/api/v1/schedules/{id}/revisions` | Danh sách revision       |
| `POST`   | `/api/v1/schedules/{id}/rollback`  | Rollback revision        |
| `GET`    | `/api/v1/schedules/{id}/runtime`   | Trạng thái runtime       |
| `GET`    | `/api/v1/schedules/{id}/audit`     | Lịch sử thay đổi         |

---

## 16. UI/UX Hybrid

Scheduler cung cấp ba chế độ hiển thị dùng chung một Data Model.

### 16.1 Mode 1 — Weekly Visual Calendar

Dành cho người vận hành và quản lý tòa nhà.

Chức năng:

* Hiển thị bảy ngày trong tuần.
* Event dạng khối thời gian.
* Kéo thả để đổi giờ.
* Kéo cạnh block để thay đổi thời lượng.
* Copy event sang nhiều ngày.
* Hiển thị ngày lễ và ngoại lệ trên lịch.
* Hiển thị màu theo trạng thái và giá trị.
* Xem giá trị đang hiệu lực.
* Xem lần chuyển trạng thái tiếp theo.
* Cảnh báo lịch bị override.

### 16.2 Mode 2 — High-Density Grid

Dành cho kỹ sư SI và commissioning.

Các cột chính:

| Cột              | Nội dung                |
| ---------------- | ----------------------- |
| ID               | Mã lịch                 |
| Name             | Tên lịch                |
| Status           | Trạng thái              |
| Effective Period | Khoảng hiệu lực         |
| Weekly Pattern   | Ngày và thời gian       |
| Exceptions       | Số lượng ngoại lệ       |
| Target           | Thiết bị/point mục tiêu |
| Value Type       | Kiểu dữ liệu            |
| Priority         | Priority ghi            |
| Current Value    | Giá trị hiện tại        |
| Next Transition  | Lần chuyển tiếp theo    |
| Revision         | Phiên bản               |
| Sync State       | Trạng thái đồng bộ      |

Chức năng:

* Inline edit.
* Multi-select.
* Copy/Paste.
* Duplicate schedule.
* Import/Export JSON hoặc CSV.
* Bulk enable/disable.
* Bulk publish.
* Filter và search.
* Freeze column.
* Virtualized rendering cho 64 lịch.

### 16.3 Mode 3 — Logic Cards

Hiển thị luồng hoạt động:

```text
Calendar / Exception
          ↓
Effective Time-Value
          ↓
Write Priority
          ↓
Target Objects
          ↓
Actual Result / Override
```

Mỗi card hiển thị:

* Schedule đang áp dụng.
* Giá trị hiệu lực.
* Nguồn giá trị: Weekly, Exception hoặc Default.
* Priority ghi.
* Target.
* Giá trị thực tế của target.
* Trạng thái override.
* Lỗi ghi hoặc communication fault.

---

## 17. Các màn hình bắt buộc

| Màn hình           | Mục đích                       |
| ------------------ | ------------------------------ |
| Schedule List      | Quản lý 64 lịch                |
| Schedule Editor    | Tạo và chỉnh sửa lịch          |
| Weekly Calendar    | Chỉnh lịch trực quan           |
| Exception Manager  | Quản lý ngày lễ và ngoại lệ    |
| Target Mapping     | Chọn point mục tiêu            |
| Simulation Preview | Mô phỏng hoạt động             |
| Publish Review     | Xem diff trước khi publish     |
| Runtime Monitor    | Theo dõi lịch đang chạy        |
| Revision History   | Version và rollback            |
| Audit Log          | Lịch sử người dùng và thao tác |
| Diagnostics        | Lỗi runtime, target và đồng bộ |

---

## 18. Simulation

Người dùng phải mô phỏng được lịch trước khi publish.

Simulation hỗ trợ:

* Khoảng thời gian 7 ngày.
* Khoảng thời gian 30 ngày.
* Chọn ngày cụ thể.
* Hiển thị Weekly và Exception.
* Hiển thị nguồn giá trị.
* Hiển thị giá trị effective.
* Hiển thị target dự kiến nhận lệnh.
* Phát hiện conflict.
* Phát hiện khoảng thời gian không có giá trị.
* Kiểm tra thời điểm chuyển trạng thái.

Kết quả ví dụ:

```text
02/09/2026 00:00
Source: Exception EXC-001
Effective Value: INACTIVE
Target: DDC-01 / BO-1
Priority: 16
```

---

## 19. Phân quyền

| Vai trò                | Quyền                             |
| ---------------------- | --------------------------------- |
| Viewer                 | Xem lịch và runtime               |
| Operator               | Enable/disable lịch được cho phép |
| Engineer               | Tạo, sửa, validate và simulate    |
| Commissioning Engineer | Map target và publish             |
| Administrator          | Toàn quyền, rollback và xóa       |
| Auditor                | Xem revision và audit log         |

Các thao tác publish, rollback, xóa và thay đổi priority phải yêu cầu quyền riêng.

---

## 20. Audit Log

Mỗi thay đổi phải lưu:

* Người thực hiện.
* Thời gian.
* Schedule ID.
* Revision trước và sau.
* Nội dung thay đổi.
* Lý do thay đổi.
* Controller đích.
* Kết quả publish.
* IP hoặc nguồn thao tác.
* Kết quả rollback nếu có.

Audit không được cho phép người dùng thông thường chỉnh sửa hoặc xóa.

---

## 21. Yêu cầu phi chức năng

### Hiệu năng

* Hỗ trợ tối đa 64 Schedule Object.
* Mỗi Schedule Object hỗ trợ tối thiểu 32 target.
* Thời gian đánh giá toàn bộ 64 lịch dưới 100 ms.
* UI mở danh sách 64 lịch dưới 2 giây.
* Publish một lịch và nhận ACK dưới 5 giây trong điều kiện mạng bình thường.

### Độ tin cậy

* Lịch đang chạy không bị mất khi Backend offline.
* Controller tiếp tục thực hiện lịch đã publish.
* Khôi phục đúng revision sau reboot.
* Không áp dụng cấu hình chưa nhận đủ hoặc chưa validate.
* Publish phải atomic.

### Bảo mật

* HTTPS cho REST API.
* TLS cho MQTT.
* Role-based access control.
* Audit toàn bộ thao tác quan trọng.
* Kiểm tra payload schema.
* Chống replay message.
* Không cho phép sửa lịch nếu không đủ quyền.

---

## 22. Acceptance Criteria

Scheduler Engine được coi là hoàn thành khi đáp ứng đầy đủ:

1. Tạo, sửa và xóa được tối đa 64 lịch.
2. Có đủ lịch tuần và exception trong cùng Schedule Object.
3. Weekly Schedule hỗ trợ nhiều Time-Value trong một ngày.
4. Một lịch chỉ sử dụng một `value_type`.
5. Map được nhiều target cùng kiểu dữ liệu.
6. Có Schedule Default.
7. Có Effective Period.
8. Có Priority for Writing.
9. Có Event Priority cho exception.
10. Có timezone và đồng bộ thời gian.
11. Disable lịch thực hiện relinquish đúng.
12. Controller vẫn chạy lịch khi Backend mất kết nối.
13. Có validate trước publish.
14. Có ACK/NACK và revision control.
15. Có preview và simulation.
16. Có conflict detection.
17. Có revision history và rollback.
18. Có audit log.
19. Có Weekly Calendar, Grid và Logic View.
20. Không còn bất kỳ phụ thuộc runtime nào vào thanh ghi `TSx`.

---

## 23. Quyết định sản phẩm

KinexusBMS Scheduler Engine v3.1 sử dụng mô hình:

> **BACnet Schedule Object–Aligned, Kinexus JSON Contract over MQTT/REST, hỗ trợ Weekly Schedule, Exception Schedule, Schedule Default, Target Mapping, Priority Writing, Versioning và Hybrid UI.**

Cơ chế thanh ghi lịch `TSx 3..11` cũ bị loại bỏ hoàn toàn và không được duy trì trong Backend, Frontend hoặc Controller Runtime mới.
