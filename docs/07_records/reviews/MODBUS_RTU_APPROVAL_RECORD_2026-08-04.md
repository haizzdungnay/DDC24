# Biên bản phê duyệt — Modbus RTU

**ID:** DDC24-MBRTU-APPROVAL-2026-08-04
**Ngày phê duyệt:** 2026-08-04
**Người phê duyệt:** PM · CTO
**Phạm vi:** Modbus RTU Rev A
**Thay thế:** phần "Trạng thái" của
[Phiếu xác nhận Track B](MODBUS_RTU_TRACKB_SIGNOFF_2026-08-04.md) và các mục
`OPEN` tương ứng trong
[Modbus RTU Open Decisions](../../00_governance/MODBUS_RTU_OPEN_DECISIONS.md)

> Biên bản này ghi lại **quyết định đã ký**. Nó là authority để đóng các
> `OD-MBRTU-*` và để khởi động Track A.

## 1. Gate được phê duyệt

```text
TRACK_A_APPROVED            = YES
TRACK_B_APPROVED            = CONDITIONAL
MODBUS_RTU_PRODUCTION_READY = NO
```

Track A được phép triển khai ngay. Track B **chỉ** bắt đầu sau khi đủ ba điều kiện:

1. HW đóng `Q-01` (số cổng) và `Q-10` (cơ chế điều hướng RS-485);
2. tài liệu được đồng bộ theo các quyết định ở §2;
3. PM thống nhất **một** mức ước lượng duy nhất.

> **Điều kiện 3 đã xử lý 2026-08-04:** báo cáo trước đó ghi cả `8–11` và `11–14`
> người-ngày cho Track A. Con số đúng và duy nhất từ nay là **13,25 người-ngày**
> (29 task, bảng §6.1 Plan 49). Track B là **40–51 người-ngày**.

## 2. Mười một quyết định đã ký

| # | Quyết định | Đóng mục |
|---|---|---|
| Đ-01 | **Rev A dùng 01 cổng Modbus RTU.** Chỉ mở cổng thứ hai khi phần cứng xác nhận có transceiver và đường đấu nối thực tế. | `OD-MBRTU-001` → **CLOSED (1 cổng)**; `OD-MBRTU-002` → không còn áp dụng ở Rev A |
| Đ-02 | **HW phải xác nhận cơ chế RS485 direction control** — tự động hay GPIO — kèm số chân và schematic. | `Q-10` / `G-D` → **giao HW, còn mở** |
| Đ-03 | **Chấp thuận thay đổi giao diện dữ liệu nội bộ Core–IOBus–Web.** Ba service phải nâng cấp và đóng gói **cùng phiên bản**. | `OD-MBRTU-015` → **CLOSED (chấp thuận)** |
| Đ-04 | **Rev A giữ ba role.** Viewer: được xem. Operator: test kết nối và đọc thử. Admin: cấu hình và ghi register. | `OD-MBRTU-009` → **CLOSED (3 role)** |
| Đ-05 | **Retry phải được implement đúng nghĩa** — thử lại giao dịch, không chỉ là ngưỡng offline. | `Q-04` → **CLOSED (phương án B)** |
| Đ-06 | **Bắt buộc có:** test connection · read test · write test có xác nhận và audit · import CSV · export CSV/JSON. | `Q-07`, `Q-08`, `OD-MBRTU-012` → **CLOSED (bắt buộc, CSV + JSON)** |
| Đ-07 | **Nâng giới hạn Modbus RTU từ 64 lên tối thiểu 256 Point**, thực hiện **cùng đợt** thay đổi interface nội bộ. | `OD-MBRTU-011` → **CLOSED (≥256)** |
| Đ-08 | **Mua tối thiểu một đồng hồ điện và một biến tần Modbus RTU** để nghiệm thu vật lý. | `Q-05` / `OD-MBRTU-EXT-02` → **CLOSED (đồng ý cấp)** |
| Đ-09 | **PM chỉ định Fieldbus Lead và QA/HIL Lead trước khi bắt đầu Track B.** | `Q-06` / `OD-MBRTU-EXT-01` → **còn mở, chặn Track B** |
| Đ-10 | **Mở finding riêng và sửa toàn bộ tài liệu nền tảng** sang Forlinx OK1126B-S / RV1126B. | `Q-11` → **CLOSED (mở finding)** |
| Đ-11 | **Cấm thay đổi cấu hình Modbus trong giờ hệ thống vận hành** cho tới khi Track B hoàn thành. | ràng buộc vận hành, hiệu lực ngay |

