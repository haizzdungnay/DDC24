import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { Panel } from '../components/Panel'
import { getDemoChannels, getDemoPoints, getDemoNetwork } from '../demo/simulator'
import type { IoChannel, Point, NetworkData } from '../types'

export function DiagramPage() {
  const { t } = useI18n()
  const [channels, setChannels] = useState<IoChannel[]>([])
  const [points, setPoints] = useState<Point[]>([])
  const [network, setNetwork] = useState<NetworkData | null>(null)

  useEffect(() => {
    setChannels(getDemoChannels())
    setPoints(getDemoPoints())
    setNetwork(getDemoNetwork())
    // In a real app this would subscribe to updates via WebSocket
  }, [])

  const aiChannels = channels.filter(c => c.kind === 'AI')
  const aoChannels = channels.filter(c => c.kind === 'AO')
  const diChannels = channels.filter(c => c.kind === 'DI')
  const doChannels = channels.filter(c => c.kind === 'DO')

  // Layout constants
  const SVG_WIDTH = 900

  const CTRL_X = 350
  const CTRL_Y = 100
  const CTRL_W = 200
  const CTRL_H = Math.max((aiChannels.length + aoChannels.length) * 40, (diChannels.length + doChannels.length) * 40) + 40

  function formatValue(point?: Point): string {
    if (!point) return '---'
    if (typeof point.value === 'boolean') return point.value ? 'ON' : 'OFF'
    if (typeof point.value === 'number') return `${point.value.toFixed(1)} ${point.unit || ''}`.trim()
    return String(point.value)
  }

  function getQualityColor(point?: Point): string {
    if (!point) return 'var(--c-off)'
    if (point.fault || point.quality === 'bad') return 'var(--c-fault)'
    if (point.quality === 'uncertain' || point.quality === 'stale' || point.forced) return 'var(--c-warn)'
    return 'var(--c-online, var(--c-good))'
  }

  // Draw left side terminals (AI/AO)
  const leftTerminals = [...aiChannels, ...aoChannels]
  const renderLeftTerminal = (ch: IoChannel, i: number) => {
    const point = points.find(p => p.id === ch.pointId)
    const y = CTRL_Y + 30 + i * 40
    const color = getQualityColor(point)
    return (
      <g key={ch.id}>
        <line x1={150} y1={y} x2={CTRL_X} y2={y} stroke="var(--c-border)" strokeWidth="2" />
        <rect x={20} y={y - 15} width={130} height={30} rx={4} fill="var(--c-surface-2)" stroke="var(--c-border)" />
        <circle cx={150} cy={y} r={4} fill={color} />
        <text x={30} y={y + 4} fontSize="12" fill="var(--c-text)" fontWeight="bold">{ch.pointId}</text>
        <text x={70} y={y + 4} fontSize="10" fill="var(--c-text-dim)">{formatValue(point)}</text>

        {/* Label info below the line */}
        <text x={20} y={y + 25} fontSize="10" fill="var(--c-text-dim)">{ch.label}</text>
        <text x={20} y={y + 37} fontSize="10" fill="var(--c-text-dim)">{t('signal')}: {ch.signal}</text>
      </g>
    )
  }

  // Draw right side terminals (DI/DO)
  const rightTerminals = [...diChannels, ...doChannels]
  const renderRightTerminal = (ch: IoChannel, i: number) => {
    const point = points.find(p => p.id === ch.pointId)
    const y = CTRL_Y + 30 + i * 40
    const color = getQualityColor(point)
    return (
      <g key={ch.id}>
        <line x1={CTRL_X + CTRL_W} y1={y} x2={SVG_WIDTH - 150} y2={y} stroke="var(--c-border)" strokeWidth="2" />
        <rect x={SVG_WIDTH - 150} y={y - 15} width={130} height={30} rx={4} fill="var(--c-surface-2)" stroke="var(--c-border)" />
        <circle cx={SVG_WIDTH - 150} cy={y} r={4} fill={color} />
        <text x={SVG_WIDTH - 140} y={y + 4} fontSize="12" fill="var(--c-text)" fontWeight="bold">{ch.pointId}</text>
        <text x={SVG_WIDTH - 100} y={y + 4} fontSize="10" fill="var(--c-text-dim)">{formatValue(point)}</text>

        {/* Label info below the line */}
        <text x={SVG_WIDTH - 150} y={y + 25} fontSize="10" fill="var(--c-text-dim)">{ch.label}</text>
        <text x={SVG_WIDTH - 150} y={y + 37} fontSize="10" fill="var(--c-text-dim)">{ch.safeState && ch.safeState !== 'n/a' ? `${t('safestate')}: ${ch.safeState}` : ''}</text>
      </g>
    )
  }

  const networkY = Math.max(CTRL_Y + CTRL_H + 80, 500)

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-[var(--c-border)] p-6">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--c-text)]">{t('diagram')}</h1>
        <p className="mt-1 text-sm text-[var(--c-text-dim)]">{t('diagram-sub')}</p>
      </div>
      <div className="flex-1 overflow-auto p-6">
        <Panel className="min-w-max p-4" title={t('diagram')}>
          <div className="flex items-center justify-center p-4">
            <svg width="100%" height="100%" viewBox={`0 0 ${SVG_WIDTH} ${networkY + 150}`} className="max-w-[1000px] font-sans">

              {/* Controller Block */}
              <rect x={CTRL_X} y={CTRL_Y} width={CTRL_W} height={CTRL_H} rx={8} fill="var(--c-surface)" stroke="var(--c-border)" strokeWidth="2" />
              <text x={CTRL_X + CTRL_W / 2} y={CTRL_Y + 25} textAnchor="middle" fontSize="16" fontWeight="bold" fill="var(--c-text)">MK-DDC-24</text>
              <line x1={CTRL_X} y1={CTRL_Y + 40} x2={CTRL_X + CTRL_W} y2={CTRL_Y + 40} stroke="var(--c-border)" strokeWidth="1" />

              {/* Terminals */}
              {leftTerminals.map((ch, i) => renderLeftTerminal(ch, i))}
              {rightTerminals.map((ch, i) => renderRightTerminal(ch, i))}

              {/* Network Blocks */}
              {/* RS485 / Modbus */}
              <line x1={CTRL_X + 60} y1={CTRL_Y + CTRL_H} x2={CTRL_X + 60} y2={networkY} stroke="var(--c-border)" strokeWidth="2" />
              <rect x={CTRL_X - 20} y={networkY} width={160} height={80} rx={6} fill="var(--c-surface-2)" stroke="var(--c-border)" />
              <text x={CTRL_X + 60} y={networkY + 25} textAnchor="middle" fontSize="14" fontWeight="bold" fill="var(--c-text)">{t('rs485')} / {t('modbus')}</text>
              <text x={CTRL_X + 60} y={networkY + 45} textAnchor="middle" fontSize="12" fill="var(--c-text-dim)">
                {network?.southbound ? `${network.southbound.length} Devices` : 'No Devices'}
              </text>

              {/* BACnet */}
              <line x1={CTRL_X + 140} y1={CTRL_Y + CTRL_H} x2={CTRL_X + 140} y2={networkY} stroke="var(--c-border)" strokeWidth="2" />
              <rect x={CTRL_X + 180} y={networkY} width={160} height={80} rx={6} fill="var(--c-surface-2)" stroke="var(--c-border)" />
              <line x1={CTRL_X + 140} y1={networkY + 40} x2={CTRL_X + 180} y2={networkY + 40} stroke="var(--c-border)" strokeWidth="2" />
              <text x={CTRL_X + 260} y={networkY + 25} textAnchor="middle" fontSize="14" fontWeight="bold" fill="var(--c-text)">{t('bacnet')}</text>
              <text x={CTRL_X + 260} y={networkY + 45} textAnchor="middle" fontSize="12" fill="var(--c-text-dim)">
                IP: {network?.northbound?.ip || 'DHCP'}
              </text>
              <text x={CTRL_X + 260} y={networkY + 60} textAnchor="middle" fontSize="12" fill="var(--c-text-dim)">
                Device ID: {network?.northbound?.bacnetDeviceId || 'N/A'}
              </text>

            </svg>
          </div>
        </Panel>
      </div>
    </div>
  )
}
