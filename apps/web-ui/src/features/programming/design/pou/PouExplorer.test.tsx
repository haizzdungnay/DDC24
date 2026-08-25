import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../../shared/i18n'
import type { ProgrammingDraftDocument, ProgrammingDraftOperation } from '../../model/types'
import { PouExplorer } from './PouExplorer'

function baseDocument(): ProgrammingDraftDocument {
  return {
    schemaVersion: 2,
    project: { projectId: 'project-1', name: 'AHU', functionalTags: [] },
    programs: [
      {
        programId: 'run-1', objectId: 'obj-1', hasRuntimeConfig: true, periodMs: 5000,
        name: 'AHU_MAIN', kind: 'PROGRAM', language: 'ST', document: '', dependencies: ['obj-2']
      },
      {
        programId: 'obj-2', objectId: 'obj-2', hasRuntimeConfig: false,
        name: 'SCALE_LIN', kind: 'FUNCTION', language: 'ST', document: ''
      }
    ],
    variables: [], bindings: [],
    task: { taskId: 'task-1', periodMs: 1000, programOrder: ['run-1'] },
    library: { profile: 'revA', version: '1' }
  } as unknown as ProgrammingDraftDocument
}

function renderExplorer(overrides: Partial<Parameters<typeof PouExplorer>[0]> = {}) {
  const onSave = vi.fn<(operations: ProgrammingDraftOperation[]) => Promise<boolean>>().mockResolvedValue(true)
  const onSelect = vi.fn<(objectId: string | undefined) => void>()
  render(
    <I18nProvider>
      <PouExplorer
        document={overrides.document ?? baseDocument()}
        canEdit={overrides.canEdit ?? true}
        saving={overrides.saving ?? false}
        selectedObjectId={overrides.selectedObjectId}
        onSelect={onSelect}
        onSave={onSave}
      />
    </I18nProvider>
  )
  return { onSave, onSelect }
}

beforeEach(() => localStorage.setItem('mkddc-lang', 'vi'))
afterEach(cleanup)

describe('PGM-02 POU Explorer (T59-803)', () => {
  it('chỉ có ĐÚNG MỘT navigation POU trong DOM', () => {
    renderExplorer()
    expect(screen.getAllByRole('navigation')).toHaveLength(1)
    expect(screen.getByRole('navigation', { name: 'Cây POU' })).toBeInTheDocument()
  })

  it('chọn POU trả về objectId, không trả identity runtime', () => {
    const { onSelect } = renderExplorer()
    fireEvent.click(screen.getByRole('button', { name: 'Mở AHU_MAIN' }))
    expect(onSelect).toHaveBeenCalledWith('obj-1')
    expect(onSelect).not.toHaveBeenCalledWith('run-1')
  })

  it('lọc chỉ đổi thứ được vẽ, KHÔNG đổi POU đang chọn', () => {
    const { onSelect } = renderExplorer({ selectedObjectId: 'obj-1' })
    fireEvent.change(screen.getByLabelText('Tìm POU'), { target: { value: 'scale' } })
    expect(screen.queryByRole('button', { name: 'Mở AHU_MAIN' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mở SCALE_LIN' })).toBeInTheDocument()
    // Gõ vào ô tìm kiếm mà editor bị đổi tệp là mất nội dung đang soạn.
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('tạo FUNCTION gửi đúng một upsertObject và không xếp lịch', async () => {
    const { onSave } = renderExplorer()
    fireEvent.click(screen.getByTitle('Thêm FUNCTION'))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const operations = onSave.mock.calls[0][0] as ProgrammingDraftOperation[]
    expect(operations.map((operation) => operation.op)).toEqual(['upsertObject'])
  })

  it('tạo Program ST gửi upsertProgram + setTask', async () => {
    const { onSave } = renderExplorer()
    fireEvent.click(screen.getByTitle('Thêm chương trình ST'))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const operations = onSave.mock.calls[0][0] as ProgrammingDraftOperation[]
    expect(operations.map((operation) => operation.op)).toEqual(['upsertProgram', 'setTask'])
  })

  it('đổi tên trùng bị chặn kèm lý do và không gửi gì lên server', async () => {
    const { onSave } = renderExplorer()
    fireEvent.click(screen.getByTitle('Đổi tên AHU_MAIN'))
    const input = screen.getByLabelText('Tên POU mới')
    fireEvent.change(input, { target: { value: 'SCALE_LIN' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('đã tồn tại')
    fireEvent.submit(input)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('đổi tên hợp lệ gửi renameObject', async () => {
    const { onSave } = renderExplorer()
    fireEvent.click(screen.getByTitle('Đổi tên AHU_MAIN'))
    const input = screen.getByLabelText('Tên POU mới')
    fireEvent.change(input, { target: { value: 'AHU_MAIN_V2' } })
    fireEvent.submit(input)
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([
      { op: 'renameObject', objectId: 'obj-1', name: 'AHU_MAIN_V2' }
    ]))
  })

  it('xóa POU còn người gọi bị chặn ở hộp thoại, nút Xóa không bấm được', async () => {
    const { onSave } = renderExplorer()
    fireEvent.click(screen.getByTitle('Xóa SCALE_LIN'))
    const dialog = await screen.findByRole('dialog', { name: 'Xóa POU?' })
    expect(within(dialog).getByRole('alert')).toHaveTextContent('AHU_MAIN')
    expect(within(dialog).getByRole('button', { name: 'Xóa' })).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xóa' }))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('vai chỉ đọc không thấy bất kỳ lối tạo/đổi tên/xóa nào', () => {
    renderExplorer({ canEdit: false })
    expect(screen.queryByTitle('Thêm chương trình ST')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Thêm FUNCTION')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Đổi tên AHU_MAIN')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Xóa AHU_MAIN')).not.toBeInTheDocument()
    // Vẫn đọc được cây và inspector.
    expect(screen.getByRole('navigation', { name: 'Cây POU' })).toBeInTheDocument()
  })

  it('inspector ẩn chu kỳ với POU dùng chung và nói rõ POU chưa xếp lịch', () => {
    cleanup()
    renderExplorer({ selectedObjectId: 'obj-2' })
    expect(screen.queryByText('Chu kỳ')).not.toBeInTheDocument()
    expect(screen.getByText(/chỉ chạy khi được Program gọi/)).toBeInTheDocument()

    cleanup()
    renderExplorer({ selectedObjectId: 'obj-1' })
    expect(screen.getByText('Chu kỳ')).toBeInTheDocument()
    expect(screen.getByText('5000 ms')).toBeInTheDocument()
  })
})
