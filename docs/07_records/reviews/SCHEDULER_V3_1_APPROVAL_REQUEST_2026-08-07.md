# Tờ trình phê duyệt — Scheduler Engine v3.1: 6 quyết định kiến trúc và kế hoạch triển khai

**Mã tài liệu:** DDC24-SCHD-REQ-APPROVE-2026-08-07
**Ngày lập:** 2026-08-07
**Người trình:** Nhóm Phần mềm MK-DDC-24
**Kính gửi:** Ban Quản lý Dự án (PM) · Giám đốc Công nghệ (CTO)
**Đồng kính gửi:** Kiến trúc sư Trưởng · Trưởng nhóm Kiểm thử (QA Lead)
**Phạm vi:** Module Scheduler trên MK-DDC-24 — cả ba tầng Frontend, Backend và Controller Runtime
**Baseline mã nguồn đối chiếu:** commit `5fef0b9`, nhánh `main`

---

> [!NOTE]
> ## ✅ ĐÃ PHÊ DUYỆT — 2026-08-07
>
> PM và CTO **chấp thuận toàn bộ 6 quyết định theo phương án PA-1** và cho phép triển khai
> Plan 50. Quyết định đã ghi thành [ADR-023](../../adr/ADR-023-scheduler-v3-1-priority-transport-va-pham-vi.md)
> và [Decision Log](../../00_governance/DECISIONS.md).
>
> | Quyết định | Kết quả |
> |---|---|
> | QĐ-1 Priority 1..16 | **DUYỆT PA-1** — phân xử nội bộ trong scheduler, không đổi đường Fire/Safety |
> | QĐ-2 MQTT | **DUYỆT PA-1** — ngoài phạm vi Rev A; ngữ nghĩa revision/correlation/ACK-NACK/timeout/retry/chống-lặp là **bắt buộc** |
> | QĐ-3 Trần target | **DUYỆT PA-1** — giữ 32/lịch; UI **bắt buộc** hiện dung lượng thật và cảnh báo khi gần/vượt |
> | QĐ-4 BACnet Schedule | **DUYỆT PA-1** — làm ở P4, không chặn P1–P3 |
> | QĐ-5 Vai trò | **DUYỆT PA-1** — 3 vai trò + 4 quyền `schedule.publish/rollback/delete/priority` |
> | QĐ-6 Di trú | **DUYỆT PA-1** — tự động, giữ `.bak`, **không xoá bản cũ**, bắt buộc người dùng review trước khi activate |
>
> **C-1:** Có định hướng gateway/multi-controller nhưng **không thuộc Scheduler Rev A**; MQTT giữ trong roadmap Rev B.
> **C-2:** **Không dùng mốc BTL để chặn P1–P3.** P4 phải chuẩn bị đúng model Schedule/Calendar và PICS; có deadline cụ thể thì PM/CTO điều chỉnh thứ tự P4 riêng.
>
> **Kế hoạch:** chấp thuận baseline 5 pha / 78 task / 64 người-ngày.
>
> **Ba nguyên tắc bắt buộc giữ đúng khi thực thi:** đóng băng data contract trước khi code P1 ·
> simulation dùng **chung** evaluation engine với controller · **không tuyên bố production-ready
> khi chưa có kiểm chứng I/O vật lý**.

---

> [!IMPORTANT]
> **Tờ trình này tự chứa.** Người duyệt **không cần mở tài liệu nào khác** để ra quyết định.
> Mỗi quyết định dưới đây trình bày đủ: hiện trạng mã nguồn thật, mâu thuẫn với đặc tả,
> hai phương án loại trừ nhau, chi phí bằng người-ngày, và hệ quả nếu chọn khác đề xuất.
>
> **Thời gian đọc:** §2 (5 phút) đủ để nắm vấn đề. §4 (20 phút) đủ để quyết.

---

## 1. Mục đích tờ trình

1. **Báo cáo kết quả rà soát** đặc tả `Scheduler Engine v3.1` đối chiếu với mã nguồn thật của sản phẩm — phát hiện **20 khoảng cách**, trong đó **3 điểm đặc tả giả định sai thực tế kỹ thuật của MK-DDC-24**.
2. **Xin phê duyệt 6 quyết định kiến trúc** đang chặn cứng toàn bộ công việc. Bốn trong sáu quyết định làm thay đổi hình dạng dữ liệu — viết code trước khi chốt là tự chuốc một đợt viết lại.
3. **Xin phê duyệt kế hoạch triển khai** (Plan 50): 5 pha · 78 task · **64 người-ngày** · 11 tuần.

