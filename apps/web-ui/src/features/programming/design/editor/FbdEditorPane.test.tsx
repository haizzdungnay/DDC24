import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../../shared/i18n'
import type { ProgrammingDraftOperation, ProgrammingProgram } from '../../model/types'
import { FbdEditorPane, parseFbdDocument } from './FbdEditorPane'
import { canonicalFbdJson, type FbdDocument } from '../../fbd/model'
import { emptyFbdDocument } from '../pou/pouTemplates'

afterEach(cleanup)

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

  it('render cơ bản: hiển thị tên POU, EditorStatusBar, nút Lưu', () => {
    renderPane()
    expect(screen.getByRole('heading', { level: 3, name: 'FBD_Sample' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Lưu|Save/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Kiểm tra|Check/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /So sánh|Compare/ })).toBeInTheDocument()
    expect(screen.getByTestId('editor-status-bar')).toBeInTheDocument()
  })

  it('nút Lưu bị disabled khi chưa sửa (dirty=false), enabled khi dirty=true', () => {
    const { rerender, onSave, onChange, onRunCheck, onOpenCompare } = renderPane()
    const saveButton = screen.getByRole('button', { name: /Lưu|Save/ })
    expect(saveButton).toBeDisabled()
    expect(screen.queryByText(/Chưa lưu|Not saved/)).not.toBeInTheDocument()

    // Sửa source tài liệu thành đồ thị khác
    const modifiedDoc: FbdDocument = {
      ...sampleDoc,
      networks: [
        ...sampleDoc.networks,
        { id: 'net-2', name: 'network_2', order: 1, nodes: [], wires: [] },
      ],
    }
    const modifiedJson = canonicalFbdJson(modifiedDoc)

    rerender(
      <I18nProvider>
        <FbdEditorPane
          program={sampleProgram}
          source={modifiedJson}
          canEdit={true}
          saving={false}
          onChange={onChange}
          onSave={onSave}
          userPouInterfaces={[]}
          onRunCheck={onRunCheck}
          onOpenCompare={onOpenCompare}
        />
      </I18nProvider>,
    )

    expect(saveButton).not.toBeDisabled()
    expect(screen.getByText(/Chưa lưu|Not saved/)).toBeInTheDocument()
  })

  it('click Lưu gọi onSave đúng draft operation', () => {
    const modifiedDoc: FbdDocument = {
      ...sampleDoc,
      networks: [
        ...sampleDoc.networks,
        { id: 'net-2', name: 'network_2', order: 1, nodes: [], wires: [] },
      ],
    }
    const modifiedJson = canonicalFbdJson(modifiedDoc)
    const { onSave } = renderPane({ source: modifiedJson })

    const saveButton = screen.getByRole('button', { name: /Lưu|Save/ })
    expect(saveButton).not.toBeDisabled()
    fireEvent.click(saveButton)

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith([
      {
        op: 'replaceProgramSource',
        programId: 'fbd-prog-1',
        language: 'FBD',
        source: modifiedJson,
      },
    ])
  })

  it('nút Kiểm tra và So sánh hiển thị đúng trạng thái và callback', () => {
    const { onRunCheck, onOpenCompare } = renderPane()
    const checkButton = screen.getByRole('button', { name: /Kiểm tra|Check/ })
    const compareButton = screen.getByRole('button', { name: /So sánh|Compare/ })

    expect(checkButton).not.toBeDisabled()
    expect(compareButton).not.toBeDisabled()

    fireEvent.click(checkButton)
    expect(onRunCheck).toHaveBeenCalledTimes(1)

    fireEvent.click(compareButton)
    expect(onOpenCompare).toHaveBeenCalledTimes(1)
  })

  it('nút Kiểm tra và So sánh bị disabled khi có lý do khoá', () => {
    renderPane({
      checkDisabledReason: 'Draft is dirty',
      compareDisabledReason: 'No baseline revision',
    })
    const checkButton = screen.getByRole('button', { name: /Kiểm tra|Check/ })
    const compareButton = screen.getByRole('button', { name: /So sánh|Compare/ })

    expect(checkButton).toBeDisabled()
    expect(checkButton).toHaveAttribute('title', 'Draft is dirty')

    expect(compareButton).toBeDisabled()
    expect(compareButton).toHaveAttribute('title', 'No baseline revision')
  })
})

