import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Plus } from 'lucide-react'
import { Panel } from '../../../shared/components/Panel'
import { Button } from '../../../shared/components/Button'
import { Modal } from '../../../shared/components/Modal'
import { useI18n } from '../../../shared/i18n'
import { useAuth } from '../../auth'
import { roleCan } from '../../../shared/auth/capabilities'
import { PROGRAMMING_LIBRARY_CATEGORY_ORDER } from '../api/generated/library_registry'
import { LibraryCardGrid } from './LibraryCardGrid'
import { LibraryInspector, isInspectorTab, type InspectorTab } from './LibraryInspector'
import { LibraryAuthoringDrawer, type LibraryEditorMode } from './LibraryAuthoringDrawer'
import { TargetPouChooser } from './TargetPouChooser'
import { LibraryVersionLock } from './LibraryVersionLock'
import { MutationBlockNotice, ReadBackNotice, type ReadBack } from './LibraryNotices'
import {
  libraryFiltersKey,
  libraryViewState,
  rememberLibraryRead,
  type LibraryReadInput,
  type LibraryViewMemory,
} from './libraryViewState'
import {
  useProgrammingLibraryPaged,
  useProgrammingLibraryUsage,
  useProgrammingProjects,
  type LibrarySearchFilters,
} from '../api/queries'
import { useProgrammingLibraryEntryMutations, type LibraryEntryDraft } from '../api/mutations'
import { useDraftWorkspace } from '../design/useDraftWorkspace'
import { useProgrammingMobileReadOnly } from '../layout/useProgrammingViewport'
import { canonicalProgramsPath } from '../shared/programsRoute'
import {
  libraryDependents,
  libraryEntryPermissions,
  libraryRevisionDeprecationBlock,
  libraryUsagesByEntryId,
  type LibraryEntryGroup,
  type LibraryMutationBlock,
} from '../model/library'
import { draftLibraryLock, draftObjects, isDraftV2 } from '../model/signals'
import type { ProgrammingLibraryEntry } from '../model/types'

export { INSPECTOR_TABS, isInspectorTab, type InspectorTab } from './LibraryInspector'

/**
 * PGM-04 — Control Library (DDD-SW-PROG-UNIFIED-001 §8, UX §3.4/§11).
 *
 * Trang này CHỈ hiển thị trạng thái review-gate; nó không có checkbox nào để
 * "duyệt" một feature. Token phê duyệt Controls/Safety suy ra từ contract profile
 * và chỉ generator dựng được (T59-205) — một ô tick ở đây sẽ là đúng thứ DDD §9
 * cấm.
 *
 * Ghi entry luôn rơi vào DRAFT library đang mở (server tự mở bản minor kế tiếp
 * nếu cần), còn publish xảy ra khi niêm phong Revision ở PGM-05. Chỉ chuyển
 * tiếp một chiều PUBLISHED -> DEPRECATED có endpoint riêng; trang tuyệt đối
 * không dựng một hành động Publish độc lập.
 *
 * `T61-301` — tệp này là CONTROLLER: URL state, query/mutation và điều phối.
 * Lưới thẻ, Inspector, drawer soạn thảo và bộ chọn POU đích nằm ở các tệp cạnh
 * bên. Trước lát này cả năm thứ chen trong một tệp hơn 1.500 dòng, và hệ quả
 * đọc được trên màn hình: form soạn thảo phải luôn hiện vì không có chỗ nào
 * khác để đặt nó.
 */
type ScopeFilter = '' | 'SYSTEM' | 'PROJECT'
type KindFilter = '' | 'FUNCTION' | 'FUNCTION_BLOCK' | 'CONVERSION'

