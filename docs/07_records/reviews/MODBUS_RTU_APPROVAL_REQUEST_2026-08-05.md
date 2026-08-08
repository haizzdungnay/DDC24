# Tờ trình phê duyệt — Hồ sơ Thiết kế & Khởi động Track B Modbus RTU

**Mã tài liệu:** DDC24-MBRTU-REQ-APPROVE-2026-08-05  
**Ngày lập:** 2026-08-05  
**Người trình:** Antigravity AI / Fieldbus Engineering Team  
**Kính gửi:** Ban Quản lý Dự án (PM) · Giám đốc Công nghệ (CTO) · Kiến trúc sư Trưởng (System Architect) · Trưởng nhóm Phần cứng (Hardware Lead) · Trưởng nhóm Kiểm thử (QA Lead)  
**Phạm vi:** Hệ thống Modbus RTU Rev A trên bộ điều khiển MK-DDC-24 (Target hardware: `Foxlinx SOM-DDC-24`)

---

> [!IMPORTANT]
> **HƯỚNG DẪN DÀNH CHO BAN PHÊ DUYỆT:**  
> Tài liệu này được biên soạn theo hình thức **TỔNG HỢP TOÀN BỘ NỘI DUNG VÀ TÓM TẮT CHI TIẾT** của 12 tài liệu thiết kế Modbus RTU và 05 điểm xin phê duyệt. Người phê duyệt **không cần phải tra cứu thủ công lại từng tài liệu riêng lẻ** — toàn bộ thông tin kiến trúc, giao diện, dữ liệu, giao diện người dùng, phân quyền và kế hoạch đều được trình bày trực tiếp dưới đây.

---

## 1. Mục đích Tờ trình

Tờ trình này được lập ra nhằm mục đích:

1. **Báo cáo kết quả đồng bộ toàn bộ hồ sơ thiết kế Modbus RTU (Bản 2.0)** sau khi đã tích hợp 11 quyết định phê duyệt ngày 2026-08-04 của PM/CTO và kết quả nghiệm thu Track A trên bo mạch thật Foxlinx SOM-DDC-24.
2. **Xin phê duyệt chính thức 05 điểm then chốt** để giải quyết các mâu thuẫn tài liệu Active và mở khóa cổng **`READY_FOR_MODBUS_RTU_IMPLEMENTATION = YES`**.
3. **Phê duyệt kế hoạch triển khai Track B — Implementation Plan (Contract v2 & Mở rộng tính năng)** cho Modbus RTU với dung lượng 256 Point, đấu nối End-to-End trọn vẹn và tích hợp phần cứng thật.

---

## 2. Báo cáo Tóm tắt Kết quả Giai đoạn Tiền đề (Track A & Hồ sơ 2.0)

### 2.1 Kết quả Track A — Vá An toàn Logic (Đã hoàn thành 100%)
- **Chất lượng code:** Đã sửa dứt điểm 14 defect rủi ro cao (D-01 đến D-14), bao gồm: encode fail-closed (chống sập float/scale=0), vòng đời write hữu hạn (chống trôi lệnh ghi), lập lịch EDF + offline probe (chống bỏ đói bus), retry phát lại giao dịch thật, và giao diện UI bảo vệ quyền thao tác.
- **Kiểm chứng Host:** 769/769 test C++ PASS, 11 package Go PASS, 304/304 test Vitest FE PASS, Build & Lint sạch 100%.
- **Nghiệm thu Board Foxlinx (2026-08-05):** Chạy `iobus_tests` trực tiếp trên SoC RV1126B đạt **208 PASS / 6 SKIP / 0 FAIL** (trong đó 23/23 test Track A PASS tuyệt đối). Không gây hồi quy jitter IOP hệ thống (đạt 15.36 – 15.65 µs).

