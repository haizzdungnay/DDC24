import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import {
  QuickActions,
  quickActionForPrimaryCta,
  quickActionItems,
  type QuickActionKey,
  type QuickActionsProps
} from './QuickActions'
import type { PrimaryCtaKind } from './resolvePrimaryCta'

/**
 * `T60-206` — `QuickActions`.
 *
 * File này khoá bốn thứ:
 *
 * 1. **Không nút nào là primary** (`AC-PGM01-05`): CTA chính chỉ có một và nó
 *    thuộc `T60-201`, nằm ở đầu trang.
 * 2. **Vô hiệu hoá KÈM GIẢI THÍCH**: mỗi nút bị chặn phải nói ra lý do cụ thể,
 *    và lý do đó phải tới được người dùng bàn phím.
 * 3. **Ma trận RBAC ba vai** (`AC-PGM01-06`): viewer/operator **thấy** nút
 *    nhưng không điều hướng được tới bề mặt thay đổi.
 * 4. **Safe-state loại nhẹ KHÔNG khoá Commission** — cùng luật với
 *    `CheckCommissionPage.coreReady`.
 */

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

function props(overrides: Partial<QuickActionsProps> = {}): QuickActionsProps {
  return {
    projectId: PROJECT_ID,
    role: 'admin',
    producerState: 'READY',
    safeState: { active: false, noControllerOnly: false },
    primaryCtaKind: null,
    ...overrides
  }
}

/** Hiện đường dẫn đích để khẳng định nút bị chặn KHÔNG điều hướng. */
function RouteProbe() {
  const location = useLocation()
  return <div data-testid="destination">{location.pathname}</div>
}

