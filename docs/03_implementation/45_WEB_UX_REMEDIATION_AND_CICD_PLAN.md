# Plan 45: Dọn blocker Web UI/UX và hoàn tất CI/CD tự động deploy

> **Trạng thái:** **Approved và đã thực thi Track A** — chủ dự án phê duyệt ngày 2026-08-01 kèm ba quyết định ở §6.
> **Phiên bản:** 1.1 | **Ngày:** 2026-08-01
> **Owner:** Dev Web (FE) + Dev SOM/Ops
> **Nguồn quyết định:** [Audit UI/UX 2026-07-30](../07_records/reviews/KX-DDC24-UIUX-PRODUCT-AUDIT-2026-07-30.md) · [ADR-022](../adr/ADR-022-ci-cd-tu-dong-deploy-xuong-board.md) · [REVA_SCOPE_ROADMAP](../01_specs/REVA_SCOPE_ROADMAP_MK-DDC-24_VI.md)
> **Phạm vi task:** `WEB-UX-001…012` (**xong**), `QA-E2E-001` (**xong**), `OPS-CD-001…005` (**hoãn** — xem §6.4)
> **Ngoài phạm vi:** FW MCU (STM32G0B1RB) — chủ dự án đã quyết hoãn ngày 2026-08-01. Xem §7.

## 0. Trạng thái thực thi — 2026-08-01

| Nhóm | Trạng thái | Ghi chú |
|---|---|---|
| A1 `WEB-UX-001…008` | ✅ Done | Cổng ra xanh: vitest 294/294, lint 0, build OK |
| A2 `WEB-UX-009…011` | ✅ Done | RBAC 3 vai trò (không phải 4 — xem đính chính bên dưới) |
| A3 `WEB-UX-012` | ✅ Done | Làm sớm, gộp cùng `WEB-UX-008` vì cùng chạm bộ token |
| `QA-E2E-001` | ✅ Done | `tools/qa/network_board_e2e.sh` |
| Track B `OPS-CD-001…005` | ⏸ Hoãn | Quyết định của chủ dự án 2026-08-01 |

**Đính chính so với bản 1.0.** §2.2 mục B3b viết "RBAC **4 vai trò** đã có ở
backend". Đọc lại `Role` trong `web/backend/auth.go` thì backend chỉ có **3**:
`viewer`, `operator`, `admin`. Phần đã làm bám con số thật là 3; roadmap và
ADR-021 cũng ghi 3.

**Ba quyết định của chủ dự án ngày 2026-08-01** (trả lời §6):

1. **§6.1 — RBAC:** chọn phương án **(c)**: làm nốt `WEB-UX-009` *và* sửa
   roadmap cho đúng governance. Đã cập nhật `REVA_SCOPE_ROADMAP` §2/§3/§6 và
   thêm `ADR-021` vào `DECISIONS.md`.
2. **§6.2 — Theme tối:** **làm**, không hoãn. Thực tế làm sớm hơn thứ tự trong
   plan: `WEB-UX-012` gộp vào cùng `WEB-UX-008` vì cả hai cùng viết lại bộ
   design token, tách ra sẽ phải làm hai lần. Xem §5 phần "sai lệch có chủ ý".
3. **§6.4 (mới) — Track B:** **hoãn toàn bộ** `OPS-CD-001…005`. `QA-E2E-001`
   vẫn làm vì nó là sửa script kiểm thử, không phải hạ tầng CI/CD.

---

## 1. Mục tiêu và giới hạn

Đưa Web UI từ mức **3.5/10 "chưa sẵn sàng thương mại hoá"** lên mức nghiệm thu được, và biến quy trình cắt bản xuống board từ thao tác tay thành đường tự động có gate test.

Hai track chạy song song vì **không dùng chung người và không đụng cùng file**:

- **Track A — Web UI/UX**: Dev FE, chạm `src/frontend/`, một phần `web/backend/`.
- **Track B — CI/CD**: Dev SOM/Ops, chạm `.github/workflows/`, `tools/deploy/`, cấu hình board.

**Giới hạn cứng của plan này.** Mọi thứ ở đây được kiểm chứng trên board chạy `mkddc-fakemcu` + PTY, **không có I/O vật lý**. Plan này không đóng được khoảng trống đó và không tuyên bố đóng được. Xem §7.

---

## 2. Trạng thái hiện tại — rà lại code ngày 2026-08-01

