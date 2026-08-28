/**
 * Bộ sinh mã QR tối thiểu — `T57-2.22`.
 *
 * VÌ SAO VIẾT TAY THAY VÌ DÙNG THƯ VIỆN
 *
 * Bo điều khiển **không có đường ra Internet**, nên mọi dịch vụ sinh QR trực
 * tuyến đều bị loại ngay từ đầu — trang Mạng mà phụ thuộc một API bên ngoài thì
 * đúng lúc cần nhất (vừa đổi IP, người dùng đang đứng cạnh tủ với điện thoại
 * trong tay) sẽ là lúc nó không chạy. Còn kéo thêm một dependency npm cho một
 * chuỗi 25 ký tự thì đổi lấy vài chục KB bundle trên một bo đã 892 kB, cho một
 * bài toán có thuật toán đóng và kiểm chứng được bằng test.
 *
 * PHẠM VI CÓ CHỦ ĐÍCH
 *
 * Chỉ **byte mode**, mức sửa lỗi **M**, phiên bản **1–6** (tối đa 106 ký tự).
 * Địa chỉ truy cập dài nhất mà trang này cần mã hoá là dạng
 * `https://192.168.100.100/` — 24 ký tự, nằm gọn trong phiên bản 2. Không làm
 * chế độ số/chữ-số, không làm phiên bản ≥ 7 (cần thêm khối thông tin phiên bản)
 * vì không có ca dùng nào cần tới, và mã không dùng tới là mã không ai kiểm.
 *
 * Tham chiếu: ISO/IEC 18004. Các bảng hằng dưới đây chép từ chuẩn; test đối
 * chiếu bước Reed–Solomon và bảng thông tin định dạng với vector đã biết.
 */

/** Ma trận module: `true` = ô tối. Hàng đầu là hàng trên cùng. */
export type QrMatrix = boolean[][]

const MAX_VERSION = 6

/** Tổng số codeword của từng phiên bản (chỉ số 0 = phiên bản 1). Không dùng
 *  trong luồng sinh mã — hai bảng dưới đây phải cộng lại đúng bằng nó, và test
 *  đối chiếu chính điều đó: một dòng gõ sai trong `ECC_M` sẽ tạo ra mã trông
 *  bình thường nhưng không máy quét nào đọc được. */
export const QR_TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172]

/** Mức M: [số codeword sửa lỗi mỗi khối, số khối, số codeword dữ liệu mỗi khối]. */
export const QR_ECC_M: Array<[number, number, number]> = [
  [10, 1, 16],
  [16, 1, 28],
  [26, 1, 44],
  [18, 2, 32],
  [24, 2, 43],
  [16, 4, 27]
]

/** Toạ độ tâm hoa tiêu căn chỉnh theo phiên bản. */
const ALIGNMENT_CENTERS: number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]]

export class QrTooLongError extends Error {
  constructor(length: number) {
    super(`QR: chuỗi ${length} ký tự vượt quá 106 ký tự mà phiên bản 1-6 mức M chứa được`)
    this.name = 'QrTooLongError'
  }
}

/**
 * Sinh ma trận QR cho `text` (UTF-8, byte mode, mức sửa lỗi M).
 *
 * Ném `QrTooLongError` khi chuỗi vượt sức chứa — gọi bên ngoài phải xử lý chứ
 * không được nuốt: một mã QR cụt là mã quét ra sai địa chỉ, tệ hơn không có mã.
 */
export function encodeQr(text: string): QrMatrix {
  const data = utf8Bytes(text)
  const version = pickVersion(data.length)
  const [ecPerBlock, blockCount, dataPerBlock] = QR_ECC_M[version - 1]
  const totalDataCodewords = blockCount * dataPerBlock

  const codewords = buildDataCodewords(data, totalDataCodewords)
  const interleaved = interleave(codewords, blockCount, dataPerBlock, ecPerBlock)

  const size = 17 + version * 4
  const reserved = emptyMatrix(size)
  const matrix = emptyMatrix(size)
  drawFunctionPatterns(matrix, reserved, version)
  placeData(matrix, reserved, interleaved)

  let best: QrMatrix | null = null
  let bestPenalty = Number.POSITIVE_INFINITY
  let bestMask = 0
  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = applyMask(matrix, reserved, mask)
    drawFormatInfo(candidate, mask)
    const penalty = maskPenalty(candidate)
    if (penalty < bestPenalty) {
      bestPenalty = penalty
      best = candidate
      bestMask = mask
    }
  }
  if (!best) throw new Error('QR: không chọn được mặt nạ')
  drawFormatInfo(best, bestMask)
  return best
}

