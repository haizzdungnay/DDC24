import { ArrowDownToLine, ArrowUpFromLine, CircleAlert, CircleCheck, CircleDashed, CircleSlash, ExternalLink, LockKeyhole, Unlink } from 'lucide-react'
import { StatusBadge } from '../../../../shared/components/StatusBadge'
import { Button } from '../../../../shared/components/Button'
import { useI18n } from '../../../../shared/i18n'
import { formatMappingValue, type MappingVariableRow } from './mappingViewModel'
import { mappingReasonText } from './mappingReasons'

/* `ISS-PGM03-05` — lưới BẢY cột dùng chung cho hàng tiêu đề và mọi hàng dữ
 * liệu. Một hằng duy nhất vì hai chuỗi lớp rời nhau sẽ lệch ngay lần đầu ai đó
 * sửa một bên: khi ấy tiêu đề vẫn hiện nhưng chỉ sai chỗ, tức tệ hơn không có
 * tiêu đề — người đọc tin vào một nhãn nằm trên cột khác. */
const ROW_GRID = 'xl:grid-cols-[minmax(10rem,1.4fr)_5.5rem_6rem_minmax(9rem,1.2fr)_6rem_6rem_auto]'

/** Nhãn cột: HIỆN ở mobile/card, chỉ còn cho screen reader ở desktop (đã có
 *  hàng tiêu đề). Một nguồn nhãn duy nhất cho cả hai khổ màn hình. */
function CellLabel({ children }: { children: string }) {
  return <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--c-text-dim)] xl:sr-only">{children}</span>
}

/**
 * Trạng thái binding của một hàng.
 *
 * `AC-PGM03-01` đòi nhận ra biến chưa map **mà không dựa vào màu**, nên mỗi
 * trạng thái mang đủ ba tín hiệu độc lập: biểu tượng, chữ, và kiểu viền
 * (`dashed` cho chưa map, liền cho đã map/bị chặn). Ảnh grayscale vẫn phân biệt
 * được, và screen reader đọc ra chữ chứ không phải một ô màu.
 */
function BindingStatusPill({ row, text }: { row: MappingVariableRow; text: string }) {
  const tone = row.bindingStatus === 'UNMAPPED'
    ? { icon: CircleDashed, className: 'border-dashed border-[var(--c-warn)] bg-[var(--c-warn-bg)] text-[var(--c-warn-fg)]' }
    : row.bindingStatus === 'POINT_UNAVAILABLE'
      ? { icon: CircleAlert, className: 'border-[var(--c-fault)] bg-[var(--c-fault-bg)] text-[var(--c-fault-fg)]' }
      : row.bindingStatus === 'INCOMPATIBLE' || row.eligibility !== 'SUPPORTED'
        ? { icon: CircleSlash, className: 'border-[var(--c-warn)] bg-[var(--c-warn-bg)] text-[var(--c-warn-fg)]' }
        : { icon: CircleCheck, className: 'border-[var(--c-good)] bg-[var(--c-good-bg)] text-[var(--c-good-fg)]' }
  const Icon = tone.icon
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone.className}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{text}</span>
    </span>
  )
}

