import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import goldenJson from '../../../../../../contracts/programming/fbd/golden/ahu_fan_enable.json'
import { I18nProvider } from '../../../shared/i18n'
import { StructuredFbdEditor } from './StructuredFbdEditor'
import type { FbdDocument } from './model'

function golden(): FbdDocument {
  return JSON.parse(JSON.stringify(goldenJson)) as FbdDocument
}

function renderEditor(document: FbdDocument, canEdit = true, onChange = vi.fn()) {
  return {
    onChange,
    ...render(<I18nProvider><StructuredFbdEditor document={document} canEdit={canEdit} onChange={onChange} /></I18nProvider>),
  }
}

afterEach(cleanup)

describe('StructuredFbdEditor', () => {
  it('hiển thị graph canonical, toolbar và trợ giúp keyboard', () => {
    renderEditor(golden())
    expect(screen.getByRole('region', { name: /Structured FBD editor|Bộ dựng FBD/ })).toBeTruthy()
    expect(screen.getByText('FBD · AHU_FAN_ENABLE')).toBeTruthy()
    expect(screen.getByRole('toolbar', { name: /FBD commands|Lệnh FBD/ })).toBeTruthy()
    expect(screen.getByText(/Insert.*block/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /OUTPUT OUT BOOL/ })).toHaveLength(3)
  })

  it('hoàn tất một wire chỉ bằng Arrow và Enter', async () => {
    const document = golden()
    document.networks[0].wires = document.networks[0].wires.slice(1)
    const { onChange } = renderEditor(document)
    const editor = screen.getByRole('region', { name: /Structured FBD editor|Bộ dựng FBD/ })
    fireEvent.keyDown(editor, { key: 'ArrowDown' })
    fireEvent.keyDown(editor, { key: 'Enter' })
    fireEvent.keyDown(editor, { key: 'ArrowDown' })
    fireEvent.keyDown(editor, { key: 'ArrowDown' })
    fireEvent.keyDown(editor, { key: 'Enter' })
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const changed = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as FbdDocument
    expect(changed.networks[0].wires).toHaveLength(3)
  })

  it('Delete xóa block đang chọn và wire liên quan', async () => {
    const { onChange } = renderEditor(golden())
    fireEvent.click(screen.getByRole('button', { name: /#2 · AND/ }))
    fireEvent.keyDown(screen.getByRole('region', { name: /Structured FBD editor|Bộ dựng FBD/ }), { key: 'Delete' })
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    const changed = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as FbdDocument
    expect(changed.networks[0].nodes).toHaveLength(3)
    expect(changed.networks[0].wires).toHaveLength(0)
  })

  it('chế độ chỉ đọc chặn cả toolbar và shortcut mutation', () => {
    const { onChange } = renderEditor(golden(), false)
    expect(screen.getByText(/Read only|Chỉ đọc/)).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('region', { name: /Structured FBD editor|Bộ dựng FBD/ }), { key: 'Insert' })
    expect(onChange).not.toHaveBeenCalled()
  })
})
