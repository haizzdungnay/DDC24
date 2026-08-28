import { useEffect, useMemo, useState } from 'react'
import { useAuth, roleAtLeast } from '../../../auth'
import { useProgrammingPointCatalog } from '../../api/queries'
import type { ProgrammingDraftDocument, ProgrammingDraftOperation } from '../../model/types'
import { AssignedMappingsTable } from './AssignedMappingsTable'
import { MappingInspector } from './MappingInspector'
import { MappingToolbar } from './MappingToolbar'
import { PointCatalogPane } from './PointCatalogPane'
import { PublishedSignalsPanel } from './PublishedSignalsPanel'
import { useI18n } from '../../../../shared/i18n'
import { VariableWorklist } from './VariableWorklist'
import { buildMappingVariableRows, buildPointRows, rankPointRows, type CatalogTruthState } from './mappingViewModel'

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
  const [selectedVariableId, setSelectedVariableId] = useState<string | null>(null)
  const [selectedPointKey, setSelectedPointKey] = useState<string | null>(null)

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

  useEffect(() => {
    if (!selectedPointKey || !pointRows.some((row) => row.key === selectedPointKey)) setSelectedPointKey(pointRows[0]?.key ?? null)
  }, [pointRows, selectedPointKey])

  const normalized = query.trim().toLocaleLowerCase()
  const visibleVariables = variableRows.filter((row) => {
    const queryMatch = !normalized || `${row.name} ${row.programName} ${row.type} ${row.pointName ?? ''} ${row.point?.category ?? ''} ${row.point?.pointId ?? ''}`.toLocaleLowerCase().includes(normalized)
    const programMatch = programFilter === 'ALL' || row.programId === programFilter
    return queryMatch && programMatch && (direction === 'ALL' || row.direction === direction) && (dataType === 'ALL' || row.type === dataType)
  })
  const visiblePoints = pointRows.filter((row) => {
    const queryMatch = !normalized || `${row.name} ${row.category} ${row.deviceId ?? ''} ${row.pointId} ${row.dataType}`.toLocaleLowerCase().includes(normalized)
    return queryMatch && (category === 'ALL' || row.category === category) && (dataType === 'ALL' || row.dataType === dataType)
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
      <div className="rounded-[var(--radius)] border border-[var(--c-border)] p-3">
        <PublishedSignalsPanel draft={draft ?? document} saving={saving} onSave={onSave} forceReadOnly={forceReadOnly} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border-l-4 border-l-[var(--c-accent)] bg-[var(--c-surface-2)] px-4 py-3">
      <div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--c-accent)]">PGM-03 · Mapping Workbench</p><p className="mt-1 text-sm font-semibold text-[var(--c-text)]">Variable ↔ Point authority view</p><p className="mt-1 text-xs text-[var(--c-text-dim)]">Phase 1A chỉ đọc · Map/Remove chờ capability, quality, replay và pagination gates.</p></div>
      <div className="text-right text-xs text-[var(--c-text-dim)]"><span className="block font-mono text-[var(--c-text)]">{document.library.profile} / {document.library.version}</span><span>{saving ? 'Workspace đang lưu ở tab khác' : canEdit ? 'Admin · mutation đang khóa' : 'Viewer · read-only'}</span></div>
    </div>
    {saveError && <p role="alert" className="rounded-[var(--radius)] border border-[var(--c-fault)] bg-[var(--c-fault-bg)] p-3 text-sm text-[var(--c-fault-fg)]">{saveError}</p>}
    <MappingToolbar query={query} onQueryChange={setQuery} programFilter={programFilter} programs={programs} onProgramFilterChange={setProgramFilter} category={category} onCategoryChange={setCategory} truth={truth} error={catalog.error} direction={direction} onDirectionChange={setDirection} dataType={dataType} dataTypes={[...new Set([...variableRows.map((row) => row.type), ...pointRows.map((row) => row.dataType)])].sort()} onDataTypeChange={setDataType} counts={{ variables: variableRows.length, mapped, unmapped, review, catalog: catalog.data?.items.length ?? 0 }} />
    <div className="grid items-start gap-3 2xl:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]">
      <VariableWorklist rows={visibleVariables} selectedId={selectedVariableId} onSelect={setSelectedVariableId} onOpenSource={(row) => openSource(row.programId)} mutationsBlocked={true} />
      <PointCatalogPane rows={visiblePoints} selectedKey={selectedPointKey} onSelect={setSelectedPointKey} category={category} onCategoryChange={setCategory} />
    </div>
    <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]"><AssignedMappingsTable rows={visibleVariables} onSelect={setSelectedVariableId} /><MappingInspector row={selectedVariable} /></div>
  </div>
  )
}