---

## 2. Tóm tắt điều hành

### 2.1 Vấn đề

Đặc tả v3.1 tuyên bố **loại bỏ hoàn toàn cơ chế thanh ghi lịch `TSx`** và chuyển sang mô hình **BACnet Schedule Object**. Sản phẩm hiện tại không chỉ *dùng* mô hình TSx — nó **phơi TSx ra thẳng màn hình khách hàng**: trang Lịch vận hành có một chế độ hiển thị đúng 12 dòng nhãn `TSx 0` … `TSx 11`.

Đây **không phải một đợt làm đẹp giao diện**. Mô hình dữ liệu thay đổi xuyên ba tầng; giao diện chỉ là mặt cắt nhìn thấy được của nó.

| | Mô hình hiện tại | Mô hình v3.1 yêu cầu |
|---|---|---|
| Một lịch | 1 khoảng giờ · 1 giá trị · 1 điểm điều khiển | 7 ngày × nhiều mốc giờ · nhiều ngoại lệ · nhiều điểm điều khiển |
| Ngày lễ | Một loại lịch riêng, khi có hiệu lực thì **tắt toàn bộ mọi lịch khác** | Ngoại lệ thuộc **từng lịch**, chỉ ghi đè lịch chứa nó |
| Phiên bản | Không có | Đánh số, xem khác biệt, quay lui ≥10 bản |
| Kiểm tra trước khi áp dụng | Không có | Bắt buộc validate + mô phỏng 7/30 ngày |
| Nhật ký thao tác | Một dòng gộp `"schedules applied"` | Đủ 10 trường: ai, khi nào, lý do, phiên bản trước/sau, kết quả |

### 2.2 Ba điểm đặc tả giả định sai thực tế kỹ thuật

Đây là phần quan trọng nhất của tờ trình. Đặc tả v3.1 được viết cho một **gateway đa controller**; MK-DDC-24 là một **DDC đơn**. Ba chỗ lệch nhau:

| # | Đặc tả yêu cầu | Thực tế MK-DDC-24 | Hệ quả |
|---|---|---|---|
| 1 | Ưu tiên ghi 16 mức (1..16) | Bộ phân xử đầu ra của controller chỉ có **6 mức**, trong đó mức 1 dành cho Fire/Safety và có ràng buộc an toàn | Không thể phơi 16 mức xuống phần cứng mà không đụng đường an toàn → **QĐ-1** |
| 2 | MQTT là kênh chính giữa Backend và Controller | **Không có MQTT ở bất kỳ đâu trong sản phẩm.** Backend và Controller nằm **cùng một bo mạch**, nói chuyện qua bộ nhớ chia sẻ | Thêm MQTT cho hai tiến trình cùng máy là thêm hạ tầng không tạo giá trị ở Rev A → **QĐ-2** |
| 3 | 64 lịch × ≥32 điểm điều khiển = 2048 lệnh ghi | Bo có **64 điểm ghi nội bộ** (4 AO + 4 DO + 32 AV + 16 BV + 8 MSV), cộng 256 điểm Modbus mở rộng | Con số 2048 không có phần cứng đỡ → **QĐ-3** |

Thêm ba khoảng cách khác cần quyết: chưa có đối tượng BACnet Schedule/Calendar (**QĐ-4**); sản phẩm có 3 vai trò người dùng chứ không phải 6 như đặc tả (**QĐ-5**); và cấu hình lịch đang chạy trên bo phải được di trú an toàn (**QĐ-6**).

### 2.3 Tóm tắt 6 đề xuất

