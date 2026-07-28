# FW SOM — Bằng chứng kiểm thử

> **Document ID:** HANDOFF-EVIDENCE-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-07-28
> **Nguyên tắc:** mọi con số dưới đây là **đo thật**, không lấy từ tài liệu.

## Lệnh tái lập

```bash
cmake -S services -B build/services -DCMAKE_BUILD_TYPE=RelWithDebInfo \
  -DCMAKE_CXX_FLAGS="-Wall -Wextra -Werror" \
  -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_MODBUS=ON
cmake --build build/services --parallel $(nproc)
rm -f /dev/shm/mkddc_io_shm /dev/shm/mkddc_plc_shm
ctest --test-dir build/services --output-on-failure --parallel 4

# Script integration dành cho BE
services/core/st/samples/be_integration_test.sh build/services
```

## Kết quả host (x86_64, 2026-07-28)

| Hạng mục | Kết quả |
|---|---|
| Build `-Wall -Wextra -Werror` | **0 lỗi** |
| `ctest` | **646/646 pass, 0 fail, 0 skip** |
| `cppcheck` trên `services/core/st/*.cpp` | **0 lỗi** |
| Symbol check `mkddc-core` | **0** symbol compiler |
| Script integration BE | **18/18 pass** |

## Bảng gate

| Gate | Trạng thái | Bằng chứng |
|---|---|---|
| `PARSER_SAFETY_GATE` | ✅ PASS | 27 test đối kháng; repro segfault gốc đã đóng |
| `BASELINE_DOC_SYNC` | ✅ PASS | 3 tài liệu lỗi thời đã xử lý |
| `ARCHITECTURE_SPEC_GATE` | ✅ PASS | C0.4 + C0.6 + C0.7 Done |
| `TYPED_IR_GATE` | ✅ PASS | Test reject cho **từng** mã `IR-E-*` + quét cắt xén/lật bit |
| `ZERO_ALLOCATION_GATE` | ✅ PASS | 1000 chu kỳ, `operator new` = **0 lần** |
| `TASK_SAFETY_GATE` | ✅ PASS | 16 test overrun/safe-state, gồm test phân tách trách nhiệm |
| `SCHEDULER_GATE` | ✅ PASS | 30 test phủ 12 nhóm bắt buộc |
| `PACKAGE_SECURITY_GATE` | ✅ PASS | 5 trường hợp reject + gói ký bằng **khoá khác** |
| `WATCHDOG_GATE` | ⚠️ **một phần** | Hành vi PASS trên target; **định lượng chờ RT** — xem §Hạn chế |

## Nhóm test đáng chú ý

**Loader reject** — một test cho *từng* mã `IR-E-*`, cộng hai lớp quét toàn
diện: cắt artifact tại **mọi** offset và lật từng bit. Lý do: sau khi load
thành công executor **không kiểm biên nữa**, nên một lỗi lọt qua loader là lỗi
an toàn bộ nhớ, không phải lỗi logic.

**Zero-allocation** — đếm `operator new` qua 1000 chu kỳ, kèm một test kiểm
chính bộ đếm để test kia không vô nghĩa nếu probe hỏng.

**Đối kháng parser** — 12 000 và 20 000 dấu ngoặc lồng, `NOT` lặp 5000 lần,
rác nhị phân, source rỗng, identifier quá dài. Bảo đảm: exit code luôn thuộc
{0,1,2}, stdout luôn đúng một dòng JSON.

**Tích hợp** — manual thắng ST, safe-state thắng tất cả, chương trình lỗi
không crash và không phát output, zero-allocation **vẫn giữ** sau tích hợp.

## Kết quả trên target SOM

Orange Pi 5B, kernel 6.1.43-rockchip-rk3588 aarch64, 8 core.

| Test | Kết quả |
|---|---|
| Scan treo (SIGSTOP) | systemd restart sau **6 s** |
| Kill process | khởi động lại sau **2 672 ms** |
| Khôi phục | `core.ready first scan done` |
| 45 s vận hành bình thường | không restart oan |
| Jitter chu kỳ 1 s | max **284–356 µs**, **0 overrun** |

Chi tiết: [`2026-07-28-watchdog-target.md`](../07_records/test-evidence/fw-som/2026-07-28-watchdog-target.md)

## Hạn chế — đọc trước khi tin số

**1. Target đang chạy KHÔNG có real-time.**
`mkddc-core` chạy `SCHED_OTHER` prio 0 chứ không phải `SCHED_FIFO 80`. Nguyên
nhân gốc đã xác định: `CONFIG_RT_GROUP_SCHED=y` **cộng** cgroup v2 — cgroup v2
không có interface `cpu.rt_runtime_us` nên **không service systemd nào** dùng
được RT. Quyết định 2026-07-28: rebuild kernel với `RT_GROUP_SCHED=n`.

Hệ quả: **mọi số jitter/WCET ở trên không đại diện cho cấu hình production**,
và `WatchdogSec=6` là giá trị **tạm**.

Từ 2026-07-28, `mkddc-core` publish trạng thái RT vào PLC SHM
(`rt_sched_policy`, `rt_sched_priority`, `rt_mlock_ok`, `rt_degraded`) để
BE/Web hiển thị **liên tục** — suy giảm này từng tồn tại nhiều ngày mà không
ai biết vì cảnh báo chỉ log một dòng lúc khởi động rồi cuộn khỏi journal.

**2. Chưa có STM32 thật.** Toàn bộ đường IOP test bằng fake MCU qua PTY. HIL
với MCU thật là DEFERRED có ghi nhận.

**3. Chưa chạy các lớp verification sau** (Phase 7, chưa thực hiện): ASan,
UBSan, TSan, fuzzing parser/loader, đo WCET trên target có RT, soak 24 giờ,
fault injection trên phần cứng.

## Điều BE có thể tin và chưa thể tin

| Có thể tin | Chưa thể tin |
|---|---|
| Hợp đồng API ổn định, mã lỗi đầy đủ | Số liệu thời gian thực trên production |
| Artifact format và cơ chế verify | Hành vi dưới tải nặng dài ngày |
| Ngữ nghĩa ngôn ngữ ST | Đường IOP với MCU thật |
| Chương trình lỗi không làm chết core | Biên WCET chính xác |
