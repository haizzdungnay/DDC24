# Typed IR và Artifact Contract — MK-DDC-24 FW SOM Program Runtime

> **Document ID:** SW-IR-ARTIFACT-MK-DDC-24-VI
> **Phiên bản:** 1.2 | 2026-08-13
> **Workstream:** C0.6 (MS-01)
> **Trạng thái:** Supporting As-Built — source hiện tại tại `apps/core/application/st/`; không phải Target authority Programming v2.2
> **Nguồn quyết định:** ADR-020; `PROGRAM_SOM_FW_DRAFT_DESIGN` §4, §7.2; quyết định ký gói 2026-07-28
> **Tài liệu liên quan:** [`ST_SUBSET_SPEC`](ST_SUBSET_SPEC_MK-DDC-24_VI.md) (C0.4),
> [`PROGRAM_TASK_SCHEDULER_SPEC`](PROGRAM_TASK_SCHEDULER_SPEC_MK-DDC-24_VI.md) (C0.7)

> **Thông báo supersede Target (2026-08-09):** layout/code loader hiện hữu vẫn
> hữu ích để bảo trì As-Built, nhưng Target stage/swap/compatibility và policy
> `HASH_ONLY` theo Product v2.2 thuộc
> [`IFSPEC-ART-PROG-001`](../interfaces/PROGRAMMING_ARTIFACT_LOADER_SPEC.md).
> Quy định Ed25519 normative trong bản cũ không tự động áp dụng cho Target mới;
> decision về integrity/provenance phải được phê duyệt trước khi đổi code.

---

## 0. Vấn đề tài liệu này giải quyết

`PROGRAM_SOM_FW_DRAFT_DESIGN` §4 quy định:

> Runtime **không** thực thi trực tiếp source ST hay JSON graph — chỉ thực thi artifact
> đã validate và compile thành typed IR.

Cho tới 2026-07-28, `StProgramRuntime::activate()` nhận **chuỗi source ST** và parse tại
chỗ (finding `F-02`). Đây là vi phạm trực tiếp thiết kế, và kéo theo ba hệ quả:

1. Không có ranh giới kiểm tra nào giữa "cái BE gửi" và "cái runtime chạy" — không thể
   reject theo magic/version/ABI/limit/hash vì không có gì để reject.
2. Parser (~600 dòng, bề mặt tấn công lớn) chạy **trong process điều khiển**, trong vòng
   `SCHED_FIFO 80`.
3. Không thể cấp phát bộ nhớ thực thi trước, vì layout chỉ biết sau khi parse.

Tài liệu này định nghĩa định dạng artifact và tập lệnh IR để tách hẳn compile khỏi execute.

---

## 1. Ranh giới trách nhiệm

```text
  BE SOM                    Compiler (mkddc-st-compile)         Runtime (mkddc-core)
 ────────                  ─────────────────────────────       ──────────────────────
  ST source  ──────────►   lexer → parser → semantic → IR  ──►  loader: verify
                           → serialize → SHA-256 → ký              ↓ (chỉ khi PASS)
                                    │                            execute IR
                                    ▼                            KHÔNG có parser
                             artifact bytes (.mkir)              trong đường này
```

**Bất biến tuyệt đối:** `mkddc-core` **không bao giờ** liên kết tới lexer/parser/semantic.
Vi phạm bất biến này được phát hiện bằng kiểm tra symbol trong CI (§10.3).

---

## 2. Định dạng file artifact

Định dạng: nhị phân, **little-endian**, không căn lề ngầm (mọi trường khai báo offset
tường minh). Đuôi khuyến nghị `.mkir`.

```text
 offset  size   trường
 ──────  ────   ─────────────────────────────────────────────────────
      0     8   magic            = "MKDDCIR1" (không có NUL kết thúc)
      8     2   schema_version   u16, hiện hành = 1
     10     2   compiler_profile u16, §2.2
     12     4   target_abi       u32, §2.3
     16     4   header_size      u32, = 128
     20     4   total_size       u32, kích thước toàn file tính bằng byte
     24     2   section_count    u16
     26     2   flags            u16, §2.4
     28     4   reserved0        u32, phải = 0
     32    32   sha256           §3.1
     64    64   ed25519_signature §3.2
    128   ...   bảng section (section_count × 16 byte), §2.5
    ...   ...   dữ liệu các section
```

