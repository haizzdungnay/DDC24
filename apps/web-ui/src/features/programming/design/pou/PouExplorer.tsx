import { useEffect, useMemo, useRef, useState } from 'react'
import { Boxes, Copy, FileCode2, FilePlus, FunctionSquare, Pencil, Trash2 } from 'lucide-react'
import { Modal } from '../../../../shared/components/Modal'
import { createUuid } from '../../../../shared/crypto'
import { useI18n } from '../../../../shared/i18n'
import type { ProgrammingDraftDocument, ProgrammingDraftOperation } from '../../model/types'
import {
  createPouOperations,
  deletePouOperations,
  duplicatePouOperations,
  pouDeleteBlockers,
  pouPublishedSignalBlockers,
  renamePouOperations,
  validatePouName
} from './pouCommands'
import { filterPouItems, groupPouItems, pouItems, resolvePouSelection, type PouItem, type PouKind, type PouLanguage } from './pouViewModel'

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
  FUNCTION: { label: ['Functions', 'Functions'], icon: FunctionSquare },
  FUNCTION_BLOCK: { label: ['Function Blocks', 'Function Blocks'], icon: Boxes }
}

const NAME_ERROR_COPY: Record<'EMPTY' | 'PATTERN' | 'DUPLICATE', [string, string]> = {
  EMPTY: ['Tên POU không được để trống.', 'The POU name cannot be empty.'],
  PATTERN: [
    'Tên POU chỉ nhận chữ, số và gạch dưới, và không bắt đầu bằng số.',
    'A POU name accepts letters, digits, and underscores, and cannot start with a digit.'
  ],
  DUPLICATE: ['Tên POU đã tồn tại trong Project.', 'That POU name already exists in this project.']
}

