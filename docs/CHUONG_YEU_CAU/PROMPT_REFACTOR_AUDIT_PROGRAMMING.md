# PROMPT — Cập nhật và refactor bộ `docs/07_records/audit-programming` thành BỘ TÀI LIỆU THIẾT KẾ PROGRAMMING

> **Trạng thái:** REFERENCE — prompt lịch sử, không còn là chỉ thị hiện hành.
> **Lý do đóng băng:** thư mục `docs/07_records/audit-programming` đã được loại
> bỏ để tránh tạo nguồn thẩm quyền thứ hai cạnh bộ hồ sơ Programming 22 tài liệu
> do `PROG-DOCSET-001` kiểm soát. Nội dung đã xoá vẫn phục hồi được từ commit
> `3efaf0d` trong lịch sử Git. Mọi cập nhật mới phải đi qua
> `docs/02_design/PROGRAMMING_DESIGN_INDEX.md`, ma trận truy xuất và gate tài
> liệu tương ứng; không thực thi lại prompt này.

> Dán nguyên khối này cho team PM/CTO hoặc agent thực thi. Prompt tự chứa; người
> nhận không cần đọc lại lịch sử hội thoại.

---

## 1. Vai trò và bối cảnh

Bạn là **PM + CTO/Kiến trúc sư trưởng** của dự án MK-DDC-24 (BMS Edge Automation
Controller). Nhiệm vụ: **chuyển bộ `docs/07_records/audit-programming` từ một hồ
sơ audit (bản chụp trạng thái) thành BỘ TÀI LIỆU THIẾT KẾ chính thức của module
Programming**, đồng thời cập nhật toàn bộ nội dung theo hai proposal đã được
review và approve ở tầng tài liệu.

Hôm nay là 2026-08-09. Toàn bộ output viết **tiếng Việt**; chỉ giữ tiếng Anh cho
thuật ngữ kỹ thuật/tên định danh không có bản dịch tương đương (BACnet, Modbus,
ST, FBD, RETAIN, watchdog, tên biến/hàm/API/ID).

---

## 2. Nguồn đầu vào — DUY NHẤT

Chỉ hai tài liệu sau là nguồn thiết kế. Không lấy nội dung thiết kế từ bất kỳ
nguồn nào khác:

1. `docs/CHUONG_YEU_CAU/PROGRAMMING_PRODUCT_SPEC_MK-DDC-24.md` — v2.2, Proposal / In Review
2. `docs/CHUONG_YEU_CAU/PROGRAMMING_UI_UX_UC_DESIGN_MK-DDC-24.md` — v2.2, Proposal / In Review

Tài liệu tham chiếu **chỉ để đối chiếu quyền/tránh mâu thuẫn**, không phải nguồn
thiết kế mới:

- `docs/07_records/audit-programming/08_records/PHAN_BIEN_PROGRAMMING_SPEC_UX_V2_2026-08-09.md`
  — record phản biện 3 vòng, mục 10 chứa quyết định review, phạm vi merge và ba
  tồn đọng `R3-01..R3-03`.
- `docs/01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md` (`PROD-PROG-001`, Active).
- `docs/adr/ADR-005`, `ADR-020`, `ADR-021`, `ADR-023`; quyết định ADR-024 trong
  `docs/00_governance/DECISIONS.md`.

---

## 3. Mục tiêu chuyển đổi

Bộ tài liệu sau refactor phải trả lời được, chỉ bằng chính nó:

1. Programming Rev A **làm gì** và **không làm gì** (phạm vi, capability).
2. **Yêu cầu** nào ràng buộc, ai chứng minh, chứng minh bằng gì.
3. **Thiết kế** nào đã chốt, thiết kế nào còn mở, mở vì quyết định nào chưa đóng.
4. **Giao diện/hợp đồng** nào là authority.
5. **Kiểm chứng** nào phải chạy, hiện đang ở trạng thái nào.
6. **Truy nguyên** hai chiều: Product → Requirement → Design → Interface →
   Verification → Evidence.

