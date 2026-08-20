# Manifest baseline Programming thống nhất — 2026-08-20

| Thuộc tính | Giá trị |
|---|---|
| ID | `PROG-UNIFIED-BASELINE-MANIFEST-2026-08-20` |
| Phiên bản | 1.15 |
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
| 9 | `docs/02_design/software/PROGRAMMING_UNIFIED_PRODUCT_DETAILED_DESIGN.md` | `ba71b52c0af0b1666ad0fd6c586d7fb9b27f5fb24428e9cd7568dc60dd5406c8` | `a64ebb54bdba026cd07984215eb0da5a642cc673` |
| 10 | `docs/02_design/software/PROGRAMMING_LANGUAGE_COMPILER_DESIGN.md` | `d4992caf7d85275558de9c3e0553c31cbf686a28ddb61082a998edea666fec6d` | `49a2ad14c2a8081a494a288f510cd356dab7ee86` |
| 11 | `docs/04_uiux/PROGRAMMING_UI_UX_DESIGN.md` | `716344cd9d21e3b32765cc1126418a0013518e86bdf3460f7ed8713d443d2a62` | `49a2ad14c2a8081a494a288f510cd356dab7ee86` |
| 12 | `docs/05_verification/PROGRAMMING_VERIFICATION_PLAN.md` | `2d26255dda3f9431c79a2553e11f37de5641f04d377a8de0075af3a9cb672968` | `49a2ad14c2a8081a494a288f510cd356dab7ee86` |
| 13 | `docs/07_records/PROGRAMMING_RISK_REGISTER.md` | `eb858de8faa8dfdefe7c4674a176a9c81519c08713c2e1c9b6a02f157c6a9830` | `a64ebb54bdba026cd07984215eb0da5a642cc673` |
| 14 | `docs/07_records/PROGRAMMING_TRACEABILITY_MATRIX.md` | `f7aba5b12f9036e582e6b4828302627a8f47876fff7f75f4a5fecbd2b7bb9fc0` | `a64ebb54bdba026cd07984215eb0da5a642cc673` |
| 15 | `docs/03_implementation/59_PROGRAMMING_DOC_TO_CODE_IMPLEMENTATION_PLAN.md` | `527a5b21e3053a5d26db8e97bb2f2e34af8b4beb24ab4bbf8b922a46c5706d91` | `a64ebb54bdba026cd07984215eb0da5a642cc673` |
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
| 1.2 | 2026-08-20 | Re-pin dòng 9/13/14/15 sau `T59-002`. **Đánh giá impact trước khi re-pin:** dòng 9 (Unified DDD) chỉ đóng ô As-Built của hàng `Profile` §2 — quyết định §0 không đổi, capacity vẫn 32/16, không phát sinh requirement hay scenario mới; dòng 13 thêm treatment record §5.17 và lịch sử 2.1 mà **không** đổi S×L/lifecycle/residual (16/16 Open, 11 Critical giữ nguyên); dòng 14 nối evidence vào `BE-110` và `CORE-102`, cột `D/I/T/P/R` giữ nguyên; dòng 15 là status W0 + ghi chú §3.1. SRS và VVP không đổi. |
| 1.3 | 2026-08-20 | Re-pin dòng 13/14/15 sau `T59-003`. **Đánh giá impact trước khi re-pin:** dòng 13 thêm treatment record §5.18 và lịch sử 2.2, **không** đổi S×L/lifecycle/residual (16/16 Open, 11 Critical giữ nguyên); dòng 14 nối evidence vào `BE-110` và `CORE-101`, cột `D/I/T/P/R` giữ nguyên; dòng 15 là status W0, ghi chú §3.1 và **đính chính số đo `npm run build` của `T59-002`** vốn báo PASS sai. Unified DDD, SRS và VVP không đổi. |
| 1.4 | 2026-08-20 | Re-pin dòng 13/14/15 sau `T59-004`. **Đánh giá impact trước khi re-pin:** dòng 13 thêm §5.19 và lịch sử 2.3, không đổi S×L/lifecycle/residual; dòng 14 nối evidence vào `BE-110`, `D/I/T/P/R` giữ nguyên; dòng 15 là status W0 và ghi chú §3.1. IFSPEC không nằm trong mẫu số pin. Unified DDD, SRS và VVP không đổi. |
| 1.5 | 2026-08-20 | Re-pin dòng 13/14/15 sau `T59-005`. **Đánh giá impact:** dòng 13 thêm §5.20 và lịch sử 2.4, không đổi S×L/lifecycle/residual; dòng 14 nối evidence vào `BE-106`, `D/I/T/P/R` giữ nguyên; dòng 15 là status W0 + ghi chú §3.1. Unified DDD, SRS và VVP không đổi. |
| 1.6 | 2026-08-20 | Re-pin dòng 13/14/15 sau `T59-006`. **Đánh giá impact:** dòng 13 thêm §5.21 và lịch sử 2.5, không đổi S×L/lifecycle/residual; dòng 14 nối evidence vào `BE-110`; dòng 15 là status W0, ghi chú §3.1 và **đính chính bộ mã lỗi của `T59-004`** cho khớp DDD §5.2. Unified DDD không đổi vì §5.2 vốn đã đúng — chính catalog trước đó lệch khỏi nó. SRS và VVP không đổi. |
| 1.7 | 2026-08-20 | Re-pin dòng 13/15 sau `T59-007`. **Đánh giá impact:** dòng 13 thêm §5.22 và lịch sử 2.6, không đổi S×L/lifecycle/residual; dòng 15 là status W0 + ghi chú §3.1 (đóng W0 7/7 task). Trace không đổi vì T59-007 là hạ tầng kiểm thử, không gắn requirement sản phẩm. Unified DDD, SRS và VVP không đổi. |
| 1.8 | 2026-08-20 | Re-pin dòng 13/14/15 sau `T59-101` (mở Wave W1). **Đánh giá impact:** dòng 13 thêm §5.23 và lịch sử 2.7, không đổi S×L/lifecycle/residual; dòng 14 nối evidence vào `CORE-101`, `D/I/T/P/R` giữ nguyên; dòng 15 là status W1 + ghi chú §3.2. Unified DDD, SRS và VVP không đổi. |
| 1.9 | 2026-08-20 | Re-pin dòng 13/14/15 sau `T59-102`. **Đánh giá impact:** dòng 13 thêm §5.24 và lịch sử 2.8, không đổi S×L/lifecycle/residual; dòng 14 nối evidence vào `CORE-101`; dòng 15 là status W1 + ghi chú §3.2. Unified DDD, SRS và VVP không đổi. |
| 1.10 | 2026-08-20 | Re-pin dòng 13/14/15 sau `T59-103`. **Đánh giá impact:** dòng 13 thêm §5.25 và lịch sử 2.9, không đổi S×L/lifecycle/residual; dòng 14 nối evidence vào `CORE-101`; dòng 15 là status W1 + ghi chú §3.2. Unified DDD, SRS và VVP không đổi. |
| 1.11 | 2026-08-20 | Re-pin dòng 13/14/15 sau `T59-104`. **Đánh giá impact:** dòng 13 thêm §5.26 và lịch sử 3.0, không đổi S×L/lifecycle/residual; dòng 14 nối evidence vào `CORE-101`; dòng 15 là status W1 + ghi chú §3.2. Unified DDD, SRS và VVP không đổi. |
| 1.12 | 2026-08-20 | Re-pin dòng 13/14/15 sau `T59-105`. **Đánh giá impact:** dòng 13 thêm §5.27 và lịch sử 3.1, không đổi S×L/lifecycle/residual; dòng 14 nối evidence vào `CORE-101`; dòng 15 là status W1 + ghi chú §3.2. Unified DDD, SRS và VVP không đổi. |
| 1.13 | 2026-08-20 | Re-pin dòng 13/14/15 sau `T59-106` (**đóng Wave W1, 6/6 task**). **Đánh giá impact:** dòng 13 thêm §5.28 và lịch sử 3.2, không đổi S×L/lifecycle/residual; dòng 14 nối evidence vào `CORE-101`; dòng 15 là status W1 + ghi chú §3.2. Unified DDD, SRS và VVP không đổi. |
| 1.14 | 2026-08-20 | Re-pin dòng 13/14/15 sau `T59-201` (**mở Wave W2**). **Đánh giá impact:** dòng 13 thêm §5.29 và lịch sử 3.3, không đổi S×L/lifecycle/residual (22/22 Open); dòng 14 tách `SYS-REQ-PROG-109/110` và `SWR-REQ-PROG-BE-111` để nối evidence Control Library đúng chỗ, `D/I/T/P/R` giữ nguyên và `U03` vẫn NOT_RUN; dòng 15 là status W2 + ghi chú §3.3. Unified DDD, SRS và VVP không đổi. |
| 1.15 | 2026-08-20 | Re-pin dòng 13/14/15 sau `T59-202`. **Đánh giá impact:** dòng 13 thêm §5.30 và lịch sử 3.4, không đổi S×L/lifecycle/residual (22/22 Open); dòng 14 nối evidence REST/RBAC vào `SYS-REQ-PROG-110` và `SWR-REQ-PROG-BE-111`, `U03` vẫn NOT_RUN; dòng 15 là status W2 + ghi chú §3.3. Unified DDD **không đổi** — ba route đúng bằng §5.1 đã khoá, không thêm route ngoài thiết kế. SRS và VVP không đổi. |