| # | Quyết định | Đề xuất của nhóm kỹ thuật | Chi phí | Cấp duyệt |
|---|---|---|---:|---|
| **QĐ-1** | Ưu tiên ghi 1..16 | **Phân xử 16 mức bên trong lớp lịch**, chỉ đưa người thắng xuống bộ phân xử 6 mức. Không đụng đường an toàn | 1,5 ngày | CTO |
| **QĐ-2** | MQTT | **Hoãn sang Rev B.** Rev A dựng đủ ngữ nghĩa (phiên bản, xác nhận ACK/NACK, chống lặp, timeout) trên kênh hiện có | 0 ngày | CTO |
| **QĐ-3** | Trần điểm điều khiển | **Giữ 32 điểm/lịch theo đặc tả**, bổ sung đồng hồ đo dung lượng thật trên giao diện | 0,5 ngày | PM |
| **QĐ-4** | Đối tượng BACnet Schedule | **Làm ở pha 4**, sau khi mô hình dữ liệu ổn định | 5 ngày | CTO |
| **QĐ-5** | Vai trò người dùng | **Giữ 3 vai trò**, bổ sung 4 quyền thao tác riêng | 0,75 ngày | PM |
| **QĐ-6** | Di trú cấu hình đang chạy | **Tự động chuyển đổi + giữ bản sao lưu + bắt người dùng xác nhận** | 3 ngày | PM |

**Tổng chênh lệch nếu duyệt toàn bộ đề xuất so với làm theo đặc tả nguyên văn: tiết kiệm ước tính 22–30 người-ngày** (chủ yếu từ QĐ-1 và QĐ-2), và tránh được rủi ro chạm vào đường an toàn của bộ điều khiển.

---

## 3. Bằng chứng hiện trạng

Toàn bộ số liệu dưới đây **đọc từ mã nguồn tại commit `5fef0b9`**, không phải chép lại tài liệu cũ.

| Tầng | Tập tin | Quy mô | Ghi nhận |
|---|---|---|---|
| Giao diện | `apps/web-ui/src/features/operations/SchedulerPage.tsx` | 756 dòng, **một tập tin gánh cả 11 màn hình** đặc tả đòi | Chế độ `Parameters` hiển thị nhãn `TSx 0`…`TSx 11`; wizard cũng gắn nhãn thanh ghi cho từng bước |
| Backend | `scheduleapi.go` · `schedulestore.go` · `dto.go` | Chỉ **2 endpoint** (đặc tả đòi 14) | Lưu cả 64 lịch trong một tập tin JSON; mỗi lần lưu là ghi đè toàn bộ; áp dụng bằng tín hiệu SIGHUP |
| Controller | `apps/core/application/schedule/schedule_runtime.cpp` | 527 dòng | Ngày lễ tắt toàn cục; xung đột giải quyết bằng quy tắc "khoảng vừa bắt đầu thì thắng" mà **người dùng không nhìn thấy và không điều khiển được**; giờ lấy theo múi giờ của tiến trình, không theo từng lịch |

**Nguy cơ vận hành đang tồn tại (không phải do dự án này gây ra, nhưng dự án này khắc phục):**

- Người vận hành **không có cách nào biết vì sao lịch bật mà thiết bị không chạy**. Khi một nguồn ưu tiên cao hơn (lệnh tay, BACnet, an toàn) đang giữ đầu ra, giao diện im lặng hoàn toàn.
- Một lịch ngày lễ cấu hình nhầm sẽ **tắt toàn bộ hệ thống lịch** mà không có cảnh báo nào.
- Không có bước kiểm tra trước khi áp dụng: sai cấu hình là ra lệnh thẳng xuống quạt, van, bơm.

---

## 4. Sáu quyết định — trình bày chi tiết

---

### QĐ-1 · Ưu tiên ghi 16 mức trên bộ phân xử 6 mức

> **Cấp duyệt:** CTO · **Chặn:** JSON Schema, lõi controller, giao diện · **Chi phí đề xuất:** 1,5 người-ngày

**Hiện trạng.** Mọi lệnh ra đầu ra vật lý của MK-DDC-24 đều đi qua một bộ phân xử **6 mức**:

```
1 = Fire/Safety     ← có ràng buộc an toàn, đã qua kiểm chứng
2 = Lệnh tay tại chỗ
3 = BACnet
4 = Lịch vận hành   ← toàn bộ hệ thống lịch dùng đúng một mức này
5 = Logic nội bộ
6 = Mặc định
```

Đặc tả v3.1 yêu cầu mỗi lịch có `priority_for_writing` từ 1 đến 16.

**Hai phương án loại trừ nhau:**

