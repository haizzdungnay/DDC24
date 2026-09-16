/**
 * Hộp thoại hiển thị thông tin chi tiết khối FBD (Block Properties Modal).
 *
 * Mở khi người dùng chọn "Properties" / "Thuộc tính" trong context menu chuột phải của block FBD.
 * Trình bày chi tiết:
 * - Thuộc tính POU (Tên, Loại, Ngôn ngữ, Instance, v.v.)
 * - Truy cập & Mô tả (Access, Description)
 * - Tham số chung (General Parameters / Tuning parameters)
 * - Cổng I/O (Inputs, Outputs, trạng thái ánh xạ điểm, giá trị số đo realtime)
 * - Trạng thái (Status, Kiểm tra hợp lệ, Runtime)
 * - Thuộc tính mở rộng & Dây nối (Attributes, Dimensions, Wires)
 */
import { useEffect, useMemo, useRef } from 'react'
import {
  AlertCircle,
  Box,
  Cable,
  CheckCircle2,
  Cpu,
  FileCode2,
  Info,
  Layers,
  MapPin,
  Sliders,
  X,
} from 'lucide-react'
import { useI18n } from '../../../shared/i18n'
import type { FbdDocument, FbdNetwork, FbdNode, FbdPort } from './model'
import type { FbdNodeGeometry } from './geometry'
import type { FbdRuntimeOverlay } from './runtimeOverlay'
import { resolvePortMappingInfo } from './FbdNodeHoverCard'
import type {
  ProgrammingBinding,
  ProgrammingPointCatalogEntry,
  ProgrammingProgram,
  ProgrammingVariable,
} from '../model/types'

export interface FbdBlockPropertiesModalProps {
  node: FbdNode
  nodeGeometry?: FbdNodeGeometry | null
  network: FbdNetwork
  document?: FbdDocument
  programs?: readonly ProgrammingProgram[]
  bindings?: readonly ProgrammingBinding[]
  variables?: readonly ProgrammingVariable[]
  pointCatalogItems?: readonly ProgrammingPointCatalogEntry[]
  runtime?: FbdRuntimeOverlay | null
  issueNodeIds?: ReadonlySet<string>
  onClose: () => void
  onRequestPortMapping?: (info: {
    nodeId: string
    portId: string
    portName: string
    nodeName: string
    portDirection: 'INPUT' | 'OUTPUT'
    portDataType: string
  }) => void
}

