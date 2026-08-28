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
 * `shared/LegacyTabRedirect.tsx`). `DangerZone` chỉ mount trong tab service;
 * tab Runtime/Watch giữ thuần đọc để hành động nguy hiểm không chen vào luồng
 * chẩn đoán.
 */
export function RuntimeServicePage() {
  const { pick } = useI18n()
  const { capabilities, runtime } = useProgrammingRuntimeContext()
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
      <header className="rounded-[var(--radius)] border border-[var(--c-border)] border-l-4 border-l-[var(--c-accent)] bg-[var(--c-surface)] px-5 py-4 shadow-sm sm:px-6">
        <p className="text-[10px] font-bold tracking-[0.16em] text-[var(--c-accent)]">PROGRAMMING / PGM-04</p>
        <h2 className="mt-1 text-xl font-bold tracking-tight text-[var(--c-text)]">{pick('Runtime & Bảo trì', 'Runtime & Service')}</h2>
        <p className="mt-1 text-sm text-[var(--c-text-dim)]">{pick('Chỉ đọc trạng thái đang có thẩm quyền; thao tác nguy hiểm nằm trong tab bảo trì.', 'Read authoritative runtime state; dangerous actions stay in the service tab.')}</p>
      </header>
      <div role="tablist" aria-label={pick('Tab Runtime & Bảo trì', 'Runtime & Service tabs')} className="flex gap-1 overflow-x-auto border-b border-[var(--c-border)]">
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
      {tab === 'service' && (
        <>
          <VersionsTab runtime={runtime.data} />
          <DangerZone runtime={runtime.data} runtimeStatus={runtime.status} taskPeriodsMs={capabilities.data?.taskPeriodsMs} />
        </>
      )}
    </div>
  )
}
