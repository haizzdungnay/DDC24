# Foxlinx — deploy `main` `4f00f3c1` và hai lỗi phát hiện khi deploy (2026-09-13)

| Thuộc tính | Giá trị |
|---|---|
| Bo | `SOM-DDC-24-foxlinx` — `root@mekong-fac.ddns.net:2223` |
| Nền tảng | Linux OK1126B-buildroot 6.1.141 aarch64; uptime 2 ngày 14 giờ lúc bắt đầu |
| Phạm vi | Toàn bộ stack: Core, IObus, Netcfg, HMI, ST toolchain, schedule-sim, Web/API, FE dist |
| Commit | `main` `4f00f3c1` (pull `--ff-only`, đi từ `f49df805`) |
| Mức bằng chứng | **TARGET** cho §3–§7; HOST cho §1 và §8 |

## 1. Dựng trên host

| Thành phần | Lệnh | Kết quả |
|---|---|---|
| C++ aarch64 | `cmake --fresh -B build/fw-aarch64 -DCMAKE_TOOLCHAIN_FILE=platform/cmake/toolchain-aarch64-linux-gnu.cmake -DCMAKE_BUILD_TYPE=Release -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON` | `CFG_EXIT=0` |
| C++ target sản phẩm | `cmake --build build/fw-aarch64 --parallel --target mkddc-core mkddc-iobus mkddc-netcfg mkddc-hmi mkddc-st-compile mkddc-st-validate mkddc-st-package mkddc-schedule-sim` | `BUILD_EXIT=0` |
| Go Web/API | `CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags="-s -w"` | `GOBUILD_EXIT=0` |
| FE | `npm run build:foxlinx` | `FEBUILD_EXIT=0`; chunk `programming` 154,89 KiB gzip / ngân sách R3 165,00 KiB |

Build **toàn cây** (`cmake --build build/fw-aarch64 --parallel` không giới hạn
target) thoát `2`, nhưng lỗi nằm ở `gtest_discover_tests` chạy `hmi_tests`
aarch64 trên host x86_64 và nhận `Result: 127`. Đó là khâu liệt kê test, không
phải khâu dựng sản phẩm; gate unit C++ vẫn thuộc build native theo
`toolchain-aarch64-linux-gnu.cmake`.

`GLIBCXX` lớn nhất mà cả 8 binary yêu cầu là `3.4.29`, trong khi bo có tới
`3.4.30` — không dính lớp lỗi `GLIBCXX_3.4.32` của các lần cross-build trước.

`KX_SHM_MAGIC` giữ nguyên `0x4B584406u`; deploy cả ba lớp cùng lượt nên không có
cửa sổ lệch magic giữa Web, Core và IObus.

## 2. Sao lưu và đường lùi

```
/opt/mkddc-backups/main-20260912T182013Z/{mkddc-core,mkddc-iobus,mkddc-netcfg,
                                          mkddc-hmi,mkddc-st-*,mkddc-schedule-sim,
                                          mkddc-web,dist/,SHA256SUMS.old}
/opt/mkddc-web/dist.old                  (dist cũ đổi tên tại chỗ, không xoá)
```

Historian `/data/config/historian-v2.sqlite` được sao kèm `-wal`.

## 3. Lỗi 1 — tiến trình web mồ côi chiếm cổng 8081

### Triệu chứng

Sau khi hoán đổi binary và khởi động lại, hai tín hiệu "xanh" cùng lúc:

| Phép kiểm | Kết quả |
|---|---|
| `systemctl is-active mkddc-web-pi` | `active` |
| `GET /api/v1/health` | `{"status":"ok"}`, checks 6/6 |

Nhưng journal lặp:

```
mkddc-web: serve: listen tcp :8081: bind: address already in use
mkddc-web-pi.service: Main process exited, code=exited, status=1/FAILURE
mkddc-web-pi.service: Scheduled restart job, restart counter is at 3.
```

### Nguyên nhân gốc

```
tcp  :::8081  LISTEN  76983/mkddc-web
/proc/76983/exe -> /opt/mkddc-web/mkddc-web (deleted)
/proc/76983/cgroup -> 0::/system.slice/sshd.service
ps -o lstart=,ppid= -p 76983 -> Fri Sep 11 08:29:19 2026   1
```

