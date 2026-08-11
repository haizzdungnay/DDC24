# Đặc tả Artifact và Loader Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID | `IFSPEC-ART-PROG-001` |
| Phiên bản | 0.6 |
| Trạng thái | **M3 — APPROVED FOR IMPLEMENTATION; contract foundation và sáu type/source map `TASK-PROG-102/200` đã implement trên host; production stage/swap/target evidence còn mở** |
| Ngày | 2026-08-11 |
| Chủ quản | Compiler Lead + Core Lead |
| Người review | Security Lead, Operations Lead, Verification Lead |
| Người phê duyệt | System Architect + Product Owner |
| Nguồn | Product Spec v2.2, `SRS-PROG-001`, `DDD-LANG-PROG-001`, `PROG-OD-001` |
| Phạm vi | Target Rev A artifact `MKDDCIR1`, verify/stage/safe-swap/rollback |

> **APPROVED FOR IMPLEMENTATION — `AUTH-PROG-2026-08-11-03`.** Mọi ô
> `PENDING/BLOCKED` về chữ ký trong hồ sơ này được `WAIVED FOR IMPLEMENTATION`;
> không còn chặn viết/merge code. Review và evidence chưa có vẫn thực hiện trong task.

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Định nghĩa **file artifact trông ra sao từng byte** và **loader kiểm nó thế nào trước khi cho chạy**. Gồm layout, hash/toàn vẹn, giới hạn, quy trình nạp có chặn trên, và cách tráo chương trình an toàn (stage → swap → rollback). |
| 2. Ai phải đọc file này? | Compiler (bên sinh ra artifact) và Core (bên nạp) — hai bên phải khớp từng byte. Security đọc §4 và §8; Ops đọc §7 và §9. |
| 3. Hệ thống hiện tại đang có gì? | `TASK-PROG-102/200` đã thêm profile/schema/golden, generated constants, deterministic serializer và loader đủ raw type `1..6`; source-map flag/section/order/location được kiểm fail-closed; loader mặc định `HASH_ONLY`, luôn kiểm SHA-256 và không sửa output caller khi reject. `st_control_api.*` vẫn nhúng artifact base64 và bootstrap production **chưa nối stage/swap**. |
| 4. Thiết kế mới thay đổi điều gì? | Giữ nguyên layout `MKDDCIR1` schema 1 nếu không cần đổi. Bỏ cách truyền base64 trong handler thời gian thực, chuyển sang **staging bằng file/FD qua UDS** — vì nhét 1 MiB base64 vào đường RT là không chấp nhận được. Thêm chế độ toàn vẹn `HASH_ONLY` cho compiler nội bộ tin cậy, giữ trường chữ ký để dành. |
| 5. Team phải sửa module/contract nào? | Phần contract/loader foundation ở §10 đã có source. Tiếp theo Core tách loader thành worker ngoài RT và bàn giao tại safe boundary; BE chuyển staging sang file/FD. Cấm policy `SIGNATURE_OPTIONAL`; Rev A dùng `IntegrityMode::HASH_ONLY` theo ADR-031. |
| 6. Điều gì còn bị chặn? | Không còn decision blocker: ADR-026/031 đã `Accepted`, compiler/loader đã đủ sáu type target. Còn implementation blocker ở task sau: FBD producer, production stage/swap, persistence/LKG và target/HIL evidence. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | `EV-PROG-G2-200` ghi loader libFuzzer + ASan/UBSan `10.000.000` input, RSS đỉnh 462 MiB, 0 crash/timeout; CTest `898/898`. Đây là evidence hỗ trợ host, chưa nâng `VS-PROG-006/011/023` PASS vì chưa có bundle/FBD/production stage/target/independent review. |

Bất biến quan trọng nhất: **loader phải tự kiểm độc lập**, không tin compiler.
Nếu artifact hỏng hoặc sai target thì bị từ chối **trước khi** tráo, và chương
trình đang chạy không hề bị ảnh hưởng. Đây là hàng rào cho `RSK-PROG-006`.

## 1. Mục tiêu và bất biến

