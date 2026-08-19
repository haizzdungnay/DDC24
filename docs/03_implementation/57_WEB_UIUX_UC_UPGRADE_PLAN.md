# Plan 57 — Nâng cấp UC/UI/UX Web HMI + đóng finding `REV-FE-UIUX-UC-2026-08-18`

**Trạng thái:** **Wave 0–2 xong; Wave 3 xong 14/21; Wave 4 xong 2/2.**
Wave 0 mở bằng `AUTH-WEBUX-2026-08-18-01`; **Wave 1 và phần FE thuần của Wave 2
mở bằng `AUTH-WEBUX-2026-08-18-02`** (2026-08-18, `docs/00_governance/DECISIONS.md`),
sau khi **cả tám câu hỏi §12 đã có quyết định** (`ADR-034`…`ADR-039`) và asset
trực quan cho hai màn hình mới đã phát hành.
Wave 3 (trừ `T57-3.8`) và Wave 4 mở bằng `AUTH-WEBUX-2026-08-19-01` ngày
2026-08-19. **`T57-3.8` giữ `IMPLEMENT_READY BLOCKED`** — quét bus Modbus là ghi
ra RS-485 thật; cần quyết định người riêng.
**Ngày:** 2026-08-18
**Tác giả:** Agent kỹ thuật
**Người cần duyệt:** PM/CTO (phạm vi + thứ tự Wave) · UX Lead (Wave 0 Track D — tài liệu authority) · Tech Lead (Wave 3 — đổi contract)
**Tham chiếu:**
[Review nguồn](../07_records/reviews/FE_UIUX_UC_REVIEW_2026-08-18.md) (`REV-FE-UIUX-UC-2026-08-18`) ·
[Design system](../04_uiux/KX-DDC24-UX-SYSTEM-001_VI.md) (`KX-DDC24-UX-SYSTEM-001`) ·
[Yêu cầu UX PA3](../02_requirements/UX_REQ_PA3_WEB.md) (`UX-REQ-PA3-WEB-001`) ·
[Quy tắc kiểm soát tài liệu](../00_governance/DOC_GOVERNANCE.md) ·
[Plan 45](45_WEB_UX_REMEDIATION_AND_CICD_PLAN.md) · [Plan 52](archive/52_WEB_PA3_DASHBOARD_UX_IMPLEMENTATION_PLAN.md) · [Plan 55](55_UI_UNIVERSAL_INPUT_REDESIGN_PLAN.md)

---

## 0. Cổng quyền hạn — đọc trước

| Cổng | Trạng thái | Ghi chú |
|---|---|---|
| `PLAN_READY` | **PASS** (2026-08-18) | Mở bằng `AUTH-WEBUX-2026-08-18-01` |
| `IMPLEMENT_READY[Wave 0 Track A/B/C/D]` | **PASS** (2026-08-18) | Mở bằng cùng record; ba track A/B/C không đổi contract, Track D là tài liệu authority |
| `IMPLEMENT_READY[Wave 1]` | **PASS** (2026-08-18) | Mở bằng `AUTH-WEBUX-2026-08-18-02`. Hai điều kiện chặn đã gỡ: asset trực quan phát hành tại `docs/04_uiux/assets/operations/` và nhúng trong `KX-DDC24-UX-WEB-OPERATIONS-001`; Q2 (`ADR-034`) và Q6 (`ADR-037`) đã trả lời |
| `IMPLEMENT_READY[Wave 2]` | **PASS** cho phần FE thuần (2026-08-18) · **đã triển khai xong 2026-08-19** | Wave 0 Track C xong + Q4 trả lời (`ADR-035`). **Trừ `T57-2.13`**, đã chuyển sang Wave 3 |
| `IMPLEMENT_READY[Wave 3]` | **PASS trừ `T57-3.8`** (2026-08-19) | Mở bằng `AUTH-WEBUX-2026-08-19-01`; `ADR-042`…`ADR-049` là đầu vào implementation. Ba task C++ còn lại đã có chủ sở hữu theo `AUTH-WEBUX-2026-08-19-02` quyết định 2 |
| `IMPLEMENT_READY[T57-3.8]` | **BLOCKED — hoãn sang Rev B** (2026-08-19) | `AUTH-WEBUX-2026-08-19-02` quyết định 1. Quét là **phát khung ra RS-485 thật** trên Rev A một cổng; `ADR-039` giữ nguyên tư cách **đặc tả**, không phải giấy phép. Mở lại khi PM chỉ định **Fieldbus Lead + QA/HIL Lead** (điều kiện Track B từ phê duyệt PM/CTO 2026-08-04) |
| `IMPLEMENT_READY[Wave 4]` | **PASS** (2026-08-19) · **đã nghiệm thu** | Chủ sở hữu chốt: `T57-4.1` đi đường tối thiểu qua `T57-3.1` (ISA-101 Level 2 hoãn Rev B), `T57-4.2` làm ngay. `T57-4.2` **đã đo trên board thật** 2026-08-19 theo `ADR-049` điều 3 — xem §13b |
| `RELEASE_READY` | **N/A** | Cổng độc lập, **không** được suy ra từ ba record `AUTH-WEBUX-*`. Nay có thêm một tiền đề tường minh: **chữ ký người thật cho `ADR-033`…`ADR-049`** — waive hết hiệu lực đúng tại cổng này (`AUTH-WEBUX-2026-08-19-02` quyết định 4) |

> [!IMPORTANT]
> **Cả tám câu hỏi §12 đã có quyết định có ghi chép.** Q1/Q3 đóng bằng
> `AUTH-WEBUX-2026-08-18-01`; sáu câu còn lại đóng bằng `AUTH-WEBUX-2026-08-18-02`
> và `ADR-034`…`ADR-039`.
>
> Riêng **Q8 là câu hỏi an toàn** — quét bus Modbus là ghi ra bus thật. `ADR-039`
> là **đặc tả, không phải giấy phép thi hành**. Chủ sở hữu sản phẩm đã quyết định
> tại `AUTH-WEBUX-2026-08-19-02`: **`T57-3.8` hoãn sang Rev B**, ra khỏi phạm vi
> Rev A. Không dòng code ghi ra bus RS-485 nào được viết trong phiên 2026-08-18
> lẫn 2026-08-19.
>
> Mọi quyết định trong `ADR-034`…`ADR-049` do **agent** thực hiện dưới vai trò
> được giao; ô chữ ký ghi `WAIVED FOR IMPLEMENTATION` theo `DOC_GOVERNANCE` §6
> quy tắc 4. Chúng đủ tư cách làm **đầu vào implementation**, chưa đủ tư cách
> baseline `M5 — APPROVED`. Từ `AUTH-WEBUX-2026-08-19-02` quyết định 4, waive này
> **có mốc hết hiệu lực: cổng `RELEASE_READY` Rev A**. Tới mốc mà chưa có chữ ký
> người thật thì cổng đó không được mở.

---

## 1. Phạm vi

### 1.1 Trong phạm vi

- **67 đề xuất UC/UI/UX** ở §6 của `REV-FE-UIUX-UC-2026-08-18` (19 nhóm PAGE), **trừ §6.8**.
- **10 finding còn mở** ở §7 của cùng review: `F-UX-12..16` (code) và `F-DOC-01..05` (tài liệu).
- **Hạ tầng chống tái diễn** cho 11 finding đã sửa ở phiên review (hiện chưa có test khoá riêng).
- Cập nhật tài liệu thiết kế, tài liệu yêu cầu, ADR và traceability đi kèm.

### 1.2 Ngoài phạm vi — có chỉ thị rõ

| Mục | Lý do |
|---|---|
| **§6.8 `/eng/commissioning`** (3 đề xuất: kịch bản nghiệm thu nhiều bước, thời gian đáp ứng cơ cấu, chạy thử tuần tự) | **Chỉ thị của user ngày 2026-08-18: không làm.** Ghi lại ở đây để không ai coi là bỏ sót; nếu sau này cần thì mở plan riêng |
| Bốn đề xuất Programming §6.14 | **Đã có plan riêng** — [Plan 53](53_PROGRAMMING_IMPLEMENTATION_PLAN.md) và [Master Plan 56](56_PROGRAMMING_IMPLEMENTATION_MASTER_PLAN_2026Q3.md). Plan 57 **không lập lại**, chỉ dẫn chiếu ở §8 (Track P) để giữ bức tranh đầy đủ |
| Thay đổi firmware MCU | Không đề xuất nào trong §6 đụng tới MCU |

---

## 2. Nguyên tắc thực hiện

1. **Tài liệu trước, code sau.** Mọi task tạo màn hình mới hoặc đổi hành vi an
   toàn phải có mục trong hồ sơ UI/UX chủ quản **kèm asset render được**
   (`DOC_GOVERNANCE.md` §2.2 — wireframe ASCII **không đủ**) trước khi mở nhánh code.
2. **Không đề xuất nào được âm thầm biến mất.** §10 là ma trận truy vết 1-1 giữa
   67 đề xuất và task; task nào bị loại phải ghi lý do tại đúng ô đó.
3. **Mỗi task có: file chạm tới · acceptance criteria kiểm được · test phải
   thêm/sửa.** Không nhận task chỉ có mô tả.
4. **Không nới quyền route.** Mọi màn hình mới phải khai `ROUTE_MIN_ROLE` suy từ
   endpoint backend thật, đúng mẫu `auth/roles.ts` hiện có.
5. **Không bịa dữ liệu** — luật nền của sản phẩm. Màn hình mới thiếu nguồn thật
   thì hiện `—` và nói ra vì sao, không dựng số minh hoạ.
