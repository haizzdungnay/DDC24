# 27 — SOM Board Deploy Runbook
## MK-DDC-24 — Build/deploy lên board SOM (lab và production)

> **Document ID:** IMPL-SOM-DEPLOY-MK-DDC-24-VI
> **Phiên bản:** 1.11 | 2026-08-04
> **Trạng thái:** Active — SOP cho team build/deploy SOM
> **Owner:** Dev 2 + DevOps/QA
> **Scope:** board SOM truy cập qua SSH; deploy/test `mkddc-iobus`, `mkddc-core`, `mkddc-netcfg`, `mkddc-web`, frontend cùng-origin, fake MCU (lab) hoặc MCU thật (production) và cài hostname provisioning tool/template. Install không tự apply hostname.
> **Không scope:** thay đổi IP production khi chưa có cửa sổ commissioning/HIL được phê duyệt.

---

## 1. Thông tin board thực tế

### 1a. Board chính — Foxlinx SOM-DDC-24 (production, có MCU STM32)

| Hạng mục | Giá trị |
|---|---|
| Board | Foxlinx SOM-DDC-24 |
| Vai trò | **Board chính dự án** — production target, có MCU STM32 thật |
| CPU | aarch64 |
| SSH | `root@mekong-fac.ddns.net:2223` (alias `SOM-DDC-24-foxlinx`) |
| MCU | STM32 thật, UART `/dev/ttyS2`, kết nối qua ADUM1201 |
| Fake MCU | Không dùng — MCU thật có mặt |

> **Lưu ý bảo mật:** Board chính hiện dùng user `root` với password. Cần chuyển sang
> key-based auth và tạo user hạn quyền cho deploy thường xuyên. Xem §2a.

**Quyết định đã chốt:**

| Hạng mục | Quyết định |
|---|---|
| SSH auth | Password auth tạm (`admin123`); **ưu tiên chuyển key-based** khi chuẩn hóa |
| MCU | MCU STM32 thật — không cần fake MCU stack |
| Install | `packaging/install.sh` (production, không `--no-enable`) hoặc `--no-enable` cho lần đầu |
| UART | `/dev/ttyS2` @ 921600 baud, qua ADUM1201 isolation |

---

### 1b. Board lab — Orange Pi 5B (DEPRECATED - NGƯNG SỬ DỤNG TỪ 2026-08-05)

> [!WARNING]
> **TÀI LIỆU DI SẢN (DEPRECATED):** Bo mạch **Orange Pi 5B (alias `SOM-DDC-24`, port 2222, Debian 12)** đã chính thức **ngưng sử dụng từ 2026-08-05**.
> Toàn bộ quy trình deploy, build và vận hành hiện tại chuyển sang **Foxlinx SOM-DDC-24 (`SOM-DDC-24-foxlinx`, port 2223, Buildroot)**. Vui lòng tham khảo bộ tài liệu chuẩn mới tại [docs/08_hardware/foxlinx-som-ddc24/](../08_hardware/foxlinx-som-ddc24/README.md) và [FOXLINX_DEPLOY_CHECKLIST.md](../08_hardware/foxlinx-som-ddc24/FOXLINX_DEPLOY_CHECKLIST.md).

| Hạng mục | Giá trị |
|---|---|
| Board | Orange Pi 5B (DEPRECATED) |
| Vai trò | **Di sản (Deprecated)** — Đã thay thế bằng Foxlinx SOM-DDC-24 |
| CPU | Rockchip RK3588, aarch64 |
| OS | Orange Pi 1.0.8 Bookworm (Debian 12) |
| Kernel | 6.1.43-rockchip-rk3588 |
| SSH | `orangepi@mekong-fac.ddns.net:2222` (alias `SOM-DDC-24`) |
| RT scheduling | Kernel không hỗ trợ `SCHED_FIFO` priority cao → WARN + fallback `SCHED_OTHER` (bình thường cho lab) |
| Fake MCU stack | 4 systemd service tự start sau reboot (xem §7b) |

**Quyết định đã chốt:**

| Hạng mục | Quyết định |
|---|---|
| SSH auth | Key-based (`~/.ssh/mkddc24_som`); password không commit vào repo/log |
| Fake MCU | Chạy dưới systemd (4 service), tự start sau reboot — không dùng manual `run_noboard_demo.sh` cho lab thường xuyên |
| Install | `packaging/install.sh --no-enable` + thêm drop-in override cho fake MCU stack |
| RT scheduling | Drop-in `nofifo.conf` tắt `SCHED_FIFO` trên Orange Pi kernel |

---

## 2. SSH setup (một lần mỗi thành viên)

### 2a. Board chính — Foxlinx SOM-DDC-24-foxlinx (port 2223)

**Config trên máy dev** (`~/.ssh/config`):

```sshconfig
Host SOM-DDC-24-foxlinx
  HostName mekong-fac.ddns.net
  User root
  Port 2223
  StrictHostKeyChecking no
  UserKnownHostsFile=/dev/null
```

> **Password:** `admin123` — nhập khi SSH hỏi. **Không** gõ password vào command line.
>
> **Khuyến nghị hardening cho production:**
> 1. Tạo user deploy riêng (không dùng root trực tiếp cho deploy hàng ngày)
> 2. Chuyển sang key-based auth sau khi ổn định
> 3. Bật `StrictHostKeyChecking accept-new` sau lần kết nối đầu

**Verify:**

```bash
ssh SOM-DDC-24-foxlinx "echo OK && uname -a"
# → OK + thông tin kernel (aarch64)
```

**Chuẩn bị trước khi deploy lên board chính:**

```bash
# 1. Kiểm tra kết nối SSH
ssh SOM-DDC-24-foxlinx "echo OK && uname -a && date -Is"

# 2. Ghi nhận môi trường board
ssh SOM-DDC-24-foxlinx "hostnamectl && cat /etc/os-release | head -5 && df -h / /data"

# 3. Kiểm tra MCU UART
ssh SOM-DDC-24-foxlinx "ls -l /dev/ttyS2 && stty -F /dev/ttyS2"

# 4. Kiểm tra service hiện tại (nếu đã từng deploy)
ssh SOM-DDC-24-foxlinx 'systemctl list-units "mkddc*" --no-legend 2>/dev/null || echo "Chưa có service mkddc"'

# 5. Backup config/data nếu có
ssh SOM-DDC-24-foxlinx "test -d /data/config && tar -czf /tmp/config-backup-$(date +%Y%m%dT%H%M%S).tar.gz /data/config /data/mkddc 2>/dev/null && echo 'Backup OK' || echo 'Chưa có data cần backup'"
```

**Windows PowerShell:**

```powershell
# Verify kết nối
ssh -p 2223 root@mekong-fac.ddns.net "echo OK && uname -a"
# Nhập password: admin123
```

> ⚠️ **Board chính có MCU thật.** Khi deploy, các service sẽ tương tác với MCU STM32
> qua UART `/dev/ttyS2`. Không cần fake MCU stack (§7b). Các bước §3–§6 áp dụng như
> bình thường, bỏ qua drop-in `nomcu.conf` và `nofifo.conf` (trừ khi kernel không hỗ
> trợ RT). Sau install, chuyển thẳng sang §8 (production với MCU).

