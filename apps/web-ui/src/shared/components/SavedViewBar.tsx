import { BookmarkPlus, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useI18n } from '../i18n'
import { SAVED_VIEW_NAME_MAX, type SavedView } from '../savedViews'
import { Button } from './Button'
import { Modal } from './Modal'

/**
 * Thanh khung nhìn đặt tên — `T57-2.3`.
 *
 * MỘT THANH DÙNG CHUNG CHO NHIỀU TRANG
 *
 * Monitor và Trends cần đúng bốn thao tác giống nhau (mở · lưu · đổi tên ·
 * xoá) trên hai tập tham số khác nhau. Phần khác nhau nằm ở tham số, nên nó là
 * thứ trang truyền vào; phần giống nhau nằm ở thao tác, nên nó ở đây.
 *
 * KHÔNG TỰ ÁP KHUNG NHÌN KHI ĐANG GÕ
 *
 * Chọn trong danh sách là một lệnh rõ ràng của người dùng; component chỉ gọi
 * `onApply` khi có lệnh đó, không bao giờ tự khôi phục khung nhìn "gần nhất".
 * Bộ lọc tự nhảy về một trạng thái người dùng không yêu cầu là kiểu hỏng khó
 * chịu nhất của tính năng này.
 */
export function SavedViewBar({ views, activeName, onApply, onSave, onRename, onRemove, hint }: {
  views: SavedView[]
  /** Tên khung nhìn đang mở, nếu trang biết. Chỉ để hiện chọn sẵn. */
  activeName?: string | null
  onApply: (view: SavedView) => void
  /** Trang tự quyết định tham số nào được chụp lại. */
  onSave: (name: string) => void
  onRename: (from: string, to: string) => void
  onRemove: (name: string) => void
  /** Câu nói rõ phạm vi lưu. Trang truyền vào để hợp ngữ cảnh của nó. */
  hint?: string
}) {
  const { pick } = useI18n()
  const [saveOpen, setSaveOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [selected, setSelected] = useState<string>(activeName ?? '')

  const current = views.find((view) => view.name === selected)

  function applySelection(name: string) {
    setSelected(name)
    const view = views.find((item) => item.name === name)
    if (view) onApply(view)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-xs text-[var(--c-text-dim)]">
        {pick('Khung nhìn', 'Saved view')}
        <select
          aria-label={pick('Khung nhìn đã lưu', 'Saved views')}
          className="h-8 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-2 text-xs text-[var(--c-text)]"
          value={selected}
          onChange={(event) => applySelection(event.target.value)}
        >
          <option value="">{views.length ? pick('— Chọn khung nhìn —', '— Pick a view —') : pick('— Chưa có khung nhìn nào —', '— No saved views —')}</option>
          {views.map((view) => <option key={view.name} value={view.name}>{view.name}</option>)}
        </select>
      </label>

      <Button
        size="sm"
        icon={<BookmarkPlus className="h-4 w-4" />}
        onClick={() => { setDraftName(''); setSaveOpen(true) }}
      >
        {pick('Lưu khung nhìn', 'Save view')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        icon={<Pencil className="h-4 w-4" />}
        disabled={!current}
        onClick={() => { setDraftName(current?.name ?? ''); setRenameOpen(true) }}
      >
        {pick('Đổi tên', 'Rename')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        icon={<Trash2 className="h-4 w-4" />}
        disabled={!current}
        onClick={() => {
          if (!current) return
          onRemove(current.name)
          setSelected('')
        }}
      >
        {pick('Xoá', 'Delete')}
      </Button>

      {hint && <span className="text-[11px] text-[var(--c-text-dim)]">{hint}</span>}

      <Modal
        open={saveOpen}
        title={pick('Lưu khung nhìn hiện tại', 'Save the current view')}
        confirmLabel={pick('Lưu', 'Save')}
        cancelLabel={pick('Huỷ', 'Cancel')}
        confirmDisabled={!draftName.trim()}
        onConfirm={() => {
          onSave(draftName)
          setSelected(draftName.trim().slice(0, SAVED_VIEW_NAME_MAX))
          setSaveOpen(false)
        }}
        onClose={() => setSaveOpen(false)}
      >
        <label className="block space-y-1 text-sm">
          <span>{pick('Đặt tên cho bộ lọc đang xem', 'Name the filters you are looking at')}</span>
          <input
            autoFocus
            value={draftName}
            maxLength={SAVED_VIEW_NAME_MAX}
            onChange={(event) => setDraftName(event.target.value)}
            className="h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
          />
          {/* Trùng tên là CẬP NHẬT, không phải tạo bản thứ hai — nói trước để
              người dùng không mất khung nhìn cũ mà không hiểu vì sao. */}
          {views.some((view) => view.name === draftName.trim()) && (
            <span className="block text-xs text-[var(--c-warn-fg)]">
              {pick('Tên này đã có — lưu sẽ ghi đè khung nhìn cũ.', 'That name already exists — saving overwrites it.')}
            </span>
          )}
        </label>
      </Modal>

      <Modal
        open={renameOpen}
        title={pick('Đổi tên khung nhìn', 'Rename view')}
        confirmLabel={pick('Đổi tên', 'Rename')}
        cancelLabel={pick('Huỷ', 'Cancel')}
        confirmDisabled={!draftName.trim()}
        onConfirm={() => {
          if (current) onRename(current.name, draftName)
          setSelected(draftName.trim().slice(0, SAVED_VIEW_NAME_MAX))
          setRenameOpen(false)
        }}
        onClose={() => setRenameOpen(false)}
      >
        <label className="block space-y-1 text-sm">
          <span>{pick('Tên mới', 'New name')}</span>
          <input
            autoFocus
            value={draftName}
            maxLength={SAVED_VIEW_NAME_MAX}
            onChange={(event) => setDraftName(event.target.value)}
            className="h-10 w-full rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-bg)] px-3 text-sm text-[var(--c-text)] outline-none focus:border-[var(--c-accent)]"
          />
        </label>
      </Modal>
    </div>
  )
}
