import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useProgrammingPointCatalog, useProgrammingSignalDependencies } from '../../api/queries'
import { useProgrammingActionAllowed } from '../../api/authorization'
import { useProgrammingApiClient } from '../../api/authClient'
import { ProgrammingApiError, ProgrammingNoResponseError, type ProgrammingBindingCandidate, type ProgrammingBindingPreview } from '../../api/generated/client'
import { createUuid } from '../../../../shared/crypto'
import { Modal } from '../../../../shared/components/Modal'
import type { ProgrammingDraftDocument, ProgrammingDraftOperation, ProgrammingProject } from '../../model/types'
import { draftSignals, isDraftV2 } from '../../model/signals'
import { AssignedMappingsTable } from './AssignedMappingsTable'
import { MappingInspector } from './MappingInspector'
import { MappingToolbar } from './MappingToolbar'
import { PointCatalogPane, type PointKindFilter } from './PointCatalogPane'
import { pointSourceKind } from './pointSourceLabels'
/* Nạp trễ: panel này chỉ cần khi người dùng ở tab Ánh xạ, còn `programming` là
 * chunk vào đầu tiên và có ngân sách gzip R3 do `pgm02_workspace_v1.json` ghim
 * (`verify_programming_bundle_budget.py`). Gắn tĩnh làm chunk đó vượt ngân sách
 * 3.24 KiB; nâng ngân sách là quyết định sản phẩm, không phải sửa nhanh trong
 * một PR, nên tách chunk là cách đúng — và nó giảm thật số byte tải lúc vào. */
const PublishedSignalsPanel = lazy(() =>
  import('./PublishedSignalsPanel').then((module) => ({ default: module.PublishedSignalsPanel }))
)
import { useI18n } from '../../../../shared/i18n'
import { boardChannelConfirmed, fetchSystemCapabilities, type SystemCapabilities } from '../../../../shared/api/capabilities'
import { VariableWorklist } from './VariableWorklist'
import { boundPointKeys, buildMappingVariableRows, buildPointRows, equipmentOptions, matchesAccess, matchesEquipment, matchesPointStatus, matchesVariableStatus, rankPointRows, type AccessFilter, type CatalogTruthState, type MappingPointRow, type MappingVariableRow, type StatusFilter } from './mappingViewModel'
import { bindingPreviewDecision, type BindingPreviewDecision } from './bindingPreviewModel'

type PointCategoryFilter = 'ALL' | 'LOCAL' | 'VP' | 'MB_RTU'
type DirectionFilter = 'ALL' | 'INPUT' | 'OUTPUT' | 'INOUT'

type MappingMutationPhase = 'previewing' | 'review' | 'saving' | 'reading' | 'done' | 'error' | 'mismatch'
interface MappingMutation {
  requestId: string
  kind: 'assign' | 'remove'
  row: MappingVariableRow
  point?: MappingPointRow
  candidate?: ProgrammingBindingCandidate
  decision?: BindingPreviewDecision
  phase: MappingMutationPhase
  message?: string
}

const BINDING_DATA_TYPES = new Set<ProgrammingBindingCandidate['dataType']>(['BOOL', 'INT', 'DINT', 'UINT', 'REAL', 'TIME'])

