# Detailed Design UI/UX ứng dụng AHU High Performance

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `DDD-UX-AHUHP-001` |
| Phiên bản | 0.1 |
| Ngày | 2026-08-13 |
| Mức trưởng thành | M3 — Review Ready |
| Trạng thái | Proposed; chưa được phép triển khai |
| Owner | UX/FE Lead |
| Reviewer/Authority | Product Owner; System Architect; Safety; CTO |
| Nguồn | `PROD-AHUHP-001`; `SRS-AHUHP-001`; `ARCH-AHUHP-001`; `DDD-IF-AHUHP-SIM-001` |
| Thay thế | Không |

> Mọi giá trị trong ba asset SVG là dữ liệu giả để mô tả bố cục. Chúng không phải bằng chứng runtime, HIL, commissioning hay release.

## DD-01 — Mục tiêu, actor, phạm vi và tiêu chí thành công

### 1.1 Mục tiêu

Thiết kế hai trải nghiệm tách quyền rõ ràng:

1. **Runtime AHU** tại `/ahu/:ahuId`: quan sát, đổi mode/setpoint trong quyền Operator/Engineer và xem alarm.
2. **Simulation Lab** tại `/eng/simulation/ahu/:ahuId`: điều khiển mô phỏng, tiêm lỗi, pause/reset và xuất evidence; chỉ Lab Admin.

| Actor | Nhu cầu | Quyền chính |
|---|---|---|
| Viewer | Xem trạng thái, chất lượng dữ liệu và trend | Read-only |
| Operator | Start/stop, chọn mode, đổi setpoint trong giới hạn | `ahu:operate` |
| Engineer | Tune tham số được duyệt, acknowledge alarm | `ahu:engineer` |
| Lab Admin | Start/pause/reset simulation, inject/clear fault | `simulation:admin` |
| Auditor | Xem/export evidence và audit event | `evidence:read` |

Ngoài phạm vi: commissioning I/O vật lý, chỉnh graph IEC 61131-3, ghi đè safety interlock, tạo user/RBAC và đồ thị historian dài hạn.

Tiêu chí thành công:

- Người vận hành xác định trong một màn hình: mode, safety state, data quality, 4 airflow và 8 actuator.
- Hành động thay đổi runtime luôn hiển thị target, giới hạn, authority và kết quả read-back.
- Tiêm lỗi/reset là hành động hai bước, không xuất hiện trên route Runtime.
- Desktop 1280 px và mobile 390 px không che mất alarm/safety state.
- Tất cả trạng thái loading/empty/error/permission/unknown/stale/offline/paused/faulted có copy và hành vi xác định.

## DD-02 — As-Built và gap

| As-Built có nguồn | Hiện trạng | Gap Target |
|---|---|---|
| [`apps/web-ui/src`](../../apps/web-ui/src) | React/Vite shell và pattern route/API đang tồn tại | Chưa có feature `ahu` hoặc `simulation-lab` |
| [`contracts/openapi/openapi.yaml`](../../contracts/openapi/openapi.yaml) | Authority REST hiện hữu | Chưa có route/schema AHU simulation; file đang thuộc worktree team, Plan 55 không sửa trước phê duyệt |
| [`PROGRAMMING_UI_UX_DESIGN.md`](PROGRAMMING_UI_UX_DESIGN.md) | Pattern RBAC, error/stale và asset review được tái dùng | Chưa có mimic HVAC, fault drawer, airflow/coil semantics |
| [`AHU_SIMULATION_INTERFACE_SPEC.md`](../02_design/interfaces/AHU_SIMULATION_INTERFACE_SPEC.md) | Candidate contract REST/WS/UDS/Modbus | Chưa machine-readable và chưa có runtime evidence |

Không được gọi asset dưới đây là As-Built. Đây là Target candidate.

## DD-03 — Kiến trúc thông tin, route và ownership

