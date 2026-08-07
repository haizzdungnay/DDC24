# Evidence — Deploy Scheduler v3.1 lên Foxlinx SOM-DDC-24

> **Ngày:** 2026-08-07 · **Bo:** `SOM-DDC-24-foxlinx` (`OK1126B-buildroot`, aarch64, kernel 6.1.141)
> **Commit deploy:** `7d128952e4be587b64e2315e700c492fe7fcfe46` (nhánh `feat/scheduler-v3.1`)
> **Commit trước đó trên bo:** `5313f7802d742eb7e7d7c654ba6b7f0c300e32d0` (build 2026-08-06T04:45:28Z)
> **Kết quả:** Deploy **thành công**, 5/5 service `active`, health toàn `ok`.
> **Còn lại:** kiểm chứng chức năng scheduler đầu-cuối — cần quyền ghi cấu hình lên bo, xem §6.

---

## 1. Khảo sát trước deploy — trả lời cổng `MIGRATION_REAL_FILE`

Mục tiêu ban đầu là lấy `schedule.conf` thật để kiểm chứng di trú (QĐ-8). Kết quả khảo sát
**chỉ đọc**, lúc 2026-08-07T09:40:39Z:

```
Bo: OK1126B-buildroot aarch64 6.1.141
CONFIG_DIR của mkddc-web đang chạy = /data/config

find / -name "schedule*.conf*"   → 0 kết quả
find / -type d -name "schedule.d" → 0 kết quả

/data/config: device.conf · fieldbus.conf · fieldbus.journal · fieldbus.lkg.json
              historian-v2.sqlite(+shm,-wal) · historian.conf · io_config.conf
              mkddc-web.running · point_tag_migration_report.json · profiles/ · users.conf
```

**Kết luận: bo chưa từng có lịch nào được cấu hình.** `CONFIG_DIR` đã xác nhận đúng bằng cách
đọc `/proc/<pid>/environ` của tiến trình `mkddc-web` đang chạy, nên không phải nhầm đường dẫn.

**Hệ quả cho R-01** (*mất cấu hình đang vận hành khi nâng cấp*): **vô hiệu trên bo này** — không
có cấu hình lịch nào để mất. Không phải "chưa kiểm được", mà là "không có gì để kiểm".

**Hệ quả cho QĐ-8:** hiện vật mà quyết định yêu cầu — một `schedule.conf` định dạng cũ đang vận
hành — **không tồn tại**. Xem §6 về việc cần PM xác nhận có bo nào khác đã giao hay không.

---

## 2. Backup trước khi đụng

```
/data/mkddc-backups/pre-scheduler-v31-20260807T094225Z.tar.gz   (10 MB)
  gồm: /data/config + /usr/sbin/mkddc-core + /opt/mkddc-web/mkddc-web

sha256 binary CŨ (để đối chiếu khi rollback):
  d7e94d7cb62fb280ece09215000f3f42af67b128edc630591fe996b13f64659a  mkddc-core
  ba72ee8205a011c2f243ec34922b2131ad1e97ed9fe9cf3543fe24fe27e78747  mkddc-web
```

Ngoài ra giữ bản cũ ngay cạnh bản mới để rollback trong một lệnh:
`/usr/sbin/mkddc-core.prev` (2,7 MB) · `/opt/mkddc-web/mkddc-web.prev` (17 MB).

---

## 3. Build cross-compile aarch64

```bash
cmake -S . -B build/fw-arm64 -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_TOOLCHAIN_FILE=platform/cmake/toolchain-aarch64-linux-gnu.cmake \
  -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON -DCORE_BUILD_TESTS=OFF
cmake --build build/fw-arm64 -j --target mkddc-core mkddc-schedule-sim

cd apps/web-api && GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -trimpath \
  -o ../../build/fw-arm64/mkddc-web ./cmd/mkddc-web
```

| Binary | Kích thước | Kiến trúc |
|---|---:|---|
| `mkddc-core` | 675 KB | ELF 64-bit ARM aarch64 |
| `mkddc-schedule-sim` | 239 KB | ELF 64-bit ARM aarch64 |
| `mkddc-web` | 18 MB | ELF 64-bit ARM aarch64, static |

---

## 4. Chạy thử **trên bo** trước khi thay bản đang chạy

Binary được đặt vào `/tmp` và chạy thử ở đó, chưa động tới bản production:

```
/tmp/mkddc-core --version
  → version=0.1.0 git_commit=7d12895… build_time=2026-08-07T09:42:48Z toolchain=GNU-13.3.0

/tmp/mkddc-schedule-sim --config /tmp/sim-test.json --schedule SCH-001 --start 2026-08-10 --days 4
  → 7 lần chuyển, 0 khoảng trống, 0 xung đột
     00:00 DEFAULT TẮT · 08:00 WEEKLY BẬT · 12:00 WEEKLY TẮT · 13:00 WEEKLY BẬT
     · 18:00 WEEKLY TẮT · 12/08 EXCEPTION(EXC-001) TẮT · 13/08 WEEKLY
```

