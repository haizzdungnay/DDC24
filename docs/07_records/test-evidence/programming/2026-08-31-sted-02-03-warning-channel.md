# Hồ sơ bằng chứng — kênh WARNING xuyên ba tầng (`#351` / `#352`)

| Thuộc tính | Giá trị |
|---|---|
| ID | `EV-STED-0203-001` |
| Issue | `#351` (`ISS-STED-02` — bật kênh WARNING end-to-end), `#352` (`ISS-STED-03` — giữ `message` và `detailCode` tới UI) |
| Tiền đề | `#350` (`CLOSED`) — `StDiagnosticBag` |
| Ngày đo | 2026-08-31 |
| Base | `68580c0a` (`origin/main`) + nhánh `evidence/gate369-vv-baseline` |
| Hồ sơ đo nền liên quan | `2026-08-31-gate369-e2e-vv-baseline.md` (`EV-GATE369-BASELINE-001`) |
| Verdict | **ĐẠT** cho `#351` và `#352`. `ST-WARN-001` khai báo-chưa-hiện-thực, có lý do và điều kiện mở khoá ghi ở §5 |

## 0. Việc này chứng minh cái gì

Hồ sơ đo nền `EV-GATE369-BASELINE-001` §2.2 ghi `COUNT_WARNING=0` và kết luận
**KHÔNG ĐẠT** cho chặng (b), §2.3.1 ghi hai trường `message`/`severity` "chết ở
`checks.go:813`". Hồ sơ này là phép đo **cùng khung, cùng kịch bản**, sau khi sửa —
để so được trực tiếp trước/sau chứ không phải một khung đo mới.

## 1. Môi trường

Giống `EV-GATE369-BASELINE-001` §1: WSL2 Ubuntu 24.04 (host Windows 11), `g++ 13.3.0`,
CMake/CTest `3.28.3`, `go1.26.4`, Node `v24.16.0`, 2 vCPU / 3 GB RAM, mã nguồn ở
`/mnt/e/.../MK-DDC-24` (mount 9p). **Không phải môi trường phát hành.**

Cấu hình C++ bật **cả ba** option theo quy tắc dự án:
`-DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON`, configure từ **root**,
và **đọc exit code của cả configure lẫn build** (bẫy đo số 1 và số 3 ở hồ sơ nền).

**Sai lệch có chủ ý so với quy tắc `--fresh`:** lượt chạy toàn suite dùng lại thư mục build đã
configure thay vì `--fresh`, vì `--fresh` xoá `_deps` và `FetchContent` không rename được thư
mục bacnet-stack trên mount 9p (chi tiết ở §6, bẫy 2). Bù lại rủi ro mà `--fresh` sinh ra để
chặn: script in `CMakeCache.txt` (`MKDDC_ENABLE_*` và `CMAKE_HOME_DIRECTORY`) **trước** mỗi lượt
build, nên cấu hình được chứng minh chứ không được giả định.

## 2. Chặng (b) — vector chẩn đoán của compiler

### 2.0 Toàn suite C++ từ root — so trực tiếp với chặng (a) của hồ sơ nền

`scripts/gate351-cpp-full.sh`, configure từ **root**, cả ba option `ON`:

| Bước | Exit thật | Số đo | Log |
|---|---|---|---|
| build | `0` | 100 % | `logs/gate351full-build.log`, `.exit` |
| `ctest` toàn suite | `0` | **1364/1364 PASS**, 0 FAIL, 56,44 s | `logs/gate351full-ctest.log`, `.exit` |

Cấu hình được **chứng minh** từ `build/gate351/CMakeCache.txt`, không phải giả định:

```
MKDDC_ENABLE_BACNET:BOOL=ON
MKDDC_ENABLE_HMI:BOOL=ON
MKDDC_ENABLE_MODBUS:BOOL=ON
CMAKE_HOME_DIRECTORY:INTERNAL=/mnt/e/TuanDuong/INTERN/DDC24_project/MK-DDC-24
```

**1364 so với 1338 ở hồ sơ nền: +26.** Con số này phải giải thích được hết, vì một
chênh lệch không giải thích được là chỗ ẩn của test bị mất. So tên test giữa hai log
(`logs/gate369-ctest.log` ↔ `logs/gate351full-ctest.log`) cho tập chênh **chỉ một chiều**
— không test nào biến mất:

