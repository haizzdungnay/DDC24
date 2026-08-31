# Hồ sơ đo nền bằng chứng V&V E2E — Issue #369 / ISS-STED-20

| Thuộc tính | Giá trị |
|---|---|
| ID | `EV-GATE369-BASELINE-001` |
| Issue | `#369` (`ISS-STED-20`) — End-to-End V&V Evidence Gate |
| Review liên quan | `REV-STED-IEC-001` |
| Ngày đo | 2026-08-31 |
| Base commit | `f07bf0f4` (`main`) |
| Commit review gốc | `661a714` — review `REV-STED-IEC-001` dùng baseline này; hồ sơ đo trên `f07bf0f4`, có độ trôi commit |
| Mục đích | **Đo nền (baseline)** — xác lập khung đo và ghi hiện trạng, KHÔNG phải bằng chứng ký đóng |
| Verdict tổng thể | **CHƯA ĐỦ ĐIỀU KIỆN KÝ ĐÓNG** (17/19 issue tiền đề còn OPEN; chặng (c) và (d) chưa đạt) |

## 0. Tuyên bố phạm vi và tính hợp lệ

- Hồ sơ này là **phép đo nền**, xác lập khung đo và ghi hiện trạng trước khi các nhánh sửa lỗi hoàn tất.
- **KHÔNG dùng để ký đóng issue `#369`.**
- 17/19 issue tiền đề còn `OPEN`; chỉ `#350` và `#356` đã `CLOSED`. Nghiệm thu chính thức chỉ thực hiện khi toàn bộ tiền đề đã đóng.
- Mọi số trong hồ sơ này là **số đo thật trong phiên 2026-08-31**, không dẫn lại số cũ.

## 1. Môi trường đo

| Thông số | Chi tiết |
|---|---|
| OS | WSL2 Ubuntu 24.04 LTS (host Windows 11) |
| Trình biên dịch C++ | `g++ 13.3.0` |
| CMake / CTest | `3.28.3` |
| Go | `go1.26.4` |
| Node | `v24.16.0` |
| Thư viện | `libmodbus 3.1.10`, `libsodium 1.0.18`, `libdrm 2.4.125`, `freetype2 26.1.20` |
| Tài nguyên | 2 vCPU, 3 GB RAM |
| Vị trí mã nguồn | `/mnt/e/TuanDuong/INTERN/DDC24_project/MK-DDC-24` (mount 9p) |
| Ghi chú hợp lệ | **KHÔNG PHẢI môi trường phát hành.** Môi trường phát hành yêu cầu phần cứng target thật hoặc runner CI chuẩn hoá. Tài nguyên 2 vCPU đã trực tiếp làm lộ hai lỗi test phụ thuộc lịch trình (mục 3). |

### 1.1 Môi trường Windows/MinGW không dùng được

`cmake` chạy trên Windows với MinGW **FAIL ở bước configure**:

```
CMake Error at .../FindPackageHandleStandardArgs.cmake:290 (message):
  Could NOT find PkgConfig (missing: PKG_CONFIG_EXECUTABLE)
Call Stack: apps/iobus/CMakeLists.txt:51 (find_package)
```

`MKDDC_ENABLE_MODBUS=ON` bắt buộc `find_package(PkgConfig REQUIRED)` (`apps/iobus/CMakeLists.txt:51`). Toàn bộ chặng (a) vì vậy chạy trong WSL2.

## 2. Bốn chặng đo V&V

### 2.1 Chặng (a) — C++ build + test — **PASS**

Lệnh thực thi (qua `scripts/gate369-stage-a.sh`):

```bash
cmake --fresh -S . -B build/fw -DCMAKE_BUILD_TYPE=Release \
  -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON
cmake --build build/fw -j2
ctest --test-dir build/fw --output-on-failure
```

| Bước | Exit code thật | Số đo | Log |
|---|---|---|---|
| configure | `0` | 3 option đều nhận: `libmodbus 3.1.10`, BACnet rev 19, HMI qua `libdrm`+`freetype2` | `logs/gate369-configure.log` |
| build | `0` | 100%, 0 lỗi biên dịch | `logs/gate369-build.log` |
| ctest (lần 1) | `8` | 1338 test — **1 FAIL** | — |
| ctest (lần 2) | `8` | 1338 test — **2 FAIL** | — |
| ctest (sau khi sửa) | `0` | **1338/1338 PASS**, 69.60 s | `logs/gate369-ctest.log` |

