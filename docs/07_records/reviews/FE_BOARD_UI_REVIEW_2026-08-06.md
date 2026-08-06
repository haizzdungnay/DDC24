# Review giao diện trên board thật — DDC-24-TANG-1

**Ngày:** 2026-08-06
**Nguồn bằng chứng:** ảnh chụp màn hình trình duyệt trên board thật
(`192.168.1.110`, firmware `0.1.0-be-b6c`, uptime 1d 16:56) — Dashboard, Monitor I/O,
Trends, hộp thoại Add trend.
**Loại tài liệu:** Record (as-built). Không đổi Product Spec, không đóng gate.
**Tiếp nối:** [FE_PAGES_ERROR_REVIEW_2026-08-05.md](FE_PAGES_ERROR_REVIEW_2026-08-05.md)

---

## 1. Kết luận ngắn

Bốn ảnh chụp cho thấy **ba trang nói ba chuyện khác nhau về cùng một thiết bị**:

| Trang | Khẳng định |
|---|---|
| Dashboard | `29 I/O \| 5 Modbus \| 2 WARN \| 0 FAULT`, `UI 16 \| AO 4 \| DO 4`, BACnet `192.168.1.100` |
| Monitor I/O | `TOTAL POINTS 0`, cả bốn bảng rỗng |
| Add trend | `No matching points.` |

Không thể cùng đúng. Trang **sai** lại là trang trông thuyết phục nhất.

Nguyên nhân: `ControllerDiagram` lấp chỗ trống bằng dữ liệu của **simulator** khi
authority không trả gì — và với phần mạng thì nó dùng simulator **trong mọi
build, kể cả live**. Bốn finding, đã sửa hết trong cùng phiên.

Riêng việc `/points` trả rỗng trong khi `core` báo `DEGRADED` là vấn đề **runtime
phía thiết bị**, không phải FE — xem §6.

---

## 2. FE-DIAG-01 — Sơ đồ bịa dữ liệu simulator trên board thật (nặng nhất)

Hai dòng trong [ControllerDiagram.tsx](../../../apps/web-ui/src/shared/components/ControllerDiagram.tsx):

```ts
const displayPoints = points.length ? points : getDemoPoints()   // fallback im lặng
const network = getDemoNetwork()                                  // KHÔNG có điều kiện
```

Hệ quả quan sát được trên board:

| Chỗ hiển thị | Giá trị hiện ra | Thực tế |
|---|---|---|
| Header sơ đồ | `29 I/O` | `/points` trả 0 điểm |
| Header sơ đồ | `5 Modbus`, `2 WARN` | không có thiết bị Modbus nào cấu hình |
| I/O Summary | `UI 16 \| AO 4 \| DO 4` | 0 / 0 / 0 |
| I/O Summary | `BACnet 192.168.1.100 \| ID 47808` | thiết bị ở `192.168.1.110` |
| I/O Summary | `RS485 / Modbus 5 dev \| 1 deg \| 1 offline` | không có số đo nào |
| LED RS485 | xanh | chưa hỏi được authority |

Dòng `getDemoNetwork()` không có điều kiện nên **danh sách slave Modbus và địa chỉ
BACnet là dữ liệu bịa trong mọi build**, kể cả khi `points` đầy đủ.

Đây là cùng họ lỗi với `FE-DATA-01` (`/monitor` báo "100% NORMAL" khi API chết) và
`D-07` (Modbus suy diễn quality ở tầng trình bày): trình bày "không có dữ liệu"
thành một con số trông bình thường. Trên DDC, đó là lỗi an toàn vận hành.

**Cách sửa:**

- `getDemoPoints()` chỉ dùng khi `IS_DEMO`; ở live, `points` rỗng ⇒ sơ đồ hiện
  `0 I/O`, `— Modbus`, `— WARN | — FAULT` kèm một dòng cảnh báo ngay dưới tiêu đề:
  *"Authority chưa trả điểm I/O nào — sơ đồ dưới đây không phản ánh thiết bị thật."*
- Thêm prop `network?: NetworkData`. `DashboardPage` và `DiagramPage` nay gọi
  `GET /network` thật và truyền xuống. Thiếu dữ liệu ở live ⇒ hiện `—`, không mượn
  simulator.
- `networkColor()` không còn trả xanh cho trạng thái không xác định: xanh là một
  **khẳng định** ("đã hỏi authority và đường truyền tốt"), không phải màu mặc định.

---

## 3. FE-TR-01 — Trends tự mâu thuẫn và bị kẹt

Ảnh Trends cho thấy đồng thời:

- panel **Series**: *"No trend points selected."*
- biểu đồ + bảng: **DO-01…DO-04**, mỗi series 4185 mẫu
- bảng thống kê: bốn dòng DO-01…DO-04, cột Visible = **ON**
- hộp thoại Add trend: *"No matching points."*

Nguyên nhân: panel Series lọc `selectedIds` qua `analogPoints` (tức `/points`),
còn truy vấn historian dùng **thẳng** `selectedIds` (đọc từ `localStorage`).
`/points` rỗng ⇒ panel rỗng; historian còn dữ liệu ⇒ biểu đồ vẫn vẽ.

Hệ quả vận hành: người dùng **không xoá được** (không có thẻ series để bấm) mà cũng
**không thêm được** (picker rỗng). Trang kẹt cứng ở trạng thái tự mâu thuẫn.

**Cách sửa:** panel dựng từ chính `selectedIds`. Id không resolve được thành Point
vẫn có thẻ riêng, ghi *"Không còn trong danh sách điểm của authority"* kèm nút **Gỡ**,
cộng một dòng giải thích rằng biểu đồ bên dưới là lịch sử cũ chứ không phải điểm
đang chạy.

