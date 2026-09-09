# Agent Rules

- Every code, config, deployment, or documentation change must update `CHANGELOG.md` in the same work session.
- Add changelog entries under `[Unreleased]` with date, scope, and verification notes when relevant.
- Do not skip the changelog unless the user explicitly says not to update it.
- Keep FE local changes as the source of truth; do not overwrite unrelated local FE work.
- Luôn trả lời bằng tiếng Việt và viết tài liệu (docs, changelog, báo cáo, review) bằng tiếng Việt. Hạn chế tối đa tiếng Anh trong nội dung rule và skill của agent; chỉ giữ nguyên tiếng Anh cho thuật ngữ kỹ thuật/tên riêng không có bản dịch tương đương rõ ràng (ví dụ: BACnet, Modbus, CRC, endian, watchdog, tên biến/hàm/API trong code).

## Quy trình clean code & clean docs — ba vai tách biệt

Bộ quy tắc vận hành việc dọn mã nguồn và dọn tài liệu là
**`docs/00_governance/CLEAN_CODE_WORKFLOW.md`** (`WF-CLEAN-001`, Active). Nó
quy định ba vai tách biệt, ma trận quyền, workflow state, quy tắc nhánh/merge,
quality gate, truy xuất Issue → PR → Test → Merge → Close và lịch chạy.

| Vai | Nhịp | Skill | Cấm |
|---|---|---|---|
| Manager/Planner | 1 lần/ngày | `.claude/skills/ddc-manager-planner/` | implement, tạo PR, merge |
| Implementer | mỗi 1h30 | `.claude/skills/ddc-implementer/` | tự tạo Issue rồi tự làm, gắn `review:pass`, merge |
| Reviewer/Gatekeeper | 1 lần/ngày | `.claude/skills/ddc-reviewer/` | tự sửa code trong PR đang review, merge khi CI đỏ |

Ba ràng buộc được thi hành bằng máy qua `scripts/workflow_guard.py` (job
`Cổng quy trình clean-code`), không phải bằng thiện chí:

1. **Người tạo Issue không tự implement** — `Manager-Run` của Issue phải khác
   `Implementer-Run` của PR.
2. **Người implement không tự merge** — merge chỉ mở khi có nhãn `review:pass`
   và comment `[REVIEW-VERDICT: PASS]` mang `Reviewer-Run` khác hai giá trị trên.
3. **Mọi thay đổi trace được** — PR phải `Closes` đúng một Issue và có bảng
   Verification điền số đo thật.

Mục "Làm hết việc, không chừa lại" bên dưới vẫn áp dụng **trong phạm vi vai**:
lỗi thuộc phạm vi Issue đang làm thì sửa luôn; lỗi ngoài phạm vi thì mở finding
`state:triage` cho Manager, không tự nhảy sang làm.

## Nguồn quy tắc tài liệu nằm trong repository

Bộ quy tắc kiểm soát tài liệu là **`docs/00_governance/DOC_GOVERNANCE.md`**
(`DOC-GOV-001`, Active). Nó chứa ánh xạ ISO-aligned, checklist `DD-01..DD-13`,
thang `M0..M5`, ba cổng `PLAN_READY`/`IMPLEMENT_READY`/`RELEASE_READY`, cách
chạy harness và bảy quy tắc trung thực.

Lý do đặt trong repository chứ không chỉ ở đây: thành viên không dùng agent vẫn
phải áp dụng được cùng một luật. Mục dưới đây giữ nguyên để agent đọc nhanh; khi
hai bên khác nhau, **`DOC-GOV-001` là bản đúng**.

Template hồ sơ mới: `docs/02_design/_templates/TEMPLATE_DDD.md`.
Harness: `python3 scripts/docs_iso_harness.py --expect`.

## Cấu trúc bắt buộc của một file thiết kế

Tài liệu giao cho team implement phải là **nội dung Detailed Design**, không phải
chỉ có đầu mục, requirement, kiến trúc tổng quan, roadmap hoặc task list. Mỗi file
thiết kế phải có đủ phần áp dụng được sau đây:

1. Metadata/quyền tài liệu, requirement nguồn, trạng thái `As-Built/Target/TBD`.
2. Mục tiêu, actor/use case, phạm vi trong/ngoài, constraint và success criteria.
3. Hiện trạng As-Built có dẫn source/contract/class/function/route/schema và gap.
4. Thiết kế mục tiêu: ownership, input/output/consumer, process/thread/deployment
   và failure boundary; sơ đồ/sequence khi cần.
