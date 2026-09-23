# Deploy lên board Foxlinx (SOM-DDC-24-foxlinx)

## Thông tin kết nối

| Trường | Giá trị |
|---|---|
| Hostname | `192.168.1.16` (LAN) / `mekong-fac.ddns.net` (WAN) |
| Port SSH | `22` (LAN) / `2222` (WAN) |
| User | `root` |
| SSH key | `~/.ssh/mkddc24_som` |
| CPU | Rockchip RV1126B (Quad core Cortex A53) — `aarch64` |
| OS | Buildroot |

```text
# LAN:
ssh -p 22 -i ~/.ssh/mkddc24_som root@192.168.1.16

# WAN (DDNS):
ssh -p 2222 -i ~/.ssh/mkddc24_som root@mekong-fac.ddns.net
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
npm run build
```

Kỳ vọng: `npm run build` pass (gồm contracts, tsc, vite, bundle budget). Output
tại `build/web-ui/dist/`.

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

```bash
$SSH $FOXLINX '
  chmod +x /opt/mkddc-web/mkddc-web
  chown mkddc:mkddc /opt/mkddc-web/mkddc-web
  chown -R mkddc:mkddc /opt/mkddc-web/dist

  . /tmp/mkddc-web-run/jwt.env 2>/dev/null || true
  cd /opt/mkddc-web
  nohup su -s /bin/sh mkddc -c "
    JWT_SECRET=\"${JWT_SECRET}\" \
    USERS_CONF=/data/config/users.conf \
    CONFIG_DIR=/data/config \
    STATE_DIR=/data/mkddc/state \
    PROGRAMMING_STATE_DIR=/data/mkddc/state/programming \
    CORE_SOCK=/run/mkddc/core.sock \
    PROGRAMMING_REV_A=1 \
    PROGRAMMING_SOCKET=/run/mkddc/programming-v1.sock \
    PROGRAMMING_SIM_WORKER=/opt/mkddc-web/mkddc-programming-sim-worker \
    PROGRAMMING_COMPILER=/usr/sbin/mkddc-st-compile \
    PROGRAMMING_PACKAGER=/usr/sbin/mkddc-st-package \
    PORT=8082 \
    WEB_UI_DIR=/opt/mkddc-web/dist \
    /opt/mkddc-web/mkddc-web \
  " > /tmp/mkddc-web-deploy.log 2>&1 &

  sleep 3
  pgrep -x mkddc-web && echo PROCESS_OK || echo PROCESS_FAIL
'
```

Kỳ vọng: `PROCESS_OK`.

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
'
```

Kỳ vọng:

- Health: tất cả checks `ok`
- Login: role `admin`, token hợp lệ
- Programming: `targetState: READY`, languages `ST` + `FBD`
- FE: HTML `<html lang="vi">` được serve

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
