import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useI18n } from '../../../../shared/i18n'
import type { StRuntimeQuality } from '../editor/StRuntimeValueOverlay'

/**
 * `DEV-PROG-003` — khay **Watch (Live)** của workbench.
 *
 * Bản trước chỉ có hai cột `Biến`/`Giá trị`. Hai cột đó trả lời được "bây giờ
 * bằng bao nhiêu" nhưng không trả lời được ba câu mà người đang chỉnh định thật
 * sự hỏi: *số này có tin được không* (quality), *nó cũ tới mức nào* (mốc đọc),
 * và *nó đang đi lên hay đi xuống* (xu hướng). Thiếu ba câu đó thì một giá trị
 * đóng băng vì mất kết nối trông y hệt một giá trị đang ổn định.
 *
 * Ba luật của khay này:
 *
 * 1. **Không có số nào được chế ra.** `presentStRuntimeValue` (nơi DUY NHẤT
 *    biết luật "null/BAD/OFFLINE không bao giờ thành 0") vẫn là nguồn của cột
 *    Giá trị; khay này chỉ thêm cột chứ không diễn giải lại.
 * 2. **Đường xu hướng chỉ vẽ mẫu ĐÃ THẤY.** Lịch sử bắt đầu từ lúc mở khay,
 *    không phải từ lúc thiết bị khởi động — và khay nói ra điều đó thay vì vẽ
 *    một đường trông như đã theo dõi cả phiên.
 * 3. **Bỏ một biến khỏi danh sách là việc của người dùng, không phải của hệ
 *    thống.** Biến bị bỏ vẫn có đường quay lại (nút `+`), nếu không thì "bỏ
 *    theo dõi" là một hành động không hoàn tác được cho một thao tác chỉ nhằm
 *    dọn màn hình.
 */

/** Số mẫu tối đa giữ cho mỗi biến. Ở nhịp poll 1 s, 60 mẫu = 60 giây. */
export const WATCH_HISTORY_SAMPLES = 60

export interface WatchRow {
  variableId: string
  name: string
  /** Đã trình bày sẵn bởi `presentStRuntimeValue`. */
  display: string
  state: 'live' | 'uncertain' | 'stale' | 'invalid'
  quality: StRuntimeQuality
  unit?: string
  /** Kiểu dữ liệu tra từ khai báo trong POU; `undefined` = không tra được. */
  typeName?: string
  /** Mốc đọc do authority cấp; `undefined` = không có mốc, hiện `—`. */
  observedAt?: string
  /** Giá trị số để vẽ xu hướng. `null` = mẫu này không vẽ được (BOOL vẫn vẽ
   *  được vì quy về 0/1; chuỗi và giá trị không hợp lệ thì không). */
  numeric: number | null
}

interface Sample {
  at: number
  value: number
}

