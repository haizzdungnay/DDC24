
> **GOAL — Rebuild DDC-24 Programming / ST Editor workspace theo thiết kế đã phê duyệt, giữ nguyên business logic/runtime API hiện có. Chuẩn hóa workspace theo mô hình IEC 61131-3: POU → Interface → Execution/Task → Attributes → DDC Metadata → References; tổ chức lại editor thành POU Tree + Code Editor + Quick Library + Context Inspector + Diagnostics/Runtime, giảm clutter, tăng không gian lập trình và bảo đảm mọi trạng thái Edit/Check/Save/Run/Live phản ánh rõ ràng, nhất quán.**



# Các GAP cần implement

| ID       | GAP hiện tại                                                                                        | Thiết kế mục tiêu                                                                                                             | Priority |
| -------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------- |
| **G-01** | Header có quá nhiều tầng: Device bar + Project status bar + workspace toolbar                       | Gộp thành **một Global Context Bar** như design: Project / Editing revision / Running revision / Controller / Save / Check    | P0       |
| **G-02** | `Programs / Points & Mapping / Execution` lặp lại navigation đã có ở sidebar                        | Bỏ navigation trùng. Sidebar là navigation cấp product; workspace chỉ giữ context của Programming                             | P0       |
| **G-03** | Project status hiện bằng nhiều badge nhỏ `DRAFT`, `ACTIVE`, `CORE`, `PROGRAMS`, `RUNNING` gây nhiễu | Chỉ giữ status chính: **Editing revision**, **Running revision**, **Controller Online**; chi tiết đưa vào diagnostics/details | P0       |
| **G-04** | `EDIT / LIVE / SIMULATE` nằm độc lập, hierarchy chưa rõ                                             | Thiết kế rõ **workspace mode switch**, có state machine và visual hierarchy thống nhất                                        | P1       |
| **G-05** | Alert “Draft has unsaved changes...” chiếm cả một hàng lớn                                          | Chuyển thành compact notification/status; không chiếm permanent editor space                                                  | P1       |
| **G-06** | POU tree chỉ chiếm cột trái nhưng hierarchy/spacing khá thô                                         | Rebuild POU Explorer theo `Programs / Function Blocks / Functions`, có search, New, expand/collapse, status                   | P0       |
| **G-07** | Action `ST+ / FN+ / FB+` khó hiểu                                                                   | Thay bằng **+ New** → Program / Function Block / Function và chọn Language                                                    | P1       |
| **G-08** | Edit/copy/delete icon xuất hiện trực tiếp trên từng POU gây clutter                                 | Chỉ hiện contextual actions khi hover hoặc `…` menu                                                                           | P1       |
| **G-09** | Editor toolbar gồm nhiều control nhưng grouping chưa rõ                                             | Group chuẩn: Undo/Redo → Insert/Library → Search → Format → Language/View → Save/Check                                        | P1       |
| **G-10** | `Format` đang là primary action trong editor                                                        | `Save` và `Check` mới là action chính; Format là secondary/editor tool                                                        | P1       |
| **G-11** | Quick Library đang chiếm **toàn bộ cột phải**                                                       | Đưa Quick Library thành panel bên cạnh code, trước Inspector; collapse/resizable                                              | **P0**   |
| **G-12** | **Inspector thực tế chưa tồn tại** dù có chữ “Collapse inspector”                                   | Implement Inspector đúng context-sensitive design                                                                             | **P0**   |
| **G-13** | Không có `General` metadata của POU                                                                 | Inspector phải có `Name / POU Type / Language / Namespace / Description`                                                      | **P0**   |
| **G-14** | Không có IEC Interface view                                                                         | Thêm `VAR_INPUT / VAR_OUTPUT / VAR_IN_OUT / VAR / VAR_TEMP / VAR_EXTERNAL`                                                    | **P0**   |
| **G-15** | Không có Parameters editor đúng nghĩa                                                               | Có table `Name / Direction / Type / Init / Retain / Description` và validate type                                             | **P0**   |
| **G-16** | Không có Task binding trong editor                                                                  | Inspector có `Resource / Task / Mode / Interval / Priority / Watchdog`                                                        | **P0**   |
| **G-17** | `Execution` hiện thành page/tab tách biệt hoàn toàn khỏi POU                                        | Khi chọn POU phải thấy execution context ngay trong Inspector; page Execution chỉ dành global task configuration              | P0       |
| **G-18** | Không có `Attributes` rõ IEC vs vendor                                                              | Tách **IEC Attributes** và **DDC Attributes**                                                                                 | P0       |
| **G-19** | Không có DDC engineering metadata                                                                   | Thêm `Unit / Range / BACnet / Modbus / Historian / Alarm / Writable` khi applicable                                           | P1       |
| **G-20** | Không có References trong Inspector                                                                 | Thêm `Used by / Uses / Calls / Cross References / Task` và jump-to-definition                                                 | P1       |
| **G-21** | ST language đang gắn cạnh POU nhưng không có lifecycle đổi language                                 | Language phải được khóa sau khi POU đã có nội dung hoặc có explicit conversion workflow                                       | P1       |
| **G-22** | Problems chỉ là tab dưới đáy, runtime info rất hạn chế                                              | Bottom workbench phải có `Problems / Runtime Watch / Search / Cross Reference / Trace`                                        | P0       |
| **G-23** | `Watch (Live)` chưa thể hiện dữ liệu trực tiếp trong screenshot                                     | Watch phải có `Name / Value / Type / Quality / Timestamp`                                                                     | P0       |
| **G-24** | Problems không được liên kết trực quan mạnh với code                                                | Click lỗi → jump line/column; underline code; severity icon; quick fix khi có                                                 | P0       |
| **G-25** | Code minimap đang chiếm vùng nhưng hierarchy không rõ                                               | Giữ minimap nhưng cho toggle; không tranh chỗ với Inspector/Library                                                           | P2       |
| **G-26** | Workspace không resize theo nhu cầu                                                                 | POU tree, Library, Inspector, Bottom Panel phải **resizable + collapsible**                                                   | P0       |
| **G-27** | Không có Full Screen / Focus Editor rõ ràng                                                         | Thêm Focus Mode để code editor sử dụng gần toàn viewport                                                                      | P1       |
| **G-28** | Màu/status quá nhiều xanh lá, badge và border                                                       | Chuẩn hóa semantic colors: normal, info, warning, fault, active; tránh “green everywhere”                                     | P1       |
| **G-29** | Dark UI hiện tại có mật độ đường viền rất cao                                                       | Giảm borders, dùng spacing/section hierarchy, surface rõ ràng hơn                                                             | P1       |
| **G-30** | Typography nhỏ và nhiều text all-caps                                                               | Chuẩn hóa typography hierarchy và density                                                                                     | P1       |

