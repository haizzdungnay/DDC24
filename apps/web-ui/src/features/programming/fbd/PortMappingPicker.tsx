/**
 * Panel chọn điểm để ánh xạ trực tiếp từ context menu cổng FBD.
 *
 * Tính năng:
 * - Ô tìm kiếm nhanh theo tên, displayId, thiết bị
 * - Bộ lọc danh mục (Tất cả / I/O / VP / Modbus)
 * - Bộ lọc nhanh khả năng map (Có thể map / Không thể map)
 * - Hiển thị giá trị số đo realtime và huy hiệu chất lượng (quality)
 * - Không tự đóng khi ấn Map; nút chuyển thành "Đã map"
 * - Hộp thông báo trạng thái Thành công / Thất bại (đọc rõ lý do cụ thể)
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, CheckCircle2, Search, X } from 'lucide-react'
import { useI18n } from '../../../shared/i18n'
import { normalizePointQuality, type PointQuality } from '../../../shared/api/quality'
import type { ProgrammingBinding, ProgrammingPointCatalogEntry, ProgrammingVariable } from '../model/types'
import { formatPointRuntimeValue } from './FbdNodeHoverCard'

export interface PortMappingPickerProps {
  portId?: string
  portDirection: 'INPUT' | 'OUTPUT'
  portDataType: string
  portName: string
  nodeName: string
  points: readonly ProgrammingPointCatalogEntry[]
  loading?: boolean
  bindings?: readonly ProgrammingBinding[]
  variables?: readonly ProgrammingVariable[]
  onSelect: (
    point: ProgrammingPointCatalogEntry,
  ) => Promise<{ ok: boolean; error?: string; detail?: string } | void> | void
  onUnmap?: (
    point: ProgrammingPointCatalogEntry,
  ) => Promise<{ ok: boolean; error?: string; detail?: string } | void> | void
  onClose: () => void
}

export function getPointKey(point: { category: string; pointId: string; deviceId?: string | null }): string {
  return `${point.category}::${point.pointId}::${point.deviceId ?? ''}`
}

export function findBoundPointKeyForPort(
  portId: string | undefined,
  portName: string,
  nodeName: string,
  bindings?: readonly ProgrammingBinding[],
  variables?: readonly ProgrammingVariable[],
): string | null {
  if (!bindings || bindings.length === 0) return null
  const rawName = (portName || nodeName).replace(/[^a-zA-Z0-9_]/g, '_')
  const varName = /^[a-zA-Z_]/.test(rawName) ? rawName : `v_${rawName}`

  const matching = bindings.filter((b) => {
    if (portId && b.variableId === portId) return true
    if (b.variableId === portName) return true
    const anyB = b as unknown as Record<string, unknown>
    const bVar = typeof anyB.variable === 'string' ? anyB.variable : null
    if (
      bVar &&
      (bVar === portName ||
        bVar === varName ||
        bVar === `${nodeName}_${portName}` ||
        bVar.endsWith(`_${portName}`))
    ) {
      return true
    }
    if (variables) {
      const v = variables.find((item) => item.variableId === b.variableId)
      if (
        v &&
        (v.name === portName ||
          v.name === varName ||
          v.name === `${nodeName}_${portName}` ||
          v.name.endsWith(`_${portName}`))
      ) {
        return true
      }
    }
    return false
  })
  if (matching.length === 0) return null
  return getPointKey(matching[matching.length - 1].point)
}

type CategoryFilter = '' | 'LOCAL' | 'VP' | 'MB_RTU'
type MappableFilter = 'ALL' | 'CAN_MAP' | 'CANT_MAP'

export interface PointMappingEligibility {
  canMap: boolean
  reason: string
}

/**
 * Kiểm tra tính tương thích giữa điểm và chân cổng:
 * 1. Chiều dữ liệu (INPUT cần READ / READ_WRITE; OUTPUT cần WRITE / READ_WRITE)
 * 2. Kiểu dữ liệu (BOOL vs BOOL, REAL vs REAL, v.v.)
 */