---

### 2b. Board lab — Orange Pi 5B SOM-DDC-24 (port 2222)

**Config trên máy dev** (`~/.ssh/config`):

```sshconfig
Host SOM-DDC-24
  HostName mekong-fac.ddns.net
  User orangepi
  Port 2222
  IdentityFile ~/.ssh/mkddc24_som
  StrictHostKeyChecking accept-new
  ServerAliveInterval 30
  ServerAliveCountMax 3
```

**Tạo key + copy lên board** (cần nhập password board khi hỏi):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/mkddc24_som -C "mkddc24-som-<ten>" -N ""
ssh-copy-id -p 2222 -i ~/.ssh/mkddc24_som.pub orangepi@mekong-fac.ddns.net
```

> **Lưu ý:** `ssh-copy-id` sẽ hỏi password board — nhập tay, không gõ password vào command line hay script.

**Verify:**

```bash
ssh SOM-DDC-24 "echo OK && uname -a"
# → OK + thông tin kernel, không hỏi password
```

**Windows PowerShell** (thay `ssh-copy-id`):

```powershell
type $env:USERPROFILE\.ssh\mkddc24_som.pub | ssh -p 2222 orangepi@mekong-fac.ddns.net "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"
```

**Board hardening** sau khi key hoạt động:

```bash
ssh SOM-DDC-24
sudo passwd -l root || true
sudo sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl reload ssh || sudo systemctl reload sshd
```

---

## 3. Board bootstrap (một lần)

Ghi nhận môi trường:

```bash
ssh SOM-DDC-24 "hostnamectl && uname -a && cat /etc/os-release | head -5 && date -Is"
```

Cài toolchain (từ máy dev qua SSH):

```bash
ssh SOM-DDC-24 "sudo apt-get update -qq && sudo apt-get install -y --no-install-recommends \
  git cmake build-essential g++ pkg-config ninja-build \
  socat python3 avahi-daemon libnss-mdns \
  libgtest-dev"
```

> Nếu `apt` không có `libgtest-dev`, CMake tự tải GoogleTest qua `FetchContent` khi có network.

Verify:

```bash
ssh SOM-DDC-24 "cmake --version | head -1 && g++ --version | head -1 && socat -V 2>&1 | head -1"
# cmake version 3.25.1 / g++ 12.2.0 / socat ...
```

---

## 4. Đồng bộ source lên SOM

Dùng `rsync` từ **máy dev** (SSH alias đã setup ở §2):

```bash
cd ~/Desktop/DDC-PROJECT   # hoặc root repo trên máy dev
rsync -az --delete \
  --exclude build --exclude logs --exclude .git \
  ./ SOM-DDC-24:~/work/DDC-PROJECT/
git rev-parse HEAD | ssh SOM-DDC-24 "cat > ~/work/DDC-PROJECT/DEPLOYED_COMMIT"
```

> **Tại sao rsync?** Không dùng `scp -r` (dễ sót file cũ) và không git clone trên board (key chưa setup cho SOM→GitHub). Rsync incremental — lần sau chỉ gửi diff.

Verify trên board:

```bash
ssh SOM-DDC-24 "ls ~/work/DDC-PROJECT/services/"
# CMakeLists.txt  core  iobus
```

---

## 5. Build + unit test trên SOM

```bash
ssh SOM-DDC-24 "cd ~/work/DDC-PROJECT && \
  cmake -S services -B build/services -DCMAKE_BUILD_TYPE=Release \
    -DIOBUS_BUILD_TESTS=ON -DCORE_BUILD_TESTS=ON && \
  cmake --build build/services -j\$(nproc) && \
  ctest --test-dir build/services --output-on-failure"
```

**Pass criteria (đã verify 2026-06-13):**

```text
- build/services/iobus/mkddc-iobus   ← executable aarch64
- build/services/core/mkddc-core     ← executable aarch64
- build/services/iobus/fake_mcu      ← executable aarch64
- build/services/iobus/shm_dump_io   ← executable aarch64
- ctest: 141/141 tests PASS (2.67s trên Orange Pi 5B)
```

Emergency build (không test, chỉ để debug compile):

```bash
ssh SOM-DDC-24 "cd ~/work/DDC-PROJECT && \
  cmake -S services -B build/services -DCMAKE_BUILD_TYPE=Release \
    -DIOBUS_BUILD_TESTS=OFF -DCORE_BUILD_TESTS=OFF && \
  cmake --build build/services -j\$(nproc)"
```

---

## 6. Install lên board (--no-enable)

Chạy từ máy dev:

```bash
ssh SOM-DDC-24 "cd ~/work/DDC-PROJECT && sudo packaging/install.sh --no-enable"
```

**Pass criteria:**

```bash
ssh SOM-DDC-24 "
ls -la /usr/sbin/mkddc-iobus /usr/sbin/mkddc-core &&
ls /etc/systemd/system/mkddc-{iobus,core}.service &&
id mkddc &&
ls -d /data/config /data/mkddc"
# mkddc: uid=999 gid=995 groups=995(mkddc),20(dialout)
# /data/config /data/mkddc tồn tại
```

Validate unit file (không có output = OK):

```bash
ssh SOM-DDC-24 "systemd-analyze verify \
  /etc/systemd/system/mkddc-iobus.service \
  /etc/systemd/system/mkddc-core.service"
```

---

## 6b. Web cùng-origin và hostname cố định

Production không chạy Vite như một service riêng. Go `mkddc-web` phục vụ frontend đã build trong
`/opt/mkddc-web/dist`; frontend gọi REST/WebSocket bằng đường dẫn tương đối trên cùng origin:

```text
Browser → http://mkddc-<serial>.local:8081
        → mkddc-web (dist + /api/v1 + WebSocket)
        → /run/mkddc-netcfg/netcfg.sock
        → NetworkManager/kernel trên Orange Pi
```

`GET /api/v1/network/transaction` trả `management.hostname`, `mdnsName`, `stable` chỉ đọc.
Không API/HMI candidate nào được đổi management hostname. Chỉ
`packaging/configure-web-hostname.sh` được phép provision/rollback stable origin; package
install chỉ đặt script/template, không chạy `--apply`.

Production build phải bỏ `VITE_API_ORIGIN` và `VITE_WS_ORIGIN`. Build sẽ fail nếu hai biến này
được hardcode vì đổi IP sẽ tạo origin cũ không thể tự phục hồi:

```bash
cd src/frontend
env -u VITE_API_ORIGIN -u VITE_WS_ORIGIN npm run build
```

Chọn hostname từ serial/asset ID, chỉ gồm một DNS label chữ thường, số và dấu gạch ngang. Không
dùng hostname chung như `mkddc.local` cho nhiều controller trên cùng LAN.

Preflight chỉ đọc, không đổi hostname/IP:

```bash
ssh SOM-DDC-24 "cd ~/work/DDC-PROJECT && \
  bash packaging/configure-web-hostname.sh --check mkddc-<serial> 8081"
