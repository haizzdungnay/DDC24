# Review UI/UX/UC toàn bộ Web HMI — hiện trạng source code và tài liệu thiết kế

| Thuộc tính | Giá trị |
|---|---|
| ID | `REV-FE-UIUX-UC-2026-08-18` |
| Ngày | 2026-08-18 |
| Phạm vi | Toàn bộ `apps/web-ui` (23 route, 36.310 dòng TS/TSX), bộ tài liệu `docs/04_uiux`, `docs/02_requirements/UX_REQ_PA3_WEB.md`, `docs/01_product`, và HMI local `apps/hmi` (5.769 dòng C++/LVGL) ở mức đối chiếu |
| Góc nhìn | Chuyên gia giao diện + UC/UI/UX cho phần mềm PLC/DDC |
| Phương pháp | Đọc trực tiếp source trên nhánh `main` tại `8286e89`; đối chiếu với tài liệu thiết kế đã duyệt; chạy lại bộ test FE thật (không dẫn số cũ) |
| Quyền bằng chứng | Source-code review + unit/component test. **Không phải** HIL, không phải usability test với người dùng thật, không phải Test Result độc lập |
| Phán quyết | **PASS có điều kiện.** Lõi vận hành (Landing/Monitor/Alarms/Trends/Network/Commissioning/Scheduler) đạt mức công nghiệp; 11 lỗi UI/UX tìm được đã sửa trong phiên; 3 nhóm khoảng hở còn mở nằm ở tài liệu và ở lớp giám sát quy trình (process graphic), không chặn vận hành |

---

## 1. Tóm tắt điều hành

Đây là một trong số ít giao diện DDC mà **nguyên tắc "không bịa dữ liệu" được thi hành ở cấp mã nguồn**, không chỉ nằm trong tài liệu. Rất nhiều lớp lỗi kinh điển của HMI công nghiệp đã bị đóng bằng code thật và có test khoá lại:

- Không đọc được ≠ bình thường (`MonitorPage`, `DashboardPage`, `OverviewPage` Modbus).
- Thiếu số đo hiện `—`, không hiện `0` (`NO_DATA` dùng xuyên suốt).
- Thời hạn lệnh ép tay do **Core** cưỡng chế, không phải `setTimeout` trong tab trình duyệt.
- "Trả về tự động" là release thật, không phải ghi 0.
- Tương phản màu WCAG được **tính bằng test trên chính token của ứng dụng**, không phải bằng mắt.

Điểm yếu tập trung ở ba chỗ, và cả ba đều có chung một cơ chế sinh lỗi: **hợp đồng nội bộ giữa hai module không có test hai chiều**.

1. **Deep link một chiều.** `drilldown.ts` phát ra `/alarms?alarm=`, `/monitor?group=`, `MonitorPage` phát ra `/trends?points=` — cả ba trang đích chưa từng đọc tham số đó. Liên kết mở đúng trang nhưng không lọc gì. Trớ trêu là chính chú thích trong `drilldown.ts` đã cảnh báo đúng kiểu lỗi này ("hỏng im lặng mà chỉ người dùng thật phát hiện ra") cho một tham số khác.
2. **Vùng bấm nguy hiểm không có affordance.** Ô biểu đồ "Trend" trên mỗi hàng AO/Virtual của Monitor là một `<span onClick>` mở thẳng hộp thoại ép tay ra cơ cấu chấp hành. Không nhãn, không viền, không con trỏ, không tên cho trình đọc màn hình.
3. **Từ vựng trạng thái bị trộn.** `quality = uncertain` được in ra màn hình là `"Lỗi - HIGH"` — trộn thang chất lượng điểm với thang severity ISA-18.2, tức là bịa ra một mức ưu tiên xử lý mà không producer nào phát ra.

Về tài liệu: `KX-DDC24-UX-SYSTEM-001` tự nhận là "nguồn-chuẩn hình ảnh" nhưng **bảng token của nó đã lệch hoàn toàn khỏi `theme/tokens.ts`** (khác cả tên biến lẫn giá trị màu), và mục "Handoff cho FE" hứa hai tệp `tokens.json`/`theme.css` không tồn tại trong repo. Một FE dev mới làm theo tài liệu sẽ dựng lại đúng bộ màu **trượt chuẩn AA** mà plan 45 đã bỏ công sửa.

---

## 2. Phạm vi, phương pháp và số đo

### 2.1 Đã đọc

| Lớp | Nội dung |
|---|---|
| Điều hướng/khung | `app/App.tsx`, `shared/components/AppShell.tsx`, `NavRail.tsx`, `pa3/Breadcrumb.tsx`, `pa3/CommandPalette.tsx` |
| Vận hành | `DashboardPage`, `MonitorPage`, `AlarmsPage`, `TrendsPage`, `ActivityPage`, `DiagnosticsPage` |
| Kỹ thuật | `InputsPage`, `OutputsPage`, `VirtualIoPage`, `UserParametersPage`, `CommissioningPage`, `AlarmSettingsPage`, `modbus-rtu/*`, `scheduler/*`, `programming/*` |
| Hệ thống | `NetworkPage`, `SettingsPage`, `TimeSettingsPage`, `DisplaySettingsPage`, `UsersPage`, `LoginPage` |
| Nền tảng | `theme/tokens.ts`, `theme/contrast.ts`, `pa3/StateAtoms.tsx`, `overview/drilldown.ts`, `auth/roles.ts`, `i18n.tsx` |
| Tài liệu | `UX_REQ_PA3_WEB.md`, `KX-DDC24-UX-SYSTEM-001_VI.md`, `KX-DDC24-UX-HMI-001_VI.md`, `KX-DDC24-UC-WEB-*`, `MODBUS_RTU_UI_UX_DESIGN.md`, `PROGRAMMING_UI_UX_DESIGN.md`, `UI_UNIVERSAL_INPUT_REDESIGN_2026-08-14.md` |

### 2.2 Số đo thật đo lại trong phiên

| Phép đo | Lệnh | Kết quả |
|---|---|---|
| Test FE (trước khi sửa) | `npx vitest --run --environment jsdom src` | **692 pass / 75 file** |
| Typecheck | `npx tsc --noEmit` | sạch |
| Lint | `npx eslint src --max-warnings=0` | sạch |
| Test FE (sau khi sửa) | `npx vitest --run --environment jsdom src` | xem §8.3 |

Bộ e2e Playwright (`pa3-a11y`, `pa3-dashboard`, `network-qa`, `trends`, `scheduler`, `programming`, `fe-pages-health`, `point-names`, `st-editor-alignment`) **chưa chạy trong phiên này** — cần board/target, ghi ở §9.

---

## 3. Điểm mạnh

### 3.1 Kỷ luật "không bịa dữ liệu" được thi hành bằng code

Đây là giá trị lớn nhất của sản phẩm và nó có ở khắp nơi, không phải một vài chỗ:

- `DashboardPage:169` — `lastDataAt = null` ⇒ hiện `—`, tuyệt đối không thay bằng giờ hiện tại.
- `MonitorPage:434` — `/points` trả 200 kèm mảng rỗng là trạng thái **khác** "API chết", và trang tự nói ra điều đó thay vì bày bốn bảng trống.
- `modbus-rtu/pages/OverviewPage.tsx:11-17` — bỏ hằng số p50/p95 viết cứng, thiếu số liệu thì `—`.
- `DiagnosticsPage:30-35` — bỏ `?? 23` cho CPU và `?? 48` cho RAM; thiết bị mất liên lạc không còn vẽ đồng hồ xanh.
- `CommissioningPage:18-40` — khối chú thích liệt kê chính xác bốn lỗi an toàn của bản cũ và cách đóng từng lỗi.

Trên một DDC, "không đọc được" bị trình bày thành "mọi thứ bình thường" là lỗi an toàn vận hành. Repo này coi nó là lỗi hạng nặng và xử lý đúng như vậy.

### 3.2 Ranh giới quyền sở hữu trạng thái rõ ràng

`MonitorPage:264-275` ghi lại một quyết định kiến trúc đúng và hiếm: **thời hạn của lệnh ghi xuống output vật lý không được nằm trong tab trình duyệt.** `durationSeconds` đi thẳng xuống Core qua `ttlS`/`expire_s`; `scan_loop` giữ hạn và tự `release_ao/do`; frontend chỉ vẽ đồng hồ đếm ngược mà Core báo về. Đóng tab, ngủ máy, mất mạng — output vẫn được nhả đúng hạn.

Cùng nguyên tắc ở `NetworkPage`: `validate → stage → apply → confirm/rollback` với đếm ngược thật và nhãn tiếng Việt cho người vận hành ("Giữ thay đổi", "Hoàn tác ngay") thay vì tên lệnh giao thức.

### 3.3 Tiếp cận (accessibility) làm ở mức kỹ thuật, không phải mức khẩu hiệu

- `theme/contrast.ts` cài công thức WCAG 2.2 và `contrast.test.ts` chạy nó trên **chính token mà ứng dụng dùng**, cho cả hai theme, tách hai ngưỡng 4.5:1 (chữ) và 3:1 (đồ hoạ).
- `tokens.ts:20-31` giải thích vì sao `--c-*-bg` phải là **màu đặc** chứ không phải `rgba()` phủ — vì phủ tối lên nền xám kéo tụt tương phản của chính dòng chữ trên đó, làm 13/14 biến thể badge trượt chuẩn.
- `AppShell.tsx:35-44` — skip link là điểm dừng Tab đầu tiên; thanh bên có hơn 20 liên kết nên đây không phải trang trí.
- `NavRail.tsx:232-341` — ngăn kéo di động có bẫy tiêu điểm, Escape đóng, và **trả tiêu điểm về đúng nút đã mở**.
- `StateAtoms.tsx` — 5 mức quality (5 hình icon khác nhau) và 5 mức severity (**3** hình icon, phân biệt bằng nhãn chữ + màu), luôn kèm nhãn chữ, không bao giờ chỉ có màu. *(Đính chính 1.2: bản 1.0 viết "mỗi mức một icon hình dạng khác nhau" cho cả hai thang — đúng với quality, nói quá với severity.)*

### 3.4 Từ vựng chuẩn có tài liệu và được trace

`UX_REQ_PA3_WEB.md` §1 chốt nghĩa duy nhất cho `quality`, `health.state`, `severity`, vòng đời alarm, vai trò và override — kèm cột "KHÔNG phải là" cho từng giá trị. §2 chuyển thành ~40 requirement có ID và cột kiểm chứng trỏ tới test thật. Đây là mức trưởng thành tài liệu cao hơn phần lớn dự án DDC thương mại.

### 3.5 Gate quyền suy từ backend, không tự nghĩ ra

`auth/roles.ts` chép nguyên bảng route↔quyền của `apps/web-api/internal/app/http.go` vào chú thích, và `NavRail.isVisibleForRole` **dùng chung đúng bảng đó** với `RequireRole` — nên siết quyền một route không thể làm lệch menu. Chú thích còn ghi rõ hai hồi quy đã xảy ra theo hai hướng ngược nhau (FE rộng hơn BE → 403 thô; FE chặt hơn BE → lấy mất chức năng hợp lệ của operator).

