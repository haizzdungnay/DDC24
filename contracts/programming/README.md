# Hợp đồng Programming Rev A

Thư mục này là authority machine-readable cho contract profile/artifact
(`TASK-PROG-102`), catalog lỗi liên lớp (`TASK-PROG-103`) và manifest SQLite
store (`TASK-PROG-104`). Từ `TASK-PROG-201..207`, thư mục này còn là authority
của mô hình FBD canonical, corpus equivalence ST↔FBD và manifest provenance
deterministic cho cả hai ngôn ngữ.
Mã nguồn không được hard-code lại giới hạn, mã lỗi hoặc shortcut khác contract.
Thay đổi nguồn phải chạy lại:

```bash
python3 scripts/generate_programming_profile.py
python3 scripts/generate_programming_profile.py --check
python3 scripts/generate_programming_errors.py
python3 scripts/generate_programming_errors.py --check
python3 scripts/verify_programming_fbd_contract.py --self-test
python3 scripts/verify_programming_artifact_manifest.py --self-test
```

## Thành phần

| File | Vai trò |
|---|---|
| `rev_a_profile_v1.json` | instance normative: Task, chu kỳ, capacity, type/width/wire code, language, Point, Core Library và integrity |
| `rev_a_profile_v1.schema.json` | schema khóa profile `revA-1t-1-5-30` |
| `artifact_v1.schema.json` | schema manifest cho artifact nhị phân `MKDDCIR1` |
| `artifact_build_manifest_v1.schema.json` | schema provenance strict: source/compiler/profile/library/ABI, hash file + digest integrity, build key và source map ST/FBD |
| `golden/rev_a_ahu_fan_control.mkir` | artifact `HASH_ONLY` bất biến dùng cho byte-exact/golden/loader test |
| `golden/manifest.json` | metadata và SHA-256 của golden |
| `golden/provenance.json` | liên kết source → profile → artifact |
| `golden/build_manifest_st_v1.json` | manifest production mẫu cho source ST, gồm 15 vị trí text |
| `golden/rev_a_ahu_fan_enable_fbd.mkir` | artifact FBD canonical mẫu dùng chung loader/runtime |
| `golden/build_manifest_fbd_v1.json` | manifest production mẫu ánh xạ 2 PC về UUID network/node/port FBD |
| `negative_artifact_v1.json` | mutation corpus và mã lỗi ổn định mong đợi |
| `error_catalog_v1.json` | authority 19 mã công khai, HTTP/retry/runtime/message/args và 77 ánh xạ detail |
| `error_catalog_v1.schema.json` | schema khóa catalog major 1 |
| `error_catalog_v1.manifest.json` | SHA-256, số đếm và ba consumer generated Go/C++/TypeScript |
| `programming_store_v1.manifest.json` | schema version/checksum, đường dẫn, PRAGMA, single-writer, immutable entity và feature flag của SQLite store |
| `source_bundle_v1.schema.json` | manifest trong ZIP source-only deterministic; importer chỉ nhận path UTF-8 NFC, file regular không executable, metadata ZIP cố định và luôn tạo Project/Draft mới |
| `g1_contract_join_v1.json` | manifest join G1 khóa hash/major của OpenAPI, IPC, profile, artifact, error, store cùng thứ tự deploy/rollback và flag OFF |
| `fbd_v1.schema.json` | schema canonical của graph/network/node/port/wire FBD Rev A |
| `fbd_keyboard_commands_v1.json` | registry 11 command/shortcut keyboard-first và giới hạn undo/redo |
| `fbd/golden/ahu_fan_enable.json` | graph mẫu hợp lệ dùng chung cho Core và FE |
| `fbd/equivalence_v1.json` | 20 cặp operator ST↔FBD cùng vector output chuẩn cho common typed IR |
| `fbd/manifest.json` | SHA-256 profile/schema/keyboard/golden/equivalence, lowerer version và số đếm canonical |

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

Profile và compiler/runtime ST đã triển khai đủ type target
`BOOL/INT16/DINT32/UINT16/REAL32/TIME64`, conversion tường minh, kiểm tra tràn
số và fail-closed trong `TASK-PROG-200`; feature Programming vẫn `OFF`. Vì vậy
các test host của task này chứng minh hợp đồng type, determinism, integrity và
loader boundary; chúng không được dùng để tuyên bố runtime production, FBD,
target/HIL hoặc Commission đã hoàn tất.

`TASK-PROG-202` hạ graph đã canonical qua chính `StProgram` typed, semantic
checker và IR/runtime của ST; corpus 20 operator, conversion và timer chứng minh
executable semantic tương đương. `TASK-PROG-203` khóa SHA-256 canonical, build
key và manifest ngoài artifact; source map compact trong `MKDDCIR1` được nối về
dòng/cột ST hoặc UUID network/node/port FBD. Unit FBD hợp lệ được giữ trong
manifest thay vì bị bỏ; mismatch trên wire vẫn reject. `SCALE/DEADBAND/CTU/PI/PID`
chưa có semantic/runtime chung vẫn reject fail-closed; không consumer nào được
stage graph trực tiếp hoặc tự hạ các block đó. Feature Programming vẫn `OFF`;
host evidence không thay target/HIL hay Commission.

`TASK-PROG-207` bổ sung hostile corpus chạy thật cho traversal, Unicode/path,
symlink/hardlink/executable, compression/encryption, duplicate path/key,
artifact/native smuggling, sai profile/hash/manifest và mọi giới hạn one-over.
Mọi reject được đối chiếu số Project/Draft/Revision/Check/Artifact/Operation,
audit và receipt trước/sau để chứng minh zero mutation. Timeout giết process
group, signal kiểu OOM, output bounded và audit secret alias cũng có test độc
lập; đây vẫn là host assurance, chưa thay Test Result target/HIL.