describe('FbdEditorPane — Task 8: Shell, Responsive & Toolbar (Issue #574)', () => {
  const sampleDoc = emptyFbdDocument('FBD_Task8')
  const sampleProgram: ProgrammingProgram = {
    programId: 'fbd-prog-task8',
    name: 'FBD_Task8',
    kind: 'PROGRAM',
    language: 'FBD',
    document: canonicalFbdJson(sampleDoc),
  }

  function renderTask8Pane(props?: {
    program?: ProgrammingProgram
    source?: string
    canEdit?: boolean
    saving?: boolean
    loading?: boolean
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

    const PaneComponent = FbdEditorPane as React.ComponentType<
      React.ComponentProps<typeof FbdEditorPane> & { loading?: boolean }
    >

    const rendered = render(
      <I18nProvider>
        <PaneComponent
          program={props?.program ?? sampleProgram}
          source={props?.source ?? (typeof sampleProgram.document === 'string' ? sampleProgram.document : JSON.stringify(sampleProgram.document))}
          canEdit={props?.canEdit ?? true}
          saving={props?.saving ?? false}
          loading={props?.loading ?? false}
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

  // TC-FBD-HEADER-001: Một bộ Save/Check duy nhất — FbdEditorPane không còn nút Lưu riêng
  it('TC-FBD-HEADER-001: FbdEditorPane không còn nút Lưu riêng trong header nội bộ (chuyển lên header dùng chung)', () => {
    // FbdEditorPane không còn nút Lưu riêng mà dùng nút Lưu hợp nhất ở thanh tiêu đề chung
    renderTask8Pane({ canEdit: true })
    expect(screen.queryByRole('button', { name: /^(Lưu|Save)$/ })).not.toBeInTheDocument()
  })

  // TC-FBD-HEADER-001: Một bộ Save/Check duy nhất — Check disable khi dirty
  it('TC-FBD-HEADER-001: nút Kiểm tra bị vô hiệu hoá khi tài liệu FBD ở trạng thái dirty chưa lưu', () => {
    // Khi nội dung đồ thị FBD bị thay đổi (dirty), nút Kiểm tra phải bị vô hiệu hoá để buộc lưu trước
    const modifiedDoc: FbdDocument = {
      ...sampleDoc,
      networks: [
        ...sampleDoc.networks,
        { id: 'net-dirty-1', name: 'network_dirty', order: 1, nodes: [], wires: [] },
      ],
    }
    const modifiedJson = canonicalFbdJson(modifiedDoc)
    renderTask8Pane({ source: modifiedJson, checkDisabledReason: null })
    const checkButton = screen.getByRole('button', { name: /Kiểm tra|Check/ })
    expect(checkButton).toBeDisabled()
  })

  // TC-FBD-RESP-002: Touch/stylus trên tablet >=768px có nút chọn vùng
  it('TC-FBD-RESP-002: hiển thị nút bật chế độ chọn vùng (marquee) phục vụ thao tác touch hoặc stylus trên tablet', () => {
    // Trên tablet hoặc màn hình cảm ứng, cần có nút bật chế độ chọn vùng marquee chuyên dụng
    renderTask8Pane({ canEdit: true })
    const marqueeBtn = screen.getByRole('button', { name: /Chọn vùng|Marquee/i })
    expect(marqueeBtn).toBeInTheDocument()
    fireEvent.click(marqueeBtn)
    expect(marqueeBtn).toHaveAttribute('aria-pressed', 'true')
  })

  // TC-FBD-STATE-001: Loading skeleton phủ đúng dock/canvas khi đang tải
  it('TC-FBD-STATE-001: hiển thị loading skeleton phủ dock và canvas khi đang tải sơ đồ FBD', () => {
    // Khi FBD editor đang nạp dữ liệu, hiển thị skeleton phủ toàn bộ khung soạn thảo và dock
    renderTask8Pane({ loading: true })
    expect(screen.getByTestId('fbd-editor-skeleton')).toBeInTheDocument()
    expect(screen.getByTestId('fbd-canvas-skeleton')).toBeInTheDocument()
  })

  // TC-FBD-STATE-004: Viewer hoặc màn hình hẹp khoá sửa, 0 mutation action
  it('TC-FBD-STATE-004: chế độ canEdit=false hiển thị banner chỉ đọc và khoá toàn bộ mutation action', () => {
    // Khi canEdit=false (viewer hoặc màn hình nhỏ), hiển thị banner chỉ đọc và không cho phép phát sinh thao tác ghi
    const onChange = vi.fn()
    const onSave = vi.fn().mockResolvedValue(true)
    renderTask8Pane({ canEdit: false, onChange, onSave })

    // Phải hiển thị banner chỉ đọc dành riêng cho FBD
    expect(screen.getByTestId('fbd-readonly-banner')).toBeInTheDocument()
    expect(screen.getByText('Màn hình nhỏ — chỉ hỗ trợ xem sơ đồ')).toBeInTheDocument()

    // Kiểm tra các thao tác chỉnh sửa không phát sinh callback mutation
    const editorRegion = screen.getByRole('region', { name: /Bộ dựng FBD|Structured FBD editor/i })
    fireEvent.keyDown(editorRegion, { key: 'Insert' })
    fireEvent.keyDown(editorRegion, { key: 'Delete' })
    expect(onChange).not.toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
  })
})
