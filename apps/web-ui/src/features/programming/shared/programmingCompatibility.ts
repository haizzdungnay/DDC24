/**
 * `ISS-STED-19` — SO PHIÊN BẢN NGÔN NGỮ/THƯ VIỆN GIỮA BUNDLE FE VÀ THIẾT BỊ.
 *
 * TRIỆU CHỨNG
 * -----------
 * `PROGRAMMING_LIBRARY_VERSION` và `PROGRAMMING_LIBRARY_REGISTRY_SHA256` được
 * sinh sẵn vào bundle FE từ lâu, nhưng `grep` toàn bộ `src/` (trừ `generated/`)
 * không ra một chỗ nào ĐỌC chúng. Sinh ra rồi bỏ đó không phải là một phép
 * kiểm tra — đó là một phép kiểm tra tưởng đã có.
 *
 * NGUYÊN NHÂN GỐC
 * ---------------
 * Ba phiên bản quyết định "FE và thiết bị có nói cùng một ngôn ngữ không" nằm
 * rải ba nơi (hồ sơ ngôn ngữ ST ở compiler, registry thư viện ở domain, ABI ở
 * profile) và không nơi nào gom lại để so. Hệ quả: một bundle FE cũ vẫn vẽ
 * palette, từ khoá, chữ ký hàm của phiên bản KHÁC với phiên bản thiết bị đang
 * biên dịch. Người dùng soạn một chương trình hợp lệ theo giao diện, rồi Check
 * báo lỗi ở những chỗ họ không hiểu vì sao — hoặc tệ hơn, không báo.
 *
 * CÁCH SỬA
 * --------
 * Thiết bị công bố bộ ba qua `GET /programming/capabilities` → `compatibility`.
 * Module này so bộ ba đó với hằng đã build vào chính bundle này và trả về một
 * phán quyết DUY NHẤT. Lệch ⇒ CHẶN SOẠN THẢO, nêu rõ CẢ HAI phiên bản.
 *
 * BA NGUYÊN TẮC KHÔNG ĐƯỢC PHÁ
 * ----------------------------
 * 1. **Không im lặng.** Lệch phải hiện ra, không được ghi log rồi chạy tiếp.
 * 2. **Không tự hạ cấp.** FE KHÔNG được "quay về chế độ tương thích" bằng cách
 *    giả vờ mình là phiên bản cũ hơn: nó không có palette/từ khoá của phiên bản
 *    đó, nên chỉ đoán được, mà đoán sai ở đây là soạn ra chương trình sai.
 * 3. **Thiếu bằng chứng ≠ khớp.** Không có khối `compatibility` (thiết bị đời
 *    cũ, phản hồi cắt cụt, chưa tải xong) là KHÔNG KIỂM CHỨNG ĐƯỢC ⇒ vẫn chặn.
 */

import {
  PROGRAMMING_LIBRARY_REGISTRY_SHA256,
  PROGRAMMING_LIBRARY_VERSION,
} from '../api/generated/library_registry'
import { PROGRAMMING_PROFILE_ID, PROGRAMMING_TARGET_ABI } from '../api/generated/profile'
import {
  ST_LANGUAGE_PROFILE_SHA256,
  ST_LANGUAGE_PROFILE_VERSION,
} from '../api/generated/stLanguageProfile'
import type { ProgrammingCompatibility } from '../model/types'

/**
 * `PENDING` tách riêng khỏi `UNVERIFIABLE` vì hai thứ này khác nhau về BẢN
 * CHẤT: đang tải là trạng thái tạm và sẽ tự hết; không kiểm chứng được là một
 * kết luận. Gộp chúng lại sẽ khiến màn hình lúc nào cũng nháy một cảnh báo đỏ
 * trong mấy trăm mili-giây đầu, và người dùng học được cách bỏ qua nó — đúng
 * lúc nó cần được đọc thì không ai đọc nữa.
 */
export type CompatibilityState = 'COMPATIBLE' | 'MISMATCH' | 'UNVERIFIABLE' | 'PENDING'

export interface CompatibilityFieldMismatch {
  /** Tên trường theo hợp đồng, để thông báo không phải dịch lại tên. */
  field: string
  /** Nhãn tiếng Việt hiển thị cho người vận hành. */
  label: string
  /** Phiên bản ĐÃ BUILD VÀO bundle FE này. */
  bundle: string
  /** Phiên bản THIẾT BỊ công bố. */
  device: string
}

export interface CompatibilityVerdict {
  state: CompatibilityState
  /** Có được phép soạn thảo không. Chỉ `COMPATIBLE` mới cho phép. */
  editingAllowed: boolean
  /** Danh sách trường lệch, rỗng khi khớp hoặc khi không kiểm chứng được. */
  mismatches: CompatibilityFieldMismatch[]
  /** Lý do đọc được, luôn nêu CẢ HAI phía khi lệch. */
  reason: string
}

