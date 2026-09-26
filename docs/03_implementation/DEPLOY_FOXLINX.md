# Deploy lên board Foxlinx (SOM-DDC-24-foxlinx)

## Thông tin kết nối

| Trường | Giá trị |
|---|---|
| Hostname | `192.168.1.16` (LAN) / `mekong-fac.ddns.net` (WAN) |
| Port SSH | `22` (LAN) / `2223` (WAN) |
| User | `root` |
| SSH key | `~/.ssh/mkddc24_som` |
| CPU | Rockchip RV1126B (Quad core Cortex A53) — `aarch64` |
| OS | Buildroot |

```text
# LAN:
ssh -p 22 -i ~/.ssh/mkddc24_som root@192.168.1.16

# WAN (DDNS):
ssh -p 2223 -i ~/.ssh/mkddc24_som root@mekong-fac.ddns.net
```

> **Bảo mật:** SSH dùng key `~/.ssh/mkddc24_som`; không ghi hoặc truyền password
> trong command/runbook. `JWT_SECRET` đã được provision sẵn trên board — không ghi
> giá trị vào repo hoặc command history.

## Cấu trúc trên board

| Đường dẫn | Mô tả |
|---|---|
| `/opt/mkddc-web/mkddc-web` | Binary Go web API |
| `/opt/mkddc-web/dist/` | FE static (Vite build output) |
| `/opt/mkddc-web/mkddc-programming-sim-worker` | Simulation worker binary |
| `/usr/sbin/mkddc-st-compile`, `/usr/sbin/mkddc-st-package`, `/usr/sbin/mkddc-st-validate` | Tool ST mà web gọi khi Check/Commission — **phải cùng profile với web** (bước 2b) |
| `/data/config/` | Config dir (users.conf, fieldbus.conf) |
| `/data/mkddc/state/` | State dir |
| `/data/mkddc/state/programming/` | Programming state |
| `/run/mkddc/core.sock` | Core IPC socket |
| `/run/mkddc/programming-v1.sock` | Programming IPC socket |

Process chạy dưới user `mkddc`. Port listen: **8082**.

## Quy trình deploy

### Bước 1: Build Go backend (cross-compile)

```bash
cd apps/web-api
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -o /tmp/mkddc-web-foxlinx ./cmd/mkddc-web
```

Kỳ vọng: binary ~21 MB tại `/tmp/mkddc-web-foxlinx`.

### Bước 2: Build FE

```bash
cd apps/web-ui
VITE_PROGRAMS_WORKSPACE_V2=1 npm run build:release
```

Kỳ vọng: pass (gồm contracts, tsc, vite, bundle budget). Output tại
`build/web-ui/dist/`. Bản cho bo **phải** là `build:release` (bật cờ
Programming lúc build); cờ `VITE_PROGRAMS_WORKSPACE_V2=1` không được
`build:release` tự bật. `npm run build` trơn cho ra bản thiếu Programming.

### Bước 2b: Đồng bộ tool ST (bắt buộc kiểm mỗi lần deploy web)

Web gọi `/usr/sbin/mkddc-st-compile` và `/usr/sbin/mkddc-st-package` khi
Check/Commission. Hai tool này phải được build cho **cùng** product profile với
web. Lệch bản thì mọi Check thất bại: bản web có `ToolchainProbe` báo ngay
`ST-WORKER-TOOLCHAIN` và log `ERROR programming.toolchain`; bản cũ hơn thì treo
khoảng 30 s rồi báo `ST-WORKER-CRASH`. Sự cố thật: Foxlinx 2026-09-26, web profile
v2.2 chạy cùng compiler v2.1 sau một lượt deploy chỉ có web + FE; và `P5-507-F05`
(2026-08-13), khi compiler chưa được cài.

```bash
# sha profile mà web sắp deploy đòi:
grep 'ProfileSHA256 ' apps/web-api/internal/programming/domain/profile_generated.go
# sha của tool đang nằm trên bo:
$SSH $FOXLINX '/usr/sbin/mkddc-st-compile --version; /usr/sbin/mkddc-st-package --version'
```

Nếu `profile_sha256` khác nhau, cross-build và cài lại cả ba tool, kèm backup:

```bash
cmake --fresh -S . -B build/fw-aarch64 \
  -DCMAKE_TOOLCHAIN_FILE=platform/cmake/toolchain-aarch64-linux-gnu.cmake \
  -DCMAKE_BUILD_TYPE=Release -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON \
  -DIOBUS_BUILD_TESTS=OFF -DCORE_BUILD_TESTS=OFF
cmake --build build/fw-aarch64 --parallel \
  --target mkddc-st-compile mkddc-st-package mkddc-st-validate
# board chỉ có libstdc++ tới GLIBCXX_3.4.30: kiểm trước khi chép
aarch64-linux-gnu-objdump -T build/fw-aarch64/core/mkddc-st-compile | grep -o 'GLIBCXX_[0-9.]*' | sort -V | tail -1
```

Chép lên `/tmp` của bo, sao lưu ba file cũ, rồi
`install -m 0755 -o root -g root <tool> /usr/sbin/<tool>`. Chạy lại
`--version` để xác nhận sha khớp.

Profile đổi thì `mkddc-core` cũng phải cùng bản, vì Core nạp artifact theo
profile. Khi đó deploy cả core/iobus (và unit systemd nếu đổi) trong cùng lượt,
đừng chỉ deploy web.

