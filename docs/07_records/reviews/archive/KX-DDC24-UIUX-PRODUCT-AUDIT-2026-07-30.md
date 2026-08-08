# BÁO CÁO ĐÁNH GIÁ SẢN PHẨM & THIẾT KẾ — WEB UI MK-DDC-24

> **HỒ SƠ LỊCH SỬ — lưu trữ 2026-08-08.** Không dùng làm nguồn chuẩn. Lý do lưu
> trữ và tài liệu thay thế: [`archive/README.md`](README.md). Mọi đường dẫn source
> trong tài liệu này theo cây thư mục **trước** `PLAN-ARCH-RESTRUCT-002`; bảng ánh
> xạ sang vị trí hiện tại ở [chỉ mục hồ sơ rà soát](../README.md).

| Hạng mục | Nội dung |
|---|---|
| Mã tài liệu | KX-DDC24-UIUX-PRODUCT-AUDIT-2026-07-30 |
| Ngày đánh giá | 30/07/2026 |
| Vai trò đánh giá | Senior Product Manager & Lead UI/UX Designer (độc lập) |
| Phạm vi | `src/frontend/` — 22 màn hình thực tế (brief yêu cầu 17) |
| Cơ sở kỹ thuật | React 18.3 + TypeScript 5.6 + Tailwind 4 + react-router 7 + Recharts 2.15 |
| Phương pháp | Đọc toàn bộ mã nguồn UI (13.710 dòng), tính tỷ lệ tương phản WCAG bằng công thức chính thức, chạy bộ test |
| Trạng thái test | `npx vitest --run --environment jsdom src` → **140 pass / 26 file**, 0 fail |
| Tiêu chuẩn áp dụng | Nielsen 10 Usability Heuristics · ISO 9241-11 · WCAG 2.2 AA · ISA-101 / ISA-18.2 (Industrial HMI) |

> **Ghi chú phương pháp:** Mọi con số tương phản trong báo cáo được tính từ giá trị token thật trong `src/frontend/src/styles.css` theo công thức relative luminance của WCAG, bao gồm cả việc blend nền tint `rgba()` lên nền cha. Mọi khẳng định về hành vi đều dẫn chiếu tới file:dòng cụ thể.

---

## PHẦN I: TÓM TẮT DÀNH CHO BAN GIÁM ĐỐC

### 1.1. Chỉ số sức khỏe sản phẩm (Product Usability Score)

**Điểm tổng quát: 3.5 / 10 — CHƯA SẴN SÀNG THƯƠNG MẠI HÓA**

Chấm điểm theo ba trục của ISO 9241-11:

| Trục ISO 9241-11 | Điểm | Căn cứ |
|---|---|---|
| **Effectiveness** (Hiệu năng — hoàn thành được việc?) | **3/10** | Nhiều luồng cốt lõi **không thể hoàn thành**: không đăng nhập được bằng tài khoản khác `admin`; quản lý người dùng không có chức năng nào hoạt động; trang Thiết bị bấm Lưu không ghi gì; trang Lập trình bị chặn khỏi bản live |
| **Efficiency** (Hiệu quả — nhanh và ít thao tác?) | **4/10** | Không có acknowledge hàng loạt; không sắp xếp được danh sách cảnh báo; không có navigation dưới 1024px; Scheduler không có lịch tuần/kéo-thả; đặt giờ phải tự gõ chuỗi RFC3339 |
| **Satisfaction & Trust** (Hài lòng và tin cậy) | **3/10** | UI **hiển thị dữ liệu bịa** ở nhiều nơi trọng yếu (thẻ thiết bị luôn "ONLINE", CPU/RAM/uptime có giá trị dự phòng giả, MAC và thời gian hệ thống hardcode). Với hệ thống điều khiển, mất tin cậy dữ liệu là lỗi nghiêm trọng nhất |
| **Accessibility** (WCAG 2.2 AA — phụ trục) | **3/10** | **13/14 biến thể StatusBadge không đạt** ngưỡng 4.5:1; viền điều khiển chỉ đạt 1.90:1 (yêu cầu 3.0:1); không có theme tối cho phòng máy |

**Điểm mạnh cần ghi nhận (nền móng tốt, không phải làm lại từ đầu):**

1. **Trang Mạng (`NetworkPage`)** — cơ chế giao dịch `Stage → Apply → Confirm → Rollback` kèm khóa đường quản trị (`managementPathReady`) và đồng bộ với authority là **thiết kế an toàn đúng đẳng cấp công nghiệp**. Đây là chuẩn mực nội bộ nên nhân rộng.
2. **`Modal.tsx`** — có focus trap hai chiều, xử lý `Escape`, trả focus về phần tử gọi, `aria-modal`. Đúng WCAG 2.1.2 / 2.4.3.
3. **Trang Thời gian (`TimeSettingsPage`)** — có regex validate RFC3339, `aria-invalid`, thông báo lỗi inline, và **modal xác nhận nêu rõ hậu quả** ("ảnh hưởng audit, lịch và timestamp lịch sử"). Là màn hình phòng ngừa lỗi tốt nhất trong sản phẩm.
4. **Vòng focus toàn cục** — `:focus-visible` với outline 2px màu accent đạt 5.04:1, vượt yêu cầu.
5. **Kiến trúc realtime** — có phân biệt dữ liệu stale qua `isFreshIso()` và banner cảnh báo mất WebSocket.

### 1.2. Top 5 lỗi nghiêm trọng nhất (Critical System Blockers)

---

#### 🔴 BLOCKER #1 — Giao diện hiển thị trạng thái thiết bị BỊA ĐẶT (vi phạm an toàn vận hành)

Đây là lỗi nghiêm trọng nhất của toàn sản phẩm, không phải lỗi thẩm mỹ mà là **lỗi an toàn**.

| Vị trí | Hành vi | Hệ quả |
|---|---|---|
| `DashboardPage.tsx:289-299` | `DeviceStatusCard()` **không nhận tham số nào**, luôn render vòng tròn xanh + chữ "ONLINE" + "Thiết bị hoạt động bình thường" | Thiết bị đã mất kết nối / lỗi vẫn báo "bình thường" |
| `DashboardPage.tsx:146` | `cpuPercent = h?.cpuPercent ?? 23` | API health lỗi → **bịa 23% CPU** |
| `DashboardPage.tsx:175` | `h?.ramPercent ?? 48` | Bịa 48% RAM |
| `DashboardPage.tsx:177` | `h?.uptimeS ?? 12*86400+4*3600+...` | Bịa uptime "12 ngày 04:32:18" |
| `DashboardPage.tsx:247-248` | MAC `00:0D:18:24:AC:01` và **thời gian hệ thống `23/05/2025 14:32:18` hardcode cứng** | Vận hành viên đọc được thời gian đóng băng từ 2025 |
| `LoginPage.tsx:41-44` | 4 badge `core / iobus / web / IOP` gán cứng `state="online"` | Báo toàn bộ service khỏe **trước khi xác thực**, không hề gọi API |
| `UserInfoPage.tsx:91-92` | IP `192.168.1.42` và "Lần đăng nhập gần nhất `2026-06-15 17:25:04`" hardcode | Thông tin phiên giả |

**Vi phạm:** Nielsen #1 (Visibility of system status — hiển thị trạng thái *sai* còn tệ hơn không hiển thị); ISA-101 (nguyên tắc "chỉ trình bày dữ liệu có nguồn xác thực"); ISO 9241-11 trục Trust.

**Tác động thương mại:** Đây là rào cản chặn nghiệm thu. Không một chủ đầu tư hay đơn vị tư vấn nào chấp nhận HMI báo "bình thường" khi controller đã chết. Rủi ro trách nhiệm pháp lý nếu xảy ra sự cố thiết bị.

---

#### 🔴 BLOCKER #2 — Nút "Test" trong Chạy thử tác động vật lý ngay, KHÔNG có xác nhận

`CommissioningPage.tsx:39` — toàn trang chỉ có 43 dòng:

```tsx
<Button ... onClick={() => test(point, point.kind === 'DO' ? true : 50)}>Test</Button>
<Button ... onClick={() => test(point, point.kind === 'DO' ? false : 0)}>Release</Button>
```

Bốn khiếm khuyết chồng lên nhau:

1. **Không có dialog xác nhận.** Một cú click đơn → ghi ngay 50% ra AO hoặc ON ra DO → **van/damper/quạt thật chuyển động trong tòa nhà đang vận hành**. Vi phạm trực diện Nielsen #5 (Error prevention) và nguyên tắc Manual Override của ISA-101.
2. **Giá trị bị hardcode 50%.** Không thể chạy thử 0/25/75/100% — vô hiệu hóa mục đích của công đoạn commissioning.
3. **Nhãn "Release" gây hiểu sai chết người.** Nút này *ghi giá trị 0/false*, không phải *giải phóng override về điều khiển tự động*. Trong ngành DDC đây là hai khái niệm khác nhau căn bản: kỹ thuật viên tưởng đã trả quyền cho chương trình, thực tế đã **ép thiết bị về trạng thái tắt**.
4. **Không có nút "Release All".** Sau một phiên chạy thử với 8 output đang bị ép, không có cách nào giải phóng toàn bộ trong một hành động.

Thêm nữa, `useApi(apiClient.getPoints, [])` không có `refreshMs` → sau khi ép, giá trị live không tự cập nhật; và **không có nhánh xử lý lỗi** (`state.error` không được kiểm tra) → API lỗi thì trang hiện panel trống không thông báo gì.

---

#### 🔴 BLOCKER #3 — Không có gate quyền cho các hành động tác động vật lý; đăng nhập chỉ chấp nhận `admin`

**3a. RBAC bị đảo ngược ưu tiên.** Toàn bộ ứng dụng chỉ có **một** route được bảo vệ:

```tsx
// App.tsx:63 — route DUY NHẤT có gate
<Route path="settings/network" element={<RequireAdmin><NetworkPage /></RequireAdmin>} />
```

Trong khi đó **không có gate** cho: `eng/commissioning` (tác động vật lý ra output), `eng/outputs` (manual force), `monitor` (force point), `eng/inputs`, `eng/virtual-points`, `eng/alarm-settings`, `eng/scheduler`, `settings/users`, `settings/time`.

Nghịch lý: cấu hình *ghi log* được gate theo admin (`PointLoggingDialog.tsx:108`), còn **ép output vật lý thì bất kỳ role nào — kể cả `viewer` — đều làm được**.

**3b. Trang đăng nhập khóa cứng username.** `LoginPage.tsx:57`:

```tsx
<input ... value="admin" readOnly aria-label={t('username')} />
```

Hàm `login(password)` chỉ nhận mật khẩu. Hệ quả: **hệ thống RBAC 4 vai trò ở backend hoàn toàn không thể sử dụng qua Web UI** — không ai ngoài `admin` đăng nhập được. Đây vừa là blocker chức năng, vừa triệt tiêu giá trị của toàn bộ công việc RBAC đã làm.

**3c. Ba nút "chết" trên trang đăng nhập.** `SSO / AD` (`LoginPage.tsx:75`), `Quên mật khẩu?` (dòng 70), checkbox `Ghi nhớ đăng nhập` (dòng 69) — đều không có `onClick`/`onChange`. Icon `Eye` (dòng 65) trông như nút hiện mật khẩu nhưng là `aria-hidden` trang trí. Bốn affordance lừa dối trên màn hình đầu tiên khách hàng nhìn thấy → phá hủy ấn tượng chất lượng ngay giây thứ nhất.

---

#### 🔴 BLOCKER #4 — Hệ màu trạng thái không đạt WCAG AA và không có theme tối cho phòng máy

Toàn bộ số liệu dưới đây tính từ token thật, nền badge đã blend đúng tỷ lệ alpha:

**Bảng A — Text StatusBadge trên nền tint của chính nó** (font 11px bold → ngưỡng AA là **4.5:1**):

| Trạng thái | Màu chữ | Nền badge | Trên `--c-surface` | Trên `--c-bg` | Kết luận |
|---|---|---|---|---|---|
| good / ON / OK | `#1E7A3D` | `#C4D4CE` | **3.50** ❌ | **3.06** ❌ | Fail cả hai |
| off / OFF | `#6B7280` | `#CBCED3` | **3.06** ❌ | **2.67** ❌ | Fail cả hai |
| warn / STALE | `#6B5400` | `#DBD3B2` | 4.83 ✅ | **4.27** ❌ | Fail trên `--c-bg` |
| **fault / ALARM** | `#B01219` | `#D8C5C8` | **4.32** ❌ | **3.74** ❌ | **Fail — đây là badge CẢNH BÁO** |
| critical | `#B0179C` | `#D3C3D6` | **3.64** ❌ | **3.17** ❌ | Fail cả hai |
| force / FORCED | `#8A4FBF` | `#CFCADA` | **3.32** ❌ | **2.89** ❌ | Fail cả hai |
| demo | `#2A5C8A` | `#C7CED6` | **4.41** ❌ | **3.84** ❌ | Fail cả hai |

→ **13 trên 14 tổ hợp không đạt.** Badge `ALARM` — thành phần quan trọng nhất của một HMI — chỉ đạt 3.74:1.

**Bảng B — Các vi phạm WCAG 1.4.11 Non-text Contrast (ngưỡng 3.0:1):**

| Thành phần | Giá trị | Đo được | Ảnh hưởng |
|---|---|---|---|
| `--c-border` `#9AA0A6` — viền **mọi** input/select/panel | vs `--c-bg` | **1.64** ❌ | Toàn bộ trường nhập liệu không nhìn rõ ranh giới |
| `--c-border` | vs `--c-surface` | **1.90** ❌ | |
| Viền chip `TRIP` dùng `--c-warn` `#E8B500` | vs surface | **1.37** ❌ | `AlarmRow.tsx:37` |
| `--c-warn` `#E8B500` nếu dùng làm chữ | vs bg | **1.18** ❌ | Màu cảnh báo gần như vô hình trên nền sáng |

**Bảng C — Lỗi kỹ thuật cụ thể — badge số cảnh báo trên TopBar thiếu màu chữ:**

`TopBar.tsx:36` không set `text-white` (khác với `NavRail.tsx:121` có set):

| Thành phần | Tổ hợp | Tương phản |
|---|---|---|
| NavRail badge (đúng) | `#FFFFFF` trên `#D5202A` | 5.16 ✅ |
| **TopBar badge (lỗi)** | kế thừa `--c-text` `#1C1F23` trên `#D5202A` | **3.21** ❌ |

**Bảng D — Class `.stale` phá hỏng tương phản đúng lúc nguy hiểm nhất.** `styles.css:57` đặt `opacity: 0.62`. Khi dữ liệu đã stale (tức là lúc vận hành viên *cần đọc kỹ nhất*):

| Nội dung | Sau khi giảm opacity | Tương phản |
|---|---|---|
| `--c-text` | `#63666A` | 4.15 ❌ |
| `--c-text-dim` | `#808489` | **2.71** ❌ |
| `--c-fault` | `#D6676E` | **2.51** ❌ |
| `--c-warn` | `#E2C354` | **1.24** ❌ |

**Bảng E — Không có theme tối.** `styles.css:26` khai báo `color-scheme: light` và **không có bất kỳ khối `@media (prefers-color-scheme: dark)` hay `[data-theme]` nào**. Trang Hiển thị chỉ *mô tả* theme, không cho đổi (`DisplaySettingsPage.tsx:57-65` — panel "Theme" là văn bản tĩnh, ghi "Level B hybrid cố định theo ADR-009").