**Khớp từng mốc với kết quả chạy trên host x86.** Engine đánh giá cho cùng kết quả trên cả hai
kiến trúc — đúng điều kiện để mô phỏng dùng chung engine với controller có ý nghĩa.

---

## 5. Cài đặt và trạng thái sau deploy

```
systemctl stop mkddc-web-pi mkddc-core
install -m 0755 /tmp/mkddc-core          /usr/sbin/mkddc-core
install -m 0755 /tmp/mkddc-schedule-sim  /usr/sbin/mkddc-schedule-sim   ← P1-03, binary mới
install -m 0755 /tmp/mkddc-web           /opt/mkddc-web/mkddc-web
systemctl start mkddc-core && systemctl start mkddc-web-pi
```

**sha256 binary đang chạy:**

```
c304851ffa40c120e80c3dbf999f7e8e5d97105d38f6d206edecf04c451d0bb8  mkddc-core
4eaae523668f2a1db2ef7a27b83a6a4be8f3900f9c617bd0b943d60578ab3c51  mkddc-schedule-sim
d60a2d1c365d9fba5fe27a3f2c721a92278b78976ee712e02cfd977ac9d22271  mkddc-web
version=0.1.0 git_commit=7d12895… build_time=2026-08-07T09:42:48Z
```

**Service:**

| Service | Trạng thái | Khởi động lúc |
|---|---|---|
| `mkddc-core` | active | 2026-08-07 09:45:28 ← mới |
| `mkddc-web-pi` | active | 2026-08-07 09:45:30 ← mới |
| `mkddc-iobus` | active | 2026-08-06 11:10:49 (không đụng) |
| `mkddc-netcfg` | active | 2026-08-06 09:09:22 (không đụng) |
| `mkddc-fakemcu` | active | 2026-08-06 11:10:49 (không đụng) |

**Health** (`GET :8081/api/v1/health`):

```json
{"status":"ok","checks":{"core":{"status":"ok"},"io_shm":{"status":"ok"},
 "iobus":{"status":"ok"},"mcu_connection":{"status":"ok"},
 "plc_shm":{"status":"ok"},"web":{"status":"ok"}},"version":"0.1.0-be-b6c"}
```

`GET /api/v1/schedules` không kèm token → **401** như thiết kế.

**`/data/config` không thay đổi** — deploy chỉ thay binary, không đụng cấu hình.

> Lưu ý cho runbook: `FOXLINX_DEPLOY_CHECKLIST.md` §4.2 ghi đường dẫn `/usr/local/bin`,
> `mkddc-webapi` và cổng 8080. Bo thật dùng `/usr/sbin`, `/opt/mkddc-web/mkddc-web`, service
> `mkddc-web-pi`, cổng **8081**. Checklist cần cập nhật.

---

## 6. Chưa làm được: kiểm chứng chức năng đầu-cuối

Bước còn lại là đặt một `schedule.conf` thật, nạp lại core, và quan sát DO-01 đổi trạng thái —
tức chứng minh lịch **thực sự điều khiển được đầu ra** trên phần cứng đã deploy.

Đã xác nhận việc này **an toàn**: `iobus` đang mở `/dev/pts/0` (fake MCU qua PTY), không phải
`/dev/ttyS2` của MCU thật, nên không có relay vật lý nào bị đóng cắt. `/dev/ttyS5` là RS-485
cho Modbus, không liên quan DO.

Chưa thực hiện vì bước này **ghi cấu hình vào bo đang chạy** — khác hẳn mọi thao tác đọc ở trên.
Cần người chủ dự án cho phép rồi mới làm, hoặc tự chạy:

```bash
# Trên bo, đặt lịch bật DO-01 trong khung giờ hiện tại, rồi:
systemctl reload mkddc-core
journalctl -u mkddc-core -n 40 | grep -i schedule
```

Tương tự, kiểm chứng qua REST API cần tài khoản web admin của bo — tôi không có và không đoán.

---

## 7. Rollback nếu cần

```bash
systemctl stop mkddc-web-pi mkddc-core
cp -f /usr/sbin/mkddc-core.prev /usr/sbin/mkddc-core
cp -f /opt/mkddc-web/mkddc-web.prev /opt/mkddc-web/mkddc-web
rm -f /usr/sbin/mkddc-schedule-sim
systemctl start mkddc-core && systemctl start mkddc-web-pi
# đối chiếu: sha256sum phải khớp d7e94d7c… và ba72ee82…
```

Cấu hình đầy đủ nằm trong `/data/mkddc-backups/pre-scheduler-v31-20260807T094225Z.tar.gz`.
