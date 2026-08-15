# ST Subset Specification — MK-DDC-24 FW SOM Program Runtime

> **Document ID:** SW-ST-SUBSET-MK-DDC-24-VI
> **Phiên bản:** 1.1 | 2026-08-15 (đính chính §3.1/§3.5/§6.2 theo D-06, xem §14)
> **Workstream:** Supporting As-Built của compiler ST; plan C0.4 lịch sử đã bị
> [Plan 53](../../03_implementation/53_PROGRAMMING_IMPLEMENTATION_PLAN.md) thay
> thế và phục hồi được tại commit `b69fdf1`.
> **Trạng thái:** Supporting As-Built — source hiện tại tại `apps/core/application/st/`; không phải Target authority Programming v2.2
> **Nguồn quyết định:** ADR-020 (amended 2026-07-24), quyết định phạm vi ngôn ngữ 2026-07-28
> **Tài liệu liên quan:** [`TYPED_IR_ARTIFACT_SPEC`](TYPED_IR_ARTIFACT_SPEC_MK-DDC-24_VI.md) (C0.6),
> [`PROGRAM_TASK_SCHEDULER_SPEC`](PROGRAM_TASK_SCHEDULER_SPEC_MK-DDC-24_VI.md) (C0.7),
> [`INTERFACES.md`](../../04_design/INTERFACES.md)

> **Thông báo supersede Target (2026-08-09):** tài liệu này tiếp tục mô tả subset
> ST đã hiện thực để bảo trì/test As-Built. Thiết kế Target ST/FBD, user
> `FUNCTION`/`FUNCTION_BLOCK`, diagnostic, limits và compiler pipeline thuộc
> [`DDD-LANG-PROG-001`](PROGRAMMING_LANGUAGE_COMPILER_DESIGN.md). Khi có khác
> biệt, Product/SRS/decision đã phê duyệt và `DDD-LANG-PROG-001` là authority;
> không dùng đường dẫn `services/core/st/` đã cũ để suy trạng thái production.

---

## 0. Tài liệu này là gì và không là gì

**Là:** đặc tả Supporting As-Built của tập con Structured Text mà FW SOM chấp
nhận. Parser, semantic analyzer và compiler hiện nằm trong
`apps/core/application/st/`. Khi source đã test lệch hồ sơ này, phải mở finding
và reconcile với `DDD-LANG-PROG-001`; không tự coi mô tả lịch sử thắng code hay
Target Design hiện hành.

**Không là:** tài liệu tuyên bố tuân thủ IEC 61131-3. MK-DDC-24 Rev A.0 dùng cụm
**"IEC 61131-3-aligned"** — vay mượn cú pháp và ngữ nghĩa ở nơi hợp lý, không claim
`compliant`/`conformant`/`certified` (ADR-020). §9 liệt kê rõ những chỗ cố ý khác chuẩn.

---

## 1. Nguyên tắc thiết kế

| # | Nguyên tắc | Hệ quả cụ thể |
|---|---|---|
| P1 | **Mọi chương trình phải chấm dứt trong thời gian chặn trên được** | Không có `WHILE`/`REPEAT`/`FOR` với biên động, không có đệ quy, không có con trỏ. Một scan luôn kết thúc. |
| P2 | **Không cấp phát bộ nhớ khi chạy** | Không có mảng động, không có `STRING` biến độ dài, mọi kích thước biết tại compile time. |
| P3 | **Kiểu chặt, không ép ngầm giữa biến** | Trộn `INT` và `REAL` phải qua hàm chuyển đổi tường minh. Ngoại lệ duy nhất: literal số (§3.4). |
| P4 | **Mọi giới hạn là hữu hạn và công bố** | §8. Vượt giới hạn trả diagnostic ổn định, không bao giờ crash. |
| P5 | **Chỉ thêm cái điều khiển HVAC thật cần** | Có timer và edge-detect (thiếu chúng thì không viết được logic chống dao động). Không có `CASE`, `STRUCT`, `ARRAY` ở Rev A.0. |

---

## 2. Cấu trúc chương trình

Một artifact chứa **đúng một** `PROGRAM`. Nhiều Program chạy song song là việc của
Task scheduler (C0.7), không phải của một file source.

```iecst
PROGRAM <tên>
VAR_INPUT
    <khai báo biến>
END_VAR
VAR_OUTPUT
    <khai báo biến>
END_VAR
VAR
    <khai báo biến cục bộ và instance FB>
END_VAR
VAR RETAIN
    <khai báo biến giữ qua restart>
END_VAR
    <thân chương trình>
END_PROGRAM
```

Quy tắc:

- Thứ tự các khối `VAR_*` **tự do**, mỗi loại xuất hiện **tối đa một lần**.
- Mọi khối `VAR_*` đều **có thể vắng mặt**. Chương trình không có `VAR_INPUT` là hợp lệ.
- `VAR_INPUT` **chỉ đọc** trong thân chương trình. Gán vào nó là lỗi `ST-SEM-003`.
- `VAR_OUTPUT` đọc và ghi được. Giá trị đầu chu kỳ là giá trị **đã commit** của chu kỳ trước.
- `VAR` là biến cục bộ, **mất giá trị khi restart** (cold start). Giữ giá trị giữa các chu kỳ.
- `VAR RETAIN` giữ giá trị **qua restart** theo chính sách ở §7.
- Instance Function Block chỉ được khai báo trong `VAR` hoặc `VAR RETAIN`.