`total_size` tối đa **1 MiB**. Artifact lớn hơn bị reject không cần đọc tiếp.

### 2.1 `magic`

8 byte ASCII `MKDDCIR1`. Chữ số cuối **không** phải version — nó thuộc magic. Đổi định
dạng theo cách phá vỡ tương thích ở mức cấu trúc file (chứ không phải mức nội dung) thì
đổi magic thành `MKDDCIR2`, để công cụ cũ báo "không phải file của tôi" thay vì
"file của tôi nhưng version lạ".

### 2.2 `compiler_profile`

Mã hoá tập tính năng ngôn ngữ mà artifact **yêu cầu** runtime phải hỗ trợ.

| Giá trị | Tên | Nội dung |
|---|---|---|
| `0x0001` | `MKDDC_ST_BASE_A0` | Toàn bộ [`ST_SUBSET_SPEC`](ST_SUBSET_SPEC_MK-DDC-24_VI.md) Rev A.0 |

Runtime reject nếu `compiler_profile` không nằm trong danh sách nó hỗ trợ. Đây là cơ
chế cho phép thêm tính năng ngôn ngữ sau này mà runtime cũ **từ chối rõ ràng** thay vì
chạy sai.

### 2.3 `target_abi`

Mã hoá giả định về biểu diễn dữ liệu và ngữ nghĩa số học của **máy đích**.

| Bit | Ý nghĩa khi bằng 1 |
|---|---|
| 0–7 | Phiên bản ABI (hiện hành = `0x01`) |
| 8 | Little-endian |
| 9 | `REAL` là IEEE-754 binary32 |
| 10 | `INT` là int32 bù 2 |
| 11 | `TIME` là int64 nanosecond |
| 12–31 | Dành riêng, phải = 0 |

Giá trị hiện hành: `0x00000F01`.

Runtime tự tính giá trị ABI của **chính nó** lúc khởi động (bằng `static_assert` và kiểm
endianness) rồi so khớp **chính xác**. Không có "tương thích một phần".

### 2.4 `flags`

| Bit | Ý nghĩa |
|---|---|
| 0 | Có section `DEBUG_SOURCEMAP` |
| 1 | Có biến `RETAIN` |
| 2 | Artifact đã ký (bit này bằng 0 nghĩa là `ed25519_signature` toàn 0) |
| 3–15 | Dành riêng, phải = 0 |

### 2.5 Bảng section

Mỗi mục 16 byte:

```text
 offset  size  trường
      0     2  section_type  u16, §2.6
      2     2  section_flags u16, phải = 0
      4     4  offset        u32, tính từ đầu file
      8     4  size          u32, byte
     12     4  item_count    u32, số phần tử (0 nếu section không phải mảng)
```

Ràng buộc bắt buộc, kiểm tại load:

- Mục trong bảng **sắp xếp tăng dần theo `section_type`**, không trùng `section_type`.
- `offset ≥ 128 + section_count × 16`.
- `offset + size ≤ total_size` và phép cộng **không tràn** u32.
- Các vùng `[offset, offset+size)` **không chồng lấn nhau**.
- `offset` chia hết cho 8.

### 2.6 Danh mục section

| Mã | Tên | Bắt buộc | Nội dung |
|---|---|---|---|
| `0x0001` | `METADATA` | ✅ | §4.1 |
| `0x0002` | `CONSTANTS` | ✅ | §4.2 |
| `0x0003` | `VARIABLES` | ✅ | §4.3 |
| `0x0004` | `CODE` | ✅ | §5 |
| `0x0005` | `IO_BINDING` | ✅ | §4.4 |
| `0x0006` | `FB_INSTANCES` | ✅ | §4.5 |
| `0x0007` | `RETAIN_LAYOUT` | khi `flags` bit 1 | §4.6 |
| `0x0008` | `DEBUG_SOURCEMAP` | khi `flags` bit 0 | §4.7 |

Section bắt buộc có thể có `item_count = 0` (ví dụ chương trình không dùng FB), nhưng
**mục trong bảng phải tồn tại**. Thiếu mục bắt buộc → reject.

---

## 3. Toàn vẹn và xác thực

### 3.1 SHA-256

