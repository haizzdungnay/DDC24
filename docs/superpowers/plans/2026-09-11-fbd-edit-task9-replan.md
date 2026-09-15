# PLAN — Task 9: Panel Dưới 3 Cột cho FBD Editor

## Metadata
- **Plan ID**: PLAN-FBD-T9-3COL
- **Created**: 2026-09-11
- **Issue**: [2026-09-11-fbd-task9-issue.md](./2026-09-11-fbd-task9-issue.md)
- **Parent**: [2026-08-31-fbd-edit.md](./2026-08-31-fbd-edit.md) Step 9
- **Supersedes**: Phần Task 9 trong [2026-09-09-fbd-edit-task8-9-implementation-plan.md](./2026-09-09-fbd-edit-task8-9-implementation-plan.md)

## Executive Summary
Bổ sung panel dưới 3 cột (Problems | Runtime Watch | Mini Map) cho FBD Editor theo ảnh tham chiếu PGM-02B, với 3 bước triển khai:
1. **T9-01**: Grid 3 cột + localStorage (VUA — 2-3h)
2. **T9-02**: Chuyển minimap từ canvas vào cột 3 (LON — 3-4h, blocked by T9-01)
3. **T9-03**: Giảm danh sách tab từ 5 xuống 4 (NHO — 0.5-1h)

Tổng ước lượng: **6-8 giờ** (chưa tính thời gian chờ review).

## Context

### Quyết định user (2026-09-11)
Qua AskUserQuestion so sánh ảnh tham chiếu PGM-02B vs plan cũ, user đã chọn:
- Panel mở sẵn 3 cột ở desktop ≥1440px (theo ảnh)
- Bỏ dải status đáy (không làm)
- Bỏ 3 hạng mục: mã màu khối theo nhóm, mã màu dây theo kiểu, chế độ xem trước tự sắp xếp (đã xong rồi)

### Kết quả workflow 2026-09-11
Workflow đa tác tử (5 pha: Khảo sát → Kiểm chứng → Tổng hợp → Rà soát → Soạn tài liệu) gặp rate limit 429 sau 6/16 agents. Ba agents thành công:

**Agent autolayout** (area=autolayout):
- Bước 3.6 (Auto Layout Preview & Apply/Cancel) ĐÃ XONG TỪ TRƯỚC
- Test xanh: `npx vitest --run src/features/programming/design/workbench/FbdWorkbench.test.tsx src/features/programming/fbd/layout.test.ts` → 26 pass
- Conflict plan vs code: plan mô tả Sugiyama nhưng thật là 3 cột cố định; plan đòi spinner nhưng thuật toán đồng bộ < 1ms
- Gap: `distributeNodes` là code chết (chỉ test gọi), 2 nút Căn phải/Căn dưới chưa gắn UI

**Agent workbench** (area=workbench):
- Panel dưới đã có 5 tab, mở sẵn 173px, grid 2 cột
- Mini Map "cố ý hoãn" (chú thích `:333-343`) chờ `FbdCanvas` công bố viewport
- Conflict CAO: E2E `programming-workspace-height.spec.ts:100` bắt đóng sẵn (`workbenchOpen: false`) vs unit test `ProgrammingWorkbench.test.tsx:182` bắt mở sẵn 173px
- Conflict CAO: Plan đòi tab `minimap` thứ 6 nhưng ảnh PGM-02B chỉ có 4 tab, Mini Map là PANEL riêng cột 3
- Gap: hòa giải mặc định mở/đóng theo viewport, cột 3 minimap, test cho variant embedded `ProblemsDrawer`, nối `openBuffer`/`onRecheck`

**Agent status-strip** (area=status-strip):
- Grep `StatusStrip|status-strip|statusStrip` = 0 kết quả → bước 3.2 chưa tồn tại
- Có `EditorStatusBar` component dùng chung, `FbdEditorPane` đã mount nhưng không truyền zoom/connection
- `fbdStatusFields` trả 4 ô: zoom, language, connection, dirty

### Ảnh tham chiếu đo đạc
`PGM-02B_FBD_editor_reference.png` panel dưới:
- Problems: x=196..839 → 643px (~60%)
- Runtime Watch: x=839..1214 → 375px (~35%)
- Mini Map: x=1214..1672 → 458px (~43%)
Tổng: ~1476px (643+375+458)

