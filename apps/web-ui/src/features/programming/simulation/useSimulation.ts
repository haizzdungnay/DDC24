import { useCallback, useEffect, useRef, useState } from 'react'
import { useProgrammingApiClient } from '../api/authClient'
import { ProgrammingApiError } from '../api/generated/client'
import { programmingErrorCopy } from '../api/errorCopy'
import { useI18n } from '../../../shared/i18n'
import { createUuid } from '../../../shared/crypto'
import {
  acceptDenial,
  acceptFrame,
  acceptSession,
  currentSession,
  encodeSimulationInput,
  initialSimulationSlice,
  isTerminalState,
  type SimulationAction,
  type SimulationFrame,
  type SimulationInputDescriptor,
  type SimulationSessionView,
  type SimulationSlice,
} from './simulationSession'

/**
 * `T59-815` / `PGM02-V22-WP-08` — vòng đời một phiên SIMULATE ở phía client.
 *
 * Ba luật của hook này, và cả ba đều nhằm vào cùng một kiểu lỗi: giao diện nói
 * một điều mà thiết bị không làm.
 *
 * 1. **Mọi trạng thái đến từ read-back.** Không có nhánh nào đặt trạng thái
 *    theo lệnh vừa gửi. Bấm Chạy chỉ bật cờ `pending` để khoá nút; chữ "đang
 *    chạy" chỉ xuất hiện khi server trả về `RUNNING`.
 * 2. **Không retry mù.** Một lệnh quá hạn KHÔNG được gửi lại với khoá
 *    idempotency mới — làm vậy có thể áp cùng một thay đổi hai lần. Thay vào
 *    đó phiên đi vào `RECONCILING` và hook đọc lại bằng `GET`.
 * 3. **Không trộn nguồn.** Hook này chỉ đọc endpoint của phiên mô phỏng. Nó
 *    không bao giờ chạm monitor runtime của LIVE, kể cả khi hai bên có cùng
 *    hình dạng dữ liệu.
 */

const OBSERVATION_POLL_MS = 1000

export interface SimulationController {
  slice: SimulationSlice
  session: SimulationSessionView | null
  inputs: SimulationInputDescriptor[]
  start: (input: {
    controllerId: string
    projectId: string
    sourceDraftRevisionId: string
    sourceContentSha256: string
  }) => Promise<void>
  act: (action: SimulationAction, speed?: number) => Promise<void>
  setInput: (descriptor: SimulationInputDescriptor, raw: string) => Promise<void>
  stop: () => Promise<void>
  stopActive: () => Promise<void>
  loadActive: () => Promise<void>
  /** Đọc lại phiên bằng `GET` — lối ra khỏi trạng thái không xác định. */
  reconcile: () => Promise<void>
}

