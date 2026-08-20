# Traceability Web PA3 — requirement → source → test → bằng chứng

> **ID:** TRACE-WEB-PA3-001
> **Ngày:** 2026-08-08
> **Requirement:** [UX_REQ_PA3_WEB.md](../02_requirements/UX_REQ_PA3_WEB.md)
> **Plan:** [52_WEB_PA3_DASHBOARD_UX_IMPLEMENTATION_PLAN.md](../03_implementation/archive/52_WEB_PA3_DASHBOARD_UX_IMPLEMENTATION_PLAN.md)
> **Bằng chứng runtime:** [EV-WEB-PA3-001](../07_records/test-evidence/fw-som/2026-08-08-web-pa3-dashboard.md)

Một hàng chỉ được ghi `ĐẠT` khi có **cả bốn cột** đầy đủ. Requirement chỉ có
source mà không có test là requirement chưa nghiệm thu, dù mã đã merge.

---

## 1. Ma trận chính

| Requirement | Source | Test | Bằng chứng | Trạng thái |
|---|---|---|---|---|
| REQ-PA3-01-1 | `internal/app/overview.go` `buildOverview` · `shared/api/overview.ts` | `TestOverviewSchemaAndDomains` | EV §3.1 | ĐẠT |
| REQ-PA3-01-2 | `overview.go` `overallFromParts` | `TestOverviewOverallOfflineWhenCoreUnreachable` | EV §3.1 (`fault` thật trên bo) | ĐẠT |
| REQ-PA3-01-3 | `overview.go` `overviewHealth` | `TestOverviewSchemaAndDomains` | EV §3.1 | ĐẠT |
| REQ-PA3-01-4 | `overview.go` `newestPointTimestamp` · `pointNormalizer.ts` | `TestOverviewLastDataAtIgnoresMissingTimestamps` · `DashboardPage.test.tsx` | EV §4 PA3-N01 | ĐẠT ở FE; backend còn hở (PA3-N01) |
| REQ-PA3-01-5 | `features/dashboard/DashboardPage.tsx` | `DashboardPage.test.tsx` · `e2e/pa3-dashboard.spec.ts` | EV §3.4 | ĐẠT |
| REQ-PA3-01-6 | `DashboardPage.tsx` · `DiagnosticsPage.tsx` | `DashboardPage.test.tsx` · e2e | EV §3.4 | ĐẠT |
| REQ-PA3-01-7 | `shared/api/overview.ts` `OverviewSchemaError` · `OverviewProvider.tsx` | `DashboardPage.test.tsx` · e2e | — | ĐẠT |
| REQ-PA3-01-8 | `DashboardPage.tsx` bố cục | `e2e/pa3-dashboard.spec.ts` (boundingBox < 900) | — | ĐẠT |
| REQ-PA3-02-1 | `features/points/MonitorPage.tsx` | `MonitorPage.test.tsx` | — | ĐẠT |
| REQ-PA3-02-2 | `MonitorPage.tsx` `matchesStateFilter` | `MonitorPage.test.tsx` | — | ĐẠT |
| REQ-PA3-02-3 | `MonitorPage.tsx` `useSearchParams` | `e2e/pa3-dashboard.spec.ts` | — | ĐẠT |
| REQ-PA3-02-4 | `MonitorPage.tsx` haystack | `MonitorPage.test.tsx` | — | ĐẠT |
| REQ-PA3-02-5 | `overview.go` `overviewCapabilities` | `TestOverviewNeverInventsDigitalInputs` | EV §3.1 | ĐẠT |
| REQ-PA3-03-1 | `shared/api/pointNormalizer.ts` | `pointNormalizer.test.ts` | — | ĐẠT |
| REQ-PA3-03-2 | `shared/utils.ts` `formatValue`/`formatTime` | `pointNormalizer.test.ts` · `utils.test.ts` | — | ĐẠT |
| REQ-PA3-03-3 | `pointNormalizer.ts` bus/slave/exception/online | `pointNormalizer.test.ts` | — | ĐẠT |
| REQ-PA3-03-4 | `MonitorPage.tsx` `PointHistoryPanel` | `MonitorPage.test.tsx` | — | ĐẠT |
| REQ-PA3-03-5 | `MonitorPage.tsx` (đã xoá khối giả) | `MonitorPage.test.tsx` | — | ĐẠT |
| REQ-PA3-04-1 | `internal/app/points.go` · `core_client.go` `ForcePointTTL` · `ws.go` | `TestOverrideTTLIsOwnedByCore` | EV §3.3 | ĐẠT |
| REQ-PA3-04-2 | `points.go` `withAuthoritativeOverride` | `TestOverrideTTLIsOwnedByCore` | EV §3.3 bước 2 | ĐẠT |
| REQ-PA3-04-3 | `override.go` `OverrideRegistry` + query Core | `TestOverrideSurvivesWebAPIRestart` | EV §3.3 bước 4 | ĐẠT |
| REQ-PA3-04-4 | `override.go` `Refresh` giữ mục khi lỗi | `TestOverrideKeptWhenCoreQueryFails` | — | ĐẠT |
| REQ-PA3-04-5 | `points.go` `decodeForcePointBody` | `TestOverrideTTLRangeIsValidated` | — | ĐẠT |
| REQ-PA3-04-6 | `MonitorPage.tsx` hộp thoại | `MonitorPage.test.tsx` | — | ĐẠT |
| REQ-PA3-04-7 | `MonitorPage.tsx` (không có selector) | rà source | UX-DES §24 | ĐẠT |
| REQ-PA3-04-8 | `points.go` audit + Core | `TestConcurrentOverridesAreBothAudited` | — | ĐẠT |
| REQ-PA3-05-1 | `AlarmsPage.tsx` · `AlarmDTO` | `AlarmsPage` tests | — | ĐẠT |
| REQ-PA3-05-2 | `shared/components/AlarmRow.tsx` `canAct` | `RequireRole.test.tsx` | — | ĐẠT |
| REQ-PA3-05-3 | `internal/app/http.go` `RoleOperator` | `TestViewerCannotOverride` (cùng lớp) | — | ĐẠT |
| REQ-PA3-06-1 | `TrendsPage.tsx` `slice(0, 8)` | `TrendsPage.test.tsx` | — | ĐẠT |
| REQ-PA3-06-2 | `TrendChart.tsx` `connectNulls={false}` · `buildHistoryChartModel` | `TrendsPage.test.tsx` | — | ĐẠT |
| REQ-PA3-06-3 | `HistoryStateBanner.tsx` | `TrendsPage.test.tsx` · `e2e/trends.spec.ts` | — | ĐẠT |
| REQ-PA3-06-4 | `TrendChart.tsx` `hasMinMaxBand` + `Area` | `TrendChart` band testid | — | ĐẠT |
| REQ-PA3-06-5 | `TrendsPage.tsx` `csvHref` · `historyCsvUrl` | `e2e/trends.spec.ts` (đường query) | — | ĐẠT |
| REQ-PA3-07-1 | `SchedulerGridPage.tsx` `canEdit` · `ScheduleEditorPage.tsx` | `RequireRole.test.tsx` · `e2e/scheduler.spec.ts` | — | ĐẠT |
| REQ-PA3-07-2 | `features/auth/roles.ts` | `RequireRole.test.tsx` | — | ĐẠT |
| REQ-PA3-08-1 | `CommissioningPage.tsx` `prerequisites` | `CommissioningPage.test.tsx` | — | ĐẠT |
| REQ-PA3-08-2 | `CommissioningPage.tsx` `running` | `CommissioningPage.test.tsx` | — | ĐẠT |
| REQ-PA3-08-3 | `CommissioningPage.tsx` `TestOutcomeRow` | `CommissioningPage.test.tsx` | — | ĐẠT |
| REQ-PA3-08-4 | `CommissioningPage.tsx` release path | `CommissioningPage.test.tsx` | — | ĐẠT |
| REQ-PA3-08-5 | `CommissioningPage.tsx` link `/activity` | `CommissioningPage.test.tsx` | — | ĐẠT |
| REQ-PA3-09-1 | `features/modbus-rtu/components/HierarchyTree.tsx` | `OverviewPage.test.tsx` (`role=tree`) | — | ĐẠT |
| REQ-PA3-09-2 | `HierarchyTree.tsx` (serial ở cấp bus) | rà source | UX-REQ UC-09 | ĐẠT |
| REQ-PA3-09-3 | `HierarchyTree.tsx` `deviceState` | `OverviewPage.test.tsx` | — | ĐẠT |
| REQ-PA3-09-4 | `HierarchyTree.tsx` link `/monitor?point=` | `OverviewPage.test.tsx` | — | ĐẠT |
| REQ-PA3-10-1 | `NetworkPage.tsx` `NetworkCandidateDiff` | `NetworkPage.test.tsx` | — | ĐẠT |
| REQ-PA3-11-1 | `internal/app/networktransaction.go` · `NetworkPage.tsx` | `e2e/network-qa.spec.ts` | — | ĐẠT |
| REQ-PA3-11-2 | `NetworkPage.tsx` countdown | `e2e/network-qa.spec.ts` | — | ĐẠT |
| REQ-PA3-11-3 | `NetworkPage.tsx` khối địa chỉ mới | `NetworkPage.test.tsx` | — | ĐẠT |
| REQ-PA3-11-4 | `NetworkPage.tsx` đọc `reasonCode` | `e2e/network-qa.spec.ts` | — | ĐẠT |
| REQ-PA3-12-1 | rà toàn bộ `apps/web-ui/src` | grep OTA/reboot/restart = 0 kết quả | — | ĐẠT |
| REQ-PA3-X-1 | `internal/auth/audit.go` sink · `internal/app/activity.go` | `TestActivityRecordsPointCommandWithoutSecrets` | EV §3.2 | ĐẠT |
| REQ-PA3-X-2 | `activity.go` `Query` | `TestActivityPaginationIsStable` | — | ĐẠT |
| REQ-PA3-X-3 | `shared/overview/drilldown.ts` | `drilldown.test.ts` | — | ĐẠT |
| REQ-PA3-X-4 | `shared/components/AppShell.tsx` skip link | `e2e/pa3-dashboard.spec.ts` | — | ĐẠT |
| REQ-PA3-X-5 | `shared/components/pa3/CommandPalette.tsx` | `e2e/pa3-dashboard.spec.ts` | — | ĐẠT |
| REQ-PA3-X-6 | bố cục responsive | `e2e/pa3-dashboard.spec.ts` (scrollWidth) | — | ĐẠT |
| REQ-PA3-X-7 | `roles.ts` · `http.go` route table | `TestViewerCannotOverride` · `RequireRole.test.tsx` | — | ĐẠT |

