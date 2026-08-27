import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AlignLeft, Command, Library, PlusSquare, Redo2, Save, Search, Undo2, X } from 'lucide-react'
import { useI18n } from '../../../../shared/i18n'
import { useAuth, roleAtLeast } from '../../../auth'
import { Button } from '../../../../shared/components/Button'
import { StructuredFbdEditor } from '../../fbd/StructuredFbdEditor'
import type { FbdSelection } from '../../fbd/commands'
import { ContextInspector } from '../inspector/ContextInspector'
import { canonicalFbdJson, type FbdDocument } from '../../fbd/model'
import { emptyFbdDocument } from '../pou/pouTemplates'
import type { UserPouInterface } from '../../fbd/userPou'
import { useLazyProgrammingPointCatalog } from '../../api/queries'
import type {
  ProgrammingDiagnostic,
  ProgrammingDraftDocument,
  ProgrammingDraftOperation,
  ProgrammingPointCatalogEntry,
  ProgrammingProgram,
  ProgrammingProgramDraftInput,
} from '../../model/types'
import {
  buildStCompletions,
  computeAutoIndent,
  createStEditorHistory,
  currentWordPrefix,
  findMatchingBracket,
  mergeDiagnosticRanges,
  recordStEditorEdit,
  redoStEditorEdit,
  tokenizeStSource,
  undoStEditorEdit,
  updateStEditorSelection,
  type StCompletionItem,
  type StDiagnosticRange,
} from './stEditorSupport'
import { StRuntimeValueOverlay, type StRuntimeOverlayState } from './StRuntimeValueOverlay'
import { CommandPalette } from './CommandPalette'
import { InsertPointVariablePanel } from './InsertPointVariablePanel'
import { QuickLibraryHost } from '../library/QuickLibraryPanel'
import type { CatalogEntry } from '../library/libraryCatalog'
import { collectDeclaredInstances, nextInstanceName, planLibraryInsertion } from './stInstanceInsertion'
import { FbInstancePicker } from './FbInstancePicker'
import { buildStReferenceIndex, stSymbolAt, type StCursorSymbol } from './stReferenceIndex'
import { StCrossReferencePanel } from './StCrossReferencePanel'
import { SelectionQuickActions } from './SelectionQuickActions'
import { buildCommandPaletteEntries, toggleComment, wrapInBlock, type PaletteEntry, type ProgramSymbolLike } from './quickControl'


/** Nguồn chân lý DUY NHẤT cho số đo ST editor — gutter số dòng, overlay tô
 *  cú pháp, textarea, dải highlight active-line và điểm neo dropdown gợi ý
 *  ĐỀU phải dùng đúng các hằng số này, áp bằng INLINE STYLE (không qua class
 *  Tailwind `text-sm`/`leading-5`/`p-3`).
 *
 *  Lý do bắt buộc inline style — đây là nguyên nhân gốc thật của lỗi lệch
 *  dòng/nhoè chữ báo qua ảnh chụp 2026-08-17 (FE-ST-001..006), KHÔNG phải
 *  do tính sai `background-position` như bản vá trước đó tưởng: `styles.css`
 *  có rule `button, input, select, textarea { font: inherit }` nằm NGOÀI mọi
 *  `@layer` (chỉ có `@import "tailwindcss"` ở đầu file, còn lại là CSS trần).
 *  Theo CSS Cascade Layers, rule không-layer LUÔN thắng rule có layer bất kể
 *  độ đặc hiệu — nên nó âm thầm đè `text-sm`/`leading-5` của Tailwind CHỈ
 *  trên `<textarea>` (không đè `<pre>` gutter/overlay vì chúng không khớp
 *  selector đó), khiến textarea render chữ theo font-size/line-height KẾ
 *  THỪA từ phần tử cha — không phải 14px/20px như gutter/overlay giả định.
 *  Caret và vùng chọn thật của trình duyệt (do chính textarea vẽ) vì vậy
 *  lệch khỏi lưới 20px, và độ lệch CỘNG DỒN theo từng dòng — khớp chính xác
 *  hiện tượng "dòng đầu gần đúng, dòng 9-10 lệch hẳn" trong ảnh chụp. Textarea
 *  đã phải dùng inline style cho `color`/`caretColor` vì đúng lý do này (xem
 *  comment tại chỗ khai báo `style` của textarea) — nay áp dụng nhất quán
 *  cho CẢ BA lớp thay vì chỉ hai thuộc tính màu.
 *
 *  Theo khuyến nghị người dùng: KHÔNG kẻ lưới từng dòng nữa (mọi code editor
 *  chuẩn — VS Code, Sublime — chỉ highlight active-line, không kẻ toàn bộ
 *  hàng). Lưới cũ (`EDITOR_ROW_GRID`) đã bỏ hẳn. */
const EDITOR_FONT_SIZE_PX = 14
const EDITOR_ROW_HEIGHT_PX = 20
const EDITOR_PAD_TOP_PX = 12
const EDITOR_PAD_X_PX = 12
const EDITOR_GUTTER_PAD_X_PX = 8
const EDITOR_TAB_SIZE = 2
const EMPTY_USER_POU_INTERFACES: readonly UserPouInterface[] = []

interface StFormatRequest {
  programId: string
  nonce: number
}

/** Áp cho CẢ BA lớp (gutter/overlay/textarea) — chỉ khác `paddingLeft`/
 *  `paddingRight` giữa gutter (căn phải, đệm hẹp hơn) và overlay/textarea. */
const EDITOR_TEXT_METRICS: CSSProperties = {
  fontFamily: '"JetBrains Mono", "Roboto Mono", Consolas, ui-monospace, SFMono-Regular, monospace',
  fontSize: `${EDITOR_FONT_SIZE_PX}px`,
  lineHeight: `${EDITOR_ROW_HEIGHT_PX}px`,
  paddingTop: `${EDITOR_PAD_TOP_PX}px`,
  paddingBottom: `${EDITOR_PAD_TOP_PX}px`,
  tabSize: EDITOR_TAB_SIZE,
}

/**
 * Tab "Chương trình" của PGM-02 (`UJ-PROG-02`) — `ApplicationTree` + editor +
 * `Inspector`, bố cục 3 cột đúng `PROGRAMMING_UI_UX_DESIGN.md` §16.2
 * (`Cây 280 px ┬ Editor FBD/ST co giãn ┬ Inspector 308 px`, WP-11 — trước đó
 * `Inspector` (thuộc tính Program) bị đặt nằm DƯỚI editor thay vì làm cột
 * riêng, đúng finding G-7 trong gap report 2026-08-15). FBD là lối vào ưu
 * tiên (UX §16.2): `StructuredFbdEditor` sẵn có (`TASK-PROG-201`,
 * keyboard-first, undo/redo bounded) được mount thẳng ở đây, không viết
 * model/reducer/shortcut thứ hai (TASK-PROG-502).
 */

/**
 * `T59-807` / `WP-01` (phần đi cùng `WP-06`) — hai cột biên của workbench thu
 * gọn được.
 *
 * Ở 1280 px, ba cột `280px + 1fr + 308px` chỉ chừa ~690 px cho chính chỗ người
 * dùng gõ. Thu gọn một biên trả lại ~280 px cho editor — đúng thứ họ đang nhìn.
 *
 * Lớp lưới phải là chuỗi **nguyên văn** trong source: Tailwind quét tĩnh, một
 * lớp ghép bằng template string sẽ không có trong CSS build ra và cột sẽ im
 * lặng rơi về mặc định.
 */
const SLOT_GRID_CLASS = {
  'both-open': 'lg:grid-cols-[280px_1fr_308px]',
  'left-closed': 'lg:grid-cols-[44px_1fr_308px]',
  'inspector-closed': 'lg:grid-cols-[280px_1fr_44px]',
  'both-closed': 'lg:grid-cols-[44px_1fr_44px]',
} as const

export interface ProgramsSlotState { left: boolean; inspector: boolean }

export function slotKey(slots: ProgramsSlotState): keyof typeof SLOT_GRID_CLASS {
  if (slots.left && slots.inspector) return 'both-open'
  if (!slots.left && !slots.inspector) return 'both-closed'
  return slots.left ? 'inspector-closed' : 'left-closed'
}

const SLOT_STORAGE_KEY = 'mkddc-pgm02-slots'

/** Nhớ theo trình duyệt của từng người; hỏng storage thì mở cả hai, không ném. */
function useCollapsibleSlots(): [ProgramsSlotState, (next: ProgramsSlotState) => void] {
  const [slots, setSlots] = useState<ProgramsSlotState>(() => {
    try {
      const raw = window.localStorage.getItem(SLOT_STORAGE_KEY)
      if (!raw) return { left: true, inspector: true }
      const parsed = JSON.parse(raw) as Partial<ProgramsSlotState>
      return { left: parsed.left !== false, inspector: parsed.inspector !== false }
    } catch {
      return { left: true, inspector: true }
    }
  })
  return [slots, (next) => {
    setSlots(next)
    try { window.localStorage.setItem(SLOT_STORAGE_KEY, JSON.stringify(next)) } catch { /* riêng tư/hết quota — không chặn thao tác */ }
  }]
}

