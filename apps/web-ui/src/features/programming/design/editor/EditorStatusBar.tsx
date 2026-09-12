import type { ReactNode } from 'react'
import { useI18n } from '../../../../shared/i18n'
import type { EditorStatusField } from './editorStatus'

/**
 * `T59-821` / `TC-PGM02-SB-01` — thanh trạng thái editor.
 *
 * Giá trị `null` hiện `—`. Không có mặc định `UTF-8`/`LF`: chúng đúng trong đa
 * số trường hợp nên sẽ không bao giờ trông sai, và đó chính là điều nguy hiểm —
 * một lời khẳng định về tệp mà không ai kiểm.
 */
export function EditorStatusBar({
  fields,
  onGoToPosition,
  leading,
}: {
  fields: readonly EditorStatusField[]
  /**
   * `DEV-PROG-012` — bấm vào ô `Dòng:Cột` mở hộp "Tới dòng".
   *
   * Chỉ ô đó bấm được, và chỉ khi tầng gọi cấp được hành động. Bốn ô còn lại
   * (chế độ chèn, xuống dòng, bảng mã, trạng thái) là SỰ KIỆN ĐÃ ĐO, không phải
   * lệnh; biến chúng thành nút sẽ hứa một thao tác không tồn tại.
   */
  onGoToPosition?: () => void
  /**
   * `PGM-02B` — nội dung neo bên trái dải trạng thái (ảnh chuẩn đặt chữ
   * `Sẵn sàng` ở đó). Có `leading` thì dải chuyển sang bố cục ảnh chuẩn: cao
   * 37px, các ô trạng thái dồn về phải. Không có thì giữ nguyên bố cục cũ —
   * tab ST đang dùng nó và không có lý do gì để đổi theo.
   */
  leading?: ReactNode
}) {
  const { pick } = useI18n()
  const label = (id: string): string => {
    switch (id) {
      case 'position': return pick('Dòng:Cột', 'Ln:Col')
      case 'insertMode': return pick('Chế độ', 'Mode')
      case 'eol': return pick('Xuống dòng', 'EOL')
      case 'encoding': return pick('Bảng mã', 'Encoding')
      case 'dirty': return pick('Trạng thái', 'State')
      case 'zoom': return pick('Thu phóng', 'Zoom')
      case 'language': return pick('Ngôn ngữ', 'Language')
      case 'connection': return pick('Kết nối', 'Connection')
      default: return id
    }
  }
  const display = (field: EditorStatusField): string => {
    if (field.value === null) return '—'
    switch (field.value) {
      case 'INSERT': return pick('Chèn', 'Insert')
      case 'OVERWRITE': return pick('Đè', 'Overwrite')
      case 'DIRTY': return pick('Chưa lưu', 'Unsaved')
      case 'SAVED': return pick('Đã lưu', 'Saved')
      case 'MIXED': return pick('Trộn kiểu', 'Mixed')
      case 'ONLINE': return pick('Trực tuyến', 'Online')
      case 'DEGRADED': return pick('Suy giảm', 'Degraded')
      case 'OFFLINE': return pick('Mất kết nối', 'Offline')
      default: return field.value
    }
  }

  /* `leading` KHÔNG PHẢI MỘT CẶP THUẬT NGỮ–MÔ TẢ, nên nó không được nằm trong
   * `<dl>`.
   *
   * Trước đây cả dải là một `<dl>` và `leading` (chữ `Sẵn sàng` của ảnh chuẩn
   * PGM-02B) được bọc trong một `<div><span>` đặt thẳng vào đó. HTML chỉ cho
   * `<dl>` chứa `<dt>`/`<dd>` — hoặc `<div>` BỌC một nhóm `dt`/`dd` — nên đây
   * là vi phạm `definition-list` mức `serious`: trình đọc màn hình đọc danh
   * sách định nghĩa ấy và gặp một mục không thuộc cặp nào. `AxeBuilder` trong
   * `UJ-PROG-01..08` bắt đúng lỗi này; nó không bị phát hiện sớm hơn vì
   * journey đó đã chết ở một khẳng định TRƯỚC (huy hiệu `Chưa lưu` dựng trùng)
   * nên chưa lần nào chạy tới lượt quét a11y.
   *
   * Vỏ hàng chuyển ra `<div>`, `<dl>` dùng `display: contents` để giữ NGUYÊN
   * bố cục flex (các nhóm `dt`/`dd` vẫn là flex item của hàng) trong khi cây
   * ngữ nghĩa trở lại đúng: danh sách định nghĩa chỉ còn các cặp thật. */
  return (
    <div
      data-testid="editor-status-bar"
      className={leading
        ? 'flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--c-border)] px-2 py-1 text-[11px] text-[var(--c-text-dim)] min-[1440px]:h-[37px] min-[1440px]:flex-nowrap min-[1440px]:justify-end min-[1440px]:py-0'
        : 'flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--c-border)] px-2 py-1 text-[11px] text-[var(--c-text-dim)]'}
    >
      {leading && <div className="min-[1440px]:mr-auto">{leading}</div>}
      <dl className="contents" aria-label={pick('Trạng thái trình soạn thảo', 'Editor status')}>
      {fields.map((field) => {
        const value = (
          <dd className={field.value === null ? 'text-[var(--c-text-dim)]' : 'font-mono text-[var(--c-text)]'}>
            {display(field)}
          </dd>
        )
        return (
          <div key={field.id} className="flex items-center gap-1" data-testid={`editor-status-${field.id}`}>
            <dt>{label(field.id)}</dt>
            {field.id === 'position' && onGoToPosition ? (
              <button
                type="button"
                onClick={onGoToPosition}
                title={pick('Tới dòng… (Ctrl+G)', 'Go to line… (Ctrl+G)')}
                className="rounded px-1 underline decoration-dotted underline-offset-2 hover:text-[var(--c-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
              >
                {value}
              </button>
            ) : value}
          </div>
        )
      })}
      </dl>
    </div>
  )
}
