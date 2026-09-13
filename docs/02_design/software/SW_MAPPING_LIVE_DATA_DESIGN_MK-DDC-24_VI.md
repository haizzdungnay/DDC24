# Thiết kế — Nguồn dữ liệu sống cho Points & Mapping (PGM-03)

> **ID:** `SW-PGM03-LIVE-001`
> **Ngày:** 2026-09-13
> **Trạng thái:** Approved (chủ sở hữu chốt phương án P3 ngày 2026-09-13)
> **Liên quan:** `apps/web-ui/src/features/programming/api/queries.ts`,
> `apps/web-ui/src/features/programming/design/mapping/`,
> `apps/web-api/internal/app/ws.go`

---

## 1. Vấn đề

Workbench Ánh xạ đọc `GET /api/v1/programming/point-catalog?limit=500` theo
`setInterval` **10 giây**, mỗi lần huỷ request đang bay rồi tải lại **từ trang
đầu**. Số đo trên bo Foxlinx ngày 2026-09-13 (72 điểm):

| Số đo | Giá trị |
|---|---|
| Payload mỗi lần đọc | 38,9 KiB JSON (≈233 KiB/phút cho mỗi tab đang mở) |
| Header cache | không có `ETag`, không `Cache-Control` ⇒ luôn 200 kèm full body |
| Phần payload là metadata | 86% — **không đổi lần nào** giữa hai lần đọc |
| `observedAt` đổi giữa hai lần đọc | **72/72** điểm |
| `value`/`quality` đổi | **9/72** điểm |
| `setState` mỗi chu kỳ | 2 (`loading` → `ready`), mỗi lần dựng mảng `items` mới |

Hệ quả là toàn bộ workbench (34 hàng biến + 72 hàng điểm + 25 hàng ánh xạ) vẽ
lại hai lần mỗi 10 giây kể cả khi không có gì thay đổi.

Hai nguyên nhân độc lập:

1. **`observedAt` là mốc ĐỌC, không phải mốc GIÁ TRỊ ĐỔI.** Nó nhích mỗi lần
   poll, nên dù 63/72 điểm y nguyên, mọi phép so sánh nội dung đều ra "khác".
   Không một lớp memo hoá nào sống sót được điều này.
2. **Danh mục và giá trị đi chung một kênh.** 86% payload là metadata gần như
   bất biến, bị kéo lại mỗi 10 giây chỉ để lấy 14% giá trị sống.

## 2. Quyết định

Tách hai kênh (phương án P3):

- **Metadata** (`category`, `pointId`, `deviceId`, `name`, `dataType`, `unit`,
  `direction`, `writable`, `mapping`, `displayId`, `sourceRef`, `sourceDetail`,
  `equipment`, `enabled`) tiếp tục đến từ `point-catalog`, nhưng **không poll
  theo nhịp ngắn nữa**.
- **Giá trị sống** (`value`, `quality`, `observedAt`) đến từ WebSocket
  `/api/v1/ws/monitor` — hạ tầng **đã có sẵn**: server chỉ đẩy khi fingerprint
  của tập điểm đổi (`sendMonitorSnapshot`), và `RealtimeProvider` đã bọc toàn bộ
  ứng dụng (`app/App.tsx`), Dashboard/Monitor/Trends dùng nó qua `useRealtime()`.
  Không cần thêm kết nối nào; workbench Ánh xạ chỉ đang bỏ không kênh này.

### 2.1 Điều kiện tiên quyết đã kiểm chứng (bo Foxlinx, 2026-09-13)

| Câu hỏi | Kết quả đo |
|---|---|
| WS có phủ đủ điểm mà catalog có? | **72/72**, không thiếu, không thừa |
| Định danh khớp được không? | `catalog.pointId` ↔ `points[].id`, **duy nhất toàn cục** ở cả hai phía (gồm 48 điểm `MB_RTU` trên 4 slave) |
| Giá trị hai nguồn có khớp? | Khớp; sai khác duy nhất là điểm analog trôi giữa hai lần đọc khác thời điểm (25,39 vs 25,41) |
| Chữ hoa/thường của `quality` | Catalog phát `GOOD`, WS phát `good` ⇒ **phải chuẩn hoá** khi hợp nhất |

