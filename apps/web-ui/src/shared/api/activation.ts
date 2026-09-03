/* `ISS-PIO-33` — bước Read-back Verify của vòng đời
 * `Edit → Validate → Apply → Read-back Verify`.
 *
 * Vì sao giao diện phải hiện thứ này: `iobus` chỉ gửi `SET_AO_CFG` khi IOP đang
 * poll, và khi MCU **NACK** thì nó ghi `ao_mode[] = 0` (giữ 0-10V) rồi chạy
 * tiếp. Trước bản vá, web báo "Lưu thành công" cho một cấu hình 4-20 mA mà bo
 * vẫn đang chạy 0-10 V — người vận hành đấu dây theo dòng, đọc ra điện áp, và
 * không có chỗ nào trong giao diện nói ra điều đó. */

export type ActivationStatus = 'verified' | 'unverified' | 'mismatch'

export interface ActivationAOMode {
  ch: number
  requested: string
  applied: string
}

export interface ActivationReport {
  status: ActivationStatus
  reason?: string
  aoModes?: ActivationAOMode[]
}

/**
 * Câu cảnh báo cho người vận hành, hoặc `null` khi phần cứng đã xác nhận.
 *
 * `null` CHỈ khi `status === 'verified'`. Thiếu `activation` (backend đời cũ,
 * hoặc đường ghi không đi qua bước này) cũng trả về một câu cảnh báo: coi
 * "không có thông tin" là "đã xác nhận" chính là cái bẫy mà `ISS-PIO-33` dẹp.
 */
export function activationWarning(
  report: ActivationReport | null | undefined,
  pick: (vi: string, en: string) => string
): string | null {
  if (report?.status === 'verified') return null
  const detail = report?.reason?.trim()
  const head = pick(
    'Đã lưu, NHƯNG chưa xác nhận được mode AO đã áp dụng ở phần cứng',
    'Saved, but the AO mode applied at the hardware could not be confirmed'
  )
  return detail ? `${head}: ${detail}` : head
}
