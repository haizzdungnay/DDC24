import { useI18n } from '../../../../../shared/i18n'
import type { InspectorField, InspectorPouParameter } from '../inspectorContext'

export interface InterfaceSectionProps {
  parameters: InspectorField<readonly InspectorPouParameter[]>
  pouKind: InspectorField<'PROGRAM' | 'FUNCTION' | 'FUNCTION_BLOCK'>
  returnType: InspectorField<string>
}

const GROUPS = [
  { direction: 'INPUT', label: 'VAR_INPUT' },
  { direction: 'OUTPUT', label: 'VAR_OUTPUT' },
  { direction: 'IN_OUT', label: 'VAR_IN_OUT' },
] as const

const UNAVAILABLE_GROUPS = ['VAR', 'VAR_TEMP', 'VAR_EXTERNAL'] as const

/** Interface IEC lấy từ chính buffer đang mở; `unknown` không bị biến thành rỗng. */
export function InterfaceSection({ parameters, pouKind, returnType }: InterfaceSectionProps) {
  const { pick } = useI18n()
  const count = parameters.known ? parameters.value.length : null

  return (
    <details open className="mt-3 border-t border-[var(--c-border)]/70 pt-2 text-xs" data-testid="inspector-interface-section">
      <summary className="cursor-pointer font-medium text-[var(--c-text-dim)] hover:text-[var(--c-text)]">
        {pick('Giao diện IEC', 'IEC interface')}{count === null ? '' : ` (${count})`}
      </summary>

      <div className="mt-2 space-y-3">
        {!parameters.known ? (
          <p className="italic text-[var(--c-text-dim)]">
            {pick('không xác định được', 'not determinable')}
          </p>
        ) : (
          GROUPS.map((group) => {
            const rows = parameters.value.filter((parameter) => parameter.direction === group.direction)
            if (rows.length === 0) return null
            return (
              <div key={group.direction}>
                <h4 className="mb-1 font-mono text-[11px] font-semibold text-[var(--c-text)]">
                  {group.label}
                </h4>
                <div className="overflow-x-auto">
                <table className="min-w-[34rem] table-fixed text-xs" data-testid={`interface-${group.direction.toLowerCase()}-table`}>
                  <thead>
                    <tr className="text-left text-[var(--c-text-dim)]">
                      <th className="w-28 pb-1 font-medium">{pick('Tên', 'Name')}</th>
                      <th className="w-20 pb-1 font-medium">{pick('Hướng', 'Direction')}</th>
                      <th className="w-20 pb-1 font-medium">{pick('Kiểu', 'Type')}</th>
                      <th className="w-20 pb-1 font-medium">{pick('Khởi tạo', 'Initial')}</th>
                      <th className="w-16 pb-1 font-medium">Retain</th>
                      <th className="w-28 pb-1 font-medium">{pick('Mô tả', 'Description')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((parameter) => (
                      <tr key={`${group.direction}-${parameter.name}`} className="border-t border-[var(--c-border)]/60">
                        <td className="truncate py-1 font-mono text-[var(--c-text)]" title={parameter.name}>{parameter.name}</td>
                        <td className="truncate py-1 text-[var(--c-text-dim)]">{group.label}</td>
                        <td className="truncate py-1 font-mono text-[var(--c-text-dim)]" title={parameter.dataType}>{parameter.dataType}</td>
                        <td className="py-1 italic text-[var(--c-text-dim)]">{pick('không xác định được', 'not determinable')}</td>
                        <td className="py-1 italic text-[var(--c-text-dim)]">{pick('không xác định được', 'not determinable')}</td>
                        <td className="py-1 italic text-[var(--c-text-dim)]">{pick('không xác định được', 'not determinable')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            )
          })
        )}

        {parameters.known && parameters.value.length === 0 && (
          <p className="text-[var(--c-text-dim)]">
            {pick('POU không khai báo cổng vào/ra.', 'This POU declares no I/O ports.')}
          </p>
        )}

        {UNAVAILABLE_GROUPS.map((group) => (
          <div key={group} className="flex items-center justify-between gap-3 border-t border-[var(--c-border)]/50 pt-2">
            <h4 className="font-mono text-[11px] font-semibold text-[var(--c-text)]">{group}</h4>
            <p className="italic text-[var(--c-text-dim)]">{pick('không xác định được', 'not determinable')}</p>
          </div>
        ))}

        {pouKind.known && pouKind.value === 'FUNCTION' && (
          <dl className="grid grid-cols-2 gap-x-3 border-t border-[var(--c-border)]/60 pt-2">
            <dt className="text-[var(--c-text-dim)]">{pick('Kiểu trả về', 'Return type')}</dt>
            <dd className={returnType.known ? 'font-mono text-[var(--c-text)]' : 'italic text-[var(--c-text-dim)]'}>
              {returnType.known ? returnType.value : pick('không xác định được', 'not determinable')}
            </dd>
          </dl>
        )}
      </div>
    </details>
  )
}