Cả ba option bật đồng thời đúng yêu cầu issue — `MKDDC_ENABLE_HMI` mặc định `OFF` (`CMakeLists.txt:51`) nên nếu không bật tường minh sẽ bỏ sót toàn bộ nhánh HMI khỏi gate.

**Lỗi tìm được và đã sửa trong phiên:** hai test `StSignalBus` fail không ổn định (lần 1 fail một, lần 2 fail hai). Chi tiết ở mục 4.

**Trạng thái: PASS.**

### 2.2 Chặng (b) — Vector compiler ST — **KHÔNG ĐẠT** (5/6 nhóm)

Bộ test: `apps/core/application/st/tests/` — 33 tệp, target `core_tests`, thư viện `st_compiler_lib` (`apps/core/CMakeLists.txt:155`).
CLI: `mkddc-st-validate` (`apps/core/CMakeLists.txt:214`), stdout là **một dòng JSON** (`st_validate_main.cpp:10-11`).

```bash
ctest --test-dir build/fw -R "^St" --output-on-failure
```

Số đo: **572/572 PASS**, exit `0`, 24.82 s (`logs/gate369-stvector.log`).

| Nhóm vector | Đã phủ? | Bằng chứng |
|---|---|---|
| 1. Lỗi cú pháp | CÓ | `test_st_lang.cpp:267` (`kSyntaxUnexpected`); CLI: `test_st_validate_cli.cpp:133` |
| 2. Lỗi kiểu | CÓ | `test_st_lang.cpp:101,108,167,174,207,347,434` (`kTypeMismatch`); CLI: `test_st_validate_cli.cpp:151` |
| 3. FB gọi hai lần/chu kỳ | CÓ | `test_st_lang.cpp:316` — `FbCalledTwicePerCycleRejected` |
| 4. FB ghi vào output | CÓ | `test_st_lang.cpp:365` — `WriteToFbOutputRejected` |
| 5. **Severity WARNING** | **KHÔNG** | Xem đo dưới đây |
| 6. Nhiều diagnostic/lần Check | CÓ | `test_st_io_map.cpp:105` (`>= 2`), `:245` (`== 3`) |

**Đo trực tiếp vector WARNING** (`scripts/gate369-warning-probe.sh`) — nguồn ST hợp lệ có biến khai báo không dùng:

```st
PROGRAM P_warn
VAR
  unused_var : INT;
  used_var : INT;
END_VAR
  used_var := 1;
END_PROGRAM
```

Kết quả CLI thật:

```json
{"artifactHash":"9d5a5771...","compilerVersion":"fwsom-st-1.2.0","diagnostics":[],"irSchemaVersion":1,"ok":true,"symbols":[]}
```

`COUNT_WARNING=0`, `diagnostics` rỗng. `StSeverity::WARNING` có khai báo (`st_diagnostic.hpp:15`) và có serializer (`st_validate_main.cpp:42`), nhưng **không emitter nào phát WARNING** — kênh chết ngay tại tầng C++. Đây là đo thật xác nhận `F-STED-003`.

**Trạng thái: KHÔNG ĐẠT** — 5/6 nhóm có phủ, thiếu nhóm WARNING. Mở khoá bởi `#351` (`ISS-STED-02`).

> **BỔ CHÍNH 2026-08-31 (cùng ngày, sau bản sửa `#351`).** Phần đo trên là **số đo nền trên
> `f07bf0f4`** và được giữ nguyên làm mốc so sánh, **không** sửa lại. Sau `#351`, phép đo cùng
> khung cùng nguồn cho `COUNT_WARNING=2`, `COUNT_ERROR=0`, `EXIT=0` với `ST-WARN-002` và
> `ST-WARN-003` mang đủ thông điệp và vị trí; `ST-WARN-004` cũng phát được qua
> `mkddc-st-compile` kèm artifact vẫn sinh. Chặng (b) chuyển sang **ĐẠT**. Bằng chứng:
> `2026-08-31-sted-02-03-warning-channel.md` (`EV-STED-0203-001`).

### 2.3 Chặng (c) — CLI JSON → Go → FE — **KHÔNG ĐẠT**

```bash
cd apps/web-api && go vet ./... && go test ./... -count=1
npx vitest --run --environment jsdom src
```

