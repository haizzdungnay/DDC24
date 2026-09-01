import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '../../../../shared/i18n'
import type { ProgrammingDiagnostic, ProgrammingDraftDocument } from '../../model/types'
import { DesignWorkbench } from './DesignWorkbench'

beforeEach(() => localStorage.setItem('mkddc-lang', 'vi'))
afterEach(cleanup)

/** Draft hỗn hợp: một POU ST và một POU FBD hỏng cấu trúc.
 *
 * Hỗn hợp là điểm mấu chốt của `ISS-STED-05`: bất đối xứng ST/FBD chỉ lộ ra
 * khi hai loại cùng nằm trong một Draft. */
function mixedDocument(): ProgrammingDraftDocument {
  return {
    programs: [
      {
        programId: 'P_ahu',
        name: 'AHU',
        kind: 'PROGRAM',
        language: 'ST',
        document: 'PROGRAM AHU\nEND_PROGRAM\n',
      },
      {
        programId: 'P_fbd',
        name: 'Boiler',
        kind: 'PROGRAM',
        language: 'FBD',
        document: 'khong-phai-json',
      },
    ],
    variables: [],
    bindings: [],
    signals: [],
  } as unknown as ProgrammingDraftDocument
}

function stDiagnostic(overrides: Record<string, unknown> = {}): ProgrammingDiagnostic {
  return {
    code: 'PRG-ERR-CHECK-001',
    detailCode: 'ST-SEM-002',
    severity: 'ERROR',
    message: 'cannot assign REAL to BOOL variable',
    messageKey: 'programming.error.check',
    location: { programId: 'P_ahu', line: 4, column: 3, ...overrides },
  }
}

/** Bàn làm việc THU GỌN theo mặc định (`DEV-PROG-021`), nên test phải mở khay
 * trước khi đọc nội dung. Dải tab vẫn nằm nguyên kèm số đếm khi thu gọn — đó
 * chính là điều `DEV-PROG-021` giữ lại, và cũng là thứ AC "số đếm đúng cho hỗn
 * hợp" kiểm. */
function openProblems() {
  fireEvent.click(screen.getByRole('tab', { name: /Vấn đề/ }))
}

/** Nội dung khay dưới dạng một chuỗi.
 *
 * `getByText` không dùng được ở đây vì mã lỗi nằm trong `<span>` riêng còn nhãn
 * là text node kế bên, nên chuỗi người dùng ĐỌC THẤY bị tách qua nhiều node.
 * So trên `textContent` kiểm đúng thứ hiển thị thật. */
function panelText(): string {
  return screen.getByRole('tabpanel').textContent ?? ''
}

function renderWorkbench(props: Partial<Parameters<typeof DesignWorkbench>[0]> = {}) {
  return render(
    <I18nProvider>
      <DesignWorkbench
        mode="EDIT"
        document={mixedDocument()}
        source={'PROGRAM AHU\nEND_PROGRAM\n'}
        sourceLabel="AHU"
        checkOwnerHref="/eng/programming/projects/p1/commission"
        onSelectProgram={vi.fn()}
        onJumpToOffset={vi.fn()}
        {...props}
      />
    </I18nProvider>,
  )
}

describe('DesignWorkbench — khay Vấn đề (ISS-STED-05)', () => {
  /* Trước issue này `if (program.language !== 'FBD') continue` bỏ qua MỌI POU
   * ST, nên người dùng ST đọc "không có mục nào" thành "không có lỗi". */
  it('POU ST có lỗi ⇒ xuất hiện trong khay với mã và vị trí', () => {
    renderWorkbench({ checkDiagnostics: [stDiagnostic()], hasCheckResult: true })
    openProblems()
    expect(panelText()).toContain('ST-SEM-002')
    expect(panelText()).toContain('AHU › dòng 4, cột 3')
  })

  it('bấm một mục ST ⇒ nhảy tới đúng diagnostic đó', () => {
    const onJumpToDiagnostic = vi.fn()
    const diagnostic = stDiagnostic()
    renderWorkbench({ checkDiagnostics: [diagnostic], hasCheckResult: true, onJumpToDiagnostic })
    openProblems()
    fireEvent.click(screen.getByRole('button', { name: /AHU › dòng 4, cột 3/ }))
    expect(onJumpToDiagnostic).toHaveBeenCalledWith(diagnostic)
  })

  /* Số đếm trên nhãn tab phải đúng cho HỖN HỢP: một lỗi ST + một lỗi FBD.
   * Đếm chỉ một loại là đúng thứ bất đối xứng mà issue này gỡ. */
  it('nhãn tab đếm đúng cho hỗn hợp ST + FBD', () => {
    renderWorkbench({ checkDiagnostics: [stDiagnostic()], hasCheckResult: true })
    // Số đếm hiện NGAY trên dải tab kể cả khi khay đang thu gọn.
    expect(screen.getByRole('tab', { name: /Vấn đề \(2\)/ })).toBeInTheDocument()
    openProblems()
    // POU FBD có document không parse được ⇒ một mục FBD-SCHEMA-JSON-001.
    expect(panelText()).toContain('FBD-SCHEMA-JSON-001')
  })

  it('diagnostic của POU khác KHÔNG lọt vào mục của POU này', () => {
    renderWorkbench({
      checkDiagnostics: [stDiagnostic({ programId: 'P_khac' })],
      hasCheckResult: true,
    })
    openProblems()
    expect(panelText()).not.toContain('ST-SEM-002')
  })

  /* "Chưa kiểm tra" và "đã kiểm tra, không có lỗi" là hai câu KHÁC NHAU dẫn tới
   * hai hành động khác nhau. Gộp chúng là cách người dùng tin rằng chương trình
   * đã sạch trong khi chưa ai kiểm nó. */
  it('trạng thái rỗng: chưa Kiểm tra ⇒ nói "Chưa Kiểm tra"', () => {
    render(
      <I18nProvider>
        <DesignWorkbench
          mode="EDIT"
          document={{ programs: [], variables: [], bindings: [], signals: [] } as unknown as ProgrammingDraftDocument}
          source={null}
          sourceLabel=""
          checkOwnerHref="/x"
          onSelectProgram={vi.fn()}
          onJumpToOffset={vi.fn()}
          hasCheckResult={false}
        />
      </I18nProvider>,
    )
    openProblems()
    expect(panelText()).toContain('Chưa Kiểm tra')
    expect(panelText()).not.toContain('không có vấn đề nào.')
  })

  it('trạng thái rỗng: đã Kiểm tra và sạch ⇒ nói rõ revision', () => {
    render(
      <I18nProvider>
        <DesignWorkbench
          mode="EDIT"
          document={{ programs: [], variables: [], bindings: [], signals: [] } as unknown as ProgrammingDraftDocument}
          source={null}
          sourceLabel=""
          checkOwnerHref="/x"
          onSelectProgram={vi.fn()}
          onJumpToOffset={vi.fn()}
          hasCheckResult
          checkRevisionId="rev-7"
        />
      </I18nProvider>,
    )
    openProblems()
    expect(panelText()).toContain('Kiểm tra revision rev-7: không có vấn đề nào.')
  })
})
