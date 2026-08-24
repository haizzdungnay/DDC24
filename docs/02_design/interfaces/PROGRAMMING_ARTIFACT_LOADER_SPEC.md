# Đặc tả Artifact và Loader Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID | `IFSPEC-ART-PROG-001` |
| Phiên bản | 1.0 |
| Trạng thái | **M3 — corrective package/atomic source có focused gate; chưa merge/target evidence** |
| Ngày | 2026-08-24 |
| Chủ quản | Compiler Lead + Core Lead |
| Người review | Security Lead, Operations Lead, Verification Lead |
| Người phê duyệt | System Architect + Product Owner |
| Nguồn | Product Spec v3.0, `SRS-PROG-001`, `DDD-LANG-PROG-001`, ADR-050/052 |
| Phạm vi | IR `MKDDCIR1/schema 1`; package `MKDDCIR2/layout 2`; verify/stage/atomic handoff/rollback |

> **APPROVED FOR IMPLEMENTATION — `AUTH-PROG-2026-08-11-03`.** Mọi ô
> `PENDING/BLOCKED` về chữ ký trong hồ sơ này được `WAIVED FOR IMPLEMENTATION`;
> không còn chặn viết/merge code. Review và evidence chưa có vẫn thực hiện trong task.

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Định nghĩa **file artifact trông ra sao từng byte** và **loader kiểm nó thế nào trước khi cho chạy**. Gồm layout, hash/toàn vẹn, giới hạn, quy trình nạp có chặn trên, và cách tráo chương trình an toàn (stage → swap → rollback). |
| 2. Ai phải đọc file này? | Compiler (bên sinh ra artifact) và Core (bên nạp) — hai bên phải khớp từng byte. Security đọc §4 và §8; Ops đọc §7 và §9. |
| 3. Hệ thống hiện tại đang có gì? | Baseline verified staging/LKG có source. Corrective current-worktree dùng `StPreparedProgramSet` + prepared signal bank, fsync `PREPARED` trước live mutation và handoff whole-set tại safe boundary; focused/affected Core gates đã PASS nhưng source chưa merge. |
| 4. Thiết kế mới thay đổi điều gì? | Khóa hai lớp: IR một POU/Program giữ `MKDDCIR1/schema 1`; container topology nhiều POU/Program là `MKDDCIR2/layout 2`. Production profile dùng `SIGNATURE_REQUIRED`; artifact cụ thể khai `SIGNED` hoặc `HASH_ONLY`, không trộn policy với trạng thái file. |
| 5. Team phải sửa module/contract nào? | Compiler/package writer và Core loader dùng chung parser package v2; coordinator không được thêm instance, rebuild signal bus hoặc đổi scheduler trước `PREPARED` fsync. Một handoff đổi program set, signal bank, identity và candidate. |
| 6. Điều gì còn bị chặn? | Merge/full gate và target record cho corrective source; target file ownership/service identity, 24 h soak, power-cut filesystem và HIL Test Result vẫn mở. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | Host tests PASS cho corrupt hash, symlink, hard-link staging race/cleanup, active/LKG no-mutation, committed restart và active-candidate rollback; full CTest 1002/1002 PASS. Đây chưa phải Test Result target/independent. |

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
| Format/loader | `st_ir.*`, `st_package_v2.*`, `st_loader.*` | IR `MKDDCIR1/schema 1`; package `MKDDCIR2/layout 2`; package parser dùng chung cho probe/unpack/load |
| Build manifest | `st_artifact_manifest.*`, artifact/package manifests, POU table/library lock/signal definitions/refs | consumer non-RT verify exact source/compiler/profile/library/ABI/hash/topology/resource/source map trước stage |
| Verify | `StIntegrityMode`, profile production `SIGNATURE_REQUIRED`; artifact trạng thái `SIGNED/HASH_ONLY` | thiếu/sai chữ ký fail closed; test/lab key phải được provenance ghi rõ, không hạ về HASH_ONLY ngầm |
| Control API | `st_control_api.*`, schema `st_program_control_v1` có base64 artifact | file/FD staging qua UDS; cấm base64 1 MiB trong RT handler |
| Loader wiring | `StProgramRuntime::prepare()` và package loader dựng prepared image ngoài scan; current worktree dựng `StPreparedProgramSet` + signal bank | fsync `PREPARED` trước live mutation; một safe-boundary handoff; target filesystem/power/timing evidence |
| Spec cũ | `TYPED_IR_ARTIFACT_SPEC...` ghi signature normative | chỉ còn As-Built supporting spec; mục signature bị supersede cho target |

