import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { I18nProvider } from '../../../../shared/i18n'
import { ContextInspector } from './ContextInspector'
import type { InspectorInput } from './inspectorContext'
import type { ProgrammingProgram } from '../../model/types'
import type { StRuntimeOverlayState } from '../editor/StRuntimeValueOverlay'

/**
 * `TC-PGM02-INS-01/03` ở lớp hiển thị.
 *
 * Điều quan trọng nhất được kiểm ở đây là **hai câu khác nhau phải trông khác
 * nhau**: "chưa biết" và "biết là không có" không được cùng hiện thành một ô
 * trống, và "chưa có mẫu runtime" không bao giờ được hiện thành `0`.
 */

const program: ProgrammingProgram = {
  programId: 'p-1', name: 'AHU_MAIN', kind: 'PROGRAM', language: 'ST', document: '',
}

function renderInspector(input: InspectorInput) {
  return render(
    <I18nProvider>
      <ContextInspector input={input} />
    </I18nProvider>,
  )
}

beforeEach(() => { localStorage.setItem('mkddc-lang', 'vi') })
afterEach(cleanup)

describe('ContextInspector — thu gọn khi không có ngữ cảnh', () => {
  it('không có gì đang mở ⇒ thu gọn một dòng, không chiếm chỗ', () => {
    renderInspector({})
    // Handoff §9 cấm chiếm 300px cho hai trường; đây là vế "thu gọn" của luật đó.
    expect(screen.getByTestId('inspector-collapsed')).toBeInTheDocument()
    expect(screen.getByTestId('context-inspector')).toHaveAttribute('data-context', 'EMPTY')
  })

  it('Program có chu kỳ ⇒ nở ra và hiện đúng ngữ cảnh', () => {
    renderInspector({ program, cycleMs: 5000 })
    expect(screen.queryByTestId('inspector-collapsed')).toBeNull()
    expect(screen.getByTestId('context-inspector')).toHaveAttribute('data-context', 'PROGRAM')
    expect(screen.getByText('AHU_MAIN')).toBeInTheDocument()
    // `DEV-PROG-004` — chu kỳ là bội của giây thì hiện theo giây ("5 s"): ba
    // chu kỳ hợp lệ của profile đều là bội của 1000 ms, và "30000 ms" bắt người
    // đọc tự chia trước khi so được với chu kỳ họ đã đặt.
    expect(screen.getByText('5 s')).toBeInTheDocument()
  })
})

describe('ContextInspector — "không xác định được" là một kết quả, không phải ô trống', () => {
  it('analyzer không tra được ký hiệu ⇒ nói thẳng, không để trống và không đoán', () => {
    renderInspector({
      program,
      cursorSymbol: { identifier: 'KhongRo', start: 0, end: 7, entry: null },
    })
    expect(screen.getByTestId('context-inspector')).toHaveAttribute('data-context', 'ST_SYMBOL')
    expect(screen.getByText('KhongRo')).toBeInTheDocument()
    // Kiểu, khai báo, chữ ký và số tham chiếu đều không tra được.
    expect(screen.getAllByText('không xác định được').length).toBeGreaterThanOrEqual(4)
  })

  it('Enable chưa được nối ⇒ hiện "không xác định được", KHÔNG hiện "Đã tắt"', () => {
    renderInspector({ program, cycleMs: 1000, enabled: null })
    expect(screen.queryByText('Đã tắt')).toBeNull()
  })

  it('DEV-PROG-004: chưa ghi chú thích ⇒ nói "chưa ghi", tuyệt đối không có giá trị mẫu', () => {
    renderInspector({ program, cycleMs: 1000 })
    // Trường CÓ mặt (khác `UD-PROG-015` cũ), nhưng nội dung phải nói ra rằng
    // Draft chưa có gì — không phải một ô trống trông như đã điền rồi xoá, và
    // càng không phải giá trị lấy từ ảnh render.
    expect(screen.getByText('Truy cập')).toBeInTheDocument()
    expect(screen.getByText('Mô tả')).toBeInTheDocument()
    expect(screen.getByText('chưa ghi mô tả')).toBeInTheDocument()
    expect(screen.queryByText(/Public/)).toBeNull()
    expect(screen.queryByText(/Control_Main/)).toBeNull()
  })

  it('DEV-PROG-004: chu kỳ đi kèm TÊN Task khi Draft có tên đó', () => {
    renderInspector({ program, cycleMs: 1000, taskName: 'Control_Main' })
    expect(screen.getByText('Control_Main (1 s)')).toBeInTheDocument()
  })
})

