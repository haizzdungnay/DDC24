# BÁO CÁO NGHIỆM THU VÀ BÀN GIAO KỸ THUẬT SCHEDULER ENGINE V3.1
**Dự án:** Bộ điều khiển MK-DDC-24 (Foxlinx SOM RV1126B / Linux aarch64)  
**Ngày lập:** 2026-09-29  
**Căn cứ kiểm thử:** Báo cáo QA thực địa `qa-evidence/2026-09-29-sch-v31/BAO-CAO-QA-Scheduler-v3.1-SCH-001.md`  
**Người nhận:** 
1. Ban Quản lý & Người Nghiệm thu Dự án MK-DDC-24
2. Đội ngũ Kỹ thuật Phát triển (Firmware C++ Core, Web Backend Go, Web Frontend React)

---

## PHẦN I: DÀNH CHO NGƯỜI NGHIỆM THU DỰ ÁN (EXECUTIVE & ACCEPTANCE SUMMARY)

### 1. Đánh giá tổng quan tính năng Scheduler v3.1
Đợt kiểm thử thực địa ngày 2026-09-29 trên thiết bị SOM Foxlinx MK-DDC-24 (IP LAN: `192.168.1.16`, WAN DDNS: `mekong-fac.ddns.net`) đối với Lịch tuần `SCH-001` (AHU 1) ghi nhận các kết quả trọng yếu:

#### 1.1 Điểm sáng kỹ thuật nền tảng (C++ Core Engine: ĐẠT XUẤT SẮC - 100% PASS)
- **Độ chuẩn xác thời gian thực:** Lệnh đóng/ngắt thiết bị thi hành chính xác đến từng giây theo đồng hồ hệ thống NTP (sai số thời gian phát lệnh < 0.5s).
- **Khởi động so le (Staggered Start Delay):** Kích hoạt trễ đúng 15 giây cho AO-01 (15:25:00 giữ chờ -> 15:25:15 mở lệnh 85%). Triệt tiêu hoàn toàn nguy cơ sụt áp lưới và sốc tải cơ khí AHU khi khởi động đồng loạt.
- **Cơ chế Nhả quyền theo chuẩn BACnet (Relinquish / Set NULL):** Khi hết giờ (15:26:30), AO-01 nhả slot điều khiển `RELINQUISHED` thay vì ép ghi đè 0. Lệnh can thiệp khẩn cấp bằng tay (Manual Override 3V) làm chủ tức thì; khi lệnh tay nhả ra, điểm tự động hồi phục về giá trị sàn (Relinquish Default). Đạt chuẩn ASHRAE 135.
- **Tính toàn vẹn cấu hình (Publish All-or-Nothing):** Quy trình biên dịch, kiểm duyệt cấu hình, tăng số phiên bản revision và ghi vết audit có khả năng rollback đạt độ tin cậy cao.

#### 1.2 Tồn tại tầng Giao diện & Trải nghiệm Vận hành (Web UI: CHƯA ĐẠT)
- **Thiếu cập nhật thời gian thực:** Màn hình giám sát không tự làm mới dữ liệu (Live Polling hoặc SSE/WebSocket). Người vận hành phải ấn F5 hoặc tải lại trang mới thấy được bộ đếm lùi so le và trạng thái đổi màu của điểm.
- **Modal soi mức ưu tiên (Priority Stack) chưa đồng bộ với Core:** Bảng 16 mức trên UI được dựng mô phỏng tĩnh từ trình duyệt, chưa đọc mảng trọng tài 6 mức thực tế từ Core. Khi điểm bị ghi đè lệnh tay, modal vẫn hiển thị thông tin sai lệch.
- **Lẫn lộn đơn vị kỹ thuật:** Cột "Giá trị thật" tự động gắn thêm ký tự `%` vào giá trị đo điện áp thật (ví dụ 8.5 V bị hiển thị thành `8.5 %`, lệnh tay 3 V hiển thị thành `3 %`).

