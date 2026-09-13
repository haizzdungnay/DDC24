# PGM-02 — GAP trang Programming so với thiết kế mục tiêu, và kế hoạch refactor FE

> **Mã:** `REV-PGM02-FE-REFACTOR-2026-09-13`
> **Ngày:** 2026-09-13
> **Phạm vi:** `apps/web-ui/src/features/programming/**` (FE). Không đụng contract API, backend, runtime model, IEC data model, persistence.
> **Hợp đồng đối chiếu:**
> - [PGM-02B FBD Editor Handoff v2.2](../PGM-02B_FBD_EDITOR_FE_HANDOFF_v2_2.md)
> - [PGM-02 Quick Library / SIMULATE / LIVE v2.2](../PGM-02_QUICK_LIBRARY_SIM_LIVE_SPEC_v2_2.md)
> - Ảnh thiết kế mục tiêu: `assets/PGM-02B_FBD_editor_reference.png`

---

## 1. Cách đo hiện trạng

Hiện trạng được đo trên **Chrome thật**, không suy từ mã nguồn:

- Dev server Vite với `VITE_PROGRAMMING_REV_A=1`, `VITE_PROGRAMS_WORKSPACE_V2=1`, `VITE_FBD_EDIT=1`.
- Một mock backend cục bộ phát đúng hình dạng response của `apps/web-api/internal/programming`
  (chép theo `e2e/programming.spec.ts`), nạp sẵn một POU FBD giàu nội dung tương đương
  sơ đồ trong ảnh mục tiêu: `AI_Temp_SAT → PID → LIMIT → AO_Valve_Cooling`, nhánh
  so sánh `LIMIT → GT ← HYS → DO_Fan_Supply`.
- Số đo hình học lấy bằng `getBoundingClientRect()` / `getComputedStyle()` chạy trong trang.

Khổ đo chính: **1680×941** (đúng khổ của ảnh mục tiêu). Các khổ 1920/1440/1280 đo ở bước nghiệm thu.

---

## 2. Phát hiện gốc: hai lỗi thứ tự CSS làm hỏng toàn bộ nửa phải màn hình

Đây là nguyên nhân của phần lớn triệu chứng "panel chồng nhau / khoảng trắng chết",
và nó **không phải lỗi bố cục** — lưới bốn cột của `ProgramsWorkspace` vốn đúng.

### GAP-PGM02-R01 — Inspector bị ghim `position: fixed` ở mọi khổ desktop

`EditorPane.tsx:1152` đặt cho cột Inspector khi POU là FBD:

```
md:fixed md:inset-y-16 md:right-0 md:z-40 md:w-[min(24rem,100vw)] md:shadow-2xl
min-[1440px]:static min-[1440px]:block min-[1440px]:w-auto ...
```

Ý định: dưới 1440 px là khay nổi, từ 1440 px trở lên là cột thật.

Thực tế Tailwind v4 **xuất `.min-[1440px]:static` TRƯỚC `.md:fixed`** trong stylesheet
(đo được: offset 59 927 so với 64 425). Hai rule cùng độ đặc hiệu, cùng khớp ở
≥1440 px, nên **rule đứng sau thắng** — tức `md:fixed` thắng.

Số đo tại 1680 px:

| Đối tượng | Kỳ vọng | Đo được |
|---|---|---|
| `inspector-column` `position` | `static` | **`fixed`** |
| `inspector-column` rect | nằm trong track lưới thứ 7 | `x=1296 y=64 w=384 h=813` — **tràn khỏi lưới, đè lên header** |
| Track lưới thứ 7 (240 px) | chứa Inspector | **rỗng** |

Hệ quả dây chuyền:

1. Inspector nổi đè lên thanh hành động header → **nút `LIVE` / `SIMULATE` / `Details` không bấm được**.
2. Track 240 px của Inspector bỏ trống → đúng "khoảng trắng chết" mép phải.
3. Inspector đè lên cột Thư viện nhanh → Thư viện chỉ còn ~60 px nhìn thấy, chữ bị cắt.

### GAP-PGM02-R02 — Mini Map không bao giờ thành cột

`ProgrammingWorkbench.tsx:399`:

```
lg:grid-cols-[minmax(0,1fr)_375px]
min-[1440px]:grid-cols-[minmax(0,1fr)_375px_458px]
```

