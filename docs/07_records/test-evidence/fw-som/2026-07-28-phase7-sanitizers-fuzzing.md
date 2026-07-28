# Evidence — Phase 7: ASan, UBSan, fuzzing, fake MCU

> **Ngày:** 2026-07-28
> **Host:** x86_64, GCC 13 + Clang 18
> **Target:** Orange Pi 5B aarch64

---

## 1. AddressSanitizer — tìm ra một lỗi thật

```bash
cmake -S services -B build/asan -DCMAKE_BUILD_TYPE=Debug -DMKDDC_SANITIZE=address
cmake --build build/asan --parallel $(nproc)
ASAN_OPTIONS=detect_leaks=1 ctest --test-dir build/asan --parallel 4
```

**Lần chạy đầu: 644/646, 2 fail, 2 phát hiện ASan.**

```
ERROR: AddressSanitizer: heap-use-after-free
READ of size 6
  #7 AlarmRuntime_ReloadResetsAckWhenClearModeChanges_Test::TestBody()
     test_alarm_runtime.cpp:555
freed by:
  #5 std::_Vector_base<core::AlarmState>::~_Vector_base()
```

**Nguyên nhân:** `AlarmRuntime::active_states()` trả `std::vector<AlarmState>`
**theo giá trị**. Test viết:

```cpp
const AlarmState* state = find_state(alarms.active_states(), "ALM-M");
EXPECT_EQ(state->status, "active");     // ← đọc bộ nhớ đã giải phóng
```

Vector là temporary, bị huỷ ngay cuối biểu thức, nên `state` là con trỏ treo.
12 chỗ trong file mắc lỗi này. Nó **"chạy đúng" suốt** vì bộ nhớ vừa giải
phóng vẫn còn nguyên nội dung cũ.

**Cách sửa — biến lỗi runtime thành lỗi biên dịch:**

```cpp
const AlarmState* find_state(std::vector<AlarmState>&&, const std::string&) = delete;
```

Compiler chỉ ra chính xác 12 chỗ. Sửa hết. Cách này tốt hơn vá từng chỗ vì
**không ai thêm được chỗ thứ 13**.

**Sau khi sửa: 646/646 pass, 0 phát hiện ASan.**

### 1.1 Lỗi thứ hai, do `-Werror` ở mức tối ưu của sanitizer

```
runtime_point_snapshot.cpp:27: '%02d' directive output may be truncated
```

`set_id` ghi `"%s-%02d"` vào buffer 6 byte. `snprintf` **không tràn bộ nhớ**,
nhưng nếu số kênh vượt 99 thì ID bị **cắt âm thầm** thành một ID khác hợp lệ
về hình thức nhưng trỏ sai điểm — không có cách nào phát hiện ở phía đọc.

Hôm nay `KX_N_UI = 16` nên không thể xảy ra, nhưng ràng buộc đó nằm ở file
khác và sẽ không ai nhớ khi tăng số kênh. Đã kẹp tường minh.

## 2. UndefinedBehaviorSanitizer

```bash
cmake -S services -B build/ubsan -DCMAKE_BUILD_TYPE=Debug -DMKDDC_SANITIZE=undefined
```

Preset bật `-fno-sanitize-recover=all`: UB phải làm test **fail**, không được
chỉ in cảnh báo rồi chạy tiếp. UB im lặng lọt qua CI tệ hơn là không chạy
UBSan, vì nó tạo cảm giác an toàn giả.

**Kết quả: 646/646 pass, 0 runtime error.**

## 3. Fuzzing — và bài học về việc đo thay vì đoán

Hai harness libFuzzer (clang 18):

| Harness | Bề mặt |
|---|---|
| `fuzz_st_parser` | Source ST: lexer → parser → semantic |
| `fuzz_st_loader` | Artifact: 22 bước verify + execute 4 chu kỳ |

Harness loader quan trọng nhất vì theo `TYPED_IR_ARTIFACT_SPEC` §6.1 executor
**không kiểm biên** sau khi load — lỗi lọt qua loader là lỗi an toàn bộ nhớ.

### 3.1 Harness loader ban đầu gần như vô dụng

Chạy 8,2 triệu lần, 0 crash — nhưng chỉ **24 unit mới**. Nghi ngờ, viết probe
đếm phân bố mã lỗi trên 1000 đột biến ngẫu nhiên:

| Giai đoạn | `IR-E-005` (hash) | `IR-E-006` (chữ ký) | Load OK | Còn lại |
|---|---|---|---|---|
| Harness ban đầu | **947** | 0 | 0 | 53 |
| Sau khi vá hash | 0 | **947** | 0 | 53 |
| Sau khi **xoá cờ `kSigned` rồi mới vá hash** | 0 | 0 | **277** | 723 rải đều `IR-E-008/010/011/014` |

Nghĩa là:

- Ban đầu 95% input chết ở bước 7 — fuzzer **không bao giờ** chạm tới bảng
  section, bảng biến hay luồng lệnh.
- Vá hash xong, nghẽn chỉ **dịch sang** chữ ký, vì cờ `kSigned` vẫn bật và
  loader vẫn cố verify chữ ký đã bị zero.
- Phải xoá cờ **trước** khi tính hash (cờ nằm trong vùng được hash) thì mới mở
  ra được.

Nếu không đo, 8 triệu lần chạy chỉ chứng minh "SHA-256 hoạt động" — điều đã
biết — và tạo cảm giác an toàn giả.

