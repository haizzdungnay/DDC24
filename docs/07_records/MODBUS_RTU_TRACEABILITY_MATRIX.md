# Modbus RTU — Traceability Matrix

**ID:** TRACE-MBRTU-001
**Trạng thái:** Active (ma trận truy vết; không phải bằng chứng pass)
**Ngày:** 2026-08-06 (bản 1.0: 2026-08-04; 1.1: 2026-08-05)
**Đối chiếu source tại:** `main` sau Track B (contract v2, BusWorker đa bus, candidate/apply)
**Chuỗi normative:** Product Capability → Product Requirement → Use Case →
System/Software/Interface Requirement → Design → Verification Requirement → Test → Evidence

> `Planned`, `Design In Review` và `Documented` **không** phải bằng chứng pass.
> Chỉ evidence có review mới đổi được gate ở [VERIFICATION.md](../05_verification/VERIFICATION.md).

## 1. Product Capability → Requirement

| Capability | Product Requirement | System/Software Requirement | Use Case |
|---|---|---|---|
| PC-MBRTU-01 hai bus master | PR-MBRTU-001, PR-MBRTU-011 | SYS-REQ-004, SYS-REQ-MBRTU-001 | UC-MBRTU-006 |
| PC-MBRTU-02 Device lifecycle | PR-MBRTU-001, PR-MBRTU-002 | SWR-REQ-MBRTU-002, SWR-REQ-MBRTU-008 | UC-MBRTU-001..007 |
| PC-MBRTU-03 Point lifecycle | PR-MBRTU-004 | SWR-REQ-MBRTU-001, SWR-REQ-MBRTU-003, SWR-REQ-MBRTU-008 | UC-MBRTU-009, UC-MBRTU-010 |
| PC-MBRTU-04 Point mapping | PR-MBRTU-006 | SWR-REQ-MBRTU-001, SWR-REQ-MBRTU-008 | UC-MBRTU-013 |
| PC-MBRTU-05 giám sát runtime | PR-MBRTU-007 | SWR-REQ-MBRTU-005, IF-REQ-MBRTU-001, IF-REQ-MBRTU-003 | UC-MBRTU-014 |
| PC-MBRTU-06 commissioning | PR-MBRTU-003, PR-MBRTU-005 | SWR-REQ-MBRTU-006, SWR-REQ-MBRTU-008, SEC-REQ-MBRTU-001 | UC-MBRTU-008, UC-MBRTU-011, UC-MBRTU-012 |
| PC-MBRTU-07 diagnostics | PR-MBRTU-008 | SWR-REQ-MBRTU-009 | UC-MBRTU-015 |
| PC-MBRTU-08 xử lý sự cố | PR-MBRTU-009, PR-MBRTU-011 | SWR-REQ-MBRTU-004, SWR-REQ-MBRTU-005 | UC-MBRTU-016, UC-MBRTU-017 |
| PC-MBRTU-09 revision/apply/rollback | PR-MBRTU-010 | SWR-REQ-MBRTU-007, IF-REQ-MBRTU-002 | UC-MBRTU-002, UC-MBRTU-017 |
| PC-MBRTU-10 RBAC/audit | PR-MBRTU-012 | SEC-REQ-MBRTU-001 | UC-MBRTU-012, UC-MBRTU-018 |

## 2. Requirement → Design → Verification → Test

