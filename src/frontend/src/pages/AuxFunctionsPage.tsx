import { useState } from 'react'
import { Panel } from '../components/Panel'
import { Button } from '../components/Button'
import { StatusBadge } from '../components/StatusBadge'
import { useToast } from '../components/Toast'
import { validateGraphLocal, getDemoGraph } from '../demo/simulator'
import { useI18n } from '../i18n'
import type { GraphNode, GraphLink, GraphValidationResult } from '../types'
import { Rocket, Box } from 'lucide-react'

type AuxFunctionId = 'fu1' | 'fu2' | 'fu3' | 'fu4' | 'fu5'

interface AuxFunctionDef {
  id: AuxFunctionId
  labelVi: string
  labelEn: string
  descVi: string
  descEn: string
  inputs: Array<{ key: string; labelVi: string; labelEn: string; type: 'point' | 'number' }>
  generate: (inputs: Record<string, string>) => { nodes: GraphNode[]; links: GraphLink[] }
}

const auxFunctions: AuxFunctionDef[] = [
  {
    id: 'fu1',
    labelVi: 'FU1 Enable/Disable',
    labelEn: 'FU1 Enable/Disable',
    descVi: 'Bật/tắt thiết bị dựa trên điểm enable',
    descEn: 'Enable/disable equipment based on enable point',
    inputs: [
      { key: 'enablePt', labelVi: 'Điểm Enable (UI/BV)', labelEn: 'Enable Point (UI/BV)', type: 'point' },
      { key: 'outPt', labelVi: 'Điểm Output (DO/BO)', labelEn: 'Output Point (DO/BO)', type: 'point' }
    ],
    generate: (inputs) => ({
      nodes: [
        { id: 'fu1_interlock', type: 'Interlock', ports: { inputs: ['request', 'permit'], outputs: ['out'] }, params: { latch: false } }
      ],
      links: [
        { from: `${inputs.enablePt}.out`, to: 'fu1_interlock.permit' },
        { from: 'fu1_interlock.out', to: `${inputs.outPt}.in` }
      ]
    })
  },
  {
    id: 'fu2',
    labelVi: 'FU2 Occupied/Unoccupied',
    labelEn: 'FU2 Occupied/Unoccupied',
    descVi: 'Chuyển chế độ hoạt động theo lịch',
    descEn: 'Switch operation mode based on schedule',
    inputs: [
      { key: 'occPt', labelVi: 'Điểm Occupied', labelEn: 'Occupied Point', type: 'point' },
      { key: 'occSp', labelVi: 'Occupied Setpoint', labelEn: 'Occupied Setpoint', type: 'number' },
      { key: 'unoccSp', labelVi: 'Unoccupied Setpoint', labelEn: 'Unoccupied Setpoint', type: 'number' },
      { key: 'outPt', labelVi: 'Điểm Output', labelEn: 'Output Point', type: 'point' }
    ],
    generate: (inputs) => ({
      nodes: [
        { id: 'fu2_sp_occ', type: 'Setpoint', ports: { outputs: ['out'] }, params: { default: Number(inputs.occSp || 22) } },
        { id: 'fu2_sp_unocc', type: 'Setpoint', ports: { outputs: ['out'] }, params: { default: Number(inputs.unoccSp || 26) } },
        { id: 'fu2_manualauto', type: 'ManualAuto', ports: { inputs: ['auto', 'manual', 'sel'], outputs: ['out'] } }
      ],
      links: [
        { from: 'fu2_sp_unocc.out', to: 'fu2_manualauto.auto' },
        { from: 'fu2_sp_occ.out', to: 'fu2_manualauto.manual' },
        { from: `${inputs.occPt}.out`, to: 'fu2_manualauto.sel' },
        { from: 'fu2_manualauto.out', to: `${inputs.outPt}.in` }
      ]
    })
  },
  {
    id: 'fu3',
    labelVi: 'FU3 Heating/Cooling switch',
    labelEn: 'FU3 Heating/Cooling switch',
    descVi: 'Chuyển đổi Heating/Cooling',
    descEn: 'Heating/Cooling switch',
    inputs: [
      { key: 'tempPt', labelVi: 'Nhiệt độ (UI)', labelEn: 'Temperature (UI)', type: 'point' },
      { key: 'setpoint', labelVi: 'Setpoint', labelEn: 'Setpoint', type: 'number' },
      { key: 'deadband', labelVi: 'Deadband', labelEn: 'Deadband', type: 'number' },
      { key: 'heatOut', labelVi: 'Output Heating', labelEn: 'Heating Output', type: 'point' },
      { key: 'coolOut', labelVi: 'Output Cooling', labelEn: 'Cooling Output', type: 'point' }
    ],
    generate: (inputs) => {
      const sp = Number(inputs.setpoint || 22)
      const db = Number(inputs.deadband || 1)
      return {
        nodes: [
          { id: 'fu3_sp_heat', type: 'Setpoint', ports: { outputs: ['out'] }, params: { default: sp - db } },
          { id: 'fu3_sp_cool', type: 'Setpoint', ports: { outputs: ['out'] }, params: { default: sp + db } },
          { id: 'fu3_cmp_heat', type: 'Compare_LT', ports: { inputs: ['a', 'b'], outputs: ['out'] }, params: { hysteresis: 0.5 } },
          { id: 'fu3_cmp_cool', type: 'Compare_GT', ports: { inputs: ['a', 'b'], outputs: ['out'] }, params: { hysteresis: 0.5 } }
        ],
        links: [
          { from: `${inputs.tempPt}.out`, to: 'fu3_cmp_heat.a' },
          { from: 'fu3_sp_heat.out', to: 'fu3_cmp_heat.b' },
          { from: 'fu3_cmp_heat.out', to: `${inputs.heatOut}.in` },
          { from: `${inputs.tempPt}.out`, to: 'fu3_cmp_cool.a' },
          { from: 'fu3_sp_cool.out', to: 'fu3_cmp_cool.b' },
          { from: 'fu3_cmp_cool.out', to: `${inputs.coolOut}.in` }
        ]
      }
    }
  },
  {
    id: 'fu4',
    labelVi: 'FU4 Setpoint compensation',
    labelEn: 'FU4 Setpoint compensation',
    descVi: 'Bù trừ setpoint theo nhiệt độ ngoài trời (Rev A Partial)',
    descEn: 'Setpoint compensation by outdoor temp (Rev A Partial)',
    inputs: [
      { key: 'oatPt', labelVi: 'Outdoor Temp (UI)', labelEn: 'Outdoor Temp (UI)', type: 'point' },
      { key: 'spOut', labelVi: 'Setpoint Output', labelEn: 'Setpoint Output', type: 'point' }
    ],
    generate: (inputs) => ({
      nodes: [
        { id: 'fu4_scale', type: 'Scale', ports: { inputs: ['in'], outputs: ['out'] }, params: { in_lo: 0, in_hi: 40, out_lo: 20, out_hi: 26 } }
      ],
      links: [
        { from: `${inputs.oatPt}.out`, to: 'fu4_scale.in' },
        { from: 'fu4_scale.out', to: `${inputs.spOut}.in` }
      ]
    })
  },
  {
    id: 'fu5',
    labelVi: 'FU5 Economizer',
    labelEn: 'FU5 Economizer (Rev A partial)',
    descVi: 'Điều khiển damper lấy gió tươi',
    descEn: 'Fresh air damper control',
    inputs: [
      { key: 'oatPt', labelVi: 'Outdoor Temp', labelEn: 'Outdoor Temp', type: 'point' },
      { key: 'ratPt', labelVi: 'Return Temp', labelEn: 'Return Temp', type: 'point' },
      { key: 'dmpOut', labelVi: 'Damper Output', labelEn: 'Damper Output', type: 'point' }
    ],
    generate: (inputs) => ({
      nodes: [
        { id: 'fu5_cmp', type: 'Compare_LT', ports: { inputs: ['a', 'b'], outputs: ['out'] } },
        { id: 'fu5_manualauto', type: 'ManualAuto', ports: { inputs: ['auto', 'manual', 'sel'], outputs: ['out'] } },
        { id: 'fu5_full_fresh', type: 'Setpoint', ports: { outputs: ['out'] }, params: { default: 100 } },
        { id: 'fu5_min_fresh', type: 'Setpoint', ports: { outputs: ['out'] }, params: { default: 20 } }
      ],
      links: [
        { from: `${inputs.oatPt}.out`, to: 'fu5_cmp.a' },
        { from: `${inputs.ratPt}.out`, to: 'fu5_cmp.b' },
        { from: 'fu5_min_fresh.out', to: 'fu5_manualauto.auto' },
        { from: 'fu5_full_fresh.out', to: 'fu5_manualauto.manual' },
        { from: 'fu5_cmp.out', to: 'fu5_manualauto.sel' },
        { from: 'fu5_manualauto.out', to: `${inputs.dmpOut}.in` }
      ]
    })
  }
]

