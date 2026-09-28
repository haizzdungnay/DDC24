# Gom coil liền kề thành FC15 theo thiết bị — đo trên bo Foxlinx

**ID:** EV-MB-FC15-20260927
**Ngày đo:** 2026-09-27 (kiểm lại chỉ đọc 2026-09-28)
**Trạng thái:** U-07 **PASS** theo điều kiện đóng của `REC-DDC-FIELD-USE-20260927`: 16 DO đổi trong **2 giao dịch FC15** (13/13 loạt), lệch hai module **30 ms** = một giao dịch, 0 lỗi. U-18 **PASS** ở lớp API và giao diện trên bo. Relay vật lý **NOT RUN**: chưa đo điện tại tiếp điểm, nên đây không phải HIL.
**Finding:** [`REC-DDC-FIELD-USE-20260927`](../../reviews/DDC24_FIELD_USE_UPGRADE_FINDINGS_2026-09-27.md) U-07 (Modbus ghi từng coil) và U-18 (Frame Monitor thiếu giá trị ghi).
**Nhánh:** `fix/modbus-fc15-batch-20260927` — iobus `cdc198be`, web-api `df8dd91d`, FE `b66db421` + `39fb5056`.
**Đích:** `OK1126B-buildroot` (Forlinx OK1126B-S), `mekong-fac.ddns.net`, web `:8082`, bus `rs485-1` 9600 8N1, 4 slave: CK508-04, CK508-05 (relay 8 kênh), CK509-06, CK509-07.
**Tải thử:** Program `PRG_DO16_MODBUS` bản 1.3 ([`GUIDE-PROG-ST-DO16-001`](../../../06_operations/PROGRAMMING_ST_DO16_MODBUS_GUIDE.md)) chạy **AUTO** trên Revision Active `a0f107fa…`. Không đổi Program, Revision hay Virtual Point nào trong đợt đo.
**Lớp bằng chứng:** TARGET (khung Modbus do iobus ghi nhận, bộ đếm chẩn đoán, giao diện web trên bo). Thời lượng khung là `elapsedUs` của lời gọi libmodbus, không phải máy phân tích dây.

## 1. Mục tiêu

- Xác nhận trên bus thật rằng bật `coil_write_batch_max` cho hai module CK-508 làm 16 DO đổi cùng lúc lên dây thành 2 giao dịch FC15 thay vì 16 FC05, và CK-508 chấp nhận FC15 (không exception, không timeout).
- So cùng một Program, cùng bus, trước và sau khi bật, bằng cùng một cách đo.
- Xác nhận khung ghi mang giá trị đã phát (`values`) và Frame Monitor hiện được giá trị đó.

## 2. Bản chạy trên bo

| Thành phần | sha256 (`/proc/<MainPID>/exe`) | Nguồn |
|---|---|---|
| `mkddc-iobus` | `4f025db4c93a3ee3…` | build `aarch64` từ `b66db421` (gồm iobus `cdc198be`) |
| `mkddc-web` (`mkddc-web-pi`) | `d6d3b2cb186c7240…` | build từ `b66db421` + merge PR #795 (`9e658628`) |
| FE (`/opt/mkddc-web/dist`) | `index.html` `797bb872f0b2a07a…` | build release của nhánh này gồm `39fb5056`, thay lúc 16:09Z (sau hai cửa sổ đo) |
| `mkddc-core` | `9621cb52fea6f0fe…` | RC `main@f86150e3`, không đổi |

Health báo `version = dev-u07-u18-with-pr795`. `mkddc-iobus` và `mkddc-web-pi` khởi động lúc 2026-09-27 15:54:31Z và giữ nguyên PID tới lần kiểm lại 2026-09-28 03:00Z, `NRestarts = 0`.

## 3. Cách đo

