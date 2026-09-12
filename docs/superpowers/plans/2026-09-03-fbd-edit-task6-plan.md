# Task 6 — Quick Library placement và typed wiring (plan thực thi)

Nhánh: `feat/fbd-edit-task6` (từ `main` @ `dec4f781`).
Nguồn: spec v0.3 §5.1/§5.1.2/§5.3/§6.2/§6.3/§6.4/§8, plan 11-task §6, handoff 2026-09-03.
Phạm vi: chỉ `apps/web-ui/src/features/programming/**`. Không đụng `apps/core`,
`apps/web-api`, `firmware`, `contracts`, `scripts`.

## 1. Khoảng trống đã đo được ở Pha 1

| # | Hiện trạng thật trong code | Spec đòi | Hệ quả nếu bỏ qua |
|---|---|---|---|
| G1 | `ADD_NODE` = `{ networkId, node }`, không có `position`; layout entry chỉ sinh qua `SET_NODE_POSITION` | §5.1.2: `{ networkId, node, position }` → 1 node + 1 layout entry + **1** history | Thả một khối = 2 undo entry, người dùng phải Ctrl+Z hai lần cho một thao tác |
| G2 | Không có mã `block-review-required` trong reducer lẫn `translateFbdAnnouncement` | §8 hàng `REVIEW_REQUIRED`: "Không tạo node" | PID lọt qua reducer nếu UI bị bypass |
| G3 | `toPaletteEntry` (`palette.ts:47`) **bỏ** `featureState` | §5.3 + §6.3 `if entry.featureState != AVAILABLE` | Reducer không có dữ liệu để fail-closed |
| G4 | Port `<g>` (`FbdCanvasLayers.tsx:184`) không có pointer handler | §6.2 quy tắc 2 "Pointer bắt đầu trên port: ưu tiên wire gesture" | Kéo từ port bị node-drag nuốt |
| G5 | `FbdCanvas` không có `onDragOver`/`onDrop`, không có ghost, không có wire preview | §4.2 `wirePreview`, §6.3 ghost | Không thả được, không thấy trước |
| G6 | Validator wire nằm **inline** trong `connect()` (`commands.ts:297-312`) | plan §6 step 6 "tái dùng validator" cho pointer/touch/keyboard | Ba đường nối lệch luật nhau |
| G7 | **Không tồn tại** action `ADD_WIRE`; wire đi qua `BEGIN_OR_COMMIT_CONNECTION` hai pha | §5.1.2 liệt kê `ADD_WIRE` `{ networkId, wire }` | Pointer drop phải dispatch 2 lần, phụ thuộc batching |

## 2. Quyết định chốt

**QĐ-1 — `position` là tuỳ chọn, không bắt buộc.**
`ADD_NODE` thêm `position?: FbdPoint`. Có `position` ⇒ validate bằng
`clampLayoutCoordinate` (đã có sẵn, `commands.ts:115`), sai ⇒ reject
`invalid-position` với **0** diff; đúng ⇒ ghi `document.layout.nodes[node.id]`
**trong cùng lần `commit()`**. Không có `position` ⇒ hành vi cũ nguyên vẹn.
*Lý do:* 3 call site hiện tại (`addPaletteNode`, `submitInterfaceNode`,
`submitConstantNode`) và 1603 test không phải sửa; bắt buộc `position` là một
diff rộng không mua thêm tính đúng nào.

**QĐ-2 — Thêm `ADD_WIRE` thật, KHÔNG nhân bản validator.**
Tách phần kiểm tra inline của `connect()` thành hàm thuần export:
```ts
export type FbdWireRejection =
  | 'port-not-found' | 'select-output-port' | 'connect-incompatible'
  | 'wire-mismatch' | 'wire-uuid-invalid' | 'connect-reverse-order'
  | 'input-has-driver-or-limit'
export function validateFbdWireCandidate(
  document: FbdDocument, sourcePortId: string, targetPortId: string, wire: FbdWire | undefined,
): { ok: true } | { ok: false; code: FbdWireRejection }
```
`connect()` (pha 2 của `BEGIN_OR_COMMIT_CONNECTION`, đường bàn phím) và
`ADD_WIRE` (đường pointer/touch) **cùng gọi** hàm này. Đây chính là "một
validator dùng chung" của plan §6 step 7, và giữ đúng tên action mà §5.1.2 ghi.
*Không* chọn phương án dispatch hai lần `BEGIN_OR_COMMIT_CONNECTION`: nó bắt
kết quả một cử chỉ phụ thuộc vào thứ tự batching của React thay vì vào reducer.

**QĐ-3 — `featureState` chảy từ registry xuống reducer.**
`FbdPaletteEntry.featureState: LibraryFeatureState`; `toPaletteEntry` mang theo;
`userPouPaletteEntry` gán `'AVAILABLE'` (POU người dùng không thuộc registry
duyệt sản phẩm). `ADD_NODE` tra `fbdPaletteEntry(node.typeRef)`; entry tồn tại
và `featureState !== 'AVAILABLE'` ⇒ reject `block-review-required`, 0 node.
Entry `undefined` (node INPUT/OUTPUT/CONSTANT/POU) ⇒ không chặn.

