# Use case Web — Lịch vận hành (`/eng/scheduler/*`)

> **Document ID:** KX-DDC24-UC-WEB-SCHEDULER-001-VI
> **Trạng thái:** Active | **Phiên bản:** 1.0 | **Ngày lập:** 2026-08-07
> **Owner:** Product Owner + SW Lead
> **Phạm vi:** Họ trang Web `/eng/scheduler`, `/eng/scheduler/:id` (6 tab), `/eng/scheduler/runtime`,
> `/eng/scheduler/exceptions`.
> **Không bao gồm:** panel lịch trên HMI cục bộ 320×240; cấu hình BACnet Schedule Object (P4).
> **Contract nền:** [ADR-023](../adr/ADR-023-scheduler-v3-1-priority-transport-va-pham-vi.md) ·
> [`contracts/config/schedule_v3_1.schema.json`](../../contracts/config/schedule_v3_1.schema.json) (FROZEN 2026-08-07) ·
> [`contracts/openapi/openapi.yaml`](../../contracts/openapi/openapi.yaml) §`/schedules`
> **Đặc tả trình bày:** [KX-DDC24-UX-WEB-SCHEDULER-001](KX-DDC24-UX-WEB-SCHEDULER-001_VI.md)
> **Kế hoạch thực thi:** [Plan 50](../03_implementation/50_SCHEDULER_V3_1_IMPLEMENTATION_PLAN.md)

---

## 1. Vì sao tài liệu này tồn tại

Đặc tả v3.1 loại bỏ hoàn toàn mô hình thanh ghi `TSx`. Trang lịch cũ không chỉ *dùng* mô hình đó
mà **phơi nó ra thẳng màn hình khách hàng** — chế độ `Parameters` hiển thị đúng 12 dòng nhãn
`TSx 0`…`TSx 11`. Thay mô hình miền mà không có tiêu chí nghiệm thu hành vi thì QA và auditor
không có gì để kiểm.

Ba nguy cơ vận hành của trang cũ mà tập use case này phải đóng:

| # | Nguy cơ cũ | Use case đóng |
|---|---|---|
| 1 | Không có cách nào biết **vì sao lịch bật mà thiết bị không chạy** | UC-WEB-SCH-004, 038 |
| 2 | Một lịch ngày lễ nhầm **tắt toàn bộ hệ thống lịch** | UC-WEB-SCH-016, 017 |
| 3 | Không có bước kiểm tra trước khi áp dụng — sai là ra lệnh thẳng xuống quạt, van, bơm | UC-WEB-SCH-020, 021, 030 |

## 2. Vai trò

Theo [ADR-023 §Quyết định 5](../adr/ADR-023-scheduler-v3-1-priority-transport-va-pham-vi.md):
giữ 3 vai trò thật, bổ sung 4 quyền thao tác.

| Vai trò đặc tả | Vai trò thật | Quyền thêm | Làm được gì |
|---|---|---|---|
| Viewer | `viewer` | — | Xem lịch, runtime, revision, audit |
| Operator | `operator` | — | + bật/tắt lịch đã publish |
| Engineer | `admin` | — | + tạo/sửa/xoá nháp, validate, simulate |
| Commissioning Engineer | `admin` | `schedule.publish`, `schedule.priority` | + gán target, publish, đổi priority |
| Administrator | `admin` | `schedule.rollback`, `schedule.delete` | toàn quyền |
| Auditor | `viewer` | — | đọc revision + audit, không sửa |

> **Nguyên tắc phân quyền:** backend chặn bằng 403; giao diện **làm mờ nút kèm tooltip nêu quyền
> còn thiếu**, không giấu nút. Nút biến mất khiến người dùng kết luận chức năng không tồn tại.

---

## 3. Nhóm Vận hành — nhìn và bật/tắt

### UC-WEB-SCH-001 — Xem lịch tuần dạng trực quan

| Field | Nội dung |
|---|---|
| Actor | viewer / operator / admin |
| Tiền điều kiện | Session hợp lệ; lịch tồn tại |
| Main flow | Mở tab **Tuần** → lưới 7 ngày × 24 giờ, khối thời gian đúng tỉ lệ, đường "bây giờ" chạy theo giờ thật của timezone thuộc lịch |
| Alternate | Lịch chưa có event nào ⇒ lưới trống kèm lời mời tạo khoảng đầu tiên, **không** hiện khối giả |
| Acceptance | Ngày có exception được đánh dấu bằng ký hiệu riêng, không chỉ bằng màu; đường "bây giờ" đúng theo `timezone` của lịch chứ không theo TZ trình duyệt |