| Nhóm | Số | Nguồn |
|---|---|---|
| `StWarning.*` | 11 | Bản sửa này (`#351`/`#352`) |
| `StMultiDiagnostic.*` | 14 | `c26bf178` của `#350` — đã vào `main` **sau** lúc đo nền |
| `st_language_profile_contract` | 1 | `apps/core/CMakeLists.txt:392`, cùng đợt `#350` |

11 + 14 + 1 = 26. Phần 15 test không phải của bản sửa này: hồ sơ nền đo lúc 11:57 trên
cây chưa có `#350`, nên chúng xuất hiện là đúng chứ không phải hồi quy.

### 2.1 Test đơn vị mới

`apps/core/application/st/tests/test_st_warning.cpp` — 11 test.

| Bước | Exit thật | Số đo | Log |
|---|---|---|---|
| configure | `0` | — | `logs/gate351-configure.exit` |
| build | `0` | — | `logs/gate351-build.exit` |
| `ctest -R StWarning` | `0` | **11/11 PASS**, 0,48 s | `logs/gate351-warn.log` |
| `ctest -R '^St'` | `0` | **597/597 PASS**, 22,73 s | `logs/gate351-st.log` |

597 so với **572** ở hồ sơ nền: +25 test, trong đó 11 test `StWarning` mới.

Nội dung 11 test không chỉ khẳng định "có phát cảnh báo" mà khẳng định **cả bốn bất biến
dễ vỡ nhất**, mỗi cái một test riêng:

1. `UnusedVariableWarnsButProgramStaysValid` — cảnh báo **kèm** `ok == true`,
   `has_error() == false`. Một cảnh báo phát đúng mã nhưng làm chương trình hợp lệ trượt
   Check là hồi quy nặng hơn hẳn việc thiếu cảnh báo.
2. `VariableUsedWithWrongTypeIsNotAlsoReportedUnused` — biến dùng **sai kiểu** vẫn tính là
   *được dùng*. Nếu đánh dấu vết sử dụng sau phán quyết kiểu thì một lỗi kiểu sẽ kéo theo
   một `ST-WARN-002` giả và người dùng đi sửa nhầm chỗ.
3. `ErrorSuppressesUsageWarningsBecauseTraceIsIncomplete` — có lỗi thì **không** phát cảnh
   báo sử dụng, vì việc soát dừng giữa chừng nên vết đọc/ghi không đầy đủ.
4. `LegacySingleDiagnosticApiStaysCleanForWarningOnlyProgram` — overload **không** nhận túi
   giữ nguyên hợp đồng "một lỗi": `diagnostic.code` vẫn rỗng cho chương trình chỉ có cảnh
   báo. Mọi caller cũ kiểm `diag.code.empty()` không bị đổi nghĩa dưới chân.

Ngoài ra: vị trí cảnh báo trỏ **dòng khai báo** (test kiểm `line == 3`, `line == 2`), và
`ST-WARN-003` không kéo theo `ST-WARN-002` cho cùng một ô.

### 2.2 Đo qua CLI thật — cùng nguồn với hồ sơ nền

`mkddc-st-validate`, nguồn có **một biến thừa** và **một `VAR_OUTPUT` không gán**
(`scripts/gate351-cli-probe.sh`):

```json
{"artifactHash":"873b2a577edd6ea4...","compilerVersion":"fwsom-st-1.2.0","diagnostics":[
 {"code":"ST-WARN-002","column":3,"length":10,"line":3,"message":"variable 'unused_var' is declared but never used","severity":"warning","sourceId":""},
 {"code":"ST-WARN-003","column":3,"length":3,"line":7,"message":"VAR_OUTPUT 'cmd' is never assigned","severity":"warning","sourceId":""}],
 "irSchemaVersion":1,"ok":true,"symbols":[{"direction":"output","name":"cmd","type":"BOOL"}]}
```

`EXIT=0`, `COUNT_WARNING=2`, `COUNT_ERROR=0` — nghịch đảo đúng số đo nền
(`diagnostics: []`, `COUNT_WARNING=0`).

### 2.3 Đo qua `mkddc-st-compile` — đường mà Go thật sự gọi

`mkddc-st-validate` chỉ kiểm, không sinh artifact. Đường Go dùng là `mkddc-st-compile`, nên
phải đo riêng để chứng minh **cảnh báo không chặn sinh artifact**:

