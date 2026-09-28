# Kiểm Trace nhất quán theo lần chạy và giá trị đọc lại trên bo lab (Issue #798)

**ID:** EV-PROG-TRACE-798-TARGET
**Ngày:** 2026-09-28
**Issue:** [#798](https://github.com/Mekong-HCM/MK-DDC-24/issues/798) (finding U-04 của [`REC-DDC-FIELD-USE-20260927`](../../reviews/DDC24_FIELD_USE_UPGRADE_FINDINGS_2026-09-27.md)); thiết kế [`SW-TRACE-RELEASE-COHERENT-MK-DDC-24-VI`](../../../02_design/software/TRACE_RELEASE_COHERENT_SAMPLING_DESIGN_MK-DDC-24_VI.md)
**Trạng thái:** **PASS sau khi sửa.** Lần kiểm đầu trên `main@4c49e78b` **FAIL** ở tiêu chí đọc lại: mọi ô DO Modbus có đọc lại = lệnh, tuổi 0 ms. Đã sửa Core (commit `1602b2fd`), deploy lại và kiểm lại thì PASS. Relay vật lý NOT RUN: chưa đo điện tại tiếp điểm.
**Đích:** `OK1126B-buildroot` (Forlinx OK1126B-S, RV1126B), bus `rs485-1` 9600 8N1, CK508-04/05.
**Lớp bằng chứng:** TARGET (Core thật, bus Modbus thật, coil đọc về bằng FC01). Không phải HIL.

## 1. Bản chạy trên bo

| Artifact | Commit | sha256 (16 ký tự đầu) | Ghi chú |
|---|---|---|---|
| `mkddc-core` | `1602b2fd` (nhánh `docs/trace-target-798` = `main@4c49e78b` + 2 bản sửa ở §4) | `5868aabd1fc0b0f5` | khoá RELEASE `2fb77aa42e7fe446` |
| `mkddc-programming-sim-worker` | `1602b2fd` | `60a300e4392c3898` | |
| `mkddc-iobus` | `main@4c49e78b` | `d017f38a31fe9604` | BACnet + Modbus |
| `mkddc-web` (+ `reload-helper`, `time-helper`) | `main@4c49e78b` | `4beecdda42589838` | dựng từ bản clone thường (§5.2) |
| `mkddc-st-compile` / `-package` / `-validate` | `main@4c49e78b` | `389c99ff…` / `939d5137…` / `f1c7501e…` | `fwsom-st-1.2.0`, profile `a4396636…` (có token PID) |
| FE (`web-ui`) | `main@4c49e78b` | `f1eeb9272501bc7c` | **bị bên thứ ba thay lúc 09:40:33Z**, xem §5.3 |

Read-back theo `DEPLOY_FOXLINX.md` bước 7b ([`artifact-readback-0946.json`](fixtures/2026-09-28-trace-798/artifact-readback-0946.json)): 11 kiểm, 9 OK, 2 lệch đều là `web-ui` do lần thay FE ngoài phiên (§5.3). Sao lưu trên bo: `/data/mkddc/deploy-backups/20260928T092157Z-main-4c49e78b/` (binary cũ, `dist`, store Programming kèm `-wal`) và `/data/mkddc/deploy-backups/20260928T094510Z-core-1602b2fd/`.

Sau deploy: health 6/6 `ok`; Programming `READY`; `INFO programming.toolchain ok` với profile `a4396636…`; Revision Active giữ nguyên `0c29f4f1…` (của người dùng); `PRG_DO16_MODBUS` `RUNNING`, `HEALTHY`, `missedRelease = 0`; task 0 overrun, 0 lỡ base step.

## 2. Cách đo

- Program đang chạy: `PRG_DO16_MODBUS`, chế độ AUTO, **chu kỳ 10 ms** (người dùng tự Commission 10 ms, không phải 100 ms như bản nghiệm thu 2026-09-27). Phiên này không đổi Revision Active và không đổi VP nào.
- Trace qua API `POST /api/v1/programming/runtime/traces`, `EVERY_SAMPLE`, rồi đọc `GET …/traces/{id}`:
  - Phiên A, **100 ms** theo yêu cầu: 22 biến (4 đầu vào, 16 DO, `StsMode`, `StsOnCount`), 45 s, 450 mẫu.
  - Phiên B, **10 ms** (bằng chu kỳ Program): 6 biến, 15 s, 1 500 mẫu — để thấy từng lần chạy.
- Bộ chấm [`trace798.py`](fixtures/2026-09-28-trace-798/trace798.py) chạy trên dữ liệu thật, **không nới luật**. Nó kiểm bốn nhóm:
  - `releaseSeq` trong mỗi mẫu và giữa hai mẫu liền nhau;
  - bất biến vào/ra trong cùng mẫu: `StsOnCount` = số kênh đóng, kênh khoá = 0, mất cho phép thì tắt hết, `StsMode ∈ {0, 8}` thì không kênh nào đóng;
  - đọc lại so với lệnh, tuổi đọc lại;
  - `actualValue` so với `readbackValue`.
- Helper gọi API bằng SSH + `wget`/`perl` chạy trên bo, vì sshd của bo tắt port-forwarding. Helper không đưa vào repo vì chứa thông tin đăng nhập.

## 3. Kết quả

### 3.1 Trước khi sửa (`main@4c49e78b`, 09:36:37–09:37:22Z) — FAIL

[`report-100ms-truoc-sua.json`](fixtures/2026-09-28-trace-798/report-100ms-truoc-sua.json): 450 mẫu, `releaseSeq` đúng; nhưng **0/7 200** ô DO có đọc lại khác lệnh, `readbackAgeMs` luôn 0. `StsMode`/`StsOnCount` (đầu ra VP) cũng có "đọc lại" bằng lệnh. Nguyên nhân và cách sửa ở §4.1.

### 3.2 Sau khi sửa (`1602b2fd`)

| Tiêu chí (Issue #798) | Phiên A — 100 ms (09:47:00–09:47:45Z) | Phiên B — 10 ms (09:48:08–09:48:24Z) | Kết quả |
|---|---|---|---|
| Nguồn mẫu | `CORE`, `effectiveSamplePeriodMs` 100, 0 mẫu rơi | `CORE`, 10, 0 mẫu rơi | PASS |
| Mọi ô trong một mẫu cùng `releaseSeq` | 450/450 mẫu | 1 500/1 500 mẫu | PASS |
| `releaseSeq` giữa hai mẫu | **10** ở 449/449 khoảng — đúng 100 ms / 10 ms, không phải lỡ lần chạy | **1** ở 1 499/1 499 khoảng — liên tiếp, không bỏ lần chạy nào | PASS; 0 khoảng bất thường |
| Mẫu lệch pha vào/ra (bộ chấm không nới luật) | 0 vi phạm bất biến | 0 vi phạm | PASS |
| Đọc lại khác lệnh khi relay chưa kịp đổi | 485/7 200 ô DO | 72/3 000 ô DO | PASS |
| `readbackAgeMs` tăng rồi reset | 28…1 097 ms; tăng 6 464 lần, reset 720 lần (16 DO × 45 lần poll FC01 ~1 s) | 82…1 091 ms; reset 30 lần (2 DO × 15) | PASS |
| Độ trễ từ lúc lệnh đổi tới lúc đọc lại khớp | 93 lần đổi: min 0 / trung vị 500 / max 1 000 ms (độ phân giải 100 ms) | 2 lần đổi: 360 ms | Đo được |
| `actualValue` = `readbackValue` | 0 ô lệch | 0 ô lệch | PASS |
| Đầu ra VP (`StsMode`, `StsOnCount`) | `readbackValue` = null | — | PASS (thiết kế §4) |

Ví dụ ở phiên B ([`vi-du-do01-do02-10ms.txt`](fixtures/2026-09-28-trace-798/vi-du-do01-do02-10ms.txt)):

- Lần chạy 13 621 (21.298Z): DO01/DO02 đổi lệnh `True → False`. Đọc lại vẫn `True`, tuổi 740 ms.
- Từ đó tới lần chạy 13 656, lệnh là `False` còn đọc lại vẫn `True`, và tuổi tăng từng 10 ms.
- Lần chạy 13 657 (21.658Z), 360 ms sau khi lệnh đổi: đọc lại về `False`, tuổi reset còn 100 ms. Tuổi 100 ms nghĩa là mẫu FC01 được lấy lúc 21.558Z, còn 100 ms là thời gian mẫu đi từ iobus tới bảng điểm của Core.

Hệ quả cho người đọc Trace: cột "Đọc lại" trễ sau lệnh tới một chu kỳ poll FC01 (~1 s) cộng trễ chuyển mẫu; đây là giá trị coil thật, không phải bằng chứng relay đã đóng về điện.

## 4. Lỗi phát hiện trong lượt kiểm và đã sửa

### 4.1 Đọc lại của DO Modbus chép lệnh vừa ghi (commit `1602b2fd`)

- **Triệu chứng:** §3.1.
- **Nguyên nhân:** `st_output_readback` đọc `PointTable::get()`. Thứ tự trong ScanLoop:
  1. `update_ext` đưa mẫu poll vào bảng điểm;
  2. Program chạy;
  3. bước xuất lệnh gọi `PointWriter::write`, hàm này với điểm EXT dùng `set_virtual` để ghi **lệnh** vào chính ô đó với `ts = lúc ghi`;
  4. Trace lấy mẫu.

  Vì vậy Trace luôn thấy lệnh, tuổi 0. Test host T798_4 dựng DO nội bộ (feedback IO, không bị ghi đè) nên không lộ.
- **Cách sửa:** PointTable giữ `ext_reported_[]`, bản sao mẫu thiết bị báo về mà chỉ `update_ext` ghi. `st_output_readback` đọc bản này cho EXT; AO/DO nội bộ vẫn đọc feedback IO; AV/BV/MSV trả "không có kênh đọc lại".
- **Test:** `StValueTrace.T798_4_ModbusReadbackIsThePolledCoilNotTheCommandJustWritten` và `…VirtualPointOutputHasNoReadback`, đi đúng thứ tự ScanLoop. Cả hai **đỏ** trên mã cũ với đúng triệu chứng trên bo, **xanh** sau sửa; ctest 1741/1741.

### 4.2 `artifact_manifest.py` từ chối sim worker (commit `394c985b`)

- **Triệu chứng:** bước 6b `deploy-record` exit 2: "binary không mang MKDDC_GIT_COMMIT" ở `mkddc-programming-sim-worker`. `build-release.sh` gọi `record` với cả sim worker lẫn `mkddc-schedule-sim`, nên đóng gói phát hành cũng hỏng.
- **Nguyên nhân:** hai binary này không dùng macro `MKDDC_GIT_COMMIT` nên compiler bỏ chuỗi, trong khi bảng REGISTRY khai `embeds_commit=True`.
- **Cách sửa:** thêm cờ `--provenance`, giữ nguyên `--version` vì web đọc nó làm `workerVersion`. Thêm CTest `BinaryProvenance.*` 3/3.

## 5. Quan sát vận hành

### 5.1 Core khởi động làm Program FAULTED (Issue [#827](https://github.com/Mekong-HCM/MK-DDC-24/issues/827), U-22) — chưa sửa

Cả hai lần Core khởi động (09:22:07Z khi web đang dừng; 09:45:10Z khi web vẫn chạy), `PRG_DO16_MODBUS` bị `FAULTED ST-RT-008` trước lần chạy đầu (`lastRunAtUtc = null`). Nguyên nhân: VP chưa có trong bảng điểm của Core ở lần dispatch đầu, và bo không có `state.snap`. Mã FAULT ngay ở mẫu xấu đầu tiên, trong khi `DDD-CTRL-PROG-001` §5/§9 ghi "hold-last, tự phục hồi theo ngưỡng hoặc ack". Việc sửa cần chốt ngưỡng, nên chưa sửa.

Cả hai lần đã khôi phục bằng `PUT …/runtime-intent` `false` → `true`. Program về `RUNNING` và Revision Active không đổi. Trình tự này nay ghi ở `DEPLOY_FOXLINX.md`.

### 5.2 Binary Go dựng trong git worktree không có `vcs.revision`

Go chỉ nhận `.git` là thư mục; trong worktree `.git` là file, nên binary thiếu thông tin VCS và `deploy-record` từ chối. Tôi dựng lại `mkddc-web` từ một bản clone thường tại `4c49e78b` (`vcs.revision=4c49e78b`, `modified=false`) và deploy bản đó.

### 5.3 Bên thứ ba deploy FE trong lúc đo

Hai lần có tác nhân từ `192.168.1.42`, dùng khoá SSH khác khoá của phiên này:

- 09:30:21–33Z: mở sftp rồi khởi động lại `mkddc-web-pi`;
- 09:40:31–34Z: thay `/opt/mkddc-web/dist` bằng một bản FE khác (`index-D5rJ8eJj.js`, `index.html` `6b1c1d52…`) rồi khởi động lại web.

Binary web vẫn là bản của phiên này. Theo quy tắc không ghi đè việc FE của người khác, tôi **giữ nguyên** bản FE đó, nên read-back báo `web-ui` lệch manifest. Người deploy FE đó cần chạy `deploy-record` cho mục `web-ui`. Phép đo Trace dùng API nên không bị ảnh hưởng.

### 5.4 Jitter trong lúc đo

Từ 09:45 tới 09:49Z Core ghi 6 lần wake-up jitter > 100 µs (cửa sổ phút lớn nhất 177 µs), đúng các phút chạy Trace và SSH/`wget` dồn dập. Để so sánh, Core cũ ghi 18 lần trong 4 ngày. Trong cùng khoảng: 0 overrun, 0 lỡ base step, 0 lỡ release. Task báo `DEGRADED` thoáng qua rồi về `HEALTHY` (cửa sổ sau 47 µs). Đo lại khi bo yên (không Trace, chỉ 5 phiên SSH đọc log), 09:49:30–09:57:22Z: 8 cửa sổ phút có jitter tối đa 39–66 µs, bộ đếm vi phạm giữ nguyên 6 (không thêm lần nào), 0 overrun, 0 lỡ base step. Vậy 6 lần vượt 100 µs trùng với lúc phiên đo chạy Trace + SSH dồn dập, không phải nền của bản mới. Đây chưa phải phép đo soak theo ADR-061 (VS-PROG-009).

## 6. Chưa chạy (NOT RUN)

- Đo điện tại tiếp điểm relay.
- Trace với Program chu kỳ 100 ms trong Task 10 ms trên bo: đây là trường hợp gây lệch pha trước #798, nhưng Revision Active của người dùng chạy 10 ms và phiên này không đổi Active. Bằng chứng cho trường hợp đó là test host `T798_1_…` (300 boundary, 0 cặp lệch).

## Lịch sử sửa đổi

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.1 | 2026-09-28 | §5.4: số đo jitter khi bo yên (09:49–09:57Z: tối đa 39–66 µs, 0 vi phạm mới) |
| 1.0 | 2026-09-28 | Bản đầu: deploy `main@4c49e78b` + Core `1602b2fd`; Trace 100 ms/10 ms trên bo; lỗi đọc lại EXT phát hiện và sửa; lỗi manifest sim worker; U-22 (#827) |
