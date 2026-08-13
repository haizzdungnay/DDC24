import { useI18n } from '../../../shared/i18n'
import { StateBlock } from '../../../shared/components/StateBlock'

/**
 * PGM-03 Kiểm tra & Đưa vào vận hành — `UJ-PROG-05/06`. Nối readiness/change
 * manifest/impact/acknowledgement/Commission/Unknown-reconcile ở TASK-PROG-504
 * (S5-C), sau khi PGM-02 (S5-B) đã tạo Draft/Revision hợp lệ để kiểm tra —
 * đúng thứ tự lát cắt bắt buộc A→B→C→D.
 */
export function CheckCommissionPage() {
  const { pick } = useI18n()
  return (
    <StateBlock
      state="empty"
      title={pick('Kiểm tra & Đưa vào vận hành', 'Check & Commission')}
      detail={pick(
        'Readiness, ảnh hưởng và Đưa vào vận hành được nối ở TASK-PROG-504.',
        'Readiness, impact and Commission land in TASK-PROG-504.'
      )}
    />
  )
}
