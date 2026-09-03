# Plan 62 — Gỡ toàn diện `Project Settings` khỏi shell Programming

| Thuộc tính | Giá trị |
|---|---|
| ID | `PLAN-FE-SHELL-062` |
| Phiên bản | 1.0 |
| Trạng thái | **ĐÓNG — WP-01…WP-05 `DONE` 2026-09-03. `RELEASE_READY` KHÔNG đổi** |
| Ngày | 2026-09-03 |
| Chủ quản | FE Lead + System Architect |
| Người review | Product Owner, QA |
| Người phê duyệt | Product Owner/CTO + System Architect |
| Baseline As-Built | `main@6a380c8`; triển khai tại `main@25a1542` |
| Authority sản phẩm | [`UD-PROG-008`](../00_governance/PROGRAMMING_OPEN_DECISIONS.md) — *"Sáu workspace `PGM-01..06`"*, **CLOSED** theo `ADR-050.8` |
| Quan hệ Plan 60 | Sửa một sai lệch của `T60-101`/`T60-208` so với `UD-PROG-008`; **không** mở lại quyết định shell nào khác |
| Phạm vi | FE shell (`ProgrammingFeatureRail`, `ProgrammingMobileNav`) + test + tài liệu. **Không** động tới route, BE, contract, Core |

---

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| Plan này làm gì? | Gỡ mục thứ bảy `Project Settings` khỏi rail và bottom-nav, rồi **dựng cổng chặn** để không mục "đích không tồn tại" nào quay lại được. |
| Đây là gỡ tính năng? | **Không.** Không có route, không có trang, không có yêu cầu trong RTM. Gỡ một placeholder, và đưa code về đúng `UD-PROG-008` đã CLOSED. |
| Vì sao phải có plan chứ không sửa thẳng? | Nó chạm hợp đồng điều hướng (`ADR-032`) và sửa một task đã `DONE` của Plan 60, nên phải qua cổng tài liệu theo `DOC_GOVERNANCE`. |
| Rủi ro chính? | Rất thấp. Rủi ro thật duy nhất là gỡ UI mà bỏ sót dấu vết tài liệu, để mục này mọc lại ở đợt handoff sau. |
| Bằng chứng đóng plan? | `vitest` + `lint` + `build:release` + `verify-project.sh --component layout` xanh; cổng mới **đỏ** khi cố thêm lại một đích không có route. |

### 0.1 Kết luận

1. `Project Settings` là **mục thứ bảy** trong một shell mà quyết định đã đóng chỉ cho **sáu**.
2. Nó **chưa bao giờ tồn tại**: `ProgrammingRoutes` không khai route; FE render nó `aria-disabled` kèm lý do *"Chưa có trang Cài đặt Project ở bản dựng này"*.
3. Chỉ gỡ thôi là **chưa đủ**. Nguồn gốc của nó là dòng `6 đích + Project Settings` trong handoff Plan 60. Không sửa dòng đó và không có cổng máy kiểm, đợt handoff sau sẽ chép lại y nguyên.

---

## 1. Vì sao gỡ — bằng chứng, không phải ý kiến

| # | Bằng chứng | Nguồn |
|---|---|---|
| 1 | Quyết định canonical chốt **sáu** workspace `PGM-01..06`, trạng thái **CLOSED** | `PROGRAMMING_OPEN_DECISIONS.md` §`UD-PROG-008` → `ADR-050.8` |
| 2 | Bảng route canonical có **đúng 6 khoá**: `overview, programs, mapping, library, commission, runtime` | `ProgrammingRoutes.tsx:13-20` |
| 3 | Không có route nào cho `project-settings`; mọi path lạ rơi vào `<Route path="*">` → bật về Overview | `ProgrammingRoutes.tsx:59` |
| 4 | Không có yêu cầu/RTM nào tên `Project Settings` | rà `docs/01_requirements/`, `PROGRAMMING_TRACEABILITY_MATRIX.md` — **không kết quả** |
| 5 | Xuất xứ duy nhất là một dòng mô tả trong handoff Plan 60 | `60_..._PGM01_PLAN.md:229` — *"6 đích + Project Settings"* |
| 6 | Chính người viết đã biết nó không tồn tại và cố ý không bịa đích đến | chú thích tại `ProgrammingFeatureRail.tsx:58-62` |

**Kết luận:** đây không phải "cắt bớt tính năng". Đây là gỡ một placeholder đi lạc vào shell, và đưa code về khớp quyết định đã ký.

---

## 2. Kiểm kê dấu vết — **toàn bộ**

