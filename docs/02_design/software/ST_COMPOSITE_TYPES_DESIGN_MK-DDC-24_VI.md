# Thiết kế đợt gần: `VAR_IN_OUT` + `ARRAY` tĩnh + `STRUCT`

> **Document ID:** SW-ST-COMPOSITE-MK-DDC-24-VI
> **Phiên bản:** 0.1 (Proposed) | 2026-09-02
> **Nguồn quyết định:** `ADR-054` điểm 5 — *"làm chuẩn theo IEC: có thì giữ,
> không có thì bỏ"*; chữ ký chủ sở hữu 2026-08-31 chọn **phương án (A) thi
> hành**, không phải (B) công bố loại trừ. Ghi ở
> [`DECISIONS.md`](../../00_governance/DECISIONS.md).
> **Issue:** [#367](https://github.com/Mekong-HCM/MK-DDC-24/issues/367)
> (`ISS-STED-16`) · **Trạng thái thi hành:** *chưa bắt đầu phần ngữ nghĩa*

## 0. Vì sao có tài liệu này trước khi có code

Chủ sở hữu yêu cầu thẳng: *"Ngữ nghĩa **tham chiếu**, không sao chép vào/ra; quy
tắc ai được ghi và ghi lúc nào **phải viết ra trước khi code**"* và *"Đề nghị
tách thiết kế trước, code sau"*.

Lý do không phải thủ tục. Ba construct này chạm **interface POU**, và interface
POU quyết định **bố cục IR**. Mọi artifact đã ký trên bo đang mang bố cục cũ.
Sửa sai một lần ở đây không phải sửa một hàm — nó là một đợt di trú artifact.

Tài liệu này **chưa phải** Accepted. Nó là bản thiết kế để chủ sở hữu soát
trước khi ai đó viết dòng mã ngữ nghĩa đầu tiên.

## 1. Trạng thái hiện tại (đo, không nhớ)

| Thứ | Hiện tại | Nguồn |
|---|---|---|
| `StStorage` | `VAR_LOCAL`, `VAR_INPUT`, `VAR_OUTPUT`, `VAR_RETAIN` | `st_program.hpp` |
| `StVarDecl` | một `StType` vô hướng, không có hình dạng | `st_program.hpp:117` |
| Khối khai báo parser mở | `VAR`, `VAR_INPUT`, `VAR_OUTPUT`, `VAR RETAIN` | `st_parser.cpp` `at_var_block_start()` |
| `VAR_IN_OUT` / `VAR_TEMP` | **giữ chỗ từ 2026-09-02** — báo lỗi đúng bản chất, chưa mở khối | `st_parser.cpp` `at_unsupported_var_block()` |
| Kiểu | đúng 6 vô hướng: `BOOL` `INT` `DINT` `UINT` `REAL` `TIME` | `ST_SUBSET_SPEC` §3.1 |
| IR | `kSchemaVersion = 1`, `kCompilerProfile`, `kTargetAbi = 3841` | `st_ir.hpp:34-36` |
| RETAIN | kích thước theo `st_fb_retain_state_size()` | `st_program.hpp:107` |

**Đã làm trong lần này (#367 phần 1):** hai từ khoá giữ chỗ + thông điệp lỗi
đúng loại + test âm. Phần còn lại của bảng dưới đây **chưa làm**.

## 2. Nguyên tắc chi phối — cái gì được phép, cái gì không

`ADR-054` giữ nguyên `P2`: **không cấp phát khi chạy**. Đó là ràng buộc quyết
định toàn bộ thiết kế dưới đây, và là lý do `STRING` độ dài biến bị loại trong
khi `ARRAY` tĩnh thì không.

1. **Kích thước biết tại compile time.** `ARRAY[1..10]` hợp lệ; `ARRAY[1..n]`
   với `n` là biến thì không. Không có ngoại lệ "chỉ lần này".
2. **Cấp phát một lần lúc load.** Process image dựng xong trước cycle đầu; sau
   đó không có `malloc` nào trên RT path.
3. **WCET vẫn phải chặn trên tĩnh.** Truy cập `a[i]` với `i` runtime cần kiểm
   biên — chi phí cố định, chấp nhận được; nhưng không được mở đường cho vòng
   lặp qua cửa sau.

## 3. `VAR_IN_OUT` — ngữ nghĩa tham chiếu

### 3.1 Điều nó KHÔNG phải

Không phải "`VAR_INPUT` cộng `VAR_OUTPUT`". Cặp đó **sao chép** vào lúc gọi và
**sao chép** ra lúc về; `VAR_IN_OUT` thì không sao chép lần nào — POU được gọi
thao tác thẳng trên ô nhớ của bên gọi.

Khác biệt đó có hệ quả quan sát được: với `VAR_IN_OUT`, một thay đổi ở giữa
thân POU **hiện ra ngay** với mọi bí danh khác của cùng ô nhớ. Đây chính là chỗ
`VAR_IN_OUT` đẻ ra lỗi khó tìm, và là lý do mục §3.3 tồn tại.

### 3.2 Quy tắc AI ĐƯỢC GHI và GHI LÚC NÀO

| Luật | Nội dung | Vì sao |
|---|---|---|
| **W1** | Chỉ POU **được gọi** ghi vào `VAR_IN_OUT`; bên gọi không được ghi vào cùng biến trong khi lời gọi đang chạy | Rev A một task tuần tự nên "trong khi" chỉ có nghĩa với lời gọi lồng nhau — W1 chặn đúng ca đó |
| **W2** | Đối số truyền cho `VAR_IN_OUT` phải là một **biến khai báo**, không được là biểu thức hay hằng | Không có ô nhớ để tham chiếu tới thì tham chiếu không có nghĩa; compiler phải từ chối tại chỗ, không sinh ô tạm |
| **W3** | **Cấm bí danh trùng**: hai tham số `VAR_IN_OUT` của cùng một lời gọi không được trỏ vào cùng biến | `SWAP(a, a)` cho kết quả phụ thuộc thứ tự ghi bên trong POU — không xác định được từ ngoài |
| **W4** | Biến đã bind vào một Point **đầu ra** không được truyền vào `VAR_IN_OUT` | Ghi qua tham chiếu đi vòng qua Candidate→Arbitration; mọi đường ghi output phải qua resolver mức 5 |
| **W5** | `VAR_IN_OUT` không được khai `RETAIN` | RETAIN lưu **giá trị**; một tham chiếu không có giá trị của riêng nó để lưu |

W2 và W3 kiểm được **tĩnh** tại semantic phase; W1 và W4 cũng vậy (Rev A không
có con trỏ, nên tập bí danh biết trước). Không luật nào cần kiểm lúc chạy —
đó là điều kiện để giữ WCET.

### 3.3 Chẩn đoán cần thêm

| Mã đề xuất | Khi nào | Ghi chú |
|---|---|---|
| `ST-SEM-0xx` | đối số `VAR_IN_OUT` không phải biến (W2) | |
| `ST-SEM-0xx` | hai `VAR_IN_OUT` trùng biến trong một lời gọi (W3) | |
| `ST-SEM-0xx` | truyền biến bound-to-output vào `VAR_IN_OUT` (W4) | |
| `ST-SEM-0xx` | `VAR_IN_OUT` khai `RETAIN` (W5) | |

Số hiệu cụ thể cấp khi thi hành, và **phải** đi qua `error_catalog_v1.json` —
`ISS-STED-10` vừa đóng đúng lỗi "tài liệu nêu mã không tồn tại", nên không được
ghi mã vào tài liệu này trước khi catalog có.

## 4. `ARRAY` tĩnh và `STRUCT`

### 4.1 Phạm vi tối thiểu của đợt gần

- `ARRAY[c1..c2] OF <kiểu vô hướng>` — `c1`, `c2` là **hằng nguyên literal**;
  chưa hỗ trợ hằng có tên cho tới khi có `CONSTANT`.
- `STRUCT` một mức, thành viên là kiểu vô hướng hoặc `ARRAY` tĩnh.
- **Chưa** hỗ trợ: mảng nhiều chiều, mảng của `STRUCT`, `STRUCT` lồng, mảng có
  biên là biểu thức.

Giới hạn "một mức" là cố ý. Mỗi mức lồng thêm nhân đôi số ca bố cục phải chứng
minh, và đợt này đã chạm IR layout — không nên chạm nó hai lần trong một đợt.

### 4.2 Kiểm biên

Truy cập `a[i]` với `i` là biểu thức runtime **phải** kiểm biên, và vi phạm là
**fault** (`ST-RT-0xx`), không phải kẹp im lặng. Cùng lý do với `ST-RT-005`
(TIME âm): kẹp giấu lỗi logic của người viết chương trình.

Khi `i` là hằng, compiler kiểm tĩnh và từ chối tại Check — rẻ hơn nhiều so với
để nó thành fault trên bo.

### 4.3 Bố cục và trần tài nguyên

| Câu hỏi | Đề xuất | Cần chốt |
|---|---|---|
| Trần phần tử mỗi mảng | 256 | ✋ chủ sở hữu |
| Trần thành viên mỗi `STRUCT` | 32 | ✋ |
| Trần tổng ô hợp thành mỗi POU | tính vào `kMaxVariables` hiện có (512) hay tách trần riêng? | ✋ |
| Căn lề thành viên | đóng gói theo thứ tự khai, căn theo kích thước phần tử | |

Ba trần trên đi vào `product_profile_v2.json`, nên phải chốt **trước** khi sinh
IR — chúng nằm trong provenance của artifact.

## 5. IR layout và đường di trú — phần rủi ro nhất

### 5.1 Vì sao không thể "thêm nhẹ"

`st_loader.cpp` kiểm `kSchemaVersion` / `kCompilerProfile` / `kTargetAbi` và
**từ chối** artifact không khớp (nay kèm lý do nêu cả hai phía — `ISS-STED-19`).
Đó là hành vi đúng, và nó có nghĩa: mọi thay đổi bố cục biến đều là một lần
**bump có kiểm soát**, không phải một lần thêm trường.

### 5.2 Đề xuất

1. **`kSchemaVersion` 1 → 2.** `kTargetAbi` **không** đổi nếu bố cục process
   image cho 6 kiểu vô hướng giữ nguyên byte-for-byte — cần chứng minh bằng
   golden test, không bằng lập luận.
2. **Mô tả biến trong IR mở rộng có phiên bản**: thêm trường hình dạng
   (`scalar` / `array{elem, count}` / `struct{members}`) thay vì đổi ý nghĩa
   trường cũ. Đổi ý nghĩa một trường cũ là cách một loader cũ đọc artifact mới
   ra số vô nghĩa mà vẫn nghĩ mình đọc đúng.
3. **Dual-reader trong cửa sổ di trú** — đúng lối `LoadPackageV2`/artifact v1
   đã làm (DDD §12.1). Artifact schema 1 vẫn nạp được cho tới khi mọi bo trên
   hiện trường lên bản mới.
4. **LKG phải sống sót.** Bo đang chạy artifact schema 1; nâng firmware rồi
   rollback phải quay về được. Đây là ca phải có test, không phải ca để suy luận.

### 5.3 RETAIN với kiểu hợp thành

**Đề xuất: cho phép, nhưng chỉ `ARRAY` của vô hướng và `STRUCT` phẳng.**

Lý do: `st_fb_retain_state_size()` và kích thước wire canonical đều tính từ bố
cục biết tại compile time — hai thứ đó vẫn tính được cho hai hình dạng trên.
Cấm hẳn sẽ buộc người dùng trải mảng thành 10 biến rời để giữ qua mất điện, tức
đẩy chính vấn đề này sang chỗ khó đọc hơn.

**Ràng buộc kèm theo:** đổi hình dạng một biến `RETAIN` giữa hai Revision phải
làm RETAIN cũ **mismatch** và cold-init có diagnostic (`CORE-109` hiện có), chứ
không được đọc byte cũ theo bố cục mới. Đây là ca dễ sai nhất của cả đợt.

## 6. FBD

**Đề xuất: đợt gần là ST-only, và công bố rõ như vậy.**

FBD Rev A nối cổng theo giá trị vô hướng; một cổng mang tham chiếu hoặc mang
`STRUCT` cần cả mô hình đồ hoạ lẫn quy tắc tương đương ST↔FBD mới. Gộp vào đợt
này là làm hai thay đổi lớn cùng lúc trên hai bề mặt khác nhau.

Nếu chốt ST-only thì `st_language_profile_v1.json` phải nói ra — im lặng ở đây
sẽ tạo đúng loại "loại trừ không công bố" mà `ISS-STED-16` sinh ra để chấm dứt.

## 7. Thứ tự thi hành đề xuất

| # | Bước | Cổng ra |
|---|---|---|
| 0 | ✅ **xong** — từ khoá giữ chỗ + thông điệp đúng loại + test âm | `StLangDeclarationBlocks.*` |
| 1 | Chủ sở hữu chốt §4.3 (ba trần) và §5.3 (RETAIN) và §6 (FBD) | ADR bổ sung hoặc ghi vào `DECISIONS.md` |
| 2 | Cấp mã chẩn đoán §3.3 vào `error_catalog_v1.json` | `check:programming-errors` |
| 3 | `StStorage::VAR_IN_OUT` + parser mở khối + W2/W3/W5 ở semantic | test âm cho từng luật |
| 4 | `ARRAY` tĩnh: kiểu, bố cục, kiểm biên tĩnh + runtime | golden IR |
| 5 | `STRUCT` phẳng | golden IR |
| 6 | Bump `kSchemaVersion`, dual-reader, test rollback LKG | test di trú |
| 7 | W1/W4 (bí danh và output binding) | test âm |
| 8 | Hồ sơ ngôn ngữ + `ST_SUBSET_SPEC` §3.1/§9 + corpus văn phạm | `st_language_profile_contract`, `StGrammarCorpus.*` |
| 9 | Cổng ký đóng #369 | |

Bước 1 là **cổng chặn**: ba câu hỏi ở đó thay đổi bố cục IR, và bố cục IR là
thứ không sửa lại được sau khi artifact đã ký chạy trên bo.

## 8. Điều tài liệu này không quyết

Nó **không** thay chữ ký chủ sở hữu cho §4.3, §5.3, §6. Nó nêu đề xuất kèm lý
do để buổi soát có thứ cụ thể để bác hoặc chuẩn y, chứ không phải để mặc định
thành quyết định vì không ai phản đối.
