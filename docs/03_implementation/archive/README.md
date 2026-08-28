# docs/03_implementation/archive/ — Hồ sơ triển khai đã đóng

> **Owner:** Dev Lead | **Lập:** 2026-08-19
> **Quy tắc:** thư mục này chỉ chứa hồ sơ triển khai **đã đóng** hoặc **đã bị thay thế**.
> Nội dung giữ nguyên để truy nguyên; **không** dùng làm căn cứ mở việc mới, không dùng làm
> nguồn-chuẩn cho mã hiện hành. Tài liệu đang sống nằm ở thư mục cha
> [`docs/03_implementation/`](../README.md).

## Khi nào một hồ sơ được chuyển vào đây

Đúng một trong ba điều kiện, và phải kiểm chứng lại bằng mã nguồn chứ không chỉ đọc lời tự khai
trong tài liệu:

1. **Đóng** — mọi task và cổng của plan đã đạt, hoặc phần còn treo đã được chuyển giao cho một
   hồ sơ khác đang sống (ghi rõ hồ sơ nhận trong banner).
2. **Bị thay thế** — có tài liệu mới giữ vai trò nguồn-chuẩn cho cùng phạm vi.
3. **Chụp trạng thái lịch sử** — báo cáo/checklist gắn với một mốc thời gian đã qua và mô tả cây
   thư mục hoặc số đo không còn khớp mã nguồn.

Mỗi file mang banner `🗄 ĐÃ LƯU TRỮ` ngay sau tiêu đề, nêu **lý do đóng** và **đọc thay bằng gì**.

## Danh mục

| File | Trạng thái gốc | Lý do đóng | Đọc thay bằng |
|------|---------------|-----------|--------------|
| [16_CONTRACT_FREEZE](16_CONTRACT_FREEZE.md) | SUPERSEDED | Freeze hợp đồng IOP v1.1 ngày 2026-06-11 đã bị thay | `contracts/iop/iop_protocol.h` v2.0 · ADR-010 · [05](../05_IOP_UART_IMPLEMENTATION_GUIDE.md) |
| [18_WEEK1_SOM_BRINGUP_CHECKLIST](18_WEEK1_SOM_BRINGUP_CHECKLIST.md) | Active (lỗi thời) | 8 mốc tuần đầu đã qua; lệnh build trỏ `services/` đã bị `PLAN-ARCH-RESTRUCT-002` xoá | [14](../14_BRINGUP_GUIDE.md) · [17](../17_QUICK_START_SOM_DEV.md) · [27](../27_SOM_BOARD_DEPLOY_NO_MCU_RUNBOOK.md) |
| [23_GRAPH_STATEFUL_COMPONENTS_PLAN](23_GRAPH_STATEFUL_COMPONENTS_PLAN.md) | Đã implement | `COR-009`/`COR-010` xong, 97/97 test pass 2026-06-13; mã tại `apps/core/domain/graph/` | [07](../07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md) · SW_COMPONENT_LIBRARY |
| [24_SOM_FW_STATUS_REPORT_ISO](24_SOM_FW_STATUS_REPORT_ISO.md) | Báo cáo 2026-06-13 | Chụp trạng thái trên cây `services/` đã xoá | [11](../11_TASK_CHECKLIST.md) · [`docs/07_records/`](../../07_records/) |
| [26_MODBUS_IMPLEMENTATION_PLAN](26_MODBUS_IMPLEMENTATION_PLAN.md) | SUPERSEDED một phần | Mô tả As-Built v1, không phải target; tự cấm dùng mở implementation mới | [49](../49_MODBUS_RTU_IMPLEMENTATION_PLAN.md) · DDD-FW-MBRTU-001 · ICD-IF-MBRTU-001 · VVP-MBRTU-001 |
| [32_DEV_TEAM_NEXT_ACTION](32_DEV_TEAM_NEXT_ACTION.md) | SUPERSEDED | Ba task chặn `IOB-006`/`MOD-012`/`BAC-012` đã xử lý; số liệu sai so với đo thật | [11](../11_TASK_CHECKLIST.md) · [31](../31_PROTOCOL_LIB_INTEGRATION_PLAN.md) |
| [46_REPOSITORY_ARCHITECTURE_RESTRUCTURE_PLAN](46_REPOSITORY_ARCHITECTURE_RESTRUCTURE_PLAN.md) | Closed | G0..G5 PASS, closure review `RST-205` 2026-08-04 | [47](../47_RST202_TARGET_ACCEPTANCE_RUNBOOK.md) (nghiệm thu target còn mở) |
| [50_SCHEDULER_V3_1_IMPLEMENTATION_PLAN](50_SCHEDULER_V3_1_IMPLEMENTATION_PLAN.md) | 96/96 task đóng | Đã merge `main` + deploy Foxlinx 2026-08-07; cờ vật lý chuyển cho ADR-023 và plan 49 | ADR-023 · [49](../49_MODBUS_RTU_IMPLEMENTATION_PLAN.md) |
| [52_WEB_PA3_DASHBOARD_UX_IMPLEMENTATION_PLAN](52_WEB_PA3_DASHBOARD_UX_IMPLEMENTATION_PLAN.md) | HOÀN TẤT | 50/50 task, G0–G6 đạt, deploy + diễn tập rollback 2026-08-08; `PA3-N01/N02/N04` chuyển cho hồ sơ bằng chứng | [EV-WEB-PA3-001](../../07_records/test-evidence/fw-som/2026-08-08-web-pa3-dashboard.md) · [UX_PA3_TRACEABILITY](../../05_verification/UX_PA3_TRACEABILITY.md) |

## Kiểm chứng đã làm trước khi lưu trữ (2026-08-19)

| Hồ sơ | Bằng chứng mã nguồn |
|-------|--------------------|
| 46 | `apps/{core,iobus,netcfg,hmi,web-api,web-ui}` tồn tại · `services/` không còn · `CMakeLists.txt` gốc `add_subdirectory` trỏ `MKDDC_*_SOURCE_DIR` |
| 50 | `apps/core/application/schedule/{schedule_runtime,schedule_clock}.{hpp,cpp}` · `apps/iobus/adapters/bacnet/bacnet_schedule.{hpp,cpp}` · `apps/web-ui/src/features/scheduler/` |
| 52 | `apps/web-ui/src/features/{dashboard,operations,points}` · hồ sơ bằng chứng `EV-WEB-PA3-001` |
| 26 | `apps/iobus/adapters/modbus_rtu/{bus_worker,device_profile,ext_cache,control_channel}.{hpp,cpp}` · `apps/web-ui/src/features/modbus-rtu/` |
| 23 | `apps/core/domain/graph/graph_runtime.hpp` · `apps/core/application/alarm/alarm_runtime.hpp` |
| 16 | `contracts/iop/iop_protocol.h` · `contracts/shm/mkddc_shm.h` là nguồn-chuẩn hiện hành |