### 3.6 Xử lý trạng thái rỗng/lỗi giữ được ngữ cảnh trang

`MonitorPage:403-426` và `AlarmsPage:103-111` cố ý **giữ `<h1>` trong cả nhánh loading lẫn nhánh lỗi**, vì trả về một `StateBlock` trần làm người dùng trình đọc màn hình nghe thấy thông báo lỗi mà không biết mình đang ở trang nào (WCAG 2.4.6).

---

## 4. Điểm yếu

### 4.1 Không có lớp "process graphic" — thiếu tầng hiển thị Level 2 của ISA-101

Đây là khoảng hở lớn nhất về mặt sản phẩm, không phải một bug.

Toàn bộ giao diện tổ chức theo **thiết bị và kênh** (UI-01…UI-16, AO-01…AO-04, DO, VP, Modbus). `ControllerDiagram` vẽ chính cái bo điều khiển với các cổng của nó. Không có màn hình nào vẽ **quy trình được điều khiển** — AHU, FCU, chiller, bơm, van, damper, luồng khí/nước.

Với người vận hành toà nhà, câu hỏi đầu ca không phải "UI-07 bằng bao nhiêu" mà "AHU tầng 3 có đang chạy đúng setpoint không". Hiện tại họ phải tự dịch từ số kênh sang thiết bị trong đầu. ISA-101 gọi tầng này là Level 2 (process overview) và coi nó là tầng chính của người vận hành; sản phẩm hiện có Level 1 (Landing), Level 3 (chi tiết điểm) và Level 4 (chẩn đoán/trend) nhưng **khuyết Level 2**.

Đây là quyết định phạm vi hợp lý cho Rev A (không có trình soạn đồ hoạ), nhưng phải được ghi ra là một quyết định, và cần một đường đi tối thiểu ở §6.

### 4.2 Hợp đồng deep link không có test hai chiều

`drilldown.ts` là một thiết kế tốt (từ chối nhận URL tuỳ ý từ backend, chỉ nhận cặp `(targetType, targetId)` đã đóng). Nhưng nó chỉ được test ở **chiều sinh URL** (`drilldown.test.ts`). Không có gì kiểm rằng trang đích **tiêu thụ** đúng tham số đó. Hệ quả là 3/6 loại drill-down hỏng im lặng (§7, F-UX-02/03/04).

### 4.3 Bảo vệ dữ liệu chưa lưu chỉ có ở một trang

`InputsPage:72-134` có `dirty` + `beforeunload` + modal cảnh báo. Bốn trang cấu hình còn lại — `OutputsPage`, `AlarmSettingsPage`, `VirtualIoPage`, `UserParametersPage` — đều giữ bản nháp trong state cục bộ mà **không có bất kỳ lớp bảo vệ nào**: đóng tab, bấm Back, hay bấm một mục menu là mất sạch. Nguyên nhân: guard được thêm ad-hoc cho một finding riêng của `InputsPage` thay vì được nâng thành hook dùng chung.

### 4.4 Bộ lọc chỉ nằm trong URL ở đúng một trang

`MonitorPage` đưa `kind/quality/state/q/point` vào URL (REQ-PA3-02-3) — đúng và cần thiết. Nhưng `AlarmsPage`, `TrendsPage`, `SchedulerGridPage`, `CommissioningPage` vẫn dùng `useState`: F5 mất ngữ cảnh, không gửi được cho đồng nghiệp một đường dẫn tới "các cảnh báo High chưa ack của tầng 3". Với công việc vận hành nhiều người cùng ca, đây là mất khả năng phối hợp.

### 4.5 Bốn khối "xu hướng" độc lập, ba trong số đó không phải historian

| Nơi | Nguồn | Bền qua reload? |
|---|---|---|
| `TrendsPage` | historian thật (`historyClient.query`) | có |
| `MonitorPage` → `PointHistoryPanel` | historian thật, 60 phút | có |
| `MonitorPage` → `Sparkline` mỗi hàng | buffer RAM 18 mẫu | không |
| `DashboardPage` → `TrendPreview` | buffer RAM 60 mẫu, lấy mẫu theo **đồng hồ trình duyệt** mỗi 1 s | không |

`TrendPreview` ghi một mẫu mỗi giây bất kể producer có cập nhật hay không, nên một điểm thực tế cập nhật 5 s/lần vẫn cho ra đường 1 Hz mượt — **mật độ dữ liệu giả**. Nó không sai giá trị, nhưng nó nói dối về độ phân giải, và đó cũng là một dạng bịa dữ liệu mà chính dự án này cấm ở chỗ khác.

### 4.6 i18n không đồng đều

- 78 chuỗi tiếng Việt bị viết **không dấu** ("Dang tai alarm", "Trang thai cau hinh", "Chua co VP nao") trên ba trang, trong đó có `AlarmsPage` — màn hình quan trọng nhất khi có sự cố. (Đã sửa, §8.)
- `StateAtoms` in nhãn tiếng Anh viết hoa (`GOOD`/`BAD`/`STALE`/`OFFLINE`/`DEGRADED`) ở cả chế độ tiếng Việt. Tài liệu §3.3 cho phép, nhưng với kỹ thuật viên hiện trường không đọc tiếng Anh thì đây là rào cản thật.
- `AlarmSettingsPage` trộn ba ngôn ngữ trong một màn hình: "Mức ưu tiên", "Severity rules", "Notification Class", "Deferred type chưa được bật enabled."

### 4.7 Bốn nhóm điều hướng trong code, ba nhóm trong tài liệu

`KX-DDC24-UX-SYSTEM-001` §6 và `ADR-009` chốt **ba nhóm** Overview/Settings/Engineering. `NavRail.tsx:20-64` dựng **bốn nhóm** Tổng quan/Vận hành/Kỹ thuật/Hệ thống, dẫn nguồn "UX-DES §3" — một tài liệu khác. Cả hai đều có lý, nhưng hiện không có ADR nào ghi việc đổi từ 3 sang 4, nên tài liệu canonical đang sai so với sản phẩm.

### 4.8 Programming (Rev A) vẫn ở trạng thái chặn phát hành

Không phát hiện mới ở phiên này; dẫn lại hai báo cáo đang hiệu lực để bức tranh đầy đủ:

- `REV-PROG-FE-UX-2026-08-13` — `RELEASE_READY BLOCKED`, UC-PROG-03 không đạt từ bước 2.
- `REV-PROG-OVERVIEW-DESIGN-GAP-2026-08-15` — FBD editor chỉ tạo được **một** loại block (AND) qua giao diện, không có palette, không có cách tạo node INPUT/OUTPUT; nên một Program FBD dựng hoàn toàn bằng UI **không thể có biến để map sang Point**.

---

## 5. Đánh giá hợp quy chuẩn và hợp tiêu chuẩn

Lưu ý về mức tuyên bố: đây là **đánh giá kỹ thuật đối chiếu tiêu chuẩn**, không phải chứng nhận. Chính tài liệu `KX-DDC24-UX-SYSTEM-001` cũng ghi "ISA-101-based design guidance … không phải tuyên bố certification" — cách diễn đạt này đúng và nên giữ.

### 5.1 ISA-101 (Human Machine Interfaces for Process Automation Systems)

| Yêu cầu | Trạng thái | Bằng chứng / khoảng hở |
|---|---|---|
| Nền trung tính, màu bão hoà dành cho bất thường | **Đạt** | `tokens.ts` LIGHT `--c-bg #C8CCD0`; mục đang chọn dùng viền trái + nền nhẹ, không glow |
| Trạng thái không truyền bằng màu đơn thuần | **Đạt** | `StateAtoms` — mỗi trạng thái một icon hình dạng riêng + nhãn chữ |
| Phân cấp điều hướng theo nhóm nhiệm vụ | **Đạt** (lệch tài liệu) | 4 nhóm trong code vs 3 nhóm trong ADR-009 — F-DOC-04 |
| Display hierarchy Level 1 (overview) | **Đạt** | Landing PA3 với thứ tự ưu tiên khai báo rõ ở `DashboardPage:49-63` |
| Display hierarchy **Level 2 (process graphic)** | **Chưa có** | §4.1 — không có màn hình theo thiết bị công nghệ (AHU/FCU/chiller) |
| Level 3 (detail) / Level 4 (diagnostic) | **Đạt** | Point detail + `DiagnosticsPage` + `TrendsPage` |
| Hành động nguy hiểm có xác nhận | **Đạt sau khi sửa** | Trước đây ô "Trend" mở hộp thoại ép tay mà không có affordance — F-UX-06 |

### 5.2 ISA-18.2 (Management of Alarm Systems)

| Yêu cầu | Trạng thái | Ghi chú |
|---|---|---|
| Đúng 5 mức ưu tiên, không gộp | **Đạt ở dữ liệu** | `AttentionSeverity` = critical/high/medium/low/info |
| Trình bày phân biệt được 5 mức | **Đạt** (sau `T57-0.2`) | `AlarmsPage.HistoryRow` nay dùng `SeverityBadge` 5 mức. **Đính chính bản 1.0:** năm mức dùng **ba** hình icon (`AlertOctagon` · `AlertTriangle`×2 · `Info`×2), không phải năm — phân biệt được nhờ nhãn chữ và màu, không nhờ hình. WCAG 1.4.1 vẫn đạt, nhưng câu "mỗi mức một icon riêng" ở §3.3 bản 1.0 là nói quá |
| Vòng đời: active/unack/acked/shelved/cleared | **Đạt** | `alarmFilters`, `AlarmDurationDialog`, `returnAlarm` |
| Acknowledge có ghi người và thời điểm | **Đạt** | `HistoryRow` hiện `ackedBy`/`user` và `acknowledgedAt` |
| Shelving có thời hạn | **Đạt** | `AlarmDurationDialog` nhận `AlarmDurationChoice` |
| Nhật ký alarm truy vấn được, lọc đa tiêu chí | **Đạt** | 6 bộ lọc + 7 loại sự kiện + severity + status |
| **Annunciation** (báo động nghe được / nhấp nháy cho unack) | **Chưa có** | Không có âm thanh, không có nhấp nháy; badge đếm là dấu hiệu duy nhất |
| **Chỉ số hiệu năng hệ alarm** (alarm rate, flood, chattering, stale alarm) | **Chưa có** | ISA-18.2 §16 yêu cầu đo; hiện chưa có màn hình nào |
| Alarm philosophy được tham chiếu từ UI | **Chưa có** | Không có đường dẫn từ `AlarmSettingsPage` tới tài liệu triết lý alarm |

### 5.3 IEC 60073 (mã hoá bằng chỉ báo và cơ cấu thao tác)

