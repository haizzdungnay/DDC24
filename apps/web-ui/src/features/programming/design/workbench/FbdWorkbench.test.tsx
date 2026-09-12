import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import goldenJson from '../../../../../../../contracts/programming/fbd/golden/ahu_fan_enable.json'
import { I18nProvider } from '../../../../shared/i18n'
import { FbdEditorPane } from '../editor/FbdEditorPane'
import { StructuredFbdEditor } from '../../fbd/StructuredFbdEditor'
import { canonicalFbdJson, type FbdDocument } from '../../fbd/model'
import { computeAutoLayout } from '../../fbd/layout'
import { snapPoint } from '../../fbd/viewport'
import type { ProgrammingDraftDocument, ProgrammingProgram } from '../../model/types'
import { DesignWorkbench } from './DesignWorkbench'
import { ProgrammingWorkbench } from './ProgrammingWorkbench'
import { projectPendingProgramSources } from './workbenchDraft'

function golden(): FbdDocument {
  return JSON.parse(JSON.stringify(goldenJson)) as FbdDocument
}

function fbdProgram(document: unknown): ProgrammingProgram {
  return {
    programId: 'P_fbd',
    objectId: 'O_fbd',
    name: 'AHU_FAN_ENABLE',
    kind: 'PROGRAM',
    language: 'FBD',
    document,
  }
}

function draft(program: ProgrammingProgram): ProgrammingDraftDocument {
  return {
    schemaVersion: 2,
    project: { projectId: 'project-1', name: 'Project 1', functionalTags: [] },
    programs: [program],
    variables: [],
    bindings: [],
    task: { taskId: 'task-1', periodMs: 1000, programOrder: [program.programId] },
    library: { profile: 'revA', version: '1' },
  }
}

