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
    case 'PRG-ERR-POU-KIND-001':
      return pick('Khối chương trình vi phạm quy tắc loại khối, tính thuần hoặc chữ ký.', 'The program organisation unit breaks a kind, purity or signature rule.')
    case 'PRG-ERR-POU-RECURSION-001':
      return pick('Có gọi vòng giữa các khối hoặc phụ thuộc vòng trong thư viện.', 'There is a call cycle between blocks, or a circular library dependency.')
    case 'PRG-ERR-LIB-VERSION-001':
      return pick('Thư viện điều khiển: thiếu khối hoặc lệch phiên bản đã ghim.', 'Control library: missing entry or version mismatch against the pinned version.')
    case 'PRG-ERR-PROGRAM-LIMIT-001':
      return pick('Vượt giới hạn dung lượng của gói (số chương trình hoặc số khối chức năng).', 'The package capacity limit was exceeded (program or function block count).')
    case 'PRG-ERR-SIGNAL-PUBLISHER-001':
      return pick('Tín hiệu công bố phải có đúng một chương trình phát; hãy sửa nguồn phát.', 'A published signal must have exactly one producing program; fix the publisher.')
    case 'PRG-ERR-SIGNAL-FRESHNESS-001':
      return pick('Độ tươi của tín hiệu ngoài khoảng cho phép hoặc không hợp với chu kỳ chương trình phát.', 'Signal freshness is out of range or incompatible with the producing program cycle.')
    case 'PRG-ERR-OUTPUT-OWNER-001':
      return pick('Một đầu ra đang bị nhiều chương trình cùng ghi; mỗi đầu ra chỉ có một chủ sở hữu.', 'One output is written by more than one program; each output has exactly one owner.')
    case 'PRG-ERR-ENABLE-NOT-COMMISSIONED-001':
      return pick('Chương trình chưa được đưa vào vận hành nên chưa thể bật.', 'The program has not been commissioned yet, so it cannot be enabled.')
    case 'PRG-ERR-PROGRAM-STATE-001':
      return pick('Không đổi được trạng thái chương trình: sai trạng thái hiện tại hoặc đã đủ số chương trình được bật.', 'The program state could not be changed: wrong current state, or the enabled-program limit is already reached.')
    case 'PRG-ERR-PID-REVIEW-001':
      return pick('Khối PID chưa được Controls và An toàn phê duyệt; không thể đưa vào vận hành.', 'The PID block is not approved by Controls and Safety; it cannot be commissioned.')
    // ST-WARN-* — Cảnh báo cú pháp/ngữ nghĩa từ trình biên dịch Structured Text (ST_SUBSET_SPEC §12.6)
    case 'ST-WARN-001':
      return pick('Khoảng đặt trước PT của timer nhỏ hơn chu kỳ chạy của Task; ngõ ra có thể kích hoạt muộn hơn dự kiến.', 'Timer preset PT is shorter than the Task cycle time; output may trigger later than expected.')
    case 'ST-WARN-002':
      return pick('Biến đã khai báo nhưng chưa từng được sử dụng trong chương trình.', 'Variable is declared but never used in the program.')
    case 'ST-WARN-003':
      return pick('Ngõ ra VAR_OUTPUT chưa từng được gán giá trị trong chương trình.', 'VAR_OUTPUT is never assigned a value in the program.')
    case 'ST-WARN-004':
      return pick('Ngõ ra của khối chức năng được đọc TRƯỚC khi gọi khối đó trong cùng chu kỳ, nên giá trị đọc được là của chu kỳ trước. Nếu không cố ý, hãy chuyển lời gọi lên trước.', 'A function block output is read BEFORE the block is called in the same cycle, so the value comes from the previous cycle. If this is not intentional, move the call earlier.')
    // T59-814 — Simulation R3. Mỗi câu nói ra ĐIỀU NGƯỜI DÙNG PHẢI LÀM tiếp,
    // vì đó là thứ phân biệt một thông báo hữu ích với một mã lỗi được dịch.
    case 'PRG-SIM-UNSUPPORTED':
      return pick('Thiết bị này chưa hỗ trợ Mô phỏng; cần bản cài đặt có worker mô phỏng tương thích.', 'This controller does not support Simulation; install a build with a compatible simulation worker.')
    case 'PRG-SIM-SAVE-REQUIRED':
      return pick('Hãy lưu và chạy Kiểm tra cho bản nháp trước khi mô phỏng — mô phỏng luôn chạy trên bản đã lưu.', 'Save the draft and run Check before simulating — simulation always runs the saved version.')
    case 'PRG-SIM-FORBIDDEN':
      return pick('Chỉ vai Quản trị mới điều khiển được phiên mô phỏng.', 'Only the admin role can control a simulation session.')
    case 'PRG-SIM-INPUT-NOT-ALLOWED':
      return pick('Biến này không nằm trong danh sách được phép ghi, hoặc giá trị sai kiểu/đơn vị/miền. Giá trị trước đó được giữ nguyên.', 'This variable is not writable in simulation, or the value has the wrong type/unit/range. The previous value is unchanged.')
    case 'PRG-SIM-STALE-SESSION':
      return pick('Phiên mô phỏng đã thay đổi ở nơi khác; hãy tải lại trạng thái phiên rồi thử lại.', 'The simulation session changed elsewhere; reload the session state and retry.')
    case 'PRG-SIM-QUOTA':
      return pick('Đã đạt giới hạn mô phỏng của thiết bị; hãy dừng phiên đang chạy hoặc chờ một lát.', 'The controller simulation limit is reached; stop the running session or wait a moment.')
    case 'PRG-SIM-WORKER-FAILED':
      return pick('Phiên mô phỏng đã dừng do lỗi; chương trình đang chạy trên thiết bị không bị ảnh hưởng.', 'The simulation session failed; the program running on the controller is unaffected.')
    case 'PRG-SIM-EXPIRED':
      return pick('Phiên mô phỏng đã hết hạn; hãy mở phiên mới.', 'The simulation session expired; start a new one.')
    default:
      return pick(`Không thực hiện được thao tác (${code ?? 'không rõ mã lỗi'}).`, `The action could not be completed (${code ?? 'unknown error code'}).`)
  }
}

export function isProgrammingErrorEnvelope(value: unknown): value is { envelope: ProgrammingErrorEnvelope; status: number } {
  return typeof value === 'object' && value !== null && 'envelope' in value && 'status' in value
}