---

## 4. FE-TR-02 — Hai hệ quy chiếu thời gian trên cùng một panel

Ô chọn ghi `From (local time Asia/Bangkok)` với giá trị `09:27`, còn bảng ngay bên
dưới ghi `Time (UTC)` với giá trị `02:55`. Chênh đúng 7 giờ, và **không chỗ nào nói
ra**. Người dùng gõ giờ địa phương rồi đọc bảng UTC sẽ kết luận dữ liệu sai.

Gốc là `b67580c` đổi **ô chọn** sang giờ địa phương nhưng giữ **phần hiển thị** ở UTC.

**Cách sửa:** giữ nguyên UTC ở phần hiển thị — đó là quyết định đã có, được chốt
bằng test `TrendsPage.test.tsx:96` — nhưng nói rõ ngay tại chỗ nhập:
*"Ô chọn dùng giờ địa phương (Asia/Bangkok); biểu đồ và bảng bên dưới hiển thị theo UTC."*

Thống nhất cả hai về giờ địa phương là cách sửa tốt hơn về lâu dài nhưng **đảo một
quyết định sản phẩm đã ghi**, nên không tự làm — xem §7.

---

## 5. FE-MON-01 — Monitor im lặng khi authority trả 0 điểm

`/points` trả **200 kèm mảng rỗng** là trạng thái khác hẳn "API chết", nên guard lỗi
thêm ở `FE-DATA-01` không bắt được. Kết quả trên board: bốn bảng trống, không một
dòng chữ giải thích, trong khi Dashboard cùng lúc vẽ 29 I/O.

**Cách sửa:** khi gọi thành công mà không có điểm nào, trang nói thẳng:
*"Authority trả lời bình thường nhưng không có điểm I/O nào. Kiểm tra dịch vụ
core/iobus và bảng điểm trước khi tin vào các số 0 bên dưới."*

### Ghi chú về "100% NORMAL" trong ảnh chụp

Thẻ `NORMAL UI/AO POINTS 0 · 100%` vẫn xuất hiện vì board đang chạy firmware
`0.1.0-be-b6c`, **build trước PR #93**. Bản sửa đã có trong `main` (thẻ hiện `—` khi
mẫu số bằng 0). **Board cần deploy lại** thì mới thấy.

---

## 6. Ngoài phạm vi FE — cần xử lý phía thiết bị

Bản thân việc `/points` trả rỗng **không phải lỗi giao diện**. Bằng chứng từ ảnh:

- `SERVICES`: `core` = **DEGRADED** (IOP, iobus, web đều OK)
- `IOP / SCAN METRICS`: `OVERALL ok` nhưng `IOP LATENCY` = `N/A`
- `COMMUNICATION STATUS`: RS485-1/RS485-2/Modbus TCP/Modbus RTU/BACnet đều `N/A`
- `RECENT EVENTS`: rỗng
- Historian vẫn còn DO-01…DO-04 với 4185 mẫu ⇒ **trước đây đã từng có điểm**

Tức là bảng điểm của Core đã biến mất trong lúc chạy. Sau bản sửa, giao diện sẽ
**nói đúng** rằng nó không có dữ liệu — nhưng nguyên nhân nằm ở `core`, cần điều tra
riêng bằng log `mkddc-core` trên board.

---

## 7. Còn mở

| Mã | Việc | Vì sao chưa làm |
|---|---|---|
| FE-TR-02b | Thống nhất phần hiển thị Trends về giờ địa phương | Đảo quyết định sản phẩm đã chốt bằng test; cần duyệt trước theo gate DOC TRƯỚC CODE SAU |
| FE-AUTH-02 | Một 401 bất kỳ xoá phiên toàn app; JWT TTL 1 h không refresh | Quyết định sản phẩm, đã nêu ở record 2026-08-05 §8 |
| CORE-DEGRADED | `core` DEGRADED, `/points` rỗng trên DDC-24-TANG-1 | Ngoài phạm vi FE, cần log board |
| DEPLOY | Board đang chạy build trước PR #93/#94 | Cần deploy lại để thấy toàn bộ bản sửa |

---

## 8. Số đo kiểm chứng

| Bộ | Lệnh | Kết quả |
|---|---|---|
| FE typecheck | `npx tsc --noEmit` | 0 lỗi |
| FE lint | `npm run lint` | 0 warning |
| FE unit | `npx vitest --run --environment jsdom src` | **358/358 pass**, 44 file |
| FE build | `npm run build` | thành công |
| FE E2E | `npx playwright test` | **28/28 pass** |

Test mới chốt bốn finding: `ControllerDiagram.test.tsx` (5 test, gồm cả nhánh demo
vẫn phải dùng được), `TrendsPage.orphanSeries.test.tsx` (4 test),
`MonitorPage.states.test.tsx` (+3 test), và một test E2E khẳng định `/eng/diagram`
không mượn số của simulator khi authority không trả point.

---

## 9. Revision History

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-08-06 | Bản đầu. Bốn finding từ ảnh chụp board thật: FE-DIAG-01 (sơ đồ bịa dữ liệu simulator), FE-TR-01 (Trends tự mâu thuẫn và kẹt), FE-TR-02 (hai hệ quy chiếu thời gian), FE-MON-01 (Monitor im lặng khi 0 điểm). Đã sửa hết; ghi rõ phần thuộc runtime `core` nằm ngoài phạm vi FE. |