```

Apply hostname và publish `_http._tcp` qua Avahi. Lệnh này đổi hostname hệ điều hành nhưng không
đổi địa chỉ IP; script fail-closed nếu thiếu `avahi-daemon`, lưu hostname cũ tại
`/data/mkddc/hostname-before-mdns` và tự phục hồi nếu apply lỗi giữa chừng:

```bash
ssh SOM-DDC-24 "cd ~/work/DDC-PROJECT && \
  sudo bash packaging/configure-web-hostname.sh --apply mkddc-<serial> 8081"
```

Verify trên board:

```bash
ssh SOM-DDC-24 "hostnamectl --static && \
  systemctl is-active avahi-daemon mkddc-web-pi && \
  grep -F '<port>8081</port>' /etc/avahi/services/mkddc-web.service"
```

Verify từ máy commissioning trên cùng LAN/VLAN:

```bash
curl -fsS http://mkddc-<serial>.local:8081/login >/dev/null
```

Pass khi browser mở được `/login` bằng hostname, login/API hoạt động cùng hostname và DevTools
không có request tới IP hardcode. Không claim hoàn thành IP handoff từ bước này.

### 6c. SOP deploy riêng Network + Web + hostname từ Windows

Dùng quy trình này khi chỉ phát hành Network, không ghi đè `iobus`, `core`, HMI hoặc source đang được
nhóm khác làm. Không chạy `packaging/install.sh` cho một release Network-only vì script đó cài đồng
thời nhiều service. FE local là nguồn chuẩn; build production trực tiếp từ worktree đã review.

Thiết lập biến PowerShell trên máy dev:

```powershell
$Repo = (Get-Location).Path
$Target = "orangepi@192.168.1.18"
$Key = "$env:USERPROFILE\.ssh\mkddc24_som"
$HostLabel = "orangepi5b"       # thay bằng serial/asset ID đã duyệt nếu cần
$Release = Get-Date -Format "yyyyMMddTHHmmss"
$Out = Join-Path $env:TEMP "mkddc-network-$Release"
New-Item -ItemType Directory -Path $Out | Out-Null
```

Preflight chỉ đọc. Ghi lại interface mang IP quản trị và interface mà `mkddc-netcfg` được phép quản lý;
hai interface có thể khác nhau:

```powershell
ssh -i $Key -o BatchMode=yes $Target "hostnamectl --static; uname -m; \
  ip -4 -br addr; cat /etc/mkddc/netcfg.conf; \
  systemctl is-active mkddc-netcfg mkddc-web-pi avahi-daemon 2>&1 || true; \
  sha256sum /usr/sbin/mkddc-netcfg /opt/mkddc-web/mkddc-web; \
  df -h / /opt /data"
```

Build FE cùng-origin và BE Linux/ARM64:

```powershell
Push-Location "$Repo\src\frontend"
Remove-Item Env:VITE_API_ORIGIN -ErrorAction SilentlyContinue
Remove-Item Env:VITE_WS_ORIGIN -ErrorAction SilentlyContinue
npm run build
Pop-Location

Push-Location "$Repo\web\backend"
$env:GOOS = "linux"
$env:GOARCH = "arm64"
$env:CGO_ENABLED = "0"
go build -trimpath -ldflags="-s -w" -o "$Out\mkddc-web-arm64" .
Pop-Location

tar -czf "$Out\frontend-dist.tar.gz" -C "$Repo\src\frontend" dist
Get-FileHash -Algorithm SHA256 "$Out\mkddc-web-arm64", "$Out\frontend-dist.tar.gz"
```

Build `mkddc-netcfg` native aarch64 trên board trong thư mục tạm, không đồng bộ/xóa toàn repo:

```powershell
ssh -i $Key $Target "rm -rf /tmp/mkddc-netcfg-$Release && mkdir -p /tmp/mkddc-netcfg-$Release"
scp -i $Key "$Repo\services\netcfg\CMakeLists.txt" `
  "$Repo\services\netcfg\main.cpp" "$Repo\services\netcfg\netcfg.cpp" `
  "$Repo\services\netcfg\netcfg.hpp" "${Target}:/tmp/mkddc-netcfg-$Release/"
ssh -i $Key $Target "cmake -S /tmp/mkddc-netcfg-$Release \
  -B /tmp/mkddc-netcfg-$Release/build -DCMAKE_BUILD_TYPE=Release \
  -DNETCFG_BUILD_TESTS=OFF && cmake --build /tmp/mkddc-netcfg-$Release/build -j2 && \
  file /tmp/mkddc-netcfg-$Release/build/mkddc-netcfg && \
  sha256sum /tmp/mkddc-netcfg-$Release/build/mkddc-netcfg"
```

Cài dependency mDNS một lần. `--check` phải chạy trước khi dừng service:

```powershell
ssh -i $Key $Target "sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y `
  --no-install-recommends avahi-daemon libnss-mdns"
ssh -i $Key $Target "cd ~/work/DDC-PROJECT && `
  bash packaging/configure-web-hostname.sh --check $HostLabel 8081"
```

Upload candidate. Trên board phải tạo backup timestamp dưới
`/data/mkddc/deploy-backups/network-$Release` trước khi `systemctl stop`; backup tối thiểu gồm hai
binary, toàn bộ `dist`, drop-in Web, hostname, Avahi state/service và SHA-256 candidate:

```powershell
scp -i $Key "$Out\mkddc-web-arm64" "$Out\frontend-dist.tar.gz" `
  "$Repo\packaging\configure-web-hostname.sh" `
  "$Repo\packaging\avahi\mkddc-web.service" `
  "$Repo\packaging\systemd\mkddc-web-pi-netcfg.conf" "${Target}:/tmp/"
```

SSH vào board, chạy block dưới bằng root và thay `<Release>` bằng đúng giá trị PowerShell đã in ra.
Block chỉ chạm Network/Web/hostname; không cài binary của service khác:

