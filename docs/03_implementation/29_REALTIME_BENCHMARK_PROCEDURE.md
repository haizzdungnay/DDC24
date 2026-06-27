# 29 — Real-Time Benchmark Procedure
## MK-DDC-24 — Quy trình kiểm nghiệm thời gian thực và độ ổn định lâu dài (Soak Test)

> **Document ID:** VAL-RT-BENCHMARK-MK-DDC-24-VI  
> **Phiên bản:** 1.0 | 2026-06-19  
> **Trạng thái:** Active — SOP đo đạc hiệu năng realtime trên hệ SOM  
> **Owner:** Dev 2 + DevOps  

---

## 1. Tổng quan
Hệ điều hành Linux trên SOM điều khiển phân tán MK-DDC-24 cần đáp ứng độ ổn định vòng quét (scan loop) và độ trễ thấp (low latency) khi polling MCU và tính toán thuật toán. Tài liệu này hướng dẫn cách chạy đo đạc jitter thời gian thực và chạy thử nghiệm soak test 24h để thu thập dữ liệu Gate G2/G3.

---

## 2. Tiêu chí đo đạc và Chỉ số đánh giá (KPI)

### 2.1. Jitter vòng quét (Jitter)
- **Core Scan Loop:** Chu kỳ danh định là `200ms` hoặc `1000ms` (tùy cấu hình). Sai lệch vòng quét (Jitter) yêu cầu: **$< 2\text{ms}$**.
- **Iobus Poll Loop:** Chu kỳ danh định là `10ms` (100Hz). Sai lệch vòng quét (Jitter) yêu cầu: **$< 1\text{ms}$**.

### 2.2. Overrun vòng quét (Overruns)
- Số lần vòng quét bị chậm (không hoàn thành kịp trong chu kỳ quy định). Tiêu chí chấp nhận: **$0$ lần** trong điều kiện tải bình thường và **$< 0.01\%$** trong thử nghiệm stress-test.

### 2.3. Trạng thái Hệ thống (System State)
- **mlockall:** Trạng thái khóa bộ nhớ vật lý chống phân trang (swap out) phải là `SUCCESS`.
- **Scheduler Policy:** Chính sách lập lịch thực tế của core phải là `SCHED_FIFO` với priority `80` và iobus là `SCHED_FIFO` với priority `70`.
- **CPU & Memory Usage:** Sử dụng tài nguyên phải ổn định, không được rò rỉ bộ nhớ (leak) hoặc tràn CPU tích lũy.

---

## 3. Quy trình thực hiện Benchmarking (1 giờ)

### 3.1. Chuẩn bị môi trường
1. Đảm bảo nhân (kernel) Linux target hỗ trợ `PREEMPT_RT`. Nếu dùng nhân mặc định (Orange Pi/Radxa fallback), ghi nhận rõ trạng thái:  
   `RT mode: FALLBACK SCHED_OTHER`
2. Kích hoạt quyền thực thi thời gian thực của user chạy dịch vụ thông qua `LimitRTPRIO`.

### 3.2. Chạy stress-test (Tải nền)
Tạo tải nền giả lập bằng công cụ `stress` hoặc `stress-ng` trong suốt thời gian benchmark:
```bash
# Stress CPU (2 worker) + stress IO/Disk (1 worker) nhẹ
stress --cpu 2 --io 1 --timeout 1h
```

### 3.3. Thu thập dữ liệu
Dịch vụ `mkddc-core` và `mkddc-iobus` tự động tính toán jitter và in log tóm tắt mỗi 60 giây ra stderr/journald.  
Ghi nhận logs:
```bash
journalctl -u mkddc-iobus --since "1 hour ago" > iobus_benchmark.log
journalctl -u mkddc-core --since "1 hour ago" > core_benchmark.log
```

---

## 4. Quy trình thực hiện Soak Test (24 giờ)

### 4.1. Chuẩn bị
Sử dụng công cụ test tự động `/home/chuong/Desktop/DDC-PROJECT/tools/run_soak_test.py`.

### 4.2. Chạy thử nghiệm
Thực thi script test 24 giờ liên tục (86400 giây):
```bash
./tools/run_soak_test.py --duration 86400 --pwrite 300 --pfault 1800 --pmetrics 60 --log-dir logs/soak-24h
```
*Ghi chú kịch bản:*
- **Mỗi 5 phút (`--pwrite 300`):** Gửi 1 lệnh ghi DO/AO để kiểm tra luồng điều khiển.
- **Mỗi 30 phút (`--pfault 1800`):** Giả lập tắt fake MCU, đợi 15 giây rồi bật lại để verify khả năng tự phục hồi liên kết (Reconnect).
- **Mỗi 1 phút (`--pmetrics 60`):** Ghi lại bộ nhớ RSS/VSZ, CPU usage của 4 tiến trình cùng trạng thái SHM vào CSV.

---

## 5. Tiêu chuẩn nghiệm thu (Pass/Fail Criteria)

### 5.1. Với Benchmarking 1 giờ
- [ ] Jitter trung bình $< 2\text{ms}$ (hoặc tương đương tùy thuộc kernel hỗ trợ RT hay không).
- [ ] `mlockall` thành công, không cảnh báo `rt.mlockall_fail`.
- [ ] `SCHED_FIFO` được áp dụng thành công (nếu kernel có RT).

### 5.2. Với Soak Test 24 giờ
- [ ] Không có tiến trình nào bị crash hay bị systemd restart ngoài ý muốn.
- [ ] Mức tiêu thụ bộ nhớ (RSS) tại giờ thứ 24 so với giờ đầu tiên lệch không quá **$100\text{ KB}$** (xác nhận không leak bộ nhớ dài hạn).
- [ ] Trạng thái SHM không bị hỏng, mất quyền truy cập hay kẹt khóa seqlock.
- [ ] Tỷ lệ lệnh thực thi thành công đạt **$100\%$** (khi MCU kết nối bình thường).
- [ ] Phục hồi liên kết (reconnect) thành công 48/48 lần giả lập lỗi liên lạc.
- [ ] Báo cáo nghiệm thu `soak_report.md` và `soak_metrics.csv` được lưu trữ làm Release Evidence.