Độ chói nền hiện tại: `--c-bg` = **60.0%**, `--c-surface` = **70.5%**. Trong phòng máy/tủ điều khiển tối, màn hình 70% luminance gây lóa, mất khả năng thích nghi tối (dark adaptation) của mắt và mỏi mắt nghiêm trọng trong ca trực 8-12 giờ. Đây là yêu cầu bắt buộc của ISA-101 cho môi trường control room.

**Bảng F — Kích thước touch target.** Thống kê toàn bộ mã UI:

| Chiều cao | Số lần dùng | Đánh giá |
|---|---|---|
| `h-8` = 32px | 15 | Đạt WCAG 2.5.8 AA (24px), **không đạt** 44px cho HMI cảm ứng |
| `h-9` = 36px | 10 | Như trên |
| `h-10` = 40px | 46 | Như trên |
| `h-11`/`h-12` ≥ 44px | **chỉ 6** | Đạt |
| Nút thu gọn sidebar `h-6 w-6` = 24px | 1 | Đúng sát ngưỡng tối thiểu tuyệt đối |

> **Hiệu chỉnh tiêu chuẩn (quan trọng cho tính chính xác của báo cáo):** Ngưỡng 44×44px mà brief nêu **không phải** WCAG 2.2 mức AA. Chính xác là: WCAG 2.2 **SC 2.5.8 Target Size (Minimum), mức AA = 24×24px**; còn **44×44px là SC 2.5.5 Target Size (Enhanced), mức AAA**. 44×44px cũng là khuyến nghị của Apple HIG và là con số phù hợp với HMI cảm ứng công nghiệp (vận hành có thể đeo găng tay). Báo cáo này giữ mục tiêu 44×44px nhưng ghi rõ đó là mức **AAA / thực hành tốt HMI**, không phải nghĩa vụ AA — để tránh bên phát triển bị dẫn dắt sai khi lập kế hoạch tuân thủ.

**Bảng G — Cỡ chữ.** `text-[9px]`: 1 lần; `text-[10px]`: 19 lần; `text-[11px]`: 12 lần; `text-xs` (12px): 231 lần. Đáng chú ý: **số lượng cảnh báo đang hoạt động** được render ở `text-[9px]` khi sidebar thu gọn (`NavRail.tsx:122`) — chữ 9px cho thông tin quan trọng nhất của HMI.

**Bảng H — Màu ngữ nghĩa bị tái sử dụng làm màu chuỗi dữ liệu.** `TrendsPage.tsx:39`:

```tsx
const colors = ['#2A5C8A', 'var(--c-warn-fg)', '#6E5A2E', '#8A4FBF', '#5B6066', 'var(--c-fault-fg)', '#B0179C', 'var(--c-off)']
```

Chuỗi trend thứ 2 mang màu **cảnh báo**, thứ 6 mang màu **lỗi**, thứ 4 mang màu **force**. Vi phạm nguyên tắc nền tảng của ISA-101: màu ngữ nghĩa chỉ được dùng cho ngữ nghĩa đó. Vận hành viên nhìn đường đỏ trên biểu đồ sẽ hiểu sai là điểm đang lỗi.

---

#### 🔴 BLOCKER #5 — Trang Lập trình tự redirect âm thầm; mất hoàn toàn navigation dưới 1024px

**5a. Redirect âm thầm không giải thích.** `App.tsx:66`:

```tsx
<Route path="eng/programming" element={LEGACY_GRAPH_DEMO_ENABLED ? <ProgrammingPage /> : <Navigate to="/" replace />} />
```

Với `config.ts:6-9`, `LEGACY_GRAPH_DEMO_ENABLED` chỉ `true` khi **đồng thời** ở chế độ `demo` **và** cờ `VITE_ENABLE_LEGACY_GRAPH_DEMO === '1'`. Nghĩa là **trong mọi bản build `live` (bản giao khách), truy cập `/eng/programming` sẽ bị đẩy về Dashboard mà không một dòng thông báo nào**. Người dùng bookmark link, hoặc làm theo tài liệu hướng dẫn, sẽ thấy trang "nhảy" về trang chủ và không hiểu vì sao. Vi phạm Nielsen #1 (Visibility) và #9 (Help users recognize, diagnose, recover from errors).

Route `/validator` (dòng 79) cũng redirect tương tự, hai lớp chồng nhau.

**5b. Bản thân trang Lập trình không phải công cụ lập trình.** `ProgrammingPage.tsx` là **danh sách thư viện + JSON mẫu hardcode** (`sampleGraph` với `name: 'AHU01_DDC'`, `author: 'demo'`). Không có canvas, không có nối dây trực quan, và **grep toàn bộ mã nguồn không tìm thấy `draggable`/`onDrag`/`DragEvent` ở bất kỳ đâu** — không hề có kéo-thả trong toàn sản phẩm. Nhãn khối là identifier nội bộ thô: `UI_Input`, `AO_Output`, `Modbus_Read`, `OnDelay`, `OffDelay`, `AlarmDelay`, `RuntimeCounter`, `PulseCounter` — tiếng Anh 100%, mô tả cũng tiếng Anh ("Boolean AND.", "Safety permissive gate.").

**5c. Mất toàn bộ navigation trên tablet.** `NavRail.tsx:67-70` khai báo `hidden ... lg:flex`, và `AppShell.tsx` **không có hamburger, không có drawer, không có nav thay thế nào**. Grep `lg:hidden|md:hidden|drawer|MobileNav` trong `components/` trả về **rỗng**.