## 2. Hợp đồng API

| Endpoint | Spec | Hiện thực | Test |
|---|---|---|---|
| `GET /api/v1/overview` | `contracts/openapi/openapi.yaml` `#/paths/~1overview` | `internal/app/overview.go` | `TestOverviewSchemaAndDomains` |
| `GET /api/v1/activity` | `#/paths/~1activity` | `internal/app/activity.go` | `TestActivityPaginationIsStable` |
| `PUT /api/v1/points/{id}` (`ttlS`) | `#/paths/~1points~1{id}/put` | `internal/app/points.go` | `TestOverrideTTLRangeIsValidated` |
| `Point.overrideExpiresInS` | `#/components/schemas/Point` | `internal/app/dto.go` | `TestOverrideTTLIsOwnedByCore` |

## 3. Gate và số đo (2026-08-08)

| Gate | Lệnh | Kết quả |
|---|---|---|
| C++ | `ctest --test-dir build/fw` | 860/860 |
| Go | `go vet ./...` + `go test ./... -count=1` | sạch, 11/11 gói |
| FE unit | `npx vitest --run --environment jsdom src` | 465/465 |
| FE lint | `npm run lint` | sạch |
| FE build | `npm run build` | PASS |
| E2E | `npx playwright test` | 49/49 |

