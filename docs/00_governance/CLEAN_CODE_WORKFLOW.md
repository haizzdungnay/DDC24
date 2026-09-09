# Quy trình Clean Code & Clean Documentation — MK-DDC-24

**ID:** `WF-CLEAN-001`
**Phiên bản:** 1.0
**Trạng thái:** Active
**Chủ quản:** CTO / Project Engineering
**Cập nhật:** 2026-09-09 (thiết lập ban đầu ba vai Manager/Implementer/Reviewer, quality gate, lịch chạy)

Tài liệu này là **authority duy nhất** cho quy trình dọn dẹp mã nguồn và tài liệu
DDC-24. Khi nội dung ở `AGENTS.md`, `CLAUDE.md` hoặc skill khác nhau, bản này đúng.

Nó **không** thay thế [`DOC-GOV-001`](DOC_GOVERNANCE.md) (quy tắc kiểm soát tài
liệu) và [`DOC-CTRL-001`](CONTROL.md) (thẩm quyền tài liệu). Hai hồ sơ đó quy
định *nội dung* phải đạt gì; hồ sơ này quy định *ai làm, khi nào, và qua cổng nào*.

---

## 1. Nguyên tắc bất di bất dịch

| # | Nguyên tắc | Cách thi hành |
|---|---|---|
| N1 | **Người tạo Issue không được tự implement.** | Issue mang `Manager-Run`; PR mang `Implementer-Run`. Guard CI chặn khi hai giá trị trùng nhau. |
| N2 | **Người implement không được tự merge.** | Merge chỉ mở khi có nhãn `review:pass` do vai Reviewer gắn, kèm comment verdict mang `Reviewer-Run` khác `Implementer-Run`. |
| N3 | **Mọi thay đổi trace được Issue → PR → Test → Merge → Close.** | Guard CI bắt buộc PR liên kết đúng một Issue bằng `Closes #N`, và bắt buộc khối Evidence có lệnh + số đo thật. |
| N4 | **Không có bằng chứng thì không có PASS.** | `NOT_RUN`/`BLOCKED` là trạng thái hợp lệ; ghi PASS mà không có số đo là vi phạm nghiêm trọng. |
| N5 | **Không mở rộng phạm vi ngoài Issue.** | Reviewer FAIL PR chạm file ngoài mục "Source ownership" của Issue mà không có Issue mới. |
| N6 | **Clean code không được đổi hành vi.** | PR gắn `wf:clean-code` phải giữ nguyên contract/API/schema; đổi hành vi ⇒ tách Issue `enhancement` riêng. |

---

## 2. Ba vai và quyền hạn

### 2.1 Manager/Planner — `role:manager`

- **Nhịp:** mỗi ngày **một lần** (03:00 UTC ≈ 10:00 giờ Việt Nam).
- **Việc:** rà repo + tài liệu, phát hiện nợ kỹ thuật/nợ tài liệu, tạo Issue có
  scope và acceptance criteria đo được, xếp ưu tiên, chuyển Issue sang `state:ready`.
- **Được phép:** tạo/sửa/đóng Issue, gắn nhãn `state:*`/`priority:*`/`wf:*`,
  gắn `state:blocked`, sắp thứ tự backlog.
- **Cấm tuyệt đối:** viết code hoặc sửa tài liệu sản phẩm, tạo PR, gắn `review:pass`, merge.
- **Đầu ra mỗi phiên:** tối đa **5** Issue `state:ready` mới, cộng một comment
  cập nhật thứ tự ưu tiên nếu backlog `state:ready` đã ≥ 10.

### 2.2 Implementer — `role:implementer`

- **Nhịp:** mỗi **1 giờ 30 phút** (16 lần/ngày).
- **Việc:** chọn Issue `state:ready` ưu tiên cao nhất, implement, chạy test, tự
  review, tạo PR kèm evidence.