---

# GAP lớn nhất: Inspector

Hiện tại bên phải thực chất đang là:

```text
QUICK LIBRARY
 ├─ Search
 ├─ Recent
 └─ Catalog
```

Trong khi target phải là:

```text
CODE EDITOR
        │
        ├── QUICK LIBRARY
        │
        └── INSPECTOR
              ├── General
              ├── Interface
              ├── Execution
              ├── Attributes
              ├── DDC Metadata
              └── References
```

Đây là **GAP P0**, vì Inspector là nơi kết nối code ST với data model IEC của DDC.

---

# Target layout nên implement

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Project │ Editing r24 Draft │ Running r23 Active │ DDC-24-01 Online │ Save Check │
├──────────────┬───────────────────────────────────┬────────────┬──────────────┤
│              │ POU Tabs                          │            │              │
│ POU          ├───────────────────────────────────┤  QUICK     │ INSPECTOR    │
│ EXPLORER     │                                   │  LIBRARY   │              │
│              │                                   │            │ General      │
│ Programs     │           ST EDITOR               │ PID        │ Interface    │
│ FB           │                                   │ TON        │ Execution    │
│ Functions    │                                   │ LIMIT      │ Attributes   │
│              │                                   │ ...        │ DDC Metadata │
│              │                                   │            │ References   │
├──────────────┴───────────────────────────────────┴────────────┴──────────────┤
│ Problems │ Runtime Watch │ Search │ Cross Reference │ Trace                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

Tức là từ **3 vùng chính hiện tại** chuyển thành **4 vùng có trách nhiệm rõ ràng**:

**Explorer → Editor → Library → Inspector**.

---

# Inspector behavior bắt buộc

Không được làm Inspector tĩnh.

### Khi chọn `PROGRAM`

```text
GENERAL
Name
POU Type
Language
Namespace
Description

INTERFACE
Input
Output
InOut
Local
External

EXECUTION
Resource
Task
Mode
Interval
Priority
Watchdog

ATTRIBUTES
IEC Attributes

DDC METADATA
...

REFERENCES
...
```

### Khi chọn `FUNCTION_BLOCK`

```text
GENERAL

INTERFACE
VAR_INPUT
VAR_OUTPUT
VAR_IN_OUT

PARAMETERS
Initial values
Retain
Description

ATTRIBUTES

REFERENCES
```

### Khi click biến `temp_sp`

```text
VARIABLE
Name
Class
Data Type
Initial Value

ENGINEERING
Unit
Min
Max

STORAGE
Retain
Constant

MAPPING
Physical Point
BACnet
Modbus

RUNTIME
Current Value
Quality
Timestamp
Force

REFERENCES
Read by
Written by
```

Đây mới là Inspector đúng nghĩa.

---

# Execution cần sửa kiến trúc

Hiện tại anh đang có riêng:

```text
Programs
Points & Mapping
Execution
```

Không nên bỏ hoàn toàn `Execution`.

Nó nên có **2 mức**:

### Global Execution page

Quản lý toàn bộ task:

```text
Control_Fast       20 ms
Control_Main      100 ms
HVAC_Main           1 s
Background         10 s
```

### POU Inspector

Cho biết POU hiện tại đang chạy ở đâu:

```text
Execution
────────────────
Resource      CPU_Main
Task          HVAC_Main
Mode          Cyclic
Interval      T#1s
Priority      10
Watchdog      T#200ms
```