| | **PA-1 (ĐỀ XUẤT)** — Phân xử bên trong lớp lịch | **PA-2** — Nâng bộ phân xử lên 16 mức |
|---|---|---|
| Cách làm | Lớp lịch tự phân xử 1..16 giữa các lịch cùng điều khiển một điểm; **chỉ lịch thắng** được đưa xuống mức 4 của bộ phân xử | Mở rộng bộ phân xử từ 6 lên 16 mức, ánh xạ lại toàn bộ nguồn ghi |
| Chi phí | **1,5 người-ngày** | **8–12 người-ngày** |
| Đụng đường an toàn | **Không** | **Có** — phải chứng minh lại toàn bộ logic trạng thái an toàn |
| Kiểm thử phải chạy lại | Chỉ phần lịch | **Toàn bộ 743 test hiện có** + kiểm chứng an toàn trên bo |
| Ngữ nghĩa 16 mức giữa các lịch | **Đầy đủ** — hai lịch khác priority ghi cùng điểm thì phân xử đúng | Đầy đủ |
| Ngữ nghĩa 16 mức so với nguồn khác | Mọi lịch xuất hiện ở mức 4 trước lệnh tay và BACnet | Phân biệt được đầy đủ |

**Hệ quả cần chấp nhận nếu chọn PA-1:** một lịch đặt `priority_for_writing = 1` vẫn **không** thắng được lệnh tay tại chỗ (mức 2). Nhóm kỹ thuật cho rằng **đây là hành vi đúng, không phải hạn chế** — một lịch tự động không nên đè được lệnh tay của kỹ thuật viên đang đứng trước tủ điện. Giao diện sẽ nói rõ điều này bằng chữ, không để người dùng đoán.

> **ĐỀ XUẤT: Duyệt PA-1.** Lý do quyết định: PA-2 chạm vào đường an toàn đã qua kiểm chứng để đổi lấy một ngữ nghĩa mà trên một DDC 4 AO + 4 DO không ai quan sát được sự khác biệt.

---

### QĐ-2 · MQTT

> **Cấp duyệt:** CTO · **Chặn:** JSON Schema, luồng publish · **Chi phí đề xuất:** 0 người-ngày

**Hiện trạng.** Rà soát toàn bộ mã nguồn: **không có một dòng MQTT nào** trong sản phẩm. Backend (Go) và Controller (C++) chạy **trên cùng một bo mạch**, trao đổi qua bộ nhớ chia sẻ và socket nội bộ.

Đặc tả §14 mô tả 5 topic MQTT, QoS 1, chống replay, xác thực thiết bị và phân quyền topic — toàn bộ được thiết kế cho kịch bản **một máy chủ trung tâm quản lý nhiều controller qua mạng**.

| | **PA-1 (ĐỀ XUẤT)** — Hoãn sang Rev B | **PA-2** — Làm MQTT ngay ở Rev A |
|---|---|---|
| Cách làm | Dựng **đủ ngữ nghĩa** đặc tả đòi (số phiên bản, mã tương quan, xác nhận ACK/NACK, xử lý chống lặp, timeout, giới hạn thử lại) trên kênh hiện có | Thêm broker, thư viện MQTT, TLS, chứng chỉ, phân quyền topic |
| Chi phí phát triển | **0 ngày** (ngữ nghĩa đã nằm trong 64 ngày của kế hoạch) | **+10–14 người-ngày** |
| Chi phí vận hành | Không | Broker phải cài, giám sát, xoay chứng chỉ, sao lưu |
| Giá trị thêm ở Rev A | — | **Gần bằng 0** (hai tiến trình cùng máy) |
| Khi gắn MQTT về sau | Giao diện **không phải sửa một dòng**; chỉ thay lớp vận chuyển | — |
| Rủi ro bảo mật thêm | Không | Thêm một cổng mạng và một hệ thống xác thực phải bảo trì |

> **ĐỀ XUẤT: Duyệt PA-1.**
>
> **Câu hỏi cần CTO trả lời kèm theo:** lộ trình sản phẩm có **gateway đa controller** không, và nếu có thì ở phiên bản nào? Nếu có, MQTT nên được lập kế hoạch riêng cho phiên bản đó — không nên nhét vào Rev A, cũng không nên bỏ hẳn khỏi lộ trình.

---

### QĐ-3 · Trần số điểm điều khiển trên mỗi lịch

> **Cấp duyệt:** PM · **Chặn:** JSON Schema, giao diện · **Chi phí đề xuất:** 0,5 người-ngày

**Hiện trạng.** Bo có **64 điểm ghi nội bộ**: 4 analog output, 4 digital output, 32 analog value, 16 binary value, 8 multi-state value. Cộng thêm tối đa 256 điểm Modbus mở rộng khi bật fieldbus.

