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
