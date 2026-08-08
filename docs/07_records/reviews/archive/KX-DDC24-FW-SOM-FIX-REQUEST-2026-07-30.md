# Yêu cầu fix & debug cho team FW SOM — từ review 2026-07-30

> **HỒ SƠ LỊCH SỬ — lưu trữ 2026-08-08.** Không dùng làm nguồn chuẩn. Lý do lưu
> trữ và tài liệu thay thế: [`archive/README.md`](README.md). Mọi đường dẫn source
> trong tài liệu này theo cây thư mục **trước** `PLAN-ARCH-RESTRUCT-002`; bảng ánh
> xạ sang vị trí hiện tại ở [chỉ mục hồ sơ rà soát](../README.md).

- Nguồn: `docs/07_records/reviews/KX-DDC24-CODE-REVIEW-FE-BE-FWSOM-2026-07-30.md` (Rev 2, 23 finding).
- Mốc code: `main` tại `7ea3ac5` (cây source giống hệt `7a5b72a`, chỉ khác `CHANGELOG.md`) — mọi số dòng dưới đây đúng tại mốc này.
- Phạm vi văn bản này: **chỉ các finding thuộc FW SOM** (9/23). Các finding FE/BE/CI/packaging (F-01, F-02, F-04, F-06, F-07, F-09..F-13, F-15, F-19, F-20, F-23) không thuộc yêu cầu này.

## 0. Phân loại finding FW SOM

| Finding | Mức | Vị trí | Khối |
|---|---|---|---|
| `F-03` | **Cao** | `services/hmi/main.cpp:186` | hmi |
| `F-14` | **Cao** | `services/CMakeLists.txt:47` + `.github/workflows/build-and-test.yml:29-52` | build/CI |
| `F-05` | Trung bình | `services/iobus/iop/iop_client.cpp:112`, `iop_port.cpp:88-90` | iobus |
| `F-08` | Trung bình | `services/iobus/fieldbus/modbus_tcp.cpp:62` | iobus |
| `F-16` | Trung bình | `services/iobus/fieldbus/modbus_master.cpp:91` | iobus |
| `F-17` | Trung bình | `modbus_master.cpp:87-89` + `modbus_tcp.cpp:57-58` | iobus |
| `F-18` | Trung bình | `services/iobus/fieldbus/device_profile.cpp:119-135` | iobus |
| `F-21` | Thấp | `services/iobus/fieldbus/device_profile.cpp:168` | iobus |
| `F-22` | Thấp | `services/netcfg/netcfg.cpp:514-519` | netcfg |

Hai điểm cần nói rõ:

- **`services/core` không có finding nào.** Toàn bộ graph runtime, PointTable, io_scaling, PID, loader IR đều đã được soi và các bảo vệ biên đều đúng (chi tiết ở mục 5 của báo cáo gốc). Đừng đọc văn bản này như một bản cáo trạng cho cả FW SOM — 6/9 finding tập trung ở đúng một chỗ: `iobus/fieldbus`.
- **`F-02` không phải lỗi của FW SOM nhưng cần FW tham gia.** Đó là lỗi phía BE Go (`web/backend/core_client.go:137` đọc SHM bằng `os.ReadFile`, không theo seqlock). Nhưng hợp đồng bị vi phạm là `shared/mkddc_shm.h:18-19` do FW sở hữu, và cả `hmi/data/shm_reader.cpp:110` lẫn `modbus_master.cpp:133-143` đều đã làm đúng. Xem mục 5 (WP5) về phần việc của FW ở finding này.

---

## 1. Prompt bàn giao cho team FW

> Sao chép nguyên khối dưới đây cho engineer hoặc agent thực hiện.

---

### Bối cảnh

Bạn đang làm việc trên repo MK-DDC-24 tại nhánh `main`, commit `7ea3ac5`. Một vòng review code đã kết thúc và tìm ra 9 finding thuộc phần FW SOM (`services/`). Nhiệm vụ của bạn là **sửa và kiểm chứng** các finding này, theo đúng thứ tự work package bên dưới.