- **Nguồn dữ liệu:** `GET /api/v1/modbus/frames?limit=200` (vòng nhớ khung của iobus qua web), gọi mỗi 1 s. Một giây bus 9600 chứa tối đa khoảng 40 khung, nên 200 khung mỗi lần đọc không để lọt khung nào. Khử trùng lặp theo `(at, bus, slave, fc, addr, count, attempt, elapsedUs)` rồi ghi NDJSON.
- **Loạt ghi:** các khung ghi (FC05/06/15/16) nằm trong cùng một đợt bận của dây; đợt bận kết thúc khi dây rảnh quá 15 ms (Program chạy 100 ms, nên hai lần đổi đầu ra liên tiếp luôn cách nhau một khoảng rảnh). **Loạt 16 DO** là loạt ghi đủ 8 coil của slave 4 và 8 coil của slave 5. Trong AUTO, loạt 16 DO chỉ xuất hiện ở đoạn BLINK (đảo pha lẻ/chẵn mỗi 1 s, 10 s mỗi vòng 137 s).
- **Chỉ số:** số giao dịch ghi của hai module trong loạt; thời gian loạt (đầu khung ghi đầu → cuối khung ghi cuối); lệch kết thúc giữa hai module; chiếm dây trong 1 s kể từ đầu mỗi loạt (tổng `elapsedUs` mọi khung bắt đầu trong cửa sổ, chia 1 000 ms).
- **Công cụ và dữ liệu thô** (chạy lại được):

| File | sha256 |
|---|---|
| [`fixtures/2026-09-27-fc15-analyze_frames.py`](fixtures/2026-09-27-fc15-analyze_frames.py) | `184c1f78acbb6b10…` |
| [`fixtures/2026-09-27-fc15-off.ndjson.gz`](fixtures/2026-09-27-fc15-off.ndjson.gz) — 1 569 khung | `0a1a03c27a411609…` |
| [`fixtures/2026-09-27-fc15-on.ndjson.gz`](fixtures/2026-09-27-fc15-on.ndjson.gz) — 1 260 khung | `7676e66c1c5baa45…` |

```bash
cd docs/07_records/test-evidence/modbus/fixtures
python3 2026-09-27-fc15-analyze_frames.py 2026-09-27-fc15-off.ndjson.gz
python3 2026-09-27-fc15-analyze_frames.py 2026-09-27-fc15-on.ndjson.gz
# bỏ khung phát trước khi cấu hình mới có hiệu lực: kết quả loạt 16 DO y hệt
FROM_UTC=2026-09-27T15:57:59.568Z python3 2026-09-27-fc15-analyze_frames.py 2026-09-27-fc15-on.ndjson.gz
```

## 4. Nhật ký theo thời gian (UTC)

