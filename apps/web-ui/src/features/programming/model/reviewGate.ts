import { PROGRAMMING_REVIEW_GATED_FEATURES } from '../api/generated/profile'

/**
 * Trạng thái duyệt HIỆU LỰC của một khối trong registry SYSTEM (Issue #802).
 *
 * `featureState: 'REVIEW_REQUIRED'` của registry là nhãn tĩnh — nó nằm trong
 * danh tính thực thi của entry và không đổi khi khối được duyệt. Việc duyệt là
 * token Controls/Safety trong product profile; Core đọc cùng bảng đó để quyết
 * định Check, và web-api phủ cùng bảng đó lên API thư viện. FE đọc palette FBD
 * từ registry sinh sẵn nên phải phủ ở đây — nếu không, `PID` đã ký token vẫn bị
 * palette FBD từ chối dù Check nhận nó.
 *
 * Fail-closed: chỉ khối có trong bảng VÀ đã duyệt mới thành `AVAILABLE`.
 */
export interface ReviewGateRow {
  readonly featureId: string
  readonly approved: boolean
}

export function isReviewApproved(
  featureId: string,
  table: readonly ReviewGateRow[] = PROGRAMMING_REVIEW_GATED_FEATURES,
): boolean {
  return table.some((row) => row.featureId === featureId && row.approved)
}

export function effectiveFeatureState(
  featureId: string,
  registryState: 'AVAILABLE' | 'REVIEW_REQUIRED',
  table: readonly ReviewGateRow[] = PROGRAMMING_REVIEW_GATED_FEATURES,
): 'AVAILABLE' | 'REVIEW_REQUIRED' {
  if (registryState !== 'REVIEW_REQUIRED') return registryState
  return isReviewApproved(featureId, table) ? 'AVAILABLE' : 'REVIEW_REQUIRED'
}
