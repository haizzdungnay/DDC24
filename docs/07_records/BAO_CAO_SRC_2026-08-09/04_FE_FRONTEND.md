# 04 — Frontend (`apps/web-ui`)

Commit `8754a8e` · đo 2026-08-09

## 1. Tóm tắt

React 18 + TypeScript + Vite. 27.096 dòng nguồn, 7.014 dòng test, 35 trang.
465/465 test pass, eslint `--max-warnings=0` sạch, build thành công.

Chất lượng cao ở ba điểm ít gặp: ma trận phân quyền được **suy ra từ bảng định
tuyến của backend** và ghi rõ căn cứ từng dòng; hệ token màu tập trung và có test
độ tương phản; token phiên **không** lưu vào `localStorage`.

Điểm yếu chính là ranh giới demo/live: dự án dùng chung một cây mã cho cả bản
demo lẫn bản chạy thật, phân biệt bằng cờ `IS_DEMO`. Cơ chế này đúng ở phần lớn
chỗ nhưng đã rò rỉ ba lần — một lần đã sửa trước đây (FE-DIAG-01), hai lần còn lại
phát hiện và sửa trong đợt rà soát này.

## 2. Ngăn xếp và phụ thuộc

| | |
|---|---|
| Runtime | React 18.3, React Router 7.18 |
| Build | Vite (rolldown), `tsc --noEmit` chạy trước mỗi build |
| Biểu đồ | Recharts 2.15 |
| Icon | lucide-react |
| Test | Vitest + jsdom (đơn vị), Playwright (E2E) |
| Phụ thuộc runtime | **5** |

Chỉ 5 phụ thuộc runtime là con số rất gọn cho một ứng dụng 35 trang — không có
thư viện UI nặng, không có state manager ngoài, không có form library. Với thiết
bị nhúng có vòng đời dài, đây là lựa chọn đúng: ít phụ thuộc thì ít bề mặt CVE và
ít việc nâng cấp bắt buộc.

## 3. Cấu trúc

```
src/
├── app/          App.tsx (định tuyến), main.tsx
├── features/
│   ├── auth/         đăng nhập, người dùng, phân quyền
│   ├── dashboard/    tổng quan, chẩn đoán, sơ đồ, hàm phụ trợ, lập trình
│   ├── modbus-rtu/   6 trang con + layout dùng chung
│   ├── network/      mạng, thời gian, hiển thị, thiết bị
│   ├── operations/   cảnh báo, cấu hình cảnh báo, xu hướng
│   ├── points/       vào/ra, điểm ảo, giám sát, nghiệm thu, tham số
│   └── scheduler/    lưới lịch, biên tập, runtime, 5 tab
└── shared/
    ├── api/       client.ts (1.509 dòng), pointTags, overview
    ├── components/ 20+ component dùng chung, thư mục pa3/
    ├── demo/      simulator.ts (976 dòng)
    ├── hooks/     useApi, useWebSocket, useHistorianConfig
    ├── theme/     tokens.ts, ThemeProvider, contrast.ts
    └── i18n.tsx   song ngữ Việt/Anh (424 dòng)
```

Tổ chức theo tính năng, không theo loại tệp. Một trang và test của nó nằm cạnh
nhau — người sửa trang không phải đi tìm test ở cây thư mục khác.

## 4. Phân quyền

[apps/web-ui/src/features/auth/roles.ts](../../../apps/web-ui/src/features/auth/roles.ts)
là phần đáng học nhất của FE. Header của tệp nêu thẳng nguyên tắc:

> Backend là nguồn chân lý … Gate ở đây chỉ để người dùng khỏi đi vào một trang
> mà mọi nút đều 403 — nó là tiện ích UX, không phải hàng rào an ninh. Hàng rào
> thật nằm ở server và phải giữ nguyên ở đó.

Bảng `ROUTE_MIN_ROLE` kèm bảng đối chiếu **từng route với endpoint quyết định**
trong `http.go`. Nhờ vậy khi backend đổi quyền một endpoint, người sửa biết ngay
route nào phải chỉnh — thay vì phải đoán.

Hai quyết định được ghi lý do đầy đủ và cả hai đều đúng:

- `/monitor` để `viewer` có chủ ý: chặn cả trang sẽ lấy mất khả năng quan sát của
  ca trực chỉ-đọc. Nút ép giá trị bên trong mới cần `operator` và được khoá riêng.
- `/eng/modbus-rtu` hạ xuống `viewer` (Đ-04) vì backend đã bảo vệ đúng chỗ:
  `GET /modbus/*` là viewer, mọi mutation là admin. Hạ route **không** nới lỏng
  hơn server.

## 5. Xử lý phiên và token

[AuthProvider.tsx](../../../apps/web-ui/src/features/auth/AuthProvider.tsx) giữ
token trong state React — **không** `localStorage`, **không** `sessionStorage`.
Grep toàn bộ `src/` xác nhận: `localStorage` chỉ dùng cho ngôn ngữ, chủ đề, ghim
dashboard và tuỳ chọn biểu đồ.

Đây là lựa chọn đúng và bình luận trong mã ghi rõ ngữ cảnh — trên HMI web dùng
chung ở phòng máy, token nằm trong storage là token ai cũng lấy được. Đánh đổi là
người dùng phải đăng nhập lại sau khi tải lại trang.

Đăng xuất gọi thu hồi token phía server theo kiểu best-effort, và nếu hỏng thì
token vẫn tự hết hạn theo TTL — xử lý đúng cho thao tác không được phép chặn UI.

