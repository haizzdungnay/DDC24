# Firmware Design Baseline

**ID:** FW-DES-001
**Trạng thái:** Target design — protocol/runtime baseline có source; BSP/HIL còn mở
**Cập nhật:** 2026-09-30 (FW MCU chuyển cho team riêng; ràng buộc qua yêu cầu + ICD)

Firmware STM32G0B1 sở hữu real-time I/O, ADC sampling, AO/DO actuation, Kinexus-IOP framing và independent safe timeout. Linux/SOM không truy cập trực tiếp ADS131M08; STM32 là SPI master duy nhất.

> **Implementation reality 2026-08-03:** `firmware/stm32/src/iop` và
> `firmware/stm32/src/app/ddc24_runtime.*` có parser/CRC, input sampling/output callback,
> startup safe-state, communication watchdog 200 ms và fault diagnostics;
> `firmware/stm32/Core/Src/main.c` nối runtime qua weak HAL boundary. Host test và
> Cortex-M0+ cross-build pass. `firmware/stm32/mkddc-fw.ioc` vẫn chưa định nghĩa
> pin/peripheral production, weak HAL chưa bind STM32 BSP và chưa có physical
> HIL. Vì vậy source baseline này không phải bằng chứng ADC/DAC/relay/UART thật
> đã implemented hoặc safe/release-ready.

## Ranh giới với team MCU (từ 2026-09-30)

Firmware STM32 do **một team riêng** thiết kế và thực hiện. Dự án không áp đặt thiết kế bên trong firmware. Ràng buộc với team đó chỉ gồm:

- [Yêu cầu FW MCU `FW-REQ-MK-DDC-24-VI` v3.1](../01_specs/FW_REQUIREMENTS_MK-DDC-24_VI.md): yêu cầu hộp đen và cổng nghiệm thu G-MCU-1..3;
- [ICD SOM ↔ MCU `IOP-SPEC-MK-DDC-24-VI` v3.0](../01_specs/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md): frame, lệnh, trạng thái, thời gian, lỗi, phiên bản, bài kiểm tích hợp (IOP v3.0);
- [Header v3 nháp](../01_specs/iop_protocol_v3_DRAFT.h) để hai team review byte; HW spec của **từng biến thể** do HW cung cấp riêng. `contracts/iop/iop_protocol.h` v2.0 vẫn thuộc runtime hiện tại, chưa là header giao team MCU để làm v3.

Cả hai tài liệu đang **Draft về chi tiết, chờ hai team ký**. Các tài liệu thiết kế firmware trong `02_design/firmware/`, FW_ARCH_SPEC và guide 04 là tham khảo. [ADR-064](../adr/ADR-064-iop-v3-hai-bien-the.md) đã chốt **V3.0 duy nhất** cho cả 16/4/4 và 16/8/8; V2.x không là lựa chọn tích hợp. Chưa có hồ sơ HW chuẩn hoặc HIL cho 8/8.

## Source/runtime di sản chưa chuyển V3.0 (V2.0)

- Kinexus-IOP v2: UART 921600 baud, `GET_IO` 2 ms/500 Hz, response timeout 3 ms, fault threshold 20 ms.
- `IO_RESP`: payload 74 bytes, frame 80 bytes; capability Rev A `0x000D` cho 16 UI + 4 AO + 4 DO.
- MCU đưa output về safe behavior nếu không nhận poll hợp lệ trong 200 ms.
- UI sampling dùng hai ADS131M08; AO dùng DAC8554; DO dùng relay outputs.
- Base SKU không có 8 industrial DI; true isolated DI là option riêng.

Contract thực thi nằm trong `contracts/iop/iop_protocol.h`; layout và hằng số trong tài liệu chi tiết phải được đối chiếu với header này trước khi dùng để implement hoặc release.

## Khoảng trống bắt buộc trước integration

- Tạo CubeMX/pinout thật khớp schematic đã review.
- Bind IOP UART runtime vào STM32 BSP/pin/peripheral thật và kiểm handshake/capability trên target.
- Implement/bind hai ADS131M08, UI mode latch, DAC8554, relay drive/feedback và diagnostics vào HAL production.
- Xác nhận watchdog + 200 ms communication safe timeout bằng target-side fault injection và đo output vật lý.
- Ghi toolchain, image hash, target revision và HIL logs vào release record.

## Tài liệu chi tiết

- [Firmware design index](../02_design/firmware/README.md)
- [Firmware architecture specification](../01_specs/FW_ARCH_SPEC_MK-DDC-24_VI.md)
- [Firmware requirements source](../01_specs/FW_REQUIREMENTS_MK-DDC-24_VI.md)
- [Shared SOM/MCU interface specification](../01_specs/SWFW_INTERFACE_SPEC_MK-DDC-24_VI.md)

Các nội dung bootloader OTA và secure boot được phục hồi để không mất thiết kế nhưng không thuộc baseline production Rev A.0 nếu chưa có decision, implementation và verification evidence.
