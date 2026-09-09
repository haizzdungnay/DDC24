import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../../shared/i18n'
import type { ProgrammingDraftOperation, ProgrammingProgram } from '../../model/types'
import { FbdEditorPane, parseFbdDocument } from './FbdEditorPane'
import { canonicalFbdJson, type FbdDocument } from '../../fbd/model'
import { emptyFbdDocument } from '../pou/pouTemplates'

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
})

describe('parseFbdDocument', () => {
  it('trả về FbdDocument hợp lệ khi JSON chuẩn cú pháp', () => {
    const doc = emptyFbdDocument('TestPOU')
    const json = JSON.stringify(doc)
    const parsed = parseFbdDocument(json, 'FallbackPOU')
    expect(parsed.name).toBe('TestPOU')
    expect(parsed.schemaVersion).toBe(doc.schemaVersion)
  })

  it('trả về emptyFbdDocument với fallbackName khi chuỗi không phải JSON', () => {
    const parsed = parseFbdDocument('{invalid-json', 'FallbackPOU')
    expect(parsed.name).toBe('FallbackPOU')
    expect(parsed.networks).toHaveLength(1)
    expect(parsed.networks[0].nodes).toEqual([])
  })

  it('trả về emptyFbdDocument khi đầu vào rỗng hoặc không phải string', () => {
    const parsedEmpty = parseFbdDocument('', 'FallbackEmpty')
    expect(parsedEmpty.name).toBe('FallbackEmpty')

    const parsedNull = parseFbdDocument(null, 'FallbackNull')
    expect(parsedNull.name).toBe('FallbackNull')

    const parsedNumber = parseFbdDocument(12345, 'FallbackNum')
    expect(parsedNumber.name).toBe('FallbackNum')
  })
})

