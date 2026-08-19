import { FlaskConical } from 'lucide-react'
import { useState } from 'react'
import { apiClient } from '../../shared/api/client'
import { Button } from '../../shared/components/Button'
import { useI18n } from '../../shared/i18n'
import type { AlarmEstimateResult, AlarmSetting, AlarmSimulateResult } from '../../shared/types'
import { formatDateTime } from '../../shared/utils'

/**
 * Mô phỏng luật cảnh báo trước khi lưu — `T57-2.13` (`ADR-048`).
 *
 * VÌ SAO CẦN
 *
 * Đặt HH/H/L/LL cộng vùng trễ cộng trễ kích hoạt là bốn tham số tương tác với
 * nhau; kết quả của một tổ hợp chỉ lộ ra khi giá trị thật đi qua ngưỡng, tức là
 * sau khi cấu hình đã ở trên thiết bị. Ô nhập này rút vòng lặp đó về vài giây.
 *
 * VÌ SAO KHÔNG TỰ TÍNH Ở ĐÂY
 *
 * `ADR-035`/`ADR-048`: ngữ nghĩa luật thuộc Core. Một bản mô phỏng viết trong
 * giao diện sẽ đúng cho tới ngày nó lệch khỏi Core, và ngày đó người dùng chỉ
 * thấy "màn hình bảo sẽ báo mà thiết bị thì không". Thiếu engine ⇒ **nói ra**,
 * không đoán — kể cả gần đúng.
 */
