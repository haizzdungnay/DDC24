import { describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFbdNodeResize } from './useFbdNodeResize'

describe('useFbdNodeResize', () => {
  const defaultViewport = { x: 0, y: 0, scale: 1 }

  function createPointerEvent(
    type: string,
    props: { clientX: number; clientY: number; pointerId?: number; button?: number },
  ) {
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    const stopPropagation = vi.fn()
    return {
      type,
      clientX: props.clientX,
      clientY: props.clientY,
      pointerId: props.pointerId ?? 1,
      button: props.button ?? 0,
      currentTarget: { setPointerCapture, releasePointerCapture },
      stopPropagation,
    } as unknown as React.PointerEvent<SVGElement>
  }

  it('bắt đầu resize khi beginResize được gọi', () => {
    const onResizeEnd = vi.fn()
    const { result } = renderHook(() =>
      useFbdNodeResize({
        canEdit: true,
        viewport: defaultViewport,
        snapEnabled: false,
        snapSize: 8,
        onResizeEnd,
      }),
    )

    const event = createPointerEvent('pointerdown', { clientX: 200, clientY: 100 })
    act(() => {
      result.current.beginResize(event, 'node-1', 'BOTH', 168, 70)
    })

    expect(result.current.resize).not.toBeNull()
    expect(result.current.resize?.nodeId).toBe('node-1')
    expect(result.current.resize?.startWidth).toBe(168)
    expect(result.current.resize?.startHeight).toBe(70)
    expect(event.currentTarget.setPointerCapture).toHaveBeenCalledWith(1)
  })

  it('moveResize cập nhật kích thước theo tỉ lệ kéo và giới hạn cận dưới minWidth, minHeight', () => {
    const onResizeEnd = vi.fn()
    const { result } = renderHook(() =>
      useFbdNodeResize({
        canEdit: true,
        viewport: defaultViewport,
        snapEnabled: false,
        snapSize: 8,
        minWidth: () => 120,
        minHeight: () => 60,
        onResizeEnd,
      }),
    )

    const downEvent = createPointerEvent('pointerdown', { clientX: 200, clientY: 100 })
    act(() => {
      result.current.beginResize(downEvent, 'node-1', 'BOTH', 168, 70)
    })

    // Kéo ra thêm 50px ngang, 30px dọc
    const moveEvent = createPointerEvent('pointermove', { clientX: 250, clientY: 130 })
    act(() => {
      result.current.moveResize(moveEvent)
    })

    expect(result.current.resize?.currentWidth).toBe(218)
    expect(result.current.resize?.currentHeight).toBe(100)

    // Kéo thu nhỏ quá mức -> bị chặn ở minWidth 120 và minHeight 60
    const shrinkEvent = createPointerEvent('pointermove', { clientX: 0, clientY: 0 })
    act(() => {
      result.current.moveResize(shrinkEvent)
    })

    expect(result.current.resize?.currentWidth).toBe(120)
    expect(result.current.resize?.currentHeight).toBe(60)
  })

  it('moveResize theo chế độ WIDTH chỉ đổi bề rộng', () => {
    const onResizeEnd = vi.fn()
    const { result } = renderHook(() =>
      useFbdNodeResize({
        canEdit: true,
        viewport: defaultViewport,
        snapEnabled: false,
        snapSize: 8,
        onResizeEnd,
      }),
    )

    const downEvent = createPointerEvent('pointerdown', { clientX: 200, clientY: 100 })
    act(() => {
      result.current.beginResize(downEvent, 'node-1', 'WIDTH', 168, 70)
    })

    const moveEvent = createPointerEvent('pointermove', { clientX: 268, clientY: 150 })
    act(() => {
      result.current.moveResize(moveEvent)
    })

    expect(result.current.resize?.currentWidth).toBe(236)
    expect(result.current.resize?.currentHeight).toBe(70) // giữ nguyên
  })

  it('moveResize theo chế độ HEIGHT chỉ đổi chiều cao', () => {
    const onResizeEnd = vi.fn()
    const { result } = renderHook(() =>
      useFbdNodeResize({
        canEdit: true,
        viewport: defaultViewport,
        snapEnabled: false,
        snapSize: 8,
        onResizeEnd,
      }),
    )

    const downEvent = createPointerEvent('pointerdown', { clientX: 200, clientY: 100 })
    act(() => {
      result.current.beginResize(downEvent, 'node-1', 'HEIGHT', 168, 70)
    })

    const moveEvent = createPointerEvent('pointermove', { clientX: 268, clientY: 120 })
    act(() => {
      result.current.moveResize(moveEvent)
    })

    expect(result.current.resize?.currentWidth).toBe(168) // giữ nguyên
    expect(result.current.resize?.currentHeight).toBe(90)
  })

  it('moveResize snap vào lưới snapSize khi snapEnabled = true', () => {
    const onResizeEnd = vi.fn()
    const { result } = renderHook(() =>
      useFbdNodeResize({
        canEdit: true,
        viewport: defaultViewport,
        snapEnabled: true,
        snapSize: 16,
        onResizeEnd,
      }),
    )

    const downEvent = createPointerEvent('pointerdown', { clientX: 100, clientY: 100 })
    act(() => {
      result.current.beginResize(downEvent, 'node-1', 'BOTH', 160, 80)
    })

    // Kéo 10px (chưa tới nửa bước 16 -> làm tròn về 0)
    const move1 = createPointerEvent('pointermove', { clientX: 107, clientY: 105 })
    act(() => {
      result.current.moveResize(move1)
    })
    expect(result.current.resize?.currentWidth).toBe(160)

    // Kéo 12px (hơn nửa bước 16 -> làm tròn thành 16)
    const move2 = createPointerEvent('pointermove', { clientX: 112, clientY: 112 })
    act(() => {
      result.current.moveResize(move2)
    })
    expect(result.current.resize?.currentWidth).toBe(176)
  })

  it('endResize phát onResizeEnd và giải phóng trạng thái', () => {
    const onResizeEnd = vi.fn()
    const { result } = renderHook(() =>
      useFbdNodeResize({
        canEdit: true,
        viewport: defaultViewport,
        snapEnabled: false,
        snapSize: 8,
        onResizeEnd,
      }),
    )

    const downEvent = createPointerEvent('pointerdown', { clientX: 100, clientY: 100 })
    act(() => {
      result.current.beginResize(downEvent, 'node-1', 'BOTH', 168, 70)
    })

    const moveEvent = createPointerEvent('pointermove', { clientX: 150, clientY: 120 })
    act(() => {
      result.current.moveResize(moveEvent)
    })

    const upEvent = createPointerEvent('pointerup', { clientX: 150, clientY: 120 })
    act(() => {
      result.current.endResize(upEvent)
    })

    expect(onResizeEnd).toHaveBeenCalledWith('node-1', 218, 90)
    expect(result.current.resize).toBeNull()
  })

  it('cancelResize huỷ resize mà không phát onResizeEnd', () => {
    const onResizeEnd = vi.fn()
    const { result } = renderHook(() =>
      useFbdNodeResize({
        canEdit: true,
        viewport: defaultViewport,
        snapEnabled: false,
        snapSize: 8,
        onResizeEnd,
      }),
    )

    const downEvent = createPointerEvent('pointerdown', { clientX: 100, clientY: 100 })
    act(() => {
      result.current.beginResize(downEvent, 'node-1', 'BOTH', 168, 70)
    })

    act(() => {
      result.current.cancelResize()
    })

    expect(onResizeEnd).not.toHaveBeenCalled()
    expect(result.current.resize).toBeNull()
  })
})