Cùng cơ chế, cùng kết quả. Số đo tại 1680 px: `grid-template-columns = "1025px 375px"` —
**hai cột**, nên Mini Map rơi xuống hàng thứ hai, kéo ngang 1025 px và cao 108 px.
Đó chính là "thanh placeholder" trong hiện trạng.

### Kết luận kỹ thuật (đã sửa sau khi đo lại)

Giả thuyết đầu tiên là "khai một breakpoint có tên trong `@theme` thì Tailwind sẽ sắp
đúng theo bề rộng". **Phép đo bác bỏ nó.** Sau khi thêm `--breakpoint-wide: 1440px` và
thay toàn bộ `min-[1440px]:` bằng `wide:`, thứ tự xuất của các cụm biến thể vẫn là:

| Biến thể | Thứ tự xuất | Điều kiện |
|---|---|---|
| `wide` (tự khai) | **765** | `(width >= 1440px)` |
| `sm` | 779 | `(width >= 40rem)` |
| `md` | 813 | `(width >= 48rem)` |
| `lg` | 848 | `(width >= 64rem)` |
| `xl` | 894 | `(width >= 80rem)` |

Tailwind v4 gom **mọi** breakpoint không-mặc-định — arbitrary `min-[…]` lẫn breakpoint
tự khai — vào một cụm đứng TRƯỚC thang mặc định. Nên `wide:` cũng thua `md:`/`lg:` y
như `min-[1440px]:`, và nó chỉ an toàn khi đứng MỘT MÌNH (đấu với utility không tiền tố,
vốn xuất trước mọi biến thể).

Cách sửa thật sự dùng:

1. Ngưỡng ngoài thang mặc định **do JavaScript quyết** —
   `useMinWidth()` trong `features/programming/layout/useProgrammingViewport.ts`.
2. Kết quả áp bằng **style nội tuyến** (lưới khay đáy) hoặc **hai nhánh class loại trừ
   nhau** (cột Inspector). Không có hai rule cùng khớp thì không có gì để thua.
3. `scripts/check_tailwind_breakpoints.py` chặn cả hai hình dạng đã gây lỗi: mọi
   `min-[…px]:`, và `wide:` đứng chung chuỗi class với `sm:`/`md:`/`lg:`/`xl:`/`2xl:`.

---

## 3. Bảng GAP đầy đủ so với 11 yêu cầu của thiết kế mục tiêu