Audit UI/UX lập ngày 30/07. Sau đó PR #77 đã merge và sửa một phần. Bảng dưới là **kết quả đọc lại code hôm nay**, không phải chép lại audit — vài mục audit nêu nay đã hết, và plan không được tính công cho việc đã xong.

### 2.1. Đã đóng sau PR #77 — không đưa vào plan

| Mục audit | Bằng chứng đọc lại hôm nay |
|---|---|
| QW-4 validate IP tại client | [NetworkPage.tsx:390-392](../../apps/web-ui/src/features/network/NetworkPage.tsx#L390-L392) có `error`, `inputMode="decimal"`; `Field` tại [:806-820](../../apps/web-ui/src/features/network/NetworkPage.tsx#L806-L820) có `aria-invalid` |
| 2/3 nút chết trang đăng nhập | `Quên mật khẩu?` và `Ghi nhớ đăng nhập` đã bị gỡ; chỉ còn `SSO / AD` |
| Toàn bộ finding F-01…F-23 của [review code 30/07](../07_records/reviews/KX-DDC24-CODE-REVIEW-FE-BE-FWSOM-2026-07-30.md) | Đã kiểm từng cái trong code: guard last-admin, seqlock reader BE, prune map `revoked`, Modbus F-08/F-16/F-17/F-18 fail-closed, UART `POLLHUP` F-05, secret JWT không qua `/tmp` F-19, và 3 cổng CI rỗng F-12/F-13/F-14 đều đã có |

### 2.2. Còn nguyên — đây là phạm vi thật của plan

| # | Vấn đề | Bằng chứng hôm nay |
|---|---|---|
| B1 | Dashboard bịa số liệu | [DashboardPage.tsx:146](../../apps/web-ui/src/features/dashboard/DashboardPage.tsx#L146) `?? 23` CPU · [:175](../../apps/web-ui/src/features/dashboard/DashboardPage.tsx#L175) `?? 48` RAM · [:247-248](../../apps/web-ui/src/features/dashboard/DashboardPage.tsx#L247-L248) MAC và giờ hệ thống `23/05/2025` hardcode · [:289](../../apps/web-ui/src/features/dashboard/DashboardPage.tsx#L289) `DeviceStatusCard()` không tham số → luôn "ONLINE" |
| B1' | Login bịa trạng thái service | [LoginPage.tsx:62-65](../../apps/web-ui/src/features/auth/LoginPage.tsx#L62-L65) 4 badge gán cứng `state="online"`, hiển thị **trước khi xác thực** |
| B1'' | Trang người dùng bịa thông tin phiên | [UserInfoPage.tsx:91-92](../../apps/web-ui/src/features/auth/UserInfoPage.tsx#L91-L92) IP và "lần đăng nhập gần nhất" hardcode |
| B2 | Chạy thử tác động vật lý không xác nhận | [CommissioningPage.tsx:39](../../apps/web-ui/src/features/points/CommissioningPage.tsx#L39) — cả trang 43 dòng, một click ghi 50% ra AO / ON ra DO; nhãn "Release" thực chất ghi 0 chứ không trả quyền tự động |
| B3a | Không gate quyền cho hành động vật lý | Chỉ `settings/network` có gate. `eng/commissioning`, `eng/outputs`, `monitor` — nơi ép output — không có |
| B3b | Đăng nhập khoá cứng `admin` | [LoginPage.tsx:78](../../apps/web-ui/src/features/auth/LoginPage.tsx#L78) `value="admin" readOnly` → **RBAC 4 vai trò đã có ở backend không dùng được qua Web** |
| B4a | Tương phản không đạt WCAG AA | `--c-border: #9AA0A6` (1.64:1 vs nền), `--c-warn: #E8B500` (1.18:1 nếu làm chữ) trong [styles.css:7,16](../../apps/web-ui/src/shared/styles.css#L7) — 13/14 biến thể `StatusBadge` fail |
| B4b | Không có theme tối | `styles.css` không có `prefers-color-scheme`, `data-theme` hay `.dark` |
| B5a | Trang Lập trình redirect âm thầm | [App.tsx:72](../../apps/web-ui/src/app/App.tsx#L72) `LEGACY_GRAPH_DEMO_ENABLED ? <ProgrammingPage/> : <Navigate to="/" replace/>` — bấm vào menu thì về Dashboard, không một lời giải thích |
| B5b | Mất hoàn toàn navigation dưới 1024px | [NavRail.tsx:66](../../apps/web-ui/src/shared/components/NavRail.tsx#L66) `hidden … lg:flex`, không có drawer/hamburger thay thế trong `components/` |
| B6 | Nút "Lưu" giả ở trang Thiết bị | [SettingsPage.tsx:38](../../apps/web-ui/src/features/network/SettingsPage.tsx#L38) chỉ `toast.push('success', 'Đã lưu … (demo)')` — không gọi API |
| B7 | Quản lý người dùng là vỏ rỗng | `UsersPage.tsx` đúng 20 dòng |
| C1 | ADR-022 mới xong WP2 | WP1 (runner), WP3 (workflow), WP4 (health check), WP5 (artifact bằng chứng), WP6 (diễn tập rollback chính thức) còn mở; ADR vẫn ở trạng thái `Proposed` |
| C2 | Script E2E mạng còn sót trạng thái | UC-WEB-NET-006 fail do UC-008 để lại giao dịch DHCP chưa kết thúc — lỗi của script, không phải sản phẩm ([evidence 31/07 §6](../07_records/test-evidence/fw-som/2026-07-31-network-page-board-e2e.md)) |

---

## 3. Track A — Web UI/UX

### 3.1. Nguyên tắc xuyên suốt, áp cho mọi task

1. **UI không bao giờ suy đoán dữ liệu thiết bị.** Không có dữ liệu → hiện `—` kèm badge `UNKNOWN` màu xám. Không bao giờ hiện số dự phòng, không bao giờ hiện màu xanh. Hiển thị trạng thái *sai* tệ hơn không hiển thị.
2. **Mọi hành động tác động vật lý phải có xác nhận nêu rõ hậu quả, và phải có gate quyền.** Hai thứ này đi cùng nhau, không được làm một nửa.
3. **Không để nút chết.** Thà gỡ còn hơn để lừa người dùng.
4. **Trang Mạng là chuẩn mực nội bộ.** Cơ chế giao dịch, khoá đường quản trị, validate inline, modal nêu hậu quả — nhân rộng mẫu đó thay vì phát minh lại.

### 3.2. Giai đoạn A1 — Trung thực dữ liệu và an toàn thao tác (ưu tiên tuyệt đối)

Đây là nhóm chặn nghiệm thu. Không có nó thì mọi việc đẹp đẽ khác đều vô nghĩa.

| Task | Nội dung | Đóng | Ước lượng |
|---|---|---|---|
| ✅ `WEB-UX-001` | `DeviceStatusCard` nhận `health \| null`, map `overall` → `ok`/`degraded`/`fault`/`unknown`; bỏ mọi `?? <số>`; MAC và giờ hệ thống lấy từ API thật hoặc hiện `—` | B1 | 1,5 ngày |
| ✅ `WEB-UX-002` | Gỡ 4 badge service gán cứng ở trang đăng nhập (trước xác thực không thể biết trạng thái service — không được đoán) | B1' | 0,5 ngày |
| ✅ `WEB-UX-003` | `UserInfoPage` lấy IP phiên và lần đăng nhập gần nhất từ API, hoặc gỡ hai ô đó | B1'' | 0,5 ngày |
| ✅ `WEB-UX-004` | Viết lại `CommissioningPage`: modal xác nhận nêu rõ point/giá trị/hậu quả vật lý; ô nhập giá trị thay cho 50% hardcode; đổi nhãn `Release` → `Trả về tự động` và tách khỏi "ghi 0"; thêm `Release All`; thêm `refreshMs`; xử lý `state.error` | B2 | 2,5 ngày |
| ✅ `WEB-UX-005` | Gate quyền cho mọi route tác động vật lý: `eng/commissioning`, `eng/outputs`, `monitor` (force), `eng/inputs`, `eng/virtual-points`, `eng/alarm-settings`, `eng/scheduler`, `settings/users`, `settings/time`. Dùng `RequireRole` thay vì `RequireAdmin` cứng, theo đúng ma trận vai trò của backend | B3a | 1,5 ngày |
| ✅ `WEB-UX-006` | `SettingsPage`: nối API thật cho nút Lưu, hoặc `disabled` + tooltip. **Cấm tuyệt đối toast thành công giả.** Gỡ 4 thẻ "Mục phụ" chưa có tính năng | B6 | 1 ngày |
| ✅ `WEB-UX-007` | Trang Lập trình: thay `<Navigate to="/">` âm thầm bằng trang giải thích "Tính năng thuộc Rev B, chưa khả dụng"; hoặc ẩn hẳn mục menu. Không được để bấm vào rồi bị đá về im lặng | B5a | 0,5 ngày |
| ✅ `WEB-UX-008` | Sửa token tương phản: `--c-border`, `--c-warn`, và 13 biến thể `StatusBadge` đạt 4.5:1 cho chữ / 3.0:1 cho đồ hoạ. Kèm test tự động tính tương phản để không tái phát | B4a | 1,5 ngày |

**Cổng ra A1:** không còn dữ liệu bịa ở bất kỳ màn hình nào; mọi hành động vật lý có xác nhận + gate quyền; không còn nút chết và toast giả; tương phản đạt AA ở theme sáng.

### 3.3. Giai đoạn A2 — Đăng nhập thật và dùng được ngoài hiện trường

| Task | Nội dung | Đóng | Ước lượng |
|---|---|---|---|
| ✅ `WEB-UX-009` | Mở khoá ô username; `login(username, password)`; nối FE vào đúng 4 vai trò backend đã có; điều hướng và ẩn/hiện menu theo vai trò; xử lý `SSO / AD` (gỡ hoặc đưa vào roadmap) | B3b | 3 ngày |
| ✅ `WEB-UX-010` | Navigation responsive dưới 1024px: drawer + nút hamburger ở `TopBar`, khoá focus khi mở, đóng bằng `Escape` — theo đúng mẫu `Modal.tsx` đã có sẵn | B5b | 2,5 ngày |
| ✅ `WEB-UX-011` | Quản lý người dùng thật: danh sách, tạo, đổi vai trò, đặt lại mật khẩu, xoá — nối vào API `users` đã có ở backend, tôn trọng guard last-admin | B7 | 3 ngày |

### 3.4. Giai đoạn A3 — Theme tối cho phòng máy

| Task | Nội dung | Đóng | Ước lượng |
|---|---|---|---|
| ✅ `WEB-UX-012` | Tái cấu trúc design token thành hệ hai theme; theme tối đạt WCAG AA đầy đủ; nhớ lựa chọn của người dùng | B4b | 4 ngày |

A3 tách riêng vì nó chạm **mọi** màn hình và sẽ xung đột merge với A1/A2 nếu làm song song. **Phải làm sau A1**, khi token đã ổn định.

---

## 4. Track B — Hoàn tất ADR-022

| Task | Nội dung | WP | Ước lượng |
|---|---|---|---|
| ⏸ `OPS-CD-001` | Cài self-hosted runner trên board: user riêng không đặc quyền, systemd unit, labels `[self-hosted, linux, ARM64, mkddc-board]`, `Nice` thấp và **không** realtime priority (không được cạnh tranh với scan loop `SCHED_FIFO` của core); sudoers allowlist hẹp | WP1 | 1 ngày |
| ⏸ `OPS-CD-002` | `.github/workflows/deploy-board.yml` gọi `tools/deploy/deploy_board.sh`; `needs:` toàn bộ job của `build-and-test.yml`; **chỉ** `push` vào `main`, tuyệt đối không `pull_request`; `concurrency: deploy-board`, `cancel-in-progress: false` | WP3 | 1 ngày |
| ⏸ `OPS-CD-003` | Bổ sung health check: `netcfg_tests` chạy trên board sau khi cắt, và kiểm magic + độ dài `io_shm` chặt hơn mức hiện có | WP4 | 0,5 ngày |
| ⏸ `OPS-CD-004` | Đẩy `DEPLOY_MANIFEST.txt` + log ctest + kết quả health check thành artifact của workflow run | WP5 | 0,5 ngày |
| ⏸ `OPS-CD-005` | Diễn tập rollback **có chủ đích**: cố ý cắt một bản hỏng, khẳng định tự khôi phục; ghi thành evidence chính thức. Nâng ADR-022 từ `Proposed` lên `Accepted` | WP6 | 0,5 ngày |
| ✅ `QA-E2E-001` | Thêm bước dọn trạng thái sau mỗi kịch bản trong script E2E mạng, đóng lần fail UC-WEB-NET-006 | — | 0,5 ngày |

**Ghi chú WP6.** Sự cố deploy hôm nay 01/08 đã vô tình chứng minh đường rollback: health check bắn quá sớm → rollback chạy → SHA-256 sau khôi phục khớp từng byte với bản trước deploy. Đó là bằng chứng thật nhưng **không phải diễn tập có kiểm soát**, nên `OPS-CD-005` vẫn phải làm chứ không được ghi nhận thay.

---

## 5. Thứ tự, phụ thuộc và tổng công

```
Track A (Dev FE):    A1 ─────────────► A2 ────────► A3
                     (9 ngày)          (8,5 ngày)   (4 ngày)
Track B (Dev Ops):   OPS-CD-001..005 + QA-E2E-001
                     (4 ngày)
```

- **A1 → A2**: `WEB-UX-005` (gate quyền) phải xong trước `WEB-UX-009` (đăng nhập nhiều vai trò), nếu không sẽ mở đường cho vai trò thấp chạm vào thứ chưa được gate.
- **A1 → A3**: theme phải làm trên bộ token đã sửa xong, không làm trước.
- **Track B độc lập hoàn toàn** với Track A.
- **`OPS-CD-002` phải sau `OPS-CD-001`** và sau khi Track A có ít nhất A1 xanh — bật auto-deploy trong lúc UI còn blocker nghĩa là tự động đẩy blocker xuống board nhanh hơn.

Tổng: **Track A ≈ 21,5 ngày công** (≈ 4,5 tuần một dev), **Track B ≈ 4 ngày công**.

### 5.1. Sai lệch có chủ ý khi thực thi — ghi lại để không ai tưởng là bỏ sót

**A3 làm gộp vào A1, không làm sau.** Plan viết "A3 tách riêng vì nó chạm mọi
màn hình và sẽ xung đột merge nếu làm song song. **Phải làm sau A1**, khi token
đã ổn định." Khi bắt tay vào `WEB-UX-008` thì lý do đó tự đảo chiều:

- Bộ token cũ đặt nền badge bằng `rgba()` của màu tối phủ lên nền xám. Cách đó
  làm nền TỐI ĐI, kéo tụt tương phản của chính dòng chữ trên nó — tức là nguyên
  nhân gốc khiến 13/14 biến thể trượt AA. Sửa đúng cách buộc phải đổi sang token
  nền đặc `--c-*-bg`, và phải thay hết ~50 chuỗi `rgba()` rải khắp components.
- Đó chính xác là công việc mà theme tối cũng phải làm. Giữ nguyên thứ tự nghĩa
  là chạm cùng những file đó hai lần, và lần thứ hai vẫn xung đột diện rộng.

Vì vậy token được tái cấu trúc **một lần** thành hệ hai theme
(`src/theme/tokens.ts`), và `WEB-UX-012` xong cùng lúc. Rủi ro R1 (hồi quy hình
ảnh diện rộng) không tăng: nó vốn đã là rủi ro của `WEB-UX-008`, và test tương
phản tự động nay chạy trên **cả hai** theme thay vì một.

**Token màu chuyển từ CSS sang TypeScript.** Plan không nói đặt token ở đâu.
Khi viết test tương phản "trên token thật" theo §8.1 mới lộ ra rằng đọc token từ
`styles.css` không khả thi: `?raw` bị plugin Tailwind nuốt (trả chuỗi rỗng), còn
`node:fs` kéo theo `@types/node`. Đặt token ở `src/theme/tokens.ts` và ghi lên
`:root` bằng `applyTheme()` giải quyết cả hai: test import đúng đối tượng ứng
dụng dùng, và hai theme cùng một kiểu nên thiếu token là lỗi biên dịch.

**Phạm vi rộng hơn plan ở vài chỗ, đều cùng một nguyên tắc.** Plan liệt kê từng
lỗi cụ thể; khi sửa thì gặp thêm những lỗi *cùng loại* ngay cạnh, và bỏ qua
chúng sẽ để lại đúng vấn đề mà task đó tồn tại để đóng:

| Ngoài chữ của plan | Cùng nguyên tắc | Task |
|---|---|---|
| Gỡ IP/BACnet ID/Firmware ở trang đăng nhập | §3.1.1 — trước xác thực không biết được, giống hệt 4 badge service | `WEB-UX-002` |
| Nút "Đổi mật khẩu" nối vào `POST /me/change-password` | §3.1.3 — trước đó là toast thành công giả trên một thao tác an ninh | `WEB-UX-003` |
| Bỏ đồng hồ auto-logout và mốc "đăng nhập lúc" sai | §3.1.1 — đếm ngược 15 phút không dẫn tới hành động nào, TTL thật là 1 giờ | `WEB-UX-003` |
| Khoá đường ghi trong `MonitorPage` theo vai trò | Plan có ghi "monitor (force)"; gate ở tầng hành động chứ không chặn cả trang, để ca trực chỉ-đọc vẫn theo dõi được | `WEB-UX-005` |
| Biểu tượng con mắt ở ô mật khẩu bấm được | §3.1.3 — trước đó chỉ là hình vẽ | `WEB-UX-009` |
| Gỡ nút `SSO / AD` | §3.1.3 — nút chết; SSO/AD ghi vào Rev B ở ADR-021 | `WEB-UX-009` |
| Backend thêm `device_mac`/`device_name`/`location`/`description`/`system_time` vào `/system/status` | `WEB-UX-001` yêu cầu "lấy từ API thật hoặc hiện `—`"; không có nguồn thì vế đầu không tồn tại | `WEB-UX-001` |

---

## 6. Ba điểm cần chủ dự án quyết trước khi code

### 6.1. Xung đột phạm vi: RBAC đầy đủ là Rev A hay Rev B?

[REVA_SCOPE_ROADMAP §3](../01_specs/REVA_SCOPE_ROADMAP_MK-DDC-24_VI.md) ghi rõ **"RBAC đầy đủ (Rev A.0 chỉ 1 password web) → Rev B"**. Nhưng thực tế backend **đã** hiện thực 4 vai trò, và audit xếp việc FE khoá cứng `admin` vào mức blocker nghiệm thu.

Nghĩa là sản phẩm đã đi quá roadmap ở backend rồi dừng nửa chừng ở frontend. Ba lựa chọn:

- **(a) Làm nốt** — `WEB-UX-009` như plan. RBAC dùng được thật, khớp với công đã bỏ ra ở backend. **Tao khuyến nghị phương án này**: giữ nguyên hiện trạng nghĩa là toàn bộ công RBAC backend nằm chết, mà vẫn phải bảo trì.
- **(b) Theo đúng roadmap** — bỏ `WEB-UX-009`, chấp nhận 1 tài khoản, đẩy sang Rev B. Tiết kiệm 3 ngày nhưng `WEB-UX-005` mất phần lớn ý nghĩa (gate quyền cho một vai trò duy nhất).
- **(c) Sửa roadmap** — kéo RBAC vào Rev A chính thức, cập nhật `REVA_SCOPE_ROADMAP` và `DECISIONS.md`.

Nếu chọn (a) thì thực chất đang làm (c) mà không ghi giấy tờ — plan này đề nghị làm (c) cho đúng governance.

### 6.2. Theme tối: bắt buộc hay hoãn?

Audit xếp theme tối vào **điều kiện nghiệm thu không thể thương lượng** (§3.4, điều kiện 3), lý do là phòng máy tối và màn hình sáng gây chói. Nhưng nó tốn 4 ngày và chạm mọi màn hình.

Hỏi thẳng: **có khách/dự án cụ thể nào yêu cầu theme tối chưa?** Nếu chưa, tao đề nghị hoãn A3 sang sau, và ghi rõ trong plan là nợ có ý thức chứ không phải bỏ sót.

### 6.3. MP-4 và MP-5 của audit — không đưa vào plan này

Audit đề xuất MP-4 (canvas lập trình dạng sơ đồ khối) và MP-5 (lịch vận hành dạng tuần kéo-thả) ở Sprint 4-6. **Cả hai đã bị roadmap cắt sang Rev B** (`✗ Wiresheet/canvas đầy đủ`, `✗ WeeklySchedule / HolidaySchedule`). Plan này **không** đưa vào, vì đưa vào là âm thầm mở rộng phạm vi Rev A. Nếu muốn kéo lên thì phải sửa roadmap trước, bằng một quyết định riêng.

---

## 7. Điều plan này KHÔNG giải quyết

Chủ dự án đã quyết hoãn FW MCU ngày 2026-08-01. Ghi lại để không ai đọc plan này rồi tưởng sản phẩm đã sẵn sàng:

- [firmware/stm32/Core/Src/main.c](../../firmware/stm32/Core/Src/main.c) hiện là **16 dòng** `printf` + `while(1){}`. Không HAL, không FreeRTOS, không driver ADS131M08/DAC8554, không khung frame IOP, không CRC.
- Mọi kiểm chứng trong plan này chạy trên `mkddc-fakemcu` + PTY. **Không có một điểm I/O vật lý nào được đọc hay ghi.**
- Mốc **Milestone A của roadmap Rev A — "lõi điều khiển chạy trên HW thật" — vẫn không đạt được** sau khi plan 45 hoàn thành. Plan này làm sản phẩm *nghiệm thu được về mặt phần mềm*, không làm nó *chạy được trên phần cứng thật*.
- Hai issue P2 vẫn treo và sẽ phải chốt khi khởi động FW: `IOP-Q-004` (AO safe-state 0V hay 4mA — 0mA là tín hiệu đứt dây ở phía BMS) và `IOP-Q-005` (SEQ wrap 255→0).
- `SW-Q-001` (P1): BTL chưa đặt lab, lead time 4–6 tuần. Là việc **đặt lịch**, không phải việc code — không nằm trong plan này nhưng không được quên.

---

## 8. Định nghĩa Done và bằng chứng bắt buộc

Mỗi task chỉ được ghi Done khi có đủ:

1. **Test tự động** — mỗi task Track A phải kèm test vitest chặn tái phát. Riêng `WEB-UX-008` phải có test **tính tương phản bằng công thức WCAG** trên token thật, không phải kiểm bằng mắt.
2. **Bộ gate đầy đủ xanh**, chạy đúng lệnh trong `CLAUDE.md`: `npx vitest --run --environment jsdom src` (không phải `npm test` — lệnh đó không chạm `e2e/`), `npm run lint`, `npm run build`, và `npx playwright test e2e/network-qa.spec.ts` khi chạm trang mạng.
3. **Kiểm chứng trên board thật** cho `WEB-UX-004`, `WEB-UX-005`, `WEB-UX-009`, và toàn bộ Track B. Chạy trong trình duyệt trên board, không chỉ jsdom.
4. **Cập nhật tài liệu trong cùng phiên**: `CHANGELOG.md` dưới `[Unreleased]`, `TRACEABILITY.md` nếu chạm requirement/interface/test, và trạng thái task trong chính plan này.
5. **Audit UI/UX được chấm lại** sau khi A1 xong, bằng cùng phương pháp (Nielsen · ISO 9241-11 · WCAG 2.2 AA · ISA-101), ghi thành record mới trong `07_records/reviews/`. Con số 3.5 → 6.0 mà audit dự kiến là **ước lượng của người audit, không phải cam kết** — phải đo lại mới biết.

---

## 9. Rủi ro

| # | Rủi ro | Giảm thiểu |
|---|---|---|
| R1 | Sửa token màu (`WEB-UX-008`) gây hồi quy hình ảnh diện rộng, không test nào bắt được | Làm `WEB-UX-008` **cuối** giai đoạn A1; chụp ảnh trước/sau từng màn hình chính; test tương phản tự động |
| R2 | Gate quyền (`WEB-UX-005`) làm hỏng luồng đang chạy được của người dùng hiện tại | Chốt ma trận vai trò↔route trên giấy và cho review **trước** khi code; đối chiếu với ma trận backend đã có |
| R3 | Bật auto-deploy (`OPS-CD-002`) trong lúc UI còn blocker → đẩy blocker xuống board nhanh hơn | Ràng buộc thứ tự ở §5: `OPS-CD-002` chỉ bật sau khi A1 xanh |
| R4 | Board là điểm đơn nhất: vừa là runner CI vừa là môi trường chạy | Đã ghi trong ADR-022 §3. Chấp nhận ở giai đoạn lab; phải xem lại trước khi đấu tải thật |
| R5 | Plan làm UI đẹp lên tạo cảm giác sai rằng sản phẩm đã sẵn sàng, trong khi không có I/O thật | §7 phải được đọc kèm trong mọi báo cáo tiến độ dùng plan này |

---

## 10. Revision History

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-08-01 | Bản đầu. Rà lại code sau PR #77 để xác định phạm vi thật; tách Track A/B; nêu 3 điểm cần chủ dự án quyết; ghi rõ giới hạn không có I/O vật lý. **Chờ phê duyệt.** |
| 1.1 | 2026-08-01 | **Approved và đã thực thi.** Ghi ba quyết định của chủ dự án (§0); đính chính "4 vai trò" → 3; đánh dấu trạng thái từng task; thêm §5.1 ghi các sai lệch có chủ ý khi thực thi (A3 gộp vào A1, token chuyển sang TS, phạm vi mở rộng cùng nguyên tắc); Track B hoãn. |
