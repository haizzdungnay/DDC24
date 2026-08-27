# Prompt thi hành — PGM-02 ST/FBD Editor theo ba ảnh thiết kế 2026-08-27

| Thuộc tính | Giá trị |
|---|---|
| ID | `PROMPT-PGM02-EDITOR-CHROME` |
| Phiên bản | 1.0 |
| Trạng thái | **Active — dùng để thi hành `T59-818..822`** |
| Ngày | 2026-08-27 |
| Chủ quản | Dev Lead (FE) + System Architect |
| Authority | `PLAN-PROG-059` §3 (`T59-818..822`); `DDD-SW-PGM02-WORKSPACE-001` **0.5**; handoff v2.2 (`PGM-02`, `PGM-02A`, `PGM-02B`); `UD-PROG-014` CLOSED |
| Nguồn finding | [`REC-PGM02-AUD-ADJ-001`](../07_records/reviews/PROGRAMMING_PGM02_AUDIT_GAP_ADJUDICATION_2026-08-27.md) |
| Tiền lệ về quy tắc | [`PROMPT-PLAN60-CTIO-MULTIAGENT`](PROMPT_PLAN60_CTIO_MULTIAGENT_EXECUTION.md) v1.0 |

## 0. Vì sao có prompt này

Chủ sở hữu cấp ba ảnh render PGM-02 ngày 2026-08-27 và ra lệnh implement bám
theo thiết kế + plan. Ba ảnh đã được đăng ký vào `handoff_manifest.json` 2.3 và
đổi tên theo quy ước repo:

| Ảnh | Vai trò |
|---|---|
| `assets/PGM-02A_ST_editor_reference.png` | Bố cục và phạm vi trang ST |
| `assets/PGM-02B_FBD_editor_reference.png` | Bố cục và phạm vi trang FBD |
| `assets/PGM-02_ST_FBD_annotated_reference.png` | Ảnh chú giải 6 vùng cho cả hai trang |

Ba ảnh này **xác nhận đúng bốn finding** của phán quyết audit và **đóng** câu hỏi
tab đa POU. Chúng cũng **đảo ngược** một kết luận cũ của chính tôi: bản DDD 0.4
ghi status bar "ngoài phạm vi"; cả hai ảnh đều có status bar, nên DDD 0.5 đã đưa
nó vào phạm vi.

Nhưng ảnh **không phải nguồn dữ liệu**. Đối chiếu trực tiếp registry và Draft v2
cho thấy ảnh chứa ít nhất **ba nhóm nội dung không có thật trong hệ thống**. Mục
§2 liệt kê từng nhóm. Đây là lý do chính prompt này tồn tại: nếu team implement
bằng cách "làm cho giống ảnh", team sẽ bịa dữ liệu thư viện và vô hiệu hoá một
cổng an toàn.

> Dán nguyên khối `text` ở §5 làm prompt đầu tiên của phiên thi hành.

---

## 1. Trạng thái thật tại thời điểm viết prompt

`HEAD` = `7e6a330`. R1 và R2 ĐÓNG. R3 đang chạy: `T59-814` **DONE**, `T59-815`
**READY**. Năm task corrective mở thêm từ phán quyết audit:

| Task | WP | Nội dung | Trạng thái |
|---|---|---|---|
| `T59-818` | `WP-14` | Inspector context-sensitive năm ngữ cảnh | READY |
| `T59-819` | `WP-09` phần còn nợ | Compare Draft↔Active typed diff | READY |
| `T59-820` | `WP-04` phần còn nợ | Hover + chỉ mục ký hiệu do compiler sinh | READY |
| `T59-821` | `WP-15` | Editor chrome: toolbar ba mode, tab đa POU, status bar, Code Map | READY |
| `T59-822` | `WP-13-R3` bổ sung | Truy nguyên 33 AC + đo `AC-PGM02-002` trên PGM-02 | ORDERED |

`T59-818/819/820/821` **không phụ thuộc nhau về mặt nghiệp vụ** và không phụ
thuộc `T59-815`. Nhưng `T59-818` (Inspector) và `T59-821` (chrome) **cùng chạm
`ProgramsTab.tsx`** — hai làn này phải nối tiếp, hoặc tách `ProgramInspector` ra
file riêng như bước đầu tiên rồi mới song song. `T59-822` đóng sau cùng.

