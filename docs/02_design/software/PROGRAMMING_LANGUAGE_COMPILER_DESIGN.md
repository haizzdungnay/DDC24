# Thiết kế ngôn ngữ và compiler Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID | `DDD-LANG-PROG-001` |
| Phiên bản | 0.8 |
| Trạng thái | **M3 — APPROVED FOR IMPLEMENTATION; ST/FBD common typed IR, provenance và BE compiler worker có source/host; user POU/target còn mở** |
| Ngày | 2026-08-13 |
| Chủ quản | Compiler Lead + Controls Lead |
| Người review | Core Lead, FE Lead, Verification Lead, Security Lead |
| Người phê duyệt | System Architect + Product Owner |
| Nguồn | `SRS-PROG-001`, Product Spec v2.2, `ARCH-PROG-001`, `PROG-OD-001` |
| Phạm vi | Target Rev A ST/FBD → common typed IR; compiler chạy ngoài RT |

> **APPROVED FOR IMPLEMENTATION — `AUTH-PROG-2026-08-11-03`.** Mọi ô
> `PENDING/BLOCKED` về chữ ký trong hồ sơ này được `WAIVED FOR IMPLEMENTATION`;
> không còn chặn viết/merge code. Review và evidence chưa có vẫn thực hiện trong task.

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Chốt **viết được gì trong ST và FBD**, biên dịch ra sao, và lỗi biên dịch trông như thế nào. Định nghĩa tập con ngôn ngữ, hệ kiểu, thư viện block, và **một IR chung** để ST và FBD cho ra cùng ngữ nghĩa. |
| 2. Ai phải đọc file này? | Compiler và Controls (chủ quản); Core đọc để biết IR nào phải chạy được; FE đọc §7 (hợp đồng diagnostic) để hiển thị lỗi đúng dòng/đúng node; QA đọc §12. |
| 3. Hệ thống hiện tại đang có gì? | `TASK-PROG-200..203` đã có ST/type/IR, FBD canonical/equivalence và provenance. `TASK-PROG-205` nối compiler worker sandbox; P3/P4 nối verified artifact loader/runtime mà không link parser/compiler vào `mkddc-core`. Local POU và target WCET/HIL còn thiếu. |
| 4. Thiết kế mới thay đổi điều gì? | Compiler non-RT sinh cùng `MKDDCIR1` và manifest ngoài artifact, tách `fileSha256` khỏi `integritySha256`; manifest khóa source/compiler/profile/library/ABI/build key. Unknown version/hash/profile/source map bị reject trước khi consumer publish output. |
| 5. Team phải sửa module/contract nào? | §11. Compiler: tách `st_compiler_lib` khỏi đường RT; BE: gọi CLI/API có giới hạn từ worker, **không bao giờ gọi trong scan**; FE: dùng hợp đồng diagnostic §7. Giới hạn lấy `min(khả năng client, khả năng target, policy)`. |
| 6. Điều gì còn bị chặn? | Không còn decision blocker cho code. Local POU, target load/WCET/HIL và Test Result vẫn là gate sau; compiler worker/Check và no-parser-RT source gates đã có. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | `EV-PROG-G2-200..203`: Task 203 có build lặp 100 lần, targeted `35/35`, manifest mutation `7/7`, CTest `927/927` và Go/FE regression PASS. Đây là evidence host; `VS-PROG-003/005/006/023` chưa PASS vì worker/target và independent review chưa đủ. |

Lưu ý thẩm quyền: `ST_SUBSET_SPEC_MK-DDC-24_VI.md` chỉ **mô tả cái đang có**. Khi
nó khác Product Spec v2.2 hoặc file này, lấy Product/SRS/decision đã duyệt làm
chuẩn — không được mở rộng phạm vi sản phẩm bằng cách viện dẫn code cũ.

## 1. Mục tiêu, actor và tiêu chí thành công

Hồ sơ này khóa cú pháp, type, semantic, FBD canonical model, pipeline compiler,
diagnostic và giới hạn để FE, BE, compiler và Core không tự diễn giải khác nhau.
Actor là Controls Engineer (soạn/chẩn đoán), BE worker (compile), Core loader
(consume artifact) và QA (golden/fuzz/target test).

