# 09 — mkddc-web Implementation Guide
## MK-DDC-24 — REST API + Web UI + Config + Validator

> **Document ID:** IMPL-WEB-MK-DDC-24-VI
> **Phiên bản:** 1.36 | 2026-07-28 (ADR-017 strict Network v1 + DNS/capability/management) · 1.35 | 2026-07-25 (đồng bộ network authority, validation và FE RBAC) · 1.34 | 2026-07-24 (Web BE/FE dùng ADR-017 network transaction authority)
> **Cập nhật hiện hành:** Rev 1.36 khóa Network GET status cho session xác thực, POST mutation Admin-only, optional DNS theo capability và management hostname read-only. Adapter/FE migration code-local đã hoàn tất; physical IP handoff, target mDNS/DNS và overall Network gate vẫn RED.
> **Owner:** Dev 3 (Web/BE)
> **Nguồn-chuẩn:** [REST_API_OPENAPI](../02_design/interfaces/REST_API_OPENAPI_MK-DDC-24_VI.md) ·
> [CONFIG_SCHEMA](../02_design/interfaces/CONFIG_SCHEMA_MK-DDC-24_VI.md) ·
> [GRAPH_SCHEMA](../02_design/interfaces/GRAPH_SCHEMA_MK-DDC-24_VI.md) · [ADR-007](../adr/ADR-007-web-stack-go.md) · [ADR-009](../adr/ADR-009-isa101-hmi-and-nav-restructure.md) · [ADR-017](../adr/ADR-017-settings-network-tabs-and-state-contract.md) · [UX-SYSTEM](../04_uiux/KX-DDC24-UX-SYSTEM-001_VI.md)

> 🎯 Vai trò: giao diện người dùng + API. **Web KHÔNG mở UART, KHÔNG gọi MCU, KHÔNG ghi
> thẳng IO.** Web gửi command/setpoint cho **core** qua IPC; core quyết định. Mọi command
> ghi **audit log**.

---

## 1. Backend module (Go)

```
web/backend/
├── main.go            — HTTP/HTTPS server, router, TLS 1.3, middleware
├── auth.go            — POST login (JWT), bcrypt, RBAC (admin/operator/viewer — bảng §1.1)
├── points.go          — GET/PUT points → IPC tới core (đọc snapshot, gửi command)
├── system.go          — GET/PUT system status/config (IOP metrics, sensor type, network)
├── alarms.go          — GET alarms, POST ack (đọc alarm bus / eventlog)
├── commissioning.go   — POST test point → command tới core (nguồn manual — mức 2; role operator+)
├── graph.go           — POST validate (validator lib), POST deploy (ghi graph.json)
├── core_client.go     — IPC client tới mkddc-core (/run/mkddc/core.sock — contract đầy đủ: 07 §8)
├── audit.go           — ghi audit log mọi command/deploy (user, ts, action, result)
└── store.go           — SQLite (config.sqlite, eventlog.sqlite) WAL
```

### 1.1 RBAC matrix (CHỐT Rev A — 3 role, khớp openapi.yaml + users.conf)

| Quyền | viewer | operator | admin |
|-------|--------|----------|-------|
| Login / xem points, status, alarms | ✅ | ✅ | ✅ |
| PUT points (manual override) + release | — | ✅ | ✅ |
| Commissioning test DO/AO | — | ✅ | ✅ |
| Ack alarm | — | ✅ | ✅ |
| Graph validate (read-only check) | — | ✅ | ✅ |
| Graph **deploy** | — | — | ✅ |
| Config (io/device/safe-state) | — | — | ✅ |
| Web network transaction | — | — | ✅ Admin adapter + FE dùng `mkddc-netcfg`; GET authority status cho session xác thực, desired config cũ chỉ giữ tương thích |
| Users, OTA, download logs | — | — | ✅ |

> Role cũ "engineer" trong bản trước = operator (commissioning) hoặc admin (deploy) theo bảng
> trên — KHÔNG còn là role riêng. `users.conf` enum: `admin|operator|viewer`.

### 1.2 Priority: web map vào đâu (CHỐT — khớp core 6 mức, PRODUCT_DEFINITION §13)

```
- Web/commissioning command  → nguồn "Local manual"  = mức 2. Client KHÔNG chọn priority.
- BACnet write               → priority array BACnet 1..16 (kx_plc_shm), resolve riêng,
                               kết quả vào core ở mức 3. REST không expose 1..16.
- release=true               → nhả manual (relinquish mức 2); core rơi về nguồn kế.
- Response của core {result, applied_value, active_source} → ghi audit + hiển thị
  "Lệnh bị ghi đè bởi <nguồn>" nếu overridden.
```