Ba nút phụ thuộc chéo còn lại: nút `Compare` của làn D chờ làn B; thanh SIMULATE
của làn D chờ `T59-815`; ba trường Inspector của làn A chờ `UD-PROG-015`. Cả ba
đều **không** chặn phần còn lại của làn tương ứng.

---

## 2. Ba nhóm nội dung trong ảnh KHÔNG có nguồn dữ liệu

Đây là phần quan trọng nhất của prompt. Mọi số liệu dưới đây đo trực tiếp trên
`7e6a330`.

### 2.1 Quick Library trong ảnh FBD hiển thị block không tồn tại

Ảnh FBD hiện cây `HVAC → PID · P · PI · PID_AutoTune · Deadband · Ramp`, và ảnh
ST hiện tab `All · Common · HVAC · Math · Logic`.

Registry thật (`contracts/programming/pou_library_registry_v1.json`,
`libraryVersion: rev-a.3`):

```
compare      EQ GE GT LE LT NE
control      HYSTERESIS PID
conversion   DINT_TO_INT … UINT_TO_REAL (14 mục)
counter      CTD CTU
logic        AND NOT OR SEL XOR
math         ABS ADD DEADBAND DIV LIMIT MAX MIN MOD MUL SCALE SQRT SUB
timer        TOF TON TP
trigger      F_TRIG R_TRIG
```

`categoryOrder` thật: `interface · constants · logic · compare · math ·
conversion · timer · counter · trigger · control`.

Kết luận: **không có category `HVAC`**, và **`P`, `PI`, `PID_AutoTune`, `Ramp`
không tồn tại**. `Deadband` có thật nhưng thuộc `math`, không thuộc HVAC.

> **Luật cứng.** Quick Library render **duy nhất** từ catalog do backend công bố,
> vốn sinh từ registry. Tab category lấy từ `categoryOrder`, **không** lấy từ
> ảnh. Không entry nào được thêm bằng tay ở FE. Handoff `PGM-02A §5.4` đã nói
> thẳng: *"Do not present speculative AI-generated blocks as authoritative
> library content."*

### 2.2 PID trong ảnh là block bị cổng an toàn chặn

Cả hai ảnh dùng PID làm ví dụ trung tâm: ST gọi `FB_PID_01(SP := …, PV := …)`,
FBD hiện block PID kèm Inspector đầy đủ `Kp/Ki/Kd/Ts/ManualOut` và `Status`
(`Mode/Out/Integral/PV/SP`).

Registry thật ghi PID `featureState: "REVIEW_REQUIRED"`. `product_profile_v2.schema.json`
quy định: *"Check CHẶN mọi Program dùng chúng cho tới khi có approval token
Controls/Safety"*, và token **không** đến từ payload FE hay checkbox UI.

> **Luật cứng.** PID hiện trong thư viện **kèm nhãn `REVIEW_REQUIRED`**, chèn
> được, nhưng Check vẫn phải chặn Program dùng nó. Cấm mọi thay đổi FE/BE làm
> ảnh mềm cổng này để "chạy được ví dụ trong ảnh". Đây là `UD-PROG-010`.

### 2.3 Ba trường Inspector không có nguồn trong Draft v2

Ảnh Inspector (ngữ cảnh Program) hiện `Name · Language · Type · Access ·
Cycle (in Task) · Description · Parameters · Attributes`.

Draft v2 thật (`apps/web-api/internal/programming/application/draft_v2.go:349-377`)
chỉ có `programId`, `objectId`, `periodMs`; `objects[]` có `name`, `kind`.

| Trường | Nguồn | Kết luận |
|---|---|---|
| `Name` | `objects[].name` | có |
| `Language` | `replaceProgramSource.language` | có |
| `Type` | `objects[].kind` | có |
| `Cycle` phần `1 s` | `programs[].periodMs` | có |
| `Access: Public` | — | **không có** |
| `Description` | — | **không có** |
| `Cycle` phần tên Task `Control_Main` | — | **không có** — `UD-PROG-002` xếp lịch theo period 1/5/30 s, không có thực thể Task có tên |

`UD-PROG-015` đang **OPEN** cho ba trường này.

