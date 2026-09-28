# Thiết kế ngôn ngữ và compiler Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID | `DDD-LANG-PROG-001` |
| Phiên bản | 1.3 |
| Trạng thái | **Active — IMPLEMENT_READY; user POU/library semantics đã khóa** |
| Ngày | 2026-09-28 |
| Chủ quản | Compiler Lead + Controls Lead |
| Người review | Core Lead, FE Lead, Verification Lead, Security Lead |
| Người phê duyệt | System Architect + Product Owner |
| Nguồn | `SRS-PROG-001` v1.0, Product v3.0, ADR-050, **ADR-054**, `DDD-SW-PROG-UNIFIED-001` |
| Phạm vi | ST/FBD PROGRAM/FUNCTION/FUNCTION_BLOCK → common typed IR; compiler ngoài RT |

> **Normative update.** Unified DDD §4–§7 là authority cho Product Target. Review discipline được waive khỏi entry theo
> `AUTH-PROG-2026-08-20-04`; target evidence vẫn bắt buộc cho release.

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Chốt **viết được gì trong ST và FBD**, biên dịch ra sao, và lỗi biên dịch trông như thế nào. Định nghĩa tập con ngôn ngữ, hệ kiểu, thư viện block, và **một IR chung** để ST và FBD cho ra cùng ngữ nghĩa. |
| 2. Ai phải đọc file này? | Compiler và Controls (chủ quản); Core đọc để biết IR nào phải chạy được; FE đọc §7 (hợp đồng diagnostic) để hiển thị lỗi đúng dòng/đúng node; QA đọc §12. |
| 3. Hệ thống hiện tại đang có gì? | Baseline có ST/FBD typed IR và package v2. Corrective source current-worktree đã thêm parser/registry/runtime user FUNCTION/FB, signal intrinsic và manifest POU/library/signal; chưa merge/full-gate nên chưa là implementation closure evidence. |
| 4. Thiết kế mới thay đổi điều gì? | IR đơn giữ `MKDDCIR1/schema 1`, compiler `fwsom-st-1.2.0`; `SIGNAL_READ=0x71`, `SIGNAL_PUBLISH=0x72`, signal-ref section `0x0009`. Container nhiều POU/Program là `MKDDCIR2/layout 2`; hai format không được gọi lẫn nhau. |
| 5. Team phải sửa module/contract nào? | §11. Compile CLI nhận `--pou-manifest`, `--library-lock`, `--signal-manifest`; package CLI nhận POU table/library lock. BE sinh manifest authoritative; Core chỉ nạp IR/package đã verify, không parse source trên RT path. |
| 6. Điều gì còn bị chặn? | Không còn decision blocker. Current corrective source phải merge và qua compiler/package/runtime/E2E gate; target load/WCET/soak và formal Test Result vẫn mở. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | `EV-PROG-G2-200..203`: Task 203 có build lặp 100 lần, targeted `35/35`, manifest mutation `7/7`, CTest `927/927` và Go/FE regression PASS. Đây là evidence host; `VS-PROG-003/005/006/023` chưa PASS vì worker/target và independent review chưa đủ. |

Lưu ý thẩm quyền: `ST_SUBSET_SPEC_MK-DDC-24_VI.md` chỉ **mô tả cái đang có**. Khi
nó khác Product Spec v3.0 hoặc file này, lấy Product/SRS/decision đã duyệt làm
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

Ngoài phạm vi Product hiện hành: online source edit trong Core, JIT/native code, thư viện bên
thứ ba, pointer/dynamic allocation/recursion, multi-controller distributed task.

## 2. Authority và As-Built có dẫn chứng

