# PGM-02 — Bảng truy nguyên AC → task → file test (`T59-822`)

| Thuộc tính | Giá trị |
|---|---|
| Ngày | 2026-08-27 |
| Task | `T59-822` (`PGM02-V22-WP-13-R3` bổ sung) |
| Nguồn AC | `handoff_manifest.json` 2.3 — `PGM-02_PROGRAMS_FE_HANDOFF_v2_2.md`, `PGM-02A_ST_EDITOR_FE_HANDOFF_v2_2.md`, `PGM-02B_FBD_EDITOR_FE_HANDOFF_v2_2.md` |
| Sinh bởi | `scripts/programming_ac_traceability.py` |

## 0. Vì sao bảng này được SINH RA chứ không chép tay

Một bảng chép tay chỉ chứng minh người viết đã tin điều gì **tại thời điểm
viết**. Nó không phát hiện được lần đổi tên test tháng sau, và nó vẫn xanh khi
file test đã bị xoá. Bảng dưới đây sinh từ chính cây làm việc: định danh AC đọc
thẳng từ ba tệp handoff, danh sách file đọc bằng `grep` trên `apps/web-ui/src`,
`apps/web-ui/e2e` và `apps/web-api`, và chỉ tính file mang `.test.` hoặc
`.spec.`.

Chạy `python3 scripts/programming_ac_traceability.py --check` để dùng làm cổng.

## 1. Hiện trạng trước `T59-822`

`F-PGM02-AUD-005` đo được **16/33 AC có 0 tham chiếu** ngoài chính tệp handoff:
`AC-PGM02-001..010` (trừ 008 cũng 0), `AC-ST-006/008/009/011`,
`AC-FBD-002/003/004/005/008`.

Điều đáng nói: **phần lớn đã có test thật**. Chúng chỉ không mang định danh AC,
nên không ai kiểm chứng độc lập được — muốn biết một AC có được phủ hay không
phải đọc hết test rồi suy luận bằng văn xuôi. Vì vậy việc làm ở `T59-822` là
**gắn định danh vào tên/chú thích test đã có**, không phải viết lại test. Viết
test mới cho thứ đã được phủ là nhân đôi chi phí bảo trì để mua một con số đẹp.

Ngoại lệ duy nhất phải viết mới là `AC-PGM02-002`.

## 2. `AC-PGM02-002` — phép đo mới, và nó bắt được lỗi thật

Phép đo 1280×750 trước nay **chỉ chạy cho PGM-01 Tổng quan**
(`e2e/programming.spec.ts`). `AC-PGM02-002` nói về chính khổ giấy của workspace
PGM-02 — nơi ba cột cộng thanh tab, thanh công cụ và thanh trạng thái cùng tranh
chiều cao. Suy kết quả của một trang khác sang đây không phải là đo.

Lần chạy đầu tiên **FAIL**, và nó lộ ra hai lỗi bố cục có sẵn:

| # | Lỗi | Số đo | Cách sửa |
|---|---|---|---|
| 1 | Cây POU render thành **dải ngang** phía trên lưới thay vì cột trái, dù `UX §16.2` quy định `Cây 280px ┬ Editor ┬ Inspector 308px` | Dải cao **337 px** ⇒ mép trên trình soạn thảo ở **y=849** trên viewport 750 | Đưa cây POU vào đúng cột trái qua `explorerSlot` của `ProgramsTab` (chỉ ở EDIT; LIVE/SIMULATE không mount `ProgramsTab`). Điều kiện loại trừ nhau để `AC-PGM02-001` vẫn đúng MỘT cây |
| 2 | Chiều cao khung soạn thảo **cố định 24rem** | Sau khi sửa (1), mép trên còn **y=500**, mép dưới **884 px** > 750 | `h-[clamp(14rem,calc(100vh-32rem),24rem)]` — màn từ 1080 px trở lên giữ nguyên 24rem, chỉ màn thấp co lại; sàn 14rem để không thành khe hai dòng |

