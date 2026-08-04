# Modbus RTU — Data Model DDC-24 Rev A

**ID:** DDD-DM-MBRTU-001
**Phiên bản:** 0.1
**Trạng thái:** In Review
**Ngày:** 2026-08-04
**Design authority chủ quản:** [DDD-SW-MBRTU-POINT-001](DDC24_MODBUS_RTU_POINT_DETAILED_DESIGN.md)
**Trace:** `SWR-REQ-MBRTU-001..003`, `SWR-REQ-MBRTU-007..008`, `IF-REQ-MBRTU-001`, `IF-REQ-MBRTU-004`

> Tài liệu này là **mô hình dữ liệu canonical duy nhất** cho Modbus RTU. FE, BE
> và FW-SOM không được định nghĩa mô hình Point riêng. Khi nội dung ở đây khác
> với source hiện tại, đó là **gap thiết kế**, không phải mô tả As-Built; gap
> được liệt kê ở §9.

## 1. Ba entity và quan hệ

```text
ModbusRTUBus (rs485-1, rs485-2)         — resource cố định của thiết bị
  └─ 1..n ModbusRTUDevice               — một slave trên đúng một bus
       └─ 1..n ModbusRTUPoint           — một điểm luận lý trên device
                └─ 0..1 PointMapping    — ánh xạ vào Point Database DDC-24
```

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

| Field | Kiểu | Bắt buộc | Default | Validation |
|---|---|---|---|---|
| `bus_id` | enum `rs485-1` \| `rs485-2` | có | — | bất biến, do hệ thống định nghĩa; không phải `/dev/tty*` |
| `label` | string ≤32 | không | `"RS485-1"` / `"RS485-2"` | hiển thị |
| `enabled` | bool | có | `false` | bus disabled thì mọi device trên bus không được poll |
| `port_ref` | enum capability | có | từ manifest | phải nằm trong allowlist capability manifest |
| `baud_rate` | enum 9600/19200/38400/57600/115200 | có | `19200` | chung cho toàn bus |
| `data_bits` | int | có | `8` | **cố định 8**, không cho UI sửa (Modbus RTU) |
| `parity` | enum `N`/`E`/`O` | có | `N` | chung cho toàn bus |
| `stop_bits` | enum 1/2 | có | `1` | `N` nên đi với `2`; cảnh báo nếu `N`+`1` |
| `offline_probe_ms` | int 1000..60000 | không | `5000` | chu kỳ thử lại device OFFLINE |
| `inter_frame_policy` | enum `auto`/`fixed_ms` | không | `auto` | `auto` = 3.5 ký tự theo baud |
| `open_state` | enum `open`/`closed`/`unavailable` | runtime | — | read-only, từ iobus |
| `last_error` | string ≤128 | runtime | `null` | read-only |

Hai bus **không được** map tới cùng device node. USB-RS485 chỉ hợp lệ trong lab
profile có provenance riêng và phải bị từ chối ở production profile.

## 4. `MODBUS_RTU_DEVICE`

| Field | Kiểu | Bắt buộc | Default | Validation |
|---|---|---|---|---|
| `device_id` | string 1..23 ASCII | có | server-generated | bất biến; `^[A-Za-z][A-Za-z0-9_-]{0,22}$`; unique toàn hệ (so sánh case-insensitive) |
| `name` (`display_name`) | UTF-8 1..64 | có | — | NFC normalize; không cho chuỗi rỗng sau trim |
| `enabled` | bool | có | `true` | device disabled không được scheduler nhận |
| `rs485_port` (`bus_id`) | enum `rs485-1`/`rs485-2` | có | `rs485-1` | phải là bus tồn tại |
| `slave_id` | int 1..247 | có | — | **unique trong cùng bus**; trùng ở hai bus khác nhau là hợp lệ |
| `baud_rate` | enum | dẫn xuất | kế thừa Bus | **read-only ở API v2**; ghi khác giá trị Bus → `VALIDATION_FAILED` |
| `data_bits` | int | dẫn xuất | `8` | read-only |
| `parity` | enum | dẫn xuất | kế thừa Bus | read-only ở API v2 |
| `stop_bits` | int | dẫn xuất | kế thừa Bus | read-only ở API v2 |
| `poll_interval_ms` | int 100..60000 | có | `1000` | deadline poll khi ONLINE |
| `timeout_ms` | int 20..5000 | có | `300` | timeout mỗi attempt |
| `retry_count` | int 0..3 | có | `2` | số retry sau attempt đầu |
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
thị nguyên vẹn. Quyết định cần duyệt: `OD-MBRTU-002`.

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
- File > 1 MiB hoặc > 64 dòng dữ liệu bị từ chối (`CAPACITY_EXCEEDED`).
- Export **không** chứa runtime value/quality/timestamp và không chứa secret.

JSON export (`?format=json`) trả nguyên khối `{bus[], devices[], points[], revision, checksum}`
và là định dạng duy nhất round-trip được cả Bus và Device.

## 9. Gap giữa mô hình này và source hiện tại

| ID | Mô hình canonical | As-Built hiện tại | Mức |
|---|---|---|---|
| G-DM-01 | Bus là entity riêng, hai bus độc lập | `Rs485Config` đơn, một `ModbusMaster`, một `rs485.device` | P0 |
| G-DM-02 | quality năm trạng thái + reason | `kx_quality_t` ba mức, không reason | P0 |
| G-DM-03 | `timestamp` của sample do producer cấp | BE gán `time.Now()` khi đọc SHM (`core_client.go`) | P0 |
| G-DM-04 | `value` typed, không mất chính xác uint32 | `kx_ext_point_t.value` là `float` | P0 |
| G-DM-05 | canonical JSON + checksum ổn định | checksum tính trên `json.Marshal` của struct có map không thứ tự | P1 |
| G-DM-06 | `bit_index`, `min_value`, `max_value`, `poll_interval_ms` theo Point | không tồn tại trong `modbusrtu.Point` | P1 |
| G-DM-07 | candidate/LKG/journal riêng | chỉ có snapshot in-memory và restore sau restart lỗi | P0 |
| G-DM-08 | serial format thuộc Bus | thuộc Device, hợp lệ hoá bằng luật "mọi device enabled phải giống nhau" | P1 |
| G-DM-09 | `point_id` là identity runtime | đúng khi profile do BE sinh (1 slot/point); profile viết tay `count>1` đổi tên thành `<slave>.<point>[i]` | P1 |
| G-DM-10 | import/export CSV/JSON | không tồn tại endpoint | P1 |
| G-DM-11 | `connection_status` sáu trạng thái theo device | diagnostics chỉ có `online` + `consecutive_errors`, ghép theo địa chỉ slave | P1 |

## Revision history

| Phiên bản | Ngày | Trạng thái | Thay đổi |
|---|---|---|---|
| 0.1 | 2026-08-04 | In Review | Tạo data model canonical Bus/Device/Point, quality năm trạng thái, import/export và gap As-Built |
