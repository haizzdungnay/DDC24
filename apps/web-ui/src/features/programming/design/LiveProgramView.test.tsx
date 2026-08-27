import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '../../../shared/i18n'
import { LiveProgramView } from './LiveProgramView'
import type { ProgrammingProgram } from '../model/types'

const REVISION = '33333333-3333-4333-8333-333333333333'
const OBJECT = '44444444-4444-4444-8444-444444444444'
const ACTIVE_SOURCE = 'PROGRAM AHU_RUNNING\nEND_PROGRAM\n'

const state = vi.hoisted(() => ({
  runtime: null as unknown,
  revision: null as unknown,
  monitor: null as unknown,
}))

vi.mock('../api/queries', () => ({
  useProgrammingRevision: () => state.revision,
}))

const program: ProgrammingProgram = {
  programId: 'program-a', name: 'AHU_RUNNING', kind: 'PROGRAM', language: 'ST', document: 'DRAFT — KHÔNG ĐƯỢC HIỆN Ở LIVE',
}

function revisionBody(source: unknown = ACTIVE_SOURCE) {
  return {
    revisionId: REVISION,
    snapshot: {
      objects: [{
        objectId: OBJECT, kind: 'PROGRAM',
        payload: { objectId: OBJECT, kind: 'PROGRAM', name: 'AHU_RUNNING', language: 'ST', source },
      }],
    },
  }
}

/* `monitor` và `activeRevisionId` là PROP, không phải hook: trang cha đã poll
 * monitor rồi, gọi lại hook ở đây là bộ poll thứ hai trên cùng endpoint. */
function renderLive(objectId: string | undefined = OBJECT) {
  render(
    <I18nProvider>
      <LiveProgramView
        program={program}
        objectId={objectId}
        activeRevisionId={(state.runtime as { data?: { activeRevisionId: string | null } }).data?.activeRevisionId ?? null}
        monitor={state.monitor as never}
      />
    </I18nProvider>,
  )
}

beforeEach(() => {
  localStorage.setItem('mkddc-lang', 'vi')
  state.runtime = { status: 'ready', data: { activeRevisionId: REVISION }, error: null, refresh: vi.fn() }
  state.revision = { status: 'ready', data: revisionBody(), error: null, refresh: vi.fn() }
  state.monitor = {
    status: 'ready', error: null, failure: null, producerRestarted: false, refresh: vi.fn(),
    data: { schemaVersion: '1.0', activeRevisionId: REVISION, producer: { capturedMonotonicNs: '1000' }, safeState: false, task: null, items: [] },
  }
})
afterEach(cleanup)

/*
 * `AC-ST-007` — "LIVE displays Active source, never mismatched Draft".
 *
 * Draft và Active trông GIỐNG HỆT nhau trên màn hình. Người vận hành đọc nhầm
 * Draft thành thứ đang điều khiển tủ là một lỗi không có dấu hiệu bên ngoài nào
 * cả — nên mọi nhánh không chứng minh được phải từ chối hiển thị.
 */
describe('LiveProgramView (T59-811)', () => {
  it('hiện nguồn của gói ĐANG CHẠY, không phải Draft', () => {
    renderLive()
    const source = screen.getByLabelText(/Mã nguồn đang chạy/) as HTMLTextAreaElement
    expect(source.value).toBe(ACTIVE_SOURCE)
    expect(source.value).not.toContain('DRAFT')
    expect(source).toHaveAttribute('readonly')
  })

  it('chỉ đọc là thuộc tính của CHẾ ĐỘ, không phải của vai', () => {
    renderLive()
    expect(screen.getByText('Chỉ đọc với mọi vai')).toBeInTheDocument()
    // Không có đường sửa nào trong khay LIVE.
    expect(screen.queryByRole('button', { name: 'Lưu' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Định dạng/ })).toBeNull()
  })

  it('nêu Revision đang chạy để người đọc biết mình đang xem gói nào', () => {
    renderLive()
    expect(screen.getByText(REVISION)).toBeInTheDocument()
  })

  it('phản hồi thuộc Revision KHÁC ⇒ từ chối hiển thị, không rơi về Draft', () => {
    state.revision = {
      status: 'ready', error: null, refresh: vi.fn(),
      data: { revisionId: 'aaaaaaaa-1111-4111-8111-111111111111', snapshot: { objects: [] } },
    }
    renderLive()
    expect(screen.queryByLabelText(/Mã nguồn đang chạy/)).toBeNull()
    expect(screen.getByText(/thuộc một Revision khác/)).toBeInTheDocument()
  })

  it('chưa Commission gói nào ⇒ nói thẳng, không hiện Draft', () => {
    state.runtime = { status: 'ready', data: { activeRevisionId: null }, error: null, refresh: vi.fn() }
    renderLive()
    expect(screen.queryByLabelText(/Mã nguồn đang chạy/)).toBeNull()
    expect(screen.getByText(/chưa Commission gói nào/)).toBeInTheDocument()
  })

  it('POU mới tạo ở Draft chưa Commission ⇒ nói đúng lý do đó', () => {
    renderLive('99999999-9999-4999-8999-999999999999')
    expect(screen.queryByLabelText(/Mã nguồn đang chạy/)).toBeNull()
    expect(screen.getByText(/chưa có trong gói đang chạy/)).toBeInTheDocument()
  })

  it('thân POU không đọc được KHÁC HẲN chương trình rỗng', () => {
    state.revision = { status: 'ready', error: null, refresh: vi.fn(), data: revisionBody(123) }
    renderLive()
    expect(screen.getByText(/thân của nó không đọc được/)).toBeInTheDocument()

    cleanup()
    state.revision = { status: 'ready', error: null, refresh: vi.fn(), data: revisionBody('') }
    renderLive()
    const empty = screen.getByLabelText(/Mã nguồn đang chạy/) as HTMLTextAreaElement
    expect(empty.value).toBe('')
  })

  it('lớp giá trị runtime fail-closed khi snapshot lệch Revision', () => {
    state.monitor = {
      status: 'ready', error: null, failure: null, producerRestarted: false, refresh: vi.fn(),
      data: { schemaVersion: '1.0', activeRevisionId: 'khac-revision', producer: { capturedMonotonicNs: '1000' }, safeState: false, task: null, items: [] },
    }
    renderLive()
    expect(screen.getByText(/Không đọc được giá trị runtime/)).toBeInTheDocument()
  })
})

