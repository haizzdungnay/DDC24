# Quy trình Clean Code & Clean Documentation — MK-DDC-24

**ID:** `WF-CLEAN-001`
**Phiên bản:** 1.5
**Trạng thái:** Active
**Chủ quản:** CTO / Project Engineering
**Cập nhật:** 2026-09-16 (`§6.2`: thêm cổng `scripts/verify-project.sh --component bacnet` — bản thi hành `ADR-060` điều (4), bắt buộc cho PR chạm `apps/iobus/adapters/bacnet/**`; xem bảng Lịch sử sửa đổi cuối hồ sơ để biết đầy đủ các bản 1.1–1.5)

Tài liệu này là **authority duy nhất** cho quy trình dọn dẹp mã nguồn và tài liệu
DDC-24. Khi nội dung ở `AGENTS.md`, `CLAUDE.md` hoặc skill khác nhau, bản này đúng.

Nó **không** thay thế [`DOC-GOV-001`](DOC_GOVERNANCE.md) (quy tắc kiểm soát tài
liệu) và [`DOC-CTRL-001`](CONTROL.md) (thẩm quyền tài liệu). Hai hồ sơ đó quy
định *nội dung* phải đạt gì; hồ sơ này quy định *ai làm, khi nào, và qua cổng nào*.

---

## 1. Nguyên tắc bất di bất dịch

| # | Nguyên tắc | Cách thi hành |
|---|---|---|
| N1 | **Người tạo Issue không được tự implement.** | Issue mang `Manager-Run`; PR mang `Implementer-Run`. Guard CI chặn khi hai giá trị trùng nhau (`N1-SELF`). Với Issue vào bằng mẫu finding, người **tạo** là người phát hiện chứ không phải Manager, nên Issue mang thêm `Finder-Run` và guard chặn khi nó trùng `Implementer-Run` (`N1-FINDER`). |
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

### 3.2 Triage một finding — bước không được quên

Issue vào bằng `.github/ISSUE_TEMPLATE/03-finding.yml` có **hai** định danh
phiên, thuộc hai người khác nhau:

| Trường | Ai điền | Khi nào |
|---|---|---|
| `Finder-Run` | Implementer/Reviewer phát hiện lỗi | lúc mở finding |
| `Manager-Run` | **Manager** | lúc triage finding lên `state:ready` |

Ô `Manager-Run` của mẫu finding **để trống khi mở**. Manager điền nó ở đúng lượt
cho scope, acceptance criteria, Source ownership và `priority:*`. Trước lúc đó
guard chặn mọi PR thực hiện finding bằng `N1-MGR` — đó là trạng thái **đúng**,
không phải hỏng: một finding chưa qua tay Manager thì chưa có scope để implement.

Ba điều dễ làm sai, cả ba đều có cổng hoặc dấu vết:

1. **Người mở finding tự điền `Manager-Run` của mình.** Đó là bịa ra một lượt
   triage chưa từng xảy ra, cùng loại với tự gắn `review:pass`. Guard ghi
   `CẢNH BÁO triage` khi `Manager-Run` trùng `Finder-Run`; cảnh báo này **không**
   chặn merge (Manager tự phát hiện rồi tự triage là ca hợp lệ), nên Reviewer
   phải tự xác nhận đã có một lượt Manager thật.
2. **Người mở finding tự implement nó.** Guard chặn bằng `N1-FINDER`, kể cả khi
   PR đã có `review:pass` và kể cả khi PR mang `gate:waived` — `gate:waived` chỉ
   miễn `N2-GATE`/`N2-VERDICT` (§8.4).
3. **Finding mở trước 2026-09-11** mang nhãn cũ `Phát hiện bởi (vai + định danh
   phiên)` và thường ghi cả mô tả vai lẫn định danh trên một dòng. Guard đọc
   được cả nhãn cũ và tự rút định danh phiên ra khỏi phần mô tả, nên các finding
   đó vẫn nằm trong tầm cổng; Manager vẫn phải thêm một dòng `Manager-Run: <id>`
   vào body khi triage chúng.

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
| Làn Routine Implementer mỗi giờ (§8.4) | `clean-code/issue-<issue-number>` |

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

