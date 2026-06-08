# BMS Edge Strategy — MK-DDC-24

> **Document ID:** KX-DDC24-PM-STRATEGY-001
> **Phiên bản:** 1.0 | 2026-06-08 · **Trạng thái:** Active · **Owner:** Product Owner / PMO
> 📘 **Đọc cùng:** [PRODUCT_DEFINITION](PRODUCT_DEFINITION_MK-DDC-24_VI.md) ·
> [REVA_SCOPE_ROADMAP](REVA_SCOPE_ROADMAP_MK-DDC-24_VI.md) ·
> Quyết định nền: [ADR-008](../adr/ADR-008-bms-edge-positioning-and-revA-component-set.md)

> 🎯 Đây là tài liệu **chiến lược sản phẩm** (định vị, khác biệt, câu chuyện cạnh tranh) cho
> sales / kỹ thuật / PM / dev — **không phải spec kỹ thuật**. Chi tiết kỹ thuật & scope:
> theo Product Definition + REVA_SCOPE (nguồn-chuẩn). Khi mâu thuẫn → theo nguồn-chuẩn đó.

---

## 1. Positioning

MK-DDC-24 là **Component-Based BMS Edge Automation Controller**.

Nó cạnh tranh **không** như một DDC HVAC thuần, mà như một **edge node linh hoạt** cho công
trình / nhà máy nhẹ:

- local control (điều khiển biên, chạy độc lập khi mất BMS)
- field IO (24 IO onboard + mở rộng Modbus)
- protocol integration (Modbus RTU/TCP ↔ BACnet/IP)
- commissioning (test point + export report)
- BMS data exposure (BACnet/IP server)
- facility automation (nhiều hệ, không khóa theo một ngành)

> **HVAC là use-case đầu tiên, không phải giới hạn sản phẩm.**

## 2. Differentiation

MK-DDC-24 khác biệt bởi:

1. **Component-based configuration** — không khóa theo template thiết bị một ngành.
2. **Local-first runtime** — logic vẫn chạy khi mất BMS / mất cloud.
3. **Controller + Gateway dual role** — vừa điều khiển vừa bridge Modbus↔BACnet.
4. **Web commissioning** — cấu hình bằng form/JSON, không cần PLC IDE nặng.
5. **Open project schema** — artifact deploy là `graph.json` đọc được, version được.
6. **Vietnamese engineering fit** — đấu nối nhanh, dễ dùng cho kỹ sư VN, commissioning bản địa.
7. **Competitive pricing** — rẻ và linh hoạt hơn controller nhập khẩu.

## 3. Target Applications

HVAC · Pump/Water · Lighting · Energy · Environment monitoring · Alarm/Interlock ·
Modbus/BACnet gateway · Data acquisition.

(Chi tiết domain & ví dụ: [PRODUCT_DEFINITION §3](PRODUCT_DEFINITION_MK-DDC-24_VI.md).
Ví dụ chạy được: `examples/{hvac-mini, pump-water, energy-gateway}`.)

## 4. Competitive Statement

- **Nhanh hơn PLC** cho các job BMS (không cần IDE FBD/ST nặng).
- **Linh hoạt hơn DDC truyền thống** (component-based, không khóa template).
- **Tin cậy hơn IoT phụ thuộc cloud** (local-first, chạy khi mất kết nối).
- **Rẻ & thích nghi tốt hơn controller nhập khẩu.**

Tổng hợp một câu:

> **MK-DDC-24 = Controller + Gateway + Commissioning Tool + Local-first BMS Edge Node.**

---

**Tài liệu liên quan:** [PRODUCT_DEFINITION](PRODUCT_DEFINITION_MK-DDC-24_VI.md) ·
[REVA_SCOPE_ROADMAP](REVA_SCOPE_ROADMAP_MK-DDC-24_VI.md) ·
[SW_COMPONENT_LIBRARY](../02_design/software/SW_COMPONENT_LIBRARY_MK-DDC-24_VI.md)