### UC-WEB-SCH-002 — Xem giá trị đang hiệu lực và nguồn của nó

| Field | Nội dung |
|---|---|
| Actor | viewer+ |
| Main flow | Dải runtime dưới cùng Editor hiện `giá trị hiệu lực` + `nguồn ∈ {Tuần, Ngoại lệ, Mặc định}` + `lần chuyển kế tiếp` |
| Alternate | Controller chưa báo ⇒ mọi ô hiện `—` |
| Acceptance | **Không ô nào hiện `0` hay `OK` khi `runtime` rỗng.** Giá trị lấy từ khối `runtime` của controller, **không** tính lại ở trình duyệt |

### UC-WEB-SCH-003 — Bật/tắt một lịch

| Field | Nội dung |
|---|---|
| Actor | operator+ |
| Main flow | Bấm công tắc → hộp thoại nêu **đích danh**: relinquish tại priority nào, target nào, giá trị sau khi nhả → xác nhận → trạng thái `DISABLED` |
| Alternate | Controller không phản hồi ⇒ giữ nguyên trạng thái cũ và báo `SCH-RUNTIME-001`; **không** hiện `DISABLED` khi chưa chắc |
| Acceptance | Tắt lịch thực hiện relinquish thật (đặc tả §9.2), **không giữ giá trị điều khiển cuối cùng**; có dòng audit |

### UC-WEB-SCH-004 — Thấy lịch đang bị ghi đè

| Field | Nội dung |
|---|---|
| Actor | viewer+ |
| Main flow | Khi `runtime.targets[].overridden_by` khác null, thẻ hiện huy hiệu `BỊ GHI ĐÈ` kèm **tên nguồn thắng** (Fire/Safety, Lệnh tay, BACnet, Logic) |
| Acceptance | Đây là use case trả lời câu "lịch bật rồi mà sao quạt không chạy". Thiếu nó thì trang không đạt nghiệm thu |

### UC-WEB-SCH-005 — Thấy controller lệch revision

| Field | Nội dung |
|---|---|
| Actor | viewer+ |
| Main flow | `revision` ≠ `runtime.applied_revision` ⇒ trạng thái `OUT_OF_SYNC`, hiện **cả hai số** và nút "publish lại" |
| Acceptance | `OUT_OF_SYNC` chiếm hai dòng trong Grid — nén bằng kích cỡ với trạng thái khác là giấu nó đi |

---

## 4. Nhóm Kỹ sư — dựng lịch

### UC-WEB-SCH-010 — Tạo Schedule Object mới

| Field | Nội dung |
|---|---|
| Actor | admin |
| Main flow | Chọn `value_type` **trước tiên** → đặt tên → tạo ở trạng thái `DRAFT`, `revision = 1` |
| Acceptance | `value_type` **khoá lại sau khi gán target đầu tiên** (đặc tả §2.1). Bấm vào ổ khoá giải thích lý do và cách đổi (gỡ hết target) |

### UC-WEB-SCH-011 — Vẽ lịch tuần bằng kéo thả

| Field | Nội dung |
|---|---|
| Actor | admin |
| Main flow | Kéo trên lưới tạo khối; kéo thân đổi giờ; kéo cạnh đổi thời lượng; bước nhảy 5 phút |
| Acceptance | Bảng cặp Time-Value bên cạnh **cập nhật theo thời gian thực**; mọi thao tác có đường bàn phím tương đương (UC-012) |

### UC-WEB-SCH-012 — Nhập lịch tuần dạng bảng Time-Value

| Field | Nội dung |
|---|---|
| Actor | admin |
| Main flow | Nhập trực tiếp `HH:mm:ss` + giá trị; tự sắp xếp tăng dần |
| Alternate | Hai event cùng thời điểm trong một ngày ⇒ `SCH-CONFIG-002` tại chỗ, chặn trước khi gửi |
| Acceptance | Làm được **hoàn toàn bằng bàn phím**, không cần chuột |

### UC-WEB-SCH-013 — Sao chép một ngày sang nhiều ngày

| Field | Nội dung | |
|---|---|---|
| Actor | admin | |
| Main flow | Chọn ngày nguồn → tick ngày đích → áp dụng | |
| Acceptance | Hoàn tác được; ngày đích có sẵn event thì hỏi ghi đè hay gộp | |

### UC-WEB-SCH-014 — Đặt `schedule_default`

