# Foxlinx — deploy Plan 60 đủ bốn tầng (2026-08-24)

| Thuộc tính | Giá trị |
|---|---|
| Bo | `SOM-DDC-24-foxlinx` — `root@mekong-fac.ddns.net:2223` |
| Nền tảng | Linux OK1126B-buildroot 6.1.141 aarch64, `/` còn 7,7 GB |
| Nhánh nguồn | `feat/plan60-pgm01` |
| Mức bằng chứng | **TARGET** cho mục §3; HOST cho các cổng dựng |
| Người thi hành | CTIO Plan 60 |

## 1. Phạm vi — bốn tầng, một lần

Deploy đồng thời cả bốn thành phần vì Plan 60 đụng cả bốn; deploy lẻ sẽ để bo ở
một trạng thái lai mà không ai kiểm được.

| Thành phần | Nguồn | Đích trên bo |
|---|---|---|
| FW SOM (Core C++) | `build/fw-aarch64/core/mkddc-core` | `/usr/sbin/mkddc-core` |
| IO bus | `build/fw-aarch64/iobus/mkddc-iobus` | `/usr/sbin/mkddc-iobus` |
| Fake MCU | `build/fw-aarch64/iobus/fake_mcu` | `/usr/sbin/mkddc-fake-mcu` |
| Netcfg | `build/fw-aarch64/netcfg/mkddc-netcfg` | `/usr/sbin/mkddc-netcfg` |
| BE (Go) | `apps/web-api/cmd/mkddc-web` | `/opt/mkddc-web/mkddc-web` |
| FE | `build/web-ui/dist` (`npm run build:release`) | `/opt/mkddc-web/dist` |

Bản đang chạy được sao lưu trước khi thay, hậu tố `.prev-plan60-20260824T105735`.

## 2. Hai bẫy đã kiểm trước khi copy

- **`GLIBCXX`**: bo chỉ có tới `3.4.30`. Đo ký hiệu cao nhất của từng binary:
  `mkddc-core` **3.4.29**, `mkddc-iobus` **3.4.29**, `mkddc-netcfg` **3.4.29**,
  `fake_mcu` **3.4.21**. Go build `CGO_ENABLED=0` nên **static**, không phụ
  thuộc glibc. Không binary nào chạm trần.
- **Cờ Programming là build-time**: FE dựng bằng `npm run build:release`
  (`VITE_PROGRAMMING_REV_A=1`), không phải `npm run build`. Đã xác nhận bằng
  cách grep chuỗi mới trong bundle **trên bo**, không suy từ lệnh đã chạy.

`mkddc-hmi` **không** cross-build được: máy dev thiếu `libfreetype`/`libdrm` bản
aarch64. HMI ngoài phạm vi Plan 60 và bản cũ trên bo vẫn chạy, nên không chặn.
Muốn dựng cả HMI thì phải cài hai gói cross đó lên máy dev.

## 3. Kiểm chứng sau deploy — mức TARGET

Toàn bộ năm service `active`: `mkddc-fakemcu`, `mkddc-iobus`, `mkddc-core`,
`mkddc-netcfg`, `mkddc-web-pi`.

`GET /api/v1/health` → `core: ok`, `io_shm: ok`, `iobus: ok`,
`mcu_connection: ok`, `plc_shm: ok`.

**FE đúng bản**: `index.html` trên bo trỏ `assets/index-DPr3piBt.js` — trùng
khít hash bản dựng cục bộ. Bundle `programming-O6gUJkLs.js` chứa `Việc cần chú ý`
(`T60-204`), `Thoát Lập trình` (`T60-101`), `Chưa đọc được từ Core` (`T60-205`).

**`T60-015` chạy thật trên bo** — `GET /api/v1/programming/projects`:

```json
{"projectId":"b5f7cdc3-...","dirty":false,"draftSequence":1,"activeSequence":null}
```

`activeSequence` là `null` chứ không phải `0` — đúng hợp đồng: chưa Commission
thì không có số hiệu, và `0` sẽ đọc như một sự thật.

**`T60-013` chạy thật trên bo** — `GET /projects/{id}/programs`:

```json
{"schemaVersion":"1.0","projectId":"b5f7cdc3-...","runtimeStateSource":"UNAVAILABLE",
 "observedAt":null,"programsTruncated":null,"items":[]}
```

Đây là **nhánh (b) của mốc M2 ở mức TARGET**: Core không đọc được Program ⇒
`UNAVAILABLE` và **mọi** số đo `null`, không một giá trị cũ nào được trình bày
như thể đang sống.

## 4. `T60-303` — NOT_RUN, kèm lý do kỹ thuật và runbook

Nhánh (a) của M2 (`CORE_LIVE` kèm số đo thật) **chưa lấy được trên bo**, vì
Commission không chạy tới đích:

```
impact.activeOverrides = UNAVAILABLE — không ack một nhóm không đọc được
```

Đọc `GET /revisions/none/changes/{revisionId}` cho thấy `activeOverrides` và
`cutover` đều `UNAVAILABLE`; cả hai nhóm này đọc từ Core runtime, mà Core đang
`targetState: UNAVAILABLE` (`programming_mode=graph_only`, `activeRevisionId:
null`). Script soak fail-closed đúng: ack một nhóm không đọc được là ký vào chỗ
trống.

**Đây KHÔNG phải hồi quy do Plan 60.** Bằng chứng: `journalctl -u mkddc-core`
trong khoảng `2026-08-23 00:00` → `2026-08-24 03:00` (tức **trước** lần deploy
này) có **0 dòng** `programming_mode=st`, và mọi Project trên bo đều
`activeRevisionId: null`. Bo chưa từng có Active revision kể từ trước khi thay
binary.

**Điều kiện để mở khoá `T60-303`**: đưa Core lên `targetState: READY` với một
artifact ST đã activate. Runbook:

```bash
ssh -L 18081:127.0.0.1:8081 SOM-DDC-24-foxlinx     # tunnel
python3 scripts/target_soak_10program.py --base http://127.0.0.1:18081 setup
python3 scripts/target_soak_10program.py --base http://127.0.0.1:18081 commission
# rồi đọc bảng Programs:
curl -H "Authorization: Bearer $TOK" \
  http://127.0.0.1:18081/api/v1/programming/projects/$PID/programs
```

**Acceptance khi chạy được**: `runtimeStateSource = CORE_LIVE`, `observedAt` có
giá trị, và mỗi item mang `periodMs` / `lastRunAtUtc` / `health` thật của Core.

## 5. Rollback

```bash
systemctl stop mkddc-web-pi mkddc-core mkddc-iobus mkddc-fakemcu
for b in mkddc-core mkddc-iobus mkddc-netcfg mkddc-fake-mcu; do
  install -m 0755 /usr/sbin/$b.prev-plan60-20260824T105735 /usr/sbin/$b
done
install -m 0755 /opt/mkddc-web/mkddc-web.prev-plan60-20260824T105735 /opt/mkddc-web/mkddc-web
rm -rf /opt/mkddc-web/dist && cp -a /opt/mkddc-web/dist.prev-plan60-20260824T105735 /opt/mkddc-web/dist
systemctl start mkddc-fakemcu mkddc-iobus mkddc-core mkddc-web-pi
```
