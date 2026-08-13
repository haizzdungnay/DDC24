import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useI18n } from '../../../shared/i18n'
import { StateBlock } from '../../../shared/components/StateBlock'

const VALID_TABS = ['programs', 'mapping', 'execution'] as const
type DesignTab = (typeof VALID_TABS)[number]

/**
 * PGM-02 Thiết kế — `UJ-PROG-02/03/04`. Tab là trạng thái URL
 * (`DDD-FE-PROG-001` §0.1 ràng buộc 1): đọc/ghi `?tab=` bằng `replace` để
 * không làm bẩn lịch sử; tab không hợp lệ rơi về `programs`.
 *
 * Bộ ba tab Chương trình/Điểm & Ánh xạ/Thực thi và Draft dùng chung một
 * `useDraftQuery` được hoàn thiện ở TASK-PROG-501/502/503 (S5-B); trang này
 * hiện chỉ khoá đúng hợp đồng route/tab để S5-C/D có nền để nối tiếp mà không
 * phải sửa lại URL contract.
 */
export function DesignWorkspacePage() {
  const { pick } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('tab')
  const tab: DesignTab = (VALID_TABS as readonly string[]).includes(requested ?? '') ? (requested as DesignTab) : 'programs'

  useEffect(() => {
    if (requested === tab) return
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.set('tab', tab)
        return next
      },
      { replace: true }
    )
  }, [requested, tab, setSearchParams])

  return (
    <StateBlock
      state="empty"
      title={pick(`Workspace Thiết kế — tab ${tab}`, `Design workspace — ${tab} tab`)}
      detail={pick(
        'Cây ứng dụng, editor ST/FBD, ánh xạ Điểm và cấu hình Thực thi được nối ở TASK-PROG-501..503.',
        'The application tree, ST/FBD editor, point mapping and execution config land in TASK-PROG-501..503.'
      )}
    />
  )
}