Thành công khi cùng một Revision + target profile luôn sinh cùng diagnostics và
artifact byte-for-byte; input ngoài subset bị reject có vị trí; compile không
tranh CPU với scan; FBD và ST hạ xuống cùng typed IR; mọi giới hạn được kiểm ở
server và loader.

Ngoài phạm vi Rev A: online source edit trong Core, JIT/native code, thư viện bên
thứ ba, pointer/dynamic allocation/recursion, multi-controller distributed task.

## 2. Authority và As-Built có dẫn chứng

| Nội dung | As-Built 2026-08-09 | Target authority / gap |
|---|---|---|
| Parser/semantic/compiler | `apps/core/application/st/st_parser.cpp`, `st_semantic.cpp`, `st_compile.cpp`; `st_fbd_model.*`; `st_fbd_compile.*`; `st_artifact_manifest.*` tại `2c2bfb4` | ST và FBD đều đi qua `StProgram` typed, semantic checker, IR và manifest chung trong thư viện compiler non-RT; local POU còn target |
| CLI | `mkddc-st-validate`, `mkddc-st-compile` từ `apps/core/CMakeLists.txt` | BE worker gọi API/CLI bounded, không gọi trong scan |
| ST unit | `PROGRAM` duy nhất; assignment, `IF/ELSIF/ELSE`, FB call | Product v2.2 yêu cầu thêm local `FUNCTION`/`FUNCTION_BLOCK`; đang `TARGET-PENDING` |
| Type | `BOOL`, `INT=int16`, `DINT=int32`, `UINT=uint16`, `REAL=float32`, `TIME=int64`; VAR input/output/local/retain | Sáu type scalar Rev A đã khớp profile/wire code; bounded ENUM không thuộc phạm vi hiện hành |
| FB/function | TON, TOF, R/F_TRIG; ABS/MIN/MAX/LIMIT/SEL/SQRT/conversion | Thư viện Rev A phải được decision duyệt |
| FBD | schema/golden/keyboard + `fbd/equivalence_v1.json`; `st_fbd_model.*`, `st_fbd_compile.*`; FE `features/programming/fbd/*` | Lowerer `fwsom-fbd-1.0.0`, 20 cặp equivalence và source map `pc→networkId/nodeId/portId/unit` đã có; library semantic chưa hỗ trợ vẫn reject fail-closed |
| Giới hạn | `st_limits.hpp`, `st_ir.hpp`, generated profile; parser kiểm source UTF-8/NUL/64 KiB và full consumption | Tiếp tục lấy min(client capability, target capability, policy) ở worker/consumer |
| Runtime wiring | `st_compiler_lib` không link vào `mkddc-core`; bootstrap/coordinator nạp verified artifact, symbol scan giữ parser/compiler ngoài runtime | Đúng boundary compiler non-RT; target timing/HIL thuộc lifecycle/release |

`ST_SUBSET_SPEC_MK-DDC-24_VI.md` là mô tả As-Built hỗ trợ. Khi khác Product
Spec v2.2 hoặc hồ sơ này, target dùng Product/SRS/decision đã phê duyệt; không
tự mở rộng từ code cũ.

## 3. Target ownership và pipeline

```text
Revision canonical source
  → size/UTF-8/schema guard
  → lexer/parser ST hoặc FBD schema parser
  → typed AST/graph + symbol table
  → semantic/type/unit/binding/task validation
  → deterministic normalization
  → common typed IR lowering
  → static resource/control-flow validation
  → MKDDCIR1 serializer + SHA-256
  → artifact + diagnostics + source map + build manifest
```

- BE sở hữu job, quota, cache và artifact metadata; compiler không ghi DB.
- Compiler sở hữu syntax/semantic/lowering, thuần hàm theo input manifest.
- Core loader sở hữu quyết định artifact chạy được; không parse ST/FBD.
- FE chỉ dùng schema/capability/diagnostic; không tự phán semantic authoritative.
- Build key: SHA-256 của object canonical gồm source ID/language/byte/hash,
  compiler ID/version/lowerer, profile ID/code/hash/library version và target ABI.
  Không chứa timestamp, random hay path host; cùng key được cache immutable.

## 4. Subset ST Target Rev A

### 4.1 Đơn vị chương trình

