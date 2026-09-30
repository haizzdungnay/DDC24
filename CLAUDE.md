# Claude Code — Quy tắc dự án MK-DDC-24

File này được Claude Code tự động nạp vào mỗi phiên làm việc trong repo (khác `AGENTS.md`, vốn không được harness này tự động đọc). Đồng bộ nội dung với `AGENTS.md` để các agent/tool khác dùng chung quy tắc.

- Luôn trả lời bằng tiếng Việt và viết tài liệu (docs, changelog, báo cáo, review) bằng tiếng Việt. Hạn chế tối đa tiếng Anh trong nội dung rule và skill của agent; chỉ giữ nguyên tiếng Anh cho thuật ngữ kỹ thuật/tên riêng không có bản dịch tương đương rõ ràng (ví dụ: BACnet, Modbus, CRC, endian, watchdog, tên biến/hàm/API trong code).
- Mọi thay đổi code, config, deployment, hoặc documentation phải cập nhật `CHANGELOG.md` trong cùng phiên làm việc.
- Thêm entry vào CHANGELOG dưới mục `[Unreleased]` kèm ngày, phạm vi, và ghi chú verification khi cần.
- Không được bỏ qua CHANGELOG trừ khi user nói rõ là không cần cập nhật.
- Giữ thay đổi FE cục bộ (local) làm nguồn chân lý; không ghi đè công việc FE cục bộ không liên quan.

## Quy trình clean code & clean docs

Authority: **`docs/00_governance/CLEAN_CODE_WORKFLOW.md`** (`WF-CLEAN-001`).

Ba vai tách biệt, mỗi vai một skill trong `.claude/skills/`:
`ddc-manager-planner` (1 lần/ngày, tạo Issue), `ddc-implementer` (mỗi 1h30,
implement + PR), `ddc-reviewer` (1 lần/ngày, review + merge).

Ràng buộc thi hành bằng `scripts/workflow_guard.py`: người tạo Issue không tự
implement, người implement không tự merge, mọi PR phải `Closes` đúng một Issue
kèm bảng Verification có số đo thật. Chạy `python3 scripts/workflow_guard.py
--selftest` để kiểm logic cổng khi sửa nó.

## Làm hết việc, không chừa lại

Khi user giao việc, **làm trọn tới nơi**. Không được báo cáo giữa chừng rồi để lại
một danh sách "còn lại / nên làm tiếp / nói nếu muốn tôi làm". Nếu trong lúc làm
mà phát hiện lỗi hoặc thiếu sót thuộc phạm vi được giao thì **sửa luôn**, không
chỉ ghi vào tài liệu rồi bỏ đó.

Quy tắc cụ thể:

1. **Phát hiện lỗi trong phạm vi việc đang làm ⇒ sửa trong cùng phiên.** Ghi
   finding vào docs là bước bổ sung, không phải bước thay thế cho việc sửa.
2. **Không hỏi lại những gì có thể tự quyết.** Chỉ dừng hỏi khi hành động thực sự
   không thể hoàn tác, phá huỷ dữ liệu, hoặc ảnh hưởng ra ngoài (production thật,
   gửi mail, xoá dữ liệu người dùng). Cài/restart service trên board lab, tạo
   nhánh, commit, mở PR, chạy test, cài toolchain dev — **tự làm, không hỏi**.
3. **Bị chặn một nhánh thì làm hết các nhánh còn lại**, rồi mới báo đúng một mục
   bị chặn kèm lý do và thứ cần để mở khoá. Không lấy một chỗ bị chặn làm cớ dừng
   toàn bộ.
4. **Trước khi kết luận "xong", tự rà lại**: mọi lỗi phát hiện đã sửa chưa; mọi
   file đã commit/push/merge chưa; CHANGELOG đã cập nhật chưa; số đo đã đo lại
   thật chưa. Nếu còn mục nào chưa làm mà không bị chặn thì **chưa được báo xong**.
