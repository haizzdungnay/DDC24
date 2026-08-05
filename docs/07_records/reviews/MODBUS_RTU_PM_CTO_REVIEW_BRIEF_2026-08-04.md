# Báo cáo trình PM và CTO — Modbus RTU trước khi implement

**ID:** DDC24-MBRTU-PM-CTO-BRIEF-2026-08-04
**Ngày:** 2026-08-04
**Người lập:** Engineering
**Mục đích:** xin phê duyệt kế hoạch triển khai và xin quyết định cho 11 câu hỏi
đang chặn công việc
**Hồ sơ kèm theo:**
[Code Review](MODBUS_RTU_CODE_REVIEW_2026-08-04.md) ·
[Plan 49](../../03_implementation/49_MODBUS_RTU_IMPLEMENTATION_PLAN.md) ·
[Khảo sát board production](../test-evidence/fw-som/2026-08-04-foxlinx-uart-rs485-survey.md) ·
[Docs Sync Report](MODBUS_RTU_DOCS_SYNC_REPORT.md) ·
[Open Decisions](../../00_governance/MODBUS_RTU_OPEN_DECISIONS.md)

---

## 1. Tóm tắt cho lãnh đạo

Chúng tôi đã hoàn thành bộ tài liệu thiết kế Modbus RTU (12 tài liệu) và review
toàn bộ source hiện có. Kết quả có ba phần cần lãnh đạo biết:

**Thứ nhất — có lỗi đang tồn tại trên board cần sửa ngay, không liên quan tới
thiết kế mới.** Nghiêm trọng nhất: đường ghi xuống thiết bị Modbus **không kiểm
tra biên giá trị**. Nếu logic điều khiển tính ra một giá trị ngoài dải (lỗi công
thức, sai đơn vị, hoặc chia cho 0), phần mềm sẽ ghi một giá trị **không xác định**
xuống VFD/thiết bị hiện trường thay vì từ chối. Ngoài ra, một lệnh ghi thất bại
hiện được **thử lại vô hạn**: lệnh đặt lúc 09:00 có thể tự động thực thi lúc 14:00
khi thiết bị được cấp điện trở lại, không ai ra lệnh lại.

**Thứ hai — phần lớn công việc còn lại đang bị chặn bởi một câu hỏi phần cứng
chưa có lời đáp:** sản phẩm có **một hay hai** cổng RS485? Tài liệu Product ghi
hai; hồ sơ phần cứng mô tả một. Không thể viết code cho tới khi biết.

**Thứ ba — chúng tôi đề xuất tách công việc thành hai track** để phần vá an toàn
không phải chờ phần quyết định. Track A (13,25 người-ngày) bắt đầu được ngay sau
khi PM duyệt. Track B (40–51 người-ngày) chờ CTO quyết định.

**Đề nghị lãnh đạo phê duyệt:** khởi động Track A ngay trong tuần này, và trả lời
9 câu hỏi ở §4 để mở khoá Track B.

---

## 2. Hiện trạng: cái gì đang chạy, cái gì chưa

| Câu hỏi | Trả lời trung thực |
|---|---|
| Modbus RTU đã chạy chưa? | Có, trên môi trường lab với thiết bị mô phỏng (PTY/simulator). |
| Đã chạy với thiết bị Modbus thật chưa? | **Chưa.** Chưa từng có một slave RS485 thật nào được đấu vào. |
| Người dùng cấu hình được chưa? | Được — thêm/sửa/xoá Device và Point qua Web. |
| Đọc giá trị được chưa? | Được, với thiết bị mô phỏng. |
| Ghi giá trị được chưa? | Chỉ qua logic điều khiển nội bộ. **Không có nút ghi thử trên giao diện.** |
| Test kết nối thiết bị được chưa? | **Chưa có chức năng này.** |
| Import/export danh sách điểm được chưa? | **Chưa có chức năng này.** |
| Người vận hành (Viewer) xem được không? | **Không.** Trang Modbus hiện khoá ở quyền Admin. |
| Có bao nhiêu điểm tối đa? | 64 — là giới hạn cứng trong bộ nhớ chia sẻ. |