| POU | Cho phép | Interface | Ràng buộc |
|---|---|---|---|
| `PROGRAM` | có | `VAR_INPUT/OUTPUT/VAR/VAR_RETAIN` | ít nhất một, chạy theo order Task |
| `FUNCTION` local | `TARGET-PENDING` | input + một return scalar | pure; không I/O, RETAIN, FB state, recursion |
| `FUNCTION_BLOCK` local | `TARGET-PENDING` | input/output/local state | instance tĩnh; không recursion/dynamic instance |

Không cho: global mutable variable, pointer/reference, dynamic array/string,
file/network/system call, direct address `%I/%Q`, recursion, unbounded loop.
`CASE`, `FOR`, `WHILE`, `REPEAT`, array và user POU chỉ Active khi decision có
limit/WCET rule; parser hiện tại reject rõ ràng thay vì bỏ qua.

### 4.2 Type và literal

| Type | IR | Default | Range/đơn vị | Quy tắc |
|---|---|---|---|---|
| `BOOL` | 1-bit logic trong slot | `FALSE` | FALSE/TRUE | không implicit với số |
| `INT` | signed 16-bit, wire `5` | `0` | −32.768..32.767 | overflow và conversion ngoài miền fault |
| `DINT` | signed 32-bit, wire `2` | `0` | −2^31..2^31−1 | overflow fault; thay vai trò integer 32-bit As-Built cũ |
| `UINT` | unsigned 16-bit, wire `6` | `0` | 0..65.535 | literal âm/underflow/conversion ngoài miền fault |
| `REAL` | IEEE-754 binary32 | `0.0` | finite | NaN/Inf input hoặc kết quả → Program fault |
| `TIME` | signed 64-bit ns trong model, bounded khi serialize | `T#0ms` | 0..24 h Rev A | không âm; arithmetic bounded |

Không có conversion ngầm giữa các type số. Conversion chỉ qua các hàm tường minh
được khóa ở §13; narrowing, signedness, overflow và non-finite đều fail-closed.
So sánh yêu cầu cùng type sau conversion hợp lệ. Unit không bị bỏ qua:
binding có unit khác phải qua conversion block/function đã khai báo; unknown unit
không được thay bằng unitless.

### 4.3 Statement, expression và thứ tự

- Assignment, `IF/ELSIF/ELSE/END_IF`, call FB instance và expression không có
  side effect ngoài FB call được phép.
- Precedence và associativity được parser khóa; evaluation trái sang phải; không
  dựa vào locale/timezone.
- Một FB instance chỉ được gọi một lần trong một PROGRAM cycle. Read output FB
  trước call là giá trị cycle trước và phải có warning; gọi hai lần là error.
- Chia 0, overflow, non-finite, invalid timer và instruction budget vượt là
  runtime fault có source map; staging output cycle đó bị hủy.

## 5. FBD canonical model

FBD Rev A là structured editor, không phải canvas tự do. JSON canonical thuộc
Revision, thứ tự key không có nghĩa; `nodeId/portId/wireId` UUID ổn định.

**As-Built Task 201.** Authority machine-readable nằm tại
`contracts/programming/fbd_v1.schema.json`; instance/golden và SHA-256 ở
`contracts/programming/fbd/`; 11 shortcut + history 50 ở
`fbd_keyboard_commands_v1.json`. Core `validate_and_canonicalize_fbd()` từ chối
duplicate JSON key, field/type/order/endpoint/capacity sai rồi sort ổn định;
FE `model.ts`/`commands.ts` dùng cùng giới hạn và server Check vẫn là authority.
Không consumer nào được stage graph trực tiếp. `compile_fbd_source()` là biên
duy nhất: validate/canonicalize → lower typed → semantic check chung → IR chung.
Nếu có lỗi, `ok=false`, module rỗng và không được publish partial artifact.

| Entity/field | Kiểu | Bắt buộc | Invariant |
|---|---|---|---|
| `network.id/order` | UUID/u16 | có | order unique, 0..255 |
| `node.id/kind/typeRef` | UUID/enum/string | có | kind thuộc block/input/output/constant/conversion |
| `node.parameters` | typed map | tùy loại | schema library versioned; không unknown required field |
| `port.id/direction/dataType/unit` | UUID/enum/enum/string? | có | type/unit phải tương thích |
| `wire.id/from/to` | UUID/port ref | có | một driver/input; không dangling |
| `executionOrder` | u16? | derived/explicit | deterministic; conflict hoặc cycle bị reject |

