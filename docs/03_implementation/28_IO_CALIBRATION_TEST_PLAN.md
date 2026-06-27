# 27 — IO Calibration Test Plan
## MK-DDC-24 — Quy trình hiệu chuẩn và kiểm nghiệm bo mạch IO vật lý (Rev A)

> **Document ID:** VAL-IO-CALIBRATION-MK-DDC-24-VI  
> **Phiên bản:** 1.0 | 2026-06-19  
> **Trạng thái:** Active — Chuẩn bị cho bo mạch HW thật  
> **Owner:** QA/QC Lead + Hardware Engineer  

---

## 1. Mục đích
Tài liệu này định nghĩa quy trình đo đạc và hiệu chuẩn hệ số gain/offset của các ngõ vào/ra (UI/AO/DI/DO) trên bo mạch phần cứng thật (Rev A). Mục tiêu là đảm bảo sai số đo lường thực tế đáp ứng tiêu chuẩn công nghiệp và đồng bộ bảng ánh xạ phần cứng trong `io_scaling.cpp`.

---

## 2. Thiết bị đo cần chuẩn bị
- **Bộ nguồn chuẩn / Giả lập tín hiệu:** Bộ giả lập dòng/áp (0-10V, 4-20mA) độ chính xác cao (sai số < 0.05%).
- **Hộp điện trở chuẩn (Decade Resistor Box):** Giả lập RTD (PT100, PT1000) và NTC10k.
- **Đồng hồ vạn năng số (DMM):** Fluke 179 / Fluke 289 hoặc tương đương (đã hiệu chuẩn, còn hạn).
- **Thiết bị phụ trợ:** Dây đo chống nhiễu, Dây dry-contact test DI, Oscilloscope (đo nhiễu cạnh DI nếu cần).

---

## 3. Điểm đo và Kịch bản kiểm tra

### 3.1. Cấu hình Ngõ vào Analog (UI 0-10V)
- **Cấu hình UI:** Cài đặt chế độ cảm biến UI thành `0-10V`.
- **Điểm đo:** Cấp điện áp chuẩn từ bộ giả lập vào các kênh UI tại các mốc:  
  `0V`, `1.0V`, `2.5V`, `5.0V`, `7.5V`, `10.0V`.
- **Phương pháp:** Đọc giá trị hiển thị từ SHM qua `shm_dump_io` và so sánh với giá trị điện áp hiển thị trên DMM.

### 3.2. Cấu hình Ngõ vào Analog (UI 4-20mA)
- **Cấu hình UI:** Cài đặt chế độ cảm biến UI thành `4-20mA`.
- **Điểm đo:** Cấp dòng điện chuẩn từ bộ giả lập vào các kênh UI tại các mốc:  
  `4.0mA`, `8.0mA`, `12.0mA`, `16.0mA`, `20.0mA`.
- **Phương pháp:** Ghi nhận dòng điện thực tế đo bằng DMM đấu nối tiếp và so sánh với giá trị hiển thị trong SHM.

### 3.3. Cảm biến nhiệt độ RTD (PT100 / PT1000)
- **Điểm đo:** Kết nối hộp điện trở chuẩn vào ngõ vào UI (chế độ PT100/PT1000) tương ứng các mốc nhiệt độ:
  - **-50°C** (PT100: 80.31 $\Omega$, PT1000: 803.1 $\Omega$)
  - **0°C** (PT100: 100.00 $\Omega$, PT1000: 1000.0 $\Omega$)
  - **25°C** (PT100: 109.73 $\Omega$, PT1000: 1097.3 $\Omega$)
  - **50°C** (PT100: 119.40 $\Omega$, PT1000: 1194.0 $\Omega$)
  - **100°C** (PT100: 138.51 $\Omega$, PT1000: 1385.1 $\Omega$)

### 3.4. Cảm biến nhiệt độ Thermistor NTC10k
- **Điểm đo:** Kết nối hộp điện trở chuẩn vào ngõ vào UI (chế độ NTC10k) tại các mốc:
  - **0°C** (32.650 k$\Omega$)
  - **25°C** (10.000 k$\Omega$)
  - **50°C** (3.602 k$\Omega$)
  - **75°C** (1.480 k$\Omega$)

### 3.5. Ngõ vào số (DI)
- **Kịch bản:**
  - Kiểm tra dry contact: Đóng/ngắt tiếp điểm cơ khí.
  - Đo debounce: Cấp xung vuông tần số 10Hz, 50Hz, 100Hz để kiểm tra tính năng đếm xung bộ lọc debounce phần mềm/phần cứng.
  - Edge Noise: Kiểm tra lọc nhiễu cạnh khi đóng tiếp điểm không dứt khoát.

### 3.6. Ngõ ra Analog (AO 0-10V)
- **Kịch bản:** Xuất lệnh từ core qua Web IPC/BACnet ghi nhận giá trị AO setpoint:  
  `0V`, `2.5V`, `5.0V`, `7.5V`, `10.0V`.
- **Phương pháp:** Dùng DMM đo trực tiếp điện áp ngõ ra vật lý tương ứng. Ghi nhận sai số tuyến tính.

### 3.7. Ngõ ra số Relay (DO)
- **Kịch bản:** Kích hoạt đóng/ngắt rơ-le thông qua lệnh điều khiển.
- **Phương pháp:** Kiểm tra thông mạch ngõ ra tiếp điểm Relay. Xác nhận trạng thái feedback (feedback line) trong SHM khớp với trạng thái vật lý thực tế. Đo kiểm tra cơ chế phát hiện kẹt tiếp điểm (stuck-detect).

---

## 4. Kết quả nghiệm thu (Deliverables)
Mỗi đợt nghiệm thu Calibration trên phần cứng phải đóng gói đầy đủ các tài liệu sau:

1. **`calibration_report.csv`**: File dữ liệu đo thô dạng bảng chứa các cột:
   `Channel,SensorType,InputTarget,MeasuredDMM,ReadSHM,ErrorBefore,GainApplied,OffsetApplied,ErrorAfter`.
2. **`calibration_summary.md`**: Báo cáo tóm tắt chỉ rõ sai số lớn nhất (Max Error) trước và sau hiệu chuẩn.
3. **`gain_offset_table.json`**: File cấu hình chứa các hệ số hiệu chuẩn được nạp vào firmware MCU/SOM:
   ```json
   {
     "ui": [
       {"ch": 1, "gain": 1.002, "offset": -0.005},
       {"ch": 2, "gain": 0.998, "offset": 0.012}
     ],
     "ao": [
       {"ch": 1, "gain": 1.001, "offset": -0.002}
     ]
   }
   ```
4. **Bằng chứng thực nghiệm:**
   - Ảnh chụp setup bàn đo (Bench setup layout).
   - Mã model hiệu chuẩn của DMM và thiết bị tạo nguồn dòng/áp.
   - Ngày đo, tên người đo và người ký phê duyệt (Operator/Approver).