---

## 4. Quyết định chiến lược phải nêu rõ trước khi sửa file

Thư mục đang có bản chất là **record** (`07_records/...`, `AUD-PROG-001`,
"Controlled audit baseline", chỉ tổng hợp/phân loại). Việc biến nó thành bộ tài
liệu thiết kế sống làm đổi bản chất đó. Bạn phải:

1. Ghi quyết định này thành một mục riêng trong `README.md` và
   `00_document_control/00_DOCUMENT_CONTROL.md`: bộ hồ sơ đổi từ *audit record*
   sang *controlled design documentation set*, kèm ngày, chủ quản, và lý do.
2. Chốt và ghi rõ quan hệ với `PROD-PROG-001` (Active tại `docs/01_product/`):
   nó vẫn là Product authority, hay bị bộ này thay thế? **Không được để mập mờ
   hai Product Spec cùng hiệu lực.** Nếu chọn thay thế thì phải có mục
   `Supersedes` ở cả hai phía.
3. Nếu vị trí `07_records/` không còn đúng bản chất, đề xuất đường dẫn đích
   (ví dụ `docs/02_design/programming/`) **kèm kế hoạch di chuyển và cập nhật
   mọi liên kết**, nhưng chỉ thực hiện sau khi PM/CTO đồng ý trong cùng phiên.
   Nếu chưa chốt được, giữ nguyên đường dẫn và ghi lý do.

---

## 5. Ràng buộc quản trị — KHÔNG ĐƯỢC VƯỢT

Đây là điều kiện, không phải gợi ý:

1. **`CONFREG-PROG-001` §3 vẫn hiệu lực:** không được phê duyệt Programming
   Design, khóa API/schema, chốt capacity/WCET, hoặc chuyển gate production sang
   GREEN khi các `OD-PROG-*` tương ứng chưa đóng.
2. **`OD-PROG-001..015` giữ trạng thái `OPEN`/`PARTIAL`.** Được phép ghi
   **"proposed answer"** kèm trỏ tới mục nguồn trong proposal, nhưng **không
   được** đổi sang `CLOSED`. Một Open Decision chỉ đóng bằng ADR hoặc biên bản
   phê duyệt có ngày, owner, tài liệu bị thay và requirement/verification cần
   cập nhật.
3. **`VR-PROG-001..013` giữ `RED`.** Bằng chứng production vẫn `0/13`. Tài liệu
   có trace không làm đổi trạng thái evidence.
4. **`G0..G7` giữ `RED/NOT STARTED`.**
5. **Khối sign-off còn `PENDING`** ở cả hai proposal (Product Owner, UX Lead,
   Controls/Safety Reviewer, Frontend Lead, Verification Lead). Không được đánh
   dấu bất kỳ tài liệu nào `Approved`/`Baseline` khi còn ô `PENDING`.
6. **`09_archive/raw-source-snapshots/` bất biến.** Không sửa, không xóa, không
   sắp xếp lại. 34 file trong đó là dấu vết audit.
7. **Không tự chọn cách hiểu cho một mâu thuẫn đang mở.** Ghi vào Conflict
   Register và trỏ về Open Decision.

---

## 6. Cấu trúc đích và việc phải làm theo từng thư mục

Giữ nguyên cây `00..09`. Nội dung từng thư mục sau refactor:

### `00_document_control/`

