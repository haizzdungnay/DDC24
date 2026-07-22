# 09 — mkddc-web Implementation Guide
## MK-DDC-24 — REST API + Web UI + Config + Validator

> **Document ID:** IMPL-WEB-MK-DDC-24-VI
> **Phiên bản:** 1.13 | 2026-07-22 (ADR-017 local-HMI broker adapter implemented; Web REST/FE transaction migration pending)
> **Owner:** Dev 3 (Web/BE)
> **Nguồn-chuẩn:** [REST_API_OPENAPI](../02_design/interfaces/REST_API_OPENAPI_MK-DDC-24_VI.md) ·
> [CONFIG_SCHEMA](../02_design/interfaces/CONFIG_SCHEMA_MK-DDC-24_VI.md) ·
> [GRAPH_SCHEMA](../02_design/interfaces/GRAPH_SCHEMA_MK-DDC-24_VI.md) · [ADR-007](../adr/ADR-007-web-stack-go.md) · [ADR-009](../adr/ADR-009-isa101-hmi-and-nav-restructure.md) · [UX-SYSTEM](../04_uiux/KX-DDC24-UX-SYSTEM-001_VI.md)

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
| Web network desired config | — | — | ✅ ghi file nhưng REST/FE chưa dùng transaction; local-HMI broker đã nối `mkddc-netcfg` |
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
│   ├── Trends `/trends` — object-list + time-range 30m/1h/6h/24h; chart + bảng stat động
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
│   ├── Programming `/eng/programming` — component library + graph.json validate/test + deploy demo gated
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
> đúng 4 check §5 trên `graph.json`, không IEC 61131-3 (ADR-004 → Rev C). **KHÔNG** thêm/đổi
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
- `/eng/programming` dùng `ProgrammingPage`: thư viện component từ SW_COMPONENT_LIBRARY, chèn node skeleton vào `graph.json`, validate/test bằng `validateGraphLocal()`, Deploy (demo) chỉ bật khi pass.
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
## 2. API list (tối thiểu — khớp REST_API_OPENAPI)

| Method | Endpoint | Auth | Đi tới | Mô tả |
|--------|----------|------|--------|-------|
| POST | `/api/v1/auth/login` | none | — | Login, trả JWT + role (admin/operator/viewer) |
| GET | `/api/v1/points` | Bearer | core (read) | Danh sách 24 IO |
| GET | `/api/v1/points/{id}` | Bearer | core (read) | 1 point {value,quality,ts} |
| PUT | `/api/v1/points/{id}` | Bearer operator+ | core (command) | Ghi giá trị → nguồn manual mức 2 (§1.2); body {value} hoặc {release:true} |
| GET | `/api/v1/system/status` | Bearer | core/iobus metrics | CPU/RAM/IOP |
| GET | `/api/v1/system/config` | Bearer admin | store | Đọc config |
| PUT | `/api/v1/system/config` | Bearer admin | store + core reload | Cập nhật config |
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
| `/data/config/network.conf` | IP/DHCP/DNS |
| `/data/config/device.conf` | BACnet device ID/name |
| `/data/config/users.conf` | user accounts (bcrypt) |

> Web validate input theo schema trước khi ghi; config IO → core/iobus reload (qua signal/IPC).

`network.conf` chỉ là desired configuration. Web REST cũ vẫn ghi file,
`applySystem(system)` trả `applied=false` và frontend chưa xử lý warning này. Local-HMI
broker actions `network_status/validate/stage/apply/confirm/rollback` đã dùng
`/run/mkddc-netcfg/netcfg.sock`, nhưng việc đó không tự động sửa Web REST/FE. Active IP phải
lấy từ network authority; BE/FE không được tự gọi OS command hoặc báo applied trước
transaction confirm.

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
**Rev** 1.12 | 2026-07-22 · DoD: [13_DEFINITION_OF_DONE §5](13_DEFINITION_OF_DONE.md)
- 1.12 (2026-07-22): ghi rõ source network chỉ lưu desired config/pending B7; target BE/FE phải dùng ADR-017/NWC transaction authority và xử lý active/pending/reconnect/rollback.
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
