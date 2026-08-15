import { useCallback, useRef, useState } from 'react'
import { useProgrammingApiClient } from '../api/authClient'
import { ProgrammingApiError } from '../api/generated/client'
import { programmingErrorCopy } from '../api/errorCopy'
import { useI18n } from '../../../shared/i18n'
import { useAuth } from '../../auth'
import { createUuid } from '../../../shared/crypto'
import type { ProgrammingOperationView } from '../model/types'

export type RetainResetWorkflowState =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | { phase: 'polling'; operationId: string }
  | { phase: 'unknown'; operationId: string }
  | { phase: 'terminal'; operation: ProgrammingOperationView }
  | { phase: 'error'; message: string }

/**
 * WP-12 (RETAIN Reset, DDD-RETAIN-RESET-PROG-001). Cùng đường ống
 * operation/reconcile với Restore (`POST /retain/reset` → `GET
 * /operations/{id}` poll), cùng re-auth và cùng nguyên tắc "không tự POST
 * lại khi timeout/UNKNOWN" (§7 "không giả định thành công khi timeout") —
 * `unknown` chỉ được xoá qua `recheckStatus` (đọc lại), không tự retry POST.
 */
export function useRetainResetWorkflow() {
  const client = useProgrammingApiClient()
  const { pick } = useI18n()
  const { session, login } = useAuth()
  const [state, setState] = useState<RetainResetWorkflowState>({ phase: 'idle' })
  const pollTimer = useRef<number | undefined>(undefined)

  const pollOperation = useCallback(
    (operationId: string) => {
      const poll = () => {
        client.request<ProgrammingOperationView>('getProgrammingOperation', { path: { operationId } }).then(
          (operation) => {
            if (operation.state === 'SUCCEEDED' || operation.state === 'REJECTED' || operation.state === 'FAILED') {
              setState({ phase: 'terminal', operation })
              return
            }
            if (operation.state === 'UNKNOWN_RECONCILING') {
              setState({ phase: 'unknown', operationId })
              return
            }
            pollTimer.current = window.setTimeout(poll, 1500)
          },
          () => setState({ phase: 'unknown', operationId })
        )
      }
      poll()
    },
    [client]
  )

  const submit = useCallback(
    async (expectedActiveRevisionId: string, reason: string, reAuthPassword: string) => {
      window.clearTimeout(pollTimer.current)
      setState({ phase: 'submitting' })
      try {
        try {
          await login(reAuthPassword, session?.username)
        } catch {
          setState({ phase: 'error', message: pick('Xác thực lại thất bại. Chưa gửi lệnh.', 'Re-authentication failed. Nothing was sent.') })
          return
        }
        const storageKey = `programming.retainReset.idempotency.${expectedActiveRevisionId}`
        let idempotencyKey = sessionStorage.getItem(storageKey)
        if (!idempotencyKey) {
          idempotencyKey = createUuid()
          sessionStorage.setItem(storageKey, idempotencyKey)
        }
        const accepted = await client.request<{ operationId: string }>('resetProgrammingRetain', {
          body: { schemaVersion: '1.0', expectedActiveRevisionId, reason },
          idempotencyKey,
          correlationId: createUuid()
        })
        setState({ phase: 'polling', operationId: accepted.operationId })
        pollOperation(accepted.operationId)
      } catch (reason_) {
        setState({
          phase: 'error',
          message:
            reason_ instanceof ProgrammingApiError
              ? programmingErrorCopy(pick, reason_.envelope.error.code)
              : pick('Không gửi được lệnh Đặt lại RETAIN.', 'Could not submit the RETAIN reset command.')
        })
      }
    },
    [client, login, session?.username, pollOperation, pick]
  )

  const recheckStatus = useCallback(
    (operationId: string) => {
      setState({ phase: 'polling', operationId })
      pollOperation(operationId)
    },
    [pollOperation]
  )

  return { state, submit, recheckStatus, reset: () => setState({ phase: 'idle' }) }
}