| File | Việc phải làm |
|---|---|
| `00_DOCUMENT_CONTROL.md` | Ghi đổi bản chất bộ hồ sơ (mục 4.1); cập nhật quy tắc phiên bản/quyền/chu kỳ review cho một bộ tài liệu thiết kế sống. |
| `01_DOCUMENT_REGISTER.md` | Đăng ký hai proposal v2.2 là **amendment input** (`IN REVIEW`); đăng ký mọi file mới sinh ra trong lần refactor này; ghi chủ quản từng file. |
| `02_TERMS_AND_DATA_DICTIONARY.md` | Hợp nhất **Thuật ngữ chuẩn** (Product §Thuật ngữ) và **Thuật ngữ UX** (UX §Thuật ngữ). Bắt buộc có: `program_value`, `actual_value`, `overridden_by`, `effective_priority`, `base control step`, `Task period`, `cutover`, `GRAPH_ONLY/PROGRAM_ONLY/DUAL_INVALID`, `hold-last`, `Đưa vào vận hành` (phân biệt với module `Chạy thử`), `core RUNNING/DEGRADED/UNREACHABLE`. Mỗi thuật ngữ một nghĩa duy nhất trong toàn bộ. |
| `03_CONFLICT_REGISTER.md` | Cập nhật `CONF-PROG-002` (FBD ↔ graph, nay có cutover model), `CONF-PROG-003` (cycle 1/5/30 là biên Product), `CONF-PROG-010` (capacity 8/16/32 là OUT Rev A). **Thêm `CONF-PROG-015`:** mâu thuẫn giữa công thức watchdog "Task lớn nhất" trong `PROGRAM_TASK_SCHEDULER_SPEC_MK-DDC-24_VI.md` và base-step model của Product §14.6 — trạng thái `OPEN-DESIGN`, chặn bởi `OD-PROG-012/013/014`. |
| `04_OPEN_DECISION_REGISTER.md` | Thêm cột **"Proposed answer (v2.2)"** cho `OD-PROG-002/003/004/006/009/012/013/014`, mỗi ô trỏ đúng mục nguồn. Cột trạng thái **giữ nguyên**. |

### `01_product/`

- `00_PROGRAMMING_PRODUCT_SPEC.md`: hợp nhất nội dung Product v2.2 vào bản
  controlled copy, giữ `PC-PROG-001..012` và `PR-PROG-001..014` làm authority.
  Mọi câu bị proposal thu hẹp/mở rộng phải ghi rõ đã đổi gì so với bản
  2026-08-03.
- `01_FEATURE_CATALOG.md` + `features/FSP-PROG-001..009`: cập nhật theo phạm vi
  Rev A mới. Cụ thể phải phản ánh: FBD Rev A là **structured editor**, không phải
  free-form wiresheet; BACS Control Library nâng cao **OUT**; trusted-origin
  signature **OUT**, integrity hash **IN**; RETAIN **IN**; multi-task **OUT**
  ngoài một Task; export/import bundle **IN** (source-only).
- Nếu phạm vi mới sinh ra feature chưa có FSP (bundle replacement, cutover,
  arbitration transparency), tạo `FSP-PROG-010..` theo đúng khuôn mẫu file cũ.

### `02_requirements/`

- `00_PROGRAMMING_REQUIREMENTS_BASELINE.md`: giữ `SYS/SWR/IF/NFR-REQ-PROG-*` làm
  authority.
- Thêm file `01_PROPOSED_REQUIREMENTS_V22.md`: 41 `PRG-*` và 24 `UX-REQ-*` với
  trạng thái `PROPOSED`, dùng nguyên crosswalk từng ID của Product §25.8 và UX
  §44. **Không đổi cột evidence của baseline.**
- Nếu một `PRG-*`/`UX-REQ-*` làm mạnh hơn hoặc mâu thuẫn với một
  `SWR/SYS-REQ-PROG-*`, ghi vào Conflict Register, không sửa lén baseline.

### `03_architecture/`

- `00_PROGRAMMING_SYSTEM_CONTEXT.md`: sửa lại phần AS-BUILT cho đúng thực tế
  (graph runtime đang là đường production; `st_sched = nullptr`).