| Nội dung | As-Built 2026-08-09 | Target authority / gap |
|---|---|---|
| Parser/semantic/compiler | `apps/core/application/st/st_parser.cpp`, `st_semantic.cpp`, `st_compile.cpp`, `st_pou_registry.*`, `st_fbd_model.*`, `st_fbd_compile.*` | Current worktree dùng chung typed POU registry/call graph/lowering cho ST và FBD; source chưa merge nên trace `I` chưa nâng |
| CLI | `mkddc-st-validate`, `mkddc-st-compile`, `mkddc-st-package` từ `apps/core/CMakeLists.txt` | Compile nhận POU/library/signal manifest; package nhận POU table/library lock; mọi file đọc trước worker sandbox, bounded và không chạy trong scan |
| ST unit | Baseline `PROGRAM`; current worktree parse `PROGRAM/FUNCTION/FUNCTION_BLOCK` | FUNCTION pure; FB instance state/private layout; recursion/kind/arity fail closed bằng stable diagnostic |
| Type | `BOOL`, `INT=int16`, `DINT=int32`, `UINT=uint16`, `REAL=float32`, `TIME=int64`; VAR input/output/local/retain | Sáu type scalar là baseline; bounded ENUM không thuộc phạm vi hiện hành |
| FB/function | TON, TOF, R/F_TRIG; ABS/MIN/MAX/LIMIT/SEL/SQRT/conversion | Built-in registry + user POU registry được sinh từ nguồn chung theo T59-003 |
| FBD | schema/golden/keyboard + `fbd/equivalence_v1.json`; `st_fbd_model.*`, `st_fbd_compile.*`; FE `features/programming/fbd/*` | FBD schema v1 dual-compatible; lowerer `fwsom-fbd-1.1.0` thêm `USER_CALL`, `SIGNAL_READ` và `SIGNAL_PUBLISH`, vẫn giữ source map và reject unknown kind |
| Giới hạn | `st_limits.hpp`, `st_ir.hpp`, generated profile; parser kiểm source UTF-8/NUL/64 KiB và full consumption | Tiếp tục lấy min(client capability, target capability, policy) ở worker/consumer |
| Runtime wiring | `st_compiler_lib` không link vào `mkddc-core`; bootstrap/coordinator nạp verified artifact, symbol scan giữ parser/compiler ngoài runtime | Đúng boundary compiler non-RT; target timing/HIL thuộc lifecycle/release |

`ST_SUBSET_SPEC_MK-DDC-24_VI.md` là mô tả As-Built hỗ trợ. Khi khác Product
Spec v3.0 hoặc hồ sơ này, target dùng Product/SRS/decision đã phê duyệt; không
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

## 4. Subset ST Product Target

### 4.1 Đơn vị chương trình

| POU | Cho phép | Interface | Ràng buộc |
|---|---|---|---|
| `PROGRAM` | bắt buộc | `VAR_INPUT/OUTPUT/VAR/VAR_RETAIN` | 1..32/package; sở hữu cycle/lifecycle/mapping/signal/output |
| `FUNCTION` | bắt buộc | input + một return scalar | pure; không I/O, RETAIN, FB state, recursion |
| `FUNCTION_BLOCK` | bắt buộc | input/output/local/private state | instance tĩnh; state owner Program; không recursion/dynamic instance |

Không cho: global mutable variable, pointer/reference, dynamic array/string,
file/network/system call, direct address `%I/%Q`, recursion, unbounded loop.
`FOR`, `WHILE`, `REPEAT` và dynamic array vẫn ngoài subset vì không có bounded
WCET rule; parser giữ chỗ từ khoá và reject rõ. `CASE` **thuộc subset** — xem
§4.3 và `ADR-054`. User POU đã Active theo ADR-050.

### 4.2 Type và literal

| Type | IR | Default | Range/đơn vị | Quy tắc |
|---|---|---|---|---|
| `BOOL` | 1-bit logic trong slot | `FALSE` | FALSE/TRUE | không implicit với số |
| `INT` | signed 16-bit, wire `5` | `0` | −32.768..32.767 | overflow và conversion ngoài miền fault |
| `DINT` | signed 32-bit, wire `2` | `0` | −2^31..2^31−1 | overflow fault; thay vai trò integer 32-bit As-Built cũ |
| `UINT` | unsigned 16-bit, wire `6` | `0` | 0..65.535 | literal âm/underflow/conversion ngoài miền fault |
| `REAL` | IEEE-754 binary32 | `0.0` | finite | NaN/Inf input hoặc kết quả → Program fault |
| `TIME` | signed 64-bit ns trong model, bounded khi serialize | `T#0ms` | 0..24 h | không âm; arithmetic bounded |

