import { useState } from 'react'
import { apiClient } from '../../shared/api/client'
import { Button } from '../../shared/components/Button'
import { Panel } from '../../shared/components/Panel'
import { StateBlock } from '../../shared/components/StateBlock'
import { useApi } from '../../shared/hooks/useApi'
import { useI18n } from '../../shared/i18n'
import type { AlarmMetrics } from '../../shared/types'
import { formatDateTime } from '../../shared/utils'

/**
 * Bảng chỉ số hệ alarm ISA-18.2 §16 — `T57-3.3` (`ADR-044`).
 *
 * VÌ SAO ĐÂY LÀ MÀN HÌNH AN TOÀN CHỨ KHÔNG PHẢI THỐNG KÊ
 *
 * ISA-18.2 định nghĩa **alarm flood** bằng chính nhịp cảnh báo: quá 10 cảnh báo
 * trong 10 phút là ngưỡng mà người vận hành không đọc kịp nữa và bắt đầu bỏ qua
 * cả những cảnh báo thật. Một hệ đang ở phía sai của ngưỡng đó trông hệt như
 * một hệ bình thường trên danh sách cảnh báo — chỉ con số nhịp mới nói ra.
 *
 * "Cảnh báo lặp nhiều nhất" là danh sách việc cần làm để hạ nhịp: mỗi mục ở đó
 * thường là một ngưỡng đặt sai hoặc một vùng trễ thiếu, không phải một sự cố.
 *
 * LUẬT: không đọc được nhật ký thì NÓI RA. Backend trả 503 đúng cho tình huống
 * đó (`ADR-044` điều 3) và giao diện phải giữ nguyên sự phân biệt — hiện `0`
 * cho một hệ không đọc được nhật ký là khẳng định một điều mình không biết.
 */
