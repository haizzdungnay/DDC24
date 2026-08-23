import { useEffect, useRef, useState, type RefObject } from 'react'
import { Check, Copy, X } from 'lucide-react'
import { useI18n } from '../../../shared/i18n'
import { contextDetailRows, type ContextDetailRow, type ContextDetailRowId, type ContextDetailsData } from './contextDetails'

export interface ContextDetailsCloseOptions {
  /**
   * `true` khi lệnh đóng đến từ bàn phím hoặc nút `Đóng` — lúc đó tiêu điểm
   * PHẢI quay về nút đã mở, nếu không người dùng bàn phím bị bắn về đầu tài
   * liệu và mất chỗ đang đứng. `false` khi người dùng bấm ra ngoài: lúc đó họ
   * đã tự chọn nơi đến, giật tiêu điểm về nút cũ là cướp quyền của họ.
   */
  returnFocus: boolean
}

/**
 * `ContextDetailsPopover` — `T60-103`.
 *
 * VÌ SAO POPOVER NÀY TỒN TẠI
 * --------------------------
 * `AC-PGM01-01` gỡ mọi UUID khỏi mặt trước Context Strip (`T60-102`). Gỡ mà
 * không trả lại một lối đọc khác thì không phải "gọn hơn", mà là **mất dữ
 * liệu**: khi mở phiếu sự cố hoặc gọi API tay, người vận hành vẫn cần đúng
 * chuỗi `revisionId`/`controllerId` đó. Popover này là lối đọc ấy — và là lối
 * DUY NHẤT, nên nó phải đi được bằng bàn phím trọn vẹn.
 *
 * KHÔNG PHẢI MODAL
 * ----------------
 * Không dùng `shared/components/Modal`: đây là một tấm thẻ dữ kiện dính vào
 * nút `Chi tiết`, không phải một quyết định chặn luồng. Modal mang `aria-modal`
 * + lớp phủ tối + cặp nút `Xác nhận`/`Huỷ` — cả ba đều sai ngữ nghĩa cho một
 * panel chỉ-đọc, và lớp phủ toàn màn hình sẽ che chính cái strip mà nó đang
 * giải thích. Đổi lại, ở đây phải tự lo ba việc mà Modal làm sẵn: tiêu điểm
 * lúc mở, `Esc` đóng, và trả tiêu điểm về nút đã mở.
 *
 * CLIPBOARD KHÔNG PHẢI LÚC NÀO CŨNG CÓ
 * ------------------------------------
 * `navigator.clipboard` vắng mặt trong ngữ cảnh không bảo mật (HTTP thuần —
 * đúng cách nhiều board lab được truy cập) và trong jsdom; nó cũng có thể
 * `reject` khi trình duyệt từ chối quyền. Cả hai nhánh được nuốt gọn tại
 * `copyToClipboard` và biến thành một thông điệp có ích, KHÔNG bao giờ thành
 * promise reject lọt ra ngoài làm hỏng cả strip.
 */