Topological sort dùng `(network.order, explicit executionOrder, node UUID byte)`
làm tie-break. Cycle dữ liệu chỉ được đi qua stateful FB/delay đã khai báo; cycle
tổ hợp bị `ST-SEM-FBD-CYCLE`. Compiler sinh source map từ instruction tới
`networkId/nodeId/portId`, để cùng diagnostic envelope với ST.

## 6. Thư viện chuẩn và semantic control

| Nhóm | Rev A baseline | Quy tắc trạng thái |
|---|---|---|
| Timer | `TON`, `TOF` | elapsed từ monotonic task time; reset xác định |
| Edge | `R_TRIG`, `F_TRIG` | state per instance, cold-init FALSE |
| Numeric | `ABS`, `MIN`, `MAX`, `LIMIT`, `SQRT` | type overload hữu hạn; domain error fault |
| Selection | `SEL` | branches cùng type |
| Conversion | `INT_TO_DINT`, `INT_TO_UINT`, `DINT_TO_INT`, `DINT_TO_UINT`, `UINT_TO_INT`, `UINT_TO_DINT`, `DINT_TO_REAL`, `UINT_TO_REAL`, `REAL_TO_DINT`, `REAL_TO_UINT` | conversion ngoài miền/non-finite fault; không implicit conversion |
| Control | PID block target | anti-windup, manual/auto, bumpless theo `DDD-CTRL-PROG-001` |

Library manifest có `libraryId`, semantic version, block ID, pin schema, state
layout version, WCET class. Artifact ghi đúng library version; loader reject
unknown major. Thay semantic dù giữ pin phải tăng major và recompile Revision.

## 7. Diagnostic contract

```json
{
  "code":"ST-SEM-TYPE-001",
  "severity":"ERROR",
  "messageKey":"programming.compiler.typeMismatch",
  "location":{"programId":"uuid","line":12,"column":8,"length":4},
  "fbdLocation":null,
  "args":{"expected":"REAL","actual":"BOOL"},
  "related":[]
}
```

Namespace ổn định: `ST-LEX-*`, `ST-SYN-*`, `ST-SEM-*`, `ST-LIMIT-*`,
`FBD-SCHEMA-*`, `FBD-SEM-*`, `COMP-INTERNAL-*`. Tối đa 64 diagnostic, sort theo
program/order/location/code; đạt trần thêm đúng một `ST-LIMIT-DIAG-001`. Message
dịch ở FE; compiler không trả path host, stack hay source khác quyền.

Compiler internal crash/resource timeout trả Check failed, không artifact và
không đổi runtime. Warning không chặn trừ policy target profile nâng thành error.

## 8. Determinism, resource và timing

| Giới hạn hiện hữu tối đa | Giá trị |
|---|---:|
| Source/Program | 64 KiB |
| Token | 32.768 |
| Expression/statement depth | 32 / 16 |
| Variable/statement | 512 / 4.096 |
| Identifier/FB/RETAIN | 64 byte / 64 / 128 |
| Instruction/slot/constant/binding | 4.096 / 1.024 / 512 / 256 |
| Artifact/section | 1 MiB / 16 |

Target Profile có thể hạ các số này. Compile wall timeout đề xuất 5 s/job,
memory 128 MiB, một worker/controller và global worker theo CPU policy. Worker
chạy process riêng với CPU/memory/file limit, no network, read-only compiler,
scratch riêng; timeout kill process và xóa scratch. Không compile trong Core RT.

Determinism cấm timestamp/random/path host trong artifact; serializer sort mọi
table bằng stable ID; float constant dùng bit pattern; compiler version và build
options ghi manifest ngoài phần hash semantic nhưng nằm trong provenance.

## 9. Pseudocode compile

```text
compile(revision, target):
  assert canonical_hash(revision) == requested_hash
  enforce_size_utf8_and_schema_limits()
  units = parse_all_programs_and_fbd()
  symbols = build_project_symbol_table(units)
  reject_duplicate_or_recursive_dependency(symbols)
  typed = typecheck_units_bindings_task(units, target)
  normalized = stable_normalize(typed)
  ir = lower_to_common_ir(normalized, target.library_manifest)
  prove_bounded_control_flow_and_resources(ir)
  bytes = serialize_mkddcir1(ir)
  return artifact(bytes, sha256(bytes)), diagnostics, source_map
```