#### 1.3 Cảnh báo An ninh Mạng Cấp thiết (BẢO MẬT: CRITICAL RISK)
- Mật khẩu mặc định `admin/admin123` vẫn hoạt động trong khi cổng 8082 đang được mở công khai ra Internet qua DDNS.
- Đã ghi nhận địa chỉ IP công cộng lạ (`101.99.36.34`) truy cập vào các trang cấu hình lịch trên thiết bị. Kẻ tấn công có thể can thiệp trực tiếp vào quy trình bật/tắt thiết bị vật lý qua tài khoản này.
- Khóa bảo mật `JWT_SECRET` đã bị lộ một phần trong quá trình khảo sát, cần phải xoay (rotate) ngay lập tức.

---

### 2. So chuẩn đối chiếu năng lực với các hệ thống BMS quốc tế

| Tiêu chí kỹ thuật | Chuẩn quốc tế (Niagara 4, Desigo CC, Metasys) | Trạng thái hiện tại trên MK-DDC-24 | Đánh giá nghiệm thu |
|---|---|---|---|
| **Cơ chế Nhả quyền (Relinquish)** | Bắt buộc (ASHRAE 135: ghi NULL nhả slot) | Đã có: Nhả lệnh `RELINQUISHED`, nhường quyền FBD/lệnh tay | **ĐẠT (Tương đương)** |
| **Độ trễ so le (Stagger Delay)** | Chuẩn hóa 0..300s chống sốc phụ tải | Đã có: Cài đặt độc lập từng điểm, đếm lùi chính xác | **ĐẠT (Tương đương)** |
| **Quy trình Phê duyệt Lịch** | Ghi revision, lý do thay đổi, audit log | Đã có: Revision, validate rule, audit JSONL, có rollback | **ĐẠT (Vượt trội)** |
| **Mảng điểm hỗn hợp (Heterogeneous)** | Cho phép gán linh hoạt mọi loại điểm I/O | Đã có: Hỗ trợ cả 6 loại điểm (DO, AO, BV, AV, MSV, EXT) | **ĐẠT (Tương đương)** |
| **Giám sát trực tiếp (Live Update)** | Bắt buộc (COV / Live stream không cần reload) | Chưa có: Phải F5 trang web mới thấy trạng thái mới | **CHƯA ĐẠT (Cần fix)** |
| **Soi mảng ưu tiên thực (Priority View)** | Đọc trực tiếp `Priority_Array` thực tế từ Core | Chưa có: Giao diện tự suy đoán, hiển thị sai khi có lệnh tay | **CHƯA ĐẠT (Cần fix)** |
| **Chuẩn hóa thang đo đơn vị** | Đối tượng có `Units`, hiển thị đúng V/mA/% | Chưa có: Lẫn lộn đơn vị % và Vôn trên bảng hiển thị | **CHƯA ĐẠT (Cần fix)** |

---

### 3. Kết luận Nghiệm thu (Acceptance Verdict)

> ### 🛑 KẾT LUẬN: TẠM HOÃN KÝ CHẤP THUẬN NGHIỆM THU (CONDITIONAL HOLD)
> **Căn cứ quyết định:**
> 1. Về mặt kỹ thuật điều khiển cốt lõi (Firmware/Core Engine), tính năng Scheduler v3.1 đã đạt 100% yêu cầu thiết kế và tương đương với các giải pháp BMS hàng đầu thế giới.
> 2. Tuy nhiên, sản phẩm **CHƯA ĐỦ ĐIỀU KIỆN BÀN GIAO THỰC ĐỊA** do tồn tại lỗ hổng bảo mật mức độ CRITICAL (mật khẩu mặc định mở ra Internet) và 3 lỗi hiển thị mức HIGH có thể gây hiểu sai nghiêm trọng cho kỹ sư vận hành tòa nhà.

---

### 4. Điều kiện Tiên quyết để Nghiệm thu Chính thức (Sign-off Checklist)