> **Luật cứng.** Tới khi `UD-PROG-015` CLOSED: **không** render `Access`,
> `Description`, hay tên Task. Không hard-code `Public`. Không đặt `Control_Main`
> làm nhãn. Ba trường còn lại của ảnh (`Parameters`, `Attributes`) chỉ hiện khi
> có dữ liệu thật; rỗng thì thu gọn, không chiếm chỗ.

---

## 3. Ánh xạ ảnh → task → luật

| Vùng trong ảnh | Task | Đã có gì | Phải làm gì |
|---|---|---|---|
| ① POU Tree | — | `PouExplorer.tsx` đủ | Không đụng. `AC-PGM02-001` là bất biến: đúng **một** cây POU trong DOM |
| ② ST Editor | `T59-820` | gutter số dòng, tô cú pháp, autocomplete, F12, find/replace, format | Thêm hover symbol/type/signature + chỉ mục ký hiệu do compiler sinh |
| ② FBD Canvas | — | `FbdCanvas.tsx` node–edge thật, minimap | Không đụng topology. `AC-FBD-011`: refresh giá trị **không** được đổi model |
| ③ Quick Library | — | `QuickLibraryPanel.tsx` dùng chung catalog BE | Không đụng nội dung. Chỉ chỉnh bố cục thẻ nếu cần — xem §2.1 |
| ④ Inspector | `T59-818` | panel 2 trường `Tên`+`Loại` | Dựng năm ngữ cảnh; ba trường ở §2.3 **giữ nguyên chưa làm** |
| ⑤ Bottom Panel | — | 5 tab đủ | Không đụng |
| ⑥ Code Map / Mini Map | `T59-821` | FBD có minimap (`AC-FBD-012`) | Thêm Code Map cho ST, tái dùng ngưỡng và luật của minimap |
| Tab bar | `T59-821` | chưa có | Dựng theo `UD-PROG-014` phương án B |
| Toolbar | `T59-821` | 7 nút EDIT | Thêm `Check`/`Compare`/`More`; dựng thanh SIMULATE và LIVE |
| Status bar | `T59-821` | chưa có | Ln/Col/INS/LF/UTF-8/dirty; FBD thêm zoom% + ngôn ngữ + trạng thái kết nối |
| Nút `Save`/`Check` ở header | `T59-821` | `Check` có ở DesignWorkspacePage | Giữ Save/Check là hành động chính ở header; toolbar là mức icon. Không dựng **hai** luồng Check |
| `Compare` | `T59-819` | chưa có | `stHunks[]`/`fbdChanges[]` + drawer + golden tests |

---

## 4. Năm bất biến không được vi phạm

1. **FE không chế dữ liệu.** Thiếu số liệu ⇒ `—` / "Chưa rõ", tuyệt đối không `0`
   và không giá trị mẫu lấy từ ảnh (`23.4 °C`, `42.3 %`, `r17`, `r15`,
   `DDC-24-01`, `AHU_01` đều là dữ liệu minh hoạ).
2. **`objectId` là trục định danh của tab**, không phải tên POU. Hai tab không bao
   giờ chia chung buffer soạn thảo.
3. **Đổi mode áp cho toàn workspace**, không phải từng tab. LIVE/SIMULATE là
   read-only ở cả lớp component lẫn lớp lệnh; kiểm bằng phiên viewer **thật**,
   không phải bằng cách ẩn nút.
4. **Ảnh là tham chiếu bố cục, không phải chuẩn pixel** (README §5.10). Dùng
   token màu ở `theme/tokens.ts`; màu không bao giờ là tín hiệu duy nhất.
5. **Mỗi route đúng một `<h1>`.** Ngân sách chunk Programming R3 là **165 KiB
   gzip**, có cổng chặn trong chính `npm run build`.

---

## 5. Khối prompt — dán nguyên