---

## 3. Hệ kiểu

### 3.1 Kiểu cơ sở

> **Đính chính 2026-08-15 (WP-04, D-06, `REV-PROG-OVERVIEW-DESIGN-GAP-2026-08-15`
> §7.3):** bản 1.0 (2026-07-28) của bảng dưới đây sai hai chỗ, xác nhận lại trực
> tiếp từ `apps/core/application/st/st_program.cpp` (`st_integer_min/max`)
> — không phải suy đoán: (1) `INT` là **int16**, không phải int32 như bản cũ ghi;
> (2) `DINT`/`UINT` **đã tồn tại và hoạt động** trong compiler/runtime, không
> phải "không có" như bản cũ khẳng định. Trạng thái phê duyệt: **Implemented —
> cần bổ sung Test Result/V&V chính thức** (chưa có nghĩa là "chưa tồn tại");
> xem `56_PROGRAMMING_IMPLEMENTATION_MASTER_PLAN_2026Q3.md` WP-04.

| Kiểu | Biểu diễn | Miền giá trị | Giá trị khởi tạo | Trạng thái |
|---|---|---|---|---|
| `BOOL` | 1 byte | `FALSE`, `TRUE` | `FALSE` | Implemented |
| `INT` | **int16** (bù 2) | −32 768 … 32 767 | `0` | Implemented |
| `DINT` | int32 (bù 2) | −2 147 483 648 … 2 147 483 647 | `0` | Implemented — cần Test Result/V&V bổ sung |
| `UINT` | uint16 | 0 … 65 535 | `0` | Implemented — cần Test Result/V&V bổ sung |
| `REAL` | IEEE-754 binary32 | hữu hạn (NaN/Inf **bị từ chối**, §6.3) | `0.0` | Implemented |
| `TIME` | int64, đơn vị **nanosecond** | 0 … ~292 năm; **không âm** | `T#0s` | Implemented |

Rev A.0 **không có**: `SINT`/`LINT`/`USINT`/`UDINT`/`ULINT`, `LREAL`,
`BYTE`/`WORD`/`DWORD`, `STRING`/`WSTRING`, `DATE`/`TIME_OF_DAY`/`DATE_AND_TIME`,
`ARRAY`, `STRUCT`, kiểu người dùng định nghĩa, con trỏ, `ANY`.

### 3.2 Literal

| Kiểu | Cú pháp | Ví dụ |
|---|---|---|
| `BOOL` | `TRUE` \| `FALSE` | `TRUE` |
| số nguyên | chuỗi chữ số thập phân, tuỳ chọn dấu `-` phía trước là **toán tử**, không thuộc literal | `0`, `42`, `1000` |
| số thực | chữ số `.` chữ số — **bắt buộc có chữ số hai bên dấu chấm** | `0.0`, `3.14`, `100.0` |
| `TIME` | `T#` theo sau ≥1 nhóm `<số><đơn vị>` | `T#30s`, `T#1m30s`, `T#500ms`, `T#2h15m` |

Đơn vị `TIME` hợp lệ, phải viết theo thứ tự giảm dần và **không lặp**:
`d` (ngày), `h` (giờ), `m` (phút), `s` (giây), `ms` (mili giây).

> `T#1m30s` hợp lệ. `T#30s1m` sai thứ tự → `ST-LEX-002`. `T#1m1m` lặp → `ST-LEX-002`.

Không hỗ trợ: literal cơ số khác 10 (`16#FF`), dấu gạch dưới phân nhóm (`1_000`),
ký hiệu mũ (`1.5e3`), literal có tiền tố kiểu (`INT#5`).

### 3.3 Quy tắc kiểu chặt

Toán hạng của một toán tử hai ngôi phải **cùng kiểu**. Không có ép kiểu ngầm giữa biến.

```iecst
VAR  i : INT;  r : REAL;  END_VAR
r := i;              (* ST-SEM-002: INT không tự thành REAL *)
r := INT_TO_REAL(i); (* đúng *)
```

### 3.4 Ngoại lệ duy nhất — literal số đa hình

Literal **số nguyên không dấu chấm** nhận kiểu từ ngữ cảnh: có thể là `INT` hoặc `REAL`.
Literal **có dấu chấm** luôn là `REAL`.

```iecst
r := r + 1;      (* đúng — 1 lấy kiểu REAL từ r *)
i := i + 1;      (* đúng — 1 lấy kiểu INT từ i *)
i := i + 1.0;    (* ST-SEM-002 — 1.0 là REAL, i là INT *)
```

Lý do ngoại lệ: bắt viết `1.0` và `1` đúng chỗ trong mọi biểu thức là nguồn lỗi vặt
không mang lại an toàn nào, trong khi literal luôn biết giá trị tại compile time nên
việc chọn kiểu là quyết định tĩnh, kiểm tra được. Literal nguyên vượt miền `INT` khi
được ép về `INT` là lỗi `ST-SEM-008`.

