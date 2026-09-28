# Thiết kế đề xuất: Trace nhất quán theo lần chạy Program và tách giá trị lệnh / đọc lại

> **Document ID:** SW-TRACE-RELEASE-COHERENT-MK-DDC-24-VI
> **Phiên bản:** 0.3
> **Trạng thái:** **Accepted + Implemented, kiểm trên bo PASS 2026-09-28** — chủ
> dự án chấp thuận Q1–Q4 theo đề xuất khi giao triển khai. Kết quả ở §9; phần
> trên bo của T-798-4 lộ một lỗi đọc lại (đã sửa, §9) và PASS sau sửa
> ([`EV-PROG-TRACE-798-TARGET`](../../07_records/test-evidence/programming/2026-09-28-trace-release-readback-target.md))
> **Issue:** [#798](https://github.com/Mekong-HCM/MK-DDC-24/issues/798) (finding **U-04** của
> [`REC-DDC-FIELD-USE-20260927`](../../07_records/reviews/DDC24_FIELD_USE_UPGRADE_FINDINGS_2026-09-27.md))
> **Mốc mã nguồn đối chiếu:** `main@9910b88` (2026-09-28)

## 0. Vì sao có tài liệu này trước khi có code

Issue #798 ghi rõ: đổi hợp đồng IPC `programming_v1` và OpenAPI, cần thiết kế và
duyệt trước khi code. Cả hai hợp đồng đều được ghim trong
[`g1_contract_join_v1.json`](../../../contracts/programming/g1_contract_join_v1.json);
đổi chúng là một lần re-pin có golden, không phải một bản vá cục bộ.

Tài liệu này **chưa phải** quyết định. Nó nêu hiện trạng đo được, các phương án,
đề xuất kèm lý do, và danh sách câu hỏi cần người có thẩm quyền trả lời.

## 1. Hiện trạng (đọc từ mã, không nhớ)

| Thứ | Hiện tại | Nguồn |
|---|---|---|
| Chốt đầu vào | `st_capture_due_inputs` duyệt mọi Program của mọi Task **đến hạn** và nạp đầu vào với `generation = base_step_count() + 1`. Điều kiện là Task đến hạn, **không** phải Program đến hạn | `apps/core/application/st/st_process_image.cpp` (`st_capture_due_inputs`) |
| Chạy Program | Trong `StScheduler`, sau khi Task đến hạn còn lọc `st_program_due(program, …)`: một Task chứa Program nhiều lớp chu kỳ, Task đến hạn không có nghĩa mọi Program đến hạn | `apps/core/application/st/st_scheduler.cpp` (khối "Deadline RIÊNG của Program") |
| Lấy mẫu Trace | `StValueTrace::on_boundary` được gọi **sau** `st_apply_all_outputs`, tại mỗi ranh giới quét (base step), đọc thẳng slot của Program | `apps/core/application/runtime/scan_loop.cpp`; `apps/core/application/st/st_value_trace.hpp` |
| Chu kỳ lấy mẫu hiệu lực | `max(yêu cầu, base step)`; không gắn với lần release của Program | `st_trace_effective_sample_period_ms` |
| `cycle` trong mẫu | Số thứ tự mẫu trong ring Core, **không** phải danh tính lần chạy Program | `apps/web-api/internal/programming/application/trace.go` (`TraceSampleView.Cycle`) |
| `actualValue` | Gán bằng `programValue` cho mọi ô: `value.ActualValue = value.ProgramValue` | `trace.go` (vòng dịch mẫu Core) |

### 1.1 Hệ quả đo được

- **Lệch pha vào/ra.** Program 100 ms trong Task 10 ms: đầu vào của slot được nạp
  lại ở mỗi lần Task đến hạn, còn đầu ra chỉ đổi khi Program release. Một mẫu lấy
  giữa hai lần release có thể mang đầu vào mới và đầu ra của lần chạy trước.
  Phiên kiểm `PRG_DO16_MODBUS` gặp 3 lần trên 2 120 chu kỳ; bộ chấm phải nới luật.
  Chương trình chạy đúng — chỉ dữ liệu quan sát lệch pha.
- **`actualValue` nói dối nhẹ.** Với DO Modbus, giá trị này luôn bằng lệnh trong
  cùng mẫu, trong khi coil thật chỉ được đọc lại bằng FC01 mỗi 1 s. Người dùng dễ
  đọc nó như bằng chứng đầu ra thật.

## 2. Phạm vi

**Trong phạm vi:** ngữ nghĩa một mẫu Trace; trường mới trong reply IPC Trace và
OpenAPI `ProgrammingTraceValue`/`ProgrammingTraceSample`; hiển thị FE.