Để Hội đồng Nghiệm thu ký biên bản chấp thuận bàn giao tính năng Scheduler v3.1, các điều kiện sau bắt buộc phải hoàn thành:

- [ ] **GATE-SEC-01 (Bắt buộc):** Đóng cổng NAT WAN 8082 trên router mạng hoặc bắt buộc chuyển sang VPN (WireGuard/Tailscale). Thay đổi toàn bộ mật khẩu tài khoản mặc định `admin`.
- [ ] **GATE-SEC-02 (Bắt buộc):** Xoay chuỗi bí mật `JWT_SECRET` trong `/etc/mkddc-web.env` và khởi động lại dịch vụ web.
- [ ] **GATE-SAFETY-01 (Bắt buộc):** Xóa bỏ khối sự kiện kiểm thử định kỳ thứ Ba (15:25:00 - 15:26:30) trên lịch `SCH-001`, khôi phục về trạng thái an toàn trước khi cấp điện cho tủ AHU thật.
- [ ] **GATE-UI-01 (Bắt buộc):** Khắc phục lỗi D-02: Bổ sung Live Polling chu kỳ 1.0s tại tab "Điểm điều khiển" để hiển thị trạng thái và đếm lùi thời gian thực mà không cần reload trang.
- [ ] **GATE-UI-02 (Bắt buộc):** Khắc phục lỗi D-01 & D-03: Đồng bộ Modal soi mức ưu tiên với mảng trọng tài 6 mức thực tế từ Core Resolver, loại bỏ dữ liệu nội suy giả.
- [ ] **GATE-UI-03 (Bắt buộc):** Khắc phục lỗi D-04 & D-05: Sửa nhãn hiển thị đơn vị `%` thành `V` cho các điểm AO và cung cấp thông báo dải giá trị hợp lệ khi kỹ sư can thiệp lệnh tay.

---

## PHẦN II: DÀNH CHO ĐỘI DEV FIRMWARE & WEB (ENGINEERING HANDOFF)

### 1. Ma trận 12 Defect Kỹ thuật (D-01 đến D-12)

| Mã lỗi | Mức | Phân hệ | Tóm tắt lỗi | Vị trí mã nguồn |
|---|---|---|---|---|
| **D-01** | **HIGH** | Web UI / Core | Modal Priority Stack tự suy diễn số liệu, không đọc từ Core. Khi có lệnh tay 3V, modal vẫn báo P8 NULL. | `TargetTab.tsx:477-535` |
| **D-02** | **HIGH** | Web UI | Tab "Điểm điều khiển" không tự động cập nhật. Bộ đếm lùi "còn ~Ns" đứng yên, trạng thái không đổi nếu không F5. | `useScheduler.tsx:51-71` |
| **D-03** | **HIGH** | Core / UI | Nhãn ưu tiên ngược thực tế: Web ghi Lịch là P16 (thua FBD P15), nhưng Core chạy `PRIO_SCHEDULE=4` thắng `PRIO_LOCAL_LOGIC=5`. | `priority_resolver.hpp:14-20` |
| **D-04** | **MEDIUM** | Web UI | Cột "Giá trị thật" tự gắn `%` vào giá trị V: hiển thị "8.5 %" khi là 8.5V, "3 %" khi lệnh tay 3V. | `TargetTab.tsx:322` |
| **D-05** | **MEDIUM** | Core / Web API| Lệch đơn vị: Lịch nhận %, lệnh tay nhận V (0..10V). Ép lệnh ngoài dải trả 409 chung chung không kèm giới hạn. | `schedule_runtime.cpp:518`, `pointforce.go` |
| **D-06** | **MEDIUM** | Web UI | Nút Publish bị khóa sau khi bấm Lưu (do so sánh dirty JSON draft lệch vì server bỏ trường null hoặc runtime). | `ScheduleEditorPage.tsx:52-55, 188-189` |
| **D-07** | **LOW** | Web API / Core | Runtime actual_value luôn là null. DO written_value trả chuỗi "ACTIVE" thay vì số nguyên 1. | `scheduleruntime.go`, `web_ipc.cpp` |
| **D-08** | **LOW** | Web UI | Nhập Stagger ngoài khoảng 0..300s bị tự động ép giá trị biên mà không có thông báo lỗi trên form. | `TargetTab.tsx` (input stagger) |
| **D-09** | **LOW** | Firmware Core | Core systemd journal không ghi INFO log khi lịch chuyển trạng thái hoặc ghi điểm vật lý. | `schedule_runtime.cpp` |
| **D-10** | **LOW** | Web UI | Nút mở modal Layers thiếu thuộc tính trợ năng aria-label. | `TargetTab.tsx:336` |
| **D-11** | **LOW** | Web UI / API | Header báo "DEGRADED - Dữ liệu 58s" do lệch đồng hồ giữa PC client và thiết bị DDC. | `HeaderBar.tsx` |
| **D-12** | **INFO** | Commissioning | Các điểm DO/AO trên bo chưa có tên mô tả display_name, khiến dropdown hiện DO-01 — DO-01. | Cấu hình database điểm I/O |

