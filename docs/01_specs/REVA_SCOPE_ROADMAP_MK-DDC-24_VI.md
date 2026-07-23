# Rev A Scope & 90-Day Roadmap — MK-DDC-24

> **Document ID:** REVA-SCOPE-MK-DDC-24-VI
> **Phiên bản:** 1.3 | 2026-06-30
> **Trạng thái:** Accepted — Nguồn-chuẩn DUY NHẤT về phạm vi Rev A & lịch 90 ngày
> 📘 **Đọc cùng:** [PRODUCT_DEFINITION](PRODUCT_DEFINITION_MK-DDC-24_VI.md) ·
> [BMS_EDGE_STRATEGY](BMS_EDGE_STRATEGY_MK-DDC-24_VI.md) · ADR-004..010

> ⚠️ Deadline **90 ngày là cố định**; **scope là biến số**. Tài liệu định nghĩa
> **Rev A.0 = "demo-grade"** (đủ chứng minh 3-domain acceptance §6, chưa production-grade).

---

## 1. Điều kiện tiên quyết (rủi ro #1)

90 ngày chỉ khả thi nếu chạy **3 track song song → tối thiểu 3 dev**:

| Track | Người | Phạm vi |
|------|------|---------|
| T1 — C++ core | 1 | `mkddc-core`: IO driver + graph engine + priority + state/snapshot |
| T2 — C++ proto | 1 | `mkddc-iobus`: BACnet/IP (bacnet-stack) + Modbus RTU x2/TCP |
| T3 — Go web | 1 | `mkddc-web`: REST + validator + commissioning + SQLite |

> Nếu team < 3 dev, **90 ngày bất khả thi** — phải báo ngay tuần 1, không phải tuần 10.

## 2. Scope Rev A.0 — GIỮ

```
✓ Linux boot ổn định + 24 IO đọc/ghi (scan 1 s; KHÔNG fast-IO 100ms)
✓ HW base SKU: 16 UI + 4 AO + 4 DO; không có DI công nghiệp riêng (ADR-010)
✓ Graph engine + execution plan (topo-sort lúc deploy) — SW_RUNTIME_EXECUTION_MODEL
✓ Bộ component cố định Rev A = 28 type (KHÔNG composite) — SW_COMPONENT_LIBRARY
   (gồm Interlock, AlarmDelay, RuntimeCounter, PulseCounter cho BMS tổng quát — ADR-008)
✓ Priority resolver + safe-state + power-on-state
✓ State snapshot (60 s + shutdown) + power-loss recovery
✓ BACnet/IP server: AI/AO/BI/BO/AV/BV + ghi setpoint (interop demo, KHÔNG đặt mục tiêu BTL pass)
✓ Modbus RTU x2 + TCP client, async cache + stale/fallback
✓ Validator v1 (4 check an toàn cốt lõi — §4)
✓ Config qua FORM + import/export graph.json (KHÔNG canvas)
✓ SQLite config + backup/restore (copy file)
✓ Commissioning test từng point + export report (CSV/PDF cơ bản)
✓ HMI local limited-operator (LVGL v9, DRM/KMS, 5 surface, 6 nút + CTP touch)  ← ADR-016
```

> **Amendment 2026-07-22 — HMI limited-operator:**
> Spec HMI chọn Home/Points/Control/Alarms/Service; chỉ command point được whitelist
> qua broker/core authority, không đưa full Web HMI/engineering lên TFT 2.4 inch.
> HMI là yêu cầu thiết yếu cho demo tại chỗ (site acceptance) — không có màn hình local,
> kỹ sư vận hành không thể kiểm tra DDC khi không có laptop. Kéo vào Rev A.
> Implementation guide: [08_MKDDC_HMI_IMPLEMENTATION_GUIDE](../03_implementation/08_MKDDC_HMI_IMPLEMENTATION_GUIDE.md).

## 3. Scope Rev A.0 — CẮT (đẩy Rev B/C)

```
✗ User custom composite component                 → Rev B
✗ Wiresheet/canvas đầy đủ (React Flow)            → Rev B
✗ WeeklySchedule / HolidaySchedule               → Rev B
✗ Math nâng cao (Average/Min/Max/LowPass)         → Rev B
✗ StageControl / LeadLag / SequenceStep           → Rev B
✗ RBAC đầy đủ (Rev A.0 chỉ 1 password web)        → Rev B
✗ Audit log đầy đủ, component versioning          → Rev B
✗ MQTT/agent, cloud                               → Rev B+
✗ OTA update                                       → Rev B
✗ BACnet/SC, scripted component, multi-DDC        → Rev C
✓ IEC 61131-3-aligned ST+FBD Program Runtime         → Rev A.0 roadmap (ADR-018, đang C0, chưa release)
✗ LD/SFC, online change, IEC certified/compliant claim → ngoài Rev A.0
```

## 4. Validator v1 — 4 check an toàn không thể bỏ

1. Input chưa nối. 2. Output bị nhiều nguồn ghi. 3. AO chưa có limit.
4. Modbus/sensor chưa có fallback/safe-state.

Các check còn lại (unit, vòng lặp, scan budget) → Rev B.

