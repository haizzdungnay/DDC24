# Product Definition — MK-DDC-24 (MEKONG DDC-24IO-LINUX)

> **Document ID:** PRODUCT-DEF-MK-DDC-24-VI
> **Phiên bản:** 2.0 | 2026-06-30
> **Trạng thái:** Accepted — Nguồn-chuẩn DUY NHẤT về định vị & triết lý sản phẩm
> 📘 **Đọc cùng:** [README](README.md) · [BMS_EDGE_STRATEGY](BMS_EDGE_STRATEGY_MK-DDC-24_VI.md) · Quyết định nền: [ADR-004](../adr/ADR-004-component-based-runtime.md), [ADR-005](../adr/ADR-005-three-process-architecture.md), [ADR-006](../adr/ADR-006-rev-a-ui-form-json.md), [ADR-007](../adr/ADR-007-web-stack-go.md), [ADR-008](../adr/ADR-008-bms-edge-positioning-and-revA-component-set.md), [ADR-010](../adr/ADR-010-iop-v2-poll-capability-map.md)
> **Phạm vi Rev A:** [REVA_SCOPE_ROADMAP](REVA_SCOPE_ROADMAP_MK-DDC-24_VI.md)

> ⚠️ **Đây là tài liệu canonical.** Khi bất kỳ doc nào (PRD/SRS/DS/design) mô tả sản phẩm khác với tài liệu này, theo tài liệu này. Tài liệu này thay thế cách framing cũ "IEC 61131-3 soft-PLC + Web IDE FBD/ST" (xem ADR-004/006).

---

## 1. Tên & một câu định vị

**MEKONG DDC-24IO-LINUX** (mã: **MK-DDC-24**).

> MK-DDC-24 là **Component-Based BMS Edge Automation Controller** (Linux, 24 IO):
> cấu hình bằng **component**, chạy **local độc lập** (local-first), kết nối BMS/Gateway
> qua **BACnet/IP**, mở rộng & bridge thiết bị qua **Modbus RTU/TCP**.
>
> **HVAC là use-case đầu tiên, KHÔNG phải giới hạn sản phẩm.** Thiết bị dùng cho điều
> khiển biên, giám sát, tích hợp giao thức và tự động hóa nhiều hệ trong công trình (xem §3
> Application Domains, và [BMS_EDGE_STRATEGY](BMS_EDGE_STRATEGY_MK-DDC-24_VI.md)).

Câu cho sales/kỹ sư:

> Đấu dây xong → vào web kéo/gán component → map BACnet/Modbus → test point → deploy.
> Không cần viết firmware, không cần PLC IDE nặng.

## 2. Sản phẩm này LÀ gì / KHÔNG phải gì

| LÀ | KHÔNG phải |
|----|------------|
| BMS Edge Automation Controller | HVAC-only controller |
| Component-based local controller (runtime riêng) | IO module thường |
| Protocol gateway Modbus↔BACnet (kiêm controller) | Gateway pass-through đơn giản |
| Local-first automation node (chạy khi mất BMS) | Cloud-dependent IoT device |
| Commissioning bằng web/form/JSON | PLC IDE clone / Niagara clone |
| Nền mở rộng theo component/template | Sản phẩm đóng cứng một ngành |

## 3. Đối tượng & ứng dụng (Application Domains)

HVAC chỉ là use-case đầu tiên. MK-DDC-24 phục vụ nhiều hệ trong công trình / nhà máy nhẹ:

| Domain | Ví dụ ứng dụng |
|--------|----------------|
| **HVAC** | AHU, FCU, fan, pump, valve, damper |
| **Pump / Water** | tank level, áp suất, duty/standby pump, dry-run protection |
| **Lighting** | zone control, schedule, occupancy input |
| **Energy** | đọc meter, threshold alarm, peak/load monitor, pulse counting |
| **Environment** | nhiệt độ, độ ẩm, CO2, PM2.5, áp suất |
| **Alarm / Interlock** | fire/door contact, equipment trip, shutdown/interlock logic |
| **Gateway** | bridge thiết bị Modbus RTU/TCP → BACnet/IP cho BMS |
| **Data acquisition** | local IO → BMS/API |

Mục tiêu: dễ dùng cho kỹ sư Việt Nam, đấu nối nhanh, cấu hình bằng web, không viết
firmware, không IDE phức tạp, chạy độc lập khi mất BMS, kết nối tốt với Gateway/BMS.

## 4. Phần cứng Rev A (top-level — chi tiết ở `HW_SPEC` / `hardware-design/`)

```
24 IO onboard
├─ 16 UI  0-10V, 4-20mA, NTC và dry-contact phụ trợ không cách ly
├─ 4 AO   0-10V / 4-20mA
└─ 4 DO   relay dry-contact
```