Tỉ lệ chuẩn hóa: `minmax(0,1fr)` cho Problems, `375px` cho Watch, `458px` cho Mini Map.

## Approach

### Phân công subagent
Opus chỉ điều phối. Mỗi bước giao cho subagent Sonnet/Haiku với prompt chi tiết gồm:
1. Scope chính xác (files, dòng cụ thể)
2. Expected output (tests pass, behavior đo được)
3. Stop condition (khi nào dừng)
4. Edit permission (files được phép sửa)
5. Constraints (cấm sửa, cấm làm yếu test)

### Quy trình TDD từng bước
Mỗi T9-0X:
1. Subagent viết test failing trước (TDD)
2. Implement minimum code
3. Chạy test verify pass
4. Opus review kết quả
5. Chuyển bước tiếp theo hoặc iterate

### Cổng kiểm chứng cuối
Trước khi báo hoàn thành:
- [ ] `npx vitest --run src/features/programming/design/workbench/` → 100% pass
- [ ] `npx vitest --run src/features/programming/fbd/` → 100% pass
- [ ] `npx playwright test e2e/programming.spec.ts` → pass (sau khi sửa `.toBe(4)`)
- [ ] Reload localhost:5173 → panel 3 cột hiển thị, trạng thái nhớ qua localStorage
- [ ] Không có regression: ST editor, POU Explorer, Inspector, Quick Library hoạt động bình thường
- [ ] CHANGELOG.md cập nhật
- [ ] **Hỏi user trước khi đóng issue**

## Task Breakdown

### T9-01: Grid 3 Cột + localStorage (VUA, 2-3h)

#### Mục tiêu
Đổi grid `ProgrammingWorkbench` từ 2 cột sang 3 cột, lưu trạng thái mở/đóng và chiều cao vào localStorage, mặc định mở sẵn ~162-173px khi ≥1440px.

#### Hiện trạng
- File: `apps/web-ui/src/features/programming/design/workbench/ProgrammingWorkbench.tsx` (629 dòng)
- Grid hiện tại: `grid-cols-[minmax(0,1fr)_375px]` (`:344`)
- Mặc định: `open: true`, `height: 173` (`:161`, `:99`)
- Chú thích `:333-343` nói rõ cột 3 Mini Map "CHƯA DỰNG", chờ `FbdCanvas` công bố viewport

#### Conflict cần giải quyết
**Conflict mặc định mở/đóng** (phát hiện bởi agent workbench):
- Unit test `ProgrammingWorkbench.test.tsx:182`: `expect(panel.style.height).toBe('173px')` — bắt mở sẵn
- E2E `programming-workspace-height.spec.ts:100`: `expect(m.workbenchOpen, 'khay bàn làm việc phải thu gọn sẵn').toBe(false)` — bắt đóng sẵn
- E2E chạy ở CẢ 1280x800 lẫn 1920x1080

**Giải pháp**: Mở sẵn có điều kiện theo viewport
- `useState(() => window.innerWidth >= 1440)` cho `open`
- `useState(() => window.innerWidth >= 1440 ? 173 : 120)` cho `height` (hoặc đọc localStorage trước)
- Cập nhật cả hai bộ test để khẳng định đúng hành vi theo viewport
- E2E `:100` sửa thành logic kiểm tra theo viewport: 1280x800 → `false`, 1920x1080 → `true`

#### Thay đổi code

**File: `ProgrammingWorkbench.tsx`**
1. Đổi grid `:344`: `grid-cols-[minmax(0,1fr)_375px_458px]`
2. Thêm localStorage hook:
   ```tsx
   const STORAGE_KEY = 'mkddc:programming-workbench:v1'
   const [open, setOpen] = useState(() => {
     const saved = localStorage.getItem(STORAGE_KEY)
     if (saved) return JSON.parse(saved).open
     return window.innerWidth >= 1440
   })
   const [height, setHeight] = useState(() => {
     const saved = localStorage.getItem(STORAGE_KEY)
     if (saved) return JSON.parse(saved).height
     return window.innerWidth >= 1440 ? DEFAULT_HEIGHT : MIN_HEIGHT
   })
   useEffect(() => {
     localStorage.setItem(STORAGE_KEY, JSON.stringify({open, height}))
   }, [open, height])
   ```
