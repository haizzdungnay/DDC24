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
