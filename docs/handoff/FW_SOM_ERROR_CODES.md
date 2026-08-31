# FW SOM — Danh mục mã lỗi

> **Document ID:** HANDOFF-ERRCODES-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-07-28
> **Đối tượng:** BE SOM

Mã lỗi là **hợp đồng ổn định**. BE map theo **mã**, không parse `message` —
message là tiếng Anh kỹ thuật và có thể đổi câu chữ bất cứ lúc nào.

## Bốn họ mã, biết ngay lỗi đến từ đâu

| Họ | Tầng | Khi nào gặp |
|---|---|---|
| `ST-*` | Compiler | Lúc validate/compile source |
| `IR-E-*` | Loader | Lúc runtime nạp artifact |
| `RT-RETAIN-*` | Retain store | Lúc khôi phục biến RETAIN |
| `API-E-*` | Control interface | Lúc gọi lệnh điều khiển |

Tách bốn họ là có chủ ý: BE biết lỗi thuộc tầng nào mà không cần phân tích
nội dung, nên định tuyến xử lý và hiển thị đúng chỗ ngay.

---

## 1. Compiler — `ST-*`

### Lexer

| Mã | Ý nghĩa | Người dùng phải làm gì |
|---|---|---|
| `ST-LEX-001` | Ký tự không hợp lệ | Xoá ký tự lạ |
| `ST-LEX-002` | Literal `TIME` sai định dạng | Viết đúng `T#1m30s`, đơn vị giảm dần, không lặp |
| `ST-LEX-003` | Chú thích `(*` không đóng | Thêm `*)` |

### Syntax

| Mã | Ý nghĩa | Người dùng phải làm gì |
|---|---|---|
| `ST-SYN-001` | Token không mong đợi | Sửa cú pháp tại dòng/cột báo về |
| `ST-SYN-002` | **Lồng quá sâu** | **Đơn giản hoá biểu thức** — đây là vượt giới hạn tài nguyên, KHÔNG phải lỗi gõ |

### Semantic

| Mã | Ý nghĩa |
|---|---|
| `ST-SEM-001` | Biến chưa khai báo |
| `ST-SEM-002` | Kiểu không khớp (không ép ngầm giữa biến — dùng `INT_TO_REAL`…) |
| `ST-SEM-003` | Gán vào `VAR_INPUT` (chỉ đọc) |
| `ST-SEM-004` | Khai báo trùng tên |
| `ST-SEM-005` | Kiểu không tồn tại |
| `ST-SEM-006` | Hàm không tồn tại |
| `ST-SEM-007` | Sai số lượng đối số |
| `ST-SEM-008` | Literal nguyên vượt miền `INT` |
| `ST-SEM-009` | Gán vào instance Function Block |
| `ST-SEM-010` | Gọi cùng một instance FB **nhiều hơn một lần** trong một chu kỳ |
| `ST-SEM-011` | Ghi vào đầu ra của FB |
| `ST-SEM-012` | Dùng hàm như instance FB, hoặc ngược lại |
| `ST-SEM-013` | Tham số FB không tồn tại/trùng, hoặc không dùng dạng đặt tên |
| `ST-SEM-014` | Kiểu không được phép `RETAIN` |

### Giới hạn tài nguyên

| Mã | Giới hạn |
|---|---|
| `ST-LIM-001` | Source > 64 KiB |
| `ST-LIM-002` | > 32 768 token |
| `ST-LIM-003` | > 512 biến |
| `ST-LIM-004` | > 4 096 statement |
| `ST-LIM-005` | Identifier > 64 ký tự |
| `ST-LIM-006` | Danh sách diagnostic bị cắt — **luôn là phần tử cuối**; BE thấy mã này thì biết **còn lỗi chưa hiển thị**, không được kết luận "hết lỗi" |
| `ST-LIM-007` | > 64 instance FB |
| `ST-LIM-008` | > 128 biến RETAIN |

### Runtime fault — `ST-RT-*`

Fault **không** làm crash `mkddc-core`. Nó kết thúc chu kỳ, **huỷ toàn bộ
staging** (không commit output nào), chuyển instance sang `FAULTED` và dừng
các Program còn lại trong cùng Task.

| Mã | Ý nghĩa |
|---|---|
| `ST-RT-001` | Tràn số `INT` (**fault**, không wrap im lặng) |
| `ST-RT-002` | Chia cho 0 |
| `ST-RT-003` | Chuyển kiểu ngoài miền |
| `ST-RT-004` | Kết quả `REAL` không hữu hạn |
| `ST-RT-005` | Kết quả `TIME` âm |
| `ST-RT-006` | `LIMIT` có `MN > MX` |
| `ST-RT-007` | `SQRT` đối số âm |
| `ST-RT-008` | Đầu vào process image không hữu hạn |

### Cảnh báo — `ST-WARN-*`

**Không chặn sinh artifact và không làm Check FAILED.** BE quyết định FAILED theo
`severity`, **không** theo `len(diagnostics) > 0`: một chương trình hợp lệ có biến
thừa vẫn phải PASSED kèm cảnh báo. Chính sách nâng cảnh báo thành lỗi là thuộc tính
của compiler profile (`ST_SUBSET_SPEC` §C0.6), không phải của ngôn ngữ.