### 3.5 Hàm chuyển đổi kiểu

| Hàm | Chữ ký | Ngữ nghĩa |
|---|---|---|
| `INT_TO_REAL` | `(INT) : REAL` | Chính xác (int16 luôn biểu diễn được trong binary32 không mất bit) |
| `REAL_TO_INT` | `(REAL) : INT` | Làm tròn **về số nguyên gần nhất, .5 làm tròn ra xa 0**. Ngoài miền `INT` hoặc không hữu hạn → runtime fault `ST-RT-003` |
| `TIME_TO_REAL` | `(TIME) : REAL` | Trả về **số giây** dạng `REAL` |
| `REAL_TO_TIME` | `(REAL) : TIME` | Nhận **số giây**; âm hoặc không hữu hạn → `ST-RT-003` |

**Đính chính 2026-08-15 (WP-04, D-06):** 10 hàm dưới đây có thật trong compiler
(`st_program.cpp`, `st_semantic.cpp`, `st_compile.cpp`) nhưng thiếu ở bản 1.0 —
đi cùng `DINT`/`UINT` ở §3.1. Trạng thái: **Implemented — cần Test Result/V&V
bổ sung**, cùng nhóm với hai kiểu trên, chưa phải một tính năng mới độc lập.

| Hàm | Chữ ký | Ngữ nghĩa |
|---|---|---|
| `INT_TO_DINT` | `(INT) : DINT` | Chính xác, mở rộng dấu |
| `INT_TO_UINT` | `(INT) : UINT` | Giá trị âm hoặc ngoài miền `UINT` → runtime fault `ST-RT-003` |
| `DINT_TO_INT` | `(DINT) : INT` | Ngoài miền `INT` → runtime fault `ST-RT-003` |
| `DINT_TO_UINT` | `(DINT) : UINT` | Âm hoặc ngoài miền `UINT` → runtime fault `ST-RT-003` |
| `UINT_TO_INT` | `(UINT) : INT` | Ngoài miền `INT` → runtime fault `ST-RT-003` |
| `UINT_TO_DINT` | `(UINT) : DINT` | Chính xác, luôn trong miền `DINT` |
| `DINT_TO_REAL` | `(DINT) : REAL` | Có thể mất chính xác ở biên (int32 → binary32, giống IEC 61131-3 chuẩn) |
| `UINT_TO_REAL` | `(UINT) : REAL` | Chính xác (uint16 luôn biểu diễn được trong binary32) |
| `REAL_TO_DINT` | `(REAL) : DINT` | Làm tròn như `REAL_TO_INT`. Ngoài miền `DINT` hoặc không hữu hạn → `ST-RT-003` |
| `REAL_TO_UINT` | `(REAL) : UINT` | Làm tròn như `REAL_TO_INT`. Âm, ngoài miền `UINT` hoặc không hữu hạn → `ST-RT-003` |

---

## 4. Biểu thức

### 4.1 Thứ tự ưu tiên (cao → thấp)

| Mức | Toán tử | Kết hợp |
|---|---|---|
| 1 | `( )` | — |
| 2 | Gọi hàm, truy cập thành viên `.` | trái |
| 3 | `-` (đảo dấu), `NOT` | phải |
| 4 | `*`, `/`, `MOD` | trái |
| 5 | `+`, `-` | trái |
| 6 | `<`, `>`, `<=`, `>=` | trái |
| 7 | `=`, `<>` | trái |
| 8 | `AND` | trái |
| 9 | `XOR` | trái |
| 10 | `OR` | trái |

Thứ tự này theo IEC 61131-3 (bỏ mức `**`). **Không hỗ trợ toán tử `&`** (bí danh của
`AND` trong chuẩn) — một cách viết cho một ý nghĩa.

### 4.2 Bảng kiểu của toán tử

| Toán tử | Kiểu toán hạng hợp lệ | Kiểu kết quả |
|---|---|---|
| `+`, `-`, `*` | `INT×INT`, `REAL×REAL`, `TIME×TIME` (chỉ `+`,`-`) | như toán hạng |
| `/` | `INT×INT`, `REAL×REAL` | như toán hạng |
| `MOD` | `INT×INT` | `INT` |
| `-` (một ngôi) | `INT`, `REAL` | như toán hạng |
| `<`,`>`,`<=`,`>=` | `INT×INT`, `REAL×REAL`, `TIME×TIME` | `BOOL` |
| `=`, `<>` | `BOOL×BOOL`, `INT×INT`, `REAL×REAL`, `TIME×TIME` | `BOOL` |
| `AND`, `OR`, `XOR` | `BOOL×BOOL` | `BOOL` |
| `NOT` | `BOOL` | `BOOL` |

`TIME * INT` và `TIME / INT` **không** được hỗ trợ ở Rev A.0 (dùng `REAL_TO_TIME` nếu cần).

### 4.3 Ngữ nghĩa số học

- **`INT` tràn số:** phát hiện và trả runtime fault `ST-RT-001`. **Không** wrap-around
  im lặng. Lý do: một giá trị đếm bị wrap trong logic điều khiển là lỗi âm thầm nguy
  hiểm hơn nhiều so với một fault có chẩn đoán.
