# Design System — MK-DDC-24

## Hệ thống thiết kế giao diện (tokens + components)

> **Document ID:** KX-DDC24-UX-SYSTEM-001
> **Phiên bản:** 1.9 | 2026-08-18 · **Trạng thái:** Approved design guidance; target validation pending · **Owner:** UX Lead
> **Chuẩn:** ISA-101-based design guidance, IEC 60073 coding review, WCAG 2.1/2.2 AA (ngưỡng 4.5:1 và 3:1 giống nhau ở cả hai bản); không phải tuyên bố certification
> 📘 [docs/README](../README.md) · Dùng cho: web Rev A (form/JSON — [ADR-006](../adr/ADR-006-rev-a-ui-form-json.md)) và local limited-operator [HMI](KX-DDC24-UX-HMI-001_VI.md) feature-gated theo ADR-016

> 🎯 Đây là "nguồn-chuẩn hình ảnh": màu, chữ, khoảng cách, component dùng chung cho **web engineering (FE, React)** để nhất quán. *(2026-06-08: web Rev A là React + form/JSON, không Svelte/FBD.)*

> [!IMPORTANT]
> **Token màu: mã là nguồn chân lý, tài liệu là bản chép có kiểm.**
> Bảng §2 phải khớp 1-1 với `apps/web-ui/src/shared/theme/tokens.ts`. Nếu hai bên
> lệch nhau thì **mã đúng** — sửa bảng, không sửa mã cho khớp bảng. Lý do: giá trị
> trong mã được `contrast.test.ts` đo tự động ở mỗi lần chạy test, còn bảng thì
> không. Đây chính là finding `F-DOC-01` của [`REV-FE-UIUX-UC-2026-08-18`](../07_records/reviews/FE_UIUX_UC_REVIEW_2026-08-18.md):
> bảng v1.7 lệch **hoàn toàn** khỏi mã, cả tên biến lẫn giá trị, nên một FE dev
> mới làm theo tài liệu sẽ dựng lại đúng bộ màu trượt AA mà plan 45 đã sửa.

---

## 1. Nguyên tắc thiết kế
1. **Rõ ràng > đẹp:** đây là thiết bị công nghiệp, ưu tiên đọc nhanh, ít hiểu lầm.
2. **Trạng thái phải thấy ngay:** normal/online/off/warn/fault/alarm có chữ + icon rõ; màu theo convention SCADA nhưng không đứng một mình.
3. **An toàn:** hành động nguy hiểm (force I/O, restart, OTA) phải có xác nhận.
4. **Tiếp cận:** tương phản ≥ 4.5:1, không chỉ dùng màu để truyền nghĩa (kèm icon/chữ/shape).
5. **Nhất quán:** cùng một ý nghĩa → cùng chữ/icon/hình; Web và HMI local dùng chung semantic state dù layout khác nhau.
6. **High-performance hierarchy:** phần lớn màn hình và trạng thái bình thường trung tính; màu bão hòa dành cho abnormal, attention, override hoặc energized state cần phân biệt.
7. **Ngữ nghĩa màu có kiểm soát:** neutral = normal/available/unknown theo label; green chỉ cho confirmed running/energized/success, gray = off/stopped/unavailable, yellow = warning, red = fault/danger. Magenta không tự động gán `safety` nếu chưa có safety analysis/philosophy.
8. **Không dùng màu là nghĩa duy nhất:** mọi trạng thái phải kèm chữ, biểu tượng, shape/pattern hoặc dấu hiệu phi-màu tương đương.
9. **Điều hướng 4 nhóm:** Tổng quan, Vận hành, Kỹ thuật, Hệ thống theo mục "Phân cấp điều hướng (ISA-101)" bên dưới.
10. **Nguồn-chuẩn:** [ADR-009](../adr/ADR-009-isa101-hmi-and-nav-restructure.md) là quyết định canonical cho ISA-101-based Level B hybrid. Phần **navigation** của ADR-009 (3 nhóm) đã bị `ADR-032` thay thế — xem [Architecture Decision Log](../00_governance/DECISIONS.md); phần triết lý màu Level B hybrid vẫn còn hiệu lực.

## 2. Design Tokens — Màu

**30 token, hai theme cùng một hình dạng.** `ThemeTokens` là `Record` có khoá cố
định, nên thiếu một token ở theme tối là **lỗi biên dịch**, không phải một ô màu
trống chỉ phát hiện ra lúc chạy. Bảng dưới đây chép nguyên `LIGHT` và `DARK` của
`apps/web-ui/src/shared/theme/tokens.ts`.

Cột "Nhóm kiểm" quyết định ngưỡng tương phản mà `contrast.test.ts` áp cho token
đó — xem §2.2.

