import { useState } from 'react'
import { Button } from '../../../../shared/components/Button'
import { useI18n } from '../../../../shared/i18n'
import type { ProgrammingBinding, ProgrammingProgram, ProgrammingVariable } from '../../model/types'

export interface ProgramMetadataDraft {
  name: string
  kind: ProgrammingProgram['kind']
  functionalTags: string
}

type InspectorTab = 'properties' | 'variables' | 'references'

export function ProgramInspector({
  draft,
  program,
  variables,
  bindings,
  source,
  active,
  activeRevisionId,
  canEdit,
  saving,
  dirty,
  duplicateName,
  onChange,
  onSave,
}: {
  draft: ProgramMetadataDraft
  program: ProgrammingProgram
  variables: ProgrammingVariable[]
  bindings: ProgrammingBinding[]
  source: string
  active: boolean
  activeRevisionId: string | null
  canEdit: boolean
  saving: boolean
  dirty: boolean
  duplicateName: boolean
  onChange: (draft: ProgramMetadataDraft) => void
  onSave: () => void
}) {
  const { pick } = useI18n()
  const [tab, setTab] = useState<InspectorTab>('variables')
  const tabs: Array<{ id: InspectorTab; label: [string, string] }> = [
    { id: 'properties', label: ['Thuộc tính', 'Properties'] },
    { id: 'variables', label: ['Biến', 'Variables'] },
    { id: 'references', label: ['Tham chiếu', 'References'] },
  ]

  return (
    <section className="overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)]">
      <div className="border-b border-[var(--c-border)] px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--c-text-dim)]">Inspector</p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <h3 className="truncate text-sm font-semibold text-[var(--c-text)]">{program.name}</h3>
          <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${active ? 'bg-[var(--c-good-bg)] text-[var(--c-good-fg)]' : 'bg-[var(--c-surface-2)] text-[var(--c-text-dim)]'}`}>
            {active ? 'LIVE' : 'DRAFT'}
          </span>
        </div>
        {active && <p className="mt-1 font-mono text-[10px] text-[var(--c-good-fg)]">Active {activeRevisionId?.slice(0, 8)}</p>}
      </div>

      <div role="tablist" aria-label={pick('Các vùng Inspector', 'Inspector sections')} className="grid grid-cols-3 border-b border-[var(--c-border)]">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`min-h-10 border-b-2 px-1 text-[11px] font-medium ${tab === item.id ? 'border-[var(--c-accent)] text-[var(--c-accent)]' : 'border-transparent text-[var(--c-text-dim)] hover:text-[var(--c-text)]'}`}
            onClick={() => setTab(item.id)}
          >
            {pick(...item.label)}
          </button>
        ))}
      </div>

      {tab === 'properties' && (
        <div className="grid gap-2 p-3" role="tabpanel">
          <label className="text-xs text-[var(--c-text-dim)]">
            {pick('Tên', 'Name')}
            <input className="mt-1 w-full rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1 text-sm text-[var(--c-text)]" value={draft.name} readOnly={!canEdit} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
            {duplicateName && <span className="mt-1 block text-xs font-normal normal-case text-[var(--c-fault-fg)]">{pick('Tên đã được dùng bởi chương trình khác.', 'This name is already used by another program.')}</span>}
          </label>
          <label className="text-xs text-[var(--c-text-dim)]">
            {pick('Loại', 'Kind')}
            <select className="mt-1 w-full rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1 text-sm text-[var(--c-text)]" value={draft.kind} disabled={!canEdit} onChange={(event) => onChange({ ...draft, kind: event.target.value as ProgrammingProgram['kind'] })}>
              <option value="PROGRAM">PROGRAM</option>
              {draft.kind !== 'PROGRAM' && <option value={draft.kind}>{draft.kind}</option>}
            </select>
            {draft.kind !== 'PROGRAM' && <span className="mt-1 block text-xs font-normal normal-case text-[var(--c-warn-fg)]">{pick('Loại này chưa được Check hỗ trợ biên dịch.', 'This kind is not supported by Check.')}</span>}
          </label>
          <label className="text-xs text-[var(--c-text-dim)]">
            {pick('Tag chức năng', 'Functional tags')}
            <input className="mt-1 w-full rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1 text-sm text-[var(--c-text)]" value={draft.functionalTags} readOnly={!canEdit} onChange={(event) => onChange({ ...draft, functionalTags: event.target.value })} />
          </label>
          {canEdit && <Button size="sm" loading={saving} disabled={!dirty || draft.name.trim().length === 0 || duplicateName} onClick={onSave}>{pick('Lưu thuộc tính', 'Save properties')}</Button>}
        </div>
      )}

      {tab === 'variables' && (
        <div className="overflow-x-auto" role="tabpanel">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-[var(--c-surface-2)] text-[10px] uppercase text-[var(--c-text-dim)]"><tr><th className="px-2 py-1.5">{pick('Tên', 'Name')}</th><th className="px-2 py-1.5">{pick('Kiểu', 'Type')}</th><th className="px-2 py-1.5">Point</th></tr></thead>
            <tbody className="divide-y divide-[var(--c-border)]">
              {variables.map((variable) => {
                const binding = bindings.find((item) => item.variableId === variable.variableId)
                return (
                  <tr key={variable.variableId} className="align-top">
                    <td className="px-2 py-1.5 font-medium text-[var(--c-text)]">
                      {variable.name}
                      <span className="mt-0.5 block text-[9px] font-normal text-[var(--c-text-dim)]">{variable.class}{variable.retain ? ' · RETAIN' : ''}</span>
                    </td>
                    <td className="px-2 py-1.5 font-mono text-[var(--c-text-dim)]">{variable.type}</td>
                    <td className="px-2 py-1.5 font-mono text-[10px] text-[var(--c-text-dim)]">
                      {binding ? `${binding.point.category}:${binding.point.deviceId ? `${binding.point.deviceId}:` : ''}${binding.point.pointId}` : '—'}
                      {binding ? <span className="mt-0.5 block font-sans text-[9px]">{binding.direction}{binding.unit ? ` · ${binding.unit}` : ''}</span> : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {variables.length === 0 && <p className="p-3 text-xs text-[var(--c-text-dim)]">{pick('Program chưa khai báo biến.', 'The program has no declared variables.')}</p>}
        </div>
      )}

      {tab === 'references' && (
        <ul className="divide-y divide-[var(--c-border)]" role="tabpanel">
          {variables.map((variable) => {
            const binding = bindings.find((item) => item.variableId === variable.variableId)
            const count = countWord(source, variable.name)
            return (
              <li key={variable.variableId} className="px-3 py-2 text-xs">
                <div className="flex items-center justify-between gap-2"><strong className="text-[var(--c-text)]">{variable.name}</strong><span className="text-[var(--c-text-dim)]">{count} {pick('tham chiếu', 'references')}</span></div>
                <p className="mt-0.5 break-all font-mono text-[10px] text-[var(--c-text-dim)]">{binding ? `${binding.point.category}:${binding.point.deviceId ? `${binding.point.deviceId}:` : ''}${binding.point.pointId}` : pick('Chưa ánh xạ Point', 'Point not mapped')}</p>
              </li>
            )
          })}
          {variables.length === 0 && <li className="p-3 text-xs text-[var(--c-text-dim)]">{pick('Chưa có tham chiếu.', 'No references.')}</li>}
        </ul>
      )}
    </section>
  )
}

function countWord(source: string, name: string): number {
  if (!name) return 0
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return source.match(new RegExp(`\\b${escaped}\\b`, 'g'))?.length ?? 0
}
