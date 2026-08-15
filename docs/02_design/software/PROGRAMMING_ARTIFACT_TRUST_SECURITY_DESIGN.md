# Programming Artifact Trust & Security Design (WP-13)

**Document ID:** DDD-ARTIFACT-TRUST-PROG-001
**Phiên bản:** 1.0
**Trạng thái:** **Draft — chờ Security Architecture review và duyệt trước
khi bật `integrityMode=SIGNED` cho bất kỳ target nào** (đúng exit criteria
`WP-13`)
**Tác giả:** System Engineering, theo Lệnh CTO/Owner 2026-08-15 §VI, D-05
(WP-13) — mở Document Gate #12 (`PROGRAMMING_DOCUMENT_READINESS_MATRIX.md`)
**Tài liệu cha:** [`PROGRAMMING_SECURITY_DESIGN.md`](PROGRAMMING_SECURITY_DESIGN.md)
(Rev 0.6) — tài liệu này chỉ mở rộng đúng phần Artifact Trust/Signing còn
thiếu ở đó (§7 "Artifact, IPC và filesystem" hiện chỉ nói HASH_ONLY), không
lặp lại RBAC/session/audit chung.

---

## 0. Phát hiện quan trọng: hạ tầng crypto **đã tồn tại đầy đủ cả hai chiều**

Trước khi viết tài liệu này, giả định ban đầu (Master Plan §4 WP-13, ghi
lúc chưa đọc sâu) là "thiếu cả sign lẫn verify". Đọc trực tiếp source phát
hiện **chỉ thiếu phần quy trình/chính sách, không thiếu code crypto**:

| Thành phần | Trạng thái thật | Nguồn |
|---|---|---|
| Verify chữ ký Ed25519 khi load artifact | **Có, hoạt động đầy đủ** | `st_loader.cpp` `step_integrity()` — `crypto_sign_verify_detached`, phân biệt `kBadSignature`/`kMissingSignature`, dùng `sodium_memcmp` (constant-time) cho SHA-256 |
| Ký artifact bằng Ed25519 | **Có, hoạt động đầy đủ** | `st_ir.cpp` `sign_st_artifact(artifact, secret_key)` — `crypto_sign_detached` |
| Phân biệt khoá TEST vs RELEASE | **Có, đã thiết kế sẵn nguyên tắc** | `st_public_key.hpp`: khoá nhúng mặc định là khoá TEST cam kết vào repo có chủ ý cho CI; build release **bắt buộc** truyền `-DMKDDC_ST_PUBLIC_KEY_HEX=<64 hex>`; có hàm `st_public_key_is_test_key()` để cảnh báo/gate lúc khởi động |
| Chế độ integrity | **Có 2 mode thật + 1 mode bị khoá cứng từ chối** | `StIntegrityMode`: `HASH_ONLY` (mặc định), `SIGNATURE_REQUIRED`; `SIGNATURE_OPTIONAL` **cố ý bị từ chối fail-closed ở comment code** — không có đường thực thi nào được phép dùng nó (tránh mập mờ "có ký thì tốt, không có cũng được") |
| Enforcement phía BE (Go) | **Khoá cứng HASH_ONLY, từ chối bất cứ gì khác** | `apps/web-api/internal/programming/compiler/runner.go` dòng 273/341: BE hiện tại **chủ động reject** nếu `IntegrityMode != "HASH_ONLY"` hoặc `SignaturePresent == true` — đây chính là as-built của D-05 "`HASH_ONLY` tạm chấp nhận dev/lab" |

**Kết luận:** khoảng cách thật của WP-13 là **quy trình ký + phân phối
khoá + chính sách bật/tắt SIGNED mode**, không phải viết crypto mới. Điều
này làm phạm vi thiết kế nhỏ hơn giả định ban đầu, nhưng KHÔNG làm giảm mức
độ cần review Security Architecture — bật `SIGNATURE_REQUIRED` production
vẫn là thay đổi threat model thật (ai giữ private key, key có thể bị đánh
cắp/lộ, quy trình ký có thể bị qua mặt).

## 1. Threat model (bổ sung cho §10 `PROGRAMMING_SECURITY_DESIGN.md`)