- **`INT` chia cho 0** và **`MOD` với 0:** runtime fault `ST-RT-002`.
- **`REAL` chia cho 0:** runtime fault `ST-RT-002`. Không sinh `Inf` (§6.3).
- **`MOD`:** dấu của kết quả theo **số bị chia** (giống C99 `%`).
- **`REAL`:** mọi kết quả phải hữu hạn; `NaN`/`Inf` là runtime fault `ST-RT-004`.
- **`TIME`:** kết quả âm là runtime fault `ST-RT-005`.

### 4.4 Đánh giá không rút gọn

`AND`/`OR` **luôn đánh giá cả hai toán hạng** (không short-circuit).

Lý do: thời gian thực thi phải ổn định giữa các chu kỳ để WCET có nghĩa. Short-circuit
làm thời gian phụ thuộc dữ liệu. Vì ngôn ngữ không có tác dụng phụ trong biểu thức và
mọi lỗi số học đều là fault tường minh, không rút gọn là an toàn.

---

## 5. Câu lệnh

### 5.1 Gán

```iecst
<biến> := <biểu thức>;
```

Kiểu hai vế phải khớp (§3.3). Đích không được là `VAR_INPUT` (`ST-SEM-003`) hoặc
instance FB (`ST-SEM-009`).

### 5.2 IF

```iecst
IF <đk> THEN <lệnh>* 
ELSIF <đk> THEN <lệnh>*      (* 0..n lần *)
ELSE <lệnh>*                  (* tuỳ chọn *)
END_IF;
```

`<đk>` phải là `BOOL` (`ST-SEM-002`). Dấu `;` sau `END_IF` là **bắt buộc**.

### 5.3 Gọi Function Block

```iecst
<instance>(<tên tham số> := <biểu thức>, ...);
```

- Chỉ dùng **tham số đặt tên**, không dùng tham số theo vị trí. Lý do: thứ tự tham số
  là chi tiết dễ nhớ nhầm, và tên tham số làm chương trình đọc được mà không cần tra cứu.
- Tham số vào không truyền giữ **giá trị của lần gọi trước** (đúng ngữ nghĩa IEC).
- Một instance được gọi **tối đa một lần mỗi chu kỳ** (`ST-SEM-010`). Gọi hai lần làm
  ngữ nghĩa timer mất ý nghĩa.
- Gọi FB là **câu lệnh**, không phải biểu thức. Đọc kết quả qua truy cập thành viên.

### 5.4 Truy cập thành viên

```iecst
<instance>.<tên đầu ra>
```

Chỉ đọc. Chỉ áp dụng cho instance FB đã khai báo. Ghi vào thành viên là `ST-SEM-011`.

### 5.5 Không có trong Rev A.0

`CASE`, `FOR`, `WHILE`, `REPEAT`, `EXIT`, `CONTINUE`, `RETURN`, `GOTO`, gọi `FUNCTION`
do người dùng định nghĩa, `FUNCTION_BLOCK` do người dùng định nghĩa.

---

## 6. Thư viện chuẩn

### 6.1 Hàm (không trạng thái)

| Hàm | Chữ ký | Ngữ nghĩa |
|---|---|---|
| `ABS` | `(INT):INT`, `(REAL):REAL` | Giá trị tuyệt đối. `ABS(INT_MIN)` → `ST-RT-001` |
| `MIN` | `(T,T):T` với `T ∈ {INT,REAL,TIME}` | Nhỏ hơn |
| `MAX` | `(T,T):T` | Lớn hơn |
| `LIMIT` | `(MN:T, IN:T, MX:T):T` | Kẹp `IN` vào `[MN,MX]`. `MN > MX` → `ST-RT-006` |
| `SEL` | `(G:BOOL, IN0:T, IN1:T):T` | `G` sai → `IN0`, đúng → `IN1`. **Cả hai nhánh đều được đánh giá** (§4.4) |
| `SQRT` | `(REAL):REAL` | Căn bậc hai. Đối số âm → `ST-RT-007` |
| `INT_TO_REAL`, `REAL_TO_INT`, `TIME_TO_REAL`, `REAL_TO_TIME` | §3.5 | |

Không có: hàm lượng giác, `LN`/`LOG`/`EXP`, `EXPT`, `TRUNC`, `ROUND`, thao tác bit,
thao tác chuỗi.

### 6.2 Function Block (có trạng thái)

