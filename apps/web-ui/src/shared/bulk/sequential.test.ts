import { describe, expect, it, vi } from 'vitest'
import { runSequential, summarizeSequential, type SequentialItem } from './sequential'

/**
 * Test khoá HÀNH VI cho bộ chạy tuần tự dùng chung (`T57-1.4` + `T57-1.6`).
 *
 * Ba luật ở docstring của `sequential.ts` được khoá ở đây MỘT lần cho cả hai
 * màn hình — đó chính là lý do module này tồn tại.
 */

function item(id: string): SequentialItem {
  return { id, label: `Nhãn ${id}` }
}

describe('runSequential — luật 1: tuần tự, một request mỗi phần tử', () => {
  it('gọi đúng thứ tự và đúng số lần ⇒ n phần tử cho n vết kiểm toán', async () => {
    const order: string[] = []
    const send = vi.fn(async (element: SequentialItem) => { order.push(element.id) })
    const outcomes = await runSequential([item('A'), item('B'), item('C')], send)
    expect(order).toEqual(['A', 'B', 'C'])
    expect(send).toHaveBeenCalledTimes(3)
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['sent', 'sent', 'sent'])
  })

  it('không chồng lấn: phần tử sau chỉ bắt đầu khi phần tử trước đã xong', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const send = async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await Promise.resolve()
      inFlight -= 1
    }
    await runSequential([item('A'), item('B'), item('C')], send)
    expect(maxInFlight).toBe(1)
  })

  it('giữ nhãn để nơi gọi không phải tra ngược danh sách', async () => {
    const outcomes = await runSequential([item('A')], async () => {})
    expect(outcomes[0].label).toBe('Nhãn A')
  })
})

describe('runSequential — luật 2: một phần tử hỏng không dừng phần còn lại', () => {
  it('phần tử giữa hỏng ⇒ phần tử sau vẫn được gửi', async () => {
    const send = vi.fn(async (element: SequentialItem) => {
      if (element.id === 'B') throw new Error('403 forbidden')
    })
    const outcomes = await runSequential([item('A'), item('B'), item('C')], send)
    expect(send).toHaveBeenCalledTimes(3)
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['sent', 'failed', 'sent'])
  })

  it('mọi phần tử hỏng ⇒ vẫn thử hết, không dừng ở cái đầu', async () => {
    const send = vi.fn(async () => { throw new Error('boom') })
    const outcomes = await runSequential([item('A'), item('B')], send)
    expect(send).toHaveBeenCalledTimes(2)
    expect(outcomes.every((outcome) => outcome.status === 'failed')).toBe(true)
  })

  it('giữ NGUYÊN VĂN lỗi, không diễn dịch thành câu chung chung', async () => {
    const outcomes = await runSequential([item('A')], async () => { throw new Error('409 conflict: revision mismatch') })
    expect(outcomes[0].message).toBe('409 conflict: revision mismatch')
  })

  it('giá trị ném không phải Error vẫn có thông điệp đọc được', async () => {
    const outcomes = await runSequential([item('A')], async () => { throw 'chuỗi lỗi thô' })
    expect(outcomes[0].message).toBe('chuỗi lỗi thô')
  })
})

describe('runSequential — luật 3: huỷ dừng phần chưa gửi', () => {
  it('huỷ sau phần tử đầu ⇒ hai phần tử sau là skipped, KHÔNG phải failed', async () => {
    // Phân biệt này quan trọng: `failed` nghĩa là đã thử và bị từ chối;
    // `skipped` nghĩa là chưa từng chạm tới thiết bị.
    let aborted = false
    const send = vi.fn(async (element: SequentialItem) => { if (element.id === 'A') aborted = true })
    const outcomes = await runSequential([item('A'), item('B'), item('C')], send, { isAborted: () => aborted })
    expect(send).toHaveBeenCalledTimes(1)
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['sent', 'skipped', 'skipped'])
  })

  it('cờ huỷ được ĐỌC LẠI trước mỗi phần tử, không chụp một lần', async () => {
    const isAborted = vi.fn(() => false)
    await runSequential([item('A'), item('B'), item('C')], async () => {}, { isAborted })
    expect(isAborted).toHaveBeenCalledTimes(3)
  })

  it('huỷ TRƯỚC khi bắt đầu ⇒ không phần tử nào được gửi', async () => {
    const send = vi.fn(async () => {})
    const outcomes = await runSequential([item('A'), item('B')], send, { isAborted: () => true })
    expect(send).not.toHaveBeenCalled()
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['skipped', 'skipped'])
  })

  it('không tự hoàn tác phần đã gửi — hoàn tác cũng có thể hỏng', async () => {
    let aborted = false
    const send = vi.fn(async (element: SequentialItem) => { if (element.id === 'A') aborted = true })
    await runSequential([item('A'), item('B')], send, { isAborted: () => aborted })
    // Chỉ một lời gọi: gửi A. Không có lời gọi thứ hai để hoàn tác A.
    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe('onProgress', () => {
  it('báo ngay khi từng phần tử xong, không dồn tới cuối', async () => {
    const seen: string[] = []
    await runSequential(
      [item('A'), item('B')],
      async (element) => { if (element.id === 'B') throw new Error('x') },
      { onProgress: (outcome) => seen.push(`${outcome.id}:${outcome.status}`) }
    )
    expect(seen).toEqual(['A:sent', 'B:failed'])
  })

  it('báo cả phần tử bị bỏ qua', async () => {
    const seen: string[] = []
    await runSequential([item('A')], async () => {}, { isAborted: () => true, onProgress: (outcome) => seen.push(outcome.status) })
    expect(seen).toEqual(['skipped'])
  })
})

describe('summarizeSequential', () => {
  it('đếm tách bạch ba trạng thái', () => {
    expect(summarizeSequential([
      { id: 'A', label: 'a', status: 'sent' },
      { id: 'B', label: 'b', status: 'failed' },
      { id: 'C', label: 'c', status: 'skipped' },
      { id: 'D', label: 'd', status: 'sent' }
    ])).toEqual({ sent: 2, failed: 1, skipped: 1 })
  })

  it('danh sách rỗng cho ra ba số 0, không phải undefined', () => {
    expect(summarizeSequential([])).toEqual({ sent: 0, failed: 0, skipped: 0 })
  })
})
