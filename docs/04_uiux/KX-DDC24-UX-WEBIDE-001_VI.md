# Web IDE UI/UX — MK-DDC-24
## Thiết kế giao diện Web IDE (Frontend)

> **Document ID:** KX-DDC24-UX-WEBIDE-001
> **Phiên bản:** 1.0 | 2026-05-30 · **Trạng thái:** Draft · **Owner:** UX Lead + FE Lead
> 📘 [docs/README](../README.md) · Theo [Design System](KX-DDC24-UX-SYSTEM-001_VI.md) · Triển khai [SW_WEBIDE_DESIGN](../../design/software/SW_WEBIDE_DESIGN_MK-DDC-24_VI.md)
> **Trace:** `IDE-001..034`, `SW-IDE-001..023`

> 🎯 Wireframe + luồng người dùng để FE code đúng ngay từ đầu. Mỗi màn có: mục tiêu, layout (ASCII), thành phần, hành động, quyền.

---

## 1. Người dùng & quyền
| Role | Làm được |
|------|----------|
| **admin** | tất cả: lập trình, cấu hình, user, OTA, force |
| **operator** | xem + force I/O + xem chương trình |
| **viewer** | chỉ xem dashboard/giám sát |

## 2. Luồng chính (user flows)
```
Login → Dashboard ─┬─► Programming (FBD/ST)  → compile → upload → run
                   ├─► I/O Config (sensor/AO mode/safe-state)
                   ├─► Monitor (watch table + force)
                   ├─► Network/BACnet config
                   ├─► Alarms
                   └─► System (user, OTA, logs)  [admin]
```

## 3. Khung layout chung
```
┌───────────────────────────────────────────────────────────┐
│ ☰  MK-DDC-24  ·  FCU-Zone-3F-A        🟢 online   admin ▼ │  Topbar
├──────┬────────────────────────────────────────────────────┤
│ Nav  │                                                     │
│ 🏠 Dash                                                    │
│ 🧩 Program        [ Nội dung màn hình theo mục chọn ]       │
│ 🔌 I/O Config                                              │
│ 📈 Monitor                                                 │
│ 🌐 Network                                                 │
│ 🔔 Alarms (2)                                              │
│ ⚙ System                                                  │
└──────┴────────────────────────────────────────────────────┘
```

## 4. Màn hình chi tiết

### 4.1 Dashboard
**Mục tiêu:** nhìn 5 giây biết thiết bị khoẻ không.
```
┌─ Trạng thái ──────┐ ┌─ I/O nhanh ───────────────┐
│ 🟢 Online          │ │ UI1 23.5°C ✓  AO1 50% ✓   │
│ IOP: normal        │ │ UI2 45%RH  ✓  DO1 ON  ✓   │
│ BACnet: connected  │ │ DI1 ●  DI2 ○  ...          │
│ Uptime 12d 4h      │ └───────────────────────────┘
└────────────────────┘ ┌─ Alarm gần đây ───────────┐
┌─ Gauges ──────────┐  │ ⚠ 10:30 UI3 over-range    │
│ (arc) 23.5°C       │  │ ✕ 09:12 IOP timeout (ack) │
└────────────────────┘  └───────────────────────────┘
```
**Hành động:** click point → chi tiết. **Quyền:** mọi role.

### 4.2 Programming (FBD / ST)
**Mục tiêu:** vẽ logic điều khiển, nạp xuống PLC.
```
┌ Toolbar: [FBD][ST]  ▷Compile  ⬆Upload  ⬇Download  ▶Run ⏹Stop ↻Reset │
├─ Palette ──┬─ Canvas (FBD drag-drop) ───────────┬─ Properties ──┐
│ TON  TOF   │   ┌────┐      ┌─────────┐           │ Block: PID    │
│ PID  CTU   │   │ AI1├─SP──►│PID      ├──► AO1     │ Kp 2.0        │
│ ADD  CMP   │   └────┘  PV  │COMPACT  │            │ Ti 120        │
│ ...        │   ┌────┐      └─────────┘            │ Td 0          │
│            │   │AI2 ├─PV                          │               │
└────────────┴──────────────────────────────────────┴───────────────┘
Trạng thái: ● Compiled OK · last upload 10:20 · PLC: RUNNING
```
- ST editor: highlight + lỗi compile inline.
- **Xác nhận** khi Upload (ảnh hưởng điều khiển thực). **Quyền:** admin.

### 4.3 I/O Config
**Mục tiêu:** khai báo loại sensor mỗi UI + mode AO + safe-state.
```
┌ UI Channels ─────────────────────────────────────────┐
│ Ch │ Type      │ Unit   │ Detected      │ Scale       │
│ 1  │ NTC10k  ▼ │ °C     │ ✓ gợi ý NTC10k│ —           │
│ 4  │ 4-20mA  ▼ │ %    ▼ │ —             │ 0–100       │
└──────────────────────────────────────────────────────┘
┌ AO ──────────┐ ┌ Safe-state ──────────┐
│ AO1 0-10V ▼  │ │ AO1 → 0 V            │
│ AO2 4-20mA▼  │ │ DO1 → open          │
└──────────────┘ └──────────────────────┘   [Lưu] (validate schema D-5)
```
- Auto-detect: hiện gợi ý, user xác nhận (FW-IO-010). **Quyền:** admin.

### 4.4 Monitor (watch + force)
```
┌ Watch Table (realtime, cell nhấp nháy khi đổi) ───────────┐
│ Point │ Value  │ Unit │ Quality │ Force │ Action          │
│ UI1   │ 23.5   │ °C   │ ✓ good  │  —    │                 │
│ AO1   │ 50.0   │ %    │ ✓       │ 🔒75  │ [Force][Release]│
└───────────────────────────────────────────────────────────┘
```
- Force mở modal: nhập giá trị + cảnh báo "tự hết hạn sau 10 phút". **Quyền:** admin/operator.

### 4.5 Network / BACnet
Form: DHCP/Static IP, hostname; BACnet Device ID/Name, BIP port, MS/TP mac/baud, RS-485 mode (cảnh báo "đổi cần reboot"). **Quyền:** admin.

### 4.6 Alarms
Danh sách alarm (severity màu theo design system), filter, **Ack**. **Quyền:** operator+.

### 4.7 System (admin)
Tab: **Users** (CRUD, role, đổi mật khẩu), **Firmware/OTA** (upload `.kxpkg`, tiến độ %, rollback), **Logs** (tải gzip), **About** (version, uptime).

## 5. Trạng thái & phản hồi
- Loading skeleton khi tải; toast khi lưu/lỗi.
- Mất kết nối thiết bị → banner đỏ "Mất kết nối" + auto-retry.
- Hành động nguy hiểm (force/upload/restart/OTA) → modal xác nhận (danger).

## 6. Responsive & tiếp cận
- Desktop chính; tablet cho commissioning tại hiện trường.
- Điều hướng bàn phím; tương phản AA; nhãn ARIA.

## 7. Handoff cho FE
- Mỗi màn → component Svelte + state (loading/empty/error/data).
- Map API theo [openapi.yaml](../../design/interfaces/openapi.yaml); realtime qua WebSocket `/ide/monitor`.

---
## Revision History
| Version | Ngày | Người | Thay đổi |
|---------|------|-------|----------|
| 1.0 | 2026-05-30 | UX+FE Lead | Phát hành đầu — wireframe 7 màn + flow + quyền |
