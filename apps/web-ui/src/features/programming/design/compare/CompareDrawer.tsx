import { useEffect, useMemo, useRef, useState } from 'react'
import { GitCompare, X } from 'lucide-react'

import { useI18n } from '../../../../shared/i18n'
import { Button } from '../../../../shared/components/Button'
import type { ProgrammingRevisionChanges } from '../../model/types'
import {
  compareDiffStateFor,
  nonSourceChanges,
  type CompareEntry,
  type CompareGate,
} from './compareModel'

/**
 * `T59-819` / `PGM02-V22-WP-09` (phần còn nợ) — khay **So sánh Draft ↔ Active**
 * của workspace PGM-02.
 *
 * Khay này KHÔNG tự diff. Mọi hunk và mọi thay đổi topology đều do máy chủ tính
 * trên hai Revision bất biến; FE chỉ vẽ lại. Lý do: một bộ diff thứ hai ở FE sẽ
 * chạy trên buffer đang gõ chứ không phải trên thứ sắp được nạp xuống thiết bị,
 * và hai bộ diff sẽ nói khác nhau ở đúng lúc điều đó nguy hiểm nhất.
 *
 * Bốn luật hiển thị:
 *
 * 1. **Cặp Revision ID luôn hiện**, kể cả khi chưa so được. Người đọc phải biết
 *    mình đang đối chiếu cái gì với cái gì trước khi tin bảng bên dưới.
 * 2. **Bấm một hunk chỉ mở nó ở phía chỉ-đọc trong khay.** Nó KHÔNG đổi POU
 *    đang mở trong editor. Muốn nhảy sang editor thì phải bấm nút riêng, có
 *    nhãn — một cú nhảy ngầm sẽ vứt mất chỗ người dùng đang gõ dở.
 * 3. **Màu không bao giờ là tín hiệu duy nhất**: mọi loại thay đổi đều có nhãn
 *    chữ đi kèm.
 * 4. **Danh sách bị cắt thì nói ra.** Một danh sách cắt im lặng trông y hệt một
 *    danh sách đầy đủ.
 */
