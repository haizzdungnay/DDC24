import { useMemo, useState } from 'react'
import { useI18n } from '../../../shared/i18n'
import { FbdCanvas } from '../fbd/FbdCanvas'
import type { FbdEditorAction, FbdSelection } from '../fbd/commands'
import type { FbdDocument } from '../fbd/model'

/**
 * `T59-811` / `AC-FBD-009`..`AC-FBD-011` — sơ đồ FBD của gói ĐANG CHẠY.
 *
 * Ba luật, và cả ba đều là hệ quả của một câu: đây là **cửa sổ đọc**, không phải
 * editor.
 *
 * 1. Vẽ **chỉ** canvas, không mount cả `StructuredFbdEditor`. Editor mang theo
 *    palette, toolbar và bộ lệnh sửa; tắt từng thứ một là một danh sách phải nhớ
 *    giữ đúng mãi mãi, còn không mount chúng thì không có gì để quên.
 * 2. Topology đến từ tài liệu Active **truyền vào**, không phải từ Draft. Component
 *    này không biết Draft tồn tại.
 * 3. Giá trị runtime làm mới KHÔNG chạm topology (`AC-FBD-011`). Ở đây điều đó là
 *    bất biến **cấu trúc**: tài liệu là prop, còn thứ duy nhất component tự giữ là
 *    lựa chọn đang xem.
 */
export function LiveFbdView({ document }: { document: FbdDocument }) {
  const { pick } = useI18n()
  /* Trạng thái DUY NHẤT của khay này: người dùng đang nhìn phần tử nào. Nó không
   * đi vào tài liệu, nên không có đường nào từ đây sửa được gói đang chạy. */
  const [selection, setSelection] = useState<FbdSelection | null>(null)

  /**
   * Chỉ nhận `SELECT`. Mọi hành động khác bị BỎ QUA có chủ đích — canvas dùng
   * chung với chế độ EDIT, và một lệnh sửa lọt qua đây sẽ sửa gói đang chạy.
   * Bỏ qua ở đúng một chỗ thì dễ đọc hơn là tin rằng `canEdit={false}` đã chặn
   * hết mọi đường.
   */
  const dispatch = useMemo<(action: FbdEditorAction) => void>(
    () => (action) => { if (action.type === 'SELECT') setSelection(action.selection) },
    [],
  )

  const networks = document.networks ?? []
  if (networks.length === 0) {
    return (
      <p role="status" className="text-xs text-[var(--c-text-dim)]">
        {pick('Sơ đồ đang chạy không có network nào.', 'The running diagram has no networks.')}
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {networks.map((network) => (
        <article key={network.id} className="rounded-[var(--radius)] border border-[var(--c-border)] p-2">
          <h4 className="mb-2 text-xs font-semibold text-[var(--c-text)]">
            {network.order + 1}. {network.name}
          </h4>
          <FbdCanvas
            network={network}
            layout={document.layout}
            selection={selection}
            connectionFromPortId={null}
            canEdit={false}
            dispatch={dispatch}
            pick={pick}
            registerPort={() => {}}
          />
        </article>
      ))}
    </div>
  )
}
