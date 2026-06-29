import { Box, Plus, Rocket, RotateCcw, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../components/Button'
import { Panel } from '../components/Panel'
import { StatusBadge } from '../components/StatusBadge'
import { useToast } from '../components/Toast'
import { validateGraphLocal } from '../demo/simulator'
import { useI18n } from '../i18n'
import type { Graph, GraphNode, GraphValidationResult } from '../types'

type LibraryItem = {
  type: string
  label: string
  detail: string
  inputs?: string[]
  outputs?: string[]
  params?: Record<string, unknown>
  power_on?: Record<string, unknown>
}

const sampleGraph: Graph = {
  schema_version: '1.0',
  device: { bacnet_device_id: 1001, name: 'AHU01_DDC', scan_ms: 1000 },
  io_map: {
    ui: [{ node: 'ui1', channel: 0, sensor: 'ntc10k', unit: 'degC', fallback: 22 }],
    ao: [{ node: 'ao1', channel: 0, mode: '0-10V', limit_lo: 0, limit_hi: 100, safeState: 0 }]
  },
  modbus: {
    rtu: [{ bus: 1, baud: 9600, slave: 5, poll_ms: 1000, points: [{ node: 'vfd_hz_r', fc: 4, addr: 100, type: 'u16', scale: 0.1, fallback: 0 }] }]
  },
  nodes: [
    { id: 'ui1', type: 'UI_Input', ports: { outputs: ['out'] }, params: { channel: 0, fallback: 22 } },
    { id: 'sp1', type: 'Setpoint', ports: { outputs: ['out'] }, params: { default: 24 } },
    { id: 'pid1', type: 'PID', ports: { inputs: ['pv', 'sp'], outputs: ['out'] }, params: { kp: 2, ki: 0.5, kd: 0, out_lo: 0, out_hi: 100, direction: 'reverse' }, power_on: { out: 0 } },
    { id: 'ao1', type: 'AO_Output', ports: { inputs: ['in'] }, params: { channel: 0, limit_lo: 0, limit_hi: 100, safeState: 0 }, power_on: { in: 0 } },
    { id: 'vfd_hz_r', type: 'Modbus_Read', ports: { outputs: ['out'] }, params: { fallback: 0 } }
  ],
  links: [
    { from: 'ui1.out', to: 'pid1.pv' },
    { from: 'sp1.out', to: 'pid1.sp' },
    { from: 'pid1.out', to: 'ao1.in' }
  ],
  meta: { author: 'demo', rev: 1 }
}

const componentLibrary: LibraryItem[] = [
  { type: 'UI_Input', label: 'UI_Input', detail: 'Universal input with fallback.', outputs: ['out'], params: { channel: 0, fallback: 0 } },
  { type: 'Setpoint', label: 'Setpoint', detail: 'Operator setpoint source.', outputs: ['out'], params: { default: 24 } },
  { type: 'PID', label: 'PID', detail: 'Closed-loop controller.', inputs: ['pv', 'sp'], outputs: ['out'], params: { kp: 1, ki: 0.1, kd: 0, out_lo: 0, out_hi: 100 }, power_on: { out: 0 } },
  { type: 'AO_Output', label: 'AO_Output', detail: 'Analog output with limits.', inputs: ['in'], params: { channel: 0, limit_lo: 0, limit_hi: 100, safeState: 0 }, power_on: { in: 0 } },
  { type: 'Modbus_Read', label: 'Modbus_Read', detail: 'Read register with fallback.', outputs: ['out'], params: { fc: 4, addr: 100, type: 'u16', scale: 1, fallback: 0 } },
  { type: 'AND', label: 'Logic AND', detail: 'Boolean AND.', inputs: ['a', 'b'], outputs: ['out'] },
  { type: 'OR', label: 'Logic OR', detail: 'Boolean OR.', inputs: ['a', 'b'], outputs: ['out'] },
  { type: 'OnDelay', label: 'Timer TON', detail: 'On-delay timer.', inputs: ['in'], outputs: ['out'], params: { delay_s: 5 } },
  { type: 'OffDelay', label: 'Timer TOF', detail: 'Off-delay timer.', inputs: ['in'], outputs: ['out'], params: { delay_s: 5 } },
  { type: 'Interlock', label: 'Interlock', detail: 'Safety permissive gate.', inputs: ['cmd', 'safe'], outputs: ['out'], params: { safeState: false } },
  { type: 'AlarmDelay', label: 'AlarmDelay', detail: 'Delay alarm assertion.', inputs: ['in'], outputs: ['out'], params: { delay_s: 10 } },
  { type: 'RuntimeCounter', label: 'RuntimeCounter', detail: 'Accumulate run hours.', inputs: ['run'], outputs: ['hours'] },
  { type: 'PulseCounter', label: 'PulseCounter', detail: 'Count digital pulses.', inputs: ['pulse'], outputs: ['count'] }
]

const sampleText = JSON.stringify(sampleGraph, null, 2)

const severityClass = {
  error: 'border-[rgba(213,32,42,0.46)] bg-[rgba(213,32,42,0.10)] text-[var(--c-fault-fg)]',
  warn: 'border-[rgba(232,181,0,0.46)] bg-[rgba(232,181,0,0.12)] text-[var(--c-warn-fg)]'
}

export function ProgrammingPage() {
  const [text, setText] = useState(sampleText)
  const [result, setResult] = useState<GraphValidationResult | null>(null)
  const [loading, setLoading] = useState(false)
  const toast = useToast()
  const { pick } = useI18n()

  function updateText(value: string) {
    setText(value)
    setResult(null)
  }

  function validate() {
    setLoading(true)
    const next = validateGraphLocal(text)
    setResult(next)
    setLoading(false)
    toast.push(next.pass ? 'success' : 'warn', next.pass ? pick('Graph hợp lệ', 'Graph is valid') : pick(`Graph còn ${next.errors.length} lỗi`, `Graph has ${next.errors.length} errors`))
  }

  function loadSample() {
    updateText(sampleText)
    toast.push('info', pick('Đã nạp sample graph hợp lệ', 'Valid sample graph loaded'))
  }

  function deployDemo() {
    if (!result?.pass) return
    toast.push('success', pick('Đã deploy (demo)', 'Deployed (demo)'))
  }

  function addNode(item: LibraryItem) {
    try {
      const graph = JSON.parse(text) as Partial<Graph>
      if (!isRecord(graph)) throw new Error(pick('graph.json phải là object', 'graph.json must be an object'))
      const nodes = Array.isArray(graph.nodes) ? graph.nodes : []
      const id = nextNodeId(item.type, nodes)
      const node = buildNode(item, id)
      const nextGraph = { ...graph, nodes: [...nodes, node], links: Array.isArray(graph.links) ? graph.links : [] }
      updateText(JSON.stringify(nextGraph, null, 2))
      toast.push('success', pick(`Đã thêm ${item.label}`, `Added ${item.label}`))
    } catch (error) {
      toast.push('error', error instanceof Error ? error.message : pick('Không thể thêm node', 'Could not add node'))
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{pick('Lập trình', 'Programming')}</h1>
          <p className="text-sm text-[var(--c-text-dim)]">{pick('Lập trình graph.json bằng thư viện component demo, validate và deploy có điều kiện', 'Program graph.json with the demo component library, validation, and gated deploy')}</p>
        </div>
        <StatusBadge state={result ? result.pass ? 'online' : 'fault' : 'unknown'} label={result ? result.pass ? 'PASS' : 'FAIL' : pick('CHƯA KIỂM', 'NOT TESTED')} />
      </div>

      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[320px_minmax(520px,1fr)_420px]">
        <Panel title={pick('Thư viện component', 'Component library')} subtitle={pick('Bấm Thêm để chèn node skeleton vào graph.json.', 'Click Add to insert a node skeleton into graph.json.')}>
          <div className="max-h-[720px] space-y-2 overflow-auto pr-1">
            {componentLibrary.map((item) => (
              <div key={item.type} className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold"><Box className="h-4 w-4 text-[var(--c-accent)]" />{item.label}</div>
                    <div className="mt-1 text-xs text-[var(--c-text-dim)]">{item.detail}</div>
                  </div>
                  <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => addNode(item)}>{pick('Thêm', 'Add')}</Button>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          title="graph.json"
          subtitle={pick('Dán graph.json hoặc nạp sample hợp lệ để chạy 4 check Rev A. Không canvas kéo-thả, không IEC.', 'Paste graph.json or load a valid sample to run the four Rev A checks. No drag-and-drop canvas, no IEC.')}
          action={(
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={<RotateCcw className="h-4 w-4" />} onClick={loadSample}>{pick('Nạp sample', 'Load sample')}</Button>
              <Button size="sm" variant="primary" loading={loading} icon={<ShieldCheck className="h-4 w-4" />} onClick={validate}>Validate/Test</Button>
            </div>
          )}
        >
          <textarea
            value={text}
            onChange={(event) => updateText(event.target.value)}
            className="mono min-h-[640px] w-full resize-y rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] p-4 text-sm leading-6 text-[var(--c-text)] outline-none transition focus:border-[var(--c-accent)]"
            spellCheck={false}
          />
        </Panel>

        <Panel
          title={pick('Kết quả', 'Results')}
          subtitle={pick('Validator v1: input chưa nối, nhiều nguồn ghi output, AO limit, Modbus/sensor fallback.', 'Validator v1: unconnected input, multiple output writers, AO limits, Modbus/sensor fallback.')}
          action={<Button variant="primary" icon={<Rocket className="h-4 w-4" />} disabled={!result?.pass} onClick={deployDemo}>Deploy (demo)</Button>}
        >
          {!result && <p className="text-sm text-[var(--c-text-dim)]">{pick('Chưa chạy kiểm tra. Dán hoặc sửa graph rồi bấm Validate/Test.', 'No validation run yet. Paste or edit the graph, then click Validate/Test.')}</p>}

          {result && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3">
                <div>
                  <div className="text-sm font-semibold">{result.pass ? pick('Graph sẵn sàng deploy demo', 'Graph is ready for demo deploy') : pick('Graph chưa đạt điều kiện deploy', 'Graph is not ready for deploy')}</div>
                  <div className="mt-1 text-xs text-[var(--c-text-dim)]">{result.pass ? pick('Không có lỗi trong 4 check Rev A.', 'No errors in the four Rev A checks.') : pick(`${result.errors.length} lỗi cần xử lý.`, `${result.errors.length} errors need fixing.`)}</div>
                </div>
                <StatusBadge state={result.pass ? 'online' : 'fault'} label={result.pass ? 'PASS' : 'FAIL'} />
              </div>

              {result.errors.length > 0 && (
                <div className="space-y-3">
                  {result.errors.map((error, index) => (
                    <div key={`${error.path}-${index}`} className={`rounded-[var(--radius)] border p-3 ${severityClass[error.severity]}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="mono text-xs">{error.path}</div>
                        <div className="text-[10px] font-semibold uppercase">{error.severity}</div>
                      </div>
                      <div className="mt-2 text-sm text-[var(--c-text)]">{error.message}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}

function buildNode(item: LibraryItem, id: string): GraphNode {
  return {
    id,
    type: item.type,
    ports: {
      ...(item.inputs ? { inputs: item.inputs } : {}),
      ...(item.outputs ? { outputs: item.outputs } : {})
    },
    ...(item.params ? { params: item.params } : {}),
    ...(item.power_on ? { power_on: item.power_on } : {})
  }
}

function nextNodeId(type: string, nodes: GraphNode[]): string {
  const prefix = type.replace(/[^a-z0-9]+/gi, '_').toLowerCase()
  let index = nodes.length + 1
  let id = `${prefix}_${index}`
  const existing = new Set(nodes.map((node) => node.id))
  while (existing.has(id)) {
    index += 1
    id = `${prefix}_${index}`
  }
  return id
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