export function checkPointEligibility(
  point: ProgrammingPointCatalogEntry,
  portDirection: 'INPUT' | 'OUTPUT',
  portDataType: string,
  pick: (vi: string, en: string) => string,
): PointMappingEligibility {
  // 1. Kiểm tra chiều
  let dirOk = false
  if (portDirection === 'INPUT') {
    if (point.mapping?.input) {
      dirOk = point.mapping.input.status === 'SUPPORTED'
    } else {
      dirOk = point.direction === 'READ' || point.direction === 'READ_WRITE'
    }
  } else {
    if (point.mapping?.output) {
      dirOk = point.mapping.output.status === 'SUPPORTED'
    } else {
      dirOk = (point.direction === 'WRITE' || point.direction === 'READ_WRITE') && point.writable !== false
    }
  }

  if (!dirOk) {
    return {
      canMap: false,
      reason: portDirection === 'INPUT'
        ? pick('Điểm không hỗ trợ đọc (chỉ ghi)', 'Point cannot be read')
        : pick('Điểm không hỗ trợ ghi (chỉ đọc)', 'Point cannot be written'),
    }
  }

  // 2. Kiểm tra kiểu dữ liệu
  if (portDataType && point.dataType) {
    const portT = portDataType.trim().toUpperCase()
    const pointT = point.dataType.trim().toUpperCase()
    if (portT !== pointT) {
      return {
        canMap: false,
        reason: pick(
          `Sai kiểu dữ liệu: ${pointT} ≠ ${portT}`,
          `Data type mismatch: ${pointT} ≠ ${portT}`,
        ),
      }
    }
  }

  // 3. Kiểm tra chất lượng điểm (Backend yêu cầu GOOD với chính sách REQUIRE_GOOD)
  if (point.quality && point.quality.toUpperCase() !== 'GOOD') {
    return {
      canMap: false,
      reason: pick(
        `Chất lượng điểm không đạt (${point.quality}). Backend yêu cầu chất lượng GOOD để ánh xạ.`,
        `Point quality is not GOOD (${point.quality}). Backend requires GOOD quality for mapping.`,
      ),
    }
  }

  return {
    canMap: true,
    reason: pick('Có thể ánh xạ', 'Can map'),
  }
}

function getQualityBadgeStyle(quality: PointQuality): string {
  switch (quality) {
    case 'good':
      return 'bg-emerald-950/40 text-emerald-400 border border-emerald-800/50'
    case 'uncertain':
    case 'stale':
      return 'bg-amber-950/40 text-amber-400 border border-amber-800/50'
    case 'bad':
    case 'offline':
    case 'config_error':
      return 'bg-rose-950/40 text-rose-400 border border-rose-800/50'
    default:
      return 'bg-[var(--c-surface-2)] text-[var(--c-text-dim)] border border-[var(--c-border)]'
  }
}