- **Được phép:** tạo nhánh, commit, push, tạo PR, comment vào Issue mình đang
  làm, chuyển `state:ready` → `state:in-progress` → `state:in-review`, sửa PR
  theo yêu cầu Reviewer.
- **Cấm tuyệt đối:** tạo Issue mới cho chính mình rồi implement ngay trong cùng
  phiên; gắn `review:pass`; merge PR; đóng Issue; sửa nhãn `priority:*`.
- **Ngoại lệ N1:** khi phát hiện lỗi **trong phạm vi Issue đang làm** thì sửa
  luôn trong cùng PR (theo `AGENTS.md`). Lỗi **ngoài** phạm vi ⇒ mở Issue mới ở
  `state:triage` cho Manager phân loại, **không** tự implement.
- **Đầu ra mỗi phiên:** đúng **một** PR `state:in-review`, hoặc một comment nêu
  rõ blocker nếu không có Issue nào `state:ready`.

### 2.3 Reviewer / Merge Gatekeeper — `role:reviewer`

- **Nhịp:** mỗi ngày **một lần** (11:00 UTC ≈ 18:00 giờ Việt Nam).
- **Việc:** review từng PR `state:in-review`: đối chiếu acceptance criteria,
  kiểm evidence, kiểm regression, kiểm phạm vi.
- **Được phép:** post review verdict, gắn `review:pass` / `review:changes-requested`,
  merge PR, đóng Issue, xoá nhánh remote sau merge, hạ `state:*` về `state:ready`
  khi trả lại.
- **Cấm tuyệt đối:** tự sửa code trong PR đang review; merge PR có CI đỏ; merge
  PR không có Issue liên kết; merge PR do chính mình implement.
- **Đầu ra mỗi phiên:** với **mỗi** PR `state:in-review`, đúng một verdict
  `PASS` (merge + close Issue) hoặc `FAIL` (trả lại kèm danh sách sửa cụ thể).

### 2.4 Ma trận quyền

| Hành động | Manager | Implementer | Reviewer |
|---|---|---|---|
| Tạo Issue | ✅ | ⚠️ chỉ `state:triage` cho lỗi ngoài phạm vi | ⚠️ chỉ finding từ review |
| Gắn `state:ready` | ✅ | ❌ | ✅ khi trả lại |
| Gắn `priority:*` | ✅ | ❌ | ❌ |
| Viết code / sửa docs sản phẩm | ❌ | ✅ | ❌ |
| Tạo PR | ❌ | ✅ | ❌ |
| Gắn `review:pass` | ❌ | ❌ | ✅ |
| Merge PR | ❌ | ❌ | ✅ |
| Đóng Issue | ⚠️ chỉ khi huỷ/duplicate | ❌ | ✅ |

---

## 3. Workflow state

Trạng thái của Issue được biểu diễn bằng **đúng một** nhãn `state:*`.

```
                 Manager tạo
                      │
                      ▼
              ┌──────────────┐
              │ state:triage │  chưa đủ scope/AC — chờ Manager làm rõ
              └──────┬───────┘
                     │ Manager bổ sung scope + AC + Source ownership
                     ▼
              ┌──────────────┐        Manager phát hiện phụ thuộc/thiếu quyết định
              │ state:ready  │◀──────────────────┐   ┌──────────────────┐
              └──────┬───────┘                   └──▶│  state:blocked   │
                     │ Implementer nhận                └──────────────────┘
                     ▼                                  (ghi rõ chặn bởi gì,
           ┌────────────────────┐                        cần gì để mở khoá)
           │ state:in-progress  │
           └─────────┬──────────┘
                     │ PR mở, evidence đầy đủ
                     ▼
           ┌────────────────────┐   Reviewer FAIL    ┌──────────────────────────┐
           │  state:in-review   │───────────────────▶│ state:changes-requested  │
           └─────────┬──────────┘                    └────────────┬─────────────┘
                     │ Reviewer PASS                              │ Implementer sửa
                     ▼                                            │
              ┌──────────────┐                                    │
              │  state:done  │  merge + close Issue               │
              └──────────────┘                                    ▼
                                                        (quay lại state:in-review)
```

