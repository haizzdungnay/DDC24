import { useMemo, useState } from 'react'
import { Link2, Plus, Trash2 } from 'lucide-react'
import { useI18n } from '../../../../shared/i18n'
import { useAuth, roleAtLeast } from '../../../auth'
import { Button } from '../../../../shared/components/Button'
import { StateBlock } from '../../../../shared/components/StateBlock'
import { useProgrammingPointCatalog } from '../../api/queries'
import type { ProgrammingDraftDocument, ProgrammingDraftOperation, ProgrammingPointCatalogEntry } from '../../model/types'

const QUALITY_BADGE: Record<string, string> = {
  GOOD: 'online',
  UNCERTAIN: 'warning',
  BAD: 'fault',
  STALE: 'stale',
  OFFLINE: 'offline',
  UNKNOWN: 'unknown'
}

/**
 * Tab "Điểm & Ánh xạ" của PGM-02 (`UJ-PROG-03`). Bảng Variable↔Point kèm
 * category/identity/type/unit/direction/writable/quality; lọc theo loại,
 * hướng và khả năng ghi (UX §5 PGM-02). `OFFLINE/STALE/UNKNOWN` giữ nguyên
 * nhãn — không bao giờ hiện `0` thay cho giá trị thiếu (UX-REQ-013).
 */
