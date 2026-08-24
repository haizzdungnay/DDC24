import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import {
  SystemHealthHero,
  formatAuthorityTimestamp,
  safeStateSemanticState,
  systemHealthHeadline,
  systemHealthSummary,
  taskSemanticState,
  type SystemHealthHeroProps
} from './SystemHealthHero'
import { SEMANTIC_STATES } from '../shared/semanticState'

/**
 * `T60-202` — `SystemHealthHero`.
 *
 * File này khoá năm thứ:
 *
 * 1. **Phân biệt `safeStateNoControllerOnly` ↔ safe-state do lỗi thật.** Đây là
 *    điểm sống còn của task: một bên là cảnh báo nhẹ mà Commission sẽ giải
 *    quyết, một bên là lỗi nghiêm trọng giữ Commission bị khoá. Test khẳng định
 *    cả **mức nghiêm trọng**, **câu chữ** và **hệ quả vận hành** đều khác nhau.
 * 2. **Không bao giờ kết luận "ổn định" khi còn dữ kiện chưa đọc được.**
 * 3. **Thiếu số liệu ⇒ `—`/`Chưa rõ` KÈM LÝ DO, không bao giờ `0`.**
 * 4. **Màu không phải tín hiệu duy nhất**: mọi trạng thái có icon + chữ.
 * 5. **Không lộ UUID** (`AC-PGM01-01`).
 */

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

function props(overrides: Partial<SystemHealthHeroProps> = {}): SystemHealthHeroProps {
  return {
    core: { semantic: 'good', producerState: 'READY', observedAt: '2026-08-24T10:24:35Z' },
    safeState: { active: false, noControllerOnly: false },
    active: { taskState: 'RUNNING', present: true },
    runtimeStatus: 'ready',
    ...overrides
  }
}

function renderHero(overrides: Partial<SystemHealthHeroProps> = {}, lang: 'vi' | 'en' = 'vi') {
  localStorage.setItem('mkddc-lang', lang)
  return render(
    <I18nProvider>
      <SystemHealthHero {...props(overrides)} />
    </I18nProvider>
  )
}

function row(id: string): HTMLElement {
  const element = document.querySelector(`[data-health-row="${id}"]`)
  if (!element) throw new Error(`không tìm thấy hàng "${id}"`)
  return element as HTMLElement
}

function summaryState(): string | null {
  return document.querySelector('[data-testid="system-health-hero"]')?.getAttribute('data-summary-state') ?? null
}

afterEach(cleanup)

/* ------------------------------------------------------------------ *
 * Hàm thuần                                                           *
 * ------------------------------------------------------------------ */

describe('taskSemanticState', () => {
  it('RUNNING là good, FAULT là fault', () => {
    expect(taskSemanticState('RUNNING')).toBe('good')
    expect(taskSemanticState('FAULT')).toBe('fault')
  })

  it('STOPPED là warning — KHÔNG phải unknown: server đã nói rõ nó dừng', () => {
    expect(taskSemanticState('STOPPED')).toBe('warning')
  })

  it('STARTING là reconciling — một pha chuyển tiếp chưa kết luận được', () => {
    expect(taskSemanticState('STARTING')).toBe('reconciling')
  })

  it('chưa đọc được runtime ⇒ unknown, không mặc định về STOPPED', () => {
    expect(taskSemanticState(null)).toBe('unknown')
    expect(taskSemanticState('UNKNOWN')).toBe('unknown')
  })
})

describe('safeStateSemanticState — điểm sống còn của T60-202', () => {
  it('safe-state CHỈ vì chưa có output vật lý ⇒ warning (cảnh báo nhẹ)', () => {
    expect(safeStateSemanticState({ active: true, noControllerOnly: true })).toBe('warning')
  })

  it('safe-state do lỗi thật ⇒ fault (nghiêm trọng)', () => {
    expect(safeStateSemanticState({ active: true, noControllerOnly: false })).toBe('fault')
  })

  it('không tác động ⇒ good; chưa đọc được ⇒ unknown, KHÔNG suy thành "không tác động"', () => {
    expect(safeStateSemanticState({ active: false, noControllerOnly: false })).toBe('good')
    expect(safeStateSemanticState({ active: null, noControllerOnly: false })).toBe('unknown')
  })
})

describe('systemHealthSummary', () => {
  it('lấy trạng thái nghiêm trọng nhất trong các thành phần', () => {
    expect(systemHealthSummary(['good', 'warning', 'fault'])).toBe('fault')
    expect(systemHealthSummary(['good', 'good', 'good'])).toBe('good')
  })

  it('một dữ kiện unknown KHÔNG bị dữ kiện khoẻ mạnh che đi', () => {
    expect(systemHealthSummary(['good', 'good', 'unknown'])).toBe('unknown')
  })

  it('stale xếp trên warning: "số liệu có thể sai" cần biết trước một cảnh báo đã mô tả', () => {
    expect(systemHealthSummary(['stale', 'warning'])).toBe('stale')
  })

  it('danh sách rỗng ⇒ unknown, không rơi về good', () => {
    expect(systemHealthSummary([])).toBe('unknown')
  })
})