| Thời điểm | Bước | Kết quả |
|---|---|---|
| 2026-09-27 15:53:41 | Chụp trạng thái trước | Health 6/6 `ok`; 4/4 thiết bị trên `rs485-1`, chưa thiết bị nào có `coil_write_batch_max`; Active `a0f107fa…` |
| 15:54:18–15:54:31 | Sao lưu rồi cài iobus + web + FE của nhánh | Sao lưu ở `/data/mkddc/deploy-backups/2026-09-27T1554Z-fc15-u07-u18/`: `mkddc-iobus` `96a0feea…` (RC), `mkddc-web` `c71616de…` (PR #795), `dist.tgz`, `fieldbus.conf`, `profiles/`, `programming-v1.sqlite` |
| 15:55:03–15:57:45 | **Cửa sổ TẮT** (mặc định, mọi thiết bị) | Khung từ 15:54:54.702 tới 15:57:44.088 |
| 15:57:59.2–15:57:59.6 | `PUT /api/v1/modbus/devices/CK508-04` rồi `CK508-05` với `coil_write_batch_max = 8` | `apply.result = success`, `reload = control` (không restart iobus), `warnings = null`, revision 41 rồi 42 |
| 15:58:13–16:01:05 | **Cửa sổ BẬT** (CK508-04/05) | Khung từ 15:57:59.140 tới 16:01:04.002. 17 khung đầu (tới 15:57:59.568) phát trước khi revision 42 có hiệu lực; bỏ chúng thì kết quả loạt 16 DO không đổi |
| 16:09:52 | Thay FE bằng bản có `39fb5056` | Khối "Khung truyền gần nhất" hiện cả khi mọi thiết bị đã được poll |
| 2026-09-28 03:00–03:10 | Kiểm lại, **chỉ đọc** | Mục 7 |

## 5. Kết quả trước và sau

| Chỉ số | TẮT (FC05 từng coil) | BẬT (`coil_write_batch_max = 8`) |
|---|---|---|
| Khung trong cửa sổ | 1 569 trong 169,4 s: ghi 550, đọc 1 019, **0 lỗi** | 1 260 trong 184,9 s: ghi 138, đọc 1 122, **0 lỗi** |
| Loạt 16 DO | 22 | 13 |
| Giao dịch ghi mỗi loạt 16 DO | trung vị **16** (20 loạt là 16, 2 loạt là 20 do rời BLINK trong cùng đợt bận) | **2** ở cả 13/13 loạt: FC15 × 8 coil cho mỗi module |
| Thời gian loạt | trung vị **458,8 ms** (454,6–573,6) | trung vị **61,1 ms** (60,1–62,4) |
| Lệch kết thúc giữa hai module | trung vị **229 ms** (116–256) | trung vị **30 ms** (30–32) |
| Chiếm dây 1 s từ đầu loạt, mọi khung | trung vị **63,1 %** (61,1–73,2) | trung vị **22,2 %** (21,9–44,9) |
| Chiếm dây 1 s từ đầu loạt, chỉ khung ghi | trung vị **46,1 %** (45,3–57,3) | trung vị **6,1 %** (6,0–29,0) |
| Thời lượng một khung ghi | FC05: trung vị 28,9 ms | FC15 × 8: trung vị 30,3 ms |
| Khoảng cách giữa hai loạt BLINK | trung vị 1 077,7 ms (917–…) | trung vị 1 000,0 ms (999,9–…) |

Loạt mẫu ở giữa mỗi cửa sổ:

```text
TẮT: +0.0 ms  slave 4 FC05 addr 0 [0] … +200.6 ms slave 4 FC05 addr 7 [0]
     +231.5 ms slave 5 FC05 addr 0 [0] … +432.7 ms slave 5 FC05 addr 7 [0]   (16 giao dịch)
BẬT: +0.0 ms  slave 4 FC15 addr 0 count 8 [0,1,0,1,0,1,0,1]  31.1 ms
     +31.0 ms slave 5 FC15 addr 0 count 8 [0,1,0,1,0,1,0,1]  30.1 ms   (2 giao dịch)
```

Giá trị lớn nhất 44,9 % / 29,0 % ở cột BẬT là cửa sổ 15:59:54Z, lúc AUTO rời BLINK: sau cặp FC15 còn 8 lệnh FC05 nhả coil 0, 2, 4, 6 của mỗi module. Bốn coil này **không liền kề**, nên theo thiết kế chúng đi riêng: gom qua khoảng trống sẽ ghi đè coil 1, 3, 5, 7 mà Program không ra lệnh.

## 6. Điều kiện đóng U-07 và U-18

| Điều kiện | Kết quả đo | Kết luận |
|---|---|---|
| U-07: 16 DO đổi trong ≤ 2 giao dịch | 13/13 loạt 16 DO đúng 2 giao dịch FC15 | **PASS** |
| U-07: lệch giữa hai module ≤ 1 giao dịch | 30–32 ms; một giao dịch FC15 × 8 mất 30,1–31,1 ms | **PASS** |
| U-07: thiết bị chấp nhận FC15 | 0/138 khung ghi lỗi, 0 lần phát lại (`attempt = 1`); bộ đếm `write_failed = 0`, `write_dropped = 0` cho cả 4 thiết bị sau khoảng 11 h (mục 7) | **PASS** |
| U-07: thiết bị chưa bật giữ nguyên hành vi | CK509-06/07 không có `max_coils_per_write` trong profile; cửa sổ TẮT toàn FC05 `count = 1` | **PASS** |
| U-18: khung ghi mang giá trị đã phát | 550/550 (TẮT) và 138/138 (BẬT) khung ghi có `values` đủ `count` phần tử; 0 khung đọc có `values` | **PASS** |
| U-18: Frame Monitor hiện giá trị | Mục 7: cột "Written value" trên bo hiện `0 1 0 1 0 1 0 1` cho FC15, `—` cho khung đọc | **PASS** |

## 7. Kiểm lại chỉ đọc (2026-09-28)

| Hạng mục | Kết quả |
|---|---|
| Dịch vụ (03:00Z) | `mkddc-iobus`, `mkddc-web-pi`, `mkddc-core` active; hash như mục 2; iobus/web cùng PID từ 15:54:31Z, `NRestarts = 0` |
| Cấu hình | `fieldbus.conf` revision 42; `profiles/CK508-04.json` và `CK508-05.json` có `"max_coils_per_write": 8`; CK509-06/07 không có khoá |
| Bộ đếm chẩn đoán (`GET /api/v1/modbus/diagnostics`) | 4/4 thiết bị: `total_errors`, `timeout_errors`, `crc_errors`, `write_failed`, `write_dropped`, `consecutive_errors` đều 0 |
| Khung gần nhất (03:06Z, 200 khung) | Ghi: FC15 × 8 (slave 4 và 5), FC15 × 2, FC05 lẻ; 0 lỗi |
| Giao diện, Chrome thật qua Chrome DevTools MCP (03:09Z) | Trang Thiết bị hiện `FC15×8` ở CK508-04 và CK508-05, không ở CK509. Trang Chẩn đoán có khối "Recent transactions" dù cả 4 thiết bị đều đang liên lạc (lỗi `39fb5056` sửa); bảng 200 khung có cột "Written value": 47 khung ghi hiện bit (`0 1 0 1 0 1 0 1` / `1 0 1 0 1 0 1 0`), 153 khung đọc hiện `—`; bảng `min-width` 840 px. Lane Chrome kiểm trước bằng `scripts/verify-project.sh --component browser`: PASS 7 phép kiểm |

## 8. Giới hạn

- Không đo điện tại tiếp điểm relay. PASS ở đây là lệnh FC15 được slave ACK và giá trị đọc lại qua FC01; lệch 30 ms là lệch giữa hai **lệnh**, chưa gồm thời gian đóng cơ khí của relay.
- Thời lượng khung là thời gian lời gọi libmodbus trên SOM (gồm chờ phản hồi), không phải phép đo bằng máy phân tích dây.
- FC15 mới được xác nhận trên CK-508 ở 9600 8N1. Thiết bị khác phải kiểm datasheet trước khi bật; thiết bị không hỗ trợ trả exception 0x01 cho mọi lệnh đã gom, iobus log `write_group_fail … thiết bị KHÔNG hỗ trợ FC15?` và bỏ lệnh sau 3 lần thử. Đường lỗi này được kiểm bằng test PTY trên host (`CoilBatchWire.ThietBiTuChoiFc15BaoRejectedKemMaException`), chưa tạo lỗi thật trên bo.
- Coil không liền kề vẫn đi FC05 từng coil (mục 5), đúng thiết kế.
- Program vẫn giữ BLINK tối thiểu 1 s và bước tối thiểu 0,5 s vì mặc định iobus vẫn là FC05; bản đo này không nới giới hạn của Program.
- Cửa sổ đo ngắn (khoảng 3 phút mỗi bên, 22 và 13 loạt 16 DO); chạy dài chỉ có số liệu bộ đếm ở mục 7.

## 9. Tắt lại FC15

- **Giao diện:** Modbus RTU → Thiết bị → Sửa CK508-04 (và CK508-05) → bỏ chọn "Ghi nhiều coil một lần (FC15)" → Lưu → Áp dụng.
- **API:** `PUT /api/v1/modbus/devices/<id>` với `coil_write_batch_max` bằng `0` (hoặc `1`). Web ghi lại profile không có `max_coils_per_write`, iobus nạp qua kênh điều khiển, không restart. Từ khung kế tiếp, mọi coil của thiết bị đó đi FC05 như cửa sổ TẮT.

## 10. Rollback bản cài

1. Tắt FC15 cho CK508-04/05 như mục 9 **trước**, để profile không còn khoá mà bản cũ không hiểu, và web cũ không phải đọc trường mới.
2. Chép `mkddc-iobus` (`96a0feea…`, RC) và `mkddc-web` (`c71616de…`, PR #795) từ `/data/mkddc/deploy-backups/2026-09-27T1554Z-fc15-u07-u18/` vào chỗ cũ, giải nén `dist.tgz` vào `/opt/mkddc-web/dist`.
3. Khởi động lại `mkddc-iobus`, `mkddc-web-pi`, `mkddc-reload-helper`, `mkddc-time-helper`; so `/proc/<MainPID>/exe` của cả bốn với hash ở bước 2.
4. Kiểm `/api/v1/health`, `/api/v1/points` và Frame Monitor: 16 DO trở lại FC05.

Chưa diễn tập rollback này trên bo.

## Lịch sử sửa đổi

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-09-28 | Tạo hồ sơ từ hai cửa sổ đo ngày 2026-09-27 và lần kiểm lại chỉ đọc ngày 2026-09-28; số liệu tính lại từ NDJSON kèm theo |
