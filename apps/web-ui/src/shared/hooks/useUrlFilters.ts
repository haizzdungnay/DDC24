import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * `useUrlFilters` — khối hạ tầng `BB-1` của Plan 57 (`T57-2.1`).
 *
 * VÌ SAO CẦN
 *
 * `MonitorPage` đã đưa bộ lọc vào URL từ PA3-402, và đó là lý do nó gửi được
 * cho đồng nghiệp một đường dẫn tới "các point Modbus đang offline". Bốn trang
 * còn lại — Cảnh báo, Lịch vận hành, Nhật ký hoạt động, Xu hướng — vẫn giữ bộ
 * lọc trong `useState`: F5 hay Back là mất sạch ngữ cảnh, và không có cách nào
 * gửi cho ca sau một đường dẫn tới "các cảnh báo High chưa ack trong 24 h".
 *
 * Với công việc vận hành nhiều người cùng ca, đó không phải bất tiện nhỏ mà là
 * mất khả năng phối hợp: mọi trao đổi phải mô tả bằng lời cách bấm lại bộ lọc.
 *
 * VÌ SAO KHÔNG CHÉP LẠI MẪU CỦA `MonitorPage`
 *
 * Mẫu đó đúng nhưng dài, và chép tay bốn lần sẽ lệch nhau ngay lần đầu ai đó
 * sửa một chỗ — đúng cơ chế sinh lỗi số 3 mà review §7.3 mô tả (bản vá nằm ở
 * một tầng, tầng bên cạnh không biết tới nó). `MonitorPage` sẽ được chuyển sang
 * hook này ở một bước riêng để không trộn hai loại thay đổi trong một lần sửa.
 *
 * LUẬT
 *
 *  1. Giá trị bằng `defaults` thì **không** ghi vào URL. Một thanh địa chỉ đầy
 *     `?status=all&q=&event=` không đọc được và không chia sẻ được.
 *  2. Luôn dùng `replace: true`: gõ vào ô tìm kiếm không được sinh ra một mục
 *     lịch sử cho mỗi ký tự, nếu không nút Back trở nên vô dụng.
 *  3. Hook không tự suy kiểu — trang tự ép kiểu giá trị đọc ra. Cố suy kiểu ở
 *     đây sẽ đẻ ra một lớp generic phức tạp hơn chính chỗ nó phục vụ.
 */
export interface UrlFilters<K extends string> {
  /** Giá trị hiện tại của mọi khoá, đã áp mặc định. */
  values: Record<K, string>
  /** Đặt một khoá; bằng mặc định ⇒ xoá khỏi URL. */
  set: (key: K, value: string) => void
  /** Đặt nhiều khoá cùng lúc — một lần ghi URL, không phải nhiều lần. */
  setMany: (patch: Partial<Record<K, string>>) => void
  /** Trả mọi khoá về mặc định, giữ nguyên các tham số khác của URL. */
  clear: () => void
  /** Có khoá nào đang khác mặc định không (để hiện nút "Xoá lọc"). */
  isFiltered: boolean
}

export function useUrlFilters<K extends string>(defaults: Record<K, string>): UrlFilters<K> {
  const [searchParams, setSearchParams] = useSearchParams()

  const keys = useMemo(() => Object.keys(defaults) as K[], [defaults])

  const values = useMemo(() => {
    const result = {} as Record<K, string>
    for (const key of keys) result[key] = searchParams.get(key) ?? defaults[key]
    return result
  }, [defaults, keys, searchParams])

  const setMany = useCallback((patch: Partial<Record<K, string>>) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      for (const [key, value] of Object.entries(patch) as Array<[K, string]>) {
        if (value === undefined) continue
        // Giá trị mặc định không nằm trong URL: xem luật 1 ở đầu tệp.
        if (value === '' || value === defaults[key]) next.delete(key)
        else next.set(key, value)
      }
      return next
    }, { replace: true })
  }, [defaults, setSearchParams])

  const set = useCallback((key: K, value: string) => setMany({ [key]: value } as Partial<Record<K, string>>), [setMany])

  const clear = useCallback(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      /* Chỉ xoá khoá của CHÍNH bộ lọc này. Xoá sạch query sẽ nuốt luôn những
         tham số do nơi khác đặt (ví dụ `?alarm=` của deep link từ Landing), và
         người dùng mất ngữ cảnh mình vừa đến từ đâu. */
      for (const key of keys) next.delete(key)
      return next
    }, { replace: true })
  }, [keys, setSearchParams])

  const isFiltered = keys.some((key) => values[key] !== defaults[key])

  return { values, set, setMany, clear, isFiltered }
}
