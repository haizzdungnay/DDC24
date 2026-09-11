# FBD Editor Design — Palette, Interface Node, Inspector

**Document ID:** DDD-FBD-EDITOR-PROG-001
**Phiên bản:** 1.1
**Trạng thái:** Active — mở Document Gate #6 (`PROGRAMMING_DOCUMENT_READINESS_MATRIX.md`)
**Tác giả:** System Engineering, theo Lệnh triển khai CTO/Owner 2026-08-15 (D-02)
**Phạm vi:** Bổ sung cho `PROGRAMMING_FE_DESIGN.md` §5 "Structured FBD Rev A" —
tài liệu đó đã chốt **không có canvas tự do** (giữ nguyên ở đây); tài liệu này
đặc tả phần còn thiếu: palette, node giao diện (INPUT/OUTPUT/CONSTANT), và
Inspector.
**Nguồn kỹ thuật:** đọc trực tiếp `apps/core/application/st/st_program.cpp`
(`kFuncs`, `fb_spec`) và `st_fbd_compile.cpp` (`binop_from_type_ref`,
`st_func_from_name`) — registry này PHẢI khớp `fbd/model.ts` (đã đồng bộ ở
WP-03, `Plan 56`).

---

## 1. Palette — 9 nhóm, đúng danh mục CTO/Owner đã liệt kê

Palette là danh sách nút bấm "Thêm {loại}", nhóm theo category, hiện trong
`StructuredFbdEditor` cạnh nút "Network" hiện có (thay thế nút "Block AND"
cứng hiện tại). Mỗi mục cho biết node kind sinh ra và port mặc định.

### 1.1 Interface (chỉ 2 mục — không phải hàm, xem §2)

| Mục | node.kind | Port mặc định |
|---|---|---|
| Input | `INPUT` | 1 output (kiểu chọn khi tạo, mặc định `BOOL`) |
| Output | `OUTPUT` | 1 input (kiểu chọn khi tạo, mặc định `BOOL`) |

### 1.2 Constants

| Mục | node.kind | Port mặc định |
|---|---|---|
| Constant | `CONSTANT` | 1 output (kiểu + giá trị chọn khi tạo) |

### 1.3 Logic (`FUNCTION`, binop 2in/1out trừ `NOT`/`SEL`)

| typeRef | Port | Ghi chú |
|---|---|---|
| `AND`, `OR`, `XOR` | IN1,IN2:BOOL → OUT:BOOL | |
| `NOT` | IN1:BOOL → OUT:BOOL | unary |
| `SEL` | G:BOOL, IN0:T, IN1:T → OUT:T | arity 3 (`kFuncs` `SEL,3`); T chọn khi tạo (mặc định `REAL`) |

### 1.4 Compare (`FUNCTION`, binop 2in/1out, OUT luôn BOOL)

| typeRef | Port |
|---|---|
| `EQ`, `NE`, `LT`, `LE`, `GT`, `GE` | IN1,IN2:T → OUT:BOOL; T chọn khi tạo (mặc định `REAL`) |

### 1.5 Math (`FUNCTION`)

| typeRef | Port | Arity nguồn |
|---|---|---|
| `ADD`, `SUB`, `MUL`, `DIV`, `MOD` | IN1,IN2:T → OUT:T (binop) | 2 |
| `ABS` | IN1:T → OUT:T | `kFuncs` `ABS,1` |
| `MIN`, `MAX` | IN1,IN2:T → OUT:T | `kFuncs` `2` |
| `LIMIT` | MN:T,IN:T,MX:T → OUT:T | `kFuncs` `LIMIT,3` |
| `SQRT` | IN1:REAL → OUT:REAL | `kFuncs` `SQRT,1`; luôn REAL, không chọn T |

`T` cho nhóm này chọn khi tạo node, mặc định `REAL`; `MOD` chỉ hợp lệ với
`INT`/`DINT`/`UINT` (đúng §4.2 bảng kiểu toán tử `ST_SUBSET_SPEC` — Inspector
phải chặn chọn `MOD` với `REAL`/`BOOL`/`TIME`, xem §3.3).

