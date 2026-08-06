# Báo cáo soi lỗi giao diện theo từng trang — board Foxlinx, 2026-08-06

> **ID:** REV-FE-BOARD-PAGE-2026-08-06
> **Board:** `SOM-DDC-24-foxlinx` — `root@mekong-fac.ddns.net`, cổng web ngoài `:8082` → nội bộ `:8081`
> **Bản đã deploy:** FW-SOM + BE + FE dựng từ `main` (`5313f78`) rồi vá trong chính phiên này
> **Cách kiểm:** Chromium thật (Playwright 1.61) trỏ vào `mkddc-web` trên board qua SSH tunnel,
> JWT thật, RBAC thật, **không mock gì**. Spec: `apps/web-ui/e2e-board/board-page-audit.spec.ts`.
> Dữ liệu thô: `/tmp/board-page-audit-final.json`, ảnh chụp: `/tmp/board-audit-shots/`.

---

## 1. Tóm tắt

| Hạng mục | Trước khi vá | Sau khi vá |
|---|---|---|
| Trang **trắng hoàn toàn** | **6/23** (toàn bộ nhánh Modbus RTU) | **0/23** |
| Exception chưa bắt (JS) | **1 loại, lặp ở mọi tab Modbus** | **0** |
| Trang render đủ nội dung | 17/23 | **23/23** |
| HTTP lỗi còn lại | — | 1 loại (503 `/modbus/diagnostics`, **đúng thiết kế**) |

**Một lỗi nghiêm trọng, đã sửa.** Trang trắng ông gặp ở `:8082/eng/modbus-rtu` là lỗi
thật, do chính phiên triển khai Track B tạo ra. Toàn bộ 5 tab Modbus RTU đều trắng.

## 2. Lỗi nghiêm trọng — trang trắng ở mọi tab Modbus RTU

**Mã:** `FE-BOARD-01` · **Mức:** Nghiêm trọng · **Trạng thái:** ĐÃ SỬA

### Triệu chứng

Mở `/eng/modbus-rtu` (và 4 tab con) → **màn hình đen hoàn toàn**: không tiêu đề,
không menu, không một dòng chữ. Console:

```
Uncaught TypeError: Cannot read properties of null (reading 'length')
    at Yo (index-BhdtA5Ij.js:1:167154)
```

### Nguyên nhân gốc

Ba tầng cùng góp phần, và không tầng nào một mình gây ra hậu quả này:

1. **Backend trả `null` cho danh sách rỗng.** Go tuần tự hoá nil slice thành
   `null`, nên `GET /api/v1/modbus/config/state` trả `"diff": null` khi chưa có
   thay đổi nào — thay vì `[]`.
2. **Frontend chắn thiếu.** `ConfigStateBanner` viết `state?.diff.length` —
   optional chaining chỉ chắn `state`, **không** chắn `state.diff`. Gặp `null`
   là ném `TypeError` ngay trong lúc render.
3. **Không có ranh giới lỗi.** Ứng dụng không có `ErrorBoundary` nào, nên React
   unmount **toàn bộ cây** khi có exception chưa bắt. Vì banner nằm ở
   `ModbusRtuLayout`, cả 5 tab con chết theo.

Với một tủ điều khiển đang vận hành, "màn hình trống" là tình huống tệ nhất:
người vận hành không phân biệt được phần mềm hỏng với mất điện.

### Cách sửa (cả ba tầng)

| Tầng | Sửa gì | File |
|---|---|---|
| BE | `Diff()` trả slice rỗng, không phải nil; `/modbus/devices` và `/modbus/points` trả `[]` | `internal/modbusrtu/candidate.go`, `internal/app/modbus_rtu.go` |
| FE — biên vào | `asList()` chuẩn hoá `null → []` cho MỌI endpoint danh sách Modbus, chắn ở **một chỗ** thay vì rải `?? []` khắp component | `shared/api/client.ts` |
| FE — component | `ConfigStateBanner` và `MappingPage` chắn `diff`/`rows`/`errors`/`load` tường minh | `components/ConfigStateBanner.tsx`, `pages/MappingPage.tsx` |
| FE — an toàn chung | Thêm `RouteErrorBoundary` bọc `<Outlet />` ở `AppShell`: một trang lỗi chỉ làm hỏng **trang đó**, giữ nguyên menu và nói rõ lỗi | `shared/components/RouteErrorBoundary.tsx`, `AppShell.tsx` |

