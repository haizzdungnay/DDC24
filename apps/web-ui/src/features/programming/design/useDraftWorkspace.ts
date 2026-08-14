import { useCallback, useEffect, useRef, useState } from 'react'
import { useProgrammingApiClient } from '../api/authClient'
import { ProgrammingApiError } from '../api/generated/client'
import { programmingErrorCopy } from '../api/errorCopy'
import { useI18n } from '../../../shared/i18n'
import { createUuid } from '../../../shared/crypto'
import type { ProgrammingCheck, ProgrammingDraftDocument, ProgrammingDraftOperation, ProgrammingProject } from '../model/types'

// Contract HTTP dùng tên profile công khai có dấu gạch ngang. Chuỗi
// `MKDDC24_REVA` chỉ là định danh lưu trữ/bundle nội bộ; gửi nó vào API Check
// làm backend từ chối fail-closed bằng PRG-ERR-REQ-001.
const REV_A_TARGET_PROFILE = 'MK-DDC-24-REV-A'

interface MutationResponse<T = Record<string, unknown>> {
  resource: T
  etag: string
  auditId: string
  correlationId: string
}

interface DraftConflict {
  expected?: string
  actual?: string
}

/**
 * TASK-PROG-501 — Draft nằm ở cấp workspace (`DesignWorkspacePage`), không
 * trong tab: ba tab của PGM-02 gọi CHUNG hook này nên đổi tab không mất nội
 * dung đang gõ và không tự lưu (DDD-FE-PROG-001 §0.1 ràng buộc 2/3).
 *
 * `save()` gửi đúng một batch operations, cập nhật `document`/`etag` từ
 * chính response (đọc ngược server, không optimistic tự suy); `409` giữ
 * nguyên buffer đang gõ ở component gọi và chỉ set `conflict` để hiển thị
 * banner reload/merge (UX §9 hàng "409").
 */
export function useDraftWorkspace(projectId: string | undefined) {
  const client = useProgrammingApiClient()
  const { pick } = useI18n()
  const [project, setProject] = useState<ProgrammingProject | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState<DraftConflict | null>(null)
  const generation = useRef(0)

  const load = useCallback(() => {
    if (!projectId) return
    const myGeneration = ++generation.current
    setStatus('loading')
    client.request<ProgrammingProject>('getProgrammingProject', { path: { projectId } }).then(
      (value) => {
        if (myGeneration !== generation.current) return
        setProject(value)
        setError(null)
        setStatus('ready')
      },
      (reason: unknown) => {
        if (myGeneration !== generation.current) return
        setError(
          reason instanceof ProgrammingApiError
            ? programmingErrorCopy(pick, reason.envelope.error.code)
            : pick('Không tải được Project.', 'Could not load the project.')
        )
        setStatus('error')
      }
    )
  }, [client, projectId, pick])

  useEffect(() => {
    load()
  }, [load])

  const save = useCallback(
    async (operations: ProgrammingDraftOperation[]): Promise<boolean> => {
      if (!project?.draft || !projectId) return false
      setSaving(true)
      try {
        const response = await client.request<MutationResponse<{ projectId: string; draftRevisionId: string; content: ProgrammingDraftDocument }>>(
          'updateProgrammingDraft',
          {
            path: { projectId },
            body: { schemaVersion: '1.0', baseRevisionId: project.baseRevisionId, operations },
            ifMatch: project.etag,
            idempotencyKey: createUuid(),
            correlationId: createUuid()
          }
        )
        setProject((current) => (current ? { ...current, etag: response.etag, draft: response.resource.content } : current))
        setConflict(null)
        setError(null)
        return true
      } catch (reason) {
        if (reason instanceof ProgrammingApiError && reason.status === 409) {
          const args = reason.envelope.error.args as { expected?: string; actual?: string } | undefined
          setConflict({ expected: args?.expected, actual: args?.actual })
        } else {
          setError(
            reason instanceof ProgrammingApiError
              ? programmingErrorCopy(pick, reason.envelope.error.code)
              : pick('Không lưu được bản nháp.', 'Could not save the draft.')
          )
        }
        return false
      } finally {
        setSaving(false)
      }
    },
    [client, project, projectId, pick]
  )

  /* F-PROG-ASBUILT-002/D-07 plan: `createProgrammingRevision` (seal) trả ETag
   * mới và đổi `baseRevisionId` của chính Draft này, nhưng không đổi
   * `draft.content` — nên chỉ cần vá hai field, không cần reload cả Project.
   * Gọi ngay sau seal thành công (xem `useCheckWorkflow.runCheck`) để lần lưu
   * kế tiếp không dùng token cũ và bị 409. */
  const syncAfterSeal = useCallback((revisionId: string, etag: string) => {
    setProject((current) => (current ? { ...current, etag, baseRevisionId: revisionId } : current))
  }, [])

  return { status, project, error, saving, conflict, save, reload: load, dismissConflict: () => setConflict(null), syncAfterSeal }
}

