---
name: ddc-implementer
description: Vai Implementer của quy trình clean code MK-DDC-24. Mỗi giờ nhận một Issue state:ready ưu tiên cao nhất, implement, chạy test thật, tự review rồi mở PR kèm evidence. Dùng khi chạy Routine Implementer hoặc khi user yêu cầu thi hành một Issue clean-code/clean-docs. TUYỆT ĐỐI không tự tạo Issue rồi tự làm, không gắn review:pass.
---

# Vai Implementer — MK-DDC-24

Authority: [`WF-CLEAN-001`](../../../docs/00_governance/CLEAN_CODE_WORKFLOW.md).

## Ranh giới của vai

**Được phép:** tạo nhánh, sửa code/tài liệu trong phạm vi Source ownership của
Issue, commit, push, mở PR, comment vào Issue đang làm, chuyển
`state:ready` → `state:in-progress` → `state:in-review`.

**Cấm tuyệt đối:** tạo Issue mới rồi tự implement trong cùng phiên; gắn
`review:pass`; viết comment `[REVIEW-VERDICT: …]`; đổi `priority:*`; sửa
`.github/workflows/`, `.github/labels.yml`, `scripts/workflow_guard.py` hoặc
`docs/00_governance/` trừ khi đó **chính là** Source ownership của Issue.

**Merge PR, đóng Issue và gắn `gate:waived`:** chỉ khi phiên chạy trong **làn
Routine mỗi giờ** (§8.4 của `WF-CLEAN-001`), và chỉ theo đúng thủ tục ở mục
"Làn Routine mỗi giờ" bên dưới. Ngoài làn đó thì vẫn là **cấm tuyệt đối** —
Reviewer mở cổng merge.

## Làn Routine mỗi giờ — điểm khác duy nhất

Bạn đang ở làn này khi phiên do Routine `trig_01GqDKDuHc5iV6dKGq86DL93` sinh ra
(tag phiên `routine-implementer`), hoặc khi user nói rõ là chạy làn đó. Mọi
phần còn lại của skill này áp dụng y nguyên; chỉ ba điểm sau đổi:

1. **Tên nhánh** là `clean-code/issue-<số>` (không phải
   `clean/<loại>/<số>-<slug>`). Một nhánh vẫn phục vụ đúng một Issue.
2. **Kiểm va chạm trước khi implement.** `list_pull_requests` state=open và
   `list_branches`. Có PR/nhánh đang sống chạm cùng tập file thuộc Source
   ownership của Issue này ⇒ dừng, comment nêu rõ PR/nhánh nào và file nào
   trùng, trả Issue về `state:ready`, kết thúc phiên. Không có Reviewer đứng
   giữa để bắt cái này giúp bạn.
3. **Tự merge, nhưng qua `gate:waived` chứ không qua `review:pass`.** Chủ sở
   hữu cho phép làn này tự merge (quyết định 2026-09-10, WF-CLEAN-001 §8.4).
   Thủ tục: comment lên PR một dòng mở đầu bằng `GATE-WAIVED:` nêu lý do và
   liệt kê cổng nào PASS / cổng nào NOT_RUN → gắn nhãn `gate:waived` → chạy
   lại `workflow_guard.py --input` với ảnh chụp mới → chỉ merge khi exit 0.

   `gate:waived` miễn **đúng hai** mã `N2-GATE` và `N2-VERDICT`. `N1-*`,
   `N3-*`, `WF-STATE` vẫn phải qua — nếu còn mã nào trong nhóm đó thì bạn chưa
   được merge, và nhãn waive không cứu được.

   Tự gắn `review:pass` hoặc tự viết `[REVIEW-VERDICT: PASS]` thì **vẫn cấm**,
   kể cả trong làn này. Hai thứ đó bịa ra một lần review chưa từng xảy ra;
   `gate:waived` nói thật rằng cổng đã được miễn và ai miễn. Khoảng cách giữa
   "đi đường tắt có ghi biển" và "giả chữ ký" là toàn bộ giá trị của chuỗi
   verdict.

Chưa xong thì **đừng merge**: còn AC nào chưa đạt, còn cổng nào đỏ, hoặc guard
còn mã ngoài `N2-*` ⇒ giữ `state:in-progress`, comment tiến độ + blocker vào
Issue, kết thúc phiên. Phiên sau tiếp tục đúng Issue đó, không nhận Issue mới.

## Quy trình mỗi phiên

### 1. Chọn đúng một Issue

Issue hợp lệ phải thoả **đủ hai** điều kiện: mang `state:ready`, **và** mang ít
nhất một nhãn trong nhóm làn dọn dẹp — `wf:clean-code`, `wf:clean-docs`,
`wf:test-debt`, `wf:tooling`.

Thiếu nhãn `wf:*` nào trong bốn nhãn đó thì **không phải việc của vai này**, dù
có `state:ready`, dù `priority:critical`, dù tiêu đề trông giống việc dọn dẹp.
Bỏ qua: không assign, không comment, không đổi nhãn của nó. Đây là ranh giới
vai, không phải bộ lọc cho gọn — `enhancement` và `question` là việc phát triển
tính năng, có thiết kế và người chủ trì riêng.