| Threat/abuse | Detection/control | Failure/recovery | Ghi chú |
|---|---|---|---|
| Artifact giả mạo thay bản compiler thật tạo ra (supply-chain giữa compiler CLI và staging) | Ed25519 verify tại `step_integrity()` khi `SIGNATURE_REQUIRED` | `kBadSignature`, reject, LKG giữ nguyên | Chỉ có hiệu lực khi mode = `SIGNATURE_REQUIRED`; ở `HASH_ONLY` (as-built hiện tại) mối đe doạ này **không được chặn** — SHA-256 chỉ chống corrupt ngẫu nhiên, không chống chỉnh sửa có chủ đích kèm cập nhật lại hash |
| Khoá TEST bị dùng nhầm cho artifact production | `st_public_key_is_test_key()` đã có sẵn, nhưng **chưa có nơi nào gọi nó để gate** (đọc source, không tìm thấy call site ngoài test) | **Chưa có** — đây là gap cần đóng trước khi bật SIGNED | Đề xuất: `mkddc-core` khởi động phải log CẢNH BÁO mức CRITICAL nếu `st_public_key_is_test_key()==true` VÀ deployment gắn cờ production (không chỉ log — phải chặn Commission nếu production build dùng khoá test) |
| Private key ký bị lộ (laptop dev, CI runner, repo) | Không có key trên thiết bị (`st_public_key.hpp` đã ghi nguyên tắc "KHOÁ RIÊNG KHÔNG BAO GIỜ NẰM TRÊN THIẾT BỊ") | Rotate khoá (§4), mọi artifact ký bằng khoá cũ coi là không tin cậy từ thời điểm phát hiện | Cần xác định **nơi lưu khoá ký** — xem §3, đây là câu hỏi chưa trả lời, không tự quyết ở tài liệu này |
| Downgrade attack: kẻ tấn công ép hệ thống dùng `HASH_ONLY` dù chính sách production yêu cầu `SIGNATURE_REQUIRED` | BE phải đọc `integrityMode` từ **cấu hình server-side cố định theo target**, không từ request/artifact tự khai | Reject nếu artifact tự khai integrityMode khác cấu hình server | `runner.go` hiện SO SÁNH `IntegrityMode` artifact trả về với hằng số `"HASH_ONLY"` — đúng mẫu hình cần giữ khi thêm nhánh SIGNED (so với cấu hình, không tin artifact tự khai) |
| CI ký artifact bằng khoá release nhưng không kiểm soát được input (compiler bug ký "rác") | Ký chỉ diễn ra sau khi Check đã PASSED — không ký artifact chưa qua compile-time verification | N/A | Thứ tự: Compile → Check PASSED → (nếu SIGNED mode) Sign → lưu Artifact. Không đảo thứ tự |

## 2. Signing — quy trình đề xuất (chưa implement)

Đúng nguyên tắc đã ghi sẵn trong code: **ký chỉ diễn ra ở khâu build/
release, không bao giờ trên thiết bị field**. Cụ thể cho Rev A:

- Không phải `mkddc-web` (BE Go) và không phải `mkddc-core` (runtime) giữ
  private key — cả hai chỉ **verify**, không bao giờ **sign**.
- Ký nên xảy ra ở một trong hai điểm, cần Security+Release quyết định:
  - (a) **Build-time trong CI/CD** khi đóng gói release — ký toàn bộ
    artifact chuẩn đi kèm firmware image, không phải ký per-Program lúc
    runtime Check. Phù hợp nếu Program là cố định tại thời điểm release
    (không khớp mô hình Rev A hiện tại — Program do end-user soạn qua
    Web UI, biên dịch on-device).
  - (b) **Ký on-demand sau khi Check PASSED**, do chính `mkddc-web`/
    `mkddc-core` gọi ra một service ký tách biệt (không giữ key cục bộ) —
    khớp mô hình Rev A hơn (Program do người dùng field tạo ra, biên dịch
    ngay trên board), nhưng cần thiết kế thêm: service ký ở đâu (cùng
    mạng LAN cơ sở? cloud?), giao thức gọi, availability khi mất mạng
    (Check vẫn phải hoạt động ở chế độ `HASH_ONLY` nếu network xuống, hay
    chặn hẳn Commission?).

**Không tự chọn (a) hay (b) ở tài liệu này** — đây là quyết định kiến trúc
ảnh hưởng trực tiếp UX "biên dịch ngay trên board" đã cam kết cho Rev A,
cần Security + Product cùng quyết.

## 3. Key provisioning (câu hỏi mở, cần Security Architecture trả lời)

1. Private key ký production lưu ở đâu? Chưa tìm thấy đánh giá HSM/key
   custody nào có sẵn trong repo này (đã tìm `docs/` — không có) — đây là
   đánh giá cần làm mới, không có tiền lệ nội bộ để tái dùng. Phạm vi nhỏ
   (Ed25519 32-byte, ký artifact <1 MiB, tần suất ký thấp — chỉ khi Check
   PASSED) nên một giải pháp nhẹ (HSM nhỏ/YubiKey, hoặc secret manager có
   kiểm soát truy cập chặt trong CI) có thể đủ, nhưng lựa chọn cụ thể cần
   Security Architecture đánh giá riêng, không suy đoán ở đây.
2. Ai có quyền yêu cầu ký (role nào, quy trình approve)?
3. Public key nhúng theo `-DMKDDC_ST_PUBLIC_KEY_HEX` — quy trình build
   release lấy giá trị này từ đâu, ai audit rằng khoá nhúng đúng là khoá
   release (không phải khoá test) trước khi xuất firmware image?

