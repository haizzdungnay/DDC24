import { PROGRAMMING_LIBRARY_CATEGORY_ORDER } from '../api/generated/library_registry'
import type {
  ProgrammingLibraryEntry,
  ProgrammingLibraryUsage,
} from '../model/types'

/**
 * `T61-203` — mô hình TRÌNH BÀY của một khối Control Library.
 *
 * Tách khỏi React vì ba luật ở đây là luật về DỮ LIỆU, không phải về giao diện,
 * và cả ba đều là chống-nói-dối. Kiểm chúng phải làm được mà không dựng cây
 * component.
 */

/** Nhãn phạm vi. **Không** dùng chữ "Core": sản phẩm đã có `mkddc-core`, và hai
 *  nghĩa cho một từ đúng chỗ người trực ca cần đọc nhanh là một cái bẫy. */
export function scopeLabel(scope: ProgrammingLibraryEntry['scope'], english: boolean): string {
  if (scope === 'SYSTEM') return english ? 'System' : 'Hệ thống'
  return english ? 'Project' : 'Dự án'
}

/**
 * Giá trị hiển thị của một trường metadata.
 *
 * `null` ở đây nghĩa là "chưa ai điền" và bề mặt phải render `—`. Quy nó về
 * chuỗi rỗng sẽ làm ô đó trông như đã điền rồi — người dùng sẽ không đi tìm
 * chỗ để điền.
 */
export function metadataValue(raw: string | undefined): string | null {
  if (raw === undefined) return null
  const trimmed = raw.trim()
  return trimmed.length === 0 ? null : trimmed
}

export type InsertBlockReason =
  | 'REVIEW_REQUIRED'
  | 'NO_TARGET'
  | 'DEPRECATED'
  | null

/**
 * Vì sao Insert bị khoá — hoặc `null` nếu không bị khoá.
 *
 * Thứ tự kiểm là một phần của hợp đồng: `REVIEW_REQUIRED` đứng TRƯỚC
 * `NO_TARGET`. Một khối đang chờ review Controls/Safety thì việc mở đúng POU
 * cũng không làm nó chèn được, nên báo "hãy chọn POU đích" là chỉ người dùng
 * đi một vòng vô ích rồi quay lại đúng chỗ cũ.
 *
 * `D61-04`/`T59-205`: KHÔNG có đường bỏ qua `REVIEW_REQUIRED`. Hàm này không
 * nhận cờ nào để tắt nó.
 */
export function insertBlockReason(
  entry: Pick<ProgrammingLibraryEntry, 'featureState' | 'libraryState'>,
  hasTarget: boolean,
): InsertBlockReason {
  if (entry.featureState === 'REVIEW_REQUIRED') return 'REVIEW_REQUIRED'
  if (entry.libraryState === 'DEPRECATED') return 'DEPRECATED'
  if (!hasTarget) return 'NO_TARGET'
  return null
}

export type UsageDisplay =
  | { kind: 'count'; sealed: number; draft: number | null; truncated: boolean }
  | { kind: 'unavailable' }
  /** Chưa đọc xong — KHÁC "chưa đo được". Xem `usageDisplay`. */
  | { kind: 'loading' }
  | { kind: 'sealed-only'; sealed: number; truncated: boolean }

/**
 * Chiếu Used-In thành thứ hiển thị được — và đây là hàm quan trọng nhất tệp này.
 *
 * `count: 0` nghĩa là "không chương trình nào đang dùng khối này", một câu mời
 * người ta xoá hoặc deprecate nó. `UNAVAILABLE` nghĩa là "chưa đo được". Hiện
 * số `0` khi server nói `UNAVAILABLE` là cách một khối bị gỡ **trong khi nó
 * đang điều khiển tủ** — nên hàm này không bao giờ trả `count` cho trường hợp
 * đó, kể cả khi payload có sẵn số 0 trong `sealed.count`.
 */
export function usageDisplay(
  usage: ProgrammingLibraryUsage | null | undefined,
  loading = false,
): UsageDisplay {
  /* `loading` phải được hỏi TRƯỚC. Trước lát này mọi trường hợp không có dữ
     liệu đều rơi vào `unavailable`, nên trong lúc request còn đang bay, khay
     Used-In của một khối PROJECT hiện đúng câu lý do của SYSTEM: "khối SYSTEM
     phân giải nơi dùng từ registry". Một trạng thái ĐANG TẢI mặc áo CHƯA ĐO
     ĐƯỢC, và lại mang lý do của loại khác — người đọc kết luận sai hai lần. */
  if (loading && !usage) return { kind: 'loading' }
  if (!usage || usage.availability === 'UNAVAILABLE') return { kind: 'unavailable' }
  if (usage.availability === 'SEALED_ONLY') {
    return { kind: 'sealed-only', sealed: usage.sealed.count, truncated: usage.sealed.truncated }
  }
  return {
    kind: 'count',
    sealed: usage.sealed.count,
    draft: usage.draft.count,
    truncated: usage.sealed.truncated || usage.draft.truncated,
  }
}

/**
 * Có được phép xoá/ngừng dùng khối này không, xét theo Used-In.
 *
 * Trả `false` khi CHƯA ĐO ĐƯỢC, không chỉ khi đang có người dùng. Đây là chỗ
 * `UNAVAILABLE` phải hành xử khác `0`: không biết thì không cho gỡ.
 */
