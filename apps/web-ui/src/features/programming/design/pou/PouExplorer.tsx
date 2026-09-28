import { useEffect, useMemo, useRef, useState } from 'react'
import { Boxes, ChevronDown, Download, FileCode2, FunctionSquare, MoreHorizontal, Plus, Upload } from 'lucide-react'
import { buildPouBackup, parsePouBackup, planImportPouOperations, serializePouBackup, type CollisionStrategy, type PouBackupFile } from './pouBackup'
import { Modal } from '../../../../shared/components/Modal'
import { createUuid } from '../../../../shared/crypto'
import { useI18n } from '../../../../shared/i18n'
import type { ProgrammingDraftDocument, ProgrammingDraftOperation } from '../../model/types'
import { LIBRARY_DRAG_TYPE } from '../library/QuickLibraryPanel'
import { userPouPaletteEntry } from '../../fbd/userPou'
import { userPouInterfacesFromDraft } from '../editor/workspaceAdapters'
import {
  createPouOperations,
  deletePouOperations,
  duplicatePouOperations,
  pouDeleteBlockers,
  pouPublishedSignalBlockers,
  renamePouOperations,
  uniquePouName,
  validatePouName
} from './pouCommands'
import { filterPouItems, groupPouItems, pouItems, resolvePouSelection, type PouItem, type PouKind, type PouLanguage } from './pouViewModel'
import { formatProgrammingPeriod } from '../../model/cyclePeriods'

/**
 * `T59-803` (`PGM02-V22-WP-02`) — MỘT POU Explorer duy nhất cho PGM-02.
 *
 * Trước lát này DOM có hai navigation POU cùng lúc: "Cây POU" (đọc `objects[]`,
 * ba kind, không sửa được) và "Cây ứng dụng" bên trong tab Chương trình (đọc
 * `programs[]`, chỉ PROGRAM, có nút tạo/xoá). Hai cây đọc hai nguồn khác nhau
 * nên chúng có thể nói khác nhau về cùng một Project, và người dùng bàn phím
 * phải đi qua cả hai để tới cùng một POU. Bản này giữ lại đúng một cây, đọc
 * đúng một view model (`pouItems`), và là nơi duy nhất phát ra thao tác vòng
 * đời POU.
 *
 * Chọn POU dùng `objectId`. `programId` chỉ xuất hiện ở lớp runtime.
 */
const GROUP_META: Record<PouKind, { label: [string, string]; icon: typeof FileCode2 }> = {
  PROGRAM: { label: ['Programs', 'Programs'], icon: FileCode2 },
  FUNCTION_BLOCK: { label: ['Function Blocks', 'Function Blocks'], icon: Boxes },
  FUNCTION: { label: ['Functions', 'Functions'], icon: FunctionSquare }
}