## 4. Requirement chưa đóng

| Requirement | Vì sao | Ghi ở |
|---|---|---|
| REQ-PA3-01-4 (phần backend) | PLC SHM chưa mang mốc lấy mẫu; cần đổi `contracts/shm/mkddc_shm.h` và deploy lại Core | PA3-N01 |
| Nghiệm thu vai trò ở E2E | `VITE_AUTH_MODE=mock` luôn cấp `admin` | PA3-N04 |

## 5. Plan 57 — UC/UI/UX Rev A (2026-08-19)

[Plan 57](../03_implementation/57_WEB_UIUX_UC_UPGRADE_PLAN.md) bổ sung năng lực
mới cho cùng họ trang PA3. Ghi ở đây theo `DOC_GOVERNANCE` §7 bước 3: hồ sơ này
là nơi duy nhất nối **requirement → source → test** cho web, nên một plan đóng mà
không sync vào đây sẽ để lại một mảng năng lực không có đường truy vết.

Quy ước cột **Bằng chứng** giữ nguyên §1: `—` nghĩa là *chưa có bằng chứng
runtime riêng*, không phải *chưa kiểm*; cột Test mới là điều kiện `ĐẠT`.

| Năng lực (task) | Source | Test | Bằng chứng | Trạng thái |
|---|---|---|---|---|
| Thẻ thiết bị + lọc `?equip=` (`T57-3.1`) | `internal/app/equipmenttag.go` · `features/points/MonitorPage.tsx` | `equipmenttag_test.go` · `MonitorPage.equipment.test.tsx` | — | ĐẠT |
| Tuỳ chọn theo tài khoản (`T57-3.2`) | `internal/app/useraccess.go` · `shared/hooks/useSavedViews.ts` | `useraccess_test.go` | — | ĐẠT |
| Chỉ số hệ cảnh báo ISA-18.2 (`T57-3.3`) | `internal/app/alarmmetrics.go` · `features/operations/AlarmMetricsPanel.tsx` | `alarmmetrics_test.go` (8) | UX §3 `OPS-03` | ĐẠT |
| Lịch sử tài nguyên hệ thống (`T57-3.4`) | `internal/app/systemhistory.go` | `wave3_diagnostics_test.go` | — | ĐẠT |
| Hiệu lực thực tế + xung đột lịch (`T57-3.5`/`3.6`/`3.7`) | `internal/app/scheduleeffective.go` · `features/scheduler/tabs/EffectiveTab.tsx` | `coresim_shell_test.go` | UX §8b `SCH-EFF-01` | ĐẠT |
| Xem khung truyền Modbus (`T57-3.9`) | `iobus/adapters/modbus_rtu/frame_ring.hpp` · `internal/app/modbusframes.go` · `features/modbus-rtu/components/FrameMonitor.tsx` | `test_frame_ring.cpp` (8) · `BusWorkerFrames` · `modbusframes_test.go` (6) · `FrameMonitor.test.tsx` (6) | EV 2026-08-19 (board: op `frames` trả `ok`, route trả 401 ≠ 404) | ĐẠT |
| Mẫu thiết bị Modbus (`T57-3.11`) | `internal/app/modbustemplates.go` | `modbustemplates_test.go` (4) | — | ĐẠT |
| Cảnh báo điểm ảo đang được dùng (`T57-3.12`) | `internal/app/virtualpoint_usage.go` | `wave3_diagnostics_test.go` · `VirtualPointUsageNotice.test.tsx` (6) | — | ĐẠT |
| Mô phỏng + ước lượng luật cảnh báo (`T57-2.13`/`T57-3.13`) | `core/application/alarm/alarm_sim_main.cpp` · `internal/app/alarmsimulate.go` · `internal/app/alarmestimate.go` | ctest `alarm_sim_behaviour` (13) · `alarmestimate_test.go` (5) | EV 2026-08-19 (board: engine chạy đúng dưới user `mkddc`) | ĐẠT |
| Diff cấu hình trong nhật ký (`T57-3.14`) | `internal/app/configdiff.go` | `wave3_diagnostics_test.go` | — | ĐẠT |
| Đồng bộ giờ + cảnh báo lệch (`T57-3.15`) | `internal/app/systemhistory.go` | `wave3_diagnostics_test.go` | — | ĐẠT |
| Nhật ký truy cập người dùng (`T57-3.16`) | `internal/app/useraccess.go` | `useraccess_test.go` | — | ĐẠT |
| Cưỡng chế đổi mật khẩu (`T57-3.17`) | `internal/app/useraccess.go` · `features/auth/ForcePasswordChangePage.tsx` | `useraccess_test.go` · `ForcePasswordChangePage.test.tsx` (6) | — | ĐẠT |
| Kiểm kết nối mạng khi đổi cấu hình (`T57-3.18`) | `internal/app/networkcheck.go` | `networkcheck_test.go` (6) | — | ĐẠT |
| Đếm ngược TTL ép tay trên HMI (`T57-3.19`) | `hmi/screens/screen_control.cpp` | `test_override_countdown.cpp` (5) | — | ĐẠT |
| Chỉ báo số phiên web trên HMI (`T57-3.20`) | `hmi/screens/screen_control.cpp` | như trên | — | ĐẠT |
| Tách chunk theo lô nghiệp vụ (`T57-4.2`) | `web-ui/src/App.tsx` | đo trên board thật | Plan 57 §13b (12 cặp mẫu, FCP −236 ms trung vị) | ĐẠT |

