# DDC-24 — Review giao diện và mã nguồn frontend

**ID:** REC-DDC-UI-REVIEW-20260929
**Phiên bản:** 1.1
**Trạng thái:** In Review — hồ sơ quan sát, chưa phê duyệt thay đổi sản phẩm
**Cập nhật:** 2026-09-29
**Chủ quản:** Product Owner và nhóm frontend
**Nguồn đã rà:** lượt Programming 1.0 tại `265f1a8bfe2bcf1bc9548f0979e4334f3d6437b3`; lượt mở rộng 1.1 tại `origin/main@101d1fdf54c827519d196572484afbb366f9a7c4` (fetch ngày 2026-09-29).

## 1. Kết luận dễ hiểu

**Khách hàng chính đã chốt: đơn vị tích hợp BMS, cần cấu hình và chạy thử nhanh.** Hướng phát triển: chọn thiết bị → tái sử dụng cấu hình → kiểm I/O → tìm nguyên nhân → bàn giao có hồ sơ. Phần mở rộng ở §9–12 ghi 29 tuyến trang, hai lỗi mới và bốn khoảng thiếu về trải nghiệm.

**Nên cải thiện theo thứ tự: nhận đúng thiết bị → giữ vùng làm việc dùng được → thao tác bàn phím đầy đủ → theo dõi lệnh ổn định → giảm số việc người dùng phải tự nhớ.**

Giao diện đã có nền để phát triển: chia các bước lập trình, ánh xạ, kiểm tra và vận hành; tách bản nháp khỏi bản đang chạy; có trạng thái chỉ đọc trên điện thoại; có thư viện, bàn làm việc và chẩn đoán theo ngữ cảnh. Nên phát triển tiếp các thành phần này.

Lượt Programming 1.0 tìm được **5 finding: 3 mục P1 và 2 mục P2**. Ba mục đã tái hiện trên Chrome, một mục tái hiện bằng test hook trên host, một mục xác nhận qua source. Chúng chưa được sửa trong phiên review này. [Bảng đề xuất riêng](DDC24_UI_IMPROVEMENT_PROPOSALS_2026-09-29.md) chuyển các finding thành việc cụ thể, có chi phí dự kiến và tiêu chí nghiệm thu.

P1 ở đây nghĩa là cần ưu tiên xử lý trước khi nghiệm thu phần giao diện liên quan; P2 là lỗi thao tác hoặc vòng đời cần xử lý trong đợt cải thiện tiếp theo. Đây là phân loại review, không tự sửa ma trận release của dự án.

## 2. Phạm vi và độ tin cậy — lượt Programming 1.0

Checkout ban đầu là `main@cb690dfb`, chậm hơn main đã fetch 81 commit và có CHANGELOG đang sửa. Review dùng worktree riêng `/tmp/ddc-ui-review-20260929` tại commit nêu trên; không thay đổi source frontend của checkout người dùng. Các liên kết source trong finding ghim commit để không dẫn nhầm bản local cũ.

| Vùng | Đã làm | Giới hạn |
|---|---|---|
| Khung ứng dụng | Rà `App`, `AppShell`, `TopBar`, `CommandPalette`, `Modal`, ranh giới lỗi | Không kiểm hết các trang quản trị |
| Lập trình | Rà layout, panel, `EditorPane`, toolbar và các phần xử lý ST/FBD liên quan | Không kiểm toàn bộ ngữ nghĩa compiler |
| Ánh xạ | Rà `MappingTab`, view model, bảng đã gán; so desktop/mobile cùng dữ liệu | Không gửi lệnh gán hay ghi I/O |
| Kiểm tra và vận hành | Rà workflow, kiểm trạng thái READY bằng fixture, tái hiện vòng poll | Không thực hiện Commission lên thiết bị |
| Runtime/thư viện/tổng quan | Mở trang bằng fixture, kiểm trạng thái hiển thị và lỗi dữ liệu thiếu | Không xác nhận giá trị hay khả năng thực tế của bo |
| Scheduler | Rà điểm xử lý bàn phím/pointer và chạy test hiện có | Chưa audit trình duyệt toàn luồng lịch |
| Alarm, Trend, Network, quyền toàn hệ thống | Có rà khung chung; chưa kiểm từng luồng | Không có kết luận bao phủ toàn sản phẩm |

### Bản thiết kế dùng để đối chiếu

- [Manifest authority trực quan](../../04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/handoff_manifest.json): PNG/HTML được đăng ký là chuẩn về bố cục và thứ bậc, không phải bằng chứng runtime.
- Đã xem trực tiếp [ảnh FBD](../../04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/assets/PGM-02B_FBD_editor_reference.png) và [ảnh Mapping](../../04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/assets/PGM-03_mapping.png). Mapping giữ bố cục hai vùng trên và bảng đã gán bên dưới; Inspector theo ngữ cảnh.
- [Handoff Programs](../../04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/PGM-02_PROGRAMS_FE_HANDOFF_v2_2.md), [thiết kế workspace](../../02_design/software/PROGRAMMING_PGM02_WORKSPACE_DETAILED_DESIGN.md) và [thiết kế UX](../../04_uiux/PROGRAMMING_UI_UX_DESIGN.md) bổ sung luật thao tác, trạng thái và an toàn.
- [Review UX ngày 18/08](FE_UIUX_UC_REVIEW_2026-08-18.md) là hồ sơ lịch sử. Finding mới dưới đây được đối chiếu lại trên commit 29/09, không suy từ trạng thái cũ.

### Môi trường trình duyệt

