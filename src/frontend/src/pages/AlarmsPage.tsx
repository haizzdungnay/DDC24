import { Filter, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { apiClient } from '../api/client'
import { AlarmRow } from '../components/AlarmRow'
import { Button } from '../components/Button'
import { Panel } from '../components/Panel'
import { StateBlock } from '../components/StateBlock'
import { useToast } from '../components/Toast'
import { useApi } from '../hooks/useApi'
import { useI18n } from '../i18n'
import type { Alarm } from '../types'

type AlarmFilter = 'all' | Alarm['status']

export function AlarmsPage() {
  const state = useApi(apiClient.getAlarms, [])
  const toast = useToast()
  const { pick } = useI18n()
  const [filter, setFilter] = useState<AlarmFilter>('all')
  const [query, setQuery] = useState('')
  const alarms = state.data ?? []
  const rows = useMemo(() => alarms.filter((alarm) => (filter === 'all' || alarm.status === filter) && `${alarm.message} ${alarm.source}`.toLowerCase().includes(query.toLowerCase())), [alarms, filter, query])

  async function ack(alarm: Alarm) {
    try {
      await apiClient.ackAlarm(alarm.id)
      await state.refetch()
      toast.push('success', `Ack ${alarm.id}`)
    } catch (err) {
      toast.push('error', err instanceof Error ? err.message : 'Ack failed')
    }
  }

  if (state.loading && !alarms.length) return <StateBlock state="loading" title={pick('Đang tải alarm', 'Loading alarms')} />
  if (state.error && !alarms.length) return <StateBlock state="error" title={pick('Không tải được alarm', 'Could not load alarms')} detail={state.error.message} onRetry={state.refetch} />

  const filterLabels: Record<AlarmFilter, string> = {
    all: pick('tất cả', 'all'),
    active: pick('active', 'active'),
    unack: pick('chưa ack', 'unack'),
    acked: pick('đã ack', 'acked'),
    shelved: pick('shelved', 'shelved')
  }

  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-semibold">{pick('Cảnh báo', 'Alarms')}</h1><p className="text-sm text-[var(--c-text-dim)]">{pick('Theo dõi, lọc và acknowledge cảnh báo', 'Monitor, filter, and acknowledge alarms')}</p></div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Summary label={pick('Đang active', 'Active')} value={alarms.filter((a) => a.status === 'active').length} accent="fault" />
        <Summary label={pick('Chưa acknowledge', 'Unacknowledged')} value={alarms.filter((a) => a.status === 'unack').length} accent="warn" />
        <Summary label="Shelved" value={alarms.filter((a) => a.status === 'shelved').length} accent="info" />
        <Summary label={pick('Hôm nay', 'Today')} value={alarms.length} accent="good" />
      </div>
      <Panel>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {(['all', 'active', 'unack', 'acked', 'shelved'] as const).map((item) => <Button key={item} size="sm" variant={filter === item ? 'primary' : 'secondary'} onClick={() => setFilter(item)}>{filterLabels[item]}</Button>)}
          <label className="ml-auto flex h-9 min-w-[260px] items-center gap-2 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-3">
            <Search className="h-4 w-4 text-[var(--c-text-dim)]" /><input className="w-full bg-transparent text-sm outline-none" placeholder={pick('Tìm kiếm alarm...', 'Search alarms...')} value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <Button size="sm" icon={<Filter className="h-4 w-4" />}>{pick('Lọc', 'Filter')}</Button>
        </div>
        <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)]">
          {rows.map((alarm) => <AlarmRow key={alarm.id} alarm={alarm} onAck={ack} />)}
          {!rows.length && <StateBlock state="empty" title={pick('Không có alarm phù hợp', 'No matching alarms')} />}
        </div>
      </Panel>
    </div>
  )
}

function Summary({ label, value, accent }: { label: string; value: number; accent: 'fault' | 'warn' | 'info' | 'good' }) {
  const color = accent === 'fault' ? 'var(--c-fault-fg)' : accent === 'warn' ? 'var(--c-warn-fg)' : accent === 'info' ? 'var(--c-info)' : 'var(--c-good-fg)'
  return <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-4"><div className="mono text-4xl font-bold" style={{ color }}>{value}</div><div className="mt-2 text-xs text-[var(--c-text-dim)]">{label}</div></div>
}