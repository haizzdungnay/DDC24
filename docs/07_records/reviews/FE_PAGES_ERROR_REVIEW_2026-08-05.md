# Review FE — vì sao "lỗi hết mấy cái page"

**Ngày:** 2026-08-05
**Phạm vi:** `apps/web-ui/` — toàn bộ 27 route đăng ký trong `src/app/App.tsx`
**Baseline:** `main` tại `4dff747` + 1 file untracked (`features/modbus-rtu/pages/DevicesPage.tsx`)
**Loại tài liệu:** Record (as-built). Không đổi Product Spec, không đóng gate.

---

## 1. Kết luận ngắn

Không có trang nào crash bằng JavaScript. Gate xanh hoàn toàn: `tsc --noEmit` 0 lỗi,
`eslint src --max-warnings=0` 0 warning, `vitest` **306/306 pass (36 file)**.

Cái mà người dùng thấy là "lỗi hết mấy cái page" đến từ **bốn nguyên nhân độc lập**,
không phải một:

| Nhóm | Triệu chứng người dùng thấy | Nguyên nhân gốc |
|---|---|---|
| A | 3 tab Modbus RTU (Thiết bị/Points/Diagnostics) giống hệt nhau, tiêu đề lặp 2 lần | `MBR-B301` mới làm được 2/5 page; 3 route còn lại vẫn trỏ về page monolith cũ |
| B | Bấm F5 hoặc mở deep link ở tab mới → văng về `/login` ở **mọi** trang | Phiên đăng nhập chỉ nằm trong React state, không persist |
| C | Trang trắng/không có dữ liệu khi backend chết | Một phần trang báo lỗi đàng hoàng, một phần **im lặng báo dữ liệu giả** |
| D | Chạy dev local thì mọi API 502 | Cổng proxy Vite (8081) lệch cổng mặc định của backend (8080) |

Nhóm A là hồi quy mới của sprint hôm nay. Nhóm B và C là nợ cũ. Nhóm D là lỗi
môi trường phát triển.

---

## 2. Cách đo

Crawl thật bằng Chrome (Playwright) qua đủ 27 route, ghi lại `pageerror`,
console error/warning, request failed và mọi HTTP ≥ 400; chạy hai lần:

1. `VITE_DDC_MODE=demo` — tách lỗi code FE khỏi lỗi "không có backend".
2. `VITE_DDC_MODE=live` không có backend — mô phỏng đúng cảnh authority chết.

Điều hướng bằng `history.pushState` + `popstate` (điều hướng phía client), **không**
dùng `page.goto` — lý do ở §4.

Kết quả demo: **0 pageerror, 0 console error trên cả 27 route.** Mọi trang render
đúng tiêu đề và nội dung. Nghĩa là không có lỗi runtime JS nào.

---

## 3. Nhóm A — Modbus RTU: 3 sub-page trỏ nhầm (hồi quy 2026-08-05)

