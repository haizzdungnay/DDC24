# FBD EDIT Workspace — Detailed Design MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `DDD-PGM02-FBD-EDIT-001` |
| Phiên bản | 0.4 |
| Trạng thái | `M3 — REVIEW READY` (Target, chưa phải As-Built; reviewer độc lập vòng 3 `APPROVED WITH RESIDUALS`) |
| Ngày | 2026-08-31 |
| Chủ quản | Programming FE / UX |
| Người review | FE platform, Programming compiler/runtime consumer, QA |
| Người phê duyệt | Product Owner + System Architect (TBD cho hồ sơ baseline) |
| Nguồn | `PGM02-V22-WP-05`, `T59-806`, PGM-02B FE Handoff v2.2, DDD PGM-02, Node-RED/Blockly/React Flow/Rete docs |
| Requirement | `AC-FBD-001..012`, `AC-PGM02-001..010`, `DDO-PGM02-007`, `DDO-PGM02-015` |
| Phạm vi | FBD `EDIT`, FE-only trong `apps/web-ui`; chưa triển khai LIVE/SIMULATE, BE, Core, firmware |
| Increment/NFR gate | Cổng thi hành: **R3 165 KiB gzip** (`apps/web-ui/package.json:28` pin `--increment r3`). Mốc R1 125 KiB là **mốc lịch sử của increment đã đóng**, không phải cổng chặn — `UD-PROG-017` CLOSED 2026-09-05. Mốc cảnh báo mềm 145 KiB là quy ước tài liệu, không cài vào script |

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Đặc tả chi tiết nâng FBD EDIT thành workspace kéo-thả node-edge theo ảnh tham chiếu, giữ contract FBD canonical và giao diện Programming hiện tại. |
| 2. Ai phải đọc file này? | FE implementer, UX, QA, compiler/runtime consumer và người duyệt thay đổi PGM-02. |
| 3. Hệ thống hiện tại đang có gì? | Đã có `FbdDocument`, schema v1, reducer undo/redo, SVG node-edge, palette/registry, Quick Library, Inspector và minimap; chưa có đầy đủ viewport/selection/DnD/dock parity. Dẫn chứng ở §2. |
| 4. Thiết kế mới thay đổi điều gì? | Tách canonical/transient/preference state; bổ sung pointer DnD, wire preview, pan/zoom/grid/snap, multi-select, copy/paste, Auto Layout preview, dock responsive, theme và Inspector FBD. |
| 5. Team phải sửa module hoặc contract nào? | Chủ yếu `apps/web-ui/src/features/programming/fbd/*`, `design/editor/*`, `design/library/*`, `design/inspector/*`; không đổi schema/API/BE/Core trong lát này. Bảng đầy đủ ở §10. |
| 6. Điều gì còn bị chặn? | Spike thư viện canvas, `variableId` canonical, bundle increment, browser/target evidence và PID approval; error-catalog drift đã được kiểm tra lại ở baseline hiện tại nhưng vẫn phải đo lại trong CI. Mỗi blocker có owner/gate/điều kiện ở §12. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | Unit/component/E2E/axe/browser matrix, fixture 256 node/512 wire, canonical round-trip, bundle/pointer budget và diff allowlist; ma trận ở §10. |

## 1. Mục tiêu, actor và phạm vi — `DD-02`

### 1.1 Outcome

Kỹ sư có thể mở một POU FBD, tìm block trong Quick Library, kéo block vào đúng
network, kéo hoặc chạm để nối các port tương thích, chỉnh tham số trong Inspector,
sắp xếp sơ đồ, lưu Draft và hiểu lỗi bằng Problems. Bề mặt phải giống tinh thần
ảnh tham chiếu nhưng dùng token và shell hiện tại của DDC-24.

Chuỗi chính:

`Chọn POU FBD → chọn network → tìm block → kéo/thả → nối port → cấu hình → Check`

### 1.2 Actor và use case

| Actor | Use case | Quyền trong lát này |
|---|---|---|
| `admin` | Tạo/sửa/lưu Draft FBD, kéo/thả, nối, xóa, copy/paste, căn chỉnh | Mutation khi viewport cho phép |
| `viewer/operator/engineer` | Xem/chọn graph, mở Inspector/Problems/Library metadata | Read-only nếu không có quyền mutation từ server |
| Kỹ sư tablet | Dùng touch/stylus để pan, zoom, kéo node, nối port | Mutation từ `768px` trở lên |
| Người dùng điện thoại | Xem/chọn và đọc các panel | Read-only dưới `768px` |

### 1.3 Trong phạm vi

- FBD EDIT trên route Programming hiện tại; giữ nút tạo `+ FBD` trong `PouExplorer`.
- Canvas SVG hiện có, tổ chức lại thành các layer có viewport transform.
- Quick Library dùng toàn bộ entry registry/compiler hiện tại; `PID` hiện nhưng
  `REVIEW_REQUIRED` và disabled.
- DnD bằng Pointer Events; HTML Drag and Drop chỉ là đường tương thích desktop.
- Pan/zoom/fit, grid/snap, Orthogonal/Bezier. `Khung nhìn` đơn/tất cả còn ở
  giao diện nhưng chỉ còn một Network để hiển thị — xem §5.1.1.
- Multi-select, marquee, kéo nhóm, copy/paste nội bộ, delete, align/distribute,
  Auto Layout preview → Apply.
- Inspector dock phải, I/O picker từ nguồn FE hiện có, bottom workbench và Mini Map.
- Theme FBD `Sáng`/`Tối`/`Theo giao diện web`; preference local có version.
- Test host/browser cho desktop, tablet và điện thoại read-only.

### 1.4 Ngoài phạm vi

- Không đổi `contracts/programming/fbd_v1.schema.json`, OpenAPI, BE Go, Core C++,
  firmware, compiler semantics, runtime output hoặc Simulation.
- Không thêm PLCopen XML/import-export trong lát này.
- Không tự tạo `variableId` nếu schema/API hiện tại chưa có; không tạo Mapping ẩn.
- Không thêm block ngoài registry/compiler; không mở khóa `PID` khi thiếu approval.
- Không dùng runtime value giả trong EDIT.
- Không đưa `@xyflow/react`, Rete hoặc Blockly vào bundle sản phẩm nếu spike chưa
  qua gate; mặc định vẫn SVG-first.

### 1.5 Ràng buộc và tiêu chí thành công

- Canonical FBD là nguồn sự thật; layout là presentation và compiler bỏ qua.
- Một thao tác người dùng đã xác nhận tạo đúng một undo entry.
- Invalid wire/drop zero mutation; graph thiếu vẫn có thể Save Draft.
- Không thay đổi `executionOrder` khi kéo hoặc căn chỉnh hình học.
- Không trộn Draft với Active/LIVE; không khẳng định runtime khi nguồn vắng.
- `pointerToPaintP95Ms ≤ 32 ms`, bundle không vượt cổng thi hành R3 (165 KiB
  gzip; mốc R1 125 KiB là mốc lịch sử — `UD-PROG-017` CLOSED 2026-09-05),
  fixture tối đa `256 nodes/512 wires` không tràn hoặc crash.

## 2. As-Built và khoảng trống — `DD-03`

Đọc source tại `main@8a26c5d5df4e067f8ee83ece6470e93bdd38e4e1` ngày
2026-08-31. Worktree khi khảo sát **không sạch**: ba file FE thuộc yêu cầu UI
trước đó (`apps/web-ui/e2e/programming.spec.ts`, `ProgrammingHeader.tsx`,
`ProgrammingLayout.tsx`) và các file gate ngoài lát FBD của người dùng. Hồ sơ
không dùng thay đổi Core/script gate làm evidence và không tuyên target đã
triển khai. Candidate baseline chỉ hình thành sau khi spec/assets được commit;
SHA commit đó phải thay thế snapshot này trong revision kế tiếp.

| Nội dung | As-Built | Gap so với Target |
|---|---|---|
| Canonical model | `apps/web-ui/src/features/programming/fbd/model.ts` khai `FbdDocument`, `FbdNetwork`, `FbdNode`, `FbdPort`, `FbdWire`, `FbdLayout`; validator kiểm type/direction/unit/UUID/limits. | Không thiếu model nền; cần giữ nguyên và mở rộng action theo transaction. |
| Schema/compiler boundary | `contracts/programming/fbd_v1.schema.json` yêu cầu root/networks/nodes/ports/wires; `layout` tùy chọn và là presentation. | Không được thêm field tùy tiện; `variableId` chưa tồn tại. |
| Reducer | `fbd/commands.ts` có `createFbdEditorState`, `fbdEditorReducer`, SELECT, ADD/DELETE/MOVE/UNDO/REDO và nối keyboard. | Selection hiện là một phần tử; chưa có selection set, clipboard, group transaction hoặc wire preview pointer. |
| Canvas | `fbd/FbdCanvas.tsx` vẽ SVG node-edge, pointer kéo một node, zoom nút và minimap. | Chưa có pan, grid/snap, fit-to-view, orthogonal route, multi-select/marquee, kéo palette vào canvas, tap-to-tap. |
| Editor shell | `fbd/StructuredFbdEditor.tsx` dựng header/palette/forms, render mọi network dọc và Inspector node dưới canvas. | Chưa có shell 4 dock theo ảnh; palette còn `<select>`, Inspector chưa gom về dock phải. |
| Quick Library | `design/library/QuickLibraryPanel.tsx` có catalog, category, Recent/Favorites và `LIBRARY_DRAG_TYPE`; `onDragStart` ghi `entryId`. | FBD host hiện click insertion; chưa có drop target/toạ độ graph và pointer fallback. |
| Registry | `contracts/programming/pou_library_registry_v1.json` có 46 entry; 45 `AVAILABLE`, `PID` `REVIEW_REQUIRED`; generator tạo `apps/web-ui/src/features/programming/api/generated/library_registry.ts`. | Cần presentation card/disabled policy thống nhất khi kéo/chọn. |
| POU creation | `design/pou/PouExplorer.tsx` có icon tạo FBD gọi `create('PROGRAM','FBD')`. | Giữ nguyên, không thêm menu tạo POU thứ hai. |
| Inspector | `design/inspector/ContextInspector.tsx` có context `FBD_BLOCK`/`FBD_CONNECTION`, đọc selection từ `ProgramsTab`. | FBD parameter form còn nằm inline trong `StructuredFbdEditor`; cần một đường selection/inspection không nhân bản state. |
| Workspace | `design/editor/ProgramsTab.tsx` có `FbdEditorPane`, `PouTabBar`, shared right Inspector và `DesignWorkbench`. | FBD pane chưa đạt ảnh mục tiêu; cần slot/dock responsive và bottom states rõ ràng. |
| Contract/design authority | `PGM-02B_FBD_EDITOR_FE_HANDOFF_v2_2.md`, `PROGRAMMING_PGM02_WORKSPACE_DETAILED_DESIGN.md`, `PGM02_ST_FBD_IMPLEMENTATION_PLAN.md`. | Handoff là target, không phải bằng chứng as-built; phải giữ nhãn evidence class. |
| NFR | `contracts/programming/pgm02_workspace_v1.json` pin `256/512`, pointer p95 32 ms, bundle budgets R1 125/R2 145/R3 165 KiB. | Số release đã ghi ở `CHANGELOG.md` là 162.37/165 KiB. Phép đo local riêng tại snapshot trên bằng `npx vite build` + verifier là 157.20 KiB (R3 dư 7.80; **R1 vượt 32.20**). Hai số khác build mode/worktree nên không thay thế nhau; mọi lát phải đo lại bằng build release/candidate sạch. **Cập nhật 2026-09-05 (`UD-PROG-017` CLOSED):** cổng thi hành là R3 165 KiB; R1 125 KiB là mốc lịch sử của increment đã đóng, không còn là blocker. Số đo cuối của lát: 128,54 KiB ⇒ R3 PASS, dư 36,46 KiB. |

