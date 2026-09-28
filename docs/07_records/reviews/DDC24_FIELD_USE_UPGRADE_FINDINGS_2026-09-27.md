# Đánh giá mã nguồn DDC-24 qua sử dụng thực tế — vấn đề cần nâng cấp và cải tiến

| Thuộc tính | Giá trị |
|---|---|
| ID | `REC-DDC-FIELD-USE-20260927` |
| Ngày | 2026-09-27 |
| Phạm vi | Programming (ngôn ngữ ST, compiler, runtime Core, Check/Draft/Trace của web-api), Point/Virtual Point, đường ghi Modbus của iobus, công cụ và quy trình triển khai |
| Mốc mã nguồn | `origin/main@12af1082` (= RC `f86150e3` + 3 commit tài liệu); web trên bo lab thêm PR #795 (`86aa4ede`). Dẫn chứng `file:dòng` đọc tại các mốc này |
| Người rà | Claude, qua phiên viết – triển khai – kiểm chứng chương trình `PRG_DO16_MODBUS` |
| Kết luận | **Nền tảng chạy tin cậy** (3 785 chu kỳ kiểm từng chu kỳ, 0 lỡ nhịp, 0 lỗi runtime). **21 vấn đề cần nâng cấp/cải tiến**: 1 lỗi đã sửa ở PR #795 chờ merge, 5 lỗi/lệch hợp đồng chưa sửa, 15 giới hạn và điểm cản trở năng suất. Ưu tiên cao nhất: merge #795, gộp FC15 cho Modbus, làm Trace trung thực, mở rộng ngôn ngữ ST (#367) |
| Căn cứ | [`GUIDE-PROG-ST-DO16-001`](../../06_operations/PROGRAMMING_ST_DO16_MODBUS_GUIDE.md) bản 1.3; [`EV-PROG-DO16-MB-20260927`](../test-evidence/programming/2026-09-27-do16-modbus-target-deploy.md); PR [#795](https://github.com/Mekong-HCM/MK-DDC-24/pull/795) |

## 0. Cách đánh giá

Đây không phải một đợt audit toàn bộ mã nguồn. Các vấn đề dưới đây là những gì **thực sự cản trở hoặc gây sai** khi một kỹ sư dùng bộ điều khiển để làm một việc thật:

1. Viết chương trình ST điều khiển 16 DO Modbus: 5 FUNCTION + 5 FUNCTION_BLOCK + 1 PROGRAM, 8 chế độ và chế độ AUTO.
2. Biên dịch bằng compiler thật, và mô phỏng 16 kịch bản trên host bằng runtime thật.
3. Triển khai lên bo lab Foxlinx qua API: Virtual Point, Draft, Check, Commission, Enable.
4. Nghiệm thu T1–T12 trên bus RS-485 thật, rồi kiểm **từng chu kỳ** bằng Trace của Core: 2 120 chu kỳ cho 8 chế độ và 1 665 chu kỳ cho AUTO.

Mỗi vấn đề ghi kèm kịch bản hỏng đã gặp hoặc số đo, dẫn chứng `file:dòng`, và đề xuất có tiêu chí đóng. Vấn đề nào chỉ suy ra từ mã mà chưa thử trên UI/bo thì ghi rõ "theo mã".

## 1. Điều đang làm tốt (nên giữ)

| Hạng mục | Bằng chứng đo được |
|---|---|
| Runtime Core ổn định | 3 785 chu kỳ Program 100 ms kiểm từng chu kỳ: `missedRelease = 0`, `faultCount = 0`. Program 16 kênh chạy 40–68 µs; task base 10 ms 0 overrun, jitter tối đa 68 µs |
| Compiler chặt, chẩn đoán đúng chỗ | Bắt đúng dòng/cột các lỗi thật: trùng từ khoá (`tOn` = `TON`), nhãn CASE quá lớn, sai số đối số FUNCTION, khai báo có giá trị khởi tạo |
| Vòng Check → Commission an toàn | ETag, `expectedActiveRevisionId`, bảng impact bắt xác nhận từng nhóm; 5 lần Commission trên bo, lần chậm nhất 0,55 s. Draft của người dùng không bị ghi đè nhờ ETag |
| Đầu ra an toàn khi Disable | 16 FC05 về `safe_value` phát xong trong 0,43 s |
| RETAIN và ý định chạy qua Commission | `StsTrips` (RETAIN) giữ qua 3 lần Commission; Program tự `RUNNING` lại sau Commission |
| Bus Modbus sạch | 692 FC05 trong hai lượt nghiệm thu, 100 % ACK, 28–30 ms/giao dịch, 0 timeout/CRC |

## 2. Danh sách vấn đề

Mức: **P1** ảnh hưởng tính đúng hoặc khả năng dùng cho dự án thật; **P2** gây sai lệch quan sát hoặc cản trở lớn; **P3** cản trở năng suất, lệch tài liệu.

| ID | Mức | Nhóm | Vấn đề | Trạng thái |
|---|---|---|---|---|
| U-01 | P1 | Check / Point | Check từ chối mọi binding vào VP `integer` và `multistate` | **Đã sửa ở PR #795, chờ merge**; bo lab đang chạy bản vá |
| U-02 | P2 | Trace | Phiên Trace thứ hai âm thầm lấy mẫu thưa (~500 ms) nhưng vẫn báo 100 ms, 0 mẫu rơi | Mở |
| U-03 | P3 | Hợp đồng API | Trace trả `freshness = "FRESH"` ngoài enum OpenAPI | Mở |
| U-04 | P2 | Trace / quan sát | Một mẫu Trace có thể trộn đầu vào mới với đầu ra cũ; `actualValue` của DO Modbus là lệnh chứ không phải giá trị đọc lại | Mở |
| U-05 | P3 | Virtual Point | "writable" mang hai nghĩa ngược nhau giữa UI và Check | Mở |
| U-06 | P2 | Thư viện | Không có đường UI để POU ST khai phụ thuộc vào khối Thư viện PROJECT | Mở (theo mã) |
| U-07 | P1 | Modbus | Ghi từng coil một, không gộp FC15: 16 DO mất ≈ 0,46 s và tốn băng thông bus | Phần đánh thức theo sự kiện và ghi trước đọc của G7 đã có trên `main` (2026-09-26); gộp FC15 chưa làm |
| U-08 | P2 | Compiler | Trần 512 slot/Program; mỗi lời gọi FUNCTION/FB được inline và cấp slot riêng | Mở |
| U-09 | P2 | Trace | Quota 10 000 ô/phiên: 27 biến chỉ ghi được ≈ 37 s | Mở |
| U-10 | P2 | Ngôn ngữ ST | Thiếu ARRAY/STRUCT, toán tử bit trên số nguyên, `VAR CONSTANT`, giá trị khởi tạo, phép nhân TIME | #367 đang mở cho ARRAY/STRUCT; phần còn lại chưa có Issue |
| U-11 | P3 | Compiler | Nhãn CASE bị bung thành tập giá trị, nên dải lớn bị từ chối | Mở |
| U-12 | P2 | Thư viện hệ thống | Thiếu khối DDC thường dùng; tự viết thì dễ sai (phiên này mắc 4 lỗi trong các khối tự viết) | Mở |
| U-13 | P1 | Sản phẩm | `PID` bị cổng review chặn, nên không Program nào dùng được vòng PID | Chờ quyết định sản phẩm |
| U-14 | P3 | API | Sai `baseRevisionId` khi PATCH Draft chỉ nhận `409` chung chung | Mở |
| U-15 | P3 | API | `upsertObject` thay cả object, dễ xoá mất biến và binding khi chỉ muốn sửa mã | Mở |
| U-16 | P3 | Công cụ | CLI biên dịch đòi khoá ký cả khi chỉ kiểm cú pháp; chưa có công cụ mô phỏng Program cho người viết | Mở |
| U-17 | P3 | Tài liệu | `FBD_CREATION_AND_ACTIVATION_GUIDE.md` lạc hậu (chu kỳ, danh sách xác nhận) | Mở |
| U-18 | P3 | Chẩn đoán | Frame Monitor không ghi giá trị của lệnh ghi | Mở |
| U-19 | P3 | Hiệu năng API | Một lệnh ghi VP mất ~4 s (các lệnh khác ~0,1 s) | Ghi nhận, chưa tái hiện |
| U-20 | P2 | An toàn đầu ra | Program FAULTED thì DO Modbus giữ giá trị cuối tới 60 s | Theo mã; gắn với #384 |
| U-21 | P3 | Triển khai | Web dùng chung binary với 2 helper; restart thiếu thì helper chạy bản cũ; bo đang chạy bản chưa merge | Mở |

## 3. Chi tiết và đề xuất

### 3.1 Tính đúng và hợp đồng

**U-01 — Check từ chối VP `integer`/`multistate` (P1, đã sửa ở PR #795).**
- *Kịch bản:* ánh xạ `CmdMode : UINT` vào VP multistate `MSV-01` và `CmdManualMask : REAL` vào VP integer `AV-02`, đúng như tab Ánh xạ gợi ý. Check FAILED với `PIO-SRC-001`: "cần integer" / "cần float".
- *Gốc:* cùng một câu hỏi "VP này là kiểu ST gì" được trả lời ở **ba nơi**: `st_io_map.cpp:103` (Core: `AV ⇒ REAL`, `BV ⇒ BOOL`, `MSV ⇒ UINT`), `programming_pointcatalog.go:522` (catalog, khớp Core) và `point_binding_facts.go:193` (Check, suy từ `signalType`, **lệch**). Đây là lần thứ tư cùng lớp lỗi (ISS-PIO-33/34).
- *Đề xuất:* merge #795. Tiếp đó sinh bảng kiểu slot từ **một** nguồn (contract JSON → C++/Go), kèm một test chéo ba lớp: mỗi `signalType` phải cho cùng kiểu ở Core, catalog và Check.
- *Đóng khi:* #795 merged; thêm test chéo; lần thay đổi sau chỉ phải sửa một chỗ.

**U-02 — Trace thứ hai âm thầm lấy mẫu thưa (P2).**
- *Kịch bản:* mở phiên Trace thứ hai trong khi phiên thứ nhất đang chạy (web cho tới 4: `trace.go:97`). Core chỉ nhận một phiên (`st_value_trace.cpp:61-66`), nên web rơi về poll monitor. Đo được: 111 mẫu trong 55,5 s, cách nhau 132–1 065 ms (thiếu ~80 % chu kỳ), trong khi view vẫn báo `effectiveSamplePeriodMs = 100`, `droppedSamples = 0`.
- *Hệ quả:* người dùng tin mình có dữ liệu từng chu kỳ trong khi thực tế không có. Đây là loại lỗi nguy hiểm nhất cho việc chẩn đoán.
- *Đề xuất:* hoặc hạ `maxConcurrentTraces` về số phiên Core thật sự phục vụ, hoặc thêm trường `source: CORE | POLL_FALLBACK`, báo chu kỳ lấy mẫu thật đo được, và đếm chu kỳ bị bỏ vào `droppedSamples`.
- *Đóng khi:* test mở 2 phiên đồng thời thấy phiên thứ hai hoặc bị từ chối rõ ràng, hoặc báo đúng nguồn và chu kỳ thật.

**U-03 — `freshness = "FRESH"` ngoài hợp đồng (P3).**
- `trace.go:597` trả `FRESH` cho mẫu từ Core, trong khi `ProgrammingTraceValue.freshness` ở `contracts/openapi/openapi.yaml:4353` chỉ cho `LIVE | STALE | UNAVAILABLE`. FE đã tự xử lý `FRESH` (`WatchTab.tsx:547`), nên lệch này chỉ được "vá" ở phía đọc.
- *Đề xuất:* cập nhật enum (hoặc dùng trường `source` của U-02), sinh lại client, thêm contract test kiểm response Trace theo schema.

**U-04 — Mẫu Trace không nhất quán vào/ra; `actualValue` không phải giá trị đọc lại (P2).**
- *Kịch bản 1:* `st_capture_due_inputs` (`st_process_image.cpp:277`) chốt đầu vào cho **mọi** Program của Task ở **mỗi** base step 10 ms, trong khi Program chạy mỗi 100 ms. Vì vậy một mẫu Trace có thể chứa đầu vào đã đổi nhưng đầu ra còn của lần chạy trước. Khi kiểm từng chu kỳ, bộ chấm phải nới "khớp với đầu vào mẫu trước"; gặp 3 lần trên 2 120 chu kỳ. Chương trình chạy đúng; chỉ dữ liệu quan sát bị lệch pha.
- *Kịch bản 2:* với DO Modbus, `actualValue` luôn bằng `programValue` ngay trong cùng chu kỳ, nên nó là giá trị lệnh trong bảng điểm Core, không phải coil đọc về (FC01 poll mỗi 1 s). Tên gọi dễ khiến người dùng tưởng đã có bằng chứng đầu ra thật.
- *Đề xuất:* gắn số thứ tự lần chạy của Program vào mỗi mẫu, hoặc lấy mẫu đầu vào đúng lúc Program chạy. Đổi tên hoặc tách `commandedValue` / `readbackValue`, trong đó `readbackValue` lấy từ lần poll gần nhất kèm tuổi dữ liệu.

**U-05 — "writable" hai nghĩa (P3).**
- UI coi VP chủ sở hữu `PROGRAM` là **không** ghi được (`VirtualIoPage.tsx:1024`: `writable && owner !== 'PROGRAM'`). Check lại **đòi** `writable = true` thì Program mới được ghi (`point_binding_facts.go:159`). Trong phiên này, đặt `writable = false` cho VP trạng thái (để người vận hành không sửa được) khiến Check FAILED 3 lỗi.
- *Đề xuất:* Check chỉ dựa vào `source = PROGRAM`; `writable` chỉ còn nghĩa "người vận hành sửa được không". UI khoá ô này khi chủ sở hữu là `PROGRAM`.

**U-06 — Không khai được phụ thuộc thư viện cho POU ST (P2, theo mã).**
- Program gọi khối **lấy từ Thư viện PROJECT** phải khai `requiresLibrary`, nếu không Check báo `ST-LIB-001` (đã kiểm bằng CLI). Trên FE, chỉ trình soạn khối thư viện ghi `dependencies` (`LibraryAuthoringDrawer.tsx:197`). Còn chèn khối vào POU ST (`EditorPane.tsx:2417` `applyLibraryInsertion`) chỉ chèn chữ, không ghi phụ thuộc. Hệ quả: người dùng buộc phải chép khối vào Cây POU, mất lợi ích quản lý phiên bản.
- *Đề xuất:* thao tác chèn tự thêm `objects[].dependencies`, hoặc Check suy phụ thuộc từ các lời gọi trong nguồn rồi ghim theo lock.
- *Đóng khi:* e2e: tạo khối PROJECT → chèn vào POU ST → Check PASSED.

### 3.2 Hiệu năng và khả năng mở rộng

**U-07 — Modbus ghi từng coil một (P1).**
- `bus_worker.cpp:968-971` ghi mỗi điểm bằng FC05, hoặc FC15 với **count = 1**. `enqueue_write` (`bus_worker.cpp:439`) chỉ gộp lệnh chờ của **cùng một coil**. Đo trên bo (iobus đã có G7):
  - 16 DO đổi cùng lúc = 16 giao dịch, trải 0,43–0,46 s; relay CK508-05 đóng sau CK508-04 gần nửa giây.
  - BLINK 1 s chiếm ≈ 46 % bus 9600, cộng nền poll ≈ 62 %; BLINK 0,5 s sẽ vượt 100 %. Chương trình phải tự chặn nhịp tối thiểu.
- *Đã có trên `main`:* G7 của audit 25/09 ("Fixed — Lệnh Core → Modbus lên dây theo sự kiện", 2026-09-26) đánh thức luồng bus theo `ext_cmd_seq`, cho lệnh ghi đi trước lượt đọc và giới hạn số mục mỗi lượt. Số đo ở trên lấy trên iobus đã có G7, nên phần trễ còn lại đến từ việc ghi tuần tự từng coil.
- *Đề xuất còn lại:* mỗi lượt, gộp các coil liền kề của cùng slave thành một FC15: 16 coil trên 2 module → 2 giao dịch ≈ 60 ms.
- *Đóng khi:* đo lại T4 BLINK trên bo: 16 DO đổi trong ≤ 2 giao dịch, lệch giữa hai module ≤ 1 giao dịch.

**U-08 — Trần slot và inline từng lời gọi (P2).**
- Trần 512 slot ghi được mỗi Program (`st_profile_generated.hpp:50`). Mỗi lời gọi FUNCTION được inline và cấp biến mới theo số thứ tự lời gọi (`st_compile.cpp:685`); mỗi instance FB người dùng mang theo toàn bộ biến của nó. Program 16 DO dùng **467/512 (91 %)**, mỗi kênh tốn 15 slot, nên không thể mở rộng lên 32 DO trong một Program. Muốn biết còn dư bao nhiêu, người dùng phải dò bằng cách thêm biến giả, vì thông báo `ST-POU-004` chỉ nêu điểm vượt đầu tiên.
- *Đề xuất:* tái dùng slot của lời gọi FUNCTION đã kết thúc (cấp phát theo phạm vi), báo mức dùng slot/lệnh/instance trong kết quả Check, cân nhắc nâng trần theo ngân sách RAM đo được.

**U-09 — Trace ngắn (P2).**
- `maxTraceValueCells = 10000` (`trace.go:98`): 27 biến chỉ ghi được ≈ 37 s. Muốn kiểm một vòng AUTO 137 s phải ghép nhiều phiên, và theo U-02 thì không chạy chồng được.
- *Đề xuất:* cho tải trace về dạng file (CSV/NDJSON) ghi dần phía server, quota theo dung lượng thay vì số ô, hoặc cho chọn lấy mẫu "khi đổi giá trị".

### 3.3 Ngôn ngữ ST và thư viện

**U-10 — Ngôn ngữ còn thiếu những thứ cơ bản cho DDC (P2).**

| Thiếu | Dẫn chứng | Hệ quả gặp trong phiên |
|---|---|---|
| ARRAY/STRUCT/VAR_IN_OUT | #367 | 16 kênh viết tay 16 lần: 16 instance, 16 lời gọi, 16 phép gán |
| Toán tử bit trên số nguyên | `a AND b` với `UINT` → `ST-SEM-002 logical operator requires BOOL` | Phải tách bit bằng `MOD 2` và `/ 2`; phải viết thêm khối `FB_MASK_SPLIT` |
| `VAR CONSTANT` | `ST-SYN-001` | Hằng số "ma thuật" 21845/43690/61680 nằm rải rác trong mã |
| Giá trị khởi tạo khi khai báo | `st_parser.cpp:849`, `ST-SYN-001` | Mọi tham số phải lấy từ VP hoặc gán ở chu kỳ đầu |
| TIME × số | `ST-SEM-002 TIME vs DINT` | Phải đi vòng qua `TIME_TO_REAL`/`REAL_TO_TIME` |

- *Đề xuất:* ưu tiên #367 (ARRAY tĩnh + STRUCT). Kế đến là toán tử bit trên `UINT`/`WORD`, `VAR CONSTANT` và giá trị khởi tạo hằng. Các tính năng này đều giữ được WCET tĩnh (ADR-054).

**U-11 — Nhãn CASE bị bung thành tập (P3).**
- `st_parser.cpp:1192` bung mọi nhãn thành tập giá trị, rồi so với trần câu lệnh. Nhãn `16..32767:` bị từ chối "CASE label set is too large", phải viết lại bằng `IF`.
- *Đề xuất:* lưu nhãn dạng khoảng `[lo, hi]` và kiểm trùng lặp theo khoảng.

**U-12 — Thư viện hệ thống thiếu khối DDC thường dùng (P2).**
- Để có 8 chế độ, phiên này phải tự viết: bảo vệ relay (đóng/nghỉ tối thiểu, đếm số lần đóng), bậc tải, bộ nhịp và xung vuông, tách bit. Và đã **mắc 4 lỗi hành vi** trong chính các khối đó; cả 4 chỉ lộ ra qua mô phỏng hoặc kiểm từng chu kỳ trên bo:
  1. Nhịp trôi 1,0 → 1,2 s do dùng TON tự nạp lại.
  2. STAGGER đóng dồn 7 relay.
  3. STAGING nhả relay tạo "lỗ" và dồn nhau.
  4. Relay bị giữ 10 s khi đổi sang chế độ tải.

  Người dùng khác sẽ gặp lại đúng những lỗi này.
- *Đề xuất:* bổ sung vào thư viện SYSTEM, kèm test chuẩn:
  - `RELAY_GUARD` (đóng/nghỉ tối thiểu, cưỡng bức tắt);
  - `STAGER` (tăng/giảm có chờ đầu ra, nhả LIFO);
  - `PULSE_GEN`/`BLINK` không trôi;
  - `WORD_TO_BITS`/`BITS_TO_WORD`;
  - một hàm thời gian đơn điệu hoặc bộ đếm chu kỳ (phiên này phải dùng TON chạy tự do 12 h thay thế).

**U-13 — `PID` bị chặn (P1, quyết định sản phẩm).**
- `st_profile_generated.hpp:68` đánh dấu `PID` là `REVIEW_REQUIRED` và chưa được duyệt, nên Check từ chối mọi Program dùng `PID`. Với bộ điều khiển DDC cho HVAC, vòng PID là chức năng lõi.
- *Đề xuất:* hoàn tất review Controls/Safety và ký token, hoặc công bố lộ trình. Trong lúc chờ, ghi rõ trong tài liệu người dùng.

### 3.4 API, công cụ, tài liệu, vận hành

**U-14 — Lỗi 409 không nói trường nào sai (P3).**
- `projects.go:254`: `baseRevisionId` phải là **base** của Draft; gửi nhầm ID Draft (như tài liệu gốc gợi ý) chỉ nhận `409 PRG-ERR-CONFLICT-001`.
- *Đề xuất:* thêm `detailCode` (ví dụ `BASE_REVISION_MISMATCH`) kèm giá trị mong đợi.

**U-15 — `upsertObject` thay toàn bộ object (P3).**
- `draft_v2.go:382`: muốn sửa mã nguồn một POU qua API phải gửi kèm đủ `locals`/`interface`; quên thì mất 27 biến và kéo theo hỏng binding. Hiện đã có `annotateObject` chỉ vá mô tả.
- *Đề xuất:* thêm op `setSource` (kiểm ETag), chỉ đổi `source`.

**U-16 — Công cụ cho người viết chương trình (P3).**
- `mkddc-st-compile` đòi `--key` kể cả khi chỉ kiểm cú pháp (`st_compile_main.cpp:1030`). Chưa có công cụ chạy thử Program trên host theo kịch bản; phiên này phải tự viết harness C++ liên kết `libst_compiler_lib` và `libcore_runtime`.
- *Đề xuất:* thêm `--check-only` không cần khoá; thêm `mkddc-st-sim`: nhận kịch bản đầu vào theo thời gian, xuất CSV từng chu kỳ, dùng được trong CI của dự án ứng dụng.

**U-17 — Tài liệu gốc lạc hậu (P3).**
- `FBD_CREATION_AND_ACTIVATION_GUIDE.md:35` vẫn ghi chỉ có chu kỳ 1000/5000/30000 ms (trái ADR-061). `:392` ghi cứng danh sách xác nhận Commission, thiếu `virtualPointChanges`, nên làm theo sẽ nhận `422 PRG-ERR-ACK-MISSING-001`.
- *Đề xuất:* sửa hoặc gộp vào `PROGRAMMING_OPERATIONS_RUNBOOK.md`; tham chiếu §6.8 của `GUIDE-PROG-ST-DO16-001` cho luồng API đã kiểm trên bo.

**U-18 — Frame Monitor thiếu giá trị ghi (P3).**
- Frame FC05/FC15 chỉ có thời điểm, slave, FC, địa chỉ, số lượng, kết quả và thời gian giao dịch (`at, slave, fc, addr, count, ok, reason, elapsedUs, attempt`), không có giá trị. Muốn biết lệnh đóng hay mở, phải suy từ readback 1 s sau.
- *Đề xuất:* thêm giá trị (hoặc bitmap với FC15) vào bản ghi frame.

**U-19 — Một lệnh ghi VP chậm bất thường (P3, quan sát).**
- `PUT /api/v1/points/VP7` mất ~4 s, trong khi hàng chục lệnh cùng loại khác mất ~0,1 s. Chưa tái hiện được.
- *Đề xuất:* ghi log thời gian từng pha (khoá cấu hình, ghi tệp, đồng bộ Core) cho lệnh ghi VP để lần sau có dữ liệu.

**U-20 — Đầu ra khi Program FAULTED (P2, theo mã).**
- Instance FAULTED thì đầu ra được giữ tới hết TTL giữ, sàn 60 s (`st_scheduler.hpp:160` `kSignedTtlMs = 60000`), rồi mới về `safe_value`. Trong khi đó Disable về an toàn trong 0,43 s. Với DO Modbus điều khiển tải thật, giữ 60 s sau lỗi runtime có thể quá dài.
- *Đề xuất:* quyết định trong ma trận chính sách đầu ra #384 (ISS-PIO-34), có thể cấu hình theo điểm. Đo thực tế trên bo trước khi chốt.

**U-21 — Triển khai web dễ để lại tiến trình cũ; bo lệch bản phát hành (P3).**
- `mkddc-reload-helper` và `mkddc-time-helper` dùng chung binary `/opt/mkddc-web/mkddc-web`. Chỉ restart `mkddc-web-pi` thì hai helper tiếp tục chạy bản cũ đã bị thay (`(deleted)`), đúng như phiên này gặp. Ngoài ra bo lab hiện chạy web của PR #795 chưa merge, khác bản RC `f86150e3` mà release record ghi nhận.
- *Đề xuất:* `install.sh`/công cụ deploy kiểm `/proc/<MainPID>/exe` của cả ba unit và báo lỗi nếu còn `(deleted)`; merge #795 rồi cập nhật release record.

## 4. Lộ trình đề xuất

| Đợt | Việc | Lý do |
|---|---|---|
| Ngay | Merge #795 (U-01); U-02 + U-03 (Trace trung thực); U-05; U-14; U-17; U-21 | Lỗi đúng/sai hoặc gây hiểu nhầm, sửa nhỏ, rủi ro thấp |
| Sprint kế | U-07 (gộp FC15; đánh thức theo sự kiện đã có từ G7); U-06; U-15; U-16 (`--check-only`); U-18; U-09 | Tăng hiệu năng I/O mở rộng và năng suất người viết chương trình |
| Trung hạn | #367 + toán tử bit + `VAR CONSTANT` (U-10); U-08; U-12 (khối DDC trong thư viện SYSTEM); U-11; U-04; `mkddc-st-sim` (U-16) | Thay đổi ngôn ngữ/compiler, cần thiết kế và review |
| Cần quyết định sản phẩm | U-13 (duyệt `PID`); U-20 (#384) | Thuộc thẩm quyền Controls/Safety và Product |
| Theo dõi | U-19 | Chưa tái hiện |

## 5. Giới hạn của đánh giá

- Chỉ một chương trình (16 DO Modbus, 8 chế độ + AUTO) trên một bo lab. Không đánh giá BACnet, HMI, Scheduler, Historian, cũng như I/O cục bộ với MCU thật (bo dùng fake MCU).
- Không có phép đo điện tại tiếp điểm relay; mọi kết luận về đầu ra dừng ở lệnh FC05 được ACK và giá trị coil đọc lại.
- U-06 và U-20 suy từ mã, chưa thử trọn trên UI/bo.
- Không phải audit bảo mật; các vấn đề bảo mật của bo lab đã có hồ sơ riêng.

## Lịch sử sửa đổi

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-09-27 | Bản đầu: 21 vấn đề rút từ việc viết, triển khai và kiểm từng chu kỳ `PRG_DO16_MODBUS` trên bo lab Foxlinx |
