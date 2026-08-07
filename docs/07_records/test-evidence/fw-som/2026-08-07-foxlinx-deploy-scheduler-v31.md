# Evidence — Deploy Scheduler v3.1 lên Foxlinx SOM-DDC-24

> **Ngày:** 2026-08-07 · **Bo:** `SOM-DDC-24-foxlinx` (`OK1126B-buildroot`, aarch64, kernel 6.1.141)
> **Commit deploy:** `7d12895` (P1+P2) → `5ba8318` (P3+P4, bản cuối đang chạy)
> **Commit trước đó trên bo:** `5313f7802d742eb7e7d7c654ba6b7f0c300e32d0` (build 2026-08-06T04:45:28Z)
> **Kết quả:** Deploy **thành công** cả backend lẫn giao diện. 5/5 service `active`, health toàn `ok`,
> 14 endpoint scheduler đã đăng ký, bundle không còn nhãn `TSx` nào.
> **Kiểm chứng chức năng đầu-cuối:** ✅ ĐẠT trên DO và AO, gồm cả phân xử priority và nhả quyền
> — xem §6c. Trong lúc kiểm chứng có một sự cố mất dữ liệu do tôi gây ra, đã khôi phục; §6c ghi
> đầy đủ.

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

> **SỬA KẾT LUẬN (2026-08-07T11:30Z).** Đoạn trên đúng về *dữ kiện* nhưng sai về *kết luận
> rút ra*. Từ "không có hiện vật khách hàng" tôi đã kết luận `MIGRATION_REAL_FILE = N/A`;
> hai mệnh đề đó không tương đương. Thứ QĐ-8 và R-01 thật sự lo là **đường di trú có chạy
> trên bo không** — câu hỏi đó kiểm được, bằng một tệp v1 tổng hợp chạy trên chính binary
> của bo. Bài kiểm đó tìm ra 2 lỗi CHẶN. Xem **§6e**, nay mới là câu trả lời cho cổng này.

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

## 6b. Deploy P2 — giao diện (cùng ngày, lần thứ hai)

Sau khi P2 đóng cổng ra trên máy dev (436/436 test · lint 0 · build 624 ms), đẩy tiếp giao diện:

```
tar -czf dist-new.tgz -C build/web-ui/dist .     (824 KB nén, 1,7 MB giải nén)
→ /opt/mkddc-web/dist.new  → hoán đổi nguyên thư mục → /opt/mkddc-web/dist
   (giữ bản cũ thành dist.old + dist.prev)
systemctl restart mkddc-web-pi
```

Hoán đổi **nguyên thư mục** thay vì copy đè: không bao giờ để `dist` ở trạng thái nửa cũ nửa mới,
kể cả trong vài trăm mili-giây.

**Kiểm chứng trên bo:**

| Mục | Kết quả |
|---|---|
| `mkddc-web-pi` | `active` |
| Health | `status: ok`, cả 6 check |
| `GET /` | HTTP 200 |
| 5 endpoint scheduler chưa auth | **401** (không phải 404 — route đã đăng ký đúng) |
| Bundle có mã v3.1 | có `schedule_id` / `weekly_schedule` trong `index-*.js` |
| Bundle còn nhãn `TSx` | **0** ⇒ acceptance #20 của đặc tả đạt trên bo thật |

401 chứ không phải 404 là điểm cần nhìn kỹ: nó chứng minh 14 route mới **đã được đăng ký** và
lớp xác thực đang chặn đúng, chứ không phải backend cũ còn chạy.

---

## 6c. Kiểm chứng chức năng đầu-cuối trên bo (DO + AO) — ✅ ĐẠT

Chủ dự án cho phép ghi cấu hình lên bo. An toàn đã xác nhận trước: `iobus` mở `/dev/pts/0`
(fake MCU qua PTY), **không có relay vật lý nào bị đóng cắt**.

Đọc trạng thái đầu ra bằng một probe chỉ-đọc mmap `/dev/shm/mkddc_io_shm` với seqlock, biên dịch
từ chính `contracts/shm/mkddc_shm.h` — tính offset bằng tay dễ sai vì căn lề.

### Ca 1 — Lịch điều khiển được DO và AO