### 5.1 Hợp đồng API mới của Plan 57

| Endpoint | Vai trò tối thiểu | Hiện thực | Test |
|---|---|---|---|
| `GET /api/v1/alarms/metrics` | viewer | `internal/app/alarmmetrics.go` | `alarmmetrics_test.go` |
| `GET /api/v1/schedules/effective` | viewer | `internal/app/scheduleeffective.go` | `coresim_shell_test.go` |
| `GET /api/v1/modbus/frames` | viewer | `internal/app/modbusframes.go` | `modbusframes_test.go` |
| `GET /api/v1/modbus/templates` | viewer | `internal/app/modbustemplates.go` | `modbustemplates_test.go` |
| `POST /api/v1/alarm-settings/simulate` | operator | `internal/app/alarmsimulate.go` | `coresim_shell_test.go` |
| `POST /api/v1/alarm-settings/estimate` | operator | `internal/app/alarmestimate.go` | `alarmestimate_test.go` |
| `GET/PUT /api/v1/me/preferences` | viewer | `internal/app/useraccess.go` | `useraccess_test.go` |
| `GET /api/v1/users/access` | admin | `internal/app/useraccess.go` | `useraccess_test.go` |
| `GET /api/v1/system/history` | viewer | `internal/app/systemhistory.go` | `wave3_diagnostics_test.go` |
| `POST /api/v1/network/connectivity-check` | admin | `internal/app/networkcheck.go` | `networkcheck_test.go` |
| `GET /api/v1/virtual-points/{id}/usage` | viewer | `internal/app/virtualpoint_usage.go` | `wave3_diagnostics_test.go` |