| Quy ước | Trạng thái |
|---|---|
| Đỏ = nguy hiểm/sự cố | **Đạt** — `--c-fault` chỉ dùng cho fault/bad |
| Vàng = cảnh báo/bất thường | **Đạt** — `--c-warn` cho degraded/stale/uncertain |
| Xanh lá = an toàn/bình thường đã xác nhận | **Đạt** (sau `T57-0.2`) — `low` chuyển sang lam (`--c-info`), `info` sang trung tính; `--c-good` không còn dùng cho bất kỳ mức severity nào |
| Xanh dương = bắt buộc/thông tin | **Đạt** — `--c-accent` cho focus/link/primary |
| Trung tính = không hoạt động/không rõ | **Đạt** — `--c-off`, `unknown` dùng `CircleHelp` + nền trung tính |

### 5.4 WCAG 2.2 AA

| Tiêu chí | Trạng thái | Ghi chú |
|---|---|---|
| 1.4.3 Contrast (Minimum) | **Đạt, có test** | `contrast.test.ts` chạy trên token thật, 2 theme |
| 1.4.11 Non-text Contrast | **Đạt, có test** | Ngưỡng 3:1 tách riêng |
| 1.4.1 Use of Color | **Đạt** | Icon + nhãn kèm mọi trạng thái |
| 2.4.1 Bypass Blocks | **Đạt** | Skip link là điểm dừng Tab đầu tiên |
| 2.4.6 Headings and Labels | **Đạt** (sau `T57-0.4`) | **Đính chính bản 1.0:** con số "19 trang/tab" đếm theo FILE nên phần lớn là dương tính giả — `ModbusRtuLayout`, `ProgrammingHeader` và `ScheduleEditorPage` đã giữ đúng một `<h1>` cho route của chúng. Khiếm khuyết thật chỉ là hai nhánh trả về sớm của `SchedulerGridPage`, nay đã bọc `SchedulerHeading`. Đã đối chiếu lại toàn bộ 28 route: mỗi route đúng một `<h1>`. **Chưa có gate tự động** giữ tính chất này — ghi ở §9 |
| **2.1.1 Keyboard** | **Trượt (đã sửa)** | Hai `role="switch"` dựng bằng `<span>`, một cái thiếu `onKeyDown`, một cái thiếu cả `tabIndex` — F-UX-05, F-UX-10 |
| **4.1.2 Name, Role, Value** | **Trượt (đã sửa)** | `<span role="switch">` lồng trong `<button>`: phần tử tương tác lồng phần tử tương tác, HTML không hợp lệ — F-UX-05 |
| 2.4.3 Focus Order / 2.1.2 No Keyboard Trap | **Đạt** | Bẫy tiêu điểm đúng chuẩn trong `Modal` và `NavDrawer`, có trả tiêu điểm |
| 3.3.1 Error Identification | **Đạt** | `aria-invalid` + `aria-describedby` + `role="alert"` ở form điểm |

### 5.5 ISO 9241-110 (nguyên tắc đối thoại)

| Nguyên tắc | Nhận xét |
|---|---|
| Phù hợp nhiệm vụ | Tốt — Landing xếp khối theo thứ tự ưu tiên của ca trực, không theo thứ tự dữ liệu |
| Tự mô tả | Tốt — `StateBlock` nói ra *vì sao* rỗng, không chỉ *là* rỗng |
| Phù hợp kỳ vọng | **Yếu ở hai chỗ** — ô "Trend" mở hộp thoại ép tay (F-UX-06); nút gạt trend gạt xong không ghi gì (F-UX-10) |
| Khoan dung lỗi | **Yếu** — 4/5 trang cấu hình không cảnh báo dữ liệu chưa lưu (§4.3) |
| Điều khiển được | Tốt — Network có rollback + đếm ngược; commissioning có release thật |

### 5.6 Quản trị tài liệu (DOC_GOVERNANCE)

| Mục | Trạng thái |
|---|---|
| Requirement có ID + cột kiểm chứng | **Đạt** — `UX_REQ_PA3_WEB` §2 |
| Design system là nguồn chuẩn duy nhất | **Trượt** — bảng token của `UX-SYSTEM-001` lệch hoàn toàn khỏi `tokens.ts` (F-DOC-01) |
| Artefact handoff tồn tại | **Trượt** — `tokens.json`/`theme.css` được hứa ở §9 nhưng không có trong repo (F-DOC-02) |
| ADR cho thay đổi kiến trúc UI | **Thiếu một** — đổi 3→4 nhóm điều hướng không có ADR (F-DOC-04) |
| Tài liệu tự nhất quán | **Trượt một chỗ** — `UX_REQ` §1.1 nhắc `unknown` như một quality nhưng bảng cùng mục và type `PointQuality` đều không có nó (F-DOC-03) |

---

## 6. Đề xuất bổ sung UC/UI/UX theo từng PAGE

Nguyên tắc xếp ưu tiên: **P1** = ảnh hưởng an toàn hoặc khả năng vận hành; **P2** = hiệu quả công việc; **P3** = hoàn thiện.

### 6.1 `/` — Landing (Tổng quan hệ thống)

| # | Đề xuất | Vì sao |
|---|---|---|
| P1 | **UC mới: "Ai đang giữ quyền điều khiển"** — một khối liệt kê mọi điểm đang bị ép tay kèm người ra lệnh, thời điểm và đếm ngược | Hiện `points.forced` chỉ là một con số trong TỔNG HỢP ĐIỂM. Khi bàn giao ca, câu hỏi bắt buộc là "còn lệnh tay nào chưa nhả không, của ai" — hiện phải vào Monitor lọc `state=forced` rồi bấm từng điểm |
| P1 | **Cho `TrendPreview` lấy mẫu theo `updatedAt` của producer**, không theo đồng hồ trình duyệt | §4.5 — bản hiện tại tạo mật độ dữ liệu giả, mâu thuẫn chính nguyên tắc "không bịa" của trang |
| P2 | **Ghim (pin) đồng bộ theo tài khoản trên thiết bị**, không chỉ localStorage | Kỹ thuật viên đổi máy là mất sạch ghim; ghim là cấu hình cá nhân hợp lệ, đáng được lưu ở backend |
| P2 | **Thêm "tuổi dữ liệu tệ nhất trong các phân hệ"** vào dải trạng thái | Overall `good` vẫn có thể che một phân hệ có `observedAt` 40 phút trước; hiện phải tự đọc 5 ô |
| P3 | Nút "Xuất ảnh chụp trạng thái" (JSON + thời điểm) | Để đính vào phiếu sự cố mà không phải chụp màn hình |

### 6.2 `/monitor` — Giám sát điểm

| # | Đề xuất | Vì sao |
|---|---|---|
| P1 | **UC mới: ép tay hàng loạt có xác nhận chung** (chọn nhiều điểm → một hộp thoại liệt kê toàn bộ hậu quả → một lệnh) | Chạy thử một AHU cần ép 3–5 điểm liên tiếp. Hiện phải mở 5 hộp thoại, mỗi cái nhập lại thời hạn — vừa chậm vừa dễ để sót một điểm chưa nhả |
| P1 | **Cột "Còn lại" hiển thị đếm ngược TTL ngay trên bảng** | Hiện `overrideExpiresInS` chỉ hiện trong khung chi tiết của điểm đang chọn; không quét được toàn bảng xem cái nào sắp hết hạn |
| P2 | **Lưu bộ lọc thành "khung nhìn" đặt tên được** (`?view=ahu-t3`) | Bộ lọc đã nằm trong URL rồi — chỉ còn thiếu lớp đặt tên. Ca trực lặp lại đúng vài bộ lọc mỗi ngày |
| P2 | **Nhóm theo thiết bị công nghệ, không chỉ theo loại kênh** | Bù một phần khoảng hở Level 2 ở §4.1 mà không cần trình soạn đồ hoạ: chỉ cần một trường "thuộc thiết bị" trong cấu hình điểm |
| P3 | Chỉ báo "giá trị vừa đổi" (flash cell) | `DataTable` đã có spec `realtime cell flash` trong `UX-SYSTEM-001` §5 nhưng chưa dùng ở bảng Monitor |

### 6.3 `/alarms` + `/alarms/history` — Cảnh báo

| # | Đề xuất | Vì sao |
|---|---|---|
| P1 | **UC mới: annunciation cho cảnh báo chưa ack** — nhấp nháy badge + tuỳ chọn âm thanh bật/tắt theo người dùng | ISA-18.2 coi annunciation là chức năng cốt lõi. Hiện một cảnh báo Critical mới xuất hiện trên màn hình treo tường không tạo bất kỳ tín hiệu thu hút chú ý nào |
| P1 | **Phân biệt đủ 5 severity bằng hình ảnh trong nhật ký** | F-UX-13 — `low`/`info` đang dùng xanh lá "ok", vi phạm IEC 60073 |
| P2 | **Đưa bộ lọc vào URL** như Monitor | Không chia sẻ được "các cảnh báo High chưa ack trong 24 h" cho đồng nghiệp |
| P2 | **UC mới: bảng chỉ số hệ alarm** — số cảnh báo/giờ, top 10 cảnh báo lặp nhiều nhất, cảnh báo đang shelved sắp hết hạn | ISA-18.2 §16. Không có số đo thì không biết hệ alarm đang bị nhiễu ở đâu, và alarm flood sẽ được "xử lý" bằng cách ack hàng loạt |
| P2 | **Ack hàng loạt có lý do bắt buộc** | Hiện ack từng cái; khi flood, người trực sẽ tìm cách bấm nhanh nhất — nên thiết kế sẵn đường đi an toàn cho việc đó |
| P3 | Liên kết từ mỗi cảnh báo tới điểm nguồn và tới trend của nó trong cùng cửa sổ thời gian | Chẩn đoán "vì sao cảnh báo này bật" hiện là ba lần điều hướng thủ công |

### 6.4 `/trends` — Xu hướng

| # | Đề xuất | Vì sao |
|---|---|---|
| P1 | **Con trỏ đọc giá trị (crosshair) hiện giá trị mọi series tại một mốc thời gian** | So sánh setpoint với giá trị thực tại đúng thời điểm sự cố là thao tác chẩn đoán cơ bản nhất; hiện phải ước lượng bằng mắt |
| P2 | **Trục Y thứ hai cho series khác đơn vị** | Vẽ nhiệt độ (°C) chung trục với độ mở van (%) làm cả hai đường dẹt lại; hiện tối đa 8 series chung một trục |
| P2 | **Lưu "bộ trend" đặt tên được** và mở lại bằng URL | Cùng lý do với §6.2; hiện chỉ có một bộ duy nhất trong localStorage |
| P2 | **Đánh dấu sự kiện lên biểu đồ** (thời điểm ép tay, thời điểm cảnh báo bật) | Trả lời "cái này đổi vì tự động hay vì người ép tay" mà không phải mở song song Activity |
| P3 | Ghi rõ độ phân giải aggregate đang dùng (raw/1m/5m) ngay cạnh tiêu đề | `HistoryStateBanner` đã có `complete=false`, nhưng độ phân giải mới là thứ quyết định cách đọc đỉnh/đáy |