```
TRƯỚC:  DO_CMD  DO-01=0            AO_SP  AO-01=0.000
        (bo chưa có lịch nào)

Cài schedule.conf: SCH-001 BINARY → DO-01 = ACTIVE
                   SCH-002 REAL   → AO-01 = 50.0 (%)
core log: INFO schedule_cfg.loaded path=/data/config/schedule.conf schedules=2

SAU:    DO_CMD  DO-01=1   DO_FB  DO-01=1      AO_SP  AO-01=5.000 (mode 0)
```

Hai điểm đáng chú ý:

- **`DO_FB = 1`** là phản hồi relay, nghĩa là lệnh đã đi HẾT chuỗi: tệp cấu hình → core parse →
  `ScheduleRuntime` → `PriorityResolver` → `PointWriter` → SHM → iobus → MCU → phản hồi về.
  Chỉ `DO_CMD` thôi thì mới chứng minh được nửa đường.
- **`AO-01 = 5.000 V`** đúng bằng 50 % của thang 0-10 V — phép đổi `ao_percent_to_engineering`
  chạy đúng trên ARM.

### Ca 2 — Phân xử priority giữa hai lịch cùng một điểm (ADR-023 QĐ-1)

```
SCH-LOW   priority 16 → DO-02 = INACTIVE
SCH-HIGH  priority  2 → DO-02 = ACTIVE
SCH-AO    priority 16 → AO-02 = 100.0 (%)

Kết quả: DO_CMD DO-02=1   DO_FB DO-02=1   AO_SP AO-02=10.000
```

Priority **2 thắng priority 16** trên phần cứng thật. `AO-02 = 10.000 V` là biên trên của thang
0-10 V, đúng với 100 %.

### Ca 3 — Nhả quyền khi lịch không còn (`release_missing`)

Ca 2 dùng DO-02/AO-02, không còn nhắc DO-01/AO-01 của ca 1. Kết quả: **DO-01 về 0 và AO-01 về
0.000** — core đã nhả hai điểm đó, không giữ giá trị cũ.

Gỡ hẳn `schedule.conf`:

```
core log: WARN schedule_cfg.missing path=/data/config/schedule.conf (schedules disabled)
DO_CMD  DO-01=0 DO-02=0 DO-03=0 DO-04=0
AO_SP   AO-01=0.000 … AO-04=0.000
```

Mọi đầu ra về mức an toàn.

### Sự cố trong lúc kiểm chứng — và cách xử lý

Khảo sát lúc **09:40** cho thấy bo không có `schedule.conf`. Nhưng lúc **10:14:34**, `admin` từ
`101.99.36.34` đã **tạo lịch `SCH-001` qua giao diện mới vừa deploy**. Đến 10:21 tôi ghi đè
`schedule.conf` bằng lịch thử **mà không kiểm lại**, rồi 10:22 xoá hẳn — **làm mất lịch đó**.

Đây đúng lớp lỗi R-01 mà cả plan này cố phòng, và tôi tự gây ra: **dữ liệu đọc lúc 09:40 đã cũ
41 phút khi tôi hành động lúc 10:21**.

Khôi phục được **nhờ chính QĐ-9**: `schedule.d/SCH-001/audit.jsonl` không bị xoá và giữ đủ thông
tin để dựng lại:

```
2026-08-07T10:14:34Z  admin  CREATE  rev None→1
  CREATE Lịch SCH-001 (BINARY, priority 16, 0 target: )
```

Lịch đã được dựng lại nguyên trạng (BINARY, priority 16, 0 target, `DRAFT`, đang tắt, revision 1,
`created_by: admin`) và `core` nạp lại: `schedule_cfg.loaded schedules=1`.

**Bài học cho runbook:** trước khi ghi đè bất kỳ tệp cấu hình nào trên bo đang chạy, phải đọc lại
NGAY TRƯỚC thao tác ghi — không dùng kết quả khảo sát từ trước đó. Nếu tệp tồn tại thì sao lưu
trước, kể cả khi lần khảo sát trước nói là không có.

### Trạng thái bo sau khi kết thúc

| Mục | Trạng thái |
|---|---|
| `SCH-001` của người dùng | Đã khôi phục, `core` nạp `schedules=1` |
| Nhật ký audit | Còn nguyên (QĐ-9 hoạt động đúng lúc cần nhất) |
| DO/AO | Mọi kênh về 0 — `SCH-001` đang tắt |
| 5 service | `active` |
| Health | `ok` |
| Tệp tạm trên bo | Đã dọn (`/tmp/io_probe`, `/tmp/mkddc-*`, `/tmp/*.json`, `/tmp/dist-new.tgz`) |