Chrome DevTools MCP chạy được. Bản Vite dev dùng `VITE_DDC_MODE=live`, auth mock và hai cờ Programming bật. API Programming lấy handler từ `e2e/programming.spec.ts`, bọc thành máy chủ HTTP trên loopback. Các screenshot cuối của ứng dụng dùng cấu hình này; lượt khảo sát demo ban đầu không dùng làm bằng chứng trạng thái thiết bị.

**Dữ liệu là fixture.** “Core đang chạy”, PID chờ review, metadata chưa rõ và timestamp trong ảnh không nói lên trạng thái hiện tại của sản phẩm/bo. WebSocket và nhiều API hệ thống không được fixture phục vụ; lỗi 503 và banner mất kết nối được ghi lại, không tính thành lỗi frontend. Endpoint `runtime/signals` cũng chưa có trong handler này. Chi tiết và ảnh tại [hồ sơ bằng chứng](assets/ui-review-2026-09-29/EVIDENCE.md).

## 3. Những điểm nên giữ

| Điểm hiện có | Vì sao có ích | Source tại baseline |
|---|---|---|
| Draft, Active và chế độ EDIT/LIVE tách biệt | Tránh nhầm lưu mã với đưa mã vào vận hành | `layout/ProgrammingContextStrip.tsx`, `design/editor/EditorPane.tsx` |
| Mobile dưới 768 px truyền quyền chỉ đọc tới editor | Hạn chế thao tác sửa trên màn hình quá hẹp | `layout/useProgrammingViewport.ts` |
| Tương thích FE–thiết bị được kiểm trước khi sửa | Không cho soạn theo phiên bản thư viện khác thiết bị | `shared/programmingCompatibility.ts` |
| Ánh xạ có preview và đọc lại Draft | Người dùng được xem quyết định trước khi ghi | `design/mapping/MappingTab.tsx` |
| Watch tách giá trị Program đề xuất, giá trị thực tế và nguồn đang giữ | Giải thích vì sao đầu ra không giống lệnh Program | `runtime/WatchTab.tsx` |
| Modal chung và bộ poll chung đã có cơ chế cần dùng lại | Giảm việc mỗi màn hình tự dựng một cách xử lý | `shared/components/Modal.tsx`, `programming/shared/useOperationPolling.ts` |

Path trong cột source nằm dưới `apps/web-ui/src/features/programming`, trừ `shared/components/Modal.tsx` nằm dưới `apps/web-ui/src`.

## 4. Finding đã xác nhận

### UI-F01 — Điện thoại không cho biết điểm Modbus thuộc thiết bị nào — P1

**Người dùng gặp gì:** hai điểm có cùng tên/mã trên hai thiết bị khác nhau đều hiện `MB_RTU:TEMP`. Kỹ sư không phân biệt được nguồn của ánh xạ ngay trên thẻ đã gán.

**Nguyên nhân:** nhánh mobile chỉ ghép `category:pointId`; nhánh desktop có thêm `deviceId`. View model đã giữ định danh đầy đủ, nên thông tin mất ở lớp hiển thị.

