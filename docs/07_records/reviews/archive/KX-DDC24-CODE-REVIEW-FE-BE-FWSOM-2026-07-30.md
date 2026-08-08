# Báo cáo review code: FE + BE + FW SOM — 2026-07-30

> **HỒ SƠ LỊCH SỬ — lưu trữ 2026-08-08.** Không dùng làm nguồn chuẩn. Lý do lưu
> trữ và tài liệu thay thế: [`archive/README.md`](README.md). Mọi đường dẫn source
> trong tài liệu này theo cây thư mục **trước** `PLAN-ARCH-RESTRUCT-002`; bảng ánh
> xạ sang vị trí hiện tại ở [chỉ mục hồ sơ rà soát](../README.md).

- Phạm vi: `src/frontend/` (FE), `web/backend/` (BE Go), `services/core` + `services/iobus` + `services/hmi` + `services/netcfg` + `shared/mkddc_shm.h` (FW SOM), `packaging/`, `tools/`, `.github/workflows/` (gate CI).
- Mốc code: nhánh `main` tại `7ea3ac5`, cộng thay đổi chưa commit trong working tree.
- Kiểu review: đọc code theo luồng dữ liệu + chạy lại toàn bộ gate build/test để xác nhận độc lập.
- Người review: Claude Code (agent review).
- Trạng thái: **hoàn chỉnh** (Rev 2 — bổ sung vòng review thứ hai, đóng toàn bộ giới hạn đã nêu ở Rev 1).

## 1. Tình trạng diff đang xét

Diff commit được (`git diff main...HEAD`) **rỗng**. Working tree chỉ có 2 file thay đổi:

| File | Nội dung |
|------|----------|
| `.gitignore` | thêm `/audit-handover-*/` |
| `CHANGELOG.md` | thêm entry hồ sơ bàn giao auditor + entry của chính báo cáo này |

Cả hai đều là thay đổi tài liệu/công cụ, **không có rủi ro chức năng**. Vì vậy review được mở rộng sang chính source của FE/BE/FW SOM theo yêu cầu.

Ghi chú về mốc: HEAD đã chuyển từ `7a5b72a` (Rev 1) sang `7ea3ac5` do PR #74 được merge rồi hoàn tác bằng PR #75. `git diff --stat 7a5b72a HEAD` cho thấy **chỉ `CHANGELOG.md` khác nhau** — cây source giống hệt, nên toàn bộ số dòng trong báo cáo này vẫn đúng cho cả hai mốc.

## 2. Tình trạng gate kỹ thuật (đo lại độc lập trong phiên này)

Tất cả các số dưới đây được chạy lại từ đầu tại `7ea3ac5`, **không lấy lại số cũ từ CHANGELOG**.

| Gate | Kết quả | Ghi chú |
|------|---------|---------|
| C++ build Release, `MKDDC_ENABLE_BACNET=ON MKDDC_ENABLE_MODBUS=ON` | rc=0 | 2 cảnh báo test-only, xem mục 2.1 |
| `ctest` (cấu hình mặc định, HMI OFF) | **674/674 PASS** | 9,90 s — **đã xác nhận độc lập**, khớp số kế thừa |
| `ctest` với `MKDDC_ENABLE_HMI=ON` | **702/702 PASS** | +28 test HMI mà gate mặc định không chạy |
| `go build ./...` (web/backend) | PASS | |
| `go vet ./...` (web/backend) | PASS, 0 finding | |
| `go test ./...` (web/backend) | **PASS** — `ok mkddc-web 16.672s` | |
| `tsc --noEmit` (src/frontend) | PASS, 0 lỗi | |
| `npm test` (vitest + jsdom) | **133/133 PASS** | 25 test file |
| `npm run lint` (`eslint --max-warnings=0`) | PASS, 0 cảnh báo | |

### 2.1 Đính chính số liệu CHANGELOG: "0 lỗi 0 cảnh báo" chưa chính xác

Build production sạch, nhưng còn **2 cảnh báo** `-Wstringop-overflow=` phát sinh từ `services/iobus/tests/test_output_command.cpp:34` (`std::vector::push_back` inline vào `FakeSink::send_set_do`). Đây là **false positive đã biết của GCC 13** khi realloc vector ở mức `-O3`, và đã được xử lý có chủ ý: `-Wno-error=stringop-overflow` chỉ áp cho target test (`services/core/CMakeLists.txt:80`, `services/iobus/CMakeLists.txt:143`), còn target production giữ nguyên `-Wall -Wextra -Werror`.

Không phải lỗi. Nhưng câu chữ trong CHANGELOG nên là **"0 error, 2 cảnh báo test-only đã biết"** thay vì "0 cảnh báo", để lần sau không ai coi cảnh báo mới là chuyện bình thường.

## 3. Tình trạng theo khối

### 3.1 FE (`src/frontend`, ~97 file TS/TSX)
Cấu trúc rõ ràng (`api/`, `auth/`, `components/`, `hooks/`, `pages/`), typecheck sạch, lint sạch, 133 unit test pass + e2e Playwright. Điểm yếu tập trung ở **vòng đời session**: đăng xuất chỉ là hành vi client, và role được mặc định fail-open.