| Requirement | Design authority | VR | Test chính | Trạng thái evidence |
|---|---|---|---|---|
| SYS-REQ-MBRTU-001 | DDD-SW-MBRTU-POINT-001 §3–4; DDD-FW-MBRTU-001 §1–3 | VR-MBRTU-001, 004, 011 | TC-MBRTU-T-02, H-01, S-10 | **PARTIAL** — `OD-MBRTU-001` CLOSED (02 bus RS485: `/dev/rs485-1` → `ttyS5`, `/dev/rs485-2` → `ttyS1`); 2 BusWorker threads; chờ evidence target/HIL |
| SWR-REQ-MBRTU-001 (mô hình/identity) | DDD-DM-MBRTU-001 §3–5 | VR-MBRTU-002, 006 | TC-MBRTU-U-09, U-18, I-02, I-20 | Design Active; As-Built giữ được `point_id` khi profile do BE sinh |
| SWR-REQ-MBRTU-002 (cấu hình bus/serial/slave) | DDD-DM-MBRTU-001 §3–4; DDD-BE-MBRTU-001 §4 | VR-MBRTU-002 | TC-MBRTU-U-06, U-07, I-01 | **PARTIAL** — validator có; `retry` nay đúng ngữ nghĩa Đ-05. Thiếu đường ghi `offline_after_errors`/`offline_probe_ms` (F-BE-19/20) |
| SWR-REQ-MBRTU-003 (register/codec) | DDD-FW-MBRTU-001 §5; DDD-DM-MBRTU-001 §5.2, §5.5 | VR-MBRTU-003 | TC-MBRTU-U-01..05, U-08, H-03 | **PARTIAL** — codec host pass, **encode nay fail-closed** (D-01/D-02, 8 test âm tính); `bit_index`/`min-max`/evidence target chưa có |
| SWR-REQ-MBRTU-004 (scheduler/isolation) | DDD-FW-MBRTU-001 §4; DDD-BE-MBRTU-001 §5 | VR-MBRTU-004 | TC-MBRTU-U-11..13, S-09, S-10, T-07 | **PARTIAL** — EDF + offline probe + retry thật đã có; kịch bản S-10 (2 bus song song) đã kích hoạt |
| SWR-REQ-MBRTU-005 (quality/timestamp) | DDD-DM-MBRTU-001 §6; DDD-FW-MBRTU-001 §6 | VR-MBRTU-005 | TC-MBRTU-U-14, U-15, S-03..08, H-05 | **RED** — quality 3 mức, timestamp do BE gán |
| SWR-REQ-MBRTU-006 (write path) | DDD-FW-MBRTU-001 §8; ICD-API-MBRTU-001 §6.2 | VR-MBRTU-008 | TC-MBRTU-I-15..17, S-02, H-04 | **RED** — `dirty/setpoint` không có result. **Đã cải thiện:** hết replay vô hạn trong một process (D-03) và encode fail-closed (D-01/D-02); vẫn hở ở nhánh restart iobus (F-FW-07) |
| SWR-REQ-MBRTU-007 (atomic config) | DDD-BE-MBRTU-001 §3 | VR-MBRTU-007 | TC-MBRTU-I-05..11, T-08, H-09 | **RED** — apply = restart service |
| SWR-REQ-MBRTU-008 (BE/Core là source of truth) | DDD-DM-MBRTU-001 §2; DDD-BE-MBRTU-001 §1; DDD-FE-MBRTU-001 §2 | VR-MBRTU-010, 013 | TC-MBRTU-I-04, I-23, I-24, U-19, U-20 | **PARTIAL** — CRUD/validator có; import/export/commissioning chưa có |
| SWR-REQ-MBRTU-009 (diagnostics) | DDD-FW-MBRTU-001 §12; ICD-API-MBRTU-001 §7.1 | VR-MBRTU-009 | TC-MBRTU-I-22, S-04, S-05, H-15 | **PARTIAL** — counter uint32 theo slave, không bus/boot id |
| IF-REQ-MBRTU-001 (runtime contract) | ICD-IF-MBRTU-001 §5 | VR-MBRTU-006 | TC-MBRTU-I-18, H-10 | **RED** — ABI v1 |
| IF-REQ-MBRTU-002 (config/write IPC) | ICD-IF-MBRTU-001 §6 | VR-MBRTU-007, 008 | TC-MBRTU-I-10, I-19 | **RED** |
| IF-REQ-MBRTU-003 (REST/WS) | ICD-API-MBRTU-001 | VR-MBRTU-010 | TC-MBRTU-I-20, I-21, I-23 | **PARTIAL** — 9/25 endpoint |
| IF-REQ-MBRTU-004 (zero-based address) | DDD-DM-MBRTU-001 §5.2 | VR-MBRTU-002 | TC-MBRTU-I-25 | **PASS ở API** — persistence/API đã zero-based; UI chưa ghi nhãn convention |
| SEC-REQ-MBRTU-001 (RBAC/audit) | DDD-BE-MBRTU-001 §7; UX-WEB-MBRTU-001 §7 | VR-MBRTU-010 | TC-MBRTU-I-12..14, P-04 | **PARTIAL** — RBAC route khớp Đ-04 cho phần đọc/CRUD; **FE nay mở cho Viewer** (D-07). Còn thiếu: audit không có target/old/new (F-BE-18), quyền `operator` chưa có gì để thực thi |
| NFR-REQ-MBRTU-001 (capacity) | DDD-FW-MBRTU-001 §11 | VR-MBRTU-004, 014 | TC-MBRTU-U-10, S-12, P-02 | **RED** (hạ từ PARTIAL) — Đ-07 yêu cầu **≥256 Point**, As-Built vẫn chặn cứng 64 (`KX_N_EXT`); 16 device/bus chưa có luật |
| NFR-REQ-MBRTU-002 (acceptance phần cứng) | VVP-MBRTU-001 §6 | VR-MBRTU-011 | TC-MBRTU-H-01..16 | **RED** — thiết bị đã được duyệt cấp (Đ-08) nhưng chưa về; thêm `TC-MBRTU-H-16` (điều hướng RS-485, `OD-MBRTU-EXT-04`) |
| NFR-REQ-MBRTU-003 (provenance) | VVP-MBRTU-001 §5 | VR-MBRTU-012 | TC-MBRTU-T-01, T-09, P-05 | **RED** — ADR-022 còn Proposed |
| NFR-REQ-MBRTU-004 (refresh/write rate/CPU-RAM) | DDD-FE-MBRTU-001 §5.1; DDD-BE-MBRTU-001 §6; DDD-FW-MBRTU-001 §11 | VR-MBRTU-014 | TC-MBRTU-T-06, P-02 | **RED** — mọi số là PROPOSED |

