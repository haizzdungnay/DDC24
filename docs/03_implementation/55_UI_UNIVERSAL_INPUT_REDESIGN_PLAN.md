# Plan 55 — Thiết kế lại & triển khai trang cấu hình Universal Input (`/eng/inputs`)

**Trạng thái:** **Phase 1 — APPROVED, đang triển khai** (PM/CTO duyệt thiết kế + phạm vi Phase 1 ngày 2026-08-14, xem `UI_UNIVERSAL_INPUT_REDESIGN_2026-08-14.md` §7 "Quyết định PM/CTO"). Phase 2/3 vẫn NOT STARTED, chưa xin chốt phạm vi.
**Ngày:** 2026-08-14
**Tác giả:** Agent kỹ thuật
**Tham chiếu:**
[Gap report 12 UC](../07_records/reviews/UI_UNIVERSAL_INPUT_FE_GAP_REPORT_2026-08-14.md) (`REV-UI-CFG-GAP-2026-08-14`) ·
[Thiết kế UI/UX](../04_uiux/UI_UNIVERSAL_INPUT_REDESIGN_2026-08-14.md) (`UX-INPUT-REDESIGN-002`) ·
[Hồ sơ đầu vào UX toàn hệ thống](../04_uiux/UX_REDESIGN_INPUT_BRIEF_2026-08-08.md) (`UX-INPUT-001`) ·
[Config schema](../02_design/interfaces/CONFIG_SCHEMA_MK-DDC-24_VI.md) §3

---

## 0. Việc đã xong trong phiên mở plan này (không lặp lại)

Trong lúc khảo sát để viết plan này, phát hiện và vá luôn một bug dữ liệu ở
đúng lớp sẽ bị đụng tới (theo quy tắc "làm hết việc" của dự án — không chỉ ghi
finding rồi để lại):

| Việc | File | Bằng chứng |
|---|---|---|
| `aiConfigToIo()` ghi cứng `type:'NTC10k'` cho mọi kênh nhóm resistance và `unit` canonical cho mọi kênh — mỗi lần Save (ghi lại cả 16 kênh) sẽ âm thầm hạ cấp `NTC20k`/`PT100`/`PT1000`/unit lạ ở các kênh KHÁC không hề bị sửa | `apps/web-ui/src/shared/api/client.ts`, `types.ts` | `AiInputConfig.ioType`/`ioUnit` (raw passthrough) + logic chỉ ghi mặc định khi nhóm thật sự đổi |
| Test round-trip mới | `apps/web-ui/src/shared/api/client.aiInputs.test.ts` | 7 case, PASS |
| Kiểm chứng | — | `npx vitest --run --environment jsdom src/shared/api/client.aiInputs.test.ts src/features/points/InputsPage.test.tsx` → **13/13 PASS**; suite `src` đầy đủ → **562/567 PASS**, 5 fail còn lại ở `CheckCommissionPage.test.tsx` (`useDraftWorkspace.ts`) — không liên quan, thuộc nhánh Programming đang sửa dở song song (file đó không nằm trong `git status` đầu phiên này) |

Phase 1 dưới đây **dùng** `ioType`/`ioUnit` đã có sẵn này, không cần làm lại.

---

## 1. Nguyên tắc thực hiện

1. **Phase 1 không đổi API/Go/Core** — chỉ đổi cách FE trình bày dữ liệu đã có
   sẵn trên wire (`type` 12 giá trị, `scale_lo/scale_hi`, `unit` string tự do).
   Có thể bắt đầu ngay sau khi UX Lead duyệt thiết kế, không cần chờ backend.
2. **Phase 2/3 đổi contract** (Go schema mới, có thể cả Core/FW) — **không bắt
   đầu code** cho tới khi PM/CTO chốt phạm vi + có đánh giá HW nếu đụng tới
   firmware. Chỉ liệt kê ở đây để không mất dấu, không phải cam kết lịch.
3. Mỗi task trong Phase 1 phải có: file chạm tới, test cần thêm/sửa, cách kiểm
   chứng thật (không dẫn lại số đo cũ) — đúng CLAUDE.md §"Quy trình commit".
4. Không đổi `route role` (`/eng/inputs` vẫn `admin`) trong phạm vi plan này —
   xem câu hỏi mở §7 của tài liệu thiết kế.