export function VariableWorklist({ rows, selectedId, onSelect, onOpenSource, canMutate, mutationDisabled, onMap, filterSummary }: {
  rows: MappingVariableRow[]
  selectedId: string | null
  onSelect: (id: string) => void
  onOpenSource: (row: MappingVariableRow) => void
  canMutate: boolean
  mutationDisabled: boolean
  onMap: (row: MappingVariableRow) => void
  /** Điều kiện lọc đang áp, đã dịch. Rỗng = không lọc gì. */
  filterSummary?: string
}) {
  const { pick } = useI18n()
  return (
    <section className="flex min-h-0 min-w-0 flex-col rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] 2xl:h-[39rem] 2xl:max-h-[calc(100vh-18rem)]" aria-labelledby="mapping-variables-title">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--c-border)] px-4 py-3">
        <div><h2 id="mapping-variables-title" className="text-sm font-semibold text-[var(--c-text)]">{pick('Biến chương trình', 'Program Variables')}</h2><p className="mt-1 text-xs text-[var(--c-text-dim)]">{rows.length} {pick('biến interface · thay đổi chỉ ghi sau bước xem trước', 'interface variables · changes are written only after preview')}</p></div>
        <span className="rounded-full bg-[var(--c-accent-bg)] px-2 py-1 text-[11px] font-semibold text-[var(--c-accent)]">{canMutate ? 'EDIT' : 'READ-ONLY'}</span>
      </div>
      {/* Hàng tiêu đề chỉ để NHÌN: ở desktop mỗi ô dữ liệu vẫn mang nhãn riêng
        * qua `CellLabel` (`xl:sr-only`), nên đọc nó lần nữa bằng screen reader
        * chỉ tạo tiếng ồn. */}
      <div aria-hidden="true" className={`hidden gap-2 border-b border-[var(--c-border)] px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--c-text-dim)] xl:grid ${ROW_GRID}`}>
        <span>{pick('Biến', 'Variable')}</span>
        <span>{pick('Kiểu', 'Type')}</span>
        <span>{pick('Hướng', 'Direction')}</span>
        <span>{pick('Ánh xạ', 'Mapping')}</span>
        <span>{pick('Giá trị', 'Live Value')}</span>
        <span>Quality</span>
        <span className="text-right">{pick('Thao tác', 'Action')}</span>
      </div>
      <div data-testid="mapping-variable-list" className="min-h-0 flex-1 divide-y divide-[var(--c-border)] overflow-y-auto [scrollbar-gutter:stable]">
        {rows.length === 0 ? (
          <div className="p-4 text-sm text-[var(--c-text-dim)]">
            <p>{pick('Chưa có biến I/O có thể inspect.', 'No I/O variables available to inspect.')}</p>
            {/* Danh sách rỗng vì BỘ LỌC khác hẳn danh sách rỗng vì KHÔNG CÓ DỮ
              * LIỆU. Không nói ra điều kiện đang áp thì người dùng đi tìm biến
              * mình vừa khai trong một danh sách đã bị lọc mất. */}
            {filterSummary && <p className="mt-1">{pick(`Đang áp bộ lọc: ${filterSummary}. Xóa bớt bộ lọc để thấy thêm biến.`, `Active filters: ${filterSummary}. Clear some filters to see more variables.`)}</p>}
          </div>
        ) : rows.map((row) => {
          const selected = row.id === selectedId
          const qualityState = row.liveQuality.toLowerCase() as 'good' | 'uncertain' | 'bad' | 'stale' | 'offline' | 'unknown'
          const statusText = row.bindingStatus === 'UNMAPPED' ? pick('Chưa map', 'Unmapped') : row.bindingStatus === 'POINT_UNAVAILABLE' ? pick('Point không còn', 'Point unavailable') : row.bindingStatus === 'INCOMPATIBLE' ? pick('Không tương thích', 'Incompatible') : row.eligibility === 'UNSUPPORTED_BY_CORE' ? pick('Core chưa hỗ trợ', 'Unsupported by Core') : row.eligibility === 'UNSUPPORTED_DIRECTION' ? pick('Hướng chưa hỗ trợ', 'Unsupported direction') : pick('Đã map', 'Mapped')
          const [firstReason, ...restReasons] = row.compatibility.reasons
          return (
            <div key={row.id} className={`grid gap-2 border-l-4 p-3 transition hover:bg-[var(--c-surface-2)] ${ROW_GRID} ${selected ? 'border-l-[var(--c-accent)] bg-[var(--c-accent-bg)]' : 'border-l-transparent'}`}>
              <button type="button" aria-pressed={selected} aria-label={`${row.programName} · ${row.name} · ${statusText}`} onClick={() => onSelect(row.id)} className="min-w-0 rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]">
                <span className="flex items-center gap-2"><span className="font-semibold text-[var(--c-text)]">{row.name}</span>{row.bindingStatus === 'POINT_UNAVAILABLE' && <CircleAlert className="h-4 w-4 text-[var(--c-warn-fg)]" aria-label={pick('Point không còn', 'Point unavailable')} />}</span>
                {/* Program và định danh canonical là THỨ CẤP: giữ trên hàng để
                  * phân biệt hai biến trùng tên, nhưng nhỏ và có `title` thay
                  * vì chiếm một cột ngang hàng dữ liệu chính. */}
                <span className="mt-1 block truncate text-xs text-[var(--c-text-dim)]" title={row.point ? `${row.programName} · ${row.point.category}:${row.point.deviceId ? `${row.point.deviceId}:` : ''}${row.point.pointId}` : row.programName}>{row.programName}</span>
              </button>
              <span className="flex min-w-0 items-center text-xs"><CellLabel>{pick('Kiểu', 'Type')}</CellLabel><strong className="truncate text-[var(--c-text)]">{row.type}</strong></span>
              <span className="flex min-w-0 items-center gap-1 text-xs font-semibold text-[var(--c-text-dim)]"><CellLabel>{pick('Hướng', 'Direction')}</CellLabel>{row.direction === 'INPUT' ? <ArrowDownToLine className="h-3.5 w-3.5 shrink-0 text-[var(--c-accent)]" aria-hidden="true" /> : row.direction === 'OUTPUT' ? <ArrowUpFromLine className="h-3.5 w-3.5 shrink-0 text-[var(--c-good-fg)]" aria-hidden="true" /> : <LockKeyhole className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}{row.direction}</span>
              <span className="flex min-w-0 flex-col gap-1 text-xs">
                <span className="flex min-w-0 items-center"><CellLabel>{pick('Ánh xạ', 'Mapping')}</CellLabel><BindingStatusPill row={row} text={statusText} /></span>
                <span className="truncate text-[var(--c-text-dim)]" title={row.pointName ?? undefined}>{row.pointName ?? pick('Chưa có Point', 'No Point')}</span>
                {/* Hàng chỉ TÓM TẮT lý do, nhưng phải nói ra là còn lý do khác —
                  * im lặng ở đây là giấu blocker. Danh sách đầy đủ ở Inspector. */}
                {firstReason && (
                  <span className="truncate text-[var(--c-warn-fg)]">
                    {mappingReasonText(firstReason, pick)}
                    {restReasons.length > 0 && ` · ${pick(`+${restReasons.length} lý do nữa`, `+${restReasons.length} more`)}`}
                  </span>
                )}
              </span>
              <span className="flex min-w-0 items-center text-xs"><CellLabel>{pick('Giá trị', 'Live Value')}</CellLabel><strong className="truncate font-mono text-[var(--c-text)]">{formatMappingValue(row.liveValue, pick)}</strong></span>
              <span className="flex min-w-0 items-center"><CellLabel>Quality</CellLabel><StatusBadge state={qualityState} label={row.liveQuality} /></span>
              {/* `ISS-PGM03-05` — hành động chỉ ở hàng ĐANG CHỌN.
                *
                * Bản trước in "Mở nguồn" và một nút Map bị vô hiệu trên MỌI
                * hàng: người dùng bàn phím phải Tab qua hai control chết ở mỗi
                * biến, và một nút luôn `disabled` dạy người ta bỏ qua nút đó.
                * Nút Map vẫn nằm TRONG hàng (không gom lên toolbar) vì tiêu
                * điểm phải quay về đúng hàng sau khi ghi xong. */}
              <div className="flex flex-wrap items-center justify-end gap-1">
                {selected && (
                  <>
                    <Button size="sm" className="min-h-11" variant="ghost" icon={<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />} onClick={() => onOpenSource(row)}>{pick('Mở nguồn', 'Open source')}</Button>
                    {canMutate && <Button size="sm" className="min-h-11" variant="secondary" disabled={mutationDisabled || row.direction === 'INOUT'} icon={<Unlink className="h-3.5 w-3.5" aria-hidden="true" />} title={mutationDisabled ? pick('Cần Project, Point đã chọn và Point Catalog đầy đủ trước khi xem trước', 'A project, selected point, and complete Point Catalog are required before preview') : undefined} aria-label={`${pick(row.bindingId ? 'Đổi ánh xạ' : 'Ánh xạ', row.bindingId ? 'Change mapping' : 'Map')} ${row.programName} · ${row.name}`} onClick={() => onMap(row)}>{pick(row.bindingId ? 'Đổi' : 'Map', row.bindingId ? 'Change' : 'Map')}</Button>}
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
