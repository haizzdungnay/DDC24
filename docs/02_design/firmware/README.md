# Firmware Detailed Design Index

**ID:** FW-DES-INDEX-001
**Trạng thái:** In Review — recovered 2026-07-22

> ⚠️ **Tham khảo, không ràng buộc team MCU (2026-09-30).** Firmware MCU do một team riêng thiết kế và thực hiện. Ràng buộc với team đó chỉ gồm [Yêu cầu FW MCU `FW-REQ-MK-DDC-24-VI` v3.1](../../01_specs/FW_REQUIREMENTS_MK-DDC-24_VI.md) và [ICD SOM ↔ MCU `IOP-SPEC-MK-DDC-24-VI` v3.0](../../01_specs/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md) (cả hai đang Draft, chờ ký). Nội dung dưới đây là ý đồ thiết kế cũ của dự án; khi khác hai tài liệu trên thì hai tài liệu đó thắng.

Tài liệu trong thư mục này được phục hồi nguyên văn. [Firmware Baseline](../../04_design/FIRMWARE.md), `shared/iop_protocol.h` và firmware implementation hiện hành có thẩm quyền cao hơn khi có xung đột.

## Current-path design cần đối chiếu

- [Firmware detailed design](FW_DDD_MK-DDC-24_VI.md)
- [Coding standard](FW_CODING_STANDARD_MK-DDC-24_VI.md)
- [I/O sampling module](FW_MOD_IO_SAMPLE_MK-DDC-24_VI.md)
- [AO/DO module](FW_MOD_AO_DO_MK-DDC-24_VI.md)
- [IOP communication module](FW_MOD_IOP_COMM_MK-DDC-24_VI.md)
- [Diagnostics and watchdog](FW_MOD_DIAG_WDG_MK-DDC-24_VI.md)
- [MCU pinout master](FW_PINOUT_MASTER_MK-DDC-24_VI.md)

## Deferred hoặc chưa có release evidence

- [Bootloader/OTA design](FW_BOOTLOADER_OTA_MK-DDC-24_VI.md)
- [MCU secure boot design](FW_MCU_SECURE_BOOT_MK-DDC-24_VI.md)

Hai tài liệu deferred được giữ để bảo toàn thiết kế, nhưng không được dùng để tuyên bố OTA/secure-boot production capability của Rev A.0.