Đặc tả yêu cầu mỗi lịch hỗ trợ **tối thiểu 32 điểm điều khiển** → 64 lịch × 32 = 2048 cặp.

| | **PA-1 (ĐỀ XUẤT)** — Giữ 32/lịch + đồng hồ dung lượng | **PA-2** — Hạ trần xuống 8/lịch |
|---|---|---|
| Tuân thủ đặc tả | **Đầy đủ** | Lệch đặc tả, phải giải trình với khách hàng |
| Chi phí bộ nhớ / thời gian đánh giá | Không đáng kể (đã tính trong mốc <100 ms) | Không tiết kiệm được gì đáng kể |
| Người dùng hiểu giới hạn thật | **Có** — giao diện hiện `12/64 lịch · 7/64 điểm ghi` ngay đầu trang | Không |

> **ĐỀ XUẤT: Duyệt PA-1.** Không cắt con số của đặc tả; thay vào đó **nói thật với người dùng** bằng đồng hồ đo dung lượng. Hạ trần xuống 8 là lệch đặc tả mà không đổi lấy được gì.

---

### QĐ-4 · Đối tượng BACnet Schedule (type 17) và Calendar (type 6)

> **Cấp duyệt:** CTO · **Chặn:** JSON Schema (chỉ phần định danh), pha 4 · **Chi phí đề xuất:** 5 người-ngày ở pha 4

**Hiện trạng.** Bảng đối tượng BACnet của sản phẩm hiện có: AI, BI, AO, BO, AV, BV, MSV và Device. **Không có** type 17 (Schedule) và type 6 (Calendar).

Đặc tả §4.1 đặt `bacnet_object.object_type = "SCHEDULE"` trong mô hình dữ liệu.

| | **PA-1 (ĐỀ XUẤT)** — Pha 4, sau khi mô hình ổn định | **PA-2** — Làm ngay ở pha 1 |
|---|---|---|
| Rủi ro làm lại | Thấp | **Cao** — đối tượng BACnet phải khớp mô hình nội bộ; mô hình chưa ổn định thì làm hai lần |
| Ảnh hưởng hồ sơ chứng nhận BTL | Trường định danh vẫn được sinh từ pha 1 nên **không phải di trú dữ liệu lần hai** | — |
| Thời điểm sẵn sàng | Tuần 11 | Tuần 5, nhưng nhiều khả năng phải sửa lại |

> **ĐỀ XUẤT: Duyệt PA-1.**
>
> **Câu hỏi cần CTO trả lời kèm theo:** hồ sơ chứng nhận BTL có mốc nộp cố định không? Nếu mốc nộp **trước tuần 11**, phải đảo thứ tự pha và tờ trình xin điều chỉnh lại kế hoạch.

---

### QĐ-5 · Vai trò người dùng

> **Cấp duyệt:** PM · **Chặn:** phân quyền backend và giao diện · **Chi phí đề xuất:** 0,75 người-ngày

**Hiện trạng.** Sản phẩm có **3 vai trò**: `viewer`, `operator`, `admin` — đã chốt bằng quyết định kiến trúc trước đây và đang dùng ở cả Web lẫn HMI cục bộ.

Đặc tả §19 liệt kê **6 vai trò**: Viewer, Operator, Engineer, Commissioning Engineer, Administrator, Auditor. Nhưng câu cuối của chính §19 nói: *"Các thao tác publish, rollback, xóa và thay đổi priority phải yêu cầu quyền riêng"* — tức đặc tả đã tự mở đường cho mô hình quyền-theo-thao-tác.

| | **PA-1 (ĐỀ XUẤT)** — 3 vai trò + 4 quyền thao tác | **PA-2** — Thêm 3 vai trò mới |
|---|---|---|
| Chi phí | **0,75 người-ngày** | **~4 người-ngày** |
| Phạm vi ảnh hưởng | Chỉ module lịch | API người dùng, đăng nhập HMI, tài liệu phân quyền, quyết định kiến trúc đã ban hành |
| Phủ được ngữ nghĩa đặc tả | **Có** — bảng ánh xạ đầy đủ 6 vai trò trong tài liệu thiết kế | Có |
| Bề mặt quản trị | Không tăng | Tăng gấp đôi số vai trò phải cấu hình và giải thích cho khách hàng |

