# KẾ HOẠCH TRIỂN KHAI CHI TIẾT — FBD EDIT TASKS 8 & 9 REDO

**Ngày tạo:** 2026-09-09  
**Mục tiêu:** Tối ưu lại giao diện FBD Editor cho khớp chính xác với `PGM-02B_FBD_editor_reference.png`  
**Phạm vi:** Task 8 (FBD Editor Layout & Controls) + Task 9 (Workbench & Canvas Details)

---

## 1. TỔNG QUAN VÀ PHƯƠNG PHÁP

### 1.1 Nguyên tắc triển khai

1. **Phân chia công việc:** Task 8 trước (layout foundation), Task 9 sau (canvas details & workbench)
2. **TDD workflow:** Viết test failing → implement → verify → commit
3. **Incremental validation:** Sau mỗi bước chạy tsc + lint + vitest + webview check
4. **No forbidden files:** Tuyệt đối không sửa ProgrammingHeader.tsx, ProgrammingLayout.tsx, contracts/**, scripts/**
5. **Bundle budget:** Giữ programming-*.js ≤ 165.00 KiB gzip

### 1.2 Workflow execution

```
1. Tạo branch feat/fbd-edit-task8-9-redo từ main
2. Task 8 (Steps 2.1 → 2.7)
3. Mid-point verification + commit
4. Task 9 (Steps 3.1 → 3.8)
5. Final verification (tsc + lint + vitest + bundle + webview)
6. Commit + push + PR
```

### 1.3 Khảo sát hoàn thành — Kết quả chính

**Reference Design Specs (từ PGM-02B_FBD_editor_reference.png):**
- Layout: 4-zone fixed grid (Left 196px + Center flex + Right 342px + Bottom 162px)
- Colors: Canvas #FCFCFC, Panels #FFFFFF, Borders #E2E6EA, Accent #00796B
- Typography: Inter 12px body, 11px small, 14px title
- POU Tab Bar: 34px height, active tab white bg + #00796B top border
- Sub-toolbar: 36px height, segmented groups với dividers
- Minimap: 160×100px, bottom-right, visible when nodes > 24
- Block color coding: Logic #4A90E2, Control #00897B, Math #7E57C2, Timer #FFA726
- Wire color coding: BOOL #2E7D32, INT #1565C0, REAL #E65100, TIME #6A1B9A
- Bottom tabs: Problems, Watch, Trace, Search, Cross Reference
- Status strip: 39px height, items: nodes/wires/check/cycle/zoom/cursor

**Implementation hiện tại (từ khảo sát):**
- FbdEditorPane: 253 dòng, layout flexbox nested, POU tabs nằm ở ProgramsTab.tsx (KHÔNG ở FbdEditorPane)
- DesignWorkspacePage: 994 dòng, flexbox với useViewportFillHeight, 3-column grid do ProgramsTab quản lý
- StructuredFbdEditor: 913 dòng, custom SVG canvas, có minimap (176×104px, threshold 24), toolbar đầy đủ
- ProgrammingWorkbench: 583 dòng, bottom panel container, default closed 120px height
- ProblemsDrawer: 371 dòng, dual-mode (tray/embedded), reusable pattern

**Gap Analysis tổng hợp:**

| Khu vực | Gap hiện tại | Cần sửa |
|---------|--------------|---------|
| **Layout Grid** | Flexbox fluid, không fixed widths | Chuyển sang CSS Grid với fixed left (196px) + right (342px) |
| **POU Tab Bar** | Styling generic, không match reference | Áp dụng exact specs: 34px height, white bg active, #00796B border |
| **POU Explorer** | Chưa có left dock persistent 196px | Tạo component mới hoặc expand ProgramsTab explorer slot |
| **Canvas Sub-toolbar** | Có đủ controls nhưng styling khác | Re-style theo reference: 36px, segmented groups, dividers |
| **Block Colors** | Dùng --c-surface-2, không domain coding | Thêm domain color mapping: logic/control/math/timer |
| **Wire Colors** | Chỉ có default/selected, không datatype coding | Implement wire color by datatype |
| **Minimap** | 176×104px (sai), position không rõ | Resize 160×100px, đảm bảo bottom-right corner |
| **Library Dock** | Overlay/drawer, không persistent | Chuyển sang tabbed dock 342px cố định |
| **Inspector** | Tách biệt, không trong right dock | Merge vào tab thứ 2 của right dock |
| **Bottom Tabs** | Có problems/search/references/watch/trace, thiếu styling | Re-style + đảm bảo default open 162px |
| **Status Strip** | Có trong StructuredFbdEditor nhưng items khác | Update items: nodes/wires/check/cycle/zoom/cursor |

---

## 2. TASK 8 — FBD EDITOR LAYOUT & CONTROLS

### 2.1 BƯỚC 1: Setup Layout Grid Foundation

**Mục tiêu:** Chuyển từ flexbox fluid sang CSS Grid 4-zone cố định

**Files liên quan:**
- `apps/web-ui/src/features/programming/design/DesignWorkspacePage.tsx` (994 dòng)
- `apps/web-ui/src/features/programming/design/editor/FbdEditorPane.tsx` (253 dòng)

**Chi tiết thay đổi:**

1. **DesignWorkspacePage.tsx:**
   - Locate editor container (hiện tại dùng `lg:flex-1 lg:overflow-hidden`)
   - Wrap content trong CSS Grid với template:
     ```
     grid-template-columns: 196px 1fr 342px;
     grid-template-rows: auto 1fr 162px;
     grid-template-areas:
       "pou-explorer canvas-header library-dock"
       "pou-explorer canvas-body library-dock"
       "workbench workbench workbench";
     ```
   - Left area (pou-explorer): 196px fixed
   - Center area (canvas-*): flex 1fr
   - Right area (library-dock): 342px fixed
   - Bottom area (workbench): full width, 162px height

2. **Responsive breakpoints:**
   - `>= 1440px`: Full 4-zone grid như trên
   - `1024-1439px`: Grid 3 cột `200px 1fr 320px`, right dock collapse thành drawer overlay
   - `768-1023px`: Grid 2 cột `1fr 320px`, left drawer, right drawer
   - `< 768px`: 1 cột, read-only banner (đã có logic)

**Dependencies:**
- Không phụ thuộc bước khác, có thể làm đầu tiên

**Rủi ro:**
- Breaking existing flexbox calculations → cần test kỹ useViewportFillHeight
- Responsive breakpoints khác với thiết kế cũ → verify từng breakpoint

**Cách kiểm tra:**
- [ ] tsc pass
- [ ] Inspect devtools: grid template xuất hiện đúng tại breakpoint ≥1440px
- [ ] Left panel 196px, right panel 342px, center flex
- [ ] Responsive: Thu nhỏ browser xuống 1024px → right dock collapse
- [ ] Thu xuống 768px → read-only banner xuất hiện

**Definition of Done:**
- Layout grid render đúng 4 zones
- Responsive behavior hoạt động ở 4 breakpoints
- Không phá useViewportFillHeight
- Tests pass

---

### 2.2 BƯỚC 2: POU Explorer Left Dock (196px persistent)

**Mục tiêu:** Tạo left dock persistent với tree groups: Programs / Functions / Function Blocks / Variables / I-O

**Files liên quan:**
- Tạo mới: `apps/web-ui/src/features/programming/design/explorer/PouExplorerDock.tsx` (~150 dòng dự kiến)
- Modify: `apps/web-ui/src/features/programming/design/DesignWorkspacePage.tsx` (mount PouExplorerDock vào grid area "pou-explorer")

**Chi tiết thay đổi:**

1. **PouExplorerDock.tsx (component mới):**
   ```tsx
   interface PouExplorerDockProps {
     programs: ProgrammingProgram[];
     // functions: UserFunction[];  // Future
     // functionBlocks: UserFunctionBlock[];  // Future
     // variables: GlobalVariable[];  // Future
     activePouId: string | null;
     onSelectPou: (id: string) => void;
   }
   
   export function PouExplorerDock(props: PouExplorerDockProps) {
     return (
       <div className="pou-explorer-dock" style={{
         width: '196px',
         height: '100%',
         background: '#001829',
         borderRight: '1px solid #0A2E4C',
         overflow: 'auto'
       }}>
         <div className="explorer-header">
           <h2>POU Explorer</h2>
           <button>+ Thêm</button>
         </div>
         <TreeGroup title="PROGRAMS" items={props.programs} />
         <TreeGroup title="FUNCTIONS" items={[]} />
         <TreeGroup title="FUNCTION BLOCKS" items={[]} />
         <TreeGroup title="VARIABLES" items={[]} />
       </div>
     );
   }
   ```

2. **Styling theo reference:**
   - Header: 36px height, bg #001829, text #E2E8F0 uppercase 11px bold, border-bottom #0A2E4C
   - Tree items: 26px height, padding 0 12px, font 12px, color #CBD5E1
   - Hover: bg #0A2E4C
   - Selected: bg #00796B, text #FFFFFF
   - Icons: Chevron expand/collapse, POU type badges [PRG, FUN, FB], ST/FBD language icon

3. **Integration vào DesignWorkspacePage:**
   - Mount `<PouExplorerDock>` vào grid-area "pou-explorer"
   - Pass props: programs từ draft, activePouId, onSelectPou callback

**Dependencies:**
- Phụ thuộc Bước 2.1 (grid layout) đã complete

**Rủi ro:**
- Tree expansion state management → dùng local state hoặc URL params
- Icon assets chưa có → dùng text placeholder tạm hoặc emoji

**Cách kiểm tra:**
- [ ] Left dock render 196px width
- [ ] Tree groups "PROGRAMS" / "FUNCTIONS" / "FUNCTION BLOCKS" / "VARIABLES" hiển thị
- [ ] Click item → onSelectPou callback fire
- [ ] Styling match reference (dark bg, correct colors)
- [ ] Scroll work khi danh sách dài

**Definition of Done:**
- Component render với styling đúng reference
- Tree groups hiển thị đầy đủ
- Selection sync với active POU
- Tests cover selection callback

---

### 2.3 BƯỚC 3: POU Tab Bar Re-styling

**Mục tiêu:** Style lại POU tab bar (nằm trong ProgramsTab.tsx hoặc component cha) cho khớp reference

**Files liên quan:**
- Xác định vị trí POU tabs: theo khảo sát, POU tab bar nằm trong `ProgramsTab.tsx` (không phải FbdEditorPane)
- Likely file: `apps/web-ui/src/features/programming/design/programs/ProgramsTab.tsx` (chưa đọc, cần đọc trước khi sửa)

**Chi tiết thay đổi:**

1. **Đọc ProgramsTab.tsx trước:**
   - Xác định cấu trúc tab bar hiện tại
   - Props: tabs array, activeTab, onTabChange, onAddTab, onCloseTab
   - Styling approach: Tailwind classes hoặc CSS module

2. **Re-style theo reference specs:**
   - Tab bar height: 34px
   - Active tab:
     - Background: #FFFFFF
     - Top border: 2px solid #00796B
     - Text: #001728, bold 12px
     - Border-right: 1px solid #E2E6EA
     - Dirty indicator: dot #ED6C02
   - Inactive tab:
     - Background: #F5F7FA
     - Text: #5A6879, regular 12px
     - Border-right: 1px solid #E2E6EA
     - No top accent
   - Close button: x icon 14×14px, color #708090, hover bg #E2E8F0, rounded 2px
   - Add button: + icon 24×24px, ghost style, color #5A6879, hover bg #EDF2F7

3. **Replace existing styles:**
   - Remove generic web tab styling
   - Apply exact colors và dimensions từ reference
   - Ensure dirty dot indicator positioned correctly

**Dependencies:**
- Phụ thuộc Bước 2.1 (grid layout) để tab bar nằm đúng vị trí trong canvas-header area

**Rủi ro:**
- ProgramsTab.tsx có thể phức tạp hơn dự kiến → cần đọc kỹ trước
- Tab switching logic có thể bị ảnh hưởng bởi styling changes → test kỹ

**Cách kiểm tra:**
- [ ] Tab bar height 34px
- [ ] Active tab: white bg, #00796B top border
- [ ] Inactive tab: #F5F7FA bg
- [ ] Close button hover state hoạt động
- [ ] Add button render đúng style
- [ ] Tab switching không bị break

**Definition of Done:**
- Tab bar styling match reference 100%
- Active/inactive states rõ ràng
- Dirty indicator xuất hiện khi cần
- No regression trong tab switching logic

---

### 2.4 BƯỚC 4: Canvas Sub-toolbar Re-styling

**Mục tiêu:** Re-style toolbar trong StructuredFbdEditor cho khớp reference (36px height, segmented groups, dividers)

**Files liên quan:**
- `apps/web-ui/src/features/programming/fbd/StructuredFbdEditor.tsx` (913 dòng)

**Chi tiết thay đổi:**

1. **Locate toolbar section trong StructuredFbdEditor:**
   - Theo khảo sát, toolbar có đầy đủ controls: Zoom In/Out, Undo/Redo, Align, Delete, etc.
   - Hiện tại styling: Tailwind classes, có thể không có dividers giữa groups

2. **Re-style theo reference:**
   - Toolbar container:
     - Height: 36px
     - Background: #FFFFFF
     - Border-bottom: 1px solid #E2E6EA
   - Control groups:
     - Group 1: Select / Pan tools
     - Divider: vertical line 1px #E2E6EA, height 24px
     - Group 2: Zoom controls (In / Out / % / Fit)
     - Divider
     - Group 3: Grid / Snap toggles
     - Divider
     - Group 4: Align / Distribute
     - Divider
     - Group 5: Undo / Redo
     - Divider
     - Group 6: Delete
   - Button style:
     - Size: 28×28px
     - Color: #5A6879
     - Hover: bg #EDF2F7
     - Active: bg #E2E8F0, color #00796B
     - Border-radius: 4px

3. **Add vertical dividers:**
   - Insert `<div className="toolbar-divider">` giữa groups
   - Style: `width: 1px; height: 24px; background: #E2E6EA; margin: 0 8px;`

**Dependencies:**
- Không phụ thuộc các bước trước, có thể làm song song với 2.2 hoặc 2.3

**Rủi ro:**
- Toolbar có nhiều controls → cần maintain accessibility (aria-label, keyboard)
- Button interaction handlers không bị ảnh hưởng → test từng control

**Cách kiểm tra:**
- [ ] Toolbar height 36px
- [ ] Dividers xuất hiện giữa groups
- [ ] Button hover/active states work
- [ ] Click controls trigger đúng actions (zoom, undo, align, etc.)
- [ ] Accessibility: keyboard navigation + screen reader labels

**Definition of Done:**
- Toolbar styling match reference
- All controls functional
- Dividers render correctly
- No regression trong command dispatch

---

### 2.5 BƯỚC 5: Library & Inspector Right Dock (342px tabbed)

**Mục tiêu:** Chuyển Library từ overlay thành persistent right dock 342px, merge Inspector vào tab thứ 2

**Files liên quan:**
- Tạo mới: `apps/web-ui/src/features/programming/design/dock/LibraryInspectorDock.tsx` (~250 dòng dự kiến)
- Modify: `apps/web-ui/src/features/programming/design/DesignWorkspacePage.tsx` (mount dock vào grid area "library-dock")
- Reference: Existing library/inspector components để reuse logic

**Chi tiết thay đổi:**

1. **LibraryInspectorDock.tsx (component mới):**
   ```tsx
   interface LibraryInspectorDockProps {
     activeTab: 'library' | 'inspector';
     onTabChange: (tab: 'library' | 'inspector') => void;
     // Library props
     libraryCategories: LibraryCategory[];
     onInsertBlock: (blockType: string) => void;
     // Inspector props
     selectedNode: FbdNode | null;
     onUpdateNode: (id: string, patch: Partial<FbdNode>) => void;
   }
   
   export function LibraryInspectorDock(props: LibraryInspectorDockProps) {
     return (
       <div className="library-inspector-dock" style={{
         width: '342px',
         height: '100%',
         borderLeft: '1px solid #E2E6EA',
         background: '#FFFFFF'
       }}>
         <div className="dock-tabs">
           <button onClick={() => props.onTabChange('library')}>
             Quick Library
           </button>
           <button onClick={() => props.onTabChange('inspector')}>
             Inspector
           </button>
         </div>
         {props.activeTab === 'library' && <QuickLibraryPanel />}
         {props.activeTab === 'inspector' && <InspectorPanel />}
       </div>
     );
   }
   ```

2. **QuickLibraryPanel:**
   - Search input (Ctrl+L shortcut)
   - Accordion categories: Recent, Favorites, Common, HVAC, Logic, Math, Timer, Counter
   - Block cards với badges: FB (blue), FUN (green), VAR (amber), I/O (teal)
   - Port signatures visible
   - "+ More blocks..." link to PGM-04

3. **InspectorPanel:**
   - Sections:
     - Identity & Instance Name (editable input)
     - Block Type & Source Library (read-only)
     - Execution Order & Task Binding (drag reorder or number input)
     - Parameters & Initial Values Table (editable)
     - Port Configuration & Type Casting (toggles)
     - Retain Memory Policy (checkbox)
     - Runtime Read-Back Overlays (Live / Sim mode)
   - Features:
     - Inline editing
     - Port visibility toggle
     - Reference jumper to source POU

4. **Styling theo reference:**
   - Tab header: 36px height, border-bottom #E2E6EA
   - Active tab: underline #00796B, text bold
   - Inactive tab: text regular #5A6879
   - Content area: padding 12px, scroll auto

**Dependencies:**
- Phụ thuộc Bước 2.1 (grid layout) để dock nằm đúng vị trí

**Rủi ro:**
- Library data structure chưa rõ → cần đọc existing library implementation
- Inspector editing logic phức tạp → có thể reuse code cũ từ separate inspector component

**Cách kiểm tra:**
- [ ] Dock render 342px width
- [ ] Tab switching work (library ↔ inspector)
- [ ] Library: search filter hoạt động
- [ ] Library: click block card → onInsertBlock callback
- [ ] Inspector: hiển thị selected node data
- [ ] Inspector: edit fields → onUpdateNode callback
- [ ] Styling match reference

**Definition of Done:**
- Dock persistent và styled đúng
- Both tabs functional
- Library search + insert work
- Inspector display + edit work
- Tests cover tab switching và callbacks

---

### 2.6 BƯỚC 6: Responsive Behavior cho 4 Breakpoints

**Mục tiêu:** Implement responsive behavior theo spec Task 8

**Files liên quan:**
- `apps/web-ui/src/features/programming/design/DesignWorkspacePage.tsx`
- `apps/web-ui/src/features/programming/design/editor/FbdEditorPane.tsx`

**Chi tiết thay đổi:**

1. **Breakpoint logic:**
   ```tsx
   const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
   
   useEffect(() => {
     const handler = () => setViewportWidth(window.innerWidth);
     window.addEventListener('resize', handler);
     return () => window.removeEventListener('resize', handler);
   }, []);
   
   const layoutMode = viewportWidth >= 1440 ? 'full-4zone' :
                      viewportWidth >= 1024 ? 'collapse-right' :
                      viewportWidth >= 768 ? 'tablet-drawers' :
                      'mobile-readonly';
   ```

2. **Layout adjustments per mode:**
   - **full-4zone (≥1440px):**
     - Grid: `196px 1fr 342px / auto 1fr 162px`
     - All panels visible
   - **collapse-right (1024-1439px):**
     - Grid: `200px 1fr / auto 1fr 162px`
     - Right dock → drawer overlay (position absolute, slide in from right)
     - Button "Thư viện / Inspector" toggle drawer
   - **tablet-drawers (768-1023px):**
     - Grid: `1fr / auto 1fr 162px`
     - Left dock → drawer overlay
     - Right dock → drawer overlay
     - Button "Chọn vùng" for area selection
   - **mobile-readonly (<768px):**
     - Grid: `1fr / auto 1fr`
     - Banner: "Chế độ chỉ đọc trên thiết bị nhỏ"
     - Disable mutation controls (already implemented per khảo sát)

3. **Drawer implementation:**
   - Use `<Drawer>` component từ UI library hoặc custom
   - Backdrop overlay khi drawer open
   - Swipe gesture để close (optional)
   - State: `const [leftDrawerOpen, setLeftDrawerOpen] = useState(false);`

**Dependencies:**
- Phụ thuộc Bước 2.1-2.5 (all layout components) đã complete

**Rủi ro:**
- Drawer animation có thể lag → use CSS transform (GPU accelerated)
- State management cho drawer open/close → dùng local state hoặc URL params

**Cách kiểm tra:**
- [ ] 1440px+: Full 4-zone visible
- [ ] 1280px: Right dock collapse, button toggle work
- [ ] 1024px: Left dock + right dock collapse, both drawers work
- [ ] 768px: Tablet mode, "Chọn vùng" button visible
- [ ] 500px: Mobile readonly banner, mutations disabled
- [ ] Drawer animation smooth (no jank)

**Definition of Done:**
- Responsive work ở tất cả breakpoints
- Drawer overlay functional
- Mobile readonly enforced
- No layout shift khi resize

---

### 2.7 BƯỚC 7: Task 8 Tests

**Mục tiêu:** Viết/update tests cho Task 8 changes

**Files liên quan:**
- `apps/web-ui/src/features/programming/design/DesignWorkspacePage.test.tsx`
- `apps/web-ui/src/features/programming/design/editor/FbdEditorPane.test.tsx`
- Tạo mới: `apps/web-ui/src/features/programming/design/explorer/PouExplorerDock.test.tsx`
- Tạo mới: `apps/web-ui/src/features/programming/design/dock/LibraryInspectorDock.test.tsx`

**Test cases cần thêm/update:**

1. **DesignWorkspacePage.test.tsx:**
   - [ ] Layout grid render với đúng template areas
   - [ ] Responsive: 1440px → 4 zones visible
   - [ ] Responsive: 1024px → right dock drawer mode
   - [ ] Responsive: 768px → tablet mode với drawers
   - [ ] Responsive: 500px → mobile readonly banner

2. **PouExplorerDock.test.tsx:**
   - [ ] Render tree groups: PROGRAMS / FUNCTIONS / FUNCTION BLOCKS / VARIABLES
   - [ ] Click program item → onSelectPou callback with correct id
   - [ ] Active item highlighted với bg #00796B
   - [ ] Styling: dark bg, correct colors

3. **LibraryInspectorDock.test.tsx:**
   - [ ] Tab switching: library ↔ inspector
   - [ ] Library panel: search filter blocks
   - [ ] Library panel: click block → onInsertBlock callback
   - [ ] Inspector panel: display selected node data
   - [ ] Inspector panel: edit field → onUpdateNode callback

4. **FbdEditorPane.test.tsx (update existing):**
   - [ ] Sub-toolbar render với dividers
   - [ ] Toolbar controls clickable và trigger commands
   - [ ] POU tab bar styling (nếu logic nằm trong FbdEditorPane)

**TDD approach:**
- Viết tests FAILING trước
- Run `npx vitest --run` → confirm failures
- Implement code
- Run tests → confirm pass

**Dependencies:**
- Phụ thuộc Bước 2.1-2.6 implementation complete

**Cách kiểm tra:**
- [ ] `npx vitest --run` → all new tests pass
- [ ] Coverage ≥ 80% cho new components
- [ ] No test pollution (cleanup after each test)

**Definition of Done:**
- All test cases implemented và pass
- Coverage targets met
- No flaky tests

---

## 3. TASK 9 — WORKBENCH & CANVAS DETAILS

### 3.1 BƯỚC 1: Bottom Workbench Re-styling & Tabs

**Mục tiêu:** Re-style bottom panel, đảm bảo tabs đầy đủ: Problems / Watch / Trace / Search / Cross Reference, default open 162px

**Files liên quan:**
- `apps/web-ui/src/features/programming/design/workbench/ProgrammingWorkbench.tsx` (583 dòng)
- `apps/web-ui/src/features/programming/design/workbench/DesignWorkbench.tsx` (290 dòng)

**Chi tiết thay đổi:**

1. **ProgrammingWorkbench.tsx updates:**
   - Locate tabs array definition (hiện tại: `problems, search, references, watch, trace`)
   - Rename "references" → "Cross Reference" (display name)
   - Verify all 5 tabs present
   - Update default state:
     ```tsx
     const [open, setOpen] = useState(true);  // Currently false
     const [height, setHeight] = useState(162);  // Currently 120
     ```

2. **Styling updates theo reference:**
   - Panel container:
     - Border-top: 1px solid #E2E6EA
     - Background: #FFFFFF
   - Tab header:
     - Height: 36px
     - Active tab: border-bottom 2px #00796B, text bold
     - Inactive tab: border-bottom transparent, text regular #5A6879
   - Tab content area:
     - Padding: 12px
     - Background: #FCFCFC (slight tint)
   - Resize handle:
     - Height: 4px
     - Background: #E2E6EA
     - Hover: bg #00796B
     - Cursor: ns-resize

3. **Height constraints:**
   - Min: 120px (giữ nguyên)
   - Max: 520px (giữ nguyên)
   - Default: 162px (thay đổi từ 120px)

**Dependencies:**
- Không phụ thuộc Task 8, nhưng nên làm sau Task 8 để tránh conflict

**Rủi ro:**
- Changing default open=true có thể ảnh hưởng UX → cần confirm với user hoặc làm theo reference
- Height 162px có thể che mất canvas trên màn hình nhỏ → verify responsive

**Cách kiểm tra:**
- [ ] Bottom panel default open với height 162px
- [ ] All 5 tabs visible: Problems / Watch / Trace / Search / Cross Reference
- [ ] Tab switching work
- [ ] Resize handle work, constrain 120-520px
- [ ] Styling match reference

**Definition of Done:**
- Panel default open 162px
- All tabs present và functional
- Styling match reference
- Resize work correctly

---

### 3.2 BƯỚC 2: Status Strip Implementation

**Mục tiêu:** Implement status strip ở bottom với items: nodes / wires / check / cycle / zoom / cursor

**Files liên quan:**
- Tạo mới: `apps/web-ui/src/features/programming/design/workbench/StatusStrip.tsx` (~80 dòng dự kiến)
- Modify: `apps/web-ui/src/features/programming/design/DesignWorkspacePage.tsx` (mount StatusStrip below workbench hoặc as part of workbench)

**Chi tiết thay đổi:**

1. **StatusStrip.tsx component:**
   ```tsx
   interface StatusStripProps {
     nodeCount: number;
     maxNodes: number;
     wireCount: number;
     maxWires: number;
     checkStatus: 'valid' | 'error' | 'warning' | 'unchecked';
     cycleBudget: string;  // e.g. "100ms"
     zoom: number;  // e.g. 1.0 = 100%
     cursorPos: { x: number; y: number } | null;
   }
   
   export function StatusStrip(props: StatusStripProps) {
     return (
       <div className="status-strip" style={{
         height: '39px',
         background: '#F8FAFC',
         borderTop: '1px solid #E2E6EA',
         display: 'flex',
         alignItems: 'center',
         gap: '16px',
         padding: '0 12px',
         fontSize: '11px',
         color: '#5A6879'
       }}>
         <div>Nodes: {props.nodeCount} / {props.maxNodes}</div>
         <div>Connections: {props.wireCount} / {props.maxWires}</div>
         <div>Check: {checkStatusLabel(props.checkStatus)}</div>
         <div>Cycle: {props.cycleBudget}</div>
         <div>Zoom: {Math.round(props.zoom * 100)}%</div>
         {props.cursorPos && (
           <div>Cursor: X: {props.cursorPos.x}, Y: {props.cursorPos.y}</div>
         )}
       </div>
     );
   }
   ```

2. **Data source:**
   - Node/wire counts: từ FbdDocument state trong StructuredFbdEditor
   - Check status: từ canonical validation result
   - Cycle budget: hardcode "100ms" hoặc từ controller config
   - Zoom: từ StructuredFbdEditor viewport scale
   - Cursor pos: từ StructuredFbdEditor mouse move handler

3. **Integration:**
   - Mount StatusStrip ở grid area riêng hoặc as part of bottom workbench
   - Pass data via props từ parent (DesignWorkspacePage hoặc FbdEditorPane)

**Dependencies:**
- Phụ thuộc Bước 3.1 (workbench re-styling) để biết vị trí mount

**Rủi ro:**
- Cursor position tracking có thể expensive → debounce mouse move handler
- Data flow từ editor lên parent → có thể cần lift state hoặc context

**Cách kiểm tra:**
- [ ] Status strip render với height 39px
- [ ] Items display correct values: nodes / wires / check / cycle / zoom / cursor
- [ ] Update real-time khi canvas change (add/delete nodes, zoom, etc.)
- [ ] No performance lag (cursor tracking debounced)

**Definition of Done:**
- Status strip render với styling đúng reference
- All items display correct data
- Real-time updates work
- No performance regression

---

### 3.3 BƯỚC 3: Block Domain Color Coding

**Mục tiêu:** Implement domain-based color coding cho block headers: Logic #4A90E2, Control #00897B, Math #7E57C2, Timer #FFA726

**Files liên quan:**
- `apps/web-ui/src/features/programming/fbd/StructuredFbdEditor.tsx` (913 dòng)
- Likely: `apps/web-ui/src/features/programming/fbd/components/FbdCanvas.tsx` hoặc `FbdNode.tsx` (chưa đọc, cần đọc trước)

**Chi tiết thay đổi:**

1. **Define domain mapping:**
   ```tsx
   const BLOCK_DOMAIN_COLORS: Record<string, string> = {
     // Logic domain
     'AND': '#4A90E2',
     'OR': '#4A90E2',
     'NOT': '#4A90E2',
     'XOR': '#4A90E2',
     'SR': '#4A90E2',
     'RS': '#4A90E2',
     
     // Control domain
     'PID': '#00897B',
     'LEAD_LAG': '#00897B',
     'FILTER': '#00897B',
     'LIMIT': '#00897B',
     
     // Math domain
     'ADD': '#7E57C2',
     'SUB': '#7E57C2',
     'MUL': '#7E57C2',
     'DIV': '#7E57C2',
     'SCALE': '#7E57C2',
     
     // Timer domain
     'TON': '#FFA726',
     'TOF': '#FFA726',
     'TP': '#FFA726',
     'RTC': '#FFA726',
   };
   
   function getBlockDomainColor(blockType: string): string {
     return BLOCK_DOMAIN_COLORS[blockType] || '#5A6879';  // Default gray
   }
   ```

2. **Apply color to block header:**
   - Locate SVG rect rendering trong FbdCanvas hoặc FbdNode component
   - Update fill attribute:
     ```tsx
     <rect
       className="block-header"
       fill={getBlockDomainColor(node.type)}
       x={node.x}
       y={node.y}
       width={node.width}
       height={22}  // Header height
       rx={4}
     />
     ```

3. **Ensure header text readable:**
   - Header text always white (#FFFFFF) for contrast
   - Execution order badge: white bg, domain color text

**Dependencies:**
- Không phụ thuộc các bước trước trong Task 9, có thể làm song song

**Rủi ro:**
- Block type names có thể khác với mapping → cần check actual block type constants
- Accessibility: color-only distinction → add aria-label với domain name

**Cách kiểm tra:**
- [ ] Logic blocks (AND, OR, etc.) render với header #4A90E2
- [ ] Control blocks (PID, FILTER, etc.) render với header #00897B
- [ ] Math blocks (ADD, MUL, etc.) render với header #7E57C2
- [ ] Timer blocks (TON, TOF, etc.) render với header #FFA726
- [ ] Unknown blocks render với default gray
- [ ] Header text readable (white on colored bg)

**Definition of Done:**
- Domain color mapping implemented
- Colors apply correctly to block headers
- Text contrast acceptable
- Accessibility labels present

---

### 3.4 BƯỚC 4: Wire Datatype Color Coding

**Mục tiêu:** Implement datatype-based wire colors: BOOL #2E7D32, INT #1565C0, REAL #E65100, TIME #6A1B9A, untyped #9E9E9E, error #D32F2F dashed

**Files liên quan:**
- `apps/web-ui/src/features/programming/fbd/StructuredFbdEditor.tsx`
- Likely: `apps/web-ui/src/features/programming/fbd/components/FbdCanvas.tsx` (wire rendering)

**Chi tiết thay đổi:**

1. **Define datatype color mapping:**
   ```tsx
   const WIRE_DATATYPE_COLORS: Record<string, { stroke: string; dashArray?: string }> = {
     'BOOL': { stroke: '#2E7D32' },
     'INT': { stroke: '#1565C0' },
     'DINT': { stroke: '#1565C0' },
     'REAL': { stroke: '#E65100' },
     'FLOAT': { stroke: '#E65100' },
     'TIME': { stroke: '#6A1B9A' },
     'UNTYPED': { stroke: '#9E9E9E' },
     'ERROR': { stroke: '#D32F2F', dashArray: '4 2' },
   };
   
   function getWireStyle(wire: FbdWire, document: FbdDocument) {
     // Resolve datatype from source port
     const sourceNode = document.nodes.find(n => n.id === wire.sourceNodeId);
     const sourcePort = sourceNode?.outputs.find(p => p.id === wire.sourcePortId);
     const datatype = sourcePort?.datatype || 'UNTYPED';
     
     // Check for type mismatch error
     const targetNode = document.nodes.find(n => n.id === wire.targetNodeId);
     const targetPort = targetNode?.inputs.find(p => p.id === wire.targetPortId);
     const hasError = targetPort && targetPort.datatype !== datatype;
     
     return WIRE_DATATYPE_COLORS[hasError ? 'ERROR' : datatype] || WIRE_DATATYPE_COLORS.UNTYPED;
   }
   ```

2. **Apply style to SVG path:**
   - Locate wire rendering trong FbdCanvas
   - Update stroke và strokeDasharray:
     ```tsx
     const wireStyle = getWireStyle(wire, document);
     <path
       d={wirePath}
       stroke={wireStyle.stroke}
       strokeWidth={wire.selected ? 2.5 : 1.5}
       strokeDasharray={wireStyle.dashArray}
       fill="none"
     />
     ```

3. **Handle selected state:**
   - Selected wire: keep datatype color, increase stroke width 2.5px
   - Add glow effect: shadow stroke với same color, blur 4px

**Dependencies:**
- Phụ thuộc Bước 3.3 (block colors) để có consistent theming

**Rủi ro:**
- Datatype resolution logic phức tạp → có thể có edge cases (generic ports, ANY type)
- Too many wire colors có thể confusing → consider legend hoặc toggle

**Cách kiểm tra:**
- [ ] BOOL wires render green #2E7D32
- [ ] INT wires render blue #1565C0
- [ ] REAL wires render orange #E65100
- [ ] TIME wires render purple #6A1B9A
- [ ] Untyped wires render gray #9E9E9E
- [ ] Type mismatch wires render red dashed
- [ ] Selected wires keep datatype color, thicker stroke

**Definition of Done:**
- Wire color coding implemented
- All datatypes mapped correctly
- Error state (type mismatch) shows red dashed
- Selected state preserves color

---

### 3.5 BƯỚC 5: Minimap Resize & Positioning

**Mục tiêu:** Resize minimap từ 176×104px → 160×100px, đảm bảo position bottom-right corner

**Files liên quan:**
- `apps/web-ui/src/features/programming/fbd/StructuredFbdEditor.tsx` (913 dòng)
- Constants file defining `FBD_MINIMAP_WIDTH`, `FBD_MINIMAP_HEIGHT`

**Chi tiết thay đổi:**

1. **Locate minimap constants:**
   - Theo khảo sát: `FBD_MINIMAP_WIDTH = 176`, `FBD_MINIMAP_HEIGHT = 104`
   - Find file định nghĩa constants (likely trong StructuredFbdEditor.tsx hoặc separate constants file)

2. **Update constants:**
   ```tsx
   const FBD_MINIMAP_WIDTH = 160;  // Was 176
   const FBD_MINIMAP_HEIGHT = 100;  // Was 104
   const FBD_MINIMAP_NODE_THRESHOLD = 24;  // Keep same
   ```

3. **Verify positioning:**
   - Minimap should be `position: absolute; bottom: 16px; right: 16px;`
   - Background: #FFFFFF, opacity 0.9
   - Border: 1px solid #CFD8DC
   - Viewport rectangle: #00796B fill opacity 0.15, stroke #00796B

4. **Check threshold logic:**
   - Minimap only visible when `nodeCount > FBD_MINIMAP_NODE_THRESHOLD`
   - Currently threshold = 24, keep same

**Dependencies:**
- Không phụ thuộc bước khác, có thể làm độc lập

**Rủi ro:**
- Minimap calculations dựa trên width/height → cần test không bị distort
- Position absolute có thể overlap với canvas controls → verify z-index

**Cách kiểm tra:**
- [ ] Minimap dimensions 160×100px
- [ ] Position bottom-right corner, 16px margin
- [ ] Only visible when nodes > 24
- [ ] Viewport rectangle scales correctly
- [ ] Click minimap → pan canvas to clicked area

**Definition of Done:**
- Minimap resized to 160×100px
- Positioned correctly bottom-right
- Threshold logic working
- No visual distortion

---

### 3.6 BƯỚC 6: Auto Layout Preview & Apply/Cancel

**Mục tiêu:** Implement auto layout preview mode với Apply/Cancel buttons

**Files liên quan:**
- `apps/web-ui/src/features/programming/fbd/StructuredFbdEditor.tsx` (913 dòng)

**Chi tiết thay đổi:**

1. **Auto layout algorithm:**
   - Theo khảo sát, đã có "Auto layout (Tự sắp xếp)" control trong toolbar
   - Likely đã có implementation, cần verify behavior
   - Algorithm: Layered graph layout (Sugiyama), minimize edge crossings

2. **Preview mode:**
   - Add state: `const [layoutPreview, setLayoutPreview] = useState<LayoutPreview | null>(null);`
   - Preview structure:
     ```tsx
     interface LayoutPreview {
       nodes: Array<{ id: string; x: number; y: number }>;
       wires: FbdWire[];  // Recalculated routing
     }
     ```

3. **Preview rendering:**
   - When layoutPreview !== null:
     - Render ghost overlay với preview positions (semi-transparent)
     - Show Apply / Cancel buttons in toolbar
     - Original positions still visible (faded)

4. **Apply / Cancel actions:**
   - Apply button:
     ```tsx
     function applyLayout() {
       if (!layoutPreview) return;
       dispatch({
         type: 'SET_LAYOUT_BATCH',
         payload: { nodePositions: layoutPreview.nodes }
       });
       setLayoutPreview(null);
     }
     ```
   - Cancel button:
     ```tsx
     function cancelLayout() {
       setLayoutPreview(null);
     }
     ```

5. **Toolbar updates:**
   - When preview active:
     - Hide normal tools
     - Show: "Apply Layout" button (green), "Cancel" button (gray)
   - When preview inactive:
     - Show: "Auto Layout" button (triggers preview)

**Dependencies:**
- Phụ thuộc Bước 2.4 (toolbar re-styling) để biết vị trí buttons

**Rủi ro:**
- Auto layout algorithm có thể slow cho large graphs → show loading spinner
- Preview overlay có thể confusing → add clear visual distinction (dashed outline, different color)

**Cách kiểm tra:**
- [ ] Click "Auto Layout" → preview mode activates
- [ ] Ghost overlay shows preview positions
- [ ] Apply button → commit layout, exit preview
- [ ] Cancel button → discard preview, restore original
- [ ] Preview visually distinct from original (opacity, dashed, color)

**Definition of Done:**
- Preview mode implemented
- Apply/Cancel buttons functional
- Visual distinction clear
- No performance issues

---

### 3.7 BƯỚC 7: ProblemsDrawer Integration & Mini Map Tab

**Mục tiêu:** Integrate ProblemsDrawer vào bottom workbench, add "Mini Map" tab nếu spec yêu cầu

**Files liên quan:**
- `apps/web-ui/src/features/programming/design/workbench/ProgrammingWorkbench.tsx` (583 dòng)
- `apps/web-ui/src/features/programming/shared/ProblemsDrawer.tsx` (371 dòng, reference)

**Chi tiết thay đổi:**

1. **Verify current integration:**
   - Theo khảo sát, ProblemsDrawer đã được nhúng dạng embedded vào ProgrammingWorkbench
   - Check tab "problems" render ProblemsDrawer với variant="embedded"

2. **Mini Map tab (nếu cần):**
   - Reference image có tab "Mini Map" trong bottom panel? → Check lại reference
   - Nếu có, add tab:
     ```tsx
     tabs: ['problems', 'watch', 'trace', 'search', 'references', 'minimap']
     ```
   - Mini Map tab content: Duplicate của minimap từ canvas, hoặc link to toggle minimap visibility

3. **ProblemsDrawer embedded mode:**
   - Verify variant="embedded" không có backdrop, collapse, resize (vì đã handle bởi ProgrammingWorkbench)
   - Pass props:
     ```tsx
     <ProblemsDrawer
       variant="embedded"
       diagnostics={props.problems}
       onJumpToOffset={props.onJumpToOffset}
       onRecheck={props.onRecheck}
       diagnosticFreshness={computeFreshness(props.problems, currentBuffer)}
     />
     ```

4. **Tab content mapping:**
   - problems → ProblemsDrawer
   - watch → WatchPanel (existing)
   - trace → TracePanel (existing)
   - search → SearchPanel (existing)
   - references → CrossReferencePanel (existing)
   - minimap → MinimapPanel (nếu cần thêm)

**Dependencies:**
- Phụ thuộc Bước 3.1 (workbench tabs) đã có structure

**Rủi ro:**
- Mini Map tab có thể redundant với canvas minimap → cần clarify với user hoặc reference
- ProblemsDrawer integration có thể đã đúng, không cần sửa → verify trước

**Cách kiểm tra:**
- [ ] Problems tab render ProblemsDrawer embedded
- [ ] Diagnostics display correctly
- [ ] Jump to offset work khi click diagnostic
- [ ] Recheck button work (nếu có)
- [ ] Mini Map tab (nếu thêm) render minimap view

**Definition of Done:**
- ProblemsDrawer integrated correctly
- All tabs functional
- Mini Map tab added (nếu cần)
- No regression trong diagnostics display

---

### 3.8 BƯỚC 8: Task 9 Tests

**Mục tiêu:** Viết/update tests cho Task 9 changes

**Files liên quan:**
- `apps/web-ui/src/features/programming/design/workbench/ProgrammingWorkbench.test.tsx` (update)
- `apps/web-ui/src/features/programming/fbd/StructuredFbdEditor.test.tsx` (update)
- Tạo mới: `apps/web-ui/src/features/programming/design/workbench/StatusStrip.test.tsx`

**Test cases cần thêm/update:**

1. **ProgrammingWorkbench.test.tsx:**
   - [ ] Default state: open=true, height=162px
   - [ ] All 5 tabs render: Problems / Watch / Trace / Search / Cross Reference
   - [ ] Tab switching work
   - [ ] Resize handle work, constrain 120-520px
   - [ ] ProblemsDrawer render trong Problems tab

2. **StatusStrip.test.tsx:**
   - [ ] Render với correct items: nodes / wires / check / cycle / zoom / cursor
   - [ ] Update khi props change
   - [ ] Cursor position format correctly

3. **StructuredFbdEditor.test.tsx (update):**
   - [ ] Block domain colors apply correctly (logic/control/math/timer)
   - [ ] Wire datatype colors apply correctly (BOOL/INT/REAL/TIME/untyped/error)
   - [ ] Minimap dimensions 160×100px
   - [ ] Minimap threshold 24 nodes
   - [ ] Auto layout preview mode activate/apply/cancel
   - [ ] Preview render ghost overlay
   - [ ] Apply layout commit positions
   - [ ] Cancel layout discard preview

**TDD approach:**
- Viết tests FAILING trước
- Implement code
- Run tests → confirm pass

**Dependencies:**
- Phụ thuộc Bước 3.1-3.7 implementation complete

**Cách kiểm tra:**
- [ ] `npx vitest --run` → all new tests pass
- [ ] Coverage ≥ 80% cho new/modified code
- [ ] No flaky tests

**Definition of Done:**
- All test cases implemented và pass
- Coverage targets met
- No test pollution

---

## 4. FINAL VERIFICATION & COMMIT

### 4.1 Pre-Commit Checklist

**Trước khi commit, verify tất cả:**

1. **Build & Type Check:**
   ```bash
   cd MK-DDC-24/apps/web-ui
   npx tsc --noEmit
   npm run lint
   npx vitest --run
   npm run build
   ```

2. **Bundle Size Check:**
   ```bash
   # After build
   cd dist/assets
   ls -lh programming-*.js.gz
   # Verify ≤ 165.00 KiB
   ```

3. **Visual Verification:**
   ```bash
   # Use webview skill
   # Navigate to FBD Editor
   # Take screenshots at 1440px, 1280px, 1024px, 768px
   # Compare with reference image side-by-side
   ```

4. **Responsive Check:**
   - [ ] 1440px: Full 4-zone visible
   - [ ] 1280px: Right dock drawer
   - [ ] 1024px: Both docks drawer
   - [ ] 768px: Tablet mode
   - [ ] 500px: Mobile readonly

5. **Functional Check:**
   - [ ] POU Explorer: select POU work
   - [ ] POU Tab Bar: switch tabs work, close work
   - [ ] Canvas: add block, connect wire, zoom, pan work
   - [ ] Sub-toolbar: all controls functional
   - [ ] Library: search, insert block work
   - [ ] Inspector: edit properties work
   - [ ] Bottom panel: switch tabs work, resize work
   - [ ] Status strip: display correct values
   - [ ] Block colors: domain coding visible
   - [ ] Wire colors: datatype coding visible
   - [ ] Minimap: visible when nodes > 24, click to pan work
   - [ ] Auto layout: preview/apply/cancel work

6. **Accessibility Check:**
   - [ ] Keyboard navigation work (Tab, Arrow keys)
   - [ ] Screen reader labels present (aria-label)
   - [ ] Focus visible (outline on focusable elements)
   - [ ] Color contrast ≥ 4.5:1 (WCAG AA)

7. **UI Strings Check:**
   ```bash
   npm run check:ui-strings
   # Must pass - all UI strings tiếng Việt có dấu
   ```

### 4.2 Commit Strategy

**Commit messages (tiếng Việt có dấu):**

```bash
git add apps/web-ui/src/features/programming/design/DesignWorkspacePage.tsx
git add apps/web-ui/src/features/programming/design/explorer/PouExplorerDock.tsx
git commit -m "feat(fbd): thêm layout grid 4-zone và POU Explorer dock

- Chuyển từ flexbox sang CSS Grid với left 196px + right 342px
- Tạo PouExplorerDock component với tree groups
- Responsive: drawers tại 1024px, tablet mode tại 768px
- Refs: Task 8 Steps 2.1-2.2"

git add apps/web-ui/src/features/programming/design/programs/ProgramsTab.tsx
git commit -m "feat(fbd): style lại POU tab bar theo reference design

- Active tab: white bg, #00796B top border
- Inactive tab: #F5F7FA bg
- Close button: x icon với hover state
- Refs: Task 8 Step 2.3"

git add apps/web-ui/src/features/programming/fbd/StructuredFbdEditor.tsx
git commit -m "feat(fbd): style lại sub-toolbar và thêm domain/datatype colors

- Sub-toolbar: 36px, segmented groups, dividers
- Block domain colors: logic/control/math/timer
- Wire datatype colors: BOOL/INT/REAL/TIME/untyped/error
- Minimap resize 160×100px
- Auto layout preview mode với Apply/Cancel
- Refs: Task 8 Step 2.4, Task 9 Steps 3.3-3.6"

git add apps/web-ui/src/features/programming/design/dock/LibraryInspectorDock.tsx
git commit -m "feat(fbd): thêm Library & Inspector dock 342px tabbed

- Tabbed dock: Quick Library + Inspector tabs
- Library: accordion categories, block cards với badges
- Inspector: inline editing, execution order, port config
- Refs: Task 8 Step 2.5"

git add apps/web-ui/src/features/programming/design/workbench/ProgrammingWorkbench.tsx
git add apps/web-ui/src/features/programming/design/workbench/StatusStrip.tsx
git commit -m "feat(fbd): cập nhật bottom workbench và thêm status strip

- Default open 162px (thay vì closed 120px)
- Tabs: Problems / Watch / Trace / Search / Cross Reference
- StatusStrip: nodes / wires / check / cycle / zoom / cursor
- ProblemsDrawer integration embedded mode
- Refs: Task 9 Steps 3.1-3.2, 3.7"

git add apps/web-ui/src/features/programming/design/**/*.test.tsx
git commit -m "test(fbd): thêm tests cho Task 8 & 9 changes