`sha256` là digest SHA-256 của **toàn bộ file**, tính với vùng `sha256[32]` (offset 32)
và `ed25519_signature[64]` (offset 64) **đặt bằng 0**.

Cách tính này bao phủ cả header (nên không sửa được `target_abi`, `total_size`… mà không
bị phát hiện) lẫn toàn bộ dữ liệu.

Loader tính lại và so khớp **trước khi diễn giải bất kỳ section nào**. Sai → `IR-E-005`.

> Từ `TASK-PROG-203`, `compute_artifact_hash()` trả SHA-256 chữ thường 64 ký tự
> của source; field `source_hash` 64-bit trong layout legacy chỉ giữ prefix
> little-endian của cùng digest. Authority provenance đầy đủ nằm trong build
> manifest ngoài artifact; không dùng field rút gọn ở đường quyết định stage.

### 3.2 Chữ ký Ed25519

`ed25519_signature` là chữ ký Ed25519 (RFC 8032) trên **32 byte digest SHA-256** ở §3.1.

- Khoá riêng **không nằm trên thiết bị**. Ký thực hiện ở khâu build/release.
- Khoá công khai **nhúng trong binary** `mkddc-core` lúc biên dịch (mảng 32 byte hằng).
- Build CI dùng **khoá test riêng** cam kết trong repo tại
  `services/core/st/testdata/ed25519_test_key.*`; khoá này **chỉ hợp lệ với build test**
  và không bao giờ được dùng cho release.

Chính sách xác minh theo `flags` bit 2:

| Bit 2 | Chữ ký | Hành vi loader |
|---|---|---|
| 1 | có | Verify. Sai → `IR-E-006`. |
| 0 | trống | Reject `IR-E-007` **trừ khi** runtime được cấu hình `allow_unsigned = true` |

`allow_unsigned` mặc định **false** và chỉ bật được qua tham số dòng lệnh của
`mkddc-core` dành cho phát triển; khi bật, mỗi lần load ghi một dòng `WARN` vào audit log.

**Vì sao Ed25519 chứ không phải GPG như OTA (SEC-013):** OTA verify ảnh firmware bằng
*công cụ ngoài*, trong khi artifact chương trình phải verify **in-process, trong
`mkddc-core`, trên đường activation**. Kéo `libgpgme` vào một process chạy `SCHED_FIFO 80`
là không chấp nhận được về kích thước phụ thuộc lẫn hành vi thời gian. Ed25519 verify là
hàm thuần tuý, không cấp phát, không I/O, thời gian chạy ổn định. Hai tầng dùng hai cơ
chế là **có chủ ý**, được ghi ở đây để không bị hiểu là thiếu nhất quán.

---

## 4. Các section dữ liệu

### 4.1 `METADATA`

```text
 offset  size  trường
      0     4  program_name_len  u32, ≤ 64
      4    64  program_name      ASCII, đệm 0
     68     8  source_hash       u64, prefix little-endian của SHA-256 source canonical
     76    32  compiler_version  ASCII, đệm 0, vd "fwsom-st-1.0.0"
    108     8  build_timestamp   u64, Unix epoch giây, UTC
    116     4  slot_count        u32, tổng số ô trong không gian slot (§4.3)
    120     4  var_slot_count    u32, số ô ghi được (biến); phần còn lại là hằng
    124     4  reserved          u32, phải = 0
```

`build_timestamp` là field tương thích schema 1 và compiler deterministic hiện
ghi `0`; thời gian tạo thuộc metadata DB/audit, không nằm trong executable bytes.
Cùng source/profile/compiler/ABI phải tạo artifact byte-identical.

### 4.2 `CONSTANTS`

`item_count` phần tử, mỗi phần tử 16 byte:

```text
 offset  size  trường
      0     1  type   u8, §5.2
      1     7  padding, phải = 0
      8     8  value  — union theo type, little-endian
```

Biểu diễn `value` theo `type`: `BOOL` → byte 8 là 0/1, byte 9–15 = 0; `INT` → int32 tại
byte 8, byte 12–15 = 0; `REAL` → binary32 tại byte 8, byte 12–15 = 0; `TIME` → int64.

### 4.3 `VARIABLES` và không gian slot

Máy IR là **máy thanh ghi** trên một mảng ô phẳng. Slot đánh số từ 0.

