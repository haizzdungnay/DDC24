import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { AlignLeft, PanelLeft, PanelRight, PlusSquare, Save, Search, Tag, X } from 'lucide-react'
import { useI18n } from '../../../../shared/i18n'
import { createUuid } from '../../../../shared/crypto'
import { useAuth, roleAtLeast } from '../../../auth'
import { Button } from '../../../../shared/components/Button'
import { Modal } from '../../../../shared/components/Modal'
import { StructuredFbdEditor } from '../../fbd/StructuredFbdEditor'
import { canonicalFbdJson, FBD_PROFILE_ID, FBD_SCHEMA_VERSION, type FbdDocument } from '../../fbd/model'
import { useLazyProgrammingPointCatalog } from '../../api/queries'
import type { ProgrammingDiagnostic, ProgrammingDraftDocument, ProgrammingDraftOperation, ProgrammingPointCatalogEntry, ProgrammingProgram, ProgrammingRevision, ProgrammingRuntime, RemoteState } from '../../model/types'
import {
  buildStCompletions,
  computeAutoIndent,
  currentWordPrefix,
  findMatchingBracket,
  mergeDiagnosticRanges,
  tokenizeStSource,
  type StCompletionItem,
  type StDiagnosticRange,
} from './stEditorSupport'
import { CommandPalette } from './CommandPalette'
import { ProgramExplorer, primaryFunctionalTag } from './ProgramExplorer'
import { ProgramInspector, type ProgramMetadataDraft } from './ProgramInspector'
import { InsertPointVariablePanel } from './InsertPointVariablePanel'
import { SelectionQuickActions } from './SelectionQuickActions'
import { buildCommandPaletteEntries, toggleComment, wrapInBlock, type PaletteEntry, type ProgramSymbolLike } from './quickControl'

/** F-PROG-ASBUILT-001/D-02: Program ST mới không được bắt đầu ở `document: ''`
 * — compiler luôn Check FAILED ngay khi tạo. Định danh `PROGRAM` cố định
 * (không lấy từ tên hiển thị, có thể có dấu/khoảng trắng không hợp lệ trong
 * ST) — `compilerInput()` (BE) định tuyến theo `programId` (UUID), không đọc
 * tên khai báo trong source, nên định danh này chỉ cần là ST hợp lệ. */
function stProgramTemplate(): string {
  return 'PROGRAM NewProgram\nEND_PROGRAM\n'
}

/** Nguồn chân lý duy nhất cho số đo ST editor. Gutter, overlay và textarea
 * dùng cùng inline metrics để caret, selection, highlight và gợi ý không lệch
 * dòng dù theme hoặc base form style thay đổi. Editor chỉ tô active-line,
 * không kẻ lưới từng dòng. */
const EDITOR_FONT_SIZE_PX = 14
const EDITOR_ROW_HEIGHT_PX = 20
const EDITOR_PAD_TOP_PX = 12
const EDITOR_PAD_X_PX = 12
const EDITOR_GUTTER_PAD_X_PX = 8
const EDITOR_TAB_SIZE = 2

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