- Layout grid responsive tests
- POU Explorer selection tests
- Library/Inspector dock tests
- Block/wire color coding tests
- Minimap resize tests
- Auto layout preview tests
- Status strip tests
- Coverage ≥ 80%
- Refs: Task 8 Step 2.7, Task 9 Step 3.8"
```

### 4.3 Push & PR

```bash
# Push branch
git push -u origin feat/fbd-edit-task8-9-redo

# Create PR
gh pr create \
  --title "feat(fbd): tối ưu lại giao diện FBD Editor cho khớp reference design" \
  --body "## Mục tiêu
Làm lại (REDO) giao diện Tasks 8 và 9 của FBD EDIT feature để **khớp chính xác** với hình tham khảo \`PGM-02B_FBD_editor_reference.png\`.

## Thay đổi chính

### Task 8 — Layout & Controls
- ✅ Chuyển layout sang CSS Grid 4-zone (left 196px + center flex + right 342px + bottom 162px)
- ✅ Thêm POU Explorer dock persistent với tree groups: PROGRAMS / FUNCTIONS / FUNCTION BLOCKS / VARIABLES
- ✅ Style lại POU tab bar: active tab white bg + #00796B top border
- ✅ Style lại canvas sub-toolbar: 36px height, segmented groups với dividers
- ✅ Thêm Library & Inspector tabbed dock 342px
- ✅ Responsive: drawers tại breakpoints 1024px và 768px, mobile readonly <768px

### Task 9 — Workbench & Canvas Details
- ✅ Bottom workbench default open 162px với tabs: Problems / Watch / Trace / Search / Cross Reference
- ✅ Thêm Status Strip: nodes / wires / check / cycle / zoom / cursor
- ✅ Block domain color coding: Logic #4A90E2, Control #00897B, Math #7E57C2, Timer #FFA726
- ✅ Wire datatype color coding: BOOL green, INT blue, REAL orange, TIME purple, untyped gray, error red dashed
- ✅ Minimap resize 160×100px, positioned bottom-right
- ✅ Auto layout preview mode với Apply/Cancel buttons

## Kiểm tra

- ✅ tsc pass
- ✅ lint pass (bao gồm \`check:ui-strings\`)
- ✅ vitest pass (coverage ≥ 80%)
- ✅ build pass
- ✅ Bundle size ≤ 165.00 KiB gzip
- ✅ Visual verification: giao diện khớp reference image
- ✅ Responsive work ở 4 breakpoints: 1440px / 1280px / 1024px / 768px / <768px
- ✅ Functional: tất cả controls, tabs, drawers, colors hoạt động đúng
- ✅ Accessibility: keyboard navigation, screen reader labels, focus visible

## Screenshots

[Thêm screenshots so sánh before/after tại đây]

## Refs

- Reference: \`docs/04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/assets/PGM-02B_FBD_editor_reference.png\`
- Master plan: \`docs/superpowers/plans/2026-08-31-fbd-edit.md\` Task 8 (lines 597-648), Task 9 (lines 652-697)
- Implementation plan: \`docs/superpowers/plans/2026-09-09-fbd-edit-task8-9-implementation-plan.md\`
- Previous PRs: #576 (Task 8), #580 (Task 9) — đã merge nhưng UI không khớp reference, nên REDO

🤖 Generated with [Claude Code](https://claude.ai/claude-code)" \
  --base main
```