```
src/frontend/ (React 18 + TS + Vite + Tailwind v4) — app thực tế Rev A, IA theo ADR-009
├── Login `/login` — auth mock/JWT, lưu token in-memory
├── Overview
│   ├── Dashboard `/` — KPI, health services + IOP/scan metrics, trạng thái truyền thông, I/O, sự kiện, trend
│   ├── Monitoring `/monitor` — bảng 24 IO realtime + chi tiết point + DO toggle (commissioning)
│   ├── Alarm log `/alarms` — list + ack
│   ├── Trends `/trends` — object-list + time-range 30m/1h/6h/24h; chart dùng đủ samples + bảng 5 timestamp gần nhất
│   └── User info `/me` — danh tính, role/permission, session demo, đổi mật khẩu demo, đăng xuất
├── Settings
│   ├── Display `/settings/display` — ngôn ngữ vi/en, ghi chú theme ISA-101 Level A, mật độ hiển thị demo
│   ├── Users `/settings/users` — danh sách tài khoản + role
│   ├── Network `/settings/network` — Northbound BACnet/IP + Southbound Modbus RTU master
│   ├── Time/Date `/settings/time` — NTP, server, timezone, đặt giờ thủ công demo
│   └── Device `/settings/device` — tên thiết bị, vị trí, chu kỳ update/scan, About
├── Engineering
│   ├── Scheduler `/eng/scheduler` — BACnet Weekly_Schedule demo
│   ├── Commissioning `/eng/commissioning` — test DO/AO thật (operator+)
│   ├── Programming `/eng/programming` — legacy graph local simulation; hidden unless demo mode + explicit feature flag
│   └── Alarm settings `/eng/alarm-settings` — bảng ngưỡng HH/H/L/LL, delay, priority, enable
├── Redirect tương thích: `/users`, `/network`, `/settings`, `/scheduler`, `/commissioning`, `/validator`
└── `/health` — đã gộp vào Dashboard, không còn route riêng

web/validator/    — Go library (KHÔNG service): kiểm graph.json trước deploy
web/storage/      — schema SQLite, migration
```

> **Trạng thái Rev A (demo UI): ĐÃ làm 2026-06-16** — 4 trang Trends/Scheduler/Network/Validator
> đã chỉnh khớp spec ở mức **demo UI client-side** (dữ liệu qua simulator, **chưa** nối backend):
> Trends bám mô hình BACnet Trend Log do kỹ sư cấu hình object-list (SRS IDE-024/025);
> Scheduler theo BACnet Weekly_Schedule tuần-lặp, bỏ chế độ "Tháng" (PRD FR-004); Network theo
> ARCH-R010 (north BACnet/IP, south Modbus RTU master), bỏ mô hình cây controller; Validator chạy
> đúng 4 check §5 trên `graph.json` (component graph legacy — không phải IEC 61131-3
> Program Runtime; roadmap ST+FBD riêng theo ADR-020, đang C0, xem
> `KX-DDC24-PROGRAM-RUNTIME-IMPLEMENTATION-PLAN-C1-C10.md`). **KHÔNG** thêm/đổi
> endpoint REST hay WebSocket contract — hợp đồng §2 giữ nguyên.

---

## 1.3 ISA-101 Level A P1/3 — frontend theme/status (Approved 2026-06-16)

Nguồn-chuẩn: ADR-009 + UX-SYSTEM §1/§2/§6/§7/§8. P1 chỉ áp design tokens Level A nền xám sáng và logic màu trạng thái trong `src/frontend`; KHÔNG đổi routing, NavRail IA 3 nhóm, trang mới, REST API hay WebSocket contract.

Scope code P1:
- `styles.css`: giữ tên biến `--c-*`, đổi value sang Level A nền `#C8CCD0`, bỏ dark/cyan glow, `color-scheme: light`.
- `utils.statusColor()` giữ normal/good/ok/online/live/connected trung tính cho text/border/surface; `statusIndicatorColor()` dùng riêng cho chấm/icon nhỏ: OK/ONLINE/ON = xanh lá, OFF/OFFLINE/unknown = xám. Warn/degraded = vàng; fault = đỏ; force = tím; critical/safety = magenta. Mọi badge có icon + chữ.
- Form/input/select/textarea và chart grid/tooltip phải đọc tốt trên nền sáng.

Trạng thái: ĐÃ làm 2026-06-16 — P1 áp token ISA-101 Level A vào frontend theme/status; typecheck/build là verification bắt buộc.

---

## 1.4 ISA-101 P2/3 — grouped navigation/routing (Approved 2026-06-16)

Nguồn-chuẩn: ADR-009 Decision #2 + UX-SYSTEM §6. P2 gom NavRail thành 3 nhóm Overview/Settings/Engineering, thêm route mới và redirect path cũ để không vỡ bookmark. P2 KHÔNG đổi REST API, WebSocket contract, design tokens, nội dung thật của trang stub, hoặc việc gộp `/health` vào Dashboard.

Redirect giữ tương thích:
`/users` → `/settings/users`; `/network` → `/settings/network`; `/settings` → `/settings/device`; `/scheduler` → `/eng/scheduler`; `/commissioning` → `/eng/commissioning`; `/validator` → `/eng/programming`.

Trạng thái: ĐÃ làm 2026-06-16 — NavRail 3 nhóm thu gọn được + routing mới P2; typecheck là verification bắt buộc.

## 1.5 ISA-101 P3/3 — real pages + health fold + Programming (Approved 2026-06-16)

Nguồn-chuẩn: ADR-009 Decision #5/#6/#7 + UX-SYSTEM. P3 thay toàn bộ stub P2 bằng trang demo thật, gộp System Health vào Dashboard, đổi Validator thành Programming và giữ nguyên REST API/WebSocket contract.

