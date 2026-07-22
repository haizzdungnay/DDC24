# docs/03_implementation/ — Implementation Guides & Checklists

> **Owner:** Dev Lead | **Last Updated:** 2026-07-15

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
| [08](08_MKDDC_HMI_IMPLEMENTATION_GUIDE.md) | HMI/LVGL/DRM local display | Implementation in progress |
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
| [19](19_DOCS_AUDIT_SOM_IMPLEMENTATION.md) | Docs audit 2026-06-11 | Historical |
| [20](20_DOCS_FIX_CHECKLIST.md) | Fix checklist từ audit | Historical |
| [21](21_VIRTUAL_COM_DECISION.md) | Virtual COM/PTY decision | Active |
| [22](22_SOM_SRC_IMPLEMENTATION_PLAN.md) | SOM source build plan S0-S8, gồm coherent historian snapshot | Active |
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
| [35](35_ROOT_HELPER_CONTRACT.md) | Root helper contract | Approved |
| [36](36_GENERATION_STORE_DESIGN.md) | Immutable generation store design | Approved |
| [37](37_TIME_AND_RECONNECT_DESIGN.md) | Time/reconnect behavior | Approved |
| [38](38_TELEMETRY_SHM_CONTRACT.md) | Telemetry SHM contract | Approved |
| [40](40_CONFIG_ROOT_MIGRATION_PLAN.md) | Config root migration | Approved |
| [41](41_SETTINGS_NETWORK_TEST_PLAN.md) | Settings/Network test plan | Approved |
| [42](42_HISTORIAN_FE_PROTOTYPE_PLAN.md) | SQLite historian, shared point logging, unified Trends | Approved — implementation open |
| [43](43_GLOBAL_POINT_TAG_PLAN.md) | Independent point tag/name namespaces + Programming alias | Approved — implementation open |

**Archived:** [S7 Hardening Code Review](../review/2026-06-13-s7-hardening-review.md)
