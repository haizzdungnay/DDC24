# 30 — Protocol Library Integration Plan
## MK-DDC-24 — BACnet bacnet-stack + Modbus libmodbus: cài đặt, build, và validate thật

> **Document ID:** IMPL-PROTO-LIB-INTEG-MK-DDC-24-VI
> **Phiên bản:** 1.2 | 2026-06-26
> **Trạng thái:** In progress — IOB-006 ✅; MOD-012: 9/11 DoD ✅ (còn 1h smoke + thiết bị thật); BAC-012: 1/10 DoD ✅ (còn LAN + aarch64 + board)
> **Owner:** Dev 2 (SOM) + Tester
> **Đọc trước:** [24_BACNET_IMPLEMENTATION_PLAN](24_BACNET_IMPLEMENTATION_PLAN.md) · [25_MODBUS_IMPLEMENTATION_PLAN](25_MODBUS_IMPLEMENTATION_PLAN.md) · [29_BACNET_BTL_PRETEST_PROCEDURE](29_BACNET_BTL_PRETEST_PROCEDURE.md)

---

## 1. Bối cảnh — Tại sao cần doc này

BAC-001..011 và MOD-001..011 đã implement **logic layer** có 226 test trong CTest inventory hiện tại.
Transport layer đã được wire vào runtime; trạng thái kiểm chứng hiện tại:

| Vấn đề | Hệ quả |
|--------|--------|
| `bacnet-stack` 1.3.8 pin qua CMake FetchContent | `BACNET=ON` đã build sạch trước final runtime wiring; cần re-run exact tree + LAN smoke |
| `libmodbus` 3.1.10 đã cài trên dev host | `MODBUS=ON` build sạch; PTY FC03/FC05/FC06/timeout PASS |
| Default CMake vẫn OFF | CI matrix mới compile/test riêng baseline, Modbus ON và BACnet ON |
| Stale SHM trước CTest | Workflow đã cleanup; local 226/226 PASS, 2 IoCache không SKIP |

**DoD của 24 §8 và 25 §8 chưa được check** — đây là gap cần giải quyết trong doc này.

---

## 2. Phân tích: cái gì đã thật, cái gì là no-op

### BACnet

| File | Tình trạng thực tế |
|------|--------------------|
| `bacnet_config.cpp` — parse `bacnet.conf` / `device.conf` | ✅ Real, test pass |
| `bacnet_objects.cpp` — object registry AI/BI/AO/BO/AV/BV/MSV | ✅ Real, test pass |
| `bacnet_priority.cpp` — Priority_Array[16] + relinquish_default | ✅ Real, test pass |
| `bacnet_cov.cpp` — COV subscription + change detect | ✅ Real, test pass |
| `bacnet_reliability.cpp` — quality → Reliability/Status_Flags | ✅ Real, test pass |
| `bacnet_alarm.cpp` — Notification Class bridge | ✅ Real, test pass |
| `bacnet_server.cpp` — init stack, UDP socket, APDU dispatch | ⚠️ **No-op** khi `MKDDC_ENABLE_BACNET=OFF`; tất cả network I/O guarded bởi `#ifdef MKDDC_ENABLE_BACNET` |

### Modbus

| File | Tình trạng thực tế |
|------|--------------------|
| `fieldbus_config.cpp` — parse `fieldbus.conf` + reload | ✅ Real, test pass |
| `device_profile.cpp` — profile JSON parser/validator | ✅ Real, test pass |
| `register_codec.cpp` — bool/int/float32 endian/scale | ✅ Real, test pass |
| `poll_scheduler.cpp` — due-time/retry/offline | ✅ Real, test pass |
| `ext_cache.cpp` — value/quality/timestamp cache | ✅ Real, test pass |
| `fieldbus_metrics.cpp` — per-slave counters | ✅ Real, test pass |
| `modbus_master.cpp` — libmodbus context, RTU open/close/read/write | ⚠️ **No-op** khi `MKDDC_ENABLE_MODBUS=OFF`; `open()` trả `false`, `poll_once()` no-op |

### IoCache

| Test | Tình trạng |
|------|-----------|
| `IoCache.CleanBootInitsDefaults` | **SKIP** — `/dev/shm/mkddc_io_shm` tồn tại từ run trước |
| `IoCache.ReattachPreservesCoreOwnedFields` | **SKIP** — cùng lý do |

