import type { FbdNode } from './model'
import type { FbdNodeGeometry } from './geometry'
import type { FbdRuntimeReading } from './runtimeOverlay'
import { fbdNodeIdentity } from './FbdCanvasLayers'
import { formatPortLabel } from './nodeLabel'
import { useI18n } from '../../../shared/i18n'

export interface FbdNodeHoverCardProps {
  node: FbdNode
  nodeGeometry: FbdNodeGeometry
  runtimeReading?: FbdRuntimeReading | null
  position: { x: number; y: number }
  id: string
}

/**
 * ponytail: Kẹp toạ độ theo kích thước viewport hiện tại; nâng cấp lên đo DOM ResizeObserver nếu kích thước hover card động.
 */
export function pointTooltipPosition(
  pos: { x: number; y: number },
  tooltipW = 260,
  tooltipH = 180,
  gap = 12,
): { x: number; y: number } {
  const winW = typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 1024
  const winH = typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : 768
  return {
    x: Math.max(gap, Math.min(pos.x + gap, winW - tooltipW - gap)),
    y: Math.max(gap, Math.min(pos.y + gap, winH - tooltipH - gap)),
  }
}

const RUNTIME_STATE_MAP: Record<
  FbdRuntimeReading['state'],
  { labelVi: string; labelEn: string; bg: string; fg: string }
> = {
  live: { labelVi: 'Trực tiếp', labelEn: 'Live', bg: 'var(--c-good-bg)', fg: 'var(--c-good-fg)' },
  uncertain: { labelVi: 'Không chắc chắn', labelEn: 'Uncertain', bg: 'var(--c-warn-bg)', fg: 'var(--c-warn-fg)' },
  stale: { labelVi: 'Cũ', labelEn: 'Stale', bg: 'var(--c-warn-bg)', fg: 'var(--c-warn-fg)' },
  invalid: { labelVi: 'Không hợp lệ', labelEn: 'Invalid', bg: 'var(--c-surface-2)', fg: 'var(--c-text-dim)' },
}

export function FbdNodeHoverCard({
  node,
  runtimeReading,
  position,
  id,
}: FbdNodeHoverCardProps) {
  const { pick } = useI18n()
  const coords = pointTooltipPosition(position)
  const identity = fbdNodeIdentity(node)

  const inputPorts = node.ports.filter((p) => p.direction === 'INPUT')
  const outputPorts = node.ports.filter((p) => p.direction === 'OUTPUT')

  return (
    <div
      id={id}
      role="tooltip"
      className="pointer-events-none fixed z-50 min-w-[220px] max-w-[320px] rounded-lg border border-[var(--c-border)] bg-[var(--c-surface)] p-3 text-xs text-[var(--c-text)] shadow-lg"
      style={{ left: `${coords.x}px`, top: `${coords.y}px` }}
    >
      <div className="flex flex-col gap-0.5 border-b border-[var(--c-border)] pb-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-sm text-[var(--c-text)]">
            {identity.primary}
          </span>
          <span className="rounded bg-[var(--c-surface-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--c-text-dim)]">
            #{node.executionOrder}
          </span>
        </div>
        {identity.secondary && (
          <span className="text-[11px] text-[var(--c-text-dim)]">
            {identity.secondary}
          </span>
        )}
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--c-text-dim)]">
          <span className="font-medium text-[var(--c-text)]">{node.typeRef}</span>
          <span>·</span>
          <span className="uppercase">{node.kind}</span>
        </div>
      </div>

      {(inputPorts.length > 0 || outputPorts.length > 0) && (
        <div className="mt-2 flex flex-col gap-1.5">
          {inputPorts.length > 0 && (
            <div>
              <div className="font-medium text-[var(--c-text-dim)]">
                {pick('Đầu vào', 'Inputs')}:
              </div>
              <ul className="mt-0.5 space-y-0.5 pl-2 font-mono text-[11px]">
                {inputPorts.map((p) => (
                  <li key={p.id}>{formatPortLabel(p.name, p.dataType, p.unit)}</li>
                ))}
              </ul>
            </div>
          )}
          {outputPorts.length > 0 && (
            <div>
              <div className="font-medium text-[var(--c-text-dim)]">
                {pick('Đầu ra', 'Outputs')}:
              </div>
              <ul className="mt-0.5 space-y-0.5 pl-2 font-mono text-[11px]">
                {outputPorts.map((p) => (
                  <li key={p.id}>{formatPortLabel(p.name, p.dataType, p.unit)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {runtimeReading && (
        <div className="mt-2 flex items-center justify-between border-t border-[var(--c-border)] pt-2">
          <span className="font-medium text-[var(--c-text-dim)]">
            {pick('Giá trị chạy', 'Runtime')}:
          </span>
          <div className="flex items-center gap-1.5 font-mono">
            <span className="font-semibold text-[var(--c-text)]">
              {runtimeReading.display}
              {runtimeReading.unit ? ` ${runtimeReading.unit}` : ''}
            </span>
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
              style={{
                backgroundColor: RUNTIME_STATE_MAP[runtimeReading.state].bg,
                color: RUNTIME_STATE_MAP[runtimeReading.state].fg,
              }}
            >
              {pick(
                RUNTIME_STATE_MAP[runtimeReading.state].labelVi,
                RUNTIME_STATE_MAP[runtimeReading.state].labelEn,
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