/* `AC-FBD-009`..`AC-FBD-011` — sơ đồ FBD của gói ĐANG CHẠY.
 *
 * Đây là cửa sổ ĐỌC, không phải editor: vẽ chỉ canvas chứ không mount cả
 * `StructuredFbdEditor`, vì editor mang theo palette/toolbar/bộ lệnh sửa và tắt
 * từng thứ một là một danh sách phải nhớ giữ đúng mãi mãi. */
describe('LiveProgramView — sơ đồ FBD đang chạy (T59-811)', () => {
  const FBD_DOC = {
    $schema: '../../fbd_v1.schema.json', schemaVersion: 1, profileId: 'revA-1t-1-5-30',
    graphId: '10000000-0000-4000-8000-000000000001', name: 'AHU_FBD',
    networks: [{
      id: '20000000-0000-4000-8000-000000000001', name: 'ENABLE_LOGIC', order: 0,
      nodes: [{
        id: '30000000-0000-4000-8000-000000000001', kind: 'INPUT', typeRef: 'BOOL',
        executionOrder: 0, parameters: { variable: 'OCCUPIED' },
        ports: [{ id: '40000000-0000-4000-8000-000000000001', name: 'OUT', direction: 'OUTPUT', dataType: 'BOOL', unit: null, order: 0 }]
      }],
      wires: []
    }]
  }

  function renderFbdLive(source: string) {
    state.revision = {
      status: 'ready', error: null, refresh: vi.fn(),
      data: {
        revisionId: REVISION,
        snapshot: { objects: [{ objectId: OBJECT, kind: 'PROGRAM', payload: { objectId: OBJECT, kind: 'PROGRAM', name: 'AHU_FBD', language: 'FBD', source } }] },
      },
    }
    renderLive()
  }

  it('vẽ SƠ ĐỒ chứ không phải JSON thô, và không mount bộ công cụ sửa', () => {
    renderFbdLive(JSON.stringify(FBD_DOC))
    expect(screen.getByRole('group', { name: /Sơ đồ ENABLE_LOGIC/ })).toBeInTheDocument()
    // Không có JSON thô nào lọt ra màn hình.
    expect(screen.queryByLabelText(/Mã nguồn đang chạy/)).toBeNull()
    // Và không có bộ công cụ sửa nào được mount.
    expect(screen.queryByRole('toolbar', { name: /Lệnh FBD/ })).toBeNull()
    expect(screen.queryByRole('group', { name: /Palette FBD/ })).toBeNull()
  })

  it('block chọn được để xem, nhưng KHÔNG kéo được (chỉ đọc)', () => {
    renderFbdLive(JSON.stringify(FBD_DOC))
    const block = screen.getByRole('button', { name: /#0 · BOOL/ })
    fireEvent.keyDown(block, { key: 'Enter' })
    expect(block).toHaveAttribute('aria-pressed', 'true')
    // `canEdit=false` ⇒ con trỏ không phải "kéo được"
    expect(block.getAttribute('class')).not.toContain('cursor-move')
  })

  it('tài liệu FBD hỏng nói ra, KHÔNG vẽ một sơ đồ trống trông như chương trình rỗng', () => {
    renderFbdLive('{ không phải json')
    expect(screen.getByText(/không đọc được/)).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /Sơ đồ/ })).toBeNull()
  })
})
