import { useEffect, useState } from 'react'
import { apiClient } from '../../shared/api/client'
import { useI18n } from '../../shared/i18n'
import type { VirtualPointUsage } from '../../shared/types'

/**
 * "Ai đang dùng điểm ảo này" trong hộp thoại xoá — `T57-3.12` (§6.11-P2).
 *
 * Hộp thoại xoá cũ chỉ hiện đúng cái tag. Hậu quả của việc xoá thì xuất hiện
 * sau đó: một luật cảnh báo mất nguồn, một lịch vận hành mất đích ghi — và giữa
 * thao tác với sự cố có thể là vài ngày, đủ để không ai nối được hai việc.
 *
 * Khối này **không chặn xoá**. Quyết định vẫn thuộc người vận hành; thứ họ
 * thiếu chỉ là dữ kiện. Nhưng nó phải trung thực về CHÍNH NÓ: khi backend không
 * đọc được một nguồn nào đó, danh sách là không đầy đủ và điều đó phải hiện ra,
 * vì "không ai dùng" đọc nhầm thành "xoá vô hại".
 */
export function VirtualPointUsageNotice({ pointId }: { pointId: string | null }) {
  const { pick } = useI18n()
  const [usage, setUsage] = useState<VirtualPointUsage | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')

  useEffect(() => {
    if (!pointId) {
      setUsage(null)
      setState('idle')
      return
    }
    let active = true
    setState('loading')
    /* Bọc trong `Promise.resolve().then` để một lỗi ĐỒNG BỘ (client cũ thiếu
       hàm, mock trong test) cũng rơi vào nhánh lỗi thay vì ném ra ngoài và làm
       trắng cả trang xoá. Một tiện ích tra cứu không được phép hạ cả màn hình. */
    Promise.resolve().then(() => apiClient.getVirtualPointUsage(pointId))
      .then((result) => {
        if (!active) return
        setUsage(result)
        setState('idle')
      })
      .catch(() => {
        if (!active) return
        setUsage(null)
        setState('error')
      })
    return () => { active = false }
  }, [pointId])

  if (!pointId) return null

  if (state === 'loading') {
    return <p className="mt-2 text-xs text-[var(--c-text-dim)]">{pick('Đang tra cứu nơi đang dùng điểm này…', 'Looking up where this point is used…')}</p>
  }

  /* Tra cứu hỏng KHÔNG được im lặng: người dùng sẽ đọc sự vắng mặt của cảnh báo
     thành "không có gì dùng nó". */
  if (state === 'error') {
    return (
      <p role="status" className="mt-2 rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] px-3 py-2 text-xs text-[var(--c-warn-fg)]">
        {pick('Không tra cứu được nơi đang dùng điểm này. Xoá lúc này là xoá mà không biết hậu quả.', 'Could not look up where this point is used. Deleting now means deleting without knowing the consequences.')}
      </p>
    )
  }

  if (!usage) return null

  if (usage.references.length === 0) {
    return (
      <p className="mt-2 text-xs text-[var(--c-text-dim)]">
        {usage.incomplete
          ? pick('Không tìm thấy nơi nào dùng điểm này, nhưng một số nguồn không đọc được nên danh sách chưa đầy đủ.', 'Nothing found using this point, but some sources could not be read, so the list is incomplete.')
          : pick(`Không có cảnh báo hay lịch vận hành nào đang dùng điểm này (đã quét: ${usage.scanned.join(', ')}).`, `No alarm or schedule uses this point (scanned: ${usage.scanned.join(', ')}).`)}
      </p>
    )
  }

  return (
    <div className="mt-2 rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-3 text-xs">
      <div className="font-bold uppercase text-[var(--c-warn-fg)]">
        {pick(`${usage.references.length} nơi đang dùng điểm này`, `${usage.references.length} place(s) use this point`)}
      </div>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[var(--c-text)]">
        {usage.references.map((reference) => (
          <li key={`${reference.kind}-${reference.id}`}>
            <span className="font-semibold">{kindLabel(reference.kind, pick)}</span>{' '}
            <span className="mono">{reference.id}</span>
            {reference.name ? ` — ${reference.name}` : ''}
            {reference.detail ? ` (${reference.detail})` : ''}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[var(--c-warn-fg)]">
        {pick('Xoá điểm này sẽ để những mục trên mất nguồn/đích.', 'Deleting this point leaves the items above without their source or target.')}
      </p>
    </div>
  )
}

function kindLabel(kind: string, pick: (vi: string, en: string) => string): string {
  if (kind === 'alarm') return pick('Cảnh báo', 'Alarm')
  if (kind === 'schedule') return pick('Lịch vận hành', 'Schedule')
  if (kind === 'program') return pick('Chương trình', 'Program')
  return kind
}