Đây **không phải lỗi code** — test có guard check đúng. Vấn đề là CI không cleanup SHM trước khi chạy test suite.

---

## 3. Task BAC-012 — bacnet-stack: install + build thật + smoke test

```
Task ID: BAC-012
Tên: bacnet-stack library: cài đặt, build MKDDC_ENABLE_BACNET=ON, smoke test mạng thật
Owner: Dev SOM | Phase: 4.5 | Module: bacnet_server, CMake, CI
Input: bacnet-stack >= 1.3.x, bacnet.conf, device.conf, LAN với máy test có bacnet-tools
Output:
  - mkddc-iobus build sạch với MKDDC_ENABLE_BACNET=ON
  - bacnet_server.start() mở UDP/47808 thật
  - Who-Is/I-Am pass từ máy khác cùng LAN
  - ReadProperty AI1 trả đúng giá trị từ core snapshot
  - WriteProperty AO1 priority 8 → core audit log "accepted" hoặc "overridden"
Phụ thuộc: BAC-001..011 (đã xong)
```

### 3.1 Dependency native x86_64

Project ưu tiên package `bacnet-stack >= 1.3` nếu host thực sự cung cấp `pkg-config`; nếu không, CMake tự fetch tag chính thức `bacnet-stack-1.3.8`. Không giả định Ubuntu có `libbacnet-stack-dev` hoặc file `.pc`.

```bash
cmake -S services -B build/services-bacnet \
  -DMKDDC_ENABLE_BACNET=ON \
  -DMKDDC_ENABLE_MODBUS=OFF
cmake --build build/services-bacnet --parallel
```

### 3.2 Cross-compile aarch64 — Orange Pi 5B

Cùng dependency pin được cross-build bởi toolchain của top-level CMake; không cần `make install` hoặc sysroot pkg-config riêng.

```bash
cmake -S services -B build/services-bacnet-arm \
  -DCMAKE_SYSTEM_NAME=Linux \
  -DCMAKE_SYSTEM_PROCESSOR=aarch64 \
  -DCMAKE_C_COMPILER=aarch64-linux-gnu-gcc \
  -DCMAKE_CXX_COMPILER=aarch64-linux-gnu-g++ \
  -DMKDDC_ENABLE_BACNET=ON
cmake --build build/services-bacnet-arm --parallel
```

### 3.3 Build mkddc-iobus với BACNET

```bash
# Native (dev/test):
cmake -S services -B build/services \
  -DMKDDC_ENABLE_BACNET=ON
cmake --build build/services -j$(nproc)
# Kiểm tra không có MKDDC_ENABLE_BACNET warning:
strings build/services/mkddc-iobus | grep -i bacnet
```

### 3.4 Smoke test mạng thật

Cần: 2 máy trên cùng LAN (SOM chạy mkddc-iobus + máy test chạy bacnet-tools).

```bash
# Trên SOM — chạy iobus với BACnet:
sudo systemctl start mkddc-iobus
# Hoặc chạy tay:
sudo ./mkddc-iobus --config /etc/mkddc/iobus.conf

# Trên máy test:
# Quét tìm thiết bị (device ID từ device.conf, ví dụ 1234):
bacwi -1
# Kết quả mong đợi: "I-Am: device instance 1234 ..."

# Đọc AI1 (object type 0, instance 1):
bacrp 1234 0 1 85        # property 85 = Present_Value
# Kết quả: giá trị float tương ứng UI1 scaled

# Đọc Device Object Name (object type 8, instance 1234):
bacrp 1234 8 1234 77     # property 77 = Object_Identifier

# Write AO1 (object type 1, instance 1) tại priority 8:
bacwp 1234 1 1 85 8 4 9.5   # type=4(REAL), value=9.5, priority=8
# Kiểm tra audit log core:
journalctl -u mkddc-core | grep "bacnet" | tail -5
```

### 3.5 DoD BAC-012
**Evidence 2026-06-22:** bacnet-stack 1.3.8 FetchContent build và full `BACNET=ON` build đã sạch trước khi thêm final `main.cpp` runtime wiring.
**Evidence 2026-06-26:** exact-tree rebuild với MKDDC_ENABLE_BACNET=ON: 123/123 tests PASS (thêm ReadExtReceivesSnapshot + GraphProtocol tests); CI matrix `bacnet` xanh.

