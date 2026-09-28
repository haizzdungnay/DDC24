# Thiết kế đề xuất: toán tử bit trên số nguyên, `VAR CONSTANT`, giá trị khởi tạo, `TIME` × số

> **Document ID:** SW-ST-BITWISE-CONST-INIT-MK-DDC-24-VI
> **Phiên bản:** 0.1
> **Trạng thái:** Proposed — chờ System Architect + Product Owner duyệt bản cập nhật
> `DDD-LANG-PROG-001` và hồ sơ ngôn ngữ sinh máy; **chưa code**
> **Issue:** [#800](https://github.com/Mekong-HCM/MK-DDC-24/issues/800) (finding **U-10** của
> [`REC-DDC-FIELD-USE-20260927`](../../07_records/reviews/DDC24_FIELD_USE_UPGRADE_FINDINGS_2026-09-27.md));
> liên quan #367 (`ARRAY`/`STRUCT`/`VAR_IN_OUT`, thiết kế ở
> [`ST_COMPOSITE_TYPES_DESIGN_MK-DDC-24_VI.md`](ST_COMPOSITE_TYPES_DESIGN_MK-DDC-24_VI.md))
> **Mốc mã nguồn đối chiếu:** `main@9910b88` (2026-09-28)

## 0. Vì sao có tài liệu này trước khi có code

