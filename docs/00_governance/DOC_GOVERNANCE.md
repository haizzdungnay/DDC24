# Quy tắc kiểm soát tài liệu kỹ thuật MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID | `DOC-GOV-001` |
| Phiên bản | 1.0 |
| Trạng thái | **Active** |
| Ngày | 2026-08-09 |
| Chủ quản | Document Control + System Engineering |
| Phạm vi | Mọi hồ sơ kỹ thuật trong `docs/`; bắt buộc với bộ Programming Rev A |

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để làm gì? | Đặt **luật chơi cho tài liệu**: một hồ sơ phải có gì mới được gọi là đủ, đo mức trưởng thành thế nào, khi nào được nâng mức, và chạy lệnh nào để kiểm. |
| 2. Ai phải đọc? | Bất kỳ ai viết hoặc review hồ sơ kỹ thuật. **Kể cả người không dùng agent** — đó là lý do tài liệu này tồn tại trong repository thay vì chỉ nằm trong `AGENTS.md`. |
| 3. Hiện trạng? | Trước 2026-08-09, các quy tắc này chỉ nằm trong `AGENTS.md` và trong skill của agent. Thành viên làm việc bằng trình soạn thảo thường không thấy chúng, nên áp dụng không thống nhất. |
| 4. Thay đổi gì? | Đưa nguyên bộ quy tắc vào repository, kèm harness chạy lại được và template hồ sơ. `AGENTS.md` giữ nguyên và trỏ về đây. |
| 5. Phải làm gì? | Khi viết hồ sơ mới: bắt đầu từ [template](../02_design/_templates/TEMPLATE_DDD.md). Trước khi mở PR: chạy `python3 scripts/docs_iso_harness.py --expect`. |
| 6. Còn bị chặn gì? | Không. Tài liệu này `Active` và áp dụng ngay. |
| 7. Bằng chứng? | Harness ở §5 chạy được từ repository và trả exit code; kết quả gần nhất ghi trong `CHANGELOG.md`. |

## 1. Ánh xạ mục tiêu chuẩn — **ISO-aligned, không phải đã chứng nhận**

Dự án **không** tuyên bố đã được chứng nhận theo bất kỳ chuẩn nào. Cụm từ duy
nhất được phép dùng là **“ISO-aligned”**, và chỉ khi cấu trúc cùng bằng chứng
thực sự phù hợp. Cấm dùng “compliant”, “certified”, “đạt chuẩn” khi chưa có đánh
giá độc lập.

| Họ chuẩn dùng làm hướng dẫn | Cơ chế cụ thể trong repository |
|---|---|
| ISO/IEC/IEEE 29148 | Requirement có ID ổn định, một nghĩa, nguồn, rationale, priority, allocation, phương pháp kiểm chứng, acceptance định lượng và trace hai chiều |
| ISO/IEC/IEEE 15288 và 12207 | Tách lifecycle: requirement → architecture → detailed design → implementation plan → V&V → operations → release gate; work package có entry/exit; review và change control |
| ISO/IEC 25010 | NFR có **ngưỡng đo được** cho performance, reliability, usability, security, compatibility, maintainability — không mô tả định tính |
| ISO 9001 | Metadata kiểm soát (ID, version, status, owner, reviewer, approver), revision history, document register, baseline có commit và hash, corrective action qua finding register |
| IEC 62443 direction | RBAC ở server, integrity của artifact, audit bất biến, least privilege, threat/abuse case và incident response |
| IEC 61131-3 | Hồ sơ Language/Compiler, Control Semantics và Runtime xác định **subset/profile của dự án** có thể kiểm chứng; không claim full conformance |

## 2. Cấu trúc bắt buộc của một hồ sơ Detailed Design — `DD-01..DD-13`

Mỗi hồ sơ Detailed Design phải xử lý đủ 13 mã dưới đây và **ghi kết quả thành
bảng ngay trong hồ sơ**. Mỗi mã là `PASS`, `N/A` có lý do, hoặc `BLOCKED` có đủ
bốn trường: owner, ảnh hưởng, gate, điều kiện mở khóa.

| Mã | Nội dung phải có | Điều kiện `PASS` |
|---|---|---|
| `DD-01` | Metadata và quyền tài liệu | ID, version, status, ngày, owner, reviewer, approver, nguồn, phạm vi, revision history |
| `DD-02` | Mục tiêu, actor, phạm vi | Outcome, use case, in/out scope, constraint, tiêu chí thành công |
| `DD-03` | As-Built có dẫn chứng | Source/contract/class/function/route/schema **có thật** kèm gap đã kiểm |
| `DD-04` | Target design và ownership | Chủ sở hữu state thay đổi được, input/output/consumer, boundary, failure path |
| `DD-05` | Data model từng field | Type/unit/default/range/null/key/validation/lifecycle/version/migration |
| `DD-06` | Interface/contract | Payload hoặc layout, auth/RBAC, timeout/retry, idempotency, error ổn định, audit, compatibility |
| `DD-07` | State/algorithm/timing | State machine, guard/action, pseudocode, ordering, atomicity, WCET, resource |
| `DD-08` | User hoặc operation flow | Route/action/state/copy/a11y; hoặc preflight/read-back/rollback/incident |
| `DD-09` | Error/safety/security | Nơi phát hiện, mã, state/output giữ hay đổi, recovery, audit/alarm, safe behavior, abuse case |
| `DD-10` | Ánh xạ repository | File/package/class/function/build/config/feature flag cần tạo hoặc sửa |
| `DD-11` | Verification | Requirement→test, fixture, bước, kỳ vọng **định lượng**, ca âm/ca lỗi, target, evidence, thẩm quyền ký |
| `DD-12` | Compatibility/deploy/rollback | Version/migration/partial deploy/restart/rollback/dữ liệu phải giữ |
| `DD-13` | Trace/risk/decision/sign-off | Link end-to-end, risk/residual, TBD có owner và gate, bảng ký |

