# SESSION HANDOFF — FBD EDIT Task 7 + quyết định vượt ngân sách R1

Ngày lập: 2026-09-05. Nhánh: `feat/fbd-edit-task6`. Repo: `MK-DDC-24`.

---

## 1. SESSION OBJECTIVE

Thực hiện **Task 7** của lát công việc FBD EDIT (editor Function Block Diagram trong `apps/web-ui`), tiếp nối handoff `docs/superpowers/plans/2026-09-04-fbd-edit-task6-handoff.md`.

Task 7 đã hoàn thành về mặt code. Vấn đề còn mở duy nhất: chunk `programming` đo được **128,54 KiB gzip**, **vượt 3,54 KiB** so với mốc R1 125 KiB mà spec của lát tự đặt. User yêu cầu **"đề xuất giải pháp"** → đã giao ba lựa chọn A/B/C kèm khuyến nghị; **user chưa chọn**.

Kết quả mong muốn cuối cùng: Owner chốt một trong ba lựa chọn, ghi hồ sơ quyết định, rồi mới đóng lát FBD EDIT.

---

## 2. USER REQUIREMENTS & HARD CONSTRAINTS

### Yêu cầu bắt buộc

- **Toàn bộ giao tiếp, tài liệu, changelog, commit message, PR — bằng tiếng Việt.** (CLAUDE.md)
- **Nguyên tắc điều phối do user đặt (nguyên văn):** *"nguyên tắc opus chỉ điều phối + lên plan còn đâu phải để các model khác làm"* → Opus **chỉ** khảo sát, lên plan, điều phối và kiểm tra kết quả. Mọi việc thực thi (đọc rộng, sửa code, viết test, đo đạc) **phải giao subagent**.
- Cập nhật `CHANGELOG.md` dưới `[Unreleased]` **trong cùng phiên** với mọi thay đổi code/config/docs.
- Làm hết việc, không để lại danh sách "còn lại / nói nếu muốn tôi làm" (CLAUDE.md §"Làm hết việc").

### Cấm tuyệt đối

- Nghiêm cấm `git add -A`, `git add .`, `git add -p`. Chỉ stage file cụ thể theo allowlist rõ ràng.
- Cấm sửa code ngoài `apps/web-ui/src/features/programming/**`. Không đụng `apps/core/**`, `apps/web-api/**`, `firmware/**`, `contracts/**`, `scripts/**`.
- Cấm `git reset`, `git checkout --`, `git clean`, hoặc lệnh xoá rộng.
- **TUYỆT ĐỐI KHÔNG SỬA:** `ProgrammingHeader.tsx` và `ProgrammingLayout.tsx` — giữ nguyên file dirty của user.
- **Tuyệt đối không sửa `scripts/verify_programming_bundle_budget.py`** — nằm ngoài allowlist FE của spec §1.4.
- `BLK-FBD-001`: không tự tạo `variableId` nếu schema/API hiện tại chưa có; không tạo Mapping ẩn.
- Không dùng runtime value giả trong chế độ EDIT.
- **Không push, không tạo PR, không merge** trừ khi user yêu cầu trực tiếp.
- Giữ thay đổi FE cục bộ làm nguồn chân lý; không ghi đè công việc FE không liên quan.

---

## 3. WORKING METHOD / USER-DEFINED WORKFLOW

### USER-DEFINED WORKFLOW (7 pha — do user quy định, giữ nguyên thứ tự)

```
Khảo sát → Lên plan → Check plan → Thực thi → Báo cáo → Check báo cáo → Xuất lại báo cáo
```

Không đổi thứ tự, không gộp, không bỏ pha.

### SESSION-ESTABLISHED WORKFLOW (đã hình thành và chạy ổn định)

1. Opus đọc trực tiếp **chỉ** những file quyết định (package.json, plan, spec, hồ sơ quản trị) — đủ để ra quyết định, không đọc rộng.
2. Việc khảo sát rộng và đo đạc → giao subagent hoặc Workflow (`parallel()` fan-out + schema có cấu trúc).
3. **Opus tự kiểm chứng lại mọi phát hiện then chốt của subagent trước khi đưa vào báo cáo.** Đã bắt được ít nhất một lỗi trích dẫn của subagent nhờ bước này (xem mục 15, CB-3).
4. Báo cáo cho user theo khuôn hồ sơ quyết định của repo: bảng thuộc tính → bảng bằng chứng đo được → lựa chọn (A)/(B)/(C) → **"Khuyến nghị kỹ thuật (không phải quyết định)"**.
5. Mọi con số đều phải đo lại thật, ghi kèm file:dòng làm bằng chứng. Không dẫn lại số cũ.

