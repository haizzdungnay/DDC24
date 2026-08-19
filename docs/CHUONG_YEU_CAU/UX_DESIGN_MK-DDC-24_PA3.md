# ĐẶC TẢ THIẾT KẾ UX — MK-DDC-24

**Mã tài liệu:** UX-DES-MKDDC24-PA3-001
**Sản phẩm:** MK-DDC-24 — BMS Edge Automation Controller
**Hướng thiết kế:** PA3 — Adaptive Hybrid Control Workspace
**Trạng thái:** Draft for Review
**Ngày:** 2026-08-08
**Yêu cầu đi kèm:** UX-REQ-MKDDC24-PA3-001

> Đây là đầu vào thiết kế PA3 phục vụ truy xuất. Trạng thái hiện thực và bằng
> chứng phê duyệt nằm tại `docs/03_implementation/archive/52_WEB_PA3_DASHBOARD_UX_IMPLEMENTATION_PLAN.md`
> và `docs/07_records/test-evidence/fw-som/2026-08-08-web-pa3-dashboard.md`.

---

## 1. Design Intent

PA3 kết hợp hai lớp trải nghiệm:

- **Operation-first shell:** Dashboard và các page vận hành ưu tiên situational awareness, alarm, point state, trend.
- **Engineering drill-down:** từ point/device/bus có thể mở context detail, diagnostics và configuration sâu mà không đưa engineering noise lên Landing.

Nguyên tắc chính:

> Overview đơn giản; drill-down mạnh; dữ liệu thật; action theo role; generic DDC, không application-template cứng.

---

## 2. Global Shell

### 2.1 Desktop layout

Baseline: **1440×900**.

```text
┌──────────────────────────────────────────────────────────────────────┐
│ TOP BAR — device / state / alarms / time / user                     │ 56
├───────────────┬──────────────────────────────────────────────────────┤
│ NAV           │ PAGE CONTENT                                         │
│ 220–240 px    │                                                      │
│               │                                                      │
│               │                                                      │
└───────────────┴──────────────────────────────────────────────────────┘
```

Collapsed navigation: khoảng 64 px.

### 2.2 Top Bar

Left:
- Product mark
- Device name
- Connectivity indicator

Center/Right:
- Overall system state
- Alarm indicator
- Last data age
- Clock
- User / role
- Locale

Không đặt CPU/RAM/process badges trên top bar.

---

## 3. Navigation Design

```text
OVERVIEW
  Dashboard
  Monitor
  Alarms
  Trends

OPERATION
  Schedules
  Commissioning

ENGINEERING
  I/O
  Virtual Points
  Modbus RTU
  Alarm Configuration
  Diagnostics

SYSTEM
  Network
  Device
  Time
  Users
```

### Navigation rules

- Active item rõ nhưng không dùng neon/glow.
- Badge alarm chỉ tại Alarms và global top bar.
- Viewer vẫn thấy page quan sát được.
- Action bị disable theo role tại context.
- Hidden feature chỉ dùng khi feature chưa release, không dùng để che thiếu permission.

---

## 4. Landing Page — Final Structure

```text
┌──────────────────────────────────────────────────────────────────────┐
│ MK-DDC-24 / TANG-1      NORMAL        0 CRIT · 1 HIGH       ADMIN  │
│ ● Online · Runtime active · Last update 1s                          │
├──────────────────────────────────────────────────────────────────────┤
│ HEALTH                                                               │
│ Controller      Local I/O       Modbus       Network      Historian │
│ GOOD            GOOD            DEGRADED     GOOD         GOOD      │
├──────────────────────────────────────┬───────────────────────────────┤
│ ATTENTION                            │ OPERATING SUMMARY             │
│                                      │                               │
│ HIGH  Pump-02 communication failure  │ UI      15 / 16 Good         │
│       Bus 1 / Slave 12               │ AO       4 / 4 Good          │
│       [Investigate →]                │ DO       4 / 4 Good          │
│                                      │ VP      81 / 83 Good         │
│ MED   UI-03 Temperature High         │ Modbus  51 / 54 Good         │
│       [View point →]                 │                               │
├──────────────────────────────────────┴───────────────────────────────┤
│ MY WORKSPACE                                         [Manage pins]  │
│ ⭐ Room Temp     ⭐ Pump Pressure       ⚠ Pump-02 Status             │
│    23.6 °C         2.41 bar              OFFLINE                    │
│    GOOD            GOOD                                           │
├──────────────────────────────────────────────────────────────────────┤
│ TREND PREVIEW                                  Live · 1h · 8h ·24h │
│                                                                      │
│                         chart                                        │
│                                                                      │
├──────────────────────────────────────┬───────────────────────────────┤
│ ALARM ACTIVITY                       │ OPERATION ACTIVITY            │
│ Critical 0 / High 1 / Medium 1       │ Override released AO-02      │
│                                      │ Schedule enabled             │
└──────────────────────────────────────┴───────────────────────────────┘
```

