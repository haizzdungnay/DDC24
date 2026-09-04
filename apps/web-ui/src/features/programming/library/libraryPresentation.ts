import { PROGRAMMING_LIBRARY_CATEGORY_ORDER } from '../api/generated/library_registry'
import { iecClassificationOf } from '../design/library/iecClassification'
import type { LibraryIecClassification } from '../api/generated/library_registry'
import type {
  ProgrammingLibraryEntry,
  ProgrammingLibrarySignaturePort,
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

/**
 * `T61-101` — thẻ hiển thị được của một khối.
 *
 * Máy chủ ĐÃ chuẩn hoá (trim, gộp khoảng trắng, hạ chữ thường, khử trùng lặp,
 * sắp tăng dần), nên hàm này KHÔNG chuẩn hoá lại — nó chỉ quy "field vắng" và
 * "mảng rỗng" về CÙNG một câu trả lời, đúng như hợp đồng đã ghi. Chuẩn hoá lần
 * hai ở đây sẽ tạo ra luật gấp chữ thứ hai, và hai luật thì cùng một thẻ hiện
 * hai kiểu tuỳ nơi hiển thị.
 *
 * Trả mảng RỖNG chứ không `null`: khác `metadataValue`, một khối không có thẻ
 * không cần render `—` — nó chỉ đơn giản không có hàng thẻ nào.
 */
export function entryTags(entry: Pick<ProgrammingLibraryEntry, 'tags'>): string[] {
  return entry.tags ?? []
}

/**
 * `T61-101` / `LOCK-PGM04-CONTRACT-001` §4 — trạng thái tương thích hiển thị được.
 *
 * FAIL-CLOSED là toàn bộ lý do hàm này tồn tại. `compatibility` vắng mặt nghĩa
 * là máy chủ đời cũ chưa biết trường này — KHÔNG phải "không sao". Quy nó về
 * `unknown` ở đây làm chỗ gọi không thể vô tình đọc `undefined` thành yên tâm,
 * và cũng không thể hiện `COMPATIBLE` cho một thứ chưa ai đo.
 *
 * `reason` chỉ đi kèm khi `state` khác `COMPATIBLE`, đúng như hợp đồng.
 */
export type CompatibilityDisplay =
  | { kind: 'compatible' }
  | { kind: 'requires-migration'; requiredVersion: string | null; availableVersion: string | null; reason: string | null }
  | { kind: 'unknown'; reason: string | null }

export function compatibilityDisplay(
  entry: Pick<ProgrammingLibraryEntry, 'compatibility'>,
): CompatibilityDisplay {
  const compatibility = entry.compatibility
  if (!compatibility) return { kind: 'unknown', reason: null }
  if (compatibility.state === 'COMPATIBLE') return { kind: 'compatible' }
  if (compatibility.state === 'REQUIRES_MIGRATION') {
    return {
      kind: 'requires-migration',
      requiredVersion: compatibility.requiredVersion,
      availableVersion: compatibility.availableVersion,
      reason: compatibility.reason,
    }
  }
  /* Mọi giá trị KHÁC ba giá trị đã khoá cũng rơi vào đây, không rơi vào
     `compatible`. Một enum mọc thêm giá trị ở máy chủ mới không được làm một
     bản FE cũ kết luận "ổn" cho thứ nó chưa hiểu. */
  return { kind: 'unknown', reason: compatibility.reason }
}

/**
 * `T61-203` — vì sao một khối CHƯA DÙNG ĐƯỢC, xét trên chính khối đó.
 *
 * Đây là thang bậc DUY NHẤT của sản phẩm. Trước lát này có hai: PGM-04 hỏi
 * `insertBlockReason` (biết `REVIEW_REQUIRED` và `DEPRECATED`), còn Quick
 * Library hỏi một hàm riêng trong catalog của nó (biết `REVIEW_REQUIRED` và
 * "thiếu chữ ký", KHÔNG biết `DEPRECATED`). Hệ quả đo được: một khối đã ngừng
 * sử dụng bị PGM-04 chặn nhưng vẫn chèn được từ Quick Library — cùng một khối,
 * hai câu trả lời, và câu dễ dãi hơn nằm đúng ở bề mặt người ta chèn nhanh.
 *
 * Thứ tự là một phần của hợp đồng: `REVIEW_REQUIRED` đứng trước `DEPRECATED`,
 * và cả hai đứng trước `SIGNATURE_UNAVAILABLE`. Một khối chờ review thì việc
 * đọc được chữ ký của nó cũng không làm nó dùng được, nên nói "thiếu chữ ký"
 * là chỉ người dùng đi sửa một thứ không phải nguyên nhân.
 */
export type LibraryUsability =
  | { kind: 'AVAILABLE' }
  /** Có thật nhưng cần review sản phẩm trước khi dùng (vd PID). */
  | { kind: 'REVIEW_REQUIRED' }
  /** Version thư viện đã kết thúc vòng đời. */
  | { kind: 'DEPRECATED' }
  /** Máy chủ trả mục nhưng chữ ký không đọc được — KHÔNG đoán port. */
  | { kind: 'SIGNATURE_UNAVAILABLE' }

export function libraryUsability(
  entry: Pick<ProgrammingLibraryEntry, 'featureState' | 'libraryState' | 'signature'>,
): LibraryUsability {
  if (entry.featureState === 'REVIEW_REQUIRED') return { kind: 'REVIEW_REQUIRED' }
  if (entry.libraryState === 'DEPRECATED') return { kind: 'DEPRECATED' }
  if (!entry.signature) return { kind: 'SIGNATURE_UNAVAILABLE' }
  return { kind: 'AVAILABLE' }
}

export type InsertBlockReason =
  | 'REVIEW_REQUIRED'
  | 'NO_TARGET'
  | 'DEPRECATED'
  | 'SIGNATURE_UNAVAILABLE'
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
  entry: Pick<ProgrammingLibraryEntry, 'featureState' | 'libraryState' | 'signature'>,
  hasTarget: boolean,
): InsertBlockReason {
  const usability = libraryUsability(entry)
  if (usability.kind !== 'AVAILABLE') return usability.kind
  if (!hasTarget) return 'NO_TARGET'
  return null
}

