# Handoff: FBD Workspace Polish, Inline Port Mapping & Block Properties Modal

**Ngày**: 2026-09-16  
**Phạm vi**: Chỉ FE (`apps/web-ui/src/features/programming/`), route `/eng/programming/projects/:projectId/programs` và `/mapping`.  
**Trạng thái kiểm thử**: 332 tests FBD passed, 127 tests Mapping passed, `npx tsc --noEmit` sạch 100%.

---

## 1. Tóm tắt công việc đã hoàn thành trong phiên

### A. Tinh chỉnh giao diện FBD Canvas & Layout
1. **Loại bỏ viền lồng nhau (Double border)**:
   - Gỡ bỏ viền/nền thừa ở `FbdEditorPane` container và `<article>` bọc `FbdCanvas` trong `StructuredFbdEditor.tsx`.
   - Canvas nằm phẳng, gọn gàng, không còn khung lồng nhau.
2. **Loại bỏ EditorStatusBar ở chân canvas FBD**:
   - Gỡ `<EditorStatusBar>` ở chân canvas FBD (`FbdEditorPane.tsx`), chỉ giữ lại cho ST editor và màn hình báo lỗi hỏng file.
3. **Mở rộng chiều cao 3 cột Workbench**:
   - Tái cấu trúc grid bàn làm việc (`ProgrammingWorkbench.tsx`) để thanh tab nằm gọn trong Cột 1.
   - Cột 2 (Runtime Watch) và Cột 3 (Mini Map) kéo dài trọn chiều cao khay, không bị thụt xuống dưới thanh điều hướng tab.
4. **Chuyển các nút "Thu gọn" thành Icon**:
   - Cột trái POU Explorer: nút dùng icon `PanelLeftClose` (khi mở) và `PanelLeft` (khi thu gọn).
   - Cột phải Inspector: nút dùng icon `PanelRightClose` / `ChevronLeft`.
   - Quick Library: nút dùng icon `X`.
   - Workbench đáy: nút dùng icon `ChevronDown` / `ChevronUp`.
   - Brand link "DDC24 Programming" trên rail khi thu gọn: chỉ hiện icon `ArrowLeft`, ẩn chữ text.

---

### B. Tính năng Ánh xạ điểm trực tiếp từ cổng FBD (`PortMappingPicker.tsx`)
1. **Lối vào từ Context Menu cổng**:
   - Chuột phải vào bất kỳ cổng nào (`INPUT` hoặc `OUTPUT`) -> chọn **"Ánh xạ điểm…"** (`Map point…`).
   - Đã gỡ mục "Thuộc tính khối" (Block properties) khỏi menu cổng theo yêu cầu (chỉ giữ trên menu của khối).
2. **Giao diện Modal `PortMappingPicker`**:
   - Ô tìm kiếm nhanh tự do theo tên, displayId, pointId, equipment.
   - Bộ lọc danh mục nguồn điểm: **Tất cả**, **I/O**, **VP**, **Modbus**.
   - Hai nút toggle lọc nhanh:
     - **✓ Có thể map** (`✓ Can map`): Chỉ hiển thị các điểm có thể map cho cổng hiện tại.
     - **✕ Không thể map** (`✕ Can't map`): Chỉ hiển thị các điểm không tương thích.
   - Hiển thị giá trị số đo realtime / catalog (`5V`, `0V`, `21.5 degC`, `TRUE`) và huy hiệu trạng thái chất lượng chuẩn hóa (`GOOD`, `UNCERTAIN`, `STALE`, `OFFLINE`).
   - Điểm hợp lệ hiện nút **"Map"** (Ánh xạ). Điểm không hợp lệ hiện nút **"Can't map"** (bấm vào sẽ hiện box giải thích lý do cụ thể).
