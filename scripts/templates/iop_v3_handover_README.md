# MK-DDC-24 — Gói rà soát tích hợp IOP V3.0

**Mã gói:** IOP-HANDOVER-MK-DDC-24-VI

**Bản gói:** R3 (2026-09-30)

**Người nhận:** team HW, FW MCU và SOM; System Architect/Safety phê duyệt các mục liên quan

**Trạng thái:** Draft, chưa ký, chưa gửi; gói tài liệu và kế hoạch kiểm, **không phải** kết quả phần cứng hoặc hồ sơ chứng nhận ISO

**Commit nguồn tài liệu:** `@SOURCE_COMMIT@`; SHA-256 từng file ở [NGUON_GOC.md](NGUON_GOC.md), kiểm bằng [MANIFEST.sha256](MANIFEST.sha256).

## 1. Mục tiêu và thứ tự đọc

Một giao thức IOP V3.0 cho cả profile 16 UI / 4 AO / 4 DO và 16 UI / 8 AO / 8 DO. V2.x chỉ là source/lịch sử chưa chuyển; **không** là đường fallback ở P1–P3. Gói chứa **tài liệu giao diện tích hợp**, không chứa thiết kế mạch hoặc kiến trúc firmware bên trong MCU.

| Thứ tự | Tài liệu | Mã / vai trò | Trạng thái |
|---:|---|---|---|
| 1 | [ICD SOM ↔ MCU](SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md) | `IOP-SPEC-MK-DDC-24-VI` v3.0; byte, hành vi, trạng thái, thời gian, 21 vector, 16 bài kiểm | Draft, chờ SOM/MCU/Safety ký |
| 2 | [Yêu cầu FW MCU](FW_REQUIREMENTS_MK-DDC-24_VI.md) | `FW-REQ-MK-DDC-24-VI` v3.1; 74 yêu cầu hộp đen, cổng nghiệm thu | Draft, chờ MCU/SOM/Safety ký |
| 3 | [Header byte nháp](iop_protocol_v3_DRAFT.h) | Hằng số và CRC cho kiểm host; chưa là contract production | DRAFT |
| 4 | [Ví dụ tích hợp](IOP_V3_INTEGRATION_EXAMPLES_MK-DDC-24_VI.md) | `IOP-EX-MK-DDC-24-VI` v1.0; EX-01 4/4, EX-02 8/8, EX-03 mất poll/RESYNC | Minh họa, chưa đo bo |
| 5 | [Kế hoạch và ma trận kiểm chứng](IOP_V3_VERIFICATION_PLAN_MK-DDC-24_VI.md) | `IOP-VVP-MK-DDC-24-VI` v1.0; 16 quy trình ICD, 8 nhóm FW, ma trận 74/74 và 5 rủi ro giao diện | Mọi Test Result `NOT RUN`; rủi ro chưa được Safety chấp nhận |
| 6 | [Phiếu đầu vào HW](IOP_V3_HW_INPUT_FORM_MK-DDC-24_VI.md) | `IOP-HW-IN-MK-DDC-24-VI` v1.0; thông tin cần cho từng revision bo | Chưa nhận hồ sơ chuẩn 8/8 |
| 7 | [Sổ tay toàn bộ lệnh](IOP_V3_COMMAND_REFERENCE_MK-DDC-24_VI.md) | `IOP-CMD-GUIDE-MK-DDC-24-VI` v1.0; 16 CMD, 41 frame, 4 đầu vào lỗi, payload/bitfield và luồng vận hành | Fixture host, chưa đo bo |

Bốn hình SVG đọc ngoại tuyến và file DOT nguồn nằm trong `assets/iop-v3/`: ranh giới, xử lý frame, RESYNC và mốc thời gian. Các hình thể hiện **hợp đồng logic/giới hạn thiết kế**, không phải pinout hoặc số đo thực tế.

## 2. Phản hồi cần nhận

