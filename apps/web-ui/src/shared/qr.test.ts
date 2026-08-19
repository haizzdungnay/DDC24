import { describe, expect, it } from 'vitest'
import {
  encodeQr,
  formatInfoBits,
  QR_ECC_M,
  QR_TOTAL_CODEWORDS,
  qrVersionFor,
  QrTooLongError,
  reedSolomonEcc,
  type QrMatrix
} from './qr'

/**
 * Khoá đúng đắn của bộ sinh QR — `T57-2.22`.
 *
 * VÌ SAO TEST NẶNG HƠN BÌNH THƯỜNG
 *
 * Không thể "nhìn thấy" một mã QR sai: nó vẫn là một ô vuông đen trắng trông
 * hợp lý, chỉ có điện thoại của người kỹ thuật đứng cạnh tủ mới phát hiện ra —
 * đúng lúc họ vừa đổi IP và không còn đường vào giao diện để sửa. Nên ở đây
 * kiểm ba tầng:
 *
 *  1. **Đối chiếu vector đã biết** của ISO/IEC 18004 cho hai bước dễ sai nhất:
 *     Reed–Solomon và bảng thông tin định dạng.
 *  2. **Cấu trúc** — hoa tiêu định vị, hoa tiêu định thì, kích thước.
 *  3. **Giải mã ngược** — test tự đọc lại ma trận đúng theo cách máy quét đọc
 *     (lấy mặt nạ từ thông tin định dạng, gỡ mặt nạ, đọc codeword theo đường
 *     zigzag, tách khối) và phải ra lại đúng chuỗi ban đầu. Đây là thứ duy
 *     nhất chứng minh cả chuỗi bước ăn khớp với nhau.
 */

describe('T57-2.22 — bảng hằng theo chuẩn', () => {
  it('dữ liệu + sửa lỗi của mỗi phiên bản cộng đúng bằng tổng codeword', () => {
    QR_ECC_M.forEach(([ecPerBlock, blocks, dataPerBlock], index) => {
      expect(blocks * (ecPerBlock + dataPerBlock), `phiên bản ${index + 1}`).toBe(QR_TOTAL_CODEWORDS[index])
    })
  })

  it('Reed–Solomon khớp vector mẫu "HELLO WORLD" phiên bản 1-Q của tài liệu chuẩn', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236]
    expect(reedSolomonEcc(data, 13)).toEqual([168, 72, 22, 82, 217, 54, 156, 0, 46, 15, 180, 122, 16])
  })

  it('đa thức mã chia hết cho đa thức sinh — tính chất định nghĩa của Reed–Solomon', () => {
    /* Vector mẫu chỉ chứng minh một trường hợp. Tính chất này đúng với MỌI dữ
       liệu, nên nó bắt được cả lỗi mà một vector đơn lẻ đi lọt: đa thức
       (dữ liệu ‖ sửa lỗi) phải bằng 0 tại α^0…α^(n-1). */
    const data = [1, 2, 3, 250, 255, 0, 128, 77]
    for (const ecCount of [10, 16, 18, 24, 26]) {
      const code = [...data, ...reedSolomonEcc(data, ecCount)]
      for (let power = 0; power < ecCount; power += 1) {
        expect(evaluateGf(code, gfPow(2, power)), `ecCount=${ecCount}, α^${power}`).toBe(0)
      }
    }
  })

  it('thông tin định dạng mức M khớp bảng tra của chuẩn', () => {
    const expected = [
      0b101010000010010, 0b101000100100101, 0b101111001111100, 0b101101101001011,
      0b100010111111001, 0b100000011001110, 0b100111110010111, 0b100101010100000
    ]
    expected.forEach((bits, mask) => expect(formatInfoBits(mask), `mặt nạ ${mask}`).toBe(bits))
  })
})

