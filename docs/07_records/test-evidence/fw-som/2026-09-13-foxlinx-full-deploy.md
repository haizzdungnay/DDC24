# Bằng chứng deploy sạch FE + BE + FW SOM — Foxlinx SOM-DDC-24

**Ngày:** 2026-09-13
**Bo:** `SOM-DDC-24-foxlinx` (`root@mekong-fac.ddns.net:2223`)
**Commit dựng artifact:** `152411fb` (nhánh `fix/pgm03-variable-selection`, PR #702)
**Thư mục staging trên bo:** `/tmp/mkddc-deploy-20260913T030642Z`

## 1. Cổng kiểm chứng trước khi deploy

| Cổng | Lệnh | Kết quả |
|---|---|---|
| C++ host | `cmake --fresh -S . -B build/fw -DCMAKE_BUILD_TYPE=Release -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON` + build + `ctest` | configure/build exit 0; **1482/1482 PASS**, 1 skipped (`RealtimeMemlock.MclFutureUnderFiniteLimit…`) |
| Go | `go vet ./...` + `go test ./... -count=1` | vet sạch; **21 package ok**, 0 FAIL |
| FE | `npx vitest --run --environment jsdom src` | **249 file · 3177/3177 PASS** |
| FE | `npm run lint` | PASS (eslint + `check_ui_strings.py`) |
| FE | `npm run build:foxlinx` | PASS; chunk `programming` 154.94 KiB gzip / ngân sách R3 165.00 KiB; guard `grep -c REVA_SCOPE_ROADMAP dist/assets/index-*.js` = **0** |

## 2. Cross-build aarch64

```
cmake --fresh -S . -B build/fw-aarch64 -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_TOOLCHAIN_FILE=platform/cmake/toolchain-aarch64-linux-gnu.cmake \
  -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON
cmake --build build/fw-aarch64 --parallel --target mkddc-core mkddc-iobus mkddc-netcfg \
  mkddc-hmi fake_mcu mkddc-schedule-sim mkddc-alarm-sim mkddc-st-compile
```

Ghi chú: **không** build target `all` cho lane cross. `gtest_discover_tests` chạy binary
aarch64 **trên host** ở bước post-build (`libstdc++.so.6: cannot open shared object file`),
làm `all` đỏ dù binary phát hành dựng xong. Chỉ định danh sách target là cách đúng.

Kiểm ABI trước khi copy (bài học GLIBCXX): binary mới yêu cầu cao nhất `GLIBCXX_3.4.29`,
`libstdc++.so.6` trên bo cung cấp tới `GLIBCXX_3.4.30` ⇒ không cần `-static-libstdc++`.

Go: `GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -o build/fw-aarch64/mkddc-web ./cmd/mkddc-web`
(ELF aarch64, statically linked).

## 3. Cài đặt

Backup trước khi ghi đè: `*.prev-20260913T030642Z` cho `mkddc-core/iobus/netcfg/hmi`,
`/opt/mkddc-web/mkddc-web.prev-20260913T030642Z`, `/opt/mkddc-web/dist.bak-20260913T030642Z`.

FE static thay **sạch**: giải nén vào `dist.new` rồi `mv` đè, không trộn file cũ (16 file).

Tên unit thật trên bo (đã kiểm bằng `systemctl list-units 'mkddc*'`):
`mkddc-netcfg`, `mkddc-iobus`, `mkddc-core`, `mkddc-reload-helper`, `mkddc-time-helper`,
`mkddc-web-pi`. Hai helper **không** mang tiền tố `mkddc-web-` — dừng nhầm tên thì chúng
vẫn giữ file binary cũ đang mở.

## 4. Kiểm chứng sau deploy

### 4.1 Đúng binary đang phục vụ (không phải bản cũ)

| Unit | is-active | NRestarts | sha256(`/proc/MainPID/exe`) | sha256 bản dựng trên host |
|---|---|---|---|---|
| mkddc-netcfg | active | 0 | `0ad214f4a8ed` | `0ad214f4a8ed` |
| mkddc-iobus | active | 0 | `730cbb7537fb` | `730cbb7537fb` |
| mkddc-core | active | 0 | `93a47a69eaac` | `93a47a69eaac` |
| mkddc-web-pi | active | 0 | `e408350f7e06` | `e408350f7e06` |
| mkddc-reload-helper | active | 0 | — | — |
| mkddc-time-helper | active | 0 | — | — |

Không còn tiến trình `mkddc-web` nào nằm ngoài cgroup systemd (bẫy tiến trình mồ côi
của lần deploy trước đã được kiểm lại, sạch).

`--version` của cả ba binary C++ ghi `git_commit=152411fb3a5987cc68314c46b90e7eb6c9ec259b`.

### 4.2 API

| Endpoint | Kết quả |
|---|---|
| `/api/v1/health` | `status: ok`; core/io_shm/iobus/mcu_connection/plc_shm/web đều `ok` |
| `/api/v1/points?limit=3` | dữ liệu thật (`UI-01` = 22.805) |
| `/api/v1/alarms?limit=1` | `[]` |
| `/api/v1/programming/projects` | `AHU-MASTER-SEQUENCE` |
| `/api/v1/programming/point-catalog?limit=2` | có dữ liệu |
| `/api/v1/programming/runtime` | `producerState: READY` |
| `GET /` | HTTP 200, index.html 1123 byte |

### 4.3 Giao diện (Chrome DevTools MCP, dist phục vụ **từ bo**)

Trang lên sạch, **0 lỗi/cảnh báo console**: `/`, `/alarms`, `/diagnostics`, `/monitor`,
`/trends`, `/eng/inputs`, `/eng/outputs`, `/eng/modbus-rtu`, `/eng/scheduler`,
`/eng/programming`, `/eng/programming/projects/<id>/mapping`.

Bản vá selection PGM-03 (PR #702) chạy đúng trên bo: worklist 34 biến; bấm vào **thân
hàng** (ô Giá trị) của `R50804_DO2 → R50804_DO6 → R50907_DO8 → R50804_DO1` đổi selection
đúng từng bước, Binding Inspector bám theo, luôn đúng **1** hàng `aria-pressed`.

Ảnh: `2026-09-13-foxlinx-full-deploy-mapping.png`.

## 5. Rollback

```bash
systemctl stop mkddc-web-pi mkddc-core mkddc-iobus mkddc-netcfg
install -m 0755 /usr/sbin/mkddc-core.prev-20260913T030642Z   /usr/sbin/mkddc-core
install -m 0755 /usr/sbin/mkddc-iobus.prev-20260913T030642Z  /usr/sbin/mkddc-iobus
install -m 0755 /usr/sbin/mkddc-netcfg.prev-20260913T030642Z /usr/sbin/mkddc-netcfg
install -m 0755 /opt/mkddc-web/mkddc-web.prev-20260913T030642Z /opt/mkddc-web/mkddc-web
rm -rf /opt/mkddc-web/dist && cp -a /opt/mkddc-web/dist.bak-20260913T030642Z /opt/mkddc-web/dist
systemctl start mkddc-netcfg mkddc-iobus mkddc-core mkddc-web-pi
```