Đọc trước khi bắt đầu:
1. `docs/07_records/reviews/KX-DDC24-CODE-REVIEW-FE-BE-FWSOM-2026-07-30.md` — mô tả đầy đủ từng finding kèm kịch bản lỗi.
2. `CLAUDE.md` / `AGENTS.md` — quy tắc dự án. Bắt buộc: **tài liệu và changelog viết bằng tiếng Việt**; mọi thay đổi code phải cập nhật `CHANGELOG.md` dưới `[Unreleased]` trong cùng phiên làm việc.
3. `docs/DOC_GOVERNANCE.md` — gate **DOC TRƯỚC CODE SAU**: nếu thay đổi vượt quá phạm vi sửa lỗi cục bộ (ví dụ đổi hợp đồng `kx_ext_point_t`, đổi cách đánh index ext), phải cập nhật tài liệu thiết kế và có plan được duyệt **trước khi** viết code.

### Mốc kiểm chứng phải giữ được

Đây là số đo lại độc lập tại `7ea3ac5`, dùng làm baseline. Sau khi sửa, **không được để bất kỳ số nào tụt xuống**:

```bash
# C++ đầy đủ — CHÚ Ý: phải bật cả 3 option, mặc định HMI là OFF
cmake -S services -B build/fw \
  -DCMAKE_BUILD_TYPE=Release \
  -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON
cmake --build build/fw -j"$(nproc)"
ctest --test-dir build/fw --output-on-failure
# Baseline: 702/702 PASS  (674 khi HMI=OFF: core 467 + iobus 165 + netcfg 42, + 28 test HMI)
```

Sanitizer (bắt buộc chạy cho WP2 và WP3 vì cả hai chạm tới index và buffer):

```bash
cmake -S services -B build/asan  -DCMAKE_BUILD_TYPE=Debug -DMKDDC_SANITIZE=address \
  -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_HMI=ON
cmake --build build/asan -j"$(nproc)"
ASAN_OPTIONS=detect_leaks=1 ctest --test-dir build/asan --output-on-failure

cmake -S services -B build/ubsan -DCMAKE_BUILD_TYPE=Debug -DMKDDC_SANITIZE=undefined \
  -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_HMI=ON
cmake --build build/ubsan -j"$(nproc)"
ctest --test-dir build/ubsan --output-on-failure
```

Lưu ý về cảnh báo build: sẽ thấy **2 cảnh báo** `-Wstringop-overflow` từ `services/iobus/tests/test_output_command.cpp:34`. Đây là false positive đã biết của GCC 13 (PR109945) khi realloc `vector`, đã được hạ mức có chủ ý **chỉ** cho target test (`iobus/CMakeLists.txt:143`, `core/CMakeLists.txt:80`). **Không phải việc của bạn, đừng "sửa" nó.** Nhưng nếu xuất hiện cảnh báo *mới* nào khác thì phải xử lý — target production giữ nguyên `-Wall -Wextra -Werror`.

---

### WP1 (P0) — Khôi phục annunciation an toàn của HMI + đưa HMI vào gate

Sửa **F-03** và **F-14** cùng lúc, vì F-14 là lý do F-03 không bị phát hiện.

#### F-03 — HMI lái banner sự cố và alarm E001/E002 bằng dữ liệu SHM cũ

`services/hmi/main.cpp:186`, `services/hmi/data/shm_reader.cpp:107,145`

