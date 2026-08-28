import { RefreshCw } from 'lucide-react'
import { useI18n } from '../../../shared/i18n'
import { Button } from '../../../shared/components/Button'
import { useLocation } from 'react-router-dom'

/**
 * `ProgrammingHeader` — UX §16.1.4/§22/§23. Rev A chỉ có `projectsPerController
 * = 1` (`ProgrammingCapabilities.limits`), nên workspace không cần bộ chọn
 * Project đa lựa chọn: mỗi controller có đúng một Project, và Overview dẫn
 * thẳng tới nó. `onRefresh` làm mới các query đọc đang hiển thị — không phải
 * mutation.
 */
export function ProgrammingHeader({ onRefresh, refreshing }: { onRefresh: () => void; refreshing: boolean }) {
  const { pick } = useI18n()
  const location = useLocation()
  const overview = location.pathname === '/eng/programming' || location.pathname === '/eng/programming/'
  return (
    <header className={`flex flex-wrap justify-between gap-3 ${overview ? 'items-start py-1' : 'items-center'}`}>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--c-accent)]">Programming workstation</p>
        <h1 className={`${overview ? 'text-2xl' : 'text-lg'} font-bold text-[var(--c-text)]`}>{pick('Lập trình điều khiển', 'Control programming')}</h1>
        {overview && (
          <p className="mt-1 text-sm text-[var(--c-text-dim)]">
            {pick(
              'Theo dõi ứng dụng đang chạy, tiếp tục bản nháp và xử lý các vấn đề cần chú ý.',
              'Monitor the running application, continue draft work, and resolve items requiring attention.'
            )}
          </p>
        )}
      </div>
      <Button
        variant="secondary"
        size="sm"
        className="disabled:opacity-100"
        icon={<RefreshCw className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden="true" />}
        onClick={onRefresh}
        disabled={refreshing}
        aria-busy={refreshing}
      >
        {pick('Làm mới', 'Refresh')}
      </Button>
    </header>
  )
}
