# Release Record DDC-24 — bản ứng viên `main@f86150e3`, ngày 2026-09-27

| Thuộc tính | Giá trị |
|---|---|
| ID | `DDC24-RELEASE-RECORD-2026-09-27` |
| Phiên bản | 1.0 |
| Trạng thái | **Draft — chờ Release Owner ký** |
| Thay cho | [`PROG-RELEASE-RECORD-2026-08-23`](PROGRAMMING_RELEASE_RECORD_2026-08-23.md) (verdict `NO-GO`, RC `main@29c59ec`). Bản ghi cũ giữ nguyên, không sửa verdict tại chỗ |
| RC commit | `main@f86150e3` (PR #791). Lịch sử: ứng viên `4b833b38` có 4 cổng W7 đỏ → sửa ở PR #787 (mã) và #788 (authority) → `910bea95` còn 1 cổng đỏ → kiểm trên bo lộ thêm lỗi ETag của Virtual Point → sửa ở PR #791 (mục 4) |
| Số phiên bản | Build mang `0.1.0` (`MKDDC_VERSION` mặc định). Số phát hành do Release Owner đặt khi ký (mục 8) |
| Khoá ký | Khoá hãng `vendor-mekong-kinexus-v1`, fingerprint `2fb77aa42e7fe446`, nhúng vào Core (`st_public_key mode=RELEASE`). Dạng file, **chưa vào HSM** |
| Bo tham chiếu | Foxlinx lab `OK1126B-buildroot` (RV1126B, Buildroot, fake MCU), `mekong-fac.ddns.net` |
| Người đọc | Nội bộ: Release Owner, PM, lead kỹ thuật |
| Người soạn | Phiên AI (Claude Code): tổng hợp số đo, không ký |
| **Verdict đề xuất** | **`NO-GO` cho phát hành hiện trường** — mục 7 |

## 1. Phạm vi

Bản ghi tổng hợp mọi thay đổi từ RC 2026-08-23 tới `main@f86150e3`: **408 entry** CHANGELOG `[Unreleased]` ghi ngày từ 2026-08-24 (166 Fixed, 92 Added, 49 Changed, 43 PGM-02, còn lại là Governance, Deploy, Security, Verified…). Mục 3 gom theo mạch công việc; chi tiết từng thay đổi ở [`CHANGELOG.md`](../../CHANGELOG.md).

Người đọc là nội bộ. Bản ghi này không phải tài liệu bàn giao cho khách hàng: checklist bàn giao [`15_RELEASE_HANDOVER_CHECKLIST.md`](../03_implementation/15_RELEASE_HANDOVER_CHECKLIST.md) vẫn ở trạng thái Draft, và phần lớn mục chức năng của nó cần I/O vật lý.

## 2. Bản ứng viên trên bo tham chiếu

Cài sạch 2026-09-27 05:02Z ([`EV-FWSOM-FOXLINX-FACTORY-20260927`](test-evidence/fw-som/2026-09-27-foxlinx-factory-reset.md)), rồi nâng cấp bằng `install.sh` lên `main@f86150e3` lúc 09:04Z (snapshot rollback `0.1.0-20260927-090457`; secret JWT và khoá thiết bị giữ nguyên; các snapshot trung gian trong ngày đã dọn).

| Binary | sha256 (16 ký tự đầu), khớp `/proc/MainPID/exe` |
|---|---|
| `/usr/sbin/mkddc-core` | `9621cb52fea6f0fe` |
| `/usr/sbin/mkddc-iobus` | `96a0feea1d95bafb` |
| `/usr/sbin/mkddc-netcfg` | `013beaaf15b9081c` |
| `/usr/sbin/mkddc-st-compile` | `cdda7f5f4a686df7` |
| `/usr/sbin/mkddc-st-package` | `912a821878f0e1ba` |
| `/opt/mkddc-web/mkddc-web` (web, reload-helper, time-helper) | `0ba384e1709ea501` |
| `/opt/mkddc-web/mkddc-schedule-sim` | `7fa97b6695fcfff7` |
| `/opt/mkddc-web/mkddc-programming-sim-worker` | `2390cba62223074c` |

- `provenance.json`: `git_commit=f86150e3…`, `dirty=false`, `st_public_key_mode=RELEASE`.
- Mọi unit `NRestarts=0`. Health 6/6 `ok`. Programming `READY`, tập chu kỳ ADR-061 {10…50000} ms.
- Modbus `rs485-1`: 4/4 thiết bị online, 48 điểm `GOOD`.
- RT: `rt.ok SCHED_FIFO 80`, `rt.cpufreq_ok performance`, `rt.cpu_idle_ok`.
- Cấu hình riêng của bo lab: drop-in `nomcu.conf` (fake MCU + Modbus RS-485 #1) và `port.conf` (web cổng 8082).

## 3. Thay đổi chính từ 2026-08-23

| Mạch công việc | Kết quả chính | Bằng chứng |
|---|---|---|
| Chu kỳ bộ điều khiển 10 ms (ADR-061) | Base step 10 ms, 8 lớp chu kỳ {10…50000} ms, tiêu chí C1–C4 (overrun 0, missed 0, jitter ≤ 100 µs). Nền RT tạm trên kernel non-RT: CPU3 riêng, PM QoS, `system.conf.d`, `rt-housekeeping`, governor `performance` (F11, F14–F17). IPC web ra khỏi luồng quét (X19): WCET 959–1307 → 338–540 µs | [`EV-PROG-FBD-ST-MB-20260925`](test-evidence/programming/2026-09-25-fbd-st-modbus-do-audit.md) |
| Vòng đời Programming | Intent Enable đi cùng ACTIVATE, khoảng `no_ctrl` khi Restore từ 70 ms còn 0 (F13, ADR-062). Trace theo lô, 5 000 mẫu 10 ms đều (F18). Đổi gói rút output của gói cũ, bàn giao điểm chung không glitch (F20). Graph không phải producer không chi phối safe-state/EXT (F21/F22). Trang Program theo chủ Active (F23) | Như trên |
| Modbus RTU | Audit FE/BE/FW SOM 2026-09-25: 10 lỗi đường ghi, lập lịch, đồng thời, chẩn đoán. `ext_cmd_seq` chống mất lệnh (MBA-FW-08). Đánh thức theo sự kiện, Core → FC05 khoảng 3 ms (G7). Disable/đổi gói đưa DO Modbus về `safe_value` ≤ 1,2 s (F06/F20) | [`MODBUS_AUDIT_2026-09-25_FINDINGS_GAP_SOLUTIONS`](reviews/MODBUS_AUDIT_2026-09-25_FINDINGS_GAP_SOLUTIONS.md); như trên |
| Workspace ST/FBD (PGM-02) và thư viện | R1 EDIT, R2 LIVE, R3 SIMULATE; refactor FE (PR #704); Control Library (PGM-04, Plan 61); FBD Reference Connector; bản đồ mã ST | VVP `U13`–`U15`; CHANGELOG |
| Web/FE khác | Historian, alarm IPC, cấu hình mạng, hiển thị đúng phạm vi safe-state, cổng FE trên `main` xanh lại (#762/#765) | CHANGELOG |
| Bảo mật và cài đặt | Sự cố xâm nhập bo lab (SSH mật khẩu yếu, 2026-09-22), đã ngăn chặn, SSH chỉ nhận khoá. Cài sạch như xuất xưởng, giữ Modbus. `JWT_SECRET` đủ 32 byte và web từ chối secret ngắn (F-FR-04). iobus tự ghi pidfile (F-FR-01). Runbook cross-build buộc khoá phát hành (F-FR-03). `install.sh` cài đủ hai unit helper (PR #701) | [`SEC-INC-20260926-FOXLINX`](security/2026-09-26-foxlinx-ssh-intrusion.md); [`EV-FWSOM-FOXLINX-FACTORY-20260927`](test-evidence/fw-som/2026-09-27-foxlinx-factory-reset.md) |
| Quy trình | Quy trình clean code/clean docs ba vai (`WF-CLEAN-001`); CTO chốt 8/11 quyết định BACnet Rev A | CHANGELOG |
| Tổng hợp release (2026-09-27) | W7 trên ứng viên đầu `4b833b38` ra 4 cổng đỏ. Đã sửa: (a) trình soạn Virtual Point có Tag và Label rộng **0 px** ở màn 1280 px (lỗi hiển thị có từ ≥ 2026-09-04), (b) spec `gate369` lọt vào hai lane e2e, (c) `build-release.sh` nhận cache cross-build (PR #787); (d) authority lệch từ 2026-09-09 và mâu thuẫn Product/SRS với ADR-061/062: Product v3.3, SRS v1.3, manifest v1.65 (PR #788); (e) phản hồi ghi Virtual Point không mang ETag mới nên lần ghi thứ hai trong cùng phiên bị 412 (PR #791, lộ ra khi kiểm (a) trên bo) | CHANGELOG; Issue #786, #789, #790 |

## 4. Cổng W7 — `scripts/verify-project.sh --wave W7`

Chạy đầy đủ trên `main@910bea95`, trong worktree sạch (không dùng chung build dir với cross-build). RC cuối `f86150e3` chỉ đổi web-api so với `910bea95` (PR #791: ETag của phản hồi ghi VP), nên các cổng bị ảnh hưởng được chạy lại trên chính `f86150e3` (cột cuối).

| Cổng | Mức | `910bea95` | Thời gian | Chạy lại trên `f86150e3` |
|---|---|---|---|---|
| `layout` | HOST | PASS | 5,6 s | PASS (6 s) |
| `cpp` | HOST | PASS | 300,6 s | — (C++ không đổi) |
| `go` | HOST | PASS | 85,2 s | PASS (84 s) |
| `frontend` | HOST | PASS | 86,3 s | — (FE không đổi) |
| `e2e` | HOST | PASS — 195 passed / 0 failed | 169,3 s | PASS — 195/0 (167 s) ở lần chạy lại. Lần đầu 193/2: `trends` và PGM-01 bàn phím (mobile) hết giờ 1 phút khi máy đang bận; chạy riêng mỗi ca đạt 2/2 |
| `e2e-real` | HOST | **FAIL** — 8 passed / 2 failed: T59-505 (Issue #786), ISS-PGM03-08 (Issue #790) | 212,2 s | **FAIL** — 8/2, đúng hai ca như cột trước (142 s) |
| `firmware` | HOST | PASS | 0,3 s | — |
| `release-package` | HOST | PASS | 174,0 s | — (gói không đổi quy trình) |
| `docs` | HOST | PASS | 0,6 s | PASS |
| `candidate-pin` | HOST | PASS — 17/17 | 0,0 s | PASS — 17/17 |
| `github-ci` | CI | **NOT_RUN** | — | — |
| `target-soak` | TARGET | **NOT_RUN** (cổng tự động; bằng chứng tay ở mục 5) | — | — |
| `physical-io` | HIL | **NOT_RUN** | — | — |
| `power-retain` | TARGET | **NOT_RUN** | — | — |

**`910bea95`: 9 PASS / 1 FAIL / 4 NOT_RUN trên 14 cổng; RC cuối `f86150e3` giữ nguyên kết quả ở mọi cổng chạy lại.** Mọi PASS là mức HOST/LOCAL; đây không phải CI, target hay HIL.

Lịch sử trên ứng viên đầu `4b833b38`: 6 PASS / 4 FAIL / 4 NOT_RUN.
- `e2e`: 6 ca đỏ. Bốn ca `point-names` là lỗi thật: Tag/Label của VP rộng 0 px. Một ca là spec `gate369` lọt lane. Một ca ISS-PGM03-05 chập chờn khi tải cao.
- `e2e-real`: `gate369` lọt lane, cộng T59-505.
- `release-package`: `build-release.sh` nhận cache cross-build.
- `candidate-pin`: authority lệch từ 2026-09-09.

Cả bốn đã được xử lý như mục 3, trừ T59-505 (Issue #786).

### Lỗi đã biết của RC

| Mã | Mức | Mô tả | Trạng thái |
|---|---|---|---|
| Issue #786 | Test/hợp đồng | e2e-real T59-505 chờ thư viện `PUBLISHED` sau niêm phong. Từ `4a2e7ead` (2026-09-25), thư viện chỉ được phát hành khi Project thật sự dùng nó | Cần chủ hợp đồng thư viện chọn: sửa kịch bản test hoặc quay lại hợp đồng cũ |
| Issue #789 | Chức năng | Nhãn nhập lúc tạo Virtual Point bị mất; tên hiển thị rơi về Tag. Backend xoá `label`, FE không ghi tên vào kho tên sau khi tạo | Mở; hệ đặt tên điểm |
| Issue #790 | Test | e2e-real ISS-PGM03-08 đỏ khi chạy cả lane (3 request `point-catalog` thay vì 2), đạt 2/2 khi chạy riêng | Mở; giả thuyết: trang mount lại sau khi đăng nhập |
| — | Ca chập chờn | Đỏ một lần khi tải cao, đạt khi chạy riêng: vitest `LibraryPage` lọc server (3/3), e2e ISS-PGM03-05 (2/2), e2e `trends` preset (2/2), e2e PGM-01 bàn phím mobile (2/2) | Theo dõi |

## 5. Bảy điều kiện mở `GO` của RC 2026-08-23 — trạng thái hôm nay

| # | Điều kiện | Trạng thái 2026-09-27 |
|---|---|---|
| 1 | CI chạy thật và xanh trên RC commit | **NOT_RUN** |
| 2 | Soak 24 h trên bo, 10 Program, 3 chu kỳ, poll gap < 200 ms (`U05`, `U11`) | **Chưa đạt theo định nghĩa gốc.** Có bằng chứng hỗ trợ: soak lần 2 (15 h 53 ph, một lớp chu kỳ, 0 lần jitter > 100 µs, tối đa 72,94 µs); soak lần 3 (8 Program × 8 lớp chu kỳ, 10 ph 08 s, C1–C4 PASS, tối đa 52,34 µs), đạt `VS-PROG-009` theo ngưỡng v2.4 (≥ 10 chu kỳ mỗi lớp, chủ sở hữu chốt 2026-09-27). Chưa có lần chạy 24 h đủ 10 Program và đo poll gap |
| 3 | AO/DO đo bằng thiết bị cho cả ST và FBD (`U09`) | **NOT_RUN** — bo chạy `mkddc-fake-mcu`. Riêng DO Modbus (CK-508), có FC05 trên dây và readback coil (G7, F06, F20); đó chưa phải phép đo thiết bị cho AO/DO cục bộ |
| 4 | ≥ 10 lần cắt nguồn, RETAIN/LKG/enable-intent phục hồi đúng | **NOT_RUN** |
| 5 | Thay controller, backup/restore trên dữ liệu vận hành | **Một phần** — trên bo thật 2026-09-27: sao lưu toàn bộ trước khi xoá, cài sạch, rồi năm lần nâng cấp bằng `install.sh` giữ dữ liệu người dùng (snapshot rollback tự động, khoá thiết bị và secret JWT giữ nguyên), cài thử fresh/upgrade ngay trên bo. Chưa thay controller (cần bo thứ hai) và chưa diễn tập restore từ bản sao lưu |
| 6 | Review Controls/Safety cho PID trên target, có approval token | **NOT_RUN** |
| 7 | Khoá ký của hãng thay khoá LAB, giữ trong HSM | **Một phần** — khoá hãng `2fb77aa42e7fe446` thay khoá LAB từ 2026-08-23 và có trong RC; vẫn là khoá file, chưa vào HSM |

## 6. Rủi ro còn lại

| Rủi ro | Mô tả | Hướng xử lý |
|---|---|---|
| Nền bo tham chiếu chưa tin cậy | Bo bị xâm nhập 2026-09-22. Cài sạch 2026-09-27 chỉ ở lớp ứng dụng. Chủ sở hữu báo đã nạp lại image, nhưng lúc 2026-09-27 05:34Z bo `mekong-fac.ddns.net` có uptime 2 ngày 20 giờ 58 phút và bản cài 05:17Z còn nguyên, tức **bo này chưa được nạp lại**. Mọi số đo target trong bản ghi là bằng chứng trên nền chưa tin cậy cho release | Nạp lại image Forlinx (USB/maskrom), cài lại theo `tools/deploy/foxlinx_factory_reset.sh`, chạy lại smoke/soak. Nếu image đã nạp cho một bo khác, ghi rõ bo nào |
| Kernel non-RT | PREEMPT_RT bị chặn vì thiếu BSP Forlinx. C4 đạt nhờ cô lập CPU3 và nền RT tạm; soak dài nhất là 15 h 53 ph | Chờ BSP, hoặc chủ sở hữu chấp nhận có ghi nhận nền non-RT |
| Không có I/O vật lý | Fake MCU; firmware MCU thật chưa tồn tại (khung STM32 không nạp được) | HIL khi có MCU thật và thiết bị đo |
| Ngưỡng `VS-PROG-009` hạ | Từ 10 000 chu kỳ / 24 h xuống ≥ 10 chu kỳ mỗi lớp (v2.4) | Soak dài vẫn là điều kiện 2 |
| G7 phần thiết bị | Thời gian đáp của CK-508 chưa có datasheet | Cần datasheet CK-508 |

## 7. Đề xuất quyết định

**`NO-GO` cho phát hành hiện trường.** Theo `PROMPT-PLAN59-CTO-W6W7`, các Must I/O vật lý, soak 24 h, cắt nguồn/RETAIN không được waive, và ba Must đó vẫn chưa có bằng chứng.

Bản ứng viên đạt cho **dùng nội bộ trên bo lab**:
- cổng HOST như mục 4;
- vòng đời Programming, chu kỳ 10 ms và Modbus đã đo trên bo thật;
- khoá hãng trong binary;
- cài sạch và nâng cấp thật đều đạt.

Release Owner ký verdict và đặt số phiên bản ở mục 8. Bản ghi này không tự đổi trạng thái sang Active.

## 8. Ký

| Vai | Quyết định | Số phiên bản | Ngày | Chữ ký |
|---|---|---|---|---|
| Release Owner | ☐ NO-GO ☐ GO (chỉ khi mục 5 đủ) | | | |

## 9. Điều kiện mở `GO` (cập nhật)

| # | Điều kiện | Cần gì để mở |
|---|---|---|
| 1 | CI chạy thật và xanh trên RC commit | Chạy 12 job CI trên RC |
| 2 | Soak 24 h, 10 Program, 3 chu kỳ, poll gap < 200 ms | Bo tham chiếu trên nền sạch (mục 9.8), 24 h liên tục |
| 3 | AO/DO đo bằng thiết bị cho ST và FBD | Firmware MCU thật + dụng cụ đo |
| 4 | ≥ 10 lần cắt nguồn | Nguồn cắt được bằng lệnh |
| 5 | Thay controller + backup/restore | Bo thứ hai |
| 6 | Review PID Controls/Safety | Người review Controls/Safety |
| 7 | Khoá hãng trong HSM | YubiHSM 2 (đánh giá đã có) |
| 8 | Nạp lại image bo tham chiếu sau sự cố, chạy lại smoke/soak | Người có mặt tại bo |
| 9 | Nền RT: PREEMPT_RT, hoặc chấp nhận non-RT có ghi nhận | BSP Forlinx, hoặc quyết định chủ sở hữu |

Khi đủ các mục có evidence được review, bản ghi này được thay bằng một release record mới; verdict không sửa tại chỗ.
