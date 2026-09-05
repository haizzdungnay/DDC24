import { useI18n } from '../../../shared/i18n'
import { Button } from '../../../shared/components/Button'
import type { LibraryUnknownOutcome } from '../api/mutations'
import type { LibraryMutationBlock } from '../model/library'
import type { ProgrammingLibraryEntry } from '../model/types'

/**
 * `T61-301` — hai băng thông báo của đường ghi, tách khỏi controller.
 *
 * `ReadBackNotice` là chỗ luật "không xác nhận lạc quan" sống: màn hình chỉ nói
 * "đã lưu" SAU khi đọc lại được đúng thứ vừa ghi từ máy chủ. Một dấu tích hiện
 * ngay lúc bấm là một lời hứa mà FE không có cơ sở để hứa.
 */
export interface ReadBack {
  entryId: string
  action: 'save' | 'delete' | 'deprecate'
  state: 'reading' | 'done'
  libraryRevisionId?: string
  libraryVersion?: string
}

/**
 * `T61-402` / `ISS-PGM04-12` — băng "KHÔNG RÕ KẾT QUẢ".
 *
 * Đây là băng khó nhất của màn hình này, vì nó phải nói một sự thật khó chịu:
 * lần ghi có thể đã thành công, có thể chưa, và màn hình chưa biết. Hai câu mà
 * nó KHÔNG được nói:
 *
 *  - "Đã lưu" — không có cơ sở, và người dùng sẽ bỏ đi với một thay đổi không
 *    tồn tại;
 *  - "Không lưu được" — cũng không có cơ sở, và người dùng sẽ bấm lại một thao
 *    tác có thể đã chạy rồi.
 *
 * Vì vậy chỉ có hai lối ra, và cả hai đều tường minh: ĐỌC LẠI (không ghi gì), và
 * GỬI LẠI đúng lần ghi cũ (cùng khoá idempotency, cùng `If-Match`) — nên máy chủ
 * replay biên nhận thay vì ghi thêm.
 */
