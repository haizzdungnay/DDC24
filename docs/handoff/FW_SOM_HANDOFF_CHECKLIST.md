# FW SOM — Checklist bàn giao BE

> **Document ID:** HANDOFF-CHECKLIST-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-07-28
> **Trạng thái:** chưa ký — chờ nghiệm thu

Checklist này là **điều kiện nghiệm thu**, không phải bản tóm tắt. Một mục
chưa tick nghĩa là chưa đạt, kể cả khi "gần xong".

## A. Interface — BE tích hợp được mà không phải hỏi lại FW

| # | Hạng mục | Trạng thái | Bằng chứng |
|---|---|---|---|
| A1 | ST validation interface (input/output/exit code/timeout/diagnostic) | ✅ | `mkddc-st-validate`, `INTERFACES.md` |
| A2 | Compile interface (source → artifact + metadata + hash + version) | ✅ | `mkddc-st-compile` |
| A3 | Runtime control: stage/validate/activate/enable/disable/start/stop/rollback | ✅ | `st_control_api.hpp`, 9 action |
| A4 | Truy vấn active package / task / program state | ✅ | `program_status` |
| A5 | Truy vấn metrics, fault, alarm | ✅ | `program_status` |
| A6 | 11 trạng thái vòng đời đầy đủ | ✅ | `StProgramState` |
| A7 | Error contract: mã ổn định, line/column, retry được không, giữ package không | ✅ | `FW_SOM_ERROR_CODES.md` |
| A8 | Version compatibility công bố được | ✅ | `program_capabilities` |
| A9 | JSON schema chính thức | ✅ | `shared/st_program_control_v1.schema.json` |

## B. Công cụ và mẫu

| # | Hạng mục | Trạng thái | Bằng chứng |
|---|---|---|---|
| B1 | CLI chính thức validate/compile | ✅ | `mkddc-st-validate`, `mkddc-st-compile` |
| B2 | Sample ST hợp lệ | ✅ | `samples/ahu_fan_control.st` |
| B3 | Sample ST lỗi (4 loại, mã khác nhau) | ✅ | `samples/err_*.st` |
| B4 | Sample artifact | ✅ | `samples/ahu_fan_control.mkir` |
| B5 | JSON schema | ✅ | `shared/st_program_control_v1.schema.json` |
| B6 | Script integration test cho BE | ✅ | `samples/be_integration_test.sh` — **18/18 pass** |
| B7 | Danh sách error code | ✅ | `FW_SOM_ERROR_CODES.md` |
| B8 | File cấu hình Task mẫu | ✅ | `samples/program_tasks.example.conf` |
| B9 | I/O mapping mẫu | ✅ | `samples/io_map.example.json` |
| B10 | Lệnh build và chạy local | ✅ | `FW_SOM_BE_INTEGRATION_GUIDE.md` §Bắt đầu |
| B11 | Mock runtime / test harness | ⚠️ **thiếu** | Chưa có mock độc lập; BE dùng `mkddc-core` thật hoặc gọi trực tiếp `st_handle_control_request` |

## C. Chức năng runtime

| # | Hạng mục | Trạng thái |
|---|---|---|
| C1 | Nhận chương trình ST do BE gửi | ✅ |
| C2 | Kiểm tra, biên dịch, đóng gói thành Typed IR | ✅ |
| C3 | Nạp, kích hoạt, thực thi trong vòng điều khiển thật | ✅ |
| C4 | Task chạy đúng chu kỳ, có budget, xử lý overrun | ✅ |
| C5 | Chương trình lỗi **không** làm crash `mkddc-core` | ✅ |
| C6 | Chương trình mới lỗi **không** làm mất chương trình đang chạy | ✅ |
| C7 | Output qua priority arbitration + safe-state | ✅ |
| C8 | RETAIN + restart recovery | ✅ |
| C9 | Package integrity (SHA-256 + chữ ký) | ✅ |

## D. Gate kỹ thuật

| Gate | Trạng thái |
|---|---|
| `PARSER_SAFETY_GATE` | ✅ PASS |
| `BASELINE_DOC_SYNC` | ✅ PASS |
| `ARCHITECTURE_SPEC_GATE` | ✅ PASS |
| `TYPED_IR_GATE` | ✅ PASS |
| `ZERO_ALLOCATION_GATE` | ✅ PASS |
| `TASK_SAFETY_GATE` | ✅ PASS |
| `SCHEDULER_GATE` | ✅ PASS |
| `PACKAGE_SECURITY_GATE` | ✅ PASS |
| `WATCHDOG_GATE` | ⚠️ **một phần** — hành vi PASS, định lượng chờ RT |
| `PRODUCTION_RUNTIME_GATE` | ⚠️ **một phần** — code + test host xong, chờ `WATCHDOG_GATE` đủ |

## E. Chưa đạt — phải đóng trước khi ký nghiệm thu cuối

| # | Việc | Ai | Chặn cái gì |
|---|---|---|---|
| E1 | Rebuild kernel `CONFIG_RT_GROUP_SCHED=n`; cân nhắc bật `CONFIG_PREEMPT` | Platform/BSP | `WATCHDOG_GATE` định lượng |
| E2 | Gỡ drop-in `nofifo.conf` sau E1 | Platform | — |
| E3 | Xác nhận `SCHED_FIFO 80` thật trên target | QA | `V-05` |
| E4 | Đo lại jitter/WCET có RT, dưới tải | QA | `V-04` |
| E5 | Chốt lại `WatchdogSec` từ số đo mới | SOM Backend Lead | Thay giá trị tạm 6 s |
| E6 | ASan + UBSan thành CI job bắt buộc | FW SOM | Phase 7 |
| E7 | Fuzzing parser + artifact loader | FW SOM | Phase 7 |
| E8 | Soak 24 giờ | QA | Phase 7 |
| E9 | HIL với STM32 thật | QA | DEFERRED có ghi nhận |
| E10 | Mock runtime cho BE (B11) | FW SOM | Tiện lợi, không chặn |

## F. Chữ ký nghiệm thu

Ký khi **A, B, C đủ** và **E1–E8 đã đóng**. E9 là DEFERRED có ghi nhận, E10
không chặn.

| Vai trò | Tên | Ngày | Chữ ký | Ghi chú |
|---|---|---|---|---|
| PM kỹ thuật FW SOM | | | | |
| Architect | | | | |
| Đại diện BE SOM | | | | |
| QA | | | | |

## G. Kết luận hiện tại

**Chưa `FW_SOM_READY_FOR_BE_HANDOFF`.**

Toàn bộ phần **hợp đồng và chức năng** (A, B, C) đã xong và có bằng chứng —
BE **bắt đầu tích hợp được ngay**. Phần còn thiếu nằm ở **verification trên
phần cứng đúng cấu hình** (E1–E8), không phải ở chức năng.

Cụ thể: `mkddc-core` trên target đang chạy `SCHED_OTHER` thay vì `SCHED_FIFO`
do bất tương thích `CONFIG_RT_GROUP_SCHED` + cgroup v2, nên mọi số liệu thời
gian thực chưa đại diện cho production. Đây là việc của Platform/BSP, không
phải của FW SOM, nhưng nó chặn việc tuyên bố bàn giao.

Đề xuất: **bàn giao có điều kiện** — BE tích hợp song song với việc BSP xử lý
E1–E5, ký nghiệm thu cuối sau khi E1–E8 đóng.