beforeEach(() => {
  localStorage.setItem('mkddc-lang', 'vi')
  const prototype = Element.prototype as unknown as Record<string, unknown>
  if (typeof prototype.setPointerCapture !== 'function') {
    prototype.setPointerCapture = () => {}
    prototype.releasePointerCapture = () => {}
  }
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('FBD Task 9 — workbench, diagnostics, status và Auto Layout', () => {
  it('TC-FBD-DIAG-001: ProblemsDrawer nhảy exact node; lỗi không anchor chỉ là văn bản', () => {
    const broken = golden()
    broken.networks[0].nodes[2].typeRef = 'BOOL'
    const onSelectProgram = vi.fn()
    const onJumpToFbdSelection = vi.fn()
    render(
      <I18nProvider>
        <DesignWorkbench
          mode="EDIT"
          document={draft(fbdProgram(canonicalFbdJson(broken)))}
          source={null}
          sourceLabel="Draft · AHU_FAN_ENABLE"
          checkOwnerHref="/commission"
          onSelectProgram={onSelectProgram}
          onJumpToOffset={vi.fn()}
          onJumpToFbdSelection={onJumpToFbdSelection}
        />
      </I18nProvider>,
    )

    fireEvent.click(screen.getByRole('tab', { name: /Vấn đề/ }))
    expect(screen.getByTestId('problems-drawer-embedded')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /FBD-SEM-TYPE-REF-001/ }))
    expect(onSelectProgram).toHaveBeenCalledWith('P_fbd')
    expect(onJumpToFbdSelection).toHaveBeenCalledWith('P_fbd', {
      kind: 'node',
      networkId: broken.networks[0].id,
      nodeId: broken.networks[0].nodes[2].id,
    })
    const firstSelection = onJumpToFbdSelection.mock.calls[0][1]
    fireEvent.click(screen.getByRole('button', { name: /FBD-SEM-TYPE-REF-001/ }))
    expect(onJumpToFbdSelection.mock.calls[1][1]).not.toBe(firstSelection)

    cleanup()
    render(
      <I18nProvider>
        <DesignWorkbench
          mode="EDIT"
          document={draft(fbdProgram('{broken-json'))}
          source={null}
          sourceLabel="Draft · hỏng"
          checkOwnerHref="/commission"
          onSelectProgram={vi.fn()}
          onJumpToOffset={vi.fn()}
          onJumpToFbdSelection={vi.fn()}
        />
      </I18nProvider>,
    )
    fireEvent.click(screen.getByRole('tab', { name: /Vấn đề/ }))
    expect(screen.getByText(/không neo vào vị trí nào/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /FBD-SCHEMA-JSON-001/ })).toBeNull()
  })

  it('TC-FBD-DIAG-001: ProblemsDrawer nhảy chính xác tới wire lỗi', () => {
    const broken = golden()
    broken.networks[0].nodes[0].executionOrder = 5
    const onJumpToFbdSelection = vi.fn()
    render(
      <I18nProvider>
        <DesignWorkbench
          mode="EDIT"
          document={draft(fbdProgram(JSON.stringify(broken)))}
          source={null}
          sourceLabel="Draft · wire lỗi"
          checkOwnerHref="/commission"
          onSelectProgram={vi.fn()}
          onJumpToOffset={vi.fn()}
          onJumpToFbdSelection={onJumpToFbdSelection}
        />
      </I18nProvider>,
    )
    fireEvent.click(screen.getByRole('tab', { name: /Vấn đề/ }))
    fireEvent.click(screen.getByRole('button', { name: /FBD-SEM-ORDER-001/ }))
    expect(onJumpToFbdSelection).toHaveBeenCalledWith('P_fbd', {
      kind: 'wire',
      networkId: broken.networks[0].id,
      wireId: broken.networks[0].wires[0].id,
    })
  })

  it('TC-FBD-LAYOUT-001: preview/cancel là 0 diff; Apply là một history entry', async () => {
    const original = golden()
    original.layout = {
      schemaVersion: 1,
      nodes: Object.fromEntries(original.networks[0].nodes.map((node, index) => [
        node.id,
        { x: 720 + index * 32, y: 480 + index * 24 },
      ])),
    }
    const onChange = vi.fn()
    render(
      <I18nProvider>
        <StructuredFbdEditor document={original} canEdit onChange={onChange} />
      </I18nProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Tự sắp xếp' }))
    expect(screen.getByText(/Draft chưa thay đổi/)).toBeInTheDocument()
    expect(document.querySelectorAll('[data-fbd-layout-preview-node]').length).toBeGreaterThan(0)
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Hủy xem trước' }))
    expect(document.querySelector('[data-fbd-layout-preview]')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Tự sắp xếp' }))
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng bố cục' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    const applied = onChange.mock.calls[0][0] as FbdDocument
    for (const point of Object.values(applied.layout?.nodes ?? {})) {
      expect(point.x % 8).toBe(0)
      expect(point.y % 8).toBe(0)
    }
    expect(applied.networks[0].nodes.map((node) => node.executionOrder))
      .toEqual(original.networks[0].nodes.map((node) => node.executionOrder))
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn tác' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2))
    expect(canonicalFbdJson(onChange.mock.calls[1][0] as FbdDocument)).toBe(canonicalFbdJson(original))
  })

  it('TC-FBD-LAYOUT-001: bố cục đã đúng là no-op, 0 mutation và 0 undo', () => {
    const source = golden()
    const computed = computeAutoLayout(source.networks[0]).positions
    source.layout = {
      schemaVersion: 1,
      nodes: Object.fromEntries(Object.entries(computed).map(([nodeId, point]) => [nodeId, snapPoint(point, 8)])),
    }
    const onChange = vi.fn()
    render(<I18nProvider><StructuredFbdEditor document={source} canEdit onChange={onChange} /></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Tự sắp xếp' }))
    expect(screen.getByRole('status')).toHaveTextContent(/không có thay đổi để áp dụng/)
    expect(document.querySelector('[data-fbd-layout-preview]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Hoàn tác' })).toBeDisabled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('TC-FBD-LAYOUT-001: căn lề dưới 2 block trả trạng thái rõ và không tạo preview', () => {
    render(
      <I18nProvider>
        <StructuredFbdEditor document={golden()} canEdit onChange={vi.fn()} />
      </I18nProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: /^#0 · BOOL · INPUT/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Căn trái' }))
    expect(screen.getByRole('status')).toHaveTextContent(/Chọn ít nhất 2 block/)
    expect(document.querySelector('[data-fbd-layout-preview]')).toBeNull()
  })

  it('TC-FBD-LAYOUT-001: mất quyền sửa hoặc tài liệu nhiều Network thì hủy preview fail-closed', () => {
    /* Bản cũ chứng minh nhánh "đổi active network" bằng một tài liệu 2 Network.
     * `#674` chốt mô hình MỘT canvas, nên tài liệu như thế nay mở chỉ đọc và
     * nhánh ấy không còn tồn tại để kiểm. Hai nhánh fail-closed còn sống được
     * giữ nguyên ở đây: mất quyền sửa, và tài liệu mô hình cũ (nhiều Network)
     * làm chính quyền sửa tắt đi. Cả hai đi qua cùng một effect như trước. */
    const source = golden()
    source.layout = {
      schemaVersion: 1,
      nodes: Object.fromEntries(source.networks[0].nodes.map((node, index) => [
        node.id,
        { x: 640 + index * 24, y: 400 + index * 16 },
      ])),
    }
    const legacyMultiNetwork = {
      ...source,
      networks: [...source.networks, {
        id: '90000000-0000-4000-8000-000000000001',
        name: 'NETWORK_2',
        order: 1,
        nodes: [],
        wires: [],
      }],
    }
    const view = (doc: FbdDocument, canEdit: boolean) => (
      <I18nProvider>
        <StructuredFbdEditor
          document={doc}
          canEdit={canEdit}
          activeNetworkId={doc.networks[0].id}
          networkView="SELECTED"
          onChange={vi.fn()}
        />
      </I18nProvider>
    )

    const { rerender } = render(view(source, true))
    fireEvent.click(screen.getByRole('button', { name: 'Tự sắp xếp' }))
    expect(document.querySelector('[data-fbd-layout-preview]')).not.toBeNull()
    rerender(view(source, false))
    expect(document.querySelector('[data-fbd-layout-preview]')).toBeNull()
    expect(screen.getByText(/Quyền chỉnh sửa đã đổi/)).toBeInTheDocument()

    rerender(view(source, true))
    fireEvent.click(screen.getByRole('button', { name: 'Tự sắp xếp' }))
    expect(document.querySelector('[data-fbd-layout-preview]')).not.toBeNull()
    rerender(view(legacyMultiNetwork, true))
    expect(document.querySelector('[data-fbd-layout-preview]')).toBeNull()
    expect(screen.getByTestId('fbd-multi-network-lock')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tự sắp xếp' })).toBeDisabled()
  })

  it('TC-FBD-WATCH-001: EDIT nói không khả dụng và không phát runtime request', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    render(
      <I18nProvider>
        <ProgrammingWorkbench
          mode="EDIT"
          sourceLabel="Draft · FBD"
          problems={[]}
          symbols={[]}
          source={null}
          onJumpToOffset={vi.fn()}
          checkOwnerHref="/commission"
        />
      </I18nProvider>,
    )
    fireEvent.click(screen.getByRole('tab', { name: /Watch/ }))
    expect(screen.getByRole('status')).toHaveTextContent(/Chế độ EDIT chỉ có Draft/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('TC-FBD-WB-001: thiếu source/index nói Không xác định được, không dựng reference giả', () => {
    render(
      <I18nProvider>
        <ProgrammingWorkbench
          mode="EDIT"
          sourceLabel="Draft · FBD"
          problems={[]}
          symbols={[]}
          source={null}
          onJumpToOffset={vi.fn()}
          checkOwnerHref="/commission"
        />
      </I18nProvider>,
    )
    fireEvent.click(screen.getByRole('tab', { name: /Tìm kiếm/ }))
    expect(screen.getByRole('status')).toHaveTextContent(/Không xác định được/)
    fireEvent.click(screen.getByRole('tab', { name: /Tham chiếu/ }))
    expect(screen.getByRole('status')).toHaveTextContent(/Không xác định được/)
    expect(within(screen.getByRole('tabpanel')).queryAllByRole('button')).toHaveLength(0)
  })

  it('TC-FBD-STATE-002: network rỗng có hướng dẫn và không báo lỗi giả', () => {
    const document = golden()
    document.networks[0].nodes = []
    document.networks[0].wires = []
    render(<I18nProvider><StructuredFbdEditor document={document} canEdit onChange={vi.fn()} /></I18nProvider>)
    expect(screen.getByText('Network trống — thêm block để bắt đầu.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('TC-FBD-STATE-003: JSON hỏng hiện mã lỗi và giữ nguyên buffer, không mount editor rỗng', () => {
    const onChange = vi.fn()
    render(
      <I18nProvider>
        <FbdEditorPane
          program={fbdProgram('{broken-json')}
          source="{broken-json"
          canEdit
          saving={false}
          onChange={onChange}
          onSave={async () => true}
          userPouInterfaces={[]}
        />
      </I18nProvider>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('FBD-SCHEMA-JSON-001')
    expect(screen.getByRole('alert')).toHaveTextContent(/Buffer gốc được giữ nguyên/)
    expect(screen.queryByRole('region', { name: /Bộ dựng FBD/ })).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('TC-FBD-STATE-003: thiếu schema gốc cũng fail-closed và không tự chuẩn hóa thành tài liệu rỗng', () => {
    const onChange = vi.fn()
    const missingRootSchema = structuredClone(golden()) as unknown as Record<string, unknown>
    delete missingRootSchema.$schema
    const source = JSON.stringify(missingRootSchema)
    render(
      <I18nProvider>
        <FbdEditorPane
          program={fbdProgram(source)}
          source={source}
          canEdit
          saving={false}
          onChange={onChange}
          onSave={async () => true}
          userPouInterfaces={[]}
        />
      </I18nProvider>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('FBD-SCHEMA-ROOT-001')
    expect(screen.queryByRole('region', { name: /Bộ dựng FBD/ })).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('TC-FBD-STATE-003: shape lồng/layout hỏng đều fail-closed, không làm sập workbench hoặc mất layout', () => {
    const onChange = vi.fn()
    const malformedLayout = golden()
    ;(malformedLayout as unknown as { layout: unknown }).layout = {
      schemaVersion: 1,
      nodes: { [malformedLayout.networks[0].nodes[0].id]: { x: 'không-phải-số', y: 24 } },
    }
    const rawMalformedLayout = JSON.stringify(malformedLayout)
    render(
      <I18nProvider>
        <FbdEditorPane
          program={fbdProgram(rawMalformedLayout)}
          source={rawMalformedLayout}
          canEdit
          saving={false}
          onChange={onChange}
          onSave={async () => true}
          userPouInterfaces={[]}
        />
      </I18nProvider>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('FBD-SCHEMA-LAYOUT-001')
    expect(onChange).not.toHaveBeenCalled()

    cleanup()
    render(
      <I18nProvider>
        <DesignWorkbench
          mode="EDIT"
          document={draft(fbdProgram(JSON.stringify({ networks: [{}] })))}
          source={null}
          sourceLabel="Draft · shape hỏng"
          checkOwnerHref="/commission"
          onSelectProgram={vi.fn()}
          onJumpToOffset={vi.fn()}
          onJumpToFbdSelection={vi.fn()}
        />
      </I18nProvider>,
    )
    fireEvent.click(screen.getByRole('tab', { name: /Vấn đề/ }))
    expect(screen.getByText('FBD-SCHEMA-JSON-001')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /FBD-SCHEMA-JSON-001/ })).toBeNull()
  })

  it('TC-FBD-STATE-006: Watch cũ/offline có freshness badge và không biến mất thành số 0', () => {
    render(
      <I18nProvider>
        <ProgrammingWorkbench
          mode="LIVE"
          sourceLabel="Active · FBD"
          problems={[]}
          symbols={[]}
          source={null}
          onJumpToOffset={vi.fn()}
          checkOwnerHref="/commission"
          watch={[{
            variableId: 'v-1', name: 'FanCmd', display: '—', state: 'stale',
            quality: 'OFFLINE', numeric: null,
          }]}
        />
      </I18nProvider>,
    )
    fireEvent.click(screen.getByRole('tab', { name: /Watch/ }))
    expect(screen.getByText('Mất kết nối')).toHaveAttribute('data-quality', 'OFFLINE')
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.queryByText(/^0(?:\.0+)?$/)).toBeNull()
  })

  it('Problems đọc buffer FBD chưa lưu qua pending operation, không chờ read-back', () => {
    const stored = golden()
    const edited = golden()
    edited.networks[0].nodes[2].typeRef = 'BOOL'
    const storedDraft = draft(fbdProgram(JSON.stringify(stored)))
    const projected = projectPendingProgramSources(storedDraft, [{
      op: 'replaceProgramSource',
      programId: 'P_fbd',
      language: 'FBD',
      source: JSON.stringify(edited),
    }])
    expect(projected.programs[0].document).toBe(JSON.stringify(edited))
    expect(storedDraft.programs[0].document).toBe(JSON.stringify(stored))
  })
})