Rà bằng `grep -rn "project-settings|Project Settings|Cài đặt Project"` trên `apps/web-ui/src`, `docs/`, `contracts/`, `scripts/`, `e2e/`.

### 2.1 Mã nguồn (phải sửa)

| # | File | Dòng | Nội dung |
|---|---|---|---|
| A1 | `layout/ProgrammingFeatureRail.tsx` | 58–68 | mục `project-settings` + khối chú thích giải thích vì sao nó disabled |
| A2 | `layout/ProgrammingFeatureRail.tsx` | 40 | docstring *"Sáu đích canonical + `Project Settings`"* |
| A3 | `layout/ProgrammingFeatureRail.tsx` | import | `SlidersHorizontal` — **chỉ** dùng cho mục này trong file |
| A4 | `layout/ProgrammingMobileNav.tsx` | 58–69 | mục `project-settings` trong nhóm `more` + chú thích |
| A5 | `layout/ProgrammingMobileNav.tsx` | import | `SlidersHorizontal` — như trên |
| A6 | `overview/NeedsAttentionCard.tsx` | 36–37 | docstring dẫn `Project Settings` làm **ví dụ khuôn mẫu** cho "mục disabled kèm lý do" |

> A6 là bẫy dễ sót: nó không render gì, nhưng nó *dạy* khuôn mẫu sai cho người đọc sau. Thay ví dụ bằng ba đích phụ thuộc Project — khuôn mẫu đó vẫn đúng và vẫn còn trong code.

### 2.2 Test (phải sửa)

| # | File | Dòng | Nội dung |
|---|---|---|---|
| B1 | `ProgrammingFeatureRail.test.tsx` | 117–125 | cả test *"Project Settings hiện nhưng vô hiệu kèm lý do"* — **xoá** |
| B2 | `ProgrammingFeatureRail.test.tsx` | 107–108 | chú thích + `toHaveLength(7)` → **`6`** (6 đích + lối thoát, trừ đi mục vừa gỡ) |
| B3 | `ProgrammingMobileNav.test.tsx` | 130–135 | test `T60-208` cho mục này — **xoá** |

⚠️ B2 là chỗ dễ sai nhất: `7` hiện tại = 6 link đích + 1 link thương hiệu/lối thoát, **không** tính `project-settings` (nó là `<span>`). Phải đọc lại DOM khi sửa, **không** suy số.

### 2.3 Tài liệu (phải bổ chính, **không** viết lại lịch sử)

| # | File | Dòng | Xử lý |
|---|---|---|---|
| C1 | `60_..._PGM01_PLAN.md` | 229 | sơ đồ cây: `6 đích + Project Settings` → `6 đích` |
| C2 | `60_..._PGM01_PLAN.md` | 314 | mô tả `T60-101`: bỏ `+ Project Settings`, thêm ghi chú bổ chính dẫn `PLAN-FE-SHELL-062` |
| C3 | `CHANGELOG.md` | `[Unreleased]` | mục `Removed` |

> `T60-101` đang ở trạng thái `DONE`. **Không đổi trạng thái, không xoá dòng.** Thêm ghi chú bổ chính tại chỗ — đây là hồ sơ As-Built, và sửa lặng lẽ một task đã đóng là đúng loại trôi hồ sơ mà `DOC_GOVERNANCE` cấm.

### 2.4 Đã kiểm và **không** có dấu vết

`contracts/` · `scripts/*.py` (kể cả `check_ui_strings.py`) · `apps/web-ui/e2e/` · `docs/01_requirements/` · `PROGRAMMING_TRACEABILITY_MATRIX.md` · `NAV_GROUPS` (`ADR-032`).

⇒ **`ADR-032` không bị động tới.** Mục này chưa bao giờ nằm trong hợp đồng route↔menu toàn cục.

---

## 3. Gói công việc

| WP | Nội dung | Phụ thuộc | Ước lượng |
|---|---|---|---|
| **WP-01** | Cổng chống tái phát (§4) — **làm TRƯỚC**, phải **đỏ** trên mã hiện tại | — | `DONE` |
| **WP-02** | Gỡ A1–A5 khỏi rail + mobile nav | WP-01 | `DONE` |
| **WP-03** | Sửa B1–B3; sửa docstring A2, A6 | WP-02 | `DONE` |
| **WP-04** | Bổ chính tài liệu C1–C3 | WP-02 | `DONE` |
| **WP-05** | Chạy gate, deploy bo, kiểm chứng mắt trên bo thật | WP-01…04 | `DONE` |