---

## 5. RISK MITIGATION & CONTINGENCY

### 5.1 Known Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Layout grid breaks existing flexbox** | Medium | High | Incremental testing sau mỗi bước; fallback to flexbox nếu grid không work |
| **Bundle size vượt 165 KiB** | Low | High | Tree-shaking imports; lazy load Library/Inspector; monitor size sau mỗi commit |
| **POU tab bar logic phức tạp hơn dự kiến** | Medium | Medium | Đọc ProgramsTab.tsx chi tiết trước; reuse existing logic; không refactor quá sâu |
| **Wire/block color coding ảnh hưởng performance** | Low | Medium | Use memoization (useMemo) cho color lookup; profiling với large graphs |
| **Responsive drawers UX không tốt** | Low | Low | User testing; fallback to simpler collapse pattern nếu drawer animation lag |
| **Minimap calculations sai với new dimensions** | Low | Medium | Test với graphs có 5, 25, 50, 100 nodes; verify viewport rectangle scale |
| **Auto layout preview confusing** | Low | Low | Clear visual distinction (dashed outline, opacity); tooltip "Preview mode" |
| **Test coverage không đạt 80%** | Low | Medium | TDD approach (write tests first); focus coverage trên new components |

### 5.2 Contingency Plans

**Nếu Task 8 Step 2.1 (grid layout) fail:**
- Rollback to flexbox approach
- Use fixed widths với flexbox instead of grid
- Trade-off: Less clean code, same visual result