Tất cả bước fail-closed. Không “best effort” tạo artifact khi có ERROR.

## 10. Security, lỗi và recovery

Input được coi là hostile. Lexer/parser không recursion theo input không bounded;
fuzz corpus bắt buộc. Không resolve include/path/url; bundle import được unpack ở
quarantine bởi BE. Source không ghi nguyên văn vào production log. Compiler
cache được xác minh hash trước reuse; artifact đưa loader verify độc lập.

Nếu compiler mới tạo artifact khác compiler cũ cho cùng build key, rollout dừng,
ghi `COMP-DETERMINISM-001`; runtime đang chạy không bị ảnh hưởng. Rollback
compiler chỉ dùng để compile mới nếu target ABI/library còn hỗ trợ; không thay
artifact active.

## 11. Ánh xạ repository

| Trách nhiệm | As-Built | Target sửa/tạo |
|---|---|---|
| lexer/parser/AST | `apps/core/application/st/st_parser.*`, `st_program.*`, `st_fbd_model.*` | **ST subset/type ở Task 200; FBD parser/canonicalizer ở Task 201**; thêm project POU sau Task 203 |
| semantic | `st_semantic.*`, `st_io_map.*` | **sáu type/conversion/overflow đã có**; unit/library/dependency validator còn mở |
| lowering/IR | `st_compile.*`, `st_ir.*`, `st_loader.*`, `st_fbd_compile.*`, `st_artifact_manifest.*` | **ST/FBD cùng typed IR, serializer, source map và runtime semantic; manifest ngoài artifact giữ provenance đầy đủ** |
| CLI | `st_validate_main.cpp`, `st_compile_main.cpp` | **compile ST/FBD, `--source-id`, `--manifest-out`, hash đặt tên rõ và diagnostic có vị trí đã có**; worker deadline thuộc Task 205 |
| BE worker | chưa có | `apps/web-api/internal/programming/compiler` |
| contract | `contracts/programming/fbd_v1.schema.json`, `artifact_build_manifest_v1.schema.json`, `fbd_keyboard_commands_v1.json`, `fbd/{golden,manifest,equivalence_v1.json}`, `golden/build_manifest_{st,fbd}_v1.json` | **profile/library/hash/source map đã pin bằng schema + golden**; bundle source-only thuộc Task 206 |
| test | `test_st_fbd_model.cpp`, `test_st_fbd_compile.cpp`, `test_st_artifact_manifest.cpp`, `test_st_compile_cli.cpp`, `fuzz_st_fbd_model.cpp`, verifier contract | equivalence, build 100 lần, CLI thật, mutation fail-closed và source map ST/FBD đã có; target load ở gate sau |

## 12. Verification và acceptance

| Test ID | Fixture/step | Expected / evidence |
|---|---|---|
| `LANG-T-001` | compile cùng Revision 100 lần/2 host | artifact SHA-256 giống tuyệt đối |
| `LANG-T-002` | corpus valid/invalid từng grammar/type | diagnostic code/location golden 100% |
| `LANG-T-003` | FBD và ST tương đương 20 vector | cùng output/state trace từng cycle |
| `LANG-T-004` | limit−1/limit/limit+1 từng tài nguyên | hai đầu pass, +1 reject đúng code |
| `LANG-T-005` | fuzz parser/loader ≥10^7 case budget | không crash/OOM/hang; corpus lưu evidence |
| `LANG-T-006` | timeout/memory/worker crash | Check failed, không artifact, runtime giữ nguyên |
| `LANG-T-007` | unit mismatch/non-finite/div0/overflow | compile/runtime fault đúng source map; output cycle hủy |
| `LANG-T-008` | user FUNCTION/FB recursion/side effect | valid local pass; recursion/forbidden side effect reject |
| `LANG-T-009` | target board compile load song song scan | IOP deadline/scan jitter trong V&V limit |

## 13. Grammar và conversion contract cho implement

