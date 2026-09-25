import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '../../../../shared/i18n'
import { DesignWorkbench } from './DesignWorkbench'
import { simulationWatchRows } from '../../simulation/simulationSession'
import type { ProgrammingDraftDocument } from '../../model/types'

/*
`T59-816` / `PGM02-V22-WP-06-R3` — workbench dùng chung ở chế độ SIMULATE.

Điều đang kiểm không phải "khay có hiện lên không" mà là **khay nói về tài liệu
nào**. Trước lát này workbench luôn đọc buffer Draft, kể cả khi màn hình đang
chiếu bản đã niêm phong mà phiên mô phỏng chạy — hai tài liệu, một khay, không
có dấu hiệu nào phân biệt.
*/

const SEALED = 'PROGRAM AHU_SEALED\nVAR Setpoint : REAL; END_VAR\nSetpoint := 21.0;\nEND_PROGRAM\n'

function emptyDocument(): ProgrammingDraftDocument {
  return { schemaVersion: 2, programs: [], objects: [] } as unknown as ProgrammingDraftDocument
}

function renderWorkbench(props: Partial<Parameters<typeof DesignWorkbench>[0]>) {
  return render(
    <I18nProvider>
      <DesignWorkbench
        mode="SIMULATE"
        document={emptyDocument()}
        source={SEALED}
        sourceLabel="Bản đã niêm phong · AHU_SEALED"
        checkOwnerHref="/eng/programming/projects/p/commission"
        onSelectProgram={vi.fn()}
        onJumpToOffset={vi.fn()}
        {...props}
      />
    </I18nProvider>,
  )
}

function watchColumn() {
  const column = screen.getByTestId('workbench-watch-column')
  const expand = within(column).queryByRole('button', { name: /Mở rộng Watch|Expand Watch/ })
  if (expand) fireEvent.click(expand)
  return screen.getByTestId('workbench-watch-column')
}

afterEach(cleanup)

describe('workbench ở SIMULATE', () => {
  it('khai đúng nguồn đang hiển thị là bản đã niêm phong, không phải Draft', () => {
    renderWorkbench({ simulationWatch: [] })
    // Nhãn nguồn là thứ duy nhất cho biết khay đang nói về tài liệu nào.
    expect(screen.getByText(/SIMULATE · Bản đã niêm phong · AHU_SEALED/)).toBeInTheDocument()
  })

  it('tìm kiếm chạy trên nguồn đã niêm phong', () => {
    renderWorkbench({ simulationWatch: [] })
    fireEvent.click(screen.getByRole('tab', { name: /Tìm kiếm|Search/ }))
    fireEvent.change(screen.getByLabelText(/Tìm trong POU đang mở|Search the open POU/),
      { target: { value: 'AHU_SEALED' } })
    expect(screen.getByText(/PROGRAM AHU_SEALED/)).toBeInTheDocument()
  })

  it('giá trị mô phỏng không đọc được hiện — chứ KHÔNG hiện 0', () => {
    renderWorkbench({
      simulationWatch: [
        { observationId: 'Fast.Setpoint', name: 'Setpoint', value: 21.5, quality: 'GOOD', dataType: 'REAL' },
        // `UNAVAILABLE` là "chưa tính được ở nhịp này". Vẽ nó thành 0 tạo ra một
        // cú rơi thẳng đứng trông hệt như thiết bị vừa tắt.
        { observationId: 'Fast.Runs', name: 'Runs', value: null, quality: 'UNAVAILABLE', dataType: 'DINT' },
      ],
    })
    const column = watchColumn()
    expect(within(column).getByText('21.5')).toBeInTheDocument()
    expect(within(column).getAllByText('—').length).toBeGreaterThan(0)
    expect(within(column).queryByText('0')).not.toBeInTheDocument()
  })

  it('nhãn khay Watch nói nguồn là MÔ PHỎNG, không phải trực tiếp', () => {
    // Giá trị mô phỏng và giá trị của tủ trông giống hệt nhau. Nhãn là chỗ duy
    // nhất phân biệt, nên nó phải đổi theo chế độ.
    renderWorkbench({ simulationWatch: [] })
    const column = watchColumn()
    expect(within(column).getByText(/Watch \((Mô phỏng|Simulation)\)/)).toBeInTheDocument()
    expect(within(column).queryByText(/Watch \((Trực tiếp|Live)\)/)).not.toBeInTheDocument()
  })

  it('chưa mở phiên thì khay Watch GIẢI THÍCH thay vì hiện danh sách rỗng', () => {
    // Rỗng đọc như "không có gì đang chạy"; đúng sự thật là "chưa mở phiên".
    // Hai câu đó dẫn tới hai hành động khác nhau.
    renderWorkbench({ simulationWatch: null })
    const column = watchColumn()
    expect(within(column).queryByRole('table')).not.toBeInTheDocument()
    expect(within(column).getByText(/Chưa có nguồn giá trị runtime|No runtime watch source/)).toBeInTheDocument()
  })
})

describe('simulationWatchRows', () => {
  it('bỏ tiền tố Program khỏi tên hiển thị nhưng GIỮ observationId làm khoá', () => {
    const rows = simulationWatchRows({
      virtualTimeMs: 1000, snapshotSequence: 1, resetEpoch: 0,
      observations: [{ observationId: 'Fast.Setpoint', programId: 'Fast', variable: 'Setpoint',
        kind: 'OUTPUT', dataType: 'REAL', quality: 'GOOD', value: 4.5 }],
    })
    expect(rows).toEqual([{ observationId: 'Fast.Setpoint', name: 'Setpoint', value: 4.5,
      quality: 'GOOD', dataType: 'REAL' }])
  })

  it('quality UNAVAILABLE làm giá trị thành null, không giữ giá trị cũ', () => {
    // Giữ lại giá trị của nhịp trước cho một ô đã mất tín hiệu là cách màn hình
    // nói dối lâu nhất mà không ai phát hiện.
    const rows = simulationWatchRows({
      virtualTimeMs: 2000, snapshotSequence: 2, resetEpoch: 0,
      observations: [{ observationId: 'Fast.Runs', programId: 'Fast', variable: 'Runs',
        kind: 'OUTPUT', dataType: 'DINT', quality: 'UNAVAILABLE', value: 7 }],
    })
    expect(rows[0].value).toBeNull()
  })

  it('chưa có khung nào thì trả danh sách rỗng, không ném', () => {
    expect(simulationWatchRows(null)).toEqual([])
  })
})