3. **Cơ chế phản hồi khi bấm Map**:
   - Hộp thoại **không tự đóng** sau khi map.
   - Điểm đã map thành công chuyển sang trạng thái **✓ Đã map** (`Mapped`).
   - Xuất hiện banner thông báo kết quả:
     - **Thành công**: Banner xanh lá thông báo đã map thành công điểm vào cổng.
     - **Thất bại**: Banner đỏ hiển thị chi tiết lỗi từ máy chủ.
   - Người dùng chủ động đóng hộp thoại bằng nút **X**, nút **Đóng**, click ra ngoài hoặc phím **Esc**.

---

### C. Hiển thị thông tin điểm & giá trị Realtime trên Canvas và Tooltip
1. **Trên sơ đồ FBD Canvas (`FbdCanvasLayers.tsx`)**:
   - Chân cổng đã map hiển thị nhãn dạng `AO-01: 0V` (hoặc `AO-04: 0V`) với màu accent và font đậm.
   - Hover chuột vào nhãn có title tooltip giải thích đầy đủ: `pv : REAL → Fan Speed (AO-01)`.
2. **Trên thẻ Hover Card (`FbdNodeHoverCard.tsx`)**:
   - Hover vào khối: danh sách chân cổng hiển thị tên điểm đã map và giá trị realtime tương ứng.
3. **Nạp tự động Point Catalog**:
   - Bổ sung `ensurePointCatalogLoaded()` trong `EditorPane.tsx` và `FbdEditorPane.tsx` để tự động tải danh mục điểm khi mở FBD hoặc khi có `bindings`, giúp canvas lập tức phân giải được giá trị realtime thay vì rơi về fallback.

---

### D. Modal thông tin chi tiết khối (`FbdBlockPropertiesModal.tsx`)
- Chuột phải vào khối -> chọn **"Properties"** (`Thuộc tính`) mở hộp thoại chi tiết giữa màn hình.
- Chứa đầy đủ các section theo đúng yêu cầu:
  1. **Thuộc tính POU (POU Properties)**: Tên POU, Loại POU, Instance name, Thứ tự thực thi (`#0`, `#3`...), Retained flag (`Có / Không`), Số lượng cổng.
  2. **Truy cập & Mô tả (Access & Description)**: Quyền truy cập, Mô tả POU từ metadata.
  3. **Tham số chung (General Parameters)**: Danh sách tham số cấu hình / chỉnh định (`Kp`, `Ki`, `Ts`...).
  4. **Cổng I/O & Ánh xạ điểm (I/O & Mappings)**: Danh sách toàn bộ chân vào/ra, kiểu dữ liệu, điểm đã map, giá trị realtime, huy hiệu chất lượng, kèm nút bấm nhanh "Ánh xạ / Đổi map".
  5. **Trạng thái (Status)**: Trạng thái kiểm tra hợp lệ (`Hợp lệ / Có vấn đề`), Giá trị chạy runtime.
  6. **Thuộc tính mở rộng & Dây nối (Attributes & Wires)**: Toạ độ X, Y, Kích thước W × H, Danh sách các dây nối đang cắm vào khối.

---

### E. Điều tra & Khắc phục lỗi không Mapping được (FE-only fix)
- **Nguyên nhân cốt lõi từ BE**:
  - Hợp đồng Draft v2 của BE (`draft_v2.go` và `binding_validation.go`) bắt buộc một `Binding` phải trỏ tới một `variableId` là UUID v4 hợp lệ đã được đăng ký trong mảng `object.locals` của POU.
  - Tab Mapping trước đây sinh `variableId` dạng `${programId}:${name}` (chứa dấu `:`), vi phạm hàm `isUUID`, dẫn đến lỗi 400 Bad Request và Preview bị `BLOCK` (`PGM-MAP-VARIABLE-001`).
  - Canvas FBD gửi `portId` trực tiếp nhưng cổng không tồn tại trong `object.locals`, khiến BE không phân giải được `programId` sở hữu và từ chối lưu.
  - Ngoài ra, các điểm `UI-*` và `DO-*` trên thiết bị đang có chất lượng `BAD`, BE chặn binding nếu `qualityPolicy = REQUIRE_GOOD`.
