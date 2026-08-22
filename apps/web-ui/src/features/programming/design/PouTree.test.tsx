import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import { PouTree, pouTreeItems } from './PouTree'
import type { ProgrammingDraftDocument } from '../model/types'

const DRAFT = {
  schemaVersion: 2,
  project: { projectId: '11111111-1111-4111-8111-111111111111', name: 'AHU', functionalTags: [] },
  objects: [
    { objectId: 'p1', kind: 'PROGRAM', name: 'AHU_MAIN', language: 'ST', source: '', locals: [] },
    { objectId: 'f1', kind: 'FUNCTION', name: 'SCALE_LIN', language: 'ST', source: '', locals: [] },
    { objectId: 'b1', kind: 'FUNCTION_BLOCK', name: 'FILTER_T1', language: 'FBD', source: '', locals: [] }
  ],
  programs: [{ programId: 'p1', objectId: 'p1', periodMs: 5000 }],
  signals: [],
  bindings: [],
  library: {},
  execution: { profileId: 'revA-1t-1-5-30', maxProgramsEnabled: 16 }
} as unknown as ProgrammingDraftDocument

function renderTree(selected?: string, onSelect = vi.fn()) {
  return render(
    <I18nProvider>
      <PouTree draft={DRAFT} selectedObjectId={selected} onSelect={onSelect} />
    </I18nProvider>
  )
}

beforeEach(() => localStorage.setItem('mkddc-lang', 'vi'))
afterEach(cleanup)

describe('PGM-02 cây POU', () => {
  it('gom đúng ba nhóm và đếm từng nhóm', () => {
    renderTree()
    expect(screen.getByRole('list', { name: 'Programs' })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Functions' })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Function Blocks' })).toBeInTheDocument()
    expect(screen.getByText(/Programs \(1\)/)).toBeInTheDocument()
    expect(screen.getByText(/Function Blocks \(1\)/)).toBeInTheDocument()
  })

  // Chu kỳ và trạng thái bật CHỈ tồn tại với PROGRAM. Hiện chúng cho FUNCTION —
  // kể cả dạng bị xám — vẫn nói rằng khái niệm đó tồn tại ở đây.
  it('ẩn chu kỳ và trạng thái bật với Function/Function Block', () => {
    renderTree('f1')
    expect(screen.queryByText(/Chu kỳ/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Trạng thái mong muốn/)).not.toBeInTheDocument()
    expect(screen.getByText(/chỉ chạy khi được Program gọi/)).toBeInTheDocument()
  })

  it('hiện chu kỳ và mặc định Tắt với Program', () => {
    renderTree('p1')
    expect(screen.getByText('5000 ms')).toBeInTheDocument()
    expect(screen.getByText(/Tắt \(mặc định cho Program mới\)/)).toBeInTheDocument()
  })

  it('chọn POU gọi đúng callback với objectId', () => {
    const onSelect = vi.fn()
    renderTree(undefined, onSelect)
    fireEvent.click(screen.getByRole('button', { name: /SCALE_LIN/ }))
    expect(onSelect).toHaveBeenCalledWith('f1')
  })

  it('không gán chu kỳ cho POU dùng chung', () => {
    const items = pouTreeItems(DRAFT)
    const shared = items.filter((item) => item.kind !== 'PROGRAM')
    expect(shared).toHaveLength(2)
    for (const item of shared) {
      expect(item.periodMs).toBeUndefined()
      expect(item.desiredEnabled).toBeUndefined()
    }
  })

  it('document v1 cho cây rỗng thay vì đoán', () => {
    const v1 = { schemaVersion: 1, project: DRAFT.project, programs: [], variables: [], bindings: [] } as unknown as ProgrammingDraftDocument
    expect(pouTreeItems(v1)).toEqual([])
  })
})