PID 76983 được khởi chạy **bằng tay qua SSH** ngày 2026-09-11, không thuộc cgroup
của unit, nên `systemctl stop` không đụng tới. Nó giữ cổng 8081; mọi tiến trình
systemd khởi động sau đó chết ở `bind` rồi bị restart vô hạn.

Hậu quả nguy hiểm hơn cả vòng restart: `(deleted)` nghĩa là tiến trình đang phục
vụ chạy **bản binary đã bị deploy ghi đè**. Health check và smoke test chạy lúc
đó xác nhận nhầm một bản build cũ — bảng số đo trông sạch trong khi bản mới chưa
từng chạy một request nào.

### Cách sửa và kiểm chứng

`systemctl stop mkddc-web-pi` (cắt vòng restart) → `SIGTERM` 76983, tắt sau 2 s →
`systemctl reset-failed` → `systemctl start`.

| Phép kiểm | Trước | Sau |
|---|---|---|
| Chủ cổng 8081 | `76983` (ngoài systemd) | `167543` = `MainPID` của unit |
| `NRestarts` | `5` | `0` |
| `sha256sum /proc/<MainPID>/exe` | — | `3ad9c90e…49f3` |
| `sha256sum /opt/mkddc-web/mkddc-web` | — | `3ad9c90e…49f3` |

**Bài học đưa vào quy trình**: `systemctl is-active` cộng health `ok` KHÔNG chứng
minh bản mới đang chạy. Phép kiểm tối thiểu là `sha256sum /proc/<MainPID>/exe`
khớp bản dựng trên host, và `/proc/<PID>/exe` không mang hậu tố `(deleted)`.

## 4. Lỗi 2 — `install.sh` chưa bao giờ cài hai unit helper đặc quyền

### Triệu chứng

`/run/mkddc/` có `core.sock`, `fieldbus.sock`, `hmi-api.sock`,
`modbus-control.sock`, `programming-v1.sock` — nhưng **không** có
`reload-helper.sock` lẫn `time-helper.sock`.

Đối chiếu `md5sum` từng unit giữa repo và bo:

| Unit | repo | bo |
|---|---|---|
| `mkddc-core` … `mkddc-pty` (7 unit) | khớp | khớp |
| `mkddc-reload-helper.service` | `766ad985` | **không có file** |
| `mkddc-time-helper.service` | `e19a1ddc` | **không có file** |

### Nguyên nhân gốc

`platform/systemd/` có sẵn cả hai file, `apps/web-api/internal/app/main.go` có
sẵn hai subcommand `reload-helper-server` và `time-helper-server` phục vụ chúng,
nhưng `platform/packaging/install.sh` chỉ copy bốn unit chính (`mkddc-iobus`,
`mkddc-core`, `mkddc-netcfg`, `mkddc-web-pi`) cộng fake-MCU/HMI có điều kiện —
hai unit helper không nằm trong bất kỳ nhánh nào. Chúng chưa từng được cài.

`mkddc-web` chạy `User=mkddc` với `NoNewPrivileges=true`, nên nó không tự restart
service và không tự ghi cấu hình chrony được. Thiếu helper thì lưu
BACnet/fieldbus hay đổi nguồn NTP **ghi được file mà không bao giờ có hiệu lực**
— đúng lớp triệu chứng của finding F-01 mà reload helper sinh ra để đóng. Và vì
unit không tồn tại nên cũng không có gì `failed`: không một tín hiệu nào ở tầng
systemd.

### Cách sửa

`install.sh` nay cài và `enable` cả hai unit, khởi động lại chúng **trước**
`mkddc-web-pi`, đồng thời tạo sẵn `/etc/chrony/sources.d`. Thư mục là bắt buộc:
`mkddc-time-helper` có `ProtectSystem=strict` + `ReadWritePaths=/etc/chrony/sources.d`,
mà systemd dựng mount namespace **trước** `ExecStart`, nên thư mục chưa tồn tại
làm unit chết ngay ở bước setup — helper tự `MkdirAll` cũng không cứu được vì nó
chưa kịp chạy.

### Kiểm chứng trên bo

```
srw-rw---- 1 root mkddc 0 Sep 12 18:28 /run/mkddc/reload-helper.sock
srw-rw---- 1 root mkddc 0 Sep 12 18:28 /run/mkddc/time-helper.sock
```

