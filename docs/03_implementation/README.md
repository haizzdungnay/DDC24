# docs/03_implementation/ — Implementation Guides & Checklists

> **Recovery status (2026-07-22): In Review.** Bộ hướng dẫn đã được phục hồi đầy đủ để giữ implementation knowledge. Trạng thái `Active/FROZEN` trong bảng là trạng thái lịch sử; phải đối chiếu với baseline, code và test hiện hành trước khi dùng cho release.

> **Owner:** Dev Lead | **Last Updated:** 2026-07-22

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
| [08](08_MKDDC_HMI_IMPLEMENTATION_GUIDE.md) | ADR-016 HMI microtask plan HOP-000..077 | Host implementation complete; target/HIL/usability acceptance pending |
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
| [22](22_SOM_SRC_IMPLEMENTATION_PLAN.md) | SOM source build plan S0-S7 | Active |
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

**Archived:** [S7 Hardening Code Review](../review/2026-06-13-s7-hardening-review.md)