export function PouExplorer({
  document,
  publishedSignals,
  canEdit,
  saving,
  selectedObjectId,
  onSelect,
  onSave
}: {
  document: ProgrammingDraftDocument
  /**
   * Tín hiệu công bố của Draft. Đọc từ draft THÔ ở trang cha: `signals[]` không
   * đi qua `toWorkspaceDocument`, nên Explorer không tự lấy được.
   */
  publishedSignals?: readonly { signalId: string; name: string; publisherProgramId: string }[]
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
  const renameInputRef = useRef<HTMLInputElement | null>(null)

  const items = useMemo(() => pouItems(document), [document])
  /* Lọc CHỈ đổi thứ được vẽ, không đổi POU đang chọn: gõ vào ô tìm kiếm mà
   * editor bị đổi tệp là mất nội dung đang soạn. */
  const visible = useMemo(() => filterPouItems(items, query), [items, query])
  const groups = useMemo(() => groupPouItems(visible), [visible])
  const selected = resolvePouSelection(items, selectedObjectId)
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
    if (!canEdit) {
      setRenamingObjectId(null)
      setPendingDeleteObjectId(null)
    }
  }, [canEdit])

  const renameError = renamingObjectId ? validatePouName(items, renameDraft, renamingObjectId) : null

  function create(kind: PouKind, language: PouLanguage) {
    const result = createPouOperations(items, { kind, language, objectId: createUuid(), task: document.task })
    void onSave(result.operations).then((ok) => {
      if (ok) onSelect(result.objectId)
    })
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
    void onSave(deletePouOperations(document, pendingDelete)).then((ok) => {
      setPendingDeleteObjectId(null)
      if (!ok) return
      if (selectedObjectId === pendingDelete.objectId) {
        onSelect(items.find((item) => item.objectId !== pendingDelete.objectId)?.objectId)
      }
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <label className="sr-only" htmlFor="pou-explorer-search">
          {pick('Tìm POU', 'Find a POU')}
        </label>
        <input
          id="pou-explorer-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={pick('Tìm POU…', 'Find a POU…')}
          className="min-w-0 flex-1 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1 text-sm text-[var(--c-text)]"
        />
        {canEdit && (
          <span className="flex shrink-0 gap-1">
            {/* Giữ NGUYÊN nhãn của hai nút cũ: chúng là hợp đồng của test bàn
                phím và E2E, và đổi nhãn chỉ vì nút đổi chỗ là làm hỏng bằng
                chứng mà không đổi hành vi. */}
            <button
              type="button"
              className="rounded p-1 text-[var(--c-text-dim)] hover:text-[var(--c-accent)]"
              title={pick('Thêm chương trình FBD', 'Add FBD program')}
              onClick={() => create('PROGRAM', 'FBD')}
            >
              <FilePlus className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">{pick('Thêm chương trình FBD', 'Add FBD program')}</span>
            </button>
            <button
              type="button"
              className="rounded p-1 text-xs font-semibold text-[var(--c-text-dim)] hover:text-[var(--c-accent)]"
              title={pick('Thêm chương trình ST', 'Add ST program')}
              onClick={() => create('PROGRAM', 'ST')}
            >
              ST+
            </button>
            <button
              type="button"
              className="rounded p-1 text-xs font-semibold text-[var(--c-text-dim)] hover:text-[var(--c-accent)]"
              title={pick('Thêm FUNCTION', 'Add FUNCTION')}
              onClick={() => create('FUNCTION', 'ST')}
            >
              FN+
            </button>
            <button
              type="button"
              className="rounded p-1 text-xs font-semibold text-[var(--c-text-dim)] hover:text-[var(--c-accent)]"
              title={pick('Thêm FUNCTION_BLOCK', 'Add FUNCTION_BLOCK')}
              onClick={() => create('FUNCTION_BLOCK', 'ST')}
            >
              FB+
            </button>
          </span>
        )}
      </div>

      {items.length === 0 && (
        <p className="px-1 text-sm text-[var(--c-text-dim)]">
          {canEdit
            ? pick('Chưa có chương trình. Bấm + để tạo.', 'No programs yet. Click + to create one.')
            : pick('Chưa có chương trình.', 'No programs yet.')}
        </p>
      )}

      <nav aria-label={pick('Cây POU', 'POU tree')} className="flex flex-col gap-2">
        {groups.map(({ kind, items: group }) => {
          const { label, icon: Icon } = GROUP_META[kind]
          return (
            <section key={kind}>
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase text-[var(--c-text-dim)]">
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {pick(...label)} ({group.length})
              </h3>
              {group.length === 0 ? (
                <p className="px-5 py-1 text-sm text-[var(--c-text-dim)]">
                  {query.trim() === '' ? pick('Chưa có', 'None yet') : pick('Không khớp', 'No match')}
                </p>
              ) : (
                <ul aria-label={pick(...label)} className="flex flex-col">
                  {group.map((item) => (
                    <li key={item.objectId} className="flex items-center gap-1">
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
                            className={`min-w-0 flex-1 truncate px-5 py-1 text-left text-sm ${
                              item.objectId === selectedObjectId ? 'text-[var(--c-accent)]' : ''
                            }`}
                          >
                            {item.name}
                            <span className="ml-2 text-xs text-[var(--c-text-dim)]">{item.language}</span>
                          </button>
                          {canEdit && (
                            <>
                              <button
                                type="button"
                                className="shrink-0 rounded p-1 text-[var(--c-text-dim)] hover:text-[var(--c-accent)]"
                                title={pick(`Đổi tên ${item.name}`, `Rename ${item.name}`)}
                                onClick={() => {
                                  setRenamingObjectId(item.objectId)
                                  setRenameDraft(item.name)
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className="shrink-0 rounded p-1 text-[var(--c-text-dim)] hover:text-[var(--c-accent)]"
                                title={pick(`Nhân bản ${item.name}`, `Duplicate ${item.name}`)}
                                onClick={() => duplicate(item)}
                              >
                                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className="shrink-0 rounded p-1 text-[var(--c-text-dim)] hover:text-[var(--c-fault-fg)]"
                                title={pick(`Xóa ${item.name}`, `Delete ${item.name}`)}
                                onClick={() => setPendingDeleteObjectId(item.objectId)}
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            </>
                          )}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </nav>

      {selected && <PouInspector item={selected} />}

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
    </div>
  )
}

/**
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
        <Field label={pick('Chu kỳ', 'Period')} value={`${item.periodMs} ms`} />
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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[var(--c-text-dim)]">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{value}</dd>
    </div>
  )
}