## 3. Hệ quả kỹ thuật cần xử lý

### 3.1 Đ-01 — một cổng: tài liệu phải sửa

| Tài liệu | Nội dung phải đổi |
|---|---|
| `PRODUCT.md` | `2 × Modbus RTU` → `1 × Modbus RTU` ở Rev A |
| `REQUIREMENTS.md` `SYS-REQ-MBRTU-001` | bỏ "đúng hai cổng logic RS485-1/RS485-2" |
| `DDD-DM-MBRTU-001` | Bus vẫn là entity nhưng chỉ có một instance ở Rev A |
| `DDD-FW-MBRTU-001` | một BusWorker; giữ kiến trúc đa-worker để mở rộng sau |
| `UX-WEB-MBRTU-001` | bỏ lựa chọn RS485-1/RS485-2 khỏi form Device |
| `VVP-MBRTU-001` | `TC-MBRTU-S-10`, `H-06` (hai bus đồng thời) → hoãn sang khi có cổng thứ hai |

**Lưu ý kiến trúc:** giữ nguyên khái niệm `bus_id` trong contract và mô hình dữ
liệu dù Rev A chỉ có một bus. Bỏ hẳn khái niệm này sẽ khiến việc thêm cổng thứ hai
sau này trở thành thay đổi ABI lần nữa.

### 3.2 Đ-07 — 256 Point: tác động cần tính trước

Nâng `KX_N_EXT` từ 64 lên 256 làm tăng kích thước cấu trúc chia sẻ:

| Hạng mục | 64 Point | 256 Point |
|---|---:|---:|
| Vùng `ext[]` trong PLC SHM | ~2,5 KB | ~10 KB |
| Datagram snapshot iobus → core | ~2,6 KB | ~10,3 KB |

Hai điểm phải kiểm chứng trong Track B, **không** được giả định:

1. Datagram ~10 KB qua Unix `SOCK_DGRAM` phải kiểm tra giới hạn buffer nhận của
   socket; nếu vượt thì phải chia mảnh hoặc chuyển sang stream. Có test riêng.
2. Thời gian copy snapshot mỗi vòng scan tăng ~4 lần — phải đo lại trên board
   Foxlinx với MCU thật để bảo đảm không ảnh hưởng chu kỳ IOP.

### 3.3 Đ-04 — ba role: phân quyền cụ thể

| Hành động | Viewer | Operator | Admin |
|---|:--:|:--:|:--:|
| Xem Device/Point/diagnostics | ✔ | ✔ | ✔ |
| Test kết nối | ✖ | ✔ | ✔ |
| Đọc thử register | ✖ | ✔ | ✔ |
| Thêm/sửa/xoá Device, Point | ✖ | ✖ | ✔ |
| Import/Export | ✖ | ✖ | ✔ |
| Apply/Rollback cấu hình | ✖ | ✖ | ✔ |
| **Ghi thử register** | ✖ | ✖ | ✔ |

Khác đề xuất ban đầu ở một điểm: **không** thêm vai trò `engineer`. Quyền cấu hình
và quyền ghi register **cùng thuộc Admin** ở Rev A.

### 3.4 Đ-05 — retry đúng nghĩa

Ngữ nghĩa chốt: `retry_count` = **số lần phát lại một giao dịch Modbus bị lỗi**
trước khi tính lượt poll đó là thất bại. Ngưỡng chuyển OFFLINE tách thành tham số
riêng. Counter `retry_attempts` đếm số lần phát lại thật, do đó **phải khác**
`total_errors`.

## 4. Việc bắt đầu ngay (Track A)

Theo Plan 49 §3, thứ tự: A1 (encode an toàn) → A2 (vòng đời write) → A3 (lịch poll)
→ A4 (retry thật) → A5 (FE) → A6 (dọn nợ). Tiến độ cập nhật tại Plan 49 §9.

## 5. Việc còn chặn Track B

| Mục | Người chịu trách nhiệm |
|---|---|
| Q-01 — schematic xác nhận số transceiver RS-485 | Hardware Lead |
| Q-10 / Đ-02 — cơ chế direction control + số chân | Hardware Lead |
| Đ-09 — chỉ định Fieldbus Lead và QA/HIL Lead | PM |
| Đồng bộ tài liệu theo §3.1 | Engineering |

## Revision history

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-04 | Ghi nhận phê duyệt PM/CTO: Track A YES, Track B CONDITIONAL, 11 quyết định |
