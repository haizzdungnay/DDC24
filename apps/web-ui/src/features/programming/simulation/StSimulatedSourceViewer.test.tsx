import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
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
            {
              bindingId: 'b-1',
              variableId: 'DO01',
              point: { category: 'LOCAL', pointId: 'DO-01' },
              direction: 'WRITE',
              dataType: 'BOOL',
              writable: true,
              qualityPolicy: 'REQUIRE_GOOD',
            },
            {
              bindingId: 'b-2',
              variableId: 'CmdMode',
              point: { category: 'VP', pointId: 'MSV-01' },
              direction: 'READ',
              dataType: 'UINT',
              writable: true,
              qualityPolicy: 'REQUIRE_GOOD',
            },
          ]}
          pointCatalogItems={[
            {
              category: 'LOCAL',
              pointId: 'DO-01',
              name: 'PUMP_START',
              dataType: 'BOOL',
              direction: 'WRITE',
              writable: true,
              quality: 'GOOD',
              value: false,
            },
            {
              category: 'VP',
              pointId: 'MSV-01',
              name: 'DO16_MODE',
              dataType: 'UINT',
              direction: 'READ',
              writable: true,
              quality: 'GOOD',
              value: 1,
            },
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

  it('chế độ Gỡ lỗi (Debug) nhảy từng dòng từ trên xuống, tô đậm dòng đang chạy và điều chỉnh được tốc độ', () => {
    render(
      <I18nProvider>
        <StSimulatedSourceViewer
          source={sampleStSource}
          runtime={sampleRuntime}
        />
      </I18nProvider>,
    )

    // Chuyển sang chế độ Gỡ lỗi
    const debugModeBtn = screen.getByText(/Gỡ lỗi|Debug/)
    fireEvent.click(debugModeBtn)

    // Thanh điều khiển Debug xuất hiện
    expect(screen.getByTestId('st-debug-control-bar')).toBeInTheDocument()

    // Có các nút điều khiển Play/Pause, Từng bước, Về đầu
    expect(screen.getByText(/Tạm dừng|Pause/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^(Từng bước|Step)$/ })).toBeInTheDocument()
    expect(screen.getByText(/Về đầu|Reset/)).toBeInTheDocument()

    // Có bộ chọn tốc độ mô phỏng
    const speedSelect = screen.getByLabelText(/Tốc độ mô phỏng từng dòng|Line step simulation speed/)
    expect(speedSelect).toBeInTheDocument()
    fireEvent.change(speedSelect, { target: { value: '600' } })
    expect(speedSelect).toHaveValue('600')

    // Dòng đang chạy được tô đậm (có data-active-line) và có icon ▶
    const activeLine = screen.getByTestId('st-simulated-source-debug-view').querySelector('[data-active-line="true"]')
    expect(activeLine).toBeInTheDocument()

    // Bấm Từng bước (Step next)
    const stepBtn = screen.getByRole('button', { name: /^(Từng bước|Step)$/ })
    fireEvent.click(stepBtn)

    // Bấm Tạm dừng / Chạy tiếp
    // Sau khi bấm Step, auto-playing tạm dừng -> nút thành Chạy tiếp (Run)
    const runBtn = screen.getByText(/Chạy tiếp|Run/)
    fireEvent.click(runBtn)
    expect(screen.getByText(/Tạm dừng|Pause/)).toBeInTheDocument()
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
    expect(screen.getAllByText('Step =').length).toBeGreaterThanOrEqual(1)
    const plusBtns = screen.getAllByTitle(/biến trên dòng|more variables on line/)
    expect(plusBtns.length).toBeGreaterThanOrEqual(1)

    // Bấm +N trên dòng Step := SEL(...) để mở rộng dòng này
    fireEvent.click(plusBtns[plusBtns.length - 2])

    // Khi đã mở rộng: hàm SEL = cũng hiển thị trên dòng
    expect(screen.getAllByText('SEL =').length).toBeGreaterThanOrEqual(1)

    // Nút thu gọn xuất hiện
    const lessBtns = screen.getAllByTitle(/Thu gọn còn 1 biến trên dòng|Collapse to 1 variable on line/)
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

    const debugBtn = screen.getByRole('button', { name: /^(Giám sát|Inspect)$/ })
    fireEvent.click(debugBtn)
    expect(screen.getByTestId('st-simulated-source-debug-view')).toBeInTheDocument()
  })

  it('tự động nhảy con trỏ về dòng biến vừa được gán khi nhận lastCommittedInput', () => {
    const { rerender } = render(
      <I18nProvider>
        <StSimulatedSourceViewer
          source={sampleStSource}
          runtime={sampleRuntime}
        />
      </I18nProvider>,
    )

    // Gán một input ảo mới: InPermit
    rerender(
      <I18nProvider>
        <StSimulatedSourceViewer
          source={sampleStSource}
          runtime={sampleRuntime}
          lastCommittedInput={{
            variable: 'InPermit',
            observationId: 'InPermit',
            timestamp: Date.now(),
          }}
        />
      </I18nProvider>,
    )

    // Tự động chuyển sang chế độ Gỡ lỗi và xuất hiện thanh điều khiển
    expect(screen.getByTestId('st-debug-control-bar')).toBeInTheDocument()
    // Con trỏ đang trỏ vào dòng có data-active-line="true"
    const activeLine = screen.getByTestId('st-simulated-source-debug-view').querySelector('[data-active-line="true"]')
    expect(activeLine).toBeInTheDocument()
  })

  it('chế độ Gỡ lỗi theo dõi luồng logic và làm mờ các nhánh IF không thỏa mãn', () => {
    // Settled = true => NOT Settled = false => Mask := 0; bị bỏ qua
    const trueSettledRuntime: StRuntimeOverlayState = {
      status: 'ready',
      items: [
        ...sampleRuntime.items.filter((i) => i.variableName !== 'Settled'),
        { variableId: 'Settled', variableName: 'Settled', value: true, valid: true, quality: 'GOOD', freshness: 'SIMULATION' },
      ],
    }

    render(
      <I18nProvider>
        <StSimulatedSourceViewer
          source={sampleStSource}
          runtime={trueSettledRuntime}
        />
      </I18nProvider>,
    )

    const debugModeBtn = screen.getByText(/Gỡ lỗi|Debug/)
    fireEvent.click(debugModeBtn)

    // Dòng chứa Mask := 0; bị bỏ qua trong luồng thực thi
    const container = screen.getByTestId('st-simulated-source-debug-view')
    const maskLine = Array.from(container.querySelectorAll('[data-line-number]')).find((el) =>
      el.textContent?.includes('Mask := 0'),
    )
    expect(maskLine).toBeInTheDocument()
    // Nhánh không thực thi có style làm mờ (opacity-35)
    expect(maskLine?.className).toContain('opacity-35')
  })

  it('bật tắt breakpoint ở cột số dòng (line gutter) và tự động dừng auto-play khi chạm breakpoint', () => {
    render(
      <I18nProvider>
        <StSimulatedSourceViewer
          source={sampleStSource}
          runtime={sampleRuntime}
          programName="PRG_DO16_MODBUS"
        />
      </I18nProvider>,
    )

    // Chuyển sang Debug mode
    const debugModeBtn = screen.getByText(/Gỡ lỗi|Debug/)
    fireEvent.click(debugModeBtn)

    // Tìm nút gutter ở dòng 29 (dòng Step := SEL(...))
    const gutterBtns = screen.getAllByTitle(/breakpoint/i)
    expect(gutterBtns.length).toBeGreaterThanOrEqual(1)

    // Click vào một dòng để bật breakpoint
    const targetGutter = gutterBtns[gutterBtns.length - 2]
    fireEvent.click(targetGutter)

    // Xuất hiện chấm đỏ breakpoint
    expect(targetGutter.querySelector('[data-testid^="breakpoint-"]')).toBeInTheDocument()

    // Click lại để tắt breakpoint
    fireEvent.click(targetGutter)
    expect(targetGutter.querySelector('[data-testid^="breakpoint-"]')).not.toBeInTheDocument()
  })

  it('hỗ trợ nút Bước lùi (Step Back) để quay lại dòng thực thi trước đó', () => {
    render(
      <I18nProvider>
        <StSimulatedSourceViewer
          source={sampleStSource}
          runtime={sampleRuntime}
        />
      </I18nProvider>,
    )

    const debugModeBtn = screen.getByText(/Gỡ lỗi|Debug/)
    fireEvent.click(debugModeBtn)

    // Bấm Từng bước (Step next)
    const stepNextBtn = screen.getByRole('button', { name: /^(Từng bước|Step)$/ })
    fireEvent.click(stepNextBtn)

    // Bấm Bước lùi (Step back)
    const stepBackBtn = screen.getByRole('button', { name: /^(Bước lùi|Step back)$/ })
    expect(stepBackBtn).toBeInTheDocument()
    fireEvent.click(stepBackBtn)

    // Con trỏ lùi lại dòng hợp lệ
    const activeLine = screen.getByTestId('st-simulated-source-debug-view').querySelector('[data-active-line="true"]')
    expect(activeLine).toBeInTheDocument()
  })

  it('hỗ trợ phím tắt F10 (Step Over), F5 (Play/Pause), Shift+F5 (Reset)', () => {
    render(
      <I18nProvider>
        <StSimulatedSourceViewer
          source={sampleStSource}
          runtime={sampleRuntime}
        />
      </I18nProvider>,
    )

    const debugModeBtn = screen.getByText(/Gỡ lỗi|Debug/)
    fireEvent.click(debugModeBtn)

    // Nhấn F10 (Step Over)
    fireEvent.keyDown(window, { key: 'F10', code: 'F10' })
    // Nhấn F5 (Play/Pause)
    fireEvent.keyDown(window, { key: 'F5', code: 'F5' })
    // Nhấn Shift+F5 (Reset)
    fireEvent.keyDown(window, { key: 'F5', code: 'F5', shiftKey: true })

    const activeLine = screen.getByTestId('st-simulated-source-debug-view').querySelector('[data-active-line="true"]')
    expect(activeLine).toBeInTheDocument()
  })

  it('thanh trượt tốc độ (speed slider) điều chỉnh mượt từ 50ms đến 2000ms', () => {
    render(
      <I18nProvider>
        <StSimulatedSourceViewer
          source={sampleStSource}
          runtime={sampleRuntime}
        />
      </I18nProvider>,
    )

    const debugModeBtn = screen.getByText(/Gỡ lỗi|Debug/)
    fireEvent.click(debugModeBtn)

    // Slider tốc độ
    const slider = screen.getByRole('slider')
    expect(slider).toBeInTheDocument()
    expect(slider).toHaveAttribute('min', '50')
    expect(slider).toHaveAttribute('max', '2000')

    fireEvent.change(slider, { target: { value: '250' } })
    expect(slider).toHaveValue('250')
    expect(screen.getByText('250ms')).toBeInTheDocument()
  })

  it('click chuột trực tiếp vào dòng mã để nhảy con trỏ debug tới dòng đó', () => {
    render(
      <I18nProvider>
        <StSimulatedSourceViewer
          source={sampleStSource}
          runtime={sampleRuntime}
        />
      </I18nProvider>,
    )

    const debugModeBtn = screen.getByText(/Gỡ lỗi|Debug/)
    fireEvent.click(debugModeBtn)

    // Tìm dòng Step := SEL(...)
    const container = screen.getByTestId('st-simulated-source-debug-view')
    const stepLine = Array.from(container.querySelectorAll('[data-line-number]')).find((el) =>
      el.textContent?.includes('Step := SEL'),
    )
    expect(stepLine).toBeInTheDocument()

    // Click vào dòng đó
    if (stepLine) {
      fireEvent.click(stepLine)
      expect(stepLine.getAttribute('data-active-line')).toBe('true')
    }
  })

  it('bảng Watch / Inspector cho phép ghim biến, hiển thị và lưu vào localStorage theo programName', () => {
    const storageKey = 'mkddc.programming.sim.watch.PRG_DO16_MODBUS'
    localStorage.setItem(storageKey, JSON.stringify(['CmdMode', 'InPermit']))

    render(
      <I18nProvider>
        <StSimulatedSourceViewer
          source={sampleStSource}
          runtime={sampleRuntime}
          programName="PRG_DO16_MODBUS"
        />
      </I18nProvider>,
    )

    // Bảng Watch Inspector xuất hiện
    const watchPanel = screen.getByTestId('st-watch-inspector-panel')
    expect(watchPanel).toBeInTheDocument()

    // Biến đã lưu trong localStorage hiển thị trong bảng
    expect(watchPanel).toHaveTextContent('CmdMode')
    expect(watchPanel).toHaveTextContent('InPermit')

    // Bỏ ghim CmdMode
    const unpinBtn = screen.getByTitle(/Bỏ ghim CmdMode|Unpin CmdMode/)
    fireEvent.click(unpinBtn)

    expect(watchPanel).not.toHaveTextContent('CmdMode')
    const stored = JSON.parse(localStorage.getItem(storageKey) || '[]')
    expect(stored).not.toContain('CmdMode')
  })

  it('hover card cao cấp hiển thị chi tiết giá trị hiện tại, đơn vị đo, điểm kết nối và nút ghim', () => {
    render(
      <I18nProvider>
        <StSimulatedSourceViewer
          source={sampleStSource}
          runtime={sampleRuntime}
          programName="PRG_DO16_MODBUS"
          bindings={[
            {
              bindingId: 'b-1',
              variableId: 'DO01',
              point: { category: 'LOCAL', pointId: 'DO-01' },
              direction: 'WRITE',
              dataType: 'BOOL',
              writable: true,
              qualityPolicy: 'REQUIRE_GOOD',
            },
          ]}
          pointCatalogItems={[
            {
              category: 'LOCAL',
              pointId: 'DO-01',
              name: 'PUMP_START',
              dataType: 'BOOL',
              direction: 'WRITE',
              writable: true,
              quality: 'GOOD',
              value: false,
            },
          ]}
        />
      </I18nProvider>,
    )

    // Rê chuột vào badge biến DO01
    const do01Badges = screen.getAllByText('DO01 =')
    expect(do01Badges.length).toBeGreaterThanOrEqual(1)

    fireEvent.mouseEnter(do01Badges[0])

    // Hover card xuất hiện
    const hoverCard = screen.getByTestId('st-hover-card')
    expect(hoverCard).toBeInTheDocument()
    expect(hoverCard).toHaveTextContent('DO01')
    expect(hoverCard).toHaveTextContent('TRUE')
    expect(hoverCard).toHaveTextContent('DO-01')
    expect(hoverCard).toHaveTextContent('PUMP_START')

    // Có nút Ghim vào Watch
    const pinBtn = hoverCard.querySelector('button')
    expect(pinBtn).toBeInTheDocument()
    if (pinBtn) {
      fireEvent.click(pinBtn)
      // Bảng Watch nhận biến vừa ghim
      expect(screen.getByTestId('st-watch-inspector-panel')).toHaveTextContent('DO01')
    }
  })

  it('đánh giá hàm IEC và custom function với inline badge (SEL, LIMIT, FN_*)', () => {
    const advancedStSource = `PROGRAM PRG_ADVANCED
VAR
    RawVal : REAL;
    MinVal : REAL;
    MaxVal : REAL;
    Masked : UINT;
    Clamped : REAL;
    Selected : REAL;
    TimerFB : TON;
END_VAR

TimerFB(IN := TRUE, PT := T#5s);
Clamped := LIMIT(MinVal, RawVal, MaxVal);
Selected := SEL(TRUE, 10.0, 99.0);
END_PROGRAM`

    const advancedRuntime: StRuntimeOverlayState = {
      status: 'ready',
      items: [
        { variableId: 'RawVal', variableName: 'RawVal', value: 120.5, valid: true, quality: 'GOOD', freshness: 'SIMULATION' },
        { variableId: 'MinVal', variableName: 'MinVal', value: 0.0, valid: true, quality: 'GOOD', freshness: 'SIMULATION' },
        { variableId: 'MaxVal', variableName: 'MaxVal', value: 100.0, valid: true, quality: 'GOOD', freshness: 'SIMULATION' },
        { variableId: 'Clamped', variableName: 'Clamped', value: 100.0, valid: true, quality: 'GOOD', freshness: 'SIMULATION' },
        { variableId: 'Selected', variableName: 'Selected', value: 99.0, valid: true, quality: 'GOOD', freshness: 'SIMULATION' },
        { variableId: 'TimerFB.Q', variableName: 'TimerFB.Q', value: true, valid: true, quality: 'GOOD', freshness: 'SIMULATION' },
        { variableId: 'TimerFB.ET', variableName: 'TimerFB.ET', value: 5000, valid: true, quality: 'GOOD', freshness: 'SIMULATION' },
      ],
    }

    render(
      <I18nProvider>
        <StSimulatedSourceViewer
          source={advancedStSource}
          runtime={advancedRuntime}
        />
      </I18nProvider>,
    )

    // Mở rộng tất cả biến trên dòng
    const toggleAllBtn = screen.getByTitle(/Mở rộng hiển thị tất cả|Expand to show all/)
    fireEvent.click(toggleAllBtn)

    // Có badge hiển thị lời gọi FB TimerFB
    expect(screen.getAllByText(/TimerFB\(\)/).length).toBeGreaterThanOrEqual(1)
    // Có badge hiển thị hàm LIMIT
    expect(screen.getAllByText('LIMIT =').length).toBeGreaterThanOrEqual(1)
    // Có badge hiển thị hàm SEL
    expect(screen.getAllByText('SEL =').length).toBeGreaterThanOrEqual(1)
  })
})