| FB | Vào | Ra | Ngữ nghĩa |
|---|---|---|---|
| `TON` | `IN:BOOL`, `PT:TIME` | `Q:BOOL`, `ET:TIME` | Trễ khi bật: `IN` đúng liên tục đủ `PT` thì `Q` lên. `IN` sai → `Q` sai, `ET` về 0 |
| `TOF` | `IN:BOOL`, `PT:TIME` | `Q:BOOL`, `ET:TIME` | Trễ khi tắt: `IN` đúng → `Q` đúng ngay. `IN` xuống sai, `Q` giữ đúng thêm `PT` |
| `R_TRIG` | `CLK:BOOL` | `Q:BOOL` | `Q` đúng đúng **một chu kỳ** khi `CLK` chuyển sai→đúng |
| `F_TRIG` | `CLK:BOOL` | `Q:BOOL` | `Q` đúng đúng **một chu kỳ** khi `CLK` chuyển đúng→sai |
| `PID` | `SP,PV,KP,KI,KD,OUT_MIN,OUT_MAX,ACTUAL:REAL` | `OUT:REAL`, `TRACKING:BOOL` | PID vòng đơn (`st_program.cpp`, `TASK-PROG-303`, `DDD-CTRL-PROG-001` §7). `ACTUAL` là giá trị output THẬT SỰ đang được áp (đọc ngược qua Point Table, kể cả khi bị override ưu tiên cao hơn) — chương trình phải tự wire binding riêng cho `ACTUAL`, FB không tự đọc `PriorityResolver`. Dùng để phát hiện override và đóng băng bộ tích phân (anti-windup back-calculation); `TRACKING=TRUE` khi đang đóng băng |

> **Đính chính 2026-08-15 (WP-04, D-06):** `PID` có thật trong compiler/runtime
> (`StFbType::PID`) nhưng thiếu ở bản 1.0 của bảng này. **Trạng thái phê duyệt
> khác hẳn `DINT`/`UINT` ở §3.1**: `PROGRAMMING_LANGUAGE_COMPILER_DESIGN.md`
> tự ghi rõ "Unit/conversion/PID semantic chưa khóa" — cần **Controls +
> Safety review chính thức** ngữ nghĩa (anti-windup, giới hạn `OUT_MIN/MAX`,
> hành vi khi `ACTUAL` mất nguồn) trước khi công bố sẵn sàng dùng cho end
> user, dù code đã chạy được. Không dùng `PID` cho logic điều khiển sản xuất
> cho tới khi review này đóng — xem
> `56_PROGRAMMING_IMPLEMENTATION_MASTER_PLAN_2026Q3.md` WP-04.

Ngữ nghĩa thời gian của `TON`/`TOF`:

- `ET` **bão hoà tại `PT`**, không vượt quá.
- Cơ sở thời gian là **đồng hồ đơn điệu (`CLOCK_MONOTONIC`) chụp một lần tại đầu chu kỳ**
  và dùng chung cho toàn bộ chu kỳ. Mọi FB trong cùng một chu kỳ nhìn thấy **cùng một mốc
  thời gian** — hai timer khởi động cùng chu kỳ sẽ hết hạn cùng chu kỳ, tất định.
- Độ phân giải hiệu dụng bằng chu kỳ Task. `PT` nhỏ hơn chu kỳ Task được chấp nhận nhưng
  `Q` không thể lên sớm hơn chu kỳ kế tiếp — compiler phát cảnh báo `ST-WARN-001`.
- `PT` âm là không thể (kiểu `TIME` không âm, §3.1). `PT = T#0s` → `Q` theo `IN` ngay chu kỳ đó.

Trạng thái nội bộ của FB nằm trong instance. Instance khai báo trong `VAR RETAIN` giữ
trạng thái qua restart theo §7; trong `VAR` thì khởi tạo lại (cold start).

### 6.3 Chính sách NaN/Inf

`NaN` và `Inf` **không bao giờ** là giá trị hợp lệ của `REAL` trong runtime này.

- Đầu vào từ process image: kiểm tại biên; không hữu hạn → chu kỳ fault, **không commit
  output**, quality của điểm liên quan không được publish là GOOD.
- Kết quả trung gian: kiểm sau mỗi phép toán `REAL`; không hữu hạn → `ST-RT-004`.

Lý do khắt khe: trong hệ điều khiển, một `NaN` lan âm thầm tới đầu ra analog nguy hiểm
hơn nhiều so với một fault dừng chu kỳ và chuyển safe-state.

---

## 7. RETAIN

- Chỉ `BOOL`, `INT`, `REAL`, `TIME` và instance FB chuẩn được khai báo `RETAIN`.
- Bản ghi retain có **schema version** và **CRC-32**; ghi **atomic** (tmp + `rename`).
- Không ghi mỗi chu kỳ. Chính sách ghi: **chỉ khi có thay đổi** và **giãn cách tối thiểu
  60 giây**, cộng một lần ghi khi shutdown sạch. Chi tiết ở C0.7 §RETAIN.
- Khi khôi phục, **bất kỳ điều nào sau đây làm bản ghi bị từ chối** và chương trình
  cold-start với chẩn đoán tường minh: CRC sai, schema version khác, layout biến khác
  (tên/kiểu/thứ tự), hash artifact khác.
- Từ chối bản ghi retain **không bao giờ** là lý do để không khởi động chương trình.

---

## 8. Giới hạn tài nguyên

Nguồn thực thi: [`apps/core/application/st/st_limits.hpp`](../../../apps/core/application/st/st_limits.hpp).

