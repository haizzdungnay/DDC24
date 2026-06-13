# 26 — SOM Board Deploy Runbook (No MCU)
## MK-DDC-24 — Build/deploy lên board SOM khi chưa có MCU

> **Document ID:** IMPL-SOM-DEPLOY-NOMCU-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-06-13
> **Trạng thái:** Active — SOP cho team build/deploy SOM-only
> **Owner:** Dev 2 + DevOps/QA
> **Scope:** board SOM truy cập qua SSH, chưa có MCU STM32; deploy/test `mkddc-iobus`, `mkddc-core`, `fake_mcu`, `shm_dump_io`.
> **Không scope:** MCU firmware thật, relay/AO/DI/UI vật lý, `mkddc-web` production (repo hiện chưa có `web/`).

---

## 1. Kết luận review nhanh

| Hạng mục | Nhận xét | Quyết định team |
|---|---|---|
| SSH qua DDNS + port 2222 | Dùng được cho lab, nhưng host key đang bị tắt nếu dùng config hiện tại. | Dùng tạm cho lab; không dùng config này cho production. |
| Password shared | Không đưa password vào repo/docs/command. | Lưu trong password manager; rotate sau khi tạo SSH key cho team. |
| Chưa có MCU | Không enable service `mkddc-iobus` trỏ `/dev/ttyS2`. | Dùng `fake_mcu` + `socat` manual no-board mode. |
| `packaging/install.sh` | Chỉ install `mkddc-iobus` + `mkddc-core`; chưa install web. | Chạy `--no-enable` trong giai đoạn no-MCU. |
| `mkddc-iobus.service` | ExecStart dùng `--config /data/config/iobus.conf`; thiếu file sẽ fail-fast. | Chỉ enable khi đã tạo config thật và có MCU hoặc fake-systemd profile riêng. |
| Test evidence | Có unit tests + `tools/run_noboard_demo.sh`. | Mỗi deploy phải nộp log build, ctest, demo, git hash. |

---

## 2. SSH policy bắt buộc

Không commit mật khẩu, private key, host token, file `~/.ssh/config`, `known_hosts`, hoặc log chứa secret.

Config lab khuyến nghị trên máy dev:

```sshconfig
Host SOM-DDC-24
  HostName mekong-fac.ddns.net
  User orangepi
  Port 2222
  ServerAliveInterval 30
  ServerAliveCountMax 3
  StrictHostKeyChecking accept-new
```

Nếu đang dùng `StrictHostKeyChecking no` và `UserKnownHostsFile /dev/null`, chỉ dùng tạm khi lab chưa ổn định host key. Rủi ro: client không phát hiện MITM/host giả.

Tạo key cho từng thành viên:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/mkddc24_som -C "mkddc24-som-<ten>"
ssh-copy-id -p 2222 -i ~/.ssh/mkddc24_som.pub orangepi@mekong-fac.ddns.net
```

Windows PowerShell nếu không có `ssh-copy-id`:

```powershell
type $env:USERPROFILE\.ssh\mkddc24_som.pub | ssh SOM-DDC-24 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"
```

Board hardening tối thiểu sau khi key hoạt động:

```bash
sudo passwd -l root || true
sudo sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl reload ssh || sudo systemctl reload sshd
```

---

## 3. Board bootstrap một lần

Đăng nhập:

```bash
ssh SOM-DDC-24
```

Ghi nhận môi trường:

```bash
hostnamectl
uname -a
cat /etc/os-release
dpkg --print-architecture
date -Is
timedatectl status | sed -n '1,8p'
```

Cài toolchain:

```bash
sudo apt update
sudo apt install -y \
  git cmake build-essential g++ pkg-config ninja-build \
  socat python3 python3-venv \
  gdb strace lsof psmisc procps \
  libgtest-dev