**Có heading rỗng không phải là `PASS`.** Trước khi kết luận “đủ để implement”,
phải bảo đảm một dev không tham gia thiết kế biết chính xác sửa ở đâu, data và
contract gì, state/algorithm ra sao, lỗi/restart/rollback thế nào, và test nào
chứng minh.

### 2.1 Hồ sơ không phải Detailed Design

| Loại | Cổng bắt buộc |
|---|---|
| Requirements | ID ổn định; một nghĩa; source/rationale; priority; allocation; verification method; acceptance định lượng; không lẫn solution chưa duyệt |
| Open Decisions | Context; options và trade-off; decision authority; deadline/gate; rationale; consequences; tài liệu downstream phải đồng bộ |
| Architecture | Context/component/deployment; ownership; trust và failure boundary; hướng interface; state; capacity/timing; compatibility/rollback; xung đột ADR |
| V&V | Trace requirement/risk; test level; fixture; precondition; steps; expected; ca âm/ca lỗi; environment/target; evidence; thẩm quyền ký PASS |
| Operations | Role/preflight; lệnh; expected và read-back; backup; rollback; incident; escalation; audit/evidence; bảo vệ dữ liệu |
| Risk | Cause/event/impact; S và L; control; owner; verification/evidence; residual; thẩm quyền chấp nhận; ngày review lại |
| Traceability | Mọi link trỏ ID hoặc mục có thật; phân biệt planned/documented/implemented/tested/passed/released |
| Implementation Plan | Entry/exit; dependency; owner/RACI; deliverable; test/evidence; change control; deploy/rollback; **không mở gate bằng văn xuôi** |

### 2.2 Yêu cầu riêng cho hồ sơ UI/UX

Wireframe chữ hoặc ASCII **không đủ** để qua cổng Detailed Design. Mỗi màn hình
chính, và mọi modal/drawer/trạng thái chứa quyết định an toàn, hành động không
thể hoàn tác hoặc thay đổi runtime, phải có **bản đặc tả trực quan render được**
(SVG/PNG hoặc liên kết Figma có export ổn định) nhúng ngay trong hồ sơ. Trang
landing responsive phải có ít nhất bản desktop và mobile.

Kèm theo: cây component; bảng ánh xạ từng vùng tới `field → API → state → action
→ RBAC → copy → error → test`; token kích thước, màu và tương phản. Dữ liệu giả
trong asset **phải ghi rõ là minh họa**, không phải bằng chứng runtime. Sửa nội
dung thì phải sửa asset trong cùng revision.

## 3. Thang mức trưởng thành `M0..M5`

| Mức | Điểm | Điều kiện tối thiểu |
|---|---:|---|
| `M0 — NOT CREATED` | 0 | Chưa có file tại đường dẫn chuẩn |
| `M1 — OUTLINE` | 10 | Có file, metadata và đầu mục; chưa đủ để review |
| `M2 — DRAFT CONTENT` | 30 | Có nội dung thực chất, nhưng checklist chưa được chứng minh đầy đủ |
| `M3 — REVIEW READY` | 60 | **Kiểm được bằng bằng chứng khách quan**: checklist áp dụng đã đủ và ghi thành bảng trong chính hồ sơ; mọi `TBD/BLOCKED` có owner/ảnh hưởng/gate/điều kiện mở; link nội bộ sạch |
| `M4 — REVIEW CLOSED` | 80 | **Cần con người**: reviewer của bên **tiêu thụ** contract đã đọc và đóng finding P0/P1 |
| `M5 — APPROVED` | 100 | Người có thẩm quyền ký; revision history hoàn tất; được phép dùng làm baseline implement |

Ranh giới `M3`/`M4` là chỗ dễ hiểu sai nhất: **tự kiểm của người soạn không bao
giờ đủ để lên `M4`**, dù checklist có đầy đủ đến đâu. Không dùng cụm “peer
review” làm điều kiện của `M3`.

```text
File coverage     = số file tồn tại / mẫu số × 100%
Maturity progress = tổng điểm M0..M5 / (mẫu số × 100) × 100%
```

Không giảm mẫu số và không tách file lớn thành nhiều file để tăng điểm.