## 4. Key rotation

Tái dùng đúng pattern đã có cho TLS certificate ở
`PROGRAMMING_SECURITY_DESIGN.md` §12 ("Certificate rotation hỗ trợ overlap
trust window") — áp dụng tương tự cho Ed25519:

- `StLoaderOptions.public_key` đã có sẵn cơ chế override khoá đơn — cần mở
  rộng để verify chấp nhận **một tập khoá tin cậy** (khoá mới + khoá cũ)
  trong cửa sổ chuyển tiếp, không phải đổi tức thời (đổi tức thời làm mọi
  artifact ký bằng khoá cũ, kể cả đang chờ Commission, bị từ chối đột
  ngột).
- Sau khi hết cửa sổ overlap, gỡ khoá cũ khỏi tập tin cậy — cần audit ghi
  lại chính xác mốc thời gian gỡ.

## 5. Rollback protection

Đã có sẵn nguyên tắc LKG (Last Known Good) trong threat matrix hiện hành
(`SEC-T-005` "malicious artifact ... reject, LKG keep"). Với SIGNED mode,
bổ sung: artifact LKG cũ hơn (ký bằng khoá đã rotate/revoke) **vẫn phải
verify được** trong cửa sổ overlap (§4) để rollback không bị chặn oan bởi
chính cơ chế bảo vệ nó.

## 6. Secure commissioning

Khi `integrityMode=SIGNATURE_REQUIRED` bật cho một target:
- `Check` phải verify chữ ký NGAY sau compile (không đợi tới Commission) —
  để lỗi ký hiện sớm ở bước Check thay vì chặn Commission muộn.
- `Commission` không được nhận artifact chưa qua Check với đúng
  `integrityMode` cấu hình cho target đó — đúng pattern chống downgrade §1.

## 7. Audit (bổ sung §9 `PROGRAMMING_SECURITY_DESIGN.md`)

Thêm field bắt buộc khi SIGNED mode bật: kết quả verify chữ ký
(pass/fail/absent), fingerprint khoá công khai đã dùng để verify (không
phải khoá riêng), và cờ `usedTestKey` (đúng phát hiện §1 — nếu
`st_public_key_is_test_key()` từng trả `true` trong một lần Check/Commission
production, đây phải là sự kiện audit mức cao, không chỉ log).

## 8. Failure policy

| Tình huống | Hành vi (đã có sẵn ở `st_loader.cpp`, giữ nguyên) |
|---|---|
| `SIGNATURE_REQUIRED` + không có chữ ký | `kMissingSignature`, reject, fail-closed |
| `SIGNATURE_REQUIRED` + chữ ký sai | `kBadSignature`, reject, fail-closed |
| `HASH_ONLY` + có chữ ký (không nên xảy ra nếu BE giữ đúng enforcement) | Reject — flag signature phải bằng 0 khi cờ signed không set (`step_integrity()` đã kiểm) |
| `SIGNATURE_OPTIONAL` | **Không có đường thực thi nào được cho phép** — cố tình reject cứng ở mức thiết kế, không phải bug |

Không đề xuất thay đổi hành vi failure hiện có — chỉ cần xác nhận enforcement
phía Go (`runner.go`) đổi đúng theo cấu hình target khi SIGNED mode được
duyệt bật (§1 mục "downgrade attack").

## 9. Việc CHƯA làm (chờ Security Architecture + Product quyết ở §2/§3)

- Chọn mô hình ký (a) build-time hay (b) on-demand (§2).
- Thiết kế custody khoá riêng thật (§3) — có thể tái dùng đánh giá HSM cũ.
- Sửa `runner.go` đổi enforcement từ hard-code `HASH_ONLY` sang đọc cấu
  hình theo target — **không làm trước khi §2/§3 chốt**.
- Gọi `st_public_key_is_test_key()` ở đường khởi động `mkddc-core` để gate
  production dùng nhầm khoá test (§1) — việc này AN TOÀN để làm sớm hơn
  (chỉ thêm cảnh báo, không đổi hành vi mặc định `HASH_ONLY`), có thể đưa
  vào backlog kỹ thuật độc lập, không cần chờ toàn bộ §2/§3.

## 10. Lịch sử sửa đổi

| Revision | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-08-15 | Tạo mới cho WP-13. Phát hiện quan trọng: crypto sign+verify Ed25519 đã tồn tại đầy đủ ở `st_loader.cpp`/`st_ir.cpp`/`st_public_key.hpp`; BE Go (`runner.go`) hiện hard-code từ chối mọi thứ khác `HASH_ONLY` — khoảng cách thật là quy trình ký/custody khoá/chính sách bật SIGNED, không phải thiếu code crypto. Chưa implement — đúng gate tự đặt, chờ Security Architecture + Product trả lời §2/§3. |
