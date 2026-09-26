# BÁO CáO PHÂN TÄH VấN ĐỀ COMMISSION VÀ SIMULATION TRÊN BO FOXLINH (SOM-DDC-24)

- **Dự án**: MK-DDC-24
- **Thiết bị kiểm thử**: Foxlinx SOM-DDC-24 (`192.168.1.16:8082` / `mekong-fac.ddns.net:8082`)
- **Ngày lắp**: 25/09/2026
- **Người thực hiện**: Em gái kỹ thuật của Onii-chan

---

## 1. TỔNG QUAN HIỆN TRẠNG

Hệ thống đã biên dịch thành công 2 chương m�nh (ST `AHU_Master` và FBD `RelayPattern32`) và vượt qua bước **Check (PASSED)**. Tuy nhiên, khi đưa vào vận hành thực tế trên bo Foxlinx, phát sinh 2 vấn đề lớn:
1. **Lỗi Commission**: Không thể triển khai (deploy) bản sửa đổi mới lên controller, gặp lỗi `PRG-ERR-ACK-UNEXPECTED-001` với tham số `writableOutputsAffected`.
2. **Lỗi Simulation**: Tab mô phỏng liên tục báo lỗi `The controller simulation limit is reached; stop the running session or wait a moment` (`PRG-SIM-QUOTA_), người dùng không thể chảy mô phỏng và không có nút dừng phiên cũ trên giao diện.

---

## 2. VấN ĐỀ 1: LỖI COMMISSION (`PRG-ERR-ACK-UNEXPECTED-001`)

### 2.1 Hiện tượng thực tế
Khi người vận hành bấm **Commission** trên giao diện:
- Hệ thống gửi request `POST
/api/v1/programming/operations/commission`.
- Backend trả về mã lỗi HTTP 422:
```json
{
  "error": {
    "code": "PRG-ERR-ACK-UNEXPECTED-001",
    "messageKey": "programming.error.acknowledgementUnexpected",
    "args": {
      "key": "writableOutputsAffected"
    },
    "retryable": false,
    "keepsRunningRevision": true,
    "correlationID": "861c9fcc-e49c-4226-88cb-ec4f340c4e3e"
  }
}
```

### 2.2 Nguyên nhân gốc rễ (Root Cause Analysis)
1. **Bổ sung Impact Keys nhưng cập nhật thiấu ở tầng Application**:
   - Khi tính năng `ISS-PIO-29` (tách biệt rủi ro theo nguồn point) được đưa vào, hệ thống đã thêm 4 nhóm ảnh hưởng mới:
     - `physicalMappingChanges`
     - `virtualPointChanges`
     - `modbusMappingChanges`
     - `writableOutputsAffected`
   - Các file sau đã được cập nhập đầy đủ:
     - `apps/web-api/internal/programming/application/changes.go` (struct `RevisionImpact`)
     - `apps/web-api/internal/programming/transport/http/models.go` (`allImpactKeys`)
     - `apps/web-ui/src/features/programming/commission/impactGroups.ts` (`IMPACT_GROUP_ORDER`)
2. **Điểm gãy trong logic kiểm tra**:
   - Tại `apps/web-api/internal/programming/application/operations.go`:
     - Biến `impactAckKeys` (dòng 935) là whitelist đóng các key hợp lệ, nhưng *thiếu hoàn toàn 4 key mới*.
     - Trong hàm `validateApplicationImpact` (drông 1024), server kiểm tra từng acknowledgement client gủi lên. Nếu key không nam trong `impactAckKeys` thì lập tức trả về lỗi `ErrAckUnexpected`.
   - Dự án `AHU-MASTER-SEQUENCE` có 18 điểm ghi (nhóm `writableOutputsAffected` đạt trạng thái `PRESENT`). Frontend bắp bpěc người dùng xác nhận và gủi token `writableOutputsAffected` lên server. Server không tìm thấy key này trong whitelist nên từ chối.

### 2.3 Giải pháp xử lý
- Bổ sung đầy đủ 4 khóa:
  - `physicalMappingChanges`
   - `virtualPointChanges`
   - `modbusMappingChanges`
  - `writableOutputsAffected`
  vào cả hai vị trí trong `apps/web-api/internal/programming/application/operations.go`:
  1. Whitelist `impactAckKeys`.
  2. Map nhóm `groups` trong hàm `validateApplicationImpact`.
- Cập nhậc hàm test helper `presentImpactKeys` trong `operations_test.go`.

---

## 3. VẤN ĐỀ 2: LỖI MÔ PHIỆN VƯỆT QUOTA (`PRG-SIM-QUOTAg)

