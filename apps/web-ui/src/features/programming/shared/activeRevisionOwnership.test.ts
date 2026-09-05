import { describe, expect, it } from 'vitest'
import {
  activeRevisionOwnership,
  ownedActiveRevisionId,
  runningProject,
  type ActiveRevisionOwnershipInput
} from './activeRevisionOwnership'

/**
 * `ISS-PGUI-01` — hợp đồng của MỘT câu trả lời duy nhất cho câu hỏi "gói đang
 * chạy thuộc Project nào".
 *
 * Ba bề mặt (Overview, Layout, Context strip) từng tự trả lời, và trên
 * production chúng trả ba câu khác nhau về cùng một thiết bị (`PC-001`,
 * `PC-002`, `PM-011`). File này khoá luật ở đúng chỗ ba câu ấy tách nhau:
 * `items[0]`, `runtime.activeRevisionId !== null`, và "không biết ⇒ coi như
 * của mình".
 */

const ACTIVE = 'rev-active'
const OTHER = 'rev-other'

function input(overrides: Partial<ActiveRevisionOwnershipInput> = {}): ActiveRevisionOwnershipInput {
  return {
    runtimeStatus: 'ready',
    projectsStatus: 'ready',
    producerState: 'READY',
    runtimeActiveRevisionId: ACTIVE,
    projects: [
      { projectId: 'p-first', name: 'AHU-MASTER-SEQUENCE', activeRevisionId: OTHER },
      { projectId: 'p-running', name: 'SOAK-10P-20260824-172521', activeRevisionId: ACTIVE }
    ],
    subjectProjectId: 'p-running',
    ...overrides
  }
}

describe('activeRevisionOwnership', () => {
  it('gói đang chạy thuộc ĐÚNG Project đang xét ⇒ owned', () => {
    expect(activeRevisionOwnership(input())).toEqual({ kind: 'owned', projectId: 'p-running' })
  })

  /* Đây là hình dạng chính xác của lỗi production: Project đứng đầu danh sách
     KHÔNG phải Project đang chạy. Kết luận `owned` ở đây là cách màn hình nói
     `Active: Yes` cho một gói của Project khác. */
  it('Project đang xét đứng đầu danh sách nhưng KHÔNG chạy gói ⇒ foreign kèm tên chủ thật', () => {
    expect(activeRevisionOwnership(input({ subjectProjectId: 'p-first' }))).toEqual({
      kind: 'foreign',
      ownerProjectId: 'p-running',
      ownerName: 'SOAK-10P-20260824-172521'
    })
  })

  it('không Project nào khai gói đang chạy ⇒ unresolved, KHÔNG rơi về Project đầu', () => {
    expect(activeRevisionOwnership(input({ runtimeActiveRevisionId: 'rev-nobody' })))
      .toEqual({ kind: 'unresolved' })
  })

  it('chưa chọn Project nào thì không được kết luận owned', () => {
    expect(activeRevisionOwnership(input({ subjectProjectId: null })).kind).toBe('foreign')
  })

  it('runtime chưa đọc xong ⇒ loading, không phải "chưa vận hành"', () => {
    expect(activeRevisionOwnership(input({ runtimeStatus: 'loading' }))).toEqual({ kind: 'loading' })
    expect(activeRevisionOwnership(input({ projectsStatus: 'loading' }))).toEqual({ kind: 'loading' })
  })

  /* `UNAVAILABLE` là "chưa đọc được", không phải "không có". Gộp nó vào
     `not-commissioned` là biến một lỗ hổng quan sát thành một khẳng định. */
  it('runtime lỗi hoặc producerState=UNAVAILABLE ⇒ unavailable', () => {
    expect(activeRevisionOwnership(input({ runtimeStatus: 'error' }))).toEqual({ kind: 'unavailable' })
    expect(activeRevisionOwnership(input({ producerState: 'UNAVAILABLE' }))).toEqual({ kind: 'unavailable' })
  })

  it('thiết bị chưa Commission ⇒ not-commissioned', () => {
    expect(activeRevisionOwnership(input({ runtimeActiveRevisionId: null }))).toEqual({ kind: 'not-commissioned' })
  })

  it('tên Project rỗng ⇒ ownerName là null chứ không phải chuỗi rỗng', () => {
    const ownership = activeRevisionOwnership(input({
      subjectProjectId: 'p-first',
      projects: [
        { projectId: 'p-first', name: 'AHU', activeRevisionId: OTHER },
        { projectId: 'p-running', name: '', activeRevisionId: ACTIVE }
      ]
    }))
    expect(ownership).toEqual({ kind: 'foreign', ownerProjectId: 'p-running', ownerName: null })
  })
})

describe('runningProject', () => {
  const projects = [
    { projectId: 'p-first', name: 'A', activeRevisionId: OTHER },
    { projectId: 'p-running', name: 'B', activeRevisionId: ACTIVE }
  ]

  it('phân giải theo quan hệ dữ liệu, KHÔNG theo thứ tự danh sách', () => {
    expect(runningProject(projects, ACTIVE)?.projectId).toBe('p-running')
  })

  it('không phân giải được ⇒ null, không rơi về items[0]', () => {
    expect(runningProject(projects, 'rev-nobody')).toBeNull()
    expect(runningProject(projects, null)).toBeNull()
    expect(runningProject(undefined, ACTIVE)).toBeNull()
  })
})

describe('ownedActiveRevisionId', () => {
  /* Cổng duy nhất cho phép so sánh Draft↔Active. Mọi kind khác `owned` phải ra
     `null`: một cặp Revision chưa chứng minh cùng Project là một request
     backend BẮT BUỘC từ chối (`400 PRG-ERR-REQ-001`, `retryable=false`). */
  it('chỉ owned mới nhả id ra ngoài', () => {
    expect(ownedActiveRevisionId({ kind: 'owned', projectId: 'p' }, ACTIVE)).toBe(ACTIVE)
    expect(ownedActiveRevisionId({ kind: 'foreign', ownerProjectId: 'p', ownerName: null }, ACTIVE)).toBeNull()
    expect(ownedActiveRevisionId({ kind: 'unresolved' }, ACTIVE)).toBeNull()
    expect(ownedActiveRevisionId({ kind: 'unavailable' }, ACTIVE)).toBeNull()
    expect(ownedActiveRevisionId({ kind: 'loading' }, ACTIVE)).toBeNull()
    expect(ownedActiveRevisionId({ kind: 'not-commissioned' }, ACTIVE)).toBeNull()
  })
})