Quyền `root:mkddc 0660` đúng mô tả ranh giới đặc quyền trong
`reloadhelper_linux.go`.

Kiểm chứng **chức năng**, không chỉ sự tồn tại của socket:

| Bước | Số đo |
|---|---|
| `MainPID` `mkddc-iobus` trước | `167211` |
| `PUT /api/v1/system/config/bacnet` `{"bip":{"enabled":false,"udp_port":47808}}` | HTTP 200, `{"result":"success","applied":true,"reload":"restart-iobus","warnings":null}` |
| `MainPID` `mkddc-iobus` sau | `168392` |

Nhóm `bacnet` dùng `reloadRestartIobus`, tức đi qua `applySystem()` → reload
helper. PID đổi là bằng chứng trực tiếp helper đã restart được unit; trước bản vá
đường này không có socket để đi.

Đối chứng nhóm khác: `PUT /api/v1/system/config/fieldbus` trả
`reload: "control"` — fieldbus đi đường `modbus-control.sock` riêng, **không**
chạm helper. Ghi lại ở đây để lần sau không dùng nhầm nhóm này làm phép kiểm.

### Gate chặn tái diễn

`tests/integration/test_release_dryrun.py` nay có `INSTALLED_UNITS` cùng
`test_1_cai_moi_dat_du_unit_systemd` và
`test_1_cai_moi_tao_san_thu_muc_chrony_cho_time_helper`.

Đối chứng gate: gỡ bản vá `install.sh` (`git stash`) rồi chạy hai test đó →
**2 failed**; trả bản vá về → **xanh**. Gate không xanh sẵn.

## 5. Cài đặt — checksum trên bo khớp bản dựng host

| Đích | SHA-256 |
|---|---|
| `/opt/mkddc-web/mkddc-web` | `3ad9c90e3471b3f76262c7b3bf8b5cfabc4b8100b1cf6d020e98b5a5f35449f3` |
| `/usr/sbin/mkddc-core` | `91617940e454c9ccb8651e815cf5fc46303f67194f33dd537dae4b9690a9ef05` |
| `/usr/sbin/mkddc-iobus` | `b906c84fcade6fff6af361e811708da9d257d05cd41764b0d360f019e2a0fe97` |
| `/usr/sbin/mkddc-netcfg` | `09b3a7e7de082a15aa39effca02e929e49a659684c28934466706f9bb6eae5ab` |
| `/usr/sbin/mkddc-hmi` | `1f9d1c26c34af769dd386aa553eecb509e7c26bceee83873fa299216ae910af0` |
| `/usr/sbin/mkddc-st-compile` | `665bf89bd64783e86d5df6b584146fab483f33888c945516beaceb9f00eb456b` |
| `/usr/sbin/mkddc-st-validate` | `2e6a051d552f66650e8921e013cbb82d14289b0b86bb73422a6e6d49c13d36f8` |
| `/usr/sbin/mkddc-st-package` | `1ec4159e1a6a62dc3ef66bdc9cfd84c6a8043d9d2da6fcc499fbf89d49fdd4c7` |
| `/usr/sbin/mkddc-schedule-sim` | `2d6284016ff3d8dc065cf2409cbd05e2f5b2fafa5b58a4736c10582771f03cf1` |

9/9 khớp. `/proc/<PID>/exe` của `mkddc-core` và `mkddc-iobus` trỏ file thật,
không `(deleted)`.

FE: `GET /` trỏ `assets/index-DCVsk2Sy.js`, trùng `build/web-ui/dist` trên host.
Guard cờ Rev A: `grep -c REVA_SCOPE_ROADMAP` = **0** trên cả host lẫn bo.

## 6. Smoke test sau khi sửa xong cả hai lỗi

| # | Mục | Kết quả |
|---|---|---|
| 1 | `systemctl is-active` 7 unit | **7/7 active** (`netcfg`, `iobus`, `core`, `web-pi`, `reload-helper`, `time-helper`, `fakemcu`) |
| 2 | `NRestarts` 5 unit | **0** hết |
| 3 | `systemctl list-units --state=failed` | **0 unit** |
| 4 | `GET /api/v1/health` | `status: ok`, checks **6/6** (`core`, `io_shm`, `iobus`, `mcu_connection`, `plc_shm`, `web`) |
| 5 | `GET /api/v1/points` | HTTP 200, **72 point** |
| 6 | `alarms`, `overview`, `system/status`, `programming/capabilities`, `programming/runtime`, `schedules`, `network`, `trends/config`, `system/history`, `alarm-history` | **10/10 HTTP 200** |
| 7 | `GET /api/v1/history?point=UI-01&from=…&to=…&resolution=15s` (RFC3339) | HTTP 200, có mẫu thật |
| 8 | `GET /api/v1/system/time/status` | `mode: ntp`, `synchronized: true`, `health: healthy` |

