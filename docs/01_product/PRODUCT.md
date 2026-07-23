# Product Baseline

**ID:** PROD-BASE-001
**Trạng thái:** Active
**Cập nhật:** 2026-07-23 (ADR-020: Runtime đổi từ "chỉ component graph" sang "Mekong-owned Program Runtime, IEC 61131-3-aligned ST+FBD"; xem dòng Runtime và mục Ngoài phạm vi)

## Định vị

MK-DDC-24 là BMS Edge Automation Controller với Program Runtime do Mekong sở hữu (IEC 61131-3-aligned, ST + FBD theo ADR-020), hoạt động local-first trên Debian Linux. Thiết bị thực thi logic điều khiển tại chỗ, tích hợp I/O và giao thức BMS, đồng thời cung cấp Web UI và HMI cục bộ tùy chọn. HVAC là use case đầu tiên, không giới hạn định vị sản phẩm. Không dùng nhãn "certified"/"compliant" cho tới khi có evidence theo release gate riêng.

## Baseline Rev A.0

| Khối | Baseline |
|---|---|
| Compute | Radxa CM3/RK3566 SOM + STM32G0B1 MCU |
| I/O | 16 UI, 4 AO, 4 relay DO |
| UI modes | 0–10 V, 4–20 mA, NTC 10k/20k/configurable, auxiliary dry contact |
| AO | 4 kênh qua DAC8554, command vật lý V/mA |
| Network | Ethernet; BACnet/IP; Modbus TCP; 2 × Modbus RTU |
| Runtime | Mekong-owned Program Runtime, IEC 61131-3-aligned, ngôn ngữ ST + FBD (ADR-020); priority và safe-state. Component graph 28 loại node cũ giữ vai trò legacy importer/nguồn vendor FB, không phải engine chính. |
| Configuration | REST API + React Web UI, form/JSON |
| Local display | HMI LVGL/DRM feature-gated, MIPI DSI + FT5436 touch + 6 nút GPIO; limited operator HMI theo ADR-016 |

## Trong phạm vi

- điều khiển độc lập khi mất client hoặc cloud;
- commissioning, point monitoring, alarm, trend, schedule và user management qua web;
- I/O scan qua Kinexus-IOP và shared-memory contracts;
- protocol integration và safe output behavior;
- HMI cục bộ khi SKU/build bật tính năng: xem trạng thái/I/O/alarm/service, vận hành giới hạn các point được whitelist qua authority/core và phục hồi/cấu hình Ethernet IPv4 cơ bản bằng Service role theo ADR-017.

## Ngoài phạm vi Rev A.0

- LD, SFC, online change, PLCopen/IEC certification claim ("certified"/"compliant") và drag-drop wiresheet canvas (ADR-020 giới hạn Rev A.0 còn lại ST + FBD, build+atomic activation, không claim certification);
- MQTT/cloud agent và OTA A/B production workflow;
- BACnet MS/TP, Modbus slave và BTL certification;
- true isolated DI trong base SKU;
- full Web HMI/SCADA, engineering graph, schedule editor, alarm configuration, user administration, Wi-Fi credential, routing/VLAN/firewall hoặc cấu hình protocol trên màn local 2.4 inch;
- mọi claim EMC/safety/manufacturing chưa có evidence trong release gate.

Roadmap không phải cam kết release. Thêm capability chỉ hợp lệ khi có decision, requirement, thiết kế, verification và cập nhật traceability.
