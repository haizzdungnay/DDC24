# Manifest baseline Programming thống nhất — 2026-08-20

| Thuộc tính | Giá trị |
|---|---|
| ID | `PROG-UNIFIED-BASELINE-MANIFEST-2026-08-20` |
| Phiên bản | 1.1 |
| Trạng thái | Active |
| Chủ quản | Document Control |
| Source baseline trước thay đổi | `49a2ad14c2a8081a494a288f510cd356dab7ee86` |
| Authority | `AUTH-PROG-2026-08-20-04`, ADR-050 |
| Kiểm tra | `python3 scripts/candidate_pin_check.py` |

## 1. Phạm vi và quy tắc

Manifest ghim đúng authority set dùng để bắt đầu Plan59. SHA-256 là hash nội dung
file trong change-set Product thống nhất; cột cuối ghi source baseline được dùng
để lập và review, không tuyên bố file đã tồn tại ở commit đó. Sau khi một file
trong bảng đổi, cùng change-set phải cập nhật manifest, chạy lại pin check, đánh
giá impact SRS/DDD/VVP/Trace/Risk/Plan và ghi Changelog.

Manifest không ghim source code sản phẩm, generated contract hoặc Test Result.
Các artifact đó có manifest/golden/provenance riêng trong task Plan59. Pin PASS
chỉ chứng minh reviewer đang đọc đúng revision tài liệu, không chứng minh code,
target, HIL hoặc release.

## 2. Manifest authority baseline

| # | Đường dẫn | SHA-256 nội dung | Source baseline |
|---:|---|---|---|
| 1 | `docs/00_governance/CONTROL.md` | `db0cdab58fad4f25e50878d18c85c67794ad14624b9c97bcac9098b8113fcfab` | `49a2ad14c2a8081a494a288f510cd356dab7ee86` |
| 2 | `docs/00_governance/DECISIONS.md` | `f5f0240bed05d7fa306e9c62e4fa3e7d44b5f87ae20c002384f31bdd2c1bf722` | `49a2ad14c2a8081a494a288f510cd356dab7ee86` |
| 3 | `docs/00_governance/PROGRAMMING_OPEN_DECISIONS.md` | `21c37d6cdf266d318f9fda969c208708354572fb98af657ed9a7990a3a78135a` | `49a2ad14c2a8081a494a288f510cd356dab7ee86` |
| 4 | `docs/00_governance/PROGRAMMING_DOCUMENT_READINESS_MATRIX.md` | `1094b0e7ebea3d1b1f4599bd9257123588712102d76d13f92ad944b81167e71f` | `49a2ad14c2a8081a494a288f510cd356dab7ee86` |
| 5 | `docs/01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md` | `14de631caed70f20d47a4d11825a5ec1f8bc9a25135f9020e13f2cb655355c3e` | `49a2ad14c2a8081a494a288f510cd356dab7ee86` |
| 6 | `docs/02_design/PROGRAMMING_DESIGN_INDEX.md` | `0389839909b497b5c180074c88405bcbbc154a678a3a2566d7aa98a8fa14240e` | `49a2ad14c2a8081a494a288f510cd356dab7ee86` |
| 7 | `docs/02_requirements/PROGRAMMING_REQUIREMENTS_SPEC.md` | `ec57e4b0a9f855977ecd7743faea2152f518d1f7330a683fd1e8606a9eafd97a` | `49a2ad14c2a8081a494a288f510cd356dab7ee86` |
| 8 | `docs/03_architecture/PROGRAMMING_ARCHITECTURE.md` | `08821231afc68cb1badc773b2d4ced17a9e5363562285f4d5f98cb90a7ebcb19` | `49a2ad14c2a8081a494a288f510cd356dab7ee86` |
| 9 | `docs/02_design/software/PROGRAMMING_UNIFIED_PRODUCT_DETAILED_DESIGN.md` | `4ec888bbdcd3e216eab62126f3b6145faf19993ba2c1bd07e00ce011e3224a9e` | `49a2ad14c2a8081a494a288f510cd356dab7ee86` |
| 10 | `docs/02_design/software/PROGRAMMING_LANGUAGE_COMPILER_DESIGN.md` | `d4992caf7d85275558de9c3e0553c31cbf686a28ddb61082a998edea666fec6d` | `49a2ad14c2a8081a494a288f510cd356dab7ee86` |
| 11 | `docs/04_uiux/PROGRAMMING_UI_UX_DESIGN.md` | `716344cd9d21e3b32765cc1126418a0013518e86bdf3460f7ed8713d443d2a62` | `49a2ad14c2a8081a494a288f510cd356dab7ee86` |
| 12 | `docs/05_verification/PROGRAMMING_VERIFICATION_PLAN.md` | `2d26255dda3f9431c79a2553e11f37de5641f04d377a8de0075af3a9cb672968` | `49a2ad14c2a8081a494a288f510cd356dab7ee86` |
| 13 | `docs/07_records/PROGRAMMING_RISK_REGISTER.md` | `ce09fb015cc1f11a29bca4342feeda33868271d3db6de1379e2d7d0e113efbae` | `a64ebb54bdba026cd07984215eb0da5a642cc673` |
| 14 | `docs/07_records/PROGRAMMING_TRACEABILITY_MATRIX.md` | `ce9b1addfb583e3c0e75d8f07d9db6b838b17be64014c26eb98753077ff4228a` | `a64ebb54bdba026cd07984215eb0da5a642cc673` |
| 15 | `docs/03_implementation/59_PROGRAMMING_DOC_TO_CODE_IMPLEMENTATION_PLAN.md` | `4db79cf202105b649d273b31384d6fb6d850977fa49e08a4c06c81bcc83701ba` | `a64ebb54bdba026cd07984215eb0da5a642cc673` |
| 16 | `docs/03_implementation/PROMPT_PLAN59_AUTONOMOUS_EXECUTION.md` | `8dd7bd227861ded3a1da3478aec522826dc60716280bdd40b79fa23f7f1ef29a` | `49a2ad14c2a8081a494a288f510cd356dab7ee86` |

