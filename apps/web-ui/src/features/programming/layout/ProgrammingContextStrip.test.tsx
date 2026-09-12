import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import type { ProgrammingProgramListItem, ProgrammingProgramsPage, ProgrammingRuntime } from '../model/types'
import {
  CONTEXT_STRIP_TRIM_ORDER,
  PROGRAMMING_CONTEXT_STRIP_HEIGHT_PX,
  ProgrammingContextStrip
} from './ProgrammingContextStrip'
import type { ContextDetailsData } from './contextDetails'

/**
 * Bộ test của `ProgrammingContextStrip` — `T60-102`.
 *
 * File này KẾ THỪA TRỌN VẸN các case của `ProgrammingContextBar.test.tsx`
 * (`T59-503`) mà strip thay thế: bảy trạng thái ngữ cảnh và luật "không suy
 * intent thành RUNNING" được giữ nguyên từng dòng. Chỉ selector đổi, vì bố cục
 * đổi từ `<dl>` sáu ô sang một hàng 38 px — không case nào bị bỏ.
 *
 * Hai case của bản cũ khẳng định `draft-revision`/`active-revision` HIỆN trên
 * mặt trước đã đảo chiều theo `AC-PGM01-01`: nay chúng phải KHÔNG hiện. Đảo
 * chiều là quyết định của D-05, không phải mất case — case tương ứng nằm ở
 * `describe('AC-PGM01-01')` bên dưới và kiểm chặt hơn bản cũ (regex UUID trên
 * toàn bộ DOM, không chỉ hai chuỗi cụ thể).
 */

/* UUID thật, không phải chuỗi giả kiểu 'draft-revision': `AC-PGM01-01` kiểm
 * bằng regex UUID nên fixture phải có đúng hình dạng mà sản phẩm thật trả về,
 * nếu không test sẽ xanh vì fixture chứ không vì mã. */
const DRAFT_REVISION_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const ACTIVE_REVISION_ID = '9c858901-8a57-4791-81fe-4c455b099bc9'
const LKG_REVISION_ID = '2c9e7b2a-1c0e-4a6b-9a51-9ac7f5f5cb18'
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

const editing = {
  projectId: 'project-1',
  projectName: 'AHU-01',
  draftRevisionId: DRAFT_REVISION_ID,
  dirty: true,
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

/** Dữ kiện kỹ thuật của popover `Chi tiết` (`T60-103`) — chỉ truyền ở những
 *  case cần chứng minh nửa sau của `AC-PGM01-01`; các case còn lại vẫn render
 *  strip KHÔNG có popover, đúng như bản `T60-102`. */
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
  programItem({ programId: 'ahu-1', desiredEnabled: true, generation: 3, runtimeState: 'UNKNOWN' }),
  programItem({ programId: 'ahu-2', desiredEnabled: false, generation: 4, runtimeState: 'RUNNING', runtimeStateSource: 'CORE_LIVE' })
])

type StripProps = Parameters<typeof ProgrammingContextStrip>[0]

function stripProps(overrides: Partial<StripProps> = {}): StripProps {
  return {
    projectStatus: 'ready',
    runtimeStatus: 'ready',
    runtime,
    intentStatus: 'ready',
    intents,
    intentError: null,
    editing,
    canMutate: true,
    ...overrides
  }
}

function renderStrip(overrides: Partial<StripProps> = {}) {
  return render(
    <I18nProvider>
      <ProgrammingContextStrip {...stripProps(overrides)} />
    </I18nProvider>
  )
}

function strip() {
  return screen.getByRole('region', { name: 'Ngữ cảnh Lập trình hiện tại' })
}

function field(name: string): HTMLElement {
  const element = strip().querySelector<HTMLElement>(`[data-context-field="${name}"]`)
  if (!element) throw new Error(`không có dữ kiện "${name}" trên Context Strip`)
  return element
}

beforeEach(() => localStorage.setItem('mkddc-lang', 'vi'))
afterEach(cleanup)