```bash
sudo bash
set -Eeuo pipefail
release='<Release>'
host_label='orangepi5b'
backup="/data/mkddc/deploy-backups/network-${release}"
netcfg_candidate="/tmp/mkddc-netcfg-${release}/build/mkddc-netcfg"

test -x "$netcfg_candidate"
test -s /tmp/mkddc-web-arm64
test -s /tmp/frontend-dist.tar.gz
install -d -m 0750 -o root -g root "$backup/files/usr/sbin" \
  "$backup/files/opt/mkddc-web" \
  "$backup/files/etc/systemd/system/mkddc-web-pi.service.d"
hostnamectl --static > "$backup/hostname-before.txt"
systemctl is-active mkddc-netcfg mkddc-web-pi > "$backup/service-active-before.txt"
systemctl is-enabled avahi-daemon > "$backup/avahi-enabled-before.txt" 2>&1 || true
systemctl is-active avahi-daemon > "$backup/avahi-active-before.txt" 2>&1 || true
sha256sum "$netcfg_candidate" /tmp/mkddc-web-arm64 /tmp/frontend-dist.tar.gz \
  > "$backup/staged-sha256.txt"
sha256sum /usr/sbin/mkddc-netcfg /opt/mkddc-web/mkddc-web \
  > "$backup/installed-sha256-before.txt"
cp -a /usr/sbin/mkddc-netcfg "$backup/files/usr/sbin/"
cp -a /opt/mkddc-web/mkddc-web "$backup/files/opt/mkddc-web/"
cp -a /etc/systemd/system/mkddc-web-pi.service.d/netcfg.conf \
  "$backup/files/etc/systemd/system/mkddc-web-pi.service.d/"
touch "$backup/present-before.txt"
for path in /usr/libexec/mkddc/configure-web-hostname \
  /usr/share/mkddc/avahi/mkddc-web.service \
  /etc/avahi/services/mkddc-web.service \
  /data/mkddc/hostname-before-mdns; do
  if [ -e "$path" ]; then
    rel="${path#/}"
    install -d -m 0750 "$backup/files/$(dirname "$rel")"
    cp -a "$path" "$backup/files/$rel"
    printf '%s\n' "$path" >> "$backup/present-before.txt"
  fi
done

systemctl stop mkddc-web-pi
systemctl stop mkddc-netcfg
mv /opt/mkddc-web/dist "$backup/dist-before"
install -m 0755 "$netcfg_candidate" /usr/sbin/mkddc-netcfg
install -m 0755 /tmp/mkddc-web-arm64 /opt/mkddc-web/mkddc-web
tar -xzf /tmp/frontend-dist.tar.gz -C /opt/mkddc-web
chown -R root:root /opt/mkddc-web/dist
find /opt/mkddc-web/dist -type d -exec chmod 0755 {} +
find /opt/mkddc-web/dist -type f -exec chmod 0644 {} +
install -d -m 0755 /usr/libexec/mkddc /usr/share/mkddc/avahi \
  /etc/systemd/system/mkddc-web-pi.service.d /etc/avahi/services
install -m 0755 /tmp/configure-web-hostname.sh \
  /usr/libexec/mkddc/configure-web-hostname
install -m 0644 /tmp/mkddc-web.service \
  /usr/share/mkddc/avahi/mkddc-web.service
install -m 0644 /tmp/mkddc-web-pi-netcfg.conf \
  /etc/systemd/system/mkddc-web-pi.service.d/netcfg.conf
systemctl daemon-reload
systemctl start mkddc-netcfg
systemctl start mkddc-web-pi
systemctl is-active mkddc-netcfg mkddc-web-pi
/usr/libexec/mkddc/configure-web-hostname --check "$host_label" 8081
/usr/libexec/mkddc/configure-web-hostname --apply "$host_label" 8081
systemctl is-active avahi-daemon mkddc-netcfg mkddc-web-pi
exit
```

Thứ tự thay artifact bắt buộc trong cùng một maintenance window:

1. Backup rồi dừng `mkddc-web-pi` trước, dừng `mkddc-netcfg` sau.
2. Cài helper aarch64 vào `/usr/sbin/mkddc-netcfg`, BE vào `/opt/mkddc-web/mkddc-web`.
3. Di chuyển `dist` cũ vào backup, giải nén `frontend-dist.tar.gz` vào `/opt/mkddc-web`.
4. Cài hostname helper/template/drop-in vào các path ở §6b; `systemctl daemon-reload`.
5. Start `mkddc-netcfg` trước, `mkddc-web-pi` sau; cả hai phải `active` mới apply hostname.
6. Chạy `/usr/libexec/mkddc/configure-web-hostname --apply $HostLabel 8081`.
7. Chờ mDNS tối đa 15 giây; không fail chỉ vì lần resolve đầu ngay sau restart Avahi chưa sẵn sàng.

Health-loop trên máy commissioning:

```powershell
$Url = "http://$HostLabel.local:8081/login"
$Ready = $false
foreach ($Attempt in 1..15) {
  curl.exe --noproxy "*" -fsS -o NUL $Url
  if ($LASTEXITCODE -eq 0) { $Ready = $true; break }
  Start-Sleep -Seconds 1
}
if (-not $Ready) { throw "mDNS/Web chưa sẵn sàng: $Url" }
Resolve-DnsName "$HostLabel.local" -Type A
```

Gate sau deploy:

```bash
systemctl is-active mkddc-netcfg mkddc-web-pi avahi-daemon
systemctl is-enabled mkddc-netcfg mkddc-web-pi avahi-daemon
hostnamectl --static
getent hosts <host-label>.local
curl -fsS http://<host-label>.local:8081/login >/dev/null
curl -fsS http://<ip-hien-tai>:8081/login >/dev/null
grep -F '<port>8081</port>' /etc/avahi/services/mkddc-web.service
journalctl -u mkddc-netcfg -u mkddc-web-pi -u avahi-daemon --since '<gio-deploy>' --no-pager
```

Status trực tiếp qua `/run/mkddc-netcfg/netcfg.sock` phải có `version=1`, `result=accepted`,
`reasonCode=OK`, exact capabilities `dns,management-hostname`, `state=idle` và
`management={hostname,mdnsName,stable:true}`. `active.reasonCode=NO_CARRIER` là đúng nếu Ethernet
được quản lý chưa cắm cáp; không được coi đó là lỗi mDNS/Web.

Rollback đúng release nếu bất kỳ gate nào fail. Không xóa backup; `dist` lỗi được giữ lại để điều tra:

```bash
sudo bash
set -Eeuo pipefail
release='<Release>'
backup="/data/mkddc/deploy-backups/network-${release}"
test -d "$backup"
test -x "$backup/files/usr/sbin/mkddc-netcfg"
test -x "$backup/files/opt/mkddc-web/mkddc-web"
test -d "$backup/dist-before"
systemctl stop mkddc-web-pi mkddc-netcfg
mv /opt/mkddc-web/dist "/opt/mkddc-web/dist.failed-${release}"
mv "$backup/dist-before" /opt/mkddc-web/dist
install -m 0755 "$backup/files/usr/sbin/mkddc-netcfg" /usr/sbin/mkddc-netcfg
install -m 0755 "$backup/files/opt/mkddc-web/mkddc-web" /opt/mkddc-web/mkddc-web
install -m 0644 \
  "$backup/files/etc/systemd/system/mkddc-web-pi.service.d/netcfg.conf" \
  /etc/systemd/system/mkddc-web-pi.service.d/netcfg.conf
for path in /usr/libexec/mkddc/configure-web-hostname \
  /usr/share/mkddc/avahi/mkddc-web.service \
  /etc/avahi/services/mkddc-web.service \
  /data/mkddc/hostname-before-mdns; do
  rel="${path#/}"
  if grep -Fxq "$path" "$backup/present-before.txt"; then
    install -d "$(dirname "$path")"
    cp -a "$backup/files/$rel" "$path"
  else
    rm -f -- "$path"
  fi
done
hostnamectl set-hostname "$(cat "$backup/hostname-before.txt")"
systemctl daemon-reload
systemctl restart avahi-daemon
systemctl start mkddc-netcfg mkddc-web-pi
systemctl is-active avahi-daemon mkddc-netcfg mkddc-web-pi
exit
```