**QĐ-4 — Click-to-place là hai nhịp có ghost, đúng §6.3.**
Bấm "Chèn" trong Thư viện nhanh **không** thêm node ngay: nó nạp
`pendingPlacement = { entryId }`. Ghost bám con trỏ trên canvas; `pointerup`
trên nền canvas ⇒ `ADD_NODE` tại `snapPoint(screenToGraph(...))`. `Escape` hoặc
thả ngoài canvas ⇒ huỷ, **0** mutation (`TC-FBD-LIB-002`).

**QĐ-5 — Hai kênh cử chỉ, mỗi lần chỉ một kênh được nhận.**
`nativeDragSessionId` (HTML5 DnD, `application/x-mkddc-library-entry`, chuột) và
`pointerPlacementSessionId` (click-to-place). Kênh nào commit/huỷ trước sẽ xoá
`pendingPlacement`, kênh còn lại thấy `null` và no-op.

**QĐ-6 — Huỷ transient theo đủ 4 lối, không chỉ Escape** (§6.2 quy tắc 7).
`Escape`, `pointercancel`, `lostpointercapture`, và thả ngoài canvas đều xoá
ghost + `wirePreview` rồi trả focus về `sectionRef`. Escape hiện có ở
`FbdCanvas.tsx:136-148` chỉ xoá pan/drag/marquee — mở rộng cùng chỗ đó.

**QĐ-7 — Một cổng `canEdit` duy nhất cho mọi đường mutation mới.**
Drop target, click-to-place, phím tắt chèn và wire controller đều thoát sớm khi
`!canEdit`, cùng chỗ `beginDrag` đang kiểm (`FbdCanvas.tsx:321`). Chính sách
viewport `<768px` read-only (§7.5) thuộc **Task 8** theo bảng §14.2
(`TC-FBD-RESP-003` → Task 8); Task 6 không hiện thực nó, chỉ để lại đúng một
cổng để Task 8 siết một chỗ.

**QĐ-8 — Phím tắt chèn dùng chung adapter với click-to-place** (plan §6 step 4).
`Enter`/`Insert` trên thẻ thư viện gọi cùng hàm đặt khối, chọn vị trí trống gần
nhất thay vì toạ độ con trỏ. Không có nhánh nào phát `ADD_WIRE` trong lúc đặt.

**QĐ-9 — Catalog hỏng: hiện lý do + nút Thử lại, không fallback**
(§7.4 `TC-FBD-STATE-005`, plan §6 step 2). `QuickLibraryPanel.tsx:185-189` hiện
mới có `role="alert"` mà thiếu retry, dù `RemoteState.refresh` đã sẵn
(`model/types.ts:799`). Thêm nút `Thử lại` gọi `refresh`; tuyệt đối không dựng
danh sách entry giả khi đọc hỏng.

## 3. Danh sách file (allowlist commit)

Sửa:
1. `src/features/programming/fbd/palette.ts` — G3
2. `src/features/programming/fbd/userPou.ts` — G3
3. `src/features/programming/fbd/commands.ts` — G1, G2, G6, G7
4. `src/features/programming/fbd/FbdCanvasLayers.tsx` — G4, wire preview + ghost layer
5. `src/features/programming/fbd/FbdCanvas.tsx` — G5, drop target + wire controller
6. `src/features/programming/fbd/StructuredFbdEditor.tsx` — nối Quick Library ↔ canvas

7. `src/features/programming/design/library/QuickLibraryPanel.tsx` — QĐ-9 (nút Thử lại)

Test mới:
8. `src/features/programming/fbd/commands.wiring.test.ts`
9. `src/features/programming/fbd/FbdCanvas.placement.test.tsx`

Test mở rộng:
10. `src/features/programming/design/library/QuickLibraryPanel.test.tsx` — PID `draggable=false`, Thử lại
11. `src/features/programming/fbd/StructuredFbdEditor.test.tsx` — đếm bộ lọc tương thích (TC-FBD-LIB-003)

## 3.1 Phân luồng multiagent (Pha 4)

Ba luồng chia theo file, allowlist **không chồng lấn**, nên chạy song song không
tranh chấp cây làm việc. Opus chỉ điều phối: lên plan, dispatch, xét kết quả,
kiểm chứng hợp nhất và viết CHANGELOG.

| Luồng | File độc quyền | Nội dung | Phụ thuộc |
|---|---|---|---|
| A | `commands.ts`, `palette.ts`, `userPou.ts`, `commands.wiring.test.ts` | G1, G2, G3, G6, G7 — tầng reducer + `featureState` | không |
| B | `FbdCanvas.tsx`, `FbdCanvasLayers.tsx`, `StructuredFbdEditor.tsx`, `FbdCanvas.placement.test.tsx` | G4, G5 — drop target, ghost, wire controller | **chờ chữ ký từ A** (`ADD_NODE.position`, `ADD_WIRE`, `validateFbdWireCandidate`) |
| C | `QuickLibraryPanel.tsx`, `QuickLibraryPanel.test.tsx`, `StructuredFbdEditor.test.tsx` | QĐ-9 + test khoá PID + TC-FBD-LIB-003 | không |