Vì cả hai đều đi qua `reader.ReadPoints`, không có thay đổi backend nào trong
phạm vi này.

## 3. Thiết kế

### 3.1 `useProgrammingPointCatalog` — bỏ nhịp poll ngắn

- Bỏ `setInterval(…, 10000)`.
- Vẫn nạp khi `enabled`/`scopeKey` đổi, vẫn giữ `refresh()`/`retry()`/`restart()`.
- Revalidate metadata theo **tín hiệu**, không theo nhịp:
  - `visibilitychange`: tab quay lại và snapshot đã cũ hơn `CATALOG_REVALIDATE_MS`;
  - một nhịp nền **dài** (`CATALOG_REVALIDATE_MS`, mặc định 5 phút) để bắt thay
    đổi cấu hình do người khác thực hiện;
  - **tín hiệu chính xác nhất**: WS xuất hiện điểm mà catalog chưa có, hoặc
    catalog có điểm mà WS không còn — tức tập định danh lệch nhau ⇒ cấu hình
    điểm vừa đổi ⇒ nạp lại ngay.
- Poll nền **không** hạ `status` xuống `loading` khi đã có snapshot đủ: thêm cờ
  `revalidating` riêng, để một lần revalidate im lặng không ép hai lần render.

### 3.2 Hợp nhất metadata + giá trị sống

Hàm thuần `mergeCatalogWithLive(items, liveById)`:

- trả về **chính mảng cũ** (cùng reference) nếu không điểm nào đổi;
- với điểm có đổi: chỉ item đó là object mới, các item khác **giữ nguyên
  reference** (structural sharing).

Nhờ đó một lần WS đẩy giá trị của 1 điểm không làm 71 hàng còn lại vẽ lại.

`quality` chuẩn hoá về chữ hoa; `observedAt` lấy `updatedAt` của WS —
**mốc của mẫu đo**, không phải mốc đọc.

### 3.3 Độ tươi (`CatalogTruthState`)

Trước đây độ tươi của giá trị bám theo lần đọc catalog cuối. Sau thay đổi này,
metadata và giá trị có hai nguồn nên có hai độ tươi:

- `status`/`complete` vẫn nói về **danh mục** (đủ trang hay chưa).
- Giá trị sống bị đánh dấu `STALE` khi WebSocket **không ở trạng thái kết nối**,
  hoặc chưa nhận được gói điểm nào. Mất WS mà vẫn vẽ số cũ như số sống là đúng
  kiểu dối trá mà người trực ca không phát hiện được.
- Khi chưa có gói WS nào (lần vào trang đầu tiên), giá trị lấy từ chính lần đọc
  catalog làm **seed**, vì lần đọc đó có `value`/`quality` thật.

### 3.4 Phạm vi KHÔNG đổi

- Hợp đồng API, backend, và ngữ nghĩa `observedAt` phía server giữ nguyên.
- Logic tương thích/eligibility (`mappingViewModel`) giữ nguyên đầu vào: nó vẫn
  nhận `ProgrammingPointCatalogEntry[]`, chỉ khác là `value`/`quality`/
  `observedAt` nay đã được hợp nhất từ WS trước khi truyền vào.

## 4. Tiêu chí nghiệm thu

1. Mở workbench Ánh xạ và để yên 60 giây: **0** request `point-catalog` sau lần
   nạp đầu (trước: 6 request, ≈233 KiB).
2. Giá trị và Quality trên worklist vẫn cập nhật khi điểm thật đổi.
3. Một điểm đổi giá trị chỉ làm hàng của chính điểm đó đổi; các item khác giữ
   nguyên reference.
4. Mất kết nối WS ⇒ Quality hiển thị `STALE`, không giữ số cũ như số sống.
5. Thay đổi cấu hình điểm (thêm/bớt điểm) ⇒ catalog tự nạp lại mà không cần
   người dùng bấm gì.
6. Bộ kiểm hiện có của `mapping/` và `api/queries` vẫn xanh.