Commit `7eb3a2b` dựng `ModbusRtuLayout` + tab + `OverviewPage`, nhưng
[App.tsx:126-132](../../../apps/web-ui/src/app/App.tsx#L126-L132) nối 3 tab còn lại
về đúng một component cũ:

```tsx
<Route path="devices"     element={<ModbusRtuPage />} />
<Route path="points"      element={<ModbusRtuPage />} />
<Route path="diagnostics" element={<ModbusRtuPage />} />
```

### FE-MB-01 — Ba tab hiển thị y hệt nhau

Bằng chứng crawl (demo mode), ba route khác nhau trả về cùng một nội dung, cùng số
ký tự:

```
/eng/modbus-rtu/devices      body 1278 chars  h2: ["Device Manager","Point Manager","CRC / timeout / retry diagnostics"]
/eng/modbus-rtu/points       body 1278 chars  h2: ["Device Manager","Point Manager","CRC / timeout / retry diagnostics"]
/eng/modbus-rtu/diagnostics  body 1278 chars  h2: ["Device Manager","Point Manager","CRC / timeout / retry diagnostics"]
```

Tab active đổi màu (logic `startsWith` trong layout đúng), nhưng nội dung không đổi.
Người dùng bấm tab thấy giao diện đứng yên ⇒ kết luận "trang hỏng".

### FE-MB-02 — Tiêu đề H1 lặp hai lần

`ModbusRtuLayout` render `<h1>Modbus RTU Management</h1>`
([ModbusRtuLayout.tsx:24](../../../apps/web-ui/src/features/modbus-rtu/ModbusRtuLayout.tsx#L24)),
`ModbusRtuPage` render thêm `<h1>Modbus RTU Device & Point Manager</h1>`
(`ModbusRtuPage.tsx:136`).
Crawl xác nhận `h1: ["Modbus RTU Management","Modbus RTU Device & Point Manager"]`.

Hai H1 trong một document là lỗi cấu trúc tài liệu, và với người dùng là hai tiêu đề
chồng nhau — dấu hiệu trực quan rõ nhất của "trang bị lỗi".

### FE-MB-03 — Padding lồng ba lớp và `<main>` lồng `<main>`

- `AppShell` bọc `<main className="p-5">` ([AppShell.tsx:42](../../../apps/web-ui/src/shared/components/AppShell.tsx#L42))
- `ModbusRtuLayout` thêm `p-4 md:p-6` và mở thêm một `<main>` nữa ([ModbusRtuLayout.tsx:21,64](../../../apps/web-ui/src/features/modbus-rtu/ModbusRtuLayout.tsx#L64))
- `ModbusRtuPage` thêm `p-4 md:p-6` lần thứ ba (`ModbusRtuPage.tsx:134`)

Kết quả: nội dung 3 tab thụt vào sâu bất thường so với tab Tổng quan. `<main>` lồng
`<main>` cũng phá landmark navigation của screen reader.

### FE-MB-04 — Deep link lọc trạng thái không có tác dụng

KPI card "Offline" ở Overview điều hướng
`/eng/modbus-rtu/devices?status=OFFLINE`
([OverviewPage.tsx:109](../../../apps/web-ui/src/features/modbus-rtu/pages/OverviewPage.tsx#L109)),
nhưng `ModbusRtuPage` không đọc `location.search`. Bấm "Xem danh sách →" ra danh sách
đầy đủ, không lọc — luồng chính của Landing Page vừa làm xong đã đứt ngay tại đích.

### FE-MB-05 — `DevicesPage.tsx` đã viết xong nhưng chưa nối vào đâu

`apps/web-ui/src/features/modbus-rtu/pages/DevicesPage.tsx` (399 dòng, untracked) là
**đúng** trang lẽ ra phải nhận route `devices`: nó có header riêng không lặp H1, không
tự thêm padding, và **có đọc `?status=`**
([DevicesPage.tsx:42-43, 95-102](../../../apps/web-ui/src/features/modbus-rtu/pages/DevicesPage.tsx#L95-L102)).

Nhưng nó không được export ở
[index.ts](../../../apps/web-ui/src/features/modbus-rtu/index.ts) và không xuất hiện
trong `App.tsx` ⇒ hiện là dead code. Đây là mảnh còn thiếu của FE-MB-01 và FE-MB-04.

### FE-MB-06 — `MBR-B301` mới xong 2/5 page

Plan 49 §Track B, `MBR-B301`: *"Tách feature thành 5 page + layout + tab"*.
Hiện có: layout ✔, tab ✔, `OverviewPage` ✔, `DevicesPage` (viết rồi, chưa nối).
**Còn thiếu:** `PointsPage`, `DiagnosticsPage`, và page thứ 5 (Mapping — `MBR-B306`).

### Vì sao 306 test không bắt được nhóm A

`ModbusRtuPage.test.tsx`
render thẳng `<ModbusRtuPage />`, không đi qua router và không đi qua
`ModbusRtuLayout`. [OverviewPage.test.tsx](../../../apps/web-ui/src/features/modbus-rtu/pages/OverviewPage.test.tsx#L5)
cũng render thẳng `<OverviewPage />` trong `BrowserRouter` trần.

Không test nào render **layout + outlet**, nên H1 lặp, padding lồng và ba tab trùng
nội dung đều vô hình với suite. Đây là khoảng trống test, không phải may rủi.

---

## 4. Nhóm B — Phiên đăng nhập không sống sót qua reload

Lần crawl đầu tiên dùng `page.goto()` (tải lại trang thật) cho kết quả: **cả 27 route
đều trả về `/login`, body chỉ 198 ký tự**. Đây là hành vi khiến "lỗi hết mấy cái
page" đúng theo nghĩa đen.

Nguyên nhân: [AuthProvider.tsx:29](../../../apps/web-ui/src/features/auth/AuthProvider.tsx#L29)
giữ phiên bằng `useState<Session|null>(null)` và không ghi vào
`localStorage`/`sessionStorage`. Toàn repo chỉ có `localStorage` cho theme, ngôn ngữ
và preset scheduler — không có gì cho phiên.

**Đây không phải hồi quy.** Hành vi đã được ghi nhận là lựa chọn an ninh có chủ ý
trong [board verification 2026-08-01 §4ter.2](../test-evidence/fw-som/2026-08-01-plan45-track-a-board-verification.md)
— không để token nằm trên đĩa của một HMI dùng chung — và đã có test chốt hành vi.

Nhưng cái giá vận hành là thật và cộng hưởng với FE-AUTH-02 dưới đây.

### FE-AUTH-02 — Một lần 401 làm mất phiên trên toàn app

[client.ts:224-226](../../../apps/web-ui/src/shared/api/client.ts#L224-L226) phát
`mkddc:auth-expired` với **bất kỳ** response 401 nào;
[AuthProvider.tsx:43-51](../../../apps/web-ui/src/features/auth/AuthProvider.tsx#L43-L51)
bắt event đó và `setSession(null)`.

JWT TTL là 1 giờ và **không có đường refresh**. Nghĩa là cứ sau ~1 giờ, request nền
đầu tiên (`/alarms` poll mỗi 1 s, `/health` mỗi 5 s) sẽ 401 → xoá phiên → mọi trang
đang mở bật về `/login`, mất luôn thao tác đang dở. Với ca trực để màn hình mở cả
ngày, đây là triệu chứng "tự nhiên trang nào cũng hỏng".

---

## 5. Nhóm C — Hành vi khi authority chết (live mode, không backend)

Crawl live không backend, mọi endpoint trả 502. Kết quả chia làm ba mức:

**Mức tốt — báo lỗi rõ + nút Retry** (7 trang, dùng `StateBlock`):

| Route | Nội dung hiển thị |
|---|---|
| `/` | "Could not load I/O points — 502 Bad Gateway — Retry" |
| `/alarms` | "Could not load alarms — 502 — Retry" |
| `/settings/users` | "Could not load users — 502 — Retry" |
| `/settings/network` | "Could not load network settings — 502 — Retry" |
| `/settings/time` | "Could not load time settings — 502 — Retry" |
| `/settings/device` | "Could not load device configuration — 502 — Retry" |
| `/eng/commissioning` | "Could not load outputs — 502 — Retry" |

Các trang này **đúng**. Nếu người dùng báo "trang trắng", nhiều khả năng họ đang nhìn
đúng cái card lỗi này trên nền trống — nên cân nhắc làm nó nổi bật hơn.

### FE-DATA-01 — `/monitor` báo dữ liệu giả thay vì báo lỗi (nặng)

Khi mọi API 502, `/monitor` vẫn render đầy đủ và hiển thị:

```
TOTAL POINTS 0        UI 0 | DO 0 | AO 0
ON POINTS 0           0%
NORMAL UI/AO POINTS 0 100%
FAULT / SIGNAL-LOSS POINTS 0   0%
```

**"100% NORMAL" và "0% FAULT" trong khi thực tế là không đọc được gì.**
[MonitorPage.tsx:110](../../../apps/web-ui/src/features/points/MonitorPage.tsx#L110)
lấy `pointsState = useApi(apiClient.getPoints, …)` nhưng **không đọc
`pointsState.error` ở bất kỳ đâu** — toàn bộ `error` trong file chỉ là toast của
đường mutation.

Trên một màn hình giám sát DDC, "không có dữ liệu" bị trình bày thành "mọi thứ bình
thường" là lỗi an toàn vận hành, cùng họ với D-07 đã sửa cho Modbus.

### FE-DATA-02 — Năm trang khác hiện "No data" thay vì lỗi

`/eng/inputs`, `/eng/outputs`, `/eng/virtual-points`, `/eng/scheduler`,
`/eng/alarm-settings` đều render tiêu đề + bảng rỗng với nhãn "No data" khi API 502.
Nhẹ hơn `/monitor` (không khẳng định "bình thường"), nhưng vẫn không phân biệt được
"chưa cấu hình gì" với "không đọc được".

Ghi chú: [CommissioningPage.tsx:31](../../../apps/web-ui/src/features/points/CommissioningPage.tsx#L31)
đã có comment mô tả **đúng** lỗi này và đã được sửa cho riêng trang đó. Năm trang trên
chưa được áp dụng cùng cách sửa.

---

## 6. Nhóm D — Proxy dev lệch cổng backend

| Nơi | Giá trị |
|---|---|
| [vite.config.ts:10](../../../apps/web-ui/vite.config.ts#L10) | `VITE_PROXY_TARGET \|\| 'http://127.0.0.1:8081'` |
| [config.go:45](../../../apps/web-api/internal/app/config.go#L45) | `port := getenv("PORT", "8080")` |
| [mkddc-web-pi.service:11](../../../platform/systemd/mkddc-web-pi.service#L11) | `Environment=PORT=8081` |

Trên board thì khớp (systemd ép 8081). Nhưng chạy dev local bằng `go run` mà không
set `PORT` thì backend nghe 8080, proxy gõ 8081 ⇒ **mọi endpoint 502** ⇒ đúng cảnh
"vào trang nào cũng lỗi". Không có lỗi nào trong code FE, chỉ là hai giá trị mặc định
không đồng bộ.

---

## 7. Số đo kiểm chứng phiên này

| Bộ | Lệnh | Kết quả |
|---|---|---|
| FE typecheck | `npx tsc --noEmit` | 0 lỗi |
| FE lint | `npm run lint` | 0 warning |
| FE unit | `npx vitest --run --environment jsdom src` | **306/306 pass**, 36 file, 24,08 s |
| Crawl demo | Playwright, 27 route | 0 pageerror, 0 console error |
| Crawl live (không BE) | Playwright, 27 route | 0 pageerror; 502 toàn bộ endpoint như mong đợi |

Lưu ý bẫy đã biết: `npm test` chỉ quét `src/`, **không** chạy `e2e/`.

---

## 7bis. Hậu kiểm bằng trình duyệt sau bản sửa

Crawl lại đúng 27 route bằng Chrome sau khi sửa (cùng phương pháp §2). Bảng dưới
là bằng chứng đối chiếu trước/sau, không phải suy luận từ code:

**Nhóm A — Modbus RTU (demo mode):**

| Route | H1 trước | H1 sau | H2 riêng của tab (sau) |
|---|---|---|---|
| `/eng/modbus-rtu` | 1 | **1** | `Modbus RTU · Tổng quan` |
| `/eng/modbus-rtu/overview` | 1 | **1** | `Modbus RTU · Tổng quan` |
| `/eng/modbus-rtu/devices` | 2 | **1** | `Modbus RTU · Quản lý Thiết bị (Devices)` |
| `/eng/modbus-rtu/points` | 2 | **1** | `Modbus RTU · Quản lý Point` |
| `/eng/modbus-rtu/diagnostics` | 2 | **1** | `Modbus RTU · Diagnostics` |

Ba tab từng trả về cùng 1278 ký tự body nay có tiêu đề mục khác nhau.

**Nhóm C — live mode, không backend, mọi endpoint 502:**

| Route | Trước | Sau |
|---|---|---|
| `/monitor` | "0 điểm · 0% FAULT · **100% NORMAL**" | `Could not load I/O points — 502 — Retry` |
| `/eng/inputs` | "No data" | `Could not load input configuration — Retry` |
| `/eng/outputs` | "No data" | `Could not load output configuration — Retry` |
| `/eng/virtual-points` | "No data" | `Could not load virtual points — Retry` |
| `/eng/scheduler` | "No data" | `Could not load schedules — Retry` |
| `/eng/alarm-settings` | "No data" | `Could not load alarm settings — Retry` |

Bảy trang vốn đã đúng (§5) giữ nguyên hành vi. **0 `pageerror` trên cả 27 route**
ở cả hai chế độ.

### FE-E2E-01 — `e2e/trends.spec.ts` đỏ âm thầm từ `b67580c` (phát hiện khi hậu kiểm)

Chạy `npx playwright test` (toàn bộ `e2e/`, không chỉ spec mới) thì
`trends.spec.ts` **fail**: nó tìm `getByLabel('From (UTC)')` trong khi
[TrendsPage.tsx:319-320](../../../apps/web-ui/src/features/operations/TrendsPage.tsx#L319-L320)
đã đổi nhãn sang `From (local time <TZ>)` tại `b67580c`
("bộ chọn khoảng Trends dùng đúng giờ địa phương như nhãn đã hứa"). Spec chưa từng
được cập nhật theo — `git log` cho thấy nó dừng ở `259d160`, trước `b67580c`.

Không ai phát hiện vì đúng cái bẫy đã ghi ở §7: **`npm test` chỉ quét `src/`**, nên
`e2e/` không chạy trong vòng lặp thường ngày. Đây là lý do một spec có thể đỏ hàng
tuần mà mọi báo cáo vẫn ghi "gate xanh".

Đã sửa bằng cách khớp nhãn theo regex (`/^From \(local time/`) thay vì hằng chuỗi —
hằng `Asia/Saigon` sẽ hỏng ngay trên runner CI đặt UTC.

**Số đo sau bản sửa:**

| Bộ | Lệnh | Kết quả |
|---|---|---|
| FE typecheck | `npx tsc --noEmit` | 0 lỗi |
| FE lint | `npm run lint` | 0 warning |
| FE unit | `npx vitest --run --environment jsdom src` | **346/346 pass**, 42 file |
| FE build | `npm run build` | thành công |
| FE E2E | `npx playwright test` | **27/27 pass**, 55,5 s |
| Go | `go vet ./...` + `go test ./... -count=1` | 11/11 gói pass (đo trên worktree sạch tại `4dff747`; cây làm việc chính đang có WIP Track B chưa build được của phiên khác) |

---

## 8. Thứ tự đề xuất xử lý

| Ưu tiên | Mã | Việc | Ghi chú |
|---|---|---|---|
| P0 | FE-MB-01/04/05 | Nối `DevicesPage` vào route `devices`, export ở `index.ts` | Trang đã viết xong, chỉ thiếu 2 dòng nối |
| P0 | FE-MB-02/03 | Bỏ `<h1>` và padding của `ModbusRtuPage`, bỏ `<main>` lồng trong layout | |
| P0 | FE-MB-06 | Tách `PointsPage` + `DiagnosticsPage` khỏi `ModbusRtuPage`, hoàn tất `MBR-B301` | |
| P0 | FE-DATA-01 | `/monitor` phải báo lỗi khi `pointsState.error`, không được hiện "100% normal" | An toàn vận hành |
| P1 | test gap | Thêm test render `ModbusRtuLayout` + outlet để chốt "1 H1, 3 tab khác nhau" | Nếu không, lỗi này tái diễn |
| P1 | FE-DATA-02 | Áp `StateBlock` lỗi cho 5 trang còn lại | |
| P1 | FE-AUTH-02 | Chỉ xoá phiên khi 401 đến từ đường có auth thật; hoặc thêm refresh token | Quyết định sản phẩm |
| P2 | Nhóm D | Thống nhất mặc định `PORT`/`VITE_PROXY_TARGET`, hoặc ghi vào README dev | |
| P2 | Nhóm B | Nếu chấp nhận đánh đổi, cân nhắc `sessionStorage` (mất khi đóng tab) | Cần giải trình an ninh, xem record 2026-08-01 §4ter.2 |

Mọi mục P0 thuộc `MBR-B301`/`MBR-B305` của Plan 49 Track B đã APPROVED — sửa được
mà không cần mở plan mới. FE-AUTH-02 và nhóm B là quyết định sản phẩm, cần chốt
trước khi code (gate DOC TRƯỚC CODE SAU).

---

## 9. Revision History

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-08-05 | Bản đầu. Crawl 27 route ở hai chế độ demo/live; 4 nhóm nguyên nhân; 10 finding; khoảng trống test của `MBR-B301`. |
| 1.1 | 2026-08-05 | Sửa xong: nhóm A (tách `PointsPage`+`DiagnosticsPage`, nối `DevicesPage`, bỏ H1 lặp/padding lồng/`<main>` lồng), FE-DATA-01 (`/monitor` báo lỗi thay "100% NORMAL"), FE-DATA-02 (5 trang áp `StateBlock`), nhóm D (port 8081). Thêm 40 test. Kiểm chứng: `tsc` 0 lỗi, `lint` 0 warning, **346/346 PASS** (42 file), `build` OK. Nhóm B (FE-AUTH-02) là quyết định sản phẩm, chưa sửa — cần chốt trước khi code. |
| 1.2 | 2026-08-05 | Thêm §7bis hậu kiểm bằng trình duyệt: bảng đối chiếu trước/sau cho nhóm A và nhóm C, 0 `pageerror` trên 27 route ở cả hai chế độ. Thay spec crawl `__crawl.spec.ts` (chỉ `expect(true).toBe(true)`) bằng `e2e/fe-pages-health.spec.ts` có khẳng định thật. Thêm **FE-E2E-01**: `e2e/trends.spec.ts` đỏ âm thầm từ `b67580c` do nhãn đổi sang giờ địa phương — đã sửa, `npx playwright test` **27/27 pass**. |

