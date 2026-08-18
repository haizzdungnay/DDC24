/**
 * Lỗi đăng nhập có PHÂN LOẠI — `T57-1.10`, đề xuất §6.18-P2a.
 *
 * ## Vì sao ở module riêng chứ không nằm trong `AuthProvider`
 *
 * `AuthProvider` là module bị `vi.mock` trong hầu hết test có dựng trang đăng
 * nhập. Đặt một **lớp runtime** ở đó nghĩa là mọi test mock module ấy sẽ nhận
 * `LoginError === undefined`, và `err instanceof LoginError` ném
 * `TypeError: Right-hand side of 'instanceof' is not callable` — một lỗi nuốt
 * mất luồng xử lý lỗi thật, ngay tại chỗ đang xử lý lỗi.
 *
 * Đây không phải chuyện chiều test: cùng một cái bẫy sẽ nổ ở bất kỳ nơi nào
 * nạp `LoginPage` mà không nạp toàn bộ provider (lazy route, storybook, e2e
 * component test). Một kiểu lỗi thuần không nên kéo theo cả một React context.
 *
 * ## Ba loại, và không có loại thứ tư
 *
 * | Loại | Bằng chứng phân biệt được | Hành động của người dùng |
 * |---|---|---|
 * | `credentials` | HTTP `401`/`403` | gõ lại, kiểm Caps Lock, nhờ admin đặt lại |
 * | `unreachable` | `fetch` bị từ chối, KHÔNG có mã HTTP | kiểm mạng/nguồn thiết bị |
 * | `server` | HTTP `5xx` hoặc lỗi lạ | xem nhật ký dịch vụ web |
 *
 * **Không** có loại "tài khoản bị khoá": backend không hiện thực khoá tài khoản
 * sau N lần sai (`ADR-037` điều 4). Hiện một trạng thái không tồn tại là bịa —
 * cùng lớp lỗi với bốn badge `online` giả từng nằm trên chính trang đăng nhập
 * (WEB-UX-002).
 *
 * Cũng **không** tách `credentials` thành "sai tên" và "sai mật khẩu": backend
 * cố ý trả cùng một `401 invalid credentials` cho cả hai
 * (`AuthService.Authenticate`), và đó là hành vi ĐÚNG chống dò tài khoản.
 */
export type LoginErrorKind = 'credentials' | 'unreachable' | 'server'

export class LoginError extends Error {
  constructor(readonly kind: LoginErrorKind, message: string) {
    super(message)
    this.name = 'LoginError'
  }
}