export function ContextDetailsPopover({ data, anchorRef, onClose }: {
  data: ContextDetailsData
  /** Nút `Chi tiết` — vừa là mỏ neo, vừa là nơi tiêu điểm quay về. */
  anchorRef: RefObject<HTMLElement | null>
  onClose: (options: ContextDetailsCloseOptions) => void
}) {
  const { pick } = useI18n()
  const dialogRef = useRef<HTMLDivElement>(null)
  const valueRefs = useRef(new Map<ContextDetailRowId, HTMLElement | null>())
  const [copyResult, setCopyResult] = useState<{ id: ContextDetailRowId; message: string; ok: boolean } | null>(null)
  const rows = contextDetailRows(pick, data)

  // Tiêu điểm vào chính panel (không phải vào nút Copy đầu tiên): trình đọc màn
  // hình đọc tiêu đề panel trước, rồi người dùng Tab tới hành động — đảo lại
  // thứ tự này sẽ đọc "Sao chép ID Revision Nháp" mà chưa nói đang ở đâu.
  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose({ returnFocus: true })
    }
    const handlePointerDown = (event: Event) => {
      const target = event.target
      if (!(target instanceof Node)) return
      // Bấm vào chính nút mỏ neo KHÔNG được xử lý ở đây: nút đó tự đảo trạng
      // thái. Đóng ở đây rồi để nút mở lại sẽ thành "bấm mà không đóng được".
      if (dialogRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      onClose({ returnFocus: false })
    }
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [anchorRef, onClose])

  async function handleCopy(row: ContextDetailRow) {
    if (!row.value) return
    const ok = await copyToClipboard(row.value)
    if (ok) {
      setCopyResult({ id: row.id, ok: true, message: pick(`Đã sao chép ${row.label}`, `Copied ${row.label}`) })
      return
    }
    // Thất bại KHÔNG được im lặng: bôi đen sẵn chuỗi để `Ctrl+C` thủ công còn
    // dùng được, và nói rõ vì sao nút vừa bấm trông như không làm gì.
    const selected = selectContents(valueRefs.current.get(row.id) ?? null)
    setCopyResult({
      id: row.id,
      ok: false,
      message: selected
        ? pick('Trình duyệt không cho sao chép tự động. Chuỗi đã được bôi đen — nhấn Ctrl+C.', 'The browser blocked automatic copy. The text is selected — press Ctrl+C.')
        : pick('Trình duyệt không cho sao chép tự động. Hãy chọn chuỗi rồi nhấn Ctrl+C.', 'The browser blocked automatic copy. Select the text and press Ctrl+C.')
    })
  }

  return (
    <div
      ref={dialogRef}
      id="programming-context-details"
      role="dialog"
      aria-labelledby="programming-context-details-title"
      aria-describedby="programming-context-details-intro"
      tabIndex={-1}
      data-testid="programming-context-details"
      /* Nằm NGOÀI hàng 38 px (hàng đó `overflow-hidden`, đặt trong đó thì panel
         bị cắt cụt). `z-30` để nổi trên nội dung workspace nhưng vẫn dưới
         `TopBar` (`z-40`), đúng thứ tự đã chốt ở `T60-102`. */
      className="absolute right-3 top-full z-30 mt-1 w-[min(32rem,calc(100vw-1.5rem))] rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3 shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="programming-context-details-title" className="text-sm font-semibold text-[var(--c-text)]">
            {pick('Chi tiết kỹ thuật', 'Technical details')}
          </h3>
          <p id="programming-context-details-intro" className="mt-0.5 text-[11px] text-[var(--c-text-dim)]">
            {pick('Định danh thô để dán vào phiếu sự cố hoặc lệnh gọi API. Dữ kiện chưa đọc được hiện dấu — kèm lý do, không hiện số 0.', 'Raw identifiers to paste into an incident ticket or an API call. Data that could not be read shows a dash and a reason, never a zero.')}
          </p>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-[var(--radius)] p-1 text-[var(--c-text-dim)] transition hover:bg-[var(--c-accent-bg)] hover:text-[var(--c-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]"
          aria-label={pick('Đóng chi tiết kỹ thuật', 'Close technical details')}
          onClick={() => onClose({ returnFocus: true })}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <dl className="mt-2 divide-y divide-[var(--c-border)] text-xs">
        {rows.map((row) => (
          <div key={row.id} data-detail-row={row.id} className="flex items-start gap-2 py-1.5">
            <div className="min-w-0 flex-1">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--c-text-dim)]">{row.label}</dt>
              <dd className="mt-0.5">
                {row.value ? (
                  <span
                    ref={(element) => { valueRefs.current.set(row.id, element) }}
                    className="block break-all font-mono text-[var(--c-text)]"
                  >
                    {row.value}
                  </span>
                ) : (
                  /* `—` một mình là một ô trống lịch sự; lý do đi kèm mới là
                     thứ trả lời được "tôi phải làm gì tiếp". */
                  <span className="block text-[var(--c-text-dim)]">
                    <span aria-hidden="true">— </span>
                    <span>{row.missingReason}</span>
                  </span>
                )}
                {row.hint ? <span className="mt-0.5 block text-[10px] text-[var(--c-text-dim)]">{row.hint}</span> : null}
              </dd>
            </div>
            <button
              type="button"
              className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-[var(--radius)] border border-[var(--c-border)] px-2 py-1 text-[11px] font-semibold text-[var(--c-text-dim)] transition hover:text-[var(--c-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)] disabled:opacity-50"
              /* Nhãn cho trình đọc màn hình phải nói SAO CHÉP CÁI GÌ: bảy nút
                 cùng mang chữ "Sao chép" thì danh sách nút của screen reader
                 trở thành bảy dòng giống hệt nhau. Chữ hiện trên màn hình vẫn
                 nằm trong nhãn (WCAG 2.5.3). */
              aria-label={row.value
                ? pick(`Sao chép ${row.label}`, `Copy ${row.label}`)
                : pick(`Sao chép ${row.label} — chưa có dữ liệu`, `Copy ${row.label} — no data yet`)}
              disabled={!row.value}
              title={row.value ? undefined : row.missingReason ?? undefined}
              onClick={() => { void handleCopy(row) }}
            >
              {copyResult?.id === row.id && copyResult.ok
                ? <Check className="h-3.5 w-3.5" aria-hidden="true" />
                : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
              <span>{pick('Sao chép', 'Copy')}</span>
            </button>
          </div>
        ))}
      </dl>

      {/* Một vùng `status` duy nhất: bảy vùng live song song sẽ khiến trình đọc
          màn hình đọc chồng lên nhau. Nội dung luôn nêu rõ dòng nào. */}
      <p
        role="status"
        data-testid="programming-context-details-copy-status"
        className={`mt-1 min-h-[1rem] text-[11px] ${copyResult && !copyResult.ok ? 'text-[var(--c-warn-fg)]' : 'text-[var(--c-text-dim)]'}`}
      >
        {copyResult?.message ?? ''}
      </p>
    </div>
  )
}

/**
 * `false` thay vì ném lỗi ở mọi nhánh hỏng: API vắng mặt (HTTP thuần, jsdom),
 * quyền bị từ chối, hoặc `writeText` reject sau đó. Tầng gọi chỉ cần biết
 * "chép được hay không" để nói cho người dùng.
 */
export async function copyToClipboard(value: string): Promise<boolean> {
  try {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
    if (typeof clipboard?.writeText !== 'function') return false
    await clipboard.writeText(value)
    return true
  } catch {
    // Trình duyệt từ chối quyền là một câu trả lời hợp lệ, không phải sự cố.
    return false
  }
}

/** Bôi đen nội dung một phần tử; `false` khi môi trường không cho chọn. */
function selectContents(element: HTMLElement | null): boolean {
  if (!element) return false
  try {
    const selection = window.getSelection?.()
    if (!selection || typeof document.createRange !== 'function') return false
    const range = document.createRange()
    range.selectNodeContents(element)
    selection.removeAllRanges()
    selection.addRange(range)
    return true
  } catch {
    // jsdom cũ và một số WebView không cài đặt đủ Selection API.
    return false
  }
}