```
COMPILE_EXIT=0
ok= True   artifactSha256 khác rỗng
diagnostics: ST-WARN-002 (line 3), ST-WARN-003 (line 7), sourceId="main"
```

Kịch bản `ST-WARN-004` (đọc `timer.Q` trước `timer(...)`):

```
ok= True   artifact= True
[{"code":"ST-WARN-004","column":14,"length":5,"line":9,
  "message":"output 'Q' of 'timer' is read before 'timer' is called in this cycle; the value is from the previous cycle",
  "severity":"warning","sourceId":"main"}]
```

Cả hai lần: `ok = true` **và** artifact vẫn được sinh. Đây là bằng chứng trực tiếp cho
`ST_SUBSET_SPEC` §12.6.

### 2.4 Bất biến bảo mật ngay tại nguồn

Đếm trên JSON thật của CLI: `PATH_LEAK_COUNT=0` — không có `/tmp`, `/mnt/e`, hay tên thư mục
khoá nào trong đầu ra, dù nguồn và khoá đều nằm ở đường dẫn tuyệt đối.

**Nhưng không được rút ra kết luận "compiler tự nó an toàn".** Số 0 này có **hai** nguyên nhân,
và chỉ một là thuộc tính của mã:

1. Emitter cảnh báo dựng message từ **tên định danh của người dùng**, không nội suy đường dẫn —
   đây là thuộc tính của mã, giữ được qua mọi cấu hình build.
2. Root `CMakeLists.txt:23-31` bật `-ffile-prefix-map` ánh xạ thư mục nguồn và thư mục build
   thành `/mkddc-src` và `/mkddc-build`, nên `__FILE__` và debug info **không mang path thật** —
   đây là thuộc tính của **cấu hình build**, mất ngay nếu ai đó biên dịch bằng cấu hình khác.

Vì (2) là một cờ build chứ không phải một bất biến của mã, `sanitizeCompilerMessage()` bên Go
**không** phải lớp thừa: nó là lớp duy nhất còn hiệu lực khi binary compiler được dựng ngoài
cấu hình chuẩn. Đây chính là lý do `#352` yêu cầu bộ lọc ở tầng Go chứ không chỉ dựa vào nguồn.

**Trạng thái chặng (b): ĐẠT** — nhóm WARNING đã có phủ, thay cho "5/6 nhóm" ở hồ sơ nền.

## 3. Chặng (c) — CLI JSON → Go → FE

### 3.1 Go

| Bước | Exit thật | Số đo |
|---|---|---|
| `go vet ./...` | `0` | sạch |
| `go test ./internal/programming/... -count=1` | `0` | **8 package `ok`**, 0 FAIL (`canonicaljson` không có test) |

Test then chốt:

- `TestCheckServiceWarningOnlyPassesWithDiagnosticsAndMessage` — kết quả compiler chỉ có
  cảnh báo ⇒ `view.State == "PASSED"`, **và** `len(view.Diagnostics) == 1` với
  `Severity == "WARNING"`, `DetailCode == "ST-WARN-002"`, `Message` là **văn bản thật của
  compiler**. Đây là tiêu chí nghiệm thu của cả `#351` (không làm FAILED) lẫn `#352` (giữ
  `message` và `detailCode`) trong một phép đo.
- `TestCheckServiceErrorAndWarningFailsWithBothDiagnosticsPreserved` — lỗi + cảnh báo ⇒
  FAILED nhưng **giữ đủ 2 diagnostic**, không nuốt cái nào.
- `TestSanitizeCompilerMessageStripsHostPathsAndTokens` — **3/3 subtest PASS**: path POSIX,
  path ổ đĩa Windows, path UNC đều bị xoá khỏi `message`.
- `TestNormalizeSeverityDefaultsUnknownAndEmptyToError` — 9 case, fail-closed.
- `TestSanitizeCompilerMessageTruncatesOnRuneBoundary` — message vượt trần 512 byte bị cắt
  **trên biên rune**: kết quả vẫn là UTF-8 hợp lệ và không chứa `U+FFFD`.

### 3.1.1 Một lỗi hiệu năng sửa kèm