## 3. Use Case → UI/UX → FE → API → BE → FW

| UC | UI/UX page | FE component | API | BE | FW-SOM |
|---|---|---|---|---|---|
| UC-MBRTU-001 | Overview, Devices | `OverviewPage`, `DevicesPage` | `GET /modbus/overview`, `/devices` | `diagnostics.go` | telemetry publish |
| UC-MBRTU-002..004 | Devices | `DeviceForm`, `ConfirmDeleteDialog` | `POST/PUT/DELETE /modbus/devices` | `validate.go`, `candidate.go` | generation swap |
| UC-MBRTU-005 | Devices | bulk action | `POST /modbus/devices/{id}/enabled` | `candidate.go` | scheduler bỏ device |
| UC-MBRTU-006, 007 | Devices | `DeviceForm` | như trên | `validate.go` §4 | BusWorker mở cổng |
| UC-MBRTU-008 | Devices | `TestConnectionDialog` | `POST /modbus/devices/{id}/test-connection` | `commission.go` | transaction ad-hoc |
| UC-MBRTU-009 | Points | `PointForm`, `RegisterPreview` | `POST/PUT/DELETE /modbus/points` | `validate.go` | codec, slot map |
| UC-MBRTU-010 | Points | `ImportPreviewDialog`, `model/csv.ts` | `POST /modbus/import`, `GET /modbus/export` | `csvio.go` | — |
| UC-MBRTU-011 | Points | `ReadTestDialog` | `POST /modbus/commission/read` | `commission.go` | transaction ad-hoc |
| UC-MBRTU-012 | Points | `WriteTestDialog` (2 bước) | `POST /modbus/commission/write` | `commission.go` + audit | write queue + readback |
| UC-MBRTU-013 | Mapping | `MappingPage` | `GET /modbus/mapping` | namespace validator | — |
| UC-MBRTU-014 | Points, Overview | `QualityBadge`, `useModbusRuntime` | `GET /modbus/points?include_runtime`, WS | `core_client` | quality/timestamp producer |
| UC-MBRTU-015 | Diagnostics | `DiagnosticsPage` | `GET /modbus/diagnostics` | `diagnostics.go` | counters |
| UC-MBRTU-016 | Devices, Diagnostics | `ConnectionStatusBadge` | `/devices`, `/events` | — | state machine device |
| UC-MBRTU-017 | tất cả | `ConfigStateBanner` | `/config`, `/config/apply` | `apply.go` | REJECT giữ generation cũ |
| UC-MBRTU-018 | tất cả | `RequireRole`, `roles.ts` (nay `viewer`) | RBAC middleware | `auth` | — |

## 4. Requirement → Source hiện tại (As-Built)