**Nếu bundle size vượt budget:**
1. Lazy load Library/Inspector: `const LibraryInspectorDock = lazy(() => import('./LibraryInspectorDock'));`
2. Code-split POU Explorer: separate chunk
3. Remove unused icons/assets
4. Minify inline SVGs
5. Last resort: reduce feature scope (e.g., simplify Inspector)

**Nếu wire/block colors slow:**
- Cache color lookups trong Map
- Debounce re-renders khi nhiều changes
- Use canvas rendering thay vì SVG (trade-off: less crisp)

**Nếu tests không pass trong deadline:**
- Prioritize critical path tests (layout, tab switching, basic interactions)
- Defer coverage cho non-critical edge cases
- Document untested areas trong PR description

---

## 6. EXECUTION ORDER SUMMARY

**Cho Opus khi triển khai:**

```
SETUP
├─ git checkout main
├─ git pull origin main
├─ git checkout -b feat/fbd-edit-task8-9-redo
└─ cd MK-DDC-24/apps/web-ui

TASK 8 (Steps 2.1 → 2.7)
├─ 2.1 Layout Grid Foundation (DesignWorkspacePage.tsx + FbdEditorPane.tsx)
│     ├─ Write tests (failing)
│     ├─ Implement CSS Grid 4-zone
│     ├─ Run tsc + lint + vitest
│     └─ Webview verify
├─ 2.2 POU Explorer Dock (create PouExplorerDock.tsx + integrate)
│     ├─ Write tests (failing)
│     ├─ Implement component + tree groups
│     ├─ Style per reference
│     ├─ Run tsc + lint + vitest
│     └─ Webview verify
├─ 2.3 POU Tab Bar Re-styling (read ProgramsTab.tsx first, then modify)
│     ├─ Write tests (failing)
│     ├─ Apply reference styles
│     ├─ Run tsc + lint + vitest
│     └─ Webview verify
├─ 2.4 Canvas Sub-toolbar Re-styling (StructuredFbdEditor.tsx)
│     ├─ Write tests (failing)
│     ├─ Add dividers + update button styles
│     ├─ Run tsc + lint + vitest
│     └─ Webview verify
├─ 2.5 Library & Inspector Dock (create LibraryInspectorDock.tsx + integrate)
│     ├─ Write tests (failing)
│     ├─ Implement tabbed dock + panels
│     ├─ Run tsc + lint + vitest
│     └─ Webview verify
├─ 2.6 Responsive Behavior (update DesignWorkspacePage.tsx + FbdEditorPane.tsx)
│     ├─ Write tests (failing)
│     ├─ Implement breakpoint logic + drawers
│     ├─ Run tsc + lint + vitest
│     └─ Webview verify at 1440px / 1280px / 1024px / 768px / 500px
└─ 2.7 Task 8 Tests
      ├─ Ensure all tests pass
      ├─ Coverage ≥ 80%
      └─ Commit "feat(fbd): Task 8 complete"

MID-POINT VERIFICATION
├─ npm run build
├─ Check bundle size
├─ Visual comparison with reference
└─ If pass → proceed to Task 9; if fail → fix before continuing

TASK 9 (Steps 3.1 → 3.8)
├─ 3.1 Bottom Workbench Re-styling (ProgrammingWorkbench.tsx + DesignWorkbench.tsx)
│     ├─ Write tests (failing)
│     ├─ Update default state: open=true, height=162px
│     ├─ Verify all 5 tabs present
│     ├─ Apply reference styles
│     ├─ Run tsc + lint + vitest
│     └─ Webview verify
├─ 3.2 Status Strip (create StatusStrip.tsx + integrate)
│     ├─ Write tests (failing)
│     ├─ Implement component + data flow
│     ├─ Run tsc + lint + vitest
│     └─ Webview verify
├─ 3.3 Block Domain Color Coding (StructuredFbdEditor.tsx or FbdCanvas.tsx)
│     ├─ Write tests (failing)
│     ├─ Implement domain color mapping
│     ├─ Apply to block headers
│     ├─ Run tsc + lint + vitest
│     └─ Webview verify colors
├─ 3.4 Wire Datatype Color Coding (StructuredFbdEditor.tsx or FbdCanvas.tsx)
│     ├─ Write tests (failing)
│     ├─ Implement datatype color mapping
│     ├─ Apply to wire paths
│     ├─ Run tsc + lint + vitest
│     └─ Webview verify colors
├─ 3.5 Minimap Resize (StructuredFbdEditor.tsx + constants)
│     ├─ Write tests (failing)
│     ├─ Update FBD_MINIMAP_WIDTH = 160, FBD_MINIMAP_HEIGHT = 100
│     ├─ Verify positioning bottom-right
│     ├─ Run tsc + lint + vitest
│     └─ Webview verify
├─ 3.6 Auto Layout Preview (StructuredFbdEditor.tsx)
│     ├─ Write tests (failing)
│     ├─ Implement preview mode + Apply/Cancel
│     ├─ Run tsc + lint + vitest
│     └─ Webview verify
├─ 3.7 ProblemsDrawer Integration (ProgrammingWorkbench.tsx)
│     ├─ Write tests (failing)
│     ├─ Verify embedded mode
│     ├─ Add Mini Map tab (if needed)
│     ├─ Run tsc + lint + vitest
│     └─ Webview verify
└─ 3.8 Task 9 Tests
      ├─ Ensure all tests pass
      ├─ Coverage ≥ 80%
      └─ Commit "feat(fbd): Task 9 complete"

FINAL VERIFICATION (Section 4.1)
├─ npx tsc --noEmit → MUST PASS
├─ npm run lint → MUST PASS
├─ npm run check:ui-strings → MUST PASS
├─ npx vitest --run → MUST PASS (except known ShellNavigation failure)
├─ npm run build → MUST PASS
├─ Bundle size check → MUST ≤ 165.00 KiB
├─ Webview visual comparison → MUST match reference
├─ Responsive check 4 breakpoints → MUST work
├─ Functional check all features → MUST work
└─ Accessibility check → MUST pass basics

COMMIT & PR (Section 4.2-4.3)
├─ git add <files>
├─ git commit -m "<message>" (tiếng Việt có dấu, multiple commits OK)
├─ git push -u origin feat/fbd-edit-task8-9-redo
└─ gh pr create (as per template in 4.3)

DONE ✅
```

