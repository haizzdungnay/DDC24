# Checklist triển khai — Foxlinx SOM-DDC-24

> **ID:** HW-FOXLINX-DEPLOY-001  
> **Ngày:** 2026-08-05  
> **Trạng thái:** Active  
> **Board:** `SOM-DDC-24-foxlinx` (`root@mekong-fac.ddns.net:2223`, chỉ khoá SSH `~/.ssh/mkddc24_som`)  
> **Liên quan:** [27_SOM_BOARD_DEPLOY_NO_MCU_RUNBOOK.md](../../03_implementation/27_SOM_BOARD_DEPLOY_NO_MCU_RUNBOOK.md)

---

## 1. Khác biệt Foxlinx vs Orange Pi — Bảng tra nhanh

| Thuộc tính | Foxlinx SOM-DDC-24 (Production) | Orange Pi 5B (Lab) |
|---|---|---|
| **SoC** | RV1126B (Cortex-A53 @1.3 GHz) | RK3588S (Cortex-A76/A55) |
| **OS** | Buildroot 2024.02 | Debian 12 |
| **Package manager** | **Không có** (`apt`/`dpkg` không tồn tại) | `apt` |
| **User** | `root` | `orangepi` |
| **SSH alias** | `SOM-DDC-24-foxlinx` | `SOM-DDC-24` |
| **SSH port** | 2223 | 2222 |
| **Auth** | **Chỉ SSH key** (`~/.ssh/mkddc24_som`; mật khẩu đã tắt từ 2026-09-26, sự cố `SEC-INC-20260926-FOXLINX`) | SSH key |
| **MCU** | STM32G0B1 **thật** qua `/dev/ttyS2` | **Fake MCU** qua PTY |
| **UART IOP** | `/dev/ttyS2` (phần cứng) | `/dev/pts/X` (giả lập) |
| **RS485** | `/dev/ttyS5` (phần cứng + transceiver) | Không có |
| **WiFi/BT** | RTL8821CS (có sẵn) | Tùy USB dongle |
| **eMMC** | 16 GB | 256 GB NVMe |
| **Cross-compile** | **Bắt buộc** (`aarch64-linux-gnu-`) | Có thể build trực tiếp |
| **systemd** | Có | Có |
| **Rootfs** | Read-write ext4 (13G) | Read-write ext4 |

> [!CAUTION]
> **Không** chạy `apt install`, `dpkg -i`, `pip install` trên board Foxlinx.
> Buildroot không có package manager. Mọi binary phải được cross-compile và copy trực tiếp.

---

## 2. Pre-flight Checklist (Trước khi deploy)

### 2.1 Kiểm tra kết nối

```bash
# Từ máy dev:
ssh SOM-DDC-24-foxlinx "echo OK && uname -a && date -Is"

# Kiểm tra dung lượng eMMC:
ssh SOM-DDC-24-foxlinx "df -h / /userdata"
# Rootfs: 13G, dùng ~1.4G, còn ~11G
# Userdata: 1.9G, dùng ~105M, còn ~1.7G
```

### 2.2 Backup config và dữ liệu

```bash
ssh SOM-DDC-24-foxlinx "
  BACKUP=/tmp/backup-\$(date +%Y%m%dT%H%M%S).tar.gz
  tar -czf \$BACKUP /data/config /data/mkddc /userdata 2>/dev/null
  echo 'Backup: '\$BACKUP
  ls -lh \$BACKUP
"
```

### 2.3 Ghi hash commit hiện tại

```bash
# Trên máy dev:
git rev-parse HEAD > /tmp/deploy-commit.txt
echo "Deploy commit: $(cat /tmp/deploy-commit.txt)"
```

---

## 3. Build (Cross-compile cho aarch64)

### 3.1 C++ (core, iobus, netcfg, hmi, modbus-rtu)

```bash
# Từ root dự án:
cmake --fresh -S . -B build/fw-aarch64 \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_TOOLCHAIN_FILE=platform/cmake/toolchain-aarch64-linux-gnu.cmake \
  -DMKDDC_ENABLE_MODBUS=ON \
  -DMKDDC_ENABLE_BACNET=ON \
  -DMKDDC_ENABLE_HMI=ON

cmake --build build/fw-aarch64 --parallel $(nproc)
```

### 3.2 Go (web-api)

```bash
cd apps/web-api
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -o ../../build/fw-aarch64/mkddc-web ./cmd/mkddc-web
```

### 3.3 Frontend (web-ui) — Build trên máy dev, copy static

