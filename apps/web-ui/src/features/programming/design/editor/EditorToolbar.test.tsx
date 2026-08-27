import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '../../../../shared/i18n'
import { SourceEditor } from './ProgramsTab'
import type { ProgrammingProgram } from '../../model/types'

/**
 * `T59-821` / `TC-PGM02-TB-01` — toolbar EDIT.
 *
 * Hai điều được khoá: (1) `Check`/`Compare` có mặt đúng MỘT lần trên hàng công
 * cụ; (2) nút khoá **nêu lý do đọc được**. Một nút xám không giải thích buộc
 * người dùng thử đi thử lại rồi tự dựng một lời giải thích sai — thường là
 * "chắc hỏng rồi".
 *
 * `SIMULATE`/`LIVE` cố ý KHÔNG có mặt: chúng là mode switch ở
 * `ProgramsModeSwitcher`, và nhân bản thành nút toolbar sẽ tạo hai đường đổi
 * mode cho một trạng thái của toàn workspace.
 */

const SOURCE = 'PROGRAM Main\nVAR\n  Fan : BOOL;\nEND_VAR\nEND_PROGRAM'

function program(): ProgrammingProgram {
  return { programId: 'program-1', name: 'AHU', kind: 'PROGRAM', language: 'ST', document: SOURCE }
}

function renderToolbar(overrides: Partial<Parameters<typeof SourceEditor>[0]> = {}) {
  render(
    <I18nProvider>
      <SourceEditor
        program={program()}
        source={SOURCE}
        canEdit
        saving={false}
        diagnostics={[]}
        focusDiagnostic={null}
        onChange={vi.fn()}
        onSave={vi.fn().mockResolvedValue(true)}
        pointCatalogStatus="idle"
        pointCatalogItems={[]}
        pointCatalogError={null}
        onEnsurePointCatalogLoaded={vi.fn()}
        onRunCheck={vi.fn()}
        onOpenCompare={vi.fn()}
        {...overrides}
      />
    </I18nProvider>,
  )
}

beforeEach(() => { localStorage.setItem('mkddc-lang', 'vi') })
afterEach(cleanup)

describe('toolbar EDIT — đúng tập nút, không rò nút mode khác', () => {
  it('hàng công cụ có đủ Find/Undo/Redo/Insert/Library/Format/Save + Check/Compare/More', () => {
    renderToolbar()
    for (const name of ['Tìm', 'Chèn Point/Variable', 'Thư viện', 'Định dạng', 'Lưu', 'Kiểm tra', 'So sánh']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.getByTestId('st-toolbar-more')).toBeInTheDocument()
  })

  it('mỗi hành động đúng MỘT nút — không hai nút cho cùng một việc', () => {
    renderToolbar()
    expect(screen.getAllByRole('button', { name: 'Kiểm tra' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'So sánh' })).toHaveLength(1)
  })

  it('KHÔNG rò nút đổi mode vào toolbar', () => {
    renderToolbar()
    expect(screen.queryByRole('button', { name: 'SIMULATE' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'LIVE' })).toBeNull()
  })
})

describe('nút khoá phải nêu lý do đọc được', () => {
  it('Kiểm tra khoá vì Draft bẩn ⇒ lý do nằm ngay trên nút', () => {
    renderToolbar({
      checkDisabledReason: 'Lưu bản nháp trước khi Kiểm tra — Kiểm tra chạy trên Revision đã niêm phong.',
    })
    const check = screen.getByRole('button', { name: 'Kiểm tra' })
    expect(check).toBeDisabled()
    expect(check).toHaveAttribute('title', expect.stringContaining('Lưu bản nháp trước'))
  })

  it('không có đường mở So sánh ⇒ nút vẫn HIỆN và khoá, không ẩn im lặng', () => {
    renderToolbar({ onOpenCompare: undefined })
    const compare = screen.getByRole('button', { name: 'So sánh' })
    // Ẩn đi sẽ làm người dùng tưởng tính năng không tồn tại thay vì biết nó
    // chưa dùng được ở ngữ cảnh này.
    expect(compare).toBeInTheDocument()
    expect(compare).toBeDisabled()
  })

  it('Lưu khoá khi không có gì để lưu, và nói đúng lý do đó', () => {
    renderToolbar()
    const save = screen.getByRole('button', { name: 'Lưu' })
    expect(save).toBeDisabled()
    expect(save).toHaveAttribute('title', 'Không có thay đổi để lưu')
  })
})

describe('vai chỉ đọc', () => {
  it('không sửa được thì các nút mutation biến khỏi hàng, Tìm vẫn còn', () => {
    renderToolbar({ canEdit: false })
    expect(screen.getByRole('button', { name: 'Tìm' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Lưu' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Định dạng' })).toBeNull()
  })
})