describe('T57-2.22 — cấu trúc ma trận', () => {
  it('kích thước theo đúng phiên bản đã chọn', () => {
    expect(encodeQr('http://192.168.1.50/').length).toBe(17 + qrVersionFor('http://192.168.1.50/') * 4)
    expect(encodeQr('a').length).toBe(21)
  })

  it('chọn phiên bản nhỏ nhất còn chứa được chuỗi', () => {
    expect(qrVersionFor('a'.repeat(14))).toBe(1)
    expect(qrVersionFor('a'.repeat(15))).toBe(2)
    expect(qrVersionFor('a'.repeat(26))).toBe(2)
    expect(qrVersionFor('a'.repeat(27))).toBe(3)
  })

  it('chuỗi quá dài báo lỗi thay vì cắt bớt âm thầm', () => {
    expect(() => encodeQr('a'.repeat(107))).toThrow(QrTooLongError)
  })

  it('ba góc có hoa tiêu định vị 7×7 đúng khuôn', () => {
    const matrix = encodeQr('http://192.168.1.50/')
    const size = matrix.length
    for (const [row, column] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
      expect(finderAt(matrix, row, column), `hoa tiêu tại (${row},${column})`).toBe(true)
    }
  })

  it('hoa tiêu định thì xen kẽ trên hàng và cột số 6', () => {
    const matrix = encodeQr('http://192.168.1.50/')
    for (let index = 8; index < matrix.length - 8; index += 1) {
      expect(matrix[6][index]).toBe(index % 2 === 0)
      expect(matrix[index][6]).toBe(index % 2 === 0)
    }
  })

  it('module tối cố định luôn tối', () => {
    const matrix = encodeQr('x')
    expect(matrix[matrix.length - 8][8]).toBe(true)
  })
})

describe('T57-2.22 — giải mã ngược ma trận', () => {
  for (const text of ['http://192.168.1.50/', 'https://10.0.0.1/', 'a', 'a'.repeat(60), 'https://192.168.100.100:8443/']) {
    it(`đọc lại được đúng "${text.slice(0, 24)}${text.length > 24 ? '…' : ''}"`, () => {
      expect(decodeQr(encodeQr(text))).toBe(text)
    })
  }

  it('mọi ký tự UTF-8 nhiều byte cũng đi qua nguyên vẹn', () => {
    expect(decodeQr(encodeQr('Tủ điện AHU-1'))).toBe('Tủ điện AHU-1')
  })
})

/* ── Bộ giải mã dùng riêng cho test ─────────────────────────────────────────
 *
 * Đọc theo đúng trình tự của máy quét: thông tin định dạng → mặt nạ → gỡ mặt
 * nạ → đọc bit theo đường zigzag → tách khối → bỏ phần sửa lỗi → giải byte
 * mode. Cố ý KHÔNG dùng lại hàm nội bộ của `qr.ts` ngoài bảng hằng: nếu dùng
 * chung thì một lỗi trong bảng đặt bit sẽ tự triệt tiêu và test luôn xanh.
 */

function finderAt(matrix: QrMatrix, row: number, column: number): boolean {
  for (let deltaRow = 0; deltaRow < 7; deltaRow += 1) {
    for (let deltaColumn = 0; deltaColumn < 7; deltaColumn += 1) {
      const inRing = deltaRow === 0 || deltaRow === 6 || deltaColumn === 0 || deltaColumn === 6
      const inCore = deltaRow >= 2 && deltaRow <= 4 && deltaColumn >= 2 && deltaColumn <= 4
      if (matrix[row + deltaRow][column + deltaColumn] !== (inRing || inCore)) return false
    }
  }
  return true
}

function decodeQr(matrix: QrMatrix): string {
  const size = matrix.length
  const version = (size - 17) / 4
  const [ecPerBlock, blockCount, dataPerBlock] = QR_ECC_M[version - 1]

  const mask = readMask(matrix)
  const reserved = reservedMap(size, version)
  const bits: number[] = []
  let upward = true
  for (let right = size - 1; right >= 1; right -= 2) {
    const columnRight = right <= 6 ? right - 1 : right
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step
      for (const column of [columnRight, columnRight - 1]) {
        if (column < 0 || reserved[row][column]) continue
        const value = matrix[row][column] !== maskPredicate(mask, row, column)
        bits.push(value ? 1 : 0)
      }
    }
    upward = !upward
  }

  const codewords: number[] = []
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    let byte = 0
    for (let offset = 0; offset < 8; offset += 1) byte = (byte << 1) | bits[index + offset]
    codewords.push(byte)
  }

  // Gỡ xen kẽ: lấy lại từng khối dữ liệu theo đúng thứ tự đã ghép.
  const blocks: number[][] = Array.from({ length: blockCount }, () => [])
  let cursor = 0
  for (let position = 0; position < dataPerBlock; position += 1) {
    for (let block = 0; block < blockCount; block += 1) {
      blocks[block].push(codewords[cursor])
      cursor += 1
    }
  }
  const data = blocks.flat()
  expect(ecPerBlock).toBeGreaterThan(0)

  const mode = data[0] >> 4
  expect(mode, 'chỉ dùng byte mode').toBe(0b0100)
  const length = ((data[0] & 0x0f) << 4) | (data[1] >> 4)
  const payload: number[] = []
  for (let index = 0; index < length; index += 1) {
    payload.push(((data[index + 1] & 0x0f) << 4) | (data[index + 2] >> 4))
  }
  return new TextDecoder().decode(new Uint8Array(payload))
}

