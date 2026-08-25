import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PROGRAMMING_LEGACY_PROGRAMS_PATH, PROGRAMMING_WORKSPACE_PATHS } from './ProgrammingRoutes'
import { LegacyDesignRedirect, LegacyProgramsRedirect, LegacyTabRedirect } from './shared/LegacyTabRedirect'

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname + location.search + location.hash}</output>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/eng/programming/projects/:projectId/design" element={<LegacyDesignRedirect />} />
        <Route path="/eng/programming/projects/:projectId/task" element={<LegacyTabRedirect tab="execution" />} />
        <Route path="/eng/programming/projects/:projectId/programs" element={<LocationProbe />} />
        <Route path="/eng/programming/projects/:projectId/mapping" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  )
}

/**
 * `LegacyProgramsRedirect` là thành phần KHÔNG phụ thuộc cờ: nó luôn dựng URL
 * canonical. Nhánh phụ thuộc cờ (`/design`, `/task`) được kiểm ở
 * `ProgrammingRoutes.v2flag.test.tsx`, nơi module config bị mock sang bật.
 */
function renderV2RedirectAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/eng/programming/projects/:projectId/programs" element={<LegacyProgramsRedirect />} />
        <Route path="/eng/programming/programs" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => localStorage.setItem('mkddc-lang', 'vi'))
afterEach(cleanup)

const PROJECT = '11111111-1111-4111-8111-111111111111'

describe('T59-503 — IA sáu workspace: route đích và lối vào cũ', () => {
  it('khai báo đúng sáu route canonical PGM-01..06', () => {
    expect(PROGRAMMING_WORKSPACE_PATHS).toEqual({
      overview: '',
      programs: 'programs',
      mapping: 'projects/:projectId/mapping',
      library: 'projects/:projectId/library',
      commission: 'projects/:projectId/commission',
      runtime: 'runtime'
    })
    expect(PROGRAMMING_LEGACY_PROGRAMS_PATH).toBe('projects/:projectId/programs')
  })

  // `/design` không còn là route đích. Deep-link cũ phải mở ĐÚNG trang tương
  // ứng, nếu không mọi link trong tài liệu/báo lỗi cũ đều dẫn tới trang trống.
  it('lối vào cũ /design chuyển sang /programs theo mặc định', () => {
    renderAt(`/eng/programming/projects/${PROJECT}/design`)
    expect(screen.getByTestId('location')).toHaveTextContent(`/eng/programming/projects/${PROJECT}/programs`)
  })

  it('lối vào cũ /design?tab=mapping chuyển sang /mapping', () => {
    renderAt(`/eng/programming/projects/${PROJECT}/design?tab=mapping`)
    expect(screen.getByTestId('location')).toHaveTextContent(`/eng/programming/projects/${PROJECT}/mapping`)
  })

  // Query khác `tab` phải được giữ: một link báo lỗi cũ mang theo
  // `program/line/column` và mất chúng nghĩa là mất luôn vị trí lỗi.
  it('giữ nguyên query định vị lỗi khi chuyển hướng', () => {
    renderAt(`/eng/programming/projects/${PROJECT}/design?program=p1&line=12&column=4`)
    const location = screen.getByTestId('location').textContent ?? ''
    expect(location).toContain('/programs?')
    expect(location).toContain('program=p1')
    expect(location).toContain('line=12')
    expect(location).toContain('column=4')
  })

  it('giữ nguyên fragment khi chuyển route cũ sang workspace canonical', () => {
    renderAt(`/eng/programming/projects/${PROJECT}/design?tab=mapping&signal=s1#binding-owner`)
    expect(screen.getByTestId('location')).toHaveTextContent(`/mapping?signal=s1#binding-owner`)
  })

  // `execution` chưa có route đích riêng trong IA sáu trang, nên nó đi tiếp dưới
  // dạng tab của /programs — giữ nguyên hành vi thay vì im lặng bỏ mất.
  it('tab execution đi tiếp dưới dạng query trên /programs', () => {
    renderAt(`/eng/programming/projects/${PROJECT}/design?tab=execution`)
    const location = screen.getByTestId('location').textContent ?? ''
    expect(location).toContain('/programs?')
    expect(location).toContain('tab=execution')
  })

  it('route cũ /task vẫn chuyển hướng về tab execution', () => {
    renderAt(`/eng/programming/projects/${PROJECT}/task`)
    // `/task` chuyển sang `/design?tab=execution`, rồi lối vào cũ chuyển tiếp
    // sang `/programs?tab=execution` — chuỗi hai bước vẫn phải kết thúc đúng chỗ.
    expect(screen.getByTestId('location')).toHaveTextContent('/programs')
  })
})

describe('T59-802 — legacy redirect sang canonical Programs v2', () => {
  it('route cũ /programs dùng replace tới route query canonical', () => {
    renderV2RedirectAt(`/eng/programming/projects/${PROJECT}/programs`)
    expect(screen.getByTestId('location')).toHaveTextContent(`/eng/programming/programs?project=${PROJECT}&mode=EDIT`)
  })

  it('giữ đúng allowlist/hash, bỏ field lạ và alias program sang pou', () => {
    renderV2RedirectAt(`/eng/programming/projects/${PROJECT}/programs?program=object-1&line=8&column=2&secret=drop#diagnostic`)
    const location = screen.getByTestId('location').textContent ?? ''
    expect(location).toContain(`/eng/programming/programs?project=${PROJECT}`)
    expect(location).toContain('pou=object-1')
    expect(location).toContain('mode=EDIT')
    expect(location).toContain('program=object-1')
    expect(location).toContain('line=8')
    expect(location).toContain('column=2')
    expect(location).toContain('#diagnostic')
    expect(location).not.toContain('secret')
  })

  it('pou tường minh thắng program alias và mode invalid không bị sửa thành EDIT', () => {
    renderV2RedirectAt(`/eng/programming/projects/${PROJECT}/programs?pou=object-new&program=object-old&mode=INVALID`)
    const location = screen.getByTestId('location').textContent ?? ''
    expect(location).toContain('pou=object-new')
    expect(location).toContain('program=object-old')
    expect(location).toContain('mode=INVALID')
  })
})
