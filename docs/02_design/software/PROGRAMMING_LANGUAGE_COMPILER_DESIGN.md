# Thiết kế ngôn ngữ và compiler Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID | `DDD-LANG-PROG-001` |
| Phiên bản | 0.3 |
| Trạng thái | **M3 — Review Ready** — DD-01..13 đủ; bề rộng kiểu số chờ OD-PROG-002 |
| Ngày | 2026-08-09 |
| Chủ quản | Compiler Lead + Controls Lead |
| Người review | Core Lead, FE Lead, Verification Lead, Security Lead |
| Người phê duyệt | System Architect + Product Owner |
| Nguồn | `SRS-PROG-001`, Product Spec v2.2, `ARCH-PROG-001`, `PROG-OD-001` |
| Phạm vi | Target Rev A ST/FBD → common typed IR; compiler chạy ngoài RT |

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Chốt **viết được gì trong ST và FBD**, biên dịch ra sao, và lỗi biên dịch trông như thế nào. Định nghĩa tập con ngôn ngữ, hệ kiểu, thư viện block, và **một IR chung** để ST và FBD cho ra cùng ngữ nghĩa. |
| 2. Ai phải đọc file này? | Compiler và Controls (chủ quản); Core đọc để biết IR nào phải chạy được; FE đọc §7 (hợp đồng diagnostic) để hiển thị lỗi đúng dòng/đúng node; QA đọc §12. |
| 3. Hệ thống hiện tại đang có gì? | Đã có thật: `apps/core/application/st/st_parser.cpp`, `st_semantic.cpp`, `st_compile.cpp`, hai CLI `mkddc-st-validate` và `mkddc-st-compile`, các FB `TON/TOF/R_TRIG/F_TRIG` và hàm `ABS/MIN/MAX/LIMIT/SEL/SQRT`. Nhưng: chỉ hỗ trợ **một** `PROGRAM`, kiểu `INT` đang là `int32`, **FBD chưa có compiler/schema**, và `st_compiler_lib` **chưa link vào** `mkddc-core`. |
| 4. Thiết kế mới thay đổi điều gì? | Tách compiler thành thư viện chạy **ngoài** đường thời gian thực; thêm `FUNCTION`/`FUNCTION_BLOCK` cục bộ; thêm mô hình FBD canonical đổ về cùng IR với ST; chuẩn hóa diagnostic có vị trí nguồn. Không đổi hành vi đã được test của parser hiện có. |
| 5. Team phải sửa module/contract nào? | §11. Compiler: tách `st_compiler_lib` khỏi đường RT; BE: gọi CLI/API có giới hạn từ worker, **không bao giờ gọi trong scan**; FE: dùng hợp đồng diagnostic §7. Giới hạn lấy `min(khả năng client, khả năng target, policy)`. |
| 6. Điều gì còn bị chặn? | Nặng nhất là `OD-PROG-002`: As-Built dùng `INT=int32` còn phương án IEC-aligned là `INT=int16`. Chưa chốt thì **không được** khóa encoding IR hay Point mapping. Thư viện Rev A (`OD-PROG-005`) và ngữ nghĩa FBD (`OD-PROG-006`) cũng chưa ký. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | §12: `VS-PROG-005` (20 cặp ST/FBD tương đương phải cho cùng IR và cùng vết trạng thái), `VS-PROG-006` (biên −1/biên/+1 và fuzz ≥10⁷ ca, không crash/OOM), `VS-PROG-003` (từ chối global/native/đệ quy). `NOT RUN`. |

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
| Parser/semantic/compiler | `apps/core/application/st/st_parser.cpp`, `st_semantic.cpp`, `st_compile.cpp` | Tách thành thư viện compiler non-RT; giữ behavior đã test |
| CLI | `mkddc-st-validate`, `mkddc-st-compile` từ `apps/core/CMakeLists.txt` | BE worker gọi API/CLI bounded, không gọi trong scan |
| ST unit | `PROGRAM` duy nhất; assignment, `IF/ELSIF/ELSE`, FB call | Product v2.2 yêu cầu thêm local `FUNCTION`/`FUNCTION_BLOCK`; đang `TARGET-PENDING` |
| Type | `BOOL`, `INT=int32`, `REAL`, `TIME`; VAR input/output/local/retain | Product yêu cầu signed/unsigned subset + bounded ENUM; exact name/width còn `OD-PROG-002` |
| FB/function | TON, TOF, R/F_TRIG; ABS/MIN/MAX/LIMIT/SEL/SQRT/conversion | Thư viện Rev A phải được decision duyệt |
| FBD | Chưa có compiler/schema production | Structured editor → canonical graph → common IR |
| Giới hạn | `st_limits.hpp` và `st_ir.hpp` | Lấy min(client capability, target capability, policy) |
| Runtime wiring | `st_compiler_lib` không link vào `mkddc-core`; bootstrap chưa cấp scheduler | Đúng boundary compiler non-RT; runtime wiring thuộc lifecycle |

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
- Build key: SHA-256 của canonical Revision, compiler ID/version, target ABI,
  profile, library version và decision baseline. Cùng key được cache immutable.

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
| `INT` As-Built | signed 32-bit | `0` | −2^31..2^31−1 | không được gọi là IEC `INT` Target trước `OD-PROG-002`; overflow fault |
| Integer Target | `TARGET-PENDING` | `0` | phương án `INT:int16`, `DINT:int32`, `UINT:uint16`, bounded `ENUM/uINT` | phải khóa name/width/IR raw code/Point mapping/migration |
| `REAL` | IEEE-754 binary32 | `0.0` | finite | NaN/Inf input hoặc kết quả → Program fault |
| `TIME` | signed 64-bit ns trong model, bounded khi serialize | `T#0ms` | 0..24 h Rev A | không âm; arithmetic bounded |