ADR-031 đã loại bỏ `allow_unsigned`: policy là enum tường minh và khóa ở release
profile; `SIGNATURE_OPTIONAL` luôn fail-closed. Profile/schema/golden và ca âm nằm
tại `contracts/programming/`; production provenance vẫn phụ thuộc quyền staging,
UDS peer credential và package boundary ở task lifecycle/deploy sau.

## 3. IR đơn `MKDDCIR1` schema 1

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

### 3.1 Package nhiều POU/Program `MKDDCIR2` layout 2

`MKDDCIR2` không phải bản đổi tên của IR schema 1. Đây là container tối đa 16 MiB
chứa các blob `MKDDCIR1` nguyên vẹn theo Program cùng topology/provenance cấp
Revision. Header 128 byte little-endian có magic `MKDDCIR2`, `schemaVersion=2`,
`layoutVersion=2`, exact compiler profile/target ABI, `sectionCount=1..32`, flags,
exact artifact bytes, SHA-256; entry section dài 16 byte và phải tăng dần theo type.
Unknown section bị reject, không bỏ qua im lặng.

| Type | Section | Nội dung/invariant |
|---:|---|---|
| `0x0001` | `POU_TABLE` | kind/signature/provenance canonical; tên unique case-folded |
| `0x0002` | `PROGRAM_TABLE` | Program identity, IR blob index, period `1/5/30 s`, budget; 1..32 |
| `0x0003` | `TYPE_SIGNATURE_TABLE` | type/unit/interface dùng cho link ST/FBD |
| `0x0004` | `CODE_IR` | blob `MKDDCIR1` theo đúng thứ tự Program; không re-lower trong loader |
| `0x0005` | `CONSTANTS` | constant pool canonical cấp package |
| `0x0006` | `FB_LAYOUT` | instance path/state offset/layout; tối đa 1024 instance |
| `0x0007` | `SIGNAL_DEFS` | publisher/type/unit/freshness/stale policy/fallback; single publisher |
| `0x0008` | `BINDING_MANIFEST` | Program owner/category/point/direction; một physical output owner |
| `0x0009` | `SOURCE_MAP` | ánh xạ diagnostic/trace về ST/FBD source |
| `0x000A` | `LIBRARY_LOCK` | SYSTEM version+SHA-256 và PROJECT library Revision; DAG đã khóa |
| `0x000B` | `RETAIN_LAYOUT` | stable state identity/layout/version |
| `0x000C` | `RESOURCE_BUDGET` | tổng slot/FB/signal/binding/RETAIN/WCET theo profile |

`WritePackageV2`, `LoadPackageV2` và `UnpackPackageV2` dùng cùng contract;
`ProbePackageFormat` là dual-reader v1/v2. Writer/loader đều reject Program 33,
Enabled 17 ở runtime boundary, duplicate output owner/publisher, library lock
lệch, offset/count overflow và resource one-over trước mọi live mutation.

## 4. Toàn vẹn và provenance

SHA-256 tính trên toàn file với vùng digest/signature được chuẩn hóa theo từng
format; loader so constant-time. Production profile hiện là `SIGNATURE_REQUIRED`:
artifact phải có chữ ký Ed25519 từ tập khoá tin cậy, thiếu/sai chữ ký bị từ chối
trước stage. `SIGNED/HASH_ONLY` là trạng thái của một artifact; `SIGNATURE_REQUIRED`
là policy — không ghi tên policy vào cột/trường artifact. Golden `HASH_ONLY`
được giữ làm fixture dual-reader, không phải production fallback. Hash chỉ chứng
minh toàn vẹn; provenance còn khóa nguồn, profile, library, target, build key,
UDS peer, staging permission, immutable DB linkage và audit chain.