### 1.6 Conversion (`FUNCTION`, tất cả arity 1)

14 mục, tên node = tên hàm, 1 input/1 output đúng kiểu nguồn/đích trong tên:
`INT_TO_REAL`, `REAL_TO_INT`, `TIME_TO_REAL`, `REAL_TO_TIME`, `INT_TO_DINT`,
`INT_TO_UINT`, `DINT_TO_INT`, `DINT_TO_UINT`, `UINT_TO_INT`, `UINT_TO_DINT`,
`DINT_TO_REAL`, `UINT_TO_REAL`, `REAL_TO_DINT`, `REAL_TO_UINT`. Không cần
chọn kiểu — cố định theo tên hàm.

### 1.7 Timer (`FUNCTION_BLOCK`)

| typeRef | Port |
|---|---|
| `TON`, `TOF` | IN:BOOL, PT:TIME → Q:BOOL, ET:TIME |

### 1.8 Trigger (`FUNCTION_BLOCK`)

| typeRef | Port |
|---|---|
| `R_TRIG`, `F_TRIG` | CLK:BOOL → Q:BOOL |

### 1.9 Control (`FUNCTION_BLOCK`)

| typeRef | Port | Cảnh báo bắt buộc |
|---|---|---|
| `PID` | SP,PV,KP,KI,KD,OUT_MIN,OUT_MAX,ACTUAL:REAL → OUT:REAL, TRACKING:BOOL | Palette phải hiện badge "Chưa Controls+Safety review — không dùng cho logic sản xuất" cạnh mục này (đúng `ST_SUBSET_SPEC` §6.2 đính chính WP-04); không chặn tạo node (vẫn Implemented, chỉ chưa duyệt), chỉ cảnh báo |

---

## 2. Node giao diện — INPUT / OUTPUT / CONSTANT

Ba loại này không phải hàm compiler (`st_func_from_name`/`StFbType` không có
mục nào tên "INPUT"/"OUTPUT"/"CONSTANT") — chúng là **node kind** ở tầng FBD
model (`fbd/model.ts` `FbdNodeKind`), được `st_fbd_compile.cpp` xử lý riêng
(lower thành khai báo `VAR_INPUT`/`VAR_OUTPUT`/literal trong `StProgram`, xem
gap report §8.4). `typeRef` của ba loại này là **tên kiểu dữ liệu** (`BOOL`,
`INT`, `DINT`, `UINT`, `REAL`, `TIME`), không phải tên hàm.

### 2.1 Tạo Input/Output

Dialog/form khi bấm "Input" hoặc "Output" ở palette:

- **Tên biến** (bắt buộc, định danh ST hợp lệ — dùng cùng regex `identifier`
  đã có trong `model.ts`, `/^[A-Za-z_][A-Za-z0-9_]{0,63}$/`).
- **Kiểu** (`BOOL/INT/DINT/UINT/REAL/TIME`, mặc định `BOOL`).
- **Đơn vị** (tuỳ chọn, chuỗi tự do — khớp `FbdPort.unit`).

Kết quả: một node `kind:'INPUT'` (hoặc `'OUTPUT'`) với đúng 1 port
(hướng ngược — `INPUT` node có 1 port **OUTPUT** vì nó "xuất" giá trị biến
vào mạng logic; `OUTPUT` node có 1 port **INPUT** vì nó "nhận" giá trị để ghi
ra biến — đúng quy tắc đã có ở `portShapeMatchesKind()` trong `model.ts`) và
`parameters.variable = <tên biến>`.

### 2.2 Tạo Constant

Dialog khi bấm "Constant": **Kiểu** + **Giá trị** (theo đúng literal syntax
`ST_SUBSET_SPEC` §3.2 — số nguyên cho `INT/DINT/UINT`, có dấu chấm cho
`REAL`, `TRUE/FALSE` cho `BOOL`, `T#...` cho `TIME`). Lưu vào
`parameters.value`. Node có đúng 1 port OUTPUT đúng kiểu đã chọn.