Không có conversion ngầm giữa các type số. Conversion chỉ qua các hàm tường minh
được khóa ở §13; narrowing, signedness, overflow và non-finite đều fail-closed.
So sánh yêu cầu cùng type sau conversion hợp lệ. Unit không bị bỏ qua:
binding có unit khác phải qua conversion block/function đã khai báo; unknown unit
không được thay bằng unitless.

### 4.3 Statement, expression và thứ tự

- Assignment, `IF/ELSIF/ELSE/END_IF`, `CASE/OF/ELSE/END_CASE`, call FB instance
  và expression không có side effect ngoài FB call được phép.
- **Luật WCET của `CASE`** (`ADR-054`): compiler **khử đường** `CASE` về đúng cây
  `IF/ELSIF/ELSE` sẵn có (`st_parser.cpp` `parse_case()`), nên nó không thêm opcode
  IR nào và không mở một đường thực thi thứ hai. Số nhánh là hữu hạn và biết tại
  compile time; **số nhãn** (mỗi nhãn là một giá trị hoặc một dải, nở thành tối đa
  hai phép so biên) bị chặn trên bởi `kMaxStatements` (§8), nên độ rộng của một dải
  không tốn thêm gì — dải rộng như `16..32767:` hợp lệ (U-11,
  `REC-DDC-FIELD-USE-20260927`); vượt trần thì báo `CASE has too many labels`.
  Compiler cũng từ chối nhãn trùng, dải rỗng, dải chồng nhau cùng nhãn không phải
  hằng nguyên. Vì vậy
  `CASE` giữ nguyên tính chặn trên của một scan — khác `FOR`/`WHILE`/`REPEAT`, nơi
  số vòng phụ thuộc dữ liệu chạy.
- Precedence và associativity được parser khóa; evaluation trái sang phải; không
  dựa vào locale/timezone.
- Một FB instance chỉ được gọi một lần trong một PROGRAM cycle. Read output FB
  trước call là giá trị cycle trước và phải có warning; gọi hai lần là error.
- Chia 0, overflow, non-finite, invalid timer và instruction budget vượt là
  runtime fault có source map; staging output cycle đó bị hủy.
- `SIGNAL_READ(name)` trả typed value theo signal manifest và stale policy; tên
  không tồn tại/type lệch/consumer chưa khai báo bị reject ở Check. Khi policy
  `WAIT` chưa có snapshot hợp lệ, Program chờ và không publish output cycle đó.
- `SIGNAL_PUBLISH(name, value)` chỉ hợp lệ với signal do Program hiện tại sở hữu;
  type/unit phải exact. Publish được stage trong cycle và chỉ xuất hiện ở signal
  bank committed tại boundary; lỗi Program hủy toàn bộ publish đang chờ.

## 5. FBD canonical model

FBD Product hiện hành là structured editor, không phải canvas tự do. JSON canonical thuộc
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
| `node.id/kind/typeRef` | UUID/enum/string | có | gồm block/input/output/constant/conversion/`SIGNAL_READ`/`SIGNAL_PUBLISH`; unknown reject |
| `node.parameters` | typed map | tùy loại | node signal bắt buộc `parameters.signal`; library node dùng schema versioned |
| `port.id/direction/dataType/unit` | UUID/enum/enum/string? | có | type/unit phải tương thích |
| `wire.id/from/to` | UUID/port ref | có | một driver/input; không dangling |
| `executionOrder` | u16? | derived/explicit | deterministic; conflict hoặc cycle bị reject |

