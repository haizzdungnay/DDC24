# ST Language Profile — MK-DDC-24

> **SINH TỰ ĐỘNG** bởi `scripts/generate_st_language_profile.py` từ chính
> compiler. **Không sửa tay** — mọi sửa tay sẽ bị `--check` trong `ctest` xoá bỏ.
>
> Tài liệu này thay thế `ST_SUBSET_SPEC` §10 (EBNF) và §11 (bảng đối chiếu
> parser). Lý do thay: §11 tuyên bố parser phủ *40%* grammar và ghim ở một
> commit từ lâu, trong khi thực tế khác hẳn. **Một bảng đối chiếu sai 100%
> nguy hiểm hơn không có bảng, vì nó trông như bằng chứng** (`F-STED-007`).

| Trường | Giá trị |
|---|---|
| Phiên bản hồ sơ | `1.0.0` |
| `sha256` | `31bf5f0b5776956270a3145586bb867dbc1af89865e618fda67a2c17f19ae36d` |
| Phiên bản compiler | `fwsom-st-1.2.0` |
| Target profile | `revA-1t-1-5-30` (ABI `3841`) |
| Chuẩn nền | IEC 61131-3:2013 (Ed. 3.0) — Structured Text |
| Tuyên bố phù hợp | IEC 61131-3-aligned subset. KHÔNG tuyên bố certified/compliant (ADR-020). |

## 1. Kiểu vô hướng

| Kiểu | Mã wire | Miền giá trị |
|---|---|---|
| `BOOL` | 1 | — |
| `INT` | 5 | `-32768` … `32767` |
| `DINT` | 2 | `-2147483648` … `2147483647` |
| `UINT` | 6 | `0` … `65535` |
| `REAL` | 3 | — |
| `TIME` | 4 | — |

## 2. Câu lệnh

Cột "chấp nhận" đo bằng cách **parse thật** một mẫu tối thiểu cho mỗi dạng,
không bằng cách đọc tên hàm `parse_*` trong source. Chỉ phép thử thật mới phân
biệt được *tài liệu nói gì* với *code làm gì* — đúng chỗ `DDD-LANG-PROG-001`
§4.1 từng sai về `CASE` (`F-STED-005`).

| Câu lệnh | Chấp nhận | Mã từ chối |
|---|---|---|
| `ASSIGN` | có | — |
| `IF` | có | — |
| `ELSIF` | có | — |
| `ELSE` | có | — |
| `CASE` | có | — |
| `FB_CALL` | có | — |
| `FOR` | **không** | `ST-SYN-001` |
| `WHILE` | **không** | `ST-SYN-001` |
| `REPEAT` | **không** | `ST-SYN-001` |
| `EXIT` | **không** | `ST-SYN-001` |
| `RETURN` | **không** | `ST-SYN-001` |

## 3. Toán tử

| Toán tử | Chấp nhận |
|---|---|
| `+` | có |
| `-` | có |
| `*` | có |
| `/` | có |
| `<` | có |
| `<=` | có |
| `>` | có |
| `>=` | có |
| `=` | có |
| `<>` | có |
| `AND` | có |
| `OR` | có |
| `XOR` | có |
| `NOT` | có |
| `MOD` | có |
| `**` | **không** |

## 4. Hàm chuẩn

| Hàm | Arity | Nguồn gốc |
|---|---|---|
| `ABS` | 1 | IEC |
| `MIN` | 2 | IEC |
| `MAX` | 2 | IEC |
| `LIMIT` | 3 | IEC |
| `SEL` | 3 | IEC |
| `SQRT` | 1 | IEC |
| `SCALE` | 5 | **mở rộng nhà sản xuất** |
| `DEADBAND` | 3 | **mở rộng nhà sản xuất** |
| `INT_TO_REAL` | 1 | IEC |
| `REAL_TO_INT` | 1 | IEC |
| `TIME_TO_REAL` | 1 | IEC |
| `REAL_TO_TIME` | 1 | IEC |
| `INT_TO_DINT` | 1 | IEC |
| `INT_TO_UINT` | 1 | IEC |
| `DINT_TO_INT` | 1 | IEC |
| `DINT_TO_UINT` | 1 | IEC |
| `UINT_TO_INT` | 1 | IEC |
| `UINT_TO_DINT` | 1 | IEC |
| `DINT_TO_REAL` | 1 | IEC |
| `UINT_TO_REAL` | 1 | IEC |
| `REAL_TO_DINT` | 1 | IEC |
| `REAL_TO_UINT` | 1 | IEC |

