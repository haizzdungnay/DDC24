import { useMemo, useState } from 'react'
import { AlertTriangle, Library, Trash2 } from 'lucide-react'
import { Panel } from '../../../shared/components/Panel'
import { StateBlock } from '../../../shared/components/StateBlock'
import { useI18n } from '../../../shared/i18n'
import { useAuth, roleAtLeast } from '../../auth'
import { createUuid } from '../../../shared/crypto'
import { useProgrammingLibrary, useProgrammingProjects, type LibrarySearchFilters } from '../api/queries'
import { useProgrammingLibraryEntryMutations, type LibraryEntryDraft } from '../api/mutations'
import { PROGRAMMING_REVIEW_GATED_FEATURES } from '../api/generated/profile'
import type { ProgrammingLibraryEntry } from '../model/types'

/**
 * PGM-04 — Control Library (DDD-SW-PROG-UNIFIED-001 §8, UX §11).
 *
 * Trang này CHỈ hiển thị trạng thái review-gate; nó không có checkbox nào để
 * "duyệt" một feature. Token phê duyệt Controls/Safety suy ra từ contract profile
 * và chỉ generator dựng được (T59-205) — một ô tick ở đây sẽ là đúng thứ DDD §9
 * cấm.
 */
const REVIEW_GATED = new Set<string>(
  PROGRAMMING_REVIEW_GATED_FEATURES.filter((item) => !item.approved).map((item) => item.featureId)
)

type ScopeFilter = '' | 'SYSTEM' | 'PROJECT'
type KindFilter = '' | 'FUNCTION' | 'FUNCTION_BLOCK' | 'CONVERSION'