Bốn quyền thao tác riêng: `schedule.publish` · `schedule.rollback` · `schedule.delete` · `schedule.priority`.

> **ĐỀ XUẤT: Duyệt PA-1.** Sáu vai trò của đặc tả là mô hình doanh nghiệp; ba vai trò cộng bốn quyền phủ đủ ngữ nghĩa mà không phá quyết định kiến trúc đã ban hành.

---

### QĐ-6 · Di trú cấu hình lịch đang chạy

> **Cấp duyệt:** PM · **Chặn:** backend, giao diện · **Chi phí đề xuất:** 3 người-ngày

**Hiện trạng.** Bo lab (và mọi bo đã giao nếu có) đang chạy tập tin `schedule.conf` theo định dạng cũ. Áp định dạng mới đè lên là **mất toàn bộ cấu hình đang vận hành**.

| | **PA-1 (ĐỀ XUẤT)** — Chuyển đổi tự động | **PA-2** — Yêu cầu nhập lại thủ công |
|---|---|---|
| Cách làm | Backend nhận diện định dạng khi nạp, chuyển đổi một chiều, ghi bản mới, **giữ bản cũ thành `.bak`**; giao diện hiện băng "N lịch đã chuyển từ định dạng cũ — hãy kiểm tra và áp dụng lại" cho tới khi người dùng xác nhận | Nâng cấp xong thì lịch trống, khách hàng tự nhập lại |
| Chi phí | **3 người-ngày** | 0 |
| Rủi ro mất cấu hình vận hành | Thấp — có bản sao lưu và bước xác nhận bắt buộc | **Cao** — và là loại sự cố khách hàng nhớ rất lâu |
| Kiểm chứng | Test round-trip trên **tập tin thật lấy từ bo lab**, không phải tập tin bịa | — |

> **ĐỀ XUẤT: Duyệt PA-1.** Đây là mục nhóm kỹ thuật đề nghị **không đưa ra tranh luận**: 3 người-ngày để không bao giờ phải giải thích với khách hàng vì sao lịch của họ biến mất sau khi nâng cấp.

---

## 5. Kế hoạch triển khai xin phê duyệt

### 5.1 Tổng quan

**5 pha · 78 task · 64 người-ngày · 11 tuần** (07/08 → 20/10/2026).

| Pha | Nội dung | Task | Người-ngày | Kết quả nghiệm thu |
|---|---|---:|---:|---|
| **P0** | Chốt 6 quyết định + đóng băng hợp đồng dữ liệu | 9 | 4 | Sáu quyết định thành văn bản có ngày và người quyết |
| **P1** | Lõi controller viết lại · Backend 14 endpoint · di trú dữ liệu | 24 | 25 | Bộ test C++/Go xanh; đánh giá 64 lịch **< 100 ms**; di trú tập tin thật của bo lab không mất mục nào |
| **P2** | Giao diện: danh sách, lịch tuần kéo thả, ngoại lệ, điểm điều khiển, mô phỏng, so sánh trước khi áp dụng | 26 | 21 | Bộ test FE + kịch bản E2E xanh; **không còn chuỗi `TSx` nào trong toàn bộ mã nguồn**; mở danh sách 64 lịch **< 2 s** |
| **P3** | Múi giờ, DST, phát hiện nhảy giờ, khôi phục sau mất điện, màn hình giám sát | 12 | 9 | Kiểm chứng trên bo: đổi giờ hệ thống, cắt điện, đồng bộ NTP lại |
| **P4** | Đối tượng BACnet Schedule + Calendar | 7 | 5 | Đọc/ghi thuộc tính qua BACnet; hồ sơ PICS cập nhật |

### 5.2 Phân bổ nguồn lực

| Vai trò | Người-ngày | Ghi chú |
|---|---:|---|
| Dev Core (C++) | 22 | Lõi đánh giá lịch, thời gian, BACnet |
| Dev Backend (Go) | 16 | Hợp đồng, 14 endpoint, phiên bản, di trú |
| Dev Frontend (React) | 21 | 4 route + 6 tab, thay thế trang cũ 756 dòng |
| QA | 5 | Kịch bản E2E, đo hiệu năng, kiểm chứng trên bo |
| **Tổng** | **64** | |

