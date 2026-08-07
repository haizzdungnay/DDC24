# Review P1 — Scheduler Engine v3.1 (core + backend)

> **Document ID:** DDC24-SCHD-REVIEW-P1-2026-08-07
> **Ngày:** 2026-08-07 | **Người review:** Nhóm Phần mềm (tự review trước khi trình)
> **Phạm vi:** Toàn bộ mã P1 trên nhánh `feat/scheduler-v3.1`, commit `858d309`
> **Kính gửi:** PM · CTO — §5 có **3 quyết định cần duyệt**
> **Kết luận:** P1 **chưa nên merge**. 3 finding mức Cao phải đóng trước; 2 trong 3 cần quyết định.

---

## 1. Đã làm được gì

| Hạng mục | Trạng thái | Số đo thật (chạy 2026-08-07) |
|---|---|---|
| Hợp đồng dữ liệu v3.1 đóng băng | ✅ | `ajv`: mẫu hợp lệ pass, **10/10 ca sai bị chặn** |
| OpenAPI 14 endpoint | ✅ | 0 ref treo, `ScheduleRow` cũ đã gỡ |
| `ScheduleRuntime` C++ viết lại | ✅ | `ctest` **822/822**, 0 fail (13,61 s) |
| Hiệu năng đánh giá | ✅ | **0,120 ms/vòng** cho 64 lịch × 16 target (ngưỡng §21: 100 ms) |
| Backend Go 14 endpoint | ✅ | `go vet` + `go test ./... -count=1` → **11/11 gói PASS** |
| Di trú v1 → v3.1 | 🟡 | Chạy đúng trên tệp dựng trong test; **chưa chạy trên bo thật** |
| Mô phỏng dùng chung engine | 🟡 | Binary chạy đúng trên host; **chưa đóng gói lên bo** |

**41/96 task.** Ba tiêu chí nghiệm thu đặc tả §22 đã đóng bằng test: #2 (weekly + exception cùng
Schedule Object), #3 (nhiều Time-Value một ngày), #11 (disable relinquish đúng).

---

## 2. Finding mức **Cao** — chặn merge

### P1-01 · Xoá lịch xoá luôn nhật ký audit của lịch đó

**Vi phạm đặc tả §20** ("Audit không được cho phép người dùng thông thường chỉnh sửa hoặc xóa")
và **§9.3** ("Lưu phiên bản cuối trong audit" *trước khi* xoá).

Mã hiện tại ghi dòng audit cuối cùng, rồi `removeScheduleState(id)` xoá cả thư mục
`schedule.d/<ID>/` — gồm chính `audit.jsonl` vừa ghi:

```go
a.recordScheduleChange(r, victim, "DELETE", ...)   // ghi audit
...
_ = a.removeScheduleState(id)                      // rồi xoá luôn cả thư mục
```

Hệ quả: xoá một lịch là **xoá sạch dấu vết** ai từng cấu hình nó, đổi gì, publish khi nào. Đúng
thứ auditor cần thì lại là thứ biến mất. Với một auditor, hành vi này khó phân biệt với cố ý.

**Cách sửa đề xuất (0,25 ngày, không cần quyết định):** giữ `audit.jsonl` và `revisions.json`,
chỉ xoá các ảnh chụp revision; hoặc chuyển thư mục sang `schedule.d/_deleted/<ID>-<timestamp>/`.
Kèm §5 QĐ-9 về chính sách lưu trữ.

### P1-02 · Target `EXT` (điểm Modbus) được chấp nhận nhưng lệnh **không tới thiết bị**

