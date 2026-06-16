import { ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { apiClient } from '../api/client'
import { Button } from '../components/Button'
import { Panel } from '../components/Panel'
import { StatusBadge } from '../components/StatusBadge'
import { useToast } from '../components/Toast'
import type { GraphValidationResult } from '../types'

const sample = JSON.stringify({ name: 'ahu-basic', safeState: true, outputs: [{ id: 'AO-01', limit: { min: 0, max: 100 } }] }, null, 2)

export function ValidatorPage() {
  const [text, setText] = useState(sample)
  const [result, setResult] = useState<GraphValidationResult | null>(null)
  const [loading, setLoading] = useState(false)
  const toast = useToast()

  async function validate() {
    setLoading(true)
    try {
      const graph = JSON.parse(text)
      const next = await apiClient.validateGraph('active', graph)
      setResult(next)
      toast.push(next.pass ? 'success' : 'warn', next.pass ? 'Graph hợp lệ' : 'Graph còn lỗi')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Validate failed'
      setResult({ pass: false, errors: [{ path: '$', message, severity: 'error' }] })
      toast.push('error', message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-semibold">Validator</h1><p className="text-sm text-[var(--c-text-dim)]">Kiểm graph.json trước deploy</p></div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_420px]">
        <Panel title="graph.json" action={<Button variant="primary" loading={loading} icon={<ShieldCheck className="h-4 w-4" />} onClick={validate}>Validate</Button>}>
          <textarea value={text} onChange={(event) => setText(event.target.value)} className="mono min-h-[520px] w-full resize-y rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4 text-sm outline-none" spellCheck={false} />
        </Panel>
        <Panel title="Kết quả">
          {result ? <div className="space-y-3"><StatusBadge state={result.pass ? 'online' : 'fault'} label={result.pass ? 'PASS' : 'FAIL'} />{result.errors.map((error, index) => <div key={`${error.path}-${index}`} className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[rgba(11,18,32,0.54)] p-3"><div className="mono text-xs text-[var(--c-accent)]">{error.path}</div><div className="mt-1 text-sm">{error.message}</div></div>)}{result.pass && <p className="text-sm text-[var(--c-text-dim)]">Graph đạt 4 check Rev A: priority, limit AO, safe-state, dangling input.</p>}</div> : <p className="text-sm text-[var(--c-text-dim)]">Chạy validate để xem lỗi theo từng path.</p>}
        </Panel>
      </div>
    </div>
  )
}
