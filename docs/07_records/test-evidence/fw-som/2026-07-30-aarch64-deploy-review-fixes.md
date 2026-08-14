# Evidence — Deploy bản sửa review 2026-07-30 lên Orange Pi 5B (aarch64)

> **Ngày:** 2026-07-30
> **Target:** Orange Pi 5B, `Linux 6.1.43-rockchip-rk3588 aarch64`, 8 core, 8 GB RAM, Debian Bookworm
> **Source:** nhánh `fix/review-2026-07-30-fe-be-fwsom`, commit `87a0ff0`
> **Nội dung deploy:** toàn bộ 23 finding của review code 2026-07-30; record gốc
> đã bị thay thế và phục hồi được tại commit `b69fdf1`.
> **Chế độ board:** lab / no-MCU (`mkddc-fakemcu` + `mkddc-pty` active) — **không có tải thực**
> **Runbook tham chiếu:** `2026-07-28-aarch64-build-deploy.md` §4.1 và bài học §4.2

---

## 1. Điều kiện board trước khi deploy

| Hạng mục | Trạng thái |
|---|---|
| Service đang chạy | `mkddc-core`, `mkddc-iobus`, `mkddc-netcfg`, `mkddc-web-pi`, `mkddc-fakemcu`, `mkddc-pty`, `mkddc-time-helper` |
| `mkddc-hmi` | `inactive` + **`disabled`** (board không gắn màn hình) |
| Phụ thuộc build C++ | **đủ hết**: `libmodbus-dev 3.1.6`, `libdrm-dev 2.4.114`, `libfreetype-dev 2.12.1`, `libsodium-dev 1.0.18`, `libgtest/gmock-dev 1.12.1`, `cmake 3.25.1`, `ninja 1.11.1`, `pkg-config` |
| Go toolchain | **KHÔNG có** → BE phải cross-compile |
| Node toolchain | **KHÔNG có** → FE phải build ở host |
| Đĩa | 12 G trống trên `/` |

`/opt/mkddc-web/mkddc-web` cũ là `ELF aarch64, statically linked, Go, stripped`,
`not a dynamic executable` → **CGO tắt**, nên cross-compile từ x86-64 cho ra
binary tương đương.

## 2. Chuẩn bị artifact

```bash
# Host: BE arm64 (CGO tắt, khớp cách binary cũ được build)
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -ldflags="-s -w" -o mkddc-web ./...
# → ELF aarch64, statically linked, stripped — md5 0a44c32c862b83be79f117c5e60273ab

# Host: FE dist
npm run build   # → dist/, đóng gói dist.tgz 802 285 byte

# Board: source giữ ĐÚNG cây thư mục (services/ tham chiếu ../../shared, ../../tools)
~/mkddc-deploy-20260730/{services,shared,tools}
```

Xác nhận bản sửa có mặt trên board trước khi build (5 điểm neo):
`iop_client.cpp` POLLHUP=1, `device_profile.cpp` `ext_slots_for_profile`=1,
`shm_reader.cpp` reset fail-safe=1, `netcfg.cpp` `kMaxOutput`=3,
`mkddc_shm.h` HỢP ĐỒNG READER=1.

## 3. Build native aarch64 — lần đầu bật đủ 3 option

```bash
cmake -S services -B build -DCMAKE_BUILD_TYPE=RelWithDebInfo \
  -DCMAKE_CXX_FLAGS="-Wall -Wextra -Werror" \
  -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON
nice -n 10 cmake --build build --parallel 6
```

| Hạng mục | Kết quả |
|---|---|
| Configure | exit 0 |
| Build | **exit 0, 0 lỗi** với `-Werror` |
| Cảnh báo | **1** — `h_cov.c:392 -Warray-bounds`, thuộc **bacnet-stack vendored**, không phải code dự án |
| `mkddc-core` | 14 579 912 byte, `ELF 64-bit LSB pie executable, ARM aarch64` |
| `mkddc-iobus` | 6 755 144 byte |
| `mkddc-netcfg` | 7 823 856 byte |
| `mkddc-hmi` | 13 753 872 byte — **lần đầu `mkddc-hmi` được build trên aarch64 với LVGL/libdrm/freetype thật** |

