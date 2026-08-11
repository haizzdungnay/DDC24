# Hợp đồng Programming Rev A

Thư mục này là authority machine-readable cho contract profile/artifact
(`TASK-PROG-102`), catalog lỗi liên lớp (`TASK-PROG-103`) và manifest SQLite
store (`TASK-PROG-104`). Mã nguồn không được hard-code lại giới hạn hoặc mã lỗi.
Thay đổi nguồn phải chạy lại:

```bash
python3 scripts/generate_programming_profile.py
python3 scripts/generate_programming_profile.py --check
python3 scripts/generate_programming_errors.py
python3 scripts/generate_programming_errors.py --check
```

## Thành phần

| File | Vai trò |
|---|---|
| `rev_a_profile_v1.json` | instance normative: Task, chu kỳ, capacity, type/width/wire code, language, Point, Core Library và integrity |
| `rev_a_profile_v1.schema.json` | schema khóa profile `revA-1t-1-5-30` |
| `artifact_v1.schema.json` | schema manifest cho artifact nhị phân `MKDDCIR1` |
| `golden/rev_a_ahu_fan_control.mkir` | artifact `HASH_ONLY` bất biến dùng cho byte-exact/golden/loader test |
| `golden/manifest.json` | metadata và SHA-256 của golden |
| `golden/provenance.json` | liên kết source → profile → artifact |
| `negative_artifact_v1.json` | mutation corpus và mã lỗi ổn định mong đợi |
| `error_catalog_v1.json` | authority 19 mã công khai, HTTP/retry/runtime/message/args và 77 ánh xạ detail |
| `error_catalog_v1.schema.json` | schema khóa catalog major 1 |
| `error_catalog_v1.manifest.json` | SHA-256, số đếm và ba consumer generated Go/C++/TypeScript |
| `programming_store_v1.manifest.json` | schema version/checksum, đường dẫn, PRAGMA, single-writer, immutable entity và feature flag của SQLite store |
| `g1_contract_join_v1.json` | manifest join G1 khóa hash/major của OpenAPI, IPC, profile, artifact, error, store cùng thứ tự deploy/rollback và flag OFF |

Kiểm join trước mọi thay đổi contract hoặc deploy:

```bash
python3 scripts/verify_programming_g1_contracts.py --self-test
```

## Compatibility và thứ tự deploy

| Producer | Consumer | Kết quả |
|---|---|---|
| schema 1, profile 1, `HASH_ONLY` | loader Rev A | chấp nhận nếu SHA-256, header, section, resource và IR đều hợp lệ |
| schema major khác 1 | loader Rev A | từ chối `IR-E-003` |
| profile khác 1 | loader Rev A | từ chối `IR-E-013` |
| target ABI khác `0x00000F01` | loader Rev A | từ chối `IR-E-004` |
| `SIGNATURE_REQUIRED`, chữ ký hợp lệ | loader có đúng public key | chấp nhận như đường tương thích; Rev A production vẫn khóa `HASH_ONLY` |
| policy `SIGNATURE_OPTIONAL` | mọi artifact | từ chối fail-closed; policy này bị cấm |

Deploy loader/validator trước compiler phát artifact mới. Rollback compiler được
phép quay về producer schema/profile tương thích; không sửa, stage hay activate
Active/LKG trong task contract này. Loader dựng candidate cục bộ và chỉ ghi sang
output caller sau khi toàn bộ bước verify/load thành công.

## Ranh giới implementation hiện hành

Profile đã khóa type target `BOOL/INT16/DINT32/UINT16/REAL32/TIME64`, conversion
tường minh và fail-closed. Compiler ST As-Built mới có subset
`BOOL/INT32/REAL/TIME`; triển khai parser/codegen/runtime đủ type target thuộc
`TASK-PROG-200` và feature Programming vẫn `OFF`. Vì vậy các test host của task
này chứng minh hợp đồng, determinism, integrity và loader boundary; chúng không
được dùng để tuyên bố compiler/runtime Programming production đã hoàn tất.