**Kết luận trung thực về mức độ sẵn sàng:** đây là một implementation **đủ tốt cho
phòng lab, chưa đủ cho công trình thật**. Chúng tôi không khuyến nghị bán/lắp đặt
tính năng Modbus RTU trước khi hoàn thành Track B và nghiệm thu với thiết bị thật.

---

## 3. Rủi ro đang mở, xếp theo mức độ

| # | Rủi ro | Hệ quả nếu xảy ra | Xác suất | Xử lý |
|---|---|---|---|---|
| 1 | Ghi giá trị ngoài dải xuống thiết bị hiện trường (D-01) | Thiết bị nhận lệnh sai — ví dụ biến tần nhận tần số rác. Hệ quả vật lý. | Trung bình — cần một lỗi ở tầng logic để kích hoạt | Track A, 2 ngày |
| 2 | Lệnh ghi cũ tự thực thi khi thiết bị online lại (D-03) | Thiết bị chạy theo lệnh đã lỗi thời nhiều giờ | Cao khi có mất điện thiết bị | Track A, 2 ngày |
| 3 | `scale = 0` trong profile viết tay ⇒ ghi 0 xuống thiết bị (D-02) | Ghi 0 = có thể là "tắt" với nhiều thiết bị | Thấp | Track A, gộp với #1 |
| 4 | Thiết bị hỏng làm nghẽn bus, thiết bị tốt mất dữ liệu (D-04) | Mất giám sát diện rộng khi chỉ một thiết bị hỏng | **Cao** trên công trình nhiều thiết bị | Track A, 2 ngày |
| 5 | Giao diện báo "BAD" khi chỉ là mất kết nối web (D-07) | Vận hành mất niềm tin vào bảng điều khiển; báo động giả | Cao | Track A, 2 ngày |
| 6 | Xoá nhầm thiết bị, không có xác nhận (D-08) | Mất cấu hình, restart dịch vụ | Trung bình | Track A, gộp với #5 |
| 7 | Mỗi lần sửa cấu hình đều restart dịch vụ điều khiển (D-09) | Gián đoạn ngắn toàn bộ I/O mỗi lần chỉnh sửa | Chắc chắn xảy ra | Track B — trong lúc chờ, cấm sửa cấu hình Modbus trong giờ vận hành |
| 8 | Sản phẩm công bố 2 cổng RS485; board production hiện chỉ còn **1** cổng rảnh | Bán sai năng lực; khách cấu hình được thiết bị trên cổng không tồn tại | **Cao** — đã xác nhận trên board thật | Q-01 + task đọc bản vẽ |
| 9 | Chưa cấu hình cơ chế chuyển hướng truyền RS-485 | Có thể viết xong toàn bộ phần mềm rồi mới phát hiện không giao tiếp được với thiết bị thật | **Chưa biết** | Q-10 |
| 10 | Giao diện mặc định cổng `/dev/ttyS3` — không tồn tại trên board production | Người dùng lưu cấu hình không chạy được, không có thông báo rõ | Chắc chắn | Track A, gộp với #5 |

**Điểm cần lãnh đạo lưu ý:** rủi ro #1–#6 **không** cần chờ bất kỳ quyết định nào.
Chúng tôi có thể bắt đầu ngay khi PM gật đầu.

---

## 4. Mười một câu hỏi cần lãnh đạo quyết định

Mỗi câu có phương án, khuyến nghị của kỹ thuật, và hệ quả nếu không quyết.

### Q-01 · CTO + Product + phần cứng · **Sản phẩm có mấy cổng RS485?**

Tài liệu Product ghi `2 × Modbus RTU`. Hồ sơ phần cứng `HW_SPEC` §9 mô tả **một**
đường UART, một transceiver, một cổng đấu dây A/B/GND. Source hiện có **một** master.

**Cập nhật 2026-08-04 — chúng tôi đã kiểm tra trực tiếp trên board production
Foxlinx** ([bằng chứng](../test-evidence/fw-som/2026-08-04-foxlinx-uart-rs485-survey.md)):