export function PortMappingPicker({
  portId,
  portDirection,
  portDataType,
  portName,
  nodeName,
  points,
  loading,
  bindings,
  variables,
  onSelect,
  onUnmap,
  onClose,
}: PortMappingPickerProps) {
  const { pick } = useI18n()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<CategoryFilter>('')
  const [mappableFilter, setMappableFilter] = useState<MappableFilter>('ALL')
  const [focusIndex, setFocusIndex] = useState(0)

  // Hộp thông báo trạng thái Thành công / Thất bại (Comment 1)
  const [statusBox, setStatusBox] = useState<{
    type: 'success' | 'error'
    title?: string
    message: string
    detail?: string
  } | null>(null)

  // Trạng thái đang lưu và danh sách điểm vừa map thành công
  const [processingKey, setProcessingKey] = useState<string | null>(null)

  // Mỗi port chỉ map với 1 point duy nhất:
  // - undefined: chưa tương tác trong phiên modal -> tính từ bindings
  // - string: key của point vừa map
  // - null: vừa unmap -> không có point nào map
  const initialMappedKey = useMemo(() => {
    return findBoundPointKeyForPort(portId, portName, nodeName, bindings, variables)
  }, [portId, portName, nodeName, bindings, variables])

  const [localMappedKey, setLocalMappedKey] = useState<string | null | undefined>(undefined)
  const currentMappedKey = localMappedKey !== undefined ? localMappedKey : initialMappedKey

  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)

  // Kiểm tra xem điểm có đang là điểm duy nhất được map vào cổng này không
  function isPointMapped(point: ProgrammingPointCatalogEntry): boolean {
    if (!currentMappedKey) return false
    return currentMappedKey === getPointKey(point)
  }

  // Đánh giá eligibility cho từng điểm và áp dụng các bộ lọc kết hợp
  const itemsWithEligibility = useMemo(() => {
    return points.map((p) => ({
      point: p,
      eligibility: checkPointEligibility(p, portDirection, portDataType, pick),
    }))
  }, [points, portDirection, portDataType, pick])

  const filtered = useMemo(() => {
    const needle = query.toLowerCase().trim()
    return itemsWithEligibility.filter(({ point: p, eligibility }) => {
      // 1. Lọc theo danh mục (I/O, VP, Modbus)
      if (category && p.category !== category) return false

      // 2. Lọc theo khả năng map (Can map / Can't map)
      if (mappableFilter === 'CAN_MAP' && !eligibility.canMap) return false
      if (mappableFilter === 'CANT_MAP' && eligibility.canMap) return false

      // 3. Tìm kiếm tự do
      if (needle) {
        const haystack = [p.name, p.displayId, p.pointId, p.equipment, p.description, p.dataType, p.category]
          .filter(Boolean).join(' ').toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      return true
    })
  }, [itemsWithEligibility, category, mappableFilter, query])

  const totalMappable = useMemo(() => {
    return itemsWithEligibility.filter(({ eligibility }) => eligibility.canMap).length
  }, [itemsWithEligibility])

  useEffect(() => { setFocusIndex(0) }, [filtered.length, query, category, mappableFilter])
  useEffect(() => { searchRef.current?.focus() }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // Thực hiện ánh xạ điểm và hiển thị box trạng thái
  async function handleMapPoint(point: ProgrammingPointCatalogEntry) {
    const key = getPointKey(point)
    setProcessingKey(key)
    setStatusBox(null)
    try {
      const result = await onSelect(point)
      if (result && !result.ok) {
        setStatusBox({
          type: 'error',
          title: pick('Ánh xạ thất bại', 'Mapping failed'),
          message: result.error || pick('Ánh xạ điểm thất bại.', 'Point mapping failed.'),
          detail: result.detail,
        })
      } else {
        // Chỉ lưu 1 point duy nhất; điểm cũ tự động trở lại nút Map
        setLocalMappedKey(key)
        setStatusBox({
          type: 'success',
          title: pick('Ánh xạ thành công!', 'Mapping successful!'),
          message: pick(
            `Đã ánh xạ thành công điểm "${point.displayId ?? point.name}" vào chân ${portName}!`,
            `Successfully mapped point "${point.displayId ?? point.name}" to port ${portName}!`,
          ),
        })
      }
    } catch (err) {
      setStatusBox({
        type: 'error',
        title: pick('Ánh xạ thất bại', 'Mapping failed'),
        message: pick('Đã xảy ra lỗi khi ánh xạ điểm.', 'An error occurred while mapping the point.'),
        detail: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setProcessingKey(null)
    }
  }

  // Thực hiện hủy ánh xạ điểm và hiển thị box trạng thái
  async function handleUnmapPoint(point: ProgrammingPointCatalogEntry) {
    if (!onUnmap) return
    const key = getPointKey(point)
    setProcessingKey(key)
    setStatusBox(null)
    try {
      const result = await onUnmap(point)
      if (result && !result.ok) {
        setStatusBox({
          type: 'error',
          title: pick('Hủy ánh xạ thất bại', 'Unmapping failed'),
          message: result.error || pick('Hủy ánh xạ điểm thất bại.', 'Point unmapping failed.'),
          detail: result.detail,
        })
      } else {
        setLocalMappedKey(null)
        setStatusBox({
          type: 'success',
          title: pick('Hủy ánh xạ thành công!', 'Unmapping successful!'),
          message: pick(
            `Đã hủy ánh xạ điểm "${point.displayId ?? point.name}" khỏi chân ${portName}!`,
            `Successfully unmapped point "${point.displayId ?? point.name}" from port ${portName}!`,
          ),
        })
      }
    } catch (err) {
      setStatusBox({
        type: 'error',
        title: pick('Hủy ánh xạ thất bại', 'Unmapping failed'),
        message: pick('Đã xảy ra lỗi khi hủy ánh xạ điểm.', 'An error occurred while unmapping the point.'),
        detail: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setProcessingKey(null)
    }
  }

  // Bấm nút "Can't map" hiển thị box giải thích lý do cụ thể
  function handleCantMapClick(point: ProgrammingPointCatalogEntry, reason: string) {
    setStatusBox({
      type: 'error',
      message: pick(
        `Không thể ánh xạ điểm "${point.displayId ?? point.name}" vào chân ${portName}:`,
        `Cannot map point "${point.displayId ?? point.name}" to port ${portName}:`,
      ),
      detail: reason,
    })
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocusIndex((i) => Math.min(filtered.length - 1, i + 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setFocusIndex((i) => Math.max(0, i - 1)) }
    if (e.key === 'Enter') {
      const current = filtered[focusIndex]
      if (current) {
        e.preventDefault()
        if (isPointMapped(current.point)) {
          if (onUnmap) void handleUnmapPoint(current.point)
        } else if (current.eligibility.canMap) {
          void handleMapPoint(current.point)
        } else if (!current.eligibility.canMap) {
          handleCantMapClick(current.point, current.eligibility.reason)
        }
      }
    }
  }

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${focusIndex}"]`)
    if (typeof el?.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [focusIndex])

  const categories: { value: CategoryFilter; label: string }[] = [
    { value: '', label: pick('Tất cả', 'All') },
    { value: 'LOCAL', label: 'I/O' },
    { value: 'VP', label: 'VP' },
    { value: 'MB_RTU', label: 'Modbus' },
  ]

  const dirLabel = portDirection === 'INPUT' ? pick('Đầu vào', 'Input') : pick('Đầu ra', 'Output')

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[1px]"
      onClick={(e) => { if (e.target === backdropRef.current) onClose() }}
    >
      <div
        role="dialog"
        aria-label={pick('Chọn điểm ánh xạ', 'Select mapping point')}
        className="flex max-h-[75vh] w-full max-w-2xl flex-col rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] shadow-2xl"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--c-border)] px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--c-text)]">
              {pick('Ánh xạ điểm', 'Map Point')}
            </h2>
            <p className="text-xs text-[var(--c-text-dim)]">
              {nodeName} · {portName} (<span className="font-semibold text-[var(--c-accent)]">{portDataType}</span>) · {dirLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--c-text-dim)] hover:text-[var(--c-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{pick('Đóng', 'Close')}</span>
          </button>
        </div>

        {/* Search */}
        <div className="relative border-b border-[var(--c-border)] px-4 py-2">
          <Search className="absolute left-6 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--c-text-dim)]" aria-hidden="true" />
          <input
            ref={searchRef}
            className="w-full rounded border border-[var(--c-border)] bg-transparent py-1.5 pl-8 pr-2 text-xs text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
            placeholder={pick('Tìm điểm theo tên, display ID, thiết bị…', 'Find point by name, display ID, equipment…')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {/* Category chips + Quick Filter toggles */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--c-border)] px-4 py-2">
          {/* Nguồn điểm */}
          <div className="flex items-center gap-1">
            {categories.map((c) => (
              <button
                key={c.value}
                type="button"
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${
                  category === c.value
                    ? 'bg-[var(--c-accent)] text-white'
                    : 'bg-[var(--c-surface-2)] text-[var(--c-text-dim)] hover:text-[var(--c-text)]'
                }`}
                onClick={() => setCategory(c.value)}
              >
                {c.label}
              </button>
            ))}
          </div>

          {/* Hai trường lọc nhanh: Can map & Can't map (Comment 2) */}
          <div className="flex items-center gap-1 border-l border-[var(--c-border)] pl-2">
            <button
              type="button"
              data-testid="filter-can-map"
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition border ${
                mappableFilter === 'CAN_MAP'
                  ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                  : 'bg-[var(--c-surface-2)] text-[var(--c-text-dim)] border-transparent hover:text-emerald-400'
              }`}
              onClick={() => setMappableFilter((current) => current === 'CAN_MAP' ? 'ALL' : 'CAN_MAP')}
              title={pick('Bật/tắt chỉ hiện các điểm có thể ánh xạ', 'Toggle to show only mappable points')}
            >
              {pick('✓ Có thể map', '✓ Can map')}
            </button>
            <button
              type="button"
              data-testid="filter-cant-map"
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition border ${
                mappableFilter === 'CANT_MAP'
                  ? 'bg-rose-600 text-white border-rose-500 shadow-sm'
                  : 'bg-[var(--c-surface-2)] text-[var(--c-text-dim)] border-transparent hover:text-rose-400'
              }`}
              onClick={() => setMappableFilter((current) => current === 'CANT_MAP' ? 'ALL' : 'CANT_MAP')}
              title={pick('Bật/tắt xem các điểm không thể ánh xạ', 'Toggle to show points that cannot be mapped')}
            >
              {pick('✕ Không thể map', "✕ Can't map")}
            </button>
          </div>
        </div>

        {/* Hộp thông báo Thành công / Thất bại (Comment 1) */}
        {statusBox && (
          <div
            data-testid="port-mapping-status-box"
            role={statusBox.type === 'error' ? 'alert' : 'status'}
            className={`mx-4 mt-2.5 flex items-start gap-2.5 rounded-lg border p-2.5 text-xs shadow-md transition-all ${
              statusBox.type === 'success'
                ? 'border-emerald-500/60 bg-emerald-950/60 text-emerald-200'
                : 'border-rose-500/60 bg-rose-950/60 text-rose-200'
            }`}
          >
            {statusBox.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
            )}
            <div className="min-w-0 flex-1">
              <div className="font-semibold">
                {statusBox.title || (statusBox.type === 'success'
                  ? pick('Thành công!', 'Success!')
                  : pick('Thất bại', 'Failed'))}
              </div>
              <div className="mt-0.5 text-[11px] opacity-90">{statusBox.message}</div>
              {statusBox.detail && (
                <div className="mt-1 rounded border border-rose-800/40 bg-rose-900/30 p-1.5 font-mono text-[10px] text-rose-300">
                  {statusBox.detail}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setStatusBox(null)}
              className="rounded p-0.5 opacity-70 hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
              <span className="sr-only">{pick('Đóng thông báo', 'Close notice')}</span>
            </button>
          </div>
        )}

        {/* List */}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto divide-y divide-[var(--c-border)]/50">
          {loading && (
            <p className="px-4 py-8 text-center text-xs text-[var(--c-text-dim)]">
              {pick('Đang tải danh mục điểm…', 'Loading point catalog…')}
            </p>
          )}
          {!loading && filtered.length === 0 && (
            <p className="px-4 py-8 text-center text-xs text-[var(--c-text-dim)]">
              {pick('Không tìm thấy điểm phù hợp với bộ lọc.', 'No points matching current filter.')}
            </p>
          )}
          {filtered.map(({ point, eligibility }, i) => {
            const pointKeyStr = `${point.category}::${point.pointId}::${point.deviceId ?? ''}`
            const rawVal = formatPointRuntimeValue(point.value, point.unit)
            const qualityNorm = normalizePointQuality(point.quality)
            const qualityBadgeClass = getQualityBadgeStyle(qualityNorm)
            const isMapped = isPointMapped(point)
            const isCurrentProcessing = processingKey === pointKeyStr

            return (
              <div
                key={pointKeyStr}
                data-index={i}
                className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-xs transition ${
                  i === focusIndex
                    ? 'bg-[var(--c-surface-2)]'
                    : 'hover:bg-[var(--c-surface-2)]/60'
                }`}
                onMouseEnter={() => setFocusIndex(i)}
              >
                {/* Thông tin định danh điểm */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-bold text-sm text-[var(--c-text)]">
                      {point.displayId ?? point.pointId}
                    </span>
                    <span className="rounded bg-[var(--c-surface-2)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--c-text-dim)]">
                      {point.category}
                    </span>
                    <span className="rounded bg-[var(--c-surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--c-text-dim)]">
                      {point.direction}
                    </span>
                    <span className={`font-mono text-[11px] font-semibold ${
                      point.dataType?.toUpperCase() === portDataType?.toUpperCase()
                        ? 'text-emerald-400'
                        : 'text-amber-400'
                    }`}>
                      {point.dataType}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-[var(--c-text-dim)]">
                    <span className="font-medium text-[var(--c-text)]">{point.name}</span>
                    {point.unit && <span>· {point.unit}</span>}
                    {point.equipment && <span>· {point.equipment}</span>}
                  </div>
                  {point.sourceDetail && (
                    <p className="mt-0.5 font-mono text-[10px] text-[var(--c-text-dim)]">{point.sourceDetail}</p>
                  )}
                  {!eligibility.canMap && (
                    <p className="mt-1 text-[10px] text-rose-400">{eligibility.reason}</p>
                  )}
                </div>

                {/* Cột phải: Giá trị số đo + Trạng thái chất lượng + Nút Map / Can't map / Đã map */}
                <div className="flex shrink-0 items-center gap-3">
                  {/* Giá trị số đo & Chất lượng (Comment 1) */}
                  <div className="flex flex-col items-end gap-1 font-mono text-xs">
                    <span className="font-bold text-[var(--c-text)]">
                      {rawVal ?? '—'}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.2 text-[10px] font-semibold uppercase ${qualityBadgeClass}`}
                    >
                      {qualityNorm.toUpperCase()}
                    </span>
                  </div>

                  {/* Nút hành động (Comment 1) */}
                  {isMapped ? (
                    <div className="flex items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 rounded border border-emerald-500/60 bg-emerald-950/60 px-2.5 py-1.5 text-xs font-semibold text-emerald-300">
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                        {pick('Đã map', 'Mapped')}
                      </span>
                      {onUnmap && (
                        <button
                          type="button"
                          data-testid={`unmap-btn-${point.pointId}`}
                          disabled={processingKey !== null}
                          onClick={(e) => {
                            e.stopPropagation()
                            void handleUnmapPoint(point)
                          }}
                          className="rounded border border-rose-800/60 bg-rose-950/40 px-2.5 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-900/60 hover:text-rose-100 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-500"
                        >
                          {isCurrentProcessing ? pick('Đang hủy…', 'Unmapping…') : pick('Hủy map', 'Unmap')}
                        </button>
                      )}
                    </div>
                  ) : eligibility.canMap ? (
                    <button
                      type="button"
                      data-testid={`map-btn-${point.pointId}`}
                      disabled={processingKey !== null}
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleMapPoint(point)
                      }}
                      className="rounded bg-[var(--c-accent)] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)] disabled:opacity-50"
                    >
                      {isCurrentProcessing ? pick('Đang map…', 'Mapping…') : pick('Ánh xạ', 'Map')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      data-testid={`cant-map-btn-${point.pointId}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleCantMapClick(point, eligibility.reason)
                      }}
                      title={eligibility.reason}
                      className="rounded border border-rose-900/40 bg-[var(--c-surface-2)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--c-text-dim)] transition hover:border-rose-700/60 hover:text-rose-300"
                    >
                      {pick("Không thể map", "Can't map")}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--c-border)] px-4 py-2.5 text-xs text-[var(--c-text-dim)]">
          <span>
            {filtered.length} {pick('điểm hiển thị', 'points shown')} · {totalMappable} {pick('điểm có thể ánh xạ', 'mappable')}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1 text-xs text-[var(--c-text-dim)] hover:text-[var(--c-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
          >
            {pick('Đóng', 'Close')}
          </button>
        </div>
      </div>
    </div>
  )
}
