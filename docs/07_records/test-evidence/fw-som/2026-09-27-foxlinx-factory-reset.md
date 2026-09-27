# Cài sạch bo lab Foxlinx như mới xuất xưởng — 2026-09-27

| Thuộc tính | Giá trị |
|---|---|
| ID | `EV-FWSOM-FOXLINX-FACTORY-20260927` |
| Ngày | 2026-09-27, 04:30–05:10 UTC |
| Board | `OK1126B-buildroot` (Forlinx OK1126B-S, RV1126B, Buildroot, aarch64), `mekong-fac.ddns.net:2223` |
| Nguồn cài | `main@05182713` (PR #782), cross-build aarch64, khoá công khai phát hành `2fb77aa42e7fe446` |
| Yêu cầu | Chủ sở hữu: "deploy sạch cho bo, sạch sẽ như mới sản xuất và cài đặt mới"; bổ sung: "giữ nguyên mấy thiết bị Modbus" |
| Mức bằng chứng | **TARGET** — cài thật, đè hệ thống; số đo đọc từ bo và từ API |
| Công cụ | `tools/deploy/foxlinx_factory_reset.sh` (pha `stop` / `wipe` / `install`), `platform/packaging/install.sh --with-fake-mcu` |

## 1. Phạm vi

### Giữ lại

| Nhóm | Mục | Lý do |
|---|---|---|
| Thiết bị Modbus | `/data/config/fieldbus.conf`, `fieldbus.lkg.json`, `fieldbus.journal`, `profiles/*.json` (CK508-04, CK508-05, CK509-06, CK509-07, mtr-1) | Chủ sở hữu yêu cầu |
| Mạng | `/etc/mkddc/netcfg.conf`, `/data/mkddc/netcfg-transaction.json` (trạng thái `confirmed`), cấu hình mạng của hệ điều hành | Mất là mất đường vào bo từ xa |
| SSH và bảo mật | Khoá SSH, `sshd_config` chỉ nhận khoá; unit `mkddc-ssh-guard`, `mkddc-incident-ipblock`, `mkddc-port-redirect` (sự cố `SEC-INC-20260926-FOXLINX`) | Không mở lại đường xâm nhập |
| Cấu hình bo lab | `mkddc-fakemcu`, `mkddc-pty`; drop-in iobus `nomcu.conf` (bật Modbus RTU master trên RS-485 #1 qua fake MCU) và `pidfile.conf` (F-FR-01, gỡ lúc 05:18 sau khi iobus tự ghi pidfile) | Bo lab không có MCU thật |
| Ảnh hệ điều hành | `/opt/unixbench` và mọi thứ của image Forlinx (ngày 2025-11-21) | Là trạng thái xuất xưởng |

### Xoá, rồi cài mới từ `main`

- Toàn bộ binary `/usr/sbin/mkddc-*`, kể cả khoảng 40 bản `.prev`/`.bak`.
- `/opt/mkddc-web`, gồm khoảng 90 bản sao `dist`/`mkddc-web` cũ, 858 MB.
- `/usr/libexec/mkddc`, `/usr/share/mkddc`, và các unit ứng dụng.
- Sao lưu cũ: `/var/backups/mkddc` (1,3 GB), `/opt/mkddc-backups` (631 MB), `/data/mkddc/deploy-backups` (302 MB), `/data/releases`, `/data/backup`, `/data/mkddc-backups`.
- Dữ liệu ứng dụng:
  - Project Programming (Project AHU-MASTER-SEQUENCE tới revision #69, `SOAK-ADR061`) và khoá ký thiết bị;
  - historian, trend, activity log, lịch, người dùng, sở thích giao diện;
  - cấu hình I/O cục bộ, safe-state, BACnet, định danh thiết bị, điểm ảo, JWT secret.
- Rác thử nghiệm: `/root/{backup*,deploy,stage-fix,f17,quarantine,.vscode-server,.cache,.debug}`, `/usr/local/bin/rs485_check.sh`, `/data/mkddc/f17-trap`.
- Journal cũ: 1,3 GB, vacuum sau khi đã sao lưu.

## 2. Sao lưu trước khi xoá

Lưu ngoài repo, trên máy dev: `~/Desktop/DDC-board-backups/foxlinx-factory-reset-20260927/` (quyền `0700`). Đủ để khôi phục toàn bộ trạng thái cũ.

| File | Nội dung | Kích thước | sha256 (16 ký tự đầu) |
|---|---|---|---|
| `01-state.tar.gz` | `/data` (trừ các thư mục sao lưu cũ), `/etc/mkddc*`, unit, `/etc/ssh`, `/root`, `/usr/local`, binary và `dist` đang chạy; 783 mục | 91 MB | `724d758a0ee73663` |
| `02-bulk.tar.gz` | Sao lưu cũ, toàn bộ `/opt/mkddc-web`, `/usr/sbin`, journal, cache của root; 11 144 mục | 2,68 GB | `ae3dd20475107bd3` |
| `03-final-db-stopped.tar.gz` | DB Programming, historian, trend, activity, `users.conf`, khoá thiết bị, chụp **sau khi dừng service** (đã checkpoint, không còn `-wal`) | 24 MB | xem `SHA256SUMS` |

Cả ba qua `gzip -t`; danh sách mục nằm trong `01-state.list` và `02-bulk.list`.

## 3. Bản cài

- Cross-build aarch64 từ `main@05182713`: 9 binary C++ (core, schedule-sim, st-compile, st-package, programming-sim-worker, iobus, fake_mcu, netcfg, hmi), 0 warning, GLIBCXX ≤ 3.4.29, GLIBC ≤ 2.38. Web Go `linux/arm64` `CGO_ENABLED=0`. FE `VITE_PROGRAMS_WORKSPACE_V2=1 npm run build:release`, bundle trong ngân sách (dư 88,46 KiB).
- `provenance.json`: `git_commit=05182713…`, `dirty=false`, `st_public_key_mode=RELEASE`, fingerprint `2fb77aa42e7fe446`. `checksums.sha256` qua `sha256sum --check` trên bo 7/7.

## 4. Nhật ký (UTC)

| Thời điểm | Bước | Kết quả | Trạng thái |
|---|---|---|---|
| 04:30–04:36 | Kiểm kê bo (chỉ đọc) | Unit, `/data`, `/opt`, `/usr/sbin`, drop-in, unit bảo mật, công cụ trên bo (`tar`/`find` busybox, `sha256sum`/`install` coreutils, không có `python3`, `socat`) | Xong |
| 04:36–04:57 | Sao lưu `01-state` (40 s) và `02-bulk` (1 113 s) | Như mục 2 | PASS |
| 04:39–04:53 | Build bản cài | Như mục 3; phát hiện F-FR-02, F-FR-03 | PASS |
| 04:58 | Chép bộ cài lên `/var/tmp`, kiểm checksum trên bo | 7/7 OK | PASS |
| 04:59 | Pha `stop` | 8 unit ứng dụng inactive, không còn tiến trình; `mkddc-netcfg`, `ssh-guard`, `sshd` active | PASS |
| 05:00 | Chụp DB sau khi dừng | `03-final-db-stopped.tar.gz` | PASS |
| 05:01 | Pha `wipe` | `/data` còn đúng 3 file fieldbus, 5 profile và journal netcfg. Phân vùng gốc 7,1 GB → 995 MB đã dùng. SSH vẫn vào được | PASS |
| 05:02 | Pha `install` (`install.sh --with-fake-mcu`) | Core, iobus, netcfg, 2 helper, fake MCU active; khoá thiết bị mới; `users.conf`, `io_config.conf`, `mkddc-web.env` mặc định | PASS, trừ web |
| 05:02–05:03 | Web lặp restart (16 lần): `cursor secret >=16 byte là bắt buộc` | F-FR-04 | FAIL → đã khôi phục |
| 05:03 | Sinh lại `JWT_SECRET` 64 hex trên bo bằng `od -An -tx1 -N32 /dev/urandom` (không in giá trị), restart web | Web active, `NRestarts=0`, `programming.toolchain ok` | PASS |
| 05:04 | Web không vào được từ ngoài (8082 bị từ chối) | F-FR-05; thêm drop-in `port.conf` `PORT=8082` | PASS |
| 05:05 | Kiểm API | Mục 5 | PASS |
| 05:06 | Xoá bộ cài tạm trên bo | `/var/tmp` sạch | Xong |
| 05:12 | Chủ sở hữu merge PR #783 (`main@3cb08fbc`) | — | — |
| 05:14–05:18 | Nâng cấp bằng `install.sh --with-fake-mcu` từ `main@3cb08fbc` (build lại toàn bộ, khoá `RELEASE`) | Checksum 7/7 trên bo. Khoá thiết bị giữ nguyên. Bản trước chụp vào `/var/backups/mkddc/0.1.0-20260927-051741`. Dữ liệu giữ nguyên, kể cả Project "CHUONG CONTROLLER" chủ sở hữu vừa tạo qua giao diện | PASS |
| 05:18 | Gỡ drop-in `pidfile.conf` của iobus (sao lưu ở `/var/backups/mkddc/dropin-20260927/`), restart iobus | `INFO iobus.pidfile path=/run/mkddc/iobus.pid pid=124336`, file trùng MainPID, unit không còn `ExecStartPost` | **PASS F-FR-01** |
| 05:19 | Kiểm lại toàn bộ | Mọi unit khớp `runtime-checksums` của `3cb08fbc`, `NRestarts=0`, `RELEASE`, RT ok, health 6/6, Modbus 4/4 online và 48 điểm `GOOD`, `port.conf` còn | PASS |
| 07:48 | Nâng cấp lên `main@4b833b38` (PR #785, F-FR-04) bằng `install.sh`. Trước đó cài thử hai lần vào cây giả **ngay trên bo** (`MKDDC_INSTALL_ROOT`) | Cài thử fresh: đúng 1 dòng `JWT_SECRET`, 64 hex, quyền `600`. Cài thử nâng cấp từ secret `a3`: thay bằng 64 hex, `PROGRAMMING_REV_A` giữ, quyền `600`, log WARN F-FR-04. Nâng cấp thật: không có WARN; dấu băm dòng secret trước/sau trùng (`2c96c0e4…`), nên phiên đăng nhập không bị cắt. Khoá thiết bị giữ; snapshot `0.1.0-20260927-074801` | **PASS F-FR-04** |
| 07:50 | Kiểm lại toàn bộ | Mọi unit khớp `runtime-checksums` của `4b833b38`, `NRestarts=0`, `RELEASE`, health 6/6, Programming `READY` (Project "CHUONG CONTROLLER" còn), Modbus 4/4 online và 48 điểm `GOOD` | PASS |

## 5. Kiểm chứng sau cài

| Mục | Kết quả |
|---|---|
| Binary đang chạy | `/proc/MainPID/exe` khớp `/usr/share/mkddc/runtime-checksums.sha256`: core `bce9929c…`, iobus `ed87b1a0…`, netcfg `9fc56931…`, web và hai helper `7febb45d…`; mọi unit `NRestarts=0` |
| Khoá ST | `mkddc-core --st-key-info` → `RELEASE 2fb77aa42e7fe446` (trước cài: `TEST 99354613db15918a`, F-FR-03) |
| RT | `rt.ok SCHED_FIFO 80 mlock=1`, `rt.cpufreq_ok governor=performance`, `rt.cpu_idle_ok qos_resume_latency_us=20`, 3 luồng phụ ngoài CPU3 |
| Pidfile | `/run/mkddc/core.pid` (Core tự ghi), `/run/mkddc/iobus.pid` (drop-in `pidfile.conf`, F-FR-01) |
| Health | 6/6 `ok` (`core`, `io_shm`, `iobus`, `mcu_connection`, `plc_shm`, `web`) |
| Đăng nhập | `admin` với mật khẩu mặc định của gói (`platform/packaging/users.conf`) |
| Programming | `targetState=READY`, tập chu kỳ ADR-061, **0 Project**, không có Active; safe-state chỉ do T7 `no_ctrl` (bo mới chưa có Program nào điều khiển) |
| Modbus (giữ nguyên) | Bus `rs485-1` RUNNING 9600 8N1, **4/4 thiết bị online**, p50/p95 26/27 ms, lỗi timeout/CRC/tổng 0; 48 điểm Modbus (CK50804, CK50805, CK50906, CK50907) đều `GOOD` |
| Bảo mật | 3 rule DROP của `incident-ipblock`, NAT 8081 → 8082, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PermitRootLogin prohibit-password` |
| Dung lượng | Phân vùng gốc 984 MB đã dùng (trước 7,1 GB); `/data` 704 KB; `/opt/mkddc-web` 19 MB; journal 8 MB |

## 6. Finding

| ID | Mức | Mô tả | Xử lý |
|---|---|---|---|
| F-FR-01 | P2 | Web đọc `/run/mkddc/iobus.pid` cho health và SIGHUP reload, nhưng trong gói phát hành cả binary lẫn unit iobus đều không ghi file này. Bo lab chạy được chỉ nhờ drop-in vá tay `pidfile.conf` (2026-08-04) | **Đóng.** Sửa ở PR #783 (iobus tự ghi, như Core ở F16); deploy `main@3cb08fbc` 05:18, drop-in đã gỡ, health `iobus` ok |
| F-FR-02 | P3 | Cross-build target `all` với HMI ON đứt, vì `gtest_discover_tests` chạy binary aarch64 trên x86 | Đã sửa trong PR #783 |
| F-FR-03 | P1 bảo mật | Lệnh cross-build Core trong `DEPLOY_FOXLINX.md` thiếu `-DMKDDC_ST_PUBLIC_KEY_HEX`, nên Core deploy tay nhúng **khoá TEST** của repo (`99354613db15918a`), trong khi bản cài chính thức 2026-09-10 là `RELEASE` | Runbook sửa trong PR #783. Bo nay chạy `RELEASE` |
| F-FR-04 | **P1 bảo mật** | `install.sh` sinh `JWT_SECRET` bằng `head -c 32 /dev/urandom \| tr -dc 'a-f0-9' \| head -c 64`. Lệnh chỉ giữ những byte ngẫu nhiên tình cờ là ký tự hex, nên ra 0–5 ký tự (đo trên bo: 2; 5 lần thử: 3, 2, 2, 5, 2). Nhánh dự phòng `mkddc-secret-$(date +%s)` cũng đoán trước được. Hệ quả: (a) web lặp restart vì cursor secret Programming < 16 byte; (b) nếu Programming tắt, web chạy với JWT ký bằng secret vài ký tự, ai cũng giả được token | **Đóng.** Sửa ở PR #785 (`main@4b833b38`), deploy và PASS trên bo 07:48. Chủ sở hữu cho phép ngày 2026-09-27. `install.sh` sinh 32 byte bằng `od -An -tx1 -N32 /dev/urandom` (64 hex), kiểm định dạng và dừng nếu sai (bỏ nhánh dự phòng đoán được), ghi dưới `umask 077`. Khi nâng cấp, secret < 32 byte bị thay (log `WARN … F-FR-04`), secret đủ dài giữ nguyên. Web `LoadConfig` từ chối `JWT_SECRET` < 32 byte. Test: `TestLoadConfigRejectsShortJWTSecret` và 3 test cài thử (`test_1_cai_moi_sinh_jwt_secret_du_32_byte`, `WeakJwtSecretUpgradeTest` ×2); 2 test đỏ trên `install.sh` cũ, 1 test đỏ trên `config.go` cũ. Trên bo: đã sinh lại secret 64 hex lúc 05:03 |
| F-FR-05 | P3 vận hành | Unit chuẩn nghe 8081; bo lab từng được sửa tay unit thành `PORT=8082` vì router chuyển cổng tới 8082 | Đưa vào drop-in riêng `mkddc-web-pi.service.d/port.conf` và vào `tools/deploy/foxlinx_factory_reset.sh` |

## 7. Giới hạn

- Đây là cài sạch lớp ứng dụng. Hệ điều hành (image Buildroot của Forlinx) **không** được nạp lại. Sau sự cố `SEC-INC-20260926-FOXLINX`, chỉ nạp lại image mới loại trừ được mọi dấu vết ở tầng hệ thống. Việc đó cần người có mặt tại bo (USB/maskrom), không làm được qua SSH.
- Mẫu mã độc trong `/root/quarantine` đã chuyển sang bản sao lưu `01-state.tar.gz` (không giải nén, không chạy) và đã xoá khỏi bo.
