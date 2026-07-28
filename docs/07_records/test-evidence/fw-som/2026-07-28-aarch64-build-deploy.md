# Evidence — Build native aarch64 và deploy lên Orange Pi 5B

> **Ngày:** 2026-07-28
> **Target:** Orange Pi 5B, `Linux 6.1.43-rockchip-rk3588 aarch64`, 8 core, 8 GB RAM
> **Source:** commit `5c39c61` (nhánh `feat/fw-som-typed-ir`)
> **Người thực hiện:** PM kỹ thuật

---

## 1. Chuẩn bị

Board thiếu **duy nhất** `libsodium-dev` (chỉ có runtime `libsodium23`). Cài
qua apt — không ảnh hưởng service đang chạy:

```
libsodium-dev:arm64 1.0.18-1+deb12u1   → /usr/include/sodium.h
```

Đồng bộ `services/`, `shared/`, `tools/` sang `~/mkddc-build/`. Lưu ý cấu trúc:
`services/CMakeLists.txt` tham chiếu `../../shared` và `../../tools`, nên phải
giữ đúng cây thư mục — gộp phẳng sẽ hỏng configure.

## 2. Build

```bash
cmake -S services -B build -DCMAKE_BUILD_TYPE=RelWithDebInfo \
  -DCMAKE_CXX_FLAGS="-Wall -Wextra -Werror"
cmake --build build --parallel 6
```

| Hạng mục | Kết quả |
|---|---|
| Configure | exit 0 |
| Build | exit 0, **0 lỗi** với `-Werror` |
| `mkddc-core` | 14 579 368 byte, `ELF 64-bit LSB pie executable, ARM aarch64` |
| `mkddc-iobus` | 2 968 656 byte |
| `mkddc-st-compile` | 9 430 480 byte |
| `mkddc-st-validate` | 4 659 128 byte |

Build native mất khoảng 12 phút với `--parallel 6` (giữ 2 core cho service
đang chạy).

## 3. Test trên aarch64

### 3.1 Lần chạy đầu — 641/646, 5 fail

```
BacnetObjTable.PublishesRtHealthSoDegradationIsObservable
BacnetObjTable.DegradedRtIsVisibleInShm
StIntegration.ScanLoopWithoutStSchedulerBehavesAsBefore
StIntegration.ScanLoopRunsStProgramAndRoutesThroughArbitration
StIntegration.ScanLoopStepDoesNotAllocateWithStProgram
```

**Chẩn đoán (không phải lỗi code, không phải lỗi aarch64):**

Cả 5 test đều gọi `BacnetObjTable::attach()` → `/dev/shm/mkddc_plc_shm`. Trên
board, **`mkddc-core` production đang chạy và sở hữu chính SHM đó**.

Hai bước loại trừ:

1. Chạy với quyền user thường → `shm_open errno=13` (EACCES): SHM thuộc user
   `mkddc`, test chạy dưới `orangepi`.
2. Chạy lại **với `sudo`** → vẫn fail 5. Nên **không phải vấn đề quyền**:
   test gắn vào SHM sống đang bị service ghi đè mỗi giây, assertion bị phá.

### 3.2 Lần chạy sau khi dừng service — **646/646 PASS**

```
100% tests passed, 0 tests failed out of 646
```

Xác nhận chẩn đoán: 5 fail hoàn toàn do **thiếu cách ly test khỏi instance
production**, không phải khác biệt kiến trúc.

> **Bài học vận hành:** không chạy `ctest` trên board đang chạy service. Nếu
> buộc phải chạy, dừng service trước và **dọn SHM sau** (xem §4.2).

## 4. Deploy

### 4.1 Quy trình đã thực hiện

```
1. Backup  → /usr/sbin/mkddc-backup-20260728-153824/{mkddc-core,mkddc-iobus}
             md5 cũ: mkddc-core  f69aab790f1be32fb8509ec18a5de92a
                     mkddc-iobus a943598b7e6b8ca82d9c204a55cb223a
             stamp lưu tại /root/mkddc-last-backup-stamp
2. Stop    → mkddc-core, mkddc-iobus   (MCU tự ép AO/DO safe sau 200 ms)
3. Xoá SHM cũ
4. Cài     → 4 binary vào /usr/sbin
5. Unit    → WatchdogSec 3 → 6 (backup unit cũ kèm timestamp)
6. Start   → iobus trước, core sau
```

### 4.2 Sự cố khi khởi động lần đầu — và nguyên nhân

`mkddc-core` **fail** ngay lần start đầu:

```
ERROR plc_shm.attach_fail shm_open errno=13
```

**Nguyên nhân: lỗi quy trình của chính lần deploy này.** Lần chạy `ctest` ở
§3.2 tạo `/dev/shm/mkddc_plc_shm` thuộc user **`orangepi`** mode `0644`. Service
chạy dưới user `mkddc` nên chỉ có quyền "other" = read-only → không mở được
`O_RDWR`.

```
-rw-r--r-- 1 orangepi orangepi 9280 /dev/shm/mkddc_plc_shm   ← do ctest để lại
```

**Khắc phục:** dừng service, `rm -f /dev/shm/mkddc_*`, khởi động lại. Sau đó
SHM được tạo đúng chủ:

```
-rw-r--r-- 1 mkddc mkddc  528 /dev/shm/mkddc_io_shm
-rw-r--r-- 1 mkddc mkddc 9280 /dev/shm/mkddc_plc_shm
```

**Đưa vào quy trình deploy chuẩn:** luôn `rm -f /dev/shm/mkddc_*` **sau khi
dừng service và trước khi khởi động lại**, bất kể có chạy test hay không.