```text
AppShell
├── PrimaryNav
│   ├── Tổng quan
│   └── AHU
├── AHURuntimePage /ahu/:ahuId
│   ├── SafetyStatusBar
│   ├── AirPathMimic
│   ├── PerformanceKpiGrid
│   ├── CommandPanel
│   └── AlarmAndQualityPanel
└── SimulationLabPage /eng/simulation/ahu/:ahuId
    ├── SimulationSessionBar
    ├── PlantBoundaryPanel
    ├── FaultLibrary
    ├── FaultInjectionDrawer
    └── EvidenceExportPanel
```

| Boundary | Owner | Không được làm |
|---|---|---|
| FE presentation/query cache | FE | Tự suy diễn GOOD, tự retry lệnh không idempotent |
| REST/WS authorization/audit | Web API | Tin RBAC phía browser |
| Control/safety decision | Core/MCU | Phụ thuộc Web đang mở |
| Plant physics/fault state | `ahu_plant_sim` | Nhận hai writer hoặc bị FE sửa trực tiếp |

## DD-04 — Bố cục và asset trực quan

| Màn hình | Asset authority | Breakpoint |
|---|---|---|
| Runtime desktop | [AHUHP-01 Runtime Desktop](assets/ahu-high-performance/AHUHP-01_RUNTIME_DESKTOP.svg) | `>= 1024 px` |
| Runtime mobile | [AHUHP-01 Runtime Mobile](assets/ahu-high-performance/AHUHP-01_RUNTIME_MOBILE.svg) | `360..767 px` |
| Fault injection drawer | [AHUHP-02 Fault Drawer](assets/ahu-high-performance/AHUHP-02_SIMULATION_FAULT_DRAWER_DESKTOP.svg) | Desktop; modal toàn màn hình ở mobile |

Quy tắc responsive:

- `>=1280`: shell 240 px, nội dung tối đa 1440 px; mimic 8 cột, side panel 360 px.
- `768..1279`: nav thu gọn 72 px; mimic full-width, KPI 2 cột.
- `360..767`: thứ tự cố định Safety → mode → mimic cuộn dọc → KPI → alarm → action; bottom action bar 64 px.
- Dưới 360 px: `unsupported viewport` với hướng dẫn; không ép action nguy hiểm vào vùng bị cắt.

## DD-05 — Data model hiển thị

| Field UI | Type/đơn vị | Required/default/range | Null/quality semantics | Consumer |
|---|---|---|---|---|
| `ahuId` | string | required; `[A-Za-z0-9_-]{1,32}` | null → 404 | Header/audit |
| `sessionId` | UUID | simulation only | null → `Không có phiên` | Lab actions |
| `mode` | enum | `OFF/AUTO/MANUAL/SAFE` | unknown → chip `UNKNOWN` | Header/command |
| `safetyState` | enum | `NORMAL/DEGRADED/TRIPPED` | missing → chặn command | Safety bar |
| `dataQuality` | enum | `GOOD/STALE/BAD/UNKNOWN/OFFLINE` | luôn hiện cạnh giá trị | Mọi point |
| `oa/ra/sa/ea.flow` | float, m³/h | `0..designMax` | `—` nếu null; không dùng 0 thay null | Mimic/KPI |
| `oa/ra/sa/ea.damper` | float, % | `0..100` | stale → striped fill | Mimic |
| `sf/rf.speed` | float, % | `0..100` | BAD → màu xám + reason | Mimic |
| `chw/hw.valve` | float, % | `0..100` | command/readback hiển thị riêng | Coil cards |
| `temp.*` | float, °C | `-40..85` | 1 chữ số thập phân | Mimic/KPI |
| `pressure.duct` | float, Pa | `-500..2500` | dấu âm được giữ | KPI |
| `energyIndex` | float, kW/(m³/s) | `>=0`; Target theo `OD-AHUHP-008` | null → `Chưa đủ dữ liệu` | KPI |
| `alarmCount` | integer | `>=0` | missing → unknown, không coi bằng 0 | Header |
| `updatedAt` | RFC3339 UTC | required | clock skew → warning | Freshness |