```

Nếu `apt` không có `libgtest-dev`, CMake sẽ tự tải GoogleTest qua `FetchContent` khi network cho phép.

---

## 4. Lấy source lên SOM

Ưu tiên clone/pull trực tiếp trên SOM:

```bash
mkdir -p ~/work
cd ~/work
git clone <REPO_URL> DDC-PROJECT
cd DDC-PROJECT
git checkout <BRANCH_OR_COMMIT>
git rev-parse --short HEAD
```

Nếu chưa có remote cho SOM, đồng bộ từ máy dev qua `rsync` (WSL/Linux/macOS):

```bash
rsync -az --delete \
  --exclude build --exclude logs --exclude .git \
  ./ SOM-DDC-24:~/work/DDC-PROJECT/
```

Không dùng `scp -r` cho deploy lặp lại vì dễ để sót file cũ trên board.

---

## 5. Build + unit test trên SOM

Chạy từ root repo trên SOM:

```bash
cmake -S services -B build/services -DCMAKE_BUILD_TYPE=Release \
  -DIOBUS_BUILD_TESTS=ON -DCORE_BUILD_TESTS=ON
cmake --build build/services -j"$(nproc)"
ctest --test-dir build/services --output-on-failure
```

Pass criteria:

```text
- build/services/iobus/mkddc-iobus tồn tại
- build/services/core/mkddc-core tồn tại
- build/services/iobus/fake_mcu tồn tại
- build/services/iobus/shm_dump_io tồn tại
- ctest PASS 100%
```

Emergency build không chạy test chỉ dùng để debug compile, không được tính deploy gate:

```bash
cmake -S services -B build/services -DCMAKE_BUILD_TYPE=Release \
  -DIOBUS_BUILD_TESTS=OFF -DCORE_BUILD_TESTS=OFF
