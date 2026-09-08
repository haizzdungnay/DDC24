# Review và phương án thiết kế lại UI/UX — họ trang Programming (Web)

> **Document ID:** KX-DDC24-UIUX-WEB-PROGRAMMING-REDESIGN-PROPOSAL-001-VI
> **Trạng thái:** **DRAFT — chờ review**, chưa được phép code (theo `CLAUDE.md` §DOC TRƯỚC CODE SAU)
> **Phiên bản:** 0.1 · **Ngày lập:** 2026-08-21
> **Đầu vào:** Yêu cầu trực tiếp của Owner 2026-08-21 — *"thiết kế này không hiện đại và không thân thiện người dùng"*, đối tượng `http://mekong-fac.ddns.net:8082/eng/programming`
> **Đối chiếu mã nguồn:** nhánh `feat/t59-201-control-library-domain`, commit `a35f578`
> **Phạm vi:** kiến trúc thông tin, bố cục, hệ thị giác và tương tác của sáu trang `PGM-01..06` (`/eng/programming/*`)
> **Không bao gồm:** hợp đồng API `IFSPEC-PROG-001`, mô hình miền Draft/Revision, ngữ nghĩa Check/Commission, Core/IPC
> **Tài liệu nền hiện hành:** [FE Handoff PGM-01..06](KX_DDC24_Programming_FE_Handoff_v2_1/README_FE_HANDOFF.md) là authority trực quan theo `AUTH-UX-PROG-2026-09-08-01`; [`UX-WEB-PROG-001` v2.6](PROGRAMMING_UI_UX_DESIGN.md) là companion requirement/safety/contract; [`KX-DDC24-UX-SYSTEM-001`](KX-DDC24-UX-SYSTEM-001_VI.md) cung cấp token/component

> **Ghi chú 2026-09-08:** Đây là hồ sơ proposal và bằng chứng lịch sử. Mọi sơ
> đồ/bố cục trong file này chỉ dùng để giải thích quyết định; khi khác với PNG/
> HTML trong gói handoff thì gói handoff thắng. Không dùng proposal này để khôi
> phục bộ SVG Programming đã loại.

---

## 1. Vì sao tài liệu này tồn tại

Nhận xét của Owner ngắn nhưng đúng chỗ. Sau khi đọc toàn bộ 78 file của
`apps/web-ui/src/features/programming` và **chụp lại chính sáu trang đó trên
Chrome thật**, kết luận là: giao diện hiện tại không xấu vì thiếu chăm chút
thẩm mỹ. Nó là **hệ quả trực tiếp của ba quyết định cấu trúc**, và không thể
sửa bằng cách đổi màu hay bo góc:

1. **Giao diện phản chiếu hợp đồng dữ liệu, không phản chiếu công việc.** Cái
   chiếm nhiều diện tích nhất trên mọi trang là hai chuỗi UUID 36 ký tự.
2. **`Panel` là component bố cục duy nhất và chỉ có một trọng số.** Không có
   cấp bậc thị giác, nên mọi thứ trên màn hình đều quan trọng như nhau — tức
   là không thứ gì quan trọng.
3. **Điều hướng lồng bốn tầng** (rail hệ thống → sáu tab workspace → tab con →
   panel), và một thanh ngữ cảnh sáu cột lặp lại nguyên vẹn trên cả sáu trang.

Tài liệu này ghi lại **hiện trạng đã kiểm chứng**, **19 phát hiện có địa chỉ
file:dòng**, và **một phương án thiết kế lại đủ chi tiết để ước lượng và code**.

---

## 2. Cách kiểm chứng (không suy diễn)

| Loại bằng chứng | Cách lấy | Kết quả |
|---|---|---|
| Ảnh chụp sáu trang, Chrome thật, 1280×750 | `npx playwright test e2e/programming.spec.ts --project=desktop-chrome -g "UJ-PROG-01"` | 1 passed (12,6 s); 11 ảnh `01-overview` … `11-retain-reset-succeeded` |
| Ảnh chụp Thư viện/Tổng quan **có dữ liệu Program** | spec tạm với mock `/libraries` + `/projects/{id}/programs`, đã xoá sau khi chụp | desktop + mobile (Pixel 7, 390 px) |
| CSS **đang chạy trên board** | `curl http://mekong-fac.ddns.net:8082/assets/index-BN4Kz8Vb.css` | 56 185 byte; dùng để xác nhận F-18 |
| Mã nguồn | đọc trực tiếp 78 file `features/programming/**` + `shared/theme/tokens.ts` + `shared/components/*` | — |
| Hồi quy sau hai bản vá §5 | `npx vitest --run --environment jsdom src` · `npm run lint` | **1161/1161 pass**, 124 file · lint sạch, `check_ui_strings` OK |

