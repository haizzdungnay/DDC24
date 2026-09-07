import { useEffect, useState } from 'react'
import { Button } from '../../../shared/components/Button'
import { FBD_DATA_TYPES, isFbdIdentifier, type FbdDataType, type FbdParameterValue } from './model'
import { defaultConstantLiteral, fbdPaletteEntry, isValidConstantLiteral, type FbdPaletteEntry } from './palette'
import { inputClass, type FbdNodeEditorTarget } from './nodeEditor'
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
            if (typeDraft !== node.typeRef) {
              apply({ kind: 'dataType', dataType: typeDraft })
            }
            const cleanUnit = unitDraft.trim()
            apply({
              kind: 'variable',
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
          if (typeDraft !== node.typeRef) {
            apply({ kind: 'dataType', dataType: typeDraft })
          }
          apply({ kind: 'value', value: parsed })
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