---

## 2. Phase 1 — Redesign FE thuần (task breakdown)

Ước lượng người-ngày là ước lượng thô cho một dev FE quen React/TS + Vitest +
Playwright của repo này; không tính review/QA.

| # | Task | File chính | Acceptance criteria | Ước lượng |
|---|---|---|---|---:|
| 1.1 | Header cố định (live status strip: value/raw/quality/updatedAt) thay cho phần đầu `AiSummary` | `InputsPage.tsx` | Hiện đúng D-07: `—` khi thiếu dữ liệu, không fabricate; quality badge 5 màu đúng `PointQuality` | 0.5 |
| 1.2 | Tab "Điện & Cảm biến": tách Electrical Mode / Sensor Profile (NTC10k/NTC20k) / Contact NO-NC, banner không cách ly | `InputsPage.tsx` (component mới `ElectricalModeTab`), `i18n.tsx` | Chọn Electrical Mode=Điện trở hiện đúng 2 lựa chọn Sensor Profile, không hiện PT100/PT1000; đổi Electrical Mode sang nhóm khác thì bỏ `ioType` cũ (test round-trip ở `client.aiInputs.test.ts` đã cover phần data, task này chỉ nối UI) | 1.5 |
| 1.3 | Tab "Scaling & Đơn vị": hiện raw range suy từ Electrical Mode, `scale_lo/scale_hi` đổi nhãn, chip cảnh báo `ioUnit` lạ | `InputsPage.tsx` (`ScalingTab`) | Không tự set `unit` khi user không thao tác (giữ `ioUnit` nguyên vẹn qua roundtrip); Range Multiplier thu gọn mặc định | 1.5 |
| 1.4 | Tab "Xử lý tín hiệu": relabel filter, danh sách kênh cùng Math Function | `InputsPage.tsx` (`SignalConditioningTab`) | Danh sách "kênh khác cùng hàm" tính đúng từ 16 kênh đã tải, cập nhật live khi đổi tab khác | 0.5 |
| 1.5 | Tab "Hiệu chuẩn": offset helper (tính từ Raw hiện tại + giá trị chuẩn nhập tay) | `InputsPage.tsx` (`CalibrationTab`) | Helper chỉ điền lại field, không tự ý gọi save; ghi rõ giới hạn 1-điểm trong copy | 1.0 |
| 1.6 | Tab "Cảnh báo & Lưu trữ": card tóm tắt alarm theo kênh + nút deep-link tạo alarm mới | `InputsPage.tsx`, `AlarmSettingsPage.tsx` (đọc query `newSource`) | `/eng/alarm-settings?newSource=UI:5` tạo đúng 1 alarm nháp với `sources:[{kind:'UI',channel:5}]`; không phá luồng `addAlarm()` hiện có | 1.0 |
| 1.7 | Tab "Chẩn đoán": dời "Live Data" cũ, thêm hiển thị `qualityReason` nguyên văn + banner giới hạn fault-detection mức board | `InputsPage.tsx` (`AiSummary` đổi tên/refactor) | Không hiện suy diễn "đứt dây/chập dây" khi backend không cấp; giữ chart/min-max-avg/note đang có | 0.5 |
| 1.8 | Wizard "Thiết lập nhanh" đi theo 6 tab mới, chỉ hiện khi kênh còn ở trạng thái mặc định trống | `InputsPage.tsx` (`WizardPanel`) | `wizardSteps()` phản ánh đúng thứ tự tab mới; nút chỉ hiện khi `signalType===0 && !enabled` (hoặc điều kiện tương đương thống nhất với UX Lead) | 1.0 |
| 1.9 | `<details>` "Xem theo thanh ghi (u0-u7)" — hạ cấp Advanced view cũ thành read-only tham khảo | `InputsPage.tsx` | Không còn là bề mặt sửa chính; vẫn đọc đúng giá trị hiện tại 8 field | 0.5 |
| 1.10 | i18n VI/EN đầy đủ cho toàn bộ nhãn/copy mới | `i18n.tsx` | Không còn chuỗi hardcode tiếng Anh/Việt lẫn trong JSX (theo quy tắc dự án); cả hai locale review được | 1.0 |
| 1.11 | Cập nhật `InputsOverviewModal` cột "Signal" hiện Electrical Mode + Sensor Profile | `InputsPage.tsx` | Bảng tổng quan 16 kênh không còn hiện số thứ tự thanh ghi | 0.25 |
| 1.12 | Test: component test từng tab mới, cập nhật `InputsPage.test.tsx`, thêm test cho `AlarmSettingsPage` đọc `newSource` | `InputsPage.test.tsx`, `AlarmSettingsPage.test.tsx` (mới nếu chưa có) | `npx vitest --run --environment jsdom src` toàn bộ PASS (trừ các fail đã biết không liên quan tại thời điểm chạy) | 1.5 |
| 1.13 | E2E board nếu có sẵn kịch bản Inputs trong `e2e-board/` — cập nhật selector theo IA mới | `apps/web-ui/e2e-board/*.spec.ts` (nếu có) | Không hồi quy `board-page-audit.spec.ts` | 0.5 |