6. **Đo lại thật, không dẫn số cũ** ở mọi mốc kiểm chứng (CLAUDE.md §"Quy trình commit").
7. **Build cho board dùng `npm run build:foxlinx`**, không phải `npm run build` trần
   (cờ `VITE_PROGRAMMING_REV_A` là build-time; đã tái diễn 3 lần).

---

## 3. Tám khối hạ tầng dùng chung

Nhiều đề xuất ở các trang khác nhau thật ra cần **cùng một khối**. Làm khối
trước, trang sau — nếu làm theo thứ tự trang sẽ viết lại cùng một thứ 3–4 lần.

| Khối | Nội dung | Phục vụ đề xuất |
|---|---|---|
| `BB-1` **`useUrlFilters` + Saved View** | Hook đưa bộ lọc vào URL (đã có sẵn mẫu ở `MonitorPage`) + lớp đặt tên/lưu khung nhìn | §6.2-P2a, §6.3-P2a, §6.4-P2b, §6.5-P2b, §6.7-P2b |
| `BB-2` **`useDirtyGuard`** | `beforeunload` + chặn điều hướng trong app + modal Lưu/Bỏ/Ở lại (đã có sẵn mẫu ở `InputsPage`) | `F-UX-12`, §6.10-P1a, §6.11-P1, §6.13-P1a |
| `BB-3` **Equipment tag** | Trường "điểm thuộc thiết bị công nghệ nào" trong contract cấu hình điểm | §6.2-P2b, và là **đường đi tối thiểu** tới ISA-101 Level 2 (§4.1 review) |
| `BB-4` **Override registry** | Một nguồn dữ liệu "mọi điểm đang bị ép tay + ai ra lệnh + TTL còn lại" | §6.1-P1a, §6.2-P1b, §6.2-P1a, §6.19-P2 |
| `BB-5` **Alarm presentation** | `SeverityBadge` dùng chung cho cả nhật ký + lớp annunciation | `F-UX-13`, §6.3-P1a, §6.3-P1b |
| `BB-6` **Chart interaction** | Crosshair, trục Y thứ hai, marker sự kiện — một lớp trên `TrendChart` | §6.4-P1, §6.4-P2a, §6.4-P2c |
| `BB-7` **Preview/Simulate** | Mẫu "nhập giá trị thử → hiện kết quả theo cấu hình đang soạn", chưa lưu gì | §6.9-P1, §6.10-P2, §6.13-P1b |
| `BB-8` **Candidate diff** | Bảng so sánh "đang lưu ↔ bản nháp" (đã có `NetworkCandidateDiff`) | §6.9-P2a |

---

## 4. Wave 0 — Đóng nợ và chống tái diễn

Mục tiêu: **không mang nợ cũ vào tính năng mới.** Wave này không thêm UC nào;
nó đóng 10 finding còn mở và dựng ba gate chặn lỗi tái diễn.

### Track A — Finding code còn mở

| # | Task | File chính | Acceptance criteria | Ước lượng |
|---|---|---|---|---:|
| `T57-0.1` | `BB-2` `useDirtyGuard` + áp cho `OutputsPage`, `AlarmSettingsPage`, `VirtualIoPage`, `UserParametersPage` (`F-UX-12`) | `shared/hooks/useDirtyGuard.ts` (mới), 4 trang | Sửa một field rồi bấm mục menu khác ⇒ hiện modal Lưu/Bỏ/Ở lại; đóng tab ⇒ `beforeunload`; không dirty ⇒ **không** chặn gì | 2.0 |
| `T57-0.2` | Nhật ký alarm dùng `SeverityBadge` 5 mức thay ánh xạ 3 trạng thái tại chỗ (`F-UX-13`) | `AlarmsPage.tsx` (`HistoryRow`) | `low` và `info` **không** còn dùng xanh lá; 5 mức phân biệt được bằng icon + nhãn + màu; `contrast.test.ts` vẫn PASS | 0.5 |
| `T57-0.3` | `TrendPreview` lấy mẫu theo `updatedAt` của producer, không theo `setInterval` trình duyệt (`F-UX-14`, §6.1-P1b) | `DashboardPage.tsx` | Điểm cập nhật 5 s/lần ⇒ biểu đồ có **1** mẫu/5 s, không phải 5; điểm ngừng cập nhật ⇒ đường đứt (xem §12-Q3) | 1.0 |
| `T57-0.4` | Thêm `<h1>` cho 19 trang/tab + nhánh trả về sớm của `SchedulerGridPage` (`F-UX-15`, §6.12-P2a, §6.14-P2b) | `modbus-rtu/*`, `programming/*`, `scheduler/*` | Mọi route render đúng **một** `<h1>`; test tự động duyệt bảng route và assert | 1.5 |

### Track B — Test khoá 11 finding đã sửa

Hiện 11 bản sửa của phiên review chỉ được 692 test **hiện có** bao quanh, chưa
có test riêng. Không có lớp này thì lần refactor sau sẽ mở lại đúng các lỗi đó.

| # | Task | File chính | Acceptance criteria | Ước lượng |
|---|---|---|---|---:|
| `T57-0.5` | Test cho `F-UX-05/06/09/10/11` (bàn phím nút gạt DO, nút ép tay có nhãn, giá trị mặc định rỗng, nút gạt trend, đếm điểm nhị phân) | `MonitorPage.*.test.tsx` | Mỗi finding một test âm (tái hiện lỗi cũ) + một test dương | 1.5 |
| `T57-0.6` | Test cho `F-UX-07` (sparkline rỗng) và `F-UX-08` (nhãn `uncertain`) | `MonitorPage.*.test.tsx` | Point không có mẫu ⇒ **không** có phần tử `<polyline>`; `uncertain` ⇒ chuỗi `UNCERTAIN`, không chứa `HIGH` | 0.5 |
| `T57-0.7` | Test deep link `F-UX-02/03/04` ở cả ba trang đích | `AlarmsPage.test.tsx`, `TrendsPage.*.test.tsx`, `MonitorPage.test.tsx` | Mở với query ⇒ danh sách bị lọc đúng; query trỏ tới đối tượng không tồn tại ⇒ có thông báo, **không** bảng rỗng im lặng | 1.0 |

### Track C — Gate chặn tái diễn

Đây là phần có giá trị dài hạn nhất của Wave 0: nó đóng **cơ chế sinh lỗi**, không chỉ lỗi.

| # | Task | File chính | Acceptance criteria | Ước lượng |
|---|---|---|---|---:|
| `T57-0.8` | **Test hợp đồng deep link hai chiều**: đối chiếu tập tham số `drilldown.ts` phát ra với tập tham số mỗi trang đích thực sự đọc | `shared/overview/drilldown.contract.test.ts` (mới) | Thêm một `targetType` mới mà quên nối trang đích ⇒ test **đỏ**. Đây là gate chặn `F-UX-02/03/04` tái diễn (§7.3 review, cơ chế 1) | 1.5 |
| `T57-0.9` | **Lint gate chuỗi tiếng Việt mất dấu** trong JSX | `eslint.config.js` + rule tuỳ biến hoặc script `scripts/check_ui_strings.py` | Thêm `pick('Dang tai...', ...)` ⇒ lint **đỏ**; chạy được trong `npm run lint`. Gate chặn `F-UX-01` tái diễn | 1.0 |
| `T57-0.10` | **Kiểm chéo từ vựng trạng thái HMI ↔ Web** (§6.19-P1) | Nguồn chung (JSON/YAML) sinh mã cho cả `apps/hmi/i18n` (C++) và `shared/i18n.tsx` (TS), hoặc test đối chiếu hai bảng | Sửa nhãn một bên mà không sửa bên kia ⇒ test đỏ. `UX-SYSTEM-001` §1.5 yêu cầu điều này nhưng chưa có gì khoá | 2.0 |

### Track D — Tài liệu authority (**cần UX Lead ký**)

| # | Task | Hồ sơ | Acceptance criteria | Ước lượng |
|---|---|---|---|---:|
| `T57-0.11` | Đồng bộ bảng token `UX-SYSTEM-001` §2 với `theme/tokens.ts` (`F-DOC-01`) | `KX-DDC24-UX-SYSTEM-001_VI.md` → v1.8 | Tên biến và giá trị khớp 1-1 với `tokens.ts` (cả `light` và `dark`); ghi rõ lý do đổi (siết để đạt AA ở plan 45); Revision History cập nhật | 1.0 |
| `T57-0.12` | Sửa §9 "Handoff cho FE" — bỏ `tokens.json`/`theme.css` không tồn tại, mô tả cơ chế thật (`F-DOC-02`) | `KX-DDC24-UX-SYSTEM-001_VI.md` | §9 mô tả đúng: token ở TS để test được; dẫn `tokens.ts` và `contrast.test.ts` | 0.25 |
| `T57-0.13` | **ADR mới**: điều hướng 3 nhóm → 4 nhóm (`F-DOC-04`) | ADR mới (số cấp ở `docs/00_governance/DECISIONS.md`), `UX-SYSTEM-001` §6 | ADR nêu quan hệ `supersedes` với ADR-009 phần navigation; §6 của design system khớp `NavRail.tsx` | 0.75 |
| `T57-0.14` | Chốt breakpoint chuẩn (`F-DOC-05`) | `UX-SYSTEM-001` §4, `UX_REQ_PA3_WEB` §3.2 | Một con số duy nhất cho ngưỡng thanh bên ↔ ngăn kéo, khớp `lg` của code; nêu rõ 390×844 là mục tiêu hỗ trợ | 0.25 |
| `T57-0.15` | Sửa mâu thuẫn `unknown` trong `UX_REQ_PA3_WEB` §1.1 (`F-DOC-03`) | `UX_REQ_PA3_WEB.md` → v1.1 | Câu luật "bốn trạng thái" chuyển về đúng mục `health.state`, hoặc thêm `unknown` vào `PointQuality` ở **cả** doc lẫn `types.ts` (xem §12-Q1) | 0.5 |