### 2.3 Ràng buộc số lượng

Không giới hạn số node INPUT/OUTPUT riêng — nhưng tên biến **INPUT** và
**OUTPUT** không được trùng nhau trong cùng Program (đúng cách
`collectFbdInterfaceVariables()` đọc — hai node cùng tên khác `direction` là
hợp lệ về mặt FBD graph nhưng gây nhầm ở Mapping tab; validator client nên
cảnh báo, không bắt buộc chặn cứng vì Check (server) là authority cuối).

---

## 3. Inspector

Panel bên phải (hoặc bên dưới trên mobile) hiện khi có `selection.kind IN
('node','port')`. Không phải cột thứ ba cố định (khác PGM-02 ST/Mapping —
FBD Inspector là panel theo ngữ cảnh, không phải layout 3 cột như §16.2 quy
định cho tab Chương trình nói chung — bản thân `StructuredFbdEditor` đã là
nội dung của ô "Editor FBD" trong bố cục 3 cột đó, Inspector của FBD nằm
**trong** ô editor, không phải cột Inspector chung của `ProgramsTab`. Cột
Inspector chung của `ProgramsTab` (`ProgramInspector`, đã có) vẫn chỉ sửa
metadata Program — không đổi).

### 3.1 Chọn một `node`

| Trường | Sửa được khi | Ghi chú |
|---|---|---|
| Tên biến (`parameters.variable`) | `kind IN (INPUT,OUTPUT)` | Đổi tên phải cập nhật cả node, không đổi wire (wire trỏ theo `portId`, không theo tên) |
| Kiểu dữ liệu | `kind IN (INPUT,OUTPUT,CONSTANT)` | Đổi kiểu **phải đổi luôn `port.dataType`** của port duy nhất; nếu port đang có wire nối và kiểu mới không khớp đầu kia → giữ nguyên đổi kiểu, nhưng validator (`validateFbdDocument`, đã có `FBD-SEM-WIRE-001`) sẽ báo wire sai — đúng hành vi "component chấp nhận Draft chưa hoàn chỉnh và hiện issue" đã ghi ở `PROGRAMMING_FE_DESIGN.md` §5 |
| Đơn vị | `kind IN (INPUT,OUTPUT)` | Chuỗi tự do |
| Giá trị | `kind = CONSTANT` | Theo literal syntax kiểu đã chọn |
| `T` (kiểu toán hạng) cho `SEL`/Compare/`MIN`/`MAX`/`LIMIT`/`ADD`/`SUB`/`MUL`/`DIV`/`MOD` | `kind=FUNCTION` và typeRef thuộc nhóm đa hình kiểu | Đổi `T` phải đổi lại **toàn bộ port cùng lúc** (input lẫn output), không cho lệch kiểu giữa các port của cùng node |
| `MOD` chặn `REAL`/`BOOL`/`TIME` | `typeRef=MOD` | Dropdown `T` chỉ hiện `INT/DINT/UINT` |
| Thứ tự thực thi (`executionOrder`) | Mọi node | Đã có nút "Đưa lên/xuống" ở toolbar — Inspector chỉ hiện số, không cần ô nhập tay (tránh nhập giá trị trùng ngoài luồng `MOVE_NODE` đã kiểm soát) |
| Tên instance (`parameters.instance`) | `kind=FUNCTION_BLOCK` | **Đọc trực tiếp `st_fbd_compile.cpp` `declare_function_blocks()`**: FB node CHO PHÉP đúng 2 tham số tuỳ chọn `instance` (string, phải là identifier hợp lệ, mặc định tự sinh `FB_<networkOrder>_<executionOrder>` nếu bỏ trống) và `retained` (bool, mặc định `false`) — bất kỳ key nào khác đều bị Check từ chối `FBD-SEM-PARAM-001`. Đây là điểm đã bị bỏ sót ở bản nháp đầu của tài liệu này (chỉ đọc `kFuncs`, chưa đọc `declare_function_blocks`) |
| Cờ RETAIN (`parameters.retained`) | `kind=FUNCTION_BLOCK` | Checkbox; liên quan trực tiếp `WP-12` (RETAIN reset) — Inspector là nơi user gắn RETAIN cho từng instance TON/TOF/PID |
| Không sửa được gì khác | `kind=FUNCTION_BLOCK`, `kind=FUNCTION` đơn hình (NOT/AND/OR/XOR/SQRT/conversion) | Port cố định theo `st_program.cpp`; `kind=FUNCTION`/`CONVERSION` **không được có `parameters`** — compiler từ chối thẳng nếu `node.parameters` khác rỗng (`FBD-SEM-PARAM-001`, đọc tại `function_expression`/`conversion_expression`) — Inspector chỉ hiện thông tin (typeRef, port list) cho các node này, tuyệt đối không thêm field parameter |

