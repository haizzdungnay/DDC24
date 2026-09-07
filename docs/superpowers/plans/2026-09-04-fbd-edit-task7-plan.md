# Kế hoạch Task 7 — I/O picker, Inspector và node presentation (FBD EDIT)

**Ngày:** 2026-09-04
**Nhánh:** `feat/fbd-edit-task6` (Task 6 chưa commit; Task 7 tiếp tục trên cùng nhánh)
**Plan mẹ:** [2026-08-31-fbd-edit.md](2026-08-31-fbd-edit.md) §7
**Spec authority:** [2026-08-31-fbd-edit-design.md](../specs/2026-08-31-fbd-edit-design.md) v0.3
**Handoff trước:** [2026-09-04-fbd-edit-task6-handoff.md](2026-09-04-fbd-edit-task6-handoff.md)

---

## 1. Kết quả khảo sát — ba điểm lệch so với plan mẹ

Plan mẹ §7 Step 3 viết "Nối UI vào context Inspector FBD đã có sẵn". Khảo sát code thật cho thấy
việc đó **đã xong từ trước**, và phần còn thiếu là chuyện khác.

| # | Plan mẹ giả định | Thực tế đo được trong code | Hệ quả cho Task 7 |
|---|---|---|---|
| L1 | Cần nối `ContextInspector` vào context FBD | `ContextInspector.tsx:247-307` đã render đủ nhánh `FBD_BLOCK` và `FBD_CONNECTION`; `inspectorContext.ts:211` đã trả context đúng cho `node`/`port`/`wire` | Bỏ việc "nối"; đổi trọng tâm sang **cho phép sửa** |
| L2 | Inspector là khay thuộc tính duy nhất | Form sửa parameter FBD nằm inline trong `StructuredFbdEditor.tsx:128` (`NodeInspector`, render tại dòng 806), song song với khay `ContextInspector` ở cột phải của `ProgramsTab.tsx:919` | Hai khay cùng mô tả một selection — đúng thứ spec dòng 106 gọi là "nhân bản state". Phải **dời form về dock phải** |
| L3 | Các file còn dư địa để thêm code | `StructuredFbdEditor.tsx` = **823 dòng**, `commands.ts` = **844 dòng**, cả hai đã vượt trần 800 dòng của `coding-style` | Task 7 **không được phép** thêm dòng vào hai file này mà không tách module trước |

### 1.1 Những thứ đã có sẵn, cấm làm lại

1. **Không viết lại `inspectorContext.ts`.** `InspectorFbdBlockContext` (dòng 138), `InspectorFbdPortView`
   (129), `InspectorFbdConnectionContext` (151) và `inspectorContextFor` (211) đã đúng và đã có 30 test phủ.
2. **Không tạo `data-testid=inspector-collapsed` mới.** Đã có tại `ContextInspector.tsx:63`, đã có test.
3. **Không thêm action reducer mới cho việc sửa node.** `commands.ts` đã có đủ 4 action:
   `SET_NODE_VARIABLE` (156), `SET_NODE_VALUE` (157), `SET_NODE_TYPE` (158), `SET_NODE_FB_PARAMS` (159).
   Task 7 chỉ đổi **ai gọi** chúng, không đổi **chúng làm gì**.
4. **Không dựng authority selection thứ hai.** Đường hiện có đã đúng và giữ nguyên:
   `fbdEditorReducer` → `StructuredFbdEditor.tsx:385 onSelectionChange` → `ProgramsTab.tsx:853 setFbdSelection`
   → `ProgramsTab.tsx:963 input.fbd.selection` → `ContextInspector`.
5. **Không tạo hook point catalog mới.** `useLazyProgrammingPointCatalog` (`api/queries.ts:206`) đã có
   `status/data/error/ensureLoaded`, đã được `ProgramsTab.tsx:836-839` bơm xuống cho nhánh ST.

### 1.2 Phần thật sự còn thiếu