| Token | Sáng (`light`) | Tối (`dark`) | Nhóm kiểm | Vai trò |
|-------|----------------|--------------|-----------|---------|
| `--c-bg` | #C8CCD0 | #14171A | nền | nền trang |
| `--c-surface` | #D8DBDE | #1D2125 | nền | panel/card một bậc trên nền |
| `--c-surface-2` | #C2C6CA | #262B30 | nền | nền phụ, hàng được chọn, mục nav đang mở |
| `--c-border` | #636970 | #7C838B | đồ hoạ ≥3:1 | divider, viền thành phần |
| `--c-line-strong` | #4C5056 | #9AA0A6 | chữ ≥4.5:1 | đường/viền nhấn, chỉ báo mục nav đang chọn |
| `--c-text` | #1C1F23 | #EDEFF2 | chữ ≥4.5:1 | chữ chính, giá trị |
| `--c-text-dim` | #4A4F55 | #9AA0A6 | chữ ≥4.5:1 | nhãn phụ |
| `--c-accent` | #26527C | #5698DC | chữ ≥4.5:1 | focus, liên kết, hành động chính |
| `--c-accent-2` | #26527C | #5698DC | chữ ≥4.5:1 | biến thể nhấn thứ hai (hiện trùng `--c-accent`) |
| `--c-info` | #26527C | #5698DC | chữ ≥4.5:1 | thông tin trung tính, không phải trạng thái |
| `--c-good` | #227742 | #2FA45A | đồ hoạ ≥3:1 | NỀN/dot/badge: confirmed running/energized/success |
| `--c-good-fg` | #165B2E | #30A85C | chữ ≥4.5:1 | CHỮ/icon xanh lá |
| `--c-warn` | #826500 | #E8B500 | đồ hoạ ≥3:1 | NỀN/dot/viền cảnh báo |
| `--c-warn-fg` | #634D00 | #E8B500 | chữ ≥4.5:1 | CHỮ/đường cảnh báo |
| `--c-fault` | #CC1F28 | #E5484D | đồ hoạ ≥3:1 | NỀN/dot/viền sự cố nặng |
| `--c-fault-fg` | #A01017 | #EA6A6E | chữ ≥4.5:1 | CHỮ/đường đỏ |
| `--c-critical` | #901380 | #D96FC8 | chữ ≥4.5:1 | priority cao nhất khi alarm philosophy quy định; **không** đồng nghĩa safety certification |
| `--c-force` | #693797 | #B084E8 | chữ ≥4.5:1 | forced/override |
| `--c-off` | #4B505A | #9AA0A6 | chữ ≥4.5:1 | off/stopped/unknown (xám trung tính) |
| `--c-indicator-ok` | #227742 | #2FA45A | đồ hoạ ≥3:1 | chấm chỉ báo nhị phân ON/ONLINE |
| `--c-indicator-off` | #636976 | #7C838B | đồ hoạ ≥3:1 | chấm chỉ báo nhị phân OFF/OFFLINE |
| `--c-good-bg` | #E0ECE5 | #193026 | nền badge | nền tô badge/callout `good` |
| `--c-warn-bg` | #EEE9DB | #3A3315 | nền badge | nền tô badge/callout `warn` |
| `--c-fault-bg` | #F7E0E1 | #3A2023 | nền badge | nền tô badge/callout `fault` |
| `--c-critical-bg` | #EFDDED | #372739 | nền badge | nền tô badge/callout `critical` |
| `--c-force-bg` | #E9E3F1 | #302B3F | nền badge | nền tô badge/callout `forced` |
| `--c-off-bg` | #E5E6E8 | #2C3033 | nền badge | nền tô badge/callout `off`/`unknown` |
| `--c-accent-bg` | #E0E6EC | #1E2D3C | nền badge | nền tô vùng nhấn trung tính |
| `--c-on-accent` | #FFFFFF | #0E1114 | chữ trên nền đặc | chữ đặt TRÊN `--c-accent` (nút primary) |
| `--c-on-fault` | #FFFFFF | #14171A | chữ trên nền đặc | chữ đặt TRÊN `--c-fault` (badge đếm cảnh báo) |

> **`--c-*-bg` là màu ĐẶC, không phải `rgba()` phủ lên nền.** Bản trước dùng
> `rgba(213,32,42,0.10)`: phủ một màu tối lên nền xám làm nền TỐI ĐI, tức là xích
> về phía màu chữ, kéo tụt tương phản của đúng dòng chữ đặt trên đó — 13/14 biến
> thể `StatusBadge` trượt 4.5:1. Ở theme sáng nền tô pha về phía trắng, ở theme
> tối pha về phía nền trang.
>
> **`--c-on-*` không được thay bằng `text-white` gán cứng.** Ở theme tối
> `--c-accent` phải sáng lên để đọc được trên nền tối, và khi đó chữ trắng trên nó
> chỉ còn ~3:1.

> Quy ước Level B hybrid: nền, panel, divider và active navigation vẫn trung tính; màu trạng thái theo SCADA. Vàng (`--c-warn`) và đỏ (`--c-fault`) là màu NỀN/dot; chữ/đường mảnh phải dùng `--c-warn-fg`/`--c-fault-fg`/`--c-good-fg`. Cảnh báo nên là chip/badge nền màu + chữ đậm, không phải chữ màu mảnh.
> Trạng thái LUÔN kèm dấu hiệu phi-màu: chữ/badge, icon, shape/pattern hoặc symbol.