export function qrVersionFor(text: string): number {
  return pickVersion(utf8Bytes(text).length)
}

/* ── Bước 1: dữ liệu ────────────────────────────────────────────────────── */

function utf8Bytes(text: string): number[] {
  return [...new TextEncoder().encode(text)]
}

function pickVersion(byteLength: number): number {
  for (let version = 1; version <= MAX_VERSION; version += 1) {
    const [, blocks, dataPerBlock] = QR_ECC_M[version - 1]
    // 2 codeword đầu là chỉ báo chế độ (4 bit) + độ dài (8 bit).
    if (byteLength + 2 <= blocks * dataPerBlock) return version
  }
  throw new QrTooLongError(byteLength)
}

function buildDataCodewords(data: number[], totalDataCodewords: number): number[] {
  const bits: number[] = []
  pushBits(bits, 0b0100, 4) // byte mode
  pushBits(bits, data.length, 8) // đếm ký tự, 8 bit cho phiên bản 1-9
  for (const byte of data) pushBits(bits, byte, 8)

  // Kết thúc: tối đa 4 bit 0, cắt bớt nếu gần đầy.
  const capacityBits = totalDataCodewords * 8
  const terminator = Math.min(4, capacityBits - bits.length)
  pushBits(bits, 0, terminator)
  while (bits.length % 8 !== 0) bits.push(0)

  const codewords: number[] = []
  for (let index = 0; index < bits.length; index += 8) {
    let byte = 0
    for (let offset = 0; offset < 8; offset += 1) byte = (byte << 1) | bits[index + offset]
    codewords.push(byte)
  }
  // Đệm luân phiên theo chuẩn cho tới khi đầy.
  const padBytes = [0xec, 0x11]
  let padIndex = 0
  while (codewords.length < totalDataCodewords) {
    codewords.push(padBytes[padIndex % 2])
    padIndex += 1
  }
  return codewords
}

function pushBits(bits: number[], value: number, count: number): void {
  for (let index = count - 1; index >= 0; index -= 1) bits.push((value >> index) & 1)
}

/* ── Bước 2: Reed–Solomon trên GF(256) ──────────────────────────────────── */

const GF_EXP = new Uint8Array(512)
const GF_LOG = new Uint8Array(256)
{
  let value = 1
  for (let index = 0; index < 255; index += 1) {
    GF_EXP[index] = value
    GF_LOG[value] = index
    value <<= 1
    if (value & 0x100) value ^= 0x11d // đa thức nguyên thuỷ của QR
  }
  for (let index = 255; index < 512; index += 1) GF_EXP[index] = GF_EXP[index - 255]
}

function gfMul(left: number, right: number): number {
  if (left === 0 || right === 0) return 0
  return GF_EXP[GF_LOG[left] + GF_LOG[right]]
}

/** Đa thức sinh bậc `degree`. */
function generatorPoly(degree: number): number[] {
  let poly = [1]
  for (let index = 0; index < degree; index += 1) {
    const next = new Array<number>(poly.length + 1).fill(0)
    for (let position = 0; position < poly.length; position += 1) {
      next[position] ^= poly[position]
      next[position + 1] ^= gfMul(poly[position], GF_EXP[index])
    }
    poly = next
  }
  return poly
}

/** Codeword sửa lỗi của một khối dữ liệu. Đây là bước dễ sai nhất nên có test
 *  đối chiếu với vector đã biết của chuẩn. */
export function reedSolomonEcc(block: number[], ecCount: number): number[] {
  const generator = generatorPoly(ecCount)
  const remainder = new Array<number>(ecCount).fill(0)
  for (const byte of block) {
    const factor = byte ^ remainder[0]
    remainder.shift()
    remainder.push(0)
    for (let index = 0; index < ecCount; index += 1) {
      remainder[index] ^= gfMul(generator[index + 1], factor)
    }
  }
  return remainder
}

function interleave(codewords: number[], blockCount: number, dataPerBlock: number, ecPerBlock: number): number[] {
  const dataBlocks: number[][] = []
  const ecBlocks: number[][] = []
  for (let index = 0; index < blockCount; index += 1) {
    const block = codewords.slice(index * dataPerBlock, (index + 1) * dataPerBlock)
    dataBlocks.push(block)
    ecBlocks.push(reedSolomonEcc(block, ecPerBlock))
  }
  const result: number[] = []
  for (let position = 0; position < dataPerBlock; position += 1) {
    for (const block of dataBlocks) result.push(block[position])
  }
  for (let position = 0; position < ecPerBlock; position += 1) {
    for (const block of ecBlocks) result.push(block[position])
  }
  return result
}