/**
 * `T61-203` — ĐỊNH DANH của một khối, ổn định QUA MỌI VERSION.
 *
 * `entryId` một mình không đủ: `GET /libraries` trả mọi library revision của
 * Project (DRAFT + PUBLISHED + DEPRECATED — xem `model/library.ts`), nên cùng
 * một `entryId` về nhiều lần với `libraryVersion` khác nhau. Một `Map` khoá
 * bằng `entryId` trần sẽ giữ lại bản GẶP SAU CÙNG, tức một version tuỳ ý —
 * và đó chính là cách Yêu thích của Quick Library trỏ vào một revision đã
 * `DEPRECATED` sau lần publish kế tiếp.
 *
 * Khoá gồm `scope` vì hai phạm vi có không gian tên riêng: `entryId` của
 * SYSTEM là tên khối (`TON`), của PROJECT là UUID. Dựa vào "chúng không thể
 * trùng nhau" là đúng cho tới ngày nó không còn đúng, và ngày đó Yêu thích của
 * một Project sẽ nhảy sang khối SYSTEM cùng tên.
 *
 * CỐ Ý không mang `libraryVersion`: Yêu thích/Gần đây phải sống sót qua
 * publish. Khoá theo version nghĩa là mỗi lần Seal Revision là một lần người
 * dùng mất sạch Yêu thích.
 */
export function libraryEntryKey(
  entry: Pick<ProgrammingLibraryEntry, 'scope' | 'entryId'>,
): string {
  return `${entry.scope}/${entry.entryId}`
}

