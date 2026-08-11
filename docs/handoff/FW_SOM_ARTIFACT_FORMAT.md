# FW SOM — Định dạng artifact `MKDDCIR1`

> **Document ID:** HANDOFF-ARTIFACT-MK-DDC-24-VI
> **Phiên bản:** 1.1 | 2026-08-11
> **Đặc tả hiện hành:** [`PROGRAMMING_ARTIFACT_LOADER_SPEC.md`](../02_design/interfaces/PROGRAMMING_ARTIFACT_LOADER_SPEC.md)

Tài liệu này là **bản tóm tắt đủ dùng cho BE**. BE **không cần** hiểu tập lệnh
IR bên trong — chỉ cần biết cách sinh, truyền và kiểm tra artifact.

## Điều BE cần nhớ

| Hạng mục | Giá trị |
|---|---|
| Magic | `MKDDCIR1` (8 byte ASCII đầu file) |
| `schema_version` | 1 |
| `compiler_profile` | `0x0001` |
| `target_abi` | `0x00000F01` |
| Kích thước tối đa | **1 MiB** |
| Toàn vẹn | SHA-256 toàn file |
| Chế độ toàn vẹn Rev A | `HASH_ONLY`: SHA-256 bắt buộc, không yêu cầu chữ ký |
| Profile / thư viện | `revA-1t-1-5-30` / `rev-a.1` |

**BE không tự sinh artifact bằng tay.** Luôn dùng `mkddc-st-compile` — nó là
công cụ chính thức và là thứ duy nhất được bảo đảm tạo ra artifact hợp lệ.

## Sinh artifact

```bash
mkddc-st-compile --source program.st --out program.mkir
```

Trả về một dòng JSON. Khi `ok=true`:

```json
{
  "ok": true,
  "diagnostics": [],
  "programName": "AHU_FanControl",
  "symbols": [
    {"name":"SupplyTemp","direction":"input","type":"REAL","slot":0}
  ],
  "artifact": "TUtERENJUjEBAAEA...",
  "artifactBytes": 1760,
  "artifactSha256": "iti4yX2MFUozKezd...",
  "instructionCount": 20,
  "slotCount": 47,
  "hasRetain": true,
  "compilerVersion": "fwsom-st-1.0.0",
  "artifactSchemaVersion": 1,
  "compilerProfile": 1,
  "profileId": "revA-1t-1-5-30",
  "profileSha256": "94c58ffa...",
  "libraryVersion": "rev-a.1",
  "integrityMode": "HASH_ONLY",
  "targetAbi": 3841
}
```

Trường `artifact` hiện là **base64 của chính file `.mkir`** để giữ tương thích
As-Built. Target lifecycle không gửi base64 1 MiB qua RT handler: BE ghi file
staging dưới `${STATE_DIR}/programming/staging/` rồi gửi locator/hash qua UDS.

## Build tất định

Cùng source → **cùng byte artifact**, kiểm được bằng `cmp`. Nhờ vậy BE so sánh
hash để biết "gói này có đúng là bản đã duyệt không" mà không cần lưu cả file.

Timestamp/path/random không đi vào artifact Rev A; `build_timestamp` trong layout
schema 1 luôn bằng `0`. Thời gian tạo thuộc metadata DB/audit.

## Chế độ toàn vẹn và chữ ký

- Khoá riêng **không bao giờ** nằm trên thiết bị. Ký ở khâu build/release.
- Rev A mặc định `HASH_ONLY`; CLI **không còn tự dùng khóa test**.
- `--key <file>` với 128 ký tự hex chỉ là đường tương thích cho
  `SIGNATURE_REQUIRED` sau này.
- Runtime nhúng public key lúc biên dịch; release build truyền
  `-DMKDDC_ST_PUBLIC_KEY_HEX=<64 hex>`.

Runtime luôn kiểm SHA-256. `SIGNATURE_OPTIONAL` bị cấm và bị từ chối fail-closed;
nếu artifact có signed flag thì chữ ký phải hợp lệ, kể cả khi release profile
đang là `HASH_ONLY`.

## Kiểm tra phía BE trước khi gửi

Ba việc rẻ, làm được ngay, tránh một vòng gửi–từ chối:

1. 8 byte đầu là `MKDDCIR1`.
2. Kích thước ≤ 1 MiB.
3. `artifactSchemaVersion`/`targetAbi` khớp giá trị runtime công bố qua
   `program_capabilities`.

Việc thứ ba quan trọng nhất: hỏi `program_capabilities` **trước** khi compile
thì BE biết ngay nên dùng profile nào, thay vì compile xong mới nhận
`IR-E-003`/`IR-E-004`.

## Điều gì làm artifact bị từ chối

Xem [`FW_SOM_ERROR_CODES.md`](FW_SOM_ERROR_CODES.md) §2. Điểm cần nhớ: **mọi
lỗi load đều giữ nguyên chương trình đang chạy**. Gửi một gói hỏng không bao
giờ làm hệ mất điều khiển.

## Tương thích phiên bản

| Thay đổi phía FW | Hệ quả với BE |
|---|---|
| Thêm opcode mới | `compiler_profile` tăng; runtime cũ trả `IR-E-013` |
| Thêm section tuỳ chọn | Không ảnh hưởng |
| Đổi bố trí section | `schema_version` tăng; runtime cũ trả `IR-E-003` |
| Đổi kiểu dữ liệu | `target_abi` đổi; runtime cũ trả `IR-E-004` |
| Đổi cấu trúc file | Magic đổi; runtime cũ trả `IR-E-002` |

Trong mọi trường hợp runtime **từ chối rõ ràng**, không bao giờ chạy sai.