describe('systemHealthHeadline', () => {
  const pick = (vi: string) => vi

  it('mọi trạng thái ngữ nghĩa đều có câu kết luận riêng, không trùng nhau', () => {
    const headlines = SEMANTIC_STATES.map((state) => systemHealthHeadline(pick, state))
    expect(new Set(headlines).size).toBe(SEMANTIC_STATES.length)
    for (const headline of headlines) expect(headline.trim()).not.toBe('')
  })
})

describe('formatAuthorityTimestamp', () => {
  it('chuỗi không phân giải được thì giữ nguyên chứ không bịa mốc', () => {
    expect(formatAuthorityTimestamp('không-phải-thời-gian')).toBe('không-phải-thời-gian')
  })
})

/* ------------------------------------------------------------------ *
 * Phân biệt safe-state trên màn hình                                  *
 * ------------------------------------------------------------------ */

describe('SystemHealthHero — safeStateNoControllerOnly là CẢNH BÁO NHẸ', () => {
  it('nói rõ nguyên nhân là chưa có output vật lý và KHÔNG chặn Đưa vào vận hành', () => {
    renderHero({ safeState: { active: true, noControllerOnly: true } })
    const safe = row('safe-state')
    expect(safe).toHaveAttribute('data-health-state', 'warning')
    expect(safe.textContent).toContain('chưa có output vật lý')
    expect(safe.textContent).toContain('Không chặn Đưa vào vận hành')
    // Không được dùng chữ của nhánh nghiêm trọng.
    expect(safe.textContent).not.toContain('do lỗi thật')
  })

  it('kết luận tổng chỉ hạ xuống mức cảnh báo, KHÔNG hạ xuống mức lỗi', () => {
    renderHero({ safeState: { active: true, noControllerOnly: true } })
    expect(summaryState()).toBe('warning')
    expect(screen.getByText('Hệ thống đang chạy nhưng có việc cần xem lại')).toBeInTheDocument()
  })
})

describe('SystemHealthHero — safe-state do lỗi thật là NGHIÊM TRỌNG', () => {
  it('nói rõ là lỗi thật và Đưa vào vận hành/Khôi phục phải giữ khoá', () => {
    renderHero({ safeState: { active: true, noControllerOnly: false } })
    const safe = row('safe-state')
    expect(safe).toHaveAttribute('data-health-state', 'fault')
    expect(safe.textContent).toContain('do lỗi thật')
    expect(safe.textContent).toContain('Giữ Đưa vào vận hành/Khôi phục bị khoá')
    expect(safe.textContent).toContain('kiểm tra Core, I/O và alarm')
    // Không được mượn câu trấn an của nhánh nhẹ.
    expect(safe.textContent).not.toContain('Không chặn')
  })

  it('kết luận tổng là lỗi', () => {
    renderHero({ safeState: { active: true, noControllerOnly: false } })
    expect(summaryState()).toBe('fault')
    expect(screen.getByText('Hệ thống đang có lỗi cần xử lý')).toBeInTheDocument()
  })

  it('hai nhánh safe-state mang NHÃN KHÁC NHAU, không chỉ khác màu', () => {
    renderHero({ safeState: { active: true, noControllerOnly: true } })
    const light = row('safe-state').textContent ?? ''
    cleanup()
    renderHero({ safeState: { active: true, noControllerOnly: false } })
    const severe = row('safe-state').textContent ?? ''
    expect(light).not.toBe(severe)
  })
})

/* ------------------------------------------------------------------ *
 * Bốn dữ kiện của handoff §2                                          *
 * ------------------------------------------------------------------ */