Artifact là ranh giới duy nhất giữa compiler non-RT và runtime. Core không nhận
source ST/FBD, không parse JSON/source và không thực thi byte chưa verify. Loader
phải bounded, fail-closed, không sửa active/LKG khi reject và không cấp phát trong
đường thực thi sau khi candidate được chuẩn bị.

Tiêu chí thành công: mọi byte/section/version/limit được kiểm trước activation;
artifact hỏng bất kỳ bit nào bị reject; swap chỉ ở safe boundary; power loss để
lại đúng một active revision; IOP vẫn đáp ứng deadline trong stage/swap.

## 2. As-Built và quyết định Target

| Nội dung | As-Built 2026-08-11 | Target Rev A |
|---|---|---|
| Format/loader | `st_ir.*`, `st_artifact.*`, `st_loader.*` | giữ `MKDDCIR1` schema 1 nếu không đổi layout |
| Verify | `StIntegrityMode`, mặc định `HASH_ONLY`; SHA-256 bắt buộc; `SIGNATURE_OPTIONAL` bị từ chối; signed artifact nếu có phải verify đúng | giữ `HASH_ONLY` trong trusted local boundary; field signature dành cho `SIGNATURE_REQUIRED` sau này |
| Control API | `st_control_api.*`, schema `st_program_control_v1` có base64 artifact | file/FD staging qua UDS; cấm base64 1 MiB trong RT handler |
| Loader wiring | thư viện/test có, bootstrap production chưa route | non-RT loader worker + safe-boundary handoff |
| Spec cũ | `TYPED_IR_ARTIFACT_SPEC...` ghi signature normative | chỉ còn As-Built supporting spec; mục signature bị supersede cho target |

ADR-031 đã loại bỏ `allow_unsigned`: policy là enum tường minh và khóa ở release
profile; `SIGNATURE_OPTIONAL` luôn fail-closed. Profile/schema/golden và ca âm nằm
tại `contracts/programming/`; production provenance vẫn phụ thuộc quyền staging,
UDS peer credential và package boundary ở task lifecycle/deploy sau.

## 3. File layout schema 1

Mọi integer little-endian; không padding ngầm; tổng tối đa 1 MiB.

| Offset | Size | Field | Validation |
|---:|---:|---|---|
| 0 | 8 | magic | ASCII `MKDDCIR1` |
| 8 | 2 | schemaVersion | `1` |
| 10 | 2 | compilerProfile | `0x0001` hoặc capability đã duyệt |
| 12 | 4 | targetAbi | `0x00000F01`, exact match |
| 16 | 4 | headerSize | `128` |
| 20 | 4 | totalSize | bằng exact file size, ≤1 MiB |
| 24 | 2 | sectionCount | 1..16 |
| 26 | 2 | flags | bit 0 source map, bit 1 RETAIN, bit 2 legacy signature; còn lại 0 |
| 28 | 4 | reserved0 | 0 |
| 32 | 32 | SHA-256 | digest theo §4 |
| 64 | 64 | signature/reserved | Golden HASH_ONLY: toàn 0 và signed flag=0; nếu signed flag bật thì chữ ký phải hợp lệ dù mode không dùng nó làm provenance |
| 128 | 16 × n | section table | sorted, unique, aligned, bounded |

Entry section: `type:u16`, `flags:u16=0`, `offset:u32`, `size:u32`,
`itemCount:u32`. `offset` căn 8, không overlap/table overlap/overflow. Unknown
mandatory `<0x8000` reject; extension `>=0x8000` được bỏ qua khi size bounded.

| Type | Tên | Bắt buộc | Stride / invariant chính |
|---:|---|---|---|
| `0x0001` | METADATA | có | ≥128 byte; program/compiler string NUL-bounded, slot counts |
| `0x0002` | CONSTANTS | có | 16; loader nhận exact raw `BOOL=1,DINT=2,REAL=3,TIME=4,INT=5,UINT=6`; value/padding phải canonical theo width/type |
| `0x0003` | VARIABLES | có | 80; name bounded, unique slot/type/storage/init |
| `0x0004` | CODE | có | 16; opcode/type/operand/control flow checked |
| `0x0005` | IO_BINDING | có | 16; slot/direction/point/type/scale bounded |
| `0x0006` | FB_INSTANCES | có | 80; unique state/input/output ranges |
| `0x0007` | RETAIN_LAYOUT | khi flag | header 16 + entry×8; layout hash/size/offset unique |
| `0x0008` | DEBUG_SOURCEMAP | khi flag | 8; PC tăng, line/column bounded |

