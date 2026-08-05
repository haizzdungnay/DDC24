BẢNG TỔNG HỢP TOÀN BỘ ĐỀ XUẤT CẢI TIẾN, TỐI ƯU UI/UX & PRODUCT BACKLOG CHO THIẾT BỊ DDC-24

1. TỔNG QUAN ĐỊNH HƯỚNG ĐỀ XUẤT
Tài liệu này tổng hợp toàn bộ các đề xuất cải tiến kỹ thuật, giải pháp kiến trúc phần mềm, quy chuẩn thiết kế giao diện HMI công nghiệp (ISA-101 & WCAG 2.1 AA) và Product Backlog gồm 32 Hạng mục Chi tiết (BL-001 đến BL-035, đã loại bỏ các ứng dụng chuyên dụng không phù hợp) dành cho thiết bị DDC-24.


2. DANH MỤC 32 PRODUCT BACKLOG ITEMS PHÂN LOẠI THEO ƯU TIÊN
2.1 Nhóm P0 (Critical - 8 Hạng mục Bắt buộc Trước khi Thử nghiệm Thực tế)
ID
Hạng mục Đề xuất
Mô tả Kỹ thuật Chi tiết
Source Finding
Acceptance Criteria (AC)
Trạng thái
BL-001
Quảng bá mDNS & IP Tĩnh Fallback
Đảm bảo daemon Avahi/mDNS quảng bá hostname orangepi5b.local đúng trên LAN và cung cấp tùy chọn IP tĩnh fallback.
FIND-001
Truy cập Web HMI mượt mà qua cả mDNS hostname và IP tĩnh.
IN_PROGRESS
BL-002
Hộp thoại Khóa An toàn Điều khiển DO
Thêm Confirmation Dialog 2 bước khi người dùng thao tác gạt công tắc bật/tắt Digital Output trên Monitoring.
FIND-MON-003
Nhấn Toggle hiển thị Modal "Xác nhận [BẬT/TẮT] thiết bị DO-xx".
OPEN
BL-003
Đồng bộ Thời gian RTC Clock
Đồng bộ thời gian RTC phần cứng hiển thị trên thẻ Device Information trùng khớp với Header Time.
FIND-DASH-001
Thời gian trên Header và Device Info Card trùng khớp tuyệt đối.
OPEN
BL-004
Khắc phục Dịch vụ Historian v2
Sửa lỗi historian v2 query unavailable làm sập hiển thị đồ thị Trends lịch sử.
FIND-TRND-001
Đồ thị Trends render mượt mà khi chọn dải thời gian 30m, 1h, 6h, 24h.
OPEN
BL-005
Safety Confirmation Nút Test
Pop-up cảnh báo xác nhận 2 bước khi nhấn nút Test ép ngõ ra AO/DO trên trang Commissioning.
FIND-COMM-001
Mọi lệnh Test ép ngõ ra phải qua Modal xác nhận 2 bước.
OPEN
BL-021
Password Re-auth khi Reboot/Reset
Yêu cầu nhập lại mật khẩu Admin trước khi thực thi lệnh Reboot Controller hoặc Factory Reset.
FIND-DEV-001
Hiển thị Dialog yêu cầu nhập Password Admin trước khi Reboot.
OPEN
BL-026
Cascaded PID Control Loop VAV
Tích hợp thuật toán PID chuỗi (Room Temp PID -> Airflow Setpoint -> Damper PID) cho VAV Box Pressure-Independent.
FIND-VAV-001
VAV Damper điều tiết mượt mà theo lưu lượng gió không bị Hunting.
OPEN
BL-029
Pump Lead/Lag & Auto-Failover Block
Bổ sung khối function block luân phiên bơm theo giờ chạy và tự động bật bơm dự phòng khi sự cố.
FIND-CHL-001
Khi bơm duty bị lỗi Flow Loss, bơm lag tự động khởi động trong 5s.
OPEN
BL-032
Booster Pump Sleep/Wake-up PID Block
Khối PID bơm tăng áp tích hợp chế độ ngắt ngâm (Sleep Mode < 20Hz) và tự chạy lại (Wake-up Offset).
FIND-WAT-001
Bơm tự ngắt khi lưu lượng = 0 và tự chạy lại khi áp suất giảm.
OPEN