Như vậy user không phải nhảy page chỉ để biết `Main` chạy cycle bao nhiêu.

---

# Một số thứ hiện tại nên GIỮ

Không phải rebuild toàn bộ. Những phần sau có thể giữ logic và redesign presentation:

* Monaco/code editor.
* Syntax highlighting.
* Tabs nhiều POU.
* Minimap.
* Problems.
* Search.
* Cross Reference.
* Watch/Live.
* Library catalog.
* Save/Check backend workflow.
* Revision Draft/Active concept.
* Runtime status.
* POU tree data model.

Tức là **ưu tiên refactor UI shell và information architecture**, không viết lại engine.

---

# Acceptance Criteria cho team

Tôi sẽ đặt Definition of Done tối thiểu:

1. Workspace đúng cấu trúc `Explorer + Editor + Library + Inspector + Bottom Workbench`.
2. Inspector là **context-sensitive**, không phải static form.
3. PROGRAM/FUNCTION/FUNCTION_BLOCK sử dụng data model phù hợp IEC 61131-3.
4. Interface hiển thị và sửa được declaration variables.
5. POU → Task binding xem được trực tiếp từ Inspector.
6. Task configuration hỗ trợ tối thiểu `Cyclic / Interval / Priority / Watchdog`.
7. DDC metadata tách khỏi IEC attributes.
8. Click Problem/Cross Reference → navigate trực tiếp đến code.
9. Runtime Watch thể hiện Value/Type/Quality/Timestamp.
10. Các panel đều resize/collapse được.
11. Save/Check/Dirty/Running state nhất quán toàn workspace.
12. Không thay đổi API/runtime behavior nếu không có yêu cầu architecture riêng.
13. Không regression ST/FBD hiện có.
14. Desktop 1920×1080 vẫn thấy đủ editor + Inspector mà không bị layout vỡ.



> **Rebuild DDC-24 Programming ST Editor FE theo approved design. Không thay đổi runtime/business logic hiện có nếu không cần thiết. Refactor workspace thành POU Explorer + ST Editor + Quick Library + context-sensitive Inspector + Bottom Diagnostics/Runtime Workbench. Implement Inspector theo model `General → Interface → Execution → IEC Attributes → DDC Metadata → References`; hỗ trợ PROGRAM/FUNCTION/FUNCTION_BLOCK, variable declarations, Task binding/cycle/priority/watchdog, runtime values, cross-reference và engineering metadata. Loại bỏ duplicated navigation/status clutter, chuẩn hóa Save/Check/Edit/Live states, resizable/collapsible panels và modern industrial UI. Hoàn thành toàn bộ GAP G-01…G-30, ưu tiên P0 trước, giữ backward compatibility và không regression ST/FBD/runtime.`



---
---

# IMPLEMENTATION PLAN — Kế hoạch thực thi

## PHÂN TÍCH HIỆN TRẠNG

### Baseline code
- `DesignWorkspacePage.tsx` (994 dòng): trang cha, 3 tab
- `ProgramsTab.tsx` (3301 dòng): editor core — **ĐÂY LÀ MỤC TIÊU REFACTOR CHÍNH**
- `PouExplorer.tsx` (520 dòng): 3 nhóm Programs/FB/Functions ✓ đã đúng
- `ContextInspector.tsx` (401 dòng): 5 context, CHỈ CÓ 2 FIELD — **THIẾU HOÀN TOÀN**
- `DesignWorkbench.tsx` (290 dòng): Problems/Watch/Search/CrossRef ✓ đã có

### Draft v2 schema — Field có sẵn
```typescript
ProgrammingProgram {
  name, kind, language          ✓
  description, access           ✓ Draft v2 (G-13)
  periodMs                      ✓ Draft v2 (G-16 chu kỳ)
  hasRuntimeConfig              ✓ Draft v2 (G-16 scheduled)
  dependencies[]                ✓ Draft v2 (G-20 Uses)
}

ProgrammingPouInterface {
  inputs: { name, type }[]      ✓ (G-14)
  outputs: { name, type }[]     ✓ (G-14)
  returnType                    ✓ (G-14 FUNCTION)
}
```

### Field chưa có (hiện "không xác định được")
- Task name, Priority, Watchdog
- VAR/VAR_TEMP/VAR_EXTERNAL (phải parse ST)
- IEC Attributes, DDC Metadata
- Used by, Calls

---

## 4 PHASES — 6.5 ngày

### PHASE 1: Inspector Foundation (2 ngày) — P0 NHẤT
**Mục tiêu**: Thêm Interface + Execution sections vào Inspector

#### Files mới
```
apps/web-ui/src/features/programming/design/inspector/sections/
├── InterfaceSection.tsx        (~200 dòng)
├── ExecutionSection.tsx        (~150 dòng)
├── AttributesSection.tsx       (~100 dòng)
├── DdcMetadataSection.tsx      (~150 dòng)
└── ReferencesSection.tsx       (~150 dòng)
```

#### InterfaceSection.tsx
```tsx
// Hiển thị:
// - VAR_INPUT table (name | type | description)
// - VAR_OUTPUT table (name | type | description)
// - VAR_IN_OUT table (nếu FB)
// - Return type (nếu FUNCTION)

