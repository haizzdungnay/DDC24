# 31 — Dev Team: Next Action FW SOM
## MK-DDC-24 — Yêu cầu triển khai các task còn lại

> **Document ID:** IMPL-DEV-NEXTACTION-MK-DDC-24-VI
> **Phiên bản:** 1.1 | 2026-06-22
> **Người nhận:** Dev 2 (SOM), Tester
> **Trạng thái:** In progress — IOB local PASS, MOD native PTY PASS, BAC native build/wiring done; external evidence còn mở

---

## Bối cảnh nhanh

`services/iobus` + `services/core` đã build sạch, 226/226 unit test pass.
**Logic layer hoàn tất.** Còn 3 việc blocking trước khi FW SOM đủ điều kiện integration test thật:

| # | Task | Blocking gì | Người làm |
|---|------|-------------|-----------|
| 1 | **IOB-006** — fix CI 2 test SKIP | 226/226 test clean | Dev 2 |
| 2 | **MOD-012** — Modbus transport thật | TC-10 group pass, RS-485 thật | Dev 2 |
| 3 | **BAC-012** — BACnet transport thật | TC-9 group pass, BTL pretest | Dev 2 + Tester |

---

## Việc 1 — IOB-006: Fix CI test SKIP (30 phút)

**Vấn đề:** `/dev/shm/mkddc_io_shm` còn tồn tại từ run trước → 2 test `IoCache` bị `GTEST_SKIP`.

**Làm gì:**

Mở file CI workflow (`.github/workflows/build.yml` hoặc tương đương), thêm bước xoá SHM **trước** bước `ctest`:

```yaml
- name: Cleanup stale SHM
  run: rm -f /dev/shm/mkddc_io_shm /dev/shm/mkddc_plc_shm || true

- name: Run tests
  run: ctest --test-dir build/services --output-on-failure
```

**Done khi:** CI xanh, không còn dòng `SKIP`, kết quả inventory hiện tại là **226/226 PASS**.

