import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, it, expect } from 'vitest'
import { StSimulatedSourceViewer } from './StSimulatedSourceViewer'
import { I18nProvider } from '../../../shared/i18n'
import type { StRuntimeOverlayState } from '../design/editor/StRuntimeValueOverlay'

const sampleStSource = `(* Chu thich header nhieu dong
   Dong 2: CmdMode = 99 khong duoc xuat gia tri vi nam trong comment
   Dong 3: InPermit = TRUE cung vay
*)
PROGRAM PRG_DO16_MODBUS
VAR_INPUT
    CmdMode : UINT;
    InPermit : BOOL;
END_VAR
VAR_OUTPUT
    DO01 : BOOL;
END_VAR
VAR
    Ch01 : FB_DO_CHANNEL;
    Blinker : FB_BLINK;
END_VAR

IF NOT Settled THEN
    Mask := 0; (* chu thich inline *)
END_IF;

Step := SEL(InPermit, 1, 16);
DO01 := InPermit;
END_PROGRAM`

const sampleRuntime: StRuntimeOverlayState = {
  status: 'ready',
  items: [
    { variableId: 'CmdMode', variableName: 'CmdMode', value: 10, valid: true, quality: 'GOOD', freshness: 'SIMULATION' },
    { variableId: 'InPermit', variableName: 'InPermit', value: true, valid: true, quality: 'GOOD', freshness: 'SIMULATION' },
    { variableId: 'DO01', variableName: 'DO01', value: true, valid: true, quality: 'GOOD', freshness: 'SIMULATION' },
    { variableId: 'Settled', variableName: 'Settled', value: false, valid: true, quality: 'GOOD', freshness: 'SIMULATION' },
    { variableId: 'Mask', variableName: 'Mask', value: 0, valid: true, quality: 'GOOD', freshness: 'SIMULATION' },
    { variableId: 'Step', variableName: 'Step', value: 16, valid: true, quality: 'GOOD', freshness: 'SIMULATION' },
    // FB Instance members
    { variableId: 'Ch01.Q', variableName: 'Ch01.Q', value: false, valid: true, quality: 'GOOD', freshness: 'SIMULATION' },
    { variableId: 'Ch01.Cmd', variableName: 'Ch01.Cmd', value: false, valid: true, quality: 'GOOD', freshness: 'SIMULATION' },
    { variableId: 'Ch01.Enable', variableName: 'Ch01.Enable', value: true, valid: true, quality: 'GOOD', freshness: 'SIMULATION' },
    { variableId: 'Blinker.Q', variableName: 'Blinker.Q', value: true, valid: true, quality: 'GOOD', freshness: 'SIMULATION' },
  ],
}