## 4. Ba cổng quyền hạn cho team

Tách “được lập kế hoạch” khỏi “được viết code” để không chặn quá rộng.

| Cổng | Cho phép | Điều kiện đóng |
|---|---|---|
| `PLAN_READY` | Phân tích, ước lượng, dựng dependency, điền thẻ task, spike bỏ đi | Finding P0 tài liệu đã đóng; consumer review xong; revision và hash được ghim; không còn authority mâu thuẫn |
| `IMPLEMENT_READY` | Nhánh feature, code production, đổi contract, feature flag ở lab | `PLAN_READY` đóng **và** decision đầu vào của **đúng lát cắt đó** đã ký **và** contract của lát cắt đã machine-readable |
| `RELEASE_READY` | Bật ở site thật, tuyên bố hoàn tất | Toàn bộ scenario có Test Result được review; residual risk được chấp nhận; GO của Product + Release + QA |

Chi tiết áp dụng cho Programming Rev A nằm ở
[Plan 53 §3.1–§3.3](../03_implementation/53_PROGRAMMING_IMPLEMENTATION_PLAN.md).

## 5. Harness kiểm tài liệu

```bash
python3 scripts/docs_iso_harness.py            # tóm tắt, exit 0/1
python3 scripts/docs_iso_harness.py -v         # kèm chi tiết từng vi phạm
python3 scripts/docs_iso_harness.py --expect   # kiểm cả ngưỡng, dùng cho CI
```

Bảy phép kiểm: file baseline tồn tại; liên kết Markdown và anchor phân giải
được; trailing whitespace; code fence cân bằng; Document ID không trùng; đếm ID
theo từng họ; bất biến ma trận trace (`P=Y khi T=N` và `R=Y khi P=N` phải bằng
`0`). Cộng thêm: đường dẫn `docs/**` viết trong code span phải tồn tại.

Phạm vi cố ý **không** kiểm `apps/**`, `firmware/**`, `contracts/**` trong code
span — đó là *Source Target sẽ tạo*, chưa tồn tại là đúng.

Khối `EXPECT` trong script giữ ngưỡng hiện hành. Khi thay đổi hồ sơ làm đổi số
đếm, cập nhật `EXPECT` **trong cùng commit**, không cập nhật sau. `--expect`
báo `DRIFT` chính là để bắt việc quên đồng bộ.

Harness là kiểm **tài liệu**. Nó không chạy build, test, trình duyệt, target hay
HIL, và không chứng minh bất cứ điều gì về implementation.

## 6. Quy tắc trung thực bắt buộc

Bảy điều dưới đây áp cho mọi hồ sơ; vi phạm là finding `P0`.

1. Không dùng sự tồn tại của file, số trang, unit test trên host, mock hay
   self-check để suy ra implementation, mức sẵn sàng target/HIL, hay approval.
2. Không tuyên bố chứng nhận. Chỉ “ISO-aligned” khi có cấu trúc và bằng chứng.
3. Không giảm residual risk bằng kế hoạch, văn bản review hay test cũ chạy trên
   contract khác. Merge code chỉ đưa risk lên `TREATMENT_IMPLEMENTED`.
4. Không tự ký thay người có thẩm quyền. Thiếu người ký thì hoàn thiện phần còn
   lại và giữ đúng **một** blocker “chờ authority ký”.
5. `TBD` hoặc `BLOCKED` chỉ hợp lệ khi có đủ owner, ảnh hưởng, gate và điều kiện
   mở khóa.
6. Không tạo hồ sơ thứ hai trùng thẩm quyền. Sửa đúng file đang sở hữu nội dung.
   Khi một hồ sơ bị thay thế một phần, đánh dấu phần đó `SUPERSEDED` và nêu rõ
   phần nào còn hiệu lực.
7. Số đếm trong phần tự kiểm phải là số **hiện hành**. Một self-check chứa số sai
   không được dùng làm bằng chứng mức trưởng thành.

## 7. Khi thay đổi tài liệu

1. Sửa đúng hồ sơ chủ quản; giữ ID ổn định hoặc ghi rõ quan hệ `supersedes`.
2. Cập nhật revision history **trong chính hồ sơ**, kèm version mới.
3. Đồng bộ Traceability, Risk và Open Decisions nếu ảnh hưởng requirement,
   contract, safety, test hay evidence.
4. Cập nhật `CHANGELOG.md` dưới `[Unreleased]` trong cùng phiên.
5. Chạy `python3 scripts/docs_iso_harness.py --expect` và ghi số đo thật.
6. Commit vào Git. **Một hồ sơ chưa được Git theo dõi thì chưa phải baseline có
   kiểm soát** — không có commit và hash thì không có gì để ghim, để so sánh,
   hay để quay lui.

## 8. Lịch sử

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-08-09 | Tạo hồ sơ: đưa quy tắc ISO-aligned, `DD-01..DD-13`, thang `M0..M5`, ba cổng quyền hạn, harness và bảy quy tắc trung thực từ `AGENTS.md` vào repository |
