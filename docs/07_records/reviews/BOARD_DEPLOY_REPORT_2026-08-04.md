# Báo cáo build và deploy lên board — 2026-08-04

**ID:** REVIEW-BOARD-DEPLOY-20260804
**Board:** `SOM-DDC-24` — Orange Pi 5B (`orangepi5b`), aarch64, Debian 12
**Commit:** `13fdc6045ec51c18e7fbe6cb0959e6800ff4bf62`
**Version:** 0.2.0

## 1. Trả lời câu hỏi: FW SOM và FAKE MCU đã build và deploy chưa?

**Rồi — cả hai đã build và đã deploy, chạy bằng bản mới.**

| Thành phần | Build | Deploy | Đang chạy |
|---|---|---|---|
| `mkddc-core` (FW SOM) | ✅ aarch64 | ✅ | ✅ pid 422651 |
| `mkddc-iobus` (FW SOM) | ✅ aarch64 | ✅ | ✅ pid 422645 |
| `mkddc-fake-mcu` | ✅ aarch64 | ✅ | ✅ pid 422637 |
| `mkddc-netcfg` | ✅ aarch64 | ✅ | ✅ pid 284670 |
| `mkddc-web` (Go) | ✅ aarch64 | ✅ | ✅ pid 422658 |
| `mkddc-hmi` | ✅ aarch64 | ✅ (file) | ⛔ tắt có chủ đích — board không có panel |
| `firmware.elf` (STM32) | ✅ ARM 32-bit | — | không áp dụng, board dùng fake MCU |

Nhưng **không phải chạy một phát là xong**. Quá trình lộ ra 5 lỗi, mô tả ở mục 3.
Trạng thái "đã deploy" ở trên là kết quả **sau khi** đã sửa.

## 2. Bằng chứng hệ thống đang chạy thật

```
iop.state HANDSHAKE -> NORMAL_POLL          ← link iobus ↔ fake MCU thông
output.set_do mask=0x0F value=0x0A ack=ok   ← lệnh DO được MCU xác nhận
output.set_ao raw=[0,0,0,0] ack=ok          ← lệnh AO được xác nhận
web_ipc.client_connected fd=5               ← core nhận IPC từ web
```

- SHM tạo lại lúc `2026-08-04 11:42`: `mkddc_io_shm`, `mkddc_plc_shm`.
- Web API nghe cổng **8081**, đang phục vụ client thật `192.168.1.45`:
  `GET /api/v1/system/status 200`, `/api/v1/alarms 200`, `/api/v1/network 200`.
- Provenance trên target:

```json
{ "version": "0.2.0",
  "git_commit": "13fdc6045ec51c18e7fbe6cb0959e6800ff4bf62",
  "dirty": false,
  "build_time": "2026-08-04T03:02:55Z" }
```

Cả 4 binary đều tự báo đúng commit này trong `/usr/share/mkddc/runtime-build-info.txt`.

## 3. Năm lỗi phát hiện và cách sửa

### L1 — Build firmware trượt: thiếu `nosys.specs`

```
arm-none-eabi-gcc: fatal error: cannot read spec file 'nosys.specs'
```

**Nguyên nhân:** lỗi thao tác của người thực hiện — cài `gcc-arm-none-eabi` kèm
`--no-install-recommends` nên thiếu gói `libnewlib-arm-none-eabi`.
**Sửa:** cài `libnewlib-arm-none-eabi`. Build lại `BUILD_OK`.
**Ảnh hưởng repo:** không. Đây là môi trường board, không phải lỗi source.

### L2 — `install.sh` không restart service, để nguyên code cũ đang chạy

Đây là lỗi nghiêm trọng nhất.

Sau khi `install.sh` báo thành công và `systemctl is-active` trả `active`, kiểm
tra tiến trình thật:

```
mkddc-core   pid 364084 -> /usr/sbin/mkddc-core  (deleted)
mkddc-iobus  pid 364599 -> /usr/sbin/mkddc-iobus (deleted)
```

PID **y hệt baseline trước khi cài**. File trên đĩa đã mới, nhưng tiến trình vẫn
giữ inode cũ đã bị xoá — tức vẫn chạy code cũ.

**Nguyên nhân gốc:** `install.sh` dùng `systemctl enable --now`, lệnh này chỉ
khởi động service nếu nó chưa chạy; service đang chạy thì không bị đụng tới.

**Vì sao nguy hiểm:** người vận hành thấy install thành công và service `active`
sẽ kết luận bản mới đang chạy. Đây đúng là false-success mà hồ sơ dự án cấm.

**Sửa trong phiên:** restart thủ công theo thứ tự fakemcu → iobus → core → web.
Sau restart: PID mới 422637/422645/422651/422658, `readlink /proc/<pid>/exe`
không còn `(deleted)`.

**Cần sửa trong repo:** `install.sh` phải `systemctl restart` (hoặc
`try-restart`) các unit sau khi ghi binary. Chưa sửa trong phiên này.

### L3 — `install.sh` không cài `fake_mcu`

Board lab chạy fake MCU bản 2026-07-30 (`sha 70e90e37487c`) trong khi iobus là
bản mới. `install.sh` không hề tham chiếu `fake_mcu`.

**Hậu quả:** lệch phiên bản giữa iobus và fake MCU trên chính board lab dùng để
nghiệm thu — trong khi hai bên nói cùng giao thức IOP.