## 7. Kiểm chứng UI trên bo (Chrome DevTools MCP qua tunnel SSH)

Lane MCP: `scripts/verify-project.sh --component browser` → **PASS 7/7**
(`artifacts/ui-audit/chrome-devtools-mcp-gate.json`). Tunnel
`ssh -L 18081:127.0.0.1:8081`.

Đăng nhập `admin` thành công; header hiện `Device: ONLINE` + `LIVE`.

| Trang | Kết quả |
|---|---|
| `/` Overview | `DDC-24-TANG-1`; 5 subsystem; `72 points were read`; ảnh `2026-09-13-foxlinx-main-deploy-overview.png` |
| `/eng/programming` | `Control programming`, project `AHU-MASTER-SEQUENCE`, Draft r24, Active r24 |
| `/monitor` | `Monitor I/O`, TOTAL POINTS 72, UI 16 / DO 4 / AO 4 |
| `/diagnostics` | render đủ |
| `/trends` | render đủ |
| `/eng/modbus-rtu` | render đủ |
| `/settings/time` | hiện giờ thiết bị thật |

Console: **0 lỗi** qua cả 7 trang.

Nhật ký hoạt động trên bo ghi `config.bacnet … success` — chính thao tác kiểm
chứng reload helper ở §4, tức đường audit cũng thông.

## 8. Gate trên host

| Gate | Kết quả |
|---|---|
| `pytest tests/integration/test_release_dryrun.py tests/integration/test_release_packaging_guard.py` | **24/24 passed** |
| `scripts/verify-project.sh --component layout` | `LAYOUT_EXIT=0` |
| `scripts/verify-project.sh --component browser` | PASS 7/7 |

`build/release` phải xoá trước khi dựng lại: thư mục còn `CMakeCache.txt` trỏ
`toolchain-aarch64-linux-gnu.cmake` từ phiên 2026-09-10, nên `build-release.sh`
tái dùng cache và sinh binary aarch64; `test_release_dryrun` chạy chúng trên
host x86_64 và chết ở `libstdc++.so.6: cannot open shared object file`. Đây là
đúng lớp bẫy "build dir cũ sinh số đo giả" mà `CLAUDE.md` cảnh báo, ở một thư
mục build khác.

## 9. Ghi nhận ngoài phạm vi bản vá

- **4 slave Modbus offline** (`CK508-04`, `CK508-05`, `CK509-06`, `CK509-07`) —
  bo lab không có thiết bị RS-485 thật trên `/dev/rs485-1 -> ttyS5`. Không phải
  hồi quy: **185.120** dòng `modbus.write_fail`/`write_dropped` trong ~42 giờ
  TRƯỚC deploy, so với **422** dòng sau deploy. UI báo `DEGRADED
  modbus_slave_offline` là phản ánh đúng thực tế phần cứng.
- **Phiên đăng nhập không sống qua reload trang**: mở thẳng một URL nội bộ đá về
  `/login`. Vấn đề nhóm B mở từ 2026-08-05, chủ sở hữu chưa chốt phương án.
- **Chuỗi i18n lẫn ngôn ngữ** trong nhật ký hoạt động khi UI đang ở tiếng Anh:
  `bip.enabled:_(không_có)_->_false`.
- `bacnet.conf` trước phiên này **không tồn tại** trên bo (`{"bip":null}`); phép
  kiểm ở §4 tạo ra nó với `enabled:false`. BACnet vẫn tắt, chỉ là nay tường minh.
- Bo vẫn chạy **Fake MCU**, HMI `inactive`. Đây là bằng chứng TARGET/runtime,
  **không** phải physical I/O HIL và **không** phải `RELEASE_READY`.

Refs: `CHANGELOG.md` mục `[Unreleased]` ngày 2026-09-13.