## 5. Function Block chuẩn

| FB | Đầu vào | Đầu ra | Nguồn gốc |
|---|---|---|---|
| `TON` | `IN`:BOOL, `PT`:TIME | `Q`:BOOL, `ET`:TIME | IEC |
| `TOF` | `IN`:BOOL, `PT`:TIME | `Q`:BOOL, `ET`:TIME | IEC |
| `R_TRIG` | `CLK`:BOOL | `Q`:BOOL | IEC |
| `F_TRIG` | `CLK`:BOOL | `Q`:BOOL | IEC |
| `PID` | `SP`:REAL, `PV`:REAL, `KP`:REAL, `KI`:REAL, `KD`:REAL, `OUT_MIN`:REAL, `OUT_MAX`:REAL, `ACTUAL`:REAL | `OUT`:REAL, `TRACKING`:BOOL | **mở rộng nhà sản xuất** |
| `TP` | `IN`:BOOL, `PT`:TIME | `Q`:BOOL, `ET`:TIME | IEC |
| `CTU` | `CU`:BOOL, `RESET`:BOOL, `PV`:INT | `Q`:BOOL, `CV`:INT | IEC |
| `CTD` | `CD`:BOOL, `LOAD`:BOOL, `PV`:INT | `Q`:BOOL, `CV`:INT | IEC |
| `HYSTERESIS` | `IN`:REAL, `HIGH`:REAL, `LOW`:REAL | `Q`:BOOL | **mở rộng nhà sản xuất** |

## 6. Giới hạn tài nguyên

| Giới hạn | Giá trị |
|---|---|
| `maxDiagnostics` | 64 |
| `maxExpressionDepth` | 32 |
| `maxFunctionBlockInstances` | 64 |
| `maxIdentifierLength` | 64 |
| `maxPouNameLength` | 64 |
| `maxRetainVariables` | 128 |
| `maxSourceBytes` | 65536 |
| `maxStatementDepth` | 16 |
| `maxStatements` | 4096 |
| `maxTimeLiteralNs` | 86400000000000 |
| `maxTokens` | 32768 |
| `maxVariables` | 512 |

## 7. Cố ý không có, kèm lý do

`ADR-054` phán quyết: nguyên tắc *"làm chuẩn theo IEC: có thì giữ, không có thì
bỏ"* áp cho **cú pháp/ngữ nghĩa ngôn ngữ**. Loại trừ một thứ IEC **có** thì phải
**công bố kèm lý do** — đó là nội dung bảng này.