**Sửa trong phiên:** cài tay `build/release/cpp/iobus/fake_mcu` →
`/usr/sbin/mkddc-fake-mcu` (`sha 59c3e5ef9230`), restart.

**Cần sửa trong repo:** thêm nhánh cài `fake_mcu` có điều kiện (chỉ lab/no-MCU)
vào `install.sh`, hoặc tách script riêng cho cấu hình lab. Chưa sửa.

### L4 — `install.sh` tự bật `mkddc-hmi`, gây vòng lặp restart

`mkddc-hmi` trước đó ở trạng thái `disabled`. `install.sh` bật nó lên vì
`build-release.sh` build với `MKDDC_ENABLE_HMI=ON`.

```
HMI DRM no connected connector
ERROR hmi.start drm_init_failed
mkddc-hmi.service: Scheduled restart job, restart counter is at 19
```

**Nguyên nhân gốc:** `install.sh` quyết định enable dựa trên "binary có tồn tại
không", chứ không dựa trên trạng thái enable trước đó hay khả năng phần cứng.

**Sửa trong phiên:** `systemctl disable --now mkddc-hmi`, trả về đúng trạng thái
ban đầu.

**Cần sửa trong repo:** `install.sh` phải giữ nguyên trạng thái enable/disable
sẵn có, hoặc có cờ tường minh. Chưa sửa.

### L5 — Test không cô lập khỏi service production

`ctest` native aarch64: **746/751**, 5 test hỏng, cùng một nguyên nhân:

```
ERROR plc_shm.attach_fail shm_open errno=13     (EACCES)
```

`/dev/shm/mkddc_plc_shm` thuộc `mkddc:mkddc` mode 644; test chạy dưới user
`orangepi` nên không mở được O_RDWR.

Danh sách hỏng: `BacnetObjTable.PublishesRtHealthSoDegradationIsObservable`,
`BacnetObjTable.DegradedRtIsVisibleInShm`,
`StIntegration.ScanLoopWithoutStSchedulerBehavesAsBefore`,
`StIntegration.ScanLoopRunsStProgramAndRoutesThroughArbitration`,
`StIntegration.ScanLoopStepDoesNotAllocateWithStProgram`.

**Đây không phải hồi quy aarch64.** Test dùng tên SHM cố định, trùng với SHM của
service production đang chạy trên cùng máy. Chạy bằng root thì 2 test BACnet
pass, 3 test ST vẫn hỏng — chưa lấy được chi tiết phần còn lại.

**Vì sao quan trọng:** ADR-022 dự tính chạy CI runner ngay trên board này. Với
thiết kế test hiện tại, 5 test đó sẽ đỏ mỗi khi service đang chạy.

**Cần sửa trong repo:** test phải dùng tên SHM riêng theo tiến trình/ngẫu nhiên,
hoặc chạy trong namespace riêng. Chưa sửa.

## 4. Ghi chú ABI

`mkddc_io_shm` đổi kích thước **1304 → 1816 bytes** giữa bản cũ và bản mới. Hai
bản không tương thích SHM, nên bắt buộc restart đồng bộ cả iobus và core; restart
lẻ một bên sẽ gây ABI mismatch.

## 5. Số đo trong phiên

| Hạng mục | Kết quả |
|---|---|
| `build-release.sh` native aarch64 | **BUILD_OK**, version 0.2.0, `dirty=false` |
| Artifact | 4 binary C++ + Go đều `ELF 64-bit ARM aarch64`; `firmware.elf` ARM 32-bit; dist 1.6M |
| Checksum | 5/5 ghi trong `build/release/checksums.sha256`; `install.sh` verify PASS |
| `ctest` native aarch64 | **746/751** (5 hỏng do L5), 14,70 s |
| Toolchain board | Go 1.26.5 · Node 24.15.0 + npm 11.12.1 · arm-none-eabi 12.2.1 + newlib |

## 6. Đính chính số liệu đã công bố

Báo cáo trước và các tài liệu commit ở PR #82 ghi binary target mốc
**2026-07-28**. Số đó **sai** — do đọc nhầm cột của `ls -la`. Đo lại bằng `stat`:

| Binary | Mốc đúng |
|---|---|
| `mkddc-core`, `mkddc-iobus`, `mkddc-netcfg`, `mkddc-hmi`, `mkddc-web` | 2026-08-01 15:24:05 |
| `mkddc-fake-mcu` | 2026-07-30 19:38:14 |

Kết luận không đổi: bản deploy cũ vẫn có trước restructure (merge 2026-08-03),
nên vẫn đúng là target chưa từng chạy cây `apps/`.

## 7. Trạng thái `RST-202`

| Tiêu chí | Trạng thái |
|---|---|
| `TARGET_INSTALL` | **PASS** — checksum verify OK, binary về đúng path, service chạy bản mới |
| `TARGET_PROVENANCE` | **PASS** — truy được binary về commit `13fdc60`, `dirty=false` |
| `TARGET_STARTUP_ORDER` | **NOT_RUN** — chưa reboot thật |
| `TARGET_CRASH_RESTART` | **NOT_RUN** |
| `TARGET_ROLLBACK` | **NOT_RUN** |

`RST-202` **chưa đóng được**. Ba tiêu chí còn lại cần cửa sổ reboot board.

Ngoài ra ba lỗi L2, L3, L4 là khiếm khuyết của `install.sh` và phải được sửa
trong repo trước khi coi quy trình install là đạt — hiện mới chỉ được vá tay
trên board.
