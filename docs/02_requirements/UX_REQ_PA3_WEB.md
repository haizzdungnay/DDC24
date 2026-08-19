# Yêu cầu UX Web PA3 — MK-DDC-24

> **ID:** UX-REQ-PA3-WEB-001
> **Phiên bản:** 1.1 | 2026-08-18
> **Ngày phát hành đầu:** 2026-08-08
> **Trạng thái:** Baseline cho slice P1–P6
> **Nguồn:** `docs/CHUONG_YEU_CAU/dashboard.md` (UX-REQ-MKDDC24-PA3-001),
> `docs/CHUONG_YEU_CAU/UX_DESIGN_MK-DDC-24_PA3.md` (UX-DES-MKDDC24-PA3-001)
> **Plan:** [52_WEB_PA3_DASHBOARD_UX_IMPLEMENTATION_PLAN.md](../03_implementation/archive/52_WEB_PA3_DASHBOARD_UX_IMPLEMENTATION_PLAN.md)
> **Bằng chứng:** [EV-WEB-PA3-001](../07_records/test-evidence/fw-som/2026-08-08-web-pa3-dashboard.md)

Tài liệu này chuyển hai bản mô tả PA3 thành **requirement có ID kiểm chứng
được** (PA3-001, PA3-002) và chốt **từ vựng dùng chung** giữa backend, frontend
và tài liệu. Nó không thay thế hai tài liệu nguồn; nó là lớp có thể trace tới
source và test.

---

## 1. Từ vựng chuẩn (PA3-001)

Mỗi thuật ngữ dưới đây có **đúng một** nghĩa trên toàn hệ thống. Lệch nghĩa giữa
hai tầng là nguyên nhân của cả một lớp lỗi "giao diện nói một đằng, thiết bị làm
một nẻo".

### 1.1 Chất lượng điểm (`quality`)

| Giá trị | Nghĩa | KHÔNG phải là |
|---|---|---|
| `good` | Producer đo được và tin được | mặc định khi không rõ |
| `uncertain` | Producer đo được nhưng không đảm bảo | một dạng nhẹ của `bad` |
| `bad` | Producer báo số đo không dùng được | mất kết nối |
| `stale` | Số đo cũ hơn ngưỡng tươi | mất kết nối |
| `offline` | Không liên lạc được với nguồn | giá trị bằng 0 |

**Đúng năm giá trị. `quality` KHÔNG có `unknown`** — thang có `unknown` là
`health.state` ở §1.2, và đó là hai thang khác nhau. Type `PointQuality` trong
`apps/web-ui/src/shared/types.ts` cũng chỉ có năm giá trị này; `QualityBadge` gặp
giá trị lạ thì lùi về `uncertain`, không tự sinh mức thứ sáu.

**Luật:** producer không nói gì ⇒ `uncertain`, KHÔNG phải `good`. Ba trạng thái
`bad`/`stale`/`offline` phải có **ba cách trình bày khác nhau** trên giao diện
(UX-DES §22): chúng dẫn tới ba hành động xử lý khác nhau, nên gộp hình thức trình
bày là xoá mất thông tin chẩn đoán.

### 1.2 Sức khoẻ phân hệ (`health.state`)

`good` · `degraded` · `fault` · `offline` · `unknown`

**Luật:** `unknown` là trạng thái riêng. Không đọc được một phân hệ KHÔNG được
hiển thị như `good` (đây là hồi quy PA3-F01 đã xảy ra một lần) và cũng không
được hiển thị như `fault` (có thể chỉ là chưa cấu hình).

**Luật trình bày:** bốn trạng thái bất thường `degraded`/`fault`/`offline`/`unknown`
phải có **bốn cách trình bày khác nhau**. `offline` (mất liên lạc) và `unknown`
(chưa biết, có thể chỉ là chưa cấu hình) đặc biệt không được trộn: một cái cần đi
kiểm tra đường truyền, cái kia cần đi cấu hình.