**Tổng Wave 0:** ~15,25 người-ngày · **không đổi contract, không cần backend.**

---

## 5. Wave 1 — An toàn vận hành

Tiêu chí vào Wave 1: đề xuất **P1** ảnh hưởng trực tiếp tới an toàn hoặc khả
năng bàn giao ca, và **làm được bằng dữ liệu đã có trên wire**.

| # | Task | Đề xuất | File chính | Acceptance criteria | Ước lượng |
|---|---|---|---|---|---:|
| `T57-1.1` | `BB-4` Override registry — nguồn dữ liệu chung | — | `shared/overview/overrides.ts` (mới) | Trả về danh sách điểm `forced` kèm `priority`/actor (từ Activity) và `overrideExpiresInS` do Core cấp; **không** tự tính TTL ở FE | 1.0 |
| `T57-1.2` | Khối "Ai đang giữ quyền điều khiển" trên Landing | §6.1-P1a | `DashboardPage.tsx` | Liệt kê mọi điểm đang ép tay + người ra lệnh + đếm ngược; rỗng ⇒ nói rõ "không có lệnh tay nào"; có đường tới `/activity?objectId=` | 1.5 |
| `T57-1.3` | Cột "Còn lại" (TTL) trên bảng Monitor | §6.2-P1b | `MonitorPage.tsx` | Đếm ngược `mm:ss` trên mọi hàng đang ép tay; sắp hết hạn có dấu hiệu phi-màu kèm theo | 0.75 |
| `T57-1.4` | Ép tay hàng loạt có xác nhận chung | §6.2-P1a | `MonitorPage.tsx` | Chọn nhiều điểm ⇒ **một** hộp thoại liệt kê từng điểm với giá trị hiện tại → giá trị mới; một thời hạn dùng chung; một vết audit cho mỗi điểm; huỷ giữa chừng không để lại lệnh nửa vời | 2.5 |
| `T57-1.5` | `BB-5` Annunciation cho cảnh báo chưa ack | §6.3-P1a | `AppShell.tsx`, `AlarmsPage.tsx`, `DisplaySettingsPage.tsx` | Badge nhấp nháy khi có unack mới; âm thanh **mặc định TẮT**, bật/tắt trong Hiển thị, lưu theo tài khoản; tôn trọng `prefers-reduced-motion` (xem §12-Q2) | 2.0 |
| `T57-1.6` | Ack hàng loạt có lý do bắt buộc | §6.3-P2c | `AlarmsPage.tsx` | Chọn nhiều ⇒ một hộp thoại; trường lý do **bắt buộc**; mỗi cảnh báo một vết audit riêng mang cùng lý do | 1.5 |
| `T57-1.7` | Diễn giải hậu quả `safeState`/`safeValue` bằng ngôn ngữ vận hành | §6.10-P1b | `OutputsPage.tsx` | Mỗi lựa chọn kèm câu mô tả hậu quả vật lý ("mất liên lạc ⇒ van đóng hoàn toàn"); không dùng tên trường làm nhãn | 1.0 |
| `T57-1.8` | Cảnh báo hậu quả khi đổi giờ hệ thống | §6.17-P1 | `TimeSettingsPage.tsx` | Lùi đồng hồ ⇒ cảnh báo nêu rõ ảnh hưởng historian và lịch vận hành, yêu cầu xác nhận riêng | 0.75 |
| `T57-1.9` | Chính sách mật khẩu hiển thị và cưỡng chế | §6.16-P1 | `UsersPage.tsx`, `LoginPage.tsx` | Luật hiện trên form trước khi gõ; chỉ báo độ mạnh; FE **không** được lỏng hơn luật backend (xem §12-Q6) | 1.0 |
| `T57-1.10` | Phân biệt lý do đăng nhập hỏng | §6.18-P2a | `LoginPage.tsx`, `AuthProvider.tsx` | Sai mật khẩu / không tới được backend / tài khoản bị khoá ⇒ **ba** thông điệp khác nhau, không lộ thông tin giúp dò tài khoản | 0.5 |
| `T57-1.11` | "Tuổi dữ liệu tệ nhất trong các phân hệ" trên dải trạng thái | §6.1-P2b | `DashboardPage.tsx` | Lấy `max(observedAt age)` trong `health[]`; overall `good` mà có phân hệ cũ ⇒ vẫn hiện rõ | 0.5 |
| `T57-1.12` | `CommTile` phân biệt "tắt có chủ đích" với "không đọc được" | §6.6-P2b | `DiagnosticsPage.tsx` | BACnet/IP feature-gated OFF ⇒ nhãn riêng, **không** dùng `N/A` chung với lỗi đọc | 0.25 |

**Tổng Wave 1:** ~13,25 người-ngày. `T57-1.9` cần backend xác nhận luật mật khẩu.

---

## 6. Wave 2 — Hiệu quả chẩn đoán và cấu hình

Tiêu chí: rút ngắn thời gian trả lời một câu hỏi chẩn đoán, hoặc bắt lỗi cấu
hình **trước** khi nó ra tới thiết bị. Hầu hết là FE thuần.

| # | Task | Đề xuất | File chính | Acceptance criteria | Ước lượng |
|---|---|---|---|---|---:|
| `T57-2.1` | `BB-1` `useUrlFilters` + lớp Saved View | — | `shared/hooks/useUrlFilters.ts` (mới) | Bộ lọc ↔ URL hai chiều; Back/F5 giữ ngữ cảnh; khung nhìn đặt tên lưu theo tài khoản (phụ thuộc `T57-3.2`) | 2.0 |
| `T57-2.2` | Áp `BB-1` cho Alarms, Scheduler, Activity | §6.3-P2a, §6.7-P2b, §6.5-P2b | 3 trang | Gửi được đường dẫn "High chưa ack trong 24 h"; Activity thêm lọc khoảng thời gian | 1.5 |
| `T57-2.3` | Saved View cho Monitor và bộ trend đặt tên | §6.2-P2a, §6.4-P2b | `MonitorPage.tsx`, `TrendsPage.tsx` | Tạo/đổi tên/xoá khung nhìn; mở bằng `?view=`; không mất bộ lọc cũ trong localStorage | 2.0 |
| `T57-2.4` | `BB-6` Crosshair đọc giá trị mọi series | §6.4-P1 | `TrendChart.tsx` | Di chuột/bàn phím dọc trục thời gian ⇒ bảng giá trị tại mốc đó cho **mọi** series; gap hiện `—`, không nội suy | 2.0 |
| `T57-2.5` | Trục Y thứ hai cho series khác đơn vị | §6.4-P2a | `TrendChart.tsx`, `TrendsPage.tsx` | Gán series sang trục phụ; nhãn trục ghi rõ đơn vị; tối đa 2 trục | 1.5 |
| `T57-2.6` | Marker sự kiện trên biểu đồ (ép tay, cảnh báo bật) | §6.4-P2c | `TrendsPage.tsx` | Marker lấy từ Activity/Alarm thật; bật/tắt được; hover nói rõ sự kiện gì, ai | 2.0 |
| `T57-2.7` | Ghi rõ độ phân giải aggregate đang dùng | §6.4-P3 | `HistoryStateBanner.tsx` | Hiện `raw`/`1m`/`5m` cạnh tiêu đề, lấy từ response, không đoán theo preset | 0.25 |
| `T57-2.8` | Liên kết cảnh báo → điểm nguồn → trend cùng cửa sổ thời gian | §6.3-P3 | `AlarmRow.tsx` | Từ một cảnh báo mở được trend của điểm nguồn với khoảng bao quanh thời điểm bật | 0.75 |
| `T57-2.9` | `BB-7` Xem trước quy đổi Input | §6.9-P1 | `InputsPage.tsx` | Nhập giá trị thô ⇒ hiện giá trị kỹ thuật theo cấu hình **đang soạn**, không phải cấu hình đã lưu; không gọi API ghi | 1.5 |
| `T57-2.10` | `BB-8` Diff "đang lưu ↔ bản nháp" cho Inputs | §6.9-P2a | `InputsPage.tsx` | Dùng lại mẫu `NetworkCandidateDiff`; chỉ hiện field thật sự đổi | 1.0 |
| `T57-2.11` | Sao chép cấu hình sang nhiều kênh | §6.9-P2b | `InputsPage.tsx` | Chọn kênh nguồn + nhiều kênh đích; xem trước danh sách sẽ bị ghi đè **trước** khi áp; không tự Save | 1.0 |
| `T57-2.12` | Xem trước đường cong `minPv`/`maxPv` → tín hiệu ra | §6.10-P2 | `OutputsPage.tsx` | Đồ thị hai điểm cập nhật theo giá trị đang soạn | 0.75 |
| `T57-2.13` | Mô phỏng luật cảnh báo trước khi lưu | §6.13-P1b | `AlarmSettingsPage.tsx` | Nhập chuỗi giá trị thử ⇒ nói ra cảnh báo bật/không, sau bao lâu, mức nào; chạy hoàn toàn ở FE theo đúng luật backend (xem §12-Q4) | 2.0 |
| `T57-2.14` | Thống nhất ngôn ngữ nhãn `AlarmSettingsPage` | §6.13-P2b | `AlarmSettingsPage.tsx`, `i18n.tsx` | Không còn trộn Việt–Anh trong cùng form; thuật ngữ giao thức giữ nguyên có chú giải | 1.0 |
| `T57-2.15` | Xuất CSV Activity theo bộ lọc hiện tại | §6.5-P2a | `ActivityPage.tsx` | CSV khớp đúng bộ lọc đang xem; không chứa secret (theo `REQ-PA3-X-1`) | 0.75 |
| `T57-2.16` | Flash cell "giá trị vừa đổi" ở Monitor | §6.2-P3 | `MonitorPage.tsx` | Theo spec `DataTable` của `UX-SYSTEM-001` §5; tôn trọng `prefers-reduced-motion` | 0.5 |
| `T57-2.17` | Trợ giúp theo ngữ cảnh | §6.18-P2b | `HelpPage.tsx`, `TopBar.tsx` | Mở Help từ một trang ⇒ nhảy đúng mục của trang đó | 1.0 |
| `T57-2.18` | `/me` hiện quyền hiệu lực dạng danh sách việc làm được | §6.18-P3 | `UserInfoPage.tsx` | Sinh từ `ROUTE_MIN_ROLE`, không viết tay (tránh lệch khi siết quyền) | 0.5 |
| `T57-2.19` | Xem trước theme/ngôn ngữ trước khi áp | §6.17-P3 | `DisplaySettingsPage.tsx` | Xem trước không đổi trạng thái toàn app cho tới khi xác nhận | 0.5 |
| `T57-2.20` | Nhân bản một Virtual Point | §6.11-P3 | `VirtualIoPage.tsx` | Nhân bản mở form đã điền sẵn, tag mới chưa trùng; không tự tạo khi chưa xác nhận | 0.5 |
| `T57-2.21` | Xuất "ảnh chụp trạng thái" và "gói chẩn đoán" (JSON) | §6.1-P3, §6.6-P3 | `DashboardPage.tsx`, `DiagnosticsPage.tsx` | JSON kèm mốc thời gian và phiên bản; **không** chứa secret; tải về bằng cơ chế trình duyệt cho phép | 1.0 |
| `T57-2.22` | Mã QR địa chỉ truy cập mới sau khi đổi IP | §6.15-P3 | `NetworkPage.tsx` | QR sinh tại chỗ, không gọi dịch vụ ngoài (bo không có Internet ra ngoài) | 0.5 |

