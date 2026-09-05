/**
 * `T60-103` — dữ kiện kỹ thuật thô đứng sau nút `Chi tiết` của Context Strip.
 *
 * VÌ SAO TÁCH RA MỘT MODULE THUẦN
 * -------------------------------
 * Phần khó của popover không phải là markup mà là **luật của ô trống**: mỗi
 * dữ kiện thiếu phải nói được VÌ SAO nó thiếu ("Core im" khác hẳn "chưa
 * Commission gói nào", và cả hai khác "màn này không tải nội dung Revision").
 * Nhét luật đó vào JSX thì chỉ kiểm được bằng cách render; tách ra đây thì
 * `contextDetails.test.ts` khẳng định trực tiếp từng nhánh, không cần DOM.
 *
 * BA LUẬT KHÔNG THƯƠNG LƯỢNG
 * --------------------------
 * 1. **Không bao giờ `0`, không bao giờ chuỗi rỗng im lặng.** Thiếu dữ kiện ⇒
 *    `value = null` và **bắt buộc** có `missingReason`; tầng hiển thị vẽ `—`
 *    kèm lý do. Bất biến này được test khoá lại.
 * 2. **Không suy dữ kiện này từ dữ kiện khác.** Không có Active thì
 *    `activeContentHash` là `null` — tuyệt đối không mượn hash của Draft.
 * 3. **D-06 — một ngôn ngữ tại một thời điểm.** Mọi chuỗi đi qua `pick` do
 *    tầng gọi truyền vào; module này không tự giữ bảng chữ song ngữ.
 */
import type { ActiveRevisionOwnership } from '../shared/activeRevisionOwnership'

export type PickFn = (vi: string, en: string) => string

/** Ba tình trạng của read-back Core — xem `ContextDetailsData.coreStatus`. */
export type CoreReadStatus = 'loading' | 'readable' | 'unreadable'

export type ContextDetailRowId =
  | 'draftRevisionId'
  | 'draftContentHash'
  | 'activeRevisionId'
  | 'activeContentHash'
  | 'lkgRevisionId'
  | 'controllerId'
  | 'observedAt'

/**
 * Nguồn dữ kiện của popover. Mọi trường là `string | null` **có chủ đích**:
 * `undefined` sẽ cho phép "quên truyền" trượt qua TypeScript và biến thành một
 * ô trống không lý do, đúng thứ luật 1 cấm.
 */
export interface ContextDetailsData {
  /** `ProgrammingEditingContext.draftRevisionId`; `null` khi Project chưa có Draft. */
  draftRevisionId: string | null
  /** `ProgrammingRevision.contentHash` của Draft. Xem `MISSING_CONTENT_HASH_REASON`. */
  draftContentHash: string | null
  /**
   * `ProgrammingRuntime.activeRevisionId` SAU KHI đã chứng minh nó thuộc
   * Project đang mở (`ownedActiveRevisionId`); `null` khi chưa Commission gói
   * nào, hoặc khi gói đang chạy là của Project khác. `activeOwnership` bên
   * dưới nói rõ `null` này nghĩa gì.
   */
  activeRevisionId: string | null
  /** `ProgrammingRevision.contentHash` của Active. Xem `MISSING_CONTENT_HASH_REASON`. */
  activeContentHash: string | null
  /** `ProgrammingRuntime.lkgRevisionId` — bản tốt gần nhất đã biết. */
  lkgRevisionId: string | null
  /** `ProgrammingRuntime.controllerId`. */
  controllerId: string | null
  /** `ProgrammingRuntime.observedAt`, dạng ISO-8601 nguyên bản từ máy chủ. */
  observedAt: string | null
  /**
   * `ISS-PGUI-01` — VÌ SAO `activeRevisionId` rỗng.
   *
   * Thiết bị chưa Commission và "gói đang chạy thuộc Project khác" cùng cho
   * `null`, nhưng chỉ câu đầu là sự thật về thiết bị. In "Chưa Commission gói
   * nào lên thiết bị" trên một thiết bị ĐANG chạy một gói là một câu sai, và
   * đây đúng là ô người vận hành đọc trước khi cân nhắc rollback.
   *
   * `undefined` giữ nguyên hành vi cũ cho chỗ gọi chưa phân giải quyền sở hữu.
   */
  activeOwnership?: ActiveRevisionOwnership['kind']
  /**
   * Tình trạng read-back Core, BA giá trị chứ không phải một cờ nhị phân:
   *
   * - `loading`: lần đọc đầu chưa xong. Nói "không đọc được" ở đây là **báo
   *   động giả** — chưa ai kết luận gì cả.
   * - `unreadable`: HTTP lỗi, chưa có thân phản hồi, hoặc `producerState =
   *   UNAVAILABLE`. Core im.
   * - `readable`: Core đã trả lời; ô trống lúc này là **câu trả lời của Core**
   *   ("chưa Commission"), không phải mất kết nối.
   *
   * Gộp ba thứ này thành một `boolean` chính là cách một màn hình dạy người
   * vận hành rằng thiết bị đang trống trong khi thật ra không ai biết.
   */
  coreStatus: CoreReadStatus
}

