# Bằng chứng TSan — Enable/Disable qua safe boundary và read-back Published Signal

| Thuộc tính | Giá trị |
|---|---|
| Ngày | 2026-08-24 |
| Nhánh | `feat/plan59-pou-signal-atomic` |
| Phạm vi | `F-P59-ENABLE-BOUNDARY-001`, `F-P59-SIGNAL-READBACK-001` |
| Máy đo | host x86_64, GCC 13, 28 core |
| Build | `cmake --fresh -S . -B build/plan59-tsan -DCMAKE_BUILD_TYPE=RelWithDebInfo -DMKDDC_SANITIZE=thread -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON -DCMAKE_CROSSCOMPILING_EMULATOR="/usr/bin/setarch;x86_64;-R"` |

## 0. Vì sao cần `setarch -R`

Kernel của máy dev cấp entropy `mmap` lớn hơn vùng shadow của ThreadSanitizer
chịu được, nên binary chết ngay khi khởi động với
`FATAL: ThreadSanitizer: unexpected memory mapping`. Chạy qua
`setarch x86_64 -R` (tắt ASLR) là cách không cần quyền root; khai
`CMAKE_CROSSCOMPILING_EMULATOR` để chính bước `gtest_discover_tests` của CMake
cũng đi qua nó, nếu không CMake xoá luôn binary vừa link.

## 1. F-P59-ENABLE-BOUNDARY-001 — đo TRƯỚC khi sửa

Test tái hiện: `ProgrammingStageAtomicity.EnableIntentAppliesAtSafeBoundaryWhileScanRuns`
(dựng đúng mô hình luồng production: một luồng scan tick + boundary, luồng còn
lại gửi Disable/Enable như IPC worker).

```
ThreadSanitizer: reported 3 warnings
```

| # | Ghi | Đọc/ghi đối ứng | Trường |
|---|---|---|---|
| 1 | `StScheduler::stop` — `st_scheduler.cpp:622` (luồng IPC) | `StScheduler::run_task` — `st_scheduler.cpp:927` (luồng scan) | `StProgramInstance::state` |
| 2 | `StScheduler::disable` — `st_scheduler.cpp:643` (luồng IPC) | `StScheduler::run_task` — `st_scheduler.cpp:921` (luồng scan) | `StProgramInstance::state` |
| 3 | `StScheduler::start` — `st_scheduler.cpp:593` đọc vòng đếm trần 16 (luồng IPC) | `StScheduler::run_program` — `st_scheduler.cpp:876` ghi khi Program fault (luồng scan) | `StProgramInstance::state` |

Cả ba đều đi qua `ProgrammingRuntimeCoordinator::set_program_enabled`, tức là
đúng đường mà `SET_PROGRAM_ENABLED` chạy trên bo: `apps/core/bootstrap/main.cpp`
dựng `programming_ipc_thread` riêng, còn scan loop chạy `SCHED_FIFO 80`.

Hệ quả thật (không chỉ là cảnh báo công cụ): một lệnh Disable rơi đúng giữa tick
có thể bị chính RT ghi đè trạng thái ngay sau đó, và Program đã bị người vận
hành tắt vẫn chạy thêm một chu kỳ với quyền ghi đầu ra.

## 2. Bản sửa

Enable/Disable đi cùng con đường với RETAIN reset: non-RT chỉ ARM
(`StScheduler::request_program_enabled`), RT áp dụng tại safe boundary
(`apply_pending_enable_requests_at_boundary`, gọi trong
`ProgrammingRuntimeCoordinator::on_safe_boundary`), rồi trả kết quả qua
`enable_ack_generation`/`enable_ack_result`/`enable_ack_state`. Coordinator chờ
có giới hạn 1500 ms (một base step 1 s + biên) rồi trả `APPLIED`/`REJECTED`/
`TIMED_OUT`; `TIMED_OUT` map sang `Busy` ở IPC để BE gọi lại được thay vì hiểu
nhầm là đã từ chối.

Sửa kèm trong cùng bản: trần 16 Program được kiểm TRƯỚC khi chạm bất kỳ trường
nào. Đường cũ enable xong mới phát hiện vượt trần và để lại Program ở
`STOPPED`/`enabled=true` — một lệnh bị từ chối vẫn kịp đổi trạng thái nửa vời.

## 3. F-P59-SIGNAL-READBACK-001 — phát hiện trong cùng vòng race-check

`program_ipc_server.cpp:659` gọi `signal_bus()->inspect_all()` TRÊN IPC worker
thread trong khi scan RT publish/commit. Double-buffer chỉ bảo đảm "trọn bản cũ
hoặc trọn bản mới" cho reader chạy trong cùng chu kỳ với publisher: reader non-RT
có thể còn đang chép bản `live` khi scan commit — bản đó thành nháp và
`publish()` của chu kỳ kế ghi đè ngay lên nó.

Đo bằng test mới `StSignalBus.ConcurrentInspectNeverPairsValueWithForeignTimestamp`
(publish `value = round * unit` cùng `published_at_ns = round`, nên một cặp lệch
chu kỳ lộ ra ngay). Trên bản CHƯA sửa: **1/3 lần chạy** báo `mismatched = 1`.
Sau khi thêm kiểm tra `generation` trước/sau khi chép (`StSignalBus::snapshot_slot`,
cùng khuôn seqlock với `IobusReader::read_from`): 0 mismatch.

Ghi rõ giới hạn: test này là guard XÁC SUẤT ở bản build thường. Bộ bắt lỗi tất
định cho đường này là chạy nó dưới TSan. Nâng số vòng KHÔNG siết thêm được —
400 000 vòng làm reader/writer giành nhau `bank_readers_` tới mức test chạy quá
20 phút CPU mà vẫn không tất định.

## 4. Đo SAU khi sửa — toàn bộ core suite

```
TSAN_OPTIONS="halt_on_error=0 suppressions=$PWD/platform/tsan/suppressions.txt" \
  setarch x86_64 -R ./build/plan59-tsan/core/core_tests
→ WARNING: ThreadSanitizer  : 0
→ [  PASSED  ] 897 tests
→ [  FAILED  ] 2 tests (StCompileCli.*)
```

Hai test `StCompileCli` đỏ **không phải lỗi sản phẩm**: worker compiler tự đặt
`RLIMIT_AS = 256 MB` (`st_compile_main.cpp:780`) như một biện pháp sandbox, còn
shadow memory của TSan cần nhiều hơn thế, nên tiến trình con chết với
`ThreadSanitizer: internal allocator is out of memory`. Cả hai PASS ở build
thường. Không hạ trần sandbox để làm xanh TSan — đó là đổi một biện pháp an ninh
thật lấy một con số đẹp.

`platform/tsan/suppressions.txt` chỉ chứa hai mẫu seqlock CỐ Ý (`IobusReader::read_from`
và `StSignalBus::publish`), mỗi mẫu đều có test hành vi riêng chứng minh không
đọc rách. Mọi cảnh báo ngoài hai mẫu đó phải coi là lỗi thật.