| Thiếu | Bằng chứng | Kịch bản đòi |
|---|---|---|
| Dock phải không sửa được gì của FBD | `ContextInspector.tsx:261-274` render `<li>{name} = {value}</li>` tĩnh; component không có prop `onChange`/`onEdit` nào | `TC-FBD-INS-001` |
| Dock phải có thể render form mutation khi không chọn gì | Form nằm ở `StructuredFbdEditor`, chưa chịu ràng buộc của dock | `TC-FBD-INS-002` |
| Node I/O chưa có picker Point/Variable | `InsertPointVariablePanel.tsx` chỉ được `ProgramsTab.tsx:2610` gọi cho nhánh ST; nhánh FBD gõ tay tên biến tại `StructuredFbdEditor.tsx` | `TC-FBD-INS-001`, `TC-FBD-STATE-005` |
| Node trên canvas không hiện kiểu/đơn vị/tham số/lỗi | `FbdCanvasLayers.tsx:167-247` chỉ vẽ `#order · typeRef`, `kind` và tên port; `dataType`/`unit` chỉ nằm trong `aria-label` | Plan mẹ §7 Step 4 |

---

## 2. Ràng buộc bắt buộc của Task 7

| Mã | Ràng buộc | Nguồn |
|---|---|---|
| R-01 | I/O picker **chỉ** chứng minh `name` / `dataType` / `unit`. Cấm sinh `variableId`, cấm tạo Mapping/Binding ẩn | `BLK-FBD-001`, spec dòng 70, 836 |
| R-02 | Chế độ EDIT **không** hiển thị runtime value; nguồn vắng ⇒ gạch ngang / "Chưa có dữ liệu", tuyệt đối không hiện `0` | spec dòng 72, 82, 619 |
| R-03 | Sửa không hợp lệ ⇒ **0 commit / 0 history**; reducer là nơi duy nhất quyết định hợp lệ | `TC-FBD-INS-001` |
| R-04 | Không chọn gì ⇒ dock hiện đúng 1 thông báo `inspector-collapsed`, **không render form mutation** | `TC-FBD-INS-002` |
| R-05 | Catalog/Point không khả dụng ⇒ hiện lý do + nút Thử lại, **0 entry giả / 0 ID giả** | `TC-FBD-STATE-005` |
| R-06 | Canonical state ở lại reducer trong `StructuredFbdEditor`; Inspector chỉ giữ draft form cục bộ | plan mẹ §7 Step 3 |
| R-07 | Không đổi `executionOrder`, không đổi thứ tự port, không đổi schema FBD v1 | plan mẹ §0.1 |
| R-08 | Không đụng file ngoài `apps/web-ui/src/features/programming/**` (+ `CHANGELOG.md`, `docs/`) | handoff §2 |
| R-09 | Cấm `git add -A` / `git add .` / `git add -p`; chỉ stage theo allowlist từng luồng | handoff §2 |
| R-10 | Mọi file sau khi sửa phải **< 800 dòng** | `coding-style` |

### 2.1 Mở rộng phạm vi so với plan mẹ §7 — có chủ đích

Plan mẹ §7 không liệt kê `ProgramsTab.tsx` và `FbdCanvasLayers.tsx`. Task 7 **cần cả hai**:

- `ProgramsTab.tsx` là nơi duy nhất render `ContextInspector` (dòng 919), nên việc đưa form sửa FBD
  vào dock phải bắt buộc đi qua đây (~20 dòng).
- `FbdCanvasLayers.tsx` là nơi duy nhất vẽ node, nên "node presentation" (plan mẹ §7 Step 4) nằm ở đây.

Cả hai đều nằm trong `apps/web-ui/src/features/programming/**`, không vi phạm R-08.

---

## 3. Quyết định thiết kế

### QĐ-1: Dời form sửa FBD về dock phải qua khuôn `editableProgramSlot` đã có

**Vì sao:** `TC-FBD-INS-002` nói rõ *"mở dock → không render form mutation"*, tức form mutation **thuộc về
dock**. Giữ form ở canvas thì kịch bản này vô nghĩa và hai khay thuộc tính vẫn song song tồn tại.

**Cách làm:** tái dùng đúng khuôn `ProgramsTab.tsx:968` đang dùng cho `editableProgramSlot`
(`ContextInspector.tsx:31-41` đã có prop này). Thêm prop thứ hai cùng kiểu: `editableFbdSlot`.