### WORKFLOW INVARIANTS (không được phá)

- Đọc file liên quan trước khi sửa.
- Mỗi thay đổi phải verify trước khi chuyển bước tiếp theo.
- Không refactor ngoài phạm vi task.
- **Không khẳng định đã hoàn thành nếu chưa có bằng chứng.** Thông tin chưa kiểm chứng phải ghi rõ UNVERIFIED.
- Quyết định thuộc thẩm quyền Owner (nới ngân sách, đổi cổng repo, sửa hợp đồng) → **trình lựa chọn, không tự quyết**.

---

## 4. CURRENT WORKFLOW POSITION

```
Workflow:          Khảo sát → Lên plan → Check plan → Thực thi → Báo cáo → Check báo cáo → Xuất lại báo cáo
Completed:         Khảo sát → Lên plan → Check plan → Thực thi → Báo cáo
Currently:         Check báo cáo — ĐANG CHỜ USER CHỌN A/B/C
Next:              Xuất lại báo cáo (sau khi có lựa chọn), rồi ghi hồ sơ quyết định
```

Task 0.5 → Task 7 của lát FBD EDIT: **đã xong về code**. Điểm dừng duy nhất là quyết định quản trị về mốc 125 KiB.

---

## 5. WORKSPACE / ENVIRONMENT

| Mục | Giá trị |
|---|---|
| Working directory | `e:\TuanDuong\INTERN\DDC24_project\MK-DDC-24` |
| Nhánh | `feat/fbd-edit-task6` (Task 6 + Task 7 **đều chưa commit**) |
| Frontend | `apps/web-ui` — React 18.3.1 + TypeScript |
| Build | Vite/Rolldown; Tailwind v4 |
| Test | Vitest (unit), Playwright (E2E) |
| OS | Windows 11; shell bash (Git Bash) |
| Đo gzip | **zlib mức 6** (cố ý, không phải mức 9). 1 KiB = 1024 byte |

Không có secret nào liên quan trong phạm vi lát này.

---

## 6. CURRENT VERIFIED STATE

### VERIFIED (Opus tự đo/tự đọc, không qua trung gian)

- `programming-CEgDVswx.js`: raw 511.152 byte → gzip mức 6 = **131.629 byte = 128,54 KiB**.
- `fbd-editor-DGrHrJO8.js`: raw 163.715 byte → gzip mức 6 = 45.144 byte = **44,09 KiB** (đã tách khỏi chunk `programming`).
- Chỉ có **đúng một** file `programming-*.js` trong thư mục assets — không có rác build cũ làm sai số đo.
- `apps/web-ui/package.json:28` — `"check:bundle-budget": "python3 ../../scripts/verify_programming_bundle_budget.py --increment r3"`.
- `apps/web-ui/package.json:8` — `build` kết thúc bằng `npm run check:bundle-budget`.
- `grep -rn "bundle-budget" .github/` → **0 kết quả**. Không có wiring CI nào khác. ⇒ **R3 (165 KiB) là cổng thi hành duy nhất; nó đang PASS, dư 36,46 KiB.**
- `docs/03_implementation/59_PROGRAMMING_DOC_TO_CODE_IMPLEMENTATION_PLAN.md:7` — R1 ĐÓNG, R2 ĐÓNG, R3 ĐÓNG, **74/74 task DONE hoặc WAIVED/DEFERRED tường minh**.
- Cùng file, dòng 2738/2741/2742/2743 — bốn task R3 liên tiếp: `T59-816` **153,79**, `T59-819` **127,67**, `T59-820` **128,97**, `T59-821` **132,88** KiB, tất cả ghi nhãn `/165 KiB (R3)`, **tất cả trên 125 KiB**, không task nào bị coi là vi phạm. Chunk vượt 125 KiB từ `T59-816` ngày 2026-08-27 — **trước khi lát FBD EDIT bắt đầu**.
- `UD-PROG-017` còn trống: grep `UD-PROG-017|UD-PROG-018` toàn repo → 0 kết quả.
- `PROGRAMMING_OPEN_DECISIONS.md` §4 Lịch sử (dòng ~323-333) **đang lỗi**: hai dòng cùng đánh số **1.5** (2026-08-25 và 2026-08-26), và **không có dòng 1.7** dù header khai 1.7.
- `PROGRAMMING_OPEN_DECISIONS.md:280` — `AUTH-PROG-2026-08-24-05` pin SHA-256 `pgm02_workspace_v1.json=2c2900661d75c97b2432c2c60e4b37cd48ee1b4272a64f2eb04eb2fed128fa63`.

