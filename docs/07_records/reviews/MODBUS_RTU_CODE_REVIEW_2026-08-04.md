# Code Review — Modbus RTU source và tài liệu thiết kế

**ID:** DDC24-MBRTU-CODE-REVIEW-2026-08-04
**Ngày:** 2026-08-04
**Phạm vi review:** `apps/iobus/adapters/modbus_rtu/*`, `apps/web-api/internal/modbusrtu/*`,
`apps/web-api/internal/app/modbus_rtu.go`, `apps/web-ui/src/features/modbus-rtu/*`,
`contracts/shm/mkddc_shm.h` (phần ext), và bộ tài liệu thiết kế Modbus RTU tạo ngày 2026-08-04
**Commit:** `d587d8a`
**Ngoài phạm vi:** Modbus TCP, BACnet/IP, Programming

> Review này **không sửa source**. Nó phân biệt rõ hai loại phát hiện:
> **DEFECT** = source sai so với chính ý định hiện tại của nó (sửa được ngay,
> không cần chờ ADR-024); **GAP** = source đúng với thiết kế cũ nhưng khác thiết
> kế mới (phải chờ quyết định). Gap đã được liệt kê đầy đủ trong
> [Docs Sync Report](MODBUS_RTU_DOCS_SYNC_REPORT.md) §6 và **không lặp lại ở đây**.

## 1. Tổng quan

Đường Modbus RTU hiện tại là một implementation **có cấu trúc tốt ở tầng logic**:
tách module rõ (config / profile / codec / scheduler / metrics / cache / master),
test host phủ codec và slot accounting khá kỹ, và có vài chỗ xử lý fail-closed
đúng chuẩn công nghiệp. Vấn đề nằm ở **ba tầng trên**: đường ghi xuống thiết bị
không có kiểm tra biên, scheduler xử lý thiết bị lỗi sai cách, và tầng trình bày
tự bịa trạng thái.

**Điểm tốt cần giữ nguyên khi refactor:**

- `ext_slots_for_point()` là nguồn chân lý duy nhất cho việc đếm slot, có comment
  giải thích finding F-17 và có 6 test riêng — đây là cách xử lý đúng cho một lỗi
  từng bị lặp ở 4 chỗ khác nhau.