### 3.2 BE (`web/backend`, ~20.9k dòng Go)
Nền tảng HTTP tốt: `MaxBytesReader` cho mọi body, `DisallowUnknownFields`, `writeConfigFileAtomic` có fsync file + fsync directory + giữ ownership, RBAC khai báo tập trung tại `Router()`, audit log cho mọi thao tác user. Test suite pass. Hai vấn đề thật: **thiếu guard "last admin" ở đường đổi role**, và **đọc SHM không theo seqlock**.

### 3.3 FW SOM (`services/`, ~42k dòng C++)
Điểm mạnh đã kiểm chứng:
- Offset SHM trong `web/backend/core_client.go` được đối chiếu từng byte với `shared/mkddc_shm.h` (kể cả padding alignment): **khớp 100%** — `kxPointSize=76`, `offBI=1232`, `offMSV=6096`, `offPLCScanCount=9268`, `kxPlcShmMinLen=9280`, `offIOPStatus=502`, `kxIOShmMinLen=528`.
- `FrameParser::feed()` chống overflow đúng (cắt phần cũ khi buffer đầy).
- `PointTable::valid()` chặn index ngoài dải cho mọi PointKind; `parse_point_name()` gọi `valid()` trước khi trả về nên đường web IPC không có OOB.
- Tham số `channel` của node PULSE_COUNTER **được validate** ở loader (`graph_runtime.cpp:250`) nên getter `di_counter()` không bị OOB.
- `io_scaling.cpp` chặn chia 0 (`scale_range`, `ntc_resistance_from_adc`); PID chặn `dt <= 0`.
- `ExtCache::set_point/mark_slave_offline` đều clamp theo `KX_N_EXT`.
- **`decode_register`/`encode_register` chặn đọc/ghi thiếu register**: mọi nhánh 32-bit đều `if (count < 2) return`, nên profile cấu hình sai **không** gây OOB (`register_codec.cpp:53,60,66`).
- **Buffer đọc Modbus khớp đúng giới hạn libmodbus**: `regs[125]`/`bits[2000]` bằng chính `MODBUS_MAX_READ_REGISTERS`/`MODBUS_MAX_READ_BITS`, và loader còn chặn trước (`device_profile.cpp:168,173`) → không tràn stack.
- **`netcfg` không có command injection**: `LinuxPlatform::run` dùng `fork` + `execv` với vector argv tường minh, binary lấy từ đường dẫn tuyệt đối qua `access(X_OK)` — **không qua shell** (`netcfg.cpp:491-525`). Parse prefix có bọc try/catch (`netcfg.cpp:673-683`).
- **`drain_ext_writes` của Modbus RTU tuân thủ seqlock đúng** khi đọc `plc_shm` (`modbus_master.cpp:133-143`) — trái ngược với đường BE ở F-02.

Điểm yếu: **busy-spin khi UART hangup**, **HMI dùng dữ liệu SHM cũ để lái annunciation**, và **cả hai đường Modbus (TCP + RTU) im lặng khi tràn/lệch dải ext index**.

### 3.4 Gate CI (`.github/workflows/`) — khối yếu nhất

Đây là phát hiện lớn nhất của vòng review thứ hai. Workflow `build-and-test.yml` có 4 leg C++ (baseline / modbus / bacnet / modbus+bacnet), job sanitizer ASan+UBSan, job fuzz smoke — phần C++ được canh rất kỹ. Nhưng:

- job Go **chỉ `go build`**, không chạy test;
- job FE **chỉ `npm run build`**, không chạy test cũng không lint;
- **không leg nào bật `MKDDC_ENABLE_HMI`** → cả service `mkddc-hmi` và 28 test của nó chưa bao giờ được biên dịch trong CI;
- CodeQL trong `security.yml` phân tích `languages: python` trên repo mà C++/Go/TypeScript chiếm gần như toàn bộ.

Nói cách khác: ba trong bốn khối được review ở đây (BE, FE, HMI) **không có cổng test tự động nào chặn regression**, dù test đã tồn tại và đang pass. Đây là lý do các finding F-01/F-03/F-04 có thể tồn tại mà không bị CI phát hiện.

## 4. Danh sách finding

Sắp theo mức nghiêm trọng giảm dần. F-01…F-11 từ Rev 1 (đã kiểm lại, còn đúng nguyên tại `7ea3ac5`); F-12…F-23 là bổ sung của Rev 2.

### F-01 (Cao) — `SetRole` không có guard "last admin" → mất quyền admin vĩnh viễn
`web/backend/auth.go:174`

`DeleteUser` chặn xóa admin cuối cùng (`auth.go:208`), nhưng `SetRole` không có guard tương đương.