export function FbdBlockPropertiesModal({
  node,
  nodeGeometry,
  network,
  document,
  programs,
  bindings,
  variables,
  pointCatalogItems,
  runtime,
  issueNodeIds,
  onClose,
  onRequestPortMapping,
}: FbdBlockPropertiesModalProps) {
  const { pick } = useI18n()
  const backdropRef = useRef<HTMLDivElement>(null)

  // Tìm POU tương ứng trong danh sách programs của dự án (nếu là user POU)
  const pouProgram = useMemo(() => {
    return programs?.find(
      (p) => p.name === node.typeRef || p.objectId === node.typeRef || p.programId === node.typeRef,
    )
  }, [programs, node.typeRef])

  // Lắng nghe phím Escape để đóng modal
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [onClose])

  const inputPorts = useMemo(() => node.ports.filter((p) => p.direction === 'INPUT'), [node.ports])
  const outputPorts = useMemo(() => node.ports.filter((p) => p.direction === 'OUTPUT'), [node.ports])

  // Lấy các dây nối liên quan tới block này
  const connectedWires = useMemo(() => {
    const wires = network.wires || document?.networks?.flatMap((net) => net.wires) || []
    return wires.filter((w) => w.from.nodeId === node.id || w.to.nodeId === node.id)
  }, [network.wires, document?.networks, node.id])

  // Danh sách tham số cấu hình / chỉnh định
  const parameterEntries = useMemo(() => {
    return Object.entries(node.parameters || {}).filter(
      ([k]) => k !== 'instance' && k !== 'retained',
    )
  }, [node.parameters])

  const hasIssue = issueNodeIds?.has(node.id) === true
  const nodeReading = runtime?.byNodeId.get(node.id)

  const languageLabel = pouProgram?.language ?? 'IEC 61131-3'
  const accessText = pouProgram?.access || pick('Kỹ sư vận hành', 'Commissioning engineer')
  const descriptionText =
    pouProgram?.description || pick('Chưa ghi mô tả cho khối này.', 'No description for this block.')

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={pick(`Thuộc tính khối ${node.typeRef}`, `Block Properties: ${node.typeRef}`)}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-[var(--c-border)] bg-[var(--c-bg)] shadow-2xl transition-all text-[var(--c-text)] text-xs"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--c-border)] px-5 py-3.5 bg-[var(--c-surface)] rounded-t-xl">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--c-accent)]/15 text-[var(--c-accent)] border border-[var(--c-accent)]/30">
              <Box className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold tracking-tight text-[var(--c-text)]">
                  {node.typeRef}
                </h2>
                <span className="rounded bg-[var(--c-surface-2)] px-2 py-0.5 font-mono text-[11px] font-semibold text-[var(--c-accent)]">
                  #{node.executionOrder}
                </span>
                <span className="rounded-full bg-[var(--c-surface-2)] px-2 py-0.5 text-[10px] font-medium text-[var(--c-text-dim)] uppercase">
                  {node.kind}
                </span>
              </div>
              <p className="text-[11px] text-[var(--c-text-dim)] mt-0.5">
                {pick('Ngôn ngữ:', 'Language:')} <span className="font-medium text-[var(--c-text)]">{languageLabel}</span> · ID: <span className="font-mono text-[10px]">{node.id}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--c-text-dim)] hover:bg-[var(--c-surface-2)] hover:text-[var(--c-text)] transition"
          >
            <X className="h-5 w-5" aria-hidden="true" />
            <span className="sr-only">{pick('Đóng', 'Close')}</span>
          </button>
        </div>

        {/* Modal Body - Scrollable */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* Section 1: POU Properties (Thuộc tính POU) */}
          <div className="rounded-lg border border-[var(--c-border)] bg-[var(--c-surface)] p-3.5 space-y-2">
            <div className="flex items-center gap-2 font-semibold text-xs text-[var(--c-text)] border-b border-[var(--c-border)]/60 pb-1.5">
              <Cpu className="h-4 w-4 text-[var(--c-accent)]" />
              <span>{pick('Thuộc tính POU (POU Properties)', 'POU Properties')}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-1">
              <div>
                <span className="block text-[11px] text-[var(--c-text-dim)]">{pick('Tên POU', 'POU Name')}</span>
                <span className="font-semibold text-xs">{node.typeRef}</span>
              </div>
              <div>
                <span className="block text-[11px] text-[var(--c-text-dim)]">{pick('Loại POU', 'POU Kind')}</span>
                <span className="font-mono text-xs uppercase">{node.kind}</span>
              </div>
              <div>
                <span className="block text-[11px] text-[var(--c-text-dim)]">{pick('Instance', 'Instance')}</span>
                <span className="font-mono text-xs">
                  {typeof node.parameters?.instance === 'string' && node.parameters.instance.trim()
                    ? node.parameters.instance
                    : pick('Chưa đặt tên instance', 'No instance name')}
                </span>
              </div>
              <div>
                <span className="block text-[11px] text-[var(--c-text-dim)]">{pick('Thứ tự thực thi', 'Execution Order')}</span>
                <span className="font-mono text-xs font-semibold text-[var(--c-accent)]">#{node.executionOrder}</span>
              </div>
              <div>
                <span className="block text-[11px] text-[var(--c-text-dim)]">{pick('Lưu giữ (Retained)', 'Retained')}</span>
                <span className="font-mono text-xs">
                  {node.parameters?.retained === true ? pick('Có (TRUE)', 'Yes (TRUE)') : pick('Không (FALSE)', 'No (FALSE)')}
                </span>
              </div>
              <div>
                <span className="block text-[11px] text-[var(--c-text-dim)]">{pick('Số cổng I/O', 'Total Ports')}</span>
                <span className="font-semibold text-xs">{node.ports.length} ({inputPorts.length} vào, {outputPorts.length} ra)</span>
              </div>
            </div>
          </div>

          {/* Section 2: Access & Description (Truy cập & Mô tả) */}
          <div className="rounded-lg border border-[var(--c-border)] bg-[var(--c-surface)] p-3.5 space-y-2">
            <div className="flex items-center gap-2 font-semibold text-xs text-[var(--c-text)] border-b border-[var(--c-border)]/60 pb-1.5">
              <FileCode2 className="h-4 w-4 text-[var(--c-accent)]" />
              <span>{pick('Truy cập & Mô tả (Access & Description)', 'Access & Description')}</span>
            </div>
            <div className="space-y-2 pt-1">
              <div>
                <span className="block text-[11px] text-[var(--c-text-dim)] font-medium mb-0.5">
                  {pick('Quyền truy cập (Access):', 'Access rights:')}
                </span>
                <div className="rounded bg-[var(--c-surface-2)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--c-text)]">
                  {accessText}
                </div>
              </div>
              <div>
                <span className="block text-[11px] text-[var(--c-text-dim)] font-medium mb-0.5">
                  {pick('Mô tả POU (Description):', 'Description:')}
                </span>
                <div className="rounded bg-[var(--c-surface-2)] px-2.5 py-1.5 text-[11px] text-[var(--c-text)] leading-relaxed">
                  {descriptionText}
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: General Parameters / Tuning Parameters */}
          <div className="rounded-lg border border-[var(--c-border)] bg-[var(--c-surface)] p-3.5 space-y-2">
            <div className="flex items-center gap-2 font-semibold text-xs text-[var(--c-text)] border-b border-[var(--c-border)]/60 pb-1.5">
              <Sliders className="h-4 w-4 text-[var(--c-accent)]" />
              <span>{pick('Tham số chung (General Parameters)', 'General Parameters')}</span>
            </div>
            {parameterEntries.length === 0 ? (
              <p className="text-[11px] text-[var(--c-text-dim)] italic pt-1">
                {pick('Khối này không khai báo thêm tham số chỉnh định nào.', 'No additional tuning parameters declared for this block.')}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2 pt-1">
                {parameterEntries.map(([key, val]) => (
                  <div key={key} className="flex items-center justify-between rounded bg-[var(--c-surface-2)] px-2.5 py-1.5 font-mono text-[11px]">
                    <span className="text-[var(--c-text-dim)]">{key}:</span>
                    <span className="font-semibold text-[var(--c-text)]">{String(val)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 4: I/O Ports & Mappings (Cổng vào/ra & Điểm ánh xạ) */}
          <div className="rounded-lg border border-[var(--c-border)] bg-[var(--c-surface)] p-3.5 space-y-3">
            <div className="flex items-center justify-between border-b border-[var(--c-border)]/60 pb-1.5">
              <div className="flex items-center gap-2 font-semibold text-xs text-[var(--c-text)]">
                <MapPin className="h-4 w-4 text-[var(--c-accent)]" />
                <span>{pick('Cổng I/O & Ánh xạ điểm (I/O & Mappings)', 'I/O & Mappings')}</span>
              </div>
              <span className="text-[11px] text-[var(--c-text-dim)]">
                {inputPorts.length} {pick('vào', 'in')} · {outputPorts.length} {pick('ra', 'out')}
              </span>
            </div>

            {/* Inputs */}
            {inputPorts.length > 0 && (
              <div>
                <span className="block font-semibold text-[11px] text-[var(--c-text-dim)] mb-1.5">
                  {pick('Cổng vào (Inputs):', 'Inputs:')}
                </span>
                <div className="space-y-1.5">
                  {inputPorts.map((port) => (
                    <PortRowItem
                      key={port.id}
                      port={port}
                      node={node}
                      bindings={bindings}
                      variables={variables}
                      pointCatalogItems={pointCatalogItems}
                      runtime={runtime}
                      pick={pick}
                      onRequestPortMapping={onRequestPortMapping}
                      onClose={onClose}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Outputs */}
            {outputPorts.length > 0 && (
              <div className="pt-1">
                <span className="block font-semibold text-[11px] text-[var(--c-text-dim)] mb-1.5">
                  {pick('Cổng ra (Outputs):', 'Outputs:')}
                </span>
                <div className="space-y-1.5">
                  {outputPorts.map((port) => (
                    <PortRowItem
                      key={port.id}
                      port={port}
                      node={node}
                      bindings={bindings}
                      variables={variables}
                      pointCatalogItems={pointCatalogItems}
                      runtime={runtime}
                      pick={pick}
                      onRequestPortMapping={onRequestPortMapping}
                      onClose={onClose}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Section 5: Status (Trạng thái & Kiểm tra) */}
          <div className="rounded-lg border border-[var(--c-border)] bg-[var(--c-surface)] p-3.5 space-y-2">
            <div className="flex items-center gap-2 font-semibold text-xs text-[var(--c-text)] border-b border-[var(--c-border)]/60 pb-1.5">
              <Info className="h-4 w-4 text-[var(--c-accent)]" />
              <span>{pick('Trạng thái (Status)', 'Status')}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              <div className="flex items-center justify-between rounded bg-[var(--c-surface-2)] px-2.5 py-2">
                <span className="text-[var(--c-text-dim)]">{pick('Kiểm tra hợp lệ:', 'Validation:')}</span>
                {hasIssue ? (
                  <span className="flex items-center gap-1 font-semibold text-rose-400">
                    <AlertCircle className="h-3.5 w-3.5" />
                    {pick('Có vấn đề', 'Has issues')}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 font-semibold text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {pick('Hợp lệ (Valid)', 'Valid')}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between rounded bg-[var(--c-surface-2)] px-2.5 py-2">
                <span className="text-[var(--c-text-dim)]">{pick('Giá trị chạy:', 'Runtime value:')}</span>
                {nodeReading ? (
                  <span className="font-mono font-bold text-emerald-400">
                    {nodeReading.display}{nodeReading.unit ? ` ${nodeReading.unit}` : ''}
                  </span>
                ) : (
                  <span className="italic text-[var(--c-text-dim)]">
                    {pick('Chưa có nguồn runtime', 'No runtime source')}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Section 6: Attributes & Wires (Thuộc tính mở rộng & Dây nối) */}
          <div className="rounded-lg border border-[var(--c-border)] bg-[var(--c-surface)] p-3.5 space-y-2">
            <div className="flex items-center gap-2 font-semibold text-xs text-[var(--c-text)] border-b border-[var(--c-border)]/60 pb-1.5">
              <Layers className="h-4 w-4 text-[var(--c-accent)]" />
              <span>{pick('Thuộc tính mở rộng & Dây nối (Attributes & Wires)', 'Attributes & Wires')}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-1 text-[11px]">
              <div>
                <span className="block text-[var(--c-text-dim)]">{pick('Namespace', 'Namespace')}</span>
                <span className="italic text-[var(--c-text-dim)]">{pick('không xác định được', 'not determinable')}</span>
              </div>
              <div>
                <span className="block text-[var(--c-text-dim)]">{pick('Toạ độ (Canvas pos)', 'Position')}</span>
                <span className="font-mono text-xs">
                  {nodeGeometry ? `X: ${nodeGeometry.x}, Y: ${nodeGeometry.y}` : '—'}
                </span>
              </div>
              <div>
                <span className="block text-[var(--c-text-dim)]">{pick('Kích thước (Bbox)', 'Dimensions')}</span>
                <span className="font-mono text-xs">
                  {nodeGeometry ? `${nodeGeometry.width} × ${nodeGeometry.height} px` : '—'}
                </span>
              </div>
            </div>

            {/* Dây nối */}
            <div className="pt-2 border-t border-[var(--c-border)]/50">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--c-text-dim)] mb-1">
                <Cable className="h-3.5 w-3.5" />
                <span>{pick('Dây nối gắn vào khối:', 'Connected wires:')} {connectedWires.length}</span>
              </div>
              {connectedWires.length === 0 ? (
                <p className="text-[11px] text-[var(--c-text-dim)] italic pl-1">
                  {pick('Chưa có dây nối nào nối vào khối này.', 'No wires connected to this block.')}
                </p>
              ) : (
                <ul className="space-y-1 pl-1">
                  {connectedWires.map((w) => {
                    const isSource = w.from.nodeId === node.id
                    return (
                      <li key={w.id} className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--c-text-dim)]">
                        <span className={`rounded px-1 py-0.2 uppercase font-semibold ${isSource ? 'bg-blue-950/40 text-blue-400' : 'bg-purple-950/40 text-purple-400'}`}>
                          {isSource ? 'OUT' : 'IN'}
                        </span>
                        <span>Wire: {w.id.slice(0, 8)}…</span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--c-border)] px-5 py-3 bg-[var(--c-surface)] rounded-b-xl">
          <span className="text-[11px] text-[var(--c-text-dim)]">
            {pick('Ấn Esc hoặc click bên ngoài để đóng', 'Press Esc or click outside to close')}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-[var(--c-surface-2)] hover:bg-[var(--c-border)] px-4 py-1.5 text-xs font-semibold text-[var(--c-text)] transition"
          >
            {pick('Đóng', 'Close')}
          </button>
        </div>
      </div>
    </div>
  )
}

function PortRowItem({
  port,
  node,
  bindings,
  variables,
  pointCatalogItems,
  runtime,
  pick,
  onRequestPortMapping,
  onClose,
}: {
  port: FbdPort
  node: FbdNode
  bindings?: readonly ProgrammingBinding[]
  variables?: readonly ProgrammingVariable[]
  pointCatalogItems?: readonly ProgrammingPointCatalogEntry[]
  runtime?: FbdRuntimeOverlay | null
  pick: (vi: string, en: string) => string
  onRequestPortMapping?: (info: {
    nodeId: string
    portId: string
    portName: string
    nodeName: string
    portDirection: 'INPUT' | 'OUTPUT'
    portDataType: string
  }) => void
  onClose: () => void
}) {
  const mappingInfo = resolvePortMappingInfo(
    port,
    node,
    bindings,
    variables,
    pointCatalogItems,
    runtime?.byPortId,
  )

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--c-surface-2)] px-3 py-2 text-[11px]">
      <div className="flex items-center gap-2">
        <span className="font-mono font-bold text-xs text-[var(--c-text)]">{port.name}</span>
        <span className="font-mono text-[10px] text-[var(--c-text-dim)]">: {port.dataType}</span>
        {port.unit && <span className="text-[10px] text-[var(--c-text-dim)]">({port.unit})</span>}
      </div>

      <div className="flex items-center gap-2">
        {mappingInfo.isMapped ? (
          <div className="flex items-center gap-1.5 font-mono">
            <span className="flex items-center gap-1 rounded bg-emerald-950/50 border border-emerald-800/60 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
              {mappingInfo.display}
            </span>
          </div>
        ) : (
          <span className="rounded bg-[var(--c-bg)] px-2 py-0.5 text-[10px] text-[var(--c-text-dim)] italic">
            {pick('Chưa ánh xạ', 'Not mapped')}
          </span>
        )}

        {onRequestPortMapping && (
          <button
            type="button"
            onClick={() => {
              onClose()
              onRequestPortMapping({
                nodeId: node.id,
                portId: port.id,
                portName: port.name,
                nodeName: node.typeRef ?? node.kind,
                portDirection: port.direction,
                portDataType: port.dataType,
              })
            }}
            className="rounded bg-[var(--c-surface)] hover:bg-[var(--c-accent)] hover:text-white border border-[var(--c-border)] px-2 py-0.5 text-[10px] font-medium transition"
          >
            {mappingInfo.isMapped ? pick('Đổi map', 'Remap') : pick('Ánh xạ', 'Map')}
          </button>
        )}
      </div>
    </div>
  )
}

