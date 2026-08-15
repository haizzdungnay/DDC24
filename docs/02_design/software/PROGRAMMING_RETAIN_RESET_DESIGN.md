# RETAIN Reset — Design (WP-12)

**Document ID:** DDD-RETAIN-RESET-PROG-001
**Phiên bản:** 1.0
**Trạng thái:** **Draft — chờ xác nhận Core + Safety trước khi implement**
(đúng exit criteria `WP-12`: *"Handler thật tồn tại VÀ đã qua review Safety
— không code trước khi có xác nhận semantics"*)
**Tác giả:** System Engineering, theo Lệnh CTO/Owner 2026-08-15 §VI (WP-12)
**Phạm vi:** `POST /api/v1/programming/retain/reset` — hiện khai báo route
(`router.go:55`, `RoleAdmin`, `idempotencyRequired`) nhưng rơi vào nhánh
mặc định, luôn trả `503` (G-9, gap report 2026-08-15 §1 mục 5).

---

## 0. Vì sao KHÔNG implement luôn — phát hiện quan trọng khi đọc source

Ban đầu WP-12 tưởng là "viết một HTTP handler mỏng gọi `ActionRetainReset`
đã có sẵn trong `coreipc` codec" (`codec.go` đã định nghĩa
`ActionRetainReset`, `isMutation()` đã liệt kê nó — trông như chỉ thiếu
phần nối dây). Đọc sâu hơn vào Core (C++) phát hiện việc này **không đơn
giản như vậy**:

1. `apps/core/application/programming/program_ipc_server.cpp` (nơi định
   nghĩa `ProgramAction::RetainReset`) **chỉ là tầng codec** (encode/decode
   tên action) — không có dispatch/xử lý thật cho bất kỳ action nào, kể cả
   `Stage`/`Activate`. Không có file nào khác trong `apps/core` tham chiếu
   `ProgramAction::Stage`/`Activate` → nhánh IPC protocol này **chưa được
   nối vào runtime thật**, bất kể `RetainReset` hay các action khác.
2. RETAIN thật sự được quản lý bởi một subsystem riêng đã hoàn thiện:
   `st_retain.hpp/.cpp` (RETAIN v2 — snapshot CRC, ghi atomic, cold-init
   chẩn đoán được), sở hữu bởi `StScheduler` (`st_scheduler.hpp` dòng
   146-155, 302-321: mỗi task có `retain_mailbox`/`retain_restore_state`/
   `retain_generation` riêng, `StRetainService` bơm vào qua
   `set_retain_service()`).
