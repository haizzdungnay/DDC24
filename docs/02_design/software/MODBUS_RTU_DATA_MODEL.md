# Modbus RTU — Data Model DDC-24 Rev A

**ID:** DDD-DM-MBRTU-001
**Phiên bản:** 0.2
**Trạng thái:** Active (Phê duyệt 2026-08-05 theo Tờ trình `DDC24-MBRTU-REQ-APPROVE-2026-08-05`)
**Ngày:** 2026-08-05
**Design authority chủ quản:** [DDD-SW-MBRTU-POINT-001](DDC24_MODBUS_RTU_POINT_DETAILED_DESIGN.md)
**Quyết định đã ký áp dụng:** Đ-01 (1 bus Rev A), Đ-05 (ngữ nghĩa retry), Đ-07 (≥256 Point)
**Trace:** `SWR-REQ-MBRTU-001..003`, `SWR-REQ-MBRTU-007..008`, `IF-REQ-MBRTU-001`, `IF-REQ-MBRTU-004`

> Tài liệu này là **mô hình dữ liệu canonical duy nhất** cho Modbus RTU. FE, BE
> và FW-SOM không được định nghĩa mô hình Point riêng. Khi nội dung ở đây khác
> với source hiện tại, đó là **gap thiết kế**, không phải mô tả As-Built; gap
> được liệt kê ở §9.

## 1. Ba entity và quan hệ

```text
ModbusRTUBus                            — resource phần cứng của thiết bị
  │   02 bus instances: bus_id = 1 (/dev/rs485-1 -> ttyS5), bus_id = 2 (/dev/rs485-2 -> ttyS1).
  └─ 1..n ModbusRTUDevice               — một slave trên đúng một bus
       └─ 1..n ModbusRTUPoint           — một điểm luận lý trên device
                └─ 0..1 PointMapping    — ánh xạ vào Point Database DDC-24
```

> **Cấu hình 2 Bus RS485 vật lý:** Cổng 1 (`/dev/rs485-1` → `ttyS5`) và Cổng 2
> (`/dev/rs485-2` → `ttyS1`, UART1 M1 trên Header P16). Mỗi Bus có serial format
> riêng (`baud`, `parity`, `stop_bits`) và `offline_probe_ms` riêng — người dùng
> cấu hình **từng cổng độc lập** ở trang Cổng RS-485, và Device **kế thừa
> read-only** từ cổng nó thuộc về. Ràng buộc: validator từ chối `bus_id` không có
> trong capability manifest, và từ chối hai bus trỏ cùng một device node.
>
> Cả hai cổng đều auto-direction (không DE/RE) — xem `direction` ở §3.

Ràng buộc quan hệ:

- `ModbusRTUDevice.bus_id` phải trỏ tới bus tồn tại và enabled khi device enabled.
- Xoá Bus không hợp lệ (bus là resource phần cứng, chỉ enable/disable).
- Xoá Device chỉ hợp lệ khi không còn Point tham chiếu, hoặc khi client xác nhận
  cascade tường minh (mặc định: **từ chối**, khớp As-Built hiện tại).
- Point luôn thuộc đúng một Device; đổi Device của Point là hành vi tạo mới
  mapping và phải validate lại toàn bộ.

## 2. Source of truth

| Dữ liệu | Owner duy nhất | Persistence | Consumer |
|---|---|---|---|
| Bus capability (device node, khả dụng) | platform/deployment manifest | file manifest read-only | `mkddc-web`, `mkddc-iobus` |
| Bus/Device/Point **cấu hình**, revision, checksum | `mkddc-web` | `fieldbus.conf` + profile JSON dưới `ConfigDir` | FE, `mkddc-iobus` |
| Runtime `value`, `quality`, `quality_reason`, `timestamp`, counters | `mkddc-iobus` | không persist (volatile) | `mkddc-core` |
| Point Table canonical và command arbitration | `mkddc-core` | volatile + PLC SHM | `mkddc-web`, BACnet |
| Mapping tag ↔ Point ID toàn hệ | `mkddc-web` | cùng file cấu hình group tương ứng | FE, core |
| Presentation state (bộ lọc, cột, sắp xếp) | FE | `localStorage` **chỉ cho preference** | người dùng |