Scope code P3:
- `/me`, `/settings/display`, `/settings/time`, `/eng/alarm-settings` là trang thật demo client-side; không còn stub route trong cây ADR-009.
- `/settings/device` nâng thành form Device thật; Language chuyển sang Display, Date/Time chuyển sang Time/Date.
- `/eng/programming` dùng `ProgrammingPage` chỉ trong demo mode khi
  `VITE_ENABLE_LEGACY_GRAPH_DEMO=1`: thư viện component legacy, chèn node skeleton vào
  `graph.json` và validate/simulate cục bộ bằng `validateGraphLocal()`. Live/production
  route và navigation không expose trang này; không có nhãn Deploy tới thiết bị.
- Dashboard hiển thị thêm Services + IOP/scan metrics; `/health` không còn route riêng.
- Dọn nền tối còn sót, dùng token Level A `--c-*`; không hardcode nền navy/dark.

Trạng thái: ĐÃ làm 2026-06-16 — hoàn tất tái cấu trúc ISA-101 P3/3 cho frontend demo Rev A; typecheck là verification bắt buộc.
## 1.6 Owner adjustment — compact status indicator dots (2026-06-16)

Nguồn-chuẩn: owner feedback 2026-06-16 + ADR-009 adjustment. Chỉ áp cho chấm/icon nhỏ dùng làm binary indicator trong dashboard/monitor/badge; không đổi REST/WS contract.

Quy ước:
- OK/ONLINE/ON/GOOD indicator dot/icon = xanh lá `--c-indicator-ok`.
- OFF/OFFLINE/unknown indicator dot/icon = xám `--c-indicator-off`.
- Fault/alarm vẫn đỏ, warn vẫn vàng, force vẫn tím; màn hình nhị phân thô (kể cả DI-01) hiển thị ON xanh, OFF xám; alarm/fault riêng mới dùng đỏ.
- Surface/card/border/text trạng thái bình thường vẫn trung tính; màu indicator không được là nghĩa duy nhất, luôn kèm chữ/icon.

Trạng thái: ĐÃ làm 2026-06-16 — cập nhật indicator dot/icon theo feedback owner; typecheck là verification bắt buộc.
## 1.7 Owner adjustment — dashboard dynamic metrics (2026-06-16)

Nguồn-chuẩn: owner feedback 2026-06-16 + ADR-009 adjustment. Áp cho trạng thái chữ/icon/chấm và mọi giá trị biến thiên trên Dashboard; không đổi REST/WS contract.

Quy ước:
- OK/ONLINE/ON/GOOD, uptime và giá trị trong ngưỡng bình thường = xanh lá `--c-good`/`--c-indicator-ok`.
- OFF/OFFLINE/unknown = xám `--c-indicator-off` khi không phải fault.
- CPU/RAM dùng ngưỡng 70% warn, 90% fault; temperature dùng 50°C warn, 65°C fault; scan time dùng 50 ms warn, 100 ms fault.
- Warning/degraded = vàng/cam; fault/alarm/critical = đỏ/magenta. Surface/card/background vẫn Level A xám sáng.

Trạng thái: ĐÃ làm 2026-06-16 — Dashboard cards, services, IOP/scan metrics và StatusBadge dùng màu theo ngưỡng ISA-101 owner adjustment; typecheck là verification bắt buộc.
## 1.8 Sticky shell chrome — top status bar + NavRail (Approved 2026-06-16)

Nguồn-chuẩn: owner feedback 2026-06-16 + UX-SYSTEM Level A. Web shell phải giữ vùng điều khiển chính luôn nhìn thấy khi người dùng cuộn nội dung trang; không đổi REST API/WebSocket contract.

Quy ước:
- `TopBar` sticky ở đỉnh content pane, nền `--c-surface`, z-index đủ cao để không bị card/chart đè.
- Banner reconnect sticky ngay dưới `TopBar` (`top-16`) để trạng thái mất kết nối không biến mất khi cuộn.
- `NavRail` sticky `top-0`, cao `100vh`; danh sách trong rail tự cuộn khi dài, logo/nhóm điều hướng vẫn cố định.
- Không dùng glow/overlay tối; trạng thái active giữ dấu hiệu trung tính theo ADR-009.

Trạng thái: ĐÃ làm 2026-06-16 — cố định top status bar/reconnect banner/NavRail khi cuộn; typecheck là verification bắt buộc.
## 1.9 Frontend i18n — VI dấu + English mode (Approved 2026-06-17)

Nguồn-chuẩn: owner feedback 2026-06-17 + Display `/settings/display` chọn ngôn ngữ `vi/en`. UI frontend phải hiển thị tiếng Việt có dấu đầy đủ ở mode VI và đổi được các nhãn/nút/toast chính sang tiếng Anh ở mode EN; không đổi REST API/WebSocket contract.

Quy ước:
- Không dùng chuỗi tiếng Việt không dấu trong UI người dùng thấy (`Binh thuong`, `Da luu`, `Mat khau`... phải sửa thành có dấu).
- `src/frontend/src/i18n.tsx` cung cấp helper chọn copy VI/EN; page/component dùng helper này cho tiêu đề, mô tả, nút, filter, placeholder, toast và trạng thái chính.
- Dữ liệu mô phỏng như `point.name`, `alarm.message`, serial/model/IP được giữ nguyên theo simulator; i18n chỉ áp lên chrome/label/nội dung UI.