export function MutationUnknownNotice({
  outcome,
  reconciling,
  onRecheck,
  onRetry,
}: {
  outcome: LibraryUnknownOutcome
  reconciling: { attempt: number; of: number } | null
  onRecheck: () => void
  onRetry: () => void
}) {
  const { pick } = useI18n()
  const cause: Record<LibraryUnknownOutcome['reason'], string> = {
    timeout: pick('máy chủ không trả lời kịp', 'the server did not answer in time'),
    abort: pick('yêu cầu bị huỷ giữa chừng', 'the request was cancelled midway'),
    network: pick('mất kết nối tới máy chủ', 'the connection to the server was lost'),
  }
  return (
    <div
      role="alert"
      data-testid="library-mutation-unknown"
      className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-3 text-sm text-[var(--c-warn-fg)]"
    >
      <p>
        <strong>{pick('Chưa rõ kết quả.', 'The outcome is not known.')}</strong>{' '}
        {pick(
          `Thao tác đã được gửi đi nhưng ${cause[outcome.reason]}, nên chưa biết máy chủ đã ghi hay chưa. Không bấm lại một cách mù: hãy đọc lại từ máy chủ.`,
          `The operation was sent but ${cause[outcome.reason]}, so it is unknown whether the server wrote it. Do not blindly retry: read back from the server.`
        )}
      </p>
      {reconciling && (
        <p data-testid="library-mutation-reconciling" className="mt-1 text-xs">
          {pick('Đang đọc lại từ máy chủ…', 'Reading back from the server…')}{' '}
          {reconciling.of > 0 && `${reconciling.attempt}/${reconciling.of}`}
        </p>
      )}
      {!reconciling && outcome.attempts > 0 && (
        <p data-testid="library-mutation-unresolved" className="mt-1 text-xs">
          {pick(
            `Đã đọc lại ${outcome.attempts} lượt mà vẫn chưa xác nhận được. Tải lại trang để xem trạng thái hiện tại, hoặc gửi lại đúng thao tác cũ.`,
            `Read back ${outcome.attempts} times without confirmation. Reload the page to see the current state, or resend the same operation.`
          )}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="secondary" disabled={Boolean(reconciling)} onClick={onRecheck}>
          {pick('Đọc lại từ máy chủ', 'Read back from the server')}
        </Button>
        {/* Nút này KHÔNG sinh khoá idempotency mới: nó gửi lại nguyên vẹn lần ghi
            cũ, nên máy chủ nhận ra là cùng một ý định và replay biên nhận. */}
        <Button variant="secondary" disabled={Boolean(reconciling)} onClick={onRetry}>
          {pick('Gửi lại đúng thao tác cũ', 'Resend the same operation')}
        </Button>
      </div>
    </div>
  )
}

export function MutationBlockNotice({ block }: { block: LibraryMutationBlock }) {
  const { pick } = useI18n()
  const message: Record<LibraryMutationBlock, string> = {
    SYSTEM_IMMUTABLE: pick(
      'Khối SYSTEM thuộc registry chỉ đọc — máy chủ từ chối mọi thao tác sửa hoặc xoá lên nó.',
      'SYSTEM blocks belong to the read-only registry — the server rejects every edit or delete on them.'
    ),
    NEEDS_PERMISSION: pick(
      'Thao tác này cần quyền quản trị.',
      'This action requires an administrator role.'
    ),
    NO_PROJECT: pick(
      'Chưa xác định được Project nên không có bản nháp thư viện để ghi.',
      'No project is resolved, so there is no library draft to write to.'
    ),
    PUBLISHED_IMMUTABLE: pick(
      'Phiên bản đã phát hành là bất biến — chỉ khối trong bản nháp mới xoá được. Hãy sửa để tạo phiên bản mới.',
      'A published version is immutable — only blocks in the draft can be deleted. Edit it to create a new version.'
    ),
    DEPRECATE_REQUIRES_PUBLISHED: pick(
      'Chỉ phiên bản PROJECT Library ở trạng thái PUBLISHED mới có thể chuyển sang DEPRECATED.',
      'Only a PUBLISHED PROJECT Library version can transition to DEPRECATED.'
    ),
    DEPENDED_ON: pick(
      'Khối khác trong cùng phiên bản thư viện đang phụ thuộc khối này; gỡ phụ thuộc trước khi xoá.',
      'Another block in the same library version depends on this one; remove the dependency before deleting.'
    )
  }
  return (
    <p role="alert" className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-3 text-sm text-[var(--c-warn-fg)]">
      {message[block]}
    </p>
  )
}


export function ReadBackNotice({ readBack, entries }: { readBack: ReadBack; entries: ProgrammingLibraryEntry[] }) {
  const { pick } = useI18n()
  if (readBack.state === 'reading') {
    return (
      <p role="status" className="rounded-[var(--radius)] border border-[var(--c-border)] p-3 text-sm text-[var(--c-text-dim)]">
        {pick('Đang đọc lại từ máy chủ…', 'Reading back from the server…')}
      </p>
    )
  }
  const stored = entries.filter((entry) => entry.entryId === readBack.entryId)
  if (readBack.action === 'deprecate') {
    const revisionEntries = entries.filter((entry) => entry.libraryRevisionId === readBack.libraryRevisionId)
    const confirmed = revisionEntries.length > 0 && revisionEntries.every((entry) => entry.libraryState === 'DEPRECATED')
    return confirmed ? (
      <p role="status" className="rounded-[var(--radius)] border border-[var(--c-border)] p-3 text-sm">
        {pick('Máy chủ xác nhận phiên bản thư viện', 'The server confirms library version')}{' '}
        <strong>{readBack.libraryVersion ?? revisionEntries[0].libraryVersion}</strong> · DEPRECATED
      </p>
    ) : (
      <p role="alert" className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-3 text-sm text-[var(--c-warn-fg)]">
        {pick(
          'Máy chủ chưa trả lại phiên bản ở trạng thái DEPRECATED — không hiển thị xác nhận lạc quan.',
          'The server has not returned the version in DEPRECATED state — no optimistic confirmation is shown.'
        )}
      </p>
    )
  }
  if (readBack.action === 'delete') {
    const remaining = stored.filter((entry) => entry.libraryState === 'DRAFT')
    return (
      <p role="status" className="rounded-[var(--radius)] border border-[var(--c-border)] p-3 text-sm">
        {remaining.length === 0
          ? pick('Máy chủ xác nhận đã xoá khối khỏi bản nháp thư viện.', 'The server confirms the block was removed from the library draft.')
          : pick('Máy chủ vẫn còn khối này trong bản nháp — hãy tải lại và kiểm tra.', 'The server still lists this block in the draft — reload and check.')}
      </p>
    )
  }
  const draft = stored.find((entry) => entry.libraryState === 'DRAFT') ?? stored[0]
  if (!draft) {
    return (
      <p role="alert" className="rounded-[var(--radius)] border border-[var(--c-warn)] bg-[var(--c-warn-bg)] p-3 text-sm text-[var(--c-warn-fg)]">
        {pick(
          'Đã lưu nhưng máy chủ không trả về khối vừa ghi — không hiển thị giá trị lạc quan.',
          'Saved, but the server did not return the block that was written — no optimistic value is shown.'
        )}
      </p>
    )
  }
  return (
    <p role="status" className="rounded-[var(--radius)] border border-[var(--c-border)] p-3 text-sm">
      {pick('Máy chủ đã trả lại khối', 'The server returned the block')}{' '}
      <strong>{draft.name}</strong> · {draft.libraryVersion} · {draft.libraryState} ·{' '}
      <span className="font-mono text-xs">{draft.contentSha256.slice(0, 16)}…</span>
    </p>
  )
}
