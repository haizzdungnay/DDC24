import { useI18n } from '../../../../shared/i18n'

/**
 * `T59-821` / `TC-PGM02-NAV-01` — Code Map cho ST.
 *
 * `AC-FBD-012` nói minimap xuất hiện với sơ đồ **vượt một ngưỡng cấu hình**.
 * Ngưỡng đó chưa từng tồn tại ở đâu trong repo (`grep -i minimap` trên `src`
 * trả 0 kết quả tại 2026-08-27), nên nó được định nghĩa **một lần** ở đây và
 * dùng chung — thay vì mỗi bên tự chọn một con số rồi hai bề mặt cùng tên lại
 * xuất hiện ở hai kích thước khác nhau.
 *
 * Luật số một, và nó là lý do tồn tại của `TC-PGM02-NAV-01`: **điều hướng không
 * được đổi một byte nào của tài liệu.** Code Map chỉ phát ra một offset để
 * người gọi cuộn tới. Nó không nhận `onChange`, không nhận buffer để ghi, và
 * không có đường nào chạm tới nội dung — bất biến đó được ép bằng chính hình
 * dạng props chứ không bằng lời hứa trong chú thích.
 */

/** Số dòng tối thiểu để bản đồ có ích. Dưới ngưỡng, cả tài liệu đã nằm trong một màn hình. */
export const CODE_MAP_MIN_LINES = 80

export interface CodeMapEntry {
  /** Offset ký tự để cuộn tới. */
  offset: number
  line: number
  label: string
  kind: 'POU' | 'VAR_BLOCK' | 'BRANCH' | 'LOOP'
}

const OUTLINE_PATTERNS: readonly { pattern: RegExp; kind: CodeMapEntry['kind'] }[] = [
  { pattern: /^\s*(PROGRAM|FUNCTION_BLOCK|FUNCTION)\s+([A-Za-z_][A-Za-z0-9_]*)/i, kind: 'POU' },
  { pattern: /^\s*(VAR(?:_INPUT|_OUTPUT|_IN_OUT|_TEMP)?)\b/i, kind: 'VAR_BLOCK' },
  { pattern: /^\s*(IF|CASE)\b/i, kind: 'BRANCH' },
  { pattern: /^\s*(FOR|WHILE|REPEAT)\b/i, kind: 'LOOP' },
]

/**
 * Dàn ý của một tài liệu ST.
 *
 * Đọc bằng cùng loại nhận dạng theo dòng mà editor đã dùng cho tô cú pháp —
 * không parse lại bằng một ngữ pháp thứ hai. Một ngữ pháp thứ hai sẽ lệch khỏi
 * ngữ pháp thứ nhất, và bản đồ sẽ chỉ tới một dòng khác dòng người dùng bấm.
 */
export function stCodeMapEntries(source: string): CodeMapEntry[] {
  const entries: CodeMapEntry[] = []
  let offset = 0
  source.split('\n').forEach((text, index) => {
    for (const { pattern, kind } of OUTLINE_PATTERNS) {
      const match = text.match(pattern)
      if (match) {
        entries.push({ offset, line: index + 1, kind, label: text.trim().slice(0, 60) })
        break
      }
    }
    offset += text.length + 1
  })
  return entries
}

export function shouldShowCodeMap(source: string): boolean {
  return source.split('\n').length >= CODE_MAP_MIN_LINES
}

export function StCodeMap({
  source,
  onNavigate,
}: {
  source: string
  /** CHỈ nhận offset. Không có đường nào để component này ghi vào tài liệu. */
  onNavigate: (offset: number) => void
}) {
  const { pick } = useI18n()
  const entries = stCodeMapEntries(source)
  if (!shouldShowCodeMap(source) || entries.length === 0) return null

  return (
    <nav
      data-testid="st-code-map"
      aria-label={pick('Bản đồ mã nguồn', 'Code map')}
      className="max-h-64 w-48 shrink-0 overflow-y-auto rounded-[var(--radius)] border border-[var(--c-border)] p-1 text-xs"
    >
      <ul>
        {entries.map((entry) => (
          <li key={`${entry.line}-${entry.offset}`}>
            <button
              type="button"
              data-testid="st-code-map-entry"
              data-line={entry.line}
              className="flex w-full items-baseline gap-1 rounded px-1 py-0.5 text-left hover:bg-[var(--c-surface-2)]"
              onClick={() => onNavigate(entry.offset)}
            >
              <span className="w-8 shrink-0 text-right font-mono text-[10px] text-[var(--c-text-dim)]">{entry.line}</span>
              <span className="truncate font-mono text-[var(--c-text)]">{entry.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
