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
    case 'PRG-ERR-POU-001':
      return pick('Khối chương trình vi phạm quy tắc (kiểu khối, tính thuần, gọi đệ quy hoặc trạng thái).', 'The program organisation unit breaks a rule (kind, purity, recursion or state).')
    case 'PRG-ERR-LIBRARY-001':
      return pick('Thư viện điều khiển: thiếu khối, lệch phiên bản hoặc phụ thuộc vòng.', 'Control library: missing entry, version mismatch or circular dependency.')
    case 'PRG-ERR-SIGNAL-001':
      return pick('Tín hiệu công bố không hợp lệ (trùng nguồn phát, sai kiểu hoặc độ tươi ngoài khoảng).', 'Published signal is invalid (duplicate publisher, wrong type or freshness out of range).')
    case 'PRG-ERR-OUTPUT-OWNER-001':
      return pick('Một đầu ra đang bị nhiều chương trình cùng ghi; mỗi đầu ra chỉ có một chủ sở hữu.', 'One output is written by more than one program; each output has exactly one owner.')
    case 'PRG-ERR-ENABLE-001':
      return pick('Không bật/tắt được chương trình: sai điều kiện hoặc vượt số chương trình được bật.', 'The program could not be enabled or disabled: precondition failed or the enabled-program limit was reached.')
    case 'PRG-ERR-PID-REVIEW-001':
      return pick('Khối PID chưa được Controls và An toàn phê duyệt; không thể đưa vào vận hành.', 'The PID block is not approved by Controls and Safety; it cannot be commissioned.')
    default:
      return pick(`Không thực hiện được thao tác (${code ?? 'không rõ mã lỗi'}).`, `The action could not be completed (${code ?? 'unknown error code'}).`)
  }
}

export function isProgrammingErrorEnvelope(value: unknown): value is { envelope: ProgrammingErrorEnvelope; status: number } {
  return typeof value === 'object' && value !== null && 'envelope' in value && 'status' in value
}