3. Thêm cột 3 (sau `:421`, trước dòng đóng `</div>`):
   ```tsx
   {/* Cột 3: Mini Map — hiện THƯỜNG TRỰC */}
   <div data-testid="workbench-minimap-column" className="...">
     {/* Placeholder cho T9-02 */}
     <div role="region" aria-label="Mini Map" className="h-full flex items-center justify-center text-sm opacity-40">
       Mini Map (chờ T9-02)
     </div>
   </div>
   ```

**File: `ProgrammingWorkbench.test.tsx`**
1. Mock `window.innerWidth` cho từng case:
   ```tsx
   beforeEach(() => {
     Object.defineProperty(window, 'innerWidth', {value: 1920, writable: true})
   })
   ```
2. Sửa test `:173-185` → kiểm tra 3 cột:
   ```tsx
   it('TC-WBENCH-3COL: desktop ≥1440px mở sẵn 3 cột', () => {
     window.innerWidth = 1920
     const {getByTestId} = render(<ProgrammingWorkbench ... />)
     expect(getByTestId('workbench-problems-column')).toBeInTheDocument()
     expect(getByTestId('workbench-watch-column')).toBeInTheDocument()
     expect(getbench-minimap-column')).toBeInTheDocument()
     const panel = getByRole('tabpanel')
     expect(panel.style.height).toBe('173px')
   })
   ```
3. Thêm test viewport nhỏ:
   ```tsx
   it('TC-WBENCH-NARROW: viewport <1440px đóng sẵn', () => {
     window.innerWidth = 1280
     const {queryByRole} = render(<ProgrammingWorkbench ... />)
     expect(queryByRole('tabpanel')).toBeNull()
   })
   ```
4. Thêm test localStorage:
   ```tsx
   it('TC-WBENCH-PERSIST: nhớ trạng thái qua localStorage', () => {
     const {rerender, getByRole} = render(<ProgrammingWorkbench ... />)
     // Đóng panel
     userEvent.click(getByRole('tab', {name: /Vấn đề/}))
     expect(queryByRole('tabpanel')).toBeNull()
     // Reload
     rerender(<ProgrammingWorkbench ... />)
     expect(queryByRole('tabpanel')).toBeNull()  // vẫn đóng
     const saved = JSON.parse(localStorage.getItem('mkddc:programming-workbench:v1'))
     expect(saved.open).toBe(false)
   })
   ```

**File: `e2e/programming-workspace-height.spec.ts`**
Sửa `:100`:
```ts
const expectedOpen = page.viewportSize().width >= 1440
expect(m.workbenchOpen, 'khay bàn làm việc mặc định theo viewport').toBe(expectedOpen)
```

#### Verification
- [ ] `npx vitest --run src/features/programming/design/workbench/ProgrammingWorkbench.test.tsx` → TC-WBENCH-3COL, TC-WBENCH-NARROW, TC-WBENCH-PERSIST pass
- [ ] `npx playwright test e2e/programming-workspace-height.spec.ts` → pass ở cả 1280x800 và 1920x1080
- [ ] Mở DevTools → `localStorage.getItem('mkddc:programming-workbench:v1')` trả JSON có `{open, height}`
- [ ] Đóng panel → reload → vẫn đóng
- [ ] `document.querySelectorAll('[data-testid$="-column"]').length === 3` ở localhost:5173

#### Effort: VUA (2-3h)
- Sửa logic init state với localStorage + viewport: 0.5h
- Đổi grid 2→3 cột, thêm placeholder cột 3: 0.5h
- Viết 3 test mới + sửa test cũ: 1h
- Sửa E2E assert theo viewport: 0.5h
- Debug localStorage/viewport edge case: 0.5-1h

---

### T9-02: Chuyển Mini Map Từ Canvas Vào Cột 3 (LON, 3-4h)

#### Mục tiêu
Di chuyển minimap từ góc dưới phải canvas vào cột 3 của panel dưới, giải phóng góc canvas cho vùng vẽ.

#### Blocked by
T9-01 (cần cột 3 đã dựng)

#### Hiện trạng
- Minimap hiện ở: `FbdCanvas.tsx:788-818` (component `<g data-fbd-minimap>`)
- Logic viewport: `FbdCanvas.tsx:122-153` (state `viewport`, `containerSize`)
- Click minimap → pan canvas: có event handler tại `:795-805`

