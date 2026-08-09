# 06 — Firmware SOM (`apps/core`, `apps/iobus`)

Commit `8754a8e` · đo 2026-08-09

Phạm vi "FW SOM" = `apps/core` + `apps/iobus`. Hai dịch vụ SOM khác
(`apps/netcfg`, `apps/hmi`) báo cáo ở §7 vì chúng chạy trên SOM nhưng không nằm
trên đường điều khiển. `firmware/stm32` (MCU) ngoài phạm vi, chỉ nêu ở §8.

## 1. Tóm tắt

C++17, biên dịch với `-Wall -Wextra -Werror`. 25.426 dòng nguồn, 17.032 dòng test,
762 test (487 core + 275 iobus) — tất cả pass.

Đây là phần chất lượng cao nhất dự án. Điểm phân biệt không nằm ở chỗ mã "sạch"
mà ở chỗ **các bất biến quan trọng được biến thành thứ máy kiểm được** thay vì
dựa vào kỷ luật lập trình: biên tầng ép lúc link, bất biến không cấp phát đo bằng
bộ đếm, ranh giới compiler/runtime kiểm bằng bảng ký hiệu trong CI.

Điểm trừ duy nhất đáng kể: engine ST 6.606 dòng nằm trong `core_application`
nhưng không tiến trình nào gọi (xem [02](02_TINH_NANG_PROGRAMMING_THEO_SRC.md)).

## 2. Phân chia tiến trình

| Tiến trình | Vai trò | Nguồn | Test | Test chạy |
|---|---|---:|---:|---:|
| `mkddc-core` | Vòng scan điều khiển, graph runtime, lịch, cảnh báo, an toàn, bảng object BACnet | 14.871 | 11.571 | 487 |
| `mkddc-iobus` | Giao thức IOP tới MCU, Modbus RTU/TCP master, máy chủ BACnet/IP, tỉ lệ hoá I/O | 10.555 | 5.461 | 275 |

Ranh giới: `iobus` sở hữu toàn bộ I/O và giao thức hiện trường; `core` sở hữu
logic điều khiển và an toàn. Hai bên trao đổi qua bộ nhớ chia sẻ.

## 3. Hợp đồng bộ nhớ chia sẻ

[contracts/shm/mkddc_shm.h](../../../contracts/shm/mkddc_shm.h) — một tệp header
C dùng chung cho C++ (cả hai tiến trình) và Go (qua `shm_reader.go`), nên không
bên nào khai lại bố trí.

| Hằng | Giá trị |
|---|---:|
| `KX_N_UI` (vào phổ dụng analog) | 16 |
| `KX_N_DI` | 8 (SKU tuỳ chọn) |
| `KX_N_AO` / `KX_N_DO` | 4 / 4 |
| `KX_N_AV` / `KX_N_BV` / `KX_N_MSV` | 32 / 16 / 8 |
| `KX_N_EXT` (điểm thiết bị phụ) | 256 |
| `KX_N_FB_SLAVE` / `KX_N_FB_BUS` | 32 / 4 |

Magic `0x4B584405` mã hoá phiên bản ("KXD\5"), nên hai phía lệch phiên bản sẽ bị
phát hiện lúc attach chứ không diễn giải sai byte trong im lặng.

Chất lượng dữ liệu ba mức (`GOOD`/`UNCERTAIN`/`BAD`) đi kèm điểm, cộng
`kx_ext_quality_t` 5 mức và mã lý do cho điểm phụ. Chất lượng là thuộc tính của
dữ liệu, không phải trạng thái toàn cục — đúng mô hình cần cho hệ điều khiển.

## 4. `mkddc-core`

### 4.1 Vòng scan

`scan_loop.cpp` chạy: đọc snapshot I/O → cập nhật bảng điểm → đánh giá chất lượng
→ chạy graph → phân xử ưu tiên → ghi lệnh ra. Chu kỳ mặc định lấy từ `graph.json`
nếu không có `--scan-ms` — tức là ý đồ của kỹ sư trong tệp chương trình thắng
mặc định của mã.