---

## 6d. Deploy P3 + P4 và kiểm chứng bản vá múi giờ — ✅ ĐẠT

Commit `5ba8318`, build `2026-08-07T10:39:25Z`. Deploy `mkddc-core` + `mkddc-schedule-sim` +
`mkddc-web`. 5/5 service `active`, health `ok`.

**Áp dụng bài học ở §6c:** đọc lại `schedule.conf` **ngay trước** khi đụng, không dùng khảo sát
cũ. Kết quả: tệp đã đổi thành `{"schedules": []}` — có người xoá `SCH-001` qua giao diện sau khi
tôi khôi phục. Đã sao lưu thành `schedule.conf.bak-20260807T104005Z` trước mọi thao tác.

### Phép thử phân biệt được — chứng minh bản vá múi giờ

Mô phỏng chỉ chứng minh engine, không chứng minh đường chuyển đổi lúc chạy. Nên dựng một phép
thử mà **hai bản mã cho hai kết quả khác nhau**:

```
Bo chạy TZ = UTC.  Lúc thử: 17:41 giờ VN = 10:41 UTC.
Lịch khai báo Asia/Ho_Chi_Minh, cửa sổ 17:00–18:00 giờ VN.

  mã CŨ (dùng TZ tiến trình = UTC) → so với 10:41, NGOÀI cửa sổ → DO-01 = 0
  mã MỚI (dùng múi giờ của lịch)   → so với 17:41, TRONG cửa sổ → DO-01 = 1

Kết quả thật:  DO_CMD DO-01=1   DO_FB DO-01=1
```

`DO-01 = 1` ⇒ bản vá đúng. Nếu bản cũ còn chạy thì kết quả phải là 0.

Đây là lỗi **đang có thật** trên bo trước bản vá: mọi lịch cấu hình theo giờ Việt Nam sẽ chạy
lệch **7 tiếng**, và không có gì trên giao diện cho thấy điều đó.

### Dọn dẹp

`schedule.conf` khôi phục từ bản sao lưu (`schedules=0`), mọi tệp tạm đã xoá, 5/5 service
`active`, health `ok`. Bo về đúng trạng thái trước khi kiểm chứng.

---

## 6e. Kiểm chứng đường di trú v1 → v3.1 trên bo — ✅ ĐẠT, tìm ra 2 lỗi CHẶN

Đóng cổng `MIGRATION_REAL_FILE` (QĐ-8). Thực hiện 2026-08-07T11:08Z → 11:30Z.

### Phương pháp

Không có `schedule.conf` khách hàng, nên dựng một tệp v1 tổng hợp **phủ cả 7 giá trị
`scheduleType`** của định dạng cũ — mỗi giá trị ít nhất một hàng, kể cả các ca dễ bị bỏ sót:

| `scheduleType` | Hàng | Vì sao có mặt |
|---|---|---|
| `fan_state_value` | SCH-001 | ca thường gặp nhất |
| `digital_output_value` | SCH-002 | → `BINARY` |
| `analog_output_value` | SCH-003 | → `REAL`, setpoint **75** (số tròn) |
| `control_loop_setpoint` | SCH-004 | → `REAL`, setpoint **24.5** (số lẻ) |
| `controller_operation_mode` | SCH-005 | → `ENUMERATED` |
| `not_active` | SCH-010 | hàng vô hiệu — dễ bị bỏ rơi khi di trú |
| `holiday_period` ×2 | Tết `02-14`→`02-20`, Quốc khánh `09-02` | khoảng ngày + ngày đơn |

Tệp (8 hàng, sha256 `65995a23…`) được cài lên `/data/config/schedule.conf` và chạy bằng
**chính binary aarch64 của bo**, không phải bản dựng trên máy dev. Cấu hình thật của người
dùng sao lưu trước ở `/data/mkddc-backups/pre-migration-test-20260807T110826Z.tar.gz`.

### Lỗi CHẶN 1 — `MigrateSchedulesOnStartup` không ai gọi

Khởi động lại `mkddc-web-pi`: **không một dòng log `schedule.migrate` nào**, tệp vẫn nguyên
định dạng v1, không có `.v1.bak`. Nguyên nhân: hàm di trú viết xong, có 9 test, nhưng lời
gọi từ `Main()` chưa bao giờ được nối — một lệnh thay thế văn bản không khớp anchor đã im
lặng không làm gì và không ai kiểm lại.