**Cầu nối reducer → dock:** reducer sống trong `StructuredFbdEditor`, dock sống ở `ProgramsTab`.
`StructuredFbdEditor` công bố lên trên một mô tả node đang chọn kèm hàm áp dụng, qua prop mới.

> **Ba cạm bẫy đã đo thật, bắt buộc xử lý trong QĐ-1 (xem §3.1).** Bỏ qua bất kỳ mục nào là hỏng chắc chắn.

**Cầu nối:**

```ts
// fbd/nodeEditor.ts (file mới)
export interface FbdNodeEditorTarget {
  networkId: string
  node: FbdNode
  canEdit: boolean
  apply: (change: FbdNodeEditorChange) => void   // gọi thẳng dispatch của reducer
}
export type FbdNodeEditorChange =
  | { kind: 'variable'; variable: string; unit: string | null }
  | { kind: 'value'; value: FbdParameterValue }
  | { kind: 'dataType'; dataType: FbdDataType }
  | { kind: 'fbParams'; instance: string | null; retained: boolean }
```

`StructuredFbdEditor` → `onNodeEditorTargetChange?: (target: FbdNodeEditorTarget | null) => void`
→ `FbdEditorPane` chuyển tiếp → `ProgramsTab` giữ trong state → truyền vào `editableFbdSlot`.

Canonical state **không** rời reducer (thoả R-06): dock chỉ cầm một hàm `apply` và một bản đọc của node.
Mọi phán quyết hợp lệ vẫn ở reducer, nên R-03 tự động thoả.

**Lợi phụ (đo thật, không ước lượng):** `NodeInspector` chiếm **dòng 128–310 = 183 dòng**, render site
chiếm **dòng 799–816 = 18 dòng**. Gỡ cả hai đưa `StructuredFbdEditor.tsx` từ **823 → ~623 dòng**,
đóng luôn vi phạm R-10 đang tồn tại.

**Phải giữ lại trong `StructuredFbdEditor.tsx`, cấm gỡ theo:** `inputClass` (dòng 107),
`defaultConstantLiteral`, `isFbdIdentifier` — form tạo node inline của component cha vẫn dùng chúng ở
dòng 481 và 640–720. Gỡ theo là gãy typecheck.

### 3.1 Ba cạm bẫy của QĐ-1 — bắt buộc xử lý

**CB-1 — `editableProgramSlot` luôn được truyền, làm `TC-FBD-INS-002` fail chắc chắn.**
`ContextInspector.tsx:60` thu gọn về `inspector-collapsed` chỉ khi `!useful && editableProgramSlot === undefined`.
Nhưng `ProgramsTab.tsx:968` **luôn** truyền `editableProgramSlot={<ProgramInspector/>}` cho mọi POU, kể cả FBD.
Nên dock không bao giờ rỗng form ⇒ A-T5 và `TC-FBD-INS-002` fail.

Xử lý: điều kiện thu gọn phải tính cả slot mới, và `editableFbdSlot` chỉ được truyền khi **thật sự có node
đang chọn**:

```tsx
// ContextInspector.tsx
{!useful && editableProgramSlot === undefined && editableFbdSlot === undefined ? (
  <p data-testid="inspector-collapsed">…</p>
) : (
  <div className="mt-2 space-y-2">
    {editableProgramSlot}
    {editableFbdSlot}
    {renderContext(pick, context)}
  </div>
)}
```

`ProgramsTab` truyền `editableFbdSlot={fbdNodeEditorTarget ? <FbdNodeInspector …/> : undefined}` — dùng
`undefined`, không dùng `null`, để khớp phép so sánh trên.

**CB-2 — target đọng lại khi đổi POU.** `ProgramsTab.tsx:805-860` unmount `FbdEditorPane` khi chuyển sang
POU ST, nhưng state `fbdNodeEditorTarget` không tự reset ⇒ dock hiện form của node thuộc POU đã đóng.
Xử lý: reset target khi `selected.programId` đổi hoặc `selected.language !== 'FBD'`. Phải có test.