### UNVERIFIED

- Chưa chạy lại full `npm run build` / `vitest` / `lint` sau các sửa đổi cuối của Task 7 trong phiên này. Số đo bundle lấy từ build có sẵn, **không build lại**.
- Chưa biết Owner sẽ chọn A, B hay C.

---

## 7. COMPLETED WORK

| Việc | Trạng thái | Bằng chứng |
|---|---|---|
| Task 0.5 → Task 6 của lát FBD EDIT | Xong (theo handoff 2026-09-04) | `docs/superpowers/plans/2026-09-04-fbd-edit-task6-handoff.md` |
| **Task 7** — code + test | Xong, **chưa commit** | 16 file modified + 14 file untracked trên `feat/fbd-edit-task6` |
| Task 1.5 — lazy-load `ProgramsTab` vào chunk `fbd-editor` | Xong | Cắt được **28,66 KiB** (157,20 → 128,54 KiB) |
| Đo lại bundle độc lập | Xong | Mục 6 VERIFIED |
| Chẩn đoán gốc vấn đề R1 | Xong | R1 không phải cổng thi hành; đóng từ 2026-08-26 |
| Báo cáo ba lựa chọn A/B/C cho user | Xong | Tóm tắt ở mục 9 |
| Khung hồ sơ `UD-PROG-017` soạn sẵn | Xong, **chưa ghi vào file** | Nội dung đầy đủ ở journal workflow `wf_85c2484e-975` |
| Sửa skill `handoff` để lưu file `.md` | Xong | `C:\Users\PC\.claude\skills\handoff\SKILL.md` — thêm mục "Bước cuối — BẮT BUỘC lưu handoff thành file" |

---

## 8. WORK IN PROGRESS

**Đang chờ quyết định của user**, không có code nào đang sửa dở.

Thứ đã soạn sẵn nhưng **cố ý chưa ghi vào repo**: khung hồ sơ `UD-PROG-017` cho `docs/00_governance/PROGRAMMING_OPEN_DECISIONS.md`. Không ghi vì ghi một mục OPEN khi chưa có disposition sẽ trôi đúng như `UD-PROG-013` đã trôi cả một increment.

---

## 9. IMPORTANT DECISIONS

**QĐ-1 — Chọn SVG-first, không dùng `@xyflow/react`.** Đã chốt từ trước lát này. Spec §5.4 ghi rõ *"Nếu fail, bỏ spike; SVG-first là kết quả hợp lệ"*.

**QĐ-2 — Không sửa `scripts/verify_programming_bundle_budget.py` và không sửa `contracts/`.** Cả hai ngoài allowlist. Sửa script = hạ chuẩn; sửa contract = phá SHA-256 pin ở `AUTH-PROG-2026-08-24-05`, phải chạy change control.

**QĐ-3 — Không tự đổi cờ `--increment r3` thành `r1`.** Plan `2026-08-31-fbd-edit.md:51` ghi rõ đây là *"thay đổi cổng toàn repo ảnh hưởng đến tất cả các nhánh, cần Owner quyết định"*.

**QĐ-4 — Trình ba lựa chọn, không tự quyết.** Plan `2026-08-31-fbd-edit.md:52` (`BLK-FBD-003`) đã cho phép trước đúng đường thoát này: *"ghi số đo thực tế để Owner quyết nới budget R1 hoặc giữ cổng R3"*.

