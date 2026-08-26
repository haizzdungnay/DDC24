import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../../shared/i18n'
import type { ProgrammingLibraryPage, RemoteState } from '../../model/types'
import { type CatalogEntry } from './libraryCatalog'
import { stCallStatement } from '../editor/stInstanceInsertion'
import { QuickLibraryPanel } from './QuickLibraryPanel'

const preferences = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }))
vi.mock('../../../../shared/api/client', () => ({
  apiClient: {
    getMyPreferences: preferences.get,
    putMyPreferences: preferences.put
  }
}))

function libraryPage(): ProgrammingLibraryPage {
  return {
    items: [
      {
        scope: 'SYSTEM', libraryRevisionId: 'sys-1', libraryVersion: 'rev-a.1', libraryState: 'PUBLISHED',
        entryId: 'LIMIT', kind: 'FUNCTION', name: 'LIMIT', featureState: 'AVAILABLE',
        contentSha256: 'a'.repeat(64),
        interface: JSON.stringify({
          category: 'math', labelVi: 'Giới hạn', labelEn: 'Limit', allowedTypes: ['REAL'],
          ports: [
            { name: 'MN', direction: 'INPUT', dataType: 'REAL' },
            { name: 'IN', direction: 'INPUT', dataType: 'REAL' },
            { name: 'MX', direction: 'INPUT', dataType: 'REAL' },
            { name: 'OUT', direction: 'OUTPUT', dataType: 'REAL' }
          ]
        }),
        dependencies: [], stateLayoutKnown: true, stateSizeBytes: 0
      },
      {
        scope: 'SYSTEM', libraryRevisionId: 'sys-1', libraryVersion: 'rev-a.1', libraryState: 'PUBLISHED',
        entryId: 'PID', kind: 'FUNCTION_BLOCK', name: 'PID', featureState: 'REVIEW_REQUIRED',
        contentSha256: 'b'.repeat(64),
        interface: JSON.stringify({
          category: 'control', labelVi: 'PID', labelEn: 'PID', allowedTypes: [],
          ports: [{ name: 'PV', direction: 'INPUT', dataType: 'REAL' }, { name: 'OUT', direction: 'OUTPUT', dataType: 'REAL' }]
        }),
        dependencies: [], stateLayoutKnown: true, stateSizeBytes: 64
      }
    ]
  }
}

function ready(): RemoteState<ProgrammingLibraryPage> {
  return { status: 'ready', data: libraryPage(), error: null, refresh: vi.fn() }
}

function renderPanel(state: RemoteState<ProgrammingLibraryPage> = ready()) {
  const onInsert = vi.fn<(entry: CatalogEntry) => boolean>().mockReturnValue(true)
  render(
    <I18nProvider>
      <QuickLibraryPanel library={state} language="ST" onInsert={onInsert} onClose={vi.fn()} />
    </I18nProvider>
  )
  return { onInsert }
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('mkddc-lang', 'vi')
  preferences.get.mockReset().mockResolvedValue({})
  preferences.put.mockReset().mockResolvedValue(undefined)
})
afterEach(cleanup)