### 4.3 Xác nhận sau deploy

```
md5 /usr/sbin/mkddc-core            = d74e8f411e8f76fa79e2ac0df31d35f5
md5 build/core/mkddc-core           = d74e8f411e8f76fa79e2ac0df31d35f5   ✔ khớp

INFO  core.start version=1.0.0
INFO  graph.loaded nodes=13 scan_ms=1000 ai=2
INFO  plc_shm.attached size=9280
INFO  core.ready first scan done
```

## 5. Kết quả vận hành sau deploy

| Hạng mục | Kết quả |
|---|---|
| `mkddc-core` / `mkddc-iobus` | **active** |
| Theo dõi 3 phút | `NRestarts` 17 → 17 — **ổn định**, không restart oan |
| `scan_count` | tăng đều (250 → 253 trong 3 s, đúng chu kỳ 1 s) |
| Jitter chu kỳ 1 s | min 63–75 µs, **max 250–294 µs**, avg 112–161 µs, **0 overrun** |
| Output tới MCU | `output.set_do ... ack=ok` vẫn hoạt động |
| Script integration BE trên aarch64 | **18/18 pass** |

Jitter của bản mới **tương đương bản cũ** (bản cũ: max 284–356 µs). Việc thêm
Program Runtime **không làm xấu** đặc tính thời gian — đúng như test
`ScanLoopStepDoesNotAllocateWithStProgram` dự đoán.

## 6. RT health metric hoạt động đúng thiết kế

Đọc trực tiếp từ `/dev/shm/mkddc_plc_shm`:

```
magic       = 0x4B584404
scan_count  = 20
rt_policy   = 0     (0 = SCHED_OTHER, 1 = SCHED_FIFO)
rt_prio     = 0
rt_mlock    = 1
rt_degraded = 1     ← suy giảm hiển thị đúng
```

Và log ở mức `ERROR` như thiết kế:

```
ERROR rt.degraded policy=0 prio=0 mlock=1 (mong đợi SCHED_FIFO=1 prio=80)
      — jitter KHÔNG được bảo đảm
```

Đây là lần đầu tình trạng `F-13` **quan sát được từ metric** thay vì nằm im
trong một dòng log lúc khởi động. BE/Web đọc `rt_degraded` là thấy ngay.

**Lưu ý ABI:** `sizeof(kx_plc_shm_t)` vẫn **9280 byte** — bốn field RT health
lọt vừa vào padding đuôi sẵn có (offset 9276–9279). ABI **không đổi chút nào**,
nên binary Go cũ đọc SHM mới vẫn đúng tuyệt đối, không cần redeploy đồng bộ.

## 7. Build tất định giữa hai kiến trúc — kiểm lần đầu

Compile cùng một source trên hai máy khác kiến trúc:

| Máy | md5 artifact | SHA-256 (đầu) | Kích thước |
|---|---|---|---|
| x86_64 (host dev) | `79438ca91be784444b158104a8fd3f42` | `iti4yX2MFUozKezd…` | 1 760 |
| aarch64 (Orange Pi 5B) | `79438ca91be784444b158104a8fd3f42` | `iti4yX2MFUozKezd…` | 1 760 |

**Giống hệt từng byte.** Thuộc tính này chưa từng được kiểm trước đây và có giá
trị trực tiếp với BE: **compile trên server x86_64 cho ra artifact bit-identical
với compile trên target**, nên BE không cần build farm ARM và có thể so hash để
xác minh gói.

Đạt được nhờ serialize little-endian tường minh trong `st_ir.cpp` thay vì
`memcpy` struct.

## 8. Rollback nếu cần

```bash
STAMP=$(sudo cat /root/mkddc-last-backup-stamp)
sudo systemctl stop mkddc-core mkddc-iobus
sudo cp -a /usr/sbin/mkddc-backup-$STAMP/mkddc-core  /usr/sbin/mkddc-core
sudo cp -a /usr/sbin/mkddc-backup-$STAMP/mkddc-iobus /usr/sbin/mkddc-iobus
sudo rm -f /dev/shm/mkddc_*
sudo systemctl start mkddc-iobus && sleep 3 && sudo systemctl start mkddc-core
```

Unit file cũ: `/etc/systemd/system/mkddc-core.service.bak-<timestamp>`.

## 9. Điều vẫn KHÔNG đóng được sau deploy

| # | Việc | Vì sao deploy không giải quyết được |
|---|---|---|
| 1 | `WATCHDOG_GATE` định lượng | Cần `SCHED_FIFO`; chặn bởi `CONFIG_RT_GROUP_SCHED` + cgroup v2 ở tầng **kernel**. Thay binary không sửa được |
| 2 | Đo WCET/jitter hợp lệ (`V-04`) | Cùng lý do — số hiện tại đo trên hệ không có RT |
| 3 | HIL với STM32 thật (`V-06`) | Không có phần cứng; DEFERRED theo quyết định |
| 4 | Soak 24 giờ | Cần 24 giờ đồng hồ thực |
| 5 | ASan/UBSan/fuzzing | Phase 7, chưa chạy |

Ba việc đầu **không thuộc phạm vi FW SOM**. Việc 4–5 làm được nhưng chưa làm.

---

**Kết luận:** build native aarch64 và deploy **thành công**, hệ vận hành ổn
định với binary mới, RT health metric hoạt động đúng thiết kế, và build tất
định giữa hai kiến trúc được kiểm chứng lần đầu. Hai sự cố gặp phải (test bám
SHM production, SHM sai chủ sở hữu) đều là **lỗi quy trình đã ghi lại thành
quy tắc**, không phải lỗi sản phẩm.