Giá trị hiển thị phải có `value + unit + quality + updatedAt`; command phải có `requested + accepted + applied/readBack`.

## DD-06 — Interface, RBAC và concurrency

| Vùng/action | API Target | RBAC | Timeout/retry/idempotency | Side effect/audit |
|---|---|---|---|---|
| Snapshot | `GET /api/v1/ahu/{id}/snapshot` | Viewer+ | 2 s; GET retry tối đa 2 | Không |
| Stream | `WS /api/v1/ahu/{id}/stream` | Viewer+ | reconnect backoff 1/2/5/10 s | Audit connect optional |
| Mode/setpoint | `PUT /api/v1/ahu/{id}/command` | Operator+ | 3 s; không retry mù; `commandId` | Có; trước/sau/actor |
| Start/pause/reset lab | `POST /api/v1/simulation/sessions/{id}:action` | Lab Admin | 5 s; `Idempotency-Key` | Có; reason bắt buộc |
| Inject/clear fault | `POST/DELETE .../faults` | Lab Admin | 5 s; `requestId`; conflict `409` | Có; fault/target/duration |
| Export evidence | `POST .../evidence` | Auditor/Lab Admin | 30 s; job id | Có; hash artifact |

`409 REVISION_CONFLICT` bắt buộc refresh snapshot và giữ form chưa submit. `403` không xóa dữ liệu đang xem. `5xx` không được giả định command thất bại: FE hiển thị “Không xác định kết quả” và bắt read-back theo `commandId`.

## DD-07 — State machine và tương tác

```text
BOOTSTRAP → LOADING → LIVE
                ├── no data → EMPTY
LIVE ─ age>3 s → STALE ─ age>10 s/WS lost → OFFLINE
LIVE ─ command → SUBMITTING → READBACK → LIVE | UNKNOWN_RESULT
LAB_IDLE → STARTING → RUNNING ↔ PAUSED → RESETTING → LAB_IDLE
RUNNING/PAUSED → FAULT_CONFIRM → FAULT_ACTIVE → CLEARING → prior state
```

Ordering command:

1. Client validate range và RBAC hint.
2. Hiện summary target/current/new value/reason.
3. Gửi `commandId`, `expectedRevision`, `requestedAt`.
4. Chờ accepted response; không optimistic-update measured value.
5. Read-back tối đa 3 s; nếu không xác nhận, chuyển `UNKNOWN_RESULT`, disable submit trùng và hướng dẫn refresh/audit.

Fault drawer:

1. Chọn đúng một fault, target, magnitude/duration.
2. Preview tác động và safe-state dự kiến.
3. Nhập reason tối thiểu 10 ký tự; checkbox xác nhận “chỉ môi trường lab”.
4. Nút `Tiêm lỗi` disabled đến khi session PAUSED hoặc policy cho phép hot injection.
5. Focus vào tiêu đề khi mở; `Esc` đóng khi chưa submit; sau submit focus status; không đóng bằng click backdrop lúc đang gửi.

## DD-08 — Component/state/action mapping