export function WorkbenchWatchPanel({
  rows,
  /** Yêu cầu thêm biến từ ngoài (nháy đúp trong trình soạn thảo). */
  addRequest,
}: {
  rows: readonly WatchRow[]
  addRequest?: { name: string; nonce: number } | null
}) {
  const { pick } = useI18n()
  /** Biến người dùng đã bỏ khỏi danh sách. Mặc định theo dõi tất cả. */
  const [hidden, setHidden] = useState<readonly string[]>([])
  const [picking, setPicking] = useState(false)
  const history = useRef(new Map<string, Sample[]>())
  const lastAddNonce = useRef<number | null>(null)

  /* Ghi mẫu MỖI lần snapshot đổi. Đặt trong `useEffect` chứ không trong thân
   * render: React có thể render lại cùng một snapshot (đổi tab, đổi ngôn ngữ),
   * và ghi trong render sẽ nhân bản mẫu — làm đường xu hướng dày lên ở đúng
   * những lúc không có dữ liệu mới. */
  useEffect(() => {
    const at = Date.now()
    for (const row of rows) {
      if (row.numeric === null) continue
      const series = history.current.get(row.variableId) ?? []
      series.push({ at, value: row.numeric })
      if (series.length > WATCH_HISTORY_SAMPLES) series.splice(0, series.length - WATCH_HISTORY_SAMPLES)
      history.current.set(row.variableId, series)
    }
  }, [rows])

  /* Nháy đúp một ký hiệu trong trình soạn thảo = "cho tôi xem biến này". Nếu nó
   * đang bị ẩn thì bỏ ẩn; nếu nó vốn đã hiện thì không có gì để làm. */
  useEffect(() => {
    if (!addRequest || addRequest.nonce === lastAddNonce.current) return
    lastAddNonce.current = addRequest.nonce
    setHidden((current) => current.filter((name) => name !== addRequest.name))
  }, [addRequest])

  const visible = useMemo(() => rows.filter((row) => !hidden.includes(row.name)), [rows, hidden])
  const removed = useMemo(() => rows.filter((row) => hidden.includes(row.name)), [rows, hidden])

  if (rows.length === 0) {
    /* Nguồn CÓ nhưng POU này không có biến nào được ánh xạ — khác hẳn "không có
     * nguồn giá trị". Hai câu dẫn tới hai việc khác nhau. */
    return (
      <p role="status" className="text-xs text-[var(--c-text-dim)]">
        {pick('POU đang mở không có biến runtime nào được ánh xạ.', 'The open POU has no mapped runtime variables.')}
      </p>
    )
  }

  return (
    <div className="space-y-2" data-testid="workbench-watch">
      <table className="w-full text-xs">
        <caption className="sr-only">{pick('Giá trị runtime theo biến', 'Runtime values by variable')}</caption>
        <thead>
          <tr className="text-left text-[var(--c-text-dim)]">
            <th scope="col" className="py-1">{pick('Biến', 'Name')}</th>
            <th scope="col" className="py-1">{pick('Giá trị', 'Value')}</th>
            <th scope="col" className="py-1">{pick('Kiểu', 'Type')}</th>
            <th scope="col" className="py-1">{pick('Chất lượng', 'Quality')}</th>
            <th scope="col" className="py-1">{pick('Mốc đọc', 'Timestamp')}</th>
            <th scope="col" className="py-1">{pick('Xu hướng', 'Trend')}</th>
            <th scope="col" className="py-1"><span className="sr-only">{pick('Bỏ theo dõi', 'Stop watching')}</span></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <tr key={row.variableId} className="border-t border-[var(--c-border)]" data-testid="workbench-watch-row">
              <td className="py-1 font-mono text-[var(--c-text)]">{row.name}</td>
              <td className={`py-1 font-mono ${WATCH_STATE_CLASS[row.state]}`}>
                {row.display}{row.unit && row.state !== 'invalid' ? ` ${row.unit}` : ''}
              </td>
              <td className="py-1 font-mono text-[var(--c-text-dim)]">{row.typeName ?? '—'}</td>
              <td className="py-1">
                <QualityBadge quality={row.quality} />
              </td>
              <td className="py-1 font-mono text-[var(--c-text-dim)]">{formatObserved(row.observedAt)}</td>
              <td className="py-1">
                <Sparkline samples={history.current.get(row.variableId) ?? []} label={row.name} />
              </td>
              <td className="py-1 text-right">
                <button
                  type="button"
                  className="rounded p-1 text-[var(--c-text-dim)] hover:text-[var(--c-fault-fg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
                  aria-label={pick(`Bỏ theo dõi ${row.name}`, `Stop watching ${row.name}`)}
                  onClick={() => setHidden((current) => [...current, row.name])}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {visible.length === 0 && (
        <p role="status" className="text-xs text-[var(--c-text-dim)]">
          {pick('Đã bỏ theo dõi tất cả biến. Dùng nút bên dưới để thêm lại.', 'All variables were removed from the list. Use the button below to add them back.')}
        </p>
      )}

      {removed.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            aria-expanded={picking}
            className="inline-flex items-center gap-1 rounded border border-[var(--c-border)] px-2 py-1 text-xs text-[var(--c-text-dim)] hover:text-[var(--c-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
            onClick={() => setPicking((open) => !open)}
          >
            <Plus className="h-3 w-3" aria-hidden="true" />
            {pick(`Thêm biến (${removed.length})`, `Add variable (${removed.length})`)}
          </button>
          {picking && removed.map((row) => (
            <button
              key={row.variableId}
              type="button"
              className="rounded bg-[var(--c-surface-2)] px-2 py-1 font-mono text-xs text-[var(--c-text)] hover:text-[var(--c-accent)]"
              onClick={() => setHidden((current) => current.filter((name) => name !== row.name))}
            >
              {row.name}
            </button>
          ))}
        </div>
      )}

      <p className="text-[10px] text-[var(--c-text-dim)]">
        {pick(
          `Xu hướng vẽ tối đa ${WATCH_HISTORY_SAMPLES} mẫu ĐÃ THẤY kể từ lúc mở khay này — không phải toàn bộ lịch sử của thiết bị. Lịch sử dài hạn ở trang Runtime & Bảo trì.`,
          `The trend draws at most ${WATCH_HISTORY_SAMPLES} samples SEEN since this panel opened — not the device's full history. Long-term history lives in Runtime & Maintenance.`
        )}
      </p>
    </div>
  )
}

