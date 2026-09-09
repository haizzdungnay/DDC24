import type { ReactNode } from 'react'

/**
 * Khung trình bày duy nhất cho toolbar ST/FBD trong PGM-02.
 *
 * Trạng thái và command vẫn thuộc editor đang mở; component này chỉ sở hữu
 * hierarchy, wrapping và accessible heading để các editor không tự dựng lại
 * một hàng công cụ khác nhau.
 */
export function EditorToolbar({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div
      className="flex shrink-0 flex-wrap items-center justify-between gap-2"
      data-testid="editor-toolbar"
    >
      <h3 className="sr-only">{heading}</h3>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  )
}
