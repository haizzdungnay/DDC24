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

## 5. Revision History

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-08 | Lập ma trận cho 56 requirement PA3, hợp đồng API và số đo gate |
