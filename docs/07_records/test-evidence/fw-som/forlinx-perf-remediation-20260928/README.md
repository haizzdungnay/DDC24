# Evidence Plan 63 — khắc phục hiệu năng Forlinx (Issue #809)

| Thuộc tính | Giá trị |
|---|---|
| Plan | [`PLAN-PERF-FORLINX-063`](../../../../03_implementation/63_FORLINX_PERFORMANCE_REMEDIATION_PLAN.md) §6 (giao thức đo), §7 (tracker) |
| Issue | [#809](https://github.com/Mekong-HCM/MK-DDC-24/issues/809) |
| Implementer-Run | `implementer-20260928T0536Z` |
| Script | [`scripts/forlinx_perf_probe.py`](../../../../../scripts/forlinx_perf_probe.py) v1.0 |
| Thư mục | mọi số đo trước/sau của Plan 63 nằm ở đây; mỗi lượt đo trên bo là một thư mục con có `summary.json` + `SHA256SUMS` |

## 1. Trạng thái theo mức bằng chứng

| Hạng mục | Mức | Kết quả | Ghi chú |
|---|---|---|---|
| Parser và phép tính của probe (`selftest`) | HOST | **PASS 34/34**, exit 0 | fixture đúng định dạng log `core.jitter`/`core.step_wcet`/`iobus.jitter`/access log tại `main@2e53d4a0` |
| Luồng `run` đầu–cuối với bo giả (HTTP giả + `sh -c` thay SSH) | HOST | exit 0; 2 lượt × 6 s; `/points` 30 GET (5/s), `/system/status` 6 GET (1/s); `journal_commands_in_window = 0` | chỉ kiểm đường ống, **không** phải số đo bo |
| Baseline 2 × 30 phút trên bo đang chạy | TARGET | **NOT_RUN** | điều kiện kỹ thuật ở §3 |
| Đóng `F-PRG-PERF-005` (missed release +0) | TARGET | **NOT_RUN** | cần baseline |
| Đóng `F-PRG-PERF-006` (period hiệu lực = khai báo) | TARGET | **NOT_RUN** | cần baseline |
| `seqlock_fail` của Core | TARGET | **NOT_RUN**, và binary Core tại `main@2e53d4a0` **không công bố** con số này | xem §4 |

## 2. Cách chạy (leader, sau khi có đường tới bo)

```bash
# Mật khẩu web chỉ qua biến môi trường, không ghi vào lệnh hay repo.
read -rs MKDDC_PROBE_PASSWORD; export MKDDC_PROBE_PASSWORD
python3 scripts/forlinx_perf_probe.py run \
  --ssh "ssh foxlinx" \
  --base-url http://<host bo>:8082 \
  --out docs/07_records/test-evidence/fw-som/forlinx-perf-remediation-20260928/baseline-t63-001 \
  --rounds 2 --duration 1800 --rest 300
# Tính lại summary từ dữ liệu thô (không cần bo):
python3 scripts/forlinx_perf_probe.py summarize --out <thư mục trên>
```

Điều kiện §6.1 phải giữ trong suốt lượt đo: một trình duyệt mở dashboard; không
`journalctl`/`grep` log/build trên bo trong cửa sổ (script tự từ chối lệnh
`journalctl` ở pha `window` và `commands.log` ghi pha của từng lệnh); Active
revision đọc ngay trước (`api-pre.json`) và sau (`api-post.json`), script
không đổi Program/output.

Đầu ra mỗi lượt (`round-N/`): `provenance.json` (PID, thời điểm khởi động,
sha256 `/proc/<MainPID>/exe` của 5 unit, sha256 `index.html`, nhiệt độ,
governor, tần số), `api-pre.json`/`api-post.json`, `proc-samples.txt` (5 s),
`load.json` (client p50/p95/max, mã HTTP), `journal-*.log` thu **sau** cửa sổ
bằng `--since/--until`. `summary.json` gom metric §6.3.

## 3. Điều kiện kỹ thuật còn thiếu để chạy mức TARGET

Kiểm từ container của phiên implementer (2026-09-28, UTC 05:36–06:10):

| Kiểm | Kết quả |
|---|---|
| `ssh` client | đã cài `openssh-client` 9.6p1 trong phiên |
| Key | đã tạo key riêng cho phiên (`claude-809@mkddc-foxlinx`); public key chờ thêm vào `/root/.ssh/authorized_keys` của bo |
| DNS `mekong-fac.ddns.net` | phân giải `101.99.36.34` |
| TCP `mekong-fac.ddns.net:2223` | **timeout** |
| TCP `192.168.1.16:22` | **timeout** (không cùng LAN) |
| TCP đối chứng `github.com:22` | **timeout** ⇒ container không cho kết nối TCP ra ngoài trực tiếp |

Để mở: cho phép kết nối TCP ra `mekong-fac.ddns.net:2223` (và `:8082` cho tải
HTTP) trong cấu hình mạng của môi trường chạy agent, hoặc chạy phần đo trên bo
từ một máy trong LAN của bo bằng đúng lệnh ở §2.

## 4. Finding trong phạm vi: `seqlock_fail` của Core không đọc được từ ngoài

`CoreMetrics::inc_seqlock_fail()` đếm ở
[`scan_loop.cpp:224`](../../../../../apps/core/application/runtime/scan_loop.cpp#L224)
nhưng không có log, API hay SHM nào công bố bộ đếm này (`core.jitter`,
`core.shutdown` và `/api/v1/programming/runtime` đều không có). Tiêu chí
"ghi `seqlock_fail` của Core" của T63-001 vì vậy không đo được trên binary đang
chạy. Việc công bố bộ đếm được giao cho T63-005 (cùng file log phút
`scan_loop.cpp`, thêm khoá `seqlock_fail=` vào dòng `core.jitter`); probe đã
đọc khoá đó (`CUMULATIVE_KEYS`) và báo `NOT_EXPOSED` khi vắng. Quyết định nhánh
Core của T63-102 lấy số từ lượt đo W0 có instrumentation.

## 5. T63-004 — log phút `iobus.loop_timing`

Một dòng mỗi phút, in chung lời gọi `fprintf` với `iobus.jitter` (dòng cũ giữ
nguyên khoá):

```text
INFO  iobus.loop_timing wake_late_max_us=.. work_max_us=.. io_resp_gap_max_us=.. late_events=.. catchup_iterations=.. iterations=.. io_resp_count=.. period_us=..
```

| Khoá | Nghĩa (cửa sổ một phút, µs làm tròn lên) | Probe gom |
|---|---|---|
| `wake_late_max_us` | độ trễ đánh thức, chỉ tính vòng thật sự đã ngủ | `max` |
| `work_max_us` | từ lúc thức tới ngay trước khi ngủ (GET_IO, output, reconnect) | `max` |
| `io_resp_gap_max_us` | khoảng giữa hai IO_RESP hợp lệ, tính cả khoảng đang mở | `max` |
| `late_events` | số **sự kiện** trễ (vòng xong ≥ mốc lưới kế tiếp, kéo dài tới vòng đầu kịp mốc) | `sum` |
| `catchup_iterations` | vòng bắt đầu không ngủ vì mốc đã qua | `sum` |
| `iterations`, `io_resp_count`, `period_us` | ngữ cảnh; `period_us` xác nhận chu kỳ hiệu lực | `sum`/`max` |

| Kiểm | Mức | Kết quả |
|---|---|---|
| 14 test đồng hồ giả `PollLoopTiming.*` | HOST | kẹt 16 ms trong phần làm việc ⇒ `late_events=1`, `catchup_iterations=24` (luật `overruns` cũ đếm 21); kẹt phía scheduler ⇒ `late_events=1`, `catchup_iterations=26`; 0 cấp phát trong 3 phút giả lập |
| `mkddc-iobus` + `fake_mcu` qua PTY, 2 phút | HOST (container không RT) | `iterations = io_resp_count = 30000`/phút; nền nhiễu ≈ 90–116 sự kiện/phút nên không dùng làm số đo nhịp |
| 30 phút trên bo, đầu vào G-D1 và T63-202 | TARGET | **NOT_RUN** — xem §3 |

## 6. T63-301 — cấu hình Programming tối đa ở 10 ms (`F-PRG-PERF-001`)

Script [`scripts/t63_301_max_config_repro.py`](../../../../../scripts/t63_301_max_config_repro.py).
Chế độ `host`: tự dựng backend Go production, `mkddc-st-compile`/`mkddc-st-package`
production và `mkddc-programming-core-sim` (scheduler/coordinator production,
không I/O) từ worktree ghim `8d41a5ab` (= `main@2e53d4a0` + T63-001, SHA trước khi
nhánh rebase lên `main@ed07861b`), build
Release trên container x86 4 lõi. Mỗi Program là chuỗi lệnh thẳng
`Acc := Acc + 1;` (ST Rev A cấm vòng lặp, nên instruction tĩnh = instruction thực
thi); compiler đếm 2 instruction/lệnh + 1, nên 2.047 lệnh = **4.095 instruction**
(`usage.instructions.used`; 2.048 lệnh bị `ST-POU-004`). Trước khi thử, script
seed một Active nền rồi **Restore đúng bản đó** sau khi thử.

| File | Package | Check | `budgetUs`/Program | Thực thi Task (µs) | Kết quả |
|---|---|---|---:|---|---|
| `t63-301-host/1x4095.json` | 1 × 4.095 @10 ms | PASSED, 0,54 s | 1.999 | 42,0 | trong ngân sách; Active khôi phục |
| `t63-301-host/2x4095.json` | 2 × 4.095 @10 ms | **FAILED `ST-WORKER-CRASH`**, 60,3 s | — | — | Check từ chối (lỗi kích thước, [#815](https://github.com/Mekong-HCM/MK-DDC-24/issues/815)) |
| `t63-301-host/16x4095-p10.json` | **16 × 4.095 @10 ms** | **FAILED `ST-WORKER-CRASH`**, 61,8 s | — | — | Check từ chối (#815) |
| `t63-301-host/16x401.json` | 16 × 401 @10 ms | **FAILED `ST-WORKER-CRASH`**, 61,0 s | — | — | Check từ chối (#815) |
| `t63-301-host/16x301-60s.json` | 16 × 301 @10 ms (lớn nhất còn qua) | PASSED, 0,63 s | **124** (`worstCaseStepUs` 1.984) | p50 50,8 · p95 63,4 · max 81,2 (60 s, 0 overrun) | trong ngân sách; Active khôi phục |

Đọc kết quả:

1. **Check không chấp nhận 16 × 4.095 ở `main@2e53d4a0`, nhưng không phải nhờ
   admission.** Kết quả Check (manifest có `sourceMap` ≈ 400 B/lệnh) bị trần 1 MiB
   ở `apps/web-api/internal/programming/store/checks.go:262`, nên mọi package trên
   ≈ 5.200 instruction tổng hỏng với mã sai `ST-WORKER-CRASH` sau khoảng 60 s. Đã
   mở finding [#815](https://github.com/Mekong-HCM/MK-DDC-24/issues/815)
   (`state:triage`), ngoài file ownership của Plan 63.
2. Nếu qua được Check, 16 Program nhận `budgetUs = (2.000 − 1)/16 = 124 µs` mỗi
   Program (đo ở 16 × 301).
3. Suy thời gian thực thi: host ≈ 42,0 µs/4.095 instruction ≈ 10,3 ns/instruction ⇒
   16 × 4.095 ≈ 673 µs trên host này. Target 04/09 (bo khi đó bị xâm nhập) đo trung
   bình 2.002–2.050 µs ≈ 30,6–31,3 ns/instruction ⇒ vượt 1.999 µs của Task
   `main`, và theo `OD-PROG-012` Task `FAULTED` sau 3 overrun liên tiếp (≈ 30 ms).
   Cấu hình lớn nhất còn qua Check hôm nay (4.816 instruction) ước ≈ 150 µs trên
   target, nên chưa thể làm Task FAULT. Kịch bản rủi ro sẽ mở lại ngay khi #815
   được sửa. Việc sửa #815 phải xếp sau hoặc cùng quyết định G-D2.
4. Core-sim host cố định Task 1.000 ms / budget 199.000 µs
   (`programming_core_sim_main.cpp:124-129`); Task chạy 1 lần/s (runCount +60 trong
   59,7 s). Vì vậy thời điểm chuyển `FAULTED` **không** tái hiện được trên host.

| Hạng mục T63-301 | Mức | Trạng thái |
|---|---|---|
| Check chấp nhận hay không, `budgetUs` từng Program | HOST | Đã đo (bảng trên) |
| Thời gian thực thi Task so với 2.000 µs, thời điểm `FAULTED` | HOST | Đã đo thực thi; FAULT không tái hiện được trên core-sim (lý do ở mục 4) |
| Như trên | TARGET | **NOT_RUN** — cần đường tới bo (§3), và cần #815 được sửa mới Check được 16 × 4.095 |
| Đọc Active trước, Restore sau | HOST | Restore `SUCCEEDED`, `activeBefore == activeAfter` (`activeRestored: true`) |

## 7. T63-110 — nguồn ghi eMMC 24 giờ (`PERF-SYS-06`)

Lệnh `emmc` của probe (chỉ đọc) làm các việc sau:

- Ghi định danh chip: `/sys/block/mmcblk0/device/{name,manfid,oemid,date,rev,fwrev,life_time,pre_eol_info}`.
- Ghi bảng mount của eMMC, trạng thái journald (có `/var/log/journal` hay không, `journald.conf`) và `journalctl --disk-usage`. Hai lệnh cuối chạy **trước và sau** cửa sổ, không chạy trong cửa sổ.
- Trong suốt cửa sổ, cứ 60 s lấy một mẫu `/proc/diskstats` và `write_bytes` của **mọi** tiến trình qua `/proc/<pid>/io`.
- Luồng SSH đứt thì tự nối lại và ghi khoảng hở vào `commands.log`.

Nguồn ghi được chia theo `comm`:

| Nguồn | `comm` |
|---|---|
| journald | `systemd-journal` |
| web (SQLite Programming/historian) | `mkddc-web` |
| core (snapshot) | `mkddc-core` |
| iobus | `mkddc-iobus` |
| hệ thống file | `jbd2`, `kworker` |

Phần còn lại ghi là "khác". Hiệu giữa tổng thiết bị và tổng đã quy nguồn ghi là `unattributed_bytes_per_s`. Phần này gồm tiến trình sống ngắn hơn một khoảng lấy mẫu và phần khuếch đại ghi của hệ thống file.

```bash
python3 scripts/forlinx_perf_probe.py emmc --ssh "ssh foxlinx" \
  --out docs/07_records/test-evidence/fw-som/forlinx-perf-remediation-20260928/emmc-t63-110 \
  --duration 86400 --interval 60
# Sau khi tra datasheet chip theo emmc-identity.txt (tên/manfid):
python3 scripts/forlinx_perf_probe.py summarize-emmc \
  --out <thư mục trên> --endurance-tbw <TB theo datasheet>
```

| Hạng mục T63-110 | Mức | Trạng thái |
|---|---|---|
| Parser, chia nguồn, ngoại suy GB/ngày và TB/năm, số năm tới TBW, giải mã `life_time` (JEDEC) | HOST | `selftest` PASS (13 kiểm eMMC) |
| Chạy đầu–cuối với bo giả (`sh -c` trên `/proc` của host, 4 s) | HOST | exit 0; 3 mẫu; không có lệnh journal trong pha `window` |
| Đo 24 giờ, bảng nguồn ghi theo B/s | TARGET | **NOT_RUN** — cần đường tới bo (§3) và một cửa sổ 24 giờ không deploy |
| Đối chiếu độ bền ghi theo datasheet, ước tuổi thọ trước/sau W1 | TARGET | **NOT_RUN** — cần định danh chip đọc từ bo; đo lại sau T63-105/106/107 để có số "sau W1" |
| Đề xuất retention journald | — | Chờ số đo. Plan 63 không đổi journald khi chưa có bảng nguồn ghi |

## 8. T63-005 — histogram lệch đánh thức Core và `seqlock_fail`

Hai dòng in trong cùng một lời gọi `fprintf` mỗi phút:

```text
INFO  core.jitter … missed_steps=.. base_step_us=10000 seqlock_fail=<tích luỹ>
INFO  core.wake_hist le25=.. le50=.. le100=.. le200=.. le500=.. gt500=.. base_step_us=10000
```

- Các ô histogram **rời nhau** và tính **theo phút**. Biên trên được tính vào ô và so theo ns, cùng phép so với C4.
- Tổng 6 ô bằng `count` của phút đó. `le200 + le500 + gt500` bằng số vi phạm C4 (> 100 µs) trong phút.
- Probe cộng các ô bằng `sum`. Riêng `seqlock_fail` là bộ đếm tích luỹ, probe lấy `delta`.

| Kiểm | Mức | Kết quả |
|---|---|---|
| 4 test `T63_005_*` | HOST | biên ô đúng từng ns; tổng = `count`, ba ô trên = `violations`; 0 cấp phát trong 20.000 base step; `ScanLoop::run` thật in `seqlock_fail=4` và `wake_hist` |
| Stack thật `fake_mcu` + `mkddc-iobus` + `mkddc-core`, 80 s | HOST (`rt.degraded`: container không cho mlock) | `count=5995`, histogram `1054/2664/1508/550/159/60`, tổng = 5995; `550+159+60 = 769 = violations`. Số chỉ để kiểm công thức, không phải số đo nhịp |
| Overhead | HOST | `on_wake+advance` thêm ≈ 2 ns mỗi base step; `step()` không đổi. `mkddc-core-scan-bench --offload` p50 total 25,6–28,2 → 26,9–28,3 µs, nằm trong nhiễu |
| Đo sạch 2 × 30 phút trên bo: có còn vi phạm > 100 µs ⇒ T63-204 `N/A` hay mở G-D4; delta `seqlock_fail` ⇒ nhánh Core của T63-102 | TARGET | **NOT_RUN** — xem §3 |

## 9. T63-102 — nhánh Core chờ số đo `seqlock_fail`

Plan 63 AC T63-102: Core chỉ áp retry giới hạn ≤ 20 µs khi T63-001 đo được
`seqlock_fail` **> 0** trên bo; nếu **= 0** thì giữ nguyên mã. Số trên bo chưa
có (TARGET NOT_RUN), nên commit T63-102 **giữ nguyên** retry Core và chỉ nới bộ
đếm lên 64 bit. Phương án cho nhánh "> 0" được lưu ở đây để áp khi có số:

| File | Nội dung |
|---|---|
| `t63-102/T63-102-core-retry-20us.patch` | `apps/core/adapters/ipc/iobus_reader.{hpp,cpp}` + test: quay tới khi đọc được hoặc hết 20 µs (chỉ lệnh relax CPU, không `sched_yield`/ngủ vì luồng FIFO80 ở CPU riêng), đồng hồ chỉ đọc khi lần thử đầu trượt, fence acquire trước lần đọc seq thứ hai, `SeqlockReadStats`; fail-safe giữ nguyên (dùng snapshot cũ + `inc_seqlock_fail`). HOST khi áp tạm: build 0, 66/66 test nhóm reader/scan, `--gtest_repeat=200` 0 đỏ |

Cách dùng: `git apply docs/07_records/test-evidence/fw-som/forlinx-perf-remediation-20260928/t63-102/T63-102-core-retry-20us.patch`
chỉ khi delta `core.jitter seqlock_fail` trong 2 × 30 phút đo sạch > 0; sau đó
đo lại (delta phải về 0, `core.step_wcet io_us` tăng ≤ ≈ 20 µs ở phút xấu
nhất, không có `core.base_step_missed` mới).

## 10. T63-108 — nguồn polling của FE và ETag/304 (`PERF-API-03`)

Thư mục `t63-108-host/`. Mức **HOST**: Playwright + Chromium 1194, `mkddc-web`
build từ cây làm việc, **một tab Dashboard**. Thành phần giả: `/points` trả qua
`route`, WebSocket giả bằng `routeWebSocket` đẩy mỗi 200 ms, Core giả
`fake_core.py` (chỉ `alarm_list`). Mọi request khác tới `mkddc-web` thật.
Playwright tắt cache HTTP khi có `route`, nên 304 đo riêng bằng `measure_304.mjs`
(không `route`).

| Kiểm | File | Trước (`main@265f1a8b`) | Sau |
|---|---|---|---|
| 30 phút, có WS | `m30-{BEFORE,AFTER}-ws.json` | 6.180 GET = 3,433 GET/s | 2.280 GET = 1,267 GET/s (**−63,1 %**) |
| Tuổi giá trị đang hiển thị p50/p95/max | cùng file | 77 / 189 / 445 ms | 102 / 191 / 327 ms |
| 60 s, không WS | `m-{BEFORE,AFTER}-poll.json` | 206 GET | 100 GET (−51,5 %) |
| Tab ẩn | `m30-*.json` → `hidden` | 3,445 GET/s | 0 GET/s |
| `/alarms` trên trang Cảnh báo, trình duyệt thật | `m304-*.json` | 60 × 200 trong 40 s | 20/20 × 304 kèm `If-None-Match` |
| CPU server `/alarms`, lịch sử 20.000 sự kiện, Core đọc được | `bench-alarms.json` | 197,9 ms/lượt | 0,5 ms/lượt |
| Chuông shell sau khi chuyển sang `overview.alarms.activeOrUnacked` | `bell-parity.json` | 2 (poll `/alarms`) | 2 (`total` = 3) |
| Bản cuối, 60 s | `m-BELL-{ws,poll}.json` | — | 76 GET (có WS) / 100 GET (không WS) |
| Kiểm đỏ (đột biến phải làm test đỏ) | `red-results-all.json`, `red-results-bell.json` | — | 28/28 đỏ, bản khôi phục xanh |

Lượt đo 30 phút chạy trên bản chuông đọc `total`. Bản cuối đọc `activeOrUnacked`
và chỉ đo lại 60 s (`m-BELL-*`); số GET theo route giống hệt.

Chạy lại: `MKDDC_WEB_PASSWORD=… node measure_polling2.mjs <url> <nhãn> <out.json>
<giây> <giây-ẩn> {ws|poll|board}`. Script chỉ lấy credential từ `MKDDC_WEB_USER`
và `MKDDC_WEB_PASSWORD`. Đường dẫn tuyệt đối trong script là của container đã
chạy đo. Chế độ `board` không giả gì, cache bật; tuổi giá trị đọc từ ô ghim nên
máy đo và bo phải cùng NTP.

Trên bo **NOT_RUN** (§3): GET/s 1 tab 30 phút trước/sau, tuổi giá trị, CPU
`mkddc-web`, 304 qua HTTPS thật, và phân rã khoảng 5,2 request/s theo route.

## 11. T63-304 — cache compile và pool ≤ 2 (`F-PRG-PERF-004`)

Thư mục `t63-304-host/`. Mức **HOST** (x86_64, 4 lõi). Số thời gian Check dùng
compiler giả (chính test binary) ngủ cố định mỗi Program, vì
`mkddc-st-compile` trong `build/fw` lúc Lane WEB đo mang profile cũ và runner
từ chối output. Mức ngủ 32 ms lấy từ phép đo compiler thật chạy trực tiếp
(`real-compiler-direct.json`: Program 1.604 lệnh p50 32,4 ms; Program nhỏ
3,62 ms; n = 30).

| Kiểm (32 Program) | Compiler giả 1 ms | 32 ms | 100 ms |
|---|---|---|---|
| Tuần tự, không cache (hành vi cũ) | 258 ms | 1.275 ms | 3.453 ms |
| Song song 2, lần đầu | 128 ms | 636 ms | 1.732 ms |
| Lặp cùng đầu vào (0 process mới) | 288 µs | 227 µs | 325 µs |
| Sửa 1/32 Program (1 process mới) | 8 ms | 39 ms | 108 ms |

- 8 request song song trên cùng runner: tối đa **2** process đồng thời, đọc từ
  nhật ký start/end của chính process.
- Process compiler chạy **nice 10**, đọc `/proc/self/stat` bên trong process.
- Kiểm đỏ 17/17 (`red-results-all.json`, `red_t304.py`).
- `measure_t304_test.go.txt` là test đo, đổi đuôi để không lẫn vào mã Go của
  repo. Chạy lại bằng cách chép vào `apps/web-api/internal/programming/compiler/`
  rồi chạy `MKDDC_T304_MEASURE=1 MKDDC_T304_SLEEP_MS=32 go test -run TestMeasureT304 -v`.
  Kết quả lưu ở `measure-t304.txt`.

**Đo lại bằng compiler thật (leader, sau khi dựng lại `build/fw` đúng profile).**
Chạy qua `ProcessRunner` với 32 Program × 1.603 instruction, median của 5 vòng
(`measure_t304_real_test.go.txt`):

| | Tuần tự, không cache | Song song 2, lần đầu | Lặp lại | Sửa 1 Program |
|---|---|---|---|---|
| Bản Lane WEB bàn giao (`real-compiler-before-fix.txt`) | 2.139 ms | 1.045 ms | **986 ms, 0 hit** | 976 ms |
| Sau bản sửa nén manifest (`real-compiler-after-fix.txt`) | 2.108 ms | 1.099 ms | **24 ms** | 73,5 ms |

Nguyên nhân 0 hit (`result-sizes.json`):
- Manifest build chiếm phần lớn một kết quả, khoảng 180 B/instruction: 740 KB cho Program 4.095 instruction, trong khi artifact chỉ 99 KB.
- Với manifest thô, trần 8 MiB chỉ giữ được khoảng 25 Program 1.603 instruction.
- Check 32 Program duyệt tuần tự qua LRU nhỏ hơn tập làm việc, nên không trúng lần nào. Compiler giả trả kết quả nhỏ nên che mất lỗi này.

Bản sửa:
- Cache lưu manifest nén gzip (nén được khoảng 22 lần) kèm SHA-256 bản thô; lúc đọc thì giải nén và kiểm lại.
- Dự án lớn nhất của profile (32 × 4.095 instruction) chiếm khoảng 4,3 MB, vừa trần.
- Hai test khoá lỗi, đỏ khi tính dung lượng theo manifest thô: `TestCompileCacheHoldsLargestProfileProjectWithCompressedManifest` và `TestProcessRunnerWithOfficialCompilerCachesWholeProjectRepeat` (compiler thật).

Trên bo **NOT_RUN** (§3):
- thời gian Check 32 Program lần đầu, lần lặp và sau khi sửa 1 Program (`startedAt`/`completedAt` của Check);
- jitter Core C4 và chu kỳ IOBus trong lúc Check, so với baseline T63-001;
- `ps -o pid,ni,psr,comm -C mkddc-st-compile`: cần thấy `ni=10`, `psr` thuộc 0–2;
- RSS của `mkddc-web` sau nhiều lượt Check.

## 12. SHA-256

Xem `SHA256SUMS` trong từng thư mục đo. Script tại commit T63-001: xem
`git log -- scripts/forlinx_perf_probe.py`; `summary.json` ghi `probe_sha256`
của bản script đã chạy.