export function LibraryPage() {
  const { pick } = useI18n()
  const { session } = useAuth()
  const canAdmin = roleAtLeast(session?.role, 'admin')
  const projects = useProgrammingProjects()
  const project = projects.data?.items[0]

  const [scope, setScope] = useState<ScopeFilter>('')
  const [kind, setKind] = useState<KindFilter>('')
  const [query, setQuery] = useState('')
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [etag, setEtag] = useState<string | null>(null)

  const filters = useMemo<LibrarySearchFilters>(
    () => ({
      projectId: project?.projectId,
      scope: scope === '' ? undefined : scope,
      kind: kind === '' ? undefined : kind,
      query: query.trim() === '' ? undefined : query.trim()
    }),
    [project?.projectId, scope, kind, query]
  )
  const library = useProgrammingLibrary(filters)
  const currentEtag = etag ?? project?.etag ?? ''
  const { saveEntry, deleteEntry, pending, error } = useProgrammingLibraryEntryMutations(project?.projectId)

  const entries = library.data?.items ?? []
  const selected = entries.find((item) => item.entryId === selectedEntryId) ?? null

  async function handleCreate(draft: LibraryEntryDraft) {
    const next = await saveEntry(currentEtag, draft)
    if (next) {
      setEtag(next)
      library.refresh()
      projects.refresh()
    }
  }

  async function handleDelete(entryId: string) {
    const next = await deleteEntry(currentEtag, entryId)
    if (next) {
      setEtag(next)
      setSelectedEntryId(null)
      library.refresh()
      projects.refresh()
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title={pick('Thư viện điều khiển', 'Control Library')}
        subtitle={pick(
          'Khối SYSTEM là registry chỉ đọc; khối PROJECT do bạn định nghĩa và đóng băng cùng Revision.',
          'SYSTEM blocks come from the read-only registry; PROJECT blocks are yours and freeze with the revision.'
        )}
      >
        <LibraryFilters
          scope={scope}
          kind={kind}
          query={query}
          onScope={setScope}
          onKind={setKind}
          onQuery={setQuery}
        />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title={pick('Danh sách khối', 'Blocks')}>
          <LibraryList
            state={library.status}
            entries={entries}
            errorMessage={library.error}
            onRetry={library.refresh}
            selectedEntryId={selectedEntryId}
            onSelect={setSelectedEntryId}
          />
        </Panel>
        <div className="flex flex-col gap-4">
          <Panel title={pick('Chi tiết', 'Details')}>
            <LibraryDetail entry={selected} canAdmin={canAdmin} pending={pending} onDelete={handleDelete} />
          </Panel>
          <Panel title={pick('Tạo khối PROJECT', 'New PROJECT block')}>
            {canAdmin ? (
              <LibraryEntryForm disabled={pending || !project} onSubmit={handleCreate} />
            ) : (
              <p className="text-sm text-[var(--c-text-dim)]">
                {pick(
                  'Chỉ tài khoản quản trị mới sửa được Thư viện điều khiển.',
                  'Only administrators can modify the Control Library.'
                )}
              </p>
            )}
            {error && (
              <p role="alert" className="mt-2 text-sm text-[var(--c-danger)]">
                {error}
              </p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}

function LibraryFilters({
  scope,
  kind,
  query,
  onScope,
  onKind,
  onQuery
}: {
  scope: ScopeFilter
  kind: KindFilter
  query: string
  onScope: (value: ScopeFilter) => void
  onKind: (value: KindFilter) => void
  onQuery: (value: string) => void
}) {
  const { pick } = useI18n()
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end">
      <label className="flex flex-1 flex-col gap-1 text-sm">
        <span className="text-[var(--c-text-dim)]">{pick('Tìm theo tên', 'Search by name')}</span>
        <input
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          className="rounded border border-[var(--c-border)] bg-transparent px-2 py-1.5"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[var(--c-text-dim)]">{pick('Phạm vi', 'Scope')}</span>
        <select
          value={scope}
          onChange={(event) => onScope(event.target.value as ScopeFilter)}
          className="rounded border border-[var(--c-border)] bg-transparent px-2 py-1.5"
        >
          <option value="">{pick('Tất cả', 'All')}</option>
          <option value="SYSTEM">SYSTEM</option>
          <option value="PROJECT">PROJECT</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[var(--c-text-dim)]">{pick('Loại', 'Kind')}</span>
        <select
          value={kind}
          onChange={(event) => onKind(event.target.value as KindFilter)}
          className="rounded border border-[var(--c-border)] bg-transparent px-2 py-1.5"
        >
          <option value="">{pick('Tất cả', 'All')}</option>
          <option value="FUNCTION">FUNCTION</option>
          <option value="FUNCTION_BLOCK">FUNCTION_BLOCK</option>
          <option value="CONVERSION">CONVERSION</option>
        </select>
      </label>
    </div>
  )
}

function LibraryList({
  state,
  entries,
  errorMessage,
  onRetry,
  selectedEntryId,
  onSelect
}: {
  state: 'loading' | 'ready' | 'error'
  entries: ProgrammingLibraryEntry[]
  errorMessage: string | null
  onRetry: () => void
  selectedEntryId: string | null
  onSelect: (entryId: string) => void
}) {
  const { pick } = useI18n()
  if (state === 'loading') {
    return <StateBlock state="loading" title={pick('Đang tải…', 'Loading…')} />
  }
  if (state === 'error') {
    return (
      <StateBlock
        state="error"
        title={pick('Không tải được Thư viện điều khiển.', 'Could not load the Control Library.')}
        detail={errorMessage ?? undefined}
        onRetry={onRetry}
      />
    )
  }
  if (entries.length === 0) {
    return (
      <StateBlock
        state="empty"
        title={pick('Không có khối nào khớp bộ lọc.', 'No blocks match the filters.')}
      />
    )
  }
  return (
    <ul className="flex flex-col divide-y divide-[var(--c-border)]" aria-label={pick('Danh sách khối Thư viện điều khiển', 'Control Library blocks')}>
      {entries.map((entry) => (
        <li key={entry.libraryRevisionId + '/' + entry.entryId}>
          <button
            type="button"
            onClick={() => onSelect(entry.entryId)}
            aria-current={entry.entryId === selectedEntryId ? 'true' : undefined}
            className={`flex w-full items-center justify-between gap-2 px-1 py-2 text-left text-sm ${
              entry.entryId === selectedEntryId ? 'text-[var(--c-accent)]' : ''
            }`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <Library className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate font-medium">{entry.name}</span>
              <span className="shrink-0 rounded bg-[var(--c-surface-2)] px-1.5 py-0.5 text-xs text-[var(--c-text-dim)]">
                {entry.scope}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2 text-xs text-[var(--c-text-dim)]">
              {entry.kind}
              {REVIEW_GATED.has(entry.name) && <ReviewGateBadge />}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/**
 * Nhãn cảnh báo, KHÔNG phải nút duyệt. Check chặn Commission với feature này cho
 * tới khi profile mang approval token Controls/Safety (DDD §9, T59-205).
 */
function ReviewGateBadge() {
  const { pick } = useI18n()
  return (
    <span className="flex items-center gap-1 rounded bg-[var(--c-warn-bg,transparent)] px-1.5 py-0.5 text-[var(--c-warn)]">
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
      {pick('Chờ review Controls/Safety', 'Awaiting Controls/Safety review')}
    </span>
  )
}

function LibraryDetail({
  entry,
  canAdmin,
  pending,
  onDelete
}: {
  entry: ProgrammingLibraryEntry | null
  canAdmin: boolean
  pending: boolean
  onDelete: (entryId: string) => void
}) {
  const { pick } = useI18n()
  if (!entry) {
    return <p className="text-sm text-[var(--c-text-dim)]">{pick('Chọn một khối để xem chi tiết.', 'Select a block to see its details.')}</p>
  }
  return (
    <dl className="flex flex-col gap-2 text-sm">
      <Row label={pick('Tên', 'Name')} value={entry.name} />
      <Row label={pick('Loại', 'Kind')} value={entry.kind} />
      <Row label={pick('Phạm vi', 'Scope')} value={entry.scope} />
      <Row label={pick('Phiên bản thư viện', 'Library version')} value={`${entry.libraryVersion} · ${entry.libraryState}`} />
      <Row label={pick('Hash nội dung', 'Content hash')} value={entry.contentSha256.slice(0, 16) + '…'} />
      <Row
        label={pick('Kích thước state', 'State size')}
        value={
          entry.stateLayoutKnown
            ? `${entry.stateSizeBytes} B`
            : pick('Chưa biết — chờ biên dịch', 'Unknown — pending compile')
        }
      />
      <Row
        label={pick('Phụ thuộc', 'Dependencies')}
        value={
          entry.dependencies.length === 0
            ? pick('Không có', 'None')
            : entry.dependencies.map((item) => `${item.entryId.slice(0, 8)}@${item.version}`).join(', ')
        }
      />
      {REVIEW_GATED.has(entry.name) && (
        <p role="note" className="text-[var(--c-warn)]">
          {pick(
            'Khối này chưa qua review Controls/Safety nên Kiểm tra sẽ từ chối mọi Program dùng nó.',
            'This block has not passed Controls/Safety review, so Check rejects any program that uses it.'
          )}
        </p>
      )}
      {entry.scope === 'PROJECT' && canAdmin && entry.libraryState === 'DRAFT' && (
        <button
          type="button"
          disabled={pending}
          onClick={() => onDelete(entry.entryId)}
          className="mt-1 flex items-center gap-1.5 self-start rounded border border-[var(--c-border)] px-2 py-1 text-sm"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          {pick('Xoá khối', 'Delete block')}
        </button>
      )}
      {entry.scope === 'SYSTEM' && (
        <p className="text-[var(--c-text-dim)]">
          {pick('Khối SYSTEM là registry chỉ đọc, không sửa được.', 'SYSTEM blocks come from the read-only registry.')}
        </p>
      )}
    </dl>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[var(--c-text-dim)]">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{value}</dd>
    </div>
  )
}

function LibraryEntryForm({ disabled, onSubmit }: { disabled: boolean; onSubmit: (draft: LibraryEntryDraft) => void }) {
  const { pick } = useI18n()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'FUNCTION' | 'FUNCTION_BLOCK'>('FUNCTION')
  const [source, setSource] = useState('')

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit({
          entryId: createUuid(),
          kind,
          name: name.trim(),
          language: 'ST',
          source,
          interface: { inputs: [] }
        })
        setName('')
        setSource('')
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[var(--c-text-dim)]">{pick('Tên khối', 'Block name')}</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={64}
          pattern="[A-Za-z][A-Za-z0-9_]*"
          className="rounded border border-[var(--c-border)] bg-transparent px-2 py-1.5"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[var(--c-text-dim)]">{pick('Loại', 'Kind')}</span>
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value as 'FUNCTION' | 'FUNCTION_BLOCK')}
          className="rounded border border-[var(--c-border)] bg-transparent px-2 py-1.5"
        >
          <option value="FUNCTION">FUNCTION</option>
          <option value="FUNCTION_BLOCK">FUNCTION_BLOCK</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[var(--c-text-dim)]">{pick('Mã nguồn ST', 'ST source')}</span>
        <textarea
          value={source}
          onChange={(event) => setSource(event.target.value)}
          required
          rows={5}
          className="rounded border border-[var(--c-border)] bg-transparent px-2 py-1.5 font-mono text-xs"
        />
      </label>
      <button
        type="submit"
        disabled={disabled}
        className="self-start rounded bg-[var(--c-accent)] px-3 py-1.5 text-sm font-medium text-[var(--c-on-accent,#fff)] disabled:opacity-50"
      >
        {pick('Lưu vào bản nháp thư viện', 'Save to library draft')}
      </button>
    </form>
  )
}
