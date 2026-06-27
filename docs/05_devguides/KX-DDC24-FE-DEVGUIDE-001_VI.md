# FE Developer Guide & Backlog — MK-DDC-24
## Frontend (Web IDE — Svelte + TypeScript) — từ số 0 đến chạy được

> **Document ID:** KX-DDC24-FE-DEVGUIDE-001
> **Phiên bản:** 1.1 | 2026-06-16 · **Trạng thái:** Approved · **Owner:** FE Lead
> 📘 [docs/README](../README.md) · Code: [REPO](KX-DDC24-PM-REPO-001_VI.md) · UX: form/JSON ([ADR-006](../adr/ADR-006-rev-a-ui-form-json.md)), [Design System](../04_uiux/KX-DDC24-UX-SYSTEM-001_VI.md) · API: [openapi.yaml](../02_design/interfaces/openapi.yaml)

> 🎯 FE = trang web KinexusET chạy trong trình duyệt: đăng nhập, cấu hình I/O, lập trình FBD/ST, giám sát realtime. Dev mở file này là: chạy được dev server → gọi được API thật/mock → dựng từng màn theo backlog. **Hợp đồng với BE = `openapi.yaml` (REST) + §3 (WebSocket).**

> ⚠️ **RECONCILE (2026-06-08).** FE Rev A là **React** (thay Svelte), UI **form-based +
> import/export `graph.json`**, **KHÔNG** lập trình FBD/ST trên canvas (wiresheet → Rev B —
> [ADR-006](../adr/ADR-006-rev-a-ui-form-json.md)/[ADR-007](../adr/ADR-007-web-stack-go.md)). Hợp đồng REST: [GRAPH_SCHEMA §7](../02_design/interfaces/GRAPH_SCHEMA_MK-DDC-24_VI.md) + `openapi.yaml`.
> Backlog FBD-editor đọc như tham chiếu Rev B.

> 📌 **Trạng thái triển khai (ĐÃ làm 2026-06-16, demo UI client-side).** App thực tế nằm tại
> `src/frontend/` (React 18 + Vite + Tailwind v4), 12 trang: Login, Dashboard, Monitor, Alarms,
> Trends, Scheduler, Network, Users, Settings, SystemHealth, Commissioning, Validator. 4 trang
> vừa chỉnh khớp spec ở mức **demo (qua simulator, chưa nối backend, contract không đổi):**
> **Trends** — filter object-list + time-range (bám BACnet Trend Log, SRS IDE-024/025);
> **Scheduler** — BACnet Weekly_Schedule tuần-lặp, bỏ "Tháng" (PRD FR-004);
> **Network** — Northbound BACnet/IP + Southbound Modbus RTU master, bỏ cây controller (ARCH-R010);
> **Validator** — kiểm `graph.json` 4 check Rev A (GRAPH_SCHEMA), không FBD/ST (ADR-004 → Rev C).
> Chi tiết: [09_MKDDC_WEB §1](../03_implementation/09_MKDDC_WEB_IMPLEMENTATION_GUIDE.md) + CHANGELOG `[Unreleased]`.

---

## 1. Chuẩn bị
| Việc | Lệnh |
|------|------|
| Node | `nvm install 20 && nvm use 20` |
| Khởi tạo | `cd webide && npm install` |
| Dev server | `npm run dev` → http://localhost:5173 (proxy API tới thiết bị/mock) |
| Mock API | `npx @stoplight/prism mock ../design/interfaces/openapi.yaml` (chạy BE giả) |
| Đọc trước | [ADR-006](../adr/ADR-006-rev-a-ui-form-json.md) (UI form/JSON Rev A), [GRAPH_SCHEMA](../02_design/interfaces/GRAPH_SCHEMA_MK-DDC-24_VI.md) (REST/graph), [Design System](../04_uiux/KX-DDC24-UX-SYSTEM-001_VI.md) (tokens) |

## 2. Bản đồ file
```
webide/src/
├── lib/
│   ├── api/            ← client REST sinh từ openapi.yaml (openapi-typescript)
│   ├── ws/             ← WebSocket monitor client (§3)
│   ├── stores/         ← Svelte stores: auth, points, alarms
│   ├── theme/          ← tokens.css từ Design System
│   └── components/     ← Button, PointCard, Gauge, DataTable, Modal, StatusBadge...
├── routes/
│   ├── login/
│   ├── dashboard/
│   ├── program/        ← FBD canvas + ST editor
│   ├── io-config/
│   ├── monitor/        ← watch table realtime + force
│   ├── network/        ← IP/WiFi/BACnet/fieldbus
│   ├── alarms/
│   └── system/         ← users, OTA, logs
└── app.html
```

## 3. 📡 Hợp đồng WebSocket realtime (monitor) — BE ↔ FE
> REST cho đọc/ghi rời rạc; **realtime** (watch table, live dashboard) dùng WebSocket.

- **Endpoint:** `wss://<ip>:8443/api/v1/ws/monitor` (JWT qua query `?token=` hoặc header khi handshake).
- **Client → Server (subscribe):**
```json
{ "op": "subscribe", "points": ["UI1","AO1","DI1"] }   // hoặc "points":"*"
```
- **Server → Client (cập nhật, đẩy theo COV, tối đa ~5Hz):**
```json
{ "op": "update", "ts": "2026-06-01T10:00:00+07:00",
  "points": [ { "id":"UI1", "value":23.5, "unit":"°C", "quality":"good", "forced":false } ] }
```
- **Client → Server (force, cần quyền):**
```json
{ "op": "force", "id": "AO1", "value": 75, "expire_s": 600 }
```
- **Server → Client (lỗi/hết hạn):** `{ "op":"error", "code":403, "msg":"..." }` · `{ "op":"force_expired", "id":"AO1" }`
- Reconnect: backoff 1→5s; khi reconnect gửi lại subscribe.