Đây là lần đầu board build với `MKDDC_ENABLE_HMI=ON`; LVGL v9.1 + freetype +
libdrm compile sạch trên aarch64, không cần patch nào.

> Cảnh báo khác nhau giữa hai kiến trúc: x86-64/GCC 13 cho **2** cảnh báo
> `-Wstringop-overflow` (test-only, `test_output_command.cpp:34`); aarch64/GCC 12
> cho **1** cảnh báo `-Warray-bounds` trong bacnet-stack. Không cái nào thuộc code
> dự án, và target production giữ nguyên `-Werror`.

## 4. Test trên aarch64 — 729/729 PASS

Theo bài học runbook §3.2: **dừng service trước, dọn SHM sau**.

```bash
sudo systemctl stop mkddc-web-pi mkddc-core mkddc-iobus
sudo rm -f /dev/shm/mkddc_*
ctest --test-dir build --output-on-failure     # → 100% tests passed, 0 failed out of 729 (14,64 s)
sudo rm -f /dev/shm/mkddc_*                    # dọn SHM do test để lại (§4.2)
```

**729/729 khớp CHÍNH XÁC con số x86-64.** Không có test nào lệch theo kiến trúc —
kể cả 27 test mới của loạt sửa này và 28 test HMI.

## 5. Deploy

Script `tools/…/deploy_board.sh` (chạy một lần, có kiểm md5 sau khi cài):

```
1. Backup  → /usr/sbin/mkddc-backup-20260730-193812/
             {mkddc-core, mkddc-iobus, mkddc-netcfg, mkddc-hmi, mkddc-fake-mcu, mkddc-web, dist}
             stamp → /root/mkddc-last-backup-stamp
2. Stop    → mkddc-web-pi, mkddc-core, mkddc-iobus, mkddc-netcfg
3. rm -f /dev/shm/mkddc_*        ← bài học §4.2, LUÔN làm, bất kể có chạy test hay không
4. Cài     → 5 binary C++ + mkddc-web (arm64) + dist/
5. Start   → netcfg → iobus → (3 s) → core → (3 s) → web-pi
```

### md5 trước / sau

| Artifact | md5 CŨ | md5 MỚI |
|---|---|---|
| `/usr/sbin/mkddc-core` | `9f5252cb711e736e1dff8720d4dc101d` | `f8a1a47cc4b9205f2ec5086806354572` |
| `/usr/sbin/mkddc-iobus` | `d6c01a3195f2e125229ae1e5d1bab32d` | `cbd21463386e8cb9ab2e45326f338ed9` |
| `/usr/sbin/mkddc-netcfg` | `4915ca218dc2abe4dc357738f7acb988` | `94cdce272c835ce92368af5900c7f5b5` |
| `/usr/sbin/mkddc-hmi` | `bf56c62341efa09db941dba27f7d76bf` | `e007a225f6d8815c9bc3cad0fa536713` |
| `/opt/mkddc-web/mkddc-web` | `c393eea014f5c60b22f080d61f30e10e` | `0a44c32c862b83be79f117c5e60273ab` |

md5 của mọi binary đã cài **khớp đúng** md5 trong `build/` (và với artifact
cross-compile ở host cho `mkddc-web`). SHM sau khởi động thuộc đúng
`mkddc:mkddc` — không lặp lại sự cố §4.2 của lần deploy trước.

### 5.1 Phát hiện khi so binary: bản cũ KHÔNG có Modbus

```
mkddc-iobus CŨ : modbus_master.open = 0 chuỗi , bacnet = 11 chuỗi
mkddc-iobus MỚI: modbus_master.open = 1 chuỗi , bacnet = 17 chuỗi
```

Bản đang chạy trước đây build **không** có `MKDDC_ENABLE_MODBUS` (BACnet thì đã
có). Bản mới có cả hai, nên về nguyên tắc đây là **thay đổi hành vi ngoài phạm vi
fix** và phải kiểm.