export function MappingTab({
  document,
  saving,
  onSave
}: {
  document: ProgrammingDraftDocument
  saving: boolean
  onSave: (operations: ProgrammingDraftOperation[]) => Promise<boolean>
}) {
  const { pick } = useI18n()
  const { session } = useAuth()
  const canEdit = roleAtLeast(session?.role, 'admin')
  const catalog = useProgrammingPointCatalog()
  const [showPicker, setShowPicker] = useState(false)

  const variableById = useMemo(() => new Map(document.variables.map((variable) => [variable.variableId, variable])), [document.variables])
  const pointByKey = useMemo(() => {
    const map = new Map<string, ProgrammingPointCatalogEntry>()
    for (const entry of catalog.data?.items ?? []) map.set(pointKey(entry.category, entry.pointId, entry.deviceId), entry)
    return map
  }, [catalog.data])

  return (
    <div className="space-y-3">
      {canEdit && (
        <Button size="sm" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setShowPicker(true)} disabled={document.programs.length === 0}>
          {pick('Thêm ánh xạ', 'Add mapping')}
        </Button>
      )}
      {document.programs.length === 0 && canEdit && (
        <p className="text-xs text-[var(--c-text-dim)]">{pick('Cần ít nhất một chương trình trước khi ánh xạ.', 'Create a program before mapping points.')}</p>
      )}

      {document.bindings.length === 0 ? (
        <p className="text-sm text-[var(--c-text-dim)]">{pick('Chưa có ánh xạ nào.', 'No mappings yet.')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--c-border)] text-xs uppercase text-[var(--c-text-dim)]">
                <th className="py-1.5 pr-3">{pick('Biến', 'Variable')}</th>
                <th className="py-1.5 pr-3">{pick('Điểm', 'Point')}</th>
                <th className="py-1.5 pr-3">{pick('Hướng', 'Direction')}</th>
                <th className="py-1.5 pr-3">{pick('Kiểu/Đơn vị', 'Type/Unit')}</th>
                <th className="py-1.5 pr-3">{pick('Chất lượng', 'Quality')}</th>
                {canEdit && <th className="py-1.5" />}
              </tr>
            </thead>
            <tbody>
              {document.bindings.map((binding) => {
                const variable = variableById.get(binding.variableId)
                const live = pointByKey.get(pointKey(binding.point.category, binding.point.pointId, binding.point.deviceId))
                const quality = live?.quality
                return (
                  <tr key={binding.bindingId} className="border-b border-[var(--c-border)]">
                    <td className="py-1.5 pr-3 text-[var(--c-text)]">{variable?.name ?? '—'}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs text-[var(--c-text)]">
                      {binding.point.category}:{binding.point.deviceId ? `${binding.point.deviceId}:` : ''}
                      {binding.point.pointId}
                    </td>
                    <td className="py-1.5 pr-3 text-[var(--c-text-dim)]">{binding.direction}</td>
                    <td className="py-1.5 pr-3 text-[var(--c-text-dim)]">
                      {binding.dataType}
                      {binding.unit ? ` / ${binding.unit}` : ''}
                    </td>
                    <td className="py-1.5 pr-3">
                      <span className={`text-xs font-semibold text-[var(--c-${QUALITY_BADGE[quality ?? 'UNKNOWN']}-fg,var(--c-text-dim))]`}>{quality ?? pick('Không rõ', 'Unknown')}</span>
                    </td>
                    {canEdit && (
                      <td className="py-1.5 text-right">
                        <button
                          type="button"
                          className="p-1 text-[var(--c-text-dim)] hover:text-[var(--c-fault-fg)]"
                          title={pick('Gỡ ánh xạ', 'Remove mapping')}
                          onClick={() => void onSave([{ op: 'removeBinding', bindingId: binding.bindingId }, { op: 'removeVariable', variableId: binding.variableId }])}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showPicker && (
        <PointPickerDialog
          document={document}
          catalogStatus={catalog.status}
          catalogItems={catalog.data?.items ?? []}
          saving={saving}
          onCancel={() => setShowPicker(false)}
          onSubmit={async (operations) => {
            const ok = await onSave(operations)
            if (ok) setShowPicker(false)
          }}
        />
      )}
    </div>
  )
}

function pointKey(category: string, pointId: string, deviceId?: string): string {
  return `${category}:${deviceId ?? ''}:${pointId}`
}

function PointPickerDialog({
  document,
  catalogStatus,
  catalogItems,
  saving,
  onCancel,
  onSubmit
}: {
  document: ProgrammingDraftDocument
  catalogStatus: 'loading' | 'ready' | 'error'
  catalogItems: ProgrammingPointCatalogEntry[]
  saving: boolean
  onCancel: () => void
  onSubmit: (operations: ProgrammingDraftOperation[]) => Promise<void>
}) {
  const { pick } = useI18n()
  const [programId, setProgramId] = useState(document.programs[0]?.programId ?? '')
  const [variableName, setVariableName] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | 'LOCAL' | 'VP' | 'MB_RTU'>('ALL')
  const [directionFilter, setDirectionFilter] = useState<'ALL' | 'READ' | 'WRITE' | 'READ_WRITE'>('ALL')
  const [writableOnly, setWritableOnly] = useState(false)
  const [selected, setSelected] = useState<ProgrammingPointCatalogEntry>()

  const filtered = catalogItems.filter(
    (entry) =>
      (categoryFilter === 'ALL' || entry.category === categoryFilter) &&
      (directionFilter === 'ALL' || entry.direction === directionFilter) &&
      (!writableOnly || entry.writable)
  )

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="programming-point-picker-title" className="rounded-[var(--radius)] border border-[var(--c-accent)] bg-[var(--c-surface)] p-4">
      <h3 id="programming-point-picker-title" className="text-sm font-semibold text-[var(--c-text)]">
        {pick('Thêm ánh xạ Biến ↔ Điểm', 'Add variable ↔ point mapping')}
      </h3>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="block text-xs font-medium text-[var(--c-text-dim)]">
          {pick('Chương trình', 'Program')}
          <select className="mt-1 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1.5 text-sm text-[var(--c-text)]" value={programId} onChange={(event) => setProgramId(event.target.value)}>
            {document.programs.map((program) => (
              <option key={program.programId} value={program.programId}>
                {program.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-[var(--c-text-dim)]">
          {pick('Tên biến', 'Variable name')}
          <input className="mt-1 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1.5 text-sm text-[var(--c-text)]" value={variableName} onChange={(event) => setVariableName(event.target.value)} />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-3">
        <label className="text-xs text-[var(--c-text-dim)]">
          {pick('Loại', 'Category')}{' '}
          <select className="rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-1.5 py-1 text-sm text-[var(--c-text)]" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as typeof categoryFilter)}>
            <option value="ALL">{pick('Tất cả', 'All')}</option>
            <option value="LOCAL">LOCAL</option>
            <option value="VP">VP</option>
            <option value="MB_RTU">MB_RTU</option>
          </select>
        </label>
        <label className="text-xs text-[var(--c-text-dim)]">
          {pick('Hướng', 'Direction')}{' '}
          <select className="rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-1.5 py-1 text-sm text-[var(--c-text)]" value={directionFilter} onChange={(event) => setDirectionFilter(event.target.value as typeof directionFilter)}>
            <option value="ALL">{pick('Tất cả', 'All')}</option>
            <option value="READ">READ</option>
            <option value="WRITE">WRITE</option>
            <option value="READ_WRITE">READ_WRITE</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-[var(--c-text-dim)]">
          <input type="checkbox" checked={writableOnly} onChange={(event) => setWritableOnly(event.target.checked)} />
          {pick('Chỉ ghi được', 'Writable only')}
        </label>
      </div>

      <div className="mt-3 max-h-56 overflow-y-auto rounded-[var(--radius)] border border-[var(--c-border)]">
        {catalogStatus === 'loading' ? (
          <StateBlock state="loading" title={pick('Đang tải danh mục Point…', 'Loading point catalog…')} />
        ) : catalogStatus === 'error' ? (
          <StateBlock state="error" title={pick('Không tải được danh mục Point.', 'Could not load the point catalog.')} />
        ) : filtered.length === 0 ? (
          <p className="p-3 text-sm text-[var(--c-text-dim)]">{pick('Không có Point khớp bộ lọc.', 'No point matches the filter.')}</p>
        ) : (
          <ul>
            {filtered.map((entry) => {
              const key = pointKey(entry.category, entry.pointId, entry.deviceId)
              return (
                <li key={key}>
                  <button
                    type="button"
                    aria-pressed={selected === entry}
                    className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm ${selected === entry ? 'bg-[var(--c-accent-bg)]' : 'hover:bg-[var(--c-surface-2)]'}`}
                    onClick={() => setSelected(entry)}
                  >
                    <span className="font-mono text-xs">
                      {entry.category}:{entry.deviceId ? `${entry.deviceId}:` : ''}
                      {entry.pointId}
                    </span>
                    <span className="text-[var(--c-text-dim)]">
                      {entry.dataType} · {entry.direction} · {entry.quality}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {pick('Hủy', 'Cancel')}
        </Button>
        <Button
          size="sm"
          icon={<Link2 className="h-4 w-4" aria-hidden="true" />}
          loading={saving}
          disabled={!selected || !variableName.trim() || !programId}
          onClick={() => {
            if (!selected) return
            const variableId = crypto.randomUUID()
            const bindingId = crypto.randomUUID()
            void onSubmit([
              {
                op: 'upsertVariable',
                variable: { variableId, programId, name: variableName.trim(), type: selected.dataType, class: 'LOCAL', initialValue: null, retain: false }
              },
              {
                op: 'upsertBinding',
                binding: {
                  bindingId,
                  variableId,
                  point: { category: selected.category, pointId: selected.pointId, deviceId: selected.deviceId },
                  direction: selected.direction,
                  dataType: selected.dataType,
                  unit: selected.unit,
                  writable: selected.writable,
                  qualityPolicy: 'ALLOW_UNCERTAIN'
                }
              }
            ])
          }}
        >
          {pick('Ánh xạ', 'Map')}
        </Button>
      </div>
    </div>
  )
}