## 4. Toàn vẹn và provenance

SHA-256 tính trên toàn file khi vùng `[32,128)` được coi là zero. Loader tính lại
constant-time compare với `[32,64)`. Rev A `HASH_ONLY` không yêu cầu chữ ký;
golden chuẩn để signature field zero và bit signed zero. Nếu signed flag có mặt,
loader vẫn kiểm Ed25519 và từ chối mismatch; chữ ký hợp lệ không đổi mode thành
provenance authority. Hash chứng minh toàn vẹn, không chứng minh tác giả;
provenance được bảo vệ bởi local UDS peer credential, staging file
permission, immutable DB linkage và audit chain.

Artifact metadata trong DB phải link `revisionId`, canonical source hash, artifact
hash, compiler ID/version, target ABI/profile, library version, createdAt và Check
ID. Core read-back lưu artifact hash; mọi mismatch DB/file/Core là incident, không
tự sửa bằng cách ghi đè authority.

## 5. Giới hạn và data model runtime

| Resource | Max schema 1 | Hành vi vượt |
|---|---:|---|
| artifact / sections | 1 MiB / 16 | `IR-E-001/008` |
| instruction | 4.096 | `IR-E-010` |
| slot / writable slot | 1.024 / 512 | `IR-E-010` |
| constants / FB / binding | 512 / 64 / 256 | `IR-E-010` |
| RETAIN var / record | 128 / 4.096 byte | `IR-E-010/011` |

Candidate runtime object gồm immutable code/constants/binding/source map và
preallocated mutable slot/FB state/output staging. Mọi index dùng integer checked;
phép `offset + size`, `count × stride` dùng width lớn hơn và kiểm overflow trước.

## 6. Quy trình loader bounded

| Bước | Kiểm tra | Error |
|---:|---|---|
| 1–6 | size, magic, schema, profile, ABI, header/flags/reserved | `IR-E-001..004/013` |
| 7–8 | SHA-256, integrity mode/signature policy | `IR-E-005..007` |
| 9–11 | table bounds/sort/unique/alignment/non-overlap/required | `IR-E-008/009` |
| 12 | metadata/count/string/slot relation | `IR-E-010/011` |
| 13 | constants/variables/type/init/unique slot | `IR-E-010/011` |
| 14 | FB ranges/state/type/unique instance | `IR-E-010/011` |
| 15 | bindings point/range/direction/type/scale | `IR-E-012` |
| 16 | RETAIN flag/layout/hash/offset/record bounds | `IR-E-010/011` |
| 17–20 | code stride/op/type/operand/dst/jump/HALT/reserved | `IR-E-014` |
| 21 | source map PC/order/locations | `IR-E-011` |
| 22 | allocate candidate once, initialize non-RETAIN | `IR-E-015` |

Control flow Rev A chỉ cho forward jump đến instruction boundary, bắt buộc HALT
có thể tới được; không loop/recursion/unbounded dispatch. `dst < varSlotCount`;
source operands `< slotCount`; trường opcode không dùng phải zero. Sau bước 22,
candidate immutable layout được trao bằng owned handle; executor không allocate.

```text
load(bytes, capability, integrityPolicy):
  validate_header_and_hash_before_deep_decode()
  validate_all_section_ranges_without_dereference()
  decode_each_table_into_temporary_bounded_builder()
  validate_cross_references_and_control_flow()
  allocate_candidate_once()
  return CandidateHandle; on error destroy temporary, active/LKG unchanged
```

## 7. Stage, safe swap và rollback

1. BE ghi staging file temp bằng `O_CREAT|O_EXCL`, mode `0640`, fsync file, rename
   atomic, fsync directory; gửi locator/size/hash qua IPC.