Manifest khóa `sourceId/language/canonicalBytes/canonicalSha256`, compiler
ID/version/lowerer, profile ID/code/SHA-256, POU table, library lock, signal
definitions/refs, topology/resource budget, target ABI, artifact magic/schema/
bytes/`fileSha256`/`integritySha256`/mode/signature, `buildKeySha256` và source map.
ST map `pc→line/column/length`; FBD map `pc→networkId/nodeId/portId/unit`.
`fileSha256` băm exact file; `integritySha256` băm theo vùng chuẩn hóa, không dùng
lẫn tên hoặc bỏ qua một manifest đầu vào.

Artifact metadata trong DB phải link `revisionId`, canonical source hash, artifact
file hash, build key, compiler ID/version, target ABI/profile, library version,
createdAt và Check ID. Core read-back lưu artifact hash; mọi mismatch
DB/manifest/file/Core là incident, không tự sửa bằng cách ghi đè authority.

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
3. Core dựng toàn bộ `StPreparedProgramSet`, prepared signal bank, prepared
   identity/candidate và RETAIN plan trong vùng cô lập. Lỗi ở bất kỳ Program,
   signal hay allocation nào discard toàn bộ; live topology/scheduler/signal/
   candidate/identity không đổi.
4. Core append + fsync journal `PREPARED`. Đây là điểm bền vững đầu tiên; trước
   khi bước này thành công **cấm** gọi live `ensure_topology`, rebuild/clear signal
   bus, rút candidate hoặc đổi scheduler state.
5. `ACTIVATE` kiểm expected active/cutover/RETAIN plan rồi arm prepared set, nhưng
   executor vẫn chưa thấy candidate.
6. Tại một safe boundary, scheduler gọi
   `swap_prepared_program_set_at_boundary()`, signal bus gọi
   `activate_prepared_replacement_at_boundary()`. Nếu signal swap lỗi sau topology
   swap, topology được restore ngay trong **cùng boundary**, trước consumer chạy.
   Chỉ sau khi cả hai thành công mới swap identity, rút candidate cũ và công bố
   `ACTIVE_CANDIDATE`.
7. Nếu first-cycle fault/read-back mismatch: không publish candidate output, swap
   lại whole-set LKG và signal bank ở boundary kế, ghi fault/audit. Recovery từ
   journal phải trả đúng active cũ hoặc toàn bộ active mới, không có topology nửa cũ.

Không unload LKG cho đến khi candidate qua first-cycle và persistence checkpoint.
Không ghi output trực tiếp trong loader. Stage/verify có thể kéo dài nhưng không
được block ScanLoop/IOP.

Bất biến fault injection: fail tại read/hash/unpack/Program N/signal prepare/
`PREPARED` append/fsync/arm phải cho cùng snapshot live trước-sau. Test phải so
instance ID/period/enabled/runtime pointer/signal definition/candidate/identity,
không chỉ so lifecycle status.

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