Topological sort dùng `(network.order, explicit executionOrder, node UUID byte)`
làm tie-break. Cycle dữ liệu chỉ được đi qua stateful FB/delay đã khai báo; cycle
tổ hợp bị `FBD-SEM-ORDER-001` (validator FBD phía FE — **không** phải pha
semantic của ST; bản trước ghi "ST-SEM-FBD-CYCLE", một mã không tồn tại ở đâu
cả, xem §7). Compiler sinh source map từ instruction tới
`networkId/nodeId/portId`, để cùng diagnostic envelope với ST.

## 6. Thư viện chuẩn và semantic control

| Nhóm | Product baseline | Quy tắc trạng thái |
|---|---|---|
| Timer | `TON`, `TOF` | elapsed từ monotonic task time; reset xác định |
| Edge | `R_TRIG`, `F_TRIG` | state per instance, cold-init FALSE |
| Numeric | `ABS`, `MIN`, `MAX`, `LIMIT`, `SQRT` | type overload hữu hạn; domain error fault |
| Selection | `SEL` | branches cùng type |
| Conversion | `INT_TO_DINT`, `INT_TO_UINT`, `DINT_TO_INT`, `DINT_TO_UINT`, `UINT_TO_INT`, `UINT_TO_DINT`, `DINT_TO_REAL`, `UINT_TO_REAL`, `REAL_TO_DINT`, `REAL_TO_UINT` | conversion ngoài miền/non-finite fault; không implicit conversion |
| Control | `PID` — **Implemented** (`StFbType::PID`, `st_program.cpp`), chưa "target" | 8 input (`SP,PV,KP,KI,KD,OUT_MIN,OUT_MAX,ACTUAL`)/2 output (`OUT,TRACKING`); anti-windup back-calculation, `ACTUAL` là read-back thật qua Point Table (không tự đọc `PriorityResolver`); xem `DDD-CTRL-PROG-001` §7. Code chạy được nhưng semantics **chưa qua Controls+Safety review chính thức** — xem blocker §14 "Unit/conversion/PID semantic chưa khóa"; không dùng cho logic sản xuất tới khi review đóng |

Library manifest có `libraryId`, semantic version, block ID, pin schema, state
layout version, WCET class. Artifact ghi đúng library version; loader reject
unknown major. Thay semantic dù giữ pin phải tăng major và recompile Revision.

## 7. Diagnostic contract

> **Đính chính 2026-09-02 (`ISS-STED-10` / `F-STED-012`).** Bản trước của mục
> này công bố năm mã và namespace **không tồn tại ở bất kỳ đâu ngoài chính tài
> liệu này**: "ST-LIMIT-\*", "ST-LIMIT-DIAG-001", "COMP-INTERNAL-\*", ví dụ
> "ST-SEM-TYPE-001", và — ở §6 — "ST-SEM-FBD-CYCLE". Nó cũng bỏ sót **tám**
> namespace có thật, và đặt mã chi tiết vào **sai trường** của payload.
>
> *(Năm chuỗi trên cố ý viết trong ngoặc kép chứ không trong dấu nháy ngược.
> Trong tài liệu này **dấu nháy ngược nghĩa là "mã có thật"**, và cổng
> `diagnostic_code_refs` thi hành đúng quy ước đó.)*
>
> Loại sai này đắt hơn một lỗi chính tả: người vận hành đọc runbook rồi `grep`
> log tìm "ST-LIMIT-DIAG-001" sẽ **không ra gì** và kết luận sai rằng sự cố
> không xảy ra; người viết client đọc ví dụ rồi so `code` với `ST-SEM-*` sẽ
> **không bao giờ khớp**, vì `code` mang mã công khai còn mã chi tiết nằm ở
> `detailCode`.
>
> **Hướng đã chọn: sửa tài liệu, KHÔNG đổi mã lỗi.** Mã đã đi vào
> `contracts/programming/error_catalog_v1.json`, `errors_generated.go`,
> `errors.ts` và log hiện trường; đổi mã là đổi một hợp đồng công khai và làm
> hỏng mọi runbook đang dùng. Hướng ngược lại (đổi code theo tài liệu) **không**
> được chọn và cũng không được thi hành một phần — nó cần kế hoạch di trú riêng
> cho error catalog + Go + FE + tài liệu vận hành.