Cơ chế: `hmi::DataCache data` khai báo **ngoài** vòng lặp (`main.cpp:164`) nên được tái dùng qua từng chu kỳ. Giá trị trả về của `shm.read_all(&data)` bị **bỏ qua**. Bên trong, khi cả 5 lần retry seqlock thất bại hoặc `magic` sai, `seqlock_read_io` return false mà **không** reset `out->iop_status`, `out->fault_flags`, `out->io_valid`. Kết quả: `data.iop_status` giữ giá trị cũ `KX_IOP_NORMAL` → `main.cpp:187` tính `io_fault = false` → **alarm E001 "I/O communication fault" không kích, banner vẫn xanh** dù không còn dữ liệu I/O sống.

Kèm theo: `read_all` cũng bỏ giá trị trả về của `seqlock_read_plc` (`shm_reader.cpp:145`, chỉ `ok |=` cho io), và `io_valid`/`plc_valid` không bao giờ được set lại về false.

Cách debug/tái hiện:
```bash
# Dựng stack không cần board (PTY + fake MCU)
tools/run_noboard_demo.sh
# Ở terminal khác: theo dõi banner + alarm trên HMI, rồi giết iobus
sudo systemctl kill -s SIGKILL mkddc-iobus    # hoặc kill -9 <pid> nếu chạy tay
# Quan sát: banner phải chuyển sang trạng thái sự cố và E001 phải kích trong ≤ 2 chu kỳ.
# Hành vi hiện tại: banner vẫn xanh, E001 im lặng.
# Kiểm tra trạng thái SHM song song:
tools/shm_dump_io/shm_dump_io
```

Tiêu chí hoàn thành:
- `read_all` trả về trạng thái thành công/thất bại **cho cả hai** vùng (io và plc) và caller ở `main.cpp` **phải dùng** giá trị đó.
- Khi đọc thất bại, dữ liệu dùng để lái annunciation phải **fail-safe**: `io_valid`/`plc_valid` set về `false` và đường tính `io_fault` phải coi "không đọc được" là **có sự cố**, không phải "bình thường". Không được để giá trị cũ của `iop_status`/`fault_flags` tiếp tục lái quyết định.
- Giữ nguyên hành vi đã đúng của đường hiển thị *giá trị* (đang được `age_ns` bảo vệ, `screen_io.cpp:40`) — đừng làm màn hình nháy dữ liệu khi chỉ trượt một chu kỳ đọc.
- Test mới trong `services/hmi/tests/test_shm_reader.cpp` và/hoặc `test_alarm_model.cpp`: dựng trường hợp seqlock fail liên tục và trường hợp `magic` sai, khẳng định `io_valid == false` và alarm E001 được kích.

#### F-14 — `mkddc-hmi` chưa bao giờ được CI biên dịch hay test

`services/CMakeLists.txt:47` (`option(MKDDC_ENABLE_HMI ... OFF)`) và `.github/workflows/build-and-test.yml:29-52` (matrix chỉ đổi `bacnet` × `modbus`).

Đã đo: cấu hình mặc định = **674 test**; thêm `-DMKDDC_ENABLE_HMI=ON` = **702 test**. Tức 28 test HMI (`test_alarm_model`, `test_shm_reader`, `test_nav`, `test_point_db`, `test_locale`, `test_key_queue`, `test_hmi_api_client`, `test_network_model`) chưa từng chạy trên CI, và bản thân `mkddc-hmi` chưa từng được kiểm tra là còn biên dịch được. **Cả hai đều PASS khi bật** — đây là gate bị bỏ quên, không phải gate đang đỏ.

Tiêu chí hoàn thành:
- Thêm một leg vào matrix C++ của `build-and-test.yml` có `MKDDC_ENABLE_HMI=ON` (gợi ý: leg `modbus+bacnet+hmi`, để phủ luôn tổ hợp đầy đủ nhất).
- Sau khi thêm, leg đó phải cho **702/702 PASS**.
- Nếu leg HMI cần thư viện hệ thống bổ sung, bổ sung vào bước "Install build dependencies" (`build-and-test.yml:56`).

---

### WP2 (P1) — Cụm ext index + device profile của Modbus (sửa một lần)