export function ProgramsTab({
  document,
  saving,
  selectedProgramId,
  onSelectProgram,
  onSave,
  diagnostics,
  focusDiagnostic,
  focusFbdSelection,
  onPendingOperationsChange,
  discardVersion,
  onRunCheck,
  runtimeOverlayByProgramId,
  userPouInterfaces = EMPTY_USER_POU_INTERFACES,
  forceReadOnly = false,
}: {
  document: ProgrammingDraftDocument
  saving: boolean
  selectedProgramId: string | undefined
  onSelectProgram: (programId: string | undefined) => void
  onSave: (operations: ProgrammingDraftOperation[]) => Promise<boolean>
  diagnostics: ProgrammingDiagnostic[]
  focusDiagnostic: ProgrammingDiagnostic | null
  focusFbdSelection?: { programId: string; selection: FbdSelection } | null
  onPendingOperationsChange: (operations: ProgrammingDraftOperation[]) => void
  discardVersion: number
  /** ST Editor Quick Control đề xuất #2 (Bảng lệnh nhanh), mục "Kiểm tra": PGM-02
   *  không tự chạy Check nữa từ D-01 — chỉ điều hướng sang PGM-03 giống hệt nút
   *  "Kiểm tra" ở `DesignWorkspacePage`, nên nhận callback thay vì tự `useNavigate`
   *  (giữ `ProgramsTab` không phụ thuộc router, đúng ranh giới hiện có). */
  onRunCheck: () => void
  /** T59-506: dữ liệu chỉ đọc do workspace map từ monitor authority. Không có
   * prop nghĩa là lane monitor chưa được nối, editor không dựng giá trị giả. */
  runtimeOverlayByProgramId?: Readonly<Record<string, StRuntimeOverlayState | undefined>>
  /** Interface POU typed do Draft/API cung cấp; FBD không tự parse ST để đoán pin. */
  userPouInterfaces?: readonly UserPouInterface[]
  /** Policy viewport từ route: dưới 768 px thắng cả quyền admin. */
  forceReadOnly?: boolean
}) {
  const { pick } = useI18n()
  const { session } = useAuth()
  const canEdit = roleAtLeast(session?.role, 'admin') && !forceReadOnly
  const selected = document.programs.find((program) => program.programId === selectedProgramId)
  /* `T59-818` — ngữ cảnh cho Inspector dùng chung. Hai nguồn được NÂNG lên đây
   * thay vì để Inspector tự đọc state của editor: một Inspector dùng chung mà
   * tự đọc state riêng của từng editor sẽ có hai định nghĩa "đang chọn cái gì".
   */
  const [cursorSymbol, setCursorSymbol] = useState<StCursorSymbol | null>(null)
  const [fbdSelection, setFbdSelection] = useState<FbdSelection | null>(null)
  const [buffers, setBuffers] = useState<Record<string, string>>({})
  /* Tài liệu FBD của POU đang chọn, parse MỘT lần cho Inspector. Chỉ dựng khi
   * POU thật sự là FBD: parse một tài liệu ST thành FBD sẽ cho một đồ thị rỗng
   * trông hợp lệ, và Inspector sẽ nói về một sơ đồ không tồn tại. */
  const inspectorFbdDocument = useMemo(
    () => (selected && selected.language === 'FBD'
      ? parseFbdDocument(buffers[selected.programId] ?? selected.document, selected.name)
      : null),
    [buffers, selected],
  )
  const [projectTagsDraft, setProjectTagsDraft] = useState(() => document.project.functionalTags.join(', '))
  const [metadataDrafts, setMetadataDrafts] = useState<Record<string, ProgramMetadataDraft>>({})

  /* ST Editor Quick Control (đã duyệt) — quyết định #02: hook LAZY, không
   * fetch `GET /point-catalog` khi mở tab Chương trình; sống ở đây (cha của
   * `SourceEditor`) để cache còn nguyên khi đổi Program đang chọn. */
  const pointCatalog = useLazyProgrammingPointCatalog()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [slots, setSlots] = useCollapsibleSlots()
  const [formatRequest, setFormatRequest] = useState<StFormatRequest | null>(null)
  /* Điều hướng chéo Program khi chọn một biến ở Bảng lệnh nhanh: đổi
   * `selectedProgramId` rồi TÁI DÙNG đúng cơ chế `focusDiagnostic` đã có
   * (D-01) — không viết thêm một prop/hiệu ứng thứ hai cho cùng việc "chọn
   * vùng theo line/column sau khi Program mới mount". */
  const [paletteJumpTarget, setPaletteJumpTarget] = useState<ProgrammingDiagnostic | null>(null)

  /* Quyết định #04: chỉ mục Bảng lệnh nhanh tính lại theo `buffers`/
   * `document.programs` — KHÔNG theo chuỗi tìm kiếm (đó là việc lọc rẻ ở
   * `CommandPalette`, xem `quickControl.ts`). */
  const symbolsByProgramId = useMemo(() => {
    const index: Record<string, ProgramSymbolLike[]> = {}
    for (const program of document.programs) {
      if (program.language !== 'ST') continue
      index[program.programId] = collectStSymbols(buffers[program.programId] ?? programSource(program))
    }
    return index
  }, [buffers, document.programs])

  const paletteEntries = useMemo<PaletteEntry[]>(
    () => buildCommandPaletteEntries(document.programs, symbolsByProgramId, pick)
      .filter((entry) => canEdit || entry.kind !== 'command'),
    [canEdit, document.programs, symbolsByProgramId, pick],
  )

  useEffect(() => {
    setBuffers((current) => {
      const next = { ...current }
      for (const program of document.programs) {
        if (next[program.programId] === undefined) next[program.programId] = programSource(program)
      }
      return next
    })
    setMetadataDrafts((current) => {
      const next = { ...current }
      for (const program of document.programs) {
        if (!next[program.programId]) next[program.programId] = metadataOf(program)
      }
      return next
    })
  }, [document.programs])

  const pendingOperations = useMemo<ProgrammingDraftOperation[]>(() => {
    const operations: ProgrammingDraftOperation[] = []
    const projectTags = parseTags(projectTagsDraft)
    if (!sameTags(projectTags, document.project.functionalTags)) operations.push({ op: 'setFunctionalTags', tags: projectTags })
    for (const program of document.programs) {
      const source = buffers[program.programId] ?? programSource(program)
      const metadata = metadataDrafts[program.programId] ?? metadataOf(program)
      const sourceChanged = source !== programSource(program)
      const metadataChanged = !sameMetadata(metadata, metadataOf(program))
      const nextName = metadata.name.trim()
      if (metadataChanged && isValidPouName(nextName)) {
        operations.push({
          op: 'upsertProgram',
          program: programDraftInput(program, { name: nextName, kind: metadata.kind, document: source })
        })
      } else if (sourceChanged) {
        /* Metadata không hợp lệ không được lọt qua một nút Lưu khác. Phần mã
         * nguồn vẫn có operation riêng, nên người dùng không mất edit hợp lệ
         * chỉ vì ô tên đang mang một giá trị bị backend từ chối. */
        operations.push({ op: 'replaceProgramSource', programId: program.programId, language: program.language, source })
      }
    }
    return operations
  }, [buffers, document.programs, document.project.functionalTags, metadataDrafts, projectTagsDraft])

  useEffect(() => onPendingOperationsChange(pendingOperations), [onPendingOperationsChange, pendingOperations])

  useEffect(() => {
    setProjectTagsDraft(document.project.functionalTags.join(', '))
    setBuffers(Object.fromEntries(document.programs.map((program) => [program.programId, programSource(program)])))
    setMetadataDrafts(Object.fromEntries(document.programs.map((program) => [program.programId, metadataOf(program)])))
  }, [discardVersion])

  /** Chỉ transform TEXT buffer local qua `setBuffers` — không tự Lưu, không
   *  tự Kiểm tra (đúng ranh giới ST Editor Quick Control đã duyệt). */
  function handlePaletteSelect(entry: PaletteEntry) {
    if (entry.kind === 'program') {
      onSelectProgram(entry.programId)
      return
    }
    if (entry.kind === 'variable') {
      onSelectProgram(entry.programId)
      const source = buffers[entry.programId] ?? ''
      const { line, column } = offsetToLineColumn(source, entry.offset)
      setPaletteJumpTarget({
        code: '', severity: 'ERROR', messageKey: '',
        location: { programId: entry.programId, line, column, length: entry.length },
      })
      return
    }
    if (!canEdit) return
    if (entry.commandId === 'format') {
      if (!selectedProgramId) return
      /* Chuyển lệnh vào SourceEditor để đi qua cùng history/cursor pipeline
       * với nút Định dạng; sửa buffer trực tiếp ở đây sẽ biến format từ
       * Command Palette thành baseline mới và làm mất toàn bộ Undo trước đó. */
      setFormatRequest((current) => ({ programId: selectedProgramId, nonce: (current?.nonce ?? 0) + 1 }))
      return
    }
    if (entry.commandId === 'save') {
      void onSave(pendingOperations)
      return
    }
    onRunCheck()
  }

  return (
    <div
      className={`grid gap-4 md:grid-cols-[280px_1fr] ${SLOT_GRID_CLASS[slotKey(slots)]}`}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
          event.preventDefault()
          setPaletteOpen(true)
        }
      }}
    >
      {/* F-UX-15: tab con phải có mốc tiêu đề riêng trong cây heading. `<h1>`
          thuộc layout của feature, `<h2>` thuộc màn hình cha, nên tab là
          `<h3>`. Ẩn thị giác vì thanh tab đã hiện tên. */}
      <h3 className="sr-only">{pick('Chương trình', 'Programs')}</h3>
      <CommandPalette open={paletteOpen} entries={paletteEntries} onClose={() => setPaletteOpen(false)} onSelect={handlePaletteSelect} />
      {/* `T59-803`: cây POU nay do `PouExplorer` sở hữu (đúng MỘT navigation
          trong DOM). Ở đây chỉ còn thứ thuộc về Project chứ không thuộc về cây:
          nhãn chức năng và lối vào Bảng lệnh nhanh. */}
      {slots.left ? (
      <div className="rounded-[var(--radius)] border border-[var(--c-border)] p-2">
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            className="rounded px-2 py-1 text-xs text-[var(--c-text-dim)] hover:text-[var(--c-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
            aria-expanded
            aria-controls="programs-slot-left"
            onClick={() => setSlots({ ...slots, left: false })}
          >
            {pick('Thu gọn cột trái', 'Collapse left column')}
          </button>
        </div>
        <div id="programs-slot-left">
        <ProjectTagsEditor
          canEdit={canEdit}
          value={projectTagsDraft}
          saving={saving}
          onChange={setProjectTagsDraft}
          onSave={() => onSave([{ op: 'setFunctionalTags', tags: parseTags(projectTagsDraft) }])}
        />
        <div className="mt-2 flex justify-end px-1">
          <button
            type="button"
            className="rounded p-1 text-[var(--c-text-dim)] hover:text-[var(--c-accent)]"
            title={pick('Bảng lệnh nhanh (Ctrl+P)', 'Command palette (Ctrl+P)')}
            onClick={() => setPaletteOpen(true)}
          >
            <Command className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{pick('Bảng lệnh nhanh', 'Command palette')}</span>
          </button>
        </div>
        </div>
      </div>
      ) : (
        <div className="rounded-[var(--radius)] border border-[var(--c-border)] p-1">
          <button
            type="button"
            className="min-h-11 w-full rounded px-1 py-2 text-[10px] leading-tight text-[var(--c-text-dim)] hover:text-[var(--c-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
            aria-expanded={false}
            aria-controls="programs-slot-left"
            onClick={() => setSlots({ ...slots, left: true })}
          >
            {pick('Mở cột trái', 'Expand left column')}
          </button>
        </div>
      )}
      {/* `min-w-0` KHÔNG phải trang trí: ô lưới mặc định `min-width: auto`, nên
          một con rộng bên trong (canvas FBD, thanh công cụ ST, khay workbench)
          kéo track `1fr` phình ra thay vì tự cuộn — và cả trang tràn ngang.
          Đo được ở 1024 px: document 1039 px trên viewport 1024 px. Tràn ngang
          trên tủ điều khiển đẩy nút thao tác ra ngoài vùng chạm, mà người vận
          hành không có chuột để cuộn ngang. */}
      <div className="min-w-0">
        {!selected ? (
          <p className="text-sm text-[var(--c-text-dim)]">{pick('Chọn một chương trình ở cây bên trái.', 'Select a program from the tree on the left.')}</p>
        ) : selected.language === 'ST' ? (
          <SourceEditor
            program={selected}
            source={buffers[selected.programId] ?? programSource(selected)}
            canEdit={canEdit}
            saving={saving}
            onCursorSymbolChange={setCursorSymbol}
            diagnostics={diagnostics.filter((item) => item.location?.programId === selected.programId)}
            focusDiagnostic={
              paletteJumpTarget?.location?.programId === selected.programId ? paletteJumpTarget
              : focusDiagnostic?.location?.programId === selected.programId ? focusDiagnostic
              : null
            }
            onChange={(source) => setBuffers((current) => ({ ...current, [selected.programId]: source }))}
            onSave={onSave}
            pointCatalogStatus={pointCatalog.status}
            pointCatalogItems={pointCatalog.data?.items ?? []}
            pointCatalogError={pointCatalog.error}
            onEnsurePointCatalogLoaded={pointCatalog.ensureLoaded}
            runtimeOverlay={runtimeOverlayByProgramId?.[selected.programId]}
            formatRequest={formatRequest?.programId === selected.programId ? formatRequest : undefined}
            projectId={document.project.projectId}
          />
        ) : (
          <FbdEditorPane
            program={selected}
            source={buffers[selected.programId] ?? programSource(selected)}
            canEdit={canEdit}
            saving={saving}
            onChange={(source) => setBuffers((current) => ({ ...current, [selected.programId]: source }))}
            onSave={onSave}
            userPouInterfaces={userPouInterfaces}
            projectId={document.project.projectId}
            onSelectionChange={setFbdSelection}
            focusSelection={focusFbdSelection?.programId === selected.programId ? focusFbdSelection.selection : null}
          />
        )}
      </div>
      <aside className="min-w-0" aria-label={pick('Thuộc tính', 'Inspector')}>
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            className="rounded px-2 py-1 text-xs text-[var(--c-text-dim)] hover:text-[var(--c-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
            aria-expanded={slots.inspector}
            aria-controls="programs-slot-inspector"
            onClick={() => setSlots({ ...slots, inspector: !slots.inspector })}
          >
            {slots.inspector ? pick('Thu gọn Thuộc tính', 'Collapse inspector') : pick('Mở Thuộc tính', 'Expand inspector')}
          </button>
        </div>
        <div id="programs-slot-inspector" hidden={!slots.inspector}>
        {selected ? (
          /* `T59-818` — khay này TỪNG có đúng hai trường (`Tên`, `Loại`), tức
             rơi trúng điều handoff §9 cấm: chiếm 300px cho hai trường. Nay nó
             là Inspector năm ngữ cảnh dùng chung ST↔FBD; phần sửa metadata vẫn
             do `ProgramsTab` sở hữu vì nó gắn với transaction Draft. */
          <ContextInspector
            input={{
              program: selected,
              /* Chu kỳ đi theo TỪNG POU (`programs[]`), không lấy từ
                 `task.periodMs` — trong Project nhiều chu kỳ, giá trị đó chỉ là
                 chu kỳ của Program đầu tiên. */
              cycleMs: selected.periodMs ?? null,
              /* Intent Enable/Disable sống ở API runtime-intent, chưa được nối
                 vào tab này. Để `null` ⇒ Inspector hiện "không xác định được";
                 hiện `Đã tắt` cho một thứ chưa đọc là nói dối về thiết bị. */
              enabled: null,
              cursorSymbol,
              fbd: inspectorFbdDocument
                ? { document: inspectorFbdDocument, selection: fbdSelection }
                : null,
              runtime: runtimeOverlayByProgramId?.[selected.programId] ?? null,
            }}
            editableProgramSlot={
              <ProgramInspector
                program={selected}
                programs={document.programs}
                draft={metadataDrafts[selected.programId] ?? metadataOf(selected)}
                canEdit={canEdit}
                saving={saving}
                onChange={(draft) => setMetadataDrafts((current) => ({ ...current, [selected.programId]: draft }))}
                onSave={onSave}
              />
            }
          />
        ) : (
          <section className="rounded-[var(--radius)] border border-[var(--c-border)] p-3">
            <h3 className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Thuộc tính', 'Inspector')}</h3>
            <p className="mt-2 text-xs text-[var(--c-text-dim)]">
              {pick('Chọn một chương trình để xem thuộc tính.', 'Select a program to see its properties.')}
            </p>
          </section>
        )}
        </div>
      </aside>
    </div>
  )
}