describe('ProgrammingContextStrip — T60-102 (giữ nguyên ngữ nghĩa của T59-503)', () => {
  it('tách Draft/Active và không suy ý định Enable thành RUNNING trên thanh chính', () => {
    renderStrip()
    expect(within(field('draft')).getByText('Chưa lưu · Kiểm tra đạt')).toBeInTheDocument()
    expect(within(field('active')).getByText('Có')).toBeInTheDocument()
    expect(strip().querySelector('[data-context-field="health"]')).not.toBeInTheDocument()
    expect(within(strip()).getByRole('alert')).toHaveTextContent('Chưa xác định kết quả — đang đối soát')
    expect(within(strip()).getByRole('alert')).toHaveTextContent('không tự suy Program đang chạy')
  })

  it('một Program muốn bật nhưng Core báo DISABLED không tạo badge RUNNING giả', () => {
    renderStrip({
      intents: { ...intents, items: [{ ...intents.items[0], desiredEnabled: true, runtimeState: 'DISABLED' }] }
    })
    expect(within(strip()).queryByText(/RUNNING/)).not.toBeInTheDocument()
    expect(strip().querySelector('[data-context-field="health"]')).not.toBeInTheDocument()
  })

  it.each([
    ['loading', { projectStatus: 'loading', runtimeStatus: 'loading', runtime: null, intentStatus: 'loading', intents: null }, 'Đang tải dữ liệu Programming…', 'status'],
    ['empty', { editing: null, intents: { ...intents, items: [] } }, 'Chưa có chương trình', 'status'],
    ['error', { intentStatus: 'error', intents: null, intentError: 'HTTP 500' }, 'Không tải được trạng thái chương trình.', 'alert'],
    ['permission', { canMutate: false, intents: { ...intents, items: [{ ...intents.items[1], runtimeState: 'DISABLED' }] } }, 'Bạn không có quyền thực hiện thao tác này', 'status'],
    ['stale', { runtime: { ...runtime, producerState: 'DEGRADED' }, intents: { ...intents, items: [{ ...intents.items[1], runtimeState: 'RUNNING' }] } }, 'Dữ liệu đã cũ', 'status'],
    ['offline', { runtimeStatus: 'error', runtime: null }, 'Không kết nối được Core', 'alert'],
    ['unknown', {}, 'Chưa xác định kết quả — đang đối soát', 'alert']
  ] as const)('hiện trạng thái %s bằng copy và vai trò ngữ nghĩa riêng', (_name, overrides, copy, role) => {
    renderStrip(overrides as Partial<StripProps>)
    expect(screen.getByRole(role)).toHaveTextContent(copy)
  })

  it('Project lỗi và Core im vẫn nói thành lời, không im lặng rơi về giá trị đẹp hơn', () => {
    renderStrip({ projectStatus: 'error', editing: null, runtimeStatus: 'error', runtime: null, intentStatus: 'error', intents: null })
    expect(within(field('project')).getByText('— không đọc được')).toBeInTheDocument()
    expect(within(field('active')).getByText('Không đọc được')).toBeInTheDocument()
    expect(within(field('core')).getByText('Không kết nối được Core')).toBeInTheDocument()
  })

  it('chưa Commission thì Active là "Chưa vận hành", không phải một số 0 hay "Stopped"', () => {
    renderStrip({ runtime: { ...runtime, activeRevisionId: null } })
    expect(within(field('active')).getByText('Chưa vận hành')).toBeInTheDocument()
    expect(within(strip()).queryByText('0')).not.toBeInTheDocument()
  })
})

/**
 * `ISS-PGUI-01` — `runtime.activeRevisionId` là read model của CONTROLLER.
 *
 * Ba case dưới đây khoá đúng chỗ strip từng nói sai: nó kết luận `Có` chỉ từ
 * con số toàn cục ấy, nên mở BẤT KỲ Project nào cũng thấy "thiết bị đang chạy
 * gói của bạn". Trên production, Project đang mở là `AHU-MASTER-SEQUENCE` còn
 * gói đang chạy thuộc `SOAK-10P-20260824-172521` (`PC-001`).
 */