### 2.2 Trạng thái Cổng Sẵn sàng (Gate Status)
```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ TRẠNG THÁI HỆ THỐNG HIỆN TẠI (BASELINE 2026-08-05):                        │
│                                                                             │
│ MODBUS_RTU_REQUIREMENTS_COMPLETE   = YES  (Đã hoàn thiện bộ yêu cầu)       │
│ MODBUS_RTU_UI_UX_DESIGN_COMPLETE   = YES  (Đã thiết kế đủ 5 trang UI/UX)  │
│ MODBUS_RTU_BE_DESIGN_COMPLETE      = YES  (Đã hoàn thiện thiết kế BE)      │
│ MODBUS_RTU_FW_SOM_DESIGN_COMPLETE  = YES  (Đã hoàn thiện thiết kế FW-SOM)  │
│ MODBUS_RTU_INTERFACES_SYNCHRONIZED = NO   (Cần duyệt Mục 3.1 - OpenAPI)    │
│ MODBUS_RTU_VERIFICATION_DEFINED    = YES  (Đã định nghĩa test suite)       │
│ --------------------------------------------------------------------------- │
│ READY_FOR_MODBUS_RTU_IMPLEMENTATION = CONDITIONAL                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. NỘI DUNG CHI TIẾT TỪNG PHẦN CẦN PHÊ DUYỆT

---

### 3.1 [MỤC 1] Cho phép cập nhật OpenAPI Schema (`OD-MBRTU-018`)

> **Cấp phê duyệt:** System Architect + Product Manager  
> **Tác động:** Giải quyết mâu thuẫn interface duy nhất, chuyển `MODBUS_RTU_INTERFACES_SYNCHRONIZED` từ `NO` sang `YES`.

#### NỘI DUNG MÔ TẢ CHI TIẾT:
- **Hiện trạng mâu thuẫn:** 
  - Quyết định Đ-05 (2026-08-04) quy định: `retry` trong Modbus RTU là **số lần phát lại giao dịch lỗi** (dải giá trị 0–5 lần). Trạng thái `OFFLINE` được điều khiển bằng tham số riêng `offline_after_errors` (default = 2 lượt poll lỗi liên tiếp). Logic này đã được code chuẩn trong FW-SOM, BE Go và FE React.
  - Tuy nhiên, tệp OpenAPI chính thức `contracts/openapi/openapi.yaml` (đang ở trạng thái `Active`) vẫn giữ định nghĩa cũ: mô tả `retry` là ngưỡng chuyển offline (0–10).
- **Nội dung đề xuất thay đổi trực tiếp trong `openapi.yaml`:**
  ```yaml
  # Sửa đổi thuộc tính retry trong ModbusDevice schema:
  retry:
    type: integer
    minimum: 0
    maximum: 5
    default: 1
    description: "Số lần phát lại (retry attempts) một giao dịch Modbus khi bị lỗi timeout hoặc CRC trước khi đánh dấu lượt poll thất bại."
  
  # Bổ sung 2 thuộc tính mới vào ModbusDevice schema:
  offline_after_errors:
    type: integer
    minimum: 1
    maximum: 10
    default: 2
    description: "Số lượt poll thất bại liên tiếp trước khi chuyển trạng thái kết nối Device sang OFFLINE."
  
  offline_probe_ms:
    type: integer
    minimum: 1000
    maximum: 60000
    default: 5000
    description: "Chu kỳ phát gói tin thăm dò (probe) khi Device đang ở trạng thái OFFLINE."
  ```
- **Đánh giá rủi ro & Khả năng tương thích:** Thay đổi chỉ mang tính chất làm rõ ngữ nghĩa description và mở rộng thuộc tính không bắt buộc (optional fields), **không phá vỡ backward compatibility** của API v1 hiện tại.

---

### 3.2 [MỤC 2] Phê duyệt Kiến trúc ADR-024 (`Proposed` → `Accepted`)

> **Cấp phê duyệt:** Giám đốc Công nghệ (CTO)  
> **Tác động:** Phê duyệt chính thức khung kiến trúc phần mềm cho subsystem Modbus RTU trên DDC-24.

#### NỘI DUNG TỔNG QUAN TỪNG NGUYÊN TẮC KIẾN TRÚC TRONG ADR-024:

1. **Nguyên tắc 1: Abstraction 1 Bus RS485 ở Rev A, giữ khả năng mở rộng Multi-bus**
   - Bộ điều khiển `Foxlinx SOM-DDC-24` ở Rev A chỉ sử dụng 01 cổng RS485 vật lý (`/dev/ttyS5`).
   - Mọi cấu trúc dữ liệu và API giữ nguyên thuộc tính `bus_id` (default = 1) để khi mở rộng phần cứng có thêm bus RS485 thứ 2 sẽ **không làm thay đổi ABI hay API Schema**.

2. **Nguyên tắc 2: Phân định Quyền sở hữu Dữ liệu (Memory & State Ownership)**
   - `mkddc-core` (Core Application): Sở hữu **Core Point Table** duy nhất của DDC-24. Mọi giá trị Modbus Point sau khi đọc/chuyển đổi sẽ được ghi vào Core Point Table.
   - `mkddc-iobus` (IOBus Daemon): Sở hữu **Modbus Master Polling Engine**, quản lý kết nối RS485, lịch poll EDF và bộ đếm lỗi communication diagnostics.

3. **Nguyên tắc 3: Giao tiếp Nội bộ UDS Datagram & Shared Memory**
   - **Chiều Đọc (Input/Read):** `mkddc-iobus` đọc register từ Modbus Slave -> Decode theo Byte/Word order -> Gửi datagram snapshot qua Unix Domain Socket (`SOCK_DGRAM`) về `mkddc-core` -> Update Core Point Table -> Đẩy qua WebSocket lên FE.
   - **Chiều Ghi (Output/Write):** FE/API gửi lệnh ghi -> `mkddc-web-api` bật cờ `dirty` và gán `setpoint` vào vùng Shared Memory `plc_shm.ext[]` -> `mkddc-iobus` quét cờ dirty -> Thực thi ghi Modbus -> Xóa cờ dirty và trả kết quả.

4. **Nguyên tắc 4: Quản lý Cấu hình 2-Phase Commit & LKG Fallback**
   - Cấu hình Modbus Device & Point được lưu bền vững tại `/etc/ddc24/fieldbus.conf` (JSON format kèm SHA256 checksum & revision).
   - Khi chỉnh sửa cấu hình từ UI: `mkddc-web-api` thực hiện validate toàn bộ -> Ghi file tạm -> Gửi tín hiệu Reload -> `mkddc-iobus` parse file -> Nếu hợp lệ thì swap runtime config và tăng `config_revision`; nếu lỗi thì giữ nguyên cấu hình Last-Known-Good (LKG) đang chạy.

5. **Nguyên tắc 5: Mở rộng Dung lượng lên ≥256 Modbus Point**
   - Nâng giới hạn điểm Modbus RTU từ 64 lên tối thiểu 256 Point (`KX_N_EXT = 256`).
   - Ngân sách bộ nhớ Shared Memory `ext[]` tăng từ ~2.5 KB lên ~10 KB.
   - Ngân sách datagram socket ~10.3 KB/gói tin (nằm an toàn trong giới hạn `SO_SNDBUF` mặc định 212 KB của Linux Kernel).

---

### 3.3 [MỤC 3] Phê duyệt Bộ 9 Tài liệu Thiết kế Chuyên ngành (`In Review` → `Active`)

> **Cấp phê duyệt:** Product Manager · System Architect · Fieldbus Lead · Security Lead · QA Lead  
> **Tác động:** Xác lập baseline tài liệu kỹ thuật chính thức cho toàn bộ dự án.

#### TỔNG QUAN NỘI DUNG CHI TIẾT TỪNG TÀI LIỆU TRONG BỘ 9 TÀI LIỆU:

| STT | Mã tài liệu / Đường dẫn | Tóm tắt Nội dung Chi tiết & Điểm cốt lõi trong Tài liệu |
|---|---|---|
| 1 | [PROD-MBRTU-001](../../01_product/MODBUS_RTU_PRODUCT_REQUIREMENTS.md)<br>`MODBUS_RTU_PRODUCT_REQUIREMENTS.md` | **Yêu cầu Sản phẩm Modbus RTU:**<br>- Định nghĩa 12 use case sản phẩm từ xem danh sách, CRUD Device/Point, Read/Write test, Point Mapping, Diagnostics đến xử lý offline/reconnect.<br>- Chuẩn hóa Rev A dùng 1 bus RS485, dung lượng ≥256 Point, hỗ trợ Import/Export CSV/JSON.<br>- Phân định ma trận 3 role (`Admin`, `Operator`, `Viewer`). |
| 2 | [UX-WEB-MBRTU-001](../../04_uiux/MODBUS_RTU_UI_UX_DESIGN.md)<br>`MODBUS_RTU_UI_UX_DESIGN.md` | **Thiết kế Giao diện UI/UX:**<br>- Thiết kế chi tiết 5 màn hình: Overview, Device Manager, Point Manager, Point Mapping, Diagnostics.<br>- Quy định layout wireframe, component, field validation, 4 trạng thái (Loading, Empty, Error, Offline).<br>- Chuẩn hóa Modal xác nhận 2 bước cho thao tác Ghi (Write) và Xóa (Delete). Nhãn Tiếng Việt "Số lần phát lại". |
| 3 | [DDD-FE-MBRTU-001](../../02_design/software/MODBUS_RTU_FE_DESIGN.md)<br>`MODBUS_RTU_FE_DESIGN.md` | **Thiết kế Frontend (React/Vite):**<br>- Cấu trúc React Component cho Modbus RTU (`ModbusRtuPage.tsx`, `ModbusDeviceTable`, `ModbusPointTable`).<br>- Quản lý state bất đồng bộ, WebSocket realtime status stream, form validation.<br>- Ràng buộc phân quyền RBAC ở Client (Viewer bị disable nút mutation kèm lý do). Tích hợp test suite Vitest. |
| 4 | [DDD-BE-MBRTU-001](../../02_design/software/MODBUS_RTU_BE_DESIGN.md)<br>`MODBUS_RTU_BE_DESIGN.md` | **Thiết kế Backend (Go Web-API):**<br>- Kiến trúc 9 REST endpoints, service layer, domain validator.<br>- Cơ chế Persister quản lý `fieldbus.conf` kèm SHA256 checksum, revision tracking, atomic write & rollback.<br>- Ghi nhận Audit Log đầy đủ (User, Timestamp, Action, Target, Old/New Value). |
| 5 | [DDD-FW-MBRTU-001](../../02_design/software/MODBUS_RTU_FW_SOM_DESIGN.md)<br>`DDD-FW-MBRTU-001` | **Thiết kế Firmware SOM (C++ IOBus Daemon):**<br>- Tích hợp `libmodbus` điều khiển serial port `/dev/ttyS5`.<br>- Lập lịch Polling EDF (Earliest Deadline First) kết hợp probing bất đồng bộ cho Device offline.<br>- Xử lý vòng đời lệnh Write hữu hạn (TTL 30s hoặc max 3 retries -> drop + log). Quản lý quality & timestamp. |
| 6 | [DDD-DM-MBRTU-001](../../02_design/software/MODBUS_RTU_DATA_MODEL.md)<br>`MODBUS_RTU_DATA_MODEL.md` | **Thiết kế Data Model & Codec:**<br>- Định nghĩa 2 Entity chính: `MODBUS_RTU_DEVICE` & `MODBUS_RTU_POINT`.<br>- Quy tắc Codec 6 kiểu dữ liệu (`INT16`, `UINT16`, `INT32`, `UINT32`, `FLOAT32`, `BIT`) × 4 thứ tự Byte/Word Order (`ABCD`, `CDAB`, `BADC`, `DCBA`).<br>- Quy tắc encode fail-closed (scale=0, NaN/±Inf, ngoài dải -> từ chối ghi). 5 mức Quality (`GOOD`, `STALE`, `OFFLINE`, `BAD`, `CONFIG_ERROR`). |
| 7 | [ICD-API-MBRTU-001](../../02_design/interfaces/MODBUS_RTU_API_SPEC.md)<br>`MODBUS_RTU_API_SPEC.md` | **Đặc tả REST API Specification:**<br>- Chi tiết Request/Response payload, HTTP Status code cho 9 endpoints (Device CRUD, Point CRUD, Test Connection, Read/Write Test, Import/Export).<br>- Quy định chi tiết Error Response format, Validation errors, Idempotency key cho lệnh Ghi. |
| 8 | [ICD-IF-MBRTU-001](../../02_design/interfaces/MODBUS_RTU_INTERFACE_SPEC.md)<br>`MODBUS_RTU_INTERFACE_SPEC.md` | **Đặc tả Giao diện Nội bộ (End-to-End Interface Spec):**<br>- Luồng dữ liệu Đọc (Modbus Slave -> FW -> Core -> BE -> FE WebSocket) và Luồng Lệnh Ghi.<br>- Cấu trúc Datagram Socket `ModbusSnapshot` và Cấu trúc Shared Memory `plc_shm.ext[]`. Ma trận Interface Matrix chi tiết. |
| 9 | [VVP-MBRTU-001](../../05_verification/MODBUS_RTU_VERIFICATION_PLAN.md)<br>`MODBUS_RTU_VERIFICATION_PLAN.md` | **Kế hoạch Kiểm chứng (Verification Plan):**<br>- Định nghĩa 35+ kịch bản test chia làm 6 cấp độ: Unit Test, Integration Test, PTY Simulator Test, Host Test, Target Board Test (Foxlinx) và Physical RS485 Test.<br>- Tiêu chí chấp nhận (Acceptance Criteria) chi tiết cho từng gate. |

---

### 3.4 [MỤC 4] Chỉ định Nhân sự Phụ trách Lead (`OD-MBRTU-EXT-01` / Đ-09)

> **Cấp phê duyệt:** Ban Quản lý Dự án (PM)  
> **Tác động:** Phân công trách nhiệm đầu mối kỹ thuật và nghiệm thu cho Track B.

#### MÔ TẢ VAI TRÒ & TRÁCH NHIỆM CHI TIẾT:

1. **Fieldbus Lead (Trưởng nhóm Kỹ thuật Protocol & Firmware):**
   - **Trách nhiệm:** Trực tiếp quản lý và chịu trách nhiệm kỹ thuật cho toàn bộ subsystem Modbus RTU trên `mkddc-iobus` (FW-SOM) và `mkddc-web-api` (BE Go).
   - **Nhiệm vụ cụ thể:** 
     - Trực tiếp chỉ đạo triển khai Track B theo Plan 49.
     - Review code C++ libmodbus / Go REST API / Shared memory.
     - Đảm bảo tuân thủ tiêu chuẩn an toàn memory, thread-safety và fail-closed architecture.

2. **QA / HIL Lead (Trưởng nhóm Kiểm thử phần cứng & Hệ thống):**
   - **Trách nhiệm:** Trực tiếp chịu trách nhiệm xây dựng môi trường thử nghiệm HIL (Hardware-in-the-loop) và nghiệm thu chất lượng Modbus RTU trên thiết bị phần cứng thật.
   - **Nhiệm vụ cụ thể:**
     - Thiết lập kịch bản kết nối vật lý với Đồng hồ điện và Biến tần Modbus RTU thật qua RS485.
     - Đo đạc thực tế bus utilization, tỷ lệ lỗi CRC error, trễ polling và thời gian phục hồi khi rút dây/cấp nguồn lại.
     - Độc lập ký biên bản nghiệm thu chất lượng (Sign-off) trước khi phát hành phiên bản Production.

---

### 3.5 [MỤC 5] Phê duyệt Sơ đồ & Cơ chế RS-485 Direction Control (`OD-MBRTU-EXT-04` / Đ-02)

> **Cấp phê duyệt:** Trưởng nhóm Phần cứng (Hardware Lead)  
> **Tác động:** Xác định tham số điều khiển driver RS485 chuẩn xác trên bo mạch Foxlinx SOM-DDC-24.

#### NỘI DUNG PHƯƠNG ÁN KỸ THUẬT PHẦN CỨNG:

Bo mạch sản xuất `Foxlinx SOM-DDC-24` (SoC RV1126B) kết nối cổng Serial `/dev/ttyS5` với Transceiver RS485. Kính trình Hardware Lead xác nhận 01 trong 3 phương án phần cứng sau:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHƯƠNG ÁN A (KHUYÊN DÙNG): Auto-Direction Transceiver (Hardware Automatic)  │
│ - Transceiver RS485 tự động chuyển hướng TX/RX dựa trên tín hiệu TXD.      │
│ - Cấu hình Driver Linux: Không cần bật RS485 ioctl hay toggle GPIO.         │
│                                                                             │
│ PHƯƠNG ÁN B: Điều khiển hướng bằng Tín hiệu Hardware RTS (Serial Driver)    │
│ - SoC RV1126B kéo chân RTS của UART ttyS5 để chuyển chip RS485.             │
│ - Cấu hình Driver Linux: FW-SOM gọi ioctl(fd, TIOCSRS485, &rs485conf) với  │
│   cờ SER_RS485_ENABLED và SER_RS485_RTS_ON_SEND.                            │
│                                                                             │
│ PHƯƠNG ÁN C: Điều khiển hướng bằng Chân GPIO Riêng biệt                     │
│ - Dùng 1 chân GPIO tự do trên Header P16 để kích hoạt chân DE/RE của chip.  │
│ - Cấu hình Driver Linux: FW-SOM hoặc Linux gpiod toggle GPIO trước/sau TX.  │
└─────────────────────────────────────────────────────────────────────────────┘
```
- **Yêu cầu từ Hardware Lead:** Xác nhận chính thức Phương án áp dụng (A, B hay C). Nếu là B hoặc C, cung cấp số hiệu chân GPIO/RTS và thông số `delay_rts_before_send` / `delay_rts_after_send` (microsecond).