| Field | Nội dung |
|---|---|
| Actor | admin |
| Acceptance | Bắt buộc. Thiếu ⇒ chặn publish với `SCH-CONFIG-001`. Giao diện giải thích default là giá trị khi **không event nào hiệu lực**, không phải "giá trị ban đầu" |

### UC-WEB-SCH-015 — Đặt `effective_period`

| Field | Nội dung |
|---|---|
| Actor | admin |
| Acceptance | `end_date` rỗng phải hiển thị bằng chữ **"không có ngày kết thúc"**, không để ô trống mập mờ |

### UC-WEB-SCH-016 — Thêm ngoại lệ (5 kiểu `date_rule`)

| Field | Nội dung |
|---|---|
| Actor | admin |
| Main flow | Chọn kiểu `DATE` / `DATE_RANGE` / `WEEK_N_DAY` / `CALENDAR_REFERENCE` / `HOLIDAY_GROUP` → nhập tham số → đặt `event_priority` |
| Acceptance | **Mỗi kiểu có preview "12 tháng tới rơi vào những ngày nào"** — `WEEK_N_DAY` và `HOLIDAY_GROUP` con người không tính nhẩm được; không có preview thì người dùng publish một quy tắc mà không biết nó nổ vào ngày nào |

### UC-WEB-SCH-017 — Xử lý xung đột hai ngoại lệ cùng priority

| Field | Nội dung |
|---|---|
| Actor | admin |
| Main flow | Hai exception cùng rơi vào một ngày và cùng `event_priority` ⇒ hiện `SCH-CONFIG-003` |
| Acceptance | Cảnh báo nêu **đúng cặp xung đột** và ngày đụng độ, có nút nhảy tới từng cái. **Hệ thống không tự chọn theo thời gian tạo** (đặc tả §7.3) |

### UC-WEB-SCH-018 — Gán nhiều target

| Field | Nội dung |
|---|---|
| Actor | admin + `schedule.publish` |
| Main flow | Danh sách chọn **lọc sẵn** theo `value_type` và cờ ghi được |
| Alternate | Target không tồn tại ⇒ `SCH-TARGET-001`; không ghi được ⇒ `SCH-TARGET-002`; sai kiểu ⇒ `SCH-TARGET-003`; trùng trong cùng lịch ⇒ chặn |
| Acceptance | **Chặn sớm tại chỗ nhập** — không cho chọn tự do rồi báo lỗi sau |

### UC-WEB-SCH-019 — Đặt `priority_for_writing`

| Field | Nội dung |
|---|---|
| Actor | admin + `schedule.priority` |
| Main flow | Chọn 1..16, mặc định 16 |
| Acceptance | Hiển thị kèm `core_priority_level` và câu giải thích: priority này phân xử **giữa các lịch**, mọi lịch vẫn ở mức 4 so với lệnh tay và BACnet (ADR-023 QĐ-1). Cảnh báo khi đặt ≤ 2 |

### UC-WEB-SCH-020 — Validate

| Field | Nội dung |
|---|---|
| Actor | admin |
| Main flow | Bấm Kiểm tra → danh sách finding có `code` + `path` + `message` |
| Acceptance | Bấm vào finding **nhảy tới đúng ô sai**; hợp lệ ⇒ `DRAFT` → `VALIDATED` |

### UC-WEB-SCH-021 — Mô phỏng 7/30 ngày

| Field | Nội dung |
|---|---|
| Actor | admin |
| Main flow | Chọn phạm vi → dòng thời gian có nguồn từng đoạn + bảng thời điểm chuyển trạng thái |
| Acceptance | **Chạy bằng đúng mã đánh giá của controller**, không phải bản cài lại ở backend hay frontend. Tô đỏ khoảng không có giá trị; đếm xung đột |

### UC-WEB-SCH-022 — Nhân bản lịch

| Field | Nội dung |
|---|---|
| Actor | admin |
| Acceptance | ID mới tự cấp, trạng thái `DRAFT`, **target không sao chép** — tránh hai lịch cùng ghi một điểm mà không ai để ý |

---

## 5. Nhóm Bàn giao và Kiểm toán

### UC-WEB-SCH-030 — Xem diff trước khi publish

| Field | Nội dung |
|---|---|
| Actor | admin + `schedule.publish` |
| Main flow | Modal so sánh cạnh nhau bản đang chạy ↔ bản nháp; bắt buộc nhập lý do |
| Acceptance | **Đổi target và đổi priority luôn được làm nổi bật** — đây là hai thay đổi gây hậu quả vật lý lớn nhất |

### UC-WEB-SCH-031 — Publish và chờ ACK