5. Việc bị chặn thật sự phải ghi rõ **bị chặn bởi cái gì** và **cần gì để mở**,
   không viết chung chung kiểu "nói nếu bạn muốn tôi làm tiếp".

## Kiểm chứng frontend bằng Chrome DevTools MCP

Chi tiết ở `AGENTS.md` §"Kiểm chứng frontend bằng Chrome DevTools MCP".

`chrome-devtools-mcp` chạy Chrome **headful**, mà phiên agent trên host không
thừa hưởng `DISPLAY` dùng được — đó là nguyên nhân mọi bảng kiểm chứng từng ghi
`Chrome DevTools MCP = NOT_RUN` với lý do "thiếu X server". Từ 2026-09-12, cả
`.mcp.json` (Claude Code) lẫn `.codex/config.toml` (Codex) gọi
`scripts/chrome-devtools-mcp.sh`, launcher tự dựng Xvfb riêng bằng
`scripts/ensure-xvfb.sh`. Trước khi ghi `NOT_RUN` cho lane này, **bắt buộc** chạy
`scripts/verify-project.sh --component browser` và dẫn kết quả thật.

## Quy trình khi user nói "commit" hoặc "merge"

Khi user chỉ nói ngắn gọn **"commit"**, **"merge"**, **"commit đi"**, **"merge đi"** — hiểu là **chạy trọn quy trình dưới đây cho toàn bộ thay đổi hiện có trong cây làm việc**, không hỏi lại từng bước:

1. **Kiểm chứng trước khi commit.** Chạy lại các bộ test tương ứng với phạm vi đã đổi và ghi số đo thật (không dẫn lại số cũ):
   - C++: `cmake --fresh -S . -B build/fw -DCMAKE_BUILD_TYPE=Release -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON`, `cmake --build build/fw --parallel` rồi `ctest --test-dir build/fw --output-on-failure` (**bật cả 3 option**, mặc định HMI là OFF nên dễ bỏ sót gate). Root CMake là authority sau `PLAN-ARCH-RESTRUCT-002`; **không dùng lại path `services/` đã xóa**. Giữ `--fresh` và **luôn đọc exit code của cả configure lẫn build**: build dir cũ còn `CMAKE_HOME_DIRECTORY` trỏ `services/` sẽ làm configure + build hỏng nhưng `ctest` vẫn chạy binary cũ và báo "pass" — số đo giả (2026-08-07).
   - Go: `go vet ./...` + `go test ./... -count=1` (dùng `-count=1`, kết quả cache che được hồi quy).
   - FE: `npx vitest --run --environment jsdom src` + `npm run lint` + `npm run build`. Lưu ý `npm test` chỉ quét `src/`, **không** chạy `e2e/`.
   - E2E khi có đổi trang mạng: `npx playwright test e2e/network-qa.spec.ts`.
2. **Cập nhật `CHANGELOG.md`** dưới `[Unreleased]` như quy tắc phía trên.
3. **Commit tách theo nhóm logic, chi tiết để dễ truy xuất.** Không gom tất cả vào một commit. Mỗi commit: một nhóm mạch lạc (ví dụ hợp đồng SHM / netcfg / backend Go / frontend / CI / tài liệu), tiêu đề theo Conventional Commits, thân bài **tiếng Việt** nêu rõ **triệu chứng → nguyên nhân gốc → cách sửa**, dẫn mã finding và tài liệu liên quan (`Refs:`). Viết đủ để người đọc sau này hiểu *vì sao* chứ không chỉ *cái gì*.
4. **Push** lên nhánh hiện tại. Nếu đang ở nhánh mặc định thì tạo nhánh trước.
5. **Tạo PR** bằng `gh pr create`, mô tả tiếng Việt tổng hợp các nhóm commit + bảng số đo kiểm chứng.
6. **Merge PR**, rồi **xoá nhánh remote** sau khi merge xong.
7. Báo lại kết quả kèm link PR và số đo.