Một ghi chú về chính phép đo: bản nháp đầu của nó còn đòi
`document.scrollHeight <= innerHeight`, tức bắt **cả trang** gói gọn trong 750 px.
Đó là ràng buộc **chặt hơn** câu của AC (*"main editor/canvas visible without
page scroll"*), và trang còn Inspector cùng khay workbench nằm dưới một cách
chính đáng. Test phải khoá đúng câu của hợp đồng, không khoá một câu nghiêm hơn
do mình nghĩ ra — một test như thế sẽ đỏ vì lý do không ai đồng ý và rồi bị tắt.

## 3. Bảng truy nguyên

| AC | Yêu cầu | File test |
|---|---|---|
| `AC-FBD-001` | FBD is a true node-edge canvas | `apps/web-ui/src/features/programming/fbd/FbdCanvas.test.tsx` |
| `AC-FBD-002` | block can be found and placed from Quick Library without memorizing name taxonomy | `apps/web-ui/e2e/programming.spec.ts`<br>`apps/web-ui/src/features/programming/design/library/QuickLibraryPanel.test.tsx` |
| `AC-FBD-003` | selected-port insertion filters compatible blocks | `apps/web-ui/src/features/programming/fbd/StructuredFbdEditor.test.tsx` |
| `AC-FBD-004` | ambiguous auto-connect never occurs without user confirmation | `apps/web-ui/src/features/programming/fbd/StructuredFbdEditor.test.tsx` |
| `AC-FBD-005` | Quick Library insertion creates valid domain commands and is undoable | `apps/web-ui/src/features/programming/fbd/StructuredFbdEditor.test.tsx` |
| `AC-FBD-006` | invalid typed connection is blocked immediately | `apps/web-ui/src/features/programming/fbd/commands.test.ts` |
| `AC-FBD-007` | Problems jump to exact block/wire | `apps/web-ui/src/features/programming/fbd/FbdCanvas.test.tsx`<br>`apps/web-ui/src/features/programming/fbd/issueTargets.test.ts` |
| `AC-FBD-008` | SIMULATE displays Draft runtime with no physical outputs | `apps/web-ui/src/features/programming/simulation/SimulateWorkspace.test.tsx` |
| `AC-FBD-009` | LIVE loads Active topology and is read-only | `apps/web-ui/src/features/programming/design/LiveProgramView.test.tsx`<br>`apps/web-ui/src/features/programming/fbd/StructuredFbdEditor.test.tsx` |
| `AC-FBD-010` | Active runtime values are never painted onto mismatched Draft topology | `apps/web-ui/e2e/programming-real.spec.ts`<br>`apps/web-ui/src/features/programming/design/LiveProgramView.test.tsx`<br>`apps/web-ui/src/features/programming/design/editor/workspaceAdapters.test.ts` |
| `AC-FBD-011` | runtime value refresh does not mutate FBD topology/model | `apps/web-ui/src/features/programming/design/LiveProgramView.test.tsx` |
| `AC-FBD-012` | minimap is available for diagrams above configured size threshold | `apps/web-ui/src/features/programming/fbd/FbdCanvas.test.tsx` |
| `AC-PGM02-001` | exactly one POU Explorer | `apps/web-ui/e2e/programming.spec.ts` |
| `AC-PGM02-002` | main editor/canvas visible without page scroll at 1280×750 | `apps/web-ui/e2e/programming.spec.ts` |
| `AC-PGM02-003` | Draft and Active never visually conflated | `apps/web-ui/e2e/programming.spec.ts`<br>`apps/web-ui/src/features/programming/design/LiveProgramView.test.tsx` |
| `AC-PGM02-004` | Quick Library inserts only into Draft/EDIT | `apps/web-ui/e2e/programming.spec.ts` |
| `AC-PGM02-005` | Simulation can never write physical outputs | `apps/web-ui/src/features/programming/simulation/SimulateWorkspace.test.tsx` |
| `AC-PGM02-006` | LIVE always reads Active and is read-only | `apps/web-ui/e2e/programming.spec.ts`<br>`apps/web-ui/src/features/programming/design/LiveProgramView.test.tsx` |
| `AC-PGM02-007` | Active values are never overlaid on mismatched Draft source | `apps/web-ui/src/features/programming/design/LiveProgramView.test.tsx` |
| `AC-PGM02-008` | unsupported simulation is not faked | `apps/web-ui/e2e/programming.spec.ts`<br>`apps/web-ui/src/features/programming/simulation/SimulateWorkspace.test.tsx` |
| `AC-PGM02-009` | Save/Check do not change Active | `apps/web-ui/src/features/programming/design/DesignWorkspacePage.test.tsx` |
| `AC-PGM02-010` | mobile ST/FBD is read-only | `apps/web-ui/e2e/programming.spec.ts`<br>`apps/web-ui/src/features/programming/fbd/StructuredFbdEditor.test.tsx` |
| `AC-ST-001` | Quick Library inserts a FUNCTION call in ≤2 actions after search | `apps/web-ui/src/features/programming/design/library/QuickLibraryPanel.test.tsx` |
| `AC-ST-002` | inserting stateful FB can create/select instance without manual declaration memorization | `apps/web-ui/src/features/programming/design/editor/SourceEditorLibraryInsertion.test.tsx` |
| `AC-ST-003` | library insertion is undoable as one logical operation | `apps/web-ui/src/features/programming/design/editor/SourceEditorLibraryInsertion.test.tsx` |
| `AC-ST-004` | Save never changes Active | `apps/web-ui/src/features/programming/design/DesignWorkspacePage.test.tsx`<br>`apps/web-ui/src/features/programming/design/editor/SourceEditor.test.tsx` |
| `AC-ST-005` | Check diagnostics jump to exact source range | `apps/web-ui/src/features/programming/design/editor/SourceEditor.test.tsx` |
| `AC-ST-006` | SIMULATE uses Draft only and shows `NO REAL OUTPUT` | `apps/web-ui/src/features/programming/simulation/SimulateWorkspace.test.tsx` |
| `AC-ST-007` | LIVE displays Active source, never mismatched Draft | `apps/web-ui/e2e/programming-real.spec.ts`<br>`apps/web-ui/src/features/programming/design/LiveProgramView.test.tsx`<br>`apps/web-ui/src/features/programming/design/editor/workspaceAdapters.test.ts`<br>`apps/web-ui/src/features/programming/overview/activeProgramSet.test.ts` |
| `AC-ST-008` | LIVE is read-only and cannot write/force | `apps/web-ui/e2e/programming.spec.ts`<br>`apps/web-ui/src/features/programming/design/LiveProgramView.test.tsx` |
| `AC-ST-009` | stale live data is visually distinct from valid data | `apps/web-ui/src/features/programming/design/editor/StRuntimeValueOverlay.test.tsx` |
| `AC-ST-010` | unsupported compiler construct does not crash editor | `apps/web-ui/src/features/programming/design/editor/SourceEditor.test.tsx`<br>`apps/web-ui/src/features/programming/design/editor/stReferenceIndex.test.ts`<br>`apps/web-ui/src/features/programming/fbd/StructuredFbdEditor.test.tsx` |
| `AC-ST-011` | viewer/operator cannot mutate source through keyboard or paste | `apps/web-ui/src/features/programming/design/editor/SourceEditor.test.tsx` |


## 4. Kết luận

**33/33 AC** truy nguyên được tới ít nhất một file test mang định danh AC.

Bảng này nói về **tồn tại tham chiếu**, không nói về **chất lượng phủ**: một AC
trỏ tới một file test không tự chứng minh mọi nhánh của nó được kiểm. Nó khoá
đúng một điều — không AC nào còn là lời khẳng định trần trong tài liệu.