describe('SystemHealthHero — bốn dữ kiện bắt buộc', () => {
  it('hiện đủ kết nối Core, tác vụ điều khiển, safe-state và mốc cập nhật', () => {
    renderHero()
    for (const id of ['core', 'task', 'safe-state', 'observed-at']) {
      expect(row(id)).toBeInTheDocument()
    }
    expect(screen.getByText('Kết nối Core')).toBeInTheDocument()
    expect(screen.getByText('Tác vụ điều khiển')).toBeInTheDocument()
    expect(screen.getByText('Trạng thái an toàn')).toBeInTheDocument()
    expect(screen.getByText('Cập nhật lần cuối')).toBeInTheDocument()
  })

  it('KHÔNG đưa CPU/RAM/hash/%-sức-khoẻ vào Overview (Plan 60 §3.1)', () => {
    renderHero()
    const hero = screen.getByTestId('system-health-hero')
    expect(hero.textContent ?? '').not.toMatch(/\b(cpu|ram|core load)\b|hash|%/i)
  })

  it('Core suy giảm giữ nguyên hệ quả vận hành đã có ở OverviewPage', () => {
    renderHero({ core: { semantic: 'stale', producerState: 'DEGRADED', observedAt: '2026-08-24T10:24:35Z' } })
    expect(row('core')).toHaveAttribute('data-health-state', 'stale')
    expect(row('core').textContent).toContain('mọi thay đổi runtime đang bị khoá')
  })

  it('tác vụ đã dừng vì chưa Commission gói nào thì nói thẳng lý do', () => {
    renderHero({ active: { taskState: 'STOPPED', present: false } })
    expect(row('task').textContent).toContain('Chưa có gói nào được đưa vào vận hành')
  })
})

/* ------------------------------------------------------------------ *
 * Thiếu dữ liệu                                                       *
 * ------------------------------------------------------------------ */

describe('SystemHealthHero — thiếu dữ liệu ra "—"/"Chưa rõ" kèm lý do, KHÔNG BAO GIỜ 0', () => {
  it('Core im: mọi dòng nói chưa đọc được, mốc cập nhật là "—" kèm lý do', () => {
    renderHero({
      core: { semantic: 'fault', producerState: null, observedAt: null },
      safeState: { active: null, noControllerOnly: false },
      active: { taskState: null, present: false },
      runtimeStatus: 'error'
    })
    const hero = screen.getByTestId('system-health-hero')
    expect(row('observed-at').textContent).toContain('—')
    expect(row('observed-at').textContent).toContain('Không đọc được trạng thái từ Core')
    expect(row('task').textContent).toContain('Chưa đọc được từ Core')
    expect(row('safe-state').textContent).toContain('Chưa đọc được từ Core')
    // Không một `0` đơn độc nào được sinh ra từ dữ liệu thiếu.
    expect(hero.textContent ?? '').not.toMatch(/(^|[^0-9])0($|[^0-9])/)
  })

  it('Core khoẻ nhưng safe-state chưa đọc được ⇒ TUYỆT ĐỐI không kết luận "ổn định"', () => {
    renderHero({ safeState: { active: null, noControllerOnly: false } })
    expect(summaryState()).toBe('unknown')
    expect(screen.queryByText('Hệ thống hoạt động ổn định')).not.toBeInTheDocument()
    expect(screen.getByText('Chưa đọc đủ trạng thái để kết luận')).toBeInTheDocument()
  })

  it('mọi dữ kiện khoẻ mạnh mới được kết luận "ổn định"', () => {
    renderHero()
    expect(summaryState()).toBe('good')
    expect(screen.getByText('Hệ thống hoạt động ổn định')).toBeInTheDocument()
  })

  it('đang tải ⇒ khung chờ khớp hình học, không phải một thẻ đầy "Chưa rõ"', () => {
    renderHero({ runtimeStatus: 'loading' })
    expect(screen.getByTestId('system-health-hero-skeleton')).toBeInTheDocument()
    expect(screen.queryByTestId('system-health-hero')).not.toBeInTheDocument()
    expect(screen.getByText('Đang đọc trạng thái hệ thống…')).toBeInTheDocument()
  })
})

/* ------------------------------------------------------------------ *
 * Luật chung của Plan 60                                              *
 * ------------------------------------------------------------------ */

describe('SystemHealthHero — luật chung', () => {
  it('màu không phải tín hiệu duy nhất: kết luận tổng có icon VÀ chữ', () => {
    renderHero({ safeState: { active: true, noControllerOnly: false } })
    const status = screen.getByRole('status')
    expect(status.querySelector('svg')).not.toBeNull()
    expect((status.textContent ?? '').trim().length).toBeGreaterThan(0)
  })

  it('không lộ UUID ở mặt trước (AC-PGM01-01)', () => {
    renderHero()
    const hero = screen.getByTestId('system-health-hero')
    expect(hero.textContent ?? '').not.toMatch(UUID_PATTERN)
    expect(hero.outerHTML).not.toMatch(UUID_PATTERN)
  })

  it('D-06: chế độ EN không rò tiếng Việt', () => {
    renderHero({ safeState: { active: true, noControllerOnly: true } }, 'en')
    const hero = screen.getByTestId('system-health-hero')
    expect(hero.textContent).toContain('no physical output yet')
    expect(hero.textContent).toContain('Core connection')
    expect(hero.textContent ?? '').not.toMatch(/[àáảãạăâđêôơư]/i)
  })
})
