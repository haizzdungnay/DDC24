import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useI18n } from '../../../shared/i18n'
import { StateBlock } from '../../../shared/components/StateBlock'

const VALID_TABS = ['runtime', 'watch', 'service'] as const
type RuntimeTab = (typeof VALID_TABS)[number]

/**
 * PGM-04 Runtime & Bảo trì — `UJ-PROG-07/08`. Tab `?tab=runtime|watch|service`
 * mặc định `runtime` — đây cũng là đích của redirect `/runtime` (không tab)
 * theo UX §11.1 dòng 5, không cần một `<Route>` riêng (xem
 * `shared/LegacyTabRedirect.tsx`). Runtime/Theo dõi/Phiên bản & Bảo trì +
 * DangerZone được nối ở TASK-PROG-505 (S5-D), sau khi S5-C đã có Commission
 * thật để tạo dữ liệu runtime quan sát được.
 */
export function RuntimeServicePage() {
  const { pick } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('tab')
  const tab: RuntimeTab = (VALID_TABS as readonly string[]).includes(requested ?? '') ? (requested as RuntimeTab) : 'runtime'

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
      title={pick(`Runtime & Bảo trì — tab ${tab}`, `Runtime & Service — ${tab} tab`)}
      detail={pick(
        'Runtime, Theo dõi, Phiên bản & Bảo trì và vùng thao tác nguy hiểm được nối ở TASK-PROG-505.',
        'Runtime, Watch, Versions & Service and the danger zone land in TASK-PROG-505.'
      )}
    />
  )
}