function readMask(matrix: QrMatrix): number {
  /* Trong chuỗi 15 bit, 10 bit thấp là phần sửa lỗi BCH; 5 bit dữ liệu nằm ở
     vị trí 10..14, trong đó ba bit thấp nhất (10,11,12) là số hiệu mặt nạ.
     Bản sao thứ nhất đặt các vị trí đó ở hàng 8, cột 14-index. */
  let mask = 0
  for (let offset = 0; offset < 3; offset += 1) {
    const index = 10 + offset
    const raw = matrix[8][14 - index] ? 1 : 0
    const bit = raw ^ ((0b101010000010010 >> index) & 1)
    mask |= bit << offset
  }
  return mask
}

function gfPow(base: number, power: number): number {
  let result = 1
  for (let index = 0; index < power; index += 1) result = gfMulTest(result, base)
  return result
}

function gfMulTest(left: number, right: number): number {
  let result = 0
  let a = left
  let b = right
  for (let index = 0; index < 8; index += 1) {
    if (b & 1) result ^= a
    b >>= 1
    a <<= 1
    if (a & 0x100) a ^= 0x11d
  }
  return result
}

function evaluateGf(coefficients: number[], x: number): number {
  let value = 0
  for (const coefficient of coefficients) value = gfMulTest(value, x) ^ coefficient
  return value
}

function maskPredicate(mask: number, row: number, column: number): boolean {
  switch (mask) {
    case 0: return (row + column) % 2 === 0
    case 1: return row % 2 === 0
    case 2: return column % 3 === 0
    case 3: return (row + column) % 3 === 0
    case 4: return (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0
    case 5: return ((row * column) % 2) + ((row * column) % 3) === 0
    case 6: return (((row * column) % 2) + ((row * column) % 3)) % 2 === 0
    default: return (((row + column) % 2) + ((row * column) % 3)) % 2 === 0
  }
}

function reservedMap(size: number, version: number): boolean[][] {
  const reserved = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const mark = (row: number, column: number) => {
    if (row >= 0 && column >= 0 && row < size && column < size) reserved[row][column] = true
  }
  for (const [row, column] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let deltaRow = -1; deltaRow <= 7; deltaRow += 1) {
      for (let deltaColumn = -1; deltaColumn <= 7; deltaColumn += 1) mark(row + deltaRow, column + deltaColumn)
    }
  }
  for (let index = 0; index < size; index += 1) {
    mark(6, index)
    mark(index, 6)
  }
  const centers = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]][version - 1] as number[]
  for (const rowCenter of centers) {
    for (const columnCenter of centers) {
      const nearFinder = (rowCenter <= 8 && columnCenter <= 8)
        || (rowCenter <= 8 && columnCenter >= size - 9)
        || (rowCenter >= size - 9 && columnCenter <= 8)
      if (nearFinder) continue
      for (let deltaRow = -2; deltaRow <= 2; deltaRow += 1) {
        for (let deltaColumn = -2; deltaColumn <= 2; deltaColumn += 1) mark(rowCenter + deltaRow, columnCenter + deltaColumn)
      }
    }
  }
  for (let index = 0; index < 9; index += 1) {
    mark(8, index)
    mark(index, 8)
  }
  for (let index = 0; index < 8; index += 1) {
    mark(8, size - 1 - index)
    mark(size - 1 - index, 8)
  }
  return reserved
}
