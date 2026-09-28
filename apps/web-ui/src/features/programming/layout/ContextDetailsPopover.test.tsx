import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import type { ProgrammingProgramListItem, ProgrammingProgramsPage, ProgrammingRuntime } from '../model/types'
import { ProgrammingContextStrip } from './ProgrammingContextStrip'
import type { ContextDetailsData } from './contextDetails'

/**
 * `ContextDetailsPopover` — `T60-103`.
 *
 * File này render **strip thật** chứ không render popover trần: thứ đang được
 * nghiệm thu là một hành vi bắc qua hai component — nút `Chi tiết` mở panel, và
 * panel trả tiêu điểm về đúng nút đó. Dựng một harness riêng để mô phỏng chỗ
 * nối sẽ kiểm chính harness, và đúng chỗ nối ấy mới là chỗ hay hỏng.
 *
 * Ba nhóm bất biến được khoá ở đây:
 *
 * 1. **Bàn phím đi hết đường.** Mở bằng `Enter`, `Esc` đóng, tiêu điểm quay về
 *    nút đã mở. Đây là lối DUY NHẤT tới UUID sau `AC-PGM01-01`, nên hỏng bàn
 *    phím là mất hẳn dữ liệu với người dùng bàn phím.
 * 2. **Clipboard có thể không tồn tại.** `navigator.clipboard` vắng mặt trên
 *    HTTP thuần (đúng cách nhiều board lab được truy cập) và trong jsdom; nó
 *    cũng có thể `reject`. Cả hai nhánh phải thành một thông điệp có ích.
 * 3. **Không dữ kiện nào biến thành `0` hay ô trống im lặng.**
 */

const DRAFT_REVISION_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const ACTIVE_REVISION_ID = '9c858901-8a57-4791-81fe-4c455b099bc9'
const LKG_REVISION_ID = '2c9e7b2a-1c0e-4a6b-9a51-9ac7f5f5cb18'
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

const editing = {
  projectId: 'project-1',
  projectName: 'AHU-01',
  draftRevisionId: DRAFT_REVISION_ID,
  dirty: false,
  checkState: 'passed' as const
}

const runtime: ProgrammingRuntime = {
  schemaVersion: '1.0',
  controllerId: 'controller-local',
  producerState: 'READY',
  activeRevisionId: ACTIVE_REVISION_ID,
  lkgRevisionId: LKG_REVISION_ID,
  taskState: 'RUNNING',
  safeState: false,
  safeStateNoControllerOnly: false,
  observedAt: '2026-08-21T10:00:00Z'
}

/**
 * Một dòng của `GET /projects/{projectId}/programs` sau `T60-013`/`T60-014`.
 * Mặc định là "Core im": mọi trường read-back `null`, đúng thứ server trả khi
 * chưa đọc được bảng Program — fixture không được đẹp hơn sự thật.
 */
function programItem(overrides: Partial<ProgrammingProgramListItem> = {}): ProgrammingProgramListItem {
  return {
    programId: 'ahu-1',
    desiredEnabled: true,
    generation: 3,
    updatedBy: 'admin',
    updatedAtUtcMs: 1,
    runtimeState: 'UNKNOWN',
    runtimeStateSource: 'UNAVAILABLE',
    coreState: null,
    enabled: null,
    observedAt: null,
    periodMs: null,
    lastExecNs: null,
    maxExecNs: null,
    missedReleaseCount: null,
    consecutiveMissedRelease: null,
    lastRunAtUtc: null,
    lastRunAgeMs: null,
    lane: null,
    health: null,
    /* Ba trường chẩn đoán fault (OpenAPI 1.33.0) là BẮT BUỘC, không optional:
     * `null` = Core không đọc được, `''` = chưa từng fault. Fixture bỏ trống
     * sẽ làm chính phân biệt đó vô nghĩa. */
    lastFaultCode: null,
    lastFaultLine: null,
    faultCount: null,
    /* Issue #827 (OpenAPI 1.51.0) — `null` = không WAITING hoặc Core đời cũ. */
    waitingReason: null,
    ...overrides
  }
}

function programsPage(items: ProgrammingProgramListItem[]): ProgrammingProgramsPage {
  return {
    schemaVersion: '1.0',
    projectId: '11111111-1111-4111-8111-111111111111',
    runtimeStateSource: 'CORE_LIVE',
    observedAt: '2026-08-21T10:00:00Z',
    programsTruncated: false,
    items
  }
}

const intents: ProgrammingProgramsPage = programsPage([
  programItem({ programId: 'ahu-1', runtimeState: 'RUNNING', runtimeStateSource: 'CORE_LIVE' })
])

