import { useMemo } from 'react'
import { useI18n } from '../../../shared/i18n'
import type { ModbusRTUPoint } from '../../../shared/types'

/**
 * MBR-B304 — xem trước dấu chân register và quy đổi giá trị mẫu.
 *
 * Vì sao cần: khai báo Modbus sai kiểu hoặc sai thứ tự byte KHÔNG gây lỗi nào
 * lúc lưu — nó chỉ làm số đọc ra sai, và sai theo cách trông rất hợp lý (một
 * float32 đọc nhầm thứ tự word cho ra một số vẫn nằm trong dải nhiệt độ hợp
 * lệ). Người khai báo cần thấy TRƯỚC khi apply rằng điểm này chiếm register nào
 * và một mẫu thô sẽ được quy đổi thành bao nhiêu.
 */

export interface RegisterFootprint {
  /** Register/coil đầu tiên. */
  start: number
  /** Số register/coil chiếm dụng. */
  width: number
  /** Register cuối cùng (bao gồm). */
  end: number
}

export function registerFootprint(point: Pick<ModbusRTUPoint, 'address' | 'data_type'>): RegisterFootprint {
  const width = point.data_type === 'int32' || point.data_type === 'uint32' || point.data_type === 'float32' ? 2 : 1
  return { start: point.address, width, end: point.address + width - 1 }
}

/** Hai điểm có chồng vùng register không (DATA_MODEL §5.5). */
export function overlaps(
  a: Pick<ModbusRTUPoint, 'address' | 'data_type' | 'bit_index'>,
  b: Pick<ModbusRTUPoint, 'address' | 'data_type' | 'bit_index'>
): boolean {
  const spanA = registerFootprint(a)
  const spanB = registerFootprint(b)
  if (spanA.end < spanB.start || spanB.end < spanA.start) return false
  // Hai bit KHÁC NHAU trong cùng một register là hợp lệ và rất phổ biến ở thanh
  // ghi trạng thái của VFD/đồng hồ.
  const bitA = a.bit_index ?? null
  const bitB = b.bit_index ?? null
  if (bitA !== null && bitB !== null && bitA !== bitB &&
    spanA.start === spanB.start && spanA.width === spanB.width) {
    return false
  }
  return true
}

/** Quy đổi một mẫu thô sang engineering value theo scale/offset. */
export function scaleSample(raw: number, scale: number, offset: number): number | null {
  // scale = 0 làm phép ghi ngược lại chia cho 0; validator đã chặn, nhưng bản
  // xem trước phải nói rõ thay vì hiện một số vô nghĩa (D-02).
  if (!Number.isFinite(scale) || scale === 0) return null
  return raw * scale + offset
}

interface RegisterPreviewProps {
  point: Pick<ModbusRTUPoint, 'address' | 'data_type' | 'scale' | 'offset' | 'unit' | 'register_type' | 'bit_index'>
  /** Các điểm khác trên cùng device để soi chồng lấn. */
  siblings?: ModbusRTUPoint[]
  /** Point ID của chính điểm đang soạn, để không tự so với chính mình. */
  selfPointId?: string
}

const NO_DATA = '—'

export function RegisterPreview({ point, siblings = [], selfPointId }: RegisterPreviewProps) {
  const { pick } = useI18n()
  const footprint = registerFootprint(point)

  const conflicts = useMemo(() => siblings.filter((other) => {
    if (selfPointId && other.point_id === selfPointId) return false
    if (!other.enabled) return false
    if (other.register_type !== point.register_type) return false
    return overlaps(point, other)
  }), [point, selfPointId, siblings])

  const samples = [0, 1, 100, 1000].map((raw) => ({
    raw,
    engineering: scaleSample(raw, point.scale, point.offset)
  }))

  return (
    <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 text-xs"
      data-testid="register-preview">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-semibold">{pick('Dấu chân register', 'Register footprint')}</span>
        <span className="font-mono" data-testid="footprint">
          {point.register_type} {footprint.start}
          {footprint.width > 1 ? `–${footprint.end}` : ''} ({footprint.width} register)
          {point.bit_index !== null && point.bit_index !== undefined ? ` · bit ${point.bit_index}` : ''}
        </span>
      </div>

      {conflicts.length > 0 && (
        <p className="mt-2 text-[var(--c-danger,#c00)]" role="alert" data-testid="overlap-warning">
          {pick('Chồng vùng register với', 'Register range overlaps with')}: {conflicts.map((item) => item.point_id).join(', ')}.{' '}
          {pick('Hai Point cùng trỏ vào một ô nhớ sẽ ghi đè nhau theo thứ tự không xác định.', 'Two Points pointing at the same memory cell will overwrite each other in an undefined order.')}
        </p>
      )}

      <table className="mt-2 w-full text-left font-mono">
        <thead>
          <tr className="text-[var(--c-text-dim)]">
            <th className="font-normal">{pick('Mẫu thô', 'Raw sample')}</th>
            <th className="font-normal">{pick('Giá trị quy đổi', 'Converted value')}</th>
          </tr>
        </thead>
        <tbody>
          {samples.map((sample) => (
            <tr key={sample.raw}>
              <td>{sample.raw}</td>
              <td data-testid={`sample-${sample.raw}`}>
                {sample.engineering === null
                  ? pick(`${NO_DATA} (scale không hợp lệ)`, `${NO_DATA} (invalid scale)`)
                  : `${sample.engineering} ${point.unit ?? ''}`.trim()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
