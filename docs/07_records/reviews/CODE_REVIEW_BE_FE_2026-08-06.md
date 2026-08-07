# Rà soát mã nguồn BE + FE theo module — 2026-08-06

> **ID:** REV-CODE-BE-FE-2026-08-06
> **Phạm vi:** `apps/web-api` (Go) và `apps/web-ui` (React/TS), kèm `platform/systemd`
> **Mốc mã nguồn:** `main` tại `5fef0b9`
> **Người rà:** Claude Opus 5 (`/code-review`)
> **Kết quả:** **15 finding** — 3 nghiêm trọng, 6 cao, 6 trung bình. **Chưa sửa cái nào.**

---

## 1. Nền kiểm chứng

Toàn bộ bộ test hiện có **đều xanh** trước khi rà:

| Gate | Kết quả |
|---|---|
| `go vet ./...` | sạch |
| `go test ./... -count=1` | **11/11 package `ok`** |
| `npx vitest --run --environment jsdom src` | **417/417 PASS**, 50 file |
| `ctest --test-dir build/fw` | **786/786 PASS** |

**Mọi finding dưới đây đều nằm ngoài vùng phủ của test hiện có.** Đó là thông tin
quan trọng hơn bản thân danh sách: bộ test xanh không nói lên rằng những đường
này đúng, chỉ nói rằng chưa ai viết test cho chúng.

## 2. Tổng hợp theo mức

| Mức | Số lượng | Mã |
|---|---:|---|
| **Nghiêm trọng** | 3 | `REV-BE-01`, `REV-BE-02`, `REV-PLT-01` |
| **Cao** | 6 | `REV-BE-03`, `REV-BE-04`, `REV-BE-05`, `REV-BE-06`, `REV-BE-07`, `REV-FE-01` |
| **Trung bình** | 6 | `REV-BE-08`, `REV-BE-09`, `REV-BE-10`, `REV-FE-02`, `REV-FE-03`, `REV-FE-04` |

### Chủ đề xuyên suốt

Ba trong bốn nhóm lỗi lặp lại đúng một khuôn mà phiên làm việc hôm nay đã sửa ở
chỗ khác:

1. **Tra cứu telemetry chỉ theo `slave_id`, bỏ qua `bus_id`** (`REV-BE-03`,
   `REV-BE-04`). Lỗi này đã được sửa ở `handleModbusDiagnostics` tại commit
   `b39652c`, nhưng **không lan sang bốn call site còn lại**. Sửa một chỗ mà
   không rà các chỗ cùng dạng thì lỗi vẫn còn nguyên ở nơi khác.
2. **Bịa giá trị thay vì nói "chưa biết"** (`REV-BE-07`, `REV-BE-10`,
   `REV-FE-04`) — vi phạm D-07, nguyên tắc mà chính codebase phát biểu rõ.
3. **Nuốt lỗi rồi chạy tiếp** (`REV-BE-05`, `REV-BE-07`) — hệ thống trông khoẻ
   trong khi một phần đã chết.

---

## 3. Nghiêm trọng

### `REV-BE-01` — PUT `/system/config/fieldbus` không có device/point sẽ **xoá sạch** cấu hình Modbus

**File:** [`internal/app/configapi.go:264`](../../../apps/web-api/internal/app/configapi.go)

Handler chỉ chạy `validateModbusRTUConfig` và đi qua `Persister` **khi**
`len(cfg.Devices) > 0 || len(cfg.Points) > 0`. Body rỗng làm cả hai điều kiện
sai, nên luồng rơi xuống `handlePutConfigValue` → `writeConfigGroup`.

**Kịch bản hỏng.** Admin (hoặc một client cũ) gửi `PUT /api/v1/system/config/fieldbus`
với `{}`. `validateConfigFieldbus` chỉ soi khối `rs485`/`slaves` cũ nên cho qua.
`writeConfigGroup` marshal struct zero-value **đè thẳng** lên `fieldbus.conf`:

- không giữ `pointConfigMu` (đua với mọi thao tác cấu hình khác),
- không qua `webModbus.Persister` ⇒ **không có journal, không rollback**,
- `Revision` về `0`, `Checksum` rỗng,
- **toàn bộ `buses[]`, `devices[]`, `points[]` biến mất**, rồi iobus được restart
  lên đúng cấu hình rỗng đó.

Nhánh `len>0` có gán `cfg.Revision = current.Revision` để giữ chuỗi revision;
nhánh rỗng không có gì tương đương.

