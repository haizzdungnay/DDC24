import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../shared/i18n'
import { LibraryBlockCard } from './LibraryBlockCard'
import { libraryEntryFixture } from './libraryFixture'
import { blockSignatureLine, categoryLabel, libraryEntryKey, libraryPresentation } from './libraryPresentation'
import { groupLibraryEntries } from '../model/library'
import { catalogEntriesOf } from '../design/library/libraryCatalog'
import { QuickLibraryPanel } from '../design/library/QuickLibraryPanel'
import type { ProgrammingLibraryEntry } from '../model/types'
import type { ProgrammingLibraryPagedState } from '../api/queries'

/**
 * `T61-203` / `ISS-PGM04-06` — PARITY giữa hai bề mặt thư viện.
 *
 * Bộ này đo đúng câu của tiêu chí chấp nhận: *"cùng entry cho cùng text/badge/
 * signature ở PGM-04 và Quick Library"*. Vì vậy mọi test dưới đây bắt đầu từ
 * **một** payload máy chủ và đẩy nó qua **cả hai** đường — dựng hai fixture
 * riêng cho hai vế là cách so hai fixture với nhau, không so hai bề mặt.
 *
 * Bốn chỗ bất đồng ĐO ĐƯỢC trước lát này, và mỗi chỗ có một test ở đây:
 *
 * 1. `category` — PGM-04 đọc trường công khai, Quick Library đọc `signature.category`
 *    và quy cái vắng về `'other'`.
 * 2. Chữ ký — PGM-04 chỉ tin `signature`, Quick Library còn tự parse `interface`.
 * 3. `DEPRECATED` — PGM-04 chặn, Quick Library không biết tới.
 * 4. Định danh — Yêu thích/Gần đây khoá bằng `entryId` trần, trỏ vào một
 *    version tuỳ ý.
 */

const preferences = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }))
vi.mock('../../../shared/api/client', () => ({
  apiClient: { getMyPreferences: preferences.get, putMyPreferences: preferences.put },
}))

function paged(items: ProgrammingLibraryEntry[]): ProgrammingLibraryPagedState {
  return {
    status: 'ready', items, error: null, failure: null,
    loadMoreError: null, loadingMore: false, hasMore: false,
    loadMore: vi.fn(), refresh: vi.fn(),
  }
}

function renderQuickLibrary(items: ProgrammingLibraryEntry[]) {
  render(
    <I18nProvider>
      <QuickLibraryPanel library={paged(items)} language="ST" onInsert={() => true} onClose={vi.fn()} />
    </I18nProvider>,
  )
}

function renderControlLibrary(items: ProgrammingLibraryEntry[]) {
  const [group] = groupLibraryEntries(items)
  render(
    <I18nProvider>
      <LibraryBlockCard
        group={group}
        selected={false}
        usage={{ draftCount: 0 }}
        tabIndex={0}
        onSelect={vi.fn()}
      />
    </I18nProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('mkddc-lang', 'vi')
  preferences.get.mockReset().mockResolvedValue({})
  preferences.put.mockReset().mockResolvedValue(undefined)
})
afterEach(cleanup)