Không tự gỡ `avahi-daemon`/`libnss-mdns` khi rollback artifact: đây là dependency nền tảng nhỏ và việc
gỡ package có thể đổi `nsswitch.conf`. Chỉ gỡ trong maintenance riêng sau khi đã đánh giá client mDNS.

### 6d. Evidence triển khai 2026-07-28

Đã deploy Network-only lên Orange Pi 5B qua `orangepi@192.168.1.18`, không đổi IP:

| Hạng mục | Evidence |
|---|---|
| Stable origin | `http://orangepi5b.local:8081`, Windows resolve A → `192.168.1.18`, `/login` → HTTP 200 |
| Service | `mkddc-netcfg`, `mkddc-web-pi`, `avahi-daemon` đều `active` + `enabled` |
| Helper | SHA-256 `83f9d20663f2c38be50dd1a2bd01e6ba2e1535518f1e34b2fbd5148f34d59e6d` |
| Go BE | SHA-256 `27d53319114b8ed3a7a86a81cf49d0480090f37b505ee1276055d0057117895d` |
| FE tree | SHA-256 tổng hợp `9cd8adde2b1935beaf125a9841a3ce205c3bbeefe9e4529db305df96fd21cf6b` |
| mDNS package | `avahi-daemon 0.8-10+deb12u1`, `libnss-mdns 0.15.1-3` |
| Backup | `/data/mkddc/deploy-backups/network-20260728T1415` |
| Network scope | `mkddc-netcfg` quản lý `end1`; IP quản trị hiện tại `192.168.1.18/24` nằm trên `wlan0` |

Lần smoke đầu ngay sau restart Avahi resolve chưa sẵn sàng; retry sau vài giây pass trên cả board và
Windows. Chưa Stage/Apply/Confirm candidate IPv4/DNS, chưa đổi IP, chưa claim HIL IP handoff.

### Redeploy Network-only bản vá no-carrier/rollback — 2026-07-28T150608

Đã thay đúng helper + FE `dist` trên board, không thay Go BE và không đổi hostname/IP:

| Hạng mục | Evidence |
|---|---|
| Helper ARM64 mới | SHA-256 `8667127633e3a274347d98ca66e2a9a1e7cda5c78e85428e0d2fc718e5e3d7aa`, build native aarch64 trên board |
| FE bundle mới | SHA-256 `8cffbf024347621aa02e9be54f61161d363fb5ce3f2d30c643622c3380465aab`; asset chứa guard cảnh báo `Ethernet link is not ready` |
| Go BE | Giữ nguyên SHA-256 `27d53319114b8ed3a7a86a81cf49d0480090f37b505ee1276055d0057117895d` |
| Backup | `/data/mkddc/deploy-backups/network-20260728T150608` (FE/helper) và `/data/mkddc/deploy-backups/network-20260728T151352` (helper refinement) |
| Runtime | `mkddc-netcfg`, `mkddc-web-pi`, `avahi-daemon` đều `active`; hostname HTTP `/login` và IP HTTP đều 200 |
| Authority sau deploy | `end1` `adminUp=true`, `carrier=false`, `link=down`, `reasonCode=NO_CARRIER`; configured profile DHCP + DNS auto; không có pending candidate |

Transaction journal cũ còn `state=failed` từ lần rollback trước bản vá; đây là trạng thái lịch sử,
không phải pending mutation. Stage transaction mới sẽ thay journal đó. Không chạy đổi IP trong
work session này.

Sau deploy đầu, helper được build lại lần cuối để giữ strict runtime verification cho legacy snapshot
healthy (link `up` + mode hợp lệ + IPv4), dù các cờ carrier cũ bị thiếu; SHA cuối cùng ở bảng trên.

### Test mô phỏng transaction không cần cáp LAN — hoàn tất 2026-07-28

Bài test này chỉ chứng minh flow FE → BE → netcfg → kernel/NetworkManager; không thay thế HIL
cáp/switch, mDNS handoff sang subnet thật hoặc kiểm tra duplicate address trên Ethernet thật.

| Hạng mục | Giá trị |
|---|---|
| Interface authority tạm | `dummy0`, `adminUp=true`, `carrier=true`, `link=up` |
| Baseline | Static `10.77.0.10/24`, gateway rỗng, `ipv4.never-default=yes` |
| Candidate test | Static `10.77.0.20/24`, gateway rỗng, DNS `Preserve profile` |
| Management path | Giữ nguyên `wlan0=192.168.1.18/24` và `orangepi5b.local:8081` |
| Runtime override | `/run/systemd/system/mkddc-netcfg.service.d/90-dummy-test.conf`; không sửa `/etc/mkddc/netcfg.conf` |
| Backup/evidence | `/data/mkddc/deploy-backups/network-dummy-20260728T153142` |
| Journal cũ | Đã lưu thành `netcfg-transaction.failed-before-dummy.json`; authority bắt đầu test ở `state=idle` |
| Cleanup | `restore-end1.sh`, SHA-256 `3a2a6ac2c8a949492e95988da7572a44e6085c935d9fe2482026fad53f05094f` |

Trên FE, hard refresh rồi nhập đúng candidate ở bảng và chạy nhánh rollback trước:

1. `Validate` → `Stage` → `Apply`; form khóa theo pending sau Stage là đúng.
2. Trong countdown, ACTIVE/KERNEL phải chuyển sang `10.77.0.20/24`; Web qua hostname vẫn hoạt động.
3. Bấm `Rollback`; ACTIVE và CONFIGURED PROFILE phải trở lại `10.77.0.10/24`, transaction là
   `rolled_back`, không phải `failed`.
4. Muốn test commit thì lặp lại rồi bấm `Confirm`; CONFIGURED PROFILE phải thành `10.77.0.20/24`.

`dummy0` chỉ tồn tại trong kernel Orange Pi nên PC không ping trực tiếp được `10.77.0.20`; dùng
ACTIVE/KERNEL trên FE hoặc SSH `ip -4 addr show dummy0` làm evidence. Không reboot trong lúc test.
Trước cleanup, không được còn transaction `staged|applying|awaiting_confirmation`; Rollback hoặc chờ
timeout trước. Khôi phục authority về `end1` và xóa profile dummy bằng một lệnh:

```bash
sudo /data/mkddc/deploy-backups/network-dummy-20260728T153142/restore-end1.sh
```

Sau cleanup, refresh FE: authority phải về `end1`; cảnh báo `NO_CARRIER` xuất hiện lại khi chưa có
cáp là đúng. Script giữ journal dummy sau test trong backup và không khôi phục journal `failed` cũ.

Kết quả thực tế: transaction static trên `dummy0` và truy cập Web bằng `orangepi5b.local:8081`
từ Windows đã pass. Teardown trên board đã được kiểm lại: authority về `end1`, state `idle`,
`dummy0` không còn tồn tại và đường quản trị vẫn là `wlan0=192.168.1.18/24`.