/* ── Bước 3: ma trận ────────────────────────────────────────────────────── */

function emptyMatrix(size: number): QrMatrix {
  return Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
}

function drawFunctionPatterns(matrix: QrMatrix, reserved: QrMatrix, version: number): void {
  const size = matrix.length

  for (const [row, column] of [[0, 0], [0, size - 7], [size - 7, 0]] as Array<[number, number]>) {
    drawFinder(matrix, reserved, row, column)
  }

  // Hoa tiêu định thì trên hàng và cột số 6.
  for (let index = 8; index < size - 8; index += 1) {
    const dark = index % 2 === 0
    matrix[6][index] = dark
    matrix[index][6] = dark
    reserved[6][index] = true
    reserved[index][6] = true
  }

  for (const rowCenter of ALIGNMENT_CENTERS[version - 1]) {
    for (const columnCenter of ALIGNMENT_CENTERS[version - 1]) {
      // Ba góc đã có hoa tiêu định vị; đặt thêm ở đó là phá chúng.
      if (reserved[rowCenter][columnCenter]) continue
      drawAlignment(matrix, reserved, rowCenter, columnCenter)
    }
  }

  // Module tối cố định.
  matrix[size - 8][8] = true
  reserved[size - 8][8] = true

  // Vùng thông tin định dạng: giữ chỗ trước, ghi sau khi chọn mặt nạ.
  for (let index = 0; index < 9; index += 1) {
    if (!reserved[8][index]) reserved[8][index] = true
    if (!reserved[index][8]) reserved[index][8] = true
  }
  for (let index = 0; index < 8; index += 1) {
    reserved[8][size - 1 - index] = true
    reserved[size - 1 - index][8] = true
  }
}

function drawFinder(matrix: QrMatrix, reserved: QrMatrix, row: number, column: number): void {
  for (let deltaRow = -1; deltaRow <= 7; deltaRow += 1) {
    for (let deltaColumn = -1; deltaColumn <= 7; deltaColumn += 1) {
      const targetRow = row + deltaRow
      const targetColumn = column + deltaColumn
      if (targetRow < 0 || targetColumn < 0 || targetRow >= matrix.length || targetColumn >= matrix.length) continue
      const inRing = (deltaRow >= 0 && deltaRow <= 6 && (deltaColumn === 0 || deltaColumn === 6))
        || (deltaColumn >= 0 && deltaColumn <= 6 && (deltaRow === 0 || deltaRow === 6))
      const inCore = deltaRow >= 2 && deltaRow <= 4 && deltaColumn >= 2 && deltaColumn <= 4
      matrix[targetRow][targetColumn] = inRing || inCore
      reserved[targetRow][targetColumn] = true
    }
  }
}

function drawAlignment(matrix: QrMatrix, reserved: QrMatrix, row: number, column: number): void {
  for (let deltaRow = -2; deltaRow <= 2; deltaRow += 1) {
    for (let deltaColumn = -2; deltaColumn <= 2; deltaColumn += 1) {
      matrix[row + deltaRow][column + deltaColumn] =
        Math.max(Math.abs(deltaRow), Math.abs(deltaColumn)) !== 1
      reserved[row + deltaRow][column + deltaColumn] = true
    }
  }
}

function placeData(matrix: QrMatrix, reserved: QrMatrix, codewords: number[]): void {
  const size = matrix.length
  let bitIndex = 0
  let upward = true
  for (let right = size - 1; right >= 1; right -= 2) {
    // Cột 6 là hoa tiêu định thì — bỏ qua để không lệch cả lưới.
    const columnRight = right <= 6 ? right - 1 : right
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step
      for (const column of [columnRight, columnRight - 1]) {
        if (column < 0 || reserved[row][column]) continue
        const byte = codewords[bitIndex >> 3]
        const bit = byte === undefined ? 0 : (byte >> (7 - (bitIndex & 7))) & 1
        matrix[row][column] = bit === 1
        bitIndex += 1
      }
    }
    upward = !upward
  }
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

function applyMask(matrix: QrMatrix, reserved: QrMatrix, mask: number): QrMatrix {
  return matrix.map((line, row) => line.map((value, column) =>
    reserved[row][column] ? value : value !== maskPredicate(mask, row, column)))
}