```ebnf
program       = "PROGRAM" identifier declarations statement_list "END_PROGRAM" ;
statement     = assignment | if_statement | fb_call ;
assignment    = identifier ":=" expression ";" ;
if_statement  = "IF" expression "THEN" statement_list
                { "ELSIF" expression "THEN" statement_list }
                [ "ELSE" statement_list ] "END_IF" ";" ;
expression    = or_expr ;
or_expr       = and_expr { "OR" and_expr } ;
and_expr      = compare_expr { "AND" compare_expr } ;
compare_expr  = add_expr [ ("="|"<>"|"<"|"<="|">"|">=") add_expr ] ;
add_expr      = mul_expr { ("+"|"-") mul_expr } ;
mul_expr      = unary_expr { ("*"|"/"|"MOD") unary_expr } ;
unary_expr    = ["NOT"|"-"|"+"] primary ;
```

| From → To | Implicit | Explicit | Runtime lỗi |
|---|---|---|---|
| cùng type | có | không cần | overflow/div0/non-finite |
| `DINT/UINT` → `REAL` | không | `DINT_TO_REAL`, `UINT_TO_REAL` | kết quả không hữu hạn bị fault |
| `REAL` → `DINT/UINT` | không | `REAL_TO_DINT`, `REAL_TO_UINT` | NaN/Inf/out-of-range reject; truncate về 0 |
| `INT/DINT/UINT` qua lại | không | các hàm `*_TO_*` ở §6 | âm/out-of-range reject; không wrap |
| BOOL ↔ numeric/TIME | không | không trong Rev A | compile error |
| unit A ↔ unit B | không | conversion block khai báo | unit unknown/mismatch compile error |

Lexer/parser phải ghi exact token range; semantic phase không emit message text
ad-hoc mà chỉ emit stable code + args. FBD dùng cùng symbol/type/conversion table,
không có semantic riêng ở FE.

## 14. Compatibility, rollout, blocker và ký

- `BOOL/DINT/REAL/TIME/INT/UINT` đã khóa raw code `1..6` trong schema 1; thay đổi
  width/code là breaking change và phải tăng profile/schema thay vì reinterpret.
- Schema/IR/library major không tương thích phải recompile; minor chỉ thêm optional
  feature và phải capability-negotiate.
- Rollout: schema + compiler dark → golden/fuzz → Core loader compatible → BE
  Check-only → FE editor → Commission sau DOC/implementation gate.
- Rollback compiler/FE/BE không xóa Revision/Artifact. Không downgrade loader khi
  active artifact dùng major mới; Restore LKG compatible trước.

| Blocker | Owner | Gate | Điều kiện mở |
|---|---|---|---|
| User FUNCTION/FB chưa implement | Compiler + Controls | `G2` | hoàn tất task compiler/library tương ứng và artifact evidence |
| Unit/conversion/PID semantic chưa khóa | Controls + Safety | implementation G0 | review Control Semantics và V&V |
| Target WCET chưa đo | Core + QA | release | target load/HIL evidence PASS |

| Phiên bản | Ngày | Thay đổi | Tác giả |
|---|---|---|---|
| 0.1 | 2026-08-09 | Thiết kế ST/FBD, pipeline, diagnostics, determinism, limits và source mapping | System Engineering |
| 0.2 | 2026-08-09 | Bổ sung EBNF implementable, conversion/unit matrix và diagnostic ownership; chuyển Detailed Draft chờ review | System Engineering |
| 0.3 | 2026-08-09 | Thêm mục Đọc nhanh và bảng tự kiểm `DD-01..DD-13`; nêu rõ xung đột `INT=int32` vs `INT=int16` là blocker `OD-PROG-002` | System Engineering |
| 0.4 | 2026-08-11 | Đồng bộ `TASK-PROG-200`: sáu type target/wire code, conversion tường minh, exact diagnostic span/source map, hostile-source guard và hai chiến dịch fuzz 10 triệu input; giữ FBD/local POU/worker/target ở task/gate sau | Compiler + Core Lead |
| 0.5 | 2026-08-11 | Đồng bộ `TASK-PROG-201` tại `52dfb57`: FBD schema/golden/manifest/keyboard registry, C++ canonical validator/fuzzer và FE model/reducer/component; giữ FBD→IR/equivalence/local POU/worker/target ở task/gate sau | Compiler + Core + FE Lead |
| 0.6 | 2026-08-11 | Đồng bộ `TASK-PROG-202` tại `4819901`: lowerer FBD→`StProgram` typed→IR chung, 20 cặp ST↔FBD, trace TON, fail-closed unit/library/graph lỗi và fuzz 100.000 input; chuyển artifact/source-map production sang Task 203 | Compiler + Core Lead |
| 0.7 | 2026-08-11 | Đồng bộ `TASK-PROG-203` tại `2c2bfb4`: SHA-256 canonical, manifest/build key deterministic, source map ST/FBD giữ UUID/unit, CLI ST/FBD và verifier fail-closed; chuyển Project/Revision store sang Task 204 | Compiler + Core Lead |
| 0.8 | 2026-08-13 | Đồng bộ As-Built tới P4: compiler worker sandbox Task 205 đã gọi CLI bounded; P3/P4 nạp artifact verified qua loader/coordinator nhưng `st_compiler_lib` vẫn không link vào `mkddc-core`. Giữ local POU và target WCET/HIL/Test Result còn mở. | Compiler + Core + BE |