| Giới hạn | Giá trị | Code khi vượt |
|---|---|---|
| Kích thước source | 64 KiB | `ST-LIM-001` |
| Số token | 32 768 | `ST-LIM-002` |
| Số biến (mọi khối `VAR_*`) | 512 | `ST-LIM-003` |
| Số statement | 4 096 | `ST-LIM-004` |
| Độ dài identifier | 64 ký tự | `ST-LIM-005` |
| Số diagnostic trả về | 64 | `ST-LIM-006` |
| Độ sâu lồng biểu thức | 32 | `ST-SYN-002` |
| Độ sâu lồng statement | 16 | `ST-SYN-002` |
| Số instance FB | 64 | `ST-LIM-007` |
| Số biến RETAIN | 128 | `ST-LIM-008` |

Các giá trị này là **normative**. Đổi giá trị = đổi contract với BE, phải bump
`irSchemaVersion` và cập nhật `INTERFACES.md`.

---

## 9. Khác biệt cố ý so với IEC 61131-3

| # | Chuẩn nói | MK-DDC-24 làm | Lý do |
|---|---|---|---|
| D1 | `AND`/`OR` có thể rút gọn | Luôn đánh giá đủ | WCET ổn định (§4.4) |
| D2 | Tràn số nguyên do implementation định nghĩa | Luôn là fault | Wrap âm thầm nguy hiểm trong điều khiển |
| D3 | Có `&` là bí danh của `AND` | Không hỗ trợ `&` | Một cách viết cho một ý nghĩa |
| D4 | Tham số FB theo vị trí hoặc theo tên | Chỉ theo tên | Đọc được, khó nhầm |
| D5 | Có `CASE`, vòng lặp, POU người dùng | Không có | P1, P2 — chấm dứt và không cấp phát |
| D6 | Nhiều kiểu số | Chỉ `INT`/`REAL` | Đủ cho HVAC, giảm bề mặt lỗi |
| D7 | `REAL` cho phép `NaN`/`Inf` | Luôn từ chối | §6.3 |
| D8 | Literal đa cơ số, dấu gạch dưới | Chỉ thập phân | Giảm bề mặt lexer |

Mọi khác biệt trên phải xuất hiện trong tài liệu bàn giao BE
([`FW_SOM_BE_INTEGRATION_GUIDE`](../../handoff/FW_SOM_BE_INTEGRATION_GUIDE.md)).

---

## 10. Grammar EBNF

Ký pháp: `{ x }` = 0..n lần, `[ x ]` = tuỳ chọn, `|` = chọn một, `" "` = ký tự nguyên văn.
Từ khoá **không phân biệt hoa thường**; định danh **có** phân biệt hoa thường.

```ebnf
program           = "PROGRAM" identifier
                    { var_block }
                    statement_list
                    "END_PROGRAM" ;

var_block         = ( "VAR_INPUT" | "VAR_OUTPUT" | "VAR" | "VAR" "RETAIN" )
                    { var_decl } "END_VAR" ;

var_decl          = identifier ":" type_name ";" ;

type_name         = "BOOL" | "INT" | "REAL" | "TIME"
                  | "TON" | "TOF" | "R_TRIG" | "F_TRIG" ;

statement_list    = { statement } ;

statement         = assignment | if_statement | fb_call ;

assignment        = variable ":=" expression ";" ;

if_statement      = "IF" expression "THEN" statement_list
                    { "ELSIF" expression "THEN" statement_list }
                    [ "ELSE" statement_list ]
                    "END_IF" ";" ;

fb_call           = identifier "(" [ param_assign { "," param_assign } ] ")" ";" ;

param_assign      = identifier ":=" expression ;

expression        = or_expr ;
or_expr           = xor_expr { "OR" xor_expr } ;
xor_expr          = and_expr { "XOR" and_expr } ;
and_expr          = equ_expr { "AND" equ_expr } ;
equ_expr          = cmp_expr { ( "=" | "<>" ) cmp_expr } ;
cmp_expr          = add_expr { ( "<" | ">" | "<=" | ">=" ) add_expr } ;
add_expr          = mul_expr { ( "+" | "-" ) mul_expr } ;
mul_expr          = unary_expr { ( "*" | "/" | "MOD" ) unary_expr } ;
unary_expr        = [ "-" | "NOT" ] primary_expr ;

primary_expr      = literal
                  | function_call
                  | member_access
                  | variable
                  | "(" expression ")" ;

function_call     = identifier "(" [ expression { "," expression } ] ")" ;
member_access     = identifier "." identifier ;
variable          = identifier ;

literal           = bool_literal | int_literal | real_literal | time_literal ;
bool_literal      = "TRUE" | "FALSE" ;
int_literal       = digit { digit } ;
real_literal      = digit { digit } "." digit { digit } ;
time_literal      = "T#" time_part { time_part } ;
time_part         = digit { digit } time_unit ;
time_unit         = "d" | "h" | "m" | "s" | "ms" ;

identifier        = ( letter | "_" ) { letter | digit | "_" } ;
letter            = "A".."Z" | "a".."z" ;
digit             = "0".."9" ;

comment           = "(*" { any_character } "*)" | "//" { any_character } newline ;
```

**Nhập nhằng đã giải quyết trong grammar:**

- `function_call` và `fb_call` cùng bắt đầu bằng `identifier "("`. Phân biệt bằng
  **ngữ cảnh**: `fb_call` là *câu lệnh* (kết thúc bằng `;` ở mức statement),
  `function_call` là *biểu thức*. Thêm nữa, semantic phase kiểm tên: nếu là instance FB
  đã khai báo thì phải là `fb_call`, nếu là tên hàm chuẩn thì phải là `function_call`.
  Dùng sai → `ST-SEM-012`.
