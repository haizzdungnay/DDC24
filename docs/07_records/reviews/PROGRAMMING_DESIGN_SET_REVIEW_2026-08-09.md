# Review record — bộ hồ sơ thiết kế Programming MK-DDC-24 (22 hồ sơ)

| Thuộc tính | Giá trị |
|---|---|
| ID | `PROG-REV-2026-08-09` |
| Loại | Review record + finding register; **không phải** Design authority |
| Ngày | 2026-08-09 |
| Phạm vi | 22 hồ sơ baseline trong [`PROG-DOCSET-001`](../../02_design/PROGRAMMING_DESIGN_INDEX.md) §3 |
| Thực hiện | System Engineering (document engineering pass) |
| Trạng thái | Finding P0/P1 trong phạm vi tài liệu đã đóng; **consumer review của người thật chưa thực hiện** |
| Tracker liên quan | [`PLAN-PROG-DOC-054`](../../03_implementation/54_PROGRAMMING_DOCUMENTATION_ROADMAP.md) |

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để làm gì? | Ghi lại lần rà soát 22 hồ sơ Programming ngày 2026-08-09: đã kiểm cái gì, tìm ra lỗi gì, sửa những gì, và **cái gì vẫn chưa ai kiểm**. |
| 2. Ai phải đọc? | Reviewer của từng consumer (FE/BE/Core/FW/HW/QA/Ops/Security/UX) trước khi ngồi review; Document Control khi cập nhật Plan 54. |
| 3. Hiện trạng trước review? | 22/22 hồ sơ ở `M2 — Detailed Draft`, đã tự kiểm nội dung nhưng chưa có bảng checklist từng mã, chưa có phần tóm tắt cho người ngoài, và hồ sơ UI/UX thiếu 8 nội dung bắt buộc. |
| 4. Review này thay đổi gì? | Đóng 12 finding tài liệu (5 P0, 6 P1, 1 P2) và đưa 22/22 hồ sơ đạt cổng `M3 — Review Ready`. |
| 5. Ai phải sửa gì tiếp? | Không còn finding tài liệu mở. Việc còn lại thuộc về **người**: consumer review và chữ ký — xem §5. |
| 6. Điều gì còn bị chặn? | M4 (review liên chức năng đóng) và M5 (phê duyệt). Cả hai đòi người thật; agent không được ký thay. Xem §5 và §6. |
| 7. Bằng chứng nào? | §2 harness đo được, chạy lại bằng lệnh ghi ở §2.1. Không có bằng chứng build/browser/target/HIL nào trong lần này vì **chỉ sửa tài liệu**. |

## 1. Phương pháp

Ba lớp kiểm, áp cho toàn bộ 22 hồ sơ:

1. **Checklist theo loại tài liệu.** Hồ sơ Detailed Design kiểm `DD-01..DD-13`
   theo [Plan 54 §7](../../03_implementation/54_PROGRAMMING_DOCUMENTATION_ROADMAP.md);
   hồ sơ Requirements/Open Decisions/Architecture/V&V/Operations/Risk/
   Traceability/Implementation Plan kiểm bộ cổng riêng của loại đó. Kết quả từng
   mã được ghi thành phụ lục **trong chính hồ sơ**, không tập trung ở đây.
2. **Kiểm khả đọc.** Một người không tham gia thiết kế phải trả lời được bảy câu
   hỏi ở mục “Đọc nhanh” chỉ bằng đầu file.
3. **Kiểm máy.** Harness đếm file/link/anchor/ID trùng/whitespace/code fence và
   các bất biến của ma trận trace.

Nguyên tắc áp dụng: một mã chỉ được `PASS` khi nội dung đủ để implement và test.
Có heading mà rỗng nội dung thì ghi `BLOCKED` kèm owner, ảnh hưởng, gate và điều
kiện mở khóa — không ghi `PASS`.

## 2. Kết quả kiểm máy