function emptyFbdDocument(name: string): FbdDocument {
  return {
    $schema: '../../fbd_v1.schema.json',
    schemaVersion: FBD_SCHEMA_VERSION,
    profileId: FBD_PROFILE_ID,
    graphId: createUuid(),
    name,
    networks: [{ id: createUuid(), name: 'network_1', order: 0, nodes: [], wires: [] }]
  }
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
export function ProgramsTab({
  document,
  saving,
  selectedProgramId,
  onSelectProgram,
  onSave,
  diagnostics,
  runtime,
  activeRevision,
  focusDiagnostic,
  onPendingOperationsChange,
  discardVersion,
  onRunCheck
}: {
  document: ProgrammingDraftDocument
  saving: boolean
  selectedProgramId: string | undefined
  onSelectProgram: (programId: string | undefined) => void
  onSave: (operations: ProgrammingDraftOperation[]) => Promise<boolean>
  diagnostics: ProgrammingDiagnostic[]
  runtime: RemoteState<ProgrammingRuntime>
  activeRevision: RemoteState<ProgrammingRevision | null>
  focusDiagnostic: ProgrammingDiagnostic | null
  onPendingOperationsChange: (operations: ProgrammingDraftOperation[]) => void
  discardVersion: number
  /** ST Editor Quick Control đề xuất #2 (Bảng lệnh nhanh), mục "Kiểm tra": PGM-02
   *  không tự chạy Check nữa từ D-01 — chỉ điều hướng sang PGM-03 giống hệt nút
   *  "Kiểm tra" ở `DesignWorkspacePage`, nên nhận callback thay vì tự `useNavigate`
   *  (giữ `ProgramsTab` không phụ thuộc router, đúng ranh giới hiện có). */
  onRunCheck: () => void
}) {
  const { pick } = useI18n()
  const { session } = useAuth()
  const canEdit = roleAtLeast(session?.role, 'admin')
  const selected = document.programs.find((program) => program.programId === selectedProgramId)
  const activeProgramIds = useMemo(
    () => new Set((activeRevision.data?.snapshot?.objects ?? []).filter((item) => item.kind === 'PROGRAM').map((item) => item.objectId)),
    [activeRevision.data]
  )
  const runtimeConfirmed = runtime.status === 'ready' && runtime.data?.producerState === 'READY' && runtime.data.taskState === 'RUNNING' && activeRevision.status === 'ready' && activeRevision.data?.revisionId === runtime.data.activeRevisionId
  const [buffers, setBuffers] = useState<Record<string, string>>({})
  const [projectTagsDraft, setProjectTagsDraft] = useState(() => document.project.functionalTags.join(', '))
  const [metadataDrafts, setMetadataDrafts] = useState<Record<string, ProgramMetadataDraft>>({})
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const pendingDeleteProgram = document.programs.find((program) => program.programId === pendingDeleteId)

  /* ST Editor Quick Control (đã duyệt) — quyết định #02: hook LAZY, không
   * fetch `GET /point-catalog` khi mở tab Chương trình; sống ở đây (cha của
   * `SourceEditor`) để cache còn nguyên khi đổi Program đang chọn. */
  const pointCatalog = useLazyProgrammingPointCatalog()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [mobileExplorerOpen, setMobileExplorerOpen] = useState(false)
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false)
  const explorerTriggerRef = useRef<HTMLButtonElement>(null)
  const inspectorTriggerRef = useRef<HTMLButtonElement>(null)
  const explorerPaneRef = useRef<HTMLElement>(null)
  const inspectorPaneRef = useRef<HTMLElement>(null)
  const editorSurfaceRef = useRef<HTMLDivElement>(null)
  const editorFocusPendingRef = useRef(false)
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
    () => buildCommandPaletteEntries(document.programs, symbolsByProgramId, pick),
    [document.programs, symbolsByProgramId, pick],
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
      if (source !== programSource(program) || !sameMetadata(metadata, metadataOf(program))) {
        operations.push({
          op: 'upsertProgram',
          program: {
            ...program,
            name: metadata.name.trim() || program.name,
            kind: metadata.kind,
            functionalTags: parseTags(metadata.functionalTags),
            document: source
          }
        })
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

  function addProgram(language: 'ST' | 'FBD') {
    const programId = createUuid()
    const baseName = language === 'FBD' ? pick('FBD mới', 'New FBD') : pick('Chương trình mới', 'New program')
    const name = uniqueProgramName(document.programs, baseName)
    const newProgram: ProgrammingProgram = {
      programId,
      name,
      kind: 'PROGRAM',
      language,
      document: language === 'FBD' ? canonicalFbdJson(emptyFbdDocument(name)) : stProgramTemplate(),
      executionOrder: document.programs.length,
      functionalTags: []
    }
    void onSave([
      { op: 'upsertProgram', program: newProgram },
      { op: 'setTask', task: { ...document.task, programOrder: [...document.task.programOrder, programId] } }
    ]).then((ok) => {
      if (ok) onSelectProgram(programId)
    })
  }

  /** Xóa Program kéo theo Variable/Binding của nó — backend fail-closed nếu
   *  Variable còn `programId` trỏ tới Program không tồn tại, và
   *  `task.programOrder` phải khớp chính xác tập Program còn lại (draft.go
   *  `validateDraftDocument`), nên phải gửi cả bốn thao tác trong một batch. */
  function removeProgram(programId: string) {
    const variableIds = document.variables.filter((variable) => variable.programId === programId).map((variable) => variable.variableId)
    const bindingIds = document.bindings.filter((binding) => variableIds.includes(binding.variableId)).map((binding) => binding.bindingId)
    const operations: ProgrammingDraftOperation[] = [
      ...bindingIds.map((bindingId): ProgrammingDraftOperation => ({ op: 'removeBinding', bindingId })),
      ...variableIds.map((variableId): ProgrammingDraftOperation => ({ op: 'removeVariable', variableId })),
      { op: 'removeProgram', programId },
      { op: 'setTask', task: { ...document.task, programOrder: document.task.programOrder.filter((id) => id !== programId) } }
    ]
    void onSave(operations).then((ok) => {
      setPendingDeleteId(null)
      if (!ok) return
      if (selectedProgramId === programId) {
        const remaining = document.programs.find((program) => program.programId !== programId)
        onSelectProgram(remaining?.programId)
      }
    })
  }

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
    if (entry.commandId === 'format') {
      if (!selectedProgramId) return
      setBuffers((current) => ({ ...current, [selectedProgramId]: formatStSource(current[selectedProgramId] ?? '') }))
      return
    }
    if (entry.commandId === 'save') {
      void onSave(pendingOperations)
      return
    }
    onRunCheck()
  }

  useEffect(() => {
    if (!mobileExplorerOpen && !mobileInspectorOpen) return
    const previousOverflow = globalThis.document.body.style.overflow
    globalThis.document.body.style.overflow = 'hidden'
    const closeMobilePanes = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (mobileExplorerOpen) {
        setMobileExplorerOpen(false)
        explorerTriggerRef.current?.focus()
      }
      if (mobileInspectorOpen) {
        setMobileInspectorOpen(false)
        inspectorTriggerRef.current?.focus()
      }
    }
    globalThis.document.addEventListener('keydown', closeMobilePanes)
    const closeAtDesktopBreakpoint = () => {
      if (globalThis.innerWidth >= 1024) setMobileExplorerOpen(false)
      if (globalThis.innerWidth >= 1280) setMobileInspectorOpen(false)
    }
    globalThis.addEventListener('resize', closeAtDesktopBreakpoint)
    const pane = mobileExplorerOpen ? explorerPaneRef.current : inspectorPaneRef.current
    pane?.querySelector<HTMLElement>('button')?.focus()
    return () => {
      globalThis.document.removeEventListener('keydown', closeMobilePanes)
      globalThis.removeEventListener('resize', closeAtDesktopBreakpoint)
      globalThis.document.body.style.overflow = previousOverflow
    }
  }, [mobileExplorerOpen, mobileInspectorOpen])

  useEffect(() => {
    const closeAtDesktop = () => {
      if (globalThis.innerWidth >= 1024) setMobileExplorerOpen(false)
      if (globalThis.innerWidth >= 1280) setMobileInspectorOpen(false)
    }
    globalThis.addEventListener('resize', closeAtDesktop)
    closeAtDesktop()
    return () => globalThis.removeEventListener('resize', closeAtDesktop)
  }, [])

  useEffect(() => {
    if (!editorFocusPendingRef.current || !selected) return
    editorFocusPendingRef.current = false
    const frame = globalThis.requestAnimationFrame(() => {
      const target = editorSurfaceRef.current?.querySelector<HTMLElement>('textarea, [role="toolbar"] button')
      target?.focus()
    })
    return () => globalThis.cancelAnimationFrame(frame)
  }, [selected, selected?.language])

  function selectProgramFromExplorer(programId: string) {
    onSelectProgram(programId)
    if (mobileExplorerOpen) {
      editorFocusPendingRef.current = true
      setMobileExplorerOpen(false)
      // The selected program may already be active (for example after the
      // automatic first-program selection), so the selection effect alone
      // cannot reliably move focus into the editor.
      globalThis.setTimeout(() => {
        editorSurfaceRef.current?.querySelector<HTMLElement>('textarea, [role="toolbar"] button')?.focus()
      }, 0)
    }
  }

  function openPaletteFromShortcut() {
    if (!mobileExplorerOpen && !mobileInspectorOpen) {
      setPaletteOpen(true)
      return
    }
    const returnFocusRef = mobileExplorerOpen ? explorerTriggerRef : inspectorTriggerRef
    setMobileExplorerOpen(false)
    setMobileInspectorOpen(false)
    returnFocusRef.current?.focus()
    globalThis.requestAnimationFrame(() => setPaletteOpen(true))
  }

  function openPalette() {
    setMobileExplorerOpen(false)
    setMobileInspectorOpen(false)
    const returnFocusRef = mobileExplorerOpen ? explorerTriggerRef : inspectorTriggerRef
    returnFocusRef.current?.focus()
    setPaletteOpen(true)
  }

  function trapMobilePaneFocus(event: ReactKeyboardEvent<HTMLElement>, pane: HTMLElement | null) {
    if (event.key !== 'Tab' || !pane) return
    const focusable = [...pane.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]')]
    if (focusable.length === 0) { event.preventDefault(); pane.focus(); return }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && globalThis.document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && globalThis.document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  return (
    <div
      className="grid gap-2 min-[1024px]:grid-cols-[260px_1fr] min-[1280px]:grid-cols-[260px_1fr_300px]"
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
          event.preventDefault()
          openPaletteFromShortcut()
        }
      }}
    >
      <CommandPalette open={paletteOpen} entries={paletteEntries} onClose={() => setPaletteOpen(false)} onSelect={handlePaletteSelect} />
      <div className="col-span-full flex gap-2 min-[1280px]:hidden">
        <button ref={explorerTriggerRef} type="button" className="flex min-h-10 items-center gap-1 rounded border border-[var(--c-border)] px-3 py-2 text-sm min-[1024px]:hidden" aria-controls="programming-explorer-pane" aria-expanded={mobileExplorerOpen} onClick={() => setMobileExplorerOpen(true)}><PanelLeft className="h-4 w-4" aria-hidden="true" />{pick('Cây', 'Explorer')}</button>
        <button ref={inspectorTriggerRef} type="button" className="flex min-h-10 items-center gap-1 rounded border border-[var(--c-border)] px-3 py-2 text-sm min-[1280px]:hidden" aria-controls="programming-inspector-pane" aria-expanded={mobileInspectorOpen} onClick={() => setMobileInspectorOpen(true)}><PanelRight className="h-4 w-4" aria-hidden="true" />{pick('Thuộc tính', 'Inspector')}</button>
      </div>
      {(mobileExplorerOpen || mobileInspectorOpen) && <button type="button" className="fixed inset-0 z-40 bg-black/40 min-[1280px]:hidden" aria-label={pick('Đóng ngăn kéo', 'Close drawer')} onClick={() => {
        if (mobileExplorerOpen) explorerTriggerRef.current?.focus()
        if (mobileInspectorOpen) inspectorTriggerRef.current?.focus()
        setMobileExplorerOpen(false)
        setMobileInspectorOpen(false)
      }} />}
      <nav id="programming-explorer-pane" ref={explorerPaneRef} role={mobileExplorerOpen ? 'dialog' : undefined} aria-modal={mobileExplorerOpen || undefined} aria-label={pick('Cây ứng dụng', 'Application tree')} tabIndex={mobileExplorerOpen ? -1 : undefined} onKeyDown={(event) => trapMobilePaneFocus(event, explorerPaneRef.current)} className={`rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-2 ${mobileExplorerOpen ? 'fixed inset-y-0 left-0 z-50 w-[min(20rem,86vw)] overflow-y-auto shadow-xl' : 'hidden'} min-[1024px]:static min-[1024px]:block min-[1024px]:w-auto min-[1024px]:shadow-none`}>
        {mobileExplorerOpen && <button type="button" className="mb-2 min-h-10 min-w-10 rounded border border-[var(--c-border)] p-2 text-sm min-[1024px]:hidden" aria-label={pick('Đóng cây ứng dụng', 'Close explorer')} onClick={() => { setMobileExplorerOpen(false); explorerTriggerRef.current?.focus() }}><X className="h-4 w-4" aria-hidden="true" /></button>}
        <ProgramExplorer
          canEdit={canEdit}
          saving={saving}
          functionalTags={projectTagsDraft}
          projectFunctionalTags={parseTags(projectTagsDraft)}
          programs={document.programs}
          projectName={document.project.name}
          activeProgramIds={activeProgramIds}
          runtimeConfirmed={runtimeConfirmed}
          selectedProgramId={selectedProgramId}
          onFunctionalTagsChange={setProjectTagsDraft}
          onSaveFunctionalTags={() => onSave([{ op: 'setFunctionalTags', tags: parseTags(projectTagsDraft) }])}
          onOpenCommandPalette={openPalette}
          onAddProgram={addProgram}
          onSelectProgram={selectProgramFromExplorer}
          onRequestDelete={setPendingDeleteId}
        />
      </nav>
      <Modal
        open={pendingDeleteId !== null}
        title={pick('Xóa chương trình?', 'Delete program?')}
        danger
        confirmLabel={pick('Xóa', 'Delete')}
        confirmLoading={saving}
        onConfirm={() => {
          if (pendingDeleteId) removeProgram(pendingDeleteId)
        }}
        onClose={() => setPendingDeleteId(null)}
      >
        <p>
          {pick(
            `Xóa "${pendingDeleteProgram?.name ?? ''}" sẽ xóa cả mã nguồn, biến và ánh xạ liên quan tới Program này. Không thể hoàn tác sau khi lưu.`,
            `Deleting "${pendingDeleteProgram?.name ?? ''}" also removes its source code, variables, and mappings. This cannot be undone after saving.`
          )}
        </p>
      </Modal>
      <div ref={editorSurfaceRef} className="min-w-0">
        {selected && (
          <ProgramOrientationStrip
            program={selected}
            projectName={document.project.name}
            projectFunctionalTags={parseTags(projectTagsDraft)}
            live={runtimeConfirmed && activeProgramIds.has(selected.programId)}
          />
        )}
        {selected && (
          <ProgramRuntimeStrip
            program={selected}
            runtime={runtime}
            activeRevision={activeRevision}
            active={runtimeConfirmed && activeProgramIds.has(selected.programId)}
          />
        )}
        {!selected ? (
          <p className="text-sm text-[var(--c-text-dim)]">{pick('Chọn một chương trình ở cây bên trái.', 'Select a program from the tree on the left.')}</p>
        ) : selected.language === 'ST' ? (
          <SourceEditor
            program={selected}
            source={buffers[selected.programId] ?? programSource(selected)}
            canEdit={canEdit}
            saving={saving}
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
          />
        ) : (
          <FbdEditorPane
            program={selected}
            source={buffers[selected.programId] ?? programSource(selected)}
            canEdit={canEdit}
            saving={saving}
            onChange={(source) => setBuffers((current) => ({ ...current, [selected.programId]: source }))}
            onSave={onSave}
          />
        )}
      </div>
      <aside id="programming-inspector-pane" ref={inspectorPaneRef} role={mobileInspectorOpen ? 'dialog' : undefined} aria-modal={mobileInspectorOpen || undefined} aria-label={pick('Thuộc tính', 'Inspector')} tabIndex={mobileInspectorOpen ? -1 : undefined} onKeyDown={(event) => trapMobilePaneFocus(event, inspectorPaneRef.current)} className={`${mobileInspectorOpen ? 'fixed inset-y-0 right-0 z-50 w-[min(20rem,86vw)] overflow-y-auto bg-[var(--c-bg)] p-3 shadow-xl' : 'hidden'} min-[1280px]:static min-[1280px]:block min-[1280px]:w-auto min-[1280px]:overflow-visible min-[1280px]:bg-transparent min-[1280px]:p-0 min-[1280px]:shadow-none`}>
        {mobileInspectorOpen && <button type="button" className="mb-2 min-h-10 min-w-10 rounded border border-[var(--c-border)] p-2 text-sm min-[1280px]:hidden" aria-label={pick('Đóng thuộc tính', 'Close inspector')} onClick={() => { setMobileInspectorOpen(false); inspectorTriggerRef.current?.focus() }}><X className="h-4 w-4" aria-hidden="true" /></button>}
        {selected ? (
          <ProgramInspector
            draft={metadataDrafts[selected.programId] ?? metadataOf(selected)}
            program={selected}
            variables={document.variables.filter((variable) => variable.programId === selected.programId)}
            bindings={document.bindings}
            source={buffers[selected.programId] ?? programSource(selected)}
            active={runtimeConfirmed && activeProgramIds.has(selected.programId)}
            activeRevisionId={runtime.data?.activeRevisionId ?? null}
            canEdit={canEdit}
            saving={saving}
            dirty={!sameMetadata(metadataDrafts[selected.programId] ?? metadataOf(selected), metadataOf(selected))}
            duplicateName={isDuplicateProgramName(document.programs, (metadataDrafts[selected.programId] ?? metadataOf(selected)).name, selected.programId)}
            onChange={(draft) => setMetadataDrafts((current) => ({ ...current, [selected.programId]: draft }))}
            onSave={() => {
              const draft = metadataDrafts[selected.programId] ?? metadataOf(selected)
              void onSave([{ op: 'upsertProgram', program: { ...selected, name: draft.name.trim(), kind: draft.kind, functionalTags: parseTags(draft.functionalTags) } }])
            }}
          />
        ) : (
          <section className="rounded-[var(--radius)] border border-[var(--c-border)] p-3">
            <h3 className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Thuộc tính', 'Inspector')}</h3>
            <p className="mt-2 text-xs text-[var(--c-text-dim)]">
              {pick('Chọn một chương trình để xem thuộc tính.', 'Select a program to see its properties.')}
            </p>
          </section>
        )}
      </aside>
    </div>
  )
}