| Vai trò | Trạng thái | Bằng chứng |
|---|---|---|
| Compiler + Controls Lead | **TASK-PROG-200..203 + worker source DONE; local POU/target còn mở** | `2c2bfb4`, `e8c289e`, `10d9ad6`, `EV-PROG-G2-200..203` |
| Core + FE + QA + Security | **WAIVED FOR IMPLEMENTATION; evidence độc lập còn mở** | `AUTH-PROG-2026-08-11-03` |
| System Architect + Product Owner | **APPROVED FOR IMPLEMENTATION** | `AUTH-PROG-2026-08-11-03`; OD-PROG-002/005/006 đã DECIDED |

Tự kiểm `DD-01..DD-13`:

| Mã | Kết quả | Mục trong file / lý do |
|---|---|---|
| `DD-01` Metadata | PASS | Bảng đầu file; revision history và bảng ký §14 |
| `DD-02` Mục tiêu/phạm vi | PASS | §1 mục tiêu, actor, tiêu chí thành công; §4–§5 giới hạn tập con ST/FBD |
| `DD-03` As-Built | PASS | §2 bảng As-Built dẫn đúng `st_parser.cpp`, `st_semantic.cpp`, `st_compile.cpp`, CLI, `st_limits.hpp`, `st_ir.hpp` và ghi rõ `st_compiler_lib` **chưa link** vào `mkddc-core` |
| `DD-04` Target ownership | PASS | §3 pipeline và ownership: compiler chạy ngoài RT, Core chỉ nhận IR đã verify |
| `DD-05` Data từng field | PASS | §4.2 type/literal, §5 mô hình FBD canonical, §13 grammar và hợp đồng conversion |
| `DD-06` Interface | PASS | §7 hợp đồng diagnostic (vị trí nguồn, mã, mức) là interface chính với BE/FE; §3 giao diện CLI/thư viện |
| `DD-07` Determinism/resource/timing | PASS | §8 xác định tính lặp lại, tài nguyên và thời gian; §9 pseudocode biên dịch |
| `DD-08` Operation flow | N/A tại file này | Không có mặt người dùng trực tiếp; trải nghiệm soạn thảo thuộc UI/UX Design. Đầu ra hướng người dùng duy nhất là diagnostic ở §7 |
| `DD-09` Error/safety/security | PASS | §10 lỗi, security và recovery; quy tắc không parser trên đường RT chống `RSK-PROG-006` |
| `DD-10` Repository mapping | PASS | §11 file/thư viện/CLI cần tách và tạo |
| `DD-11` Verification | PASS | §12 gắn `VS-PROG-003/005/006` với kỳ vọng định lượng (tương đương 100% ST↔FBD, fuzz ≥10⁷ ca, 0 crash/OOM) |
| `DD-12` Compatibility/rollout/rollback | PASS | §14 tương thích và rollout, gồm khóa profile compiler |
| `DD-13` Trace/risk/decision/sign-off | PASS cho implementation | OD-PROG-002/005/006 đã DECIDED; source/evidence Task 200 được trace. FBD/local POU/target evidence còn là task/gate kỹ thuật, không phải decision blocker |

Thiết kế đủ quyền implementation. `TASK-PROG-200..203` đã implement ST/type,
FBD canonical, lowering/equivalence và artifact/source-map provenance trên host;
local POU và runtime target vẫn chưa được tuyên bố hoàn tất.
