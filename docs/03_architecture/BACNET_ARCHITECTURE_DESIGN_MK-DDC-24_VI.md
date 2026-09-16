# BACnet/IP — Architecture Design DDC-24 Rev A

**ID:** ARCH-BACNET-001
**Phiên bản:** 0.1
**Trạng thái:** In Review (chưa có chữ ký Architecture Owner)
**Ngày:** 2026-09-16
**Chủ quản đề xuất:** System Engineering / Protocol + Controls
**Reviewer đề xuất:** CTO (kiến trúc), Controls (arbitration), QA (thang bằng chứng)
**Approver đề xuất:** CTO
**Decision package:** `ADR-057`, `ADR-058`, `ADR-059`, `ADR-060` — cả bốn `Accepted 2026-09-10`
([biên bản CTO `DDC24-BACNET-APPROVAL-2026-09-10`](../07_records/reviews/BACNET_REV_A_APPROVAL_RECORD_2026-09-10.md))
**Quyết định đã ký áp dụng vào bản này:** `OD-BAC-003`, `OD-BAC-005`, `OD-BAC-009`
(xem [BACNET_OPEN_DECISIONS](../00_governance/BACNET_OPEN_DECISIONS.md))
**Trace ngược:** [PROD-BACNET-001](../01_product/BACNET_PRODUCT_REQUIREMENTS.md),
[REQUIREMENTS.md §BACnet/IP](../02_requirements/REQUIREMENTS.md) `SYS-REQ-BAC-001…023`
**Trace xuôi:** [PLAN-BACNET-D2C-001](../03_implementation/BACNET_DOC_TO_CODE_E2E_PLAN.md)
`T-BAC-005`, `T-BAC-006`, `T-BAC-020`…`T-BAC-024`, `T-BAC-050`
**Phạm vi DD:** `DD-04` (target design và ownership), `DD-07` (state/algorithm/timing)

> **Tài liệu này thiết kế ba thứ CHƯA TỒN TẠI trong mã**: Export Registry, object
> identity bền vững, và capability gate. Nó **không** mô tả bản đang chạy — bản
> đang chạy được mô tả ở [`SW_BACNET_DESIGN`](../02_design/software/SW_BACNET_DESIGN_MK-DDC-24_VI.md)
> và được đo ở [`REV-BACNET-ASBUILT-001`](../05_verification/BACNET_REV_A_ASBUILT_REVIEW.md).
> Mọi câu "hôm nay mã đang làm X" trong tài liệu này đều kèm `file:line` kiểm được.
>
> Trạng thái `In Review` nghĩa là **chưa có authority**. Theo
> [`REQUIREMENTS.md`](../02_requirements/REQUIREMENTS.md), As-Built không tự đóng
> requirement nào; và theo `ADR-060`, **không** mục nào trong tài liệu này được
> ghi một capability là `VERIFIED` — chưa có bằng chứng `TARGET` nào tồn tại.

---

## 1. Phạm vi và ranh giới ownership

### 1.1 Trong phạm vi tài liệu này

Ba cơ chế mà Wave W2 sẽ implement, mỗi cơ chế một mục thiết kế đầy đủ:

| Cơ chế | Task thi hành | Mục |
|---|---|---|
| Export Registry — ánh xạ Canonical Point → object BACnet | `T-BAC-021` | §3 |
| Object identity bền vững — cấp `objectInstance` từ `pointStableId` | `T-BAC-023` | §4 |
| Capability gate — `board_cap_map` quyết object nào được công bố | `T-BAC-022` | §5 |

### 1.2 Ngoài phạm vi

Ngoài phạm vi **Rev A** theo `ADR-057`: Alarm/Event Notification, Alarm
Acknowledge, Schedule, Calendar, Trend Log, Notification Class, Event Enrollment
— cả bảy chuyển V1.1. Ngoài phạm vi theo `OD-BAC-005`: TimeSync ở **cả hai** vai
trò. Ngoài phạm vi theo `ARCH-R010`: BACnet MS/TP. Xem `SYS-REQ-BAC-020` cho
danh sách đầy đủ phải khai ❌ trong hồ sơ năng lực.

Ngoài phạm vi **tài liệu này** (thuộc hồ sơ khác): hợp đồng API của
`GET /api/v1/bacnet/objects` (`T-BAC-005`), đặc tả V&V T1..T9 (`T-BAC-006`),
PICS/EPICS, và mọi thay đổi source.

### 1.3 Ranh giới ownership — ai sở hữu cái gì

Không mô tả chức năng nào mà không nói ai sở hữu nó.

| Thành phần | Chủ sở hữu | Sở hữu cái gì | KHÔNG sở hữu |
|---|---|---|---|
| **`iobus`** | Protocol | Export Registry (dựng, giữ, phát lại); đánh giá capability gate; vòng đời object trên bacnet-stack; `objectInstance`; socket BACnet/IP | Giá trị runtime; phân xử ưu tiên; phân quyền người dùng |
| **`core`** | Controls | Giá trị và chất lượng của mọi điểm; arbitration 16 mức; kết quả chấp nhận/từ chối một lệnh ghi | Biết BACnet là gì. `core` nhận lệnh ghi đã chuẩn hoá kèm priority, không nhận khái niệm object BACnet |
| **`web-api`** | Platform | Đường **chỉ đọc** liệt kê object đang công bố kèm nguồn dữ liệu (`ADR-059`); RBAC; audit record | Quyết định object nào được công bố. `web-api` **phản ánh** Registry, không sinh ra nó |
| **`contracts`** | System Engineering | Hợp đồng identity điểm, bit năng lực bo, layout SHM | Chính sách. Hợp đồng nói *có gì*, thiết kế này nói *làm gì với nó* |