| Component/vùng | Field/API | Trạng thái | Action | RBAC | Copy/error | Test |
|---|---|---|---|---|---|---|
| `SafetyStatusBar` | `safetyState`, `tripReason` | normal/degraded/tripped/unknown | Xem chi tiết | Viewer | “Trạng thái an toàn chưa xác định” | `UX-AHUHP-001` |
| `AirPathMimic` | 4 flow/damper, 2 fan, 2 coil | live/stale/bad/offline | Chọn point | Viewer | “Dữ liệu quá hạn” | `UX-AHUHP-002` |
| `ModeCommand` | command API | idle/submitting/readback/conflict | Đổi mode | Operator | “Chưa xác nhận kết quả” | `UX-AHUHP-003` |
| `SetpointEditor` | setpoint/limits/revision | valid/invalid/readonly | Apply/cancel | Operator+ | Nêu range và đơn vị | `UX-AHUHP-004` |
| `AlarmPanel` | alarms | loading/empty/list/error | Ack/filter | Engineer | Empty khác unknown | `UX-AHUHP-005` |
| `SimulationSessionBar` | session/state/clock | idle/running/paused/faulted | start/pause/reset | Lab Admin | reason bắt buộc | `UX-AHUHP-006` |
| `FaultInjectionDrawer` | fault catalog/API | draft/invalid/submitting/active | inject/clear | Lab Admin | xác nhận lab + impact | `UX-AHUHP-007` |
| `EvidenceExportPanel` | evidence job | idle/queued/running/done/failed | export/download | Auditor+ | hash + profile | `UX-AHUHP-008` |

## DD-09 — Error, safety, security và accessibility

| Điều kiện | Nơi phát hiện | UI/output | Recovery | Audit/alarm boundary |
|---|---|---|---|---|
| Safety state unknown | Snapshot schema/age | Banner đỏ; disable write | Refresh/read-back | Core alarm authority |
| Data stale/offline | Client age + WS state | Giữ last value có gạch chéo; không đổi thành 0 | Reconnect/get snapshot | FE telemetry only |
| Command timeout | API client | `UNKNOWN_RESULT`; khóa resubmit cùng target | Query command/audit | API audit authority |
| Permission lost | API `403` | Form readonly; không mất view | Re-auth/admin | IAM authority |
| Fault injection outside lab | API/environment claim | Hard reject; không có bypass UI | Chuyển đúng lab | Security event |
| XSS/malicious label | Schema/render | Escape text, cap 128 ký tự | Reject/telemetry | Security log |

Accessibility:

- Màu không là tín hiệu duy nhất; mọi quality có icon + text.
- Focus ring 2 px; thứ tự DOM khớp thứ tự nhìn; skip link đến safety và main.
- Target WCAG AA: text thường `>=4.5:1`, text lớn/control `>=3:1`; kiểm bằng tooling ở P5.
- Touch target tối thiểu 44×44 px; drawer có `aria-modal`, label/description; live update dùng `aria-live=polite`, trip dùng `assertive` một lần.
- Trend/mimic có bảng dữ liệu thay thế cho screen reader.

## DD-10 — Token và source mapping

| Token | Giá trị Target | Dùng cho |
|---|---|---|
| `--ahu-bg` | `#07111F` | Canvas |
| `--ahu-surface` | `#102033` | Card/nav |
| `--ahu-text` | `#F1F5F9` | Text chính |
| `--ahu-muted` | `#A9B8C8` | Metadata |
| `--ahu-good` | `#32D583` | GOOD/NORMAL |
| `--ahu-warn` | `#FDB022` | STALE/DEGRADED |
| `--ahu-danger` | `#F97066` | BAD/TRIPPED |
| `--ahu-info` | `#53B1FD` | Command/SA path |
| Spacing/radius | `4/8/12/16/24/32`; radius `8/12` px | Layout |

Target file/package cần tạo sau khi `IMPLEMENT_READY[P5]`:

```text
apps/web-ui/src/features/ahu/
  api/{client,queries,schemas}.ts
  model/{types,quality,commands}.ts
  runtime/{AHURuntimePage,AirPathMimic,CommandPanel}.tsx
  simulation/{SimulationLabPage,FaultInjectionDrawer}.tsx
  components/{QualityValue,SafetyStatusBar,EvidenceExportPanel}.tsx
  __tests__/
apps/web-api/internal/ahu/
contracts/openapi/openapi.yaml
```

Không tạo FE direct UDS/Modbus access; không tạo duplicate hand-written type lệch OpenAPI; không sửa feature Programming để nhét AHU.

