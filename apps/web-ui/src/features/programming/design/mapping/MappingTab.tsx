import { useEffect, useMemo, useState } from 'react'
import { Link2, Plus, Trash2 } from 'lucide-react'
import { useI18n } from '../../../../shared/i18n'
import { createUuid } from '../../../../shared/crypto'
import { useAuth, roleAtLeast } from '../../../auth'
import { Button } from '../../../../shared/components/Button'
import { StateBlock } from '../../../../shared/components/StateBlock'
import { useProgrammingPointCatalog } from '../../api/queries'
import { collectStInterfaceVariables } from '../editor/ProgramsTab'
import { collectFbdInterfaceVariables, type FbdDocument } from '../../fbd/model'
import type { ProgrammingDraftDocument, ProgrammingDraftOperation, ProgrammingPointCatalogEntry, ProgrammingProgram } from '../../model/types'
import { PublishedSignalsPanel } from './PublishedSignalsPanel'

interface MappableVariable { name: string; type: string; direction: 'INPUT' | 'OUTPUT' }

/** Nguồn duy nhất của tên biến khả map: đọc từ chính source đã lưu của
 *  Program (VAR_INPUT/VAR_OUTPUT cho ST, node INPUT/OUTPUT cho FBD) — không
 *  cho gõ tay, vì tên gõ tay không đối chiếu được với biến thật trong logic
 *  và im lặng tạo Variable "mồ côi" (user report 2026-08-14). */
function declaredInterfaceVariables(program: ProgrammingProgram | undefined): MappableVariable[] {
  if (!program) return []
  if (program.language === 'ST') {
    return collectStInterfaceVariables(typeof program.document === 'string' ? program.document : '')
  }
  if (typeof program.document !== 'string' || program.document.length === 0) return []
  try {
    return collectFbdInterfaceVariables(JSON.parse(program.document) as FbdDocument)
  } catch {
    return []
  }
}

/** OUTPUT chỉ ghép được Point WRITE/READ_WRITE; INPUT chỉ ghép được Point
 *  READ/READ_WRITE — Core (`PointWriter::can_write`) fail-closed từ chối ghi
 *  vào Point không phải AV/BV/MSV/EXT (Universal Input = PointKind::AI
 *  không nằm trong danh sách đó). Kiểu dữ liệu cũng phải khớp: ghi BOOL vào
 *  Point REAL không có nghĩa. Không lọc theo `writable` ở đây — checkbox
 *  "Chỉ ghi được" là lựa chọn thủ công riêng của user, không trộn với ràng
 *  buộc tự động này. */
function isCompatiblePoint(variable: MappableVariable, entry: ProgrammingPointCatalogEntry): boolean {
  const directionOk = variable.direction === 'OUTPUT'
    ? entry.direction === 'WRITE' || entry.direction === 'READ_WRITE'
    : entry.direction === 'READ' || entry.direction === 'READ_WRITE'
  return directionOk && entry.dataType === variable.type
}

/**
 * Lớp màu của cột Chất lượng.
 *
 * Bản trước ghép tên class bằng nội suy chuỗi
 * (`text-[var(--c-${QUALITY_BADGE[...]}-fg,...)]`). Hai lỗi chồng nhau nên
 * cột này CHƯA BAO GIỜ đổi màu: (1) Tailwind quét class theo VĂN BẢN NGUỒN,
 * chuỗi nội suy không bao giờ xuất hiện nguyên dạng nên không utility nào
 * được sinh — kiểm chứng trên chính CSS đang chạy ở board: `--c-online-fg`
 * xuất hiện 0 lần; (2) `--c-online-fg`/`--c-stale-fg`/`--c-unknown-fg` cũng
 * không có trong `TOKEN_NAMES`, nên kể cả có class thì biến vẫn rơi về
 * fallback. Nay là bảng tra TĨNH, viết đủ tên class và chỉ dùng token có
 * thật (`theme/tokens.ts`).
 */
const QUALITY_CLASS: Record<string, string> = {
  GOOD: 'text-[var(--c-good-fg)]',
  UNCERTAIN: 'text-[var(--c-warn-fg)]',
  BAD: 'text-[var(--c-fault-fg)]',
  STALE: 'text-[var(--c-warn-fg)]',
  OFFLINE: 'text-[var(--c-fault-fg)]',
  UNKNOWN: 'text-[var(--c-text-dim)]'
}

/**
 * Tab "Điểm & Ánh xạ" của PGM-02 (`UJ-PROG-03`). Bảng Variable↔Point kèm
 * category/identity/type/unit/direction/writable/quality; lọc theo loại,
 * hướng và khả năng ghi (UX §5 PGM-02). `OFFLINE/STALE/UNKNOWN` giữ nguyên
 * nhãn — không bao giờ hiện `0` thay cho giá trị thiếu (UX-REQ-013).
 */
