import type { FbdNetwork, FbdNode, FbdPort } from './model'
import type { FbdWireReferenceMap } from './wireReferences'
import type { FbdRuntimeOverlay } from './runtimeOverlay'
import { pointTooltipPosition } from './FbdNodeHoverCard'
import { fbdNodeIdentity } from './FbdCanvasLayers'

export interface FbdReferenceHoverCardProps {
  network: FbdNetwork
  nodesById: ReadonlyMap<string, FbdNode>
  wireReferences: FbdWireReferenceMap
  wireId: string
  kind: 'source' | 'sink'
  position: { x: number; y: number }
  runtime?: FbdRuntimeOverlay | null
  pick: (vi: string, en: string) => string
  id?: string
}

export function FbdReferenceHoverCard({
  network,
  nodesById,
  wireReferences,
  wireId,
  kind,
  position,
  runtime,
  pick,
  id,
}: FbdReferenceHoverCardProps) {
  const wire = network.wires.find((w) => w.id === wireId)
  if (!wire) return null

  const refItem = wireReferences[wireId]
  const signalName = refItem?.signalName || 'SIG'

  const sourceNode = nodesById.get(wire.from.nodeId)
  const sourcePort = sourceNode?.ports.find((p) => p.id === wire.from.portId)

  // Fan-out destinations
  const destWires = network.wires.filter(
    (w) => w.from.nodeId === wire.from.nodeId && w.from.portId === wire.from.portId
  )
  const destinations = destWires
    .map((dw) => {
      const dNode = nodesById.get(dw.to.nodeId)
      const dPort = dNode?.ports.find((p) => p.id === dw.to.portId)
      return {
        node: dNode,
        port: dPort,
      }
    })
    .filter((d): d is { node: FbdNode; port: FbdPort } => Boolean(d.node && d.port))

  const reading =
    runtime?.byPortId.get(wire.from.portId) ??
    (sourceNode ? runtime?.byNodeId.get(sourceNode.id) : null) ??
    null

  const sourceIdent = sourceNode ? fbdNodeIdentity(sourceNode) : null
  const coords = pointTooltipPosition(position)

  return (
    <div
      id={id}
      role="tooltip"
      data-testid="fbd-reference-hover-card"
      className="pointer-events-none fixed z-50 min-w-[240px] max-w-[340px] rounded-lg border border-[var(--c-border)] bg-[var(--c-surface)] p-3 text-xs text-[var(--c-text)] shadow-xl"
      style={{ left: `${coords.x}px`, top: `${coords.y}px` }}
    >
      {/* Header: Signal Name & Data Type */}
      <div className="flex flex-col gap-0.5 border-b border-[var(--c-border)] pb-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono font-bold text-sm text-[var(--c-accent)] truncate">
            {signalName}
          </span>
          {sourcePort && (
            <span className="rounded bg-[var(--c-surface-2)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--c-text-dim)]">
              {sourcePort.dataType}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-[var(--c-text-dim)]">
          <span>{pick('Tham chiếu tín hiệu', 'Signal reference')}</span>
          <span>·</span>
          <span>
            {kind === 'source'
              ? pick('Đầu phát (Source)', 'Source stub')
              : pick('Đầu nhận (Destination)', 'Sink stub')}
          </span>
        </div>
      </div>

      {/* Giá trị truyền chi tiết */}
      <div className="mt-2 rounded bg-[var(--c-surface-2)] p-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--c-text-dim)]">
          {pick('Giá trị truyền chi tiết', 'Transmitted runtime value')}:
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="font-mono text-sm font-bold text-[var(--c-text)]">
            {reading
              ? `${reading.display}${reading.unit ? ' ' + reading.unit : ''}`
              : `— (${sourcePort?.dataType ?? 'BOOL'})`}
          </span>
          {reading ? (
            <span
              className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                reading.state === 'live'
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : reading.state === 'invalid'
                    ? 'bg-rose-500/20 text-rose-400'
                    : 'bg-[var(--c-border)] text-[var(--c-text-dim)]'
              }`}
            >
              {reading.state.toUpperCase()}
            </span>
          ) : (
            <span className="rounded bg-[var(--c-border)]/50 px-1 py-0.5 text-[10px] text-[var(--c-text-dim)]">
              {pick('Chế độ thiết kế', 'Design mode')}
            </span>
          )}
        </div>
      </div>

      {/* Khối nguồn */}
      <div className="mt-2.5 flex flex-col gap-1">
        <div className="text-[11px] font-semibold text-[var(--c-text-dim)]">
          {pick('Khối nguồn phát', 'Source block')}:
        </div>
        <div className="flex items-center justify-between rounded border border-[var(--c-border)]/60 bg-[var(--c-bg)] px-2 py-1 font-mono text-[11px]">
          <span className="font-semibold text-[var(--c-text)] truncate">
            {sourceIdent?.primary ?? wire.from.nodeId}
          </span>
          <span className="shrink-0 text-[var(--c-text-dim)]">
            {sourcePort?.name ?? 'OUT'}
          </span>
        </div>
      </div>

      {/* Khối đích */}
      <div className="mt-2 flex flex-col gap-1">
        <div className="text-[11px] font-semibold text-[var(--c-text-dim)]">
          {destinations.length > 1
            ? pick(
                `Điểm tham chiếu đích (${destinations.length})`,
                `Destination references (${destinations.length})`
              )
            : pick('Điểm tham chiếu đích', 'Destination reference')}:
        </div>
        <div className="max-h-[96px] space-y-1 overflow-y-auto">
          {destinations.map((d, idx) => {
            const dIdent = fbdNodeIdentity(d.node)
            return (
              <div
                key={idx}
                className="flex items-center justify-between rounded border border-[var(--c-border)]/60 bg-[var(--c-bg)] px-2 py-1 font-mono text-[11px]"
              >
                <span className="text-[var(--c-text)] truncate">{dIdent.primary}</span>
                <span className="shrink-0 text-[var(--c-text-dim)]">{d.port.name}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Footer hint */}
      <div className="mt-2.5 flex items-center justify-between border-t border-[var(--c-border)]/60 pt-1.5 text-[10px] text-[var(--c-text-dim)]">
        <span>{pick('Nhấp đúp: Nhảy tới đối tác', 'Double-click: Go to partner')}</span>
        <span>{pick('Kéo: Kéo dài dây', 'Drag: Extend wire')}</span>
      </div>
    </div>
  )
}
