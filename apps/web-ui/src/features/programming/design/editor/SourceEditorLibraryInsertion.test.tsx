import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '../../../../shared/i18n'
import type { ProgrammingLibraryPage, ProgrammingProgram } from '../../model/types'
import { SourceEditor } from './ProgramsTab'
import { QuickLibraryHost } from '../library/QuickLibraryPanel'
import type { CatalogEntry } from '../library/libraryCatalog'

const preferences = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }))
vi.mock('../../../../shared/api/client', () => ({
  apiClient: { getMyPreferences: preferences.get, putMyPreferences: preferences.put },
}))

function libraryPage(): ProgrammingLibraryPage {
  return {
    items: [
      {
        scope: 'SYSTEM', libraryRevisionId: 'sys-1', libraryVersion: 'rev-a.1', libraryState: 'PUBLISHED',
        entryId: 'TON', kind: 'FUNCTION_BLOCK', name: 'TON', featureState: 'AVAILABLE',
        contentSha256: 'a'.repeat(64),
        interface: JSON.stringify({
          category: 'timer', labelVi: 'Trễ bật', labelEn: 'On delay', allowedTypes: [],
          ports: [
            { name: 'IN', direction: 'INPUT', dataType: 'BOOL' },
            { name: 'PT', direction: 'INPUT', dataType: 'TIME' },
            { name: 'Q', direction: 'OUTPUT', dataType: 'BOOL' },
          ],
        }),
        dependencies: [], stateLayoutKnown: true, stateSizeBytes: 16,
      },
    ],
  }
}

vi.mock('../../api/queries', () => ({
  useLazyProgrammingPointCatalog: () => ({ status: 'idle', items: [], error: null, ensureLoaded: vi.fn() }),
  useProgrammingLibrary: () => ({ status: 'ready', data: libraryPage(), error: null, refresh: vi.fn() }),
}))

function program(document: string): ProgrammingProgram {
  return { programId: 'program-1', name: 'AHU_FanControl', kind: 'PROGRAM', language: 'ST', document }
}

/** Editor có state thật để `source` đi theo `onChange` — chèn thư viện đổi
 *  toàn bộ buffer, nên một editor "controlled giả" sẽ không phản ánh gì.
 *
 *  `DEV-PROG-002` — Thư viện nhanh nay sống ở CỘT PHẢI (`ProgramsTab`), không
 *  trong trình soạn thảo, và chèn đi bằng yêu cầu có `nonce`. Harness dựng lại
 *  ĐÚNG cách nối đó thay vì gọi thẳng hàm chèn: bộ test này tồn tại để khoá
 *  đường đi thật từ lúc bấm một khối tới lúc buffer đổi, nên tắt đoạn giữa sẽ
 *  bỏ qua chính chỗ dễ hỏng. */
function renderEditor(initial: string) {
  function Harness() {
    const [source, setSource] = useState(initial)
    const [libraryOpen, setLibraryOpen] = useState(false)
    const [request, setRequest] = useState<{ entry: CatalogEntry; nonce: number } | null>(null)
    return (
      <>
        <SourceEditor
          program={program(initial)}
          source={source}
          canEdit
          saving={false}
          diagnostics={[]}
          focusDiagnostic={null}
          onChange={setSource}
          onSave={vi.fn().mockResolvedValue(true)}
          pointCatalogStatus="idle"
          pointCatalogItems={[]}
          pointCatalogError={null}
          onEnsurePointCatalogLoaded={vi.fn()}
          libraryOpen={libraryOpen}
          onToggleLibrary={() => setLibraryOpen((open) => !open)}
          libraryInsertRequest={request}
        />
        {libraryOpen && (
          <QuickLibraryHost
            variant="docked"
            language="ST"
            onInsert={(entry) => {
              setRequest((current) => ({ entry, nonce: (current?.nonce ?? 0) + 1 }))
              return true
            }}
            onClose={() => setLibraryOpen(false)}
          />
        )}
      </>
    )
  }
  render(<I18nProvider><Harness /></I18nProvider>)
  return { textarea: screen.getByLabelText(/Mã nguồn ST/) as HTMLTextAreaElement }
}

async function openLibrary() {
  fireEvent.click(screen.getByRole('button', { name: /Thư viện/ }))
  // `DEV-PROG-002` — Thư viện nhanh trong trình soạn thảo ST nay là panel CẮM
  // (`role="region"`), không còn là hộp thoại nổi phủ lên mã nguồn. Khai
  // `dialog` cho một vùng không chặn phần còn lại là nói sai với trình đọc màn
  // hình, nên vai trò đổi theo bố cục.
  return waitFor(() => screen.getByRole('region', { name: 'Thư viện nhanh' }))
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('mkddc-lang', 'vi')
  preferences.get.mockReset().mockResolvedValue({})
  preferences.put.mockReset().mockResolvedValue(undefined)
})
afterEach(cleanup)

