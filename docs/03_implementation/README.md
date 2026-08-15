# docs/03_implementation/ — Implementation Guides & Checklists

> **Recovery status (2026-07-22): In Review.** Bộ hướng dẫn đã được phục hồi đầy đủ để giữ implementation knowledge. Trạng thái `Active/FROZEN` trong bảng là trạng thái lịch sử; phải đối chiếu với baseline, code và test hiện hành trước khi dùng cho release.

> **Owner:** Dev Lead | **Last Updated:** 2026-08-09

Bộ tài liệu triển khai thực tế của MK-DDC-24. Đọc `00_IMPLEMENTATION_README.md` trước.

## Index

| File | Mô tả | Trạng thái |
|------|-------|-----------|
| [00](00_IMPLEMENTATION_README.md) | Entry point — đọc đầu tiên | Active |
| [01](01_SYSTEM_IMPLEMENTATION_OVERVIEW.md) | Tổng quan hệ thống mức implement | Active |
| [02](02_TEAM_WORK_SPLIT.md) | Chia việc 3 nhóm dev | Active |
| [03](03_PHASE_PLAN.md) | Lộ trình 7 phase | Active |
| [04](04_FW_MCU_IMPLEMENTATION_GUIDE.md) | Hướng dẫn FW STM32 | Draft |
| [05](05_IOP_UART_IMPLEMENTATION_GUIDE.md) | Hợp đồng IOP/UART v2.0 | Active |
| [06](06_MKDDC_IOBUS_IMPLEMENTATION_GUIDE.md) | Service mkddc-iobus | Active |
| [07](07_MKDDC_CORE_IMPLEMENTATION_GUIDE.md) | Service mkddc-core | Active |
| [08](08_MKDDC_HMI_IMPLEMENTATION_GUIDE.md) | ADR-016 HOP-000..077 + ADR-017 network HMI HNW-000..013 | Network service path target-verified; panel usability pending |
| [09](09_MKDDC_WEB_IMPLEMENTATION_GUIDE.md) | Web REST API + UI (Go) | Active |
| [10](10_END_TO_END_DATA_FLOW.md) | E2E data flow + debug checklist | Active |
| [11](11_TASK_CHECKLIST.md) | Master task tracker | Active |
| [12](12_INTEGRATION_TEST_PLAN.md) | Test plan on board | Active |
| [13](13_DEFINITION_OF_DONE.md) | Definition of Done | Active |
| [14](14_BRINGUP_GUIDE.md) | Board bring-up guide | Active |
| [15](15_RELEASE_HANDOVER_CHECKLIST.md) | Pre-release checklist | Draft |
| [16](16_CONTRACT_FREEZE.md) | Frozen contract (header wins) | FROZEN |
| [17](17_QUICK_START_SOM_DEV.md) | Quickstart cho dev mới | Active |
| [18](18_WEEK1_SOM_BRINGUP_CHECKLIST.md) | 8 mốc tuần đầu SOM | Active |
| 19–20 — đã loại 2026-08-14 | Audit/checklist tài liệu ngày 2026-06-11 dùng cây source cũ; phục hồi tại `b69fdf1` khi cần điều tra lịch sử | Historical — không còn authority |
| [21](21_VIRTUAL_COM_DECISION.md) | Virtual COM/PTY decision | Active |
| [22](22_SOM_SRC_IMPLEMENTATION_PLAN.md) | SOM source S0-S8, gồm coherent historian snapshot + ADR-017 network authority NWC-000..017 | Active; network service target-verified, physical HIL/Web FE migration open |
| [23](23_GRAPH_STATEFUL_COMPONENTS_PLAN.md) | Stateful graph components plan | Active |
| [24](24_SOM_FW_STATUS_REPORT_ISO.md) | FW status report ISO format | Active |
| [25](25_BACNET_IMPLEMENTATION_PLAN.md) | BACnet/IP implementation plan | IN PROGRESS |
| [26](26_MODBUS_IMPLEMENTATION_PLAN.md) | Modbus RTU master plan | IN PROGRESS |
| [27](27_SOM_BOARD_DEPLOY_NO_MCU_RUNBOOK.md) | Deploy SOM no-MCU runbook | Active |
| [28](28_IO_CALIBRATION_TEST_PLAN.md) | IO calibration procedure | Active |
| [29](29_REALTIME_BENCHMARK_PROCEDURE.md) | Realtime jitter benchmark | Active |
| [30](30_BACNET_BTL_PRETEST_PROCEDURE.md) | BACnet BTL pretest SOP | Active |
| [31](31_PROTOCOL_LIB_INTEGRATION_PLAN.md) | Protocol lib integration status | IN PROGRESS |
| [32](32_DEV_TEAM_NEXT_ACTION.md) | Next actions blocking list | IN PROGRESS |
| [33](33_BACNET_OBJECT_ALIGNMENT_PLAN.md) | BACnet object alignment | Active |
| 35 — hồ sơ chưa được phục hồi | Root helper contract | Missing — không tạo link giả |
| 36 — hồ sơ chưa được phục hồi | Immutable generation store design | Missing — không tạo link giả |
| 37 — hồ sơ chưa được phục hồi | Time/reconnect behavior | Missing — không tạo link giả |
| 38 — hồ sơ chưa được phục hồi | Telemetry SHM contract | Missing — không tạo link giả |
| 40 — hồ sơ chưa được phục hồi | Config root migration | Missing — không tạo link giả |
| 41 — hồ sơ chưa được phục hồi | Settings/Network test plan | Missing — không tạo link giả |
| [42](42_HISTORIAN_FE_PROTOTYPE_PLAN.md) | SQLite historian, shared point logging, unified Trends | Approved — implementation open |
| 43 — hồ sơ chưa được phục hồi | Independent point tag/name namespaces + Programming alias | Missing — không tạo link giả |
| [46](46_REPOSITORY_ARCHITECTURE_RESTRUCTURE_PLAN.md) | Restructure repository theo process-first + bounded modules; source migration, bounded context, nghiệm thu target và rollback đều hoàn tất | **Closed** — G0..G5 PASS; `RST-205` closure review 2026-08-04 |
| [44](44_TIME_DATE_IEC61131_3_READINESS_PLAN.md) | Time/Date production slice và IEC 61131-3 readiness | In progress — TIME-002/004/005 xong local; gate board/recovery/Rev C còn mở |
| [45](45_WEB_UX_REMEDIATION_AND_CICD_PLAN.md) | Dọn blocker Web UI/UX + CI/CD tự động deploy | Approved — Track A xong 2026-08-01; Track B hoãn |
| [47](47_RST202_TARGET_ACCEPTANCE_RUNBOOK.md) | Runbook nghiệm thu target `RST-202`: build native trên board, install, startup order, crash/restart, provenance và diễn tập rollback | Draft — chờ owner cấp target window |
| [49](49_MODBUS_RTU_IMPLEMENTATION_PLAN.md) | Modbus RTU FE + BE + FW-SOM | Track A + Track B (phần mềm) xong 2026-08-06; treo `G-C`/`G-D` phụ thuộc phần cứng |
| [50](50_SCHEDULER_V3_1_IMPLEMENTATION_PLAN.md) | Scheduler Engine v3.1 — bỏ mô hình thanh ghi `TSx`, chuyển sang Schedule Object (5 pha · 78 task · 63 người-ngày) | **DRAFT — chờ phê duyệt**; P0 là cổng chặn cứng, 6 quyết định treo |
| [52](52_WEB_PA3_DASHBOARD_UX_IMPLEMENTATION_PLAN.md) | Dashboard và Web UX PA3 — data truth, shell, 12 use case, kiểm chứng trình duyệt và deploy Foxlinx (7 pha · 50 task · 56 người-ngày · mục tiêu 9 tuần) | **DRAFT — chờ duyệt G0**; phân tích source/runtime xong, chưa triển khai PA3 |
| [53](53_PROGRAMMING_IMPLEMENTATION_PLAN.md) | Triển khai Programming theo vertical slice ST/FBD → Check → Commission → Runtime → HIL/release | **M3 — REVIEW READY; G0 RED** |
| [54](54_PROGRAMMING_DOCUMENTATION_ROADMAP.md) | Theo dõi tạo, hoàn thiện, review và phê duyệt baseline 22 hồ sơ Programming | **22/22 M3 — REVIEW READY; M4/M5 = 0, chờ người thật** |
| [55](55_UI_UNIVERSAL_INPUT_REDESIGN_PLAN.md) | Thiết kế lại + triển khai trang cấu hình Universal Input `/eng/inputs` (3 phase: FE-only, mở rộng contract, fault detection per-channel) | **Phase 0+1 DONE** 2026-08-14 (13/13 task, deploy Foxlinx xong); Phase 2/3 NOT STARTED, chờ PM/CTO chốt phạm vi |
| [56](56_PROGRAMMING_IMPLEMENTATION_MASTER_PLAN_2026Q3.md) | Master Plan Programming Overview/ST/FBD theo Lệnh CTO/Owner 2026-08-15 (Phase 0-5, WP-01..13 + `WP-MULTIPROGRAM-ARCH`); tracker riêng ở [`PROGRAMMING_IMPLEMENTATION_TRACKER.md`](PROGRAMMING_IMPLEMENTATION_TRACKER.md) | **Phase 0+1 DONE** 2026-08-15 (WP-01..04); **Phase 2 FE DONE** 2026-08-15 (WP-05/06/07 — palette/IO/Inspector); WP-08/09 (Mapping+E2E board) tiếp theo |

**Archived:** [S7 Hardening Code Review](../review/2026-06-13-s7-hardening-review.md)
