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
  /** Entry PROJECT khác mà entry này gọi tới. Server chỉ nhận UUID, và chính
   *  mảng này là thứ chặn xoá một entry còn bị phụ thuộc. */
  dependencies?: { entryId: string; version: string }[]
  /* `T61-401` — metadata TRÌNH BÀY. Bỏ hẳn field khi người dùng để trống, chứ
     KHÔNG gửi chuỗi rỗng: upsert ghi đè toàn phần, nên chuỗi rỗng được lưu
     thành "đã điền, nội dung rỗng" và khối sẽ hiện như đã phân loại vào một
     nhóm không tên thay vì hiện `—`. Sửa hai trường này không đổi
     `contentSha256` (`D61-09`). */
  category?: string
  description?: string
  /* `T61-401` — thẻ. Đã có trong hợp đồng ghi từ `T61-101` nhưng thiếu ở kiểu
     của FE, nên không đường nào gửi được: mọi khối PROJECT vĩnh viễn không có
     thẻ. Máy chủ CHUẨN HOÁ (trim, hạ chữ thường, khử trùng lặp, sắp tăng dần)
     trước khi lưu, nên read-back khác payload về hình thức mà không khác nội
     dung. Bỏ hẳn field khi không có thẻ nào — mảng rỗng và "chưa gắn thẻ" là
     cùng một câu. */
  tags?: string[]
}

/**
 * `T61-401` — kết quả của bước Check (dry run) trong wizard PROJECT Library.
 *
 * `blocking` do MÁY CHỦ tính, không suy lại từ mảng ở FE: một client đọc mảng
 * rỗng thành "sạch" nhưng quên xét `severity` sẽ cho Lưu đúng lúc không được
 * phép. `diagnostics` luôn là mảng — mảng rỗng nghĩa là "đã kiểm, sạch".
 */
export interface LibraryEntryDiagnostic {
  field: string
  code: string
  message: string
  severity: 'BLOCKING' | 'WARNING'
}

export interface LibraryEntryCheckResult {
  blocking: boolean
  diagnostics: LibraryEntryDiagnostic[]
  /** Draft library SẼ nhận thay đổi. `null` nghĩa là Project chưa mở Draft
   *  library nào và lần ghi đầu tiên sẽ tự mở. */
  libraryRevisionId: string | null
  libraryVersion: string | null
}

/** `resource` mà server trả sau mỗi mutation library. `libraryRevisionId` là
 *  bản DRAFT vừa được ghi vào — nó là bằng chứng "version nào đang nhận thay
 *  đổi", và giao diện phải đọc lại theo nó chứ không đoán. */
export interface LibraryEntryMutationResult {
  etag: string
  libraryRevisionId: string | null
  auditId: string
}

/** Kết quả authoritative của chuyển trạng thái cả PROJECT Library revision.
 * Không suy `DEPRECATED` từ HTTP 200: caller chỉ được báo thành công khi
 * resource trả đúng revision và đúng state, sau đó còn phải GET read-back. */
export interface LibraryRevisionDeprecationResult {
  etag: string
  libraryRevisionId: string
  libraryVersion: string
  libraryState: 'DEPRECATED'
  auditId: string
}

/**
 * `POST|DELETE /projects/{id}/library/entries` — PGM-04. Cả hai đều bắt buộc
 * `If-Match` (ETag Draft) và idempotency key mới mỗi lần bấm.
 *
 * Hook trả về ETag MỚI sau mỗi mutation: mutation library đi chung lane
 * concurrency với tài liệu Draft, nên giữ lại ETag cũ sẽ làm thao tác kế tiếp
 * bị 409 mà người dùng không hiểu vì sao.
 *
 * `conflict` tách khỏi `error` vì hai thứ này đòi hai hành động khác nhau: lỗi
 * thường thì thử lại được, còn 409 thì phải TẢI LẠI rồi quyết định — bấm lại
 * với cùng ETag cũ sẽ 409 mãi mãi.
 */