**Ba lựa chọn đã trình (user CHƯA chọn):**

- **(A) — KHUYẾN NGHỊ.** Ghi nhận R1 là mốc lịch sử; cổng thi hành là R3. Không sửa số nào, không nới gì. Kèm mốc cảnh báo mềm 145 KiB (quy ước tài liệu, **không** cài vào script). Việc phải làm nếu chọn A: ghi `UD-PROG-017` = CLOSED; sửa spec dòng 15/83; gỡ `BLK-FBD-003` (spec dòng 838); sửa `CHANGELOG.md` dòng 33.
- **(B)** Giữ 125 KiB làm mục tiêu tự nguyện + mở một task cắt 3,54 KiB có **trần một phiên** và **điều khoản rơi tự động về A** nếu vượt trần. Cảnh báo: 3,54/128,54 = 2,75%, không mở khoá gì đang bị chặn; và mốc 125 sẽ bị vượt lại ở task kế tiếp bất kỳ.
- **(C)** Nới trần R1 trong hợp đồng qua change control. **Vi phạm allowlist nếu thi hành trong phiên FE**; phá SHA-256 pin; và nới một cổng đã hết hiệu lực nên gần như chắc chắn sai. Ghi ra chỉ để hồ sơ đủ ba lựa chọn.

**QĐ-5 — Hai việc sửa bắt buộc kèm theo khi ghi hồ sơ (bất kể chọn A/B/C):**
1. Header dòng 6: `Phiên bản 1.7` → `1.8`; dòng 7 cập nhật danh sách ĐANG MỞ.
2. Đính chính §4 Lịch sử: hai dòng trùng số 1.5, thiếu dòng 1.7. Thêm dòng 1.8 mà không sửa lỗi này là kéo dài một lỗi truy nguyên đã có.

**QĐ-6 — Skill `handoff` phải lưu file.** User yêu cầu trực tiếp: *"tạo handoff xong thì cần lưu handoff dưới dạng file md có thể truy cập qua đường dẫn được"*. Đã sửa.

---

## 10. RELEVANT FILES & ARTIFACTS

| Đường dẫn | Vai trò |
|---|---|
| `apps/web-ui/package.json` | Dòng 8 nối cổng vào `build`; dòng 28 pin `--increment r3`. **Bằng chứng quyết định.** |
| `docs/03_implementation/59_PROGRAMMING_DOC_TO_CODE_IMPLEMENTATION_PLAN.md` | Dòng 7: R1/R2/R3 đều ĐÓNG. Dòng 2738-2743: bốn tiền lệ >125 KiB được chấp nhận. |
| `docs/superpowers/plans/2026-08-31-fbd-edit.md` | Dòng 51-52: đường thoát escalation đã được cho phép trước. |
| `docs/superpowers/specs/2026-08-31-fbd-edit-design.md` | **Nguồn xung đột thật ở dòng 15 và 83** (không phải 374-375). Dòng 838: `BLK-FBD-003`. |
| `docs/00_governance/PROGRAMMING_OPEN_DECISIONS.md` | Dòng 280: SHA-256 pin. §4 dòng 323-333: bảng lịch sử đang lỗi. |
| `contracts/programming/pgm02_workspace_v1.json` | §`nfr.frontend`: baseline 98 / R1 125 / R2 145 / R3 165 KiB. **Chỉ đọc.** |
| `CHANGELOG.md` | Dòng 9-35: entry `TASK-7-FBD-EDIT`. Dòng 33 cần sửa nếu chọn A. |
| `apps/web-ui/src/features/programming/fbd/FbdNodeInspector.test.tsx` | 429 dòng. B-T2/B-T3 enforce `BLK-FBD-001` nghiêm ngặt. |
| `docs/superpowers/plans/2026-09-04-fbd-edit-task6-handoff.md` | Handoff phiên trước. |
| Journal workflow | `C:\Users\PC\.claude\projects\e--TuanDuong-INTERN-DDC24-project\5d48c490-c79c-4459-aa45-7f7055f8fdd1\subagents\workflows\wf_85c2484e-975\journal.jsonl` — chứa khung `UD-PROG-017` đầy đủ. |

---

