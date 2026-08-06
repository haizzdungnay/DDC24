import type { ReactNode } from 'react'

/**
 * Ô nhập có NHÃN NHÌN THẤY ĐƯỢC.
 *
 * Trước đây các form Modbus RTU chỉ dùng `placeholder` + `aria-label`. Nhưng
 * **placeholder biến mất ngay khi ô có giá trị**, mà mọi ô số đều có sẵn giá trị
 * mặc định — nên người dùng nhìn vào form chỉ thấy một hàng số trần
 * (`0 · uint16 · 1 · 0 · 0`) không biết là gì. `aria-label` thì chỉ trình đọc
 * màn hình và test nhìn thấy: form "đạt chuẩn a11y" trên giấy trong khi người
 * ngồi trước màn hình không đọc được nó.
 *
 * Nhãn nằm NGOÀI ô nên không mất khi gõ. `hint` mang phần giải thích dài cho
 * những trường dễ hiểu nhầm — thứ tự byte, địa chỉ 0-based, `retry` không phải
 * ngưỡng offline.
 */
export function Field({
  label,
  hint,
  className,
  children
}: {
  label: string
  hint?: string
  className?: string
  children: ReactNode
}) {
  return (
    <label className={`flex flex-col gap-1 ${className ?? ''}`} title={hint}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--c-text-dim)]">
        {label}
      </span>
      {children}
    </label>
  )
}