As-Built chỉ implicit `INT32 → REAL`; Target conversion matrix phải được duyệt
cùng `OD-PROG-002`, không được suy narrowing/signedness. Mọi conversion khác dùng
function rõ ràng. So sánh yêu cầu cùng type sau conversion hợp lệ. Unit không bị bỏ qua:
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
| Conversion | As-Built `INT_TO_REAL`, `REAL_TO_INT`; Target thêm signed/unsigned/ENUM theo decision | narrowing/rounding/overflow cần decision và diagnostic |
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
| lexer/parser/AST | `apps/core/application/st/st_parser.*`, `st_program.*` | tách library reusable; thêm project POU và FBD parser |
| semantic | `st_semantic.*`, `st_io_map.*` | type/unit/library/dependency validator |
| lowering/IR | `st_compile.*`, `st_ir.*` | common ST/FBD IR + deterministic serializer/source map |
| CLI | `st_validate_main.cpp`, `st_compile_main.cpp` | JSON result stable + worker deadline |
| BE worker | chưa có | `apps/web-api/internal/programming/compiler` |
| contract | chưa có FBD/library schema | `contracts/programming/{fbd,library,diagnostic}` |
| test | `apps/core/application/st/tests`, `fuzz/` | golden cross-language, property/fuzz, target load |

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
| integer As-Built → REAL | có hiện hành, Target cần phê duyệt | `INT_TO_REAL` | mất precision phải diagnostic theo profile |
| REAL → integer | không | `REAL_TO_*` | NaN/Inf/out-of-range reject, rounding policy quyết định |
| signed ↔ unsigned/ENUM | không | function được profile duyệt | âm/out-of-range/enum unknown reject |
| BOOL ↔ numeric/TIME | không | không trong Rev A | compile error |
| unit A ↔ unit B | không | conversion block khai báo | unit unknown/mismatch compile error |

Lexer/parser phải ghi exact token range; semantic phase không emit message text
ad-hoc mà chỉ emit stable code + args. FBD dùng cùng symbol/type/conversion table,
không có semantic riêng ở FE.

## 14. Compatibility, rollout, blocker và ký

- Thêm DINT/UINT/ENUM cần compiler profile/type raw code và compatibility decision;
  nếu schema 1 không biểu diễn được thì tăng schema/magic thay vì reinterpret code.
- Schema/IR/library major không tương thích phải recompile; minor chỉ thêm optional
  feature và phải capability-negotiate.
- Rollout: schema + compiler dark → golden/fuzz → Core loader compatible → BE
  Check-only → FE editor → Commission sau DOC/implementation gate.
- Rollback compiler/FE/BE không xóa Revision/Artifact. Không downgrade loader khi
  active artifact dùng major mới; Restore LKG compatible trước.

| Blocker | Owner | Gate | Điều kiện mở |
|---|---|---|---|
| User FUNCTION/FB, FBD capacity và library chưa duyệt | Product + Controls | `DOC-G2` approval | ký các decision tương ứng trong `PROG-OD-001` |
| Unit/conversion/PID semantic chưa khóa | Controls + Safety | implementation G0 | review Control Semantics và V&V |
| Target WCET chưa đo | Core + QA | release | target load/HIL evidence PASS |

| Phiên bản | Ngày | Thay đổi | Tác giả |
|---|---|---|---|
| 0.1 | 2026-08-09 | Thiết kế ST/FBD, pipeline, diagnostics, determinism, limits và source mapping | System Engineering |
| 0.2 | 2026-08-09 | Bổ sung EBNF implementable, conversion/unit matrix và diagnostic ownership; chuyển Detailed Draft chờ review | System Engineering |
| 0.3 | 2026-08-09 | Thêm mục Đọc nhanh và bảng tự kiểm `DD-01..DD-13`; nêu rõ xung đột `INT=int32` vs `INT=int16` là blocker `OD-PROG-002` | System Engineering |

| Vai trò | Trạng thái | Bằng chứng |
|---|---|---|
| Compiler + Controls Lead | Chờ review | — |
| Core + FE + QA + Security | Chờ review | — |
| System Architect + Product Owner | **BLOCKED — chưa phê duyệt** | `PROG-OD-001` |

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
| `DD-13` Trace/risk/decision/sign-off | **BLOCKED** | Trace/risk đủ, nhưng bề rộng kiểu số chưa chốt. Owner: Product + Runtime Architect. Ảnh hưởng: As-Built dùng `INT=int32` còn phương án IEC-aligned là `INT=int16`; chưa chốt thì **không được khóa encoding IR hoặc Point mapping**, và mọi artifact sinh ra có nguy cơ phải build lại. Gate: `DOC-G2`. Điều kiện mở: đóng `OD-PROG-002` (ma trận type/bit-width/Point/IR + migration), `OD-PROG-005` (thư viện Rev A), `OD-PROG-006` (ngữ nghĩa FBD) |

Một `BLOCKED`, đủ bốn trường. Implementation/test/runtime vẫn `NOT IMPLEMENTED/NOT TESTED`.