**Vì sao đáng lo nhất trong danh sách:** đây là **mất dữ liệu không hoàn tác
được** qua một endpoint hợp lệ, không cần quyền gì đặc biệt ngoài Admin, và
đường đi tắt này chính là đường mà `Persister` sinh ra để chặn.

---

### `REV-BE-02` — WebSocket giữ quyền ghi sau khi token hết hạn và sau khi logout

**File:** [`internal/app/ws.go:71`](../../../apps/web-api/internal/app/ws.go)

`requireWSAuth` gọi `a.auth.Validate(token)` **đúng một lần lúc bắt tay**, rồi
nhét principal vào context. Socket sau đó sống bao lâu tuỳ ý, và
`handleMonitorForce` chỉ đọc lại `principalFromContext` — tức principal đã chụp
từ lúc mở kết nối.

**Kịch bản hỏng.** Operator mở trang Monitor (WS kết nối, token hợp lệ) rồi bấm
**Logout**. FE gọi `POST /auth/logout` → `AuthService.Revoke` và xoá phiên, nhưng
**server không hề đóng socket đang mở**. Bất kỳ ai đứng trước HMI bỏ trống đó —
hoặc giữ socket qua hạn TTL 1 giờ — vẫn còn quyền `op:"force"` mức Operator để
ghi xuống AO/DO/VP.

Cơ chế thu hồi phiên (`F-04`/`F-06`) bị vô hiệu **đúng trên kênh duy nhất thực
sự ghi xuống thiết bị**.

---

### `REV-PLT-01` — Bo chạy production với allowlist CORS/WS của chế độ dev

**File:** [`platform/systemd/mkddc-web-pi.service:11`](../../../platform/systemd/mkddc-web-pi.service)

`CORSOrigin` chỉ đọc từ biến môi trường (`config.go:83`). Unit đặt đúng
`PORT`, `CONFIG_DIR`, `STATIC_DIR`; `/etc/mkddc-web.env` do
`platform/packaging/install.sh` sinh ra **chỉ chứa `JWT_SECRET`**. Không chỗ nào
đặt `CORS_ORIGIN`.

Với giá trị rỗng, `isAllowedOrigin` (`http.go:126–130`) chấp nhận **mọi**
`http://localhost:*`, `http://127.0.0.1:*`, `http://[::1]:*`, và
`wsOriginPatterns` (`ws.go:190`) trả về đúng sáu mẫu loopback đó.

**Kịch bản hỏng.** Bất kỳ trang nào người vận hành mở trên một cổng loopback của
máy đang nói chuyện với DDC đều có thể gửi request cross-origin đã xác thực và
mở WebSocket giám sát. Nhánh allowlist đóng mà `F-11` viết ra để cưỡng chế là
**mã chết trong production**.

---

## 4. Cao

### `REV-BE-03` — `/modbus/buses` gán telemetry của dây này cho thiết bị của dây kia

**File:** [`internal/app/modbus_rtu.go:600`](../../../apps/web-api/internal/app/modbus_rtu.go) (và bộ đếm ở dòng 621)

`slaveByAddr` khoá theo **mỗi địa chỉ slave**, bỏ qua `bus_id`.

**Kịch bản hỏng.** Hai bus, mỗi bus một thiết bị ở `slave_id = 1` — cấu hình
**hợp lệ**, validator đã cho phép (unique theo từng bus). `telemetry.Slaves` có
`{Addr:1, BusID:1, Online:true}` và `{Addr:1, BusID:2, Online:false}`;
`slaveByAddr[1]` giữ phần tử đến sau. `GET /modbus/buses` báo
`online_devices = 0` cho **cả hai** bus (hoặc `1` cho cả hai), và cùng phép tra
ở dòng 621 cộng bộ đếm timeout/CRC của slave sai vào hàng bus sai.

Đây **đúng là lỗi đã sửa** ở `handleModbusDiagnostics` (commit `b39652c`, khoá
`(bus, slave)`) nhưng không được lan sang đây.

### `REV-BE-04` — Ba call site còn lại cùng lỗi khoá tra cứu

**File:** `internal/app/modbus_rtu.go:533` (`handleGetModbusOverview`), `:698`
(`recordModbusEvents`), `:471` (`getModbusDiagnostics`)