| Field | Nội dung |
|---|---|
| Actor | admin + `schedule.publish` |
| Main flow | Gửi → chờ ACK có đếm ngược 5 s → `ACCEPTED` kèm revision mới |
| Alternate | `REJECTED` ⇒ hiện mã lỗi; `TIMEOUT` ⇒ báo rõ **revision cũ vẫn đang chạy, không có gì thay đổi** |
| Acceptance | Publish hỏng **không đổi revision đang chạy** (đặc tả §13.2); gửi lại cùng `correlation_id` không áp dụng hai lần |

### UC-WEB-SCH-032 — Publish hàng loạt

| Field | Nội dung |
|---|---|
| Actor | admin + `schedule.publish` |
| Acceptance | Kết quả hiện **từng lịch một**, không gộp thành một dòng "thành công" |

### UC-WEB-SCH-033 — Xem lịch sử revision

| Field | Nội dung |
|---|---|
| Actor | viewer+ |
| Acceptance | ≥10 bản; mỗi bản có ai, lúc nào, lý do, đã publish chưa |

### UC-WEB-SCH-034 — Rollback

| Field | Nội dung |
|---|---|
| Actor | admin + `schedule.rollback` |
| Acceptance | Bắt buộc nhập lý do; rollback tạo revision **mới**, **không xoá lịch sử**; hỏng ⇒ `SCH-ROLLBACK-001` |

### UC-WEB-SCH-035 — Xoá lịch

| Field | Nội dung |
|---|---|
| Actor | admin + `schedule.delete` |
| Main flow | Hộp thoại nêu đúng trình tự đặc tả §9.3: nhả toàn bộ target → xác nhận không còn lệnh giữ tại priority của lịch → lưu bản cuối vào audit → mới xoá |
| Acceptance | Không bước nào bị bỏ; bước nào hỏng thì dừng và giữ nguyên lịch |

### UC-WEB-SCH-036 — Xem audit

| Field | Nội dung |
|---|---|
| Actor | viewer+ |
| Acceptance | Lọc theo người / thời gian; **chỉ đọc, không vai trò nào sửa hay xoá được** (đặc tả §20) |

### UC-WEB-SCH-037 — Xuất/nhập JSON

| Field | Nội dung |
|---|---|
| Actor | admin |
| Acceptance | Nhập phải qua validate trước khi lưu; xung đột ID hỏi ghi đè hay cấp ID mới |

### UC-WEB-SCH-038 — Chẩn đoán lỗi runtime

| Field | Nội dung |
|---|---|
| Actor | operator+ |
| Acceptance | Nhóm theo 14 mã lỗi đặc tả §11; nêu **target nào hỏng** và nói rõ **các target khác vẫn chạy** |

---

## 6. Ma trận truy vết

| Acceptance đặc tả §22 | Use case | Kiểm chứng |
|---|---|---|
| 1. Tạo/sửa/xoá tối đa 64 lịch | 010, 022, 035 | e2e + BE test |
| 2. Weekly + exception trong cùng Schedule Object | 011, 016 | schema + core test |
| 3. Nhiều Time-Value trong một ngày | 012 | core test |
| 4. Một lịch một `value_type` | 010, 018 | schema + FE test |
| 5. Nhiều target cùng kiểu | 018 | BE test |
| 6. Có Schedule Default | 014 | schema bắt buộc |
| 7. Có Effective Period | 015 | schema bắt buộc |
| 8. Có Priority for Writing | 019 | core test |
| 9. Có Event Priority cho exception | 016, 017 | core test |
| 10. Timezone và đồng bộ thời gian | 001 | P3, test trên bo |
| 11. Disable relinquish đúng | 003 | core test |
| 12. Controller chạy khi Backend mất kết nối | — | P3, test trên bo |
| 13. Validate trước publish | 020, 030 | BE test |
| 14. ACK/NACK và revision control | 031 | BE test |
| 15. Preview và simulation | 021 | BE + core test |
| 16. Conflict detection | 017 | core test |
| 17. Revision history và rollback | 033, 034 | BE test |
| 18. Audit log | 036 | BE test |
| 19. Weekly Calendar, Grid và Logic View | 001, 002, 004 | e2e |
| 20. **Không còn phụ thuộc `TSx`** | tất cả | `grep -ri "TSx" apps/ contracts/` = 0 |

---

## Revision History

| Phiên bản | Ngày | Người | Nội dung |
|---|---|---|---|
| 1.0 | 2026-08-07 | SW Lead | Bản đầu, tách từ proposal sau khi PM/CTO duyệt ADR-023. 26 use case + ma trận truy vết 20 acceptance |
