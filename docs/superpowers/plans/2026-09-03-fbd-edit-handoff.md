# SESSION HANDOFF — FBD EDIT (MK-DDC-24)

## 1. SESSION OBJECTIVE

Triển khai tính năng **FBD EDIT** (Function Block Diagram editor, kéo-thả) cho web-ui của dự án MK-DDC-24 (DDC/BMS controller).

Trạng thái mục tiêu cuối: canvas FBD kéo-thả hoạt động đầy đủ theo spec, pass toàn bộ cổng kiểm (typecheck/lint/unit/E2E/bundle budget/docs harness), đóng được các blocker `BLK-FBD-*`.

**Phiên hiện tại KHÔNG viết mã sản phẩm.** Phiên này chỉ làm hai việc, cả hai đã xong:
1. Review spec FBD EDIT → kết luận **spec không cần sửa**.
2. Vá bản kế hoạch triển khai (`docs/superpowers/plans/2026-08-31-fbd-edit.md`) cho khớp baseline thật sau merge, rồi commit.

Yêu cầu gốc của user (2 message):
- Message 1: "hãy đọc các thông tin sau ( chưa code )" — đọc spec, báo cần sửa gì. Cấm code.
- Message 2: "được vá rồi rồi commit , yêu cầu multiagenr trong đó opus chỉ là điều phối hoặc suy luận hướng đi còn các công việc khác giao cho custom sonet và haiku làm đi ( hướng làm sẽ là kháo sát - lên plan - check plan - thực thi - báo cáo - check báo cáo - xuất lại báo cáo) ( opus chỉ làm việc lên plan , chia việc còn đâu để các model khác làm)"

---

## 2. USER REQUIREMENTS & HARD CONSTRAINTS

### Bắt buộc (từ project CLAUDE.md — luôn hiệu lực)
- **Luôn trả lời tiếng Việt**; viết docs/changelog/báo cáo/review bằng tiếng Việt. Chỉ giữ tiếng Anh cho thuật ngữ kỹ thuật/tên riêng không có bản dịch rõ (BACnet, Modbus, CRC, endian, watchdog, tên biến/hàm/API).
- **Mọi thay đổi code/config/deployment/documentation phải cập nhật `CHANGELOG.md`** dưới `[Unreleased]` trong cùng phiên. Không được bỏ qua trừ khi user nói rõ.
- **Giữ thay đổi FE cục bộ làm nguồn chân lý**; không ghi đè công việc FE cục bộ không liên quan.
- **Làm hết việc, không chừa lại.** Không báo cáo giữa chừng rồi để danh sách "còn lại/nên làm tiếp". Phát hiện lỗi trong phạm vi ⇒ sửa luôn.
- **Không hỏi lại những gì có thể tự quyết.** Chỉ dừng hỏi khi hành động không thể hoàn tác, phá huỷ dữ liệu, hoặc ảnh hưởng ra ngoài. Tạo nhánh, commit, chạy test, cài toolchain dev — tự làm.
- **Bị chặn một nhánh thì làm hết các nhánh còn lại**, rồi báo đúng mục bị chặn kèm lý do và thứ cần để mở khoá.
- Commit tách theo nhóm logic, Conventional Commits, thân bài **tiếng Việt** nêu **triệu chứng → nguyên nhân gốc → cách sửa**, kèm `Refs:`.

### Cấm (từ spec §1.4/§9 + plan §0.2)
- **KHÔNG sửa**: `apps/web-api/**`, `apps/core/**`, `firmware/**`, `contracts/**`, `scripts/**`.
- **KHÔNG dùng**: `git reset`, `git checkout --`, `git clean`, lệnh xoá diện rộng, `git add -A`, `git add .`, `git add -p` (tương tác, harness không chạy được).
- **KHÔNG push/PR/merge** trừ khi user yêu cầu rõ. Hiện đã ahead origin/main 5 commit, **chưa push** — đúng chủ ý.
- **Phải bảo toàn 4 file dirty của user** (không đụng, không commit hộ):
  - `apps/web-ui/e2e/programming.spec.ts`
  - `apps/web-ui/src/features/programming/layout/ProgrammingHeader.tsx`
  - `apps/web-ui/src/features/programming/layout/ProgrammingLayout.tsx`
  - `scripts/gate353-cpp.sh` (untracked)

### Quyết định user đã chốt trong phiên này
- **Giữ cổng bundle `r3`** trong `package.json`, KHÔNG đổi sang `r1`. User đã đọc và trả lời "okay đã hiểu đoạn giữ cổng".

---

## 3. WORKING METHOD / USER-DEFINED WORKFLOW

### USER-DEFINED WORKFLOW (nguyên văn yêu cầu của user)

**Phân vai model — BẮT BUỘC:**
- **Opus (agent chính)**: CHỈ điều phối, suy luận hướng đi, lên plan, chia việc. Nguyên văn: *"opus chỉ làm việc lên plan , chia việc còn đâu để các model khác làm"*.
- **Sonnet + Haiku (subagent)**: làm mọi việc còn lại — khảo sát, kiểm tra, thực thi sửa file, verify, viết báo cáo, kiểm báo cáo.

**Trình tự 7 pha — BẮT BUỘC, nguyên văn:**
```
khảo sát → lên plan → check plan → thực thi → báo cáo → check báo cáo → xuất lại báo cáo
```

Phiên hiện tại đã chạy đúng trình tự này (mở rộng thành 8 pha, thêm commit ở cuối):

| Pha | Model | Việc |
|---|---|---|
| 1. Khảo sát | haiku ×2 + sonnet ×1 | build config / ProgramsTab+reducer / docs gate |
| 2. Lên plan vá | **opus** | tổng hợp facts → quyết định các điểm vá |
| 3. Check plan | sonnet | soi bản vá ngược lại spec + facts |
| 4. Thực thi | sonnet | ghi file plan + CHANGELOG |
| 5. Verify | haiku | chạy `docs_iso_harness.py --expect`, `git diff --check` |
| 6. Báo cáo | sonnet | soạn report |
| 7. Check báo cáo | haiku | đối chiếu report vs diff thật |
| 8. Commit | **opus** | sau khi pha 7 sạch |

### SESSION-ESTABLISHED WORKFLOW (đã hình thành, dùng ổn định, giữ nguyên)