function ProgramRuntimeStrip({
  program,
  runtime,
  activeRevision,
  active
}: {
  program: ProgrammingProgram
  runtime: RemoteState<ProgrammingRuntime>
  activeRevision: RemoteState<ProgrammingRevision | null>
  active: boolean
}) {
  const { pick } = useI18n()
  if (runtime.status === 'loading' || activeRevision.status === 'loading') {
    return <div role="status" className="mb-2 border-l-4 border-slate-400 bg-[var(--c-surface-2)] px-3 py-2 text-xs text-[var(--c-text-dim)]">{pick('Đang đối chiếu Program với bản Active…', 'Checking the program against the active revision…')}</div>
  }
  if (active) {
    return (
      <div role="status" className="mb-2 flex flex-wrap items-center justify-between gap-2 border-l-4 border-[var(--c-good)] bg-[var(--c-good-bg)] px-3 py-2 text-xs text-[var(--c-good-fg)]">
        <span><strong>● {pick('ĐANG CHẠY', 'RUNNING')}</strong> · {program.name} {pick('có trong bản Active', 'is present in active revision')} <span className="font-mono">{runtime.data?.activeRevisionId?.slice(0, 8)}</span></span>
        <span className="font-mono">{runtime.data?.task?.taskId ?? 'Task'} · {runtime.data?.task?.periodMs ?? '—'} ms · scan #{runtime.data?.task?.runCount ?? '—'}</span>
      </div>
    )
  }
  if (runtime.status === 'ready' && runtime.data?.activeRevisionId) {
    return (
      <div role="status" className="mb-2 border-l-4 border-[var(--c-warn)] bg-[var(--c-warn-bg)] px-3 py-2 text-xs text-[var(--c-warn-fg)]">
        <strong>{pick('BẢN NHÁP KHÔNG PHẢI BẢN ĐANG CHẠY.', 'THE DRAFT IS NOT THE RUNNING REVISION.')}</strong>{' '}
        {pick('Runtime đang dùng bản Active', 'Runtime is using active revision')} <span className="font-mono">{runtime.data.activeRevisionId.slice(0, 8)}</span>.
      </div>
    )
  }
  return <div role="status" className="mb-2 border-l-4 border-[var(--c-warn)] bg-[var(--c-warn-bg)] px-3 py-2 text-xs text-[var(--c-warn-fg)]">{pick('Chưa xác minh được Program đang chạy từ runtime authority.', 'The running program could not be verified from runtime authority.')}</div>
}

