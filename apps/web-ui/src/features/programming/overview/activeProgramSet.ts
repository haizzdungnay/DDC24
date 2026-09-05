import type { ProgrammingProgram, RemoteState } from '../model/types'
import type { ActiveRevisionOwnership } from '../shared/activeRevisionOwnership'

/**
 * `T60-017` — tập Program **đang vận hành**, đọc từ Active Revision.
 *
 * VÌ SAO CẦN MODULE NÀY
 * ---------------------
 * PGM-01 phải trả lời "Program nào đang chạy, ngôn ngữ gì, chu kỳ bao nhiêu".
 * `GET /projects/{id}/programs` mới chỉ có **ý định** (`desiredEnabled`) và
 * read-back runtime; tên/`language`/`periodMs` **khai báo** không nằm ở đó.
 * Chúng nằm trong snapshot của Revision đang chạy — dữ liệu ĐÃ CÓ SẴN, nên
 * nhóm A §3.1 của Plan 60 chốt là **không cần endpoint mới**, chỉ cần một
 * adapter đọc đúng chỗ.
 *
 * VÌ SAO LÀ HÀM THUẦN
 * -------------------
 * Module này KHÔNG tự gọi API. Tầng gọi (`api/queries.ts`) là nơi duy nhất
 * được phép biết về HTTP; trộn fetch vào đây sẽ tạo đường đọc thứ hai không đi
 * qua client sinh từ contract, đúng thứ README §5.1/§5.2 cấm. Hệ quả tốt kèm
 * theo: mọi nhánh rỗng dưới đây test được mà không cần dựng mock mạng.
 *
 * LUẬT FAIL-CLOSED
 * ----------------
 * 1. **Không mượn Draft thay Active.** Thiếu Active ⇒ danh sách rỗng KÈM LÝ DO.
 *    Nếu thân phản hồi mang một `revisionId` khác `activeRevisionId` đang hỏi
 *    (điển hình: ai đó truyền nhầm Draft vào), kết quả là rỗng với
 *    `REVISION_MISMATCH` — không bao giờ là "danh sách Program đang chạy".
 * 2. **Không chế số.** Trường không đọc được ra `null` để tầng hiển thị vẽ `—`;
 *    không có nhánh nào trả `0` cho một chu kỳ không biết.
 * 3. **Rỗng luôn có lý do.** `reason === null` chỉ khi thật sự có Program.
 */

/** Trạng thái đọc của `GET /revisions/{activeRevisionId}`, do tầng gọi cấp. */
export type RevisionFetchStatus = RemoteState<unknown>['status'] | 'idle'

export type ActiveProgramSetReason =
  /** `runtime.activeRevisionId` là `null` — thiết bị chưa Commission gói nào. */
  | 'NO_ACTIVE_REVISION'
  /** Đang đọc Revision; chưa được kết luận là "không có Program nào". */
  | 'REVISION_LOADING'
  /** Đọc hỏng hoặc chưa có thân phản hồi — khác hẳn "có 0 Program". */
  | 'REVISION_UNAVAILABLE'
  /** Thân phản hồi không phải Revision đang hỏi (nguy cơ mượn Draft). */
  | 'REVISION_MISMATCH'
  /** Có thân phản hồi nhưng `snapshot.objects` không đọc được. */
  | 'SNAPSHOT_UNREADABLE'
  /** Đọc được snapshot và Revision này thật sự không khai Program nào. */
  | 'NO_PROGRAM_DECLARED'
  /**
   * `ISS-PGUI-01` — thiết bị ĐANG chạy một gói, nhưng gói ấy thuộc Project
   * khác. Khác hẳn `NO_ACTIVE_REVISION`: nói "chưa vận hành gói nào" ở đây là
   * một câu sai về thiết bị, không phải một câu thận trọng.
   */
  | 'ACTIVE_OTHER_PROJECT'
  /** `ISS-PGUI-01` — có gói đang chạy nhưng không Project nào trong danh sách nhận. */
  | 'ACTIVE_PROJECT_UNRESOLVED'