export function CompareDrawer({
  gate,
  changes,
  pouNameByObjectId,
  loading,
  errorMessage,
  sealing,
  sealingErrorMessage,
  canSeal,
  loadingMore,
  loadMoreErrorMessage,
  onSeal,
  onLoadMore,
  onClose,
  onRevealInEditor,
}: {
  gate: CompareGate
  changes: ProgrammingRevisionChanges | null
  pouNameByObjectId: ReadonlyMap<string, string>
  loading: boolean
  errorMessage: string | null
  sealing: boolean
  sealingErrorMessage: string | null
  canSeal: boolean
  loadingMore: boolean
  /** Lỗi khi đọc TRANG TIẾP. Tách khỏi `errorMessage` vì phần đã tải vẫn đúng
   * và phải tiếp tục hiện — kèm đường thử lại. */
  loadMoreErrorMessage: string | null
  onSeal: () => void
  onLoadMore: (cursor: string) => void
  onClose: () => void
  /** Chỉ được gọi từ một nút CÓ NHÃN, không bao giờ từ cú bấm vào hunk. */
  onRevealInEditor?: (entry: CompareEntry) => void
}) {
  const { pick } = useI18n()
  const drawerRef = useRef<HTMLElement>(null)
  const tupleKey = gate.kind === 'READY' ? `${gate.fromRevisionId}\u0000${gate.toRevisionId}` : gate.kind
  const [selection, setSelection] = useState<{ tupleKey: string; entryId: string } | null>(null)
  const tupleMismatch = gate.kind === 'READY' && changes !== null && (
    changes.fromRevisionId !== gate.fromRevisionId || changes.toRevisionId !== gate.toRevisionId
  )
  const trustedChanges = gate.kind === 'READY' && !tupleMismatch ? changes : null
  const trustedError = tupleMismatch
    ? pick(
        'Phản hồi bảng khác biệt không khớp cặp Revision đang hiển thị; dữ liệu đã bị từ chối.',
        'The difference response does not match the displayed revision pair; the data was rejected.',
      )
    : errorMessage

  const diff = useMemo(
    () => (trustedChanges ? compareDiffStateFor(trustedChanges, pouNameByObjectId) : null),
    [pouNameByObjectId, trustedChanges],
  )
  const selected = diff?.kind === 'ENTRIES'
    ? diff.entries.find((entry) => selection?.tupleKey === tupleKey && entry.entryId === selection.entryId) ?? null
    : null

  useEffect(() => {
    drawerRef.current?.focus()
  }, [])

  return (
    <section
      ref={drawerRef}
      role="dialog"
      tabIndex={-1}
      aria-label={pick('So sánh với bản đang vận hành', 'Compare with the running revision')}
      data-testid="compare-drawer"
      data-gate={gate.kind}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
      className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface)] p-3"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--c-text)]">
          <GitCompare className="h-4 w-4" aria-hidden="true" />
          {pick('So sánh với bản đang vận hành', 'Compare with the running revision')}
        </h2>
        <Button size="sm" variant="ghost" icon={<X className="h-4 w-4" aria-hidden="true" />} onClick={onClose}>
          {pick('Đóng', 'Close')}
        </Button>
      </header>

      {/* Cặp ID luôn hiện — kể cả khi chưa so được. `—` là "chưa có", không phải
          một ID rút gọn hay một chỗ trống. */}
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs" data-testid="compare-revision-pair">
        <dt className="text-[var(--c-text-dim)]">{pick('Bản đang vận hành', 'Active revision')}</dt>
        <dd className="break-all font-mono text-[11px] text-[var(--c-text)]">{gate.fromRevisionId ?? '—'}</dd>
        <dt className="text-[var(--c-text-dim)]">{pick('Bản ứng viên đã niêm phong', 'Sealed candidate revision')}</dt>
        <dd className="break-all font-mono text-[11px] text-[var(--c-text)]">{gate.toRevisionId ?? '—'}</dd>
      </dl>

      <div className="mt-3">
        {gate.kind === 'NO_ACTIVE' && (
          <GateNotice
            testId="compare-no-active"
            title={pick('Chưa có bản đang vận hành để đối chiếu.',
                        'There is no running revision to compare against.')}
            body={pick('Thiết bị chưa từng nạp Revision nào, nên không có mốc để so. Đây KHÁC với "không có khác biệt": chưa có gì để đối chiếu cả. Lần Commission đầu tiên sẽ nạp toàn bộ nội dung hiện tại.',
                       'The controller has never been commissioned, so there is no baseline. That is NOT the same as "no differences": there is simply nothing to compare against yet. The first commission will load the entire current content.')}
          />
        )}

        {gate.kind === 'MUST_SAVE' && (
          <GateNotice
            testId="compare-must-save"
            title={pick('Bản nháp còn thay đổi chưa lưu.', 'The draft has unsaved changes.')}
            body={pick('So sánh chỉ chạy trên hai Revision bất biến. Hãy Lưu, rồi Niêm phong bản nháp trước khi so — nếu không, bảng khác biệt sẽ nói về một nội dung không còn tồn tại.',
                       'Compare only runs between two immutable revisions. Save, then seal the draft first — otherwise the difference table describes content that no longer exists.')}
          />
        )}

        {gate.kind === 'MUST_SEAL' && (
          <div data-testid="compare-must-seal">
            <GateNotice
              title={pick('Bản nháp đã lưu nhưng chưa niêm phong.', 'The draft is saved but not sealed.')}
              body={pick('Bản nháp là bản ghi sống — nó đổi mỗi lần có người gõ. Niêm phong tạo một Revision bất biến để đối chiếu; đó là bản sẽ được đem đi Kiểm tra và Commission.',
                         'A draft is a live record — it changes whenever someone types. Sealing creates an immutable revision to compare against; that is the revision that goes on to Check and Commission.')}
            />
            <Button size="sm" className="mt-2" disabled={sealing || !canSeal} onClick={onSeal}>
              {sealing ? pick('Đang niêm phong…', 'Sealing…') : pick('Niêm phong để so sánh', 'Seal to compare')}
            </Button>
            {!canSeal && (
              <p className="mt-2 text-xs text-[var(--c-text-dim)]">
                {pick('Chỉ quản trị viên ở chế độ EDIT được niêm phong Revision.', 'Only an administrator in EDIT mode can seal a revision.')}
              </p>
            )}
            {sealingErrorMessage && (
              <p role="alert" className="mt-2 text-sm text-[var(--c-fault-fg)]" data-testid="compare-seal-error">
                {sealingErrorMessage}
              </p>
            )}
          </div>
        )}

        {gate.kind === 'SAME_REVISION' && (
          <GateNotice
            testId="compare-same-revision"
            title={pick('Bản ứng viên chính là bản đang vận hành.', 'The candidate is the running revision.')}
            body={pick(
              'Hai Revision ID giống nhau nên không cần gọi dịch vụ so sánh: không có bản ứng viên mới để đối chiếu.',
              'The two revision IDs are identical, so no comparison request is needed: there is no new candidate to compare.',
            )}
          />
        )}

        {gate.kind === 'READY' && (
          <>
            {loading && <p className="text-sm text-[var(--c-text-dim)]">{pick('Đang tải bảng khác biệt…', 'Loading the difference table…')}</p>}
            {trustedError && (
              <p role="alert" className="text-sm text-[var(--c-fault-fg)]" data-testid="compare-error">{trustedError}</p>
            )}
            {!loading && !trustedError && diff && (
              <CompareBody
                diff={diff}
                changes={trustedChanges}
                selected={selected}
                loadingMore={loadingMore}
                loadMoreErrorMessage={loadMoreErrorMessage}
                onSelectEntry={(entryId) => setSelection({ tupleKey, entryId })}
                onLoadMore={onLoadMore}
                onRevealInEditor={onRevealInEditor}
              />
            )}
          </>
        )}
      </div>
    </section>
  )
}

