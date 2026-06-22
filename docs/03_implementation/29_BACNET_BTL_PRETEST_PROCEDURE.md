
# 29 — BACnet BTL Pretest Procedure
## MK-DDC-24 — Quy trình tự kiểm nghiệm tương thích BACnet (Pre-conformance Testing)

> **Document ID:** VAL-BACNET-PRETEST-MK-DDC-24-VI  
> **Phiên bản:** 1.0 | 2026-06-19  
> **Trạng thái:** Active — SOP tự kiểm tra chuẩn BACnet trước khi gửi lab BTL  
> **Owner:** QA + Dev SOM  

---

## 1. Mục tiêu
Đảm bảo ngăn xếp giao thức BACnet/IP chạy trên `mkddc-iobus` tương thích hoàn toàn với tiêu chuẩn thiết bị thông minh BACnet (B-ASC profile) và vượt qua các bài test tự động trước khi đăng ký chứng nhận BTL (BACnet Testing Laboratories).

---

## 2. Công cụ và Tài liệu chuẩn bị
1. **Virtual Test Shell (VTS):** Công cụ test BACnet mã nguồn mở từ ASHRAE (VTS v3.x).
2. **BACnet Test Tool (BTT):** Công cụ giả lập test suite của BTL.
3. **PICS (Protocol Implementation Conformance Statement):** Tài liệu đặc tả các thuộc tính và dịch vụ BACnet thiết bị hỗ trợ.
4. **EPICS (Electronic PICS):** File cấu hình định dạng `.tpi` hoặc `.txt` để nạp vào VTS chạy test tự động.

---

## 3. Quy trình thực hiện Pretest

### Bước 1 — Chạy BACnet Smoke Test Nội Bộ
- Đảm bảo tính năng BACnet đã được compile trên `mkddc-iobus`:
  ```bash
  cmake -S services -B build/services -DMKDDC_ENABLE_BACNET=ON
  ```
- Khởi động hệ thống `mkddc-iobus` và sử dụng `bacnet-tools` (ví dụ `bacwi`, `bacrp`, `bacwp`) từ một máy tính trong cùng mạng LAN để quét tìm thiết bị:
  ```bash
  # Quét tìm thiết bị qua Who-Is (Device ID mặc định, ví dụ 1234)
  bacwi -1
  # Đọc thuộc tính Device Object Name
  bacrp 1234 8 1234 77
  ```
- **Tiêu chí:** Thiết bị phản hồi gói I-Am chứa Device ID chính xác, đọc thành công thông tin cấu trúc Object Table.

### Bước 2 — Thiết lập VTS (Virtual Test Shell)
1. Cài đặt phần mềm VTS trên máy test (Windows).
2. Kết nối máy test chung mạng LAN vật lý hoặc mạng ảo (PTY/veth) với SOM.
3. Cấu hình cổng kết nối IP Port trong VTS, trỏ tới địa chỉ IP của board SOM.
4. Tạo Device Definition trong VTS khớp với PICS của MK-DDC-24.

### Bước 3 — Thực thi các Script Kiểm thử (BTL Test Cases)
Chạy các kịch bản test case bắt buộc đối với B-ASC profile trong VTS:

| ID kịch bản | Tên bài test | Mô tả hành động |
| --- | --- | --- |
| **TC-DM-DDB-B** | Device Management-Dynamic Device Binding | Xác nhận phản hồi dịch vụ Who-Is / I-Am |
| **TC-DM-DOB-B** | Device Management-Dynamic Object Binding | Xác nhận phản hồi dịch vụ Who-Has / I-Have |
| **TC-DS-RP-B** | Data Sharing-ReadProperty-B | Đọc thuộc tính (Present_Value, Status_Flags, Reliability) của các đối tượng AI, AO, DI, DO, AV, BV |
| **TC-DS-WP-B** | Data Sharing-WriteProperty-B | Ghi giá trị Present_Value của AO, DO, AV, BV; kiểm tra cơ chế giải chấp ưu tiên (Relinquish Default / Priority Array) |
| **TC-DS-COV-B** | Data Sharing-COV-B | Kiểm tra đăng ký nhận thông báo thay đổi giá trị (Change of Value) từ VTS và nhận thông báo chính xác |

---

## 4. Danh mục PICS/EPICS cần hoàn thiện
Trước khi gửi kiểm định, phải hoàn tất hồ sơ thông tin PICS bao gồm:
- **BACnet Protocol Revision:** 18 (hoặc phiên bản tương đương được hỗ trợ).
- **Supported BACnet Interoperability Building Blocks (BIBBs):**
  - Data Sharing: `DS-RP-B`, `DS-RPM-B`, `DS-WP-B`, `DS-COV-B`.
  - Device Management: `DM-DDB-B`, `DM-DOB-B`, `DM-DCC-B`, `DM-RD-B` (ReinitializeDevice).
- **Object Types Supported:**
  - Analog Input (AI), Analog Output (AO), Analog Value (AV).
  - Binary Input (BI), Binary Output (BO), Binary Value (BV).
  - Multi-state Value (MSV).
  - Device Object.

---

## 5. Báo cáo nghiệm thu (Deliverables)
1. **File EPICS (`mkddc_conformance.tpi`):** File mô tả chi tiết tất cả object và property phục vụ VTS.
2. **VTS Packet Capture Log (`vts_conformance_run.vts`):** Bản ghi đầy đủ toàn bộ gói tin tương tác trong suốt quá trình chạy test case.
3. **Compatibility Summary (`bacnet_compatibility_report.md`):** Liệt kê danh sách các điểm bất tương thích phát hiện trong quá trình test và kết quả khắc phục (nếu có).