export interface ActiveProgramDeclaration {
  /** Định danh object POU trong Revision — khoá ổn định để ghép với read-back. */
  objectId: string
  /** `programs[].programId` của Draft v2; `null` khi Revision chưa có cấu hình Program. */
  programId: string | null
  name: string | null
  language: ProgrammingProgram['language'] | null
  /** Chu kỳ KHAI BÁO, mili-giây. `null` ⇒ tầng hiển thị vẽ `—`, không vẽ `0`. */
  periodMs: number | null
}

export interface ActiveProgramSet {
  /** Revision đã dùng để dựng danh sách; `null` khi chưa có Active. */
  revisionId: string | null
  programs: ActiveProgramDeclaration[]
  /** `null` khi và chỉ khi `programs` không rỗng. */
  reason: ActiveProgramSetReason | null
}

export interface ActiveProgramSetInput {
  /**
   * `ProgrammingRuntime.activeRevisionId` — nguồn duy nhất quyết định "đang
   * chạy cái gì" — SAU KHI đã chứng minh nó thuộc Project đang xét
   * (`ownedActiveRevisionId`). Truyền thẳng giá trị toàn cục của controller
   * vào đây là cách bảng này liệt kê Program của Project khác.
   */
  activeRevisionId: string | null
  /** Trạng thái đọc `GET /revisions/{activeRevisionId}`. */
  status: RevisionFetchStatus
  /** Thân phản hồi thô. `unknown` vì contract khai `snapshot` là object tự do. */
  revision: unknown
  /**
   * `ISS-PGUI-01` — VÌ SAO `activeRevisionId` rỗng.
   *
   * `null` vì thiết bị chưa Commission, `null` vì gói đang chạy thuộc Project
   * khác, và `null` vì runtime không đọc được là ba sự thật khác nhau. Không
   * có trường này thì cả ba rơi chung vào "thiết bị chưa vận hành gói nào" —
   * câu duy nhất trong ba câu ấy khẳng định điều gì đó về thiết bị, và là câu
   * sai ở hai trường hợp còn lại.
   *
   * `undefined` giữ nguyên hành vi cũ cho các chỗ gọi không phân giải quyền sở
   * hữu (`ActiveProgramSource` của PGM-05 đọc theo Revision đã biết).
   */
  ownership?: ActiveRevisionOwnership['kind']
}

const EMPTY: ActiveProgramDeclaration[] = []

/**
 * `ISS-PGUI-01` — dịch "vì sao không có `activeRevisionId`" thành lý do đọc
 * được. Chỉ `not-commissioned` (và các chỗ gọi không phân giải quyền sở hữu)
 * mới được nói "thiết bị chưa vận hành gói nào".
 */
function emptyActiveReason(ownership: ActiveRevisionOwnership['kind'] | undefined): ActiveProgramSetReason {
  switch (ownership) {
    case 'foreign':
      return 'ACTIVE_OTHER_PROJECT'
    case 'unresolved':
      return 'ACTIVE_PROJECT_UNRESOLVED'
    case 'loading':
      return 'REVISION_LOADING'
    case 'unavailable':
      return 'REVISION_UNAVAILABLE'
    default:
      return 'NO_ACTIVE_REVISION'
  }
}

