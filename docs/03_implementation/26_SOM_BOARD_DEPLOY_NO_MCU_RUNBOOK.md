# 26 — SOM Board Deploy Runbook (No MCU)
## MK-DDC-24 — Build/deploy lên board SOM khi chưa có MCU

> **Document ID:** IMPL-SOM-DEPLOY-NOMCU-MK-DDC-24-VI
> **Phiên bản:** 1.2 | 2026-06-16
> **Trạng thái:** Active — SOP cho team build/deploy SOM-only
> **Owner:** Dev 2 + DevOps/QA
> **Scope:** board SOM truy cập qua SSH, chưa có MCU STM32; deploy/test `mkddc-iobus`, `mkddc-core`, `fake_mcu`, `shm_dump_io`.
> **Không scope:** MCU firmware thật, relay/AO/DI/UI vật lý, `mkddc-web` production (repo hiện chưa có `web/`).

---

## 1. Thông tin board thực tế (đã verify 2026-06-13)

| Hạng mục | Giá trị |
|---|---|
| Board | Orange Pi 5B |
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
  socat python3 \
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

### Kiến trúc 4 service

```
mkddc-pty      socat tạo PTY pair /tmp/mkddc-iop-a ↔ /tmp/mkddc-iop-b
     ↓
mkddc-fakemcu  fake_mcu bám PTY B (/tmp/mkddc-iop-b)
     ↓
mkddc-iobus    dùng PTY A (--uart /tmp/mkddc-iop-a) thay /dev/ttyS2
     ↓
mkddc-core     scan 1s, IPC tại /run/mkddc/core.sock
```

### Setup (từ máy dev, sau khi đã rsync §4 + install §6)

```bash
ssh SOM-DDC-24 "cd ~/work/DDC-PROJECT && \

  # 1. Install fake_mcu binary
  sudo install -m 0755 build/services/iobus/fake_mcu /usr/local/bin/mkddc-fakemcu && \

  # 2. Install 2 service file mới
  sudo install -m 0644 packaging/systemd/mkddc-pty.service /etc/systemd/system/ && \
  sudo install -m 0644 packaging/systemd/mkddc-fakemcu.service /etc/systemd/system/ && \

  # 3. Drop-in override: iobus dùng PTY thay UART thật
  sudo mkdir -p /etc/systemd/system/mkddc-iobus.service.d && \
  sudo install -m 0644 packaging/systemd/mkddc-iobus-nomcu.conf \
    /etc/systemd/system/mkddc-iobus.service.d/nomcu.conf && \

  # 4. Drop-in override: tắt SCHED_FIFO (Orange Pi kernel không hỗ trợ)
  sudo mkdir -p /etc/systemd/system/mkddc-core.service.d && \
  sudo install -m 0644 packaging/systemd/mkddc-core-nofifo.conf \
    /etc/systemd/system/mkddc-core.service.d/nofifo.conf && \

  # 5. Reload + enable tất cả
  sudo systemctl daemon-reload && \
  sudo systemctl enable --now mkddc-pty mkddc-fakemcu mkddc-iobus mkddc-core"
```

### Verify sau setup (hoặc sau reboot)

Validate tất cả unit file (không có output = OK):

```bash
ssh SOM-DDC-24 "systemd-analyze verify \
  /etc/systemd/system/mkddc-pty.service \
  /etc/systemd/system/mkddc-fakemcu.service \
  /etc/systemd/system/mkddc-iobus.service \
  /etc/systemd/system/mkddc-core.service"
```

```bash
ssh SOM-DDC-24 "systemctl is-active mkddc-pty mkddc-fakemcu mkddc-iobus mkddc-core"
# active active active active

ssh SOM-DDC-24 "~/work/DDC-PROJECT/build/services/iobus/shm_dump_io | head -3"
# magic=0x4B584401 seq=XXXX ... iop_status=NORMAL
```

### Xem log real-time

```bash
# Tất cả 4 service cùng lúc
ssh SOM-DDC-24 "journalctl -u mkddc-pty -u mkddc-fakemcu -u mkddc-iobus -u mkddc-core -f"

# Một service cụ thể
ssh SOM-DDC-24 "journalctl -u mkddc-core -f"

# 50 dòng gần nhất
ssh SOM-DDC-24 "journalctl -u mkddc-iobus -n 50 --no-pager"

# Từ lần boot hiện tại
ssh SOM-DDC-24 "journalctl -u mkddc-core -b --no-pager"
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
ssh SOM-DDC-24 "sudo systemctl disable --now mkddc-pty mkddc-fakemcu mkddc-iobus mkddc-core || true"
ssh SOM-DDC-24 "sudo rm -f \
  /etc/systemd/system/mkddc-iobus.service.d/nomcu.conf \
  /etc/systemd/system/mkddc-core.service.d/nofifo.conf \
  /usr/local/bin/mkddc-fakemcu && \
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

| Step | Owner | Evidence |
|---|---|---|
| SSH key hoạt động; password không nằm trong repo/log | DevOps | `ssh SOM-DDC-24 echo OK` không hỏi password |
| Board env recorded | Board operator | `uname.txt`, `os-release` |
| Build Release PASS (141/141 test) | Dev 2 | `ctest.log` |
| Install `--no-enable` PASS | Board operator | binaries + units + `/data/{config,mkddc}` |
| Fake MCU systemd stack PASS | Dev 2/QA | `systemctl is-active` 4 service = active |
| `iop_status=NORMAL` sau reboot | QA | `shm_dump_io` output |
| Fault/recover fake MCU PASS | QA | journalctl log (FAULT→NORMAL) |
| Evidence tarball uploaded | QA | tarball path/checksum |

Không qua checklist này thì không báo "SOM deploy ready".

---

**Rev**
1.2 | 2026-06-16 — code review fixes: nohup smoke test §7, ExecStartPre PTY cleanup, Type=exec, check iop-a+b, BindsTo thay Requires, CAP_SYS_NICE revoke, git_rev.txt evidence, core.sock rollback §9, systemd-analyze verify §6+§7b
1.1 | 2026-06-13 — cập nhật theo thực tế: thông tin board Orange Pi 5B, SSH config với IdentityFile, rsync từ máy dev, 141/141 test, systemd fake MCU stack 4 service (§7b), drop-in nofifo, lệnh log journalctl
1.0 | 2026-06-13 — tạo SOP deploy SOM no-MCU