| Phép đo | Trước | Sau | Ngưỡng yêu cầu |
|---|---:|---:|---|
| File baseline tồn tại | 22/22 | 22/22 | 22/22 |
| Markdown local link missing | 0 | 0 | 0 |
| Anchor missing | 0 | 0 | 0 |
| Trailing whitespace | 0 | 0 | 0 |
| Code fence lệch | 0 | 0 | 0 |
| Duplicate document ID | 0 | 0 | 0 |
| Requirement canonical trong SRS | 55 | 55 | 55 |
| Dòng trace có `D/I/T/P/R` | 55 | 55 | 55 |
| Vi phạm `P=Y khi T=N` hoặc `R=Y khi P=N` | 0 | 0 | 0 |
| `VS-PROG-*` trong V&V | 30 | 30 | 30 |
| `RSK-PROG-*` trong Risk Register | 15 | 15 | 15 |
| `OD-PROG-*` trong Open Decisions | 15 | 15 | 15 |
| `UC-PROG-*` có ID ổn định trong UI/UX | **0** | 17 | 17 |
| Hồ sơ có mục “Đọc nhanh” | 0 | 22 | 22 |
| Hồ sơ có bảng tự kiểm theo loại | 0 | 22 | 22 |
| Hồ sơ Detailed Design có đủ 13 dòng `DD-01..DD-13` | 0 | 13 | 13 |
| `UX-REQ-*` trong UI/UX | 24 | 24 | 24 |

### 2.1 Cách chạy lại

Harness nằm ngoài repository (thư mục làm việc tạm của phiên). Nội dung kiểm
được mô tả đủ để dựng lại: duyệt 22 đường dẫn baseline cộng Plan 54; với mỗi
file, phân giải mọi liên kết Markdown không phải `http/https/mailto` theo đường dẫn
tương đối và kiểm cả anchor theo slug tiêu đề; đếm ID theo biểu thức chính quy
của từng họ ID; kiểm bảng trace bằng mẫu `| \`ID\` | ... | D/I/T/P/R |`.

Đây là kiểm **tài liệu**. Không có lệnh build, test C++/Go/FE, trình duyệt,
target hay HIL nào được chạy trong lần này, vì thay đổi chỉ chạm tới Markdown.

## 3. Finding register

Severity: `P0` chặn contract/an toàn/nhiều team; `P1` chặn một team implement
hoặc test đúng; `P2` hoàn thiện assurance.