| Bên | Phản hồi cụ thể | Cổng |
|---|---|---|
| HW | Điền HWIF-01..10 cho **từng revision** 4/4 và 8/8: schematic/BOM/pinout, nhận biến thể, UART/đường điều khiển, giới hạn điện, safe khi reset/mất nguồn và khả năng chuyển AO/DO nguyên khối. Dẫn trang tài liệu và người duyệt. | O-9 cần kết luận P0; hồ sơ vật lý và giới hạn điện cần trước P2/P3 |
| FW MCU | Rà ICD/header và EX-01..03, phản hồi khả năng đạt safe 200–205 ms, thời gian ACK, lưu cấu hình, 2 profile và O-9; cung cấp bản host PTY, test log và image/release note. | Ký P0; chạy P1–P3 |
| SOM | Xác nhận profile cấu hình, chặn output khi sai biến thể, RESYNC; lập và thực hiện chuyển iobus/fake MCU/consumer từ V2 sang V3 **ở đầu P1 trước test host**. | Ký P0; kiểm cặp P1 |
| System Architect/Safety | Chốt O-1/O-3/O-4/O-5/O-9, duyệt safe value/giới hạn HW và quyết định phát hành baseline. | P0 và P3 |

Ví dụ điểm cần hai phía thống nhất: trên bo 4/4, `SET_AO` **vẫn 16 byte** và AO5..AO8 bằng 0; `SET_DO MASK=0x0F` mới phủ đủ 4 DO. `HANDSHAKE_RESP` khai 16/8/8/0 khi SOM cấu hình 4/4 thì SOM phải giữ safe và không gửi lệnh output.

## 3. Điều kiện ra và giới hạn bằng chứng

| Mốc | Điều kiện thực tế | Trạng thái hiện tại |
|---|---|---|
| Tài liệu sẵn sàng review | Link/manifest sạch; 3 ví dụ tích hợp, sổ tay 16 CMD, 4 hình, 74/74 mapping, 16 quy trình, các mục mở có owner/cổng | Tự kiểm bằng script; cần team tiêu thụ review |
| P0 | Các quyết định liên quan safe/O-9 đóng, ICD/FW-REQ và header được ghim/ký | Chưa ký |
| P1 | Source hai phía V3.0; test host 4/4 và 8/8 có log thật | `NOT RUN` |
| P2/P3 | Có hồ sơ HW từng revision, bo thật, thiết bị hiệu chuẩn và kết quả UART/HIL | `BLOCKED`/`NOT RUN` |

Theo quy tắc `DOC-GOV-001` của repo, “ISO-aligned” là mục tiêu cấu trúc và truy vết, **không** đồng nghĩa chứng nhận ISO. Chữ ký của team tiêu thụ mới đóng review; vector/host không thay kết quả vật lý.

## 4. Kiểm toàn vẹn và nguồn gốc

Trong thư mục gói chạy `sha256sum -c MANIFEST.sha256`; ZIP được dựng theo thứ tự và timestamp cố định. [NGUON_GOC.md](NGUON_GOC.md) nối file nguồn/commit và SHA-256 với bản trong gói. Link tới tài liệu ngoài gói trong bản sao Markdown được chuyển thành chú thích văn bản; bản nguồn trong repo vẫn giữ link. Không thay đổi byte, vector hoặc tiêu chí khi đóng gói.

## Lịch sử

| Bản gói | Ngày | Thay đổi |
|---|---|---|
| R3 | 2026-09-30 | Thêm sổ tay toàn bộ 16 CMD, 41 frame đầy đủ CRC, 4 đầu vào lỗi và đường tra cứu; giữ giao thức V3.0. |
| R2 | 2026-09-30 | Thêm ví dụ, SVG/DOT, phiếu HW, ma trận/quy trình kiểm; sửa P0/P1 và ghim commit nguồn. |
| R1 | 2026-09-30 | Ba file nội dung ban đầu; chưa gửi. |
