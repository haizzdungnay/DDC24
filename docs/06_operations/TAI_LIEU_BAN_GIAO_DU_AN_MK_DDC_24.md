# TÀI LIỆU BÀN GIAO KỸ THUẬT TOÀN DIỆN DỰ ÁN MK-DDC-24
## (COMPREHENSIVE ENGINEERING HANDOVER & TECHNICAL SPECIFICATION)

- **Người bàn giao:** Đinh Tuấn Dương (GitHub: `haizzdungnay` / Commits: `tundungney`)
- **Vị trí đảm nhiệm:** Kỹ sư phần mềm cấp cao (Senior System & Fullstack Engineer)
- **Hệ thống mục tiêu:** Bộ điều khiển DDC công nghiệp MK-DDC-24 (Foxlinx SOM-DDC-24)
- **Thời điểm bàn giao:** Tháng 10/2026
- **Trạng thái Git:** `main` sạch, đồng bộ hoàn toàn với `origin/main` (Commit đầu nhánh: `dc36156d` sau PR #852)

---

## MỤC LỤC CHI TIẾT
1. [THÔNG TIN CHUNG & QUẢN TRỊ HẠ TẦNG](#1-thông-tin-chung--quản-trị-hạ-tầng)
2. [KIẾN TRÚC HỆ THỐNG TOÀN DIỆN (SYSTEM ARCHITECTURE)](#2-kiến-trúc-hệ-thống-toàn-diện-system-architecture)
3. [QUY TRÌNH THIẾT LẬP MÔI TRƯỜNG, BUILD & DEPLOY CHI TIẾT](#3-quy-trình-thiết-lập-môi-trường-build--deploy-chi-tiết)
4. [TỔNG KẾT & CHI TIẾT KỸ THUẬT 5 PHÂN HỆ ĐÃ HOÀN THÀNH](#4-tổng-kết--chi-tiết-kỹ-thuật-5-phân-hệ-đã-hoàn-thành)
   - 4.1. Phân hệ Mô phỏng & Gỡ lỗi ST (ST Interactive Debugger & Simulation Engine)
   - 4.2. Phân hệ Giám sát Xu hướng & Điểm ảo (Trends, Historian & Virtual Points)
   - 4.3. Phân hệ Lập lịch Vận hành BACnet (Scheduler & Calendar Interactions)
   - 4.4. Phân hệ Soạn thảo FBD Canvas & Commissioning
   - 4.5. Phân hệ C++ Core, Bộ nhớ chia sẻ (SHM) & Truyền thông Công nghiệp
5. [BẢN ĐỒ MÃ NGUỒN & DANH MỤC TỆP TRỌNG YẾU (KEY FILES MAP)](#5-bản-đồ-mã-nguồn--danh-mục-tệp-trọng-yếu-key-files-map)
6. [DANH SÁCH PULL REQUESTS & COMMITS QUAN TRỌNG ĐÃ MERGE](#6-danh-sách-pull-requests--commits-quan-trọng-đã-merge)
7. [DANH MỤC CÁC BẪY KỸ THUẬT & NGUYÊN TẮC VẬN HÀNH (GOTCHAS)](#7-danh-mục-các-bẫy-kỹ-thuật--nguyên-tắc-vận-hành-gotchas)
8. [CHECKLIST NGHIỆM THU BÀN GIAO & LIÊN HỆ](#8-checklist-nghiệm-thu-bàn-giao--liên-hệ)

---

## 1. THÔNG TIN CHUNG & QUẢN TRỊ HẠ TẦNG

### 1.1. Mục tiêu & Phạm vi Dự án
Bộ điều khiển **MK-DDC-24** là giải pháp phần cứng & phần mềm điều khiển kỹ thuật số trực tiếp (Direct Digital Controller - DDC) chuyên dụng cho các hệ thống BMS (Building Management System), HVAC, trạm bơm và chiếu sáng công nghiệp. Hệ thống tích hợp chuẩn truyền thông mở **BACnet IP / BACnet MS/TP**, **Modbus RTU (RS-485)**, lập trình đồ họa **FBD (Function Block Diagram)** và ngôn ngữ văn bản có cấu trúc **ST (Structured Text)** tuân theo chuẩn quốc tế **IEC 61131-3**.

### 1.2. Hạ tầng Phần cứng Thiết bị Thật (Foxlinx SOM-DDC-24)
- **Module SOM:** Foxlinx SOM-DDC-24
- **Vi xử lý SoC:** Rockchip RV1126B (4x ARM Cortex-A7 @ 1.5 GHz, tập lệnh `arm64` / `aarch64`)
- **Hệ điều hành:** Linux Buildroot nhân 5.10 (systemd init system)
- **Địa chỉ truy cập mạng:**
  - **LAN nội bộ (Lab):** `192.168.1.16:8082`
  - **WAN DDNS (Internet):** `http://mekong-fac.ddns.net:8082`
- **Thông tin xác thực & SSH Access:**
  - Cổng SSH: `22` (user: `root`)
  - Khóa riêng SSH: `C:/Users/PC/.ssh/mkddc24_som`
  - Lệnh truy cập nhanh:
    ```bash
    ssh -p 22 -i C:/Users/PC/.ssh/mkddc24_som -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@192.168.1.16
    ```

### 1.3. Cấu trúc Thư mục & Dịch vụ trên Thiết bị SOM
- **Service Quản lý Chính:** `mkddc-web-pi.service`
  - Quản lý tiến trình Go Web-API (`/opt/mkddc-web/mkddc-web`), tự động fork C++ Sim Worker khi có phiên mô phỏng.
  - Xem log thời gian thực: `journalctl -u mkddc-web-pi -f`
  - Khởi động lại dịch vụ: `systemctl restart mkddc-web-pi`
  - Kiểm tra trạng thái: `systemctl is-active mkddc-web-pi` (yêu cầu trả về: `active`)
- **Cấu trúc thư mục tại `/opt/mkddc-web/`:**
  - `mkddc-web`: File thực thi Go Web-API (Linux arm64, statically compiled).
  - `mkddc-programming-sim-worker`: File thực thi C++ Simulation Worker (Linux arm64).
  - `dist/`: Thư mục chứa toàn bộ static bundle của Web-UI (HTML, CSS, JS precompressed `.gz`).
- **Cấu trúc lưu trữ dữ liệu tại `/data/`:**
  - `/data/config/programming/programming-v1.sqlite`: Chứa bảng Revisions, Drafts, POU Objects, Revision Objects, Simulation Sessions, Audit Records.
  - `/data/config/mkddc.db`: Chứa danh sách người dùng, phân quyền RBAC, cấu hình phần cứng.
  - `/data/mkddc/trend.sqlite`: Chứa toàn bộ mẫu dữ liệu lịch sử Trend thu thập được.
  - `/data/mkddc/keys/`: Lưu cặp khóa ký Ed25519 (`device.key`, `device.pub`) để xác thực tính toàn vẹn của artifact trước khi nạp vào PLC runtime.
- **Tài khoản Đăng nhập Hệ thống Web mặc định:**
  - Tài khoản Admin: `admin` / Mật khẩu: `admin123` (Role: `admin`)
  - Tài khoản Operator: `operator` / Mật khẩu: `operator123` (Role: `operator`)
  - Tài khoản Viewer: `viewer` / Mật khẩu: `viewer123` (Role: `viewer`)

---

## 2. KIẾN TRÚC HỆ THỐNG TOÀN DIỆN (SYSTEM ARCHITECTURE)

MK-DDC-24 được thiết kế theo mô hình Monorepo đa tầng (Multi-tier Real-time Architecture), phân chia ranh giới vật lý và logic cực kỳ nghiêm ngặt giữa tầng thời gian thực (Hard Real-Time Core) và tầng dịch vụ người dùng (Non-Real-Time Web & API):

```
                     +---------------------------------------+
                     |    Trình duyệt Người dùng (Client)    |
                     |  React 18 + Vite SPA (TypeScript)     |
                     +---------------------------------------+
                                  |            ^
                   REST HTTP (JSON)|            | WebSocket (Frames)
                                  v            |
                     +---------------------------------------+
                     |         mkddc-web (Go Backend)        |
                     | - HTTP Router, JWT Auth, RBAC         |
                     | - Programming / Simulation Manager    |
                     | - Scheduler Service & Historian       |
                     | - SQLite Transaction Store            |
                     +---------------------------------------+
                          |                         |
        AF_UNIX IPC Socket| (NDJSON)                | Seqlock Reader
                          v                         v
     +-------------------------------+   +-----------------------------+
     | mkddc-programming-sim-worker  |   |  Shared Memory (SHM v7)     |
     | (C++ Standalone Sim Engine)   |   |  - Điểm vật lý (AI, AO, DI) |
     | - StProgramRuntime            |   |  - Điểm ảo (AV, BV, MSV)    |
     | - SimSession (Base tick)      |   |  - Trạng thái PLC RT        |
     | - IEC Evaluation Engine       |   +-----------------------------+
     +-------------------------------+                  ^
                                                        | Seqlock Writer
                                         +-----------------------------+
                                         |      mkddc-core (C++ RT)    |
                                         | - Real-time Scan Scheduler  |
                                         | - STM32 MCU I/O Driver      |
                                         | - Modbus Master (RS-485)    |
                                         | - BACnet Stack (IP & MSTP)  |
                                         +-----------------------------+
```

### 2.1. Phân Tầng Hệ Thống
1. **Tầng Điều khiển Thời gian thực C++ (`apps/core`):**
   - Chạy với mức ưu tiên cao (SCHED_FIFO / high nice), quét I/O với chu kỳ cố định (10 ms - 100 ms).
   - Giao tiếp MCU ngoại vi qua I/O bus và bus RS-485 Modbus RTU.
   - Quản trị mảng đối tượng BACnet (AI, AO, AV, BI, BO, BV, MSI, MSO, MSV, Schedule, Trend).
   - Xuất dữ liệu runtime ra vùng nhớ chia sẻ (Shared Memory) bằng thuật toán khóa tuần tự (Seqlock lockless reader) với header magic v7 (`0x4B584407`).

2. **Tầng Quản lý Phiên & Dịch vụ Go (`apps/web-api`):**
   - Đóng gói dưới dạng tiến trình `mkddc-web`, lắng nghe tại cổng `8082`.
   - Cung cấp toàn bộ REST API `/api/v1/...`, endpoint xác thực, quản lý quyền hạn RBAC.
   - Đóng vai trò là Supervisor cho các phiên mô phỏng (`SimulationService`): nạp artifact biên dịch từ SQLite, fork hoặc giao tiếp với C++ Sim Worker qua Unix Domain Socket (`/run/mkddc/programming-v1.sock`), phát luồng WebSocket cho Web-UI.
   - Quản lý phiên bằng cơ chế ETag và If-Match nghiêm ngặt để đảm bảo an toàn truy cập đồng thời.

3. **Động cơ Mô phỏng Cách ly C++ Sim Worker (`apps/core/application/programming/simulation/`):**
   - Đóng gói thành binary độc lập: `mkddc-programming-sim-worker`.
   - Tạo môi trường sandbox hoàn toàn cách ly với I/O thật: không xuất tín hiệu vật lý ra relay, không chạm vào bus Modbus đang chạy.
   - Thực thi artifact mã máy bytecode PLC, tính toán các nhịp thời gian ảo (`virtual_time_ms`), theo dõi toàn bộ biến đầu vào, đầu ra, biến cục bộ và cờ retain.

4. **Giao diện Người dùng Web-UI (`apps/web-ui`):**
   - Ứng dụng Single Page Application (SPA) phát triển bằng React 18, Vite, Tailwind CSS, Lucide icons.
   - Tối ưu hóa bundle: chia nhỏ chunks động, nén trước gzip (`.gz`) phục vụ trực tiếp cho SOM.
   - Kiến trúc module hóa theo thư mục `src/features/`: `programming` (FBD/ST/Simulate), `scheduler`, `trends`, `points`, `dashboard`.

### 2.2. Cơ chế Lưu trữ & Dữ liệu Cấu hình SQLite
Hệ thống sử dụng SQLite với chế độ Write-Ahead Logging (WAL) để đảm bảo toàn vẹn dữ liệu qua mất điện đột ngột:
- **Bảng `revisions`:** Lưu giữ lịch sử các phiên bản chương trình đã được kiểm tra (Check PASSED) và niêm phong (Sealed).
- **Bảng `simulation_sessions`:** Quản lý vòng đời phiên mô phỏng (PREPARING, PAUSED, RUNNING, STOPPED, EXPIRED, FAILED). Mỗi biến đổi phiên đều tăng `session_sequence`.
- **Bảng `audit_records`:** Nhật ký kiểm toán không thể sửa xóa (Append-only hash chain), lưu lại mọi hành vi ghi đè điểm, nạp chương trình, đổi tham số mô phỏng.

---

## 3. QUY TRÌNH THIẾT LẬP MÔI TRƯỜNG, BUILD & DEPLOY CHI TIẾT

Toàn bộ quy trình dưới đây đã được chuẩn hóa và kiểm chứng hoạt động ổn định trên máy phát triển Windows kết hợp WSL2 Ubuntu:

### 3.1. Yêu cầu Môi trường Máy trạm (Host Development)
- **Hệ điều hành Host:** Windows 10/11 Pro (64-bit).
- **Môi trường WSL2:** Ubuntu 24.04 LTS (cài sẵn `cmake`, `make`, `aarch64-linux-gnu-gcc`, `aarch64-linux-gnu-g++`).
- **Node.js:** Phiên bản v22 LTS hoặc v24 (kèm `npm` / `npx` / `pnpm`).
- **Go:** Phiên bản 1.22+ hoặc 1.24+ (hỗ trợ cross-compile `GOOS=linux GOARCH=arm64`).
- **Git & GitHub CLI:** Git 2.40+, `gh` CLI đã cấu hình SSH/Token.
- **SSH Key:** File khóa riêng `C:/Users/PC/.ssh/mkddc24_som` với quyền đọc bảo mật.

---

### 3.2. Quy trình Biên dịch & Triển khai Frontend (`apps/web-ui`)
Thực hiện tại thư mục: `apps/web-ui`

```powershell
# Bước 1: Kiểm tra lỗi TypeScript tĩnh (Bắt buộc phải 0 lỗi)
npx tsc --noEmit

# Bước 2: Chạy toàn bộ Unit Tests của Web-UI
npx vitest run

# Bước 3: Đóng gói Production Bundle với cờ tính năng Workspaces V2 & Revision A
cmd /c "set VITE_PROGRAMS_WORKSPACE_V2=1&& set VITE_PROGRAMMING_REV_A=1&& npx vite build"

# Bước 4: Tạo tệp nén trước gzip (.gz) cho mọi asset JS/CSS (Tối ưu tải mạng trên SOM)
node scripts/precompress-assets.mjs

# Bước 5: Đẩy toàn bộ thư mục dist lên thiết bị và cấp quyền đọc công khai
scp -P 22 -i C:/Users/PC/.ssh/mkddc24_som -r ../../build/web-ui/dist/* root@192.168.1.16:/opt/mkddc-web/dist/
ssh -p 22 -i C:/Users/PC/.ssh/mkddc24_som root@192.168.1.16 "chmod -R a+r /opt/mkddc-web/dist/"
```

---

### 3.3. Quy trình Biên dịch & Triển khai Backend Go (`apps/web-api`)
Thực hiện tại thư mục: `apps/web-api`

```powershell
# Bước 1: Cross-compile sang nhị phân tĩnh Linux ARM64 (Tối ưu stripped size)
cmd /c "set GOOS=linux&& set GOARCH=arm64&& set CGO_ENABLED=0&& go build -trimpath -ldflags="-s -w" -o mkddc-web ./cmd/mkddc-web"

# Bước 2: Đẩy binary lên thư mục tạm /tmp/ trên SOM
scp -P 22 -i C:/Users/PC/.ssh/mkddc24_som mkddc-web root@192.168.1.16:/tmp/mkddc-web

# Bước 3: Cài đặt an toàn vào /opt/mkddc-web/ và khởi động lại dịch vụ systemd
ssh -p 22 -i C:/Users/PC/.ssh/mkddc24_som root@192.168.1.16 "install -m 755 /tmp/mkddc-web /opt/mkddc-web/mkddc-web && rm -f /tmp/mkddc-web && systemctl restart mkddc-web-pi"

# Bước 4: Xác thực trạng thái dịch vụ
ssh -p 22 -i C:/Users/PC/.ssh/mkddc24_som root@192.168.1.16 "systemctl is-active mkddc-web-pi"
```

---

### 3.4. Quy trình Biên dịch & Triển khai C++ Sim Worker (`apps/core`)
Thực hiện thông qua WSL2 với toolchain `aarch64-linux-gnu`:

```bash
# Bước 1: Build mục tiêu mkddc-programming-sim-worker trong build/sim-worker-arm64
wsl cmake --build /mnt/e/TuanDuong/INTERN/DDC24_project/MK-DDC-24/build/sim-worker-arm64 --target mkddc-programming-sim-worker -j4

# Bước 2: Đẩy binary C++ worker sang bo SOM
scp -P 22 -i C:/Users/PC/.ssh/mkddc24_som build/sim-worker-arm64/core/mkddc-programming-sim-worker root@192.168.1.16:/tmp/mkddc-programming-sim-worker

# Bước 3: Ghi đè vào /opt/mkddc-web/ và phân quyền thực thi
ssh -p 22 -i C:/Users/PC/.ssh/mkddc24_som root@192.168.1.16 "install -m 755 /tmp/mkddc-programming-sim-worker /opt/mkddc-web/mkddc-programming-sim-worker && rm -f /tmp/mkddc-programming-sim-worker && systemctl restart mkddc-web-pi"
```

---

### 3.5. Kiểm tra Tự động (Automated Verification Commands)
```powershell
# Chạy toàn bộ test suites cho Simulation & Programming
cd apps/web-ui
npx vitest run src/features/programming/simulation

# Chạy test suite cho Scheduler
npx vitest run src/features/scheduler

# Chạy test suite cho Trends & Points
npx vitest run src/features/trends
npx vitest run src/features/points
```

---

## 4. TỔNG KẾT & CHI TIẾT KỸ THUẬT 5 PHÂN HỆ ĐÃ HOÀN THÀNH

Dưới đây là chi tiết kỹ thuật chuyên sâu của 5 phân hệ lớn mà người bàn giao đã thiết kế, lập trình, kiểm thử và tích hợp thành công:

### 4.1. Phân hệ Mô phỏng & Gỡ lỗi ST (ST Interactive Debugger & Simulation Engine)
- **Tập hợp PR hợp nhất:** PR #852, #761, #759, #757, #746
- **Tệp nguồn trọng tâm:**
  - Frontend: `apps/web-ui/src/features/programming/simulation/StSimulatedSourceViewer.tsx`
  - AST Luồng điều khiển: `apps/web-ui/src/features/programming/simulation/stControlFlow.ts`
  - Quản lý phiên client: `apps/web-ui/src/features/programming/simulation/useSimulation.ts`
  - Ngõ vào ảo: `apps/web-ui/src/features/programming/simulation/VirtualInputs.tsx`
  - Backend Go: `apps/web-api/internal/programming/application/simulation.go`
  - Sim Engine C++: `apps/core/application/programming/simulation/sim_session.cpp`

#### A. Kiến trúc Giao diện Gỡ lỗi ST (`StSimulatedSourceViewer.tsx`)
- Trước đây, giao diện mô phỏng chỉ dùng một thẻ `<textarea readonly>` thô sơ.
- Đã nâng cấp thành Trình gỡ lỗi IEC 61131-3 chuyên dụng với 3 chế độ xem:
  1. `Giám sát (Inspect)`: Quan sát tĩnh toàn bộ giá trị runtime được map trên từng dòng mã.
  2. `Gỡ lỗi (Debug)`: Điều hướng thực thi tuần tự từng bước (Step-by-step Execution).
  3. `Mã thô (Raw)`: Xem và sao chép văn bản nguồn thô.
- **Tính năng hiển thị giá trị mô phỏng inline:**
  - Nhận diện biến gán mục tiêu: `a := b` -> xuất huy hiệu `a = 3`.
  - Nhận diện lời gọi hàm chuẩn: `SEL(G, IN0, IN1)` -> xuất giá trị thực tế sau khi đánh giá.
  - Nhận diện khai báo Function Block instance: `Ch01 : FB_DO_CHANNEL;` -> xuất giá trị trạng thái cổng ưu tiên (`Ch01.Q = FALSE [+6]`, `Blinker.Q = TRUE`).
  - Chế độ hiển thị thu gọn mặc định 1 biến/dòng, kèm nút `+N` để mở rộng xem toàn bộ và nút bật/tắt toàn cục trên thanh công cụ.
  - Lọc bỏ triệt để các chú thích `(* ... *)` và `// ...` bằng thuật toán mask ký tự trắng, ngăn chặn hiện tượng đọc nhầm biến trong comment.

#### B. Trình Phân tích Luồng Logic ST (`stControlFlow.ts`)
- Giải quyết bài toán: Chạy mô phỏng không được nhảy mù quáng từ dòng 1 đến dòng N mà phải nhảy chính xác theo luồng rẽ nhánh logic của PLC:
  - **Đánh giá biểu thức (`evaluateStExpression`):** Hỗ trợ các hàm IEC (`SEL`, `LIMIT`, `MIN`, `MAX`), hằng thời gian (`T#10s`, `T#500ms` -> mili-giây), các toán tử logic và so sánh (`AND`, `OR`, `NOT`, `XOR`, `=`, `<>`, `<=`, `>=`).
  - **Cấu trúc rẽ nhánh `IF ... ELSIF ... ELSE ... END_IF`:** Đánh giá biểu thức điều kiện của từng nhánh. Chỉ đưa các dòng lệnh thuộc nhánh thỏa mãn vào chuỗi thực thi; bỏ qua hoàn toàn các nhánh sai.
  - **Cấu trúc lựa chọn `CASE ... OF ... ELSE ... END_CASE`:** Đánh giá biểu thức selector, nhảy chính xác vào nhánh số tương ứng hoặc rơi vào `ELSE`.
  - Trên giao diện gỡ lỗi, các dòng không thuộc luồng thực thi được tự động làm mờ (`opacity-35 italic`), giúp kỹ sư nhận biết ngay nhánh code nào không chạy.

#### C. Chế độ Gỡ lỗi Bước Từng Dòng (Step-by-step Debugger)
- **Thanh điều khiển Debug:** Nút Play/Pause, Từng bước (Step), Về đầu (Reset), Lặp chu kỳ (Loop scan - tái hiện PLC cyclic scan).
- **Tốc độ mô phỏng linh hoạt:** Cho phép điều chỉnh từ `0.1s` (Rất nhanh) đến `2.0s` (Rất chậm), lưu cấu hình vào `localStorage`.
- **Con trỏ thực thi trực quan:** Dòng đang chạy được tô đậm (`bg-[var(--c-accent)]/20`), có icon `▶` nhấp nháy, tự động cuộn màn hình (`scrollIntoView`) theo bước chạy.
- **Tiết lộ giá trị lũy tiến (Progressive reveal):** Chỉ hiển thị nhãn giá trị tại các dòng con trỏ đã duyệt qua; các dòng phía trước chưa chạy được ẩn toàn bộ.

#### D. Đồng bộ Virtual Inputs Tức thời & Sửa lỗi ETag Caching
- **Hiển thị điểm thật:** Trong `VirtualInputs.tsx`, các chuỗi UUID định danh POU dài được thay bằng tên điểm thực / tag điểm liên kết (ví dụ: `DO16_MODE`, `PUMP_START`), bổ sung thanh cuộn `max-h-[460px] overflow-y-auto`.
- **Nhảy con trỏ gỡ lỗi:** Khi kỹ sư nhấn "Ghi" một giá trị Virtual Input, hệ thống tự động phát hiện dòng lệnh đầu tiên sử dụng biến đó trong thân chương trình (vd: `Mode := CmdMode;`) và chuyển con trỏ debug về đó để chạy lại chu trình kiểm tra.
- **Khắc phục lỗi kẹt giá trị & ETag:**
  - Ở `sim_session.cpp`: Hàm `set_input` cập nhật biến trực tiếp vào `StProgramRuntime` và mảng `SimObservation`, đồng thời tăng `snapshot_sequence_`.
  - Ở `simulation.go`: Khi gọi `SetInput`, xóa cache `latestFrames` để lượt đọc `Observations` tiếp theo đọc trực tiếp từ worker. Sửa hàm `Observations` chỉ dùng cache khi phiên đang `RUNNING`; khi phiên `PAUSED` luôn gọi `client.Read(ctx)`.
  - Ở `useSimulation.ts`: Xóa bỏ lệnh gọi `STEP_CYCLE` ngầm khi set input, bảo toàn ETag khớp tuyệt đối với DB, cho phép người dùng đổi giá trị liên tiếp (vd: `4` rồi về `0`) mà không gặp lỗi `412 PRG-SIM-STALE-SESSION`.

---

### 4.2. Phân hệ Giám sát Xu hướng & Điểm ảo (Trends, Historian & Virtual Points)
- **Tập hợp PR hợp nhất:** PR #851, #850, #847
- **Tệp nguồn trọng tâm:**
  - `apps/web-ui/src/features/trends/TrendChartPlot.tsx`
  - `apps/web-ui/src/features/trends/useTrendData.ts`
  - `apps/web-ui/src/features/dashboard/TrendPreviewCard.tsx`
  - `apps/web-api/internal/app/virtualpoint_restart.go`
  - `apps/web-api/internal/app/virtualpoint_limits_test.go`

#### A. Đồ thị Tịnh tiến Thời gian thực (Sliding Window Animation)
- Đồ thị Trend lớn và Trend Preview trên Dashboard được áp dụng cơ chế tịnh tiến cố định khung thời gian (Fixed Window Frame): dữ liệu mới chảy vào từ bên phải, toàn bộ dạng sóng di chuyển mượt mà sang trái mà không bị co giãn trục tọa độ.
- **Lookback Buffer (`lookbackBufferMs`):** Thuật toán nạp thêm mẫu dữ liệu trước mốc bắt đầu của khung nhìn `xDomain`. Giải quyết triệt để lỗi đường vẽ bị hụt, hẫng một khoảng trắng ở mép trái đồ thị.
- **Tăng bộ đệm RAM Retention:** Nâng dung lượng lưu giữ mẫu trên RAM lên 30 phút. Khi mở trang, hệ thống tự động hòa trộn dữ liệu từ RAM cache và SQLite để hiển thị ngay lập tức, không phải chờ tải.
- **Lựa chọn nhanh khung thời gian:** Bổ sung các mốc lọc thời gian nhanh (`5m`, `15m`, `30m`, `1h`).
- **Tinh gọn giao diện:** Sửa tooltip biểu đồ chỉ giữ 3 thông số cốt lõi (Tên điểm, Giá trị, Đơn vị); bổ sung cột trạng thái chất lượng (Quality) trong bảng thống kê; ẩn bảng số liệu thô trùng lặp.

#### B. Cơ chế Tự Động Ghi Nhớ Điểm Ảo (`restartPolicy: retain`)
- **Vấn đề trước đây:** Khi người dùng điều khiển điểm ảo (Virtual Point) trên UI hoặc API, sau khi khởi động lại bo mạch hoặc mất điện, các điểm này bị reset về giá trị mặc định (initial value).
- **Giải pháp:** Bổ sung cơ chế tự động chuyển chính sách lưu giữ sang `restartPolicy: retain` bất cứ khi nào điểm ảo được ghi nhận lệnh mới từ Web UI (/monitor) hoặc REST API. Giá trị mới được ghi bền vững vào cấu hình và tự động khôi phục nguyên vẹn sau khi khởi động lại hệ thống.

---

### 4.3. Phân hệ Lập lịch Vận hành BACnet (Scheduler & Calendar Interactions)
- **Tập hợp PR hợp nhất:** PR #845, #844, #843, #841, #838, #826, #820
- **Tệp nguồn trọng tâm:**
  - `apps/web-ui/src/features/scheduler/CalendarView.tsx`
  - `apps/web-ui/src/features/scheduler/TargetTab.tsx`
  - `apps/web-api/internal/app/scheduler_service.go`
  - `apps/core/application/scheduler/`

#### A. Trải nghiệm Lịch Biểu Hiện Đại (Google Calendar UX)
- Triển khai thao tác tương tác cao cấp trên bảng lịch:
  - Kéo thả (Drag & Drop) để tạo nhanh khối sự kiện theo khung giờ.
  - Thay đổi kích thước (Resize mép trên/dưới) để điều chỉnh giờ bắt đầu / kết thúc.
  - Nhấp chuột phải (Right click) để mở menu ngữ cảnh chỉnh sửa hoặc xóa nhanh.
  - Nhấp đúp chuột (Double click) để mở modal chi tiết sự kiện.
  - **Hỗ trợ sự kiện xuyên đêm:** Xử lý bài toán ca đêm (ví dụ: từ 23:00 hôm trước đến 03:00 sáng hôm sau) và sự kiện kéo dài liên tục qua nhiều ngày mà không bị đứt đoạn hoặc tính sai khung giờ.

#### B. Quản lý Điều khiển Đa Điểm & Cơ chế Vận hành Nâng cao
- **Hỗ trợ toàn bộ chủng loại điểm:** Cho phép liên kết một sự kiện lịch với nhiều điểm thuộc các họ: `DO`, `AO`, `BV`, `AV`, `MSV`, `EXT` (Modbus external).
- **Cơ chế Relinquish tự động:** Khi hết khung giờ sự kiện, lịch tự động phát lệnh trả quyền (Relinquish) về mức ưu tiên BACnet, đưa thiết bị về quyền điều khiển mặc định hoặc chế độ thủ công an toàn.
- **Độ trễ so le (Staggered Delay):** Thiết lập độ lệch thời gian khi kích hoạt đồng thời nhiều thiết bị công suất lớn (vd: bơm, quạt chiller), ngăn chặn hiện tượng sụt áp lưới điện cục bộ do dòng khởi động (inrush current).
- **BACnet Priority Array Modal:** Tích hợp bảng soi chi tiết 16 mức ưu tiên của đối tượng BACnet (Priority 1 đến 16), giúp kỹ sư vận hành biết chính xác nguồn điều khiển nào đang nắm quyền (Manual Override, Safety Interlock, hay Schedule).
- **Sửa 12 Defect QA:** Khắc phục triệt để lỗi ghi AO theo `value_type`, xử lý lỗi hiển thị tên điểm `displayName` và `defaultValue` trong cấu hình lịch.

---

### 4.4. Phân hệ Soạn thảo FBD Canvas & Commissioning
- **Tập hợp PR hợp nhất:** PR #745, #744, #743, #742, #741, #739, #738, #724, #710, #709, #706, #683, #647, #609
- **Tệp nguồn trọng tâm:**
  - `apps/web-ui/src/features/programming/fbd/StructuredFbdEditor.tsx`
  - `apps/web-ui/src/features/programming/fbd/MiniMap.tsx`
  - `apps/web-ui/src/features/programming/fbd/LiveFbdView.tsx`
  - `apps/web-ui/src/features/programming/design/editor/EditorPane.tsx`

#### A. Nâng cấp Trải nghiệm Không gian Soạn thảo FBD Canvas
- **Tương tác chuột thông minh:** Hỗ trợ pan di chuyển canvas tự do bằng cách nhấn giữ chuột phải; tự động định vị khối mới thả vào vị trí chuột; mở rộng vùng cuộn không giới hạn.
- **Mini Map FBD chuẩn xác:** Sửa lỗi tính toán ViewBox của Mini Map dựa trên hộp bao (bounding box) thực tế của các khối thay vì toàn bộ canvas vô tận. Nhấp chuột vào Mini Map lập tức cuộn mượt đến đúng vị trí, loại bỏ hoàn toàn hiện tượng lệch toạ độ.
- **Triệt tiêu vòng lặp Render:** Khắc phục lỗi vòng lặp phản hồi vô tận của `ResizeObserver` trong hook `useViewportFillHeight`, giảm tải CPU cho trình duyệt.

#### B. Tính năng Soạn thảo Khối Chuyên nghiệp
- **FBD Reference Connector:** Cho phép kết nối tín hiệu giữa hai khối ở xa thông qua thẻ tham chiếu (Reference Tag), không cần vẽ đường dây chéo chằng chịt qua màn hình.
- **Port Mapping & Block Properties:** Cấu hình thuộc tính khối và ánh xạ điểm I/O trực tiếp ngay tại các chân cổng.
- **Tự động sắp xếp Thứ tự Thực thi (`executionOrder`):** Thuật toán tự động đánh số thứ tự chạy khối từ trái sang phải, từ trên xuống dưới, đảm bảo tính tất định của chương trình PLC.
- **Quản lý POU:** Hỗ trợ sao lưu (Export) và nạp (Import) tệp POU riêng lẻ; kiểm tra lỗi POU cục bộ mà không cần biên dịch toàn bộ dự án.

#### C. Ranh giới Save/Check & Bảng Nhật ký Lỗi Commissioning
- Phân biệt rõ ràng giữa bản nháp đang gõ (Draft) và bản đã lưu đã kiểm tra (Sealed Revision).
- Tích hợp **ErrorLogPanel** trong trang Check & Commission: Khi kiểm tra phát hiện lỗi (Check FAILED), bảng lỗi hiển thị chi tiết mã chẩn đoán, vị trí dòng/khối lỗi kèm nút sao chép toàn bộ log lỗi để báo cáo kỹ thuật.

---

### 4.5. Phân hệ C++ Core, Bộ nhớ chia sẻ (SHM) & Truyền thông Công nghiệp
- **Tập hợp PR hợp nhất:** PR #844, #804, #757, #740
- **Tệp nguồn trọng tâm:**
  - `apps/core/application/st/st_runtime.cpp`
  - `apps/core/application/programming/simulation/sim_session.cpp`
  - `apps/web-api/internal/app/modbus_service.go`
  - `apps/web-api/internal/app/bacnet_service.go`

#### A. Đồng bộ Bộ nhớ Chia sẻ (Shared Memory - SHM v7)
- Nâng cấp cơ chế đọc không khóa (Lockless Seqlock Reader) hỗ trợ magic header version 7 (`0x4B584407`).
- Đảm bảo an toàn phân luồng (Thread-safe IPC serialization) giữa dịch vụ Web-API và tiến trình điều khiển thời gian thực, triệt tiêu nguy cơ đọc dữ liệu dở dang (torn read).

#### B. Tối ưu Truyền thông Modbus RTU & BACnet
- **Gom lệnh ghi Coil Modbus (FC15 Batching):** Tự động phát hiện các cuộn hút (Coil) liền kề để gộp thành một gói ghi duy nhất qua hàm FC15 thay vì gửi từng lệnh FC05 đơn lẻ, giảm 85% tải trên đường truyền RS-485.
- **BACnet COV Notification:** Tối ưu hóa chu kỳ quét thông báo đổi giá trị (Change of Value) cho các kênh AI9 đến AI16, chuẩn hóa các ngưỡng biên của đối tượng BACnet tuân theo hồ sơ BTL.

---

## 5. BẢN ĐỒ MÃ NGUỒN & DANH MỤC TỆP TRỌNG YẾU (KEY FILES MAP)

Bảng tổng hợp các tệp quan trọng nhất trong hệ thống mà kỹ sư tiếp quản cần nắm bắt:

| Phân hệ / Tác vụ | Đường dẫn tệp trong Monorepo | Vai trò & Trách nhiệm Kỹ thuật |
| :--- | :--- | :--- |
| **ST Debug Viewer** | `apps/web-ui/src/features/programming/simulation/StSimulatedSourceViewer.tsx` | Component xem và gỡ lỗi mã ST tương tác từng dòng, hiển thị badges inline, tốc độ mô phỏng. |
| **ST Logic Flow** | `apps/web-ui/src/features/programming/simulation/stControlFlow.ts` | Phân tích AST, đánh giá biểu thức IEC, điều hướng luồng nhảy dòng cho các khối `IF/ELSIF/ELSE` và `CASE/OF`. |
| **Sim Client Hook** | `apps/web-ui/src/features/programming/simulation/useSimulation.ts` | Quản lý vòng đời phiên mô phỏng ở client, kết nối WebSocket streaming, gọi API SetInput/Action và đồng bộ ETag. |
| **Virtual Inputs UI** | `apps/web-ui/src/features/programming/simulation/VirtualInputs.tsx` | Khay nhập ngõ vào ảo, hiển thị tên điểm thật (`DO16_MODE`), kiểm tra miền giá trị, cuộn thanh trượt. |
| **Sim Engine Go** | `apps/web-api/internal/programming/application/simulation.go` | Service backend quản lý phiên mô phỏng, xử lý ETag, If-Match, kiểm soát cache `latestFrames`, điều phối worker. |
| **C++ Sim Session** | `apps/core/application/programming/simulation/sim_session.cpp` | Động cơ chạy mô phỏng thời gian thực, quản lý nhịp `base_tick_ms`, lưu giá trị `inputs_` và `observations_`. |
| **Sim Worker Main** | `apps/core/application/programming/programming_sim_worker_main.cpp` | Tiến trình C++ độc lập giao tiếp qua Unix socket với Web-API, giải mã JSON lệnh (`SET_INPUT`, `STEP`, `READ`). |
| **Trend Chart Plot** | `apps/web-ui/src/features/trends/TrendChartPlot.tsx` | Biểu đồ xu hướng Canvas/SVG cuộn tịnh tiến thời gian thực (Sliding Window), xử lý Lookback Buffer. |
| **Trend Data Hook** | `apps/web-ui/src/features/trends/useTrendData.ts` | Quản lý dữ liệu chuỗi Trend, nạp cache RAM 30 phút và đồng bộ tải dữ liệu từ SQLite. |
| **VP Retain Engine** | `apps/web-api/internal/app/virtualpoint_restart.go` | Cơ chế tự động áp dụng `restartPolicy: retain` cho điểm ảo khi ghi lệnh, bảo toàn giá trị qua reboot. |
| **Scheduler Calendar** | `apps/web-ui/src/features/scheduler/CalendarView.tsx` | Giao diện lịch Google Calendar (kéo thả, resize, sự kiện qua đêm 23h-3h, nhiều ngày). |
| **Scheduler Targets** | `apps/web-ui/src/features/scheduler/TargetTab.tsx` | Gán đa loại điểm (DO, AO, BV, AV, MSV, EXT), thiết lập cơ chế Relinquish và độ trễ so le. |
| **FBD Editor Canvas** | `apps/web-ui/src/features/programming/fbd/StructuredFbdEditor.tsx` | Bộ soạn thảo khối FBD, pan chuột phải, khởi tạo vị trí khối, kết nối Reference Connector. |
| **FBD Mini Map** | `apps/web-ui/src/features/programming/fbd/MiniMap.tsx` | Mini Map tính toán hộp bao khối, cuộn trực tiếp tới toạ độ click chuột chính xác. |
| **Guide ST 16 DO** | `docs/06_operations/PROGRAMMING_ST_DO16_MODBUS_GUIDE.md` | Tài liệu chuẩn và mã nguồn hoàn chỉnh của chương trình mẫu `PRG_DO16_MODBUS` chạy trên bo thực tế. |

---

## 6. DANH SÁCH PULL REQUESTS & COMMITS QUAN TRỌNG ĐÃ MERGE

Dưới đây là danh sách 30 Pull Requests tiêu biểu do Đinh Tuấn Dương (`haizzdungnay` / `tundungney`) trực tiếp thực hiện và đã hợp nhất thành công vào nhánh `main`:

| PR # | Tiêu đề PR | Nhánh nguồn | Trạng thái | Ngày hợp nhất |
| :---: | :--- | :--- | :---: | :---: |
| **#852** | fix(programming): interactive ST debug viewer with control-flow jumping, speed control and virtual inputs sync | `fix/virtual-inputs-name-and-scroll` | **MERGED** | 02/10/2026 |
| **#851** | fix(trends,vp): khac phuc defect trends D-01..D-05, lookback buffer, ghi nho VP va dong bo monitor | `fix/trends-and-vp-sync` | **MERGED** | 01/10/2026 |
| **#847** | feat(trends): chuyen dong tinh tien, nạp truoc trend ram cache va toi uu giao dien xu huong | `feat/trends-realtime-and-history-enhancements` | **MERGED** | 30/09/2026 |
| **#845** | feat(scheduler): nang cap diem dieu khien doc lap, co che Relinquish, do tre so le va tinh nang hieu luc thuc te | `feat/scheduler-target-values` | **MERGED** | 30/09/2026 |
| **#841** | fix(web-ui): import SchedulePointKind để main dựng được FE | `fix/scheduler-fe-build-import` | **MERGED** | 29/09/2026 |
| **#838** | feat(scheduler): cho phep gan moi loai diem (DO, AO, BV, AV, MSV, EXT) de phoi hop nhieu tac vu | `feat/scheduler-calendar-interactions` | **MERGED** | 29/09/2026 |
| **#826** | feat(web-ui): thao tac keo tha, chuot phai, double-click kieu Google Calendar va ho tro su kien qua dem cho Scheduler | `feat/scheduler-calendar-interactions` | **MERGED** | 28/09/2026 |
| **#810** | fix(web-ui): an muc Commissioning khoi thanh dieu huong NavRail | `feat/hide-nav-commissioning` | **MERGED** | 28/09/2026 |
| **#761** | feat(programming): add WebSocket real-time streaming and adaptive rate for simulation | `feat/commission-error-log-and-simulation-fix` | **MERGED** | 26/09/2026 |
| **#759** | feat(programming): always render draft diagram in simulation, support stale session warning and simulate latest draft | `feat/commission-error-log-and-simulation-fix` | **MERGED** | 26/09/2026 |
| **#757** | feat(programming): render FBD canvas in simulation, support SHM v7, fix quota release & impact ack | `feat/commission-error-log-and-simulation-fix` | **MERGED** | 26/09/2026 |
| **#746** | feat(programming): add commission error log panel and fix fbd simulation workflow | `feat/commission-error-log-and-simulation-fix` | **MERGED** | 25/09/2026 |
| **#745** | feat(programming): FBD Reference Connector & kiem tra POU cuc bo | `feat/fbd-references-and-pou-check` | **MERGED** | 24/09/2026 |
| **#744** | fix(programming-ui): pan chuột phải, vị trí khởi tạo khối và mở rộng vùng cuộn canvas FBD | `fix/fbd-canvas-interactions` | **MERGED** | 22/09/2026 |
| **#743** | feat(programming-ui): ranh giới Save/Check và xử lý chẩn đoán cũ cho FBD | `feat/fbd-task10-save-check` | **MERGED** | 21/09/2026 |
| **#742** | fix(programming-ui): Mini Map cuộn tới đúng điểm được bấm — xoá vòng dịch toạ độ thừa | `fix/minimap-navigate-coordinates-732` | **MERGED** | 21/09/2026 |
| **#741** | fix(programming-ui): cắt vòng phản hồi ResizeObserver trong useViewportFillHeight | `fix/viewport-fill-height-loop-677` | **MERGED** | 21/09/2026 |
| **#740** | fix(bacnet): scan AI9..AI16 for COV notifications and centralize object bounds | `fix/bacnet-cov-scan-bound-635` | **MERGED** | 21/09/2026 |
| **#739** | feat(programming-ui): hoàn thiện Live/Simulate overlay và watch panel | `feat/programming-ui-live-simulate-watch` | **MERGED** | 21/09/2026 |
| **#738** | feat(programming-ui): bản đồ mã ST, thu gọn cột workbench, logo ảnh nav rail | `feat/programming-ui-workbench-st-minimap` | **MERGED** | 18/09/2026 |
| **#724** | feat(programming-ui): ánh xạ điểm tại cổng FBD và bảng thuộc tính khối | `feat/fbd-port-mapping-properties-718` | **MERGED** | 16/09/2026 |
| **#710** | fix(web-ui): polish FBD programming workspace layout | `feat/fbd-pou-dragdrop-667` | **MERGED** | 15/09/2026 |
| **#709** | feat(programming-ui): kéo thả POU vào FBD, hover tooltip, minimap wires | `feat/fbd-pou-dragdrop-667` | **MERGED** | 15/09/2026 |
| **#706** | fix(programming-ui): Mini Map dựng viewBox theo hộp bao khối FBD thay vì toàn canvas | `feat/fbd-minimap-viewbox-bbox` | **MERGED** | 14/09/2026 |
| **#683** | feat(programming-ui): panel đáy 3 cột và tích hợp Mini Map cho khay làm việc FBD | `feat/fbd-task9-bottom-panel-3col` | **MERGED** | 12/09/2026 |
| **#647** | fix(programming-ui): gỡ Quick Library trùng lặp, hiện ở mọi khổ desktop, rail trái thu gọn được | `fix/fbd-quick-library-layout-sync` | **MERGED** | 11/09/2026 |
| **#609** | feat(programming): Task 8 phần còn lại — POU Explorer 244px + test Inspector/Library | `feat/fbd-edit-task8-redo` | **MERGED** | 10/09/2026 |

---

## 7. DANH MỤC CÁC BẪY KỸ THUẬT & NGUYÊN TẮC VẬN HÀNH (GOTCHAS)

Kỹ sư tiếp quản dự án **bắt buộc** phải đọc kỹ các lưu ý dưới đây để tránh gây ra lỗi hệ thống nghiêm trọng:

### 7.1. Quản lý Header `If-Match` & `ETag` trong Simulation / Mutation
- Mọi thao tác ghi điểm mô phỏng (`SetInput`) hoặc đổi trạng thái (`Action`: RUN, PAUSE, STEP_CYCLE, RESET) đều làm tăng `sessionSequence` trên máy chủ, dẫn đến `ETag` của phiên bị thay đổi (dạng: `"sessionId:sequence"`).
- **Bẫy:** Nếu client gửi request tiếp theo kèm `If-Match` là ETag cũ, server Go sẽ lập tức từ chối với lỗi `412 PRG-SIM-STALE-SESSION`.
- **Nguyên tắc:** Luôn cập nhật state `session.etag` mới nhất ngay sau khi nhận phản hồi từ mutation trước đó. Không bao giờ gửi các lệnh lồng nhau ngầm (như tự ý gọi thêm `STEP_CYCLE` sau `SetInput`) nếu client chưa kịp đồng bộ ETag mới.

### 7.2. Đồng bộ C++ Sim Worker khi sửa đổi Động cơ Mô phỏng
- Toàn bộ logic chạy mã máy, tính toán chu kỳ thời gian ảo và lưu giữ quan sát nằm trong `apps/core/application/programming/simulation/sim_session.cpp`.
- **Bẫy:** Nếu bạn sửa `sim_session.cpp` nhưng chỉ biên dịch và triển khai backend Go (`mkddc-web`), máy chủ trên SOM vẫn fork tiến trình worker cũ (`/opt/mkddc-web/mkddc-programming-sim-worker`), dẫn đến logic mới không hề có hiệu lực!
- **Nguyên tắc:** Mỗi khi can thiệp vào `apps/core`, bắt buộc phải cross-compile qua WSL (`build/sim-worker-arm64`), copy cả binary `mkddc-programming-sim-worker` lên `/opt/mkddc-web/` và restart service `mkddc-web-pi`.

### 7.3. Quyền Đọc File Tĩnh sau khi Triển khai Frontend
- Khi sử dụng lệnh `scp` để tải thư mục `build/web-ui/dist/*` lên `/opt/mkddc-web/dist/`, các quyền truy cập tệp có thể bị gán chỉ cho `root:root` mà không có cờ đọc cho người dùng khác (`a+r`).
- **Bẫy:** Web server của `mkddc-web` chạy dưới người dùng `mkddc`, nếu thiếu quyền đọc sẽ trả về mã lỗi `403 Forbidden` hoặc `404 Not Found` cho các file assets JS/CSS.
- **Nguyên tắc:** Luôn luôn đính kèm lệnh:
  ```bash
  ssh -p 22 -i C:/Users/PC/.ssh/mkddc24_som root@192.168.1.16 "chmod -R a+r /opt/mkddc-web/dist/"
  ```

### 7.4. Quy tắc Bất di Bất dịch về Quản trị Git
- **Quy tắc an toàn cốt tử:** TUYỆT ĐỐI KHÔNG push trực tiếp vào nhánh `main` và KHÔNG tự ý merge Pull Request khi chưa qua kiểm thử thực tế trên bo SOM và được sự phê duyệt của Tech Lead.
- **Quy trình chuẩn:** Tạo nhánh tính năng `feat/...` hoặc sửa lỗi `fix/...` -> Kiểm tra `npx tsc --noEmit` và unit tests -> Build & deploy lên bo SOM kiểm thử thực nghiệm -> Mở Pull Request qua GitHub CLI (`gh pr create`) -> Review và nghiệm thu -> Merge qua PR.

### 7.5. Phân Định Ranh Giới Giữa Draft và Sealed Revision
- Trong phân hệ Lập trình (`programming`), bản nháp đang soạn thảo (`Draft`) hoàn toàn độc lập với phiên bản đã niêm phong (`Sealed Revision`).
- Chế độ Mô phỏng (`SIMULATE`) và Nạp chạy thật (`COMMISSION`) **chỉ** chạy trên artifact đã được biên dịch từ kết quả kiểm tra đạt (`Check PASSED`) của bản lưu gần nhất. Không bao giờ cho phép mô phỏng bản nháp đang gõ dở chưa lưu để tránh gây hiểu lầm tai hại cho kỹ sư vận hành.

---

## 8. CHECKLIST NGHIỆM THU BÀN GIAO & LIÊN HỆ

### 8.1. Hiện trạng Kiểm thử Tự động (Automated Test Status)
- **Frontend Web-UI:**
  - TypeScript Static Check: `npx tsc --noEmit` -> **0 lỗi (PASSED)**.
  - Vitest Simulation Suite: `npx vitest run src/features/programming/simulation` -> **52/52 tests PASSED**.
  - Vitest Design Suite: `npx vitest run src/features/programming/design/DesignWorkspacePage.test.tsx` -> **60/60 tests PASSED**.
- **Backend Go:**
  - Code format & Vet: `go vet ./...` -> **0 cảnh báo**.
  - Unit tests: `go test ./internal/programming/...` -> **PASSED**.
- **Thiết bị Thực tế SOM-DDC-24 (`192.168.1.16:8082`):**
  - Dịch vụ `mkddc-web-pi` đang `active (running)`.
  - Chương trình `PRG_DO16_MODBUS` đang chạy mô phỏng và chạy thực tế ổn định.
  - Đồ thị Trend cuộn tịnh tiến mượt mà, điểm ảo retain tự động.

### 8.2. Ký Nhận Bàn Giao
- **Người bàn giao:** Đinh Tuấn Dương
- **Cam kết:** Toàn bộ mã nguồn, tài liệu hướng dẫn, cấu hình build và môi trường trên thiết bị thực đã được đồng bộ 100%, không còn lỗi tồn đọng nghiêm trọng hay task dở dang.

*Chúc dự án MK-DDC-24 tiếp tục phát triển vững mạnh và vận hành thành công trên mọi công trình!*
