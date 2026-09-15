---
name: foxlinx-deploy
description: Deploy code hiện tại (Go backend + FE) lên board Foxlinx (SOM-DDC-24-foxlinx). Dùng khi user nói "deploy lên foxlinx", "cập nhật foxlinx", hoặc tương tự. Hướng dẫn chi tiết tại docs/03_implementation/DEPLOY_FOXLINX.md.
---

# Deploy lên Foxlinx

Authority: [`docs/03_implementation/DEPLOY_FOXLINX.md`](../../../docs/03_implementation/DEPLOY_FOXLINX.md).

## Thông tin kết nối

```
Host: mekong-fac.ddns.net
Port: 2223
User: root
Key:  ~/.ssh/mkddc24_som
Arch: aarch64 (Rockchip RV1126B, Buildroot)
```

## Quy trình

Thực hiện **tuần tự** — mỗi bước phụ thuộc bước trước:

### 1. Kiểm tra kết nối

```bash
ssh -p 2223 -i ~/.ssh/mkddc24_som -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null root@mekong-fac.ddns.net 'uname -m && echo SSH_OK'
```

Nếu thất bại: báo user, không tiếp tục.

### 2. Build Go backend

```bash
cd apps/web-api
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -o /tmp/mkddc-web-foxlinx ./cmd/mkddc-web
```

### 3. Build FE

```bash
cd apps/web-ui
npm run build
```

Phải pass cả bundle budget. Nếu build thất bại: dừng, không deploy.

### 4. Backup + dừng process trên board

```bash
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
FOXLINX="root@mekong-fac.ddns.net"
SSH="ssh -p 2223 -i ~/.ssh/mkddc24_som -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

$SSH $FOXLINX "
  cp /opt/mkddc-web/mkddc-web /opt/mkddc-web/mkddc-web.bak-${TIMESTAMP}
  mv /opt/mkddc-web/dist /opt/mkddc-web/dist.bak-${TIMESTAMP} 2>/dev/null || true
  pkill -x mkddc-web 2>/dev/null || true
  sleep 1
  pgrep -x mkddc-web && echo STILL_RUNNING || echo STOPPED
"
```

### 5. Copy artifacts

```bash
SCP="scp -P 2223 -i ~/.ssh/mkddc24_som -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

$SCP /tmp/mkddc-web-foxlinx ${FOXLINX}:/opt/mkddc-web/mkddc-web
$SCP -r build/web-ui/dist ${FOXLINX}:/opt/mkddc-web/dist
```

`scp` dùng `-P` (uppercase) cho port.

### 6. Phân quyền + khởi động lại

```bash
$SSH $FOXLINX '
  chmod +x /opt/mkddc-web/mkddc-web
  chown mkddc:mkddc /opt/mkddc-web/mkddc-web
  chown -R mkddc:mkddc /opt/mkddc-web/dist

  cd /opt/mkddc-web
  nohup su -s /bin/sh mkddc -c "
    JWT_SECRET=\"$(cat /data/mkddc/jwt.secret 2>/dev/null || echo placeholder)\" \
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
    PORT=8081 \
    WEB_UI_DIR=/opt/mkddc-web/dist \
    /opt/mkddc-web/mkddc-web \
  " > /tmp/mkddc-web-deploy.log 2>&1 &

  sleep 3
  pgrep -x mkddc-web && echo PROCESS_OK || echo PROCESS_FAIL
'
```

> **Bảo mật:** JWT_SECRET đã provision sẵn trên board. Không ghi giá trị vào
> command output hay repo. Nếu `jwt.secret` file không tồn tại, đọc từ env
> của process cũ qua `/proc/<pid>/environ` trước khi kill.

### 7. Smoke test

Board không có `curl` — dùng `wget`:

```bash
$SSH $FOXLINX '
  wget -q -O - http://127.0.0.1:8081/api/v1/health
  echo ""
  wget -q -O /tmp/login.json \
    --post-data="{\"username\":\"admin\",\"password\":\"admin123\"}" \
    --header="Content-Type: application/json" \
    http://127.0.0.1:8081/api/v1/auth/login
  TOKEN=$(sed "s/.*\"token\":\"\([^\"]*\)\".*/\1/" /tmp/login.json)
  wget -q -O - --header="Authorization: Bearer $TOKEN" \
    http://127.0.0.1:8081/api/v1/programming/capabilities | head -c 300
  echo ""
  wget -q -O - http://127.0.0.1:8081/ | head -c 100
  echo ""
'
```

Kỳ vọng:
- Health: tất cả checks `ok`
- Login: role `admin`
- Programming: `targetState: READY`
- FE: `<html lang="vi">`

### 8. Báo kết quả

Báo user kèm:
- Commit SHA đã deploy
- Kết quả health/login/programming
- Timestamp backup (để rollback nếu cần)

## Ràng buộc

- **Không merge, không push** — skill này chỉ deploy code hiện có trên local.
- **Không sửa code** — nếu build thất bại, báo lỗi và dừng.
- **Không ghi secret** vào repo, command history hay output hiển thị cho user.
- **Luôn backup** trước khi ghi đè binary/dist.
- **Binary đang chạy** thì `scp` thất bại — phải `pkill` trước.

## Rollback

```bash
TIMESTAMP="<timestamp-backup>"
$SSH $FOXLINX "
  pkill -x mkddc-web || true; sleep 1
  cp /opt/mkddc-web/mkddc-web.bak-${TIMESTAMP} /opt/mkddc-web/mkddc-web
  rm -rf /opt/mkddc-web/dist
  mv /opt/mkddc-web/dist.bak-${TIMESTAMP} /opt/mkddc-web/dist
"
# Rồi chạy lại bước 6 để khởi động
```