Kịch bản: thiết bị chỉ có 1 user admin. Admin gọi `PUT /api/v1/users/admin` với `{"role":"viewer"}`. `persistUsers` ghi thành công → hệ thống còn **0 admin**. Từ lúc đó mọi endpoint `RoleAdmin` (bao gồm chính `PUT /api/v1/users/{username}` để phục hồi) trả 403 cho tất cả mọi người. Chỉ phục hồi được bằng cách sửa tay `users.json` trên filesystem thiết bị.

### F-02 (Cao) — BE đọc SHM không theo seqlock → có thể lấy snapshot bị xé
`web/backend/core_client.go:137`

`shared/mkddc_shm.h:18-19` quy định **bắt buộc** pattern seqlock cho reader. `services/hmi/data/shm_reader.cpp:110` tuân thủ đúng, và `modbus_master.cpp:133-143` cũng tuân thủ đúng. Nhưng `CoreClient.ReadPoints` / `readIOStatus` / `readPLCStatus` chỉ dùng `os.ReadFile` + `validSHM()` — mà `validSHM` chỉ kiểm `magic` và độ dài, **không hề đọc `seq`**. `magic` không bị writer chạm trong lúc ghi nên check này luôn pass.

Kịch bản: `mkddc-core` đang trong khoảng `KX_WRITE_BEGIN`/`KX_WRITE_END` cập nhật `av[]` khi backend `os.ReadFile("/dev/shm/mkddc_plc_shm")`. File shmfs dùng chung page với writer nên buffer 9280 byte thu được có thể trộn giá trị trước và sau update. Snapshot xé này được đẩy thẳng ra WS monitor và **được historian sampler ghi vào DB** (`sampler.go:156`), tạo bản ghi lịch sử sai không thể phát hiện về sau.

### F-03 (Cao) — HMI lái banner sự cố + alarm E001/E002 bằng dữ liệu SHM cũ
`services/hmi/main.cpp:186`

`hmi::DataCache data` được khai báo **ngoài** vòng lặp (`main.cpp:164`) nên tái sử dụng qua từng chu kỳ. Giá trị trả về của `shm.read_all(&data)` bị **bỏ qua**; bên trong, khi cả 5 lần retry seqlock thất bại hoặc `magic` sai, `seqlock_read_io` return false mà **không** reset `out->iop_status`, `out->fault_flags`, `out->io_valid` (`shm_reader.cpp:107`).

Kịch bản: `mkddc-iobus` crash và restart. Trong lúc nó tạo lại SHM (magic chưa set xong), `read_all` thất bại. `data.iop_status` giữ giá trị cũ `KX_IOP_NORMAL`, nên `main.cpp:187` tính `io_fault = false` → **alarm E001 "I/O communication fault" không được kích** và `fault_banner` vẫn xanh, dù không còn dữ liệu I/O sống. Các screen hiển thị *giá trị* có được bảo vệ nhờ `age_ns` (`screen_io.cpp:40`), nhưng đường annunciation thì không — đây là chức năng an toàn bị nuốt im lặng.

Ghi chú kèm: `read_all` cũng bỏ giá trị trả về của `seqlock_read_plc` (`shm_reader.cpp:145`, chỉ `ok |=` cho io), và cả `io_valid`/`plc_valid` không bao giờ được set lại về false.

**Liên hệ F-14**: finding này nằm đúng trong service duy nhất không được CI biên dịch, nên không có cách nào để CI bắt được.

### F-12 (Cao) — CI không chạy test suite của BE Go
`.github/workflows/build-and-test.yml:134-137`

Job `web-backend` chỉ có một bước duy nhất: `go build -v ./...`. **Không có `go test`**, không có `go vet`.

Kịch bản: toàn bộ test BE (phiên này chạy PASS, `ok mkddc-web 16.672s`) chưa bao giờ được thực thi trên CI. Một PR làm hỏng logic auth, RBAC, historian hay đường SHM vẫn hiện **check xanh** miễn là code còn biên dịch được. Test đã có sẵn và đang pass — chi phí sửa gần như bằng 0, chỉ là thêm một bước vào workflow.

### F-13 (Cao) — CI không chạy test suite cũng không lint FE
`.github/workflows/build-and-test.yml:158-161`

Job `web-frontend` chỉ chạy `npm run build`, tức `tsc --noEmit && vite build` (`src/frontend/package.json`). **Không có `npm test`, không có `npm run lint`.**

Kịch bản: 133 vitest test trên 25 file (phiên này PASS) và `eslint --max-warnings=0` (phiên này sạch) không chặn được gì cả. Chỉ lỗi type và lỗi bundle mới bị bắt; mọi regression hành vi ở component, hook, `AuthProvider`, `useWebSocket` đều merge xanh. Cùng nhóm với F-12 và cùng mức chi phí sửa.

### F-14 (Cao) — `mkddc-hmi` không được CI biên dịch hay test lần nào
`services/CMakeLists.txt:47` + `.github/workflows/build-and-test.yml:29-52`

`option(MKDDC_ENABLE_HMI ... OFF)` mặc định tắt, và **không leg nào trong matrix 4 cấu hình C++ bật nó** (matrix chỉ đổi `bacnet` × `modbus`).