Vòng cắt ban đầu bỏ dần rune cuối và gọi `len(string(runes))` mỗi vòng — mỗi vòng dựng lại
cả chuỗi, nên chi phí là **O(n²)** theo độ dài message. Độ dài message do đầu vào của người
dùng chi phối (tên biến nằm trong message), nên đây là nhánh chạy thật, không phải nhánh lý
thuyết. Thay bằng một lượt duyệt `for i := range msg` lấy biên rune lớn nhất còn lọt trần —
**O(n)**. Test ở trên khoá lại hành vi cắt để bản sửa không âm thầm cắt giữa byte.

### 3.2 Sửa đứt gãy ghi ở hồ sơ nền §2.3.1

| Trường | Hồ sơ nền | Sau bản sửa |
|---|---|---|
| `message` | **bị bỏ**, thay bằng `MessageKey` | giữ nguyên văn bản compiler, qua `sanitizeCompilerMessage()` |
| `severity` | **đè cứng `"ERROR"`** | chuyển tiếp thật, qua `normalizeSeverity()` fail-closed |
| tiêu chí FAILED | `len(diagnostics) > 0` | `hasError` — bám severity |
| nhánh PASSED | trả `[]DiagnosticView{}` | trả `diagnostics`, cảnh báo sống sót |

### 3.3 FE

| Bước | Exit thật | Số đo |
|---|---|---|
| `npx vitest --run --environment jsdom src` | `1` | **2204/2205 PASS**, 188/189 tệp |
| `npm run lint` | `0` | sạch |
| `npm run build` | `0` | build được |

Test đỏ duy nhất: `src/app/route-menu-contract.test.ts` case **N-08** — đúng test đã ghi ở
hồ sơ nền §2.3 bảng "Ba test FAIL". Nguyên nhân **không liên quan** tới `#351`/`#352`: một
thay đổi FE **cục bộ chưa commit** đã gỡ `<h1>` khỏi `ProgrammingHeader.tsx` (và sửa cả chú
thích bố cục trong `ProgrammingLayout.tsx` cho khớp), trong khi hợp đồng route-menu vẫn đòi
đúng một `<h1>`. Quy tắc dự án: **FE cục bộ là nguồn chân lý** — không ghi đè. Ba tệp đó
(`ProgrammingHeader.tsx`, `ProgrammingLayout.tsx`, `e2e/programming.spec.ts`) **không** nằm
trong commit của `#351`/`#352`.

**Trạng thái chặng (c): ĐẠT cho phạm vi diagnostic.** Mục §2.3.2 của hồ sơ nền — *không có
E2E chạy xuyên CLI → Go → FE thật* — **vẫn còn nguyên**, không thuộc phạm vi hai issue này.

## 4. Kiểm tra hợp đồng catalog

`contracts/programming/error_catalog_v1.json` lên **1.9.0**. Chạy lại
`scripts/generate_programming_errors.py` (với `PYTHONUTF8=1` trên Windows — nếu không sẽ
gặp `'charmap' codec can't decode`) cho kết quả **idempotent**: chạy lần hai không sinh thêm
khác biệt nào.

Bốn mã có mặt đủ ở cả bốn artifact sinh:

| Tệp sinh | Số mã `ST-WARN-*` |
|---|---|
| `contracts/programming/error_catalog_v1.json` | 4 |
| `apps/core/application/programming/program_error_generated.hpp` | 4 |
| `apps/web-api/internal/programming/domain/errors_generated.go` | 4 (một dòng bảng ánh xạ) |
| `apps/web-ui/src/features/programming/api/generated/errors.ts` | 4 |

`scripts/generate_programming_errors.py` phải thêm `WARN` vào regex quét mã compiler —
thiếu nhánh này thì bộ gác hai chiều catalog ↔ nguồn **không nhìn thấy** các hằng mới và im
lặng bỏ qua, đúng loại lỗi mà bộ gác sinh ra để chặn.

## 5. Mục duy nhất bị chặn — `ST-WARN-001`

- **Bị chặn bởi:** compiler **không nhận chu kỳ Task làm đầu vào**. `periodMs` chỉ tồn tại
  trên đường runtime (`st_control_api.cpp:120`), không có trong hợp đồng `Input` của
  compile. Mọi phán quyết "PT nhỏ hơn chu kỳ Task" ở tầng compiler sẽ là đoán mò — phát một
  cảnh báo sai còn tệ hơn không phát.