> Board chỉ bật **2 cổng UART**: `ttyS2` đang chạy liên tục cho MCU STM32, và
> `ttyS5` còn rảnh. Nghĩa là với cấu hình hiện tại của board, **chỉ có đúng một
> cổng cho Modbus RTU**. Sáu cổng UART khác của chip đang tắt — có thể bật, nhưng
> chỉ có ý nghĩa nếu trên bo thật sự có mạch thu phát RS-485 thứ hai.

| Phương án | Hệ quả |
|---|---|
| **A. Giữ 2 cổng** | Chỉ khả thi nếu bo có transceiver thứ hai. Phần cứng phải xác nhận bằng bản vẽ. |
| **B. Hạ xuống 1 cổng ở Rev A** | Khớp với board thật hiện có. Giảm ~5 ngày công, bỏ khái niệm Bus. Phải sửa tài liệu Product và điều chỉnh cam kết bán hàng. |
| **C. Giữ 2 trong tài liệu, làm 1 trước** | **Không khuyến nghị** — tạo giao diện cho cổng không tồn tại. |

**Khuyến nghị:** giao cho phần cứng **đọc bản vẽ bo Foxlinx SOM-DDC-24** và trả
lời trong tuần này (task MBR-A002, ước tính nửa ngày công). Đây là việc rẻ nhất
mở khoá được nhiều nhất trong toàn bộ kế hoạch. Nếu bản vẽ chỉ có một transceiver
thì chọn B và cập nhật cam kết sản phẩm.

**Nếu không quyết:** Track B **không thể bắt đầu**. Đây là cổng chặn cứng nhất.

### Q-10 · CTO + phần cứng · **RS-485 chuyển hướng truyền bằng cách nào?** *(mới)*

RS-485 là đường truyền hai chiều dùng chung một cặp dây, nên thiết bị phải biết
lúc nào được nói, lúc nào phải nghe. Kiểm tra trên board production cho thấy
**hệ điều hành chưa được cấu hình gì cho việc này**, và phần mềm hiện tại cũng
không thiết lập.

Điều đó có nghĩa phần mềm đang **ngầm giả định** mạch thu phát tự chuyển hướng.
Nếu giả định sai, hệ quả là khung truyền bị cắt cụt và giao tiếp không bao giờ
ổn định — nhưng **chỉ phát hiện được khi đấu dây thật**.

**Cần phần cứng trả lời:** mạch thu phát RS-485 tự chuyển hướng, hay điều khiển
bằng một chân tín hiệu? Nếu bằng chân tín hiệu thì là chân nào?

**Nếu không quyết:** có thể viết xong toàn bộ phần mềm rồi mới phát hiện không
giao tiếp được với thiết bị thật — mất trọn giai đoạn nghiệm thu.

### Q-11 · CTO + Product · **Tài liệu ghi sai chip của board production** *(mới, ngoài phạm vi Modbus)*

Tài liệu Product ghi nền tảng tính toán là **Radxa CM3 / RK3566**. Board production
đang chạy thực tế là **Forlinx OK1126B-S** (chip RV1126B).

Đây là hai dòng chip khác hẳn nhau. Mọi con số về hiệu năng, bộ nhớ, thời gian
đáp ứng thời gian thực trong tài liệu hiện tại đều đang tham chiếu sai nền tảng.

**Đề nghị:** mở một finding riêng cho Product/HW rà soát lại toàn bộ tài liệu
nhắc tới chip. Việc này **nằm ngoài phạm vi Modbus RTU** nhưng chúng tôi phát hiện
trong lúc khảo sát nên báo cáo lại.

### Q-02 · CTO · **Chấp nhận thay đổi định dạng dữ liệu nội bộ giữa 3 dịch vụ?**

Định dạng hiện tại không mang dấu thời gian của phép đo, không phân biệt đủ trạng
thái chất lượng, và làm mất độ chính xác với số nguyên lớn (ví dụ chỉ số điện năng
tích luỹ sẽ sai khi vượt ~16,7 triệu).

Sửa việc này là **thay đổi giao diện nhị phân** giữa `mkddc-core`, `mkddc-iobus`
và `mkddc-web` — ba dịch vụ phải được nâng cấp cùng lúc, không được lệch phiên bản.