<CollapsibleSection title="Interface">
  <h4>VAR_INPUT</h4>
  <table>
    {pouInterface.inputs.map(port => (
      <tr key={port.name}>
        <td>{port.name}</td>
        <td>{port.type}</td>
      </tr>
    ))}
  </table>
</CollapsibleSection>
```

#### ExecutionSection.tsx
```tsx
// Data: periodMs, hasRuntimeConfig, taskName?
// Hiển thị:
// - Resource: "CPU_Main" (hardcode tạm)
// - Task: taskName hoặc "không xác định được"
// - Mode: "Cyclic" (hardcode tạm)
// - Interval: periodMs → "100 ms" / "1 s"
// - Priority: "không xác định được"
// - Watchdog: "không xác định được"
// - Scheduled: hasRuntimeConfig → "Đã xếp lịch" / "Chạy khi được gọi"

<Field label="Chu kỳ (trong Task)"
  field={periodMs >= 1000 ? `${periodMs/1000} s` : `${periodMs} ms`} />
<Field label="Trạng thái mong muốn"
  field={hasRuntimeConfig ? "Đã xếp lịch chạy" : "Chạy khi được gọi"} />
```

#### Cập nhật ContextInspector.tsx
```tsx
case 'PROGRAM':
  return (
    <>
      <GeneralSection ... />  {/* đã có */}
      <InterfaceSection pouInterface={userPouInterfaces} pouKind={context.pouKind} />  {/* MỚI */}
      <ExecutionSection periodMs={context.periodMs} hasRuntimeConfig={...} />  {/* MỚI */}
      <AttributesSection ... />  {/* MỚI - placeholder */}
      <DdcMetadataSection ... />  {/* MỚI - placeholder */}
      <ReferencesSection dependencies={context.dependencies} ... />  {/* MỚI */}
    </>
  )
```

**AC Phase 1**:
- ✓ Chọn PROGRAM → thấy Interface table (inputs/outputs)
- ✓ PROGRAM có periodMs=100 → thấy "100 ms" trong Execution
- ✓ FUNCTION → thấy Interface (inputs + return type)
- ✓ FUNCTION_BLOCK → thấy Interface (inputs + outputs)
- ✓ Field chưa có → hiện "không xác định được"

---

### PHASE 2: 4-Column Layout (1.5 ngày) — P0
**Mục tiêu**: Tách ProgramsTab 3301 dòng, dựng layout 4 cột resizable

#### Tách ProgramsTab thành
```
apps/web-ui/src/features/programming/design/editor/
├── ProgramsWorkspace.tsx       (~400 dòng) — layout mới
├── EditorPane.tsx              (~500 dòng) — ST/FBD tabs
├── QuickLibraryPanel.tsx       (~300 dòng) — extract từ ProgramsTab
└── EditorToolbar.tsx           (~200 dòng) — Undo/Redo/Save/Check
```

#### ProgramsWorkspace.tsx — Layout 4 cột
```tsx
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from 'react-resizable-panels'