B là bước **phụ thuộc**, không dispatch song song với A: nó phải dùng đúng chữ ký
action mà A chốt, nếu đoán trước sẽ phải viết lại toàn bộ tầng gọi dispatch.

Tài liệu: `CHANGELOG.md`, plan này.

Phần đã có sẵn, **không dựng lại**:
- PID lock trên thẻ: `draggable={insertable}` + `disabled={!insertable}`
  (`REVIEW_REQUIRED` → `isInsertable() === false`). Chỉ thêm test khoá hành vi.
- Bộ lọc cổng tương thích (`T59-804`): `paletteEntriesCompatibleWith` +
  `paletteEntryAcceptsType` (`palette.ts:122-135`), checkbox và nhãn đếm ở
  `StructuredFbdEditor.tsx:634-644`, unit test `palette.test.ts:187-206`.
  Task 6 chỉ thêm test mức component cho vế "count UI = count model" của §10.

## 4. Ánh xạ kịch bản test

| ID | File | Khẳng định |
|---|---|---|
| `TC-FBD-LIB-001` | `FbdCanvas.placement.test.tsx` | AVAILABLE: click-place + native drop đều tạo đúng 1 node đúng `typeRef`, đúng network, layout ghi toạ độ đã snap |
| `TC-FBD-LIB-001` (PID) | `commands.wiring.test.ts` + `QuickLibraryPanel.test.tsx` | PID: `draggable=false`, nút disabled, reducer reject `block-review-required`, 0 node |
| `TC-FBD-LIB-002` | `FbdCanvas.placement.test.tsx` | Escape khi đang ghost, và drop ngoài canvas: 0 `onChange`, 0 history |
| `TC-FBD-LIB-004` | `FbdCanvas.placement.test.tsx` | Đặt block khi đang chọn một port: `wires.length` không đổi |
| `TC-FBD-WIRE-001` | `commands.wiring.test.ts` | `ADD_WIRE` hợp lệ ⇒ 1 wire, 1 `past`, endpoint canonical |
| `TC-FBD-WIRE-002` | `commands.wiring.test.ts` | BOOL→REAL, unit lệch, fan-in, khác network, ngược order, vượt `FBD_MAX_WIRES` ⇒ 0 wire, 0 `past`, đúng mã announcement |
| `TC-FBD-WIRE-003` | `FbdCanvas.placement.test.tsx` | Bốn lối: kéo pointer chuột, tap-tap touch, **Ctrl click-click**, Enter bàn phím — cùng validator, cùng kết quả |
| `TC-FBD-LIB-003` | `StructuredFbdEditor.test.tsx` | Chọn cổng BOOL rồi REAL, bật/tắt bộ lọc: số trong nhãn = số option thật trong `<select>` |
| `TC-FBD-STATE-005` | `QuickLibraryPanel.test.tsx` | Catalog lỗi: hiện lý do + nút `Thử lại` gọi `refresh`, 0 entry fallback |
| QĐ-6 | `FbdCanvas.placement.test.tsx` | `pointercancel` và `lostpointercapture` giữa cử chỉ: ghost/preview biến mất, 0 `onChange` |
| G1 | `commands.wiring.test.ts` | `ADD_NODE` + `position` ⇒ 1 node + 1 layout entry + **1** `past`; position phi-hữu-hạn ⇒ `invalid-position`, 0 diff |
| G4 | `FbdCanvas.placement.test.tsx` | `pointerdown` trên port không kích hoạt node drag (không có `SET_NODE_POSITION`) |

## 5. Lệnh kiểm chứng (Pha 5)

```bash
cd apps/web-ui
npx vitest --run --environment jsdom src/features/programming/fbd src/features/programming/design/library
npx vitest --run --environment jsdom src        # 206 file / 2532 test, không hồi quy
npm run lint                                    # gồm check:ui-strings
npm run typecheck
npm run check:bundle-budget                     # chunk programming ≤ 125 KiB (R1)
```

Ghi số đo thật vào CHANGELOG; không dẫn lại số của phiên trước.

## 6. Rủi ro đã lường

- **Bundle:** không thêm dependency, không import chéo từ `ProgramsTab.tsx`.
  `FbdCanvasLayers`/`FbdCanvas` vốn đã nằm trong chunk `programming`.
- **A11y:** không đụng `ProgrammingHeader.tsx`; ghost và wire preview đặt
  `pointerEvents="none"` + `aria-hidden`, kèm announcement qua vùng `aria-live`
  đã có ở `StructuredFbdEditor.tsx:833`.
- **Hồi quy:** `position` và `featureState` đều tuỳ chọn/thêm mới nên các call
  site cũ giữ nguyên chữ ký; `BEGIN_OR_COMMIT_CONNECTION` giữ nguyên hành vi.