> **GitHub Actions của tổ chức không cấp runner** (billing — [#414](https://github.com/Mekong-HCM/MK-DDC-24/issues/414)),
> và chủ sở hữu **đã quyết định không bật lại** (2026-09-09). Đây là **một quyết
> định thường trực**, không phải sự cố chờ khắc phục — mọi câu chữ trong hồ sơ
> này phải viết theo đúng nghĩa đó.
>
> Job không bao giờ khởi động: chúng hỏng sau 2–3 giây với 0 step. Run gần nhất
> trên `main` là 2026-09-04; mọi merge sau đó không sinh run nào.
>
> Hệ quả phải nói thẳng: **`Build & Test`, `Security Scan` và `Cổng quy trình
> clean-code` đều là `NOT_RUN` — lâu dài.** Một PR "không có check đỏ" không có
> nghĩa là nó xanh; nghĩa là **chưa ai kiểm**. Không được đọc trạng thái trống
> thành PASS, và không được chờ nó đổi.
>
> **Bảng Verification do Implementer tự đo là lớp kiểm chứng DUY NHẤT** trước khi
> mã vào `main`, và sẽ còn như vậy. Vai Reviewer vì thế mang trách nhiệm nặng
> hơn thiết kế ban đầu: nghi ngờ số đo thì phải **tự chạy lại**, không có lưới
> đỡ nào phía sau.
>
> Các file workflow **được giữ nguyên trong repository**, không xoá: chúng đúng,
> chi phí giữ bằng không, và nếu quyết định trên thay đổi thì chúng dùng lại
> được ngay. Giữ chúng **không** hàm ý sẽ bật lại.

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

**Selftest của guard nay chạy được offline** (từ 2026-09-11, `#593`). Trước đó
`python3 scripts/workflow_guard.py --selftest` chỉ tồn tại trong job
`guard-selftest` của `.github/workflows/workflow-guard.yml`, nên khi Actions
không có runner (`#414`) thì chính `scripts/workflow_guard.py` — file mà N1 và N2
dựa vào — là mã không cổng nào bảo vệ lúc nó bị sửa. §6.1a trên đây đã chuyển
phần *phán quyết* sang `--input`, nhưng phần *selftest* bị bỏ quên.

```bash
scripts/verify-project.sh --component workflow   # == python3 scripts/workflow_guard.py --selftest
```

**Ai chạm `scripts/workflow_guard.py` thì bắt buộc chạy lệnh này và dán số đo
vào PR hoặc comment verdict** — Implementer khi sửa guard, Reviewer khi review
một PR có sửa guard. Đây là thứ thay cho quan hệ `needs: guard-selftest` mà CI
đang không thi hành được; chạy guard `--input` từ cây `main` vẫn giữ nguyên,
hai lớp này không thay thế cho nhau.

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

# Tài liệu — == scripts/verify-project.sh --component docs
python3 scripts/docs_iso_harness.py --expect

# Logic của chính cổng tách vai — BẮT BUỘC khi PR chạm scripts/workflow_guard.py
# == scripts/verify-project.sh --component workflow
python3 scripts/workflow_guard.py --selftest

# BACnet — BẮT BUỘC khi PR chạm apps/iobus/adapters/bacnet/** (ADR-060 điều 4)
scripts/verify-project.sh --component bacnet
```

Hai cổng `docs` và `workflow` có đường chạy qua `scripts/verify-project.sh` từ
2026-09-11 (`#593`); trước đó `rg 'docs_iso_harness|workflow_guard'
scripts/verify-project.sh` trả về rỗng, nên không lệnh nào gom đủ bộ cổng offline
và người kiểm phải nhớ ba lệnh rời ở ba nơi tài liệu khác nhau.

**Cổng `bacnet` (`#628`, `T-BAC-012`) là bản thi hành của `ADR-060` điều (4):**
*"cấu hình `BACNET=OFF` không được là đường build duy nhất được kiểm"*. PR nào
chạm `apps/iobus/adapters/bacnet/**` **bắt buộc** dẫn số đo của lệnh này; khối
`cmake`/`ctest` ở đầu mục này **không thay thế được** nó, vì nó chỉ dựng host và
không khẳng định điều gì về việc bacnet-stack có thật sự được biên dịch vào hay
không.

Cổng chạy bốn tầng, mỗi tầng bịt một lỗ mà ba tầng kia không thấy:

| Tầng | Kiểm cái gì | Bắt được điều gì mà tầng khác không bắt |
|---|---|---|
| 1 | HOST `BACNET=ON`: dựng + toàn bộ `ctest` (gọi lại `--component cpp --profile full`) | hồi quy hành vi thường |
| 2 | symbol `bip_init` phải có trong `mkddc-iobus` host | bản `BACNET=OFF` dựng trót lọt, xanh trọn vẹn, và **không có BACnet** |
| 3 | tầng `LOOPBACK` (`#626`) phải chạy thật, không `SKIP` | `ctest` báo `Passed` cho một ca `GTEST_SKIP()` — SKIP không phân biệt được với PASS trong bảng kết quả |
| 4 | cross aarch64 `BACNET=ON` + ba cổng kiểm binary (gọi lại `scripts/cross_build_aarch64_bacnet.sh` của `#627`) | GLIBCXX vượt trần / `NEEDED` lạ — hai lỗi chỉ lộ ra lúc bo khởi động |

Vì sao tầng 2 và tầng 3 không phải là cẩn thận thừa, đo được ngày 2026-09-16:
tiêm một mutant gỡ `target_compile_definitions(... MKDDC_ENABLE_BACNET)` rồi chạy
lại cổng thì tầng 1 báo **1482/1482 PASS** trên một sản phẩm hoàn toàn không có
BACnet — đúng sự cố 1440/1440 ngày 2026-09-10 — và **tầng 2 là thứ duy nhất bắt
được** (`exit=1`, "không thấy symbol `bip_init`").

Hai điều kiện để chạy cổng này, nói rõ vì chúng là lý do nó **không** nằm trong
`--component all`:

```bash
# một lần trên máy build x86_64 — tầng 4 cần cross toolchain aarch64
sudo dpkg --add-architecture arm64      # kho arm64 ở ports.ubuntu.com
sudo apt-get update
sudo apt-get install -y g++-aarch64-linux-gnu libmodbus-dev:arm64 libsodium-dev:arm64
```

Thiếu toolchain thì cổng **đỏ** kèm đúng lệnh phải chạy, **không** bỏ qua im
lặng: một tầng tự tàng hình khi thiếu công cụ tái tạo đúng vấn đề `ADR-060` cấm.

Job `bacnet-on-gate` trong `.github/workflows/build-and-test.yml` khai lại đúng
các bước này, nhưng trạng thái của nó là `NOT_RUN (#414)` — tổ chức không cấp
runner. **Lệnh tại máy ở trên là lớp thi hành duy nhất**; không ghi `PASS` cho
job CI đó trong bất kỳ bảng Verification nào.

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
| Issue dạng finding | body Issue | thêm `Finder-Run: <định danh phiên đã phát hiện>` — xem §3.2 |
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

> **Trạng thái 2026-09-10: hai Routine đang chạy thật.** Kết luận cũ ("không
> tạo được Routine từ phiên agent", §8.1) chỉ còn đúng cho ba cơ chế đã đo ở
> đó. Cơ chế thứ tư — **điều phối qua phiên bền** — chạy được và đang chạy
> (§8.1a).

| Routine | Trigger | Lịch | Phiên điều phối | Prompt |
|---|---|---|---|---|
| Clean Code Auditor (Manager) | `trig_01Gt1weroASWGntFuTVZWCBK` | `0 23 * * *` UTC ≈ 06:00 VN | `session_01D1pwCB4f6o6DrcFq88djCc` | §8.3 |
| Clean Code Implementer | `trig_01GqDKDuHc5iV6dKGq86DL93` | mỗi giờ, phút `:00` VN | `session_01R1Ga52pakcTifHxCmRd3ty` | §8.4 |

Vai Reviewer/Gatekeeper **chưa có Routine** — vẫn chạy tay. Lịch mục tiêu khi
dựng nốt:

| Vai | Nhịp | Cron (UTC) | Giờ Việt Nam | Trạng thái |
|---|---|---|---|---|
| Manager/Auditor | 1 lần/ngày | `0 23 * * *` | ≈06:00 | đang chạy (§8.3) |
| Implementer | mỗi giờ | `0 * * * *` | phút `:00` mọi giờ | đang chạy (§8.4) |
| Reviewer/Gatekeeper | 1 lần/ngày | `0 11 * * *` | ≈18:00 | chưa dựng |

Làn Implementer mỗi giờ **thay thế** phương án cũ "hai Routine chu kỳ 3 giờ lệch
nhau 90 phút". Nhịp 90 phút không biểu diễn được bằng một biểu thức cron 5
trường nên trước đây phải tách đôi; nhịp 1 giờ biểu diễn được trực tiếp, và
khoá thực thi (§8.4) mới là thứ chặn hai Implementer chồng nhau, chứ không phải
khoảng cách trong lịch.

**Phút của Routine chạy theo giờ bị server neo vào thời điểm gọi
`create_trigger`/`update_trigger`, không phải vào trường phút của cron.** Đo
2026-09-10: tạo lúc `03:06:31Z` với `0 0-23 * * *` cho `next_run_at`
`04:04:19Z`; gọi `update_trigger` lúc `03:06:56Z` với danh sách 24 giờ viết
tường minh cho `04:06:44Z`. Viết `0-23` hay liệt kê đủ 24 giờ đều không né được
heuristic. Cách duy nhất lấy đúng phút `:00`: gọi `update_trigger` **trong đúng
phút `:00` UTC** để mốc neo rơi vào phút đó — Việt Nam lệch UTC đúng 7 giờ tròn
nên phút UTC bằng phút giờ Việt Nam.

**Mỗi vai phải có phiên riêng.** Đó là điều kiện của tách vai: định danh `*-Run`
lấy từ phiên đang chạy, nên hai vai dùng chung một phiên sẽ cho cùng một định
danh và guard chặn bằng `N1-SELF`/`N2-SELF`.

Skill nằm trong repository nên đổi quy trình = sửa file + PR, không phải sửa
cấu hình ẩn ở đâu đó:

- Manager → `.claude/skills/ddc-manager-planner/SKILL.md`
- Implementer → `.claude/skills/ddc-implementer/SKILL.md`
- Reviewer → `.claude/skills/ddc-reviewer/SKILL.md`

**Skill trong repository thắng prompt của Routine khi hai bên mâu thuẫn.** Prompt
Routine là cấu hình ngoài repo, sửa được lặng lẽ và không để lại dấu vết; skill
đi qua PR và review.

### 8.1 Vì sao không tạo được Routine từ phiên agent — ba cơ chế, ba lần đo

Không phải giả thuyết. Ngày 2026-09-09 đã thử đủ ba cơ chế mà tool cho phép, và
**cả ba đều hỏng**. Ghi lại đây vì người kế tiếp sẽ thử lại đúng ba cơ chế đó.

| # | Cơ chế | Kết quả đo | Bằng chứng |
|---|---|---|---|
| 1 | `create_trigger(create_new_session_on_fire=true)` | Phiên sinh ra **không repo và không MCP tool** | Lượt Manager 07:01Z báo `git clone` lỗi xác thực, không có `mcp__github__*`, skill không tồn tại. Cấu hình trigger: `sources: []`, `mcp_servers: []`, `mcp_connections: []` |
| 2 | Cơ chế 1 + bootstrap `add_repo` trong prompt | **Không thể** — `add_repo` chính là một MCP tool, mà phiên không có MCP tool | Lượt Manager 09:35Z báo toàn bộ `mcp__Claude_Code_Remote__*` và `mcp__github__*` vắng mặt |
| 3 | `create_session(source_url=…)` + `create_trigger(persistent_session_id=…)` | Phiên bền **có** đủ repo + MCP, nhưng Routine bắn vào **không đánh thức được nó** | Phiên bền chạy tay thành công (gọi thật `list_issues`, trả về 4 Issue `state:ready`). Trigger bắn 09:50:38Z; phiên giữ nguyên `updated_at 09:40:40Z`, `used_tokens 76.931` không đổi, `post_turn_summary` vẫn của lượt trước, `status: IDLE`, `connection_status: disconnected`; trigger **không** ghi `last_run`. Issue được giao xử lý không hề bị chạm |

Kết luận: **`update_trigger` chỉ sửa được `name`, `cron_expression`, `enabled`,
`model`, `prompt` — không sửa được `sources` hay `mcp_servers`.** Một Routine
tạo thiếu hai thứ đó không vá được bằng bất kỳ prompt nào, vì mọi đường vá đều
cần một tool mà phiên đó không có.

Ba lần đo trên tốn bốn phiên. Bài học rẻ hơn nhiều nếu đọc kỹ **cảnh báo mà
chính `create_trigger` trả về ngay lần gọi đầu**:

> *"this trigger stores no MCP connectors, so the sessions it fires will run
> without connector (`mcp__<server>__*`) tools … If the routine needs connectors,
> create it from a session that holds them, or ask the user to create it from the
> claude.ai routines UI."*

Cảnh báo đó nói đúng kết luận cuối cùng, ngay từ đầu.

Kết luận ghi ngày 2026-09-09 là "cách duy nhất còn lại: tạo Routine từ giao diện
Routines trên claude.ai". Kết luận đó **quá hẹp** — xem §8.1a.

### 8.1a Cơ chế thứ tư — điều phối qua phiên bền — CHẠY ĐƯỢC

Ba cơ chế ở §8.1 hỏng vì cùng một nguyên nhân: chúng cố làm cho **phiên do
Routine sinh ra** tự có repo + MCP. Cơ chế thứ tư không cố làm việc đó. Nó tách
đôi:

1. Một **phiên điều phối** (phiên bền, do người tạo từ claude.ai nên có sẵn repo
   + connector GitHub + MCP `Claude_Code_Remote`).
2. Routine `create_trigger(persistent_session_id=<phiên điều phối>)` bắn một
   lượt vào phiên đó.
3. Phiên điều phối **không làm việc của vai**. Nó gọi
   `create_session(source_url=…, source_revision=main, prompt=<prompt của vai>)`
   rồi kết thúc. Phiên con sinh ra theo đường này **có** repo và **có** MCP.

Điểm khác với cơ chế 3 ở §8.1 (cũng dùng `persistent_session_id` nhưng đo là
"không đánh thức được phiên"): lần đo đó thất bại thật, nhưng lần đo
2026-09-09 lúc `23:01:43Z` thì thành công — trigger ghi `last_run` `SUCCEEDED`
và phiên con `session_01Gu2MPNGiCA7yjVY97hixbC` ("Clean Code Auditor —
2026-09-10") ra đời lúc `23:04:30Z` với `parent_session_id` đúng bằng phiên điều
phối, rồi mở thật các Issue #604–#608. Đó là bằng chứng chạy được, không phải suy
đoán.

**Hai ràng buộc phải giữ, nếu không cơ chế này hỏng lặng lẽ:**

- *Phiên điều phối tuyệt đối không làm việc của vai.* Nó chạy lại mỗi lượt nên
  tích ngữ cảnh của mọi lượt trước; và định danh `*-Run` lấy từ phiên đang chạy,
  nên nếu nó tự làm thì mọi lượt sẽ mang **cùng một** định danh và guard chặn
  bằng `N1-SELF`/`N2-SELF`. Vai thật phải là phiên con, ngữ cảnh sạch, định danh
  riêng.
- *Cảnh báo "this trigger stores no MCP connectors" mà `create_trigger` trả về
  là **không áp dụng** cho cơ chế này.* Cảnh báo đó nói về phiên do Routine tự
  sinh (`create_new_session_on_fire=true`). Ở đây Routine không sinh phiên nào;
  nó bắn vào một phiên đã có sẵn connector. Đừng xoá Routine vì đọc nhầm cảnh
  báo này — đó chính là cái bẫy đã làm bốn Routine bị xoá ngày 2026-09-09.

Giao diện Routines trên claude.ai vẫn dùng được và vẫn là đường đơn giản nhất
cho người dùng; nó chỉ **không còn là đường duy nhất**.

### 8.2 Prompt Routine sẵn dùng

Các prompt dưới đây dùng cho **cả hai** đường tạo Routine: giao diện Routines
trên claude.ai, và cơ chế điều phối qua phiên bền (§8.1a) — ở đường thứ hai,
prompt của vai là giá trị truyền vào `create_session`, còn Routine chỉ mang
prompt điều phối (§8.3, §8.4).

Tạo **bốn** Routine trên claude.ai. Với mỗi Routine, khi tạo phải chọn:

- **Repository:** `Mekong-HCM/MK-DDC-24`, nhánh `main`
- **Connector:** GitHub (bắt buộc — thiếu nó thì vai không đọc/ghi được Issue và PR)
- **Cron:** theo bảng §8
- **Phiên riêng cho từng vai** — bốn Routine, bốn phiên, không dùng chung (§8)

Mỗi prompt dưới đây là bản đầy đủ, dán thẳng, không cần sửa.

**Khối chung — dán vào đầu cả bốn prompt:**

```
## Bước 0 — kiểm môi trường, làm trước mọi thứ

1. `ls docs/00_governance/CLEAN_CODE_WORKFLOW.md .claude/skills/<TÊN-SKILL>/SKILL.md`
2. Có tool `mcp__github__list_issues` không?

Thiếu bất kỳ thứ nào ⇒ DỪNG NGAY, báo đúng thứ đang thiếu, kết thúc.
TUYỆT ĐỐI không đoán, không bịa, không báo đã làm việc chưa làm.
Báo cáo "không chạy được vì thiếu X" là kết quả đúng và dùng được;
báo cáo bịa làm hỏng chính chuỗi bằng chứng mà quy trình này bảo vệ.

## Nguồn luật

Gọi skill `<TÊN-SKILL>` và làm đúng theo nó.
Authority: `docs/00_governance/CLEAN_CODE_WORKFLOW.md` (WF-CLEAN-001).
Khi skill và prompt này mâu thuẫn, SKILL TRONG REPOSITORY THẮNG.

Định danh `<VAI>-Run` của bạn: gọi `get_session` BỎ TRỐNG `session_id`,
URL là `https://claude.ai/code/<ccr.id>`. TUYỆT ĐỐI không chép lại định danh
có sẵn trong Issue/PR — đó là của phiên khác (§7).

## Hạ tầng — đọc kỹ

GitHub Actions KHÔNG có runner và chủ sở hữu đã quyết định KHÔNG bật lại (#414).
`Build & Test`, `Security Scan`, `Cổng quy trình clean-code` đều NOT_RUN — lâu dài.
Một PR không có check đỏ KHÔNG phải PR đã được kiểm.
KHÔNG chờ CI xanh; chờ một job không bao giờ chạy là treo vĩnh viễn.
```

Phần riêng của từng vai lấy nguyên từ mục **Việc phải làm** trong skill tương
ứng; skill là bản đúng, prompt chỉ cần trỏ tới nó. Ba giá trị `<TÊN-SKILL>` và
`<VAI>`:

| Routine | `<TÊN-SKILL>` | `<VAI>` | Nhắc thêm trong prompt |
|---|---|---|---|
| Manager/Planner | `ddc-manager-planner` | `Manager` | Không sửa file, không nhánh/commit/PR/merge. Thấy lỗi dễ sửa vẫn phải viết thành Issue (N1). Canh vòng sửa lại treo theo mục 4a của skill. |
| Implementer A | `ddc-implementer` | `Implementer` | Ưu tiên `state:changes-requested` trước mọi Issue mới. Đúng một Issue, đúng một PR. Không gắn `review:pass`, không merge. |
| Implementer B | `ddc-implementer` | `Implementer` | Y hệt A. Hai Routine chỉ khác lịch; chúng tự tránh nhau nhờ nhãn `state:in-progress` gắn trước khi viết dòng code đầu tiên. |
| Reviewer/Gatekeeper | `ddc-reviewer` | `Reviewer` | PASS thì phải **gỡ** `review:changes-requested` trước khi gắn `review:pass`, rồi chạy `workflow_guard.py --input` từ cây `main` và chỉ merge khi exit 0. |

### 8.3 Prompt Routine điều phối — Clean Code Auditor (Manager), 06:00 VN

Đây là prompt **của Routine** `trig_01Gt1weroASWGntFuTVZWCBK`. Nó chỉ điều phối;
prompt của vai Manager nằm ở khối `markdown` bên dưới và được truyền vào
`create_session`.

> Routine hiện hành trỏ tới "§8.3" khi đi lấy prompt của vai. Mục này chính là
> mục đó — trước 2026-09-10 nó **không tồn tại** trong `main`, nên Routine phải
> tự xoay xở. Đừng đổi số mục này mà không sửa prompt của Routine.

Prompt của **vai Manager** mà phiên điều phối phải truyền nguyên văn:

```markdown
## Bước 0 — kiểm môi trường, làm trước mọi thứ

1. `ls docs/00_governance/CLEAN_CODE_WORKFLOW.md .claude/skills/ddc-manager-planner/SKILL.md`
2. Có tool `mcp__github__list_issues` không?

Thiếu bất kỳ thứ nào ⇒ DỪNG NGAY, báo đúng thứ đang thiếu, kết thúc.
TUYỆT ĐỐI không đoán, không bịa, không báo đã làm việc chưa làm.
Báo cáo "không chạy được vì thiếu X" là kết quả đúng và dùng được;
báo cáo bịa làm hỏng chính chuỗi bằng chứng mà quy trình này bảo vệ.

## Nguồn luật

Gọi skill `ddc-manager-planner` và làm đúng theo nó.
Authority: `docs/00_governance/CLEAN_CODE_WORKFLOW.md` (WF-CLEAN-001).
Khi skill và prompt này mâu thuẫn, SKILL TRONG REPOSITORY THẮNG.

Định danh `Manager-Run` của bạn: gọi `get_session` BỎ TRỐNG `session_id`,
URL là `https://claude.ai/code/<ccr.id>`. TUYỆT ĐỐI không chép lại định danh
có sẵn trong Issue/PR — đó là của phiên khác (§7).

## Hạ tầng — đọc kỹ

GitHub Actions KHÔNG có runner và chủ sở hữu đã quyết định KHÔNG bật lại (#414).
`Build & Test`, `Security Scan`, `Cổng quy trình clean-code` đều NOT_RUN — lâu dài.
Một PR không có check đỏ KHÔNG phải PR đã được kiểm.
KHÔNG chờ CI xanh; chờ một job không bao giờ chạy là treo vĩnh viễn.

## Nhắc riêng cho vai này

Không sửa file, không tạo nhánh, không commit, không mở PR, không merge.
Thấy lỗi dễ sửa vẫn phải viết thành Issue — người tạo Issue mà tự sửa là vi
phạm N1, và guard sẽ chặn PR đó bằng `N1-SELF`.
Canh vòng sửa lại đang treo theo mục 4a của skill.
```

### 8.4 Prompt Routine điều phối — Clean Code Implementer, mỗi giờ phút :00 VN

Trigger `trig_01GqDKDuHc5iV6dKGq86DL93`, bắn vào phiên điều phối
`session_01R1Ga52pakcTifHxCmRd3ty`. Mỗi lượt phiên điều phối chỉ làm ba việc:
kiểm repo, kiểm **khoá thực thi**, rồi `create_session` sinh một phiên
Implementer sạch mang tag `routine-implementer`.

**Khoá thực thi có hai lớp, cố ý trùng nhau:**

| Lớp | Ai giữ | Chặn được gì |
|---|---|---|
| Tag phiên | Phiên điều phối: không sinh phiên mới nếu còn phiên `routine-implementer` đang `SESSION_STATUS_RUNNING` | Hai lượt Routine chồng nhau khi một lượt chạy quá 60 phút |
| Nhãn Issue | Phiên Implementer: gắn `state:in-progress` **trước** dòng code đầu tiên | Hai Implementer bất kỳ (kể cả chạy tay) nhận trùng Issue |

Lớp tag đủ cho trường hợp thường gặp, nhưng nó đọc trạng thái phiên — một thứ
có độ trễ. Lớp nhãn mới là lớp đúng đắn, vì nó nằm trên chính đối tượng đang
tranh chấp. Giữ cả hai.

**Làn này tự merge PR của mình — đây là ngoại lệ có chủ đích, do chủ sở hữu
quyết định ngày 2026-09-10** ("Chỉ squash merge và đóng issue khi toàn bộ
acceptance criteria cùng kiểm tra local đều đạt"). Ngoại lệ được thi hành bằng
đúng cơ chế mà quy trình đã có sẵn cho nó — nhãn `gate:waived` kèm comment
`GATE-WAIVED:` — chứ **không** bằng cách tự gắn `review:pass`. Khác biệt không
phải chuyện hình thức:

- `gate:waived` miễn **đúng hai** mã `N2-GATE` và `N2-VERDICT`; mọi ràng buộc
  truy xuất và tách vai còn lại (`N1-*`, `N3-*`, `WF-STATE`) vẫn phải qua.
- Nó để lại dấu vết đọc được: PR nào đi đường tắt, vì sao, ai cho phép.
- Tự gắn `review:pass` thì ngược lại — nó **bịa ra** một lần review chưa từng
  xảy ra, và làm hỏng đúng thứ mà chuỗi verdict sinh ra để giữ.

Vai Reviewer chạy tay vẫn review lại các PR của làn này khi cần; `gate:waived`
không xoá quyền đó.

Prompt của **vai Implementer** mà phiên điều phối phải truyền nguyên văn:

```markdown
## Bước 0 — kiểm môi trường, làm trước mọi thứ

1. `ls docs/00_governance/CLEAN_CODE_WORKFLOW.md .claude/skills/ddc-implementer/SKILL.md`
2. `git remote -v` phải trỏ `Mekong-HCM/MK-DDC-24`. Nhánh mặc định là `main`.
3. `git status --porcelain` phải RỖNG.
4. Có tool `mcp__github__list_issues` không?

Sai repository, hoặc cây làm việc có thay đổi không xác định, hoặc thiếu tool ⇒
DỪNG NGAY, báo đúng thứ sai, KHÔNG thay đổi repository. TUYỆT ĐỐI không đoán,
không bịa, không báo đã làm việc chưa làm. Một thay đổi lạ trong cây làm việc là
dấu hiệu phiên khác đang dùng chung container — dọn nó đi là xoá việc của người
khác.

## Nguồn luật

Gọi skill `ddc-implementer` và làm đúng theo nó.
Authority: `docs/00_governance/CLEAN_CODE_WORKFLOW.md` (WF-CLEAN-001), mục §8.4
cho các điểm riêng của làn Routine mỗi giờ này.
Khi skill và prompt này mâu thuẫn, SKILL TRONG REPOSITORY THẮNG.

Định danh `Implementer-Run` của bạn: gọi `get_session` BỎ TRỐNG `session_id`,
URL là `https://claude.ai/code/<ccr.id>`. TUYỆT ĐỐI không chép lại định danh
có sẵn trong Issue/PR — đó là của phiên khác (§7).

## Hạ tầng — đọc kỹ

GitHub Actions KHÔNG có runner và chủ sở hữu đã quyết định KHÔNG bật lại (#414).
`Build & Test`, `Security Scan`, `Cổng quy trình clean-code` đều NOT_RUN — lâu dài.
Một PR không có check đỏ KHÔNG phải PR đã được kiểm.
KHÔNG chờ CI xanh; chờ một job không bao giờ chạy là treo vĩnh viễn.
Mọi cổng chạy TẠI MÁY, và bảng Verification bạn tự đo là lớp kiểm chứng duy nhất
trước khi mã vào `main`. Đừng cắt bớt cổng vì "CI sẽ bắt".

## Việc phải làm — đúng MỘT Issue, đúng MỘT PR, mỗi phiên

1. VIỆC DỞ TRƯỚC VIỆC MỚI. `list_issues` nhãn `state:in-progress`. Có Issue nào
   phiên trước bỏ dở ⇒ TIẾP TỤC ĐÚNG ISSUE ĐÓ, không nhận Issue mới. Đọc comment
   tiến độ gần nhất trên Issue để biết đang dở ở đâu và blocker là gì.

2. CHỌN ISSUE khi không có việc dở. Issue hợp lệ phải thoả ĐỦ HAI điều kiện:
   - mang nhãn `state:ready`, VÀ
   - mang ÍT NHẤT MỘT nhãn trong nhóm làn dọn dẹp:
     `wf:clean-code`, `wf:clean-docs`, `wf:test-debt`, `wf:tooling`.

   Thiếu nhãn `wf:*` nào trong bốn nhãn trên ⇒ **KHÔNG PHẢI việc của làn này**,
   dù nó có `state:ready`, dù `priority:critical`, dù tiêu đề trông giống việc
   dọn dẹp. Bỏ qua, không assign, không comment, không đổi nhãn của nó.
   Đây là ranh giới làn, không phải bộ lọc cho gọn: làn này chỉ dọn mã và dọn
   tài liệu. Issue `enhancement`/`question` là việc phát triển tính năng, có
   thiết kế và người chủ trì riêng; một agent tự nhận rồi tự merge việc như thế
   là đi ra ngoài thứ chủ sở hữu đã cho phép.

   Trong tập hợp lệ, sắp theo `priority:critical` → `high` → `medium` → `low`;
   cùng mức thì lấy Issue CŨ NHẤT. Issue `state:changes-requested` (cũng phải
   mang `wf:*` hợp lệ) được ưu tiên TRƯỚC mọi Issue mới — một PR đang chờ sửa có
   giá trị hơn một PR mới mở.

   Không có Issue nào thoả cả hai điều kiện ⇒ KẾT THÚC PHIÊN, KHÔNG thay đổi
   repository, và báo rõ "backlog làn dọn dẹp rỗng" kèm số Issue `state:ready`
   đã bị loại vì thiếu nhãn `wf:*`. Không hạ tiêu chuẩn để có việc mà làm. Không
   tự nghĩ ra việc, không tự mở Issue rồi tự làm — đó là vi phạm N1 và guard sẽ
   chặn PR đó bằng `N1-SELF`.

3. NHẬN VIỆC TRƯỚC KHI VIẾT DÒNG CODE ĐẦU TIÊN. Assign Issue cho chính bạn, gỡ
   `state:ready`, gắn `state:in-progress`, comment vào Issue nêu `Implementer-Run`
   của phiên này. Đảo thứ tự bước này là cách nhanh nhất để hai phiên nhận trùng.

4. NHÁNH RIÊNG.
       git fetch origin main
       git checkout -B clean-code/issue-<số> origin/main
   Một nhánh phục vụ đúng một Issue. Luôn nhánh từ `origin/main` mới nhất.

5. KIỂM VA CHẠM. `list_pull_requests` state=open và `list_branches`. Nếu có
   PR/nhánh đang sống chạm cùng tập file thuộc Source ownership của Issue này ⇒
   DỪNG: comment vào Issue nêu rõ PR/nhánh nào xung đột và file nào trùng, trả
   Issue về `state:ready` (gỡ `state:in-progress`, bỏ assign), kết thúc phiên.
   Sửa song song cùng một file là cách tạo ra conflict mà không ai sở hữu.

6. PHÂN TÍCH NGUYÊN NHÂN GỐC RỒI IMPLEMENT TỐI THIỂU đúng acceptance criteria.
   Chỉ chạm file trong Source ownership của Issue. Cần chạm file ngoài danh sách
   ⇒ dừng, comment hỏi Manager mở rộng scope, kết thúc phiên. Không gộp Issue
   khác, không "tiện tay dọn" thứ ngoài phạm vi.
   Với `wf:clean-code`: KHÔNG đổi hành vi, contract, API, schema, mã lỗi công khai.
   Lỗi phát hiện TRONG phạm vi Issue ⇒ sửa luôn trong PR này. Lỗi NGOÀI phạm vi
   ⇒ mở Issue bằng mẫu `03-finding.yml` ở `state:triage`, KHÔNG tự sửa.

7. BỔ SUNG TEST còn thiếu cho đúng hành vi vừa sửa. Không skip, không disable,
   không quarantine test để lấy màu xanh. Test đỏ là dữ kiện, không phải chướng
   ngại.

8. CHẠY CỔNG TẠI MÁY theo phạm vi đã chạm — số đo THẬT, không dẫn lại số cũ.
   Không chạy CI, không chờ CI.
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
   ĐỌC EXIT CODE CỦA CẢ `cmake` CONFIGURE LẪN BUILD. Build dir cũ còn
   `CMAKE_HOME_DIRECTORY` trỏ `services/` đã xoá sẽ làm configure + build hỏng
   nhưng `ctest` vẫn chạy binary cũ và báo "pass" — số đo giả, sự cố 2026-08-07.
   Dùng `-count=1` cho Go: kết quả cache che được hồi quy.
   Cổng không chạy được ⇒ ghi `NOT_RUN` kèm lý do. KHÔNG BAO GIỜ ghi PASS cho
   cổng chưa chạy.

9. TỰ REVIEW DIFF rồi ĐỒNG BỘ NHÁNH MẶC ĐỊNH.
       git diff origin/main...HEAD --stat
       git diff origin/main...HEAD
   Đọc lại với con mắt của người sẽ FAIL nó: có file nào ngoài Source ownership
   không; có đổi hành vi nào không khai không; từng acceptance criteria có bằng
   chứng chỉ tới được không; có số đo nào chép lại từ phiên trước không.
   Rồi `git fetch origin main && git merge origin/main`. Conflict thì xử lý an
   toàn — CHANGELOG conflict thì GIỮ CẢ HAI BÊN, không bên nào đè bên nào.
   Sau khi merge xong phải CHẠY LẠI toàn bộ cổng ở bước 8. Số đo trước khi merge
   không còn đúng cho mã sau khi merge.

10. CHANGELOG.md dưới `[Unreleased]`, kèm ngày, phạm vi, số đo, mã Issue.

11. COMMIT, PUSH, PR. Commit tách theo nhóm logic, Conventional Commits, thân bài
    TIẾNG VIỆT nêu triệu chứng → nguyên nhân gốc → cách sửa, có `Refs:`.
        git push -u origin clean-code/issue-<số>
    Mở PR bằng `mcp__github__create_pull_request` (phiên Routine KHÔNG có `gh`
    CLI). Nội dung theo `.github/pull_request_template.md`, bắt buộc:
    - `Closes #<số Issue>` — ĐÚNG MỘT Issue. `Refs #N` không tính, guard chặn.
    - `Implementer-Run:` — định danh phiên NÀY, phải khác `Manager-Run` của Issue.
    - Bảng Verification điền kết quả thật cho từng cổng.
    - Mục đối chiếu acceptance criteria: chép từng AC kèm bằng chứng.
    Chuyển Issue sang `state:in-review`, gỡ `state:in-progress`.

12. CỔNG QUY TRÌNH OFFLINE rồi MERGE. Lấy ảnh chụp PR + Issue + comments bằng
    GitHub MCP, ghi ra JSON, rồi:
        python3 scripts/workflow_guard.py --input <ảnh-chụp>.json
    Mã `N1-*`, `N3-LINK`, `N3-IMPL`, `N3-EVID`, `WF-STATE` là CỦA BẠN — sửa ngay,
    không đi tiếp khi còn mã nào trong nhóm đó.
    Còn `N2-GATE` / `N2-VERDICT` là cổng review. Làn Routine mỗi giờ này được chủ
    sở hữu cho phép tự merge (§8.4), và cách thi hành ĐÚNG là:
    - comment lên PR đúng một dòng mở đầu
      `GATE-WAIVED: làn Routine Implementer mỗi giờ, WF-CLEAN-001 §8.4 — chủ sở
      hữu cho phép tự merge khi mọi acceptance criteria và mọi cổng tại máy đều
      đạt`, kèm liệt kê cổng nào PASS / cổng nào NOT_RUN;
    - gắn nhãn `gate:waived`;
    - chạy lại `workflow_guard.py --input` với ảnh chụp MỚI và chỉ đi tiếp khi
      exit code = 0.
    TUYỆT ĐỐI KHÔNG tự gắn `review:pass` và KHÔNG tự viết comment
    `[REVIEW-VERDICT: PASS]`. Hai thứ đó bịa ra một lần review chưa từng xảy ra;
    `gate:waived` thì nói thật rằng cổng đã được miễn và ai miễn.
    Guard exit 0 ⇒ SQUASH MERGE PR (tiêu đề squash giữ `(#<số issue>)`), đóng
    Issue với `state_reason` phù hợp, gắn `state:done`, gỡ `state:in-review`,
    comment vào Issue đối chiếu TỪNG acceptance criteria kèm bằng chứng.
    Xoá nhánh remote sau merge nếu quyền cho phép; không xoá được thì ghi lại,
    đừng coi là lỗi chặn (§9).

13. CHƯA XONG THÌ ĐỪNG MERGE. Còn bất kỳ acceptance criteria nào chưa đạt, còn
    cổng nào đỏ, hoặc guard còn mã ngoài `N2-*` ⇒ GIỮ NGUYÊN `state:in-progress`,
    comment vào Issue: đã làm tới đâu, đang vướng gì, cần gì để mở khoá. Phiên
    sau tiếp tục đúng Issue đó và KHÔNG nhận Issue mới. Không merge code chưa
    đạt, không force-push, không bỏ qua test.

14. BÁO CÁO CUỐI PHIÊN — luôn luôn, kể cả khi không làm gì: Issue nào; branch và
    PR nào; đã thay đổi gì; kết quả từng cổng (PASS/FAIL/NOT_RUN kèm số đo);
    trạng thái merge; blocker còn lại.
```

### 8.5 Thay phiên điều phối định kỳ — bắt buộc, không phải tuỳ chọn

Phiên điều phối là **phiên bền**: mỗi lượt Routine nối thêm vào cùng một hội
thoại, không bao giờ bắt đầu lại. Nên context của nó **chỉ tăng, không bao giờ
giảm**, và khi chạm trần thì Routine chết hẳn — khác hẳn kiểu chặn tạm thời ở
`§8.6`, vì không có gì tự phục hồi.

**Số đo 2026-09-11**, phiên `session_01R1Ga52pakcTifHxCmRd3ty`: `555_386 /
1_000_000` token sau 23 giờ và 22 lượt bắn. Con số này **cao hơn** mức một phiên
điều phối thuần tuý sẽ đạt, vì phiên đó còn gánh nhiều lượt trao đổi tay với chủ
sở hữu. Một lượt điều phối đơn thuần (đọc thông báo → kiểm khoá → `create_session`
→ báo một dòng) tốn khoảng `5_000`–`15_000` token, tức **~240k/ngày** ở nhịp một
giờ. Từ đó: trần 1M chạm sau **khoảng 4 ngày** chạy thuần.

**Chu kỳ thay: 2–3 ngày.** Chọn ngưỡng dưới mức 4 ngày để còn biên an toàn cho
những ngày có nhiều lượt trao đổi tay.

Thủ tục thay — làm được hoàn toàn từ phiên agent, không cần giao diện claude.ai:

1. `create_session` với `source_url` = repo, `source_revision` = `main`,
   `tags` = `["role:dispatcher", "wf-clean-001", "routine-dispatcher"]`, và
   `prompt` là khối **chờ lệnh** ở dưới. Đừng truyền prompt điều phối vào đây:
   phiên sẽ dispatch ngay lúc sinh, và nếu lượt Routine kế tiếp vẫn bắn vào phiên
   cũ thì có hai lượt dispatch chồng nhau trong vài phút.
2. **Tạo trigger MỚI** trỏ vào phiên mới: `create_trigger(cron_expression=…,
   persistent_session_id=<id phiên mới>, prompt=<prompt điều phối>)`.

   > **`update_trigger` KHÔNG đổi được `persistent_session_id`.** Đo
   > 2026-09-11: tham số đó không có trong schema, gọi vào trả lỗi *"at least
   > one of name, cron_expression, run_once_at, enabled, model, prompt must be
   > set"*. Một trigger đã gắn vào phiên nào thì gắn vĩnh viễn vào phiên đó —
   > thay phiên **bắt buộc** phải tạo trigger mới. Đừng mất thời gian tìm cách
   > sửa tại chỗ.

3. **Tắt trigger cũ**: `update_trigger(trigger_id=<cũ>, enabled=false)`.
   Dùng `enabled=false` chứ không `delete_trigger`: xoá có thể bị classifier
   chặn (`[Modify Shared Resources]`, đo 2026-09-11), và tắt thì vẫn giữ được
   lịch sử chạy của trigger cũ để đối chiếu. Làm bước này **ngay sau** bước 2 —
   để hở hai trigger cùng bật thì mỗi giờ có hai lượt dispatch; khoá thực thi
   chặn được hai Implementer nhưng vẫn tốn một lượt vô ích.

4. Xác minh bằng `list_triggers`: trigger mới `enabled: true` với
   `persistent_session_id` đúng phiên mới, trigger cũ `enabled: false`.

5. Để phiên cũ tự nhàn rỗi. **Không `archive_session` ngay** — nếu trigger mới
   hỏng thì bật lại trigger cũ là đường lui duy nhất. Chỉ archive sau khi đã
   thấy một lượt Routine chạy thành công trên phiên mới.

Lưu ý phút chạy: trigger mới bị neo lại theo thời điểm tạo (`§8`), nên phút chạy
hằng giờ sẽ khác trigger cũ. Đây là chuyện bình thường, không phải cấu hình sai.

Prompt **chờ lệnh** cho phiên điều phối mới:

```markdown
Bạn là PHIÊN ĐIỀU PHỐI của Routine Clean Code Implementer (WF-CLEAN-001 §8.4).

Lượt này chỉ để khởi tạo. KHÔNG sinh phiên Implementer, KHÔNG chọn Issue, KHÔNG
sửa file, KHÔNG commit, KHÔNG mở PR, KHÔNG merge.

Làm đúng bốn việc rồi kết thúc:

1. `git remote -v` — phải trỏ `Mekong-HCM/MK-DDC-24`.
2. `ls docs/00_governance/CLEAN_CODE_WORKFLOW.md` — phải tồn tại.
3. Kiểm có tool `mcp__Claude_Code_Remote__create_session`,
   `mcp__Claude_Code_Remote__list_sessions` và `mcp__github__list_issues`.
   Thiếu bất kỳ cái nào ⇒ báo đúng thứ thiếu; phiên này KHÔNG dùng được làm
   phiên điều phối và chủ sở hữu phải biết ngay, đừng chờ tới lượt bắn đầu tiên
   mới phát hiện.
4. Gọi `get_session` bỏ trống `session_id`, in ra `ccr.id` của chính bạn.

Rồi báo: "Phiên điều phối sẵn sàng, id = <ccr.id>" và DỪNG.

Từ lượt sau, mỗi giờ bạn sẽ nhận prompt điều phối và làm đúng theo nó.
```

### 8.6 Chặn tạm thời khi sinh phiên — nhận diện và xử lý

`create_session` có thể bị classifier quyền hạn từ chối khi nhiều lượt sinh phiên
dồn trong thời gian ngắn. **Đo 2026-09-10/11: chặn liền 17 giờ** (`08:08Z` →
`01:07Z`), rồi tự hết mà không cần đổi cấu hình gì.

Triệu chứng đặc trưng — nhận ra để khỏi đi sửa nhầm chỗ:

- Trigger vẫn bắn đúng giờ, `last_run` vẫn `SUCCEEDED` (đó chỉ là "đã giao được
  lượt", không phải "lượt đã làm được việc").
- Phiên điều phối vẫn thức, vẫn kiểm repo xong.
- Chỉ đúng lệnh `create_session` bị từ chối. Không phiên con nào ra đời.
- Backlog **không** rỗng — đây là điểm phân biệt quan trọng nhất.

**Xử lý: đợi rồi thử lại.** Không tạo `.claude/settings.json` để cấp quyền cho
chính agent — thao tác ghi file phân quyền đó cũng bị chặn, và bị chặn là đúng:
một agent tự nới quyền cho mình là thứ ranh giới này sinh ra để cản. Ngày
2026-09-10 đã đi nhầm đường này và mất một ngày backlog đứng yên.

Phân biệt với hai tình huống nhìn giống nhau:

| Hiện tượng | Nguyên nhân | Xử lý |
|---|---|---|
| Không phiên con nào ra đời, backlog còn việc | Chặn tạm thời (mục này) | Đợi, thử lại |
| Phiên con ra đời rồi kết thúc ngay, backlog còn việc | Bộ lọc Issue sai (§8.4 bước 2) | Kiểm nhãn `wf:*` |
| Phiên con ra đời rồi kết thúc ngay, backlog rỗng | Đúng thiết kế | Chờ Auditor nạp việc |

### 8.7 Prompt Routine điều phối — Clean Code Reviewer, mỗi ngày 04:00 VN

Trigger bắn vào phiên điều phối; mỗi lượt phiên điều phối chỉ kiểm repo rồi
`create_session` sinh một phiên Reviewer sạch mang tag `routine-reviewer`.

**Vì sao mục này tồn tại — số đo, không phải dự cảm.** Trong hai ngày
2026-09-10 và 2026-09-11, làn Implementer chạy mỗi giờ và mở PR đều đặn, nhưng
số PR `state:in-review` chỉ **tăng**: 3 → 4 → 5, không lượt nào rút xuống. Mười
ba lượt Implementer liên tiếp báo "backlog rỗng" trong khi năm PR nằm chờ. Nguyên
nhân không nằm ở Implementer: `list_triggers(enabled=true)` ngày 2026-09-11 cho
đúng **hai** Routine bật — Implementer mỗi giờ và Auditor hằng ngày. Skill
`ddc-reviewer` có trong repo từ đầu nhưng **chưa bao giờ được xếp lịch**. Một vai
có skill mà không có lịch thì không tồn tại.

Hệ quả dây chuyền, cũng đo được: lượt Implementer 2026-09-12T01:08Z nhận #659 và
#661 rồi phải dừng ở bước kiểm va chạm vì cả hai chạm cùng tập file với ba PR
đang mở `#652`, `#654`, `#656`. PR tồn đọng không chỉ nằm im — nó **chặn Issue
kế tiếp**. Đó là vòng tự khoá: Implementer mở PR → PR nằm chờ → PR chặn Issue
sau → Implementer hết việc.

**Cơ chế bắt buộc: điều phối qua phiên bền (`§8.1a`).** Không dùng
`create_trigger(create_new_session_on_fire=true)` — `§8.1` đã đo: phiên do Routine
tự sinh **không có repo và không có MCP tool**, nên nó không đọc được Issue,
không chạy được guard, không merge được gì. Routine Reviewer phải bắn vào một
phiên điều phối đã có sẵn repo + connector.

**Giờ chạy đặt trước Auditor, có chủ đích.** Auditor chạy 23:00Z; Reviewer chạy
21:00Z (04:00 VN). Hai tiếng chênh để bản kiểm kê hằng ngày của Auditor nhìn thấy
hàng đợi **đã rút**, chứ không đếm lại đúng những PR mà Reviewer vừa merge xong.

**Hai ranh giới mà lượt Reviewer không được vượt:**

- *Không đụng PR mà Issue của nó đang `state:in-progress`.* Issue ở trạng thái đó
  nghĩa là một Implementer đang cầm nó; review một PR đang bị sửa dở là review
  một cái đích di động.
- *Không merge PR mà chính phiên này đã implement.* Ở làn Routine điều đó không
  xảy ra tự nhiên vì Reviewer là phiên riêng, nhưng ràng buộc vẫn phải ghi —
  `workflow_guard.py` chặn bằng `N2-SELF` và thông điệp lỗi sẽ khó hiểu nếu
  người đọc không biết luật này có từ đâu.

PR mang nhãn `gate:waived` do làn Implementer tự merge (`§8.4`) đã nằm trong
`main`, không còn là việc của Reviewer. Nhưng `gate:waived` **không** xoá quyền
review lại: thấy một PR đã waived mà số đo đáng ngờ thì mở finding
`03-finding.yml` ở `state:triage`, đừng im lặng.

Prompt của **vai Reviewer** mà phiên điều phối phải truyền nguyên văn:

```markdown
## Bước 0 — kiểm môi trường, làm trước mọi thứ

1. `ls docs/00_governance/CLEAN_CODE_WORKFLOW.md .claude/skills/ddc-reviewer/SKILL.md`
2. `git remote -v` phải trỏ `Mekong-HCM/MK-DDC-24`. Nhánh mặc định là `main`.
3. `git status --porcelain` phải RỖNG.
4. Có tool `mcp__github__list_pull_requests` và `mcp__github__merge_pull_request` không?

Sai repository, hoặc cây làm việc có thay đổi không xác định, hoặc thiếu tool ⇒
DỪNG NGAY, báo đúng thứ sai, KHÔNG thay đổi repository. TUYỆT ĐỐI không đoán,
không bịa, không báo đã làm việc chưa làm.

## Nguồn luật

Gọi skill `ddc-reviewer` và làm đúng theo nó — bảy phép kiểm, thứ tự gắn nhãn,
cách post verdict, trần ba vòng, đều nằm ở đó.
Authority: `docs/00_governance/CLEAN_CODE_WORKFLOW.md` (WF-CLEAN-001), mục §8.7
cho các điểm riêng của làn Routine này.
Khi skill và prompt này mâu thuẫn, SKILL TRONG REPOSITORY THẮNG.

Định danh `Reviewer-Run` của bạn: gọi `get_session` BỎ TRỐNG `session_id`,
URL là `https://claude.ai/code/<ccr.id>`. TUYỆT ĐỐI không chép lại định danh
có sẵn trong Issue/PR — đó là của phiên khác (§7). `Reviewer-Run` phải KHÁC
`Implementer-Run` và `Manager-Run`, nếu không guard chặn bằng N2.

## Hạ tầng — đọc kỹ

GitHub Actions KHÔNG có runner và chủ sở hữu đã quyết định KHÔNG bật lại (#414).
`Build & Test`, `Security Scan`, `Cổng quy trình clean-code` đều NOT_RUN — lâu dài.
Một PR không có check đỏ KHÔNG phải PR đã được kiểm.
KHÔNG chờ CI xanh; chờ một job không bao giờ chạy là treo vĩnh viễn.
Cổng thay thế là `workflow_guard.py --input`, chạy từ cây làm việc trên `main`
chứ KHÔNG phải từ nhánh PR — chạy bản guard nằm trong PR thì một PR sửa guard
sẽ tự mở cổng cho chính nó.
Phiên Routine KHÔNG có `gh` CLI; mọi thao tác GitHub đi qua `mcp__github__*`.

## Việc phải làm — duyệt HẾT hàng đợi, không hẹn lượt sau

1. LIỆT KÊ. `list_pull_requests` state=open. Giữ lại PR có Issue liên kết ở
   `state:in-review`. Xử lý từng cái, CŨ TRƯỚC.

   BỎ QUA, không đụng tới: PR mà Issue của nó đang `state:in-progress` (một
   Implementer đang cầm — review cái đích di động là vô nghĩa); PR `draft`.
   Ghi rõ trong báo cáo là đã bỏ qua cái nào và vì sao.

   Hàng đợi rỗng ⇒ KẾT THÚC PHIÊN, không thay đổi repository, báo "không có PR
   nào ở state:in-review". Không đi tìm việc khác để làm.

2. VỚI MỖI PR — bảy phép kiểm theo skill `ddc-reviewer` mục 2, dừng ở phép kiểm
   đầu tiên FAIL. Nghi ngờ số đo nào thì TỰ CHẠY LẠI cổng đó trên cây làm việc;
   đó là nguồn sự thật duy nhất còn lại khi CI ngủ. Không tin bảng Verification
   chỉ vì nó được điền đầy đủ.

3. TUYỆT ĐỐI KHÔNG TỰ SỬA CODE TRONG PR ĐANG REVIEW. Sửa hộ là mất luôn lớp
   kiểm tra độc lập. Trả lại cho Implementer kèm danh sách sửa hành động được.

4. VERDICT + MERGE theo đúng thứ tự ở skill mục 3–4: post verdict → gỡ nhãn
   `review:*` của vòng trước → gắn nhãn mới → chạy `workflow_guard.py --input`
   với ảnh chụp MỚI → dán nguyên văn output vào verdict → chỉ merge khi exit 0.
   Merge trước khi chạy guard là bỏ qua chính cổng mình đang gác.
   Squash merge, rồi xoá nhánh remote nếu quyền cho phép; không xoá được thì
   ghi lại, đừng coi là lỗi chặn (§9).

5. FINDING NGOÀI PHẠM VI ⇒ mở Issue `03-finding.yml` ở `state:triage`. Không
   nhét vào danh sách "phải sửa" của PR đang review — làm vậy là biến review
   thành cửa mở rộng phạm vi.

6. BÁO CÁO CUỐI PHIÊN — luôn luôn, kể cả khi không làm gì: từng PR đã review và
   verdict; lý do FAIL nếu có; PR đã merge; Issue đã đóng; PR đã bỏ qua kèm lý
   do; finding mới mở; output guard của từng lần merge.
```

## 9. Hạng mục bị chặn

| Hạng mục | Bị chặn bởi | Cần gì để mở khoá |
|---|---|---|
| Cổng *Require approvals* native của GitHub cho agent | Ba vai dùng chung tài khoản `Mekong-HCM`; GitHub cấm tự approve PR của mình | Cấp machine user hoặc GitHub App riêng cho vai Reviewer, thêm vào repo với quyền `write` |
| Bật branch protection trên `main` | Cần quyền admin repo qua giao diện `Settings → Branches`; API branch-protection không có trong tool set của phiên agent | Owner bật thủ công theo checklist `§5.1` |
| Vai Reviewer/Gatekeeper chưa có Routine, vẫn phải kích hoạt tay | Chưa dựng, không phải không dựng được — cơ chế điều phối ở `§8.1a` đã chạy thật cho hai vai kia | Tạo một phiên bền cho vai Reviewer rồi `create_trigger(persistent_session_id=…)` theo đúng mẫu `§8.4`, prompt vai lấy ở `§8.2` |
| Xoá nhánh remote sau merge | Credential git của phiên không có quyền xoá ref (`HTTP 403` ở cả `git push --delete` lẫn refspec rỗng, từ nhiều phiên khác nhau); không có tool MCP xoá branch | Bật `Settings → General → Automatically delete head branches`, hoặc xoá tay tại trang Branches |
| Toàn bộ cổng CI (`Build & Test`, `Security Scan`, job `workflow-guard`) | GitHub Actions không cấp runner (#414), và chủ sở hữu **đã quyết định không bật lại** (2026-09-09) | **Không phải mục chờ mở khoá — là một quyết định đã chốt.** §6.1a chỉ thay được cổng quy trình; cổng biên dịch và test đa nền tảng **không có phần thay thế bằng phần mềm** và sẽ do Implementer tự đo, Reviewer tự kiểm lại. |

---

## Lịch sử sửa đổi

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.5 | 2026-09-16 | `§6.2`: thêm cổng `scripts/verify-project.sh --component bacnet` — bản thi hành `ADR-060` điều (4) (*`BACNET=OFF` không được là đường build duy nhất được kiểm*). Trước đó §6.2 chỉ có khối `cmake`/`ctest` dựng host, không khẳng định gì về việc bacnet-stack có thật sự được biên dịch vào: ngày 2026-09-10 bộ cổng báo **1440/1440 PASS** trong khi `SubscribeCOV` chưa đăng ký và 64/88 object không có dữ liệu. Cổng mới chạy bốn tầng (host `BACNET=ON` → symbol `bip_init` → tầng `LOOPBACK` `#626` chạy thật, không `SKIP` → cross aarch64 + ba cổng kiểm binary `#627`) và ghi rõ hai gói toolchain phải cài, lý do cổng **không** nằm trong `--component all`, cùng trạng thái `NOT_RUN (#414)` của job CI tương ứng. Refs `#628` (`T-BAC-012`). |
| 1.0 | 2026-09-09 | Thiết lập ban đầu: ba vai, ma trận quyền, workflow state, nhãn, branch/merge rule, quality gate, truy xuất và lịch chạy. |
| 1.4 | 2026-09-11 | `§1` N1 + `§3.2` mới + `§7`: mẫu `03-finding.yml` không có ô `Manager-Run`, nên mọi finding được triage lên `state:ready` đều bị `N1-MGR` chặn merge ở bước cuối — một lớp Issue không bao giờ merge được, và lối thoát nhanh nhất là Implementer tự bịa một dòng `Manager-Run`. Mẫu nay có ô `Manager-Run` dành riêng cho lượt triage của Manager, và ô người mở đổi nhãn thành `Finder-Run`. Vì trên finding người **tạo** Issue là người phát hiện chứ không phải Manager, guard thêm mã chặn `N1-FINDER` (người mở finding tự implement) và ghi nhận `CẢNH BÁO triage` (tự điền ô triage). Refs `#653`. |
| 1.3 | 2026-09-11 | `§6.1a` + `§6.2`: `python3 scripts/docs_iso_harness.py --expect` và `python3 scripts/workflow_guard.py --selftest` nay có đường chạy trong `scripts/verify-project.sh` (`--component docs`, `--component workflow`). Trước đó selftest của guard chỉ tồn tại trong job `guard-selftest` của Actions, mà Actions không có runner (`#414`) — tức `scripts/workflow_guard.py`, file N1/N2 dựa vào, là mã không cổng nào bảo vệ khi bị sửa. Ghi rõ: ai chạm guard thì bắt buộc chạy selftest và dán số đo. Refs `#593`. |
| 1.2 | 2026-09-11 | `§8.4` bước 2: điều kiện chọn Issue thành hai vế bắt buộc — `state:ready` VÀ một nhãn `wf:*` thuộc làn dọn dẹp; trước đó chỉ lọc `state:ready` nên Issue `enhancement`/`question` có thể lọt vào làn tự-merge. Thêm `§8.5` (thay phiên điều phối 2–3 ngày một lần, kèm số đo trần context và prompt chờ lệnh) và `§8.6` (nhận diện chặn tạm thời khi sinh phiên, kèm bảng phân biệt ba hiện tượng nhìn giống nhau). |
| 1.1 | 2026-09-10 | §8: hai Routine đã chạy thật, kèm số hiệu trigger và phiên điều phối. Thêm `§8.1a` (cơ chế điều phối qua phiên bền — cơ chế thứ tư, chạy được) đính chính kết luận "chỉ tạo được từ giao diện claude.ai" của `§8.1`. Thêm `§8.3` (prompt vai Manager — mục mà Routine Auditor vẫn trỏ tới nhưng trước đó không tồn tại) và `§8.4` (làn Routine Implementer mỗi giờ: khoá thực thi hai lớp, nhánh `clean-code/issue-<số>`, tự merge qua `gate:waived`). Ghi lại phép đo neo phút của `create_trigger`/`update_trigger`. Cập nhật `§5` và `§9`. |