const details: ContextDetailsData = {
  draftRevisionId: DRAFT_REVISION_ID,
  draftContentHash: 'a'.repeat(64),
  activeRevisionId: ACTIVE_REVISION_ID,
  activeContentHash: 'b'.repeat(64),
  lkgRevisionId: LKG_REVISION_ID,
  controllerId: 'controller-local',
  observedAt: '2026-08-21T10:00:00Z',
  coreStatus: 'readable'
}

type StripProps = Parameters<typeof ProgrammingContextStrip>[0]

function renderStrip(overrides: Partial<StripProps> = {}) {
  return render(
    <I18nProvider>
      {/* Nút ngoài strip: cần một đích tiêu điểm hợp lệ để kiểm nhánh "bấm ra
          ngoài thì KHÔNG giật tiêu điểm về nút Chi tiết". */}
      <button type="button">Ngoài strip</button>
      <ProgrammingContextStrip
        projectStatus="ready"
        runtimeStatus="ready"
        runtime={runtime}
        intentStatus="ready"
        intents={intents}
        intentError={null}
        editing={editing}
        canMutate
        details={details}
        {...overrides}
      />
    </I18nProvider>
  )
}

function trigger(name = 'Chi tiết'): HTMLElement {
  return screen.getByRole('button', { name })
}

function popover(): HTMLElement {
  return screen.getByRole('dialog', { name: 'Chi tiết kỹ thuật' })
}

function copyStatus(): string {
  return screen.getByTestId('programming-context-details-copy-status').textContent ?? ''
}

/** Mô tả gốc của `navigator.clipboard` — khôi phục sau mỗi test để một test
 *  cài stub không làm test sau xanh/đỏ vì lý do sai. */
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true, writable: true })
}

beforeEach(() => localStorage.setItem('mkddc-lang', 'vi'))

afterEach(() => {
  cleanup()
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
  else Reflect.deleteProperty(navigator, 'clipboard')
})

