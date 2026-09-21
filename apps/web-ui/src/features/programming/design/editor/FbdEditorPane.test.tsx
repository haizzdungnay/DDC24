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

  it('TC-FBD-RESP-001: shell có min-width guard và responsive marquee', () => {
    renderPane()
    expect(screen.getByTestId('fbd-workspace-shell')).toHaveClass('min-w-0', 'overflow-x-hidden')
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

  /* `#674` chốt mô hình MỘT canvas: không còn cụm Chọn/Thêm Network để kiểm,
   * nên `TC-FBD-NET-001/002` bị thay thế chứ không còn "tạm bỏ". Bằng chứng
   * thay thế nằm ở `StructuredFbdEditor.test.tsx` (`AC-674-2`, `AC-674-4`):
   * thanh công cụ không còn lối vào nhiều Network, và tài liệu mô hình cũ mở
   * chỉ đọc với 0 mutation. */

  it('TC-FBD-PREF-001: theme/grid lưu cục bộ mà không đổi canonical buffer', () => {
    const { onChange } = renderPane()
    const before = canonicalFbdJson(sampleDoc)
    fireEvent.change(screen.getByLabelText(/Giao diện FBD|FBD theme/), { target: { value: 'DARK' } })
    fireEvent.click(screen.getByLabelText(/Lưới|Grid/))
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

  it('TC-FBD-HEADER-001 (bổ sung): dirty vẫn được công bố để header chung khoá Check theo pending operations, không tự nhân bản nút', () => {
    const { onRunCheck } = renderPane({
      source: canonicalFbdJson(twoNetworkDocument()),
      checkDisabledReason: 'Lưu bản nháp trước khi Kiểm tra',
    })
    expect(screen.getByText(/Chưa lưu|Not saved/)).toBeInTheDocument()
    const toolbar = screen.getByRole('toolbar', { name: /Lệnh FBD|FBD commands/ })
    expect(within(toolbar).queryByRole('button', { name: /Lưu|Save|Kiểm tra|Check/ })).toBeNull()
    expect(onRunCheck).not.toHaveBeenCalled()
  })

  it('PGM-02B: thanh công cụ phụ gom cụm mà KHÔNG mất điều khiển nào', () => {
    /* Gom nhóm là thao tác dễ đánh rơi một điều khiển mà không ai thấy — mắt
       chỉ đếm được "trông gọn hơn". Phép kiểm này đếm đúng 7 điều khiển gốc.
       Dải preferences nằm ngang hàng status bar — phần tử testid
       `fbd-secondary-toolbar` chính là `role="group"`, không lồng thêm. */
    renderPane()
    const group = screen.getByTestId('fbd-secondary-toolbar')
    expect(group).toHaveAttribute('role', 'group')
    /* 3 combobox: `Khung nhìn`, `Kiểu dây`, `Giao diện FBD`. Không có ô chọn
       `Network hoạt động` và cũng sẽ không có: `#674` chốt mô hình một canvas,
       nên `Khung nhìn` chỉ còn là tuỳ chọn hiển thị của đúng một Network. */
    expect(within(group).getAllByRole('combobox')).toHaveLength(3)
    expect(within(group).getAllByRole('checkbox')).toHaveLength(2)
  })

  it('PGM-02B: dải preferences dùng kích thước compact ngang hàng status bar', () => {
    /* Preferences nằm ở dải text-[11px] ngang status bar, không phải thanh
       công cụ 46px cũ (thanh ấy đã bị bỏ hẳn ở `#674`). Vùng chạm 44px
       (`min-h-11`) vì thế không thuộc dải này; kiểm compact thay thế. */
    renderPane()
    const toolbar = screen.getByTestId('fbd-secondary-toolbar')
    expect(toolbar).toHaveClass('text-[11px]')
    const select = within(toolbar).getAllByRole('combobox')[0]
    expect(select).toHaveClass('text-[11px]')
  })

  it('PGM-02B: canvas FBD không còn dải trạng thái dưới chân', () => {
    renderPane()
    expect(screen.queryByTestId('editor-status-bar')).toBeNull()
  })
})
