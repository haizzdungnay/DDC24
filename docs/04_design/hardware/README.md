# Hardware Detailed Design Index

**ID:** HW-DES-INDEX-001
**Trạng thái:** In Review / NO-GO — reconciled 2026-07-22

Đây là corpus thiết kế phần cứng chi tiết được phục hồi từ archive và đang được
reconcile. [Hardware Design Baseline](../HARDWARE.md), shared headers và tested SOM
code có thẩm quyền cao hơn khi có xung đột. `IO_DI_CIRCUIT` chỉ là reference cho
optional isolated-DI, không phải base SKU. Mọi mô tả STM32 task/pinout là target cho
đến khi có schematic, `.ioc`, firmware và HIL evidence.

## SOM và carrier

- [Radxa CM3 specification](01_som/SOM_SPEC_RADXA_CM3.md)
- [Carrier block diagram](02_carrier_board/CB_BLOCK_DIAGRAM.md)
- [Carrier schematic notes](02_carrier_board/CB_SCHEMATIC_NOTES.md)
- [Grounding scheme](02_carrier_board/GROUNDING_SCHEME.md)

## I/O subsystem

- [Universal Input circuit](03_io_subsystem/IO_UI_CIRCUIT.md)
- [Analog Output circuit](03_io_subsystem/IO_AO_CIRCUIT.md)
- [Digital Output relay](03_io_subsystem/IO_DO_RELAY.md)
- [RS-485 circuit](03_io_subsystem/IO_RS485_CIRCUIT.md)
- [Optional isolated DI reference](03_io_subsystem/IO_DI_CIRCUIT.md)
- [DI-to-UI design change](REWORK_DI_TO_UI.md)

## Power, MCU và component data

- [Power design](04_power_supply/PWR_DESIGN.md)
- [STM32G0 specification](05_mcu_io/MCU_STM32G0_SPEC.md)
- [ADC sampling](05_mcu_io/FW-ADC-SAMPLING.md)
- [IOP protocol design](05_mcu_io/IOP_PROTOCOL.md)
- [16-channel UI BOM](06_bom/BOM-UI-16CH.md)
- [Product BOM](06_bom/BOM_MK-DDC-24_v1.md)

## Physical implementation và release preparation

- [EMC and thermal notes](07_emc_thermal/EMC_THERMAL_NOTES.md)
- [Mechanical enclosure](08_mechanical/MECHANICAL_ENCLOSURE.md)
- [UI hardware test](09_hw_bringup/HW-TEST-UI-16CH.md)
- [Hardware bring-up procedure](09_hw_bringup/HW_BRINGUP_TEST_PROCEDURE.md)
- [Manufacturing data package](10_manufacturing/MFG_DATA_PACKAGE.md)
- [PCB placement guide](kicad/PCB_PLACEMENT_GUIDE.md)

Review logs, findings, risks và closure records được tách sang [hardware review records](../../07_records/reviews/hardware/README.md). Hardware release vẫn `RED/NO-GO` cho đến khi các evidence gate trong [Verification](../../05_verification/VERIFICATION.md) được đóng.

Review đồng bộ HW/FW/SOM/HMI ngày 2026-07-22 nằm tại
[HW/FW/SOM/HMI review report](../../07_records/reviews/KX-DDC24-HW-FW-SOM-HMI-REVIEW-2026-07-22.md).