2. Core non-RT worker mở dưới root cố định, cấm symlink/traversal, stat owner/mode,
   mmap/read bounded, chạy loader và tạo candidate.
3. Core trả staged token gắn operation/artifact hash; token single-use, hết hạn
   10 phút; candidate chưa được executor thấy.
4. `ACTIVATE` kiểm expected active/cutover/RETAIN plan; enqueue pointer swap.
5. Tại safe boundary sau input snapshot và trước execute, runtime commit journal,
   swap atomically; first-cycle dùng output staging mới.
6. Nếu first-cycle fault/read-back mismatch: không publish candidate output, swap
   lại LKG ở boundary kế, ghi fault/audit. Nếu process chết, journal phục hồi đúng
   active đã commit hoặc active cũ.

Không unload LKG cho đến khi candidate qua first-cycle và persistence checkpoint.
Không ghi output trực tiếp trong loader. Stage/verify có thể kéo dài nhưng không
được block ScanLoop/IOP.

## 8. Error, safe behavior và audit

| Code | Ý nghĩa | Retry | Active/LKG |
|---|---|---|---|
| `IR-E-001..004` | header/magic/schema/ABI | không | giữ |
| `IR-E-005` | hash mismatch | không; retransfer source/compile | giữ |
| `IR-E-006/007` | legacy signature invalid/missing | theo policy đã duyệt | giữ |
| `IR-E-008/009` | section table/required section | không | giữ |
| `IR-E-010..012` | resource/table/binding | sửa source/target | giữ |
| `IR-E-013/014` | profile/code unsupported | recompile compatible | giữ |
| `IR-E-015` | candidate allocation fail | sau resource recovery | giữ |

Public map theo catalog: `IR-E-004/013` → `PRG-ERR-TARGET-001`; 13 mã
`IR-E-*` còn lại → `PRG-ERR-ARTIFACT-001`. BE giữ `detailCode` chỉ trong
log/audit nội bộ; FE không nhận hoặc rẽ nhánh theo mã `IR-E-*`.
Audit ghi actor, revision/artifact/operation, target, result/error, active trước/sau
và correlation; không ghi artifact bytes/source/host path/public key material.

## 9. Compatibility và deployment

- Magic hoặc header breaking → `MKDDCIR2`; schema major lệch reject.
- Loader schema 1 nhận raw `BOOL=1,DINT=2,REAL=3,TIME=4,INT=5,UINT=6` và
  executor/RETAIN/process-image kiểm đúng width/range; raw khác hoặc encoded
  value/padding không canonical bị từ chối.
- Profile/library/ABI exact capability match; không “best effort”. Optional section
  `>=0x8000` chỉ được ignore nếu không ảnh hưởng execution semantics.
- Deploy order: loader dual-compatible → compiler emit old schema mặc định → test
  candidate new schema → đổi compiler emit → activate. Rollback ngược lại chỉ sau
  Restore artifact tương thích loader cũ.
- Package upgrade không xóa active/LKG/staging/audit. Orphan staging được GC sau
  đối chiếu operation, không theo tuổi file đơn thuần.
- Partial deploy: BE/FE mới gặp Core cũ phải capability-disable Commission, không
  gửi artifact rồi suy thành thành công.

## 10. Repository mapping

| Phần | As-Built | Target sửa/tạo |
|---|---|---|
| profile/contract | `contracts/programming/`, generated `st_profile_generated.hpp` | **đã có ở TASK-PROG-102**; thay đổi profile phải regenerate/check |
| format/serializer | `apps/core/application/st/st_ir.*`, `st_artifact.*` | **đã có deterministic metadata/API, sáu type và source map** tại Task 102/200 |
| loader | `st_loader.*`, `st_runtime.*`, `st_exec.*`, `st_retain.*` | **verify/load/execute type target trên host đã có**; non-RT worker + staged handle còn phải nối |
| control | `st_control_api.*`, `contracts/config/st_program_control_v1.schema.json` | thay base64 path bằng versioned UDS/locator |
| lifecycle | `st_scheduler.*`, `scan_loop.*`, bootstrap | safe-boundary swap/journal/read-back |
| packaging | `platform/packaging/` | directory owner/mode/tmpfiles/backup |
| tests | `apps/core/application/st/tests`, `fuzz/fuzz_st_loader.cpp` | power-loss, symlink, mixed-version, target jitter |