Trạng thái: ĐÃ làm 2026-06-17 — chuẩn hóa tiếng Việt có dấu và English mode cho frontend demo; typecheck là verification bắt buộc.

## 1.10 Web dependency security refresh (Approved 2026-06-23)

Nguồn-chuẩn: SEC-PROC CVE gate (High/Critical block merge), security scan PR findings for GHSA-fx2h-pf6j-xcff / Vite <= 6.4.2 and Go module high/critical findings in `golang.org/x/crypto`. Scope is dependency/toolchain only; REST API, WebSocket contract, route tree, UI behavior, and runtime authorization are unchanged.

Scope code:
- Upgrade frontend dev toolchain to `vite@8.0.16` and `@vitejs/plugin-react@6.0.2`.
- Update `vite.config.ts` chunk split config to function-form `manualChunks` compatible with Vite 8/Rolldown typing.
- CI frontend build uses Node.js 22 to satisfy Vite 8 engine requirements.
- Upgrade backend Go security modules to `golang.org/x/crypto v0.53.0` and `golang.org/x/sys v0.46.0`; Go module directive becomes `go 1.25.0` with existing `toolchain go1.26.4`.

Trạng thái: ĐÃ làm 2026-06-23 — npm audit High gate is clean; `npm run build`, `npm run lint`, backend `go test ./...`, `govulncheck ./...`, and local Grype clean archive scan pass. No REST/WS contract change.

## 1.11 Owner adjustment — Trends filters and latest-five table (Approved 2026-07-15)

Nguồn-chuẩn: owner feedback 2026-07-15 và clarification 2026-07-22. `Add trend` mở modal có tìm theo ID/tên và lọc loại `UI/AO/DO/VP`; Apply/Cancel giữ selection rõ ràng. `Auto` và các preset 30 phút/1 giờ/6 giờ/24 giờ gửi `source=cache` và chỉ đọc RAM presentation cache 24 giờ; `Custom` gửi `source=database` và chỉ đọc hot SQLite/archive. Frontend dùng explicit UTC `[from,to)`, generation-aware series, gap/partial metadata, boolean stepped lines và không merge tier. Live build mặc định dùng v2 sau activation; `VITE_HISTORIAN_V2_TRENDS=0` chỉ là explicit rollback switch, demo vẫn dùng generated legacy data. Bảng timestamp dưới chart chỉ render 5 mốc mới nhất theo thứ tự thời gian. Không render VP diagnostic logging như database policy.

Trạng thái: ĐÃ làm 2026-07-15 — khôi phục Add Trend modal + tìm ID/tên + lọc UI/AO/DO/VP + custom From/To; bảng timestamp giữ 5 mốc mới nhất, chart giữ toàn bộ data. Focused lint/test và Vite build pass; current frontend npm test/lint/typecheck/Vite build pass. Do not claim repository-wide typecheck or E2E.

## 1.12 Global technical point tags — Phase A (Approved 2026-07-15)

Nguồn-chuẩn: ADR-019 Accepted + Plan 43 Approved + CONFIG_SCHEMA Rev 1.8 + OpenAPI 1.5.0. Scope Phase A: technical `tag` bắt buộc và unique theo normalized lowercase key trên UI/AO/DO/mọi VP kể cả disabled; tag tách `name`/`label`; canonical ID vẫn là runtime identity.

Backend phải validate final candidate namespace dưới một serialization boundary chung cho IO PUT, VP create/update/full replace/delete và `PUT /points/{id}/config`; malformed/reserved sai owner trả 400, duplicate trả 409 kèm structured field details. Point/list response trả `id + tag + name`. Legacy migration deterministic, không suffix/first-wins. Flat-file authority chỉ bao phủ API writers; generation root validation vẫn là release gate.

Frontend Inputs/Outputs/Virtual Points/Monitor phải edit tag riêng, preserve backend `details`, focus field lỗi đầu tiên và không fallback localStorage cho authoritative live rename. Phase B Programming alias không nằm trong completion claim Phase A.

Trạng thái: ĐÃ làm 2026-07-15 — API-writer scope đã có global namespace validation, `id+tag+name`, deterministic migration helper, Inputs/Outputs/VP/Monitor tag editor và structured field errors; Go test/vet + FE test/lint/typecheck/build pass. Local evidence: backend coverage 59.7%; OpenAPI 1.6.0 parses with 41 paths, 216 local refs, zero decoded C1 controls. Release gates còn mở: race bị Windows CGO 64-bit compiler chặn; E2E/manual và generation-root authority chưa đóng.

## 1.13 Owner amendment — unique display names + shared database Logging Control (Approved 2026-07-15)

Nguồn-chuẩn: ADR-018 v1.2, ADR-019 v1.1, CONFIG_SCHEMA Rev 2.1, OpenAPI 1.7.0, Plans 42/43.