**Thứ tự WP-01 trước WP-02 là bắt buộc.** Cổng phải được chứng minh là bắt được lỗi *khi lỗi còn đó*. Viết cổng sau khi đã gỡ thì không ai biết nó có kiểm gì không — đúng cái bẫy `st_language_profile_gate` đã dạy: một cổng luôn xanh có hai cách giải thích, và từ ngoài nhìn vào chúng giống hệt nhau.

---

## 4. Cổng chống tái phát — phần quan trọng nhất

Gỡ mục đi mà không dựng cổng thì đây chỉ là dọn dẹp một lần. Đợt handoff sau chép lại dòng `6 đích + Project Settings` là nó quay lại.

### 4.1 Bất biến cần khoá

> **Mọi mục điều hướng của shell Programming phải trỏ tới một đích CÓ THẬT.**
> Một mục chỉ được phép vô hiệu hoá vì **thiếu điều kiện** (chưa chọn Project),
> **không bao giờ** vì trang không tồn tại.

### 4.2 Vì sao khoá được bằng máy

`PROGRAMMING_WORKSPACE_PATHS` (`ProgrammingRoutes.tsx:13`) có **đúng 6 khoá**, và chúng **trùng khớp tuyệt đối** với 6 `key` hợp lệ của rail:

```
overview · programs · mapping · library · commission · runtime
```

Đây là một seam sẵn có, không phải bảng chép tay thứ hai. Cổng đọc thẳng bảng route và đối chiếu.

### 4.3 Ba phép kiểm

| # | Phép kiểm | Bắt được gì |
|---|---|---|
| G1 | Mọi `key` của `programmingRailItems()` ∈ `Object.keys(PROGRAMMING_WORKSPACE_PATHS)` | thêm bất kỳ đích nào không có route |
| G2 | Như G1 cho `ProgrammingMobileNav` (`primary` + `more`), trừ mục `exit` (`R60-03` — lối ra, cố ý không phải workspace) | cùng lỗi ở bottom-nav |
| G3 | Với `projectId` **khác null**, mọi mục phải có `to !== null` | mục vô hiệu vì "trang không tồn tại" — đúng hình dạng lỗi này |

G3 là phép kiểm sắc nhất: khi đã có Project, không còn lý do chính đáng nào để một mục vô hiệu. Mục nào vẫn `to === null` thì đích của nó không tồn tại.

### 4.4 Nghiệm thu cổng

- Chạy trên `main@6a380c8` (chưa gỡ) ⇒ G1 và G3 **phải đỏ**, nêu đúng `project-settings`.
- Chạy sau WP-02 ⇒ cả ba **xanh**.
- Ghi cả hai số đo vào thân commit của WP-01.

**Số đo thật (2026-09-03).** Trên baseline: **3 failed / 1 passed**, cả ba đều nêu đích danh
`project-settings` —

```
G1  rail có đích không khai trong PROGRAMMING_WORKSPACE_PATHS: project-settings
G2  bottom nav có đích không khai trong PROGRAMMING_WORKSPACE_PATHS: project-settings
G3  rail còn mục không có đích dù đã chọn Project: [ 'project-settings' ]
```

Phép kiểm thứ tư (*"vẫn cho phép vô hiệu khi CHƯA chọn Project"*) **xanh ngay trên baseline** — bằng
chứng cổng không kiểm quá tay, tức nó không cấm nhầm cơ chế `disabledReason` hợp lệ. Sau WP-02: **4/4
xanh**.

---

## 5. Không đổi

`ProgrammingRoutes` · `NAV_GROUPS`/`ADR-032` · mọi API BE · contract · Core/firmware · route `runtime` (đích duy nhất không phụ thuộc Project — giữ nguyên) · cơ chế `disabledReason` (vẫn dùng cho ba đích phụ thuộc Project).

---

## 6. Tiêu chí đóng

| # | Tiêu chí | Cách đo |
|---|---|---|
| E1 | Không còn kết quả nào cho `project-settings\|Project Settings\|Cài đặt Project` trong `apps/web-ui/src` | `grep -rn` |
| E2 | Trong `docs/`, chuỗi chỉ còn xuất hiện ở ghi chú bổ chính và plan này | `grep -rn` |
| E3 | Ba phép kiểm §4.3 xanh, và đã chứng minh đỏ trên baseline | log của WP-01 |
| E4 | `npx vitest --run --environment jsdom src` exit 0 | số đo thật |
| E5 | `npm run lint` + `npm run build:release` exit 0 | số đo thật |
| E6 | `scripts/verify-project.sh --component layout` exit 0 | số đo thật |
| E7 | Rail trên bo thật hiện **6 đích + lối thoát**, không mục xám nào | **ĐẠT** — xem §6.1 |
| E8 | `CHANGELOG.md` có mục `Removed` | diff |