**Khuyến nghị:** chấp nhận, và bắt buộc đóng gói ba binary trong một gói cài đặt
duy nhất, kèm kịch bản kiểm thử "cài lệch phiên bản phải báo lỗi rõ".

**Nếu không quyết:** không sửa được lỗi mất độ chính xác và không có dấu thời gian
đo — hai điều kiện bắt buộc để nghiệm thu.

### Q-03 · Product + Security · **Vai trò nào được ghi giá trị xuống thiết bị?**

Hệ thống hiện có 3 vai trò (`viewer`/`operator`/`admin`). Yêu cầu nghiệp vụ nhắc
tới 4 vai trò (thêm `Engineer`).

| Phương án | Hệ quả |
|---|---|
| **A. Giữ 3 vai trò** | Kỹ sư cấu hình phải dùng tài khoản Admin — tức có luôn quyền quản trị người dùng. |
| **B. Thêm vai trò `engineer`** | Đúng nguyên tắc đặc quyền tối thiểu. Ảnh hưởng toàn hệ thống, không chỉ Modbus. Ước lượng +3 ngày. |

**Khuyến nghị:** A cho Rev A (không mở rộng phạm vi), B đưa vào Rev B. Nhưng
**tách riêng một việc làm ngay bất kể phương án nào**: cho Viewer xem được trang
Modbus. Hiện Viewer không giám sát được, trái yêu cầu sản phẩm.

### Q-04 · PM · **Tham số "Retry" trên giao diện nên hiểu thế nào?**

Người dùng nhập "Retry = 3" và tin rằng hệ thống thử lại 3 lần khi nhiễu. **Thực
tế hệ thống không thử lại lần nào**; con số đó chỉ quyết định sau bao nhiêu lần
đọc lỗi thì báo thiết bị mất kết nối.

| Phương án | Chi phí |
|---|---|
| **A. Đổi nhãn** thành "Số lỗi trước khi báo mất kết nối" | 0,5 ngày |
| **B. Làm đúng như nhãn** — thật sự thử lại | 1,5 ngày |

**Khuyến nghị: B.** Thử lại là hành vi tiêu chuẩn của một Modbus master; thiếu nó
khiến mọi nhiễu thoáng qua đều làm điểm dữ liệu nhảy trạng thái, gây nhiễu báo
động trên công trình thật.

### Q-05 · CTO · **Bao giờ có thiết bị RS485 thật để nghiệm thu?**

Không có thiết bị thật thì **không thể** đóng các hạng mục nghiệm thu bắt buộc:
đấu dây, lỗi khung truyền vật lý, điện trở đầu cuối, độ dài dây, chạy liên tục 24 giờ.

Cần: 2–3 thiết bị Modbus RTU thật (khuyến nghị 1 đồng hồ điện + 1 biến tần), cáp,
điện trở đầu cuối, và một máy phân tích bus.

**Nếu không quyết:** Track A và phần lớn Track B vẫn hoàn thành được, nhưng
**không được tuyên bố sản phẩm hỗ trợ Modbus RTU**. Hạng mục nghiệm thu sẽ treo
vô thời hạn.

### Q-06 · CTO · **Ai là Fieldbus Lead và QA Lead cho phần này?**

Hiện chưa có tên người chịu trách nhiệm. Không có người ký thì không đóng được
quyết định kỹ thuật và không ai phê duyệt kết quả nghiệm thu.

**Nếu không quyết:** ước lượng công sức trong Plan 49 không chốt được, và mọi
quyết định kỹ thuật tiếp tục dồn lên CTO.

### Q-07 · PM · **Có cần chức năng đọc thử / ghi thử / test kết nối không?**

Hiện chưa có. Không có ba chức năng này, kỹ thuật viên đi công trình **không có
cách nào kiểm tra một thiết bị mới trước khi đưa vào vận hành** ngoài việc tạo
điểm dữ liệu rồi chờ xem có lên số không.

**Khuyến nghị: có, cả ba.** Đây là chức năng phân biệt giữa "chạy được ở phòng
lab" và "dùng được ở công trình". Ước lượng gộp trong Track B, ~3 ngày.