5. Data model từng field: type/unit/required/default/range/enum/null semantics,
   identity/key/index/FK, validation, lifecycle, retention, version và migration.
6. Interface/contract: request/response hoặc layout, auth/RBAC, timeout/retry,
   idempotency/concurrency, stable error, side effect, audit và compatibility.
7. State machine, thuật toán/pseudocode, ordering, transaction/atomic/lock,
   clock/timing/WCET/watchdog, memory/resource limit và power/process-fault path.
8. FE/UX hoặc operation flow: route/wireframe/component/action/state/copy/i18n/
   responsive/a11y; hoặc preflight/execute/read-back/rollback/incident. Với
   UI/UX, wireframe chữ/ASCII **không đủ** để qua cổng Detailed Design: mỗi màn
   hình chính và mọi modal/drawer/trạng thái chứa quyết định an toàn, hành động
   không thể hoàn tác hoặc thay đổi runtime phải có bản đặc tả trực quan render
   được (SVG/PNG hoặc liên kết Figma kèm export ổn định) và được
   nhúng/liên kết ngay trong hồ sơ. Landing/dashboard responsive phải có ít
   nhất bản desktop và mobile; dữ liệu giả phải ghi rõ là minh họa, không phải
   bằng chứng runtime. Bản trực quan phải thể hiện shell/điều hướng, thứ bậc
   thông tin, component, action chính/phụ, trạng thái loading/empty/error/
   permission/unknown/stale/offline áp dụng, focus và breakpoint. Kèm cây
   component và bảng ánh xạ từng vùng tới field/API/state/action/RBAC/copy,
   token kích thước-màu-tương phản; sửa nội dung thì phải sửa asset cùng revision.
9. Error/safety/security: nơi phát hiện, code, state/output giữ hay đổi, recovery,
   audit/alarm boundary, priority/interlock/safe-state và malicious input.
10. Source mapping: file/package/module/class/function/build/config/package cần
    tạo/sửa, dependency bị cấm và feature flag/migration impact.
11. Verification: requirement→test, fixture/precondition/steps/expected định
    lượng, positive/negative/fault case, target/evidence/pass authority.
12. Compatibility/deploy/rollback, traceability/risk/open decision và sign-off.

Trước khi kết luận `đủ để implement`, phải bảo đảm một dev không tham gia thiết
kế có thể biết chính xác sửa ở đâu, data/contract gì, state/algorithm ra sao,
lỗi/restart/rollback thế nào và test nào chứng minh. Phần thiếu phải bổ sung ngay;
`TBD/BLOCKED` chỉ hợp lệ khi có owner, ảnh hưởng, gate và điều kiện mở khóa.

## Làm hết việc, không chừa lại

Khi user giao việc, **làm trọn tới nơi**. Không được báo cáo giữa chừng rồi để lại
một danh sách "còn lại / nên làm tiếp / nói nếu muốn tôi làm". Nếu trong lúc làm
mà phát hiện lỗi hoặc thiếu sót thuộc phạm vi được giao thì **sửa luôn**, không
chỉ ghi vào tài liệu rồi bỏ đó.

1. **Phát hiện lỗi trong phạm vi việc đang làm ⇒ sửa trong cùng phiên.** Ghi
   finding vào docs là bước bổ sung, không phải bước thay thế cho việc sửa.
2. **Không hỏi lại những gì có thể tự quyết.** Chỉ dừng hỏi khi hành động thực sự
   không thể hoàn tác, phá huỷ dữ liệu, hoặc ảnh hưởng ra ngoài (production thật,
   gửi mail, xoá dữ liệu người dùng). Cài/restart service trên board lab, tạo
   nhánh, commit, mở PR, chạy test, cài toolchain dev — **tự làm, không hỏi**.
3. **Bị chặn một nhánh thì làm hết các nhánh còn lại**, rồi mới báo đúng một mục
   bị chặn kèm lý do và thứ cần để mở khoá.
4. **Trước khi kết luận "xong", tự rà lại**: mọi lỗi phát hiện đã sửa chưa; mọi
   file đã commit/push/merge chưa; CHANGELOG đã cập nhật chưa; số đo đã đo lại
   thật chưa. Còn mục nào chưa làm mà không bị chặn thì **chưa được báo xong**.