**Ngoài phạm vi:** đổi thời điểm nạp đầu vào cho **thực thi** (đó là ngữ nghĩa
điều khiển, thuộc `DDD-CTRL-PROG-001`); đổi chu kỳ poll Modbus.

## 3. Phương án cho vấn đề 1 — lệch pha vào/ra

| Phương án | Mô tả | Được | Mất |
|---|---|---|---|
| **A. Mẫu mang `releaseSeq`** | Mỗi Program có bộ đếm release; mẫu ghi `releaseSeq` của Program nguồn. BE/FE biết hai mẫu liền nhau cùng một lần chạy hay không | Không đổi thời điểm lấy mẫu; rẻ (một `uint64` mỗi Program mỗi mẫu) | Vẫn còn mẫu lệch pha — chỉ là **nhìn thấy** được |
| **B. Lấy mẫu tại release** | Chỉ lấy mẫu cho biến của Program X ở boundary mà X vừa release (sau output commit) | Mọi cặp (vào, ra) trong mẫu đến từ **đúng một** lần chạy | Chu kỳ mẫu thực = chu kỳ Program, không theo yêu cầu; phiên Trace nhiều Program khác chu kỳ phải tách nhóm |
| **C. Snapshot đầu vào tại release** | Giữ nguyên nhịp mẫu, nhưng giá trị đầu vào trong mẫu lấy từ bản **đã dùng** ở lần release gần nhất (copy nhỏ lúc release) | Nhịp mẫu giữ nguyên; cặp vào/ra nhất quán | Thêm một bộ đệm tĩnh cỡ số đầu vào được trace; phức tạp hơn A |

**Đề xuất: B + A.** Lấy mẫu biến của một Program chỉ ở boundary mà Program đó vừa
release, và mẫu mang `releaseSeq`. Lý do:

1. Trace dùng để chẩn đoán quan hệ nhân quả vào → ra. Chỉ B bảo đảm tính chất đó
   bằng cấu trúc; A chỉ cho phép phát hiện sau.
2. Chu kỳ mẫu nhanh hơn chu kỳ Program không mang thêm thông tin về Program: giữa
   hai lần release, slot Program không đổi (trừ đầu vào bị nạp lại — chính là
   nguồn lệch pha).
3. `releaseSeq` giúp BE nói thật về khoảng trống: hai mẫu có `releaseSeq` cách
   nhau 2 nghĩa là đã bỏ một lần chạy (tràn ring, tranh khoá), không phải "không
   đổi".

Phiên Trace gồm biến của nhiều Program khác chu kỳ: mỗi mẫu chỉ chứa ô của Program
vừa release, ô còn lại đánh `valid=false` với lý do `NOT_RELEASED` (không bịa giá
trị cũ). Phương án thay thế là cấm phiên trộn chu kỳ — xem câu hỏi Q2.

## 4. Phương án cho vấn đề 2 — lệnh và giá trị đọc lại

Tách `actualValue` thành hai trường, **bỏ** nghĩa mơ hồ hiện nay:

| Trường | Nghĩa | Nguồn |
|---|---|---|
| `commandedValue` | Giá trị Program đã ghi ra ở lần release này (bằng `programValue` cho biến đầu ra) | slot Program |
| `readbackValue` | Giá trị đọc về gần nhất từ thiết bị; `null` khi không có kênh đọc lại | Point Table: giá trị poll (FC01/FC03 với Modbus; read-back AO/DO nội bộ theo `TASK-PROG-303`) |
| `readbackAgeMs` | Tuổi của `readbackValue` tại thời điểm mẫu | mốc thời gian poll trong Point Table |

`actualValue` giữ thêm **một** phiên bản OpenAPI dưới dạng `deprecated`, bằng
`readbackValue` nếu có, ngược lại `null` — **không** còn bằng `programValue`. Lý
do không giữ nghĩa cũ: một trường mang tên "actual" mà chép lệnh là đúng loại lỗi
làm người vận hành tin sai.

Chỉ biến có binding tới điểm vật lý/Modbus mới có `readbackValue`. Biến nội bộ để
`null` và FE hiện "—", không hiện 0.

## 5. Ảnh hưởng hợp đồng

| Hợp đồng | Thay đổi | Tương thích |
|---|---|---|
| IPC `programming_v1` reply trace-sample | thêm `release_seq` mỗi mẫu; thêm `readback_bits`, `readback_valid`, `readback_age_ms` mỗi ô | Thêm trường ở cuối khung; cần bump minor + golden mới trong `contracts/ipc/programming_v1/golden/` |
| OpenAPI (`ProgrammingTraceSample`, `ProgrammingTraceValue`) | thêm `releaseSeq`, `commandedValue`, `readbackValue`, `readbackAgeMs`; `actualValue` → `deprecated` | minor bump; re-pin `g1_contract_join_v1.json` |
| Bộ nhớ Core | `StValueTrace` lưu thêm theo ô (readback 8 byte + tuổi 4 byte + cờ) và theo mẫu (`release_seq` 8 byte) | tăng ngân sách tĩnh ~1,6× của `kMaxTraceCells`; cần Core Lead chấp thuận hoặc giảm `kMaxTraceCells` |
| FE Trace | cột "Lệnh" và "Đọc lại (tuổi)" tách riêng; khoảng trống release hiển thị rõ | không phá hợp đồng cũ |