export interface ContextDetailRow {
  id: ContextDetailRowId
  label: string
  /** Chuỗi THÔ, dùng cho cả hiển thị lẫn Copy. `null` ⇒ chưa rõ. */
  value: string | null
  /** Bắt buộc khác `null` khi `value === null`. */
  missingReason: string | null
  /** Diễn giải phụ; KHÔNG bao giờ thay thế `value`. */
  hint: string | null
}

/**
 * Vì sao `contentHash` gần như luôn trống ở màn này: shell chỉ giữ read-model
 * `runtime` + `projects`, không tải thân Revision (`GET /revisions/{id}`).
 * Nói thẳng điều đó ra tốt hơn là để một ô trống không giải thích, và tốt hơn
 * nhiều so với việc dựng một đường đọc HTTP thứ hai ngoài `api/queries.ts`
 * (README §5.1/§5.2). Khi `T60-015`/`T60-203` mở đường đọc Revision, chỉ cần
 * truyền hash vào `ContextDetailsData` — popover không phải đổi một dòng nào.
 */
export const MISSING_CONTENT_HASH_REASON = Object.freeze(['Chưa đọc được — màn này không tải nội dung Revision', 'Not read — this view does not load revision content'] as const)

/**
 * Dựng đúng bảy dòng của popover, theo thứ tự đọc: cặp Draft → cặp Active →
 * LKG → định danh bộ điều khiển → mốc đọc.
 *
 * `lkgRevisionId` không nằm trong câu chữ của `T60-103` nhưng thuộc **cùng
 * nhóm "revision ID thô"** và đã có sẵn trong `ProgrammingRuntime`. Giấu nó đi
 * sẽ để lại đúng một định danh vận hành mà người dùng không có lối nào đọc
 * được sau khi `AC-PGM01-01` gỡ UUID khỏi mặt trước — trong khi nó chính là
 * thứ cần dán vào phiếu sự cố khi phải cân nhắc rollback.
 */