export function SourceEditor({
  program,
  source,
  canEdit,
  saving,
  diagnostics,
  focusDiagnostic,
  onChange,
  onSave,
  pointCatalogStatus,
  pointCatalogItems,
  pointCatalogError,
  onEnsurePointCatalogLoaded,
  runtimeOverlay,
  formatRequest,
  projectId,
  onCursorSymbolChange,
}: {
  program: ProgrammingProgram
  source: string
  canEdit: boolean
  saving: boolean
  diagnostics: ProgrammingDiagnostic[]
  focusDiagnostic: ProgrammingDiagnostic | null
  onChange: (source: string) => void
  onSave: (operations: ProgrammingDraftOperation[]) => Promise<boolean>
  /** `T59-804`: Quick Library đọc catalog theo Project để thấy cả PROJECT entry,
   *  không chỉ SYSTEM. `undefined` vẫn hợp lệ — khi đó chỉ có SYSTEM. */
  projectId?: string
  /** ST Editor Quick Control đề xuất #3 (Panel chèn nhanh Point/Variable) —
   *  trạng thái/cache của `useLazyProgrammingPointCatalog`, sống ở
   *  `ProgramsTab` (cha) để không refetch khi đổi Program đang mở. */
  pointCatalogStatus: 'idle' | 'loading' | 'ready' | 'error'
  pointCatalogItems: readonly ProgrammingPointCatalogEntry[]
  pointCatalogError: string | null
  onEnsurePointCatalogLoaded: () => void
  runtimeOverlay?: StRuntimeOverlayState
  /** Lệnh Định dạng từ Command Palette cha; vẫn phải ghi history như nút local. */
  formatRequest?: StFormatRequest
  /**
   * `T59-818` — nâng ký hiệu dưới con trỏ lên cho `ContextInspector` dùng chung.
   *
   * Inspector phục vụ cả ST lẫn FBD nên nó không được tự đọc state con trỏ của
   * editor này; nếu tự đọc thì có hai nơi cùng tính "ký hiệu đang chọn" và
   * chúng sẽ lệch nhau đúng lúc con trỏ nằm ở ranh giới một định danh.
   */
  onCursorSymbolChange?: (symbol: StCursorSymbol | null) => void
}) {
  const { pick } = useI18n()
  const committed = typeof program.document === 'string' ? program.document : ''
  const dirty = source !== committed
  /* D-02: chặn lưu ST rỗng — compiler luôn Check FAILED, Save không nên để
   * người dùng tự khám phá điều đó sau một vòng round-trip mạng. */
  const isEmptySource = source.trim().length === 0
  const canSave = dirty && !isEmptySource
  /* FE-ST-008: phân biệt rõ Saved/Saving/Failed thay vì chỉ disable nút Save
   * không giải thích. `lastAttemptedSourceRef` neo trạng thái 'saved'/'failed'
   * vào ĐÚNG giá trị buffer đã thử lưu — gõ tiếp sau một lần lưu thất bại
   * phải rơi về "Chưa lưu" (ưu tiên hơn), không giữ mãi "Lưu thất bại" cho một
   * buffer đã khác. */
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'failed'>('idle')
  const lastAttemptedSourceRef = useRef<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lineGutterRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLPreElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const [cursorOffset, setCursorOffset] = useState(0)
  const [completion, setCompletion] = useState<{ open: boolean; items: StCompletionItem[]; selected: number; anchor: number }>(
    { open: false, items: [], selected: 0, anchor: 0 },
  )
  /* ST Editor Quick Control #1 (Thanh lệnh nhanh nổi): vùng chọn KHÔNG rỗng
   * hiện tại — `null` khi con trỏ chỉ là một điểm (không hiện thanh lệnh). */
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number } | null>(null)
  const [insertPanelOpen, setInsertPanelOpen] = useState(false)
  const [libraryPanelOpen, setLibraryPanelOpen] = useState(false)
  /* T59-506: một lịch sử riêng cho MỖI POU đang mount. Ref cho phép mọi đường
   * edit (gõ thường/autocomplete/Format/Replace/quick action) ghi snapshot trước
   * khi callback cha echo lại prop `source`; state rỗng chỉ dùng để render lại
   * trạng thái nút Undo/Redo. */
  const historyProgramIdRef = useRef(program.programId)
  const historyRef = useRef(createStEditorHistory(source))
  const [, bumpHistoryVersion] = useState(0)
  const symbols = useMemo(() => collectStSymbols(source), [source])
  /* `AC-ST-005` — chỉ mục tham chiếu dựng từ nguồn đang gõ. Dùng cho ĐIỀU
   * HƯỚNG (nhảy tới khai báo, đếm nơi đọc/ghi), không phải để phán nguồn
   * đúng/sai: việc đó vẫn của Check ở Core. */
  const referenceIndex = useMemo(() => buildStReferenceIndex(source), [source])
  const cursorSymbol = useMemo(
    () => stSymbolAt(source, cursorOffset, referenceIndex),
    [source, cursorOffset, referenceIndex],
  )
  /* Phát ra ngoài khi ký hiệu đổi. `useEffect` chứ không gọi trong render: gọi
   * trong render sẽ set state của cha giữa lúc con đang render. */
  useEffect(() => {
    onCursorSymbolChange?.(cursorSymbol)
  }, [cursorSymbol, onCursorSymbolChange])
  const matches = useMemo(() => findTextMatches(source, searchText), [searchText, source])
  const tokens = useMemo(() => tokenizeStSource(source), [source])
  const diagnosticRanges = useMemo<StDiagnosticRange[]>(() => diagnostics
    .map((diagnostic, index): StDiagnosticRange | null => {
      if (!diagnostic.location) return null
      const line = typeof diagnostic.location.line === 'number' ? diagnostic.location.line : undefined
      const column = typeof diagnostic.location.column === 'number' ? diagnostic.location.column : undefined
      if (line === undefined || column === undefined) return null
      const length = typeof diagnostic.location.length === 'number' ? diagnostic.location.length : 1
      const start = lineColumnToOffset(source, line, column)
      return { start, end: Math.min(source.length, start + Math.max(1, length)), index }
    })
    .filter((range): range is StDiagnosticRange => range !== null), [diagnostics, source])
  const segments = useMemo(() => mergeDiagnosticRanges(tokens, diagnosticRanges), [tokens, diagnosticRanges])
  const bracketMatch = useMemo(() => findMatchingBracket(source, textareaRef.current?.selectionStart ?? -1), [source, cursor])

  function replaceHistory(next: ReturnType<typeof createStEditorHistory>) {
    historyRef.current = next
    bumpHistoryVersion((version) => version + 1)
  }

  useEffect(() => {
    if (historyProgramIdRef.current === program.programId) return
    historyProgramIdRef.current = program.programId
    replaceHistory(createStEditorHistory(source))
    setCursor({ line: 1, column: 1 })
    setSelectionRange(null)
    closeCompletion()
  }, [program.programId, source])

  /* Thay đổi prop không đi qua editor (Discard, reload hoặc command ngoài
   * editor) là một baseline mới. Echo của chính edit thì đã khớp `current` và
   * không được xóa lịch sử vừa ghi. */
  useEffect(() => {
    if (historyRef.current.current.source === source) return
    const textarea = textareaRef.current
    replaceHistory(createStEditorHistory(
      source,
      textarea?.selectionStart ?? 0,
      textarea?.selectionEnd ?? textarea?.selectionStart ?? 0,
    ))
  }, [source])

  function updateCursor() {
    const textarea = textareaRef.current
    const offset = textarea?.selectionStart ?? 0
    setCursor(offsetToLineColumn(source, offset))
    setCursorOffset(offset)
    const start = textarea?.selectionStart ?? 0
    const end = textarea?.selectionEnd ?? 0
    setSelectionRange(start === end ? null : { start, end })
    historyRef.current = updateStEditorSelection(historyRef.current, start, end)
  }

  function selectRange(offset: number, length: number) {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.focus()
    textarea.setSelectionRange(offset, Math.min(source.length, offset + Math.max(1, length)))
    updateCursor()
  }

  useEffect(() => {
    if (!focusDiagnostic?.location) return
    const line = typeof focusDiagnostic.location.line === 'number' ? focusDiagnostic.location.line : 1
    const column = typeof focusDiagnostic.location.column === 'number' ? focusDiagnostic.location.column : 1
    const length = typeof focusDiagnostic.location.length === 'number' ? focusDiagnostic.location.length : 1
    selectRange(lineColumnToOffset(source, line, column), length)
  }, [focusDiagnostic])

  function closeCompletion() {
    setCompletion({ open: false, items: [], selected: 0, anchor: 0 })
  }

  /* WP-10 P0 (CTO/Owner approval §5): gợi ý sau MỖI keystroke dựa trên
   * `nextSource`/`offset` truyền trực tiếp từ sự kiện — không đọc `source`
   * (state cũ, chưa kịp cập nhật khi hàm này chạy trong cùng handler). */
  function refreshCompletion(nextSource: string, offset: number) {
    const info = currentWordPrefix(nextSource, offset)
    if (!info) { closeCompletion(); return }
    const items = buildStCompletions(info.prefix, collectStSymbols(nextSource))
    if (items.length === 0) { closeCompletion(); return }
    setCompletion({ open: true, items, selected: 0, anchor: info.start })
  }

  /* `<textarea value={source}>` là controlled component — React tự đồng bộ
   * `.value` từ prop `source` mỗi lần render lại. Bản trước ghi tay
   * `textarea.value = next` NGAY TRONG `applyEdit()` rồi mới gọi
   * `setCursor(...)`: `setCursor` là state cục bộ nên kích hoạt một lần
   * render lại ngay lập tức, và ở lần render đó React thấy prop `source`
   * VẪN CHƯA đổi (nó đổi qua `onChange` → state component cha, một nhịp
   * khác) nên reconciliation ghi `.value` VỀ LẠI giá trị `source` cũ —
   * xoá mất chữ vừa gõ ngay trước mắt (lộ rõ khi `onChange` không thật sự
   * cập nhật lại prop `source` đồng bộ, ví dụ test cô lập dùng `vi.fn()`
   * làm `onChange`, nhưng vẫn là rủi ro thật trong app nếu component cha
   * re-render bởi nguồn khác xen giữa). Sửa bằng `pendingCursorRef` +
   * `useLayoutEffect` không phụ thuộc gì (chạy lại sau MỌI lần commit):
   * ghi `.value`/selection SAU KHI React đã tự xử lý xong prop `source` ở
   * lần render đó — không còn ai ghi đè lại nữa, và không cần đợi
   * `requestAnimationFrame` (~16ms) như bản gốc trước ngày 2026-08-15. */
  const pendingCursorRef = useRef<{ value: string; selectionStart: number; selectionEnd: number } | null>(null)

  useLayoutEffect(() => {
    const pending = pendingCursorRef.current
    const textarea = textareaRef.current
    if (!pending || !textarea) return
    pendingCursorRef.current = null
    textarea.value = pending.value
    textarea.selectionStart = pending.selectionStart
    textarea.selectionEnd = pending.selectionEnd
  })

  /** Ghi đè bằng một VÙNG chọn (không chỉ một điểm) — dùng cho "Bọc IF"/"Ghi
   *  chú" (ST Editor Quick Control #1) để người dùng thấy ngay phần vừa đổi,
   *  thay vì con trỏ rơi về một điểm không rõ ràng. `applyEdit` (một điểm,
   *  dùng cho Enter/autocomplete/Find-Replace có sẵn) chỉ còn là trường hợp
   *  riêng của hàm này. */
  function applyEditRange(next: string, selectionStart: number, selectionEnd: number) {
    /* `T59-805` AC: LIVE và màn <768 px KHÔNG được sửa nguồn qua BẤT KỲ đường
     * nào — gõ, dán, thả tệp, IME hay lệnh. `readOnly` của textarea chặn được
     * đường trình duyệt, nhưng nó là một THUỘC TÍNH: một lần refactor quên nó
     * là mọi đường mutation mở lại cùng lúc. Đây là chốt duy nhất mà mọi đường
     * sửa (onChange, chèn, định dạng, tìm-thay, autocomplete, auto-indent) đều
     * đi qua, nên guard đặt ở đây là guard đúng chỗ. */
    if (!canEdit) return
    replaceHistory(recordStEditorEdit(historyRef.current, { source: next, selectionStart, selectionEnd }))
    pendingCursorRef.current = { value: next, selectionStart, selectionEnd }
    onChange(next)
    setCursor(offsetToLineColumn(next, selectionEnd))
    setCursorOffset(selectionEnd)
    setSelectionRange(selectionStart === selectionEnd ? null : { start: selectionStart, end: selectionEnd })
  }

  function applyEdit(next: string, newCursor: number) {
    applyEditRange(next, newCursor, newCursor)
  }

  function applyHistorySnapshot(direction: 'undo' | 'redo') {
    if (!canEdit) return
    const current = historyRef.current
    const next = direction === 'undo' ? undoStEditorEdit(current) : redoStEditorEdit(current)
    if (next === current) return
    historyRef.current = next
    bumpHistoryVersion((version) => version + 1)
    const snapshot = next.current
    pendingCursorRef.current = {
      value: snapshot.source,
      selectionStart: snapshot.selectionStart,
      selectionEnd: snapshot.selectionEnd,
    }
    onChange(snapshot.source)
    setCursor(offsetToLineColumn(snapshot.source, snapshot.selectionEnd))
    setCursorOffset(snapshot.selectionEnd)
    setSelectionRange(snapshot.selectionStart === snapshot.selectionEnd ? null : {
      start: snapshot.selectionStart,
      end: snapshot.selectionEnd,
    })
    closeCompletion()
    textareaRef.current?.focus()
  }

  /** Định dạng lại (nút "Định dạng") và "Thay tất cả" (Find & Replace) từng
   *  gọi thẳng `onChange(next)` — không qua `applyEditRange`/`pendingCursorRef`
   *  — nên sau khi bấm, `cursor` (khay Dòng/cột + dải active-line + hàng
   *  gutter tô đậm) ĐỨNG YÊN ở vị trí CŨ trong khi con trỏ DOM thật của
   *  textarea bị React/trình duyệt đặt lại (thường về offset 0) khi `.value`
   *  bị thay toàn bộ mà không có `pendingCursorRef` ghi đè — lộ đúng lỗi
   *  "chọn dòng A lại hiện dòng B" báo trực tiếp 2026-08-17: khay hiện Dòng
   *  30 trong khi con trỏ thật đã nhảy về Dòng 1. Hai hàm bên dưới ánh xạ vị
   *  trí con trỏ CŨ sang bản MỚI rồi đi qua `applyEditRange` như mọi đường
   *  sửa nội dung khác — giữ khay/høghlight luôn khớp con trỏ thật.
   *
   *  Cả hai đều gọi từ NÚT BẤM ngoài textarea nên focus lúc đó KHÔNG ở
   *  textarea — Chrome âm thầm đặt lại `selectionStart`/`selectionEnd` của
   *  MỘT textarea đang không có focus về 0 ngay sau khi script gán `.value`
   *  (xác nhận bằng log trực tiếp qua Playwright — không tái hiện được bằng
   *  jsdom). `textarea.focus()` NGAY SAU `applyEditRange` — cùng vị trí
   *  tương đối `acceptCompletion` đã dùng từ trước (focus sau khi áp edit,
   *  không phải trong `useLayoutEffect` dùng chung cho MỌI đường sửa nội
   *  dung: gọi `focus()` ở đó ảnh hưởng cả đường gõ phím thường, không cần
   *  thiết và từng gây lệch `cursor` React state trong môi trường test). */
  function handleFormat() {
    const textarea = textareaRef.current
    const rawStart = textarea?.selectionStart ?? 0
    const rawEnd = textarea?.selectionEnd ?? 0
    const next = formatStSource(source)
    applyEditRange(next, mapOffsetByNonWhitespaceCount(source, next, rawStart), mapOffsetByNonWhitespaceCount(source, next, rawEnd))
    textarea?.focus()
  }

  /** Mục thư viện đang chờ người dùng chọn instance (chỉ FB có trạng thái,
   *  và chỉ khi nguồn ĐÃ có instance cùng kiểu — nếu chưa có thì không hỏi,
   *  giữ đúng "≤2 thao tác" của `AC-ST-001`). */
  const [pendingLibraryEntry, setPendingLibraryEntry] = useState<CatalogEntry | null>(null)
  const [libraryInsertionNote, setLibraryInsertionNote] = useState<string | null>(null)
  const [referenceNote, setReferenceNote] = useState<string | null>(null)

  const consumedFormatRequestRef = useRef<string | null>(null)
  useEffect(() => {
    if (!formatRequest || formatRequest.programId !== program.programId) return
    const requestKey = `${formatRequest.programId}:${formatRequest.nonce}`
    if (consumedFormatRequestRef.current === requestKey) return
    consumedFormatRequestRef.current = requestKey
    handleFormat()
  }, [formatRequest, program.programId])

  /** FE-ST-008: một hàm lưu DUY NHẤT cho cả nút Lưu và `Ctrl+S` — ghi lại kết
   *  quả (`saved`/`failed`) neo vào đúng buffer vừa thử, để trạng thái hiển
   *  thị không nói dối khi người dùng gõ tiếp sau một lần lưu thất bại. */
  function handleSaveSource() {
    const attempted = source
    lastAttemptedSourceRef.current = attempted
    void onSave([{ op: 'replaceProgramSource', programId: program.programId, language: 'ST', source: attempted }]).then((ok) => {
      setSaveStatus(ok ? 'saved' : 'failed')
    })
  }

  function acceptCompletion(item: StCompletionItem) {
    const textarea = textareaRef.current
    if (!textarea) return
    const cursorOffset = textarea.selectionStart
    const next = source.slice(0, completion.anchor) + item.label + source.slice(cursorOffset)
    applyEdit(next, completion.anchor + item.label.length)
    textarea.focus()
    closeCompletion()
  }

  /* Enter tự thụt lề theo độ sâu khối hiện tại (`computeAutoIndent`) — chỉ
   * áp dụng khi KHÔNG có dropdown gợi ý đang mở (Enter lúc đó dùng để chấp
   * nhận gợi ý, xử lý ở `onKeyDown`). */
  function handleAutoIndentEnter() {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const insertion = `\n${computeAutoIndent(source, start)}`
    const next = source.slice(0, start) + insertion + source.slice(end)
    applyEdit(next, start + insertion.length)
  }

  function replaceAllMatches() {
    if (!searchText || matches.length === 0) return
    const textarea = textareaRef.current
    const rawStart = textarea?.selectionStart ?? 0
    const rawEnd = textarea?.selectionEnd ?? 0
    const next = source.split(searchText).join(replaceText)
    applyEditRange(
      next,
      mapOffsetAcrossReplaceAll(source, searchText, replaceText, rawStart),
      mapOffsetAcrossReplaceAll(source, searchText, replaceText, rawEnd),
    )
    textarea?.focus()
  }

  function replaceNextMatch() {
    const textarea = textareaRef.current
    if (!searchText || matches.length === 0 || !textarea) return
    const at = nextMatch(matches, textarea.selectionEnd ?? 0)
    const next = source.slice(0, at) + replaceText + source.slice(at + searchText.length)
    applyEdit(next, at + replaceText.length)
  }

  /* ST Editor Quick Control #1 (đã duyệt) — cả ba chỉ transform buffer local
   * qua `applyEditRange`, không tự Lưu/Kiểm tra. Chỉ tác động khi có vùng
   * chọn không rỗng (thanh lệnh chỉ hiện trong trường hợp đó). */
  function handleToggleComment() {
    if (!canEdit || !selectionRange) return
    const result = toggleComment(source, selectionRange.start, selectionRange.end)
    applyEditRange(result.text, result.selectionStart, result.selectionEnd)
  }

  function handleWrapIf() {
    if (!canEdit || !selectionRange) return
    const result = wrapInBlock(source, selectionRange.start, selectionRange.end, 'IF')
    applyEditRange(result.text, result.selectionStart, result.selectionEnd)
  }

  /** `AC-ST-005` — nhảy tới khai báo của định danh dưới con trỏ (F12 hoặc
   *  Ctrl+Click). Không tra được thì NÓI RÕ là không tra được: một định danh
   *  chưa khai báo là thông tin thật về nguồn, không phải chỗ để đoán bừa một
   *  đích đến gần đúng. */
  function handleGoToDefinition() {
    const textarea = textareaRef.current
    const offset = textarea?.selectionStart ?? cursorOffset
    const found = stSymbolAt(source, offset, referenceIndex)
    if (!found) {
      setReferenceNote(pick('Con trỏ không đứng trên một định danh.', 'The cursor is not on an identifier.'))
      return
    }
    if (!found.entry) {
      setReferenceNote(pick(`Không tìm thấy khai báo của ${found.identifier}.`, `No declaration found for ${found.identifier}.`))
      return
    }
    setReferenceNote(null)
    selectRange(found.entry.declarationOffset, found.entry.name.length)
  }

  function handleJumpBracket() {
    if (!bracketMatch) return
    const textarea = textareaRef.current
    const current = textarea?.selectionStart ?? -1
    const target = current === bracketMatch.open ? bracketMatch.close : bracketMatch.open
    selectRange(target, 1)
  }

  function handleInsertAtCursor(text: string) {
    const textarea = textareaRef.current
    const offset = textarea?.selectionStart ?? source.length
    const next = source.slice(0, offset) + text + source.slice(offset)
    applyEdit(next, offset + text.length)
    setInsertPanelOpen(false)
    textarea?.focus()
  }

  /** `AC-ST-002` — chèn một mục Quick Library vào nguồn ST.
   *
   *  Khác `handleInsertAtCursor` (chèn thô một chuỗi tại con trỏ) ở chỗ nó
   *  tôn trọng CẤU TRÚC của POU: khai báo instance thuộc vùng khai báo, lời
   *  gọi thuộc thân. Cả hai phần đi qua đúng MỘT `applyEditRange` nên vẫn là
   *  một bước hoàn tác (`AC-ST-003`). */
  function applyLibraryInsertion(entry: CatalogEntry, instanceName?: string) {
    const textarea = textareaRef.current
    const offset = textarea?.selectionStart ?? source.length
    const plan = planLibraryInsertion(source, entry, offset, instanceName ? { instanceName } : {})
    applyEditRange(plan.text, plan.selectionStart, plan.selectionEnd)
    setPendingLibraryEntry(null)
    /* Hai điều người dùng KHÔNG nhìn thấy nếu không nói: một dòng khai báo vừa
     * được thêm ở chỗ khác trên màn hình, và lời gọi có thể đã bị dời khỏi con
     * trỏ vì con trỏ đang ở vùng khai báo. Im lặng ở đây là để người dùng tự
     * đoán tại sao nguồn đổi nhiều hơn họ nghĩ. */
    const notes: string[] = []
    if (plan.declarationAdded && plan.instanceName) {
      notes.push(pick(`Đã khai ${plan.instanceName} : ${entry.name} trong khối VAR.`, `Declared ${plan.instanceName} : ${entry.name} in the VAR block.`))
    }
    if (plan.callRelocated) {
      notes.push(pick('Lời gọi đặt ở đầu thân vì con trỏ đang ở vùng khai báo.', 'Call placed at the start of the body because the cursor was in the declaration section.'))
    }
    setLibraryInsertionNote(notes.length > 0 ? notes.join(' ') : null)
    textarea?.focus()
  }

  const segmentClass: Record<string, string> = {
    keyword: 'text-[var(--c-accent)] font-semibold',
    type: 'text-[var(--c-info)]',
    function: 'text-[var(--c-good-fg)]',
    'fb-type': 'text-[var(--c-good-fg)] font-semibold',
    number: 'text-[var(--c-warn-fg)]',
    time: 'text-[var(--c-warn-fg)]',
    comment: 'text-[var(--c-text-dim)] italic',
    operator: 'text-[var(--c-text)]',
    punctuation: 'text-[var(--c-text)]',
    identifier: 'text-[var(--c-text)]',
    whitespace: '',
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--c-text)]">{program.name}</h3>
        <div className="flex flex-wrap items-center gap-2">
          {/* FE-ST-009: chuẩn hoá Find/Insert/Format/Save cùng một hàng, đều
           * có icon + tooltip nêu rõ phím tắt — trước đây Định dạng/Chèn
           * Point-Variable không có icon, rời rạc hơn Tìm/Lưu. */}
          <Button
            size="sm"
            variant="ghost"
            icon={<Search className="h-4 w-4" aria-hidden="true" />}
            aria-pressed={searchOpen}
            title={pick('Tìm/Thay (Ctrl+F)', 'Find/Replace (Ctrl+F)')}
            onClick={() => {
              setSearchOpen((open) => {
                const next = !open
                if (next) window.setTimeout(() => searchRef.current?.focus(), 0)
                else textareaRef.current?.focus()
                return next
              })
            }}
          >
            {pick('Tìm', 'Find')}
          </Button>
          {canEdit && (
            <>
              <Button
                size="sm"
                variant="ghost"
                icon={<Undo2 className="h-4 w-4" aria-hidden="true" />}
                disabled={historyRef.current.past.length === 0}
                aria-label={pick('Hoàn tác thay đổi ST', 'Undo ST edit')}
                title={pick('Hoàn tác (Ctrl+Z)', 'Undo (Ctrl+Z)')}
                onClick={() => applyHistorySnapshot('undo')}
              />
              <Button
                size="sm"
                variant="ghost"
                icon={<Redo2 className="h-4 w-4" aria-hidden="true" />}
                disabled={historyRef.current.future.length === 0}
                aria-label={pick('Làm lại thay đổi ST', 'Redo ST edit')}
                title={pick('Làm lại (Ctrl+Y)', 'Redo (Ctrl+Y)')}
                onClick={() => applyHistorySnapshot('redo')}
              />
              <Button
                size="sm"
                variant="ghost"
                icon={<PlusSquare className="h-4 w-4" aria-hidden="true" />}
                aria-pressed={insertPanelOpen}
                title={pick('Chèn nhanh Point/Variable (Ctrl+I)', 'Quick insert Point/Variable (Ctrl+I)')}
                onClick={() => setInsertPanelOpen((open) => !open)}
              >
                {pick('Chèn Point/Variable', 'Insert Point/Variable')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Library className="h-4 w-4" aria-hidden="true" />}
                aria-pressed={libraryPanelOpen}
                title={pick('Thư viện nhanh — cùng catalog với PGM-04', 'Quick library — same catalog as PGM-04')}
                onClick={() => setLibraryPanelOpen((open) => !open)}
              >
                {pick('Thư viện', 'Library')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={<AlignLeft className="h-4 w-4" aria-hidden="true" />}
                title={pick('Định dạng lại thụt lề', 'Reformat indentation')}
                onClick={handleFormat}
              >
                {pick('Định dạng', 'Format')}
              </Button>
              <Button
                size="sm"
                icon={<Save className="h-4 w-4" aria-hidden="true" />}
                loading={saving}
                disabled={!canSave}
                title={
                  isEmptySource ? pick('Mã nguồn ST không được để trống', 'ST source cannot be empty')
                  : !dirty ? pick('Không có thay đổi để lưu', 'No changes to save')
                  : pick('Lưu (Ctrl+S)', 'Save (Ctrl+S)')
                }
                onClick={handleSaveSource}
              >
                {pick('Lưu', 'Save')}
              </Button>
            </>
          )}
        </div>
      </div>
      {searchOpen && (
        <div role="search" className="flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-2">
          <label className="sr-only" htmlFor={`programming-st-find-${program.programId}`}>{pick('Tìm trong mã nguồn', 'Find in source')}</label>
          <input
            ref={searchRef}
            id={`programming-st-find-${program.programId}`}
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') { setSearchOpen(false); textareaRef.current?.focus() }
              if (event.key === 'Enter' && matches.length > 0) selectRange(matches[0], searchText.length)
            }}
            className="min-w-52 flex-1 rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1 text-sm text-[var(--c-text)]"
          />
          <span className="text-xs text-[var(--c-text-dim)]">{matches.length} {pick('kết quả', 'matches')}</span>
          <Button size="sm" variant="ghost" disabled={matches.length === 0} onClick={() => matches.length > 0 && selectRange(nextMatch(matches, textareaRef.current?.selectionEnd ?? 0), searchText.length)}>{pick('Tiếp', 'Next')}</Button>
          {canEdit && (
            <>
              <label className="sr-only" htmlFor={`programming-st-replace-${program.programId}`}>{pick('Thay bằng', 'Replace with')}</label>
              <input
                id={`programming-st-replace-${program.programId}`}
                value={replaceText}
                onChange={(event) => setReplaceText(event.target.value)}
                placeholder={pick('Thay bằng…', 'Replace with…')}
                className="min-w-40 flex-1 rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1 text-sm text-[var(--c-text)]"
              />
              <Button size="sm" variant="ghost" disabled={matches.length === 0} onClick={replaceNextMatch}>{pick('Thay', 'Replace')}</Button>
              <Button size="sm" variant="ghost" disabled={matches.length === 0} onClick={replaceAllMatches}>{pick('Thay tất cả', 'Replace all')}</Button>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            icon={<X className="h-4 w-4" aria-hidden="true" />}
            aria-label={pick('Đóng tìm kiếm', 'Close find')}
            onClick={() => { setSearchOpen(false); textareaRef.current?.focus() }}
          />
        </div>
      )}
      <label className="sr-only" htmlFor={`programming-st-source-${program.programId}`}>
        {pick(`Mã nguồn ST của ${program.name}`, `ST source for ${program.name}`)}
      </label>
      <div className="relative grid h-96 grid-cols-[3.5rem_1fr] overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] focus-within:border-[var(--c-accent)]">
        {/* Con trỏ lệch dòng (báo trực tiếp trên board, 2026-08-15 và
         * 2026-08-17 — ảnh chụp cho thấy lưới kẻ cắt xuyên chữ, không phải
         * chỉ lệch nhẹ): tắt word-wrap (`whitespace-pre` + `wrap="off"`) đã
         * đúng hướng (một dòng logic = đúng một hàng hiển thị), nhưng gốc
         * lệch THẬT là `styles.css` có rule `button, input, select, textarea
         * { font: inherit }` KHÔNG nằm trong `@layer` nào — theo CSS Cascade
         * Layers, rule không-layer luôn thắng rule có layer bất kể độ đặc
         * hiệu, nên nó âm thầm đè `text-sm`/`leading-5` (Tailwind, có layer)
         * CHỈ trên `<textarea>` (không đè `<pre>` gutter/overlay) — ba lớp
         * vì vậy KHÔNG cùng font-size/line-height thật, dù số liệu tính lưới
         * đúng. Sửa tận gốc bằng `EDITOR_TEXT_METRICS` (inline style, luôn
         * thắng mọi rule stylesheet bất kể layer) áp thống nhất cho cả ba
         * lớp — xem chỗ khai báo hằng số phía trên. Bỏ hẳn lưới kẻ từng dòng
         * theo khuyến nghị: chỉ highlight active-line, khớp mọi code editor
         * chuẩn (VS Code/Sublime không kẻ lưới toàn bộ hàng). */}
        <div
          ref={lineGutterRef}
          aria-hidden="true"
          className="mono m-0 overflow-hidden border-r border-[var(--c-border)] bg-[var(--c-surface-2)] text-right text-[var(--c-text-dim)]"
          style={{ ...EDITOR_TEXT_METRICS, paddingLeft: `${EDITOR_GUTTER_PAD_X_PX}px`, paddingRight: `${EDITOR_GUTTER_PAD_X_PX}px` }}
        >
          {Array.from({ length: Math.max(1, source.split('\n').length) }, (_, index) => index + 1).map((lineNumber) => (
            <div
              key={lineNumber}
              style={{ height: `${EDITOR_ROW_HEIGHT_PX}px` }}
              className={lineNumber === cursor.line ? 'bg-[var(--c-surface)] font-semibold text-[var(--c-text)]' : undefined}
            >
              {lineNumber}
            </div>
          ))}
        </div>
        <div className="relative h-96 overflow-hidden">
          {/* WP-10 P0: overlay tô cú pháp + gạch chân diagnostic, nằm DƯỚI
           * textarea (chữ trong suốt, chỉ hiện con trỏ) — `EDITOR_TEXT_METRICS`
           * (inline) khớp pixel-cho-pixel với textarea phía trên, xem lý do ở
           * comment phía trên container. */}
          <pre
            ref={overlayRef}
            aria-hidden="true"
            className="mono pointer-events-none absolute inset-0 m-0 overflow-hidden whitespace-pre"
            style={{ ...EDITOR_TEXT_METRICS, paddingLeft: `${EDITOR_PAD_X_PX}px`, paddingRight: `${EDITOR_PAD_X_PX}px` }}
          >
            {/* Dải highlight active-line — con ĐẦU TIÊN của chính `<pre>` đang
             * cuộn (không phải phần tử ngoài) nên tự cuộn theo `scrollTop`
             * đồng bộ sẵn có, không cần state/effect riêng. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-0 right-0 bg-[var(--c-surface-2)]"
              style={{ top: `${(cursor.line - 1) * EDITOR_ROW_HEIGHT_PX + EDITOR_PAD_TOP_PX}px`, height: `${EDITOR_ROW_HEIGHT_PX}px`, opacity: 0.55 }}
            />
            {segments.map((segment, index) => {
              const isBracket = bracketMatch !== null && (segment.start === bracketMatch.open || segment.start === bracketMatch.close) && segment.kind === 'punctuation'
              const classes = [segmentClass[segment.kind] ?? '']
              if (isBracket) classes.push('rounded bg-[var(--c-accent-bg)]')
              if (segment.diagnosticIndex !== null) classes.push('underline decoration-wavy decoration-2 [text-decoration-color:var(--c-fault)]')
              const shared = segment.text === '' ? '​' : segment.text
              if (segment.diagnosticIndex !== null) {
                const diagnostic = diagnostics[segment.diagnosticIndex]
                return (
                  <span
                    key={index}
                    className={`${classes.join(' ')} pointer-events-auto cursor-pointer`}
                    title={diagnostic ? `${diagnostic.code}${diagnostic.detailCode ? ` (${diagnostic.detailCode})` : ''}` : undefined}
                    onClick={() => {
                      const line = typeof diagnostic?.location?.line === 'number' ? diagnostic.location.line : 1
                      const column = typeof diagnostic?.location?.column === 'number' ? diagnostic.location.column : 1
                      const length = typeof diagnostic?.location?.length === 'number' ? diagnostic.location.length : 1
                      selectRange(lineColumnToOffset(source, line, column), length)
                    }}
                  >
                    {shared}
                  </span>
                )
              }
              return <span key={index} className={classes.join(' ')}>{shared}</span>
            })}
          </pre>
          <textarea
            ref={textareaRef}
            id={`programming-st-source-${program.programId}`}
            aria-describedby={diagnostics.length > 0 ? `programming-st-diagnostics-${program.programId}` : undefined}
            wrap="off"
            className="absolute inset-0 h-96 w-full resize-none whitespace-pre border-0 bg-transparent outline-none"
            /* `color`/`caretColor` VÀ toàn bộ `EDITOR_TEXT_METRICS` (font-size/
             * line-height/padding/tab-size) đều phải là inline style — lý do
             * đầy đủ ở comment tại chỗ khai báo `EDITOR_TEXT_METRICS` phía
             * trên (rule `textarea { font: inherit }` không-layer trong
             * `styles.css` đè bất kỳ class Tailwind nào, kể cả `text-sm`/
             * `leading-5`/`p-3`, không chỉ `text-transparent`/`caret-*`). */
            style={{ ...EDITOR_TEXT_METRICS, paddingLeft: `${EDITOR_PAD_X_PX}px`, paddingRight: `${EDITOR_PAD_X_PX}px`, color: 'transparent', caretColor: 'var(--c-text)' }}
            value={source}
            readOnly={!canEdit}
            spellCheck={false}
            onChange={(event) => {
              /* Đường GÕ TAY không đi qua `applyEditRange` (trình duyệt tự ghi
               * `.value`), nên guard read-only phải lặp lại ở đây. `readOnly`
               * chặn được người dùng thật; guard này chặn cả những đường mà
               * `readOnly` không phủ — thao tác lập trình, và một lần refactor
               * quên thuộc tính đó. */
              if (!canEdit) return
              const next = event.target.value
              const selectionStart = event.target.selectionStart
              const selectionEnd = event.target.selectionEnd
              /* Tính lại Dòng/cột ngay từ `next`/`offset` tươi của chính sự
               * kiện này — không dựa vào `onKeyUp`/`onSelect` đọc lại closure
               * `source` có thể còn là giá trị của lần render trước, đúng
               * nguyên nhân khay "Dòng/cột" từng hiện lệch dòng thật (lỗi
               * người dùng báo). Bàn phím thường (không qua `applyEdit`) vẫn
               * cần đường riêng này vì trình duyệt tự chèn ký tự, không đi
               * qua `handleAutoIndentEnter`/`acceptCompletion`.
               *
               * Đặt `pendingCursorRef` NGAY Ở ĐÂY (giống hệt `applyEditRange`)
               * dù trình duyệt đã tự ghi `.value` này rồi: `setCursor`/
               * `refreshCompletion` bên dưới có thể kích hoạt render lại
               * TRƯỚC KHI prop `source` (đổi qua `onChange` → state cha) kịp
               * cập nhật, và React reconciliation của controlled input khi đó
               * ghi `.value` VỀ LẠI prop `source` cũ — y hệt lỗi đã sửa ở
               * `applyEdit()`, chỉ khác đường vào (gõ tay thường, không qua
               * Enter/autocomplete/Find-Replace). Trong app thật, cha luôn
               * batch kịp nên hiếm khi lộ ra — nhưng không nên dựa vào đúng
               * thời điểm batch của React để đúng, `useLayoutEffect` đảm bảo
               * đúng bất kể cha cập nhật nhanh hay chậm. */
              replaceHistory(recordStEditorEdit(historyRef.current, { source: next, selectionStart, selectionEnd }))
              pendingCursorRef.current = { value: next, selectionStart, selectionEnd }
              onChange(next)
              setCursor(offsetToLineColumn(next, selectionEnd))
              setSelectionRange(selectionStart === selectionEnd ? null : { start: selectionStart, end: selectionEnd })
              refreshCompletion(next, selectionEnd)
            }}
            onClick={(event) => {
              updateCursor()
              closeCompletion()
              /* Ctrl/Cmd+Click = tới khai báo, đường chuột của F12. */
              if (event.ctrlKey || event.metaKey) handleGoToDefinition()
            }}
            onKeyUp={updateCursor}
            onSelect={updateCursor}
            onScroll={(event) => {
              if (lineGutterRef.current) lineGutterRef.current.scrollTop = event.currentTarget.scrollTop
              if (overlayRef.current) {
                overlayRef.current.scrollTop = event.currentTarget.scrollTop
                overlayRef.current.scrollLeft = event.currentTarget.scrollLeft
              }
            }}
            onKeyDown={(event) => {
              if (completion.open) {
                if (event.key === 'ArrowDown') { event.preventDefault(); setCompletion((c) => ({ ...c, selected: (c.selected + 1) % c.items.length })); return }
                if (event.key === 'ArrowUp') { event.preventDefault(); setCompletion((c) => ({ ...c, selected: (c.selected - 1 + c.items.length) % c.items.length })); return }
                if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); acceptCompletion(completion.items[completion.selected]); return }
                if (event.key === 'Escape') { event.preventDefault(); closeCompletion(); return }
              }
              if (event.key === 'Escape' && searchOpen) {
                event.preventDefault(); setSearchOpen(false); return
              }
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && canEdit) {
                event.preventDefault()
                applyHistorySnapshot(event.shiftKey ? 'redo' : 'undo')
                return
              }
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y' && canEdit) {
                event.preventDefault(); applyHistorySnapshot('redo'); return
              }
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
                event.preventDefault(); setSearchOpen(true); window.setTimeout(() => searchRef.current?.focus(), 0); return
              }
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && canEdit && canSave) {
                event.preventDefault(); handleSaveSource(); return
              }
              /* ST Editor Quick Control (đã duyệt) — phím tắt cho thanh lệnh
               * nhanh vùng chọn (#1) và panel chèn nhanh (#3). */
              if ((event.ctrlKey || event.metaKey) && event.key === '/') {
                event.preventDefault(); handleToggleComment(); return
              }
              if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === '\\') {
                event.preventDefault(); handleJumpBracket(); return
              }
              /* `AC-ST-005` — F12 là phím tiêu chuẩn cho "tới khai báo" ở mọi
               * editor kỹ thuật; Ctrl+Click ở `onClick` là đường chuột tương
               * ứng. Cả hai dùng được cả khi chỉ đọc (điều hướng không sửa
               * nguồn). */
              if (event.key === 'F12') {
                event.preventDefault(); handleGoToDefinition(); return
              }
              if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'i' && canEdit) {
                event.preventDefault(); setInsertPanelOpen((open) => !open); return
              }
              if (event.key === 'Enter' && canEdit && !event.ctrlKey && !event.metaKey) {
                event.preventDefault(); handleAutoIndentEnter()
              }
            }}
          />
          {completion.open && (
            <ul
              role="listbox"
              aria-label={pick('Gợi ý', 'Suggestions')}
              className="absolute z-10 max-h-48 w-56 overflow-y-auto rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] text-sm shadow-lg"
              style={{ top: `${cursor.line * EDITOR_ROW_HEIGHT_PX}px`, left: `${Math.min(220, (cursor.column - 1) * 8.4 + EDITOR_PAD_TOP_PX)}px` }}
            >
              {completion.items.map((item, index) => (
                <li key={`${item.kind}-${item.label}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === completion.selected}
                    className={`flex w-full items-center justify-between px-2 py-1 text-left ${index === completion.selected ? 'bg-[var(--c-accent-bg)]' : 'hover:bg-[var(--c-surface-2)]'}`}
                    onMouseDown={(event) => { event.preventDefault(); acceptCompletion(item) }}
                  >
                    <span className="mono">{item.label}</span>
                    <span className="text-xs text-[var(--c-text-dim)]">{item.detail}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {canEdit && selectionRange && (() => {
            const { line, column } = offsetToLineColumn(source, selectionRange.start)
            return (
              <SelectionQuickActions
                top={Math.max(0, (line - 1) * EDITOR_ROW_HEIGHT_PX - 32)}
                left={Math.min(220, (column - 1) * 8.4 + EDITOR_PAD_TOP_PX)}
                onComment={handleToggleComment}
                onWrapIf={handleWrapIf}
                onJumpBracket={handleJumpBracket}
                canJumpBracket={bracketMatch !== null}
              />
            )
          })()}
        </div>
        {libraryPanelOpen && canEdit && (
          <QuickLibraryHost
            projectId={projectId}
            language="ST"
            onInsert={(entry) => {
              /* Đã có instance cùng kiểu thì hỏi: dùng lại hay tạo mới. Tự
               * dùng lại là sai (hai lời gọi chung một timer là lỗi điều
               * khiển thật), mà tự tạo mới cũng sai khi người dùng đang muốn
               * gọi lại đúng instance đó. */
              if (entry.stateful && collectDeclaredInstances(source, entry.name).length > 0) {
                setPendingLibraryEntry(entry)
                return true
              }
              applyLibraryInsertion(entry)
              return true
            }}
            onClose={() => setLibraryPanelOpen(false)}
          />
        )}
        {pendingLibraryEntry && canEdit && (
          <FbInstancePicker
            entry={pendingLibraryEntry}
            instances={collectDeclaredInstances(source, pendingLibraryEntry.name)}
            suggestedName={nextInstanceName(source, pendingLibraryEntry.name)}
            onPick={(instanceName) => applyLibraryInsertion(pendingLibraryEntry, instanceName)}
            onCreate={() => applyLibraryInsertion(pendingLibraryEntry)}
            onClose={() => setPendingLibraryEntry(null)}
          />
        )}
        {insertPanelOpen && canEdit && (
          <InsertPointVariablePanel
            variables={symbols}
            pointCatalogStatus={pointCatalogStatus}
            pointCatalogItems={pointCatalogItems}
            pointCatalogError={pointCatalogError}
            onEnsureLoaded={onEnsurePointCatalogLoaded}
            onInsert={handleInsertAtCursor}
            onClose={() => setInsertPanelOpen(false)}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--c-text-dim)]">
        <span>{pick('Dòng', 'Line')} {cursor.line}, {pick('cột', 'column')} {cursor.column}</span>
        <span>{source.length} {pick('ký tự', 'characters')}</span>
      </div>
      {libraryInsertionNote && (
        <p role="status" className="text-xs text-[var(--c-text-dim)]">{libraryInsertionNote}</p>
      )}
      {runtimeOverlay && <StRuntimeValueOverlay state={runtimeOverlay} />}
      <div className="rounded-[var(--radius)] border border-[var(--c-border)] p-2">
        <h4 className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Ký hiệu & kiểu', 'Symbols & types')}</h4>
        {symbols.length === 0 ? (
          <p className="mt-1 text-xs text-[var(--c-text-dim)]">{pick('Chưa nhận diện khai báo VAR.', 'No VAR declarations detected.')}</p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-1">
            {symbols.map((symbol) => (
              <li key={`${symbol.name}-${symbol.offset}`}>
                <button type="button" className="rounded bg-[var(--c-surface-2)] px-2 py-1 font-mono text-xs text-[var(--c-text)] hover:text-[var(--c-accent)]" onClick={() => selectRange(symbol.offset, symbol.name.length)}>
                  {symbol.name}: {symbol.type} · {symbol.references} {pick('tham chiếu', 'refs')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <StCrossReferencePanel
        cursorSymbol={cursorSymbol}
        note={referenceNote}
        onJump={(offset, length) => { setReferenceNote(null); selectRange(offset, length) }}
      />
      {diagnostics.length > 0 && (
        <p id={`programming-st-diagnostics-${program.programId}`} className="text-xs text-[var(--c-fault-fg)]">
          {pick(`${diagnostics.length} diagnostic. Chọn lỗi trong khay Vấn đề để tới đúng dòng/cột.`, `${diagnostics.length} diagnostic(s). Select one in Problems to jump to its line and column.`)}
        </p>
      )}
      {isEmptySource && (
        <p className="text-xs text-[var(--c-fault-fg)]">
          {pick('Mã nguồn ST không được để trống — cần ít nhất khung PROGRAM/END_PROGRAM để lưu.', 'ST source cannot be empty — needs at least a PROGRAM/END_PROGRAM skeleton to save.')}
        </p>
      )}
      {/* FE-ST-008: bốn trạng thái tách biệt, ưu tiên "Lưu thất bại" trước
       * "Chưa lưu" chung chung — `lastAttemptedSourceRef` bảo đảm chỉ hiện
       * đúng khi buffer hiện tại CHÍNH LÀ buffer vừa thử lưu (gõ tiếp sau khi
       * thất bại phải rơi về "Chưa lưu", không giữ mãi thông báo lỗi cũ). */}
      {saving && <p className="text-xs text-[var(--c-text-dim)]">{pick('Đang lưu…', 'Saving…')}</p>}
      {!saving && saveStatus === 'failed' && source === lastAttemptedSourceRef.current && (
        <p className="text-xs text-[var(--c-fault-fg)]">{pick('Lưu thất bại — thử lại.', 'Save failed — try again.')}</p>
      )}
      {!saving && !(saveStatus === 'failed' && source === lastAttemptedSourceRef.current) && dirty && !isEmptySource && (
        <p className="text-xs text-[var(--c-warn-fg)]">{pick('Chưa lưu.', 'Not saved.')}</p>
      )}
      {!saving && !dirty && saveStatus === 'saved' && source === lastAttemptedSourceRef.current && (
        <p className="text-xs text-[var(--c-good-fg)]">{pick('Đã lưu.', 'Saved.')}</p>
      )}
    </div>
  )
}

function parseFbdDocument(raw: unknown, fallbackName: string): FbdDocument {
  if (typeof raw === 'string' && raw.length > 0) {
    try {
      return JSON.parse(raw) as FbdDocument
    } catch {
      // Rơi xuống tài liệu rỗng bên dưới — không được ném lỗi làm mất cả tab;
      // StructuredFbdEditor tự validate lại và hiện issue cho người dùng sửa.
    }
  }
  return emptyFbdDocument(fallbackName)
}

function FbdEditorPane({
  program,
  source,
  canEdit,
  saving,
  onChange,
  onSave,
  userPouInterfaces,
  projectId,
  onSelectionChange,
  focusSelection,
}: {
  program: ProgrammingProgram
  source: string
  canEdit: boolean
  saving: boolean
  onChange: (source: string) => void
  onSave: (operations: ProgrammingDraftOperation[]) => Promise<boolean>
  userPouInterfaces: readonly UserPouInterface[]
  projectId?: string
  /** `T59-818` — chuyển tiếp lựa chọn canvas lên Inspector dùng chung. */
  onSelectionChange?: (selection: FbdSelection | null) => void
  focusSelection?: FbdSelection | null
}) {
  const { pick } = useI18n()
  const committedJson = useMemo(() => canonicalFbdJson(parseFbdDocument(program.document, program.name)), [program.document, program.name])
  const local = useMemo(() => parseFbdDocument(source, program.name), [program.name, source])
  const localJson = useMemo(() => canonicalFbdJson(local), [local])
  const dirty = localJson !== committedJson

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--c-text)]">{program.name}</h3>
        {canEdit && (
          <Button
            size="sm"
            icon={<Save className="h-4 w-4" aria-hidden="true" />}
            loading={saving}
            disabled={!dirty}
            onClick={() => void onSave([{ op: 'replaceProgramSource', programId: program.programId, language: 'FBD', source: localJson }])}
          >
            {pick('Lưu', 'Save')}
          </Button>
        )}
      </div>
      <StructuredFbdEditor
        document={local}
        canEdit={canEdit}
        userPouInterfaces={userPouInterfaces}
        projectId={projectId}
        onChange={(next) => onChange(canonicalFbdJson(next))}
        onSelectionChange={onSelectionChange}
        focusSelection={focusSelection}
      />
      {dirty && <p className="text-xs text-[var(--c-warn-fg)]">{pick('Chưa lưu.', 'Not saved.')}</p>}
    </div>
  )
}

interface ProgramMetadataDraft {
  name: string
  kind: ProgrammingProgram['kind']
}

function metadataOf(program: ProgrammingProgram): ProgramMetadataDraft {
  return { name: program.name, kind: program.kind }
}

function sameMetadata(left: ProgramMetadataDraft, right: ProgramMetadataDraft): boolean {
  return left.name === right.name && left.kind === right.kind
}

function parseTags(value: string): string[] {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))]
}

function sameTags(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

const POU_RESERVED_NAMES = new Set([
  'PROGRAM', 'FUNCTION', 'FUNCTION_BLOCK', 'VAR', 'END_VAR', 'IF', 'THEN',
  'ELSE', 'END_IF', 'TRUE', 'FALSE', 'AND', 'OR', 'XOR', 'NOT', 'MOD',
])

/** Đồng bộ `validPouName` ở backend: ASCII identifier tối đa 64 ký tự và
 * không trùng từ khoá IEC/ST bị giữ chỗ. Validation phía client chỉ giúp chặn
 * request chắc chắn 400; backend vẫn là authority cuối cùng. */
export function isValidPouName(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) && !POU_RESERVED_NAMES.has(name.toUpperCase())
}

/** So khớp tên không phân biệt hoa/thường và khoảng trắng đầu/cuối. */
export function isDuplicateProgramName(programs: ProgrammingProgram[], name: string, excludeProgramId?: string): boolean {
  const normalized = name.trim().toLocaleLowerCase()
  if (!normalized) return false
  return programs.some((program) => program.programId !== excludeProgramId && program.name.trim().toLocaleLowerCase() === normalized)
}

/** Sinh tên duy nhất kiểu `NewProgram_2`, `NewProgram_3`; hậu tố luôn giữ tên
 * trong grammar POU thay vì tái đưa khoảng trắng vào token (BUG-006). */
export function uniqueProgramName(programs: ProgrammingProgram[], baseName: string): string {
  if (!isDuplicateProgramName(programs, baseName)) return baseName
  let suffix = 2
  while (isDuplicateProgramName(programs, `${baseName}_${suffix}`)) suffix += 1
  return `${baseName}_${suffix}`
}

/** Chuyển view model sang đúng năm field decoder `upsertProgramCompat` nhận.
 * Không dùng spread ở biên transport: view còn giữ field legacy phục vụ đọc. */
function programDraftInput(
  program: ProgrammingProgram,
  changes: Partial<Omit<ProgrammingProgramDraftInput, 'programId'>> = {},
): ProgrammingProgramDraftInput {
  return {
    programId: program.programId,
    name: changes.name ?? program.name,
    kind: changes.kind ?? program.kind,
    language: changes.language ?? program.language,
    document: changes.document ?? program.document,
  }
}

function programSource(program: ProgrammingProgram): string {
  if (typeof program.document === 'string') return program.document
  return JSON.stringify(program.document)
}

function ProjectTagsEditor({ canEdit, value, saving, onChange, onSave }: { canEdit: boolean; value: string; saving: boolean; onChange: (value: string) => void; onSave: () => Promise<boolean> }) {
  const { pick } = useI18n()
  return (
    <div className="mb-3 border-b border-[var(--c-border)] pb-3">
      <label className="text-xs font-semibold uppercase text-[var(--c-text-dim)]" htmlFor="programming-project-functional-tags">{pick('Nhóm chức năng', 'Functional tags')}</label>
      <input id="programming-project-functional-tags" value={value} readOnly={!canEdit} onChange={(event) => onChange(event.target.value)} placeholder={pick('AHU, Nhiệt độ gió cấp', 'AHU, Supply air temperature')} className="mt-1 w-full rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1 text-xs text-[var(--c-text)]" />
      {canEdit && <Button className="mt-1" size="sm" variant="ghost" loading={saving} onClick={() => void onSave()}>{pick('Lưu nhóm', 'Save tags')}</Button>}
    </div>
  )
}

function ProgramInspector({ program, programs, draft, canEdit, saving, onChange, onSave }: { program: ProgrammingProgram; programs: ProgrammingProgram[]; draft: ProgramMetadataDraft; canEdit: boolean; saving: boolean; onChange: (draft: ProgramMetadataDraft) => void; onSave: (operations: ProgrammingDraftOperation[]) => Promise<boolean> }) {
  const { pick } = useI18n()
  const dirty = !sameMetadata(draft, metadataOf(program))
  const normalizedName = draft.name.trim()
  const invalidName = !isValidPouName(normalizedName)
  const duplicateName = isDuplicateProgramName(programs, normalizedName, program.programId)
  const nameHelpId = `program-name-help-${program.programId}`
  const nameInputId = `program-name-${program.programId}`
  const kindInputId = `program-kind-${program.programId}`
  return (
    <section className="rounded-[var(--radius)] border border-[var(--c-border)] p-3">
      <h3 className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Thuộc tính', 'Inspector')}</h3>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div className="text-xs text-[var(--c-text-dim)]">
          <label htmlFor={nameInputId}>{pick('Tên', 'Name')}</label>
          <input
            id={nameInputId}
            className="mt-1 w-full rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1 text-sm text-[var(--c-text)]"
            value={draft.name}
            readOnly={!canEdit}
            aria-invalid={invalidName || duplicateName || undefined}
            aria-describedby={(invalidName || duplicateName) ? nameHelpId : undefined}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
          />
          {invalidName && (
            <span id={nameHelpId} className="mt-1 block text-xs font-normal normal-case text-[var(--c-fault-fg)]">
              {pick('Tên phải bắt đầu bằng chữ, chỉ gồm chữ, số hoặc dấu gạch dưới, dài tối đa 64 ký tự và không là từ khóa ST.', 'Name must start with a letter, contain only letters, digits or underscores, be at most 64 characters, and not be an ST keyword.')}
            </span>
          )}
          {!invalidName && duplicateName && <span id={nameHelpId} className="mt-1 block text-xs font-normal normal-case text-[var(--c-fault-fg)]">{pick('Tên đã được dùng bởi chương trình khác.', 'This name is already used by another program.')}</span>}
        </div>
        <label className="text-xs text-[var(--c-text-dim)]">
          {pick('Loại', 'Kind')}
          {/* WP-02 (D-03, REV-PROG-OVERVIEW-DESIGN-GAP-2026-08-15 §7.4): Check
           * (`compilerInput()`, BE) chỉ biên dịch đúng 1 object PROGRAM/Revision
           * — bất kỳ object FUNCTION/FUNCTION_BLOCK nào cũng làm Check fail cứng
           * `ST-CLI-LIMIT` không giải thích lý do. Trước đây dropdown này cho
           * chọn cả ba loại dù backend chỉ làm được PROGRAM — ẩn hai lựa chọn
           * chưa hỗ trợ khỏi UI thay vì để người dùng tự khám phá sau một vòng
           * Check thất bại khó hiểu. Program hiện có (nếu có, từ import bundle)
           * mang sẵn kind khác PROGRAM vẫn hiển thị đúng giá trị thật kèm cảnh
           * báo, không bị ẩn/mất dữ liệu. */}
          <select id={kindInputId} className="mt-1 w-full rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1 text-sm text-[var(--c-text)]" value={draft.kind} disabled={!canEdit} onChange={(event) => onChange({ ...draft, kind: event.target.value as ProgrammingProgram['kind'] })}>
            <option value="PROGRAM">PROGRAM</option>
            {draft.kind !== 'PROGRAM' && <option value={draft.kind}>{draft.kind}</option>}
          </select>
          {draft.kind !== 'PROGRAM' && (
            <span className="mt-1 block text-xs font-normal normal-case text-[var(--c-warn-fg)]">
              {pick('Loại này chưa được Kiểm tra hỗ trợ biên dịch — đổi về PROGRAM trước khi Kiểm tra.', 'This kind is not supported by Check yet — switch to PROGRAM before running Check.')}
            </span>
          )}
        </label>
      </div>
      {canEdit && <Button className="mt-2" size="sm" loading={saving} disabled={!dirty || invalidName || duplicateName} onClick={() => void onSave([{ op: 'upsertProgram', program: programDraftInput(program, { name: normalizedName, kind: draft.kind }) }])}>{pick('Lưu thuộc tính', 'Save properties')}</Button>}
    </section>
  )
}

interface StSymbol { name: string; type: string; offset: number; references: number }

/**
 * Bảng ký hiệu cho khay "Ký hiệu & kiểu", autocomplete và bảng lệnh nhanh.
 *
 * `T59-805`: đọc từ `buildStReferenceIndex` thay vì tự quét regex lần thứ hai.
 * Bản cũ chỉ nhận sáu kiểu cơ bản nên **instance FUNCTION_BLOCK không tồn tại**
 * với editor: chèn `TON_1 : TON;` xong thì gõ `TON_` không được gợi ý và khay
 * ký hiệu không thấy nó. Một nguồn duy nhất cho cả điều hướng lẫn gợi ý thì
 * không có chỗ cho hai câu trả lời khác nhau về cùng một nguồn.
 *
 * `references` nay đếm nơi DÙNG (không tính chính dòng khai báo) và phân biệt
 * hoa thường đúng như grammar §10 — con số cũ đếm cả khai báo và gộp hoa
 * thường, tức luôn lớn hơn thực tế ít nhất một.
 */
export function collectStSymbols(source: string): StSymbol[] {
  return buildStReferenceIndex(source).symbols.map((entry) => ({
    name: entry.name,
    type: entry.typeName,
    offset: entry.declarationOffset,
    references: entry.occurrences.length,
  }))
}

export interface StInterfaceVariable { name: string; type: string; direction: 'INPUT' | 'OUTPUT' }

const ST_INTERFACE_BLOCK_START = /\b(VAR_INPUT|VAR_OUTPUT)\b/gi
const ST_INTERFACE_DECLARATION = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(BOOL|INT|DINT|UINT|REAL|TIME)\b/gi

/** Biến biên ngoài của Program ST — khai báo trong `VAR_INPUT`/`VAR_OUTPUT`
 *  (§2 ST_SUBSET_SPEC). Dùng để mời Mapping tab chọn đúng biến đã khai báo
 *  thay vì bắt gõ tay tên không đối chiếu được với source thật. */
export function collectStInterfaceVariables(source: string): StInterfaceVariable[] {
  const output: StInterfaceVariable[] = []
  const blockStart = new RegExp(ST_INTERFACE_BLOCK_START.source, ST_INTERFACE_BLOCK_START.flags)
  let block: RegExpExecArray | null
  while ((block = blockStart.exec(source)) !== null) {
    const direction: 'INPUT' | 'OUTPUT' = block[1].toUpperCase() === 'VAR_INPUT' ? 'INPUT' : 'OUTPUT'
    const bodyStart = block.index + block[0].length
    const relativeEnd = source.slice(bodyStart).search(/\bEND_VAR\b/i)
    const body = relativeEnd === -1 ? source.slice(bodyStart) : source.slice(bodyStart, bodyStart + relativeEnd)
    const declaration = new RegExp(ST_INTERFACE_DECLARATION.source, ST_INTERFACE_DECLARATION.flags)
    let decl: RegExpExecArray | null
    while ((decl = declaration.exec(body)) !== null) {
      output.push({ name: decl[1], type: decl[2].toUpperCase(), direction })
    }
  }
  return output
}

function findTextMatches(source: string, query: string): number[] {
  if (!query) return []
  const output: number[] = []
  const haystack = source.toLocaleLowerCase()
  const needle = query.toLocaleLowerCase()
  let offset = 0
  while ((offset = haystack.indexOf(needle, offset)) >= 0 && output.length < 1000) { output.push(offset); offset += Math.max(1, needle.length) }
  return output
}
function nextMatch(matches: number[], after: number): number { return matches.find((offset) => offset >= after) ?? matches[0] ?? 0 }
function offsetToLineColumn(source: string, offset: number): { line: number; column: number } {
  const before = source.slice(0, offset)
  const lines = before.split('\n')
  return { line: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 }
}
function lineColumnToOffset(source: string, line: number, column: number): number {
  const lines = source.split('\n')
  const lineIndex = Math.max(0, Math.min(lines.length - 1, line - 1))
  let offset = 0
  for (let index = 0; index < lineIndex; index += 1) offset += lines[index].length + 1
  return offset + Math.max(0, Math.min(lines[lineIndex]?.length ?? 0, column - 1))
}

/** `formatStSource` chỉ thêm/bớt khoảng trắng (thụt lề, xuống dòng) — KHÔNG
 *  bao giờ đổi thứ tự hay nội dung ký tự không-trắng (đúng theo cách cài
 *  đặt: tách dòng + trim + thêm indent, không đụng ký tự thật). Giữ đúng vị
 *  trí con trỏ qua Format bằng cách đếm số ký tự không-trắng trước con trỏ ở
 *  bản cũ rồi tìm lại đúng vị trí đó ở bản mới — không dùng offset thô (offset
 *  thô sai ngay khi số dòng đổi). */
export function mapOffsetByNonWhitespaceCount(before: string, after: string, offset: number): number {
  const target = before.slice(0, offset).replace(/\s/g, '').length
  if (target === 0) return 0
  let count = 0
  for (let index = 0; index < after.length; index += 1) {
    if (!/\s/.test(after[index])) {
      count += 1
      if (count === target) return index + 1
    }
  }
  return after.length
}

/** "Thay tất cả" đổi cả nội dung (không chỉ khoảng trắng) nên không dùng
 *  được cách đếm ký tự không-trắng ở trên — cộng dồn đúng chênh lệch độ dài
 *  của từng lần thay THẬT SỰ xảy ra trước vị trí con trỏ cũ. */
export function mapOffsetAcrossReplaceAll(before: string, searchText: string, replaceText: string, offset: number): number {
  if (!searchText) return offset
  let delta = 0
  let cursor = 0
  while (true) {
    const index = before.indexOf(searchText, cursor)
    if (index === -1 || index >= offset) break
    delta += replaceText.length - searchText.length
    cursor = index + searchText.length
  }
  return Math.max(0, offset + delta)
}
const ST_BLOCK_KEYWORDS = [
  'END_PROGRAM', 'PROGRAM', 'END_FUNCTION_BLOCK', 'FUNCTION_BLOCK', 'END_FUNCTION', 'FUNCTION',
  'END_VAR', 'VAR_IN_OUT', 'VAR_TEMP', 'VAR_INPUT', 'VAR_OUTPUT', 'VAR',
  'END_IF', 'ELSIF', 'ELSE', 'IF', 'END_WHILE', 'WHILE', 'END_FOR', 'FOR', 'END_CASE', 'CASE', 'END_REPEAT', 'REPEAT'
]
const ST_KEYWORD_SPLIT = new RegExp(`\\b(${ST_BLOCK_KEYWORDS.join('|')})\\b`, 'g')
const ST_OPEN_LINE = /^(PROGRAM|FUNCTION_BLOCK|FUNCTION|VAR|VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR_TEMP|IF|WHILE|FOR|CASE|REPEAT)\b/
const ST_CLOSE_LINE = /^(END_PROGRAM|END_FUNCTION_BLOCK|END_FUNCTION|END_VAR|END_IF|END_WHILE|END_FOR|END_CASE|END_REPEAT)\b/
const ST_MID_LINE = /^(ELSIF|ELSE)\b/
/** PROGRAM/FUNCTION_BLOCK/FUNCTION giữ tên định danh trên cùng dòng (`PROGRAM
 *  test`) — mọi từ khoá khối khác xuống dòng cả trước lẫn sau. */
const ST_NAMED_BLOCK_OPENERS = new Set(['PROGRAM', 'FUNCTION_BLOCK', 'FUNCTION'])

/** Từ khoá PHẢI giữ cùng dòng với "vế đính kèm" bắt buộc theo văn phạm EBNF
 *  (`ST_SUBSET_SPEC_MK-DDC-24_VI.md` §10: `var_block = ... "VAR" "RETAIN"`;
 *  IF/ELSIF luôn đóng bằng THEN cùng mệnh đề) — báo lỗi trực tiếp kèm ảnh
 *  chụp 2026-08-17 cho thấy bấm "Định dạng" tách rời `VAR`/`RETAIN` và
 *  `IF`/`<điều kiện> THEN` thành hai dòng lệch thụt lề, dù cả hai đều PHẢI ở
 *  chung một dòng. `ST_KEYWORD_SPLIT` phía trên tách vô điều kiện quanh MỌI
 *  từ khoá khối nên xé đôi các cặp này; bù lại bằng bước ghép ở dưới thay vì
 *  làm `ST_KEYWORD_SPLIT` phức tạp hơn (regex một từ khoá đơn giản, dễ kiểm
 *  chứng hơn logic "biết trước cặp nào đi với cặp nào" ngay trong regex). */
const ST_TRAILING_CLAUSE_TERMINATOR: Record<string, RegExp> = {
  VAR: /^RETAIN$/,
  IF: /\bTHEN$/,
  ELSIF: /\bTHEN$/,
}

/**
 * BUG-013 — bản cũ chỉ thêm indent cho dòng đã có sẵn `\n`, nên code dán một
 * dòng (`PROGRAM test VAR ... END_PROGRAM`) không đổi gì. Nay tách mỗi từ
 * khoá khối và mỗi câu lệnh (`;`) ra dòng riêng trước, rồi mới thụt lề theo
 * độ sâu khối — vừa sửa Format, vừa khiến `collectStSymbols` nhận ra VAR
 * ngay cả khi người dùng chưa bấm Format.
 */
export function formatStSource(source: string): string {
  const withBreaks = source
    .replace(/\r\n?/g, '\n')
    .replace(ST_KEYWORD_SPLIT, (keyword) => ST_NAMED_BLOCK_OPENERS.has(keyword) ? `\n${keyword}` : `\n${keyword}\n`)
    .replace(/;/g, ';\n')
  const rawLines = withBreaks.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)

  // Ghép lại các cặp bị ST_KEYWORD_SPLIT xé đôi phía trên (`VAR`+`RETAIN`,
  // `IF`/`ELSIF`+`<điều kiện> THEN`) — hai vế PHẢI cùng một dòng theo EBNF.
  const mergedLines: string[] = []
  for (let index = 0; index < rawLines.length; index += 1) {
    const line = rawLines[index]
    const terminator = ST_TRAILING_CLAUSE_TERMINATOR[line]
    const next = rawLines[index + 1]
    if (terminator && next !== undefined && terminator.test(next)) {
      mergedLines.push(`${line} ${next}`)
      index += 1
    } else {
      mergedLines.push(line)
    }
  }

  let depth = 0
  const indented: string[] = []
  for (const line of mergedLines) {
    const closing = ST_CLOSE_LINE.test(line) || ST_MID_LINE.test(line)
    if (closing) depth = Math.max(0, depth - 1)
    indented.push(`${'  '.repeat(depth)}${line}`)
    if (ST_OPEN_LINE.test(line) || ST_MID_LINE.test(line)) depth += 1
  }
  return indented.length === 0 ? '' : `${indented.join('\n')}\n`
}
