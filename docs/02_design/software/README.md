# Software Detailed Design Index

**ID:** SW-DES-INDEX-001
**Trạng thái:** In Review — recovered 2026-07-22

Tài liệu chi tiết được phục hồi nguyên văn. [Software Baseline](../../04_design/SOFTWARE.md), [Decision Log](../../00_governance/DECISIONS.md) và code hiện hành có thẩm quyền cao hơn khi nội dung cũ xung đột.

## Runtime và service design

- [Programming Unified Product Detailed Design](PROGRAMMING_UNIFIED_PRODUCT_DETAILED_DESIGN.md) — **Active 2026-08-20**; authority mục tiêu cho đa Program, POU, Control Library, Published Signal, lifecycle, scheduler, output safety, FE/BE/Core và release verification
- [Modbus RTU Point detailed design](DDC24_MODBUS_RTU_POINT_DETAILED_DESIGN.md) — **In Review 2026-08-03**; proposal production trước Programming, supersede các mô tả RTU Point recovered nếu được phê duyệt
- [Modbus RTU data model](MODBUS_RTU_DATA_MODEL.md) — **In Review 2026-08-04**; mô hình canonical Bus/Device/Point, là nguồn chân lý duy nhất cho FE/BE/FW-SOM
- [Modbus RTU FE design](MODBUS_RTU_FE_DESIGN.md) — **In Review 2026-08-04**
- [Modbus RTU BE design](MODBUS_RTU_BE_DESIGN.md) — **In Review 2026-08-04**
- [Modbus RTU FW-SOM design](MODBUS_RTU_FW_SOM_DESIGN.md) — **In Review 2026-08-04**
- [Software detailed design](SW_DDD_MK-DDC-24_VI.md)
- [Runtime execution model](SW_RUNTIME_EXECUTION_MODEL_MK-DDC-24_VI.md)
- [Component library](SW_COMPONENT_LIBRARY_MK-DDC-24_VI.md)
- [I/O driver design](SW_IODRIVER_DESIGN_MK-DDC-24_VI.md)
- [BACnet design](SW_BACNET_DESIGN_MK-DDC-24_VI.md)
- [Fieldbus design](SW_FIELDBUS_DESIGN_MK-DDC-24_VI.md)
- [HMI design](SW_HMI_DESIGN_MK-DDC-24_VI.md) — ADR-016 five-surface limited-operator HMI; host implementation complete, target acceptance pending
- [Security/keystore design](SW_SECURITY_KEYSTORE_MK-DDC-24_VI.md)
- [Coding standard](SW_CODING_STANDARD_MK-DDC-24_VI.md)

## Legacy/deferred design

- [Cloud agent design](SW_AGENT_DESIGN_MK-DDC-24_VI.md)
- [OTA design](SW_OTA_DESIGN_MK-DDC-24_VI.md)

Cloud agent và OTA được giữ để bảo toàn roadmap design nhưng không thuộc baseline Rev A.0.