Hệ quả nếu lọt ra hiện trường: mọi bo có cấu hình cũ kẹt HTTP 409 vĩnh viễn, **không có
đường di trú nào khác** — API từ chối đọc, mà cũng không có gì chuyển đổi tệp.

Sửa: nối vào `Main()` **trước** `ListenAndServe`. Thứ tự này bắt buộc — chạy sau thì có một
cửa sổ mà một `PUT` lọt vào sẽ ghi đè tệp v1 trước khi nó kịp được đọc để di trú, mất sạch
lịch cũ mà không có gì báo. Guard: `TestMigrateSchedulesIsWiredIntoStartup` đọc AST của
`main.go`, khoá cả sự tồn tại lẫn thứ tự. Đã kiểm test này **gãy** khi gỡ lời gọi ra.

### Kết quả sau khi sửa

```
INFO schedule.migrate 6 lịch đã chuyển từ định dạng cũ sang v3.1; bản cũ giữ tại
     schedule.conf.v1.bak. Mọi lịch đang ở DRAFT và đang tắt — hãy kiểm tra rồi publish lại.
INFO schedule.migrate SCH-010 là hàng not_active của định dạng cũ — đã chuyển thành lịch
     DRAFT đang tắt
INFO schedule.migrate 2 khoảng ngày lễ của định dạng cũ đã thành ngoại lệ event_priority=1
     trên 6 lịch; trước đây chúng tắt TOÀN BỘ hệ thống lịch, nay chỉ ghi đè từng lịch
INFO schedule.migrate LƯU Ý HÀNH VI: mô hình cũ nhả quyền điều khiển ngoài khoảng giờ, mô
     hình v3.1 giữ điểm ở giá trị mặc định suốt ngày. […] Mọi lịch đang TẮT nên chưa có gì
     thay đổi cho tới khi bạn bật.
```

Đối chiếu 100% trước/sau (8 hàng v1 → 6 Schedule Object, 2 hàng `holiday_period` thành ngoại lệ):

| Khẳng định | Kết quả |
|---|---|
| `enabled=false` + `status=DRAFT` + `migrated_from_v1=true` + `core_priority_level=4` trên **cả 6** | ĐẠT |
| Mỗi ngày có cấu hình sinh **đúng 2** mốc Time-Value, khớp `startTime`/`endTime`; ngày không cấu hình rỗng | ĐẠT |
| 2 khoảng ngày lễ → ngoại lệ `event_priority=1` trên **cả 6** lịch | ĐẠT |
| `value_type` suy đúng: BINARY×3, REAL×2, ENUMERATED×1; target giữ nguyên | ĐẠT |
| `.v1.bak` khớp **bit-với-bit** tệp gốc (1749 byte) | ĐẠT |
| Cảnh báo R-01-B có mặt trong log | ĐẠT |
| Chạy lại trên tệp đã v3.1 ⇒ **không** di trú lần hai | ĐẠT |

Công cụ đối chiếu của QĐ-8 chạy trên chính hiện vật `.v1.bak` lấy về từ bo:
`MKDDC_REAL_SCHEDULE_CONF=<tệp> go test -run TestMigrationAgainstRealBoardConfig` → PASS.

### Lỗi CHẶN 2 — hợp đồng đóng băng từ chối chính dữ liệu hợp lệ

Đem 6 lịch bo vừa sinh ra kiểm với `contracts/config/schedule_v3_1.schema.json`: **invalid**.

`$defs/ScheduleValue.value` dùng `oneOf` với đồng thời nhánh `{"type":"number"}` và
`{"type":"integer","minimum":0}`. Mọi số nguyên không âm khớp **cả hai**, mà `oneOf` đòi khớp
**đúng một** ⇒ hợp đồng loại sạch mọi lịch `ENUMERATED`/`UNSIGNED` và mọi lịch `REAL` có
setpoint tròn số (75, 0) — đúng những giá trị mà phần `description` của chính trường đó nói
là hợp lệ. Hỏng ở 3 chỗ: `ScheduleValue`, `TimeValue`, `ScheduleRuntimeState.effective_value`.

Lỗi này **không** làm hỏng build và **không** làm hỏng runtime: luật kiểu thật do
`scheduleValueMatchesType` trong Go giữ, nên hệ thống vẫn chạy đúng. Nó chỉ hiện ra khi có
người thật sự đem hợp đồng ra kiểm dữ liệu thật — và trong suốt P0→P4 **chưa từng có test nào
chạm tới tệp schema đó**. Đây là lý do gốc, không phải bản thân `oneOf`.