export function useSimulation(): SimulationController {
  const client = useProgrammingApiClient()
  const { pick } = useI18n()
  const [slice, setSlice] = useState<SimulationSlice>(initialSimulationSlice)
  const sliceRef = useRef(slice)
  sliceRef.current = slice

  /* Mọi request đang bay bị huỷ khi component unmount hoặc khi phiên đổi. Phản
   * hồi tới sau đó nói về một ngữ cảnh đã không còn, và reducer tuy có chặn
   * theo sequence nhưng huỷ ở đây rẻ hơn và không phụ thuộc vào việc server có
   * gửi đủ metadata hay không. */
  const abortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  const describe = useCallback(
    (reason: unknown, fallbackVi: string, fallbackEn: string) => {
      if (reason instanceof ProgrammingApiError) {
        return {
          code: reason.envelope.error.code as string,
          message: programmingErrorCopy(pick, reason.envelope.error.code),
        }
      }
      return { code: null, message: pick(fallbackVi, fallbackEn) }
    },
    [pick],
  )

  const nextSignal = useCallback(() => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    return controller.signal
  }, [])

  const start = useCallback<SimulationController['start']>(
    async (input) => {
      setSlice((current) => ({ ...current, status: { kind: 'STARTING' }, pending: 'CREATE', lastDenial: null }))
      try {
        const session = await client.request<SimulationSessionView>('createProgrammingSimulationSession', {
          body: { schemaVersion: '1.0', ...input },
          idempotencyKey: createUuid(),
          correlationId: createUuid(),
          signal: nextSignal(),
        })
        if (!mountedRef.current) return
        setSlice((current) => acceptSession({ ...current, status: { kind: 'IDLE' }, frame: null }, session))
      } catch (reason) {
        if (!mountedRef.current) return
        const described = describe(reason, 'Không mở được phiên mô phỏng.', 'Could not start the simulation session.')
        setSlice((current) => ({
          ...current,
          pending: null,
          status: { kind: 'ERROR', code: described.code, message: described.message, session: null },
        }))
      }
    },
    [client, describe, nextSignal],
  )

  const reconcile = useCallback<SimulationController['reconcile']>(async () => {
    const session = currentSession(sliceRef.current)
    if (!session) return
    try {
      const readBack = await client.request<SimulationSessionView>('getProgrammingSimulationSession', {
        path: { sessionId: session.sessionId },
        correlationId: createUuid(),
      })
      if (!mountedRef.current) return
      setSlice((current) => acceptSession(current, readBack))
    } catch {
      /* Đọc lại thất bại KHÔNG được đổi trạng thái phiên: mất mạng một nhịp
       * không phải bằng chứng phiên đã chết. Người dùng vẫn thấy trạng thái
       * cuối cùng server xác nhận, kèm cảnh báo từ nhánh gọi. */
    }
  }, [client])

  const act = useCallback<SimulationController['act']>(
    async (action, speed) => {
      const session = currentSession(sliceRef.current)
      if (!session) return
      setSlice((current) => ({ ...current, pending: action, lastDenial: null }))
      try {
        const body: Record<string, unknown> = { schemaVersion: '1.0', action }
        if (action === 'SET_SPEED' && typeof speed === 'number') body.speed = speed
        const readBack = await client.request<SimulationSessionView>('actProgrammingSimulationSession', {
          path: { sessionId: session.sessionId },
          body,
          ifMatch: session.etag,
          idempotencyKey: createUuid(),
          correlationId: createUuid(),
        })
        if (!mountedRef.current) return
        setSlice((current) => acceptSession(current, readBack))
        if (action === 'STEP_CYCLE' || action === 'RESET') {
          try {
            const frame = await client.request<SimulationFrame>('listProgrammingSimulationObservations', {
              path: { sessionId: session.sessionId },
              correlationId: createUuid(),
            })
            if (mountedRef.current) {
              setSlice((current) => acceptFrame(current, frame))
            }
          } catch {
            /* ignore */
          }
        }
      } catch (reason) {
        if (!mountedRef.current) return
        const described = describe(reason, 'Lệnh mô phỏng không thực hiện được.', 'The simulation command failed.')
        setSlice((current) => acceptDenial(current, described))
        /* Trượt ETag hoặc quá hạn ⇒ trạng thái thật có thể đã khác. Đọc lại
         * bằng GET thay vì gửi lại lệnh: gửi lại là áp cùng một thay đổi lần
         * thứ hai. */
        await reconcile()
      }
    },
    [client, describe, reconcile],
  )

  const setInput = useCallback<SimulationController['setInput']>(
    async (descriptor, raw) => {
      const session = currentSession(sliceRef.current)
      if (!session) return
      setSlice((current) => ({ ...current, pending: 'SET_INPUT', lastDenial: null }))
      try {
        const readBack = await client.request<SimulationSessionView>('setProgrammingSimulationInput', {
          path: { sessionId: session.sessionId, observationId: descriptor.observationId },
          body: {
            schemaVersion: '1.0',
            dataType: descriptor.dataType,
            value: encodeSimulationInput(descriptor, raw),
          },
          ifMatch: session.etag,
          idempotencyKey: createUuid(),
          correlationId: createUuid(),
        })
        if (!mountedRef.current) return
        setSlice((current) => acceptSession(current, readBack))
      } catch (reason) {
        if (!mountedRef.current) return
        const described = describe(reason, 'Không ghi được giá trị mô phỏng.', 'Could not write the simulation value.')
        setSlice((current) => acceptDenial(current, described))
      }
    },
    [client, describe],
  )

  const loadActive = useCallback<SimulationController['loadActive']>(async () => {
    try {
      const active = await client.request<SimulationSessionView>('getProgrammingSimulationSession', {
        path: { sessionId: 'active' },
        correlationId: createUuid(),
      })
      if (!mountedRef.current) return
      if (active && !isTerminalState(active.state)) {
        setSlice((current) => acceptSession({ ...current, status: { kind: 'IDLE' }, frame: null }, active))
      }
    } catch {
      /* no live session */
    }
  }, [client])

  useEffect(() => {
    void loadActive()
  }, [loadActive])

  const stopActive = useCallback<SimulationController['stopActive']>(async () => {
    setSlice((current) => ({ ...current, pending: 'STOP', lastDenial: null }))
    try {
      await client.request<SimulationSessionView>('stopProgrammingSimulationSession', {
        path: { sessionId: 'active' },
        ifMatch: '*',
        idempotencyKey: createUuid(),
        correlationId: createUuid(),
      })
      if (!mountedRef.current) return
      setSlice(initialSimulationSlice)
    } catch (reason) {
      if (!mountedRef.current) return
      const described = describe(reason, 'Kh\u00f4ng d\u1eebng \u0111\u01b0\u1ee3c phi\u00ean m\u00f4 ph\u1ecfng.', 'Could not stop the simulation session.')
      setSlice((current) => acceptDenial(current, described))
    }
  }, [client, describe])

  const stop = useCallback<SimulationController['stop']>(async () => {
    const session = currentSession(sliceRef.current)
    if (!session) {
      setSlice(initialSimulationSlice)
      return
    }
    setSlice((current) => ({ ...current, pending: 'STOP', lastDenial: null }))
    try {
      await client.request<SimulationSessionView>('stopProgrammingSimulationSession', {
        path: { sessionId: session.sessionId },
        ifMatch: '*',
        idempotencyKey: createUuid(),
        correlationId: createUuid(),
      })
      if (!mountedRef.current) return
      setSlice(initialSimulationSlice)
    } catch {
      if (!mountedRef.current) return
      setSlice(initialSimulationSlice)
    }
  }, [client])

  /* Vòng đọc quan sát. Chỉ chạy khi phiên còn nhận lệnh; phiên terminal không
   * sinh thêm mẫu nào và poll tiếp chỉ tạo tải cùng một câu trả lời. */
  const session = currentSession(slice)
  const sessionId = session?.sessionId ?? null
  const live = session !== null && !isTerminalState(session.state)

  useEffect(() => {
    if (!live || sessionId === null) return
    let cancelled = false
    const controller = new AbortController()

    async function poll() {
      try {
        const frame = await client.request<SimulationFrame>('listProgrammingSimulationObservations', {
          path: { sessionId: sessionId as string },
          correlationId: createUuid(),
          signal: controller.signal,
        })
        if (cancelled || !mountedRef.current) return
        setSlice((current) => acceptFrame(current, frame))
      } catch {
        /* Một nhịp đọc hỏng không đổi trạng thái phiên và không xoá mẫu đang
         * có: mẫu cũ vẫn mang đúng `snapshotSequence` của nó, còn xoá đi sẽ
         * làm màn hình nhấp nháy giữa "có số" và "chưa có mẫu". */
      }
      /* Đọc lại phiên cùng nhịp để bắt tiến độ của vòng chạy tự động và các
       * chuyển trạng thái không do người dùng gây ra (hết hạn, worker chết). */
      if (!cancelled) await reconcile()
    }

    void poll()
    const timer = window.setInterval(() => { void poll() }, OBSERVATION_POLL_MS)
    return () => {
      cancelled = true
      controller.abort()
      window.clearInterval(timer)
    }
  }, [client, live, reconcile, sessionId])

  return {
    slice,
    session,
    inputs: session?.simulationInputs ?? [],
    start,
    act,
    setInput,
    stop,
    reconcile,
    stopActive,
    loadActive,
  }
}
