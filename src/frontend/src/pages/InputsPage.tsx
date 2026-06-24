import { Save, Activity, ToggleLeft } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../components/Button'
import { Panel } from '../components/Panel'
import { useToast } from '../components/Toast'
import { getAiInputConfigs, getDiInputConfigs } from '../demo/simulator'
import { useI18n } from '../i18n'
import type { AiInputConfig, DiInputConfig, AiSignalType } from '../types'

export function InputsPage() {
  const { pick } = useI18n()
  const [tab, setTab] = useState<'ai' | 'di'>('ai')

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{pick('Cấu hình Inputs', 'Inputs Config')}</h1>
          <p className="text-sm text-[var(--c-text-dim)]">
            {pick('Cấu hình Analog & Digital Inputs', 'Analog & Digital Inputs configuration')}
          </p>
        </div>
        <div className="flex gap-2 bg-[var(--c-surface-2)] p-1 rounded-[var(--radius)]">
          <button
            className={`px-4 py-1.5 rounded-[var(--radius)] text-sm font-semibold transition-colors ${tab === 'ai' ? 'bg-[var(--c-bg)] text-[var(--c-accent)] shadow-sm' : 'text-[var(--c-text-dim)] hover:text-[var(--c-text)]'}`}
            onClick={() => setTab('ai')}
          >
            AI Inputs
          </button>
          <button
            className={`px-4 py-1.5 rounded-[var(--radius)] text-sm font-semibold transition-colors ${tab === 'di' ? 'bg-[var(--c-bg)] text-[var(--c-accent)] shadow-sm' : 'text-[var(--c-text-dim)] hover:text-[var(--c-text)]'}`}
            onClick={() => setTab('di')}
          >
            DI Inputs
          </button>
        </div>
      </div>

      {tab === 'ai' ? <AiInputsView /> : <DiInputsView />}
    </div>
  )
}