| # | Yêu cầu | Hiện trạng đo được | Mức | Mã GAP |
|---|---|---|---|---|
| 1 | Layout `Nav │ POU │ Editor │ Library │ Inspector` | Lưới 4 cột ĐÚNG, nhưng Inspector `fixed` nên thực tế chỉ còn 3 cột + 1 overlay | 🔴 | R01 |
| 1 | Bottom `Problems │ Watch │ Search │ XRef │ MiniMap` | Chỉ 2 cột; MiniMap xuống hàng | 🔴 | R02 |
| 1 | Canvas là vùng lớn nhất | Canvas 756×542 trên viewport 1680×941 = **26 %** diện tích | 🟠 | L03 |
| 2 | Header: Project / Editing rev / Draft / Running rev / Active / Controller / Online | Có Project/Draft/Active/Controller; **thiếu số hiệu Revision đang sửa và đang chạy** | 🟠 | H04 |
| 2 | Action Save / Check / More | Có Save/Check/Refresh/EDIT/LIVE/SIMULATE/EN/Details — **7 nút trải ngang, không gom `More`** | 🟡 | H05 |
| 3 | POU tree phân cấp, search, filter, New | Có đủ; `selected` chỉ đổi màu chữ, **không có nền chọn** như mục tiêu | 🟡 | T06 |
| 4 | Block thể hiện Instance / Type / In / Out / Param / Runtime | Tiêu đề là `#0 · REAL` (thứ tự thực thi + typeRef). Tên biến bị đẩy xuống dòng 3, cỡ 9 px. **Không có runtime value** | 🔴 | C07 |
| 4 | Live value trên diagram khi Online | **Chưa tồn tại.** `LiveFbdView` chỉ vẽ topology; `FbdCanvas` không nhận prop runtime nào | 🔴 | C08 |
| 4 | Pan / Zoom / Fit / Undo / Redo / Delete / Auto Layout | Đủ cả 7 | 🟢 | — |
| 5 | Quick Library: Search + Category + **compact list** | Là **card lớn** có viền, danh sách chân, `details` mở rộng; ~92 px/khối | 🟠 | Q09 |
| 5 | Nhóm Common/HVAC/Logic/Math/Timer/Counter/Signal/Custom/Variables | Chip lọc phẳng theo `category` của server, **không có cây nhóm gập được** | 🟠 | Q10 |
| 6 | Inspector context-sensitive | Có 5 ngữ cảnh (`PROGRAM`/`VARIABLE`/`ST_SYMBOL`/`FBD_BLOCK`/`FBD_CONNECTION`) | 🟢 | — |
| 6 | Block Instance: General / Parameters / I/O / Status / Attributes | Là **một danh sách phẳng**, không có 5 mục gập | 🟠 | I11 |
| 6 | PID chỉnh được Kp/Ki/Kd/Ts/ManualOut | Tham số **chỉ đọc** (`{name, value}[]`, render `<li>`) | 🔴 | I12 |
| 6 | Hiển thị PV/SP/OUT/Integral/Mode/Status | `runtimeFor(runtime, node.id)` tra overlay theo **`variableName`** bằng **`nodeId`** ⇒ không bao giờ khớp ⇒ luôn `unavailable` | 🔴 | I13 |
| 6 | Bỏ `không xác định được` khi dữ liệu xác định được | POU FBD: Namespace / Truy cập / Bật / Giao diện IEC / VAR đều `không xác định được` vì `selectedPouInterface` chỉ dựng cho ST | 🟠 | I14 |
| 7 | Watch realtime, BOOL nhìn nhanh, analog có đơn vị, Auto/Manual/Fault | Watch có; **BOOL không có chỉ báo nhanh**, badge trạng thái khối chưa có | 🟠 | W15 |
| 7 | UI không nhảy layout khi giá trị đổi | Chưa đo được vì chưa có overlay | ⏳ | W16 |
| 8 | Problems: Severity / Location / Object / Message / Code | Render một dòng `Error: CODE Prog › Net › id · path` — **không có cột** | 🟠 | P17 |
| 8 | Click problem → điều hướng tới object | Có (`onJumpToFbdSelection`) | 🟢 | — |
| 9 | Mini Map hiển thị toàn sơ đồ + viewport | Thuật toán ĐÚNG (có `minimap-viewport-indicator`), nhưng bị R02 làm méo khung | 🟠 | R02 |
| 10 | Giao diện sáng, border nhẹ, spacing rõ | Theme sáng có nhưng `--c-border: #636970` rất đậm; mọi cấp panel dùng cùng một viền đặc | 🟡 | V18 |
| 11 | Không phá chức năng | — | — | — |

Chú thích mức: 🔴 chặn nghiệm thu · 🟠 lệch lớn · 🟡 lệch nhỏ · 🟢 đạt · ⏳ chờ đo.

---

## 4. Ranh giới KHÔNG được chạm

Ghi ra để mỗi lần sửa đều tự kiểm được:

1. **Contract API** — `src/features/programming/api/generated/**` là tệp sinh; đổi phải qua
   `npm run generate:programming-api`. Refactor này **không** đổi một endpoint nào.
2. **Model FBD canonical** — `fbd/model.ts` là hợp đồng với compiler C++
   (`st_fbd_model.cpp`). Thêm trường vào node/port sẽ đổi hash artifact. Mọi thứ thuộc về
   *trình bày* đi qua `layout` hoặc qua lớp view, **không vào tài liệu**.
3. **Thứ tự bốn cột** — `AC-PGM02-004` khoá thứ tự trái→phải POU → Editor → Library →
   Inspector; e2e đo bằng toạ độ thật.
4. **Luật giá trị runtime** — `presentStRuntimeValue` là nơi DUY NHẤT quyết định
   `null/BAD/OFFLINE` hiển thị ra sao. Overlay canvas phải gọi lại nó, không diễn giải lần hai.
5. **Fail-closed của tương thích** — `programmingCompatibility` chặn soạn thảo khi không
   kiểm chứng được. Không được nới.

---

## 5. Kế hoạch thi hành — 9 gói, làm tuần tự, test sau từng gói