| Cấu trúc | Loại | IEC có? | Lý do loại trừ | Thẩm quyền |
|---|---|---|---|---|
| `FOR` | statement | có | P1 — mọi scan phải chấm dứt trong thời gian chặn trên biết trước. Vòng lặp có số vòng phụ thuộc dữ liệu làm WCET không tính được tĩnh, nên bị loại vì ràng buộc AN TOÀN của DDC, không phải vì thiếu trong IEC. | ADR-054 phán quyết (3) |
| `WHILE` | statement | có | P1 — như FOR: điều kiện dừng phụ thuộc dữ liệu runtime, WCET không chặn trên được. | ADR-054 phán quyết (3) |
| `REPEAT` | statement | có | P1 — như WHILE, thêm việc thân luôn chạy ít nhất một lần. | ADR-054 phán quyết (3) |
| `EXIT` | statement | có | Chỉ có nghĩa bên trong vòng lặp; không có vòng lặp thì không có gì để thoát. | hệ quả của ADR-054 phán quyết (3) |
| `RETURN` | statement | có | Nhiều điểm thoát làm cây WCET rẽ nhánh không cần thiết; FUNCTION gán kết quả qua ô trả về mang tên hàm như IEC quy định. | ST_SUBSET_SPEC §5 |
| `**` | operator | có | Luỹ thừa trên REAL không có chặn trên chi phí tất định trên FPU mềm của target, và không có ca dùng HVAC nào trong Rev A. Dùng phép nhân tường minh. | ST_SUBSET_SPEC §4.2 |
| `STRING` | type | có | P2 — độ dài biến kéo theo cấp phát động trong chu kỳ scan. Loại trừ tới khi có kiểu chuỗi độ dài cố định. | ADR-054 phán quyết (4) |
| `DATE` | type | có | P2 — lịch/múi giờ thuộc tầng Schedule, không thuộc ngôn ngữ điều khiển chu kỳ. | ADR-054 phán quyết (4) |
| `TOD` | type | có | P2 — thời điểm trong ngày phụ thuộc múi giờ và quy tắc đổi giờ, hai thứ thuộc tầng Schedule. Chương trình chu kỳ nhận thời gian đã quy đổi qua Point, không tự diễn giải lịch. | ADR-054 phán quyết (4) |
| `DT` | type | có | P2 — ghép DATE và TOD nên thừa hưởng cả hai vấn đề lịch/múi giờ; loại trừ cùng lý do và cùng đợt. | ADR-054 phán quyết (4) |
| `LD` | language | có | Ngoài phạm vi Programming Rev A. | ADR-023 |
| `SFC` | language | có | Ngoài phạm vi Programming Rev A. | ADR-023 |
| `SINT` | type | có | P2 — số nguyên 8 bit không tiết kiệm gì trên ARM 32 bit của target mà lại thêm một bộ quy tắc tràn/ép kiểu nữa vào bề mặt kiểm thử. `INT` phủ trọn dải của nó. | ADR-054 phán quyết (4) |
| `USINT` | type | có | P2 — như `SINT`: dải giá trị nằm gọn trong `UINT`, thêm kiểu chỉ thêm ca ép kiểu phải chứng minh. | ADR-054 phán quyết (4) |
| `LINT` | type | có | P2 — số nguyên 64 bit có nghĩa cho bộ đếm dài hạn, nhưng ở Rev A mọi bộ đếm đều thuộc tầng Historian chứ không thuộc chương trình chu kỳ. `TIME` đã là int64 cho nhu cầu thời gian. | ADR-054 phán quyết (4) |
| `ULINT` | type | có | P2 — như `LINT`, và không có ca dùng HVAC nào cần dải không dấu 64 bit trong một chu kỳ scan. | ADR-054 phán quyết (4) |
| `UDINT` | type | có | P2 — `DINT` và `UINT` đã phủ các dải đang dùng thật; thêm một kiểu nguyên nữa nhân đôi bảng ép kiểu mà không mở thêm ca dùng nào. | ADR-054 phán quyết (4) |
| `LWORD` | type | có | P2 — đi cùng nhóm chuỗi bit `BYTE`/`WORD`/`DWORD`, vốn đã hoãn sang đợt sau; không tách riêng một mình 64 bit. | ADR-054 phán quyết (4) |
| `WSTRING` | type | có | P2 — thừa hưởng nguyên vấn đề cấp phát động của `STRING`, cộng thêm mã hoá rộng. Loại trừ cùng lý do và cùng đợt với `STRING`. | ADR-054 phán quyết (4) |
| `LN` | function | có | Hàm siêu việt trên FPU mềm của target không có chặn trên chi phí tất định, mà WCET của mọi scan phải tính được tĩnh. Không có ca dùng HVAC nào trong Rev A cần logarit. | ADR-054 phán quyết (4) |
| `LOG` | function | có | Cùng lý do với `LN`: chi phí phụ thuộc giá trị trên FPU mềm, không chặn trên tất định được. | ADR-054 phán quyết (4) |
| `EXP` | function | có | Cùng lý do với `LN`. Đường cong luỹ thừa trong điều khiển HVAC được xấp xỉ bằng bảng tra ở tầng ứng dụng, không bằng hàm ngôn ngữ. | ADR-054 phán quyết (4) |
| `EXPT` | function | có | Dạng hàm của toán tử `**` đã bị loại; giữ một trong hai sẽ mở lại đúng chi phí mà việc loại `**` muốn tránh. Dùng phép nhân tường minh. | ST_SUBSET_SPEC §4.2 |
| `SIN` | function | có | Hàm lượng giác trên FPU mềm không có chặn trên tất định, và không có ca dùng HVAC nào trong Rev A cần lượng giác trong chu kỳ scan. | ADR-054 phán quyết (4) |
| `COS` | function | có | Cùng lý do với `SIN`. | ADR-054 phán quyết (4) |
| `TAN` | function | có | Cùng lý do với `SIN`, thêm điểm kỳ dị tại π/2 phải xử lý riêng cho chính sách NaN/Inf ở §6.3. | ADR-054 phán quyết (4) |
| `ASIN` | function | có | Cùng lý do với `SIN`, thêm miền xác định [-1, 1] phải kiểm ở runtime. | ADR-054 phán quyết (4) |
| `ACOS` | function | có | Cùng lý do với `ASIN`. | ADR-054 phán quyết (4) |
| `ATAN` | function | có | Cùng lý do với `SIN`. | ADR-054 phán quyết (4) |
| `TRUNC` | function | có | `REAL_TO_INT` và họ hàm ép kiểu tường minh đã phủ nhu cầu cắt phần thập phân, với quy tắc làm tròn công bố rõ ở §3.5. Hai đường cho một việc là hai ngữ nghĩa để trôi khỏi nhau. | ADR-054 phán quyết (4) |
| `MUX` | function | có | Chọn theo chỉ số cần kiểu hợp thành hoặc số tham số thay đổi; `SEL` phủ ca chọn hai nhánh, và `IF`/`CASE` phủ phần còn lại một cách đọc được hơn. | ADR-054 phán quyết (4) |
| `SHL` | function | có | Thao tác dịch bit chỉ có nghĩa trên kiểu chuỗi bit (`BYTE`/`WORD`/`DWORD`), vốn hoãn sang đợt sau. Không có kiểu để dịch thì hàm dịch không có miền xác định. | ADR-054 phán quyết (4) |
| `SHR` | function | có | Cùng lý do với `SHL`. | ADR-054 phán quyết (4) |
| `ROL` | function | có | Cùng lý do với `SHL`. | ADR-054 phán quyết (4) |
| `ROR` | function | có | Cùng lý do với `SHL`. | ADR-054 phán quyết (4) |
| `LEN` | function | có | Hàm chuỗi theo sau kiểu `STRING`, vốn bị loại vì cấp phát động trong chu kỳ scan. Liệt kê riêng từng tên để cổng đối chiếu kiểm được từng cái, thay vì một dòng gộp không kiểm được. | ADR-054 phán quyết (4) |
| `LEFT` | function | có | Hàm chuỗi, theo sau loại trừ `STRING` (cấp phát động trong chu kỳ scan). | ADR-054 phán quyết (4) |
| `RIGHT` | function | có | Hàm chuỗi, theo sau loại trừ `STRING`. | ADR-054 phán quyết (4) |
| `MID` | function | có | Hàm chuỗi, theo sau loại trừ `STRING`. | ADR-054 phán quyết (4) |
| `CONCAT` | function | có | Hàm chuỗi, theo sau loại trừ `STRING`. Nối chuỗi còn là ca cấp phát động rõ rệt nhất: độ dài kết quả chỉ biết tại runtime. | ADR-054 phán quyết (4) |
| `INSERT` | function | có | Hàm chuỗi, theo sau loại trừ `STRING`. | ADR-054 phán quyết (4) |
| `DELETE` | function | có | Hàm chuỗi, theo sau loại trừ `STRING`. | ADR-054 phán quyết (4) |
| `REPLACE` | function | có | Hàm chuỗi, theo sau loại trừ `STRING`. | ADR-054 phán quyết (4) |
| `FIND` | function | có | Hàm chuỗi, theo sau loại trừ `STRING`. | ADR-054 phán quyết (4) |
| `SR` | functionBlock | có | Chốt set-ưu-tiên viết được bằng một `IF` hai nhánh trên một biến `BOOL` có `RETAIN`, và viết tường minh thì thứ tự ưu tiên hiện ra trên mã thay vì nấp trong tên khối. | ADR-054 phán quyết (4) |
| `RS` | functionBlock | có | Chốt reset-ưu-tiên: cùng lý do với `SR`. Đúng cặp này là nơi người viết chương trình hay nhớ nhầm bên nào thắng. | ADR-054 phán quyết (4) |
| `CTUD` | functionBlock | có | `CTU` và `CTD` đã có; bộ đếm hai chiều thêm một tập ngữ nghĩa tải/đặt lại đồng thời phải chứng minh, trong khi ghép hai khối đã có phủ được ca dùng. | ADR-054 phán quyết (4) |
| `RTC` | functionBlock | có | Đồng hồ thời gian thực thuộc tầng Schedule chứ không thuộc ngôn ngữ điều khiển chu kỳ; nó cũng kéo theo `DT`, vốn đã bị loại vì lịch/múi giờ. | ADR-054 phán quyết (4) |
| `SEMA` | functionBlock | có | Semaphore giả định nhiều luồng tranh chấp. Rev A chạy một task tuần tự, nên khối này không có vấn đề nào để giải mà chỉ thêm một đường chặn scan. | ADR-054 phán quyết (4) |

