import { useEffect, useRef } from 'react'
import { useI18n } from '../../../../shared/i18n'
import { Button } from '../../../../shared/components/Button'
import type { CatalogEntry } from '../library/libraryCatalog'
import type { StDeclaredInstance } from './stInstanceInsertion'

/**
 * `AC-ST-002` — nhánh **chọn**.
 *
 * Một FUNCTION_BLOCK mang trạng thái riêng: hai lời gọi dùng chung một
 * instance là hai lời gọi chia nhau CÙNG một bộ đếm thời gian. Đó có thể là
 * đúng ý người dùng (gọi lại đúng timer đó ở nhánh khác) hoặc là lỗi điều
 * khiển thật (hai chỗ vô tình đạp lên nhau). Công cụ không đoán hộ: khi nguồn
 * đã có instance cùng kiểu thì hỏi một câu, và câu hỏi đó chỉ hiện đúng lúc
 * cần — chưa có instance nào thì chèn thẳng.
 */
export function FbInstancePicker({
  entry,
  instances,
  suggestedName,
  onPick,
  onCreate,
  onClose,
}: {
  entry: CatalogEntry
  instances: readonly StDeclaredInstance[]
  suggestedName: string
  onPick: (instanceName: string) => void
  onCreate: () => void
  onClose: () => void
}) {
  const { pick } = useI18n()
  const firstRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    window.setTimeout(() => firstRef.current?.focus(), 0)
  }, [])

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={pick(`Chọn instance cho ${entry.name}`, `Choose an instance for ${entry.name}`)}
      className="mt-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <p className="text-xs text-[var(--c-text)]">
        {pick(
          `${entry.name} giữ trạng thái riêng cho từng instance. Dùng lại một instance đã khai, hay tạo instance mới?`,
          `${entry.name} keeps state per instance. Reuse a declared instance, or create a new one?`,
        )}
      </p>
      <ul className="mt-2 flex flex-wrap gap-1">
        {instances.map((instance, index) => (
          <li key={instance.name}>
            <button
              ref={index === 0 ? firstRef : undefined}
              type="button"
              className="rounded border border-[var(--c-border)] bg-[var(--c-bg)] px-2 py-1 font-mono text-xs text-[var(--c-text)] hover:text-[var(--c-accent)]"
              onClick={() => onPick(instance.name)}
            >
              {instance.name}
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={onCreate}>
          {pick(`Tạo mới ${suggestedName}`, `Create ${suggestedName}`)}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {pick('Huỷ', 'Cancel')}
        </Button>
      </div>
    </div>
  )
}
