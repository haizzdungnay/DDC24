# Checklist triển khai — Foxlinx SOM-DDC-24

> **ID:** HW-FOXLINX-DEPLOY-001  
> **Ngày:** 2026-08-05  
> **Trạng thái:** Active  
> **Board:** `SOM-DDC-24-foxlinx` (`root@mekong-fac.ddns.net:2223`, password: `admin123`)  
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
| **Auth** | Password (`admin123`) | SSH key |
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
  -DCMAKE_TOOLCHAIN_FILE=platform/cmake/aarch64-linux-gnu.cmake \
  -DMKDDC_ENABLE_MODBUS=ON \
  -DMKDDC_ENABLE_BACNET=ON \
  -DMKDDC_ENABLE_HMI=ON

cmake --build build/fw-aarch64 --parallel $(nproc)
```

### 3.2 Go (web-api)

```bash
cd apps/web-api
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -o ../../build/fw-aarch64/web-api ./cmd/server
```

### 3.3 Frontend (web-ui) — Build trên máy dev, copy static

```bash
cd apps/web-ui
npm run build
# Output: dist/ → sẽ copy lên board
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
  # rsync -a dist/ root@…:/opt/mkddc-web/dist/

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
| 4 | **Web UI** | `curl -s http://localhost:8080/ \| head -5` | HTML response |
| 5 | **API health** | `curl -s http://localhost:8080/api/v1/health` | `{"status":"ok"}` |
| 6 | **BACnet** | `journalctl -u mkddc-core \| grep -i bacnet \| tail -5` | Không có ERROR liên tục |
| 7 | **Modbus RTU** | `journalctl -u mkddc-modbus-rtu \| tail -10` | Service chạy, không crash loop |
| 8 | **Log errors** | `journalctl --since '5min ago' -p err` | Không có lỗi nghiêm trọng mới |
| 9 | **Disk usage** | `df -h / \| awk 'NR==2{print $5}'` | < 80% |
| 10 | **Temperature** | `cat /sys/class/thermal/thermal_zone0/temp` | < 70000 (70 °C) |

---

## 6. Rollback khi deploy hỏng

### 6.1 Hồi phục binary

```bash
ssh SOM-DDC-24-foxlinx "
  # Dừng services lỗi:
  systemctl stop mkddc-core mkddc-iobus mkddc-webapi 2>/dev/null

  # Khôi phục backup:
  LATEST=\$(ls -t /tmp/backup-*.tar.gz 2>/dev/null | head -1)
  if [ -n \"\$LATEST\" ]; then
    tar -xzf \$LATEST -C /
    echo 'Restored from: '\$LATEST
  else
    echo 'ERROR: Không tìm thấy file backup!'
  fi

  systemctl daemon-reload
  systemctl start mkddc-iobus mkddc-core mkddc-webapi
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