**CB-3 — nguy cơ vòng lặp render vô hạn.** `apply` là closure mới mỗi render; nếu
`onNodeEditorTargetChange` bắn trong `useEffect` với dependency là object target mới, `ProgramsTab`
setState ⇒ re-render ⇒ effect chạy lại ⇒ lặp vô hạn. Xử lý: `apply` bọc `useCallback` với dependency chỉ
gồm `dispatch`; effect chỉ phụ thuộc `[selectedNode, networkId, canEdit, apply, onNodeEditorTargetChange]`
với `selectedNode` lấy qua `useMemo`. Đây là khuôn `StructuredFbdEditor.tsx:384-386` đã dùng đúng cho
`onSelectionChange`; theo đúng khuôn đó.

### QĐ-2: I/O picker mở rộng `InsertPointVariablePanel`, không viết panel thứ hai

Panel này đã xử lý đủ loading / error / empty (`dòng 94-96`) và đã hiển thị badge chất lượng + category.
Viết panel thứ hai là vi phạm DRY và nhân đôi bề mặt lỗi.

**Thay đổi duy nhất cần:** callback hiện là `onInsert(name: string)` — nhánh ST chỉ cần tên. FBD cần thêm
kiểu và đơn vị. Mở rộng **tương thích ngược**:

```ts
onInsert: (name: string, detail?: { dataType?: string; unit?: string }) => void
```

Nhánh ST (`ProgramsTab.tsx:2609-2617`) là **call site duy nhất** hiện có và giữ nguyên, bỏ qua tham số
thứ hai. Nhánh FBD đọc `detail`.

**CB-4 — panel là popover neo tuyệt đối, nhét vào dock sẽ bay lệch.** `InsertPointVariablePanel.tsx:68`
mang class cứng `absolute right-0 top-0 z-20 w-72`, thiết kế cho textarea ST. Dock phải chỉ rộng
~280–300px ⇒ panel tràn hoặc bị che.
Xử lý: thêm prop `variant?: 'popover' | 'embedded'`, mặc định `'popover'` để nhánh ST bất biến. Khi
`'embedded'`: bỏ `absolute right-0 top-0 z-20 w-72`, dùng `w-full` theo flow của dock.

**R-01 (BLK-FBD-001):** `detail` chỉ mang `dataType` và `unit` lấy nguyên văn từ
`ProgrammingPointCatalogEntry`. Không truyền `pointId`, không truyền `deviceId`, không ghi gì vào
`node.parameters` ngoài `variable`. Phải có test khẳng định điều này.

**R-05:** khi `pointCatalogStatus === 'error'`, picker FBD hiện `pointCatalogError` + nút Thử lại gọi
`onEnsureLoaded`, danh sách rỗng — không rơi về danh sách mẫu.

### QĐ-3: Node presentation thêm đúng bốn thứ, không hơn

Theo plan mẹ §7 Step 4: `typeRef/instance`, `tên/hướng/kiểu/đơn vị` của port, `tóm tắt parameter`,
`marker chẩn đoán`. Bốn thứ, dừng ở đó.

- Kiểu/đơn vị port: nối vào text port đang có (`FbdCanvasLayers.tsx:236-246`) thành `name : TYPE (unit)`.

  **CB-5 — tràn khung node.** `FBD_NODE_WIDTH = 168` (`geometry.ts:17`). Chuỗi như
  `ROOM_TEMP_SENSOR : REAL (degC)` dài ~180px ⇒ tràn ra ngoài, đè lên port đối diện và đè điểm cắm dây.
  Xử lý: cắt ngắn có kiểm soát — giữ `name` đầy đủ, phần ` : TYPE (unit)` chỉ vẽ khi tổng ký tự ≤ ngưỡng
  tính từ `FBD_NODE_WIDTH`; vượt ngưỡng thì cắt bằng dấu `…` và **giữ nguyên `aria-label` đầy đủ** để
  không mất thông tin cho trình đọc màn hình. Không nới `FBD_NODE_WIDTH` (đổi hình học là việc của Task 4,
  ngoài phạm vi Task 7).

