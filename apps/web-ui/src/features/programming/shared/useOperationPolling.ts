import { useCallback, useEffect, useRef, useState } from 'react'
import { useProgrammingApiClient } from '../api/authClient'
import type { ProgrammingOperationView } from '../model/types'

const POLL_INTERVAL_MS = 1500
const FALLBACK_BUDGET_MS = 90_000

export type OperationPollingState =
  | { phase: 'idle' }
  | { phase: 'polling'; operationId: string }
  | { phase: 'unknown'; operationId: string }
  | { phase: 'terminal'; operation: ProgrammingOperationView }

interface OperationRecoveryHint {
  operationId: string
  deadlineAt: number
}

function isTerminal(state: string): boolean {
  return state === 'SUCCEEDED' || state === 'FAILED' || state === 'ROLLED_BACK'
}

function isPollingState(state: string): boolean {
  return state === 'QUEUED' || state === 'PREFLIGHT' || state === 'STAGING' || state === 'APPLYING' || state === 'VERIFYING'
}

export function operationPollBudget(taskPeriodsMs: readonly number[] | undefined): number {
  const largestPeriod = Math.max(0, ...(taskPeriodsMs ?? []).filter((period) => Number.isFinite(period) && period > 0))
  return Math.max(FALLBACK_BUDGET_MS, largestPeriod * 2 + 30_000)
}

/**
 * Poll tuần tự một operation bền vững. Chỉ operation ID (không có secret) được
 * lưu cho recovery sau reload; mọi recovery đều GET-only.
 */
export function useOperationPolling({ recoveryKey, budgetMs }: { recoveryKey: string; budgetMs: number }) {
  const client = useProgrammingApiClient()
  const [state, setState] = useState<OperationPollingState>({ phase: 'idle' })
  const timerRef = useRef<number | undefined>(undefined)
  const generationRef = useRef(0)
  const inFlightRef = useRef(false)
  const recoveredRef = useRef(false)

  const invalidate = useCallback(() => {
    generationRef.current += 1
    inFlightRef.current = false
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current)
    timerRef.current = undefined
  }, [])

  const clearRecovery = useCallback(() => sessionStorage.removeItem(recoveryKey), [recoveryKey])

  const start = useCallback((operationId: string, recoveredDeadlineAt?: number) => {
    if (!operationId) return
    // Re-check trong khi GET cũ chưa trả lời không được tạo request thứ hai.
    if (inFlightRef.current) return
    invalidate()
    const generation = generationRef.current
    const deadlineAt = recoveredDeadlineAt ?? Date.now() + budgetMs
    writeRecoveryHint(recoveryKey, { operationId, deadlineAt })
    setState({ phase: 'polling', operationId })

    const poll = () => {
      if (generation !== generationRef.current || inFlightRef.current) return
      if (Date.now() >= deadlineAt) {
        setState({ phase: 'unknown', operationId })
        return
      }
      inFlightRef.current = true
      client.request<ProgrammingOperationView>('getProgrammingOperation', { path: { operationId } }).then(
        (operation) => {
          if (generation !== generationRef.current) return
          const remoteState: string = operation.state
          if (isTerminal(remoteState)) {
            clearRecovery()
            setState({ phase: 'terminal', operation })
            return
          }
          if (!isPollingState(remoteState)) {
            setState({ phase: 'unknown', operationId })
            return
          }
          if (Date.now() >= deadlineAt) {
            setState({ phase: 'unknown', operationId })
            return
          }
          timerRef.current = window.setTimeout(poll, POLL_INTERVAL_MS)
        },
        () => {
          if (generation === generationRef.current) setState({ phase: 'unknown', operationId })
        }
      ).finally(() => {
        if (generation === generationRef.current) inFlightRef.current = false
      })
    }
    poll()
  }, [budgetMs, clearRecovery, client, invalidate, recoveryKey])

  useEffect(() => {
    if (recoveredRef.current) return
    recoveredRef.current = true
    const hint = readRecoveryHint(recoveryKey, budgetMs)
    if (hint) start(hint.operationId, hint.deadlineAt)
  }, [budgetMs, recoveryKey, start])

  useEffect(() => invalidate, [invalidate])

  const reset = useCallback(() => {
    invalidate()
    clearRecovery()
    setState({ phase: 'idle' })
  }, [clearRecovery, invalidate])

  return { state, start, reset, invalidate }
}

function writeRecoveryHint(key: string, hint: OperationRecoveryHint) {
  sessionStorage.setItem(key, JSON.stringify(hint))
}

function readRecoveryHint(key: string, budgetMs: number): OperationRecoveryHint | null {
  const raw = sessionStorage.getItem(key)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<OperationRecoveryHint>
    if (typeof parsed.operationId === 'string' && parsed.operationId.length > 0 && typeof parsed.deadlineAt === 'number' && Number.isFinite(parsed.deadlineAt)) {
      return { operationId: parsed.operationId, deadlineAt: parsed.deadlineAt }
    }
  } catch {
    // Tương thích hint cũ chỉ chứa operationId; lần đọc này vẫn chỉ GET.
    if (raw.length > 0) return { operationId: raw, deadlineAt: Date.now() + budgetMs }
  }
  sessionStorage.removeItem(key)
  return null
}