### Q-08 · PM · **Có cần import/export danh sách điểm không?**

Một đồng hồ điện thường có 30–60 điểm. Nhập tay từng điểm qua giao diện là không
khả thi ở công trình thật.

**Khuyến nghị: có, định dạng CSV** (mở được bằng Excel tại hiện trường) cộng JSON
cho sao lưu toàn bộ. Ước lượng ~2 ngày.

### Q-09 · Product · **Giới hạn 64 điểm Modbus có đủ cho thị trường mục tiêu không?**

64 là giới hạn cứng trong bộ nhớ chia sẻ hiện tại. Với một đồng hồ điện 40 điểm,
chỉ còn chỗ cho một thiết bị nữa.

**Khuyến nghị:** Product xác nhận con số dựa trên hồ sơ dự án thực tế. Nếu cần
nhiều hơn, đây là thay đổi giao diện nhị phân — nên gộp cùng Q-02 để chỉ phải
nâng cấp một lần.

---

## 5. Đề nghị phê duyệt

| # | Đề nghị | Người duyệt | Hệ quả nếu duyệt |
|---|---|---|---|
| 1 | **Giao phần cứng đọc bản vẽ bo Foxlinx trong tuần này** (nửa ngày công) để trả lời Q-01 + Q-10 | CTO + HW | **Việc rẻ nhất mở khoá nhiều nhất** — gỡ cổng chặn cứng của toàn bộ Track B |
| 2 | **Khởi động Track A ngay** (vá an toàn, 13,25 người-ngày) | PM | Đóng 6/8 rủi ro đang mở trong ~3 tuần |
| 3 | Ghi vào quy trình vận hành: **không sửa cấu hình Modbus trong giờ vận hành** cho tới khi Track B xong | PM | Giảm rủi ro #7 trong thời gian chờ |
| 4 | Trả lời Q-02 (đổi định dạng nội bộ), Q-03, Q-04 | CTO / Product / PM | Mở khoá từng phần Track B |
| 5 | Cấp thiết bị RS485 thật (Q-05) và chỉ định owner (Q-06) | CTO | Mở khoá nghiệm thu |
| 6 | Xác nhận phạm vi Q-07, Q-08, Q-09 | PM + Product | Chốt khối lượng Track B |
| 7 | Mở finding riêng cho sai khác chip trong tài liệu (Q-11) | CTO + Product | Ngoài phạm vi Modbus nhưng ảnh hưởng nhiều tài liệu |

## 6. Điều chúng tôi **không** làm nếu chưa được duyệt

- Không sửa một dòng source nào (đến thời điểm báo cáo này, chưa sửa).
- Không viết code hai-bus trước khi có câu trả lời Q-01.
- Không thay đổi định dạng dữ liệu nội bộ trước khi có Q-02.
- Không tuyên bố Modbus RTU sẵn sàng cho công trình trước khi nghiệm thu với
  thiết bị thật.

## 7. Ghi chú về độ tin cậy của báo cáo

- Mọi phát hiện ở §3 đều kèm dẫn chứng dòng code cụ thể trong
  [Code Review](MODBUS_RTU_CODE_REVIEW_2026-08-04.md), có thể kiểm chứng lại.
- Ước lượng công sức trong Plan 49 là **khoảng**, chưa chốt được vì chưa có owner
  (Q-06). Sai số dự kiến ±30%.
- Chúng tôi **không** chạy lại bộ test trong phiên làm việc này vì không sửa
  source; các con số test cũ không được dùng làm bằng chứng cho kết luận nào ở đây.
- Rủi ro #1 (ghi giá trị ngoài dải) là suy luận từ đọc code, **chưa** được tái
  hiện trên board. Chúng tôi đề nghị tái hiện nó như bước đầu tiên của Track A để
  xác nhận mức độ nghiêm trọng trước khi sửa.

## Revision history

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-04 | Báo cáo trình PM/CTO: hiện trạng, 8 rủi ro, 9 câu hỏi, 6 đề nghị phê duyệt |