> [!WARNING]
> **Board Foxlinx đã bật cờ Programming Rev A VĨNH VIỄN** từ `TASK-PROG-507`
> (`docs/07_records/test-evidence/fw-som/2026-08-13-foxlinx-programming-p5-deploy.md`).
> `VITE_PROGRAMMING_REV_A` là biến build-time (Vite bake vào bundle, mặc định
> TẮT ở `.env.production` vì production build thường KHÔNG bật — xem
> `apps/web-ui/src/shared/config.ts`). Build FE cho board này mà **quên** biến
> này sẽ âm thầm tắt route `/eng/programming` và render lại trang "Graphical
> programming is not available" dù không đổi code gì.
>
> **Đã tái diễn 2 lần** dù mục này đã cảnh báo từ trước: 2026-08-14 (phiên
> sửa i18n Modbus RTU) và 2026-08-17 (phiên sửa F-OUT-001, chạy đúng
> `npm run build` theo checklist FE tổng quát của CLAUDE.md — checklist đó
> không biết gì về cờ riêng của board này). Ghi nhớ checklist không đủ khi
> lệnh build "mặc định đúng" (`npm run build` trần) vẫn chạy được và có vẻ
> thành công. Từ 2026-08-17: dùng script `build:foxlinx` bake sẵn cờ, không
> còn phải nhớ export biến thủ công:

```bash
cd apps/web-ui
npm run build:foxlinx
# Output: ../../build/web-ui/dist/ → sẽ copy lên board
# Kiểm nhanh trước khi copy: bundle KHÔNG được chứa "REVA_SCOPE_ROADMAP"
# (chuỗi đó chỉ còn trong code khi cờ tắt/bị tree-shake sai):
grep -c REVA_SCOPE_ROADMAP ../../build/web-ui/dist/assets/index-*.js   # phải = 0
```

### 3.4 Đóng gói release

```bash
platform/packaging/build-release.sh
sha256sum --check build/release/checksums.sha256
```

---

## 4. Transfer & Install

### 4.1 Copy package lên board

```bash
# Dùng rsync (nhanh hơn scp cho lần tiếp theo):
rsync -avz --progress build/release/ SOM-DDC-24-foxlinx:/tmp/mkddc-release/

# Hoặc scp:
scp -r build/release/ SOM-DDC-24-foxlinx:/tmp/mkddc-release/
```

### 4.2 Cài đặt trên board

```bash
ssh SOM-DDC-24-foxlinx "
  # Dừng services trước (tên unit THẬT trên bo là mkddc-web-pi):
  systemctl stop mkddc-web-pi mkddc-core

  # Giữ bản cũ ngay cạnh bản mới để rollback trong một lệnh:
  cp -f /usr/sbin/mkddc-core /usr/sbin/mkddc-core.prev
  cp -f /opt/mkddc-web/mkddc-web /opt/mkddc-web/mkddc-web.prev

  # Cài binary — đường dẫn THẬT trên bo:
  install -m 0755 /tmp/mkddc-core          /usr/sbin/mkddc-core
  install -m 0755 /tmp/mkddc-schedule-sim  /usr/sbin/mkddc-schedule-sim
  install -m 0755 /tmp/mkddc-web           /opt/mkddc-web/mkddc-web

  # Web UI static:
  # rsync -a build/web-ui/dist/ root@…:/opt/mkddc-web/dist/

  echo 'Install done'
"
```

> [!IMPORTANT]
> **Đính chính 2026-08-07.** Bản trước của mục này ghi `/usr/local/bin`, `mkddc-webapi`,
> `/usr/local/share/mkddc-webui` và cổng 8080 — **không mục nào đúng với bo thật**. Ai làm theo
> sẽ cài binary vào chỗ systemd không chạy tới, và tưởng deploy thành công. Bố cục thật:
>
> | Thành phần | Đường dẫn thật | Ghi chú |
> |---|---|---|
> | `mkddc-core`, `mkddc-iobus`, `mkddc-netcfg`, `mkddc-schedule-sim` | `/usr/sbin/` | |
> | `mkddc-web` | `/opt/mkddc-web/mkddc-web` | unit tên **`mkddc-web-pi.service`** |
> | Web UI static | `/opt/mkddc-web/dist/` | `STATIC_DIR` trong environ |
> | Cấu hình | `/data/config/` | `CONFIG_DIR` trong environ |
> | Cổng HTTP | **8081** | không phải 8080 |
>
> Kiểm nhanh trước khi tin bất cứ đường dẫn nào:
> `grep -h ExecStart /etc/systemd/system/mkddc-*.service` và
> `tr '\0' '\n' < /proc/$(pgrep -f mkddc-web | head -1)/environ | grep DIR`.