/*
 * `AC-ST-002` — "inserting stateful FB can create/select instance without
 * manual declaration memorization".
 *
 * Lỗi thật bộ test này khoá: bản chèn trước đây sinh nguyên một khối
 * `VAR ... END_VAR` NGAY TẠI CON TRỎ. Grammar ST §10 và parser thật
 * (`parse_pou()` đọc hết var block RỒI mới đọc statement list) đều không nhận
 * dạng đó, nên mỗi lần chèn một FB có trạng thái là một lần Check chắc chắn đỏ.
 */
describe('SourceEditor — chèn FB có trạng thái từ Quick Library (T59-805 / AC-ST-002)', () => {
  it('khai báo instance vào khối VAR, lời gọi vào thân, KHÔNG sinh VAR giữa thân', async () => {
    const { textarea } = renderEditor('PROGRAM P\nVAR\n  A : INT;\nEND_VAR\nA := 1;\nEND_PROGRAM\n')
    textarea.setSelectionRange(textarea.value.indexOf('A := 1;') + 7, textarea.value.indexOf('A := 1;') + 7)

    const panel = await openLibrary()
    fireEvent.click(await within(panel).findByRole('button', { name: 'Chèn TON' }))

    await waitFor(() => expect(textarea.value).toContain('TON_1(IN := IN, PT := PT);'))
    expect(textarea.value).toContain('  A : INT;\n  TON_1 : TON;\nEND_VAR')
    expect(textarea.value.match(/END_VAR/g)).toHaveLength(1)
    expect(textarea.value.indexOf('TON_1 : TON;')).toBeLessThan(textarea.value.indexOf('END_VAR'))
    expect(textarea.value.indexOf('TON_1(IN')).toBeGreaterThan(textarea.value.indexOf('END_VAR'))
  })

  it('nói ra dòng khai báo vừa thêm, vì nó nằm ngoài tầm nhìn của con trỏ', async () => {
    renderEditor('PROGRAM P\nVAR\n  A : INT;\nEND_VAR\nA := 1;\nEND_PROGRAM\n')
    const panel = await openLibrary()
    fireEvent.click(await within(panel).findByRole('button', { name: 'Chèn TON' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Đã khai TON_1 : TON trong khối VAR.'))
  })

  it('chèn cả khai báo lẫn lời gọi là MỘT bước hoàn tác (AC-ST-003)', async () => {
    const before = 'PROGRAM P\nVAR\n  A : INT;\nEND_VAR\nA := 1;\nEND_PROGRAM\n'
    const { textarea } = renderEditor(before)
    const panel = await openLibrary()
    fireEvent.click(await within(panel).findByRole('button', { name: 'Chèn TON' }))
    await waitFor(() => expect(textarea.value).toContain('TON_1 : TON;'))

    fireEvent.click(screen.getByRole('button', { name: /Hoàn tác/ }))
    await waitFor(() => expect(textarea.value).toBe(before))
  })

  it('đã có instance cùng kiểu thì HỎI, không tự dùng lại cũng không tự tạo mới', async () => {
    const { textarea } = renderEditor('PROGRAM P\nVAR\n  FanDelay : TON;\nEND_VAR\nA := 1;\nEND_PROGRAM\n')
    const panel = await openLibrary()
    fireEvent.click(await within(panel).findByRole('button', { name: 'Chèn TON' }))

    const chooser = await screen.findByRole('dialog', { name: /Chọn instance cho TON/ })
    // chưa chèn gì cả — chờ người dùng quyết
    expect(textarea.value).not.toContain('TON_1')
    expect(textarea.value.match(/TON/g)).toHaveLength(1)

    fireEvent.click(within(chooser).getByRole('button', { name: 'FanDelay' }))
    await waitFor(() => expect(textarea.value).toContain('FanDelay(IN := IN, PT := PT);'))
    // dùng lại instance có sẵn thì KHÔNG sinh thêm khai báo
    expect(textarea.value.match(/FanDelay : TON;/g)).toHaveLength(1)
    expect(textarea.value).not.toContain('TON_1')
  })

  it('chọn "Tạo mới" thì đặt tên không đụng instance đang có', async () => {
    const { textarea } = renderEditor('PROGRAM P\nVAR\n  TON_1 : TON;\nEND_VAR\nA := 1;\nEND_PROGRAM\n')
    const panel = await openLibrary()
    fireEvent.click(await within(panel).findByRole('button', { name: 'Chèn TON' }))

    const chooser = await screen.findByRole('dialog', { name: /Chọn instance cho TON/ })
    fireEvent.click(within(chooser).getByRole('button', { name: 'Tạo mới TON_2' }))

    await waitFor(() => expect(textarea.value).toContain('TON_2(IN := IN, PT := PT);'))
    expect(textarea.value).toContain('  TON_1 : TON;\n  TON_2 : TON;\nEND_VAR')
  })
})
