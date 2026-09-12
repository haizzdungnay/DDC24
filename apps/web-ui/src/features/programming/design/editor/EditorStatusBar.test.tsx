import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../../shared/i18n'
import { EditorStatusBar } from './EditorStatusBar'
import type { EditorStatusField } from './editorStatus'

/* Cấu trúc HTML của thanh trạng thái, khẳng định ở TẦNG COMPONENT.
 *
 * axe bắt hai luật `definition-list` và `only-dlitems`, nhưng cổng axe nằm CUỐI
 * `UJ-PROG-01..08` — một journey dài, nên bất kỳ lỗi nào phía trước cũng làm nó
 * không bao giờ được chạm tới và bản vá cấu trúc đi qua mà không có gì canh.
 * Đúng điều đó đã xảy ra: ở nhánh chỉ có bản vá này, journey vẫn chết sớm ở một
 * lỗi khác nên cổng axe không chạy. Các khẳng định dưới đây mã hoá chính hai
 * luật ấy, chạy trong một giây và không phụ thuộc journey nào.
 */

/* Repo không bật auto-cleanup của RTL (xem `FbdEditorPane.test.tsx`), nên phải
 * dọn tay: nếu không, `getByTestId` ở test thứ hai sẽ thấy cả cây của test
 * trước và đỏ vì "found multiple elements" — một lỗi của harness bị đọc thành
 * lỗi của component. */
/* `I18nProvider` đọc `navigator.language` cho hồ sơ mới (BUG-001), nên không
 * ghim ngôn ngữ thì khẳng định chuỗi tiếng Việt phụ thuộc locale của máy chạy. */
beforeEach(() => { localStorage.setItem('mkddc-lang', 'vi') })
afterEach(() => { cleanup(); localStorage.clear() })

const FIELDS: readonly EditorStatusField[] = [
  { id: 'position', value: '4:9' },
  { id: 'insertMode', value: 'INSERT' },
  { id: 'eol', value: 'LF' },
  { id: 'encoding', value: null }
]

function renderBar(options: { withLeading?: boolean; withGoTo?: boolean } = {}) {
  return render(
    <I18nProvider>
      <EditorStatusBar
        fields={FIELDS}
        leading={options.withLeading ? <span>Sẵn sàng</span> : undefined}
        onGoToPosition={options.withGoTo ? vi.fn() : undefined}
      />
    </I18nProvider>
  )
}

describe('EditorStatusBar — cấu trúc danh sách định nghĩa', () => {
  /** Mọi `dl` trong thanh phải là một cặp `dt`+`dd` và không có con nào khác. */
  function expectValidDefinitionLists(bar: HTMLElement) {
    const lists = [...bar.querySelectorAll('dl')]
    expect(lists.length).toBeGreaterThan(0)
    for (const list of lists) {
      const childTags = [...list.children].map((child) => child.tagName)
      expect(childTags.every((tag) => tag === 'DT' || tag === 'DD')).toBe(true)
      expect(childTags.filter((tag) => tag === 'DT')).toHaveLength(1)
      expect(childTags.filter((tag) => tag === 'DD')).toHaveLength(1)
    }
  }

  it('hộp ngoài KHÔNG phải `dl`, vì nó còn chứa khối `leading` tuỳ ý', () => {
    renderBar({ withLeading: true })
    const bar = screen.getByTestId('editor-status-bar')
    // Dùng `dl` ở đây là tự mời con không hợp lệ vào — đúng lỗi cũ.
    expect(bar.tagName).not.toBe('DL')
    expect(within(bar).getByText('Sẵn sàng')).toBeInTheDocument()
    expectValidDefinitionLists(bar)
  })

  it('giữ cấu trúc hợp lệ cả khi không có `leading`', () => {
    renderBar()
    expectValidDefinitionLists(screen.getByTestId('editor-status-bar'))
  })

  it('nút `Tới dòng…` nằm TRONG `dd`, không bọc ngoài', () => {
    renderBar({ withGoTo: true })
    const bar = screen.getByTestId('editor-status-bar')
    const goTo = within(bar).getByTitle(/Tới dòng…|Go to line…/)
    /* Bọc ngoài là cách `button` trở thành con trực tiếp của nhóm và luật vỡ
       trở lại; khẳng định cả hai chiều để không đạt bằng một nửa. */
    expect(goTo.closest('dd')).not.toBeNull()
    expect(goTo.querySelector('dd')).toBeNull()
    expectValidDefinitionLists(bar)
  })

  it('vẫn công bố `aria-label` và hiện `—` cho giá trị chưa đo được', () => {
    renderBar({ withLeading: true })
    const bar = screen.getByTestId('editor-status-bar')
    expect(bar).toHaveAttribute('aria-label', 'Trạng thái trình soạn thảo')
    expect(within(screen.getByTestId('editor-status-encoding')).getByText('—')).toBeInTheDocument()
  })
})