## 6. Kiểm chứng (điều kiện đóng Issue)

| Mã | Test | Tầng |
|---|---|---|
| T-798-1 | Program 100 ms trong Task 10 ms, đầu vào đổi giữa hai release: **mọi** mẫu có cặp (đầu vào, đầu ra) cùng một `releaseSeq` | Core CTest (`test_st_value_trace`) |
| T-798-2 | Phiên trộn Program 10 ms và 100 ms: ô của Program chưa release mang `valid=false`, lý do `NOT_RELEASED` | Core CTest |
| T-798-3 | `releaseSeq` liên tiếp; khi ép tranh khoá thì khoảng trống được báo, không lặng lẽ | Core CTest |
| T-798-4 | DO Modbus: `readbackValue` khác `commandedValue` khi relay chưa kịp đổi; `readbackAgeMs` tăng giữa hai lần poll | Go test với Point Table giả + kiểm trên bo |
| T-798-5 | `actualValue` không còn bằng `programValue` cho biến không có read-back | Go test |
| T-798-6 | Golden IPC/OpenAPI mới, `g1_contract_join_v1.json` re-pin | contract gate |

## 7. Thứ tự làm sau khi được duyệt

1. Core: bộ đếm release theo Program + lấy mẫu tại release (T-798-1..3).
2. IPC: thêm trường, golden, dual-reader.
3. BE: dịch trường mới, `actualValue` deprecated (T-798-4..5).
4. OpenAPI + re-pin (T-798-6).
5. FE: tách cột, hiển thị khoảng trống.
6. Kiểm trên bo với `PRG_DO16_MODBUS`, cập nhật `REC-DDC-FIELD-USE-20260927` §5.

## 8. Câu hỏi cần người duyệt trả lời

| # | Câu hỏi | Đề xuất của tài liệu | Người quyết |
|---|---|---|---|
| Q1 | Chọn B + A (lấy mẫu tại release) hay chỉ A (đánh dấu) hay C (snapshot đầu vào) | B + A | Core Lead + Product |
| Q2 | Phiên Trace trộn Program khác chu kỳ: cho phép với ô `NOT_RELEASED` hay cấm | Cho phép | Product |
| Q3 | Ngân sách RAM tăng thêm của `StValueTrace` chấp nhận được không, hay giảm `kMaxTraceCells` | Giữ 10 000 ô nếu đo trên target cho thấy còn dư | Core Lead |
| Q4 | `actualValue` giữ một phiên bản dạng deprecated hay bỏ ngay | Giữ một minor | BE Lead |

Chủ dự án chấp thuận Q1–Q4 theo cột "Đề xuất" ngày 2026-09-28 khi giao triển
khai Issue #798; hiện thực theo đúng các đề xuất đó (§9).

## 9. Kết quả hiện thực