| Requirement | Source path hiện tại | Conform? |
|---|---|---|
| SYS-REQ-MBRTU-001 | `apps/iobus/adapters/modbus_rtu/modbus_master.cpp` | **Có cho Rev A** — Đ-01 chốt một bus; thiếu khái niệm `bus_id` trong contract (F-IF-05) |
| SWR-REQ-MBRTU-001 | `apps/web-api/internal/modbusrtu/domain.go`, `apps/core/domain/graph/point_table.hpp` | Một phần |
| SWR-REQ-MBRTU-002 | `domain.go Validate()`, `apps/iobus/adapters/modbus_rtu/fieldbus_config.*` | Một phần |
| SWR-REQ-MBRTU-003 | `apps/iobus/adapters/modbus_rtu/register_codec.*`, `device_profile.*` | Một phần |
| SWR-REQ-MBRTU-004 | `poll_scheduler.*`, `modbus_master.cpp` | Một phần — EDF + `offline_probe_ms` + retry thật đã có (D-04/D-05/D-06) |
| SWR-REQ-MBRTU-005 | `ext_cache.*`, `contracts/shm/mkddc_shm.h` | **Không** |
| SWR-REQ-MBRTU-006 | `modbus_master.cpp drain_ext_writes()` | **Không** |
| SWR-REQ-MBRTU-007 | `apps/web-api/internal/modbusrtu/persistence.go` | **Không** |
| SWR-REQ-MBRTU-008 | `apps/web-api/internal/app/modbus_rtu.go`, `apps/web-ui/src/features/modbus-rtu/` | Một phần |
| SWR-REQ-MBRTU-009 | `fieldbus_metrics.*`, `modbus_rtu.go handleModbusDiagnostics` | Một phần |
| IF-REQ-MBRTU-001 | `contracts/shm/mkddc_shm.h` `kx_ext_point_t` | **Không** |
| IF-REQ-MBRTU-002 | `/run/mkddc/fieldbus.sock` (datagram), reload helper | **Không** |
| IF-REQ-MBRTU-003 | `contracts/openapi/openapi.yaml` v1.11.0 | Một phần |
| IF-REQ-MBRTU-004 | `domain.go` address 0..65535 | **Có** |
| SEC-REQ-MBRTU-001 | `apps/web-api/internal/app/http.go`, `audit.go`, `apps/web-ui/src/features/auth/roles.ts` | Một phần — route `viewer`/`admin` khớp Đ-04; audit thiếu target/old/new |
| NFR-REQ-MBRTU-001 | `KX_N_EXT=64`, `domain.go` | **Không** — Đ-07 yêu cầu ≥256 |
| NFR-REQ-MBRTU-002..004 | — | **Không** |

## 5. Tài liệu chủ quản

| Nội dung | Tài liệu |
|---|---|
| Product/use case | [PROD-MBRTU-001](../01_product/MODBUS_RTU_PRODUCT_REQUIREMENTS.md) |
| Requirement | [REQUIREMENTS.md §Modbus RTU](../02_requirements/REQUIREMENTS.md) |
| Data model | [DDD-DM-MBRTU-001](../02_design/software/MODBUS_RTU_DATA_MODEL.md) |
| UI/UX | [UX-WEB-MBRTU-001](../04_uiux/MODBUS_RTU_UI_UX_DESIGN.md) |
| FE | [DDD-FE-MBRTU-001](../02_design/software/MODBUS_RTU_FE_DESIGN.md) |
| BE | [DDD-BE-MBRTU-001](../02_design/software/MODBUS_RTU_BE_DESIGN.md) |
| FW-SOM | [DDD-FW-MBRTU-001](../02_design/software/MODBUS_RTU_FW_SOM_DESIGN.md) |
| Design authority tổng | [DDD-SW-MBRTU-POINT-001](../02_design/software/DDC24_MODBUS_RTU_POINT_DETAILED_DESIGN.md) |
| API | [ICD-API-MBRTU-001](../02_design/interfaces/MODBUS_RTU_API_SPEC.md) |
| Interface end-to-end | [ICD-IF-MBRTU-001](../02_design/interfaces/MODBUS_RTU_INTERFACE_SPEC.md) |
| Verification | [VVP-MBRTU-001](../05_verification/MODBUS_RTU_VERIFICATION_PLAN.md) |
| Open decisions | [OD-MBRTU-SET-001](../00_governance/MODBUS_RTU_OPEN_DECISIONS.md) |
| As-Built | [MODBUS_RTU_POINT_AS_BUILT_REPORT](reviews/MODBUS_RTU_POINT_AS_BUILT_REPORT.md) |
| Docs sync record | [MODBUS_RTU_DOCS_SYNC_REPORT](reviews/MODBUS_RTU_DOCS_SYNC_REPORT.md) |

