import { useState } from 'react'
import { useI18n } from '../../../shared/i18n'
import {
  simulationValuesByObservation,
  validateSimulationInput,
  type SimulationInputDescriptor,
  type SimulationSlice,
} from './simulationSession'

/**
 * `T59-815` / `PGM02-V22-WP-08` — khay virtual input.
 *
 * Danh sách ở đây đến TỪ manifest của phiên, tức từ artifact đã seal. FE không
 * tự dựng danh sách từ Draft đang mở: hai thứ đó có thể khác nhau, và khác nhau
 * đúng lúc người dùng vừa sửa Draft mà chưa Save — chính là lúc họ dễ tin nhất
 * rằng mình đang thử thứ mình vừa gõ.
 *
 * Kiểm giá trị ở client chỉ để người dùng biết ngay; server vẫn là authority và
 * vẫn từ chối sai kiểu/đơn vị/miền.
 */
export function VirtualInputs({
  inputs,
  slice,
  canControl,
  onCommit,
}: {
  inputs: readonly SimulationInputDescriptor[]
  slice: SimulationSlice
  canControl: boolean
  onCommit: (descriptor: SimulationInputDescriptor, raw: string) => void
}) {
  const { pick } = useI18n()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const values = simulationValuesByObservation(slice.frame)

  if (inputs.length === 0) {
    return (
      <section aria-label={pick('Ngõ vào ảo', 'Virtual inputs')} className="text-xs text-[var(--c-text-dim)]">
        {pick('Gói đang mô phỏng không khai ngõ vào nào ghi được.',
              'The simulated package declares no writable inputs.')}
      </section>
    )
  }

  return (
    <section aria-label={pick('Ngõ vào ảo', 'Virtual inputs')} className="space-y-2">
      <h3 className="text-xs font-semibold uppercase text-[var(--c-text)]">
        {pick('Ngõ vào ảo', 'Virtual inputs')}
      </h3>
      <ul className="space-y-2">
        {inputs.map((descriptor) => {
          const draft = drafts[descriptor.observationId] ?? ''
          const validation = validateSimulationInput(descriptor, draft)
          const committed = values[descriptor.observationId]
          const writable = canControl && descriptor.simulationWritable
          return (
            <li key={descriptor.observationId} className="space-y-1 rounded-[var(--radius)] border border-[var(--c-border)] p-2">
              <div className="flex flex-wrap items-baseline gap-1 text-[11px]">
                <span className="font-mono text-[var(--c-text)]">{descriptor.observationId}</span>
                <span className="text-[var(--c-text-dim)]">{descriptor.dataType}</span>
                {descriptor.unit && <span className="text-[var(--c-text-dim)]">{descriptor.unit}</span>}
                {(descriptor.min !== null || descriptor.max !== null) && (
                  <span className="text-[var(--c-text-dim)]">
                    [{descriptor.min ?? '−∞'}, {descriptor.max ?? '+∞'}]
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1 text-[11px] text-[var(--c-text-dim)]">
                  {pick('Giá trị', 'Value')}
                  <input
                    type="text"
                    inputMode={descriptor.dataType === 'BOOL' ? 'text' : 'decimal'}
                    value={draft}
                    disabled={!writable}
                    aria-label={pick(`Giá trị ảo của ${descriptor.observationId}`,
                                     `Virtual value for ${descriptor.observationId}`)}
                    onChange={(event) =>
                      setDrafts((current) => ({ ...current, [descriptor.observationId]: event.target.value }))
                    }
                    className="w-28 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] px-1 py-0.5 font-mono text-[11px] disabled:opacity-50"
                  />
                </label>
                <button
                  type="button"
                  disabled={!writable || !validation.ok || slice.pending !== null}
                  onClick={() => onCommit(descriptor, draft)}
                  className="rounded-[var(--radius)] border border-[var(--c-border)] px-2 py-0.5 text-[11px] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pick('Ghi', 'Set')}
                </button>
                <span className="text-[11px] text-[var(--c-text-dim)]">
                  {pick('Đang có', 'Current')}{' '}
                  {/* Ô trống nói "chưa có mẫu". Nó KHÔNG được thay bằng 0 — một
                      số 0 nói "đo được 0", và trộn hai thứ đó là kiểu sai nguy
                      hiểm nhất ở màn hình này. */}
                  <span className="font-mono">{formatValue(committed?.value)}</span>
                  {committed && committed.quality !== 'GOOD' && (
                    <span className="ml-1 text-[var(--c-warn-fg)]">{committed.quality}</span>
                  )}
                </span>
              </div>
              {draft !== '' && !validation.ok && (
                <p role="status" className="text-[11px] text-[var(--c-danger-fg)]">
                  {validationCopy(pick, validation.reason)}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  return String(value)
}

function validationCopy(pick: (vi: string, en: string) => string, reason: string): string {
  switch (reason) {
    case 'NOT_WRITABLE':
      return pick('Biến này không nằm trong danh sách được phép ghi.', 'This variable is not writable in simulation.')
    case 'TYPE':
      return pick('Giá trị không đúng kiểu đã khai.', 'The value does not match the declared type.')
    case 'RANGE':
      return pick('Giá trị nằm ngoài miền cho phép.', 'The value is outside the allowed range.')
    case 'NOT_FINITE':
      return pick('Giá trị phải là một số hữu hạn.', 'The value must be a finite number.')
    default:
      return pick('Chưa nhập giá trị.', 'No value entered.')
  }
}
