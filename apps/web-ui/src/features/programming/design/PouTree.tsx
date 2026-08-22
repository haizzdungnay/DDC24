import { useMemo } from 'react'
import { Boxes, FileCode2, FunctionSquare } from 'lucide-react'
import { useI18n } from '../../../shared/i18n'
import type { ProgrammingDraftDocument } from '../model/types'

/**
 * PGM-02 (DDD §8) — cây POU gom theo ba nhóm `Programs` / `Functions` /
 * `Function Blocks`, và inspector **ẩn** những trường không có nghĩa với từng
 * kind.
 *
 * Vì sao ẩn thay vì hiện rồi vô hiệu hoá: một FUNCTION không có chu kỳ và không
 * có trạng thái bật/tắt — nó không phải đơn vị lập lịch. Hiện một ô "chu kỳ" bị
 * xám cho FUNCTION vẫn nói rằng khái niệm đó tồn tại ở đây, và người dùng sẽ đi
 * tìm cách bật nó.
 */
export interface PouTreeItem {
  objectId: string
  name: string
  kind: 'PROGRAM' | 'FUNCTION' | 'FUNCTION_BLOCK'
  language: 'ST' | 'FBD'
  periodMs?: number
  desiredEnabled?: boolean
}

/** Chiếu document v2 sang cây POU. Document v1 (không có `objects`) cho cây rỗng
 *  — controller cũ chưa nâng cấp không có khái niệm POU tách rời. */
export function pouTreeItems(draft: ProgrammingDraftDocument): PouTreeItem[] {
  const source = draft as unknown as Record<string, unknown>
  const objects = Array.isArray(source.objects) ? (source.objects as Record<string, unknown>[]) : []
  const configs = (Array.isArray(source.programs) ? source.programs : []) as Record<string, unknown>[]
  const periodByObject = new Map(configs.map((item) => [String(item.objectId), Number(item.periodMs)]))
  return objects
    .map((object) => {
      const objectId = String(object.objectId)
      const kind = (object.kind as PouTreeItem['kind']) ?? 'PROGRAM'
      const item: PouTreeItem = {
        objectId,
        name: String(object.name ?? ''),
        kind,
        language: (object.language as PouTreeItem['language']) ?? 'ST'
      }
      // Chu kỳ và trạng thái bật CHỈ tồn tại với PROGRAM. Gán chúng cho
      // FUNCTION/FB sẽ tạo ra dữ liệu không có nghĩa mà lớp hiển thị phải đoán.
      if (kind === 'PROGRAM' && periodByObject.has(objectId)) {
        item.periodMs = periodByObject.get(objectId)
        // Program mới luôn Disabled (T59-305); trạng thái thật đến từ runtime.
        item.desiredEnabled = false
      }
      return item
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

const GROUPS: { kind: PouTreeItem['kind']; label: [string, string]; icon: typeof FileCode2 }[] = [
  { kind: 'PROGRAM', label: ['Programs', 'Programs'], icon: FileCode2 },
  { kind: 'FUNCTION', label: ['Functions', 'Functions'], icon: FunctionSquare },
  { kind: 'FUNCTION_BLOCK', label: ['Function Blocks', 'Function Blocks'], icon: Boxes }
]

export function PouTree({
  draft,
  selectedObjectId,
  onSelect
}: {
  draft: ProgrammingDraftDocument
  selectedObjectId?: string
  onSelect: (objectId: string) => void
}) {
  const { pick } = useI18n()
  const items = useMemo(() => pouTreeItems(draft), [draft])
  const selected = items.find((item) => item.objectId === selectedObjectId) ?? null

  return (
    <div className="flex flex-col gap-3">
      <nav aria-label={pick('Cây POU', 'POU tree')} className="flex flex-col gap-2">
        {GROUPS.map(({ kind, label, icon: Icon }) => {
          const group = items.filter((item) => item.kind === kind)
          return (
            <section key={kind}>
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase text-[var(--c-text-dim)]">
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {pick(...label)} ({group.length})
              </h3>
              {group.length === 0 ? (
                <p className="px-5 py-1 text-sm text-[var(--c-text-dim)]">{pick('Chưa có', 'None yet')}</p>
              ) : (
                <ul aria-label={pick(...label)} className="flex flex-col">
                  {group.map((item) => (
                    <li key={item.objectId}>
                      <button
                        type="button"
                        onClick={() => onSelect(item.objectId)}
                        aria-current={item.objectId === selectedObjectId ? 'true' : undefined}
                        className={`w-full px-5 py-1 text-left text-sm ${
                          item.objectId === selectedObjectId ? 'text-[var(--c-accent)]' : ''
                        }`}
                      >
                        {item.name}
                        <span className="ml-2 text-xs text-[var(--c-text-dim)]">{item.language}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </nav>
      {selected && <PouInspector item={selected} />}
    </div>
  )
}

export function PouInspector({ item }: { item: PouTreeItem }) {
  const { pick } = useI18n()
  const isProgram = item.kind === 'PROGRAM'
  return (
    <dl aria-label={pick('Thuộc tính POU', 'POU properties')} className="flex flex-col gap-1 border-t border-[var(--c-border)] pt-2 text-sm">
      <Field label={pick('Tên', 'Name')} value={item.name} />
      <Field label={pick('Loại', 'Kind')} value={item.kind} />
      <Field label={pick('Ngôn ngữ', 'Language')} value={item.language} />
      {/* Chu kỳ và trạng thái bật CHỈ hiện với PROGRAM — xem chú thích đầu tệp. */}
      {isProgram && item.periodMs !== undefined && (
        <Field label={pick('Chu kỳ', 'Period')} value={`${item.periodMs} ms`} />
      )}
      {isProgram && (
        <Field
          label={pick('Trạng thái mong muốn', 'Desired state')}
          value={item.desiredEnabled ? pick('Bật', 'Enabled') : pick('Tắt (mặc định cho Program mới)', 'Disabled (default for new programs)')}
        />
      )}
      {!isProgram && (
        <p className="text-[var(--c-text-dim)]">
          {pick(
            'POU dùng chung không có chu kỳ hay trạng thái bật — nó chỉ chạy khi được Program gọi.',
            'Shared POUs have no period or enable state — they run only when a program calls them.'
          )}
        </p>
      )}
    </dl>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[var(--c-text-dim)]">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{value}</dd>
    </div>
  )
}
