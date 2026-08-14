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
  it('không có projectId — Overview/Runtime là link thật, Design/Check bị vô hiệu, không dựng deep-link giả', () => {
    renderNav(null)
    expect(screen.getByRole('link', { name: 'Tổng quan' })).toHaveAttribute('href', '/eng/programming')
    expect(screen.getByRole('link', { name: 'Runtime' })).toHaveAttribute('href', '/eng/programming/runtime')
    expect(screen.queryByRole('link', { name: 'Thiết kế' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Kiểm tra' })).not.toBeInTheDocument()
    const disabledDesign = screen.getByText('Thiết kế')
    expect(disabledDesign.closest('span')).toHaveAttribute('aria-disabled', 'true')
  })

  it('có projectId — cả bốn mục đều là link thật, đúng route Design/Check của project đó', () => {
    renderNav('project-1')
    expect(screen.getByRole('link', { name: 'Thiết kế' })).toHaveAttribute('href', '/eng/programming/projects/project-1/design')
    expect(screen.getByRole('link', { name: 'Kiểm tra' })).toHaveAttribute('href', '/eng/programming/projects/project-1/commission')
  })

  it('mục đang mở đúng route được đánh dấu active (aria-current)', () => {
    renderNav('project-1', '/eng/programming/projects/project-1/design')
    expect(screen.getByRole('link', { name: 'Thiết kế' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Tổng quan' })).not.toHaveAttribute('aria-current')
  })
})