2.2 Nhóm P1 (High - 11 Hạng mục Bắt buộc Trước MVP)
ID
Hạng mục Đề xuất
Mô tả Kỹ thuật Chi tiết
Source Finding
Acceptance Criteria (AC)
Trạng thái
BL-006
Validation Signal Type vs Unit
Khóa ràng buộc logic giữa Signal Type u0 (Dry Contact, NTC, 0-10V, 4-20mA) và Unit u4 (°C, V, mA, %).
FIND-INP-001
Khóa không cho gán °C cho công tắc Dry Contact hay V cho CO2.
OPEN
BL-007
Formatter Số thập phân Alarm
Làm tròn giá trị đo trong mô tả Alarm thành tối đa 2 chữ số thập phân (tránh 7.258893).
FIND-ALM-001
Mô tả Alarm hiển thị dạng 7.26 degC.
OPEN
BL-008
Đồng bộ Múi giờ Local Time
Chuyển nhãn Datetime Pickers từ UTC sang Local Time (Asia/Ho_Chi_Minh UTC+7).
FIND-TRND-002
Mốc thời gian tra cứu hiển thị trùng múi giờ Việt Nam.
OPEN
BL-009
Input Sensor Calibration & Offset
Bổ sung Tab Input Sensor Calibration cho phép nhập dải đo Zero Offset và Span Gain cho 16 ngõ vào UI.
FIND-COMM-002
Nhập Offset -0.5°C lập tức bù trừ giá trị hiển thị trên Monitoring.
OPEN
BL-010
Visual Weekly Calendar Grid
Xây dựng giao diện ma trận lịch chạy dạng đồ họa 7 ngày x 24 giờ thay cho danh sách thanh ghi.
FIND-SCH-001
Cho phép xem và kéo thả khối thời gian (Time Blocks) trực quan.
OPEN
BL-022
Ping / DNS Diagnostic Tool
Bổ sung công cụ thử nghiệm kết nối Ping Gateway / NTP Server trực tiếp trên trang Network.
FIND-NET-001
Nhập IP bấm Ping hiển thị kết quả RTT ms và % Packet Loss.
OPEN
BL-023
Password Complexity & Lockout
Bổ sung chính sách mật khẩu mạnh (tối thiểu 8 ký tự) và khóa tài khoản 15 phút khi nhập sai 5 lần.
FIND-USER-001
Khóa nick 15 phút khi gõ sai mật khẩu 5 lần liên tiếp.
OPEN
BL-030
Interlock Safety Delay Timers
Bộ đếm thời gian trễ On-delay / Off-delay (3-5 phút Post-purge) cho chuỗi Chiller-Bơm-Tháp.
FIND-CHL-002
Chiller tắt thì bơm CHWP duy trì chạy xả nhiệt dư thêm 3 phút.
OPEN
BL-033
Pulse Scaler & NVRAM Totalizer
Tham số Pulse Scaler Factor (1 pulse = 100L) và bộ lưu trữ tích lũy m³/kWh lũy kế NVRAM.
FIND-WAT-002
Bộ đếm đếm lũy kế không mất dữ liệu khi mất nguồn.
OPEN
BL-001-A
Export BACnet EDE (.csv) File
Nút bấm tự động xuất file bảng điểm BACnet EDE (.csv) chuẩn cấu trúc B-ASC.
FIND-GW-001
Tải về file .csv chứa mã điểm, Object Type và Instance ID.
OPEN
BL-002-A
Modbus RS485 Packet Diagnostics
Bảng thống kê gói tin RS485 (TX/RX Packets, CRC Errors, Timeout Drops, Error Rate %).
FIND-GW-002
Hiển thị chính xác số gói tin lỗi CRC trên tuyến dây RS485.
OPEN