## 6. Ranh giới demo/live

Cờ ở [shared/config.ts](../../../apps/web-ui/src/shared/config.ts):

```ts
export const DDC_MODE: DdcMode = import.meta.env.VITE_DDC_MODE === 'live' ? 'live' : 'demo'
export const IS_DEMO = DDC_MODE === 'demo'
```

**Mặc định là demo.** Bản dựng phải chủ động đặt `VITE_DDC_MODE=live`. Với thiết
bị điều khiển thật, mặc định an toàn hơn sẽ là ngược lại — thiếu biến môi trường
lúc dựng thì nên hỏng ồn ào chứ không nên im lặng cho ra bản demo.

`simulator.ts` (976 dòng) sinh điểm, mạng, cảnh báo, sức khoẻ, cấu hình thời gian
và graph giả. Nó được gọi từ 7 tệp. Sáu chỗ có gate `IS_DEMO` đúng
(`client.ts`, `useWebSocket.ts`, `ControllerDiagram.tsx`, `overview.ts`, …).

**Ba chỗ đã từng rò rỉ sang live:**

| Chỗ | Trạng thái |
|---|---|
| `ControllerDiagram.tsx` — bịa điểm và mạng demo | Đã sửa trước (FE-DIAG-01, 2026-08-06) |
| `InputsPage.tsx:377` — mượn điểm demo khi không có điểm thật | **Sửa trong phiên này** (SRC-F-04) |
| `AuxFunctionsPage.tsx:192` — chấm PASS/FAIL trên graph demo | **Sửa trong phiên này** (SRC-F-03) |

Ba lần rò rỉ cùng một lớp lỗi trên cùng một cơ chế cho thấy vấn đề nằm ở thiết
kế cơ chế, không ở sự bất cẩn của từng lần sửa. Khuyến nghị ở §10.

## 7. Chủ đề và khả năng tiếp cận

[theme/tokens.ts](../../../apps/web-ui/src/shared/theme/tokens.ts) (164 dòng) là
nguồn duy nhất cho màu — **không** phải `styles.css`. Có
[theme/contrast.ts](../../../apps/web-ui/src/shared/theme/contrast.ts) kèm test
riêng, tức là tỉ lệ tương phản là thứ được kiểm tự động chứ không phải đánh giá
bằng mắt.

`ThemeProvider` ưu tiên đúng thứ tự: lựa chọn đã lưu của người dùng trước, rồi
mới tới thiết lập hệ thống; và bắt lỗi khi `localStorage` bị khoá (chế độ riêng
tư) thay vì để văng.

59/128 tệp `.tsx` có thuộc tính `aria-*` hoặc `role=`. Có spec E2E riêng cho
a11y (`pa3-a11y.spec.ts`), nhưng spec này **không** nằm trong gate CI.

## 8. Song ngữ

[i18n.tsx](../../../apps/web-ui/src/shared/i18n.tsx) (424 dòng) cung cấp hàm
`pick(vi, en)` dùng trực tiếp tại chỗ hiển thị. Cách này đọc dễ và không lệch
khoá, đổi lại chuỗi nằm rải trong mã nên không rút ra được để dịch máy hoặc thuê
dịch ngoài. Với hai ngôn ngữ cố định thì đánh đổi này hợp lý.

## 9. Kiểm chứng

| Bộ | Số lượng | Kết quả |
|---|---:|---|
| Vitest (`src/`) | 52 tệp, 465 test | **pass** |
| ESLint `--max-warnings=0` | — | **sạch** |
| `tsc --noEmit` + vite build | — | **thành công** |
| Playwright E2E | 8 spec | chỉ **1** spec (`network-qa`) nằm trong gate CI |

Bảy spec E2E ngoài gate: `fe-pages-health`, `pa3-a11y`, `pa3-dashboard`,
`point-names` (14 test hỏng sẵn), `scheduler`, `trends`, và bộ `e2e-board/`.

Bẫy đã biết và vẫn còn: `npm test` chỉ quét `src/`, **không** chạy `e2e/`. Ai
chạy `npm test` rồi kết luận "FE xanh" sẽ bỏ sót toàn bộ tầng E2E.

## 10. Khuyến nghị

1. **Biến ranh giới demo thành thứ máy kiểm được.** Ba lần rò rỉ trên cùng một
   cơ chế nói rằng gate thủ công `if (IS_DEMO)` không đủ. Hai hướng khả thi:
   thêm luật ESLint cấm import từ `shared/demo/` ngoài danh sách tệp được phép;
   hoặc để `simulator.ts` ném lỗi ngay khi bị gọi lúc `!IS_DEMO`, biến rò rỉ im
   lặng thành lỗi ồn ào ngay lần chạy đầu.
2. **Đảo mặc định của `DDC_MODE`.** Thiếu `VITE_DDC_MODE` nên làm build hỏng,
   không nên lặng lẽ cho ra bản demo.
3. **Mở rộng gate E2E.** Sửa 14 test hỏng của `point-names.spec.ts` rồi đưa cả
   thư mục `e2e/` vào CI. Bảy spec ngoài gate sẽ mục dần đúng như `network-qa`
   từng mục.
4. **Tách chunk theo route.** Chunk chính 664 kB gộp toàn bộ 35 trang;
   `React.lazy` theo route sẽ cắt đáng kể thời gian tải đầu trên mạng toà nhà.
5. **Nâng độ phủ E2E cho a11y** — spec đã viết rồi, chỉ thiếu chỗ chạy.
