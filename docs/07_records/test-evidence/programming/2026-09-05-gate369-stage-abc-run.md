# Hồ sơ chạy cổng bằng chứng V&V E2E — Issue #369 / `ISS-STED-20`, chặng (a)(b)(c)

| Thuộc tính | Giá trị |
|---|---|
| ID | `EV-GATE369-RUN-002` |
| Issue | `#369` (`ISS-STED-20`) — End-to-End V&V Evidence Gate |
| Review liên quan | `REV-STED-IEC-001` §8.1, §8.3 (`ADR-056`) |
| Ngày đo | 2026-09-05 |
| Base commit | `de8ee26` (`main`) |
| Hồ sơ đo nền trước đó | `EV-GATE369-BASELINE-001` — `2026-08-31-gate369-e2e-vv-baseline.md` |
| Mục đích | **Chạy thật ba chặng chạy được trên host** sau khi các nhánh tiền đề đã vào `main` |
| Verdict tổng thể | **CHƯA ĐỦ ĐIỀU KIỆN KÝ ĐÓNG** — chặng (d) chưa có phần cứng |

## 0. Phạm vi và tính hợp lệ

- Mọi số trong hồ sơ này là **đo thật trong phiên 2026-09-05**. Không dẫn lại số của
  `EV-GATE369-BASELINE-001` hay của bất kỳ hồ sơ nào khác.
- Hồ sơ này **không** ký đóng `#369`. Chặng (d) — runtime trên bo DDC-24 thật, gồm `LIVE` — chưa chạy,
  và tiêu chí chấp nhận của issue ghi rõ: *thiếu bất kỳ chặng nào ⇒ `REV-STED-IEC-001` không được ký đóng*.