- `MKDDCIR1` là IR đơn schema 1; `MKDDCIR2` là package layout 2, không phải
  “IR schema kế tiếp”. Breaking IR tương lai phải có magic/version mới không
  xung đột package; mọi major/layout lệch bị reject.
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
| format/serializer | `apps/core/application/st/st_ir.*`, `st_package_v2.*`, `st_artifact.*` | IR v1 + package v2 writer/shared parser/dual-reader; current POU/signal extension chờ merge |
| manifest/provenance | `st_artifact_manifest.*`, artifact/package schema/golden, BE `checks_manifest.go`/packager | POU table/library lock/signal refs/topology/budget phải cùng immutable Revision/build key |
| loader | `st_loader.*`, `st_runtime.*`, `st_exec.*`, `st_retain.*`, `st_package_v2.*` | verify/preallocate toàn package; current signal opcode/refs và user POU runtime chờ merge/full gate |
| control | `st_control_api.*`, `contracts/config/st_program_control_v1.schema.json` | thay base64 path bằng versioned UDS/locator |
| lifecycle | `st_scheduler.*`, `programming_runtime_coordinator.*`, `st_signal_bus.*`, `scan_loop.*` | `StPreparedProgramSet` + prepared signal bank; `PREPARED` fsync rồi whole-set handoff; target/soak/power-fault |
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
| `ART-T-012` | build ST/FBD 100 lần; mutate version/profile/hash/source map | artifact/manifest byte-identical; mọi mutation reject, output caller không đổi |
| `ART-T-013` | fail từng điểm trước/sau `PREPARED` khi thay topology/signal | trước handoff: zero live mutation; handoff lỗi: restore whole-set cùng boundary; không nửa cũ/nửa mới |
| `ART-T-014` | mutate POU/library/signal/topology/budget section v2 | shared parser reject `PKG-E-*`; Active/LKG/candidate/signal bank giữ nguyên |

`ART-T-011` và phần host của boundary allocation đã PASS tại `4f7e0ac`; phép
đo filesystem/blocking/dynamic load và 10.000 chu kỳ trên Forlinx vẫn thuộc
`TASK-PROG-307`, không được suy từ test host.

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
| Compiler type/provenance target | Compiler + Core | **ĐÃ ĐÓNG cho ST/FBD host** | `TASK-PROG-200..203`; schema/golden manifest + verifier tại `2c2bfb4` |
| Target stage/swap chưa kiểm chứng | Core + BE + Ops + QA | source/host đã wire | target filesystem/service identity/power-loss Test Result PASS |
| Corrective package/atomic source chưa merge | Core + Compiler + BE | chưa được dùng làm implementation/target baseline | merge đúng commit; affected/full gate + trace/pin; deploy record mới |

| Phiên bản | Ngày | Thay đổi | Tác giả |
|---|---|---|---|
| 1.0 | 2026-08-24 | Phân biệt IR `MKDDCIR1/schema 1` với package `MKDDCIR2/layout 2`; khóa 12 section package, `SIGNATURE_REQUIRED`, POU/library/signal provenance và atomic `StPreparedProgramSet` + prepared signal bank sau `PREPARED` fsync. Focused Core gate có bằng chứng phát triển; merge/target/soak/Test Result còn mở. | Compiler + Core + BE + System Engineering |
| 0.1 | 2026-08-09 | Khóa layout, loader, integrity target, stage/swap, compatibility và test | System Engineering |
| 0.2 | 2026-08-09 | Bổ sung loader state/lifetime/cleanup contract và single-writer handoff; chuyển Detailed Draft chờ review | System Engineering |
| 0.3 | 2026-08-09 | Thêm mục Đọc nhanh và bảng tự kiểm `DD-01..DD-13`; đóng finding `F-PROG-001/002` | System Engineering |
| 0.4 | 2026-08-11 | Đồng bộ As-Built TASK-PROG-102: profile/schema/golden, generated constants, deterministic API, `StIntegrityMode=HASH_ONLY`, loader no-mutation và ranh giới phần type/stage/swap còn mở | Core + Compiler Lead |
| 0.5 | 2026-08-11 | Đồng bộ `TASK-PROG-103`: khóa ánh xạ exact `IR-E-004/013` sang Target, 13 detail loader còn lại sang Artifact; detail chỉ giữ nội bộ và catalog sinh ba ngôn ngữ là nguồn máy đọc | Core + BE Lead |
| 0.6 | 2026-08-11 | Đồng bộ `TASK-PROG-200`: loader/serializer/executor/RETAIN đủ raw type 1..6, conversion/range/value canonical fail-closed, source map strict và loader fuzz 10 triệu input; production stage/swap/target vẫn mở | Core + Compiler Lead |
| 0.7 | 2026-08-11 | Đồng bộ `TASK-PROG-203` tại `2c2bfb4`: manifest v1 ST/FBD khóa hai loại SHA-256, build key, compiler/profile/library/ABI và source map UUID/unit; verifier/CLI fail-closed, production stage/swap/target vẫn mở | Core + Compiler Lead |
| 0.8 | 2026-08-11 | Đồng bộ `TASK-PROG-300` tại `4f7e0ac`: prepare/verify/preallocate ngoài scan, safe-boundary handle swap O(1), retired cleanup ngoài RT, LKG vector swap, `IR-E-015`, allocation test và post-link no-parser/compiler gate; coordinator/UDS/bootstrap/target vẫn mở | Core Lead |
| 0.9 | 2026-08-13 | Đồng bộ `TASK-PROG-403..405` tại `c2f3189` + `10d9ad6`: verified content-address hard-link staging, safe exact cleanup không follow symlink, bounded UDS locator/hash, two-phase stage/commit/abort và active checkpoint reload exact artifact. Host fault/restart PASS; target filesystem/power/HIL còn mở. | Core + BE + QA |