Đã đo trong phiên này để xác nhận: cấu hình mặc định cho **674 test**; thêm `-DMKDDC_ENABLE_HMI=ON` cho **702 test** — tức **28 test HMI (`test_alarm_model`, `test_shm_reader`, `test_nav`, `test_point_db`, `test_locale`, `test_key_queue`, `test_hmi_api_client`, `test_network_model`) chưa bao giờ chạy trên CI**, và bản thân `mkddc-hmi` chưa bao giờ được kiểm tra là còn biên dịch được. Cả hai đều PASS/rc=0 khi bật, nên đây là gate bị bỏ quên, không phải gate đang đỏ.

Hệ quả trực tiếp: F-03 là một lỗi chức năng an toàn nằm trong đúng service này.

### F-04 (Trung bình-Cao) — FE đăng xuất không thu hồi token phía server
`src/frontend/src/auth/AuthProvider.tsx:78`

BE có đầy đủ đường thu hồi: `POST /api/v1/auth/logout` → `handleLogout` → `AuthService.Revoke` (`auth.go:456`, `auth.go:327`). Nhưng FE `logout()` chỉ xóa state local; grep toàn bộ `src/` **không có chỗ nào gọi `auth/logout`**.

Kịch bản: người vận hành bấm "Đăng xuất" trên HMI web dùng chung tại phòng máy. JWT vừa dùng vẫn hợp lệ tới hết TTL 1 giờ (`auth.go:124`). Ai lấy được token đó (lịch sử browser, log proxy, devtools) vẫn ghi/force được point ở quyền operator. Toàn bộ cơ chế `revoked` phía BE thành code chết.

### F-05 (Trung bình) — UART hangup gây busy-spin, không phát hiện được mất kết nối
`services/iobus/iop/iop_client.cpp:112`

`wait_response` chỉ xét `pfd.revents & POLLIN`, **không xử lý `POLLHUP`/`POLLERR`** (poll báo hai cờ này bất kể `events` yêu cầu gì). Thêm nữa `IopPort::read` trả `0` cho **cả EAGAIN lẫn EOF** (`iop_port.cpp:88-90`), nên caller không phân biệt được "chưa có dữ liệu" với "sẽ không bao giờ có dữ liệu nữa".

Kịch bản: USB-serial tới MCU bị rút (hoặc PTY fake MCU chết). fd tty báo `POLLHUP`. `poll()` trả về ngay lập tức với `pr > 0`, nhưng `revents & POLLIN` false → **không gọi `read` nên không bao giờ thấy lỗi** → vòng `for(;;)` gọi lại `poll()` liền → spin không sleep cho tới khi hết deadline của transaction đó, nhân `max_retry + 1` lần trong `transact`, và lặp lại ở **mỗi** chu kỳ poll 10 ms. Kết quả là một core bị chiếm ở mức rất cao trong suốt trạng thái RECONNECT, cạnh tranh trực tiếp với scan loop `SCHED_FIFO` của core. Hangup lẽ ra phải được phát hiện tức thì lại chỉ lộ ra qua đường timeout.

*(Đính chính so với Rev 1: spin bị chặn trên bởi deadline từng transaction, không phải 100% CPU vô hạn — nhưng vì nó tái diễn mỗi chu kỳ poll nên tác động thực tế vẫn là chiếm CPU liên tục.)*

### F-16 (Trung bình) — Modbus RTU: slave vượt `KX_N_EXT` bị loại khỏi poll nhưng vẫn báo ONLINE
`services/iobus/fieldbus/modbus_master.cpp:91`

Khi `ext_idx > KX_N_EXT`, vòng cấu hình `break` ngay. Các slave còn lại trong config **không được gọi `load_device_profile`** nên `profiles_[i].points` rỗng. Nhưng `slave_states_` đã được `resize` cho *toàn bộ* slave (`:64`), nên chúng vẫn được `poll_once` gọi tới.

Kịch bản: `read_slave` với profile rỗng chạy qua vòng `for (const auto& pt : prof.points)` mà không làm gì, giữ `slave_ok = true`, rồi gọi `on_poll_ok` + `metrics.update(slave_idx, true)` (`:281-286`). Slave hiển thị **online, error rate 0%, không alarm E302**, trong khi thực tế nó không được truy vấn lần nào và không có điểm nào. Đây là bản đối ứng RTU của F-08, và nghiêm trọng hơn ở chỗ nó im lặng hoàn toàn — không có cả dòng log nào tại thời điểm `break`.

### F-17 (Trung bình) — Ext index bị đặt trước gấp đôi cho điểm 32-bit (cả hai transport)
`services/iobus/fieldbus/modbus_master.cpp:87-89` và `services/iobus/fieldbus/modbus_tcp.cpp:57-58`