Sửa: `oneOf` → `anyOf`, bỏ nhánh `integer` thừa (ADR-023 errata E-1). Kiểm lại 6 lịch của bo:
**valid**. Guard mới: `TestScheduleSchemaOneOfBranchesAreDisjoint` (đã kiểm gãy trên schema cũ)
và `TestScheduleSchemaAcceptsEveryValueType` đối chứng hai chiều schema ↔ validator Go.

### Khôi phục — bo về đúng trạng thái ban đầu

Chỉ khôi phục các tệp thuộc lịch, **không** bung cả gói: gói còn chứa `historian-v2.sqlite`
và `fieldbus.journal` đã thay đổi từ lúc sao lưu, bung cả gói sẽ quay ngược trạng thái không
liên quan.

```
sha256 /data/config/schedule.conf = d146ea7e901ae925652f9e94b271dd25504b731ddfb89dff6b443806aeb0e023
  → khớp chính xác bản trước khi kiểm
schedule.d/ = SCH-001 + _deleted (audit giữ nguyên) · schedule.conf.v1.bak đã xoá
SCH-001 revision 4, status VALIDATED — đúng như người dùng để lại
mkddc-web-pi · mkddc-core · mkddc-iobus = active
Khởi động lại trên tệp v3.1: 0 dòng schedule.migrate — không di trú nhầm lần hai
```

### Số đo sau khi sửa cả 2 lỗi

`ctest` **849/849** · `vitest` **436/436** · Go **11/11 gói** · `go vet` sạch.

### Kiểm lại lần cuối trên binary đã merge — cách ly, không đụng `/data/config`

Bo nay chạy `mkddc-web` dựng từ commit merge `ee040f8` (`vcs.modified=false`), sha256
`0df97384…`. Lưu ý: **không so được sha256 giữa hai lần dựng** nếu cây làm việc khác trạng
thái — Go nhúng `vcs.revision` và `vcs.modified` vào binary, nên bản dựng lúc cây còn bẩn
khác bản dựng từ cây sạch dù mã nguồn y hệt. Muốn đối chiếu thì đọc
`go version -m <binary>`, đừng đối chiếu hash.

Để kiểm di trú trên **chính binary đang chạy** mà không đụng cấu hình thật, chạy nó trong hộp
cát: `CONFIG_DIR=/tmp/migsandbox PORT=18099 JWT_SECRET=<khoá dùng một lần>`. Không đọc và
không dùng khoá thật của bo.

```
2 lịch v1 → 2 Schedule Object · .v1.bak 424 byte
SCH-777  ENUMERATED  status=DRAFT  enabled=false  migrated_from_v1=true
SCH-778  REAL        status=DRAFT  enabled=false  migrated_from_v1=true
```

Hai hàng này cố ý chọn đúng hai ca mà MIG-02 từng làm hợp đồng từ chối: `ENUMERATED`, và
`REAL` có setpoint **tròn số** (75). Hộp cát đã xoá; `/data/config/schedule.conf` giữ nguyên
sha256 `d146ea7e…`.

Bẫy gặp phải khi dựng hộp cát, ghi lại cho lần sau: thiếu `JWT_SECRET` thì tiến trình thoát
ngay ở bước nạp cấu hình — **trước** điểm di trú — và log chỉ có đúng một dòng
`config: JWT_SECRET is required`. Nhìn thoáng qua rất giống "di trú không chạy", dễ chẩn
đoán nhầm thành một lỗi thứ hai.

---

## 7. Rollback nếu cần

```bash
systemctl stop mkddc-web-pi mkddc-core
cp -f /usr/sbin/mkddc-core.prev /usr/sbin/mkddc-core
cp -f /opt/mkddc-web/mkddc-web.prev /opt/mkddc-web/mkddc-web
rm -rf /opt/mkddc-web/dist && mv /opt/mkddc-web/dist.old /opt/mkddc-web/dist
rm -f /usr/sbin/mkddc-schedule-sim
systemctl start mkddc-core && systemctl start mkddc-web-pi
# đối chiếu: sha256sum phải khớp d7e94d7c… và ba72ee82…
```

Cấu hình đầy đủ nằm trong `/data/mkddc-backups/pre-scheduler-v31-20260807T094225Z.tar.gz`.