describe('ContextInspector — giá trị runtime dùng đúng bộ trình bày của overlay', () => {
  it('chưa có mẫu ⇒ gạch ngang, không bao giờ 0', () => {
    renderInspector({
      cursorSymbol: {
        identifier: 'Fan', start: 0, end: 3,
        entry: { name: 'Fan', typeName: 'BOOL', kind: 'VARIABLE', declarationOffset: 1, occurrences: [] },
      },
      runtime: { status: 'unavailable', reason: 'mất kết nối' },
    })
    // Soi ĐÚNG ô runtime: con số 0 ở nơi khác trên khay (vd số tham chiếu) là
    // dữ liệu thật, không phải giá trị bịa.
    expect(screen.getByTestId('inspector-runtime-value')).toHaveTextContent('—')
  })

  it('mẫu cũ giữ giá trị nhưng mang nhãn chữ, không chỉ dựa vào màu', () => {
    const runtime: StRuntimeOverlayState = {
      status: 'ready',
      items: [{ variableId: 'v', variableName: 'Fan', value: 42, valid: true, quality: 'STALE', freshness: 'STALE' }],
    }
    renderInspector({
      cursorSymbol: {
        identifier: 'Fan', start: 0, end: 3,
        entry: { name: 'Fan', typeName: 'INT', kind: 'VARIABLE', declarationOffset: 1, occurrences: [] },
      },
      runtime,
    })
    expect(screen.getByText('42')).toBeInTheDocument()
    // Màu không bao giờ là tín hiệu duy nhất.
    expect(screen.getByText('cũ')).toBeInTheDocument()
  })

  it('authority nói mẫu không hợp lệ ⇒ gạch ngang kể cả khi bit thô là 0', () => {
    const runtime: StRuntimeOverlayState = {
      status: 'ready',
      items: [{ variableId: 'v', variableName: 'Fan', value: 0, valid: false, quality: 'BAD', freshness: 'LIVE' }],
    }
    renderInspector({
      cursorSymbol: {
        identifier: 'Fan', start: 0, end: 3,
        entry: { name: 'Fan', typeName: 'INT', kind: 'VARIABLE', declarationOffset: 1, occurrences: [] },
      },
      runtime,
    })
    // Bit thô là 0 nhưng authority nói không hợp lệ ⇒ ô runtime phải là gạch
    // ngang. Đây đúng chỗ một bản sửa cẩu thả sẽ hiện `0`.
    expect(screen.getByTestId('inspector-runtime-value')).toHaveTextContent('—')
    expect(screen.getByTestId('inspector-runtime-value')).not.toHaveTextContent('0')
  })
})

describe('ContextInspector — ISS-STED-12: năm trường mới của ký hiệu ST', () => {
  const stSymbol = {
    identifier: 'SupplyTemp', start: 10, end: 20,
    entry: {
      name: 'SupplyTemp', typeName: 'REAL', kind: 'VARIABLE' as const, declarationOffset: 42,
      occurrences: [
        { offset: 42, role: 'WRITE' as const },
        { offset: 80, role: 'READ' as const },
        { offset: 95, role: 'READ' as const },
      ],
    },
  }
  const variable = {
    variableId: 'var-supply', programId: 'p-1', name: 'SupplyTemp',
    type: 'REAL', class: 'INPUT' as const, initialValue: null, retain: false,
  }
  const binding = {
    bindingId: 'b-1', variableId: 'var-supply',
    point: { category: 'LOCAL' as const, pointId: 'UI-01' },
    direction: 'READ' as const, dataType: 'REAL', unit: 'degC',
    writable: false, qualityPolicy: 'REQUIRE_GOOD' as const,
  }

  it('hiện đủ Phạm vi, Khởi tạo, Điểm ánh xạ, Đơn vị và Đọc/Ghi', () => {
    renderInspector({ program, cursorSymbol: stSymbol, variables: [variable], bindings: [binding] })
    const panel = screen.getByTestId('context-inspector')
    expect(panel).toHaveTextContent('VAR_INPUT')
    expect(panel).toHaveTextContent('LOCAL/UI-01')
    expect(panel).toHaveTextContent('degC')
    expect(panel).toHaveTextContent('2 / 1')
  })

  it('Khởi tạo nói rõ đây là mặc định của kiểu, không giả vờ ai đó đã đặt', () => {
    // Subset ST không cho khai giá trị khởi tạo trong `VAR`; người đọc phải
    // phân biệt được "mặc định" với "ai đó cố ý đặt 0.0".
    renderInspector({ program, cursorSymbol: stSymbol, variables: [variable], bindings: [binding] })
    expect(screen.getByTestId('context-inspector')).toHaveTextContent('0.0 (mặc định của kiểu)')
  })

  it('biến chưa có trong Draft ⇒ hiện "không xác định được", KHÔNG đoán', () => {
    renderInspector({ program, cursorSymbol: stSymbol, variables: [], bindings: [] })
    const panel = screen.getByTestId('context-inspector')
    // Ba trường phụ thuộc Draft đều phải nói thẳng là không tra được.
    expect(panel.textContent?.match(/không xác định được/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
    expect(panel).not.toHaveTextContent('VAR_INPUT')
  })
})