**Kịch bản hỏng.** `rs485-1` slave 1 ONLINE, `rs485-2` slave 1 đã chết.
`bySlave[1]` chỉ giữ được một. KPI Overview đếm thiết bị chết là Online (hoặc
ngược lại); `recordModbusEvents` phát sự kiện ONLINE→OFFLINE gắn **nhầm
`device_id`**; `getModbusDiagnostics` dán nhãn nhầm thiết bị.

Người vận hành được điều đi theo những con số này sẽ **tới nhầm tủ** — đúng hậu
quả mà khoá `(bus, slave)` ở dòng 128–140 sinh ra để ngăn.

### `REV-BE-05` — Lịch vận hành bỏ dở một tập ngẫu nhiên khi gặp lỗi đầu tiên

**File:** [`internal/app/virtualpoint_scheduler.go:66`](../../../apps/web-api/internal/app/virtualpoint_scheduler.go)

`applyVirtualPointSchedules` **`return` ngay** ở lỗi ghi đầu tiên.

**Kịch bản hỏng.** Một dòng lịch còn trỏ tới `VP-05` sau khi virtual point đó đã
bị xoá khỏi `virtual_points.conf`. `writeScheduledVirtualPointValue` trả
`virtual point VP-05 not found`, vòng lặp thoát ngay. Vì `winners` là **map của
Go**, thứ tự duyệt **ngẫu nhiên mỗi tick 5 giây**, nên một tập **tuỳ tiện và
không lặp lại được** trong số lịch còn lại (setpoint, chế độ vận hành, ngõ ra
analog) không bao giờ được áp.

Triệu chứng duy nhất là một dòng WARN trong log; giao diện vẫn hiện các lịch đó
là đang bật.

### `REV-BE-06` — Giới hạn tốc độ ghi thử chưa được cài

**File:** [`internal/app/modbus_rtu.go:230`](../../../apps/web-api/internal/app/modbus_rtu.go)

`handleModbusWriteTest` **không gọi** `a.commissionLimit.allow`. Chú thích của
`commissionLimiter` (`modbus_config_api.go:475`) nói `OD-MBRTU-007` yêu cầu
"write test 2 lần/phút/người dùng, read test 5 lần/phút", nhưng toàn repo chỉ có
**một** call site: `allow("read:"+user, 5, …)` ở `modbus_config_api.go:524`.

**Kịch bản hỏng.** Một tab trình duyệt kẹt hoặc script chạy vòng lặp trên
`POST /modbus/write-test` phát lệnh ghi **không giới hạn** xuống thiết bị hiện
trường đang chạy, chiếm băng thông RS-485 và đẩy **mọi slave khác trên cùng dây**
vào timeout — đúng sự cố mà bộ giới hạn được viết ra để chặn.

### `REV-BE-07` — Core chết trông giống hệt "thiết bị không có point nào"

**File:** [`internal/app/core_client.go:160`](../../../apps/web-api/internal/app/core_client.go)

`CoreClient.ReadPoints` **nuốt mọi lỗi đọc SHM** và trả về slice rỗng kèm
`nil` error.

**Kịch bản hỏng.** `mkddc-core` crash hoặc `shm_unlink` phân đoạn plc.
`readPLCShm` trả `không đọc được snapshot nhất quán`, nhưng `ReadPoints` bỏ qua
và trả `[]PointDTO{}, nil`. `App.ReadPoints` (`points.go:41`) thấy `err == nil`
nên `GET /api/v1/points` đáp **200 với `[]`**, và `sendMonitorSnapshot` đẩy một
bản cập nhật rỗng thay vì khung lỗi `StatusServiceUnavailable` mà nó **đã có sẵn
mã để phát**. Giao diện hiện bảng point rỗng kèm huy hiệu kết nối **màu khoẻ**.

`Sampler.sample` (`sampler.go:120`) kiểm cùng cái lỗi đã bị nuốt đó, nên
historian ghi lại sự cố thành "không có point nào" thay vì bỏ qua mẫu.

### `REV-FE-01` — Tiếp điểm `open` và `closed` hiển thị giống hệt nhau

**File:** [`src/shared/api/pointNormalizer.ts:100`](../../../apps/web-ui/src/shared/api/pointNormalizer.ts)

`pointValue` xếp **cả `open` lẫn `closed`** vào danh sách truthy
`['true','on','open','closed','active']`, còn danh sách falsy
`['false','off','inactive']` không bao giờ thấy chúng.

