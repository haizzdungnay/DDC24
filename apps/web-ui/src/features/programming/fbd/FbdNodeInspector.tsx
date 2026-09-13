import { useEffect, useState } from 'react'
import { Button } from '../../../shared/components/Button'
import { FBD_DATA_TYPES, isFbdIdentifier, type FbdDataType, type FbdNode, type FbdParameterValue } from './model'
import { defaultConstantLiteral, fbdPaletteEntry, isValidConstantLiteral, type FbdPaletteEntry } from './palette'
import { inputClass, type FbdNodeEditorChange, type FbdNodeEditorTarget } from './nodeEditor'
import { InsertPointVariablePanel, type InsertVariableOption } from '../design/editor/InsertPointVariablePanel'
import type { ProgrammingPointCatalogEntry } from '../model/types'

export interface FbdNodeInspectorProps {
  target: FbdNodeEditorTarget
  pick: (vi: string, en: string) => string
  paletteEntry?: FbdPaletteEntry
  variables?: readonly InsertVariableOption[]
  pointCatalogStatus?: 'idle' | 'loading' | 'ready' | 'error'
  pointCatalogItems?: readonly ProgrammingPointCatalogEntry[]
  pointCatalogError?: string | null
  onEnsurePointCatalogLoaded?: () => void
}

/**
 * Khoá tham số do các lệnh KHÁC sở hữu, nên không được sửa ở bảng chỉnh định.
 *
 * `instance`/`retained` có kiểm tra riêng (`isFbdIdentifier`) và có lệnh riêng;
 * `variable`/`value`/`signal` là danh tính của node vào/ra/hằng số và đã có ô
 * nhập riêng phía trên. Gộp chúng vào bảng này sẽ cho hai đường ghi cùng một
 * khoá với hai bộ kiểm tra khác nhau.
 */
const RESERVED_PARAMETER_KEYS = new Set(['instance', 'retained', 'variable', 'value', 'signal'])

export function tuningParameterNames(node: FbdNode): string[] {
  return Object.keys(node.parameters)
    .filter((name) => !RESERVED_PARAMETER_KEYS.has(name))
    .sort((left, right) => left.localeCompare(right))
}

/**
 * Bảng THAM SỐ CHỈNH ĐỊNH của một khối.
 *
 * VÌ SAO NÓ ĐỌC TỪ CHÍNH NODE, KHÔNG TỪ MỘT LƯỢC ĐỒ
 *
 * Thư viện thiết bị công bố CHÂN (`ports`) chứ không công bố danh sách tham số
 * chỉnh định. Dựng sẵn một danh sách `Kp/Ki/Kd/Ts/ManualOut` ở FE vì "PID thì
 * phải có mấy cái đó" là bịa ra một hợp đồng thiết bị chưa từng nói — và nó sẽ
 * hiện ra những ô mà Kiểm tra từ chối, hoặc bỏ sót tham số của một khối khác.
 *
 * Nên bảng này hiện đúng những tham số mà TÀI LIỆU đang mang, và kiểu ô nhập
 * suy từ kiểu giá trị hiện có. Khối chưa có tham số nào thì nói thẳng là chưa
 * có, chứ không vẽ ra một bộ ô trống trông như đã cấu hình được.
 */
