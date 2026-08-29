import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AlertTriangle, ArchiveX, History, Library, Lock, Pencil, Plus, Save, Trash2 } from 'lucide-react'
import { Panel } from '../../../shared/components/Panel'
import { StateBlock } from '../../../shared/components/StateBlock'
import { Button } from '../../../shared/components/Button'
import { Modal } from '../../../shared/components/Modal'
import { useI18n } from '../../../shared/i18n'
import { useAuth } from '../../auth'
import { roleCan } from '../../../shared/auth/capabilities'
import { createUuid } from '../../../shared/crypto'
import { PROGRAMMING_LIBRARY_CATEGORY_ORDER } from '../api/generated/library_registry'
import { categoryLabel, metadataValue, scopeLabel, usageDisplay } from './libraryPresentation'
import {
  libraryFiltersKey,
  libraryViewState,
  rememberLibraryRead,
  type LibraryReadInput,
  type LibraryViewAction,
  type LibraryViewMemory,
  type LibraryViewStatus,
} from './libraryViewState'
import {
  useProgrammingLibraryPaged,
  useProgrammingLibraryUsage,
  useProgrammingProjects,
  type LibrarySearchFilters,
} from '../api/queries'
import { useProgrammingLibraryEntryMutations, type LibraryEntryDraft } from '../api/mutations'
import { useDraftWorkspace } from '../design/useDraftWorkspace'
import { PROGRAMMING_REVIEW_GATED_FEATURES } from '../api/generated/profile'
import {
  groupLibraryEntries,
  libraryDependents,
  libraryEntryPermissions,
  libraryRevisionDeprecationBlock,
  libraryUsagesByEntryId,
  type LibraryEntryGroup,
  type LibraryMutationBlock,
  type LibraryUsage
} from '../model/library'
import { draftLibraryLock } from '../model/signals'
import type { ProgrammingLibraryEntry, ProgrammingLibraryUsage } from '../model/types'

/**
 * PGM-04 — Control Library (DDD-SW-PROG-UNIFIED-001 §8, UX §3.4/§11).
 *
 * Trang này CHỈ hiển thị trạng thái review-gate; nó không có checkbox nào để
 * "duyệt" một feature. Token phê duyệt Controls/Safety suy ra từ contract profile
 * và chỉ generator dựng được (T59-205) — một ô tick ở đây sẽ là đúng thứ DDD §9
 * cấm.
 *
 * T59-203 (`F-P59-UI-001`) bổ sung phần authoring còn thiếu và sửa hai lỗi thật
 * của bản trước:
 *
 * 1. **Chọn nhầm version.** `GET /libraries` trả MỌI version của một entry
 *    (`store/library.go: SearchLibraryEntries` không lọc `state`), nên
 *    `entries.find(entryId)` lấy một version tuỳ ý — chi tiết hiển thị có thể
 *    thuộc bản đã DEPRECATED trong khi nút xoá lại tác động lên bản DRAFT. Nay
 *    danh sách gom theo entry và version history hiện tường minh.
 * 2. **`projectId` lấy từ `items[0]`** thay vì từ route, nên deep-link tới
 *    Project khác trong tương lai sẽ mở nhầm thư viện. Nay đọc route trước.
 *
 * Ghi entry luôn rơi vào DRAFT library đang mở (server tự mở bản minor kế tiếp
 * nếu cần), còn publish xảy ra khi niêm phong Revision ở PGM-05. Chỉ chuyển
 * tiếp một chiều PUBLISHED -> DEPRECATED có endpoint riêng; trang tuyệt đối
 * không dựng một hành động Publish độc lập.
 */
const REVIEW_GATED = new Set<string>(
  PROGRAMMING_REVIEW_GATED_FEATURES.filter((item) => !item.approved).map((item) => item.featureId)
)

type ScopeFilter = '' | 'SYSTEM' | 'PROJECT'
type KindFilter = '' | 'FUNCTION' | 'FUNCTION_BLOCK' | 'CONVERSION'

/** Cùng biểu thức mà store ép (`libraryIECNamePattern`) — không chặt hơn, không
 *  lỏng hơn: chặt hơn thì chặn tên server nhận, lỏng hơn thì đẩy lỗi xuống 400. */
const LIBRARY_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
const LIBRARY_SOURCE_MAX_BYTES = 65536

type EditorMode = { kind: 'create' } | { kind: 'edit'; entry: ProgrammingLibraryEntry; savesNewVersion: boolean }

interface ReadBack {
  entryId: string
  action: 'save' | 'delete' | 'deprecate'
  state: 'reading' | 'done'
  libraryRevisionId?: string
  libraryVersion?: string
}