```text
  [0 .. var_slot_count)              biến (ghi được)
  [var_slot_count .. slot_count)     hằng (chỉ đọc, nạp từ CONSTANTS lúc load)
```

Kiểm tại load: mọi toán hạng **đích** của mọi lệnh phải `< var_slot_count`. Đây là điều
làm cho "hằng không thể bị ghi đè" trở thành bất biến kiểm được, không phải quy ước.

Mỗi mục `VARIABLES` 80 byte:

```text
 offset  size  trường
      0    64  name           ASCII, đệm 0
     64     1  type           u8, §5.2
     65     1  storage_class  u8: 0=VAR_INPUT 1=VAR_OUTPUT 2=VAR 3=VAR_RETAIN
     66     2  slot           u16
     68     4  reserved       u32, phải = 0
     72     8  init_value     như §4.2 trường value
```

Ràng buộc: `slot < var_slot_count`; các `slot` **đôi một khác nhau**; `name` duy nhất.

### 4.4 `IO_BINDING`

```text
 offset  size  trường
      0     2  slot          u16, phải < var_slot_count
      2     1  direction     u8: 0=input 1=output
      3     1  point_kind    u8: 0=UI 1=DI 2=AO 3=DO 4=AV 5=BV 6=MSV
      4     2  point_index   u16, 1-based như point_id trong io_map
      6     1  type          u8, phải khớp type của biến tại slot
      7     1  reserved      u8, phải = 0
      8     4  scale_min     binary32  (chỉ dùng khi type = REAL)
     12     4  scale_max     binary32
```

Ràng buộc: một `slot` xuất hiện **tối đa một lần**; một cặp `(point_kind, point_index)`
với `direction = output` xuất hiện **tối đa một lần** trong toàn artifact (một đầu ra
vật lý chỉ có một người ghi — `PROGRAM_SOM_FW_DRAFT_DESIGN` §8).

### 4.5 `FB_INSTANCES`

```text
 offset  size  trường
      0    64  name              ASCII, đệm 0
     64     2  fb_type           u16: 1=TON 2=TOF 3=R_TRIG 4=F_TRIG
     66     2  input_slot_base   u16
     68     2  output_slot_base  u16
     70     2  state_index       u16
     72     1  retained          u8: 1 nếu khai báo trong VAR RETAIN
     73     7  reserved          phải = 0
```

Bố trí slot theo `fb_type` (liên tiếp từ base):

| `fb_type` | Slot vào | Slot ra |
|---|---|---|
| `TON`, `TOF` | `+0` = `IN` (BOOL), `+1` = `PT` (TIME) | `+0` = `Q` (BOOL), `+1` = `ET` (TIME) |
| `R_TRIG`, `F_TRIG` | `+0` = `CLK` (BOOL) | `+0` = `Q` (BOOL) |

`state_index` đánh số liên tục từ 0; runtime cấp mảng trạng thái kích thước
`item_count` **một lần lúc load**.

### 4.6 `RETAIN_LAYOUT`

```text
 offset  size  trường
      0     4  layout_hash   u32, CRC-32 của identity layout canonical v1
      4     4  record_size   u32, tổng byte biến RETAIN + state FB RETAIN canonical
      8     4  entry_count   u32, chỉ số biến VAR_RETAIN
     12     4  reserved      u32, phải = 0
     16   ...  entry_count × 8 byte: slot u16, type u8, reserved u8, offset u32
```

Identity đầu vào CRC là chuỗi bắt đầu bằng `MKDDC-RETAIN-LAYOUT:1;`, tiếp theo
theo thứ tự khai báo: `V:<name>:<type>:<offset>:<size>;` cho biến RETAIN và
`F:<name>:<fbType>:<offset>:<codecSize>;` cho FB RETAIN. Slot IR không thuộc
identity để việc chèn biến **không RETAIN** trước đó không vô hiệu hóa state.
Đổi tên/type/order/offset/codec size thì hash đổi. `record_size` bao gồm state FB
canonical: TON/TOF 10 byte, R_TRIG/F_TRIG 1 byte, PID 13 byte; cấm dùng
`sizeof(StFbState)` hoặc padding ABI.