- Thêm `01_PROGRAMMING_RUNTIME_ARCHITECTURE.md` với **ba quyết định kiến trúc
  mới, ghi ở mức normative**:
  1. **Base control step tách khỏi Task period.** Task period `1/5/30 s` không
     được dùng làm thời gian chờ của một `ScanLoop::step()`. Kèm công thức
     `WatchdogSec >= 2 × max_base_step_period + WCET_step_target + 1 s` và ràng
     buộc với `WatchdogSec=6` hiện hành.
  2. **Cutover ba trạng thái fail-closed:** `GRAPH_ONLY | PROGRAM_ONLY |
     DUAL_INVALID`; dual request bị từ chối, giữ LKG, không trộn output mức 5.
  3. **Resource isolation:** compiler/Check chạy ngoài RT path, có profile cách
     ly CPU/cgroup/priority so với `mkddc-core`/`mkddc-iobus`; ghi rõ cấu hình
     lab hiện tại không phải bằng chứng production.

### `04_design/`

- `00_PROGRAMMING_DESIGN_STATUS_AND_CONSTRAINTS.md`: cập nhật thành **design
  input/constraint** đã chốt ở mức proposal. Trạng thái tổng thể vẫn là
  "Design chưa được phê duyệt".
- `01_COMPONENT_SPEC_ASSESSMENT.md`: đối chiếu lại supporting component với phạm
  vi mới (limit ST, ceiling FBD, một Task, RETAIN).
- Thêm `02_CONTROL_SEMANTICS.md` — **mục quan trọng nhất của lần refactor này**.
  Phải chứa nguyên nghĩa, không được rút gọn làm mất ràng buộc:
  1. Priority resolver 6 mức, Program = `Local logic` mức 5.
  2. Phân biệt `program_value` (đóng góp mức 5) và `actual_value` (sau resolver);
     bỏ `written_value` mơ hồ.
  3. **Anti-windup hai chế độ:** thắng-nhưng-bị-clamp ⇒ back-calculation trên
     cùng đường lệnh; thua arbitration ⇒ freeze/hold integrator, **cấm** seed
     hoặc track từ `actual_value` của nguồn đang thắng.
  4. **Hold-last trên đóng góp mức 5:** chụp `previous_program_value` trước
     activation; giá trị mức 5 đầu tiên của Revision mới phải bằng giá trị đó
     trong độ phân giải binding; ví dụ chuẩn manual giữ 62% / program 41% phải
     giữ nguyên trong tài liệu.
  5. **`IOP_SAFE_TIMEOUT_MS = 200 ms`:** activation/restore không được dừng hay
     restart `mkddc-iobus`; `max_iop_poll_gap < 200 ms`, mục tiêu `<=100 ms`.
  6. **Overrun là fault mức Task**, không tự suy diễn thành plant safe-state;
     safe-state toàn hệ chỉ do `SafetyManager` với điều kiện độc lập đã duyệt.
  7. Ma trận `IEC type × Point kind × direction` (LOCAL/UI, AO, DO; VP/AV, BV,
     MSV; MB-RTU/EXT) kèm ceiling.
  8. Allowlist Point ba loại; Modbus TCP và BACnet/IP bị từ chối.
  9. Bundle **source-only**, build lại trên controller đích; cấm mang artifact/
     Typed IR/native binary/cache build.

### `05_interfaces/`

- `00_PROGRAMMING_INTERFACE_BASELINE.md`: bổ sung nghĩa dữ liệu bắt buộc mới —
  `program_value/actual_value/overridden_by/effective_priority`, TTL override,
  `base_revision`/ETag cho optimistic concurrency, cutover state, structured
  Revision change manifest, bundle export/import.
- Thêm `01_ERROR_CODE_CATALOG.md`: `IFSPEC-PROG-001` **sở hữu** namespace
  `PRG-ERR-*`. Mỗi mã: nghĩa ổn định, lớp lỗi, requirement liên quan, test liên
  quan. Product/UX chỉ được tham chiếu, không được tự định nghĩa mã.
- **Xử lý `R3-01`:** mã cũ `PRG-MAP-003/004` còn sót ở Product §12.4 (7 dòng ma
  trận) và UX §11.6 phải chuyển sang `PRG-ERR-MAP-*`, hoặc bỏ mã khỏi ma trận
  chỉ giữ lớp lỗi. Sửa ở cả hai proposal lẫn bộ tài liệu đích.

### `06_verification/`