export function ProgramsWorkspace() {
  return (
    <ResizablePanelGroup direction="horizontal">
      {/* Column 1: POU Explorer */}
      <ResizablePanel defaultSize={15} minSize={10}>
        <PouExplorer ... />
      </ResizablePanel>
      <ResizableHandle />

      {/* Column 2: Editor */}
      <ResizablePanel defaultSize={45}>
        <EditorPane>  {/* ST/FBD + toolbar */}
          <EditorToolbar ... />
          {language === 'ST' ? <SourceEditor ... /> : <FbdEditorPane ... />}
        </EditorPane>
      </ResizablePanel>
      <ResizableHandle />

      {/* Column 3: Quick Library */}
      <ResizablePanel defaultSize={20} collapsible>
        <QuickLibraryPanel
          collapsed={libCollapsed}
          onInsert={handleInsert}
          onToggleCollapse={() => setLibCollapsed(!libCollapsed)}
        />
      </ResizablePanel>
      <ResizableHandle />

      {/* Column 4: Inspector */}
      <ResizablePanel defaultSize={20} minSize={15}>
        <ContextInspector ... />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
```

#### QuickLibraryPanel.tsx — Extract từ ProgramsTab
```tsx
// Extract phần Library sidebar hiện có:
// - Search input
// - Recent tab
// - Catalog tab (PID, TON, LIMIT...)
// - Collapse button

export function QuickLibraryPanel({
  onInsert,
  collapsed,
  onToggleCollapse
}: QuickLibraryPanelProps) {
  if (collapsed) {
    return <button onClick={onToggleCollapse}>◀ Library</button>
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-between p-2">
        <h3>Quick Library</h3>
        <button onClick={onToggleCollapse}>▶</button>
      </div>
      <input placeholder="Search..." />
      <Tabs>
        <Tab label="Recent">{recentItems}</Tab>
        <Tab label="Catalog">{catalogItems}</Tab>
      </Tabs>
    </div>
  )
}
```

**AC Phase 2**:
- ✓ 4 cột rõ ràng: Explorer | Editor | Library | Inspector
- ✓ Kéo resize handle giữa các cột
- ✓ Bấm collapse Library → editor rộng hơn
- ✓ Desktop 1920×1080 không vỡ layout
- ✓ e2e: chọn POU, edit code, insert library, thấy inspector — không regression

---

### PHASE 3: Global Context Bar (1 ngày) — P0
**Mục tiêu**: Gộp 3 tầng header thành 1 hàng

#### GlobalContextBar.tsx
```tsx
// apps/web-ui/src/features/programming/layout/GlobalContextBar.tsx

export function GlobalContextBar({
  projectName,
  editingRevision,    // { id: "r24", state: "Draft" }
  runningRevision,    // { id: "r23", state: "Active" }
  controllerStatus,   // { name: "DDC-24-01", online: true }
  onSave,
  onCheck,
  saveDisabled,
  checkDisabled
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b bg-[var(--c-surface-1)]">
      {/* Project */}
      <span className="font-semibold text-[var(--c-text)]">{projectName}</span>
      <Separator />

      {/* Editing */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-[var(--c-text-dim)]">Editing</span>
        <span className="font-mono text-sm">{editingRevision.id}</span>
        <Badge variant="warn">{editingRevision.state}</Badge>
      </div>
      <Separator />

      {/* Running */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-[var(--c-text-dim)]">Running</span>
        <span className="font-mono text-sm">{runningRevision.id}</span>
        <Badge variant="success">{runningRevision.state}</Badge>
      </div>
      <Separator />

      {/* Controller */}
      <div className="flex items-center gap-1">
        <span className="font-mono text-sm">{controllerStatus.name}</span>
        <Badge variant={controllerStatus.online ? "success" : "danger"}>
          {controllerStatus.online ? "Online" : "Offline"}
        </Badge>
      </div>

      <div className="flex-1" />

      {/* Actions */}
      <Button onClick={onSave} disabled={saveDisabled}>Save</Button>
      <Button onClick={onCheck} disabled={checkDisabled}>Check</Button>
    </div>
  )
}
```

#### Cập nhật ProgrammingLayout.tsx
```tsx
// Thay:
// - Device bar
// - Project status bar
// - Workspace toolbar
// Bằng:
<GlobalContextBar
  projectName={project.name}
  editingRevision={{ id: draftRevisionId, state: "Draft" }}
  runningRevision={{ id: activeRevisionId, state: "Active" }}
  controllerStatus={{ name: runtime.controllerId, online: runtime.online }}
  onSave={actions.onSave}
  onCheck={actions.onCheck}
  saveDisabled={!dirty}
  checkDisabled={dirty}
/>
```

**AC Phase 3**:
- ✓ Chỉ 1 hàng header, không còn 3 tầng
- ✓ Hiện: Project | Editing rXX Draft | Running rYY Active | DDC-24-01 Online | Save Check
- ✓ Không còn tab navigation trùng (Programs/Mapping/Execution di chuyển sang route)

---

### PHASE 4: Polish + Additional Sections (1 ngày) — P1
**Mục tiêu**: Hoàn thiện sections còn lại + UI polish

#### AttributesSection.tsx
```tsx
// Tabs: IEC Attributes | DDC Attributes
// Tất cả hiện "không xác định được" (chờ schema BE)
<TabGroup>
  <Tab label="IEC Attributes">
    <p className="text-[var(--c-text-dim)]">không xác định được</p>
  </Tab>
  <Tab label="DDC Attributes">
    <p className="text-[var(--c-text-dim)]">không xác định được</p>
  </Tab>
</TabGroup>
```

#### DdcMetadataSection.tsx
```tsx
// Fields: Unit, Range, BACnet, Modbus, Historian, Alarm, Writable
<Field label="Unit" field={{ known: false }} />
<Field label="Range" field={{ known: false }} />
<Field label="BACnet object" field={{ known: false }} />
<Field label="Modbus register" field={{ known: false }} />
```

#### ReferencesSection.tsx
```tsx
// Used by: reverse lookup từ dependencies[]
const usedBy = document.programs
  .filter(p => p.dependencies?.includes(currentObjectId))
  .map(p => p.name)

// Uses: từ dependencies[] (có sẵn)
<Field label="Uses"
  field={dependencies?.length > 0
    ? dependencies.join(', ')
    : { known: true, value: 'không có' }} />

<Field label="Used by"
  field={usedBy.length > 0
    ? usedBy.join(', ')
    : { known: true, value: 'không có' }} />

<Field label="Calls" field={{ known: false }} />  // cần parse body
```

#### UI Polish
- **Toolbar grouping** (G-09): `Undo Redo | Insert Library | Search | Format | Save Check`
- **Compact alerts** (G-05): Draft unsaved → toast notification thay vì permanent banner
- **Mode switcher** (G-04): EDIT/LIVE/SIMULATE có visual hierarchy rõ

**AC Phase 4**:
- ✓ Inspector có đủ 6 sections: General/Interface/Execution/Attributes/DDC/References
- ✓ Sections gập được
- ✓ References hiện Used by (reverse lookup)
- ✓ Toolbar nhóm rõ ràng
- ✓ Alert compact không chiếm permanent space

---

## TESTING

### Unit tests (~15 files)
```typescript
// InterfaceSection.test.tsx
test('renders VAR_INPUT table for PROGRAM', () => {
  const interface = { inputs: [{ name: 'temp_sp', type: 'REAL' }], outputs: [] }
  render(<InterfaceSection pouInterface={interface} pouKind="PROGRAM" />)
  expect(screen.getByText('VAR_INPUT')).toBeInTheDocument()
  expect(screen.getByText('temp_sp')).toBeInTheDocument()
  expect(screen.getByText('REAL')).toBeInTheDocument()
})

// ExecutionSection.test.tsx
test('formats periodMs to readable cycle', () => {
  render(<ExecutionSection periodMs={100} hasRuntimeConfig={true} pouKind="PROGRAM" />)
  expect(screen.getByText('100 ms')).toBeInTheDocument()
  expect(screen.getByText('Đã xếp lịch chạy')).toBeInTheDocument()
})

test('shows "run when called" for FUNCTION', () => {
  render(<ExecutionSection periodMs={undefined} hasRuntimeConfig={false} pouKind="FUNCTION" />)
  expect(screen.getByText('Chạy khi được gọi')).toBeInTheDocument()
})

// QuickLibraryPanel.test.tsx
test('collapses on button click', () => {
  const onToggle = vi.fn()
  render(<QuickLibraryPanel collapsed={false} onToggleCollapse={onToggle} />)
  fireEvent.click(screen.getByRole('button', { name: /collapse/i }))
  expect(onToggle).toHaveBeenCalled()
})

// ProgramsWorkspace.test.tsx
test('renders 4 columns', () => {
  render(<ProgramsWorkspace ... />)
  expect(screen.getByTestId('pou-explorer')).toBeInTheDocument()
  expect(screen.getByTestId('editor-pane')).toBeInTheDocument()
  expect(screen.getByTestId('quick-library')).toBeInTheDocument()
  expect(screen.getByTestId('context-inspector')).toBeInTheDocument()
})
```

### E2E tests (~5 specs)
```typescript
// e2e/programming-workspace-layout.spec.ts

test('Inspector shows Interface section when PROGRAM selected', async ({ page }) => {
  await page.goto('/eng/programming/projects/test-01/programs')
  await page.click('[data-testid="pou-Main"]')

  await expect(page.locator('text=Interface')).toBeVisible()
  await expect(page.locator('text=VAR_INPUT')).toBeVisible()
  await expect(page.locator('text=temp_sp')).toBeVisible()
})

test('Inspector shows Execution section with cycle', async ({ page }) => {
  await page.goto('/eng/programming/projects/test-01/programs')
  await page.click('[data-testid="pou-Main"]')

  await expect(page.locator('text=Execution')).toBeVisible()
  await expect(page.locator('text=100 ms')).toBeVisible()
})

test('4-column layout renders and is resizable', async ({ page }) => {
  await page.goto('/eng/programming/projects/test-01/programs')

  // All 4 columns visible
  await expect(page.locator('[data-testid="pou-explorer"]')).toBeVisible()
  await expect(page.locator('[data-testid="editor-pane"]')).toBeVisible()
  await expect(page.locator('[data-testid="quick-library"]')).toBeVisible()
  await expect(page.locator('[data-testid="context-inspector"]')).toBeVisible()

  // Resize handle exists
  const handle = page.locator('[data-panel-resize-handle-id]').first()
  await expect(handle).toBeVisible()

  // Drag resize
  const box = await handle.boundingBox()
  await page.mouse.move(box.x, box.y)
  await page.mouse.down()
  await page.mouse.move(box.x + 100, box.y)
  await page.mouse.up()
})

test('Library panel collapses', async ({ page }) => {
  await page.goto('/eng/programming/projects/test-01/programs')

  const collapseBtn = page.locator('[data-testid="library-collapse-button"]')
  await collapseBtn.click()

  await expect(page.locator('[data-testid="library-catalog"]')).toBeHidden()
  await expect(page.locator('[data-testid="editor-pane"]')).toBeVisible() // editor rộng hơn
})

test('Global Context Bar shows project status', async ({ page }) => {
  await page.goto('/eng/programming/projects/test-01/programs')

  await expect(page.locator('text=Test Project')).toBeVisible()
  await expect(page.locator('text=Editing')).toBeVisible()
  await expect(page.locator('text=r24')).toBeVisible()
  await expect(page.locator('text=Draft')).toBeVisible()
  await expect(page.locator('text=Running')).toBeVisible()
  await expect(page.locator('text=r23')).toBeVisible()
  await expect(page.locator('text=Active')).toBeVisible()
})

test('No regression: ST editor still works', async ({ page }) => {
  await page.goto('/eng/programming/projects/test-01/programs')
  await page.click('[data-testid="pou-Main"]')

  // Monaco editor loads
  await expect(page.locator('.monaco-editor')).toBeVisible()

  // Can type
  await page.click('.monaco-editor')
  await page.keyboard.type('// test comment')
  await expect(page.locator('text=// test comment')).toBeVisible()

  // Save works
  await page.click('button:has-text("Save")')
  await expect(page.locator('text=Saving')).toBeVisible()
})
```

### Visual regression (Playwright screenshots)
```typescript
test('workspace layout 1920x1080', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('/eng/programming/projects/test-01/programs')
  await page.click('[data-testid="pou-Main"]')
  await expect(page).toHaveScreenshot('workspace-1920x1080.png')
})

test('workspace layout 1366x768', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/eng/programming/projects/test-01/programs')
  await page.click('[data-testid="pou-Main"]')
  await expect(page).toHaveScreenshot('workspace-1366x768.png')
})

test('Inspector sections expanded', async ({ page }) => {
  await page.goto('/eng/programming/projects/test-01/programs')
  await page.click('[data-testid="pou-Main"]')

  // Expand all sections
  await page.locator('summary:has-text("Interface")').click()
  await page.locator('summary:has-text("Execution")').click()
  await page.locator('summary:has-text("References")').click()

  await expect(page.locator('[data-testid="context-inspector"]')).toHaveScreenshot('inspector-expanded.png')
})
```

---

## ROLLOUT — 4 PR

### PR #1: Inspector Foundation
**Branch**: `feat/pgm02-inspector-interface-execution`
**Files**:
- `apps/web-ui/src/features/programming/design/inspector/sections/InterfaceSection.tsx` (+200)
- `apps/web-ui/src/features/programming/design/inspector/sections/ExecutionSection.tsx` (+150)
- `apps/web-ui/src/features/programming/design/inspector/sections/AttributesSection.tsx` (+100)
- `apps/web-ui/src/features/programming/design/inspector/sections/DdcMetadataSection.tsx` (+150)
- `apps/web-ui/src/features/programming/design/inspector/sections/ReferencesSection.tsx` (+150)
- `apps/web-ui/src/features/programming/design/inspector/ContextInspector.tsx` (sửa ~50 dòng)
- `apps/web-ui/src/features/programming/design/inspector/inspectorContext.ts` (sửa ~50 dòng)
- Tests: `*.test.tsx` (+300)

**LOC**: ~1150 dòng
**Risk**: Low — chỉ thêm sections, không đụng layout
**Verify**:
- Unit test pass
- Chọn PROGRAM → thấy Interface/Execution
- Field "không xác định được" đúng chỗ

---

### PR #2: 4-Column Layout
**Branch**: `feat/pgm02-workspace-4col-layout`
**Files**:
- `apps/web-ui/src/features/programming/design/editor/ProgramsWorkspace.tsx` (+400)
- `apps/web-ui/src/features/programming/design/editor/EditorPane.tsx` (+500)
- `apps/web-ui/src/features/programming/design/editor/QuickLibraryPanel.tsx` (+300)
- `apps/web-ui/src/features/programming/design/editor/EditorToolbar.tsx` (+200)
- `apps/web-ui/src/features/programming/design/editor/ProgramsTab.tsx` (xoá hoặc deprecate ~1000 dòng)
- `apps/web-ui/src/features/programming/design/DesignWorkspacePage.tsx` (sửa mount ProgramsWorkspace)
- `package.json` (thêm `react-resizable-panels` dependency)
- Tests: `*.test.tsx` (+400)

**LOC**: +1800 thêm, -1000 xoá = +800 net
**Risk**: Medium — breaking layout change
**Verify**:
- e2e: select POU, edit ST, insert library, watch Inspector — NO REGRESSION
- Resize handles work
- Library collapse → editor expands
- 1920×1080 + 1366×768 không vỡ

---

### PR #3: Global Context Bar
**Branch**: `feat/pgm02-global-context-bar`
**Files**:
- `apps/web-ui/src/features/programming/layout/GlobalContextBar.tsx` (+150)
- `apps/web-ui/src/features/programming/layout/ProgrammingLayout.tsx` (sửa header ~100 dòng)
- Tests: `GlobalContextBar.test.tsx` (+100)

**LOC**: ~350 dòng
**Risk**: Low-Medium — đụng header toàn PGM-02
**Verify**:
- Header chỉ 1 hàng
- Navigation không hỏng
- Save/Check actions vẫn hoạt động

---

### PR #4: Polish + Additional Sections
**Branch**: `feat/pgm02-polish-ui`
**Files**:
- Inspector sections (đã có ở PR #1, nay điền data thật nếu schema BE sẵn sàng)
- Toolbar grouping (EditorToolbar.tsx sửa)
- Compact alerts (DesignWorkspacePage.tsx sửa)
- Mode switcher polish (ProgramsModeSwitcher.tsx sửa)

**LOC**: ~400 dòng sửa
**Risk**: Low — chỉ UI polish
**Verify**:
- Toolbar nhóm rõ: Undo/Redo | Insert/Library | Search | Format | Save/Check
- Alert không chiếm permanent space
- References section hiện Used by

---

## CHANGELOG

```markdown
## [Unreleased]

### Added — 2026-09-08 (PR #1)
- **[PGM-02] Inspector Interface section**: hiển thị VAR_INPUT/VAR_OUTPUT/VAR_IN_OUT table cho PROGRAM/FUNCTION/FUNCTION_BLOCK theo IEC 61131-3 (G-14)
- **[PGM-02] Inspector Execution section**: hiển thị chu kỳ (periodMs), task binding, scheduled state, resource (G-16, G-17)
- **[PGM-02] Inspector Attributes section**: placeholder IEC Attributes / DDC Attributes tabs (G-18)
- **[PGM-02] Inspector DDC Metadata section**: placeholder Unit/Range/BACnet/Modbus/Historian/Alarm fields (G-19)
- **[PGM-02] Inspector References section**: hiển thị Used by (reverse lookup), Uses (dependencies), Calls placeholder (G-20)

### Added — 2026-09-08 (PR #2)
- **[PGM-02] 4-column workspace layout**: POU Explorer | Editor | Quick Library | Inspector, resizable với `react-resizable-panels` (G-11, G-26)
- **[PGM-02] QuickLibraryPanel component**: tách từ ProgramsTab, collapsible panel bên cạnh editor

### Added — 2026-09-08 (PR #3)
- **[PGM-02] Global Context Bar**: gộp 3 tầng header (device bar + project status + toolbar) thành 1 hàng hiển thị Project | Editing revision | Running revision | Controller | Save/Check (G-01, G-03)

### Changed — 2026-09-08 (PR #2)
- **[PGM-02] ProgramsTab refactor**: tách 3301 dòng thành ProgramsWorkspace (layout) + EditorPane (ST/FBD) + QuickLibraryPanel + EditorToolbar, giảm complexity
- **[PGM-02] Tab navigation**: bỏ navigation trùng Programs/Mapping/Execution ở workspace (G-02) — route canonical là nguồn sự thật

### Changed — 2026-09-08 (PR #4)
- **[PGM-02] Editor toolbar grouping**: sắp xếp lại theo nhóm logic Undo/Redo → Insert/Library → Search → Format → Save/Check (G-09, G-10)
- **[PGM-02] Compact alerts**: Draft unsaved changes chuyển từ permanent banner sang toast notification (G-05)

### Fixed — 2026-09-08 (PR #1)
- **[PGM-02] Inspector collapse**: Inspector thu gọn khi không có context hữu ích, không chiếm 300px vô ích cho 2 field (G-12)
```

---

## ESTIMATE

| Phase | Component | LOC | Test | Effort |
|-------|-----------|-----|------|--------|
| Phase 1 | Inspector 5 sections | +800 | +300 | 2 ngày |
| Phase 2 | 4-col layout + extract | +800 -1000 | +400 | 1.5 ngày |
| Phase 3 | Global Context Bar | +350 | +100 | 1 ngày |
| Phase 4 | Polish UI | +400 sửa | — | 1 ngày |
| **Testing/QA** | e2e regression, visual | — | — | 1 ngày |
| **TOTAL** | | ~1950 net | ~800 test | **6.5 ngày** |

---

## DEFINITION OF DONE — 13 AC

1. ✓ Workspace đúng cấu trúc `Explorer + Editor + Library + Inspector + Bottom`
2. ✓ Inspector context-sensitive: PROGRAM/FUNCTION/FB/VARIABLE/ST_SYMBOL/FBD_BLOCK
3. ✓ Interface VAR_INPUT/VAR_OUTPUT/VAR_IN_OUT table hiển thị đúng
4. ✓ POU → Task binding trong Inspector Execution section
5. ✓ Task config: Cyclic/Interval/Priority/Watchdog (field có thì hiện, không có thì "không xác định được")
6. ✓ DDC metadata tách IEC attributes (tabs riêng)
7. ✓ Click Problem → navigate đúng dòng/cột code (đã có, giữ nguyên)
8. ✓ Runtime Watch: Value/Type/Quality/Timestamp (đã có, giữ nguyên)
9. ✓ Panels resize/collapse: kéo handle resize, bấm collapse Library
10. ✓ Save/Check/Dirty/Running state nhất quán toàn workspace
11. ✓ Không thay đổi API/runtime behavior nếu không cần thiết
12. ✓ Không regression ST/FBD: e2e coverage 100% pass
13. ✓ Desktop 1920×1080 layout không vỡ, 1366×768 usable

---

## NEXT IMMEDIATE ACTIONS

1. ✅ Kiểm `document.task` schema — Task có field name/priority/watchdog không?
2. **Viết InterfaceSection.tsx** — VAR table từ `userPouInterfaces`
3. **Viết ExecutionSection.tsx** — periodMs/hasRuntimeConfig
4. **Cập nhật ContextInspector.tsx** — mount 2 sections mới
5. **Test Draft thật** — chọn POU Main, thấy Interface section
6. Install `react-resizable-panels` dependency
7. **Tách QuickLibraryPanel.tsx** từ ProgramsTab
8. **Viết ProgramsWorkspace.tsx** — 4-col resizable grid
9. E2E test: layout, resize, no regression
10. Merge PR #1 → #2 → #3 → #4

**BẮT ĐẦU PHASE 1 NGAY — InterfaceSection.tsx là P0 nhất.**