- Tóm tắt parameter: một dòng dưới `kind`, theo `node.kind` — `INPUT`/`OUTPUT` hiện `parameters.variable`,
  `CONSTANT` hiện `parameters.value`, `FUNCTION_BLOCK` hiện `parameters.instance`. Thiếu ⇒ để trống,
  không hiện chuỗi mẫu. Áp cùng luật cắt ngắn của CB-5.

- Marker chẩn đoán: nhận thêm prop `issueNodeIds?: ReadonlySet<string>`.

  **CB-6 — `nodeId` không có sẵn, phải map.** `FbdIssue` chỉ mang `path` dạng
  `$.networks[0].nodes[2].typeRef` (`issueTargets.ts:18`), không mang `nodeId`. `fbdIssueTargets` mới là
  thứ dịch path sang `FbdSelection`. `StructuredFbdEditor.tsx:748` đang gọi hàm này **inline trong JSX**,
  tức chạy lại mỗi render.
  Xử lý: nâng lên một `useMemo` dùng chung cho cả danh sách Problems và `issueNodeIds`, tránh gọi hai lần:

  ```ts
  const issueTargets = useMemo(() => fbdIssueTargets(state.document, issues), [state.document, issues])
  const issueNodeIds = useMemo(() => {
    const ids = new Set<string>()
    for (const target of issueTargets) {
      if (target.selection?.kind === 'node') ids.add(target.selection.nodeId)
    }
    return ids
  }, [issueTargets])
  ```

  Node có lỗi vẽ viền cảnh báo + `aria-label` bổ sung. **Không** gọi validator lần thứ hai.

- **R-02:** không thêm bất kỳ trường runtime nào lên node.

`FbdCanvasLayers.tsx` hiện 392 dòng; nếu vượt 800 sau khi thêm thì tách `FbdNodeShape.tsx`. Dự kiến
không cần (ước tính ~470 dòng).

---

## 4. Bản đồ file và allowlist theo luồng

| Luồng | File | Thao tác | Trần dòng |
|---|---|---|---|
| **A** | `fbd/nodeEditor.ts` | tạo mới — type `FbdNodeEditorTarget`, `FbdNodeEditorChange` | ~60 |
| **A** | `fbd/FbdNodeInspector.tsx` | tạo mới — form sửa, chuyển từ `NodeInspector` inline | ~260 |
| **A** | `fbd/FbdNodeInspector.test.tsx` | tạo mới | — |
| **A** | `fbd/StructuredFbdEditor.tsx` | gỡ `NodeInspector` inline, thêm `onNodeEditorTargetChange` | 823 → ~713 |
| **A** | `design/inspector/ContextInspector.tsx` | thêm prop `editableFbdSlot` | 395 → ~405 |
| **A** | `design/editor/FbdEditorPane.tsx` | chuyển tiếp prop mới | 129 → ~135 |
| **A** | `design/editor/ProgramsTab.tsx` | giữ state target, truyền `editableFbdSlot` | 3070 → ~3090 |
| **A** | `design/inspector/ContextInspector.test.tsx`, `fbd/StructuredFbdEditor.test.tsx` | mở rộng | — |
| **B** | `design/editor/InsertPointVariablePanel.tsx` | mở rộng `onInsert` với `detail` | 130 → ~140 |
| **B** | `design/editor/InsertPointVariablePanel.test.tsx` | mở rộng / tạo | — |
| **B** | `fbd/FbdNodeInspector.tsx` | nối picker vào trường biến của node I/O | ~260 → ~320 |
| **C** | `fbd/FbdCanvasLayers.tsx` | kiểu/đơn vị port, tóm tắt parameter, marker chẩn đoán | 392 → ~470 |
| **C** | `fbd/FbdCanvas.tsx` | chuyển tiếp `issueNodeIds` | +~8 |
| **C** | `fbd/FbdCanvasLayers.test.tsx` hoặc `FbdCanvas.presentation.test.tsx` | tạo mới | — |
| **D** | `CHANGELOG.md` | mục `[Unreleased]` | — |

**Cấm đụng:** `commands.ts` (đã 844 dòng, không cần đổi), `model.ts`, `inspectorContext.ts`,
`palette.ts`, `libraryCatalog.ts`, `api/generated/**`, `ProgrammingHeader.tsx`, `ProgrammingLayout.tsx`,
và mọi thứ ngoài `apps/web-ui/src/features/programming/**`.