- `00_PROGRAMMING_VERIFICATION_SPEC.md`: giữ `VR-PROG-001..013` và trạng thái
  `RED`.
- Thêm `01_VERIFICATION_SCENARIOS.md`: nhận `VS-PROG-001..030` làm **catalog
  scenario duy nhất**; map mỗi `VS-PROG-*` tới `VR-PROG-*`, tới `PRG-*`/
  `UX-REQ-*` và tới UC. Cấm duy trì danh sách E2E song song ở nơi khác.
- Đánh dấu rõ scenario nào bắt buộc chạy trên board/HIL: arbitration, bumpless,
  IOP poll gap, watchdog/base step, cutover, concurrent Check tải xấu nhất.

### `07_traceability/`

- `00_PROGRAMMING_TRACEABILITY_MATRIX.md` (`TRACE-PROG-001`): thêm cột proposal
  và cột `VS-PROG-*`. Chuỗi phải khép kín hai chiều:
  `PC-PROG → PR-PROG → SYS/SWR/IF/NFR-REQ-PROG → PRG-*/UX-REQ-* → VS-PROG-* →
  VR-PROG-* → Evidence`.
- Cột evidence giữ `MISSING/RED`.

### `08_records/`

- Giữ nguyên 5 record hiện có.
- Thêm `REFACTOR_TO_DESIGN_SET_2026-08-09.md`: ghi việc đã làm, quyết định đổi
  bản chất bộ hồ sơ, danh sách file thêm/sửa, và những gì **cố tình không làm**
  kèm lý do.

### `09_archive/`

- Không đụng tới.

### `README.md`

- Viết lại: mục đích mới, cách đọc theo vai trò (PM / Kiến trúc / FE / BE /
  FW-SOM / QA), bản đồ thư mục, bảng "câu hỏi thường gặp → đọc file nào", và
  trạng thái thật (`0/13 VR`, `G0..G7 RED`, `OD` còn mở).

---

## 7. Quy tắc ID và namespace

1. **Không phát minh namespace mới** ngoài các namespace đã có:
   `PC-PROG`, `PR-PROG`, `FSP-PROG`, `SYS/SWR/IF/NFR-REQ-PROG`, `VR-PROG`,
   `VS-PROG`, `OD-PROG`, `CONF-PROG`, `TRACE-PROG`, `PRG-*` (requirement đề
   xuất), `UX-REQ-*`, `UC-*`, `PGM-*`, `PRG-ERR-*` (error code, thuộc IFSPEC).
2. **Một chuỗi ID chỉ mang một nghĩa** trong toàn bộ. Requirement và error code
   không được trùng chuỗi.
3. ID đã phát hành **không được tái sử dụng cho nghĩa khác**; muốn bỏ thì đánh
   dấu `DEPRECATED` kèm lý do.
4. Mọi ID mới phải xuất hiện trong ma trận traceability ngay trong cùng phiên.

---

## 8. Chất lượng viết — bắt buộc

1. Mỗi requirement là **một câu kiểm chứng được**, có chủ thể và tiêu chí đạt.
   Cấm mục requirement chỉ là danh sách danh từ kết thúc bằng dấu `;`.
2. Mỗi bảng requirement có cột **phương pháp kiểm chứng** hoặc trỏ tới
   `VS-PROG-*`.
3. Mỗi tài liệu có: mục lục, mục thuật ngữ (hoặc trỏ tới data dictionary), lịch
   sử sửa đổi, và khối phê duyệt/sign-off.
4. **Mỗi chủ đề chỉ có một chủ quản.** Nội dung ở nơi khác chỉ được trỏ sang,
   không chép lại. Đây là lỗi lớn nhất của hai proposal — không được mang vào bộ
   thiết kế.
5. Không claim chứng nhận. Chỉ được viết "aligned with"/"informed by". Số hiệu
   edition/năm của IEC/ISO là `UNVERIFIED` cho tới khi có evidence record ghi
   nguồn catalogue, ngày truy xuất và người xác nhận.
