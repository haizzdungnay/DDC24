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
  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.setTimeout(() => firstRef.current?.focus(), 0)
  }, [])

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[1px]"
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={pick(`Chọn instance cho ${entry.name}`, `Choose an instance for ${entry.name}`)}
        className="w-full max-w-md rounded-xl border border-[var(--c-border)] bg-[var(--c-bg)] p-5 shadow-2xl transition-all"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          }
        }}
      >
        <h3 className="text-sm font-bold text-[var(--c-text)]">
          {pick(`Chọn instance cho ${entry.name}`, `Choose an instance for ${entry.name}`)}
        </h3>
        <p className="mt-2 text-xs leading-relaxed text-[var(--c-text-dim)]">
          {pick(
            `${entry.name} giữ trạng thái riêng cho từng instance. Dùng lại một instance đã khai, hay tạo instance mới?`,
            `${entry.name} keeps state per instance. Reuse a declared instance, or create a new one?`,
          )}
        </p>
        <div className="mt-4">
          <span className="block text-[11px] font-semibold text-[var(--c-text-dim)]">
            {pick('Instance đã khai báo trong mã:', 'Declared instances in code:')}
          </span>
          <ul className="mt-2 flex flex-wrap gap-2">
            {instances.map((instance, index) => (
              <li key={instance.name}>
                <button
                  ref={index === 0 ? firstRef : undefined}
                  type="button"
                  className="rounded-lg border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3 py-1.5 font-mono text-xs font-semibold text-[var(--c-text)] transition hover:border-[var(--c-accent)] hover:text-[var(--c-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
                  onClick={() => onPick(instance.name)}
                >
                  {instance.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2.5 border-t border-[var(--c-border)]/60 pt-4">
          <Button size="sm" variant="ghost" onClick={onClose}>
            {pick('Huỷ', 'Cancel')}
          </Button>
          <Button size="sm" variant="primary" onClick={onCreate}>
            {pick(`Tạo mới ${suggestedName}`, `Create ${suggestedName}`)}
          </Button>
        </div>
      </div>
    </div>
  )
}