### 7.1 Hình dạng payload

Ví dụ dưới là **payload thật** do `checks.go` phát, không phải mã minh hoạ:

```json
{
  "code":"PRG-ERR-CHECK-001",
  "detailCode":"ST-SEM-002",
  "severity":"ERROR",
  "messageKey":"programming.error.check",
  "location":{
    "programId":"uuid","line":12,"column":8,"length":4,
    "revisionId":"uuid","pouId":"P_ahu",
    "sourceSha256":"<64 hex>","stLanguageProfileVersion":"1.0.0"
  },
  "args":{"line":12,"column":8,"length":4},
  "related":[]
}
```

**Hai trường mã, không phải một.** `code` là **mã công khai** (`PRG-ERR-*`) —
thứ quyết định HTTP status, `retryable` và `keepsRunningRevision`. `detailCode`
là **mã chi tiết của component** (`ST-*`) — thứ chỉ ra chính xác chỗ hỏng. Ánh
xạ chi tiết → công khai nằm ở `componentDetails` của error catalog, không suy
được từ tên. Gộp hai trường lại sẽ mất một trong hai: hoặc client không biết
phải xử lý lỗi thế nào, hoặc người vận hành không biết hỏng ở đâu.

Bốn trường provenance trong `location` (`revisionId`, `pouId`, `sourceSha256`,
`stLanguageProfileVersion`) là bắt buộc theo `ISS-STED-18`: không có chúng thì
FE không phân biệt được diagnostic còn nói về buffer đang gõ hay đã cũ, và việc
gạch lỗi sẽ trỏ vào dòng **không còn** là dòng sinh ra lỗi đó.

### 7.2 Namespace mã chi tiết — bảng thật

Ba nguồn khác nhau, và chúng **không** cùng một hình dạng hậu tố:

| Nguồn | Namespace | Hậu tố | Số mã |
|---|---|---|---:|
| Compiler (`st_diagnostic.hpp`) | `ST-LEX-*` | số | 3 |
| | `ST-SYN-*` | số | 2 |
| | `ST-SEM-*` | số | 14 |
| | `ST-LIM-*` | số | 9 |
| | `ST-WARN-*` | số | 4 |
| | `ST-RT-*` | số | 13 |
| | `ST-IOMAP-*` | số | 8 |
| | `ST-LIB-*` | số | 3 |
| | `ST-POU-*` | số | 5 |
| | `ST-SIG-*` | số | 5 |
| | `ST-OWN-*` | số | 1 |
| | `ST-PID-*` | số | 1 |
| CLI/worker (BE) | `ST-CLI-*` | **chữ** (`ST-CLI-SANDBOX`) | 12 |
| | `ST-WORKER-*` | **chữ** (`ST-WORKER-TIMEOUT`) | 2 |
| Validator FBD (FE) | `FBD-SCHEMA-*` | chữ **+ số** (`FBD-SCHEMA-ROOT-001`) | 3 |
| | `FBD-SEM-*` | chữ **+ số** (`FBD-SEM-TYPE-REF-001`) | 14 |
| | `FBD-LIMIT-*` | chữ **+ số** (`FBD-LIMIT-BLOCK-001`) | 4 |

Ba ghi chú mà bảng không nói hết:

1. **`ST-RT-*` là fault lúc CHẠY, không phải diagnostic lúc biên dịch.** Nó nằm
   chung namespace vì cùng một catalog, nhưng không bao giờ xuất hiện trong kết
   quả Check.
2. **`FBD-*` KHÔNG nằm trong error catalog.** Chúng do validator phía FE
   (`apps/web-ui/src/features/programming/fbd/model.ts`) phát và không đi qua
   `componentDetails`. Đây là khác biệt về nguồn, không phải thiếu sót — nhưng
   ai viết công cụ đọc log cần biết để không tìm chúng trong catalog.