> **ADR-010 baseline:** Rev A base SKU không lắp 8 DI công nghiệp riêng. Dry-contact của UI
> là chế độ phụ trợ, không cách ly; ứng dụng cần DI công nghiệp phải dùng module/SKU
> isolated-DI tùy chọn và chỉ được expose khi `BOARD_CAP_MAP` báo capability tương ứng.

Giao tiếp: Ethernet, RS485-1 Modbus RTU, RS485-2 Modbus RTU, Modbus TCP, BACnet/IP
northbound, USB service. Nguồn: 24VAC/VDC, isolated DC/DC, hardware watchdog, RTC.

## 5. Kiến trúc tổng thể

```
        Gateway / BMS (HMI · Alarm · Trend · Report)
                         │  BACnet/IP
                         ▼
        ┌──────────────  MK-DDC-24  ──────────────┐
        │ BACnet/IP server · Modbus RTU x2 · TCP   │
        │ Component runtime · Point DB · Web config │
        │ IO driver · Priority/Safe-mode · Watchdog │
        └────┬───────────────┬───────────────┬─────┘
          24 IO           RS485-1         RS485-2
        Sensor/Relay     VFD/Meter      Expansion IO
```

Hai lớp phần cứng (giữ từ thiết kế hiện tại): **SOM (Radxa CM3, Debian)** chạy các
service application + **MCU (STM32G0B1, FreeRTOS)** lo I/O real-time, nói chuyện qua
giao thức **IOP** (`spec/SWFW_INTERFACE_SPEC`).

## 6. Kiến trúc phần mềm (3 process — xem ADR-005)

```
mkddc-core   (real-time, SCHED_FIFO): IO image + graph engine + priority/safe-state
                                       + Modbus cache (read) + BACnet object table
mkddc-iobus  (non-real-time):          Modbus RTU x2 / TCP (async) + BACnet/IP datalink
mkddc-web    (non-real-time):          web config (Go) + validator (library) +
                                       commissioning + backup/restore + SQLite
```

Watchdog = systemd `WatchdogSec=` + hardware watchdog. Validator là **library** chạy
lúc deploy, không phải service. (Bản "7 service" trong bản chốt gốc được thay bằng
3-process theo ADR-005.)

## 7. Triết lý engineering — component-based, KHÔNG template cứng

Không "chọn AHU template → bị khóa theo AHU". Thay vào đó:

```
Component mẫu + User custom component (composite) → Wiresheet/Canvas →
Validator → Deploy graph.json → Runtime
```

> Đây là **component-based DDC**, không phải IEC 61131-3 PLC. FBD/ST và IDE 61131-3
> bị loại khỏi Rev A (xem [ADR-004](../adr/ADR-004-component-based-runtime.md)),
> đẩy sang Rev C.

## 8. Ngôn ngữ phát triển (xem ADR-007 — chốt 2 ngôn ngữ)

| Thành phần | Ngôn ngữ |
|------------|----------|
| `mkddc-core` (runtime, IO, Modbus/BACnet glue) | **C++17** |
| `mkddc-iobus` (Modbus libmodbus, BACnet bacnet-stack) | **C++17 / C** |
| `mkddc-web` backend + **validator (library)** | **Go** |
| Frontend | **React** (Vue cho phép) |
| Config / event / trend DB | **SQLite** (WAL) |

> Không Node.js/Python cho vòng điều khiển. Validator **không** dùng Rust service
> (đảo lại kế hoạch Rust trước đây — ADR-007).

## 9. Component model & graph

- Đơn vị engineering = **component có kiểu** (typed). Wiring input→output thành graph.
- Artifact deploy = **`graph.json`** — schema: [GRAPH_SCHEMA](../02_design/interfaces/GRAPH_SCHEMA_MK-DDC-24_VI.md).
- Cách runtime chạy graph (ordering, stateful node, snapshot, stale/fallback):
  [SW_RUNTIME_EXECUTION_MODEL](../02_design/software/SW_RUNTIME_EXECUTION_MODEL_MK-DDC-24_VI.md).
- Bộ component: [SW_COMPONENT_LIBRARY](../02_design/software/SW_COMPONENT_LIBRARY_MK-DDC-24_VI.md).

Nhóm component (đầy đủ tầm nhìn — Rev A làm tập con cố định **28 type**, xem REVA_SCOPE
+ [SW_COMPONENT_LIBRARY](../02_design/software/SW_COMPONENT_LIBRARY_MK-DDC-24_VI.md)):
IO · Logic · Timer (gồm RuntimeCounter) · Counter (PulseCounter) · Math ·
Control (PID/Interlock/SafeState; Stage/LeadLag → Rev B) ·
Alarm (gồm AlarmDelay) / Schedule · Protocol (BACnet_*/Modbus_*).

## 10. Chu kỳ runtime