describe('StSimulatedSourceViewer', () => {
  afterEach(() => {
    cleanup()
  })

  it('hiển thị giá trị khai báo biến và Function Block instance (Ch01, Blinker)', () => {
    render(
      <I18nProvider>
        <StSimulatedSourceViewer
          source={sampleStSource}
          runtime={sampleRuntime}
          programName="PRG_DO16_MODBUS"
          bindings={[
            { variableName: 'DO01', pointId: 'DO-01' },
            { variableName: 'CmdMode', pointId: 'MSV-01' },
          ]}
          pointCatalogItems={[
            { pointId: 'DO-01', name: 'PUMP_START', tag: 'PUMP_START' },
            { pointId: 'MSV-01', name: 'DO16_MODE', tag: 'DO16_MODE' },
          ]}
        />
      </I18nProvider>,
    )

    // Kiểm tra tên POU và debug view container
    expect(screen.getAllByText('PRG_DO16_MODBUS').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByTestId('st-simulated-source-debug-view')).toBeInTheDocument()

    // Khai báo vô hướng
    expect(screen.getAllByText('CmdMode =').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('InPermit =').length).toBeGreaterThanOrEqual(1)

    // Khai báo Function Block instance (Ch01 và Blinker) xuất được giá trị cổng chính
    expect(screen.getAllByText('Ch01.Q =').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Blinker.Q =').length).toBeGreaterThanOrEqual(1)

    // Tên điểm kết nối hiển thị kèm nhãn
    expect(screen.getByText('DO16_MODE')).toBeInTheDocument()
    expect(screen.getAllByText('PUMP_START').length).toBeGreaterThanOrEqual(1)

    // Chú thích header dòng 2 không được xuất hiện dưới dạng giá trị mô phỏng 99
    expect(screen.queryByTitle(/CmdMode = 99/)).not.toBeInTheDocument()
  })

  it('dòng có nhiều hơn 1 biến mặc định chỉ hiện 1 biến và có nút +N để mở rộng', () => {
    render(
      <I18nProvider>
        <StSimulatedSourceViewer
          source={sampleStSource}
          runtime={sampleRuntime}
        />
      </I18nProvider>,
    )

    // Dòng Step := SEL(InPermit, 1, 16) có nhiều biến (Step, SEL, InPermit)
    // Mặc định chỉ hiển thị biến mục tiêu đầu tiên (Step = 16) và nút +N
    expect(screen.getAllByText('Step =').length).toBeGreaterThanOrEqual(1)
    const plusBtns = screen.getAllByTitle(new RegExp('Xem thêm \\d+ biến trên dòng|Show \\d+ more variables on line'))
    expect(plusBtns.length).toBeGreaterThanOrEqual(1)

    // Bấm +N trên dòng Step := SEL(...) để mở rộng dòng này
    fireEvent.click(plusBtns[plusBtns.length - 2])

    // Khi đã mở rộng: hàm SEL = cũng hiển thị trên dòng
    expect(screen.getAllByText('SEL =').length).toBeGreaterThanOrEqual(1)

    // Nút thu gọn xuất hiện
    const lessBtns = screen.getAllByTitle(new RegExp('Thu gọn còn 1 biến trên dòng|Collapse to 1 variable on line'))
    expect(lessBtns.length).toBeGreaterThanOrEqual(1)
    fireEvent.click(lessBtns[0])
  })

  it('hỗ trợ nút chuyển đổi Mở rộng tất cả / 1 biến mỗi dòng ở thanh công cụ', () => {
    render(
      <I18nProvider>
        <StSimulatedSourceViewer
          source={sampleStSource}
          runtime={sampleRuntime}
        />
      </I18nProvider>,
    )

    const toggleAllBtn = screen.getByTitle(/Mở rộng hiển thị tất cả|Expand to show all/)
    fireEvent.click(toggleAllBtn)

    // Sau khi mở rộng tất cả: SEL = hiển thị đầy đủ
    expect(screen.getAllByText('SEL =').length).toBeGreaterThanOrEqual(1)

    // Bấm lại để thu gọn tất cả về 1 biến/dòng
    const collapseAllBtn = screen.getByTitle(/Thu gọn về 1 biến|Collapse to 1 variable/)
    fireEvent.click(collapseAllBtn)
  })

  it('cho phép bật / tắt hiển thị giá trị mô phỏng trực tiếp trên dòng', () => {
    render(
      <I18nProvider>
        <StSimulatedSourceViewer
          source={sampleStSource}
          runtime={sampleRuntime}
        />
      </I18nProvider>,
    )

    const toggleBtn = screen.getByTitle(/Ẩn giá trị giả lập trên từng dòng|Hiện giá trị giả lập trên từng dòng|Hide inline simulation values|Show inline simulation values/)
    expect(screen.getAllByText('CmdMode =').length).toBeGreaterThanOrEqual(1)

    // Bấm ẩn
    fireEvent.click(toggleBtn)
    expect(screen.queryByText('CmdMode =')).not.toBeInTheDocument()

    // Bấm hiện lại
    fireEvent.click(toggleBtn)
    expect(screen.getAllByText('CmdMode =').length).toBeGreaterThanOrEqual(1)
  })

  it('hỗ trợ tìm kiếm dòng mã hoặc biến trong khung xem', () => {
    render(
      <I18nProvider>
        <StSimulatedSourceViewer
          source={sampleStSource}
          runtime={sampleRuntime}
        />
      </I18nProvider>,
    )

    const searchInput = screen.getByPlaceholderText(new RegExp('Tìm biến/dòng…|Find variable/line…'))
    fireEvent.change(searchInput, { target: { value: 'Settled' } })

    expect(screen.getByText('Settled =')).toBeInTheDocument()
  })

  it('cho phép chuyển sang chế độ Mã thô (Raw) và sao chép mã nguồn', () => {
    render(
      <I18nProvider>
        <StSimulatedSourceViewer
          source={sampleStSource}
          runtime={sampleRuntime}
        />
      </I18nProvider>,
    )

    const rawBtn = screen.getByText(/Mã thô|Raw/)
    fireEvent.click(rawBtn)

    const rawTextarea = screen.getByLabelText(/Mã nguồn đang mô phỏng|Simulated source/)
    expect(rawTextarea).toBeInTheDocument()
    expect(rawTextarea).toHaveValue(sampleStSource)

    const debugBtn = screen.getByText(/Gỡ lỗi|Debug/)
    fireEvent.click(debugBtn)
    expect(screen.getByTestId('st-simulated-source-debug-view')).toBeInTheDocument()
  })
})
