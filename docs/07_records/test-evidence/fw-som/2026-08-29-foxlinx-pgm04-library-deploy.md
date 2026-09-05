# Foxlinx — deploy PGM-04 Control Library WP-03/WP-04 (2026-08-29)

| Thuộc tính | Giá trị |
|---|---|
| Bo | `SOM-DDC-24-foxlinx` — `root@mekong-fac.ddns.net:2223` |
| Nền tảng | Linux OK1126B-buildroot 6.1.141 aarch64; `/` còn 7,4 GB |
| Task | `PLAN-FE-PGM-061` / `T61-506` |
| Authority | [`AUTH-PROG-2026-08-29-PGM04-003`](../../reviews/AUTH-PROG-2026-08-29-PGM04-003.md) |
| Mức bằng chứng | **TARGET** cho §3–§4; HOST cho các cổng dựng |

## 1. Phạm vi — hai tầng

| Thành phần | Nguồn | Đích | SHA-256 |
|---|---|---|---|
| BE (Go) | `CGO_ENABLED=0 GOARCH=arm64 go build ./cmd/mkddc-web` | `/opt/mkddc-web/mkddc-web` | `0aae9167155df505d33152a1c3b5bee0004f5950afc7db45e4f65eb79e88c54e` |
| FE | `build/web-ui/dist` (`npm run build:release`) | `/opt/mkddc-web/dist` | `index-BqtRYhH5.js` / `programming-C_ZkwlZA.js` |

**Không** đụng `mkddc-core`, `mkddc-iobus`, `mkddc-netcfg`, `mkddc-hmi`: lát này
không sửa lớp nào trong số đó. PGM-04 không đọc/ghi điện vật lý.

Sao lưu trước khi thay: `/opt/mkddc-web/mkddc-web.bak-pgm04-20260829T085228Z` và
`/opt/mkddc-web/dist.bak-pgm04-20260829T085228Z`. Rollback = đổi ngược hai
đường dẫn rồi `systemctl restart mkddc-web-pi`; contract là additive nên FE cũ
đọc được BE mới, và chiều ngược lại chỉ mất hai trường trình bày.

## 2. Hai bẫy đã kiểm trước khi copy

- **`GLIBCXX`**: không áp dụng — chỉ có binary Go, `CGO_ENABLED=0` nên static.
- **Cờ Programming là build-time**: FE dựng bằng `npm run build:release`
  (`VITE_PROGRAMMING_REV_A=1`). Xác nhận **trên bo**, không suy từ lệnh đã chạy:
  `grep -c "Chèn vào POU" /opt/mkddc-web/dist/assets/programming-*.js` = 1 và
  `grep -c "Khối đang chọn" …` = 1 — hai chuỗi chỉ tồn tại trong lát này.

## 3. Kiểm chứng sau deploy — mức TARGET

Năm service `active`: `mkddc-fakemcu`, `mkddc-iobus`, `mkddc-core`,
`mkddc-netcfg`, `mkddc-web-pi`.

`GET /api/v1/health` → `core: ok`, `io_shm: ok`, `iobus: ok`,
`mcu_connection: ok`, `plc_shm: ok`, `web: ok`.

FE đúng bản: `index.html` trên bo trỏ `assets/index-BqtRYhH5.js` — trùng khít
bản dựng cục bộ; chunk `programming-C_ZkwlZA.js` trả `200`, 646 943 byte.

## 4. Đường ghi metadata: ba đầu dò, ZERO MUTATION

Bo đang chạy một Project thật có Draft `dirty` và có phiên người dùng khác đang
duyệt. Nên phép kiểm target ở đây cố ý **không tạo và không sửa dữ liệu nào**:
cả ba đầu dò đều là request bị TỪ CHỐI hoặc chỉ đọc.

| Đầu dò | Request | Kết quả | Nó chứng minh gì |
|---|---|---|---|
| A | upsert mang `category` + `description`, `If-Match` cố tình sai | **409** `PRG-ERR-CONFLICT-001` | Bộ giải mã ĐỌC ĐƯỢC hai trường mới rồi mới dừng ở cổng ETag |
| B | cùng payload nhưng thêm field lạ `tags` | **400** | Strict decode còn nguyên — nên 409 ở A thật sự nghĩa là hai trường kia nay là field ĐÃ BIẾT, không phải strict decode bị nới |
| C | `GET /libraries?category=timer` | 3 khối: `TOF`, `TON`, `TP` — đều có `category` và `signature` | Đường đọc + lọc chạy trên bo; thẻ khối sẽ có chữ ký thật |
| D | `GET /libraries?q=PROBE_PGM04` | **0 khối** | Không đầu dò nào để lại dấu vết |

Cặp A+B là phần đáng đọc: **một mình A không kết luận được gì**. Binary cũ cũng
trả 4xx cho payload đó — nhưng là `400` vì field lạ. Chỉ khi B xác nhận field lạ
VẪN bị `400` thì `409` của A mới có nghĩa "hai trường mới đã được nhận".

## 5. Hồ sơ này KHÔNG nói gì

- **Không** phải Test Result chính thức; **không** đổi `RELEASE_READY` (vẫn `NO-GO`).
- **Không** phải bằng chứng HIL: không có phép đo điện nào ở đây, và PGM-04 không
  có đường tới I/O vật lý.
- **Không** kiểm chứng đường ghi metadata bằng một lần ghi THẬT trên bo: làm thế
  đòi tạo một Project mới, mà API không có route xoá Project — một lần tạo là
  một hàng dữ liệu vĩnh viễn trên thiết bị của người khác. Lần ghi thật đã được
  kiểm ở lane real-backend host (`T61-504`) với cùng binary Go và cùng migration.