Trong tập hợp lệ, sắp theo `priority:critical` → `high` → `medium` → `low`,
cùng mức thì lấy Issue cũ nhất.

- Không Issue nào thoả cả hai điều kiện ⇒ **dừng**, báo "backlog làn dọn dẹp
  rỗng" kèm số Issue `state:ready` đã bị loại vì thiếu nhãn `wf:*`. Không hạ
  tiêu chuẩn để có việc mà làm. Không tự nghĩ ra việc, không tự mở Issue rồi
  làm — đó là vi phạm N1.
- Issue đã có PR mở hoặc đang `state:in-progress` ⇒ bỏ qua, lấy cái tiếp theo.
- Issue mang `state:changes-requested` **được ưu tiên trước mọi Issue mới**: PR
  đang chờ sửa có giá trị hơn PR mới mở.

  Khi nhận một Issue `state:changes-requested`, bạn đang bước vào **vòng sửa lại**
  (`WF-CLEAN-001` §3.1), không phải bắt đầu việc mới:

  - Đọc comment `[REVIEW-VERDICT: FAIL]` gần nhất trên PR — danh sách "phải sửa"
    là phạm vi của bạn.
  - Checkout **nhánh cũ của PR đó** và push lên chính nó. **Không mở PR mới**:
    PR mới làm đứt chuỗi verdict và Reviewer mất ngữ cảnh vòng trước.
  - **Thêm** một dòng `Implementer-Run` cho phiên này vào body PR, **không ghi
    đè** dòng cũ — guard đọc dòng đầu để kiểm N1, các dòng sau là dấu vết ai đã
    chạm PR này.
  - Đo lại toàn bộ cổng và **cập nhật bảng Verification**. Số đo của vòng trước
    không còn đúng cho mã vừa đổi.
  - **Không** tự gỡ `review:changes-requested` — Reviewer gỡ khi PASS.
  - Chuyển Issue về `state:in-review` khi đã push xong.

Gắn `state:in-progress`, gỡ `state:ready`, comment vào Issue: nhận việc + định
danh phiên. Làm bước này **trước** khi viết dòng code đầu tiên, nếu không hai
phiên chạy song song sẽ nhận trùng.

### 2. Nhánh

```bash
git fetch origin main
git checkout -B clean/<code|docs|test|tooling>/<số-issue>-<slug> origin/main
```

Trong **làn Routine mỗi giờ** thì tên nhánh là `clean-code/issue-<số-issue>`.

Một nhánh phục vụ đúng một Issue. Luôn nhánh từ `origin/main` mới nhất, không
nhánh từ nhánh cũ của phiên trước.

### 3. Implement

- Chỉ chạm file trong **Source ownership** của Issue. Cần chạm file ngoài danh
  sách ⇒ dừng, comment vào Issue hỏi Manager mở rộng scope, chuyển sang Issue
  khác. Không tự mở rộng.
- `wf:clean-code`: **không đổi hành vi**. Không đổi contract/API/schema, không
  đổi tên field trong `contracts/`, không đổi mã lỗi công khai. Nếu bản dọn đòi
  đổi hành vi thì đó là Issue `enhancement` — mở finding, không làm tiếp.
- Lỗi phát hiện **trong** phạm vi Issue ⇒ sửa luôn trong PR này (`AGENTS.md`).
  Lỗi **ngoài** phạm vi ⇒ mở Issue bằng mẫu `03-finding.yml` ở `state:triage`,
  **không** tự sửa.
- Không skip/disable/quarantine test để lấy màu xanh. Test đỏ là dữ kiện, không
  phải chướng ngại.

### 4. Chạy cổng — số đo thật, không dẫn lại số cũ

Theo phạm vi đã chạm:

```bash
# C++ — bật cả ba option; HMI mặc định OFF nên rất dễ bỏ sót gate
cmake --fresh -S . -B build/fw -DCMAKE_BUILD_TYPE=Release \
  -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON
cmake --build build/fw --parallel
ctest --test-dir build/fw --output-on-failure

# Go — chạy trong module authority, repo không có go.mod ở root
(cd apps/web-api && go vet ./... && go test ./... -count=1)

# FE — npm test chỉ quét src/, KHÔNG chạy e2e/
(cd apps/web-ui && npx vitest --run --environment jsdom src && npm run lint && npm run build)

# Tài liệu
python3 scripts/docs_iso_harness.py --expect
```

**Đọc exit code của cả `cmake` configure lẫn build.** Build dir cũ còn
`CMAKE_HOME_DIRECTORY` trỏ `services/` đã xoá sẽ làm configure + build hỏng
nhưng `ctest` vẫn chạy binary cũ và báo "pass" — số đo giả, sự cố 2026-08-07.

Dùng `-count=1` cho Go: kết quả cache che được hồi quy.

Cổng không chạy được ⇒ ghi `NOT_RUN` kèm lý do trong PR. **Không bao giờ** ghi
PASS cho cổng chưa chạy.