#### Thay đổi code

**Bước 1: Tách logic minimap thành hook**
Tạo file mới: `apps/web-ui/src/features/programming/fbd/useFbdMinimap.ts`
```tsx
export function useFbdMinimap(opts: {
  viewport: {x: number, y: number, zoom: number},
  geometry: {width: number, height: number},
  containerSize: {width: number, height: number},
  onNavigate: (x: number, y: number) => void
}) {
  // Logic tính tỉ lệ thumbnail, khung viewport, click → pan
  // Return: {thumbnailScale, viewportRect, handleClick}
}
```

**Bước 2: Component minimap panel**
Tạo file mới: `apps/web-ui/src/features/programming/design/workbench/WorkbenchMinimapPanel.tsx`
```tsx
interface Props {
  viewport: {x: number, y: number, zoom: number}
  geometry: {width: number, height: number}
  containerSize: {width: number, height: number}
  nodes: FbdNode[]
  wires: FbdWire[]
  onNavigate: (x: number, y: number) => void
}

export function WorkbenchMinimapPanel(props: Props) {
  const {thumbnailScale, viewportRect, handleClick} = useFbdMinimap(props)
  return (
    <div role="region" aria-label="Mini Map" className="flex flex-col h-full">
      <h3 className="text-xs font-medium px-2 py-1 border-b">Mini Map</h3>
      <div className="flex-1 p-2 overflow-hidden">
        <svg viewBox={...} onClick={handleClick} className="w-full h-full cursor-pointer">
          {/* Render nodes, wires tỉ lệ nhỏ */}
          {props.nodes.map(n => <rect key={n.id} ... />)}
          {props.wires.map(w => <path key={w.id} ... />)}
          {/* Khung viewport */}
          <rect {...viewportRect} stroke="var(--c-accent)" fill="none" strokeWidth={2} />
        </svg>
      </div>
      <div className="px-2 py-1 border-t text-xs opacity-60">
        Zoom: {Math.round(props.viewport.zoom * 100)}%
      </div>
    </div>
  )
}
```

**Bước 3: Xóa minimap khỏi `FbdCanvas.tsx`**
- Xóa dòng `:788-818` (cả group `<g data-fbd-minimap>`)
- Giữ nguyên state `viewport`, `containerSize` — cần export lên component cha

**Bước 4: Nối dây trong `ProgrammingWorkbench.tsx`**
```tsx
// Nhận viewport từ editor (cần prop drilling hoặc context)
const [fbdViewport, setFbdViewport] = useState({x: 0, y: 0, zoom: 1})
const [fbdGeometry, setFbdGeometry] = useState({width: 0, height: 0})
const [fbdContainerSize, setFbdContainerSize] = useState({width: 0, height: 0})

// Cột 3: thay placeholder bằng WorkbenchMinimapPanel
{activeTab === 'problems' && (  // hoặc luôn hiển thị
  <WorkbenchMinimapPanel
    viewport={fbdViewport}
    geometry={fbdGeometry}
    containerSize={fbdContainerSize}
    nodes={document.networks[0]?.nodes || []}
    wires={document.networks[0]?.wires || []}
    onNavigate={(x, y) => {
      // Callback → gọi xuống FbdCanvas qua ref hoặc context
    }}
  />
)}
```

**Bước 5: Cập nhật `FbdEditorPane` hoặc `StructuredFbdEditor` để công bố viewport**
Thêm callback `onViewportChange` để thông báo lên `ProgrammingWorkbench`.

#### Tests

**Unit test: `WorkbenchMinimapPanel.test.tsx`**
```tsx
it('TC-MINIMAP-RENDER: render thumbnail + viewport rect', () => {
  const {container} = render(<WorkbenchMinimapPanel viewport={{x: 0, y: 0, zoom: 1}} ... />)
  expect(container.querySelector('svg')).toBeInTheDocument()
  expect(container.querySelector('rect[stroke]')).toBeInTheDocument()  // viewport rect
})

it('TC-MINIMAP-CLICK: click → onNavigate', () => {
  const onNavigate = vi.fn()
  const {container} = render(<WorkbenchMinimapPanel onNavigate={onNavigate} ... />)
  const svg = container.querySelector('svg')
  fireEvent.click(svg, {clientX: 50, clientY: 50})
  expect(onNavigate).toHaveBeenCalled()
})
```

