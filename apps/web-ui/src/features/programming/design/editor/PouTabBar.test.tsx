import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '../../../../shared/i18n'
import { PouTabBar } from './PouTabBar'
import { EditorStatusBar } from './EditorStatusBar'
import { fbdStatusFields, stStatusFields } from './editorStatus'
import type { PouTabsState } from './pouTabs'

/**
 * `T59-821` / `TC-PGM02-TAB-01` + `TC-PGM02-SB-01` — lớp hiển thị.
 *
 * Mô hình đã có test riêng; ở đây khoá những điều chỉ nhìn thấy được trên DOM:
 * ngôn ngữ phải đọc được bằng CHỮ (màu không bao giờ là tín hiệu duy nhất), tab
 * trỏ tới POU đã bị xoá phải tự khai, và `null` phải hiện `—`.
 */

const state: PouTabsState = {
  tabs: [
    { key: 'obj-st', lastKnownName: 'AHU_Main', language: 'ST' },
    { key: 'obj-fbd', lastKnownName: 'AHU_FBD', language: 'FBD' },
  ],
  activeKey: 'obj-st',
  recentKeys: ['obj-st', 'obj-fbd'],
}

function renderBar(overrides: Partial<Parameters<typeof PouTabBar>[0]> = {}) {
  const props: Parameters<typeof PouTabBar>[0] = {
    state,
    missingKeys: new Set<string>(),
    dirtyKeys: new Set<string>(),
    onActivate: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
  render(<I18nProvider><PouTabBar {...props} /></I18nProvider>)
  return props
}

beforeEach(() => { localStorage.setItem('mkddc-lang', 'vi') })
afterEach(cleanup)

describe('thanh tab — bắc qua ST và FBD', () => {
  it('hiện cả hai POU, ngôn ngữ ghi bằng CHỮ chứ không chỉ bằng màu', () => {
    renderBar()
    const tabs = screen.getAllByTestId('pou-tab')
    expect(tabs).toHaveLength(2)
    expect(tabs[0]).toHaveTextContent('ST')
    expect(tabs[1]).toHaveTextContent('FBD')
  })

  it('tab đang mở được đánh dấu cho trình đọc màn hình', () => {
    renderBar()
    /* Cố ý KHÔNG dùng `role="tab"`: role đó là một hợp đồng đòi `tabpanel` và
       điều hướng bằng phím mũi tên, mà markup này không giữ (không có panel
       được gắn nhãn, và mỗi tab còn mang một nút Đóng lồng bên trong). Khai
       `tablist` mà không giữ hợp đồng chính là lỗi `aria-required-children`
       axe bắt được. `aria-current` mô tả đúng thứ đang có. */
    const tabs = screen.getAllByTestId('pou-tab')
    expect(within(tabs[0]).getAllByRole('button')[0]).toHaveAttribute('aria-current', 'true')
    expect(within(tabs[1]).getAllByRole('button')[0]).not.toHaveAttribute('aria-current')
  })

  it('bấm một tab phát ra ĐÚNG key của nó, không phải tên', () => {
    const props = renderBar()
    fireEvent.click(within(screen.getAllByTestId('pou-tab')[1]).getAllByRole('button')[0])
    expect(props.onActivate).toHaveBeenCalledWith('obj-fbd')
  })

  it('tab bẩn có dấu hiệu đọc được, không chỉ là một chấm màu', () => {
    renderBar({ dirtyKeys: new Set(['obj-st']) })
    expect(screen.getAllByTestId('pou-tab')[0]).toHaveTextContent('Có thay đổi chưa lưu')
  })

  it('POU bị xoá ở phiên khác: tab Ở LẠI và tự khai', () => {
    renderBar({ missingKeys: new Set(['obj-fbd']) })
    const tabs = screen.getAllByTestId('pou-tab')
    // Tự đóng sẽ che đi chính sự kiện người dùng cần biết.
    expect(tabs).toHaveLength(2)
    expect(tabs[1]).toHaveTextContent('(đã bị xoá)')
  })

  it('chạm trần thì nút mở thêm khoá KÈM LÝ DO, không phải nút chết', () => {
    renderBar({ onOpenPicker: vi.fn(), limitNotice: 'Đã mở tối đa 8 POU và tất cả đều có thay đổi chưa lưu.' })
    expect(screen.getByTestId('pou-tab-add')).toBeDisabled()
    expect(screen.getByTestId('pou-tab-add')).toHaveAttribute('title', expect.stringContaining('tối đa 8'))
    expect(screen.getByTestId('pou-tab-limit')).toBeInTheDocument()
  })
})

describe('thanh trạng thái — null hiện "—", cấm mặc định UTF-8/LF', () => {
  it('bảng mã và chế độ chèn chưa đọc được ⇒ "—"', () => {
    render(
      <I18nProvider>
        <EditorStatusBar fields={stStatusFields({ line: 4, column: 9, source: 'a\nb', dirty: true })} />
      </I18nProvider>,
    )
    expect(screen.getByTestId('editor-status-encoding')).toHaveTextContent('—')
    expect(screen.getByTestId('editor-status-insertMode')).toHaveTextContent('—')
    // EOL thì SUY RA ĐƯỢC từ buffer nên nó là giá trị đọc, không phải đoán.
    expect(screen.getByTestId('editor-status-eol')).toHaveTextContent('LF')
    expect(screen.getByTestId('editor-status-position')).toHaveTextContent('4:9')
    expect(screen.getByTestId('editor-status-dirty')).toHaveTextContent('Chưa lưu')
  })

  it('FBD: zoom và kết nối chưa đọc được ⇒ "—", không phải 100% hay Mất kết nối', () => {
    render(
      <I18nProvider>
        <EditorStatusBar fields={fbdStatusFields({ language: 'FBD', dirty: false })} />
      </I18nProvider>,
    )
    expect(screen.getByTestId('editor-status-zoom')).toHaveTextContent('—')
    // Báo "Mất kết nối" cho một thiết bị đang khoẻ là gọi người trực đêm dậy vì
    // một giá trị FE tự bịa.
    expect(screen.getByTestId('editor-status-connection')).toHaveTextContent('—')
    expect(screen.getByTestId('editor-status-language')).toHaveTextContent('FBD')
  })
})