export function MappingTab({
  draft,
  document,
  saving,
  onSave,
  forceReadOnly = false
}: {
  /**
   * Draft nguyên bản do server trả về. Published Signal là collection v2 và
   * không được đọc từ `document`, vì `toWorkspaceDocument()` cố ý chiếu v2 về
   * view model cũ và không mang theo `signals[]`.
   */
  draft: ProgrammingDraftDocument
  document: ProgrammingDraftDocument
  saving: boolean
  onSave: (operations: ProgrammingDraftOperation[]) => Promise<boolean>
  forceReadOnly?: boolean
}) {
  const { pick } = useI18n()
  const { session } = useAuth()
  const canEdit = roleAtLeast(session?.role, 'admin') && !forceReadOnly
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
      {/* F-UX-15: tab con phải có mốc tiêu đề riêng trong cây heading. `<h1>`
          thuộc layout của feature, `<h2>` thuộc màn hình cha, nên tab là
          `<h3>`. Ẩn thị giác vì thanh tab đã hiện tên. */}
      <h3 className="sr-only">{pick('Ánh xạ Biến ↔ Điểm', 'Variable ↔ point mapping')}</h3>
      <div className="rounded-[var(--radius)] border border-[var(--c-border)] p-3">
        <PublishedSignalsPanel draft={draft} saving={saving} onSave={onSave} forceReadOnly={forceReadOnly} />
      </div>

      <div className="border-t border-[var(--c-border)] pt-3">
        <h3 className="mb-2 text-sm font-semibold">{pick('Ánh xạ Biến ↔ Điểm', 'Variable ↔ point mapping')}</h3>
      </div>
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
        <div
          className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--c-accent)]"
          tabIndex={0}
          role="group"
          aria-label={pick('Bảng ánh xạ Biến ↔ Điểm', 'Variable ↔ point mapping table')}
        >
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
                      <span className={`text-xs font-semibold ${QUALITY_CLASS[quality ?? 'UNKNOWN'] ?? QUALITY_CLASS.UNKNOWN}`}>{quality ?? pick('Không rõ', 'Unknown')}</span>
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

      {showPicker && canEdit && (
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

  const selectedProgram = document.programs.find((program) => program.programId === programId)
  const mappedNames = useMemo(
    () => new Set(document.variables.filter((variable) => variable.programId === programId).map((variable) => variable.name)),
    [document.variables, programId]
  )
  const availableVariables = useMemo(
    () => declaredInterfaceVariables(selectedProgram).filter((variable) => !mappedNames.has(variable.name)),
    [selectedProgram, mappedNames]
  )
  const chosenVariable = availableVariables.find((variable) => variable.name === variableName)

  useEffect(() => {
    setVariableName(availableVariables[0]?.name ?? '')
  }, [availableVariables])

  /* Point không tương thích hướng/kiểu với biến đã chọn không được cho ghép —
   * đúng lỗ hổng vừa gây lỗi thật: OUTPUT (BOOL) bị map vào Point READ-only
   * kiểu REAL (LOCAL:UI-09, Universal Input — PointKind::AI ở Core, không
   * nằm trong danh sách PointWriter::can_write() cho phép ghi). st_process_
   * image.cpp gom output CẢ CHƯƠNG TRÌNH vào một batch; một binding không ghi
   * được làm preflight_outputs() từ chối TOÀN BỘ batch — output khác đúng
   * (AO/DO vật lý) cũng không bao giờ commit theo. */
  /* Hai tầng lọc TÁCH RỜI, vì chúng ẩn Point vì hai lý do khác hẳn nhau và chỉ
   * một trong hai là thứ người dùng tự chọn:
   *  - `manuallyFiltered`: Loại / Hướng / "Chỉ ghi được" — do người dùng đặt;
   *  - `filtered`: thêm ràng buộc tương thích với biến đã chọn — do hệ áp.
   * Gộp chúng làm một thì không nói được vì sao một Point biến mất. */
  const manuallyFiltered = catalogItems.filter(
    (entry) =>
      (categoryFilter === 'ALL' || entry.category === categoryFilter) &&
      (directionFilter === 'ALL' || entry.direction === directionFilter) &&
      (!writableOnly || entry.writable)
  )
  const filtered = manuallyFiltered.filter((entry) => !chosenVariable || isCompatiblePoint(chosenVariable, entry))
  /* Point bị ràng buộc tương thích loại ra, tách theo LÝ DO. Ẩn im lặng làm
   * người dùng tưởng danh mục thiếu dữ liệu — đúng câu hỏi "trang map đang
   * thiếu VP à?" mà người dùng thật đã hỏi khi 5/7 VP biến mất. */
  const hiddenWrongType = chosenVariable
    ? manuallyFiltered.filter((entry) => entry.dataType !== chosenVariable.type).length
    : 0
  const hiddenWrongDirection = chosenVariable
    ? manuallyFiltered.filter((entry) => entry.dataType === chosenVariable.type && !isCompatiblePoint(chosenVariable, entry)).length
    : 0

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
          {pick('Biến', 'Variable')}
          <select
            className="mt-1 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1.5 text-sm text-[var(--c-text)]"
            value={variableName}
            disabled={availableVariables.length === 0}
            onChange={(event) => setVariableName(event.target.value)}
          >
            {availableVariables.length === 0 && <option value="">{pick('— Không có biến —', '— No variable —')}</option>}
            {availableVariables.map((variable) => (
              <option key={variable.name} value={variable.name}>
                {variable.name} ({variable.direction === 'INPUT' ? pick('vào', 'in') : pick('ra', 'out')} · {variable.type})
              </option>
            ))}
          </select>
        </label>
        {availableVariables.length === 0 && (
          <p className="text-xs font-normal normal-case text-[var(--c-text-dim)] md:col-span-2">
            {pick(
              'Chương trình chưa khai báo VAR_INPUT/VAR_OUTPUT (hoặc INPUT/OUTPUT node ở FBD) nào chưa được ánh xạ.',
              'The program has no unmapped VAR_INPUT/VAR_OUTPUT (or FBD INPUT/OUTPUT node) declared.'
            )}
          </p>
        )}
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
          <p className="p-3 text-sm text-[var(--c-text-dim)]">
            {chosenVariable
              ? pick(
                  `Không có Point kiểu ${chosenVariable.type}, hướng ${chosenVariable.direction === 'OUTPUT' ? 'ghi được (WRITE/READ_WRITE)' : 'đọc được (READ/READ_WRITE)'} khớp bộ lọc — cần đúng loại cho biến ${chosenVariable.direction === 'OUTPUT' ? 'OUTPUT' : 'INPUT'} này.`,
                  `No ${chosenVariable.type} Point with ${chosenVariable.direction === 'OUTPUT' ? 'writable (WRITE/READ_WRITE)' : 'readable (READ/READ_WRITE)'} direction matches — required for this ${chosenVariable.direction} variable.`
                )
              : pick('Không có Point khớp bộ lọc.', 'No point matches the filter.')}
          </p>
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

      {filtered.length > 0 && (hiddenWrongType > 0 || hiddenWrongDirection > 0) && chosenVariable && (
        /* Nói ra SỐ bị ẩn và LÝ DO. Danh sách rỗng đã có thông báo riêng phía
           trên; ca nguy hiểm hơn là danh sách còn vài mục — trông như đầy đủ,
           nên không ai nghĩ là đã bị lọc. */
        <p role="status" data-testid="point-picker-hidden-note" className="mt-2 text-xs text-[var(--c-text-dim)]">
          {pick(
            `Đã ẩn ${hiddenWrongType + hiddenWrongDirection} Point không ghép được với biến ${chosenVariable.name}` +
              (hiddenWrongType > 0 ? `: ${hiddenWrongType} khác kiểu ${chosenVariable.type}` : ':') +
              (hiddenWrongDirection > 0
                ? `${hiddenWrongType > 0 ? ',' : ''} ${hiddenWrongDirection} sai hướng (biến ${chosenVariable.direction === 'OUTPUT' ? 'OUTPUT cần Point ghi được' : 'INPUT cần Point đọc được'})`
                : '') + '.',
            `Hidden ${hiddenWrongType + hiddenWrongDirection} point(s) that cannot bind to ${chosenVariable.name}` +
              (hiddenWrongType > 0 ? `: ${hiddenWrongType} of a different type than ${chosenVariable.type}` : ':') +
              (hiddenWrongDirection > 0
                ? `${hiddenWrongType > 0 ? ',' : ''} ${hiddenWrongDirection} with the wrong direction (an ${chosenVariable.direction} variable needs a ${chosenVariable.direction === 'OUTPUT' ? 'writable' : 'readable'} point)`
                : '') + '.',
          )}
        </p>
      )}

      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {pick('Hủy', 'Cancel')}
        </Button>
        <Button
          size="sm"
          icon={<Link2 className="h-4 w-4" aria-hidden="true" />}
          loading={saving}
          disabled={!selected || !chosenVariable || !programId}
          onClick={() => {
            if (!selected || !chosenVariable) return
            const variableId = createUuid()
            const bindingId = createUuid()
            void onSubmit([
              {
                op: 'upsertVariable',
                variable: { variableId, programId, name: chosenVariable.name, type: chosenVariable.type, class: chosenVariable.direction, initialValue: null, retain: false }
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