### 6.5 `/activity` — Nhật ký hoạt động

| # | Đề xuất | Vì sao |
|---|---|---|
| P2 | **Xuất CSV theo bộ lọc hiện tại** | Biên bản nghiệm thu và điều tra sự cố đều cần bản xuất; hiện chỉ xem trên màn hình |
| P2 | **Lọc theo khoảng thời gian** | Hiện chỉ có `kind`/`objectId`/`action` + phân trang theo cursor |
| P3 | Hiện diff trước/sau cho hành động sửa cấu hình | "point_metadata" hiện chỉ nói là có sửa, không nói sửa gì |

### 6.6 `/diagnostics` — Chẩn đoán

| # | Đề xuất | Vì sao |
|---|---|---|
| P2 | **Lịch sử ngắn cho CPU/RAM/nhiệt độ** (60 phút) | Số tức thời không phân biệt được "đang tăng dần" với "vừa nhảy vọt một lần"; đây là thông tin quyết định khi máy chậm |
| P2 | **Phân biệt "tắt có chủ đích" với "không đọc được"** ở `CommTile` | BACnet/IP feature-gated OFF hiện ra `N/A` giống hệt một cổng không đọc được |
| P3 | Nút "sao chép gói chẩn đoán" (health + overview + network dưới dạng JSON) | Hỗ trợ từ xa hiện phải hướng dẫn người dùng chụp 5 màn hình |

### 6.7 `/eng/scheduler` — Lịch vận hành

| # | Đề xuất | Vì sao |
|---|---|---|
| P1 | **Xem trước hợp nhất: "hiệu lực thực tế" khi nhiều lịch cùng tác động một điểm** | Grid 64 lịch mà không có màn hình nào trả lời "lúc 14:00 thứ Ba, DO-02 sẽ ở trạng thái nào và do lịch nào quyết định" là chỗ dễ sinh sự cố nhất của cả tính năng |
| P2 | **Cảnh báo xung đột ngay khi soạn**, không đợi tới publish | Người soạn cần biết mình vừa ghi đè lịch khác tại thời điểm nào |
| P2 | **Bộ lọc vào URL + đường dẫn tới lịch cụ thể** | Cùng lý do phối hợp nhiều người |
| P3 | Nhật ký "lịch này đã tác động những gì trong 7 ngày qua" | Hiện có `HistoryTabs` nhưng theo thao tác người dùng, không theo tác động ra thiết bị |

### 6.8 `/eng/commissioning` — Chạy thử

| # | Đề xuất | Vì sao |
|---|---|---|
| P1 | **UC mới: kịch bản nghiệm thu nhiều bước có checklist và xuất biên bản** | Trang hiện làm rất tốt việc chạy thử **một** điểm (điều kiện tiên quyết, giữ kết quả trên màn hình, release thật). Nhưng nghiệm thu thực tế là một chuỗi có thứ tự trên nhiều điểm, kết thúc bằng một biên bản có chữ ký — hiện phải chép tay từ màn hình |
| P2 | **Ghi thời gian phản hồi của cơ cấu** (từ lúc ra lệnh tới lúc phản hồi đạt ngưỡng) | `scanMs` hiện là thời gian quét, không phải thời gian đáp ứng cơ cấu — mà cái sau mới là thứ nghiệm thu cần |
| P3 | Chế độ "chạy thử tuần tự có hẹn giờ" cho van/damper | Kiểm hành trình 0→100→0 hiện phải bấm ba lần đúng nhịp |

### 6.9 `/eng/inputs` — Cấu hình Universal Input

Trang này vừa được thiết kế lại (`UI_UNIVERSAL_INPUT_REDESIGN_2026-08-14`) và là trang duy nhất có dirty-guard đầy đủ.

| # | Đề xuất | Vì sao |
|---|---|---|
| P1 | **Xem trước quy đổi trực tiếp**: nhập giá trị thô → hiện ngay giá trị kỹ thuật theo cấu hình đang soạn | Sai `scale_lo`/`scale_hi` chỉ lộ ra khi cảm biến đã đấu; xem trước bắt lỗi ngay lúc cấu hình |
| P2 | **So sánh cạnh nhau giữa cấu hình đang lưu và bản nháp** trước khi Save | `NetworkPage` đã có mẫu `NetworkCandidateDiff` — nên dùng lại đúng mẫu đó |
| P2 | **Sao chép cấu hình sang nhiều kênh** | 16 kênh cùng loại cảm biến phải cấu hình 16 lần |

### 6.10 `/eng/outputs` — Cấu hình Outputs

| # | Đề xuất | Vì sao |
|---|---|---|
| P1 | **Thêm dirty-guard** (`beforeunload` + chặn điều hướng) | F-UX-12 — trang giữ toàn bộ bản nháp trong state; rời trang là mất, không một lời cảnh báo |
| P1 | **Nói rõ hậu quả của `safeState`/`safeValue` bằng ngôn ngữ vận hành** | "Safe state = OFF" trên một van sưởi mùa đông và trên một quạt hút khói là hai quyết định an toàn hoàn toàn khác nhau; giao diện hiện chỉ hỏi giá trị |
| P2 | Xem trước đường cong `minPv`/`maxPv` → tín hiệu ra | Cùng lý do §6.9 |

### 6.11 `/eng/virtual-points` — Điểm ảo

| # | Đề xuất | Vì sao |
|---|---|---|
| P1 | **Thêm dirty-guard** | F-UX-12 |
| P2 | **Hiện "ai đang dùng điểm ảo này"** (lịch nào, cảnh báo nào, chương trình nào tham chiếu) trước khi cho xoá | Xoá một VP đang được một lịch tham chiếu hiện không có cảnh báo nào |
| P3 | Nhân bản một VP | Tạo hàng loạt biến cùng kiểu hiện phải nhập lại từ đầu |

### 6.12 `/eng/modbus-rtu` — Modbus RTU (6 tab)

| # | Đề xuất | Vì sao |
|---|---|---|
| P1 | **UC mới: quét/dò thiết bị trên bus** (scan địa chỉ, thử baud/parity) | Đấu nối hiện trường luôn bắt đầu bằng "thiết bị này ở địa chỉ nào, baud bao nhiêu". Hiện phải đoán và nhập tay |
| P1 | **Xem thô khung truyền** (gửi/nhận, CRC lỗi, timeout) trong tab Chẩn đoán | Không có cửa sổ này thì mọi sự cố truyền thông đều phải xử lý bằng `journalctl` trên bo |
| P2 | **Thêm `<h1>` cho các tab** (`OverviewPage`, `PortsPage`, `MappingPage` hiện không có) | WCAG 2.4.6 và định hướng cho trình đọc màn hình |
| P2 | **Nhập/xuất bảng ánh xạ điểm (CSV)** | Một thiết bị 60 thanh ghi nhập tay là nguồn sai sót lớn nhất của cả tính năng |
| P3 | Mẫu thiết bị dựng sẵn (device template) theo hãng | Cùng lý do |

### 6.13 `/eng/alarm-settings` — Cấu hình cảnh báo

| # | Đề xuất | Vì sao |
|---|---|---|
| P1 | **Thêm dirty-guard** | F-UX-12 |
| P1 | **Mô phỏng luật cảnh báo trước khi lưu** (nhập giá trị thử → nói ra cảnh báo có bật không, sau bao lâu, mức nào) | Cấu hình sai ngưỡng/hysteresis chỉ lộ ra khi sự cố thật xảy ra hoặc khi cảnh báo giả tràn về |
| P2 | **Ước lượng tần suất từ lịch sử điểm** ("với ngưỡng này, 7 ngày qua sẽ bật 34 lần") | Cách rẻ nhất để chặn alarm flood ngay từ lúc cấu hình |
| P2 | Thống nhất ngôn ngữ nhãn (hiện trộn Việt–Anh trong cùng form) | §4.6 |

### 6.14 `/eng/programming` — Lập trình (PGM-01…04)

Dẫn theo hai báo cáo đang hiệu lực, không mở finding mới.

| # | Đề xuất | Vì sao |
|---|---|---|
| P1 | **Palette block + node INPUT/OUTPUT cho FBD** | `REV-PROG-OVERVIEW-DESIGN-GAP-2026-08-15` §8: hiện chỉ tạo được block AND, và một Program FBD dựng bằng UI không thể có biến để map sang Point — tức là luồng UC-PROG hoàn chỉnh bằng FBD chưa tồn tại |
| P1 | **Đóng UC-PROG-03** (vòng Check FAILED → sửa → lưu bị 409) | `REV-PROG-FE-UX-2026-08-13` — đang chặn `RELEASE_READY` |
| P2 | **Bổ sung 4/6 trạng thái còn thiếu của `DraftAttentionPanel`** | Người dùng không có đường đi từ "Check lỗi" sang "Xem lỗi" |
| P2 | Thêm `<h1>` cho 9 màn/tab Programming hiện không có | WCAG 2.4.6 |

### 6.15 `/settings/network` — Mạng

Trang mạnh nhất về mặt an toàn thao tác. Đề xuất còn lại là hoàn thiện.

| # | Đề xuất | Vì sao |
|---|---|---|
| P2 | **Kiểm tra kết nối sau khi apply** (ping gateway/DNS) hiển thị ngay trong cửa sổ đếm ngược | Hiện người dùng phải tự phán đoán trong 60 s xem có nên Confirm hay không |
| P3 | Sinh mã QR chứa địa chỉ truy cập mới | Đổi IP xong, người đứng tại tủ phải gõ tay địa chỉ mới vào điện thoại |

### 6.16 `/settings/users` — Người dùng

| # | Đề xuất | Vì sao |
|---|---|---|
| P1 | **Chính sách mật khẩu hiển thị và cưỡng chế trên giao diện** | Đây là thiết bị điều khiển toà nhà nối mạng; hiện không có chỉ báo độ mạnh mật khẩu |
| P2 | **Buộc đổi mật khẩu mặc định ở lần đăng nhập đầu** | Ghi nhận có sẵn trong ký ức dự án: tài khoản admin trên board dùng hash cố định |
| P2 | Hiện lần đăng nhập gần nhất và phiên đang hoạt động của mỗi tài khoản | Điều tra "ai vừa làm việc này" hiện chỉ dựa vào Activity |

### 6.17 `/settings/time`, `/settings/device`, `/settings/display`

| # | Đề xuất | Vì sao |
|---|---|---|
| P1 | **Cảnh báo hậu quả khi đổi giờ hệ thống** (ảnh hưởng historian và lịch vận hành) | Lùi đồng hồ trên một thiết bị đang ghi historian tạo dữ liệu chồng lấn không thể phân giải |
| P2 | **Trạng thái đồng bộ NTP: lệch bao nhiêu, nguồn nào, lần đồng bộ cuối** | Hiện chỉ có timezone và đặt tay |
| P3 | Xem trước theme/ngôn ngữ trước khi áp | Trang Display đổi tức thì toàn ứng dụng |