**Chiều phụ thuộc là một chiều:** `contracts` ← `iobus` → `core`, và
`web-api` → `iobus` (đọc Registry). Không có chiều ngược lại. `core` không được
import khái niệm object BACnet; đó là điều giữ cho `SYS-REQ-BAC-001` ("lỗi BACnet
ở mọi mức không được làm dừng core control") khả thi về mặt cấu trúc chứ không
chỉ về mặt lời hứa.

---

## 2. Hiện trạng đo được — điểm xuất phát

Mọi dòng trong mục này kiểm được bằng `sed -n '<line>p' <path>`.

### 2.1 Object sinh ra bằng bảy vòng `for` hằng số cứng

`apps/iobus/adapters/bacnet/bacnet_server.cpp:214` mở `register_objects()`, và
bảy dòng `218`…`224` tạo object bằng hằng số viết thẳng trong mã:

| Dòng | Lệnh | Số lượng |
|---|---|---|
| `bacnet_server.cpp:218` | `Analog_Input_Create(i + 1)` | `KX_N_UI` = 16 |
| `bacnet_server.cpp:219` | `Binary_Input_Create(i + 1)` | 8 |
| `bacnet_server.cpp:220` | `Analog_Output_Create(i + 1)` | 4 |
| `bacnet_server.cpp:221` | `Binary_Output_Create(i + 1)` | 4 |
| `bacnet_server.cpp:222` | `Analog_Value_Create(i + 1)` | 32 |
| `bacnet_server.cpp:223` | `Binary_Value_Create(i + 1)` | 16 |
| `bacnet_server.cpp:224` | `Multistate_Value_Create(i + 1)` | 8 |

Tổng **88 object**. `KX_N_UI` định nghĩa ở `contracts/shm/mkddc_shm.h:67`
(`16`, `ADR-010`); sáu số còn lại trùng với `N_BI`…`N_MSV` ở
`apps/iobus/adapters/bacnet/bacnet_objects.hpp:141-146` nhưng **được viết lại một
lần nữa** trong bảy vòng `for` — hai nguồn sự thật cho cùng một con số.

Không có lớp nào ánh xạ điểm → object. `objectInstance` là `i + 1`, tức **thứ tự
vòng lặp**, và `apps/iobus/adapters/bacnet/bacnet_objects.cpp` ánh xạ ngược bằng
`const int idx = static_cast<int>(instance) - 1;` (trong `read_ai`, mở ở dòng
`113`). Định danh đối ngoại chính là chỉ số mảng nội bộ.

### 2.2 64 trong 88 object không bao giờ được nạp dữ liệu

`sync_stack_inputs()` chỉ đồng bộ **AI và BI** (`bacnet_server.cpp:228` trở đi).
16 AI + 8 BI = 24 object có nguồn; 4 AO + 4 BO + 32 AV + 16 BV + 8 MSV = **64
object** còn lại luôn trả giá trị khởi tạo. Con số này khớp phép đo đã ghi trong
`ADR-059` ("64/88 object đăng ký với bacnet-stack không bao giờ được nạp dữ
liệu"). Đây là thứ `SYS-REQ-BAC-012` gọi thẳng là **lỗi**, không phải giá trị mặc
định hợp lệ.

### 2.3 AV/BV/MSV có đường ghi priority 3 nhưng không ai đăng ký callback

`bacnet_objects.cpp:342` (`write_av`), và hai hàm liền sau (`write_bv`,
`write_msv`) đều gọi `fn(..., 3)` — đúng priority 3 mà `OD-BAC-003` chốt. Nhưng
`bacnet_server.cpp:114-115` **chỉ** đăng ký hai callback:

```
Analog_Output_Write_Present_Value_Callback_Set(ao_write_callback);
Binary_Output_Write_Present_Value_Callback_Set(bo_write_callback);
```

Không có callback cho AV/BV/MSV ⇒ ba hàm ghi kia không có caller từ stack. Đây
đúng là "chỗ đứt" mà `OD-BAC-003` mô tả; tài liệu này ghi lại vì Export Registry
phải khai trường `commandable` đúng với **đường ghi thật sự có**, không theo
đường ghi lẽ ra phải có.

### 2.4 `board_cap_map` có thật, đọc được, và bị `register_objects()` bỏ qua

Chuỗi dữ liệu đã thông suốt tới SHM:

| Chặng | Vị trí | Nội dung |
|---|---|---|
| Định nghĩa bit | `contracts/iop/iop_protocol.h:106-110` | `IOP_BOARD_CAP_UI_16` … `IOP_BOARD_CAP_RTD` |
| Baseline Rev A | `contracts/iop/iop_protocol.h:112` | `IOP_BOARD_CAP_REV_A = UI_16 \| DO_4 \| AO_4` |
| Đọc từ handshake | `apps/iobus/adapters/iop/iop_client.cpp:226` | `board_cap_map_ = iop_be16(resp.payload + 6);` |
| Kiểm lúc startup | `apps/iobus/bootstrap/main.cpp:643` | `const uint16_t cap = client.board_cap_map();` |
| Ghi vào SHM | `apps/iobus/bootstrap/main.cpp:666` | `cache.write_board_capabilities(client.board_cap_map());` |
| Hàm ghi | `apps/iobus/domain/io/io_cache.cpp:257` | đặt `board_cap_map` rồi mới đặt `board_cap_valid = 1` trong cùng lượt seqlock |
| Trường SHM | `contracts/shm/mkddc_shm.h:264-265` | `board_cap_map` + `board_cap_valid` |

`register_objects()` (`bacnet_server.cpp:214`) không đọc bất kỳ trường nào trong
số đó. Hệ quả đo được: **8 BI được tạo vô điều kiện** (`bacnet_server.cpp:219`)
trong khi `IOP_BOARD_CAP_REV_A` (`iop_protocol.h:112`) **không** chứa
`IOP_BOARD_CAP_DI_8`. Nói cách khác, base SKU Rev A không có DI, mà thiết bị vẫn
công bố 8 Binary Input cho BMS. Đây là `G-06` của `REV-BACNET-ASBUILT-001` và là
nửa đầu của breaking change mà `ADR-058` đã cho phép.

---

## 3. Export Registry — `T-BAC-021`

**Trace:** `SYS-REQ-BAC-004`, `SYS-REQ-BAC-009`, `SYS-REQ-BAC-011`,
`SYS-REQ-BAC-012`, `SYS-REQ-BAC-021`.
**Mục DD:** `DD-04`.

### 3.1 Registry là gì, và vì sao nó phải tồn tại

Export Registry là **nguồn sự thật duy nhất** trả lời câu hỏi "thiết bị này đang
công bố object nào, lấy dữ liệu từ đâu". Hôm nay câu hỏi đó không có nơi trả lời:
tập object nằm rải trong bảy vòng `for` (§2.1), nguồn dữ liệu nằm trong
`sync_stack_inputs()`, và hai thứ đó **không đồng ý với nhau** ở 64 object (§2.2).

Registry là **danh sách bản ghi được dựng trước khi object nào được tạo**.
`register_objects()` sau khi có Registry không còn chứa hằng số nào: nó duyệt
Registry và tạo đúng những object mà Registry công nhận.

Thứ tự bắt buộc — đây là phần `DD-07` của mục này:

```
1. Chờ board_cap_valid = 1           (§5.4 quyết định điều gì xảy ra nếu chưa)
2. Dựng Registry:  Canonical Point ──▶ [gate năng lực] ──▶ [cấp instance] ──▶ bản ghi
3. Chỉ khi đó mới gọi *_Create() cho từng bản ghi trong Registry
4. Mọi đường đọc (BACnet ReadProperty, /api/v1/bacnet/objects) đọc CÙNG Registry
```

Bước 4 là điều làm cho `ADR-059` có giá trị: endpoint chỉ đọc phơi **cùng một**
Registry mà stack dùng, nên nó không thể nói dối về tập object. Một endpoint dựng
danh sách riêng chỉ là bằng chứng giả ở một chỗ mới — đúng cảnh báo trong
`ADR-059`.

### 3.2 Nguồn identity của một Canonical Point

Hợp đồng đã có sẵn bộ ba định danh, tại
`contracts/openapi/openapi.yaml:3406` (`ProgrammingBindingPointIdentity`):

- `category` — enum `LOCAL`, `VP`, `MB_RTU`
- `pointId` — chuỗi, 1..64 ký tự
- `deviceId` — chuỗi, 1..64 ký tự, **chỉ có** với điểm sau một device (`MB_RTU`)

Thiết kế này **dùng lại nguyên bộ ba đó** làm `pointStableId`, không phát minh
định danh mới. Lý do: bộ ba này đã là identity mà Programming dùng để bind biến
vào điểm, đã qua hợp đồng OpenAPI, và đã có luật hợp lệ. Cấp cho BACnet một
identity thứ hai song song là tạo ra hai sự thật về "điểm nào là điểm nào".

> `pointStableId` là **khái niệm mới của tài liệu này**; `grep -rn pointStableId`
> trên repo tại `main@0ba2fce` trả về **0 kết quả trong mã** (chỉ xuất hiện trong
> văn bản `ADR-058`). Nó được định nghĩa ở đây là **hàm chuẩn hoá** của bộ ba
> trên, không phải một trường mới trong contract.

### 3.3 Tám trường bắt buộc của một bản ghi export

Một bản ghi thiếu bất kỳ trường nào trong tám trường này là bản ghi **không hợp
lệ**, và object tương ứng **không được công bố** (`SYS-REQ-BAC-012`).

| # | Trường | Kiểu | Nguồn dữ liệu (`file:line` thật) | Khi nguồn thiếu |
|---|---|---|---|---|
| 1 | `pointStableId` | `{category, pointId, deviceId?}` | `contracts/openapi/openapi.yaml:3406` | **Loại bản ghi.** Không có identity thì không có gì để cấp instance bền vững. Ghi log `bacnet.export.reject reason=no_identity`, đếm vào diagnostics §3.5 |
| 2 | `objectType` | enum BACnet (`AI`,`BI`,`AO`,`BO`,`AV`,`BV`,`MSV`) | quyết bởi `category` + vai trò điểm; tập hợp lệ ở `apps/iobus/adapters/bacnet/bacnet_objects.hpp:140-146` | **Loại bản ghi.** Không suy diễn kiểu từ tên điểm |
| 3 | `objectInstance` | `uint32` | hàm thuần của trường 1 — thuật toán ở §4.2 | **Loại bản ghi.** Không rơi về bộ đếm; xem §4.3 vì sao |
| 4 | `objectName` | chuỗi ≤ 64 | tên điểm trong Canonical Point | Rơi về chuỗi dẫn xuất từ trường 1 (ổn định, không rỗng). **Không** loại bản ghi — tên là nhãn, không phải identity (§4.4) |
| 5 | `runtimeSource` | tham chiếu kênh SHM | `contracts/shm/mkddc_shm.h` — ví dụ `shm->ai[idx]` như `bacnet_objects.cpp` `read_ai` đang đọc | **Loại bản ghi.** Đây chính là 64 object ở §2.2. Object không nguồn không được công bố |
| 6 | `engineeringUnits` | enum đơn vị BACnet | đơn vị của điểm trong Canonical Point | Với `objectType` mang đơn vị (`AI`,`AO`,`AV`): ghi `UNITS_NO_UNITS`, **không** suy diễn (`SYS-REQ-BAC-009`). Với `BI`/`BO`/`BV`/`MSV`: trường không áp dụng |
| 7 | `capabilityGateBit` | `uint16` mask hoặc "không gate" | `contracts/iop/iop_protocol.h:106-110`; ánh xạ đầy đủ ở §5.2 | **Loại bản ghi.** "Chưa biết bit nào gate nó" không được coi là "không gate" — xem §5.4 |
| 8 | `commandable` | `bool` + `writePriority` `uint8` | đường ghi thật: `bacnet_objects.cpp:342` trở đi cho AV/BV/MSV; callback đăng ký tại `bacnet_server.cpp:114-115` | Nếu không có callback đăng ký cho `objectType` đó ⇒ `commandable = false`. Công bố `commandable = true` khi không có đường ghi là lỗi báo-thành-công-sai mà `OD-BAC-003` cấm |

**`writePriority` cố định là 3** cho mọi object ghi được từ BACnet, cả AO/BO lẫn
AV/BV/MSV (`OD-BAC-003`, khớp `fn(..., 3)` tại `bacnet_objects.cpp:342`).

### 3.4 Vì sao "loại bản ghi" là hành vi đúng khi nguồn thiếu

Sáu trong tám trường có hành vi thiếu là **loại bản ghi**, không phải điền giá
trị mặc định. Đây là lựa chọn có chủ ý, không phải sự khắt khe hình thức.

`SYS-REQ-BAC-012` đã quyết vế này ở tầng yêu cầu: *"Object chưa nối nguồn dữ liệu
không được công bố; công bố một object luôn trả giá trị khởi tạo là lỗi, không
phải giá trị mặc định hợp lệ."* Một object công bố ra BMS là một lời hứa đọc
được. 64 object ở §2.2 là 64 lời hứa đang sai, và chúng sai **im lặng** — BMS
đọc được `0.0` và không có cách nào phân biệt với số đo thật bằng `0.0`.

Bản ghi bị loại **không biến mất khỏi hồ sơ**: nó đi vào diagnostics §3.5 và vào
đường chỉ đọc của `ADR-059`, nơi tích hợp viên thấy được "điểm này tồn tại nhưng
chưa xuất được, vì thiếu trường X". Đó là khác biệt giữa *giấu* và *không công
bố*.

### 3.5 Diagnostics bắt buộc của Registry

Registry phải phơi được, qua đường chỉ đọc của `ADR-059`:

- tổng số Canonical Point xét đến;
- số bản ghi hợp lệ, tách theo `objectType`;
- số bản ghi bị loại, **tách theo lý do** (tám lý do tương ứng tám trường);
- trạng thái capability tại thời điểm dựng: `board_cap_valid` và `board_cap_map`;
- thời điểm dựng Registry gần nhất.

Thiếu phần "tách theo lý do" thì endpoint lại rơi đúng vào thứ `ADR-059` cấm: một
danh sách nói mọi thứ đều ổn.

---

## 4. Object identity bền vững — `T-BAC-023`

**Trace:** `SYS-REQ-BAC-015` (chính), `SYS-REQ-BAC-002`, `SYS-REQ-BAC-023`.
**Mục DD:** `DD-07`.

### 4.1 "Bền vững" nghĩa là gì — định nghĩa đo được

`ADR-058` cho phép cấp lại `objectInstance` từ `pointStableId` nhưng không định
nghĩa "bền vững". `SYS-REQ-BAC-015` định nghĩa nó ở tầng yêu cầu: bền qua restart
tiến trình, power-cycle và đổi tên object; cấp từ identity ổn định của điểm; và
**thêm/bớt một điểm không được làm dịch định danh của điểm khác**.

Tài liệu này định nghĩa nó ở tầng thiết kế, đo được:

> `objectInstance` là một **hàm thuần** (pure function) của `pointStableId`.
> Cùng một `pointStableId` ⇒ cùng một `objectInstance`, trên mọi lần chạy, mọi
> thứ tự cấu hình, mọi bo cùng model.

Mọi tính chất trong bảng §4.5 là **hệ quả** của một câu đó. Đây là lý do thiết kế
chọn hàm thuần chứ không chọn "bộ đếm + bảng lưu": bộ đếm đúng được bảng §4.5 chỉ
khi bảng lưu không bao giờ mất, còn hàm thuần đúng **không cần trạng thái nào**.

### 4.2 Thuật toán cấp instance

```
objectInstance(pointStableId, objectType):
    key   = canonical(category) ‖ 0x1F ‖ canonical(deviceId | "") ‖ 0x1F ‖ canonical(pointId)
    h     = H(key)                       # hàm băm tất định, không phụ thuộc kiến trúc
    base  = instanceBase(objectType)     # khoảng riêng cho từng objectType, §4.6
    span  = instanceSpan(objectType)
    return base + (h mod span)
```

Ràng buộc bắt buộc lên `H` và `canonical`:

| Ràng buộc | Vì sao |
|---|---|
| `H` tất định, cùng kết quả trên mọi endianness và mọi bản build | Instance phải giống nhau giữa bo lab và bo hiện trường, giữa build hôm nay và build sang năm |
| `canonical()` chuẩn hoá hoa/thường và khoảng trắng, **không** chuẩn hoá dấu phân cách | `AI.1` và `AI_1` là hai điểm khác nhau; gộp chúng là tạo đụng độ nhân tạo |
| `deviceId` rỗng với `LOCAL`/`VP` phải mã hoá **khác** `deviceId` thiếu | Nếu không, một điểm `MB_RTU` mất `deviceId` sẽ trùng khoá với một điểm `LOCAL` |
| Ký tự phân tách `0x1F` không xuất hiện được trong ba trường | Không có phân tách thì `("AB","C")` và `("A","BC")` cùng khoá |

Va chạm băm là **có thật và phải xử lý**, không phải bỏ qua vì xác suất thấp:
khi hai `pointStableId` cho cùng `objectInstance` trong cùng `objectType`, bản ghi
**đến sau theo thứ tự sắp xếp tất định của `pointStableId`** bị đẩy sang khe trống
kế tiếp trong khoảng, và sự kiện được ghi vào diagnostics §3.5. Thứ tự sắp xếp
phải tất định (không phải thứ tự duyệt cấu hình) để việc giải va chạm cũng là
hàm thuần của **tập** điểm, chứ không của thứ tự nạp.

### 4.3 Vì sao không dùng bộ đếm — kể cả bộ đếm có lưu

Phương án hiển nhiên là "cấp tuần tự, lưu bảng `pointStableId → instance` xuống
đĩa". Thiết kế này từ chối nó, vì ba lý do đo được:

1. **Nó biến một bảng dữ liệu thành một phần của hợp đồng đối ngoại.** Mất bảng
   (đổi thẻ nhớ, khôi phục cấu hình, reflash) ⇒ toàn bộ instance đổi ⇒ cấu hình
   BMS tại site hỏng. `ADR-058` cho phép breaking change **một lần**; một cơ chế
   có thể tự gây breaking change mỗi lần mất file là mâu thuẫn với chính quyết
   định đó.
2. **Nó không sống sót qua nhân bản bo.** Hai bo cùng cấu hình phải cho cùng bảng
   object thì công cụ xuất CSV của `ADR-058` mới dùng lại được giữa các bo. Bộ
   đếm cho kết quả phụ thuộc thứ tự nạp trên **từng** bo.
3. **Nó làm hàng "khôi phục cấu hình cũ" trong bảng §4.5 không thể đảm bảo**, vì
   kết quả phụ thuộc trạng thái đã mất chứ không phụ thuộc cấu hình được khôi phục.

Đánh đổi được chấp nhận: hàm thuần phải xử lý va chạm (§4.2), và khoảng instance
phải rộng hơn số điểm thực tế nhiều lần (§4.6).

### 4.4 Tên object không tham gia identity

`objectName` (trường 4 của §3.3) **không** nằm trong khoá băm. Đây là điều làm
hàng "đổi `Object_Name`" trong bảng §4.5 trở thành *không đổi* một cách cấu trúc
chứ không nhờ cẩn thận: tên không vào khoá thì đổi tên không thể làm dịch
instance. `SYS-REQ-BAC-015` đòi đúng tính chất này.

### 4.5 Bảng biến cố — instance đổi hay không đổi

Không ô nào để "tuỳ".

| # | Biến cố | `objectInstance` | Giải thích |
|---|---|---|---|
| 1 | Restart tiến trình `iobus` | **Không đổi** | Hàm thuần, không đọc trạng thái lưu (§4.2) |
| 2 | Restart bo / power-cycle | **Không đổi** | Cùng lý do (1) |
| 3 | Đổi `Object_Name` của một object | **Không đổi** | Tên không nằm trong khoá băm (§4.4) |
| 4 | Đổi UI mode (`sensor_type`) của một kênh | **Không đổi** | `pointStableId` định danh **kênh vật lý**, không định danh đại lượng đang đo. Xem cảnh báo §4.7 — `objectType` có thể đổi kể cả khi instance không đổi |
| 5 | Thêm một Point mới | **Không đổi** với mọi điểm đang có | Instance của một điểm chỉ phụ thuộc `pointStableId` của chính nó. Đây là yêu cầu tường minh của `SYS-REQ-BAC-015` |
| 6 | Xoá một Point | **Không đổi** với mọi điểm còn lại | Cùng lý do (5). Instance của điểm bị xoá **không được tái cấp** cho điểm khác chừng nào hàm băm còn cho kết quả khác — và vì nó là hàm thuần, điều đó tự đúng |
| 7 | Khôi phục cấu hình cũ | **Không đổi** so với lần cấu hình đó chạy trước đây | Cùng tập `pointStableId` ⇒ cùng tập instance, kể cả sau khi mất toàn bộ trạng thái cục bộ (§4.3) |
| 8 | Nâng cấp firmware `iobus`, giữ nguyên cấu hình | **Không đổi** | `H` bị ràng buộc tất định qua các bản build (§4.2). Đổi `H` là **breaking change** phải theo §4.8 |
| 9 | Đổi `board_cap_map` (thay SKU, gắn thêm module DI) | **Không đổi** với điểm đang công bố; điểm mới được gate mở sẽ nhận instance của chính nó | Gate quyết *có công bố hay không* (§5), không tham gia cấp instance |

### 4.6 Khoảng instance theo `objectType`

`objectInstance` chỉ cần duy nhất **trong cùng một `objectType`** theo chuẩn
BACnet. Thiết kế vẫn cấp khoảng rời nhau cho từng loại, vì nó làm bảng object đọc
được bằng mắt tại site và làm một instance lạc loại phát hiện được ngay.

`instanceSpan` phải **rộng hơn ít nhất một bậc độ lớn** so với số điểm tối đa
mỗi loại (hôm nay: 16 AI, 8 BI, 4 AO, 4 BO, 32 AV, 16 BV, 8 MSV — §2.1), để tỉ lệ
va chạm §4.2 ở mức hiếm thay vì thường xuyên. Giá trị cụ thể của `instanceBase`
và `instanceSpan` là **`TBD-ARCH-BAC-01`** (§7).

### 4.7 Cảnh báo: đổi UI mode giữ instance nhưng có thể đổi `objectType`

Hàng 4 của §4.5 nói instance không đổi. Điều đó **không** có nghĩa BMS không thấy
gì đổi. Một kênh UI chuyển từ chế độ đo analog sang chế độ tiếp điểm khô đổi
`objectType` (`AI` → `BI`), và với BMS thì `(objectType, instance)` mới là địa
chỉ — nên đó là **một object biến mất và một object xuất hiện**.

Thiết kế xử lý điều này tường minh thay vì để nó xảy ra im lặng:

- đổi `sensor_type` sang chế độ làm đổi `objectType` **phải** yêu cầu quyền Admin
  và phải sinh audit record (`SYS-REQ-BAC-018`);
- giao diện phải cảnh báo rằng thao tác này đổi bảng object BACnet;
- Registry phải phơi được **diff** so với bảng object trước đó, để dùng chung
  đường xuất CSV mà `ADR-058` bắt buộc.

Đây **không** phải breaking change theo nghĩa `ADR-058` (không phải thay đổi tập
object của cả sản phẩm), mà là hệ quả cấu hình của đúng một site, do người có
quyền chủ động gây ra và được ghi nhận.

### 4.8 Đổi `H` là breaking change

Đổi hàm băm, đổi `canonical()`, đổi ký tự phân tách, hay đổi `instanceBase`/
`instanceSpan` đều làm dịch instance của **mọi** điểm. Mỗi thay đổi như vậy phải
đi qua đúng thủ tục `ADR-058`: release note nêu rõ breaking change, kèm bảng
object xuất được để nạp lại cấu hình BMS. `SYS-REQ-BAC-023` nói thẳng: thiếu bảng
object xuất được thì **không được thi hành**.

---

## 5. Capability gate — `T-BAC-022`

**Trace:** `SYS-REQ-BAC-012` (chính), `SYS-REQ-BAC-016`, `SYS-REQ-BAC-021`.
**Mục DD:** `DD-07`.

### 5.1 Vấn đề

`register_objects()` (`bacnet_server.cpp:214`) tạo 8 BI vô điều kiện
(`bacnet_server.cpp:219`) trong khi baseline Rev A tại `iop_protocol.h:112`
**không** chứa `IOP_BOARD_CAP_DI_8`. Dữ liệu để biết điều đó đã nằm sẵn trong SHM
(§2.4) và không được đọc.

### 5.2 Ánh xạ bit → loại object bị gate

Nguồn bit: `contracts/iop/iop_protocol.h:106-110`.

| Bit | Hằng số | Giá trị | Gate object nào | Số lượng hôm nay |
|---|---|---|---|---|
| 0 | `IOP_BOARD_CAP_UI_16` | `1u << 0` | `AI` 16 kênh UI | 16 (`bacnet_server.cpp:218`) |
| 1 | `IOP_BOARD_CAP_DI_8` | `1u << 1` | `BI` 8 kênh DI | 8 (`bacnet_server.cpp:219`) — **hôm nay không gate, đây là lỗi** |
| 2 | `IOP_BOARD_CAP_DO_4` | `1u << 2` | `BO` 4 kênh DO relay | 4 (`bacnet_server.cpp:221`) |
| 3 | `IOP_BOARD_CAP_AO_4` | `1u << 3` | `AO` 4 kênh AO | 4 (`bacnet_server.cpp:220`) |
| 4 | `IOP_BOARD_CAP_RTD` | `1u << 4` | **Không gate object nào** — xem §5.3 | — |
| — | không có bit | — | `AV` 32, `BV` 16, `MSV` 8 — điểm phần mềm, không phụ thuộc phần cứng bo | 56 |

**Luật:** một bản ghi có `capabilityGateBit` khác "không gate" chỉ được công bố
khi `board_cap_valid == 1` **và** `(board_cap_map & capabilityGateBit) != 0`.

Với `IOP_BOARD_CAP_REV_A = UI_16 | DO_4 | AO_4` (`iop_protocol.h:112`), một bo
base SKU Rev A đúng chuẩn sẽ công bố 16 `AI` + 4 `AO` + 4 `BO` + 56 object phần
mềm, và **0 `BI`** — thay vì 8 `BI` như hôm nay. Đó chính là nửa "bỏ 8 BI ở base
SKU" của `ADR-058`.

### 5.3 Vì sao `IOP_BOARD_CAP_RTD` không gate object nào

`iop_protocol.h:110` mô tả bit này là "PT100/PT1000 circuit populated". Nó không
thêm hay bớt kênh nào: nó quyết định `sensor_type` `PT100`/`PT1000` có phải lựa
chọn hợp lệ trên một kênh UI hay không — đúng như `contracts/openapi/openapi.yaml:787`
đã ghi ("đòi bằng chứng (`PT100`/`PT1000`, cần `IOP_BOARD_CAP_RTD`) bị giữ lại").

Gate object theo bit này sẽ là **sai**: một kênh UI không có mạch RTD vẫn là một
kênh đo analog hợp lệ ở chế độ 0-10V, và vẫn phải công bố `AI` của nó. Bit RTD
thuộc tầng hợp lệ hoá cấu hình kênh, không thuộc tầng công bố object.

### 5.4 `board_cap_valid = 0` — quyết định, và vì sao

Đây là vế nguy hiểm nhất, nên nó được quyết dứt khoát ở đây.

> **Quyết định: fail-closed có phân biệt.** Khi `board_cap_valid == 0`, thiết bị
> **không công bố** object phụ thuộc phần cứng (`AI`, `BI`, `AO`, `BO`), **vẫn
> công bố** Device Object và object phần mềm (`AV`, `BV`, `MSV`), và **vẫn trả
> lời Who-Is bằng I-Am**. Registry được dựng lại ngay khi `board_cap_valid`
> chuyển `0 → 1`.

**Vì sao không phải "tạo hết như hôm nay".** Đây không phải lựa chọn tự do của
thiết kế này — hợp đồng SHM đã quyết trước. `contracts/shm/mkddc_shm.h:265` ghi
thẳng nghĩa của trường: *"1 = đã hỏi được MCU; 0 = CHƯA BIẾT (không phải 'không
có')"*, và phần chú giải ngay trên (`mkddc_shm.h:243` trở đi) quy định
*"consumer phải coi đó là KHÔNG BIẾT và fail-closed, đúng nguyên tắc 'thiếu bằng
chứng không phải bằng chứng'"*. Công bố object khi chưa hỏi được bo là công bố
một object chưa chắc có nguồn — đúng thứ `SYS-REQ-BAC-012` gọi là lỗi.

**Vì sao điều này không làm chết tích hợp khi handshake chậm.** Nỗi lo chính đáng
là: BMS dò tìm trong lúc `iobus` chưa handshake xong, không thấy gì, và tích hợp
viên kết luận thiết bị hỏng. Ba điều trong quyết định trên chặn đúng kịch bản đó:

1. **Device Object và I-Am vẫn hoạt động** (`SYS-REQ-BAC-003`), nên BMS **thấy
   thiết bị**. Khác biệt giữa "thiết bị không tồn tại" và "thiết bị tồn tại,
   danh sách object chưa đầy đủ" là toàn bộ khác biệt về trải nghiệm tích hợp.
2. **Registry dựng lại khi `board_cap_valid` chuyển sang 1**, không cần khởi động
   lại tiến trình và không cần thao tác tay. Handshake chậm chỉ làm danh sách
   object xuất hiện muộn, không làm nó vắng vĩnh viễn.
3. **Diagnostics nói rõ lý do.** `SYS-REQ-BAC-016` đã đòi phân biệt ba tình trạng
   liên kết, trong đó có "chưa đo được"; áp dụng ở đây: đường chỉ đọc của
   `ADR-059` phải trả `board_cap_valid = 0` kèm nhãn "năng lực bo chưa xác định",
   chứ không trả một danh sách object rỗng không giải thích.

Trạng thái ngược lại — tạo hết object rồi rút bớt khi biết sự thật — tệ hơn theo
một cách không sửa được: BMS đã đọc bảng object và người tích hợp đã lưu cấu
hình. Rút một object sau đó là breaking change đối với site, còn thêm một object
thì không. **Thêm thì rẻ, rút thì đắt** — đó là lý do cuối cùng để chọn fail-closed.

### 5.5 Máy trạng thái công bố object

| Trạng thái | Điều kiện | Object công bố | Chuyển tiếp |
|---|---|---|---|
| `CAP_UNKNOWN` | `board_cap_valid == 0` | Device Object + `AV`/`BV`/`MSV` | → `CAP_KNOWN` khi `board_cap_valid → 1` |
| `CAP_KNOWN` | `board_cap_valid == 1` | Thêm object phần cứng theo §5.2 | → `CAP_KNOWN` (dựng lại) khi `board_cap_map` đổi giá trị |

Trạng thái khởi tạo là `CAP_UNKNOWN`. Không có chuyển tiếp `CAP_KNOWN →
CAP_UNKNOWN`: một khi đã hỏi được bo, mất liên lạc IOP sau đó là vấn đề **chất
lượng dữ liệu** (`SYS-REQ-BAC-010`, `SYS-REQ-BAC-011` — báo `reliability` và cờ
trạng thái), **không** phải lý do rút object đã công bố. Đây là hệ quả trực tiếp
của "thêm thì rẻ, rút thì đắt" ở §5.4.

### 5.6 Quan hệ với kiểm capability đang có ở `main.cpp`

`apps/iobus/bootstrap/main.cpp:643` đã kiểm `IOP_BOARD_CAP_UI_16` và phát
`IOP_CAP_MISMATCH` (critical) nếu thiếu, rồi kiểm `IOP_BOARD_CAP_REV_A` và phát
`IOP_CAP_WARN` (warning) nếu lệch baseline. Hai kiểm đó **giữ nguyên**, không bị
thiết kế này thay thế: chúng trả lời "bo này có phải bo đúng không", còn gate ở
§5.2 trả lời "với bo này thì công bố object nào". Một bo lệch baseline vẫn chạy
(chỉ `WARN`) và khi đó gate là thứ duy nhất giữ cho bảng object nói đúng sự thật
về nó.

---

## 6. Trace ngược `SYS-REQ-BAC-*`

Mỗi mục thiết kế dẫn ít nhất một yêu cầu hệ thống của
[`PROD-BACNET-001`](../01_product/BACNET_PRODUCT_REQUIREMENTS.md) qua
[`REQUIREMENTS.md`](../02_requirements/REQUIREMENTS.md). Không mục nào tự ban
hành yêu cầu mới.

| Mục | Nội dung | `SYS-REQ-BAC-*` |
|---|---|---|
| §1.3 | Ranh giới ownership, lỗi BACnet không làm dừng core | `SYS-REQ-BAC-001` |
| §3.1 | Registry là nguồn sự thật duy nhất; endpoint đọc cùng Registry | `SYS-REQ-BAC-021` |
| §3.3 tr.1-3 | Identity, kiểu, instance của bản ghi | `SYS-REQ-BAC-015` |
| §3.3 tr.5 | `runtimeSource` bắt buộc; không nguồn thì không công bố | `SYS-REQ-BAC-012` |
| §3.3 tr.6 | Đơn vị đo, không suy diễn | `SYS-REQ-BAC-009` |
| §3.3 tr.8 | `commandable` đúng đường ghi thật, priority 3 | `SYS-REQ-BAC-006`, `SYS-REQ-BAC-007` |
| §3.4 | Loại bản ghi thay vì giá trị mặc định | `SYS-REQ-BAC-012` |
| §3.5 | Diagnostics Registry, tách theo lý do | `SYS-REQ-BAC-021` |
| §4.1-4.5 | Bền vững qua restart, power-cycle, đổi tên, thêm/bớt điểm | `SYS-REQ-BAC-015` |
| §4.7 | Audit + quyền Admin khi đổi `objectType` | `SYS-REQ-BAC-018` |
| §4.8 | Đổi `H` là breaking change, cần bảng object xuất được | `SYS-REQ-BAC-023` |
| §5.2 | Gate theo `board_cap_map` | `SYS-REQ-BAC-012` |
| §5.4 | Fail-closed + Device Object vẫn công bố | `SYS-REQ-BAC-003`, `SYS-REQ-BAC-012` |
| §5.4 đ.3 | Diagnostics "chưa đo được", không quy về "không có" | `SYS-REQ-BAC-016` |
| §5.5 | Chất lượng dữ liệu thay vì rút object khi mất IOP | `SYS-REQ-BAC-010`, `SYS-REQ-BAC-011` |
| §1.2 | Loại trừ Alarm/Schedule/Calendar/Trend/TimeSync/MS-TP | `SYS-REQ-BAC-020` |

**Lớp bằng chứng.** Không dòng nào trong tài liệu này khai một capability là
`VERIFIED`. Theo `ADR-060` và `SYS-REQ-BAC-022`, `VERIFIED` chỉ cấp cho bằng
chứng `TARGET`, và hiện chưa có bằng chứng `TARGET` nào. Ba cơ chế thiết kế ở đây
chưa tồn tại trong mã, nên lớp bằng chứng của cả ba là **`DESIGN-ONLY`**.

---

## 7. TBD / BLOCKED

| Mã | Nội dung | Owner | Ảnh hưởng | Gate | Điều kiện mở khoá |
|---|---|---|---|---|---|
| `TBD-ARCH-BAC-01` | Giá trị cụ thể của `instanceBase` / `instanceSpan` cho từng `objectType` (§4.6), và chọn hàm băm `H` cụ thể (§4.2) | System Engineering / Protocol | `T-BAC-023` không implement được nếu thiếu; chọn sai làm tỉ lệ va chạm cao | `T-BAC-023` | Chốt cùng công cụ xuất CSV của `ADR-058`, vì hai thứ phải nhất quán về bảng object |
| `TBD-ARCH-BAC-02` | Nguồn `objectType` cho điểm `VP` và `MB_RTU` (§3.3 tr.2) — điểm phần mềm và điểm Modbus ánh xạ sang `AV`/`BV`/`MSV` theo luật nào | Controls | `T-BAC-021` chỉ dựng được phần `LOCAL` nếu thiếu | `T-BAC-021` | Cần bảng kiểu dữ liệu của Canonical Point theo `category`, thuộc phạm vi `T-BAC-005` |
| `BLOCKED-ARCH-BAC-03` | Bằng chứng `LOOPBACK` cho cả ba cơ chế | QA | Không có `LOOPBACK` thì theo `ADR-060` không PR nào chạm `apps/iobus/adapters/bacnet/**` được merge | `T-BAC-021`, `T-BAC-022`, `T-BAC-023` | `OD-BAC-009` đã `CLOSED 2026-09-16` (vendor bacnet-stack 1.3.8); mở khoá khi build `BACNET=ON` dựng được thật — đang thi hành ở #625 |

---

## 8. Lịch sử sửa đổi

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 0.1 | 2026-09-16 | Tạo hồ sơ `ARCH-BACNET-001` (`T-BAC-004`): thiết kế Export Registry với 8 trường bắt buộc và hành vi khi nguồn thiếu (§3); định nghĩa object identity bền vững bằng hàm thuần của `pointStableId` kèm bảng 9 biến cố (§4); luật capability gate ánh xạ 5 bit `IOP_BOARD_CAP_*` → loại object, và quyết định fail-closed có phân biệt cho `board_cap_valid = 0` (§5); trace 16 mục thiết kế về `SYS-REQ-BAC-*` (§6) |