3. **Ba hình dạng hậu tố, không phải một.** `ST-CLI-*`/`ST-WORKER-*` dùng hậu
   tố **chữ** (`ST-CLI-SANDBOX`); họ `FBD-*` dùng **chữ rồi số**
   (`FBD-SEM-SIGNAL-PUBLISH-COUNT-001`); phần còn lại dùng **số** thuần. Một
   biểu thức `ST-[A-Z]+-\d{3}` bỏ lọt cả 14 mã CLI/worker, và
   `[A-Z]+-[A-Z]+-\d{3}` bỏ lọt phần lớn họ `FBD-*`.

### 7.3 Trần và cắt bớt

Tối đa **64** diagnostic, sort ổn định theo `program/order/location/code`; chạm
trần thì thêm **đúng một `ST-LIM-006`** ở cuối danh sách. Message dịch ở FE;
compiler không trả path host, stack hay source khác quyền.

Crash hoặc timeout của worker trả Check failed, **không** artifact và **không**
đổi runtime; mã chi tiết là `ST-WORKER-CRASH`/`ST-WORKER-TIMEOUT`, cùng ánh xạ
về mã công khai `PRG-ERR-UNAVAILABLE-001`. Warning không chặn, trừ khi policy
của target profile nâng thành error.

**Chống trôi.** Mọi mã diagnostic được dẫn trong tài liệu thiết kế đều bị
`scripts/verify_diagnostic_code_refs.py` (ctest `diagnostic_code_refs`) đối
chiếu với error catalog và validator FBD; mã không tồn tại làm **đỏ**. Cổng này
ra đời vì chính mục §7 này đã công bố bốn mã không có thật suốt nhiều revision
mà không ai phát hiện.

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
  units = parse_all_programs_functions_fb_and_fbd()
  load_and_verify(pou_manifest, library_lock, signal_manifest)
  symbols = build_project_symbol_table(units)
  reject_duplicate_or_recursive_dependency(symbols)
  typed = typecheck_units_bindings_task(units, target)
  normalized = stable_normalize(typed)
  ir = lower_to_common_ir(normalized, library_lock, signal_manifest)
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

Nếu compiler mới tạo artifact khác compiler cũ cho cùng build key, rollout dừng
và runtime đang chạy không bị ảnh hưởng.

> **Đính chính 2026-09-02 (`ISS-STED-10`).** Bản trước ghi *"ghi
> COMP-DETERMINISM-001"*. Mã đó **không tồn tại** trong error catalog và cũng
> không có mã nào thay thế: kiểm tra rebuild-determinism hiện chạy ở tầng
> golden test (`build_manifest_{st,fbd}_v1.json`), **chưa** có mã lỗi runtime
> nào cho nó. Ghi ra một mã chưa hiện thực hoá nguy hiểm hơn là để trống, vì nó
> tạo cảm giác đã có đường phát hiện. Rollback
compiler chỉ dùng để compile mới nếu target ABI/library còn hỗ trợ; không thay
artifact active.

## 11. Ánh xạ repository