function ProgramOrientationStrip({
  program,
  projectName,
  projectFunctionalTags,
  live
}: {
  program: ProgrammingProgram
  projectName: string
  projectFunctionalTags: string[]
  live: boolean
}) {
  const { pick } = useI18n()
  const group = primaryFunctionalTag(program.functionalTags, projectFunctionalTags) ?? pick('Chưa phân nhóm', 'Unassigned')
  return (
    <div
      className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 py-2"
      aria-label={pick('Định hướng lựa chọn chương trình', 'Program selection orientation')}
    >
      <nav aria-label={pick('Đường dẫn chương trình', 'Program breadcrumb')} className="flex min-w-0 flex-wrap items-center gap-1 text-xs">
        <span className="font-semibold text-[var(--c-text-dim)]">{projectName}</span>
        <span aria-hidden="true" className="text-[var(--c-text-dim)]">/</span>
        <span className="inline-flex items-center gap-1 text-[var(--c-text-dim)]"><Tag className="h-3.5 w-3.5" aria-hidden="true" />{group}</span>
        <span aria-hidden="true" className="text-[var(--c-text-dim)]">/</span>
        <strong className="truncate text-[var(--c-text)]">{program.name}</strong>
      </nav>
      <div className="flex shrink-0 items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--c-text-dim)]">
        <span>{program.kind} · {program.language}</span>
        {live && <span className="rounded-full bg-[var(--c-good-bg)] px-2 py-0.5 text-[var(--c-good-fg)]">LIVE</span>}
      </div>
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
  onEnsurePointCatalogLoaded
}: {
  program: ProgrammingProgram
  source: string
  canEdit: boolean
  saving: boolean
  diagnostics: ProgrammingDiagnostic[]
  focusDiagnostic: ProgrammingDiagnostic | null
  onChange: (source: string) => void
  onSave: (operations: ProgrammingDraftOperation[]) => Promise<boolean>
  /** ST Editor Quick Control đề xuất #3 (Panel chèn nhanh Point/Variable) —
   *  trạng thái/cache của `useLazyProgrammingPointCatalog`, sống ở
   *  `ProgramsTab` (cha) để không refetch khi đổi Program đang mở. */
  pointCatalogStatus: 'idle' | 'loading' | 'ready' | 'error'
  pointCatalogItems: readonly ProgrammingPointCatalogEntry[]
  pointCatalogError: string | null
  onEnsurePointCatalogLoaded: () => void
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
  const [completion, setCompletion] = useState<{ open: boolean; items: StCompletionItem[]; selected: number; anchor: number }>(
    { open: false, items: [], selected: 0, anchor: 0 },
  )
  /* ST Editor Quick Control #1 (Thanh lệnh nhanh nổi): vùng chọn KHÔNG rỗng
   * hiện tại — `null` khi con trỏ chỉ là một điểm (không hiện thanh lệnh). */
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number } | null>(null)
  const [insertPanelOpen, setInsertPanelOpen] = useState(false)
  const symbols = useMemo(() => collectStSymbols(source), [source])
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

  function updateCursor() {
    const textarea = textareaRef.current
    const offset = textarea?.selectionStart ?? 0
    setCursor(offsetToLineColumn(source, offset))
    const start = textarea?.selectionStart ?? 0
    const end = textarea?.selectionEnd ?? 0
    setSelectionRange(start === end ? null : { start, end })
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
    pendingCursorRef.current = { value: next, selectionStart, selectionEnd }
    onChange(next)
    setCursor(offsetToLineColumn(next, selectionEnd))
    setSelectionRange(selectionStart === selectionEnd ? null : { start: selectionStart, end: selectionEnd })
  }

  function applyEdit(next: string, newCursor: number) {
    applyEditRange(next, newCursor, newCursor)
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
                icon={<PlusSquare className="h-4 w-4" aria-hidden="true" />}
                aria-pressed={insertPanelOpen}
                title={pick('Chèn nhanh Point/Variable (Ctrl+I)', 'Quick insert Point/Variable (Ctrl+I)')}
                onClick={() => setInsertPanelOpen((open) => !open)}
              >
                {pick('Chèn Point/Variable', 'Insert Point/Variable')}
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
      <div className="relative grid h-[clamp(22rem,36vh,30rem)] grid-cols-[3.5rem_1fr] overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] focus-within:border-[var(--c-accent)] min-[1280px]:h-[clamp(17rem,28vh,22rem)]">
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
        <div className="relative h-full overflow-hidden">
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
            className="absolute inset-0 h-full w-full resize-none whitespace-pre border-0 bg-transparent outline-none"
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
              const next = event.target.value
              const offset = event.target.selectionStart
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
              pendingCursorRef.current = { value: next, selectionStart: offset, selectionEnd: offset }
              onChange(next)
              setCursor(offsetToLineColumn(next, offset))
              refreshCompletion(next, offset)
            }}
            onClick={() => { updateCursor(); closeCompletion() }}
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
      <div className="rounded-[var(--radius)] border border-[var(--c-border)] p-2 min-[1280px]:hidden">
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
  onSave
}: {
  program: ProgrammingProgram
  source: string
  canEdit: boolean
  saving: boolean
  onChange: (source: string) => void
  onSave: (operations: ProgrammingDraftOperation[]) => Promise<boolean>
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
      <StructuredFbdEditor document={local} canEdit={canEdit} onChange={(next) => onChange(canonicalFbdJson(next))} />
      {dirty && <p className="text-xs text-[var(--c-warn-fg)]">{pick('Chưa lưu.', 'Not saved.')}</p>}
    </div>
  )
}