### 4.1 Landing priority order

1. Overall state
2. Critical/High alarm
3. Communication loss / degraded subsystem
4. Point health degradation
5. User-pinned operational information
6. Trend context
7. Recent activity

### 4.2 Không hiển thị trên Landing

- CPU load card
- Memory card
- service status `core/iobus/web`
- controller diagram lớn
- raw process diagnostics
- firmware/debug counters

Các mục này chuyển Diagnostics.

---

## 5. Health Strip Component

### Structure

```text
[Icon] Controller
GOOD
optional subtext
```

### Supported states

- GOOD
- DEGRADED
- FAULT
- OFFLINE
- UNKNOWN

### Visual behavior

- GOOD: neutral visual, optional subtle green confirmation.
- DEGRADED: amber emphasis.
- FAULT: red emphasis.
- OFFLINE: distinct disconnected state + label.
- UNKNOWN: gray + `Unknown`, không thay bằng OK.

Click mở subsystem detail/diagnostics.

---

## 6. Attention Panel

### Sorting

```text
critical → high → medium → low → info
```

Sau severity, sort mới nhất hoặc impact cao nhất theo nguồn dữ liệu thực tế.

### Alarm row

```text
HIGH
Pump-02 Communication Failure
Bus 1 · Slave 12 · 10:41:22
[Investigate →]
```

Không nhét Ack/Suppress trực tiếp vào Landing nếu khiến thao tác nhầm. Action đầy đủ nằm trong Alarm Detail/Drawer.

---

## 7. Operating Summary

### Card/table hybrid

```text
TYPE      GOOD   UNCERTAIN   BAD   STALE   OFFLINE   TOTAL
UI         15        0        0      0        1       16
AO          4        0        0      0        0        4
DO          4        0        0      0        0        4
Virtual    81        1        0      1        0       83
Modbus     51        0        1      0        2       54
```

Có thể compact trên Landing, nhưng click mở filtered Monitor.

Không có DI row nếu board capability không báo DI.

---

## 8. My Workspace

### Purpose

Cho user tự chọn operational context mà không hard-code application domain.

### Pin types

- Point
- Point group
- Trend preset
- Alarm source
- Modbus device

### Point tile

```text
Room Temperature
23.6 °C
GOOD · UI-01
updated 1s
```

### Abnormal tile

```text
Pump-02 Status
—
OFFLINE
last valid 10:41
```

Không hiển thị `0` khi offline.

---

## 9. Monitor Workspace

Thiết kế 3 vùng theo PA3 drill-down:

```text
┌───────────────┬──────────────────────────────────┬─────────────────┐
│ GROUP/FILTER  │ POINT TABLE                      │ CONTEXT DRAWER  │
│               │                                  │ optional         │
│ All           │ Name      Value  Quality Source  │ Room Temp        │
│ Local I/O     │ ...                              │ 23.6 °C          │
│ Virtual       │                                  │ Raw 4.72 V       │
│ Modbus        │                                  │ GOOD             │
│ Groups        │                                  │ [Trend]          │
│               │                                  │ [Override]       │
└───────────────┴──────────────────────────────────┴─────────────────┘
```

### 9.1 Table columns mặc định

- Name
- Tag
- Value
- Unit
- Quality
- Source
- State
- Updated

Optional columns:
- Raw
- Priority
- Forced
- Logging
- Bus/Slave

### 9.2 Search

Search theo:
- id
- tag
- display name
- group
- source

### 9.3 Filters

- kind
- quality
- online state
- forced
- fault
- writable
- logging
- source

---

## 10. Point Context Drawer

### Default viewer state

```text
ROOM TEMPERATURE                       ×
UI-03 · Local physical I/O

29.4 °C
GOOD

Raw             6.24 V
Updated         1s ago
Source          Local physical I/O
Priority owner  Schedule
Forced          No
Logging         1s

ACTIVE ALARM
Temperature High · HIGH
Limit 28 °C

[Open Trend]   [Alarm Detail]

CONTROL
[🔒 Override — Operator required]
```

### Operator state

```text
CONTROL
Current owner: Schedule
[Override]
```

### Forced state