| Bước | Exit thật | Số đo | Log |
|---|---|---|---|
| `go vet ./...` | `0` | sạch | `logs/gate369-govet.log` |
| `go test ./... -count=1` | `1` | 17 package `ok`, **2 test FAIL** | `logs/gate369-gotest.log` |
| FE `src/features/programming/design/editor` | `0` | **19 tệp / 292 test PASS** | `logs/gate369-fe-editor.log` |
| FE toàn bộ `src` | `1` | 189 tệp / 2200 test — **1 FAIL** | `logs/gate369-fe-all.log` |

Con số 19 tệp / 292 test khớp đúng bộ đo mà `REV-STED-IEC-001` §11 ghi nhận.

#### 2.3.1 Đứt gãy hợp đồng diagnostic — bằng chứng theo file:line

Trace toàn tuyến ba tầng cho thấy tổn thất tập trung ở **một hàm map bên Go**: `compilerDiagnostic()` — `apps/web-api/internal/programming/application/checks.go:805-814`.

| Trường | CLI C++ | Go DTO | FE | Kết quả |
|---|---|---|---|---|
| `message` (văn bản thật của compiler) | có (`runner.go:132-140`) | **bị bỏ**, thay bằng `MessageKey` | — | **chết ở `checks.go:813`** |
| `severity` | có, serialize được | **đè cứng `"ERROR"`** | — | **chết ở `checks.go:813`** |
| `code` | có | đẩy xuống `DetailCode`; `Code` bị đè bằng mã domain | hiện | biến dạng (`checks.go:805-814`) |
| `line` / `column` / `length` / `sourceId` | có | gói vào `Location` (`checks.go:808`) | hiện | giữ nguyên |

Từ Go DTO (`checks.go:49-56`) sang type TS `ProgrammingDiagnostic` (`apps/web-ui/src/features/programming/model/types.ts:521-528`): khớp 1-1, không mất trường.

Hệ quả ghép chặng (b) + (c): compiler C++ có `StSeverity::WARNING` nhưng không phát; kể cả khi `#351` bổ sung emitter, tầng Go vẫn đè `"ERROR"` — chuỗi vẫn đứt. **Hai issue phải sửa cùng nhau mới thông kênh WARNING.**

#### 2.3.2 Không tồn tại E2E xuyên ba tầng

`apps/web-ui/e2e/programming.spec.ts:8-14, 466-472` chỉ mock tĩnh endpoint `/checks/*`, không gọi backend Go thật. **Không có test nào chạy xuyên CLI → Go → FE.** Đúng như issue mô tả, đây là chặng duy nhất bắt được lớp lỗi "mỗi tầng đúng riêng nhưng nối lại thì mất thông tin" — và hiện chưa có.

#### 2.3.3 Ba test FAIL — phân loại

| Test | Package/tệp | Loại | Phạm vi ST? |
|---|---|---|---|
| `TestHMIBrokerRestartInvalidatesSession` | `internal/app`, `hmi_broker_test.go:550-570` | Môi trường — chờ Unix socket quá `20s` (`:174`) trên 2 vCPU; fail tại `startTestHMIBroker`, chưa tới bước kiểm session (log dòng 381: `broker socket was not created`) | Không |
| `TestSimulationSpeedNeverReachesTheWorkerAndNeverChangesTheResult` | `internal/programming/application`, `simulation_lifecycle_test.go:540-635` | Đua giữa goroutine ticker và lệnh PAUSE; ở 60× (interval tối thiểu 5 ms, `simulation.go:368-371`) tick thứ 4 kịp chạy trước `stopRunLoop()` — `virtual=400/300 sequence=4/3` | Không (hạ tầng simulation) |
| `route-menu-contract.test.ts` N-08 | `src/app/route-menu-contract.test.ts:377` | **Thay đổi cục bộ chưa commit** đã gỡ `<h1>` khỏi `ProgrammingHeader.tsx` (HEAD `f07bf0f4` có 1, cây làm việc có 0) | Không — giữ nguyên theo quy tắc "FE cục bộ là nguồn chân lý" |

**Trạng thái: KHÔNG ĐẠT** — hai trường diagnostic chết ở tầng Go, và không có E2E xuyên tuyến.