> [!NOTE]
> **Vì sao mục này đổi ở v1.1.** Bản v1.0 đặt câu luật "bốn trạng thái
> `bad`/`stale`/`offline`/`unknown`" vào §1.1, trong khi bảng ngay trên nó định
> nghĩa `quality` **không** có `unknown` — tài liệu tự mâu thuẫn (finding
> `F-DOC-03` của [`REV-FE-UIUX-UC-2026-08-18`](../07_records/reviews/FE_UIUX_UC_REVIEW_2026-08-18.md)).
> Nguyên nhân: câu luật được viết cho thang `health.state` rồi đặt nhầm vào mục
> của thang `quality`. Cách sửa đã chốt là **chỉ sửa tài liệu** — chuyển câu luật
> về đúng §1.2 — theo quyết định **Q1** của
> [`AUTH-WEBUX-2026-08-18-01`](../00_governance/DECISIONS.md). Phương án còn lại
> (thêm `unknown` vào `PointQuality`) bị loại vì nó đổi contract giữa backend và
> frontend, vượt phạm vi Wave 0 của Plan 57. **Không** thêm `unknown` vào
> `PointQuality` khi chưa có ADR riêng.

### 1.3 Mức cảnh báo (`severity`)

`critical` · `high` · `medium` · `low` · `info` — đúng năm mức, khớp ISA-18.2 và
`AlarmDTO.Severity` của backend. Không có mức thứ sáu, không gộp mức.

### 1.4 Vòng đời cảnh báo (`status`)

`active` · `unack` · `acked` · `shelved` (và `cleared` cho lịch sử).

### 1.5 Vai trò

`viewer` < `operator` < `admin`. Đúng ba vai trò. Không có Engineer/Technician.

**Luật:** frontend KHÔNG được rộng hơn backend (sẽ ra 403 thô) và cũng KHÔNG
được chặt hơn backend (lấy mất chức năng người dùng có quyền dùng — hồi quy
PA3-F09 đã xảy ra với Scheduler).

### 1.6 Ép tay (override)

| Thuật ngữ | Nghĩa |
|---|---|
| Local Manual | Mức ưu tiên 2 — mọi lệnh ghi từ Web đều ở mức này |
| `ttlS` | Thời hạn lệnh, tính bằng giây, **do Core cưỡng chế** |
| `overrideExpiresInS` | Số giây còn lại **do Core báo về**, không do FE tính |
| Release | Nhả quyền điều khiển, trả về vòng lặp tự động — **KHÔNG phải ghi 0** |

**Luật:** không có bộ chọn BACnet priority trên giao diện Web.

### 1.7 Điểm và năng lực phần cứng (Rev A base SKU)

16 × UI · 4 × AO · 4 × DO · **0 × DI công nghiệp riêng** · 1 RS-485 (không có
cổng thứ hai) · BACnet/IP feature-gated OFF · không có BACnet MS/TP.

**Luật:** giao diện chỉ dựng ô cho phần cứng mà `capabilities` của authority
xác nhận có thật.

---

## 2. Requirement theo use case (PA3-002)

Định dạng: `REQ-PA3-<UC>-<n>`. Cột "Kiểm chứng" trỏ tới test hoặc bằng chứng
runtime — requirement không kiểm chứng được thì không được ghi vào đây.

### UC-01 — Tổng quan hệ thống (Landing)