Cả hai `open()` đếm số slot ext bằng `pts += pp.count`, tức **số register**. Nhưng vòng đọc tiêu **1 slot ext cho mỗi 2 register** với `Int32`/`Uint32`/`Float32` (`modbus_master.cpp:272-273`, `modbus_tcp.cpp:203`: `if (is32) k++`). Một điểm `float32` `count=2` được đặt trước 2 slot nhưng chỉ dùng 1.

Kịch bản: profile thiên về 32-bit (đo điện năng, lưu lượng — đúng nhóm thiết bị hay dùng float32) **đặt trước gấp đôi số slot cần**, nên:
1. dung lượng `KX_N_EXT` khả dụng thực tế giảm còn một nửa, đẩy F-08/F-16 xảy ra sớm gấp đôi;
2. các slot ở khoảng trống không bao giờ được `set_point`, nên giữ nguyên `quality = KX_Q_BAD` và `name` rỗng;
3. `ExtCache::set_point` nâng `count_` lên tới index cao nhất từng ghi (`ext_cache.cpp:38`), nên `push_snapshot` gửi **cả các điểm rỗng đó** sang core (`ext_cache.cpp:63-76`) → bảng điểm ext trên web/HMI xen kẽ những dòng vô danh chất lượng BAD.

`mark_slave_offline` dùng cùng con số thừa nên **không** ghi lấn sang slave kế tiếp (base của slave sau cũng bị đẩy ra theo) — đây là lý do lỗi này chưa gây hỏng dữ liệu, chỉ gây mất dung lượng và điểm rác.

### F-18 (Trung bình) — Validation "32-bit cần count=2" được ghi trong tài liệu nhưng không được hiện thực
`services/iobus/fieldbus/device_profile.cpp:119-135`, hợp đồng tại `device_profile.hpp:50`

`device_profile.hpp:50` khẳng định `type không khớp count (32-bit cần count=2) → skip`, và comment tại `device_profile.cpp:119` nhắc lại. Nhưng biến `is32bit` **chỉ được dùng cho check `byte_order`** (`:131`) — không có bất kỳ so sánh nào giữa `type` và `count`. Profile `type: "float32", count: 1` đi qua loader trọn vẹn.

Kịch bản: điểm 32-bit ở biên lẻ. Đường TCP xử lý đúng — log `modbus_tcp.odd_32bit` rồi bỏ điểm (`modbus_tcp.cpp:196-205`). Đường RTU thì tính `count_this = (k + 1 < pt.count) ? 2u : 1u` (`modbus_master.cpp:267`), `decode_register` nhận `count=1` nên return `0.0f` (`register_codec.cpp:53`), và giá trị `0*scale + offset` đó được publish với **`KX_Q_GOOD`** (`:276`). Tức là một **giá trị bịa** được đánh dấu là dữ liệu tốt — với thang đo có offset, nó còn trông rất hợp lý (ví dụ hiện đúng 20.0 °C). Hai transport xử lý cùng một lỗi cấu hình theo hai cách khác nhau, và cách của RTU là cách tệ nhất có thể.

### F-19 (Trung bình) — Secret JWT mới bị ghi ra `/tmp` đường dẫn cố định trước khi được đặt quyền 0600
`packaging/rotate-web-jwt-secret.sh:14`

```sh
printf 'JWT_SECRET=%s\n' "$secret" > /tmp/mkddc-web.env
...
sudo install -o root -g root -m 0600 /tmp/mkddc-web.env "$envfile"
rm -f /tmp/mkddc-web.env
```

File trung gian được tạo bằng redirect của shell nên mang **umask mặc định của người chạy** (thường 0022 → `0644`, ai cũng đọc được), tại một **đường dẫn cố định và đoán được trong thư mục ghi chung**.

Hai kịch bản: (1) trên host nhiều người dùng, bất kỳ user local nào cũng đọc được secret JWT production trong cửa sổ giữa dòng 14 và 16; (2) một user local đặt trước symlink `/tmp/mkddc-web.env` → `~/steal.txt` thì redirect **đi theo symlink** và ghi secret vào file của kẻ tấn công, còn `rm -f` chỉ xóa symlink. Cách sửa: `umask 077` + `mktemp`, hoặc bỏ hẳn file trung gian bằng cách đưa trực tiếp vào `sudo install /dev/stdin "$envfile"`.

### F-06 (Trung bình) — Map `revoked` phình vô hạn
`web/backend/auth.go:327`

`Revoke` thêm 1 entry keyed theo **raw token** mỗi lần logout. Entry chỉ bị `delete` trong `Validate` khi **đúng token đó** được trình lại sau khi đã hết hạn (`auth.go:306`) — điều gần như không bao giờ xảy ra vì client đã bỏ token. Không có goroutine prune định kỳ.

Kịch bản: script/health-check login+logout mỗi 30 giây trên thiết bị nhúng chạy hàng tháng → ~86k entry, mỗi entry giữ nguyên chuỗi JWT (~200-300 byte) → hàng chục MB rò rỉ không thu hồi, trên board RAM hạn chế. (Lưu ý: F-04 hiện đang che khuất finding này — sửa F-04 sẽ làm nó hiện ra.)