CRC32 này là identity compact trong artifact; lúc prepare runtime, Core còn dựng
SHA-256 từ cùng identity canonical để ghi/đối chiếu RETAIN record v2.

### 4.7 `DEBUG_SOURCEMAP`

`item_count` mục, mỗi mục 8 byte: `pc` u32, `line` u16, `column` u16.

Section này **tuỳ chọn** và runtime không cần nó để chạy. Nó tồn tại để chẩn đoán runtime
fault chỉ đúng dòng ST gốc.

---

## 5. Tập lệnh IR

### 5.1 Mã hoá lệnh

Mọi lệnh **cố định 16 byte**. Độ dài cố định là lựa chọn có chủ ý: nó cho phép kiểm tra
biên toàn bộ chương trình bằng một vòng lặp tuyến tính tại load, và làm mọi mục tiêu nhảy
tính được chính xác mà không cần giải mã lại luồng lệnh.

```text
 offset  size  trường
      0     1  opcode  u8, §5.3
      1     1  type    u8, §5.2 — kiểu toán hạng
      2     2  dst     u16, slot đích
      4     2  a       u16, slot nguồn 1
      6     2  b       u16, slot nguồn 2
      8     2  c       u16, slot nguồn 3
     10     2  aux     u16, chỉ số FB instance (lệnh FB_CALL)
     12     4  imm     u32, mục tiêu nhảy (lệnh JMP/JMP_IF_FALSE)
```

Trường không dùng bởi một opcode phải **bằng 0**; loader kiểm và reject nếu khác 0.
Quy tắc này chặn kênh dữ liệu ẩn và bắt lỗi sinh mã sớm.

`CODE.item_count` = số lệnh. Tối đa **4 096** lệnh.

### 5.2 Mã kiểu

| Mã | Kiểu |
|---|---|
| `0` | `VOID` (lệnh không có kiểu toán hạng) |
| `1` | `BOOL` |
| `2` | `INT` |
| `3` | `REAL` |
| `4` | `TIME` |

### 5.3 Danh mục opcode

Cột "kiểu hợp lệ" liệt kê giá trị `type` được phép; loader reject mọi tổ hợp khác.

| Mã | Tên | Toán hạng dùng | Kiểu hợp lệ | Ngữ nghĩa |
|---|---|---|---|---|
| `0x00` | `NOP` | — | VOID | Không làm gì |
| `0x01` | `HALT` | — | VOID | Kết thúc chương trình thành công |
| `0x02` | `JMP` | `imm` | VOID | `pc = imm` |
| `0x03` | `JMP_IF_FALSE` | `a`, `imm` | BOOL | `if !slot[a] then pc = imm` |
| `0x10` | `MOV` | `dst`, `a` | mọi | `slot[dst] = slot[a]` |
| `0x20` | `ADD` | `dst`,`a`,`b` | INT, REAL, TIME | cộng |
| `0x21` | `SUB` | `dst`,`a`,`b` | INT, REAL, TIME | trừ |
| `0x22` | `MUL` | `dst`,`a`,`b` | INT, REAL | nhân |
| `0x23` | `DIV` | `dst`,`a`,`b` | INT, REAL | chia |
| `0x24` | `MOD` | `dst`,`a`,`b` | INT | chia dư, dấu theo số bị chia |
| `0x25` | `NEG` | `dst`,`a` | INT, REAL | đảo dấu |
| `0x30` | `LT` | `dst`,`a`,`b` | INT, REAL, TIME | `dst` là BOOL |
| `0x31` | `LE` | `dst`,`a`,`b` | INT, REAL, TIME | `dst` là BOOL |
| `0x32` | `GT` | `dst`,`a`,`b` | INT, REAL, TIME | `dst` là BOOL |
| `0x33` | `GE` | `dst`,`a`,`b` | INT, REAL, TIME | `dst` là BOOL |
| `0x34` | `EQ` | `dst`,`a`,`b` | BOOL, INT, REAL, TIME | `dst` là BOOL |
| `0x35` | `NE` | `dst`,`a`,`b` | BOOL, INT, REAL, TIME | `dst` là BOOL |
| `0x40` | `AND` | `dst`,`a`,`b` | BOOL | luôn đánh giá cả hai |
| `0x41` | `OR` | `dst`,`a`,`b` | BOOL | luôn đánh giá cả hai |
| `0x42` | `XOR` | `dst`,`a`,`b` | BOOL | |
| `0x43` | `NOT` | `dst`,`a` | BOOL | |
| `0x50` | `ABS` | `dst`,`a` | INT, REAL | |
| `0x51` | `MIN` | `dst`,`a`,`b` | INT, REAL, TIME | |
| `0x52` | `MAX` | `dst`,`a`,`b` | INT, REAL, TIME | |
| `0x53` | `LIMIT` | `dst`,`a`,`b`,`c` | INT, REAL, TIME | `a`=MN, `b`=IN, `c`=MX |
| `0x54` | `SEL` | `dst`,`a`,`b`,`c` | INT, REAL, TIME, BOOL | `a`=G (BOOL), `b`=IN0, `c`=IN1 |
| `0x55` | `SQRT` | `dst`,`a` | REAL | |
| `0x60` | `CVT_I2R` | `dst`,`a` | VOID | `a` là INT, `dst` là REAL |
| `0x61` | `CVT_R2I` | `dst`,`a` | VOID | làm tròn nửa ra xa 0 |
| `0x62` | `CVT_T2R` | `dst`,`a` | VOID | TIME → REAL (giây) |
| `0x63` | `CVT_R2T` | `dst`,`a` | VOID | REAL (giây) → TIME |
| `0x70` | `FB_CALL` | `aux` | VOID | Chạy FB instance `aux` |