| ID | Yêu cầu | Kiểm chứng |
|---|---|---|
| REQ-PA3-01-1 | Landing đọc **một** read model `GET /api/v1/overview`, không tự ghép nhiều endpoint | `TestOverviewSchemaAndDomains` |
| REQ-PA3-01-2 | Hiển thị overall state theo thứ tự ưu tiên: mất authority → alarm critical/high → chất lượng điểm → degraded | `TestOverviewOverallOfflineWhenCoreUnreachable` |
| REQ-PA3-01-3 | Mỗi ô health nói ra `state`, `reasonCode`, `source`, `observedAt` | `TestOverviewSchemaAndDomains` |
| REQ-PA3-01-4 | Không point nào có timestamp hợp lệ ⇒ `lastDataAt` là `null`, giao diện hiện `—` | `TestOverviewLastDataAtIgnoresMissingTimestamps`, `DashboardPage.test.tsx` |
| REQ-PA3-01-5 | Landing KHÔNG chứa CPU/RAM/nhiệt độ/uptime/service/sơ đồ controller | `DashboardPage.test.tsx`, `e2e/pa3-dashboard.spec.ts` |
| REQ-PA3-01-6 | Landing KHÔNG dựng `RS485-2` | `DashboardPage.test.tsx`, e2e |
| REQ-PA3-01-7 | `schemaVersion` lệch ⇒ UI fail closed, không vẽ bằng dữ liệu đoán | `DashboardPage.test.tsx`, e2e |
| REQ-PA3-01-8 | Critical/High nằm trên nếp gấp ở 1440×900 | `e2e/pa3-dashboard.spec.ts` |

### UC-02 — Giám sát điểm

| ID | Yêu cầu | Kiểm chứng |
|---|---|---|
| REQ-PA3-02-1 | Inventory gồm UI/AO/DO/Virtual/Modbus trong cùng một không gian | `MonitorPage.test.tsx` |
| REQ-PA3-02-2 | Lọc theo kind, quality, trạng thái vận hành (forced/fault/offline/writable/logging) | `MonitorPage.test.tsx` |
| REQ-PA3-02-3 | Bộ lọc và tìm kiếm nằm trong URL; refresh/back giữ ngữ cảnh | `e2e/pa3-dashboard.spec.ts` |
| REQ-PA3-02-4 | Tìm theo id, tag, tên hiển thị và nguồn | `MonitorPage.tsx` filter model |
| REQ-PA3-02-5 | Không có hàng DI trên base SKU | `TestOverviewNeverInventsDigitalInputs` |

### UC-03 — Chi tiết điểm

| ID | Yêu cầu | Kiểm chứng |
|---|---|---|
| REQ-PA3-03-1 | Hiển thị value/unit/raw/quality/quality_reason/source/priority/updatedAt/forced/writable/logging khi có | `pointNormalizer.test.ts` |
| REQ-PA3-03-2 | Thiếu dữ liệu ⇒ `—`; KHÔNG có giá trị mặc định bịa | `pointNormalizer.test.ts` |
| REQ-PA3-03-3 | Point Modbus hiển thị bus/slave/exception/online do producer cấp | `pointNormalizer.test.ts` |
| REQ-PA3-03-4 | Lịch sử đọc từ historian thật; chưa bật ghi thì nói rõ là chưa bật | `MonitorPage.tsx` `PointHistoryPanel` |
| REQ-PA3-03-5 | Không có bộ đếm kích hoạt, lịch sử hay signal type bịa | `MonitorPage.test.tsx` |

### UC-04 — Ép tay / Nhả lệnh

| ID | Yêu cầu | Kiểm chứng |
|---|---|---|
| REQ-PA3-04-1 | `ttlS` do **Core** cưỡng chế; không có hẹn giờ ở FE hay ở web-api | `TestOverrideTTLIsOwnedByCore` |
| REQ-PA3-04-2 | Reload trình duyệt vẫn thấy đúng thời gian còn lại | `TestOverrideTTLIsOwnedByCore`, EV §3.3 |
| REQ-PA3-04-3 | Restart `mkddc-web` không làm mất override | `TestOverrideSurvivesWebAPIRestart`, EV §3.3 bước 4 |
| REQ-PA3-04-4 | Core im lặng ⇒ GIỮ trạng thái ép tay (fail-safe), không báo "đã nhả" | `TestOverrideKeptWhenCoreQueryFails` |
| REQ-PA3-04-5 | `ttlS` ngoài dải 1..86400 hoặc kèm `release` ⇒ 400 | `TestOverrideTTLRangeIsValidated` |
| REQ-PA3-04-6 | Xác nhận nêu object, giá trị hiện tại, giá trị mới, nguồn đang giữ, người thực hiện | `MonitorPage.tsx` dialog |
| REQ-PA3-04-7 | Không có bộ chọn priority | review checklist §24 |
| REQ-PA3-04-8 | Hai lệnh cạnh tranh: lệnh sau thắng, cả hai đều có vết audit | `TestConcurrentOverridesAreBothAudited` |