## 8. Lộ trình bổ sung

| Cấu trúc | Đợt | Ghi chú | Thẩm quyền | Issue |
|---|---|---|---|---|
| `VAR_IN_OUT` | đợt gần | Đi cùng ARRAY tĩnh và STRUCT: VAR_IN_OUT là truyền tham chiếu, không có kiểu hợp thành thì gần như vô dụng. | ADR-054 phán quyết (4) | #367 |
| `ARRAY (kích thước tĩnh)` | đợt gần | Kích thước biết tại compile time nên WCET vẫn chặn trên được. | ADR-054 phán quyết (4) | #367 |
| `STRUCT` | đợt gần | Đi cùng VAR_IN_OUT. | ADR-054 phán quyết (4) | #367 |
| `LREAL, BYTE, WORD, DWORD, enum` | đợt sau | Mở rộng hệ kiểu sau khi đợt gần ổn định. | ADR-054 phán quyết (4) | — |

## 9. Văn phạm (EBNF)

```ebnf
pou            = program | function | function_block ;
program        = 'PROGRAM' identifier { var_block } stmt_list 'END_PROGRAM' ;
function       = 'FUNCTION' identifier ':' scalar_type { var_block } stmt_list 'END_FUNCTION' ;
function_block = 'FUNCTION_BLOCK' identifier { var_block } stmt_list 'END_FUNCTION_BLOCK' ;
var_block      = ( 'VAR' [ 'RETAIN' ] | 'VAR_INPUT' | 'VAR_OUTPUT' ) { var_decl } 'END_VAR' ;
var_decl       = identifier ':' type_name ';' ;
type_name      = scalar_type | fb_type_name | user_fb_name ;
scalar_type    = 'BOOL' | 'INT' | 'DINT' | 'UINT' | 'REAL' | 'TIME' ;
stmt_list      = { statement } ;
statement      = assignment | if_stmt | case_stmt | fb_call | signal_publish ;
assignment     = variable ':=' expression ';' ;
if_stmt        = 'IF' expression 'THEN' stmt_list { 'ELSIF' expression 'THEN' stmt_list } [ 'ELSE' stmt_list ] 'END_IF' ';' ;
case_stmt      = 'CASE' expression 'OF' { case_element } [ 'ELSE' stmt_list ] 'END_CASE' ';' ;
case_element   = case_label { ',' case_label } ':' stmt_list ;
case_label     = signed_integer [ '..' signed_integer ] ;
fb_call        = identifier '(' [ fb_arg { ',' fb_arg } ] ')' ';' ;
fb_arg         = identifier ':=' expression ;
signal_publish = 'SIGNAL_PUBLISH' '(' identifier ',' expression ')' ';' ;
expression     = or_expr ;
or_expr        = xor_expr { ( 'OR' ) xor_expr } ;
xor_expr       = and_expr { 'XOR' and_expr } ;
and_expr       = compare_expr { 'AND' compare_expr } ;
compare_expr   = add_expr { ( '=' | '<>' | '<' | '<=' | '>' | '>=' ) add_expr } ;
add_expr       = mul_expr { ( '+' | '-' ) mul_expr } ;
mul_expr       = unary_expr { ( '*' | '/' | 'MOD' ) unary_expr } ;
unary_expr     = [ 'NOT' | '-' ] primary ;
primary        = literal | variable | member_access | func_call | '(' expression ')' ;
member_access  = identifier '.' identifier ;
func_call      = identifier '(' [ expression { ',' expression } ] ')' ;
literal        = integer_literal | real_literal | time_literal | 'TRUE' | 'FALSE' ;
time_literal   = ( 'T' | 'TIME' ) '#' { unsigned_integer time_unit } ;
time_unit      = 'd' | 'h' | 'm' | 's' | 'ms' ;
comment        = '(*' { character } '*)' | '//' { character } newline ;
```