/** PGM-03: xem trước server-authoritative rồi mới ghi Assign/Change/Remove vào Draft. */
export function MappingTab(props: {
  draft?: ProgrammingDraftDocument
  document: ProgrammingDraftDocument
  saving: boolean
  onSave: (operations: ProgrammingDraftOperation[]) => Promise<boolean>
  projectId?: string
  project?: ProgrammingProject
  saveError?: string | null
  active?: boolean
  forceReadOnly?: boolean
  onOpenSource?: (programId: string) => void
}) {
  const { draft, document, saving, onSave, projectId, project, saveError, active = true, forceReadOnly = false, onOpenSource } = props
  const { pick } = useI18n()
  const canEdit = useProgrammingActionAllowed('mapping') && !forceReadOnly
  const client = useProgrammingApiClient()
  const catalog = useProgrammingPointCatalog(active, projectId)
  const signalDocument = draft ?? document
  const hasPublishedSignals = isDraftV2(signalDocument) && draftSignals(signalDocument).length > 0
  const signalDependencies = useProgrammingSignalDependencies(projectId, active && hasPublishedSignals, project?.etag)
  const [query, setQuery] = useState('')
  const [programFilter, setProgramFilter] = useState('ALL')
  const [category, setCategory] = useState<PointCategoryFilter>('ALL')
  const [direction, setDirection] = useState<DirectionFilter>('ALL')
  const [dataType, setDataType] = useState('ALL')
  const [pointKind, setPointKind] = useState<PointKindFilter>('ALL')
  const [selectedVariableId, setSelectedVariableId] = useState<string | null>(null)
  const [selectedPointKey, setSelectedPointKey] = useState<string | null>(null)
  const [suggestionsActive, setSuggestionsActive] = useState(false)
  const [equipment, setEquipment] = useState('ALL')
  /* `ISS-PIO-10` — hai bộ lọc đề bài §28 đòi mà toolbar chưa có. */
  const [access, setAccess] = useState<AccessFilter>('ALL')
  const [status, setStatus] = useState<StatusFilter>('ALL')
  const [mutation, setMutation] = useState<MappingMutation | null>(null)

  const programs = useMemo(() => {
    const map = new Map<string, string>()
    for (const prog of document.programs) {
      if (prog.programId && !map.has(prog.programId)) {
        map.set(prog.programId, prog.name)
      }
    }
    return Array.from(map.entries())
      .map(([programId, name]) => ({ programId, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [document.programs])

  useEffect(() => {
    if (programFilter !== 'ALL' && !programs.some((p) => p.programId === programFilter)) {
      setProgramFilter('ALL')
    }
  }, [programFilter, programs])

  /* `ISS-PIO-13`: "capability authority" mà tooltip nút Gợi ý chờ suốt Phase 1A.
   * `null` = chưa đọc được, và ở trạng thái đó nút vẫn KHÓA — gợi ý một Point
   * nằm trên kênh không ai xác nhận là mời người dùng đấu dây vào chỗ có thể
   * không tồn tại. */
  const [capabilities, setCapabilities] = useState<SystemCapabilities | null>(null)
  useEffect(() => {
    let alive = true
    fetchSystemCapabilities()
      .then((doc) => {
        if (alive) setCapabilities(doc)
      })
      .catch(() => {
        if (alive) setCapabilities(null)
      })
    return () => {
      alive = false
    }
  }, [])

  const truth = useMemo<CatalogTruthState>(() => ({
    status: catalog.status,
    lastSuccessAt: catalog.lastSuccessAt,
    complete: catalog.complete ?? (catalog.status === 'ready' && !catalog.data?.nextCursor),
  }), [catalog.complete, catalog.data?.nextCursor, catalog.lastSuccessAt, catalog.status])
  const variableRows = useMemo(() => buildMappingVariableRows(document, catalog.data?.items ?? [], truth), [catalog.data?.items, document, truth])

  useEffect(() => {
    if (!selectedVariableId || !variableRows.some((row) => row.id === selectedVariableId)) setSelectedVariableId(variableRows[0]?.id ?? null)
  }, [selectedVariableId, variableRows])

  const selectedVariable = variableRows.find((row) => row.id === selectedVariableId) ?? null
  const pointRows = useMemo(() => {
    const rows = buildPointRows(catalog.data?.items ?? [], selectedVariable ?? undefined, truth)
    return selectedVariable ? rankPointRows(rows, selectedVariable) : rows
  }, [catalog.data?.items, selectedVariable, truth])

  /* Gợi ý = "chỉ hiện ứng viên đáng bấm". Hai điều kiện, và điều kiện thứ hai
   * chính là lý do tính năng này phải chờ capability:
   *   1. Tương thích với biến đang chọn (hướng + kiểu dữ liệu).
   *   2. Nếu là kênh trên bo thì bo phải XÁC NHẬN kênh đó có thật. Point ảo và
   *      điểm Modbus của thiết bị ngoài không thuộc thẩm quyền `BOARD_CAP_MAP`
   *      nên không bị lọc — `boardChannelConfirmed` trả `null` cho chúng. */
  const suggestionsEnabled = capabilities !== null && selectedVariable !== null
  const suggestionsBlockedReason = capabilities === null
    ? pick('Chưa đọc được /system/capabilities nên chưa biết bo có kênh nào — gợi ý sẽ chỉ là phỏng đoán', 'Cannot read /system/capabilities yet, so the board channels are unknown — suggestions would be guesswork')
    : pick('Chọn một biến trước để có gì mà gợi ý', 'Select a variable first so there is something to suggest')
  const suggestedPointRows = useMemo(() => pointRows.filter((row) => {
    if (!row.compatible) return false
    return boardChannelConfirmed(capabilities, row.pointId) !== false
  }), [capabilities, pointRows])

  useEffect(() => {
    if (!selectedPointKey || !pointRows.some((row) => row.key === selectedPointKey)) setSelectedPointKey(pointRows[0]?.key ?? null)
  }, [pointRows, selectedPointKey])
  const selectedPoint = pointRows.find((row) => row.key === selectedPointKey) ?? null

  const normalized = query.trim().toLocaleLowerCase()
  const visibleVariables = variableRows.filter((row) => {
    const queryMatch = !normalized || `${row.name} ${row.programName} ${row.type} ${row.pointName ?? ''} ${row.point?.category ?? ''} ${row.point?.pointId ?? ''}`.toLocaleLowerCase().includes(normalized)
    const programMatch = programFilter === 'ALL' || row.programId === programFilter
    return queryMatch && programMatch && (direction === 'ALL' || row.direction === direction) && (dataType === 'ALL' || row.type === dataType) && matchesVariableStatus(row, status)
  })
  const equipmentChoices = useMemo(() => equipmentOptions(pointRows), [pointRows])
  /* Thiết bị đang lọc biến mất khỏi catalog (đổi cấu hình, đổi trang) ⇒ trở về
   * "Tất cả". Giữ một bộ lọc trỏ vào thứ không còn tồn tại sẽ cho một danh sách
   * rỗng mà không nói vì sao. */
  useEffect(() => {
    if (equipment !== 'ALL' && !equipmentChoices.includes(equipment)) setEquipment('ALL')
  }, [equipment, equipmentChoices])

  /* `ISS-PIO-10` — "chưa map" ở phía Point là "chưa binding nào trỏ tới", tính
   * từ CHÍNH `variableRows` (nguồn của worklist) chứ không tính lại từ document:
   * hai đường tính sẽ lệch nhau ngay lần đầu ai đó đổi cách dựng binding. */
  const boundKeys = useMemo(() => boundPointKeys(variableRows), [variableRows])

  const visiblePoints = (suggestionsActive && suggestionsEnabled ? suggestedPointRows : pointRows).filter((row) => {
    if (!matchesEquipment(row, equipment)) return false
    /* ISS-PIO-09 — tìm được bằng CHÍNH thứ đang hiện trên hàng: `MB-014`,
     * `CK508-04`, `HR 102 · FC03`. Bỏ chúng khỏi chuỗi tìm nghĩa là bày ra một
     * định danh rồi từ chối tìm theo nó. */
    const queryMatch = !normalized || `${row.name} ${row.category} ${row.deviceId ?? ''} ${row.pointId} ${row.dataType} ${row.displayId ?? ''} ${row.deviceLabel ?? ''} ${row.sourceDetail ?? ''}`.toLocaleLowerCase().includes(normalized)
    /* Dùng CHUNG hàm với `PointCatalogPane`: bộ lọc và nhãn trên hàng phải nói
     * cùng một thứ, nếu không người dùng bấm `UO` rồi thấy hàng ghi `UI`. */
    const kind = pointSourceKind(row)
    return queryMatch && (category === 'ALL' || row.category === category) && (pointKind === 'ALL' || kind === pointKind) && (dataType === 'ALL' || row.dataType === dataType)
      && matchesAccess(row, access) && matchesPointStatus(row, status, boundKeys)
  })

  /* `ISS-PGM03-05` — "không có kết quả" phải kể ra ĐIỀU KIỆN đang áp. Hai câu
   * tách riêng vì hai danh sách không chịu cùng tập bộ lọc: `Loại Point`,
   * `Thiết bị` và `Quyền` không lọc biến, còn `Chương trình` không lọc Point.
   * Gộp một câu chung sẽ đổ cho người dùng một bộ lọc họ không hề áp lên danh
   * sách đang rỗng. */
  const variableFilterSummary = [
    ...(normalized ? [`${pick('Tìm kiếm', 'Search')}: “${query.trim()}”`] : []),
    ...(programFilter !== 'ALL' ? [`${pick('Chương trình', 'Program')}: ${programs.find((program) => program.programId === programFilter)?.name ?? programFilter}`] : []),
    ...(direction !== 'ALL' ? [`${pick('Hướng', 'Direction')}: ${direction}`] : []),
    ...(dataType !== 'ALL' ? [`${pick('Kiểu', 'Type')}: ${dataType}`] : []),
    ...(status !== 'ALL' ? [`${pick('Trạng thái', 'Status')}: ${status}`] : []),
  ].join(' · ')
  const pointFilterSummary = [
    ...(normalized ? [`${pick('Tìm kiếm', 'Search')}: “${query.trim()}”`] : []),
    ...(category !== 'ALL' ? [`${pick('Loại Point', 'Point Category')}: ${category}`] : []),
    ...(pointKind !== 'ALL' ? [`${pick('Phân loại Point', 'Point category')}: ${pointKind}`] : []),
    ...(dataType !== 'ALL' ? [`${pick('Kiểu', 'Type')}: ${dataType}`] : []),
    ...(equipment !== 'ALL' ? [`${pick('Thiết bị', 'Equipment')}: ${equipment}`] : []),
    ...(access !== 'ALL' ? [`${pick('Quyền', 'Access')}: ${access}`] : []),
    ...(status !== 'ALL' ? [`${pick('Trạng thái', 'Status')}: ${status}`] : []),
    ...(suggestionsActive && suggestionsEnabled ? [pick('Gợi ý: Bật', 'Suggestions: On')] : []),
  ].join(' · ')

  const mapped = variableRows.filter((row) => row.bindingStatus === 'MAPPED').length
  const unmapped = variableRows.filter((row) => row.bindingStatus === 'UNMAPPED').length
  const review = variableRows.length - mapped - unmapped
  const mutationReady = Boolean(
    projectId && project?.draft && selectedPoint && selectedPoint.compatible &&
    truth.status === 'ready' && truth.complete === true && !saving,
  )

  function mutationError(reason: unknown): string {
    if (reason instanceof ProgrammingApiError && reason.status === 403) {
      return pick('Quyền sửa Programming đã bị thu hồi. Nội dung Draft vẫn giữ ở chế độ chỉ đọc.', 'Programming edit permission was revoked. The Draft remains available read-only.')
    }
    if (reason instanceof ProgrammingApiError && reason.status === 409) {
      return pick('Draft đã thay đổi ở phiên khác. Tải lại Draft trước khi thử lại; thao tác không được tự phát lại.', 'The Draft changed in another session. Reload it before trying again; the action was not replayed.')
    }
    if (reason instanceof ProgrammingNoResponseError) {
      return pick('Không nhận được phản hồi xem trước. Kết quả chưa xác định và thao tác không được tự phát lại.', 'No preview response was received. The result is unknown and the action was not replayed.')
    }
    return pick('Không xem trước được ánh xạ. Không có thay đổi nào được ghi.', 'Could not preview the mapping. No change was written.')
  }

  async function beginAssign(row: MappingVariableRow) {
    if (!canEdit || !projectId || !project?.draft || !selectedPoint || !mutationReady) return
    if (!BINDING_DATA_TYPES.has(row.type as ProgrammingBindingCandidate['dataType'])) {
      setMutation({ requestId: createUuid(), kind: 'assign', row, point: selectedPoint, phase: 'error', message: pick('Kiểu dữ liệu của biến chưa được hợp đồng Binding hỗ trợ.', 'The variable data type is not supported by the Binding contract.') })
      return
    }
    const existing = document.bindings.find((binding) => binding.variableId === row.id)
    const candidate: ProgrammingBindingCandidate = {
      bindingId: existing?.bindingId ?? createUuid(),
      variableId: row.id,
      point: {
        category: selectedPoint.category,
        pointId: selectedPoint.pointId,
        ...(selectedPoint.deviceId ? { deviceId: selectedPoint.deviceId } : {}),
      },
      direction: row.direction === 'OUTPUT' ? 'WRITE' : 'READ',
      dataType: row.type as ProgrammingBindingCandidate['dataType'],
      ...(existing?.unit ?? selectedPoint.unit ? { unit: existing?.unit ?? selectedPoint.unit } : {}),
      writable: selectedPoint.writable,
      qualityPolicy: existing?.qualityPolicy ?? 'REQUIRE_GOOD',
    }
    const requestId = createUuid()
    setMutation({ requestId, kind: 'assign', row, point: selectedPoint, candidate, phase: 'previewing' })
    try {
      const preview = await client.request<ProgrammingBindingPreview, { schemaVersion: '1.0'; baseRevisionId: string; binding: ProgrammingBindingCandidate }>('previewProgrammingBinding', {
        path: { projectId },
        body: { schemaVersion: '1.0', baseRevisionId: project.baseRevisionId, binding: candidate },
        ifMatch: project.etag,
        correlationId: createUuid(),
      })
      const decision = bindingPreviewDecision(preview, {
        projectId,
        draftRevisionId: project.draftRevisionId,
        baseRevisionId: project.baseRevisionId,
        etag: project.etag,
      })
      setMutation((current) => current?.requestId === requestId
        ? { ...current, phase: 'review', decision }
        : current)
    } catch (reason) {
      setMutation((current) => current?.requestId === requestId
        ? { ...current, phase: 'error', message: mutationError(reason) }
        : current)
    }
  }

  function beginRemove(row: MappingVariableRow) {
    if (!canEdit || !projectId || !project?.draft || saving || !row.bindingId) return
    setMutation({ requestId: createUuid(), kind: 'remove', row, phase: 'review' })
  }

  async function confirmMutation() {
    if (!canEdit || !mutation || mutation.phase !== 'review') return
    if (mutation.kind === 'assign' && (!mutation.candidate || !mutation.decision?.assignable)) return
    const requestId = mutation.requestId
    setMutation((current) => current?.requestId === requestId ? { ...current, phase: 'saving' } : current)
    const operation: ProgrammingDraftOperation = mutation.kind === 'assign'
      ? { op: 'upsertBinding', binding: mutation.candidate! }
      : { op: 'removeBinding', bindingId: mutation.row.bindingId! }
    const saved = await onSave([operation])
    setMutation((current) => current?.requestId !== requestId ? current : saved
      ? { ...current, phase: 'reading' }
      : { ...current, phase: 'error', message: pick('Máy chủ không xác nhận thay đổi Draft. Lựa chọn vẫn được giữ để bạn kiểm tra và thử lại.', 'The server did not confirm the Draft change. Your selection is preserved for review and retry.') })
  }

  useEffect(() => {
    if (!mutation || mutation.phase !== 'reading') return undefined
    const readBackMatches = mutation.kind === 'assign'
      ? document.bindings.some((binding) => binding.bindingId === mutation.candidate?.bindingId
          && binding.variableId === mutation.candidate.variableId
          && binding.point.category === mutation.candidate.point.category
          && binding.point.pointId === mutation.candidate.point.pointId
          && (binding.point.deviceId ?? '') === (mutation.candidate.point.deviceId ?? '')
          && binding.direction === mutation.candidate.direction
          && binding.dataType === mutation.candidate.dataType
          && (binding.unit ?? '') === (mutation.candidate.unit ?? '')
          && binding.writable === mutation.candidate.writable
          && binding.qualityPolicy === mutation.candidate.qualityPolicy)
      : !document.bindings.some((binding) => binding.bindingId === mutation.row.bindingId)
    if (readBackMatches) {
      setMutation((current) => current?.requestId === mutation.requestId ? { ...current, phase: 'done' } : current)
      return undefined
    }
    const timer = window.setTimeout(() => {
      setMutation((current) => current?.requestId === mutation.requestId && current.phase === 'reading'
        ? { ...current, phase: 'mismatch', message: pick('Read-back Draft không khớp thay đổi đã gửi. Không giả định thao tác thành công; hãy tải lại Draft.', 'Draft read-back does not match the submitted change. Success is not assumed; reload the Draft.') }
        : current)
    }, 4000)
    return () => window.clearTimeout(timer)
  }, [document.bindings, mutation, pick])
  const openSource = (programId: string) => {
    if (onOpenSource) return onOpenSource(programId)
    if (projectId) globalThis.history.pushState({}, '', `/eng/programming/projects/${projectId}/design?tab=programs&program=${encodeURIComponent(programId)}`)
  }

  if (!active) return null

  return (
    <div className="space-y-3">
      <h3 className="sr-only">{pick('Ánh xạ Biến ↔ Điểm', 'Variable ↔ point mapping')}</h3>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border-l-4 border-l-[var(--c-accent)] bg-[var(--c-surface-2)] px-4 py-3">
      <div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--c-accent)]">PGM-03 · Mapping Workbench</p><p className="mt-1 text-sm font-semibold text-[var(--c-text)]">Variable ↔ Point authority view</p><p className="mt-1 text-xs text-[var(--c-text-dim)]">{pick('Assign/Change dùng preview của máy chủ; Remove chỉ hoàn tất sau read-back Draft.', 'Assign/Change use the server preview; Remove completes only after Draft read-back.')}</p></div>
      <div className="text-right text-xs text-[var(--c-text-dim)]"><span className="block font-mono text-[var(--c-text)]">{document.library.profile} / {document.library.version}</span><span>{saving ? pick('Workspace đang lưu ở tab khác', 'The workspace is saving in another tab') : !canEdit ? pick('Chỉ đọc', 'Read only') : mutationReady ? pick('Sẵn sàng xem trước', 'Ready for preview') : pick('Chọn biến và Point hợp lệ', 'Select a valid variable and Point')}</span></div>
    </div>
    {saveError && <p role="alert" className="rounded-[var(--radius)] border border-[var(--c-fault)] bg-[var(--c-fault-bg)] p-3 text-sm text-[var(--c-fault-fg)]">{saveError}</p>}
    <MappingToolbar query={query} onQueryChange={setQuery} programFilter={programFilter} programs={programs} onProgramFilterChange={setProgramFilter} category={category} onCategoryChange={setCategory} truth={truth} error={catalog.error} canRetry={catalog.canRetry} onRetry={catalog.retry} onRestart={catalog.restart} direction={direction} onDirectionChange={setDirection} dataType={dataType} dataTypes={[...new Set([...variableRows.map((row) => row.type), ...pointRows.map((row) => row.dataType)])].sort()} onDataTypeChange={setDataType} access={access} onAccessChange={setAccess} status={status} onStatusChange={setStatus} counts={{ variables: variableRows.length, mapped, unmapped, review, catalog: catalog.data?.items.length ?? 0 }} equipment={equipment} equipmentOptions={equipmentChoices} onEquipmentChange={setEquipment} suggestionsEnabled={suggestionsEnabled} suggestionsActive={suggestionsActive && suggestionsEnabled} suggestionsBlockedReason={suggestionsBlockedReason} onToggleSuggestions={() => setSuggestionsActive((value) => !value)} />
    <div className="grid items-start gap-3 2xl:items-stretch 2xl:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]">
      <VariableWorklist rows={visibleVariables} selectedId={selectedVariableId} onSelect={setSelectedVariableId} onOpenSource={(row) => openSource(row.programId)} canMutate={canEdit} mutationDisabled={!mutationReady} onMap={(row) => void beginAssign(row)} filterSummary={variableFilterSummary} />
      <PointCatalogPane rows={visiblePoints} selectedKey={selectedPointKey} onSelect={setSelectedPointKey} pointKind={pointKind} onPointKindChange={setPointKind} filterSummary={pointFilterSummary} />
    </div>
    <div className="grid items-stretch gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]"><AssignedMappingsTable rows={visibleVariables} onSelect={setSelectedVariableId} canMutate={canEdit} mutationDisabled={!mutationReady} onChange={(row) => void beginAssign(row)} onRemove={beginRemove} /><MappingInspector row={selectedVariable} /></div>
    {/* `UX-REQ-007` — Published Signal là bề mặt authoring DUY NHẤT của
      * `upsertSignal`/`removeSignal`; không có panel này thì Draft v2 không còn
      * đường khai signal nào từ UI. Bố cục workbench đẩy nó xuống cuối để
      * worklist và catalog giữ được chiều cao cuộn riêng, nhưng panel vẫn phải
      * mount và hiện rõ — `e2e/programming-real.spec.ts` (F-P59-UI-001) bấm
      * thẳng nút "Khai Published Signal" trên chính route Mapping này.
      *
      * Panel này đã bị gỡ hai lần (một lần sửa ở `#347`), lần sau còn ĐẢO LUÔN
      * hai assertion đơn vị thành "không được mount", nên chỉ E2E còn kêu. Nếu
      * có ngày thật sự muốn bỏ bề mặt này thì phải sửa `UX-REQ-007` và hợp đồng
      * E2E TRƯỚC, không phải sửa test cho khớp hiện trạng. */}
    <div className="rounded-[var(--radius)] border border-[var(--c-border)] p-3">
      <Suspense fallback={<p role="status" className="text-sm text-[var(--c-text-dim)]">{pick('Đang tải bảng Published Signal…', 'Loading the published signals panel…')}</p>}>
        <PublishedSignalsPanel draft={draft ?? document} saving={saving} onSave={onSave}
          forceReadOnly={forceReadOnly} dependencies={signalDependencies} projectId={projectId} />
      </Suspense>
    </div>
    <Modal
      open={mutation !== null}
      title={mutation?.kind === 'remove' ? pick('Xác nhận gỡ ánh xạ', 'Confirm mapping removal') : pick('Xem trước ánh xạ', 'Mapping preview')}
      confirmLabel={mutation?.kind === 'remove' ? pick('Gỡ ánh xạ', 'Remove mapping') : pick('Ghi vào Draft', 'Write to Draft')}
      danger={mutation?.kind === 'remove'}
      confirmLoading={mutation?.phase === 'previewing' || mutation?.phase === 'saving' || mutation?.phase === 'reading'}
      confirmDisabled={!canEdit || !mutation || mutation.phase !== 'review' || (mutation.kind === 'assign' && !mutation.decision?.assignable)}
      onConfirm={() => void confirmMutation()}
      onClose={() => {
        if (mutation?.phase === 'previewing' || mutation?.phase === 'saving' || mutation?.phase === 'reading') return
        setMutation(null)
      }}
    >
      {mutation && <div className="space-y-3 text-sm">
        <p><strong>{mutation.row.programName} · {mutation.row.name}</strong></p>
        {mutation.kind === 'assign' && mutation.point && <p className="font-mono text-xs">{mutation.point.category}:{mutation.point.deviceId ? `${mutation.point.deviceId}:` : ''}{mutation.point.pointId}</p>}
        {mutation.phase === 'previewing' && <p role="status">{pick('Đang xin máy chủ xem trước ứng viên…', 'Requesting the server preview…')}</p>}
        {/* `ISS-PGM03-05` — bề mặt Review phải hiện ĐỦ blocker và warning, theo
          * severity của MÁY CHỦ. Bản trước in mọi issue cùng một kiểu, nên một
          * `WARNING` về đơn vị trông hệt một `ERROR` chặn ghi, và ngược lại:
          * người ký không đọc ra được cái nào thực sự chặn. `severity` là
          * trường trong hợp đồng (`ProgrammingBindingValidationIssue`), không
          * phải suy đoán của FE. */}
        {mutation.decision && <div role="status" className="rounded border border-[var(--c-border)] p-2">
          <strong>{mutation.decision.status}</strong>
          {mutation.decision.issues.length > 0 && <>
            <p className="mt-1 text-xs text-[var(--c-text-dim)]">
              {pick(
                `${mutation.decision.issues.filter((issue) => issue.severity === 'ERROR').length} chặn · ${mutation.decision.issues.filter((issue) => issue.severity === 'WARNING').length} cảnh báo`,
                `${mutation.decision.issues.filter((issue) => issue.severity === 'ERROR').length} blocking · ${mutation.decision.issues.filter((issue) => issue.severity === 'WARNING').length} warnings`,
              )}
            </p>
            <ul className="mt-2 space-y-1">
              {[...mutation.decision.issues]
                /* ERROR trước: thứ chặn ghi phải nằm ở chỗ mắt chạm đầu tiên,
                 * kể cả khi máy chủ trả về theo thứ tự khác. */
                .sort((left, right) => Number(right.severity === 'ERROR') - Number(left.severity === 'ERROR'))
                .map((issue, index) => <li key={`${issue.detailCode}-${index}`} className="flex flex-wrap items-center gap-1.5">
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${issue.severity === 'ERROR' ? 'border-[var(--c-fault)] bg-[var(--c-fault-bg)] text-[var(--c-fault-fg)]' : 'border-[var(--c-warn)] bg-[var(--c-warn-bg)] text-[var(--c-warn-fg)]'}`}>
                    {issue.severity === 'ERROR' ? pick('Chặn', 'Blocking') : pick('Cảnh báo', 'Warning')}
                  </span>
                  <span className="font-mono text-xs">{issue.detailCode}</span> · {issue.field}
                </li>)}
            </ul>
          </>}
          {mutation.decision.reason && <p className="mt-2 text-[var(--c-warn-fg)]">{mutation.decision.reason}</p>}
        </div>}
        {mutation.kind === 'remove' && mutation.phase === 'review' && <p>{pick('Binding chỉ bị gỡ khỏi Draft sau khi máy chủ trả read-back xác nhận.', 'The binding is removed from the Draft only after server-confirmed read-back.')}</p>}
        {mutation.phase === 'reading' && <p role="status">{pick('Đang đối chiếu read-back Draft…', 'Checking Draft read-back…')}</p>}
        {mutation.phase === 'done' && <p role="status" className="text-[var(--c-good-fg)]">{pick('Read-back xác nhận Draft đã đổi.', 'Read-back confirms the Draft changed.')}</p>}
        {(mutation.phase === 'error' || mutation.phase === 'mismatch') && <p role="alert" className="text-[var(--c-fault-fg)]">{mutation.message}</p>}
      </div>}
    </Modal>
  </div>
  )
}