> **BỔ CHÍNH 2026-08-31 (sau bản sửa `#352`).** Hai trường chết ở `checks.go:813` **đã thông**:
> `severity` chuyển tiếp thật qua `normalizeSeverity()` (fail-closed), `message` giữ nguyên văn
> bản compiler qua `sanitizeCompilerMessage()` (bọc ba mẫu đường dẫn tuyệt đối). Tiêu chí FAILED
> chuyển từ `len(diagnostics) > 0` sang `hasError`. `go test ./internal/programming/... -count=1`
> exit `0`, 8 package `ok`. **Mục §2.3.2 — không có E2E xuyên CLI → Go → FE thật — VẪN CÒN
> NGUYÊN**, không thuộc phạm vi `#351`/`#352`. Bằng chứng: `EV-STED-0203-001`.

### 2.4 Chặng (d) — Runtime bo thật + LIVE — **BỊ CHẶN**

- **Bị chặn bởi:** không có controller phần cứng nối vào môi trường đo.
- **Cần để mở khoá:** bo DDC-24 (Foxlinx SOM) đã nạp firmware, kênh nạp/triển khai, và quyền chạy chế độ `LIVE` trên bo.
- Không có phần thay thế bằng phần mềm: chặng này theo định nghĩa phải chạy trên phần cứng thật.

## 3. Bẫy đo đã gặp — cả ba đều đúng loại `#369` cảnh báo

**1. Build dir hỏng vẫn để `ctest` báo pass giả.** Configure trên MinGW FAIL vì thiếu `PkgConfig`, để lại `build/fw` hỏng. Nếu giữ thư mục này và chỉ chạy `ctest`, nó sẽ chạy binary cũ và báo "pass" — số đo giả. *Chặn:* xoá `build/fw` trước khi configure lại, luôn dùng `--fresh`, và đọc exit code của **cả** configure lẫn build.

**2. Tiến trình nền trả exit `0` trong khi build dừng ở 42%.** WSL service treo (`Wsl/Service/0x8007274c`) giết tiến trình build; wrapper vẫn thoát `0`, còn log dừng ở `[ 42%]`. *Chặn:* không đọc exit code của tiến trình nền thay cho exit code của gate; phải `wsl --shutdown` khôi phục rồi chạy lại.

**3. `$?` bị shell ngoài expand → exit code giả.** Chạy `wsl -- bash -lc '... echo $? ...'` báo `CTEST_EXIT=0` trong khi cùng log ghi rõ `1 tests failed`. Shell Windows expand `$?` trước khi chuỗi tới WSL. Nếu tin con số đó, gate đã bị ghi "PASS" sai. *Chặn:* mọi lệnh gate chạy qua **script file** (`scripts/gate369-*.sh`), exit code do chính shell chạy lệnh ghi ra `logs/gate369-*.exit`, tách riêng từng bước configure/build/ctest.

Cả ba đều dẫn tới cùng một kết cục: một con số `0` không phản ánh thực tế. Đây chính là lý do issue `#369` viết riêng hai gạch đầu dòng về exit code.

## 4. Lỗi tìm được và đã sửa trong phiên

### `StSignalBus` — hai test đồng thời fail do thiếu chốt khởi động

**Triệu chứng.** `ctest` lần 1 fail `ConcurrentInspectNeverPairsValueWithForeignTimestamp`; lần 2 fail thêm `ConcurrentReadNeverSeesTornValue`. Chạy lặp riêng 5 lần: **0/5 pass**.

**Nguyên nhân gốc.** Cả hai test **không** fail ở assert đúng đắn. Chúng luôn fail ở đúng một dòng:

```
test_st_signal_bus.cpp:315: Failure
Expected: (observed.load()) > (0u), actual: 0 vs 0
```

`torn == 0` (`:314`) và `mismatched == 0` (`:376`) không bao giờ fail — bus lock-free (double-buffer + seqlock, `st_signal_bus.cpp:331-359`) hoạt động đúng. Vấn đề nằm ở chỗ: main thread chạy hết 20 000 vòng publish trong ~3 ms rồi bật `stop` ngay, còn thread đọc trên máy 2 vCPU chưa được scheduler cấp lượt nào — `observed == 0`, và chính test tự tuyên bố "không chứng minh gì".

**Cách sửa.** Thêm chốt khởi động: publish một bản mồi rồi `yield()` chờ tới khi reader đọc được lần đầu, mới vào vòng đo. Đặt chốt ở **đầu**, không nới lỏng assert ở cuối — phần đo sau vẫn là đồng thời thật, và assert "không chứng minh gì" vẫn giữ nguyên hiệu lực. Ở test thứ hai, bản mồi dùng `published_at_ns = 1` khớp `value = 1 * kUnit` nên không tự tạo lệch cặp giả.

