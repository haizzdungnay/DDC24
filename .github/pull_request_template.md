<!-- Mô tả ngắn thay đổi và cách xác minh. -->

## Tóm tắt


## Verification


## Checklist

Nguồn chuẩn: [Document Control](../docs/00_governance/CONTROL.md), [Decision Log](../docs/00_governance/DECISIONS.md), [Product Baseline](../docs/01_product/PRODUCT.md).

- [ ] Phạm vi vẫn là BMS Edge Automation Controller, không HVAC-only hoặc IEC 61131-3 PLC.
- [ ] Base SKU vẫn là 16 UI + 4 AO + 4 DO; optional DI được ghi rõ là option.
- [ ] Runtime dùng ba core service; HMI chỉ là service feature-gated.
- [ ] Không đưa MQTT/cloud, OTA A/B, wiresheet, BACnet MS/TP hoặc BTL claim vào Rev A.0.
- [ ] Nếu đổi requirement/interface: đã cập nhật test và [Traceability](../docs/07_records/TRACEABILITY.md).
- [ ] Nếu đổi code/config/deploy/docs: đã cập nhật `CHANGELOG.md` dưới `[Unreleased]`.
- [ ] Không tạo Markdown phân tán nếu controlled dossier đã có tài liệu chủ quản.
- [ ] Link nội bộ, build/test liên quan và release gate đã được kiểm tra.