function renderActions(overrides: Partial<QuickActionsProps> = {}, lang: 'vi' | 'en' = 'vi') {
  localStorage.setItem('mkddc-lang', lang)
  return render(
    <I18nProvider>
      <MemoryRouter initialEntries={['/eng/programming']}>
        <Routes>
          <Route path="/eng/programming" element={<QuickActions {...props(overrides)} />} />
          <Route path="/eng/programming/runtime" element={<RouteProbe />} />
          <Route path="/eng/programming/projects/:projectId/programs" element={<RouteProbe />} />
          <Route path="/eng/programming/projects/:projectId/commission" element={<RouteProbe />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>
  )
}

function action(key: QuickActionKey): HTMLElement {
  const element = document.querySelector(`[data-quick-action="${key}"]`)
  if (!element) throw new Error(`không tìm thấy lối tắt "${key}"`)
  return element as HTMLElement
}

afterEach(cleanup)

/* ------------------------------------------------------------------ *
 * Bảng chặn — hàm thuần                                               *
 * ------------------------------------------------------------------ */

describe('quickActionItems — bảng chặn', () => {
  const keys = (input: Partial<QuickActionsProps> = {}) =>
    Object.fromEntries(quickActionItems(props(input)).map((item) => [item.key, item.blockedBy]))

  it('admin + Core READY: cả bốn lối tắt đều mở', () => {
    expect(keys()).toEqual({ edit: null, check: null, commission: null, runtime: null })
  })

  it('chưa có Project: ba lối tắt phụ thuộc Project bị chặn, Runtime vẫn mở', () => {
    expect(keys({ projectId: null })).toEqual({
      edit: 'NO_PROJECT', check: 'NO_PROJECT', commission: 'NO_PROJECT', runtime: null
    })
  })

  it('viewer và operator: chặn vì thiếu quyền, Runtime vẫn mở (README §4)', () => {
    for (const role of ['viewer', 'operator'] as const) {
      expect(keys({ role })).toEqual({
        edit: 'NEEDS_PERMISSION', check: 'NEEDS_PERMISSION', commission: 'NEEDS_PERMISSION', runtime: null
      })
    }
  })

  it('chưa có Project ĐƯỢC BÁO TRƯỚC thiếu quyền: lý do vĩnh viễn trước lý do tạm thời', () => {
    expect(keys({ projectId: null, role: 'viewer' }).edit).toBe('NO_PROJECT')
  })

  it('Core im: chỉ Commission bị khoá — chỉnh sửa và Kiểm tra vẫn mở (README §6)', () => {
    expect(keys({ producerState: 'UNAVAILABLE' })).toEqual({
      edit: null, check: null, commission: 'CORE_UNAVAILABLE', runtime: null
    })
  })

  it('Core suy giảm khoá Commission; chưa đọc được Core cũng khoá (fail-closed)', () => {
    expect(keys({ producerState: 'DEGRADED' }).commission).toBe('CORE_DEGRADED')
    expect(keys({ producerState: null }).commission).toBe('CORE_UNREAD')
  })

  it('safe-state do lỗi THẬT khoá Commission', () => {
    expect(keys({ safeState: { active: true, noControllerOnly: false } }).commission).toBe('SAFE_STATE_FAULT')
  })

  it('safe-state CHỈ vì chưa có output vật lý KHÔNG khoá Commission — Commission là cách giải quyết nó', () => {
    expect(keys({ safeState: { active: true, noControllerOnly: true } }).commission).toBeNull()
  })

  it('safe-state chưa đọc được thì không tự dựng lên một lý do chặn', () => {
    expect(keys({ safeState: { active: null, noControllerOnly: false } }).commission).toBeNull()
  })

  it('thiếu Project ⇒ không dựng đích, không điều hướng "chung chung"', () => {
    const items = quickActionItems(props({ projectId: null }))
    expect(items.find((item) => item.key === 'edit')?.route).toBeNull()
    expect(items.find((item) => item.key === 'runtime')?.route).toBe('/eng/programming/runtime')
  })
})

describe('quickActionForPrimaryCta', () => {
  it('cả năm CTA của bảng handoff §3 đều ánh xạ về một lối tắt', () => {
    const kinds: PrimaryCtaKind[] = ['CONTINUE_EDITING', 'FIX_CHECK_ERRORS', 'REVIEW_CHANGES', 'COMMISSION', 'OPEN_RUNTIME']
    for (const kind of kinds) expect(quickActionForPrimaryCta(kind)).not.toBeNull()
  })

  it('chưa kết luận được CTA ⇒ không lối tắt nào bị đánh dấu', () => {
    expect(quickActionForPrimaryCta(null)).toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 * Không nút nào là primary                                            *
 * ------------------------------------------------------------------ */

describe('QuickActions — KHÔNG nút nào là primary (AC-PGM01-05)', () => {
  it('không nút nào mang nền accent, kể cả nút trùng CTA chính', () => {
    renderActions({ primaryCtaKind: 'COMMISSION' })
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(4)
    for (const button of buttons) {
      expect(button.className).not.toContain('bg-[var(--c-accent)]')
    }
  })

  it('lối tắt trùng CTA chính được đánh dấu BẰNG CHỮ, không bằng cách tô nổi bật', () => {
    renderActions({ primaryCtaKind: 'CONTINUE_EDITING' })
    expect(action('edit')).toHaveAttribute('data-primary-elsewhere', 'true')
    expect(action('edit').textContent).toContain('Đang là hành động chính ở đầu trang')
    expect(action('commission')).not.toHaveAttribute('data-primary-elsewhere')
  })

  it('bốn lối tắt của mockup, đúng thứ tự', () => {
    renderActions()
    const labels = screen.getAllByRole('button').map((button) => button.querySelector('span')?.textContent)
    expect(labels).toEqual(['Tiếp tục chỉnh sửa', 'Kiểm tra thay đổi', 'Đưa vào vận hành', 'Mở Runtime'])
  })
})

/* ------------------------------------------------------------------ *
 * Vô hiệu hoá kèm giải thích                                          *
 * ------------------------------------------------------------------ */

describe('QuickActions — vô hiệu hoá KÈM GIẢI THÍCH', () => {
  it('viewer vẫn THẤY cả bốn nút, ba nút mang lý do thiếu quyền thành lời', () => {
    renderActions({ role: 'viewer' })
    expect(screen.getAllByRole('button')).toHaveLength(4)
    for (const key of ['edit', 'check', 'commission'] as const) {
      expect(action(key)).toHaveAttribute('aria-disabled', 'true')
      expect(action(key).textContent).toContain('Vai hiện tại không có quyền cho thao tác này.')
    }
    expect(action('runtime')).not.toHaveAttribute('aria-disabled')
  })

  it('mỗi lý do là câu CỤ THỂ, không phải một nút xám im lặng', () => {
    renderActions({ projectId: null })
    expect(action('edit').textContent).toContain('Controller này chưa có Project nào.')
    cleanup()
    renderActions({ producerState: 'UNAVAILABLE' })
    expect(action('commission').textContent).toContain('Không kết nối được Core — Đưa vào vận hành bị khoá.')
    cleanup()
    renderActions({ safeState: { active: true, noControllerOnly: false } })
    expect(action('commission').textContent).toContain('kiểm tra Core, I/O và alarm trước khi đưa vào vận hành')
  })

  it('nút bị chặn VẪN nhận tiêu điểm bàn phím và lý do gắn với tên truy cập', () => {
    renderActions({ role: 'operator' })
    const button = action('commission') as HTMLButtonElement
    // `aria-disabled` thay cho `disabled`: `disabled` sẽ gỡ nút khỏi thứ tự tab
    // và người dùng bàn phím không bao giờ nghe được chính lời giải thích.
    expect(button).not.toBeDisabled()
    button.focus()
    expect(document.activeElement).toBe(button)
    const describedBy = button.getAttribute('aria-describedby')
    expect(describedBy).not.toBeNull()
    expect(document.getElementById(describedBy as string)?.textContent).toContain('không có quyền')
  })
})

/* ------------------------------------------------------------------ *
 * RBAC — không mutate được qua UI lẫn bàn phím                        *
 * ------------------------------------------------------------------ */

describe('QuickActions — ma trận RBAC (AC-PGM01-06)', () => {
  it('admin điều hướng được tới cả ba bề mặt thay đổi', () => {
    renderActions()
    fireEvent.click(action('edit'))
    expect(screen.getByTestId('destination')).toHaveTextContent(`/eng/programming/projects/${PROJECT_ID}/programs`)
    cleanup()
    renderActions()
    fireEvent.click(action('commission'))
    expect(screen.getByTestId('destination')).toHaveTextContent(`/eng/programming/projects/${PROJECT_ID}/commission`)
  })

  it('viewer/operator bấm chuột KHÔNG điều hướng tới bề mặt thay đổi', () => {
    for (const role of ['viewer', 'operator'] as const) {
      renderActions({ role })
      fireEvent.click(action('edit'))
      fireEvent.click(action('check'))
      fireEvent.click(action('commission'))
      expect(screen.queryByTestId('destination')).not.toBeInTheDocument()
      cleanup()
    }
  })

  it('viewer/operator gõ Enter trên nút bị chặn cũng KHÔNG điều hướng', () => {
    renderActions({ role: 'viewer' })
    const button = action('commission') as HTMLButtonElement
    button.focus()
    fireEvent.keyDown(button, { key: 'Enter' })
    fireEvent.click(button) // trình duyệt phát `click` sau Enter trên <button>
    expect(screen.queryByTestId('destination')).not.toBeInTheDocument()
  })

  it('cả ba vai đều mở được Runtime — xem trạng thái là quyền của mọi vai', () => {
    for (const role of ['viewer', 'operator', 'admin'] as const) {
      renderActions({ role })
      fireEvent.click(action('runtime'))
      expect(screen.getByTestId('destination')).toHaveTextContent('/eng/programming/runtime')
      cleanup()
    }
  })

  it('Core im: chỉnh sửa vẫn đi được, Commission thì không (README §6)', () => {
    renderActions({ producerState: 'UNAVAILABLE' })
    fireEvent.click(action('commission'))
    expect(screen.queryByTestId('destination')).not.toBeInTheDocument()
    fireEvent.click(action('edit'))
    expect(screen.getByTestId('destination')).toHaveTextContent(`/eng/programming/projects/${PROJECT_ID}/programs`)
  })
})

/* ------------------------------------------------------------------ *
 * Luật chung của Plan 60                                              *
 * ------------------------------------------------------------------ */

describe('QuickActions — luật chung', () => {
  it('không lộ UUID ở mặt trước (AC-PGM01-01)', () => {
    renderActions()
    const list = screen.getByTestId('quick-actions')
    expect(list.textContent ?? '').not.toMatch(UUID_PATTERN)
    expect(list.outerHTML).not.toMatch(UUID_PATTERN)
  })

  it('D-06: chế độ EN không rò tiếng Việt', () => {
    renderActions({ role: 'viewer' }, 'en')
    const list = screen.getByTestId('quick-actions')
    expect(list.textContent).toContain('Continue Editing')
    expect(list.textContent).toContain('does not have permission')
    expect(list.textContent ?? '').not.toMatch(/[àáảãạăâđêôơư]/i)
  })
})

/*
`WEB-RBAC-001` — vai `engineer` PHẢI dùng được lối tắt Programming.

Bộ cũ chỉ kiểm chiều "viewer/operator bị chặn". Chiều đó một mình vẫn xanh khi
điều kiện là `role >= admin` — tức đúng lúc `engineer` bị chặn nhầm. Hai chiều
phải cùng đúng thì phép đo mới nói được điều gì.
*/
describe('quickActionItems — vai engineer', () => {
  it('engineer mở được cả bốn lối tắt; operator/viewer vẫn bị chặn', () => {
    const forRole = (role: 'viewer' | 'operator' | 'engineer' | 'admin') =>
      Object.fromEntries(quickActionItems(props({ role })).map((item) => [item.key, item.blockedBy]))

    expect(forRole('engineer')).toEqual({ edit: null, check: null, commission: null, runtime: null })
    expect(forRole('admin')).toEqual({ edit: null, check: null, commission: null, runtime: null })
    for (const role of ['viewer', 'operator'] as const) {
      const blocks = forRole(role)
      expect(blocks.edit, `${role} phải bị chặn ở edit`).toBe('NEEDS_PERMISSION')
      expect(blocks.check, `${role} phải bị chặn ở check`).toBe('NEEDS_PERMISSION')
      expect(blocks.commission, `${role} phải bị chặn ở commission`).toBe('NEEDS_PERMISSION')
      // Runtime là đường ĐỌC: chặn nó lại làm người trực ca mù trước thiết bị
      // họ đang đứng cạnh.
      expect(blocks.runtime, `${role} vẫn phải xem được Runtime`).toBeNull()
    }
  })
})