---

## 5. Thứ tự thực thi

```
Luồng A (tuần tự, chặn B và C)
  A1 tách FbdNodeInspector + nodeEditor.ts, giữ nguyên hành vi
  A2 nối editableFbdSlot qua FbdEditorPane → ProgramsTab
  A3 gỡ NodeInspector khỏi StructuredFbdEditor, xác nhận < 800 dòng
        │
        ├── Luồng B (song song)  I/O picker cho node INPUT/OUTPUT
        └── Luồng C (song song)  node presentation trên canvas
                    │
              Luồng D (tuần tự) kiểm chứng đa tầng + CHANGELOG
```

Tối đa **2 subagent chạy đồng thời** (B và C), đúng ngưỡng `agents.md`. Allowlist của B và C rời nhau
hoàn toàn — B không chạm file nào của C và ngược lại.

---

## 6. Ma trận test (viết test trước, TDD)

### 6.0 Test hồi quy sẽ gãy — phải di dời, không được xoá

`StructuredFbdEditor.test.tsx:229-243`, test
*"Arrow/Delete/Ctrl+Z trong ô nhập giữ hành vi native, không biến thành lệnh sửa graph"*, bấm chọn block
`Input` rồi query `screen.getByLabelText(/Variable name|Tên biến/)`. Ô nhập đó nằm **trong** `NodeInspector`.
Gỡ `NodeInspector` khỏi `StructuredFbdEditor` ⇒ test này gãy chắc chắn (`Unable to find label`).

Xử lý: **di dời** test sang `FbdNodeInspector.test.tsx`, giữ nguyên ý nghĩa khẳng định (phím Arrow/Delete/
Ctrl+Z trong ô nhập không biến thành lệnh sửa graph). Cấm xoá — đây là bảo vệ hồi quy thật.

`TC-FBD-LIB-003` (compatible filter BOOL/REAL) **đã hoàn tất ở Task 6**
(`StructuredFbdEditor.tsx:330, 415-430, 617-628`; test tại `StructuredFbdEditor.test.tsx:244-326`).
Task 7 không làm lại, chỉ không được làm gãy.

### 6.0.1 Tầng test — chọn đúng chỗ mount

| Kịch bản | Tầng mount | Vì sao |
|---|---|---|
| A-T1..A-T4, A-T7, A-T9 | `FbdNodeInspector.test.tsx` (cô lập, `dispatch` là spy) | Khẳng định về dispatch/validate, không cần cây đầy đủ |
| **A-T5, A-T8** | `ProgramsTab.test.tsx` (tích hợp) | Khay dock nằm ở `ProgramsTab`, **không** ở `StructuredFbdEditor`; test cô lập không thấy được cả hai khay |
| A-T6 | `ContextInspector.test.tsx` | Nhánh `FBD_CONNECTION` chỉ đọc |
| B-T1..B-T6, B-T8 | `FbdNodeInspector.test.tsx` + `InsertPointVariablePanel.test.tsx` | |
| B-T7 | `ProgramsTab.test.tsx` | Hồi quy nhánh ST |
| C-T1..C-T7 | `FbdCanvas.presentation.test.tsx` | |

**Giới hạn jsdom cho Luồng C, ghi nhận trước:** jsdom không tính SVG layout (`getBBox` trả 0). Test C chỉ
khẳng định được **nội dung text và `aria-label`**, không khẳng định được việc text có tràn khung hay đè
lên dây. Việc chống tràn (CB-5) kiểm bằng luật cắt ngắn thuần (test được hàm cắt) + bằng chứng trực quan
ở Task 11; **không tuyên bố** jsdom đã chứng minh không tràn.

### Luồng A — Inspector sửa được