---

## 4. Tổng quan Kế hoạch Triển khai Track B (Scope & Roadmap)

Sau khi Tờ trình được duyệt, dự án sẽ khởi động **Track B** (Contract v2 & Full Feature Implementation) theo [Plan 49](../../03_implementation/49_MODBUS_RTU_IMPLEMENTATION_PLAN.md).

### 4.1 Danh sách 6 Epic Công việc Track B:

```mermaid
flowchart LR
    B1[Epic B1: Sửa đứt nối 2 tham số Offline F-BE-19/20] --> B2[Epic B2: Nâng Capacity 256 Point & Test Socket Datagram]
    B2 --> B3[Epic B3: Đấu nối luồng Write F-FW-06 & Dirty Flag]
    B3 --> B4[Epic B4: FE/BE Import Export CSV JSON]
    B4 --> B5[Epic B5: Commissioning Tool & Read Write Test]
    B5 --> B6[Epic B6: Nghiệm thu Vật lý RS485 với Đồng hồ & Biến tần]
```

1. **Epic B1 — Sửa đứt nối tham số Offline (F-BE-19 & F-BE-20):** Cập nhật `Persister.Apply` trong BE Go để lưu `offline_after_errors` và `offline_probe_ms` vào file `fieldbus.conf`.
2. **Epic B2 — Nâng giới hạn 256 Modbus Point (Đ-07):** Thay đổi `KX_N_EXT = 256`. Chạy test kiểm chứng trễ copy memory và tính an toàn của buffer datagram socket (~10.3 KB).
3. **Epic B3 — Đấu nối luồng lệnh Ghi End-to-End (F-FW-06):** Hoàn thiện kết nối từ REST Write API (`/api/v1/modbus/points/{id}/write`) xuống cờ dirty/setpoint trong Shared Memory `plc_shm.ext[]` để FW-SOM thực thi ghi xuống thiết bị.
4. **Epic B4 — Tính năng Import/Export (Đ-06):** Triển khai giao diện và API import/export cấu hình Modbus Device & Point theo định dạng CSV và JSON chuẩn.
5. **Epic B5 — Công cụ Thử nghiệm Commissioning:** Hoàn thiện dialog Read/Write Test 2 bước trên UI, hiển thị raw hex byte, tính toán CRC và kết quả giao tiếp tức thì.
6. **Epic B6 — Nghiệm thu Vật lý trên Bo mạch thật (Đ-08):** Đấu nối dây RS485 từ Foxlinx SOM-DDC-24 tới Đồng hồ đo điện và Biến tần Modbus RTU thật. Kiểm thử đọc ghi thời gian thực.

