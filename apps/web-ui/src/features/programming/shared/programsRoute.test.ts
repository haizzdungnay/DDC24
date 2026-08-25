import { describe, expect, it } from 'vitest'
import type { ProgrammingProject } from '../model/types'
import {
  canonicalProgramsPath,
  isProgramsWorkspaceMode,
  programsWorkspacePath,
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
})