| ID | Sev | Hồ sơ / mục | Mã kiểm | Finding | Acceptance để đóng | Trạng thái |
|---|---|---|---|---|---|---|
| `F-PROG-001` | P0 | 22/22 hồ sơ, đầu file | Khả đọc | Không hồ sơ nào có phần tóm tắt cho người ngoài. Người không tham gia thiết kế phải đọc hết 200–500 dòng mới biết file dùng để làm gì và cái gì đang bị chặn. | Mỗi hồ sơ có mục “Đọc nhanh” trả lời đủ bảy câu hỏi, đặt ngay sau bảng metadata | **CLOSED** — 22/22 |
| `F-PROG-002` | P0 | 13 hồ sơ Detailed Design, mục cuối | `DD-01..13` | Chỉ có một dòng văn xuôi “`DD-01..DD-13`: SELF-CHECK COMPLETE”. Không thể kiểm chứng mã nào PASS, mã nào bị chặn, và bị chặn bởi ai. Vi phạm nguyên tắc “không ghi PASS chỉ vì có heading”. | Bảng 13 dòng, mỗi dòng có verdict `PASS/N-A/BLOCKED`, dẫn mục cụ thể trong file; `BLOCKED` có owner, ảnh hưởng, gate, điều kiện mở | **CLOSED** — 13/13 |
| `F-PROG-003` | P0 | 9 hồ sơ không phải Detailed Design | Plan 54 §7 | Requirements, Open Decisions, Architecture, V&V, Operations, Risk, Traceability, Implementation Plan và Index không có bảng cổng M3 theo loại của mình. | Mỗi hồ sơ có phụ lục tự kiểm dùng đúng bộ cổng của loại tài liệu đó | **CLOSED** — 9/9 |
| `F-PROG-004` | P0 | UI/UX §17 | `DD-02`, V.4 | 17 use case dùng số thứ tự trần (`01`..`17`), không có ID ổn định để trace. Thiếu hẳn cột **audit** và cột **acceptance** tách khỏi verification. Luồng chính bị nén thành một ô, không đọc được thành từng bước. | 17 UC có ID `UC-PROG-01..17` và đủ 9 trục: actor, trigger, precondition, primary flow theo bước, alternate/error, postcondition, data/API, audit, acceptance | **CLOSED** |
| `F-PROG-005` | P0 | UI/UX §16 | `DD-08`, V.2/V.3 | Có sáu wireframe nhưng **không có component tree**, và không component nào được đặc tả purpose/props/state/action/permission/error. FE không thể dựng cây component từ hồ sơ. | Mỗi trang PGM-01..06 có component tree; mỗi component có đủ sáu thuộc tính | **CLOSED** — 6 trang, 35 node trong cây, 40 component có đặc tả |
| `F-PROG-006` | P1 | UI/UX §14 | `DD-06`, V.6 | Cột “API authority” chỉ ghi tên nhóm (“capabilities/projects/runtime”). Không có method, path, error code hay capability cụ thể; FE phải tự đoán hoặc mở Interface Spec dò tay. | Bảng exact `METHOD /path` cho từng surface, kèm error code và capability, link đúng mục trong Interface Spec | **CLOSED** |
| `F-PROG-007` | P1 | UI/UX §18 | `DD-07`, V.7 | State machine chỉ mô hình hóa Draft/Check/Commission/Unknown. **Restore** và **Reconcile** được nhắc trong văn xuôi nhưng không phải state có guard/transition, nên hành vi khi Restore timeout không xác định. | State machine phủ đủ Draft/Check/Commission/Restore/Unknown/Reconcile với guard, action, postcondition | **CLOSED** |
| `F-PROG-008` | P1 | UI/UX §8, §20 | `DD-08`, V.8 | Chỉ liệt kê **nhóm** i18n key (`programming.nav.*`…). Không có bảng copy VI/EN thật, nên hai người implement sẽ viết hai câu khác nhau cho cùng một trạng thái. | Bảng copy VI/EN đủ nav, state, core, action, empty, error, permission, offline/stale | **CLOSED** — 36 key |
| `F-PROG-009` | P1 | UI/UX §20 | `DD-08`, V.9 | “dùng token AppShell hiện hành” không phải đặc tả: không có tên token, giá trị breakpoint, biến thể component hay định nghĩa focus state. | Bảng token/grid/spacing/breakpoint/variant/focus có giá trị cụ thể và trỏ đúng nguồn token trong repo | **CLOSED** |
| `F-PROG-010` | P1 | UI/UX | `DD-12`, V.11 | Không có mục nào về feature-flag rollout, migration bookmark/route cũ, hành vi khi FE và BE lệch phiên bản, và cách rollback riêng FE. | Mục rollout/migration/rollback phủ đủ bốn nội dung, có trigger và thứ tự | **CLOSED** |
| `F-PROG-011` | P1 | UI/UX §22 | `DD-13`, V.12 | Bảng ký gộp 3 dòng; không tách được UX, FE, BE, Product, QA và Accessibility nên không biết ai chịu trách nhiệm phần nào. | Bảng sign-off sáu vai trò riêng, mỗi vai trò có phạm vi ký cụ thể | **CLOSED** |
| `F-PROG-012` | P2 | Plan 54 §2 vs §3.1 | Nhất quán | Dashboard §2 định nghĩa M3 là “peer review xác nhận review-ready”, trong khi §3.1 — bảng định nghĩa thang — định nghĩa M3 là “đủ checklist, TBD có owner, link sạch”. Hai định nghĩa khác nhau cho cùng một mức làm việc chấm mức không lặp lại được. | Một định nghĩa duy nhất cho M3; §2 sửa theo §3.1, và mức yêu cầu review liên chức năng được gọi đúng tên là M4 | **CLOSED** |