Hai host route `/32` tạm trên Windows (`10.77.0.10` và `10.77.0.20` qua `192.168.1.18`) không
thuộc cấu hình Orange Pi. Nếu chúng còn tồn tại, xóa bằng **PowerShell Run as Administrator**:

```powershell
route delete 10.77.0.10
route delete 10.77.0.20
route print 10.77.*
```

### Test đổi IP sau này — chưa chạy trong work session 2026-07-28

Chỉ chạy khi có console hoặc Wi-Fi management dự phòng và máy commissioning có route tới subnet
mới. Mở Web bằng hostname trước khi Stage; không mở bằng IP:

**Điều kiện Ethernet trước `Apply`:** authority phải báo đúng interface quản lý với
`active.adminUp=true` và `active.carrier=true` (khi đó `active.link=up`); không được còn
`ADMIN_DOWN`/`NO_CARRIER`.
FE vẫn cho phép đọc, `Validate` và chuẩn bị candidate theo transaction; chỉ `Apply` bị khóa khi
chưa có carrier, kèm cảnh báo phải cắm cáp Ethernet. Không dùng DevTools/API để vượt khóa này.
Nếu runtime trước transaction vốn đã `NO_CARRIER`/không có IPv4, rollback chỉ yêu cầu khôi phục
configured profile và gỡ candidate address; khi runtime trước đó healthy, rollback vẫn xác minh
nghiêm ngặt link/mode/IPv4/prefix/gateway/DNS như snapshot.

1. Viewer+ đọc GET status; chỉ Admin chạy POST `Validate → Stage → Apply`.
2. Nếu đổi DNS: thiếu object `dns` là preserve; `auto` chỉ với DHCP/list rỗng; `manual` dùng
   1..4 IPv4 canonical duy nhất. Xác nhận status có capability `dns` trước mutation.
3. Static apply phải giữ IP cũ trong thời gian xác nhận; DNS phải rollback cùng IPv4.
4. Xác nhận `management.stable=true`, hostname resolve tới IP mới và REST/WebSocket tự reconnect
   trên tab hiện tại.
5. Chỉ `Confirm` qua tab dùng hostname sau khi dữ liệu live đã đồng bộ lại.
6. Nếu hostname không resolve hoặc FE chưa reconnect, không Confirm; dùng Rollback hoặc chờ timeout.
7. Thu evidence địa chỉ/DNS cũ-mới, capability/management, mDNS, REST, WebSocket, transaction
   journal, audit và đường management; không ghi raw token/credential.

Không có DNS/mDNS hoặc client không route được subnet mới thì browser không thể tự theo IP mới;
đó là lỗi preflight mạng, không được khắc phục bằng cách tắt rollback.

Rollback hostname nếu cần:

```bash
ssh SOM-DDC-24 'old=$(sudo cat /data/mkddc/hostname-before-mdns) && \
  sudo hostnamectl set-hostname "$old" && \
  sudo rm -f /etc/avahi/services/mkddc-web.service && \
  sudo systemctl restart avahi-daemon'
```

---

## 7. No-MCU smoke test thủ công (một lần để verify)

> Dùng để verify lần đầu sau install. Cho lab chạy liên tục → dùng systemd stack ở §7b.

```bash
ssh SOM-DDC-24 "cd ~/work/DDC-PROJECT && nohup bash tools/run_noboard_demo.sh </dev/null &>/dev/null &"
sleep 6
# Terminal khác:
ssh SOM-DDC-24 "cd ~/work/DDC-PROJECT && bash tools/run_noboard_demo.sh do1 1"
# → core trả lời: {"result":"accepted","applied_value":1,"active_source":"manual"}
ssh SOM-DDC-24 "cd ~/work/DDC-PROJECT && bash tools/run_noboard_demo.sh kill-mcu"
sleep 10
ssh SOM-DDC-24 "cd ~/work/DDC-PROJECT && bash tools/run_noboard_demo.sh revive"
sleep 8
ssh SOM-DDC-24 "cd ~/work/DDC-PROJECT && bash tools/run_noboard_demo.sh stop"
```

**Pass criteria:**

```text
- shm_dump_io: iop_status=NORMAL, seq tăng liên tục
- do1 1: response "accepted"
- kill-mcu: iop_status đổi FAULT→SAFE, DO về 0
- revive: ~5s sau reconnect, NORMAL trở lại
- logs/demo/*.log không có crash/backtrace
```

**Thu thập evidence:**

```bash
ssh SOM-DDC-24 "
cd ~/work/DDC-PROJECT
E=~/mkddc-evidence/\$(date +%Y%m%d_%H%M)_som_nomcu
mkdir -p \$E
uname -a > \$E/uname.txt
cat ~/work/DDC-PROJECT/DEPLOYED_COMMIT > \$E/git_rev.txt 2>/dev/null || echo "unknown" > \$E/git_rev.txt
ctest --test-dir build/services --output-on-failure | tee \$E/ctest.log
cp -a logs/demo \$E/ 2>/dev/null || true
systemctl --no-pager status mkddc-iobus mkddc-core > \$E/systemd_status.txt 2>&1 || true
tar -C ~/mkddc-evidence -czf \$E.tar.gz \$(basename \$E)
echo \$E.tar.gz"
```

---

## 7b. Systemd fake MCU stack (tự start sau reboot)

> **Đây là cách dùng cho lab thường xuyên.** Sau khi setup một lần, board tự khởi động đầy đủ sau mỗi lần bật nguồn.

### Kiến trúc 3 service

> **ĐÍNH CHÍNH 2026-08-06 — bỏ `mkddc-pty`.** Bản trước của mục này hướng dẫn
> enable **cả** `mkddc-pty` lẫn `mkddc-fakemcu`. Hai unit đó **loại trừ nhau**.
> `mkddc-fakemcu` chạy `--pty --link`, tức TỰ tạo cặp PTY và giữ đầu master —
> socat không còn việc gì để làm. Tệ hơn, `mkddc-pty` có
> `ExecStartPre=/bin/rm -f /tmp/mkddc-iop-a /tmp/mkddc-iop-b`, **xoá đúng liên
> kết mà fake MCU vừa tạo**.
>
> Trên bo Foxlinx điều này xảy ra ở **mỗi lần boot** mà không ai thấy:
> `mkddc-pty` xoá liên kết rồi tự chết vì thiếu socat (`status=203/EXEC`), còn
> iobus đã kịp mở fd nên vẫn chạy bình thường. IOP chỉ thật sự chết ở **lần
> iobus khởi động lại kế tiếp** — có thể nhiều ngày sau, lúc không ai còn nối
> được hai sự kiện với nhau. Triệu chứng duy nhất:
>
> ```
> ERROR iop.open_fail dev=/tmp/mkddc-iop-a errno=2 (No such file or directory)
> ```
>
> trong khi cả hai service vẫn `active` và `NRestarts=0`.
>
> Nay `mkddc-fakemcu` khai `Conflicts=mkddc-pty.service` nên systemd chặn việc
> cả hai cùng chạy. Chỉ enable `mkddc-pty` nếu bạn **chủ ý** dùng chế độ socat
> với `fake_mcu --uart /tmp/mkddc-iop-b`.