### 3.1 Hiện tượng thực tế & Làm rõ kiến trúc
- **Hiện tượng**: Bấm vào tab Simulate, hệ thống báo `The controller simulation limit is reached; stop the running session or wait a moment.`.
- **L⁠ạm rõ tách biệt giữa Chương m�nh chảy thật và Phiên mô phỏng**:
  - **Chương m�nh chảy thật (Core Runtime)**: Chạy dưới tiến trình dịch vụ `mkddc-core.service`, tương tác với bus I/O vật lý thật (GPIO, Modbus RTU, BACnet).
  - **Phiên mô phỏng (Simulation Worker)**: Chạy dưới tiến trình độc ập `mkddc-programming-sim-worker`, hoàn toàn trong bộ không gian ảo, ngắt kết nối với toàn bộ I/O vật lý.
  - **Kết luận kiến trúc**: Việc controller đang chạy một chương trình điều khiển thật *hoàn toàn KHÔNG CH��N*< việc mô phỏng một chương m�nh khác. Hai môi trường đã được cô lập Hoàn toàn.

### 3.2 Nguyên nhân gốc rễ (Root Cause Analysis)
1. **Ràng buộc SQLite Unique Index trên Controller**:
   - Trong CSDL SQLite (`0013_programming_simulation_sessions.sql`):
     M�ỗi controller chỉ được phép có *tối đa 1 phiên mô phỏng sống* (`PREPARING`, `PDUSED`, `RUNNING`) tại một thời điểm để bảo vệ tài nguyên CPU/RAM trên phần cứng nhúng.
2. **Phiên cũ bị mồ côi (Orphan Live Session)**:
   - Kiểm tra trực tiếp trên DB của bo Foxlinx:
     `0a608048-6a15-4a73-bb54-80acd1b9e966|controller-local|e96357dc-b00c-4116-a4a0-1dd71ea116db|RUNNING|2026-09-25 07:09:50`
   - Tiến trình worker PID `44522` (`mkddc-programming-sim-worker`) vẫn đang chạy nền từ 07:09 UTC.
3. **Thiấu cơ chế tự động dọn dỹp (Sweep) phiên mô côi khi Mở phiên mới**:
   - Hàm `CreateSession` trong `simulation.go` không gọi `SweepExpired` trước khi kiểm tra tạo phiên mới.
   - Phiên mô phỏng có `IdleTTL` là 10 phút, nhưng nếu không có request hành động nào tới thì không có vïng quét tự động đóng phiên đó trên DB.
4. **Lỗ hổng giao diện Frontend (`useSimulation.ts` & `SimulateWorkspace.tsx`)**:
   - Khi người dùng F5 hoặc mở lại trình duyệt, hook `useSimulation` khởi tạo với `session = null`.
   - Frontend không có API hoặc cơ chế try vấn phiên mô phỏng đang mở trên controller.
   - Vì `session = null`, toàn bộ các nút điều khiển (Run, Pause, Step, **Stop**) trong `SimulationControls` đều bị disabled.
   - Người dùng chỉ thấy nút "Mở phiên mô phỏng". Bấm vào thì backend trả về 429 (`PRG-SIM-QUOTA`). Người dùng rơi vào tình trạng *Bê tắc (greediness/blocked) không thể thao tác được gì trên giao diện*.

### 3.3 Giải pháp xử lý
1. **Backend**:
   - Trong hàm `CreateSession` (`simulation.go`): Luôn thực hiện `s->listLiveSessions` và `SweepExpired` trước tiên để giải phóng ngay các phiên đã quá hạn Idle/Hard TTL.
   - Thêm endpoint `GET /api/v1/programming/simulation/sessions/active`: Trả về phiên danglive (nếu có) của controller để frontend cắu vào.
   - Thêm cơ chế Dừng phiên cũ khi có yêu cầu ghi đè (forceStopPrevious) nhằm giải phóng slot quota ngay lậptức.
2. **Frontend**:
   - Khi mở tab Simulate, tự động kiểm tra phiên active trên controller để khôi phục trạng thái điều khiển.
   - Khi gặp lỗi `PRG-SIM-QUOTA`: Hiển thị nút *"Dừng phiên đang chạy trên thiết bị"* (Force Stop) để người dùng giải phóng trên UI mà kHông cần SSH.

---

## 4. KẾ HOẠCH THỼC HiỆN CII TIET

1. Sửa code Backend (`apps/web-api`):
   - `apps/web-api/internal/programming/application/operations.go`: Bổ sung 4 key mới vào `impactAckKeys` và `groups`.
   - `apps/web-api/internal/programming/application/simulation.go`: Quét `SweepExpired` trước khi create; thêm hàm `GETActiveSession` / `getActive`.
   - `apps/web-api/internal/programming/transport/http/simulation.go`: Địch thêm route `GET /sessions/active` và `DELETE /sessions/active`.
2. Sửa code Frontend (`apps/web-ui`):
   - `useSimulation.ts`: Thêm phương thức `loadActive`session và `stopActive`.
   - `SimulateWorkspace.tsx`: Hiển thị nút Dừng phiên đang chảy nếu gặp quota liêm tục.
3. Chạy test bảo đảm không regression.�
. Build và deploy lên bo Foxlinx (`mekong-fac.ddns.net:8082`).
5. Yên tâm confirm chạy thực tế trên browser nhá onii-chan!