function GateNotice({ title, body, testId }: { title: string; body: string; testId?: string }) {
  return (
    <div
      role="status"
      data-testid={testId}
      className="rounded-[var(--radius)] border border-dashed border-[var(--c-border)] p-3 text-sm"
    >
      <p className="font-semibold text-[var(--c-text)]">{title}</p>
      <p className="mt-1 text-[var(--c-text-dim)]">{body}</p>
    </div>
  )
}

function CompareBody({
  diff,
  changes,
  selected,
  loadingMore,
  loadMoreErrorMessage,
  onSelectEntry,
  onLoadMore,
  onRevealInEditor,
}: {
  diff: NonNullable<ReturnType<typeof compareDiffStateFor>>
  changes: ProgrammingRevisionChanges | null
  selected: CompareEntry | null
  loadingMore: boolean
  loadMoreErrorMessage: string | null
  onSelectEntry: (entryId: string) => void
  onLoadMore: (cursor: string) => void
  onRevealInEditor?: (entry: CompareEntry) => void
}) {
  const { pick } = useI18n()
  const others = changes ? nonSourceChanges(changes) : []

  if (diff.kind === 'UNSUPPORTED') {
    return (
      <GateNotice
        testId="compare-unsupported"
        title={pick('Máy chủ chưa trả bảng khác biệt chi tiết.', 'The server did not return a detailed difference table.')}
        body={pick('Không đọc được nghĩa là CHƯA SO, không phải "không có khác biệt". Hãy cập nhật phần mềm thiết bị trước khi dựa vào màn này để quyết định Commission.',
                   'Not readable means NOT COMPARED — it does not mean "no differences". Update the device software before relying on this view to decide a commission.')}
      />
    )
  }

  return (
    <div className="space-y-3">
      {diff.kind === 'EMPTY' ? (
        <p className="text-sm text-[var(--c-text)]" data-testid="compare-empty">
          {pick('Không có khác biệt nào ở mã nguồn hay sơ đồ giữa hai Revision.',
                'No source or diagram differences between the two revisions.')}
        </p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <ul className="max-h-72 overflow-y-auto rounded-[var(--radius)] border border-[var(--c-border)] divide-y divide-[var(--c-border)]"
              data-testid="compare-entry-list">
            {diff.entries.map((entry) => (
              <li key={entry.entryId}>
                <button
                  type="button"
                  data-testid="compare-entry"
                  data-entry-id={entry.entryId}
                  aria-current={selected?.entryId === entry.entryId}
                  /* Bấm ở đây CHỈ mở mục đó ở phía chỉ-đọc bên phải. Nó không
                     chạm vào POU đang mở trong editor. */
                  onClick={() => onSelectEntry(entry.entryId)}
                  className={`w-full px-2 py-1.5 text-left text-xs hover:bg-[var(--c-surface-2)] focus-visible:bg-[var(--c-surface-2)] ${
                    selected?.entryId === entry.entryId ? 'bg-[var(--c-surface-2)]' : ''
                  }`}
                >
                  <span className="block text-[var(--c-text-dim)]">
                    {entry.pouName ?? (
                      <span className="font-mono">{entry.objectId}</span>
                    )}
                    {entry.pouName === null && (
                      <span className="ml-1 italic">{pick('(chưa tra được tên)', '(name not resolved)')}</span>
                    )}
                  </span>
                  <span className="block text-[var(--c-text)]">{entryLabel(pick, entry)}</span>
                </button>
              </li>
            ))}
          </ul>

          <div
            className="rounded-[var(--radius)] border border-[var(--c-border)] p-2"
            data-testid="compare-detail"
            aria-live="polite"
          >
            {selected === null ? (
              <p className="text-xs text-[var(--c-text-dim)]">
                {pick('Chọn một mục bên trái để xem chi tiết chỉ-đọc.', 'Pick an item on the left to see the read-only detail.')}
              </p>
            ) : (
              <CompareDetail entry={selected} onRevealInEditor={onRevealInEditor} />
            )}
          </div>
        </div>
      )}

      {diff.kind === 'ENTRIES' && diff.truncated && (
        <div role="status" data-testid="compare-truncated" className="text-xs text-[var(--c-warn-fg)]">
          {pick('Danh sách đã chạm trần và bị cắt — đây CHƯA phải toàn bộ khác biệt.',
                'The list hit its cap and was cut — this is NOT the full set of differences.')}
          {diff.nextCursor && (
            <Button size="sm" variant="ghost" className="ml-2" disabled={loadingMore} onClick={() => onLoadMore(diff.nextCursor as string)}>
              {loadingMore
                ? pick('Đang tải tiếp…', 'Loading more…')
                : loadMoreErrorMessage ? pick('Thử lại', 'Retry') : pick('Xem tiếp', 'Load more')}
            </Button>
          )}
        </div>
      )}

      {/* Lỗi đọc trang tiếp KHÔNG xoá phần đã tải: phần đó vẫn đúng, và xoá nó
          sẽ mang theo luôn nút thử lại. */}
      {loadMoreErrorMessage && (
        <p role="alert" className="text-xs text-[var(--c-fault-fg)]" data-testid="compare-load-more-error">
          {loadMoreErrorMessage}
        </p>
      )}

      {others.length > 0 && (
        <div data-testid="compare-non-source">
          <p className="text-xs font-semibold text-[var(--c-text-dim)]">
            {pick('Thay đổi cấp Revision hoặc ngoài đoạn diff', 'Revision-level or non-diff changes')}
          </p>
          {/* Một Revision chỉ đổi ánh xạ đầu ra có `stHunks` rỗng. Nếu khối này
              không tồn tại, màn So sánh sẽ nói "không có khác biệt" về đúng thứ
              sẽ ghi ra thiết bị. */}
          <ul className="mt-1 space-y-0.5 text-xs">
            {others.map((change) => (
              <li key={`${change.kind}-${change.objectId}`} className="text-[var(--c-text)]">
                <span className="font-mono text-[11px] text-[var(--c-text-dim)]">{change.objectId}</span>{' '}
                · {change.kind} · {change.changeType} · {change.category}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function CompareDetail({
  entry,
  onRevealInEditor,
}: {
  entry: CompareEntry
  onRevealInEditor?: (entry: CompareEntry) => void
}) {
  const { pick } = useI18n()
  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-[var(--c-text-dim)]">{entryLabel(pick, entry)}</p>
        {onRevealInEditor && (entry.kind === 'ST' || entry.change.elementId !== '') && (
          /* Cú nhảy sang editor luôn phải là một hành động CÓ NHÃN do người
             dùng chọn: nhảy ngầm sẽ vứt mất chỗ họ đang gõ dở. */
          <Button size="sm" variant="ghost" onClick={() => onRevealInEditor(entry)}>
            {pick('Mở POU này trong trình soạn', 'Open this POU in the editor')}
          </Button>
        )}
      </div>

      {entry.kind === 'ST' ? (
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <ReadOnlySide
            testId="compare-detail-before"
            title={pick('Bản đang vận hành', 'Active')}
            startLine={entry.hunk.beforeStartLine}
            lineCount={entry.hunk.beforeLineCount}
            lines={entry.hunk.beforeText}
          />
          <ReadOnlySide
            testId="compare-detail-after"
            title={pick('Bản ứng viên', 'Candidate')}
            startLine={entry.hunk.afterStartLine}
            lineCount={entry.hunk.afterLineCount}
            lines={entry.hunk.afterText}
          />
          {entry.hunk.truncated && (
            <p className="md:col-span-2 text-xs text-[var(--c-warn-fg)]">
              {pick('Thân đoạn này đã bị cắt bớt; số dòng ở trên là số THẬT.',
                    'This hunk body was truncated; the line counts above are the real ones.')}
            </p>
          )}
          {entry.hunk.coarse && (
            <p className="md:col-span-2 text-xs text-[var(--c-warn-fg)]">
              {pick('Tệp quá lớn để so từng dòng — đây là kết luận thô "cả tệp đã đổi", không phải khác biệt chi tiết.',
                    'The file is too large for a line-level diff — this is the coarse conclusion "the whole file changed", not a detailed difference.')}
            </p>
          )}
        </div>
      ) : (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <dt className="text-[var(--c-text-dim)]">{pick('Thành phần', 'Element')}</dt>
          <dd className="text-[var(--c-text)]">{entry.change.element}</dd>
          <dt className="text-[var(--c-text-dim)]">{pick('Mã thành phần', 'Element id')}</dt>
          <dd className="font-mono text-[11px] text-[var(--c-text)]">{entry.change.elementId || '—'}</dd>
          <dt className="text-[var(--c-text-dim)]">{pick('Thuộc tính', 'Detail')}</dt>
          <dd className="text-[var(--c-text)]">{entry.change.detail || '—'}</dd>
        </dl>
      )}
    </div>
  )
}

function ReadOnlySide({
  title, startLine, lineCount, lines, testId,
}: { title: string; startLine: number; lineCount: number; lines: string[]; testId: string }) {
  const { pick } = useI18n()
  return (
    <div data-testid={testId}>
      <p className="text-[11px] uppercase text-[var(--c-text-dim)]">
        {title} · {pick(`dòng ${startLine}`, `line ${startLine}`)} · {pick(`${lineCount} dòng`, `${lineCount} lines`)}
      </p>
      {lines.length === 0 ? (
        <p className="mt-1 text-xs italic text-[var(--c-text-dim)]">{pick('(không có dòng nào ở phía này)', '(no lines on this side)')}</p>
      ) : (
        <pre className="mt-1 overflow-x-auto rounded-[var(--radius)] bg-[var(--c-surface-2)] p-2 font-mono text-[11px] text-[var(--c-text)]">
          {lines.join('\n')}
        </pre>
      )}
    </div>
  )
}

function entryLabel(pick: (vi: string, en: string) => string, entry: CompareEntry): string {
  if (entry.kind === 'ST') {
    const where = pick(`dòng ${entry.hunk.afterStartLine}`, `line ${entry.hunk.afterStartLine}`)
    switch (entry.hunk.changeType) {
      case 'ADDED': return `${pick('Thêm mã', 'Added source')} · ${where}`
      case 'REMOVED': return `${pick('Xoá mã', 'Removed source')} · ${pick(`dòng ${entry.hunk.beforeStartLine}`, `line ${entry.hunk.beforeStartLine}`)}`
      default: return `${pick('Sửa mã', 'Changed source')} · ${where}`
    }
  }
  const element = entry.change.element === 'NETWORK'
    ? pick('network', 'network')
    : entry.change.element === 'NODE'
      ? pick('khối', 'block')
      : entry.change.element === 'PORT' ? pick('cổng', 'port') : pick('dây nối', 'wire')
  switch (entry.change.changeType) {
    case 'ADDED': return `${pick('Thêm', 'Added')} ${element}`
    case 'REMOVED': return `${pick('Xoá', 'Removed')} ${element}`
    // Hai loại dưới CÓ NHÃN RIÊNG: gộp chúng vào "đã sửa" sẽ làm người đọc mất
    // khả năng phân biệt thứ cần soi kỹ với thứ chỉ cần liếc.
    case 'ORDER_ONLY': return `${pick('Đổi thứ tự thực thi', 'Execution order changed')} · ${element}`
    case 'GEOMETRY_ONLY': return pick('Chỉ đổi vị trí trên sơ đồ (không đổi hành vi)', 'Diagram position only (no behaviour change)')
    default: return `${pick('Sửa', 'Changed')} ${element} · ${entry.change.detail}`
  }
}