**Hai track chạy song song** vì không dùng chung người và không đụng cùng tập tin: Core+Backend từ tuần 2, Frontend từ tuần 3 (nhờ một máy chủ giả lập dữ liệu dựng ở tuần 2 để Frontend không phải ngồi chờ).

### 5.3 Bốn ràng buộc thứ tự có ảnh hưởng tới tiến độ

1. **Hợp đồng dữ liệu đóng băng ở tuần 1.** Mọi công việc sau đó treo vào nó. Đây là lý do P0 phải có câu trả lời trước khi P1 khởi động.
2. **Máy chủ giả lập dựng sớm** để Frontend và Backend chạy song song thay vì nối tiếp — tiết kiệm khoảng 3 tuần lịch.
3. **Chức năng mô phỏng phải gọi đúng mã đánh giá của controller**, không được cài lại trong Backend. Cài lại là tự nói dối: nó đúng cho tới ngày hai bản lệch nhau, và ngày đó không ai biết.
4. **Kéo thả và thao tác bàn phím làm cùng lúc**, không tách. Làm kéo thả trước rồi thêm bàn phím sau là cách chắc chắn nhất để bàn phím không bao giờ được làm — trong khi tủ điện dùng màn hình chạm nhỏ và kỹ thuật viên hiện trường cần thao tác nhanh.

---

## 6. Rủi ro cần Ban lãnh đạo biết

| Mã | Rủi ro | Mức | Đã có biện pháp |
|---|---|---|---|
| R-01 | Mất cấu hình lịch đang vận hành khi nâng cấp | **Cao** | QĐ-6: chuyển đổi tự động + bản sao lưu + xác nhận bắt buộc + test bằng tập tin thật của bo |
| R-02 | Mô phỏng lệch với hành vi thật của controller | **Cao** | Bắt buộc dùng chung mã đánh giá, cấm cài lại (§5.3 mục 3) |
| R-03 | Quy tắc ngoại lệ kiểu "thứ Hai đầu tiên của tháng" sai âm thầm | **Cao** | ≥40 ca kiểm thử + giao diện hiển thị trước "12 tháng tới rơi vào những ngày nào" để người dùng tự thấy |
| R-04 | Ưu tiên 16 mức trở thành lời hứa suông | Trung bình | QĐ-1 + giao diện nói thật mức thực tế của controller |
| R-05 | Vượt 64 người-ngày do pha 1 kéo dài | Trung bình | Frontend khởi động sớm bằng máy chủ giả lập, không chờ pha 1 xong |

**Rủi ro không thể đóng bằng kế hoạch này (nêu để minh bạch):** toàn bộ kiểm chứng chạy trên bo với MCU giả lập, **không có I/O vật lý**. Kế hoạch này không đóng khoảng trống đó và không tuyên bố đóng được.

---

## 7. Nếu không phê duyệt hoặc trì hoãn

| Kịch bản | Hệ quả |
|---|---|
| **Trì hoãn quyết định** | Toàn bộ 78 task đứng yên. Không có công việc nào của module lịch được phép bắt đầu — bốn trong sáu quyết định đổi hình dạng dữ liệu. |
| **Không duyệt, giữ nguyên hiện trạng** | Sản phẩm tiếp tục phơi `TSx` ra màn hình khách hàng, không đạt tiêu chí nghiệm thu #20 của đặc tả. Ba nguy cơ vận hành ở §3 tồn tại nguyên vẹn. |
| **Duyệt kế hoạch nhưng bác các đề xuất** | Chi phí tăng ước tính **+22 đến +30 người-ngày** (chủ yếu QĐ-1 và QĐ-2), và phải chứng minh lại đường an toàn của bộ điều khiển. |

---

## 8. Bảng biểu quyết và ký duyệt

Kính trình Ban Quản lý Dự án và Giám đốc Công nghệ xem xét, cho ý kiến trực tiếp dưới đây.

### 8.1 Sáu quyết định kiến trúc

