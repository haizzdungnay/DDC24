import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { apiClient } from '../../shared/api/client'
import { ApiError } from '../../shared/types'
import type {
  ModbusBus,
  ModbusConfigLifecycle,
  ModbusConfigState,
  ModbusPortCapability,
  ModbusRTUDevice,
  ModbusRTUPoint
} from '../../shared/types'

/**
 * MBR-B302 — ba nguồn state TÁCH BẠCH.
 *
 * Bản trước trộn cả ba làm một: mỗi thao tác CRUD ghi thẳng vào cấu hình đang
 * chạy, nên "cái tôi đang sửa", "cái đã lưu" và "cái thiết bị đang chạy" là
 * cùng một thứ trên màn hình — và người dùng không có cách nào biết thay đổi
 * của mình đã tới thiết bị chưa.
 *
 *  1. `draft`     — thứ người dùng đang gõ, chỉ nằm trong trình duyệt.
 *  2. `state`     — bản nháp đã lưu trên server + khác biệt so với bản đang chạy.
 *  3. `running`   — thứ iobus THẬT SỰ đang chạy (revision do chính iobus báo).
 *
 * Không liên lạc được iobus ⇒ `running.reachable = false`, và UI phải hiện
 * "không rõ" thay vì "đã đồng bộ".
 */
export interface ModbusDraft {
  buses: ModbusBus[]
  devices: ModbusRTUDevice[]
  points: ModbusRTUPoint[]
}

interface ModbusConfigContextValue {
  draft: ModbusDraft
  state: ModbusConfigState | null
  ports: ModbusPortCapability[]
  loading: boolean
  error: string
  /** Lỗi validate do server trả về, giữ theo `path` để gắn vào đúng ô nhập. */
  fieldErrors: Record<string, string>
  lifecycle: ModbusConfigLifecycle
  /** Khoá mọi mutation khi đang apply (MBR-B303). */
  locked: boolean
  setDraft: (next: ModbusDraft) => void
  reload: () => Promise<void>
  save: () => Promise<boolean>
  apply: () => Promise<boolean>
  discard: () => Promise<void>
  status: string
}

const emptyDraft: ModbusDraft = { buses: [], devices: [], points: [] }

const ModbusConfigContext = createContext<ModbusConfigContextValue | null>(null)

/** Sinh operation_id để apply idempotent qua các lần thử lại (MBR-B203). */
function newOperationId(): string {
  const random = Math.random().toString(36).slice(2, 10)
  return `op-${Date.now().toString(36)}-${random}`
}

export function ModbusConfigProvider({ children }: { children: ReactNode }) {
  const [draft, setDraftState] = useState<ModbusDraft>(emptyDraft)
  const [state, setState] = useState<ModbusConfigState | null>(null)
  const [ports, setPorts] = useState<ModbusPortCapability[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [applying, setApplying] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [candidate, nextState, portList] = await Promise.all([
        apiClient.getModbusCandidate(),
        apiClient.getModbusConfigState(),
        apiClient.getModbusPorts()
      ])
      setDraftState({
        buses: candidate.config?.buses ?? [],
        devices: candidate.config?.devices ?? [],
        points: candidate.config?.points ?? []
      })
      // `diff` null từ backend là hợp lệ về mặt JSON nhưng gây nổ ở mọi chỗ
      // dùng `.length`/`.map`. Chuẩn hoá NGAY tại biên vào.
      setState({ ...nextState, diff: nextState.diff ?? [] })
      setPorts(portList)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không tải được cấu hình Modbus RTU')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const setDraft = useCallback((next: ModbusDraft) => {
    setDraftState(next)
    // Xoá lỗi cũ khi người dùng vừa sửa: giữ lại làm ô nhập đỏ mãi dù đã sửa đúng.
    setFieldErrors({})
  }, [])

  const save = useCallback(async () => {
    if (!state) return false
    setStatus('Đang lưu bản nháp…')
    try {
      const result = await apiClient.saveModbusCandidate({
        base_revision: state.active_revision,
        buses: draft.buses,
        devices: draft.devices,
        points: draft.points
      })
      setState((current) => (current ? { ...current, state: result.state, diff: result.diff ?? [] } : current))
      setFieldErrors({})
      setStatus('Đã lưu bản nháp. Thay đổi CHƯA xuống thiết bị — bấm “Áp dụng” để phát.')
      return true
    } catch (err) {
      if (err instanceof ApiError) {
        const next: Record<string, string> = {}
        for (const detail of err.details) next[detail.path] = detail.message ?? 'không hợp lệ'
        setFieldErrors(next)
        setStatus(err.status === 412
          ? 'Cấu hình trên thiết bị đã đổi từ lúc bạn mở trang. Hãy tải lại rồi soạn lại.'
          : err.message)
      } else {
        setStatus(err instanceof Error ? err.message : 'Không lưu được bản nháp')
      }
      return false
    }
  }, [draft, state])

  const apply = useCallback(async () => {
    if (!state) return false
    setApplying(true)
    setStatus('Đang áp dụng cấu hình xuống iobus…')
    try {
      const result = await apiClient.applyModbusConfig({
        base_revision: state.active_revision,
        operation_id: newOperationId()
      })
      await reload()
      const mode = result.reload_mode === 'service_restart'
        ? ' (đã phải restart dịch vụ — có gián đoạn I/O)'
        : ''
      setStatus(`Đã áp dụng revision ${result.revision}${mode}.`)
      return true
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Không áp dụng được cấu hình')
      await reload()
      return false
    } finally {
      setApplying(false)
    }
  }, [reload, state])

  const discard = useCallback(async () => {
    await apiClient.discardModbusCandidate()
    await reload()
    setStatus('Đã bỏ bản nháp.')
  }, [reload])

  const lifecycle: ModbusConfigLifecycle = applying ? 'APPLYING' : (state?.state ?? 'CLEAN')

  const value = useMemo<ModbusConfigContextValue>(() => ({
    draft, state, ports, loading, error, fieldErrors, lifecycle,
    locked: applying, setDraft, reload, save, apply, discard, status
  }), [apply, applying, discard, draft, error, fieldErrors, lifecycle, loading, ports,
    reload, save, setDraft, state, status])

  return <ModbusConfigContext.Provider value={value}>{children}</ModbusConfigContext.Provider>
}

export function useModbusConfig(): ModbusConfigContextValue {
  const context = useContext(ModbusConfigContext)
  if (!context) {
    throw new Error('useModbusConfig phải nằm trong <ModbusConfigProvider>')
  }
  return context
}