**Tổng Wave 2:** ~24,5 người-ngày.

---

## 7. Wave 3 — Cần contract hoặc backend mới

Mỗi task ở đây **phải có ADR riêng** trước khi code (`DOC_GOVERNANCE.md` §4).
Ước lượng chỉ tính phần FE + Go; chưa tính Core/C++ nếu phát sinh.

| # | Task | Đề xuất | Tầng chạm | ADR cần có | Ước lượng |
|---|---|---|---|---|---:|
| `T57-3.1` | `BB-3` Equipment tag: trường "thuộc thiết bị" trong cấu hình điểm + nhóm theo thiết bị ở Monitor | §6.2-P2b | Contract · Go · FE | **Có** — đổi `CONFIG_SCHEMA` | 4.0 |
| `T57-3.2` | Lưu tuỳ chọn người dùng trên thiết bị (ghim, khung nhìn, âm thanh alarm) | §6.1-P2a | Contract · Go · FE | **Có** — endpoint mới | 2.5 |
| `T57-3.3` | Bảng chỉ số hệ alarm ISA-18.2 §16 (rate, top lặp, shelved sắp hết hạn) | §6.3-P2b | Go · FE (+ màn hình mới) | **Có** — nguồn lưu trữ số đo (§12-Q5) | 4.0 |
| `T57-3.4` | Lịch sử 60 phút cho CPU/RAM/nhiệt độ | §6.6-P2a | Go · FE | Không (mở rộng `/health`) | 2.0 |
| `T57-3.5` | Xem trước "hiệu lực thực tế" khi nhiều lịch cùng tác động một điểm | §6.7-P1 | Go (hoặc Core) · FE | **Có** — ai tính hợp nhất (§12-Q7) | 4.0 |
| `T57-3.6` | Cảnh báo xung đột lịch ngay khi soạn | §6.7-P2a | Go · FE | Dùng chung ADR của `T57-3.5` | 2.0 |
| `T57-3.7` | Nhật ký "lịch này đã tác động những gì trong 7 ngày" | §6.7-P3 | Go · FE | Không | 1.5 |
| `T57-3.8` | Quét/dò thiết bị trên bus Modbus | §6.12-P1a | Core/iobus · Go · FE | **Có** — quét là **ghi ra bus thật** (§12-Q8) | 5.0 |
| `T57-3.9` | Xem thô khung truyền Modbus (gửi/nhận, CRC, timeout) | §6.12-P1b | Core/iobus · Go · FE | **Có** — thêm luồng telemetry | 4.0 |
| `T57-3.10` | Nhập/xuất bảng ánh xạ điểm Modbus (CSV) | §6.12-P2b | Go · FE | Không | 2.0 |
| `T57-3.11` | Mẫu thiết bị Modbus dựng sẵn theo hãng | §6.12-P3 | Go · FE · dữ liệu mẫu | Không | 2.0 |
| `T57-3.12` | "Ai đang dùng Virtual Point này" trước khi xoá | §6.11-P2 | Go · FE | Không | 2.0 |
| `T57-3.13` | Ước lượng tần suất cảnh báo từ lịch sử điểm | §6.13-P2a | Go (historian) · FE | Không | 2.5 |
| `T57-3.14` | Diff trước/sau cho hành động sửa cấu hình trong Activity | §6.5-P3 | Go · FE | Không | 2.0 |
| `T57-3.15` | Trạng thái đồng bộ NTP (lệch, nguồn, lần cuối) | §6.17-P2 | Go · FE | Không | 1.5 |
| `T57-3.16` | Lần đăng nhập gần nhất + phiên đang hoạt động của mỗi tài khoản | §6.16-P2b | Go · FE | Không | 1.5 |
| `T57-3.17` | Buộc đổi mật khẩu mặc định ở lần đăng nhập đầu | §6.16-P2a | Go · FE | **Có** — đổi luồng xác thực | 2.0 |
| `T57-3.18` | Kiểm tra kết nối sau apply mạng (ping gateway/DNS) trong cửa sổ đếm ngược | §6.15-P2 | netcfg · Go · FE | Không | 2.0 |
| `T57-3.19` | HMI: đếm ngược TTL lệnh ép tay trên màn Control | §6.19-P2 | `apps/hmi` (C++) | Không | 1.5 |
| `T57-3.20` | HMI: chỉ báo "Web đang có người đăng nhập" | §6.19-P3 | Go · `apps/hmi` | Không | 1.5 |

**Tổng Wave 3:** ~49,5 người-ngày · **9 ADR** phải viết và ký trước.

---

## 8. Wave 4 và Track P — Quyết định sản phẩm

### Wave 4 — Chưa có quyết định phạm vi

| # | Việc | Nguồn | Vì sao chưa lên lịch được |
|---|---|---|---|
| `T57-4.1` | **ISA-101 Level 2 — process graphic** theo thiết bị công nghệ (AHU/FCU/chiller) | §4.1 review | Đây là **khoảng hở lớn nhất về sản phẩm**, nhưng Rev A không có trình soạn đồ hoạ theo phạm vi đã chốt. Cần CTO/PM quyết: Rev B, hay chấp nhận đường đi tối thiểu qua `T57-3.1` (nhóm theo thiết bị). Nếu làm: cần hồ sơ UI/UX riêng với asset đầy đủ theo `DOC_GOVERNANCE` §2.2 |
| `T57-4.2` | Code-splitting theo route | `F-UX-16` | Bundle Foxlinx **892 kB** (227 kB gzip). Đổi chiến lược chunking chạm toàn bộ quy trình đóng gói/deploy; phải đo lại thời gian mở trang đầu **trên board thật**, không so kích thước tệp |

> **Chú thích phép đo (`F-DOC-10`, đo lại 2026-08-18).** Con số 892 kB ở trên đo
> bằng `npm run build:foxlinx`, tức có bake bốn workspace Programming; còn
> `F-UX-16` trong biên bản review đo bằng `npm run build` trần. Hai phép đo khác
> nhau, không mâu thuẫn. Đo lại trên cùng cây làm việc: **715,18 kB** (trần) so
> với **898,84 kB** (Foxlinx), chênh **183,66 kB**; chunk `charts` giống hệt nhau
> ở **407,31 kB**.

### Track P — Programming (không lập lại ở plan này)

| Đề xuất | Thuộc plan |
|---|---|
| §6.14-P1a Palette block + node INPUT/OUTPUT cho FBD | [Plan 56](56_PROGRAMMING_IMPLEMENTATION_MASTER_PLAN_2026Q3.md), nguồn `REV-PROG-OVERVIEW-DESIGN-GAP-2026-08-15` §8 |
| §6.14-P1b Đóng UC-PROG-03 | [Plan 53](53_PROGRAMMING_IMPLEMENTATION_PLAN.md), nguồn `REV-PROG-FE-UX-2026-08-13` — **đang chặn `RELEASE_READY`** |
| §6.14-P2a `DraftAttentionPanel` 4/6 trạng thái còn thiếu | Plan 56 |
| §6.14-P2b `<h1>` cho 9 màn Programming | **Gộp vào `T57-0.4`** (cùng loại việc, làm một lần) |

---

## 9. Ma trận tài liệu phải cập nhật

### 9.1 Trước khi code (gate)