| # | Quyết định | Đề xuất | Ý kiến | Người duyệt |
|---|---|---|---|---|
| QĐ-1 | Ưu tiên ghi 1..16 | Phân xử trong lớp lịch (PA-1) | `[ ] DUYỆT PA-1`<br>`[ ] CHỌN PA-2`<br>`[ ] Ý kiến khác: ________` | CTO |
| QĐ-2 | MQTT | Hoãn sang Rev B (PA-1) | `[ ] DUYỆT PA-1`<br>`[ ] CHỌN PA-2`<br>`[ ] Ý kiến khác: ________` | CTO |
| QĐ-3 | Trần điểm điều khiển | Giữ 32/lịch + đồng hồ dung lượng (PA-1) | `[ ] DUYỆT PA-1`<br>`[ ] CHỌN PA-2`<br>`[ ] Ý kiến khác: ________` | PM |
| QĐ-4 | BACnet Schedule Object | Làm ở pha 4 (PA-1) | `[ ] DUYỆT PA-1`<br>`[ ] CHỌN PA-2`<br>`[ ] Ý kiến khác: ________` | CTO |
| QĐ-5 | Vai trò người dùng | 3 vai trò + 4 quyền (PA-1) | `[ ] DUYỆT PA-1`<br>`[ ] CHỌN PA-2`<br>`[ ] Ý kiến khác: ________` | PM |
| QĐ-6 | Di trú cấu hình | Chuyển đổi tự động (PA-1) | `[ ] DUYỆT PA-1`<br>`[ ] CHỌN PA-2`<br>`[ ] Ý kiến khác: ________` | PM |

### 8.2 Hai câu hỏi cần trả lời kèm theo

| # | Câu hỏi | Trả lời | Người trả lời |
|---|---|---|---|
| C-1 | Lộ trình sản phẩm có **gateway đa controller** không? Nếu có thì ở phiên bản nào? (ảnh hưởng QĐ-2) | ________________ | CTO |
| C-2 | Hồ sơ chứng nhận **BTL** có mốc nộp cố định không? Nếu có, mốc là ngày nào? (ảnh hưởng QĐ-4 và thứ tự pha) | ________________ | CTO |

### 8.3 Kế hoạch và nguồn lực

| Nội dung | Ý kiến | Người duyệt |
|---|---|---|
| Kế hoạch triển khai 5 pha · 78 task · **64 người-ngày** · 11 tuần | `[ ] CHẤP THUẬN`<br>`[ ] CHẤP THUẬN CÓ ĐIỀU CHỈNH: ________`<br>`[ ] KHÔNG CHẤP THUẬN` | PM |
| Phân bổ nguồn lực: Core 22 · BE 16 · FE 21 · QA 5 người-ngày | `[ ] CHẤP THUẬN`<br>`[ ] ĐIỀU CHỈNH: ________` | PM |

### 8.4 Chữ ký

| Vai trò | Họ và tên | Chữ ký | Ngày ký |
|---|---|---|---|
| **Product Manager** | | | ___/___/2026 |
| **Giám đốc Công nghệ (CTO)** | | | ___/___/2026 |
| **Kiến trúc sư Trưởng** *(tham vấn)* | | | ___/___/2026 |
| **QA Lead** *(tham vấn)* | | | ___/___/2026 |

---

> **Sau khi có đủ chữ ký:** nhóm kỹ thuật ghi sáu quyết định thành quyết định kiến trúc `ADR-023`, đóng băng hợp đồng dữ liệu, và khởi động pha P1 trong vòng **2 ngày làm việc**.

---

## Phụ lục — Tài liệu chi tiết

Người duyệt **không cần đọc** các tài liệu dưới đây để ra quyết định. Chúng dành cho nhóm kỹ thuật và cho việc truy xuất về sau.

| Tài liệu | Nội dung |
|---|---|
| [Đặc tả sản phẩm v3.1](../../CHUONG_YEU_CAU/scheduler.md) | Yêu cầu gốc, 23 mục |
| [Phương án UI/UX/UC](../../04_uiux/KX-DDC24-UIUX-UC-WEB-SCHEDULER-PROPOSAL-001_VI.md) | 20 khoảng cách chi tiết, 26 use case, wireframe 7 màn hình |
| [Plan 50 — Kế hoạch triển khai](../../03_implementation/archive/50_SCHEDULER_V3_1_IMPLEMENTATION_PLAN.md) | 78 task có mã, owner, phụ thuộc, bảng theo dõi tiến độ |

---

## Revision History

| Phiên bản | Ngày | Người | Nội dung |
|---|---|---|---|
| 1.0 | 2026-08-07 | Nhóm Phần mềm MK-DDC-24 | Bản đầu: 6 quyết định kiến trúc, 2 câu hỏi kèm theo, kế hoạch 64 người-ngày, bảng ký duyệt |