## 6. Bổ sung 2026-09-06 — diễn tập rollback thật `ISS-PGM04-19`

### 6.1 Preflight và phạm vi tác động

Lượt này chạy trên đúng bo `OK1126B-buildroot`, Linux 6.1.141 aarch64. RootFS
dùng 47%, `/userdata` dùng 6%. `mkddc-fakemcu` đang `active/enabled`, còn
`mkddc-pty` `inactive/disabled`; vì vậy đây là TARGET dùng FakeMCU, không phải
HIL hay bằng chứng I/O vật lý.

DB Programming ở schema 15 có 18 Project, 1 Project đang hiện, 18 Draft, 12
program intent muốn bật, 1 program read-back `RUNNING` và 0 simulation session.
Để không làm gián đoạn program đang chạy, diễn tập chỉ thay
`/opt/mkddc-web/mkddc-web` và `/opt/mkddc-web/dist`, chỉ restart
`mkddc-web-pi`; PID và `NRestarts=0` của Core/IOBus/FakeMCU được pin trước thao
tác và giữ nguyên qua mọi pha. Các phiên Web quan sát sau lượt kiểm đều thuộc
vai `admin`; chính các lần đăng nhập chỉ đọc của lượt kiểm cũng tạo session, nên
không dùng số session đó để suy ra có hay không người dùng khác ở preflight.

### 6.2 Artifact, backup và chu kỳ sạch

| Mục | Giá trị read-back |
|---|---|
| Bản trước rollback | `b7c3937bc37e02a6eaa1bdbf6d6a017a146af1cb`; binary SHA-256 `f185688e0656361049889df84a8ea91972dc25121ac049fc3d80c0723ad16909` |
| Candidate/redeploy | `ad8c322ea46de0ac0da8a7c24004b3683856b3da`; binary SHA-256 `e28b4e9d4ad3b36654476f3c0e2882008376b70aa5013ea9c607ee0d25db3a5e` |
| Gói truyền lên bo | `fb9f762097c74392ce131e3c7a2f3761314801b1c3d578a8ec097f71231b7083`; toàn bộ 17 file trong manifest `OK` |
| FE candidate | `index-Cb7SV8CW.js`; `programming-DJZh2u4u.js`, 546.896 byte, SHA-256 `553ad9d52b7f02784bd69a94141fe38e199ee21cff05a3f58e647de93b7a7bad` |
| Backup có thể đọc lại | `/opt/mkddc-backups/iss-pgm04-19-20260905T180546Z/` |
| DB backup online | `programming-v1.before.sqlite`, `PRAGMA quick_check=ok`, SHA-256 `3ab869ef65a086c324e3cc3207c8d0193e9beb3b1a78c706b5ce8f6aa370b375` |

Chu kỳ đạt là `candidate → rollback b7c3937b → candidate ad8c322e`. Cả lệnh
rollback và redeploy cuối đều **exit 0**. Mỗi phía khớp toàn bộ checksum binary
và cây `dist`; Web bind lại sau khoảng 14 giây, `mkddc-web-pi` trở về
`active/running`, `NRestarts=0`, journal mức `err` từ lúc start có 0 dòng.

Lần script đầu có hai lỗi ở chính harness sau khi artifact đã đổi thành công:
một `find` trỏ vào tên thư mục cũ và một phép kiểm coi dòng `-- No entries --`
của `journalctl` là lỗi. Hai lỗi này không được dùng làm PASS; chu kỳ sạch phía
trên đã chạy lại sau khi sửa path và dùng `journalctl -q`, với cả hai lệnh cuối
exit 0.

### 6.3 Dữ liệu, API và browser read-back

- DB live trả `PRAGMA quick_check=ok` ở trước, rollback và redeploy. Fingerprint
  có thứ tự của toàn bộ Project + Draft ID/ETag/content SHA-256 giữ nguyên; 18
  Project, 1 visible, 18 Draft và program `RUNNING` đều còn sau lượt cuối.
- Ở candidate, rollback và redeploy, `/api/v1/health` đều trả `status=ok`, đủ
  sáu check `core/io_shm/iobus/mcu_connection/plc_shm/web`. API thư viện lọc
  `category=timer` đều đọc lại đúng `TOF`, `TON`, `TP`, cùng `category` và
  `signature`.
- Chrome 1440×900 ở bản rollback đọc được `RelayPattern32 / Đang chạy`; bản cuối
  mở scope SYSTEM và render đủ `TOF/TON/TP`. Cả hai lượt có 0 Console error,
  0 request failed/HTTP 5xx và không tràn ngang. Ảnh:
  [`rollback`](2026-09-06-pgm04-rollback-clean.png),
  [`redeploy`](2026-09-06-pgm04-redeploy-library.png).
- Raw log không chứa token/mật khẩu nằm cùng backup trên bo. SHA-256 log chu kỳ
  sạch: rollback `78a9ffe15052402634e122d819bc5ded72b91490114638a86a6d61320ee6aa9d`,
  redeploy `1e2b34fd2215db0e5a71a0ca7ef272fcd49485a27a04a6553a7bce202afb8a95`.

### 6.4 Verdict và ranh giới

Phần thi hành TARGET của `VS-PGM04-61-014` **PASS**. Evidence vẫn chờ reviewer
độc lập theo điều kiện đóng của `ISS-PGM04-19`; trước review không đổi risk sang
`CLOSED`. `RELEASE_READY` tiếp tục `NO-GO`; lượt này không Commission, Enable,
ghi output hay đo điện, và không được nâng thành HIL/release PASS.