5. Việc bị chặn thật sự phải ghi rõ **bị chặn bởi cái gì** và **cần gì để mở**.

## Kiểm chứng frontend bằng Chrome DevTools MCP

- Tự dùng skill `$inspect-fe-chrome-devtools` và MCP `chrome-devtools` khi công
  việc liên quan review UI/UX, thay đổi giao diện hoặc hành vi React/Vite,
  responsive, accessibility, lỗi tương tác, tích hợp FE–BE, Console/Network,
  hiệu năng hoặc lỗi chỉ xuất hiện lúc chạy trên trình duyệt.
- Sau thay đổi FE có thể ảnh hưởng giao diện hoặc runtime, mở đúng luồng trên
  trình duyệt thật và kiểm tra tối thiểu snapshot/screenshot, Console error và
  Network request thất bại. Với thay đổi layout, kiểm tra cả desktop và mobile.
- Chrome DevTools MCP là bằng chứng bổ sung, không thay cho Vitest, lint, build
  hoặc Playwright E2E. Không bắt buộc dùng cho thay đổi chỉ gồm type/test/docs
  không ảnh hưởng runtime; nếu bỏ qua thì nêu lý do trong bàn giao.
- Không áp dụng workflow trình duyệt cho HMI native LVGL/DRM. Không dùng profile
  Chrome cá nhân, thông tin đăng nhập hoặc dữ liệu nhạy cảm nếu user chưa cho
  phép; không đưa token/cookie/header bí mật vào báo cáo.
- Nếu MCP chưa có trong phiên, kiểm tra `codex mcp get chrome-devtools`, báo rõ
  cần restart Codex và không được claim đã kiểm chứng bằng trình duyệt.

## Quy trình khi user nói "commit" hoặc "merge"

Khi user chỉ nói ngắn gọn **"commit"**, **"merge"**, **"commit đi"**, **"merge đi"** — hiểu là **chạy trọn quy trình dưới đây cho toàn bộ thay đổi hiện có trong cây làm việc**, không hỏi lại từng bước:

1. **Kiểm chứng trước khi commit**, ghi số đo thật (không dẫn lại số cũ):
   - C++: `cmake --fresh -S . -B build/fw -DCMAKE_BUILD_TYPE=Release -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON`, `cmake --build build/fw --parallel` rồi `ctest --test-dir build/fw --output-on-failure` (**bật cả 3 option**, mặc định HMI là OFF nên dễ bỏ sót gate). Root CMake là authority sau `PLAN-ARCH-RESTRUCT-002`; không dùng lại path `services/` đã xóa.
   - Go: chạy trong module authority `apps/web-api`:
     `(cd apps/web-api && go vet ./... && go test ./... -count=1)` (dùng
     `-count=1`, kết quả cache che được hồi quy). Không chạy từ root vì repo
     không có `go.work`/`go.mod` ở root.
   - FE: `npx vitest --run --environment jsdom src` + `npm run lint` + `npm run build`. Lưu ý `npm test` chỉ quét `src/`, **không** chạy `e2e/`.
   - E2E khi có đổi trang mạng: `npx playwright test e2e/network-qa.spec.ts`.
2. **Cập nhật `CHANGELOG.md`** dưới `[Unreleased]`.
3. **Commit tách theo nhóm logic, chi tiết để dễ truy xuất.** Không gom tất cả vào một commit. Mỗi commit: một nhóm mạch lạc (hợp đồng SHM / netcfg / backend Go / frontend / CI / tài liệu), tiêu đề theo Conventional Commits, thân bài **tiếng Việt** nêu rõ **triệu chứng → nguyên nhân gốc → cách sửa**, dẫn mã finding và tài liệu liên quan (`Refs:`).
4. **Push** lên nhánh hiện tại (đang ở nhánh mặc định thì tạo nhánh trước).
5. **Tạo PR** bằng `gh pr create`, mô tả tiếng Việt + bảng số đo kiểm chứng.
6. **Merge PR**, rồi **xoá nhánh remote**.
7. Báo lại kết quả kèm link PR và số đo.

Nếu bước nào hỏng (thường gặp: token `gh`/git hết hạn), **làm hết các bước không bị chặn** rồi nói rõ bước nào còn lại và cần gì để mở khoá.
