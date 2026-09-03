import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '../../../../shared/i18n'
import { SourceEditor } from './ProgramsTab'
import type { CatalogEntry } from '../library/libraryCatalog'
import type { ProgrammingProgram } from '../../model/types'

/**
 * `T59-820` / `TC-PGM02-HOV-02` — hover ở lớp component.
 *
 * jsdom không có layout thật nên `getBoundingClientRect` trả 0 ở mọi phần tử.
 * Đó KHÔNG phải một bất tiện của test mà là chính ca biên quan trọng nhất của
 * tính năng này: không đo được bề rộng ký tự thì tuyệt đối không được hover,
 * vì tooltip sẽ chỉ vào một ký hiệu khác thứ chuột đang trỏ. Vì vậy ca đầu
 * kiểm đúng trạng thái "không đo được", rồi các ca sau mới giả lập phép đo.
 */

const SOURCE = [
  'PROGRAM Main',
  'VAR',
  '  Fan : BOOL;',
  '  Timer1 : TON;',
  'END_VAR',
  'Fan := TRUE;',
  'END_PROGRAM',
].join('\n')

const CHAR_WIDTH = 8
const ROW_HEIGHT = 20
const PAD_TOP = 12
const PAD_LEFT = 12

const tonEntry: CatalogEntry = {
  name: 'TON', kind: 'FUNCTION_BLOCK', category: 'Timers', scope: 'SYSTEM',
  stateful: true, languages: ['ST', 'FBD'],
  usability: { kind: 'USABLE' }, iecClassification: 'IEC_STANDARD',
  ports: [
    { name: 'IN', direction: 'INPUT', dataType: 'BOOL' },
    { name: 'PT', direction: 'INPUT', dataType: 'TIME' },
    { name: 'Q', direction: 'OUTPUT', dataType: 'BOOL' },
  ],
} as unknown as CatalogEntry

function program(document: string): ProgrammingProgram {
  return { programId: 'program-1', name: 'AHU', kind: 'PROGRAM', language: 'ST', document }
}

function renderEditor(options?: { catalog?: readonly CatalogEntry[]; onEnsureLibraryLoaded?: () => void }) {
  return render(
    <I18nProvider>
      <SourceEditor
        program={program(SOURCE)}
        source={SOURCE}
        canEdit
        saving={false}
        diagnostics={[]}
        focusDiagnostic={null}
        onChange={vi.fn()}
        onSave={vi.fn().mockResolvedValue(true)}
        pointCatalogStatus="idle"
        pointCatalogItems={[]}
        pointCatalogError={null}
        onEnsurePointCatalogLoaded={vi.fn()}
        libraryEntries={options?.catalog}
        onEnsureLibraryLoaded={options?.onEnsureLibraryLoaded}
      />
    </I18nProvider>,
  )
}

/** Giả lập phép đo: mẫu đo trả bề rộng thật, textarea trả gốc toạ độ. */
function stubLayout() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const isSample = this.getAttribute('aria-hidden') === 'true'
    const width = isSample ? CHAR_WIDTH * (this.textContent?.length ?? 0) : 600
    return { width, height: 400, top: 0, left: 0, right: width, bottom: 400, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  })
}

/** Rê chuột tới giữa ô ký tự thứ `column` của dòng `row` (đếm từ 0). */
function hoverAt(row: number, column: number) {
  const textarea = screen.getByRole('textbox')
  fireEvent.mouseMove(textarea, {
    clientX: PAD_LEFT + column * CHAR_WIDTH + CHAR_WIDTH / 2,
    clientY: PAD_TOP + row * ROW_HEIGHT + ROW_HEIGHT / 2,
  })
  return textarea
}

beforeEach(() => { localStorage.setItem('mkddc-lang', 'vi') })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('hover ST — không đo được thì không hover', () => {
  it('bề rộng ký tự chưa đo được ⇒ tuyệt đối không hiện tooltip', () => {
    // Không stub layout: mọi rect là 0, đúng như trước lần layout đầu tiên.
    renderEditor()
    hoverAt(2, 3)
    expect(screen.queryByTestId('st-hover-card')).toBeNull()
  })
})

describe('hover ST — nội dung dựng từ đúng nguồn Inspector dùng', () => {
  it('biến khai báo ⇒ hiện tên và kiểu tra được', () => {
    stubLayout()
    renderEditor()
    hoverAt(2, 3)
    const card = screen.getByTestId('st-hover-card')
    expect(card).toHaveTextContent('Fan')
    expect(screen.getByTestId('st-hover-type')).toHaveTextContent('BOOL')
  })

  it('instance khối ⇒ chữ ký chuẩn hoá lấy từ catalog thư viện', () => {
    stubLayout()
    renderEditor({ catalog: [tonEntry] })
    hoverAt(3, 4)
    expect(screen.getByTestId('st-hover-signature')).toHaveTextContent('TON(IN BOOL, PT TIME) → Q BOOL')
  })

  it('thư viện chưa nạp ⇒ KHÔNG bịa chữ ký, và yêu cầu nạp đúng một nguồn', () => {
    stubLayout()
    const onEnsureLibraryLoaded = vi.fn()
    renderEditor({ onEnsureLibraryLoaded })
    hoverAt(3, 4)
    expect(screen.queryByTestId('st-hover-signature')).toBeNull()
    expect(onEnsureLibraryLoaded).toHaveBeenCalled()
  })

  it('định danh không tra được ⇒ nói "không xác định được" kèm giới hạn thẩm quyền', () => {
    stubLayout()
    render(
      <I18nProvider>
        <SourceEditor
          program={program('Ghost := 1;')}
          source="Ghost := 1;"
          canEdit
          saving={false}
          diagnostics={[]}
          focusDiagnostic={null}
          onChange={vi.fn()}
          onSave={vi.fn().mockResolvedValue(true)}
          pointCatalogStatus="idle"
          pointCatalogItems={[]}
          pointCatalogError={null}
          onEnsurePointCatalogLoaded={vi.fn()}
        />
      </I18nProvider>,
    )
    fireEvent.mouseMove(screen.getByRole('textbox'), {
      clientX: PAD_LEFT + CHAR_WIDTH, clientY: PAD_TOP + ROW_HEIGHT / 2,
    })
    expect(screen.getByTestId('st-hover-type')).toHaveTextContent('không xác định được')
    // Giới hạn thẩm quyền phải nói ra: chỉ mục dựng từ nguồn đang gõ, và
    // "không tra được" KHÔNG có nghĩa nguồn sai.
    expect(screen.getByTestId('st-hover-card')).toHaveTextContent('không phải từ compiler')
  })

  it('từ khoá và khoảng trắng cuối dòng đều im lặng', () => {
    stubLayout()
    renderEditor()
    hoverAt(1, 1)
    expect(screen.queryByTestId('st-hover-card')).toBeNull()
    hoverAt(2, 200)
    expect(screen.queryByTestId('st-hover-card')).toBeNull()
  })

  it('rời vùng chữ ⇒ tooltip tắt', () => {
    stubLayout()
    renderEditor()
    hoverAt(2, 3)
    expect(screen.getByTestId('st-hover-card')).toBeInTheDocument()
    fireEvent.mouseLeave(screen.getByRole('textbox'))
    expect(screen.queryByTestId('st-hover-card')).toBeNull()
  })
})