```
[ ] bacnet-stack >= 1.3.x cài được trên dev host (native) — pkg-config confirm version (FetchContent; không qua pkg-config)
[ ] bacnet-stack cross-compile aarch64 thành công
[x] cmake -DMKDDC_ENABLE_BACNET=ON build sạch, 0 error — 123/123 tests PASS 2026-06-26
[ ] bacnet_server.start() log "bound UDP/47808 on <interface>" thay vì no-op
[ ] bacwi -1 từ máy khác → I-Am với device instance đúng trong ≤ 500ms
[ ] bacrp AI1 Present_Value → float khớp UI1 scaled (sai số < 0.1%)
[ ] bacrp AI1 Reliability → NO_FAULT_DETECTED khi IO bình thường
[ ] bacwp AO1 priority 8 → core audit log "accepted" hoặc "overridden" đúng
[ ] bacwp AO1 priority 8 NULL (release) → core audit log "released"
[ ] safety/manual (mức 1/2) vẫn thắng BACnet (mức 3) — kiểm inject manual trước
```

---

## 4. Task MOD-012 — libmodbus: install + build thật + fake slave + thiết bị thật

```
Task ID: MOD-012
Tên: libmodbus library: cài đặt, build MKDDC_ENABLE_MODBUS=ON, fake slave, thiết bị thật RS-485
Owner: Dev SOM | Phase: 3.5 | Module: modbus_master, CMake, CI
Input: libmodbus >= 3.1.6, /dev/ttyUSB0 hoặc /dev/ttyS* RS-485, diagslave hoặc thiết bị Modbus thật
Output:
  - mkddc-iobus build sạch với MKDDC_ENABLE_MODBUS=ON
  - modbus_master.open() kết nối RS-485 thật
  - FC03 đọc được register từ diagslave (fake) + thiết bị thật
  - ext_cache cập nhật value/quality/ts đúng
  - Timeout → quality BAD, alarm E302
Phụ thuộc: MOD-001..011 (đã xong)
```

### 4.1 Cài đặt libmodbus (native x86_64 dev host)

```bash
# Cách 1 — apt:
sudo apt update && sudo apt install libmodbus-dev

# Kiểm tra version:
pkg-config --modversion libmodbus
# Cần >= 3.1.6

# Cách 2 — build từ source:
git clone https://github.com/stephane/libmodbus.git
cd libmodbus && git checkout tags/v3.1.10
./autogen.sh && ./configure --prefix=/usr/local
make -j$(nproc) && sudo make install
sudo ldconfig
```

### 4.2 Cài đặt libmodbus (cross-compile aarch64)

```bash
# Cross-build:
cd libmodbus
./autogen.sh
./configure \
  --host=aarch64-linux-gnu \
  --prefix=/opt/aarch64-sysroot/usr
make -j$(nproc) && make install

# CMake cross-build iobus:
cmake -S services -B build/iobus-aarch64 \
  -DCMAKE_TOOLCHAIN_FILE=../cmake/aarch64-linux-gnu.cmake \
  -DMKDDC_ENABLE_MODBUS=ON \
  -DPKG_CONFIG_PATH=/opt/aarch64-sysroot/usr/lib/pkgconfig
```

### 4.3 Build mkddc-iobus với MODBUS

```bash
cmake -S services -B build/services \
  -DMKDDC_ENABLE_MODBUS=ON
cmake --build build/services -j$(nproc)
```

### 4.4 Test với fake slave (diagslave)

```bash
# Cài diagslave (Linux Modbus simulator):
# https://www.modbusdriver.com/diagslave.html
chmod +x diagslave
# Chạy fake slave tại địa chỉ 1, RTU qua socat PTY:
socat PTY,link=/tmp/ttyS_MASTER PTY,link=/tmp/ttyS_SLAVE &
./diagslave -m rtu /tmp/ttyS_SLAVE

# fieldbus.conf trỏ tới /tmp/ttyS_MASTER, slave addr=1
# Chạy iobus:
./mkddc-iobus --config /etc/mkddc/iobus.conf &

# Kiểm tra ext_cache update:
# (dùng shm_dump_io hoặc kiểm log)
./shm_dump_io --ext | head -20

# Inject lỗi (tắt diagslave):
kill %2
# Đợi timeout:
sleep 5
./shm_dump_io --ext | grep quality  # → BAD
journalctl -u mkddc-iobus | grep "E302"
```