export function useProgrammingLibraryEntryMutations(projectId: string | undefined) {
  const client = useProgrammingApiClient()
  const { pick } = useI18n()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<string | null>(null)
  /* Cờ RIÊNG cho bước Check. Dùng chung `pending`/`error` với đường ghi sẽ làm
     một lần kiểm hỏng hiện ra như một lần lưu hỏng, và người dùng đi tìm bản
     ghi vừa tạo. */
  const [checkPending, setCheckPending] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)

  const describe = useCallback(
    (reason: unknown, fallback: string): { conflict: boolean; message: string } => {
      if (reason instanceof ProgrammingApiError) {
        return {
          conflict: reason.status === 409 || reason.status === 412 || reason.status === 428,
          message: programmingErrorCopy(pick, reason.envelope.error.code)
        }
      }
      return { conflict: false, message: fallback }
    },
    [pick]
  )

  const reset = useCallback(() => {
    setError(null)
    setConflict(null)
    setCheckError(null)
  }, [])

  const saveEntry = useCallback(
    async (etag: string, draft: LibraryEntryDraft): Promise<LibraryEntryMutationResult | null> => {
      if (!projectId) return null
      setPending(true)
      setError(null)
      setConflict(null)
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
        return {
          etag: response.etag,
          libraryRevisionId:
            typeof response.resource?.libraryRevisionId === 'string' ? response.resource.libraryRevisionId : null,
          auditId: response.auditId
        }
      } catch (reason) {
        const described = describe(reason, pick('Không lưu được entry Control Library.', 'Could not save the Control Library entry.'))
        if (described.conflict) setConflict(described.message)
        else setError(described.message)
        return null
      } finally {
        setPending(false)
      }
    },
    [client, describe, pick, projectId]
  )

  const deleteEntry = useCallback(
    async (etag: string, entryId: string): Promise<LibraryEntryMutationResult | null> => {
      if (!projectId) return null
      setPending(true)
      setError(null)
      setConflict(null)
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
        return {
          etag: response.etag,
          libraryRevisionId:
            typeof response.resource?.libraryRevisionId === 'string' ? response.resource.libraryRevisionId : null,
          auditId: response.auditId
        }
      } catch (reason) {
        const described = describe(reason, pick('Không xoá được entry Control Library.', 'Could not delete the Control Library entry.'))
        if (described.conflict) setConflict(described.message)
        else setError(described.message)
        return null
      } finally {
        setPending(false)
      }
    },
    [client, describe, pick, projectId]
  )

  /**
   * `T61-401` — bước Check: gửi ĐÚNG payload của Lưu, không kèm `If-Match` và
   * không kèm khoá idempotency.
   *
   * Không dùng chung `pending` với đường ghi: nút "Kiểm tra" và nút "Lưu" ở hai
   * bước khác nhau, và để chung một cờ thì một lần kiểm đang chạy sẽ khoá luôn
   * nút Lưu của bước sau — hoặc ngược lại, một lần lưu đang chạy làm nút Kiểm
   * tra sáng lên như thể còn bấm được.
   *
   * Trả `null` khi hỏng: gọi được máy chủ hay không là một chuyện, còn "sạch"
   * hay "chặn" là một chuyện khác. Quy lỗi mạng về `blocking: false` sẽ mở đường
   * Lưu đúng lúc chưa ai kiểm gì.
   */
  const checkEntry = useCallback(
    async (draft: LibraryEntryDraft): Promise<LibraryEntryCheckResult | null> => {
      if (!projectId) return null
      setCheckPending(true)
      setCheckError(null)
      try {
        const response = await client.request<{
          blocking?: unknown
          diagnostics?: unknown
          libraryRevisionId?: unknown
          libraryVersion?: unknown
        }>('checkProgrammingLibraryEntry', {
          path: { projectId },
          body: { schemaVersion: '1.0', ...draft },
          correlationId: createUuid()
        })
        const diagnostics: LibraryEntryDiagnostic[] = Array.isArray(response.diagnostics)
          ? response.diagnostics.flatMap((item) => {
              if (typeof item !== 'object' || item === null) return []
              const record = item as Record<string, unknown>
              if (typeof record.field !== 'string' || typeof record.code !== 'string' ||
                  typeof record.message !== 'string') return []
              return [{
                field: record.field, code: record.code, message: record.message,
                /* Mức lạ được coi là CHẶN, không phải cảnh báo. Một mức thứ ba
                   mà client chưa biết thì fail-closed là câu trả lời duy nhất
                   không thể sai theo hướng cho lưu nhầm. */
                severity: record.severity === 'WARNING' ? 'WARNING' : 'BLOCKING'
              }]
            })
          : []
        return {
          blocking: response.blocking === true || diagnostics.some((item) => item.severity === 'BLOCKING'),
          diagnostics,
          libraryRevisionId: typeof response.libraryRevisionId === 'string' ? response.libraryRevisionId : null,
          libraryVersion: typeof response.libraryVersion === 'string' ? response.libraryVersion : null
        }
      } catch (reason) {
        setCheckError(describe(reason, pick(
          'Không chạy được bước kiểm tra trên máy chủ.',
          'Could not run the server-side check.'
        )).message)
        return null
      } finally {
        setCheckPending(false)
      }
    },
    [client, describe, pick, projectId]
  )

  const deprecateRevision = useCallback(
    async (etag: string, libraryRevisionId: string): Promise<LibraryRevisionDeprecationResult | null> => {
      if (!projectId) return null
      setPending(true)
      setError(null)
      setConflict(null)
      try {
        const response = await client.request<MutationResponse<Record<string, unknown>>>(
          'deprecateProgrammingLibraryRevision',
          {
            path: { projectId, libraryRevisionId },
            body: { schemaVersion: '1.0' },
            ifMatch: etag,
            idempotencyKey: createUuid(),
            correlationId: createUuid()
          }
        )
        const resourceRevisionId = response.resource?.libraryRevisionId
        const libraryVersion = response.resource?.libraryVersion
        const libraryState = response.resource?.libraryState
        if (
          resourceRevisionId !== libraryRevisionId ||
          typeof libraryVersion !== 'string' ||
          libraryVersion.length === 0 ||
          libraryState !== 'DEPRECATED'
        ) {
          setError(
            pick(
              'Máy chủ không xác nhận đúng bản thư viện đã ngừng sử dụng.',
              'The server did not confirm the library revision that was deprecated.'
            )
          )
          return null
        }
        return {
          etag: response.etag,
          libraryRevisionId: resourceRevisionId,
          libraryVersion,
          libraryState,
          auditId: response.auditId
        }
      } catch (reason) {
        const described = describe(
          reason,
          pick(
            'Không đánh dấu được phiên bản Thư viện điều khiển là DEPRECATED.',
            'Could not mark the Control Library version as DEPRECATED.'
          )
        )
        if (described.conflict) setConflict(described.message)
        else setError(described.message)
        return null
      } finally {
        setPending(false)
      }
    },
    [client, describe, pick, projectId]
  )

  return { saveEntry, checkEntry, deleteEntry, deprecateRevision, pending, error, conflict, checkPending, checkError, reset }
}