### F-07 (Trung bình) — Role mặc định fail-open thành `admin` ở FE
`src/frontend/src/auth/AuthProvider.tsx:75`

`role: body.role ?? 'admin'` — thiếu field `role` trong response login thì FE cấp giao diện admin.

Kịch bản: BE thay đổi/BE cũ không trả `role`, hoặc reverse proxy lọc bớt field → user `viewer` nhận UI admin đầy đủ, thấy toàn bộ trang cấu hình hệ thống và quản lý user. Server vẫn chặn 403 nên không leo thang thật, nhưng đây là lộ thông tin cấu trúc + UX lỗi. Default an toàn phải là `'viewer'` (hoặc coi thiếu `role` là login thất bại).

### F-08 (Trung bình) — Modbus TCP báo slave "online" khi ext index đã tràn dải
`services/iobus/fieldbus/modbus_tcp.cpp:62`

`open()` clamp `if (idx > KX_N_EXT) idx = KX_N_EXT;` nhưng **không log cảnh báo** và **không clamp `conn.ext_count`**. Khi RTU master đã tiêu hết slot ext, mọi TCP slave nhận `ext_base = KX_N_EXT`.

Kịch bản: `read_conn` gặp `if (ext_idx >= KX_N_EXT) break;` ở point đầu tiên (`modbus_tcp.cpp:168`), thoát vòng lặp với `slave_ok` **vẫn là true** → gọi `on_poll_ok` → slave được báo cáo **online và khỏe mạnh** trong khi không publish nổi một điểm nào. Kỹ thuật viên hiện trường thấy slave xanh mà bảng điểm trống, không có dòng log nào chỉ ra nguyên nhân. Xem F-16 cho bản đối ứng RTU và F-17 cho nguyên nhân làm tình huống này đến sớm hơn dự kiến.

### F-15 (Trung bình) — CodeQL phân tích `python` trên repo C++/Go/TypeScript
`.github/workflows/security.yml:124`

`languages: python` trong khi repo chỉ có **4 file `.py`** (2 script soak, 1 test IPC, 1 script kiểm tài liệu HW) — còn ~42k dòng C++ an toàn-quan trọng, ~21k dòng Go và ~97 file TS/TSX thì không được phân tích. Bước "Generate Python pip SBOM" (`:37-41`) cũng chỉ gom `requirements*.txt`, càng cho thấy workflow được kế thừa từ khuôn mẫu project Python. Thêm vào đó `analyze` mang `continue-on-error: true` (`:132`), nên ngay cả khi có finding cũng không chặn được PR.

Tổng hợp lại: job CodeQL hiện tại là **gate rỗng tạo tín hiệu xanh sai lệch** — cùng bản chất với finding A-03 (job "MCU Firmware" chỉ biên dịch skeleton) trong báo cáo bàn giao auditor. Đề xuất: `languages: c-cpp, go, javascript-typescript`.

*(Đính chính ghi chú nội bộ: có ghi nhận rằng lỗi này đã được sửa `python` → `cpp` tại commit `2869a19`. Commit đó **không tồn tại** trong repo này, và file vẫn đang là `python`. Ghi nhận đó sai.)*

### F-09 (Thấp) — `JSON.parse` trong `onmessage` không có try/catch
`src/frontend/src/hooks/useWebSocket.ts:125`

`JSON.parse(String(event.data))` chạy trần. Một frame không phải JSON (proxy chèn, khung lỗi, sự cố phía server) sẽ throw trong event handler → exception không bắt, mất luôn cập nhật cho tới lần reconnect. Hiện BE luôn ghi bằng `wsjson` nên xác suất thấp, nhưng handler đọc dữ liệu ngoài phải chống lỗi.

### F-10 (Thấp) — Token JWT đặt trong query string của URL WebSocket
`src/frontend/src/hooks/useWebSocket.ts:20` và `web/backend/ws.go:32`

`?token=<JWT>` nằm trong URL đầy đủ. `loggingMiddleware` của app chỉ log `r.URL.Path` nên bản thân app không ghi ra, nhưng URL vẫn đi vào lịch sử browser và access log của mọi reverse proxy đứng trước. Với TTL 1 giờ và F-04 (không thu hồi), cửa sổ lạm dụng là thật. Ưu tiên `Sec-WebSocket-Protocol` hoặc cookie ngắn hạn.

### F-11 (Thấp) — `wsOriginPatterns` luôn nối thêm pattern localhost
`web/backend/ws.go:125`

Ngay cả khi `CORSOrigin` đã được cấu hình tường minh cho triển khai production, danh sách vẫn chứa `localhost`, `localhost:*`, `127.0.0.1:*`, `[::1]:*`. Trang tại `http://localhost:<bất kỳ port>` trong browser của người vận hành sẽ qua được check Origin của WS. Vẫn cần token nên chưa khai thác trực tiếp được, nhưng nó phá vỡ ý định "chỉ cho phép origin đã khai báo" của `isAllowedOrigin` (`http.go:110`).