**Giới hạn phải nói rõ:** không đăng nhập được vào board (`project_foxlinx_webapp_login_credential_missing`),
nên ảnh chụp lấy từ bản build của chính repo này chạy tại chỗ với backend mock.
Bố cục, token màu và cây DOM là **cùng một mã nguồn** với bản đang phát hành;
riêng dữ liệu là dữ liệu mẫu. Một phát hiện (F-18) được đối chiếu thẳng với CSS
thật trên board nên không phụ thuộc giới hạn này.

---

## 3. Hiện trạng sáu trang

| ID | Route | Bố cục hiện tại | File |
|---|---|---|---|
| `PGM-01` | `/eng/programming` | lưới 3 cột, 5 `Panel` ngang vai | `overview/OverviewPage.tsx` (414) |
| `PGM-02` | `.../programs` | khối `PouTree` full-width + lưới `280px │ 1fr │ 308px` | `design/DesignWorkspacePage.tsx` (353) + `design/editor/ProgramsTab.tsx` (1618) |
| `PGM-03` | `.../mapping` | nút + bảng 6 cột | `design/mapping/MappingTab.tsx` (374) |
| `PGM-04` | `.../library` | `Panel` lọc + lưới `3fr │ 2fr` (danh sách │ chi tiết + form) | `library/LibraryPage.tsx` (409) |
| `PGM-05` | `.../commission` | 5 `Panel` xếp dọc + modal xác nhận | `commission/CheckCommissionPage.tsx` (554) |
| `PGM-06` | `/eng/programming/runtime` | 3 tab con → `RuntimeTab`/`WatchTab`/`VersionsTab`+`DangerZone` | `runtime/RuntimeServicePage.tsx` (90) |

Dùng chung trên cả sáu: `layout/ProgrammingHeader.tsx` (h1 + nút Làm mới),
`layout/ProgrammingDesktopNav.tsx` (6 tab), `layout/ProgrammingContextStrip.tsx`
(371 dòng, 6 cột + notice), `layout/ProgrammingMobileNav.tsx` (bottom nav 6 mục).

---

## 4. Phát hiện review

Mức độ: **C** = chặn trải nghiệm · **A** = ảnh hưởng rõ · **B** = nên sửa.

### 4.1 Giao diện nói bằng ngôn ngữ của cơ sở dữ liệu

