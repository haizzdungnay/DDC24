# Interface Detailed Design Index

**ID:** IF-DES-INDEX-001
**Trạng thái:** In Review — recovered 2026-07-22
> **Owner:** Tech Lead | **Last Updated:** 2026-07-22

Các tài liệu interface được phục hồi nguyên văn. [Interface Baseline](../../04_design/INTERFACES.md), `contracts/iop/iop_protocol.h`, `contracts/shm/mkddc_shm.h`, route/schema/validator code hiện hành là authority khi có xung đột.

| File | Mô tả |
|------|-------|
| [CONFIG_SCHEMA](CONFIG_SCHEMA_MK-DDC-24_VI.md) | System config JSON schema, point tag/name namespaces, historian.conf |
| [GRAPH_SCHEMA](GRAPH_SCHEMA_MK-DDC-24_VI.md) | Graph/component JSON schema |
| [REST_API_OPENAPI](REST_API_OPENAPI_MK-DDC-24_VI.md) | REST API spec, historian policy/query + point namespace errors |
| [contracts/openapi/openapi.yaml](../../../contracts/openapi/openapi.yaml) | REST API OpenAPI 3.1 v1.6.0 (machine-readable) |
| [MODBUS_REGISTER_MAP](MODBUS_REGISTER_MAP_MK-DDC-24_VI.md) | Modbus register map — **SUPERSEDED một phần 2026-08-04** (xem banner trong file) |
| [MODBUS_RTU_API_SPEC](MODBUS_RTU_API_SPEC.md) | REST/WebSocket API Modbus RTU đề xuất — **In Review 2026-08-04** |
| [MODBUS_RTU_INTERFACE_SPEC](MODBUS_RTU_INTERFACE_SPEC.md) | Luồng end-to-end, interface matrix và contract runtime v2 — **In Review 2026-08-04** |
| [BACNET_PICS_EPICS](BACNET_PICS_EPICS_MK-DDC-24_VI.md) | BACnet PICS/EPICS |
| [SWFW_INTERFACE_SPEC](../../01_specs/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md) | SOM/MCU interface specification |

IOP v1 timing, BACnet MS/TP, MQTT/cloud hoặc field count 8 UI + 8 DI trong recovered content phải được coi là superseded cho đến khi được reconcile với baseline.