1. **Opus không tự chạy việc nặng.** Mọi khảo sát nhiều file, mọi thực thi sửa file, mọi verify → giao subagent. Opus chỉ chạy lệnh xác minh nhanh (1-2 lệnh `git`/`grep`) khi cần bác bỏ hoặc xác nhận báo cáo của subagent.
2. **Ghi chỉ thị ra file trung gian.** Opus viết quyết định vá vào file tạm `docs/superpowers/plans/.patch-decisions-fbd-edit.md` để subagent pha 3/4 đọc chung, xoá file này trước khi commit. (Đã xoá, đã commit.)
3. **Prompt subagent phải nêu đủ 5 thứ**: phạm vi chính xác (file/thư mục), đầu ra mong đợi + kích thước tối đa, điều kiện dừng, có được sửa file không, các facts/ràng buộc cần thiết.
4. **Tối đa 3 subagent chạy song song.**
5. **Không tin subagent mù quáng.** Đã có 3 lần subagent sai/opus sai trong phiên này — mọi con số quan trọng phải tự xác minh lại (xem mục 15).
6. **Đo thật, không đoán.** Khi user hỏi "có ảnh hưởng gì không", phải chạy lệnh đo rồi trả lời bằng số. Chính nguyên tắc này đã lật ngược 2 đề xuất sai của opus (xem mục 15).
7. **Xưng hô**: agent xưng "em", gọi user là "onii-chan". Giữ nguyên.
8. **Báo cáo dạng bảng**, ngắn gọn, có bằng chứng (lệnh + kết quả thật), phân tách rõ VERIFIED vs chưa kiểm.

### WORKFLOW INVARIANTS (không được phá vỡ)

- **Không viết mã sản phẩm khi chưa được lệnh.** Phiên này user nói rõ "chưa code"; sau đó chỉ cho phép vá plan + commit. Đến cuối phiên user vẫn **chưa** ra lệnh bắt đầu thực thi plan.
- **Không đụng 4 file dirty của user.**
- **Không sửa `scripts/`, `contracts/`, backend, firmware.**
- **Mọi thay đổi tài liệu phải qua `docs_iso_harness.py --expect` rc=0 trước khi commit.**
- **Phải chạy `PYTHONUTF8=1 python` chứ không `python3`** (xem mục 14).
- **Không khoảng trắng cuối dòng; code fence phải chẵn** trong mọi file docs.
- **CHANGELOG cập nhật cùng commit**, không để lại sau.
- **Không tự quyết những gì thuộc thẩm quyền Owner** (đổi contract, đổi cổng repo-wide).

---

## 4. CURRENT WORKFLOW POSITION

### Workflow cấp phiên (vá plan) — **ĐÃ HOÀN THÀNH TRỌN VẸN**

```
Workflow:          khảo sát → lên plan → check plan → thực thi → báo cáo → check báo cáo → xuất lại → commit
Completed:         TẤT CẢ (chạy 2 vòng: vòng 1 → commit 30750e17, vòng 2 sửa Task 1.5 → commit f0012cda)
Currently working: (không có việc dở)
Next:              chờ user ra lệnh bắt đầu THỰC THI plan
```

### Workflow cấp dự án (thực thi FBD EDIT) — **CHƯA BẮT ĐẦU**

```
Workflow:          Task 0 → 0.5 → 1 → 2 → 3 → 4 → 5 → 5.5 → 5.6(số hiệu 1.5) → 6 → 7 → 8 → 9 → 10 → 11
Completed:         (chưa task nào)
Currently working: (chưa bắt đầu)
Next:              Task 0.5 (gỡ chặn python3) là việc chạy được ngay đầu tiên
```

**Câu hỏi cuối cùng của opus mà user CHƯA trả lời:** *"Ba task chạy được ngay không cần chữ ký ai: 0.5 (shim python3) → 1 (baseline) → rồi chuỗi 3/4/5/5.5 → 5.6 (cắt bundle). Bắt đầu chứ ạ?"*

Phiên mới: **hỏi lại user có bắt đầu thực thi plan không**, hoặc nếu user đã nói tiếp thì làm theo. **Không tự ý bắt đầu code** khi user chưa xác nhận — nhưng nếu user nói "làm đi"/"tiếp đi" thì hiểu là cho phép và làm trọn theo CLAUDE.md §"Làm hết việc".

---

## 5. WORKSPACE / ENVIRONMENT

| Mục | Giá trị (VERIFIED) |
|---|---|
| Primary working dir (harness) | `e:\TuanDuong\INTERN\DDC24_project` |
| Repo thật | `e:\TuanDuong\INTERN\DDC24_project\MK-DDC-24` ← **mọi lệnh git/npm chạy ở đây** |
| Branch | `main`, ahead `origin/main` **5 commit**, chưa push |
| OS | Windows 11 Home Single Language 10.0.26200 |
| Shell | bash (Git Bash) |
| Node | v24.16.0 |
| npm | 11.6.2 |
| Python | `python` → **3.13.2 OK**; `python3` → **rc=49, stub WindowsApps, HỎNG** |
| Frontend | `apps/web-ui` — React 18 + TypeScript + Vite + Vitest + Playwright |
| Backend | `apps/web-api` (Go), `apps/core` (C++), `firmware/` |

Không có secret nào liên quan trong phiên này.

---

## 6. CURRENT VERIFIED STATE

### VERIFIED

**Git:**
- `git status -sb` → `## main...origin/main [ahead 5]`
- Dirty (của user, KHÔNG đụng): `apps/web-ui/e2e/programming.spec.ts`, `.../layout/ProgrammingHeader.tsx`, `.../layout/ProgrammingLayout.tsx`
- Untracked (của user, KHÔNG đụng): `scripts/gate353-cpp.sh`
- 6 commit gần nhất:
  ```
  f0012cda|2026-09-03T10:32:08+07:00|tundungney|docs(programming): sửa Task 1.5 — chunk programming đã tách sẵn, phải cắt bằng lazy-load
  30750e17|2026-09-03T10:19:05+07:00|tundungney|docs(programming): vá kế hoạch FBD EDIT theo baseline sau merge
  70d70c59|2026-09-03T09:10:44+07:00|tundungney|Merge remote-tracking branch 'origin/main'
  849950ee|2026-09-03T08:33:07+07:00|Mekong-HCM|fix(web-api): ISS-PIO-31 bước 3 (#375) (#444)
  0b40c1ca|2026-09-03T04:33:23+07:00|Mekong-HCM|fix(web-api): ISS-PIO-31 bước 2 (#375) (#443)
  6131df38|2026-09-03T03:49:41+07:00|Mekong-HCM|fix(web-api): ISS-PIO-31 bước 1 (#375) (#442)
  ```

**Artifacts:**
- `docs/superpowers/plans/2026-08-31-fbd-edit.md` — 63852 byte, **927 dòng**, đã commit
- `docs/superpowers/plans/2026-09-03-fbd-edit-patch-report.md` — 15564 byte, đã commit
- `docs/superpowers/specs/2026-08-31-fbd-edit-design.md` — 70008 byte, v0.3, **KHÔNG sửa trong phiên này**
- `docs/superpowers/specs/assets/` — 3 SVG target (desktop/tablet/mobile) từ phiên trước

