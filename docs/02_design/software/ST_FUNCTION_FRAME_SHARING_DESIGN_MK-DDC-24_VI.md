# Thiết kế đề xuất: dùng chung khung slot cho lời gọi FUNCTION đã kết thúc

> **Document ID:** SW-ST-FN-FRAME-SHARING-MK-DDC-24-VI
> **Phiên bản:** 0.2
> **Trạng thái:** **Accepted + Implemented 2026-09-28** — chủ dự án chấp thuận Q1–Q4 đúng theo đề xuất (§6); hiện thực và số đo ở §7
> **Issue:** [#799](https://github.com/Mekong-HCM/MK-DDC-24/issues/799) (finding **U-08** của
> [`REC-DDC-FIELD-USE-20260927`](../../07_records/reviews/DDC24_FIELD_USE_UPGRADE_FINDINGS_2026-09-27.md))
> **Mốc mã nguồn đối chiếu:** `main@9910b88` (2026-09-28)

## 0. Vì sao có tài liệu này trước khi có code

Phần "báo mức dùng tài nguyên" của U-08 đã xong ở PR #803 (`mkddc-st-compile
--check-only` trả `usage`). Phần còn lại đổi cách compiler cấp slot, tức đổi
**bảng biến và số slot của artifact**. Artifact đã ký đang chạy trên bo mang layout
cũ; golden artifact trong `contracts/programming/golden/` phải được duyệt lại. Vì
vậy Issue ghi rõ: cần thiết kế và review Compiler Lead trước khi code.

## 1. Hiện trạng (đọc từ mã)

| Thứ | Hiện tại | Nguồn |
|---|---|---|
| Trần slot ghi được | `kMaxWritableSlots = 512` mỗi Program; tổng slot `kMaxSlots = 1024` | `apps/core/application/st/st_profile_generated.hpp` |
| Cấp slot biến | `allocate_variable` → `reserve_slots(1)`: `next_slot_` chỉ tăng, không bao giờ trả lại; mỗi slot kèm một `StIrVariable` trong `out_->variables` | `apps/core/application/st/st_compile.cpp` |
| Lời gọi FUNCTION người dùng | `emit_user_function` **inline** thân hàm; mỗi lời gọi cấp slot mới cho giá trị trả về và mọi biến của hàm với tiền tố `__fn.<TÊN>.<số thứ tự lời gọi>` (`function_call_serial_++`) | `st_compile.cpp` (`emit_user_function`) |
| Đối số | Đánh giá **hết** vào slot (tạm hoặc biến) **trước** khi cấp khung hàm, rồi `MOV` vào slot tham số | như trên |
| Giá trị trả về | `*out_slot = return_slot` — biểu thức gọi dùng thẳng slot trả về của khung, không chép ra slot tạm | như trên |
| Slot tạm biểu thức | Ngăn xếp `push_temp`/`pop_temp`, dự trữ `kMaxExprDepth + 8` slot một lần | `st_compile.cpp` (`temp_base_`, `temp_top_`) |
| Instance FB người dùng | Mang toàn bộ biến của FB (trạng thái giữa các chu kỳ) | `allocate_user_fb` |

**Số đo hiện trường:** `PRG_DO16_MODBUS` dùng **467/512** slot ghi (91 %); mỗi kênh
DO tốn 15 slot, nên không thể lên 32 DO trong một Program. Phần lớn slot của các
FUNCTION thuần (`FN_SEC_TO_TIME`, `FN_ONE_HOT`, `FN_FIRST_N`, …) chỉ sống trong
đúng một lời gọi.

## 2. Nhận định

Biến của một FUNCTION thuần (`ST-POU-002`: không instance FB, không `VAR_OUTPUT`,
không RETAIN, không Published Signal) **không mang trạng thái qua lời gọi** —
mỗi lời gọi `MOV` giá trị mặc định vào mọi biến không phải `VAR_INPUT` trước khi
chạy thân. Vì vậy hai lời gọi không lồng nhau có thể dùng cùng một vùng slot mà
không đổi ngữ nghĩa. Instance FB thì **không** được dùng chung: trạng thái của nó
chính là lý do nó tồn tại. Tài liệu này không đụng tới FB.

## 3. Thiết kế đề xuất — ngăn xếp khung FUNCTION

1. **Vùng khung riêng.** Thêm vùng `frame` đặt sau vùng slot tạm. Cấp theo kiểu
   ngăn xếp như `push_temp`: `frame_top_` tăng khi vào một lời gọi, trả về khi
   lời gọi kết thúc. Số slot vùng khung = **mức nước cao nhất** (tổng kích thước
   các khung lồng nhau sâu nhất), không phải tổng mọi lời gọi.
2. **Thứ tự bắt buộc trong một lời gọi** (giữ đúng thứ tự đang có, thêm bước 5):
   1. đánh giá mọi đối số vào slot của **người gọi** (tạm hoặc biến) — lời gọi
      lồng trong đối số tự đẩy/trả khung của nó ở bước này;
   2. đẩy khung: cấp slot trả về + biến của hàm từ `frame_top_`;
   3. `MOV` đối số vào slot tham số, `MOV` giá trị mặc định vào biến còn lại;
   4. chạy thân hàm;
   5. **chép giá trị trả về ra một slot tạm của người gọi** (`push_temp`), rồi
      trả khung.
3. **Vì sao bước 5 là bắt buộc — bẫy `f(f(x), f(y))`.** Nếu vẫn trả thẳng
   `return_slot` như hiện nay: `f(x)` trả kết quả trong slot khung R rồi trả khung;
   `f(y)` đẩy khung ở **cùng** vị trí và ghi kết quả vào **cùng** slot R — đối số
   thứ nhất bị ghi đè trước khi lời gọi ngoài kịp đọc. Chép kết quả ra slot tạm
   của người gọi ở bước 5 làm vòng đời kết quả gắn với biểu thức cha, không với
   khung đã trả. Cái giá là một lệnh `MOV` mỗi lời gọi.
4. **Đệ quy.** ST profile hiện không cho đệ quy (đồ thị gọi phải không chu trình);
   độ sâu khung vì thế hữu hạn và tính được tĩnh — WCET giữ `P1`.

### 3.1 Ước lượng tác động

Với `PRG_DO16_MODBUS`, slot ghi còn lại = biến Program + instance FB + tạm +
mức nước cao nhất của khung. Số slot của các FUNCTION thuần gần như về mức của
lời gọi lớn nhất. Con số thật phải đo lại bằng `--check-only` sau khi làm — tài
liệu này **không** hứa một con số.

### 3.2 Có nên nâng `kMaxWritableSlots` không

Tách thành quyết định riêng (Q3). Nâng trần đổi ngân sách RAM mỗi Program × số
Program tối đa, và phải sửa đồng thời profile v2 (`product_profile_v2.json`) cùng
các hằng sinh C++/Go/TS. Đề xuất: làm phần dùng chung khung trước, đo lại, chỉ
nâng trần khi số đo trên target cho thấy còn dư RAM.

## 4. Ảnh hưởng

| Mặt | Ảnh hưởng | Xử lý |
|---|---|---|
| Bảng biến artifact (`out_->variables`) | Biến `__fn.<TÊN>.<n>.*` không còn một-slot-một-lời-gọi; nhiều tên khung trỏ cùng slot | Đổi tên thành `__frame.<độ sâu>.<vị trí>` hoặc bỏ khỏi bảng biến công khai (Q2) |
| Trace / Monitor theo tên | Biến khung không có ý nghĩa giữa hai lời gọi | Loại biến khung khỏi danh sách trace được; nêu trong `st_value_trace` |
| Source map | Không đổi: vẫn gán lệnh của thân hàm về dòng/cột của lời gọi | — |
| Golden artifact | Thay đổi | Duyệt golden mới; bump mã profile compiler (`kCompilerProfile` = `st_profile_generated::kProfileCode`) |
| Artifact đã ký trên bo | Không bị ảnh hưởng khi chạy (loader không đổi); chỉ khác khi biên dịch lại | Ghi rõ trong release note |

## 5. Kiểm chứng (điều kiện đóng Issue)

| Mã | Test | Tầng |
|---|---|---|
| T-799-1 | `f(f(x), f(y))` cùng một FUNCTION: kết quả đúng như bản inline cũ trên mọi tổ hợp đầu vào của một bảng giá trị | Core CTest (compile + exec) |
| T-799-2 | Ba mức lồng `f(g(h(x)))` và gọi trong điều kiện `IF`/`CASE`: đúng ngữ nghĩa | Core CTest |
| T-799-3 | Hai chương trình tương đương (cũ/mới) cho cùng chuỗi đầu ra qua N chu kỳ trên bộ corpus `StGrammarCorpus.*` | Core CTest (differential) |
| T-799-4 | `PRG_DO16_MODBUS` biên dịch lại: số slot ghi giảm, ghi số đo trước/sau | `mkddc-st-compile --check-only` |
| T-799-5 | Golden artifact mới được duyệt; mã profile compiler bump | contract gate |

## 6. Câu hỏi cần Compiler Lead trả lời

| # | Câu hỏi | Đề xuất |
|---|---|---|
| Q1 | Chấp nhận ngăn xếp khung với bước chép kết quả (thêm một `MOV` mỗi lời gọi) | Có |
| Q2 | Biến khung còn xuất trong bảng biến artifact không | Không xuất; chỉ giữ số slot |
| Q3 | Nâng `kMaxWritableSlots` trong cùng đợt hay tách riêng | Tách riêng, sau số đo |
| Q4 | Có cần cờ compiler để tắt dùng chung khung khi chẩn đoán | Không; differential test thay cho cờ |

Chủ dự án chấp thuận cả bốn câu theo đúng cột "Đề xuất" ngày 2026-09-28 (ghi ở
`DECISIONS.md` mục Lịch sử cập nhật gần nhất).

## 7. Kết quả hiện thực

| Mục | Kết quả |
|---|---|
| Mã | `apps/core/application/st/st_compile.cpp`: `allocate_frame_slot` cấp khung sau vùng tạm (`frame_base_`/`frame_top_`), trả khung khi lời gọi kết thúc; kết quả chép ra `push_temp()` của người gọi; biến khung không vào `out_->variables` (loader cấm hai biến cùng slot) |
| T-799-1/2 | `StFunctionFrame.NestedCallsOfTheSameFunctionDoNotClobberArguments`, `ThreeLevelNestingAndCallsInsideConditions` (chạy thật trên runtime, artifact ký). Với bản dùng chung khung nhưng **bỏ** bước chép kết quả, cả hai đỏ — chứng minh test bắt đúng bẫy ở §3 mục 3 |
| T-799-3 | `mkddc-st-sim` chạy `PRG_DO16_MODBUS` 300 s ảo (3 001 chu kỳ, 163 lần đổi đầu ra DO, AUTO → khoá kênh → đảo chiều → STAGING → MANUAL → mất `InPermit`): CSV bản cũ và bản mới **giống hệt từng byte** |
| T-799-4 | `--check-only` `PRG_DO16_MODBUS`: slot ghi **467 → 433** (−34), tổng slot 553 → 519; lệnh 1 576 → 1 587 (+1 `MOV` mỗi lời gọi). Phần còn lại chủ yếu là trạng thái instance FB (16 × `FB_DO_CHANNEL`), không dùng chung được theo §2 |
| T-799-5 | Không golden artifact nào chứa lời gọi FUNCTION người dùng: `ctest` 1 661/1 661 và `verify_programming_g1_contracts.py` PASS không cần re-pin. Q3: `kMaxWritableSlots` giữ 512 |

## Lịch sử sửa đổi

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 0.2 | 2026-09-28 | Chủ dự án chấp thuận Q1–Q4; hiện thực ngăn xếp khung FUNCTION; §7 số đo và test |
| 0.1 | 2026-09-28 | Bản đề xuất đầu tiên cho Issue #799 (U-08): hiện trạng cấp slot đối chiếu `main@9910b88`, ngăn xếp khung FUNCTION, bẫy `f(f(x), f(y))` và cách tránh, ảnh hưởng artifact, test đóng Issue, câu hỏi duyệt |