**Tổng Phase 1 (ước lượng thô):** ~11 người-ngày dev + review/QA riêng.

**Trạng thái 2026-08-14: cả 13 task DONE**, cùng phiên với duyệt thiết kế
(xem CHANGELOG `[Unreleased]` mục "Triển khai Phase 1..." để có mô tả đầy đủ
từng task). Ghi chú riêng 2 task có sai lệch nhỏ so với đặc tả gốc trong bảng
trên:

- **1.6** — deep-link dùng format `?newSource=UI:5` (dấu `:` thay vì giữ
  nguyên cấu trúc `sources:[{kind:'UI',channel:5}]` trong URL, vì query param
  chỉ nhận chuỗi) — `AlarmSettingsPage` parse và tạo đúng
  `sources:[{kind:'UI',channel:5,pointId:'UI-05'}]` khi mount. Đã bổ sung thêm
  `?edit=<id>` (không có trong đặc tả gốc, nhưng cần cho nút "Sửa →" ở tab 4.5
  không phải là nút chết) — cùng cơ chế đọc query, chi phí biên nhỏ.
- **1.13** — không có kịch bản Inputs *riêng* trong `e2e-board/`, nhưng
  `board-page-audit.spec.ts` (audit toàn bộ route, gồm `/eng/inputs`) đã chạy
  lại full trên board Foxlinx thật qua SSH tunnel — 2/2 PASS, `/eng/inputs`
  0 console/page/http error ở cả hai mode deeplink/in-app.

### Definition of Done Phase 1

- [x] Toàn bộ 13 task trên merge, `npx vitest --run --environment jsdom src` →
      **581/581 PASS** (71 file) + `npm run lint` sạch + `npm run build`
      (`VITE_PROGRAMMING_REV_A=1`) PASS — số đo thật 2026-08-14, không dẫn số
      cũ.
- [x] Deploy thử lên board Foxlinx (`SOM-DDC-24-foxlinx`), chụp ảnh bằng
      chứng tại `apps/web-ui/board-evidence/08..12-inputs-*.png`, xác nhận 16
      kênh load đúng dữ liệu thật (nhãn `CAM BIEN NHIET LO HOI` thật của board,
      không rơi về demo — theo D-07/FE-DIAG-01 đã có tiền lệ).
