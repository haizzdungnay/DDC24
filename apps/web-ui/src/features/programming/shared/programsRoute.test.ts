import { describe, expect, it } from 'vitest'
import type { ProgrammingProject } from '../model/types'
import {
  canonicalProgramsPath,
  isProgramsWorkspaceMode,
  programsWorkspacePath,
  programsUrlsEquivalent,
  resolveProgramsProject
} from './programsRoute'

function project(projectId: string): ProgrammingProject {
  return {
    projectId,
    name: projectId,
    etag: '"1"',
    activeRevisionId: null,
    draftRevisionId: `draft-${projectId}`,
    baseRevisionId: `base-${projectId}`,
    updatedAt: '2026-08-24T00:00:00Z',
    dirty: false,
    draftSequence: 1,
    activeSequence: null
  }
}

describe('PGM-02 v2 — URL canonical và rollback', () => {
  it('dựng canonical project/pou/mode và encode định danh', () => {
    expect(canonicalProgramsPath('project A', { pou: 'pou/1', mode: 'LIVE' }))
      .toBe('/eng/programming/programs?project=project+A&pou=pou%2F1&mode=LIVE')
  })

  it('legacy redirect chỉ giữ allowlist/hash và đổi program thành pou khi pou vắng', () => {
    expect(canonicalProgramsPath('project-1', {
      search: '?program=object-1&line=12&column=4&evil=drop&project=attacker',
      hash: '#source-error'
    })).toBe('/eng/programming/programs?project=project-1&pou=object-1&mode=EDIT&program=object-1&line=12&column=4#source-error')
  })

  it('pou hiện diện (kể cả rỗng) thắng alias program để resolver fail closed', () => {
    const target = canonicalProgramsPath('project-1', { search: '?pou=&program=legacy-id&mode=SIMULATE' })
    expect(target).toContain('pou=')
    expect(target).toContain('program=legacy-id')
    expect(target).toContain('mode=SIMULATE')
  })

  /* `tab` là tham số quá độ của R1: `/projects/:id/task` là lối vào cũ trỏ
     thẳng vào tab Thực thi, và cả hai nhánh cờ đều phải giữ nó. Bỏ sót thì lối
     vào cũ im lặng rơi về tab Chương trình — hỏng đích chứ không báo lỗi. */
  it('giữ tab qua canonical và qua route cũ khi cờ tắt', () => {
    expect(canonicalProgramsPath('project-1', { search: '?tab=execution' }))
      .toBe('/eng/programming/programs?project=project-1&mode=EDIT&tab=execution')
    expect(programsWorkspacePath('project-1', { search: '?tab=execution' }, false))
      .toBe('/eng/programming/projects/project-1/programs?tab=execution')
  })

  it('flag tắt quay về route cũ nhưng vẫn giữ deep-link POU an toàn', () => {
    expect(programsWorkspacePath('project-1', { pou: 'object-1', search: '?line=7' }, false))
      .toBe('/eng/programming/projects/project-1/programs?program=object-1&line=7')
  })

  it.each([
    ['EDIT', true],
    ['LIVE', true],
    ['SIMULATE', true],
    ['edit', false],
    ['UNKNOWN', false],
    [null, false]
  ])('mode %s hợp lệ = %s', (mode, expected) => {
    expect(isProgramsWorkspaceMode(mode)).toBe(expected)
  })
})

