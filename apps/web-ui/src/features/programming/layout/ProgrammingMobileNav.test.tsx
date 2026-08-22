import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import { ProgrammingMobileNav } from './ProgrammingMobileNav'

function renderNav(projectId: string | null, initialPath = '/eng/programming') {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <ProgrammingMobileNav projectId={projectId} />
      </MemoryRouter>
    </I18nProvider>
  )
}

beforeEach(() => localStorage.setItem('mkddc-lang', 'vi'))
afterEach(cleanup)

describe('ProgrammingMobileNav — T59-503', () => {
  it('có Project — hiển thị đủ sáu workspace bằng tên truy cập đầy đủ', () => {
    renderNav('project-1')
    expect(screen.getAllByRole('link')).toHaveLength(6)
    expect(screen.getByRole('link', { name: 'Chương trình' })).toHaveAttribute('href', '/eng/programming/projects/project-1/programs')
    expect(screen.getByRole('link', { name: 'Điểm & Ánh xạ' })).toHaveAttribute('href', '/eng/programming/projects/project-1/mapping')
    expect(screen.getByRole('link', { name: 'Thư viện điều khiển' })).toHaveAttribute('href', '/eng/programming/projects/project-1/library')
    expect(screen.getByRole('link', { name: 'Kiểm tra & Vận hành' })).toHaveAttribute('href', '/eng/programming/projects/project-1/commission')
    expect(screen.getByRole('link', { name: 'Runtime & Bảo trì' })).toHaveAttribute('href', '/eng/programming/runtime')
  })

  it('không có Project — không dựng deep-link giả cho PGM-02..05', () => {
    renderNav(null)
    expect(screen.getAllByRole('link')).toHaveLength(2)
    expect(screen.getByLabelText('Chương trình')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByLabelText('Điểm & Ánh xạ')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByLabelText('Thư viện điều khiển')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByLabelText('Kiểm tra & Vận hành')).toHaveAttribute('aria-disabled', 'true')
  })

  it('route Mapping được đánh dấu là trang hiện tại', () => {
    renderNav('project-1', '/eng/programming/projects/project-1/mapping')
    expect(screen.getByRole('link', { name: 'Điểm & Ánh xạ' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Chương trình' })).not.toHaveAttribute('aria-current')
  })
})
