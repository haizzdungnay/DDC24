import { Lock } from 'lucide-react'
import { useI18n } from '../../../shared/i18n'
import type { draftLibraryLock } from '../model/signals'

/**
 * `T61-301` — khoá phiên bản thư viện của bản nháp, tách khỏi controller.
 *
 * Ba trạng thái được giữ TÁCH BẠCH: đang đọc, đọc hỏng, và đọc được. Gộp hai
 * trạng thái đầu lại sẽ hiện một dấu `—` trông như "bản nháp chưa ghim thư viện
 * nào", trong khi sự thật là chưa đọc được.
 */
export function LibraryVersionLock({
  lock,
  status
}: {
  lock: ReturnType<typeof draftLibraryLock>
  status: 'loading' | 'ready' | 'error'
}) {
  const { pick } = useI18n()
  if (status === 'loading') {
    return (
      <p className="mt-3 text-xs text-[var(--c-text-dim)]">
        {pick('Đang đọc khoá phiên bản thư viện…', 'Reading the library version lock…')}
      </p>
    )
  }
  if (status === 'error' || !lock) {
    return (
      <p role="status" className="mt-3 flex items-center gap-1.5 text-xs text-[var(--c-warn-fg)]">
        <Lock className="h-3.5 w-3.5" aria-hidden="true" />
        {pick(
          'Chưa đọc được khoá phiên bản thư viện của bản nháp.',
          'The draft’s library version lock could not be read.'
        )}
      </p>
    )
  }
  return (
    <dl aria-label={pick('Khoá phiên bản thư viện', 'Library version lock')} className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
      <div className="flex gap-1.5">
        <dt className="text-[var(--c-text-dim)]">{pick('Profile SYSTEM', 'SYSTEM profile')}</dt>
        <dd className="font-medium">{lock.systemProfile || '—'}</dd>
      </div>
      <div className="flex gap-1.5">
        <dt className="text-[var(--c-text-dim)]">{pick('Phiên bản SYSTEM', 'SYSTEM version')}</dt>
        <dd className="font-medium">{lock.systemVersion || '—'}</dd>
      </div>
      <div className="flex gap-1.5">
        <dt className="text-[var(--c-text-dim)]">{pick('Thư viện PROJECT đã ghim', 'Pinned PROJECT library')}</dt>
        <dd className="font-medium">
          {lock.projectLibraryRevisionId ?? pick('Chưa có bản nào', 'None yet')}
        </dd>
      </div>
    </dl>
  )
}