Sửa **F-16, F-17, F-18, F-08, F-21** trong cùng một đợt. Chúng là bốn biểu hiện của **một nguyên nhân gốc**: cách đánh và đếm index ext không có một nguồn chân lý duy nhất, và tràn dải thì fail-open thay vì fail-closed. Sửa lẻ từng cái sẽ phải sửa lại chỗ đã sửa.

Hằng số liên quan: `KX_N_EXT = 64` (`shared/mkddc_shm.h:38`).

#### Nguyên nhân gốc — F-17: đếm slot ext theo *register* thay vì theo *điểm luận lý*

`modbus_master.cpp:87-89` và `modbus_tcp.cpp:57-58` đều đếm `pts += pp.count`, tức **số register**. Nhưng vòng đọc tiêu **1 slot ext cho mỗi 2 register** với `Int32`/`Uint32`/`Float32` (`modbus_master.cpp:272-273`, `modbus_tcp.cpp:203`: `if (is32) k++`). Một điểm `float32 count=2` được đặt trước 2 slot nhưng chỉ dùng 1.

Hệ quả:
1. Profile thiên về 32-bit (đo điện năng, lưu lượng — đúng nhóm thiết bị hay dùng `float32`) **đặt trước gấp đôi số slot cần** → dung lượng 64 slot khả dụng thực tế còn một nửa, đẩy F-08/F-16 xảy ra sớm gấp đôi.
2. Các slot ở khoảng trống không bao giờ được `set_point` nên giữ nguyên `quality = KX_Q_BAD` và `name` rỗng.
3. `ExtCache::set_point` nâng `count_` lên tới index cao nhất từng ghi (`ext_cache.cpp:38`), nên `push_snapshot` gửi **cả các điểm rỗng đó** sang core (`ext_cache.cpp:63-76`) → bảng điểm ext trên web/HMI xen kẽ những dòng vô danh chất lượng BAD.

Không gây hỏng dữ liệu (base của slave sau cũng bị đẩy ra theo con số thừa nên `mark_slave_offline` không ghi lấn sang slave kế tiếp) — nhưng mất nửa dung lượng và sinh điểm rác.

**Yêu cầu**: tách phép đếm slot ext thành **một hàm thuần duy nhất** (ví dụ `ext_slots_for_point(const ProfilePoint&)` và `ext_slots_for_profile(const DeviceProfile&)`) rồi dùng chung cho cả `modbus_master.cpp`, `modbus_tcp.cpp` và các vòng đọc. Hiện tại logic "32-bit tiêu 2 register" đang được viết lại **bốn lần** ở bốn chỗ (`modbus_master.cpp:87-89`, `:187-188`, `:272-273`; `modbus_tcp.cpp:57-58`, `:203`) — đó là lý do chúng lệch nhau. Hàm thuần này còn có lợi ích là **test được mà không cần libmodbus**, khác với `open()` hiện đang nằm trong nhánh `#else` của `MKDDC_ENABLE_MODBUS`.

#### F-16 — RTU: slave vượt `KX_N_EXT` bị loại khỏi poll nhưng vẫn báo ONLINE

`modbus_master.cpp:91`

Khi `ext_idx > KX_N_EXT`, vòng cấu hình `break` ngay. Các slave còn lại **không được gọi `load_device_profile`** nên `profiles_[i].points` rỗng. Nhưng `slave_states_` đã `resize` cho *toàn bộ* slave (`:64`) nên chúng vẫn được `poll_once` gọi tới. `read_slave` chạy qua vòng points rỗng mà không làm gì, giữ `slave_ok = true`, rồi gọi `on_poll_ok` + `metrics.update(slave_idx, true)` (`:281-286`).

Kết quả: slave hiển thị **online, error rate 0%, không alarm E302**, trong khi thực tế nó không được truy vấn lần nào và không có điểm nào. **Không có cả một dòng log nào tại thời điểm `break`.**