- `slave_config_error_` fail-closed: slave thiếu profile / hết ext slot **không**
  được báo ONLINE mà đi thẳng đường lỗi để kích E302. Comment ở
  [modbus_master.cpp:265-268](../../../apps/iobus/adapters/modbus_rtu/modbus_master.cpp#L265-L268)
  mô tả đúng lý do vận hành ("đèn xanh, bảng điểm trống, log im lặng"). Giữ.
- Cấp danh tính slot **trước** lần I/O đầu tiên
  ([modbus_master.cpp:293-314](../../../apps/iobus/adapters/modbus_rtu/modbus_master.cpp#L293-L314))
  nên lần poll đầu thất bại vẫn publish đúng Point ID thay vì bảng rỗng. Giữ.
- Xử lý điểm 32-bit ở biên register lẻ: log + bỏ, **không** publish `0*scale+offset`
  với nhãn GOOD ([modbus_master.cpp:367-379](../../../apps/iobus/adapters/modbus_rtu/modbus_master.cpp#L367-L379)). Giữ.
- Logic word/byte order trong `regs_to_u32`/`u32_to_regs` **đúng** cho cả 4 tổ hợp
  ABCD/BADC/CDAB/DCBA, và ánh xạ từ BE (`BuildProfile`) sang 4 tổ hợp đó cũng đúng.
- `rs485.device` lấy từ config, không hard-code, có test riêng.

## 2. DEFECT — correctness và an toàn

### D-01 · P0 · Undefined behavior khi encode giá trị ngoài dải

[register_codec.cpp:99-118](../../../apps/iobus/adapters/modbus_rtu/register_codec.cpp#L99-L118)

```cpp
regs[0] = static_cast<uint16_t>(static_cast<int16_t>(raw));   // raw là float
...
u32_to_regs(static_cast<uint32_t>(raw), byte_order, regs);
```

`raw` là `float` và **không được kiểm tra biên trước khi ép kiểu**. Theo
`[conv.fpint]/1`, chuyển float → integral khi giá trị không biểu diễn được trong
kiểu đích là **undefined behavior**. Các đường vào thực tế:

- `eng_value` = `plc_shm.ext[i].setpoint`, do node graph `Modbus_RTU_Write` ghi;
- không có clamp ở core, không có clamp ở iobus, không có `min/max` trong model.

**Kịch bản hỏng cụ thể:** Point `int16`, `scale=1`, `offset=0`. Logic ghi
`setpoint = 100000` (lỗi công thức trong graph, hoặc người dùng nhập nhầm đơn vị).
`raw = 100000.0f` → `static_cast<int16_t>` là UB; trên ARM64 kết quả thực tế
thường là `0x7FFF` hoặc giá trị rác. Giá trị đó được **ghi thật xuống VFD/thiết bị
hiện trường** qua FC06. Với một BMS controller, đây là lỗi có hệ quả vật lý.

Tương tự: `setpoint = -5` với Point `uint32` → `static_cast<uint32_t>(-5.0f)` UB.
`setpoint = NaN` (ví dụ chia 0 trong graph) → UB ở mọi nhánh integral.

**Sửa:** kiểm `std::isfinite(raw)` và kiểm `raw` nằm trong dải của kiểu đích
**trước** khi ép; trả `false` để `flush_pending` bỏ request và báo lỗi.

### D-02 · P0 · `scale = 0` ghi im lặng giá trị 0 xuống thiết bị

[register_codec.cpp:93](../../../apps/iobus/adapters/modbus_rtu/register_codec.cpp#L93)

```cpp
const float raw = (scale != 0.0f) ? (eng_value - offset) / scale : 0.0f;
```

Khi `scale == 0`, hàm **không** trả `false` mà tính `raw = 0` rồi `return true`.
Kết quả: ghi giá trị `0` xuống coil/holding register và báo thành công.

BE có chặn `scale == 0` ([domain.go:240-242](../../../apps/web-api/internal/modbusrtu/domain.go#L240-L242)),
nhưng `load_device_profile` **không** kiểm tra `scale`
([device_profile.cpp:175](../../../apps/iobus/adapters/modbus_rtu/device_profile.cpp#L175) chỉ đọc giá trị).
Một profile viết tay trong `/data/config/profiles/` — đường dẫn được hỗ trợ chính
thức theo `find_profile_path()` — sẽ đi lọt.

**Sửa:** `if (scale == 0.0f || !std::isfinite(scale)) return false;` và thêm luật
`scale != 0` vào validator của `load_device_profile`.

### D-03 · P0 · Write thất bại được phát lại vô hạn, không có kết quả trả về

[modbus_master.cpp:439-443](../../../apps/iobus/adapters/modbus_rtu/modbus_master.cpp#L439-L443)

```cpp
if (rc < 0) {
    std::fprintf(stderr, "WARN  modbus.write_fail ...");
    continue;  /* retain request for the next due poll */
}
```

Request **không** được đánh `submitted` nên ở lại `pending_writes_` và được thử
lại ở **mọi** vòng poll kế tiếp, vô thời hạn, không giới hạn số lần, không có
đường báo lỗi ngược lên core/BE/UI.

**Kịch bản hỏng:** kỹ thuật viên đặt setpoint 50 Hz cho VFD lúc 09:00; thiết bị
đang mất điện nên write fail. Request nằm lại hàng đợi. 14:00 thiết bị được cấp
điện lại → iobus **lập tức ghi 50 Hz** dù ngữ cảnh vận hành đã hoàn toàn khác và
không ai ra lệnh lại. Đây đúng là hành vi "blind replay after reconnect" mà thiết
kế cấm, và nó đang tồn tại trong source.

**Sửa tối thiểu (không cần contract v2):** thêm bộ đếm attempt và deadline cho
`PendingWrite`; hết attempt/deadline thì bỏ request, log ERROR và đánh dấu để
diagnostics đọc được.

### D-04 · P1 · Thiết bị lỗi làm bão hoà bus và bỏ đói thiết bị tốt

`on_poll_error()` **không** cập nhật `last_poll_ms`
([poll_scheduler.cpp:23-35](../../../apps/iobus/adapters/modbus_rtu/poll_scheduler.cpp#L23-L35)),
và `read_slave` chỉ set `last_poll_ms` ở nhánh `slave_config_error_`
([modbus_master.cpp:275](../../../apps/iobus/adapters/modbus_rtu/modbus_master.cpp#L275)).
Comment ở dòng 271-274 nói đây là chủ ý ("lỗi comm thật được retry nhanh, bị chặn
bởi timeout 300 ms của libmodbus").

Hệ quả thực tế: một slave chết luôn `is_due() == true`, nên mỗi vòng `poll_once`
đều gọi `read_slave` cho nó và **chiếm dây suốt `timeout_ms`**. Với 8 slave chết ở
`timeout_ms=300`, mỗi vòng poll tiêu 2,4 giây chỉ để chờ timeout; slave tốt có
`poll_ms=1000` sẽ trượt deadline liên tục. Đây không phải "thiếu tính năng probe
chậm" mà là **cơ chế bỏ đói đang hoạt động**.

Thêm nữa `poll_once` duyệt slave theo **thứ tự index**
([modbus_master.cpp:476-480](../../../apps/iobus/adapters/modbus_rtu/modbus_master.cpp#L476-L480)),
không theo deadline. Slave index thấp luôn được ưu tiên.

**Sửa tối thiểu:** cập nhật `last_poll_ms` cả ở đường lỗi, và khi `online == false`
dùng `offline_probe_ms` thay cho `poll_interval_ms`.

### D-05 · P1 · Tham số "Retry" trên UI không tạo ra một lần thử lại nào

Trong `read_slave`, khi `rc < 0` code **`break`** ra khỏi vòng point và kết thúc
lượt poll ([modbus_master.cpp:333-353](../../../apps/iobus/adapters/modbus_rtu/modbus_master.cpp#L333-L353)).
Không có chỗ nào phát lại chính block vừa lỗi, và libmodbus không tự retry.

Trong khi đó FE hiển thị ô nhập **"Retry"**
(`ModbusRtuPage.tsx:80`)
và BE validate `retry` trong `1..10` với thông điệp "retry phải trong 1..10"
([domain.go:176-178](../../../apps/web-api/internal/modbusrtu/domain.go#L176-L178)).
Thực tế `retry` chỉ là **ngưỡng số lỗi liên tiếp trước khi chuyển OFFLINE** —
đúng như comment trong [fieldbus_config.hpp:21](../../../apps/iobus/adapters/modbus_rtu/fieldbus_config.hpp#L21),
nhưng **trái với nhãn UI**.

Người vận hành đặt `retry=3` tin rằng hệ thống thử lại 3 lần trên nhiễu thoáng
qua; thực tế mỗi lỗi đơn lẻ đều làm Point rơi STALE ngay lượt đó.

**Sửa:** hoặc implement retry thật trong `read_slave`, hoặc đổi nhãn UI/API thành
`offline_after_errors`. Không được giữ nguyên cả hai.

### D-06 · P1 · Cột "Retry" và cột "Lỗi" trong diagnostics luôn bằng nhau

[fieldbus_metrics.cpp:26-31](../../../apps/iobus/adapters/modbus_rtu/fieldbus_metrics.cpp#L26-L31)

```cpp
if (!ok) {
    m.total_errors++;
    m.retry_attempts++;      // luôn tăng cùng total_errors
```

`retry_attempts` được tăng đúng một lần cho mỗi lỗi, tức luôn `== total_errors`.
FE hiển thị hai cột riêng "Poll / lỗi" và "Retry"
(`ModbusRtuPage.tsx:113`),
nên bảng chẩn đoán có hai cột không bao giờ khác nhau — vô dụng cho việc khoanh
vùng lỗi, và gây hiểu nhầm rằng hệ thống đang retry (xem D-05).

### D-07 · P1 · FE tự suy diễn quality và mặc định `BAD` khi thiếu dữ liệu

`ModbusRtuPage.tsx:113`

```tsx
{row.online ? 'GOOD' : row.consecutive_errors ? 'OFFLINE' : 'STALE'}
```

Hai lỗi trong một biểu thức:

1. Quality được **bịa ở tầng trình bày** từ hai cờ diagnostics, không lấy từ
   authority. Một thiết bị `online=true` nhưng Point đang `DECODE_ERROR` vẫn hiện
   `GOOD`.
2. Thiết bị **chưa từng được poll** có `online=false, consecutive_errors=0` → hiện
   **`STALE`**, tức "dữ liệu cũ", trong khi sự thật là "chưa có dữ liệu nào".

Và ở bảng Point (`ModbusRtuPage.tsx:108`):

```tsx
{(runtimeQuality[row.point_id] ?? 'bad').toUpperCase()}
```

Khi `/points` lỗi hoặc chưa nạp, `runtimeQuality` rỗng và **mọi Point hiện `BAD`** —
báo hỏng thiết bị trong khi thực tế chỉ là FE chưa lấy được dữ liệu. Với màn hình
vận hành, báo động giả kiểu này làm mất niềm tin vào toàn bộ bảng.

**Sửa:** thiếu dữ liệu ⇒ `—`; quality luôn lấy từ API.

### D-08 · P1 · Xoá Device/Point không có xác nhận

`ModbusRtuPage.tsx:84, 108`

```tsx
<button onClick={async () => { await apiClient.deleteModbusDevice(row.device_id); ... }}>Xoá</button>
```

Một cú nhấp nhầm xoá thiết bị và **kích apply + restart `mkddc-iobus`** ngay lập
tức (xem D-09). Không có dialog, không có undo.

### D-09 · P1 · Mỗi thao tác CRUD restart service điều khiển hiện trường

`mutateModbusConfig` → `applyModbusConfig` → `dispatchReload(reloadRestartIobus)`
→ `systemctl restart mkddc-iobus.service`
([modbus_rtu.go:203, 273](../../../apps/web-api/internal/app/modbus_rtu.go#L203),
[reloadhelper_linux.go:43](../../../apps/web-api/internal/app/reloadhelper_linux.go#L43)).

Nghĩa là: sửa một chữ trong tên hiển thị của một Point cũng **restart toàn bộ
`mkddc-iobus`**, tức dừng luôn IOP/BACnet/Modbus TCP trong thời gian restart. Khi
kỹ thuật viên nhập 20 Point, đó là 20 lần restart.

Đây vừa là GAP thiết kế (đã ghi F-BE-01/F-BE-02) vừa là **rủi ro vận hành hiện
hữu**, nên được nhắc lại ở đây với mức P1.

### D-10 · P2 · Point chưa từng đọc được publish là `STALE` với giá trị 0

Khối cấp danh tính gọi `set_point(..., 0.0f, KX_Q_UNCERTAIN, sc.addr, /*online=*/true, ...)`
([modbus_master.cpp:306-307](../../../apps/iobus/adapters/modbus_rtu/modbus_master.cpp#L306-L307)).
`online=1 + quality=UNCERTAIN` được BE map thành `STALE`
([core_client.go:835-840](../../../apps/web-api/internal/app/core_client.go#L835-L840)),
nên trước lần đọc thành công đầu tiên, UI hiện giá trị **0 với nhãn STALE** thay
vì "chưa khởi tạo". Với Point nhiệt độ, `0` là một giá trị hợp lý về mặt vật lý —
người dùng không có cách nào biết đó là số bịa.

### D-11 · P2 · `push_snapshot` tự tính offset header thay vì dùng `offsetof`

[ext_cache.cpp:82-84](../../../apps/iobus/adapters/modbus_rtu/ext_cache.cpp#L82-L84)

```cpp
const ssize_t total = sizeof(uint32_t) + sizeof(uint16_t) + sizeof(uint16_t)
                    + count_ * sizeof(kx_ext_point_t);
```

Hiện đúng vì header 8 byte không sinh padding trước `points[]`. Nhưng đây là một
giả định layout **được viết lại bằng tay**, đúng loại lỗi mà F-17 đã từng gây ra.
Thêm một field vào header sẽ làm receiver đọc lệch mà không có test nào bắt được.
Dùng `offsetof(kx_ext_snapshot_msg_t, points)` và thêm `static_assert`.

### D-12 · P2 · Alarm E303 latch vĩnh viễn

`check_e303` đặt `e303_triggered = true` một lần và chỉ được xoá trong
`reset_alarms`, mà `reset_alarms` **chỉ** được gọi khi `e302_triggered` đang bật
([modbus_master.cpp:396-398](../../../apps/iobus/adapters/modbus_rtu/modbus_master.cpp#L396-L398)).
Một slave có tỷ lệ lỗi > 10% nhưng chưa bao giờ OFFLINE sẽ latch E303 mãi mãi và
không bao giờ báo lại. Ngoài ra `error_rate` là tích luỹ từ lúc khởi động nên sau
một giai đoạn nhiễu, tỷ lệ vẫn > 10% rất lâu sau khi bus đã tốt trở lại.

### D-13 · P1 · Không thiết lập chế độ RS-485 cho cổng serial

`ModbusMaster::open()` gọi `modbus_new_rtu()` rồi `modbus_connect()`
([modbus_master.cpp:53-72](../../../apps/iobus/adapters/modbus_rtu/modbus_master.cpp#L53-L72))
nhưng **không gọi** `modbus_rtu_set_serial_mode(ctx, MODBUS_RTU_RS485)` ở bất kỳ đâu.

Khảo sát trên board production ngày 2026-08-04
([evidence](../test-evidence/fw-som/2026-08-04-foxlinx-uart-rs485-survey.md)) cũng
cho thấy **không có thuộc tính `rs485-*` nào trong device tree**. Nghĩa là điều
khiển hướng truyền half-duplex chưa được thiết lập ở cả tầng kernel lẫn tầng ứng dụng.

Source đang ngầm giả định transceiver có mạch auto-direction. Nếu giả định sai,
frame sẽ bị cắt và giao tiếp không bao giờ ổn định — và điều này **chỉ lộ ra khi
đấu dây thật**, tức ở giai đoạn nghiệm thu cuối, nơi sửa đắt nhất.

**Đề xuất:** xác nhận cơ chế với phần cứng (`OD-MBRTU`/Q-10) trước khi vào Track B;
nếu là RTS-controlled thì phải bật DT và gọi `modbus_rtu_set_serial_mode()`.

### D-14 · P2 · FE mặc định cổng `/dev/ttyS3` không tồn tại trên board production

`ModbusRtuPage.tsx:6`

```tsx
const emptyDevice: ModbusRTUDevice = { ..., rs485_port: '/dev/ttyS3', ... }
```

Board production chỉ có `/dev/ttyS2` (MCU) và `/dev/ttyS5`. Người dùng thêm thiết
bị mới sẽ nhận giá trị mặc định **không dùng được**, và BE chỉ validate độ dài
chuỗi ≤128 nên vẫn lưu thành công. Lỗi chỉ lộ ở tầng iobus khi mở cổng thất bại.

**Đề xuất:** bỏ giá trị mặc định, buộc chọn từ danh sách cổng hợp lệ do server cấp.

## 3. Test coverage

| Khu vực | Hiện có | Thiếu |
|---|---|---|
| Codec đọc | 8 test, phủ 4 word/byte order + scale/offset + count thiếu | giá trị `uint32 > 2^24`, biên int16/int32 |
| Codec ghi | round-trip 2 test | **ngoài dải, NaN/Inf, `scale=0`** (D-01, D-02) |
| Scheduler | 6 test | hành vi khi slave lỗi liên tục (D-04), thứ tự công bằng |
| Ext cache | 8 test | count không co lại, snapshot size |
| Slot accounting | 6 test | — (phủ tốt) |
| ModbusMaster | 5 test, đều là đường "chưa mở/không có slave" | **toàn bộ đường ghi**: `flush_pending` thành công/thất bại/replay (D-03) |
| Metrics | 0 test | `retry_attempts` semantics (D-06), E303 latch (D-12) |
| BE | 5 test: CRUD, rename giữ ID, tag collision, rollback | idempotency, concurrency, RBAC âm tính, `scale=0` từ profile |
| FE | **2 test** | quality khi thiếu runtime (D-07), xác nhận xoá (D-08), lỗi server theo field |

Nhận xét: test tập trung vào **hàm thuần dễ test** (codec, slot accounting) và bỏ
trống **đường ghi xuống thiết bị** — đúng chỗ rủi ro nhất. Cả 5 test của
`ModbusMaster` đều chạy ở trạng thái chưa mở kết nối, nên không test hành vi thật.

## 4. Review tài liệu thiết kế (bộ tạo 2026-08-04)

**Đạt:** 12 tài liệu phủ đủ chuỗi Product → UI/UX → FE/BE/FW → Interface →
Verification → Traceability; có interface matrix 16 dòng; có bảng ánh xạ tên field
4 lớp; mọi con số chưa đo đều ghi `PROPOSED`; 3 tài liệu cũ mâu thuẫn đã đánh
SUPERSEDED một phần với danh sách phát biểu cụ thể.

**Ba điểm cần chỉnh khi đưa ra review:**

| # | Vấn đề | Đề xuất |
|---|---|---|
| R-01 | Tài liệu ghi các defect ở §2 dưới dạng "gap thiết kế" (F-FW-07, F-FW-08), làm chúng trông như "chờ redesign". Thực tế D-01/D-02/D-03 là lỗi có thể sửa ngay mà không cần đổi contract. | Tách bảng "defect sửa ngay" khỏi bảng "gap chờ ADR-024" trong Docs Sync Report §6 |
| R-02 | `DDD-FW-MBRTU-001 §11` đề xuất ngân sách CPU ≤5% và RAM ≤2 MiB nhưng không nêu phương pháp đo, trong khi `NFR-REQ-MBRTU-004` yêu cầu "kiểm chứng". | Bổ sung phương pháp đo cụ thể (`systemd-cgtop`, cửa sổ đo, tải chuẩn) vào `VVP-MBRTU-001 §5` |
| R-03 | `DDD-DM-MBRTU-001 §5.3` cho phép `poll_interval_ms` riêng theo Point, nhưng scheduler ở `DDD-FW-MBRTU-001 §4` chỉ lập lịch theo **device**. Hai tài liệu không khớp. | Hoặc bỏ `poll_interval_ms` khỏi Point ở Rev A, hoặc mô tả cách scheduler gom Point khác chu kỳ trên cùng device |

R-03 là mâu thuẫn nội bộ **trong chính bộ tài liệu mới** — cần đóng trước khi
chuyển sang `Active`.

## 5. Bảo mật

- Không tìm thấy endpoint raw arbitrary-function-code. Đúng yêu cầu.
- Không có secret trong config/profile/export.
- RBAC ở tầng route đúng (`viewer` đọc, `admin` ghi), nhưng FE khoá cả trang ở
  `admin` ([roles.ts:56](../../../apps/web-ui/src/features/auth/roles.ts#L56)) làm Viewer
  không giám sát được — trái `PR-MBRTU-001`.
- `rs485_port` là chuỗi tự do chỉ kiểm độ dài ≤128
  ([domain.go:150-152](../../../apps/web-api/internal/modbusrtu/domain.go#L150-L152)). Giá
  trị này đi thẳng vào `modbus_new_rtu(path)`. Không phải command injection
  (không qua shell), nhưng cho phép admin trỏ vào **bất kỳ device node nào** của
  hệ thống, ví dụ `/dev/ttyS2` đang dùng cho IOP. Cần allowlist theo capability
  manifest.
- Audit chỉ ghi `(user, "config.modbus-rtu", file, "success", addr)`
  ([modbus_rtu.go:282](../../../apps/web-api/internal/app/modbus_rtu.go#L282)) — không có
  target Point/Device, không có giá trị cũ/mới. Không đủ để truy vết theo
  `SEC-REQ-MBRTU-001`.

## 6. Hiệu năng

- Modbus chạy priority thường, không chia mutex với `iop_main` — đúng thiết kế,
  giữ nguyên.
- Rủi ro hiệu năng thật nằm ở D-04 (bão hoà bus vì slave chết) chứ không ở thuật
  toán codec.
- `pending_writes_` có coalesce theo `(slave, fc, addr)` nên bị chặn trên bởi số
  register ghi được ≤ 64 — không có rò rỉ hàng đợi.
- `poll_once` copy toàn bộ `kx_plc_shm_t` mỗi lần `drain_ext_writes`
  ([modbus_master.cpp:182](../../../apps/iobus/adapters/modbus_rtu/modbus_master.cpp#L182)),
  ~9 KB mỗi vòng. Chấp nhận được ở chu kỳ hiện tại, cần đo lại nếu hạ chu kỳ.

## 7. Xếp hạng ưu tiên đề xuất

| Ưu tiên | Finding | Vì sao |
|---|---|---|
| **Sửa ngay, không chờ quyết định** | D-01, D-02, D-03 | ghi giá trị sai/UB xuống thiết bị hiện trường |
| **Sửa ngay** | D-07, D-08 | báo động giả và mất dữ liệu do thao tác nhầm |
| **Sprint kế** | D-04, D-05, D-06, D-12, D-14 | sai hành vi vận hành và chẩn đoán sai |
| **Chặn nghiệm thu — cần phần cứng trả lời** | D-13 | phát hiện muộn thì rất đắt |
| **Theo redesign** | D-09, D-10, D-11 | gắn với contract v2 và transaction apply |

Kế hoạch thực thi chi tiết: [Plan 49](../../03_implementation/49_MODBUS_RTU_IMPLEMENTATION_PLAN.md).
Bằng chứng phần cứng: [khảo sát UART board production](../test-evidence/fw-som/2026-08-04-foxlinx-uart-rs485-survey.md).

## Revision history

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-04 | Review source + docs Modbus RTU; 12 defect, 3 finding tài liệu |
| 1.1 | 2026-08-04 | Thêm D-13 (không set RS-485 mode) và D-14 (mặc định `/dev/ttyS3` không tồn tại) sau khảo sát board production Foxlinx |