- `unary_expr` cho phép **tối đa một** toán tử một ngôi liền nhau ở mỗi mức; `NOT NOT x`
  hợp lệ vì `primary_expr` có thể là `"(" expression ")"`, còn `- - x` phải viết `-(-x)`.
- Chú thích `(* *)` **không lồng nhau**. `(* a (* b *) c *)` kết thúc tại `*)` đầu tiên,
  phần `c *)` trở thành lỗi cú pháp.

---

## 11. Bảng đối chiếu grammar với parser hiện tại

Đối chiếu tại commit `7ccf992` (sau M-01, trước khi implement MS-02).

| Mục grammar | Parser hiện tại | Trạng thái |
|---|---|---|
| `PROGRAM`/`END_PROGRAM` | có | ✅ khớp |
| `VAR_INPUT`/`VAR_OUTPUT` | có | ✅ khớp |
| `VAR` (cục bộ) | **không có** | ❌ phải thêm |
| `VAR RETAIN` | **không có** | ❌ phải thêm |
| Kiểu `BOOL`, `REAL` | có | ✅ khớp |
| Kiểu `INT` | **không có** | ❌ phải thêm |
| Kiểu `TIME` + literal `T#` | **không có** | ❌ phải thêm |
| Gán `:=` | có | ✅ khớp |
| `IF`/`ELSE`/`END_IF` | có | ✅ khớp |
| `ELSIF` | **không có** | ❌ phải thêm |
| So sánh `< > <= >= = <>` | có | ⚠️ có nhưng **không cho chuỗi nhiều so sánh**; grammar mới cho `a < b < c` về mặt cú pháp, semantic sẽ bắt lỗi kiểu (`BOOL < INT`) |
| `AND`, `OR`, `NOT` | có | ✅ khớp |
| `XOR` | **không có** | ❌ phải thêm |
| Số học `+ - * / MOD` | **không có** | ❌ phải thêm |
| Đảo dấu một ngôi `-` | **không có** | ❌ phải thêm |
| Ngoặc đơn | có | ✅ khớp |
| Gọi hàm | có (chỉ `LIMIT`) | ⚠️ khung có, phải thêm hàm §6.1 |
| Gọi FB `inst(P := x)` | **không có** | ❌ phải thêm |
| Truy cập thành viên `inst.Q` | **không có** | ❌ phải thêm |
| Chú thích `(* *)`, `//` | **không có** | ❌ phải thêm |
| Từ khoá không phân biệt hoa thường | **không** — hiện phân biệt | ❌ phải sửa |
| Giới hạn tài nguyên §8 | có (M-01) | ✅ khớp, còn thiếu `ST-LIM-007/008` |

**Kết luận đối chiếu:** parser hiện tại phủ được khoảng **40%** grammar này. Phần thiếu
tập trung ở: số học, `INT`/`TIME`, Function Block, chú thích. Đây là đầu vào cho ACTION 6.

---

## 12. Danh mục diagnostic code

### 12.1 Lexer

| Code | Ý nghĩa |
|---|---|
| `ST-LEX-001` | Ký tự không hợp lệ |
| `ST-LEX-002` | Literal `TIME` sai định dạng (sai thứ tự đơn vị, lặp đơn vị, đơn vị lạ) |
| `ST-LEX-003` | Chú thích `(*` không được đóng trước hết file |

### 12.2 Syntax

| Code | Ý nghĩa |
|---|---|
| `ST-SYN-001` | Token không mong đợi |
| `ST-SYN-002` | Lồng quá sâu (biểu thức hoặc statement) |

### 12.3 Semantic

| Code | Ý nghĩa |
|---|---|
| `ST-SEM-001` | Biến chưa khai báo |
| `ST-SEM-002` | Kiểu không khớp |
| `ST-SEM-003` | Gán vào `VAR_INPUT` |
| `ST-SEM-004` | Khai báo trùng tên |
| `ST-SEM-005` | Kiểu không tồn tại |
| `ST-SEM-006` | Hàm không tồn tại |
| `ST-SEM-007` | Sai số lượng đối số |
| `ST-SEM-008` | Literal nguyên vượt miền `INT` |
| `ST-SEM-009` | Gán vào instance FB |
| `ST-SEM-010` | Gọi cùng một instance FB nhiều hơn một lần trong một chu kỳ |
| `ST-SEM-011` | Ghi vào thành viên đầu ra của FB |
| `ST-SEM-012` | Dùng instance FB như hàm, hoặc dùng hàm như instance FB |
| `ST-SEM-013` | Tham số FB không tồn tại hoặc trùng |
| `ST-SEM-014` | Kiểu không được phép `RETAIN` |

### 12.4 Runtime fault

Runtime fault **không** làm crash process; nó kết thúc chu kỳ, **không commit output**,
và được xử lý theo chính sách ở C0.7.