### 6.18 `/login`, `/me`, `/help`

| # | Đề xuất | Vì sao |
|---|---|---|
| P2 | **Nói rõ vì sao đăng nhập hỏng**: sai mật khẩu vs không tới được backend | Hai nguyên nhân này cần hai hành động hoàn toàn khác nhau từ người dùng |
| P2 | **Trang Trợ giúp gắn theo ngữ cảnh** (mở đúng mục của trang đang xem) | Trợ giúp không theo ngữ cảnh gần như không được dùng trên thiết bị nhúng |
| P3 | `/me` hiện quyền hiệu lực của vai trò dưới dạng danh sách việc làm được | "operator" không tự nó nói lên điều gì với người dùng mới |

### 6.19 HMI local 320×240 (`apps/hmi`)

| # | Đề xuất | Vì sao |
|---|---|---|
| P1 | **Kiểm chéo từ vựng trạng thái giữa HMI và Web** | `UX-SYSTEM-001` §1.5 yêu cầu "cùng một ý nghĩa → cùng chữ/icon/hình". Không có test nào hiện khoá điều đó giữa hai codebase (C++ và TS) — đây đúng là kiểu lệch sinh ra sau vài lần sửa một bên |
| P2 | **Hiện đếm ngược TTL của lệnh ép tay trên màn Control** | Cùng lý do với §6.2: người đứng tại tủ cần biết lệnh còn hiệu lực bao lâu |
| P3 | Chỉ báo "Web đang có người đăng nhập" | Tránh hai người thao tác ngược nhau trên cùng một điểm |

---

## 7. Bảng finding và nguyên nhân gốc

Mức: **A** = ảnh hưởng an toàn/khả năng vận hành · **B** = ảnh hưởng hiệu quả hoặc tuân thủ tiêu chuẩn · **C** = hoàn thiện.

### 7.1 Lỗi trong source code

| Mã | Mức | Trang / tệp | Triệu chứng | Nguyên nhân gốc | Trạng thái |
|---|---|---|---|---|---|
| `F-UX-01` | B | `AlarmsPage`, `AlarmSettingsPage`, `VirtualIoPage` | 78 chuỗi giao diện tiếng Việt viết **không dấu** ("Dang tai alarm", "Trang thai cau hinh") | Viết ở giai đoạn sớm theo thói quen ASCII-safe và **không có gate nào kiểm chuỗi UI**. `check:programming-*` chỉ kiểm hợp đồng của Programming; lint không có luật về nội dung chuỗi | **ĐÃ SỬA** |
| `F-UX-02` | A | `AlarmsPage` | `/alarms?alarm=<id>` từ Landing "CẦN XỬ LÝ" và từ Activity mở danh sách **không lọc gì** | `drilldown.ts` chỉ có test **chiều sinh URL**; không có test nào kiểm trang đích tiêu thụ tham số. Hợp đồng một chiều | **ĐÃ SỬA** |
| `F-UX-03` | B | `TrendsPage` | `/trends?points=<id>` từ Monitor bị bỏ qua; người dùng rơi vào bộ chọn cũ trong localStorage | Như `F-UX-02` | **ĐÃ SỬA** |
| `F-UX-04` | B | `MonitorPage` | `/monitor?group=local` từ ô Health Strip "I/O tại chỗ" không lọc gì | Như `F-UX-02`; ngoài ra `group` **chưa từng có** bộ chọn trên giao diện nên không tự gỡ được | **ĐÃ SỬA** |
| `F-UX-05` | A | `MonitorPage.DigitalRow` | Nút gạt ĐÓNG/MỞ contactor là `<span role="switch" tabIndex={0}>` **lồng trong `<button>`**, không có `onKeyDown` → bàn phím focus được nhưng Space/Enter không làm gì | Dựng control bằng `<span>` để lấy hình dạng; `role` được gắn vào sau mà không kèm hợp đồng bàn phím. Test axe trong e2e không phủ trang này | **ĐÃ SỬA** (WCAG 2.1.1 + 4.1.2) |
| `F-UX-06` | A | `MonitorPage.AnalogRow` | Ô biểu đồ cột "Trend" là vùng bấm **ẩn** mở thẳng hộp thoại ép tay ra cơ cấu chấp hành — không nhãn, không viền, không tên cho trình đọc màn hình | Nhét `onForce` vào ô sparkline để tiết kiệm chỗ thay vì thêm một cột hành động có nhãn | **ĐÃ SỬA** |
| `F-UX-07` | B | `MonitorPage.Sparkline` | Điểm chưa có số đo vẫn được vẽ một **đường nằm ngang ở mức 0** | `sparklineFallback` cố ý trả mảng rỗng (đúng theo REV-FE-04) nhưng `Sparkline` lại tự bù `[0, 0]`. Guard đặt ở tầng gọi, chỗ vẽ không biết về nó | **ĐÃ SỬA** |
| `F-UX-08` | A | `MonitorPage.AnalogRow` | `quality = uncertain` in ra màn hình là **`"Lỗi - HIGH"`** | Trộn hai thang từ vựng độc lập: chất lượng điểm (`UX_REQ` §1.1) và severity ISA-18.2 (§1.3). Kết quả là bịa ra một mức ưu tiên xử lý không producer nào phát ra | **ĐÃ SỬA** |
| `F-UX-09` | B | `MonitorPage.defaultForceValue` | Điểm chưa có số đo ⇒ ô "Giá trị mới" của hộp thoại ép tay điền sẵn chuỗi **`"null"`** | `String(pointNumber(point))` không xử lý nhánh `null` | **ĐÃ SỬA** |
| `F-UX-10` | B | `MonitorPage.DetailPanel` | Nút gạt "Hiển thị trend": (a) `<span role="switch">` **không có `tabIndex`** → bàn phím không tới được; (b) gạt ở chế độ xem **không ghi gì xuống**, phải bấm thêm bút chì rồi Lưu mà không có dấu hiệu nào nói vậy; (c) mặc định lúc lưu là `true` trong khi mặc định lúc hiển thị là `point.trend != null`; (d) "Hủy" không hoàn nguyên nút gạt | Ba trạng thái (giá trị thật, giá trị đang soạn, chế độ soạn) được quản bằng ba `useState` rời không có bất biến chung | **ĐÃ SỬA** |
| `F-UX-11` | B | `MonitorPage` | Thẻ đếm "Điểm ON" đếm **mọi** điểm có `value` truthy → cảm biến 23.5 °C được tính là "ON", cùng cảm biến đó ở 0 °C thì không | `Boolean(point.value)` áp lên toàn bộ inventory thay vì chỉ điểm nhị phân | **ĐÃ SỬA** |
| `F-UX-12` | B | `OutputsPage`, `AlarmSettingsPage`, `VirtualIoPage`, `UserParametersPage` | Bản nháp cấu hình nằm trong state cục bộ; đóng tab / Back / bấm menu là **mất sạch không cảnh báo** | Dirty-guard được thêm ad-hoc cho riêng `InputsPage` khi xử lý một finding của trang đó, không được nâng thành hook dùng chung | **ĐÃ ĐÓNG** 2026-08-18 — `T57-0.1`, hook `useDirtyGuard` + `DirtyGuardModal` áp cho cả 4 trang |
| `F-UX-13` | B | `AlarmsPage.HistoryRow` | 5 severity bị gộp thành 3 trạng thái hình ảnh; `low` và `info` dùng state `ok` (**xanh lá**) | Ánh xạ severity→visual viết riêng tại chỗ thay vì dùng `SeverityBadge` của `StateAtoms` vốn đã có đủ 5 mức | **ĐÃ ĐÓNG** 2026-08-18 — `T57-0.2`, `HistoryRow` dùng `SeverityBadge` 5 mức |
| `F-UX-14` | B | `DashboardPage.TrendPreview` | Lấy mẫu mỗi 1 s theo **đồng hồ trình duyệt** bất kể producer có cập nhật hay không ⇒ mật độ dữ liệu giả | Buffer client-side dựng bằng `setInterval` thay vì phản ứng theo `updatedAt` của điểm | **ĐÃ ĐÓNG** 2026-08-18 — `T57-0.3`, lấy mẫu theo `updatedAt` của producer |
| `F-UX-15` | C | 19 trang/tab (`modbus-rtu/*`, `programming/*`, `scheduler/tabs/*`) | Không có `<h1>`; các nhánh trả về sớm của `SchedulerGridPage` cũng mất `<h1>` | Trang được tách ra khỏi layout cha vốn giữ tiêu đề, tiêu đề không đi theo | **ĐÃ ĐÓNG** 2026-08-18 — `T57-0.4`; phần lớn finding gốc là dương tính giả (đếm theo file), khiếm khuyết thật là hai nhánh lỗi của `SchedulerGridPage` |
| `F-UX-16` | C | Toàn bộ bundle | Chunk chính **710 kB** (181 kB gzip) + `charts` 407 kB (106 kB gzip), tải một lần khi mở trang đầu. Vite cảnh báo vượt ngưỡng 500 kB | Không có code-splitting theo route: bốn workspace Programming, `recharts` và toàn bộ trang cấu hình đều nằm trong chunk khởi động, dù người trực ca chỉ mở Landing/Monitor/Alarms. Trên bo nhúng tự phục vụ web qua mạng công trường, đây là độ trễ mở trang đầu không cần thiết. **Phép đo dùng `npm run build` trần (cờ Programming TẮT).** Bản cho board (`npm run build:foxlinx`) lớn hơn — xem `F-DOC-10` | **CÒN MỞ** |

### 7.2 Lỗi tài liệu