export function activeProgramSet({ activeRevisionId, status, revision, ownership }: ActiveProgramSetInput): ActiveProgramSet {
  // Chưa Commission thì không có gì để đọc, và tuyệt đối không rơi sang Draft.
  if (!activeRevisionId) {
    return { revisionId: null, programs: EMPTY, reason: emptyActiveReason(ownership) }
  }
  if (status === 'loading' || status === 'idle') {
    return { revisionId: activeRevisionId, programs: EMPTY, reason: 'REVISION_LOADING' }
  }
  if (status === 'error' || !isRecord(revision)) {
    return { revisionId: activeRevisionId, programs: EMPTY, reason: 'REVISION_UNAVAILABLE' }
  }

  // `revisionId` của thân phản hồi là thứ duy nhất chứng minh ta đang đọc đúng
  // gói ĐANG CHẠY. Thiếu nó thì không kết luận được, nên cũng không được dùng.
  const bodyRevisionId = typeof revision.revisionId === 'string' ? revision.revisionId : null
  if (bodyRevisionId === null || bodyRevisionId !== activeRevisionId) {
    return { revisionId: activeRevisionId, programs: EMPTY, reason: 'REVISION_MISMATCH' }
  }

  const snapshot = isRecord(revision.snapshot) ? revision.snapshot : null
  if (!snapshot || !Array.isArray(snapshot.objects)) {
    return { revisionId: activeRevisionId, programs: EMPTY, reason: 'SNAPSHOT_UNREADABLE' }
  }

  const programs: ActiveProgramDeclaration[] = []
  for (const entry of snapshot.objects) {
    const declaration = programDeclaration(entry)
    if (declaration) programs.push(declaration)
  }

  return {
    revisionId: activeRevisionId,
    programs,
    reason: programs.length === 0 ? 'NO_PROGRAM_DECLARED' : null
  }
}

/**
 * Lý do rỗng, viết cho người đọc. Trả `null` khi không có lý do nào — để chỗ
 * gọi không phải tự bịa một câu chữ khi danh sách thật sự có dữ liệu.
 */
export function activeProgramSetReasonLabel(
  pick: (vi: string, en: string) => string,
  reason: ActiveProgramSetReason | null
): string | null {
  switch (reason) {
    case 'NO_ACTIVE_REVISION':
      return pick(
        'Thiết bị chưa vận hành gói nào — chưa có Program đang chạy để hiển thị.',
        'The device is not running any package yet — there is no running Program to show.'
      )
    case 'REVISION_LOADING':
      return pick('Đang đọc gói đang vận hành…', 'Reading the running package…')
    case 'REVISION_UNAVAILABLE':
      return pick(
        'Không đọc được gói đang vận hành; danh sách để trống thay vì hiển thị dữ liệu cũ.',
        'The running package could not be read; the list stays empty instead of showing stale data.'
      )
    case 'REVISION_MISMATCH':
      return pick(
        'Dữ liệu nhận về không thuộc gói đang vận hành — không dùng bản nháp để thay thế.',
        'The payload does not belong to the running package — a draft is not used as a substitute.'
      )
    case 'SNAPSHOT_UNREADABLE':
      return pick(
        'Gói đang vận hành không kèm snapshot đọc được.',
        'The running package carries no readable snapshot.'
      )
    case 'NO_PROGRAM_DECLARED':
      return pick(
        'Gói đang vận hành không khai báo Program nào.',
        'The running package declares no Program.'
      )
    case 'ACTIVE_OTHER_PROJECT':
      return pick(
        'Gói đang vận hành thuộc Project khác — Project này không có Program đang chạy.',
        'The running package belongs to another project — this project has no running Program.'
      )
    case 'ACTIVE_PROJECT_UNRESOLVED':
      return pick(
        'Chưa xác định được gói đang vận hành thuộc Project nào; danh sách để trống thay vì đoán.',
        'The running package could not be attributed to a project; the list stays empty instead of guessing.'
      )
    default:
      return null
  }
}

/**
 * Một phần tử `snapshot.objects[]`. Hình dạng do `ProjectService.GetRevision`
 * dựng: `{ objectId, kind, sha256, payload }`, trong đó `payload` là object POU
 * của Draft v2 — và với POU kind `PROGRAM`, `payload.programConfig` mang thêm
 * `programId`/`periodMs` (xem `draft.go: revisionPayload`).
 */
/**
 * `T59-811` / `AC-ST-007` — nguồn của MỘT POU trong Revision đang chạy.
 *
 * Chế độ LIVE phải hiện **nguồn Active**, không bao giờ hiện Draft. Hai thứ đó
 * trông giống hệt nhau trên màn hình: cùng một cửa sổ, cùng một tên POU, cùng
 * một thứ tiếng ST. Người vận hành đọc nhầm Draft thành thứ đang điều khiển tủ
 * là một lỗi không có dấu hiệu bên ngoài nào cả.
 *
 * Vì vậy hàm này dùng lại **đúng** chuỗi kiểm của `activeProgramSet` — kể cả
 * `REVISION_MISMATCH`, chốt chặn thật sự chống mượn Draft — và trả `source:
 * null` kèm `reason` ở mọi nhánh không chứng minh được. Không có nhánh nào rơi
 * về Draft.
 */