/** Bộ ba đã build vào bundle này — nguồn duy nhất, không chép tay lần hai. */
export const BUNDLE_COMPATIBILITY: ProgrammingCompatibility = {
  stLanguageProfileVersion: ST_LANGUAGE_PROFILE_VERSION,
  stLanguageProfileSha256: ST_LANGUAGE_PROFILE_SHA256,
  libraryRegistryVersion: PROGRAMMING_LIBRARY_VERSION,
  libraryRegistrySha256: PROGRAMMING_LIBRARY_REGISTRY_SHA256,
  compilerProfileId: PROGRAMMING_PROFILE_ID,
  targetAbi: PROGRAMMING_TARGET_ABI,
}

interface ComparedField {
  field: keyof ProgrammingCompatibility
  label: string
}

/**
 * Thứ tự ở đây là thứ tự hiển thị, và nó có chủ ý: phiên bản người vận hành
 * đọc được (`rev-a.3`, `1.0.0`) đứng trước băm 64 ký tự. Một thông báo mở đầu
 * bằng hai chuỗi hex khác nhau ở ký tự thứ 41 thì không ai đọc.
 */
const COMPARED_FIELDS: ComparedField[] = [
  { field: 'stLanguageProfileVersion', label: 'Hồ sơ ngôn ngữ ST' },
  { field: 'libraryRegistryVersion', label: 'Thư viện POU' },
  { field: 'compilerProfileId', label: 'Hồ sơ biên dịch' },
  { field: 'targetAbi', label: 'ABI đích' },
  { field: 'stLanguageProfileSha256', label: 'Chữ ký hồ sơ ngôn ngữ ST' },
  { field: 'libraryRegistrySha256', label: 'Chữ ký registry thư viện' },
]

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

/**
 * So bộ ba của thiết bị với bộ ba đã build vào bundle này.
 *
 * @param device khối `capabilities.compatibility`. Nhận `undefined`/`null` có
 *   chủ ý: TypeScript khai nó required theo hợp đồng, nhưng một thiết bị đời cũ
 *   vẫn có thể trả về phản hồi thiếu khối này, và lúc đó phán quyết phải là
 *   `UNVERIFIABLE` chứ KHÔNG phải một `undefined === undefined` âm thầm khớp.
 * @param pending `true` khi truy vấn capabilities còn đang chạy.
 */
export function programmingCompatibility(
  device: ProgrammingCompatibility | null | undefined,
  pending = false,
): CompatibilityVerdict {
  if (pending) {
    return {
      state: 'PENDING',
      editingAllowed: false,
      mismatches: [],
      reason: 'Đang đọc phiên bản ngôn ngữ/thư viện của thiết bị.',
    }
  }
  if (device === null || device === undefined) {
    return {
      state: 'UNVERIFIABLE',
      editingAllowed: false,
      mismatches: [],
      reason:
        'Thiết bị không công bố phiên bản ngôn ngữ/thư viện, nên không kiểm chứng được ' +
        `bundle này (hồ sơ ngôn ngữ ST ${BUNDLE_COMPATIBILITY.stLanguageProfileVersion}, ` +
        `thư viện POU ${BUNDLE_COMPATIBILITY.libraryRegistryVersion}) có khớp không. ` +
        'Soạn thảo bị chặn: thiếu bằng chứng không phải là bằng chứng khớp.',
    }
  }

  const missing = COMPARED_FIELDS.filter((entry) => isBlank(device[entry.field]))
  if (missing.length > 0) {
    return {
      state: 'UNVERIFIABLE',
      editingAllowed: false,
      mismatches: [],
      reason:
        'Thiết bị công bố thiếu trường ' +
        missing.map((entry) => `${entry.label} (${entry.field})`).join(', ') +
        ', nên không kiểm chứng được phiên bản. Soạn thảo bị chặn.',
    }
  }

  const mismatches: CompatibilityFieldMismatch[] = []
  for (const entry of COMPARED_FIELDS) {
    const bundle = BUNDLE_COMPATIBILITY[entry.field]
    const remote = device[entry.field]
    if (String(bundle) !== String(remote)) {
      mismatches.push({
        field: entry.field,
        label: entry.label,
        bundle: String(bundle),
        device: String(remote),
      })
    }
  }

  if (mismatches.length === 0) {
    return {
      state: 'COMPATIBLE',
      editingAllowed: true,
      mismatches: [],
      reason:
        `Giao diện và thiết bị cùng hồ sơ ngôn ngữ ST ${BUNDLE_COMPATIBILITY.stLanguageProfileVersion}, ` +
        `thư viện POU ${BUNDLE_COMPATIBILITY.libraryRegistryVersion}.`,
    }
  }

  return {
    state: 'MISMATCH',
    editingAllowed: false,
    mismatches,
    reason:
      'Lệch phiên bản giữa giao diện và thiết bị: ' +
      mismatches
        .map((item) => `${item.label} — giao diện ${item.bundle}, thiết bị ${item.device}`)
        .join('; ') +
      '. Soạn thảo bị chặn cho tới khi nạp lại đúng bản giao diện của thiết bị; ' +
      'giao diện KHÔNG tự hạ cấp về phiên bản cũ hơn.',
  }
}
