# ST Subset Specification — MK-DDC-24 FW SOM Program Runtime

> **Document ID:** SW-ST-SUBSET-MK-DDC-24-VI
> **Phiên bản:** 1.3 | 2026-09-02 (đính chính §3.1/§5.5/§9/§12 theo `ISS-STED-08`, xem §14)
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
| `TIME` | int64, đơn vị **nanosecond** | **Literal:** 0 … 24 h. **Giá trị runtime:** 0 … ~292 năm; **không âm** (xem ghi chú dưới bảng) | `T#0s` | Implemented |

> **Đính chính 2026-09-02 (`ISS-STED-08`, `F-STED-006`) — `TIME` có HAI miền,
> không phải một.** Bản trước chỉ ghi *"0 … ~292 năm"*, tức miền lưu trữ, và
> im lặng về trần của **literal**. Người đọc dùng bảng này để thiết kế test sẽ
> viết một ca `T#48h` và không hiểu vì sao compiler từ chối.
>
> - **Literal `T#…` bị chặn ở 24 giờ**, tại thời điểm parse:
>   [`st_limits.hpp:57`](../../../apps/core/application/st/st_limits.hpp)
>   (`kMaxTimeLiteralNs = 86400000000000`), thi hành ở
>   [`st_parser.cpp:195`](../../../apps/core/application/st/st_parser.cpp),
>   mã `ST-LEX-002`. `DDD-LANG-PROG-001` §4.2 ghi đúng điều này từ đầu; chính
>   tài liệu **này** mới là chỗ sai.
> - **Giá trị `TIME` lúc chạy KHÔNG bị chặn ở 24 giờ.** `+`/`-` trên `TIME` cho
>   phép vượt qua trần literal; điều được thi hành ở runtime là **tràn int64**
>   (`ST-RT-001`) và **kết quả âm** (`ST-RT-005`) — xem
>   [`st_exec.cpp`](../../../apps/core/application/st/st_exec.cpp) nhánh
>   `ADD`/`SUB` của `StType::TIME`. Trừ ra âm là **fault**, không kẹp về 0 im
>   lặng, vì kẹp sẽ giấu lỗi logic của người viết chương trình.
>
> Viết gọn thành "`TIME` = 0..24 h" cũng sai, chỉ là sai theo chiều ngược lại:
> nó hứa một bất biến runtime mà compiler không thi hành.

Rev A.0 **không có**: `SINT`/`LINT`/`USINT`/`UDINT`/`ULINT`, `LREAL`,
`BYTE`/`WORD`/`DWORD`/`LWORD`, `STRING`/`WSTRING`,
`DATE`/`TIME_OF_DAY`/`DATE_AND_TIME`, `ARRAY`, `STRUCT`, kiểu người dùng định
nghĩa, con trỏ, `ANY`. Từng mục kèm **lý do** ở
[`st_language_profile_v1.json`](../../../contracts/programming/st_language_profile_v1.json)
(`deliberateExclusions`) — xem §9.

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

`FOR`, `WHILE`, `REPEAT`, `EXIT`, `RETURN`, `GOTO`, `CONTINUE`.

> **Đính chính 2026-09-02 (`ISS-STED-08`, `F-STED-006`).** Danh sách cũ còn kể
> thêm `CASE`, gọi `FUNCTION` do người dùng định nghĩa và `FUNCTION_BLOCK` do
> người dùng định nghĩa. **Cả ba đều đã có** — kết luận của `ISS-STED-07`, và
> nay được đo lại mỗi lần build chứ không phải khẳng định bằng lời:
> `CASE` xuất hiện với `"accepted": true` trong `statements`, còn `FUNCTION` và
> `FUNCTION_BLOCK` có trong `pouKinds` của
> [`st_language_profile_v1.json`](../../../contracts/programming/st_language_profile_v1.json),
> sinh bằng cách cho parser **nuốt thật** một mẫu tối thiểu.
>
> Nói "không có" về một thứ đã có là kiểu sai đắt nhất trong tài liệu ngôn ngữ:
> người viết chương trình đọc xong sẽ đi vòng qua một cấu trúc họ được phép
> dùng, và người lập kế hoạch sẽ xếp lịch làm lại thứ đã giao.