3. `StRetainStore::erase()` **đã tồn tại** ("Reset idempotent; thành công
   cả khi file chưa tồn tại") — tưởng như là primitive cần dùng. Nhưng đọc
   kỹ vòng đời: `StRetainMailbox`/`StRetainService::worker_loop()` tự động
   ghi lại snapshot mới nhất từ live memory mỗi tối thiểu 60 giây
   (`kMinWriteIntervalNs`). **Nếu chỉ xoá file trong khi Program vẫn đang
   chạy, autosave sẽ ghi đè giá trị RETAIN sống hiện tại trở lại trong
   vòng 60 giây tiếp theo** — "reset" sẽ tự đảo ngược một cách âm thầm,
   không có lỗi nào báo cho user biết việc reset "không dính".
4. Do đó "RETAIN reset" đúng nghĩa (ảnh hưởng ngay giá trị đang chạy) đòi
   hỏi một API mới ở tầng `StScheduler` (chưa tồn tại) để: (a) ghi giá trị
   khởi tạo vào bộ nhớ sống của đúng các FB instance có `retained=true`
   tại một điểm an toàn trong scan cycle (không phải xoá file), và (b)
   đồng bộ với autosave để không bị ghi đè ngược. Đây là công việc runtime
   engine thật, không phải một PATCH nhỏ ở Go.

**Kết luận của phát hiện này:** khoảng cách không chỉ là "thiếu HTTP
handler" như gap report ban đầu mô tả — còn thiếu cả **API runtime cấp
Core** để thực hiện reset một cách đúng đắn khi Program đang chạy. Đây
chính xác là loại rủi ro mà exit criteria WP-12 muốn chặn trước khi code:
nếu cứ viết một handler gọi thẳng `erase()` mà không giải quyết race với
autosave, tính năng sẽ trông như hoạt động (Check trả OK, UI báo thành
công) nhưng **không đáng tin** — một dạng "silent no-op" tệ hơn cả giữ
nguyên 503 hiện tại (503 ít nhất trung thực là "chưa làm được").

## 1. Business semantics — 2 phương án, cần Product/Controls xác nhận

| | Phương án A — "Reset khi khởi động lại" | Phương án B — "Reset ngay lập tức" |
|---|---|---|
| Hành vi | Xoá snapshot đã lưu (`StRetainStore::erase()`, **đã có sẵn**); giá trị RETAIN sống hiện tại của Program đang chạy **không đổi** cho tới lần Stage/Activate/restart kế tiếp | Ghi giá trị khởi tạo vào bộ nhớ sống của FB retained NGAY trong khi Program đang chạy, tại một scan cycle boundary an toàn |
| Cần code mới ở Core? | Không — dùng nguyên `erase()`, chỉ cần đấu Go↔C++ | **Có** — API mới ở `StScheduler`, phối hợp với autosave (xem §0.3-4) |
| Rủi ro vận hành | Thấp — không đổi hành vi runtime đang chạy | Cao hơn — thay đổi tức thời giá trị (ví dụ `TON.ET` về 0) có thể làm logic hạ lưu phản ứng bất ngờ (một delay đang đếm dở bị reset giữa chừng) |
| Khớp kỳ vọng UX "Reset" | **Lệch** — user bấm "Reset" nhưng giá trị hiển thị không đổi ngay, dễ hiểu nhầm là không hoạt động | Khớp đúng nghĩa "reset" |
| Effort | Thấp (1-2 ngày, thuần Go + đấu IPC) | Cao (cần thiết kế + review runtime engine, có thể 1-2 tuần) |

**Khuyến nghị:** Nếu mục tiêu ngắn hạn chỉ là "đóng G-9 cho baseline
compliance/documentation" mà chưa cấp thiết về mặt vận hành thật (chưa có
end-user report nào yêu cầu tính năng này hoạt động ngay), nên làm rõ với
Product: có chấp nhận Phương án A làm Rev A baseline (đổi copy UI thành
"Xoá RETAIN đã lưu — áp dụng từ lần khởi động lại kế tiếp" thay vì ngụ ý
tức thời), và để Phương án B cho backlog Runtime Engine sau, hay bắt buộc
phải B ngay từ đầu vì lý do compliance/an toàn cụ thể nào đó chưa ghi ở gap
report gốc?

## 2. Permission

Đã đúng: `router.go:55` khai `role: auth.RoleAdmin`. Không cần thay đổi —
khớp mức độ nhạy cảm của Commission (cũng `RoleAdmin`).

## 3. Audit

Phải ghi vào audit hash chain hiện có (cùng cơ chế `application/operations.go`
dùng cho Stage/Activate/Restore) — bao gồm tối thiểu: actor, thời điểm,
`projectId`/`revisionId` đang active, danh sách FB instance bị ảnh hưởng
(§5), phương án semantics đã chọn (A/B, xem §1) để có thể truy vết đúng
"reset đã xoá file" hay "reset đã đổi giá trị sống" khi điều tra sự cố sau
này.

## 4. Runtime behavior

Phụ thuộc §1. Tài liệu này **không tự chọn** — đây chính là câu hỏi cần Core
+ Controls xác nhận trước khi thiết kế chi tiết API `StScheduler`.