const NAME_ERROR_COPY: Record<'EMPTY' | 'PATTERN' | 'DUPLICATE' | 'SYSTEM_BLOCK', [string, string]> = {
  EMPTY: ['Tên POU không được để trống.', 'The POU name cannot be empty.'],
  PATTERN: [
    'Tên POU chỉ nhận chữ, số và gạch dưới, và không bắt đầu bằng số.',
    'A POU name accepts letters, digits, and underscores, and cannot start with a digit.'
  ],
  DUPLICATE: ['Tên POU đã tồn tại trong Project.', 'That POU name already exists in this project.'],
  SYSTEM_BLOCK: ['Tên POU trùng với khối thư viện hệ thống.', 'The POU name collides with a system library block.']
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(2)} MB`
}

export function PouExplorer({
  document,
  publishedSignals,
  bindingOwners,
  canEdit,
  saving,
  selectedObjectId,
  onSelect,
  onSave,
  className = 'w-[244px] min-w-[244px] max-w-[244px]'
}: {
  className?: string
  document: ProgrammingDraftDocument
  /**
   * Tín hiệu công bố của Draft. Đọc từ draft THÔ ở trang cha: `signals[]` không
   * đi qua `toWorkspaceDocument`, nên Explorer không tự lấy được.
   */
  publishedSignals?: readonly { signalId: string; name: string; publisherProgramId: string }[]
  /**
   * Owner `programId` của mọi Binding, cũng đọc từ draft THÔ: view Mapping
   * fail-closed nên không đủ để biết xoá POU phải gỡ những Binding nào.
   */
  bindingOwners?: readonly { bindingId: string; programId: string }[]
  canEdit: boolean
  saving: boolean
  selectedObjectId?: string
  onSelect: (objectId: string | undefined) => void
  onSave: (operations: ProgrammingDraftOperation[]) => Promise<boolean>
}) {
  const { pick } = useI18n()
  const [query, setQuery] = useState('')
  const [renamingObjectId, setRenamingObjectId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [pendingDeleteObjectId, setPendingDeleteObjectId] = useState<string | null>(null)
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const [creatingPou, setCreatingPou] = useState<{ kind: PouKind; language: PouLanguage } | null>(null)
  const [createName, setCreateName] = useState('')
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const [exportModalOpen, setExportModalOpen] = useState(false)
  const [exportSelectedIds, setExportSelectedIds] = useState<Set<string>>(new Set())
  const [exportFileName, setExportFileName] = useState('')
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importBackupData, setImportBackupData] = useState<PouBackupFile | null>(null)
  const [importSelectedIndices, setImportSelectedIndices] = useState<Set<number>>(new Set())
  const [importStrategy, setImportStrategy] = useState<CollisionStrategy>('RENAME')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const importFileInputRef = useRef<HTMLInputElement | null>(null)
  const createInputRef = useRef<HTMLInputElement | null>(null)
  /* `DEV-PROG-006` — nhóm gập được. Mặc định MỞ cả ba: một cây mặc định đóng
   * bắt người dùng bấm thêm một lần cho việc họ luôn làm (tìm POU để mở). */
  const [collapsedGroups, setCollapsedGroups] = useState<readonly PouKind[]>([])
  /* Menu ngữ cảnh dùng chung cho chuột phải và nút `…` có accessible name.
   * Vì vậy các thao tác vẫn tới được bằng bàn phím mà không phải bày ba icon
   * thường trực trên mọi hàng POU. */
  const [menu, setMenu] = useState<{ objectId: string; x: number; y: number } | null>(null)

  const items = useMemo(() => pouItems(document), [document])
  /* Lọc CHỈ đổi thứ được vẽ, không đổi POU đang chọn: gõ vào ô tìm kiếm mà
   * editor bị đổi tệp là mất nội dung đang soạn. */
  const visible = useMemo(() => filterPouItems(items, query), [items, query])

  const exportBackupSize = useMemo(() => {
    if (exportSelectedIds.size === 0) return 0
    try {
      const backup = buildPouBackup(document, Array.from(exportSelectedIds))
      const jsonStr = serializePouBackup(backup)
      return new TextEncoder().encode(jsonStr).length
    } catch {
      return 0
    }
  }, [document, exportSelectedIds])
  const groups = useMemo(() => groupPouItems(visible), [visible])
  const userPouMap = useMemo(() => {
    const pous = userPouInterfacesFromDraft(document)
    return new Map(pous.map((p) => [p.name, p]))
  }, [document])
  const pendingDelete = resolvePouSelection(items, pendingDeleteObjectId ?? undefined)
  const deleteBlockers = pendingDelete ? pouDeleteBlockers(items, pendingDelete.objectId) : []
  /* Chặn thứ hai, độc lập: POU đang publish một tín hiệu thì backend từ chối
     `removeProgram`. Không kiểm ở đây thì người dùng bấm `Xóa` và nhận một mã
     lỗi 400 không nói cho họ biết phải làm gì. */
  const signalBlockers = pendingDelete
    ? pouPublishedSignalBlockers(publishedSignals ?? [], pendingDelete)
    : []
  const deleteBlocked = deleteBlockers.length > 0 || signalBlockers.length > 0

  useEffect(() => {
    if (renamingObjectId && renameInputRef.current) renameInputRef.current.focus()
  }, [renamingObjectId])

  useEffect(() => {
    if (creatingPou && createInputRef.current) createInputRef.current.focus()
  }, [creatingPou])

  useEffect(() => {
    if (!canEdit) {
      setRenamingObjectId(null)
      setPendingDeleteObjectId(null)
      setCreatingPou(null)
      setCreateName('')
      setMenu(null)
      setCreateMenuOpen(false)
    }
  }, [canEdit])

  /* Menu ngữ cảnh phải đóng khi bấm ra ngoài hoặc nhấn Escape — nếu không nó
   * sống sót qua mọi thao tác khác và trỏ tới một POU người dùng đã rời khỏi. */
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(null) }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  useEffect(() => {
    if (!createMenuOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCreateMenuOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [createMenuOpen])

  const renameError = renamingObjectId ? validatePouName(items, renameDraft, renamingObjectId) : null
  const createError = creatingPou ? validatePouName(items, createName) : null

  function confirmCreate() {
    if (!creatingPou || createName.trim() === '' || createError) return
    const target = creatingPou
    const name = createName.trim()
    const result = createPouOperations(items, {
      kind: target.kind,
      language: target.language,
      objectId: createUuid(),
      task: document.task,
      name,
    })
    void onSave(result.operations).then((ok) => {
      if (ok) {
        setCreatingPou(null)
        setCreateName('')
        onSelect(result.objectId)
      }
    })
  }

  function openExportModal(targetObjectId?: string) {
    if (targetObjectId) {
      setExportSelectedIds(new Set([targetObjectId]))
    } else {
      setExportSelectedIds(new Set(items.map((i) => i.objectId)))
    }
    const safeProjectName = (document.project?.name || 'pous').replace(/[^a-zA-Z0-9_-]/g, '_')
    const dateStr = new Date().toISOString().slice(0, 10)
    setExportFileName(`mkddc-backup-${safeProjectName}-${dateStr}`)
    setExportModalOpen(true)
  }

  function handleExportConfirm() {
    if (exportSelectedIds.size === 0) return
    const backup = buildPouBackup(document, Array.from(exportSelectedIds))
    const jsonStr = serializePouBackup(backup)
    const blob = new Blob([jsonStr], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = globalThis.document.createElement('a')
    anchor.href = url
    const safeProjectName = (document.project?.name || 'pous').replace(/[^a-zA-Z0-9_-]/g, '_')
    const dateStr = new Date().toISOString().slice(0, 10)
    const rawName = exportFileName.trim() || `mkddc-backup-${safeProjectName}-${dateStr}`
    anchor.download = rawName.toLowerCase().endsWith('.json') ? rawName : `${rawName}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    setExportModalOpen(false)
  }

  async function handleImportFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const parseResult = parsePouBackup(text)
      if (!parseResult.ok) {
        setImportError(parseResult.error)
        return
      }
      setImportBackupData(parseResult.backup)
      setImportSelectedIndices(new Set(parseResult.backup.pous.map((_, idx) => idx)))
      setImportStrategy('RENAME')
      setImportModalOpen(true)
      setImportError(null)
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : pick('Không thể đọc tệp sao lưu.', 'Could not read backup file.')
      )
    } finally {
      if (importFileInputRef.current) {
        importFileInputRef.current.value = ''
      }
    }
  }

  async function handleImportConfirm() {
    if (!importBackupData || importSelectedIndices.size === 0) return
    setImporting(true)
    try {
      const selectedPous = importBackupData.pous.filter((_, idx) => importSelectedIndices.has(idx))
      const plan = planImportPouOperations({
        document,
        itemsToImport: selectedPous,
        strategy: importStrategy,
        newObjectIdFactory: createUuid
      })

      if (plan.operations.length === 0) {
        setImportModalOpen(false)
        setImportBackupData(null)
        return
      }

      const ok = await onSave(plan.operations)
      if (ok) {
        setImportModalOpen(false)
        setImportBackupData(null)
        if (plan.importedObjectIds.length > 0) {
          onSelect(plan.importedObjectIds[0])
        }
      }
    } finally {
      setImporting(false)
    }
  }

  function duplicate(item: PouItem) {
    const result = duplicatePouOperations(items, item, createUuid())
    void onSave(result.operations).then((ok) => {
      if (ok) onSelect(result.objectId)
    })
  }

  function commitRename() {
    if (!renamingObjectId || renameError) return
    void onSave(renamePouOperations(renamingObjectId, renameDraft)).then((ok) => {
      if (ok) setRenamingObjectId(null)
    })
  }

  function confirmDelete() {
    if (!pendingDelete || deleteBlocked) return
    void onSave(deletePouOperations(document, pendingDelete, bindingOwners)).then((ok) => {
      setPendingDeleteObjectId(null)
      if (!ok) return
      if (selectedObjectId === pendingDelete.objectId) {
        onSelect(items.find((item) => item.objectId !== pendingDelete.objectId)?.objectId)
      }
    })
  }

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <div className="flex w-full min-w-0 items-center justify-between gap-2">
        <label className="sr-only" htmlFor="pou-explorer-search">
          {pick('Tìm POU', 'Find a POU')}
        </label>
        <input
          id="pou-explorer-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={pick('Tìm POU…', 'Find a POU…')}
          className="min-w-0 flex-1 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1 text-xs text-[var(--c-text)]"
        />
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label={pick('Sao lưu POU', 'Backup POUs')}
            title={pick('Sao lưu POU…', 'Backup POUs…')}
            disabled={items.length === 0}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] text-[var(--c-text-dim)] hover:text-[var(--c-text)] hover:bg-[var(--c-surface-2)] disabled:opacity-40 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
            onClick={() => openExportModal()}
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          {canEdit && (
            <button
              type="button"
              aria-label={pick('Nhập POU', 'Import POUs')}
              title={pick('Nhập POU từ tệp…', 'Import POUs from file…')}
              className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] text-[var(--c-text-dim)] hover:text-[var(--c-text)] hover:bg-[var(--c-surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
              onClick={() => importFileInputRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
          {canEdit && (
            <div className="relative shrink-0">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={createMenuOpen}
                className="inline-flex min-h-8 items-center gap-1 rounded-[var(--radius)] bg-[var(--c-accent-bg)] px-2 text-xs font-semibold text-[var(--c-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
                onClick={() => setCreateMenuOpen((open) => !open)}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                {pick('Mới', 'New')}
              </button>
            {createMenuOpen && (
              <div
                role="menu"
                aria-label={pick('Tạo POU mới', 'Create a new POU')}
                className="absolute right-0 top-full z-30 mt-1 min-w-52 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] py-1 shadow-lg"
              >
                <MenuItem
                  label={pick('Program · ST', 'Program · ST')}
                  onClick={() => {
                    setCreateMenuOpen(false)
                    setCreatingPou({ kind: 'PROGRAM', language: 'ST' })
                    setCreateName('')
                  }}
                />
                <MenuItem
                  label={pick('Program · FBD', 'Program · FBD')}
                  onClick={() => {
                    setCreateMenuOpen(false)
                    setCreatingPou({ kind: 'PROGRAM', language: 'FBD' })
                    setCreateName('')
                  }}
                />
                <MenuItem
                  label={pick('Function · ST', 'Function · ST')}
                  onClick={() => {
                    setCreateMenuOpen(false)
                    setCreatingPou({ kind: 'FUNCTION', language: 'ST' })
                    setCreateName('')
                  }}
                />
                <MenuItem
                  label={pick('Function Block · ST', 'Function Block · ST')}
                  onClick={() => {
                    setCreateMenuOpen(false)
                    setCreatingPou({ kind: 'FUNCTION_BLOCK', language: 'ST' })
                    setCreateName('')
                  }}
                />
              </div>
            )}
          </div>
        )}
        </div>
      </div>

      {items.length === 0 && (
        <p className="px-1 text-sm text-[var(--c-text-dim)]">
          {canEdit
            ? pick('Chưa có chương trình. Bấm Mới để tạo.', 'No programs yet. Select New to create one.')
            : pick('Chưa có chương trình.', 'No programs yet.')}
        </p>
      )}

      <nav aria-label={pick('Cây POU', 'POU tree')} className="flex flex-col gap-2">
        {groups.map(({ kind, items: group }) => {
          const { label, icon: Icon } = GROUP_META[kind]
          /* Đang lọc thì nhóm LUÔN mở: gõ vào ô tìm kiếm rồi thấy "0 kết quả"
             trong khi kết quả nằm trong một nhóm đang đóng là một câu trả lời
             sai cho một câu hỏi đúng. */
          const collapsed = query.trim() === '' && collapsedGroups.includes(kind)
          const groupId = `pou-group-${kind}`
          return (
            <section key={kind}>
              <h3>
                <button
                  type="button"
                  aria-label={`${pick(...label)} (${group.length})`}
                  aria-expanded={!collapsed}
                  aria-controls={groupId}
                  /* `min-h-7` (28 px) là NGƯỠNG CẢM ỨNG, không phải trang trí:
                     WCAG 2.2 `target-size` đòi tối thiểu 24 px, và axe bắt đúng
                     nút này khi reset form của `styles.css` chuyển vào
                     `@layer base` — lúc đó `text-xs` của Tailwind mới thật sự
                     áp lên nút và chiều cao tụt xuống dưới ngưỡng. */
                  className="flex min-h-7 w-full items-center gap-1.5 rounded px-0.5 text-left text-xs font-semibold text-[var(--c-text-dim)] hover:text-[var(--c-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
                  onClick={() => setCollapsedGroups((current) => (
                    current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind]
                  ))}
                >
                  <ChevronDown
                    className={`h-3.5 w-3.5 shrink-0 transition-transform duration-150 ${collapsed ? '-rotate-90' : ''}`}
                    aria-hidden="true"
                  />
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="flex-1 truncate">{pick(...label)}</span>
                  <span
                    data-testid={`pou-section-badge-${kind}`}
                    className="ml-auto rounded-full bg-[var(--c-surface-2)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--c-text-dim)]"
                  >
                    {group.length}
                  </span>
                </button>
              </h3>
              {/* Thân nhóm LUÔN có mặt trong DOM và luôn mang `id`, kể cả khi
                  nhóm rỗng: `aria-controls` của nút gập trỏ vào đây, và một
                  `aria-controls` trỏ tới id không tồn tại là lỗi
                  `aria-valid-attr-value` mà axe bắt được — nút nói nó điều
                  khiển một vùng không có thật. */}
              <div id={groupId}>
              {collapsed ? null : group.length === 0 ? (
                <p className="px-5 py-1 text-sm text-[var(--c-text-dim)]">
                  {query.trim() === '' ? pick('Chưa có', 'None yet') : pick('Không khớp', 'No match')}
                </p>
              ) : (
                <ul aria-label={pick(...label)} className="flex w-full min-w-0 flex-col">
                  {group.map((item) => {
                    let validityReason: string | null = null
                    const pouInterface = userPouMap.get(item.name)
                    if (pouInterface) {
                      try {
                        userPouPaletteEntry(pouInterface)
                      } catch (err) {
                        validityReason = err instanceof Error ? err.message : 'POU không hợp lệ'
                      }
                    }
                    const isDraggable = (item.kind === 'FUNCTION_BLOCK' || item.kind === 'FUNCTION') && validityReason === null
                    return (
                      <li
                        key={item.objectId}
                        className={`flex w-full min-w-0 items-center gap-1 ${!isDraggable && (item.kind === 'FUNCTION_BLOCK' || item.kind === 'FUNCTION') ? 'opacity-60 cursor-not-allowed' : ''}`}
                        draggable={isDraggable}
                        onDragStart={isDraggable ? (event) => {
                          event.dataTransfer.setData(LIBRARY_DRAG_TYPE, `pou:${item.name}`)
                          event.dataTransfer.effectAllowed = 'copy'
                        } : undefined}
                        title={validityReason ?? undefined}
                        onContextMenu={(event) => {
                          if (!canEdit) return
                          event.preventDefault()
                          setMenu({ objectId: item.objectId, x: event.clientX, y: event.clientY })
                        }}
                      >
                      {renamingObjectId === item.objectId ? (
                        <form
                          className="flex min-w-0 flex-1 flex-col gap-1 px-5 py-1"
                          onSubmit={(event) => {
                            event.preventDefault()
                            commitRename()
                          }}
                        >
                          <input
                            ref={renameInputRef}
                            aria-label={pick('Tên POU mới', 'New POU name')}
                            value={renameDraft}
                            onChange={(event) => setRenameDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape') setRenamingObjectId(null)
                            }}
                            className="w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1 text-sm"
                          />
                          {renameError && (
                            <span role="alert" className="text-xs text-[var(--c-fault-fg)]">
                              {pick(...NAME_ERROR_COPY[renameError])}
                            </span>
                          )}
                        </form>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => onSelect(item.objectId)}
                            /* Nhãn tường minh vì ba nút thao tác bên cạnh cũng
                               mang tên POU; không có nó thì "AHU_MAIN" ứng với
                               bốn nút và người dùng bàn phím phải đoán. Nhãn
                               vẫn CHỨA tên đang hiện (WCAG 2.5.3). */
                            aria-label={pick(`Mở ${item.name}`, `Open ${item.name}`)}
                            aria-current={item.objectId === selectedObjectId ? 'true' : undefined}
                            title={validityReason ?? undefined}
                            className={`flex min-h-7 min-w-0 flex-1 items-center gap-1.5 overflow-hidden px-1 text-left text-sm ${
                              item.objectId === selectedObjectId ? 'text-[var(--c-accent)]' : ''
                            }`}
                          >
                            {/* `DEV-PROG-006` — chấm chỉ POU đang mở. Có chữ
                                kèm cho trình đọc màn hình: một chấm màu không
                                nói được gì khi không thấy màu. */}
                            <span aria-hidden="true" className={`w-2 shrink-0 text-center ${item.objectId === selectedObjectId ? 'text-[var(--c-accent)]' : 'text-transparent'}`}>●</span>
                            {item.objectId === selectedObjectId && (
                              <span className="sr-only">{pick('Đang mở: ', 'Open: ')}</span>
                            )}
                            <span className="min-w-0 truncate font-medium">{item.name}</span>
                            <span className="ml-auto shrink-0 text-xs text-[var(--c-text-dim)]">{item.language}</span>
                            {validityReason && (
                              <span data-testid="pou-explorer-error" className="ml-2 truncate text-[10px] text-[var(--c-fault-fg)]" title={validityReason}>
                                {validityReason}
                              </span>
                            )}
                          </button>
                          {canEdit && (
                            <button
                              type="button"
                              aria-haspopup="menu"
                              aria-expanded={menu?.objectId === item.objectId}
                              aria-label={pick(`Thao tác với ${item.name}`, `Actions for ${item.name}`)}
                              className="grid h-7 w-7 shrink-0 place-items-center rounded text-[var(--c-text-dim)] opacity-70 hover:bg-[var(--c-surface-2)] hover:text-[var(--c-accent)] focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
                              onClick={(event) => {
                                const rect = event.currentTarget.getBoundingClientRect()
                                setMenu({ objectId: item.objectId, x: Math.max(8, rect.right - 160), y: rect.bottom + 4 })
                              }}
                            >
                              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                            </button>
                          )}
                        </>
                      )}
                    </li>
                    )
                  })}
                </ul>
              )}
              </div>
            </section>
          )
        })}
      </nav>


      {/* `DEV-PROG-006` — menu ngữ cảnh. `fixed` theo toạ độ con trỏ vì cây nằm
          trong một cột có `overflow-y-auto`: một menu `absolute` trong cột đó
          sẽ bị chính vùng cuộn cắt cụt. */}
      {menu && canEdit && (() => {
        const item = items.find((candidate) => candidate.objectId === menu.objectId)
        if (!item) return null
        return (
          <div
            role="menu"
            aria-label={pick(`Thao tác với ${item.name}`, `Actions for ${item.name}`)}
            data-testid="pou-context-menu"
            style={{ top: menu.y, left: menu.x }}
            className="fixed z-50 min-w-40 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] py-1 shadow-lg"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <MenuItem label={pick('Mở', 'Open')} onClick={() => { onSelect(item.objectId); setMenu(null) }} />
            <MenuItem
              label={pick('Đổi tên', 'Rename')}
              onClick={() => { setRenamingObjectId(item.objectId); setRenameDraft(item.name); setMenu(null) }}
            />
            <MenuItem label={pick('Nhân bản', 'Duplicate')} onClick={() => { duplicate(item); setMenu(null) }} />
            <MenuItem
              label={pick('Sao lưu POU này…', 'Backup this POU…')}
              onClick={() => { openExportModal(item.objectId); setMenu(null) }}
            />
            <MenuItem
              label={pick('Xóa', 'Delete')}
              danger
              onClick={() => { setPendingDeleteObjectId(item.objectId); setMenu(null) }}
            />
            {/* "Đặt làm Active" của đề bài KHÔNG có ở đây, và im lặng bỏ nó đi
                sẽ để người dùng đi tìm. Ý định bật/tắt Program sống ở API
                runtime-intent (PGM-06), không ở Draft — đặt một mục cùng tên tại
                đây sẽ hứa một thao tác mà cây POU không thực hiện được. */}
            <p className="border-t border-[var(--c-border)] px-3 pt-1 text-[10px] text-[var(--c-text-dim)]">
              {pick('Bật/tắt Program ở trang Runtime & Bảo trì.', 'Enable/disable a program in Runtime & Maintenance.')}
            </p>
          </div>
        )
      })()}

      <Modal
        open={canEdit && pendingDelete !== null}
        title={pick('Xóa POU?', 'Delete POU?')}
        danger
        confirmLabel={pick('Xóa', 'Delete')}
        confirmLoading={saving}
        confirmDisabled={deleteBlocked}
        onConfirm={confirmDelete}
        onClose={() => setPendingDeleteObjectId(null)}
      >
        {signalBlockers.length > 0 ? (
          /* Nói ĐÚNG thứ chặn và ĐÚNG việc phải làm. "Không xoá được" mà không
             kèm cách gỡ thì người dùng chỉ còn nước bấm lại lần nữa. */
          <p role="alert">
            {pick(
              `Không xóa được "${pendingDelete?.name ?? ''}": nó đang công bố ${signalBlockers.length} tín hiệu (${signalBlockers.map((item) => item.name).join(', ')}). Xóa tín hiệu đó, hoặc chuyển nó sang POU khác ở tab Điểm & Ánh xạ, rồi quay lại.`,
              `Cannot delete "${pendingDelete?.name ?? ''}": it publishes ${signalBlockers.length} signal(s) (${signalBlockers.map((item) => item.name).join(', ')}). Delete those signals, or move them to another POU in Points & Mapping, then come back.`
            )}
          </p>
        ) : deleteBlockers.length > 0 ? (
          <p role="alert">
            {pick(
              `Không xóa được "${pendingDelete?.name ?? ''}": còn ${deleteBlockers.length} POU đang gọi nó (${deleteBlockers.map((item) => item.name).join(', ')}). Gỡ lời gọi trước.`,
              `Cannot delete "${pendingDelete?.name ?? ''}": ${deleteBlockers.length} POU still call it (${deleteBlockers.map((item) => item.name).join(', ')}). Remove those calls first.`
            )}
          </p>
        ) : (
          <p>
            {pick(
              `Xóa "${pendingDelete?.name ?? ''}" sẽ xóa cả mã nguồn, biến và ánh xạ liên quan. Không thể hoàn tác sau khi lưu.`,
              `Deleting "${pendingDelete?.name ?? ''}" also removes its source code, variables, and mappings. This cannot be undone after saving.`
            )}
          </p>
        )}
      </Modal>

      <Modal
        open={canEdit && creatingPou !== null}
        title={
          creatingPou
            ? creatingPou.kind === 'PROGRAM'
              ? pick('Tạo chương trình mới', 'Create new Program')
              : creatingPou.kind === 'FUNCTION'
                ? pick('Tạo hàm mới', 'Create new Function')
                : pick('Tạo khối hàm mới', 'Create new Function Block')
            : ''
        }
        confirmLabel={pick('Tạo', 'Create')}
        cancelLabel={pick('Hủy', 'Cancel')}
        confirmLoading={saving}
        confirmDisabled={createName.trim() === '' || createError !== null}
        onConfirm={confirmCreate}
        onClose={() => {
          setCreatingPou(null)
          setCreateName('')
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault()
            confirmCreate()
          }}
          className="flex flex-col gap-2"
        >
          <label htmlFor="create-pou-name" className="text-xs font-semibold text-[var(--c-text-dim)]">
            {pick('Tên POU', 'POU name')}
          </label>
          <input
            ref={createInputRef}
            id="create-pou-name"
            data-modal-initial-focus="true"
            autoFocus
            type="text"
            value={createName}
            onChange={(event) => setCreateName(event.target.value)}
            placeholder={pick('Nhập tên POU…', 'Enter POU name…')}
            className="w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-2.5 py-1.5 text-sm text-[var(--c-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
          />
          {createError && createName.trim() !== '' ? (
            <span role="alert" className="text-xs text-[var(--c-fault-fg)]">
              {pick(...NAME_ERROR_COPY[createError])}
            </span>
          ) : (
            <span className="text-xs text-[var(--c-text-dim)]">
              {pick('Bắt buộc nhập tên và không được để trống.', 'Name is required and cannot be empty.')}
            </span>
          )}
        </form>
      </Modal>

      <input
        ref={importFileInputRef}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        id="pou-backup-file-input"
        aria-label={pick('Tệp sao lưu POU để nhập', 'POU backup file to import')}
        onChange={(event) => { void handleImportFileChange(event) }}
      />

      <Modal
        open={exportModalOpen}
        title={pick('Sao lưu chương trình', 'Backup programs')}
        confirmLabel={pick('Tải về tệp sao lưu', 'Download backup file')}
        cancelLabel={pick('Hủy', 'Cancel')}
        confirmDisabled={exportSelectedIds.size === 0 || !exportFileName.trim()}
        onConfirm={handleExportConfirm}
        onClose={() => setExportModalOpen(false)}
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-[var(--c-text-dim)]">
            {pick(
              'Chọn các chương trình và hàm cần lưu về máy tính làm bản sao lưu dữ liệu.',
              'Select programs and functions to save to your device as a data backup.'
            )}
          </p>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="export-backup-name" className="text-xs font-medium text-[var(--c-text-dim)]">
              {pick('Tên bản sao lưu', 'Backup name')}
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id="export-backup-name"
                type="text"
                value={exportFileName}
                onChange={(e) => setExportFileName(e.target.value)}
                placeholder={pick('Nhập tên bản sao lưu…', 'Enter backup name…')}
                className="min-w-0 flex-1 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-2.5 py-1.5 text-xs text-[var(--c-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
              />
              <span className="shrink-0 text-xs font-mono text-[var(--c-text-dim)]">.json</span>
            </div>
          </div>
          <div className="flex items-center justify-between border-b border-[var(--c-border)] pb-2 text-xs font-medium text-[var(--c-text)]">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={items.length > 0 && exportSelectedIds.size === items.length}
                onChange={(e) => {
                  if (e.target.checked) {
                    setExportSelectedIds(new Set(items.map((i) => i.objectId)))
                  } else {
                    setExportSelectedIds(new Set())
                  }
                }}
              />
              <span>
                {pick('Chọn tất cả', 'Select all')} ({exportSelectedIds.size}/{items.length})
              </span>
            </label>
            <span className="text-xs text-[var(--c-text-dim)]">
              {pick('Dung lượng lưu trữ: ', 'Storage size: ')}
              <span className="font-mono font-medium text-[var(--c-text)]">
                {formatBytes(exportBackupSize)}
              </span>
            </span>
          </div>
          <div className="max-h-60 overflow-y-auto rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-1 space-y-1">
            {items.map((item) => {
              const checked = exportSelectedIds.has(item.objectId)
              return (
                <label
                  key={item.objectId}
                  className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-xs hover:bg-[var(--c-surface-2)] cursor-pointer"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = new Set(exportSelectedIds)
                        if (e.target.checked) next.add(item.objectId)
                        else next.delete(item.objectId)
                        setExportSelectedIds(next)
                      }}
                    />
                    <span className="truncate font-medium text-[var(--c-text)]">{item.name}</span>
                  </div>
                  <span className="shrink-0 rounded bg-[var(--c-surface)] px-1.5 py-0.5 text-[10px] text-[var(--c-text-dim)] font-mono">
                    {item.kind} · {item.language}
                  </span>
                </label>
              )
            })}
          </div>
        </div>
      </Modal>

      <Modal
        open={importModalOpen && importBackupData !== null}
        title={pick('Nhập chương trình từ tệp sao lưu', 'Import programs from backup file')}
        confirmLabel={pick('Nhập POU đã chọn', 'Import selected POUs')}
        cancelLabel={pick('Hủy', 'Cancel')}
        confirmLoading={importing || saving}
        confirmDisabled={importSelectedIndices.size === 0 || importing || saving}
        onConfirm={() => { void handleImportConfirm() }}
        onClose={() => {
          if (!importing) {
            setImportModalOpen(false)
            setImportBackupData(null)
          }
        }}
      >
        {importBackupData && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] bg-[var(--c-surface-2)] p-2 text-xs text-[var(--c-text-dim)]">
              <span>
                {pick('Dự án gốc:', 'Source project:')}{' '}
                <strong className="text-[var(--c-text)]">{importBackupData.projectName || '—'}</strong>
              </span>
              <span>
                {pick('Tổng số POU:', 'Total POUs:')}{' '}
                <strong className="text-[var(--c-text)]">{importBackupData.pous.length}</strong>
              </span>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-[var(--c-text-dim)]">
                {pick('Xử lý khi trùng tên:', 'When names collide:')}
              </span>
              <div className="flex flex-wrap gap-2 text-xs">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="import-collision-strategy"
                    value="RENAME"
                    checked={importStrategy === 'RENAME'}
                    onChange={() => setImportStrategy('RENAME')}
                  />
                  <span>{pick('Đổi tên mới', 'Auto-rename')}</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="import-collision-strategy"
                    value="OVERWRITE"
                    checked={importStrategy === 'OVERWRITE'}
                    onChange={() => setImportStrategy('OVERWRITE')}
                  />
                  <span>{pick('Ghi đè', 'Overwrite')}</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="import-collision-strategy"
                    value="SKIP"
                    checked={importStrategy === 'SKIP'}
                    onChange={() => setImportStrategy('SKIP')}
                  />
                  <span>{pick('Bỏ qua', 'Skip')}</span>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-between border-b border-[var(--c-border)] pb-2 text-xs font-medium text-[var(--c-text)]">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={
                    importBackupData.pous.length > 0 &&
                    importSelectedIndices.size === importBackupData.pous.length
                  }
                  onChange={(e) => {
                    if (e.target.checked) {
                      setImportSelectedIndices(new Set(importBackupData.pous.map((_, idx) => idx)))
                    } else {
                      setImportSelectedIndices(new Set())
                    }
                  }}
                />
                <span>
                  {pick('Chọn tất cả', 'Select all')} ({importSelectedIndices.size}/{importBackupData.pous.length})
                </span>
              </label>
            </div>

            <div className="max-h-60 overflow-y-auto rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-1 space-y-1">
              {importBackupData.pous.map((pou, index) => {
                const checked = importSelectedIndices.has(index)
                const collision = items.some((it) => it.name.toLocaleLowerCase() === pou.name.toLocaleLowerCase())
                const collisionBadgeClass = importStrategy === 'OVERWRITE'
                  ? 'bg-[var(--c-warn-bg)] text-[var(--c-warn-fg)]'
                  : importStrategy === 'SKIP'
                    ? 'bg-[var(--c-surface-2)] text-[var(--c-text-dim)]'
                    : 'bg-[var(--c-accent-bg)] text-[var(--c-accent)]'
                return (
                  <label
                    key={index}
                    className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-xs hover:bg-[var(--c-surface-2)] cursor-pointer"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const next = new Set(importSelectedIndices)
                          if (e.target.checked) next.add(index)
                          else next.delete(index)
                          setImportSelectedIndices(next)
                        }}
                      />
                      <span className="truncate font-medium text-[var(--c-text)]">
                        {pou.name}
                        {collision && importStrategy === 'RENAME' && (
                          <span className="text-[var(--c-text-dim)] font-normal ml-1">
                            → {uniquePouName(items, pou.name)}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {collision ? (
                        <span
                          className={'rounded px-1.5 py-0.5 text-[10px] font-medium ' + collisionBadgeClass}
                        >
                          {importStrategy === 'OVERWRITE'
                            ? pick('Ghi đè', 'Overwrite')
                            : importStrategy === 'SKIP'
                              ? pick('Bỏ qua', 'Skip')
                              : pick('Đổi tên', 'Rename')}
                        </span>
                      ) : (
                        <span className="rounded bg-[var(--c-good-bg)] px-1.5 py-0.5 text-[10px] text-[var(--c-good-fg)] font-medium">
                          {pick('Mới', 'New')}
                        </span>
                      )}
                      <span className="rounded bg-[var(--c-surface)] px-1.5 py-0.5 text-[10px] text-[var(--c-text-dim)] font-mono">
                        {pou.kind} · {pou.language}
                      </span>
                    </div>
                  </label>
                )
              })}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={importError !== null}
        title={pick('Lỗi nhập tệp sao lưu', 'Backup file import error')}
        confirmLabel={pick('Đã hiểu', 'Got it')}
        onConfirm={() => setImportError(null)}
        onClose={() => setImportError(null)}
      >
        <p className="text-sm text-[var(--c-fault-fg)]">{importError}</p>
      </Modal>
    </div>
  )
}