**Kịch bản hỏng.** Core hoặc một point Modbus trả `{"value":"open"}` cho tiếp
điểm DO/DI. Hàm trả `true`, nên trang Monitor/Outputs hiện tiếp điểm **đang mở**
thành **ON / đã cấp điện**.

Chính kiểu dữ liệu của dự án khẳng định hai giá trị này là **đối lập**
(`DoSafeState = 'open' | 'closed'`, `types.ts:820`), nên một trong hai bắt buộc
phải map sang `false`.

---

## 5. Trung bình

### `REV-BE-08` — `overlayPointMetadata` xoá provenance do core cấp

**File:** [`internal/app/points.go:194`](../../../apps/web-api/internal/app/points.go)

`handleForcePoint` gọi `forcer.ForcePoint` (đặt `Source` = `"core"` hoặc
`"core_unavailable"` / `"rejected:…"`), rồi đưa kết quả qua
`overlayPointMetadata` ở dòng 288. Switch ở 188–195 **ghi đè `Source`** bằng
`"local_physical_io"` / `"modbus_rtu"` / `"virtual_point"` chỉ dựa trên `Kind`.

Hệ quả: FE (`normalizePoint` đọc `raw.source`) **không bao giờ** biết được một
giá trị đến từ lệnh ép tay hay từ một core đang suy giảm. Nó cũng phá hợp đồng
`strings.Contains(point.Source, "core_unavailable")` mà `ws.go:296` đang dựa vào.

### `REV-BE-09` — `busIDForPort` im lặng dồn mọi cổng lạ về bus 1

**File:** [`internal/modbusrtu/bus.go:280`](../../../apps/web-api/internal/modbusrtu/bus.go)

Cổng không khớp `rs485-1`/`rs485-2` rơi xuống `return "rs485-1"`.

**Kịch bản hỏng.** Một device mang `rs485_port: "/dev/ttyUSB0"` (cấu hình cũ,
file sửa tay, hoặc bo có manifest khác). `ApplyBusInheritance` (dòng 231) đóng
dấu nó bằng baud/parity của bus 1, và `handleModbusDiagnostics`
(`modbus_rtu.go:135`) xếp nó vào bus 1.

`NumericID` (dòng 98–101) **phát biểu chính sách ngược lại** cho cùng một phép
ánh xạ: *"Không parse được ⇒ 0 … im lặng gán 1 sẽ dồn mọi thiết bị lên một dây"*.
Hai nửa của cùng đường giải bus đang nói khác nhau; nửa này nên trả `""` và để
validator từ chối.

### `REV-BE-10` — `/modbus/buses` đếm trùng lỗi timeout và xoá trắng CRC

**File:** [`internal/app/modbus_rtu.go:612`](../../../apps/web-api/internal/app/modbus_rtu.go)

Dòng 612 gán `info.TimeoutErrors = ` **`TotalErrors` của cả bus** (gồm mọi
nguyên nhân: timeout, CRC, exception); dòng 613 đặt `info.CrcErrors = 0`, vứt bỏ
tổng CRC đã đo được; rồi dòng 622–623 **cộng thêm** `TimeoutErrors` của từng
slave lên trên.

**Kịch bản hỏng.** Bus ghi `TotalErrors = 100`, hai slave ghi `TimeoutErrors`
`40` và `30`. API báo `timeout_errors = 170` cho một bus **có nhiều nhất 100 lỗi
tổng cộng**. Trang Cổng/Tổng quan trình bày con số thổi phồng đó như một **số đo
thật**, trái với quy tắc mà chính file này ghi: *"mọi con số đến từ
`kx_bus_metrics_t` … không bịa"*.

### `REV-FE-02` — Đổi kênh ngõ ra làm mất chỉnh sửa chưa lưu

**File:** [`src/features/points/OutputsPage.tsx:84`](../../../apps/web-ui/src/features/points/OutputsPage.tsx)

Effect nạp `getOutputs()` liệt kê `selectedId` trong mảng phụ thuộc **trong khi
chính nó gọi `setSelectedId`**.

**Kịch bản hỏng.** Người vận hành sửa `minPv`/`maxPv`/`safeValue` của AO-01 (chỉ
nằm trong state `config` cục bộ) rồi bấm sang AO-02. `setSelectedId('AO-02')`
chạy lại effect, `apiClient.getOutputs()` trả về cấu hình đã lưu, và `setConfig`
(dòng 68) **âm thầm vứt bỏ** mọi thay đổi chưa lưu của AO-01 — không một cảnh
báo. Kèm theo là một vòng HTTP thừa mỗi lần bấm kênh.

