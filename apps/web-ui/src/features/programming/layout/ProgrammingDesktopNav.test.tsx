import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import { ProgrammingDesktopNav } from './ProgrammingDesktopNav'

function renderNav(projectId: string | null, initialPath = '/eng/programming') {
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <ProgrammingDesktopNav projectId={projectId} />
      </MemoryRouter>
    </I18nProvider>
  )
}

beforeEach(() => localStorage.setItem('mkddc-lang', 'vi'))
afterEach(cleanup)

describe('ProgrammingDesktopNav (D-04)', () => {
  it('không có projectId — PGM-01/06 là link thật, bốn workspace theo Project bị vô hiệu', () => {
    renderNav(null)
    expect(screen.getByRole('link', { name: 'Tổng quan' })).toHaveAttribute('href', '/eng/programming')
    expect(screen.getByRole('link', { name: 'Runtime & Bảo trì' })).toHaveAttribute('href', '/eng/programming/runtime')
    expect(screen.queryByRole('link', { name: 'Chương trình' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Điểm & Ánh xạ' })).not.toBeInTheDocument()
    expect(screen.getByText('Chương trình').closest('span')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText('Thư viện điều khiển').closest('span')).toHaveAttribute('aria-disabled', 'true')
  })

  it('có projectId — cả sáu mục là link thật và trỏ đúng route PGM-01..06', () => {
    renderNav('project-1')
    expect(screen.getAllByRole('link')).toHaveLength(6)
    expect(screen.getByRole('link', { name: 'Chương trình' })).toHaveAttribute('href', '/eng/programming/projects/project-1/programs')
    expect(screen.getByRole('link', { name: 'Điểm & Ánh xạ' })).toHaveAttribute('href', '/eng/programming/projects/project-1/mapping')
    expect(screen.getByRole('link', { name: 'Thư viện điều khiển' })).toHaveAttribute('href', '/eng/programming/projects/project-1/library')
    expect(screen.getByRole('link', { name: 'Kiểm tra & Vận hành' })).toHaveAttribute('href', '/eng/programming/projects/project-1/commission')
  })

  it('mục đang mở đúng route được đánh dấu active (aria-current)', () => {
    renderNav('project-1', '/eng/programming/projects/project-1/programs')
    expect(screen.getByRole('link', { name: 'Chương trình' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Tổng quan' })).not.toHaveAttribute('aria-current')
  })
})