| Mã | Ý nghĩa | Trạng thái |
|---|---|---|
| `ST-WARN-001` | `PT` của timer nhỏ hơn chu kỳ Task | **Chưa hiện thực** — compiler không nhận chu kỳ Task làm đầu vào (`periodMs` chỉ có trên đường runtime), mọi phán quyết sẽ là đoán mò. Mã giữ trong catalog để tài liệu và nguồn có một nguồn duy nhất |
| `ST-WARN-002` | Biến khai báo nhưng không dùng | Đã phát (`#351`) |
| `ST-WARN-003` | `VAR_OUTPUT` không bao giờ được gán | Đã phát (`#351`) |
| `ST-WARN-004` | Đọc output của một instance FB **trước** lời gọi của nó trong cùng chu kỳ ⇒ đọc ra giá trị **chu kỳ trước** (`DDD-LANG-PROG-001` §4.3). Hợp lệ và đôi khi cố ý, nhưng gần như luôn là nhầm lẫn | Đã phát (`#351`) |

Phân biệt với `ST-SEM-010`: gọi **hai lần** một instance trong một chu kỳ là **lỗi**;
**đọc trước khi gọi** chỉ là cảnh báo.

---

## 2. Loader — `IR-E-*`

**Bất biến: mọi lỗi load đều GIỮ NGUYÊN package đang chạy.** Không có mã nào
dẫn tới trạng thái "không có chương trình nào chạy" nếu trước đó đã có.

| Mã | Ý nghĩa | BE retry được? | Hướng xử lý |
|---|---|---|---|
| `IR-E-001` | Kích thước/header sai | ❌ | Gói hỏng — compile lại |
| `IR-E-002` | Magic sai | ❌ | Không phải artifact MK-DDC |
| `IR-E-003` | `schema_version` không hỗ trợ | ❌ | **Nâng cấp firmware SOM** |
| `IR-E-004` | `target_abi` không khớp | ❌ | Sai target — compile lại đúng target |
| `IR-E-005` | SHA-256 sai | ✅ | Truyền lỗi hoặc gói bị sửa — **tải lại** |
| `IR-E-006` | Chữ ký sai | ❌ | Gói không do bên có khoá ký |
| `IR-E-007` | Thiếu chữ ký | ❌ | Ký lại gói |
| `IR-E-008` | Bảng section không hợp lệ | ❌ | Gói hỏng |
| `IR-E-009` | Thiếu section bắt buộc | ❌ | Gói hỏng |
| `IR-E-010` | Vượt giới hạn tài nguyên | ❌ | **Sửa chương trình** cho nhỏ lại |
| `IR-E-011` | Bảng dữ liệu không hợp lệ | ❌ | Gói hỏng |
| `IR-E-012` | IO binding sai/tranh chấp đầu ra | ❌ | Sửa `io_map` |
| `IR-E-013` | `compiler_profile` không hỗ trợ | ❌ | Nâng cấp firmware SOM |
| `IR-E-014` | Mã lệnh không hợp lệ | ❌ | Gói hỏng |
| `IR-E-015` | Không cấp phát được bộ nhớ | ✅ | Thử lại sau |

---

## 3. Retain — `RT-RETAIN-*`

Bản ghi bị từ chối → **cold start với giá trị khởi tạo + chẩn đoán**. Không
bao giờ là lý do để không khởi động chương trình.

| Mã | Nguyên nhân | Ý nghĩa vận hành |
|---|---|---|
| `RT-RETAIN-001` | Magic/version sai | File không phải bản ghi retain hợp lệ |
| `RT-RETAIN-002` | CRC sai | **Nghi mất điện khi đang ghi** |
| `RT-RETAIN-003` | `layout_hash` khác | **Chương trình đã đổi biến RETAIN** — mất giá trị là đúng ý đồ |
| `RT-RETAIN-004` | `record_size` không khớp | Bản ghi không tương thích |

`RT-RETAIN-002` và `RT-RETAIN-003` cần phân biệt rõ khi báo cho người vận
hành: một cái là sự cố phần cứng/điện, cái kia là hệ quả bình thường của việc
sửa chương trình.

---

## 4. Control interface — `API-E-*`

Mọi response lỗi đều có `keepsRunningPackage`.

| Mã | Ý nghĩa | `keepsRunningPackage` |
|---|---|---|
| `API-E-001` | JSON hỏng hoặc thiếu field bắt buộc | `true` |
| `API-E-002` | Action không tồn tại | `true` |
| `API-E-003` | `instanceId` không tồn tại | `true` |
| `API-E-004` | Lệnh không hợp lệ ở trạng thái hiện tại | `true` |
| `API-E-005` | Artifact base64 hỏng hoặc quá lớn | `true` |
| `API-E-006` | Loader từ chối (xem `detailCode` = `IR-E-*`) | `true` |
| `API-E-007` | Lỗi nội bộ | `true` |

---

## Quy tắc thêm mã mới

Nối vào **cuối** mỗi họ, **không** đổi số cũ. Mã đã publish là hợp đồng: đổi
ý nghĩa của một mã đang dùng sẽ làm BE xử lý sai mà không ai phát hiện được
bằng compile hay test.