#### F-08 — TCP: cùng lỗi, biểu hiện khác

`modbus_tcp.cpp:62`

`open()` clamp `if (idx > KX_N_EXT) idx = KX_N_EXT;` nhưng **không log** và **không clamp `conn.ext_count`**. Khi RTU đã tiêu hết 64 slot, mọi TCP slave nhận `ext_base = 64`. `read_conn` gặp `if (ext_idx >= KX_N_EXT) break;` ở point đầu tiên (`:168`), thoát với `slave_ok` **vẫn true** → `on_poll_ok` → slave báo **online và khỏe mạnh** mà không publish nổi một điểm nào.

**Yêu cầu cho F-16 + F-08**: tràn `KX_N_EXT` phải **fail-closed và ồn ào**:
- Log `ERROR` tại thời điểm phát hiện, nêu rõ tên slave bị ảnh hưởng, số slot cần vs số slot còn lại.
- Slave không được cấp đủ slot **không được báo online**. Đánh nó là lỗi cấu hình (trạng thái riêng, hoặc offline + alarm) để kỹ thuật viên hiện trường thấy ngay. Tuyệt đối không để tình trạng "đèn xanh, bảng điểm trống, log im lặng".
- Đừng dùng `break` làm cách xử lý tràn ở `modbus_master.cpp:91` — nó khiến các slave sau đó vào trạng thái nửa vời (có `slave_states_` nhưng không có profile). Xử lý dứt điểm từng slave.

#### F-18 — Validation "32-bit ⇒ count=2" đã hứa trong tài liệu nhưng chưa hiện thực

`device_profile.cpp:119-135`, hợp đồng tại `device_profile.hpp:50`

`device_profile.hpp:50` khẳng định `type không khớp count (32-bit cần count=2) → skip`, comment tại `device_profile.cpp:119` nhắc lại. Nhưng biến `is32bit` **chỉ được dùng cho check `byte_order`** (`:131`) — không có bất kỳ so sánh nào giữa `type` và `count`. Profile `type: "float32", count: 1` đi qua loader trọn vẹn.

Hệ quả khi điểm 32-bit ở biên lẻ, và **hai transport xử lý khác nhau**:
- TCP làm đúng: log `modbus_tcp.odd_32bit` rồi bỏ điểm (`modbus_tcp.cpp:196-205`).
- RTU tính `count_this = (k + 1 < pt.count) ? 2u : 1u` (`modbus_master.cpp:267`) → `decode_register` nhận `count=1` nên return `0.0f` (`register_codec.cpp:53`) → giá trị `0*scale + offset` được publish với **`KX_Q_GOOD`** (`:276`). Tức một **giá trị bịa được đánh dấu là dữ liệu tốt** — với thang đo có offset nó còn trông rất hợp lý (ví dụ hiện đúng 20.0 °C).

Không có nguy cơ OOB (mọi nhánh 32-bit của `decode_register`/`encode_register` đều chặn `count < 2`), nên đây là lỗi **tính đúng đắn của dữ liệu**, không phải lỗi bộ nhớ.

**Yêu cầu**: hiện thực validation đúng như `device_profile.hpp:50` đã hứa (32-bit ⇒ `count` phải là bội số của 2, hoặc chốt `count == 2` nếu đó là ý định ban đầu — quyết định rồi **cập nhật lại tài liệu cho khớp**). Sau đó cho RTU xử lý biên lẻ **giống TCP** (log + bỏ điểm), tuyệt đối không publish `KX_Q_GOOD` cho giá trị không decode được.

#### F-21 — Biểu thức kiểm giới hạn block coil đúng do tình cờ

`device_profile.cpp:168`

```cpp
if ((fc == 1 || fc == 2) && static_cast<int>(pt->count) * static_cast<int>(pt->count > 0) > 2000)
```