Tổng: 12 finding — 5 P0, 6 P1, 1 P2. Không finding nào bị xóa để làm đẹp tỷ lệ;
`F-PROG-012` là mâu thuẫn nội tại được phát hiện trong lúc rà và đã sửa tại đúng
file chủ quản thay vì ghi chú ở hai nơi.

## 4. Kết quả checklist theo hồ sơ

Chi tiết từng mã nằm trong phụ lục của chính hồ sơ. Tổng hợp:

| Nhóm | Hồ sơ | Cổng áp dụng | Kết quả |
|---|---:|---|---|
| Kiểm soát/yêu cầu/quyết định/kiến trúc | 4 | theo loại | 4/4 đạt cổng M3; 2 mục `BLOCKED` có owner đầy đủ (`PROG-OD-001` chưa có quyết định; `ARCH-PROG-001` §11 còn xung đột chờ ADR) |
| Contract và thiết kế lõi | 7 | `DD-01..13` | 7/7 đạt; `BLOCKED` còn lại thuộc về TLS/HSM sign-off và `OD-PROG-002` |
| Thiết kế theo team | 6 | `DD-01..13` | 6/6 đạt; `BLOCKED` là bằng chứng browser (FE/UX), target (FW-SOM) và điện/HIL (MCU/HW) |
| Assurance và triển khai | 5 | theo loại | 5/5 đạt; `BLOCKED` là 0/32 Test Result và chữ ký gate |

Mọi mục `BLOCKED` đều ghi bốn trường bắt buộc. Không có `TBD` vô chủ trong 22 hồ sơ.

## 5. Việc bắt buộc phải do người thật làm

Đây là ranh giới của lần rà này. Bốn việc dưới đây **không** được coi là đã làm:

| Việc còn lại | Ai phải làm | Vì sao agent không làm thay được | Điều kiện mở khóa |
|---|---|---|---|
| Consumer review từng hồ sơ | Reviewer của FE, BE, Core, FW MCU, HW, QA, Ops, Security, UX theo RACI Plan 54 §9 | Review là ý kiến độc lập của bên **tiêu thụ** contract; tự kiểm của người soạn không thay thế được, dù checklist có đầy đủ | Mỗi hồ sơ có ít nhất một reviewer ghi `ACCEPT`/`REQUEST CHANGE` kèm revision cụ thể → cho phép chấm M4 |
| Ký 15 `OD-PROG-*` | Product Owner/CTO và discipline authority | Quyết định sản phẩm thuộc thẩm quyền con người; không suy ra được từ tài liệu | Decision record đủ trường theo `PROG-OD-001` |
| Ký 22 hồ sơ | Product Owner, System Architect, Verification Lead, discipline authority | Phê duyệt là hành vi pháp lý/tổ chức | 17 decision đóng + M4 đạt → cho phép chấm M5 |
| Bằng chứng thực thi | QA + discipline lead | Cần chạy trên target/board/HIL thật với thiết bị đo | 30 `VS-PROG-*` có Test Result được review |

Hệ quả: **M4 = 0/22 và M5 = 0/22**, `DOC-G4` giữ `RED`. Đây là kết quả đúng, không
phải thiếu sót của lần rà.

## 6. Kết luận

- 22/22 hồ sơ đạt cổng `M3 — Review Ready` theo định nghĩa Plan 54 §3.1: checklist
  áp dụng đã đủ, mọi `TBD/BLOCKED` có owner/ảnh hưởng/gate/điều kiện mở, link nội
  bộ sạch.