Bất biến: một Issue **không bao giờ** mang hai nhãn `state:*` cùng lúc. Guard CI
kiểm điều này ở mỗi lần chạy.

---

### 3.1 Vòng sửa lại — chuyện gì xảy ra khi Reviewer FAIL

FAIL không phải điểm kết thúc. Nó mở một vòng, và vòng đó phải khép lại được.

```
Reviewer FAIL
   │  PR   ← review:changes-requested   (Reviewer gắn)
   │  Issue ← state:changes-requested   (Reviewer chuyển, gỡ state:in-review)
   ▼
Implementer kế tiếp NHẬN LẠI chính PR đó
   │  state:changes-requested được ưu tiên TRƯỚC mọi Issue state:ready mới
   │  sửa theo danh sách "phải sửa", push lên CHÍNH nhánh cũ — không mở PR mới
   │  Issue ← state:in-review
   ▼
Reviewer review lại
   │  PASS ⇒ gỡ review:changes-requested, gắn review:pass, post verdict PASS
   │  FAIL ⇒ giữ review:changes-requested, post verdict FAIL mới
   ▼
merge, hoặc vòng tiếp theo
```

**Ai sửa lại.** Vai Implementer, ở **lượt chạy kế tiếp** — không phải cùng phiên
đã mở PR (phiên đó đã kết thúc). Đây là lý do skill `ddc-implementer` xếp
`state:changes-requested` **trên** mọi Issue mới: một PR đang chờ sửa có giá trị
hơn một PR mới mở, và một PR bị bỏ quên là công đã làm bị mất trắng.

**Nhánh và PR giữ nguyên.** Sửa lại thì push lên nhánh cũ của PR đó. Mở PR mới
làm đứt chuỗi verdict và Reviewer mất ngữ cảnh vòng trước.

**Chuỗi `Implementer-Run`.** Phiên sửa lại là một lượt chạy khác, nên nó **thêm**
một dòng `Implementer-Run` vào body PR chứ không ghi đè dòng cũ. Guard đọc dòng
đầu tiên để kiểm N1; các dòng sau là dấu vết ai đã chạm PR này.

**Gỡ nhãn cũ là việc của Reviewer.** Khi PASS ở vòng sau, Reviewer phải **gỡ**
`review:changes-requested` trước khi gắn `review:pass`. Hai nhãn cùng lúc là
trạng thái không đọc được, và guard chặn bằng mã `N2-LABEL` — chặn đúng, nhưng
việc cần làm là gỡ nhãn, không phải sửa code.

**Verdict cũ hết hiệu lực.** Guard đọc verdict **mới nhất**, không phải PASS gần
nhất. Một PASS ở vòng 1 đã bị FAIL ở vòng 2 phủ định thì không còn là giấy thông
hành; phải có verdict PASS mới sau khi sửa.

**Trần ba vòng.** Ba verdict FAIL trên cùng một PR thường có nghĩa là **Issue bị
scope sai**, không phải Implementer làm ẩu. Đến đó, guard in cảnh báo escalate và
Manager phải xem lại Issue: viết lại acceptance criteria, tách nhỏ, hoặc đóng
Issue và mở lại đúng phạm vi. Vòng thứ tư trên cùng một scope sai là lãng phí có
hệ thống. Cảnh báo này **không chặn merge** — chặn ở đó sẽ khoá luôn bản sửa
đang đúng.

**PR bỏ quên.** Một PR ở `review:changes-requested` quá **48 giờ** mà không có
push mới là việc của Manager ở lượt rà hằng ngày: hỏi Implementer lượt sau nhận
lại, hoặc đóng PR và trả Issue về `state:ready` nếu bản sửa không còn dùng được.
Không có ai khác canh việc này.