**Update test: `ProgrammingWorkbench.test.tsx`**
```tsx
it('TC-MINIMAP-COLUMN: cột minimap hiển thị thường trực', () => {
  const {getByTestId, queryByRole} = render(<ProgrammingWorkbench ... />)
  const col = getByTestId('workbench-minimap-column')
  expect(col).toBeInTheDocument()
  expect(queryByRole('region', {name: /Mini Map/})).toBeInTheDocument()
  // Không cần bấm tab
})
```

**E2E (tuỳ chọn): TC-FBD-NAV-001**
```ts
test('click minimap → canvas viewport di chuyển', async ({page}) => {
  await page.goto('/programs?projectId=...')
  // Chờ đồ thị > 24 node load
  const minimap = page.locator('[aria-label="Mini Map"] svg')
  const box = await minimap.boundingBox()
  await minimap.click({position: {x: box.width / 2, y: box.height / 2}})
  // Kiểm tra canvas viewport đã di chuyển (đọc transform attr)
  const canvas = page.locator('[data-fbd-canvas]')
  const transform = await canvas.getAttribute('transform')
  expect(transform).not.toBe('translate(0, 0)')
})
```

#### Verification
- [ ] `git grep "data-fbd-minimap" apps/web-ui/src/features/programming/fbd/FbdCanvas.tsx` → 0 kết quả
- [ ] `npx vitest --run src/features/programming/design/workbench/WorkbenchMinimapPanel.test.tsx` → TC-MINIMAP-RENDER, TC-MINIMAP-CLICK pass
- [ ] `npx vitest --run src/features/programming/design/workbench/ProgrammingWorkbench.test.tsx` → TC-MINIMAP-COLUMN pass
- [ ] Mở localhost:5173 → panel dưới cột 3 hiển thị thumbnail đồ thị + khung viewport
- [ ] Click minimap → canvas di chuyển (manual test hoặc E2E TC-FBD-NAV-001)
- [ ] Góc dưới phải canvas trống, không còn minimap

#### Effort: LON (3-4h)
- Tách logic minimap thành hook: 0.5h
- Viết component `WorkbenchMinimapPanel`: 1h
- Xóa minimap khỏi `FbdCanvas`, prop drilling viewport: 0.5h
- Nối dây `onNavigate` callback: 0.5h
- Viết test mới (unit + E2E tuỳ chọn): 1h
- Debug viewport sync, click → pan: 0.5-1h

---

### T9-03: Giảm Danh Sách Tab Từ 5 Xuống 4 (NHO, 0.5-1h)

#### Mục tiêu
Loại bỏ tab `Trace` (không khả dụng), giữ lại 4 tab khớp ảnh PGM-02B: Problems | Runtime Watch | Search | Cross Reference.

#### Hiện trạng
- Type TabId: `ProgrammingWorkbench.tsx:101` có 5 giá trị gồm `'trace'`
- Mảng tabs: `:241-255` có 5 phần tử, tab `Trace` ở `:254` có `available: false`
- E2E `programming.spec.ts:1712`: `expect(count, 'workbench phải có đủ năm khay').toBe(5)`

#### Thay đổi code

**File: `ProgrammingWorkbench.tsx`**
1. Sửa type `:101`:
   ```tsx
   type TabId = 'problems' | 'search' | 'references' | 'watch'
   ```
2. Xóa phần tử `Trace` khỏi mảng tabs `:254` (hoặc dòng tương ứng)

**File: `e2e/programming.spec.ts`**
Sửa `:1712`:
```ts
expect(count, 'workbench phải có đủ bốn khay').toBe(4)
```

#### Tests

**Update test: `ProgrammingWorkbench.test.tsx`**
```tsx
it('TC-WBENCH-4TABS: chỉ có 4 tab', () => {
  const {getAllByRole, queryByRole} = render(<ProgrammingWorkbench ... />)
  const tabs = getAllByRole('tab')
  expect(tabs).toHaveLength(4)
  expect(queryByRole('tab', {name: /Trace/})).toBeNull()
})

it('TC-WBENCH-TAB-LABELS: nhãn tiếng Việt chính xác', () => {
  const {getByRole} = render(<ProgrammingWorkbench ... />)
  expect(getByRole('tab', {name: /Vấn đề/})).toBeInTheDocument()
  expect(getByRole('tab', {name: /Tìm kiếm/})).toBeInTheDocument()
  expect(getByRole('tab', {name: /Tham chiếu/})).toBeInTheDocument()
  expect(getByRole('tab', {name: /Watch \(Trực tiếp\)/})).toBeInTheDocument()
})
```