/**
 * `DEV-PROG-011` — khay này KHÔNG còn được thanh bên dựng.
 *
 * Năm trường của nó (Tên, Loại, Ngôn ngữ, Chu kỳ, Trạng thái mong muốn) đã về
 * `ContextInspector` ở cột phải, nơi vốn đã là chỗ của thuộc tính. Giữ hai bản
 * ở hai cột là hai chỗ có thể nói khác nhau về cùng một POU — đúng lớp lỗi mà
 * `T59-803` đã phải đi gộp một lần (khi DOM có HAI cây POU).
 *
 * Component còn lại vì `PouItem` là view model dùng chung và một bề mặt khác
 * (ví dụ hộp thoại chọn POU) có thể cần đúng khay này; nó không được mount ở
 * Explorer nữa.
 *
 * Inspector ẩn — chứ không làm xám — những trường không có nghĩa với từng kind.
 * Một FUNCTION không có chu kỳ và không có trạng thái bật; hiện một ô "chu kỳ"
 * bị xám vẫn nói rằng khái niệm đó tồn tại ở đây, và người dùng sẽ đi tìm cách
 * bật nó.
 */
export function PouInspector({ item }: { item: PouItem }) {
  const { pick } = useI18n()
  const isProgram = item.kind === 'PROGRAM'
  return (
    <dl
      aria-label={pick('Thuộc tính POU', 'POU properties')}
      className="flex flex-col gap-1 border-t border-[var(--c-border)] pt-2 text-sm"
    >
      <Field label={pick('Tên', 'Name')} value={item.name} />
      <Field label={pick('Loại', 'Kind')} value={item.kind} />
      <Field label={pick('Ngôn ngữ', 'Language')} value={item.language} />
      {isProgram && item.periodMs !== undefined && (
        <Field label={pick('Chu kỳ', 'Period')} value={formatProgrammingPeriod(item.periodMs)} />
      )}
      {isProgram && (
        <Field
          label={pick('Trạng thái mong muốn', 'Desired state')}
          value={
            item.scheduled
              ? pick('Tắt (mặc định cho Program mới)', 'Disabled (default for new programs)')
              : pick('Chưa xếp lịch chạy', 'Not scheduled to run')
          }
        />
      )}
      {!isProgram && (
        <p className="text-[var(--c-text-dim)]">
          {pick(
            'POU dùng chung không có chu kỳ hay trạng thái bật — nó chỉ chạy khi được Program gọi.',
            'Shared POUs have no period or enable state — they run only when a program calls them.'
          )}
        </p>
      )}
    </dl>
  )
}

function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--c-surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)] ${
        danger ? 'text-[var(--c-fault-fg)]' : 'text-[var(--c-text)]'
      }`}
    >
      {label}
    </button>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[var(--c-text-dim)]">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{value}</dd>
    </div>
  )
}