export function LibraryPage() {
  const { pick } = useI18n()
  const { session } = useAuth()
  const navigate = useNavigate()
  /* `WEB-RBAC-001` — ghi PROJECT Library đòi `program.edit`, không đòi vai
     `admin`. Trước lát này `engineer` bị giao diện chặn trên một thao tác mà
     máy chủ chấp nhận. */
  const [searchParams, setSearchParams] = useSearchParams()
  /* `SPEC-PGM04-VISUAL-001` §1 — dưới 768 px PGM-02 đã là chỉ-đọc, nên PGM-04
     cũng không được hiện đường ghi nào. Hai luật cho một thiết bị là cách một
     kỹ thuật viên sửa thư viện trên điện thoại giữa lúc đứng cạnh tủ. */
  const mobileReadOnly = useProgrammingMobileReadOnly()
  const canEdit = roleCan(session?.role, 'program.edit') && !mobileReadOnly
  const routeParams = useParams<{ projectId: string }>()
  const projects = useProgrammingProjects()
  // Route là nguồn sự thật; danh sách chỉ là đường lùi cho lối vào cũ không
  // mang `projectId` (Rev A chỉ có một Project/controller).
  const projectId = routeParams.projectId ?? projects.data?.items[0]?.projectId
  const projectSummary = projects.data?.items.find((item) => item.projectId === projectId) ?? projects.data?.items[0]
  const workspace = useDraftWorkspace(projectId)

  /* `T61-204` — bộ lọc và khối đang chọn sống trong URL, không trong `useState`.
   *
   * Trước lát này chúng là state cục bộ, nên `Back`, tải lại trang, hay gửi
   * đường dẫn cho đồng nghiệp đều mất ngữ cảnh: người nhận mở ra thấy toàn bộ
   * thư viện thay vì đúng khối đang được nói tới. Một màn hình tra cứu mà không
   * dán link được thì người ta sẽ mô tả bằng lời, và mô tả bằng lời là chỗ
   * nhầm khối.
   *
   * `replace: true` cho mọi thay đổi bộ lọc: gõ mười ký tự vào ô tìm không được
   * đẻ ra mười mục lịch sử, nếu không `Back` trở thành nút xoá-một-ký-tự. */
  const setParam = useCallback((key: string, value: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set(key, value)
      else next.delete(key)
      return next
    }, { replace: true })
  }, [setSearchParams])

  const scope = (searchParams.get('scope') ?? '') as ScopeFilter
  const kind = (searchParams.get('kind') ?? '') as KindFilter
  const setScope = useCallback((value: ScopeFilter) => setParam('scope', value), [setParam])
  const setKind = useCallback((value: KindFilter) => setParam('kind', value), [setParam])
  /* `T61-204` — lọc theo phân loại nghiệp vụ. Nguồn giá trị là
     `categoryOrder` của registry, không phải một danh sách viết tay ở FE:
     thêm một nhóm vào registry mà FE không biết sẽ tạo ra một bộ lọc bỏ sót
     khối, và người dùng không có cách nào nhận ra. */
  const category = searchParams.get('category') ?? ''
  const setCategory = useCallback((value: string) => setParam('category', value), [setParam])
  const query = searchParams.get('q') ?? ''
  const setQuery = useCallback((value: string) => setParam('q', value), [setParam])
  /* Khối đang chọn cũng nằm trong URL: đó là thứ người ta muốn gửi đi nhất. */
  const selectedKey = searchParams.get('entry')
  /* Tab của Inspector cũng nằm trong URL. Mặc định `details` khi tham số thiếu
     hoặc lạ — fail-closed về khay an toàn nhất thay vì để màn hình trống. */
  const tabParam = searchParams.get('panel')
  const inspectorTab: InspectorTab = isInspectorTab(tabParam) ? tabParam : 'details'
  const setInspectorTab = useCallback((value: InspectorTab) => setParam('panel', value), [setParam])
  /* `T61-204` — `returnTo`: đường quay lại đúng chỗ người dùng đã rời đi.
   *
   * PGM-02 mở Thư viện để tra một khối rồi phải quay về đúng POU đang sửa. Nếu
   * không mang đường về, người dùng bấm Back — và Back sau nhiều lần đổi bộ lọc
   * (`replace: true`) sẽ nhảy ra ngoài Thư viện chứ không về POU. Một nút quay
   * lại hiện tường minh thì không phụ thuộc lịch sử.
   *
   * CHỈ nhận đường dẫn nội bộ. Một `returnTo` trỏ ra ngoài là một open redirect:
   * người ta gửi link "mở Thư viện" rồi nút Quay lại đưa nạn nhân sang trang
   * khác mang theo phiên đang đăng nhập. */
  const returnToRaw = searchParams.get('returnTo')
  const returnTo = returnToRaw && returnToRaw.startsWith('/') && !returnToRaw.startsWith('//')
    ? returnToRaw
    : null
  const setSelectedKey = useCallback((value: string | null) => setParam('entry', value ?? ''), [setParam])
  const hasFilters = scope !== '' || kind !== '' || category !== '' || query.trim() !== ''
  const clearFilters = useCallback(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      for (const key of ['scope', 'kind', 'category', 'q']) next.delete(key)
      return next
    }, { replace: true })
  }, [setSearchParams])

  const [etag, setEtag] = useState<string | null>(null)
  const [editor, setEditor] = useState<LibraryEditorMode | null>(null)
  const [insertCandidate, setInsertCandidate] = useState<LibraryEntryGroup | null>(null)
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
    status: library.status, items: library.items, error: library.error, failure: library.failure,
    hasMore: library.hasMore, loadingMore: library.loadingMore, loadMoreError: library.loadMoreError,
  }), [library.status, library.items, library.error, library.failure, library.hasMore, library.loadingMore, library.loadMoreError])
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
  /* `T61-206` — danh sách vẽ ra phải lấy từ MÔ HÌNH TRẠNG THÁI, không từ mảng
     thô: `no-permission` KHÔNG xoá nội dung, và nội dung giữ lại khi lỗi phải
     đi kèm cờ `stale`. `view.groups` đã gom sẵn theo entry và đã áp cả hai. */
  const groups = view.groups
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
  const draftPous = useMemo(
    () => (workspace.project?.draft ? draftObjects(workspace.project.draft) : []),
    [workspace.project?.draft],
  )
  const dependents = useMemo(() => (selected ? libraryDependents(selected, entries) : []), [selected, entries])
  const permissions = selected
    ? libraryEntryPermissions(selected, { canEdit, hasProject: Boolean(projectId), dependents })
    : null
  const lock = workspace.project?.draft ? draftLibraryLock(workspace.project.draft) : null

  /* Số nơi dùng trên THẺ, phạm vi bản nháp của Project đang mở — và nhãn ở thẻ
     nói đúng phạm vi ấy. `null` khi chưa đọc được Draft: `0` nghĩa là "không
     POU nào dùng khối này", một câu mời người ta xoá nó. */
  const draftUsageCount = useCallback(
    (group: LibraryEntryGroup): number | null =>
      workspace.status === 'ready' ? (usages.get(group.entryId.toUpperCase()) ?? []).length : null,
    [usages, workspace.status],
  )

  /* `T61-403` — đường tới đúng POU trong PGM-02, mang theo đường quay lại
     chính màn hình Thư viện đang mở (kèm bộ lọc và khối đang chọn). Nếu POU
     thuộc Project khác thì trả `null`: dựng link tới Project hiện tại bằng một
     `objectId` của Project khác sẽ mở nhầm POU trùng tên, và người dùng không
     có cách nào biết. */
  const usedInHref = useCallback(
    (objectId: string, usageProjectId?: string): string | null => {
      if (!projectId) return null
      if (usageProjectId && usageProjectId !== projectId) return null
      const back = `${window.location.pathname}${window.location.search}`
      const params = new URLSearchParams({ returnTo: back })
      return canonicalProgramsPath(projectId, { pou: objectId, mode: 'EDIT', search: params })
    },
    [projectId],
  )

  /* Read-back thật: chỉ báo "đã lưu" SAU khi danh sách được đọc lại từ server.
     Bám vào identity của MẢNG items (mỗi lần fetch xong là một mảng mới) thay
     vì của object page, vì hook phân trang ghép nhiều trang vào cùng state. */
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
      {/* `T61-204` — đường quay lại tường minh. Không dựa vào `Back` của trình
          duyệt: mọi thay đổi bộ lọc dùng `replace: true`, nên `Back` sẽ nhảy
          thẳng ra ngoài Thư viện chứ không về chỗ người dùng đã rời đi. */}
      {returnTo && (
        <Link
          to={returnTo}
          className="inline-flex w-fit items-center gap-1 text-sm text-[var(--c-accent)] hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {pick('Quay lại chỗ đang làm', 'Back to where you were')}
        </Link>
      )}
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
          hasFilters={hasFilters}
          onScope={setScope}
          onKind={setKind}
          onCategory={setCategory}
          onQuery={setQuery}
          onClear={clearFilters}
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

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,22rem)]">
        <Panel
          className="min-w-0"
          title={pick('Danh sách khối', 'Blocks')}
          action={
            /* `SPEC-PGM04-VISUAL-001` §3 — thiếu quyền thì nút ghi VẪN THẤY,
               `disabled`, kèm lý do thành lời. Ẩn nút làm người dùng tưởng
               thiết bị không có khả năng đó rồi đi hỏi sai người; một nút bị
               khoá kèm lý do thì họ đọc được ngay tại chỗ. */
            <div className="flex flex-col items-end gap-1">
              <Button
                size="sm"
                icon={<Plus className="h-4 w-4" aria-hidden="true" />}
                disabled={!canEdit || !projectId}
                aria-describedby={!canEdit || !projectId ? 'library-create-reason' : undefined}
                onClick={() => {
                  setBlocked(null)
                  setEditor({ kind: 'create' })
                }}
              >
                {pick('Khối PROJECT mới', 'New PROJECT block')}
              </Button>
              {(!canEdit || !projectId) && (
                <span id="library-create-reason" className="text-xs text-[var(--c-text-dim)]">
                  {!projectId
                    ? pick('Chưa xác định được Project nên chưa có bản nháp thư viện để ghi.',
                           'No project is resolved, so there is no library draft to write to.')
                    : mobileReadOnly
                      ? pick('Màn hình dưới 768 px là chỉ đọc — mở trên máy tính để sửa Thư viện.',
                             'Screens under 768 px are read-only — open this on a desktop to edit the library.')
                      : pick('Vai hiện tại không sửa được Thư viện điều khiển.',
                             'The current role cannot modify the Control Library.')}
                </span>
              )}
            </div>
          }
        >
          <LibraryCardGrid
            state={view.status}
            groups={groups}
            errorMessage={view.message}
            action={view.action}
            stale={view.stale}
            draftUsageCount={draftUsageCount}
            onRetry={library.refresh}
            onClearFilters={clearFilters}
            onCreate={canEdit && projectId ? () => setEditor({ kind: 'create' }) : null}
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
        <Panel className="min-w-0 lg:sticky lg:top-4 lg:self-start" title={pick('Khối đang chọn', 'Selected block')}>
          {/* Một đường dẫn ghim `entry` mà bộ lọc hiện tại không chứa khối ấy
              phải NÓI RA. Trước lát này Inspector chỉ hiện "Chọn một khối" —
              cùng câu với lúc chưa chọn gì — nên người nhận link kết luận khối
              đã bị xoá, trong khi nó chỉ đang bị lọc ra. */}
          {selectedKey && !selected && view.status !== 'loading' && (
            <div className="mb-3 flex flex-col items-start gap-2 rounded border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-2 text-sm text-[var(--c-warn-fg)]">
              <p>
                {hasFilters
                  ? pick('Khối trong đường dẫn không nằm trong bộ lọc hiện tại.',
                         'The block in this link is outside the current filters.')
                  : pick('Không tìm thấy khối trong đường dẫn — có thể nó đã bị xoá.',
                         'The block in this link was not found — it may have been deleted.')}
              </p>
              {hasFilters && (
                <Button size="sm" onClick={clearFilters}>{pick('Xoá bộ lọc', 'Clear filters')}</Button>
              )}
            </div>
          )}
          <LibraryInspector
            group={selected}
            usages={selected ? usages.get(selected.entryId.toUpperCase()) ?? [] : []}
            usageSource={workspace.status}
            sealedUsage={sealedUsage.data ?? null}
            sealedUsageLoading={sealedUsage.status === 'loading'}
            tab={inspectorTab}
            onTab={setInspectorTab}
            dependents={dependents}
            permissions={permissions}
            pending={pending}
            canDeprecate={canEdit && Boolean(projectId)}
            canInsert={Boolean(projectId) && !mobileReadOnly}
            usedInHref={usedInHref}
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
            onInsert={(group) => {
              setBlocked(null)
              setInsertCandidate(group)
            }}
          />
        </Panel>
      </div>

      <LibraryAuthoringDrawer
        mode={editor}
        disabled={pending || !projectId}
        projectEntries={groups.filter((group) => group.scope === 'PROJECT')}
        onCancel={() => setEditor(null)}
        onSubmit={handleSave}
      />

      <TargetPouChooser
        group={insertCandidate}
        objects={draftPous}
        draftReadable={workspace.status === 'ready'}
        draftSupported={Boolean(workspace.project?.draft && isDraftV2(workspace.project.draft))}
        onCancel={() => setInsertCandidate(null)}
        onChoose={(candidate) => {
          setInsertCandidate(null)
          if (!projectId) return
          /* ZERO MUTATION ở phía Thư viện: đây là một lần điều hướng, không phải
             một lần ghi Draft. Phép chèn thật xảy ra trong bộ soạn thảo, nơi có
             Hoàn tác trong tầm mắt người dùng. */
          const back = `${window.location.pathname}${window.location.search}`
          navigate(canonicalProgramsPath(projectId, {
            pou: candidate.objectId,
            mode: 'EDIT',
            search: new URLSearchParams({ returnTo: back }),
          }))
        }}
      />

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

function LibraryFilters({
  scope,
  kind,
  category,
  query,
  hasFilters,
  onScope,
  onKind,
  onCategory,
  onQuery,
  onClear,
}: {
  scope: ScopeFilter
  kind: KindFilter
  category: string
  query: string
  hasFilters: boolean
  onScope: (value: ScopeFilter) => void
  onKind: (value: KindFilter) => void
  onCategory: (value: string) => void
  onQuery: (value: string) => void
  onClear: () => void
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
      {/* Handoff §8 — có bộ lọc thì phải có đường xoá bộ lọc, và nó chỉ hiện
          khi thật sự có gì để xoá: một nút luôn hiện mà không làm gì là một nút
          người dùng học được cách bỏ qua. */}
      {hasFilters && (
        <Button size="sm" variant="ghost" onClick={onClear}>{pick('Xoá bộ lọc', 'Clear filters')}</Button>
      )}
    </div>
  )
}
