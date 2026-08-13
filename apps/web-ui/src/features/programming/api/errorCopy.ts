import type { ProgrammingErrorCode } from './generated'
import type { ProgrammingErrorEnvelope } from './generated/client'

/**
 * Chuẩn hoá `PRG-ERR-*` → chữ hiển thị VI/EN. FE quyết định hành vi bằng
 * `code`, KHÔNG BAO GIỜ parse `message` của server (IFSPEC-PROG-001 §1). Hàm
 * này chỉ phục vụ hiển thị; nó không thay đổi luồng điều khiển.
 */
export function programmingErrorCopy(
  pick: (vi: string, en: string) => string,
  code: ProgrammingErrorCode | string | undefined
): string {
  switch (code) {
    case 'PRG-ERR-REQ-001':
      return pick('Yêu cầu không hợp lệ.', 'The request is invalid.')
    case 'PRG-ERR-NOT-FOUND-001':
      return pick('Không tìm thấy đối tượng.', 'The object was not found.')
    case 'PRG-ERR-CONFLICT-001':
      return pick('Bản nháp đã thay đổi ở phiên khác; hãy tải lại hoặc hợp nhất.', 'The draft changed in another session; reload or merge.')
    case 'PRG-ERR-SCOPE-001':
      return pick('Giá trị ngoài phạm vi Rev A.', 'Value is outside the Rev A scope.')
    case 'PRG-ERR-MAP-003':
      return pick('Ánh xạ Điểm không hợp lệ (identity/hướng/khả năng ghi).', 'Invalid point mapping (identity/direction/writable).')
    case 'PRG-ERR-MAP-004':
      return pick('Kiểu dữ liệu hoặc đơn vị không tương thích.', 'Incompatible data type or unit.')
    case 'PRG-ERR-CHECK-001':
      return pick('Kiểm tra thất bại hoặc quá thời gian.', 'Check failed or timed out.')
    case 'PRG-ERR-ARTIFACT-001':
      return pick('Gói biên dịch không hợp lệ; bản đang chạy được giữ nguyên.', 'The build artifact is invalid; the running version is unchanged.')
    case 'PRG-ERR-TARGET-001':
      return pick('Không khớp target/controller.', 'Target/controller mismatch.')
    case 'PRG-ERR-CUTOVER-001':
      return pick('Đang có chuyển quyền điều khiển khác; thử lại sau khi đối chiếu.', 'Another cutover is in progress; retry after reconciling.')
    case 'PRG-ERR-RETAIN-001':
      return pick('Trạng thái lưu (RETAIN) không tương thích; cần xác nhận khởi tạo lại.', 'Stored state (RETAIN) is incompatible; re-initialisation acknowledgement is required.')
    case 'PRG-ERR-OP-001':
      return pick('Đang có một thao tác khác chạy cho controller này.', 'Another operation is already running for this controller.')
    case 'PRG-ERR-COM-001':
      return pick('Đưa vào vận hành thất bại. Phiên bản đang chạy không đổi.', 'Commission failed. The running version is unchanged.')
    case 'PRG-ERR-RESTORE-001':
      return pick('Khôi phục thất bại. Phiên bản đang chạy không đổi.', 'Restore failed. The running version is unchanged.')
    case 'PRG-ERR-IMPORT-001':
      return pick('Gói nhập không hợp lệ hoặc chứa nội dung bị cấm.', 'The import bundle is invalid or contains disallowed content.')
    case 'PRG-ERR-ACK-MISSING-001':
      return pick('Còn thiếu ô xác nhận cho ảnh hưởng có thật.', 'A required acknowledgement for a real impact is missing.')
    case 'PRG-ERR-ACK-UNEXPECTED-001':
      return pick('Có ô xác nhận thừa cho một nhóm không có ảnh hưởng.', 'An acknowledgement was sent for a group with no impact.')
    case 'PRG-ERR-IMPACT-UNAVAILABLE-001':
      return pick('Chưa tính được ảnh hưởng — thao tác bị chặn.', 'Impact could not be computed — the action is blocked.')
    case 'PRG-ERR-IMPACT-STALE-001':
      return pick('Ảnh hưởng đã đổi kể từ lúc đọc; hãy tải lại và xác nhận lại.', 'Impact changed since it was last read; reload and re-confirm.')
    case 'PRG-ERR-UNAVAILABLE-001':
      return pick('Tính năng tạm thời chưa sẵn sàng.', 'This capability is temporarily unavailable.')
    default:
      return pick(`Không thực hiện được thao tác (${code ?? 'không rõ mã lỗi'}).`, `The action could not be completed (${code ?? 'unknown error code'}).`)
  }
}

export function isProgrammingErrorEnvelope(value: unknown): value is { envelope: ProgrammingErrorEnvelope; status: number } {
  return typeof value === 'object' && value !== null && 'envelope' in value && 'status' in value
}