**Nếu sai sau khi đã merge.** Không sửa ngược vào Issue đã đóng. Mở finding mới
bằng `.github/ISSUE_TEMPLATE/03-finding.yml` ở `state:triage`, dẫn PR đã merge
làm nguồn. Issue đã đóng là bản ghi của một quyết định có ngày; sửa lại nó làm
mất dấu vết vì sao khi đó mọi người tưởng là xong.

## 4. Nhãn chuẩn

Nguồn chuẩn machine-readable: [`.github/labels.yml`](../../.github/labels.yml).
Workflow [`labels-sync.yml`](../../.github/workflows/labels-sync.yml) đồng bộ nhãn
lên GitHub (tạo/cập nhật, **không xoá** nhãn cũ đang dùng).

| Nhóm | Nhãn |
|---|---|
| Vai | `role:manager`, `role:implementer`, `role:reviewer` |
| Trạng thái | `state:triage`, `state:ready`, `state:in-progress`, `state:in-review`, `state:changes-requested`, `state:blocked`, `state:done` |
| Loại việc | `wf:clean-code`, `wf:clean-docs`, `wf:test-debt`, `wf:tooling` |
| Ưu tiên | `priority:critical`, `priority:high`, `priority:medium`, `priority:low` |
| Cổng review | `review:pass`, `review:changes-requested` — **loại trừ nhau**; hai nhãn cùng lúc bị guard chặn bằng `N2-LABEL` |
| Ngoại lệ | `gate:waived` (chỉ CTO gắn, bắt buộc kèm lý do trong comment) |

Nhãn chủ đề sẵn có (`programming-ui`, `point-io`, `st-editor`, `pgm04`,
`documentation`, `enhancement`, `question`) **giữ nguyên** và dùng bổ sung.

---

## 5. Quy tắc nhánh và merge

| Loại | Mẫu tên nhánh |
|---|---|
| Clean code | `clean/code/<issue-number>-<slug>` |
| Clean docs | `clean/docs/<issue-number>-<slug>` |
| Nợ test | `clean/test/<issue-number>-<slug>` |
| Tooling/CI | `clean/tooling/<issue-number>-<slug>` |

- Nhánh đích luôn là `main`. Không tạo nhánh dài hạn khác.
- Một nhánh phục vụ **đúng một** Issue.
- Commit theo Conventional Commits, **thân bài tiếng Việt** nêu
  *triệu chứng → nguyên nhân gốc → cách sửa*, có `Refs:` dẫn Issue và tài liệu.
- Merge bằng **squash merge**, tiêu đề squash giữ `(#<issue>)`.
- Xoá nhánh remote ngay sau merge.
- Không force-push lên nhánh người khác đang review.

### 5.1 Branch protection cần bật trên `main`

Đây là cấu hình **thủ công** ở `Settings → Branches` (chỉ owner/admin làm được):

- [ ] Require a pull request before merging.
- [ ] Require status checks to pass: `Build & Test`, `Security Scan`,
      `Cổng quy trình clean-code` (job `workflow-guard`).
- [ ] Require branches to be up to date before merging.
- [ ] Require conversation resolution before merging.
- [ ] Block force pushes; block deletions.
- [ ] Với reviewer **người thật**: bật *Require approvals ≥ 1* và
      *Dismiss stale approvals*.

> **Giới hạn đã biết — đọc kỹ.** Cả ba vai agent hiện chạy dưới **cùng một
> danh tính GitHub** (`Mekong-HCM`). GitHub không cho một tài khoản approve PR do
> chính nó tạo, nên **không** dùng được cổng *Require approvals* làm rào tách vai
> cho agent. Vì vậy N2 được thi hành bằng nhãn `review:pass` + comment verdict
> mang `Reviewer-Run` khác `Implementer-Run`, do job `workflow-guard` kiểm.
> Muốn có rào **native** của GitHub thì phải cấp một danh tính riêng
> (machine user hoặc GitHub App) cho vai Reviewer — việc này cần quyền tổ chức,
> hiện **chưa làm được từ phiên agent**. Xem `§9 Hạng mục bị chặn`.

