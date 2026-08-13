import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useI18n } from '../../../shared/i18n'
import { useProgrammingRuntimeContext } from '../layout/ProgrammingLayout'
import { RuntimeTab } from './RuntimeTab'
import { WatchTab } from './WatchTab'
import { VersionsTab } from './VersionsTab'
import { DangerZone } from './DangerZone'

const VALID_TABS = ['runtime', 'watch', 'service'] as const
type RuntimeTabKey = (typeof VALID_TABS)[number]

const TAB_LABEL: Record<RuntimeTabKey, [string, string]> = {
  runtime: ['Runtime', 'Runtime'],
  watch: ['Theo dõi', 'Watch'],
  service: ['Phiên bản & Bảo trì', 'Versions & Service']
}

/**
 * PGM-04 Runtime & Bảo trì — `UJ-PROG-07/08` (TASK-PROG-505). Tab
 * `?tab=runtime|watch|service` mặc định `runtime` — đây cũng là đích của
 * redirect `/runtime` (không tab) theo UX §11.1 dòng 5 (xem
 * `shared/LegacyTabRedirect.tsx`). `DangerZone` tách khỏi ba tab chỉ-đọc,
 * đặt cố định dưới cùng.
 */
export function RuntimeServicePage() {
  const { pick } = useI18n()
  const { runtime } = useProgrammingRuntimeContext()
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('tab')
  const tab: RuntimeTabKey = (VALID_TABS as readonly string[]).includes(requested ?? '') ? (requested as RuntimeTabKey) : 'runtime'

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
    <div className="space-y-4">
      <div role="tablist" aria-label={pick('Tab Runtime & Bảo trì', 'Runtime & Service tabs')} className="flex gap-1 border-b border-[var(--c-border)]">
        {VALID_TABS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            role="tab"
            aria-selected={candidate === tab}
            className={`rounded-t-[var(--radius)] border-b-2 px-3 py-1.5 text-sm font-medium ${
              candidate === tab ? 'border-[var(--c-accent)] text-[var(--c-accent)]' : 'border-transparent text-[var(--c-text-dim)] hover:text-[var(--c-text)]'
            }`}
            onClick={() =>
              setSearchParams(
                (current) => {
                  const next = new URLSearchParams(current)
                  next.set('tab', candidate)
                  return next
                },
                { replace: true }
              )
            }
          >
            {pick(...TAB_LABEL[candidate])}
          </button>
        ))}
      </div>

      {tab === 'runtime' && <RuntimeTab runtime={runtime.data} status={runtime.status} />}
      {tab === 'watch' && <WatchTab />}
      {tab === 'service' && <VersionsTab runtime={runtime.data} />}

      <DangerZone runtime={runtime.data} runtimeStatus={runtime.status} />
    </div>
  )
}