export function safeToRemove(usage: ProgrammingLibraryUsage | null | undefined): boolean {
  const display = usageDisplay(usage)
  if (display.kind === 'unavailable' || display.kind === 'loading') return false
  if (display.truncated) return false
  if (display.kind === 'sealed-only') return display.sealed === 0
  return display.sealed === 0 && display.draft === 0
}

/**
 * Nhãn hiển thị của một phân loại, lấy từ registry.
 *
 * Không viết tay bảng ánh xạ ở FE: registry là nơi `category` được định nghĩa,
 * nên nó cũng phải là nơi định nghĩa tên hiển thị. Một nhóm mới thêm vào
 * registry mà FE không biết sẽ hiện ra dưới dạng mã thô — xấu nhưng TRUNG THỰC,
 * và tốt hơn nhiều so với việc rơi vào một nhóm "khác" tự nghĩ ra.
 */
export function categoryLabel(
  category: string,
  pick: (vi: string, en: string) => string,
): string {
  const known = PROGRAMMING_LIBRARY_CATEGORY_ORDER.find((item) => item.id === category)
  return known ? pick(known.labelVi, known.labelEn) : category
}

/**
 * `T61-303` — chữ ký một dòng của khối, thứ `AC-PGM04-01` đòi phải đọc được
 * TRƯỚC khi mở chi tiết.
 *
 * Nguồn duy nhất là `signature` ĐÃ PHÂN GIẢI của backend. Vắng field nghĩa là
 * backend không đọc được chữ ký thô, và câu trả lời đúng là nói ra điều đó —
 * không tự parse `interface` để đoán hộ. Hai nơi cùng đoán là hai nơi kết luận
 * khác nhau về cùng một khối, và người dùng không có cách nào biết bên nào
 * đúng; ở đây "bên nào đúng" quyết định họ nối dây vào chân nào.
 */
export type BlockSignatureLine =
  | { kind: 'ready'; text: string }
  | { kind: 'unavailable' }

export function blockSignatureLine(
  entry: Pick<ProgrammingLibraryEntry, 'name' | 'signature'>,
): BlockSignatureLine {
  const signature = entry.signature
  if (!signature) return { kind: 'unavailable' }
  const inputs = signature.ports.filter((port) => port.direction === 'INPUT')
  const outputs = signature.ports.filter((port) => port.direction === 'OUTPUT')
  const inputText = inputs.map((port) => `${port.name}: ${port.dataType}`).join(', ')
  /* Nhiều đầu ra được bọc trong ngoặc để không đọc nhầm thành một kiểu ghép.
     Không đầu ra thì viết `—`, không viết `void`: sản phẩm này không dùng chữ
     đó ở bất cứ đâu khác. */
  const outputText =
    outputs.length === 0
      ? '—'
      : outputs.length === 1
        ? `${outputs[0].name}: ${outputs[0].dataType}`
        : `(${outputs.map((port) => `${port.name}: ${port.dataType}`).join(', ')})`
  return { kind: 'ready', text: `${entry.name}(${inputText}) → ${outputText}` }
}

/** Vì sao một POU không nhận được khối này — hoặc `null` nếu nhận được. */
export type InsertTargetBlock = 'SELF' | 'CYCLE' | null

export interface InsertTargetCandidate {
  objectId: string
  name: string
  kind: 'PROGRAM' | 'FUNCTION' | 'FUNCTION_BLOCK'
  language: 'ST' | 'FBD'
  block: InsertTargetBlock
  /** POU này đã khai khối là phụ thuộc rồi. KHÔNG phải lý do chặn. */
  alreadyDepends: boolean
}

/**
 * `T61-405` — POU nào trong Draft nhận được khối này.
 *
 * Hai luật chặn ở đây đều là luật CẤU TRÚC, đúng dù máy chủ có kiểm hay không:
 * một khối không gọi được chính nó, và không gọi được thứ đang gọi nó.
 *
 * Cố ý KHÔNG có luật nào về ngôn ngữ hay về `kind`. Máy chủ không ép chúng, nên
 * ép ở giao diện sẽ chặn người dùng trên một thao tác máy chủ chấp nhận — và họ
 * không có cách nào biết đó là luật của giao diện chứ không phải của sản phẩm.
 * Đó đúng là lỗi mà `T61-201` vừa phải sửa ở đường RBAC; không tái lập nó ở
 * đường Insert. Thay vào đó `kind`/`language` của POU được HIỆN RA để người
 * dùng chọn có hiểu biết.
 */
export function insertTargetCandidates(
  objects: readonly {
    objectId: string
    name: string
    kind: 'PROGRAM' | 'FUNCTION' | 'FUNCTION_BLOCK'
    language: 'ST' | 'FBD'
    dependencies: readonly string[]
  }[],
  entry: Pick<ProgrammingLibraryEntry, 'entryId' | 'dependencies'>,
): InsertTargetCandidate[] {
  const entryId = entry.entryId.toUpperCase()
  const requires = new Set(entry.dependencies.map((item) => item.entryId.toUpperCase()))
  return objects.map((object) => {
    const objectId = object.objectId.toUpperCase()
    const block: InsertTargetBlock = objectId === entryId ? 'SELF' : requires.has(objectId) ? 'CYCLE' : null
    return {
      objectId: object.objectId,
      name: object.name,
      kind: object.kind,
      language: object.language,
      block,
      alreadyDepends: object.dependencies.some((item) => item.toUpperCase() === entryId),
    }
  })
}