### 2.1 Snapshot phép đo local

| Mục | Giá trị |
|---|---|
| Git source | `8a26c5d5df4e067f8ee83ece6470e93bdd38e4e1` + ba file FE local nêu trên |
| Vite command | `cd apps/web-ui; npx vite build` |
| Output | `programming-BP6ey2B3.js`, Vite báo 162.30 kB gzip; verifier zlib level 6 báo 157.20 KiB/160.97 kB |
| Gate R3 | `python scripts/verify_programming_bundle_budget.py --increment r3` → PASS, dư 7.80 KiB |
| Gate R1 | cùng script `--increment r1` → FAIL, vượt 32.20 KiB |
| Error catalog | `$env:PYTHONUTF8='1'; python scripts/generate_programming_errors.py --check` → PASS, 38 public/155 detail, SHA-256 `39bf243a...b45dabe` |
| Evidence class | `HOST LOCAL`, dirty worktree; không phải release/target/HIL evidence |

### 2.2 Bằng chứng khảo sát bên ngoài

Đây là nguồn tham khảo interaction, không phải authority của contract MK-DDC-24.

| Nguồn | Fact đã kiểm tra | Hệ quả thiết kế |
|---|---|---|
| [Node-RED workspace](https://nodered.org/docs/user-guide/editor/workspace) | Palette kéo node, tabs, zoom footer và navigator. | Dùng pattern palette + navigator, nhưng giữ shell DDC. |
| [Node-RED wires](https://nodered.org/docs/user-guide/editor/workspace/wires) | Kéo port để nối; `Ctrl` hỗ trợ click-click; có di chuyển/ngắt wire. | Giữ cả drag và tap/click-click, nhưng validation FBD nghiêm hơn. |
| [Node-RED selection](https://nodered.org/docs/user-guide/editor/workspace/selection) | `Ctrl` chọn nhiều, lasso, chọn connected/upstream/downstream. | Dùng multi-select/marquee làm baseline; không tự suy dependency khi paste. |
| [Node-RED arranging](https://nodered.org/docs/user-guide/editor/workspace/arrange) | Align/distribute có action riêng và shortcut. | Đưa align/distribute vào toolbar, commit một transaction. |
| [Blockly toolbox](https://docs.blockly.com/guides/configure/toolboxes/toolbox) | Toolbox flyout/category là nơi lấy block. | Tham khảo category/search; không dùng Blockly canvas vì sai mô hình node-edge. |
| [Blockly zoom](https://docs.blockly.com/guides/configure/zoom) | Có controls, wheel, pinch và min/max scale. | Hỗ trợ zoom nút/wheel/pinch với giới hạn contract. |
| [React Flow drag/drop](https://reactflow.dev/examples/interaction/drag-and-drop) | Native DnD dễ làm; Pointer Events phù hợp nhiều thiết bị; HTML DnD hạn chế touch. | SVG implementation dùng Pointer Events; native DnD chỉ fallback. |
| [React Flow viewport](https://reactflow.dev/learn/concepts/the-viewport) | Có các mode pan/zoom/selection kiểu design tool, middle/right/space. | Chọn gesture tương tự, nhưng state vẫn thuộc reducer FE. |
| [Rete editor](https://retejs.org/docs/concepts/editor) | Area/connection/selection là plugin tách rời. | Không chọn làm đường chính vì plugin/adapter và budget. |
| [IEC 61131-3 publication](https://webstore.iec.ch/en/publication/4552) | IEC mô tả FBD là một trong các ngôn ngữ đồ họa của PLC. | Chỉ dùng để định hướng thuật ngữ; profile/compiler của repo mới là authority. |

## 3. Thiết kế mục tiêu và quyền sở hữu — `DD-04`

### 3.1 Cây component

```text
FbdEditorPane
└── FbdWorkspaceShell
    ├── FbdWorkspaceToolbar
    ├── FbdNetworkExplorer
    ├── FbdCanvasViewport
    │   ├── FbdGridLayer
    │   ├── FbdWireLayer
    │   ├── FbdNodeLayer
    │   ├── FbdSelectionLayer
    │   └── FbdConnectionPreview
    ├── FbdQuickLibraryDock
    ├── FbdInspectorDock
    └── FbdBottomWorkbench
```

Tên trên là boundary target; có thể gộp file khi module nhỏ nhưng không gộp
canonical state với presentation state.

### 3.2 Ownership

| State | Owner | Consumer | Được phép thay đổi bởi | Commit? |
|---|---|---|---|---|
| `FbdDocument` | `fbdEditorReducer`/editor host | Canvas, Inspector, Save, Problems | Domain action hợp lệ | Có |
| `selectionSet` | Canvas selection controller + reducer adapter | Node/wire/Inspector/toolbar | Click, marquee, keyboard | Không, trừ action xóa/copy context |
| `viewport` | Canvas viewport controller | Grid/wire/node/minimap | Pan/zoom/fit | Không |
| `wirePreview` | Canvas pointer controller | Preview layer, status | Pointer/tap/Escape | Không |
| `layoutPreview` | Auto-layout controller | Overlay, Apply/Cancel | Auto Layout/align/distribute | Chỉ Apply |
| `clipboard` | FBD clipboard adapter | Paste action | Copy/Cut | Không; Paste có |
| UI preference | `fbdPreferences` versioned local store | Shell/dock/theme/canvas | User controls | Không |
| remote Draft/ETag | Existing `useDraftWorkspace`/API | Save/conflict | Existing Save path | Có ở BE, ngoài lát FE |

### 3.3 Luồng dữ liệu

```text
Quick Library entryId
        │
        ▼
FBD insertion adapter ──(registry + selected network + graph position)──► ADD_NODE
        │                                                        │
Pointer/tap port ──► validation (direction/type/unit/fan-in) ───► ADD_WIRE
        │                                                        │
Canvas drag/marquee/toolbar ──► transaction adapter ────────────► reducer
                                                                       │
                                                                       ▼
                                                           canonical FbdDocument
                                                                       │
                                              onChange → existing Draft buffer/Save
```

Không có nhánh Canvas → API trực tiếp. API chỉ nhận canonical source qua đường
`FbdEditorPane` hiện có.

### 3.4 Failure boundary

- Lỗi mapping screen→graph, pointer cancel hoặc drop ngoài scene chỉ hủy transient.
- Lỗi canonical/validation trước reducer trả announcement/Problems, không mutate.
- Lỗi Save/ETag giữ buffer local và hiển thị Conflict; không tự merge hoặc ghi đè.
- Không có đường gọi BE/Core mới trong lát này; thiếu dữ liệu contract là blocker.

## 4. Mô hình dữ liệu từng field — `DD-05`

### 4.1 Canonical không đổi

| Field | Type | Unit | Required | Default/range | Null/Unknown | Key/validation | Lifecycle/version |
|---|---|---|---|---|---|---|---|
| `FbdDocument.networks` | `FbdNetwork[]` | — | có, 1..256 | — | null không hợp lệ | UUID/order/name theo schema v1 | Draft source, schema v1 |
| `FbdNode.id` | canonical UUID string | — | có | server/FE UUID mới | null không hợp lệ | unique toàn document | giữ khi move; đổi khi paste |
| `FbdNode.executionOrder` | integer | — | có | 0..255, unique network | không suy từ x/y | reducer reorder only | semantic, không đổi bởi layout |
| `FbdPort.id` | canonical UUID string | — | có | — | null không hợp lệ | unique, order 0..15 | giữ khi type đổi nếu hợp lệ |
| `FbdWire.id` | canonical UUID string | — | có | — | null không hợp lệ | unique; endpoint tồn tại | đổi khi paste; xóa khi disconnect |
| `FbdLayout.nodes[id].x/y` | finite number | graph px | tùy chọn | `-100000..100000` | layout thiếu = auto layout | node key phải UUID | presentation; compiler bỏ qua |
| `parameters.variable` | identifier string | — | tùy kind | user/picker cung cấp | thiếu = validation issue | `isFbdIdentifier` | giữ tên; không tự thêm ID |

### 4.2 Transient state

| Field | Type | Default | Range/semantics | Persist |
|---|---|---|---|---|
| `viewport.x/y` | finite number | 0 | bounded để tránh overflow | Không |
| `viewport.scale` | number | 1 | 0.4..2.5 | Không (có thể lưu UI preference nếu user bật) |
| `selectionSet` | `Set<string>` + kind map | rỗng | node/wire/port cùng network; network view rõ | Không |
| `wirePreview` | source endpoint + pointer graph point | null | chỉ một source tại một thời điểm | Không |
| `marqueeRect` | `{x,y,width,height}` | null | graph coordinates | Không |
| `layoutPreview` | `Record<UUID,FbdPoint>` | null | finite/snap; chưa canonical | Không |
| `clipboard` | nodes + internal wires + source network | null | max selection/limits của document | Không; session-memory only |

### 4.3 Preference schema v1

Key đề xuất: `mkddc:fbd-preferences:v1:<userScope>:<projectId>`.

| Field | Type | Default | Enum/range | Unknown/corrupt | Lifecycle |
|---|---|---|---|---|---|
| `schemaVersion` | literal `1` | 1 | 1 | bỏ toàn bộ preference về default | migrate bằng version key |
| `dock.explorer/library/inspector/workbench` | boolean | true | true/false | true | local, user+project |
| `theme` | enum | `FOLLOW_WEB` | `LIGHT/DARK/FOLLOW_WEB` | `FOLLOW_WEB` | không gửi BE |
| `wireStyle` | enum | `ORTHOGONAL` | `ORTHOGONAL/BEZIER` | `ORTHOGONAL` | presentation |
| `gridVisible` | boolean | true | true/false | true | presentation |
| `snapEnabled` | boolean | true | true/false | true | presentation |
| `snapSize` | integer | 8 | 4/8/16/32 | 8 | presentation |
| `networkView` | enum | `SELECTED` | `SELECTED/ALL` | `SELECTED` | presentation |
| `marqueeMode` | boolean | false | true/false | false | tablet toolbar state, reset per session |

Preference không tham gia `canonicalFbdJson`, artifact hash, Check hoặc Draft
ETag. Nếu localStorage bị chặn, dùng memory default và ghi trạng thái không lưu.

## 5. Interface và contract — `DD-06`

### 5.1 FE interfaces target

Các interface này là type/module boundary FE; không phải API public mới.

```ts
type FbdViewMode = 'SELECTED' | 'ALL'
type FbdWireStyle = 'ORTHOGONAL' | 'BEZIER'
type FbdTheme = 'LIGHT' | 'DARK' | 'FOLLOW_WEB'

interface FbdViewport { x: number; y: number; scale: number }
interface FbdPoint { x: number; y: number }
interface FbdSelectionSet {
  nodes: string[]
  wires: string[]
  ports: string[]
  /** Network của selection hiện hành; null khi chưa chọn. */
  networkIds: string[]
  /** Scene đích cho mutation/drop; luôn phải có ở EDIT. */
  activeNetworkId: string | null
}
interface FbdDropRequest {
  entryId: string
  networkId: string
  graphPoint: FbdPoint
}
```

`FbdDropRequest` phải được kiểm tra entry tồn tại trong `FBD_PALETTE`, network
tồn tại và graph point finite trước khi dựng node.

### 5.1.2 FE action payloads target

| Action | Payload | Thành công | Reject/no-op |
|---|---|---|---|
| `ADD_NODE` | `{ networkId, node, position }` | 1 node + layout entry, 1 history | network/UUID/limit/position sai → 0 |
| `ADD_WIRE` | `{ networkId, wire }` | 1 wire, 1 history | validator sai → 0 |
| `MULTI_MOVE` | `{ networkId, moves[], expectedSelectionRevision }` | tất cả vị trí, 1 history | bất kỳ node/bounds/revision sai → toàn batch 0; mọi vị trí cũ → no-op |
| `PASTE_SUBGRAPH` | `{ targetNetworkId, nodes[], wires[], offset }` | remap graph đầy đủ, 1 history | UUID/endpoint/limit sai → toàn batch 0 |
| `DELETE_SELECTION` | `{ networkId, nodeIds[], wireIds[] }` | xóa node/wire liên quan, 1 history | selection rỗng/sai network → 0 |
| `SET_LAYOUT_BATCH` | `{ networkId, positions[], expectedSelectionRevision }` | layout mới, 1 history | bất kỳ position/revision sai → toàn batch 0 |

Các action trên là **FE reducer action**, không phải tên operation HTTP. Mọi
action mutation phải chạy qua cùng `canEdit`/viewport guard ở adapter và cùng
validator ở reducer; không có đường bypass từ JSX hoặc thư viện canvas.

### 5.1.1 Network view `ALL` và hit-test

> **SUPERSEDED 2026-09-12 — mô hình MỘT canvas (`#674`, quyết định chủ sở hữu
> `owner-decision-20260912T0300Z`).** Phần dưới mô tả bản nhiều Network và giữ
> lại vì reducer/schema vẫn theo nó; nhưng SẢN PHẨM không còn đường tạo Network
> thứ hai, nên các tình huống "nhiều scene", "selection trộn network" và "paste
> từ network khác" hiện KHÔNG ĐẠT TỚI ĐƯỢC qua giao diện. Hợp đồng đang thi
> hành là §5.1.1a.

#### 5.1.1a Mô hình MỘT canvas — hợp đồng đang thi hành

| Điều | Quy định |
|---|---|
| Số Network soạn được | Đúng một: `networks[0]`. Không có badge đếm network, không có badge `Network đang mở`, không có nút thêm Network trên `toolbar` FBD. |
| Phím `Control+Shift+n` | Vẫn nằm trong `contracts/programming/fbd_keyboard_commands_v1.json` (contract chưa đổi), nhưng editor trả lời "FBD dùng mô hình một canvas: không tạo Network mới" và **không phát mutation**. Bỏ mục này khỏi contract là việc của bản `v2` — cần chủ sở hữu quyết. |
| Schema và dữ liệu | KHÔNG đổi. `contracts/programming/fbd_v1.schema.json` vẫn cho `networks` 1..256; `data-fbd-network-id` giữ nguyên; canonical JSON giữ nguyên. |
| Tài liệu có `networks.length > 1` | Mở được, hiển thị đủ mọi Network, nhưng **chỉ đọc**: `canEdit` bị tắt tại nguồn nên `mutationAllowed` chặn mọi action ở reducer ⇒ **0 mutation** phát ra. Editor nêu lý do đọc được (`data-testid="fbd-multi-network-lock"`). |
| Dữ liệu thừa | **Tuyệt đối không tự xóa hoặc gộp Network.** Người dùng tách thủ công thành các POU một Network rồi mở lại. |
| Bằng chứng | `StructuredFbdEditor.test.tsx` `AC-674-2`/`AC-674-4` (vitest, HOST); `TC-FBD-RESP-001` trong `apps/web-ui/e2e/programming.spec.ts` khoá "không còn lối vào nhiều Network, cả hai khung nhìn đều đúng một article". Mốc cũ "ALL → 2 article" không còn dựng được qua UI nên chuyển hẳn sang lane vitest. |

Mỗi scene trong chế độ `ALL` mang `data-fbd-network-id` và một geometry origin
riêng. `pointerdown`, drop và Problems jump lấy `networkId` từ scene DOM đã được
đăng ký; không suy network từ x/y toàn trang. `activeNetworkId` là network đích
duy nhất của drop/Auto Layout/Apply. Selection có thể đánh dấu node ở nhiều
network để đọc, nhưng mọi mutation nhóm (`MULTI_MOVE`, delete, align/distribute)
chỉ chạy khi tất cả node cùng một network; selection trộn network bị từ chối
nguyên tử với lý do `Chỉ thao tác nhóm trong cùng network`. Wire luôn bị giới
hạn trong cùng network theo schema hiện tại. Paste từ clipboard khác network
phải chọn network đích rõ ràng trước khi commit.

### 5.2 Existing transport boundary

- Read Draft/project/capability/library/point catalog dùng hooks và generated
  client hiện tại; canvas không gọi `fetch` mới.
- `useDraftWorkspace.save` hiện gọi operation `updateProgrammingDraft` (PATCH
  `/api/v1/programming/projects/{projectId}/draft`), body envelope
  `schemaVersion=1.0`, `baseRevisionId` và operations; request mang `If-Match`,
  `X-Idempotency-Key` và `X-Correlation-ID`. Response phải giữ `resource`,
  `etag`, `auditId`, `correlationId`; FE cập nhật từ read-back, không optimistic
  suy nội dung.
- `updateProgrammingDraft` cho role `engineer/admin`; UI FBD chỉ mở mutation khi
  `canEdit` và viewport policy cho phép. Server/RBAC vẫn là authority cuối.
- As-Built `ProgrammingApiClient.request` nhận `AbortSignal` nhưng chưa tự đặt
  timeout/retry; `useDraftWorkspace` không tự retry mutation và phân biệt 409
  thành `conflict`. Đây là hành vi phải giữ trong lát này.
- Trong lát FE-only này, FBD interaction không phát request mới. Save/Check giữ
  đúng transport hiện có: `ProgrammingApiClient.request` chưa đặt timeout mặc định,
  `useDraftWorkspace` không tự retry mutation, còn Check poll mỗi 1.500 ms và
  không tự retry khi timeout. Vì vậy UI phải nói `Không xác định được/đang chờ
  xác nhận` khi request chưa có kết quả; không tự gắn 15 s hay tự gửi lại. Việc
  bổ sung timeout transport là blocker riêng `BLK-FBD-006`, không được lẫn vào
  implementation FBD bằng cách đoán.
- Mỗi lần người dùng chủ động Save/Retry sau read-back tạo idempotency key mới;
  không retry âm thầm với key mới, không replay khi request result chưa biết.
  Conflict 409/412/428 dùng `PRG-ERR-CONFLICT-001` và giữ buffer.
- Không thêm audit FE riêng: hiển thị/giữ `auditId` + `correlationId` trong status
  hoặc log chẩn đoán đã redact; không log token/source đầy đủ.

### 5.2.1 Check và diagnostic freshness

- `Check` là hành động cấp package hiện có: Draft phải sạch (đã Save), workflow
  seal Revision rồi tạo Check job và poll; FBD editor không tự gọi Check khi kéo.
- Nút Check ở shared header là action duy nhất; FBD local toolbar không nhân bản.
  Khi Draft dirty, nút disabled với lý do `Lưu bản nháp trước khi Kiểm tra`.
- Local `validateFbdDocument` chạy trên canonical buffer để marker tức thời. Nếu
  server diagnostic thuộc Revision/hash cũ và buffer đã đổi, hiển thị nhãn
  `STALE DIAGNOSTIC`, không gạch như lỗi hiện tại; Save/Check thành công mới nhận
  diagnostic revision mới.
- Check response/error dùng `programmingErrorCopy` và mã catalog hiện có; không
  nuốt `PRG-ERR-*` thành một câu chung. Timeout là UNKNOWN, không phải PASS/FAIL.

### 5.3 Quick Library contract

- `LIBRARY_DRAG_TYPE = application/x-mkddc-library-entry` được giữ tương thích.
- Card `AVAILABLE` có thể drag/click-place; `REVIEW_REQUIRED` hiển thị lý do và
  không phát `FbdDropRequest`.
- Insertion tạo node bằng cùng factory với toolbar; một placement = một undo.
- Không auto-connect khi drop; chỉ nối qua explicit wire action.

Pointer DnD là đường chính cho mouse/touch/pen. Native HTML DnD chỉ được bật
trên card khi `pointerType=mouse`; card đặt `effectAllowed=copy` và payload
`LIBRARY_DRAG_TYPE`. Canvas chấp nhận đúng một trong hai channel cho mỗi gesture:
`nativeDragSessionId` hoặc `pointerDragSessionId`; khi một channel đã commit hoặc
cancel thì channel kia bị vô hiệu trong cùng frame, tránh chèn block hai lần.
`screenToGraph()` trừ bounding rect của scene, đảo viewport transform, rồi áp
snap/bounds; không dùng tọa độ page toàn document.

### 5.4 Spike dependency gate

> **Ghi chú 2026-09-05.** Spike này **đã đóng bằng SVG-first** theo mục 6 bên
> dưới; không dependency nào được thêm. Vì vậy toàn bộ điều kiện 1–5 là tiêu chí
> lịch sử của một spike **không thực hiện** — con số 125 KiB ở mục 5 giữ nguyên
> làm bằng chứng truy nguyên, **không** phải cổng đang thi hành. Cổng thi hành
> của repo là R3 165 KiB (`UD-PROG-017` CLOSED).

Spike `@xyflow/react` (nếu thực hiện) phải nằm ngoài product dependency trước khi
đạt tất cả điều kiện:

1. MIT license và attribution policy được ghi.
2. Adapter một chiều, không có shadow canonical graph.
3. Touch/stylus/keyboard/axe đạt parity.
4. 256 node/512 wire không vượt p95 pointer 32 ms hoặc heap gate.
5. Chunk incremental không vượt budget `R1_EDIT` 125 KiB gzip (đây là lát FBD
   EDIT; không dùng trần R3 để che một lần vượt R1).
6. Nếu fail, bỏ spike; SVG-first là kết quả hợp lệ, không mở decision mới.

## 6. State, thuật toán và timing — `DD-07`

### 6.1 Workspace state machine

```text
BOOT
  └─ resolve Draft/POU/role/capability
       ├─ no source/invalid identity → UNAVAILABLE (read-only)
       └─ EDIT
            ├─ IDLE
            ├─ PLACING_BLOCK
            ├─ DRAGGING_NODE(S)
            ├─ MARQUEE_SELECT
            ├─ CONNECTING_WIRE
            ├─ LAYOUT_PREVIEW
            ├─ INSPECTING
            └─ CONFLICT (buffer giữ nguyên, chờ reload/retry)
```

Guard chung: `canEdit && viewportPolicyAllowsMutation && targetIdentityKnown`.
Mọi state transient có `Escape → IDLE` và không đổi canonical.

### 6.2 Gesture precedence

1. Target là input/select/textarea/button không phải canvas control: giữ native.
2. Pointer bắt đầu trên port: ưu tiên wire gesture.
3. Pointer bắt đầu trên node: ưu tiên node/group drag nếu `canEdit`.
4. Pointer bắt đầu vùng trống: với `pointerType=mouse`, left-drag là marquee;
   middle/right hoặc `Space` là pan. Với `pointerType=touch/pen`, one-finger
   drag là pan; chỉ khi nút toolbar `Chọn vùng` bật (`marqueeMode=true`) mới là
   marquee.
5. Hai pointer trên canvas: pinch/pan, không tạo marquee hoặc wire.
6. `Alt` khi drag node tắt snap; `Space` luôn chuyển blank drag thành pan.
7. `pointercancel`, mất capture hoặc Escape: hủy transient, khôi phục focus.

### 6.3 Placement pseudocode

```text
onLibraryPointerStart(entry):
  if entry.featureState != AVAILABLE: announce(reason); return
  ghost = { entryId: entry.id }

onCanvasPointerMove(pointer):
  ghost.graphPoint = screenToGraph(pointer, viewport)
  ghost.graphPoint = snapUnlessAlt(ghost.graphPoint)

onCanvasPointerUp(pointer):
  target = sceneAt(pointer)
  if !target.networkId || !finite(ghost.graphPoint): cancel()
  else dispatch(ADD_NODE(factory(entry), target.networkId, ghost.graphPoint))
```

`ADD_NODE` dựng UUID mới, port theo registry và layout entry; không tự tạo wire.

### 6.4 Wire validation pseudocode

```text
start = selected OUTPUT port
preview = route(start, pointer)
onDrop(target):
  candidate = resolveCanonicalEndpoints(start, target)
  if !sameNetwork || direction != OUTPUT→INPUT || type != type || unit != unit:
      announce(CONNECT_INCOMPATIBLE); cancel()
  else if target already driven || wire limit reached:
      announce(INPUT_HAS_DRIVER_OR_LIMIT); cancel()
  else:
      dispatch(ADD_WIRE(candidate)); clear preview
```

Không auto-connect ambiguous. Tap source → tap target dùng cùng validator.

### 6.5 Selection/copy/paste algorithm

- `Shift/Ctrl + click` toggle node/wire trong cùng network.
- Marquee chọn node có giao với rectangle theo policy `partial` (ghi rõ trong
  UI help); port không tự chọn nếu không chọn node.
- Group drag tính delta một lần, snap theo anchor, dispatch action target
  `MULTI_MOVE` một lần với payload:
  `{ networkId, moves: [{ nodeId, x, y }], expectedSelectionRevision }`.
- Copy lấy node đang chọn và wire mà cả hai endpoint đều thuộc selection.
- Paste cấp UUID mới cho node/port/wire, remap endpoint, offset + grid step;
  wire ra ngoài nhóm bị bỏ và hiển thị status.
- Delete group xóa node + wire liên quan trong một transaction.

`MULTI_MOVE` là action mới của FE reducer target, không phải API/contract public.
Reducer clone document, kiểm tra mọi node cùng `networkId`, UUID tồn tại, tọa độ
finite/bounds và selection revision trước khi sửa. Nếu một phần tử sai, reject
toàn bộ batch (`0` document diff, `0` history entry); không có partial apply.
Nếu mọi move trùng vị trí cũ, coi là no-op (`0` history entry). Thành công tạo
đúng một snapshot `past` và announcement `block-moved`.

`PASTE_SUBGRAPH` có payload `{ targetNetworkId, nodes, wires, offset }`; adapter
remap UUID trước, reducer validate toàn bộ rồi commit một snapshot. Wire nội bộ
không hợp lệ hoặc vượt giới hạn làm reject toàn bộ paste, không giữ các node
đã chèn dở.

### 6.6 Auto Layout/align

- Tính layout preview thuần từ topology + node dimensions; không đổi
  `executionOrder`.
- Render overlay/ghost; nút `Cancel` khôi phục layout cũ.
- `Apply` kiểm bounds/schema rồi dispatch action target `SET_LAYOUT_BATCH` với
  payload `{ networkId, positions: [{ nodeId, x, y }], expectedSelectionRevision }`
  một lần.
- `SET_LAYOUT_BATCH` kiểm tra toàn bộ positions trước khi clone/commit; một vị trí
  ngoài ±100000, node không tồn tại, network sai hoặc revision lệch làm reject
  toàn bộ (`0` diff/`0` history). Apply không được âm thầm đổi node khác network.
- Align/distribute dùng selection bounding box; selection <2 node thì báo lý do.
  Tất cả vị trí kết quả được snap/bounds-check trước khi dispatch.

### 6.7 Timing/resource

- Pointer move chỉ cập nhật transient trong `requestAnimationFrame`; không gọi
  `onChange` hoặc reducer mỗi frame.
- Commit placement/move/wire/paste/delete/layout là O(selection + internal wires).
- Canvas render topology keyed; runtime overlay không nằm trong EDIT path.
- Giới hạn theo contract: 256 node, 512 wire, layout coordinate ±100000,
  source canonical 65,536 bytes; reject trước commit khi vượt.
- Target NFR: pointer-to-paint p95 ≤32 ms; steady heap và chunk theo profile
  `pgm02_workspace_v1.json`.

## 7. Luồng người dùng/UX — `DD-08`

### 7.1 Visual authority

- Ảnh chủ sở hữu: [PGM-02B FBD editor reference](../../04_uiux/KX_DDC24_Programming_FE_Handoff_v2_1/assets/PGM-02B_FBD_editor_reference.png).
- Bản đặc tả render được của hồ sơ này: [desktop/tablet target SVG](assets/fbd-edit-target-v1.svg).
- Bản mobile read-only: [mobile target SVG](assets/fbd-edit-mobile-readonly-v1.svg).
- Bảng trạng thái bắt buộc: [loading/empty/error/permission/unknown/stale/conflict SVG](assets/fbd-edit-states-v1.svg).

Ba SVG là **minh họa thiết kế, không phải bằng chứng runtime**; chữ/giá trị trong
đó chỉ minh họa hierarchy và trạng thái. Ảnh PNG là target layout/scope, không
phải chuẩn pixel hay nguồn dữ liệu.

### 7.1.1 Token visual và tương phản

Token phải lấy từ biến theme hiện có của FE; tên dưới đây là mapping target,
không tạo palette độc lập cho FBD. Contrast được đo bằng công cụ axe/contrast
checker trên cả `LIGHT` và `DARK`; số trong bảng là ngưỡng tối thiểu phải đạt.

| Token/element | Source token hoặc target | Kích thước | Contrast/requirement |
|---|---|---:|---|
| Canvas background | `--c-bg`/FBD light surface theo theme | vùng tối thiểu 320×200 px | chữ thường ≥4.5:1; chữ lớn ≥3:1 |
| Panel/dock border | `--c-border` | 1 px | boundary nhìn thấy; không dùng màu duy nhất để truyền lỗi |
| Node normal border | accent blue token hiện có | 2 px | non-text UI boundary ≥3:1 với canvas |
| Node selected/focus | `--c-accent` | outline ≥2 px | focus indicator ≥3:1 và không chỉ dựa màu |
| Wire normal/selected | `--c-text-dim` / `--c-accent` | 2–3 px | selected wire khác normal bằng màu + stroke |
| Warning/error | `--c-warn-*` / `--c-danger-*` | marker ≥16 px, target ≥44 px | text ≥4.5:1; icon kèm text/aria |
| Read-only/unknown | `--c-surface-2` + text dim | target ≥44 px | trạng thái ghi bằng copy, không chỉ màu |
| Touch controls | existing button token | ≥44×44 px | khoảng cách hit-area không chồng |
| Grid | theme-derived low-contrast line | 1 px | không làm giảm contrast node/wire; có toggle |

Mọi trạng thái loading/empty/error/permission/unknown/stale/offline/conflict
được minh họa trong `fbd-edit-states-v1.svg`, đồng thời có copy/recovery và test
ở §7.3/§10. Nếu theme token hiện tại không đạt các ngưỡng trên, đó là finding
FE/UX cần sửa trong lát shell, không tự đổi màu bằng literal trong canvas.

Giá trị token và phép đo snapshot 2026-08-31 (hàm `contrastRatio` trong
`apps/web-ui/src/shared/theme/contrast.test.ts`, 80 test PASS):

| Cặp đo | LIGHT | DARK | Ngưỡng |
|---|---:|---:|---:|
| `--c-text` trên `--c-bg` | `#1C1F23` / `#C8CCD0` = 10.24:1 | `#EDEFF2` / `#14171A` = 15.62:1 | ≥4.5:1 |
| `--c-text-dim` trên `--c-bg` | `#4A4F55` / `#C8CCD0` = 5.12:1 | `#9AA0A6` / `#14171A` = 6.81:1 | ≥4.5:1 |
| `--c-accent` trên `--c-bg` | `#26527C` / `#C8CCD0` = 5.04:1 | `#5698DC` / `#14171A` = 5.93:1 | ≥4.5:1 (text), ≥3:1 (focus/graphic) |
| `--c-border` trên `--c-bg` | `#636970` / `#C8CCD0` = 3.44:1 | `#7C838B` / `#14171A` = 4.69:1 | ≥3:1 |
| `--c-warn-fg` trên `--c-warn-bg` | `#634D00` / `#EEE9DB` = 6.68:1 | `#E8B500` / `#3A3315` = 6.63:1 | ≥4.5:1 |
| `--c-fault-fg` trên `--c-fault-bg` | `#A01017` / `#F7E0E1` = 6.47:1 | `#EA6A6E` / `#3A2023` = 4.81:1 | ≥4.5:1 |

Các giá trị trên là **evidence của token hiện tại**, không phải evidence của
canvas mới; component FBD phải tái dùng token và chạy lại cùng test sau khi
đổi CSS/markup. Không dùng `--c-border` làm chữ; nó chỉ là graphic boundary.

### 7.2 Route và shell

- Giữ route canonical `/eng/programming/projects/:projectId/programs` và query
  POU/mode hiện tại; không tạo route FBD thứ hai.
- Top shared header giữ Save/Check/Refresh; FBD toolbar chỉ canvas commands.
- POU Explorer giữ icon `+ FBD` hiện tại.

### 7.3 Bảng ánh xạ vùng → field/API/state/action/RBAC/copy/test

| Vùng | Field/API source | State | Action | RBAC/policy | Copy chính | Error/recovery | Test |
|---|---|---|---|---|---|---|---|
| Shared header | existing Draft/capability + `onSave`/Check | ready/dirty/saving/conflict | Save, Check, Refresh | server role; Check theo saved revision | `Lưu`, `Kiểm tra`, `Đang lưu` | conflict giữ buffer → Tải lại/Giữ bản đang gõ | `TC-FBD-HEADER-001/002/003` |
| POU Explorer | Draft `objects/programs`, existing create ops | loading/empty/ready/error | select/create FBD | server canEdit; `<768` read-only | `Thêm chương trình FBD` | load error → Thử lại; empty → +FBD | `TC-FBD-UX-001` |
| POU tabs | existing `PouTabBar` | tab/buffer dirty/missing | activate/close/open | role unchanged | dirty close confirm | missing/dirty → Giữ/Đóng và bỏ | `TC-FBD-UX-002` |
| Canvas viewport | `FbdDocument`, `layout` | loading/empty/ready/invalid | drag/pan/zoom/fit | mutation guard | `Sơ đồ FBD` | invalid → Problems/Reload; pointer cancel → IDLE | `TC-FBD-CANVAS-001/002` |
| Grid/snap | local preference | grid/snap ready | toggle/Alt drag | all read; mutation only edit | `Grid`, `Snap` | corrupt pref → defaults | `TC-FBD-PREF-001` |
| Quick Library | registry + existing library query | loading/empty/ready/unavailable/review | drag/click-place | viewer read; admin insert | `Kéo thẻ vào canvas` | unavailable/review → lý do + Thử lại; no fallback | `TC-FBD-LIB-001/002/003/004` |
| Inspector | `FbdSelection`, registry, point catalog | empty/ready/permission/unknown | set parameter/type/I/O | admin EDIT only | `Khối FBD`, `Cổng vào/ra` | unknown → Không xác định được, không commit | `TC-FBD-INS-001/002` |
| Problems | `validateFbdDocument`, diagnostics | empty/ready/error | jump selection | read; jump không mutation | `Vấn đề` | no anchor → nói rõ, không near-match | `TC-FBD-DIAG-001` |
| Bottom Watch | existing runtime query when available | loading/empty/stale/offline | inspect only | all read | `Chưa có dữ liệu`/`Không khả dụng` | timeout/offline → badge + retry, không 0 | `TC-FBD-WATCH-001` |
| Search/XRef | existing workbench source/index | loading/empty/unavailable | select POU/jump | all read | `Tìm`, `Tham chiếu` | analyzer unavailable → Không xác định được | `TC-FBD-WB-001` |
| Mini Map | canvas geometry | hidden/ready | click navigate | all read | `Bản đồ thu nhỏ` | geometry invalid → ẩn + status | `TC-FBD-NAV-001` |
| Theme/dock menu | local preference | ready/corrupt storage | set/reset | all local | `Sáng/Tối/Theo giao diện web` | storage blocked → memory default + status | `TC-FBD-PREF-001` |
| Tablet drawer | same fields/state as desktop | closed/open/focus | open/close/Escape | role + viewport | `Mở Thuộc tính` | focus loss → restore opener | `TC-FBD-A11Y-001` |
| Phone banner | no mutation API | read-only policy | select/view only | `<768` no mutation | `Chế độ chỉ đọc` | attempted mutation → explicit reason | `TC-FBD-RESP-003` |

### 7.4 States bắt buộc

Mỗi dock/canvas phải có trạng thái `loading`, `empty`, `ready`, `error`,
`permission`, `unknown`, `stale/offline` phù hợp. Bảng trạng thái trực quan
`fbd-edit-states-v1.svg` là authority về hierarchy/action/recovery cho các state
này trong hồ sơ; bảng §7.3 ánh xạ từng vùng tới test. Không dùng một chuỗi rỗng
để đại diện cho unknown; không biến unavailable thành `0`.

| State board | Surface | Action/recovery bắt buộc | Test |
|---|---|---|---|
| Loading | shell, canvas, library | skeleton; mutation disabled; chờ hoặc hủy điều hướng | `TC-FBD-STATE-001` |
| Empty | network, library, workbench | hướng dẫn kéo block hoặc mở catalog; không coi là lỗi | `TC-FBD-STATE-002` |
| Error/Invalid | canvas, Problems, Save | mã/lý do; Reload/Retry; canonical giữ nguyên | `TC-FBD-STATE-003` |
| Permission/Read-only | shell, toolbar, Inspector | xem/chọn được; mutation disabled kèm lý do | `TC-FBD-STATE-004` |
| Unknown/Unavailable | library, I/O, Watch | `Không xác định được`/`Không khả dụng`; retry; không fallback | `TC-FBD-STATE-005` |
| Stale/Offline | Watch/connection | badge freshness; không dùng mẫu stale để commit | `TC-FBD-STATE-006` |
| Conflict | shared header/Draft | Tải lại hoặc Giữ bản đang gõ; không overwrite | `TC-FBD-CONFLICT-001` |

### 7.5 Responsive và accessibility

- `≥1440`: Explorer + Canvas + Library + Inspector cùng lúc.
- `1024–1439`: Explorer + Canvas chính, Library/Inspector drawer hoặc gập.
- `768–1023`: tablet edit, touch/stylus, nút `Chọn vùng`.
- `<768`: read-only; không kéo/nối/xóa/lưu.
- Drawer có focus trap, Escape đóng, trả focus về opener; target touch ≥44 px.
- SVG node/port/wire có role/name/focus; keyboard parity không phụ thuộc chuột.
- `prefers-reduced-motion` tắt animation không cần thiết; không animate wire.

## 8. Error, safety và security — `DD-09`

| Mã/nhóm | Nơi phát hiện | UI | State/output | Recovery/audit |
|---|---|---|---|---|
| `FBD-SEM-WIRE-001` / incompatible | wire validator trước reducer | Preview đỏ, lý do direction/type/unit | Giữ Draft, không wire | Sửa endpoint; local announcement |
| fan-in/limit | validator/reducer | `INPUT_HAS_DRIVER_OR_LIMIT` | Không mutate | Chọn input khác/xóa wire |
| `FBD-SCHEMA-*`, UUID | reducer/model validator | Problems fail-closed, không neo gần đúng | Không commit action lỗi | Reload hoặc sửa Draft |
| `FBD-SEM-ORDER-001` | validator | Marker + Problems | Layout kéo không đổi order | Reorder semantic riêng |
| `REVIEW_REQUIRED` | registry/palette adapter | Card disabled + reason | Không tạo node | Chờ approval Controls+Safety |
| library unavailable | query/catalog | `Không khả dụng`, không list giả | Không insertion | Refresh; không fallback signature |
| unknown point/type | I/O picker adapter | `Không xác định được` | Không tự tạo Mapping/ID | Chọn nguồn khác hoặc báo BE blocker |
| Save conflict/ETag | existing Draft API | Conflict/Retry/Reload | Giữ local buffer; không overwrite | Re-read/rebase theo existing flow |
| permission/viewport | shell policy | Controls disabled + copy | Không mutation | Dùng desktop/tablet đủ policy |
| malformed hostile payload | parser/validator boundary | Error state, no crash | Canonical giữ nguyên | Log safe error, không log token/source secret |
| runtime value absent in EDIT | presentation guard | `—`/`Chưa có dữ liệu` | Không hiển thị số giả | Chuyển mode có nguồn thật |

FE không nâng quyền bằng cách ẩn/hiện nút; server/RBAC vẫn là authority. Local
preference không chứa token, source đầy đủ, PII hoặc runtime secret.

## 9. Ánh xạ repository — `DD-10`

| Cần tạo hoặc sửa | Đường dẫn | Dependency được phép | Dependency bị cấm |
|---|---|---|---|
| Canvas layer/viewport/gestures | `apps/web-ui/src/features/programming/fbd/FbdCanvas.tsx` hoặc module con cùng thư mục | React/DOM Pointer Events, geometry/model hiện có | BE/Core imports, shadow graph |
| Domain transactions | `apps/web-ui/src/features/programming/fbd/commands.ts` | existing model, UUID helper | mutate trực tiếp trong JSX |
| Geometry/routes/grid | `apps/web-ui/src/features/programming/fbd/geometry.ts` | pure TS | DOM/network access |
| Selection/clipboard/layout helpers | `apps/web-ui/src/features/programming/fbd/*` | pure functions + reducer | external canvas package trước spike gate |
| FBD editor shell | `apps/web-ui/src/features/programming/fbd/StructuredFbdEditor.tsx`, `design/editor/ProgramsTab.tsx` | existing `PouTabBar`, `FbdEditorPane` | duplicate Save/Check/API path |
| Quick Library DnD cards | `apps/web-ui/src/features/programming/design/library/QuickLibraryPanel.tsx` | generated registry/catalog | unsupported block fallback |
| Inspector adapter | `apps/web-ui/src/features/programming/design/inspector/*` | existing `ContextInspector` | second selection authority |
| Preferences | `apps/web-ui/src/features/programming/fbd/fbdPreferences.ts` (target) | localStorage, version parser | backend persistence |
| Responsive shell/workbench | `apps/web-ui/src/features/programming/design/editor/*`, styles in existing FE | existing tokens/components | global unrelated layout rewrite |
| Test fixtures/tests | `apps/web-ui/src/features/programming/fbd/*.test.*`, `design/editor/*.test.*`, `e2e/programming.spec.ts` | Vitest/Testing Library/Playwright/axe | fake runtime assertions presented as real |
| Visual design assets | `docs/superpowers/specs/assets/*` | SVG only, marked illustration | generated runtime screenshots as evidence |
| Design/changelog | this file, `CHANGELOG.md` | docs harness | undocumented behavior change |

Không sửa trong lát này: `apps/web-api/**`, `apps/core/**`, `firmware/**`,
`contracts/**` (trừ khi một blocker được Owner mở bằng decision riêng).

## 10. Verification — `DD-11`

Evidence class `HOST`/`BROWSER` chỉ chứng minh lát đó; không suy ra target/HIL/
release. Mọi test mới phải ghi commit và môi trường thực tế khi chạy.

| Scenario | Fixture/precondition | Bước và ca lỗi | Kỳ vọng định lượng | Target/evidence | Thẩm quyền ký |
|---|---|---|---|---|---|
| `TC-FBD-CANVAS-001` | golden `ahu_fan_enable.json` | mở canvas, pan/zoom/fit | viewBox topology giữ nguyên; scale trong 0.4..2.5 | HOST unit/component | FE + QA |
| `TC-FBD-CANVAS-002` | graph 256 node/512 wire | render, kéo, zoom | không crash; pointer p95 ≤32 ms; không full rerender mỗi move | HOST benchmark/BROWSER | FE + QA |
| `TC-FBD-LIB-001` | registry 45 AVAILABLE + PID review | drag/click-place từng loại | AVAILABLE tạo đúng node; PID = 0 insertion | HOST component/E2E | FE + QA |
| `TC-FBD-LIB-002` | Quick Library card | drop ngoài canvas/scene | 0 Draft mutation, 0 undo entry | HOST negative | FE |
| `TC-FBD-LIB-003` | selected BOOL/REAL port | bật/tắt compatible filter | danh sách chỉ gồm entry có ít nhất một port/allowed type khớp; count UI = count model | HOST unit/component | FE |
| `TC-FBD-LIB-004` | selected port có nhiều candidate | drop/click-place candidate | không wire tự động; 0 implicit `ADD_WIRE` trong 100 lần lặp | HOST negative/E2E | FE + QA |
| `TC-FBD-WIRE-001` | typed golden | drag output→input hợp lệ | 1 wire, 1 undo; endpoints canonical | HOST unit/E2E | FE + compiler consumer |
| `TC-FBD-WIRE-002` | BOOL→REAL, unit mismatch, fan-in | drop invalid | 0 wire, 0 `onChange`, announcement đúng | HOST negative | FE + QA |
| `TC-FBD-WIRE-003` | two ports | tap source→tap target, Ctrl click-click, keyboard Enter | ba đường đều cùng validator/kết quả | BROWSER desktop/tablet | FE + QA |
| `TC-FBD-SEL-001` | 10 node/5 wire | Shift/Ctrl, marquee, group drag | selection đúng; một `MULTI_MOVE`; order giữ nguyên | HOST component | FE |
| `TC-FBD-SEL-002` | selected subgraph | copy/paste/delete | UUID node/port/wire mới; chỉ wire nội bộ; một undo | HOST unit | FE |
| `TC-FBD-LAYOUT-001` | graph có crossing | Auto Layout preview/cancel/apply | Cancel 0 canonical diff; Apply 1 layout transaction | HOST component | FE |
| `TC-FBD-INS-001` | selected FBD block/port/wire | mở Inspector, sửa parameter/type | 100% field hiển thị khớp registry/graph; invalid = 0 commit/0 history | HOST component | FE + QA |
| `TC-FBD-INS-002` | no selection | mở dock | `data-testid=inspector-collapsed`, đúng 1 thông báo; không render form mutation | HOST a11y | FE + UX |
| `TC-FBD-PREF-001` | clean localStorage/corrupt v0 | đổi theme/dock/grid/wire/network view, reload | preference round-trip; canonical JSON byte-identical | HOST unit/BROWSER | FE |
| `TC-FBD-RESP-001` | browser widths | 1440/1280/1024/820/768 | không tràn ngang; dock/gutter đúng policy | BROWSER screenshot | FE + UX |
| `TC-FBD-RESP-002` | touch/stylus emulation | drag/pan/pinch/tap-to-tap | mutation đúng từ 768px; focus/escape ổn | BROWSER | FE + QA |
| `TC-FBD-RESP-003` | width 390 | thử drag/wire/delete/save | 0 mutation; read-only copy hiện | BROWSER negative | QA |
| `TC-FBD-A11Y-001` | keyboard + axe | Tab/Arrow/Enter/Delete/Ctrl+Z/Y; axe | 0 serious/critical; focus ≥2 px và contrast ≥3:1; 100% mutation commands có keyboard path | BROWSER/axe | QA |
| `TC-FBD-DIAG-001` | malformed schema/type/wire | click Problems item | 100% anchored issues focus exact entity; unanchored = explicit text; 0 near-match | HOST/BROWSER | FE |
| `TC-FBD-SAVE-001` | Draft dirty/valid and dirty/incomplete | Save, reload | canonical FBD/layout round-trip; incomplete vẫn lưu | HOST integration | FE + BE consumer |
| `TC-FBD-CONFLICT-001` | simulated ETag conflict | Save conflict | local buffer giữ, không overwrite; Retry/Reload rõ | HOST/BROWSER mock | FE + QA |
| `TC-FBD-SPIKE-001` | isolated xyflow prototype | build/measure/axe/256-512 | gate pass hoặc documented fail; không product dep nếu fail | HOST build | Architect + FE |
| `TC-FBD-CONTRACT-001` | repo current | typecheck/lint/unit/build/harness | command output ghi thật; drift tách riêng | HOST CI/local | QA |
| `TC-FBD-HEADER-001` | clean/dirty Draft | Save/Check/Refresh | đúng 1 Save/Check surface; dirty Check disabled; response/error copy đúng mã | HOST component/BROWSER | FE + QA |
| `TC-FBD-HEADER-002` | Save timeout/unavailable | chờ request không kết quả | không tự retry; status UNKNOWN/đang chờ; buffer không mất | HOST fault injection | FE + QA |
| `TC-FBD-HEADER-003` | stale server diagnostic + changed buffer | sửa graph sau Check | marker cũ mang `STALE DIAGNOSTIC`, không gạch như lỗi mới | HOST component | FE + compiler consumer |
| `TC-FBD-STATE-001` | mocked loading | mount shell/dock | loading copy/skeleton, mọi mutation disabled | HOST component | FE |
| `TC-FBD-STATE-002` | empty network/library/workbench | mở từng surface | đúng empty copy + action; không hiện error giả | HOST component | FE + UX |
| `TC-FBD-STATE-003` | malformed/HTTP error | reload/retry | state error có mã/lý do; canonical không đổi | HOST fault injection | FE + QA |
| `TC-FBD-STATE-004` | viewer or width 390 | thử mutation | 0 action/0 history/0 API mutation; xem/chọn vẫn được | HOST/BROWSER | QA |
| `TC-FBD-STATE-005` | unavailable catalog/point source | mở Library/Inspector | unknown/unavailable copy + retry; 0 fallback entry/ID | HOST fault injection | FE |
| `TC-FBD-STATE-006` | stale/offline Watch | disconnect/old sample | badge freshness; value `—` hoặc state rõ; 0 value→canonical mutation | HOST/BROWSER | FE + QA |
| `TC-FBD-WATCH-001` | no runtime source in EDIT | mở Watch | empty/unavailable state, 0 fabricated numeric values | HOST component | FE |
| `TC-FBD-WB-001` | source/index absent | Search/XRef | no-source copy; 0 fabricated reference | HOST component | FE |
| `TC-FBD-NAV-001` | >24 nodes | click minimap | viewport center sai lệch ≤1 grid cell; topology/canonical byte-identical | BROWSER | FE + QA |
| `TC-FBD-UX-001` | Draft có/không POU, role admin/viewer | tìm/chọn/tạo bằng icon `+ FBD` | admin tạo đúng 1 `PROGRAM/FBD`; viewer = 0 mutation; chỉ một POU Explorer trong DOM | HOST component/E2E | FE + QA |
| `TC-FBD-UX-002` | 8 tab gồm FBD/ST, 1 dirty/missing | chuyển/đóng/mở tab thứ 9 | không mất buffer; dirty yêu cầu confirm; limit/missing copy đúng; 0 silent discard | HOST component/E2E | FE + QA |

### 10.1 Trace hai chiều requirement → test/evidence

Các dòng dưới đây là kế hoạch verification (`PLANNED`), không phải Test Result.
Nguồn authority được ghi để khi implement không nhầm ảnh target với bằng chứng.

| Requirement/AC nguồn | Ý nghĩa kiểm chứng | Scenario/evidence đích | Trạng thái hiện tại |
|---|---|---|---|
| `AC-FBD-001` / PGM-02B §3 | Canvas node-edge thật, dây nhìn thấy | `TC-FBD-CANVAS-001/002`, screenshot BROWSER | PLANNED |
| `AC-FBD-002` / PGM-02B §4 | Tìm và đặt block từ Quick Library | `TC-FBD-LIB-001/002` | PLANNED |
| `AC-FBD-003` / PGM-02B §4.4 | Lọc block theo port tương thích | `TC-FBD-LIB-003` | PLANNED |
| `AC-FBD-004` / PGM-02B §4.4 | Không auto-connect ambiguous | `TC-FBD-LIB-004`, `TC-FBD-WIRE-003` | PLANNED |
| `AC-FBD-005` / PGM-02B §5 | Insertion dùng domain command, undo được | `TC-FBD-LIB-001`, `TC-FBD-SEL-002` | PLANNED |
| `AC-FBD-006` / PGM-02B §6 | Invalid typed connection bị chặn ngay | `TC-FBD-WIRE-001/002` | PLANNED |
| `AC-FBD-007` / PGM-02B §10 | Problems jump exact block/wire | `TC-FBD-DIAG-001` | PLANNED |
| `AC-FBD-008` / PGM-02B §7 | SIMULATE không physical output | **Ngoài phạm vi lát FBD EDIT**, giữ trace sang R3 | N/A — owner Simulation plan |
| `AC-FBD-009` / PGM-02B §8 | LIVE Active topology read-only | **Ngoài phạm vi lát FBD EDIT**, giữ trace sang R2 | N/A — owner LIVE plan |
| `AC-FBD-010` / PGM-02B §8 | Không ghép Active value vào Draft mismatch | **Ngoài phạm vi lát FBD EDIT**, giữ trace sang R2 | N/A — owner LIVE plan |
| `AC-FBD-011` / PGM-02B §11 | Runtime refresh không mutate topology | **Ngoài phạm vi lát FBD EDIT**, giữ trace sang R2/R3 | N/A — owner runtime plan |
| `AC-FBD-012` / PGM-02B §3/§11 | Minimap trên graph lớn | `TC-FBD-CANVAS-002`, `TC-FBD-NAV-001` | PLANNED |
| `DDO-PGM02-007` / DDD §6.3 | Insertion là một transaction/undo, giữ port order/layout | `TC-FBD-LIB-001`, `TC-FBD-SAVE-001` | PLANNED |
| `DDO-PGM02-015` / DDD §7.5 | Status/focus/a11y và unknown trung thực | `TC-FBD-A11Y-001`, `TC-FBD-STATE-001..006` | PLANNED |
| `AC-PGM02-001..010` / workspace contract | Route, POU, mode, RBAC, responsive, tab và save guard | `TC-FBD-UX-001/002`, `TC-FBD-RESP-001..003`, `TC-FBD-HEADER-001..003` | PLANNED |

Ngược lại, mọi scenario `TC-FBD-*` trong bảng §10 phải trỏ ít nhất một
requirement/AC ở bảng này hoặc được ghi là `NFR/defensive`. Khi test thật chạy,
thay `PLANNED` bằng commit, command, output và evidence class; không sửa lịch sử
bằng cách đổi trạng thái hồi tố.

### 10.1.1 Coverage closure index cho từng `TC-FBD-*`

| Scenario | Requirement/NFR source | Evidence target |
|---|---|---|
| `TC-FBD-CANVAS-001` | `AC-FBD-001` | §10 row cùng ID |
| `TC-FBD-CANVAS-002` | `AC-FBD-001`, `AC-FBD-012`, `pgm02_workspace_v1.json:nfr.frontend.pointerToPaintP95Ms/fbdMaxNodes/fbdMaxEdges` | §10 row cùng ID |
| `TC-FBD-LIB-001` | `AC-FBD-002`, `AC-FBD-005` | §10 row cùng ID |
| `TC-FBD-LIB-002` | `AC-FBD-002`, defensive zero-mutation | §10 row cùng ID |
| `TC-FBD-LIB-003` | `AC-FBD-003` | §10 row cùng ID |
| `TC-FBD-LIB-004` | `AC-FBD-004` | §10 row cùng ID |
| `TC-FBD-WIRE-001` | `AC-FBD-006`, `DDO-PGM02-007` | §10 row cùng ID |
| `TC-FBD-WIRE-002` | `AC-FBD-006` | §10 row cùng ID |
| `TC-FBD-WIRE-003` | `AC-FBD-004`, `DDO-PGM02-015` | §10 row cùng ID |
| `TC-FBD-SEL-001` | `DDO-PGM02-007`, `PGM-02B §3` minimum capability | §10 row cùng ID |
| `TC-FBD-SEL-002` | `DDO-PGM02-007` | §10 row cùng ID |
| `TC-FBD-LAYOUT-001` | `DDO-PGM02-007`, `PGM-02B §3` minimum capability | §10 row cùng ID |
| `TC-FBD-INS-001` | `DDO-PGM02-015` | §10 row cùng ID |
| `TC-FBD-INS-002` | `DDO-PGM02-015` | §10 row cùng ID |
| `TC-FBD-PREF-001` | `DDD-PGM02-FBD-EDIT-001 §4.3` preference integrity | §10 row cùng ID |
| `TC-FBD-RESP-001` | `AC-PGM02-001..010` | §10 row cùng ID |
| `TC-FBD-RESP-002` | `AC-PGM02-001..010`, `PGM-02B §3` pan/zoom/keyboard minimum | §10 row cùng ID |
| `TC-FBD-RESP-003` | `AC-PGM02-001..010`, viewport policy | §10 row cùng ID |
| `TC-FBD-A11Y-001` | `DDO-PGM02-015`, `DOC-GOV-001 §2.2` visual/a11y gate | §10 row cùng ID |
| `TC-FBD-DIAG-001` | `AC-FBD-007` | §10 row cùng ID |
| `TC-FBD-SAVE-001` | `DDO-PGM02-007`, `AC-PGM02-001..010` | §10 row cùng ID |
| `TC-FBD-CONFLICT-001` | `AC-PGM02-001..010`, `PRG-ERR-CONFLICT-001` | §10 row cùng ID |
| `TC-FBD-SPIKE-001` | `DDD-PGM02-FBD-EDIT-001 §5.4` dependency gate | §10 row cùng ID |
| `TC-FBD-CONTRACT-001` | `DOC-GOV-001`, `contracts/programming/pgm02_workspace_v1.json` | §10 row cùng ID |
| `TC-FBD-HEADER-001` | `AC-PGM02-001..010` | §10 row cùng ID |
| `TC-FBD-HEADER-002` | `BLK-FBD-006` / NFR-defensive (transport readiness) | §10 row cùng ID |
| `TC-FBD-HEADER-003` | `DDO-PGM02-015`, diagnostic freshness | §10 row cùng ID |
| `TC-FBD-STATE-001` | `DDO-PGM02-015`, `DDD-PGM02-FBD-EDIT-001 §7.4` | §10 row cùng ID |
| `TC-FBD-STATE-002` | `DDO-PGM02-015`, `DDD-PGM02-FBD-EDIT-001 §7.4` | §10 row cùng ID |
| `TC-FBD-STATE-003` | `DDO-PGM02-015`, defensive fail-closed | §10 row cùng ID |
| `TC-FBD-STATE-004` | `AC-PGM02-001..010`, viewport/RBAC | §10 row cùng ID |
| `TC-FBD-STATE-005` | `DDO-PGM02-015`, unknown semantics | §10 row cùng ID |
| `TC-FBD-STATE-006` | `DDO-PGM02-015`, stale/offline semantics | §10 row cùng ID |
| `TC-FBD-WATCH-001` | `AC-FBD-011` (trace-only to R2/R3; EDIT guard, not an in-scope AC) | §10 row cùng ID |
| `TC-FBD-WB-001` | `DDO-PGM02-015`, unknown semantics | §10 row cùng ID |
| `TC-FBD-NAV-001` | `AC-FBD-012`, `TC-PGM02-NAV-01` | §10 row cùng ID |
| `TC-FBD-UX-001` | `AC-PGM02-001..010` | §10 row cùng ID |
| `TC-FBD-UX-002` | `AC-PGM02-001..010`, `TC-PGM02-TAB-01` | §10 row cùng ID |

Coverage index trên bao phủ toàn bộ **38 scenario ID** đã định nghĩa ở §10;
`TC-FBD-WATCH-001` là trace-only tới AC runtime ngoài scope, còn
`TC-FBD-HEADER-002` là NFR-defensive gắn `BLK-FBD-006`, không phải acceptance
đã đạt.

### 10.2 Lệnh kiểm chứng dự kiến

PowerShell (repo root):

```powershell
$env:PYTHONUTF8='1'
Set-Location apps/web-ui
npm run typecheck
npm run lint
npx vitest --run --environment jsdom src/features/programming/fbd src/features/programming/design
npx playwright test e2e/programming.spec.ts
npx playwright test --config playwright.programming-real.config.ts
Set-Location ..\..
python scripts/docs_iso_harness.py --expect
python scripts/verify_programming_bundle_budget.py --increment r1
```

POSIX/WSL tương đương:

```text
cd apps/web-ui
npm run typecheck
npm run lint
npx vitest --run --environment jsdom src/features/programming/fbd src/features/programming/design
npx playwright test e2e/programming.spec.ts
npx playwright test --config playwright.programming-real.config.ts
cd ../..
PYTHONUTF8=1 python3 scripts/docs_iso_harness.py --expect
PYTHONUTF8=1 python3 scripts/verify_programming_bundle_budget.py --increment r1
```

`PYTHONUTF8=1`/`$env:PYTHONUTF8='1'` là bắt buộc trên Windows hiện tại vì
console mặc định `cp1252` không in được một số thông báo tiếng Việt. Không dùng
WindowsApps alias `python3.exe` nếu nó không chạy script; dùng `python.exe` đã
được cài hoặc WSL. Error-catalog check tại snapshot đã PASS, nhưng phải chạy lại
trong candidate; build Vite trực tiếp chỉ là số đo bundle, không thay cho
contract checks.

## 11. Compatibility, deploy và rollback — `DD-12`

### 11.1 Compatibility

- FBD schema v1, canonical JSON, `layout` và generated registry giữ nguyên.
- Existing Draft API/ETag/`replaceProgramSource` giữ nguyên; không migration DB.
- POU tab/query/deep-link và `+ FBD` giữ tương thích.
- Preference key có version; xóa key là rollback UI an toàn, không ảnh hưởng Draft.
- Nếu spike framework được chọn, phải dynamic/isolate theo decision riêng; không
  buộc server cũ hiểu payload mới.

### 11.2 Thứ tự triển khai

1. Merge tests/domain helpers và feature flag off.
2. Bật SVG canvas/gestures cho FE local sau gate host.
3. Bật dock/preferences sau browser matrix desktop/tablet.
4. Bật cho người dùng trong `EDIT` khi no-BE diff và save round-trip đạt.
5. Không bật LIVE/SIMULATE hay target/HIL từ spec này.

### 11.3 Rollback

- Tắt feature flag FBD workspace mới hoặc quay về renderer cũ; canonical Draft
  không bị rewrite vì layout v1 vẫn optional.
- Nếu local preference gây layout xấu, reset namespace v1; không xóa source.
- Nếu Save conflict/regression, giữ đường cũ `FbdEditorPane` và không retry mù.
- Rollback framework spike bằng cách bỏ dynamic import/package (nếu chưa merge
  product dependency); SVG path phải luôn còn.

## 12. Blocker, lịch sử và phê duyệt — `DD-13`

| Blocker | Owner | Ảnh hưởng | Gate | Điều kiện mở khóa |
|---|---|---|---|---|
| `BLK-FBD-001` `variableId` chưa có trong FBD v1 | BE/Compiler architect | I/O picker chỉ chứng minh name/type/unit, không claim stable variable identity | `IMPLEMENT_READY` cho semantic picker | Decision additive schema/API + generated client + round-trip test; tới lúc đó giữ picker theo nguồn hiện có hoặc báo unknown |
| `BLK-FBD-002` React Flow/Rete bundle/perf chưa chứng minh | FE architect | Không được thêm dependency vào product | spike gate | Isolated measurement đạt license/adapter/a11y/256-512/budget; nếu không, đóng bằng SVG-first |
| `BLK-FBD-003` R1 bundle budget hiện vượt — **CLOSED 2026-09-05** | FE architect + Product | Đã gỡ. Cổng thi hành là R3 165 KiB, không phải R1 | R1 NFR gate — hết hiệu lực | **ĐÃ ĐÓNG.** Task 1.5 lazy-load `ProgramsTab` cắt 28,66 KiB (157,20 → 128,54 KiB); Owner ký `UD-PROG-017` chọn lựa chọn A; đo lại trên build sạch: R3 PASS, dư 36,46 KiB |
| `BLK-FBD-004` Browser DevTools MCP chưa xác nhận trong phiên | QA/Tooling | Chưa có evidence browser MCP cho layout/runtime | `M3→M4` evidence gate | MCP khả dụng hoặc Playwright/browser evidence được review; không claim đã có nếu chưa chạy |
| `BLK-FBD-005` PID Controls+Safety approval | Controls + Safety | PID card phải disabled; không insertion | library feature gate | Approval record chính thức cập nhật registry/policy; FE không tự mở |
| `BLK-FBD-006` Generated programming client chưa có timeout policy | FE platform/API owner | Save/Check request có thể treo vô hạn; không được tự hứa SLA trong FBD | transport readiness gate | Thêm timeout/cancel semantics qua decision API hoặc chấp thuận explicit no-timeout residual; test abort/read-back |
| `BLK-FBD-007` Chữ ký baseline chính thức chưa có | Document Control + Product Owner | Hồ sơ chỉ ở M3, chưa được dùng làm M5/implementation baseline có thẩm quyền | `M4/M5` sign-off gate | Reviewer consumer và Product Owner/System Architect ký record `AUTH-*`; phê duyệt trong phiên chỉ là input thiết kế, không thay chữ ký kiểm soát |

### 12.1 Open decisions đã chốt trong phiên

| Quyết định | Kết quả | Hệ quả |
|---|---|---|
| Scope | FBD EDIT trước, FE-only | LIVE/SIMULATE/BE/Core để sau |
| Library | Registry/compiler hiện tại; PID review-gated | Không block giả/không fallback |
| Placement | Drag/click place, không auto-connect | Explicit wire confirmation |
| Layout | SVG-first + spike framework độc lập | Giữ budget và canonical model |
| Docks | Co giãn mọi độ phân giải, preference local | Canvas tự mở rộng |
| Theme | Light/Dark/Follow web, default Follow web | Không đổi shell theme chung |
| Network | Selected và All network | Drop target luôn rõ network |
| Wire | Orthogonal và Bezier, default Orthogonal | Presentation-only |
| Device | Mouse/trackpad/touch/stylus; phone <768 read-only | Tablet >=768 edit |
| Save | Cho lưu Draft chưa hoàn chỉnh | Check là cổng xác nhận |
| Import/export | Chưa làm PLCopen; copy/paste nội bộ | Boundary phase sau |
| New POU | Giữ icon `+ FBD` hiện tại | Không thêm menu duplicate |

### 12.2 Revision history

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1 | 2026-08-31 | Ghi detailed design FBD EDIT FE-only sau khảo sát repo, ảnh tham chiếu, handoff, contract và nguồn interaction công khai; chưa triển khai code. |
| 0.2 | 2026-08-31 | Đóng finding review vòng 1: ghim SHA/worktree và số đo local, bổ sung transport/Check contract, token/contrast, state-board asset, mapping error/recovery, trace hai chiều, network ALL hit-test và batch action atomicity. |
| 0.3 | 2026-08-31 | Reviewer vòng 3 xác nhận `APPROVED WITH RESIDUALS`; bổ sung coverage closure 38/38 scenario, chú thích trace-only/NFR-defensive và chốt residual R1 bundle/timeout/browser/PID/sign-off. |
| 0.4 | 2026-09-12 | `#674` chốt mô hình MỘT canvas theo quyết định chủ sở hữu `owner-decision-20260912T0300Z`: §1 sửa mô tả `Khung nhìn`, §5.1.1 đánh dấu `SUPERSEDED` và thêm §5.1.1a làm hợp đồng đang thi hành (không có lối vào Network thứ hai; tài liệu nhiều Network mở chỉ đọc với 0 mutation, không xóa/gộp). Schema `fbd_v1` và `fbd_keyboard_commands_v1` KHÔNG đổi. Bằng chứng: vitest `AC-674-2`/`AC-674-4`, e2e `TC-FBD-RESP-001`. |

### 12.2.1 Review vòng 1 — disposition

| Finding | Disposition | Bằng chứng cập nhật |
|---|---|---|
| P1-1 As-Built path/bundle stale | `CLOSED IN SPEC` | §2 path exact, snapshot SHA `8a26c5d5`, Vite/verifier output và evidence class |
| P1-2 UI mapping thiếu error/state | `CLOSED IN SPEC` | §7.3 thêm cột Error/recovery; §7.4 state board + test |
| P1-3 thiếu visual token/contrast | `CLOSED IN SPEC` | §7.1.1 token/size/contrast table + theme test source |
| P1-4 DD-06 transport thiếu timeout/retry/idempotency | `CLOSED IN SPEC` | §5.2/§5.2.1 existing client behavior, stable errors, unknown recovery |
| P1-5 trace AC→test một chiều | `CLOSED IN SPEC` | §10.1 requirement/AC ↔ scenario/evidence matrix |
| P1-6 dirty baseline | `CLOSED IN SPEC` | §2 SHA + dirty allowlist/evidence boundary; no unrelated files used |
| P1/P2-7 Windows harness | `CLOSED IN SPEC` | §10.2 PowerShell + `PYTHONUTF8`/WSL commands |
| P2-8 expected định tính | `CLOSED IN SPEC` | §10 quantitative counts/thresholds expanded |
| P2-9 batch action/network ALL ambiguity | `CLOSED IN SPEC` | §5.1.1/§5.1.2/§6.5/§6.6 atomic payloads and hit-test policy |
| P1 visual state coverage | `CLOSED IN SPEC` | `assets/fbd-edit-states-v1.svg`, §7.4 state table and `TC-FBD-STATE-*` |
| Header/bundle/Check freshness gaps | `CLOSED IN SPEC` | §5.2.1, §7.3 shared-header row, `TC-FBD-HEADER-*`, R1 gate/blocker |

### 12.2.2 Review vòng 3 — kết quả độc lập

| Kết quả | Phạm vi | Residual được giữ |
|---|---|---|
| `APPROVED WITH RESIDUALS` | Reviewer FE/architecture độc lập, kiểm `DD-01..DD-13`, links, assets, trace 38/38 scenario | `BLK-FBD-006` timeout transport; `BLK-FBD-004/005/007` browser evidence/PID approval/baseline sign-off; §10 vẫn `PLANNED`, chưa là implementation/target/HIL evidence. (`BLK-FBD-003` R1 chunk đã **CLOSED 2026-09-05** theo `UD-PROG-017` — không còn là residual) |

### 12.3 Sign-off

| Vai trò | Trạng thái | Điều kiện ký |
|---|---|---|
| UX/Product | `APPROVED IN SESSION` | Onii-chan đã duyệt scope/UX trong phiên; cần record Product chính thức cho baseline |
| FE owner | `PENDING` | Review source mapping, spike gate và test matrix |
| Compiler/runtime consumer | `PENDING` | Xác nhận schema/layout/executionOrder không đổi |
| QA | `PENDING` | Duyệt browser/axe/performance evidence sau implementation |
| Product Owner/System Architect | `TBD` | Ký decision mở `IMPLEMENT_READY` cho lát cụ thể |

## 13. Tự kiểm `DD-01..DD-13`

| Mã | Kết quả | Mục trong file / lý do |
|---|---|---|
| `DD-01` Metadata | `PASS` | Metadata đầu file, revision history và sign-off §12. |
| `DD-02` Mục tiêu/phạm vi | `PASS` | §1 có outcome, actor, in/out scope, constraint, success criteria. |
| `DD-03` As-Built | `PASS` | §2 dẫn source/contract/symbol và tách gap khỏi target. |
| `DD-04` Target ownership | `PASS` | §3 có cây component, ownership, flow và failure boundary. |
| `DD-05` Data từng field | `PASS` | §4 có canonical/transient/preference field, type, range, null và lifecycle. |
| `DD-06` Interface | `PASS` | §5 có FE boundary, transport, RBAC, DnD type và dependency gate. |
| `DD-07` State/algorithm/timing | `PASS` | §6 có state machine, pseudocode, transaction, timing, limit. |
| `DD-08` UX/flow | `PASS` | §7 có route, component tree, mapping, states, responsive/a11y và SVG/PNG links. |
| `DD-09` Error/safety/security | `PASS` | §8 có nơi phát hiện, mã, state giữ/đổi, recovery và hostile input. |
| `DD-10` Repository mapping | `PASS` | §9 có path cần sửa/tạo và dependency bị cấm. |
| `DD-11` Verification | `PASS` | §10 có scenario, fixture, bước, kỳ vọng định lượng, evidence authority. |
| `DD-12` Compatibility/deploy/rollback | `PASS` | §11 có compatibility, thứ tự bật, rollback và dữ liệu giữ. |
| `DD-13` Trace/risk/decision/sign-off | `PASS` | §12 có blockers owner/gate/điều kiện, decision, history, sign-off. |

### 13.1 Evidence boundary

Hồ sơ này là **Target Detailed Design**. `PASS` của bảng tự kiểm chỉ nói hồ sơ
đã có nội dung để review; không nói code đã triển khai, test đã chạy, target/HIL
đã đạt hoặc release đã sẵn sàng. Các blocker §12 vẫn mở cho tới khi có evidence
và người có thẩm quyền ký.