- 12/12 finding tài liệu đã đóng; 0 finding P0/P1 còn mở.
- Không hồ sơ nào chứng minh implementation. `VR-PROG-*` và release gate vẫn `RED`.
- Không có tuyên bố chứng nhận IEC/ISO nào được tạo ra; bộ hồ sơ chỉ ở mức
  **ISO-aligned** về cấu trúc và bằng chứng.

## 6.1 Bổ sung sau vòng đơn giản hóa (cùng ngày)

Sau khi record này được lập, Amendment A1 được thực hiện trong cùng ngày (rút
sáu trang xuống bốn workspace, xem
[Plan 54 §10.1](../../03_implementation/54_PROGRAMMING_DOCUMENTATION_ROADMAP.md)).
Các số ở §2 vì vậy đã thay đổi. Đo lại sau Amendment A1:

| Phép đo | §2 ghi | Sau Amendment A1 |
|---|---:|---:|
| Requirement canonical trong SRS | 55 | **60** |
| Dòng trace `D/I/T/P/R` | 55 | **60** |
| `VS-PROG-*` trong V&V | 30 | **32** |
| `RSK-PROG-*` | 15 | **16** |
| `OD-PROG-*` | 15 | **17** |
| `UJ-PROG-*` (mới) | — | **8**, nhất quán ở Product Spec, UI/UX và Trace |
| SVG asset | 3 | **6** |

Các phép đo còn lại giữ nguyên `0`: link missing, anchor missing, trailing
whitespace, code fence lệch, duplicate document ID, và vi phạm `P=Y khi T=N`
hoặc `R=Y khi P=N`. Kết luận ở §6 **không đổi**: 22/22 vẫn ở `M3`, và M4/M5 vẫn
`0/22` vì vẫn chưa có consumer review và chữ ký. Amendment A1 thêm một điều kiện
mở khóa nữa cho M4: `OD-PROG-016` phải được ký.

## 6.2 Vòng review chặn phê duyệt và kết quả xử lý

Sau Amendment A1, một vòng review độc lập tìm thêm 5 finding, trong đó **2 `P0`
chặn phê duyệt**. Tất cả đã đóng cùng ngày.