function metadataOf(program: ProgrammingProgram): ProgramMetadataDraft {
  return { name: program.name, kind: program.kind, functionalTags: (program.functionalTags ?? []).join(', ') }
}

function sameMetadata(left: ProgramMetadataDraft, right: ProgramMetadataDraft): boolean {
  return left.name === right.name && left.kind === right.kind && sameTags(parseTags(left.functionalTags), parseTags(right.functionalTags))
}

function parseTags(value: string): string[] {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))]
}

function sameTags(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

/** So khớp tên không phân biệt hoa/thường và khoảng trắng đầu/cuối — hai
 *  Program tên "New program" và " new program " coi là trùng. */
export function isDuplicateProgramName(programs: ProgrammingProgram[], name: string, excludeProgramId?: string): boolean {
  const normalized = name.trim().toLocaleLowerCase()
  if (!normalized) return false
  return programs.some((program) => program.programId !== excludeProgramId && program.name.trim().toLocaleLowerCase() === normalized)
}

/** Sinh tên duy nhất kiểu "New program 2", "New program 3" — tránh im lặng
 *  tạo hai Program cùng tên khi bấm ST+/FBD nhiều lần (BUG-006). */
export function uniqueProgramName(programs: ProgrammingProgram[], baseName: string): string {
  if (!isDuplicateProgramName(programs, baseName)) return baseName
  let suffix = 2
  while (isDuplicateProgramName(programs, `${baseName} ${suffix}`)) suffix += 1
  return `${baseName} ${suffix}`
}

function programSource(program: ProgrammingProgram): string {
  if (typeof program.document === 'string') return program.document
  return JSON.stringify(program.document)
}

interface StSymbol { name: string; type: string; offset: number; references: number }

/** Khai báo VAR hợp lệ ngay sau `^` (đầu file), sau `;`/xuống dòng (câu lệnh
 *  trước đó), hoặc ngay sau từ khoá mở khối VAR* — KHÔNG bắt buộc đứng đầu
 *  dòng như trước (BUG-013): source dán một dòng duy nhất (chưa qua Format)
 *  vẫn phải nhận diện được khai báo. */
const ST_VAR_DECLARATION = /(?:^|[;\n]|\bVAR(?:_INPUT|_OUTPUT|_IN_OUT|_TEMP)?\b)\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(BOOL|INT|DINT|UINT|REAL|TIME)\b/gi

export function collectStSymbols(source: string): StSymbol[] {
  const output: StSymbol[] = []
  const declaration = new RegExp(ST_VAR_DECLARATION.source, ST_VAR_DECLARATION.flags)
  let match: RegExpExecArray | null
  while ((match = declaration.exec(source)) !== null) {
    const nameOffset = match.index + match[0].indexOf(match[1])
    const references = source.match(new RegExp(`\\b${escapeRegExp(match[1])}\\b`, 'gi'))?.length ?? 0
    output.push({ name: match[1], type: match[2].toUpperCase(), offset: nameOffset, references })
  }
  return output
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

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
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