describe('PGM-02 Quick Library (T59-804)', () => {
  it('chèn FUNCTION bằng đúng lời gọi có tham số của catalog', async () => {
    const { onInsert } = renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Chèn LIMIT' }))
    // Panel trả về ĐÚNG mục catalog; dựng đoạn mã là việc của bề mặt ST.
    const entry = onInsert.mock.calls[0][0]
    expect(entry.entryId).toBe('LIMIT')
    expect(stCallStatement(entry)).toBe('OUT := LIMIT(MN, IN, MX);')
  })

  it('mục chờ review hiện ra nhưng không bấm được, kèm lý do', async () => {
    const { onInsert } = renderPanel()
    const pid = await screen.findByRole('button', { name: 'Chèn PID' })
    expect(pid).toBeDisabled()
    expect(within(pid).getByText('Chờ review sản phẩm')).toBeInTheDocument()
    fireEvent.click(pid)
    expect(onInsert).not.toHaveBeenCalled()
  })

  it('Recent chỉ ghi SAU khi chèn thành công', async () => {
    const onInsert = vi.fn<(entry: CatalogEntry) => boolean>().mockReturnValue(false)
    render(
      <I18nProvider>
        <QuickLibraryPanel library={ready()} language="ST" onInsert={onInsert} onClose={vi.fn()} />
      </I18nProvider>
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Chèn LIMIT' }))
    await waitFor(() => expect(onInsert).toHaveBeenCalled())
    expect(preferences.put).not.toHaveBeenCalled()
  })

  it('Favorites đẩy lên thiết bị bằng MERGE, không xoá khung nhìn của người dùng', async () => {
    preferences.get.mockResolvedValue({ views: { monitor: [{ name: 'Ca đêm', params: {} }] } })
    renderPanel()
    fireEvent.click(await screen.findByTitle('Yêu thích LIMIT'))
    await waitFor(() => expect(preferences.put).toHaveBeenCalled())
    const calls = preferences.put.mock.calls
    const payload = calls[calls.length - 1][0] as Record<string, unknown>
    expect(payload.programmingLibrary).toEqual({ favorites: ['LIMIT'], recent: [] })
    // `views` phải còn nguyên: túi tuỳ chọn dùng chung, PUT toàn bộ sẽ xoá
    // khung nhìn Monitor chỉ vì người dùng vừa bấm một ngôi sao.
    expect(payload.views).toEqual({ monitor: [{ name: 'Ca đêm', params: {} }] })
  })

  it('không đọc được tuỳ chọn thì nói ra thay vì im lặng dùng bản cũ', async () => {
    preferences.get.mockRejectedValue(new Error('offline'))
    renderPanel()
    expect(await screen.findByText(/chỉ nằm trên trình duyệt này/)).toBeInTheDocument()
  })

  it('catalog lỗi thì báo lỗi, không hiện danh sách rỗng như thể không có block', async () => {
    renderPanel({ status: 'error', data: null, error: 'PRG-ERR-UNAVAILABLE-001', refresh: vi.fn() })
    expect(await screen.findByRole('alert')).toHaveTextContent('PRG-ERR-UNAVAILABLE-001')
  })
})

describe('T59-804 — dock dùng chung: bề mặt tự nói mục nào chưa nhận được', () => {
  it('mục bề mặt chưa vẽ được bị chặn kèm lý do CỦA BỀ MẶT, không phải của catalog', async () => {
    const onInsert = vi.fn<(entry: CatalogEntry) => boolean>().mockReturnValue(true)
    render(
      <I18nProvider>
        <QuickLibraryPanel
          library={ready()}
          language="FBD"
          onInsert={onInsert}
          canInsert={(entry) =>
            entry.entryId === 'LIMIT' ? { ok: true } : { ok: false, reason: 'Chưa vẽ được trên canvas' }
          }
          onClose={vi.fn()}
        />
      </I18nProvider>
    )
    // LIMIT: catalog cho phép và bề mặt nhận được.
    fireEvent.click(await screen.findByRole('button', { name: 'Chèn LIMIT' }))
    expect(onInsert).toHaveBeenCalledTimes(1)

    // PID: catalog đã chặn (REVIEW_REQUIRED) nên lý do của catalog thắng.
    const pid = await screen.findByRole('button', { name: 'Chèn PID' })
    expect(pid).toBeDisabled()
    expect(within(pid).getByText('Chờ review sản phẩm')).toBeInTheDocument()
  })

  it('mục catalog dùng được nhưng bề mặt chưa nhận thì hiện lý do của bề mặt', async () => {
    const onInsert = vi.fn<(entry: CatalogEntry) => boolean>().mockReturnValue(true)
    render(
      <I18nProvider>
        <QuickLibraryPanel
          library={ready()}
          language="FBD"
          onInsert={onInsert}
          canInsert={() => ({ ok: false, reason: 'Chưa vẽ được trên canvas' })}
          onClose={vi.fn()}
        />
      </I18nProvider>
    )
    const limit = await screen.findByRole('button', { name: 'Chèn LIMIT' })
    expect(limit).toBeDisabled()
    expect(within(limit).getByText('Chưa vẽ được trên canvas')).toBeInTheDocument()
    fireEvent.click(limit)
    expect(onInsert).not.toHaveBeenCalled()
  })
})
