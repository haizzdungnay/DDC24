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

## 6. SHA-256

Xem `SHA256SUMS` trong từng thư mục đo. Script tại commit T63-001: xem
`git log -- scripts/forlinx_perf_probe.py`; `summary.json` ghi `probe_sha256`
của bản script đã chạy.