| # | Kịch bản | Khẳng định | Mã |
|---|---|---|---|
| A-T1 | Chọn node `CONSTANT`, sửa giá trị hợp lệ | dock phải phát đúng 1 `SET_NODE_VALUE`, document đổi, 1 entry undo | `TC-FBD-INS-001` |
| A-T2 | Chọn node `INPUT`, nhập tên biến sai định danh | 0 commit, 0 history, hiện lỗi tại chỗ | `TC-FBD-INS-001`, R-03 |
| A-T3 | Chọn node `FUNCTION_BLOCK`, đổi instance + retained | đúng 1 `SET_NODE_FB_PARAMS` | `TC-FBD-INS-001` |
| A-T4 | Chọn node đa hình, đổi `dataType` | đúng 1 `SET_NODE_TYPE`, thứ tự port giữ nguyên | R-07 |
| A-T5 | Không chọn gì | có `inspector-collapsed`, **0 phần tử form** trong DOM dock | `TC-FBD-INS-002`, R-04 |
| A-T6 | Chọn `wire` | dock hiện `FBD_CONNECTION` chỉ đọc, không có form mutation | `TC-FBD-INS-002` |
| A-T7 | `canEdit === false` | mọi control disabled, 0 dispatch | `TC-FBD-STATE-004` |
| A-T8 | Chọn node xong chọn node khác | chỉ còn đúng 1 khay thuộc tính trong DOM (không còn khay inline ở canvas) | spec dòng 106 |
| A-T9 | Chế độ EDIT, không có overlay runtime | không có số runtime nào render trên dock | R-02 |
| A-T10 | Chọn `port` của một node | dock hiện block cha kèm dòng port đó (đúng hành vi `inspectorContext.ts:211` đang có); form sửa thuộc về **node**, không sinh khay riêng cho port | `TC-FBD-INS-001` |
| A-T11 | Chọn node FBD rồi chuyển sang POU ST | target reset, dock không còn form node của POU cũ | CB-2 |
| A-T12 | Chọn node, render lại nhiều lần | `onNodeEditorTargetChange` không gây lặp vô hạn (đếm số lần gọi có trần) | CB-3 |
| A-T13 | Test hồi quy di dời: Arrow/Delete/Ctrl+Z trong ô nhập | giữ hành vi native, 0 lệnh sửa graph | §6.0 |

### Luồng B — I/O picker

| # | Kịch bản | Khẳng định | Mã |
|---|---|---|---|
| B-T1 | Node `INPUT`, mở picker, chọn 1 point | trường tên/kiểu/đơn vị điền đúng từ entry | `TC-FBD-INS-001` |
| B-T2 | Chọn point rồi Áp dụng | `node.parameters` **chỉ** có `variable`; không có `variableId`/`pointId`/`deviceId` | R-01, `BLK-FBD-001` |
| B-T3 | Không sinh Mapping/Binding | 0 lời gọi API ghi, document.bindings không đổi | R-01 |
| B-T4 | `pointCatalogStatus === 'error'` | hiện `pointCatalogError` + nút Thử lại, danh sách rỗng, 0 entry mẫu | `TC-FBD-STATE-005`, R-05 |
| B-T5 | Bấm Thử lại | gọi đúng 1 lần `onEnsureLoaded` | R-05 |
| B-T6 | Point thiếu `unit` | đơn vị hiện "không xác định được", không hiện chuỗi rỗng | R-05 |
| B-T7 | Nhánh ST gọi `onInsert` cũ, không truyền `variant` | vẫn là popover `absolute`, hoạt động nguyên vẹn (hồi quy) | CB-4 |
| B-T8 | `pointCatalogStatus === 'loading'` | hiện "Đang tải…", chưa hiện danh sách, không cho chọn | `TC-FBD-STATE-005` |
| B-T9 | `variant='embedded'` trong dock | không có class `absolute`, chiếm đủ bề ngang dock | CB-4 |

### Luồng C — node presentation

| # | Kịch bản | Khẳng định |
|---|---|---|
| C-T1 | Node có port `REAL` kèm `unit` | canvas hiện `name : REAL (unit)` |
| C-T2 | Node `INPUT` có `parameters.variable` | canvas hiện tên biến |
| C-T3 | Node `CONSTANT` có `parameters.value` | canvas hiện giá trị |
| C-T4 | Node thiếu parameter | để trống, không hiện chuỗi mẫu |
| C-T5 | Node nằm trong `issueNodeIds` | có marker cảnh báo + `aria-label` nêu có lỗi |
| C-T6 | Chế độ EDIT | 0 giá trị runtime trên node (R-02) |
| C-T7 | Kéo node sau khi thêm text | `executionOrder` không đổi (R-07) |