```
1 Read IO  2 Read Modbus(cache)  3 Read BACnet cmd  4 Execute graph
5 PID/timer/alarm/schedule  6 Resolve priority  7 Write DO/AO
8 Write Modbus  9 Update BACnet object  10 Log event/trend
```

Scan mặc định **1 s** (Rev A). Fast IO 100ms/500ms → Rev B.

## 11. BACnet/IP (northbound chính)

DDC là **BACnet/IP server**; Gateway/BMS thấy DDC như một BACnet device. Mapping:
`AI→AI · DI→BI · AO→AO · DO→BO · Setpoint→AV · Command→BV/BO/AO`. Dùng **bacnet-stack**.
Conformance/BTL là track riêng (`design/interfaces/BACNET_PICS_EPICS`).

## 12. Modbus (field/expansion)

RS485-1 + RS485-2 Modbus RTU master; Ethernet Modbus TCP client. Modbus là component:
`[Modbus_RTU_Read]→[Scale]→[BACnet_AV]`, `[BACnet_AV]→[Limit]→[Modbus_RTU_Write]`.
Poll async trong `mkddc-iobus`; giá trị mang `{value, quality, ts}` → core thấy stale.

## 13. Priority & Safety

Mọi DO/AO qua **priority resolver**. BMS **không ghi thẳng IO** — chỉ ghi command/
setpoint; runtime quyết output sau khi kiểm priority/safety.

| Priority | Nguồn |
|---:|---|
| 1 | Fire / Safety |
| 2 | Local manual |
| 3 | BACnet command |
| 4 | Schedule |
| 5 | Local logic |
| 6 | Default |

## 14. Validator (bắt buộc trước deploy)

Kiểm: input chưa nối · output nhiều nguồn ghi · sai kiểu/unit · vòng lặp nguy hiểm ·
AO chưa có limit · output chưa qua priority · Modbus mất kết nối chưa có fallback ·
sensor lỗi chưa có safe state · BACnet writable chưa có priority · graph có kịp scan.
Không pass → không deploy. Rev A làm tập con 4 check an toàn cốt lõi (xem REVA_SCOPE).

## 15. Commissioning (điểm bán hàng VN)

Test từng point: DI/DO/AI/AO · RS485-1/2 · Modbus TCP · BACnet discovery/read/write ·
alarm · schedule · priority · **export report nghiệm thu**.

## 16. Database local (SQLite)

`config.sqlite` (users, io_channels, components, graphs, links, bacnet_objects,
modbus_devices/points, schedules, alarms, runtime/system_config) ·
`eventlog.sqlite` · `trend.sqlite`.

## 17. Quyết định chốt (tổng hợp)

```
AI (artificial intelligence): bỏ khỏi Rev A/Rev B
Template thiết bị cứng: không dùng làm lõi
Component-based: lõi  ·  BACnet/IP: northbound  ·  Modbus RTU/TCP: field/expansion
Linux 3-process (ADR-005)  ·  C++ core + Go web (ADR-007)
IEC 61131-3 / IDE nặng: loại khỏi Rev A (ADR-004), → Rev C
Rev A UI: form/JSON, canvas → Rev B (ADR-006)
Validator + Commissioning: bắt buộc
```

## 18. Quan hệ với tài liệu cũ

| Chủ đề | Trước đây | Bây giờ (nguồn-chuẩn) |
|--------|-----------|------------------------|
| Engine | `kinexus-plc` IEC 61131-3 (`SW_PLC_ENGINE_DESIGN`) | component graph (ADR-004, SW_RUNTIME_EXECUTION_MODEL) |
| Web | `kinexus-webide` Python/Svelte FBD | `mkddc-web` Go, form/JSON (ADR-006/007) |
| Naming | `kinexus-*` | `mkddc-*` (ADR-005) |
| HMI/Agent/OTA/cloud | service riêng | HMI local thuộc Rev A theo amendment 2026-06-27; Agent/OTA/cloud deferred Rev B+ |

## Revision History

| Version | Ngày | Thay đổi |
|---|---|---|
| 1.1 | 2026-06-08 | Canonical product direction and component-based runtime. |
| 2.0 | 2026-06-30 | Breaking hardware-baseline alignment to ADR-010: 16 UI + 4 AO + 4 DO, no base-SKU industrial DI; reconciled HMI scope amendment. |

---

**Tài liệu liên quan:** [REVA_SCOPE_ROADMAP](REVA_SCOPE_ROADMAP_MK-DDC-24_VI.md) ·
[GRAPH_SCHEMA](../02_design/interfaces/GRAPH_SCHEMA_MK-DDC-24_VI.md) ·
[SW_RUNTIME_EXECUTION_MODEL](../02_design/software/SW_RUNTIME_EXECUTION_MODEL_MK-DDC-24_VI.md) ·
[SW_COMPONENT_LIBRARY](../02_design/software/SW_COMPONENT_LIBRARY_MK-DDC-24_VI.md)