| Mục | Kết quả |
|---|---|
| Q1 (B + A) | `StValueTrace` chỉ lấy mẫu ở boundary có ít nhất một Program được theo dõi vừa chạy (`StProgramInstance::last_release_base_step == base_step_count()`); mẫu tới hạn ở boundary khác được **hoãn** tới release kế. Mỗi ô mang `releaseSeq` (= `run_count`). Không Program nào còn được dispatch (STOPPED/FAULTED/không phân giải) thì lấy mẫu ngay; hoãn quá 50 s (chu kỳ dài nhất của profile) cũng lấy mẫu — phiên không bao giờ đứng im không dấu vết |
| Q2 (cho phép phiên trộn) | Ô của Program không chạy ở boundary của mẫu: `valid=false`, lý do `NOT_RELEASED`, **không** chép slot. BE công bố `quality=UNKNOWN`, `freshness=UNAVAILABLE`, `unavailableReason=NOT_RELEASED` |
| Q3 (RAM) | Giữ `kMaxTraceCells = 10 000`. `StValueTrace` thêm 160 KB tĩnh (số release u32, số đọc lại 8 B, tuổi u32 mỗi ô; lý do + trạng thái đọc lại gói vào byte `valid_` sẵn có) — ~170 KB → ~330 KB. Số release 32 bit quấn sau ~497 ngày ở 10 ms; người đọc chỉ dùng hiệu giữa hai mẫu liền nhau. Chưa đo trên target |
| Q4 (`actualValue`) | Giữ một minor dưới dạng `deprecated`: bằng `readbackValue`, rỗng khi không có kênh đọc lại — **không** còn chép `programValue` |
| Đọc lại | `st_output_readback`: điểm của binding đầu ra trong bảng điểm Core (feedback AO/DO nội bộ; giá trị poll + `sample_mono_ns` của Modbus EXT). Điểm không GOOD hoặc không đổi được về kiểu biến ⇒ UNAVAILABLE, không bịa |
| IPC | `TRACE_READ` `[sessionId, fromSequence, cellFormat]`; `cellFormat = 2` cho ô `[valid, bits, reason, releaseSeq, readbackState, readbackBits, readbackAgeMs]`. Core vẫn phục vụ BE cũ bằng dạng 1; BE mới gặp Core cũ (`IPC-PAYLOAD`) thì đọc tiếp bằng dạng 1. Không đổi `schema.json`/golden IPC (dạng payload là phần mô tả ở README §4.2) |
| OpenAPI | 1.46.0 → **1.47.0**: `ProgrammingTraceValue` + `commandedValue`, `readbackValue`, `readbackAgeMs`, `releaseSeq`, `unavailableReason`; `actualValue` `deprecated`. Re-pin G1 và `pgm02` |
| FE | Bảng Trace: cột "Đọc lại (tuổi)" thay cột "Actual", "lần chạy N" dưới mốc, ô NOT_RELEASED ghi "không chạy" |
| T-798-1..3 | `test_st_value_trace.cpp`: `T798_1_…` (Program 100 ms trong Task 10 ms, 300 boundary, 30 mẫu, 0 cặp lệch), `T798_2_…` (phiên trộn 10/100 ms: 100 mẫu, 10 ô chậm hợp lệ, 90 ô NOT_RELEASED), `T798_3_…` (release 1, 2, 4, 5 khi boundary 200 ms bị chặn; biến lạ UNRESOLVED), `StoppedProgramDoesNotFreezeTheSession` |
| T-798-4 | Core: `T798_4_…` (lệnh đóng, đọc lại mở, tuổi 5 → 25 ms, đuổi kịp ở 40 ms, không bảng điểm ⇒ UNAVAILABLE). Go: `TestTraceReadbackIsSeparateFromCommand`. **Trên bo (2026-09-28):** lần đầu FAIL — mọi ô DO Modbus đọc lại = lệnh, tuổi 0, vì `PointWriter::write` ghi lệnh vào chính ô EXT (`set_virtual`) trước khi Trace lấy mẫu. Sửa: PointTable giữ `ext_reported_[]` (chỉ `update_ext` ghi) cho đọc lại EXT; đầu ra AV/BV/MSV không có kênh đọc lại ⇒ UNAVAILABLE (null). Test `T798_4_ModbusReadbackIsThePolledCoilNotTheCommandJustWritten`, `T798_4_VirtualPointOutputHasNoReadback` (đỏ trên mã cũ). Kiểm lại trên bo PASS: Trace 100 ms 485/7 200 ô DO đọc lại ≠ lệnh, tuổi 28…1 097 ms reset theo poll FC01 ~1 s, lệnh → đọc lại khớp trung vị 500 ms; Trace 10 ms `releaseSeq` +1 ở 1 499/1 499 khoảng; `actualValue` = `readbackValue` 0 lệch |
| T-798-5 | Go: `TestTraceActualValueNoLongerCopiesProgramValue`, `TestTraceFallsBackToLegacyCellsOnOldCore`, `TestTraceReadCellDecodesBothFormats` |
| T-798-6 | IPC `TraceReadCellFormatTwoCarriesReleaseAndReadback`; G1 10/10 và PGM-02 PASS sau re-pin |

## Lịch sử sửa đổi

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 0.3 | 2026-09-28 | §9 T-798-4 trên bo: lỗi đọc lại EXT bị lệnh ghi đè, cách sửa (`ext_reported_`, VP không có đọc lại) và số đo trên bo sau sửa (`EV-PROG-TRACE-798-TARGET`) |
| 0.2 | 2026-09-28 | Chủ dự án chấp thuận Q1–Q4; hiện thực HOST (Core, IPC, BE, OpenAPI 1.47.0, FE); §9 kết quả |
| 0.1 | 2026-09-28 | Bản đề xuất đầu tiên cho Issue #798 (U-04): hiện trạng đối chiếu `main@9910b88`, ba phương án lấy mẫu, tách `commandedValue`/`readbackValue`, ảnh hưởng hợp đồng, test đóng Issue và câu hỏi duyệt |