### F-20 (Thấp) — Rollback của script rotate JWT vừa không bao trùm vừa không phục hồi env file
`packaging/rotate-web-jwt-secret.sh:19-35`

Hai vấn đề trong cùng một cơ chế:
1. `rollback()` được **định nghĩa ở dòng 26**, tức *sau khi* unit đã bị `sed` sửa (`:19-21`) và `systemd-analyze verify` + `daemon-reload` đã chạy (`:23-24`). Với `set -eu` và không có `trap`, một thất bại ở dòng 19–24 làm script thoát ngay khi unit **đã bị sửa** và secret mới **đã được cài**, mà không có bất kỳ hoàn tác nào.
2. `rollback()` chỉ `cp` lại `$unit.bak.$stamp`, **không bao giờ phục hồi `$envfile.bak.$stamp`** đã sao lưu ở dòng 10. Một hệ thống "đã rollback" vẫn đang mang secret mới, nên toàn bộ session đang hoạt động vẫn bị vô hiệu — đúng cái mà rollback nhằm tránh.

Sửa: chuyển `rollback()` lên trước thay đổi đầu tiên, gắn `trap rollback EXIT` (nhả trap khi thành công), và phục hồi cả env file.

### F-21 (Thấp) — Biểu thức kiểm giới hạn block coil đúng do tình cờ
`services/iobus/fieldbus/device_profile.cpp:168`

```cpp
if ((fc == 1 || fc == 2) && static_cast<int>(pt->count) * static_cast<int>(pt->count > 0) > 2000)
```

Nhân tử thứ hai là `static_cast<int>(pt->count > 0)` — một bool, và vì `count >= 1` đã được bảo đảm ở `:95` nên nó **luôn bằng 1**. Biểu thức rút gọn thành `count > 2000`, tức đúng ý định. Không phải lỗi hiện tại, nhưng rõ ràng là dấu vết của một phép nhân bị viết sai (có lẽ định là `count * (fc == 1 ? 1 : ...)`), và là bẫy cho người sửa tiếp theo. Nên viết thẳng `pt->count > 2000`.

### F-22 (Thấp) — `LinuxPlatform::run` biến output bị cắt thành "lệnh thất bại"
`services/netcfg/netcfg.cpp:514-519`

Vòng đọc dừng khi `result.size() >= 4096`: điều kiện `n > 0 && result.size() < 4096` false → rơi xuống `else break`, rồi `close(pipes[0])`. Child đang ghi tiếp sẽ nhận `SIGPIPE`; khi đó `WIFEXITED(status)` false nên `run()` **return false** (`:524`) cho một lệnh thực chất đã chạy đúng.

Chỉ chạm tới khi output `nmcli`/`ip` dài bất thường (hiện các lời gọi đều là `-g <một field>`), nhưng hệ quả là biến một lần cắt output thành một lần "apply thất bại" giả — trong service đang có cả cơ chế rollback fail-closed thì đây là loại tín hiệu sai đáng tránh. Nên đọc cạn pipe rồi mới bỏ phần thừa.

### F-23 (Thấp) — Môi trường jsdom của FE chỉ do flag npm script cấp, không có trong config
`src/frontend/package.json` (`"test": "vitest --run --environment jsdom src"`), `src/frontend/vite.config.ts`

`vite.config.ts` **không có khối `test`** nào, nên `environment: 'jsdom'` chỉ tồn tại dưới dạng cờ dòng lệnh trong script `test`.

Kịch bản đã gặp thật trong phiên review này: gọi `npx vitest run` (không qua `npm test`) làm toàn bộ suite chạy trong môi trường `node` và **fail 93/133** với `ReferenceError: localStorage is not defined` — trông y như một suite đang đỏ. Bất kỳ đường chạy nào không đi qua đúng script đó (test runner của IDE, `vitest --watch` gọi trực tiếp, một bước CI viết tay khi sửa F-13) đều gặp lại. Nên khai báo `test: { environment: 'jsdom' }` trong config để môi trường đi theo project chứ không theo lệnh gọi.

## 5. Đã kiểm và xác nhận **không** phải lỗi

Ghi lại vì đây là các chỗ dễ nghi oan, để lần review sau không phải soi lại:

