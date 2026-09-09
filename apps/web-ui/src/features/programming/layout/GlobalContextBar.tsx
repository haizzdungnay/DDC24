import { ProgrammingContextStrip } from './ProgrammingContextStrip'

export type GlobalContextBarProps = Parameters<typeof ProgrammingContextStrip>[0]

/**
 * Tên kiến trúc của dải ngữ cảnh Programming sau khi gộp header.
 * `ProgrammingContextStrip` được giữ làm facade tương thích cho các consumer
 * và test cũ; route mới dùng tên này để ownership của shell hiện rõ trong code.
 */
export function GlobalContextBar(props: GlobalContextBarProps) {
  return <ProgrammingContextStrip {...props} />
}