**Cấm tuyệt đối:** `localStorage` không được là authority cho bất kỳ field nào
trong §3–§5. FE không được suy diễn `quality` từ `online` hoặc `consecutive_errors`.

## 3. `MODBUS_RTU_BUS`

Tên field dưới đây là tên **trên API và trong `fieldbus.conf`** — cùng một bộ
tên, không dịch qua lại. Định dạng file là [CONFIG_SCHEMA §5b](../interfaces/CONFIG_SCHEMA_MK-DDC-24_VI.md#5b-fieldbusconf--rs-485-modbus-rtu-master-thiết-bị-phụ),
và §5b là nguồn chuẩn khi có bất đồng.

| Field | Kiểu | Bắt buộc | Default | Validation |
|---|---|---|---|---|
| `bus_id` | enum `rs485-1` \| `rs485-2` | có | `rs485-1` | bất biến, do hệ thống định nghĩa; không phải `/dev/tty*`. Ngoài capability manifest ⇒ `VALIDATION_FAILED`, không im lặng chấp nhận. Cụm số cuối là số hiệu mà `slaves[].bus_id` tham chiếu |
| `display_name` | string ≤32 | không | viết hoa `bus_id` | hiển thị |
| `enabled` | bool | không | `true` | bus disabled thì mọi device trên bus không được poll. Bên đọc nhận cả `1`/`0`; bên ghi luôn xuất `true`/`false` |
| `port` | enum capability | có | từ manifest | phải nằm trong allowlist capability manifest. Dùng tên ổn định `/dev/rs485-*` (udev), **không** dùng `ttyS*` trực tiếp |
| `baud` | enum 9600/19200/38400/57600/115200 | có | `19200` | chung cho toàn bus |
| `data_bits` | int | không | `8` | **cố định 8**, không cho UI sửa. iobus viết cứng 8 trong `modbus_new_rtu()`; validator từ chối giá trị khác |
| `parity` | enum `N`/`E`/`O` | không | `N` | chung cho toàn bus |
| `stop_bits` | enum 1/2 | không | `1` | `N` nên đi với `2`; cảnh báo nếu `N`+`1` |
| `offline_probe_ms` | int 1000..60000 | không | `5000` | chu kỳ thử lại device OFFLINE. **As-Built ✅**, đóng D-04 |
| `direction` | enum `auto` \| `rts` | không | `auto` | **`G-D` CLOSED 2026-08-06** — Hardware owner xác nhận cổng RS-485 chỉ có TX/RX, **không có DE/RE** ⇒ transceiver tự đảo hướng. `BusWorker::apply_direction_mode()` tắt tường minh `SER_RS485_ENABLED` ở chế độ auto rồi đọc lại driver và ghi log. Chỉ đặt `rts` nếu bo thật sự nối DE/RE vào RTS |
| `rts_delay_before_us` / `rts_delay_after_us` | int 0..100000 | không | `0` | chỉ có tác dụng khi `direction: "rts"` |
| `open_state` | enum runtime | runtime | — | read-only, từ iobus |
| `last_error` | string ≤128 | runtime | `null` | read-only |

**Hệ thống có đúng hai instance Bus: `rs485-1` và `rs485-2`.** Luật "hai bus
không được map tới cùng device node" là luật thật và **có thể bị vi phạm** với
hai cổng, nên validator phải cưỡng chế nó. USB-RS485 chỉ hợp lệ trong lab profile
có provenance riêng và phải bị từ chối ở production profile.

> **Đính chính 2026-08-06.** Bản trước ghi *"Rev A chỉ nhận `rs485-1`"* và *"Rev
> A có đúng một instance Bus (Đ-01)"*, mâu thuẫn với chính §1 của tài liệu này
> (đã ghi 2 bus). Sản phẩm có **2 cổng RS-485**; `Đ-01` bị thay thế bởi
> `OD-MBRTU-001` (CLOSED 2026-08-05). Ba tên field cũng được đưa về đúng thứ
> đang chạy trên dây và trên API: `label` → `display_name`, `port_ref` → `port`,
> `baud_rate` → `baud`, `direction_control` → `direction`.
>
> `inter_frame_policy` bị **bỏ khỏi Rev A**: libmodbus tự áp khoảng lặng 3.5 ký
> tự theo baud, và ta không có đường đo để chứng minh một giá trị `fixed_ms` do
> người dùng đặt là đúng. Giữ một nút bấm không kiểm chứng được thì tệ hơn không
> có nút.
>
> `direction_control: gpio` cũng bị bỏ: phần cứng không có DE/RE nên không tồn
> tại chân GPIO nào để điều khiển.

## 4. `MODBUS_RTU_DEVICE`

| Field | Kiểu | Bắt buộc | Default | Validation |
|---|---|---|---|---|
| `device_id` | string 1..23 ASCII | có | server-generated | bất biến; `^[A-Za-z][A-Za-z0-9_-]{0,22}$`; unique toàn hệ (so sánh case-insensitive) |
| `name` (`display_name`) | UTF-8 1..64 | có | — | NFC normalize; không cho chuỗi rỗng sau trim |
| `enabled` | bool | có | `true` | device disabled không được scheduler nhận |
| `rs485_port` (`bus_id`) | enum `rs485-1` \| `rs485-2` | có | `rs485-1` | phải là bus tồn tại trong capability manifest |
| `slave_id` | int 1..247 | có | — | **unique trong cùng bus**; trùng ở hai bus khác nhau là **hợp lệ** và phải được chấp nhận. Với hai cổng, luật này có hiệu lực thật — validator kiểm theo `(bus_id, slave_id)`, không phải toàn cục (`F-BE-08` đã đóng) |
| `baud` | enum | dẫn xuất | kế thừa Bus | **read-only**; ghi khác giá trị Bus → `VALIDATION_FAILED`. Giao diện Thiết bị **không được** cho sửa — xem ghi chú dưới bảng |
| `data_bits` | int | dẫn xuất | `8` | read-only |
| `parity` | enum | dẫn xuất | kế thừa Bus | read-only |
| `stop_bits` | int | dẫn xuất | kế thừa Bus | read-only |
| `poll_interval_ms` | int 100..60000 | có | `1000` | deadline poll khi ONLINE |
| `timeout_ms` | int 20..5000 | có | `300` | timeout **mỗi lần phát**, không phải mỗi lượt poll |
| `retry_count` | int 0..3 | có | `2` | **số lần PHÁT LẠI một giao dịch Modbus bị lỗi** trong cùng lượt poll (Đ-05). `0` là giá trị hợp lệ và có nghĩa: "không phát lại, báo lỗi ngay". Validator **không được** âm thầm đổi `0` thành `2`. Chi phí xấu nhất một lượt poll = `(1 + retry_count) × timeout_ms` |
| `offline_after_errors` | int 1..10 | có | `2` | **số LƯỢT POLL thất bại liên tiếp** trước khi chuyển OFFLINE. Tách hẳn khỏi `retry_count` (Đ-05); mỗi lượt đã bao gồm đủ số lần phát lại |
| `coil_write_batch_max` | int 0..16 | không | `0` | U-07 (`REC-DDC-FIELD-USE-20260927`): số coil tối đa gom vào **một** FC15. `0`/`1` = tắt (mỗi coil một giao dịch như trước); `2..16` = các coil liền kề đổi cùng lúc lên dây thành một khung. Ngoài dải ⇒ `OUT_OF_RANGE`, không kẹp lặng. BE ghi `max_coils_per_write` vào profile chỉ khi > 1, nên thiết bị chưa bật giữ profile cũ từng byte. Chỉ bật khi thiết bị hỗ trợ FC15 |
| `stale_after_ms` | int | có | `poll×3` | phải `≥ poll_interval_ms + timeout_ms` |
| `offline_after_ms` | int | có | `poll×6` | phải `> stale_after_ms` |
| `verify_write` | bool | không | `true` | readback sau write khi register đọc được |
| `connection_status` | enum §6.1 | runtime | `DISABLED` | read-only |
| `last_success_at` | UTC ms | runtime | `null` | read-only; `null` = chưa từng thành công |
| `last_error` | `{code, message, at}` | runtime | `null` | read-only |
| `config_revision` | uint64 | runtime | — | revision cấu hình mà device đang chạy theo |

**Sai khác có chủ ý so với đề bài:** `baud_rate`/`data_bits`/`parity`/`stop_bits`
được đặt ở Bus và **kế thừa xuống Device** thay vì lưu độc lập trên Device. Lý do:
một dây RS-485 vật lý chỉ có một cấu hình khung; cho phép hai device cùng bus khai
báo khác nhau tạo cấu hình không thể thực thi. Đề bài liệt kê chúng ở Device nên
API vẫn **trả về** các field này trên Device (dạng dẫn xuất, read-only) để UI hiển
thị nguyên vẹn. `OD-MBRTU-002` **CLOSED** — Bus là entity, Device kế thừa.

> **Trả về ≠ cho sửa.** Từ 2026-08-06 điều này được phát biểu thành ràng buộc
> giao diện, vì bản triển khai trước đã hiểu sai đúng chỗ này: form "Thêm thiết
> bị mới" có **ô nhập** baud, parity và stop bit cho từng thiết bị. Tức là mô
> hình dữ liệu nói tham số serial thuộc về dây, validator cưỡng chế điều đó, còn
> giao diện thì vẫn mời người dùng nhập chúng ở thiết bị rồi từ chối sau khi họ
> bấm lưu.
>
> Bắt buộc:
>
> - Trang **Thiết bị** hiển thị `baud`/`parity`/`stop_bits`/`data_bits` ở dạng
>   **chỉ đọc**, kèm chỉ dẫn tới cổng đang chi phối chúng.
> - Trang **Cổng RS-485** là nơi duy nhất sửa được các tham số đó, và sửa **độc
>   lập từng cổng**.
> - Thay đổi tham số của một cổng ảnh hưởng **mọi** thiết bị trên cổng đó; giao
>   diện phải nói rõ điều này trước khi áp.

## 5. `MODBUS_RTU_POINT`

### 5.1 Identity và metadata

| Field | Kiểu | Bắt buộc | Default | Validation |
|---|---|---|---|---|
| `point_id` | string 1..23 ASCII | có | server-generated | **bất biến**; rename/reorder/import không đổi; API từ chối payload đổi ID |
| `device_id` | string | có | — | phải trỏ Device tồn tại |
| `tag_name` | UTF-8 | có | — | NFC + case-fold; **unique toàn namespace** Local I/O + Virtual + Modbus RTU |
| `display_name` | UTF-8 1..64 | có | — | NFC normalize |
| `unit` | string ≤16 | không | `""` | metadata engineering |
| `enabled` | bool | có | `true` | point disabled không sinh ext slot và không poll |

### 5.2 Địa chỉ register

| Field | Kiểu | Bắt buộc | Default | Validation |
|---|---|---|---|---|
| `register_type` | enum `coil`/`discrete_input`/`input_register`/`holding_register` | có | `holding_register` | |
| `register_address` | int 0..65535 | có | `0` | **protocol data address zero-based** |
| `bit_index` | int 0..15 | không | `null` | chỉ hợp lệ khi `register_type ∈ {input_register, holding_register}` và `data_type = bool`; trích một bit trong word |
| `data_type` | enum `bool`/`int16`/`uint16`/`int32`/`uint32`/`float32` | có | `uint16` | Coil/Discrete Input bắt buộc `bool` |
| `byte_order` | enum `big`/`little` | có | `big` | không áp dụng cho `bool` không có `bit_index` |
| `word_order` | enum `high_low`/`low_high` | có | `high_low` | chỉ có nghĩa với kiểu 32-bit |
| `access_mode` (`read_write`) | enum `read`/`read_write` | có | `read` | `read_write` chỉ hợp lệ với `coil`/`holding_register` |

UI được phép hiển thị reference `0xxxx/1xxxx/3xxxx/4xxxx` nhưng persistence và API
**luôn** dùng zero-based; nhãn convention phải hiện cạnh field (`IF-REQ-MBRTU-004`).

`bit_index` là **mở rộng mới** so với As-Built và so với DDD-SW-MBRTU-POINT-001;
nó tạo thêm luật overlap (§5.5). Quyết định cần duyệt: `OD-MBRTU-003`.

### 5.3 Engineering

| Field | Kiểu | Bắt buộc | Default | Validation |
|---|---|---|---|---|
| `scale` | float | có | `1.0` | finite, **khác 0** |
| `offset` | float | có | `0.0` | finite |
| `min_value` | float | không | `null` | finite; nếu có cả hai thì `min < max` |
| `max_value` | float | không | `null` | finite |
| `default_value` | cùng `data_type` | không | `0` | chỉ dùng khi chưa có sample; quality vẫn `BAD` |
| `safe_value` | cùng `data_type` | không | `null` | **chỉ là policy input cho core**; fieldbus không tự ghi |
| `poll_interval_ms` | int | không | `null` = kế thừa Device | nếu có: bội số hợp lệ và không nhỏ hơn `poll_interval_ms` của Device |

Công thức: đọc `engineering = raw × scale + offset`; ghi
`raw = (engineering − offset) / scale`, kiểm range **trước** khi encode.
`min_value`/`max_value` áp dụng cho **engineering value** và là điều kiện chặn
write; vi phạm khi đọc chuyển quality `BAD` với reason `OUT_OF_RANGE`.

**Luật fail-closed khi encode (bắt buộc, đã có trong As-Built).** `encode_register`
phải trả `false` và **không ghi byte nào** vào buffer khi bất kỳ điều kiện nào đúng:
`count` không đủ cho kiểu · `scale == 0` hoặc không hữu hạn · `eng_value` hoặc `raw`
là NaN/±Inf · `raw` ngoài dải biểu diễn được của kiểu đích.

> Vì sao luật này ở tầng data model chứ không chỉ ở FW: `static_cast<int16_t>(raw)`
> với `raw` là float ngoài dải int16 là **undefined behavior** theo [conv.fpint]/1.
> Đường vào thực tế là `plc_shm.ext[i].setpoint` do node graph ghi và **không có
> clamp ở bất kỳ tầng nào phía trên**, nên một lỗi công thức trong logic điều khiển
> sẽ ghi giá trị rác xuống VFD thật qua FC06/FC16. Trước bản sửa 2026-08-04,
> `scale = 0` còn khiến hàm tính `raw = 0` rồi trả `true` — tức **ghi im lặng giá
> trị 0 xuống thiết bị hiện trường**.
>
> **As-Built ✅** — `register_codec.cpp`/`.hpp` (D-01, D-02 đóng, commit `1e3e2bc`),
> `device_profile.cpp` từ chối point có `scale` không hợp lệ.

### 5.4 Runtime (read-only, không persist)

| Field | Kiểu | Nguồn | Ghi chú |
|---|---|---|---|
| `value` | typed theo `data_type` | iobus → core | engineering value sau scale/offset |
| `raw_value` | int/uint | iobus | tuỳ chọn, phục vụ commissioning |
| `quality` | enum §6.2 | iobus | không suy diễn ở FE/BE |
| `quality_reason` | enum §6.3 | iobus | |
| `timestamp` | UTC ms + monotonic ns | iobus | thời điểm **sample thành công**; không đổi khi chỉ quality xấu đi |
| `communication_status` | enum §6.1 | dẫn xuất từ Device | hiển thị cạnh Point |
| `last_write` | `{request_id, value, result, at}` | iobus/core | phục vụ commissioning và audit |

### 5.5 Luật overlap và tương thích

Trong cùng `(device_id, register_type)`, **vùng register của hai Point enabled
không được chồng nhau**, trừ trường hợp `bit_index` hợp lệ:

| Trường hợp | Kết luận |
|---|---|
| Hai Point 16-bit cùng address | REJECT `ADDRESS_OVERLAP` |
| Point 32-bit tại `a` và Point bất kỳ tại `a` hoặc `a+1` | REJECT `ADDRESS_OVERLAP` |
| Hai Point `bool` cùng address, khác `bit_index` | HỢP LỆ |
| Hai Point `bool` cùng address, cùng `bit_index` | REJECT `ADDRESS_OVERLAP` |
| Point có `bit_index` và Point 16-bit khác cùng address | REJECT `ADDRESS_OVERLAP` |

Alias có chủ ý (hai Point cùng register khác tag) chỉ được mở sau `OD-MBRTU-004`.

## 6. Enum trạng thái

### 6.1 `connection_status` (Device)

| Giá trị | Ý nghĩa | Chuyển sang |
|---|---|---|
| `DISABLED` | `enabled=false` | `INITIALIZING` khi enable |
| `INITIALIZING` | chờ transaction thành công đầu tiên | `ONLINE`, `CONFIG_ERROR` |
| `ONLINE` | có sample trong `stale_after_ms` | `DEGRADED` |
| `DEGRADED` | quá `stale_after_ms`, chưa quá `offline_after_ms` | `ONLINE`, `OFFLINE` |
| `OFFLINE` | quá `offline_after_ms` hoặc bus down | `ONLINE` sau probe thành công |
| `CONFIG_ERROR` | profile thiếu, codec không hợp lệ, hết capacity, bus không mở được | chỉ thoát khi cấu hình mới apply |

`CONFIG_ERROR` **phải fail-closed**: device ở trạng thái này không được báo ONLINE
và phải kích cảnh báo. Đây là hành vi đã có trong As-Built (`slave_config_error_`).

### 6.2 `quality` (Point) — năm trạng thái

| Giá trị | Điều kiện | Value/timestamp |
|---|---|---|
| `GOOD` | sample decode và range hợp lệ trong `stale_after_ms` | cập nhật cả hai |
| `STALE` | tuổi mẫu ≥ `stale_after_ms`, < `offline_after_ms` | giữ last-known |
| `OFFLINE` | tuổi mẫu ≥ `offline_after_ms` hoặc bus/port down | giữ last-known |
| `BAD` | decode lỗi, non-finite, ngoài `min/max`, exception response | **không publish value mới** |
| `CONFIG_ERROR` | Point/Device không thể thực thi được theo cấu hình hiện tại | không publish value |

`CONFIG_ERROR` được tách khỏi `BAD` theo yêu cầu sản phẩm: người vận hành phải phân
biệt "thiết bị trả dữ liệu sai" với "cấu hình sai nên chưa từng hỏi thiết bị".
As-Built hiện chỉ có ba mức `GOOD/UNCERTAIN/BAD` ở tầng SHM — xem §9 gap G-DM-02.

### 6.3 `quality_reason`

`NOT_INITIALIZED`, `CONFIG_ERROR`, `DECODE_ERROR`, `OUT_OF_RANGE`, `TIMEOUT`,
`CRC_ERROR`, `PORT_DOWN`, `DEVICE_EXCEPTION`, `WRITE_FAILED`, `BUS_OVERLOAD`.

Với `DEVICE_EXCEPTION`, phải mang kèm Modbus exception code gốc (01..0B).

## 7. Persistence, revision và migration

### 7.1 Bố cục file

| File | Nội dung | Ghi chú |
|---|---|---|
| `<ConfigDir>/fieldbus.conf` | bus, device, point, `revision`, `checksum` | authority cấu hình |
| `<ConfigDir>/profiles/<device_id>.json` | profile dẫn xuất cho iobus | **generated**, không sửa tay |
| `<ConfigDir>/fieldbus.candidate.json` | candidate đang soạn | mới; chưa có trong As-Built |
| `<ConfigDir>/fieldbus.lkg.json` | last-known-good | mới; chưa có trong As-Built |
| `<ConfigDir>/fieldbus.journal` | journal transaction apply | mới; chưa có trong As-Built |

Mọi ghi file dùng temp → `fsync(file)` → `rename` → `fsync(dir)`.

### 7.2 Revision và checksum

- `revision` là `uint64` đơn điệu tăng, chỉ tăng khi apply **thành công**.
- `checksum` là SHA-256 của canonical JSON **không chứa field `checksum`**.
- Mọi mutation mang `base_revision`; lệch → `REVISION_CONFLICT` (HTTP 409).
- `operation_id` do client sinh, bảo đảm idempotency trong cửa sổ ≥15 phút.

> **Gap As-Built:** hiện `Persister.Apply` tính checksum trên struct **đã có
> `Checksum` bị gán rỗng** rồi mới marshal, nên checksum phụ thuộc cả field
> `Revision` — đúng ý đồ, nhưng nó được tính **trước** khi tuần tự hoá bản ghi
> cuối cùng và không có canonical form ổn định (thứ tự key map `RS485`/`Slaves`
> do Go map quyết định). Xem gap G-DM-05.

### 7.3 Migration

| Từ | Sang | Chiến lược |
|---|---|---|
| `fieldbus.conf` v1 (không có `devices`/`points`) | v2 | đọc `slaves[]` + profile, sinh `device_id`/`point_id` từ `name`, ghi `revision=1` |
| Point không có `bit_index`/`min_value`/`max_value` | v2 | mặc định `null`; không đổi hành vi |
| Device có `baud/parity/stop` riêng | v2 | lấy giá trị của device enabled đầu tiên làm Bus, các device khác phải khớp; lệch → `CONFIG_ERROR` và ghi migration warning |
| Quality ba mức | năm mức | `UNCERTAIN` → `STALE`; `BAD` giữ nguyên; `CONFIG_ERROR` chỉ sinh từ producer mới |

Migration phải ghi kết quả (`migrated`, `warnings`, `rejected`) vào apply result;
migration thất bại **giữ nguyên** cấu hình cũ.

## 8. Import/export

**Định dạng chuẩn: CSV UTF-8 có BOM tuỳ chọn, dấu phân cách `,`, header bắt buộc.**

Cột theo đúng thứ tự:

```csv
point_id,device_id,tag_name,display_name,register_type,register_address,bit_index,
data_type,byte_order,word_order,access_mode,scale,offset,unit,min_value,max_value,
poll_interval_ms,default_value,safe_value,enabled
```

Quy tắc:

- `point_id` rỗng ⇒ tạo mới, server sinh ID. `point_id` có giá trị ⇒ cập nhật;
  nếu ID không tồn tại thì **reject toàn file**, không tạo ngầm.
- Import là **all-or-nothing** vào candidate, dùng đúng validator của CRUD.
- Giá trị `null` biểu diễn bằng ô rỗng, không dùng chuỗi `"null"`.
- Số thực dùng dấu chấm thập phân, không dùng dấu phân cách hàng nghìn.
- Export bổ sung header comment `# revision=<n> checksum=<sha256> exported_at=<UTC>`
  ở dòng đầu; import bỏ qua mọi dòng bắt đầu bằng `#`.
- File > 1 MiB hoặc vượt capacity Point hiện hành bị từ chối (`CAPACITY_EXCEEDED`).
  Capacity Rev A theo Đ-07 là **≥ 256 Point** (nâng từ 64). As-Built hiện vẫn chặn
  ở 64 (`domain.go`: `len(cfg.Points) > 64` ⇒ "vượt KX_N_EXT=64"); việc nâng phải
  đi cùng đợt đổi `KX_N_EXT` trong contract SHM — xem gap `G-DM-12`.
- Export **không** chứa runtime value/quality/timestamp và không chứa secret.

JSON export (`?format=json`) trả nguyên khối `{bus[], devices[], points[], revision, checksum}`
và là định dạng duy nhất round-trip được cả Bus và Device.

## 9. Gap giữa mô hình này và source hiện tại

**Đối chiếu lại tại `feat/modbus-rtu-track-a` / `eade4e5` (2026-08-05), sau Track A.**
`✅ ĐÓNG` = source đã khớp mô hình và có test. `◐` = đóng một phần.

| ID | Mô hình canonical | As-Built tại `eade4e5` | Mức |
|---|---|---|---|
| G-DM-01 | Bus là entity riêng | `Rs485Config` đơn, một `ModbusMaster`, một `rs485.device` | **P2** (hạ từ P0) — Đ-01 chốt Rev A một bus, nên As-Built *đủ dùng*; gap còn lại chỉ là "Bus chưa là entity trong API/BE". Nâng lại P0 khi mở bus thứ hai |
| G-DM-02 | quality năm trạng thái + reason | `kx_quality_t` ba mức, không reason | P0 — Track B `MBR-B103` |
| G-DM-03 | `timestamp` của sample do producer cấp | BE gán `time.Now()` khi đọc SHM (`core_client.go`) | P0 — Track B `MBR-B103` |
| G-DM-04 | `value` typed, không mất chính xác uint32 | `kx_ext_point_t.value` là `float` | P0 — Track B `MBR-B001` |
| G-DM-05 | canonical JSON + checksum ổn định | checksum tính trên `json.Marshal` của struct có map không thứ tự | P1 — Track B `MBR-B206` |
| G-DM-06 | `bit_index`, `min_value`, `max_value`, `poll_interval_ms` theo Point | không tồn tại trong `modbusrtu.Point` | P1 — Track B `MBR-B109` |
| G-DM-07 | candidate/LKG/journal riêng | chỉ có snapshot in-memory và restore sau restart lỗi | P0 — Track B `MBR-B203`/`B204` |
| G-DM-08 | serial format thuộc Bus | thuộc Device, hợp lệ hoá bằng luật "mọi device enabled phải giống nhau" (`domain.go`) | P2 (hạ từ P1) — với một bus, luật này cho kết quả tương đương; Track B `MBR-B202` |
| G-DM-09 | `point_id` là identity runtime | đúng khi profile do BE sinh (1 slot/point); profile viết tay `count>1` đổi tên thành `<slave>.<point>[i]` | P1 |
| G-DM-10 | import/export CSV/JSON | không tồn tại endpoint | P1 — **bắt buộc theo Đ-06**, Track B `MBR-B209` |
| G-DM-11 | `connection_status` sáu trạng thái theo device | ◐ diagnostics có `online` + `consecutive_errors` + `total_polls`; FE đã phân biệt được "chưa liên lạc lần nào" với "mất liên lạc" (D-07 đóng) nhưng enum sáu trạng thái vẫn chưa do authority cấp | P1 — Track B `MBR-B210` |
| **G-DM-12** | capacity ≥ 256 Point (Đ-07) | `domain.go` chặn ở 64, `KX_N_EXT = 64` | P0 **mới** — Track B, cùng đợt đổi ABI. Phải đo lại kích thước datagram (~2,6 KB → ~10,3 KB) và thời gian copy mỗi vòng scan trên target |
| **G-DM-13** | `direction_control` của Bus phải xác định | không tồn tại; source không gọi `modbus_rtu_set_serial_mode()` | P0 **mới** — chặn bởi Đ-02/`G-D` (Hardware Lead) |

### 9.1 Đã đóng trong Track A (không còn là gap)

| ID cũ | Nội dung | Bằng chứng |
|---|---|---|
| G-DM-14 (D-01/D-02) | `scale ≠ 0`, encode fail-closed, không UB khi ép kiểu | `register_codec.cpp`, `device_profile.cpp`, 8 test mới — `1e3e2bc` |
| G-DM-15 (D-04) | `offline_probe_ms` thuộc Bus, device chết không bỏ đói device sống | `fieldbus_config.hpp`, `poll_scheduler.cpp` — `c4036dd` |
| G-DM-16 (D-05) | `retry_count` là số lần phát lại; ngưỡng OFFLINE là field riêng | `fieldbus_config.hpp`, `domain.go` — `0f0fe71` |

## Revision history

| Phiên bản | Ngày | Trạng thái | Thay đổi |
|---|---|---|---|
| 0.1 | 2026-08-04 | In Review | Tạo data model canonical Bus/Device/Point, quality năm trạng thái, import/export và gap As-Built |
| 0.2 | 2026-08-05 | In Review | Áp dụng Đ-01/Đ-05/Đ-07 và đối chiếu lại với `eade4e5`. **Thay thế:** (a) "hai bus độc lập" → Rev A một instance, giữ entity Bus và `bus_id` (Đ-01); (b) `retry_count` từ "số retry sau attempt đầu" → định nghĩa Đ-05 kèm field mới `offline_after_errors`; (c) thêm `direction_control` vào Bus, đánh dấu còn mở; (d) capacity import từ 64 → theo Đ-07 ≥256; (e) thêm luật fail-closed khi encode vào §5.3; (f) §9 đối chiếu lại toàn bộ: hạ G-DM-01/G-DM-08 xuống P2, thêm G-DM-12/G-DM-13, tách §9.1 ba gap đã đóng bằng Track A |
| 0.2 (+U-07) | 2026-09-27 | Active | §4 thêm field tuỳ chọn `coil_write_batch_max` (gom coil liền kề thành FC15, mặc định tắt). Không đổi field nào đã có |