| Gói | Nội dung | Đóng GAP | Cổng nghiệm thu |
|---|---|---|---|
| **WP-1** | Breakpoint có tên `wide: 1440px` trong `@theme`; thay hết `min-[1440px]:`/`min-[1280px]:`; script chặn tái phát | R01, R02 | `getComputedStyle(inspector).position === 'static'` tại ≥1440; workbench 3 cột |
| **WP-2** | Vỏ workspace: Inspector là cột thật, drawer chỉ dưới ngưỡng; cân lại tỉ lệ để canvas là vùng lớn nhất | L03 | Canvas ≥ 40 % bề rộng vùng nội dung; không phần tử nào tràn ngang |
| **WP-3** | Header: thêm Revision đang sửa / đang chạy; gom hành động phụ vào `More` | H04, H05 | Hiện `r<seq>` cho cả hai; ≤ 4 nút cấp 1 |
| **WP-4** | Quick Library: danh sách gọn theo nhóm gập được | Q09, Q10 | ≤ 28 px/khối; 9 nhóm; giữ nguyên đường chèn |
| **WP-5** | Vẽ lại block FBD: danh tính đúng, tham số, giá trị runtime; overlay LIVE | C07, C08, W15, W16 | Tên biến là nhãn chính; LIVE hiện giá trị; topology không đổi khi giá trị đổi |
| **WP-6** | Inspector 5 mục; tham số FB sửa được; sửa tra cứu runtime | I11, I12, I13, I14 | PID sửa được Kp/Ki/Kd/Ts/ManualOut qua lệnh FBD; Status có giá trị thật |
| **WP-7** | Problems thành bảng 5 cột | P17 | Đủ Severity/Location/Object/Message/Code; click vẫn nhảy |
| **WP-8** | Mini Map thành cột thật, có nút Fit | R02 | Cột thứ 3 tồn tại ở ≥1440; viewport rect đúng |
| **WP-9** | Tinh chỉnh thị giác + nghiệm thu 4 khổ màn hình | V18 | Ảnh Before/Target/After; 1280/1440/1680/1920 không tràn ngang |

Sau mỗi gói: `npx vitest --run --environment jsdom src` + đo lại trên Chrome thật.
Cuối cùng: `npm run lint`, `npm run build`, `npx playwright test e2e/programming.spec.ts`.

---

## 6. Ảnh chứng cứ

| Ảnh | Nội dung |
|---|---|
| `assets/PGM-02B_FBD_editor_reference.png` | **Target** — thiết kế mục tiêu đã duyệt |
| [`01-before-1680-edit.png`](assets/pgm02-refactor-2026-09-13/01-before-1680-edit.png) | **Before** — EDIT ở 1680×941 |
| [`02-after-1680-edit.png`](assets/pgm02-refactor-2026-09-13/02-after-1680-edit.png) | **After** — EDIT ở 1680×941 |
| [`03-after-1680-live.png`](assets/pgm02-refactor-2026-09-13/03-after-1680-live.png) | **After** — LIVE, giá trị runtime trên sơ đồ |
| [`04-after-1680-inspector-pid.png`](assets/pgm02-refactor-2026-09-13/04-after-1680-inspector-pid.png) | **After** — Inspector 5 mục, PID sửa được Kp/Ki/Kd/Ts/ManualOut |
| [`05-after-1440-edit.png`](assets/pgm02-refactor-2026-09-13/05-after-1440-edit.png) | **After** — 1440×900 |
| [`06-after-1920-edit.png`](assets/pgm02-refactor-2026-09-13/06-after-1920-edit.png) | **After** — 1920×1080 |
| [`07-after-1280-edit.png`](assets/pgm02-refactor-2026-09-13/07-after-1280-edit.png) | **After** — 1280×800 (dưới ngưỡng bốn cột) |

---

## 7. Số đo trước/sau

Cùng một bàn đo, cùng khổ 1680×941, cùng tài liệu FBD.