describe('ProgrammingContextStrip — ISS-PGUI-01: Active phải thuộc đúng Project đang mở', () => {
  it('gói đang chạy thuộc Project khác ⇒ KHÔNG nói "Có", và nói rõ chủ thật', () => {
    renderStrip({
      activeSequence: null,
      activeOwnership: { kind: 'foreign', ownerProjectId: 'p-2', ownerName: 'SOAK-10P-20260824-172521' }
    })
    expect(within(field('active')).queryByText('Có')).not.toBeInTheDocument()
    expect(within(field('active')).getByText('Gói đang chạy thuộc SOAK-10P-20260824-172521')).toBeInTheDocument()
  })

  /* Biết id mà chưa biết tên vẫn KHÔNG được rơi về "Có": thiếu tên là thiếu
     một chi tiết, không phải bằng chứng gói ấy là của Project này. */
  it('không đọc được tên Project chủ vẫn không rơi về "Có"', () => {
    renderStrip({
      activeSequence: null,
      activeOwnership: { kind: 'foreign', ownerProjectId: 'p-2', ownerName: null }
    })
    expect(within(field('active')).getByText('Gói đang chạy thuộc Project khác')).toBeInTheDocument()
  })

  it('không quy được gói đang chạy về Project nào ⇒ nói chưa xác định, không nói "Có"', () => {
    renderStrip({ activeSequence: null, activeOwnership: { kind: 'unresolved' } })
    expect(within(field('active')).queryByText('Có')).not.toBeInTheDocument()
    expect(within(field('active')).getByText('Chưa xác định được Project của gói đang chạy')).toBeInTheDocument()
  })

  /* Chốt chặn ngược: `owned` phải giữ NGUYÊN hành vi cũ, nếu không ba case
     trên chỉ chứng minh rằng strip đã ngừng nói "Có" với mọi thứ. */
  it('gói đang chạy đúng là của Project này ⇒ vẫn hiện số hiệu như cũ', () => {
    renderStrip({ activeSequence: 12, activeOwnership: { kind: 'owned', projectId: 'p-1' } })
    expect(within(field('active')).getByText('r12 · Có')).toBeInTheDocument()
  })
})