| Hồ sơ | Việc | Task chặn |
|---|---|---|
| `KX-DDC24-UX-SYSTEM-001_VI.md` → v1.8 | Token, §6 nav 4 nhóm, §4 breakpoint, §9 handoff | `T57-0.11..0.14` chặn **toàn bộ** Wave 1–3 (design system là nguồn chuẩn) |
| `UX_REQ_PA3_WEB.md` → v1.1 | Sửa `F-DOC-03`; thêm requirement ID cho UC mới | `T57-0.15`; mỗi UC mới ở Wave 1–3 phải có ID trước khi code |
| ADR điều hướng 4 nhóm | Mới, số cấp ở `docs/00_governance/DECISIONS.md` | `T57-0.13` |
| Hồ sơ UI/UX cho màn hình mới **kèm asset SVG/PNG** | Override registry · Ép tay hàng loạt · Alarm KPI · Modbus scan · Modbus frame monitor · Scheduler effective preview | Chặn `T57-1.2`, `T57-1.4`, `T57-3.3`, `T57-3.8`, `T57-3.9`, `T57-3.5` |
| `MODBUS_RTU_UI_UX_DESIGN.md` | Bổ sung scan + frame monitor + CSV | `T57-3.8..3.11` |
| `KX-DDC24-UX-WEB-SCHEDULER-001_VI.md` | Bổ sung effective preview + cảnh báo xung đột | `T57-3.5`, `T57-3.6` |
| `CONFIG_SCHEMA_MK-DDC-24_VI.md` + `contracts/` | Equipment tag; user preferences | `T57-3.1`, `T57-3.2` |
| 9 ADR của Wave 3 | Theo bảng §7 | Từng task tương ứng |

> [!WARNING]
> `DOC_GOVERNANCE.md` §2.2: **wireframe chữ hoặc ASCII không đủ** để qua cổng
> Detailed Design. Sáu màn hình mới ở trên đều chứa quyết định an toàn hoặc
> hành động ghi ra thiết bị ⇒ **bắt buộc** có asset render được, cả desktop và
> mobile cho màn hình responsive. Đây là hạng mục dễ bị bỏ sót nhất khi lên lịch.

### 9.2 Khi mỗi task Done

Theo `DOC_GOVERNANCE.md` §7 — làm đủ 6 bước, không bỏ bước nào:

1. Sửa hồ sơ chủ quản, giữ ID ổn định.
2. Revision History **trong chính hồ sơ**.
3. Đồng bộ `docs/05_verification/UX_PA3_TRACEABILITY.md` và Open Decisions nếu ảnh hưởng requirement/contract/test.
4. `CHANGELOG.md` dưới `[Unreleased]` **trong cùng phiên**.
5. `python3 scripts/docs_iso_harness.py --expect` và ghi số đo thật (cập nhật khối `EXPECT` **trong cùng commit**).
6. Commit — hồ sơ chưa được Git theo dõi thì chưa phải baseline có kiểm soát.

---

## 10. Ma trận truy vết — 67 đề xuất → task

Không đề xuất nào được bỏ im lặng.

| Đề xuất | Task | Wave |
|---|---|---|
| §6.1-P1a Ai đang giữ quyền điều khiển | `T57-1.1`, `T57-1.2` | 1 |
| §6.1-P1b TrendPreview theo producer | `T57-0.3` | 0 |
| §6.1-P2a Ghim đồng bộ theo tài khoản | `T57-3.2` | 3 |
| §6.1-P2b Tuổi dữ liệu tệ nhất | `T57-1.11` | 1 |
| §6.1-P3 Xuất ảnh chụp trạng thái | `T57-2.21` | 2 |
| §6.2-P1a Ép tay hàng loạt | `T57-1.4` | 1 |
| §6.2-P1b Cột TTL | `T57-1.3` | 1 |
| §6.2-P2a Saved view | `T57-2.1`, `T57-2.3` | 2 |
| §6.2-P2b Nhóm theo thiết bị | `T57-3.1` | 3 |
| §6.2-P3 Flash cell | `T57-2.16` | 2 |
| §6.3-P1a Annunciation | `T57-1.5` | 1 |
| §6.3-P1b 5 severity trong nhật ký | `T57-0.2` | 0 |
| §6.3-P2a Bộ lọc URL | `T57-2.2` | 2 |
| §6.3-P2b Chỉ số hệ alarm | `T57-3.3` | 3 |
| §6.3-P2c Ack hàng loạt có lý do | `T57-1.6` | 1 |
| §6.3-P3 Liên kết alarm → điểm → trend | `T57-2.8` | 2 |
| §6.4-P1 Crosshair | `T57-2.4` | 2 |
| §6.4-P2a Trục Y thứ hai | `T57-2.5` | 2 |
| §6.4-P2b Bộ trend đặt tên | `T57-2.3` | 2 |
| §6.4-P2c Marker sự kiện | `T57-2.6` | 2 |
| §6.4-P3 Độ phân giải aggregate | `T57-2.7` | 2 |
| §6.5-P2a Xuất CSV Activity | `T57-2.15` | 2 |
| §6.5-P2b Lọc khoảng thời gian | `T57-2.2` | 2 |
| §6.5-P3 Diff trước/sau | `T57-3.14` | 3 |
| §6.6-P2a Lịch sử CPU/RAM/nhiệt | `T57-3.4` | 3 |
| §6.6-P2b CommTile phân biệt tắt/không đọc được | `T57-1.12` | 1 |
| §6.6-P3 Gói chẩn đoán | `T57-2.21` | 2 |
| §6.7-P1 Hiệu lực thực tế | `T57-3.5` | 3 |
| §6.7-P2a Cảnh báo xung đột | `T57-3.6` | 3 |
| §6.7-P2b Bộ lọc URL | `T57-2.2` | 2 |
| §6.7-P3 Nhật ký tác động 7 ngày | `T57-3.7` | 3 |
| **§6.8 (3 mục)** | **LOẠI — chỉ thị user 2026-08-18** | — |
| §6.9-P1 Xem trước quy đổi | `T57-2.9` | 2 |
| §6.9-P2a Diff nháp | `T57-2.10` | 2 |
| §6.9-P2b Sao chép nhiều kênh | `T57-2.11` | 2 |
| §6.10-P1a Dirty-guard | `T57-0.1` | 0 |
| §6.10-P1b Hậu quả safeState | `T57-1.7` | 1 |
| §6.10-P2 Đường cong minPv/maxPv | `T57-2.12` | 2 |
| §6.11-P1 Dirty-guard | `T57-0.1` | 0 |
| §6.11-P2 Ai đang dùng VP | `T57-3.12` | 3 |
| §6.11-P3 Nhân bản VP | `T57-2.20` | 2 |
| §6.12-P1a Quét thiết bị bus | `T57-3.8` | 3 |
| §6.12-P1b Xem thô khung truyền | `T57-3.9` | 3 |
| §6.12-P2a `<h1>` các tab | `T57-0.4` | 0 |
| §6.12-P2b CSV ánh xạ điểm | `T57-3.10` | 3 |
| §6.12-P3 Device template | `T57-3.11` | 3 |
| §6.13-P1a Dirty-guard | `T57-0.1` | 0 |
| §6.13-P1b Mô phỏng luật cảnh báo | `T57-2.13` | 2 |
| §6.13-P2a Ước lượng tần suất | `T57-3.13` | 3 |
| §6.13-P2b Thống nhất ngôn ngữ | `T57-2.14` | 2 |
| §6.14 (4 mục) | Track P — Plan 53/56; riêng `<h1>` gộp `T57-0.4` | — |
| §6.15-P2 Kiểm kết nối sau apply | `T57-3.18` | 3 |
| §6.15-P3 QR địa chỉ mới | `T57-2.22` | 2 |
| §6.16-P1 Chính sách mật khẩu | `T57-1.9` | 1 |
| §6.16-P2a Buộc đổi mật khẩu mặc định | `T57-3.17` | 3 |
| §6.16-P2b Lần đăng nhập gần nhất | `T57-3.16` | 3 |
| §6.17-P1 Cảnh báo đổi giờ | `T57-1.8` | 1 |
| §6.17-P2 Trạng thái NTP | `T57-3.15` | 3 |
| §6.17-P3 Xem trước theme/ngôn ngữ | `T57-2.19` | 2 |
| §6.18-P2a Lý do đăng nhập hỏng | `T57-1.10` | 1 |
| §6.18-P2b Help theo ngữ cảnh | `T57-2.17` | 2 |
| §6.18-P3 `/me` quyền hiệu lực | `T57-2.18` | 2 |
| §6.19-P1 Kiểm chéo từ vựng HMI ↔ Web | `T57-0.10` | 0 |
| §6.19-P2 TTL trên HMI Control | `T57-3.19` | 3 |
| §6.19-P3 Chỉ báo Web có người đăng nhập | `T57-3.20` | 3 |

**Finding còn mở → task:** `F-UX-12`→`T57-0.1` · `F-UX-13`→`T57-0.2` ·
`F-UX-14`→`T57-0.3` · `F-UX-15`→`T57-0.4` · `F-UX-16`→`T57-4.2` ·
`F-DOC-01`→`T57-0.11` · `F-DOC-02`→`T57-0.12` · `F-DOC-03`→`T57-0.15` ·
`F-DOC-04`→`T57-0.13` · `F-DOC-05`→`T57-0.14`.

---

## 11. Ước lượng và thứ tự đề xuất

| Wave | Nội dung | Người-ngày | Chặn bởi |
|---|---|---:|---|
| 0 | Đóng nợ + gate chống tái diễn | ~15,25 | `PLAN_READY`; Track D cần UX Lead |
| 1 | An toàn vận hành | ~13,25 | Wave 0 Track D (design system) |
| 2 | Hiệu quả chẩn đoán | ~24,5 | Wave 0 Track C; `T57-2.3` cần `T57-3.2` |
| 3 | Contract/backend mới | ~49,5 | 9 ADR + Tech Lead |
| 4 | Quyết định sản phẩm | chưa ước lượng | CTO/PM |
| **Tổng Wave 0–3** | | **~102,5 người-ngày dev** | chưa tính review/QA/e2e |