describe('T61-203 — một mô hình trình bày cho PGM-04 và Quick Library', () => {
  it('phân loại đọc từ TRƯỜNG CÔNG KHAI ở cả hai bề mặt, không từ blob chữ ký', () => {
    /* Hai nguồn cố ý lệch nhau. Bản cũ của Quick Library đọc `signature.category`
       nên hiện "Bộ đếm giờ"; PGM-04 đọc `entry.category` nên hiện "Cảm biến".
       Cùng một khối, hai nhóm — và người dùng lọc theo nhóm sẽ không tìm thấy
       nó ở đúng một trong hai màn hình. */
    const items = [libraryEntryFixture({
      category: 'sensor',
      signature: { ...libraryEntryFixture().signature!, category: 'timer' },
    })]
    const projected = catalogEntriesOf(items)[0]
    expect(projected.category).toBe('sensor')
    expect(projected.category).toBe(libraryPresentation(items[0]).category)
  })

  it('chưa phân loại là "chưa phân loại" ở cả hai, KHÔNG phải một nhóm tên "other"', () => {
    const items = [libraryEntryFixture({ category: undefined })]
    expect(catalogEntriesOf(items)[0].category).toBeNull()
    expect(libraryPresentation(items[0]).category).toBeNull()
  })

  it('chữ ký: cùng một payload cho cùng một câu, kể cả khi `interface` thô còn đó', () => {
    /* `interface` cố ý là một chữ ký HỢP LỆ và KHÁC hẳn. Bản cũ của Quick
       Library parse nó ra và vẽ hai chân `A`/`B`, trong khi PGM-04 nói "chưa
       đọc được chữ ký". Chữ ký quyết định người dùng nối dây vào chân nào; hai
       câu trả lời khác nhau ở đây không có cách nào để họ phân xử. */
    const items = [libraryEntryFixture({
      signature: undefined,
      interface: JSON.stringify({
        category: 'timer', ports: [
          { name: 'A', direction: 'INPUT', dataType: 'BOOL' },
          { name: 'B', direction: 'OUTPUT', dataType: 'BOOL' },
        ],
      }),
    })]
    const projected = catalogEntriesOf(items)[0]
    expect(projected.ports).toEqual([])
    expect(projected.usability).toEqual({ kind: 'SIGNATURE_UNAVAILABLE' })
    expect(projected.signature).toEqual(blockSignatureLine(items[0]))
    expect(blockSignatureLine(items[0])).toEqual({ kind: 'unavailable' })
  })

  it('khối đã NGỪNG SỬ DỤNG bị chặn ở cả hai, không chỉ ở PGM-04', () => {
    const items = [libraryEntryFixture({ libraryState: 'DEPRECATED', name: 'TON' })]
    expect(catalogEntriesOf(items)[0].usability).toEqual({ kind: 'DEPRECATED' })

    renderQuickLibrary(items)
    // Nút Chèn của Quick Library phải khoá, và nói ra ĐÚNG lý do.
    const insert = screen.getByRole('button', { name: 'Chèn TON' })
    expect(insert).toBeDisabled()
    expect(within(screen.getByTestId('quick-library-card')).getByText('Ngừng sử dụng')).toBeInTheDocument()

    cleanup()
    renderControlLibrary(items)
    expect(within(screen.getByTestId('library-block-card')).getByText('Ngừng sử dụng')).toBeInTheDocument()
  })

  it('cùng một chữ ký hiện ở cả hai: PGM-04 một dòng, Quick Library sơ đồ chân', () => {
    const items = [libraryEntryFixture()]
    const line = blockSignatureLine(items[0])
    expect(line).toEqual({ kind: 'ready', text: 'TON(IN: BOOL, PT: TIME) → Q: BOOL' })

    renderControlLibrary(items)
    expect(screen.getByText('TON(IN: BOOL, PT: TIME) → Q: BOOL')).toBeInTheDocument()

    cleanup()
    renderQuickLibrary(items)
    // Cùng ba chân, cùng thứ tự — dựng từ cùng `signature.ports`.
    const card = within(screen.getByTestId('quick-library-card'))
    expect(card.getByText('→ IN')).toBeInTheDocument()
    expect(card.getByText('→ PT')).toBeInTheDocument()
    expect(card.getByText('Q →')).toBeInTheDocument()
  })

  it('nhãn MỞ RỘNG hiện ở cả hai màn CHỌN khối, không chỉ ở Quick Library', () => {
    const items = [libraryEntryFixture({ entryId: 'PID', name: 'PID' })]
    renderQuickLibrary(items)
    expect(screen.getByTestId('library-extension-badge')).toBeInTheDocument()
    cleanup()
    renderControlLibrary(items)
    expect(screen.getByTestId('library-extension-badge')).toBeInTheDocument()
  })

  it('nhãn nhóm dịch qua CÙNG bảng registry, không qua hai bảng viết tay', () => {
    const vi = (viText: string) => viText
    expect(categoryLabel('timer', (viText, _en) => vi(viText))).not.toBe('timer')
    // Nhóm registry không biết tới hiện ra dưới dạng MÃ THÔ — xấu nhưng trung
    // thực, và tốt hơn nhiều so với rơi vào một nhóm "khác" tự nghĩ ra.
    expect(categoryLabel('nhóm-không-có-thật', (viText) => viText)).toBe('nhóm-không-có-thật')
  })
})

describe('T61-203 — định danh Yêu thích/Gần đây', () => {
  it('khoá mang scope và KHÔNG mang version', () => {
    const key = libraryEntryKey(libraryEntryFixture({ libraryVersion: '9.9.9' }))
    expect(key).toBe('SYSTEM/TON')
    // Khoá theo version nghĩa là mỗi lần Seal Revision là một lần người dùng
    // mất sạch Yêu thích.
    expect(key).not.toContain('9.9.9')
  })

  it('cùng entryId ở hai scope là hai khoá khác nhau', () => {
    expect(libraryEntryKey({ scope: 'SYSTEM', entryId: 'TON' }))
      .not.toBe(libraryEntryKey({ scope: 'PROJECT', entryId: 'TON' }))
  })

  it('khoá phân giải về version HIỆN HÀNH, không về bản DEPRECATED gặp sau cùng', () => {
    /* Đường thật: một khối đã publish `1.0.0`, rồi bản ấy bị deprecate và
       `1.1.0` ra đời. `GET /libraries` trả CẢ HAI. Bản cũ dựng `Map` khoá bằng
       `entryId` trần nên giữ lại hàng GẶP SAU CÙNG — ở đây là bản đã ngừng sử
       dụng — và ngôi sao của người dùng trỏ vào đó. */
    const items = [
      libraryEntryFixture({ entryId: 'AHU', name: 'AHU', libraryVersion: '1.1.0', libraryRevisionId: 'r2' }),
      libraryEntryFixture({
        entryId: 'AHU', name: 'AHU', libraryVersion: '1.0.0',
        libraryRevisionId: 'r1', libraryState: 'DEPRECATED',
      }),
    ]
    const projected = catalogEntriesOf(items)
    // Một khối = MỘT thẻ, không phải một thẻ cho mỗi revision.
    expect(projected).toHaveLength(1)
    expect(projected[0].libraryVersion).toBe('1.1.0')
    expect(projected[0].libraryState).toBe('PUBLISHED')
    expect(projected[0].key).toBe('SYSTEM/AHU')
  })

  it('Yêu thích lưu theo khoá cũ (entryId trần) vẫn phân giải được', () => {
    // Nâng cấp không được bắt người dùng gắn sao lại từ đầu vì một chuyện họ
    // không gây ra.
    localStorage.setItem('mkddc-programming-library', JSON.stringify({ favorites: ['TON'], recent: [] }))
    renderQuickLibrary([libraryEntryFixture()])
    const favorites = screen.getByRole('list', { name: 'Yêu thích' })
    expect(within(favorites).getByText('TON')).toBeInTheDocument()
  })
})