export function AlarmRuleSimulation({ setting }: { setting: AlarmSetting }) {
  const { pick } = useI18n()
  const [raw, setRaw] = useState('20, 22, 25, 29, 31, 31, 28, 24')
  const [stepS, setStepS] = useState('60')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<AlarmSimulateResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  /* `T57-3.13` — ước lượng theo LỊCH SỬ THẬT của điểm, khác với chuỗi gõ tay ở
     trên. Cùng một engine Core, chỉ khác nguồn mẫu. */
  const [estimate, setEstimate] = useState<AlarmEstimateResult | null>(null)
  const [estimateError, setEstimateError] = useState<string | null>(null)
  const [estimateDays, setEstimateDays] = useState('1')
  const [estimating, setEstimating] = useState(false)
  const estimatePointId = setting.sources[0]?.pointId ?? ''

  const values = parseSampleValues(raw)

  async function run() {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const step = Math.max(1, Number(stepS) || 60)
      /* Mốc thời gian dựng lùi từ HIỆN TẠI: trễ kích hoạt tính bằng giây nên
         khoảng cách giữa các mẫu là dữ liệu thật, không phải trang trí. */
      const start = Date.now() - values.length * step * 1000
      const samples = values.map((value, index) => ({
        t: new Date(start + index * step * 1000).toISOString(),
        value
      }))
      setResult(await apiClient.simulateAlarmSetting(setting, samples))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function runEstimate() {
    setEstimating(true)
    setEstimateError(null)
    setEstimate(null)
    try {
      setEstimate(await apiClient.estimateAlarmSetting(setting, estimatePointId, Math.max(1, Number(estimateDays) || 1)))
    } catch (err) {
      setEstimateError(err instanceof Error ? err.message : String(err))
    } finally {
      setEstimating(false)
    }
  }

  return (
    <section className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--c-text)]">{pick('Thử luật trước khi lưu', 'Test the rule before saving')}</h3>
          <p className="text-xs text-[var(--c-text-dim)]">
            {pick(
              'Chạy bằng chính engine cảnh báo của bộ điều khiển. Không ghi gì xuống thiết bị và không đụng cấu hình đang lưu.',
              'Runs on the controller’s own alarm engine. Nothing is written to the device and the saved configuration is untouched.'
            )}
          </p>
        </div>
        <Button size="sm" icon={<FlaskConical className="h-4 w-4" />} loading={busy} disabled={values.length === 0} onClick={() => { void run() }}>
          {pick('Chạy thử', 'Run')}
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_140px]">
        <label className="block space-y-1 text-xs">
          <span className="font-semibold uppercase text-[var(--c-text-dim)]">{pick('Chuỗi giá trị thử', 'Test values')}</span>
          <input
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
            aria-label={pick('Chuỗi giá trị thử', 'Test values')}
            className="h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
          />
          <span className="block text-[var(--c-text-dim)]">
            {pick(`${values.length} giá trị, phân tách bằng dấu phẩy hoặc khoảng trắng.`, `${values.length} values, separated by commas or spaces.`)}
          </span>
        </label>
        <label className="block space-y-1 text-xs">
          <span className="font-semibold uppercase text-[var(--c-text-dim)]">{pick('Cách nhau (giây)', 'Spacing (s)')}</span>
          <input
            type="number"
            min={1}
            value={stepS}
            onChange={(event) => setStepS(event.target.value)}
            aria-label={pick('Cách nhau (giây)', 'Spacing (s)')}
            className="h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
          />
        </label>
      </div>

      {/* Thiếu engine là tình trạng thường gặp trên bo chưa cài đủ gói. Hiện
          nguyên văn lý do từ backend thay vì một câu "không chạy được" chung
          chung — người đọc là kỹ thuật viên đang tìm gói còn thiếu. */}
      {error && (
        <p role="alert" className="mt-3 rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] px-3 py-2 text-xs text-[var(--c-warn-fg)]">
          {error}
        </p>
      )}

      {/* `T57-3.13` — ước lượng từ lịch sử thật của điểm nguồn. */}
      <div className="mt-4 border-t border-[var(--c-border)] pt-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold text-[var(--c-text)]">{pick('Ước lượng theo lịch sử thật', 'Estimate from real history')}</h4>
            <p className="text-xs text-[var(--c-text-dim)]">
              {estimatePointId
                ? pick(`Chạy luật đang soạn trên lịch sử của ${estimatePointId} để biết nó sẽ bật bao nhiêu lần mỗi ngày.`, `Runs the rule being edited over the history of ${estimatePointId} to see how often it would raise.`)
                : pick('Cần ít nhất một nguồn kích hoạt để biết lấy lịch sử của điểm nào.', 'Add a source first so we know whose history to read.')}
            </p>
          </div>
          <div className="flex items-end gap-2">
            <label className="text-xs">
              {pick('Số ngày', 'Days')}
              <input
                type="number"
                min={1}
                max={7}
                value={estimateDays}
                aria-label={pick('Số ngày lịch sử', 'History days')}
                onChange={(event) => setEstimateDays(event.target.value)}
                className="ml-2 h-9 w-20 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-2 text-sm text-[var(--c-text)]"
              />
            </label>
            <Button size="sm" loading={estimating} disabled={!estimatePointId} onClick={() => { void runEstimate() }}>
              {pick('Ước lượng', 'Estimate')}
            </Button>
          </div>
        </div>

        {/* Không có lịch sử ⇒ backend trả 503. Hiện nguyên văn: biến nó thành
            "0 lần/ngày" sẽ được đọc thành "ngưỡng này an toàn". */}
        {estimateError && (
          <p role="alert" className="mt-2 rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] px-3 py-2 text-xs text-[var(--c-warn-fg)]">
            {estimateError}
          </p>
        )}

        {estimate && (
          <div className="mt-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 text-sm">
            <div>
              <span className="mono text-2xl font-bold">{estimate.raisesPerDay.toFixed(1)}</span>{' '}
              <span className="text-[var(--c-text-dim)]">{pick('lần bật / ngày', 'raises / day')}</span>
              <span className="ml-2 text-xs text-[var(--c-text-dim)]">
                {pick(`(${estimate.raises} lần trong ${estimate.days} ngày)`, `(${estimate.raises} in ${estimate.days} days)`)}
              </span>
            </div>
            {/* Hạ tần phải nói ra: đỉnh ngắn hơn bước lấy mẫu không được nhìn
                thấy, nên con số này thiên về THẤP hơn thực tế. */}
            {estimate.downsampled && (
              <p className="mt-1 text-xs text-[var(--c-warn-fg)]">
                {pick(
                  `Đã hạ tần ${estimate.samplesAvailable} mẫu xuống ${estimate.samplesUsed} (bước ${estimate.stepS} giây). Đợt vượt ngưỡng ngắn hơn ${estimate.stepS} giây không được nhìn thấy, nên con số thật có thể CAO HƠN.`,
                  `Downsampled ${estimate.samplesAvailable} samples to ${estimate.samplesUsed} (${estimate.stepS} s step). Excursions shorter than ${estimate.stepS} s are invisible, so the real number may be HIGHER.`
                )}
              </p>
            )}
          </div>
        )}
      </div>

      {result && (
        <div className="mt-3">
          {result.events.length === 0
            ? (
              <p className="text-sm text-[var(--c-text-dim)]">
                {pick('Chuỗi giá trị này KHÔNG làm cảnh báo bật lần nào với luật đang soạn.', 'This series does NOT raise the alarm with the rule being edited.')}
              </p>
            )
            : (
              <ul className="space-y-1 text-sm">
                {result.events.map((event, index) => (
                  <li key={`${event.at}-${index}`} className="flex flex-wrap items-baseline gap-2">
                    <span className="mono text-xs text-[var(--c-text-dim)]">{formatDateTime(event.at)}</span>
                    <span className="font-semibold">{event.event}</span>
                    {event.severity && <span className="font-bold">{event.severity.toUpperCase()}</span>}
                    <span className="mono">{event.value}</span>
                    {event.reason && <span className="text-[var(--c-text-dim)]">— {event.reason}</span>}
                  </li>
                ))}
              </ul>
            )}
          <p className="mt-2 text-[11px] text-[var(--c-text-dim)]">
            {pick(`Engine: ${result.engine}`, `Engine: ${result.engine}`)}
          </p>
        </div>
      )}
    </section>
  )
}

/** Tách chuỗi nhập tay thành số. Bỏ qua phần không phải số thay vì báo lỗi:
 *  người dùng dán một cột số từ bảng tính là ca dùng chính. */
export function parseSampleValues(raw: string): number[] {
  return raw
    .split(/[\s,;]+/)
    .map((token) => Number(token.trim()))
    .filter((value) => Number.isFinite(value))
}