## 4. 🚶 Walking skeleton
```
B1  Khởi tạo Svelte + tokens.css + 1 component Button theo Design System   (FE-T01)
B2  Sinh client REST từ openapi.yaml; gọi /system/status hiển thị          (FE-T01)
B3  Màn Login → lưu JWT (httpOnly cookie) → menu theo role                 (FE-T02)
B4  Màn Dashboard: gọi /points, render PointCard                           (FE-T03)
✅  Đăng nhập (mock) → thấy dashboard có giá trị = SKELETON SỐNG
```

## 5. 🎫 Backlog (ticket-level)

### FE-T01 — Khung app + design system + API client ` (S3) `
- **File:** `lib/theme/`, `lib/api/`, `lib/components/Button,StatusBadge`.
- **Acceptance:** Svelte chạy; `tokens.css` từ [Design System](../04_uiux/KX-DDC24-UX-SYSTEM-001_VI.md); client REST sinh từ openapi.yaml; gọi /system/status hiển thị; eslint/tsc sạch.
- **Trace:** SW-IDE-001..003.

### FE-T02 — Auth + role-based shell ` (S3) `
- **File:** `routes/login/`, `lib/stores/auth.ts`, NavRail.
- **Acceptance:** login gọi /auth/login; JWT không lưu localStorage (httpOnly cookie); menu theo admin/operator/viewer; logout; auto-redirect khi 401.
- **Test:** 3 role thấy menu khác nhau.
- **Trace:** SW-IDE-020, SEC.

### FE-T03 — Dashboard ` (S3-4) `
- **Acceptance:** trạng thái (online/IOP/BACnet/uptime), gauges, I/O nhanh, alarm gần đây — theo [ADR-006](../adr/ADR-006-rev-a-ui-form-json.md) (UI form/JSON Rev A); loading skeleton + error state.
- **Trace:** SW-IDE-011.

### FE-T04 — Monitor: watch table realtime + force ` (S4) `
- **File:** `lib/ws/`, `routes/monitor/`, component DataTable.
- **Acceptance:** WebSocket (§3) cập nhật realtime, cell nhấp nháy khi đổi; Force modal (giá trị + cảnh báo auto-expire 10') gọi op force; banner "mất kết nối" + reconnect.
- **Test:** force → BE đổi đầu ra; mất mạng → reconnect.
- **Trace:** SW-IDE-013.

### FE-T05 — I/O Config ` (S4) `
- **Acceptance:** form sensor type/AO mode/safe-state; validate theo [D-5 schema](../02_design/interfaces/CONFIG_SCHEMA_MK-DDC-24_VI.md); auto-detect gợi ý + xác nhận; lưu.
- **Trace:** SW-IDE-010..012.

### FE-T06 — Network/BACnet/Fieldbus config ` (S4) `
- **Acceptance:** IP/DHCP/WiFi; BACnet/IP Device ID/Name/BBMD; **field bus**: baud + danh sách slave (addr+profile+poll) + trạng thái online/offline; cảnh báo "đổi cần reboot".
- **Trace:** SW-IDE-022 (đã cập nhật ARCH-R010).

### FE-T07 — Programming: FBD + ST editor ⭐ ` (S5-6) `
- **File:** `routes/program/` (FBD canvas drag-drop; ST code editor — CodeMirror).
- **Acceptance:** kéo-thả khối + nối dây; ST highlight + lỗi compile inline; Compile/Upload/Download/Run/Stop/Reset (xác nhận khi Upload); hiển thị trạng thái PLC.
- **Test:** vẽ 1 FBD đơn giản → compile → upload → chạy.
- **Trace:** SW-IDE-006..009.

### FE-T08 — Alarms + System ` (S7) `
- **Acceptance:** danh sách alarm (màu theo severity) + Ack; Users CRUD; OTA upload + tiến độ %; tải logs.
- **Trace:** SW-IDE-014, OTA, SEC.

## 6. Definition of Done (mọi ticket FE)
- [ ] `tsc` strict + eslint + prettier 0 lỗi; vitest cho logic.
- [ ] Theo Design System (tokens/components), WCAG AA (tương phản, focus, keyboard).
- [ ] Mỗi màn có state: loading / empty / error / data.
- [ ] Không gọi API ngoài openapi.yaml/§3; cập nhật khi đổi contract.
- [ ] PR ghi REQ ID + Task ID.

## 7. Bẫy hay gặp
- Đừng hardcode URL/port — đọc từ config/env; production HTTPS 8443.
- JWT: dùng httpOnly cookie, không localStorage (XSS).
- Realtime: throttle render (~5Hz) kẻo lag khi nhiều điểm.
- Force I/O là hành động **nguy hiểm** → luôn modal xác nhận + hiển thị auto-expire.

---
## Revision History
| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 1.0 | 2026-05-30 | FE Lead | Phát hành đầu — guide + WS contract + walking skeleton + 8 ticket |
| 1.1 | 2026-06-16 | FE | Ghi trạng thái triển khai Rev A (12 trang) + demo 4 trang Trends/Scheduler/Network/Validator khớp spec (contract không đổi) |
