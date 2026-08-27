import type {
  ProgrammingFbdChange,
  ProgrammingRevisionChange,
  ProgrammingRevisionChanges,
  ProgrammingStHunk,
} from '../../model/types'

/**
 * `T59-819` / `PGM02-V22-WP-09` (phần còn nợ) — mô hình thuần cho khay So sánh.
 *
 * Toàn bộ phần khó của màn này là **luật**, không phải pixel, nên nó nằm ở đây
 * để kiểm được mà không dựng cây component:
 *
 * 1. **Không bao giờ so một ảnh chụp có thể đổi dưới chân mình.** Draft là bản
 *    ghi SỐNG: nó đổi mỗi lần người dùng gõ. So sánh chỉ hợp lệ giữa hai
 *    Revision BẤT BIẾN, nên Draft bẩn phải Lưu, rồi phải Niêm phong. Bỏ qua
 *    một trong hai bước là hiện cho người vận hành một bảng khác biệt của một
 *    thứ không còn tồn tại.
 * 2. **"Chưa so" ≠ "không có khác biệt".** Server đời cũ không gửi khoá
 *    `stHunks`; mảng rỗng nghĩa là đã so và không có gì. Vẽ hai thứ đó giống
 *    nhau là cách nói "an toàn, cứ nạp đi" khi thật ra không ai kiểm.
 * 3. **Không có Active thì nói ra lý do.** Không có gì để đối chiếu KHÁC HẲN
 *    đối chiếu xong thấy giống nhau.
 */

export type CompareGate =
  /** Chưa có Revision đang vận hành để làm mốc — trạng thái rỗng CÓ LÝ DO. */
  | { kind: 'NO_ACTIVE'; fromRevisionId: null; toRevisionId: string | null }
  /** Draft còn thay đổi chưa lưu. */
  | { kind: 'MUST_SAVE'; fromRevisionId: string; toRevisionId: null }
  /** Draft đã lưu nhưng chưa niêm phong thành Revision bất biến. */
  | { kind: 'MUST_SEAL'; fromRevisionId: string; toRevisionId: null }
  /** Candidate chính là Active: hợp lệ nhưng không được gọi endpoint cấm from=to. */
  | { kind: 'SAME_REVISION'; fromRevisionId: string; toRevisionId: string }
  | { kind: 'READY'; fromRevisionId: string; toRevisionId: string }

export function compareGateFor(input: {
  dirty: boolean
  activeRevisionId: string | null
  /** Revision BẤT BIẾN vừa niêm phong từ Draft đã lưu. `null` = chưa niêm phong. */
  sealedRevisionId: string | null
}): CompareGate {
  // Không có mốc thì mọi bước sau đều vô nghĩa — nói ngay thay vì bắt người
  // dùng Lưu rồi Niêm phong xong mới gặp ngõ cụt.
  if (!input.activeRevisionId) return { kind: 'NO_ACTIVE', fromRevisionId: null, toRevisionId: input.sealedRevisionId }
  if (input.dirty) return { kind: 'MUST_SAVE', fromRevisionId: input.activeRevisionId, toRevisionId: null }
  if (!input.sealedRevisionId) return { kind: 'MUST_SEAL', fromRevisionId: input.activeRevisionId, toRevisionId: null }
  if (input.activeRevisionId === input.sealedRevisionId) {
    return { kind: 'SAME_REVISION', fromRevisionId: input.activeRevisionId, toRevisionId: input.sealedRevisionId }
  }
  return { kind: 'READY', fromRevisionId: input.activeRevisionId, toRevisionId: input.sealedRevisionId }
}

export type CompareEntry =
  | { entryId: string; kind: 'ST'; objectId: string; pouName: string | null; hunk: ProgrammingStHunk }
  | { entryId: string; kind: 'FBD'; objectId: string; pouName: string | null; change: ProgrammingFbdChange }

export type CompareDiffState =
  /** Máy chủ không gửi khoá diff — KHÔNG được đọc thành "không có khác biệt". */
  | { kind: 'UNSUPPORTED' }
  /** Đã so và không có khác biệt nào ở mã nguồn/topology. */
  | { kind: 'EMPTY' }
  | { kind: 'ENTRIES'; entries: CompareEntry[]; truncated: boolean; nextCursor: string | null }

export function compareDiffStateFor(
  view: ProgrammingRevisionChanges,
  pouNameByObjectId: ReadonlyMap<string, string>,
): CompareDiffState {
  // `undefined` là "server chưa biết so"; `[]` là "đã so, không có gì". Gộp hai
  // câu đó lại là đúng chỗ một bản vá cẩu thả sẽ nói dối.
  if (view.stHunks === undefined || view.fbdChanges === undefined) return { kind: 'UNSUPPORTED' }
  const entries: CompareEntry[] = []
  view.stHunks.forEach((hunk, index) => {
    entries.push({
      entryId: `st:${hunk.objectId}:${hunk.beforeStartLine}:${hunk.afterStartLine}:${index}`,
      kind: 'ST',
      objectId: hunk.objectId,
      pouName: pouNameByObjectId.get(hunk.objectId) ?? null,
      hunk,
    })
  })
  view.fbdChanges.forEach((change, index) => {
    entries.push({
      entryId: `fbd:${change.objectId}:${change.element}:${change.elementId}:${change.changeType}:${index}`,
      kind: 'FBD',
      objectId: change.objectId,
      pouName: pouNameByObjectId.get(change.objectId) ?? null,
      change,
    })
  })
  if (entries.length === 0) return { kind: 'EMPTY' }
  // Thứ tự giữ NGUYÊN như máy chủ phát: nó đã tất định, và sắp lại ở FE là mở
  // một đường thứ hai để hai lần mở khay cho hai thứ tự khác nhau.
  return {
    kind: 'ENTRIES',
    entries,
    truncated: view.truncated === true,
    nextCursor: view.nextCursor ?? null,
  }
}

/**
 * Thay đổi cấp object KHÔNG có mã nguồn để diff (biến, ánh xạ, task, tín hiệu
 * công bố…). Khay phải liệt chúng riêng: một Revision chỉ đổi ánh xạ đầu ra sẽ
 * có `stHunks` rỗng, và hiện "không có khác biệt" ở đó là câu nói dối nguy hiểm
 * nhất mà màn So sánh có thể nói.
 */
export function nonSourceChanges(view: ProgrammingRevisionChanges): ProgrammingRevisionChange[] {
  const typedObjectIds = new Set<string>([
    ...(view.stHunks ?? []).map((hunk) => hunk.objectId),
    ...(view.fbdChanges ?? []).map((change) => change.objectId),
  ])
  return view.changes.filter((change) => !(
    change.kind === 'PROGRAM' &&
    change.category === 'SOURCE' &&
    typedObjectIds.has(change.objectId)
  ))
}