export interface ActiveProgramSource {
  revisionId: string | null
  objectId: string | null
  language: ProgrammingProgram['language'] | null
  /** `null` ⇒ KHÔNG được vẽ gì; `reason` nói vì sao. */
  source: string | null
  reason: ActiveProgramSetReason | 'SOURCE_UNREADABLE' | 'POU_NOT_IN_REVISION' | null
}

export function activeProgramSource(
  input: ActiveProgramSetInput & { objectId: string | null },
): ActiveProgramSource {
  const base = activeProgramSet(input)
  if (base.reason !== null && base.reason !== 'NO_PROGRAM_DECLARED') {
    return { revisionId: base.revisionId, objectId: input.objectId, language: null, source: null, reason: base.reason }
  }
  if (!input.objectId) {
    return { revisionId: base.revisionId, objectId: null, language: null, source: null, reason: 'POU_NOT_IN_REVISION' }
  }

  const revision = input.revision as Record<string, unknown>
  const snapshot = isRecord(revision.snapshot) ? revision.snapshot : null
  const objects = snapshot && Array.isArray(snapshot.objects) ? snapshot.objects : []
  for (const entry of objects) {
    if (!isRecord(entry)) continue
    const payload = isRecord(entry.payload) ? entry.payload : null
    const objectId = typeof entry.objectId === 'string' ? entry.objectId : null
    if (objectId !== input.objectId) continue

    const language = payload && (payload.language === 'ST' || payload.language === 'FBD') ? payload.language : null
    const source = payload && typeof payload.source === 'string' ? payload.source : null
    if (source === null) {
      /* POU có mặt trong Revision nhưng thân của nó không đọc được. Đây KHÔNG
       * phải "chương trình rỗng": một chương trình rỗng vẫn có `source: ""`. */
      return { revisionId: base.revisionId, objectId, language, source: null, reason: 'SOURCE_UNREADABLE' }
    }
    return { revisionId: base.revisionId, objectId, language, source, reason: null }
  }

  /* POU đang mở không có trong Revision đang chạy — thường vì nó mới được tạo ở
   * Draft và chưa Commission. Nói thẳng, đừng hiện Draft thay thế. */
  return { revisionId: base.revisionId, objectId: input.objectId, language: null, source: null, reason: 'POU_NOT_IN_REVISION' }
}

function programDeclaration(entry: unknown): ActiveProgramDeclaration | null {
  if (!isRecord(entry)) return null
  const payload = isRecord(entry.payload) ? entry.payload : null
  const kind = typeof entry.kind === 'string' ? entry.kind : payload && typeof payload.kind === 'string' ? payload.kind : null
  // CHỈ `PROGRAM`. `FUNCTION`/`FUNCTION_BLOCK` là POU được gọi, không phải đơn
  // vị được lập lịch — gộp chúng vào đây là đếm sai số Program đang chạy.
  if (kind !== 'PROGRAM') return null

  const objectId = typeof entry.objectId === 'string' && entry.objectId
    ? entry.objectId
    : payload && typeof payload.objectId === 'string' ? payload.objectId : null
  if (!objectId) return null

  const config = payload && isRecord(payload.programConfig) ? payload.programConfig : null
  return {
    objectId,
    programId: config && typeof config.programId === 'string' && config.programId ? config.programId : null,
    name: payload && typeof payload.name === 'string' && payload.name.trim() ? payload.name : null,
    language: payload && (payload.language === 'ST' || payload.language === 'FBD') ? payload.language : null,
    periodMs: config && typeof config.periodMs === 'number' && Number.isFinite(config.periodMs) && config.periodMs > 0
      ? config.periodMs
      : null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