---

## 7. DEPENDENCIES GRAPH

```
Task 8 Dependencies:
2.1 Layout Grid Foundation
  └─ 2.2 POU Explorer Dock (depends on grid areas)
  └─ 2.5 Library & Inspector Dock (depends on grid areas)

2.3 POU Tab Bar Re-styling (independent, can parallel with 2.2 or 2.4)

2.4 Canvas Sub-toolbar Re-styling (independent, can parallel with 2.2 or 2.3)

2.6 Responsive Behavior
  └─ depends on 2.1-2.5 complete

2.7 Task 8 Tests
  └─ depends on 2.1-2.6 complete

Task 9 Dependencies:
3.1 Bottom Workbench Re-styling (independent of Task 8, but better after)

3.2 Status Strip (can parallel with 3.1 or after)

3.3 Block Domain Color Coding (independent)
  └─ 3.4 Wire Datatype Color Coding (can parallel or after 3.3)

3.5 Minimap Resize (independent)

3.6 Auto Layout Preview (independent)

3.7 ProblemsDrawer Integration
  └─ depends on 3.1 complete

3.8 Task 9 Tests
  └─ depends on 3.1-3.7 complete

Parallelizable steps:
- 2.3 || 2.4 (both independent)
- 3.3 || 3.4 || 3.5 || 3.6 (all independent canvas details)

Critical path (longest):
2.1 → 2.2 → 2.5 → 2.6 → 2.7 → 3.1 → 3.7 → 3.8 → Verification → PR
```

