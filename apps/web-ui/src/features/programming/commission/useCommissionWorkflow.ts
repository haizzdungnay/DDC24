import { useCallback, useRef, useState } from 'react'
import { useProgrammingApiClient } from '../api/authClient'
import { ProgrammingApiError } from '../api/generated/client'
import type { ProgrammingImpactKey } from '../api/generated/client'
import { programmingErrorCopy } from '../api/errorCopy'
import { useI18n } from '../../../shared/i18n'
import { useAuth } from '../../auth'
import type { ProgrammingOperationView } from '../model/types'

export type CommissionWorkflowState =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | { phase: 'polling'; operationId: string }
  | { phase: 'unknown'; operationId: string }
  | { phase: 'terminal'; operation: ProgrammingOperationView }
  | { phase: 'error'; message: string }

interface SubmitArgs {
  revisionId: string
  expectedActiveRevisionId: string | null
  checkId: string
  impactRef: string
  acknowledgements: ProgrammingImpactKey[]
}

/**
 * `UJ-PROG-06` — Đưa vào vận hành. Idempotency key được tạo ĐÚNG MỘT LẦN khi
 * người dùng bấm xác nhận và giữ qua reload trong `sessionStorage` (khoá theo
 * revisionId) theo DDD-FE-PROG-001 §13 — timeout không bao giờ tạo key mới
 * hay POST lại; chỉ `GET /operations/{id}` được gọi lại.
 */
export function useCommissionWorkflow() {
  const client = useProgrammingApiClient()
  const { pick } = useI18n()
  const { session, login } = useAuth()
  const [state, setState] = useState<CommissionWorkflowState>({ phase: 'idle' })
  const pollTimer = useRef<number | undefined>(undefined)

  const idempotencyKeyFor = useCallback((revisionId: string): string => {
    const storageKey = `programming.commission.idempotency.${revisionId}`
    const existing = sessionStorage.getItem(storageKey)
    if (existing) return existing
    const created = crypto.randomUUID()
    sessionStorage.setItem(storageKey, created)
    return created
  }, [])

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
    async (args: SubmitArgs, reAuthPassword: string) => {
      window.clearTimeout(pollTimer.current)
      setState({ phase: 'submitting' })
      try {
        // Re-auth bắt buộc trước mọi mutation mạnh (DDD-SEC-PROG-001 §4) —
        // dùng lại `AuthProvider.login` thật (POST /api/v1/auth/login), không
        // tạo endpoint riêng. Thất bại thì KHÔNG được gửi Commission.
        try {
          await login(reAuthPassword, session?.username)
        } catch {
          setState({ phase: 'error', message: pick('Xác thực lại thất bại. Chưa gửi lệnh.', 'Re-authentication failed. Nothing was sent.') })
          return
        }
        const idempotencyKey = idempotencyKeyFor(args.revisionId)
        const accepted = await client.request<{ operationId: string; statusUrl: string; state: string; requestHash: string; acceptedAt: string; correlationId: string }>(
          'commissionProgrammingRevision',
          {
            body: {
              schemaVersion: '1.0',
              revisionId: args.revisionId,
              expectedActiveRevisionId: args.expectedActiveRevisionId,
              checkId: args.checkId,
              impactRef: args.impactRef,
              acknowledgements: args.acknowledgements,
              cutover: { requested: 'PROGRAM_ONLY' }
            },
            idempotencyKey,
            correlationId: crypto.randomUUID()
          }
        )
        setState({ phase: 'polling', operationId: accepted.operationId })
        pollOperation(accepted.operationId)
      } catch (reason) {
        setState({
          phase: 'error',
          message: reason instanceof ProgrammingApiError ? programmingErrorCopy(pick, reason.envelope.error.code) : pick('Không gửi được lệnh Đưa vào vận hành.', 'Could not submit the commission command.')
        })
      }
    },
    [client, idempotencyKeyFor, pollOperation, pick]
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