**Nguồn sự thật cho mục này** là hồ sơ sinh máy, không phải danh sách chép tay
ở trên: bảng câu lệnh §2 của
[`ST_LANGUAGE_PROFILE.generated.md`](ST_LANGUAGE_PROFILE.generated.md) ghi rõ
từng câu lệnh được chấp nhận hay bị từ chối, kèm mã lỗi khi bị từ chối. Danh
sách ở đây giữ lại để đọc nhanh và **phải** khớp với hồ sơ đó; lệch nhau thì
`ctest` (`st_language_profile_contract`) làm đỏ.

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

> **Đính chính 2026-09-02 (`ISS-STED-08`, `F-STED-006`/`F-STED-009`).** Bảng cũ
> sai hai dòng và thiếu bốn nhóm:
>
> - **D5 sai.** Nó ghi *"Có `CASE`, vòng lặp, POU người dùng → Không có"*. `CASE`
>   và POU người dùng **đã có** (§5.5); chỉ vòng lặp là không.
> - **D6 sai.** Nó ghi *"Chỉ `INT`/`REAL`"*. Compiler nhận **sáu** kiểu cơ sở:
>   `BOOL`, `INT`, `DINT`, `UINT`, `REAL`, `TIME` (§3.1).
> - **Thiếu** `VAR_IN_OUT`, toán tử `**`, các nhóm kiểu IEC vắng mặt, và các
>   hàm/Function Block thư viện chuẩn IEC vắng mặt — tất cả đều thiếu **thật**,
>   nhưng chưa được công bố kèm lý do. `ADR-054` phán quyết (3) buộc mọi loại
>   trừ phải công bố **kèm lý do**: loại trừ không nêu lý do là loại trừ im
>   lặng, và người dùng gặp `ST-SYN-001` cho một cấu trúc IEC hợp lệ sẽ không
>   có chỗ nào để đọc vì sao.

### 9.1 Khác biệt về ngữ nghĩa