## 5. Roadmap 90 ngày (≈13 tuần, 3 track song song)

```
Tuần 1–2  SPEC + NỀN (cả 3 dev — GATE quan trọng nhất)
  ⚑ Chốt GRAPH_SCHEMA + SW_RUNTIME_EXECUTION_MODEL
  ⚑ Chốt REST contract web↔core (REST_API_OPENAPI)
  ⚑ IO simulator (chạy không cần HW)
  ⚑ Khung 3 process + IPC chạy "hello"

Tuần 3–6
  T1: graph engine + execution plan + 8 component đầu + IO driver thật
  T2: bacnet-stack tích hợp, expose AI/BI read-only
  T3: Go web khung + SQLite schema + import graph.json + deploy API

Tuần 7–9                                          ★ MILESTONE A (mốc 90 ngày gốc)
  T1: đủ 15 component + priority resolver + safe-state + snapshot/recovery
  T2: BACnet ghi setpoint (AV/BO/AO) + Modbus RTU x2 đọc/ghi + stale
  T3: validator v1 + form config + backup/restore

Tuần 10–11
  T2: Modbus TCP + hoàn thiện fallback
  T3: commissioning test + export report
  Cả nhóm: tích hợp end-to-end trên HW thật

Tuần 12–13  HARDENING + DEMO                       ★ DEMO KHÁCH
  • Full 3-domain demo (§6) trên HW · soak power-loss / mất BMS / mất Modbus
  • Fix bug · đóng gói image · doc nghiệm thu
```

> **Diễn giải mốc:** "90 ngày" gốc tới được **Milestone A** (lõi điều khiển chạy trên
> HW), KHÔNG phải toàn bộ Rev A.0. Rev A.0 đầy đủ ≈ tuần 13 (~5–5.5 tháng nếu tính cả
> hardening thực). Cam kết với sếp/khách theo cách tách mốc này. (Owner đã chọn ép vào
> 90 ngày → phải cắt scope như §3; nếu vẫn không đủ, cắt tiếp commissioning hoặc một
> nhánh protocol.)

## 6. Acceptance — 3-domain demo (demo-grade)

Chứng minh sản phẩm **tổng quát** (không HVAC-only) bằng 3 demo vertical. Pass khi cả 3
chạy ổn định; minh họa chạy được ở `examples/`.

### Demo 1 — HVAC mini (`examples/hvac-mini`)
- AI nhiệt độ → Scale → PID → AO valve
- UI dry-contact fan status (auxiliary, non-isolated) → AlarmHigh/Compare → DO fan enable + alarm
- BACnet expose AI/BI/AO/BO/AV/BV + ghi setpoint AV

### Demo 2 — Pump/Water (`examples/pump-water`)
- UI dry-contact level switch + UI analog pressure → DO pump enable
- OnDelay/OffDelay sequencing
- **Interlock** (chặn pump khi điều kiện an toàn sai)
- dry-run / pressure alarm với **AlarmDelay** (chống báo giả)
- **RuntimeCounter** giờ chạy pump (maintenance)
- logic local vẫn chạy khi **mất BMS**

### Demo 3 — Energy/Gateway (`examples/energy-gateway`)
- Modbus RTU đọc energy meter → Scale → BACnet AV expose
- **PulseCounter** đếm xung meter (energy/water)
- threshold alarm
- stale/fallback khi **mất thiết bị Modbus**

### Điểm chung (mọi demo)
mất điện bật lại không mất config · backup/restore · BACnet interop (KHÔNG đặt mục tiêu BTL).

Khác production: chưa soak 30 ngày, chưa BTL certified, chưa RBAC → đó là Rev A.1.

## 7. Top rủi ro 90 ngày + cách chặn

| # | Rủi ro | Chặn |
|---|--------|------|
| R1 | Team < 3 dev | Xác nhận nhân sự tuần 1 |
| R2 | BACnet conformance ngốn thời gian | Dùng bacnet-stack; Rev A.0 chỉ cần interop, KHÔNG BTL trong 90 ngày |
| R3 | GRAPH_SCHEMA trượt sang tuần 3 | Tuần 1–2 là hard gate; không code engine trước khi spec xong |

## 8. HW baseline (đã chốt bằng ADR-010)

Rev A base SKU có **16 UI + 4 AO + 4 DO**. Hai ADS131M08 phục vụ UI1-UI16;
không có DI công nghiệp riêng và không có `DI_MASK` trong IO_RESP v2. Dry-contact UI
chỉ là input phụ trợ không cách ly. Module/SKU isolated-DI tùy chọn phải khai báo
capability riêng; shared memory có thể giữ slot dự phòng nhưng giao diện base SKU
không được quảng bá hoặc hiển thị chúng như phần cứng đã lắp.

## Revision History

| Version | Ngày | Thay đổi |
|---|---|---|
| 1.2 | 2026-06-27 | Added local-HMI Rev A amendment. |
| 1.3 | 2026-06-30 | Aligned Rev A hardware and demo wording to ADR-010 base SKU. |
| 1.4 | 2026-07-22 | Replaced six-screen service-only scope with ADR-016 five-surface limited-operator HMI and authoritative command boundary. |