Effect tương ứng ở `InputsPage.tsx:81` **không** đưa state lựa chọn vào deps,
xác nhận phụ thuộc thừa này là ngoài ý muốn.

### `REV-FE-03` — `AUTH_MODE=apikey` dựng phiên "admin" mà mọi request đều 401

**File:** [`src/features/auth/AuthProvider.tsx:34`](../../../apps/web-ui/src/features/auth/AuthProvider.tsx)

Với `VITE_AUTH_MODE=apikey`, `login()` (dòng 60–63) **bỏ qua hẳn** `/auth/login`
và đặt `{role:'admin', apiKey:password}`. `getAuthHeader` phát header
`X-API-Key`, nhưng tìm khắp `apps/web-api` **không có tham chiếu nào** tới header
đó — `auth.Require` chỉ gọi `BearerToken(r)` (`service.go:399`).

Mọi request được bảo vệ trả 401, kích hoạt `mkddc:auth-expired` và xoá phiên
ngay, nên người dùng bị đá về trang đăng nhập **không kèm giải thích**. Giá trị
`role:'admin'` viết cứng cũng mâu thuẫn trực tiếp với bản vá `F-07` nằm ngay bên
dưới, vốn cố ý đưa vai trò lạ về `viewer`.

### `REV-FE-04` — "Chưa có dữ liệu" hiển thị thành số 0 đã đo

**File:** [`src/shared/api/pointNormalizer.ts:104`](../../../apps/web-ui/src/shared/api/pointNormalizer.ts)

`pointValue` trả **literal `0`** khi point không mang giá trị nào.

**Kịch bản hỏng.** Một point Modbus RTU chưa từng được poll, hoặc point của core
có trường `value` vắng/`null`, đến với `raw.value`, `present_value`, `pv`, `raw`,
`state` đều `undefined`. Hàm trả `0`, nên bảng Monitor/Trends hiện **0 °C / 0 %**
như một số đo thật. `isPhysicalTrendPoint` (`TrendsPage.tsx:60`) coi nó là vẽ
được, và `appendLiveTrendSample` **ghi số 0 đó vào đuôi biểu đồ live**.

Đây đúng lớp lỗi bịa dữ liệu mà phía BE đã ghi thành nguyên tắc D-07 (*"không
suy diễn, không bịa"*) và xử lý bằng cách trả con trỏ `null` cho telemetry chưa
đo được. Biên FE nên trả `undefined` và để nơi gọi hiển thị `NO_DATA`.

---

## 6. Đề xuất thứ tự xử lý

| Đợt | Finding | Lý do gộp |
|---|---|---|
| **1 — chặn phát hành** | `REV-BE-01`, `REV-BE-02`, `REV-PLT-01` | Mất dữ liệu và hai lỗ hổng quyền truy cập trên đường ghi xuống thiết bị |
| **2 — cùng một khuôn** | `REV-BE-03`, `REV-BE-04`, `REV-BE-09` | Cùng là lỗi giải bus; sửa một lượt kèm **một test dùng chung** cho mọi call site telemetry |
| **3 — trung thực dữ liệu** | `REV-BE-07`, `REV-BE-10`, `REV-FE-01`, `REV-FE-04` | Đều là "bịa số thay vì nói chưa biết" (D-07) |
| **4 — còn lại** | `REV-BE-05`, `REV-BE-06`, `REV-BE-08`, `REV-FE-02`, `REV-FE-03` | Độc lập nhau |

**Khuyến nghị về test.** Nhóm 2 không nên sửa bằng bốn bản vá rời. Bốn call site
lặp lại cùng một phép tra cứu, nên đường bền vững là **một hàm tra cứu duy nhất
khoá theo `(bus, slave)`** cộng một test bảng chạy qua mọi endpoint dùng
telemetry — nếu không, call site thứ năm ra đời sau sẽ lặp lại đúng lỗi này.

---

## Revision history

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-06 | Tạo báo cáo: rà BE + FE theo module tại `5fef0b9`; 15 finding (3 nghiêm trọng, 6 cao, 6 trung bình); xác minh trực tiếp mã nguồn cho ba finding nghiêm trọng; ghi nhận cả 15 đều nằm ngoài vùng phủ của bộ test đang xanh |
