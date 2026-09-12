# Foxlinx — deploy `WEB-HIST-006`: khởi động lại không còn báo mất bucket vẫn lấy được (2026-09-05)

| Thuộc tính | Giá trị |
|---|---|
| Bo | `SOM-DDC-24-foxlinx` — `root@mekong-fac.ddns.net:2223` |
| Nền tảng | Linux OK1126B-buildroot aarch64; uptime 15 ngày |
| Phạm vi | Web/API (`/opt/mkddc-web/mkddc-web`) + FE (`/opt/mkddc-web/dist`). **Không** đụng Core/IObus/Netcfg |
| Commit | `main` `d1ab0830` (PR #546) trên nền `3cea434a` |
| Mức bằng chứng | **TARGET** cho §3–§5; HOST cho §1 |

Diff `0134bf32..d1ab0830` chỉ chạm `apps/web-api`, `apps/web-ui`, `scripts/`,
`docs/`, `artifacts/` — không file nào thuộc `contracts/`, `apps/core`,
`apps/iobus` hay `platform/`, và không chỗ nào đổi `KX_SHM_MAGIC`. Nên deploy
riêng lớp web ở lát này **không** gây lệch magic SHM với Core/IObus đang chạy.

## 1. Kiểm chứng trên host (sau khi merge `origin/main` vào nhánh)

| Gate | Lệnh | Kết quả |
|---|---|---|
| Go vet | `go vet ./...` | `VET_EXIT=0` |
| Go test | `go test ./... -count=1` | **21/21** package `ok` |
| FE unit | `npx vitest --run --environment jsdom src` | **230/230** file · **2890/2890** test PASS |
| FE lint | `npm run lint` | `LINT_EXIT=0` |
| FE build | `npm run build:release` | `BUILD_EXIT=0`; chunk `programming` 138,38 KiB gzip / ngân sách R3 165,00 KiB (dư 26,62 KiB) |
| Layout | `scripts/verify-project.sh --component layout` | `LAYOUT_EXIT=0` |

Exit code đọc từ dòng `*_EXIT=` ghi trong chính chuỗi lệnh, **không** lấy exit
code của tiến trình cuối đường ống.

Bản FE đưa lên bo dựng bằng `npm run build:foxlinx` (không phải `npm run build`
trần): cờ Programming Rev A là **build-time**. Guard sau khi dựng:
`grep -c REVA_SCOPE_ROADMAP build/web-ui/dist/assets/index-*.js` = **0**, và
kiểm lại trên bo sau khi cài cũng = **0**.

## 2. Sao lưu và đường lùi

```
/opt/mkddc-backups/webhist006-20260905T115428Z/mkddc-web.prev
/opt/mkddc-backups/webhist006-20260905T115428Z/dist.prev/
/opt/mkddc-backups/webhist006-20260905T115428Z/historian-v2.sqlite.prev
/opt/mkddc-web/dist.old                     (dist cũ đổi tên tại chỗ, không xoá)
```

Binary cũ `5db231ea52e1aa099193af778619020107308effa9dd44c86a447d73c817b335`.

## 3. Cài đặt

| Thành phần | Lệnh dựng | Đích | SHA-256 |
|---|---|---|---|
| Web/API | `CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags="-s -w"` | `/opt/mkddc-web/mkddc-web` | `31ee5e9793f78143148a2df88c6e18762cf484fa8c5ad8f6e5e2945d16a5a388` |
| Web UI | `npm run build:foxlinx` | `/opt/mkddc-web/dist` | bundle `assets/index-BBNG7ZEE.js` |

Checksum binary trên bo khớp đúng bản dựng trên host. Bundle mà `GET /` trỏ tới
trên bo trùng tên file với `build/web-ui/dist` trên host.

Mốc thao tác: `systemctl stop mkddc-web-pi` lúc **11:54:40Z**, khởi động lại
**11:54:40Z**, tiến trình mới nghe cổng 8081 lúc **11:54:54Z**.

## 4. Kiểm chứng chính — đối chứng hai lần khởi động lại

Đây là bằng chứng trực tiếp cho `WEB-HIST-006`, đọc từ
`/data/config/historian-v2.sqlite` (bản sao kèm `-wal`):

| Lần khởi động lại | Binary | Dừng → nghe lại | Bucket tại thời điểm sống lại | `last_sample_utc_ms` | Gap `restart` |
|---|---|---|---|---|---|
| `11:07:33Z → 11:07:47Z` | cũ | 14 s | `11:07:45` **không tồn tại** | — | `[11:07:45, 11:08:00)` |
| `11:54:40Z → 11:54:54Z` | mới | 14 s | `11:54:45` **tồn tại**, value 23,412 | `11:54:54Z` | **không có** |

```
UI-01|2026-09-05 11:54:15|2026-09-05 11:54:15|23.928|1
UI-01|2026-09-05 11:54:30|2026-09-05 11:54:30|23.661|1
UI-01|2026-09-05 11:54:45|2026-09-05 11:54:54|23.412|1     <- bucket đang mở, đóng muộn 9 s
UI-01|2026-09-05 11:55:00|2026-09-05 11:55:00|23.694|1     <- nhịp không bị đẩy
```

`SELECT count(*) FROM history_gaps WHERE reason='restart' AND created_at_utc_ms >= <mốc deploy>` = **0**.

Mẫu phục hồi giữ nguyên thời điểm đo thật (`11:54:54Z`) chứ không bị kéo về biên
`11:54:45Z`, nên bản ghi vẫn nói đúng rằng bucket này đóng muộn.

### Lịch sử cũ không bị bóp méo

`GET /api/v1/history` trên bo, hai cửa sổ:

| Cửa sổ | `complete` | `gaps` |
|---|---|---|
| `11:00:00Z → 11:15:00Z` (chứa lần restart **cũ**) | `false` | 1 gap `[11:07:45Z, 11:08:00Z)` `restart / scheduler_restart_no_backfill` |
| `11:50:00Z → 11:58:00Z` (chứa lần restart **mới**) | `true` | `[]` |
| `11:27:05Z → 11:57:05Z` (cửa sổ 30 phút mặc định của trang Trends) | `true` | `[]` |

Gap có thật trong quá khứ vẫn được báo nguyên vẹn — bản vá **không** xoá và
**không** che bằng chứng cũ, nó chỉ thôi tạo ra bằng chứng nói quá cho các lần
khởi động lại về sau.

## 5. Smoke test sau deploy

| # | Mục | Kết quả |
|---|---|---|
| 1 | `systemctl is-active mkddc-core mkddc-iobus mkddc-web-pi mkddc-netcfg` | **4/4 active** |
| 2 | `GET /api/v1/health` | `{"status":"ok"}`, checks **6/6 ok** (`core`, `io_shm`, `iobus`, `mcu_connection`, `plc_shm`, `web`), version `0.1.0-be-b6c` |
| 3 | `GET /api/v1/points` (JWT `admin`) | HTTP 200, **72 point**, `UI-01` quality `good`, `source` `core` |
| 4 | `GET /` | HTML trỏ `assets/index-BBNG7ZEE.js` — khớp bản dựng host |
| 5 | Guard cờ Rev A trên bo | `grep -c REVA_SCOPE_ROADMAP` = **0** |
| 6 | Journal khởi động | không lỗi mới; `hmi_ipc_listen` và `listen addr=:8081` bình thường |

## 6. Giới hạn của lát này

- Bo vẫn chạy **Fake MCU**, HMI disabled — đây là bằng chứng TARGET/runtime,
  **không** phải physical I/O HIL và **không** phải `RELEASE_READY`.
- Chu kỳ log ≥ 30 giây chưa có đối chứng trên bo: hai điểm đang bật DB logging
  (`UI-01`, `UI-09`) đều ở `15s`. Nhánh ấy được khoá bằng test host
  (`RestartStillReportsFullyMissedBuckets`), nơi biên rơi giữa hai bucket hot
  nên gap vẫn giữ nguyên như cũ.
- Rác lịch sử `VP1` (103.571 gap `snapshot/missing_or_invalid` từ 2026-08-17 tới
  2026-09-04, do `VP1` bật DB logging nhưng không có trong snapshot) **nằm ngoài
  phạm vi** lát này và chưa được xử lý.

Refs: `WEB-HIST-006`, PR #546.