| Phép đo | Before | After |
|---|---|---|
| `inspector-column` `position` | `fixed` (đè header) | **`static`** (trong track lưới) |
| Track Inspector | rỗng 240 px | **có nội dung 320 px** |
| Nút `LIVE`/`SIMULATE` | bị Inspector che, không bấm được | **bấm được** |
| Khay đáy `grid-template-columns` | `1025px 375px` (2 cột) | **`567px 375px 458px`** (3 cột) |
| Mini Map | rơi xuống hàng riêng, kéo ngang 1025 px | **cột thứ 3, có viewport rect** |
| `fbd-workspace-shell` | cao 2023 px trong khung 495 px | **495 px, canvas tự cuộn** |
| Vùng vẽ canvas (EDIT) | 730×267 | **604×319** |
| Vùng vẽ canvas (LIVE) | 73 px cao | **340 px cao** |
| Giá trị runtime trên sơ đồ | **không có** | **5 ô** (`23.4 °C`, `24 °C`, `42.3 %`, `42.3 %`, `TRUE`) |
| Chiều cao một khối Thư viện nhanh | 92 px | **32 px** |
| Nhóm danh mục Thư viện | không có (danh sách phẳng) | **7 nhóm gập được** |
| Tham số PID | chỉ đọc | **sửa được, round-trip vào Draft** |
| Tràn ngang (1280/1440/1680/1920) | — | **0 px ở cả bốn khổ** |

---

## 8. Nhật ký thi hành

| Thời điểm | Gói | Kết quả |
|---|---|---|
| 2026-09-13 | Audit | Hoàn tất; 18 GAP, 2 lỗi gốc thứ tự CSS đo được bằng số |
| 2026-09-13 | WP-1 | Đóng R01+R02. Phát hiện breakpoint tự khai **cũng** sắp sai (thứ tự xuất: `wide` 765 < `sm` 779 < `md` 813 < `lg` 848) ⇒ chuyển sang quyết định bằng JS (`useMinWidth`) + `scripts/check_tailwind_breakpoints.py` |
| 2026-09-13 | WP-2 | Đóng L03. Sửa ba chỗ đứt chuỗi flex (`EditorPane`, `FbdEditorPane`, `DesignWorkspacePage`); gộp 3 hàng thanh công cụ còn 2; thu phóng nổi trên canvas |
| 2026-09-13 | WP-5 | Đóng C07+C08+W15+W16. `fbd/runtimeOverlay.ts` (13 test) + ô giá trị trên khối/chân; vẽ lại danh tính khối |
| 2026-09-13 | WP-6 | Đóng I11+I12+I13. Sửa lỗi **mất tham số** ở `SET_NODE_FB_PARAMS`; thêm `SET_NODE_PARAMETERS`; Inspector 5 mục |
| 2026-09-13 | WP-4 | Đóng Q09+Q10. Thẻ khối 92→32 px, 7 nhóm danh mục, chip lọc dùng nhãn tiếng Việt |
| 2026-09-13 | WP-8 | Đóng R02 (cột Mini Map thật ở ≥1440, cả EDIT lẫn LIVE) |
| 2026-09-13 | Nghiệm thu | `tsc` sạch · `eslint --max-warnings=0` sạch · **3215/3215** vitest · **67+42** e2e Chrome · build PASS, ngân sách bundle R3 còn dư 7,83 KiB |

### Còn mở (nêu rõ, không giấu)

| GAP | Trạng thái | Lý do |
|---|---|---|
| H04, H05 | **chưa làm** | Header chưa hiện số hiệu Revision đang sửa/đang chạy và chưa gom `More`. Cần quyết định sản phẩm về việc bỏ bớt nút cấp 1 (`Làm mới`, `VI`, `Chi tiết`) — đổi thanh hành động là đổi thói quen thao tác, không nên làm lẫn trong một lát bố cục. |
| P17 | **chưa làm** | Problems vẫn là một dòng gộp, chưa tách 5 cột `Severity/Location/Object/Message/Code`. Việc nhảy tới đối tượng đã chạy đúng. |
| T06 | **chưa làm** | POU đang chọn vẫn chỉ đổi màu chữ, chưa có nền chọn. |
| Toolbar 1 hàng | **còn 2 hàng** | Muốn về 1 hàng phải dời cụm tạo khối (`Khối`/`+`/`Input`/`Output`/`Constant`) sang Thư viện nhanh đúng như `PGM-02B §4.5`. Đó là thay đổi hợp đồng bàn phím (`Insert`) nên tách thành lát riêng. |
| LIVE thiếu cột Inspector | **còn** | `PGM-02B §9` nói Inspector vẫn có ở LIVE. Lưới bốn cột hiện thuộc `EditorPane`; muốn dùng lại cho LIVE phải nâng nó lên `DesignWorkspacePage`. |
| V18 | **một phần** | Đã gọn spacing/typography trong phạm vi Programming. Token `--c-border` của theme sáng vẫn đậm — sửa nó là sửa bảng màu toàn ứng dụng, có bộ kiểm tương phản riêng. |
