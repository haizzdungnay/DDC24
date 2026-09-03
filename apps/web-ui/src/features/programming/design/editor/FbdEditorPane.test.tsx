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