### 4.5 Test với thiết bị thật RS-485

```bash
# Kiểm tra interface RS-485:
ls /dev/ttyUSB* /dev/ttyS* 2>/dev/null

# fieldbus.conf:
# rs485.device = /dev/ttyUSB0
# baud = 19200   (theo thiết bị)
# slaves: [{addr: 1, profile: "generic-power-meter"}]

# Chạy mkddc-iobus — kiểm log online:
journalctl -u mkddc-iobus -f | grep -E "slave|online|E302|E303"

# Smoke test 1h không crash:
systemd-run --unit=modbus-smoke-test ./run_soak_test.py --duration 3600
```

### 4.6 DoD MOD-012

```
[x] libmodbus 3.1.10 install native — pkg-config confirm
[ ] libmodbus cross-compile aarch64 thành công
[x] cmake -DMKDDC_ENABLE_MODBUS=ON build sạch, 0 error — 141/141 tests PASS 2026-06-26 (thêm E303+T11 TCP loopback)
[x] modbus_master.open() log "RS-485 opened <device> <baud>N81" trong PTY test
[x] FC03 đọc register từ libmodbus PTY slave — ext_cache value=1234
[x] FC05/FC06 write vào libmodbus PTY slave — coil/register xác nhận
[x] Hai timeout liên tiếp → quality BAD + E302 trong PTY test
[x] Bus error rate > 10% → alarm E303 — FieldbusMetrics.E303BusErrorRateAlarm PASS 2026-06-26
[x] Core nhận ext snapshot qua fieldbus.sock — BacnetObjtable.ReadExtReceivesSnapshot PASS 2026-06-26
[ ] 1h smoke với fake slave — không crash, không leak memory (valgrind hoặc /proc/mem)
[ ] Ít nhất 1 lần test với thiết bị Modbus thật (nếu có sẵn)
```

---

## 5. Task IOB-006 — IoCache: cleanup SHM trong CI trước khi chạy test

```
Task ID: IOB-006
Tên: CI cleanup /dev/shm/mkddc_io_shm trước khi chạy test suite
Owner: Dev SOM | Phase: 3 | Module: CI (.github/workflows), test_io_cache
Input: 2 test bị SKIP do SHM còn tồn tại từ run trước
Output:
  - CI job có bước cleanup SHM trước ctest
  - IoCache.CleanBootInitsDefaults và ReattachPreservesCoreOwnedFields PASS thay vì SKIP
Phụ thuộc: SKEL-004 (CI build)
```

### 5.1 Fix CI workflow

Thêm bước cleanup vào `.github/workflows/build.yml` (hoặc file CI tương ứng) trước lệnh `ctest`:

```yaml
- name: Cleanup stale SHM before tests
  run: |
    # Xoá SHM nếu còn từ run trước (mkddc_io_shm, mkddc_plc_shm)
    rm -f /dev/shm/mkddc_io_shm /dev/shm/mkddc_plc_shm || true

- name: Run tests
  run: ctest --test-dir build/services --output-on-failure
```

### 5.2 DoD IOB-006

```
[x] CI workflow có bước xoá /dev/shm/mkddc_io_shm và mkddc_plc_shm trước ctest
[x] IoCache.CleanBootInitsDefaults: local PASS, không SKIP (remote CI pending)
[x] IoCache.ReattachPreservesCoreOwnedFields: local PASS (remote CI pending)
[x] 226/226 test PASS trên inventory hiện tại, 0 SKIP
```

---

## 6. Task BTL-001 — BTL pretest tooling: VTS setup + Windows VM

```
Task ID: BTL-001
Tên: Thiết lập môi trường BTL pretest: VTS trên Windows VM + kết nối network với SOM
Owner: Tester + Dev SOM
Input: KVM VM setup (IOT-5674), bacnet-tools, VTS v3.x, SOM chạy mkddc-iobus với BACNET=ON
Output: BTL pretest có thể chạy lặp lại theo quy trình 29_BACNET_BTL_PRETEST_PROCEDURE
Phụ thuộc: BAC-012 (BACnet transport hoạt động thật), IOT-5674 (Windows VM)
```