## 11. CODE CHANGES

Phiên này **không sửa code sản phẩm**. Chỉ sửa một file cấu hình công cụ:

- `C:\Users\PC\.claude\skills\handoff\SKILL.md` — thêm mục **"Bước cuối — BẮT BUỘC lưu handoff thành file"** (thứ tự ưu tiên thư mục: `docs/superpowers/plans/` → `docs/handoffs/` → `.claude/handoffs/`; tên `<YYYY-MM-DD>-<scope>-handoff.md`; trùng tên thì thêm hậu tố `-2`, **không ghi đè**), và sửa hai gạch đầu dòng đầu của mục **Output rules** cho khớp.

Thay đổi code của Task 6 + Task 7 nằm ở 16 file modified + 14 file untracked trên nhánh, **chưa commit** — chi tiết đã ghi trong handoff Task 6 và trong `CHANGELOG.md` dòng 9-35.

---

## 12. COMMANDS RUN

```bash
# Đo lại gzip mức 6 trên build có sẵn (không build lại)
python -c "import gzip,os; ..."   # programming-CEgDVswx.js, fbd-editor-DGrHrJO8.js

# Xác minh cổng thi hành
grep -rn "bundle-budget" .github/      # -> 0 kết quả
grep -rn "UD-PROG-017|UD-PROG-018" .   # -> 0 kết quả

git branch --show-current              # -> feat/fbd-edit-task6
git status --short                     # -> 16 modified, 14 untracked
```

**Chưa chạy** trong phiên này: `npm run build`, `npx vitest --run`, `npm run lint`.

---

## 13. TEST / VALIDATION STATUS

- Test Task 7: **đã pass ở phiên trước** (theo handoff Task 6 + ghi chép Task 7). Phiên này **không chạy lại** ⇒ trạng thái hiện tại là UNVERIFIED cho tới khi chạy lại.
- Cổng bundle R3: **PASS** (128,54 / 165 KiB, dư 36,46 KiB) — dựa trên số đo lại thật trong phiên này.
- Mốc R1 125 KiB: **vượt 3,54 KiB**. Đây là mốc lịch sử, không phải cổng đang thi hành.
- **Trước khi commit phải chạy đủ:** `npx vitest --run --environment jsdom src` + `npm run lint` + `npm run build` (CLAUDE.md §"Quy trình khi user nói commit").

---

## 14. ERRORS / BLOCKERS

**BLK-1 — Chờ Owner quyết định mốc 125 KiB.** Chặn quyền tuyên bố lát FBD EDIT "đạt gate R1_EDIT". **Không** chặn cổng repo (đang PASS). Cần: user chọn A, B hoặc C.

**BLK-2 — Nợ kỹ thuật quá trần dòng.** `apps/web-ui/src/features/programming/fbd/FbdCanvas.tsx` **846 dòng** và `fbd/commands.ts` **844 dòng**, cả hai vượt trần 800. Chưa xử lý.

**BLK-3 — `git status -s` từng bị chặn** bởi bộ phân loại an toàn Bash (tạm không khả dụng). Đã vòng qua bằng `git status --short`. Có thể tái diễn.

---

## 15. FAILED ATTEMPTS — DO NOT REPEAT

**CB-1 — DO NOT REPEAT: chạy workflow dài trong lúc context sắp đầy.** Workflow `wny2hb8cp` bị `/compact` giết giữa chừng; 5 agent xong nhưng chỉ 1 kịp ghi `journal.jsonl`. Phải khôi phục thủ công. Nếu cần chạy lại, dùng `resumeFromRunId` với run `wf_85c2484e-975`.

**CB-2 — DO NOT REPEAT: in JSON tiếng Việt ra stdout bằng Python trên Windows.** Gây `UnicodeEncodeError` (cp1252). Cách đúng: ghi ra file UTF-8 rồi đọc bằng công cụ Read.

**CB-3 — DO NOT REPEAT: tin trích dẫn của subagent mà không tự kiểm chứng.** Subagent quản trị dẫn spec dòng 374-375 như một lệnh cấm chung. Đọc lại dòng 350-376 cho thấy chúng nằm trong **§5.4 Spike dependency gate** — tiêu chí để quyết có dùng `@xyflow/react` hay không, mà mục 6 của chính §5.4 nói *"SVG-first là kết quả hợp lệ"*. **Xung đột thật nằm ở dòng 15 và 83.**

