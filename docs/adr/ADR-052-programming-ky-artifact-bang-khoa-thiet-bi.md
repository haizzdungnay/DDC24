# ADR-052: Artifact do bo tự biên dịch được ký bằng KHOÁ CỦA CHÍNH BO, không bằng khoá hãng và không qua service ký từ xa

- Date: 2026-08-22
- Owner: Product Owner/CTO (quyết định) · Security + Core (đề xuất kỹ thuật)
- Status: **Accepted** — chốt trong phiên 2026-08-22, đóng câu hỏi mở §2/§3 của
  [`DDD-ARTIFACT-TRUST-PROG-001`](../02_design/software/PROGRAMMING_ARTIFACT_TRUST_SECURITY_DESIGN.md)
- Related: `DDD-ARTIFACT-TRUST-PROG-001` §1..§9 ·
  [`DDD-SEC-PROG-001`](../02_design/software/PROGRAMMING_SECURITY_DESIGN.md) §10/§12 ·
  [ADR-031](ADR-031-programming-integrity-mode-hash-only-rev-a.md) (HASH_ONLY là trạng thái tạm) ·
  `T59-602`

## Vấn đề (1 câu)

Cơ chế ký/verify Ed25519 đã đủ cả hai chiều từ lâu, nhưng `SIGNATURE_REQUIRED`
không bật được vì chưa ai trả lời **ai ký** và **khoá riêng nằm ở đâu** — trong
khi sản phẩm đã cam kết cho người dùng soạn chương trình và **biên dịch ngay trên
bo**.

## Vì sao hai phương án đang có trên bàn đều không dùng được

`DDD-ARTIFACT-TRUST-PROG-001` §2 nêu hai lựa chọn:

- **(a) Ký lúc build/release.** Giả định mọi artifact tồn tại trước khi phát
  hành. Sai với sản phẩm này: Program là thứ **khách hàng viết sau khi mua**.
  Chọn (a) nghĩa là hoặc bỏ tính năng cốt lõi, hoặc để artifact người dùng vĩnh
  viễn không ký — tức `SIGNATURE_REQUIRED` không bao giờ bật được.
- **(b) Gọi service ký từ xa sau khi Check PASSED.** Đặt một phụ thuộc mạng vào
  **giữa đường Commission** — đúng thao tác mà kỹ thuật viên thực hiện khi đang
  đứng tại tủ điện, trên mạng công trường vốn là thứ kém tin cậy nhất trong cả hệ
  thống. Nó buộc phải trả lời tiếp "mất mạng thì chặn hẳn hay rơi về
  `HASH_ONLY`", và cả hai nhánh đều tệ: chặn hẳn là biến sự cố mạng thành sự cố
  điều khiển; rơi về `HASH_ONLY` là để kẻ tấn công tự chọn mức bảo vệ bằng cách
  cắt mạng.

Điểm chung của cả hai: chúng cố ép mô hình "hãng ký cho mọi thứ" lên một sản phẩm
mà **nội dung được sinh tại chỗ**.

## Quyết định

**Hai lớp khoá, phân theo NGUỒN GỐC của artifact.**

1. **Khoá hãng (vendor key)** — ký ở khâu build/release, khoá riêng không bao giờ
   nằm trên thiết bị. Dùng cho thứ hãng phát hành: Control Library SYSTEM, POU
   chuẩn, artifact mẫu đi kèm image.
2. **Khoá thiết bị (device key)** — cặp Ed25519 sinh **trên từng bo** lúc
   provisioning, khoá riêng không rời bo và không nằm trong image phát hành (mỗi
   bo một khoá khác nhau). Dùng để ký artifact do **chính bo đó** biên dịch, ngay
   sau khi Check PASSED, bởi `mkddc-st-package` — đúng chỗ đang tạo ra artifact.
3. **Core tin một TẬP khoá**: khoá hãng hiện hành + khoá hãng cũ trong cửa sổ
   overlap (cơ chế đã có từ `T59-602`) + khoá công khai **của chính bo đó**.
   Không bao giờ tin khoá thiết bị của bo khác: một bo bị chiếm không ký được
   artifact cho bo bên cạnh.
4. **Thứ tự không đảo:** Compile → Check PASSED → Sign → lưu artifact. Không ký
   thứ chưa qua kiểm.
5. **`integrityMode` đọc từ cấu hình phía server theo target**, không đọc từ
   artifact tự khai — giữ nguyên mẫu hình chống downgrade đã có ở `runner.go`.
   Bo đã provisioning khoá thiết bị thì mặc định là `SIGNATURE_REQUIRED`; bo chưa
   có khoá thì **fail-closed với lỗi nói đúng nguyên nhân**, không im lặng rơi về
   `HASH_ONLY`.

## Ranh giới trung thực của quyết định này

Khoá riêng thiết bị ở bản hiện hành được bảo vệ bằng **quyền file** (`0600`, chủ
sở hữu service), vì bo hiện tại không có secure element hay TPM. Nói thẳng:

- Nó **nâng** chi phí tấn công từ *"ghi được một file vào thư mục artifact"* lên
  *"chiếm được quyền của service và đọc được khoá"* — đúng mối đe doạ mà
  `HASH_ONLY` bỏ ngỏ (sửa artifact rồi tính lại SHA-256).
- Nó **không** chống được kẻ đã có quyền root trên bo. Không được quảng bá ngược
  lại điều đó trong bất kỳ tài liệu bán hàng hay hồ sơ chứng nhận nào.
- Đường nâng cấp đã rõ và không phá contract: khi phần cứng có secure element,
  chỉ nơi **giữ** khoá riêng đổi; định dạng artifact, tập khoá tin cậy và đường
  verify giữ nguyên.

## Hệ quả

- `mkddc-st-package` nhận đường dẫn khoá ký; thiếu khoá ở chế độ SIGNED là lỗi,
  không phải cảnh báo.
- Provisioning sinh khoá thiết bị nếu chưa có, và **không** sinh lại khi nâng cấp
  (sinh lại sẽ vô hiệu hoá mọi artifact đang chạy, gồm cả LKG — tức phá đúng
  đường lùi).
- Thay bo là **thay danh tính ký**: artifact của bo cũ không verify được trên bo
  mới. Quy trình thay thế controller phải biên dịch lại từ Revision, không bê
  artifact cũ sang — điều này phải nằm trong runbook `T59-705`.
- Audit ghi fingerprint khoá đã dùng để verify và cờ `usedTestKey`, theo §7 của
  `DDD-ARTIFACT-TRUST-PROG-001`.

## Rollback quyết định

Chỉ Product Owner supersede được bằng decision record mới. Nếu mô hình khoá thiết
bị bị bác, hệ thống **không** được lặng lẽ quay lại `HASH_ONLY` như trạng thái
vĩnh viễn: phải mở lại `T59-602` với một mô hình thay thế có tên và có chủ.