**Cổng kiểm (chạy thật, kết quả cuối cùng):**
- `PYTHONUTF8=1 python scripts/docs_iso_harness.py --expect` → **rc=0, "PASS — mọi phép kiểm bắt buộc đạt"**
- `git diff --check` → rỗng
- `grep -c " $"` trên plan + CHANGELOG + report → **0/0/0**
- `grep -c '^```'` trên plan → **2** (chẵn)
- Bảng truy vết §14.2 → **38 dòng, khớp 1-1 với 38 ID `TC-FBD-*` trong spec**, không thừa không thiếu

**Số đo bundle (đo thật trên `build/web-ui/dist/assets`, gzip mức 6 — đúng mức script cổng dùng):**

| Chunk | raw KiB | gzip KiB |
|---|---|---|
| `programming-BP6ey2B3.js` | 614.34 | **157.20** |
| `index-DkRz-738.js` | 556.36 | 149.24 |
| `charts-CUKRAmjw.js` | 397.77 | 102.67 |
| `react-BFlICnJl.js` | 168.74 | 55.31 |
| `operations-BIENF4_G.js` | 91.60 | 26.38 |
| `modbus-rtu-CC_Kgzts.js` | 93.87 | 23.64 |
| `scheduler-DzNnkKDC.js` | 87.60 | 21.44 |
| `icons-BCNME9cq.js` | 29.21 | 9.50 |

Ngân sách `contracts/programming/pgm02_workspace_v1.json` §`nfr.frontend`: baseline 98 / R1 **125** / R2 145 / R3 165 KiB. **Cần cắt 32.2 KiB.**

**Sự thật cây mã (đã xác minh sau merge):**
- `apps/web-ui/src/app/App.tsx:77` → `lazy(() => import('../features/programming'))` — chunk programming ĐÃ tách sẵn
- `apps/web-ui/vite.config.ts` dòng 50–61 `manualChunks` chỉ tách `react`/`charts`(recharts)/`icons`(lucide-react)
- `apps/web-ui/vite.config.ts` `test.environment: 'jsdom'`, `test.include: ['src/**/*.{test,spec}.{ts,tsx}']`
- `ProgramsTab.tsx` — **3190 dòng / 174 701 byte** (giới hạn dự án 800 dòng)
- `function FbdEditorPane({` tại **dòng 2732**, đóng ~2832, ~101 dòng, **chưa export**
- Call site `<FbdEditorPane` tại **dòng 845**, 14 props
- Import chỉ `FbdEditorPane` dùng: `StructuredFbdEditor`, `canonicalFbdJson`, `fbdStatusFields`
- `parseFbdDocument` (dòng 2720–2730) **DÙNG CHUNG** (còn gọi ở dòng 359) → giữ lại
- `fbd/commands.ts` — `FbdEditorState` dòng 74–82, **KHÔNG có** `selectionRevision`; merge không đụng file này
- `design/DesignWorkspacePage.tsx` dòng 9 import tĩnh `ProgramsTab`, dòng 823 mount `<ProgramsTab />`
- `design/DesignWorkspacePage.test.tsx` — 5 chỗ `getByRole('complementary', { name: 'Thuộc tính' })` đồng bộ tại **dòng 274, 313, 323, 344, 370**
- `scripts/verify_programming_bundle_budget.py` `find_chunk` dòng 45–57 glob `programming-*.js`, `raise SystemExit` khi >1 file khớp
- Deps ngoài của `features/programming/`: **chỉ** `react`, `react-router-dom`, `lucide-react` — cả ba đã ở chunk riêng
- **7** script npm gọi `python3`: `generate:programming-errors`, `check:programming-errors`, `check:programming-st-keywords`, `check:programming-fbd`, `check:programming-st-keyboard`, `check:ui-strings`, `check:bundle-budget`
- `scripts/verify-project.sh` dòng 58–72 cũng gọi `python3`
- `\"check:bundle-budget\": \"python3 ../../scripts/verify_programming_bundle_budget.py --increment r3\"` ← **r3**
- Module có sẵn từ merge (KHÔNG hiện thực lại): `shared/diagnosticFreshness.ts`, `shared/ProblemsDrawer.tsx` (348 dòng), `design/inspector/inspectorContext.ts` (có `InspectorFbdBlockContext` d.138, `InspectorFbdPortView` d.129, `InspectorFbdConnectionContext` d.151)
- `ProgramsTab.tsx` dòng 10 đã `import { hashBufferSource }`, dòng 1125 đã xử lý `STALE`
- `api/generated/library_registry.ts` dòng 109: PID có `featureState: \"REVIEW_REQUIRED\"` + `iecClassification: \"MANUFACTURER_EXTENSION\"`; `design/library/libraryCatalog.ts` dòng 112–113 map sang `{ kind: 'REVIEW_REQUIRED' }`
- `shared/config.ts` mẫu flag: `isProgramsWorkspaceV2Enabled(flag) => flag === '1'`, `VITE_PROGRAMS_WORKSPACE_V2`
- `scripts/check_ui_strings.py`: bắt `pick('...')`; chuỗi TRƯỢT khi không có dấu tiếng Việt VÀ có ≥1 từ `ALWAYS_WRONG` hoặc ≥2 từ `AMBIGUOUS`; chạy trong `npm run lint`
- `scripts/docs_iso_harness.py` chỉ quét `docs/00_governance/`…`docs/07_records/`; **KHÔNG quét** `docs/superpowers/**` hay `CHANGELOG.md`
- Merge `70d70c59` kéo 4 commit upstream; diff `b066e5c6..HEAD` = **146 file / +12328 / −548**; **spec KHÔNG bị đụng**; **budget R1/R2/R3 KHÔNG đổi** (chỉ `openapiSha256` đổi)

### UNVERIFIED

- **Chưa chạy** `npm run build`, `npm test`, `npm run lint`, `npx vitest` trong phiên này. Trạng thái xanh/đỏ của FE **chưa biết**.
- **Chưa chạy** `verify_programming_bundle_budget.py` (đo gzip bằng script python inline thay thế, cùng thuật toán gzip mức 6 nhưng không qua script cổng).
- **Chưa biết** lazy-load `ProgramsTab` sẽ cắt được bao nhiêu KiB thật — ước 27.8% chunk theo raw size, chưa đo sau khi build lại.
- **Chưa biết** có test nào khác ngoài `DesignWorkspacePage.test.tsx` vỡ khi bọc `<Suspense>`.
- Số dòng từ survey-2 (sonnet, đọc trước merge) **đã lỗi thời** trừ 2 anchor đã tự xác minh lại (2732, 845).

---

## 7. COMPLETED WORK