Vá hash **không làm yếu kiểm thử**: tính toàn vẹn đã có test riêng
(`StIr.RejectModifiedPayloadByHash`, `SingleBitFlipAlwaysRejected`). Ở đây cố
ý bỏ qua nó để fuzz phần **logic phân tích** bên trong.

### 3.2 Kết quả sau khi sửa harness

| Harness | Số lần chạy | Crash | Phát hiện ASan |
|---|---|---|---|
| `fuzz_st_parser` | **698 815** (61 s) | 0 | 0 |
| `fuzz_st_loader` | **7 563 082** (241 s) | 0 | 0 |

Tốc độ loader giảm 81k → 31k exec/s sau khi sửa — đúng như kỳ vọng khi harness
thật sự load và thực thi thay vì bail sớm ở bước hash.

## 4. Fake MCU — bổ sung 4 fault injection

Phủ nốt các kịch bản `PROGRAM_SOM_FW_DRAFT_DESIGN` §9.3.

| Cờ mới | Mô phỏng | FW SOM phải làm gì |
|---|---|---|
| `--adc-fault {1\|2\|3}` | Mất DRDY + bật LOCK trên ADS131M08 | Hạ quality kênh xuống BAD; safe-state nếu graph đang dùng kênh đó |
| `--dac-fault` | `FAULT` bit2 | Ghi nhận AO không ra được lệnh |
| `--wdg-reset N` | `WDG_RESET_CNT = N` + sticky bit5 | Nhận biết MCU vừa reset do watchdog |
| `--stuck-ui CH RAW` | Cảm biến "đơ" ở giá trị cố định | **CRC và quality không bắt được** — phải phát hiện bằng cách khác |

`--wdg-reset` đáng chú ý: trước đây `WDG_RESET_CNT` **hằng 0** trong fake MCU
nên đường "MCU vừa reset do watchdog" chưa từng test được.

`--stuck-ui` mô phỏng loại hỏng hóc mà mọi lớp kiểm tra truyền dẫn đều bỏ
qua: frame đúng CRC, quality GOOD, chỉ có điều giá trị không bao giờ đổi.

### 4.1 Verify end-to-end fake MCU ↔ iobus

```bash
socat PTY,link=/tmp/fm_a PTY,link=/tmp/fm_b &
fake_mcu --uart /tmp/fm_b --adc-fault 1 --dac-fault --wdg-reset 7 &
mkddc-iobus --uart /tmp/fm_a
```

iobus nhận đúng và raise alarm:

```json
{"code":"MCU_FAULT_FLAGS","severity":"warning","data":{"fault_flags":5}}
```

`5` = `0b0101` = bit0 (`IOP_FAULT_ADC1`) + bit2 (`IOP_FAULT_DAC`) — chính xác
những gì được inject.

## 5. CI

Thêm 2 job vào `.github/workflows/build-and-test.yml`:

| Job | Nội dung |
|---|---|
| `sanitizers` | ASan (kèm `detect_leaks=1`) + UBSan trên toàn bộ suite |
| `fuzz-smoke` | Build 2 harness bằng clang, chạy 60 s mỗi cái trên PR |

Chiến dịch fuzz dài để chạy nightly; PR chỉ chạy smoke để bắt hồi quy rõ ràng
mà không làm chậm vòng lặp phát triển.

## 6. Tổng kết verification

| Chế độ | Kết quả |
|---|---|
| Build `-Wall -Wextra -Werror`, BACNET+MODBUS ON | **649/649 pass**, 0 lỗi |
| ASan | **646/646 pass**, **0 phát hiện** |
| UBSan | **646/646 pass**, **0 runtime error** |
| Fuzz parser | 698 815 lần chạy, 0 crash |
| Fuzz loader | 7 563 082 lần chạy, 0 crash |
| Symbol check `mkddc-core` | 0 symbol compiler |
| **aarch64 trên board** | **646/646 pass** |

## 7. Deploy lên target

Quy trình đã áp dụng đúng quy tắc rút ra từ lần deploy trước (dọn SHM sau khi
dừng service **và** sau khi chạy ctest):

```
backup    → /usr/sbin/mkddc-backup-20260728-162010/
stop      → mkddc-core, mkddc-iobus
rm SHM    → /dev/shm/mkddc_*
ctest     → 646/646 trên aarch64
install   → 4 binary + mkddc-fake-mcu
rm SHM    → lần nữa (ctest vừa tạo file sai chủ sở hữu)
start     → iobus trước, core sau
```

**Lần này deploy sạch ngay lần đầu**, không gặp lỗi `attach_fail` như lần
trước — quy tắc dọn SHM hai lần có tác dụng.

| Sau deploy | Kết quả |
|---|---|
| `NRestarts` sau 2 phút | 0 → 0, **ổn định** |
| Jitter chu kỳ 1 s | max **276–295 µs**, **0 overrun** |
| SHM | đúng chủ `mkddc` |
| `mkddc-fake-mcu --help` | nhận đủ 4 cờ mới |
| Script integration BE trên aarch64 | **18/18 pass** |

## 8. Vẫn chưa đóng

| # | Việc | Vì sao |
|---|---|---|
| 1 | TSan | Chưa chạy. `mkddc-core` đơn luồng nên giá trị thấp; `mkddc-iobus` có 3 thread nên **đáng làm** |
| 2 | Chiến dịch fuzz dài (≥1 giờ nightly) | CI job đã có, chưa chạy nightly thật |
| 3 | Đo WCET/jitter hợp lệ | Chặn bởi `F-13` (RT không hoạt động) |
| 4 | Soak 24 giờ | Cần 24 giờ thực |
| 5 | HIL với STM32 thật | Không có phần cứng — DEFERRED |