Nhân tử thứ hai là `static_cast<int>(pt->count > 0)` — một bool, và vì `count >= 1` đã được bảo đảm ở `:95` nên nó **luôn bằng 1**. Biểu thức rút gọn thành `count > 2000`, tức đúng ý định. **Không phải lỗi hiện tại**, nhưng là dấu vết của một phép nhân bị viết sai và là bẫy cho người sửa tiếp theo.

**Yêu cầu**: viết thẳng `pt->count > 2000`. Nếu ý định ban đầu thực sự khác (ví dụ tính theo byte, hay phân biệt fc==1 với fc==2), thì hiện thực đúng ý định đó **và** thêm test chốt hành vi. Không sửa mù.

#### Cách debug/tái hiện cả cụm WP2

```bash
# 1. Dựng profile vượt dải: tổng ext > 64 slot, đặt vài slave ở cuối danh sách
#    → quan sát các slave cuối: hiện tại báo online, error 0%, không điểm nào.
# 2. Dựng profile toàn float32 (count=2) → đếm số slot thực dùng vs đặt trước.
#    Kỳ vọng sau khi sửa: n điểm float32 dùng đúng n slot, không phải 2n.
# 3. Xem snapshot ext thực tế đẩy sang core:
tools/shm_dump_io/shm_dump_io          # kiểm các slot có name rỗng + quality BAD
# 4. Test tích hợp cả stack:
tools/integration_test/advanced_stack_test.sh
```

Test cần thêm/mở rộng (đã có sẵn, chỉ cần bổ sung case):
- `services/iobus/fieldbus/tests/test_device_profile.cpp` → F-18, F-21
- `services/iobus/fieldbus/tests/test_modbus_master_fake.cpp` → F-16, F-17
- `services/iobus/fieldbus/tests/test_modbus_tcp.cpp` → F-08, F-17
- `services/iobus/fieldbus/tests/test_ext_cache.cpp` → F-17 (khẳng định không có slot rỗng nào lọt vào snapshot)

Tiêu chí hoàn thành WP2:
- Chỉ còn **một** chỗ trong toàn bộ codebase biết luật "32-bit tiêu 2 register".
- Profile 32-bit dùng đúng số slot cần; không còn slot rỗng nào lọt vào `push_snapshot`.
- Tràn `KX_N_EXT` sinh log `ERROR` và slave liên quan **không** báo online.
- RTU và TCP xử lý điểm 32-bit biên lẻ **giống nhau**, và không publish `KX_Q_GOOD` cho giá trị không decode được.
- ASan + UBSan sạch (cụm này chạm index và buffer nên bắt buộc).

---

### WP3 (P2) — F-05: UART hangup gây spin CPU và không phát hiện được mất kết nối

`services/iobus/iop/iop_client.cpp:112`, `services/iobus/iop/iop_port.cpp:88-90`

Hai lỗi cộng dồn:
1. `wait_response` chỉ xét `pfd.revents & POLLIN`, **không xử lý `POLLHUP`/`POLLERR`** — mà `poll()` báo hai cờ này bất kể `events` yêu cầu gì.
2. `IopPort::read` trả `0` cho **cả EAGAIN lẫn EOF** (`iop_port.cpp:88-90`), nên caller không phân biệt được "chưa có dữ liệu" với "sẽ không bao giờ có dữ liệu nữa".

Kịch bản: USB-serial tới MCU bị rút (hoặc PTY fake MCU chết). fd tty báo `POLLHUP`. `poll()` trả về ngay với `pr > 0`, nhưng `revents & POLLIN` false → **không gọi `read` nên không bao giờ thấy lỗi** → vòng `for(;;)` gọi lại `poll()` liền → spin không sleep cho tới hết deadline của transaction đó, nhân `max_retry + 1` lần trong `transact`, lặp lại ở **mỗi** chu kỳ poll 10 ms. Một core bị chiếm ở mức rất cao suốt trạng thái RECONNECT, cạnh tranh trực tiếp với scan loop `SCHED_FIFO` của core. Hangup lẽ ra phải phát hiện tức thì lại chỉ lộ ra qua đường timeout.