### 5.2 Gate và số đo Plan 57 (2026-08-19)

| Gate | Lệnh | Kết quả |
|---|---|---|
| C++ | `ctest --test-dir build/fw` (MODBUS+BACNET+HMI ON) | **1049/1049** |
| Go | `go vet ./...` + `go test ./... -count=1` | sạch, 18 gói |
| FE unit | `npx vitest --run --environment jsdom src` | **1056/1056** (110 file) |
| FE lint | `npm run lint` | sạch |
| FE build | `npm run build:foxlinx` | PASS |
| Tài liệu | `python3 scripts/docs_iso_harness.py --expect` | PASS |

### 5.3 Hai năng lực Plan 57 KHÔNG có trong ma trận trên

| Mục | Vì sao vắng mặt |
|---|---|
| `T57-3.8` — quét bus Modbus | **Hoãn sang Rev B.** Quét là ghi ra RS-485 thật; `IMPLEMENT_READY` giữ `BLOCKED` theo `AUTH-WEBUX-2026-08-19-02` quyết định 1 |
| Chặn Back/Forward trong `useDirtyGuard` | Khoảng hở đã biết, cần `useBlocker` của data router trong khi app dùng `<BrowserRouter>`. Rời trang bằng liên kết trong ứng dụng **đã** được chặn; chỉ nút Back/Forward của trình duyệt là chưa |

## 6. Revision History

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-08 | Lập ma trận cho 56 requirement PA3, hợp đồng API và số đo gate |
| 1.1 | 2026-08-19 | Thêm §5 — ma trận truy vết cho **Plan 57 Rev A** (17 năng lực mới, 11 endpoint mới, số đo gate 2026-08-19), và §5.3 ghi hai mục cố ý vắng mặt kèm lý do. Sync theo `DOC_GOVERNANCE` §7 bước 3 khi đóng Plan 57 |