### UC-05 — Xử lý cảnh báo

| ID | Yêu cầu | Kiểm chứng |
|---|---|---|
| REQ-PA3-05-1 | Đúng 5 severity | `AlarmsPage.tsx` |
| REQ-PA3-05-2 | Viewer thấy action nhưng bị khoá kèm lý do | `AlarmRow.tsx`, `RequireRole.test.tsx` |
| REQ-PA3-05-3 | Backend vẫn là nơi chặn cuối | route table `RoleOperator` |

### UC-06 — Xu hướng

| ID | Yêu cầu | Kiểm chứng |
|---|---|---|
| REQ-PA3-06-1 | 1–8 series | `TrendsPage.tsx` (`slice(0, 8)`) |
| REQ-PA3-06-2 | Gap KHÔNG nối đường (`connectNulls=false`), và cũng đứt dải min–max | `TrendsPage.test.tsx`, `TrendChart.tsx` |
| REQ-PA3-06-3 | `complete=false` có cảnh báo rõ | `HistoryStateBanner` |
| REQ-PA3-06-4 | Có dải min–max khi dữ liệu aggregate; khoá kèm lý do khi dữ liệu không có min/max | `hasMinMaxBand`, `TrendsPage.tsx` |
| REQ-PA3-06-5 | Export CSV là action thứ cấp, xuất đúng khoảng đang xem | `TrendsPage.tsx` `csvHref` |

### UC-07 — Lịch vận hành

| ID | Yêu cầu | Kiểm chứng |
|---|---|---|
| REQ-PA3-07-1 | Viewer đọc/simulate, Operator enable/disable, Admin CRUD/publish/rollback | `RequireRole.test.tsx`, `SchedulerGridPage.tsx` |
| REQ-PA3-07-2 | Route không chặt hơn backend | `ROUTE_MIN_ROLE['/eng/scheduler'] === 'viewer'` |

### UC-08 — Chạy thử (Commissioning)

| ID | Yêu cầu | Kiểm chứng |
|---|---|---|
| REQ-PA3-08-1 | Kiểm điều kiện tiên quyết trước khi cho ghi; điều kiện chặn thì khoá nút | `CommissioningPage.tsx` |
| REQ-PA3-08-2 | Trạng thái đang chạy hiển thị được | `TestOutcomeRow` |
| REQ-PA3-08-3 | Kết quả GIỮ trên màn hình, không chỉ toast | `TestOutcomeRow` |
| REQ-PA3-08-4 | "Trả về tự động" là release, KHÔNG phải ghi 0 | `CommissioningPage.test.tsx` |
| REQ-PA3-08-5 | Có đường tới vết audit | `CommissioningPage.tsx` link `/activity` |

### UC-09 — Modbus RTU

| ID | Yêu cầu | Kiểm chứng |
|---|---|---|
| REQ-PA3-09-1 | Hierarchy Bus → Device → Point hiển thị được | `HierarchyTree.tsx`, `OverviewPage.test.tsx` |
| REQ-PA3-09-2 | Baud/parity/stop bits ở cấp **bus**, không lặp ở device | `HierarchyTree.tsx` |
| REQ-PA3-09-3 | Không có telemetry ⇒ device `unknown`, không phải `offline` | `HierarchyTree.tsx` `deviceState` |
| REQ-PA3-09-4 | Point Modbus drill-down sang Monitor chung | `HierarchyTree.tsx` |

