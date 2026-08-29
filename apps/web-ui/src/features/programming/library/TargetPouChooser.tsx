import { useState } from 'react'
import { Modal } from '../../../shared/components/Modal'
import { StateBlock } from '../../../shared/components/StateBlock'
import { useI18n } from '../../../shared/i18n'
import { insertTargetCandidates, type InsertTargetCandidate } from './libraryPresentation'
import type { DraftPouObject } from '../model/signals'
import type { LibraryEntryGroup } from '../model/library'

/**
 * `T61-405`/`T61-406` — chọn POU đích cho Chèn, và ZERO MUTATION ở phía này.
 *
 * `AC-PGM04-06` nói Chèn độc lập phải đòi ngữ cảnh đích tường minh, và handoff
 * §4 nói thẳng điều màn hình này KHÔNG được làm: "Do not silently create a POU
 * or mutate draft". Nên PGM-04 không ghi gì vào Draft. Nó đưa người dùng tới
 * đúng POU trong PGM-02 — nơi có bộ soạn thảo, có kiểm tra kiểu và có Undo.
 *
 * Đó không phải cách làm tắt. Một phép chèn thực hiện từ đây sẽ là một lần ghi
 * Draft KHÔNG có Undo trong tầm mắt người dùng, vì màn hình đang mở không phải
 * bộ soạn thảo; muốn lùi lại họ phải đi tìm chỗ khác. Một lần ghi mà chỗ hoàn
 * tác nằm ở màn hình khác là một lần ghi người ta sẽ không dám thực hiện.
 */
export function TargetPouChooser({
  group,
  objects,
  draftReadable,
  draftSupported,
  onCancel,
  onChoose,
}: {
  group: LibraryEntryGroup | null
  objects: DraftPouObject[]
  /** `false` = chưa đọc được Draft. KHÁC "Draft không có POU nào". */
  draftReadable: boolean
  /** `false` = Draft còn ở schema v1, nơi POU chưa là công dân hạng nhất.
   *  KHÁC "Draft không có POU nào": bản v1 có thể đang có đủ chương trình, chỉ
   *  là danh sách `objects` chưa tồn tại để đọc. Nói "chưa có POU nào" ở đây sẽ
   *  mời người dùng đi tạo lại thứ họ đang có. */
  draftSupported: boolean
  onCancel: () => void
  onChoose: (candidate: InsertTargetCandidate) => void
}) {
  const { pick } = useI18n()
  const [selected, setSelected] = useState<string | null>(null)
  if (!group) return null

  const candidates = insertTargetCandidates(objects, group.current)
  const chosen = candidates.find((item) => item.objectId === selected && item.block === null) ?? null

  return (
    <Modal
      open
      size="lg"
      mobileFullscreen
      title={pick('Chèn khối vào POU nào?', 'Insert the block into which POU?')}
      confirmLabel={pick('Mở POU và chèn', 'Open the POU and insert')}
      cancelLabel={pick('Huỷ', 'Cancel')}
      confirmDisabled={chosen === null}
      onConfirm={() => {
        if (chosen) onChoose(chosen)
      }}
      onClose={onCancel}
    >
      <div className="flex flex-col gap-3 text-[var(--c-text)]">
        <p className="text-sm text-[var(--c-text-dim)]">
          {pick(
            `Khối “${group.name}” sẽ được mở sẵn trong bộ soạn thảo của POU bạn chọn. Thư viện không tự ghi vào bản nháp — phép chèn xảy ra trong bộ soạn thảo, nơi có Hoàn tác.`,
            `Block “${group.name}” will be opened in the editor of the POU you choose. The library never writes to the draft itself — the insert happens in the editor, where Undo exists.`
          )}
        </p>

        {!draftReadable ? (
          <StateBlock
            state="error"
            title={pick('Chưa đọc được bản nháp nên chưa liệt kê được POU đích.',
                        'The draft could not be read, so target POUs cannot be listed.')}
          />
        ) : !draftSupported ? (
          <StateBlock
            state="empty"
            title={pick('Bản nháp chưa ở schema v2 nên chưa liệt kê được POU đích.',
                        'The draft is not on schema v2 yet, so target POUs cannot be listed.')}
            detail={pick('Lưu bất kỳ thay đổi nào ở trang Chương trình sẽ nâng bản nháp lên v2.',
                         'Saving any change on the Programs page upgrades the draft to v2.')}
          />
        ) : candidates.length === 0 ? (
          <StateBlock
            state="empty"
            title={pick('Bản nháp chưa có POU nào để chèn vào.', 'The draft has no POU to insert into yet.')}
            detail={pick('Tạo một POU ở trang Chương trình trước.', 'Create a POU on the Programs page first.')}
          />
        ) : (
          <ul className="flex flex-col gap-1" aria-label={pick('POU đích', 'Target POUs')}>
            {candidates.map((candidate) => {
              const blocked = candidate.block !== null
              const reasonId = `insert-target-reason-${candidate.objectId}`
              return (
                <li key={candidate.objectId}>
                  <label
                    className={`flex items-start gap-2 rounded border p-2 text-sm ${
                      blocked
                        ? 'border-[var(--c-border)] opacity-60'
                        : selected === candidate.objectId
                          ? 'border-[var(--c-accent)] bg-[var(--c-accent-bg)]'
                          : 'border-[var(--c-border)]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="insert-target"
                      className="mt-1"
                      value={candidate.objectId}
                      checked={selected === candidate.objectId}
                      disabled={blocked}
                      aria-describedby={blocked ? reasonId : undefined}
                      onChange={() => setSelected(candidate.objectId)}
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="font-medium">{candidate.name}</span>
                      <span className="text-xs text-[var(--c-text-dim)]">
                        {candidate.kind} · {candidate.language}
                        {candidate.alreadyDepends && pick(' · đã dùng khối này', ' · already uses this block')}
                      </span>
                      {blocked && (
                        <span id={reasonId} className="text-xs text-[var(--c-warn-fg)]">
                          {candidate.block === 'SELF'
                            ? pick('Không chèn được: đây chính là khối đang chọn.',
                                   'Cannot insert: this is the selected block itself.')
                            : pick('Không chèn được: khối đang phụ thuộc POU này, chèn ngược lại là một vòng lặp.',
                                   'Cannot insert: the block already depends on this POU, so this would be a cycle.')}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Modal>
  )
}