Xem chi tiết quy trình tại [29_BACNET_BTL_PRETEST_PROCEDURE](29_BACNET_BTL_PRETEST_PROCEDURE.md).

---

## 7. Thứ tự thực hiện

```
IOB-006   ← không phụ thuộc gì, làm ngay (30 phút)
    |
    |
BAC-012 (native dev host)   MOD-012 (native dev host)
    |    song song                 |
    |                              |
BAC-012 (cross-compile aarch64)   MOD-012 (cross-compile aarch64)
    |    song song                 |
    |                              |
    +──────────── board deploy ────+
                    |
                BTL-001 (cần BAC-012 hoàn tất)
```

---

## 8. Yêu cầu cho Team Dev — Đọc, Review và Thực hiện

> **Người nhận:** Dev 2 (SOM), Tester
> **Deadline:** cần hoàn tất trước khi E2E-001 có thể chạy với BACnet/Modbus thật

---

### Dev 2 (SOM) — Danh sách việc cần làm theo thứ tự

**Việc 1 — IOB-006 (khoảng 30 phút):**
- Mở `.github/workflows/build.yml` (hoặc file CI build tương ứng)
- Thêm bước `rm -f /dev/shm/mkddc_io_shm /dev/shm/mkddc_plc_shm` trước bước `ctest`
- Push, xác nhận CI chạy 228/228 test PASS (không còn SKIP)

**Việc 2 — MOD-012, bước install native (khoảng 1 giờ):**
- `sudo apt install libmodbus-dev` trên dev host
- `cmake -DMKDDC_ENABLE_MODBUS=ON`, build sạch
- Chạy test với fake slave (socat PTY + diagslave) theo §4.4
- Tick DoD MOD-012 §4.6

**Việc 3 — BAC-012, bước install native (khoảng 2–4 giờ):**
- Cài `bacnet-stack` (apt hoặc build từ source — xem §3.1)
- `cmake -DMKDDC_ENABLE_BACNET=ON`, build sạch
- Chạy smoke test `bacwi`/`bacrp`/`bacwp` từ máy test trên cùng LAN — theo §3.4
- Tick DoD BAC-012 §3.5

**Việc 4 — cross-compile aarch64 (song song hoặc sau việc 2+3):**
- Làm theo §3.2 (BACnet) + §4.2 (Modbus) cho toolchain aarch64
- Deploy lên Orange Pi 5B, chạy smoke test trên board thật
- Nếu có board + RS-485 converter: chạy test thiết bị thật theo §4.5

**Sau khi xong việc 1–4:** update trạng thái các task trong `10_TASK_CHECKLIST.md` + bump Rev.

---

### Tester — Danh sách việc cần làm

**Việc 1 — BTL-001 (sau khi BAC-012 xong):**
- Setup KVM VM (xem IOT-5674 nếu chưa xong)
- Cài VTS v3.x trên Windows VM
- Kết nối VM cùng mạng với SOM đang chạy mkddc-iobus (BACNET=ON)
- Thực hiện quy trình theo [29_BACNET_BTL_PRETEST_PROCEDURE](29_BACNET_BTL_PRETEST_PROCEDURE.md)
- Lưu kết quả vào `docs/00_management/evidence/certification/bacnet-pretest-<date>.log`

---

### Điều kiện review trước khi merge

Mỗi task chỉ được đánh Done khi:
1. Build CI xanh với flag ON
2. DoD checklist tick đủ (xem §3.5, §4.6, §5.2)
3. Test log lưu tại `docs/00_management/evidence/`
4. `10_TASK_CHECKLIST.md` cập nhật trạng thái + bump Rev

---

**Rev** 1.2 | 2026-06-26 — Tick BAC-012 #3 (BACNET=ON 123 test), MOD-012 #3/#8/#9 (MODBUS=ON 141 test, E303, ext snapshot); CI matrix modbus+bacnet added; T11 TCP loopback deadlock fixed · 1.1 | 2026-06-22 — Implement local IOB/MOD, BAC source/runtime wiring; record external evidence pending · 1.0 | 2026-06-22 — Tạo mới: gap analysis BACnet/Modbus transport no-op, IoCache CI skip, plan install/build/validate, yêu cầu team dev