| Mã | Mức | Tài liệu | Triệu chứng | Nguyên nhân gốc | Trạng thái |
|---|---|---|---|---|---|
| `F-DOC-01` | A | `KX-DDC24-UX-SYSTEM-001_VI.md` §2 | Bảng token **lệch hoàn toàn** khỏi `theme/tokens.ts`: khác tên biến (`--good` vs `--c-good`) và khác giá trị (`#2FA45A` vs `#227742`, `#E8B500` vs `#826500`, `#9AA0A6` vs `#636970`). Tài liệu tự nhận là "nguồn-chuẩn hình ảnh" | Token được siết lại để **đạt WCAG AA** trong plan 45 (WEB-UX-008) nhưng không cập nhật ngược vào tài liệu UX. Hệ quả: FE dev mới làm theo tài liệu sẽ dựng lại đúng bộ màu trượt chuẩn đã bỏ công sửa | **ĐÃ ĐÓNG** 2026-08-18 — `T57-0.11`, `UX-SYSTEM-001` v1.8 §2/§2.2/§2.3 |
| `F-DOC-02` | B | `KX-DDC24-UX-SYSTEM-001_VI.md` §9 | Hứa "Token export `tokens.json` / `theme.css` (FE import)" — **không tệp nào tồn tại** trong repo | Mục handoff viết theo quy trình design-tool truyền thống; thực tế dự án chọn để token trong TS để test được (và đã ghi lý do rất rõ trong `tokens.ts`). Tài liệu không theo kịp quyết định đó | **ĐÃ ĐÓNG** 2026-08-18 — `T57-0.12`, `UX-SYSTEM-001` v1.8 §9 |
| `F-DOC-03` | C | `UX_REQ_PA3_WEB.md` §1.1 | Tự mâu thuẫn: bảng định nghĩa 5 giá trị `quality` (không có `unknown`) nhưng câu luật ngay dưới yêu cầu "bốn trạng thái `bad`/`stale`/`offline`/`unknown` phải có bốn cách trình bày khác nhau". `PointQuality` trong code cũng không có `unknown`; `QualityBadge` fallback về `uncertain` | Trộn hai thang: `health.state` **có** `unknown`, `quality` **không có**. Câu luật được viết cho thang này rồi đặt nhầm vào mục của thang kia | **ĐÃ ĐÓNG** 2026-08-18 — `T57-0.15`, `UX_REQ_PA3_WEB` v1.1 §1.1/§1.2 (Q1: chỉ sửa tài liệu) |
| `F-DOC-04` | B | `KX-DDC24-UX-SYSTEM-001_VI.md` §6 + `ADR-009` | Tài liệu canonical chốt **3 nhóm** điều hướng (Overview/Settings/Engineering); code dựng **4 nhóm** (Tổng quan/Vận hành/Kỹ thuật/Hệ thống) và dẫn nguồn một tài liệu khác ("UX-DES §3") | Thay đổi kiến trúc điều hướng được thực hiện trong code kèm lý do tốt (`NavRail.tsx:12-19`) nhưng **không có ADR** ghi việc rời khỏi quyết định của ADR-009 | **ĐÃ ĐÓNG** 2026-08-18 — `T57-0.13`, `ADR-032` + `UX-SYSTEM-001` v1.8 §6 |
| `F-DOC-05` | C | `KX-DDC24-UX-SYSTEM-001_VI.md` §4 | Breakpoint tài liệu: "≥1280 desktop (chính), ≥768 tablet (commissioning)". Code dùng `lg` = 1024 làm ngưỡng chuyển thanh bên ↔ ngăn kéo, và `UX_REQ_PA3_WEB` §3.2 yêu cầu hỗ trợ 390×844 | Hai tài liệu viết ở hai thời điểm với hai giả định thiết bị khác nhau, không có tài liệu nào là trọng tài | **ĐÃ ĐÓNG** 2026-08-18 — `T57-0.14`, `UX-SYSTEM-001` v1.8 §4.1 |

### 7.2b Phát hiện bổ sung khi triển khai Wave 0 (2026-08-18)

Sáu mâu thuẫn dưới đây **không** có trong lượt review gốc; chúng lộ ra khi đối
chiếu từng dòng tài liệu với mã nguồn để đóng `F-DOC-01..05`. Ghi lại ở đây để
không mất dấu; **chưa mục nào được sửa** vì tất cả nằm ngoài phạm vi 5 task của
Wave 0 Track D.

| Mã | Mức | Nơi | Triệu chứng | Nguyên nhân gốc | Trạng thái |
|---|---|---|---|---|---|
| `F-UX-17` | B | `NavRail.tsx`, `App.tsx` | Hai route **không có lối vào điều hướng**: `/eng/aux` (`AuxFunctionsPage`) và `/eng/user-parameters` (`UserParametersPage`) tồn tại thật, có trong `ROUTE_MIN_ROLE`, có nhãn i18n — nhưng không mục nào trong `NavRail`. Chỉ tới được bằng cách gõ URL | Trang được thêm qua ADR EasySet parity (`ADR-040`, ghi trong bản review gốc là `ADR-013` — số đó đã đổi ngày 2026-08-19) vào nhóm Engineering của bản 3 nhóm; khi tái cấu trúc sang 4 nhóm, hai mục này rơi ra ngoài mà không ai phát hiện vì không có test nào đối chiếu bảng route với bảng menu | **ĐÃ ĐÓNG** 2026-08-18 — quyết `SỬA NGAY` (agent quyết định, `AUTH-WEBUX-2026-08-18-01` mở rộng), nhưng **không** bằng cách thêm vào menu. Đọc mã cho thấy `UserParametersPage` chạy trên mock demo không có endpoint backend, còn `AuxFunctionsPage` sinh cụm graph 28-node legacy — đưa vào menu là nhân rộng việc bịa dữ liệu. `ADR-033` cách ly hai route và `app/route-menu-contract.test.ts` (8 test) thi hành hợp đồng route↔menu hai chiều |
| `F-DOC-06` | C | `KX-DDC24-UX-SYSTEM-001_VI.md` §3 | Định nghĩa `--fs-h1`/`--fs-h2`/`--fs-body`/`--fs-mono`; grep toàn `apps/web-ui/src` ra **0** kết quả. Cỡ chữ thực tế dùng utility class Tailwind | Cùng họ với `F-DOC-02` nhưng ở mục typography: tài liệu mô tả một cơ chế handoff mà mã nguồn không dùng | **ĐÃ ĐÓNG** 2026-08-18 — `UX-SYSTEM-001` **v1.9** §3: bỏ 4 token ma, thay bằng bảng utility class Tailwind + `.mono` kèm số đếm đo được |
| `F-DOC-07` | C | `KX-DDC24-UX-SYSTEM-001_VI.md` §5 | `StatusBadge` được liệt kê 6 state (`good/off/warn/fault/force/online`); `BADGE_VARIANTS` trong `tokens.ts` có **14** và `contrast.test.ts` assert đúng 14 | Component được mở rộng theo nhu cầu thật của các trang, tài liệu không cập nhật ngược | **ĐÃ ĐÓNG** 2026-08-18 — `UX-SYSTEM-001` **v1.9** §5 + §5.2 mới: 14 biến thể màu khớp `BADGE_VARIANTS`, tách rõ với 27 khoá bí danh của `labelMap` |
| `F-DOC-08` | C | `apps/web-ui/src/shared/styles.css:3` | Comment trỏ `src/theme/tokens.ts`; đường dẫn thật là `src/shared/theme/tokens.ts` | Chưa cập nhật sau `PLAN-ARCH-RESTRUCT-002` | **ĐÃ ĐÓNG** 2026-08-18 — `styles.css:3` trỏ đúng `src/shared/theme/tokens.ts` |
| `F-DOC-09` | B | `docs/03_implementation/09_MKDDC_WEB_IMPLEMENTATION_GUIDE.md` §1 | Cây trang vẫn là **3 nhóm** và thiếu hẳn `/activity`, `/diagnostics`, `/eng/outputs`, `/eng/virtual-points`, `/eng/modbus-rtu`, các workspace Programming; dòng 103/116 dẫn "ADR-009 Decision #2 + UX-SYSTEM §6" làm nguồn-chuẩn | Có thể là ghi chép lịch sử của đợt P2/2026-06-16, nhưng §1 đọc như trạng thái hiện hành — và nay còn dẫn một quyết định đã `SUPERSEDED` bởi `ADR-032` | **ĐÃ ĐÓNG** 2026-08-18 — guide **Rev 1.37**: cây trang §1 dựng lại theo `apps/web-ui/src` 4 nhóm, bổ sung 6 trang thiếu + mục CÁCH LY theo `ADR-033`; §1.4 được đánh dấu là ghi chép lịch sử |
| `F-DOC-10` | C | Chính hồ sơ này §7.1 và Plan 57 §8 | Số bundle lệch: `F-UX-16` ghi "chunk chính 710 kB + charts 407 kB", Plan 57 ghi "892 kB (227 kB gzip)" | **Không phải mâu thuẫn**: 710 kB là `npm run build` trần, 892 kB là `npm run build:foxlinx` (bake thêm bốn workspace Programming). Hai phép đo khác nhau nhưng không hồ sơ nào nói ra điều đó | **ĐÃ ĐÓNG một phần** 2026-08-18 — **đã đo lại thật** (§8.5) và giả thuyết đúng: cùng cây làm việc, `vite build` trần cho chunk chính **715,18 kB**, có `VITE_PROGRAMMING_REV_A=1` cho **898,84 kB**; chênh **183,66 kB** đúng bằng bốn workspace Programming, chunk `charts` **giống hệt** ở hai bản. Chú thích đã thêm vào `F-UX-16` §7.1. **Còn lại:** một câu tương ứng ở Plan 57 §8 — hồ sơ đó do phiên chính sở hữu |

> `F-UX-17` đáng chú ý nhất trong nhóm này: nó đúng là loại lỗi mà `ADR-032`
> vừa cảnh báo, và nó cho thấy `T57-0.8` (test hợp đồng deep link hai chiều)
> nên được mở rộng thành **test đối chiếu bảng route ↔ bảng menu** — cùng một
> cơ chế "hợp đồng nội bộ không có test hai chiều" ở §7.3 mục 1.
>
> **Cập nhật 2026-08-18 (CTO).** Test đó đã tồn tại:
> `apps/web-ui/src/app/route-menu-contract.test.ts`. Nhưng câu trả lời cho
> `F-UX-17` **không** phải "thêm hai mục vào menu": đọc mã cho thấy cả hai trang
> chạy trên mock demo hoặc trên runtime legacy, nên đưa chúng vào điều hướng là
> nhân rộng đúng việc bịa dữ liệu mà sản phẩm này cấm ở mọi chỗ khác. Quyết định
> đầy đủ, các phương án bị loại và **rủi ro còn lại** (gõ tay URL vẫn tới được)
> nằm ở `ADR-033` trong [DECISIONS.md](../../00_governance/DECISIONS.md).

### 7.3 Ba cơ chế sinh lỗi đứng sau các finding trên

Đọc theo cột "nguyên nhân gốc", 15 finding quy về đúng ba cơ chế — và đó mới là thứ đáng sửa ở mức quy trình:

1. **Hợp đồng nội bộ chỉ có test một chiều** (`F-UX-02/03/04`). Nơi sinh dữ liệu có test, nơi tiêu thụ thì không. Cách đóng: một test đối chiếu bảng tham số mà `drilldown.ts` phát ra với tập tham số mà mỗi trang đích thực sự đọc.
2. **Quyết định kỹ thuật đúng nhưng không cập nhật ngược vào tài liệu authority** (`F-DOC-01/02/04`). Cả ba đều là trường hợp code **tốt hơn** tài liệu, và vẫn nguy hiểm y như trường hợp ngược lại, vì tài liệu là thứ người mới đọc.
3. **Bản vá đặt ở một tầng, tầng bên cạnh vô hiệu hoá nó** (`F-UX-07`, `F-UX-10c`, và một phần `F-UX-11`). Guard đặt ở hàm gọi trong khi hàm được gọi tự bù giá trị mặc định riêng.

---

## 8. Đã sửa trong phiên

### 8.1 Sửa code

