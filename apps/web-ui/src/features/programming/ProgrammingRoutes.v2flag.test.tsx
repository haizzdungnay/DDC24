import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `T59-802` — kiểm nhánh CÓ cut-over.
 *
 * `PROGRAMS_WORKSPACE_V2_ENABLED` là hằng build-time (`import.meta.env`), nên
 * hành vi khi cờ BẬT không thể quan sát trong test mặc định. File này mock
 * module config sang bật rồi kiểm đúng phần dễ hỏng nhất của cut-over: lối vào
 * cũ nào đi tới canonical, lối vào nào KHÔNG được đi tới đó, và deep-link tab
 * nào phải sống sót. Bản đầu của lát này cho cả `/design` vào redirect Programs
 * nên `?tab=mapping` bị nuốt sang workspace Chương trình — cổng e2e bắt được,
 * còn unit test thì không, vì không có test nào chạy ở trạng thái cờ bật.
 */
vi.mock('../../shared/config', async () => {
  const actual = await vi.importActual<typeof import('../../shared/config')>('../../shared/config')
  return { ...actual, PROGRAMS_WORKSPACE_V2_ENABLED: true }
})

const { LegacyDesignRedirect, LegacyProgramsRedirect, LegacyTabRedirect } = await import('./shared/LegacyTabRedirect')

const PROJECT = '11111111-1111-4111-8111-111111111111'

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</div>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/eng/programming/projects/:projectId/design" element={<LegacyDesignRedirect />} />
        <Route path="/eng/programming/projects/:projectId/programs" element={<LegacyProgramsRedirect />} />
        <Route path="/eng/programming/projects/:projectId/task" element={<LegacyTabRedirect tab="execution" />} />
        <Route path="/eng/programming/projects/:projectId/mapping" element={<LocationProbe />} />
        <Route path="/eng/programming/programs" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => localStorage.setItem('mkddc-lang', 'vi'))
afterEach(cleanup)

describe('T59-802 — cut-over BẬT: lối vào cũ đi đúng workspace', () => {
  it('/programs và /design không tab đều tới canonical Programs', () => {
    renderAt(`/eng/programming/projects/${PROJECT}/programs`)
    expect(screen.getByTestId('location')).toHaveTextContent(`/eng/programming/programs?project=${PROJECT}&mode=EDIT`)
    cleanup()
    renderAt(`/eng/programming/projects/${PROJECT}/design`)
    expect(screen.getByTestId('location')).toHaveTextContent(`/eng/programming/programs?project=${PROJECT}&mode=EDIT`)
  })

  it('/design?tab=mapping vẫn tới workspace Ánh xạ, KHÔNG bị kéo sang Programs', () => {
    renderAt(`/eng/programming/projects/${PROJECT}/design?tab=mapping&program=object-1`)
    const location = screen.getByTestId('location').textContent ?? ''
    expect(location).toContain(`/eng/programming/projects/${PROJECT}/mapping`)
    expect(location).toContain('program=object-1')
    expect(location).not.toContain('/eng/programming/programs')
  })

  it('/task giữ tab execution qua hai chặng redirect', () => {
    renderAt(`/eng/programming/projects/${PROJECT}/task?program=object-1`)
    const location = screen.getByTestId('location').textContent ?? ''
    expect(location).toContain('/eng/programming/programs')
    expect(location).toContain(`project=${PROJECT}`)
    expect(location).toContain('tab=execution')
    expect(location).toContain('pou=object-1')
  })

  it('/design?tab=execution giữ hash chẩn đoán khi sang canonical', () => {
    renderAt(`/eng/programming/projects/${PROJECT}/design?tab=execution&line=8#diagnostic`)
    const location = screen.getByTestId('location').textContent ?? ''
    expect(location).toContain('tab=execution')
    expect(location).toContain('line=8')
    expect(location).toContain('#diagnostic')
  })
})