### 3.2 Chọn một `port`

Read-only: tên, hướng, kiểu, đơn vị — dùng để xác nhận trước khi nối
(`BEGIN_OR_COMMIT_CONNECTION` đã có), không sửa trực tiếp ở đây (sửa qua
node cha, §3.1, để giữ nhất quán khi node có nhiều port cùng đổi kiểu).

---

## 4. Command mới cần cho `commands.ts`

Palette/Inspector cần các action mới ngoài 11 lệnh hiện có
(`fbd_keyboard_commands_v1.json` không cần đổi — palette dùng chuột/Tab, các
phím tắt hiện có `Insert/↑↓/Enter/Delete/Alt+↑↓/Ctrl+Z/Y` vẫn nguyên vẹn):

- `ADD_NODE` (đã có type, mở rộng để nhận `node` bất kỳ từ palette thay vì
  luôn `newAndNode()` — không đổi shape action, chỉ đổi nơi gọi).
- `SET_NODE_VARIABLE` (mới) — sửa `parameters.variable`/`unit` cho
  INPUT/OUTPUT.
- `SET_NODE_VALUE` (mới) — sửa `parameters.value` cho CONSTANT.
- `SET_NODE_TYPE` (mới) — đổi `typeRef`(kiểu T)/port dataType đồng loạt cho
  node đa hình kiểu; **không dùng để đổi `typeRef` giữa các hàm khác nhau**
  (vd AND→OR) — đổi hàm nghĩa là xoá node cũ, tạo node mới (giữ đúng bất biến
  "port shape cố định theo typeRef" đã có trong `validateFbdDocument`).
- `SET_NODE_FB_PARAMS` (mới) — sửa `parameters.instance`/`parameters.retained`
  cho `kind=FUNCTION_BLOCK`; validate `instance` bằng regex `identifier` hiện
  có trước khi set, bỏ trống thì xoá key (để compiler tự sinh tên).

---

## 5. Tự kiểm nhanh

- [x] Không mở rộng phạm vi ra "canvas tự do" — giữ đúng quyết định Rev A đã
      chốt ở `PROGRAMMING_FE_DESIGN.md` §5.
- [x] Mọi typeRef trong palette đối chiếu trực tiếp `st_program.cpp` (§1),
      không suy đoán.
- [x] Không thêm node kind/hàm nào ngoài registry đã đồng bộ ở WP-03.
- [x] `PID` giữ nguyên trạng thái "Implemented, chưa duyệt production" đúng
      D-06 — không tự ý nâng cấp badge.

## 6. Lịch sử sửa đổi

| Revision | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-08-15 | Tạo mới để mở Document Gate #6 (D-02, Plan 56 WP-05/06/07). Palette 9 nhóm, node giao diện INPUT/OUTPUT/CONSTANT, Inspector theo node kind, 3 command mới cho `commands.ts`. |
| 1.1 | 2026-08-15 | Sửa §3.1: đọc trực tiếp `declare_function_blocks()` phát hiện FB node THỰC RA nhận 2 tham số `instance`/`retained` (bản 1.0 nói "không sửa được gì" — sai). Thêm command `SET_NODE_FB_PARAMS`. |