export type CheckWorkflowState =
  | { phase: 'idle' }
  | { phase: 'sealing' }
  | { phase: 'checking'; checkId: string }
  | { phase: 'done'; check: ProgrammingCheck }
  | { phase: 'error'; message: string }

/**
 * `UJ-PROG-05` — Kiểm tra: niêm phong Draft thành Revision bất biến rồi tạo
 * Check job và poll tới trạng thái cuối. KHÔNG tự retry khi timeout — người
 * dùng phải chủ động bấm lại (UX §7/§18: `CHECKING → timeout → UNKNOWN`,
 * không tự động gửi lại mutation).
 */
export function useCheckWorkflow(projectId: string | undefined) {
  const client = useProgrammingApiClient()
  const { pick } = useI18n()
  const [state, setState] = useState<CheckWorkflowState>({ phase: 'idle' })
  const pollTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(pollTimer.current), [])

  const pollCheck = useCallback(
    (checkId: string) => {
      const poll = () => {
        client.request<ProgrammingCheck>('getProgrammingCheck', { path: { checkId } }).then(
          (check) => {
            if (check.state === 'QUEUED' || check.state === 'RUNNING') {
              pollTimer.current = window.setTimeout(poll, 1500)
              return
            }
            setState({ phase: 'done', check })
          },
          (reason: unknown) => {
            setState({
              phase: 'error',
              message: reason instanceof ProgrammingApiError ? programmingErrorCopy(pick, reason.envelope.error.code) : pick('Kiểm tra thất bại.', 'Check failed.')
            })
          }
        )
      }
      poll()
    },
    [client, pick]
  )

  const runCheck = useCallback(
    async (project: ProgrammingProject, onSealed?: (revisionId: string, etag: string) => void) => {
      if (!projectId) return
      setState({ phase: 'sealing' })
      try {
        const sealed = await client.request<MutationResponse<{ projectId: string; revisionId: string }>>('createProgrammingRevision', {
          path: { projectId },
          body: { schemaVersion: '1.0', baseRevisionId: project.baseRevisionId, label: new Date().toISOString(), comment: '' },
          ifMatch: project.etag,
          idempotencyKey: createUuid(),
          correlationId: createUuid()
        })
        const revisionId = sealed.resource.revisionId
        /* F-PROG-ASBUILT-002: seal đổi ETag/baseRevisionId của Draft — báo
         * ngay cho `useDraftWorkspace` (chủ sở hữu state Project) trước khi
         * tạo Check, không đợi tới khi Check xong mới đồng bộ. */
        onSealed?.(revisionId, sealed.etag)
        const accepted = await client.request<{ checkId: string; statusUrl: string; state: string; requestHash: string; acceptedAt: string; correlationId: string }>(
          'createProgrammingCheck',
          {
            path: { revisionId },
            body: { schemaVersion: '1.0', targetProfile: REV_A_TARGET_PROFILE },
            idempotencyKey: createUuid(),
            correlationId: createUuid()
          }
        )
        setState({ phase: 'checking', checkId: accepted.checkId })
        pollCheck(accepted.checkId)
      } catch (reason) {
        setState({
          phase: 'error',
          message: reason instanceof ProgrammingApiError ? programmingErrorCopy(pick, reason.envelope.error.code) : pick('Không tạo được Kiểm tra.', 'Could not start the check.')
        })
      }
    },
    [client, projectId, pollCheck, pick]
  )

  return { state, runCheck, reset: () => setState({ phase: 'idle' }) }
}