export function LibraryPage() {
  const { pick } = useI18n()
  const { session } = useAuth()
  /* `WEB-RBAC-001` — ghi PROJECT Library đòi `program.edit`, không đòi vai
     `admin`. Trước lát này `engineer` bị giao diện chặn trên một thao tác mà
     máy chủ chấp nhận. */
  const canEdit = roleCan(session?.role, 'program.edit')
  const routeParams = useParams<{ projectId: string }>()
  const projects = useProgrammingProjects()
  // Route là nguồn sự thật; danh sách chỉ là đường lùi cho lối vào cũ không
  // mang `projectId` (Rev A chỉ có một Project/controller).
  const projectId = routeParams.projectId ?? projects.data?.items[0]?.projectId
  const projectSummary = projects.data?.items.find((item) => item.projectId === projectId) ?? projects.data?.items[0]
  const workspace = useDraftWorkspace(projectId)

  const [scope, setScope] = useState<ScopeFilter>('')
  const [kind, setKind] = useState<KindFilter>('')
  /* `T61-204` — lọc theo phân loại nghiệp vụ. Nguồn giá trị là
     `categoryOrder` của registry, không phải một danh sách viết tay ở FE:
     thêm một nhóm vào registry mà FE không biết sẽ tạo ra một bộ lọc bỏ sót
     khối, và người dùng không có cách nào nhận ra. */
  const [category, setCategory] = useState('')
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [etag, setEtag] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorMode | null>(null)
  const [deprecationCandidate, setDeprecationCandidate] = useState<ProgrammingLibraryEntry | null>(null)
  const [blocked, setBlocked] = useState<LibraryMutationBlock | null>(null)
  const [readBack, setReadBack] = useState<ReadBack | null>(null)

  const filters = useMemo<LibrarySearchFilters>(
    () => ({
      projectId,
      scope: scope === '' ? undefined : scope,
      ...(category ? { category } : {}),
      kind: kind === '' ? undefined : kind,
      query: query.trim() === '' ? undefined : query.trim()
    }),
    [projectId, scope, kind, category, query]
  )
  const library = useProgrammingLibraryPaged(filters)
  const currentEtag = etag ?? workspace.project?.etag ?? projectSummary?.etag ?? ''
  const { saveEntry, deleteEntry, deprecateRevision, pending, error, conflict, reset } =
    useProgrammingLibraryEntryMutations(projectId)

  const entries = library.items
  /* `T61-206` — MỘT trạng thái cho cả màn hình, thay vì mỗi nhánh render tự
     suy ra từ `status`/`items`/`error`. Chỗ nguy hiểm mà mô-đun này đóng lại:
     danh sách rỗng vì LỖI và danh sách rỗng vì THƯ VIỆN TRỐNG trông giống hệt
     nhau nếu mỗi nơi tự suy. */
  const filterInput = useMemo(
    () => ({ scope: scope === '' ? undefined : scope, kind: kind === '' ? undefined : kind,
             category: category || undefined, query: query.trim() || undefined }),
    [scope, kind, category, query],
  )
  const filtersKey = libraryFiltersKey(filterInput)
  const [readMemory, setReadMemory] = useState<LibraryViewMemory | null>(null)
  const readInput = useMemo<LibraryReadInput>(() => ({
    status: library.status, items: library.items, error: library.error,
    hasMore: library.hasMore, loadingMore: library.loadingMore, loadMoreError: library.loadMoreError,
  }), [library.status, library.items, library.error, library.hasMore, library.loadingMore, library.loadMoreError])
  useEffect(() => {
    setReadMemory((current) => rememberLibraryRead(current, readInput, filtersKey))
  }, [readInput, filtersKey])
  const view = libraryViewState({
    list: readInput,
    filters: filterInput,
    retained: readMemory,
    canEdit,
    hasProject: Boolean(projectId),
  })
  const groups = useMemo(() => groupLibraryEntries(entries), [entries])
  const selected = groups.find((group) => group.key === selectedKey) ?? null
  /* `T61-105` — Used-In của gói ĐÃ NIÊM PHONG, đọc từ server. Chỉ gọi khi có
     entry đang chọn: gọi với chuỗi rỗng sẽ nhận 400, và một lỗi 400 hiện lên
     màn hình vì FE gọi sớm là lỗi FE mặc áo lỗi server. */
  const sealedUsage = useProgrammingLibraryUsage(
    selected?.current.libraryRevisionId ?? null,
    selected?.entryId ?? null,
    selected?.scope ?? null,
  )
  const usages = useMemo(() => libraryUsagesByEntryId(workspace.project?.draft), [workspace.project?.draft])
  const dependents = useMemo(() => (selected ? libraryDependents(selected, entries) : []), [selected, entries])
  const permissions = selected
    ? libraryEntryPermissions(selected, { canEdit, hasProject: Boolean(projectId), dependents })
    : null
  const lock = workspace.project?.draft ? draftLibraryLock(workspace.project.draft) : null

  /* Read-back thật: chỉ báo "đã lưu" SAU khi danh sách được đọc lại từ server.
   * Bám vào identity của `library.data` (mỗi lần fetch xong là một object mới)
   * nên không có đường nào hiện giá trị lạc quan rồi thôi. */
  /* `T61-202` — read-back bám vào identity của MẢNG items (mỗi lần fetch xong
     là một mảng mới) thay vì của object page, vì hook phân trang ghép nhiều
     trang vào cùng một state. */
  const libraryData = library.items
  const readBackRef = useRef<ReadBack | null>(null)
  readBackRef.current = readBack
  useEffect(() => {
    if (!libraryData) return
    const current = readBackRef.current
    if (!current || current.state !== 'reading') return
    setReadBack({ ...current, state: 'done' })
  }, [libraryData])

  const afterMutation = useCallback(
    (nextEtag: string, entryId: string, action: ReadBack['action'], revision?: ProgrammingLibraryEntry) => {
      setEtag(nextEtag)
      setReadBack({
        entryId,
        action,
        state: 'reading',
        ...(revision
          ? { libraryRevisionId: revision.libraryRevisionId, libraryVersion: revision.libraryVersion }
          : {})
      })
      library.refresh()
      projects.refresh()
      workspace.reload()
    },
    [library, projects, workspace]
  )

  async function handleSave(draft: LibraryEntryDraft) {
    // Hàng rào thật, không phải mẹo ẩn nút: kể cả khi một nút bị bỏ sót
    // `disabled`, đường ghi vẫn dừng ở đây và nói rõ lý do.
    if (!canEdit) {
      setBlocked('NEEDS_PERMISSION')
      return
    }
    if (!projectId) {
      setBlocked('NO_PROJECT')
      return
    }
    if (editor?.kind === 'edit' && editor.entry.scope === 'SYSTEM') {
      setBlocked('SYSTEM_IMMUTABLE')
      return
    }
    setBlocked(null)
    const result = await saveEntry(currentEtag, draft)
    if (!result) return
    afterMutation(result.etag, draft.entryId, 'save')
    setSelectedKey(`PROJECT/${draft.entryId}`)
    setEditor(null)
  }

  async function handleDelete(group: LibraryEntryGroup) {
    const permission = libraryEntryPermissions(group, {
      canEdit,
      hasProject: Boolean(projectId),
      dependents: libraryDependents(group, entries)
    })
    if (!permission.canDelete) {
      setBlocked(permission.deleteBlock)
      return
    }
    setBlocked(null)
    const result = await deleteEntry(currentEtag, group.entryId)
    if (!result) return
    afterMutation(result.etag, group.entryId, 'delete')
    setSelectedKey(null)
    setEditor(null)
  }

  async function handleDeprecate(revision: ProgrammingLibraryEntry) {
    const block = libraryRevisionDeprecationBlock(revision, {
      canEdit,
      hasProject: Boolean(projectId)
    })
    if (block) {
      setBlocked(block)
      setDeprecationCandidate(null)
      return
    }
    setBlocked(null)
    const result = await deprecateRevision(currentEtag, revision.libraryRevisionId)
    if (!result) return
    afterMutation(result.etag, revision.entryId, 'deprecate', {
      ...revision,
      libraryVersion: result.libraryVersion,
      libraryState: result.libraryState
    })
    setDeprecationCandidate(null)
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
          category={category}
          query={query}
          onScope={setScope}
          onKind={setKind}
          onCategory={setCategory}
          onQuery={setQuery}
        />
        <LibraryVersionLock lock={lock} status={workspace.status} />
      </Panel>

      {conflict && (
        <div role="alert" className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-3 text-sm">
          <p className="font-semibold text-[var(--c-warn-fg)]">{pick('Bản nháp đã thay đổi ở phiên khác.', 'The draft changed in another session.')}</p>
          <p className="mt-1 text-[var(--c-text)]">{conflict}</p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                reset()
                setEtag(null)
                workspace.reload()
                library.refresh()
                projects.refresh()
              }}
            >
              {pick('Tải lại thư viện', 'Reload the library')}
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-[var(--radius)] border border-[var(--c-fault)] bg-[var(--c-fault-bg)] p-3 text-sm text-[var(--c-fault-fg)]">
          {error}
        </p>
      )}
      {blocked && <MutationBlockNotice block={blocked} />}
      {readBack && <ReadBackNotice readBack={readBack} entries={entries} />}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel
          className="min-w-0"
          title={pick('Danh sách khối', 'Blocks')}
          action={
            canEdit ? (
              <Button
                size="sm"
                icon={<Plus className="h-4 w-4" aria-hidden="true" />}
                disabled={!projectId}
                onClick={() => {
                  setBlocked(null)
                  setEditor({ kind: 'create' })
                }}
              >
                {pick('Khối PROJECT mới', 'New PROJECT block')}
              </Button>
            ) : undefined
          }
        >
          <LibraryList
            state={view.status}
            groups={groups}
            errorMessage={view.message}
            action={view.action}
            stale={view.stale}
            onRetry={library.refresh}
            hasMore={library.hasMore}
            loadingMore={library.loadingMore}
            loadMoreError={library.loadMoreError}
            onLoadMore={library.loadMore}
            selectedKey={selectedKey}
            onSelect={(key) => {
              setSelectedKey(key)
              setBlocked(null)
            }}
          />
        </Panel>
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title={pick('Chi tiết', 'Details')}>
            <LibraryDetail
              group={selected}
              usages={selected ? usages.get(selected.entryId.toUpperCase()) ?? [] : []}
              usageSource={workspace.status}
              sealedUsage={sealedUsage.data ?? null}
              dependents={dependents}
              permissions={permissions}
              pending={pending}
              canDeprecate={canEdit && Boolean(projectId)}
              onEdit={(group) => {
                const permission = libraryEntryPermissions(group, {
                  canEdit,
                  hasProject: Boolean(projectId),
                  dependents: libraryDependents(group, entries)
                })
                if (!permission.canSave) {
                  setBlocked(permission.saveBlock)
                  return
                }
                setBlocked(null)
                setEditor({ kind: 'edit', entry: group.current, savesNewVersion: permission.savesNewVersion })
              }}
              onDelete={handleDelete}
              onDeprecate={(revision) => {
                setBlocked(null)
                setDeprecationCandidate(revision)
              }}
            />
          </Panel>
          <Panel
            title={
              editor?.kind === 'edit'
                ? pick('Sửa khối PROJECT', 'Edit PROJECT block')
                : pick('Tạo khối PROJECT', 'New PROJECT block')
            }
          >
            {canEdit ? (
              editor ? (
                <LibraryEntryForm
                  key={editor.kind === 'edit' ? editor.entry.entryId : 'create'}
                  mode={editor}
                  disabled={pending || !projectId}
                  projectEntries={groups.filter((group) => group.scope === 'PROJECT')}
                  onCancel={() => setEditor(null)}
                  onSubmit={handleSave}
                />
              ) : (
                <p className="text-sm text-[var(--c-text-dim)]">
                  {pick(
                    'Chọn một khối PROJECT rồi bấm Sửa, hoặc bấm “Khối PROJECT mới” để tạo khối.',
                    'Select a PROJECT block and choose Edit, or use “New PROJECT block” to create one.'
                  )}
                </p>
              )
            ) : (
              <p className="text-sm text-[var(--c-text-dim)]">
                {pick(
                  'Chỉ tài khoản quản trị mới sửa được Thư viện điều khiển.',
                  'Only administrators can modify the Control Library.'
                )}
              </p>
            )}
          </Panel>
        </div>
      </div>

      <Modal
        open={deprecationCandidate !== null}
        title={pick('Ngừng sử dụng phiên bản thư viện?', 'Deprecate this library version?')}
        confirmLabel={pick('Ngừng sử dụng', 'Deprecate')}
        cancelLabel={pick('Giữ phiên bản', 'Keep version')}
        danger
        confirmLoading={pending}
        confirmDisabled={pending}
        onClose={() => {
          if (!pending) setDeprecationCandidate(null)
        }}
        onConfirm={() => {
          if (deprecationCandidate) void handleDeprecate(deprecationCandidate)
        }}
      >
        <p>
          {pick(
            'Toàn bộ phiên bản PROJECT Library này sẽ chuyển sang DEPRECATED; mọi khối trong phiên bản đều bị ảnh hưởng.',
            'This entire PROJECT Library version will become DEPRECATED; every block in the version is affected.'
          )}
        </p>
        {deprecationCandidate && (
          <p className="mt-2 break-all font-medium text-[var(--c-text)]">
            {deprecationCandidate.libraryVersion} · {deprecationCandidate.libraryRevisionId}
          </p>
        )}
        <p className="mt-2">
          {pick(
            'Revision đã niêm phong vẫn bất biến và tiếp tục ghim đúng nội dung cũ. Việc phát hành phiên bản mới chỉ xảy ra khi niêm phong Revision, không xảy ra từ hành động này.',
            'Sealed revisions stay immutable and keep their pinned content. A new version is published only when a revision is sealed, never by this action.'
          )}
        </p>
      </Modal>
    </div>
  )
}