Hợp đồng cho `point_kind: "EXT"`, validate cho qua, core ghi vào `PointTable`. Nhưng để một điểm
EXT thật sự ra thiết bị Modbus, phải đặt `shm->ext[idx].setpoint` **và** `dirty = 1` — đúng như
đường lệnh tay đang làm ([`scan_loop.cpp:137-144`](../../apps/core/application/runtime/scan_loop.cpp#L137-L144)):

```cpp
if (cmd.point.kind == PointKind::EXT && cmd.is_write && ok && d_.bacnet && d_.bacnet->shm()) {
    shm->ext[cmd.point.idx].setpoint = cmd.value;
    shm->ext[cmd.point.idx].dirty = 1;
}
```

`ScheduleRuntime` chỉ gọi `table.set_virtual()`, **không có bước này**. Kết quả: người dùng gán
một lịch cho điểm Modbus, giao diện báo `write_result = OK`, controller báo `written = true`, và
thiết bị **không nhận được gì**.

Đây đúng lớp lỗi mà tài liệu của chính dự án cảnh báo: *"một lệnh mất mà BE tưởng thành công"*.
Nguy hiểm hơn cả một lỗi ồn ào, vì không ai đi tìm.

**Cần quyết định — §5 QĐ-7.**

### P1-03 · `mkddc-schedule-sim` không được cài lên bo

`tools/deploy/deploy_board.sh` liệt kê `SBIN_BINS=(mkddc-core mkddc-iobus mkddc-netcfg mkddc-hmi
mkddc-st-compile mkddc-st-validate)` — **không có** `mkddc-schedule-sim`.

Hệ quả trên bo: `POST /simulate` trả **503 vĩnh viễn**. Backend từ chối tự tính thay (đúng thiết
kế), nên tính năng mô phỏng — tiêu chí nghiệm thu #15 — **không dùng được ngoài môi trường dev**.

**Cách sửa (0,25 ngày, không cần quyết định):** thêm binary vào `SBIN_BINS`, phần `install`, và
danh sách kiểm chứng sau deploy.

---

## 3. Finding mức **Trung bình**

### P1-04 · `next_transition` sai khi lần chuyển kế tiếp nằm ở một ngày ngoại lệ tương lai

Vòng tính chỉ tra `weekly[day]` cho các ngày phía trước; ngoại lệ chỉ được xét cho **hôm nay**.

Kiểm chứng (lịch tuần rỗng, ngoại lệ 10/08 06:00 và 11/08 09:00, đứng ở 10/08 07:00):

```
next_transition_week_second = -1
ĐÚNG phải là 118800  (Thứ Ba 09:00)
```

Giao diện sẽ hiện `—` cho "lần chuyển kế tiếp" trong khi thực tế có. Không sai lệnh điều khiển,
nhưng đúng thứ mà cả bộ UX spec đang cố loại bỏ: màn hình im lặng khi hệ thống đang có việc.

**Cách sửa:** trong vòng `ahead > 0`, chọn ngoại lệ khớp ngày đó trước khi rơi về `weekly`.
Ước lượng 0,5 ngày kèm test.

### P1-05 · `POST`/`PUT` trả `null` cho ngày rỗng, `GET` trả `[]`

`normalizeSchedules([]ScheduleObject{incoming})` chuẩn hoá trên một **bản sao**. Sửa phần tử của
slice có dội về (dùng chung mảng nền), nhưng **gán slice header mới thì mất**:

```
POST  point_id="DO-01"  TUE=[] (nil=true)      ← response
GET   point_id="DO-01"  TUE=[] (nil=false)     ← đọc lại
```

Frontend nhận hai hình dạng khác nhau từ create và read. **Cách sửa:** `normalizeSchedules` nhận
`*ScheduleObject`, hoặc gọi trên `list[idx]` sau khi ghép vào danh sách. 0,25 ngày.

### P1-06 · `GET /api/v1/schedules` (quyền `viewer`) có thể **ghi tệp**

Di trú được kích hoạt bên trong hàm nạp, mà hàm nạp được gọi từ mọi endpoint kể cả `GET`. Một
`viewer` — vai trò chỉ-đọc — có thể làm backend ghi `schedule.conf`, tạo `.v1.bak` và đổi trạng
thái mọi lịch về `DRAFT`. Ngoài ra `GET` **không giữ `scheduleMutex`**, nên hai `GET` đồng thời
trên tệp định dạng cũ cùng chạy di trú.

Ghi tệp là atomic nên không hỏng dữ liệu, và nội dung hai lần di trú giống nhau, nên hậu quả
thực tế thấp. Nhưng "GET có tác dụng phụ" là bất ngờ với người đọc mã, và mở đường cho lỗi khó
tìm về sau. **Cách sửa:** tách di trú thành bước khởi động rõ ràng, hoặc giữ khoá và giới hạn
cho `admin`. 0,5 ngày.

### P1-07 · `publish` ngủ tới ~3,3 s **khi đang giữ khoá toàn cục**

Vòng retry gọi `time.Sleep(schedulePublishTimeout / 3)` bên trong `scheduleMutex`. Trong lúc đó
**mọi endpoint lịch khác đứng chờ**, kể cả `GET` chỉ đọc. Publish hàng loạt 10 lịch trong điều
kiện controller không phản hồi sẽ khoá trang lịch hơn 30 giây.

**Cách sửa:** nhả khoá trước khi ngủ, hoặc chuyển retry ra ngoài vùng khoá. 0,5 ngày.

### P1-08 · `appliedCorrelations` không bao giờ được dọn

Map chống-áp-dụng-lặp lớn dần theo mỗi lần publish có `correlation_id` và **không có cơ chế xoá**.
Tiến trình chạy nhiều tháng trên bo sẽ tích luỹ. **Cách sửa:** gắn TTL hoặc trần số phần tử.
0,25 ngày.

---

## 4. Finding mức **Thấp**

| # | Nội dung | Sửa |
|---|---|---|
| P1-09 | Header `X-Schedule-Migration` chứa tiếng Việt (phi-ASCII); trình duyệt giải mã latin-1 thành ký tự lỗi. Nên đưa thông báo vào **thân** response. | 0,25 ngày |
| P1-10 | Phát hiện xung đột ngoại lệ `WEEK_N_DAY` liệt kê ngày dựa trên `time.Now()`, nên kết quả `validate` có thể **đổi theo thời điểm chạy**. Nên nhận mốc thời gian làm tham số để validate tất định. | 0,25 ngày |

**Tổng công sửa 10 finding: ~3 người-ngày**, chưa gồm phần phụ thuộc quyết định ở §5.

---

## 5. Ba quyết định cần PM/CTO duyệt

### QĐ-7 · Target `EXT` (điểm Modbus) — nối đường ghi hay gỡ khỏi hợp đồng?

Liên quan finding **P1-02**. Hợp đồng đã **đóng băng** ngày 2026-08-07, nên cả hai phương án đều
cần một bản bổ sung ADR-023.

| | **PA-1** — Nối đường ghi EXT | **PA-2 (ĐỀ XUẤT)** — Gỡ EXT khỏi hợp đồng ở Rev A |
|---|---|---|
| Việc phải làm | Đưa con trỏ SHM vào `ScheduleRuntime`, hoặc gom đường ghi virtual point vào một chỗ dùng chung với `scan_loop` | Bỏ `EXT` khỏi schema + validate; lịch chỉ ghi AO/DO/AV/BV/MSV |
| Chi phí | **1 người-ngày** | **0,25 người-ngày** |
| Kiểm chứng được đến đâu | Chỉ tới SHM. **Không kiểm được đầu-cuối** vì plan 49 còn treo `G-C` (slave RS-485 thật) và `G-D` (điều khiển hướng truyền) — đều chờ phần cứng | Không có gì để kiểm sai |
| Rủi ro | Giao một tính năng **không ai xác nhận được là chạy** trên thiết bị thật | Người dùng không lập lịch được cho thiết bị Modbus ở Rev A |
| Đường lùi | Khó: đã hứa thì khó rút | Dễ: mở lại khi plan 49 đóng gate phần cứng |

> **Đề xuất PA-2.** Lý do: lập lịch cho một điểm Modbus mà **không thể kiểm chứng đầu-cuối** là
> hứa với khách hàng một thứ chính chúng ta chưa đo được. Gỡ ra bây giờ tốn 0,25 ngày; để lại rồi
> phát hiện ngoài hiện trường tốn nhiều hơn thế rất nhiều. Mở lại ngay khi plan 49 đóng `G-C`/`G-D`.

### QĐ-8 · Kiểm chứng di trú trên `schedule.conf` **thật** của bo lab (rủi ro R-01)

Di trú mới chạy trên tệp dựng trong test. R-01 — *mất cấu hình đang vận hành khi nâng cấp* — là
rủi ro **cao nhất** của cả Plan 50, và nó chưa được đóng.

Cần PM chốt hai việc:

1. **Cửa sổ truy cập bo lab** để chạy thử di trú (chỉ đọc + chạy trên bản sao, không đụng bo đang chạy).
2. **Ai thực hiện** — nhóm phần mềm tự làm, hay cần người trực bo đi kèm.

> **Đề xuất:** lấy bản sao `schedule.conf` từ bo về môi trường dev, chạy di trú, đối chiếu từng
> lịch bằng mắt. Không cần đụng bo đang vận hành, nên rủi ro gần bằng không. Ước lượng 0,5 ngày
> sau khi có tệp.

### QĐ-9 · Chính sách lưu nhật ký audit của lịch **đã bị xoá**

Liên quan finding **P1-01**. Đặc tả §20 cấm xoá audit, nhưng không nói giữ bao lâu và giữ ở đâu
sau khi Schedule Object biến mất.

| | **PA-1 (ĐỀ XUẤT)** — Giữ vĩnh viễn, chuyển sang `schedule.d/_deleted/` | **PA-2** — Giữ N tháng rồi dọn |
|---|---|---|
| Tuân thủ §20 | Đầy đủ | Cần chốt N và ghi vào đặc tả |
| Dung lượng | Rất nhỏ (JSONL vài KB mỗi lịch) | Nhỏ hơn |
| Việc phải làm | 0,25 ngày | 0,5 ngày + một quyết định nữa về N |

> **Đề xuất PA-1.** Nhật ký audit của lịch đã xoá đúng là thứ auditor cần nhất; dung lượng không
> phải vấn đề trên một bo có ổ lưu historian.

---

## 6. Khuyến nghị

**Không merge P1 ở trạng thái hiện tại.** Trình tự đề nghị:

1. PM/CTO duyệt **QĐ-7, QĐ-8, QĐ-9** (§5).
2. Nhóm phần mềm đóng 3 finding mức Cao (~0,5 ngày + phần theo QĐ-7) và 5 finding mức Trung bình
   (~2 ngày).
3. Chạy lại cổng ra P1 kèm số đo mới, cộng kiểm chứng di trú theo QĐ-8.
4. Merge, rồi mới khởi động P2 (Frontend, 36 task).

**Ghi chú về tiến độ.** 10 finding này không làm đổi ước lượng 64 người-ngày của Plan 50 — chúng
nằm trong phần công việc "làm cho đúng" vốn đã tính vào P1. Nhưng chúng **đẩy lùi thời điểm khởi
động P2 khoảng 3 ngày làm việc**, và mốc W3 "đóng băng hợp đồng → FE vào việc" trong bảng burn-up
cần lùi tương ứng nếu QĐ-7 chọn PA-1.

---

## 7. Điều tự nhận

Ba finding mức Cao đều là lỗi trong phần tôi vừa giao, không phải nợ kỹ thuật thừa kế:

- **P1-01** và **P1-03** là thiếu sót thẳng thắn: viết audit rồi xoá nó, và thêm một binary mới
  mà quên đường cài đặt.
- **P1-02** đáng nói hơn: tôi đưa `EXT` vào hợp đồng **trước khi** kiểm xem core có đường ghi
  thật cho nó không. Đó chính là thứ mà mọi tài liệu trong đợt này lặp đi lặp lại — không được
  hứa một khả năng mà tầng dưới chưa có — và tôi vẫn mắc.

Bộ test 822 C++ và 11 gói Go không bắt được cả ba, vì cả ba nằm ở **ranh giới giữa các tầng**:
giữa API và hệ thống tệp, giữa core và SHM, giữa build và deploy. Cần bổ sung test bắc qua ranh
giới đó chứ không chỉ tăng số ca test trong từng tầng.

---

## Revision History

| Phiên bản | Ngày | Người | Nội dung |
|---|---|---|---|
| 1.0 | 2026-08-07 | Nhóm Phần mềm | Review P1 tại `858d309`: 10 finding (3 Cao · 5 Trung bình · 2 Thấp), 3 quyết định trình PM/CTO |