function FbdTuningParameters({ node, canEdit, apply, pick }: {
  node: FbdNode
  canEdit: boolean
  apply: (change: FbdNodeEditorChange) => void
  pick: (vi: string, en: string) => string
}) {
  const names = tuningParameterNames(node)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [paramError, setParamError] = useState<string | null>(null)

  useEffect(() => {
    setParamError(null)
    setDrafts(Object.fromEntries(
      tuningParameterNames(node).map((name) => [name, String(node.parameters[name])]),
    ))
  }, [node.id, node.parameters])

  if (names.length === 0) {
    return (
      <p className="text-xs text-[var(--c-text-dim)]">
        {pick('Khối này chưa khai tham số chỉnh định nào.', 'This block declares no tuning parameters.')}
      </p>
    )
  }

  return (
    <form
      data-testid="fbd-tuning-parameters"
      className="flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault()
        const next: Record<string, FbdParameterValue | null> = {}
        for (const name of names) {
          const current = node.parameters[name]
          const raw = drafts[name] ?? ''
          if (typeof current === 'boolean') { next[name] = raw === 'true'; continue }
          if (typeof current === 'number') {
            const parsed = Number(raw)
            /* Ô rỗng và chữ không phải số đều KHÔNG được lặng lẽ thành 0: một
               tham số chỉnh định bằng 0 là một quyết định điều khiển. */
            if (raw.trim() === '' || !Number.isFinite(parsed)) {
              setParamError(pick(`Giá trị của ${name} không phải số hợp lệ`, `${name} is not a valid number`))
              return
            }
            next[name] = parsed
            continue
          }
          next[name] = raw
        }
        setParamError(null)
        apply({ kind: 'parameters', parameters: next })
      }}
    >
      {names.map((name) => {
        const current = node.parameters[name]
        const id = `fbd-param-${node.id}-${name}`
        return (
          <div key={name} className="flex items-center justify-between gap-2 text-xs">
            <label htmlFor={id} className="min-w-0 flex-1 truncate font-mono text-[var(--c-text-dim)]">{name}</label>
            {typeof current === 'boolean' ? (
              <select
                id={id}
                className={`${inputClass} w-28`}
                value={drafts[name] ?? 'false'}
                disabled={!canEdit}
                onChange={(event) => setDrafts((prev) => ({ ...prev, [name]: event.target.value }))}
              >
                <option value="true">TRUE</option>
                <option value="false">FALSE</option>
              </select>
            ) : (
              <input
                id={id}
                className={`${inputClass} w-28 text-right font-mono`}
                inputMode={typeof current === 'number' ? 'decimal' : undefined}
                value={drafts[name] ?? ''}
                disabled={!canEdit}
                onChange={(event) => setDrafts((prev) => ({ ...prev, [name]: event.target.value }))}
              />
            )}
          </div>
        )
      })}
      <div className="flex items-center gap-2">
        <Button size="sm" type="submit" disabled={!canEdit}>{pick('Lưu tham số', 'Save parameters')}</Button>
        {paramError && <span role="alert" className="text-xs text-[var(--c-fault-fg)]">{paramError}</span>}
      </div>
    </form>
  )
}