```text
⚠ MANUAL OVERRIDE ACTIVE
Value       22.0 °C
Owner       Local manual
Remaining   04:32
[Release Override]
```

Không hiển thị priority selector.

---

## 11. Manual Override Dialog

```text
MANUAL OVERRIDE — UI/VP/AO point

Current value        23.6 °C
Current owner        Schedule
New value            [ 22.0 ] °C

Duration
( ) Until released
( ) 15 minutes
( ) 1 hour

This action creates Local Manual override.

[Cancel]                       [Apply Override]
```

Nếu duration không thực sự được backend support cho point override, UI phải bỏ phần duration thay vì giả lập.

Confirmation sau apply phải hiển thị authoritative state từ response/reload.

---

## 12. Alarm Workspace

### 12.1 Main layout

```text
FILTERS            ALARM LIST                         DETAIL
Severity           HIGH Pump-02 Offline               source
State              MED  Room Temp High                condition
Time               ...                                state
Source                                                 timeline
                                                      actions
```

### 12.2 Severity

- Critical
- High
- Medium
- Low
- Info

### 12.3 Actions

Operator+:
- Acknowledge
- Suppress
- Return

Viewer thấy action disabled nếu cần giữ discoverability.

### 12.4 Suppress flow

Dialog phải buộc user chọn:
- duration
- hoặc permanent

Không có submit mơ hồ.

### 12.5 History diff

Khi history event là setting changed, UI có thể render:

```text
BEFORE ↔ AFTER
```

vì backend có full before/after payload.

---

## 13. Trends Design

### Layout

```text
POINT SELECTOR
[UI-01] [UI-03] [MB-041]

TIME
Live | 1h | 8h | 24h | 7d | Custom

CHART
...

LEGEND / QUALITY / GAP
```

### Rules

- 1–8 point.
- Gap = break line, không interpolate mặc định.
- `complete=false` phải có visual warning.
- Aggregate resolution có min/max → cho phép band min–max.
- Export CSV là action secondary.

---

## 14. Modbus RTU Workspace

### Information architecture

```text
Bus 1
├── Device 1
│   ├── Point A
│   └── Point B
└── Device 12
    ├── Point C
    └── Point D
```

### Bus detail

- port
- baud
- parity
- stop bits
- enabled
- state
- total transactions/errors
- port reopens
- latency p50/p95/max
- utilization

### Device detail

- slave address
- poll interval
- enabled
- online
- last seen
- polls/errors

Không đặt baud/parity tại device form.

### Config flow

Admin:

```text
Edit Candidate → Review Diff → Apply
```

Operator:
- Test connection
- Read test

Viewer:
- Observe/export

---

## 15. Network Design

Network configuration dùng wizard/transaction view:

```text
1 Validate
2 Stage
3 Apply
4 Confirm
5 Rollback
```

Sau Apply phải hiển thị countdown nếu backend có transaction timeout để user biết cần Confirm.

Rejected HTTP 200 phải hiển thị `reasonCode`/authoritative state, không coi là success chỉ vì HTTP 200.

---

## 16. Diagnostics Page

Đây là nơi chuyển các thành phần bị loại khỏi Dashboard.

Sections:

- Controller/system status
- CPU
- Memory
- Temperature
- Uptime
- Services: core/iobus/web/... nếu backend có source thật
- I/O subsystem
- Modbus metrics
- Network status
- Historian status
- Firmware/version/device identity

Nếu metric không có nguồn thật → `—`.

---

## 17. Design System

### 17.1 Spacing

Base spacing unit: 4 px hoặc 8 px scale.

Recommended:
- 4 xs
- 8 sm
- 12 md-small
- 16 md
- 24 lg
- 32 xl

### 17.2 Radius

Industrial, restrained:
- 4–6 px cards/inputs
- tránh pill khắp nơi

### 17.3 Borders

- 1 px neutral border
- focus/selection tăng emphasis
- không dùng glow/neon cho normal state

### 17.4 Typography

- Page title: 20–24 px
- Section title: 14–16 px semibold
- Body: 13–14 px
- Data table: 12–13 px nếu cần density
- Primary value: 24–32 px
- Meta/status: 11–12 px, vẫn phải đọc được

### 17.5 Icons

Icon hỗ trợ nhận biết nhưng luôn kèm text cho state/action quan trọng.

---

## 18. Color Semantics

Không quy định mã HEX ở giai đoạn architecture; chỉ quy định semantic token:

- `surface/base`
- `surface/raised`
- `text/primary`
- `text/secondary`
- `border/default`
- `state/critical`
- `state/high`
- `state/warning`
- `state/info`
- `state/offline`
- `state/unknown`
- `action/primary`
- `focus`