---

## 8. SUCCESS CRITERIA (CHECKLIST FOR OPUS)

**Trước khi tạo PR, Opus confirm:**

- [ ] **Layout:** CSS Grid 4-zone render đúng ở ≥1440px
- [ ] **POU Explorer:** Left dock 196px với tree groups visible
- [ ] **POU Tab Bar:** Active tab white bg + #00796B border, inactive #F5F7FA
- [ ] **Sub-toolbar:** 36px height, segmented groups, dividers visible
- [ ] **Library Dock:** Right dock 342px, tabs switch library ↔ inspector
- [ ] **Responsive:** Drawers work ở 1024px, tablet mode ở 768px, mobile readonly <768px
- [ ] **Workbench:** Bottom panel default open 162px, all 5 tabs visible
- [ ] **Status Strip:** Display nodes / wires / check / cycle / zoom / cursor
- [ ] **Block Colors:** Logic blue, Control teal, Math purple, Timer orange
- [ ] **Wire Colors:** BOOL green, INT blue, REAL orange, TIME purple, error red dashed
- [ ] **Minimap:** 160×100px, bottom-right, visible when nodes > 24
- [ ] **Auto Layout:** Preview mode work, Apply/Cancel functional
- [ ] **tsc:** Pass
- [ ] **lint:** Pass (including check:ui-strings)
- [ ] **vitest:** Pass (except known ShellNavigation failure)
- [ ] **build:** Pass
- [ ] **Bundle:** ≤ 165.00 KiB gzip
- [ ] **Visual:** Giao diện khớp reference image (side-by-side comparison)
- [ ] **Functional:** All controls work (zoom, pan, add/delete, tabs, drawers, etc.)
- [ ] **Accessibility:** Keyboard nav work, aria-labels present, focus visible