**Kết luận sau khi kiểm: không có thay đổi hành vi runtime.**
`/data/config/fieldbus.conf` không tồn tại → `fieldbus_config.file_missing
(defaults)` → `cfg.slaves` rỗng → `main.cpp` chỉ gọi `modbus.open()` khi
`!fieldbus_cfg.slaves.empty()`, nên `ModbusMaster::open()` **không được gọi**.
Log không có dòng `modbus_master.*` nào; không có thread fieldbus.

**Hệ quả cần nêu rõ:** vì board không cấu hình slave Modbus nào, **cụm sửa WP2
(F-08/F-16/F-17/F-18/F-21) KHÔNG được thực thi ở runtime trên board này** — nó
chỉ được bảo đảm bởi 729 unit test (trong đó có test PTY/loopback thật cho cả RTU
và TCP). Muốn kiểm runtime thì phải cấp `fieldbus.conf` với slave thật hoặc
`diagslave`.

## 6. Vận hành sau deploy

| Hạng mục | Kết quả |
|---|---|
| `mkddc-iobus` / `mkddc-core` / `mkddc-web-pi` / `mkddc-netcfg` | **active**, `NRestarts=0` cả bốn |
| `core.start` → `graph.loaded nodes=13 scan_ms=1000` → `plc_shm.attached size=9280` → `core.ready` | đúng chuỗi |
| IOP handshake | `mcu_iop=2.0 mcu_fw=2.0 status=ok board_cap=0x000D` |
| Output tới MCU | `output.set_do mask=… ack=ok` vẫn hoạt động |
| `scan_count` | tăng **+1/s chính xác** (919→920→921→922; sau các thử nghiệm 1159→1160→1161) |
| `scan_overrun` | **0** |
| BACnet | `bacnet_server.started bound UDP/47808`, listener trên `192.168.1.18:47808` + broadcast |
| Web API | `/login` → 200, `/` → 200; client thật `192.168.1.45` poll `/api/v1/alarms` và `/api/v1/system/status` → **200** |
| ERROR mới | **không có** ngoài hai lỗi đã biết từ trước (xem §8) |

### 6.1 Jitter — không xấu đi

`mkddc-core` tự log jitter mỗi phút:

```
core.jitter min_us=73.85 max_us=247.55 avg_us=129.85 overruns=0 count=61
core.jitter min_us=74.55 max_us=267.19 avg_us=149.12 overruns=0 count=60
core.jitter min_us=67.34 max_us=358.17 avg_us=166.04 overruns=0 count=60
core.jitter min_us=74.38 max_us=275.24 avg_us=174.18 overruns=0 count=61
core.jitter min_us=64.03 max_us=257.50 avg_us=140.81 overruns=0 count=61
```

| | min | max | avg | overruns |
|---|---|---|---|---|
| Baseline 2026-07-28 | 63–75 µs | 250–294 µs | 112–161 µs | 0 |
| **Sau deploy này** | **64–74 µs** | **247–358 µs** | **130–174 µs** | **0** |

Cùng dải. `max=358 µs` ở một mẫu cao hơn mốc 294 µs nhưng vẫn trong họ số của bản
trước-Program-Runtime (284–356 µs) và **0 overrun** ở mọi mẫu. Loạt sửa này
**không làm xấu** đặc tính thời gian thực.

## 7. Tái hiện finding trên board thật

### 7.1 F-02 — BE đọc SHM bằng mmap + seqlock (bằng chứng trực tiếp)

`/proc/<mkddc-web pid>/maps`:

```
7f4921e000-7f4921f000 r--s 00000000 00:1a 21   /dev/shm/mkddc_io_shm
7f4921f000-7f49222000 r--s 00000000 00:1a 22   /dev/shm/mkddc_plc_shm
```

Cả hai segment được **mmap `r--s`** (read-only, shared) trong tiến trình web đang
phục vụ production. Đây là bằng chứng đường `shm_reader.go` mới đang chạy thật,
thay cho `os.ReadFile`. Trước bản sửa, `/proc/*/maps` sẽ **không** có hai dòng này.

### 7.2 F-03 — annunciation an toàn của HMI, trên SHM SỐNG của board

Probe chạy đúng đường `ShmReader::attach()` (shm_open + mmap thật) +
`io_fault_active()`, **một tiến trình duy nhất tái dùng `DataCache`** xuyên qua sự
cố — đúng cấu trúc `main.cpp` của HMI.