Không có opcode nào cho vòng lặp lùi. **`JMP` và `JMP_IF_FALSE` chỉ được nhảy tiến**
(`imm > pc`) — loader kiểm và reject nếu nhảy lùi (`IR-E-014`). Đây là điều bảo đảm mọi
chương trình chấm dứt trong ≤ `item_count` bước, không cần phân tích thêm.

### 5.4 Ngữ nghĩa runtime fault

Điều kiện fault theo [`ST_SUBSET_SPEC`](ST_SUBSET_SPEC_MK-DDC-24_VI.md) §4.3 và §6.
Khi một lệnh sinh fault:

1. Thực thi **dừng ngay**, các lệnh sau không chạy.
2. **Không** commit bất kỳ output nào (staging bị huỷ).
3. Ghi lại `pc`, mã fault, và (nếu có `DEBUG_SOURCEMAP`) dòng/cột ST tương ứng.
4. Chuyển cho chính sách fault của Task scheduler (C0.7 §Fault).

---

## 6. Quy trình load

Loader chạy đúng thứ tự sau. **Mỗi bước phải PASS trước khi sang bước kế** — không có
bước nào được bỏ qua vì "chắc là đúng".

| # | Bước | Mã lỗi khi hỏng |
|---|---|---|
| 1 | Kích thước ≥ 128 và ≤ 1 MiB | `IR-E-001` |
| 2 | `magic` khớp `MKDDCIR1` | `IR-E-002` |
| 3 | `schema_version` được hỗ trợ | `IR-E-003` |
| 4 | `target_abi` khớp **chính xác** ABI của runtime | `IR-E-004` |
| 5 | `compiler_profile` được hỗ trợ | `IR-E-013` |
| 6 | `header_size` = 128, `total_size` = kích thước thật, `reserved0` = 0 | `IR-E-001` |
| 7 | SHA-256 khớp | `IR-E-005` |
| 8 | Chữ ký Ed25519 hợp lệ (hoặc `allow_unsigned`) | `IR-E-006` / `IR-E-007` |
| 9 | Bảng section: thứ tự, không trùng, không chồng lấn, trong biên, căn 8 | `IR-E-008` |
| 10 | Có đủ mọi section bắt buộc | `IR-E-009` |
| 11 | `size` mỗi section chia hết cho kích thước phần tử, khớp `item_count` | `IR-E-008` |
| 12 | Giới hạn tài nguyên (§7) | `IR-E-010` |
| 13 | `VARIABLES`: slot duy nhất, `< var_slot_count`, tên duy nhất | `IR-E-011` |
| 14 | `CONSTANTS`: `type` hợp lệ, padding = 0 | `IR-E-011` |
| 15 | `IO_BINDING`: slot trong biên, type khớp biến, không hai người ghi một output | `IR-E-012` |
| 16 | `FB_INSTANCES`: `fb_type` hợp lệ, mọi slot trong biên, `state_index` liên tục | `IR-E-011` |
| 17 | `CODE`: mọi `opcode` tồn tại, `type` hợp lệ với opcode, trường không dùng = 0 | `IR-E-014` |
| 18 | `CODE`: mọi slot toán hạng `< slot_count`; mọi `dst` `< var_slot_count` | `IR-E-014` |
| 19 | `CODE`: mọi `imm` của lệnh nhảy thoả `pc < imm ≤ item_count` | `IR-E-014` |
| 20 | `CODE`: `aux` của `FB_CALL` `< FB_INSTANCES.item_count` | `IR-E-014` |
| 21 | `RETAIN_LAYOUT`: bắt buộc khi có biến/FB RETAIN và cấm khi rỗng; section/count/size/reserved canonical; mỗi biến đúng thứ tự slot/type/offset; `record_size` đúng tổng biến typed + codec state FB | `IR-E-011` |
| 22 | Cấp phát toàn bộ bộ nhớ thực thi | `IR-E-015` khi hết bộ nhớ |

