import { useI18n } from '../../../shared/i18n'
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