### Kiểm chứng

Xác minh trực tiếp trên API của board sau khi vá:

```
diff     = []
devices  = []
points   = []
```

Test hồi quy đã thêm (6 test):
`ConfigStateBanner` với `diff: null` và với **thiếu hẳn** trường `diff`;
`MappingPage` với `rows/errors/load: null`; `RouteErrorBoundary` 3 test.

## 3. Kết quả theo TỪNG TRANG (sau khi vá)

Cột "Nội dung" là số ký tự văn bản hiển thị — dùng để phát hiện trang trống.

| # | Trang | Đường dẫn | Nội dung | Tiêu đề render | Kết quả |
|---:|---|---|---:|---|---|
| 1 | Dashboard | `/` | 1754 | Dashboard · Communication status · Services · IOP · Scan metrics | ✅ OK |
| 2 | Giám sát | `/monitor` | 1995 | Monitor I/O · Point details · Status history | ✅ OK |
| 3 | Trends | `/trends` | 3290 | Trends · Series · Analog trend 30 min | ✅ OK |
| 4 | Cảnh báo | `/alarms` | 768 | Alarms · Alarm history | ✅ OK |
| 5 | **Modbus · Tổng quan** | `/eng/modbus-rtu` | 1540 | Modbus RTU Management · Tổng quan | ✅ OK *(trước: TRẮNG)* |
| 6 | **Modbus · Tổng quan (alias)** | `/eng/modbus-rtu/overview` | 1540 | như trên | ✅ OK *(trước: TRẮNG)* |
| 7 | **Modbus · Thiết bị** | `/eng/modbus-rtu/devices` | 1151 | Quản lý Thiết bị (Devices) | ⚠️ Xem §4.1 *(trước: TRẮNG)* |
| 8 | **Modbus · Points** | `/eng/modbus-rtu/points` | 1109 | Quản lý Point | ✅ OK *(trước: TRẮNG)* |
| 9 | **Modbus · Mapping** | `/eng/modbus-rtu/mapping` | 1016 | Mapping | ✅ OK *(trang mới)* |
| 10 | **Modbus · Diagnostics** | `/eng/modbus-rtu/diagnostics` | 946 | Diagnostics | ⚠️ Xem §4.1 *(trước: TRẮNG)* |
| 11 | Ngõ vào | `/eng/inputs` | 1107 | UI Inputs Config · UI Channels | ✅ OK |
| 12 | Ngõ ra | `/eng/outputs` | 1129 | Outputs Config · Output Channels | ✅ OK |
| 13 | Điểm ảo | `/eng/virtual-points` | 554 | Virtual Points · Created VP · No data | ✅ OK (rỗng đúng) |
| 14 | Lịch vận hành | `/eng/scheduler` | 490 | Scheduler · Schedules · No data | ✅ OK (rỗng đúng) |
| 15 | Cấu hình cảnh báo | `/eng/alarm-settings` | 543 | Alarm settings · Alarm entities · No data | ✅ OK (rỗng đúng) |
| 16 | Commissioning | `/eng/commissioning` | 1354 | Commissioning · Output test | ✅ OK |
| 17 | Tham số người dùng | `/eng/user-parameters` | 417 | User Parameters · User Parameters | ⚠️ Xem §4.2 |
| 18 | Sơ đồ | `/eng/diagram` | 949 | Controller Diagram | ✅ OK |
| 19 | Chức năng phụ | `/eng/aux` | 848 | Auxiliary Functions · Select Function | ✅ OK |
| 20 | Người dùng | `/settings/users` | 479 | Users | ✅ OK |
| 21 | Mạng | `/settings/network` | 1904 | Network · Ethernet · Northbound BACnet/IP · Southbound RS-485 | ✅ OK |
| 22 | *(đường dẫn không tồn tại)* | `/settings/system` | — | → chuyển về `/` | ℹ️ Xem §4.3 |
| 23 | *(đường dẫn không tồn tại)* | `/settings/historian` | — | → chuyển về `/` | ℹ️ Xem §4.3 |