Cách debug/tái hiện:
```bash
# Dựng cặp PTY + fake MCU
tools/run_noboard_demo.sh
# Terminal khác: xác định pid iobus và theo dõi CPU
pidstat -p "$(pgrep -f mkddc-iobus)" 1
# Giết đầu PTY còn lại để tạo POLLHUP (socat/fake_mcu)
pkill -f fake_mcu     # hoặc pkill socat
# Quan sát: CPU của mkddc-iobus tăng vọt và giữ ở mức cao.
# Kỳ vọng sau khi sửa: phát hiện hangup ngay, chuyển RECONNECT, CPU không tăng bất thường.
```
Có thể đo trực tiếp số lần gọi `poll` để chứng minh spin:
```bash
strace -f -e trace=poll -c -p "$(pgrep -f mkddc-iobus)"
```

Tiêu chí hoàn thành:
- `wait_response` xử lý `POLLHUP`/`POLLERR` và **thoát ngay** với mã lỗi phù hợp (đường `NOT_OPEN`/reconnect), không spin tới hết deadline.
- `IopPort::read` **phân biệt EOF với EAGAIN** — đề xuất trả một mã riêng cho EOF (hoặc tách thành hai giá trị trả về), và cập nhật mọi caller. Kiểm cả các caller khác ngoài `wait_response`.
- Giữ nguyên semantics đã có chủ đích ở `transact`: EAGAIN kéo dài khi *ghi* vẫn phải đi qua đường TIMEOUT → retry → FAULT → RECONNECT (xem comment `iop_client.cpp:137-139`). **Đừng** đổi nó thành `NOT_OPEN` tức thì.
- Test mở rộng `services/iobus/tests/test_iop_client_fake_mcu.cpp`: dựng PTY rồi đóng đầu còn lại, khẳng định không có vòng spin (ví dụ chốt số lần gọi `poll` hoặc thời gian tới khi phát hiện hangup) và trạng thái chuyển đúng.

---

### WP4 (P3) — F-22: `netcfg` biến output bị cắt thành "lệnh thất bại"

`services/netcfg/netcfg.cpp:514-519`

Vòng đọc dừng khi `result.size() >= 4096`: điều kiện `n > 0 && result.size() < 4096` false → rơi xuống `else break` → `close(pipes[0])`. Child đang ghi tiếp nhận `SIGPIPE`; khi đó `WIFEXITED(status)` false nên `run()` **return false** (`:524`) cho một lệnh thực chất đã chạy đúng.

Chỉ chạm tới khi output `nmcli`/`ip` dài bất thường (hiện mọi lời gọi đều là `-g <một field>`), nhưng hệ quả là biến một lần cắt output thành một lần "apply thất bại" giả — trong service đang có cơ chế rollback fail-closed thì đây là loại tín hiệu sai đáng tránh.

Tiêu chí hoàn thành: **đọc cạn pipe** rồi mới bỏ phần vượt 4096 byte, để child không bị `SIGPIPE` và `WEXITSTATUS` phản ánh đúng kết quả thật. Thêm test trong `services/netcfg/tests/` với lệnh sinh output > 4096 byte và exit code 0, khẳng định `run()` trả `true`.

*Ghi chú phạm vi*: `netcfg` đã được review theo hướng bề mặt tấn công (thực thi lệnh, parse chuỗi, quyền file) và **sạch** — `LinuxPlatform::run` dùng `fork` + `execv` với argv vector tường minh, binary từ đường dẫn tuyệt đối qua `access(X_OK)`, **không qua shell** nên không có command injection. Tính đúng đắn của state machine apply/verify/rollback so với đặc tả thì **chưa** được review sâu; nếu cần cho chứng nhận thì đề xuất một vòng review riêng, không gộp vào WP này.

