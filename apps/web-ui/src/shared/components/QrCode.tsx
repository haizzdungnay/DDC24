import { useMemo } from 'react'
import { encodeQr } from '../qr'

/**
 * Mã QR vẽ tại chỗ bằng SVG — `T57-2.22`.
 *
 * Không gọi dịch vụ ngoài (bo không có đường ra Internet) và không nhúng ảnh
 * nhị phân: SVG hai màu ăn theo token nền/chữ nên đọc được ở cả giao diện sáng
 * lẫn tối, và in ra vẫn sắc nét.
 *
 * Vùng yên tĩnh 4 module quanh mã là bắt buộc theo ISO/IEC 18004 — thiếu nó,
 * nhiều máy quét điện thoại không bắt được mã dù các ô bên trong hoàn toàn
 * đúng, và lỗi đó rất khó truy ra khi đang đứng cạnh tủ.
 */
export function QrCode({ text, size = 160, label }: { text: string; size?: number; label?: string }) {
  const matrix = useMemo(() => {
    try {
      return encodeQr(text)
    } catch {
      /* Chuỗi quá dài cho phiên bản 1-6. Thà không hiện mã còn hơn hiện một mã
         cụt dẫn tới địa chỉ sai — địa chỉ vẫn nằm ngay bên cạnh dưới dạng chữ. */
      return null
    }
  }, [text])

  if (!matrix) return null

  const quiet = 4
  const modules = matrix.length
  const span = modules + quiet * 2

  return (
    <svg
      role="img"
      aria-label={label ?? text}
      viewBox={`0 0 ${span} ${span}`}
      width={size}
      height={size}
      className="rounded-[var(--radius)]"
      shapeRendering="crispEdges"
    >
      <rect x={0} y={0} width={span} height={span} fill="#ffffff" />
      {matrix.map((line, row) => line.map((dark, column) => dark
        ? <rect key={`${row}-${column}`} x={column + quiet} y={row + quiet} width={1} height={1} fill="#000000" />
        : null))}
    </svg>
  )
}