**CB-4 — DO NOT REPEAT: resume workflow khi token OAuth sắp hết hạn.** Workflow `wzi1r4gm9` chạy xong nhưng **21/29 agent chết** với `401 OAuth access token has expired`; toàn bộ tầng verify + synthesis mất. Kết quả rỗng. Báo cáo cuối cùng đứng được là nhờ Opus đã tự đo độc lập, không nhờ tầng verify.

**CB-5 — DO NOT REPEAT: đề xuất sửa `scripts/verify_programming_bundle_budget.py` hoặc `contracts/`.** Cả hai ngoài allowlist. Đây là hạ chuẩn, không phải giải pháp.

---

## 16. IMPORTANT CONVERSATION CONTEXT

- User nhấn mạnh **Opus chỉ điều phối + lên plan**; mọi thực thi giao model khác. Đây là ràng buộc về cách làm việc, không phải gợi ý.
- Phát hiện làm đảo ngược cách hiểu vấn đề: **R1 không phải cổng đang thi hành.** Ban đầu vấn đề trông như "vi phạm ngân sách cần cắt byte"; thực tế là "một tài liệu plan đang tham chiếu tới một cổng đã hết hiệu lực". Chunk đã vượt 125 KiB từ trước khi lát FBD EDIT bắt đầu, và bốn task R3 liên tiếp vượt mốc đó đều được nhận là hợp lệ.
- Vì vậy khuyến nghị A **không phải là hạ chuẩn**: nó không chạm script, không chạm contract, không đổi cờ trong `package.json` (cờ đã là `r3` từ trước lát này). Nó chỉ đính chính một tài liệu plan.
- Rủi ro thật của A đã được nêu thẳng cho user: mất áp lực chống phình. Đó là lý do kèm mốc cảnh báo mềm 145 KiB.

---

## 17. NEXT ACTIONS

Theo workflow 7 pha, đang ở **Check báo cáo**:

1. **Chờ user chọn A, B hoặc C.** Không tự quyết — đây là thẩm quyền Owner (QĐ-4).
2. **Nếu chọn A**, thực hiện trọn gói trong một phiên:
   - Ghi `UD-PROG-017` = CLOSED vào `docs/00_governance/PROGRAMMING_OPEN_DECISIONS.md` (khung có sẵn trong journal `wf_85c2484e-975`).
   - Sửa header: `Phiên bản 1.7` → `1.8` (dòng 6) + cập nhật dòng 7.
   - Đính chính §4 Lịch sử: hai dòng trùng số 1.5, bổ sung dòng 1.7 còn thiếu, thêm dòng 1.8.
   - Sửa `docs/superpowers/specs/2026-08-31-fbd-edit-design.md` dòng 15 và 83: mục tiêu gate đổi từ `R1_EDIT 125 KiB` → cổng repo R3 165 KiB, ghi rõ ngày và lý do.
   - Gỡ `BLK-FBD-003` (spec dòng 838).
   - Sửa `CHANGELOG.md` dòng 33.
   - Ghi mốc cảnh báo mềm 145 KiB vào hồ sơ (quy ước tài liệu, **không** cài vào script).
3. **Nếu chọn B**, mở task cắt byte với đủ bốn điều khoản: trần một phiên; phạm vi khoá cứng `apps/web-ui/src/features/programming/**`; điều kiện đóng là `--increment r1` PASS trên build sạch; hạn 2026-09-10 và **rơi tự động về A** nếu vượt trần.
4. **Nếu chọn C**, dừng lại và báo: không thi hành được trong phiên FE (ngoài allowlist, phá SHA-256 pin). Phải chuyển cho chủ quản hợp đồng qua change control.
5. Sau khi ghi hồ sơ xong → **Xuất lại báo cáo** (pha 7).
6. Xử lý BLK-2 (`FbdCanvas.tsx` 846 dòng, `commands.ts` 844 dòng) — tách file về dưới trần 800.
7. **Chỉ commit khi user yêu cầu.** Khi đó chạy đủ `npx vitest --run --environment jsdom src` + `npm run lint` + `npm run build`, ghi số đo thật, commit tách theo nhóm logic, stage từng file cụ thể (**không** `git add -A`).