### 4.2 Ước lượng Khối lượng & Phân bổ Nguồn lực:
- **Tổng nỗ lực dự kiến:** **40 – 51 Người-Ngày** (tương đương 4 Sprints phát triển).
- **Phân bổ chi tiết:**
  - **FW-SOM (C++ Engine):** 18 người-ngày.
  - **Backend (Go Web-API):** 14 người-ngày.
  - **Frontend (React/Vite):** 12 người-ngày.
  - **QA / HIL Testing:** 7 người-ngày.

---

## 5. Bảng Biểu quyết & Ký duyệt (Sign-off Matrix)

Kính trình Ban Quản lý Dự án và Các Trưởng bộ phận xem xét và cho ý kiến biểu quyết trực tiếp dưới đây:

| Vai trò người duyệt | Họ và Tên | Ý kiến Biểu quyết | Chữ ký / Xác nhận | Ngày ký |
|---|---|---|---|---|
| **Product Manager** | Ban Quản lý Dự án | `[ ] CHẤP THUẬN`<br>`[ ] KHÔNG CHẤP THUẬN` | | ___/___/2026 |
| **Giám đốc Công nghệ (CTO)** | Ban Giám đốc Kỹ thuật | `[ ] CHẤP THUẬN (ADR-024 Accepted)`<br>`[ ] KHÔNG CHẤP THUẬN` | | ___/___/2026 |
| **System Architect** | Kiến trúc sư Trưởng | `[ ] CHẤP THUẬN (Sửa openapi.yaml)`<br>`[ ] KHÔNG CHẤP THUẬN` | | ___/___/2026 |
| **Hardware Lead** | Trưởng nhóm Phần cứng | `[ ] CHẤP THUẬN (Xác nhận Phương án RS485)`<br>`[ ] KHÔNG CHẤP THUẬN` | | ___/___/2026 |
| **QA / HIL Lead** | Trưởng nhóm Kiểm thử | `[ ] TẠM THUỘC KẾ HOẠCH HIL TRACK B`<br>`[ ] KHÔNG CHẤP THUẬN` | | ___/___/2026 |

---

> **LỜI KẾT:** Khi toàn bộ 05 chữ ký xác nhận trên được hoàn tất, hệ thống sẽ chính thức ghi nhận **`READY_FOR_MODBUS_RTU_IMPLEMENTATION = YES`** và bắt đầu Sprint 1 của Track B.