## 6. Quy tắc cập nhật

Khi requirement Modbus RTU đổi, cập nhật trong cùng thay đổi: requirement text,
decision nếu cần, design chủ quản, ma trận này, `VERIFICATION.md`,
`TRACEABILITY.md` và `CHANGELOG.md`. Evidence phải trỏ tới artifact bất biến hoặc
release record; một câu mô tả không thay thế log, số đo hoặc approval.

## Revision history

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-04 | Tạo ma trận truy vết Modbus RTU đầy đủ 6 lớp |
| 1.1 | 2026-08-05 | Đối chiếu lại với `eade4e5` sau Track A và áp dụng Đ-01/Đ-04/Đ-05/Đ-07/Đ-08. Nâng `SYS-REQ-MBRTU-001` và `SWR-REQ-MBRTU-004` từ RED lên PARTIAL (quyết định một bus + scheduler/retry đã sửa); hạ `NFR-REQ-MBRTU-001` xuống RED (Đ-07 nâng capacity lên ≥256 trong khi As-Built còn 64); cập nhật §4 As-Built cho SYS-001, SWR-004, SEC-001, NFR-001; §3 đổi vai trò Engineer → Admin |

## Phụ lục — Bằng chứng Track B (2026-08-06)

Bảng dưới nối **yêu cầu → nơi hiện thực → bằng chứng đã chạy**. Chỉ liệt kê thứ
đã có evidence; mục còn chờ phần cứng ghi rõ là chờ.

| Yêu cầu | Hiện thực | Bằng chứng |
|---|---|---|
| `SWR-REQ-MBRTU-005` quality/timestamp | `contracts/shm/mkddc_shm.h` (`kx_ext_quality_t` 5 mức, 10 reason, `sample_utc_ms`/`sample_mono_ns`) | `ShmLayoutV2.*`, `ExtCache.*` — 61/61 PASS trên board aarch64 |
| `SWR-REQ-MBRTU-007` atomic apply | `internal/modbusrtu/{candidate,journal}.go`, `Persister.Apply` | `TestModbusApplyPromotesCandidate*`, ACK thật `applied_revision=11` từ iobus |
| `SWR-REQ-MBRTU-006` write path | `bus_worker.cpp` (`PendingWrite`, `WriteResult`, hàng đợi bounded) | `BusWorkerWriteQueue.*`, `ModbusMasterWriteLifecycle.*` |
| `SYS-REQ-MBRTU-001` hai bus | `bus_worker.{hpp,cpp}`, `buses[]` trong `fieldbus.conf` | `BusWorkerIsolation.DeadPortOnOneBusDoesNotStopTheOther`; **bus 2 chờ `ttyS1` enable** |
| `IF-REQ-MBRTU-002` provenance | `kx_ext_snapshot_v2_t` | `status` trên board: `generation`, `config_revision=11`, `producer_boot_id`, `sequence` |
| `SEC-REQ-MBRTU-001` RBAC commissioning | `modbus_config_api.go` (rate limit + audit), `control_channel.cpp` (`SO_PEERCRED`) | `TestModbusReadTestIsRateLimitedPerUser`; probe thật qua UDS trên board |
| `G-D` điều hướng RS-485 | `buses[].direction`, `BusWorker::apply_direction_mode()` | `bus_worker.rs485_direction bus=1 mode=auto driver_enabled=0 rts_on_send=0` |
| Reboot recovery | `platform/udev/99-mkddc-rs485.rules` + `deploy_board.sh` | Reboot ×10 **PASS 10/10** (trước khi có udev rule: FAIL 10/10) |
| `VR-MBRTU-011` HIL | — | **CHỜ `G-C`** — chưa có slave RS-485 thật |

### Revision history

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.2 | 2026-08-06 | Thêm phụ lục bằng chứng Track B; đối chiếu source chuyển sang `main` sau Track B |