**Tài liệu tham khảo:** [30_PROTOCOL_LIB_INTEGRATION_PLAN §5](30_PROTOCOL_LIB_INTEGRATION_PLAN.md#5-task-iob-006--iocache-cleanup-shm-trong-ci-trước-khi-chạy-test)

---

## Việc 2 — MOD-012: Modbus libmodbus transport thật (~1–2 ngày)

**Vấn đề:** `modbus_master.open()` hiện trả `false` ngay — `libmodbus` chưa install, build không có `-DMKDDC_ENABLE_MODBUS=ON`.

**Bước 1 — Cài libmodbus (dev host x86_64):**

```bash
sudo apt update && sudo apt install libmodbus-dev
pkg-config --modversion libmodbus   # phải >= 3.1.6
```

**Bước 2 — Build với flag ON:**

```bash
cmake -S services -B build/services -DMKDDC_ENABLE_MODBUS=ON
cmake --build build/services -j$(nproc)
# Phải build sạch, 0 error
```

**Bước 3 — Test với fake slave (socat PTY + diagslave):**

```bash
# Tải diagslave: https://www.modbusdriver.com/diagslave.html
socat PTY,link=/tmp/ttyS_A PTY,link=/tmp/ttyS_B &
./diagslave -m rtu /tmp/ttyS_B &

# fieldbus.conf:  rs485.device = /tmp/ttyS_A
./build/services/mkddc-iobus &

# Kiểm ext cache có giá trị:
./build/shm_dump_io --ext

# Tắt diagslave — kiểm quality → BAD, alarm E302:
kill %2
sleep 5
journalctl -u mkddc-iobus | grep "E302"
```

**Bước 4 — Cross-compile aarch64 + deploy Orange Pi 5B:**

```bash
cmake -S services -B build/iobus-arm \
  -DCMAKE_TOOLCHAIN_FILE=cmake/aarch64-linux-gnu.cmake \
  -DMKDDC_ENABLE_MODBUS=ON \
  -DPKG_CONFIG_PATH=/opt/aarch64-sysroot/usr/lib/pkgconfig
```

Chi tiết cross-compile: [30_PROTOCOL_LIB_INTEGRATION_PLAN §4.2](30_PROTOCOL_LIB_INTEGRATION_PLAN.md)

**Done khi — tick đủ DoD:**

```
[ ] pkg-config libmodbus >= 3.1.6 confirm
[ ] cmake -DMKDDC_ENABLE_MODBUS=ON build sạch 0 error
[ ] modbus_master.open() log "RS-485 opened ..." (không còn no-op)
[ ] FC03 đọc từ diagslave PTY → ext_cache có value đúng
[ ] FC05/FC06 write → fake slave value thay đổi
[ ] Timeout → quality BAD + alarm E302 trong 3 × poll_ms
[ ] Cross-compile aarch64 build sạch
[ ] Deploy Orange Pi 5B — smoke test 10 phút không crash
[ ] CI có job MKDDC_ENABLE_MODBUS=ON xanh
[ ] 10_TASK_CHECKLIST.md cập nhật trạng thái MOD-012
```

---

## Việc 3 — BAC-012: BACnet bacnet-stack transport thật (~2–4 ngày)

**Vấn đề:** `bacnet_server.start()` hiện là `fprintf + return` — `bacnet-stack` chưa install, build không có `-DMKDDC_ENABLE_BACNET=ON`.

**Bước 1 — Cài bacnet-stack (dev host x86_64):**

```bash
# Cách apt (Ubuntu 22.04+):
sudo apt install libbacnet-stack-dev bacnet-tools

# Nếu apt không có >= 1.3.x — build từ source:
git clone https://github.com/bacnet-stack/bacnet-stack.git
cd bacnet-stack && git checkout tags/bacnet-stack-1.3.8
make clean all BACNET_PORT=linux BACDL_DEFINE=-DBACDL_BIP=1
sudo make install
pkg-config --modversion bacnet-stack   # confirm
```

**Bước 2 — Build với flag ON:**

```bash
cmake -S services -B build/services -DMKDDC_ENABLE_BACNET=ON
cmake --build build/services -j$(nproc)
```

**Bước 3 — Smoke test mạng thật (cần 2 máy trên cùng LAN):**

```bash
# Trên SOM (hoặc dev host):
sudo ./build/services/mkddc-iobus

# Trên máy test (cùng LAN):
bacwi -1
# Mong đợi: "I-Am: device instance 1234 ..."

bacrp 1234 0 1 85        # Đọc AI1 Present_Value
bacwp 1234 1 1 85 8 4 9.5  # Ghi AO1 priority 8 = 9.5

# Kiểm audit log trên SOM:
journalctl -u mkddc-core | grep "bacnet" | tail -5
# Mong đợi: "accepted" hoặc "overridden"
```

**Bước 4 — Cross-compile aarch64 + deploy (giống MOD-012 bước 4, thêm `-DMKDDC_ENABLE_BACNET=ON`).**

Chi tiết đầy đủ: [30_PROTOCOL_LIB_INTEGRATION_PLAN §3](30_PROTOCOL_LIB_INTEGRATION_PLAN.md)

**Done khi — tick đủ DoD:**

```
[ ] bacnet-stack >= 1.3.x install confirm
[ ] cmake -DMKDDC_ENABLE_BACNET=ON build sạch 0 error
[ ] bacnet_server.start() log "bound UDP/47808 on <iface>" (không còn no-op)
[ ] bacwi -1 → I-Am với device instance đúng ≤ 500ms
[ ] bacrp AI1 Present_Value → float khớp UI1 scaled (sai số < 0.1%)
[ ] bacrp AI1 Reliability → NO_FAULT_DETECTED
[ ] bacwp AO1 priority 8 → core audit "accepted" hoặc "overridden"
[ ] bacwp AO1 NULL → core audit "released"
[ ] safety/manual vẫn thắng BACnet (inject manual trước, check audit)
[ ] Cross-compile aarch64 build sạch
[ ] CI có job MKDDC_ENABLE_BACNET=ON xanh
[ ] 10_TASK_CHECKLIST.md cập nhật trạng thái BAC-012
```

---

## Việc 4 — BTL-001: BTL pretest VTS (sau khi BAC-012 xong)

**Người làm:** Tester (+ Dev 2 hỗ trợ cấu hình)

**Yêu cầu tiên quyết:**
- BAC-012 hoàn tất (bacnet_server đang bind UDP/47808 thật)
- Windows VM setup (IOT-5674)
- VTS v3.x cài trên VM, kết nối cùng LAN với SOM

**Thực hiện theo:** [29_BACNET_BTL_PRETEST_PROCEDURE](29_BACNET_BTL_PRETEST_PROCEDURE.md)

**Done khi:** Log BTL pretest lưu tại `docs/00_management/evidence/certification/bacnet-pretest-<date>.log`

---

## Quy tắc khi làm xong mỗi task

1. Tick đủ DoD checklist trong tài liệu tương ứng (30_PROTOCOL_LIB_INTEGRATION_PLAN)
2. Cập nhật trạng thái trong [10_TASK_CHECKLIST.md](10_TASK_CHECKLIST.md) — ghi `Trạng thái: ĐÃ làm YYYY-MM-DD — [tóm tắt]`
3. Bump Rev footer của doc liên quan (24 cho BAC-012, 25 cho MOD-012)
4. PR phải có CI xanh với flag ON trước khi merge

---

## Kết quả triển khai 2026-06-22

| Hạng mục | Evidence hiện có | Còn mở |
|---|---|---|
| IOB-006 | Workflow cleanup SHM; local `226/226 PASS`, 2 IoCache không SKIP | Remote CI green |
| MOD-012 | libmodbus 3.1.10; `MODBUS=ON` build sạch; PTY FC03, FC05, FC06, timeout → BAD + E302 PASS; runtime worker + CI matrix đã thêm | aarch64, board 10 phút/1 giờ, RS-485 thật |
| BAC-012 | bacnet-stack 1.3.8 pin FetchContent; `BACNET=ON` full build sạch trước final runtime wiring; API 1.3.8, UDP bind, AI/BI shm sync, AO/BO core callback, release mapping và CI matrix đã thêm | Exact-tree re-run bị tool quota chặn; LAN `bacwi/bacrp/bacwp`, aarch64 và board |
| BTL-001 | Procedure giữ nguyên | Chỉ chạy sau BAC LAN/board smoke |

Không tick các bước hardware/LAN/BTL khi chưa có evidence thật. Test inventory hiện tại là 226, không phải 228.

---

**Rev** 1.1 | 2026-06-22 — Ghi kết quả triển khai local và external evidence còn mở · 1.0 | 2026-06-22 — Tạo mới: yêu cầu triển khai IOB-006 / MOD-012 / BAC-012 / BTL-001 cho Dev 2 và Tester