6. Không dùng số liệu As-Built không đo được. Số nào là đề xuất phải ghi rõ là
   giá trị acceptance đề xuất, chưa phải PASS.

---

## 9. Ba tồn đọng phải đóng trong lần refactor này

| ID | Việc |
|---|---|
| `R3-01` | Mã cũ `PRG-MAP-003/004` ở Product §12.4 và UX §11.6 trái với §26.1 (namespace đã trao cho IFSPEC). Chuyển sang `PRG-ERR-MAP-*` hoặc bỏ mã, sửa cả proposal lẫn bộ đích. |
| `R3-02` | Bảng xử lý phản biện Product §33 chỉ liệt kê 9/14 mã `R2-*`; bổ sung `R2-02/03/04/05/07` cho khớp inventory. |
| `R3-03` | Ghi `CONF-PROG-015` cho mâu thuẫn công thức watchdog vs `PROGRAM_TASK_SCHEDULER_SPEC`, trạng thái `OPEN-DESIGN`, chặn bởi `OD-PROG-012/013/014`. |

---

## 10. Cấm

1. Cấm đóng `OD-PROG-*`, đổi `VR-PROG-*` khỏi `RED`, đổi `G0..G7` khỏi `RED`.
2. Cấm đánh dấu bất kỳ tài liệu nào `Approved`/`Baseline` khi sign-off còn `PENDING`.
3. Cấm khóa URL/JSON schema/DB schema — interface chỉ khóa nghĩa dữ liệu và authority.
4. Cấm sửa `09_archive/`.
5. Cấm lấy nội dung thiết kế từ nguồn ngoài hai proposal.
6. Cấm để tồn tại hai Product Spec cùng hiệu lực mà không tuyên bố quan hệ.
7. Cấm sửa code, config runtime, systemd unit trong nhiệm vụ này. Nếu phát hiện
   source mâu thuẫn tài liệu, ghi thành finding trong `08_records/`, không sửa code.

---

## 11. Định nghĩa hoàn thành

Chỉ báo xong khi **tất cả** đạt:

1. Mọi file trong `00..08` đã được đọc lại và cập nhật hoặc xác nhận không cần đổi
   (ghi rõ file nào không đổi và vì sao).
2. Trace khép kín hai chiều; không có ID mồ côi ở bất kỳ đầu nào.
3. Không có chuỗi ID mang hai nghĩa.
4. Không còn mâu thuẫn nội bộ giữa các file trong bộ; mâu thuẫn với nguồn ngoài
   đã vào Conflict Register.
5. `R3-01..R3-03` đã đóng.
6. Trạng thái quản trị vẫn đúng: `OD` mở, `VR` RED, gate RED, sign-off PENDING.
7. `CHANGELOG.md` đã cập nhật dưới `[Unreleased]` trong cùng phiên, ghi phạm vi,
   file thêm/sửa và ghi chú kiểm chứng.
8. Chạy và ghi kết quả các kiểm tra tĩnh:
   - đếm ID duy nhất từng namespace;
   - đối chiếu hai chiều requirement ↔ trace ↔ verification (không thiếu, không thừa);
   - kiểm trùng chuỗi ID giữa requirement và error code;
   - kiểm liên kết nội bộ không gãy;
   - `git diff --check` sạch.

---

## 12. Bàn giao

1. Danh sách file **thêm / sửa / giữ nguyên**, mỗi file một dòng lý do.
2. Bảng số đo của mục 11.8, số thật, không dẫn lại số cũ.
3. Danh sách quyết định đã ghi là **proposed** kèm Open Decision đang chặn.
4. Danh sách việc **cố tình không làm** kèm lý do và điều kiện mở khóa.
5. Commit tách theo nhóm logic (document control / product / requirements /
   architecture / design / interfaces / verification / traceability / records),
   tiêu đề Conventional Commits, thân bài tiếng Việt nêu triệu chứng → nguyên
   nhân → cách sửa, có `Refs:`.

---

**HẾT PROMPT**