| Mã | Tệp | Nội dung sửa |
|---|---|---|
| `F-UX-01` | `AlarmsPage.tsx`, `AlarmSettingsPage.tsx`, `VirtualIoPage.tsx` | Khôi phục dấu cho **78 chuỗi** giao diện |
| `F-UX-02` | `AlarmsPage.tsx` | Đọc `?alarm=<id>`, lọc danh sách về đúng cảnh báo đó, kèm dải trạng thái và nút "Xem tất cả cảnh báo". Cảnh báo đã hết ⇒ nói rõ, không hiện bảng rỗng im lặng |
| `F-UX-03` | `TrendsPage.tsx` | Đọc `?points=<id>[,...]`, ưu tiên hơn prefs localStorage, và **gỡ tham số khỏi URL sau khi tiêu thụ** để thay đổi bộ chọn sau đó không bị hoàn nguyên khi tải lại |
| `F-UX-04` | `MonitorPage.tsx` | Thêm bộ lọc `group` (`local`/`virtual`/`modbus`) đọc từ URL **và** có bộ chọn thật trên giao diện |
| `F-UX-05` | `MonitorPage.tsx` | Bỏ phần tử tương tác lồng nhau: hàng DO thành `<div>` chứa một `<button>` chọn hàng và một `<button role="switch">` riêng có `aria-label` nêu rõ điểm bị tác động |
| `F-UX-06` | `MonitorPage.tsx` | Gỡ handler ẩn khỏi ô sparkline; thêm nút có nhãn "Ép tay"/"Ghi" ở cuối hàng |
| `F-UX-07` | `MonitorPage.tsx` | `Sparkline` không có mẫu ⇒ hiện `—`, không vẽ đường 0 |
| `F-UX-08` | `MonitorPage.tsx` | `uncertain` dùng đúng từ vựng viết hoa của `QualityBadge` (`UNCERTAIN`), bỏ nhãn `"Lỗi - HIGH"` |
| `F-UX-09` | `MonitorPage.tsx` | Không có số đo ⇒ ô giá trị mới để trống thay vì chuỗi `"null"` |
| `F-UX-10` | `MonitorPage.tsx` | Nút gạt trend thành `<button role="switch">` thật, **chỉ hiện khi đang sửa** và luôn đi kèm Lưu/Hủy; chế độ xem chỉ đọc trạng thái; mặc định lúc lưu khớp mặc định lúc hiển thị; "Hủy" hoàn nguyên |
| `F-UX-11` | `MonitorPage.tsx` | "Điểm ON" chỉ đếm điểm nhị phân, mẫu số là số điểm nhị phân (`n/m · x%`) |

### 8.2 Sửa test

`TrendsPage.requests.test.tsx` và `TrendsPage.orphanSeries.test.tsx` render `TrendsPage` **ngoài Router**, nên `useSearchParams` mới thêm làm 8 test đổ. Đã bọc `MemoryRouter` — phản ánh đúng thực tế trang này luôn nằm trong Router của ứng dụng.

### 8.3 Số đo sau khi sửa

| Phép đo | Lệnh | Kết quả |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | sạch |
| Lint | `npx eslint src --max-warnings=0` | sạch |
| Test FE | `npx vitest --run --environment jsdom src` | **692 pass / 692 · 75 file** |
| Build board | `npm run build:foxlinx` | thành công · `grep -c REVA_SCOPE_ROADMAP` = **0** |

Số lượng test không đổi (692 trước và sau) vì các sửa đổi trên là sửa hành vi
hiển thị/điều hướng của thành phần đã có test bao quanh, cộng với 8 test
`TrendsPage` được bọc `MemoryRouter`. **Chưa có test mới khoá lại từng finding
đã sửa** — đây là khoảng hở đã biết, ghi ở §9.

### 8.4 Deploy lên board Foxlinx

Thời điểm: **2026-08-18T03:15Z**, board `SOM-DDC-24-foxlinx`
(`root@mekong-fac.ddns.net:2223`, RV1126B / Buildroot 2024.02, MCU STM32 thật).

Hai bẫy đã biết của board này, xử lý đúng ngay từ đầu:

1. **Cờ `VITE_PROGRAMMING_REV_A` là build-time và board bật vĩnh viễn** từ
   `TASK-PROG-507`. Dùng `npm run build` trần sẽ âm thầm tắt route
   `/eng/programming`. Checklist ghi lỗi này **đã tái diễn 2 lần** (2026-08-14 và
   2026-08-17). Phiên này dùng `npm run build:foxlinx` và kiểm
   `grep -c REVA_SCOPE_ROADMAP` = 0 **trước khi** copy.
2. **Board Buildroot không có `rsync`** (và cũng không có `curl`) — dùng `scp`
   để copy và `wget` để kiểm HTTP.

Quy trình đã chạy: backup `/opt/mkddc-web/dist` → `dist.prev` (rollback một
lệnh) · `scp` bản mới vào `/tmp/dist-new` · kiểm `index.html` tồn tại trước khi
thay · `mv` + `chown 1001:1001` · `systemctl restart mkddc-web-pi`.

**Xác minh trên chính bundle đang chạy trên board** (không phải trên bản local):

| Kiểm | Kỳ vọng | Thực tế |
|---|---|---|
| 4 chuỗi mất dấu (`Dang tai alarm`, `Trang thai cau hinh`, `Chua co VP nao`, `Tim kiem alarm`) | 0 | **0** |
| 4 chuỗi có dấu tương ứng | ≥1 | **1** mỗi chuỗi |
| Bộ lọc nguồn `F-UX-04` ("Nguồn - Tất cả", "I/O tại chỗ") | ≥1 | **1** |
| Nhãn sai `"Lỗi - HIGH"` (`F-UX-08`) | 0 | **0** |
| "Điểm nhị phân đang ON" (`F-UX-11`) | ≥1 | **1** |
| "Xem tất cả cảnh báo" (`F-UX-02`) | ≥1 | **1** |
| `REVA_SCOPE_ROADMAP` trong bundle đã cài | 0 | **0** |

Sau restart: `mkddc-web-pi` và `mkddc-core` đều `active`; `/api/v1/health` trả
`status=ok` với cả 6 check (`core`, `io_shm`, `iobus`, `mcu_connection`,
`plc_shm`, `web`) đều `ok`. Một trình duyệt thật từ `101.99.36.34` đã nạp bản
mới ngay sau restart và gọi thành công `/api/v1/overview`, `/api/v1/alarms`,
`/api/v1/programming/{capabilities,point-catalog,runtime}` — tất cả HTTP 200,
xác nhận route Programming vẫn sống (cờ Rev A đúng).

> Đường dẫn cũ `/assets/index-B-7cG8Mu.js` trả **200** là do SPA fallback trả
> `index.html` (`Content-Type: text/html`, 1123 byte), không phải bundle cũ còn
> sót — tệp đó đã không còn trên đĩa.

**Chưa kiểm bằng thao tác người thật trên trình duyệt** (bấm deep link, Tab tới
nút gạt DO, gạt trend rồi Lưu). Bằng chứng ở trên là mức "bản đúng đã được phục
vụ và ứng dụng khởi động sạch", không phải usability test — ghi ở §9.

---

### 8.5 Đợt 2 — quyết định của CTO cho 6 phát hiện §7.2b (2026-08-18)

Sáu finding của §7.2b được xử lý trong cùng ngày bởi một agent đóng vai trò quyết định, theo
`AUTH-WEBUX-2026-08-18-01`. Kết quả: **6/6 quyết `SỬA NGAY`**, không mục nào bị
hoãn — nhưng một mục (`F-UX-17`) được sửa **ngược** với đề xuất ban đầu.

| Mã | Quyết định | Đã làm |
|---|---|---|
| `F-UX-17` | `SỬA NGAY` — cách ly, **không** thêm vào menu | `ADR-033`; `NAV_GROUPS` xuất khẩu từ `NavRail.tsx`; test hợp đồng route↔menu mới |
| `F-DOC-06` | `SỬA NGAY` | `UX-SYSTEM-001` v1.9 §3 |
| `F-DOC-07` | `SỬA NGAY` | `UX-SYSTEM-001` v1.9 §5 + §5.2 mới |
| `F-DOC-08` | `SỬA NGAY` | `apps/web-ui/src/shared/styles.css:3` |
| `F-DOC-09` | `SỬA NGAY` | `09_MKDDC_WEB_IMPLEMENTATION_GUIDE` Rev 1.37 §1 |
| `F-DOC-10` | `SỬA NGAY` — đo lại rồi chú thích | Chú thích ở `F-UX-16` §7.1; số đo bên dưới |

#### Vì sao `F-UX-17` không được sửa bằng cách thêm mục menu

Đề xuất ban đầu là xếp `/eng/aux` và `/eng/user-parameters` vào một nhóm của
`NavRail`. Đọc mã trước khi làm cho thấy giả định "hai trang chức năng thật"
không đúng:

- `apiClient.getUserParams()` trả thẳng `getDemoUserParams()` **bất kể `IS_DEMO`**,
  và `putUserParams()` chỉ ghi vào một biến trong module. Grep `apps/web-api` cho
  `user-param` ra **0** kết quả — không có endpoint backend. Trên board, trang này
  hiện 38 tham số MCU **bịa** và trả toast "đã lưu" cho lệnh không tới thiết bị.
- `AuxFunctionsPage` sinh cụm **component graph 28-node**, thứ mà `ADR-020`/`ADR-023`
  đã xếp là As-Built legacy; chính mã tự ghi rằng ở chế độ live nó chỉ trả bản xem
  trước JSON, không có đường nạp xuống thiết bị.

Thêm chúng vào menu là biến một lỗi mà chỉ người gõ URL gặp thành thứ mọi admin
nhìn thấy và tin — đúng lớp lỗi "bịa dữ liệu" mà §3.1 của chính hồ sơ này khen sản
phẩm đã đóng ở mọi chỗ khác. Quyết định đầy đủ, ba phương án bị loại và **rủi ro
còn lại** (gõ tay URL vẫn tới được) ghi ở `ADR-033`.

Phần bền của bản sửa là **test**, không phải quyết định: cơ chế §7.3 mục 1 chỉ
thật sự bị đóng khi có thứ thi hành nó.

#### Số đo thật

| Phép đo | Lệnh | Kết quả |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | sạch (exit 0) |
| Lint | `npx eslint src --max-warnings=0` | sạch (exit 0) |
| Test FE | `npx vitest --run --environment jsdom src` | **729 pass / 729 · 80 file**, 0 đỏ (mốc trước: 692/75) |
| — trong đó do phiên này thêm | `src/app/route-menu-contract.test.ts` | **+8 test / +1 file**; phần tăng còn lại là của phiên chính chạy song song |
| Test hợp đồng route↔menu | `npx vitest --run … src/app/route-menu-contract.test.ts` | **8 pass / 8** |
| Harness tài liệu | `python3 scripts/docs_iso_harness.py --expect` | **PASS**, khớp toàn bộ ngưỡng |