## 3. Disposition baseline cũ

Manifest P0 ngày 2026-08-10, Plan53/54/56 và tracker WP giữ nguyên trong Git để
truy nguyên. Chúng không nằm trong mẫu số pin hiện hành và không được dùng để
hạ Product Target hoặc mở release gate. Candidate Product Hybrid và task G1 rời
đã được hợp nhất rồi loại khỏi cây Markdown; phục hồi được từ lịch sử Git.

## 4. Kết quả phát hành manifest

| Kiểm tra | Kết quả |
|---|---|
| Số authority file | 16 |
| Thiếu file | 0 |
| Hash drift tại thời điểm ghim | 0 |
| Open Decision implementation | 0 |
| Release evidence | Chưa đánh giá; theo Plan59 W7 |

## 5. Nhịp re-pin của Plan59

Dòng 15 là **tracker đang chạy**, không phải hồ sơ đóng băng: Plan59 §7 buộc cập
nhật bảng §3 sau mỗi task. Vì vậy hash dòng 15 sẽ đổi nhiều lần trong vòng đời
manifest này, và mỗi change-set sửa Plan59 phải re-pin dòng 15 ngay trong cùng
change-set theo §1. Hash 15 dòng còn lại chỉ đổi khi authority thật sự đổi; nếu
một trong 15 dòng đó drift thì phải đánh giá impact SRS/DDD/VVP/Trace/Risk trước
khi re-pin, không được re-pin phản xạ.

Re-pin dòng 15 **không** nâng bất kỳ trạng thái nào của Product và không phải
evidence release.

## 6. Lịch sử

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-08-20 | Phát hành manifest baseline 16 hồ sơ tại `49a2ad1`. |
| 1.1 | 2026-08-20 | Re-pin dòng 13/14/15 sau `T59-001`. **Đánh giá impact trước khi re-pin:** dòng 15 là status W0 + ghi chú thực thi §3.1; dòng 13 thêm treatment record §5.16 và lịch sử 2.0, **không** đổi S×L, không đổi lifecycle, không thêm residual accepted (16/16 Open, 11 Critical giữ nguyên); dòng 14 chỉ nối evidence vào ô `BE-110`, cột `D/I/T/P/R` giữ `Y/Y/N/N/N`. Không phát sinh thay đổi SRS/DDD/VVP nên 13 dòng authority còn lại không đổi. Thêm §5 nêu rõ nhịp re-pin của tracker. |
