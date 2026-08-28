import { Button } from './Button'
import { Modal } from './Modal'
import type { DirtyGuard } from '../hooks/useDirtyGuard'
import { useI18n } from '../i18n'

/**
 * Hộp thoại đi kèm `useDirtyGuard` (`BB-2`, finding `F-UX-12`).
 *
 * VÌ SAO LÀ MỘT COMPONENT DÙNG CHUNG
 *
 * Bốn trang cấu hình cần **đúng một** cách hỏi: ba lựa chọn *Lưu rồi rời đi /
 * Bỏ thay đổi, rời đi / Ở lại*. Nếu mỗi trang tự dựng hộp thoại thì thứ tự và
 * nhãn nút sẽ trôi khỏi nhau theo thời gian, và người vận hành mất phản xạ —
 * đúng loại khác biệt nhỏ gây ra thao tác sai dưới áp lực.
 *
 * Thứ tự nút cố ý đặt hành động **an toàn nhất** ("Ở lại") ở vị trí nút huỷ và
 * hành động **phá huỷ dữ liệu** ("Bỏ thay đổi") tách hẳn xuống thân hộp thoại
 * với biến thể `danger`, không nằm cạnh nút xác nhận. Đây là quy ước đã dùng ở
 * `InputsPage` từ FE-010, giữ nguyên để không dạy lại người dùng.
 */
export function DirtyGuardModal({ guard, title, message, saving = false, discardLabel, onSave, onDiscard }: {
  guard: DirtyGuard
  title: string
  message: string
  saving?: boolean
  discardLabel?: string
  /** Lưu bản nháp. Trả `false` khi lưu hỏng ⇒ **không** rời trang. */
  onSave: () => boolean | void | Promise<boolean | void>
  /** Hoàn nguyên bản nháp về bản đã lưu trước khi rời đi. */
  onDiscard: () => void
}) {
  const { pick } = useI18n()
  return (
    <Modal
      open={guard.pendingNavigation !== null}
      title={title}
      cancelLabel={pick('Ở lại', 'Stay')}
      confirmLabel={pick('Lưu rồi rời đi', 'Save and leave')}
      confirmLoading={saving}
      onClose={guard.cancelNavigation}
      onConfirm={() => {
        /* Lưu hỏng thì Ở LẠI. Rời trang sau một lần lưu thất bại là cách chắc
         * chắn nhất để mất bản nháp đúng lúc người dùng tin là đã giữ được nó. */
        void Promise.resolve(onSave()).then((ok) => {
          if (ok === false) return
          guard.leaveNow()
        })
      }}
    >
      <p>{message}</p>
      <Button
        className="mt-3"
        variant="danger"
        disabled={saving}
        onClick={() => {
          onDiscard()
          guard.leaveNow()
        }}
      >
        {discardLabel ?? pick('Bỏ thay đổi, rời đi', 'Discard changes and leave')}
      </Button>
    </Modal>
  )
}