function LibraryVersionLock({
  lock,
  status
}: {
  lock: ReturnType<typeof draftLibraryLock>
  status: 'loading' | 'ready' | 'error'
}) {
  const { pick } = useI18n()
  if (status === 'loading') {
    return (
      <p className="mt-3 text-xs text-[var(--c-text-dim)]">
        {pick('Đang đọc khoá phiên bản thư viện…', 'Reading the library version lock…')}
      </p>
    )
  }
  if (status === 'error' || !lock) {
    return (
      <p role="status" className="mt-3 flex items-center gap-1.5 text-xs text-[var(--c-warn-fg)]">
        <Lock className="h-3.5 w-3.5" aria-hidden="true" />
        {pick(
          'Chưa đọc được khoá phiên bản thư viện của bản nháp.',
          'The draft’s library version lock could not be read.'
        )}
      </p>
    )
  }
  return (
    <dl aria-label={pick('Khoá phiên bản thư viện', 'Library version lock')} className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
      <div className="flex gap-1.5">
        <dt className="text-[var(--c-text-dim)]">{pick('Profile SYSTEM', 'SYSTEM profile')}</dt>
        <dd className="font-medium">{lock.systemProfile || '—'}</dd>
      </div>
      <div className="flex gap-1.5">
        <dt className="text-[var(--c-text-dim)]">{pick('Phiên bản SYSTEM', 'SYSTEM version')}</dt>
        <dd className="font-medium">{lock.systemVersion || '—'}</dd>
      </div>
      <div className="flex gap-1.5">
        <dt className="text-[var(--c-text-dim)]">{pick('Thư viện PROJECT đã ghim', 'Pinned PROJECT library')}</dt>
        <dd className="font-medium">
          {lock.projectLibraryRevisionId ?? pick('Chưa có bản nào', 'None yet')}
        </dd>
      </div>
    </dl>
  )
}

