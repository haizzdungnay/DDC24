# Product Baseline

**ID:** PROD-BASE-001
**Trạng thái:** Active
**Cập nhật:** 2026-08-04 (đăng ký Product Requirement Modbus RTU và ghi nhận xung đột số bus RS485)

## Định vị

MK-DDC-24 là BMS Edge Automation Controller hoạt động local-first trên Debian
Linux. Baseline sản phẩm cam kết một Programming capability do Mekong sở hữu
theo [Product Spec Programming Rev A](DDC24_PROGRAMMING_PRODUCT_SPEC.md), nhưng
cam kết này không phải tuyên bố source hiện tại đã implement Program Runtime.
Thiết bị tích hợp I/O và giao thức BMS, đồng thời cung cấp Web UI và HMI cục bộ
tùy chọn. HVAC là use case đầu tiên, không giới hạn định vị sản phẩm. Không dùng
nhãn `certified`/`compliant` cho tới khi có evidence theo release gate riêng.

## Baseline Rev A.0

| Khối | Baseline |
|---|---|
| Compute | Radxa CM3/RK3566 SOM + STM32G0B1 MCU |
| I/O | 16 UI, 4 AO, 4 relay DO |
| UI modes | 0–10 V, 4–20 mA, NTC 10k/20k/configurable, auxiliary dry contact |
| AO | 4 kênh qua DAC8554, command vật lý V/mA |
| Network | Ethernet; BACnet/IP; Modbus TCP; 2 × Modbus RTU — **xung đột chưa đóng**, xem §Modbus RTU bên dưới |
| Programming | Product scope Rev A chỉ gồm Local Physical I/O, Virtual Point, Modbus RTU Point, ST, FBD và cycle time 1 s/5 s/30 s. Revision/Deployment/Activation/Rollback, RETAIN và Online Monitor tuân theo `PROD-PROG-001`. Trạng thái implementation: chưa được xác nhận. |
| Runtime As-Built | Component graph 28 loại node là hiện trạng legacy. Quan hệ migration sang Programming chưa được quyết định; không gọi graph này là FBD và không dùng nó làm bằng chứng Programming. |
| Configuration | REST API + React Web UI, form/JSON |
| Local display | HMI LVGL/DRM feature-gated, MIPI DSI + FT5436 touch + 6 nút GPIO; limited operator HMI theo ADR-016 |

## Trong phạm vi

- điều khiển độc lập khi mất client hoặc cloud;
- commissioning, point monitoring, alarm, trend, schedule và user management qua web;
- I/O scan qua Kinexus-IOP và shared-memory contracts;
- protocol integration và safe output behavior;
- HMI cục bộ khi SKU/build bật tính năng: xem trạng thái/I/O/alarm/service, vận hành giới hạn các point được whitelist qua authority/core; phục hồi/cấu hình Ethernet IPv4 cơ bản nằm trong surface Service nhưng network mutation yêu cầu role Admin theo ADR-017.

## Phạm vi Programming Rev A

- Product Spec chủ quản: [PROD-PROG-001](DDC24_PROGRAMMING_PRODUCT_SPEC.md).
- Point source duy nhất: Local Physical I/O, Virtual Point và Modbus RTU Point.
- Ngôn ngữ duy nhất: ST và FBD.
- Cycle time duy nhất: 1 s, 5 s và 30 s.
- Modbus TCP/BACnet IP trong dòng `Network` là capability giao tiếp toàn sản
  phẩm, không phải Programming Point Rev A.
- Product Spec quy định sản phẩm phải làm gì; requirement quy định nghĩa vụ của
  từng layer; Programming Design chưa được thực hiện; As-Built phải lấy từ
  source/evidence và không được suy ra từ Product Spec.

## Modbus RTU — Product Requirement riêng

Product Requirement, use case và ma trận quyền cho Modbus RTU nằm tại
[PROD-MBRTU-001](MODBUS_RTU_PRODUCT_REQUIREMENTS.md) (`In Review`). Hồ sơ đó phân
rã dòng `Network` ở trên thành capability, product requirement và 18 use case cho
RS485-1/RS485-2, Modbus RTU Device và Modbus RTU Point.

**Xung đột Active chưa đóng:** baseline này ghi `2 × Modbus RTU`, trong khi
[`HW_SPEC_MK-DDC-24_VI`](../01_specs/HW_SPEC_MK-DDC-24_VI.md) §9 và bảng UART chỉ
mô tả **một** đường RS-485 (UART4, một transceiver, một connector A/B/GND, một
switch termination SW8), và source hiện chỉ tạo một Modbus master. Xung đột này
phải được đóng bằng evidence phần cứng hoặc bằng Product decision, không bằng
suy đoán device node. Theo dõi tại `OD-MBRTU-001` trong
[Modbus RTU Open Decisions](../00_governance/MODBUS_RTU_OPEN_DECISIONS.md).

## Ngoài phạm vi Programming Rev A

- Modbus TCP Point và BACnet/IP Point;
- LD, SFC, motion, safety PLC, online change và PLCopen/IEC certification claim
  (`certified`/`compliant`);
- chi tiết Programming Design và Implementation Plan;

## Ngoài phạm vi sản phẩm Rev A khác

- MQTT/cloud agent và OTA A/B production workflow;
- BACnet MS/TP, Modbus slave và BTL certification;
- true isolated DI trong base SKU;
- full Web HMI/SCADA, engineering graph, schedule editor, alarm configuration, user administration, Wi-Fi credential, routing/VLAN/firewall hoặc cấu hình protocol trên màn local 2.4 inch;
- mọi claim EMC/safety/manufacturing chưa có evidence trong release gate.

Roadmap không phải cam kết release. Thêm capability chỉ hợp lệ khi có Product
decision, Product Requirement, System Requirement, Verification Requirement và
cập nhật traceability. Việc có source hoặc host unit test không tự thêm Product
Capability.