```
chu_ky=0..3   io_ok=1 io_valid=1 iop_status=0  =>  io_fault=false  banner=xanh  E001=im lặng
>>> t=1,5 s: xoá magic (mô phỏng cửa sổ iobus đang tạo lại SHM)
chu_ky=4..10  io_ok=0 io_valid=0 iop_status=1  =>  io_fault=TRUE   banner=ĐỎ    E001=KÍCH
>>> t=4,0 s: phục hồi magic
chu_ky=11..15 io_ok=1 io_valid=1 iop_status=0  =>  io_fault=false  banner=xanh  E001=im lặng
```

**Cả đường fail-safe lẫn đường phục hồi đều đúng trên aarch64 với SHM thật.**
Magic được phục hồi nguyên trạng (`0444584b`), 4 service giữ `NRestarts=0`.

**Phát hiện phụ đáng ghi:** thử `systemctl restart mkddc-iobus` **KHÔNG** tái hiện
được F-03. Lý do: `mkddc-iobus` **không `shm_unlink`** khi restart — nó attach lại
segment cũ, magic vẫn hợp lệ suốt quá trình. Nên cửa sổ F-03 chỉ xuất hiện khi
segment thực sự được tạo mới (boot đầu, hoặc sau `rm -f /dev/shm/mkddc_*`), không
phải ở mọi lần restart service. Điều này **làm hẹp** xác suất thực tế của F-03 so
với mô tả "iobus crash và restart" trong báo cáo review, nhưng không làm nó biến
mất — và bản sửa vẫn cần thiết vì trạng thái đó có thật.

### 7.3 F-05 — UART hangup, đo trên aarch64

Peer PTY đóng **sau khi** request đã được ghi; đo CPU-time so với wall-time của
một lần `get_io` với `response_timeout_ms=500`:

```
code=5  wall=0.2ms  cpu=0.1ms
code=5  wall=0.2ms  cpu=0.1ms
code=5  wall=0.2ms  cpu=0.0ms
ERROR iop.port_eof — peer đóng, reconnect
```

`code=5` = `NOT_OPEN` (đã sửa) thay vì `code=1` = `TIMEOUT` (hành vi cũ), và log
đi qua đúng nhánh `iop.port_eof` mới. Đối chiếu số đo x86-64 trên code cũ:
`wall=500 ms, cpu=500 ms` → **100 % busy-spin một core**. Trên aarch64 hành vi đã
sửa cho `0,2 ms / ~0,1 ms`.

### 7.4 Sự cố gặp phải khi tái hiện — và nguyên nhân

Lần đầu ghi vào SHM để tái hiện F-03 bị chặn:

```
dd: failed to open '/dev/shm/mkddc_io_shm': Permission denied
```

**Không phải lỗi quyền thông thường** — `sudo id` cho `uid=0(root)`, root ghi
`/tmp` được, và `python3 open("r+b")` trên **chính file đó** thành công.

Chẩn đoán, đã chứng minh bằng thí nghiệm tối thiểu:

```
fs.protected_regular = 2
/dev/shm mode        = drwxrwxrwt   (sticky, world-writable)
file owner           = mkddc:mkddc

O_RDWR               OK
O_WRONLY|O_CREAT     FAIL Permission denied
```

`fs.protected_regular=2` chặn mở kèm **`O_CREAT`** một regular file thuộc user
khác trong thư mục sticky world-writable — **kể cả với root**. `dd of=…` luôn
truyền `O_CREAT`; `python open("r+b")` thì không.

**Đưa vào quy trình:** mọi công cụ vận hành cần ghi trực tiếp `/dev/shm/mkddc_*`
(harness tái hiện, script debug) **không được dùng `dd of=`**. Dùng `python3
open(path,"r+b")` hoặc bất cứ đường mở `O_RDWR` không kèm `O_CREAT`.

## 8. Lỗi đã có TRƯỚC deploy — không do loạt sửa này

Ghi lại để không bị quy oan cho bản deploy:

| Log | Bản chất |
|---|---|
| `ERROR rt.degraded policy=0 prio=0 mlock=1 (mong đợi SCHED_FIFO=1 prio=80)` + `WARN rt.sched_fifo_fail` | Kernel thiếu `RT_GROUP_SCHED=n` — **finding F-13** đã biết, là next action P0 riêng. Quan sát được ở cả bản cũ. |
| `ERROR state_snapshot.save: cannot open /data/mkddc/state.snap.tmp` | Đã xuất hiện với pid CŨ (997573) **trước** deploy lúc 19:37:32. Thiếu thư mục/quyền `/data/mkddc`. |
| `WARN config.default field=uart_device`, `fieldbus_config.file_missing`, `bacnet_config.bacnet_conf_missing` | Cấu hình lab thiếu file → dùng default. Bình thường ở chế độ no-MCU. |
| `WARN priority.conflict do ch=… (nguồn sau thắng)` | Hành vi bình thường của graph demo đang toggle DO. |

## 9. Giới hạn của lần deploy này

- **WP2 (Modbus) không được thực thi runtime** — board không có `fieldbus.conf`
  với slave nào (§5.1). Chỉ có unit test bảo đảm.
- **F-01 / F-04 / F-07 / F-10 không kiểm được qua API sống** — không có credential
  test trên board và tôi **không** tìm cách lấy/đoán mật khẩu. Bốn finding này
  được bảo đảm bởi 363 test Go + 140 test FE chạy ở host trên **cùng source** đã
  cross-compile.
- **F-11 là no-op trên board này** — `CORS_ORIGIN` không được đặt, nên
  `wsOriginPatterns` trả nhánh loopback y như trước. Bản sửa chỉ đổi hành vi khi
  `CORS_ORIGIN` **có** được cấu hình (triển khai production thật).
- **`mkddc-hmi` được build và test nhưng KHÔNG được enable** — board không gắn màn
  hình, service vẫn `disabled` như trước. Binary đã cài để lần sau gắn màn hình là
  dùng được ngay.
- **F-19 / F-20** (`rotate-web-jwt-secret.sh`) **chưa chạy trên board** — nó luân
  chuyển JWT_SECRET production và làm vô hiệu mọi session đang hoạt động. Đã kiểm
  bằng harness hermetic `tools/test_rotate_jwt_secret.sh` (17/17). Chạy trên board
  là một thao tác vận hành riêng, cần cửa sổ bảo trì.
- Chưa đo soak dài (24 h), chưa chạy TSan trên board.

## 10. Rollback nếu cần

```bash
STAMP=$(sudo cat /root/mkddc-last-backup-stamp)     # = 20260730-193812
sudo systemctl stop mkddc-web-pi mkddc-core mkddc-iobus mkddc-netcfg
sudo rm -f /dev/shm/mkddc_*
for b in mkddc-core mkddc-iobus mkddc-netcfg mkddc-hmi mkddc-fake-mcu; do
  sudo cp -a /usr/sbin/mkddc-backup-$STAMP/$b /usr/sbin/$b
done
sudo cp -a /usr/sbin/mkddc-backup-$STAMP/mkddc-web /opt/mkddc-web/mkddc-web
sudo rm -rf /opt/mkddc-web/dist && sudo cp -a /usr/sbin/mkddc-backup-$STAMP/dist /opt/mkddc-web/dist
sudo chown -R mkddc:mkddc /opt/mkddc-web/dist
sudo systemctl start mkddc-netcfg mkddc-iobus && sleep 3 && sudo systemctl start mkddc-core mkddc-web-pi
```

## 11. Kết luận

Deploy **thành công, không cần rollback**. Toàn bộ 23 finding đã lên board;
729/729 test pass trên aarch64 (khớp x86-64); F-02, F-03 và F-05 được tái hiện và
xác nhận trên **board thật** với SHM sống; jitter không xấu đi; `NRestarts=0` cả
bốn service; không có ERROR mới.

Hai kết quả có giá trị ngoài phạm vi fix:
1. `mkddc-hmi` build sạch trên aarch64 với LVGL/libdrm/freetype thật — lần đầu.
2. `fs.protected_regular=2` chặn `dd of=/dev/shm/…` kể cả với root — cần đưa vào
   mọi runbook có thao tác ghi trực tiếp SHM.
