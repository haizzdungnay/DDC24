import { describe, expect, it } from 'vitest'
import { judgeProducerStamp, parseCapturedMonotonicNs } from './producerStamp'

const stamp = (value: string) => ({ capturedMonotonicNs: value })

describe('parseCapturedMonotonicNs', () => {
  it('đọc được mốc vượt Number.MAX_SAFE_INTEGER mà không mất chữ số', () => {
    // ~104 ngày uptime là chỗ `Number` bắt đầu làm tròn. Đây là giá trị NGAY
    // TRÊN ngưỡng đó — nếu ai đó đổi sang `Number` thì test này đỏ.
    const huge = '9007199254740993'
    expect(parseCapturedMonotonicNs(stamp(huge))).toBe(BigInt(huge))
    expect(Number(huge).toString()).not.toBe(huge)
  })

  it.each([
    ['thiếu dấu', undefined],
    ['chuỗi rỗng', stamp('')],
    ['có dấu âm', stamp('-1')],
    ['có chữ', stamp('12a')],
    ['dấu chấm thập phân', stamp('1.5')],
    ['dài quá 20 chữ số', stamp('1'.repeat(21))],
  ])('từ chối %s', (_label, input) => {
    expect(parseCapturedMonotonicNs(input as never)).toBeNull()
  })
})

/*
 * Ba trạng thái, ba cách xử lý khác nhau — gộp lại là sai:
 *  - cũ hơn  ⇒ bỏ qua, giữ nguyên thứ đang hiện (vẽ lại số cũ là nói dối);
 *  - restart ⇒ mạch đứt, không nối tiếp im lặng;
 *  - hỏng    ⇒ fail-closed, coi như chưa có số liệu.
 */
describe('judgeProducerStamp', () => {
  it('snapshot đầu tiên luôn được nhận, kể cả mốc 0', () => {
    expect(judgeProducerStamp(stamp('0'), null)).toEqual({ kind: 'ACCEPT', capturedMonotonicNs: 0n })
  })

  it('mốc tăng ⇒ nhận', () => {
    expect(judgeProducerStamp(stamp('200'), 100n)).toEqual({ kind: 'ACCEPT', capturedMonotonicNs: 200n })
  })

  it('mốc bằng ⇒ STALE, không vẽ lại', () => {
    expect(judgeProducerStamp(stamp('100'), 100n)).toEqual({ kind: 'STALE', capturedMonotonicNs: 100n })
  })

  it('mốc LÙI ⇒ producer đã restart, không phải chỉ là cũ hơn', () => {
    // Đây là chỗ dễ sai nhất: coi mốc lùi là "cũ hơn" rồi bỏ qua sẽ khiến UI
    // treo mãi ở số liệu TRƯỚC khi Core restart, và không ai biết mạch đã đứt.
    expect(judgeProducerStamp(stamp('50'), 100n)).toEqual({ kind: 'PRODUCER_RESTARTED', capturedMonotonicNs: 50n })
  })

  it('thiếu dấu hoặc dấu hỏng ⇒ fail-closed, không đoán', () => {
    expect(judgeProducerStamp(undefined, 100n)).toEqual({ kind: 'UNAVAILABLE', reason: 'MISSING' })
    expect(judgeProducerStamp(stamp('abc'), 100n)).toEqual({ kind: 'UNAVAILABLE', reason: 'MALFORMED' })
  })

  it('so sánh đúng ở dải vượt số nguyên an toàn của JavaScript', () => {
    const previous = BigInt('9007199254740993')
    // Hai giá trị này BẰNG NHAU nếu ép qua `Number`; phải khác nhau ở BigInt.
    expect(Number('9007199254740993')).toBe(Number('9007199254740992'))
    expect(judgeProducerStamp(stamp('9007199254740992'), previous).kind).toBe('PRODUCER_RESTARTED')
    expect(judgeProducerStamp(stamp('9007199254740994'), previous).kind).toBe('ACCEPT')
  })
})