```
mkddc-fakemcu  fake_mcu tự tạo PTY pair, giữ master, symlink slave → /tmp/mkddc-iop-a
     ↓
mkddc-iobus    dùng /tmp/mkddc-iop-a (--uart) thay /dev/ttyS2
     ↓
mkddc-core     scan 1s, IPC tại /run/mkddc/core.sock
```

> **ĐÍNH CHÍNH 2026-08-14**: các đường dẫn trong mục 7b này đã được đối chiếu
> lại trực tiếp trên board Foxlinx thật (`SOM-DDC-24-foxlinx`) khi deploy lại
> `fake_mcu` cho kịch bản mô phỏng AHU 16 kênh UI (xem
> [FAKE_MCU_AHU_WIRING_2026-08-14.md](../07_records/reviews/FAKE_MCU_AHU_WIRING_2026-08-14.md)).
> Bản trước dùng alias `SOM-DDC-24` (di sản từ thời Orange Pi, trước khi §2a
> đổi tên thành `SOM-DDC-24-foxlinx`) và đường dẫn build/install từ trước
> `PLAN-ARCH-RESTRUCT-002` (`build/services/iobus/...`,
> `packaging/systemd/...`, `/usr/local/bin/mkddc-fakemcu`) — không còn khớp
> binary/service file thật đang chạy trên board (`/usr/sbin/mkddc-fake-mcu`,
> nguồn tại `platform/systemd/`). Đã sửa lại đúng theo mục 7b. **Các mục 2-6,
> 8, 9 phía dưới/trên chưa được rà lại trong lần này** — vẫn còn alias/path cũ,
> cần verify trước khi dùng.

### Setup (từ máy dev, sau khi đã rsync §4 + install §6)

```bash
ssh SOM-DDC-24-foxlinx "cd ~/work/DDC-PROJECT && \

  # 1. Install fake_mcu binary (nguồn: build/fw/iobus/fake_mcu native, hoặc
  #    build/fw-aarch64/iobus/fake_mcu nếu cross-compile từ máy dev)
  sudo install -m 0755 build/fw-aarch64/iobus/fake_mcu /usr/sbin/mkddc-fake-mcu && \

  # 2. Install service file (KHÔNG cài mkddc-pty — xem đính chính ở trên)
  sudo install -m 0644 platform/systemd/mkddc-fakemcu.service /etc/systemd/system/ && \

  # 3. Drop-in override: iobus dùng PTY thay UART thật
  sudo mkdir -p /etc/systemd/system/mkddc-iobus.service.d && \
  sudo install -m 0644 platform/systemd/mkddc-iobus-nomcu.conf \
    /etc/systemd/system/mkddc-iobus.service.d/nomcu.conf && \

  # 4. Drop-in override: tắt SCHED_FIFO (nếu kernel board không hỗ trợ RT)
  sudo mkdir -p /etc/systemd/system/mkddc-core.service.d && \
  sudo install -m 0644 platform/systemd/mkddc-core-nofifo.conf \
    /etc/systemd/system/mkddc-core.service.d/nofifo.conf && \

  # 5. Reload + enable tất cả
  sudo systemctl daemon-reload && \
  sudo systemctl enable --now mkddc-fakemcu mkddc-iobus mkddc-core"
```

### Verify sau setup (hoặc sau reboot)

Validate tất cả unit file (không có output = OK):

```bash
ssh SOM-DDC-24-foxlinx "systemd-analyze verify \
  /etc/systemd/system/mkddc-pty.service \
  /etc/systemd/system/mkddc-fakemcu.service \
  /etc/systemd/system/mkddc-iobus.service \
  /etc/systemd/system/mkddc-core.service"
```

```bash
ssh SOM-DDC-24-foxlinx "systemctl is-active mkddc-fakemcu mkddc-iobus mkddc-core"
# active active active

ssh SOM-DDC-24-foxlinx "/usr/sbin/shm_dump_io | head -3"
# magic=0x4B584401 seq=XXXX ... iop_status=NORMAL
```

### Xem log real-time

```bash
# Tất cả 3 service cùng lúc
ssh SOM-DDC-24-foxlinx "journalctl -u mkddc-fakemcu -u mkddc-iobus -u mkddc-core -f"

# Một service cụ thể
ssh SOM-DDC-24-foxlinx "journalctl -u mkddc-core -f"

# 50 dòng gần nhất
ssh SOM-DDC-24-foxlinx "journalctl -u mkddc-iobus -n 50 --no-pager"

# Từ lần boot hiện tại
ssh SOM-DDC-24-foxlinx "journalctl -u mkddc-core -b --no-pager"
```

### Những WARN bình thường (không phải lỗi)

```text
WARN rt.sched_fifo_fail prio=70 errno=1 (degraded SCHED_OTHER)
  → Orange Pi kernel không hỗ trợ RT scheduling; fallback SCHED_OTHER là OK cho lab

WARN config.missing path=/data/config/iobus.conf (dùng default built-in)
  → Không cần iobus.conf khi dùng --uart PTY; iobus dùng default built-in

ERROR safe_state.enter ... no_ctrl=1
  → core vào safe-state vì chưa có graph.json; AO=0V, DO=open — đúng behavior
```

---

## 8. Chuyển sang production khi MCU có mặt

> Chỉ làm sau khi MCU/IOP UART có thật và Dev1 xác nhận firmware đã qua P1/P2.

**Bước 1 — Tắt fake MCU stack:**

```bash
ssh SOM-DDC-24 "sudo systemctl disable --now mkddc-pty mkddc-fakemcu"
```

**Bước 2 — Xóa drop-in iobus override:**

```bash
ssh SOM-DDC-24 "sudo rm /etc/systemd/system/mkddc-iobus.service.d/nomcu.conf && \
  sudo systemctl daemon-reload"
```

> Drop-in `nofifo.conf` (tắt RT) có thể giữ lại trừ khi dùng kernel RT thật.

**Bước 3 — Tạo `/data/config/iobus.conf`:**

```bash
ssh SOM-DDC-24 "sudo tee /data/config/iobus.conf >/dev/null <<'JSON'
{
  \"uart_device\": \"/dev/ttyS2\",
  \"baud\": 921600,
  \"poll_period_ms\": 10,
  \"response_timeout_ms\": 10,
  \"max_retry\": 3,
  \"reconnect_interval_ms\": 5000,
  \"handshake_timeout_ms\": 1000,
  \"log_level\": \"info\",
  \"rt_priority\": 70,
  \"ui\": [
    {\"id\":\"UI1\",\"sensor_type\":\"0-10V\"}, {\"id\":\"UI2\",\"sensor_type\":\"0-10V\"},
    {\"id\":\"UI3\",\"sensor_type\":\"0-10V\"}, {\"id\":\"UI4\",\"sensor_type\":\"0-10V\"},
    {\"id\":\"UI5\",\"sensor_type\":\"0-10V\"}, {\"id\":\"UI6\",\"sensor_type\":\"0-10V\"},
    {\"id\":\"UI7\",\"sensor_type\":\"0-10V\"}, {\"id\":\"UI8\",\"sensor_type\":\"0-10V\"}
  ],
  \"ao\": [
    {\"id\":\"AO1\",\"mode\":\"0-10V\"}, {\"id\":\"AO2\",\"mode\":\"0-10V\"},
    {\"id\":\"AO3\",\"mode\":\"0-10V\"}, {\"id\":\"AO4\",\"mode\":\"0-10V\"}
  ]
}
JSON
sudo chown mkddc:mkddc /data/config/iobus.conf && sudo chmod 0644 /data/config/iobus.conf"
```