**Deeplink (gõ thẳng URL / F5):** cả 23 đường dẫn đều chuyển về `/login` — đúng
thiết kế, vì phiên đăng nhập chỉ nằm trong React state (lựa chọn an ninh có chủ
ý). Không có trang nào trắng ở chế độ này.

## 4. Quan sát còn lại (không phải lỗi chặn)

### 4.1 `/modbus/diagnostics` trả 503 — ĐÚNG THIẾT KẾ, nhưng cần đọc đúng

Board hiện **không có `fieldbus.conf`** (chưa cấu hình thiết bị Modbus nào), nên
iobus chưa publish telemetry và endpoint trả `503 iobus chưa publish telemetry
Modbus RTU`.

Đây **không phải lỗi**: 503 là cách contract phân biệt "chưa biết" với "biết rồi
và bằng 0" (D-07). Hai trang xử lý như sau:

- **Diagnostics** — hiện đúng: `⚠️ Không đọc được diagnostics: iobus chưa publish
  telemetry Modbus RTU`.
- **Thiết bị** — bản trước `catch {}` **nuốt im lặng**, cột "Liên lạc" hiện `—`
  mà không nói vì sao. **Đã sửa trong phiên này**: thêm ghi chú giải thích, kèm
  test hồi quy.

Console vẫn ghi một dòng 503 mỗi lần tải trang. Đó là hệ quả tự nhiên của thiết
kế và sẽ hết ngay khi board có `fieldbus.conf`.

### 4.2 `/eng/user-parameters` — tiêu đề lặp

`<h1>` và `<h2>` cùng chuỗi "User Parameters". Chỉ là nhiễu thị giác, không phải
lỗi chức năng. Cùng loại với `FE-MB-02` đã sửa cho Modbus RTU. **Chưa sửa** —
nằm ngoài phạm vi Modbus RTU của phiên này.

### 4.3 Đường dẫn không tồn tại chuyển hướng im lặng

`/settings/system` và `/settings/historian` **không phải route của ứng dụng**
(menu không hề trỏ tới) — chúng do bộ kiểm tự thêm vào để dò. Chúng rơi vào
`<Route path="*">` và chuyển về `/`, thanh địa chỉ tự sửa lại thành `/` nên
người dùng không bị hiểu nhầm. Tuy vậy đây vẫn là kiểu "chuyển hướng không giải
thích" mà `WEB-UX-007` đã quyết định là sai; nếu sau này có link cũ trỏ vào, nên
hiện trang giải thích thay vì đá về Dashboard. **Mức: thấp, chưa sửa.**

## 5. Trạng thái board sau phiên

```text
mkddc-iobus    active   NRestarts=0
mkddc-core     active   NRestarts=0
mkddc-web-pi   active   NRestarts=0
/health        status=ok  (core, iobus, io_shm, plc_shm, mcu_connection, web đều ok)
/dev/shm/mkddc_io_shm    3568 byte    (ABI v5)
/dev/shm/mkddc_plc_shm  23104 byte    (ABI v5)
FE bundle      index-Cdw6_1xu.js
```

## 6. Bốn cổng gate sau khi vá

| Gate | Kết quả |
|---|---|
| `ctest --test-dir build/fw` | **777/777 PASS** |
| `go vet ./...` + `go test ./... -count=1` | **vet sạch, 11/11 package `ok`** |
| `npx vitest --run --environment jsdom src` | **394/394 PASS**, 48 file |
| `npm run lint` / `npm run build` | **PASS**, 0 warning |
| Soi trang trên board (23 trang × 2 chế độ) | **46/46 bản ghi, 0 trang trắng, 0 exception** |

---

## Revision history

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-06 | Tạo báo cáo: deploy 3 tầng lên Foxlinx, tìm và sửa `FE-BOARD-01` (trang trắng toàn nhánh Modbus RTU), soi 23 trang bằng Chromium thật |
