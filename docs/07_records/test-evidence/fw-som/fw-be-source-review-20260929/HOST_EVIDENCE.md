# Bằng chứng HOST — review hiệu năng source FW SOM / BE, 2026-09-29

**ID:** EVD-DDC-FW-BE-PERF-HOST-20260929

**Phiên bản:** 1.0

**Trạng thái:** In Review — bằng chứng HOST, không phải TARGET/HIL

**Ngày:** 2026-09-29

**Baseline:** `895444beba0760f18cf1bdc252e707e319a3c751`

**Worktree:** `/tmp/ddc-fw-be-review-20260929`

**Báo cáo:** [Hiện trạng hiệu năng FW SOM / BE](../../../reviews/DDC24_FW_SOM_BE_PERFORMANCE_SOURCE_REVIEW_2026-09-29.md)

## 1. Môi trường và kết quả

Go 1.26.4 linux/amd64, Intel Xeon E5-2680 v4 @2,40 GHz, affinity 28 CPU logic;
Linux 7.0.0-31-generic, glibc 2.39; GoogleTest 1.14.0. Không kiểm soát toàn bộ
tải host/tần số CPU. Source sản phẩm không sửa. Có một `app.test` do
`-cpuprofile` sinh trong worktree tạm; không đưa vào repository.

| Kiểm | Kết quả | Artifact |
|---|---|---|
| Go test bốn package, `-count=1` | PASS, exit 0; 54,058 / 4,563 / 79,048 / 0,079 s | [verification-results.json](verification-results.json) ghi stdout đã thu qua tool, không phải log từng test |
| Go vet cùng bốn package | PASS, exit 0, stdout rỗng | verification-results.json |
| Probe compiler production | 4/4 SKIP vì không có binary đúng profile trong worktree | [compiler-official.log](compiler-official.log) |
| PollLoopTiming dựng trực tiếp với allocation probe | PASS 14/14 | [poll-loop-tests.log](poll-loop-tests.log) |
| SPSC/triple buffer/thread policy dựng trực tiếp với allocation probe | PASS 10/10 | [rt-exchange-tests.log](rt-exchange-tests.log) |
| Historian không profile: 3 lượt, mỗi lượt 3 query | PASS; 1,121–1,152 s/query; 268.790.498–268.795.394 B/op; 1.893.483–1.893.494 allocs/op | [historian-benchmark-unprofiled.log](historian-benchmark-unprofiled.log) |
| Historian có profile: 3 lượt `benchtime=1s` | PASS; tách khỏi số dùng kết luận latency | [historian-benchmark.log](historian-benchmark.log) |
| Profile CPU và heap allocation | Dùng chọn hotspot; gồm setup/warmup, không thuần query | [historian-cpu-top.txt](historian-cpu-top.txt), [historian-alloc-top.txt](historian-alloc-top.txt) |
| Manifest source | 31 anchor chính + 16 liên quan, SHA/dòng/hash | [source-manifest.json](source-manifest.json) |

Không gán B/op thành RSS, peak memory hay lượng RAM giữ lại. Fixture trả 8 series
×2.880 sample tại resolution 30 s, đã warmup trước thời gian benchmark. Profile
toàn lệnh vẫn thu cả khâu tạo SQLite/archive fixture. CPU top có Mutex.Lock không
chứng minh mutex contention. Profile gốc còn trong
`/tmp/ddc-fw-be-review-evidence-20260929/historian.{cpu,heap}.pprof`; các bảng top
đã lưu vào repo, profile/binary tạm không phải artifact phát hành.

## 2. Lệnh thực tế

Trong `apps/web-api` của worktree review:

```bash
go test ./internal/app ./internal/programming/compiler \
  ./internal/programming/application ./internal/modbusrtu -count=1
go vet ./internal/app ./internal/programming/compiler \
  ./internal/programming/application ./internal/modbusrtu
go test ./internal/programming/compiler -run Official -count=1 -v
go test ./internal/app -run '^$' \
  -bench '^BenchmarkHistorianQueryEightSeries24hAuto$' \
  -benchmem -benchtime=1s -count=3 \
  -cpuprofile /tmp/ddc-fw-be-review-evidence-20260929/historian.cpu.pprof \
  -memprofile /tmp/ddc-fw-be-review-evidence-20260929/historian.heap.pprof
go test ./internal/app -run '^$' \
  -bench '^BenchmarkHistorianQueryEightSeries24hAuto$' \
  -benchmem -benchtime=3x -count=3
go tool pprof -top -nodecount=20 \
  /tmp/ddc-fw-be-review-evidence-20260929/historian.cpu.pprof
go tool pprof -top -alloc_space -nodecount=20 \
  /tmp/ddc-fw-be-review-evidence-20260929/historian.heap.pprof
```

Từ root worktree review:

```bash
g++ -std=c++17 -O2 -pthread \
  -I apps/iobus/application -I apps/iobus \
  apps/iobus/tests/test_poll_loop_timing.cpp \
  apps/iobus/tests/allocation_probe.cpp -lgtest -lgtest_main \
  -o /tmp/ddc-fw-be-review-evidence-20260929/poll-loop-tests
/tmp/ddc-fw-be-review-evidence-20260929/poll-loop-tests
g++ -std=c++17 -O2 -pthread \
  -I apps/core/application -I apps/core \
  apps/core/application/runtime/test_rt_exchange.cpp \
  apps/core/tests/allocation_probe.cpp -lgtest -lgtest_main \
  -o /tmp/ddc-fw-be-review-evidence-20260929/rt-exchange-tests
/tmp/ddc-fw-be-review-evidence-20260929/rt-exchange-tests
```

Đây là kiểm tập trung source có sẵn, không thay full CMake/CTest. Lần thử dựng
trực tiếp ban đầu thiếu include/link `allocation_probe`; đã thêm đúng source
và chạy lại thành công. Không sửa test hoặc source sản phẩm để lấy PASS.

## 3. Giới hạn và kiểm chứng tài liệu

- TARGET mới, aarch64 stress, HIL, soak và deploy: **NOT RUN**; phạm vi là review source/report.
- C++ full build/CTest, full Go/race và compiler production: **NOT RUN**; bốn test compiler thật SKIP đã ghi rõ, không dùng PASS package để claim compiler thật đã chạy.
- FE/browser: **NOT RUN**; không thay giao diện hoặc runtime FE, không thực hiện review UI. Bằng chứng UI của hồ sơ khác giữ nguyên.
- Authority pin không đổi; không chạy re-pin hoặc tự duyệt Detailed Design/release.

Kết quả kiểm link/hash/JSON, docs ISO và khoảng trắng được ghi ở bảng dưới sau
khi hoàn tất artifact. [checksums.sha256](checksums.sha256) bảo vệ các log,
manifest và kết quả đã lưu; không tự băm file checksum.

| Cổng tài liệu | Kết quả |
|---|---|
| Source anchor/hash và link nội bộ record/evidence | PASS — 47 anchor/file hash khớp commit; 31 nhãn source đầy đủ; link nội bộ tồn tại |
| JSON evidence | PASS — 2 file JSON parse được |
| `python3 scripts/docs_iso_harness.py --expect` | PASS — 503 file Markdown, EXPECT khớp; xem docs-harness.log |
| `git diff --check` | PASS — gồm kiểm file Markdown mới bằng diff no-index |

## 4. Revision history

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-09-29 | Lưu kiểm HOST mới, benchmark Historian, source manifest và giới hạn TARGET/production compiler |