**Bước 4 — Enable production:**

```bash
ssh SOM-DDC-24 "sudo systemctl enable --now mkddc-iobus && \
  journalctl -u mkddc-iobus -f"
```

---

## 9. Rollback / cleanup

**Fake MCU systemd stack:**

```bash
ssh SOM-DDC-24-foxlinx "sudo systemctl disable --now mkddc-pty mkddc-fakemcu mkddc-iobus mkddc-core || true"
ssh SOM-DDC-24-foxlinx "sudo rm -f \
  /etc/systemd/system/mkddc-iobus.service.d/nomcu.conf \
  /etc/systemd/system/mkddc-core.service.d/nofifo.conf \
  /usr/sbin/mkddc-fake-mcu && \
  sudo systemctl daemon-reload"
```

**Xóa binaries + unit (chỉ khi lead approve):**

```bash
ssh SOM-DDC-24 "sudo rm -f \
  /usr/sbin/mkddc-core /usr/sbin/mkddc-iobus \
  /etc/systemd/system/mkddc-core.service \
  /etc/systemd/system/mkddc-iobus.service \
  /etc/systemd/system/mkddc-pty.service \
  /etc/systemd/system/mkddc-fakemcu.service && \
  sudo systemctl daemon-reload"
```

**Dọn SHM và socket:**

```bash
ssh SOM-DDC-24 "rm -f /dev/shm/mkddc_io_shm /dev/shm/mkddc_plc_shm /tmp/mkddc-iop-a /tmp/mkddc-iop-b /run/mkddc/core.sock"
```

---

## 10. Team checklist bắt buộc

| Trạng thái | Step | Owner | Evidence |
|---|---|---|---|
| [ ] Target | SSH key hoạt động; password không nằm trong repo/log | DevOps | `ssh SOM-DDC-24 echo OK` không hỏi password |
| [ ] Target | Board env recorded | Board operator | `uname.txt`, `os-release` |
| [ ] Release candidate | Build/test theo commit hiện hành PASS | Dev 2 | command/toolchain + full log; không dùng số lịch sử |
| [ ] Target | Install `--no-enable` PASS; hostname tool/template có mặt nhưng hostname chưa đổi | Board operator | binaries + units + `/data/{config,mkddc}` + package manifest |
| [x] Code-local | FE REST/WebSocket same-origin/reconnect và không hardcode origin | Dev 3/QA | focused Vitest + production build |
| [x] Target | Hostname mDNS duy nhất, `management.stable=true`, `/login` bằng `.local` | DevOps/QA | direct authority status, Avahi active, Windows DNS + HTTP 200 ngày 2026-07-28 |
| [ ] Target/HIL | IPv4/DNS transaction và stable-origin handoff PASS | QA | old/new/DNS, journal/audit, REST/WebSocket reconnect, rollback |
| [ ] Target/HIL | BACnet `I-Am`, Modbus reconnect, Core/IOP/STM32 continuity PASS | QA | packet capture + physical control trace |
| [ ] Target | Fake MCU systemd stack PASS | Dev 2/QA | `systemctl is-active` required services = active |
| [ ] Target | `iop_status=NORMAL` sau reboot | QA | `shm_dump_io` output |
| [ ] Target | Fault/recover fake MCU PASS | QA | journalctl log (FAULT→NORMAL) |
| [ ] Record | Evidence tarball uploaded và reviewer duyệt | QA | immutable path/checksum/approval |

Không qua checklist này thì không báo "SOM deploy ready".

---

**Rev**
1.11 | 2026-08-04 — bổ sung board chính Foxlinx SOM-DDC-24-foxlinx (port 2223, user root, có MCU STM32 thật) vào §1a và §2a; phân biệt rõ board chính (production) và board lab (Orange Pi); thêm quy trình chuẩn bị/preflight trước khi deploy lên board chính
1.10 | 2026-07-28 — ghi nhận dummy transaction/hostname test pass và teardown về `end1`/`idle`; thêm cleanup host route Windows bằng PowerShell Administrator
1.9 | 2026-07-28 — thêm test rig `dummy0` tạm thời không cần cáp, baseline/candidate, evidence, giới hạn mô phỏng và cleanup một lệnh về `end1`
1.8 | 2026-07-28 — chốt helper sau refinement strict legacy snapshot, deploy lại trên Orange Pi; cập nhật SHA cuối và backup lần hai
1.7 | 2026-07-28 — deploy Network-only bản vá no-carrier/rollback lên Orange Pi; ghi SHA helper/FE, backup, health HTTP và authority `NO_CARRIER` sau restart
1.6 | 2026-07-28 — khóa FE `Apply` khi interface quản lý chưa có carrier; rollback chấp nhận trạng thái snapshot vốn offline/no-IP sau khi khôi phục profile và gỡ candidate address; thêm test hồi quy và chưa đổi IP production
1.5 | 2026-07-28 — bổ sung SOP Network-only từ Windows, build/stage/backup/thứ tự restart/health-loop mDNS, evidence deploy thật với `orangepi5b.local`, hash artifact và lưu ý IP quản trị ở `wlan0` trong khi authority quản lý `end1`; không đổi IP
1.4 | 2026-07-28 — khóa strict Network v1, DNS transaction/capability, management hostname read-only, GET viewer+/POST Admin-only; package chỉ cài hostname tool/template, checklist tách code-local khỏi target/HIL RED
1.3 | 2026-07-28 — thêm production Web cùng-origin, cấu hình hostname mDNS fail-closed, preflight/rollback và quy trình HIL đổi IP qua hostname; work session chỉ kiểm code/package, chưa apply hostname hoặc đổi IP target
1.2 | 2026-06-16 — code review fixes: nohup smoke test §7, ExecStartPre PTY cleanup, Type=exec, check iop-a+b, BindsTo thay Requires, CAP_SYS_NICE revoke, git_rev.txt evidence, core.sock rollback §9, systemd-analyze verify §6+§7b
1.1 | 2026-06-13 — cập nhật theo thực tế: thông tin board Orange Pi 5B, SSH config với IdentityFile, rsync từ máy dev, 141/141 test, systemd fake MCU stack 4 service (§7b), drop-in nofifo, lệnh log journalctl
1.0 | 2026-06-13 — tạo SOP deploy SOM no-MCU