### 2.1 Ngữ nghĩa màu trạng thái
| Trạng thái | Token | Ý nghĩa |
|------------|-------|---------|
| Confirmed running/energized/success | `--c-good` (+ `--c-good-fg`) | trạng thái động đã xác nhận |
| Normal/available | neutral tokens | trạng thái nền, không cần thu hút chú ý |
| Off/Stopped/Unknown | `--c-off` | không hoạt động hoặc chưa biết |
| Warning/lỗi nhỏ | `--c-warn` (+ `--c-warn-fg`) | cần chú ý |
| Fault/sự cố nặng | `--c-fault` (+ `--c-fault-fg`) | nghiêm trọng |
| Highest/Safety | `--c-critical` | ưu tiên cao nhất |
| Forced | `--c-force` | đang override |

### 2.2 Hai luật màu — được kiểm tự động

`apps/web-ui/src/shared/theme/contrast.test.ts` đo trên **token thật** (không
phải bản chép tay), cho **cả hai theme**, mỗi lần chạy `npx vitest`:

| Luật | Ngưỡng | Áp cho | Căn cứ |
|---|---:|---|---|
| Token dùng làm **chữ** | ≥ 4.5:1 với cả ba nền `--c-bg`/`--c-surface`/`--c-surface-2` | `TEXT_TOKENS` (12 token) | WCAG §1.4.3 |
| Token dùng làm **đồ hoạ** (viền, icon, chấm chỉ báo) | ≥ 3:1 với cả ba nền | `GRAPHIC_TOKENS` (6 token) | WCAG §1.4.11 |
| Chữ badge trên nền badge cùng màu | ≥ 4.5:1 | 14 biến thể `StatusBadge` | WCAG §1.4.3 |
| Viền/icon badge trên nền badge | ≥ 3:1 | 14 biến thể `StatusBadge` | WCAG §1.4.11 |
| `--c-on-accent` / `--c-on-fault` trên nền đặc tương ứng | ≥ 4.5:1 | 2 cặp | WCAG §1.4.3 |
| Nền badge phải lệch **ra xa** màu chữ chính, không xích lại gần | luminance | 14 biến thể | chống tái diễn lỗi `rgba()` phủ nền |

Test này tồn tại để chặn đúng một loại thay đổi: **"làm nhạt lại cho đẹp"**. Đổi
một giá trị trong bảng trên mà không chạy lại test là bỏ qua lớp bảo vệ duy nhất
của bộ màu.

### 2.3 Đổi gì so với v1.7 — và vì sao

Bảng v1.7 lệch khỏi mã ở **cả hai chiều**: tên biến và giá trị.

**Tên biến — thêm tiền tố `--c-`.** Ánh xạ để đọc tài liệu cũ:

| Tên v1.7 | Tên hiện hành |
|---|---|
| `--bg` · `--surface` · `--surface-2` · `--border` · `--text` · `--text-dim` | `--c-bg` · `--c-surface` · `--c-surface-2` · `--c-border` · `--c-text` · `--c-text-dim` |
| `--good` · `--good-fg` · `--off` · `--warn` · `--warn-fg` | `--c-good` · `--c-good-fg` · `--c-off` · `--c-warn` · `--c-warn-fg` |
| `--alarm` / `--fault` · `--fault-fg` · `--critical` · `--force` | `--c-fault` · `--c-fault-fg` · `--c-critical` · `--c-force` |
| `--interact` | `--c-accent` |

v1.7 **không có** 14 token sau, vì chúng ra đời cùng theme tối và cùng lớp badge
nền đặc: `--c-line-strong`, `--c-accent-2`, `--c-info`, `--c-indicator-ok`,
`--c-indicator-off`, bảy `--c-*-bg`, `--c-on-accent`, `--c-on-fault`.

**Giá trị — siết lại để đạt AA.** Đây là kết quả của `WEB-UX-008`/`WEB-UX-012`
trong [plan 45](../03_implementation/45_WEB_UX_REMEDIATION_AND_CICD_PLAN.md). Bộ
cũ trượt ở diện rộng: `--border` chỉ đạt **1,64:1** (yêu cầu 3:1 cho ranh giới
thành phần) và `--warn` chỉ **1,18:1** khi dùng làm chữ. Trên một HMI đặt trong
phòng máy — ánh sáng gắt, màn hình bám bụi, người trực nhìn chéo — chữ FAULT đọc
không ra là một cảnh báo bị bỏ lỡ, không phải chuyện thẩm mỹ.

Số đo dưới đây tính trên nền trang `--c-bg` #C8CCD0 của theme sáng, bằng đúng
công thức WCAG mà `contrast.ts` dùng:

| Token | v1.7 | Đo được | Hiện hành (`light`) | Đo lại | Vì sao |
|---|---|---:|---|---:|---|
| `--border` → `--c-border` | #9AA0A6 | 1,64:1 | **#636970** | 3,44:1 | đồ hoạ cần 3:1; ranh giới thành phần cũ gần như vô hình |
| `--surface-2` → `--c-surface-2` | #BCC0C4 | — | **#C2C6CA** | — | đây là nền **tối nhất** trong ba nền. Ở #BCC0C4, bảy token chữ chỉ đạt 4,42–4,45:1 — trượt sát ngưỡng. Sáng lên #C2C6CA đưa cả nhóm về 4,71–4,76:1 |
| `--good` → `--c-good` | #2FA45A | 1,98:1 | **#227742** | 3,44:1 | xanh lá bão hoà không đạt 3:1 trên nền xám sáng |
| `--good-fg` → `--c-good-fg` | #1E7A3D | 3,33:1 | **#165B2E** | 5,06:1 | trượt cả trên nền trang lẫn trên `--c-good-bg` (4,43:1) |
| `--off` → `--c-off` | #6B7280 | 2,99:1 | **#4B505A** | 5,01:1 | dùng làm CHỮ ⇒ ngưỡng 4,5:1 chứ không phải 3:1 |
| `--warn` → `--c-warn` | #E8B500 | 1,18:1 | **#826500** | 3,41:1 | vàng bão hoà trên nền sáng là trường hợp trượt nặng nhất của bộ cũ |
| `--warn-fg` → `--c-warn-fg` | #6B5400 | 4,49:1 | **#634D00** | 5,02:1 | trượt **sát** ngưỡng 4,5:1 — đúng loại lỗi mắt thường không thấy |
| `--alarm`/`--fault` → `--c-fault` | #D5202A | 3,20:1 | **#CC1F28** | 3,43:1 | đạt trên nền trang nhưng trượt trên nền phụ (2,82:1) |
| `--fault-fg` → `--c-fault-fg` | #B01219 | 4,41:1 | **#A01017** | 5,04:1 | trượt sát ngưỡng chữ |
| `--critical` → `--c-critical` | #B0179C | 3,77:1 | **#901380** | 5,02:1 | magenta dùng làm chữ ⇒ 4,5:1, không phải 3:1 |
| `--force` → `--c-force` | #8A4FBF | 3,29:1 | **#693797** | 5,01:1 | tím dùng làm chữ ⇒ 4,5:1 |
| `--interact` → `--c-accent` | #2A5C8A | 4,34:1 | **#26527C** | 5,04:1 | focus/liên kết là chữ ⇒ 4,5:1 |