| Trách nhiệm | As-Built | Target sửa/tạo |
|---|---|---|
| lexer/parser/AST | `apps/core/application/st/st_parser.*`, `st_program.*`, `st_pou_registry.*`, `st_fbd_model.*` | Current worktree: ba POU kind, canonical signature, call graph và FB layout; chờ merge |
| semantic | `st_semantic.*`, `st_io_map.*`, `st_pou_registry.*` | purity/recursion/kind/arity/library DAG/signal publisher-consumer; unknown fail closed |
| lowering/IR | `st_compile.*`, `st_ir.*`, `st_loader.*`, `st_fbd_compile.*`, `st_artifact_manifest.*` | IR `MKDDCIR1/schema 1`; opcode signal `0x71/0x72`; `SEC_SIGNAL_REFS=0x0009`; ST/FBD dùng chung `USER_CALL` |
| CLI | `st_validate_main.cpp`, `st_compile_main.cpp`, `st_package_main.cpp` | compile: `--pou-manifest`, `--library-lock`, `--signal-manifest`; package: `--pou-table`, `--library-lock`; mọi manifest được hash vào provenance |
| BE worker | `apps/web-api/internal/programming/compiler/{runner,packager}.go` | BE tạo input từ immutable Revision, không tin metadata FE; current corrective source chưa merge |
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
pou           = program | function | function_block ;
program       = "PROGRAM" identifier declarations statement_list "END_PROGRAM" ;
function      = "FUNCTION" identifier ":" scalar_type declarations statement_list "END_FUNCTION" ;
function_block= "FUNCTION_BLOCK" identifier declarations statement_list "END_FUNCTION_BLOCK" ;
statement     = assignment | if_statement | fb_call | signal_publish ;
signal_publish= "SIGNAL_PUBLISH" "(" string_literal "," expression ")" ";" ;
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
primary       = literal | identifier | function_call | signal_read ;
signal_read   = "SIGNAL_READ" "(" string_literal ")" ;
```

| From → To | Implicit | Explicit | Runtime lỗi |
|---|---|---|---|
| cùng type | có | không cần | overflow/div0/non-finite |
| `DINT/UINT` → `REAL` | không | `DINT_TO_REAL`, `UINT_TO_REAL` | kết quả không hữu hạn bị fault |
| `REAL` → `DINT/UINT` | không | `REAL_TO_DINT`, `REAL_TO_UINT` | NaN/Inf/out-of-range reject; truncate về 0 |
| `INT/DINT/UINT` qua lại | không | các hàm `*_TO_*` ở §6 | âm/out-of-range reject; không wrap |
| BOOL ↔ numeric/TIME | không | ngoài Product hiện hành | compile error |
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
| User FUNCTION/FB + signal source chưa có merge/gate closure | Compiler + Controls + Core | implementation close | merge current worktree; compile/package/runtime/E2E full gate; cập nhật Trace bằng commit/file/symbol |
| PID end-user label chưa có evidence | Controls + Safety | release label | T59-205/T59-706; implementation registry vẫn tiếp tục |
| Target WCET chưa đo | Core + QA | release | T59-702 target load/soak evidence PASS |

| Phiên bản | Ngày | Thay đổi | Tác giả |
|---|---|---|---|
| 1.3 | 2026-09-28 | §4.3 làm rõ câu chữ luật WCET của `CASE` theo hành vi U-11 đã merge (PR #803, `REC-DDC-FIELD-USE-20260927`): trần `kMaxStatements` đếm **số nhãn**, mỗi nhãn (một giá trị hoặc một dải) nở thành tối đa hai phép so biên, nên dải rộng như `16..32767:` hợp lệ. Không đổi luật WCET, IR hay diagnostic; không đổi Product/SRS/VVP/Trace/Risk. | Compiler |
| 1.1 | 2026-08-24 | Đồng bộ corrective As-Built: ba POU kind, CLI POU/library/signal manifests, IR `MKDDCIR1/schema 1`, signal opcode `0x71/0x72`, section `0x0009`, FBD lowerer 1.1.0 và ranh giới package `MKDDCIR2/layout 2`; giữ trạng thái chưa merge/full-gate/target. | Compiler + Core + System Engineering |
| 0.1 | 2026-08-09 | Thiết kế ST/FBD, pipeline, diagnostics, determinism, limits và source mapping | System Engineering |
| 0.2 | 2026-08-09 | Bổ sung EBNF implementable, conversion/unit matrix và diagnostic ownership; chuyển Detailed Draft chờ review | System Engineering |
| 0.3 | 2026-08-09 | Thêm mục Đọc nhanh và bảng tự kiểm `DD-01..DD-13`; nêu rõ xung đột `INT=int32` vs `INT=int16` là blocker `OD-PROG-002` | System Engineering |
| 0.4 | 2026-08-11 | Đồng bộ `TASK-PROG-200`: sáu type target/wire code, conversion tường minh, exact diagnostic span/source map, hostile-source guard và hai chiến dịch fuzz 10 triệu input; giữ FBD/local POU/worker/target ở task/gate sau | Compiler + Core Lead |
| 0.5 | 2026-08-11 | Đồng bộ `TASK-PROG-201` tại `52dfb57`: FBD schema/golden/manifest/keyboard registry, C++ canonical validator/fuzzer và FE model/reducer/component; giữ FBD→IR/equivalence/local POU/worker/target ở task/gate sau | Compiler + Core + FE Lead |
| 0.6 | 2026-08-11 | Đồng bộ `TASK-PROG-202` tại `4819901`: lowerer FBD→`StProgram` typed→IR chung, 20 cặp ST↔FBD, trace TON, fail-closed unit/library/graph lỗi và fuzz 100.000 input; chuyển artifact/source-map production sang Task 203 | Compiler + Core Lead |
| 0.7 | 2026-08-11 | Đồng bộ `TASK-PROG-203` tại `2c2bfb4`: SHA-256 canonical, manifest/build key deterministic, source map ST/FBD giữ UUID/unit, CLI ST/FBD và verifier fail-closed; chuyển Project/Revision store sang Task 204 | Compiler + Core Lead |
| 0.8 | 2026-08-13 | Đồng bộ As-Built tới P4: compiler worker sandbox Task 205 đã gọi CLI bounded; P3/P4 nạp artifact verified qua loader/coordinator nhưng `st_compiler_lib` vẫn không link vào `mkddc-core`. Giữ local POU và target WCET/HIL/Test Result còn mở. | Compiler + Core + BE |
| 0.9 | 2026-08-15 | **WP-04 (D-06, `REV-PROG-OVERVIEW-DESIGN-GAP-2026-08-15` §7.3/§7.4).** §6: sửa `PID` từ "block target" (ngụ ý chưa build) thành **Implemented** — xác nhận trực tiếp `StFbType::PID` có thật trong `st_program.cpp` với port shape đầy đủ; giữ nguyên blocker "Unit/conversion/PID semantic chưa khóa" §14 (semantics vẫn chưa qua Controls+Safety review, chỉ sửa nhầm lẫn "chưa tồn tại" thành đúng "tồn tại nhưng chưa duyệt"). Không sửa §4.2 (type/conversion table) — đã khớp source từ trước, chỉ `ST_SUBSET_SPEC_MK-DDC-24_VI.md` (tài liệu As-Built khác) từng sai. | System Engineering |
| 1.0 | 2026-08-20 | ADR-050/Unified DDD khóa PROGRAM/FUNCTION/FUNCTION_BLOCK, library DAG, kind rule và artifact v2; bỏ TARGET-PENDING/Rev split; PID giữ evidence gate riêng. | Product + System/Compiler |

| Vai trò | Trạng thái | Bằng chứng |
|---|---|---|
| Compiler + Controls Lead | **Baseline DONE; corrective user POU/signal current-worktree, chưa closure** | source mapping §2/§11; chờ commit merge và gate mới |
| Core + FE + QA + Security | **WAIVED FOR IMPLEMENTATION; evidence độc lập còn mở** | `AUTH-PROG-2026-08-11-03` |
| System Architect + Product Owner | **APPROVED FOR IMPLEMENTATION** | `AUTH-PROG-2026-08-11-03`; OD-PROG-002/005/006 đã DECIDED |

Tự kiểm `DD-01..DD-13`:

| Mã | Kết quả | Mục trong file / lý do |
|---|---|---|
| `DD-01` Metadata | PASS | Bảng đầu file; revision history và bảng ký §14 |
| `DD-02` Mục tiêu/phạm vi | PASS | §1 mục tiêu, actor, tiêu chí thành công; §4–§5 giới hạn tập con ST/FBD |
| `DD-03` As-Built | PASS | §2 dẫn parser/semantic/compile/POU registry/FBD/CLI và phân biệt baseline merged với corrective current-worktree chưa merge |
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
corrective user POU/signal chưa được tuyên bố hoàn tất trước merge/full gate;
runtime target/soak và formal Test Result vẫn chưa PASS.