---

## 7. Kiểm chứng bắt buộc (Luồng D)

Chạy đúng thứ tự, ghi **số đo thật**, không dẫn lại số của Task 6:

```bash
cd apps/web-ui
npx vitest --run --environment jsdom src/features/programming/design/inspector src/features/programming/fbd src/features/programming/design/editor
npm test
npm run lint
npm run typecheck
npm run build
npm run check:bundle-budget
cd ../..
```

Cổng phải đạt:

| Cổng | Ngưỡng | Ghi chú |
|---|---|---|
| Vitest toàn bộ | 100% pass, không giảm số test so với 2604 | |
| `npm run lint` | 0 error, 0 warning (gồm `check:ui-strings` cho dấu tiếng Việt) | |
| `npm run typecheck` | 0 lỗi | |
| `check:bundle-budget` (r3) | ≤ 165 KiB — cổng cấu hình thật của repo | |
| Mục tiêu R1 | ≤ 125 KiB | **Rủi ro:** Task 6 để lại 122.45 KiB, chỉ dư **2.55 KiB** |
| Số dòng | mọi file sửa < 800 | kiểm bằng `wc -l` |

### 7.1 Rủi ro bundle R1 — xử lý trước, không giấu

Task 7 thêm form + picker + presentation. Dư địa R1 chỉ 2.55 KiB nên khả năng vượt là thật.

- Nếu R1 vượt: **không** hạ chuẩn, **không** sửa `verify_programming_bundle_budget.py` (ngoài allowlist),
  **không** sửa `contracts/programming/pgm02_workspace_v1.json` (ngoài allowlist).
- Ghi con số vượt chính xác vào CHANGELOG + báo cáo, nêu rõ cổng repo R3 vẫn PASS, và chuyển quyết định
  nới trần R1 cho Owner — đúng như plan mẹ §1.5 Step 4 và §13 đã quy định.
- Bù trước bằng cách rẻ: `FbdNodeInspector` là code chuyển chỗ, không phải code mới; picker tái dùng panel
  đã nằm sẵn trong chunk. Phần thật sự mới chỉ là presentation.

---

## 8. Định nghĩa hoàn thành Task 7

- [ ] Dock phải sửa được parameter/type/biến/instance của node FBD; sai ⇒ 0 commit / 0 history.
- [ ] Không chọn gì ⇒ đúng 1 thông báo `inspector-collapsed`, 0 form mutation trong DOM.
- [ ] Chỉ còn **một** khay thuộc tính mô tả selection FBD; khay inline ở canvas đã gỡ.
- [ ] I/O picker điền `name`/`dataType`/`unit` từ Point Catalog và biến Draft; **0** `variableId`, **0** Mapping ẩn.
- [ ] Catalog lỗi ⇒ lý do + Thử lại, 0 entry giả.
- [ ] Node trên canvas hiện typeRef/instance, kiểu và đơn vị port, tóm tắt parameter, marker chẩn đoán;
      **0** runtime value ở chế độ EDIT.
- [ ] `StructuredFbdEditor.tsx` < 800 dòng; mọi file sửa < 800 dòng.
- [ ] Vitest / lint / typecheck / build xanh, số đo ghi thật.
- [ ] `check:bundle-budget` (r3) PASS; số đo R1 ghi minh bạch kèm kết luận đạt hay vượt bao nhiêu.
- [ ] `CHANGELOG.md` cập nhật mục `[Unreleased]` trong cùng phiên.

---

## 9. Điều kiện dừng

Dừng và báo Owner, không tự quyết, khi gặp:

1. Cần thêm trường vào schema FBD v1 → chạm `BLK-FBD-001`, mở decision BE riêng.
2. Cần sửa file ngoài `apps/web-ui/src/features/programming/**` → vi phạm R-08.
3. R1 vượt trần → ghi số đo, chuyển quyết định nới trần cho Owner (§7.1).
4. Cần thêm action mới vào `commands.ts` → file đã 844 dòng, phải tách sub-reducer trước và báo lại.