/**
 * `T61-203` — MỘT mô hình trình bày cho cả PGM-04 và Quick Library.
 *
 * Trước lát này có hai. Không phải hai bản sao — hai mô hình **khác nhau**, và
 * chúng bất đồng ở đúng những chỗ đắt nhất:
 *
 * | Trường | PGM-04 | Quick Library (bản cũ) |
 * |---|---|---|
 * | `category` | `entry.category` (trường công khai, `T61-101`) | `signature.category`, thiếu thì `'other'` |
 * | chữ ký | chỉ `entry.signature`; vắng thì NÓI RA | vắng thì tự parse `entry.interface` |
 * | `DEPRECATED` | chặn chèn | không biết tới |
 * | thẻ, tương thích | có | không có |
 *
 * Ba hàng đầu đều là "cùng một khối, hai câu trả lời". Hàng chữ ký là hàng
 * nguy hiểm nhất: chữ ký quyết định người dùng nối dây vào chân nào, và khi
 * hai bề mặt đoán khác nhau thì không ai có cách biết bên nào đúng.
 *
 * Mô hình này thuần dữ liệu (không React, không `pick`): nhãn đa ngữ được suy
 * ở lớp vẽ bằng `categoryLabel`/`scopeLabel`, để kiểm nó không cần dựng cây
 * component.
 */
export interface LibraryPresentation {
  /** `libraryEntryKey` — ổn định qua version. Dùng làm khoá React và khoá tuỳ chọn. */
  key: string
  scope: ProgrammingLibraryEntry['scope']
  entryId: string
  name: string
  kind: ProgrammingLibraryEntry['kind']
  /** `undefined` = mục không ràng buộc ngôn ngữ (đa số SYSTEM entry). */
  language?: 'ST' | 'FBD'
  labelVi: string
  labelEn: string
  /** MÃ phân loại, `null` khi chưa ai phân loại. Nhãn người đọc: `categoryLabel`. */
  category: string | null
  description: string | null
  tags: string[]
  libraryRevisionId: string
  libraryVersion: string
  libraryState: ProgrammingLibraryEntry['libraryState']
  contentSha256: string
  signature: BlockSignatureLine
  ports: readonly ProgrammingLibrarySignaturePort[]
  allowedTypes: readonly string[]
  defaultType?: string
  usability: LibraryUsability
  compatibility: CompatibilityDisplay
  /** `ISS-STED-17` — `null` với POU người dùng định nghĩa. */
  iecClassification: LibraryIecClassification | null
  /** POU dùng chung có trạng thái nội tại: FB phải khai instance trước khi gọi. */
  stateful: boolean
}

export function libraryPresentation(entry: ProgrammingLibraryEntry): LibraryPresentation {
  const signature = entry.signature
  return {
    key: libraryEntryKey(entry),
    scope: entry.scope,
    entryId: entry.entryId,
    name: entry.name,
    kind: entry.kind,
    ...(entry.language ? { language: entry.language } : {}),
    /* Nhãn lấy từ chữ ký ĐÃ PHÂN GIẢI, thiếu thì dùng chính tên khối. KHÔNG
       dựng nhãn từ `interface` thô: xem bảng ở đầu khối chú thích. */
    labelVi: signature?.labelVi ?? entry.name,
    labelEn: signature?.labelEn ?? entry.name,
    /* `entry.category` là trường CÔNG KHAI của hợp đồng (`T61-101`), không
       phải một mảnh nằm trong blob chữ ký. Đọc nó từ chữ ký là đọc một bản
       sao có thể vắng — và bản cũ của Quick Library còn quy cái vắng ấy về
       `'other'`, tức bịa ra một phân loại mà không ai đặt. */
    category: metadataValue(entry.category),
    description: metadataValue(entry.description),
    tags: entryTags(entry),
    libraryRevisionId: entry.libraryRevisionId,
    libraryVersion: entry.libraryVersion,
    libraryState: entry.libraryState,
    contentSha256: entry.contentSha256,
    signature: blockSignatureLine(entry),
    ports: signature?.ports ?? [],
    allowedTypes: signature?.allowedTypes ?? [],
    ...(signature?.defaultType ? { defaultType: signature.defaultType } : {}),
    usability: libraryUsability(entry),
    compatibility: compatibilityDisplay(entry),
    iecClassification: iecClassificationOf(entry.name),
    stateful: entry.kind === 'FUNCTION_BLOCK',
  }
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