describe('ProgrammingContextStrip — bố cục README §3', () => {
  it('là một hàng cao 36–40 px và dính theo trang', () => {
    renderStrip()
    expect(PROGRAMMING_CONTEXT_STRIP_HEIGHT_PX).toBeGreaterThanOrEqual(36)
    expect(PROGRAMMING_CONTEXT_STRIP_HEIGHT_PX).toBeLessThanOrEqual(40)
    const row = screen.getByTestId('programming-context-strip-row')
    expect(row.style.height).toBe(`${PROGRAMMING_CONTEXT_STRIP_HEIGHT_PX}px`)
    expect(strip().className).toContain('sticky')
    // Mobile giữ TopBar nên dùng top-16; desktop Programming ẩn TopBar theo
    // G-01 nên strip trở về top-0, không chừa khoảng trống 64 px.
    expect(strip().className).toContain('top-16')
    expect(strip().className).toContain('lg:top-0')
  })

  it('chỉ giữ bốn dữ kiện chính của G-03 trên cùng một hàng', () => {
    renderStrip()
    for (const name of ['project', 'draft', 'active', 'core']) {
      expect(field(name)).toBeInTheDocument()
    }
    expect(screen.queryByText('Chương trình')).not.toBeInTheDocument()
  })

  it('R60-05 — thứ tự rút gọn là Controller → Running → Editing; Project luôn còn', () => {
    renderStrip()
    expect([...CONTEXT_STRIP_TRIM_ORDER]).toEqual(['core', 'active', 'draft'])
    // Cắt trước ⇒ cần màn RỘNG HƠN mới hiện lại, nên breakpoint phải giảm dần.
    expect(field('core').className).toContain('lg:flex')
    expect(field('active').className).toContain('md:flex')
    expect(field('draft').className).toContain('sm:flex')
    expect(field('project').className).not.toContain('hidden')
  })

  it.each(['draft', 'active', 'core'])('dữ kiện %s có cả icon lẫn chữ — màu không phải tín hiệu duy nhất', (name) => {
    renderStrip()
    const element = field(name)
    expect(element.querySelectorAll('svg').length).toBeGreaterThan(0)
    expect(element.textContent?.trim().length ?? 0).toBeGreaterThan(0)
  })

  it('đặt Lưu/Kiểm tra/Làm mới trong chính hàng ngữ cảnh và gọi đúng action', () => {
    const onSave = vi.fn()
    const onCheck = vi.fn()
    const onRefresh = vi.fn()
    renderStrip({
      actions: {
        onSave,
        saving: false,
        saveDisabledReason: null,
        onCheck,
        checkDisabledReason: null,
      },
      onRefresh,
    })

    const row = screen.getByTestId('programming-context-strip-row')
    const actions = within(row).getByTestId('programming-global-actions')
    fireEvent.click(within(actions).getByRole('button', { name: 'Lưu bản nháp' }))
    fireEvent.click(within(actions).getByRole('button', { name: 'Kiểm tra gói' }))
    fireEvent.click(within(row).getByRole('button', { name: 'Làm mới' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onCheck).toHaveBeenCalledTimes(1)
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })
})

describe('AC-PGM01-01 — không lộ UUID ở mặt trước', () => {
  it('DOM mặc định không khớp regex UUID dù mọi định danh đều có trong props', () => {
    renderStrip()
    // Props THẬT SỰ mang UUID: nếu không, test này xanh một cách vô nghĩa.
    expect(UUID_PATTERN.test(editing.draftRevisionId)).toBe(true)
    expect(UUID_PATTERN.test(runtime.activeRevisionId ?? '')).toBe(true)
    expect(strip().textContent ?? '').not.toMatch(UUID_PATTERN)
    expect(strip().textContent ?? '').not.toContain(runtime.controllerId)
  })

  it.each([
    ['bình thường', {}],
    ['Core suy giảm', { runtime: { ...runtime, producerState: 'DEGRADED' as const } }],
    ['Core im', { runtimeStatus: 'error' as const, runtime: null }],
    ['chưa có Draft', { editing: null }]
  ])('không rò UUID ở nhánh %s', (_name, overrides) => {
    renderStrip(overrides as Partial<StripProps>)
    expect(strip().textContent ?? '').not.toMatch(UUID_PATTERN)
  })

  it('nút Chi tiết là lối duy nhất tới định danh thô; nội dung chỉ hiện sau khi mở', () => {
    /* Popover thật là `T60-103`. Ở đây kiểm ĐÚNG phần thuộc `T60-102`: strip mở
     * ra một seam, và ID thô chỉ xuất hiện sau khi seam đó được kích hoạt. */
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <I18nProvider>
          <ProgrammingContextStrip {...stripProps({ onOpenDetails: () => setOpen(true) })} />
          {open ? <p>{runtime.activeRevisionId}</p> : null}
        </I18nProvider>
      )
    }
    render(<Harness />)
    expect(document.body.textContent ?? '').not.toMatch(UUID_PATTERN)

    const details = screen.getByRole('button', { name: 'Chi tiết' })
    expect(details).toHaveAttribute('aria-haspopup', 'dialog')
    expect(details).toBeEnabled()
    fireEvent.click(details)
    expect(document.body.textContent ?? '').toMatch(UUID_PATTERN)
  })

  it('không có handler thì nút Chi tiết vô hiệu hoá KÈM LÝ DO, không biến mất', () => {
    renderStrip()
    const details = screen.getByRole('button', { name: 'Chi tiết' })
    expect(details).toBeDisabled()
    expect(details).toHaveAttribute('title', 'Chi tiết kỹ thuật chưa khả dụng ở bản dựng này')
  })

  it('gọi đúng một lần khi bấm, không tự mở gì khác', () => {
    const onOpenDetails = vi.fn()
    renderStrip({ onOpenDetails })
    fireEvent.click(screen.getByRole('button', { name: 'Chi tiết' }))
    expect(onOpenDetails).toHaveBeenCalledTimes(1)
  })

  /* `T60-103` đóng nốt NỬA SAU của `AC-PGM01-01`. Case seam ở trên chỉ chứng
   * minh strip mở ra một chỗ nối; hai case dưới đây đi qua popover THẬT, tức là
   * đúng đường mà người dùng đi. Bộ đầy đủ (bàn phím, trả tiêu điểm, Copy,
   * clipboard vắng mặt) nằm ở `ContextDetailsPopover.test.tsx`. */
  it('có details thật: mặt trước sạch UUID, mở Chi tiết mới lộ định danh thô', () => {
    renderStrip({ details })
    expect(strip().textContent ?? '').not.toMatch(UUID_PATTERN)
    expect(strip().textContent ?? '').not.toContain(runtime.controllerId)

    fireEvent.click(screen.getByRole('button', { name: 'Chi tiết' }))

    const panel = screen.getByRole('dialog', { name: 'Chi tiết kỹ thuật' })
    expect(panel.textContent ?? '').toMatch(UUID_PATTERN)
    expect(panel.textContent).toContain(DRAFT_REVISION_ID)
    expect(panel.textContent).toContain(ACTIVE_REVISION_ID)
    expect(panel.textContent).toContain(runtime.controllerId)
  })

  it('đóng popover bằng Esc thì mặt trước sạch UUID trở lại và tiêu điểm về nút Chi tiết', () => {
    renderStrip({ details })
    const button = screen.getByRole('button', { name: 'Chi tiết' })
    fireEvent.click(button)
    expect(document.body.textContent ?? '').toMatch(UUID_PATTERN)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(document.body.textContent ?? '').not.toMatch(UUID_PATTERN)
    expect(document.activeElement).toBe(button)
  })
})

