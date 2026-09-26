---
name: foxlinx-deploy
description: Deploy code hiện tại (Go backend + FE, kèm tool ST khi lệch profile) lên board Foxlinx (SOM-DDC-24-foxlinx). Dùng khi user nói "deploy lên foxlinx", "cập nhật foxlinx", hoặc tương tự. Hướng dẫn chi tiết tại docs/03_implementation/DEPLOY_FOXLINX.md.
---

# Deploy lên Foxlinx

Authority: [`docs/03_implementation/DEPLOY_FOXLINX.md`](../../../docs/03_implementation/DEPLOY_FOXLINX.md).

## Thông tin kết nối

```
Host: 192.168.1.16 (LAN) / mekong-fac.ddns.net (WAN)
Port: 22 (LAN) / 2223 (WAN)
User: root
Key:  ~/.ssh/mkddc24_som
Arch: aarch64 (Rockchip RV1126B, Buildroot)
Web:  http://192.168.1.16:8082 / http://mekong-fac.ddns.net:8082
```

## Quy trình

Thực hiện **tuần tự** — mỗi bước phụ thuộc bước trước:

### 1. Kiểm tra kết nối

```bash
ssh -p 22 -i ~/.ssh/mkddc24_som -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null root@192.168.1.16 'uname -m && echo SSH_OK'
```

Nếu thất bại qua LAN: thử fallback qua WAN `ssh -p 2223 ... root@mekong-fac.ddns.net`. Nếu cả hai thất bại: báo user, không tiếp tục.

### 2. Build Go backend

```bash
cd apps/web-api
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -o /tmp/mkddc-web-foxlinx ./cmd/mkddc-web
```

### 3. Build FE

```bash
cd apps/web-ui
VITE_PROGRAMS_WORKSPACE_V2=1 npm run build:release
```

Phải pass cả bundle budget. Nếu build thất bại: dừng, không deploy. Không dùng
`npm run build` trơn: bản đó thiếu Programming.

### 3b. Kiểm tool ST cùng profile với web (BẮT BUỘC)

```bash
grep 'ProfileSHA256 ' apps/web-api/internal/programming/domain/profile_generated.go
$SSH $FOXLINX '/usr/sbin/mkddc-st-compile --version; /usr/sbin/mkddc-st-package --version'
```

`profile_sha256` khác nhau ⇒ Check trên bo sẽ hỏng (`ST-WORKER-TOOLCHAIN`, bản cũ
hơn thì treo 30 s rồi `ST-WORKER-CRASH`). Làm theo bước 2b của
`DEPLOY_FOXLINX.md`: cross-build `mkddc-st-compile`, `mkddc-st-package`,
`mkddc-st-validate`, backup rồi `install` vào `/usr/sbin`. Profile đổi thì core
cũng phải cùng bản: dừng lại và deploy cả core/iobus, đừng chỉ deploy web.

### 4. Backup + dừng process trên board

```bash
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
FOXLINX="root@192.168.1.16"
SSH="ssh -p 22 -i ~/.ssh/mkddc24_som -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

$SSH $FOXLINX "
  cp /opt/mkddc-web/mkddc-web /opt/mkddc-web/mkddc-web.bak-${TIMESTAMP}
  cp -r /opt/mkddc-web/dist /opt/mkddc-web/dist.bak-${TIMESTAMP} 2>/dev/null || true
  rm -rf /opt/mkddc-web/dist

  systemctl stop mkddc-web-pi mkddc-reload-helper mkddc-time-helper 2>/dev/null || true
  pkill -9 -x mkddc-web 2>/dev/null || true
  sleep 1
  pgrep -x mkddc-web && echo STILL_RUNNING || echo ALL_STOPPED
"
```

### 5. Copy artifacts

```bash
SCP="scp -P 22 -i ~/.ssh/mkddc24_som -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

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

  systemctl start mkddc-reload-helper mkddc-time-helper mkddc-web-pi
  sleep 20   # web cần ~16 s mới listen
  systemctl is-active mkddc-web-pi && echo SYSTEMD_OK || echo SYSTEMD_FAIL
  pgrep -u mkddc -x mkddc-web && echo PROCESS_OK || echo PROCESS_FAIL
'
```

### 7. Smoke test

Board không có `curl` — dùng `wget` (busybox), kiểm tra port 8082:

```bash
$SSH $FOXLINX '
  wget -q -O - http://127.0.0.1:8082/api/v1/health
  echo ""
  wget -q -O /tmp/login.json \
    --post-data="{\"username\":\"admin\",\"password\":\"admin123\"}" \
    --header="Content-Type: application/json" \
    http://127.0.0.1:8082/api/v1/auth/login
  TOKEN=$(sed "s/.*\"token\":\"\([^\"]*\)\".*/\1/" /tmp/login.json)
  wget -q -O - --header="Authorization: Bearer $TOKEN" \
    http://127.0.0.1:8082/api/v1/programming/capabilities | head -c 300
  echo ""
  wget -q -O - http://127.0.0.1:8082/ | head -c 100
  echo ""
  journalctl -u mkddc-web-pi -b --no-pager | grep "programming.toolchain" | tail -1
'
```

Kỳ vọng:
- Health: tất cả checks `ok`
- Login: role `admin`
- Programming: `targetState: READY`
- FE: `<html lang="vi">`
- Toolchain: `INFO programming.toolchain ok`. Gặp `ERROR programming.toolchain` là chưa xong, quay lại bước 3b.

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