function MutationBlockNotice({ block }: { block: LibraryMutationBlock }) {
  const { pick } = useI18n()
  const message: Record<LibraryMutationBlock, string> = {
    SYSTEM_IMMUTABLE: pick(
      'Khối SYSTEM thuộc registry chỉ đọc — máy chủ từ chối mọi thao tác sửa hoặc xoá lên nó.',
      'SYSTEM blocks belong to the read-only registry — the server rejects every edit or delete on them.'
    ),
    NEEDS_PERMISSION: pick(
      'Thao tác này cần quyền quản trị.',
      'This action requires an administrator role.'
    ),
    NO_PROJECT: pick(
      'Chưa xác định được Project nên không có bản nháp thư viện để ghi.',
      'No project is resolved, so there is no library draft to write to.'
    ),
    PUBLISHED_IMMUTABLE: pick(
      'Phiên bản đã phát hành là bất biến — chỉ khối trong bản nháp mới xoá được. Hãy sửa để tạo phiên bản mới.',
      'A published version is immutable — only blocks in the draft can be deleted. Edit it to create a new version.'
    ),
    DEPRECATE_REQUIRES_PUBLISHED: pick(
      'Chỉ phiên bản PROJECT Library ở trạng thái PUBLISHED mới có thể chuyển sang DEPRECATED.',
      'Only a PUBLISHED PROJECT Library version can transition to DEPRECATED.'
    ),
    DEPENDED_ON: pick(
      'Khối khác trong cùng phiên bản thư viện đang phụ thuộc khối này; gỡ phụ thuộc trước khi xoá.',
      'Another block in the same library version depends on this one; remove the dependency before deleting.'
    )
  }
  return (
    <p role="alert" className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-3 text-sm text-[var(--c-warn-fg)]">
      {message[block]}
    </p>
  )
}

function ReadBackNotice({ readBack, entries }: { readBack: ReadBack; entries: ProgrammingLibraryEntry[] }) {
  const { pick } = useI18n()
  if (readBack.state === 'reading') {
    return (
      <p role="status" className="rounded-[var(--radius)] border border-[var(--c-border)] p-3 text-sm text-[var(--c-text-dim)]">
        {pick('Đang đọc lại từ máy chủ…', 'Reading back from the server…')}
      </p>
    )
  }
  const stored = entries.filter((entry) => entry.entryId === readBack.entryId)
  if (readBack.action === 'deprecate') {
    const revisionEntries = entries.filter((entry) => entry.libraryRevisionId === readBack.libraryRevisionId)
    const confirmed = revisionEntries.length > 0 && revisionEntries.every((entry) => entry.libraryState === 'DEPRECATED')
    return confirmed ? (
      <p role="status" className="rounded-[var(--radius)] border border-[var(--c-border)] p-3 text-sm">
        {pick('Máy chủ xác nhận phiên bản thư viện', 'The server confirms library version')}{' '}
        <strong>{readBack.libraryVersion ?? revisionEntries[0].libraryVersion}</strong> · DEPRECATED
      </p>
    ) : (
      <p role="alert" className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-3 text-sm text-[var(--c-warn-fg)]">
        {pick(
          'Máy chủ chưa trả lại phiên bản ở trạng thái DEPRECATED — không hiển thị xác nhận lạc quan.',
          'The server has not returned the version in DEPRECATED state — no optimistic confirmation is shown.'
        )}
      </p>
    )
  }
  if (readBack.action === 'delete') {
    const remaining = stored.filter((entry) => entry.libraryState === 'DRAFT')
    return (
      <p role="status" className="rounded-[var(--radius)] border border-[var(--c-border)] p-3 text-sm">
        {remaining.length === 0
          ? pick('Máy chủ xác nhận đã xoá khối khỏi bản nháp thư viện.', 'The server confirms the block was removed from the library draft.')
          : pick('Máy chủ vẫn còn khối này trong bản nháp — hãy tải lại và kiểm tra.', 'The server still lists this block in the draft — reload and check.')}
      </p>
    )
  }
  const draft = stored.find((entry) => entry.libraryState === 'DRAFT') ?? stored[0]
  if (!draft) {
    return (
      <p role="alert" className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-3 text-sm text-[var(--c-warn-fg)]">
        {pick(
          'Đã lưu nhưng máy chủ không trả về khối vừa ghi — không hiển thị giá trị lạc quan.',
          'Saved, but the server did not return the block that was written — no optimistic value is shown.'
        )}
      </p>
    )
  }
  return (
    <p role="status" className="rounded-[var(--radius)] border border-[var(--c-border)] p-3 text-sm">
      {pick('Máy chủ đã trả lại khối', 'The server returned the block')}{' '}
      <strong>{draft.name}</strong> · {draft.libraryVersion} · {draft.libraryState} ·{' '}
      <span className="font-mono text-xs">{draft.contentSha256.slice(0, 16)}…</span>
    </p>
  )
}

