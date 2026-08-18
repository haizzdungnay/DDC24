import { useEffect, useRef, useState } from 'react'

/**
 * Trả lớp `value-flash` trong một nhịp ngắn sau khi `value` đổi — `T57-2.16`.
 *
 * VÌ SAO CẦN
 *
 * `KX-DDC24-UX-SYSTEM-001` §5 đã đặc tả `DataTable` có "realtime cell flash",
 * và `.value-flash` đã nằm sẵn trong `styles.css` — nhưng **không nơi nào dùng
 * nó**. Trên một bảng 30 điểm cùng cập nhật, người trực không có cách nào thấy
 * ô nào vừa đổi; họ phải nhớ con số cũ trong đầu.
 *
 * VÌ SAO KHÔNG CHỚP Ở LẦN RENDER ĐẦU
 *
 * `previousRef` khởi tạo bằng chính giá trị đầu tiên, nên mở trang không làm cả
 * bảng chớp cùng lúc — một màn hình chớp toàn bộ khi vừa mở là nhiễu, và nó dạy
 * người dùng bỏ qua hiệu ứng đúng lúc hiệu ứng cần được chú ý.
 *
 * Hiệu ứng bị tắt hẳn khi người dùng khai `prefers-reduced-motion` (chặn ở CSS).
 * Mất nó không mất thông tin: giá trị mới vẫn hiện ra như thường.
 */
export function useValueFlash(value: unknown, durationMs = 640): string {
  const previousRef = useRef(value)
  const [flashing, setFlashing] = useState(false)

  useEffect(() => {
    if (Object.is(previousRef.current, value)) return undefined
    previousRef.current = value
    setFlashing(true)
    const timer = window.setTimeout(() => setFlashing(false), durationMs)
    return () => window.clearTimeout(timer)
  }, [durationMs, value])

  return flashing ? 'value-flash' : ''
}
