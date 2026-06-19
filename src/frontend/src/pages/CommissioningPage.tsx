import { Play, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { apiClient } from '../api/client'
import { Button } from '../components/Button'
import { Panel } from '../components/Panel'
import { PointCard } from '../components/PointCard'
import { StateBlock } from '../components/StateBlock'
import { useToast } from '../components/Toast'
import { useApi } from '../hooks/useApi'
import { useI18n } from '../i18n'
import type { Point } from '../types'

export function CommissioningPage() {
  const state = useApi(apiClient.getPoints, [])
  const toast = useToast()
  const { pick } = useI18n()
  const outputs = useMemo(() => (state.data ?? []).filter((point) => point.kind === 'AO' || point.kind === 'DO'), [state.data])
  const [running, setRunning] = useState<string | null>(null)
  if (state.loading && !state.data) return <StateBlock state="loading" title={pick('Đang tải output', 'Loading outputs')} />

  async function test(point: Point, value: number | boolean) {
    setRunning(point.id)
    try {
      const result = await apiClient.runCommissioningTest(point.id, value)
      toast.push(result.result === 'passed' ? 'success' : 'warn', `${result.pointId}: ${result.message}`)
      await state.refetch()
    } catch (err) {
      toast.push('error', err instanceof Error ? err.message : 'Commissioning failed')
    } finally {
      setRunning(null)
    }
  }

  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-semibold">{pick('Chạy thử', 'Commissioning')}</h1><p className="text-sm text-[var(--c-text-dim)]">{pick('Test AO/DO qua core, luôn ghi audit log', 'Test AO/DO through core, always writing an audit log')}</p></div>
      <Panel title={pick('Kiểm thử output', 'Output test')}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {outputs.map((point) => <div key={point.id} className="space-y-3"><PointCard point={point} /><div className="grid grid-cols-2 gap-2"><Button loading={running === point.id} variant="primary" icon={<Play className="h-4 w-4" />} onClick={() => test(point, point.kind === 'DO' ? true : 50)}>Test</Button><Button variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={() => test(point, point.kind === 'DO' ? false : 0)}>Release</Button></div></div>)}
        </div>
      </Panel>
    </div>
  )
}