describe('PGM-02 v2 — Project resolver fail closed', () => {
  const projects = [project('p1'), project('p2')]

  it('phân biệt loading/error/0/1/nhiều Project', () => {
    expect(resolveProgramsProject('loading', [], null)).toEqual({ kind: 'LOADING' })
    expect(resolveProgramsProject('error', [], null)).toEqual({ kind: 'ERROR' })
    expect(resolveProgramsProject('ready', [], null)).toEqual({ kind: 'EMPTY' })
    expect(resolveProgramsProject('ready', [projects[0]], null)).toEqual({ kind: 'CANONICALIZE', projectId: 'p1' })
    expect(resolveProgramsProject('ready', projects, null)).toEqual({ kind: 'CHOOSE' })
  })

  it('Project query hợp lệ trả đúng record; invalid không fallback sang item đầu', () => {
    expect(resolveProgramsProject('ready', projects, 'p2')).toEqual({ kind: 'READY', project: projects[1] })
    expect(resolveProgramsProject('ready', projects, 'missing')).toEqual({ kind: 'NOT_FOUND' })
    expect(resolveProgramsProject('ready', projects, '')).toEqual({ kind: 'NOT_FOUND' })
  })

  /**
   * Làm mới nền KHÔNG được tháo bề mặt đang mở. `status === 'loading'` mang hai
   * nghĩa — "chưa có gì" và "đang làm mới thứ đang hiện" — và trả `LOADING` cho
   * cả hai khiến route đổi nhánh render, React tháo toàn bộ workspace rồi dựng
   * lại: mất focus bàn phím, mất vị trí cuộn, mất luôn phím gõ trong khoảng đó
   * (đo được ở `TC-FBD-NAV-001`).
   */
  it('đang làm mới danh sách thì giữ nguyên Project đang mở, không tháo workspace', () => {
    expect(resolveProgramsProject('loading', projects, 'p2')).toEqual({ kind: 'READY', project: projects[1] })
  })

  it('đang làm mới thì KHÔNG kết luận NOT_FOUND hay điều hướng theo danh sách cũ', () => {
    // Project vừa tạo có thể chưa vào danh sách — bản cũ không đủ tư cách phủ nhận.
    expect(resolveProgramsProject('loading', projects, 'missing')).toEqual({ kind: 'LOADING' })
    // Không có `?project=`: mọi nhánh còn lại đều điều hướng, nên phải chờ.
    expect(resolveProgramsProject('loading', [projects[0]], null)).toEqual({ kind: 'LOADING' })
    expect(resolveProgramsProject('loading', projects, null)).toEqual({ kind: 'LOADING' })
  })
})

/**
 * Route canonical so URL hiện tại với bản dựng lại để chặn deep-link rác. So
 * bằng `===` biến THỨ TỰ query thành một khác biệt, và mỗi khác biệt là một
 * `<Navigate>` — tức tháo cả workspace rồi dựng lại, mất focus và mất phím
 * đang gõ. Phép so phải theo nghĩa, nhưng KHÔNG được nới tới mức bỏ sót tham
 * số lạ (đó mới là việc của nó).
 */
describe('programsUrlsEquivalent', () => {
  const canonical = '/eng/programming/programs?project=p1&pou=u1&mode=EDIT'

  it('khác thứ tự query là CÙNG một địa chỉ', () => {
    expect(programsUrlsEquivalent('/eng/programming/programs?project=p1&mode=EDIT&pou=u1', canonical)).toBe(true)
  })

  it('thừa/thiếu/khác giá trị vẫn là địa chỉ KHÁC', () => {
    expect(programsUrlsEquivalent('/eng/programming/programs?project=p1&pou=u1&mode=EDIT&junk=1', canonical)).toBe(false)
    expect(programsUrlsEquivalent('/eng/programming/programs?project=p1&mode=EDIT', canonical)).toBe(false)
    expect(programsUrlsEquivalent('/eng/programming/programs?project=p1&pou=u2&mode=EDIT', canonical)).toBe(false)
    expect(programsUrlsEquivalent('/eng/programming/projects/p1/programs?project=p1&pou=u1&mode=EDIT', canonical)).toBe(false)
  })

  it('hash và key lặp đều được tính', () => {
    expect(programsUrlsEquivalent(`${canonical}#top`, canonical)).toBe(false)
    expect(programsUrlsEquivalent(`${canonical}&line=1&line=2`, `${canonical}&line=2&line=1`)).toBe(true)
    expect(programsUrlsEquivalent(`${canonical}&line=1&line=1`, `${canonical}&line=1`)).toBe(false)
  })
})