- Điều kiện phụ thuộc đọc theo `REV-STED-IEC-001` §8.3 / `ADR-056`: *mọi nhánh `01..19` **trừ những mã đã
  được phạm vi phát hành chính thức hoãn***. Mã đang được hoãn tại thời điểm đo: **`ISS-STED-16` (#367)**,
  phân loại `V1-DEFER` ngày 2026-09-04. Theo ràng buộc 3 của `ADR-056`, tên mã này phải xuất hiện trong hồ
  sơ ký đóng — dòng vừa rồi là chỗ nó xuất hiện.

## 1. Môi trường đo

| Thông số | Chi tiết |
|---|---|
| OS | Linux container (Claude Code remote), Ubuntu 24.04 |
| Trình biên dịch C++ | `g++ 13.3.0` |
| CMake / CTest | `3.28.3` |
| Go | `go1.24.7` |
| Node | `v22.22.2` |
| Playwright | `1.61.1` |
| Tài nguyên | 4 vCPU, 15 GB RAM |
| Ghi chú hợp lệ | **KHÔNG PHẢI môi trường phát hành.** Không có phần cứng DDC-24; egress ra `github.com` bị chặn (xem §5.1). |

## 2. Chặng (a) — C++ build + test

Chạy qua `scripts/gate369-stage-a.sh`. Exit code do **chính shell chạy lệnh** ghi ra `logs/gate369-*.exit`,
tách riêng configure / build / ctest — đúng ba rào chắn mà `EV-GATE369-BASELINE-001` §"ba bẫy đo" dựng lên.

| Bước | Exit | Nguồn |
|---|---|---|
| `cmake --fresh` (MODBUS + BACNET + HMI đều `ON`) | `0` | `logs/gate369-configure.exit` |
| `cmake --build` | `0` | `logs/gate369-build.exit` |
| `ctest` | `0` | `logs/gate369-ctest.exit` |

**Kết quả: `100% tests passed, 0 tests failed out of 1479` · 30.14 s.**

Mốc so sánh: đo nền 2026-08-31 là **1338/1338**. Chênh lệch +141 test là do các nhánh tiền đề đã vào `main`
trong khoảng giữa hai lần đo; không test nào bị gỡ.

**Chặng (a): ĐẠT.**

## 3. Chặng (b) — vector compiler

Chạy qua `scripts/gate369-stage-b.sh`.

**Kết quả: `100% tests passed, 0 tests failed out of 613` (`-R "^St"`) · 3.63 s · `ST_CTEST_EXIT=0`.**

### 3.1 Phủ vector sáu nhóm — nay là phép kiểm máy chạy, không phải nhận định đọc bằng mắt

Đo nền 2026-08-31 kết luận *"5/6 nhóm có phủ, thiếu nhóm WARNING"* bằng cách một người **đọc danh sách tên
test**. Một kết luận đọc bằng mắt thì lần đo sau phải đọc lại bằng mắt, và ngày nào đó nhóm WARNING biến mất
thì tổng số test vẫn tăng đều — cổng vẫn xanh trong khi thứ nó canh đã mất.

Nên phiên này biến tuyên bố phủ vector thành một phép kiểm **có thể đỏ**: `gate369-stage-b.sh` đọc danh sách
test **đã đăng ký** từ chính `ctest -N` và đòi mỗi nhóm có ít nhất một test, in ra tên test làm bằng chứng.

| Nhóm (theo thân #369) | Số test | Bằng chứng đại diện |
|---|---|---|
| Lỗi cú pháp | 5 | `StValidateCli.InvalidSyntaxExitsOneWithDiagnosticPosition` |
| Lỗi kiểu | 4 | `StResolveIoBindings.RejectsOutputBoundToUiWithWrongTypeExactBoardBug` |
| Luật FB — gọi hai lần một chu kỳ | 1 | `StLang.FbCalledTwicePerCycleRejected` |
| Luật FB — ghi vào output | 1 | `StLang.WriteToFbOutputRejected` |
| **WARNING** | **13** | `StWarning.UnusedVariableWarnsButProgramStaysValid` |
| Nhiều diagnostic một lần Kiểm tra | 14 | `StMultiDiagnostic.FiveIndependentSemanticErrorsYieldFiveDiagnostics` |

`STAGE_B=PASS — đủ 6 nhóm vector`, exit `0`.

**Nhóm WARNING — nhóm duy nhất `KHÔNG ĐẠT` ở đo nền — nay có 13 test.** `F-STED-003` đã đóng ở tầng compiler.

### 3.2 Kiểm chứng chính phép kiểm phủ vector

Đổi mẫu nhóm WARNING sang một tiền tố không tồn tại (`StWarningKhongTonTai.`):

```
THIẾU  nhóm 'WARNING' — không có test nào đăng ký
STAGE_B=FAIL — thiếu 1 nhóm vector
INJECTED_EXIT=1
```

Bản không tiêm: `STAGE_B=PASS`, `CLEAN_EXIT=0`. Phép kiểm phủ vector **kêu được**.

**Chặng (b): ĐẠT.**

## 4. Chặng (c) — CLI JSON → Go → FE

Chạy qua `scripts/gate369-stage-c.sh`.

### 4.1 Authority C++: kênh WARNING đã sống

`mkddc-st-validate` chạy trên `scripts/fixtures/gate369-warning.st`:

```json
{"code":"ST-WARN-002","column":3,"length":10,"line":3,
 "message":"variable 'unused_var' is declared but never used","severity":"warning","sourceId":""}
```

Đo nền 2026-08-31 chạy đúng phép đo này và nhận `"diagnostics":[]` — 0 WARNING, kênh chết. Nay diagnostic có
mặt với `severity: "warning"`.

### 4.2 Cùng một diagnostic qua ba tầng

`e2e/gate369-cli-go-fe-real.spec.ts` chạy trên stack **real-backend** (Go `mkddc-web` thật, compiler thật,
Core simulator thật): tạo Project với **chính** source vừa đưa cho CLI, chạy Check production, rồi so từng
trường của diagnostic API với diagnostic CLI, sau đó đòi **chính payload API đó** hiện trên `ProblemsDrawer`.
Không có fixture diagnostic thứ hai ở bất kỳ tầng nào.

WARNING là ca quyết định của `F-STED-004`: Check phải `PASSED` **trong khi vẫn mang** diagnostic WARNING. Nếu
Go lại đè severity thành `ERROR` như bản cũ, vế `PASSED` hoặc phép so severity sẽ đỏ thay vì cho một
false-green.

| Bước | Exit | Số đo |
|---|---|---|
| `go vet ./...` | `0` | — |
| `go test ./... -count=1` | `0` | 21 package `ok` |
| `vitest` `ProblemsDrawer.test.tsx` | `0` | 16/16 PASS |
| CLI capture (`mkddc-st-validate`) | `0` | `ST-WARN-002` · `warning` · dòng 3, cột 3, dài 10 |
| **E2E CLI → Go → FE (real-backend)** | `0` | `1 passed` (23.0 s) — Check `PASSED` mang WARNING; `detailCode`/`message`/`severity`/`line`/`column`/`length` khớp CLI; ProblemsDrawer hiện đúng payload |
| `npm run lint` | `0` | — |
| `npm run build` | `0` | — |

**Chặng (c): ĐẠT.**

## 5. Lỗi phát hiện trong lúc chạy cổng và đã sửa cùng phiên

### 5.1 Chặng (a) không chạy được trên máy bị chặn egress

`gate369-stage-a.sh` gọi `cmake --fresh` mà không có đường trỏ FetchContent vào cache trên đĩa. Máy đo không
có egress ra `github.com` thì configure **hỏng ngay bước đầu** và cả cổng đứng lại — mà thân #369 nói rõ ưu
tiên số một là exit code của configure phải được đọc thật.

Đã thêm `${MKDDC_CMAKE_DEPS:-}` vào lệnh `cmake`. **Không đặt biến thì chuỗi rỗng và lệnh y hệt bản cũ**: đây
là đường thoát cho máy bị chặn mạng, không phải thay đổi cách đo trên máy phát hành.

### 5.2 Chặng (c) không chạy được nếu máy không cài sẵn Google Chrome

`playwright.programming-real.config.ts` ghim `channel: 'chrome'`, nên phép đo release-evidence chỉ chạy được
trên máy có Google Chrome ở `/opt/google/chrome/chrome`. Trên runner CI sạch và trong container đo, lệnh đỏ
ngay ở `browserType.launch` **trước khi chạm được assertion nào**:

```
Error: browserType.launch: Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome
```

Một cổng không chạy được là một cổng sẽ bị bỏ qua — đúng chế độ hỏng mà `#369` sinh ra để chặn. Và chính repo
này đã ghi nguyên tắc ngược lại ở `playwright.board.config.ts`: *"Dùng chromium đi kèm Playwright, không
`channel: 'chrome'`, để không phụ thuộc Chrome cài sẵn của máy chạy."*

Đã sửa: mặc định dùng chromium đi kèm Playwright; ai cần Chrome thật thì đặt `MKDDC_E2E_CHROME_CHANNEL=chrome`
— lựa chọn đó nay là một quyết định **nói ra**, không phải một ràng buộc ẩn. Kèm theo
`MKDDC_E2E_CHROMIUM_PATH` cho máy có browser Playwright ở build khác với build mà `@playwright/test` của repo
trông đợi. `gate369-stage-c.sh` **in cả hai biến ra log** để người ký đọc được phép đo đã chạy trên trình
duyệt nào.

Giá trị dùng trong lần đo này: `MKDDC_E2E_CHROME_CHANNEL=<chromium đi kèm Playwright>`,
`MKDDC_E2E_CHROMIUM_PATH=/opt/pw-browsers/chromium`.

### 5.3 Một bẫy đo thứ tư, gặp ngay trong phiên này

Vòng chờ `until [ -f logs/gate369-real-diagnostic-e2e.exit ]` trả về **ngay lập tức** với giá trị của lần
chạy **trước**, vì tệp exit đã tồn tại từ lần chạy đó. Đây đúng họ với ba bẫy mà `EV-GATE369-BASELINE-001` ghi
lại: **đọc exit code từ sai nguồn**. Số đo trong hồ sơ này vì thế được đọc lại từ tệp exit **sau khi** xác
nhận tiến trình đã kết thúc, không phải từ sự tồn tại của tệp.

## 6. Chặng (d) — runtime trên bo thật, gồm `LIVE`

**BỊ CHẶN.** Không có bo DDC-24 (SOM Foxlinx) trong môi trường đo: không firmware trên target, không kênh
deploy, không quyền `LIVE`. Cùng lý do đã ghi ở #414 (`ISS-STED-21`).

**Không có phần thay thế bằng phần mềm.** Dựng một Core giả rồi khai là "chạy trên bo" sẽ là đúng loại bằng
chứng tự chứng minh cho chính nó mà cổng này sinh ra để dẹp.

**Cần gì để mở khoá:** một bo DDC-24 với firmware đã nạp, kênh deploy tới target, và quyền chạy `LIVE`.

### 6.1 Cập nhật 2026-09-06 — đã có kênh target, chặng (d) vẫn chưa đạt

Kênh SSH/deploy tới Foxlinx đã hoạt động. `EV-STED-21-TARGET-COMPILER-001` cross-build và chạy thật
`mkddc-st-compile` ARM64 trên SOM: `ST-WARN-004` giữ `ok=true`, sinh artifact, và
`PATH_LEAK_COUNT=0` trên JSON target. Đây là **bằng chứng target một phần** cho `#414`.

Target hiện chạy `mkddc-fakemcu` qua `/tmp/mkddc-iop-a -> /dev/pts/0`; artifact dùng khoá thử nghiệm
tạm và chưa được Commission vào Core. Chưa có phép đo output của FB qua hai chu kỳ LIVE, chưa có
Problems UI từ cùng revision, và chưa có STM32/physical I/O. Vì vậy verdict chặng (d) vẫn
**BỊ CHẶN**, không đổi trạng thái ký đóng.

## 7. Kết luận

| Chặng | Verdict | Số đo |
|---|---|---|
| (a) C++ build + test | **ĐẠT** | configure/build/ctest exit `0` · 1479/1479 · 30.14 s |
| (b) Vector compiler | **ĐẠT** | 613/613 · 6/6 nhóm phủ · phép kiểm phủ vector tự kêu được |
| (c) CLI → Go → FE | **ĐẠT** | go/vitest/lint/build exit `0`; CLI phát WARNING; E2E xuyên tuyến `1 passed` |
| (d) Runtime bo thật + `LIVE` | **BỊ CHẶN** | đã chạy compiler ARM64 trên SOM; còn thiếu Commission/LIVE hai chu kỳ và STM32/physical I/O |

`REV-STED-IEC-001` **chưa được ký đóng**: thiếu chặng (d).

So với đo nền 2026-08-31, hai chặng chuyển từ **KHÔNG ĐẠT** sang **ĐẠT** — `F-STED-003` (kênh WARNING chết ở
compiler) và `F-STED-004` (Go đè severity, không có E2E xuyên tuyến) nay đều có phép đo thật phủ.

---

## Revision History

| Phiên bản | Ngày | Người sửa | Mô tả |
|---|---|---|---|
| 1.1 | 2026-09-06 | Codex | Thêm §6.1: kênh target đã hoạt động và compiler ARM64/path-leak đã đo; giữ chặng (d) BỊ CHẶN vì target vẫn FakeMCU, chưa Commission/LIVE/physical I/O |
| 1.0 | 2026-09-05 | Claude Code | Chạy thật chặng (a)(b)(c) trên `de8ee26`; sửa hai khiếm khuyết khiến cổng không chạy được (§5.1, §5.2); biến phủ vector chặng (b) thành phép kiểm máy chạy |