| Vai trò | Trạng thái | Bằng chứng |
|---|---|---|
| Compiler + Core Lead | **Baseline implemented; corrective package/atomic current-worktree chưa closure** | focused/affected host gates; chờ commit merge/full gate/target record |
| Security + Ops + QA | **WAIVED FOR IMPLEMENTATION; hậu kiểm/evidence độc lập** | `AUTH-PROG-2026-08-11-03` |
| System Architect + Product Owner | **APPROVED FOR IMPLEMENTATION** | ADR-026/031 Accepted; `AUTH-PROG-2026-08-11-03` |

Tự kiểm `DD-01..DD-13`:

| Mã | Kết quả | Mục trong file / lý do |
|---|---|---|
| `DD-01` Metadata | PASS | Bảng đầu file; revision history và bảng ký §13 |
| `DD-02` Mục tiêu/phạm vi | PASS | §1 mục tiêu và bất biến; §2 quyết định Target |
| `DD-03` As-Built | PASS | §2 dẫn profile/contracts, `st_ir.*`, `st_artifact.*`, `st_loader.*`, BE staging và Core coordinator/checkpoint; ghi rõ source đã route nhưng target chưa kiểm chứng |
| `DD-04` Target ownership | PASS | §6 loader worker ngoài RT; §12 vòng đời handle và quyền sở hữu, chỉ một bên ghi |
| `DD-05` Data từng field | PASS | §3 IR schema 1 và §3.1 package layout 2 tới header/section/invariant; §5 giới hạn runtime |
| `DD-06` Interface | PASS | §3 layout là hợp đồng nhị phân giữa compiler và Core; §7 giao diện stage/swap; §9 tương thích |
| `DD-07` State/algorithm/timing | PASS | §6 quy trình loader có chặn trên; §7 stage/safe swap/rollback; §12 state và lifetime |
| `DD-08` Operation flow | N/A tại file này | Không có mặt người dùng; thủ tục vận hành ở [`OPS-PROG-001`](../../06_operations/PROGRAMMING_OPERATIONS_RUNBOOK.md) §12–§13 |
| `DD-09` Error/safety/security | PASS | §4 toàn vẹn/provenance; §8 error, hành vi an toàn và audit; nguyên tắc verify độc lập với compiler |
| `DD-10` Repository mapping | PASS | §10 file cần sửa và ranh giới build |
| `DD-11` Verification | PASS | §11 gắn `VS-PROG-006/011/023` với kỳ vọng “từ chối bằng mã ổn định, 0 thực thi tùy ý, active/LKG không đổi” |
| `DD-12` Compatibility/deploy/rollback | PASS | §9 tương thích và triển khai; §7 rollback về LKG |
| `DD-13` Trace/risk/decision/sign-off | PASS cho implementation | ADR-026/031 Accepted; TASK-PROG-102/300/403..405 có source/host evidence; target/HIL/power-loss vẫn là release evidence |

Tài liệu chứng minh loader/staging đã được nối trong source/host, **không** chứng
minh đã deploy hay qua target/HIL; các phần đó tiếp tục bị chặn ở release gate.