### 4.3 Khởi động services

```bash
ssh SOM-DDC-24-foxlinx "
  systemctl start mkddc-core
  sleep 2
  systemctl start mkddc-web-pi
  sleep 3

  echo '=== Service status ==='
  systemctl is-active mkddc-core mkddc-web-pi mkddc-iobus mkddc-netcfg
  /usr/sbin/mkddc-core --version | head -1
"
```

---

## 5. Post-deploy Smoke Test (10 mục)

| # | Mục kiểm tra | Lệnh | Kỳ vọng |
|---|---|---|---|
| 1 | **Service status** | `systemctl is-active mkddc-core mkddc-iobus mkddc-web-pi` | Tất cả `active` |
| 2 | **IOP heartbeat** | `journalctl -u mkddc-iobus --since '1min ago' \| grep -c HEARTBEAT` | > 0 |
| 2b | **Health tổng** | `wget -qO- http://127.0.0.1:8081/api/v1/health` | `"status":"ok"`; bo **không có `curl`**, dùng `wget` |
| 3 | **SHM magic** | `xxd /dev/shm/mkddc_io_shm \| head -1` | Magic `01 44 58 4b` (LE) |
| 4 | **Web UI** | `wget -qO- http://127.0.0.1:8081/ \| head -5` | HTML response |
| 5 | **API health** | `wget -qO- http://127.0.0.1:8081/api/v1/health` | `{"status":"ok"}` |
| 6 | **BACnet** | `journalctl -u mkddc-core \| grep -i bacnet \| tail -5` | Không có ERROR liên tục |
| 7 | **Modbus RTU** | `journalctl -u mkddc-iobus --since '5min ago' \| grep -i modbus \| tail -10` | IOBus không crash loop hoặc báo lỗi Modbus liên tục |
| 8 | **Log errors** | `journalctl --since '5min ago' -p err` | Không có lỗi nghiêm trọng mới |
| 9 | **Disk usage** | `df -h / \| awk 'NR==2{print $5}'` | < 80% |
| 10 | **Temperature** | `cat /sys/class/thermal/thermal_zone0/temp` | < 70000 (70 °C) |

---

## 6. Rollback khi deploy hỏng

### 6.1 Hồi phục binary

```bash
ssh SOM-DDC-24-foxlinx "
  # Dừng services lỗi:
  systemctl stop mkddc-core mkddc-iobus mkddc-web-pi 2>/dev/null

  # Khôi phục backup:
  LATEST=\$(ls -t /tmp/backup-*.tar.gz 2>/dev/null | head -1)
  if [ -n \"\$LATEST\" ]; then
    tar -xzf \$LATEST -C /
    echo 'Restored from: '\$LATEST
  else
    echo 'ERROR: Không tìm thấy file backup!'
  fi

  systemctl daemon-reload
  systemctl start mkddc-iobus mkddc-core mkddc-web-pi
"
```

### 6.2 Trường hợp board không SSH được

1. Kết nối UART debug qua USB-C (Type-C trên bo = UART0 console, baudrate 1500000).
2. Trong U-Boot prompt, có thể boot vào recovery partition:
   ```
   # Tại U-Boot prompt:
   run recovery_cmd
   ```
3. Nếu cả recovery cũng hỏng, flash lại toàn bộ eMMC qua Rockchip `rkdeveloptool`.

---

## 7. Lưu ý đặc thù Foxlinx Buildroot

| Vấn đề | Giải pháp |
|---|---|
| Không có `apt`, `dpkg`, `pip` | Cross-compile mọi thứ, copy binary |
| Không có `systemctl enable` mặc định | Copy `.service` vào `/etc/systemd/system/`, chạy `systemctl enable` thủ công |
| Không có `sudo` | Đã login `root` trực tiếp |
| `/tmp` mount tmpfs (987 MB) | Dùng `/userdata` cho dữ liệu lâu dài |
| Rootfs ext4 read-write | Cẩn thận không fill đầy 13G rootfs |
| Kernel module ngoài (RTL8821CS) | Đã nạp sẵn; không cần `modprobe` thủ công |
| `fw_printenv` / `fw_setenv` | Dùng để xem/sửa U-Boot env (DTB file, boot args) |

---

## 8. Lịch sử phiên bản

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-05 | Phiên bản đầu tiên — checklist deploy, so sánh Foxlinx/OPi, smoke test, rollback |