**Bằng chứng:** cùng hai hàng có `deviceId=ahu-a/ahu-b`, desktop hiện `MB_RTU:ahu-a:TEMP` và `MB_RTU:ahu-b:TEMP`; viewport 390 px hiện hai chuỗi giống nhau. Đây là Chrome render component thật với dữ liệu minh họa, không phải lỗi phân giải backend. [Source dòng 31 và 45](https://github.com/Mekong-HCM/MK-DDC-24/blob/265f1a8bfe2bcf1bc9548f0979e4334f3d6437b3/apps/web-ui/src/features/programming/design/mapping/AssignedMappingsTable.tsx#L31).

**Đề xuất sửa:** một formatter định danh dùng chung desktop/mobile; tên dễ đọc đi cùng thiết bị/nguồn. Khi chuỗi dài, cho mở đầy đủ và sao chép. Thẻ mobile thêm thời điểm quan sát, vì hiện có quality nhưng thiếu mốc thời gian mà desktop có.

**Nghiệm thu:** hai thiết bị cùng `pointId` luôn phân biệt được ở 390 và 768 px; null không biến thành 0; STALE/UNKNOWN vẫn hiện. Không đổi identity hay binding payload.

![Mapping mobile — fixture hai thiết bị](assets/ui-review-2026-09-29/mapping-identity-390.png)

### UI-F02 — Panel rộng đã lưu làm Inspector chạy ra ngoài màn hình — P1

**Người dùng gặp gì:** sau khi kéo các cột rộng hoặc chuyển từ màn hình lớn sang laptop, phải cuộn ngang cả trang mới thấy thuộc tính.

**Nguyên nhân:** giới hạn riêng từng panel chưa giới hạn tổng chiều rộng. Ba giá trị hợp lệ `480/320/480` cộng editor tối thiểu 320 và ba thanh kéo 6 px cần 1.618 px; workspace ở màn 1440 chỉ có 1.168 px. Lựa chọn này được lưu và dùng lại.

**Bằng chứng Chrome:** thiết lập các giá trị hợp lệ vào khóa `mkddc-pgm02-panel-widths-v1`, reload và mở lại FBD. `scrollWidth=1828`, `clientWidth=1430`; mép phải Inspector ở `x=1867`. Bộ gọn `192/180/256` không tràn tại 1440 px. [Source giới hạn](https://github.com/Mekong-HCM/MK-DDC-24/blob/265f1a8bfe2bcf1bc9548f0979e4334f3d6437b3/apps/web-ui/src/features/programming/design/editor/ProgramsWorkspace.tsx#L47), [đọc và dùng kích thước](https://github.com/Mekong-HCM/MK-DDC-24/blob/265f1a8bfe2bcf1bc9548f0979e4334f3d6437b3/apps/web-ui/src/features/programming/design/editor/ProgramsWorkspace.tsx#L55).

**Đề xuất sửa:** tính ngân sách theo bề rộng container thực; giữ editor tối thiểu, thu các panel phụ hoặc chuyển sang dock theo authority. Tách kích thước người dùng mong muốn khỏi kích thước đang áp dụng; thêm “Khôi phục bố cục”. Không giải quyết bằng cách đổi thứ tự các cột đã duyệt.

**Nghiệm thu:** dữ liệu panel ở min/max, dữ liệu lỗi, chuyển 1680→1440→1280 và mở/thu từng panel không làm trang tràn ngang. Canvas vẫn được cuộn nội bộ khi sơ đồ rộng.

![Panel vượt khung — fixture hợp lệ ở giới hạn tối đa](assets/ui-review-2026-09-29/pgm02-panels-overflow-1440.png)

### UI-F03 — Bảng lệnh nhanh để bàn phím đi xuống trang phía sau — P1

**Người dùng gặp gì:** hộp tìm trang còn mở nhưng tiêu điểm đã ở phía sau. Sau đó Esc không đóng hộp.

**Tái hiện:** mở `Ctrl+K`, từ ô “Tìm trang” nhấn `Shift+Tab`. Chrome xác nhận phần tử có focus là tab “Tham chiếu (0)”, `insideDialog=false`; nhấn Esc thì `dialogOpenAfterEscape=true`.

**Nguyên nhân:** `aria-modal=true` nhưng không có bẫy Tab và không vô hiệu hóa vùng nền. Escape chỉ được xử lý trong cây dialog. [Source](https://github.com/Mekong-HCM/MK-DDC-24/blob/265f1a8bfe2bcf1bc9548f0979e4334f3d6437b3/apps/web-ui/src/shared/components/pa3/CommandPalette.tsx#L125).

**Đề xuất sửa:** dùng cơ chế modal/focus đã có; đóng bằng Esc, giữ Tab/Shift+Tab trong hộp, trả focus về nút mở, có nút đóng nhìn thấy được. Quy tắc này phù hợp [hướng dẫn Modal của W3C](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).

**Nghiệm thu:** từ ô đầu và lựa chọn cuối, Tab hai chiều không thoát; Esc luôn đóng; Enter chỉ chọn kết quả trong hộp; đóng không kích hoạt lệnh ở nền. Kiểm riêng cả `Ctrl+K` của shell và `Ctrl+P` của editor, vì đây là hai bề mặt khác nhau.

### UI-F04 — Rời trang vẫn tiếp tục đọc trạng thái Commission — P2

**Người dùng gặp gì:** không còn xem trang nhưng vòng GET vẫn chạy tới khi lệnh kết thúc hoặc gặp lỗi. Mở lại hoặc đọc lại nhiều lần có nguy cơ tạo các vòng theo dõi chồng nhau.

**Nguyên nhân xác nhận:** `useCommissionWorkflow` lên lịch bằng timeout nhưng không có cleanup khi unmount. `reset` chỉ đổi state. `recheckStatus` khởi động poll mà không vô hiệu hóa thế hệ trước. [Source poll](https://github.com/Mekong-HCM/MK-DDC-24/blob/265f1a8bfe2bcf1bc9548f0979e4334f3d6437b3/apps/web-ui/src/features/programming/commission/useCommissionWorkflow.ts#L51), [reset/recheck](https://github.com/Mekong-HCM/MK-DDC-24/blob/265f1a8bfe2bcf1bc9548f0979e4334f3d6437b3/apps/web-ui/src/features/programming/commission/useCommissionWorkflow.ts#L142).

**Bằng chứng host:** mock trả `VERIFYING`; gọi đọc lại → 1 GET; unmount → tiến đồng hồ giả 1.600 ms → 2 GET. Assertion mong không có GET mới thất bại. [Log tái hiện](assets/ui-review-2026-09-29/polling-reproducer.log), [mã tái hiện](assets/ui-review-2026-09-29/polling-reproducer.txt). Chưa đo tải bo; không kết luận có gửi Commission hai lần.

**Đề xuất sửa:** đối chiếu và dùng lại `shared/useOperationPolling` có generation, in-flight guard, deadline, recovery và cleanup. Hủy theo dõi ở FE không có nghĩa hủy operation trên thiết bị. Re-auth, impact và idempotency của lệnh ghi vẫn phải giữ đúng hợp đồng.

**Nghiệm thu:** không tạo GET mới sau unmount/reset; không cập nhật state từ response của thế hệ cũ; đọc lại liên tiếp chỉ có một vòng; hết thời gian hiện “chưa xác định” và recovery chỉ GET; không tự gửi lại POST.

### UI-F05 — Thanh kéo panel có focus nhưng không đổi được bằng bàn phím — P2

**Người dùng gặp gì:** dùng Tab tới “Đổi kích thước cây POU” nhưng không có thao tác bàn phím để điều chỉnh chiều rộng như khi kéo chuột.

**Bằng chứng source:** `WorkspaceResizeHandle` là button chỉ có `onPointerDown`; không có xử lý phím, giá trị hiện tại hay quan hệ tới panel. [Source](https://github.com/Mekong-HCM/MK-DDC-24/blob/265f1a8bfe2bcf1bc9548f0979e4334f3d6437b3/apps/web-ui/src/features/programming/design/editor/ProgramsWorkspace.tsx#L176). Chưa chạy phép đo phím riêng cho control này; không ghi thành browser PASS/FAIL.

**Đề xuất sửa:** phím trái/phải điều chỉnh trong ngân sách của UI-F02, giá trị truy cập đọc được và focus rõ. Bộ kéo khay đáy đã có xử lý phím, nên nên thống nhất cơ chế. [Window Splitter của W3C](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/) là tài liệu tham khảo triển khai; bản hướng dẫn này có ghi tình trạng ví dụ/review chưa hoàn tất, không phải chứng nhận riêng.

**Nghiệm thu:** chuột và bàn phím dùng cùng giới hạn; bộ đọc màn hình biết panel và giá trị; mở/thu không mất đường tới editor.

## 5. Khoảng cách về trải nghiệm cần Product review

Đây là đề xuất, không tính vào 5 lỗi đã xác nhận:

1. **Toolbar FBD:** ở 1440 px đã có ba hàng công cụ; bộ chọn khối và Thư viện nhanh cùng xuất hiện. Nên ưu tiên lệnh thường dùng, đưa lệnh bố trí/hiển thị ít dùng vào menu. Nút “Kiểm tra POU” và “Build gói” cần nói rõ kiểm cái gì, có tạo Revision hay không.
2. **Điện thoại:** quyền sửa đã bị khóa đúng, nhưng cây POU, các nút sửa bị khóa và canvas cao vẫn lấy nhiều chỗ. Nên có luồng xem sơ đồ/tín hiệu/sự cố gọn; dưới 768 px vẫn chỉ đọc.
3. **Ngôn ngữ:** Mapping hiện nhiều câu như “authority view”, “read-back”, “Backend/Core là authority”. Nên dùng câu nói việc cần làm, ví dụ “Xem trước ánh xạ trước khi lưu”; chi tiết kỹ thuật nằm trong vùng mở theo yêu cầu. Không đổi các thuật ngữ IEC có ý nghĩa chính xác.
4. **Hướng dẫn đi hết công việc:** nền đã có bước tiếp theo và liên kết tới các trang. Nên thử với kỹ sư mới để biết họ có tự đi được từ tạo POU tới xem nguyên nhân đầu ra bị override hay không; chưa có số đo usability trong phiên này.

Cách giảm nội dung phụ phù hợp nghiên cứu thiết kế ứng dụng phức tạp của [Nielsen Norman Group](https://www.nngroup.com/articles/complex-application-design/). Đây là cơ sở chọn giả thuyết để thử với người dùng, chưa chứng minh phương án mới nhanh hơn trên DDC-24.

## 6. Sơ đồ hướng cải thiện

Sơ đồ dưới đây mô tả ý tưởng luồng, không phải bản thiết kế màn hình đã duyệt.

```mermaid
flowchart LR
  A[Chọn thiết bị và Project] --> B[Chọn POU và soạn logic]
  B --> C[Ánh xạ: nhìn rõ nguồn điểm]
  C --> D[Kiểm tra bản nháp]
  D --> E{Có vấn đề?}
  E -->|Có| F[Mở đúng biến, dây nối hoặc điểm cần sửa]
  F --> B
  E -->|Không| G[Xem ảnh hưởng và xác nhận vận hành]
  G --> H[Đọc lại kết quả lệnh]
  H --> I[Xem giá trị thực tế và nguồn giữ đầu ra]
```

```mermaid
flowchart TD
  A[Bề rộng container thay đổi hoặc mở panel] --> B[Tính chỗ còn lại cho editor]
  B --> C{Đủ chỗ theo authority?}
  C -->|Có| D[Giữ các panel trong khung]
  C -->|Không| E[Thu panel phụ hoặc dùng dock]
  E --> D
  D --> F[Chuột và bàn phím dùng cùng giới hạn]
```

## 7. Kiểm chứng đã chạy

| Phép kiểm | Kết quả thật | Phạm vi |
|---|---|---|
| `npm ci --no-audit --no-fund` tại worktree riêng | PASS; cài 267 package theo lockfile | Không cập nhật dependency/lockfile |
| 5 file Vitest chọn lọc | PASS **44/44**, 5/5 file; 4,52 s | Layout panel, dữ liệu Mapping, Commission page, điều hướng shell, WeeklyTab |
| `npm run lint` | PASS | ESLint src và chuỗi UI |
| `npm run build` sau npm ci | PASS; Programming chunk **76,83 KiB gzip**, dưới 165 KiB | Typecheck, contract, build, login chunk, nén sẵn, budget |
| Test mới để tái hiện UI-F04 | **FAIL: 2 GET, mong 1** | Host/hook, bằng chứng lỗi đang tồn tại; không nằm trong 44 test hiện có |
| Chrome DevTools MCP | Đã chạy desktop 1440/1280 và mobile thật qua emulation 390 | Snapshot, screenshot, focus, kích thước, Console/Network |
| Bộ E2E đầy đủ, backend thật, target, HIL vật lý | **NOT RUN** | Không suy readiness từ review này |

Lượt build đầu dùng node_modules của checkout cũ thất bại vì thiếu `@types/node`. Đã bỏ liên kết dependency tạm, cài đúng lockfile và chạy lại build/lint/test; kết quả trong bảng là lượt sau đó. Không đưa lỗi môi trường đã giải quyết này thành finding sản phẩm.

Test hiện có không bao phủ trường hợp panel đã lưu ở tổng chiều rộng tối đa, focus thoát modal và unmount workflow vừa tái hiện. Axe tự động cũng không thay được thử Tab/Shift+Tab/Esc. Bổ sung phép thử theo hành vi người dùng, không chỉ kiểm tên class.

Log và ảnh được lưu tại [bằng chứng audit](assets/ui-review-2026-09-29/EVIDENCE.md). Phép kiểm tài liệu được ghi ở đó sau khi chạy. Giao diện/mock đạt một số phép kiểm không đồng nghĩa thiết bị đã nghiệm thu hoặc `RELEASE_READY` được mở.

## 8. Quyết định cần chốt và cách thử phương án

- Product chọn các hàng trong [bảng đề xuất](DDC24_UI_IMPROVEMENT_PROPOSALS_2026-09-29.md); mặc định mọi hàng vẫn **Đề xuất**.
- Trước implement, cập nhật DDD chủ quản; thay bố cục phải có ảnh/SVG render được cho desktop/mobile và trạng thái liên quan, theo [quy tắc tài liệu](../../00_governance/DOC_GOVERNANCE.md).
- Thử với 5 kỹ sư, gồm người mới và người đang dùng sản phẩm: tìm đúng điểm từ hai thiết bị, sửa một dây sai, xác định nguyên nhân đầu ra bị giữ, đọc lại lệnh đang xử lý, mở modal bằng bàn phím. Dùng fixture an toàn trước, rồi lane backend thật cho các hợp đồng cần xác nhận.
- Đo thời gian, số lần chuyển trang, số lần hỏi trợ giúp và chọn nhầm nguồn; ghi median và từng lượt. Mục tiêu đề xuất: 5/5 phân biệt đúng thiết bị, không có mutation ngoài ý định, không thoát focus modal, không tràn ngang trang. So cùng người/cùng task trước–sau, đổi thứ tự phiên để giảm tác động học lại. Mẫu 5 người giúp tìm vấn đề, không đủ để tuyên bố hiệu quả thống kê toàn thị trường.

## 9. Mở rộng rà soát: nhiều trang và tính năng

### 9.1 Nguồn và cách kiểm

Lượt này dùng worktree riêng `/tmp/ddc-ui-expanded-20260929`, đúng lockfile của main `101d1fdf`. Không lấy checkout local `cb690dfb` làm hiện trạng mới. Không sửa source FE hay contract sản phẩm. Các finding Programming §4 và số đo §7 là hồ sơ của lượt 1.0; các file gây UI-F01..05 không đổi trong delta đến baseline mới, nhưng **không chạy lại toàn bộ phép tái hiện cũ**. Không tự đóng finding vì main có PR về hiệu năng.

Main mới đã thêm `useSharedPoll`, `useLivePoints`, `visibleInterval`, `useShellAlarms`, tối ưu `useApi`, sửa vị trí Frame Monitor và nhịp Watch. Đây là nền cần tái sử dụng khi refactor. Vẫn có các consumer dùng `useApi(getPoints)` riêng; phải đo request thực trước khi kết luận toàn ứng dụng đã dùng chung một nguồn đọc.

Chrome DevTools MCP khảo sát **29 tuyến × 2 kích thước = 58 lượt quan sát**: desktop 1440×900 và mobile 390×844. Chạy Vite loopback, `VITE_DDC_MODE=demo`, `VITE_AUTH_MODE=mock`. Dữ liệu là mô phỏng; một số client vẫn gọi backend nên `/schedules`, `/history`, `/modbus/frames` trả 502. Các lỗi này giới hạn kiểm luồng thành công; **không được suy là backend sản phẩm hỏng**. Sau đổi viewport, auth mock mất phiên; đã đăng nhập lại, loại các lượt chỉ thấy Login khỏi tập 58 kết quả. [Dữ liệu khảo sát](assets/ui-review-2026-09-29/expanded/survey.json), [Console](assets/ui-review-2026-09-29/expanded/console-desktop.txt), [Network](assets/ui-review-2026-09-29/expanded/network-desktop.txt).

Đã quan sát trang mặc định, trạng thái trống/lỗi có trong fixture, nhãn, điều hướng và bề rộng. Đây chưa là E2E mọi modal, mọi quyền, offline/reconnect hay thao tác ghi. Không gửi lệnh xuống thiết bị thật. Programming vẫn dùng bằng chứng riêng của lượt 1.0.

### 9.2 Bảng hiện trạng theo trang

Source ở bảng thuộc `apps/web-ui/src/features/`, trừ khi ghi khác; ghim toàn bộ tại [cây source main đã rà](https://github.com/Mekong-HCM/MK-DDC-24/tree/101d1fdf54c827519d196572484afbb366f9a7c4/apps/web-ui/src). “Có” nghĩa source/giao diện có khả năng này, không tự xác nhận target/HIL.

| Trang / route | Source chính | Nền hiện có nên giữ | Cải thiện để tích hợp nhanh | Lớp kiểm / giới hạn |
|---|---|---|---|---|
| Tổng quan `/` | `dashboard/DashboardPage.tsx` | Health, alarm, override owner, ghim, xuất snapshot | Thêm bước tiếp theo của phiên cấu hình; giữ Dashboard vận hành | Chrome hai kích thước, dữ liệu demo |
| Giám sát `/monitor` | `points/MonitorPage.tsx` | Filter nguồn/thiết bị/chất lượng, saved view, audit/trend link, bulk override | Mở thiết bị và phiếu kiểm cùng ngữ cảnh điểm | Chrome; bảng cuộn bên trong không phải tràn toàn trang |
| Chạy thử `/eng/commissioning` | `points/CommissioningPage.tsx` | Prerequisite, TTL, xác nhận, trả tất cả, kết quả từng output | Phiếu bền vững cho input/output/Modbus; tách phản hồi thực địa | Chrome chỉ đọc + test; chưa kiểm cơ cấu thật |
| Inputs `/eng/inputs` | `points/InputsPage.tsx` | Mode cảm biến, scaling, hiệu chuẩn, copy kênh, capability Rev A | Bảng kiểm dây và đối chiếu phép đo; mẫu theo loại cảm biến | Chrome trạng thái mặc định; chưa lưu cấu hình |
| Outputs `/eng/outputs` | `points/OutputsPage.tsx` | Safe value, preview tín hiệu, AO/DO, quyền ghi | Thống nhất thô/đơn vị kỹ thuật/%; co toolbar mobile | Chrome; thấy 571% cùng 57% mở trong demo, cần đối chiếu fixture/contract, chưa quy lỗi target |
| Điểm ảo `/eng/virtual-points` | `points/VirtualIoPage.tsx` | Nhiều kiểu dữ liệu, restartPolicy, logging, nhân bản | Ngữ cảnh thiết bị + hiển thị đơn vị gọn; mobile không tràn | Chrome; có nhãn đơn vị dài và tiếng Anh xen kẽ |
| Cảnh báo `/alarms` | `operations/AlarmsPage.tsx` | Ack/shelve/reason, metrics, link điểm và trend quanh sự kiện | Hướng dẫn kiểm tra, ghim vào phiếu thiết bị | Chrome không Ack/shelve |
| Lịch sử `/alarms/history` | cùng file trên | Filter event/thời gian/mức độ | Timeline chung alarm–lệnh–read-back; vẫn giữ dữ liệu gốc | Chrome; không kiểm retention trên bo |
| Luật cảnh báo `/eng/alarm-settings` | `operations/AlarmSettingsPage.tsx` | Hysteresis, nhiều nguồn, thử luật, backtest, BACnet enrollment | Mẫu theo thiết bị và lời giải thích; tái dùng engine hiện có | Chrome + source; chưa chạy thử engine thật |
| Xu hướng `/trends` | `operations/TrendsPage.tsx` | Historian, gap/partial, generation, CSV, marker, saved view | Sửa thống kê null; một click mở bộ lệnh/phản hồi của thiết bị | Chrome + tái hiện host UI-F07; demo đi nhánh legacy |
| Danh sách lịch `/eng/scheduler` | `scheduler/SchedulerGridPage.tsx` | Quản lý lịch, publish/read-back theo source | Mẫu lịch và phiếu xác minh theo thiết bị | Chrome **chỉ trạng thái lỗi 502**; thành công chưa kiểm |
| Lịch đang chạy `/eng/scheduler/runtime` | `scheduler/SchedulerRuntimePage.tsx` | Chuỗi nguồn→giá trị→priority→target→write-result, override reason | Đưa chuỗi này vào trang thiết bị; không làm engine mới | Source + Chrome lỗi 502 |
| Modbus tổng quan `/eng/modbus-rtu` | `modbus-rtu/pages/OverviewPage.tsx` | Bus/slave/point, telemetry unknown, cảnh báo cấu hình | Dẫn đến việc cần làm theo bus hoặc thiết bị | Chrome cấu hình trống |
| Cổng Modbus `/eng/modbus-rtu/ports` | `modbus-rtu/pages/PortsPage.tsx` | Serial ở cấp bus, riêng từng cổng | Checklist dây/baud/parity/address; không tự đổi cổng | Chrome trạng thái không có cổng demo |
| Thiết bị Modbus `/eng/modbus-rtu/devices` | `modbus-rtu/pages/DevicesPage.tsx` | Probe, retry/timeout, trạng thái chưa từng poll, FC15 | Mẫu thiết bị có provenance + hướng dẫn lý do lỗi | Chrome không có slave; probe thật chưa kiểm |
| Điểm Modbus `/eng/modbus-rtu/points` | `modbus-rtu/pages/PointsPage.tsx` | Template, CSV/JSON import/export, địa chỉ/endian/scale preview, write verify | Trình hướng dẫn ráp các bước đã có và ca kiểm mẫu | Chrome cấu hình trống; không đề xuất “thêm import/template” như tính năng chưa có |
| Ánh xạ Modbus `/eng/modbus-rtu/mapping` | `modbus-rtu/pages/MappingPage.tsx` | Bản nháp, lỗi chặn apply, ước lượng tải bus | Liên kết lỗi đúng hàng; nối sang mapping Programming | Chrome trống |
| Chẩn đoán Modbus `/eng/modbus-rtu/diagnostics` | `modbus-rtu/pages/DiagnosticsPage.tsx`, `components/FrameMonitor.tsx` | CRC/timeout/retry, chưa từng poll, passive frame monitor | Một gói bằng chứng theo lỗi; giữ capture không tự phát bus | Chrome telemetry trống, Frame Monitor 502 |
| Chẩn đoán `/diagnostics` | `dashboard/DiagnosticsPage.tsx` | Metric có nguồn, dịch vụ, sơ đồ terminal, xuất gói | Giải thích dấu hiệu và đường mở đúng điểm/phiếu | Chrome demo; không đo hiệu năng bo |
| Hoạt động `/activity` | `dashboard/ActivityPage.tsx` | Filter actor/action/object, CSV | Nối commandId/sessionId khi contract mới có | Chrome trống demo |
| Mạng `/settings/network` | `network/NetworkPage.tsx` | Stage→Apply→Confirm→rollback, north/southbound | Preflight tích hợp BMS, xem khác biệt, chỉ rõ mất kết nối dự kiến | Chrome chỉ đọc; không đổi IP |
| Giờ `/settings/time` | `network/TimeSettingsPage.tsx` | NTP, timezone, RTC, drift | Đưa kiểm giờ vào preflight và timestamp hồ sơ | Chrome chỉ đọc |
| Thiết bị `/settings/device` | `network/SettingsPage.tsx` | Tên, vị trí, BACnet Device ID | Chuẩn đặt tên + kiểm trùng ID tại cấp được hỗ trợ | Chrome không lưu; không có dữ liệu toàn mạng để chứng minh không trùng |
| Người dùng `/settings/users` | `auth/UsersPage.tsx` | RBAC, reset/delete, session/audit info | Preset bàn giao theo vai; xác minh quyền sau cấp | Chrome admin mặc định; ma trận quyền toàn bộ chưa chạy |
| Hiển thị `/settings/display` | `network/DisplaySettingsPage.tsx` | Tiếng Việt/Anh, theme, mật độ, âm báo có lý do browser block | Ngôn ngữ nhất quán; tách lưu trình duyệt và lưu controller | Chrome + source; nhiều setting còn local theo mô tả trang |
| Trợ giúp `/help` | `dashboard/HelpPage.tsx` | Topic theo route, nội dung an toàn | Checklist tích hợp theo tác vụ với liên kết thật | Chrome; chưa thử người dùng mới |
| Sơ đồ `/eng/diagram` | `dashboard/DiagramPage.tsx` | Sơ đồ terminal, mở Monitor | Giữ sơ đồ controller; bổ sung sơ đồ thiết bị ở cấp khác | Chrome; hình to cuộn trong vùng riêng |
| Hàm phụ `/eng/aux` | `dashboard/AuxFunctionsPage.tsx` | Demo cụm logic FU | Ghi rõ capability; không bán như thư viện production | Chrome demo; route bị quarantine theo contract |
| Tham số `/eng/user-parameters` | `points/UserParametersPage.tsx` | Wizard/advanced, bảo vệ bản nháp | Không đưa vào luồng chuẩn khi chưa có capability | Chrome demo; route quarantine, không suy thành thiếu tính năng Rev A |

## 10. Finding mới và khoảng thiếu có giá trị cạnh tranh

### UI-F06 — P1: toàn trang mobile tràn ngang ở nhiều feature

**Triệu chứng:** layout viewport 390 px nhưng `documentElement.scrollWidth` lên 527 px ở cả sáu tuyến Modbus, 425 px ở Outputs và 532 px ở Virtual Points. Tham số demo cũng 434 px nhưng nằm ngoài menu sản phẩm; không tính như blocker Rev A. Thanh tab Modbus có Mapping/Diagnostics nằm ngoài phần nhìn thấy, ảnh cho thấy chữ bị cắt ở cạnh phải.

**Source:** `ModbusRtuLayout.tsx:60` dùng flex không wrap/khung cuộn; tab cuối có right 527,28 px. `OutputsPage.tsx:245` và `VirtualIoPage.tsx` có cụm action không đủ co/wrap. Đây là các vị trí cần đo lại trong sửa layout, chưa khẳng định chỉ một class giải quyết hết.

**Bằng chứng:** [ảnh Modbus](assets/ui-review-2026-09-29/expanded/modbus-points-mobile.png), [ảnh VP](assets/ui-review-2026-09-29/expanded/virtual-mobile.png), [58 phép đo](assets/ui-review-2026-09-29/expanded/survey.json). Dashboard/Monitor/Trend/Network/Users có bảng hoặc hình cuộn **bên trong**, document vẫn 390 px; không gộp các vùng đó thành lỗi toàn trang.

**Tác động:** kỹ sư dùng điện thoại khó tìm chẩn đoán và thao tác kế tiếp. Mở rộng UI-P02/UI-P06: container min-width phù hợp, toolbar wrap/dock, tab cuộn trong vùng có dấu chỉ; giữ tên điểm/thiết bị/TTL luôn nhìn thấy. Nghiệm thu ở 390/768/1440 px: document không rộng hơn client; mọi tab tới được bằng chạm/bàn phím, không cắt hành động an toàn.

### UI-F07 — P1: mẫu thiếu bị thống kê như số 0

**Source:** [TrendsPage.tsx:646](https://github.com/Mekong-HCM/MK-DDC-24/blob/101d1fdf54c827519d196572484afbb366f9a7c4/apps/web-ui/src/features/operations/TrendsPage.tsx#L646). `Number(sample[item.key])` biến `null` thành `0`, rồi `Number.isFinite` giữ lại. Fallback cũng dùng 0 khi thiếu điểm. Chart/table mẫu ghi GAP/No value nhưng tổng hợp hiện current/avg/min/max = 0 và 2 mẫu.

**Tái hiện mới:** hai mẫu null, kỳ vọng số mẫu hợp lệ 0, thực tế 2; [test tái hiện](assets/ui-review-2026-09-29/expanded/gap-repro.test.tsx.txt), [log FAIL](assets/ui-review-2026-09-29/expanded/gap-repro.txt), [ảnh](assets/ui-review-2026-09-29/expanded/trend-gap-mobile.png). Lỗi host thuộc hàm thống kê dùng chung; browser hiện lỗi trên nhánh demo/legacy. Chưa xác định tần suất trên unified historian thật.

**Tác động:** người dùng có thể nhầm mất mẫu thành nhiệt độ/áp suất/công suất bằng 0. Đề nghị lọc null/undefined/chuỗi rỗng trước đổi kiểu; thống kê không có mẫu hiện “Không có dữ liệu” và số mẫu 0; live current tách khỏi thống kê lịch sử. Test phải phân biệt số 0 thật, null, chuỗi rỗng, BAD/gap và series đã xóa; chính sách BAD/UNCERTAIN cần theo contract historian, không tự xóa số đo hợp lệ.

### Khoảng thiếu sản phẩm — không gọi là lỗi runtime đã chứng minh

| Mã | Hiện trạng có chứng cứ source | Việc người tích hợp còn phải tự làm | Đề xuất nối tiếp |
|---|---|---|---|
| UI-G01 | `CommissioningPage.tsx:159` giữ `outcomes` trong useState; trang chỉ chọn AO/DO và không có xuất phiếu | Ghi giấy/Excel, nhớ điểm đã kiểm, gộp kết quả local/Modbus/input | UI-P09, kế thừa CP-01; backend audit hiện có không đồng nghĩa phiếu chạy thử đầy đủ |
| UI-G02 | `Point.equipment` + filter `equip` theo ADR-042 đã có; Monitor/alarm/trend/scheduler có một số deep-link | Tự ráp lệnh, override, alarm, schedule và phản hồi của cùng AHU | UI-P10; mở rộng CP-04/07, không thay ID/tag hiện có |
| UI-G03 | App routes và Settings chưa có một màn đóng phiên/backup/restore thống nhất; đã có xuất snapshot/audit/Modbus | Gom nhiều file; xác nhận đã nhả lệnh; so revision khi thay controller | UI-P13; CP-05 cần khảo sát backend/tool backup hiện có trước viết mới |
| UI-G04 | Chạy thử nằm trong CommandPalette và trang quyền người dùng, ẩn khỏi NavRail có chủ ý; demo nhiều nguồn dữ liệu chưa nhất quán | Kỹ sư mới khó thấy luồng chính; dễ tin demo phản ánh capability/metric thật | UI-P14/16; thay entry-point là quyết định Product và ADR-032, không sửa menu tùy tiện |

**Quan sát cần xác minh thêm:** demo Outputs hiện giá trị kỹ thuật 571% cùng 57% mở; Diagnostics vẽ 5 Modbus trong sơ đồ trong khi Overview Modbus trống; Display và VP còn nhãn Anh/đơn vị quá dài. Lượt này chưa chứng minh lỗi production hay sai firmware. UI-P16 yêu cầu fixture thống nhất đơn vị/capability và test contract trước dùng làm demo bán hàng.

## 11. Kiểm chứng mới trên baseline mở rộng

| Kiểm | Kết quả | Giới hạn |
|---|---|---|
| `npm ci --no-audit --no-fund` | PASS, đúng lockfile | Không đổi dependency |
| Vitest chọn lọc source hiện có | **12 file / 169 test PASS**, 22,66 s | Shared polling, alarm shell, Commissioning, Trend, alarm deep-link, Network, Time, Modbus layout/diagnostics, route contract |
| Tái hiện UI-F07 | **1/1 FAIL**, mong 0 mẫu, nhận 2 | Đây là bằng chứng lỗi, không là gate PASS; test tạm đã gỡ khỏi worktree và giữ bản sao trong evidence |
| `npm run lint` | PASS, UI strings PASS | Không đồng nghĩa nhãn đã dễ hiểu/đồng nhất |
| `npm run build` | PASS; Programming gzip **76,85 KiB / 165 KiB** | HOST build, không phải bundle đang chạy trên bo |
| Chrome DevTools | 58 lượt, 29 tuyến, desktop/mobile; 5 ảnh hiện trạng | Scheduler thành công và Frame Monitor có dữ liệu chưa kiểm vì backend fixture thiếu |
| Source/runtime/contract | Source rà và fixture hiển thị | Không có backend thật, target, HIL, reboot/soak hoặc usability benchmark đối thủ |

Log mới nằm trong thư mục [expanded](assets/ui-review-2026-09-29/expanded/); kết quả kiểm docs và render concept ghi trong [EVIDENCE](assets/ui-review-2026-09-29/EVIDENCE.md). Không nâng `RELEASE_READY` từ báo cáo này. Các lỗi UI đã xác nhận và proposal vẫn cần Issue/owner, thiết kế được duyệt, bản sửa và bằng chứng đúng cấp trước khi đóng.

## 12. Kết luận cho Product

Ưu tiên một gói **cấu hình → kiểm I/O → tìm lỗi → bàn giao** theo thiết bị. Đợt đầu sửa lỗi định danh/layout/focus/poll và số liệu null; sau đó pilot phiếu chạy thử cùng ngữ cảnh thiết bị. Tái dùng các công cụ Modbus, Scheduler, Historian, Programming đang có. Bảng đối thủ, tám đề xuất mở rộng, refactor và bản trực quan ở [báo cáo đề xuất §6–11](DDC24_UI_IMPROVEMENT_PROPOSALS_2026-09-29.md#6-mục-tiêu-cạnh-tranh-đã-chốt).

## Lịch sử sửa đổi

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-09-29 | Review source ghim commit, tái hiện 5 finding theo lớp bằng chứng, đối chiếu authority và bàn giao đề xuất riêng; chưa sửa FE hay đánh giá release |
| 1.1 | 2026-09-29 | Mở rộng 29 tuyến trên main 101d1fdf; ghi UI-F06/07, UI-G01..04; 58 quan sát Chrome, 169 test hiện có PASS và 1 phép tái hiện FAIL; giữ giới hạn demo/target |