## 10. Mã diagnostic

`ST-IOMAP-001`, `ST-IOMAP-002`, `ST-IOMAP-003`, `ST-IOMAP-004`, `ST-IOMAP-005`, `ST-IOMAP-006`, `ST-IOMAP-007`, `ST-IOMAP-008`, `ST-LEX-001`, `ST-LEX-002`, `ST-LEX-003`, `ST-LIB-001`, `ST-LIB-002`, `ST-LIB-003`, `ST-LIM-001`, `ST-LIM-002`, `ST-LIM-003`, `ST-LIM-004`, `ST-LIM-005`, `ST-LIM-006`, `ST-LIM-007`, `ST-LIM-008`, `ST-LIM-009`, `ST-OWN-001`, `ST-PID-001`, `ST-POU-001`, `ST-POU-002`, `ST-POU-003`, `ST-POU-004`, `ST-POU-005`, `ST-RT-001`, `ST-RT-002`, `ST-RT-003`, `ST-RT-004`, `ST-RT-005`, `ST-RT-006`, `ST-RT-007`, `ST-RT-008`, `ST-RT-009`, `ST-RT-010`, `ST-RT-011`, `ST-RT-012`, `ST-RT-013`, `ST-SCHED-001`, `ST-SEM-001`, `ST-SEM-002`, `ST-SEM-003`, `ST-SEM-004`, `ST-SEM-005`, `ST-SEM-006`, `ST-SEM-007`, `ST-SEM-008`, `ST-SEM-009`, `ST-SEM-010`, `ST-SEM-011`, `ST-SEM-012`, `ST-SEM-013`, `ST-SEM-014`, `ST-SIG-001`, `ST-SIG-002`, `ST-SIG-003`, `ST-SIG-004`, `ST-SIG-005`, `ST-SYN-001`, `ST-SYN-002`, `ST-WARN-001`, `ST-WARN-002`, `ST-WARN-003`, `ST-WARN-004`