Bước 22 là **điểm cấp phát cuối cùng**. Sau đó, mọi chu kỳ thực thi chạy trên bộ nhớ đã
cấp, **không cấp phát thêm** ([`PROGRAM_SOM_FW_DRAFT_DESIGN`](../PROGRAM_SOM_FW_DRAFT_DESIGN_MK-DDC-24_VI.md) §7.2).

### 6.1 Nguyên tắc: kiểm trước, tin sau

Sau khi load thành công, executor **không kiểm tra biên nữa** — mọi truy cập slot, mọi
đích nhảy, mọi chỉ số FB đã được chứng minh nằm trong biên ở bước 17–20. Đây là cái làm
cho vòng thực thi vừa nhanh vừa đơn giản.

Hệ quả bắt buộc: **một lỗi trong loader là lỗi an toàn bộ nhớ**, không phải lỗi logic.
Vì vậy loader phải nằm trong phạm vi fuzzing bắt buộc (§10.2).

---

## 7. Giới hạn tài nguyên artifact

| Giới hạn | Giá trị | Lỗi |
|---|---|---|
| `total_size` | 1 MiB | `IR-E-001` |
| Số lệnh | 4 096 | `IR-E-010` |
| `slot_count` | 1 024 | `IR-E-010` |
| `var_slot_count` | 512 | `IR-E-010` |
| Số hằng | 512 | `IR-E-010` |
| Số FB instance | 64 | `IR-E-010` |
| Số IO binding | 256 | `IR-E-010` |
| Số biến RETAIN | 128 | `IR-E-010` |
| `record_size` retain | 4 KiB | `IR-E-010` |
| `section_count` | 16 | `IR-E-008` |

---

## 8. Danh mục mã lỗi trả cho BE

| Mã | Ý nghĩa | Giữ package đang chạy? | BE retry được? |
|---|---|---|---|
| `IR-E-001` | Kích thước/cấu trúc header sai | ✅ | ❌ (gói hỏng) |
| `IR-E-002` | Magic sai — không phải artifact MK-DDC | ✅ | ❌ |
| `IR-E-003` | `schema_version` không hỗ trợ | ✅ | ❌ (cần nâng cấp FW) |
| `IR-E-004` | `target_abi` không khớp | ✅ | ❌ (sai target) |
| `IR-E-005` | SHA-256 sai — gói bị sửa hoặc truyền lỗi | ✅ | ✅ (tải lại) |
| `IR-E-006` | Chữ ký sai | ✅ | ❌ |
| `IR-E-007` | Thiếu chữ ký | ✅ | ❌ |
| `IR-E-008` | Bảng section không hợp lệ | ✅ | ❌ |
| `IR-E-009` | Thiếu section bắt buộc | ✅ | ❌ |
| `IR-E-010` | Vượt giới hạn tài nguyên | ✅ | ❌ (phải sửa chương trình) |
| `IR-E-011` | Bảng dữ liệu không hợp lệ | ✅ | ❌ |
| `IR-E-012` | IO binding không hợp lệ hoặc tranh chấp đầu ra | ✅ | ❌ |
| `IR-E-013` | `compiler_profile` không hỗ trợ | ✅ | ❌ |
| `IR-E-014` | Mã lệnh không hợp lệ | ✅ | ❌ |
| `IR-E-015` | Không cấp phát được bộ nhớ | ✅ | ✅ |