- Scope: UI-01..16, AO-01..04, DO-01..04 và mọi created numeric/boolean VP; optional DI ngoài scope.
- Backend quản lý hai namespace độc lập: technical `tagKey` và display `nameKey`. `name/label` required sau migration, trim/collapse whitespace, 1..64 Unicode code point, cấm control, compare Unicode lowercase. Name có thể giống tag.
- Legacy blank name trở thành canonical ID. Content-duplicate name giữ nguyên/readable, nhưng mọi point mutation ngoài conflict-reducing rename trả `409 point_namespace_conflicted`; không auto-suffix, không fail runtime.
- `GET/PUT /api/v1/trends/config` thay legacy global sampler bằng per-point policy revision. Admin chọn 11 interval và bắt đầu ngay bằng server time hoặc UTC tương lai; viewer/operator chỉ xem `off|scheduled|recording`.
- Admin chọn `retentionDays` từ 1 tới maximum theo interval (`1s=30d`, `15s=180d` và bảng đầy đủ từ backend); viewer/operator thấy selection nhưng không sửa. Fine `1s|3s|5s` chỉ raw trong RAM tail, archive dài hạn là aggregate 15 giây.
- Shared `PointLoggingControl` + one two-step `PointLoggingDialog` dùng trên Inputs/Outputs/Virtual Points. VP `logEnabled/logIntervalMs` phải được ghi nhãn Diagnostic log, không phải DB policy.
- Policy sống qua restart, ghi tới khi tắt; disable/rename/delete không xóa history. Canonical ID+generation giữ identity; recreate VP tăng generation.
- Trends bỏ browser historian buffer và frontend tier merge. Backend merge RAM/hot 48h/archive, trả quality/source/tier/gap; boolean dùng stepped line, missing/BAD ngắt line.
- Implementation status: `WEB-HIST-001..005` code/local and bounded board schema-v5 migration/activation are GREEN. Final ARM64 current/rollback parity, 596,284-row migration evidence, explicit maintenance/restart gaps and live unified query smoke are recorded. Source-routed cache/database Trends is code-local GREEN; its board rollout and soak remain pending. Prune remains disabled. Physical power-cut, target eMMC/endurance, 48-hour boundary, browser/manual E2E, long soak and legacy removal remain open.
- Accessibility: text badge không chỉ màu, modal focus trap/Escape/restore trigger, field error `role=alert`, backend past-time/conflict error giữ dialog mở và focus đúng field.

Trạng thái: DONE code/local 2026-07-21 cho WEB-HIST-005 + retention + physical prune + activation transaction engine; production execution/cutover, target benchmark, browser/manual accessibility và E2E vẫn open.

## 2. API list (tối thiểu — khớp REST_API_OPENAPI)

| Method | Endpoint | Auth | Đi tới | Mô tả |
|--------|----------|------|--------|-------|
| POST | `/api/v1/auth/login` | none | — | Login, trả JWT + role (admin/operator/viewer) |
| GET | `/api/v1/points` | Bearer | core (read) | Danh sách 24 IO |
| GET | `/api/v1/points/{id}` | Bearer | core (read) | 1 point `{id,tag,name,value,quality,...}` bằng canonical ID |
| PUT | `/api/v1/points/{id}` | Bearer operator+ | core (command) | Ghi giá trị → nguồn manual mức 2 (§1.2); body {value} hoặc {release:true} |
| PUT | `/api/v1/points/{id}/config` | Bearer admin | config metadata | Đổi technical tag/display name bằng canonical ID; validate cả hai global namespaces |
| GET/PUT | `/api/v1/trends/config` | Bearer viewer/admin | historian policy | Đọc state/capacity/server time/retention maxima; admin atomic-update interval + retention + immediate/future UTC start |
| GET | `/api/v1/history` | Bearer viewer+ | historian query | Explicit UTC range; backend merge RAM/hot 48h/archive và trả gaps |
| GET | `/api/v1/system/status` | Bearer | core/iobus metrics | CPU/RAM/IOP |
| GET | `/api/v1/system/config` | Bearer admin | store | Đọc config |
| PUT | `/api/v1/system/config` | Bearer admin | store + core reload | Cập nhật config |
| GET | `/api/v1/network/transaction` | Bearer viewer+ | `mkddc-netcfg` status | Active/configured/pending, capability và management hostname read-only |
| POST | `/api/v1/network/transaction/{action}` | Bearer admin | `mkddc-netcfg` mutation | Validate/stage/apply/confirm/rollback IPv4 + optional DNS |
| GET | `/api/v1/alarms` | Bearer | eventlog/alarm bus | Alarm active |
| POST | `/api/v1/alarms/{id}/ack` | Bearer | eventlog | Ack alarm |
| POST | `/api/v1/commissioning/points/{id}/test` | Bearer operator+ | core (manual mức 2) | Test DO/AO thật |
| POST | `/api/v1/graph/validate` | Bearer operator+ | validator lib | Kiểm graph.json |
| POST | `/api/v1/graph/deploy` | Bearer **admin** | validator+core | Deploy nếu pass |

---

## 3. Data model (Point response — SW_ARCH §6.2)

```json
{
  "id": "UI1", "type": "AI", "value": 23.5, "unit": "°C",
  "quality": "good", "timestamp": "2026-06-10T10:00:00.123Z",
  "sensor_type": "NTC10k", "fault": false
}
```
System status (versions tách từng thành phần — Contract Freeze; nguồn metrics ghi rõ):
```json
{ "cpu_percent": 12.5, "ram_percent": 35.2, "uptime_s": 86400,
  "versions": { "mcu_fw": "1.0", "iobus": "1.2.0", "core": "1.1.0", "web": "1.0.0" },
  "iop":  { "status": "normal", "crc_errors": 0, "timeouts": 0, "seq_errors": 0,
            "last_io_resp_ms": 12 },
  "scan": { "count": 86400, "overrun": 0 } }
```
> Nguồn: `iop.*` + `versions.mcu_fw/iobus` từ `kx_io_shm` (iobus ghi); `scan.*` +
> `versions.core` từ `kx_plc_shm` (core ghi); web đọc read-only, KHÔNG tự đo lại.