describe('T60-103 — bàn phím đi hết đường', () => {
  it('mở được bằng bàn phím: Tab tới nút Chi tiết rồi Enter', async () => {
    const user = userEvent.setup()
    renderStrip()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ngoài strip' }))
    /* `Đổi ngôn ngữ` là một chặng THẬT trên strip kể từ khi `G-01` ẩn `TopBar`
     * của Programming từ `lg` — nút đổi ngôn ngữ phải có chỗ ở đâu đó, và chỗ
     * đó là đây. Khẳng định nó bằng tên thay vì `tab()` cho đủ số lần: nếu mai
     * này nó biến mất, test này phải đỏ chứ không được lặng lẽ đếm sang nút
     * khác. */
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Đổi ngôn ngữ' }))
    await user.tab()
    expect(document.activeElement).toBe(trigger())
    await user.keyboard('{Enter}')

    const dialog = popover()
    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    // Tiêu điểm vào PANEL, không nhảy thẳng vào nút Copy đầu tiên: trình đọc
    // màn hình phải đọc được "đang ở đâu" trước khi đọc "làm được gì".
    expect(document.activeElement).toBe(dialog)
  })

  it('Esc đóng popover VÀ trả tiêu điểm về đúng nút đã mở', async () => {
    const user = userEvent.setup()
    renderStrip()
    const details = trigger()
    fireEvent.click(details)
    expect(popover()).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // Mất tiêu điểm ở đây nghĩa là người dùng bàn phím bị bắn về đầu tài liệu
    // và phải Tab lại từ đầu — đúng chỗ hay bị bỏ sót nhất của một popover.
    expect(document.activeElement).toBe(details)
    expect(details).toHaveAttribute('aria-expanded', 'false')
  })

  it('Esc bấm khi tiêu điểm đang ở một nút Copy bên trong cũng đóng và trả tiêu điểm', async () => {
    const user = userEvent.setup()
    renderStrip()
    const details = trigger()
    fireEvent.click(details)
    const copy = within(popover()).getByRole('button', { name: 'Sao chép ID bộ điều khiển' })
    copy.focus()
    expect(document.activeElement).toBe(copy)

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(details)
  })

  it('nút Đóng trong panel cũng trả tiêu điểm về nút Chi tiết', () => {
    renderStrip()
    const details = trigger()
    fireEvent.click(details)
    fireEvent.click(within(popover()).getByRole('button', { name: 'Đóng chi tiết kỹ thuật' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(details)
  })

  it('bấm ra ngoài thì đóng, nhưng KHÔNG giật tiêu điểm khỏi chỗ người dùng vừa chọn', async () => {
    const user = userEvent.setup()
    renderStrip()
    fireEvent.click(trigger())
    expect(popover()).toBeInTheDocument()

    const outside = screen.getByRole('button', { name: 'Ngoài strip' })
    await user.click(outside)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(outside)
  })

  it('bấm lại nút Chi tiết thì đóng — không mở chồng hai panel', () => {
    renderStrip()
    fireEvent.click(trigger())
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.click(trigger())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('không truyền details lẫn handler: nút vô hiệu hoá kèm lý do, không có panel nào mở được', () => {
    renderStrip({ details: undefined })
    const details = trigger()
    expect(details).toBeDisabled()
    expect(details).toHaveAttribute('title', 'Chi tiết kỹ thuật chưa khả dụng ở bản dựng này')
    fireEvent.click(details)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('T60-103 — bốn nhóm dữ kiện và nút Copy từng dòng', () => {
  it('G-03 chuyển ý định và runtime Program vào Chi tiết thay vì badge trên hàng chính', () => {
    renderStrip()
    fireEvent.click(trigger())
    const status = screen.getByTestId('programming-context-program-details')
    expect(status).toHaveTextContent('1/1 muốn bật')
    expect(status).toHaveTextContent('RUNNING 1')
  })

  it('hiện đủ bảy dòng: cặp Draft, cặp Active, LKG, bộ điều khiển, mốc đọc', () => {
    renderStrip()
    fireEvent.click(trigger())
    const rows = popover().querySelectorAll('[data-detail-row]')
    expect([...rows].map((row) => row.getAttribute('data-detail-row'))).toEqual([
      'draftRevisionId',
      'draftContentHash',
      'activeRevisionId',
      'activeContentHash',
      'lkgRevisionId',
      'controllerId',
      'observedAt'
    ])
    expect(popover().textContent).toContain(DRAFT_REVISION_ID)
    expect(popover().textContent).toContain(ACTIVE_REVISION_ID)
    expect(popover().textContent).toContain(LKG_REVISION_ID)
    expect(popover().textContent).toContain('controller-local')
    expect(popover().textContent).toContain('2026-08-21T10:00:00Z')
  })

  it('mỗi dòng có nút Copy riêng, nhãn nói rõ SAO CHÉP CÁI GÌ cho trình đọc màn hình', () => {
    renderStrip()
    fireEvent.click(trigger())
    const buttons = within(popover()).getAllByRole('button', { name: /^Sao chép/ })
    expect(buttons).toHaveLength(7)
    const names = buttons.map((button) => button.getAttribute('aria-label'))
    // Bảy nhãn PHẢI khác nhau: bảy nút cùng đọc "Sao chép" thì danh sách nút
    // của trình đọc màn hình thành bảy dòng không phân biệt được.
    expect(new Set(names).size).toBe(7)
    expect(names).toContain('Sao chép ID Revision đang vận hành')
    // Chữ hiện trên màn hình nằm trong nhãn (WCAG 2.5.3) và không chỉ có icon.
    for (const button of buttons) expect(button.textContent).toContain('Sao chép')
  })

  it('Copy đặt đúng chuỗi THÔ vào clipboard và nói rõ vừa chép dòng nào', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard({ writeText })
    renderStrip()
    fireEvent.click(trigger())

    fireEvent.click(within(popover()).getByRole('button', { name: 'Sao chép ID Revision đang vận hành' }))

    expect(await screen.findByText('Đã sao chép ID Revision đang vận hành')).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledTimes(1)
    // Chuỗi thô, không rút gọn: rút gọn thì dán vào lệnh gọi API sẽ sai.
    expect(writeText).toHaveBeenCalledWith(ACTIVE_REVISION_ID)
  })
})

describe('T60-103 — clipboard không phải lúc nào cũng có', () => {
  it('không có navigator.clipboard: không ném, nói rõ lý do, strip vẫn nguyên vẹn', async () => {
    setClipboard(undefined)
    renderStrip()
    fireEvent.click(trigger())

    fireEvent.click(within(popover()).getByRole('button', { name: 'Sao chép ID bộ điều khiển' }))

    expect(await screen.findByText(/Trình duyệt không cho sao chép tự động/)).toBeInTheDocument()
    // Hỏng clipboard KHÔNG được kéo theo cả ngữ cảnh: strip và panel còn sống,
    // và giá trị vẫn đọc được bằng mắt để chép tay.
    expect(screen.getByRole('region', { name: 'Ngữ cảnh Lập trình hiện tại' })).toBeInTheDocument()
    expect(popover().textContent).toContain('controller-local')
  })

  it('clipboard từ chối quyền (promise reject): nuốt gọn, không làm hỏng panel', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('Write permission denied.', 'NotAllowedError'))
    setClipboard({ writeText })
    renderStrip()
    fireEvent.click(trigger())

    fireEvent.click(within(popover()).getByRole('button', { name: 'Sao chép ID Revision Nháp' }))

    expect(await screen.findByText(/Trình duyệt không cho sao chép tự động/)).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledWith(DRAFT_REVISION_ID)
    expect(popover()).toBeInTheDocument()
  })

  it('chép thành công rồi chép hỏng: thông điệp đi theo lần bấm gần nhất, không kẹt ở "đã chép"', async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('mất quyền'))
    setClipboard({ writeText })
    renderStrip()
    fireEvent.click(trigger())

    fireEvent.click(within(popover()).getByRole('button', { name: 'Sao chép ID bộ điều khiển' }))
    expect(await screen.findByText('Đã sao chép ID bộ điều khiển')).toBeInTheDocument()

    fireEvent.click(within(popover()).getByRole('button', { name: 'Sao chép ID Revision tốt gần nhất (LKG)' }))
    expect(await screen.findByText(/Trình duyệt không cho sao chép tự động/)).toBeInTheDocument()
    expect(copyStatus()).not.toContain('Đã sao chép')
  })
})

describe('T60-103 — dữ kiện thiếu ra dấu và LÝ DO, không bao giờ ra 0', () => {
  it('Core im: bốn dữ kiện của Core nói "không đọc được", nút Copy vô hiệu hoá kèm lý do', () => {
    renderStrip({
      runtimeStatus: 'error',
      runtime: null,
      details: { ...details, activeRevisionId: null, activeContentHash: null, lkgRevisionId: null, controllerId: null, observedAt: null, coreStatus: 'unreadable' }
    })
    fireEvent.click(trigger())
    const panel = popover()

    for (const id of ['activeRevisionId', 'lkgRevisionId', 'controllerId', 'observedAt']) {
      const row = panel.querySelector<HTMLElement>(`[data-detail-row="${id}"]`)
      expect(row).not.toBeNull()
      expect(row?.textContent).toContain('Không đọc được từ Core')
      const copy = within(row as HTMLElement).getByRole('button')
      expect(copy).toBeDisabled()
      expect(copy).toHaveAttribute('title', 'Không đọc được từ Core')
    }
    // AC-PGM01-04 ở phạm vi popover: thiếu số liệu KHÔNG bao giờ thành `0`.
    expect(panel.textContent).not.toMatch(/(^|\s)0(\s|$)/)
    expect(panel.textContent).toContain('—')
  })

  it('chưa có Draft: nói "chưa có bản nháp", không đổ cho mất kết nối', () => {
    renderStrip({
      editing: null,
      details: { ...details, draftRevisionId: null, draftContentHash: null }
    })
    fireEvent.click(trigger())
    const row = popover().querySelector<HTMLElement>('[data-detail-row="draftRevisionId"]')
    expect(row?.textContent).toContain('Chưa có bản nháp cho Project này')
    expect(row?.textContent).not.toContain('Không đọc được từ Core')
  })

  it('có Revision nhưng chưa đọc contentHash: nói đúng giới hạn của màn này', () => {
    renderStrip({ details: { ...details, draftContentHash: null, activeContentHash: null } })
    fireEvent.click(trigger())
    const row = popover().querySelector<HTMLElement>('[data-detail-row="activeContentHash"]')
    expect(row?.textContent).toContain('Chưa đọc được — màn này không tải nội dung Revision')
  })
})

describe('AC-PGM01-01 — UUID chỉ xuất hiện sau khi mở Details', () => {
  it('trước khi mở: không khớp regex UUID; sau khi mở: đủ cả ba định danh thô', () => {
    renderStrip()
    expect(document.body.textContent ?? '').not.toMatch(UUID_PATTERN)

    fireEvent.click(trigger())

    const panel = popover()
    expect(panel.textContent ?? '').toMatch(UUID_PATTERN)
    for (const id of [DRAFT_REVISION_ID, ACTIVE_REVISION_ID, LKG_REVISION_ID]) {
      expect(panel.textContent).toContain(id)
    }
  })

  it('đóng lại thì UUID biến mất khỏi DOM, không nằm ẩn đâu đó', () => {
    renderStrip()
    fireEvent.click(trigger())
    expect(document.body.textContent ?? '').toMatch(UUID_PATTERN)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.body.textContent ?? '').not.toMatch(UUID_PATTERN)
  })
})

describe('D-06 — một ngôn ngữ tại một thời điểm', () => {
  it('chế độ EN: nhãn, nút Copy và lý do đều tiếng Anh, không rò tiếng Việt', () => {
    localStorage.setItem('mkddc-lang', 'en')
    renderStrip({ details: { ...details, activeRevisionId: null, activeContentHash: null, coreStatus: 'readable' } })
    fireEvent.click(screen.getByRole('button', { name: 'Details' }))

    const panel = screen.getByRole('dialog', { name: 'Technical details' })
    expect(within(panel).getByRole('button', { name: 'Copy Draft revision ID' })).toBeInTheDocument()
    expect(panel.textContent).toContain('No package has been commissioned yet')
    expect(panel.textContent ?? '').not.toMatch(/[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i)
  })
})