export function AlarmMetricsPanel() {
  const { pick } = useI18n()
  const [window, setWindow] = useState<'10m' | '1h' | '24h' | '7d'>('24h')
  const state = useApi(() => apiClient.getAlarmMetrics(window), [window], { refreshMs: 30_000 })
  /* Chuẩn hoá phòng thủ: một backend cũ hơn (hoặc một hợp đồng đổi) có thể
     thiếu trường, và một `undefined.toFixed()` sẽ hạ cả trang Cảnh báo — trang
     mà người trực cần nhất đúng lúc hệ đang có vấn đề. Thiếu trường thì hiện 0
     ở ĐÚNG ô đó, chứ không phải đánh sập cả màn hình. */
  const metrics = state.data ? normalizeMetrics(state.data) : null

  return (
    <Panel
      title={pick('CHỈ SỐ HỆ CẢNH BÁO (ISA-18.2)', 'ALARM SYSTEM METRICS (ISA-18.2)')}
      action={
        <div className="flex flex-wrap gap-1">
          {(['10m', '1h', '24h', '7d'] as const).map((option) => (
            <Button key={option} size="sm" variant={window === option ? 'primary' : 'secondary'} onClick={() => setWindow(option)}>
              {option}
            </Button>
          ))}
        </div>
      }
    >
      {state.error && !metrics
        ? (
          <StateBlock
            state="error"
            title={pick('Không đọc được nhật ký cảnh báo', 'Alarm history is unreadable')}
            detail={pick(
              `${state.error.message} — chưa đọc được nhật ký thì KHÔNG kết luận được hệ đang yên tĩnh.`,
              `${state.error.message} — an unreadable log is not the same as a quiet system.`
            )}
            onRetry={state.refetch}
          />
        )
        : !metrics
          ? <StateBlock state="loading" title={pick('Đang tính chỉ số', 'Computing metrics')} />
          : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Metric
                  label={pick('Cảnh báo mới / 10 phút', 'New alarms / 10 min')}
                  value={String(metrics.rate10m)}
                  tone={metrics.flooding ? 'critical' : undefined}
                  detail={pick('Ngưỡng ISA-18.2: > 10', 'ISA-18.2 threshold: > 10')}
                />
                <Metric label={pick('Trung bình / giờ', 'Average / hour')} value={metrics.ratePerHour.toFixed(2)} />
                <Metric label={pick('Tổng trong cửa sổ', 'Total in window')} value={String(metrics.totalRaised)} />
                <Metric label={pick('Đang bị treo', 'Shelved')} value={String(metrics.shelved.length)} />
              </div>

              {metrics.flooding && (
                <p role="alert" className="rounded-[var(--radius)] border border-[var(--c-critical)] bg-[var(--c-critical-bg)] px-3 py-2 text-sm font-semibold text-[var(--c-critical)]">
                  {pick(
                    'ALARM FLOOD — nhịp cảnh báo vượt ngưỡng ISA-18.2. Ở nhịp này người trực không đọc kịp và sẽ bỏ sót cảnh báo thật.',
                    'ALARM FLOOD — the alarm rate exceeds the ISA-18.2 threshold. At this rate operators cannot keep up and will miss real alarms.'
                  )}
                </p>
              )}

              <div>
                <h3 className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">
                  {pick('Cảnh báo lặp nhiều nhất', 'Most repeating alarms')}
                </h3>
                {metrics.topRepeating.length === 0
                  ? <p className="mt-1 text-sm text-[var(--c-text-dim)]">{pick('Không có cảnh báo nào trong cửa sổ này.', 'No alarms in this window.')}</p>
                  : (
                    <ul className="mt-1 space-y-1 text-sm">
                      {metrics.topRepeating.map((item) => (
                        <li key={item.alarmId} className="flex flex-wrap items-baseline gap-2">
                          <span className="mono font-semibold">{item.alarmId}</span>
                          {item.name && <span className="text-[var(--c-text-dim)]">{item.name}</span>}
                          <span className="ml-auto font-bold">{item.count}×</span>
                        </li>
                      ))}
                    </ul>
                  )}
                <p className="mt-2 text-xs text-[var(--c-text-dim)]">
                  {pick(
                    'Mục lặp nhiều thường là ngưỡng đặt sát quá hoặc thiếu vùng trễ, không phải một sự cố lặp lại.',
                    'A frequently repeating entry usually means a threshold set too tight or missing hysteresis, not a recurring fault.'
                  )}
                </p>
              </div>

              {metrics.shelved.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase text-[var(--c-text-dim)]">{pick('Đang bị treo', 'Shelved alarms')}</h3>
                  <ul className="mt-1 space-y-1 text-sm">
                    {metrics.shelved.map((item) => (
                      <li key={item.alarmId} className="flex flex-wrap items-baseline gap-2">
                        <span className="mono font-semibold">{item.alarmId}</span>
                        <span className="text-[var(--c-text-dim)]">{formatDateTime(item.shelvedAt)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
    </Panel>
  )
}

function normalizeMetrics(raw: AlarmMetrics): AlarmMetrics {
  const number = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0
  return {
    window: raw.window ?? '',
    windowS: number(raw.windowS),
    rate10m: number(raw.rate10m),
    ratePerHour: number(raw.ratePerHour),
    totalRaised: number(raw.totalRaised),
    flooding: Boolean(raw.flooding),
    topRepeating: Array.isArray(raw.topRepeating) ? raw.topRepeating : [],
    shelved: Array.isArray(raw.shelved) ? raw.shelved : []
  }
}

function Metric({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: 'critical' }) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3">
      <div className="text-xs text-[var(--c-text-dim)]">{label}</div>
      <div className={`mono mt-1 text-2xl font-bold${tone === 'critical' ? ' text-[var(--c-critical)]' : ''}`}>{value}</div>
      {detail && <div className="mt-1 text-[11px] text-[var(--c-text-dim)]">{detail}</div>}
    </div>
  )
}