2.3 Nhóm P2 (Medium - 11 Hạng mục Cải tiến Trải nghiệm)
ID
Hạng mục Đề xuất
Mô tả Kỹ thuật Chi tiết
Source Finding
Trạng thái
BL-011
Batch Copy Input Configuration
Bổ sung nút Copy Config to Channels... áp dụng tham số u0-u7 cho nhiều kênh UI.
FIND-INP-003
OPEN
BL-012
Timed Auto-Release Timeout
Tự động trả ngõ ra về chế độ Auto sau khoảng thời gian cài đặt (5m, 15m, 60m) khi Manual Test.
FIND-COMM-003
OPEN
BL-013
AO Test Value Input / Slider
Ô nhập/Slider giá trị thử nghiệm tùy chỉnh (0-100% hoặc 0-10V) cho các điểm Analog Output.
FIND-COMM-004
OPEN
BL-014
Multi-day Weekdays Selection
Hỗ trợ chọn nhiều ngày trong tuần (T2-T6, Cuối tuần) trong cùng 1 bản ghi lịch Scheduler.
FIND-SCH-003
OPEN
BL-015
Friendly Labels cho u0-u7 & TSx
Đổi nhãn mã thanh ghi kỹ thuật u0-u7 và TSx 0-TSx 11 thành tên Tiếng Việt thân thiện.
FIND-INP-002
OPEN
BL-016
Export CSV / Excel cho Trends
Bổ sung nút Export CSV/XLSX tải về bảng dữ liệu chuỗi thời gian Historian.
FIND-TRND-003
OPEN
BL-017
Chuẩn hóa Cảnh báo Nhiệt CPU
Sửa mâu thuẫn badge Warning (Yellow) vs Normal cho cùng mức nhiệt độ CPU 46.2°C.
FIND-DASH-002
OPEN
BL-018
Thêm Đơn vị Unit cho Bảng AO
Bổ sung cột Unit (V, mA, %) cho 4 điểm Analog Output (thay vì ký tự -).
FIND-MON-005
OPEN
BL-019
Link Chuyển hướng RS485 Offline
Hyperlink từ nhãn "1 offline" trên Quick I/O Panel sang thẳng trang Modbus Diagnostics.
FIND-ALM-002
OPEN
BL-034
Modbus Power Meter Template Library
Thư viện mẫu đồng hồ điện Modbus (Schneider, Eastron, ABB) tự động mapping thanh ghi.
FIND-ENG-001
OPEN



2.4 Nhóm P3 (Low - 2 Hạng mục Tối ưu Nâng cao)
ID
Hạng mục Đề xuất
Mô tả Kỹ thuật Chi tiết
Source Finding
Trạng thái
BL-020
Mở rộng Danh mục Đơn vị u4
Mở rộng các đơn vị HVAC/BMS tiêu chuẩn: bar, kPa, l/s, m³/h, kW, kWh.
FIND-INP-004
OPEN
BL-035
Daily Energy Usage Bar Chart
Widget biểu đồ cột so sánh sản lượng điện/nước tiêu thụ hằng ngày trên Dashboard.
FIND-ENG-002
OPEN



3. ĐỀ XUẤT QUY CHUẨN THIẾT KẾ GIAO DIỆN HMI (ISA-101 & WCAG 2.1 AA)
Chuẩn Mã màu Trạng thái (ISA-101 High Performance HMI):
Critical Alarm: Đỏ tươi (#DC2626 + Nhấp nháy Ticker).
High Alarm: Cam (#EA580C).
Warning / Medium Alarm: Vàng (#D97706).
Normal / ON State: Xanh lá (#059669).
OFF / Standby State: Xám (#4B5563).
Fault / Signal Loss: Tím (#9333EA) hoặc Xám đậm.
Tiêu chuẩn Màn hình Cảm ứng Tủ điện (Touchscreen Panel PC):
Kích thước điểm chạm (Touch Target Size) >= 48px x 48px.
Độ tương phản chữ (Text Contrast Ratio) >= 4.5:1 (WCAG 2.1 AA).
Hỗ trợ đầy đủ phím Tab điều hướng (Keyboard Navigation Focus Indicator).


4. LỘ TRÌNH TRIỂN KHAI R&D (DEVELOPMENT ROADMAP)
Giai đoạn 1 (Sprints 1-2): Tập trung giải quyết 8 hạng mục P0 Critical (BL-001 đến BL-032), xử lý dứt điểm các nguy cơ mất an toàn điều khiển và đồng bộ hệ thống.
Giai đoạn 2 (Sprints 3-4): Triển khai 11 hạng mục P1 High (BL-006 đến BL-033), hoàn thiện tính năng MVP, đồ họa HMI và các bộ công cụ tích hợp Gateway.
Giai đoạn 3 (Sprints 5-6): Triển khai 13 hạng mục P2 Medium & P3 Low (BL-011 đến BL-035), tối ưu hóa trải nghiệm người dùng và mở rộng tính năng nâng cao.