### 7.1 Review spec — pha khảo sát+phân tích (opus + 3 subagent)
- **Kết luận: spec `docs/superpowers/specs/2026-08-31-fbd-edit-design.md` v0.3 KHÔNG cần sửa.**
- Verify: `git diff --stat b066e5c6 HEAD -- <spec>` → rỗng, merge không đụng spec.
- Thay vào đó phát hiện **13 vấn đề trong bản PLAN**, sau đó thành 20 sau vòng check.

### 7.2 Vòng vá 1 — commit `30750e17`
Áp **20 điểm vá** vào plan, chia 5 nhóm:

| Nhóm | Mã | Nội dung |
|---|---|---|
| A (chặn) | A1 | `python3` stub hỏng, 7 script npm + `verify-project.sh` gọi nó → thêm **Task 0.5** shim |
| | A2 | Cổng bundle thật là `r3` không phải `r1`; đổi `r3`→`r1` là quyết định Owner |
| | A3 | Không task nào gỡ `BLK-FBD-003` → thêm **Task 1.5** |
| | A4 | `expectedSelectionRevision` chỉ có trong văn xuôi → thêm `selectionRevision` vào `FbdEditorState` ở Task 3 |
| B (cao) | B1 | Plan commit 11 lần lên `main` → tạo nhánh `feat/fbd-edit` |
| | B2 | `ProgramsTab.tsx` 3190 dòng → thêm **Task 5.5** tách `FbdEditorPane` |
| | B3 | `git add -p` tương tác → thay bằng `git add <path>` theo allowlist |
| | B4 | Rollback dẫn feature flag không tồn tại → thêm `isFbdEditEnabled`/`FBD_EDIT_ENABLED`/`VITE_FBD_EDIT` |
| C (trung bình) | C1 | Thiếu cổng dấu tiếng Việt `check_ui_strings.py` |
| | C2 | Mâu thuẫn file E2E → chốt `e2e/fbd-edit.spec.ts`, không đụng `programming.spec.ts` |
| | C3 | Đụng tên `ProgramsTab.test.ts` vs `.tsx` → đổi thành `FbdEditorPane.test.tsx` |
| | C4 | Lệnh PowerShell trong shell bash; `--environment jsdom` thừa |
| | C5 | Truy vết map theo `DD-*` chứ không theo `TC-FBD-*` → thêm bảng §14.2 đủ 38 ID |
| D (do merge) | D1 | Task 10 Step 2 thừa → tái dùng `shared/diagnosticFreshness.ts` |
| | D2 | Task 9 Problems thừa → tái dùng `shared/ProblemsDrawer.tsx` |
| | D3 | Task 7 Inspector thừa một phần → nối UI vào `inspectorContext.ts` có sẵn |
| | D4 | `BLK-FBD-005` đã có chốt code `REVIEW_REQUIRED` cho PID |
| E (do pha check) | E1 | Plan tự mâu thuẫn: §0.2 cấm đụng vs Task 8 lại sửa `ProgrammingHeader/Layout` → chuyển sang composition qua `DesignWorkspacePage.tsx` |
| | E2 | §0.2 còn ghim SHA cũ `b066e5c6` → đổi sang `70d70c59` |
| | E3 | E2E mới thiếu mock route/storage state |