**Nếu tất cả checklist ✅ → Proceed to PR**  
**Nếu có ❌ → Fix before PR**

---

## 9. NOTES FOR OPUS

### 9.1 Đọc file trước khi sửa

**LUÔN đọc file trước khi modify:**
- DesignWorkspacePage.tsx (994 dòng) → đọc layout structure trước khi chuyển grid
- ProgramsTab.tsx (chưa biết dòng) → đọc POU tab bar implementation trước khi style
- StructuredFbdEditor.tsx (913 dòng) → đọc canvas/toolbar/minimap structure trước khi sửa
- ProgrammingWorkbench.tsx (583 dòng) → đọc tabs/state management trước khi update

### 9.2 Forbidden files — TUYỆT ĐỐI KHÔNG SỬA

- `ProgrammingHeader.tsx`
- `ProgrammingLayout.tsx`
- `contracts/**`
- `scripts/**`
- `apps/core/**`
- `apps/web-api/**`
- `firmware/**`
- `apps/web-ui/package.json`
- `apps/web-ui/.env.local`

### 9.3 Test assertions — KHÔNG LÀM YẾU

- Không delete/comment-out tests
- Không `.skip` / `.only` / `.todo`
- Không nới matcher (e.g., `toHaveBeenCalled` → `toHaveBeenCalledTimes(0)` để pass)
- Không empty-return mock
- Không render element trống/ẩn để pass `getByTestId`

