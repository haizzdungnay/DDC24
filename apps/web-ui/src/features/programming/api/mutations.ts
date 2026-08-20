import { useCallback, useState } from 'react'
import { useProgrammingApiClient } from './authClient'
import { ProgrammingApiError } from './generated/client'
import { programmingErrorCopy } from './errorCopy'
import { useI18n } from '../../../shared/i18n'
import { createUuid } from '../../../shared/crypto'
import type { ProgrammingProject } from '../model/types'

interface MutationResponse<T> {
  resource: T
  etag: string
  auditId: string
  correlationId: string
}

/**
 * `POST /projects` — Rev A chỉ cho đúng một Project/controller
 * (`capabilities.limits.projectsPerController = 1`); đây là hành động
 * "Tạo bản nháp" ở trạng thái `NO_PROJECT` của PGM-01 (UX §16.1.5). Idempotency
 * key mới mỗi lần bấm — đây không phải một thao tác lặp lại tự động.
 */
export function useCreateProgrammingProject() {
  const client = useProgrammingApiClient()
  const { pick } = useI18n()
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createProject = useCallback(
    async (name: string): Promise<ProgrammingProject | null> => {
      setCreating(true)
      setError(null)
      try {
        const response = await client.request<MutationResponse<ProgrammingProject>>('createProgrammingProject', {
          body: { schemaVersion: '1.0', name },
          idempotencyKey: createUuid(),
          correlationId: createUuid()
        })
        return response.resource
      } catch (reason) {
        setError(
          reason instanceof ProgrammingApiError
            ? programmingErrorCopy(pick, reason.envelope.error.code)
            : pick('Không tạo được Project.', 'Could not create the project.')
        )
        return null
      } finally {
        setCreating(false)
      }
    },
    [client, pick]
  )

  return { createProject, creating, error }
}

export interface LibraryEntryDraft {
  entryId: string
  kind: 'FUNCTION' | 'FUNCTION_BLOCK'
  name: string
  language: 'ST' | 'FBD'
  source: string
  interface: unknown
}

/**
 * `POST|DELETE /projects/{id}/library/entries` — PGM-04. Cả hai đều bắt buộc
 * `If-Match` (ETag Draft) và idempotency key mới mỗi lần bấm.
 *
 * Hook trả về ETag MỚI sau mỗi mutation: mutation library đi chung lane
 * concurrency với tài liệu Draft, nên giữ lại ETag cũ sẽ làm thao tác kế tiếp
 * bị 409 mà người dùng không hiểu vì sao.
 */
export function useProgrammingLibraryEntryMutations(projectId: string | undefined) {
  const client = useProgrammingApiClient()
  const { pick } = useI18n()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const describe = useCallback(
    (reason: unknown, fallback: string) =>
      reason instanceof ProgrammingApiError ? programmingErrorCopy(pick, reason.envelope.error.code) : fallback,
    [pick]
  )

  const saveEntry = useCallback(
    async (etag: string, draft: LibraryEntryDraft): Promise<string | null> => {
      if (!projectId) return null
      setPending(true)
      setError(null)
      try {
        const response = await client.request<MutationResponse<Record<string, unknown>>>(
          'upsertProgrammingLibraryEntry',
          {
            path: { projectId },
            body: { schemaVersion: '1.0', ...draft },
            ifMatch: etag,
            idempotencyKey: createUuid(),
            correlationId: createUuid()
          }
        )
        return response.etag
      } catch (reason) {
        setError(describe(reason, pick('Không lưu được entry Control Library.', 'Could not save the Control Library entry.')))
        return null
      } finally {
        setPending(false)
      }
    },
    [client, describe, pick, projectId]
  )

  const deleteEntry = useCallback(
    async (etag: string, entryId: string): Promise<string | null> => {
      if (!projectId) return null
      setPending(true)
      setError(null)
      try {
        const response = await client.request<MutationResponse<Record<string, unknown>>>(
          'deleteProgrammingLibraryEntry',
          {
            path: { projectId, entryId },
            ifMatch: etag,
            idempotencyKey: createUuid(),
            correlationId: createUuid()
          }
        )
        return response.etag
      } catch (reason) {
        setError(describe(reason, pick('Không xoá được entry Control Library.', 'Could not delete the Control Library entry.')))
        return null
      } finally {
        setPending(false)
      }
    },
    [client, describe, pick, projectId]
  )

  return { saveEntry, deleteEntry, pending, error }
}