#### Verification
- [ ] `npx vitest --run src/features/programming/design/workbench/ProgrammingWorkbench.test.tsx` → TC-WBENCH-4TABS, TC-WBENCH-TAB-LABELS pass
- [ ] `npx playwright test e2e/programming.spec.ts` → pass với assert `.toBe(4)`
- [ ] `document.querySelectorAll('[role="tab"]').length === 4` tại localhost:5173
- [ ] `grep -n "'trace'" apps/web-ui/src/features/programming/design/workbench/ProgrammingWorkbench.tsx` → 0 kết quả

#### Effort: NHO (0.5-1h)
- Xóa `'trace'` khỏi type + mảng: 0.1h
- Sửa assert E2E `.toBe(4)`: 0.1h
- Viết/cập nhật 2 test: 0.3h
- Chạy full test suite kiểm tra không regression: 0.5h

---

## Risk & Mitigation

### Risk 1: Prop drilling viewport từ FbdCanvas → ProgrammingWorkbench
**Tác động**: HIGH — T9-02 phụ thuộc vào việc công bố viewport ra ngoài  
**Mitigation**:
- Dùng React Context `FbdViewportContext` thay vì prop drilling
- Hoặc callback `onViewportChange` truyền qua `FbdEditorPane` → `DesignWorkbench` → `ProgrammingWorkbench`
- Worst case: minimap trong panel chỉ hiển thị static thumbnail, chờ viewport API hoàn chỉnh

### Risk 2: Conflict E2E viewport mock
**Tác động**: MEDIUM — Test có thể flaky nếu mock `window.innerWidth` không reset đúng  
**Mitigation**:
- Dùng `beforeEach` restore `window.innerWidth` về giá trị mặc định
- E2E dùng `page.setViewportSize()` thay vì mock — đáng tin hơn

### Risk 3: localStorage schema change → data cũ vỡ
**Tác động**: LOW — Người dùng dev đã có localStorage cũ  
**Mitigation**:
- Versioned key: `mkddc:programming-workbench:v1`
- Nếu parse JSON fail, fallback về mặc định viewport-based
- Worst case: user xóa localStorage thủ công

### Risk 4: Bundle size tăng do duplicate minimap logic
**Tác động**: LOW — Minimap component ~5-10KB  
**Mitigation**:
- Reuse `useFbdMinimap` hook cho cả canvas (nếu cần) và panel
- Minimap trong canvas đã xóa nên không có duplicate code

---

## Timeline & Dependencies

```
Day 1 (2-3h):   T9-01 Grid 3 cột + localStorage
                ├─ Subagent A: sửa ProgrammingWorkbench + test
                ├─ Subagent B: sửa E2E programming-workspace-height.spec.ts
                └─ Opus review → verify localhost

Day 2 (3-4h):   T9-02 Chuyển minimap (blocked by T9-01)
                ├─ Subagent C: tách useFbdMinimap hook
                ├─ Subagent D: viết WorkbenchMinimapPanel component
                ├─ Subagent E: xóa minimap khỏi FbdCanvas + prop drilling
                └─ Opus review → verify localhost + E2E tuỳ chọn

Day 3 (0.5-1h): T9-03 Giảm tab xuống 4
                ├─ Subagent F: xóa 'trace', sửa E2E assert
                └─ Opus review → chạy full test suite

Day 3 (1h):     Final verification + CHANGELOG
                └─ Opus: chạy cổng kiểm chứng cuối, cập nhật docs
```

**Critical path**: T9-01 → T9-02 → T9-03 → Verify  
**Total estimate**: 6-8 giờ (chưa tính review user)

---

## Verification Checklist (Cuối cùng)

