import { useState } from 'react'
import { useI18n } from '../../../shared/i18n'
import { Modal } from '../../../shared/components/Modal'
import { Button } from '../../../shared/components/Button'
import {
  modeSwitchDecision,
  programsModeCapabilities,
  type ProgramsModeCapability,
} from '../shared/programsMode'
import type { ProgramsWorkspaceMode } from '../shared/programsRoute'

/**
 * `T59-807` — bộ chuyển chế độ của workspace Programs.
 *
 * Trước lát này, `?mode=` chỉ đổi được bằng cách **gõ tay vào URL**: giao diện
 * không hề nói workspace đang ở chế độ nào, cũng không nói hai chế độ kia tồn
 * tại. Người dùng gõ `mode=LIVE` thì nhận một trang trống có lý do — đúng,
 * nhưng phải biết mà gõ mới thấy.
 *
 * Nút cho chế độ chưa khả dụng vẫn HIỆN và vẫn bấm được, để nó trả lời được câu
 * hỏi "vì sao chưa có". Ẩn đi khiến người dùng tưởng thiết bị không làm được.
 */
export function ProgramsModeSwitcher({
  mode,
  draftDirty,
  onSwitch,
  capabilities,
}: {
  mode: ProgramsWorkspaceMode
  draftDirty: boolean
  onSwitch: (next: ProgramsWorkspaceMode) => void
  capabilities?: readonly ProgramsModeCapability[]
}) {
  const { pick } = useI18n()
  const resolved = capabilities ?? programsModeCapabilities(pick)
  const [unavailable, setUnavailable] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<ProgramsWorkspaceMode | null>(null)

  function request(next: ProgramsWorkspaceMode) {
    const decision = modeSwitchDecision({ from: mode, to: next, draftDirty, capabilities: resolved })
    if (decision.kind === 'SAME_MODE') return
    if (decision.kind === 'UNAVAILABLE') { setUnavailable(decision.reason); return }
    if (decision.kind === 'CONFIRM_DISCARD') { setConfirming(next); return }
    onSwitch(next)
  }

  return (
    <>
      <div role="group" aria-label={pick('Chế độ workspace', 'Workspace mode')} className="flex flex-wrap gap-1">
        {resolved.map((item) => (
          <button
            key={item.mode}
            type="button"
            aria-pressed={mode === item.mode}
            aria-disabled={!item.available}
            title={item.reason ?? undefined}
            className={`min-h-11 rounded border px-2 py-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)] ${
              mode === item.mode
                ? 'border-[var(--c-accent)] bg-[var(--c-accent-bg)] text-[var(--c-accent)]'
                : item.available
                  ? 'border-[var(--c-border)] text-[var(--c-text)]'
                  : 'border-dashed border-[var(--c-border)] text-[var(--c-text-dim)]'
            }`}
            onClick={() => request(item.mode)}
          >
            {item.mode}
          </button>
        ))}
      </div>

      {unavailable && (
        <Modal
          open
          title={pick('Chế độ chưa khả dụng', 'Mode not available yet')}
          onClose={() => setUnavailable(null)}
        >
          {/* Không tự hạ cấp về EDIT: người dùng phải biết yêu cầu của mình
            * KHÔNG được thực hiện, thay vì tưởng mình đang xem LIVE. */}
          <p className="text-sm text-[var(--c-text)]">{unavailable}</p>
          <div className="mt-3 flex justify-end">
            <Button size="sm" onClick={() => setUnavailable(null)}>{pick('Đã hiểu', 'Got it')}</Button>
          </div>

        </Modal>
      )}

      {confirming && (
        <Modal
          open
          title={pick('Draft còn thay đổi chưa lưu', 'The draft has unsaved changes')}
          danger
          cancelLabel={pick('Ở lại', 'Stay')}
          confirmLabel={pick('Bỏ thay đổi và đổi chế độ', 'Discard and switch')}
          onConfirm={() => { const next = confirming; setConfirming(null); onSwitch(next) }}
          onClose={() => setConfirming(null)}
        >
          <p className="text-sm text-[var(--c-text)]">
            {pick(
              'Đổi chế độ sẽ đổi nguồn tài liệu, nên phần đang gõ mà chưa lưu sẽ mất. Lưu trước, hoặc bỏ thay đổi để đi tiếp.',
              'Switching mode switches the document source, so unsaved edits are lost. Save first, or discard the changes to continue.',
            )}
          </p>
        </Modal>
      )}
    </>
  )
}
