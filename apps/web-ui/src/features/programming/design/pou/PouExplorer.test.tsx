import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../../shared/i18n'
import type { ProgrammingDraftDocument, ProgrammingDraftOperation } from '../../model/types'
import { LIBRARY_DRAG_TYPE } from '../library/QuickLibraryPanel'
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

function createPou(label: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Mới' }))
  fireEvent.click(within(screen.getByRole('menu', { name: 'Tạo POU mới' })).getByRole('menuitem', { name: label }))
}

function pouAction(name: string, action: string) {
  fireEvent.click(screen.getByRole('button', { name: `Thao tác với ${name}` }))
  fireEvent.click(within(screen.getByRole('menu', { name: `Thao tác với ${name}` })).getByRole('menuitem', { name: action }))
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
    createPou('Function · ST')
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const operations = onSave.mock.calls[0][0] as ProgrammingDraftOperation[]
    expect(operations.map((operation) => operation.op)).toEqual(['upsertObject'])
  })

  it('tạo Program ST gửi upsertProgram + setTask', async () => {
    const { onSave } = renderExplorer()
    createPou('Program · ST')
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    const operations = onSave.mock.calls[0][0] as ProgrammingDraftOperation[]
    expect(operations.map((operation) => operation.op)).toEqual(['upsertProgram', 'setTask'])
  })

  it('đổi tên trùng bị chặn kèm lý do và không gửi gì lên server', async () => {
    const { onSave } = renderExplorer()
    pouAction('AHU_MAIN', 'Đổi tên')
    const input = screen.getByLabelText('Tên POU mới')
    fireEvent.change(input, { target: { value: 'SCALE_LIN' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('đã tồn tại')
    fireEvent.submit(input)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('[LỖI #8] đổi tên trùng với khối FBD hệ thống bị chặn với thông báo tiếng Việt', async () => {
    const { onSave } = renderExplorer()
    pouAction('AHU_MAIN', 'Đổi tên')
    const input = screen.getByLabelText('Tên POU mới')
    fireEvent.change(input, { target: { value: 'TON' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Tên POU trùng với khối thư viện hệ thống.')
    fireEvent.submit(input)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('đổi tên hợp lệ gửi renameObject', async () => {
    const { onSave } = renderExplorer()
    pouAction('AHU_MAIN', 'Đổi tên')
    const input = screen.getByLabelText('Tên POU mới')
    fireEvent.change(input, { target: { value: 'AHU_MAIN_V2' } })
    fireEvent.submit(input)
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([
      { op: 'renameObject', objectId: 'obj-1', name: 'AHU_MAIN_V2' }
    ]))
  })

  it('xóa POU còn người gọi bị chặn ở hộp thoại, nút Xóa không bấm được', async () => {
    const { onSave } = renderExplorer()
    pouAction('SCALE_LIN', 'Xóa')
    const dialog = await screen.findByRole('dialog', { name: 'Xóa POU?' })
    expect(within(dialog).getByRole('alert')).toHaveTextContent('AHU_MAIN')
    expect(within(dialog).getByRole('button', { name: 'Xóa' })).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Xóa' }))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('vai chỉ đọc không thấy bất kỳ lối tạo/đổi tên/xóa nào', () => {
    renderExplorer({ canEdit: false })
    expect(screen.queryByRole('button', { name: 'Mới' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Thao tác với AHU_MAIN' })).not.toBeInTheDocument()
    // Vẫn đọc được cây và inspector.
    expect(screen.getByRole('navigation', { name: 'Cây POU' })).toBeInTheDocument()
  })

  it('DEV-PROG-011: thanh bên KHÔNG còn khay thuộc tính POU', () => {
    // Năm trường (Tên/Loại/Ngôn ngữ/Chu kỳ/Trạng thái mong muốn) đã về
    // `ContextInspector` ở cột phải. Giữ hai bản ở hai cột là hai chỗ có thể
    // nói khác nhau về cùng một POU — đúng lớp lỗi mà `T59-803` đã đi gộp một
    // lần khi DOM có hai cây POU. Cây + tìm kiếm + nút tạo là toàn bộ thanh bên.
    cleanup()
    renderExplorer({ selectedObjectId: 'obj-1' })
    expect(screen.queryByLabelText('Thuộc tính POU')).not.toBeInTheDocument()
    expect(screen.queryByText('Chu kỳ')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Cây POU')).toBeInTheDocument()
  })

  it('DEV-PROG-006: nhóm gập được, và đang lọc thì luôn mở', () => {
    cleanup()
    const { onSelect } = renderExplorer({})
    expect(screen.getByRole('button', { name: /Programs \(1\)/ })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: /Programs \(1\)/ }))
    expect(screen.getByRole('button', { name: /Programs \(1\)/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: /^Mở AHU_MAIN$/ })).toBeNull()

    // Gõ vào ô tìm kiếm mà kết quả nằm trong một nhóm đang đóng thì người dùng
    // nhận một câu trả lời SAI cho một câu hỏi đúng.
    fireEvent.change(screen.getByLabelText('Tìm POU'), { target: { value: 'AHU' } })
    expect(screen.getByRole('button', { name: /^Mở AHU_MAIN$/ })).toBeInTheDocument()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('DEV-PROG-006: chuột phải mở menu Mở/Đổi tên/Nhân bản/Xóa', () => {
    cleanup()
    renderExplorer({ selectedObjectId: 'obj-1' })
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Mở AHU_MAIN' }))
    const menu = screen.getByTestId('pou-context-menu')
    for (const label of ['Mở', 'Đổi tên', 'Nhân bản', 'Xóa']) {
      expect(within(menu).getByRole('menuitem', { name: label })).toBeInTheDocument()
    }
    // "Đặt làm Active" không có ở đây, và menu NÓI RA nơi thực hiện nó thay vì
    // im lặng: ý định bật/tắt Program sống ở API runtime-intent, không ở Draft.
    expect(within(menu).getByText(/Runtime & Bảo trì/)).toBeInTheDocument()
  })

  it('TC-POU-EXP-244: container có w-[244px] min-w-[244px] max-w-[244px]', () => {
    const { container } = render(
      <I18nProvider>
        <PouExplorer
          document={baseDocument()}
          canEdit={true}
          saving={false}
          onSelect={vi.fn()}
          onSave={vi.fn().mockResolvedValue(true)}
        />
      </I18nProvider>
    )
    const root = container.firstElementChild
    expect(root).toHaveClass('w-[244px]', 'min-w-[244px]', 'max-w-[244px]')
  })

  it('TC-POU-EXP-3SEC: render 3 sections Programs, Function Blocks, Functions với badge count', () => {
    renderExplorer()
    const programsButton = screen.getByRole('button', { name: /Programs/ })
    const functionsButton = screen.getByRole('button', { name: /Functions/ })
    const functionBlocksButton = screen.getByRole('button', { name: /Function Blocks/ })

    expect(programsButton).toBeInTheDocument()
    expect(functionsButton).toBeInTheDocument()
    expect(functionBlocksButton).toBeInTheDocument()

    const programsBadge = within(programsButton).getByTestId('pou-section-badge-PROGRAM')
    const functionsBadge = within(functionsButton).getByTestId('pou-section-badge-FUNCTION')
    const fbBadge = within(functionBlocksButton).getByTestId('pou-section-badge-FUNCTION_BLOCK')

    expect(programsBadge).toHaveTextContent('1')
    expect(functionsBadge).toHaveTextContent('1')
    expect(fbBadge).toHaveTextContent('0')
  })

  it('TC-POU-EXP-COLLAPSE: collapse/expand từng section độc lập', () => {
    renderExplorer()
    const programsButton = screen.getByRole('button', { name: /Programs/ })
    const functionsButton = screen.getByRole('button', { name: /Functions/ })
    const functionBlocksButton = screen.getByRole('button', { name: /Function Blocks/ })

    expect(programsButton).toHaveAttribute('aria-expanded', 'true')
    expect(functionsButton).toHaveAttribute('aria-expanded', 'true')
    expect(functionBlocksButton).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(programsButton)
    expect(programsButton).toHaveAttribute('aria-expanded', 'false')
    expect(functionsButton).toHaveAttribute('aria-expanded', 'true')
    expect(functionBlocksButton).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(functionsButton)
    expect(programsButton).toHaveAttribute('aria-expanded', 'false')
    expect(functionsButton).toHaveAttribute('aria-expanded', 'false')
    expect(functionBlocksButton).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(programsButton)
    expect(programsButton).toHaveAttribute('aria-expanded', 'true')
    expect(functionsButton).toHaveAttribute('aria-expanded', 'false')
    expect(functionBlocksButton).toHaveAttribute('aria-expanded', 'true')
  })

  it('(a) menu + New có đúng 5 mục, trong đó có Function Block · FBD', () => {
    renderExplorer()
    fireEvent.click(screen.getByRole('button', { name: 'Mới' }))
    const menu = screen.getByRole('menu', { name: 'Tạo POU mới' })
    const items = within(menu).getAllByRole('menuitem')
    expect(items).toHaveLength(5)
    expect(within(menu).getByRole('menuitem', { name: 'Function Block · FBD' })).toBeInTheDocument()
  })

  it('(b) FB body FBD có draggable và onDragStart set đúng MIME + payload pou:<tên>', () => {
    const doc = baseDocument()
    doc.programs.push({
      programId: 'fb-fbd-1',
      objectId: 'fb-fbd-1',
      hasRuntimeConfig: false,
      name: 'MY_FB_FBD',
      kind: 'FUNCTION_BLOCK',
      language: 'FBD',
      document: '',
    })
    renderExplorer({ document: doc })
    const button = screen.getByRole('button', { name: 'Mở MY_FB_FBD' })
    const item = button.closest('li')!
    expect(item).toHaveAttribute('draggable', 'true')

    const setData = vi.fn()
    const dataTransfer = { setData, effectAllowed: 'none' }
    fireEvent.dragStart(item, { dataTransfer })
    expect(setData).toHaveBeenCalledWith(LIBRARY_DRAG_TYPE, 'pou:MY_FB_FBD')
  })

  it('(c) FB body ST có draggable', () => {
    const doc = baseDocument()
    doc.programs.push({
      programId: 'fb-st-1',
      objectId: 'fb-st-1',
      hasRuntimeConfig: false,
      name: 'MY_FB_ST',
      kind: 'FUNCTION_BLOCK',
      language: 'ST',
      document: '',
    })
    renderExplorer({ document: doc })
    const button = screen.getByRole('button', { name: 'Mở MY_FB_ST' })
    const item = button.closest('li')!
    expect(item).toHaveAttribute('draggable', 'true')
  })

  it('(d) FUNCTION có draggable và PROGRAM không có draggable', () => {
    renderExplorer()
    const funcButton = screen.getByRole('button', { name: 'Mở SCALE_LIN' })
    const funcItem = funcButton.closest('li')!
    expect(funcItem).toHaveAttribute('draggable', 'true')

    const setData = vi.fn()
    const dataTransfer = { setData, effectAllowed: 'none' }
    fireEvent.dragStart(funcItem, { dataTransfer })
    expect(setData).toHaveBeenCalledWith(LIBRARY_DRAG_TYPE, 'pou:SCALE_LIN')

    const progButton = screen.getByRole('button', { name: 'Mở AHU_MAIN' })
    const progItem = progButton.closest('li')!
    expect(progItem).toHaveAttribute('draggable', 'false')
  })

  it('[LỖI #1] FB thiếu outputs trong document.objects thì draggable="false" và hiện chú thích lỗi', () => {
    const doc = baseDocument()
    ;(doc as unknown as Record<string, unknown>).objects = [
      {
        objectId: 'fb-empty-1',
        kind: 'FUNCTION_BLOCK',
        name: 'EMPTY_FB',
        language: 'FBD',
        source: '',
        interface: {
          inputs: [],
        },
      },
    ]
    doc.programs.push({
      programId: 'fb-empty-1',
      objectId: 'fb-empty-1',
      hasRuntimeConfig: false,
      name: 'EMPTY_FB',
      kind: 'FUNCTION_BLOCK',
      language: 'FBD',
      document: '',
    })
    renderExplorer({ document: doc })
    const button = screen.getByRole('button', { name: 'Mở EMPTY_FB' })
    const item = button.closest('li')!
    expect(item).toBeInTheDocument()
    expect(item).toHaveAttribute('draggable', 'false')
    expect(within(item).getByText(/phải có ít nhất một đầu ra/)).toBeInTheDocument()
  })
})