Nếu bước nào hỏng (thường gặp: token `gh`/git hết hạn), **làm hết các bước không bị chặn** rồi nói rõ bước nào còn lại và cần gì để mở khoá — không dừng ngang khi chưa commit xong.

## Quy trình gỡ conflict của một PR

Khi user nhờ "xử lý conflict PR #N" (hoặc PR báo `CONFLICTING`/`DIRTY`), làm trọn
các bước dưới đây, không hỏi lại. Mục tiêu là PR merge được **và** mã sau khi gộp
đúng ý cả hai phía, không chỉ là hết dấu `<<<<<<<`.

1. **Lấy bản mới nhất, không đụng cây làm việc chung.**
   `git fetch origin main <nhánh-PR>` rồi
   `git worktree add --detach <scratchpad>/wt origin/<nhánh-PR>`. Mọi thao tác sau
   làm trong worktree đó. Không `checkout`/`reset`/`stash`/`checkout -- <file>`
   trên cây chung: phiên khác có thể đang để việc chưa commit ở đó.
2. **Merge `origin/main` vào nhánh PR, không rebase, không force-push.**
   `git merge --no-ff --no-commit origin/main`. Nhánh PR đã push, có khi đã deploy
   theo SHA và SHA đó nằm trong hồ sơ; rebase làm mất dấu.
3. **Hiểu ý định của cả hai phía trước khi chọn.** Với mỗi file conflict, đọc các
   commit bên `main` đã đổi đoạn đó
   (`git log -p $(git merge-base HEAD origin/main)..origin/main -- <file>`) và
   trả lời được: `main` đổi để làm gì, PR đổi để làm gì.
   - `main` đã giải cùng vấn đề theo cách khác ⇒ lấy phía `main`, bỏ logic trùng
     của PR; giữ test của PR nếu vẫn đúng với logic mới.
   - Hai phía làm hai việc khác nhau ⇒ gộp cả hai, rồi đọc lại toàn hàm.
   - Cấm `git checkout --ours/--theirs` cả file cho mã nguồn.
4. **Soát cả file git tự gộp được.** Hai phía cùng sửa một file mà không báo
   conflict vẫn có thể xung đột ngữ nghĩa. Lấy giao của hai danh sách
   `git diff --name-only <merge-base> <phía>` và đọc
   `git diff origin/main -- <file>` cho từng file trong giao đó.
5. **File chỉ thêm khối** (`CHANGELOG.md` dưới `[Unreleased]`, bảng chỉ mục
   README): giữ cả hai phía. Nếu cách gộp làm mục CHANGELOG của PR không còn đúng
   (logic của PR bị thay), thêm một mục mới ghi quyết định gộp; không viết lại
   mục cũ, vì nó khớp với SHA đã deploy.
6. **Kiểm chứng như lúc commit** (mục "commit" hoặc "merge" ở trên), chạy ngay
   trong worktree, đọc exit code của configure, build và test. Khi cách gộp chọn
   một phía, làm **kiểm đột biến**: đưa phía bị bỏ vào lại, chỉ ra test đỏ, rồi
   khôi phục.
7. **Commit merge có thân bài tiếng Việt**: từng file conflict, phía `main` làm
   gì, phía PR làm gì, chọn gì, vì sao, test nào chốt. Push bằng
   `git push origin HEAD:<nhánh-PR>`, rồi xác nhận
   `gh pr view <N> --json mergeable,mergeStateStatus` trả `MERGEABLE`.
8. **Dọn**: `git worktree remove --force <wt>` (xoá luôn `build/` bên trong) và
   `git worktree prune`. `git status --short` ở cây chung phải y hệt lúc đầu phiên.

Gỡ conflict xong **không** tự merge PR, trừ khi user nói "merge". Khi merge bị
chặn vì thiếu review thì để PR mở và báo link.