## 11. Từ khoá giữ chỗ

`PROGRAM`, `END_PROGRAM`, `VAR`, `VAR_INPUT`, `VAR_OUTPUT`, `END_VAR`, `FUNCTION`, `END_FUNCTION`, `FUNCTION_BLOCK`, `END_FUNCTION_BLOCK`, `RETAIN`, `IF`, `THEN`, `ELSIF`, `ELSE`, `END_IF`, `AND`, `OR`, `XOR`, `NOT`, `MOD`, `TRUE`, `FALSE`, `BOOL`, `INT`, `DINT`, `UINT`, `REAL`, `TIME`, `TON`, `TOF`, `R_TRIG`, `F_TRIG`, `PID`, `TP`, `CTU`, `CTD`, `HYSTERESIS`, `CASE`, `OF`, `END_CASE`, `FOR`, `END_FOR`, `WHILE`, `END_WHILE`, `REPEAT`, `UNTIL`, `END_REPEAT`, `EXIT`, `CONTINUE`, `RETURN`, `GOTO`, `VAR_GLOBAL`, `VAR_EXTERNAL`, `NATIVE`, `POINTER`, `REFERENCE`, `AT`, `ARRAY`, `STRUCT`, `STRING`, `WSTRING`, `VAR_IN_OUT`, `VAR_TEMP`
