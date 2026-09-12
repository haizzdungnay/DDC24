<!-- Mô tả ngắn thay đổi và cách xác minh. -->
<!--
Quy trình: WF-CLEAN-001 — docs/00_governance/CLEAN_CODE_WORKFLOW.md
Job `workflow-guard` CHẶN MERGE nếu thiếu `Closes #N`, thiếu `Implementer-Run`,
hoặc `Implementer-Run` trùng `Manager-Run` của Issue (nguyên tắc N1).
-->

## Truy xuất

Closes #<số Issue>

- **Implementer-Run:** <URL phiên agent hoặc implementer-YYYYMMDDThhmmZ>
- **Loại việc:** `wf:clean-code` | `wf:clean-docs` | `wf:test-debt` | `wf:tooling`

## Tóm tắt

<!-- Triệu chứng → nguyên nhân gốc → cách sửa. Viết đủ để người đọc sau này hiểu VÌ SAO. -->

## Verification

<!--
Số đo THẬT của phiên này. Không dẫn lại số cũ.
Ghi rõ lớp bằng chứng: HOST unit / MOCK browser / REAL-BACKEND host / TARGET board / HIL.
Cổng chưa chạy ghi NOT_RUN kèm lý do — KHÔNG ghi PASS.
-->

| Cổng | Lệnh | Kết quả |
|---|---|---|
| C++ (Modbus+BACnet+HMI) | `cmake --fresh -S . -B build/fw ... && ctest --test-dir build/fw` | |
| Go | `(cd apps/web-api && go vet ./... && go test ./... -count=1)` | |
| FE | `(cd apps/web-ui && npx vitest --run --environment jsdom src && npm run lint && npm run build)` | |
| Docs | `python3 scripts/docs_iso_harness.py --expect` | |

## Đối chiếu acceptance criteria của Issue

<!-- Sao chép từng AC của Issue và dẫn bằng chứng tương ứng (tên test, số đo, đường dẫn evidence). -->

- [ ] AC-1 → bằng chứng:
- [ ] AC-2 → bằng chứng:

## Checklist

Nguồn chuẩn: [Clean Code Workflow](../docs/00_governance/CLEAN_CODE_WORKFLOW.md), [Document Control](../docs/00_governance/CONTROL.md), [Decision Log](../docs/00_governance/DECISIONS.md), [Product Baseline](../docs/01_product/PRODUCT.md).

- [ ] PR này phục vụ **đúng một** Issue, và không chạm file ngoài "Source ownership" của Issue đó.
- [ ] Với `wf:clean-code`: không đổi contract/API/schema/hành vi.
- [ ] Không skip/disable/quarantine test để lấy màu xanh.
- [ ] Không nâng evidence HOST/MOCK thành TARGET/HIL/release.
- [ ] Phạm vi vẫn là BMS Edge Automation Controller, không HVAC-only hoặc IEC 61131-3 PLC.
- [ ] Base SKU vẫn là 16 UI + 4 AO + 4 DO; optional DI được ghi rõ là option.
- [ ] Runtime dùng ba core service; HMI chỉ là service feature-gated.
- [ ] Không đưa MQTT/cloud, OTA A/B, wiresheet, BACnet MS/TP hoặc BTL claim vào Rev A.0.
- [ ] Nếu đổi requirement/interface: đã cập nhật test và [Traceability](../docs/07_records/TRACEABILITY.md).
- [ ] Nếu đổi code/config/deploy/docs: đã cập nhật `CHANGELOG.md` dưới `[Unreleased]`.
- [ ] Không tạo Markdown phân tán nếu controlled dossier đã có tài liệu chủ quản.
- [ ] Link nội bộ, build/test liên quan và release gate đã được kiểm tra.

---

<!-- Vùng dưới đây do vai Reviewer điền. Implementer KHÔNG được tự điền hoặc tự gắn nhãn review:pass. -->

## Reviewer verdict

<!--
Reviewer post verdict thành MỘT COMMENT trên PR (không sửa phần này), theo mẫu:

[REVIEW-VERDICT: PASS]
Reviewer-Run: reviewer-YYYYMMDDThhmmZ
- AC-1: PASS — bằng chứng ...
- Phạm vi: PASS — không có file ngoài Source ownership
- Regression: PASS — <số đo>

hoặc

[REVIEW-VERDICT: FAIL]
Reviewer-Run: reviewer-YYYYMMDDThhmmZ
Phải sửa:
1. ...
-->