Plan **814 → 871 dòng**. CHANGELOG thêm entry `PLAN-FBD-EDIT` (#376, 2026-09-03).

### 7.3 Vòng vá 2 — commit `f0012cda` (do user hỏi "có ảnh hưởng gì tới repo không")
Đo thật → phát hiện **Task 1.5 vừa viết đã sai**:
- Hướng "thêm `manualChunks` cho programming" → **vô ích**, `App.tsx:77` đã `lazy()`, chunk tách sẵn
- Hướng "thêm `React.lazy` cho route" → **đã có**, cùng dòng 77
- Chunk nặng **không phải do dependency**, là 614 KiB mã nguồn viết tay

Viết lại Task 1.5 thành:
- Step 1: ghi rõ **2 việc KHÔNG cần làm** (để người thực thi không lặp lại)
- Step 2: lazy-load `ProgramsTab.tsx` (174 701 byte, 27.8% chunk) trong `DesignWorkspacePage.tsx`
- **Step 2b (mới, do sonnet phát hiện)**: sửa 5 chỗ `getByRole` → `findByRole`/`waitFor` trong `DesignWorkspacePage.test.tsx` dòng 274/313/323/344/370, cùng commit để không có commit trung gian đỏ
- Step 3: chunk lười **phải đặt tên `fbd-editor-*.js`**, không được khớp glob `programming-*.js` (nếu khớp, `find_chunk` fail cứng với thông báo sai "thư mục build còn rác")
- Step 4: `rm -rf build/web-ui/dist` trước khi build lại, rồi đo r1/r3
- Step 5: commit

Đổi số hiệu thực thi thành **Task 5.6** (phụ thuộc Task 5.5), dời nhánh trong đồ thị §12. Sửa 4 chỗ khác còn nhắc "manualChunks" (§0.3 dòng 52, §12 đồ thị, §14 truy vết, §15 definition-of-done). Sửa CHANGELOG cho khớp.

Plan **871 → 927 dòng**.

### 7.4 Báo cáo
`docs/superpowers/plans/2026-09-03-fbd-edit-patch-report.md` — 7 mục (tóm tắt / bối cảnh / bảng 20 điểm / 3 task mới / bằng chứng / việc còn mở / phạm vi không chạm). Pha 7 (haiku) bắt được **1 số bịa** (khai "42 code fence", thật là 2) + 1 vị trí ghi thừa (B4 "dòng 235") — **cả hai đã sửa** trước khi commit.

---

## 8. WORK IN PROGRESS

**Không có việc dở.** Cả hai vòng vá đã hoàn tất, verify sạch, commit xong.

Điểm dừng chính xác: opus vừa hỏi user *"Ba task chạy được ngay không cần chữ ký ai: 0.5 → 1 → 3/4/5/5.5 → 5.6. Bắt đầu chứ ạ?"* rồi user gọi `/handoff`. **User chưa trả lời câu hỏi đó.**

---

## 9. IMPORTANT DECISIONS

| # | Quyết định | Ai chốt | Lý do |
|---|---|---|---|
| 1 | **Spec KHÔNG sửa** | opus, user duyệt ngầm ("được vá rồi rồi commit") | Merge không đụng spec; budget không đổi; 20 vấn đề đều nằm ở plan |
| 2 | **Giữ cổng `r3` trong `package.json`, KHÔNG đổi sang `r1`** | **user chốt rõ** ("okay đã hiểu đoạn giữ cổng") | Đổi cờ ảnh hưởng mọi nhánh + CI; `r1` chỉ là mốc riêng giai đoạn FBD. Task 1.5/5.6 đo `r1` bằng lệnh trực tiếp thay vì đổi cổng |
| 3 | **Cắt bundle bằng lazy-load `ProgramsTab`**, không phải `manualChunks` | opus (sau khi đo) | Chunk đã tách sẵn; deps đã tách; phần nặng là mã nguồn |
| 4 | **Chunk lười tên `fbd-editor-*.js`** | opus | Tránh `find_chunk` glob `programming-*.js` fail cứng. Không sửa script vì ngoài allowlist |
| 5 | **Không sửa `verify_programming_bundle_budget.py`** | opus | `scripts/` ngoài allowlist FE spec §1.4 |
| 6 | **Không sửa `contracts/programming/pgm02_workspace_v1.json`** | opus | Contract ngoài allowlist; nới budget R1 là quyết định Owner |
| 7 | **Task 1.5 đọc là Task 5.6 khi thực thi** | opus (sonnet đề xuất) | Số hiệu 1.5 nhưng phụ thuộc Task 5.5; giữ số cũ để không vỡ tham chiếu chéo, thêm ghi chú thứ tự |
| 8 | **Tạo nhánh `feat/fbd-edit` trước khi thực thi** | opus | CLAUDE.md cấm commit thẳng nhánh mặc định |
| 9 | **Xoá file chỉ thị tạm trước khi commit** | opus | `.patch-decisions-fbd-edit.md` là scaffolding, không thuộc deliverable |
| 10 | **Chưa push** | user (chưa yêu cầu) | Ahead 5 commit, đúng chủ ý |

---

## 10. RELEVANT FILES & ARTIFACTS

### Tài liệu (đã commit)
- `docs/superpowers/specs/2026-08-31-fbd-edit-design.md` — **AUTHORITY**, v0.3, 925 dòng. Chứa `DD-01..DD-13`, 38 `TC-FBD-*`, 7 blocker `BLK-FBD-001..007`, transport boundary, atomic action payload. **KHÔNG sửa.**
- `docs/superpowers/specs/assets/` — 3 SVG target desktop/tablet/mobile.
- `docs/superpowers/plans/2026-08-31-fbd-edit.md` — **KẾ HOẠCH THỰC THI**, 927 dòng, đã vá 2 vòng. Đây là file dẫn đường cho mọi việc tiếp theo.
- `docs/superpowers/plans/2026-09-03-fbd-edit-patch-report.md` — báo cáo đợt vá.
- `CHANGELOG.md` — entry `PLAN-FBD-EDIT` (#376, 2026-09-03) dưới `[Unreleased]`.

### Mục lục plan (heading thật, đã verify)
```
13:  ## 0. Điều kiện thực thi và ranh giới
60:  ## 0.5. Gỡ chặn interpreter (Task 0.5)
91:  ## 1. Baseline, spike và quyết định dependency
158: ## 1.5. Cắt chunk programming xuống ngân sách R1 (Task 5.6 — Bundle Optimization)
254: ## 2. Preference store, viewport math và feature flag
305: ## 3. Selection model, clipboard và atomic reducer actions
358: ## 4. Geometry, grid, wire routing và Auto Layout preview
402: ## 5. SVG canvas viewport và pointer/touch interaction
451: ## 5.5. Tách FbdEditorPane ra module riêng (Task 5.5)
492: ## 6. Quick Library placement và typed wiring
548: ## 7. I/O picker, Inspector và node presentation
597: ## 8. Shell, network views, docks và theme
652: ## 9. Workbench, diagnostics, status and Auto Layout controls
700: ## 10. Save/Check boundary và stale/error handling
743: ## 11. End-to-end, accessibility, performance and bundle gate
813: ## 12. Dependency graph and checkpoints
838: ## 13. Rollback and stop rules
849: ## 14. Plan traceability
915: ## 15. Definition of done for this plan
```

### Mã nguồn sẽ đụng khi thực thi
- `apps/web-ui/src/features/programming/design/editor/ProgramsTab.tsx` — 3190 dòng, tách `FbdEditorPane` (d.2732) ở Task 5.5, lazy-load ở Task 5.6
- `apps/web-ui/src/features/programming/design/DesignWorkspacePage.tsx` — d.9 import tĩnh, d.823 mount; Task 5.6 + Task 8 (composition)
- `apps/web-ui/src/features/programming/design/DesignWorkspacePage.test.tsx` — 5 chỗ `getByRole` phải sửa ở Task 5.6 Step 2b
- `apps/web-ui/src/features/programming/fbd/commands.ts` — `FbdEditorState` d.74–82, thêm `selectionRevision` ở Task 3
- `apps/web-ui/src/shared/config.ts` — thêm `isFbdEditEnabled`/`FBD_EDIT_ENABLED` ở Task 2
- `apps/web-ui/vite.config.ts` — `manualChunks` d.50–61, chỉ đặt `chunkFileNames` ở Task 5.6 Step 3
- `apps/web-ui/e2e/fbd-edit.spec.ts` — **file mới**, Task 11

### Tái dùng, KHÔNG hiện thực lại
- `apps/web-ui/src/features/programming/shared/diagnosticFreshness.ts`
- `apps/web-ui/src/features/programming/shared/ProblemsDrawer.tsx`
- `apps/web-ui/src/features/programming/design/inspector/inspectorContext.ts`
- `apps/web-ui/src/features/programming/design/library/libraryCatalog.ts` + `api/generated/library_registry.ts` (PID `REVIEW_REQUIRED`)

### Chỉ đọc, KHÔNG sửa
- `scripts/verify_programming_bundle_budget.py`, `scripts/check_ui_strings.py`, `scripts/docs_iso_harness.py`, `scripts/verify-project.sh`
- `contracts/programming/pgm02_workspace_v1.json`, `contracts/programming/fbd_v1.schema.json`

### Của user, TUYỆT ĐỐI KHÔNG ĐỤNG
- `apps/web-ui/e2e/programming.spec.ts` (M)
- `apps/web-ui/src/features/programming/layout/ProgrammingHeader.tsx` (M)
- `apps/web-ui/src/features/programming/layout/ProgrammingLayout.tsx` (M)
- `scripts/gate353-cpp.sh` (??)

---

## 11. CODE CHANGES

**Không có thay đổi mã sản phẩm nào trong phiên này.** Chỉ sửa 3 file tài liệu:

| File | Thay đổi | Lý do |
|---|---|---|
| `docs/superpowers/plans/2026-08-31-fbd-edit.md` | 814 → 871 → **927 dòng**; 20 điểm vá + viết lại Task 1.5 | Plan lệch baseline sau merge; Task 1.5 vòng 1 mô tả việc vô ích |
| `CHANGELOG.md` | +28 dòng entry `PLAN-FBD-EDIT`; −1 dòng sửa "bản 0.2"→"bản 0.3" | CLAUDE.md bắt buộc; spec đã lên v0.3 |
| `docs/superpowers/plans/2026-09-03-fbd-edit-patch-report.md` | File mới 126 dòng | Pha 6 của workflow |

File tạm `docs/superpowers/plans/.patch-decisions-fbd-edit.md` đã tạo rồi **xoá** trước commit — scaffolding, không phải deliverable.

---

## 12. COMMANDS RUN

```bash
# Tất cả chạy tại e:/TuanDuong/INTERN/DDC24_project/MK-DDC-24

# Docs gate — LƯU Ý phải có PYTHONUTF8=1, xem mục 14
PYTHONUTF8=1 python scripts/docs_iso_harness.py --expect     # rc=0 PASS

# Kiểm định dạng
git diff --check                                              # rỗng
grep -c " $" docs/superpowers/plans/2026-08-31-fbd-edit.md    # 0
grep -c '^```' docs/superpowers/plans/2026-08-31-fbd-edit.md  # 2 (chẵn)
wc -l docs/superpowers/plans/2026-08-31-fbd-edit.md           # 927

# Đo bundle (script inline, gzip mức 6 = đúng mức script cổng dùng)
for f in build/web-ui/dist/assets/*.js; do python -c "
import gzip,sys,os;p=sys.argv[1];b=open(p,'rb').read()
print(f'{os.path.basename(p):32s} raw={len(b)/1024:8.2f} gz={len(gzip.compress(b,6))/1024:8.2f} KiB')\" \"$f\"; done

# Đọc contract budget
python -c "
import json;c=json.load(open('contracts/programming/pgm02_workspace_v1.json',encoding='utf-8'))['nfr']['frontend']
[print(f'{k}: {v}') for k,v in c.items()]"

# Git
git log -6 --format='%h|%cI|%an|%s' | cat     # dùng | cat, nếu không output bị garble
git add <path cụ thể>                          # KHÔNG dùng -A / . / -p
git commit -F -  <<'EOF' ... EOF               # heredoc cho thân bài tiếng Việt nhiều dòng
```

**CHƯA chạy** (cần chạy khi bắt đầu thực thi): `npm run build`, `npm test`, `npm run lint`, `npx vitest --run src`, `npx playwright test`, `verify_programming_bundle_budget.py`.

---

## 13. TEST / VALIDATION STATUS

| Hạng mục | Trạng thái | Bằng chứng |
|---|---|---|
| `docs_iso_harness.py --expect` | **PASS** | rc=0, "PASS — mọi phép kiểm bắt buộc đạt", "EXPECT: khớp toàn bộ ngưỡng" |
| `git diff --check` | **PASS** | output rỗng |
| Trailing whitespace | **PASS** | 0 trên plan, CHANGELOG, report |
| Code fence chẵn | **PASS** | 2 (cột đầu dòng); 68 nếu tính cả thụt lề — cả hai đều chẵn |
| Truy vết `TC-FBD-*` | **PASS** | §14.2 có 38 dòng, khớp 1-1 với 38 ID trong spec |
| Báo cáo vs diff thật | **PASS sau sửa** | haiku bắt 1 số bịa (42 fence) + 1 vị trí thừa; cả hai đã vá |
| FE typecheck | **CHƯA CHẠY** | — |
| FE lint | **CHƯA CHẠY** | bị chặn bởi `python3` (Task 0.5) |
| FE unit test | **CHƯA CHẠY** | — |
| FE build | **CHƯA CHẠY** | bị chặn bởi `python3` (Task 0.5) |
| E2E Playwright | **CHƯA CHẠY** | — |
| Bundle budget script | **CHƯA CHẠY** | đo bằng script inline thay thế |

**Không được ghi "working"/"xanh" cho bất kỳ mục CHƯA CHẠY nào.**

---

## 14. ERRORS / BLOCKERS

### BLOCKER MÔI TRƯỜNG (chặn thực thi ngay)

**B-ENV-1: `python3` là stub WindowsApps, rc=49**
- Triệu chứng: `python3 --version` → rc=49, "Python không tìm thấy". `python --version` → 3.13.2 OK.
- Ảnh hưởng: **7 script npm** + `scripts/verify-project.sh` d.58–72 gọi `python3` ⇒ `npm run lint` và `npm run build` sẽ hỏng vì lý do **không liên quan FBD**.
- Cách gỡ: **Task 0.5** — tạo shim `python3` → `python` trong PATH của shell dev (alias/`.bashrc`/wrapper script). **KHÔNG sửa `package.json`** (file chung, đổi sẽ hỏng CI Linux).
- Tiêu chí xong: `python3 --version` in ra 3.13.2.

**B-ENV-2: console Windows cp1252 làm `docs_iso_harness.py` crash**
- Triệu chứng: `UnicodeEncodeError: 'charmap' codec can't encode character '\u1ec7'`, rc=1.
- **KHÔNG phải lỗi nội dung file.** Ép UTF-8 là qua: `PYTHONUTF8=1 python scripts/docs_iso_harness.py --expect` → rc=0 PASS.
- **Luôn dùng `PYTHONUTF8=1` khi chạy script python có output tiếng Việt.**

### BLOCKER DỰ ÁN (`BLK-FBD-*`)

| Mã | Nội dung | Trạng thái | Cần gì để mở |
|---|---|---|---|
| `BLK-FBD-003` | R1 bundle 157.20 > 125 KiB, cần cắt 32.2 | **MỞ** — Task 5.6 mới lập kế hoạch, **chưa chạy** | Thực thi Task 5.6, đo lại. Nếu vẫn vượt → Owner quyết nới `r1ProgrammingChunkGzipBudgetKiB` |
| `BLK-FBD-006` | Client chưa có timeout policy | **MỞ** | Đề xuất: `AbortSignal.timeout` (stdlib, không thêm dep), bọc ở tầng client fetch chung. Cần user cho 2 ngưỡng: Save (ngắn) / Check (dài, compile tốn thời gian) |
| `BLK-FBD-004` | Chưa có browser evidence + axe | **MỞ** | Chạy Playwright/axe trên máy có browser, nộp artifact. **Ngoài phạm vi code** |
| `BLK-FBD-005` | PID chưa Controls+Safety review | **Đã chốt kỹ thuật** — `featureState: "REVIEW_REQUIRED"` trong `library_registry.ts:109`, `libraryCatalog.ts:112-113` chặn | Chữ ký Controls+Safety. **Ngoài phạm vi code** |
| `BLK-FBD-007` | Baseline chưa sign-off | **MỞ** | Chữ ký Owner. **Ngoài phạm vi code** |

### CẠM BẪY ĐÃ BIẾT (phải tránh khi thực thi)

1. **Chunk lười không được mang tiền tố `programming-`** — `find_chunk` (`verify_programming_bundle_budget.py` d.45–57) thấy >1 file khớp `programming-*.js` sẽ `raise SystemExit` với thông báo SAI ("thư mục build còn rác của lần trước"). Đặt `fbd-editor-*.js`.
2. **Phải `rm -rf build/web-ui/dist` trước khi build lại** — cùng lý do trên, chunk băm cũ còn sót sẽ làm cổng fail.
3. **Bọc `<Suspense>` quanh `ProgramsTab` làm `DesignWorkspacePage.test.tsx` đỏ** — 5 chỗ `getByRole('complementary')` đồng bộ (d.274/313/323/344/370). Sửa sang `findByRole`/`waitFor` **trong cùng commit**.
4. **`git log` bị garble qua Bash tool** — thêm `| cat` và dùng `--format='%h|%cI|%an|%s'`.
5. **`python3 -c "..."` có vẻ rc=0 khi đọc output inline** — phải redirect ra file rồi kiểm `$?` riêng mới thấy rc=49 thật.
6. **`git add` cảnh báo CRLF→LF trên `CHANGELOG.md`** — vô hại, đã xảy ra ở commit `f0012cda`.

---

## 15. FAILED ATTEMPTS — DO NOT REPEAT

### DO NOT REPEAT #1 — thêm `programming` vào `manualChunks`
- Đã đề xuất, đã viết vào plan (commit `30750e17` Task 1.5 Step 2).
- **Sai.** `App.tsx:77` đã `lazy(() => import('../features/programming'))`; Rollup tách chunk theo dynamic import từ trước. `build/web-ui/dist/assets/programming-BP6ey2B3.js` đã tồn tại.
- Tiết kiệm **0 KiB**. Đã gỡ khỏi plan ở commit `f0012cda`.

### DO NOT REPEAT #2 — thêm `React.lazy` cho route programming
- Đã đề xuất. **Sai — đã có sẵn**, cùng dòng `App.tsx:77`. Tiết kiệm **0 KiB**.

### DO NOT REPEAT #3 — soi dependency nặng trong chunk programming
- Đã kiểm: import ngoài của `features/programming/` **chỉ** gồm `react`, `react-router-dom`, `lucide-react` — cả ba đã ở chunk riêng (`react`, `icons`). Không có `date-fns`/`zod`/`monaco`/`codemirror`.
- 614 KiB raw là **mã nguồn dự án viết tay**, không phải dep. Đừng đi tìm dep nặng nữa.

### DO NOT REPEAT #4 — sửa `scripts/verify_programming_bundle_budget.py` để chấp nhận nhiều chunk
- Cách "dễ" nhưng **sai**: `scripts/` ngoài allowlist FE (spec §1.4). Giải pháp đúng là đặt tên chunk tránh glob.

### DO NOT REPEAT #5 — đổi `check:bundle-budget` từ `r3` sang `r1` trong `package.json`
- **User đã chốt GIỮ `r3`.** Đo `r1` bằng lệnh trực tiếp `python scripts/verify_programming_bundle_budget.py --increment r1`.

### Sai lầm đã sửa (ghi để cảnh giác, không phải cấm)
- **Opus đếm nhầm 6 script `python3`, thật là 7.** Nguyên nhân: đọc `package.json` trước merge (merge thêm `check:programming-st-keyboard`). Haiku đúng, opus sai.
- **Sonnet pha 6 bịa số "42 code fence"** — thật là 2 (hoặc 68 nếu tính thụt lề). Haiku pha 7 bắt được. → **Mọi con số trong báo cáo subagent phải verify lại.**
- **Haiku pha 5 báo FAIL giả** cho `docs_iso_harness.py` do cp1252; opus bác đúng bằng `PYTHONUTF8=1`.
- **Haiku pha 5 cảnh báo giả** về `git add -p` còn sót — thật ra nằm trong mệnh đề **cấm**, hợp lệ.
- **Opus tự báo động giả** về `TC-FBD-A11Y-001` "thừa" — regex `[A-Z]*` không khớp `A11Y` (có chữ số). Spec có đúng 38 ID, bảng khớp hoàn hảo.

---

## 16. IMPORTANT CONVERSATION CONTEXT

- **User đọc kỹ và hỏi truy vấn.** Câu "này có ảnh hưởng gì tới repo không" đã lật ngược 2 đề xuất sai của opus. Khi user hỏi về ảnh hưởng/rủi ro → **phải đo thật rồi trả lời bằng số**, không suy đoán.
- **User rất coi trọng phân vai model.** Yêu cầu 2 lần trong cùng 1 message rằng opus chỉ điều phối. Phiên sau phải giữ: opus không tự làm việc nặng, giao subagent.
- **User dùng "chốt plan chưa?" như câu hỏi trạng thái nghiêm túc.** Trả lời trung thực — lúc đó plan CHƯA chốt vì Task 1.5 sai, và opus đã nói thẳng "Chưa chốt" rồi sửa.
- **Trade-off đã chấp nhận**: giữ số hiệu `Task 1.5` dù nó chạy sau Task 5.5 (thay vì đánh số lại toàn bộ) — để không vỡ tham chiếu chéo trong plan; bù bằng ghi chú "đọc là Task 5.6".
- **Trade-off đã chấp nhận**: lazy-load `ProgramsTab` làm tab Design tải chậm hơn ~vài trăm ms lần đầu (có spinner) — đổi lấy 32.2 KiB. User chưa phản đối.
- **Phong cách báo cáo user quen**: bảng có cột "Kết quả"/"Bằng chứng", nêu thẳng cái sai của chính mình, phân biệt rõ "đã verify" vs "chưa chạy".
- **User chưa yêu cầu push.** Đừng tự push.
- **Ý định thực sự của user**: muốn plan đủ chắc để thực thi không vấp, chứ không phải plan đẹp. Mọi điểm vá đều xuất phát từ "nếu chạy thật thì hỏng ở đâu".

---

## 17. NEXT ACTIONS

Workflow dự án: `Task 0 → 0.5 → 1 → 2 → 3 → 4 → 5 → 5.5 → 5.6 → 6 → 7 → 8 → 9 → 10 → 11`
Vị trí hiện tại: **chưa bắt đầu task nào**. Plan đã chốt và commit.

### Bước 0 (ngay lập tức)
Xác nhận với user có bắt đầu thực thi plan không. Nếu user đã nói "bắt đầu"/"làm đi"/"tiếp đi" ⇒ chạy trọn theo CLAUDE.md §"Làm hết việc, không chừa lại", không hỏi lại từng bước.

### Nếu được phép thực thi — theo đúng thứ tự

1. **Task 0** (`plan §0`, dòng 13) — xác lập ranh giới, allowlist, **tạo nhánh `feat/fbd-edit`**. Không commit lên `main`.
2. **Task 0.5** (`plan §0.5`, dòng 60) — shim `python3` → `python`. Verify: `python3 --version` in 3.13.2. **Chặn tất cả task sau có `npm run lint`/`build`.**
3. **Task 1** (`plan §1`, dòng 91) — baseline + spike + đo số thật. Verify: `npm run build` chạy được (sau Task 0.5), ghi số đo thật vào plan.
4. **Task 2** (`plan §2`, dòng 254) — preference store, viewport math, **tạo `isFbdEditEnabled`/`FBD_EDIT_ENABLED`** trong `shared/config.ts` theo khuôn `isProgramsWorkspaceV2Enabled`. Verify: `npm run lint` xanh (gồm `check:ui-strings`).
5. **Task 3** (`plan §3`, dòng 305) — **bước đầu tiên: thêm `selectionRevision: number` vào `FbdEditorState`** (`fbd/commands.ts` d.74–82), khởi tạo 0, tăng sau mỗi action đổi `document`/`selection` (batch atomic tăng đúng 1 lần). Chỉ sau đó mới được viết test tham chiếu `expectedSelectionRevision`.
6. **Task 4** (`plan §4`, dòng 358) — geometry/grid/wire routing/Auto Layout preview.
7. **Task 5** (`plan §5`, dòng 402) — SVG canvas viewport + pointer/touch.
8. **Task 5.5** (`plan §5.5`, dòng 451) — tách `FbdEditorPane` (d.2732, ~101 dòng) ra `design/editor/FbdEditorPane.tsx`. Chuyển theo `StructuredFbdEditor`/`canonicalFbdJson`/`fbdStatusFields`. **Giữ `parseFbdDocument` lại** (dùng chung d.359). Test đặt tên `FbdEditorPane.test.tsx`. Verify: `npx vitest --run src` xanh + `npm run typecheck` xanh + `ProgramsTab.tsx` giảm ~100 dòng.
9. **Task 5.6** (`plan §1.5`, dòng 158 — số hiệu 1.5) — lazy-load `ProgramsTab` + sửa test + đặt tên chunk `fbd-editor-*.js` + `rm -rf build/web-ui/dist` + build + đo r1/r3. Đóng hoặc lượng hoá `BLK-FBD-003`.
10. **Task 6** (`plan §6`, dòng 492) — Quick Library placement, typed wiring, khoá PID theo `REVIEW_REQUIRED`.
11. **Task 7** (`plan §7`, dòng 548) — **nối UI vào `inspectorContext.ts` có sẵn**, không định nghĩa lại context.
12. **Task 8** (`plan §8`, dòng 597) — shell/docks/theme **qua composition ở `DesignWorkspacePage.tsx`**, tuyệt đối không sửa `ProgrammingHeader.tsx`/`ProgrammingLayout.tsx`.
13. **Task 9** (`plan §9`, dòng 652) — **tái dùng `shared/ProblemsDrawer.tsx`**, chỉ bơm dữ liệu FBD.
14. **Task 10** (`plan §10`, dòng 700) — **tái dùng `shared/diagnosticFreshness.ts`**, chỉ nối FBD vào `OpenBufferContext`.
15. **Task 11** (`plan §11`, dòng 743) — E2E `e2e/fbd-edit.spec.ts` (file MỚI, có mock route + storage state), a11y/axe, performance, bundle gate. **Không đụng `e2e/programming.spec.ts`.**

### Validation sau MỖI task (bắt buộc, không bỏ bước)
```bash
cd apps/web-ui
npx vitest --run src/features/programming     # KHÔNG thêm --environment jsdom (đã có trong vite.config.ts)
npm run typecheck
npm run lint                                   # gồm check:ui-strings — cần Task 0.5 xong trước
```
Task nào tạo chuỗi tiếng Việt mới ⇒ bắt buộc `npm run lint` xanh.
**Task pass mới được chuyển task tiếp theo.**

### Việc cần user quyết (hỏi khi tới lúc, không tự quyết)
- `BLK-FBD-006`: 2 ngưỡng timeout Save / Check. Nếu user không cho số → lấy mặc định hợp lý + ghi comment `ponytail:` nêu trần và đường nâng cấp.
- Nếu Task 5.6 đo xong vẫn vượt 125 KiB → báo số còn vượt, để Owner quyết nới `r1ProgrammingChunkGzipBudgetKiB` (KHÔNG tự sửa contract).
- Push / tạo PR: chỉ khi user yêu cầu.

---

## 18. DEFINITION OF DONE

### Cho đợt vá plan (phiên hiện tại) — **ĐÃ ĐẠT**
- [x] 20 điểm vá áp đủ vào plan
- [x] Task 1.5 sửa đúng sau khi đo thật
- [x] `CHANGELOG.md` cập nhật dưới `[Unreleased]`
- [x] `docs_iso_harness.py --expect` rc=0 PASS
- [x] `git diff --check` rỗng, 0 trailing whitespace, code fence chẵn
- [x] Truy vết 38/38 `TC-FBD-*` khớp spec
- [x] Báo cáo viết xong, được kiểm chéo, sửa mọi chỗ khai sai
- [x] Commit (`30750e17`, `f0012cda`), 4 file dirty của user còn nguyên
- [x] Không viết dòng mã sản phẩm nào

### Cho toàn tính năng FBD EDIT — **CHƯA ĐẠT**
- [ ] Tất cả Task 0 → 11 hoàn thành và verify từng bước
- [ ] `npm run typecheck` xanh
- [ ] `npm run lint` xanh (gồm `check:ui-strings`)
- [ ] `npx vitest --run src` xanh
- [ ] `npm run build` xanh (gồm `check:bundle-budget --increment r3`)
- [ ] `npx playwright test e2e/fbd-edit.spec.ts` xanh
- [ ] axe: 0 serious/critical
- [ ] `docs_iso_harness.py --expect` rc=0
- [ ] 38/38 `TC-FBD-*` có bằng chứng thật (không phải `PLANNED`)
- [ ] `BLK-FBD-003` đóng, hoặc có số đo cụ thể trình Owner
- [ ] `BLK-FBD-006` có timeout policy
- [ ] `BLK-FBD-004/005/007` có chữ ký/bằng chứng (ngoài phạm vi code)
- [ ] `CHANGELOG.md` cập nhật cho mọi commit
- [ ] Không phá behavior cũ; 4 file dirty của user còn nguyên
- [ ] `ProgramsTab.tsx` < 800 dòng

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
