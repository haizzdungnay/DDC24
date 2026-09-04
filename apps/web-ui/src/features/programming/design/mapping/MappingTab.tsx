import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useAuth, roleAtLeast } from '../../../auth'
import { useProgrammingPointCatalog } from '../../api/queries'
import type { ProgrammingDraftDocument, ProgrammingDraftOperation } from '../../model/types'
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
import { buildMappingVariableRows, buildPointRows, equipmentOptions, matchesEquipment, rankPointRows, type CatalogTruthState } from './mappingViewModel'

type PointCategoryFilter = 'ALL' | 'LOCAL' | 'VP' | 'MB_RTU'
type DirectionFilter = 'ALL' | 'INPUT' | 'OUTPUT' | 'INOUT'

/** PGM-03 Phase 1A: read-only workbench. Map/Remove remain disabled until
 * capability, quality, replay and pagination gates are closed. */
export function MappingTab(props: {
  draft?: ProgrammingDraftDocument
  document: ProgrammingDraftDocument
  saving: boolean
  onSave: (operations: ProgrammingDraftOperation[]) => Promise<boolean>
  projectId?: string
  saveError?: string | null
  active?: boolean
  forceReadOnly?: boolean
  onOpenSource?: (programId: string) => void
}) {
  const { draft, document, saving, onSave, projectId, saveError, active = true, forceReadOnly = false, onOpenSource } = props
  const { pick } = useI18n()
  const { session } = useAuth()
  const canEdit = roleAtLeast(session?.role, 'admin') && !forceReadOnly
  const catalog = useProgrammingPointCatalog()
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
    complete: catalog.data?.nextCursor ? false : true,
  }), [catalog.data?.nextCursor, catalog.lastSuccessAt, catalog.status])
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

  const normalized = query.trim().toLocaleLowerCase()
  const visibleVariables = variableRows.filter((row) => {
    const queryMatch = !normalized || `${row.name} ${row.programName} ${row.type} ${row.pointName ?? ''} ${row.point?.category ?? ''} ${row.point?.pointId ?? ''}`.toLocaleLowerCase().includes(normalized)
    const programMatch = programFilter === 'ALL' || row.programId === programFilter
    return queryMatch && programMatch && (direction === 'ALL' || row.direction === direction) && (dataType === 'ALL' || row.type === dataType)
  })
  const equipmentChoices = useMemo(() => equipmentOptions(pointRows), [pointRows])
  /* Thiết bị đang lọc biến mất khỏi catalog (đổi cấu hình, đổi trang) ⇒ trở về
   * "Tất cả". Giữ một bộ lọc trỏ vào thứ không còn tồn tại sẽ cho một danh sách
   * rỗng mà không nói vì sao. */
  useEffect(() => {
    if (equipment !== 'ALL' && !equipmentChoices.includes(equipment)) setEquipment('ALL')
  }, [equipment, equipmentChoices])

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
  })

  const mapped = variableRows.filter((row) => row.bindingStatus === 'MAPPED').length
  const unmapped = variableRows.filter((row) => row.bindingStatus === 'UNMAPPED').length
  const review = variableRows.length - mapped - unmapped
  const openSource = (programId: string) => {
    if (onOpenSource) return onOpenSource(programId)
    if (projectId) globalThis.history.pushState({}, '', `/eng/programming/projects/${projectId}/design?tab=programs&program=${encodeURIComponent(programId)}`)
  }

  if (!active) return null

  return (
    <div className="space-y-3">
      <h3 className="sr-only">{pick('Ánh xạ Biến ↔ Điểm', 'Variable ↔ point mapping')}</h3>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border-l-4 border-l-[var(--c-accent)] bg-[var(--c-surface-2)] px-4 py-3">
      <div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--c-accent)]">PGM-03 · Mapping Workbench</p><p className="mt-1 text-sm font-semibold text-[var(--c-text)]">Variable ↔ Point authority view</p><p className="mt-1 text-xs text-[var(--c-text-dim)]">Phase 1A chỉ đọc · Map/Remove chờ capability, quality, replay và pagination gates.</p></div>
      <div className="text-right text-xs text-[var(--c-text-dim)]"><span className="block font-mono text-[var(--c-text)]">{document.library.profile} / {document.library.version}</span><span>{saving ? 'Workspace đang lưu ở tab khác' : canEdit ? 'Admin · mutation đang khóa' : 'Viewer · read-only'}</span></div>
    </div>
    {saveError && <p role="alert" className="rounded-[var(--radius)] border border-[var(--c-fault)] bg-[var(--c-fault-bg)] p-3 text-sm text-[var(--c-fault-fg)]">{saveError}</p>}
    <MappingToolbar query={query} onQueryChange={setQuery} programFilter={programFilter} programs={programs} onProgramFilterChange={setProgramFilter} category={category} onCategoryChange={setCategory} truth={truth} error={catalog.error} direction={direction} onDirectionChange={setDirection} dataType={dataType} dataTypes={[...new Set([...variableRows.map((row) => row.type), ...pointRows.map((row) => row.dataType)])].sort()} onDataTypeChange={setDataType} counts={{ variables: variableRows.length, mapped, unmapped, review, catalog: catalog.data?.items.length ?? 0 }} equipment={equipment} equipmentOptions={equipmentChoices} onEquipmentChange={setEquipment} suggestionsEnabled={suggestionsEnabled} suggestionsActive={suggestionsActive && suggestionsEnabled} suggestionsBlockedReason={suggestionsBlockedReason} onToggleSuggestions={() => setSuggestionsActive((value) => !value)} />
    <div className="grid items-start gap-3 2xl:items-stretch 2xl:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]">
      <VariableWorklist rows={visibleVariables} selectedId={selectedVariableId} onSelect={setSelectedVariableId} onOpenSource={(row) => openSource(row.programId)} mutationsBlocked={true} />
      <PointCatalogPane rows={visiblePoints} selectedKey={selectedPointKey} onSelect={setSelectedPointKey} pointKind={pointKind} onPointKindChange={setPointKind} />
    </div>
    <div className="grid items-stretch gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]"><AssignedMappingsTable rows={visibleVariables} onSelect={setSelectedVariableId} /><MappingInspector row={selectedVariable} /></div>
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
        <PublishedSignalsPanel draft={draft ?? document} saving={saving} onSave={onSave} forceReadOnly={forceReadOnly} />
      </Suspense>
    </div>
  </div>
  )
}
