import { useCallback, useRef, useState } from 'react'
import { useProgrammingApiClient } from '../api/authClient'
import { ProgrammingApiError } from '../api/generated/client'
import { programmingErrorCopy } from '../api/errorCopy'
import { useI18n } from '../../../shared/i18n'
import { useAuth } from '../../auth'
import { createUuid } from '../../../shared/crypto'
import type { ProgrammingOperationView } from '../model/types'

export type RestoreWorkflowState =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | { phase: 'polling'; operationId: string }
  | { phase: 'unknown'; operationId: string }
  | { phase: 'terminal'; operation: ProgrammingOperationView }
  | { phase: 'error'; message: string }

/**
 * `UJ-PROG-08` — Khôi phục. Dùng lại ĐÚNG cùng đường ống operation/reconcile
 * với Commission (`POST /operations/restore` → `GET /operations/{id}` poll),
 * cùng re-auth và cùng nguyên tắc "không tự POST lại khi timeout"
 * (UX-WEB-PROG-001 §17 hàng "Restore").
 */
export function useRestoreWorkflow() {
  const client = useProgrammingApiClient()
  const { pick } = useI18n()
  const { session, login } = useAuth()
  const [state, setState] = useState<RestoreWorkflowState>({ phase: 'idle' })
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
    async (targetRevisionId: string, expectedActiveRevisionId: string | null, reason: string, reAuthPassword: string) => {
      window.clearTimeout(pollTimer.current)
      setState({ phase: 'submitting' })
      try {
        try {
          await login(reAuthPassword, session?.username)
        } catch {
          setState({ phase: 'error', message: pick('Xác thực lại thất bại. Chưa gửi lệnh.', 'Re-authentication failed. Nothing was sent.') })
          return
        }
        const storageKey = `programming.restore.idempotency.${targetRevisionId}`
        let idempotencyKey = sessionStorage.getItem(storageKey)
        if (!idempotencyKey) {
          idempotencyKey = createUuid()
          sessionStorage.setItem(storageKey, idempotencyKey)
        }
        const accepted = await client.request<{ operationId: string }>('restoreProgrammingRevision', {
          body: { schemaVersion: '1.0', revisionId: targetRevisionId, expectedActiveRevisionId, reason },
          idempotencyKey,
          correlationId: createUuid()
        })
        setState({ phase: 'polling', operationId: accepted.operationId })
        pollOperation(accepted.operationId)
      } catch (reason_) {
        setState({
          phase: 'error',
          message: reason_ instanceof ProgrammingApiError ? programmingErrorCopy(pick, reason_.envelope.error.code) : pick('Không gửi được lệnh Khôi phục.', 'Could not submit the restore command.')
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