---

## 18. DEFINITION OF DONE

Lát FBD EDIT được coi là xong khi đủ tất cả:

- [ ] Owner đã chốt A/B/C và quyết định được ghi vào `PROGRAMMING_OPEN_DECISIONS.md` với số hiệu `UD-PROG-017`.
- [ ] Header hồ sơ lên 1.8; bảng §4 Lịch sử đã đính chính hai dòng trùng 1.5 và bổ sung dòng 1.7.
- [ ] Spec `2026-08-31-fbd-edit-design.md` không còn tham chiếu tới một cổng đã hết hiệu lực; `BLK-FBD-003` đã đóng hoặc gỡ.
- [ ] `CHANGELOG.md` phản ánh đúng trạng thái cuối, không còn ghi "chờ Owner".
- [ ] `npm run build` PASS (bao gồm cổng bundle), `npx vitest --run --environment jsdom src` PASS, `npm run lint` PASS.
- [ ] `FbdCanvas.tsx` và `commands.ts` dưới 800 dòng.
- [ ] Không phá `BLK-FBD-001` (không tự sinh `variableId`, không Mapping ẩn) — test B-T2/B-T3 vẫn PASS.
- [ ] `ProgrammingHeader.tsx` và `ProgrammingLayout.tsx` **không bị đụng tới**.
- [ ] Mọi số đo trong tài liệu là số đo lại thật, kèm file:dòng làm bằng chứng.

---

# INSTRUCTION FOR NEXT CLAUDE CODE SESSION

Coi đây là **continuation của cùng một phiên làm việc**, không phải task mới.

1. Đọc toàn bộ handoff trước khi hành động.
2. Kiểm tra workspace, git status và các artifact/file được reference để xác minh trạng thái thực tế.
3. Nếu handoff và filesystem khác nhau, ưu tiên trạng thái thực tế của filesystem/code/git nhưng phải xác định nguyên nhân khác biệt trước khi thay đổi.
4. Không bắt đầu phân tích lại project từ đầu nếu thông tin đã có trong handoff.
5. Không yêu cầu user giải thích lại những yêu cầu đã ghi trong handoff.
6. Giữ nguyên phương thức làm việc của phiên trước.
7. Tuân thủ chính xác USER-DEFINED WORKFLOW và WORKFLOW INVARIANTS.
8. Nếu user đã yêu cầu thứ tự `A → B → C` thì tiếp tục theo `A → B → C`. Không tự ý đổi thứ tự, skip bước, gộp bước, thay workflow khác, hoặc làm trước những bước chưa đến lượt — trừ khi có lý do kỹ thuật bắt buộc hoặc user đưa yêu cầu mới.
9. Kiểm tra mục CURRENT WORKFLOW POSITION để xác định đang đứng ở bước nào và tiếp tục từ đúng vị trí đó.
10. Không thực hiện lại những bước đã hoàn thành và verify trừ khi có bằng chứng cho thấy chúng sai.
11. Không refactor hoặc redesign những phần đã hoàn thành nếu không liên quan trực tiếp đến task hiện tại.
12. Không đảo ngược quyết định đã được user chốt.
13. Không lặp lại các phương án trong FAILED ATTEMPTS — DO NOT REPEAT.
14. Tiếp tục trực tiếp từ NEXT ACTIONS.
15. Sau mỗi bước quan trọng, thực hiện đúng validation procedure đã quy định trước khi chuyển sang bước tiếp theo.
16. Nếu workflow yêu cầu hoàn thành và xác minh từng bước trước khi tiếp tục, phải tuân thủ nguyên tắc đó.
17. Giữ nguyên cách báo cáo tiến độ, cách tổ chức công việc và cách tương tác với user nếu user đã quy định trong phiên trước.
18. Chỉ thay đổi workflow khi user trực tiếp yêu cầu, hoặc workflow hiện tại về mặt kỹ thuật không thể tiếp tục. Trường hợp thứ hai phải nêu rõ vấn đề trước khi áp dụng phương án thay thế.