| # | Chuẩn nói | MK-DDC-24 làm | Lý do |
|---|---|---|---|
| D1 | `AND`/`OR` có thể rút gọn | Luôn đánh giá đủ | WCET ổn định (§4.4) |
| D2 | Tràn số nguyên do implementation định nghĩa | Luôn là fault | Wrap âm thầm nguy hiểm trong điều khiển |
| D3 | Có `&` là bí danh của `AND` | Không hỗ trợ `&` | Một cách viết cho một ý nghĩa |
| D4 | Tham số FB theo vị trí hoặc theo tên | Chỉ theo tên | Đọc được, khó nhầm |
| D5 | Có `CASE`, vòng lặp, POU người dùng | `CASE` **có**, POU người dùng **có**; **vòng lặp không** (`FOR`/`WHILE`/`REPEAT`/`EXIT`) | P1 — mọi scan phải chấm dứt trong thời gian chặn trên biết trước; số vòng phụ thuộc dữ liệu làm WCET không tính được tĩnh |
| D6 | Nhiều kiểu số | Sáu kiểu cơ sở: `BOOL`, `INT`, `DINT`, `UINT`, `REAL`, `TIME` | Đủ cho HVAC, giảm bề mặt lỗi và bảng ép kiểu phải chứng minh |
| D7 | `REAL` cho phép `NaN`/`Inf` | Luôn từ chối | §6.3 |
| D8 | Literal đa cơ số, dấu gạch dưới | Chỉ thập phân | Giảm bề mặt lexer |
| D9 | `RETURN` thoát sớm khỏi POU | Không có | Nhiều điểm thoát làm cây WCET rẽ nhánh không cần thiết; `FUNCTION` gán kết quả qua ô mang tên hàm như IEC quy định |
| D10 | Có toán tử luỹ thừa `**` (và hàm `EXPT`) | Không có cả hai | Luỹ thừa trên REAL không có chặn trên chi phí tất định trên FPU mềm của target, và không có ca dùng HVAC nào trong Rev A. Dùng phép nhân tường minh |
| D11 | Có `VAR_IN_OUT` (truyền tham chiếu) | **Chưa có — đã lên lịch**, không phải loại trừ vĩnh viễn | Đi cùng `ARRAY` tĩnh và `STRUCT`: không có kiểu hợp thành thì truyền tham chiếu gần như vô dụng. Đợt gần, [#367](https://github.com/Mekong-HCM/MK-DDC-24/issues/367) |

### 9.2 Cấu trúc IEC vắng mặt — danh sách sinh máy, không chép tay

Bốn nhóm dưới đây **không** liệt kê lại trong tài liệu này. Chép tay một danh
sách 49 mục là tạo ra một bản sao sẽ trôi khỏi compiler, và đó đúng là lỗi mà
§10/§11 cũ đã mắc. Nguồn sự thật là hồ sơ máy đọc:

| Nhóm | Ví dụ | Nơi tra |
|---|---|---|
| Câu lệnh | `FOR`, `WHILE`, `REPEAT`, `EXIT`, `RETURN` | `deliberateExclusions` kind `statement` |
| Toán tử | `**` | `deliberateExclusions` kind `operator` |
| Kiểu | `SINT`, `USINT`, `LINT`, `ULINT`, `UDINT`, `LWORD`, `STRING`, `WSTRING`, `DATE`, `TOD`, `DT` | `deliberateExclusions` kind `type` |
| Hàm thư viện chuẩn | `LN`, `LOG`, `EXP`, `EXPT`, `SIN`, `COS`, `TAN`, `ASIN`, `ACOS`, `ATAN`, `TRUNC`, `MUX`, `SHL`, `SHR`, `ROL`, `ROR`, và họ hàm chuỗi (`LEN`, `LEFT`, `RIGHT`, `MID`, `CONCAT`, `INSERT`, `DELETE`, `REPLACE`, `FIND`) | `deliberateExclusions` kind `function` |
| Function Block chuẩn | `SR`, `RS`, `CTUD`, `RTC`, `SEMA` | `deliberateExclusions` kind `functionBlock` |

**Lộ trình bổ sung** — mục IEC nào làm ở đợt nào, mục nào **không** làm và vì
sao — ở [`ST_LIBRARY_ROADMAP_MK-DDC-24_VI.md`](ST_LIBRARY_ROADMAP_MK-DDC-24_VI.md)
(`ISS-STED-17`). Tài liệu đó cũng nói bốn khối `PID`/`HYSTERESIS`/`SCALE`/
`DEADBAND` là **mở rộng nhà sản xuất** và nhãn của chúng phải hiện ở nơi người
dùng **chọn** khối, không chỉ trong tài liệu.

**Mỗi mục kèm lý do riêng** trong
[`contracts/programming/st_language_profile_v1.json`](../../../contracts/programming/st_language_profile_v1.json),
và được kết xuất sang §5 của
[`ST_LANGUAGE_PROFILE.generated.md`](ST_LANGUAGE_PROFILE.generated.md) để đọc.

**Vì sao danh sách này đáng tin.** `ctest` chạy hai cổng:

1. `st_language_profile_contract` — đối chiếu **hai chiều** giữa hồ sơ và
   compiler. Một mục khai "loại trừ" mà compiler vẫn nhận ⇒ **đỏ** (đúng chế độ
   hỏng `F-STED-005`); một cấu trúc compiler từ chối mà hồ sơ không ghi lý do ⇒
   **đỏ**. `ISS-STED-08` mở rộng cổng này sang **thư viện** và **hệ kiểu**: khai
   "không có `SIN`" trong khi compiler đã có `SIN` sai đúng y như khai "không có
   `CASE`" trong khi đã có `CASE`. Cổng cũng bắt một mục ở `plannedAdditions` mà
   compiler **đã** hiện thực hoá — tài liệu không được hứa một thứ đã giao.
2. `st_language_profile_gate` — kiểm **chính cổng số 1** bằng cách tiêm sáu hồ
   sơ sai đã biết và đòi nó phải nổ đỏ từng ca. Một cổng luôn xanh có hai cách
   giải thích: nó đang kiểm và mọi thứ đều đúng, hoặc nó đã ngừng kiểm — từ
   ngoài nhìn vào, hai trường hợp ấy giống hệt nhau.

Mọi khác biệt trên phải xuất hiện trong tài liệu bàn giao BE
([`FW_SOM_BE_INTEGRATION_GUIDE`](../../handoff/FW_SOM_BE_INTEGRATION_GUIDE.md)).

---

## 10. Grammar EBNF — đã chuyển sang hồ sơ sinh máy

> **Nội dung §10 cũ đã bị gỡ** (`ISS-STED-06`, `F-STED-007`).

Văn phạm nay nằm ở **[`docs/02_design/software/ST_LANGUAGE_PROFILE.generated.md`](ST_LANGUAGE_PROFILE.generated.md)**
§9, sinh từ hợp đồng máy đọc
[`contracts/programming/st_language_profile_v1.json`](../../../contracts/programming/st_language_profile_v1.json).

**Vì sao chuyển.** EBNF chép tay ở §10 cũ đã trôi khỏi parser: nó không có luật
`CASE`, không có `FUNCTION`/`FUNCTION_BLOCK`, và bảng `type_name` chỉ liệt kê 4
kiểu cùng 4 Function Block trong khi compiler nhận 6 kiểu và 9 Function Block.
Một tài liệu văn phạm sai là công cụ sinh lỗi cho người viết chương trình.

**Cơ chế chống trôi.** `scripts/generate_st_language_profile.py --check` chạy
trong `ctest` (test `st_language_profile_contract`) và làm **đỏ** khi code trôi
khỏi hồ sơ. Cổng kiểm hai chiều:

1. mục nào khai là **loại trừ** mà compiler vẫn **chấp nhận** ⇒ đỏ — đây đúng là
   chế độ hỏng `F-STED-005`;
2. cấu trúc nào compiler **từ chối** mà hồ sơ không ghi **lý do** ⇒ đỏ, vì
   `ADR-054` buộc mọi loại trừ phải công bố kèm lý do.

**Nhập nhằng đã giải quyết trong grammar** (phần này vẫn thuộc §10, không sinh
máy được vì nó giải thích *quyết định*, không mô tả *hình dạng*):

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

## 11. Bảng đối chiếu grammar với parser — đã gỡ

> **Nội dung §11 cũ đã bị gỡ hoàn toàn** (`ISS-STED-06`, `F-STED-007`).

Bảng cũ ghim ở commit `7ccf992` và kết luận *"parser hiện tại phủ được khoảng
**40%** grammar này"*. Tại thời điểm gỡ, bảng đó **sai gần như từng dòng**:
`VAR`, `VAR RETAIN`, `INT`, `TIME` + literal `T#`, `ELSIF`, `XOR`, số học
`+ - * / MOD`, đảo dấu một ngôi, gọi FB, truy cập thành viên `inst.Q`, chú thích
và từ khoá không phân biệt hoa thường — tất cả đều đã có từ lâu, nhưng bảng vẫn
đánh dấu "❌ phải thêm".

**Một bảng đối chiếu sai 100% nguy hiểm hơn không có bảng, vì nó trông như bằng
chứng.** Người đọc dùng nó để lập kế hoạch sẽ lên lịch làm lại thứ đã có, và —
tệ hơn — sẽ tin rằng thứ *không* có thì cũng đã được liệt kê đúng.

Thay thế: **§2 và §3 của
[`ST_LANGUAGE_PROFILE.generated.md`](ST_LANGUAGE_PROFILE.generated.md)**. Cột
"chấp nhận" ở đó **không phải là một tuyên bố**: nó được đo bằng cách cho
compiler **parse thật** một mẫu tối thiểu cho từng câu lệnh và từng toán tử,
mỗi lần chạy generator. Bảng ấy không thể lạc hậu mà vẫn xanh.

---

## 12. Danh mục diagnostic code

### 12.1 Lexer

| Code | Ý nghĩa |
|---|---|
| `ST-LEX-001` | Ký tự không hợp lệ |
| `ST-LEX-002` | Literal `TIME` sai định dạng (sai thứ tự đơn vị, lặp đơn vị, đơn vị lạ) **hoặc vượt trần 24 giờ** (`st_limits.hpp:57`) |
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
| `ST-RT-001` | Tràn số nguyên (`INT`/`DINT`/`UINT`) **hoặc tràn int64 khi cộng/trừ `TIME`** |
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

| Code | Ý nghĩa | Trạng thái |
|---|---|---|
| `ST-WARN-001` | `PT` của timer nhỏ hơn chu kỳ Task | **Chưa hiện thực** — compiler không nhận chu kỳ Task làm đầu vào |
| `ST-WARN-002` | Biến khai báo nhưng không dùng | Đã phát (`#351`) |
| `ST-WARN-003` | `VAR_OUTPUT` không bao giờ được gán | Đã phát (`#351`) |
| `ST-WARN-004` | Đọc output của một instance FB **trước** lời gọi của nó trong cùng chu kỳ (`DDD-LANG-PROG-001` §4.3) | Đã phát (`#351`) |

Cảnh báo **không** chặn sinh artifact. Chính sách nâng cảnh báo thành lỗi là thuộc tính
của compiler profile (C0.6), không phải của ngôn ngữ. Hệ quả cho tầng gọi: quyết định
Check FAILED phải bám `severity`, **không** bám "có diagnostic hay không".

Hai bất biến của lượt phát cảnh báo sử dụng (`ST-WARN-002/003/004`):

1. **Vị trí trỏ dòng khai báo**, không trỏ chỗ dùng — với "khai báo mà không dùng" thì
   dòng khai báo là chỗ duy nhất sửa được.
2. **Có lỗi thì không phát cảnh báo sử dụng.** Lỗi làm việc soát dừng giữa chừng nên vết
   đọc/ghi không đầy đủ; phát cảnh báo trên dữ liệu dở dang sẽ báo "không dùng" cho biến
   thực ra có dùng ở câu lệnh chưa kịp soát. Tương tự, biến dùng **sai kiểu** vẫn tính là
   *được dùng*.

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
| 1.2 | 2026-09-01 | **`ISS-STED-06` / `F-STED-007`.** Gỡ hẳn EBNF chép tay ở §10 và bảng đối chiếu grammar↔parser ở §11. Cả hai đã trôi khỏi compiler: EBNF thiếu luật `CASE` và POU người dùng, còn bảng §11 ghim ở commit `7ccf992` kết luận *"phủ ~40%"* trong khi sai gần như từng dòng. Thay bằng hồ sơ **sinh máy** `contracts/programming/st_language_profile_v1.json` + `ST_LANGUAGE_PROFILE.generated.md`, đo bằng cách cho parser nuốt thật một mẫu tối thiểu cho từng câu lệnh/toán tử. Một tài liệu văn phạm sai là công cụ sinh lỗi cho người viết chương trình; một bảng đối chiếu sai 100% còn nguy hiểm hơn không có bảng, vì nó trông như bằng chứng. |
| 1.3 | 2026-09-02 | **`ISS-STED-08` / `F-STED-006`, `F-STED-009`.** Bốn đính chính, mỗi cái là một chỗ tài liệu nói sai về chính compiler đang chạy. **§3.1** — `TIME` có **hai** miền chứ không một: literal bị chặn ở **24 giờ** (`st_limits.hpp:57`, thi hành ở `st_parser.cpp:195`, mã `ST-LEX-002`), còn giá trị runtime chỉ bị chặn bởi tràn int64 (`ST-RT-001`) và kết quả âm (`ST-RT-005`). Bản 1.0/1.1 chỉ ghi *"0 … ~292 năm"* nên người đọc thiết kế test sẽ viết ca `T#48h` và không hiểu vì sao bị từ chối; nhưng rút gọn thành *"0..24 h"* cũng sai theo chiều ngược lại, vì nó hứa một bất biến runtime mà compiler không thi hành. **§5.5** — bỏ `CASE`, user `FUNCTION` và user `FUNCTION_BLOCK` khỏi danh sách "không có": cả ba **đã có** (kết luận `ISS-STED-07`, nay đo lại mỗi lần build). Nói "không có" về một thứ đã có khiến người viết chương trình đi vòng qua cấu trúc họ được phép dùng, và người lập kế hoạch xếp lịch làm lại thứ đã giao. **§9** — sửa D5 (`CASE`/POU người dùng đã có; chỉ vòng lặp là không) và D6 (sáu kiểu cơ sở, không phải chỉ `INT`/`REAL`); thêm D9 `RETURN`, D10 `**`/`EXPT`, D11 `VAR_IN_OUT` (chưa có nhưng **đã lên lịch**, #367); công bố **37 mục loại trừ mới** ở tầng kiểu/hàm/Function Block, mỗi mục **kèm lý do riêng**, đặt trong hồ sơ sinh máy thay vì chép tay — chép tay 49 mục là tạo một bản sao sẽ trôi khỏi compiler, đúng lỗi mà §10/§11 cũ đã mắc. **§12** — `ST-LEX-002` còn dùng cho literal `TIME` vượt trần 24 giờ, và `ST-RT-001` còn dùng cho tràn int64 khi cộng/trừ `TIME`; cả hai đều thiếu ở danh mục cũ. Kèm theo: cổng đối chiếu hai chiều được mở rộng sang **thư viện** và **hệ kiểu** (khai "không có `SIN`" trong khi đã có `SIN` sai y như khai "không có `CASE`" trong khi đã có `CASE`), và bổ sung `st_language_profile_gate` để kiểm **chính cổng** — một cổng luôn xanh có hai cách giải thích, và từ ngoài nhìn vào chúng giống hệt nhau. |