Mỗi mục dưới đây đổi **văn phạm** hoặc **hệ kiểu** của ngôn ngữ, tức đổi hồ sơ
ngôn ngữ sinh máy
[`st_language_profile_v1.json`](../../../contracts/programming/st_language_profile_v1.json)
(#357) và `DDD-LANG-PROG-001`
([`PROGRAMMING_LANGUAGE_COMPILER_DESIGN.md`](PROGRAMMING_LANGUAGE_COMPILER_DESIGN.md)).
Hai tài liệu này cần System Architect + Product Owner ký trước khi code, đúng
như Issue ghi. Một mục (`SHL`/`SHR`) còn **đảo một loại trừ có chủ ý** đang nằm
trong `deliberateExclusions` — đó là quyết định phạm vi, không phải chi tiết cài
đặt.

## 1. Hiện trạng (đọc từ mã và hồ sơ)

| Thứ | Hiện tại | Nguồn |
|---|---|---|
| `AND`/`OR`/`XOR`/`NOT` | Chỉ `BOOL×BOOL`; số nguyên báo `ST-SEM-002 logical operator requires BOOL on both sides` | `apps/core/application/st/st_semantic.cpp`; `ST_SUBSET_SPEC` §4.2 |
| `SHL`/`SHR`/`ROL`/`ROR` | Nằm trong `deliberateExclusions` | `st_language_profile_v1.json` |
| `BYTE`/`WORD`/`DWORD` | Nằm trong `plannedAdditions` (cùng `LREAL`, enum) — "đợt sau" theo ADR-054 §5 | `st_language_profile_v1.json` |
| `VAR CONSTANT` | Không có; parser báo `ST-SYN-001` | `apps/core/application/st/st_parser.cpp` (`parse_var_block`) |
| Giá trị khởi tạo khi khai báo (`x : INT := 5;`) | Không có; `parse_var_decl` không nhận `:=`, báo `ST-SYN-001`; mọi biến khởi tạo bằng giá trị mặc định của kiểu | `st_parser.cpp` (`parse_var_decl`); `ST_SUBSET_SPEC` §3.1 cột "Giá trị khởi tạo" |
| `TIME * số`, `TIME / số` | Không hỗ trợ; `ST-SEM-002 TIME vs DINT`; phải đi vòng `TIME_TO_REAL`/`REAL_TO_TIME` | `ST_SUBSET_SPEC` §4.2 |

**Bằng chứng hiện trường** (chương trình 16 DO Modbus,
[`PROGRAMMING_ST_DO16_MODBUS_GUIDE.md`](../../06_operations/PROGRAMMING_ST_DO16_MODBUS_GUIDE.md)):
phải viết khối `FB_MASK_SPLIT` tách bit bằng `MOD 2` và `/ 2`; hằng "ma thuật"
21845/43690/61680 rải trong mã; mọi tham số phải lấy từ VP hoặc gán ở chu kỳ đầu.

## 2. Nguyên tắc chi phối

- **Giữ WCET tĩnh (`P1`).** Không mục nào dưới đây thêm vòng lặp hay phụ thuộc
  dữ liệu vào thời gian chạy.
- **Kiểu chặt (`ST_SUBSET_SPEC` §3.3).** Không ép kiểu ngầm mới; ngoại lệ literal
  đa hình (§3.4) giữ nguyên.
- **Lỗi là fault tường minh, không quấn vòng im lặng** (§4.3) — trừ nơi IEC định
  nghĩa phép toán là thao tác bit (xem §3.1).

## 3. Đề xuất theo từng mục

### 3.1 Toán tử bit trên số nguyên không dấu

| Quyết định | Đề xuất | Lý do |
|---|---|---|
| Kiểu áp dụng | `UINT` ngay; `WORD` nếu Q1 chọn thêm kiểu `WORD` cùng đợt | `UINT` đã có trong runtime; số có dấu (`INT`/`DINT`) **không** nhận toán tử bit để tránh câu hỏi bù 2 |
| `AND`/`OR`/`XOR` trên `UINT×UINT` | Kết quả `UINT`, thao tác theo bit | IEC định nghĩa như vậy cho `ANY_BIT`; không có tràn nên không cần fault |
| `NOT` trên `UINT` | Đảo 16 bit, kết quả `UINT` | như trên |
| `SHL(IN, N)`/`SHR(IN, N)` | Hàm chuẩn, `IN : UINT`, `N : UINT`; `N ≥ 16` cho kết quả 0 (không fault) | Đảo loại trừ trong `deliberateExclusions` — cần PO chấp thuận (Q2). `ROL`/`ROR` vẫn loại |
| `BOOL` | Giữ nguyên hành vi hiện tại (không rút gọn, §4.4) | Không đổi |

Nhận diện kiểu theo toán hạng: `AND` với hai toán hạng `BOOL` giữ opcode logic cũ,
với hai toán hạng `UINT` sinh opcode bit mới; trộn `BOOL`/`UINT` là `ST-SEM-002`.
Opcode mới cần bump ABI IR (Q4).

### 3.2 `VAR CONSTANT`

- Cú pháp: `VAR CONSTANT … END_VAR` (IEC), mỗi khai báo **bắt buộc** có
  `:= <biểu thức hằng>`.
- Biểu thức hằng: literal, tham chiếu hằng đã khai trước, phép toán số học/bit
  trên chúng — gập tại thời điểm biên dịch. Không gọi hàm người dùng.
- Ghi vào hằng: lỗi ngữ nghĩa mới (đề xuất `ST-SEM-0xx`, cấp mã khi duyệt).
- Không tốn slot ghi được: gập thành hằng trong bảng hằng (`kMaxConstants`).
- Không cho `VAR CONSTANT RETAIN` (vô nghĩa).

### 3.3 Giá trị khởi tạo khi khai báo

- Cú pháp: `x : REAL := 21.5;` trong `VAR`, `VAR_OUTPUT`, `VAR RETAIN`; giá trị
  là **biểu thức hằng** (cùng luật §3.2).
- **Không** cho `VAR_INPUT`: giá trị đầu vào đến từ binding mỗi chu kỳ; giá trị
  khởi tạo ở đó hoặc bị đè ngay, hoặc — tệ hơn — che mất việc thiếu binding.
- Ngữ nghĩa: ghi vào trường `init` của `StIrVariable` (trường này **đã tồn tại**,
  hiện luôn bằng `default_init(type)`), nên không cần đổi loader. Áp dụng ở cold
  start; với `RETAIN` thì giá trị lưu thắng giá trị khởi tạo sau warm start, đúng
  bảng khôi phục của `PROGRAMMING_RETAIN_RESET_DESIGN.md`.
- Instance FB người dùng: biến bên trong FB mang giá trị khởi tạo của khai báo
  trong FB.

### 3.4 `TIME` × số và `TIME` / số

| Phép | Kết quả | Lỗi |
|---|---|---|
| `TIME * DINT`, `DINT * TIME` | `TIME` | tràn int64 → `ST-RT-001`; âm → `ST-RT-005` |
| `TIME / DINT` | `TIME` | chia 0 → `ST-RT-002`; âm → `ST-RT-005` |
| `TIME * REAL`, `TIME / REAL` | `TIME` (làm tròn gần nhất, nửa ra xa 0 như `REAL_TO_INT`) | NaN/Inf → `ST-RT-004`; tràn/âm như trên |
| `TIME / TIME` | **không** thêm | tránh một kiểu kết quả không thứ nguyên chưa có trong profile |

`INT`/`UINT` tham gia qua literal đa hình hoặc hàm chuyển đổi sẵn có; không mở
thêm tổ hợp kiểu.

## 4. Ảnh hưởng hợp đồng và tài liệu

| Tài liệu / hợp đồng | Thay đổi |
|---|---|
| `st_language_profile_v1.json` | `operators` (bit trên `UINT`, `TIME×số`), `storageClasses` (`CONSTANT`), `grammar` (`var_decl` có `:=`), `standardFunctions` (`SHL`, `SHR`), bỏ `SHL`/`SHR` khỏi `deliberateExclusions`; bump `profileVersion` + `sha256` |
| `DDD-LANG-PROG-001` | §hệ kiểu, §biểu thức, §khai báo |
| `ST_SUBSET_SPEC` | §3.1 cột giá trị khởi tạo, §4.2 bảng kiểu toán tử, §12 mã diagnostic mới |
| `st_grammar_corpus_v1.json` | Ca dương/âm cho từng cú pháp mới |
| IR / artifact | Opcode bit mới → bump ABI; giá trị `init` khác mặc định xuất hiện trong artifact |
| `GUIDE-PROG-ST-DO16-001` | Viết lại `FB_MASK_SPLIT` bằng toán tử bit sau khi có code |

## 5. Kiểm chứng (điều kiện đóng Issue)

| Mã | Test | Tầng |
|---|---|---|
| T-800-1 | Bảng chân trị `AND`/`OR`/`XOR`/`NOT` trên `UINT` (0, 0xFFFF, mẫu xen kẽ 21845/43690) | Core CTest |
| T-800-2 | `SHL`/`SHR` với `N` = 0, 1, 15, 16, 100 | Core CTest |
| T-800-3 | Trộn `BOOL`/`UINT` và `INT` với toán tử bit → `ST-SEM-002` | Core CTest (âm) |
| T-800-4 | `VAR CONSTANT` gập hằng; ghi vào hằng → lỗi; không tốn slot ghi | Core CTest + `--check-only usage` |
| T-800-5 | Giá trị khởi tạo: cold start đúng giá trị; `RETAIN` warm start giữ giá trị lưu; `VAR_INPUT := …` bị từ chối | Core CTest |
| T-800-6 | `TIME * DINT`, `TIME / REAL`: đúng giá trị, fault đúng mã khi tràn/âm/chia 0 | Core CTest |
| T-800-7 | Corpus văn phạm + `st_language_profile_contract` xanh với profile mới | contract gate |
| T-800-8 | Chương trình 16 DO viết lại `FB_MASK_SPLIT` bằng toán tử bit cho cùng chuỗi đầu ra như bản cũ | differential test |

## 6. Câu hỏi cần người duyệt trả lời

| # | Câu hỏi | Đề xuất | Người quyết |
|---|---|---|---|
| Q1 | Thêm kiểu `WORD` cùng đợt, hay chỉ mở toán tử bit trên `UINT` | Chỉ `UINT` trước; `WORD` theo lộ trình ADR-054 §5 | System Architect + PO |
| Q2 | Đảo loại trừ `SHL`/`SHR` | Đảo (chỉ `SHL`/`SHR`, giữ loại `ROL`/`ROR`) | PO |
| Q3 | Phạm vi giá trị khởi tạo: chỉ biểu thức hằng | Có | System Architect |
| Q4 | Chấp nhận bump ABI IR cho opcode bit | Có, đi cùng đợt #367 nếu trùng lịch để chỉ bump một lần | Compiler Lead |

Tài liệu này **không** thay chữ ký cho Q1–Q4.

## Lịch sử sửa đổi

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 0.1 | 2026-09-28 | Bản đề xuất đầu tiên cho Issue #800 (U-10): hiện trạng đối chiếu `main@9910b88` và hồ sơ ngôn ngữ, đề xuất cho toán tử bit trên `UINT`, `SHL`/`SHR`, `VAR CONSTANT`, giá trị khởi tạo, `TIME` × số; ảnh hưởng hợp đồng, test đóng Issue, câu hỏi duyệt |