export function FbdNodeInspector({
  target,
  pick,
  paletteEntry,
  variables = [],
  pointCatalogStatus = 'idle',
  pointCatalogItems = [],
  pointCatalogError = null,
  onEnsurePointCatalogLoaded = () => {},
}: FbdNodeInspectorProps) {
  const { node, canEdit, apply } = target
  const entry = paletteEntry ?? fbdPaletteEntry(node.typeRef)
  const [variableDraft, setVariableDraft] = useState('')
  const [unitDraft, setUnitDraft] = useState('')
  const [typeDraft, setTypeDraft] = useState<FbdDataType>('BOOL')
  const [valueDraft, setValueDraft] = useState('')
  const [instanceDraft, setInstanceDraft] = useState('')
  const [retainedDraft, setRetainedDraft] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    setError(null)
    setPickerOpen(false)
    if (node.kind === 'INPUT' || node.kind === 'OUTPUT') {
      setVariableDraft(typeof node.parameters.variable === 'string' ? node.parameters.variable : '')
      setUnitDraft(node.ports[0]?.unit ?? '')
      setTypeDraft(node.typeRef as FbdDataType)
    } else if (node.kind === 'CONSTANT') {
      setTypeDraft(node.typeRef as FbdDataType)
      setValueDraft(String(node.parameters.value ?? ''))
    } else if (node.kind === 'FUNCTION_BLOCK') {
      setInstanceDraft(typeof node.parameters.instance === 'string' ? node.parameters.instance : '')
      setRetainedDraft(node.parameters.retained === true)
    } else if (entry?.polymorphic) {
      const typedPort = node.ports.find((port) => entry.typedPortNames.includes(port.name))
      setTypeDraft(typedPort?.dataType ?? entry.defaultType)
    }
  }, [node.id, node.kind, node.parameters, node.ports, node.typeRef, entry])

  if (node.kind === 'INPUT' || node.kind === 'OUTPUT') {
    const unknownUnitLabel = pick('không xác định được', 'not determinable')
    return (
      <div className="space-y-2">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (!isFbdIdentifier(variableDraft)) {
              setError(pick('Tên biến không hợp lệ', 'Invalid variable name'))
              return
            }
            setError(null)
            const cleanUnit = unitDraft.trim()
            apply({
              kind: 'attributes',
              dataType: typeDraft,
              variable: variableDraft,
              unit: cleanUnit.length > 0 && cleanUnit !== unknownUnitLabel ? cleanUnit : null,
            })
          }}
        >
          <div className="flex flex-col gap-1 text-xs">
            <label htmlFor="fbd-inspector-var-input">{pick('Tên biến', 'Variable name')}</label>
            <div className="flex items-center gap-1">
              <input
                id="fbd-inspector-var-input"
                className={inputClass}
                value={variableDraft}
                disabled={!canEdit}
                onChange={(event) => setVariableDraft(event.target.value)}
              />
              <Button
                size="sm"
                type="button"
                disabled={!canEdit}
                onClick={() => setPickerOpen((prev) => !prev)}
              >
                {pick('Chọn…', 'Pick…')}
              </Button>
            </div>
          </div>
          <label className="flex flex-col gap-1 text-xs">
            {pick('Kiểu', 'Type')}
            <select
              className={inputClass}
              value={typeDraft}
              disabled={!canEdit}
              onChange={(event) => setTypeDraft(event.target.value as FbdDataType)}
            >
              {FBD_DATA_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            {pick('Đơn vị (tuỳ chọn)', 'Unit (optional)')}
            <input
              className={inputClass}
              value={unitDraft}
              disabled={!canEdit}
              onChange={(event) => setUnitDraft(event.target.value)}
            />
          </label>
          <Button size="sm" type="submit" disabled={!canEdit}>
            {pick('Lưu', 'Save')}
          </Button>
          {error && <span className="text-xs text-[var(--c-danger-fg)]">{error}</span>}
        </form>
        {pickerOpen && canEdit && (
          <div className="mt-2">
            <InsertPointVariablePanel
              variant="embedded"
              variables={variables}
              pointCatalogStatus={pointCatalogStatus}
              pointCatalogItems={pointCatalogItems}
              pointCatalogError={pointCatalogError}
              onEnsureLoaded={onEnsurePointCatalogLoaded}
              onInsert={(name, detail) => {
                setVariableDraft(name)
                if (detail?.dataType && FBD_DATA_TYPES.includes(detail.dataType as FbdDataType)) {
                  setTypeDraft(detail.dataType as FbdDataType)
                }
                const cleanUnit = detail?.unit?.trim()
                setUnitDraft(cleanUnit && cleanUnit.length > 0 ? cleanUnit : unknownUnitLabel)
                setPickerOpen(false)
              }}
              onClose={() => setPickerOpen(false)}
            />
          </div>
        )}
      </div>
    )
  }

  if (node.kind === 'CONSTANT') {
    return (
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          const parsed: FbdParameterValue =
            typeDraft === 'BOOL'
              ? valueDraft === 'true'
              : typeDraft === 'TIME'
              ? valueDraft
              : Number(valueDraft)
          if (!isValidConstantLiteral(typeDraft, parsed)) {
            setError(pick('Giá trị không hợp lệ với kiểu đã chọn', 'Value is not valid for the selected type'))
            return
          }
          setError(null)
          apply({
            kind: 'attributes',
            dataType: typeDraft,
            value: parsed,
          })
        }}
      >
        <label className="flex flex-col gap-1 text-xs">
          {pick('Kiểu', 'Type')}
          <select
            className={inputClass}
            value={typeDraft}
            disabled={!canEdit}
            onChange={(event) => {
              const next = event.target.value as FbdDataType
              setTypeDraft(next)
              setValueDraft(String(defaultConstantLiteral(next)))
            }}
          >
            {FBD_DATA_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          {pick('Giá trị', 'Value')}
          {typeDraft === 'BOOL' ? (
            <select
              className={inputClass}
              value={valueDraft}
              disabled={!canEdit}
              onChange={(event) => setValueDraft(event.target.value)}
            >
              <option value="true">TRUE</option>
              <option value="false">FALSE</option>
            </select>
          ) : (
            <input
              className={inputClass}
              value={valueDraft}
              disabled={!canEdit}
              onChange={(event) => setValueDraft(event.target.value)}
              placeholder={typeDraft === 'TIME' ? 'T#30s' : undefined}
            />
          )}
        </label>
        <Button size="sm" type="submit" disabled={!canEdit}>
          {pick('Lưu', 'Save')}
        </Button>
        {error && <span className="text-xs text-[var(--c-danger-fg)]">{error}</span>}
      </form>
    )
  }

  if (node.kind === 'FUNCTION_BLOCK') {
    return (
      <div className="space-y-2">
        {entry?.warning && (
          <p className="rounded bg-[var(--c-warn-bg)] px-2 py-1 text-xs text-[var(--c-warn-fg)]">
            {pick(entry.warning.vi, entry.warning.en)}
          </p>
        )}
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            const trimmed = instanceDraft.trim()
            if (trimmed.length > 0 && !isFbdIdentifier(trimmed)) {
              setError(pick('Tên instance không hợp lệ', 'Invalid instance name'))
              return
            }
            setError(null)
            apply({
              kind: 'fbParams',
              instance: trimmed.length > 0 ? trimmed : null,
              retained: retainedDraft,
            })
          }}
        >
          <label className="flex flex-col gap-1 text-xs">
            {pick('Tên instance (tuỳ chọn)', 'Instance name (optional)')}
            <input
              className={inputClass}
              value={instanceDraft}
              disabled={!canEdit}
              onChange={(event) => setInstanceDraft(event.target.value)}
              placeholder={pick('tự sinh nếu để trống', 'auto-generated if empty')}
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={retainedDraft}
              disabled={!canEdit}
              onChange={(event) => setRetainedDraft(event.target.checked)}
            />
            {pick('RETAIN (giữ trạng thái qua power-cycle)', 'RETAIN (persist across power-cycle)')}
          </label>
          <Button size="sm" type="submit" disabled={!canEdit}>
            {pick('Lưu', 'Save')}
          </Button>
          {error && <span className="text-xs text-[var(--c-danger-fg)]">{error}</span>}
        </form>
        <div className="border-t border-[var(--c-border)] pt-2">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--c-text-dim)]">
            {pick('Tham số chỉnh định', 'Tuning parameters')}
          </p>
          <FbdTuningParameters node={node} canEdit={canEdit} apply={apply} pick={pick} />
        </div>
      </div>
    )
  }

  if (entry?.polymorphic) {
    return (
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          apply({ kind: 'dataType', dataType: typeDraft })
        }}
      >
        <label className="flex flex-col gap-1 text-xs">
          {pick('Kiểu toán hạng', 'Operand type')}
          <select
            className={inputClass}
            value={typeDraft}
            disabled={!canEdit}
            onChange={(event) => setTypeDraft(event.target.value as FbdDataType)}
          >
            {entry.allowedTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <Button size="sm" type="submit" disabled={!canEdit}>
          {pick('Lưu', 'Save')}
        </Button>
      </form>
    )
  }

  return (
    <p className="text-xs text-[var(--c-text-dim)]">
      {pick('Block cố định — không có tham số để sửa.', 'Fixed-shape block — no editable parameters.')}
    </p>
  )
}