### Unit Tests
- [ ] `npx vitest --run src/features/programming/design/workbench/` → 100% pass
  - TC-WBENCH-3COL: desktop ≥1440px mở sẵn 3 cột
  - TC-WBENCH-NARROW: viewport <1440px đóng sẵn
  - TC-WBENCH-PERSIST: nhớ trạng thái qua localStorage
  - TC-MINIMAP-COLUMN: cột minimap hiển thị thường trực
  - TC-WBENCH-4TABS: chỉ có 4 tab
  - TC-WBENCH-TAB-LABELS: nhãn tiếng Việt chính xác
- [ ] `npx vitest --run src/features/programming/fbd/` → 100% pass (không regression)
- [ ] `npx vitest --run src/features/programming/design/workbench/WorkbenchMinimapPanel.test.tsx` → TC-MINIMAP-RENDER, TC-MINIMAP-CLICK pass

### E2E Tests
- [ ] `npx playwright test e2e/programming-workspace-height.spec.ts` → pass ở 1280x800 và 1920x1080
- [ ] `npx playwright test e2e/programming.spec.ts` → pass với assert `.toBe(4)`
- [ ] (Tuỳ chọn) TC-FBD-NAV-001: click minimap → canvas viewport di chuyển

### Manual Verification
- [ ] Mở `http://localhost:5173` desktop ≥1440px → panel 3 cột hiển thị
- [ ] Resize viewport <1440px → panel thu gọn hoặc đóng
- [ ] Đóng panel → reload → vẫn đóng (localStorage persist)
- [ ] Mở panel → kéo resize → reload → chiều cao giữ nguyên
- [ ] Cột Mini Map hiển thị thumbnail + khung viewport
- [ ] Click minimap → canvas di chuyển (nếu T9-02 hoàn chỉnh)
- [ ] Tab list có đúng 4: Vấn đề | Tìm kiếm | Tham chiếu | Watch
- [ ] DevTools → `localStorage.getItem('mkddc:programming-workbench:v1')` → `{open, height}`
- [ ] `git grep "data-fbd-minimap" apps/web-ui/src/features/programming/fbd/FbdCanvas.tsx` → 0 kết quả

### Code Quality
- [ ] Không có file cấm sửa bị đụng (`ProgrammingHeader.tsx`, `ProgrammingLayout.tsx`, `contracts/**`, ...)
- [ ] Không có test bị `.skip`/`.only`/`.todo` hoặc assertion bị nới lỏng
- [ ] Mọi interactive element có label ARIA
- [ ] Mọi tab có `role="tab"` + `aria-selected`
- [ ] Grid class là literal string (không phá Tailwind scanning)
- [ ] Design tokens dùng `var(--c-*)`, không hardcode hex

### Documentation
- [ ] `CHANGELOG.md` cập nhật dưới `[Unreleased]`:
  ```md
  ### Added
  - Panel dưới FBD Editor mở rộng thành 3 cột (Problems | Runtime Watch | Mini Map) theo ảnh tham chiếu PGM-02B (#T9-01)
  - Mini Map di chuyển từ góc canvas vào cột 3 của panel dưới, giải phóng vùng vẽ (#T9-02)
  - Trạng thái panel (mở/đóng, chiều cao) nhớ qua localStorage `mkddc:programming-workbench:v1` (#T9-01)
  - Danh sách tab workbench giảm từ 5 xuống 4 khớp ảnh tham chiếu (#T9-03)
  
  ### Changed
  - Panel workbench mặc định mở sẵn ở desktop ≥1440px, thu gọn ở viewport nhỏ hơn (#T9-01)
  - Loại bỏ tab `Trace` không khả dụng khỏi danh sách (#T9-03)
  
  ### Removed
  - Mini map góc dưới phải của canvas FBD (#T9-02)
  ```

### Pre-Close
- [ ] **Hỏi user xác nhận trước khi đóng issue** — KHÔNG tự đóng
- [ ] Nếu user approve: đóng issue, commit message reference issue ID
- [ ] Nếu user yêu cầu thay đổi: quay lại bước bị block, không đóng issue

---

## References

### Ảnh tham chiếu
- `docs/04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/assets/PGM-02B_FBD_editor_reference.png`