Chú ý một điểm dễ hiểu nhầm: nhiều giá trị v1.7 (#2FA45A, #E8B500, #9AA0A6)
**vẫn còn trong mã** — nhưng ở **theme tối**, nơi nền tối làm chúng đạt ngưỡng.
Bảng cũ chỉ có một cột, nên nó thực chất đem độ bão hoà hợp lệ của theme tối áp
vào theme sáng.

## 3. Typography

**Cỡ chữ web KHÔNG đi qua biến CSS.** Bản v1.7 khai báo bốn token
`--fs-h1`/`--fs-h2`/`--fs-body`/`--fs-mono`; grep toàn `apps/web-ui/src` ra
**0** kết quả cho `--fs-` (đo 2026-08-18). Không có mã nào định nghĩa chúng và
không có mã nào đọc chúng — đó là một cơ chế handoff chỉ tồn tại trên giấy,
cùng họ với finding `F-DOC-02` ở §9. Finding tương ứng: `F-DOC-06`.

Cơ chế thật là **utility class của Tailwind v4**, dùng thẳng tại chỗ. Lý do
giống hệt §4.1: dự án không khai báo lại thang mặc định của Tailwind, nên tiền
tố mang đúng nghĩa mặc định và không cần một lớp biến trung gian để đồng bộ.

| Vai trò | Cách viết trong mã | Cỡ | Ghi chú |
|---|---|---:|---|
| Font UI | `styles.css` `:root { font-family: … }` | — | `Inter, Roboto, ui-sans-serif, system-ui, …` |
| Font HMI | cấu hình LVGL của `apps/hmi` | — | NotoSans (có dấu VI) — không liên quan tới web |
| Tiêu đề trang `<h1>` | `text-2xl` | 24 px | **27/45** `<h1>` trong mã; còn `text-xl` (3) và `text-lg` (2) |
| Tiêu đề mục `<h2>` | `text-xl` / `text-lg` / `text-base` | 20 / 18 / 16 px | chưa thống nhất, xem ghi chú bên dưới |
| Nội dung | `text-sm` | 14 px | cỡ nền của bảng, form và phần lớn nhãn |
| Chú thích / nhãn phụ | `text-xs`, `text-[10px]` | 12 / 10 px | nhãn cột, badge, chú thích trạng thái |
| Giá trị số, mã ST | class `.mono` trong `styles.css` | thừa hưởng | `"JetBrains Mono", "Roboto Mono", Consolas, ui-monospace, …` |

Hai điều tài liệu này **không** được nói quá:

- `.mono` chỉ đổi **font family**, không đặt cỡ chữ. Con số "13px JetBrains
  Mono" của v1.7 không có trong mã.
- Cỡ `<h1>` **chưa đồng nhất** (24/20/18 px tuỳ trang). Đây là hiện trạng đo
  được, không phải quy ước đã chốt. Muốn chốt một cỡ duy nhất thì cần một task
  sửa mã, không phải một dòng trong tài liệu — và cho tới lúc đó, bảng trên ghi
  đúng cái đang chạy.

## 4. Spacing & layout
- Grid base **8px** (4/8/16/24/32).
- Bo góc `--radius`: 6px (web), 4px (HMI).
- HMI cố định 320×240 (landscape).
- HMI body text tối thiểu 14px; action touch target tối thiểu 40×40px hoặc có hard-key equivalent.

### 4.1 Breakpoint web — một bộ số duy nhất

Web dùng **nguyên bộ breakpoint mặc định của Tailwind v4**, không khai báo lại.
`apps/web-ui` không có `tailwind.config.*` và `src/shared/styles.css` không có
khối `@theme` đè `--breakpoint-*`, nên tiền tố `sm:`/`md:`/`lg:`/`xl:`/`2xl:`
trong mã mang đúng nghĩa mặc định:

| Tiền tố | Ngưỡng | Vai trò trong sản phẩm |
|---|---:|---|
| (mặc định) | < 640 px | điện thoại dọc — **mục tiêu hỗ trợ 390×844** |
| `sm:` | ≥ 640 px | điện thoại ngang |
| `md:` | ≥ 768 px | tablet dọc; bảng bắt đầu bày đủ cột |
| `lg:` | **≥ 1024 px** | **ngưỡng điều hướng:** thanh bên cố định thay cho ngăn kéo |
| `xl:` | ≥ 1280 px | desktop rộng; bố cục nhiều cột |
| `2xl:` | ≥ 1536 px | màn hình lớn, chỉ nới khoảng trắng |

**Ngưỡng có ý nghĩa hành vi duy nhất là `lg` = 1024 px.** Đây là chỗ điều hướng
đổi hình thái, và nó phải được nói ra bằng **một** con số vì cả ba nơi đều bám
vào nó:

- `NavRail` là `hidden … lg:flex` — thanh bên chỉ tồn tại từ 1024 px trở lên.
- `NavDrawer` là `lg:hidden` — ngăn kéo chỉ tồn tại dưới 1024 px.
- Nút ☰ mở ngăn kéo ở `TopBar` cũng là `lg:hidden`.

Ba khai báo này phải đổi cùng lúc hoặc không đổi. Đặt chúng ở hai ngưỡng khác
nhau tạo ra một dải chiều rộng **không có điều hướng nào**, hoặc có hai cái cùng
lúc.

**Hai viewport tham chiếu bắt buộc** (đúng bộ mà e2e đo):

| Viewport | Dùng để | Ràng buộc |
|---|---|---|
| **1440×900** | desktop chính | Critical/High nằm trên nếp gấp (`REQ-PA3-01-8`) |
| **390×844** | điện thoại tại tủ | **không cuộn ngang** (`REQ-PA3-X-6`); bảng cuộn ngang *trong khối của nó*; điều hướng qua ngăn kéo có bẫy tiêu điểm và đóng bằng Escape ([UX-REQ-PA3-WEB-001](../02_requirements/UX_REQ_PA3_WEB.md) §3.2) |

Con số "≥1280 desktop (chính), ≥768 tablet (commissioning)" của v1.7 là **sai so
với sản phẩm** và đã bị bỏ (finding `F-DOC-05`): nó không mô tả ngưỡng hành vi
nào có thật trong mã, và bỏ sót hẳn dải điện thoại mà `UX_REQ_PA3_WEB` §3.2 yêu
cầu hỗ trợ.

## 5. Component dùng chung (spec props)
| Component | Mô tả | State |
|-----------|-------|-------|
| **Button** | primary/secondary/danger | default/hover/disabled/loading |
| **PointCard** | hiện 1 I/O point | value, unit, quality, fault, force |
| **Gauge** | arc gauge (nhiệt/áp/%) | min,max,value,zones |
| **StatusBadge** | chip trạng thái | 14 biến thể màu — bảng §5.2 |
| **DataTable** | watch table, point list | sort, filter, realtime cell flash |
| **Modal** | xác nhận hành động | confirm/cancel, danger variant |
| **Toast** | thông báo | info/success/warn/error |
| **NavRail** | điều hướng theo role | active item |
| **AlarmRow** | 1 dòng alarm | priority, lifecycle state, time, source, response, ack-state |
| **ControlFaceplate** | point được whitelist | effective value, feedback, mode, source, priority, expiry, actions |
| **CommandStatus** | lifecycle command | editing/pending/accepted/rejected/timeout/expired/released |

> Lưu ý: normal/available dùng neutral; `--c-good` chỉ cho running/energized/success
> cần xác nhận. Off/stopped = xám, warn = vàng, fault = đỏ, priority cao nhất =
> critical khi philosophy quy định, force = tím. Mọi trạng thái luôn có chữ/icon/label.

### 5.1 PointCard — quy ước hiển thị (dùng cả Web + HMI)
```
┌──────────────────────────┐
│ UI1  Nhiệt độ phòng    ✓ │   ← tên + StatusBadge
│  23.5 °C                  │   ← giá trị lớn (mono)
│  NTC10k · good · 10:42    │   ← loại sensor · quality · time
└──────────────────────────┘
quality normal/good → neutral + "✓ GOOD"; confirmed energized/running có thể thêm xanh; off/stopped → xám + "OFF"; uncertain/warn → chip vàng + "⚠ WARN"; fault → chip đỏ + "✕ FAULT"
đang force → viền/badge tím + "FORCED"
```
Trạng thái normal của PointCard dùng neutral để abnormal nổi bật; xanh chỉ dùng cho
energized/running/success khi hữu ích. Luôn kèm chữ/icon/label theo ADR-009.

### 5.2 StatusBadge — 14 biến thể màu, không phải 6

Bản v1.7 liệt kê 6 state (`good/off/warn/fault/force/online`). Con số đó sai
theo cả hai hướng và đã bị bỏ (finding `F-DOC-07`): `good` và `off` **không**
phải tên state của bảng màu, còn bảng màu thật có **14** biến thể.

Nguồn chân lý là `BADGE_VARIANTS` trong
`apps/web-ui/src/shared/theme/tokens.ts`, và nó **được đo tự động**:
`contrast.test.ts` chạy đúng 14 biến thể này qua công thức WCAG ở cả hai theme.
Thêm một biến thể vào mã mà quên nền `--c-*-bg` là test đỏ, không phải một chip
khó đọc chỉ phát hiện ra trên màn hình thật.

| Họ màu | State | Token chữ / nền |
|---|---|---|
| Bình thường đã xác nhận | `normal`, `ok`, `online`, `live`, `connected` | `--c-good-fg` / `--c-good-bg` |
| Bất thường nhẹ | `degraded`, `uncertain`, `stale` | `--c-warn-fg` / `--c-warn-bg` |
| Sự cố | `fault`, `offline`, `alarm` | `--c-fault-fg` / `--c-fault-bg` |
| Ưu tiên cao nhất | `critical` | `--c-critical` / `--c-critical-bg` |
| Đang ép tay | `forced` | `--c-force` / `--c-force-bg` |
| Không rõ / không hoạt động | `unknown` | `--c-off` / `--c-off-bg` |

Phân biệt hai thứ hay bị lẫn:

- **14 biến thể màu** (`BADGE_VARIANTS`) là hợp đồng *hiển thị* và là thứ được
  đo tương phản.
- **27 khoá nhãn** trong `labelMap` của `StatusBadge.tsx` là các **bí danh**
  cùng trỏ về một trong 14 biến thể trên (`good`→ họ bình thường, `off`/`stopped`/
  `inactive`→ họ không hoạt động, `warn`/`warning`→ họ bất thường, `bad`/
  `disconnected`→ họ sự cố, `force`→ `forced`…). Bí danh tồn tại vì producer
  khác nhau gọi cùng một trạng thái bằng chữ khác nhau; chúng **không** làm
  tăng số màu.

## 6. Phân cấp điều hướng (ISA-101)

Điều hướng web Rev A chia **4 nhóm** theo `ADR-032`
([Architecture Decision Log](../00_governance/DECISIONS.md)), thay cho 3 nhóm của
[ADR-009](../adr/ADR-009-isa101-hmi-and-nav-restructure.md) Decision #2 — phần
navigation của ADR-009 ở trạng thái `SUPERSEDED`; phần màu Level B hybrid của nó
**vẫn còn hiệu lực**.

Bảng dưới đây khớp `apps/web-ui/src/shared/components/NavRail.tsx`:

| Nhóm | Khoá i18n | Trang (route) |
|------|-----------|---------------|
| **Tổng quan** | `overview` | Bảng điều khiển `/` (nhúng System Health) · Giám sát `/monitor` · Alarm `/alarms` · Xu hướng `/trends` · Nhật ký hoạt động `/activity` |
| **Vận hành** | `operation` | Lịch vận hành `/eng/scheduler` · Chạy thử `/eng/commissioning` |
| **Kỹ thuật** | `engineering` | Cấu hình Inputs `/eng/inputs` · Cấu hình Outputs `/eng/outputs` · Virtual Points `/eng/virtual-points` · Modbus RTU `/eng/modbus-rtu` · Cấu hình cảnh báo `/eng/alarm-settings` · Chẩn đoán `/diagnostics` · Lập trình `/eng/programming` |
| **Hệ thống** | `system` | Mạng `/settings/network` · Thiết bị `/settings/device` · Thời gian/Ngày `/settings/time` · Người dùng `/settings/users` · Hiển thị `/settings/display` |

Ba luật đi kèm, đều đã có trong mã:

1. **Programming chỉ hiện khi cờ build-time `VITE_PROGRAMMING_REV_A` bật.** Cờ
   này là build-time, không phải runtime: build cho board phải dùng
   `npm run build:foxlinx`.
2. **Lọc mục theo vai trò dùng chung `ROUTE_MIN_ROLE` với gate route**, không có
   bảng thứ hai — hai bảng riêng sẽ lệch nhau ngay lần đầu ai đó siết quyền.
   Đây là lớp bổ sung cho `RequireRole`, không thay thế: gate ở route mới là thứ
   chặn thật.
3. **`/settings/network` hiện cho mọi vai trò** theo ADR-017 §2.7 — viewer và
   operator được đọc trạng thái authority, còn trang tự khoá toàn bộ nút
   mutation. Ẩn hẳn mục này từng biến cả nhánh chỉ-đọc thành mã chết.

`/me` (thông tin người dùng) **không** nằm trong thanh điều hướng bên trái; nó
được mở từ menu tài khoản ở `TopBar`.

Hai route cố ý nằm **ngoài cả bốn nhóm** theo [`ADR-033`](../00_governance/DECISIONS.md):
`/eng/user-parameters` và `/eng/aux`. Cả hai chạy trên dữ liệu demo hoặc runtime
legacy chứ không phải chức năng thiết bị thật — `getUserParams()` trả dữ liệu mock
bất kể cờ demo và không có endpoint backend nào, nên đưa chúng vào menu là nhân một
lỗi "bịa dữ liệu" từ phạm vi "chỉ người gõ tay URL gặp" lên "mọi admin thấy và tin".
`route-menu-contract.test.ts` khoá tình trạng cách ly này lại: mọi route đều phải
khai báo người dùng tới bằng cách nào, không có loại "chưa xếp".

Mục đang chọn dùng dấu hiệu trung tính (weight, line, marker, background nhẹ), không glow/bão hòa màu. Nhóm điều hướng thu gọn được để giảm tải thị giác; ở chế độ thu gọn tiêu đề nhóm ẩn đi và mọi nhóm luôn mở.

Ngưỡng chuyển thanh bên ↔ ngăn kéo là **1024 px** — xem §4.1.

### 6.1 Điều hướng HMI local

HMI 320×240 không dùng navigation Web ba nhóm. Nó có đúng năm surface
`Home/Points/Control/Alarms/Service`, một page title lớn và page chooser với target
tối thiểu 40×40px. Communication/System được gộp vào Home/Service. Control chỉ chứa
point authority whitelist; không có schedule, engineering, alarm configuration hoặc
user administration trên panel local.

## 7. Iconography
Outline 24px (web) / 16px (HMI): home, io, alarm, network, settings, user, play, stop, upload, download, force, lock, refresh.

Trạng thái phải có dấu hiệu phi-màu đi kèm: icon/chữ/shape/symbol. Không dùng icon chỉ để trang trí khi icon đang mang nghĩa trạng thái.

## 8. Tiếp cận (WCAG 2.1 AA)
- Tương phản chữ ≥ 4.5:1, chữ lớn ≥ 3:1.
- Focus ring rõ; điều hướng được bằng bàn phím (web) / 6 nút (HMI).
- Không truyền nghĩa chỉ bằng màu.
- Cặp nền/chữ trung tính bắt buộc: `--c-text`/`--c-bg`, `--c-text-dim`/`--c-bg` đạt AA.
- Cặp chữ/đường màu phải đạt ≥ 4.5:1 với **cả ba** nền (`--c-bg`, `--c-surface`, `--c-surface-2`), không chỉ với nền trang: `--c-warn-fg`, `--c-good-fg`, `--c-fault-fg`, `--c-critical`, `--c-force`, `--c-off`. Nền phụ `--c-surface-2` là nền tối nhất, nên nó mới là phép đo quyết định.
- Chữ trên nền đặc `--c-accent`/`--c-fault` dùng `--c-on-accent`/`--c-on-fault`; **không** gán cứng `text-white`.
- Trend line vàng phải dùng amber sẫm (`--c-warn-fg` hoặc màu tương đương) + nét đủ dày; không dùng đường vàng mảnh trên nền xám sáng.
- Warn/alarm/critical luôn có chữ hoặc symbol đi kèm để người dùng không phải phân biệt chỉ bằng màu.

## 9. Handoff cho FE

> [!NOTE]
> **Không có tệp `tokens.json` hay `theme.css`.** Bản v1.7 hứa hai tệp đó; chúng
> chưa từng tồn tại trong repo (finding `F-DOC-02`). Mục này mô tả cơ chế **thật**
> đang chạy.

**Token nằm trong TypeScript, không nằm trong CSS.** Nguồn duy nhất là
`apps/web-ui/src/shared/theme/tokens.ts`. Hai lý do, cả hai đều cụ thể và cả hai
đều ghi ngay đầu tệp đó:

1. **Kiểm được bằng test.** Yêu cầu của plan 45 §8.1 là test tương phản chạy trên
   *token thật*, không phải trên một bản chép tay. Token nằm trong CSS thì test
   buộc phải đọc tệp — mà `?raw` bị plugin Tailwind nuốt, còn `node:fs` thì kéo
   theo `@types/node`. Để ở TS là bỏ hẳn lớp trung gian: test import đúng đối
   tượng mà ứng dụng dùng.
2. **Hai theme cùng một hình dạng.** `ThemeTokens` là `Record` có khoá cố định,
   nên thiếu một token ở theme tối là lỗi biên dịch, không phải một ô màu trống
   phát hiện lúc chạy.

**Cách token tới được CSS:** `applyTheme(theme)` ghi cả 30 biến lên `:root` bằng
`style.setProperty()`, kèm `color-scheme` (thiếu nó, ô nhập ở theme tối vẫn ra nền
trắng chói) và `data-theme`. Component dùng chúng qua `var(--c-*)` trong class
Tailwind, ví dụ `bg-[var(--c-surface)]`.

`apps/web-ui/src/shared/styles.css` **chỉ** giữ những giá trị không phụ thuộc
theme: `--radius`, font stack, reset, focus ring, scrollbar. Thêm một token màu
vào tệp này là đi vòng qua test tương phản.

| Việc cần làm | Nơi làm | Kiểm bằng |
|---|---|---|
| Đổi/thêm token màu | `apps/web-ui/src/shared/theme/tokens.ts` (`TOKEN_NAMES` + cả `LIGHT` và `DARK`) | `npx vitest --run src/shared/theme` |
| Phân loại ngưỡng cho token mới | `TEXT_TOKENS` / `GRAPHIC_TOKENS` / `SURFACE_TOKENS` cùng tệp | như trên |
| Thêm biến thể `StatusBadge` | `BADGE_VARIANTS` cùng tệp | như trên — test đếm đủ 14 biến thể |
| Giá trị không phụ thuộc theme | `apps/web-ui/src/shared/styles.css` | — |
| Cập nhật §2 của hồ sơ này | tài liệu đi **sau** mã, không đi trước | đối chiếu 1-1 bằng mắt |

**Component:** mỗi component ở §5 có props, state, ví dụ dùng → FE map sang React
component. Ngữ nghĩa trạng thái phải giống nhau giữa Web và HMI local (§1 nguyên
tắc 5); từ vựng trạng thái là thứ dễ trôi khỏi nhau nhất giữa hai tầng.

---

## Revision History
| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 1.9 | 2026-08-18 | Agent quyết định (`ADR-033`, `AUTH-WEBUX-2026-08-18-01`) | Đóng 2 finding tài liệu của §7.2b [`REV-FE-UIUX-UC-2026-08-18`](../07_records/reviews/FE_UIUX_UC_REVIEW_2026-08-18.md). **§3** (`F-DOC-06`): bỏ bốn token `--fs-h1/h2/body/mono` — grep toàn `apps/web-ui/src` ra **0** kết quả cho `--fs-`, không mã nào định nghĩa hay đọc chúng; thay bằng bảng cơ chế thật (utility class Tailwind v4 + class `.mono`) kèm số đếm đo được (`<h1>`: 27 `text-2xl`, 3 `text-xl`, 2 `text-lg`) và ghi rõ hai chỗ v1.7 nói quá (`.mono` không đặt cỡ chữ; cỡ `<h1>` chưa đồng nhất). **§5 + §5.2 mới** (`F-DOC-07`): `StatusBadge` từ 6 state sai tên thành **14 biến thể** khớp `BADGE_VARIANTS` và đúng số mà `contrast.test.ts` assert; tách rõ 14 biến thể màu với 27 khoá bí danh trong `labelMap`. |
| 1.8 | 2026-08-18 | Agent tài liệu (`AUTH-WEBUX-2026-08-18-01`) | Đóng 4 finding tài liệu của [`REV-FE-UIUX-UC-2026-08-18`](../07_records/reviews/FE_UIUX_UC_REVIEW_2026-08-18.md), Plan 57 Wave 0 Track D. **§2** (`F-DOC-01`): thay bảng token cũ bằng bảng 30 token khớp 1-1 `tokens.ts` cho **cả hai theme**, thêm §2.2 (hai luật màu được `contrast.test.ts` kiểm tự động) và §2.3 (ánh xạ tên `--x` → `--c-x` + số đo tương phản giải thích từng giá trị bị siết). **§4.1** (`F-DOC-05`): chốt một bộ breakpoint duy nhất theo mặc định Tailwind v4, nêu rõ `lg` = **1024 px** là ngưỡng thanh bên ↔ ngăn kéo và 390×844 là viewport phải hỗ trợ; bỏ cặp số ≥1280/≥768 không có thật trong mã. **§6** (`F-DOC-04`): điều hướng 3 nhóm → **4 nhóm** khớp `NavRail.tsx` theo `ADR-032`; ghi rõ phần navigation của ADR-009 đã `SUPERSEDED` còn phần màu Level B hybrid vẫn hiệu lực. **§9** (`F-DOC-02`): bỏ `tokens.json`/`theme.css` chưa từng tồn tại, mô tả cơ chế thật (token ở TypeScript để test được, `applyTheme()` ghi lên `:root`). §1/§5/§8 đổi theo tên token mới. |
| 1.7 | 2026-07-22 | Tech Lead/UX | Đồng bộ semantic state, typography, touch target và component cho local limited-operator HMI theo ADR-016. |
| 1.5 | 2026-06-23 | UX Lead | Thêm Inputs Config, Controller Diagram, Aux Functions vào Engineering theo ADR-010 |
| 1.6 | 2026-07-22 | Tech Lead/UX | Reserved saturated color for abnormal/confirmed dynamic states; removed blanket green-normal and unsupported magenta=safety semantics; added IEC 60073 review boundary. |
| 1.4 | 2026-06-16 | UX Lead | Đổi sang Level B hybrid — bộ màu trạng thái SCADA + token *-fg cho nền sáng theo ADR-009 amendment |
| 1.3 | 2026-06-16 | UX Lead | Owner adjustment: chữ/icon/chấm/value động normal xanh lá; warn cam, fault đỏ; surface vẫn xám ISA-101 |
| 1.2 | 2026-06-16 | UX Lead | Bổ sung ngoại lệ chấm/icon binary indicator: OK/ONLINE xanh lá, OFF/OFFLINE xám, vẫn kèm chữ/icon |
| 1.1 | 2026-06-16 | UX Lead | Áp ISA-101 Level A nền xám sáng + phân cấp điều hướng 3 nhóm theo ADR-009 |
| 1.0 | 2026-05-30 | UX Lead | Phát hành đầu — tokens, typography, components |