function LibraryFilters({
  scope,
  kind,
  category,
  query,
  onScope,
  onKind,
  onCategory,
  onQuery
}: {
  scope: ScopeFilter
  kind: KindFilter
  category: string
  query: string
  onScope: (value: ScopeFilter) => void
  onKind: (value: KindFilter) => void
  onCategory: (value: string) => void
  onQuery: (value: string) => void
}) {
  const { pick } = useI18n()
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end">
      <label className="flex flex-1 flex-col gap-1 text-sm">
        <span className="text-[var(--c-text-dim)]">{pick('Tìm theo tên hoặc mô tả', 'Search name or description')}</span>
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
      {/* `T61-204` — nhãn nhóm lấy từ registry, không viết tay ở FE. Registry
          là nơi `category` được định nghĩa, nên nó cũng phải là nơi định nghĩa
          THỨ TỰ và TÊN hiển thị của nhóm. */}
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[var(--c-text-dim)]">{pick('Phân loại', 'Category')}</span>
        <select
          value={category}
          onChange={(event) => onCategory(event.target.value)}
          className="rounded border border-[var(--c-border)] bg-transparent px-2 py-1.5"
        >
          <option value="">{pick('Tất cả', 'All')}</option>
          {PROGRAMMING_LIBRARY_CATEGORY_ORDER.map((item) => (
            <option key={item.id} value={item.id}>{pick(item.labelVi, item.labelEn)}</option>
          ))}
        </select>
      </label>
    </div>
  )
}