---

## 4. Config model (CONFIG_SCHEMA)

| File | Nội dung |
|------|----------|
| `/data/config/io_config.conf` | sensor type per UI (0-10V/4-20mA/PT100/NTC10k/dry...), AO mode per kênh |
| `/data/config/io_safe_state.conf` | safe-state value per kênh |
| `/data/config/historian.conf` | per-point DB policy, 11 interval, start UTC, capacity và revision |
| `/data/config/network.conf` | BACnet/Wi-Fi/service hostname tương thích; `eth`/DNS chỉ là compatibility shadow read-only, không đổi management hostname |
| `/data/config/device.conf` | BACnet device ID/name |
| `/data/config/users.conf` | user accounts (bcrypt) |

> Web validate input theo schema trước khi ghi; config IO → core/iobus reload (qua signal/IPC).

**Tài khoản mặc định nhà máy (bổ sung 2026-07-31).** Ảnh build/deploy xuất xưởng kèm
đúng một tài khoản gốc `admin` / `admin123`, role `admin`, lưu trong `users.conf`
dưới dạng bcrypt như mọi tài khoản khác. Đây là tài khoản dùng để commissioning lần
đầu và để nghiệm thu sau deploy.

Ràng buộc đi kèm:
- Không hard-code mật khẩu này ở bất kỳ đâu trong source ngoài bước tạo `users.conf`
  lúc provisioning; xác thực vẫn đi qua đúng đường bcrypt.
- Không dùng tài khoản gốc cho tích hợp máy-máy hay script tự động chạy dài hạn.
- Quy trình bàn giao site **phải** đổi mật khẩu gốc và tạo tài khoản vận hành riêng
  theo vai trò; giữ nguyên `admin123` sau bàn giao là finding an ninh.

`network.conf.eth` chỉ là compatibility shadow và REST `PUT /api/v1/network` cũ vẫn được giữ
cho tương thích BACnet/Wi-Fi/service config. Cả endpoint này và `PUT /api/v1/system/config/network` phải giữ
nguyên `eth`; endpoint config từ chối payload cố thay đổi Ethernet/DNS. Luồng lưu BACnet/Wi-Fi
không được sao chép IP/mode/gateway cũ sang authority hoặc đổi WiFi mode. FE không còn cho
sửa Ethernet IPv4 qua form legacy và phải xử lý `ConfigPutResult.applied=false`/warnings,
không báo thành công vô điều kiện.

Field `network.conf.hostname` không phải OS management hostname. Web chỉ hiển thị
`response.management.hostname/mdnsName/stable`; provisioning/đổi stable origin phải chạy
`packaging/configure-web-hostname.sh`, không được gọi từ Network API.

Web adapter authoritative:
- `GET /api/v1/network/transaction` dùng permission `read` và chuyển `status` tới
  `/run/mkddc-netcfg/netcfg.sock`; status read không ghi audit mutation.
- `POST /api/v1/network/transaction/{validate|stage|apply|confirm|rollback}` chỉ cho Admin;
  body tối đa 4 KiB, JSON strict, candidate/transactionId bắt buộc theo action; mỗi POST audit đúng một event.
- Candidate từ chối interface `lo`; DHCP cấm static fields; static chỉ chấp nhận prefix
  `/1..30`, usable unicast host và gateway usable cùng subnet, khác chính candidate IPv4.
- Candidate optional `dns:{mode,servers}`; thiếu DNS là preserve, `auto` chỉ với DHCP/list
  rỗng, `manual` là 1..4 IPv4 canonical duy nhất. Adapter status-preflight capability và fail closed
  nếu response validate/stage không echo đúng capability + pending DNS khi DNS mutation được yêu cầu.
- Response giữ nguyên `result`, `reasonCode`, `state`, `active`, `configured`, `pending`,
  `capabilities`, `management`,
  `rollbackRemainingS`; authority `rejected` không bị đổi thành trạng thái Web tự suy diễn.
- FE poll trạng thái authoritative mỗi giây, tách ACTIVE/KERNEL khỏi PENDING CANDIDATE,
  khóa transition không hợp lệ và hiển thị countdown Confirm/Rollback. Mọi action được audit
  theo user/action/transaction/result nhưng không ghi candidate, DNS hoặc credential.
- Route `/settings/network` và mutation controls chỉ bật cho Admin; GET status vẫn được backend
  cho session xác thực để consumer read-only dùng mà không tạo mutation.

---

## 5. Validator rule (PRODUCT_DEFINITION §14 — Rev A: 4 check cốt lõi)