describe('FbdEditorPane', () => {
  const sampleDoc = emptyFbdDocument('FBD_Sample')
  const sampleProgram: ProgrammingProgram = {
    programId: 'fbd-prog-1',
    name: 'FBD_Sample',
    kind: 'PROGRAM',
    language: 'FBD',
    document: canonicalFbdJson(sampleDoc),
  }

  function renderPane(props?: {
    program?: ProgrammingProgram
    source?: string
    canEdit?: boolean
    saving?: boolean
    onChange?: (source: string) => void
    onSave?: (ops: ProgrammingDraftOperation[]) => Promise<boolean>
    onRunCheck?: () => void
    onOpenCompare?: () => void
    checkDisabledReason?: string | null
    compareDisabledReason?: string | null
  }) {
    const onSave = props?.onSave ?? vi.fn().mockResolvedValue(true)
    const onChange = props?.onChange ?? vi.fn()
    const onRunCheck = props?.onRunCheck ?? vi.fn()
    const onOpenCompare = props?.onOpenCompare ?? vi.fn()

    const rendered = render(
      <I18nProvider>
        <FbdEditorPane
          program={props?.program ?? sampleProgram}
          source={props?.source ?? (typeof sampleProgram.document === 'string' ? sampleProgram.document : JSON.stringify(sampleProgram.document))}
          canEdit={props?.canEdit ?? true}
          saving={props?.saving ?? false}
          onChange={onChange}
          onSave={onSave}
          userPouInterfaces={[]}
          onRunCheck={onRunCheck}
          onOpenCompare={onOpenCompare}
          checkDisabledReason={props?.checkDisabledReason}
          compareDisabledReason={props?.compareDisabledReason}
        />
      </I18nProvider>,
    )

    return {
      ...rendered,
      onSave,
      onChange,
      onRunCheck,
      onOpenCompare,
    }
  }

  it('TC-FBD-HEADER-001: shell chỉ giữ lệnh canvas, không lặp Lưu/Kiểm tra/So sánh của header chung', () => {
    renderPane()
    expect(screen.getByRole('heading', { level: 3, name: 'FBD_Sample' })).toBeInTheDocument()
    const toolbar = screen.getByRole('toolbar', { name: /Lệnh FBD|FBD commands/ })
    expect(within(toolbar).queryByRole('button', { name: /Lưu|Save|Kiểm tra|Check|So sánh|Compare|Làm mới|Refresh/ })).toBeNull()
    expect(screen.getByTestId('editor-status-bar')).toBeInTheDocument()
  })

  function twoNetworkDocument(): FbdDocument {
    return {
      ...sampleDoc,
      networks: [
        ...sampleDoc.networks,
        { id: '20000000-0000-4000-8000-000000000002', name: 'network_2', order: 1, nodes: [], wires: [] },
      ],
    }
  }

  it('TC-FBD-RESP-001: shell có min-width guard và lớp 4 cột nội bộ tại 1440 px', () => {
    renderPane()
    expect(screen.getByTestId('fbd-workspace-shell')).toHaveClass('min-w-0', 'overflow-x-hidden')
    const grid = screen.getByRole('region', { name: /Bộ dựng FBD|Structured FBD editor/ }).children[1]
    expect(grid).toHaveClass('min-[1440px]:grid-cols-[minmax(0,1fr)_18rem]')
    expect(screen.getByRole('button', { name: /Chọn vùng|Marquee select/ })).toHaveClass('md:inline-flex', 'lg:hidden')
  })

  it('TC-FBD-RESP-002: nút Chọn vùng cho tablet đổi mode mà chưa phát mutation', () => {
    const { onChange } = renderPane()
    const marquee = screen.getByRole('button', { name: /Chọn vùng|Marquee select/ })
    expect(marquee).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(marquee)
    expect(marquee).toHaveAttribute('aria-pressed', 'true')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('TC-FBD-NET-001: selected chỉ render network active; ALL render đủ network có data-fbd-network-id', () => {
    const document = twoNetworkDocument()
    renderPane({ program: { ...sampleProgram, document: canonicalFbdJson(document) }, source: canonicalFbdJson(document) })
    expect(screen.getAllByRole('article')).toHaveLength(1)
    fireEvent.change(screen.getByLabelText(/Khung nhìn|View/), { target: { value: 'ALL' } })
    const articles = screen.getAllByRole('article')
    expect(articles).toHaveLength(2)
    expect(articles.map((article) => article.getAttribute('data-fbd-network-id'))).toEqual(document.networks.map((network) => network.id))
  })

  it('TC-FBD-NET-002: đổi network active cập nhật scene và nhãn toolbar', () => {
    const document = twoNetworkDocument()
    renderPane({ program: { ...sampleProgram, document: canonicalFbdJson(document) }, source: canonicalFbdJson(document) })
    fireEvent.change(screen.getByLabelText(/Network hoạt động|Active network/), { target: { value: document.networks[1].id } })
    expect(screen.getByTestId('fbd-active-network')).toHaveTextContent('network_2')
    expect(screen.getByRole('article')).toHaveAttribute('data-fbd-network-id', document.networks[1].id)
  })

  it('TC-FBD-PREF-001: theme/grid/network view lưu cục bộ mà không đổi canonical buffer', () => {
    const { onChange } = renderPane()
    const before = canonicalFbdJson(sampleDoc)
    fireEvent.change(screen.getByLabelText(/Giao diện FBD|FBD theme/), { target: { value: 'DARK' } })
    fireEvent.click(screen.getByLabelText(/Lưới|Grid/))
    fireEvent.change(screen.getByLabelText(/Khung nhìn|View/), { target: { value: 'ALL' } })
    expect(screen.getByTestId('fbd-workspace-shell')).toHaveAttribute('data-fbd-theme', 'DARK')
    expect(screen.getByTestId('fbd-workspace-shell').style.getPropertyValue('--c-bg')).not.toBe('')
    expect(onChange).not.toHaveBeenCalled()
    expect(canonicalFbdJson(sampleDoc)).toBe(before)
    expect(window.localStorage.getItem('mkddc:fbd-preferences:v1:global:default')).toContain('"theme":"DARK"')
  })

  it('TC-FBD-STATE-004: viewer không phát mutation từ shortcut hoặc palette', () => {
    const { onChange } = renderPane({ canEdit: false })
    const editor = screen.getByRole('region', { name: /Bộ dựng FBD|Structured FBD editor/ })
    expect(screen.getByRole('button', { name: /Thêm khối|Add block/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Chọn vùng|Marquee select/ })).toBeDisabled()
    fireEvent.keyDown(editor, { key: 'Insert' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('dirty vẫn được công bố để header chung khoá Check theo pending operations', () => {
    renderPane({ source: canonicalFbdJson(twoNetworkDocument()) })
    expect(screen.getByText(/Chưa lưu|Not saved/)).toBeInTheDocument()
  })

  it('PGM-02B: thanh công cụ phụ gom cụm mà KHÔNG mất điều khiển nào', () => {
    /* Gom nhóm là thao tác dễ đánh rơi một điều khiển mà không ai thấy — mắt
       chỉ đếm được "trông gọn hơn". Phép kiểm này đếm đúng 7 điều khiển gốc. */
    renderPane()
    const toolbar = screen.getByTestId('fbd-secondary-toolbar')
    const group = within(toolbar).getByRole('group', { name: /Tuỳ chọn hiển thị FBD|FBD display preferences/ })
    expect(within(group).getAllByRole('combobox')).toHaveLength(4)
    expect(within(group).getAllByRole('checkbox')).toHaveLength(3)
  })

  it('PGM-02B: vùng chạm 44px được giữ ở khổ nhỏ, chỉ rút ở khổ ≥1440px', () => {
    /* Ảnh chuẩn vẽ thanh 46px, nhưng hạ vùng chạm toàn cục sẽ lấy mất 44px trên
       đúng những tủ dùng màn cảm ứng. `min-h-11` phải còn, và lớp rút gọn phải
       có tiền tố khổ lớn. */
    renderPane()
    const toolbar = screen.getByTestId('fbd-secondary-toolbar')
    const select = within(toolbar).getAllByRole('combobox')[0]
    expect(select).toHaveClass('min-h-11')
    expect(select).toHaveClass('min-[1440px]:min-h-0')
  })

  it('PGM-02B: dải trạng thái neo "Sẵn sàng" bên trái nhưng KHÔNG bịa thu phóng', () => {
    /* Ảnh chuẩn vẽ `(100%)` và `● Online`. Bố cục lấy theo ảnh; giá trị thì
       không — canvas chưa công bố tỉ lệ thu phóng, và tab chưa nối trạng thái
       kết nối. Cả hai phải còn là `—`. */
    renderPane()
    const bar = screen.getByTestId('editor-status-bar')
    expect(within(bar).getByText(/Sẵn sàng|Ready/)).toBeInTheDocument()
    expect(within(screen.getByTestId('editor-status-zoom')).getByText('—')).toBeInTheDocument()
    expect(within(screen.getByTestId('editor-status-connection')).getByText('—')).toBeInTheDocument()
    expect(within(bar).queryByText('100%')).toBeNull()
  })
})