---

## 6. Quality gate

### 6.1 Cổng tự động — **hiện KHÔNG chạy**

> **GitHub Actions của tổ chức không cấp runner** (billing — [#414](https://github.com/Mekong-HCM/MK-DDC-24/issues/414)).
> Job không bao giờ khởi động: chúng hỏng sau 2–3 giây với 0 step. Run gần nhất
> trên `main` là 2026-09-04; merge sau đó không sinh run nào.
>
> Hệ quả phải nói thẳng: **`Build & Test`, `Security Scan` và `Cổng quy trình
> clean-code` đều là `NOT_RUN`.** Một PR "không có check đỏ" hiện nay không có
> nghĩa là nó xanh — nghĩa là chưa ai kiểm. Không được đọc trạng thái trống
> thành PASS.
>
> Các file workflow **được giữ nguyên trong repository**, không xoá: chúng đúng
> và sẽ tự sống lại khi billing được xử lý. Cho tới lúc đó, cổng chuyển sang
> chạy tay theo §6.1a và §6.2.

| Cổng | Workflow / lệnh | Trạng thái hiện tại |
|---|---|---|
| Kiến trúc repository | `scripts/verify-project.sh --component layout` | `NOT_RUN` — không runner |
| C++ 5 profile + GoogleTest | `Build & Test` job `som-services` | `NOT_RUN` — không runner |
| Go vet + test race | `--component go --profile race` | `NOT_RUN` — không runner |
| FE vitest + lint + build | `--component frontend` | `NOT_RUN` — không runner |
| E2E mock + real backend | `--component e2e`, `e2e-real` | `NOT_RUN` — không runner |
| MCU firmware | `--component firmware` | `NOT_RUN` — không runner |
| ASan/UBSan, fuzz smoke | `Build & Test` | `NOT_RUN` — không runner |
| Bảo mật | `Security Scan` | `NOT_RUN` — không runner |
| Quy trình clean-code | `scripts/workflow_guard.py` | **chuyển sang offline, xem §6.1a** |

### 6.1a Cổng quy trình chạy offline — thay thế job CI

Cổng tách vai là thứ **không được phép mất** cùng với CI: nếu nó nghỉ thì N1 và
N2 chỉ còn là chữ trong tài liệu. Vì vậy `workflow_guard.py` có chế độ chạy
không cần Actions, không cần token, không cần mạng:

```bash
python3 scripts/workflow_guard.py --input <ảnh-chụp>.json
```

Ảnh chụp do chính vai đang làm lấy bằng GitHub MCP (`pull_request_read`,
`issue_read`, comments) rồi ghi ra file:

```json
{
  "pr":       {"number": 601, "body": "...", "labels": [{"name": "review:pass"}]},
  "issue":    {"number": 600, "body": "...", "labels": [{"name": "state:in-review"}]},
  "comments": [{"body": "[REVIEW-VERDICT: PASS]\nReviewer-Run: rev-1", "user": {"login": "r"}}]
}
```

Chế độ này **không nới lỏng gì**: nó gọi đúng `check()` và `apply_waiver()` mà
job CI gọi, nên phán quyết giống hệt. Khác biệt duy nhất là ai đi lấy dữ liệu.

| Ai chạy | Khi nào | Ý nghĩa |
|---|---|---|
| Implementer | trước khi mở PR, và sau khi mở PR bằng chính số PR đó | tự kiểm N3 — thiếu `Closes`, thiếu `Implementer-Run`, Verification rỗng |
| Reviewer | **trước khi merge**, sau khi đã gắn `review:pass` và post verdict | thi hành N1 + N2; exit code khác 0 ⇒ **cấm merge** |

Reviewer phải dán nguyên văn output của guard vào comment verdict. Không có
output đó thì verdict chưa hoàn tất — đây là cách duy nhất còn lại để chứng minh
cổng đã chạy khi CI không để lại dấu vết nào.

> **Cổng không tự vô hiệu hoá được.** Job thi hành chạy bản
> `scripts/workflow_guard.py` trên **nhánh mặc định**, không phải bản trong PR:
> nếu lấy bản của PR thì một PR chỉ cần sửa guard thành luôn trả về 0 là tự mở
> cổng cho chính nó. Bản guard bị sửa vẫn được kiểm — nhưng ở job
> `guard-selftest`, chạy trước và chạy đúng bản của PR. Trong lúc CI ngủ, lớp
> bảo vệ tương đương là: Reviewer chạy guard từ **cây làm việc trên `main`**, không
> phải từ nhánh PR, và `scripts/workflow_guard.py` nằm trong CODEOWNERS.

### 6.2 Cổng do Implementer chạy tại máy **trước khi** mở PR

Bắt buộc theo phạm vi đã chạm — ghi số đo thật vào PR, **không dẫn lại số cũ**:

```bash
# C++ — bật cả ba option, HMI mặc định OFF nên rất dễ bỏ sót gate
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

Đọc **exit code của cả configure lẫn build**: build dir cũ còn
`CMAKE_HOME_DIRECTORY` trỏ `services/` đã xoá sẽ làm configure + build hỏng
nhưng `ctest` vẫn chạy binary cũ và báo "pass" — số đo giả (sự cố 2026-08-07).

### 6.3 Cổng do Reviewer kiểm bằng tay

- [ ] Từng acceptance criteria của Issue có bằng chứng chỉ tới được (test name,
      số đo, đường dẫn file evidence).
- [ ] Không có file nào ngoài "Source ownership" của Issue bị chạm.
- [ ] `wf:clean-code` không đổi contract/API/schema/hành vi.
- [ ] `CHANGELOG.md` `[Unreleased]` đã cập nhật với ngày, phạm vi, số đo.
- [ ] Không có test bị skip/disable/quarantine để lấy màu xanh.
- [ ] Không nâng evidence HOST/MOCK thành TARGET/HIL/release.
- [ ] Commit message nêu được *vì sao*, không chỉ *cái gì*.

Chỉ cần **một** mục FAIL ⇒ verdict `FAIL`, gắn `review:changes-requested`, trả lại.

---

## 7. Truy xuất Issue → PR → Test → Merge → Close

Mỗi mắt xích là một trường bắt buộc, guard CI kiểm được:

| Mắt xích | Nơi ghi | Trường |
|---|---|---|
| Issue | body Issue | `Manager-Run: <định danh phiên Manager>` |
| PR ↔ Issue | body PR | `Closes #<issue>` |
| PR ↔ người làm | body PR | `Implementer-Run: <định danh phiên Implementer>` |
| Test | body PR, mục `## Kiểm chứng` | bảng lệnh + số đo thật |
| Merge | comment verdict trên PR | `[REVIEW-VERDICT: PASS]` + `Reviewer-Run: <id>` |
| Close | Issue đóng tự động bởi `Closes #N` | nhãn `state:done` |

`<định danh phiên>` là URL phiên agent hoặc `<vai>-<YYYYMMDDThhmmZ>`. Điều kiện
duy nhất: **giá trị của ba vai phải khác nhau trên cùng một chuỗi Issue→PR**.

**Cách lấy định danh của chính mình:** gọi `get_session` **bỏ trống `session_id`**
— nó mô tả chính phiên đang chạy; URL là `https://claude.ai/code/<ccr.id>`.

**Tuyệt đối không chép lại một định danh có sẵn trong Issue hoặc PR** — đó là của
phiên khác. Guard chỉ đọc dòng `Implementer-Run` **đầu tiên** để kiểm N1, nên một
dòng thứ hai ghi sai **không bị cổng nào bắt** và chỉ mất khi có người đọc. Lỗi
này đã xảy ra thật ở vòng sửa lại PR #594 (2026-09-09): phiên rework ghi lại
session id của phiên vòng 1, làm mất dấu người sửa vòng 2.

---

## 8. Lịch chạy

| Routine | Vai | Cron (UTC) | Giờ Việt Nam | Trigger ID |
|---|---|---|---|---|
| DDC-24 · Manager/Planner | Manager | `0 3 * * *` | ~10:00 mỗi ngày | `trig_01VLb9Q9b8BPKHuPAHcLFRWA` |
| DDC-24 · Implementer A | Implementer | `5 0,3,6,9,12,15,18,21 * * *` | 07:05, 10:05, 13:05, 16:05, 19:05, 22:05, 01:05, 04:05 | `trig_01B7dwHh85Y4QxMB8KoDAx7M` |
| DDC-24 · Implementer B | Implementer | `35 1,4,7,10,13,16,19,22 * * *` | 08:35, 11:35, 14:35, 17:35, 20:35, 23:35, 02:35, 05:35 | `trig_01XQwkLiyWPQmeh6Sb5H4qXf` |
| DDC-24 · Reviewer/Merge Gatekeeper | Reviewer | `0 11 * * *` | ~18:00 mỗi ngày | `trig_01VPsiXuQm4avWwct4VjAUNf` |

Nhịp 90 phút không biểu diễn được bằng một biểu thức cron 5 trường, nên vai
Implementer dùng **hai** Routine chu kỳ 3 giờ lệch nhau đúng 90 phút: A ở phút
05 của giờ chẵn-3, B ở phút 35 của giờ lệch. Ghép lại được 16 lượt/ngày, khoảng
cách đều 90 phút.

Phút của Routine chạy theo giờ được server neo vào phút tạo, nên lịch hằng ngày
có thể lệch vài phút so với cron ghi ở trên. Hai Routine Implementer dùng phút
khác 0 nên được lưu nguyên văn và giữ đúng khoảng cách 90 phút.

Mỗi Routine mở **phiên mới** khi kích hoạt. Đó là điều kiện của tách vai: phiên
mới cho định danh `*-Run` mới, nên hai vai không bao giờ chia sẻ một lượt chạy.
Sửa lịch bằng `update_trigger`, tạm dừng bằng `enabled: false`, xoá bằng
`delete_trigger`.

### 8.1 Routine phải được cấp `sources` — bẫy đã dính một lần

Một Routine không có `sources` sẽ sinh ra **phiên rỗng**: không repository, không
skill, không công cụ GitHub. Vai được đánh thức nhưng không đọc được luật của
chính nó và không chạm được vào Issue nào.

Đây không phải giả thuyết. Lượt Manager đầu tiên (2026-09-09) chạy đúng như vậy
và **không tạo được Issue nào**: phiên báo không có `mcp__github__*`, `git clone`
lỗi xác thực, và skill `ddc-manager-planner` không tồn tại ở đâu truy cập được.
Nó **từ chối bịa** kết quả — đó là hành vi đúng, và cũng là thứ duy nhất khiến sự
cố này lộ ra thay vì trôi qua thành một báo cáo trông có vẻ ổn.

Nguyên nhân: tool `create_trigger` **không có tham số `sources` và không kế thừa**
`sources` từ phiên gọi. `update_trigger` chỉ sửa được `name`, `cron_expression`,
`enabled`, `model` và `prompt` — **không sửa được `sources`**. Một Routine tạo
thiếu `sources` vì thế **không vá được**, chỉ tạo lại.

| Cách tạo Routine | Có `sources`? | Ghi chú |
|---|---|---|
| Giao diện Routines trên claude.ai | ✅ chọn repo và connector khi tạo | **Cách đúng cho vận hành thường xuyên** |
| `create_session(source_url=…)` rồi bind bằng `create_trigger(persistent_session_id=…)` | ✅ | Phiên bền tích luỹ ngữ cảnh; chấp nhận được với nhịp 1 lần/ngày, **không** hợp với nhịp 90 phút |
| `create_trigger(create_new_session_on_fire=true)` | ❌ | Phiên rỗng — chính là bẫy này |

**Mỗi prompt Routine phải mở đầu bằng một bước kiểm môi trường** và dừng hẳn khi
thiếu, thay vì cố làm tiếp:

```
0. ls docs/00_governance/CLEAN_CODE_WORKFLOW.md .claude/skills/<vai>/SKILL.md
   Có tool mcp__github__* không?
   Thiếu bất kỳ thứ nào ⇒ DỪNG, báo đúng thứ đang thiếu, không bịa.
```

Báo cáo "không chạy được vì thiếu X" là kết quả đúng và dùng được. Báo cáo bịa
một lượt review hoặc một Issue chưa từng tồn tại thì hỏng nặng hơn không chạy —
vì nó làm hỏng chính chuỗi bằng chứng mà quy trình này sinh ra để bảo vệ.

**Skill trong repository thắng prompt của Routine khi hai bên mâu thuẫn.** Prompt
Routine là cấu hình ngoài repo, sửa được lặng lẽ và không để lại dấu vết; skill
đi qua PR và review. Cụ thể hiện nay: prompt Routine của vai Reviewer còn câu
"đợi job `Cổng quy trình clean-code` xanh rồi merge", viết trước sự cố runner —
skill `ddc-reviewer` ghi đè câu đó bằng cổng offline `§6.1a`.

Mỗi Routine chạy đúng một skill vai:

- Manager → `.claude/skills/ddc-manager-planner/SKILL.md`
- Implementer → `.claude/skills/ddc-implementer/SKILL.md`
- Reviewer → `.claude/skills/ddc-reviewer/SKILL.md`

Skill nằm trong repository nên đổi quy trình = sửa file + PR, không phải sửa
cấu hình ẩn ở đâu đó.

---

## 9. Hạng mục bị chặn

| Hạng mục | Bị chặn bởi | Cần gì để mở khoá |
|---|---|---|
| Cổng *Require approvals* native của GitHub cho agent | Ba vai dùng chung tài khoản `Mekong-HCM`; GitHub cấm tự approve PR của mình | Cấp machine user hoặc GitHub App riêng cho vai Reviewer, thêm vào repo với quyền `write` |
| Bật branch protection trên `main` | Cần quyền admin repo qua giao diện `Settings → Branches`; API branch-protection không có trong tool set của phiên agent | Owner bật thủ công theo checklist `§5.1` |
| Bốn Routine hiện có (`trig_01VLb9…`, `trig_01B7dw…`, `trig_01XQwk…`, `trig_01VPsi…`) sinh phiên rỗng | Được tạo bằng `create_trigger`, vốn không cấp `sources`; `update_trigger` không sửa được trường đó | Tạo lại Routine từ giao diện Routines trên claude.ai, chọn repo `Mekong-HCM/MK-DDC-24` và connector GitHub, rồi xoá bốn Routine cũ bằng `delete_trigger`. Xem `§8.1`. |
| Toàn bộ cổng CI (`Build & Test`, `Security Scan`, job `workflow-guard`) | GitHub Actions của tổ chức không cấp runner — billing (#414) | Xử lý `Billing & plans` của tổ chức `Mekong-HCM`. **Không có phần thay thế bằng phần mềm** cho build/test đa nền tảng; §6.1a chỉ thay được cổng quy trình, không thay được cổng biên dịch và test. |

---

## Lịch sử sửa đổi

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-09-09 | Thiết lập ban đầu: ba vai, ma trận quyền, workflow state, nhãn, branch/merge rule, quality gate, truy xuất và lịch chạy. |