### Plans liên quan
- [2026-08-31-fbd-edit.md](./2026-08-31-fbd-edit.md) — Master plan Step 9
- [2026-09-09-fbd-edit-task8-9-implementation-plan.md](./2026-09-09-fbd-edit-task8-9-implementation-plan.md) — Plan cũ (1673 dòng, một phần lỗi thời)
- [2026-09-10-fbd-edit-task8-handoff.md](./2026-09-10-fbd-edit-task8-handoff.md) — Task 8 layout & controls
- [2026-09-10-fbd-edit-task8-handoff-2.md](./2026-09-10-fbd-edit-task8-handoff-2.md) — Chrome consolidation & OY scrollbar

### Workflow journal
- `C:\Users\PC\.claude\projects\e--TuanDuong-INTERN-DDC24-project\b1327d5c-6385-4419-9c61-7903cd373c44\subagents\workflows\wf_5128bd22-cbc\journal.jsonl`
- 6 agents dispatched, 3 thành công (autolayout, workbench, status-strip), 10 bị rate limit 429

### Files chính
- `apps/web-ui/src/features/programming/design/workbench/ProgrammingWorkbench.tsx` (629 dòng)
- `apps/web-ui/src/features/programming/design/workbench/ProgrammingWorkbench.test.tsx` (386 dòng)
- `apps/web-ui/src/features/programming/fbd/FbdCanvas.tsx` (886 dòng)
- `apps/web-ui/e2e/programming-workspace-height.spec.ts` (151 dòng)
- `apps/web-ui/e2e/programming.spec.ts` (E2E chính)

### Contracts khóa chặt
- `data-testid="workbench-*-column"`: TC-FBD-* test suite
- `role="tabpanel"`: E2E đo trạng thái mở/đóng
- `localStorage` key: `mkddc:programming-workbench:v1`
- Grid class literal: Tailwind v4 scanning
- ARIA: `aria-label`, `role="tab"`, `aria-selected`

---

## Notes

### Quyết định architecture
- **localStorage thay vì URL state**: Trạng thái panel là preference UI cục bộ, không cần share qua URL
- **Context cho viewport**: Tránh prop drilling 5 tầng (Canvas → EditorPane → DesignWorkbench → Workbench → MinimapPanel)
- **Hook tái sử dụng**: `useFbdMinimap` tách logic tính toán ra khỏi render, dễ test
- **3 cột thay vì tabbed dock**: Theo ảnh PGM-02B, Mini Map hiển thị THƯỜNG TRỰC cạnh Problems và Runtime Watch, không nằm sau một cú bấm tab

### Conflict đã giải quyết
- **Plan cũ vs ảnh tham chiếu**: Plan đòi 5 tab + minimap tab thứ 6, ảnh chỉ có 4 tab + minimap panel riêng → theo ảnh
- **Plan cũ vs hiện trạng**: Plan mô tả auto layout chưa làm, thật đã xong từ trước → bỏ khỏi Task 9
- **E2E vs unit test mặc định**: E2E bắt đóng, unit test bắt mở → mở có điều kiện viewport, sửa cả hai bộ test

### Công việc NẰM NGOÀI Task 9 (không làm)
- Dải status đáy (`StatusStrip`) — user đã chọn bỏ
- Mã màu khối theo nhóm — user đã chọn bỏ
- Mã màu dây theo kiểu dữ liệu — user đã chọn bỏ
- Chế độ xem trước tự sắp xếp — đã xong từ trước (TC-FBD-LAYOUT-001)
- Hai nút Căn phải/Căn dưới — gap nhỏ, không block Task 9
- `distributeNodes` UI binding — gap nhỏ, không block Task 9
- Bổ sung test cho `ProblemsDrawer` variant embedded — gap nhỏ, không block Task 9
- Nối `openBuffer`/`onRecheck` cho nhãn CŨ diagnostic — gap trung bình, không block Task 9

### Người review kế tiếp
Khi đọc plan này:
1. Kiểm tra workflow journal để xem 10 agents còn lại (bị 429) có dữ liệu gì bổ sung không
2. Đối chiếu ảnh PGM-02B trực tiếp — số đo pixel trong plan này đã đo thủ công, cần xác minh lại
3. Chạy `git grep "cố ý hoãn\|CHƯA DỰNG\|ponytail:"` để tìm mọi chú thích hoãn việc — có thể có điều kiện block khác chưa phát hiện
4. Test `programming-workspace-height.spec.ts` là E2E ngân sách chiều cao nghiêm ngặt — mọi thay đổi layout dọc đều phải chạy test này