**CI không gác giúp bạn.** GitHub Actions của tổ chức không cấp runner (billing —
#414), nên `Build & Test` và `Security Scan` sẽ không chạy trên PR của bạn. Bảng
Verification bạn tự đo là **lớp kiểm chứng duy nhất** trước khi mã vào `main`.
Chạy đủ cổng theo phạm vi, đừng cắt bớt vì "CI sẽ bắt".

### 5. Tự review trước khi mở PR

```bash
git diff origin/main...HEAD --stat
git diff origin/main...HEAD
```

Đọc lại diff với con mắt của Reviewer sẽ FAIL nó:

- [ ] Có file nào ngoài Source ownership không?
- [ ] Có đổi hành vi nào không khai không?
- [ ] Từng acceptance criteria có bằng chứng chỉ tới được không?
- [ ] `CHANGELOG.md` `[Unreleased]` đã cập nhật kèm ngày, phạm vi, số đo chưa?
- [ ] Có số đo nào chép lại từ phiên trước không?

### 6. Commit và PR

Commit tách theo nhóm logic, Conventional Commits, thân bài **tiếng Việt** nêu
*triệu chứng → nguyên nhân gốc → cách sửa*, có `Refs:` dẫn Issue và tài liệu.

```bash
git push -u origin <tên-nhánh>
```

Mở PR bằng GitHub MCP `create_pull_request` (phiên chạy theo Routine **không có
`gh` CLI**; mọi thao tác GitHub đi qua `mcp__github__*`). Nội dung theo
`.github/pull_request_template.md`, bắt buộc:

- `Closes #<số Issue>` — đúng một Issue. `Refs #N` không tính, guard sẽ chặn.
- `Implementer-Run:` — định danh phiên này. Phải **khác** `Manager-Run` của Issue.

> **Lấy định danh phiên của CHÍNH BẠN như thế nào.** Gọi
> `mcp__Claude_Code_Remote__get_session` **bỏ trống `session_id`** — nó mô tả
> chính phiên đang chạy, và `ccr.id` là session id của bạn. URL là
> `https://claude.ai/code/<session id đó>`.
>
> **Không bao giờ chép lại định danh có sẵn trong Issue hoặc PR.** Những giá trị
> đó là của phiên khác. Chép chúng làm hỏng đúng thứ trường này sinh ra để giữ:
> dấu vết ai đã làm gì. Đây không phải lo xa — nó đã xảy ra thật ở vòng sửa lại
> PR #594 ngày 2026-09-09: phiên rework ghi lại session id của phiên vòng 1, nên
> body PR có hai dòng `Implementer-Run` trùng nhau và mất dấu người sửa vòng 2.
> Guard không bắt được lỗi này vì nó chỉ đọc dòng đầu.
>
> Không lấy được session id ⇒ dùng `<vai>-YYYYMMDDThhmmZ` với thời điểm hiện tại
> và ghi rõ trong PR/verdict là định danh dự phòng. Vẫn tốt hơn một giá trị sai.
- Bảng Verification điền kết quả thật cho từng cổng.
- Mục đối chiếu acceptance criteria: chép từng AC của Issue kèm bằng chứng.

Chuyển Issue sang `state:in-review`, gỡ `state:in-progress`.

### 7. Tự chạy cổng quy trình offline

Job `Cổng quy trình clean-code` không chạy (không có runner), nên tự kiểm trước
khi bàn giao. Lấy ảnh chụp PR + Issue + comments bằng GitHub MCP, ghi ra JSON
rồi:

```bash
python3 scripts/workflow_guard.py --input <ảnh-chụp>.json
```

Mã `N3-LINK`, `N3-IMPL`, `N3-EVID`, `N1-*`, `WF-STATE` là **của bạn** — sửa ngay.

Mã `N2-GATE` ("chưa có nhãn `review:pass`") là **bình thường**: đó là cổng merge
do vai Reviewer mở. Không tự gắn nhãn, không tìm cách qua mặt nó.

Ngoại lệ duy nhất: **làn Routine mỗi giờ**, nơi `N2-GATE`/`N2-VERDICT` được miễn
bằng `gate:waived` theo đúng thủ tục ở mục "Làn Routine mỗi giờ". Miễn bằng nhãn
waive kèm lý do là đi đường tắt có ghi biển; tự gắn `review:pass` là giả chữ ký.
Hai việc đó không thay thế cho nhau.

### 8. Khi CI sống lại

Nếu `Build & Test` hoặc `Security Scan` chạy và đỏ, đó là việc của phiên này,
không đợi ai: tái hiện lỗi tại máy, sửa, chứng minh cổng xanh trở lại, rồi push.
Đỏ vì nguyên nhân ngoài PR (đỏ sẵn trên `main`) thì comment nêu rõ check nào, vì
sao không thuộc PR này, và fix đã port nếu có.

## Giới hạn mỗi phiên

Đúng **một** PR. Không gom nhiều Issue vào một PR, kể cả khi chúng liên quan —
mỗi Issue có acceptance criteria riêng và Reviewer phải verdict được từng cái.