### Bước 3: Backup trên board

```bash
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
FOXLINX="root@192.168.1.16"
SSH="ssh -p 22 -i ~/.ssh/mkddc24_som -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

$SSH $FOXLINX "
  cp /opt/mkddc-web/mkddc-web /opt/mkddc-web/mkddc-web.bak-${TIMESTAMP}
  mv /opt/mkddc-web/dist /opt/mkddc-web/dist.bak-${TIMESTAMP} 2>/dev/null || true
"
```

### Bước 4: Dừng web API

```bash
$SSH $FOXLINX "
  systemctl stop mkddc-web-pi mkddc-reload-helper mkddc-time-helper 2>/dev/null || true
  pkill -9 -x mkddc-web 2>/dev/null || true
  sleep 1
  pgrep -x mkddc-web && echo STILL_RUNNING || echo STOPPED
"
```

Kỳ vọng: `STOPPED`.

### Bước 5: Copy artifacts lên board

```bash
SCP="scp -P 22 -i ~/.ssh/mkddc24_som -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

$SCP /tmp/mkddc-web-foxlinx ${FOXLINX}:/opt/mkddc-web/mkddc-web
$SCP -r build/web-ui/dist ${FOXLINX}:/opt/mkddc-web/dist
```

### Bước 6: Phân quyền và khởi động lại

Khởi động qua unit `mkddc-web-pi`, không chạy tay bằng `nohup`: unit đã mang
đủ env (`PORT=8082`, `STATIC_DIR`, `/etc/mkddc-web.env` chứa `JWT_SECRET` và
`PROGRAMMING_REV_A=1`), còn tiến trình chạy tay nằm ngoài systemd thì không được
restart khi chết.

```bash
$SSH $FOXLINX '
  chmod +x /opt/mkddc-web/mkddc-web
  chown mkddc:mkddc /opt/mkddc-web/mkddc-web
  chown -R mkddc:mkddc /opt/mkddc-web/dist

  systemctl start mkddc-reload-helper mkddc-time-helper mkddc-web-pi
  sleep 20   # web cần ~16 s mới listen
  systemctl is-active mkddc-web-pi && echo SYSTEMD_OK || echo SYSTEMD_FAIL
  p=$(systemctl show -p MainPID --value mkddc-web-pi); sha256sum /proc/$p/exe
'
```

Kỳ vọng: `SYSTEMD_OK` và sha256 của `/proc/<MainPID>/exe` trùng bản vừa build.
`is-active` chưa đủ: tiến trình mồ côi còn chạy binary cũ vẫn có thể giữ cổng.

### Bước 7: Smoke test

Board Buildroot không có `curl` — dùng `wget` (busybox):

```bash
# LAN:
ssh -p 22 -i ~/.ssh/mkddc24_som root@192.168.1.16 '
  # Health
  wget -q -O - http://127.0.0.1:8082/api/v1/health
  echo ""

  # Login
  wget -q -O /tmp/login.json \
    --post-data="{\"username\":\"admin\",\"password\":\"admin123\"}" \
    --header="Content-Type: application/json" \
    http://127.0.0.1:8082/api/v1/auth/login
  TOKEN=$(sed "s/.*\"token\":\"\([^\"]*\)\".*/\1/" /tmp/login.json)

  # Programming capabilities
  wget -q -O - --header="Authorization: Bearer $TOKEN" \
    http://127.0.0.1:8082/api/v1/programming/capabilities
  echo ""

  # FE static
  wget -q -O - http://127.0.0.1:8082/ | head -c 100
  echo ""

  # Tool ST cùng bản với web (bước 2b)
  journalctl -u mkddc-web-pi -b --no-pager | grep "programming.toolchain" | tail -1
'
```

Kỳ vọng:

- Health: tất cả checks `ok`
- Login: role `admin`, token hợp lệ
- Programming: `targetState: READY`, languages `ST` + `FBD`
- FE: HTML `<html lang="vi">` được serve
- Toolchain: `INFO programming.toolchain ok … profile_sha256=<sha của web>`. Gặp `ERROR programming.toolchain` thì quay lại bước 2b; đừng để người dùng phát hiện qua một Check hỏng.

## Rollback

Khôi phục từ backup:

```bash
TIMESTAMP="20260911T082831Z"  # thay bằng timestamp backup cần khôi phục
ssh -p 2223 -i ~/.ssh/mkddc24_som root@mekong-fac.ddns.net "
  pkill -x mkddc-web || true
  sleep 1
  cp /opt/mkddc-web/mkddc-web.bak-${TIMESTAMP} /opt/mkddc-web/mkddc-web
  rm -rf /opt/mkddc-web/dist
  mv /opt/mkddc-web/dist.bak-${TIMESTAMP} /opt/mkddc-web/dist
  # Restart theo bước 6
"
```

## Lưu ý

- Board không có `curl`, `nc` — dùng `wget` hoặc `busybox wget` để test.
- Binary `mkddc-web` đang chạy thì `scp` sẽ thất bại — phải `pkill` trước.
- `scp` dùng `-P` (uppercase) cho port, `ssh` dùng `-p` (lowercase).
- Không sửa `JWT_SECRET` trên board trừ khi có yêu cầu rõ ràng.
- FE static phục vụ qua `WEB_UI_DIR` env var, không qua reverse proxy riêng.