**Bất biến:** mọi lỗi load đều giữ nguyên package đang chạy. Không có mã lỗi nào dẫn tới
trạng thái "không có chương trình nào chạy" nếu trước đó đã có chương trình chạy.

---

## 9. Tương thích phiên bản

| Thay đổi | Hành động |
|---|---|
| Thêm opcode mới | Bump `compiler_profile`. Runtime cũ reject `IR-E-013` |
| Thêm section **tuỳ chọn** | Không đổi gì; runtime cũ bỏ qua section lạ **nếu** `section_type ≥ 0x8000` |
| Thêm section **bắt buộc** | Bump `schema_version` |
| Đổi bố trí trường trong section có sẵn | Bump `schema_version` |
| Đổi kích thước/ngữ nghĩa kiểu dữ liệu | Bump `target_abi` |
| Đổi cấu trúc file ở mức cơ bản | Đổi `magic` |

Vùng `section_type ≥ 0x8000` dành cho section mở rộng runtime cũ **được phép bỏ qua**.
Section `< 0x8000` mà runtime không biết → reject `IR-E-008`.

Runtime công bố khả năng của nó qua interface runtime control (C0.7) để BE biết trước
nên compile với profile nào, thay vì thử rồi nhận lỗi.

---

## 10. Yêu cầu verification

### 10.1 Test bắt buộc

| Nhóm | Nội dung |
|---|---|
| Round-trip | AST → IR → serialize → load → execute, kết quả khớp thực thi tham chiếu |
| Reject | Một test **cho từng mã** `IR-E-001..015` |
| Cắt xén | Cắt artifact tại **mọi** offset từ 0 tới `total_size`; mỗi lần phải reject sạch, không crash |
| Lật bit | Lật từng bit của một artifact hợp lệ; phải reject bằng `IR-E-005` (hoặc `IR-E-006`) |
| Zero-allocation | 1 000 chu kỳ liên tục, số lần cấp phát = 0 |
| Tất định | Cùng source + `SOURCE_DATE_EPOCH` → cùng byte artifact |

### 10.2 Fuzzing

Loader **bắt buộc** có fuzz harness (`LLVMFuzzerTestOneInput` nhận artifact bytes). Tiêu
chí: 1 giờ chạy trong CI nightly không có crash/hang/OOM. Lý do bắt buộc: theo §6.1, một
lỗi loader là lỗi an toàn bộ nhớ.

### 10.3 Kiểm bất biến "không parser trong runtime"

CI chạy kiểm tra symbol trên binary `mkddc-core`:

```bash
nm -C mkddc-core | grep -E "parse_st_program|typecheck_st_program" && exit 1
```

Có symbol → build sai kiến trúc → CI fail.

---

## 11. Revision history

| Rev | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-07-28 | Tạo mới. Đóng workstream C0.6 (MS-01). Chốt định dạng file (magic/version/ABI/profile/section table), SHA-256 + chữ ký Ed25519 với lý do khác GPG của OTA, 6 section bắt buộc + 2 tuỳ chọn, máy thanh ghi 16 byte/lệnh với 33 opcode, quy tắc chỉ nhảy tiến để bảo đảm chấm dứt, quy trình load 22 bước, 15 mã lỗi trả BE kèm cột retry/giữ package, quy tắc tương thích phiên bản, yêu cầu fuzzing và kiểm bất biến "không parser trong runtime". |
| 1.1 | 2026-08-11 | Amendment As-Built `TASK-PROG-203`: thay mô tả FNV/timestamp cũ bằng SHA-256 canonical, prefix metadata legacy và timestamp zero; authority Target tiếp tục là `IFSPEC-ART-PROG-001` cùng build manifest ngoài artifact |
| 1.2 | 2026-08-13 | Đồng bộ `TASK-PROG-402`: layout identity canonical v1 ổn định qua thay đổi slot không RETAIN, `record_size` gồm codec FB RETAIN không phụ thuộc ABI, loader kiểm exact section/order/type/offset/size; compiler metadata lên `fwsom-st-1.2.0` nhưng artifact schema major vẫn 1. |