function LibraryList({
  state,
  groups,
  errorMessage,
  action,
  stale,
  onRetry,
  hasMore,
  loadingMore,
  loadMoreError,
  onLoadMore,
  selectedKey,
  onSelect
}: {
  state: LibraryViewStatus
  groups: LibraryEntryGroup[]
  errorMessage: string | null
  /** `T61-206` — hành động chính mà trạng thái mời người dùng làm. ĐÚNG một. */
  action: LibraryViewAction
  /** Nội dung đang hiện KHÔNG đến từ lần đọc thành công hiện tại. */
  stale: boolean
  onRetry: () => void
  hasMore: boolean
  loadingMore: boolean
  loadMoreError: string | null
  onLoadMore: () => void
  selectedKey: string | null
  onSelect: (key: string) => void
}) {
  const { pick } = useI18n()
  if (state === 'loading') {
    return <StateBlock state="loading" title={pick('Đang tải…', 'Loading…')} />
  }
  /* `T61-206` — bốn màn hình "không có gì để xem" nay là bốn trạng thái RIÊNG.
     Trước lát này chúng bị gộp: `groups.length === 0` cho ra cùng một câu
     "không khớp bộ lọc" dù lý do thật là mất mạng, thiếu quyền hay thư viện
     trống. Ba lý do ấy dẫn tới ba hành động khác nhau. */
  if (state === 'no-permission') {
    return (
      <StateBlock
        state="empty"
        title={pick('Vai hiện tại không xem được Thư viện điều khiển.',
                    'The current role cannot view the Control Library.')}
        detail={errorMessage ?? undefined}
      />
    )
  }
  if (state === 'offline' && groups.length === 0) {
    return (
      <StateBlock
        state="error"
        title={pick('Mất kết nối nên chưa đọc được Thư viện điều khiển.',
                    'Offline — the Control Library could not be read.')}
        detail={errorMessage ?? undefined}
        onRetry={onRetry}
      />
    )
  }
  if (state === 'error' && groups.length === 0) {
    return (
      <StateBlock
        state="error"
        title={pick('Không tải được Thư viện điều khiển.', 'Could not load the Control Library.')}
        detail={errorMessage ?? undefined}
        onRetry={onRetry}
      />
    )
  }
  if (state === 'empty-filter') {
    return (
      <StateBlock
        state="empty"
        title={pick('Không có khối nào khớp bộ lọc.', 'No blocks match the filters.')}
      />
    )
  }
  if (state === 'empty-project') {
    /* Khác hẳn `empty-filter`: đây là thư viện của Project chưa có khối nào,
       nên hành động đúng là TẠO, không phải xoá bộ lọc. */
    return (
      <StateBlock
        state="empty"
        title={pick('Thư viện của Project này chưa có khối nào.',
                    'This project library has no blocks yet.')}
        detail={action === 'create-block'
          ? pick('Dùng nút Tạo khối để bắt đầu.', 'Use Create block to get started.')
          : pick('Vai hiện tại không tạo được khối.', 'The current role cannot create blocks.')}
      />
    )
  }
  return (
    <ul className="flex flex-col divide-y divide-[var(--c-border)]" aria-label={pick('Danh sách khối Thư viện điều khiển', 'Control Library blocks')}>
      {/* Dữ liệu đang hiện không đến từ lần đọc thành công hiện tại. Nói ra:
          một danh sách cũ trông y hệt một danh sách mới. */}
      {stale && (
        <li className="py-1 text-xs text-[var(--c-warn-fg)]" role="status">
          {pick('Danh sách này là bản đã tải trước đó.', 'This list is a previously loaded copy.')}
        </li>
      )}
      {groups.map((group) => (
        <li key={group.key}>
          <button
            type="button"
            onClick={() => onSelect(group.key)}
            aria-current={group.key === selectedKey ? 'true' : undefined}
            className={`flex w-full flex-col items-stretch gap-1 px-1 py-2 text-left text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-2 ${
              group.key === selectedKey ? 'text-[var(--c-accent)]' : ''
            }`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <Library className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate font-medium">{group.name}</span>
              {/* `T61-204` — nhãn phạm vi bằng tiếng người, KHÔNG dùng chữ
                  "Core": sản phẩm đã có `mkddc-core` và hai nghĩa cho một từ
                  đúng chỗ người trực ca cần đọc nhanh là một cái bẫy. */}
              <span className="shrink-0 rounded bg-[var(--c-surface-2)] px-1.5 py-0.5 text-xs text-[var(--c-text-dim)]">
                {scopeLabel(group.scope, false)}
              </span>
              {group.scope === 'SYSTEM' && (
                <Lock className="h-3.5 w-3.5 shrink-0 text-[var(--c-text-dim)]" aria-label={pick('Chỉ đọc', 'Read-only')} />
              )}
            </span>
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--c-text-dim)] sm:shrink-0 sm:flex-nowrap">
              {group.kind}
              {/* Phân loại nghiệp vụ. Vắng nguồn thì hiện `—` KÈM lý do: một ô
                  trống đọc như "không thuộc nhóm nào", còn sự thật là "chưa ai
                  phân loại". */}
              {group.current.category
                ? <span>{categoryLabel(group.current.category, pick)}</span>
                : <span title={pick('Khối này chưa được phân loại', 'This block has no category yet')}>—</span>}
              <span>
                {group.current.libraryVersion} · {group.current.libraryState}
              </span>
              {group.versions.length > 1 && (
                <span>
                  {pick('· %n phiên bản', '· %n versions').replace('%n', String(group.versions.length))}
                </span>
              )}
              {REVIEW_GATED.has(group.name) && <ReviewGateBadge />}
            </span>
          </button>
        </li>
      ))}
      {/* `T61-202` — chân trang phân trang.
          Trước lát này danh sách đọc đúng một trang `limit: 100` rồi bỏ
          `nextCursor`: phần dư biến mất IM LẶNG, và người dùng kết luận khối
          họ tìm không tồn tại. Nay còn trang thì nói ra và cho tải tiếp. */}
      {(hasMore || loadMoreError) && (
        <li className="flex flex-col gap-1 py-2">
          {loadMoreError && (
            /* Lỗi của RIÊNG trang vừa xin — danh sách phía trên vẫn dùng được.
               Xoá nó đi vì trang thứ tư lỗi là đánh đổi không ai chọn. */
            <p role="alert" className="text-xs text-[var(--c-fault-fg)]">{loadMoreError}</p>
          )}
          {hasMore && (
            <Button size="sm" onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore ? pick('Đang tải…', 'Loading…') : pick('Tải thêm khối', 'Load more blocks')}
            </Button>
          )}
        </li>
      )}
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
  group,
  usages,
  usageSource,
  sealedUsage,
  dependents,
  permissions,
  pending,
  canDeprecate,
  onEdit,
  onDelete,
  onDeprecate
}: {
  group: LibraryEntryGroup | null
  usages: LibraryUsage[]
  usageSource: 'loading' | 'ready' | 'error'
  sealedUsage: ProgrammingLibraryUsage | null
  dependents: string[]
  permissions: ReturnType<typeof libraryEntryPermissions> | null
  pending: boolean
  canDeprecate: boolean
  onEdit: (group: LibraryEntryGroup) => void
  onDelete: (group: LibraryEntryGroup) => void
  onDeprecate: (revision: ProgrammingLibraryEntry) => void
}) {
  const { pick } = useI18n()
  if (!group || !permissions) {
    return <p className="text-sm text-[var(--c-text-dim)]">{pick('Chọn một khối để xem chi tiết.', 'Select a block to see its details.')}</p>
  }
  const entry = group.current
  return (
    <div className="flex flex-col gap-3">
      <dl className="flex flex-col gap-2 text-sm">
        <Row label={pick('Tên', 'Name')} value={entry.name} />
        <Row label={pick('Loại', 'Kind')} value={entry.kind} />
        <Row label={pick('Phạm vi', 'Scope')} value={scopeLabel(entry.scope, false)} />
        {/* `T61-204` — hai trường metadata. `metadataValue` trả `null` cho
            field VẮNG, và ở đây `null` phải thành `—` KÈM lý do: một ô trống
            đọc như "đã điền rồi và nội dung rỗng", nên người dùng sẽ không đi
            tìm chỗ để điền. */}
        <Row
          label={pick('Phân loại', 'Category')}
          value={metadataValue(entry.category)
            ? categoryLabel(entry.category as string, pick)
            : pick('— chưa phân loại', '— not categorised')}
        />
        <Row
          label={pick('Mô tả', 'Description')}
          value={metadataValue(entry.description) ?? pick('— chưa có mô tả', '— no description yet')}
        />
        <Row label={pick('Ngôn ngữ', 'Language')} value={entry.language ?? '—'} />
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
        <Row
          label={pick('Khối phụ thuộc vào nó', 'Depended on by')}
          value={dependents.length === 0 ? pick('Không có', 'None') : dependents.join(', ')}
        />
      </dl>

      <LibraryUsageList usages={usages} source={usageSource} sealed={sealedUsage} />
      <LibraryVersionHistory
        group={group}
        canDeprecate={canDeprecate}
        pending={pending}
        onDeprecate={onDeprecate}
      />

      {REVIEW_GATED.has(entry.name) && (
        <p role="note" className="text-sm text-[var(--c-warn)]">
          {pick(
            'Khối này chưa qua review Controls/Safety nên Kiểm tra sẽ từ chối mọi Program dùng nó.',
            'This block has not passed Controls/Safety review, so Check rejects any program that uses it.'
          )}
        </p>
      )}

      {entry.scope === 'SYSTEM' ? (
        <p className="text-sm text-[var(--c-text-dim)]">
          {pick(
            'Khối SYSTEM là registry chỉ đọc: không sửa, không xoá, không tạo phiên bản.',
            'SYSTEM blocks come from the read-only registry: no edit, no delete, no new version.'
          )}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            icon={<Pencil className="h-4 w-4" aria-hidden="true" />}
            disabled={pending || !permissions.canSave}
            onClick={() => onEdit(group)}
          >
            {permissions.savesNewVersion ? pick('Sửa — tạo phiên bản mới', 'Edit — create a new version') : pick('Sửa khối', 'Edit block')}
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
            disabled={pending || !permissions.canDelete}
            onClick={() => onDelete(group)}
          >
            {pick('Xoá khối', 'Delete block')}
          </Button>
        </div>
      )}
      {permissions.savesNewVersion && entry.scope === 'PROJECT' && (
        <p className="text-xs text-[var(--c-text-dim)]">
          {pick(
            'Phiên bản hiện tại đã phát hành. Lưu thay đổi sẽ mở một phiên bản nháp mới; nó chỉ được phát hành khi bạn niêm phong Revision ở trang Kiểm tra.',
            'The current version is published. Saving opens a new draft version; it is published only when you seal a revision on the Check page.'
          )}
        </p>
      )}
    </div>
  )
}