**Thứ tự đề xuất:** `Wave 0 Track A+B+C` (song song với `Track D` do UX Lead
làm) → `Wave 1` → `Wave 2` → `Wave 3` theo từng ADR được ký. Không nên đảo Wave
0 xuống sau: ba gate ở Track C là thứ giữ cho Wave 1–3 không mở lại đúng những
lỗi vừa sửa.

**Đề xuất cắt phạm vi nếu cần giao nhanh:** giữ `Wave 0` + `Wave 1` (≈28,5
người-ngày) đã đóng toàn bộ nợ kỹ thuật và mọi đề xuất **P1 ảnh hưởng an toàn**;
Wave 2–3 lùi sang đợt sau mà không để lại nợ.

---

## 12. Tám câu hỏi phải trả lời trước khi mở `IMPLEMENT_READY`

> **Cập nhật 2026-08-18: cả 8 câu đã có quyết định.** Q1/Q3 đóng bằng mặc định
> kỹ thuật trong `AUTH-WEBUX-2026-08-18-01`; Q2/Q4/Q5/Q6/Q7/Q8 đóng bằng
> `ADR-034`…`ADR-039`. Riêng **Q8 chỉ đóng phần THIẾT KẾ** — `ADR-039` đặc tả
> điều kiện quét bus nhưng **không** cấp phép ghi ra bus RS-485, nên `T57-3.8`
> giữ nguyên `IMPLEMENT_READY BLOCKED`.

| # | Câu hỏi | Ảnh hưởng | Người quyết | **Trạng thái** |
|---|---|---|---|---|
| Q1 | `F-DOC-03`: thêm `unknown` vào `PointQuality` (đổi cả type lẫn backend), hay chuyển câu luật về đúng mục `health.state`? | `T57-0.15`; nếu chọn cách 1 thì chạm contract | UX Lead + Tech Lead | **ĐÃ ĐÓNG** — `AUTH-WEBUX-…-01` (chỉ sửa tài liệu) |
| Q2 | Annunciation âm thanh: trình duyệt chặn autoplay khi chưa có tương tác người dùng. Chấp nhận "phải bấm một lần để bật âm" hay chỉ làm nhấp nháy? | `T57-1.5` | UX Lead + PM | **ĐÃ ĐÓNG** — `ADR-034` |
| Q3 | `TrendPreview` khi điểm ngừng cập nhật: để **đứt đường** (đúng luật "không nối qua gap") hay giữ giá trị cuối? | `T57-0.3` | UX Lead | **ĐÃ ĐÓNG** — `AUTH-WEBUX-…-01` (đứt đường) |
| Q4 | Mô phỏng luật cảnh báo chạy ở FE (nhanh, nhưng phải chép luật backend — rủi ro lệch) hay gọi endpoint mô phỏng ở BE? | `T57-2.13` | Tech Lead | **ĐÃ ĐÓNG** — `ADR-035` |
| Q5 | Chỉ số hệ alarm ISA-18.2 lưu ở đâu: historian, kho Activity, hay bảng riêng? Giữ bao lâu? | `T57-3.3` | Tech Lead | **ĐÃ ĐÓNG** — `ADR-036` |
| Q6 | Chính sách mật khẩu cụ thể (độ dài, ký tự, khoá tài khoản sau N lần sai) | `T57-1.9`, `T57-3.17` | PM + Tech Lead | **ĐÃ ĐÓNG** — `ADR-037` |
| Q7 | "Hiệu lực thực tế" của lịch tính ở đâu: Go (nhanh nhưng phải chép ngữ nghĩa Core) hay Core (đúng nguồn nhưng phải mở API)? | `T57-3.5`, `T57-3.6` | Tech Lead | **ĐÃ ĐÓNG** — `ADR-038` |
| Q8 | Quét bus Modbus **ghi ra bus thật** và có thể làm nhiễu thiết bị đang chạy. Cho phép quét lúc nào — chỉ khi bus idle, chỉ vai trò admin, có cảnh báo chặn? | `T57-3.8` | PM + Tech Lead (an toàn) | **ĐÃ ĐÓNG** (thiết kế) — `ADR-039`; `T57-3.8` vẫn BLOCKED, ADR **không** cho phép ghi ra bus |

---

## 13. Rủi ro

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Sáu màn hình mới cần asset trực quan theo `DOC_GOVERNANCE` §2.2 — dễ bị bỏ qua khi lên lịch, rồi kẹt ở cổng Detailed Design | Cao | Đưa việc dựng asset thành task riêng có ước lượng, không coi là "phần đầu của task code" |
| Wave 3 có 9 ADR; nếu viết dồn cuối kỳ sẽ chặn toàn bộ | Cao | Viết ADR theo từng task ngay khi task được chọn, không gom |
| Nhiều phiên agent chạy song song trên cùng file FE (đã xảy ra: `git add` cuốn theo edit của phiên khác) | Trung bình | Mỗi Wave một nhánh; soát `git status` trước mọi `add`; không tự merge PR draft khác scope |
| CI GitHub Actions đang bị chặn bởi billing | Trung bình | Dùng test local làm bằng chứng merge, ghi rõ trong PR — như các đợt trước |
| `T57-3.1` (equipment tag) có thể lan tới Core/FW nếu contract điểm được Core đọc | Trung bình | Spike 0,5 ngày đọc `CONFIG_SCHEMA` + Core trước khi ước lượng lại |
| Bundle đã 892 kB; Wave 1–3 chỉ làm nó lớn thêm | Thấp–Trung bình | Đo kích thước bundle ở cuối mỗi Wave; nếu vượt ngưỡng thoả thuận thì kéo `T57-4.2` lên sớm |

---

## 13b. Trạng thái triển khai (cập nhật 2026-08-19)

**Plan CHƯA đóng được, nhưng phạm vi Rev A đã thu gọn.** Wave 0–2 xong, Wave 3
xong 14/21, Wave 4 xong 2/2 và **đã nghiệm thu**.

`AUTH-WEBUX-2026-08-19-02` (2026-08-19) đóng bốn mục thẩm quyền còn treo:
`T57-3.8` **hoãn sang Rev B** (ra khỏi phạm vi Rev A), ba task C++ **đã có chủ
sở hữu và mốc bắt đầu**, board Foxlinx **đã kết nối lại và deploy xong**, và
waive chữ ký **đã có mốc hết hiệu lực**.

Sáu task Rev A còn lại: ba cần sửa mã C++ (`T57-3.9`, `T57-3.19`, `T57-3.20` —
agent nhận, bắt đầu 2026-08-19), hai chưa tới lượt và không bị chặn (`T57-3.11`,
`T57-3.13`), và `T57-3.18` cần sửa `mkddc-netcfg`.

| Wave | Task | Trạng thái | Ghi chú |
|---|---:|---|---|
| 0 — Đóng nợ + gate | 15 | **XONG 14,5/15** | `T57-0.7` thiếu test hành vi `F-UX-03` (xem dưới) |
| 1 — An toàn vận hành | 12 | **XONG 12/12** | Mở bằng `AUTH-WEBUX-2026-08-18-02` sau khi phát hành asset trực quan và đóng Q2/Q6 |
| 2 — Hiệu quả chẩn đoán | 21 | **XONG 21/21** (2026-08-19) | 22 task ban đầu trừ `T57-2.13` đã chuyển sang Wave 3 theo `ADR-035` (ngữ nghĩa luật cảnh báo thuộc Core, cấm cài lại ở FE) |
| 3 — Contract/backend mới | 21 | **XONG 14/21** (2026-08-19) | Mở bằng `AUTH-WEBUX-2026-08-19-01` + `ADR-042`…`ADR-049`. Còn `T57-3.9`/`T57-3.11`/`T57-3.13`/`T57-3.18`/`T57-3.19`/`T57-3.20`; `T57-3.8` **chuyển sang Rev B** theo `AUTH-WEBUX-2026-08-19-02` — ra khỏi mẫu số Rev A |
| 4 — Quyết định sản phẩm | 2 | **XONG 2/2 · đã nghiệm thu** (2026-08-19) | Chủ sở hữu chốt đường tối thiểu: `T57-4.1` qua thẻ thiết bị (`T57-3.1`), ISA-101 Level 2 hoãn sang Rev B; `T57-4.2` **đã deploy và đo trên board thật** theo `ADR-049` điều 3 — xem "Deploy và nghiệm thu" bên dưới |
| **Tổng (mọi bản)** | **71** | **63,5/71 (~89,4%)** | Gồm cả `T57-3.8` đã chuyển sang Rev B |
| **Phạm vi Rev A** | **70** | **63,5/70 (~90,7%)** | 6,5 task còn lại: `T57-3.9`/`T57-3.19`/`T57-3.20` (C++, agent nhận), `T57-3.11`/`T57-3.13` (chưa tới lượt), `T57-3.18` (netcfg), + 0,5 của `T57-0.7` |

**Tám câu hỏi §12: đã đóng cả 8** (Q1/Q3 bằng `AUTH-WEBUX-…-01`; Q2/Q4/Q5/Q6/Q7/Q8
bằng `ADR-034`…`ADR-039`). Không còn quyết định nào chặn việc lập kế hoạch tiếp.

Theo ma trận truy vết §10: **mọi đề xuất thuộc Wave 0–2 đã có mã**, trừ §6.13-P1b
(mô phỏng luật cảnh báo) đã theo `T57-2.13` sang Wave 3. Phần chưa triển khai đúng
bằng tập đề xuất của Wave 3 và Wave 4.

### Wave 2 — đợt cuối (2026-08-19)

Năm task khép lại Wave 2, cùng lớp giá trị "trả lời một câu hỏi chẩn đoán bằng ít
thao tác hơn, và bắt lỗi cấu hình trước khi nó ra tới thiết bị":