**Kiểm chứng.** `scripts/gate369-verify-stsignalbus.sh`: rebuild `core_tests` (exit `0`), chạy lặp 5 lần → **5/5 PASS** (trước sửa 0/5). Chạy lại toàn bộ: **1338/1338 PASS**, exit `0`.

Tệp sửa: `apps/core/application/st/tests/test_st_signal_bus.cpp`.

## 5. Kết luận

**`REV-STED-IEC-001` chưa được ký đóng.** Theo tiêu chí chấp nhận của `#369`, thiếu bất kỳ chặng nào là không ký.

| Chặng | Trạng thái | Lý do |
|---|---|---|
| (a) C++ build + test | **PASS** | 1338/1338, exit 0, cả 3 option ON — sau `#350`+`#351`/`#352` là **1364/1364**, exit 0 (`EV-STED-0203-001` §2.0, chênh +26 đã truy hết từng nhóm) |
| (b) Vector compiler | **KHÔNG ĐẠT** tại thời điểm đo nền → **ĐẠT** sau `#351` (`EV-STED-0203-001`) | thiếu nhóm WARNING; CLI phát 0 diagnostic cho biến không dùng |
| (c) CLI → Go → FE | **KHÔNG ĐẠT** | `message`/`severity` **đã thông** sau `#352`; **vẫn thiếu E2E xuyên tuyến** — đây mới là phần còn chặn |
| (d) Runtime bo thật | **BỊ CHẶN** | không có phần cứng |

### Tiền đề còn mở

| Trạng thái | Issue |
|---|---|
| `CLOSED` (4) | `#350`, `#356`, **`#351`**, **`#352`** — hai cái sau đóng 2026-08-31 qua PR #413 (`26e34f24`), bằng chứng `EV-STED-0203-001` |
| `OPEN` (15) | `#353`, `#354`, `#355`, `#357`, `#358`, `#359`, `#360`, `#361`, `#362`, `#363`, `#364`, `#365`, `#366`, `#367`, `#368` |
| Nợ kiểm chứng mới (1) | **`#414`** (`ISS-STED-21`) — `#351`/`#352` merge **không qua gate CI** (billing GitHub Actions) và **chưa đo trên bo DDC-24 thật** |

> **Lưu ý khi tính điều kiện ký đóng `#369`.** `#351` và `#352` đã `CLOSED` nhưng bằng chứng của
> chúng là **đo cục bộ trên WSL2**, không phải môi trường phát hành và không qua gate CI. Khi nghiệm
> thu `#369`, phải tính `#414` là **tiền đề còn mở**, nếu không sẽ đúng vào lỗi mà `#369` sinh ra để
> chặn: coi một issue `CLOSED` là bằng chứng đã đủ.

### Giá trị đã xác lập của phiên đo nền

1. Chặng (a) chạy được và **xanh** — có mốc so sánh cho mọi lần đo sau.
2. Ba bẫy đo đã được tái hiện thật và có rào chắn bằng script, không còn phải tin vào exit code kể lại.
3. `F-STED-003` và `F-STED-004` nay có **bằng chứng đo trực tiếp** và địa chỉ sửa chính xác tới dòng (`checks.go:813`), không còn là nhận định đọc code.
4. Xác định được `#351` và `#352` phải sửa cùng nhau — sửa riêng một cái không thông được kênh WARNING.

### Công cụ để lại

| Script | Việc |
|---|---|
| `scripts/gate369-stage-a.sh` | chặng (a) đầy đủ, ghi 3 exit code riêng |
| `scripts/gate369-stage-b.sh` | chặng (b) — test vector ST |
| `scripts/gate369-stage-c.sh` | chặng (c) — Go vet + test `-count=1` |
| `scripts/gate369-warning-probe.sh` | đo trực tiếp kênh WARNING qua CLI |
| `scripts/gate369-rerun-ctest.sh` | chạy lại ctest lấy exit code thật |
| `scripts/gate369-repeat-stsignalbus.sh` | chạy lặp phát hiện test không ổn định |
| `scripts/gate369-verify-stsignalbus.sh` | kiểm chứng bản sửa, rebuild + lặp 5 lần |
