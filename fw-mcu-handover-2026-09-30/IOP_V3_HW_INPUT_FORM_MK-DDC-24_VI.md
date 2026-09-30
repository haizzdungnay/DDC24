# Phiếu đầu vào HW cho tích hợp IOP V3.0

**Document ID:** IOP-HW-IN-MK-DDC-24-VI

**Phiên bản:** 1.0

**Ngày:** 2026-09-30

**Trạng thái:** Mẫu yêu cầu thông tin; **chưa nhận hồ sơ chuẩn 8/8**, không phải thiết kế HW hoặc kết quả đo

**Chủ quản biểu mẫu:** System Architect; **bên cung cấp dữ liệu:** team HW

**Áp dụng:** lập riêng một bản đã điền cho từng revision của bo 16/4/4 và 16/8/8 trước G-MCU-2/3

**Nguồn:** [ICD V3.0](SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md) §2, §3, §7–§9, §15 và [yêu cầu FW MCU](FW_REQUIREMENTS_MK-DDC-24_VI.md) §4.9

## 1. Cách dùng và mẫu ghi

Team HW điền **giá trị, đơn vị, dung sai, revision, nguồn trang/sheet và người phê duyệt** cho từng mục. `CHƯA CÓ` nghĩa là chưa nhận bằng chứng; không được suy ra giá trị từ tài liệu bo 4/4 cũ để áp cho 8/8. Ví dụ cách ghi hình thức: `UART isolator: <part>; mức MCU: <V>; nguồn: SCH-8x8 Rev <x>, sheet <n>` — dấu `<...>` là ô cần điền, **không phải thông số sản phẩm**.

| Biến thể | Mã bo / revision | Schematic/BOM/pinout chuẩn | Tình trạng đầu vào |
|---|---|---|---|
| 16 UI / 4 AO / 4 DO | CHƯA ĐIỀN | CHƯA ĐIỀN | Chưa ghim revision và nguồn chuẩn trong gói này |
| 16 UI / 8 AO / 8 DO | CHƯA ĐIỀN | CHƯA CÓ | Chặn xác nhận vật lý và G-MCU-2/3 cho 8/8 |

## 2. Trường HW phải cung cấp cho từng revision

| ID | Trường cần điền | Nội dung tối thiểu / cách kiểm | Liên kết giao diện và cổng | Trạng thái |
|---|---|---|---|---|
| HWIF-01 | Định danh bo | Part number, revision, phương pháp nhận biến thể (chân, EEPROM, build image), bảng giá trị → `N_UI/N_AO/N_DO/N_DI` | ICD §2.1; FW-HW-004, FW-IOP-015; P2 | CHƯA CÓ |
| HWIF-02 | Tài liệu nguồn | Schematic, BOM, pinout, ECO, ngày hiệu lực, link hoặc mã bản phát hành, người duyệt HW | Mọi mục dưới; P2/P3 | CHƯA CÓ |
| HWIF-03 | UART IOP | USART/pin MCU và SOM, isolator, mức logic, nguồn miền, phân cực khi mất nguồn, giới hạn baud/sai số | ICD §3.1; FW-HW-003; P2 | CHƯA CÓ |
| HWIF-04 | `nRESET`, `BOOT0`, `FAULT_OUT` | Pin/hướng/mức tích cực, điện trở kéo, hành vi khi MCU mất nguồn hoặc đứt dây, thời gian reset | ICD §3.3; ICD-T-14; P2/P3 | CHƯA CÓ |
| HWIF-05 | UI1..UI16 | Mapping kênh → ADC/chân, mode 0–10 V/4–20 mA/NTC/dry-contact, giới hạn điện, mạch chọn mode và thời gian settle | ICD §6.1, §6.6; FW-IO-*; P3 | CHƯA CÓ |
| HWIF-06 | AO1..AO`N_AO` | Mapping DAC/chân/cực, 0–10 V và 4–20 mA, dải raw, dung sai ở cực, trạng thái khi reset/mất nguồn/VDD fault | ICD §6.2, §6.7; FW-AO-*; P3 | CHƯA CÓ |
| HWIF-07 | DO1..DO`N_DO` | Mapping drive/tiếp điểm, trạng thái safe, feedback relay có thật hay không, thời gian đóng/cắt, trạng thái mất nguồn | ICD §6.3, §6.7; `BOARD_FEATURES.DO_FB`; P3 | CHƯA CÓ |
| HWIF-08 | Nguồn và bảo vệ | Dải VDD cho MCU/DAC, giám sát nguồn, ngưỡng 3,0/3,6 V, brownout, ảnh hưởng tới safe output | ICD §6.1.2, §7.2; FW-DIAG-003/004; P3 | CHƯA CÓ |
| HWIF-09 | Chuyển output nguyên khối | Có latch/update đồng bộ cho 4/4 và 8/8? Chênh thời gian cực đại giữa các AO/DO, điểm đo, khả năng áp trước ACK và phản ứng khi một kênh ghi lỗi | O-9; ICD-R-05/07, ICD-T-06/15; phải kết luận ở P0, đo ở P3 | CHƯA CÓ |
| HWIF-10 | Thiết bị và đồ gá đo | Điểm probe UART, DAC, DO, `FAULT_OUT`; loại DAQ/logic analyzer, hiệu chuẩn, cách cắt nguồn an toàn | ICD-T-04/06/11/14/15; P2/P3 | CHƯA CÓ |

`BOARD_FEATURES.DO_FB` và số kênh trong các [ví dụ](IOP_V3_INTEGRATION_EXAMPLES_MK-DDC-24_VI.md) là fixture minh họa. Chỉ điền giá trị sản phẩm vào ICD/header sau khi có hồ sơ HW và review thay đổi.

## 3. Phản hồi và cổng

| Vai trò | Phản hồi bắt buộc | Khi nào coi là đóng |
|---|---|---|
| HW lead | Điền HWIF-01..10 theo **từng** revision bo, dẫn nguồn, kết luận O-9 và ký bản HW | Không còn `CHƯA CÓ` ở trường áp dụng; số kênh/tính năng có nguồn chuẩn |
| MCU lead | Xác nhận mapping image/biến thể và khả năng triển khai các giới hạn quan sát được | Có phản hồi bằng văn bản gắn revision bo và phiên bản ICD |
| SOM lead | Xác nhận cách cấu hình profile và tín hiệu `FAULT_OUT` trên phần cứng SOM | Không còn giả định cổng/chân không có nguồn |
| Safety | Duyệt safe value và giới hạn điện, kết luận rủi ro còn lại của O-9 | Có chữ ký/biên bản; mới được dùng để chấm G-MCU-3 |

**Tình trạng hiện tại:** phiếu chưa được HW điền; G-MCU-2/3 và mọi kết luận điện vật lý là `NOT RUN`/chờ hồ sơ. Đây không phải lý do để tự điền thông số giả.

## 4. Tự rà theo loại tài liệu

| Mục | Bằng chứng trong phiếu | Cổng còn cần |
|---|---|---|
| Metadata, chủ sở hữu, revision, phạm vi | Đầu file và §1 | HW điền mã bo/revision thật |
| Truy vết HW → ICD/FW test | HWIF-01..10, cột cổng | Team tiêu thụ xác nhận nguồn và khả năng đo |
| Mục mở có owner và điều kiện đóng | §3 | Chữ ký HW/MCU/SOM/Safety |

## Lịch sử sửa đổi

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-09-30 | Tạo phiếu đầu vào giao diện cho hai biến thể; để trống mọi thông số HW chưa có nguồn. |