### UC-10/11 — Cấu hình và Mạng

| ID | Yêu cầu | Kiểm chứng |
|---|---|---|
| REQ-PA3-10-1 | Bản nháp khác cấu hình đang chạy ⇒ hiện bảng khác biệt trước khi lưu | `NetworkCandidateDiff` |
| REQ-PA3-11-1 | Giữ nguyên `validate → stage → apply → confirm/rollback` | `e2e/network-qa.spec.ts` |
| REQ-PA3-11-2 | Sau apply có đếm ngược và đường rollback | `NetworkPage.tsx` |
| REQ-PA3-11-3 | Đổi IP ⇒ nói ra địa chỉ truy cập mới TRƯỚC khi người dùng confirm | `NetworkPage.tsx` |
| REQ-PA3-11-4 | Đọc `reasonCode` của response, không chỉ HTTP status | `e2e/network-qa.spec.ts` |

### UC-12 — Quản trị người dùng/hệ thống

| ID | Yêu cầu | Kiểm chứng |
|---|---|---|
| REQ-PA3-12-1 | Chỉ hiện chức năng có backend thật; không có OTA/reboot/restart service giả | rà source 2026-08-08, không có tham chiếu |

### Yêu cầu xuyên suốt

| ID | Yêu cầu | Kiểm chứng |
|---|---|---|
| REQ-PA3-X-1 | Mọi vết audit vào kho Activity truy vấn được, không chứa secret | `TestActivityRecordsPointCommandWithoutSecrets` |
| REQ-PA3-X-2 | Phân trang Activity ổn định, không trả trùng | `TestActivityPaginationIsStable` |
| REQ-PA3-X-3 | Drill-down dùng `(targetType, targetId)`; backend không cấp URL tuỳ ý | `drilldown.test.ts` |
| REQ-PA3-X-4 | Skip link là điểm dừng Tab đầu tiên | `e2e/pa3-dashboard.spec.ts` |
| REQ-PA3-X-5 | Command palette mở bằng `Ctrl/⌘+K`, đóng bằng `Escape` | `e2e/pa3-dashboard.spec.ts` |
| REQ-PA3-X-6 | Không cuộn ngang ở 390×844 | `e2e/pa3-dashboard.spec.ts` |
| REQ-PA3-X-7 | Viewer không mutation được ở cả FE lẫn BE | `TestViewerCannotOverride`, `RequireRole.test.tsx` |

---

## 3. Wireflow và nội dung tiếng Việt (PA3-006)

### 3.1 Luồng chính — desktop 1440×900

```text
LOGIN
  └─> LANDING  (/)
        │  dải trạng thái: tên bo · overall · kết nối · tuổi dữ liệu · CRIT/HIGH/MED
        │  health strip 5 ô ──────────► /diagnostics  |  /monitor?group=local
        │                                /eng/modbus-rtu | /settings/network | /trends
        │  CẦN XỬ LÝ ─────────────────► /alarms?alarm=<id>
        │                                /monitor?point=<id>
        │                                /eng/modbus-rtu/devices?q=<deviceId>
        │  TỔNG HỢP ĐIỂM ─────────────► /monitor?kind=<UI|AO|DO|virtual|modbus_rtu>
        │  KHÔNG GIAN CỦA TÔI ────────► /monitor?point=<id>
        │  XU HƯỚNG NHANH ────────────► /trends
        └─ HOẠT ĐỘNG ────────────────► /activity?objectId=<id>

MONITOR (/monitor)
  ├─ bộ lọc trong URL: ?kind= &quality= &state= &q= &point=
  ├─ bảng theo nhóm ──► chọn điểm ──► khung chi tiết bên phải
  │                                     ├─ chất lượng + lý do (nguyên văn producer)
  │                                     ├─ giá trị kỹ thuật + giá trị thô
  │                                     ├─ lịch sử 60 phút (historian thật)
  │                                     ├─ ÉP TAY ──► hộp thoại xác nhận ──► Core
  │                                     └─ vết audit ──► /activity?objectId=
  └─ Ctrl/⌘+K ──► command palette ──► mọi trang
```

