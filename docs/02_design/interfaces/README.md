# docs/02_design/interfaces/ — Protocol & API Contracts

> **Owner:** Tech Lead | **Last Updated:** 2026-07-15

Hợp đồng interface giữa các subsystem. Đây là nguồn-chuẩn cấp cao nhất sau `shared/*.h`.

| File | Mô tả |
|------|-------|
| [CONFIG_SCHEMA](CONFIG_SCHEMA_MK-DDC-24_VI.md) | System config JSON schema, point tag/name namespaces, historian.conf |
| [GRAPH_SCHEMA](GRAPH_SCHEMA_MK-DDC-24_VI.md) | Graph/component JSON schema |
| [REST_API_OPENAPI](REST_API_OPENAPI_MK-DDC-24_VI.md) | REST API spec, historian policy/query + point namespace errors |
| [openapi.yaml](openapi.yaml) | REST API OpenAPI 3.1 v1.6.0 (machine-readable) |
| [MODBUS_REGISTER_MAP](MODBUS_REGISTER_MAP_MK-DDC-24_VI.md) | Modbus register map |
| [BACNET_PICS_EPICS](BACNET_PICS_EPICS_MK-DDC-24_VI.md) | BACnet PICS/EPICS |

**Thứ tự ưu tiên:** `shared/*.h` > đây > `02_design/software/` > `03_implementation/`