### 6.1 Bằng chứng E7 — đo trên bo thật

Điều hướng bằng Playwright vào `http://mekong-fac.ddns.net:8082/eng/programming` sau khi đăng nhập
`admin`, đọc thẳng DOM của bo (2026-09-03 12:56):

```json
{
  "label": "Six Programming workspaces navigation (desktop)",
  "links": ["DDC24 Programming", "Overview", "Programs", "Points & Mapping",
            "Control Library", "Check & Commission", "Runtime & Service"],
  "disabledItems": []
}
```

- **7 phần tử `<a>`** = 6 đích + lối thoát — khớp đúng `toHaveLength(7)` mà §2.2/B2 cảnh báo không
  được sửa thành 6.
- **`disabledItems: []`** — không còn mục xám nào trên cả rail lẫn bottom nav.
- Ảnh: [`2026-09-03-plan62-rail-6-destinations.png`](../07_records/test-evidence/programming/2026-09-03-plan62-rail-6-destinations.png)

Ghi chú phụ thu được khi đo: phiên đăng nhập **không giữ qua một lần tải trang mới** — `goto` thẳng
`/eng/programming` bị bật về `/login`, phải điều hướng trong SPA. Đây là hiện trạng đã biết, **ngoài
phạm vi** plan này, không phải hồi quy của nó.

`RELEASE_READY` **không đổi** — plan này không chạm điều kiện phát hành.

---

## 7. Rủi ro

| # | Rủi ro | Mức | Giảm thiểu |
|---|---|---|---|
| R1 | Sai số link trong B2 (`7` → `6`) làm test xanh giả | **Trung bình** | Đọc lại DOM khi sửa, không suy số; test phải đỏ trước khi sửa component |
| R2 | Mục mọc lại ở đợt handoff sau | Trung bình | WP-01 (cổng) + C2 (bổ chính nguồn gốc) — hai lớp |
| R3 | Người dùng quen vị trí mục | **Thấp** | Nó chưa bao giờ bấm được |
| R4 | Sót dấu vết ngoài `apps/web-ui` | Thấp | §2.4 đã rà; E1/E2 kiểm lại lúc đóng |

---

## 8. Hoàn tác

Một commit `git revert` cho toàn bộ. Không migration, không đổi dữ liệu bền, không đổi contract ⇒ hoàn tác không để lại trạng thái lỡ dở. Không cần đụng tới bo: đây là thay đổi tĩnh trong `dist`.

---

## 9. Việc KHÔNG thuộc plan này

Câu hỏi lớn hơn — *"vì sao một DDC lại có nhiều Project"* — **không** giải quyết ở đây. Ghi lại để không bị nuốt mất:

| Mã | Nội dung | Trạng thái |
|---|---|---|
| `F-SHELL-01` | `projects.archived` **chỉ được đọc** (`WHERE archived=0`), không nơi nào ghi; trigger `projects_no_delete` chặn xoá cứng; không có route `DELETE`/archive ⇒ **project tạo ra không thể gỡ bằng bất kỳ đường nào sản phẩm cấp**. Trên bo `mekong-fac` ngày 2026-09-03: **18 project, 1 có `activeRevisionId`**, 17 còn lại là rác của các đợt test. | **MỞ** — lỗi thật, sửa được ngay, cần plan riêng |
| `F-SHELL-02` | `Controller 1──* Project` được khẳng định trong ER (`PROGRAMMING_DATA_MODEL.md` §2) mà **không có dòng biện minh nào** trong toàn bộ `docs/`; trong khi `Controller 1──1 RuntimeState` ⇒ chỉ một revision chạy được. Trục "nhiều Project" trùng lặp với Revision (snapshot bất biến + LKG/rollback) và Bundle export/import. | **MỞ** — đổi product model, cần Product Owner; `Product Spec V2.2 Hybrid` chưa ký |

---

## Lịch sử sửa đổi

| Phiên bản | Ngày | Nội dung | Người |
|---|---|---|---|
| 0.1 | 2026-09-03 | Dự thảo đầu tiên | FE Lead |
| 1.0 | 2026-09-03 | Triển khai WP-01…WP-05; ghi số đo nghiệm thu §4.4 và §6; đóng plan | FE Lead |