| Code | Ý nghĩa |
|---|---|
| `ST-RT-001` | Tràn số `INT` |
| `ST-RT-002` | Chia cho 0 |
| `ST-RT-003` | Chuyển kiểu ngoài miền |
| `ST-RT-004` | Kết quả `REAL` không hữu hạn |
| `ST-RT-005` | Kết quả `TIME` âm |
| `ST-RT-006` | `LIMIT` có `MN > MX` |
| `ST-RT-007` | `SQRT` đối số âm |
| `ST-RT-008` | Đầu vào process image không hữu hạn |

### 12.5 Giới hạn

`ST-LIM-001..008` — xem §8.

### 12.6 Cảnh báo

| Code | Ý nghĩa |
|---|---|
| `ST-WARN-001` | `PT` của timer nhỏ hơn chu kỳ Task |
| `ST-WARN-002` | Biến khai báo nhưng không dùng |
| `ST-WARN-003` | `VAR_OUTPUT` không bao giờ được gán |

Cảnh báo **không** chặn sinh artifact. Chính sách nâng cảnh báo thành lỗi là thuộc tính
của compiler profile (C0.6), không phải của ngôn ngữ.

---

## 13. Chương trình tham chiếu

Chương trình dưới đây là **test vector normative**: mọi thay đổi parser/compiler phải
giữ nó biên dịch được và cho kết quả như mô tả.

```iecst
PROGRAM AHU_FanControl
VAR_INPUT
    SupplyTemp  : REAL;     (* °C từ UI-01 *)
    Setpoint    : REAL;     (* °C từ AV *)
    Occupied    : BOOL;     (* từ schedule *)
END_VAR
VAR_OUTPUT
    FanEnable   : BOOL;
    FanSpeed    : REAL;     (* % 0..100 *)
    AlarmHigh   : BOOL;
END_VAR
VAR
    StartDelay  : TON;
    HighTrig    : R_TRIG;
    Deviation   : REAL;
END_VAR
VAR RETAIN
    StartCount  : INT;
END_VAR

    Deviation := SupplyTemp - Setpoint;

    (* Quạt chỉ chạy khi có người VÀ lệch quá 1°C liên tục 30 giây —
       chống bật/tắt liên tục quanh setpoint *)
    StartDelay(IN := Occupied AND (Deviation > 1.0), PT := T#30s);
    FanEnable := StartDelay.Q;

    // Tốc độ tỉ lệ độ lệch, kẹp trong 0..100
    FanSpeed := LIMIT(0.0, Deviation * 20.0, 100.0);

    AlarmHigh := Deviation > 5.0;

    (* Đếm số lần khởi động, giữ qua restart *)
    HighTrig(CLK := FanEnable);
    IF HighTrig.Q THEN
        StartCount := StartCount + 1;
    END_IF;
END_PROGRAM
```

Hành vi mong đợi (chu kỳ Task 1 s):

| Chu kỳ | `SupplyTemp` | `Setpoint` | `Occupied` | `FanEnable` | `FanSpeed` | `StartCount` |
|---|---|---|---|---|---|---|
| 1 | 28.0 | 24.0 | TRUE | FALSE (`ET`=0s) | 80.0 | 0 |
| 30 | 28.0 | 24.0 | TRUE | FALSE (`ET`=29s) | 80.0 | 0 |
| 31 | 28.0 | 24.0 | TRUE | **TRUE** (`ET`=30s) | 80.0 | **1** |
| 32 | 28.0 | 24.0 | TRUE | TRUE | 80.0 | 1 (không tăng — chỉ sườn lên) |
| 33 | 22.0 | 24.0 | TRUE | FALSE | 0.0 (kẹp) | 1 |

---

## 14. Revision history

| Rev | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-07-28 | Tạo mới. Đóng workstream C0.4 (MS-02). Chốt phạm vi: `BOOL`/`INT`/`REAL`/`TIME`, số học đầy đủ, `XOR`, `ELSIF`, chú thích, Function Block chuẩn `TON`/`TOF`/`R_TRIG`/`F_TRIG`, `VAR`/`VAR RETAIN`, 11 hàm chuẩn. Grammar EBNF đầy đủ, bảng đối chiếu với parser hiện tại (phủ ~40%), 8 khác biệt cố ý so với IEC, danh mục diagnostic code đầy đủ, chương trình tham chiếu normative. |
| 1.1 | 2026-08-15 | **WP-04 (D-06, `REV-PROG-OVERVIEW-DESIGN-GAP-2026-08-15` §7.3/§7.4).** Đính chính §3.1: `INT` là int16 (không phải int32 như 1.0 ghi sai); thêm `DINT`(int32)/`UINT`(uint16) — có thật trong `st_program.cpp`, 1.0 từng khẳng định sai là "không có". §3.5: thêm 10 hàm chuyển đổi `INT/DINT/UINT/REAL` có thật trong compiler nhưng thiếu ở 1.0. §6.2: thêm Function Block `PID` (8 input/2 output, có thật trong `st_program.cpp`) kèm ghi chú trạng thái phê duyệt — semantics PID **chưa được Controls+Safety review chính thức**, khác `DINT`/`UINT` (chỉ cần Test Result/V&V bổ sung, không cần review riêng). Xác nhận trực tiếp từ source, không suy đoán từ tài liệu khác. |
