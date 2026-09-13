import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { CSSProperties } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ProgramsWorkspace, WorkspaceResizeHandle, clampPanelWidth } from './ProgramsWorkspace'

describe('ProgramsWorkspace — kích thước panel', () => {
  it('sở hữu khung bốn cột và chuyển tiếp nội dung EditorPane', () => {
    render(
      <ProgramsWorkspace style={{ '--pgm-explorer-width': '208px' } as CSSProperties}>
        <span>Editor slot</span>
      </ProgramsWorkspace>
    )
    const workspace = screen.getByTestId('programs-workspace')
    /* Thứ tự track phải khớp `AC-PGM02-004`: Explorer → Editor → Thư viện
     * nhanh → Inspector. jsdom không dựng lưới nên đây là chỗ duy nhất trong
     * lớp unit ghim được thứ tự; e2e `AC-PGM02-004` đo lại bằng toạ độ thật. */
    expect(workspace).toHaveClass('lg:grid-cols-[var(--pgm-explorer-width)_6px_minmax(320px,1fr)_6px_var(--pgm-library-width)_6px_var(--pgm-inspector-width)]')
    expect(workspace).toHaveTextContent('Editor slot')
  })

  it('giữ từng panel trong miền dùng được', () => {
    expect(clampPanelWidth('explorer', 20)).toBe(168)
    expect(clampPanelWidth('library', 999)).toBe(320)
    expect(clampPanelWidth('inspector', 271.6)).toBe(272)
    /* `NaN` rơi về MẶC ĐỊNH của panel, không rơi về sàn. Con số ở đây đi theo
       `DEFAULT_WIDTHS`, vốn đã được chỉnh lại theo ảnh chuẩn `PGM-02B`. */
    expect(clampPanelWidth('library', Number.NaN)).toBe(216)
  })

  it('resize handle có tên truy cập và chuyển đúng panel/hướng', () => {
    const onPointerDown = vi.fn()
    render(<WorkspaceResizeHandle label="Đổi kích thước Thư viện" panel="library" direction={-1} onPointerDown={onPointerDown} />)
    const handle = screen.getByRole('button', { name: 'Đổi kích thước Thư viện' })
    fireEvent.pointerDown(handle, { clientX: 400, pointerId: 1 })
    expect(onPointerDown).toHaveBeenCalledWith('library', -1, expect.any(Object))
  })
})
