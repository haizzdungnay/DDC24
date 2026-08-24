# Detailed Design Hub

**ID:** DES-HUB-001
**Trạng thái:** In Review — recovered 2026-07-22

Đây là cổng vào tài liệu thiết kế chi tiết. Baseline hiện hành nằm trong `docs/04_design`; các tài liệu phục hồi bên dưới giữ đầy đủ rationale và implementation detail nhưng phải được reconcile trước release.

- [Firmware detailed design](firmware/README.md)
- [Software detailed design](software/README.md)
- [Interface detailed design](interfaces/README.md)
- [Programming Design Index](PROGRAMMING_DESIGN_INDEX.md) — register authority baseline và Target Candidate hiện hành
- [PGM-02 Workspace ST/FBD Detailed Design](software/PROGRAMMING_PGM02_WORKSPACE_DETAILED_DESIGN.md) — M2 Target Candidate; exact pin pending, không có execution authority
- [Rev A IEC 61131-3 corrective design for Program, SOM software and MCU firmware](PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md)
- [Developer getting started](GETTING_STARTED_DEV.md)
- [Detailed-design template](_templates/TEMPLATE_DDD.md)

Authority khi xung đột: shared headers/tested code → [Decision Log](../00_governance/DECISIONS.md) → [Requirements](../02_requirements/REQUIREMENTS.md) → baseline design → detailed design.