→ Dưới 1024px (toàn bộ tablet dọc, panel HMI 7-10", điện thoại), người dùng **chỉ còn 3 icon trên TopBar** (Cảnh báo / Trợ giúp / Người dùng) và **không có cách nào tới 14 trang còn lại**. Với sản phẩm HMI công nghiệp thường vận hành trên tablet gắn tủ, đây là lỗi chặn triển khai.

---

### 1.3. Bảng tổng hợp mức độ

| Mức | Số lượng | Nhóm vấn đề tiêu biểu |
|---|---|---|
| 🔴 Blocker | 5 | Dữ liệu bịa · Force không xác nhận · RBAC/login · WCAG màu & theme tối · Redirect âm thầm & mất nav mobile |
| 🟠 Nghiêm trọng | 14 | Không validate IP · Thiếu i18n diện rộng · Nút chết · Save giả · Không sort/ack hàng loạt · Không có âm báo cảnh báo |
| 🟡 Trung bình | 21 | Cỡ chữ nhỏ · Touch target · Thuật ngữ nội bộ lộ ra UI · Trang mồ côi |
| 🔵 Nhỏ | 9 | Padding · Nhãn không nhất quán · Màu off-token |

---

## PHẦN II: PHÂN TÍCH CHI TIẾT HIỆN TRẠNG TỪNG MÀN HÌNH

### 2.1. Trang Đăng nhập — `LoginPage.tsx` (85 dòng)

**Hiện trạng & Bố cục.** Centered Card Layout, `max-w-md`, canh giữa toàn màn hình. Thứ tự khối: logo chữ "DDC 24" → tiêu đề → **grid 2×2 badge service** → **`<dl>` thông tin thiết bị** → form (username readOnly, password, remember/forgot) → nút chính → 2 nút phụ (`SSO / AD`, `Vào demo`) → banner cảnh báo mật khẩu mặc định.

**Ưu điểm.**
- Phân cấp thị giác rõ, khoảng thở tốt (`p-7`, `space-y-4`).
- `autoFocus` đúng vào ô mật khẩu — ô duy nhất thực sự nhập được.
- Banner nhắc đổi mật khẩu mặc định là ý thức bảo mật đáng khen, và là **một trong ít chuỗi được dịch song ngữ đầy đủ, có đủ dấu**.
- Có `aria-label` trên cả hai input.

**Nhược điểm.**

| # | Vấn đề | Vi phạm |
|---|---|---|
| L1 | Username `value="admin" readOnly` → **không đăng nhập được bằng tài khoản khác** (dòng 57) | Nielsen #7 (Flexibility); chặn chức năng |
| L2 | 4 badge service gán cứng `state="online"`, không gọi API, hiển thị **trước khi xác thực** (dòng 41-44) | Nielsen #1 — trạng thái sai |
| L3 | Nút `SSO / AD` không có `onClick` (dòng 75) | Nielsen #1 |
| L4 | `Quên mật khẩu?` không có `onClick` (dòng 70) | Nielsen #1 |
| L5 | Checkbox `Ghi nhớ đăng nhập` không có state/`onChange` (dòng 69) | Nielsen #1 |
| L6 | Icon `Eye` trông như nút hiện mật khẩu nhưng là `aria-hidden` trang trí (dòng 65) | Affordance lừa dối |
| L7 | **Không có bộ đổi ngôn ngữ trên trang này**, mà mặc định i18n là `'en'` (`i18n.tsx:399`) → vận hành viên Việt Nam mở lần đầu thấy **"Welcome Back"** và không có cách nào chuyển sang tiếng Việt trước khi đăng nhập | Nielsen #2, #7 |
| L8 | Lộ Model / IP / BACnet ID / Firmware **khi chưa xác thực** (dòng 46-51) | Information disclosure |
| L9 | Thiếu `autoComplete`, không báo Caps Lock, không phản hồi số lần sai/khóa tài khoản | ISO 9241-11 Satisfaction |
| L10 | Banner dùng màu thô `rgba(224,161,6,...)` thay vì token `--c-warn` (dòng 79) | Nhất quán hệ thống |
| L11 | Fallback lỗi `'Login failed'` hardcode tiếng Anh (dòng 26) | Localization |

**Localization.** `t('loginTitle')`, `t('loginSub')` có bản `vi` đầy đủ dấu — tốt. Nhưng nhãn `Model` / `IP` / `BACnet ID` / `Firmware` / `SSO / AD` hardcode tiếng Anh. Vì mặc định ngôn ngữ là `en` và trang không có nút đổi, **thực tế người Việt luôn thấy trang này bằng tiếng Anh**.

---

### 2.2. Bảng điều khiển — `DashboardPage.tsx` (450 dòng)

**Hiện trạng & Bố cục.** Dense Card Grid nhiều tầng: hàng 6 thẻ KPI (`xl:grid-cols-6`) → panel Truyền thông (6 tile) → panel Services + IOP metrics → grid 2 cột `[1.35fr_0.9fr]` (Controller Diagram | Point Trend) → grid `[1.2fr_0.8fr]` (Sự kiện gần nhất | Thông tin thiết bị).

**Ưu điểm.**
- Mật độ thông tin cao đúng tinh thần HMI công nghiệp; đọc được nhiều trạng thái trong một lần nhìn.
- `MiniDial` dùng `conic-gradient` nhẹ, không cần thư viện chart — tốt cho thiết bị nhúng.
- Có cơ chế phân biệt dữ liệu stale qua `isFreshIso(realtime.lastPointEventAt, 2500)`.
- Modal chọn điểm trend có `aria-live="polite"` cho bộ đếm `n/4` và lưu preference vào `localStorage` với try/catch đúng cách.

**Nhược điểm.**

| # | Vấn đề | Vi phạm |
|---|---|---|
| D1 | `DeviceStatusCard` luôn "ONLINE" (xem Blocker #1) | Nielsen #1 |
| D2 | Giá trị dự phòng bịa: CPU 23%, RAM 48%, uptime 12 ngày | Nielsen #1 |
| D3 | MAC, Model `DDC24-AC`, **thời gian hệ thống `23/05/2025 14:32:18`**, vị trí, mô tả — hardcode (dòng 243-250) | Nielsen #1 |
| D4 | **Hai hệ phân loại mức độ cảnh báo xung đột trên cùng một trang**: `AlarmStatusCard` gộp high+medium+low thành "Warning"; còn `SeverityPill` (dòng 410) map high→WARNING, medium/low/info→INFO | Nielsen #4 |
| D5 | Tile `RS485-2` và `Modbus TCP` gán cứng `status="unknown"` → vĩnh viễn N/A (dòng 184-185) | UI chết |
| D6 | Nút `Live` không có `onClick` (dòng 207) | Nielsen #1 |
| D7 | `MiniDial` không có `role="meter"`/`aria-valuenow` | WCAG 1.3.1, 4.1.2 |
| D8 | Ba vòng poll HTTP 1000ms song song (health + points + alarms) **cộng thêm** WebSocket, trên SoM ARM nhúng | ISO 9241-11 Efficiency |
| D9 | `setTrendSamples([])` mỗi lần đổi lựa chọn điểm (dòng 121-123) → **mất toàn bộ lịch sử biểu đồ**; buffer chỉ 60 mẫu = 1 phút | Nielsen #5 |
| D10 | `<span className="sr-only">` mồ côi giữa grid, không gắn với thành phần nào (dòng 438) | A11y sai thực hành |
| D11 | Không có `aria-live` cho biến động số lượng cảnh báo | WCAG 4.1.3 |
| D12 | Màu thô `#6E5A2E` lẫn trong mảng token (dòng 33) | Nhất quán |

**Localization.** Trộn ngôn ngữ nặng **trong cùng một khung nhìn**: tiêu đề tiếng Việt có dấu (`TRẠNG THÁI TRUYỀN THÔNG`, `XU HƯỚNG POINT`, `SỰ KIỆN GẦN NHẤT`, `BỘ NHỚ`, `NHIỆT ĐỘ`) đứng cạnh tiêu đề Anh không dịch (`CPU LOAD`, `UPTIME`, `SERVICES`, `IOP / SCAN METRICS`, `Controller Diagram`). Ba lời gọi `pick()` vô nghĩa vì hai nhánh giống nhau: `pick('Controller Diagram','Controller Diagram')`, `pick('Open','Open')`, `pick('Live','Live')`. Nhãn `Model`/`Firmware`/`Serial`/`MAC Address` không dịch. `formatDateTime` và `toLocaleTimeString('vi-VN')` **bỏ qua `locale` của i18n** → ở chế độ English, ngày giờ vẫn định dạng Việt Nam.

---

### 2.3. Giám sát trực tiếp — `MonitorPage.tsx` (868 dòng)

**Hiện trạng & Bố cục.** Master-Detail (Split View): cột trái danh sách điểm nhóm theo UI / DO / AO / Virtual với thanh lọc (kind, quality, tìm kiếm); cột phải chi tiết điểm đang chọn + modal Force + modal chi tiết điểm.

**Ưu điểm.**
- Gộp dữ liệu polling và WebSocket có kiểm tra tươi (`isFreshIso` + `mergePointsById`), giữ tên điểm khi cập nhật chỉ có nhãn generic (`isGenericPointLabel`).
- **Phân biệt đúng "Write" cho Virtual Point và "Force" cho AO/DO** (dòng 393) — hiểu đúng nghiệp vụ DDC, đáng khen.
- Có validate tag/tên điểm với `role="alert"` và liên kết `aria-describedby` (dòng 586, 591).
- Có phát hiện xung đột tên điểm (`pointNameConflicts` + `PointNameConflictNotice`).
- Force có tham số thời hạn (`forceDurationMinutes`, mặc định 10 phút) — đúng thực hành công nghiệp.

**Nhược điểm.**

| # | Vấn đề | Vi phạm |
|---|---|---|
| M1 | **Click vào biểu đồ Sparkline mở dialog Force** — `dòng 471`: `<span onClick={... onForce(point)}>` bọc quanh Sparkline. Một đồ thị trông như thành phần chỉ-đọc lại là cò súng mở lệnh ép output | Nielsen #5; **WCAG 2.1.1** (span không tiếp cận được bằng bàn phím), **4.1.2** (không có role/name) |
| M2 | Ô nhập giá trị Force là `<input>` text trơn, **không `min`/`max`/`step` theo dải kỹ thuật của điểm**, không hiện đơn vị; chỉ validate khi submit và ném lỗi tiếng Anh (`'Force value must be a number'`, dòng 92) | Nielsen #5 |
| M3 | Modal Force không nêu **hậu quả vật lý** (thiết bị nào sẽ chuyển động), không hiện thời điểm hết hạn force | ISA-101 Manual Override |
| M4 | Không có gate quyền — `viewer` ép được output (xem Blocker #3) | Bảo mật |
| M5 | Nút `Lưu ghi chú` / `Save note` **không có `onClick`** (dòng 855) → textarea ghi chú không bao giờ được lưu | Nielsen #1 |
| M6 | Không có nút "Release All" cho các điểm đang bị force | Efficiency |

**Localization.** Cảnh báo an toàn quan trọng nhất của trang lại **không được dịch**: `pick('Force uses the duration below. Use only for commissioning or controlled troubleshooting.', <chuỗi tiếng Anh y hệt>)` (dòng 397) — cả hai nhánh đều tiếng Anh. Tương tự `pick('Force duration (minutes)', 'Force duration (minutes)')` (dòng 400), toast `Force sent to X` (dòng 208, 221). Tiêu đề section `AO - ANALOG OUTPUT`, `VIRTUAL POINTS` hardcode tiếng Anh. Ba thông báo lỗi validate ném ra bằng tiếng Anh thuần.

---

### 2.4. Hệ thống Cảnh báo — `AlarmsPage.tsx` (371 dòng, gồm cả Alarm History)

Đây là màn hình **quan trọng nhất về an toàn** và cũng là màn hình **bị lỗi địa phương hóa nặng nhất**.

**Hiện trạng & Bố cục.** Filter + List: hàng 4 thẻ Summary → panel bộ lọc (6 nút trạng thái kèm số đếm + ô tìm kiếm + nút xóa lọc) → danh sách `AlarmRow` → panel Lịch sử cảnh báo (6 trường lọc + 7 checkbox sự kiện + select trạng thái). Trang `/alarms/history` dùng lại cùng panel ở chế độ `full`.

**Ưu điểm.**
- Bộ lọc có số đếm trực tiếp trên nút — phản hồi tốt, giảm tải nhận thức.
- Có dialog xác nhận cho ack/suppress kèm chọn thời hạn (60s→20m/permanent/custom).
- Lịch sử cảnh báo có bộ lọc phong phú (text, alarm, name, from/to, event, severity, status) và tự làm mới qua event `mkddc:alarms-updated`.
- Ghi nhận cả người thực hiện (`ackedBy`) và thời điểm đóng — tốt cho truy vết.

**Nhược điểm.**

| # | Vấn đề | Vi phạm |
|---|---|---|
| A1 | **Nhãn nút "Off" để chặn cảnh báo** (`AlarmRow.tsx:48`) — trong ngữ cảnh DDC, "Off" đọc thành "tắt thiết bị", thực tế là suppress cảnh báo. Nhầm lẫn cực nguy hiểm | Nielsen #2 |
| A2 | **Không sắp xếp được danh sách** theo thời gian/mức độ; `historyRows` chỉ `[...history].reverse()` (dòng 162) | **ISA-18.2** yêu cầu sắp theo priority |
| A3 | **Không có âm báo/annunciation** cho cảnh báo mới ở bất kỳ đâu trong sản phẩm | ISA-18.2 |
| A4 | **Không có `aria-live`** cho cảnh báo mới → người dùng screen reader và cả người đang xem trang khác không được thông báo | WCAG 4.1.3 |
| A5 | **Không có acknowledge hàng loạt** — 50 cảnh báo phải ack 50 lần, mỗi lần qua một dialog | ISO 9241-11 Efficiency |
| A6 | `limit: 'all'` ở chế độ full (dòng 250) **không phân trang** → có thể render hàng chục nghìn dòng, treo trình duyệt nhúng | Efficiency |
| A7 | Mức độ bị gộp mất thông tin: critical và high **cùng** hiện badge `fault`; low và info **cùng** hiện badge `ok` → **cảnh báo `INFO` hiện badge MÀU XANH**, trong HMI công nghiệp xanh nghĩa là bình thường (dòng 321, và `AlarmRow.tsx:23`) | Nielsen #4, ISA-18.2 |
| A8 | 7 checkbox sự kiện phơi thẳng **enum snake_case của database**: `setting_created`, `setting_changed`, `setting_deleted` (dòng 20) | Nielsen #2 |
| A9 | Không xuất được CSV/Excel lịch sử cảnh báo | Nghiệp vụ nghiệm thu |
| A10 | 5 nút icon-only thiếu `aria-label` (dòng 105, 143, 186, 190, 217) | WCAG 4.1.2 |
| A11 | Nút Back của trang History ghi `pick('Alarm log','Alarm log')` — hai nhánh giống nhau, và không khớp tên trang | Nhất quán |
| A12 | Poll HTTP 2000ms dù đã có WebSocket | Efficiency |

**`AlarmDurationDialog` — dialog an toàn nhưng kém hơn `Modal` chuẩn của chính dự án:**

| # | Vấn đề | Vi phạm |
|---|---|---|
| A13 | **Không có focus trap, không xử lý `Escape`, không trả focus** — trong khi `Modal.tsx` đã làm đủ cả ba | WCAG 2.1.2, 2.4.3; Nielsen #4 |
| A14 | **100% hardcode tiếng Anh**: "Ack alarm"/"Off alarm", "Duration", "Minutes", "Cancel", `1m`…`20m`, `Permanent`, `Custom` | Localization |
| A15 | Mặc định chọn sẵn **suppress 5 phút** (`useState('300')`), không hiển thị thời điểm hết hiệu lực tương ứng | Nielsen #5 |
| A16 | `min={1}` nhưng **không có `max`** → có thể nhập 999999 phút (≈ 2 năm) chặn cảnh báo | Nielsen #5 |
| A17 | Không có trường lý do/ghi chú cho hành động suppress | Yêu cầu truy vết |
| A18 | Click ra ngoài backdrop (`onMouseDown={onCancel}`) hủy im lặng | Nielsen #5 |

**Localization — nghiêm trọng nhất toàn sản phẩm.** Trang này là ổ dịch của lỗi **thiếu dấu tiếng Việt**. Trích nguyên văn từ mã nguồn:

> `'Canh bao'` · `'Theo doi, loc va acknowledge canh bao'` · `'Dang active'` · `'Chua acknowledge'` · `'Dang hien thi'` · `'Dang tai alarm'` · `'Khong tai duoc alarm'` · `'Tim kiem alarm...'` · `'Xoa loc'` · `'Khong co alarm phu hop'` · `'Lich su alarm'` · `'Toan bo ban ghi alarm'` · `'20 ban ghi moi nhat khop bo loc'` · `'Mo toan bo'` · `'Tai lai'` · `'Chua co lich su alarm'` · `'Dang tai lich su alarm'` · `'Chua co endpoint lich su alarm'` · `'tat ca'` · `'chua ack'` · `'da ack'`

Ngoài ra **trộn ngôn ngữ ngay trong một hàng nút lọc**: `tat ca` (Việt không dấu) · `active` (Anh) · `chua ack` (Việt không dấu) · `da ack` (Việt không dấu) · `cleared` (Anh) · `shelved` (Anh). Sáu nút cạnh nhau, ba thứ "ngôn ngữ". Toàn bộ nhãn bộ lọc lịch sử tiếng Anh: `Text`, `Alarm`, `Name`, `From`, `To`, `Severity`, `status: all`. Nhãn badge trong `StatusBadge.labelMap` (`NORMAL`, `FAULT`, `OFFLINE`, `FORCED`…) **hardcode tiếng Anh toàn cục, không bao giờ dịch** — ảnh hưởng mọi màn hình.

---

### 2.5. Biểu đồ xu hướng — `TrendsPage.tsx` (606 dòng)

**Hiện trạng & Bố cục.** Chart + Table: thanh chọn khoảng thời gian nhanh (`rangeOptions`) + khoảng tùy chỉnh → biểu đồ `TrendChart` (Recharts) → bảng dữ liệu. Có tách nguồn dữ liệu cache/database (`historySourceForRange`) và hỗ trợ historian v2.

**Ưu điểm.**
- Kiến trúc dữ liệu chín chắn: tách `buildHistoryChartModel`, `historyPresentationState`, xử lý `gaps` (khoảng trống dữ liệu) và `generation` của điểm — hiếm thấy ở sản phẩm cùng tầm.
- `HistoryStateBanner` dùng `aria-live={isAlert ? 'assertive' : 'polite'}` — đúng chuẩn.
- Có `role="alert"` cho lỗi khoảng tùy chỉnh, `role="status"` cho điểm chưa có lịch sử.
- Ghi nhớ khoảng thời gian đã chọn.

**Nhược điểm.**

| # | Vấn đề | Vi phạm |
|---|---|---|
| T1 | **Không xuất được dữ liệu** (không có CSV/PNG) — grep không thấy `CSV`/`Download`/`export` UI. Đây là yêu cầu bắt buộc cho báo cáo nghiệm thu và phân tích sự cố | Nghiệp vụ |
| T2 | **Không zoom/pan/brush** trên biểu đồ | Efficiency |
| T3 | **Biểu đồ đổi múi giờ theo nguồn dữ liệu**: chart lịch sử dùng `timeZone="UTC"` (dòng 337) còn nhãn live dùng `toLocaleTimeString('vi-VN')` → khi đối chiếu sự kiện giữa live và history, mốc thời gian **lệch 7 giờ** mà không có chú thích | Nielsen #4; rủi ro chẩn đoán sai |
| T4 | Màu chuỗi trend tái sử dụng màu ngữ nghĩa cảnh báo/lỗi/force (xem Blocker #4 Bảng H) | ISA-101 |
| T5 | 8 màu chuỗi không kiểm chứng khả năng phân biệt cho người mù màu; không có ký hiệu/nét đứt phân biệt kèm màu | WCAG 1.4.1 (Use of Color) |

**Localization.** Nhãn khoảng thời gian có song ngữ (`item.labelVi`/`labelEn`) — tốt. Nhưng `TrendChart.tsx` hardcode `'vi-VN'` ở hai chỗ (dòng 34, 61) nên trục thời gian luôn định dạng Việt kể cả ở chế độ English.

---

### 2.6. Cài đặt → Hiển thị — `DisplaySettingsPage.tsx` (69 dòng)

**Hiện trạng & Bố cục.** Form dạng Card-Select: 2 thẻ chọn ngôn ngữ → panel Theme (chỉ mô tả) → 2 thẻ chọn mật độ.

**Ưu điểm.** Mô hình draft + Save rõ ràng (`draftLang` rồi mới `setLang`) — đúng nguyên tắc thay đổi có chủ đích. Bố cục card dễ chạm.

**Nhược điểm.**

| # | Vấn đề | Vi phạm |
|---|---|---|
| DS1 | **Panel "Theme" là văn bản tĩnh, không đổi được theme** → không có chế độ tối cho phòng máy (xem Blocker #4 Bảng E) | ISA-101; WCAG 1.4.6 |
| DS2 | `density` được set nhưng **không áp dụng ở bất kỳ đâu** — điều khiển chết. Chính subtitle thừa nhận: "Demo local, chưa ghi xuống thiết bị" | Nielsen #1 |
| DS3 | **Lộ thuật ngữ nội bộ ra UI người dùng cuối**: "Level B hybrid cố định theo **ADR-009**", "ISA-101 Level B hybrid". Vận hành viên không biết ADR-009 là gì | Nielsen #2 |
| DS4 | Copy hướng nội bộ lọt vào bản chạy: `'English labels for demo review'`, toast `'Đã lưu cấu hình hiển thị (demo)'` | Chất lượng sản phẩm |
| DS5 | Thẻ chọn là `<button>` nhưng **không có `aria-pressed`** → screen reader không biết mục nào đang chọn | WCAG 4.1.2 |
| DS6 | **Thiếu các điều khiển thiết yếu cho HMI**: độ sáng, cỡ chữ, thời gian chờ khóa màn hình, chế độ tương phản cao | ISO 9241-11 |

**Localization.** Là một trong các trang dịch tốt (đủ dấu, song ngữ). Còn sót nhãn panel `Theme` không dịch.

---

### 2.7. Cài đặt → Người dùng — `UsersPage.tsx` (20 dòng)

**Hiện trạng & Bố cục.** Table Layout đơn giản: tiêu đề + nút "Thêm user" → `DataTable` 5 cột (Tên đăng nhập, Họ tên, Vai trò, Trạng thái, Thao tác).

**Đánh giá thẳng: đây là ảnh chụp giao diện (mockup), không phải màn hình chức năng.**

| # | Vấn đề | Vi phạm |
|---|---|---|
| U1 | `const rows = getDemoUsers()` — **luôn đọc dữ liệu demo, kể cả ở bản live**. Danh sách người dùng thật không bao giờ hiện | Nielsen #1 |
| U2 | Nút **"Thêm user" không có `onClick`** | Nielsen #1 |
| U3 | Hai nút icon `Edit2` và `Link2` **không có `onClick` và không có `aria-label`** → vừa chết vừa vô hình với screen reader | Nielsen #1; WCAG 4.1.2 |
| U4 | **Không có xóa user, đổi vai trò, reset mật khẩu, khóa/mở tài khoản** — màn hình quản trị RBAC không có một hành động nào chạy được | Effectiveness = 0 |
| U5 | **Không có gate quyền** — mọi role đều xem được danh sách người dùng | Bảo mật |
| U6 | Vai trò hiện dạng text thô, không giải thích quyền hạn kèm theo | Nielsen #2 |
| U7 | Dùng `StatusBadge state="online"` cho *tài khoản* — ngữ nghĩa lệch (badge này thiết kế cho trạng thái thiết bị) | Nielsen #4 |

**Localization.** Tiêu đề cột dịch đủ dấu, đúng. Nhưng nút ghi `'Thêm user'` — trộn Việt-Anh; nên là "Thêm người dùng".

> **Đối chiếu với brief:** Brief nêu lỗi hiển thị `"Nguoi dung"` (thiếu dấu). Kiểm tra mã nguồn: chuỗi này **viết đúng đủ dấu** — `i18n.tsx:18` là `users: 'Người dùng'` và `UsersPage.tsx:20` là `pick('Người dùng', 'Users')`. Lỗi thiếu dấu **có thật** nhưng tập trung ở nơi khác (Alarms, Scheduler, Virtual Points, Alarm Settings) — xem mục 2.16.

---

### 2.8. Cài đặt → Mạng — `NetworkPage.tsx` (570 dòng)

**Hiện trạng & Bố cục.** Trang phức tạp nhất: hàng 4 thẻ Stat → panel "ETHERNET – Giao dịch an toàn" (5 `AuthorityCard` + form draft + 5 nút vòng đời giao dịch) → panel NORTHBOUND (BACnet/WiFi) → panel SOUTHBOUND (bảng Modbus slave).

**Ưu điểm — đây là màn hình được thiết kế tốt nhất về mặt an toàn:**
- Vòng đời `Validate → Stage → Apply → Confirm → Rollback` với **tự động rollback nếu không confirm kịp** — chuẩn mực cho thay đổi cấu hình mạng từ xa.
- **Khóa Apply khi chưa vào bằng hostname ổn định** (`managementPathReady`) và khi chưa có carrier Ethernet (`ethernetApplyReady`) — chống tự cắt đường quản trị. Đây là tư duy an toàn xuất sắc.
- Tách bạch rõ 4 tầng sự thật: ACTIVE/KERNEL vs CONFIGURED vs PENDING vs EDITABLE DRAFT, kèm ghi chú "Candidate có thể chỉnh sửa; không phải bản sao realtime".
- Xử lý kết quả request không xác định (`reconcileAfter`) — khóa thao tác thay vì đoán. Rất chín chắn.
- `aria-live="polite"` cho khối trạng thái giao dịch và đồng hồ đếm ngược rollback.

**Nhược điểm.**

| # | Vấn đề | Vi phạm |
|---|---|---|
| N1 | **KHÔNG có validate định dạng IP/netmask/gateway ở client** — `Field` (dòng 535) là `<input>` text trơn: không `pattern`, không `inputMode`, không `aria-invalid`, không lỗi inline. Gõ `192.168.1.999` hay `abc` vẫn phải bấm Validate và chờ server từ chối. **Đây chính là lỗi brief nêu — xác nhận có thật** | **Nielsen #5** |
| N2 | DNS phân tách bằng `value.split(',')` thô (dòng 132), không validate, sinh phần tử rỗng khi có dấu phẩy cuối | Nielsen #5 |
| N3 | `BACnet Device ID` là text tự do (dòng 329) — theo chuẩn BACnet phải là số 0…4194302 | Nielsen #5 |
| N4 | `BACnet/IP Port` dùng `Number(event.target.value)` (dòng 333) → xóa trống thành `0`, không có phản hồi lỗi | Nielsen #5 |
| N5 | `Toggle` (dòng 539) là `<button>` **không có `role="switch"`/`aria-checked`** | WCAG 4.1.2 |
| N6 | Đồng hồ đếm ngược rollback chỉ là chữ nhỏ trong một thẻ; mất mạng là sự cố phải cử người tới hiện trường → cần cảnh báo toàn màn hình khi sắp hết hạn | ISA-101 |
| N7 | `Serial` và `Firmware` gán cứng `"N/A"` (dòng 348-349) — trường chết | Nielsen #1 |
| N8 | Bảng slave `min-w-[860px]` → cuộn ngang trên tablet | Efficiency |
| N9 | Màu thô `rgba(143,161,189,0.18)` cho track thanh error rate (dòng 562) | Nhất quán |

**Localization — mất cân đối rõ rệt.** Tiêu đề, subtitle, thông báo cảnh báo và toast được dịch đủ dấu, chất lượng cao. Nhưng **toàn bộ mặt làm việc thực tế lại là tiếng Anh**: `Interface`, `Mode`, `IPv4`, `Subnet Mask`, `Gateway`, `DNS mode`, `DNS servers`, `Device Name`, `BACnet Device ID`, `BACnet/IP Port`, `BMS Link`, `WiFi`, `Serial`, `Firmware`, `Role`, `Addr`, `Slave / Profile`, `Baud rate`, `Poll state`, `Error rate`, `Last poll`, `Stage`, `Apply`, `Confirm`, `Rollback`, `ACTIVE / KERNEL`, `CONFIGURED PROFILE`, `PENDING CANDIDATE`, `MANAGEMENT HOST`, `TRANSACTION`, `EDITABLE DRAFT`, và mọi giá trị trong `AuthorityCard` (`up`/`down`, `present`/`absent`, `Unknown`, `No IPv4`, `No configured profile`, `no active transaction`, `ready`/`not ready`). Hai tiêu đề panel là **chuỗi trộn cứng không qua `pick()`**: `"NORTHBOUND - BACnet/IP lên BMS"` và `"SOUTHBOUND - RS-485 Modbus RTU Master"` (dòng 325, 356) → tiếng Anh lẫn tiếng Việt trong một dòng, và không đổi được khi sang chế độ English.

---

### 2.9. Cài đặt → Thời gian — `TimeSettingsPage.tsx` (185 dòng)

**Hiện trạng & Bố cục.** Form + Status: thanh hành động (Làm mới / Lưu) → panel "Giờ thiết bị hiện tại" (đồng hồ + badge NTP/MANUAL + 4 ô trạng thái) → 2 panel (NTP | Timezone & đặt thủ công) → modal xác nhận.

**Ưu điểm — màn hình phòng ngừa lỗi tốt nhất của sản phẩm:**
- Validate RFC3339 bằng regex **và** `Date.parse`, chặn trước khi gửi.
- Có `aria-invalid` + thông báo lỗi inline ngay dưới trường.
- **Modal xác nhận nêu rõ hậu quả**: "Đổi wall clock có thể ảnh hưởng audit, lịch và timestamp lịch sử. Tiếp tục?" — đúng chuẩn Nielsen #5, nên nhân rộng ra Force/Commissioning.
- Chống ghi đè đồng thời bằng `baseRevision` + `operationId` (idempotency).
- Nút Save `disabled` khi chưa có thay đổi (`dirty`) — phản hồi trạng thái tốt.
- Đồng hồ nội suy mượt bằng `anchorMs` thay vì poll liên tục — tiết kiệm tài nguyên.

**Nhược điểm.**

| # | Vấn đề | Vi phạm |
|---|---|---|
| TS1 | **Timezone chỉ có 4 lựa chọn hardcode**: `Asia/Ho_Chi_Minh`, `UTC`, `Asia/Bangkok`, `Asia/Singapore` (dòng ~168). **Đây là rào cản trực tiếp cho mục tiêu thương mại hóa toàn cầu** — bán sang Trung Đông, Châu Âu, Bắc Mỹ là không dùng được | Effectiveness |
| TS2 | Đặt giờ thủ công buộc **tự gõ chuỗi** `2026-07-18T10:00:00+07:00`. Trên panel HMI cảm ứng không bàn phím vật lý, đây là tác vụ gần như bất khả thi | ISO 9241-11 Efficiency |
| TS3 | Ô hiển thị chính là **chuỗi ISO thô** (`displayedUtc`, ví dụ `2026-07-30T12:24:20.000Z`) — không thân thiện; giờ địa phương lại ở dòng phụ nhỏ hơn | Nielsen #2 |
| TS4 | `status.warnings` render thô từ backend, không kiểm soát ngôn ngữ | Localization |
| TS5 | Danh sách máy chủ NTP là text tự do, không validate hostname/IP | Nielsen #5 |

**Localization.** Chất lượng cao, đủ dấu. Còn `Timezone`, `NTP`, `RTC` không dịch (chấp nhận được — thuật ngữ kỹ thuật), và nhãn `Source`/`Offset` đã dịch đúng.

---

### 2.10. Cài đặt → Thiết bị (Device Info/Operations) — `SettingsPage.tsx` (95 dòng)

**Hiện trạng & Bố cục.** Grid `[1fr_0.72fr]`: panel "Thông tin thiết bị" (4 trường) | panel "About" (6 dòng `<dl>`) → panel "Mục phụ" (4 thẻ).

**Ưu điểm.** Bố cục cân đối; `<dl>` dùng đúng ngữ nghĩa cho cặp nhãn-giá trị.

**Nhược điểm — màn hình này lừa người dùng:**

| # | Vấn đề | Vi phạm |
|---|---|---|
| SE1 | **Nút "Lưu" chỉ hiện toast thành công, KHÔNG gọi API nào**: `onClick={() => toast.push('success', pick('Đã lưu cấu hình thiết bị (demo)', ...))}` (dòng 38). Người dùng sửa tên thiết bị, bấm Lưu, thấy "Đã lưu" — **và không có gì được lưu**. Đây là phản hồi sai sự thật, tệ hơn cả việc không có nút | **Nielsen #1** |
| SE2 | **Cả 4 thẻ "Mục phụ" (Bảo mật, Backup & Restore, Email, Licenses) không có `onClick`** — quảng cáo 4 tính năng không tồn tại | Nielsen #1 |
| SE3 | Cho sửa `Chu kỳ scan core (ms)` — tham số ảnh hưởng trực tiếp vòng quét điều khiển — mà **không có hiệu lực gì**, cũng không cảnh báo hậu quả | Nielsen #5 |
| SE4 | Panel "About" hiển thị `DEVICE_DEFAULTS` (hằng số build), nhãn ghi thẳng **"IP demo"** trong màn hình cài đặt sản phẩm | Chất lượng |
| SE5 | Giá trị mặc định `location: 'Tủ ĐK trung tâm - Tầng 1'` hardcode tiếng Việt, hiện cả ở chế độ English | Localization |
| SE6 | Nút icon-only thiếu `aria-label` (dòng 38) | WCAG 4.1.2 |

**Localization.** Trộn ngôn ngữ: `About`, `Backup & Restore`, `Email`, `Licenses`, `Model`, `Name`, `Firmware`, `Serial`, `BACnet ID` không dịch, nằm cạnh nhãn tiếng Việt có dấu.

---

### 2.11. Kỹ thuật → Lịch vận hành — `SchedulerPage.tsx` (737 dòng)

**Hiện trạng & Bố cục.** Master-Detail + Wizard: cột trái danh sách lịch (`280px`, tối đa 64 mục, có bộ đếm `n/64`) | cột phải chế độ Wizard 6 bước (Loại → Thời gian → Ngày trong tuần → Mục tiêu → Giá trị → Ghi chú) hoặc chế độ Summary.

**Ưu điểm.**
- Wizard 6 bước chia nhỏ tác vụ phức tạp — giảm tải nhận thức tốt.
- Có validate trước khi lưu, nút Save `disabled` kèm `title` giải thích lý do.
- Bộ đếm `rows.length/maxSchedules` và chặn thêm khi đạt 64 — phản hồi giới hạn hệ thống rõ ràng.
- Có preset (lưu/tải mẫu) — tăng hiệu suất cho cấu hình lặp lại.
- `CapabilityBadge` cho biết loại lịch nào được hỗ trợ.

**Nhược điểm.**

| # | Vấn đề | Vi phạm |
|---|---|---|
| SC1 | **Không có trực quan hóa lịch tuần** — chỉ danh sách + wizard. Không thể nhìn thấy cả tuần trong một lần, không phát hiện được lịch chồng lấn/xung đột trên cùng mục tiêu | ISO 9241-11 Effectiveness |
| SC2 | **Không có kéo-thả** để dịch/kéo dài khoảng thời gian (xác nhận: toàn sản phẩm không có `draggable`) | Efficiency |
| SC3 | **Không phát hiện xung đột** giữa hai lịch cùng target chồng giờ | Nielsen #5 |
| SC4 | **Phơi tên thanh ghi Modbus nội bộ ra wizard**: `wizardStepRegister()` trả `'TSx 3'`, `'TSx 4-5'`, `'TSx 6'`, `'TSx 11'` | Nielsen #2 |
| SC5 | Nút chọn ngày `h-9 min-w-11` = 36×44px — chiều cao không đạt 44px | WCAG 2.5.5 (AAA) |
| SC6 | Nút ngày không có `aria-pressed` | WCAG 4.1.2 |
| SC7 | `ScheduleTypeNameBadge` hardcode `"Schedule Type"` tiếng Anh (dòng ~575) | Localization |

**Localization — thiếu dấu hàng loạt, và tự mâu thuẫn với chính nó.** Sidebar hiện `'Lịch vận hành'` (i18n có đủ dấu) nhưng **tiêu đề H1 của trang lại là `'Lich van hanh'`** — cùng một khái niệm, hai cách viết, hiển thị đồng thời trên một màn hình. Các chuỗi thiếu dấu khác: `'Cau hinh Time Schedule toi da 64 muc.'` · `'Tai lai'` · `'Them lich'` · `'Danh sach lich'` · `'Ngay trong tuan'` · `'Muc tieu'` · `'Gia tri'` · `'Ghi chu'` · `'Loai lich'` · `'Khoang thoi gian'` · `'Tai mau'` · `'Luu mau'` · `'Thoi gian'` · `'Ngay bat dau'` · `'Ngay ket thuc'` · `'Da luu mau'` · `'Them lich dau tien de cau hinh.'`

---

### 2.12. Kỹ thuật → Chạy thử — `CommissioningPage.tsx` (43 dòng)

**Hiện trạng & Bố cục.** Grid thẻ đơn giản: mỗi output là một `PointCard` + 2 nút (`Test`, `Release`) xếp `grid-cols-2`. Tối đa 4 cột trên `xl`.

**Ưu điểm.** Bố cục thoáng, dễ chạm; `PointCard` hiển thị giá trị live cạnh nút điều khiển — đúng nguyên tắc đặt hành động gần đối tượng. Subtitle nêu ý thức audit ("luôn ghi audit log").

**Nhược điểm — đây là màn hình nguy hiểm nhất của sản phẩm (xem Blocker #2):**

| # | Vấn đề | Vi phạm |
|---|---|---|
| C1 | **Bấm "Test" tác động vật lý ngay, không xác nhận** — ép AO 50% / DO ON ra thiết bị thật | **Nielsen #5**; ISA-101 |
| C2 | Giá trị test hardcode 50%, không chọn được | Effectiveness |
| C3 | **"Release" thực chất ghi 0/false, không phải trả quyền về tự động** — nhãn sai bản chất, kỹ thuật viên tưởng đã giải phóng nhưng đã ép thiết bị tắt | **Nielsen #2**; an toàn |
| C4 | **Không có "Release All"** — không có cách giải phóng toàn bộ override trong một hành động | ISA-101; Efficiency |
| C5 | **Không có gate quyền** — `viewer` cũng tác động được output vật lý | Bảo mật |
| C6 | Không hiển thị điểm nào đang bị override, không có thời hạn/tự hết hạn force | ISA-101 |
| C7 | `useApi(getPoints, [])` **không có `refreshMs`** → giá trị live không tự cập nhật sau khi test; không quan sát được kết quả | Nielsen #1 |
| C8 | **Không có nhánh xử lý lỗi** — chỉ kiểm tra `state.loading`, không kiểm tra `state.error` → API lỗi thì hiện panel trống im lặng | Nielsen #9 |
| C9 | Không hiển thị audit log dù subtitle cam kết có ghi | Nielsen #1 |
| C10 | Nút `Release` không có trạng thái `loading` (chỉ `Test` có) | Nielsen #1 |

**Localization.** Tiêu đề và subtitle dịch đủ dấu, tốt. Nhưng **hai nhãn nút quan trọng nhất `Test` và `Release` hardcode tiếng Anh**, và fallback lỗi `'Commissioning failed'` cũng vậy.

---

### 2.13. Kỹ thuật → Lập trình — `ProgrammingPage.tsx` (230 dòng)

**Hiện trạng & Bố cục.** Library + List (không có canvas): danh sách `componentLibrary` 13 khối → hiển thị node/link của `sampleGraph` dạng danh sách → nút Validate/Deploy.

**Ưu điểm.** Có validate graph cục bộ (`validateGraphLocal`) trước khi deploy; `role="status"` cho khối thông báo (dòng 116); thư viện khối bao phủ đủ nghiệp vụ DDC (PID, Interlock, TON/TOF, RuntimeCounter, PulseCounter).

**Nhược điểm.**

| # | Vấn đề | Vi phạm |
|---|---|---|
| P1 | **Trang bị redirect âm thầm về Dashboard trong mọi bản live** (xem Blocker #5a) | Nielsen #1, #9 |
| P2 | **Không phải trình lập trình đồ họa**: không canvas, không nối dây, không kéo-thả. Là danh sách + JSON mẫu hardcode | Effectiveness |
| P3 | `sampleGraph` hardcode `name: 'AHU01_DDC'`, `author: 'demo'`, `rev: 1` | Chất lượng |
| P4 | Không có undo/redo, không có versioning/diff trước khi deploy logic điều khiển | Nielsen #3 (User control) |
| P5 | Deploy logic điều khiển mà không có gate quyền, không có xác nhận hai bước | Bảo mật; ISA-101 |

**Localization.** **0% được dịch.** Toàn bộ nhãn khối là identifier nội bộ tiếng Anh (`UI_Input`, `AO_Output`, `Modbus_Read`, `OnDelay`, `OffDelay`, `AlarmDelay`, `RuntimeCounter`, `PulseCounter`, `Logic AND`, `Logic OR`, `Timer TON`, `Timer TOF`, `Interlock`, `Setpoint`, `PID`); mô tả cũng tiếng Anh (`'Boolean AND.'`, `'Safety permissive gate.'`, `'Accumulate run hours.'`). i18n có key `programming: 'Lập trình'` nhưng nội dung trang không dùng.

---

### 2.14. Kỹ thuật → Cấu hình Inputs (UI) — `InputsPage.tsx` (890 dòng)

**Hiện trạng & Bố cục.** Master-Detail + Wizard/Advanced: danh sách 16 kênh Universal Input | chi tiết kênh với chế độ Wizard hoặc Advanced, kèm khối dữ liệu live và biểu đồ.

**Ưu điểm — đây là màn hình cấu hình chất lượng cao nhất:**
- **i18n rất đầy đủ và đúng dấu** cho miền nghiệp vụ khó: 9 loại tín hiệu, 6 hệ số dải, 5 đơn vị, 4 hàm toán đều có bản tiếng Việt chuẩn (`'2 = 2-10V hoặc 4-20mA'`, `'6 = Ngõ vào biến trở'`, `'3 = Căn bậc hai, cho phép dải cảm biến -50 đến 205.'`). Đây là chuẩn mực nội bộ về địa phương hóa.
- Nhãn tùy chọn có tiền tố số khớp giá trị thanh ghi (`0 =`, `1 =`…) — giúp kỹ thuật viên đối chiếu tài liệu thiết bị. Thực hành tốt.
- Có validate tag/tên với `role="alert"` và `aria-describedby` (dòng 489, 505).
- Chế độ Wizard/Advanced đáp ứng cả người mới và chuyên gia (Nielsen #7).
- Hiển thị cả giá trị thô (Raw V/mA) và giá trị quy đổi — rất hữu ích khi hiệu chuẩn.

**Nhược điểm.**

| # | Vấn đề | Vi phạm |
|---|---|---|
| I1 | `toLocaleTimeString('vi-VN')` hardcode 2 chỗ (dòng 442, 458) | Localization |
| I2 | Nhãn chế độ `t('wizard')` = `'Wizard'`, `t('advanced')` = `'Advanced'`, `t('summary')` = `'Summary'` — **bản `vi` để nguyên tiếng Anh** trong i18n | Localization |
| I3 | `t('rawVolts')` = `'Raw (V)'`, `t('rawMilliamps')` = `'Raw (mA)'` không dịch | Localization |
| I4 | Không có nút "sao chép cấu hình sang kênh khác" — 16 kênh tương tự phải cấu hình lặp lại thủ công | Efficiency |
| I5 | Không có xuất/nhập cấu hình kênh (JSON/CSV) | Efficiency |

---

### 2.15. Kỹ thuật → Cấu hình Outputs (AO/DO) — `OutputsPage.tsx` (739 dòng)

**Hiện trạng & Bố cục.** Master-Detail + 3 tab: danh sách kênh (4 AO + 4 DO) | panel chi tiết với 3 chế độ (Summary / Wizard / Advanced), khối Live Data (giá trị, raw, min/max/avg), Live Trend, Manual output. Có modal Overview dạng bảng toàn bộ output.

**Ưu điểm.**
- Modal Overview cho cái nhìn toàn cảnh 8 kênh kèm địa chỉ vật lý (`16 + channel` cho AO, `20 + channel` cho DO) — hữu ích khi đấu dây.
- Có validate tag/tên với `role="alert"` (dòng 331, 340).
- Hiển thị `safeValue`/`safeState` ngay trong bảng tổng quan — đúng trọng tâm an toàn.
- Có thống kê min/max/avg và biểu đồ live cho từng kênh.
- Modal xác nhận trước khi lưu.

**Nhược điểm.**

| # | Vấn đề | Vi phạm |
|---|---|---|
| O1 | Manual force không có xác nhận nêu hậu quả vật lý, không có thời hạn tự hết hiệu lực | Nielsen #5; ISA-101 |
| O2 | Không có gate quyền cho manual force | Bảo mật |
| O3 | **4 nút icon-only thiếu `aria-label`** (dòng 173, 174, 305, 421) | WCAG 4.1.2 |
| O4 | `toLocaleTimeString('vi-VN')` hardcode (dòng 613) | Localization |
| O5 | Không có "Release All" cho các output đang bị force | ISA-101 |

**Localization — lộ thuật ngữ kỹ thuật nội bộ ra người dùng cuối, nghiêm trọng.** Các chuỗi trong `i18n.tsx` bản `vi`:

| Key | Nội dung bản `vi` | Vấn đề |
|---|---|---|
| `outputsSubtitle` | `'4 AO + 4 DO theo hook backend hiện có'` | "hook backend" là từ vựng lập trình viên |
| `outputsSaveBody` | `'Chỉ các field wired hiện có sẽ ghi qua backend hook.'` | Câu xác nhận trước khi ghi ra thiết bị lại nói bằng ngôn ngữ dev: "field wired", "backend hook" |
| `outputsAoSubtitle` | `'Analog Output - signal type, safe value, manual force'` | Không dịch |
| `outputsDoSubtitle` | `'Digital Output - safe state, manual force'` | Không dịch |
| `outputsManual` | `'Manual output'` | Không dịch |
| `outputsDemoNote` | `'Demo/local'` | Từ "demo" trong bản sản phẩm |

Thêm nhãn hardcode: `Raw output`, `Digital`, `AO`, `DO`.

---

### 2.16. Kỹ thuật → Điểm ảo (Virtual Points) — `VirtualIoPage.tsx` (1005 dòng — trang lớn nhất)

**Hiện trạng & Bố cục.** Master-Detail: danh sách VP (thêm/xóa) | form chi tiết + dữ liệu live + biểu đồ.

**Ưu điểm.**
- Có validate với `role="alert"` và liên kết `aria-describedby` qua `errorId` (dòng 733).
- Cho sửa cả `tag` và `label` (khác điểm vật lý chỉ sửa được label) — đúng nghiệp vụ.
- Có `type="number"` cho trường giá trị (dòng 742) — validate ở tầng trình duyệt.
- Đầy đủ CRUD hoạt động thật (tạo/lưu/xóa VP có gọi API).

**Nhược điểm.**

| # | Vấn đề | Vi phạm |
|---|---|---|
| V1 | Form nhập giá trị chưa thích ứng theo kiểu dữ liệu VP (số/bool/chuỗi/datetime) — brief nêu đúng nhu cầu "form nhập giá trị thông minh" | Nielsen #5 |
| V2 | `toLocaleTimeString('vi-VN')` hardcode 2 chỗ (dòng 394, 409) | Localization |
| V3 | Không có gate quyền cho ghi giá trị VP | Bảo mật |

**Localization — thiếu dấu hàng loạt.** `'Da luu Virtual Point'` · `'Da tao VP'` · `'Da xoa VP'` · `'Chua co VP nao.'` · `'Chua co du lieu live cho VP nay.'` · `'Chua co ID'` · `'Xoa'` · `'Lon nhat'` · `'Nho nhat'` · `'Da tai lai tu backend.'` — chuỗi cuối còn lộ từ "backend" ra UI. Tên trang trong i18n là `'Virtual Points'` **không dịch ở cả bản `vi`**.

---

### 2.17. Kỹ thuật → Cấu hình Cảnh báo — `AlarmSettingsPage.tsx` (799 dòng)

**Hiện trạng & Bố cục.** Master-Detail: danh sách alarm entity | form cấu hình theo loại (`alarmType`), có `SeverityRulesEditor` cho priority `flexible`.

**Ưu điểm.**
- Mô hình dữ liệu tốt: `priority` + tập `severityRules` (severity × op `>=`/`<=` × ngưỡng) cho phép phân cấp mức độ linh hoạt — đúng tinh thần ISA-18.2.
- Validate nhiều lớp có gom lỗi theo dòng (`addIssue(issues, rowIndex, ...)`).
- Hỗ trợ multi-source theo ADR-013.

**Nhược điểm.**

| # | Vấn đề | Vi phạm |
|---|---|---|
| AS1 | **9 nút icon-only thiếu `aria-label`** — nhiều nhất toàn sản phẩm (dòng 187, 190, 200, 231, 334, 398, 445, 458) | WCAG 4.1.2 |
| AS2 | Dùng số ma thuật cho loại alarm (`alarmType === 3`), phơi ra UI qua thông báo | Nielsen #2 |
| AS3 | **Lộ thuật ngữ lộ trình nội bộ ra người dùng**: `'Type nay khong co tham so active trong Phase 4.'` — "Phase 4" là mốc dự án nội bộ | Nielsen #2 |
| AS4 | `alarmSettingsSubtitle` (bản `vi`) = `'ADR-013 alarm entities, multi-source, luu qua backend API'` — vừa lộ mã ADR, vừa nói "backend API", vừa thiếu dấu | Nielsen #2 |
| AS5 | Không có xem trước tác động (alarm này sẽ kích khi nào) trước khi lưu | Nielsen #5 |

**Localization — tệ nhất về chất lượng câu.** Đây là nơi duy nhất **thiếu dấu và trộn Việt-Anh trong cùng một câu**:

| Chuỗi nguyên văn trong mã | Vấn đề |
|---|---|
| `'Cau hinh canh bao'` (`i18n.tsx:175`) | Thiếu dấu — **đúng như brief nêu** |
| `'ADR-013 alarm entities, multi-source, luu qua backend API'` (dòng 176) | Thiếu dấu + mã nội bộ + từ vựng dev |
| `'Da luu cau hinh canh bao'` (dòng 178) | Thiếu dấu |
| `'Khong luu duoc cau hinh canh bao'` (dòng 179) | Thiếu dấu |
| `'Priority flexible chi ap dung cho active alarm type.'` | Trộn 2 ngôn ngữ giữa câu + thiếu dấu |
| `'Priority flexible can it nhat 1 severity rule.'` | Như trên |
| `'Enabled alarm can it nhat 1 source.'` | Như trên |
| `'Can it nhat 1 rule cho priority flexible.'` | Như trên |
| `'Priority khong hop le.'` · `'Loai alarm'` · `'Muc uu tien'` · `'Trang thai cau hinh'` · `'Trang thai / muc tieu'` · `'Chua co source.'` · `'Them alarm dau tien de cau hinh.'` | Thiếu dấu |
| `pick('Severity','Severity')` | Hai nhánh giống nhau — không dịch |

---

### 2.18. Phát hiện ngoài phạm vi brief: 5 màn hình chưa được kể tên

Brief liệt kê 17 màn hình. Kiểm tra `App.tsx` cho thấy **22 route hoạt động**. Năm màn hình sau tồn tại và người dùng chạm tới được, nhưng không nằm trong phạm vi đánh giá được yêu cầu:

| Màn hình | Route | Tình trạng | Vấn đề chính |
|---|---|---|---|
| **Thông tin người dùng** | `/me` | Hoạt động, có trong TopBar | **3 giá trị bịa**: `Auto-logout demo` đếm ngược 15:00 không gắn với hạn JWT thật; `IP demo` = `192.168.1.42` hardcode; `Lần đăng nhập gần nhất` = `2026-06-15 17:25:04` hardcode. Đổi mật khẩu **không yêu cầu mật khẩu hiện tại** (lỗ hổng nếu phiên bị chiếm) và chỉ tối thiểu 6 ký tự. Nhãn chứa từ "demo" ở cả 2 ngôn ngữ |
| **Trợ giúp** | `/help` | Hoạt động, có trong TopBar | **Màn hình được địa phương hóa tốt nhất**: song ngữ đầy đủ, `aria-hidden` đúng cho icon trang trí, phân cấp `h1`/`h2`/`h3` chuẩn. Nhược: FAQ tĩnh, không tìm kiếm được; icon `ExternalLink` gợi ý có link nhưng chỉ là trang trí |
| **Sơ đồ điều khiển** | `/eng/diagram` | Hoạt động, **không có trong sidebar** — chỉ tới được qua nút "Open" ở Dashboard | **Không kiểm tra độ tươi dữ liệu**: `realtime.allPoints.length ? realtime.allPoints : ...` (dòng 15) thiếu `isFreshIso` mà Dashboard/Monitor đều có → hiển thị dữ liệu WebSocket cũ vô thời hạn sau khi mất kết nối, **không đánh dấu stale**. Nguy hiểm trên sơ đồ dùng để chạy thử. `toLocaleTimeString('vi-VN')` hardcode |
| **Tham số người dùng** | `/eng/user-parameters` | Route sống, **link sidebar bị comment** (`NavRail.tsx:43`) | Trang mồ côi. **30 tham số `upParam00`–`upParam29` để nguyên tiếng Anh ở bản `vi`** (`'Enable access to setpoints'`, `'Temperatures in Fahrenheit'`, `'Enable Wink Always'`…) — 35 khóa i18n không dịch. Subtitle `'Mock - chưa nối backend'` **đã lạc hậu**: trang thực tế gọi `getUserParams`/`putUserParams` thật (dòng 95, 124) → thông tin sai cho người dùng |
| **Hàm phụ trợ** | `/eng/aux` | Route sống, **link sidebar bị comment** (`NavRail.tsx:44`) | Trang mồ côi, **không có `apiClient` nào** → thuần mock. Nút icon-only thiếu `aria-label` (dòng 255) |

**Vấn đề sản phẩm:** ba trang (`user-parameters`, `aux`, `diagram`) truy cập được bằng URL nhưng không có đường dẫn từ menu. Đây là bề mặt sản phẩm không được quản lý: hoặc phải hoàn thiện và đưa vào menu, hoặc phải chặn route và trả thông báo rõ ràng — chứ không để lơ lửng.

---

### 2.19. Vấn đề xuyên suốt tầng nền tảng (ảnh hưởng mọi màn hình)

| # | Vấn đề | Chi tiết | Vi phạm |
|---|---|---|---|
| G1 | **`t()` không có fallback** | `i18n.tsx:404`: `t: (key) => copy[lang][key]` — thiếu khóa sẽ render `undefined` ra UI thay vì lùi về khóa hoặc ngôn ngữ khác | Robustness |
| G2 | **Ngôn ngữ mặc định là `'en'`** | `i18n.tsx:399` — sản phẩm cho thị trường Việt Nam mặc định tiếng Anh | Localization |
| G3 | **`<html lang="vi">` cứng** | `index.html:2` không đồng bộ với ngôn ngữ đang chọn (mặc định lại là `en`) → screen reader đọc sai ngữ điệu | **WCAG 3.1.1 / 3.1.2** |
| G4 | **13 chỗ hardcode `'vi-VN'`** | Trong `utils.ts` (dòng 128, 134 — dùng toàn app), `DashboardPage`, `DiagramPage`, `InputsPage`, `OutputsPage`, `VirtualIoPage`, `TrendChart`, `ControllerDiagram`. Chế độ English vẫn ra định dạng ngày giờ Việt Nam | Localization |
| G5 | **`StatusBadge.labelMap` hardcode tiếng Anh** | 25 nhãn (`NORMAL`, `FAULT`, `FORCED`, `OFFLINE`, `DEGRADED`…) không bao giờ dịch, xuất hiện trên **mọi** màn hình | Localization |
| G6 | **`PointLoggingSection` không có i18n** | `'Loading database logging policy...'`, `'Database logging policy unavailable:'`, `'Database logging is not available for X.'` hardcode tiếng Anh | Localization |
| G7 | **`Modal` dùng ID tĩnh** | `aria-labelledby="modal-title"` (dòng 94, 101) — hai modal cùng lúc sẽ trùng ID | WCAG 4.1.1 |
| G8 | **Backdrop click đóng modal không cảnh báo** | `onMouseDown={onClose}` (dòng 89) → mất dữ liệu form đang nhập | Nielsen #5 |
| G9 | **Nút Đăng xuất là `variant="ghost"` cạnh nút đổi ngôn ngữ** | `TopBar.tsx:47` — không xác nhận, affordance thấp nhất (`text-dim`), sát nút toggle ngôn ngữ → dễ bấm nhầm, mất phiên kỹ thuật đang làm. Trong khi cùng hành động đó ở `UserInfoPage` lại là `variant="danger"` | Nielsen #4, #5 |
| G10 | **Toggle ngôn ngữ có `ChevronDown` nhưng không phải dropdown** | `TopBar.tsx:44-46` — mũi tên xuống gợi ý menu, thực tế là toggle 2 trạng thái | Affordance sai |
| G11 | **Không có breadcrumb / tiêu đề ngữ cảnh** | Kết hợp với việc mất sidebar dưới 1024px → người dùng không biết mình đang ở đâu | Nielsen #1 |
| G12 | **Tên tiếp cận của link cảnh báo bị nối số** | Test khẳng định accessible name là `'Alarm2'` (`ShellNavigation.test.tsx:71`) — screen reader đọc "Alarm 2" mơ hồ, nên là "Cảnh báo, 2 đang hoạt động" | WCAG 1.3.1, 4.1.2 |
| G13 | **Không có skip-link tới nội dung chính** | Người dùng bàn phím phải Tab qua toàn bộ 17 mục sidebar mỗi trang | WCAG 2.4.1 |
| G14 | **Không có xử lý hết hạn phiên** | Không thấy cơ chế cảnh báo trước khi JWT hết hạn hay tự làm mới → người dùng có thể mất dữ liệu đang nhập | Nielsen #5 |

---

## PHẦN III: PHƯƠNG ÁN CẢI TIẾN CHI TIẾT

### 3.0. Ma trận ưu tiên Impact vs. Effort

```
        CAO │  ┌──────────────────────┐  ┌──────────────────────┐
     T      │  │   QUICK WINS         │  │   MAJOR PROJECTS     │
     Á      │  │   (làm ngay Sprint 1)│  │   (lập lộ trình)     │
     C      │  │                      │  │                      │
     Đ      │  │ QW-1  Xóa dữ liệu bịa│  │ MP-1 Theme tối + token│
     Ộ      │  │ QW-2  Xác nhận Force │  │ MP-2 Navigation mobile│
     N      │  │ QW-3  Sửa 60 chuỗi   │  │ MP-3 Login + RBAC     │
     G      │  │       thiếu dấu      │  │ MP-4 Canvas lập trình │
            │  │ QW-4  Validate IP    │  │ MP-5 Lịch tuần kéo-thả│
            │  │ QW-5  Gỡ/nối nút chết│  │ MP-6 Quản lý user thật│
            │  │ QW-6  Sửa badge TopBar│ │ MP-7 Form VP thông minh│
            │  │ QW-7  aria-label 20 nút│ │ MP-8 Alarm annunciation│
            │  │ QW-8  Đổi nhãn Off/Release│                    │
            │  └──────────────────────┘  └──────────────────────┘
            │  ┌──────────────────────┐  ┌──────────────────────┐
        THẤP│  │   FILL-INS           │  │   THANKLESS          │
            │  │ FI-1..FI-9           │  │  (không làm)          │
            │  └──────────────────────┘  └──────────────────────┘
            └────────────────────────────────────────────────────
               DỄ LÀM                      KHÓ LÀM
```

---

### 3.1. QUICK WINS — Tác động lớn, dễ làm (Sprint 1, ưu tiên tuyệt đối)

---

#### QW-1. Loại bỏ toàn bộ dữ liệu bịa, thay bằng trạng thái "không xác định" trung thực
**Giải quyết Blocker #1 · Ước lượng: 1.5 ngày**

**Giải pháp thiết kế.** Nguyên tắc bất di bất dịch: *UI không bao giờ được suy đoán dữ liệu thiết bị. Không có dữ liệu → hiện "—" kèm badge `UNKNOWN`, không bao giờ hiện số hoặc màu xanh.*

| Vị trí | Hiện tại | Sửa thành |
|---|---|---|
| `DeviceStatusCard()` | Không tham số, luôn "ONLINE" xanh | Nhận `health: HealthResponse \| null`; map `overall` → 4 trạng thái `ok`/`degraded`/`fault`/`unknown`; khi `null` hiện xám + "Chưa có dữ liệu" |
| `cpuPercent ?? 23` | Bịa 23% | `h?.cpuPercent ?? null`; `MiniDial` nhận `null` → vẽ vòng xám + chữ "—" |
| `ramPercent ?? 48` | Bịa 48% | Như trên |
| `uptimeS ?? 12*86400+...` | Bịa 12 ngày | `?? null` → "—" |
| MAC / Model / Thời gian hệ thống / Vị trí / Mô tả (Dashboard) | Hardcode | Lấy từ `/health`; thiếu field nào hiện "—" và ghi log cảnh báo dev |
| 4 badge service ở Login | `state="online"` cứng | **Bỏ hoàn toàn khỏi trang Login** (vừa là dữ liệu giả, vừa là lộ thông tin trước xác thực) |
| `Model`/`IP`/`BACnet ID`/`Firmware` ở Login | Hiện trước khi đăng nhập | **Bỏ**; chuyển sang trang Thiết bị sau xác thực |
| `IP demo` / `Lần đăng nhập gần nhất` (UserInfo) | Hardcode | Lấy từ `/me`; thiếu thì "—" |
| Tile `RS485-2`, `Modbus TCP` | `status="unknown"` cứng | Hoặc nối dữ liệu thật, hoặc **ẩn tile** |

**Thông số nghiệm thu:** grep toàn `src/frontend/src` không còn literal `?? 23`, `?? 48`, `00:0D:18`, `23/05/2025`, `192.168.1.42`, `2026-06-15 17:25:04`. Thêm test: mock `/health` trả `null` → khẳng định UI hiện "—" và badge `UNKNOWN`, **không** hiện "ONLINE".

---

#### QW-2. Thêm xác nhận có nêu hậu quả cho mọi hành động tác động vật lý
**Giải quyết Blocker #2 · Ước lượng: 2 ngày**

**Giải pháp thiết kế.** Tạo một component dùng chung `PhysicalActionDialog`, lấy `TimeSettingsPage` làm khuôn mẫu (nêu rõ hậu quả trước khi thực hiện). Áp cho: Commissioning Test, Monitor Force, Outputs Manual Force, Programming Deploy.

Nội dung bắt buộc của dialog:

```
┌─────────────────────────────────────────────────────────┐
│ ⚠  Ép giá trị ra ngõ ra vật lý                          │
├─────────────────────────────────────────────────────────┤
│ Điểm:        AO-02 — Van nước lạnh AHU-01               │
│ Giá trị hiện tại:  32.0 %   (tự động)                   │
│ Giá trị sẽ ghi:    [  75  ] %      (dải cho phép 0–100) │
│ Thời hạn:          [ 10 ] phút  → tự giải phóng 14:42   │
│                                                          │
│ Thiết bị sẽ chuyển động ngay khi bạn xác nhận.           │
│ Chương trình điều khiển bị vô hiệu trong thời gian ép.  │
│                                                          │
│ Lý do (ghi vào audit log):  [___________________]       │
│                                                          │
│              [ Hủy ]            [ Xác nhận ép ]         │
└─────────────────────────────────────────────────────────┘
```

**Thông số kỹ thuật:**
- Ô giá trị: `<input type="number">` với `min`/`max`/`step` **lấy từ dải kỹ thuật thật của điểm**, hiện đơn vị cạnh ô, validate realtime + `aria-invalid` + lỗi inline.
- **Hiện mốc giờ tự giải phóng** tính từ thời hạn (không chỉ hiện số phút).
- Nút xác nhận: `variant="danger"`, tối thiểu `h-11` (44px).
- Bắt buộc có focus trap, `Escape`, trả focus — **tái sử dụng `Modal.tsx`** thay vì viết mới (chính là lỗi của `AlarmDurationDialog`).
- Trường "Lý do" ghi vào audit log.
- **Bỏ `onMouseDown={onCancel}` trên backdrop** cho dialog loại này.

---

#### QW-3. Chuẩn hóa 60 chuỗi tiếng Việt thiếu dấu + gỡ thuật ngữ nội bộ
**Giải quyết lỗi brief nêu · Ước lượng: 1.5 ngày**

**Chẩn đoán chính xác nguyên nhân.** Đây **không phải lỗi font**. Font stack `Inter, Roboto, ui-sans-serif, system-ui…` (`styles.css:27`) hiển thị đầy đủ dấu tiếng Việt bình thường, và `<meta charset="UTF-8">` đã đúng. **Nguyên nhân thật: chuỗi trong mã nguồn được viết bằng ASCII không dấu.** Vì vậy đây là lỗi dữ liệu văn bản, sửa bằng cách sửa chuỗi — không cần đổi font hay encoding.

**Danh sách 60 chuỗi** (đã liệt kê tại 2.4, 2.11, 2.16, 2.17). Phân bổ: `AlarmsPage` 21 · `SchedulerPage` 17 · `AlarmSettingsPage` 14 · `VirtualIoPage` 10 · `i18n.tsx` 4.

Bảng mẫu chuyển đổi:

| Hiện tại | Sửa thành |
|---|---|
| `'Cau hinh canh bao'` | `'Cấu hình cảnh báo'` |
| `'Da luu cau hinh canh bao'` | `'Đã lưu cấu hình cảnh báo'` |
| `'Canh bao'` | `'Cảnh báo'` |
| `'Theo doi, loc va acknowledge canh bao'` | `'Theo dõi, lọc và xác nhận cảnh báo'` |
| `'Lich van hanh'` | `'Lịch vận hành'` (khớp i18n key `scheduler`) |
| `'Priority flexible can it nhat 1 severity rule.'` | `'Mức ưu tiên linh hoạt cần ít nhất 1 quy tắc mức độ.'` |
| `'Da tai lai tu backend.'` | `'Đã tải lại từ thiết bị.'` |
| `'20 ban ghi moi nhat khop bo loc'` | `'20 bản ghi mới nhất khớp bộ lọc'` |

**Gỡ thuật ngữ nội bộ khỏi UI** (Nielsen #2):

| Hiện tại | Sửa thành |
|---|---|
| `'ADR-013 alarm entities, multi-source, luu qua backend API'` | `'Cấu hình các cảnh báo, hỗ trợ nhiều nguồn tín hiệu'` |
| `'4 AO + 4 DO theo hook backend hiện có'` | `'4 ngõ ra analog + 4 ngõ ra số'` |
| `'Chỉ các field wired hiện có sẽ ghi qua backend hook.'` | `'Chỉ các thông số đã kết nối thiết bị sẽ được ghi.'` |
| `'Level B hybrid cố định theo ADR-009'` | `'Giao diện sáng theo chuẩn ISA-101, tối ưu cho phòng điều khiển'` |
| `'Type nay khong co tham so active trong Phase 4.'` | `'Loại cảnh báo này chưa có tham số kích hoạt.'` |
| `'Mock - chưa nối backend'` (đã lạc hậu) | `'Tham số vận hành của thiết bị'` |
| `'Demo/local'`, `'Auto-logout demo'`, `'IP demo'` | Gỡ chữ "demo" khỏi mọi nhãn bản sản phẩm |

**Dịch 35 khóa i18n còn nguyên tiếng Anh ở bản `vi`:** `upParam00`–`upParam29`, `upParamSP/TS/HT/SB/FAN`, `lockParam1-3`, `summary`, `wizard`, `advanced`, `notes`, `alarm-log`, `virtual-io`, `virtual-points`, `outputsManual`, `outputsAoSubtitle`, `outputsDoSubtitle`, `rawVolts`, `rawMilliamps`.

**Sửa 3 khiếm khuyết nền tảng đi kèm:**
1. `t()` thêm fallback: `copy[lang][key] ?? copy.vi[key] ?? key`.
2. Ngôn ngữ mặc định `'en'` → `'vi'` (`i18n.tsx:399`).
3. Đồng bộ `document.documentElement.lang` với ngôn ngữ đang chọn (WCAG 3.1.1) — thêm `useEffect` trong `I18nProvider`, và sửa `index.html` thành `lang="vi"` khớp mặc định mới.
4. Thay 13 chỗ `'vi-VN'` cứng bằng `locale` từ `useI18n()`; `utils.ts` nhận `locale` làm tham số.
5. Dịch `StatusBadge.labelMap` (25 nhãn) và `PointLoggingSection` (3 chuỗi).

> **Lưu ý về hai điểm brief nêu chưa khớp thực tế** — cần ghi rõ để tránh sửa sai chỗ:
> - **Lỗi `&amp;`**: grep toàn bộ `src/` và `web/` cho `&amp;`, `&nbsp;`, `&lt;`, `&gt;`, `&quot;` → **không có kết quả**. Lỗi này không tồn tại trong mã hiện tại. Chỗ duy nhất dùng HTML entity là `&deg;C` (`DashboardPage.tsx:339`) và JSX **render đúng thành `°C`** — không phải lỗi, chỉ nên đổi sang `°` trực tiếp cho nhất quán (đã đưa vào FI-7).
> - **`"Nguoi dung"`**: chuỗi này viết **đúng đủ dấu** trong mã (`'Người dùng'`). Lỗi thiếu dấu là có thật nhưng nằm ở 60 chuỗi khác đã liệt kê.

---

#### QW-4. Validate định dạng IP/netmask/gateway ngay tại client
**Giải quyết lỗi brief nêu (N1) · Ước lượng: 1 ngày**

**Giải pháp thiết kế.** Thêm `IpField` chuyên dụng, validate khi rời ô (`onBlur`) và khi nhập, chặn `Stage` nếu còn lỗi.

```tsx
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/
const NETMASKS = ['255.255.255.0','255.255.254.0','255.255.252.0','255.255.0.0','255.0.0.0', ...]
```

**Thông số kỹ thuật:**
- `inputMode="decimal"` → bàn phím số trên tablet.
- `aria-invalid={Boolean(error)}` + `aria-describedby` trỏ tới `<span role="alert">` — khớp mẫu đã dùng ở `TimeSettingsPage`.
- Viền lỗi dùng `--c-fault-fg` (đạt 4.41:1), **kèm icon ⚠ và chữ** — không chỉ dựa vào màu (WCAG 1.4.1).
- **Netmask → `<select>`** thay vì text tự do (giảm sai sót, đúng Nielsen #5).
- Kiểm tra ngữ nghĩa liên trường: gateway phải cùng subnet với IPv4 → cảnh báo inline nếu không.
- `BACnet Device ID` → `type="number" min={0} max={4194302}`.
- `BACnet/IP Port` → chặn `NaN`, hiện lỗi thay vì âm thầm về `0`.
- DNS: tách theo dấu phẩy, `filter(Boolean)`, validate từng phần tử, hiện lỗi theo từng địa chỉ sai.
- Nút `Stage` `disabled` khi còn lỗi, `title` nêu lý do (khớp mẫu `SchedulerPage`).

---

#### QW-5. Xử lý 8 điều khiển chết
**Ước lượng: 0.5 ngày (gỡ) hoặc 3 ngày (nối chức năng)**

Quyết định sản phẩm: **thà gỡ còn hơn để nút chết** — nút chết phá hủy niềm tin nhanh hơn việc thiếu tính năng.

| Điều khiển | Vị trí | Khuyến nghị |
|---|---|---|
| `SSO / AD` | LoginPage:75 | **Gỡ** (đưa vào roadmap) |
| `Quên mật khẩu?` | LoginPage:70 | **Gỡ** — thiết bị nhúng không có kênh email; thay bằng dòng chữ "Liên hệ quản trị viên để đặt lại mật khẩu" |
| `Ghi nhớ đăng nhập` | LoginPage:69 | **Gỡ** hoặc nối vào thời hạn refresh token |
| Icon `Eye` | LoginPage:65 | **Nối chức năng** — chuyển thành `<button>` toggle `type="password"↔"text"`, có `aria-label` và `aria-pressed` (dễ, giá trị cao trên màn cảm ứng) |
| `Live` | DashboardPage:207 | **Nối** — toggle tạm dừng/tiếp tục biểu đồ live |
| `Lưu ghi chú` | MonitorPage:855 | **Nối** API lưu ghi chú, hoặc gỡ cả textarea |
| `Thêm user` + 2 nút icon | UsersPage | Thuộc MP-6 |
| 4 thẻ "Mục phụ" | SettingsPage | **Gỡ** cả panel cho tới khi có tính năng |
| Nút "Lưu" giả | SettingsPage:38 | **Nối API thật**, hoặc `disabled` + tooltip "Chưa khả dụng". **Tuyệt đối không được hiện toast thành công giả** |

---

#### QW-6. Sửa các lỗi tương phản có thể sửa ngay bằng token
**Ước lượng: 1 ngày**

Các giá trị dưới đây **đã được kiểm chứng bằng công thức WCAG**, không phải ước lượng:

**a) Sửa màu chữ badge — đạt AA trên cả `--c-bg` và `--c-surface`:**

| Trạng thái | Hiện tại | Tương phản | **Đề xuất** | **Đã kiểm chứng** |
|---|---|---|---|---|
| good | `#1E7A3D` | 3.06 ❌ | **`#14532D`** | **5.18** ✅ |
| warn | `#6B5400` | 4.27 ❌ | **`#4A3A00`** | **6.51** ✅ |
| fault | `#B01219` | 3.74 ❌ | **`#7F1015`** | **5.54** ✅ |
| critical | `#B0179C` | 3.17 ❌ | **`#6B0E5F`** | **5.89** ✅ |
| force | `#8A4FBF` | 2.89 ❌ | **`#4C2673`** | **6.24** ✅ |
| off | `#6B7280` | 2.67 ❌ | **`#41464D`** | **5.26** ✅ |

**b) Sửa viền điều khiển (WCAG 1.4.11, cần ≥3.0:1).** Không cần thêm màu mới — **token `--c-line-strong: #5B6066` đã có trong hệ và đạt chuẩn**:

| Màu | vs `--c-bg` | vs `--c-surface` | vs `--c-surface-2` |
|---|---|---|---|
| `--c-border` `#9AA0A6` (đang dùng) | 1.64 ❌ | 1.90 ❌ | 1.44 ❌ |
| **`--c-line-strong` `#5B6066` (đề xuất dùng)** | **3.93** ✅ | **4.56** ✅ | **3.47** ✅ |

→ Giải pháp: đổi viền của **thành phần tương tác** (input, select, button, checkbox, table header) sang `--c-line-strong`; giữ `--c-border` chỉ cho đường phân cách trang trí (không thuộc phạm vi 1.4.11).

**c) Sửa badge số cảnh báo TopBar:** thêm `text-white` vào `TopBar.tsx:36` → 3.21 → **5.16** ✅ (khớp NavRail).

**d) Sửa `.stale`:** bỏ `opacity: 0.62` (`styles.css:57`). Thay bằng chỉ báo **không phá tương phản**: viền gạch đứt 2px `--c-warn-fg` + badge `STALE` + icon đồng hồ. Dữ liệu stale phải *dễ đọc hơn*, không mờ đi.

**e) Bỏ dùng màu ngữ nghĩa cho chuỗi trend** (`TrendsPage.tsx:39`): thay bằng bảng màu định tính trung tính, không trùng đỏ/vàng/tím-force; bổ sung kiểu nét (liền/đứt/chấm) để phân biệt không chỉ bằng màu (WCAG 1.4.1).

---

#### QW-7. Bổ sung `aria-label` cho 20 nút icon-only
**Ước lượng: 0.5 ngày**

Vị trí chính xác đã xác định: `AlarmSettingsPage` (9: dòng 187, 190, 200, 231, 334, 398, 445, 458), `AlarmsPage` (5: 105, 143, 186, 190, 217), `OutputsPage` (4: 173, 174, 305, 421), `DashboardPage` (207), `SettingsPage` (38), `AuxFunctionsPage` (255), `UsersPage` (2 nút).

**Thông số:** mọi nút icon-only phải có `aria-label` **đã dịch** (qua `pick`/`t`), kèm `title` cho tooltip chuột. Đồng thời sửa G12: tên tiếp cận của link cảnh báo thành `pick('Cảnh báo, {n} đang hoạt động', 'Alarms, {n} active')` thay vì nối thành `"Alarm2"`.

---

#### QW-8. Đổi nhãn gây nhầm lẫn nguy hiểm về an toàn
**Ước lượng: 0.5 ngày — tác động an toàn rất cao so với công sức**

| Vị trí | Hiện tại | Đề xuất | Lý do |
|---|---|---|---|
| `AlarmRow.tsx:48` | `Off` | **`Tạm ẩn`** / `Suppress` | "Off" bị hiểu là tắt thiết bị |
| `AlarmDurationDialog` | `Off alarm` | **`Tạm ẩn cảnh báo`** | Như trên |
| `CommissioningPage.tsx:39` | `Release` (ghi 0/false) | **Tách thành 2 nút:** `Ghi 0%` và **`Trả về tự động`** (gọi API release override thật) | Nhầm lẫn giữa "ghi giá trị 0" và "trả quyền cho chương trình" có thể để thiết bị bị ép tắt |
| `AlarmRow` | `Ack`/`Acked`/`Cleared`/`Shelved` | `Xác nhận`/`Đã xác nhận`/`Đã hết`/`Đang tạm ẩn` | Đang hardcode tiếng Anh |
| `SeverityPill` + `AlarmRow` | `info` → badge **xanh** | Badge **xám/xanh dương**, không bao giờ xanh lá | Xanh lá = bình thường trong HMI công nghiệp |
| Dashboard | 2 hệ phân loại mức độ xung đột | Thống nhất **một** thang 5 mức: critical / high / medium / low / info, dùng chung cả app | Nielsen #4 |

---

### 3.2. MAJOR PROJECTS — Tác động lớn, khó làm (lập lộ trình 2-3 sprint)

---

#### MP-1. Hệ thống theme kép + tái cấu trúc design token
**Giải quyết Blocker #4 · Ước lượng: 8-10 ngày**

**Giải pháp thiết kế.** Chuyển từ theme cố định sang hệ 3 chế độ, chọn được ở trang Hiển thị và ghi vào thiết bị (thay cho control chết `density` hiện tại):

1. **Sáng (ISA-101 Level B)** — mặc định, cho phòng có ánh sáng ban ngày. Giữ nền hiện tại, áp toàn bộ token sửa ở QW-6.
2. **Tối (ISA-101 Level A)** — cho phòng máy/tủ điều khiển, ca đêm.
3. **Tương phản cao** — cho môi trường sáng gắt hoặc người dùng thị lực kém (WCAG 1.4.6 AAA).

**Bảng token theme tối — đã kiểm chứng toàn bộ bằng công thức WCAG:**

| Token | Giá trị | vs `bg` | vs `surface` | vs `surface-2` | Ngưỡng | Kết quả |
|---|---|---|---|---|---|---|
| `--c-bg` | `#12161B` | — | — | — | luminance **0.8%** | ✅ (hiện tại 60.0%) |
| `--c-surface` | `#1B2027` | — | — | — | luminance **1.4%** | ✅ (hiện tại 70.5%) |
| `--c-surface-2` | `#242B34` | — | — | — | — | — |
| `--c-text` | `#E8ECF1` | 15.31 | 13.80 | 12.04 | 4.5 | ✅ |
| `--c-text-dim` | `#A6B0BC` | 8.27 | 7.45 | 6.50 | 4.5 | ✅ |
| `--c-good` | `#4ADE80` | 10.42 | 9.40 | 8.20 | 4.5 | ✅ |
| `--c-warn` | `#FBBF24` | 10.88 | 9.81 | 8.56 | 4.5 | ✅ |
| `--c-fault` | `#FF6B6B` | 6.54 | 5.90 | 5.15 | 4.5 | ✅ |
| `--c-critical` | `#F472B6` | 6.86 | 6.18 | 5.39 | 4.5 | ✅ |
| `--c-force` | `#C084FC` | 6.87 | 6.20 | 5.41 | 4.5 | ✅ |
| `--c-accent` | `#60A5FA` | 7.14 | 6.44 | 5.62 | 4.5 | ✅ |
| `--c-line-strong` | **`#606C7E`** | **3.41** | **3.07** | — | 3.0 | ✅ |

> Ghi chú kiểm chứng: giá trị viền đầu tiên tôi thử (`#3A4351`) chỉ đạt 1.82:1 và **không đạt** — đã thay bằng `#606C7E` và kiểm chứng lại đạt trên cả hai nền. Mọi số trong bảng là kết quả tính toán thực tế, không phải ước lượng.

**Thông số triển khai:**
- Dùng `@media (prefers-color-scheme: dark)` làm tín hiệu mặc định **cộng với** ghi đè tường minh qua `:root[data-theme="dark"]` / `[data-theme="light"]` để lựa chọn của người dùng luôn thắng.
- Lưu vào thiết bị (không chỉ `localStorage`) để panel HMI giữ được cấu hình sau khi khởi động lại.
- Bổ sung tự chuyển theme theo giờ (ngày/đêm) — giá trị cao cho ca trực.
- Đưa cả 3 theme vào test tương phản tự động trong CI (script tính toán tương tự script đã dùng cho báo cáo này) để chặn hồi quy.

---

#### MP-2. Navigation responsive cho tablet và panel HMI
**Giải quyết Blocker #5c · Ước lượng: 4-5 ngày**

**Giải pháp thiết kế.** Ba chế độ theo viewport:

| Viewport | Bố cục |
|---|---|
| ≥1280px | Sidebar đầy đủ 232px (như hiện tại) |
| 768–1279px | **Sidebar icon-only 68px** (tận dụng chế độ `collapsed` đã có sẵn) + tooltip |
| <768px | **Drawer trượt** mở bằng nút hamburger ở TopBar + **thanh tab dưới** cho 4 đích quan trọng nhất: Bảng điều khiển / Giám sát / Cảnh báo / Xu hướng |

**Thông số kỹ thuật:**
- Nút hamburger: **44×44px** tối thiểu, đặt trái TopBar.
- Drawer: `role="dialog"` + `aria-modal="true"`, focus trap, đóng bằng `Escape`, trả focus về hamburger — **dùng lại `Modal.tsx`**.
- Thanh tab dưới: cao 56px, mỗi tab ≥44×44px, có `aria-current="page"`.
- Bổ sung **breadcrumb** trong TopBar (giải G11) — thiết yếu khi sidebar bị ẩn.
- Bổ sung **skip-link** "Tới nội dung chính" (WCAG 2.4.1, giải G13).
- Nâng toàn bộ target tương tác: `h-8`/`h-9`/`h-10` → **`h-11` (44px)** cho mọi điều khiển vận hành; giữ `h-8` chỉ cho chip/filter phụ trợ mật độ cao trên màn hình ≥1280px.
- Nâng cỡ chữ tối thiểu: bỏ `text-[9px]` và `text-[10px]`, sàn là **12px**; số đo và giá trị điểm tối thiểu **14px**; badge số cảnh báo tối thiểu **12px bold**.

---

#### MP-3. Đăng nhập thật + thực thi RBAC toàn diện
**Giải quyết Blocker #3 · Ước lượng: 5-6 ngày**

**Giải pháp thiết kế.**

*Phần A — Đăng nhập:* bỏ `readOnly` và giá trị `"admin"`; `login(username, password)`; thêm `autoComplete="username"`/`"current-password"`; chỉ báo Caps Lock; phản hồi số lần thử còn lại và trạng thái khóa tài khoản; **thêm bộ chọn ngôn ngữ vào trang Login** (giải L7 — hiện người Việt bị kẹt ở tiếng Anh trước khi đăng nhập).

*Phần B — Ma trận quyền,* thực thi ở **cả route và từng điều khiển** (hiện chỉ có 1 route được bảo vệ):

| Chức năng | viewer | operator | engineer | admin |
|---|---|---|---|---|
| Xem Dashboard/Monitor/Trends | ✅ | ✅ | ✅ | ✅ |
| Xác nhận / tạm ẩn cảnh báo | ❌ | ✅ | ✅ | ✅ |
| **Force / ghi ngõ ra vật lý** | ❌ | ✅ (có thời hạn) | ✅ | ✅ |
| **Chạy thử (Commissioning)** | ❌ | ❌ | ✅ | ✅ |
| Cấu hình Inputs/Outputs/VP/Lịch/Cảnh báo | ❌ | ❌ | ✅ | ✅ |
| Mạng / Thời gian / Người dùng | ❌ | ❌ | ❌ | ✅ |
| Deploy logic điều khiển | ❌ | ❌ | ❌ | ✅ |

**Thông số:** điều khiển không được phép phải **`disabled` kèm tooltip giải thích lý do**, không ẩn im lặng (Nielsen #1 — người dùng cần biết tính năng tồn tại nhưng cần quyền cao hơn). Route không được phép → trang 403 giải thích rõ, **không redirect âm thầm** — đây cũng là cách sửa Blocker #5a cho `/eng/programming`: thay `<Navigate to="/">` bằng trang giải thích "Tính năng chưa khả dụng trong bản này" kèm đường dẫn quay lại.

Bổ sung: cảnh báo trước khi hết hạn phiên + tùy chọn gia hạn (giải G14).

---

#### MP-4. Trình lập trình logic dạng sơ đồ khối
**Giải quyết Blocker #5b · Ước lượng: 20-25 ngày (dự án riêng)**

**Giải pháp thiết kế.** Canvas kéo-thả 3 vùng: thư viện khối (trái, có tìm kiếm + phân nhóm) | canvas SVG có lưới bắt điểm (giữa) | bảng thuộc tính khối đang chọn (phải).

**Thông số kỹ thuật:**
- Khối tối thiểu **120×64px**; điểm nối (port) **≥16px** đường kính với vùng chạm mở rộng **44×44px**.
- Nối dây: kéo từ port ra port, đường Bezier, **kiểm tra tương thích kiểu dữ liệu** và **báo lỗi tại chỗ** khi nối sai.
- **Hỗ trợ bàn phím đầy đủ** (WCAG 2.1.1): Tab giữa các khối, mũi tên để di chuyển, Enter mở thuộc tính, chế độ nối dây bằng bàn phím. Đây là phần thường bị bỏ qua nhất ở editor đồ họa và là rủi ro tuân thủ lớn nhất của MP-4.
- Undo/redo (≥50 bước), sao chép/dán khối và cụm khối.
- **Diff trực quan trước khi deploy** — bắt buộc với logic điều khiển: hiện rõ khối/dây nào thêm/xóa/đổi tham số.
- Deploy hai bước có xác nhận + ghi phiên bản, cho phép rollback về bản trước.
- Dịch toàn bộ nhãn khối sang tiếng Việt, **giữ tên kỹ thuật trong ngoặc**: `Bộ điều khiển PID (PID)`, `Khóa liên động an toàn (Interlock)`, `Trễ bật (TON)`, `Trễ tắt (TOF)`, `Đếm giờ chạy (RuntimeCounter)`, `Đếm xung (PulseCounter)`.

---

#### MP-5. Lịch vận hành dạng tuần, có kéo-thả
**Ước lượng: 10-12 ngày**

**Giải pháp thiết kế.** Bổ sung chế độ xem **Tuần** (giữ chế độ Danh sách + Wizard hiện có cho nhập chính xác — đúng Nielsen #7):

```
        00  02  04  06  08  10  12  14  16  18  20  22  24
Thứ 2   ░░░░░░░░░░░░████████████████████████░░░░░░░░░░░░░  AHU-01  22°C
Thứ 3   ░░░░░░░░░░░░████████████████████████░░░░░░░░░░░░░
Thứ 4   ░░░░░░░░░░░░████████████████████████░░░░░░░░░░░░░
Thứ 5   ░░░░░░░░░░░░██████████▓▓▓▓▓▓████████░░░░░░░░░░░░░  ← ⚠ chồng lấn
...
```

**Thông số kỹ thuật:**
- Kéo để dịch khối thời gian, kéo cạnh để đổi độ dài; **bắt điểm 15 phút**.
- Chiều cao hàng **≥44px** để chạm được; vùng kéo cạnh **≥24px**.
- **Phát hiện và tô đỏ khối chồng lấn cùng mục tiêu** (giải SC3) — tính năng an toàn quan trọng nhất của mục này.
- **Bắt buộc có phương án bàn phím tương đương** (WCAG 2.1.1): chọn khối bằng Tab, mũi tên dịch 15 phút, Shift+mũi tên đổi độ dài. Kéo-thả **không được là cách duy nhất**.
- Lớp phủ ngày lễ/ngoại lệ; xem trước "trạng thái tại thời điểm" bằng con trượt thời gian.
- Ẩn hoàn toàn tên thanh ghi `TSx n` khỏi giao diện vận hành, chuyển vào panel gỡ lỗi cho kỹ thuật viên (giải SC4).

---

#### MP-6. Quản lý người dùng thật
**Ước lượng: 6-8 ngày**

Thay `getDemoUsers()` bằng API thật; bảng có tìm kiếm/sắp xếp/phân trang; CRUD đầy đủ (thêm/sửa/xóa/khóa/mở/reset mật khẩu); bộ chọn vai trò **kèm bảng giải thích quyền hạn** (giải U6); nhật ký hoạt động theo người dùng; chính sách mật khẩu (tối thiểu 12 ký tự cho hệ thống công nghiệp, không phải 6 như hiện tại); **bắt buộc nhập mật khẩu hiện tại khi đổi mật khẩu** (giải lỗ hổng ở `UserInfoPage`); toàn trang gate `admin`.

---

#### MP-7. Form nhập giá trị thông minh cho Virtual Points
**Ước lượng: 4-5 ngày**

Điều khiển nhập **thích ứng theo `signalType`** của điểm:

| Kiểu | Điều khiển | Thông số |
|---|---|---|
| `analog` | Số + thanh trượt + đơn vị | `min`/`max`/`step` theo dải kỹ thuật, hiện dải cho phép cạnh ô |
| `boolean` | Toggle `role="switch"` | Nhãn rõ trạng thái (BẬT/TẮT), `aria-checked` |
| `integer` | Stepper +/− | Nút ≥44×44px, chặn số thập phân |
| `enum` | Select | Nhãn nghiệp vụ, không phải số thô |
| `string` | Text + đếm ký tự | Hiện giới hạn độ dài |
| `datetime` | Date-time picker | **Không bắt gõ chuỗi ISO** — áp dụng cả cho `TimeSettingsPage` (giải TS2) |

Kèm: validate realtime + `aria-invalid` + lỗi inline; xem trước tác động; nút hoàn tác về giá trị trước.

---

#### MP-8. Hệ thống annunciation cảnh báo theo ISA-18.2
**Ước lượng: 8-10 ngày**

Giải quyết A2, A3, A4, A5, A7 — nhóm khiếm khuyết an toàn của màn hình cảnh báo:

- **Âm báo phân cấp theo mức độ**, tắt tiếng có thời hạn (không tắt vĩnh viễn được), tự phát lại nếu chưa xác nhận.
- **Nhấp nháy cho cảnh báo chưa xác nhận** — theo ISA-18.2, nhấp nháy dừng khi đã xác nhận. Phải tôn trọng `prefers-reduced-motion` và giữ tần số **<3Hz** (WCAG 2.3.1).
- **Sắp xếp theo mức ưu tiên** rồi mới theo thời gian; hiện nổi bật cảnh báo cũ nhất chưa xác nhận (first-out).
- **Xác nhận hàng loạt** với xác nhận gộp một lần (giải A5) và **phân trang** cho lịch sử (giải A6).
- `aria-live="assertive"` cho cảnh báo mới (giải A4).
- **Thang 5 mức đồng nhất** toàn app, `info` **không bao giờ** dùng màu xanh lá (giải A7, D4).
- Xuất CSV/PDF lịch sử cảnh báo (giải A9, T1).
- Tổng quan "alarm flood" và thống kê theo ISA-18.2 (số cảnh báo/10 phút, top cảnh báo lặp).

---

### 3.3. FILL-INS — Tác động nhỏ, dễ làm (làm kèm khi có thời gian)

| # | Việc | Thông số | Công sức |
|---|---|---|---|
| FI-1 | **Bổ sung nút "Trả về tự động toàn bộ"** ở Commissioning, Monitor, Outputs | Nút `variant="danger"`, `h-11`, có xác nhận liệt kê rõ các điểm sẽ được giải phóng | 0.5 ngày |
| FI-2 | Chuẩn hóa padding danh sách | Hàng danh sách `py-3` → **`py-3.5`** (56px chiều cao hàng, chạm tốt hơn); mật độ compact giữ `py-2.5` | 0.5 ngày |
| FI-3 | `role="switch"` + `aria-checked` cho mọi Toggle | `NetworkPage.tsx:539` và các toggle tương tự | 0.5 ngày |
| FI-4 | `aria-pressed` cho nút dạng chọn | Thẻ ngôn ngữ/mật độ (`DisplaySettingsPage`), nút ngày (`SchedulerPage`), nút lọc (`AlarmsPage`) | 0.5 ngày |
| FI-5 | `role="meter"` + `aria-valuenow/min/max` cho `MiniDial` và `Gauge` | WCAG 1.3.1 | 0.5 ngày |
| FI-6 | Sửa `Modal` dùng ID động | Thay `"modal-title"` cứng bằng `useId()` (WCAG 4.1.1) | 0.5 ngày |
| FI-7 | Dọn màu off-token và entity | Gỡ `#6E5A2E`, `rgba(224,161,6,...)`, `rgba(143,161,189,0.18)`, `rgba(229,72,77,...)` → dùng token; đổi `&deg;` → `°` | 0.5 ngày |
| FI-8 | Xác nhận khi đóng modal có thay đổi chưa lưu | Chặn `onMouseDown` backdrop khi form `dirty`, hỏi trước khi mất dữ liệu (giải G8) | 1 ngày |
| FI-9 | **Chuyển nút Đăng xuất khỏi vị trí dễ bấm nhầm** | Đưa vào menu người dùng (`/me`) hoặc dropdown avatar; nếu giữ ở TopBar thì `variant="danger"` + xác nhận, và **tách xa nút đổi ngôn ngữ ≥16px** (giải G9) | 0.5 ngày |
| FI-10 | Xử lý 3 trang mồ côi | `user-parameters` (sửa subtitle lạc hậu + dịch 35 khóa + đưa vào menu), `aux` (chặn route hoặc hoàn thiện), `diagram` (đưa vào menu + **bổ sung `isFreshIso`**) | 1 ngày |
| FI-11 | Bổ sung nhánh xử lý lỗi thiếu | `CommissioningPage` không kiểm tra `state.error` (C8); thêm `refreshMs` cho polling điểm (C7) | 0.5 ngày |
| FI-12 | Đầy đủ danh sách timezone IANA | Thay 4 mục hardcode bằng `Intl.supportedValuesOf('timeZone')` có tìm kiếm (giải TS1 — chặn thương mại hóa toàn cầu) | 1 ngày |

---

### 3.4. Lộ trình đề xuất

| Sprint | Nội dung | Kết quả kỳ vọng |
|---|---|---|
| **Sprint 1** (2 tuần) | QW-1…QW-8 + FI-1, FI-11 | Hết dữ liệu bịa · Có xác nhận cho hành động vật lý · Hết chuỗi thiếu dấu · Có validate IP · Hết nút chết · Tương phản badge/viền đạt AA · **Điểm dự kiến: 3.5 → 6.0** |
| **Sprint 2** (3 tuần) | MP-1 (theme) + MP-2 (responsive) + MP-3 (login/RBAC) + FI-2…FI-6, FI-9, FI-12 | Có theme tối cho phòng máy · Dùng được trên tablet · RBAC thực thi đầy đủ · **Điểm dự kiến: 6.0 → 7.5** |
| **Sprint 3** (3 tuần) | MP-6 (quản lý user) + MP-7 (form VP) + MP-8 (annunciation) + FI-7, FI-8, FI-10 | Đạt ISA-18.2 cho cảnh báo · Quản trị người dùng hoạt động · **Điểm dự kiến: 7.5 → 8.5** |
| **Sprint 4-6** | MP-5 (lịch tuần) → MP-4 (canvas lập trình) | Hoàn thiện bộ công cụ kỹ thuật · **Điểm dự kiến: 8.5 → 9.0+** |

**Điều kiện tiên quyết để nghiệm thu bản thương mại (không thể thương lượng):**
1. Không còn bất kỳ dữ liệu thiết bị bịa đặt nào trong UI (QW-1).
2. Mọi hành động tác động vật lý đều có xác nhận nêu rõ hậu quả và có gate quyền (QW-2, MP-3).
3. Toàn bộ text đạt WCAG 2.2 AA 4.5:1, thành phần đồ họa đạt 3.0:1, ở **cả** theme sáng và tối (QW-6, MP-1).
4. Không còn điều khiển chết và không còn thông báo thành công giả (QW-5).

---

## PHỤ LỤC A — Bản đồ mã nguồn theo mức độ hoàn thiện

| Mức | Màn hình | Nhận xét |
|---|---|---|
| 🟢 **Sẵn sàng sản xuất** (cần sửa nhỏ) | `TimeSettingsPage`, `HelpPage`, `InputsPage`, `Modal`, `TrendsPage` (tầng dữ liệu) | Chuẩn mực nội bộ về validation, i18n và a11y — nên dùng làm khuôn mẫu |
| 🟡 **Nền tốt, cần hoàn thiện** | `NetworkPage`, `OutputsPage`, `SchedulerPage`, `AlarmSettingsPage`, `VirtualIoPage`, `MonitorPage` | Logic nghiệp vụ chín, cần bổ sung i18n + a11y + xác nhận an toàn |
| 🟠 **Cần làm lại phần lớn** | `DashboardPage`, `AlarmsPage`, `LoginPage`, `DisplaySettingsPage` | Vấn đề nằm ở tầng thiết kế, không chỉ sửa chuỗi |
| 🔴 **Vỏ rỗng / mockup** | `UsersPage`, `SettingsPage`, `CommissioningPage`, `ProgrammingPage`, `AuxFunctionsPage` | Cần xây dựng thực sự — hiện đang tạo ấn tượng sai về mức độ hoàn thiện của sản phẩm |

## PHỤ LỤC B — Đối chiếu các điểm brief nêu với kết quả kiểm chứng

| Điểm brief nêu | Kết quả kiểm chứng | Vị trí |
|---|---|---|
| Lỗi tự động redirect trang Programming | ✅ **Xác nhận** | `App.tsx:66`, `config.ts:6-9` |
| Thiếu xác thực định dạng IP mạng | ✅ **Xác nhận** | `NetworkPage.tsx:535` (`Field` không có validate) |
| Lỗi hiển thị không dấu `"Cau hinh canh bao"` | ✅ **Xác nhận** | `i18n.tsx:175` — và thêm 59 chuỗi khác |
| Thiếu nút Release All ở Commissioning | ✅ **Xác nhận** | `CommissioningPage.tsx` (43 dòng, không có) |
| Nút đăng xuất đặt vị trí dễ bấm nhầm | ✅ **Xác nhận** | `TopBar.tsx:47` — `ghost`, không xác nhận, sát toggle ngôn ngữ |
| Scheduler thiếu kéo-thả | ✅ **Xác nhận** | Toàn sản phẩm không có `draggable`/`onDrag` |
| Cần form nhập thông minh cho Virtual Points | ✅ **Xác nhận** | `VirtualIoPage.tsx` — chưa thích ứng theo `signalType` |
| Lập trình logic cần thiết kế lại dạng Block Diagram | ✅ **Xác nhận** | `ProgrammingPage.tsx` là danh sách + JSON mẫu |
| "Lỗi font tiếng Việt" | ⚠️ **Cần hiệu chỉnh chẩn đoán** — font stack và charset đều đúng; nguyên nhân thật là chuỗi nguồn viết ASCII không dấu. Sửa chuỗi, không đổi font | `styles.css:27`, `index.html:4` |
| Lỗi mã hóa ký tự `&amp;` | ❌ **Không tồn tại** trong mã hiện tại (grep toàn `src/` + `web/` không có kết quả). Chỗ duy nhất dùng entity là `&deg;C` và render đúng thành `°C` | `DashboardPage.tsx:339` |
| Hiển thị không dấu `"Nguoi dung"` | ❌ **Không tồn tại** — chuỗi này viết đúng đủ dấu (`'Người dùng'`) | `i18n.tsx:18`, `UsersPage.tsx:20` |
| Touch target tối thiểu 44×44px "theo WCAG AA" | ⚠️ **Cần hiệu chỉnh tiêu chuẩn** — 44×44px là **SC 2.5.5 mức AAA**; mức **AA là SC 2.5.8 = 24×24px**. Báo cáo giữ mục tiêu 44px nhưng ghi rõ là mức AAA/thực hành tốt HMI | Xem Blocker #4 Bảng F |

---

*Báo cáo lập bởi đánh giá độc lập, dựa trên đọc toàn bộ mã nguồn `src/frontend/` tại nhánh `main` ngày 30/07/2026. Mọi tỷ lệ tương phản được tính bằng công thức relative luminance của WCAG 2.2; mọi khẳng định hành vi đều dẫn chiếu file:dòng và có thể kiểm chứng lại.*