const WATCH_STATE_CLASS: Record<WatchRow['state'], string> = {
  live: 'text-[var(--c-good-fg)]',
  uncertain: 'text-[var(--c-warn-fg)]',
  stale: 'text-[var(--c-warn-fg)]',
  invalid: 'text-[var(--c-text-dim)]',
}

/**
 * Chất lượng bằng CHỮ kèm màu, không chỉ bằng màu — một chấm màu là tín hiệu
 * duy nhất thì người mù màu không đọc được, và ảnh chụp đen trắng trong hồ sơ
 * nghiệm thu cũng vậy.
 */
function QualityBadge({ quality }: { quality: StRuntimeQuality }) {
  const { pick } = useI18n()
  const label: Record<StRuntimeQuality, string> = {
    GOOD: pick('Tốt', 'Good'),
    UNCERTAIN: pick('Chưa chắc', 'Uncertain'),
    BAD: pick('Xấu', 'Bad'),
    STALE: pick('Cũ', 'Stale'),
    OFFLINE: pick('Mất kết nối', 'Offline'),
    UNKNOWN: pick('Chưa rõ', 'Unknown'),
    UNAVAILABLE: pick('Không khả dụng', 'Unavailable'),
  }
  const tone = quality === 'GOOD'
    ? 'border-[var(--c-good-fg)] text-[var(--c-good-fg)]'
    : quality === 'UNCERTAIN' || quality === 'STALE'
      ? 'border-[var(--c-warn-fg)] text-[var(--c-warn-fg)]'
      : quality === 'BAD' || quality === 'OFFLINE'
        ? 'border-[var(--c-fault-fg)] text-[var(--c-fault-fg)]'
        : 'border-[var(--c-border)] text-[var(--c-text-dim)]'
  return (
    <span data-quality={quality} className={`rounded-full border px-1.5 py-0.5 text-[10px] ${tone}`}>
      {label[quality]}
    </span>
  )
}

/**
 * Đường xu hướng thu nhỏ. Dưới hai mẫu thì KHÔNG vẽ gì: một điểm đơn lẻ kéo
 * thành đường ngang trông như "giá trị ổn định", trong khi sự thật là chưa đủ
 * dữ liệu để nói bất cứ điều gì.
 */
function Sparkline({ samples, label }: { samples: readonly Sample[]; label: string }) {
  const { pick } = useI18n()
  if (samples.length < 2) {
    return <span className="text-[10px] text-[var(--c-text-dim)]">{pick('chưa đủ mẫu', 'not enough samples')}</span>
  }
  const values = samples.map((sample) => sample.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min
  const width = 72
  const height = 16
  const points = samples.map((sample, index) => {
    const x = (index / (samples.length - 1)) * width
    /* Dải phẳng (mọi mẫu bằng nhau) thì vẽ giữa khung: chia cho 0 sẽ ra `NaN`
     * và SVG im lặng bỏ cả đường, tức mất tín hiệu mà không có lỗi nào. */
    const y = span === 0 ? height / 2 : height - ((sample.value - min) / span) * height
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg
      role="img"
      aria-label={pick(
        `Xu hướng ${label}: ${samples.length} mẫu, thấp nhất ${min}, cao nhất ${max}`,
        `${label} trend: ${samples.length} samples, min ${min}, max ${max}`
      )}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
    >
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1" className="text-[var(--c-accent)]" />
    </svg>
  )
}

/**
 * Mốc đọc hiện theo GIỜ ĐỊA PHƯƠNG tới mili-giây. Mốc không đọc được thì `—`:
 * một chuỗi ISO hỏng in nguyên ra màn hình chỉ làm người đọc tưởng đó là một
 * mốc thật có định dạng lạ.
 */
export function formatObserved(observedAt: string | undefined): string {
  if (!observedAt) return '—'
  const at = new Date(observedAt)
  if (Number.isNaN(at.getTime())) return '—'
  const pad = (value: number, size = 2) => String(value).padStart(size, '0')
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}.${pad(at.getMilliseconds(), 3)}`
}