export function AuxFunctionsPage() {
  const { pick } = useI18n()
  const toast = useToast()
  const [selectedFu, setSelectedFu] = useState<AuxFunctionDef | null>(null)
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [result, setResult] = useState<GraphValidationResult | null>(null)
  const [preview, setPreview] = useState('')

  function selectFn(fu: AuxFunctionDef) {
    setSelectedFu(fu)
    setInputs({})
    setResult(null)
    setPreview('')
  }

  function handleInput(key: string, val: string) {
    setInputs((prev) => ({ ...prev, [key]: val }))
  }

  function createCluster() {
    if (!selectedFu) return
    const missing = selectedFu.inputs.find((i) => !inputs[i.key])
    if (missing) {
      toast.push('warn', pick(`Vui lòng nhập ${missing.labelVi}`, `Please enter ${missing.labelEn}`))
      return
    }

    try {
      const generated = selectedFu.generate(inputs)
      setPreview(JSON.stringify(generated, null, 2))

      const demoGraph = getDemoGraph()
      const mergedGraph = {
        ...demoGraph,
        nodes: [...(demoGraph.nodes || []), ...generated.nodes],
        links: [...(demoGraph.links || []), ...generated.links]
      }

      const valResult = validateGraphLocal(mergedGraph)
      setResult(valResult)
      toast.push(valResult.pass ? 'success' : 'warn', valResult.pass ? 'PASS' : 'FAIL')
    } catch (err) {
      toast.push('error', err instanceof Error ? err.message : 'Error generating graph')
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--c-text)]">
            {pick('Hàm phụ trợ', 'Auxiliary Functions')}
          </h1>
        </div>
        <p className="mt-1 text-sm text-[var(--c-text-dim)]">{pick('Trình tạo cụm khối logic theo thiết kế Rev A', 'Rev A logic block cluster generator')}</p>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel className="min-h-[500px]" title={pick('Chọn hàm', 'Select Function')} subtitle={pick('Chọn hàm để xem cấu hình', 'Select function to configure')}>
          <div className="space-y-3 p-4">
            {auxFunctions.map((fu) => (
              <div
                key={fu.id}
                className={`cursor-pointer rounded-[var(--radius)] border p-4 transition ${selectedFu?.id === fu.id ? 'border-[var(--c-accent)] bg-[var(--c-surface-2)] shadow-sm' : 'border-[var(--c-border)] hover:border-[var(--c-text-dim)]'}`}
                onClick={() => selectFn(fu)}
              >
                <div className="flex items-center gap-2 font-semibold text-[var(--c-text)]">
                  <Box className="h-4 w-4 text-[var(--c-accent)]" />
                  {pick(fu.labelVi, fu.labelEn)}
                  {(fu.id === 'fu4' || fu.id === 'fu5') && (
                    <span className="ml-auto inline-flex items-center rounded-full bg-[var(--c-surface-2)] px-2 py-0.5 text-[10px] font-bold tracking-wide text-[var(--c-warn-fg)] border border-[var(--c-border)]">
                      REV A PARTIAL
                    </span>
                  )}
                </div>
                <div className="mt-2 text-sm text-[var(--c-text-dim)]">{pick(fu.descVi, fu.descEn)}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="min-h-[500px]" title={pick('Cấu hình hàm', 'Function Config')} subtitle={selectedFu ? pick(selectedFu.descVi, selectedFu.descEn) : pick('Chưa chọn hàm', 'No function selected')}>
          <div className="p-4">
            {selectedFu ? (
              <div className="space-y-6">
                <div className="space-y-4">
                  {selectedFu.inputs.map((i) => (
                    <div key={i.key}>
                      <label className="mb-1 block text-sm font-medium text-[var(--c-text)]">{pick(i.labelVi, i.labelEn)}</label>
                      <input
                        type={i.type === 'number' ? 'number' : 'text'}
                        value={inputs[i.key] || ''}
                        onChange={(e) => handleInput(i.key, e.target.value)}
                        className="w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] px-3 py-2 text-sm text-[var(--c-text)] placeholder:text-[var(--c-text-dim)] outline-none focus:border-[var(--c-accent)]"
                        placeholder={`${pick('Nhập', 'Enter')} ${i.key}...`}
                      />
                    </div>
                  ))}
                </div>

                <div className="pt-2">
                  <Button variant="primary" icon={<Rocket className="h-4 w-4" />} onClick={createCluster}>
                    {pick('Tạo cụm node', 'Create node cluster')}
                  </Button>
                </div>

                {preview && (
                  <div className="mt-6 space-y-4 border-t border-[var(--c-border)] pt-6">
                    <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-4">
                      <div className="mb-3 flex items-center justify-between border-b border-[var(--c-border)] pb-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-[var(--c-text)]">
                          {pick('Kết quả sinh Node & Link', 'Generated Nodes & Links')}
                        </span>
                        {result && <StatusBadge state={result.pass ? 'online' : 'fault'} label={result.pass ? 'PASS' : 'FAIL'} />}
                      </div>
                      <pre className="max-h-[250px] overflow-auto text-xs text-[var(--c-text)] mono leading-relaxed">{preview}</pre>
                    </div>
                    {result && !result.pass && (
                      <div className="space-y-2">
                        {result.errors.map((e, idx) => (
                          <div key={idx} className="flex items-start gap-2 rounded-[var(--radius)] border border-[var(--c-fault)] bg-[var(--c-surface)] p-3 text-sm text-[var(--c-fault-fg)] shadow-sm">
                            <StatusBadge state="fault" label="ERROR" />
                            <div className="flex-1">
                              <div className="font-mono text-xs font-bold">{e.path}</div>
                              <div>{e.message}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-[300px] flex-col items-center justify-center text-center">
                <Box className="mb-3 h-10 w-10 text-[var(--c-border)]" />
                <p className="text-sm text-[var(--c-text-dim)]">{pick('Vui lòng chọn hàm ở bảng bên trái.', 'Please select a function from the left panel.')}</p>
              </div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  )
}