cmake --build build/services -j"$(nproc)"
```

---

## 6. Install lên board nhưng chưa enable

Vì chưa có MCU, không auto-start `mkddc-iobus` production service.

```bash
sudo packaging/install.sh --no-enable
systemctl cat mkddc-iobus mkddc-core
systemd-analyze verify packaging/systemd/mkddc-iobus.service packaging/systemd/mkddc-core.service
```

Pass criteria:

```text
- /usr/sbin/mkddc-iobus tồn tại và executable
- /usr/sbin/mkddc-core tồn tại và executable
- /etc/systemd/system/mkddc-iobus.service tồn tại
- /etc/systemd/system/mkddc-core.service tồn tại
- user/group mkddc tồn tại; mkddc thuộc dialout
- /data/config và /data/mkddc tồn tại
```

Không chạy lệnh này trong giai đoạn no-MCU:

```bash
sudo systemctl enable --now mkddc-iobus mkddc-core
```

---

## 7. No-MCU smoke test chuẩn

Dùng fake MCU + PTY, chạy manual dưới user `orangepi`:

```bash
./tools/run_noboard_demo.sh
```

Terminal khác:

```bash
./tools/run_noboard_demo.sh do1 1
./tools/run_noboard_demo.sh do1 0
./tools/run_noboard_demo.sh kill-mcu
sleep 8
./tools/run_noboard_demo.sh revive
sleep 8
./tools/run_noboard_demo.sh stop
```

Pass criteria:

```text
- `shm_dump_io --watch` thấy seq/ts đổi liên tục.
- `do1 1` trả `accepted` hoặc response hợp lệ từ core IPC.
- `kill-mcu` làm iobus/core chuyển fault/safe-state, không crash.
- `revive` recover sau reconnect window.
- logs/demo/iobus.log và logs/demo/core.log không có crash/backtrace.
```

Log cần nộp:

```bash
E=~/mkddc-evidence/$(date +%Y%m%d_%H%M)_som_nomcu
mkdir -p "$E"
git rev-parse HEAD > "$E/git_rev.txt"
uname -a > "$E/uname.txt"
ctest --test-dir build/services --output-on-failure | tee "$E/ctest.log"
cp -a logs/demo "$E/"
systemctl --no-pager status mkddc-iobus mkddc-core > "$E/systemd_status.txt" 2>&1 || true
tar -C ~/mkddc-evidence -czf "$E.tar.gz" "$(basename "$E")"
echo "$E.tar.gz"
```

---

## 8. Config production khi MCU có mặt

Chỉ làm sau khi MCU/IOP UART có thật và Dev1 xác nhận firmware đã qua P1/P2.

Tạo `/data/config/iobus.conf`:

```bash
sudo tee /data/config/iobus.conf >/dev/null <<'JSON'
{
  "uart_device": "/dev/ttyS2",
  "baud": 921600,
  "poll_period_ms": 10,
  "response_timeout_ms": 10,
  "max_retry": 3,
  "reconnect_interval_ms": 5000,
  "handshake_timeout_ms": 1000,
  "log_level": "info",
  "rt_priority": 70,
  "ui": [
    {"id":"UI1","sensor_type":"0-10V"}, {"id":"UI2","sensor_type":"0-10V"},
    {"id":"UI3","sensor_type":"0-10V"}, {"id":"UI4","sensor_type":"0-10V"},
    {"id":"UI5","sensor_type":"0-10V"}, {"id":"UI6","sensor_type":"0-10V"},
    {"id":"UI7","sensor_type":"0-10V"}, {"id":"UI8","sensor_type":"0-10V"}
  ],
  "ao": [
    {"id":"AO1","mode":"0-10V"}, {"id":"AO2","mode":"0-10V"},
    {"id":"AO3","mode":"0-10V"}, {"id":"AO4","mode":"0-10V"}
  ]
}
JSON
sudo chown mkddc:mkddc /data/config/iobus.conf
sudo chmod 0644 /data/config/iobus.conf
```

Optional safe/default config:

```bash
sudo tee /data/config/io_safe_state.conf >/dev/null <<'JSON'
{
  "ao": [
    {"ch":1,"safe":0}, {"ch":2,"safe":0},
    {"ch":3,"safe":0}, {"ch":4,"safe":0}
  ],
  "do": [
    {"ch":1,"safe":"open"}, {"ch":2,"safe":"open"},
    {"ch":3,"safe":"open"}, {"ch":4,"safe":"open"}
  ]
}
JSON
sudo chown mkddc:mkddc /data/config/io_safe_state.conf
sudo chmod 0644 /data/config/io_safe_state.conf
```

Enable production services:

```bash
sudo systemctl enable --now mkddc-iobus mkddc-core
journalctl -u mkddc-iobus -f
```

---

## 9. Rollback / cleanup

No-board demo cleanup:

```bash
./tools/run_noboard_demo.sh stop || true
pkill -x mkddc-core 2>/dev/null || true
pkill -x mkddc-iobus 2>/dev/null || true
pkill -x fake_mcu 2>/dev/null || true
rm -f /dev/shm/mkddc_io_shm /dev/shm/mkddc_plc_shm /tmp/mkddc-core.sock
```

Disable installed services:

```bash
sudo systemctl disable --now mkddc-core mkddc-iobus || true
sudo systemctl reset-failed mkddc-core mkddc-iobus || true
```

Remove installed binaries/units only when lead approves:

```bash
sudo rm -f /usr/sbin/mkddc-core /usr/sbin/mkddc-iobus
sudo rm -f /etc/systemd/system/mkddc-core.service /etc/systemd/system/mkddc-iobus.service
sudo systemctl daemon-reload
```

---

## 10. Team checklist bắt buộc

| Step | Owner | Evidence |
|---|---|---|
| SSH key hoạt động; password không nằm trong repo/log | DevOps | screenshot/notes, không chứa secret |
| Board env recorded | Board operator | `uname.txt`, `os-release` |
| Build Release PASS | Dev 2 | build log |
| Unit tests PASS | Dev 2/QA | `ctest.log` |
| Install `--no-enable` PASS | Board operator | `systemd_status.txt` |
| No-MCU demo PASS | Dev 2/QA | `logs/demo/*` |
| Fault/recover fake MCU PASS | QA | iobus/core logs |
| Evidence tarball uploaded | QA | tarball path/checksum |

Không qua checklist này thì không báo "SOM deploy ready".

---
**Rev** 1.0 | 2026-06-13 — tạo SOP deploy SOM no-MCU