| Task | Nội dung | Nơi kiểm |
|---|---|---|
| `T57-2.3` | Khung nhìn đặt tên cho Giám sát và bộ trend đặt tên cho Xu hướng; mở bằng `?view=` rồi nở thành chính bộ lọc trên URL | `shared/savedViews.test.ts` (12) · `MonitorPage.savedViews.test.tsx` (5) |
| `T57-2.6` | Dấu sự kiện (ép tay, cảnh báo bật) trên trục thời gian, lấy từ kho Activity và nhật ký cảnh báo thật | `trendMarkers.test.ts` (12) |
| `T57-2.10` | `BB-8` diff "đang lưu ↔ bản nháp" cho Ngõ vào, đặt trong hộp thoại xác nhận lưu | `inputsDraftDiff.test.ts` (8) |
| `T57-2.14` | Thống nhất ngôn ngữ nhãn trang Cấu hình cảnh báo; thuật ngữ BACnet và mã trạng thái viết hoa giữ nguyên kèm chú giải | `AlarmSettingsPage.language.test.tsx` (5) |
| `T57-2.22` | Mã QR địa chỉ truy cập mới, sinh tại chỗ (`shared/qr.ts`), không gọi dịch vụ ngoài | `qr.test.ts` (16) · `NetworkPage.accessQr.test.tsx` (4) |

**Giới hạn đã biết của `T57-2.3`:** khung nhìn nằm trong `localStorage` theo tài
khoản, **trên trình duyệt đó**. Đi theo người dùng sang máy khác cần `T57-3.2`
(endpoint tuỳ chọn người dùng) — Wave 3, chưa mở cổng. Giao diện nói rõ giới hạn
này ngay cạnh thanh khung nhìn thay vì để người dùng tự phát hiện.

**Đo lại thật (2026-08-19):** `npx vitest --run --environment jsdom src` →
**104 file / 1016 test PASS** (trước đợt này: 97 file / 954 test). `npm run lint`
PASS. `npm run build:foxlinx` PASS — chunk `index` **989,94 kB** (gzip 257,54 kB)
so với **967,67 kB** (gzip 249,60 kB) đo trên cùng cây làm việc tại `63f841d`:
**+22,27 kB** cho cả năm task, trong đó có bộ sinh QR tự viết.

### Wave 3 — đợt 1 (2026-08-19)

Mở bằng `AUTH-WEBUX-2026-08-19-01` (chủ sở hữu chốt: mở Wave 3 **trừ `T57-3.8`**;
Wave 4 đi đường tối thiểu + làm code-splitting ngay), với `ADR-042`…`ADR-049`
làm đầu vào implementation.

| Task | Nội dung đã giao | Nơi kiểm |
|---|---|---|
| `T57-3.1` | Thẻ thiết bị công nghệ trên cấu hình điểm + bộ lọc `?equip=` ở Giám sát | `equipmenttag_test.go` (4) · `MonitorPage.equipment.test.tsx` (4) |
| `T57-3.2` | `GET/PUT /me/preferences`; khung nhìn đặt tên đi theo tài khoản, không theo trình duyệt | `useraccess_test.go` |
| `T57-3.3` | `GET /alarms/metrics` + bảng chỉ số ISA-18.2 trên trang Cảnh báo; kèm xoay vòng + retention 90 ngày cho `alarm_history.jsonl` (điều kiện tiên quyết của `ADR-036`) | `alarmmetrics_test.go` (8) |
| `T57-3.4` | `GET /system/history` + biểu đồ 60 phút CPU/RAM/nhiệt độ trên Chẩn đoán | `wave3_diagnostics_test.go` |
| `T57-3.5`, `T57-3.6` | `GET /schedules/effective` (vỏ gọi `mkddc-schedule-sim --point`) + tab "Hiệu lực thực tế" | `coresim_shell_test.go` |
| `T57-3.7` | Cùng tab, khoảng 7 ngày lùi về quá khứ | như trên |
| `T57-3.10` | **Đã có sẵn từ đợt Modbus RTU trước** — `GET /modbus/export?format=csv` + nhập CSV ở trang Điểm Modbus. Không làm lại | `modbus_config_api_test.go` |
| `T57-3.12` | `GET /virtual-points/{id}/usage` + cảnh báo trong hộp thoại xoá | `wave3_diagnostics_test.go` · `VirtualPointUsageNotice.test.tsx` (6) |
| `T57-3.14` | Tóm tắt diff cấu hình trong nhật ký hoạt động, có che trường nhạy cảm | `wave3_diagnostics_test.go` |
| `T57-3.15` | `lastSyncUtc` lấy từ `chronyc tracking` + cảnh báo lệch > 1000 ms | `wave3_diagnostics_test.go` |
| `T57-3.16` | `GET /users/access` — lần đăng nhập gần nhất, lần sai gần nhất, phiên đang mở | `useraccess_test.go` |
| `T57-3.17` | Cờ `mustChangePassword` cưỡng chế ở backend + màn hình dẫn đường | `useraccess_test.go` · `ForcePasswordChangePage.test.tsx` (6) |
| `T57-2.13` | `POST /alarm-settings/simulate` (vỏ gọi `mkddc-alarm-sim`) + ô thử luật trong form | `coresim_shell_test.go` |
| `T57-4.1` | Đường tối thiểu đã chốt: nhóm điểm theo thiết bị qua `T57-3.1` | như `T57-3.1` |
| `T57-4.2` | Code-splitting theo lô nghiệp vụ; chunk chính 989,94 → **558,49 kB** | số đo build |

**Đo lại thật (2026-08-19, cuối đợt Wave 3):**
`npx vitest --run --environment jsdom src` → **107 file / 1032 test PASS**.
`go build ./...`, `go vet ./...`, `go test ./... -count=1` → **PASS**.
`npm run lint`, `tsc --noEmit` → PASS.
`npm run build:foxlinx` → chunk `index` **558,49 kB** (gzip 149,20 kB), thêm bốn
chunk tách riêng: `ProgrammingRoutes` 200,97 · `modbus-rtu` 89,91 ·
`ScheduleEditorPage` 62,88 · `TrendsPage` 27,58 kB.

### Bốn quyết định người (2026-08-19) — `AUTH-WEBUX-2026-08-19-02`

Bốn mục dưới đây agent **không được tự quyết**: một là cấp phép an toàn cho việc
phát khung lên bus RS-485 đang vận hành, một là chỉ định người thật, một là cấp
quyền truy cập thiết bị, một là chữ ký baseline mà `DOC_GOVERNANCE` §6 quy tắc 4
**cấm agent tự ký**. Agent đã dừng và hỏi; đây là câu trả lời của chủ sở hữu.

| # | Quyết định | Hệ quả cho plan |
|---|---|---|
| 1 | `T57-3.8` **hoãn sang Rev B** | Ra khỏi mẫu số Rev A (71 → 70). `ADR-039` **không** bị `SUPERSEDED`; 11 ràng buộc là đầu vào nguyên vẹn cho Rev B. Mở lại khi PM chỉ định **Fieldbus Lead + QA/HIL Lead** |
| 2 | Ba task C++ **giao cho agent, bắt đầu 2026-08-19** | `T57-3.9` (`apps/iobus`, 4,0 người-ngày), `T57-3.19` + `T57-3.20` (`apps/hmi`, 1,5 mỗi task). Tổng **7,0 người-ngày** |
| 3 | **Uỷ quyền agent truy cập board Foxlinx** | Gỡ chặn deploy và gỡ chặn nghiệm thu `T57-4.2` — đã thi hành ngay, xem dưới |
| 4 | Waive chữ ký **giữ nguyên, có mốc hết hiệu lực** | `ADR-033`…`ADR-049` giữ `WAIVED FOR IMPLEMENTATION` tới **cổng `RELEASE_READY` Rev A**; sau mốc đó phải có chữ ký người thật, không có waive lần hai |

**Ràng buộc kế thừa cho `T57-3.9`.** Việc `T57-3.8` bị hoãn **không** nới lỏng gì
cho `T57-3.9`, và `T57-3.9` **không** được dùng làm đường vòng để có chức năng
quét: vòng nhớ khung là **CHỈ-ĐỌC**, chỉ chụp lại khung mà chu kỳ poll bình
thường đã phát, **không một byte nào được phát thêm** (`ADR-046` điều 1). Vi phạm
là finding `P0`.

**CI GitHub Actions — chưa có quyết định.** Chủ sở hữu không chọn phương án nào
cho mục này. Trạng thái đúng: nguyên nhân là **lỗi thanh toán của tổ chức** từ
2026-08-17 (mọi check fail sau 2–3 giây, **không phải lỗi mã**); owner là chủ sở
hữu sản phẩm vì cần quyền billing GitHub; **chưa đặt mốc**. PR tiếp tục merge
bằng bằng chứng test local — đây là **ngoại lệ chưa có ngày đáo hạn**, không phải
trạng thái bình thường.

### Deploy lên board và nghiệm thu `T57-4.2` (2026-08-19)

**Board đã trở lại mạng.** Hai đính chính với mô tả trước đó: board **không còn
mất kết nối**, và bản đang chạy trên board là mốc **2026-08-18 12:43Z** chứ không
phải 03:15Z. `uptime` cho thấy board khởi động lại khoảng **2026-08-18 10:06Z**.
Web/API chạy dưới tên unit **`mkddc-web-pi`** (`:8081`) — tên `mkddc-web` không
tồn tại trên board này.

| Bước | Kết quả |
|---|---|
| Sao lưu | Bản cũ giữ tại `/opt/mkddc-web/dist.bak-20260819` trước khi ghi đè |
| Build | `npm run build:foxlinx` (**không** phải `npm run build` trần — cờ Programming của Foxlinx là cờ build-time) → `index` **558,49 kB** (gzip 149,20) |
| Deploy | `scp` — board Buildroot **không có `rsync`**. Wave 0–3 đã lên board, xác nhận `index-CDJ4il9J.js` đang được phục vụ |
| Service | `mkddc-core`, `mkddc-iobus`, `mkddc-netcfg`, `mkddc-fakemcu`, `mkddc-web-pi` đều **active** sau deploy |