---

### 2. Kế hoạch Khắc phục Kỹ thuật Chi tiết

#### 2.1 Nhóm Trọng tài Ưu tiên (D-01 & D-03)
- **Root cause:** 
  1. `PriorityResolver` trong Core C++ quản trị 6 slot ưu tiên (`1: FIRE_SAFETY`, `2: LOCAL_MANUAL`, `3: BACNET`, `4: SCHEDULE`, `5: LOCAL_LOGIC`, `6: DEFAULT`), trong đó số nhỏ thắng (Schedule mức 4 ưu tiên hơn Local Logic mức 5).
  2. Giao diện Web tự ánh xạ sang 16 mức của BACnet và giả định Schedule là P16 (thấp hơn FBD P15), dẫn đến sai lệch bản chất. Đồng thời Web không có endpoint để đọc mảng này nên phải tự suy đoán.
- **Giải pháp:**
  - **Firmware Core:** Bổ sung hàm `PriorityResolver::snapshot(int point_type, int ch)` trả về mảng 6 slot (active, value, source, winning_level). Serialize cấu trúc này qua Web IPC.
  - **Web Backend Go:** Bổ sung REST endpoint `GET /api/v1/points/{id}/priority-array`.
  - **Web Frontend:** Sửa modal `PriorityStackModal`, hiển thị đúng 6 mức thực tế của bộ điều khiển, kèm chú giải tương quan chuẩn BACnet.

#### 2.2 Nhóm Cập nhật Thời gian thực (D-02)
- **Root cause:** `useScheduler` chỉ fetch API lúc mount trang hoặc khi bấm Save/Validate/Publish. Khi sự kiện lịch diễn ra, state của React không tự cập nhật.
- **Giải pháp:**
  - Tại `TargetTab.tsx`, khai báo `useEffect` poll định kỳ `/api/v1/schedules/{id}/runtime` mỗi 1000ms.
  - Đếm lùi mượt mà: Với các target có `write_result === 'DELAYED'` và `delay_remaining_sec > 0`, client tạo timer cục bộ giảm dần mỗi giây để UI hiển thị số đếm lùi liên tục.

#### 2.3 Nhóm Đơn vị & Giới hạn Can thiệp (D-04 & D-05)
- **Root cause:** Giá trị trả về của điểm AO từ `/api/v1/points/AO-xx` là giá trị kỹ thuật thực tế (Vôn hoặc mA). `TargetTab.tsx` gán cứng `%`.
- **Giải pháp:**
  - **Web UI:** Đọc thuộc tính `pt.unit` hoặc `pt.electrical_type` để gắn nhãn đúng (V hoặc mA).
  - **Web API Go & Core:** Khi lệnh ép tay vượt dải kỹ thuật (ví dụ gửi 30V cho kênh 0-10V), trả HTTP 422 kèm payload `{"code": "OUT_OF_RANGE", "min": 0.0, "max": 10.0, "unit": "V"}`.