Normal state phải visual quiet.

---

## 19. Component Inventory

Shared components cần có:

- AppShell
- TopBar
- NavigationRail
- StatusBadge
- QualityBadge
- SeverityBadge
- HealthCell
- AlarmRow
- PointValue
- PointTable
- FilterBar
- SearchBox
- ContextDrawer
- ConfirmDialog
- PermissionGuard/DisabledActionHint
- TrendChart
- GapIndicator
- ActivityTimeline
- EmptyState
- UnknownState
- ErrorState
- LoadingState
- DiffViewer
- TransactionStepper
- MetricTable

---

## 20. Responsive Strategy

### Desktop ≥1280
Full experience.

### Tablet
- Navigation collapsible.
- Context drawer overlay.
- Table giảm optional columns.

### Mobile
Ưu tiên:
- Dashboard
- Alarm
- Monitor read-only/basic action
- Point detail

Engineering configuration phức tạp có thể hiển thị cảnh báo `Recommended on desktop` thay vì cố nhét toàn bộ form.

---

## 21. Accessibility

- WCAG 2.2 AA target.
- Keyboard navigation.
- Visible focus.
- Không truyền đạt severity chỉ bằng màu.
- Table row/action accessible label.
- Dialog focus trap.
- Escape đóng drawer/dialog khi an toàn.
- Error text gắn trực tiếp field.

---

## 22. Empty / Unknown / Offline States

### Unknown
```text
—
Unknown
No value supplied by source
```

### Offline
```text
—
OFFLINE
Last valid: 10:41:05
```

### Stale
```text
23.4 °C
STALE
Updated 4m ago
```

### Bad
```text
23.4 °C
BAD
Reliability: Communication failure
```

Không dùng cùng một visual cho cả 4 state.

---

## 23. Feedback Pattern

Mutation result phải có 3 lớp feedback:

1. Immediate button progress.
2. Success/failure toast/banner.
3. Authoritative object state refresh.

Không coi toast success là đủ nếu backend object state chưa phản ánh thay đổi.

---

## 24. Review Checklist

Thiết kế UI trước khi approve phải kiểm:

- [ ] Landing không chứa debug noise.
- [ ] Critical/High visible above fold.
- [ ] Health state có Unknown.
- [ ] Không có 8 DI giả.
- [ ] Không có RS485-2 giả.
- [ ] BACnet MS/TP không xuất hiện như feature active.
- [ ] Viewer quan sát được nhưng mutation bị khóa.
- [ ] Manual Override không có priority selector.
- [ ] Point drawer hiển thị quality/source/raw khi có.
- [ ] Offline không biến thành value 0.
- [ ] Trend gap được ngắt.
- [ ] Modbus là Bus → Device → Point.
- [ ] Network dùng transaction flow.
- [ ] Alarm dùng đúng 5 severity.
- [ ] Deferred alarm type không selectable trong production.
- [ ] OTA/Reboot/Restart service không xuất hiện.
- [ ] Responsive và keyboard/focus được review.

---

## 25. Implementation Sequence

### Phase UX-1 — Foundation
- AppShell
- Design tokens
- Navigation
- shared status/quality/severity components
- permissions UX

### Phase UX-2 — Core Operation
- Dashboard
- Monitor
- Point Drawer
- Alarm
- Trends

### Phase UX-3 — Operation/Engineering
- Schedule
- Commissioning
- I/O
- Virtual Points

### Phase UX-4 — Protocol/System
- Modbus
- Diagnostics
- Network transaction UX
- Device/Time/Users

### Phase UX-5 — Validation
- Role tests
- Unknown/offline/stale test fixtures
- visual regression
- board validation
- E2E critical workflows

---

## 26. Definition of Done

PA3 UX redesign được xem là implement-ready khi:

1. Requirement trace được tới page/component/use case.
2. Mỗi widget có backend field/source xác định hoặc state Unknown.
3. Role/action matrix đã map vào component state.
4. Main flow có wireframe và interaction state.
5. Mutation flow có confirmation, error, authoritative refresh.
6. Không có unsupported feature trong production navigation/action.
7. Dashboard đạt mục tiêu 3–5 giây situational awareness.
8. Monitor/Modbus scale được dữ liệu lớn bằng table/search/filter thay vì card wall.
9. Thiết kế test được với data state: good/uncertain/bad/stale/offline/unknown.
10. Review cuối có PM/UX/FE/BE/FW-SOM sign-off.