| ID | Sev | Finding | Cách xử lý | Trạng thái |
|---|---|---|---|---|
| `F-PROG-013` | **P0** | Hợp đồng xác nhận Commission mâu thuẫn ba nơi: UI/UX §5 nói số ô có thể bằng `0`, nhưng UC-PROG-08 vẫn bắt “tích đủ bốn xác nhận”, còn `IFSPEC` §6 đặt cứng bốn phần tử trong request. FE, BE và QA có thể triển khai ba hành vi khác nhau cho một thao tác đổi control runtime | Chốt **một** quy tắc `acknowledgements = { khóa | status == PRESENT }` tại `IFSPEC` §6.1.1; ví dụ request đổi thành 2 phần tử và nêu rõ mảng rỗng là hợp lệ; thêm `impactRef` chống xác nhận trên impact cũ; thêm 4 mã lỗi `PRG-ERR-ACK-MISSING-001`, `PRG-ERR-ACK-UNEXPECTED-001`, `PRG-ERR-IMPACT-UNAVAILABLE-001`, `PRG-ERR-IMPACT-STALE-001` vào §9; sửa UC-PROG-08 (luồng, nhánh lỗi, acceptance); mở rộng `VS-011`, `VS-019`, `VS-031` để kiểm đúng hợp đồng này | **CLOSED** |
| `F-PROG-014` | **P0** | Bằng chứng M3 không còn hợp lệ: SRS tự kiểm còn ghi `55/55` và `0/30`; Trace metadata ghi 55; Roadmap master tracker và R3/R4 còn `15/15/30/55` cùng `PGM-01..06`; Document Hub còn 15 risk và 15 decision. Một self-check chứa số sai không dùng làm bằng chứng M3 được | Sửa toàn bộ về số hiện hành **60 requirement / 60 dòng trace / 32 scenario / 16 risk / 17 decision / 8 journey** ở SRS, Trace, Roadmap, Document Hub, Design Index, VVP, Risk Register, Plan 53 và Interface Spec. Giữ nguyên số trong dòng lịch sử và snapshot cũ vì đó là sự thật tại thời điểm đó | **CLOSED** |
| `F-PROG-015` | P1 | FE Design chứa hai kiến trúc route cùng hiệu lực: §0.1 có bốn workspace dưới `/eng/programming`, §2 vẫn có cây thư mục cũ và tám route `/engineering/programming/...`; metadata chỉ nhận `FE-101..112` | Xóa cây thư mục và tám route cũ khỏi §2; §2 chuyển thành mô tả module cắt ngang và trỏ về §0.1 làm nguồn duy nhất; metadata nhận `FE-101..115` | **CLOSED** |
| `F-PROG-016` | P1 | Use case và verification còn điều hướng theo trang cũ: UC-PROG-04 sửa FBD ở `PGM-04`, UC-PROG-05 mở Mapping ở `PGM-03`, UC-PROG-07 mở Task ở `PGM-04`, `DraftAttentionPanel` dẫn tới `PGM-02/05`, `VS-002` còn “đi sáu route”; asset mobile đánh dấu tab `Chương trình` active trong khi đang hiển thị Tổng quan | Sửa ba trigger UC về đúng tab của `PGM-02`; sửa hai dòng `DraftAttentionPanel`; `VS-002` đổi sang bốn workspace và tám journey; sửa thanh điều hướng dưới của asset mobile thành `Tổng quan` active với đúng bốn mục | **CLOSED** |
| `F-PROG-017` | P1 | Tài liệu đầu vào UX vẫn phát biểu normative theo `PGM-01..06` ở `UX-REQ-002`, và trỏ bằng code span tới `01_VERIFICATION_SCENARIOS.md` — file **không tồn tại** trong cây làm việc. Harness Markdown không bắt được vì đây không phải liên kết Markdown | Chọn phương án **đóng băng**: đổi Status sang `REFERENCE`, tuyên bố rõ §4, §7–§12, §21 và `UX-REQ-002` **không còn normative**, và nêu phần nào vẫn hiệu lực; sửa dead reference ở **cả hai** tài liệu đầu vào; đính chính §31 của Product Spec đầu vào (file không tồn tại + số decision sai) | **CLOSED** |

Tổng cộng qua hai vòng: **17 finding, tất cả đã đóng** — 7 `P0`, 9 `P1`, 1 `P2`.

### 6.2.1 Harness được bổ sung sau `F-PROG-017`

`F-PROG-017` lọt qua vòng trước vì harness chỉ kiểm liên kết Markdown. Đã thêm
phép kiểm thứ bảy: **đường dẫn `docs/**` viết trong code span phải tồn tại**.
Phạm vi cố ý giới hạn ở `docs/**`; đường dẫn `apps/**`, `firmware/**` và
`contracts/**` trong hồ sơ thiết kế là **Source Target sẽ tạo**, chưa tồn tại là
đúng theo quy tắc ở `TRACE-PROG-001` §6. Kết quả hiện tại: `0`.

## 7. Lịch sử

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-08-09 | Tạo record: phương pháp, 12 finding, kết quả harness trước/sau, ranh giới việc cần người thật |
| 1.1 | 2026-08-09 | Thêm §6.1 đo lại sau Amendment A1; kết luận M3/M4/M5 không đổi, bổ sung `OD-PROG-016` vào điều kiện mở khóa M4 |
| 1.2 | 2026-08-09 | Thêm §6.2: 5 finding của vòng review chặn phê duyệt (2 P0, 3 P1) và cách xử lý; thêm §6.2.1 phép kiểm harness thứ bảy cho đường dẫn trong code span. Tổng hai vòng: 17 finding, tất cả đã đóng |