- Toàn bộ offset SHM trong `core_client.go` khớp từng byte với `shared/mkddc_shm.h`, kể cả padding alignment.
- `FrameParser::feed` chống overflow đúng.
- `parse_point_name` gọi `PointTable::valid` nên đường web IPC không có OOB (kể cả nhánh `is_query` không tự kiểm idx).
- Tham số `channel` của PULSE_COUNTER được validate ở loader nên getter `di_counter()` không bị OOB.
- `io_scaling` và PID chặn chia 0. `ExtCache` clamp theo `KX_N_EXT`.
- `writeConfigFileAtomic` có fsync file + directory + giữ ownership. `handleStatic` không bị path traversal.
- `decode_register`/`encode_register` chặn mọi nhánh 32-bit bằng `count < 2` → profile sai không gây OOB (chỉ gây F-18).
- `regs[125]`/`bits[2000]` khớp đúng `MODBUS_MAX_READ_REGISTERS`/`MODBUS_MAX_READ_BITS`, có loader chặn trước → không tràn stack.
- `netcfg` **không** có command injection: `execv` + argv vector + đường dẫn tuyệt đối qua `access(X_OK)`, không qua shell.
- `drain_ext_writes` (Modbus RTU) tuân thủ seqlock đúng khi đọc `plc_shm`.
- 2 cảnh báo `-Wstringop-overflow` là false positive GCC 13 đã được hạ mức có chủ ý, **chỉ** cho target test; production giữ `-Werror` đầy đủ.
- `packaging/install.sh` đặt quyền có chủ đích và hợp lý (0600/0640 cho file cấu hình chứa thông tin nhạy cảm, 0755 cho binary, `-o root -g mkddc` đúng chỗ).
- `tools/*` dùng đường dẫn `/tmp` cố định nhưng đều là harness test do dev chạy tay, không phải đường triển khai — rủi ro không tương đương F-19.

## 6. Đề xuất thứ tự xử lý

1. **F-12, F-13, F-14** — đóng gate CI trước tiên. Test đã tồn tại và đang pass; chỉ cần thêm `go test ./...`, `npm test` + `npm run lint`, và một leg matrix `MKDDC_ENABLE_HMI=ON`. Chi phí gần bằng 0, và nó là điều kiện để mọi fix bên dưới không bị hồi quy lặng lẽ.
2. **F-01, F-03** — chặn lockout admin và khôi phục annunciation an toàn. Cả hai là fix cục bộ, nhỏ, kiểm chứng được bằng unit test.
3. **F-02** — bổ sung reader seqlock cho Go (mmap + đọc `seq` hai lần, hoặc thêm op web IPC lấy snapshot đã nhất quán; `ReadPointSnapshot` đã đi qua core nên là hình mẫu sẵn có; `modbus_master.cpp:133-143` là hình mẫu phía C++).
4. **F-19** — sửa đường ghi secret ra `/tmp` (`umask 077` + `mktemp`, hoặc `install /dev/stdin`). Nhỏ nhưng là secret production.
5. **F-04, F-05** — gọi `auth/logout` từ FE; xử lý `POLLHUP`/`POLLERR` + phân biệt EOF với EAGAIN trong `IopPort::read`.
6. **F-16, F-17, F-18** — dọn cả cụm ext index của Modbus trong một lần: đếm slot theo *điểm luận lý* chứ không theo *register*, log + fail-closed khi tràn `KX_N_EXT` (đánh slave là offline/lỗi cấu hình thay vì online), hiện thực nốt validation `32-bit ⇒ count=2` mà `device_profile.hpp:50` đã hứa, và cho RTU xử lý biên lẻ giống TCP.
7. **F-15** — đổi `languages` của CodeQL sang `c-cpp, go, javascript-typescript`.
8. **F-06 → F-11, F-20 → F-23** — dọn dần: prune `revoked`, đổi default role thành `viewer`, bọc `JSON.parse`, chuyển token WS ra khỏi query string, bỏ pattern localhost khi origin đã cấu hình, đưa `rollback()` lên trước + `trap` + phục hồi env file, viết lại biểu thức `count > 2000`, đọc cạn pipe trong `netcfg::run`, và khai báo `test.environment` trong `vite.config.ts`.

## 7. Giới hạn còn lại của review này

Các giới hạn ở Rev 1 đã được đóng: ctest **đã** chạy lại và xác nhận 674/674 (và 702/702 khi bật HMI); `go test` và vitest **đã** chạy; `services/netcfg`, `packaging/`, `tools/`, `.github/workflows/` **đã** được review; đường ext index của Modbus **RTU đã** được soi và sinh ra F-16/F-17/F-18.

Còn lại:

- `fw/` (FW MCU) không review về chất lượng code vì `Core/Src/main.c` chỉ có **16 dòng skeleton** (4 lệnh `printf` + `while(1)` rỗng) — chưa có gì để review. Đây là finding A-01 của báo cáo bàn giao auditor, không phải finding của review này.
- `services/netcfg` (1.337 dòng `netcfg.cpp`) được review theo hướng bề mặt tấn công (thực thi lệnh, parse chuỗi, quyền file, đường rollback), **không** review sâu tính đúng đắn của state machine apply/verify/rollback so với đặc tả. 42 test netcfg đều pass. Nếu cần bảo đảm cho chứng nhận thì đây là hạng mục nên có một vòng review riêng.
- Đo hiệu năng/thời gian thực (WCET, jitter, soak 24 h, TSan) không nằm trong phạm vi review đọc code này; xem next action P0 của báo cáo bàn giao auditor.
- Chỉ chạy trên x86-64 Linux, GCC 13. Chưa chạy lại trên aarch64 (board Orange Pi 5B) trong phiên này.