- **Giải pháp xử lý thuần FE**:
  - `FbdEditorPane.tsx`: Tự động sinh `variableId` chuẩn UUID, gửi kèm operation `upsertVariable` cùng batch với `upsertBinding` lên `onSave`. BE nhận biến vào `locals` trước rồi ghi binding thành công 200 OK.
  - `MappingTab.tsx`: Khi phát hiện biến chưa có UUID hợp lệ trong `document.variables`, tự động đăng ký biến qua `upsertVariable` trước khi gọi `previewProgrammingBinding`, giúp Preview trả về `ALLOW` và lưu thành công.
  - `PortMappingPicker.tsx`: Kiểm tra chất lượng điểm, phân loại các điểm không `GOOD` thành "Không thể map" để bảo vệ người dùng khỏi lỗi từ chối của máy chủ.

---

## 2. Danh sách các file thay đổi chính

| File | Thay đổi chính |
|---|---|
| `apps/web-ui/src/features/programming/fbd/PortMappingPicker.tsx` | Nâng cấp picker: nút Map/Can't map, không tự đóng, box thông báo thành công/thất bại, lọc Can map / Can't map |
| `apps/web-ui/src/features/programming/fbd/PortMappingPicker.test.tsx` | (Mới) 10 unit tests cho picker: lọc, map thành công, báo lỗi, can't map |
| `apps/web-ui/src/features/programming/fbd/FbdBlockPropertiesModal.tsx` | (Mới) Modal hiển thị thông tin chi tiết đầy đủ của khối FBD |
| `apps/web-ui/src/features/programming/fbd/FbdBlockPropertiesModal.test.tsx` | (Mới) 7 unit tests cho modal thuộc tính khối |
| `apps/web-ui/src/features/programming/fbd/FbdCanvas.tsx` | Tích hợp mở `FbdBlockPropertiesModal` từ context menu; gỡ Block properties khỏi menu cổng; truyền `bindings`, `variables`, `programs`, `pointCatalogItems` |
| `apps/web-ui/src/features/programming/fbd/FbdCanvasLayers.tsx` | Nhãn cổng trên canvas hiển thị tên điểm + giá trị realtime (`AO-01: 0V`), đổi style màu accent |
| `apps/web-ui/src/features/programming/fbd/FbdNodeHoverCard.tsx` | Cập nhật hàm `resolvePortMappingInfo` hỗ trợ map theo tên biến v2, hiển thị realtime trên tooltip |
| `apps/web-ui/src/features/programming/fbd/StructuredFbdEditor.tsx` | Gỡ border bọc quanh canvas; chuyển tiếp props `programs`, `bindings`, `variables` |
| `apps/web-ui/src/features/programming/design/editor/FbdEditorPane.tsx` | Gửi `upsertVariable` cùng `upsertBinding` khi map; tự động nạp catalog điểm |
| `apps/web-ui/src/features/programming/design/editor/EditorPane.tsx` | Tự nạp `pointCatalog`; truyền `document.programs`, `document.bindings`, `document.variables` xuống FBD |
| `apps/web-ui/src/features/programming/design/mapping/MappingTab.tsx` | Tự sinh UUID và gửi `upsertVariable` trước khi gọi preview binding |

---

## 3. Hướng dẫn tiếp tục công việc cho phiên sau
1. **Kiểm tra trạng thái Git**:
   - Tất cả các file sửa đổi đang nằm trên branch `main` local.
   - Chạy `git status` để xem các file chưa commit.
2. **Chạy kiểm thử nhanh**:
   ```bash
   cd apps/web-ui
   npx vitest run src/features/programming/fbd src/features/programming/design/mapping
   npx tsc --noEmit
   ```
3. **Điểm cần lưu ý khi thao tác**:
   - Thiết bị thật hiện có các điểm `AO-01` đến `AO-04` là `GOOD`. Các điểm `UI-*` và `DO-*` có chất lượng `BAD` do chưa cắm phần cứng I/O vật lý, nên backend sẽ từ chối nếu map vào các điểm này (đã có cảnh báo trên UI).