export function contextDetailRows(pick: PickFn, data: ContextDetailsData): ContextDetailRow[] {
  const noDraft = pick('Chưa có bản nháp cho Project này', 'This project has no draft yet')
  const coreSilent = pick('Không đọc được từ Core', 'Not readable from Core')
  const coreLoading = pick('Đang đọc từ Core…', 'Reading from Core…')
  const notCommissioned = pick('Chưa Commission gói nào lên thiết bị', 'No package has been commissioned yet')
  const noLkg = pick('Chưa có bản tốt gần nhất (LKG)', 'There is no last known-good revision yet')
  const missingHash = pick(MISSING_CONTENT_HASH_REASON[0], MISSING_CONTENT_HASH_REASON[1])

  /** Lý do cho một dữ kiện đến từ Core. Thứ tự thắng: đang đọc → Core im → lý
   *  do nghiệp vụ. Đảo thứ tự này là cách sinh ra "không đọc được" giả ngay
   *  trong giây đầu tiên của mỗi lần vào trang. */
  const fromCore = (absent: string) => (
    data.coreStatus === 'loading' ? coreLoading : data.coreStatus === 'unreadable' ? coreSilent : absent
  )
  /* `ISS-PGUI-01` — `foreign`/`unresolved` là "có gói đang chạy nhưng không
     phải của Project này", KHÔNG phải "chưa Commission". */
  const activeAbsent = fromCore(
    data.activeOwnership === 'foreign'
      ? pick('Gói đang vận hành thuộc Project khác', 'The running package belongs to another project')
      : data.activeOwnership === 'unresolved'
        ? pick('Chưa xác định được gói đang vận hành thuộc Project nào', 'The running package could not be attributed to a project')
        : notCommissioned
  )

  return [
    row('draftRevisionId', pick('ID Revision Nháp', 'Draft revision ID'), data.draftRevisionId, noDraft),
    // Hash của Draft chỉ vô nghĩa khi KHÔNG có Draft; có Draft mà thiếu hash là
    // giới hạn của màn này, không phải trạng thái của dữ liệu.
    row('draftContentHash', pick('contentHash Nháp', 'Draft contentHash'), data.draftContentHash, data.draftRevisionId ? missingHash : noDraft),
    row('activeRevisionId', pick('ID Revision đang vận hành', 'Active revision ID'), data.activeRevisionId, activeAbsent),
    row('activeContentHash', pick('contentHash đang vận hành', 'Active contentHash'), data.activeContentHash, data.activeRevisionId ? missingHash : activeAbsent),
    row('lkgRevisionId', pick('ID Revision tốt gần nhất (LKG)', 'Last known-good revision ID'), data.lkgRevisionId, fromCore(noLkg)),
    row('controllerId', pick('ID bộ điều khiển', 'Controller ID'), data.controllerId, fromCore(coreSilent)),
    observedAtRow(pick, data, fromCore(coreSilent))
  ]
}

function row(id: ContextDetailRowId, label: string, value: string | null, missingReason: string, hint: string | null = null): ContextDetailRow {
  // Chuỗi rỗng/trắng bị coi là THIẾU: một ô trống im lặng trông y hệt một dữ
  // kiện hợp lệ, và Copy nó ra sẽ đặt chuỗi rỗng vào clipboard người dùng.
  const trimmed = value?.trim() ?? ''
  return trimmed
    ? { id, label, value: trimmed, missingReason: null, hint }
    : { id, label, value: null, missingReason, hint: null }
}

function observedAtRow(pick: PickFn, data: ContextDetailsData, absentReason: string): ContextDetailRow {
  const base = row('observedAt', pick('Mốc đọc gần nhất', 'Last observed at'), data.observedAt, absentReason)
  if (!base.value) return base
  const local = localTime(base.value)
  // Giá trị THÔ vẫn là thứ được hiển thị và Copy (ISO-8601 là thứ dán được vào
  // log và vào lệnh gọi API); giờ địa phương chỉ là diễn giải đi kèm.
  return {
    ...base,
    hint: local
      ? pick(`Giờ địa phương: ${local}`, `Local time: ${local}`)
      : pick('Không phân giải được mốc thời gian; giữ nguyên chuỗi máy chủ trả về', 'Timestamp could not be parsed; showing the raw server string')
  }
}

/** `null` khi chuỗi không phân giải được — không tự thay bằng "bây giờ". */
export function localTime(value: string): string | null {
  const parsed = new Date(value)
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toLocaleString()
}

/** Dùng chung cho Context Strip: hiển thị giờ địa phương, thiếu thì giữ chuỗi gốc. */
export function formatObservedAt(value: string): string {
  return localTime(value) ?? value
}