- [x] `docs/04_uiux/UI_UNIVERSAL_INPUT_REDESIGN_2026-08-14.md` cập nhật trạng
      thái từ Draft → Approved (§7 "Quyết định PM/CTO", §12 "Nhật ký triển
      khai").
- [x] CHANGELOG ghi nhận dưới `[Unreleased]`.

---

## 3. Phase 2 — Mở rộng contract (Go + có thể Core), cần PM/CTO chốt phạm vi

Không bắt đầu code phần này khi chưa duyệt. Liệt kê để không mất dấu khỏi gap
report gốc.

| # | Hạng mục | UC | Cần đổi | Ghi chú rủi ro |
|---|---|---|---|---|
| 2.1 | Debounce/min-ON/min-OFF riêng cho dry contact | UC-UI-07 | `ConfigIO.UI` thêm field (Go validate) + `mkddc-iobus`/Core đọc field mới + có thể MCU FW nếu debounce cần chạy ở lớp thấp | Phải xác nhận debounce hiện có đang chạy ở đâu (iobus hay MCU) trước khi thêm field — nếu MCU thì đụng firmware, effort tăng nhiều |
| 2.2 | Calibration gain + 2-point + audit trail (ngày/người) + reset factory | UC-UI-08 | Schema `io_config.conf` thêm `sensor_cal_gain`, `sensor_cal_at`, `sensor_cal_by`; Go validate; audit log ghi ai/khi nào đổi (theo pattern audit log đã có ở Commissioning) | "Reset factory" cần định nghĩa "factory" là gì cho từng Sensor Profile — cần input từ HW/calibration test plan (`28_IO_CALIBRATION_TEST_PLAN.md`) |
| 2.3 | COV threshold cho historian per-point | UC-UI-11 | `trends/config` Go schema thêm `covThreshold`; Core/historian logic ghi theo COV thay vì chỉ interval | Đụng historian tier RAM/SQLite/archive đã có — cần review riêng, không nhỏ |

---

## 4. Phase 3 — Fault detection per-channel (rủi ro/effort cao nhất, cần đánh giá HW trước)

| # | Hạng mục | UC | Cần đổi | Ghi chú |
|---|---|---|---|---|
| 3.1 | Per-channel open-circuit/short-circuit/over-range | UC-UI-09 | MCU FW đo lường mới (hiện chỉ có `IOP_FAULT_UI_OV` gộp cả board) → IOP protocol thêm field per-channel → Core/`bacnet_objtable.cpp` cập nhật `ui_reliability[]` đã có sẵn khung (ADR-011) chỉ cần nguồn dữ liệu thật per-channel → Go/FE hiển thị | Đây là hạng mục duy nhất **chắc chắn cần đổi firmware MCU**, không chỉ SOM source. Cần đánh giá khả thi phần cứng (có đo được per-channel bằng mux hiện có không) trước khi ước lượng effort — **không đoán số ngày ở đây** |

Không đề xuất lịch cho Phase 3 tại tài liệu này — cần một đánh giá HW riêng
(giống mô hình `IOT-5914`/`IOT-5933` đã làm cho EMC: coordination trước, effort
sau khi có kết quả đánh giá).

---

## 5. Rủi ro chung

| Rủi ro | Mitigation |
|---|---|
| Đổi IA (3 mode → 6 tab) có thể gây khó chịu cho kỹ thuật viên đã quen giao diện cũ trên board đang chạy | Giữ `<details>` u0-u7 làm lối thoát quen thuộc (task 1.9); không xoá Wizard, chỉ sắp lại thứ tự |
| Tab "Cảnh báo & Lưu trữ" đọc/ghi chéo sang `AlarmSettingsPage` qua query param — hai trang từ nay có phụ thuộc lẫn nhau | Giữ thay đổi ở `AlarmSettingsPage` tối thiểu (chỉ đọc thêm 1 query param tuỳ chọn khi mount), có test riêng (task 1.12) |
| Phase 1 làm xong nhưng Phase 2/3 không được duyệt → copy "Sắp có" tồn tại vô thời hạn, gây hiểu lầm là đang phát triển | Câu hỏi §7 của tài liệu thiết kế đã nêu — quyết định "ẩn hẳn" mặc định của Phase 1 chính là để tránh rủi ro này |
| `npm test` chỉ quét `src/`, dễ bỏ sót lỗi ở `e2e/`/`e2e-board/` khi CI chạy | Task 1.13 tách riêng, chạy Playwright tường minh theo đúng quy tắc CLAUDE.md |

---

## 6. Theo dõi tiến độ

| Phase | Trạng thái | Ghi chú |
|---|---|---|
| 0 — Bug fix round-trip | **DONE** 2026-08-14 | Xem §0; đã merge vào cùng nhánh với plan này |
| 1 — Redesign FE thuần | **DONE** 2026-08-14 | 13/13 task; 581/581 vitest, lint sạch, build PASS, e2e board 2/2 PASS; deploy Foxlinx xong, ảnh bằng chứng ở `board-evidence/` |
| 2 — Mở rộng contract | **NOT STARTED** — chờ PM/CTO chốt phạm vi | 3 hạng mục, effort chưa ước lượng |
| 3 — Fault detection per-channel | **NOT STARTED** — chờ đánh giá HW | 1 hạng mục, effort chưa ước lượng, có thể đụng FW MCU |