#### 2.4 Nhóm Nút Publish bị khóa sau Save (D-06)
- **Root cause:** Logic dirty kiểm tra `JSON.stringify(draft) !== JSON.stringify(saved)`. Server Go trả về object có lược bỏ các trường null hoặc runtime, khiến 2 chuỗi JSON lệch nhau.
- **Giải pháp:** Sau khi `apiClient.updateSchedule` trả về thành công với object `updated`, thực hiện đồng bộ ngay: `upsert(updated); setDraft(structuredClone(updated));`. Loại bỏ các thuộc tính không cần thiết (`runtime`, `findings`) trước khi so sánh dirty.

---

### 3. Quy trình Xử lý Khẩn cấp Lỗ hổng An ninh (S-01 & S-02)

1. **Bước 1: Cách ly cổng dịch vụ khỏi mạng Internet công cộng**
   - Truy cập modem/router Internet, gỡ bỏ quy tắc Port Forwarding cổng 8082.
   - Chuyển hướng truy cập từ xa toàn bộ qua VPN (WireGuard hoặc Tailscale).
2. **Bước 2: Thay đổi mật khẩu tài khoản quản trị**
   - Đăng nhập SSH vào bo: `ssh -i C:/Users/PC/.ssh/mkddc24_som root@192.168.1.16`
   - Đổi mật khẩu tài khoản admin trong cơ sở dữ liệu xác thực.
3. **Bước 3: Xoay chuỗi bí mật JWT**
   - Cập nhật JWT_SECRET ngẫu nhiên mới trong `/etc/mkddc-web.env` và khởi động lại dịch vụ `mkddc-web-pi.service`.
4. **Bước 4: Dọn dẹp sự kiện kiểm thử trên SCH-001**
   - Xóa bỏ khối sự kiện thứ Ba (`15:25:00 - 15:26:30`) trên `SCH-001` để tránh kích hoạt ngoài mong muốn vào các tuần tới.

---

### 4. Bảng Phân công & Tiến độ Đề xuất (Sprint Backlog)

| Thứ tự | Hạng mục công việc | Người thực hiện | Thời gian dự kiến | Tiêu chí hoàn thành (DoD) |
|---|---|---|---|---|
| **1** | Đóng port WAN 8082, đổi pass admin, xoay JWT Secret (S-01, S-02) | DevOps / SysAdmin | 2 giờ | Không còn truy cập bằng admin123; WAN 8082 đóng |
| **2** | Xóa khối test thứ Ba trên SCH-001 | Commissioning Eng | 15 phút | Lịch SCH-001 sạch cấu hình test |
| **3** | Sửa Web UI: Polling runtime 1s & đếm lùi Stagger (D-02) | Web Frontend Dev | 4 giờ | UI tự đổi màu và đếm lùi không cần F5 |
| **4** | Sửa Web UI: Sửa nhãn đơn vị % thành V, fix dirty nút Publish (D-04, D-06, D-10) | Web Frontend Dev | 3 giờ | Hiển thị đúng đơn vị V; Save xong Publish được ngay |
| **5** | Firmware Core & Web BE: API Priority Array thực tế (D-01, D-03) | Firmware + Go BE | 1 ngày | Endpoint trả 6 mức thực tế từ Core Resolver |
| **6** | Web UI: Tích hợp Priority Stack Modal đọc từ API mới | Web Frontend Dev | 4 giờ | Modal hiển thị chính xác mức thắng thực tế khi ép tay |
| **7** | Firmware Core: Bổ sung log INFO chuyển trạng thái lịch (D-09) | Firmware Dev | 2 giờ | Journalctl hiển thị log chuyển mạch lịch rõ ràng |