```
Rev A (bắt buộc):
1. Output có nhiều nguồn ghi mà chưa qua priority → FAIL.
2. AO chưa có limit (min/max) → FAIL.
3. Sensor/IO lỗi chưa có safe-state fallback → FAIL.
4. Input component chưa nối (dangling) → FAIL.
(Đầy đủ: sai kiểu/unit, vòng lặp nguy hiểm, Modbus mất kết nối chưa fallback, graph quá scan
 budget → roadmap.)
Không pass → KHÔNG deploy.
```
**Module format:**
```
Mục tiêu : kiểm graph.json an toàn trước deploy.
Input    : graph.json (GRAPH_SCHEMA).
Output   : {pass: bool, errors: [...]}.
Test     : graph thiếu limit AO → validate FAIL, deploy bị chặn.
Done khi : 4 check chạy đúng; deploy chỉ khi pass.
```

---

## 6. Audit log

```
- Mọi PUT /points, commissioning test, config change, graph deploy → ghi audit:
  {ts, user, action, target, old, new, result, source_ip}.
- result phản ánh kết quả core (accepted / overridden-by-priority / rejected).
- Lưu eventlog.sqlite; không xoá được từ UI thường.
```

---

## 7. Quy tắc bắt buộc (KHÔNG vi phạm)

```
1. Web KHÔNG mở /dev/ttyS2 (không import serial, không gọi IOP).
2. Web KHÔNG gọi thẳng MCU.
3. Web gửi command cho core (qua core_client IPC), core quyết output.
4. Output command phải có audit log.
5. Lỗi hiển thị bằng ngôn ngữ dễ hiểu ("Mất kết nối MCU" thay vì "IOP_FAULT 0x05").
6. Validate mọi input mạng; TLS 1.3; không hardcode secret; JWT hết hạn.
```

---

## 8. Hiển thị lỗi (mapping kỹ thuật → người dùng)

| Kỹ thuật | Hiển thị web |
|----------|--------------|
| iop_status=FAULT | "Mất kết nối với bộ điều khiển IO (MCU)" |
| ui_quality=BAD | "Cảm biến lỗi / mất tín hiệu" |
| RELAY_STUCK | "Relay không phản hồi đúng lệnh" |
| overridden-by-priority | "Lệnh bị ghi đè bởi mức ưu tiên cao hơn (an toàn/fire)" |
| validator FAIL | liệt kê từng lỗi graph bằng tiếng Việt |
| point_name_conflict | "Tên đã được dùng bởi <pointId>"; giữ form mở và focus field tên |
| point_namespace_conflicted | "Cấu hình cũ còn tên trùng; hãy đổi một tên để giảm xung đột" |
| historian_start_in_past | "Thời gian bắt đầu phải từ hiện tại của thiết bị trở đi" |
| historian_storage_unavailable | "Không thể ghi lịch sử; dữ liệu live vẫn tiếp tục" |
| history complete=false | banner partial + khoảng gap; không nối đường giả |

---

## 9. Trace

| Chủ đề | Module | Test |
|--------|--------|------|
| Login/JWT | auth.go | group 5 |
| Point list/detail | points.go | group 5 |
| Commissioning test | commissioning.go | group 5 + group 6 |
| Validator | web/validator | group 5 |
| Không bypass core | core_client.go | group 6 (kiểm không có serial) |