function AiInputsView() {
  const { pick } = useI18n()
  const toast = useToast()
  const [configs, setConfigs] = useState<AiInputConfig[]>(() => getAiInputConfigs())
  const [selectedChannel, setSelectedChannel] = useState<number>(1)
  const [viewMode, setViewMode] = useState<'wizard' | 'advanced'>('wizard')

  const selected = configs.find(c => c.channel === selectedChannel)

  function updateSelected(patch: Partial<AiInputConfig>) {
    if (!selected) return
    setConfigs(curr => curr.map(c => c.channel === selected.channel ? { ...c, ...patch } : c))
  }

  function handleSave() {
    toast.push('success', pick('Đã lưu cấu hình AI (demo)', 'AI config saved (demo)'))
  }

  return (
    <div className="grid grid-cols-[250px_1fr] gap-5 items-start">
      <Panel title="AI Channels">
        <div className="flex flex-col gap-1">
          {configs.map((c) => (
            <button
              key={c.channel}
              onClick={() => setSelectedChannel(c.channel)}
              className={`flex items-center gap-2 p-2 rounded-[var(--radius)] text-sm transition-colors text-left ${selectedChannel === c.channel ? 'bg-[var(--c-surface-2)] text-[var(--c-accent)] font-semibold' : 'hover:bg-[var(--c-surface-2)]'}`}
            >
              <Activity className="h-4 w-4" />
              <span>{c.node} - {c.label}</span>
            </button>
          ))}
        </div>
      </Panel>

      <div className="space-y-5">
        <Panel
          title={selected ? `${selected.node} Config` : 'Select a channel'}
          action={
            <div className="flex gap-2">
              <div className="flex bg-[var(--c-bg)] p-1 rounded-[var(--radius)] border border-[var(--c-border)]">
                <button
                  className={`px-3 py-1 rounded-[calc(var(--radius)-4px)] text-xs font-semibold ${viewMode === 'wizard' ? 'bg-[var(--c-surface-2)] text-[var(--c-text)]' : 'text-[var(--c-text-dim)]'}`}
                  onClick={() => setViewMode('wizard')}
                >
                  Wizard
                </button>
                <button
                  className={`px-3 py-1 rounded-[calc(var(--radius)-4px)] text-xs font-semibold ${viewMode === 'advanced' ? 'bg-[var(--c-surface-2)] text-[var(--c-text)]' : 'text-[var(--c-text-dim)]'}`}
                  onClick={() => setViewMode('advanced')}
                >
                  Advanced
                </button>
              </div>
              <Button variant="primary" icon={<Save className="h-4 w-4" />} onClick={handleSave}>
                {pick('Lưu', 'Save')}
              </Button>
            </div>
          }
        >
          {selected && viewMode === 'wizard' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[var(--c-text-dim)] uppercase">Label</label>
                  <input
                    className="w-full h-9 px-3 rounded-[var(--radius)] bg-[var(--c-bg)] border border-[var(--c-border)] outline-none focus:border-[var(--c-accent)] text-sm"
                    value={selected.label}
                    onChange={(e) => updateSelected({ label: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[var(--c-text-dim)] uppercase">Signal Type</label>
                  <select
                    className="w-full h-9 px-3 rounded-[var(--radius)] bg-[var(--c-bg)] border border-[var(--c-border)] outline-none focus:border-[var(--c-accent)] text-sm"
                    value={selected.signalType}
                    onChange={(e) => updateSelected({ signalType: e.target.value as AiSignalType })}
                  >
                    <option value="0-10V">0-10V</option>
                    <option value="2-10V">2-10V (Live-Zero)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[var(--c-text-dim)] uppercase">Display Min</label>
                  <input
                    type="number"
                    className="w-full h-9 px-3 rounded-[var(--radius)] bg-[var(--c-bg)] border border-[var(--c-border)] outline-none focus:border-[var(--c-accent)] text-sm"
                    value={selected.displayMin}
                    onChange={(e) => updateSelected({ displayMin: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[var(--c-text-dim)] uppercase">Display Max</label>
                  <input
                    type="number"
                    className="w-full h-9 px-3 rounded-[var(--radius)] bg-[var(--c-bg)] border border-[var(--c-border)] outline-none focus:border-[var(--c-accent)] text-sm"
                    value={selected.displayMax}
                    onChange={(e) => updateSelected({ displayMax: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[var(--c-text-dim)] uppercase">Unit</label>
                  <input
                    className="w-full h-9 px-3 rounded-[var(--radius)] bg-[var(--c-bg)] border border-[var(--c-border)] outline-none focus:border-[var(--c-accent)] text-sm"
                    value={selected.unit}
                    onChange={(e) => updateSelected({ unit: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[var(--c-text-dim)] uppercase">Offset</label>
                  <input
                    type="number"
                    className="w-full h-9 px-3 rounded-[var(--radius)] bg-[var(--c-bg)] border border-[var(--c-border)] outline-none focus:border-[var(--c-accent)] text-sm"
                    value={selected.offset}
                    onChange={(e) => updateSelected({ offset: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-[var(--c-text-dim)] uppercase">Fallback Value (Required)</label>
                <input
                  type="number"
                  className={`w-full max-w-[200px] h-9 px-3 rounded-[var(--radius)] bg-[var(--c-bg)] border outline-none text-sm ${Number.isNaN(selected.fallback) ? 'border-[var(--c-fault)] focus:border-[var(--c-fault)]' : 'border-[var(--c-border)] focus:border-[var(--c-accent)]'}`}
                  value={Number.isNaN(selected.fallback) ? '' : selected.fallback}
                  onChange={(e) => updateSelected({ fallback: e.target.value === '' ? NaN : Number(e.target.value) })}
                  placeholder="Required fallback..."
                />
                {Number.isNaN(selected.fallback) && (
                  <p className="text-xs text-[var(--c-fault-fg)] mt-1">Fallback is required for safe state.</p>
                )}
              </div>

              <div className="p-4 bg-[var(--c-surface-2)] rounded-[var(--radius)] border border-[var(--c-border)] space-y-2">
                <h4 className="text-sm font-semibold">Scaling Formula</h4>
                <p className="text-sm text-[var(--c-text-dim)] mono">
                  {selected.signalType === '0-10V'
                    ? `EU = ${selected.displayMin} + (V / 10) * (${selected.displayMax} - ${selected.displayMin}) + ${selected.offset}`
                    : `EU = ${selected.displayMin} + ((V - 2) / 8) * (${selected.displayMax} - ${selected.displayMin}) + ${selected.offset}`
                  }
                </p>
                {selected.signalType === '2-10V' && (
                  <p className="text-xs text-[var(--c-warn-fg)] mt-1">Live-zero: V &lt; 2V will trigger fault state and use fallback value.</p>
                )}
              </div>

              {/*
                AiInputConfig maps to:
                - io_map.ai[].channel
                - io_map.ai[].node
                - io_map.ai[].mode
                - io_config.conf ai fallback
                - Scale node params: in_lo/in_hi/out_lo/out_hi
              */}

              <label className="flex items-center gap-2 text-sm font-semibold text-[var(--c-text-dim)]">
                <input className="h-4 w-4 accent-[var(--c-accent)]" type="checkbox" checked={selected.enabled} onChange={(e) => updateSelected({ enabled: e.target.checked })} />
                Enable Channel
              </label>
            </div>
          )}

          {viewMode === 'advanced' && (
             <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)]">
              <div className="grid grid-cols-[80px_1fr_100px_80px_80px_80px_80px] bg-[var(--c-surface-2)] px-3 py-2 text-[10px] font-semibold uppercase text-[var(--c-text-dim)]">
                <span>Node</span><span>Label</span><span>Signal</span><span>Min</span><span>Max</span><span>Fallback</span><span>Enabled</span>
              </div>
              <div className="overflow-auto max-h-[400px]">
                {configs.map((c) => (
                  <div key={c.channel} className="grid grid-cols-[80px_1fr_100px_80px_80px_80px_80px] items-center gap-2 border-t border-[var(--c-border)] px-3 py-2 text-sm">
                     <div className="mono">{c.node}</div>
                     <input className="h-8 rounded bg-transparent border border-transparent hover:border-[var(--c-border)] focus:border-[var(--c-accent)] px-1 outline-none" value={c.label} onChange={e => setConfigs(curr => curr.map(item => item.channel === c.channel ? {...item, label: e.target.value} : item))} />
                     <select className="h-8 rounded bg-transparent border border-transparent hover:border-[var(--c-border)] focus:border-[var(--c-accent)] px-1 outline-none" value={c.signalType} onChange={e => setConfigs(curr => curr.map(item => item.channel === c.channel ? {...item, signalType: e.target.value as AiSignalType} : item))}>
                        <option value="0-10V">0-10V</option>
                        <option value="2-10V">2-10V</option>
                     </select>
                     <input type="number" className="h-8 rounded bg-transparent border border-transparent hover:border-[var(--c-border)] focus:border-[var(--c-accent)] px-1 outline-none" value={c.displayMin} onChange={e => setConfigs(curr => curr.map(item => item.channel === c.channel ? {...item, displayMin: Number(e.target.value)} : item))} />
                     <input type="number" className="h-8 rounded bg-transparent border border-transparent hover:border-[var(--c-border)] focus:border-[var(--c-accent)] px-1 outline-none" value={c.displayMax} onChange={e => setConfigs(curr => curr.map(item => item.channel === c.channel ? {...item, displayMax: Number(e.target.value)} : item))} />
                     <input type="number" className={`h-8 rounded bg-transparent border px-1 outline-none ${Number.isNaN(c.fallback) ? 'border-[var(--c-fault)]' : 'border-transparent hover:border-[var(--c-border)] focus:border-[var(--c-accent)]'}`} value={Number.isNaN(c.fallback) ? '' : c.fallback} onChange={e => setConfigs(curr => curr.map(item => item.channel === c.channel ? {...item, fallback: e.target.value === '' ? NaN : Number(e.target.value)} : item))} />
                     <input type="checkbox" className="h-4 w-4 accent-[var(--c-accent)] mx-auto" checked={c.enabled} onChange={e => setConfigs(curr => curr.map(item => item.channel === c.channel ? {...item, enabled: e.target.checked} : item))} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}

function DiInputsView() {
  const { pick } = useI18n()
  const toast = useToast()
  const [configs, setConfigs] = useState<DiInputConfig[]>(() => getDiInputConfigs())

  function update(channel: number, patch: Partial<DiInputConfig>) {
    setConfigs(curr => curr.map(c => c.channel === channel ? { ...c, ...patch } : c))
  }

  function handleSave() {
    toast.push('success', pick('Đã lưu cấu hình DI (demo)', 'DI config saved (demo)'))
  }

  return (
    <Panel
      title="Digital Inputs Configuration"
      action={
        <Button variant="primary" icon={<Save className="h-4 w-4" />} onClick={handleSave}>
          {pick('Lưu', 'Save')}
        </Button>
      }
    >
      <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--c-border)]">
        <div className="grid min-w-[800px] grid-cols-[80px_1.5fr_120px_120px_150px_100px_80px] bg-[var(--c-surface-2)] px-3 py-2 text-[10px] font-semibold uppercase text-[var(--c-text-dim)]">
          <span>Node</span><span>Label</span><span>Contact</span><span>Normal State</span><span>Logic View</span><span>Debounce (ms)</span><span className="text-center">Enabled</span>
        </div>
        <div className="overflow-auto">
          {configs.map((c) => {
            const isDirect = !c.invert;
            return (
              <div key={c.channel} className="grid min-w-[800px] grid-cols-[80px_1.5fr_120px_120px_150px_100px_80px] items-center gap-2 border-t border-[var(--c-border)] px-3 py-3 text-sm">
                <div className="mono font-semibold flex items-center gap-2">
                  <ToggleLeft className="h-4 w-4 text-[var(--c-accent)]" />
                  {c.node}
                </div>
                <input
                  className="h-9 rounded-[var(--radius)] border border-transparent bg-transparent px-2 text-sm text-[var(--c-text)] outline-none hover:border-[var(--c-border)] focus:border-[var(--c-accent)] focus:bg-[var(--c-bg)]"
                  value={c.label}
                  onChange={(e) => update(c.channel, { label: e.target.value })}
                />
                <select
                  className="h-9 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-2 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
                  value={isDirect ? 'direct' : 'reversed'}
                  onChange={(e) => update(c.channel, { invert: e.target.value === 'reversed' })}
                >
                  <option value="direct">Direct</option>
                  <option value="reversed">Reversed</option>
                </select>
                <select
                  className="h-9 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-2 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
                  value={c.normalState}
                  onChange={(e) => update(c.channel, { normalState: e.target.value as 'open' | 'closed' })}
                >
                  <option value="open">Normally Open</option>
                  <option value="closed">Normally Closed</option>
                </select>
                <div className="flex items-center gap-2">
                   <span className="px-2 py-0.5 rounded bg-[var(--c-surface-2)] text-[11px] font-mono border border-[var(--c-border)]">
                      {isDirect ? 'Direct' : 'Reversed'} / {c.normalState === 'open' ? 'Open' : 'Closed'}
                   </span>
                </div>
                <input
                  type="number"
                  className="h-9 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-2 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
                  value={c.debounceMs}
                  onChange={(e) => update(c.channel, { debounceMs: Number(e.target.value) })}
                />
                <label className="flex items-center justify-center cursor-pointer">
                  <input className="h-4 w-4 accent-[var(--c-accent)]" type="checkbox" checked={c.enabled} onChange={(e) => update(c.channel, { enabled: e.target.checked })} />
                </label>
              </div>
            )
          })}
        </div>
      </div>
    </Panel>
  )
}