**Số đo nghiệm thu theo `ADR-049` điều 3** — trình duyệt thật (Chromium/
Playwright), context mới mỗi lượt nên **cache rỗng**, **12 cặp mẫu xen kẽ** bản
mới ↔ bản cũ trên **cùng board, cùng phiên** để loại trôi đường truyền:

| Chỉ số | Bản cũ (`63f841d`) | Bản mới (`T57-4.2`) | Chênh |
|---|---:|---:|---:|
| Byte đường tới hạn | 1591,5 kB | **1255,7 kB** | **−335,8 kB (−21,1%)** |
| Số request lần mở đầu | 7 | 7 | 0 |
| First Contentful Paint (trung vị) | 1216 ms | **1092 ms** | −124 ms |
| FCP — trung vị chênh **theo cặp** | — | — | **−236 ms**, 8/12 cặp nghiêng về bản mới |
| `domContentLoaded` (trung vị) | 1063,5 ms | **959,5 ms** | −104 ms |

**Kết luận: ĐẠT ở đúng mức mà `ADR-049` yêu cầu** — đã có số đo trên board thật,
**không có hồi quy**, hướng cải thiện nhất quán với mức giảm byte.

**Hai giới hạn phải nêu kèm mỗi khi trích số này.** (a) `ADR-049` điều 3 đặt
*loại* số đo nhưng **không đặt ngưỡng đạt**, nên nghiệm thu chỉ khẳng định được
"đã đo trên board thật và không hồi quy" — muốn có ngưỡng thì cần một quyết định
riêng. (b) Phép đo phải đi qua **tunnel SSH ra WAN** (cổng HTTP của board không
mở ra ngoài), nên nhiễu từng lượt cùng cỡ với hiệu ứng: 8/12 cặp cho kiểm định
dấu `p ≈ 0,19`, **chưa đủ mạnh để tuyên bố một con số cải thiện chính xác**. Phần
byte thì tất định và lặp lại y hệt mọi lượt.

**Để có số dứt khoát:** đo lại trên **LAN cùng mạng với board** (bỏ tunnel), trên
đúng máy khách mà người vận hành dùng — CPU máy khách là nơi chênh lệch
968 kB ↔ 558 kB tác động mạnh nhất qua thời gian parse/execute, phần mà phép đo
qua tunnel chưa tách ra được.

### Việc còn lại

| Mục | Trạng thái | Điều kiện mở khoá |
|---|---|---|
| `T57-3.8` quét bus Modbus | **HOÃN SANG REV B** | Ra khỏi phạm vi Rev A theo `AUTH-WEBUX-2026-08-19-02` quyết định 1. Mở lại khi PM chỉ định **Fieldbus Lead + QA/HIL Lead** (điều kiện Track B, phê duyệt PM/CTO 2026-08-04), hoặc khi mở phạm vi Rev B |
| `T57-3.9` xem thô khung truyền Modbus | Chưa làm — **owner: agent, bắt đầu 2026-08-19** | Không còn bị chặn. Sửa `apps/iobus` (C++): vòng nhớ khung **CHỈ-ĐỌC** trong `BusWorker` theo `ADR-046`, rồi mới tới Go + FE. 4,0 người-ngày |
| `T57-3.11` mẫu thiết bị Modbus dựng sẵn | Chưa làm | Cần bộ dữ liệu mẫu theo hãng; không có ràng buộc kỹ thuật nào chặn |
| `T57-3.13` ước lượng tần suất cảnh báo từ lịch sử | Chưa làm | Phải đi qua `mkddc-alarm-sim` (`ADR-048`) trên mẫu historian đã hạ tần; không có ràng buộc nào chặn |
| `T57-3.18` kiểm kết nối sau apply mạng | Chưa làm | Cần sửa `mkddc-netcfg` để ping gateway/DNS trong cửa sổ đếm ngược |
| `T57-3.19`, `T57-3.20` (HMI) | Chưa làm — **owner: agent, bắt đầu 2026-08-19** | Không còn bị chặn. Sửa `apps/hmi` (C++/LVGL); 1,5 người-ngày mỗi task |
| Test hành vi `F-UX-03`, `F-UX-13` | Chưa viết | Như bản trước |
| Chặn Back/Forward trong `useDirtyGuard` | Khoảng hở đã biết | Cần `useBlocker` của data router |
| **Deploy lên board** | **XONG (2026-08-19)** | Board đã trở lại mạng; agent được uỷ quyền truy cập theo `AUTH-WEBUX-2026-08-19-02` quyết định 3. Wave 0–3 đã deploy, `T57-4.2` **đã nghiệm thu** trên board thật — xem mục trên |
| **CI GitHub Actions** | **CHƯA QUYẾT** | Lỗi thanh toán tổ chức từ 2026-08-17, không phải lỗi mã. Owner: chủ sở hữu sản phẩm (cần quyền billing GitHub). **Chưa đặt mốc.** Merge bằng test local là ngoại lệ chưa có ngày đáo hạn |
| **Chữ ký `ADR-033`…`ADR-049`** | **Waive có thời hạn** | Giữ `WAIVED FOR IMPLEMENTATION` tới **cổng `RELEASE_READY` Rev A** (`AUTH-WEBUX-2026-08-19-02` quyết định 4). Cần chữ ký người thật của Tech Lead/UX Lead/PM trước mốc đó; agent **không** được điền |

### Điều kiện để đóng plan

**Phạm vi Rev A còn 6 task cộng 0,5 task dở của Wave 0 (`T57-0.7`)** —
và **không mục nào còn bị chặn**:

| Task | Vì sao chưa xong | Ai làm |
|---|---|---|
| `T57-3.9` | Cần sửa `apps/iobus` (C++) theo `ADR-046` | Agent, từ 2026-08-19 |
| `T57-3.19`, `T57-3.20` | Cần sửa `apps/hmi` (C++/LVGL) | Agent, từ 2026-08-19 |
| `T57-3.11` | Cần bộ dữ liệu mẫu theo hãng; không có ràng buộc kỹ thuật | Chưa tới lượt |
| `T57-3.13` | Phải đi qua `mkddc-alarm-sim` (`ADR-048`); không có ràng buộc | Chưa tới lượt |
| `T57-3.18` | Cần sửa `mkddc-netcfg` | Chưa tới lượt |
| `T57-0.7` (0,5) | Thiếu test hành vi `F-UX-03` | Chưa tới lượt |

`T57-3.8` **không** nằm trong danh sách này — nó đã chuyển sang **Rev B**.

`T57-4.2` **đã nghiệm thu** trên board thật ngày 2026-08-19; mục "chưa nghiệm thu"
ở bản trước của §13b **không còn đúng**.

**Hai việc ngoài mẫu số task nhưng chặn `RELEASE_READY`:** chữ ký người thật cho
`ADR-033`…`ADR-049` (waive hết hiệu lực tại chính cổng đó), và CI GitHub Actions
còn hỏng vì thanh toán — mục CI **chưa có quyết định và chưa có mốc**.

## 14. Revision History

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.4 | 2026-08-19 | Bốn quyết định người đóng bằng `AUTH-WEBUX-2026-08-19-02`: `T57-3.8` **hoãn sang Rev B** (mẫu số Rev A 71 → 70), ba task C++ có owner + mốc bắt đầu, uỷ quyền agent truy cập board, và waive chữ ký `ADR-033`…`ADR-049` có **mốc hết hiệu lực tại cổng `RELEASE_READY` Rev A**. §13b ghi deploy Wave 0–3 lên board thật và **số đo nghiệm thu `T57-4.2`** (12 cặp mẫu, byte đường tới hạn −21,1%, FCP −236 ms trung vị theo cặp, 8/12 cặp) kèm hai giới hạn của phép đo; CI ghi rõ là **chưa có quyết định** |
| 1.3 | 2026-08-19 | Wave 3 mở bằng `AUTH-WEBUX-2026-08-19-01` (chủ sở hữu chốt: mở trừ `T57-3.8`) với `ADR-042`…`ADR-049`; giao 14/21 task Wave 3 và 2/2 task Wave 4 (`T57-4.1` đường tối thiểu, `T57-4.2` code-splitting: chunk chính 989,94 → 558,49 kB). §13b ghi số đo thật 107 file / 1032 test FE, `go test ./...` PASS, và sáu task còn lại kèm điều kiện mở khoá từng mục |
| 1.2 | 2026-08-19 | Wave 2 hoàn tất 21/21 task (`T57-2.3`, `T57-2.6`, `T57-2.10`, `T57-2.14`, `T57-2.22` khép lại đợt cuối); §13b ghi lại số đo thật 104 file / 1016 test, bundle Foxlinx 989,94 kB (+22,27 kB so với `63f841d`), và giới hạn đã biết của khung nhìn đặt tên (localStorage, chờ `T57-3.2`) |
| 1.1 | 2026-08-18 | Thêm §13b — trạng thái triển khai thật: Wave 0 xong 14,5/15, Wave 1–4 chưa bắt đầu, tổng 15/71 task; ghi rõ điều kiện đóng plan và bốn việc còn lại của chính Wave 0 (gồm deploy bị chặn do board mất kết nối) |
| 1.0 | 2026-08-18 | Tạo plan: 67 đề xuất UC/UI/UX (trừ §6.8 theo chỉ thị) + 10 finding còn mở, chia 5 Wave và 8 khối hạ tầng dùng chung; ma trận truy vết 1-1; 8 câu hỏi chặn `IMPLEMENT_READY` |