## DD-11 — Verification

| ID | Fixture/precondition | Steps | Expected định lượng | Evidence/authority |
|---|---|---|---|---|
| `UX-AHUHP-001` | Snapshot `TRIPPED` | Render desktop/mobile | Trip visible không scroll; write disabled | Vitest + screenshot; QA |
| `UX-AHUHP-002` | GOOD→STALE→OFFLINE clock | Advance fake timer | 3 s stale; 10 s offline; last value không thành 0 | Vitest; FE/QA |
| `UX-AHUHP-003` | Command response lost | Submit once | 1 request; `UNKNOWN_RESULT`; no blind retry | Vitest/MSW; QA |
| `UX-AHUHP-004` | 390×844 | Keyboard-only flow | Không overflow ngang; target 44 px; focus không mắc kẹt | Browser/a11y; UX/QA |
| `UX-AHUHP-005` | Viewer role | Open all routes | Không có write action; API `403` vẫn handled | E2E; Security/QA |
| `UX-AHUHP-006` | Lab Admin + paused session | Inject fault | Preview + reason + confirm trước 1 POST | E2E; Safety/QA |
| `UX-AHUHP-007` | WS reconnect | Drop 12 s rồi recover | Backoff đúng; snapshot resync trước LIVE | Integration; QA |
| `UX-AHUHP-008` | Evidence job | Export | Hiện profile, timestamp, SHA-256; download đúng job | E2E; Auditor |

Requirement authority và 24 scenario end-to-end nằm tại [`VVP-AHUHP-001`](../05_verification/AHU_HIGH_PERFORMANCE_VERIFICATION_PLAN.md). Asset SVG chỉ là design evidence, không thay runtime screenshot.

## DD-12 — Compatibility, deploy và rollback

- Feature route phải đứng sau `ahuHighPerformance` và `ahuSimulationLab` flags, mặc định OFF trên production.
- API additive dưới `/api/v1`; client từ chối schema version không hỗ trợ.
- Rollback FE: tắt flag và phục hồi bundle trước; không reset control app/simulation state.
- Rollback API: drain command, giữ read-only snapshot nếu compatible; không xóa audit/evidence.
- Lab badge và environment claim phải do server cấp, không dựa hostname/browser storage.

## DD-13 — Traceability, open decision và sign-off

| Nội dung | Liên kết/trạng thái |
|---|---|
| Requirements | `FE-REQ-AHUHP-001..005`, `IF-REQ-AHUHP-001..005`, `SEC-REQ-AHUHP-001..003` |
| Open Decisions | `OD-AHUHP-007` RBAC/audit; `OD-AHUHP-008` KPI; `OD-AHUHP-011` retention; `OD-AHUHP-012` deployment |
| Verification | `VS-AHUHP-016..020`; Test Result = MISSING |
| Risk | `RSK-AHUHP-006`, `RSK-AHUHP-009`, `RSK-AHUHP-012` |
| Gate | `IMPLEMENT_READY[P5]` BLOCKED đến khi OpenAPI, RBAC và UI review được authority chấp thuận |

| Vai trò | Quyết định | Người/ngày/bằng chứng |
|---|---|---|
| UX/FE Lead | Pending | Chưa ký |
| Product Owner | Pending | Chưa ký |
| Safety | Pending | Chưa ký |
| CTO | Pending | Chưa ký |

### Tự kiểm DD-01..DD-13

| Checklist | Kết quả | Ghi chú |
|---|---|---|
| DD-01..DD-07 | PASS | Actor, As-Built, IA, data, contract và state/action định lượng |
| DD-08 | PASS | Ba asset renderable, component tree và mapping đầy đủ |
| DD-09..DD-13 | PASS | Error/safety/a11y, source, verification, rollback và sign-off |

## Lịch sử sửa đổi

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 0.1 | 2026-08-13 | Tạo candidate Detailed Design UI/UX và ba asset review |