## 11. Verification và acceptance

| Test ID | Fault/input | PASS/evidence |
|---|---|---|
| `ART-T-001` | golden artifact từng section/opcode | load + execute expected; byte/hash golden |
| `ART-T-002` | lật từng byte/header/hash/signature reserved | reject đúng lớp; active/LKG không đổi |
| `ART-T-003` | count/offset/size overflow, overlap, unaligned | reject trước dereference/allocation |
| `ART-T-004` | từng limit −1/limit/+1 | +1 reject `IR-E-010`; không OOM |
| `ART-T-005` | fuzz ≥10^7 inputs | không crash/hang/OOB/leak; corpus/evidence lưu |
| `ART-T-006` | traversal/symlink/owner/mode sai | reject, không mở file ngoài staging root |
| `ART-T-007` | power cut tại từng bước stage/swap/journal | reboot có đúng một active; LKG usable |
| `ART-T-008` | stage/verify 1 MiB khi IOP chạy | không missed deadline ngoài V&V limit |
| `ART-T-009` | first-cycle fault | không publish output candidate; rollback LKG |
| `ART-T-010` | compiler/Core mixed version | capability block hoặc load đúng; không undefined behavior |
| `ART-T-011` | inspect link/symbol Core | không parser/lexer/compiler symbol trong runtime binary |

## 12. Loader state và lifetime ownership

| State | Owner | Resource được giữ | Exit/safe cleanup |
|---|---|---|---|
| `RECEIVED` | BE staging | immutable file + DB metadata | reject xóa staging sau audit; success chuyển locator |
| `VERIFYING` | Core non-RT worker | fd/mmap + bounded builder | mọi error đóng fd/unmap/destroy builder |
| `STAGED` | Core lifecycle | `CandidateHandle`, token, expiry | activate một lần hoặc expire/explicit discard |
| `PENDING_SWAP` | ScanLoop single writer | prevalidated handle + expected active | safe boundary swap hoặc return conflict |
| `FIRST_CYCLE` | executor | candidate mutable state + output staging | pass commit; fail destroy candidate after LKG restore |
| `ACTIVE` | runtime | immutable artifact + runtime state | giữ tới next committed swap; không loader mutate |
| `LKG` | runtime/persistence | previous compatible handle/artifact reference | GC chỉ sau retention + no reference + backup rule |

Handle dùng RAII/unique ownership; monitor chỉ nhận immutable snapshot/generation.
Token không chứa path client-controlled. Expiry không được hủy handle đang
`PENDING_SWAP/FIRST_CYCLE`. Loader error không log raw bytes hoặc host path.

## 13. Blocker, revision và phê duyệt

| Blocker | Owner | Ảnh hưởng | Điều kiện mở |
|---|---|---|---|
| Integrity/profile contract | Product + Security + Architect | **ĐÃ ĐÓNG** | ADR-026/031 Accepted; profile/schema/golden + code/test tại TASK-PROG-102 |
| Compiler type target | Compiler + Core | **ĐÃ ĐÓNG cho ST host** | `TASK-PROG-200`; golden SHA-256 `fcdfd4a6...0528`; FBD equivalence thuộc Task 201/202 |
| Production stage/swap chưa wired | Core Lead | chưa có runtime evidence | Plan 53 implementation + target/power-loss PASS |