- **Cần để mở khoá:** đưa chu kỳ Task vào đầu vào compile (đổi hợp đồng `Input` của CLI và
  của `programmingcompiler.Input` bên Go), việc này thuộc phạm vi khác.
- **Đã làm phần làm được:** hằng vẫn khai trong `st_diagnostic.hpp`, vẫn có trong catalog và
  vẫn được ghi rõ trạng thái "chưa hiện thực" ở `ST_SUBSET_SPEC` §12.6 và
  `docs/handoff/FW_SOM_ERROR_CODES.md`, để tài liệu và mã có **một** nguồn duy nhất thay vì
  hai bảng lệch nhau.
- `#351` cho phép rõ ràng việc này: *"ST-WARN-001 cần chu kỳ Task nên làm sau nếu chưa có
  đầu vào"*.

## 6. Hai bẫy đo gặp trong chính phiên này

Cả hai đều thuộc đúng loại mà `#369` viết riêng hai gạch đầu dòng để chặn: **một con số `0`
không phản ánh thực tế**. Ghi lại vì lần sau sẽ gặp lại.

**Bẫy 1 — configure từ `apps/core` cho gate "xanh" trên tập con.** Lần chạy đầu dùng
`cmake -S apps/core` và cho `973/973 PASS, exit 0`. Con số đó **xanh và sai**: hồ sơ nền
`#369` chặng (a) ghi **1338** test. Chênh 365 vì `apps/core` chỉ đăng ký test của core, còn
root `CMakeLists.txt` mới là authority sau `PLAN-ARCH-RESTRUCT-002` và kéo thêm `fw_hostcheck`,
`iobus`, `netcfg`, `hmi`. Kiểm bằng `CMAKE_HOME_DIRECTORY` trong `CMakeCache.txt`: giá trị phải
là gốc repo, không phải `apps/core`. Chạy lại đúng từ root cho **1364** — nghĩa là lần "xanh"
đầu tiên đã bỏ sót **391** test. *Chặn:* gate C++ luôn configure từ root và đối chiếu tổng
số test với hồ sơ nền — số test **giảm** so với nền là dấu hiệu configure sai phạm vi, không
phải dấu hiệu tốt. Và khi số **tăng**, phải giải thích được từng nhóm tăng (§2.0), vì một
chênh lệch không truy được cũng che được test bị mất.

**Bẫy 2 — `ctest` trả exit `0` kèm "No tests were found!!!".** Lần chạy root với `--fresh` cho
`CFG_EXIT=1`, `BUILD_EXIT=2`, **`CTEST_EXIT=0`**. Nếu chỉ đọc `CTEST_EXIT` thì gate đã được ghi
"PASS" trong khi không một test nào chạy. Nguyên nhân configure hỏng là môi trường chứ không
phải mã: `--fresh` xoá `_deps`, `FetchContent` phải **rename** thư mục giải nén bacnet-stack
trên mount 9p, và thao tác đó trả `Permission denied` (`apps/iobus/CMakeLists.txt:39`).
*Chặn:* đọc **cả ba** exit code, và coi `CTEST_EXIT=0` là vô nghĩa nếu tổng số test bằng 0.
Trên môi trường này, dùng lại thư mục build đã có `_deps` thay vì `--fresh` — nhưng phải in
`CMakeCache.txt` để chứng minh cấu hình vẫn đủ cả ba option, chứ không tin vào trí nhớ.

## 7. Quan hệ với `#369`

Hồ sơ này **không** đóng `#369`. Nó gỡ hai trong số các tiền đề của `#369` và đưa chặng (b)
từ **KHÔNG ĐẠT** sang **ĐẠT**. `#369` còn chặn bởi:

- 15 issue tiền đề khác trong dải `ISS-STED-01..19` chưa merge vào `main`;
- **chặng (d)** — runtime trên bo DDC-24 thật ở chế độ `LIVE`. Không có phần thay thế bằng
  phần mềm. *Cần để mở khoá:* bo DDC-24 (Foxlinx SOM) đã nạp firmware, kênh nạp/triển khai,
  và quyền chạy `LIVE`.

## 8. Lịch sử sửa đổi

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| b1.0 | 2026-08-31 | Bản đầu — bằng chứng cho `#351` và `#352` |