---
**Rev** 1.36 | 2026-07-28 — khóa ADR-017 strict Network v1: GET authoritative status cho session xác thực, POST transaction Admin-only, optional DNS preserve/auto/manual theo capability, management hostname read-only/provision bằng script và Web adapter/FE migration code-local; physical handoff/HIL vẫn RED. · **Rev** 1.35 | 2026-07-25 — Made legacy Ethernet fields compatibility read-only across both config write paths, aligned Go candidate validation with `mkddc-netcfg`, and restricted Network navigation, route access, and authority polling to admins. · **Rev** 1.34 | 2026-07-24 — Added admin-only strict/bounded Web adapter to `mkddc-netcfg`, authoritative active/pending/countdown FE transaction UX, explicit Confirm/Rollback controls, and fail-aware legacy config toast handling; target/manual disconnect-reconnect evidence remains open. ·
**Rev** 1.32 | 2026-07-21 — Completed bounded Orange Pi schema-v5 activation with final ARM64 package parity, owner-safe atomic config replacement, first-cycle restart gaps, 596,284-row migration evidence and live v2 query/writer smoke; release gates remain open. **Rev** 1.31 | 2026-07-21 — Closed ARM64 prebuilt-native parity on frozen schema-v5 legacy/active fixtures with native manifest and unchanged artifacts; live schema-v1/SQLITE_BUSY/migration/cutover remain open. **Rev** 1.30 | 2026-07-21 — Recorded ARM64 native preflight fail-closed on board schema-v1 fixture with unchanged SHA. **Rev** 1.29 | 2026-07-21 — Added native `historian-rollback-package` parity gate with independent current/candidate builds, SHA/build metadata, legacy+active fixture execution, DB-family/archive/evidence immutability and atomic manifest output. **Rev** 1.28 | 2026-07-21 — Added read-only `historian-rollback-verify` schema-v5 fixture gate with exact authority/evidence validation, future-schema rejection and no-mutation SHA proof. **Rev** 1.27 | 2026-07-21 — Added offline `historian-maintenance` operator CLI with exact confirmation, stable UTC, service-presence, path containment and manifest/window/fresh-authority preflight. **Rev** 1.26 | 2026-07-21 — Added maintenance-only ordered writer quiesce/final backup/full migration/evidence/gap/activation coordinator and schema-v5 quiesce proof.
**Rev** 1.23 | 2026-07-21 — Physical rolling-prune engine code/local GREEN with fail-closed activation proof, durable queue/retry, checksum validation, all-tier cutoff and frontier rebase; execution, activation/cutover, target and E2E remain open.
**Rev** 1.22 | 2026-07-20 — Added interval-bounded retention contract/UI, selected/max API fields, policy validation/schema migration and capacity projection; physical prune, target benchmark and activation/cutover remain open. · **Rev** 1.21 | 2026-07-20 — Closed WEB-HIST-005 shared Logging Control/unified Trends code-local gates with 50 frontend tests, UTC range/partial/generation/BAD-gap/stepped coverage, default-off v2 authority gate and no VP diagnostic/database conflation; retained legacy authority, activation/cutover, target and release gates as open. · **Rev** 1.20 | 2026-07-20 — Closed WEB-HIST-004 unified query/CSV code-local gates with JSON/CSV shared iteration, generation-aware RAM/hot/archive merge and supported Linux race; retained legacy authority, WEB-HIST-005, activation/cutover, target and release gates as open. · **Rev** 1.19 | 2026-07-20 — Closed the WEB-HIST-003 shadow code-local slice after deterministic scheduler/error-path TDD and supported Linux race; legacy authority, WEB-HIST-004/005, activation/cutover, target and release gates remain open. · **Rev** 1.18 | 2026-07-20 — Reconciled WEB-HIST-001/002 code-local completion and WEB-HIST-003 shadow-scheduler work in progress; WEB-HIST-004/005, activation/cutover, target and release gates remain open. · **Rev** 1.17 | 2026-07-15 — Reconciled WEB-HIST-001..005 and WEB-NAME-001 status, preserved WEB-016 as technical-tag foundation, and aligned legacy custom-range containment wording. · **Rev** 1.16 | 2026-07-15 — Reconciled local historian/name evidence: backend coverage 59.7%; OpenAPI 1.6.0 parses with 41 paths, 216 local refs, zero decoded C1 controls; Windows CGO 64-bit race block and E2E/manual/generation-root gates remain open. · **Rev** 1.15 | 2026-07-15 — ADR-018/019 amendments: independent unique display names, legacy conflict resolution, shared UI/AO/DO/VP Logging Control, immediate/future start, persistent policy states and backend-owned 48-hour/archive Trends merge; implementation remains open. · **Rev** 1.14 | 2026-07-15 — ADR-019 Phase A API-writer implementation verified locally: global validation, `id+tag+name`, FE tag/error surfaces and migration helper; release gates remain explicit. · 1.13 | 2026-07-15 — ADR-019 Phase A global point tags planned: backend aggregate validation, `id+tag+name`, FE field errors, migration/generation gates; Phase B deferred. · 1.12 | 2026-07-15 — Owner-approved FE adjustment: bảng timestamp Trends chỉ render 5 mốc mới nhất; chart giữ toàn bộ samples/range, không đổi REST/WS contract. · 1.11 | 2026-06-23 · DoD: [13_DEFINITION_OF_DONE §5](13_DEFINITION_OF_DONE.md)
- 1.11 (2026-06-23): Go security dependency refresh: `golang.org/x/crypto v0.53.0`, `golang.org/x/sys v0.46.0`; giữ nguyên REST/WS contract.
- 1.10 (2026-06-23): frontend security dependency refresh: Vite 8.0.16 + plugin-react 6.0.2, Node 22 CI, Vite config manualChunks compatibility; giữ nguyên REST/WS contract.
- 1.9 (2026-06-17): chuẩn hóa i18n frontend: tiếng Việt có dấu + English mode cho label/nút/toast chính; giữ nguyên REST/WS contract.
- 1.8 (2026-06-16): thêm sticky top status bar + NavRail cố định khi cuộn; giữ nguyên REST/WS contract.
- 1.7 (2026-06-16): owner adjustment cho dashboard dynamic metrics: normal/in-range xanh lá, warn cam, fault đỏ; giữ nguyên REST/WS contract.
- 1.6 (2026-06-16): owner adjustment cho compact indicator dots/icons: OK/ONLINE xanh lá, OFF/OFFLINE xám; giữ nguyên REST/WS contract.
- 1.5 (2026-06-16): hoàn tất ISA-101 P3/3: trang thật thay stub, gộp System Health vào Dashboard, Programming + Alarm settings demo; giữ nguyên REST/WS contract.
- 1.4 (2026-06-16): áp ISA-101 P2/3, cập nhật cây trang 3 nhóm + routing mới; giữ nguyên REST/WS contract.
- 1.3 (2026-06-16): áp ISA-101 Level A P1/3 cho frontend theme/status; giữ nguyên REST/WS contract.
- 1.2 (2026-06-16): bổ sung danh sách trang frontend Rev A thực tế (§1) + ghi chú trạng thái demo 4 trang Trends/Scheduler/Network/Validator khớp spec; làm rõ KHÔNG đổi REST/WS contract §2.
- 1.1 (2026-06-11): Contract Freeze — RBAC 3 role, web luôn vào mức manual, IPC contract 07 §8, SystemStatus versions.
- 1.0 (2026-06-10): bản đầu.
