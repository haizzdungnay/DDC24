import { useI18n } from '../../../../shared/i18n'

/**
 * `T59-821` / `TC-PGM02-NAV-01` — Code Map cho ST.
 *
 * Không có ngưỡng độ dài. Bản trước ẩn bản đồ dưới 80 dòng với lý do "cả tài
 * liệu đã nằm trong một màn hình" — nhưng nó ẩn **im lặng**: không dòng nào nói
 * vì sao, nên một POU ngắn nhìn từ ngoài giống hệt một tính năng hỏng. Chủ sở
 * hữu chốt 2026-08-30 là luôn hiện, ngắn hay dài.
 *
 * `AC-FBD-012` ("minimap cho sơ đồ vượt ngưỡng cấu hình") KHÔNG ràng buộc chỗ
 * này: nó nói về minimap của FBD và được truy vết tới `FbdCanvas.test.tsx`,
 * vốn có ngưỡng riêng `FBD_MINIMAP_NODE_THRESHOLD`. ST chỉ từng mượn con số đó.
 *
 * Luật số một, và nó là lý do tồn tại của `TC-PGM02-NAV-01`: **điều hướng không
 * được đổi một byte nào của tài liệu.** Code Map chỉ phát ra một offset để
 * người gọi cuộn tới. Nó không nhận `onChange`, không nhận buffer để ghi, và
 * không có đường nào chạm tới nội dung — bất biến đó được ép bằng chính hình
 * dạng props chứ không bằng lời hứa trong chú thích.
 */


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

/**
 * Cổng DUY NHẤT còn lại: có mục nào để chỉ tới không.
 *
 * Người gọi phải hỏi hàm này TRƯỚC khi dựng khung chứa. Để component tự trả
 * `null` là chưa đủ — khung `w-44` vẫn tồn tại và vẫn ăn mất bề ngang của chính
 * chỗ gõ, đúng lỗi đã sửa một lần ở `ProgramsTab`.
 */
export function shouldShowCodeMap(source: string): boolean {
  return stCodeMapEntries(source).length > 0
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
  if (entries.length === 0) return null

  return (
    <nav
      data-testid="st-code-map"
      aria-label={pick('Bản đồ mã nguồn', 'Code map')}
      /* Cao BẰNG khung chứa, không phải một trần cố định `max-h-64`: trần cũ
         hợp lý khi bản đồ nằm dưới cây POU, nhưng ở dải dọc cạnh chỗ gõ nó cắt
         danh sách còn vài mục trong khi cột bên cạnh cao gấp ba. */
      className="h-full w-full overflow-y-auto rounded-[var(--radius)] border border-[var(--c-border)] p-1 text-xs"
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