**Watchdog chỉ được kick đúng một điểm**, sau khi scan hoàn tất
([main.cpp:337](../../../apps/core/bootstrap/main.cpp#L337)). CI kiểm bằng cách
đếm: `WATCHDOG=1` phải xuất hiện đúng 1 lần trong `main.cpp` và 0 lần trong
`scan_loop.cpp`. Lý do ghi trong workflow: kick giữa scan biến watchdog thành
liveness check vô nghĩa — một `step()` treo vẫn kick đều.

### 4.2 Kiến trúc an toàn

Chuỗi trách nhiệm tách rõ, và lý do tách được ghi ngay trong header:

```
CoreMetrics      → chỉ ĐẾM/ĐO      (quan trắc, tắt được mà hệ vẫn điều khiển đúng)
OverrunMonitor   → chỉ ĐÁNH GIÁ    ("có nên vào safe không")
SafeState        → QUYẾT ĐỊNH      (quyền duy nhất ép output)
AlarmRuntime     → BÁO
```

Lập luận trong `overrun_monitor.hpp` đáng trích: đặt ngưỡng an toàn vào lớp quan
trắc khiến một thành phần **không thiết yếu** nắm quyền **thiết yếu**, và làm
chính sách an toàn không test được độc lập với bộ đếm.

Ma trận kích hoạt safe-state đã hiện thực
([safe_state.hpp](../../../apps/core/domain/safety/safe_state.hpp)):

| Mã | Điều kiện |
|---|---|
| T1/T2 | `iop_status` = FAULT / SAFE |
| T3 | SHM cũ quá 3 chu kỳ scan |
| T6 | `ui_quality` = BAD trên kênh graph đang dùng |
| T7 | chưa có graph hợp lệ **và** không có manual/BMS đang hoạt động |
| T8 | task overrun vượt ngưỡng liên tiếp |

Hành động cố định: AO → 0 V/4 mA theo `ao_mode`, DO → hở. **Không** theo
`io_safe_state.conf` — tệp đó chỉ cấu hình mặc định mức ưu tiên 6. Phân biệt này
được ghi rõ trong header, đúng chỗ dễ nhầm nhất.

### 4.3 Bất biến không cấp phát

`allocation_probe` ghi đè `new`/`delete` **toàn cục** ở đúng một translation unit
(nếu mỗi test tự ghi đè thì linker báo trùng định nghĩa). Bộ đếm là
`thread_local` nên test đo trên thread của nó không bị nhiễu. `ScopedCounter` tự
tắt khi ra khỏi khối kể cả khi test fail giữa chừng — nếu không, một `ASSERT_*`
thoát sớm sẽ để bộ đếm bật vĩnh viễn và làm mọi test sau đó chậm và sai.

Nhờ vậy "không cấp phát heap trong scan path" là **số đo**, không phải ý định.

### 4.4 Graph runtime

28 loại node, sắp xếp topo, trạng thái bền cho bộ đếm giờ chạy và bộ đếm xung.
Xem [02](02_TINH_NANG_PROGRAMMING_THEO_SRC.md) §4 để có bảng đầy đủ.

### 4.5 Lịch vận hành

`ScheduleV*` là nhóm test lớn nhất toàn dự án (67 test), gồm lịch tuần, ngoại lệ,
đồng hồ, và các trường hợp từ chối. Engine này được BE gọi lại qua
`mkddc-schedule-sim` để mô phỏng, nên chỉ có **một** bản cài thuật toán.

### 4.6 IPC với web

`web_ipc.cpp` (866 dòng) nhận 8 lệnh: `write`, `release`, `query`,
`point_snapshot`, `schedule_state`, `alarm_list`, `alarm_ack`, `alarm_suppress`,
`alarm_return`. 40 test.

## 5. `mkddc-iobus`

### 5.1 Giao thức IOP (tới MCU)

`iop_frame`, `iop_parser`, `iop_crc`, `iop_client`, `iop_port` — tách khung, phân
tích, CRC và vận chuyển thành các lớp riêng, nên mỗi lớp test được độc lập. Có
test chạy với fake MCU (`test_iop_client_fake_mcu.cpp`) và bộ kiểm bố trí SHM
(`test_shm_layout.cpp`).

### 5.2 Modbus

RTU master và TCP client, với: hồ sơ thiết bị, codec thanh ghi (có test riêng cho
biên mã hoá), bộ lập lịch poll, worker theo bus, cache điểm mở rộng, kênh điều
khiển, và số đo fieldbus. Bật bằng `MKDDC_ENABLE_MODBUS` (mặc định OFF, bản
release bật ON).

### 5.3 BACnet/IP

Máy chủ dựa trên bacnet-stack: bảng object, mức ưu tiên, COV, cảnh báo, độ tin
cậy, object lịch. 1.432 dòng, **55 test** phía iobus (73 test nếu tính cả bảng
object phía core). Bật bằng `MKDDC_ENABLE_BACNET`.

### 5.4 Thời gian thực

`realtime.cpp`: `SCHED_FIFO` qua `pthread_setschedparam` và `mlockall(MCL_CURRENT
| MCL_FUTURE)`.

Cả hai đều **suy giảm có kiểm soát**: nếu không xin được quyền, chương trình in
`WARN … (degraded)` và chạy tiếp với `SCHED_OTHER` thay vì thoát. Đây là lựa chọn
đúng cho thiết bị hiện trường — chạy kém còn hơn không chạy — miễn là trạng thái
suy giảm được nói ra, và ở đây nó được nói ra.

## 6. Biên kiến trúc ép bằng build

[apps/core/CMakeLists.txt](../../../apps/core/CMakeLists.txt) chia thành các
target theo tầng:

```
core_build_settings (INTERFACE)
      ↑
core_domain → core_application → core_adapters → core_runtime
                    ↑
             st_compiler_lib   (KHÔNG được core_lib link)
```

`mkddc-core` link `core_lib`; `mkddc-st-validate` và `mkddc-st-compile` link
`st_compiler_lib`. Vì `core_lib` không link `st_compiler_lib`, runtime **không
thể** gọi parser dù lập trình viên có muốn — bình luận trong CMake ghi rõ đây là
ràng buộc **link-time**, không phải kỷ luật lập trình.

CI kiểm lại lần hai trên nhị phân đã build:

```bash
nm -C "$BIN" | grep -E 'parse_st_program|typecheck_st_program|compile_st_to_ir' && exit 1
```

Hai lớp bảo vệ độc lập cho cùng một bất biến — đúng mức cho một ràng buộc mà vi
phạm chỉ lộ ra khi đã chạy production.

Cách ly SHM khi test cũng được xử lý cẩn thận: test đặt `MKDDC_SHM_PLC_NAME=
/mkddc_plc_shm_coretest`, vì `BacnetObjTable::attach()` mở với `O_CREAT|O_RDWR`
rồi `memset` toàn segment — chạy test trên máy đang có service sẽ xoá sạch SHM
đang sống, và trên bo lab thì đỏ hàng loạt vì `EACCES`.

## 7. Dịch vụ SOM phụ

### `mkddc-netcfg` (2.196 dòng, 64 test)

Cấu hình mạng qua NetworkManager với **giao dịch có nhật ký**: stage → apply →
confirm, và tự rollback nếu không confirm. Đây là mô hình đúng cho việc đổi cấu
hình mạng từ xa — sai một bước thì mất luôn đường vào để sửa. `install.sh` từ
chối cài khi còn giao dịch dở dang (ADR-022 §7).

Tỉ lệ test/nguồn 0,71 — cao, tương xứng với rủi ro.

### `mkddc-hmi` (4.965 dòng, 33 test)

Màn hình TFT tại chỗ: LVGL trên DRM, cảm ứng evdev, nút GPIO, 5 màn hình (trang
chủ, I/O, cảnh báo, điều khiển, dịch vụ), song ngữ.

Tỉ lệ test/nguồn **0,18 — thấp nhất trong các thành phần lớn.** Đây là màn hình
người trực nhìn khi hệ có sự cố và mạng đã hỏng, tức là đúng lúc nó phải đáng tin
nhất. CI mới bắt đầu biên dịch HMI từ khi thêm leg `full` (F-14) — trước đó
`mkddc-hmi` chưa bao giờ được CI build và 28 test HMI chưa bao giờ chạy.

## 8. FW MCU (ngoài phạm vi FW SOM)

`firmware/stm32`: 565 dòng nguồn, 435 dòng test. Gồm `ddc24_runtime.c` và
`iop_link.c` cùng phần khung STM32CubeMX. Tầng giao thức có bộ kiểm chạy trên host
(`fw_hostcheck`) nên logic IOP test được không cần phần cứng.

So với ghi nhận bàn giao 2026-07-29 (khi đó FW MCU chỉ là khung 16 dòng), phần
này đã có nội dung thực chất.

## 9. Kiểm chứng

```
cmake --fresh -S . -B build/report-audit -DCMAKE_BUILD_TYPE=Release \
  -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON
→ configure 0, build 0
ctest --test-dir build/report-audit --output-on-failure
→ 100% tests passed, 0 failed out of 860 (13,44 s)
```

| Thư mục | Test |
|---|---:|
| core | 487 |
| iobus | 275 |
| netcfg | 64 |
| hmi | 33 |
| fw_hostcheck | 1 |

Ngoài ctest, CI còn chạy: ASan (`detect_leaks=1`), UBSan
(`-fno-sanitize-recover=all`), và fuzz smoke 60 s cho `st_parser` + `st_loader`.

**Bẫy cần nhớ**: `MKDDC_ENABLE_HMI` mặc định OFF. Bỏ cờ này thì 33 test HMI không
chạy và người đo vẫn thấy "toàn bộ pass".

## 10. Khuyến nghị

1. **Chốt số phận engine ST** — nối vào, đóng băng có ghi nhận, hoặc gỡ bỏ. Xem
   [02](02_TINH_NANG_PROGRAMMING_THEO_SRC.md) §7.
2. **Nâng độ phủ test HMI.** 0,18 là quá mỏng cho giao diện dự phòng khi mạng hỏng.
3. **Thêm CLI validate graph** (`mkddc-graph-validate`) bọc `GraphRuntime::validate`,
   để BE và FE dùng chung một bản cài validator — đúng khuôn mẫu
   `mkddc-schedule-sim` đã chứng minh là hiệu quả.
4. **Cân nhắc bật mặc định `MKDDC_ENABLE_HMI`** để mặc định của bản dựng khớp với
   mặc định của bản xuất xưởng, giảm khả năng đo thiếu.