Test mới được **kiểm ngược** chứ không chỉ chạy xanh: thêm tạm một route
`eng/orphan-probe` vào `App.tsx` làm assert đầu tiên đỏ đúng thông điệp đã thiết
kế; `App.tsx` được khôi phục nguyên trạng ngay sau đó (`git diff` rỗng). Một test
hợp đồng chưa từng thấy đỏ thì chưa chứng minh được nó bắt được gì.

#### `F-DOC-10` — đo lại, giả thuyết đúng

Cùng một cây làm việc, cùng một lần chạy, chỉ khác biến môi trường:

| Build | Chunk chính | gzip | Chunk `charts` |
|---|---:|---:|---:|
| `vite build` (= `npm run build`, cờ Programming TẮT) | **715,18 kB** | 182,77 kB | 407,31 kB |
| `VITE_PROGRAMMING_REV_A=1 vite build` (= `npm run build:foxlinx`) | **898,84 kB** | 228,26 kB | 407,31 kB |
| Chênh lệch | **+183,66 kB** | +45,49 kB | **0** |

Kết luận: **không phải mâu thuẫn.** Chênh lệch nằm trọn trong chunk chính và đúng
bằng bốn workspace Programming được bake vào; chunk `charts` giống hệt nhau, khớp
con số "charts 407 kB / 106 kB gzip" của `F-UX-16`. Hai con số 710 kB và 892 kB
trong hồ sơ cũ là hai phép đo hợp lệ của hai cấu hình build khác nhau, chỉ thiếu
câu nói ra điều đó.

---

## 9. Việc cần làm tiếp

Chỉ liệt kê việc **thật sự ngoài phạm vi phiên này** hoặc **bị chặn**, kèm điều kiện mở khoá.

| Việc | Vì sao chưa làm | Cần gì để mở khoá |
|---|---|---|
| `F-UX-12` (dirty-guard cho 4 trang cấu hình) | Đúng phạm vi kỹ thuật nhưng là **thay đổi hành vi điều hướng trên 4 trang**, cần một hook dùng chung và bộ test riêng — vượt quá "sửa lỗi kèm review" | Quyết định của PM về việc gộp thành một task riêng, hoặc chỉ thị làm tiếp ngay |
| `F-UX-13` (5 severity trong nhật ký alarm) | Đổi ánh xạ màu của nhật ký chạm vào quy ước hiển thị chung; nên đi kèm rà soát alarm philosophy | Xác nhận quy ước màu cho `low`/`info` từ UX Lead |
| `F-UX-14` (TrendPreview lấy mẫu theo producer) | Cần chốt hành vi khi điểm ngừng cập nhật: đứt đường hay giữ giá trị cuối | Quyết định UX về cách thể hiện gap trên biểu đồ xem nhanh |
| ~~`F-DOC-01/02/04/05` (đồng bộ tài liệu design system)~~ — **ĐÃ MỞ KHOÁ VÀ ĐÃ LÀM 2026-08-18** | Là tài liệu **authority** có Owner là UX Lead; sửa bảng token và §6/§9 phải qua Revision History có người duyệt, không tự ý ghi đè | Uỷ quyền đã được ban hành: `AUTH-WEBUX-2026-08-18-01` trong [DECISIONS.md](../../00_governance/DECISIONS.md). `UX-SYSTEM-001` phát hành **v1.8**, `ADR-032` đã viết cho việc đổi 3→4 nhóm điều hướng. Xem §7.2 |
| Chạy bộ e2e Playwright (9 spec, gồm `pa3-a11y`) | Phiên này chỉ chạy được unit/component; e2e cần Playwright browsers cài sẵn | `npx playwright install` trên máy dev, hoặc runner CI có browser (CI đang bị chặn bởi billing — xem `project_ci_billing_blocked_20260817`) |
| Kiểm thao tác người thật trên board sau deploy (bấm deep link `?alarm=`/`?points=`/`?group=`, Tab tới nút gạt DO, gạt trend rồi Lưu) | Deploy đã xác minh **bản đúng được phục vụ và app khởi động sạch** (§8.4), nhưng đó không phải bằng chứng thao tác | Người thật mở `http://mekong-fac.ddns.net:8081` và chạy 4 kịch bản trên, hoặc chạy `pa3-a11y`/`fe-pages-health` ở chế độ target |
| Thêm `<h1>` cho 19 trang/tab (`F-UX-15`) | Chạm vào layout của ba feature khác nhau (Modbus/Programming/Scheduler), mỗi cái có layout cha riêng | Một task gom chung, tránh sửa rải rác gây xung đột với các phiên song song |
| Code-splitting theo route (`F-UX-16`) | Đổi chiến lược chunking của `vite.config.ts` ảnh hưởng toàn bộ quy trình đóng gói và deploy lên board | Một task riêng có đo lại thời gian mở trang đầu **trên board thật**, không chỉ so kích thước tệp |
| Test khoá lại 11 finding đã sửa | Các sửa đổi đã được typecheck/lint/692 test hiện có bao quanh, nhưng chưa có test **mới** dành riêng cho từng finding (deep link, bàn phím nút gạt, sparkline rỗng, nhãn `uncertain`…) | Một task bổ sung test; nên đi kèm test đối chiếu hai chiều cho `drilldown.ts` nêu ở §7.3 mục 1 |
| Level 2 process graphic (§4.1) | **Quyết định sản phẩm**, không phải lỗi. Rev A không có trình soạn đồ hoạ theo phạm vi đã chốt | Quyết định của CTO/PM về việc đưa vào Rev B, hoặc chấp nhận đường đi tối thiểu ở §6.2 (nhóm theo thiết bị công nghệ) |
| Đóng thật `/eng/user-parameters` (nối backend **hoặc** gỡ hẳn) | `ADR-033` mới chỉ **cách ly**: trang vẫn tới được bằng cách gõ URL và vẫn hiện tham số MCU bịa. Nối backend là thêm endpoint mới ở `apps/web-api`; gỡ hẳn là quyết định phạm vi Rev A | Product quyết EasySet User Parameters có thuộc Rev A không. Nối thật ⇒ `GET/PUT /api/v1/system/config/user-params` + bỏ mock trong `apiClient`. Gỡ ⇒ xoá route + trang + khoá i18n + dòng `ROUTE_MIN_ROLE`, cập nhật `ADR-033` |
| Cùng câu hỏi cho `/eng/aux` | Trang sinh cụm cho component graph 28-node — runtime mà `ADR-020`/`ADR-023` đã xếp legacy. Giữ hay gỡ là quyết định phạm vi, không phải lỗi | Product xác nhận trang này còn vai trò gì sau khi Programming Rev A (ST + FBD) lên |
| Một câu chú thích phép đo bundle ở **Plan 57 §8** | Số 892 kB ở Plan 57 là bản `build:foxlinx`, số 710 kB ở `F-UX-16` là bản `build` trần — đã đo lại và xác nhận (§8.5). Hồ sơ Plan 57 do phiên chính sở hữu nên phiên này không sửa | Phiên chính thêm một câu vào Plan 57 §8 nói rõ phép đo dùng `npm run build:foxlinx` |
| Một đoạn ghi hai route cách ly vào **`UX-SYSTEM-001` §6** | §6 là hồ sơ chủ quản của bảng nhóm điều hướng, nhưng phiên này chỉ được cấp quyền sửa §3 và §5 của hồ sơ đó | Người sở hữu §6 thêm đoạn tương ứng; nội dung đã có sẵn ở `ADR-033` và ở guide Rev 1.37 §1 |
| Programming `RELEASE_READY BLOCKED` | Ngoài phạm vi review UI/UX này; đã có hai báo cáo đang hiệu lực | Xử lý theo `REV-PROG-FE-UX-2026-08-13` và `REV-PROG-OVERVIEW-DESIGN-GAP-2026-08-15` |

---

## 9b. Ghi chú trung thực về thẩm quyền (bắt buộc theo `DOC_GOVERNANCE` §6)

Mọi quyết định ghi trong hồ sơ này — gồm `ADR-032`, `ADR-033` và sáu phán quyết
ở §7.2b — được **agent thực hiện dưới vai trò được giao trong phiên làm việc**,
dưới quyền `AUTH-WEBUX-2026-08-18-01`. **Không có chữ ký người nào** cho vai trò
CTO/UX Lead/Tech Lead ở ngày 2026-08-18.

Theo `DOC_GOVERNANCE` §6 quy tắc 4 và §4.1, ô chữ ký còn thiếu phải ghi
`WAIVED FOR IMPLEMENTATION` chứ không được gán tên vai trò như thể đã có người
duyệt. Các bản sửa 1.1 của hồ sơ này từng ghi "CTO quyết định" — cách diễn đạt
đó **sai chuẩn trung thực** và đã được sửa ở bản 1.2.

Hệ quả cần nhớ khi đọc tiếp: hai `ADR` nêu trên **đủ tư cách làm đầu vào
implementation** (đúng phạm vi `AUTH-WEBUX-2026-08-18-01`), nhưng **chưa đủ tư
cách baseline `M5 — APPROVED`**. `RELEASE_READY` vẫn là cổng độc lập và không
được suy ra từ bất kỳ mục nào ở đây.

## 10. Revision History

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.1 | 2026-08-18 | Quyết định cho 6 phát hiện §7.2b (agent đóng vai trò quyết định; **chưa có chữ ký người** — xem ghi chú trung thực ở §11) — **6/6 `SỬA NGAY`**. `F-UX-17` được sửa **ngược** đề xuất ban đầu: hai route bị **cách ly** khỏi điều hướng theo `ADR-033` thay vì được thêm vào menu, vì đọc mã cho thấy cả hai chạy trên mock demo / runtime legacy; phần bền là `app/route-menu-contract.test.ts` (8 test, đối chiếu route↔menu hai chiều, đã kiểm ngược). `F-DOC-06/07` đóng bằng `UX-SYSTEM-001` v1.9 §3/§5+§5.2; `F-DOC-08` đóng ở `styles.css`; `F-DOC-09` đóng bằng guide Rev 1.37 §1; `F-DOC-10` đóng bằng **đo lại thật** (715,18 kB vs 898,84 kB — không mâu thuẫn) + chú thích ở §7.1. Thêm §8.5. Số đo: tsc sạch · eslint sạch · vitest **729/729, 80 file** (phiên này góp +8 test/+1 file; phần còn lại của phiên chính chạy song song) · harness tài liệu PASS. |
| 1.2 | 2026-08-18 | Đóng phát hiện của kiểm tra viên độc lập: đính chính §3.3 và §5.2/§5.3/§5.4 (nói quá về icon severity; "19 trang/tab thiếu h1" phần lớn là dương tính giả do đếm theo file), cập nhật `F-UX-12..15` sang ĐÃ ĐÓNG, thêm §9b ghi chú trung thực về thẩm quyền và sửa attribution "CTO" |
| 1.0 | 2026-08-18 | Phát hành đầu — review UI/UX/UC toàn bộ web-ui và tài liệu thiết kế; 16 finding code + 5 finding tài liệu; 11 finding đã sửa trong phiên |