---

### WP5 — Phần việc của FW ở F-02 (lỗi thuộc BE, hợp đồng thuộc FW)

`shared/mkddc_shm.h:18-19` quy định **bắt buộc** pattern seqlock cho mọi reader. Phía FW đã tuân thủ đúng ở cả hai chỗ: `hmi/data/shm_reader.cpp:110` và `modbus_master.cpp:133-143`. Phía BE Go thì không: `web/backend/core_client.go:137` dùng `os.ReadFile` + `validSHM()`, mà `validSHM` chỉ kiểm `magic` và độ dài, **không đọc `seq`** — và `magic` không bị writer chạm trong lúc ghi nên check đó luôn pass. Snapshot bị xé đi thẳng ra WS monitor và **được historian ghi vào DB** (`sampler.go:156`).

Việc sửa thuộc team BE. Việc của FW:
- Review giải pháp của BE để chắc chắn nó thực sự đúng pattern (`modbus_master.cpp:133-143` là hình mẫu phía C++: đọc `seq` acquire, bỏ nếu lẻ, memcpy, đọc lại `seq`, so sánh, retry có giới hạn).
- Cân nhắc đưa ra một đường an toàn sẵn có thay vì để mỗi consumer tự hiện thực lại seqlock: `ReadPointSnapshot` đi qua core đã là hình mẫu. Nếu chọn hướng này thì đây là **thay đổi hợp đồng** → áp gate DOC TRƯỚC CODE SAU.
- Làm rõ thêm trong `shared/mkddc_shm.h` rằng đọc bằng `read()`/`os.ReadFile` là **không hợp lệ**, vì hiện tại comment chỉ mô tả pattern mà không nói rõ điều này — đó là cái bẫy mà BE đã bước vào.

---

### Yêu cầu chung khi kết thúc

1. **Không đổi hành vi ngoài phạm vi 9 finding.** Nếu phát hiện thêm lỗi, ghi lại và báo, đừng tự mở rộng scope.
2. **Cập nhật `CHANGELOG.md`** dưới `[Unreleased]`, tiếng Việt, kèm ngày, phạm vi, mã finding đã đóng, và ghi chú verification.
3. **Cập nhật tài liệu bị lệch**: tối thiểu `device_profile.hpp:50` (F-18) phải khớp với hiện thực sau khi sửa. Nếu đổi cách đánh index ext thì cập nhật cả tài liệu thiết kế fieldbus.
4. **Báo cáo verification bằng số đo lại**, không dẫn lại số cũ: ctest (ghi rõ HMI ON/OFF), ASan, UBSan, và kết quả tái hiện thủ công cho F-03 + F-05 (hai finding này không thể chứng minh đã sửa chỉ bằng unit test).
5. Nếu một finding hóa ra **không đúng** hoặc không sửa được như mô tả, nói rõ lý do kèm dẫn chứng code — đừng sửa vòng vo cho khớp mô tả.

---

## 2. Thứ tự ưu tiên tổng hợp

| WP | Finding | Ưu tiên | Lý do |
|---|---|---|---|
| WP1 | F-03, F-14 | **P0** | F-03 là chức năng an toàn bị nuốt im lặng; F-14 là lý do nó không bị phát hiện — sửa cùng nhau |
| WP2 | F-17, F-16, F-08, F-18, F-21 | **P1** | một nguyên nhân gốc, năm biểu hiện; sửa lẻ sẽ phải làm lại |
| WP3 | F-05 | **P2** | chiếm CPU cạnh tranh với scan loop `SCHED_FIFO`, và mất khả năng phát hiện hangup |
| WP4 | F-22 | **P3** | khó chạm tới trong cấu hình hiện tại, nhưng sinh tín hiệu "apply failed" giả |
| WP5 | F-02 (phối hợp) | theo BE | lỗi thuộc BE; FW review hợp đồng + làm rõ tài liệu |