| Phiên bản | Ngày | Thay đổi | Tác giả |
|---|---|---|---|
| 0.1 | 2026-08-09 | Khóa layout, loader, integrity target, stage/swap, compatibility và test | System Engineering |
| 0.2 | 2026-08-09 | Bổ sung loader state/lifetime/cleanup contract và single-writer handoff; chuyển Detailed Draft chờ review | System Engineering |
| 0.3 | 2026-08-09 | Thêm mục Đọc nhanh và bảng tự kiểm `DD-01..DD-13`; đóng finding `F-PROG-001/002` | System Engineering |
| 0.4 | 2026-08-11 | Đồng bộ As-Built TASK-PROG-102: profile/schema/golden, generated constants, deterministic API, `StIntegrityMode=HASH_ONLY`, loader no-mutation và ranh giới phần type/stage/swap còn mở | Core + Compiler Lead |
| 0.5 | 2026-08-11 | Đồng bộ `TASK-PROG-103`: khóa ánh xạ exact `IR-E-004/013` sang Target, 13 detail loader còn lại sang Artifact; detail chỉ giữ nội bộ và catalog sinh ba ngôn ngữ là nguồn máy đọc | Core + BE Lead |
| 0.6 | 2026-08-11 | Đồng bộ `TASK-PROG-200`: loader/serializer/executor/RETAIN đủ raw type 1..6, conversion/range/value canonical fail-closed, source map strict và loader fuzz 10 triệu input; production stage/swap/target vẫn mở | Core + Compiler Lead |

| Vai trò | Trạng thái | Bằng chứng |
|---|---|---|
| Compiler + Core Lead | **IMPLEMENTED CONTRACT + ST TYPE FOUNDATION** | `95585e7`, `8d58efa`, `a638470`, `EV-PROG-G2-200` |
| Security + Ops + QA | **WAIVED FOR IMPLEMENTATION; hậu kiểm/evidence độc lập** | `AUTH-PROG-2026-08-11-03` |
| System Architect + Product Owner | **APPROVED FOR IMPLEMENTATION** | ADR-026/031 Accepted; `AUTH-PROG-2026-08-11-03` |

Tự kiểm `DD-01..DD-13`:

| Mã | Kết quả | Mục trong file / lý do |
|---|---|---|
| `DD-01` Metadata | PASS | Bảng đầu file; revision history và bảng ký §13 |
| `DD-02` Mục tiêu/phạm vi | PASS | §1 mục tiêu và bất biến; §2 quyết định Target |
| `DD-03` As-Built | PASS | §2 dẫn profile/contracts, `st_ir.*`, `st_artifact.*`, `st_loader.*`, `StIntegrityMode`; ghi rõ bootstrap production **chưa route** |
| `DD-04` Target ownership | PASS | §6 loader worker ngoài RT; §12 vòng đời handle và quyền sở hữu, chỉ một bên ghi |
| `DD-05` Data từng field | PASS | §3 layout schema 1 tới mức byte/section; §5 giới hạn và mô hình dữ liệu runtime |
| `DD-06` Interface | PASS | §3 layout là hợp đồng nhị phân giữa compiler và Core; §7 giao diện stage/swap; §9 tương thích |
| `DD-07` State/algorithm/timing | PASS | §6 quy trình loader có chặn trên; §7 stage/safe swap/rollback; §12 state và lifetime |
| `DD-08` Operation flow | N/A tại file này | Không có mặt người dùng; thủ tục vận hành ở [`OPS-PROG-001`](../../06_operations/PROGRAMMING_OPERATIONS_RUNBOOK.md) §12–§13 |
| `DD-09` Error/safety/security | PASS | §4 toàn vẹn/provenance; §8 error, hành vi an toàn và audit; nguyên tắc verify độc lập với compiler |
| `DD-10` Repository mapping | PASS | §10 file cần sửa và ranh giới build |
| `DD-11` Verification | PASS | §11 gắn `VS-PROG-006/011/023` với kỳ vọng “từ chối bằng mã ổn định, 0 thực thi tùy ý, active/LKG không đổi” |
| `DD-12` Compatibility/deploy/rollback | PASS | §9 tương thích và triển khai; §7 rollback về LKG |
| `DD-13` Trace/risk/decision/sign-off | PASS cho implementation | ADR-026/031 Accepted; TASK-PROG-102 có commit/evidence; target/HIL và production stage/swap vẫn là release evidence, không phải decision blocker |

Tài liệu **không** chứng minh loader đã được nối vào production hoặc đã qua
target/HIL; các phần đó tiếp tục bị chặn ở gate implementation/release tương ứng.