### 9.4 Git operations — CHỈ LÀM THEO CHỈ DẪN

- Không `git add -A` / `git add .` → stage explicit paths
- Không `git reset --hard`, `git checkout -- <file>`, `git clean -fd`
- CHANGELOG.md: purely additive (0 deleted lines)
- Subagents KHÔNG chạy git commands (add/commit/push/gh/stash/checkout/restore/reset/clean)

### 9.5 Incremental validation

**Sau MỖI bước:**
```bash
cd MK-DDC-24/apps/web-ui
npx tsc --noEmit
npm run lint
npx vitest --run
# Nếu pass → webview verify → commit → next step
# Nếu fail → fix → re-verify → commit → next step
```

### 9.6 Webview verification

**Use webview skill sau mỗi major change:**
```
1. Invoke webview skill
2. Navigate to FBD Editor page
3. Take screenshot
4. Compare with reference image side-by-side
5. Note discrepancies
6. Fix if needed
7. Re-verify
```

### 9.7 Bundle size monitoring

**Check sau mỗi commit lớn:**
```bash
npm run build
cd dist/assets
ls -lh programming-*.js.gz
# If > 165 KiB → investigate và optimize
```

### 9.8 UI strings tiếng Việt

**TẤT CẢ UI strings phải tiếng Việt có dấu:**
- Button labels: "Thêm", "Lưu", "Kiểm tra", "Hủy", "Áp dụng"
- Tab names: "Vấn đề", "Theo dõi", "Vết lại", "Tìm kiếm", "Tham chiếu chéo"
- Tooltips: tiếng Việt
- Error messages: tiếng Việt
- `npm run check:ui-strings` MUST pass

### 9.9 Colors reference (quick lookup)

**Palette IDE:**
- Canvas: #FCFCFC
- Panels: #FFFFFF
- Borders: #E2E6EA
- Text: #1E293B
- Accent: #00796B
- Success: #2E7D32
- Warning: #ED6C02
- Error: #D32F2F

**Block domain colors:**
- Logic: #4A90E2
- Control: #00897B
- Math: #7E57C2
- Timer: #FFA726

**Wire datatype colors:**
- BOOL: #2E7D32
- INT/DINT: #1565C0
- REAL/FLOAT: #E65100
- TIME: #6A1B9A
- Untyped: #9E9E9E
- Error: #D32F2F (dashed)

---

## 10. DOCUMENT HISTORY

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-09-09 | Fable 5 | Initial plan created từ khảo sát 3 Sonnet agents |

---

**END OF PLAN**

Plan này đủ chi tiết để Opus đọc và triển khai trực tiếp mà không cần lập lại kế hoạch hay khảo sát thêm. Mỗi bước có:
- Mục tiêu rõ ràng
- Files cần sửa
- Chi tiết thay đổi (code examples, specs)
- Dependencies
- Rủi ro & mitigation
- Cách kiểm tra
- Definition of Done

Opus chỉ cần follow từng bước theo thứ tự trong Section 6, verify sau mỗi bước, và commit khi xong.