# Triển khai và nghiệm thu `PRG_DO16_MODBUS` trên bo Foxlinx

**ID:** EV-PROG-DO16-MB-20260927
**Ngày:** 2026-09-27
**Trạng thái:** Đã triển khai. Nghiệm thu T1–T12 **PASS** ở lớp lệnh FC05 và readback coil. Kiểm theo từng chu kỳ: bản 1.2 **2 120 chu kỳ**, chế độ AUTO bản 1.3 **1 665 chu kỳ**, đều **0 vi phạm thiết kế**. Hiện bo chạy **AUTO** (`DO16_MODE = 10`). Relay vật lý **NOT RUN**: chưa đo điện tại tiếp điểm, nên đây không phải HIL.
**Chương trình:** [`GUIDE-PROG-ST-DO16-001`](../../../06_operations/PROGRAMMING_ST_DO16_MODBUS_GUIDE.md) bản 1.3 — 1 PROGRAM + 5 FUNCTION + 5 FUNCTION_BLOCK, 16 DO trên CK508-04/05.
**Đích:** `OK1126B-buildroot` (Forlinx OK1126B-S, RV1126B), `mekong-fac.ddns.net`, web `:8082`, bus `rs485-1` 9600 8N1.
**Bản chạy trên bo:** RC `main@f86150e3` cho core (`9621cb52…`), iobus (`96a0feea…`), FE và tool ST (`fwsom-st-1.2.0`, profile `1cb61fec…`). Web thay bằng build từ `86aa4ede` (PR #795): `c71616de…`.

## Mục tiêu

- Đưa Program ST của `GUIDE-PROG-ST-DO16-001` lên bo, vào Project có sẵn của người dùng, và giữ nguyên dữ liệu của họ.
- Đo từng chế độ trên bus thật: nhịp lệnh FC05, readback coil, hành vi an toàn (mất cho phép, khoá kênh, Disable về giá trị an toàn).
- Phát hiện lỗi nào thì sửa trong phiên, đo lại, và ghi vào đây.

## Trạng thái trước khi làm

Chụp lúc 10:53–10:55Z, trước mọi thao tác ghi.

| Hạng mục | Giá trị |
|---|---|
| Dịch vụ | `mkddc-core`, `mkddc-iobus`, `mkddc-web-pi` active, `NRestarts=0`; web `0ba384e1…` |
| Programming | Một Project "CHUONG CONTROLLER" (`27ddb481…`) do người dùng tạo; **chưa có Revision Active**. Draft có một Program FBD `DEMO_1` (1000 ms) chỉ **đọc** `CK50907-DO3`; Check gần nhất PASSED lúc 10:28Z |
| Virtual Point | Một VP của người dùng: `VP1` (`DDD`, `AV-01`) |
| Modbus | cấu hình `CLEAN` revision 40, 4/4 slave online. 16 điểm `CK50804/05-DO1…8` là Read/Write, `safe_value = false`; profile iobus trên bo có `"safe_value": 0` cho 8 coil của mỗi CK508 |
| 16 DO | đều 0, `GOOD`, không override |

## Nhật ký theo thời gian (UTC)

| Thời điểm | Bước | Kết quả / bằng chứng | Trạng thái |
|---|---|---|---|
| 10:55:54–10:56:16 | Tạo 11 VP | Tám VP lệnh (chủ sở hữu `WEB`): `DO16_MODE` → `MSV-01`, `DO16_MANUAL_MASK` → `AV-02`, `DO16_LOCK_MASK` → `AV-03`, `DO16_STEP_S` → `AV-04`, `DO16_DEMAND_PCT` → `AV-05`, `DO16_TEST_START` → `BV-01`, `DO16_REVERSE` → `BV-02`, `DO16_PERMIT` → `BV-03`. Ba VP trạng thái: `DO16_STS_MODE` → `MSV-02`, `DO16_STS_ON` → `AV-06`, `DO16_STS_TRIPS` → `AV-07`, chuyển sang chủ sở hữu `PROGRAM`. `VP1` giữ nguyên | PASS |
| 10:57 | Dựng Draft | 3 lần PATCH: 11 POU + chu kỳ 100 ms, 27 biến, 27 binding. Lần đầu nhận `409 PRG-ERR-CONFLICT-001` vì gửi ID Draft vào `baseRevisionId`; sửa thành base của Draft thì 200. So byte: object, binding và cấu hình chạy của `DEMO_1` không đổi | PASS |
| 10:58:37 | Niêm phong `dbdace53…` + Check | **FAILED**, 6 diagnostic `PRG-ERR-MAP-003`/`PIO-SRC-001` (xem DO16-F2 và DO16-O1) | FAIL → điều tra |
| 11:00–11:05 | Sửa Check trên nhánh `fix/programming-vp-binding-slot-type-20260927` | Commit `43f811f4` + `86aa4ede`. `go vet ./...` sạch; `go test ./... -count=1` PASS; test mới đỏ 10/12 trên mã cũ | PASS host |
| 11:06–11:07 | Deploy web | Sao lưu `/data/mkddc/deploy-backups/2026-09-27T1106Z-web-vp-slot-type/` (binary cũ + `programming-v1.sqlite` kèm `-wal`/`-shm`). Hai helper `reload-helper`/`time-helper` dùng chung binary, lúc đầu còn chạy bản cũ `(deleted)`, đã khởi động lại. Kết quả: `/proc/<MainPID>/exe` của `mkddc-web-pi` và hai helper đều `c71616de…`, `NRestarts=0`; health 6/6 `ok`; `INFO programming.toolchain ok` | PASS |
| 11:09:18 | Check lại `dbdace53…` | PASSED, 0 diagnostic, 1,14 s; artifact 60 074 byte | PASS |
| 11:10:25 | Commission | Active trước đó: không có. Xác nhận 7 nhóm `PRESENT`. SUCCEEDED 0,55 s | PASS |
| 11:11:17 | Enable `PRG_DO16_MODBUS` | `RUNNING`, `CORE_LIVE`, 100 ms, chạy 47 µs. `DEMO_1` để DISABLED (của người dùng) | PASS |
| 11:12:30–11:16:15 | Nghiệm thu lượt 1 (T1–T12) | 581 mẫu readback, 350 FC05. Mọi mục đạt, **trừ** T3/T5: relay của chế độ trước bị giữ ~10 s (DO16-F1) | FAIL T3/T5 |
| 11:16–11:18 | Sửa `PRG_DO16_MODBUS` (bản 1.1) | Host: S13/S14 tái hiện lỗi trên bản cũ và xanh trên bản mới; biên dịch 0 diagnostic | PASS host |
| 11:18:57–11:18:59 | Cập nhật Draft, niêm phong `5d2ae6c4…`, Check, Commission | Chỉ thay `source` của Program, giữ 27 biến. Check PASSED 0 diagnostic (1,12 s), artifact 60 098 byte `f4ad5736…`. Active trước đó `dbdace53…`, đọc ngay trước khi gửi. SUCCEEDED 0,45 s; Program tự `RUNNING` lại | PASS |
| 11:19:10–11:22:40 | Nghiệm thu lượt 2 (T1–T12) | 649 mẫu readback, 342 FC05; mọi mục PASS (bảng dưới) | PASS |
| 11:25 | Trạng thái cuối | Xem mục "Trạng thái sau khi làm" | PASS |
| 11:55:08 | Quan sát, không thuộc phiên này | Audit ghi `DRAFT_SAVE` của `admin` từ một phiên khác, xoá `DEMO_1` khỏi Draft, rồi nhiều phiên mô phỏng từ 11:55 tới 12:27Z. Vì vậy Project báo `dirty=true`. Phiên này **không** đụng vào thay đổi đó | Ghi nhận |

## Kết quả nghiệm thu (lượt 2, bản 1.1)

Thời gian lấy từ frame FC05 (`/api/v1/modbus/frames`); trạng thái lấy từ readback coil (`/api/v1/points`, FC01 poll mỗi 1 s, lấy mẫu ~0,3 s). Frame mang giờ của bo, mốc thao tác mang giờ máy dev. Đã quy đổi bằng hai phép bù: độ trễ bắt đầu lấy mẫu của harness, và độ lệch đồng hồ bo − máy dev đo qua SSH (+0,23 s, sai số ±0,25 s).

| # | Thao tác | Kết quả đo | Kết luận |
|---|---|---|---|
| T1 | `DO16_STEP_S=1`, `DO16_MODE=3` | FC05 đầu tiên 2,0 s sau lệnh (đúng khoảng nghỉ). 22 bước, khoảng cách 0,9 / 1,0 / 1,1 s; mỗi bước 2 FC05 cách nhau ~28 ms; tối đa 1 relay đóng tại mọi mẫu | PASS |
| T2 | `DO16_REVERSE=TRUE` | DO04 → DO03 → DO02 → DO01 → DO16 → DO15 → DO14 | PASS |
| T3 | `DO16_MODE=2` | DO14 (còn lại từ CHASE) nhả ≤ 0,9 s. DO01 đóng khi đã nghỉ đủ 10 s, sau đó 15 kênh cách nhau 1,0–1,1 s | PASS |
| T4 | `DO16_STEP_S=0.3`, `DO16_MODE=4` | 0,3 s bị kẹp lên 1 s. Mỗi 1,0–1,1 s một đợt 16 FC05, mỗi đợt kéo dài 0,43 s | PASS |
| T5 | `DO16_STEP_S=2`, `DEMAND=55`, `DO16_MODE=5` | 8 relay của BLINK nhả ≤ 1,0 s; bậc 1 đóng sau 10 s nghỉ; lên tới 9 bậc, khoảng 1,8–3,1 s theo readback | PASS |
| T6 | `DEMAND=20` rồi `=4` | Giảm dần 9 → 3 bậc, mỗi bậc ≈ 2 s và tôn trọng thời gian đóng tối thiểu. Xuống 4 % thì tắt hết ≤ 0,66 s | PASS |
| T7 | `DO16_STEP_S=0.5`, `DO16_MODE=6`, bấm nút | 16 kênh lần lượt, mỗi kênh 0,45–0,53 s (kênh đầu 0,70 s, như mô phỏng dự báo), rồi tự tắt | PASS |
| T8 | `DO16_STEP_S=3`, `DO16_MODE=7`, bấm và giữ nút 6 s | 16 kênh đóng ≈ 3 s rồi nhả; giữ nút không kéo dài | PASS |
| T9 | `DO16_MANUAL_MASK=5`, `DO16_MODE=1` | DO01 + DO03 | PASS |
| T10 | `DO16_LOCK_MASK=1` | DO01 nhả ≤ 1,3 s; DO03 giữ | PASS |
| T11 | Đang CHASE, `DO16_PERMIT=FALSE` rồi `TRUE` | Tắt hết; `STS_MODE=9`; `STS_TRIPS` 1 → 2. Giá trị 1 có từ lượt 1: RETAIN giữ qua Commission. Có lại cho phép → `STS_MODE=8` trong 2 s → chạy lại từ DO01 | PASS |
| T12 | `MODE=1`, mask 65535, rồi Disable | 16 FC05 về giá trị an toàn phát xong trong 0,43 s, trong lúc hoặc ≤ 0,21 s sau khi API trả về; readback 16 DO = 0 sau ≤ 0,92 s. Enable lại + `MODE=0`: 16 FC05 ghi lại 0 khi Program nhận lại quyền ghi | PASS |

Số đo chung trong 204 s của lượt 2:

| Hạng mục | Giá trị |
|---|---|
| FC05 | 342 lệnh, 100 % ACK, `attempt=1`; mỗi giao dịch 28,0 / 28,7 / 29,8 ms (min / trung vị / max) |
| Bộ đếm bus (4 slave) | `total_errors`, `timeout_errors`, `crc_errors`, `retry_attempts`, `write_failed`, `write_dropped` đều 0 |
| Program | chu kỳ 100 ms; chạy 43–47 µs, tối đa 56,6 µs; `missedReleaseCount=0`; `faultCount=0`; HEALTHY |
| Task base 10 ms | `overrunCount=0`, `missedReleaseCount=0`, `missedBaseStepCount=0`, `jitterMaxUs=49`, `jitterViolationCount=0` |

## Finding

| ID | Mức | Mô tả | Nguyên nhân gốc | Xử lý |
|---|---|---|---|---|
| DO16-F1 | P2 (mã đề xuất) | Đổi từ chế độ đang đóng relay sang chế độ tải (2/5): relay của chế độ cũ bị giữ thêm ~10 s, và STAGGER đứng chờ. Lượt 1: DO15 giữ tới 44,6 s; 8 relay BLINK giữ tới 84,7 s | `TMinOn` lấy theo chế độ **mới**, nên luật thời gian đóng tối thiểu 10 s của chế độ tải áp lên relay do chế độ không-tải bật; `AnyWaiting` chặn bước | **ĐÃ SỬA** ở bản 1.1: `TMinOn := SEL(LoadMode AND Settled, …)`. S13/S14 trên host; nghiệm thu lại T3/T5 trên bo PASS |
| DO16-F2 | **P1** (sản phẩm) | Check từ chối mọi binding vào VP `integer` và `multistate`, dù tab Ánh xạ và Point Catalog gợi ý đúng kiểu | `virtualSignalTypeForST` đòi REAL ↔ `float` và UINT ↔ `integer`, trong khi slot Core là `AV` ⇒ REAL và `MSV` ⇒ UINT (`st_io_map.cpp`). Hai luật không có giao điểm | **ĐÃ SỬA** ở PR #795 (chờ review/merge), đã cài lên bo lab. Check nay suy kiểu từ slot Core |
| DO16-O1 | Ghi nhận (cấu hình) | 3 VP trạng thái bị Check từ chối: "khai chỉ đọc (writable=false)" | Phiên này tắt `writable` khi chuyển chủ sở hữu sang `PROGRAM`; Check đòi `writable=true` | Bật lại `writable`. Ghi thành ràng buộc 18 trong hướng dẫn |
| DO16-O2 | Ghi nhận | Một lệnh `PUT /api/v1/points/VP7` (lượt 1) mất ~4 s mới trả về; các lệnh ghi VP khác ~0,1 s | Chưa xác định; chương trình phản ứng ngay khi giá trị tới Core | Theo dõi; chưa tái hiện ở lượt 2 |
| DO16-F4 | P3 (mã đề xuất, bắt trước khi lên bo) | AUTO bật sẵn khi Program khởi động thì bỏ qua bước OFF nghỉ 12 s | Chu kỳ đầu `AutoDur = T#0s` nên `AutoTmr` báo hết giờ ngay | **ĐÃ SỬA** trước khi triển khai: chỉ chạy `AutoTmr` khi `AutoDur > T#0s` (S16) |
| DO16-O3 | Ghi nhận (công cụ Trace) | Web cho mở tối đa 4 phiên Trace (`trace.go:68`), nhưng Core chỉ nhận một phiên (`st_value_trace.cpp:46`). Phiên thứ hai (B) âm thầm chuyển sang poll monitor: chạy đủ 55,5 s nhưng chỉ có 111 mẫu, cách nhau 132–1 065 ms (trung vị 500 ms), tức thiếu khoảng 80 % số chu kỳ. API vẫn báo `effectiveSamplePeriodMs = 100`, `droppedSamples = 0`; dấu hiệu duy nhất là `freshness = LIVE` thay vì `FRESH` | Hạn mức 4 phiên ở web không khớp 1 phiên ở Core; đường dự phòng không được công bố trong view Trace | Không dùng phiên B làm bằng chứng; đo bù bằng phiên đơn (D). Chi tiết và đề xuất sửa: `REC-DDC-FIELD-USE-20260927` U-02 |
| DO16-F3 | P2 (mã đề xuất) | STAGING khi giảm bậc: đầu ra có "lỗ" (vd `0x01DF`) trong 33 chu kỳ, và hai relay nhả cách nhau 3–9 chu kỳ, trái với "cách nhau ≥ `CmdStepSec`". Chỉ lộ ra khi kiểm từng chu kỳ | `Hold` của `FB_STAGER` chỉ chặn chiều tăng; chiều giảm trừ bậc đều trong khi relay còn bị giữ bởi thời gian đóng tối thiểu | **ĐÃ SỬA** ở bản 1.2: `Hold` chặn cả chiều giảm. S15 trên host; trên bo 0 vi phạm (xem mục dưới) |

## Kiểm theo từng chu kỳ (13:29–13:51Z)

Theo yêu cầu "xem chương trình có hoạt động đúng thiết kế trong 100 chu kỳ". Mỗi chế độ được ghi bằng một phiên Trace của Core, lấy mẫu 100 ms bằng đúng chu kỳ Program, đủ 27 biến vào/ra. Trần 10 000 ô mỗi phiên nên mỗi phiên ≤ 37 s. Mỗi chu kỳ được chấm theo đặc tả §1 của hướng dẫn.

**Trước khi đo:** lúc 13:29:09–13:29:19Z, người dùng tự niêm phong và Commission Revision `104ded61` từ Draft (Draft đã bỏ `DEMO_1`). So byte: 11/11 POU của `104ded61` trùng bản 1.1, và đủ 27 binding.

**Cách chấm:**

- Bất biến ở mọi chu kỳ: `StsOnCount` = số kênh đóng; kênh bị khoá luôn 0; mất cho phép thì tắt hết và `StsMode = 9`; `StsMode ∈ {0, 8}` thì không kênh nào đóng; `StsMode` khớp chế độ.
- Luật riêng: MANUAL = mask AND NOT khoá; CHASE đúng 1 kênh và chỉ sang kênh kề; BLINK chỉ hai mẫu lẻ/chẵn; STAGGER/STAGING luôn là N kênh đầu; TEST đúng thứ tự sau sườn bấm; PULSE đúng một xung.
- Nhịp thời gian cho dung sai ±1 chu kỳ: timer so với mốc tuyệt đối, nên có lúc lệch 1 chu kỳ đúng tại mốc (trung bình vẫn đúng). STAGING khi nhu cầu còn bật: hai lần đổi bậc cách ≥ 10 chu kỳ, relay nhả phải đã đóng ≥ 10 s.
- Core chốt đầu vào mỗi base step 10 ms (`st_capture_due_inputs`), còn Program chạy mỗi 100 ms, nên trong một mẫu đầu vào có thể mới hơn đầu ra tối đa 90 ms. Bộ chấm cho phép đầu ra khớp đầu vào của mẫu trước, với điều kiện chu kỳ kế phải khớp ngay.
- Cột `actualValue` của Trace là giá trị lệnh trong bảng điểm của Core (khớp ngay trong cùng chu kỳ), không phải coil đọc lại, nên không dùng làm bằng chứng readback.

| Lượt | Revision | Chu kỳ | Kết quả |
|---|---|---|---|
| 1 (13:36–13:39Z) | `104ded61` (bản 1.1) | 1 767, 0 mẫu rơi | 38 vi phạm, **tất cả** ở STAGING khi giảm bậc (DO16-F3). Mọi chế độ khác 0 vi phạm |
| Sửa (13:45:11–13:45:13Z) | `9b40a15e` (bản 1.2) | — | Draft sạch và Active = `104ded61` được kiểm ngay trước khi ghi; chỉ thay `FB_STAGER`. Check PASSED 0 diagnostic; Commission SUCCEEDED 0,47 s (không nhóm impact nào `PRESENT`); Program tự RUNNING |
| 2 (13:45–13:49Z) | `9b40a15e` | 1 768, 0 mẫu rơi | 0 vi phạm luật. Một mục "20 % mới xuống 5 bậc" là do cửa sổ 13 s quá ngắn cho chiều giảm có chờ đóng tối thiểu |
| 3 (13:50–13:51Z) | `9b40a15e` | 352, 0 mẫu rơi | STAGING giảm bậc trọn vẹn: 9 → 8 → … → 3, mỗi lần cách 12–13 chu kỳ, luôn là N bậc đầu, giữ 3 bậc 178 chu kỳ, 4 % → tắt. **0 vi phạm** |

Số liệu theo chế độ của lượt 2 và 3:

| Chế độ | Chu kỳ ổn định | Kết quả |
|---|---|---|
| OFF | 131 | 16 DO = 0 ở mọi chu kỳ |
| MANUAL | 178 | DO = mask AND NOT khoá ở mọi chu kỳ (4 tổ hợp) |
| CHASE 0,5 s | 265 | 1 kênh; luôn sang kênh kề; giữ 5 chu kỳ 40 lần, 4 hoặc 6 chu kỳ 9 lần, trung bình 4,93; mất cho phép → tắt, `StsTrips` +1, chạy lại từ DO01 |
| BLINK 1 s | 137 | chỉ hai mẫu lẻ/chẵn, mở đầu bằng lẻ; mỗi pha 9–11 chu kỳ |
| STAGGER 1 s | 208 | N kênh đầu; N tăng 1 → 16, mỗi bước 9–11 chu kỳ |
| STAGING | 308 + 352 | N bậc đầu, không lỗ; lên 9 bậc mỗi bậc 12–13 chu kỳ; giảm về 3 mỗi lần 12–13 chu kỳ; relay 9 giữ đủ 10 s |
| TEST 0,5 s | 146 | chỉ chạy sau sườn bấm; DO01 → DO16 đúng thứ tự, 4–6 chu kỳ mỗi kênh, rồi tự tắt |
| PULSE 3 s | 127 | đúng 1 xung 30 chu kỳ dù giữ nút 51 chu kỳ |
| Chung | 2 120 | nhịp 99,91–100,09 ms; sequence liên tục; khoảng nghỉ đổi chế độ 21–22 chu kỳ; đầu vào mới hơn đầu ra một mẫu 3 lần, chu kỳ kế đều khớp; Program `missedRelease` 0, `faultCount` 0, chạy 40–61 µs; task 0 overrun, jitter tối đa 58 µs |

## Chế độ AUTO (bản 1.3, 13:58–14:08Z)

Yêu cầu: "set tự động chạy tất cả chế độ". Thêm `CmdMode = 10` (AUTO): tự chạy lần lượt OFF 12 s → STAGGER 22 s → CHASE 12 s → BLINK 10 s → MANUAL 8 s → TEST 12 s → PULSE 8 s → OFF 12 s → STAGING 40 s, rồi lặp lại. Tham số do chương trình tự sinh; `CmdReverse`, `CmdLockMask` và `InPermit` vẫn có hiệu lực.

| Bước | Kết quả |
|---|---|
| Host | Biên dịch 0 diagnostic (1 576 lệnh, 467/512 slot ghi, 43/64 instance FB). S16 (2 vòng, mất cho phép, rời AUTO): 3 361 chu kỳ, 0 vi phạm. Bắt và sửa DO16-F4 trước khi lên bo. S1–S15 cho đầu ra giống hệt bản 1.2 |
| VP | Thêm trạng thái `10 = AUTO` vào `DO16_MODE` (`VP2`). Chính sách sau khởi động lại vẫn là "về giá trị khởi tạo" (0 = OFF) |
| Triển khai | Draft sạch và Active = `9b40a15e` được kiểm ngay trước khi ghi; chỉ thay mã `PRG_DO16_MODBUS`. Revision `a0f107fa…`: Check PASSED 0 diagnostic, artifact 62 305 byte `82755a37…`; Commission SUCCEEDED 0,46 s (xác nhận nhóm `enableIntent`); Program RUNNING |
| Bật AUTO | `DO16_MODE = 10` lúc 14:01:26Z |
| Kiểm từng chu kỳ | Ba phiên Trace Core hợp lệ A, C, D (mỗi phiên 555 chu kỳ, 18 biến, 0 mẫu rơi, nhịp 99,93–100,08 ms): **1 665 chu kỳ, 0 vi phạm**. Thứ tự 9 bước đúng. Mỗi chế độ con xuất hiện trọn vẹn: OFF 123, STAGGER 222, CHASE 122, BLINK 102, MANUAL 82, TEST 122, PULSE 82, STAGING 402 chu kỳ. STAGING lên 9 bậc rồi về 3, không lỗ, đổi bậc cách 11–13 chu kỳ. Phiên B là dữ liệu poll thưa, không dùng (DO16-O3) |
| Sau cùng | Program `missedRelease` 0, `faultCount` 0, chạy 55–67 µs; task 0 overrun, jitter tối đa 66 µs |

## Trạng thái sau khi làm (11:25Z)

- Active Revision `5d2ae6c4…` gồm `PRG_DO16_MODBUS` (**RUNNING**, 100 ms) và `DEMO_1` (DISABLED, như trước).
- VP lệnh về trạng thái nghỉ: `DO16_MODE=0`, mask 0, khoá 0, bước 1 s, nhu cầu 0, nút FALSE, chạy ngược FALSE, cho phép TRUE. 16 DO đều 0, không override.
- `VP1` và cấu hình Modbus (revision 40) không đổi.
- Web chạy `c71616de…` (PR #795). Core, iobus, FE và tool ST vẫn là RC `f86150e3`.

**Cập nhật 14:10Z:** Active `a0f107fa…` (bản 1.3). `PRG_DO16_MODBUS` RUNNING ở **AUTO** (`DO16_MODE = 10`). 11/11 POU trùng byte với hướng dẫn bản 1.3. Sau mất điện hoặc khởi động lại, `DO16_MODE` về 0 (OFF): muốn tự chạy AUTO lại thì đổi "Sau khởi động lại" của VP này sang "Giữ giá trị cuối".

**Cập nhật sau kiểm từng chu kỳ (13:52Z):** Active `9b40a15e…` (bản 1.2, không còn `DEMO_1` do người dùng gỡ). `PRG_DO16_MODBUS` RUNNING, `missedRelease` 0, `faultCount` 0. Draft sạch. VP lệnh ở trạng thái nghỉ, 16 DO = 0, không override. Bus 4/4 online, 0 lỗi. 11/11 POU của `9b40a15e` trùng byte với mã trong hướng dẫn bản 1.2.

## Hoàn tác

- **Tắt chương trình:** Disable `PRG_DO16_MODBUS` ở Runtime & Bảo trì. 16 DO về giá trị an toàn 0 (đo ở T12).
- **Tắt AUTO:** đặt `DO16_MODE = 0`. **Quay về bản 1.2 (không có AUTO):** Khôi phục Revision `9b40a15e…`.
- **Quay về bản 1.1:** Khôi phục Revision `104ded61…` (bản người dùng Commission lúc 13:29Z, có lỗi DO16-F3).
- **Bỏ chương trình khỏi Active:** trước đợt này Project chưa có Revision Active nào, nên không có "bản trước khi cài" để Khôi phục. Muốn gỡ hẳn thì Commission một Revision không chứa `PRG_DO16_MODBUS`.
- **Trả web về RC:** chép `mkddc-web` trong thư mục sao lưu vào `/opt/mkddc-web/mkddc-web`, rồi khởi động lại `mkddc-web-pi`, `mkddc-reload-helper`, `mkddc-time-helper`. Kiểm `/proc/<MainPID>/exe` của cả ba ra `0ba384e1…`. Lưu ý: web RC sẽ Check FAILED với các VP `integer`/`multistate` của chương trình này (DO16-F2).

## Chưa chạy (NOT RUN)

- Đo điện tại tiếp điểm relay: không có dụng cụ đo. PASS ở trên là lệnh FC05 được ACK và giá trị coil đọc lại.
- Chạy dài (soak) cho Program này.
