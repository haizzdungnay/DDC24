# 48 — Plan Implement Fix Debug & Board Deploy (Foxlinx)

> **Document ID:** IMPL-FIX-DEBUG-FOXLINX-001  
> **Ngày lập:** 2026-08-04  
> **Trạng thái:** Approved / In Progress  
> **Dựa trên:** Báo cáo tổng kết 12 màn hình hệ thống (`bao cao.md`) và Bảng tổng hợp đề xuất Product Backlog (`đề xuất .md`).

---

## 1. Tóm tắt Phân tích & Phạm vi Công việc

Dựa trên dữ liệu khảo sát từ 12 màn hình hệ thống và danh mục Product Backlog (P0/P1), đợt triển khai này tập trung giải quyết các nhóm sự cố và nâng cấp cốt lõi sau:

1. **Khóa An toàn Điều khiển (Safety Control Modals - BL-002, BL-005, BL-021)**:
   - Thêm hộp thoại xác nhận 2 bước (**Confirmation Dialog**) khi chuyển trạng thái ngõ ra Digital Output (DO) trên trang Monitoring.
   - Thêm hộp thoại xác nhận an toàn khi thực thi **Forced Test Override** trên trang Commissioning.
   - Yêu cầu xác nhận mật khẩu Admin trước khi thực hiện **Reboot Controller** hoặc **Factory Reset** trên trang Device / Aux.

2. **Chuẩn hóa Giao diện & Hiển thị Dữ liệu (UI/UX Data Precision - BL-006, BL-007, BL-008, BL-017, BL-018)**:
   - Ràng buộc logic giữa **Signal Type** (Dry Contact, NTC, 0-10V, 4-20mA) và **Unit** (°C, V, mA, %) trên trang Inputs Config.
   - Làm tròn số thập phân trong mô tả cảnh báo Alarm thành tối đa 2 chữ số thập phân (`7.26 degC` thay vì `7.258893`).
   - Hiển thị rõ ràng múi giờ Local Time (`Asia/Ho_Chi_Minh UTC+7`) cho bộ chọn thời gian Trends.
   - Đảm bảo hiển thị cột đơn vị `Unit` (V, mA, %) cho bảng Analog Output (AO).
   - Nắn lại quy chuẩn badge nhiệt độ CPU (46.2°C) là trạng thái `Normal`.

3. **Backend Historian V2 Parity (BL-004 / FR-TRND-001)**:
   - Xác minh tính ổn định của cơ chế Single-Node AutoBootstrap Historian V2 trong Go `web-api` để tránh lỗi 503 `historian v2 query unavailable`.

4. **Triển khai lên Board Foxlinx**:
   - Đóng gói và deploy sản phẩm lên board `SOM-DDC-24-foxlinx` (`root@mekong-fac.ddns.net:2223`).

---

## 2. Chi tiết Các Bước Triển Khai (Implementation Steps)

### Bước 1: Khởi tạo nhánh Git
- Branch name: `fix/debug-and-board-deploy` (Đã khởi tạo).

### Bước 2: Sửa lỗi Frontend Web UI (`apps/web-ui`)
- Sửa `MonitorPage.tsx` & `OutputsPage.tsx`: Tích hợp safety confirmation modal cho DO toggle và bổ sung cột Unit cho AO.
- Sửa `CommissioningPage.tsx`: Tích hợp safety modal confirmation cho nút Force Output Test.
- Sửa `AlarmsPage.tsx` & `AlarmRow.tsx`: Truncate/round alarm value sang 2 chữ số thập phân.
- Sửa `InputsPage.tsx`: Thêm logic validation Signal Type vs Unit.
- Sửa `TrendsPage.tsx`: Cập nhật hiển thị múi giờ địa phương (`UTC+7`).
- Sửa `DashboardPage.tsx`: Cập nhật logic badge nhiệt độ CPU.
- Sửa `AuxFunctionsPage.tsx` / `SettingsPage.tsx`: Bổ sung modal re-auth password trước khi reboot/reset.

### Bước 3: Backend & Gateway Verification (`apps/web-api`)
- Kiểm tra `historian_activation.go` đảm bảo single-node authority tự động kích hoạt.

### Bước 4: Kiểm chứng Tự động (Verification)
- Chạy Vitest FE, Lint, Build.
- Chạy Go vet & Go tests.
- Chạy C++ CMake build (bật full options) & CTest.

### Bước 5: Build Package & Deploy lên Board Foxlinx
- Build release artifacts.
- Copy & deploy tới host `SOM-DDC-24-foxlinx` (`root@mekong-fac.ddns.net:2223`).

### Bước 6: Cập nhật CHANGELOG.md & Báo cáo
- Ghi nhận chi tiết vào `CHANGELOG.md` dưới mục `[Unreleased]`.

---

## 3. Bảng Kiểm chứng Định lượng (Verification Evidence Matrix)

| Hạng mục | Câu lệnh Kiểm chứng | Tiêu chuẩn Đạt |
|---|---|---|
| Frontend Tests | `npx vitest --run --environment jsdom src` | 100% Pass |
| Frontend Lint & Build | `npm run lint && npm run build` | 0 Error |
| Go Backend Tests | `go vet ./... && go test ./... -count=1` | Pass |
| C++ Target Build & Tests | `cmake --fresh -S . -B build/fw -DCMAKE_BUILD_TYPE=Release -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON` && `ctest --test-dir build/fw` | Pass |
| Deployment | SSH board Foxlinx `systemctl status mkddc-*` | Active (running) |