```text
Bạn là Dev Lead FE của MK-DDC-24 tại /home/chuong/Desktop/DDC-PROJECT.

NHIỆM VỤ: thi hành T59-818, T59-819, T59-820, T59-821 rồi đóng T59-822, đưa
PGM-02 ST/FBD workspace về đúng ba ảnh thiết kế đã đăng ký trong
docs/04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/handoff_manifest.json 2.3.

ĐỌC TRƯỚC KHI GÕ DÒNG CODE ĐẦU TIÊN, theo đúng thứ tự:
1. docs/07_records/reviews/PROGRAMMING_PGM02_AUDIT_GAP_ADJUDICATION_2026-08-27.md
   — bốn finding và vì sao chúng tồn tại.
2. docs/02_design/software/PROGRAMMING_PGM02_WORKSPACE_DETAILED_DESIGN.md 0.5
   §7.2 cây component, §7.3 ánh xạ vùng UI, §10.2 ca kiểm. ĐÂY LÀ AUTHORITY.
3. docs/04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/PGM-02_PROGRAMS_FE_HANDOFF_v2_2.md
   §9 Inspector, §10 Bottom Workbench, §11 state model, §12 component boundary.
4. PGM-02A_ST_EDITOR_FE_HANDOFF_v2_2.md §3 toolbar, §4 capability, §9 Inspector.
5. PGM-02B_FBD_EDITOR_FE_HANDOFF_v2_2.md §9 Inspector.
6. docs/00_governance/PROGRAMMING_OPEN_DECISIONS.md — UD-PROG-014 (CLOSED, tab
   phương án B) và UD-PROG-015 (OPEN, ba trường Inspector chưa có nguồn).
7. Ba ảnh: assets/PGM-02A_ST_editor_reference.png,
   assets/PGM-02B_FBD_editor_reference.png,
   assets/PGM-02_ST_FBD_annotated_reference.png.
8. docs/03_implementation/59_PROGRAMMING_DOC_TO_CODE_IMPLEMENTATION_PLAN.md §3,
   dòng T59-818..822 — acceptance của từng task.

BA ĐIỀU TRONG ẢNH KHÔNG CÓ THẬT — TUYỆT ĐỐI KHÔNG LÀM CHO GIỐNG:

(a) Quick Library trong ảnh FBD hiện category "HVAC" và các block P, PI,
    PID_AutoTune, Ramp. Registry thật (contracts/programming/pou_library_registry_v1.json,
    libraryVersion rev-a.3) KHÔNG có category HVAC và KHÔNG có bốn block đó.
    Quick Library chỉ được render từ catalog backend sinh từ registry; tab
    category lấy từ categoryOrder. Không thêm entry bằng tay ở FE.

(b) PID trong registry là featureState = REVIEW_REQUIRED. Nó hiện trong thư viện
    KÈM NHÃN và chèn được, nhưng Check PHẢI tiếp tục chặn Program dùng nó. Cấm
    sửa FE/BE/contract để ví dụ PID trong ảnh chạy được. Đây là UD-PROG-010.

(c) Inspector trong ảnh có Access, Description và tên Task "Control_Main".
    Draft v2 KHÔNG có ba trường này (application/draft_v2.go:349-377 chỉ có
    programId/objectId/periodMs). UD-PROG-015 đang OPEN. Cho tới khi nó CLOSED:
    không render ba trường đó, không hard-code "Public", không đặt tên Task.

BỐN LÀN SONG SONG, làm lần lượt hoặc song song đều được, mỗi làn một nhánh riêng:

LÀN A — T59-818 Inspector (WP-14)
  Tách ProgramInspector khỏi ProgramsTab.tsx thành component dùng chung cho ST
  và FBD. Năm ngữ cảnh theo handoff §9: Program, Variable, ST symbol/call,
  FBD block, Connection. Lấy Definition/Type/Signature từ stReferenceIndex.ts và
  normalized signature của Library — analyzer không chắc thì ghi "không xác định
  được", CẤM đoán. FBD block/connection đọc canonical graph, giữ nguyên
  nodeId/portId/wireId và port order. Live/Sim value tái dùng
  StRuntimeValueOverlay, không mở đường đọc thứ hai. Thu gọn khi không có ngữ
  cảnh hữu ích — handoff §9 cấm chiếm 300px cho hai trường, và hiện trạng đang
  vi phạm đúng điều đó. Test: TC-PGM02-INS-01/02/03.

LÀN B — T59-819 Compare (phần còn nợ của WP-09)
  BE: mở rộng GetRevisionChanges (application/changes.go:50) thêm stHunks[] và
  fbdChanges[] tất định, có bounded payload/truncation/cursor. Đây là thay đổi
  ADDITIVE lên OpenAPI, phải chạy lại generator cho Go và TS.
  Luật: dirty Draft phải Save rồi seal thành Revision, sau đó compare hai
  Revision bất biến. CẤM silent compare snapshot cũ. Không có Active thì hiện
  empty state có lý do, không hiện "no change".
  FE: Compare drawer luôn hiện cặp Revision ID; click hunk/node nhảy đúng phía
  read-only, không đổi POU đang chọn ngầm.
  Test golden: ST add/delete/replace hunks; FBD node/port/wire add/remove/update;
  order-only; geometry-only; no Active; dirty guard; store error fail-closed;
  payload limit/cursor.

LÀN C — T59-820 hover + chỉ mục ký hiệu (phần còn nợ của WP-04)
  PGM-02A §4 liệt hover symbol/type/signature là Required. UD-PROG-013 hoãn nó ở
  R1 và hẹn "mở lại từ R2"; R2 đã đóng mà không ai làm.
  Hover đọc từ chỉ mục do compiler sinh, không đoán. Nếu ngân sách chunk không
  cho phép thì ĐO THẬT rồi báo số, và đề xuất Owner ký hoãn có thời hạn — không
  im lặng bỏ qua lần thứ hai.

LÀN D — T59-821 editor chrome (WP-15)
  Tab bar: nhiều POU song song, bắc qua cả ST lẫn FBD (UD-PROG-014 phương án B).
  objectId là trục định danh của tab, KHÔNG phải tên POU. Hai tab không chia
  chung buffer. Phải chốt và ghi vào test: số tab tối đa; đóng tab bẩn phải xác
  nhận; đổi mode áp cho TOÀN workspace không phải từng tab; tab sống qua reload
  hay không; tab trỏ tới POU đã bị xoá ở phiên khác.
  Toolbar: EDIT thêm Check, Compare, More vào hàng đã có (Find/Undo/Redo/Insert/
  Library/Format/Save). Check TÁI DÙNG useCheckWorkflow — cấm dựng luồng thứ hai.
  Compare bật sau khi làn B xong. Dựng thanh SIMULATE (Run/Pause/Step/Reset/
  Speed/Stop/Watch/Trace, phụ thuộc T59-815) và thanh LIVE (Pause Refresh/Watch/
  Trace/Return to Draft). SIMULATE và LIVE vẫn là mode switch ở
  ProgramsModeSwitcher, KHÔNG nhân bản thành nút toolbar.
  Status bar: Ln/Col, chế độ chèn, EOL, encoding, dirty; FBD thêm zoom%, ngôn ngữ
  POU, trạng thái kết nối. Giá trị chưa đọc được hiện "—", CẤM mặc định UTF-8/LF.
  Code Map cho ST: tái dùng ngưỡng và luật của minimap FBD; điều hướng KHÔNG được
  đổi một byte nào của tài liệu.
  Nút disabled phải nêu lý do đọc được, cấm ẩn im lặng.
  Test: TC-PGM02-TB-01, TC-PGM02-TAB-01, TC-PGM02-SB-01, TC-PGM02-NAV-01.

ĐÓNG — T59-822
  Bảng truy nguyên AC → task → file test cho đủ 33 AC của handoff v2.2
  (AC-PGM02-001..010, AC-ST-001..011, AC-FBD-001..012). Hiện AC-PGM02-001..007,
  009, 010 có 0 tham chiếu ngoài chính file handoff. Phần lớn ĐÃ có test thật
  nhưng không mang định danh AC — việc cần làm là gắn định danh vào tên/chú thích
  test, không phải viết lại test. Bổ sung phép đo AC-PGM02-002 (1280×750 không
  cuộn trang) cho chính workspace PGM-02; hiện phép đo này mới chỉ chạy cho
  PGM-01 Overview tại e2e/programming.spec.ts:920.

BẤT BIẾN — vi phạm là fail, không phải góp ý:
  1. FE không chế dữ liệu. Thiếu ⇒ "—"/"Chưa rõ", không bao giờ 0. Mọi số trong
     ảnh (23.4 °C, 42.3 %, r17, r15, DDC-24-01, AHU_01) là minh hoạ.
  2. Draft ≠ Active ≠ Runtime. Save Draft không đổi Active. Check fail không dừng
     Active đang khoẻ.
  3. LIVE/SIMULATE read-only ở cả lớp component lẫn lớp lệnh; kiểm bằng phiên
     viewer thật, không phải bằng cách ẩn nút.
  4. Ảnh là tham chiếu bố cục, không phải chuẩn pixel. Màu lấy từ
     apps/web-ui/src/theme/tokens.ts; màu không bao giờ là tín hiệu duy nhất.
  5. Mỗi route đúng một <h1>. Ngân sách chunk Programming R3 = 165 KiB gzip, có
     cổng chặn trong chính npm run build.

KIỂM CHỨNG BẮT BUỘC trước khi báo xong bất kỳ làn nào — chạy thật, ghi số thật,
không dẫn lại số cũ:
  npx vitest --run --environment jsdom src
  npm run lint
  npm run build                       (cổng ngân sách chunk chạy trong đây)
  npx playwright test e2e/programming.spec.ts
  cd /home/chuong/Desktop/DDC-PROJECT && go vet ./... && go test ./... -count=1
  python3 scripts/docs_iso_harness.py
  python3 scripts/candidate_pin_check.py
Làn B đụng contract nên thêm:
  python3 scripts/verify_programming_pgm02_contract.py
Đọc exit code của TỪNG lệnh. Lệnh chạy nền báo "exit code 0" có thể là của tail,
không phải của gate — đã có tiền lệ báo PASS giả trong repo này.

GIT: mỗi làn một nhánh riêng tách từ main. Có phiên khác đang commit song song
trong repo này — ĐÃ XẢY RA việc commit của phiên khác cuốn theo edit chưa lưu.
Vì vậy: soát git status trước mỗi git add; add theo đường dẫn cụ thể, KHÔNG
git add -A; không git reset --hard; không merge PR của phiên khác.

CẬP NHẬT TÀI LIỆU trong cùng phiên với code, không để lại:
  - CHANGELOG.md dưới [Unreleased], nêu triệu chứng → nguyên nhân → cách sửa.
  - Plan 59 §3: đổi trạng thái task và ghi số đo thật vào cột bằng chứng.
  - PGM02_ST_FBD_IMPLEMENTATION_PLAN.md §0: đổi trạng thái WP.
  - Sửa docs trong 17 hồ sơ đã ghim ⇒ chạy lại candidate_pin_check.py và re-pin
    PROGRAMMING_UNIFIED_BASELINE_MANIFEST_2026-08-20.md.

DỪNG LẠI VÀ HỎI, không tự quyết, đúng ba trường hợp:
  - UD-PROG-015 (Access/Description/tên Task) cần Owner chốt A/B/C.
  - Làn C nếu ngân sách chunk không đủ cho hover — báo số đo rồi hỏi.
  - Bất kỳ đề xuất nào làm mềm cổng REVIEW_REQUIRED của PID.
Ngoài ba trường hợp đó thì tự quyết và làm tới nơi.

BÁO CÁO: mỗi làn báo đúng một lần khi xong, gồm số đo thật của từng lệnh kiểm
chứng, link PR, và danh sách finding phát hiện thêm kèm việc đã sửa. Không báo
cáo giữa chừng kèm danh sách "còn lại/nói nếu muốn tôi làm".
```

---

## 6. Cách dùng

1. Dán khối §5 vào phiên thi hành đầu tiên.
2. Nếu chạy multi-agent: một agent một làn (A/B/C/D), giao thức git một-người-
   commit theo `PROMPT-PLAN60-CTIO-MULTIAGENT` §1. Ma trận sở hữu file tối thiểu:
   làn A và làn D **cùng chạm** `ProgramsTab.tsx` — hai làn này phải nối tiếp
   hoặc thống nhất tách file trước khi bắt đầu.
3. `T59-822` chỉ chạy sau khi bốn làn đóng.

## Lịch sử

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-27 | Tạo prompt thi hành `T59-818..822` theo ba ảnh thiết kế chủ sở hữu cấp cùng ngày; ghi ba nhóm nội dung trong ảnh không có nguồn dữ liệu |
