# Lộ trình thư viện chuẩn ST — làm gì, không làm gì, vì sao

> **Document ID:** SW-ST-LIB-ROADMAP-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-09-02
> **Nguồn quyết định:** `ADR-054` điểm 3 — chữ ký chủ sở hữu 2026-08-31.
> **Issue:** [#368](https://github.com/Mekong-HCM/MK-DDC-24/issues/368) (`ISS-STED-17`)

## 0. Hai câu hỏi tài liệu này trả lời

1. **Bốn khối `PID`/`HYSTERESIS`/`SCALE`/`DEADBAND` là gì?** Mở rộng của nhà
   sản xuất, **được giữ**, và **bắt buộc đánh dấu**.
2. **IEC có mà ta chưa có thì sao?** Bảng §3 nói từng mục: làm ở đợt nào, hay
   không làm và **vì sao**.

Điều tài liệu này **không** làm: nó không đặt mục tiêu phủ hết thư viện chuẩn.
`ADR-054` nói rõ *"ưu tiên theo nhu cầu HVAC thật, **không phủ chuẩn cho đủ**"*.
Một thư viện đầy hàm không ai gọi vẫn phải kiểm thử, vẫn phải chứng minh WCET,
và vẫn là bề mặt để hỏng.

## 1. Nguyên tắc chi phối

`ADR-054` giữ nguyên hai ràng buộc, và chúng là **bộ lọc đầu tiên** cho mọi
đề xuất bổ sung:

- **`P1` — chấm dứt trong thời gian chặn trên biết trước.** Loại mọi thứ có số
  bước phụ thuộc dữ liệu.
- **`P2` — không cấp phát khi chạy.** Loại mọi thứ cần bộ nhớ có kích thước chỉ
  biết lúc chạy.

Mọi mục ở §3 đã đi qua hai bộ lọc này; cột **P1/P2** ghi kết quả, không phải một
ô đánh dấu cho có.

## 2. Bốn khối mở rộng — giữ, và đánh dấu ở đâu

`ADR-054` điểm 3: nguyên tắc *"IEC có thì giữ, không có thì bỏ"* áp cho **cú
pháp/ngữ nghĩa ngôn ngữ**, **không** áp cho thư viện điều khiển. Cơ sở: IEC
61131-3 cho phép mở rộng nhà sản xuất miễn là **công bố rõ**.

| Khối | Vì sao giữ |
|---|---|
| `PID` | Khối điều khiển cốt lõi của DDC. Giữ nguyên cùng cổng review Controls/Safety (`ST-PID-001`, `st_review_gate_check`) — cổng **không đổi** |
| `HYSTERESIS` | So sánh có nhớ; ca dùng HVAC phổ biến |
| `SCALE` | Quy đổi tuyến tính raw ↔ engineering |
| `DEADBAND` | Vùng chết quanh setpoint |

**Nhãn phải tới nơi người dùng CHỌN khối**, không dừng ở tài liệu — vì người
dùng quyết định dùng khối nào ở màn hình chọn, không phải khi đọc tài liệu. Ba
nơi đó:

| Nơi | Cách hiện |
|---|---|
| Thư viện nhanh | huy hiệu `MỞ RỘNG` cạnh tên khối |
| Palette FBD | `iecClassification` trên từng entry palette |
| Gợi ý ST | dòng mô tả ghi *"mở rộng Mekong — không thuộc IEC"* |

Phân loại **sinh tự động** từ danh sách `vendorExtensions` của hồ sơ ngôn ngữ —
không có cột chép tay nào trong registry. Một bản chép sẽ trôi khỏi hồ sơ đúng
vào ngày ai đó thêm khối mở rộng thứ năm.

POU do người dùng định nghĩa nhận `null`, **không** nhận nhãn nào: nó không
thuộc IEC lẫn thư viện Mekong, và gắn một trong hai nhãn là nói sai.

## 3. IEC có, ta chưa có — làm gì, không làm gì

### 3.1 Đợt 1 — bốn mục rẻ và hay dùng

`ADR-054` đề nghị xét trước bốn mục này. Cả bốn qua `P1`/`P2` **không cần điều
kiện gì thêm**: số bước cố định, không cấp phát, không phụ thuộc kiểu hợp thành.

| Mục | Ca dùng HVAC thật | Ước lượng | P1/P2 |
|---|---|---|---|
| `RS` / `SR` | Chốt trạng thái báo động: một sự kiện set, một điều kiện reset, cần biết bên nào thắng | **nhỏ** — hai FB không trạng thái ngoài một `BOOL`; dùng lại khuôn `R_TRIG` | ✅ / ✅ |
| `CTUD` | Đếm hai chiều (số lần khởi động máy nén trong ca, tăng/giảm) | **nhỏ** — `CTU` và `CTD` đã có; cái mới là ngữ nghĩa `LD`/`PV` đồng thời | ✅ / ✅ |
| `MUX` | Chọn một trong N setpoint theo chế độ vận hành | **nhỏ–vừa** — arity thay đổi là điểm mới với bảng hàm hiện tại | ✅ / ✅ |
| `TRUNC` | Cắt phần thập phân khi ghi ra thiết bị chỉ nhận nguyên | **rất nhỏ** — một phép, ngữ nghĩa làm tròn phải công bố rõ | ✅ / ✅ |

**Thứ tự ưu tiên trong đợt 1:** `RS`/`SR` → `CTUD` → `TRUNC` → `MUX`.
`RS`/`SR` đứng đầu vì chốt báo động là ca dùng có mặt ở gần như mọi dự án và
hiện đang phải viết tay bằng `IF` + biến `RETAIN` — tức người dùng **đang** làm
việc đó, chỉ là bằng cách dài dòng hơn và dễ nhầm bên ưu tiên hơn. `MUX` xuống
cuối vì arity thay đổi chạm bảng hàm, tức chạm IR — đắt hơn ba mục kia.

### 3.2 Đợt sau — có lý do chờ, không phải bỏ

| Mục | Vì sao chưa làm bây giờ |
|---|---|
| `MOVE` | Phép gán `:=` đã làm đúng việc này cho kiểu vô hướng. `MOVE` chỉ có giá trị riêng khi có kiểu hợp thành — chờ `ARRAY`/`STRUCT` của [#367](https://github.com/Mekong-HCM/MK-DDC-24/issues/367) |
| `SHL`/`SHR`/`ROL`/`ROR` | Cần kiểu chuỗi bit (`BYTE`/`WORD`/`DWORD`), thuộc đợt sau của `ADR-054` điểm 5. Không có kiểu để dịch thì hàm dịch không có miền xác định |
| `SEMA` | Semaphore giả định nhiều luồng tranh chấp. Rev A chạy **một task tuần tự**, nên khối này không có vấn đề nào để giải mà chỉ thêm một đường chặn scan. Xét lại nếu và chỉ nếu mô hình thực thi đổi |

### 3.3 Không làm — kèm lý do, không để trống

| Mục | Lý do | Vi phạm |
|---|---|---|
| `LN`, `LOG`, `EXP` | Hàm siêu việt trên FPU mềm của target không có chặn trên chi phí tất định; không có ca dùng HVAC nào trong Rev A cần logarit | **P1** |
| `SIN`, `COS`, `TAN`, `ASIN`, `ACOS`, `ATAN` | Cùng lý do; thêm điểm kỳ dị (`TAN` tại π/2) và miền xác định (`ASIN`) phải xử lý riêng cho chính sách NaN/Inf §6.3 | **P1** |
| `EXPT` | Dạng hàm của toán tử `**` đã bị loại (`ST_SUBSET_SPEC` §9 D10); giữ một trong hai sẽ mở lại đúng chi phí mà việc loại `**` muốn tránh | **P1** |
| Toàn bộ hàm chuỗi (`LEN`, `LEFT`, `RIGHT`, `MID`, `CONCAT`, `INSERT`, `DELETE`, `REPLACE`, `FIND`) | Phụ thuộc `STRING`, mà `STRING` độ dài biến kéo theo cấp phát động trong chu kỳ scan. `CONCAT` là ca rõ nhất: độ dài kết quả chỉ biết lúc chạy | **P2** |
| `ROUND` | IEC không quy định chế độ làm tròn thống nhất giữa các hãng; `REAL_TO_INT` hiện có đã công bố rõ quy tắc ở §3.5. Thêm `ROUND` là thêm một quy tắc thứ hai cho cùng một việc, và hai quy tắc làm tròn trong một ngôn ngữ điều khiển là một nguồn lệch số không ai truy được | — (quyết định sản phẩm) |

Mỗi dòng ở đây đã đi vào `deliberateExclusions` của hồ sơ ngôn ngữ
(`ISS-STED-08`), nên chúng **được cổng đối chiếu kiểm**: khai loại trừ một hàm
mà compiler thật sự có sẽ làm đỏ.

## 4. Điều tài liệu này không quyết

Bảng §3.1 là **đề xuất ưu tiên**, không phải cam kết lịch. Mỗi mục khi thi hành
vẫn cần issue riêng với thiết kế ngữ nghĩa của nó — đặc biệt `MUX` (arity thay
đổi) và `CTUD` (`LD` và `PV` cùng lúc), hai chỗ dễ chọn sai ngữ nghĩa mà vẫn
chạy được.
