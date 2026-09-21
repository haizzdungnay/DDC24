import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ProgrammingApiError } from '../api/generated/client'
import { useDraftWorkspace } from './useDraftWorkspace'

const client = vi.hoisted(() => ({ request: vi.fn() }))
/* `pick` và đối tượng trả về phải ỔN ĐỊNH qua từng render. Trả một hàm mới mỗi
 * lần sẽ đổi identity của `load` (nó phụ thuộc `pick`), khiến `useEffect` chạy
 * lại vô hạn và bộ đếm `generation` luôn vượt qua chính phản hồi vừa về — hook
 * kẹt mãi ở `loading`. Bẫy này thuộc về TEST, không phải về hook. */
const i18n = vi.hoisted(() => ({ pick: (viText: string) => viText }))
vi.mock('../api/authClient', () => ({ useProgrammingApiClient: () => client }))
vi.mock('../../../shared/i18n', () => ({ useI18n: () => i18n }))

/**
 * Hồi quy bo Foxlinx 2026-08-27 — `PATCH /draft` trả **400** trên thiết bị thật.
 *
 * Nguyên nhân: FE gửi batch `operations: []`. Hợp đồng đòi ít nhất một
 * operation (`application/projects.go`: `len(command.Operations) < 1` ⇒
 * `PRG-ERR-REQ-001`), nên một PATCH rỗng KHÔNG BAO GIỜ thành công được — nó chỉ
 * tốn một vòng mạng rồi trả lỗi, và người dùng nhận một thông báo lỗi cho việc
 * họ không hề làm sai.
 *
 * Đo trên bo: cùng `baseRevisionId` và cùng ETag, `operations:[]` → 400; một
 * operation thật → 409 (ETag đã dịch vì có người sửa song song), tức thân
 * request hợp lệ và đúng mảng rỗng bị từ chối.
 */

const project = {
  projectId: 'project-1',
  name: 'P',
  etag: '"etag:1"',
  baseRevisionId: '11111111-1111-4111-8111-111111111111',
  activeRevisionId: '22222222-2222-4222-8222-222222222222',
  dirty: false,
  draft: { schemaVersion: '1.0', programs: [], objects: [], task: { programOrder: [] } },
}

beforeEach(() => {
  client.request.mockReset()
  client.request.mockImplementation((operationId: string) => {
    if (operationId === 'getProgrammingProject') return Promise.resolve(project)
    return Promise.reject(new Error(`unexpected ${operationId}`))
  })
})
afterEach(() => vi.restoreAllMocks())

describe('save() — batch rỗng là không-việc-gì-cả, không phải một lần lưu', () => {
  it('operations rỗng ⇒ KHÔNG phát request nào', async () => {
    const { result } = renderHook(() => useDraftWorkspace('project-1'))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    const before = client.request.mock.calls.length

    let saved: boolean | undefined
    await act(async () => { saved = await result.current.save([]) })

    // Gửi đi sẽ nhận 400 và hiện lỗi cho một thao tác hợp lệ.
    expect(client.request.mock.calls.length).toBe(before)
    // `true` vì đúng là không còn gì chưa lưu — đường điều hướng sau khi lưu
    // được đi tiếp một cách chính đáng.
    expect(saved).toBe(true)
  })

  it('có operation thật ⇒ vẫn gửi đúng baseRevisionId và ETag', async () => {
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'updateProgrammingDraft') {
        return Promise.resolve({ etag: '"etag:2"', resource: { projectId: 'project-1', draftRevisionId: 'r2', content: project.draft } })
      }
      return Promise.reject(new Error(`unexpected ${operationId}`))
    })
    const { result } = renderHook(() => useDraftWorkspace('project-1'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    await act(async () => { await result.current.save([{ op: 'setFunctionalTags', tags: ['x'] }] as never) })

    const call = client.request.mock.calls.find(([id]) => id === 'updateProgrammingDraft')
    expect(call).toBeDefined()
    expect(call![1]).toMatchObject({
      body: { schemaVersion: '1.0', baseRevisionId: project.baseRevisionId },
      ifMatch: '"etag:1"',
    })
  })

  it('TC-FBD-CONFLICT-001: 409 ProgrammingApiError ⇒ setConflict đúng expected/actual, không throw và giữ trạng thái', async () => {
    client.request.mockImplementation((operationId: string) => {
      if (operationId === 'getProgrammingProject') return Promise.resolve(project)
      if (operationId === 'updateProgrammingDraft') {
        return Promise.reject(
          new ProgrammingApiError(409, {
            error: {
              code: 'PRG-ERR-CONFLICT-001',
              messageKey: 'programming.conflict.revision',
              retryable: false,
              keepsRunningRevision: true,
              correlationId: 'corr-1',
              args: { expected: '"etag:1"', actual: '"etag:2"' },
            },
          }),
        )
      }
      return Promise.reject(new Error(`unexpected ${operationId}`))
    })

    const { result } = renderHook(() => useDraftWorkspace('project-1'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    let saved: boolean | undefined
    await act(async () => {
      saved = await result.current.save([{ op: 'setFunctionalTags', tags: ['x'] }] as never)
    })

    expect(saved).toBe(false)
    expect(result.current.saving).toBe(false)
    expect(result.current.conflict).toEqual({ expected: '"etag:1"', actual: '"etag:2"' })
    expect(result.current.error).toBeNull()

    act(() => {
      result.current.dismissConflict()
    })
    expect(result.current.conflict).toBeNull()
  })
})