### 3.2 Thứ tự ưu tiên trên mobile 390×844

Bộ breakpoint chuẩn (một bộ số duy nhất cho toàn sản phẩm) nằm ở
[`KX-DDC24-UX-SYSTEM-001` §4.1](../04_uiux/KX-DDC24-UX-SYSTEM-001_VI.md). Điều
quan trọng với mục này: **1024 px** là ngưỡng thanh bên ↔ ngăn kéo, nên 390×844
luôn nằm ở phía ngăn kéo.


1. Dải trạng thái tổng (luôn hiện)
2. Cần xử lý
3. Health strip (xếp dọc một cột)
4. Tổng hợp điểm (bảng cuộn ngang **trong khối của nó**, trang không cuộn ngang)
5. Không gian của tôi
6. Xu hướng nhanh
7. Hoạt động

Điều hướng qua ngăn kéo (nút ☰ ở TopBar), có bẫy tiêu điểm và đóng bằng Escape.

### 3.3 Nội dung tiếng Việt chuẩn

| Ngữ cảnh | Chuỗi chuẩn | Tránh |
|---|---|---|
| Không có dữ liệu | `—` | `0`, `N/A`, để trống |
| Không rõ trạng thái | `UNKNOWN` / `Chưa rõ` | `OK`, `Bình thường` |
| Mất liên lạc | `OFFLINE` / `Mất liên lạc` | `Lỗi` |
| Dữ liệu cũ | `STALE` / kèm tuổi dữ liệu | `Lỗi` |
| Ép tay | `ÉP TAY` kèm đếm ngược `mm:ss` | `Force` không kèm thời hạn |
| Nhả lệnh | `Trả về tự động` | `Release` (mơ hồ với "ghi 0") |
| Thiếu quyền | `Cần vai trò operator trở lên` | ẩn nút, hoặc `403` |
| Lỗi đọc | `Không đọc được <đối tượng>` + nút thử lại | bảng rỗng im lặng |

**Luật nội dung:** không dùng tên lệnh giao thức (`stage`, `apply`) làm nhãn nút
cho người vận hành; cơ chế an toàn được **giấu đi, không bỏ đi**.

---

## 4. Điều còn mở

Xem `PA3-N01..N04` trong [EV-WEB-PA3-001](../07_records/test-evidence/fw-som/2026-08-08-web-pa3-dashboard.md).
Đáng kể nhất là **PA3-N01**: PLC SHM chưa mang mốc thời gian lấy mẫu, nên
`REQ-PA3-01-4` mới đúng ở tầng frontend; backend vẫn đóng dấu thời điểm đọc.

## 5. Revision History

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.1 | 2026-08-18 | Đóng `F-DOC-03` của [`REV-FE-UIUX-UC-2026-08-18`](../07_records/reviews/FE_UIUX_UC_REVIEW_2026-08-18.md) (Plan 57 `T57-0.15`): §1.1 tự mâu thuẫn vì mang câu luật "bốn trạng thái … `unknown`" của thang `health.state` đặt nhầm vào thang `quality` — bảng `quality` và type `PointQuality` đều **không** có `unknown`. Câu luật được chuyển về §1.2 (đúng thang), §1.1 nói rõ `quality` có đúng năm giá trị và ghi lý do đổi. Theo quyết định **Q1** của `AUTH-WEBUX-2026-08-18-01`: **chỉ sửa tài liệu**, không đổi `PointQuality`. §3.2 dẫn chiếu bộ breakpoint chuẩn ở `UX-SYSTEM-001` §4.1 (`F-DOC-05`). |
| 1.0 | 2026-08-08 | Chuyển UX-REQ/UX-DES PA3 thành requirement có ID, chốt từ vựng và wireflow |