| ID | Mức | Phát hiện |
|---|---|---|
| `F-01` | **C** | **UUID là dữ kiện chiếm chỗ nhất trên mọi trang.** Thanh context in nguyên `draftRevisionId` và `activeRevisionId` ([`ProgrammingContextStrip.tsx:82-97`](../../apps/web-ui/src/features/programming/layout/ProgrammingContextStrip.tsx#L82-L97)). Ở 1280 px mỗi chuỗi xuống **ba dòng** và chiếm 2/6 cột. Cùng chuỗi đó lặp lại ở Tổng quan, `RuntimeTab` (Active + LKG), `VersionsTab` (Active + LKG) — **một người dùng gặp đúng một chuỗi 36 ký tự tới bốn lần trong một phiên**. Không có thao tác nào của kỹ sư điều khiển cần đọc UUID. |
| `F-02` | **A** | **Trạng thái nói bằng hằng số nội bộ.** `RUNNING 1 · DISABLED 1`, `PROGRAM:program-…` / `ADDED`, `CORE_REVA`, `FUNCTION_BLOCK`, `USER_STOPPED`, `GOOD · LIVE`, `UNKNOWN / RECONCILING`. Chuỗi enum đi thẳng từ hợp đồng ra màn hình, kể cả khi đã có sẵn hàm `pick()` song ngữ ngay cạnh. |
| `F-03` | **B** | **Vòng đời Revision hiện đủ 9 ô mọi lúc**, kể cả `FAILED` và `UNKNOWN / RECONCILING` ([`CheckCommissionPage.tsx:REVISION_LIFECYCLE`](../../apps/web-ui/src/features/programming/commission/CheckCommissionPage.tsx#L60-L64)). Người dùng phải quét 9 ô để tìm ô đang sáng, trong đó hai ô cuối là **ngoại lệ**, không phải bước của quy trình. |

### 4.2 Không có phân cấp thị giác

| ID | Mức | Phát hiện |
|---|---|---|
| `F-04` | **C** | **Ba nền gần như trùng nhau, viền thì đậm hơn nội dung.** Theme sáng: `--c-bg #C8CCD0`, `--c-surface #D8DBDE`, `--c-surface-2 #C2C6CA` — chênh nhau vài phần trăm độ sáng; trong khi `--c-border #636970` là xám rất tối ([`tokens.ts:56-84`](../../apps/web-ui/src/shared/theme/tokens.ts#L56-L84)). Kết quả nhìn thấy được trên ảnh chụp: **đường kẻ là thứ nổi nhất màn hình**, còn các khối nội dung thì chìm vào nhau. Đây là nguyên nhân trực tiếp nhất của cảm giác "không hiện đại". |
| `F-05` | **A** | **`Panel` chỉ có một trọng số** (tiêu đề 14 px semibold + body — [`Panel.tsx`](../../apps/web-ui/src/shared/components/Panel.tsx)). Tổng quan đặt 5 `Panel` ngang vai nhau, nên không có gì nói "đọc cái này trước". |
| `F-06` | **A** | **Hành động chính không phân biệt được.** `Button` mặc định là `secondary`; ở Tổng quan, "Tiếp tục chỉnh sửa" (việc cần làm) trông y hệt "Mở runtime" (điều hướng phụ). Chỉ `PGM-05` có `variant="primary"` thật. |
| `F-07` | **B** | **Mật độ quá thấp cho một công cụ kỹ thuật.** Tổng quan ở 1280×750 chứa ~14 dữ kiện; Thư viện để trống ~40% chiều cao dù đã có 3 khối; ô "Việc cần chú ý" chiếm trọn một hàng để in đúng một câu "Không có việc cần chú ý.". |

### 4.3 Điều hướng lồng bốn tầng

| ID | Mức | Phát hiện |
|---|---|---|
| `F-08` | **A** | **Bốn tầng để tới một dòng code:** `NavRail` nhóm *Kỹ thuật* (mục **thứ 7/7**, [`NavRail.tsx:63`](../../apps/web-ui/src/shared/components/NavRail.tsx#L63)) → 6 tab workspace → 3 tab con → panel. Trang Chương trình có **hai hàng tab chồng nhau**. Icon của mục là `ShieldCheck` (khiên bảo mật) cho "Lập trình điều khiển" — sai nghĩa. |
| `F-09` | **C** | **Thanh context chiếm đầu mọi trang, không sticky, không thu gọn.** 150–190 px trên desktop; ở `/programs` nó đẩy dòng code đầu tiên xuống dưới mốc ~640 px. Trên mobile 390 px lưới đổ về **1 cột × 6 hàng ≈ 470 px** ([`ProgrammingContextStrip.tsx:70`](../../apps/web-ui/src/features/programming/layout/ProgrammingContextStrip.tsx#L70) — `sm:grid-cols-2 xl:grid-cols-6`, mặc định 1 cột), nên màn hình đầu tiên **chỉ có tiêu đề và thanh context**. Ảnh chụp Pixel 7 xác nhận. |
| `F-10` | **B** | **Tab "Thực thi" không có địa chỉ riêng**, chỉ tồn tại dưới dạng `?tab=execution` ([`DesignWorkspacePage.tsx:62`](../../apps/web-ui/src/features/programming/design/DesignWorkspacePage.tsx#L62)). Chu kỳ tác vụ và thứ tự chạy — hai thông số quyết định hành vi runtime — nằm ở chỗ khó tìm nhất trong feature. |

### 4.4 Trang Chương trình (`PGM-02`)

| ID | Mức | Phát hiện |
|---|---|---|
| `F-11` | **C** | **Hai cây POU chồng lên nhau và có lúc nói ngược nhau.** `PouTree` (khối full-width trên cùng, đọc `objects` của document v2) đặt ngay trên cây `Programs` của `ProgramsTab` (cột 280 px, đọc `programs` qua adapter `draftV2.ts`). Với draft v1, ảnh chụp cho thấy **"PROGRAMS (0)" nằm ngay trên `NewProgram · ST`** — hai câu trả lời trái ngược trên cùng một màn hình. Với draft v2 (BE thật, xác nhận ở `application/draft.go:93,357`) thì cùng một POU **liệt kê hai lần**. |
| `F-12` | **A** | **Editor không dùng chiều cao viewport.** Vùng gõ ST cao cố định trong luồng trang; sau shell + context + hai hàng tab + khối `PouTree`, phần code còn khoảng một phần ba màn hình. |
| `F-13` | **C** | **"Editor FBD" không phải sơ đồ.** Nó là một form: dropdown chọn khối + nút "Thêm khối"; các khối xếp thành thẻ **dọc**; dây nối hiển thị dưới dạng chuỗi `86be7853 → 23da0572` ([`StructuredFbdEditor.tsx`](../../apps/web-ui/src/features/programming/fbd/StructuredFbdEditor.tsx)). Không canvas, không đường nối, không kéo thả. Đây là **khoảng cách lớn nhất giữa sản phẩm và kỳ vọng "hiện đại"**, và là lý do FBD hiện chưa dùng được cho người vẽ sơ đồ. |
| `F-14` | **B** | **Cột Inspector 308 px gần như trống** (Tên + Loại + nút Lưu) trong khi editor bị bóp — 24% chiều rộng dành cho hai trường. |

### 4.5 Trạng thái rỗng, lỗi và biểu mẫu

| ID | Mức | Phát hiện |
|---|---|---|
| `F-15` | **B** | **Trạng thái rỗng là câu chữ chết:** "Chưa có ánh xạ nào.", "Chọn một khối để xem chi tiết.", "Không có việc cần chú ý." — không nút, không bước tiếp theo. |
| `F-16` | **B** | **Form "Tạo khối PROJECT" luôn mở**, chiếm nửa cột phải của Thư viện kể cả khi người dùng chỉ đang tra cứu ([`LibraryPage.tsx:107-127`](../../apps/web-ui/src/features/programming/library/LibraryPage.tsx#L107-L127)). |
| `F-17` | **B** | **Thông báo mở đầu bằng mã lỗi** (`PRG-CORE-UNAVAILABLE`, `PRG-SAFE-ACTIVE`) rồi mới tới câu giải thích — ngược thứ tự đọc. |

### 4.6 Hai lỗi màu — **đã sửa trong phiên này** (§5)

| ID | Mức | Phát hiện |
|---|---|---|
| `F-18` | **A** | **Cột "Chất lượng" ở Điểm & Ánh xạ chưa bao giờ đổi màu.** Class được ghép bằng nội suy chuỗi. Hai lỗi chồng nhau: (1) Tailwind quét class theo **văn bản nguồn**, chuỗi nội suy không xuất hiện nguyên dạng nên **không utility nào được sinh** — kiểm chứng trên chính CSS đang chạy ở board: `--c-online-fg` xuất hiện **0 lần**; (2) `--c-online-fg`/`--c-stale-fg`/`--c-unknown-fg` cũng **không có trong `TOKEN_NAMES`**. GOOD chưa bao giờ xanh, OFFLINE chưa bao giờ đỏ. |
| `F-19` | **B** | **Thông báo lỗi ở Thư viện không đỏ.** `text-[var(--c-danger)]` — token này không tồn tại; mọi chỗ khác trong repo đều có fallback `,#c00`, riêng chỗ này thì không, nên chữ lỗi thừa hưởng màu chữ thường. |

---

## 5. Hai bản vá đã thực hiện ngay trong phiên

Theo `CLAUDE.md` §"Làm hết việc, không chừa lại" — lỗi phát hiện trong phạm vi
được giao phải sửa cùng phiên, ghi tài liệu là bước bổ sung chứ không thay thế.

| File | Sửa |
|---|---|
| `design/mapping/MappingTab.tsx` | Bỏ `QUALITY_BADGE` ghép chuỗi; thay bằng bảng tra **tĩnh** `QUALITY_CLASS` viết đủ tên class và chỉ dùng token có thật (`--c-good-fg` / `--c-warn-fg` / `--c-fault-fg` / `--c-text-dim`). |
| `library/LibraryPage.tsx` | `text-[var(--c-danger)]` → `text-[var(--c-fault-fg)]`. |

Kiểm chứng sau vá: `vitest` **1161/1161 pass** (124 file) · `eslint --max-warnings=0` sạch · `check_ui_strings` OK.

---

## 6. Phương án thiết kế lại

### 6.1 Định hướng

**"Trạm làm việc kỹ thuật", không phải "trang quản trị".** Đối chiếu đúng
là VS Code / Grafana / Linear: shell cố định, một vùng nội dung chính thống trị
màn hình, mật độ cao, màu chỉ dùng để mang nghĩa. Không phải một dashboard nhiều
thẻ bằng vai nhau.

Năm nguyên tắc, mỗi nguyên tắc gắn thẳng với một phát hiện ở §4:

| # | Nguyên tắc | Giải quyết |
|---|---|---|
| 1 | Màn hình thuộc về **công việc**, không thuộc về endpoint | `F-01`, `F-02` |
| 2 | Mỗi trang có **đúng một** vùng chính chiếm ≥ 60% diện tích | `F-05`, `F-07`, `F-12` |
| 3 | Định danh máy đọc nằm **sau một cú click**, không nằm trước mắt | `F-01` |
| 4 | Trạng thái nói bằng **câu**, không bằng hằng số | `F-02`, `F-03`, `F-17` |
| 5 | **Chiều cao viewport là tài nguyên**: shell cố định, chỉ vùng nội dung cuộn | `F-09`, `F-12` |

### 6.2 Kiến trúc thông tin: giữ sáu route, đổi cách trình bày

Sáu route canonical **không đổi** — chúng đã được duyệt ở `UX-WEB-PROG-001`
v2.0, và toàn bộ redirect/deep-link/e2e neo vào chúng. Cái đổi là **cách chúng
hiện ra**: thay dải tab ngang bằng **rail dọc trong feature**, và **gộp cây POU
vào chính rail đó** — xoá hẳn một trong hai cây trùng của `F-11`.

```
┌─ AppShell rail (tự thu gọn khi vào Programming) ───────────────────────────┐
│┌ Rail feature 220px ─┬─ Vùng làm việc ─────────────────────┬ Inspector 300┐│
││ AHU-01          ▾   │ ┌ Thanh trạng thái mảnh, sticky 36px ─────────────┐ ││
││                     │ │ AHU-01 · nháp v14 chưa lưu · chạy v12 · Core OK │ ││
││ ▸ Tổng quan         │ └────────────────────────────────────────────────┘ ││
││ ▾ Chương trình      │                                                    ││
││   ├ AHU_Supply ●RUN │        VÙNG CHÍNH — editor / canvas / bảng         ││
││   ├ AHU_Econ   ○OFF │        chiếm toàn bộ chiều cao còn lại             ││
││   └ + POU mới       │                                                    ││
││ ▸ Điểm & Ánh xạ  12 │                                                    ││
││ ▸ Thư viện        3 │                                                    ││
││ ▸ Kiểm tra & VH  ⚠2 │ ┌ Panel đáy thu được: Vấn đề · Runtime · Tìm ───┐  ││
││ ▸ Runtime         ● │ └───────────────────────────────────────────────┘  ││
│└─────────────────────┴────────────────────────────────────┴───────────────┘│
└────────────────────────────────────────────────────────────────────────────┘
```

- **Rail mang trạng thái**: số lỗi Check, số ánh xạ, chấm runtime của từng
  Program. Người dùng biết chỗ nào cần chú ý mà không phải mở từng trang.
- **Thanh context 6 cột → một dòng 36 px sticky.** Nội dung:
  `AHU-01 · nháp v14 (chưa lưu) · đang chạy v12 · Core OK · 1/2 Program bật`.
  Click mở popover có đủ UUID + nút **Sao chép** — dữ liệu không mất, chỉ
  chuyển từ "luôn hiện" sang "khi cần" (`F-01`, `F-09`).
- **Tab con biến mất**: "Thực thi" thành panel trong Inspector của Chương trình
  (`F-10`); ba tab của Runtime thành ba mục con trong rail.
- **Icon** đổi `ShieldCheck` → `SquareFunction`/`Workflow`, và mục Programming
  lên vị trí đầu nhóm *Kỹ thuật* (`F-08`).

### 6.3 Hệ thị giác

| Hạng mục | Hiện tại | Đề xuất |
|---|---|---|
| Nền (sáng) | `#C8CCD0` / `#D8DBDE` / `#C2C6CA` | tách ≥ 8% L\*: `#F1F3F5` / `#FFFFFF` / `#E7EAEE` |
| Viền | `#636970` (rất tối, 1 px) | `#D5DAE0` 1 px + `box-shadow 0 1px 2px rgba(16,24,40,.06)` |
| Theme mặc định của Programming | sáng | **tối** (đúng thói quen công cụ code); sáng vẫn đủ tương phản |
| Thang chữ | 2 cấp (14/24) | 5 cấp: 11 / 13 / 14 / 20 / 28 |
| `Panel` | một trọng số | ba: `hero` (viền accent, tiêu đề 16 px) · `default` · `quiet` (không viền) |
| Nút | mọi thứ `secondary` | **đúng một `primary` mỗi màn hình** |
| Mono | dùng cho cả số đo | chỉ cho mã nguồn và định danh |

**Gate bắt buộc:** đổi token phải chạy lại `src/shared/theme/contrast.test.ts` —
chữ ≥ 4.5:1 với cả ba nền, đồ hoạ ≥ 3:1 (`WCAG 2.2 §1.4.3/§1.4.11`). Nền sáng
hơn làm **tăng** tương phản cho chữ tối, nên rủi ro nằm ở `--c-warn`/`--c-good`
chứ không ở chữ thường.

### 6.4 Từng trang

**`PGM-01` Tổng quan → "Trạng thái điều khiển"**
Một `hero` duy nhất trả lời đúng câu hỏi người dùng mở trang để hỏi: *hệ đang
chạy gì, có gì cần làm?* Bên dưới là **danh sách Program thật** (tên · chu kỳ ·
RUNNING/OFF · output đang giữ) — hiện tại Tổng quan chỉ có tổng hợp
`RUNNING 1 · DISABLED 1`, **không cho biết Program nào**. Gộp panel "Core &
trạng thái an toàn" vào thanh trạng thái + danh sách chú ý. Đúng **một** nút
hành động, được tính theo trạng thái (Tiếp tục sửa / Xem lỗi Check / Đưa vào
vận hành). *(F-05, F-06, F-07)*

**`PGM-02` Chương trình → editor toàn chiều cao**
Rail POU (một cây **duy nhất**, gộp từ `PouTree` + cây của `ProgramsTab`) │
editor `calc(100vh - shell)` │ panel đáy thu được (Thuộc tính · Vấn đề · Giá trị
runtime · Tìm/Thay). Bỏ hẳn khối `PouTree` full-width. *(F-11, F-12, F-14)*

**FBD → canvas SVG thật** — hạng mục lớn nhất, tách riêng thành một đợt.
Khối kéo được, dây vẽ đường gấp khúc có định tuyến, palette bên trái, thu/phóng.
**Giữ nguyên toàn bộ `fbd/model.ts` và `fbd/commands.ts`** (đã keyboard-first,
undo/redo bounded, có test) — chỉ thay lớp render. Bàn phím vẫn phải hoàn tất
được mọi thao tác (`DDD-FE-PROG-001 §0.1`). *(F-13)*

**`PGM-03` Điểm & Ánh xạ → hai cột gán nhanh**
"Biến chưa gán" ↔ "Điểm khả dụng", lọc theo hướng/kiểu, gán bằng một click hoặc
kéo. Hàng đã gán hiện **giá trị sống + chất lượng có màu** (nay đã đúng màu sau
bản vá `F-18`). *(F-15)*

**`PGM-04` Thư viện → thẻ khối có chữ ký**
Mỗi khối hiện chữ ký I/O (`IN: BOOL×2 → OUT: REAL`) và **"dùng ở 3 Program"** —
thông tin quyết định việc chọn khối, hiện chưa có ở đâu. Form tạo chuyển thành
drawer mở theo yêu cầu. *(F-07, F-16)*

**`PGM-05` Kiểm tra & Vận hành → ba bước thay chín ô**
`Kiểm tra → Xem ảnh hưởng → Đưa vào vận hành`; `FAILED` và `UNKNOWN` là **trạng
thái của bước**, không phải bước riêng. Mặc định chỉ hiện nhóm impact
`PRESENT`/`UNAVAILABLE`; gộp phần còn lại thành một dòng *"5 nhóm không ảnh
hưởng ▾"*. **Không nới lỏng fail-closed**: thiếu nhóm vẫn chặn Commission.
*(F-03, F-07)*

**`PGM-06` Runtime → nội dung giữ, thành phần đổi**
Bảng theo dõi thêm sparkline; trace hiển thị **biểu đồ** thay bảng số; Vùng
thao tác nguy hiểm tách hẳn nền và luôn ở cuối. *(F-02, F-07)*

### 6.5 Mobile

Bottom nav **6 → 4** mục (Tổng quan · Runtime · Kiểm tra · Thêm); nhãn nâng từ
`0.62rem` (~10 px) lên 11 px. Thanh context thành **một dòng bấm để mở**. Editor
ST/FBD chuyển sang **chỉ đọc dưới 768 px** kèm câu giải thích rõ — hiện chúng
vẫn nằm ngang hàng trong bottom nav dù thực tế không thao tác được trên điện
thoại. *(F-09)*

---

## 7. Cái gì **không** đổi

- Hợp đồng `IFSPEC-PROG-001`, client sinh tự động, `check:programming-contracts`.
- Sáu route canonical, redirect lối vào cũ, giữ query/hash.
- Ngữ nghĩa fail-closed: impact thiếu nhóm ⇒ chặn; `safeState` do lỗi ⇒ chặn;
  timeout **không** được coi là thành công; re-auth trước thao tác nguy hiểm.
- Không suy `desiredEnabled` thành `RUNNING`.
- Tách `Draft` / `Active` / `intent` / `read-back` thành bốn dữ kiện khác nhau.
- Bàn phím hoàn tất được mọi thao tác; một `<h1>` mỗi route; mốc heading mỗi màn.

---

## 8. Lộ trình đề xuất

| Đợt | Nội dung | Phát hiện đóng | Ước lượng |
|---|---|---|---|
| **W1 — Nền thị giác** | token nền/viền/bóng, thang chữ, `Panel` ba trọng số, quy tắc một `primary` | `F-04..F-07` | 2–3 ngày |
| **W2 — Shell & IA** | rail feature thay tab, thanh trạng thái một dòng + popover, bỏ tab con, sửa icon/vị trí NavRail | `F-01, F-03, F-08..F-10, F-17` | 4–5 ngày |
| **W3 — Chương trình** | gộp một cây POU, editor toàn chiều cao, panel đáy, Inspector gộp | `F-11, F-12, F-14` | 4–5 ngày |
| **W4 — Nội dung từng trang** | Tổng quan hero + danh sách Program, gán nhanh Mapping, thẻ Thư viện, 3 bước Commission, mobile | `F-02, F-15, F-16` + §6.5 | 5–6 ngày |
| **W5 — Canvas FBD** | render SVG, kéo thả, định tuyến dây, giữ nguyên model/commands | `F-13` | 8–10 ngày |

W1–W4 độc lập với W5; W5 có thể chạy song song sau W1.

---

## 9. Rủi ro và điều cần Owner chốt trước khi code

| # | Vấn đề | Cần quyết |
|---|---|---|
| R-1 | `UX-WEB-PROG-001` v2.0 đang **Active — IMPLEMENT_READY** và mô tả bố cục hiện tại (§3.2 "ba cột 280/co giãn/320"). Phương án này khác nó. | Duyệt bản **v2.1** trước khi gõ dòng code đầu tiên (`CLAUDE.md` §DOC TRƯỚC CODE SAU). |
| R-2 | E2E neo vào `getByRole('tab', …)` với tên tab hiện tại. Bỏ tab con ⇒ phải viết lại một phần `e2e/programming.spec.ts`. | Chấp nhận sửa spec cùng đợt W2. |
| R-3 | Đổi token ảnh hưởng **toàn bộ** ứng dụng, không riêng Programming. | Chốt: đổi token chung (nhất quán) hay chỉ scope Programming (rủi ro lệch hai phong cách)? **Khuyến nghị: đổi chung.** |
| R-4 | Canvas FBD là hạng mục lớn nhất và độc lập nhất. | Chốt có đưa vào phạm vi lần này không; nếu hoãn, `F-13` vẫn mở. |
| R-5 | Theme tối mặc định cho riêng Programming tạo cảm giác "hai ứng dụng". | Chốt: tối cho toàn app, hay giữ theo lựa chọn người dùng. **Khuyến nghị: theo lựa chọn người dùng, mặc định tối.** |

---

## 10. Lịch sử sửa đổi

| Phiên bản | Ngày | Người | Nội dung |
|---|---|---|---|
| 0.1 | 2026-08-21 | Claude Code (theo yêu cầu Owner) | Bản đầu: review 19 phát hiện có ảnh chụp + file:dòng, hai bản vá `F-18`/`F-19`, phương án thiết kế lại và lộ trình 5 đợt. |
