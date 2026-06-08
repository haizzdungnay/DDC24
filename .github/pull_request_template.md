<!-- Mô tả ngắn thay đổi. Với PR tài liệu, đối chiếu checklist dưới. -->

## Tóm tắt


## Documentation PR Checklist
> Nguồn-chuẩn: [docs/CANONICAL_DECISIONS.md](../docs/CANONICAL_DECISIONS.md) · [PRODUCT_DEFINITION](../docs/01_specs/PRODUCT_DEFINITION_MK-DDC-24_VI.md)

- [ ] Không dùng lại thuật ngữ legacy nếu chưa đánh dấu **Superseded/Legacy**
- [ ] Không mô tả DDC-24 là **HVAC-only** (sản phẩm là **BMS Edge Automation Controller**; HVAC là use-case đầu)
- [ ] Không mô tả Rev A là **IEC 61131-3 PLC**
- [ ] Không nhắc **Web IDE FBD/ST** như scope Rev A
- [ ] Không đưa **HMI / OTA / MQTT / cloud** vào Rev A.0
- [ ] Nếu nhắc **BACnet BTL** → phải ghi rõ **sau Rev A.0** (Rev A chỉ interop)
- [ ] Mọi service runtime dùng tên **`mkddc-core` / `mkddc-iobus` / `mkddc-web`**
- [ ] Nếu sửa requirement → đã cập nhật **Traceability Matrix** (cột Rev A.0/B/C)
- [ ] Nếu thêm/đổi tài liệu → đã cập nhật **Master Register**
- [ ] Link tương đối không gãy (chạy broken-link check)
- [ ] Nếu có mâu thuẫn → **Product Definition + Canonical Decisions thắng**