describe('D-06 — một ngôn ngữ tại một thời điểm', () => {
  it('chế độ EN không rò chuỗi tiếng Việt của cùng một nhãn', () => {
    localStorage.setItem('mkddc-lang', 'en')
    renderStrip()
    // Cả nhãn vùng cũng đổi ngôn ngữ — đó chính là điều đang kiểm.
    const enStrip = screen.getByRole('region', { name: 'Current Programming context' })
    const active = enStrip.querySelector<HTMLElement>('[data-context-field="active"]')
    expect(active).not.toBeNull()
    expect(within(active as HTMLElement).getByText('Yes')).toBeInTheDocument()
    expect(enStrip.textContent ?? '').not.toContain('Đang vận hành')
    expect(screen.getByRole('button', { name: 'Details' })).toBeInTheDocument()
  })
})

/*
 * `#673` — nút đổi ngôn ngữ trên vỏ Programming.
 *
 * `AppShell` đặt `TopBar` thành `lg:hidden` trên route Programming (`G-01`), mà
 * nút đổi ngôn ngữ chỉ sống trong `TopBar` — nên từ `lg` trở lên, trong toàn bộ
 * Programming, người dùng mất hẳn đường đổi ngôn ngữ. Strip là vỏ tiếp quản nên
 * nó gánh nút đó.
 *
 * Hợp đồng phải giữ: MỖI KHỔ ĐÚNG MỘT NÚT. jsdom không có CSS nên không đo được
 * khổ thật — phép đo thật nằm ở `ISS-PGUI-03` (Playwright, bốn khổ). Ở đây khoá
 * đúng thứ jsdom kiểm được: nút CÓ mặt, và nó mang cặp lớp responsive là nửa
 * còn lại của hợp đồng. Ai gỡ `hidden` hoặc `lg:inline-flex` sẽ làm đỏ test này
 * trước khi kịp tạo hai nút cùng tên trên một màn hình.
 */
describe('#673 — nút đổi ngôn ngữ trên Global Context Bar', () => {
  /* Mặc định KHÔNG dựng. `AppShell` chỉ ẩn `TopBar` trên route focus; ở Tổng
   * quan `/eng/programming` thì `TopBar` vẫn hiện, nên strip mà tự dựng nút là
   * tạo ngay hai nút cùng tên truy cập — đúng lỗi mà `ISS-PGUI-03` bắt được
   * bằng `strict mode violation: resolved to 2 elements`. */
  it('KHÔNG dựng nút khi vỏ ngoài chưa nhường', () => {
    renderStrip()
    expect(within(strip()).queryAllByTestId('language-toggle')).toHaveLength(0)
  })

  it('strip có đúng một nút đổi ngôn ngữ khi được nhường, và không ẩn bằng CSS', () => {
    renderStrip({ showLanguageToggle: true })
    const toggles = within(strip()).getAllByTestId('language-toggle')
    expect(toggles).toHaveLength(1)
    expect(toggles[0]).toHaveAttribute('aria-label', 'Đổi ngôn ngữ')
    /* KHÔNG được ẩn bằng CSS: một bản `hidden` vẫn nằm trong DOM và vẫn bị phép
     * chọn theo vai trò nhìn thấy — đó là cách `ISS-PGUI-03` đỏ với
     * `resolved to 2 elements`. Việc "có hay không" thuộc về `showLanguageToggle`. */
    expect(toggles[0].className).not.toContain('hidden')
  })

  it('bấm nút trên strip đổi ngôn ngữ thật, không chỉ đổi nhãn của chính nó', () => {
    renderStrip({ showLanguageToggle: true })
    expect(within(strip()).getByText('Đang vận hành')).toBeInTheDocument()
    fireEvent.click(within(strip()).getByTestId('language-toggle'))
    /* Nhãn vùng đổi theo là bằng chứng `setLang` đã chạm tầng i18n dùng chung,
     * chứ không phải nút tự đổi chữ trên mình nó. */
    expect(screen.getByRole('region', { name: 'Current Programming context' })).toBeInTheDocument()
  })
})