/**
 * `T61-204` — Used-In với HAI NGUỒN được gắn nhãn tách bạch.
 *
 * Không gộp thành một con số, và lý do không phải trình bày:
 *
 *  - Phần **đã niêm phong** đến từ server (`library_usages`), phủ mọi Project,
 *    và là thứ nói được "khối này đang chạy ở đâu".
 *  - Phần **bản nháp** tính ở FE từ chính Draft đang mở, nên nó CHỈ phủ Project
 *    hiện tại. Gọi nó là "bản nháp" nói chung sẽ hứa rộng hơn sự thật.
 *
 * Gộp hai con số lại là cách một khối bị deprecate trong khi nó đang điều khiển
 * tủ: người dùng thấy "0 nơi dùng" của bản nháp và tưởng đó là toàn bộ.
 */
function LibraryUsageList({
  usages,
  source,
  sealed,
}: {
  usages: LibraryUsage[]
  source: 'loading' | 'ready' | 'error'
  sealed: ProgrammingLibraryUsage | null
}) {
  const { pick } = useI18n()
  const sealedView = usageDisplay(sealed)
  return (
    <section aria-label={pick('Nơi sử dụng', 'Usage')} className="border-t border-[var(--c-border)] pt-2">
      <h3 className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Nơi sử dụng', 'Usage')}</h3>

      {/* Phạm vi 1: gói ĐÃ NIÊM PHONG, đọc từ server, phủ mọi Project. */}
      <div className="mt-1 rounded border border-[var(--c-border)] p-2">
        <p className="text-xs font-medium text-[var(--c-text)]">
          {pick('Trong Revision đã niêm phong', 'In sealed revisions')}
        </p>
        {sealedView.kind === 'unavailable' ? (
          /* `UNAVAILABLE` KHÔNG được hiện thành 0. `0` nghĩa là "không ai dùng"
             — một câu mời người ta xoá khối; đây là "chưa đo được". */
          <p className="text-sm text-[var(--c-warn-fg)]">
            {pick('Chưa đo được — khối SYSTEM phân giải nơi dùng từ registry, không qua bảng usage.',
                  'Not measured — SYSTEM blocks resolve usage from the registry, not the usage table.')}
          </p>
        ) : (
          <>
            <p className="text-sm text-[var(--c-text)]">
              {pick('%n nơi dùng', '%n usages').replace('%n', String(sealedView.sealed))}
              {sealedView.truncated ? pick(' (còn nữa)', ' (more not listed)') : ''}
            </p>
            {sealed !== null && sealed.sealed.items.length > 0 && (
              <ul className="mt-1 flex flex-col gap-0.5 text-xs text-[var(--c-text-dim)]">
                {sealed.sealed.items.slice(0, 10).map((item) => (
                  <li key={`${item.revisionId}:${item.objectId}:${item.usageKind}`} className="flex justify-between gap-2">
                    <span className="truncate">{item.projectName} › {item.objectName || item.objectId.slice(0, 8)}</span>
                    <span className="shrink-0">
                      {item.usageKind}
                      {item.isActive ? pick(' · đang chạy', ' · running') : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <p className="mt-2 text-xs font-medium text-[var(--c-text)]">
        {pick('Trong bản nháp của Project này', "In this project's draft")}
      </p>
      {source === 'loading' && <p className="text-sm text-[var(--c-text-dim)]">{pick('Đang đọc bản nháp…', 'Reading the draft…')}</p>}
      {source === 'error' && (
        <p className="text-sm text-[var(--c-warn-fg)]">
          {pick('Chưa đọc được bản nháp nên chưa biết nơi sử dụng.', 'The draft could not be read, so usage is unknown.')}
        </p>
      )}
      {source === 'ready' &&
        (usages.length === 0 ? (
          <p className="text-sm text-[var(--c-text-dim)]">
            {pick('Chưa POU nào trong bản nháp khai khối này là phụ thuộc.', 'No POU in the draft declares this block as a dependency.')}
          </p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {usages.map((usage) => (
              <li key={usage.objectId} className="flex justify-between gap-3">
                <span className="truncate">{usage.name}</span>
                <span className="shrink-0 text-xs text-[var(--c-text-dim)]">{usage.kind}</span>
              </li>
            ))}
          </ul>
        ))}
    </section>
  )
}

function LibraryVersionHistory({
  group,
  canDeprecate,
  pending,
  onDeprecate
}: {
  group: LibraryEntryGroup
  canDeprecate: boolean
  pending: boolean
  onDeprecate: (revision: ProgrammingLibraryEntry) => void
}) {
  const { pick } = useI18n()
  return (
    <section aria-label={pick('Lịch sử phiên bản', 'Version history')} className="border-t border-[var(--c-border)] pt-2">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase text-[var(--c-text-dim)]">
        <History className="h-3.5 w-3.5" aria-hidden="true" />
        {pick('Lịch sử phiên bản', 'Version history')}
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs uppercase text-[var(--c-text-dim)]">
              <th className="py-1 pr-3">{pick('Phiên bản', 'Version')}</th>
              <th className="py-1 pr-3">{pick('Trạng thái', 'State')}</th>
              <th className="py-1 pr-3">{pick('Hash', 'Hash')}</th>
              {canDeprecate && <th className="py-1 text-right">{pick('Thao tác', 'Action')}</th>}
            </tr>
          </thead>
          <tbody>
            {group.versions.map((version) => (
              <tr key={version.libraryRevisionId} className="border-t border-[var(--c-border)]">
                <td className="py-1 pr-3 font-medium">{version.libraryVersion}</td>
                <td className="py-1 pr-3">{version.libraryState}</td>
                <td className="py-1 pr-3 font-mono text-xs">{version.contentSha256.slice(0, 12)}…</td>
                {canDeprecate && (
                  <td className="py-1 text-right">
                    {version.scope === 'PROJECT' && version.libraryState === 'PUBLISHED' ? (
                      <Button
                        size="sm"
                        variant="danger"
                        icon={<ArchiveX className="h-4 w-4" aria-hidden="true" />}
                        disabled={pending}
                        aria-label={pick(
                          `Ngừng sử dụng phiên bản ${version.libraryVersion}`,
                          `Deprecate version ${version.libraryVersion}`
                        )}
                        onClick={() => onDeprecate(version)}
                      >
                        {pick('Ngừng sử dụng', 'Deprecate')}
                      </Button>
                    ) : (
                      <span aria-label={pick('Không có thao tác', 'No action')} className="text-[var(--c-text-dim)]">—</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
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

function LibraryEntryForm({
  mode,
  disabled,
  projectEntries,
  onCancel,
  onSubmit
}: {
  mode: EditorMode
  disabled: boolean
  projectEntries: LibraryEntryGroup[]
  onCancel: () => void
  onSubmit: (draft: LibraryEntryDraft) => void
}) {
  const { pick } = useI18n()
  const existing = mode.kind === 'edit' ? mode.entry : null
  const [name, setName] = useState(existing?.name ?? '')
  const [kind, setKind] = useState<'FUNCTION' | 'FUNCTION_BLOCK'>(
    existing?.kind === 'FUNCTION_BLOCK' ? 'FUNCTION_BLOCK' : 'FUNCTION'
  )
  const [language, setLanguage] = useState<'ST' | 'FBD'>(existing?.language === 'FBD' ? 'FBD' : 'ST')
  const [source, setSource] = useState('')
  const [dependencies, setDependencies] = useState<string[]>(
    existing ? existing.dependencies.map((item) => item.entryId) : []
  )
  const [touched, setTouched] = useState(false)

  const sourceBytes = new TextEncoder().encode(source).length
  const nameError = !LIBRARY_NAME_PATTERN.test(name.trim())
  const sourceError = sourceBytes < 1 || sourceBytes > LIBRARY_SOURCE_MAX_BYTES
  const invalid = nameError || sourceError
  const selectableDependencies = projectEntries.filter((group) => group.entryId !== existing?.entryId)

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        setTouched(true)
        if (invalid) return
        onSubmit({
          entryId: existing?.entryId ?? createUuid(),
          kind,
          name: name.trim(),
          language,
          source,
          // SearchLibraryEntries trả lại interface đã canonical hoá. Khi sửa
          // một entry, giữ nguyên contract đó thay vì âm thầm thay bằng một
          // interface rỗng (interface là một phần của content hash/provenance
          // phía server). Entry mới chưa có contract nên bắt đầu bằng object
          // rỗng tương thích với API hiện hành.
          interface: existing?.interface ?? { inputs: [] },
          dependencies: dependencies.map((entryId) => ({
            entryId,
            version: projectEntries.find((group) => group.entryId === entryId)?.current.libraryVersion ?? '1.0.0'
          }))
        })
      }}
    >
      {existing && (
        <p className="text-xs text-[var(--c-text-dim)]">
          {pick('Đang sửa', 'Editing')} <strong>{existing.name}</strong> · {existing.libraryVersion} · {existing.libraryState}
        </p>
      )}
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[var(--c-text-dim)]">{pick('Tên khối', 'Block name')}</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={64}
          aria-invalid={touched && nameError ? 'true' : undefined}
          className="rounded border border-[var(--c-border)] bg-transparent px-2 py-1.5"
        />
        {touched && nameError && (
          <span role="alert" className="text-xs text-[var(--c-fault-fg)]">
            {pick(
              'Tên phải bắt đầu bằng chữ cái và chỉ gồm chữ, số hoặc gạch dưới, tối đa 64 ký tự.',
              'The name must start with a letter and contain only letters, digits or underscores, up to 64 characters.'
            )}
          </span>
        )}
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
        <span className="text-[var(--c-text-dim)]">{pick('Ngôn ngữ', 'Language')}</span>
        <select
          value={language}
          onChange={(event) => setLanguage(event.target.value as 'ST' | 'FBD')}
          className="rounded border border-[var(--c-border)] bg-transparent px-2 py-1.5"
        >
          <option value="ST">ST</option>
          <option value="FBD">FBD</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[var(--c-text-dim)]">
          {language === 'FBD' ? pick('Nội dung FBD (JSON)', 'FBD content (JSON)') : pick('Mã nguồn ST', 'ST source')}
        </span>
        <textarea
          value={source}
          onChange={(event) => setSource(event.target.value)}
          required
          rows={5}
          aria-invalid={touched && sourceError ? 'true' : undefined}
          className="rounded border border-[var(--c-border)] bg-transparent px-2 py-1.5 font-mono text-xs"
        />
        {existing && (
          <span className="text-xs text-[var(--c-text-dim)]">
            {pick(
              'Máy chủ không trả lại mã nguồn của khối đã lưu, nên ô này luôn bắt đầu trống: hãy dán lại toàn bộ mã của phiên bản mới.',
              'The server does not return the stored source, so this field always starts empty: paste the full source of the new version.'
            )}
          </span>
        )}
        {touched && sourceError && (
          <span role="alert" className="text-xs text-[var(--c-fault-fg)]">
            {pick('Mã nguồn phải dài 1..65536 byte.', 'The source must be 1..65536 bytes long.')}
          </span>
        )}
      </label>
      {selectableDependencies.length > 0 && (
        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="text-[var(--c-text-dim)]">{pick('Phụ thuộc khối PROJECT', 'PROJECT block dependencies')}</legend>
          {selectableDependencies.map((group) => (
            <label key={group.entryId} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={dependencies.includes(group.entryId)}
                onChange={(event) =>
                  setDependencies((current) =>
                    event.target.checked ? [...current, group.entryId] : current.filter((id) => id !== group.entryId)
                  )
                }
              />
              <span>
                {group.name} · {group.current.libraryVersion}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={disabled} icon={<Save className="h-4 w-4" aria-hidden="true" />}>
          {pick('Lưu vào bản nháp thư viện', 'Save to library draft')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {pick('Huỷ', 'Cancel')}
        </Button>
      </div>
    </form>
  )
}