## 5. Safety confirmation — tái dùng hạ tầng Impact/Acknowledgement đã có

Phát hiện quan trọng: `transport/http/models.go` đã có sẵn
`ImpactKey = "retain"` (`ImpactRetain`) như một phần của `Impact` struct
dùng cho **Commission** (`AcknowledgementChecklist` ở PGM-03, UX §16.3) —
tính năng "liệt kê ảnh hưởng RETAIN + bắt xác nhận" **đã tồn tại cho luồng
Commission**, chỉ chưa có cho luồng Reset độc lập này.

**Khuyến nghị:** không phát minh UX mới — tái dùng đúng pattern:
1. BE tính "impact list": liệt kê tất cả FB instance có `retained=true`
   trong Revision đang ACTIVE (đọc từ `parameters.retained` — đúng field
   Inspector WP-07 vừa cho user gắn được qua UI), kèm `typeRef`/`instance`.
2. FE hiện danh sách này trước khi cho bấm Reset — không cho reset "mù"
   khi chưa biết ảnh hưởng gì (đúng nguyên tắc đã áp dụng cho Commission).
3. Xác nhận mạnh: yêu cầu gõ lại tên Project (giống pattern `CommissionDialog`
   đã có ở PGM-03) trước khi gửi `POST /retain/reset` — không phải một nút
   bấm đơn.
4. Nút Reset **chỉ hiện enable** khi impact list load thành công; lỗi tải
   impact thì chặn nút (đúng nguyên tắc "thiếu dữ liệu impact thì chặn
   Commission" đã áp dụng ở PGM-03, §16.3 bảng `ImpactPanel`).

## 6. Error behavior

Map `coreipc.Result` (khi đã đấu dây thật) sang HTTP:

| `coreipc.Result` | HTTP | Khi nào |
|---|---|---|
| `ResultOK` | 200 | Reset thành công |
| `ResultRejected` | 409 | Program không ở trạng thái cho phép reset (ví dụ đang STAGE dở dang) |
| `ResultBusy` | 503 + `Retry-After` | IPC queue đầy, thử lại sau |
| `ResultUnavailable` | 503 | Core không kết nối được |
| Không có Program đang active | 200 (idempotent) | Đúng tinh thần `StRetainStore::erase()`: "thành công cả khi file chưa tồn tại" — không có gì để reset không phải lỗi |

`idempotencyRequired: true` đã khai đúng ở router — khớp bản chất
idempotent tự nhiên của `erase()`.

## 7. Việc CHƯA làm (chờ §1 trả lời)

- Thiết kế API `StScheduler` cho Phương án B (nếu được chọn).
- Handler Go thật (`transport/http` + `application` + `coreipc` client
  call) — cả hai phương án đều cần phần Go này, nhưng shape khác nhau
  (A: gọi thẳng file-level erase qua Core; B: gọi API scheduler mới).
- FE: màn hình impact list + xác nhận mạnh (§5) — UI hiện tại (Overview/
  Design workspace) chưa có entry point cho RETAIN reset ở đâu cả, cũng
  cần thiết kế UX vị trí đặt nút này (PGM-01 Overview? một tab riêng?).
- Test: unit BE cho cả hai nhánh IPC result; nếu Phương án B, cần test
  Core C++ cho race với autosave.

## 8. Lịch sử sửa đổi

| Revision | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-08-15 | Tạo mới cho WP-12. Phát hiện quan trọng: IPC protocol layer (`program_ipc_server.cpp`) chưa nối runtime thật cho bất kỳ action nào; `StRetainStore::erase()` có sẵn nhưng dùng riêng lẻ sẽ bị autosave (60s) ghi đè ngược nếu Program đang chạy — nêu 2 phương án semantics, khuyến nghị tái dùng hạ tầng `ImpactRetain`/`AcknowledgementChecklist` đã có ở Commission cho UX xác nhận. Chưa implement — đúng gate tự đặt. |