const FORMAT_GENERATOR = 0b10100110111
const FORMAT_XOR = 0b101010000010010

/** 15 bit thông tin định dạng cho mức M và mặt nạ đã chọn. */
export function formatInfoBits(mask: number): number {
  const data = (0b00 << 3) | mask // 00 = mức sửa lỗi M
  let value = data << 10
  for (let index = 14; index >= 10; index -= 1) {
    if ((value >> index) & 1) value ^= FORMAT_GENERATOR << (index - 10)
  }
  return ((data << 10) | value) ^ FORMAT_XOR
}

function drawFormatInfo(matrix: QrMatrix, mask: number): void {
  const size = matrix.length
  const bits = formatInfoBits(mask)
  /* Thứ tự đặt bit theo ISO/IEC 18004 §8.9. Ma trận ở đây đánh chỉ số
     `[hàng][cột]`, còn tài liệu tham chiếu quen viết `(x, y)` — chỗ này là nơi
     dễ đảo nhầm hai trục nhất, và đảo nhầm thì mã vẫn "trông đúng" nhưng máy
     quét đọc sai mức sửa lỗi rồi bỏ luôn. */
  for (let index = 0; index < 15; index += 1) {
    const dark = ((bits >> index) & 1) === 1
    // Bản sao thứ nhất: cột 8 đi xuống, rồi hàng 8 đi ngược về trái.
    if (index < 6) matrix[index][8] = dark
    else if (index === 6) matrix[7][8] = dark
    else if (index === 7) matrix[8][8] = dark
    else if (index === 8) matrix[8][7] = dark
    else matrix[8][14 - index] = dark

    // Bản sao thứ hai: hàng 8 sát mép phải, rồi cột 8 sát mép dưới.
    if (index < 8) matrix[8][size - 1 - index] = dark
    else matrix[size - 15 + index][8] = dark
  }
  matrix[size - 8][8] = true
}

/* ── Bước 4: chấm điểm mặt nạ (ISO/IEC 18004 §8.8.2) ────────────────────── */

function maskPenalty(matrix: QrMatrix): number {
  const size = matrix.length
  let penalty = 0

  // Luật 1: dãy từ 5 ô cùng màu trở lên, theo cả hàng và cột.
  for (let index = 0; index < size; index += 1) {
    penalty += runPenalty(matrix[index])
    penalty += runPenalty(matrix.map((line) => line[index]))
  }

  // Luật 2: khối 2×2 cùng màu.
  for (let row = 0; row < size - 1; row += 1) {
    for (let column = 0; column < size - 1; column += 1) {
      const value = matrix[row][column]
      if (value === matrix[row][column + 1] && value === matrix[row + 1][column] && value === matrix[row + 1][column + 1]) {
        penalty += 3
      }
    }
  }

  // Luật 3: mẫu 1:1:3:1:1 dễ bị nhầm với hoa tiêu định vị.
  for (let index = 0; index < size; index += 1) {
    penalty += finderLikePenalty(matrix[index])
    penalty += finderLikePenalty(matrix.map((line) => line[index]))
  }

  // Luật 4: lệch cân bằng sáng/tối toàn ảnh.
  const dark = matrix.reduce((total, line) => total + line.filter(Boolean).length, 0)
  const ratio = (dark * 100) / (size * size)
  penalty += Math.floor(Math.abs(ratio - 50) / 5) * 10

  return penalty
}

function runPenalty(line: boolean[]): number {
  let penalty = 0
  let runLength = 1
  for (let index = 1; index < line.length; index += 1) {
    if (line[index] === line[index - 1]) {
      runLength += 1
      if (runLength === 5) penalty += 3
      else if (runLength > 5) penalty += 1
    } else runLength = 1
  }
  return penalty
}

const FINDER_LIKE = [true, false, true, true, true, false, true]

function finderLikePenalty(line: boolean[]): number {
  let penalty = 0
  for (let index = 0; index + 7 <= line.length; index += 1) {
    const window = line.slice(index, index + 7)
    if (!window.every((value, offset) => value === FINDER_LIKE[offset])) continue
    const before = line.slice(Math.max(0, index - 4), index)
    const after = line.slice(index + 7, index + 11)
    if (before.length === 4 && before.every((value) => !value)) penalty += 40
    if (after.length === 4 && after.every((value) => !value)) penalty += 40
  }
  return penalty
}
