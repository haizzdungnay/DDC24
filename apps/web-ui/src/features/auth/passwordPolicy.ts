/**
 * Chính sách mật khẩu hiển thị trên giao diện — `T57-1.9`, thi hành `ADR-037`.
 *
 * ## Luật thật của thiết bị, đọc từ mã chứ không từ tài liệu
 *
 * `apps/web-api/internal/auth/service.go`:
 *
 * ```go
 * func validNewPassword(password string) bool {
 * 	return len(password) >= 6
 * }
 * ```
 *
 * Đó là **toàn bộ** chính sách đang được cưỡng chế. Không có lớp ký tự bắt
 * buộc, không có danh sách chặn, và **không có khoá tài khoản sau N lần sai**.
 *
 * ## Vì sao giao diện KHÔNG siết lên 8 ký tự
 *
 * Nghe có vẻ "chặt hơn thì cứ làm", nhưng nó làm giao diện **mô tả sai thiết
 * bị**: màn hình bảo "tối thiểu 8", trong khi cùng cái bo đó chấp nhận mật khẩu
 * 6 ký tự qua bất kỳ client nào khác. Trong repository này, giao diện nói sai
 * về thiết bị là lỗi nặng hơn một chính sách yếu.
 *
 * Chính sách đích (min 8, chặn giá trị tầm thường, khoá 5 lần sai/15 phút) là
 * thay đổi Go + hợp đồng lỗi, đã quyết ở `ADR-037` điều 3 và giao cho `T57-3.21`.
 *
 * ## Đơn vị đếm: byte, không phải ký tự
 *
 * `len()` của Go đếm **byte**; `String.length` của JavaScript đếm đơn vị UTF-16.
 * Với mật khẩu có dấu tiếng Việt, số byte LỚN HƠN số ký tự — nên một luật `>= 6`
 * kiểm ở FE theo `.length` luôn **chặt hơn hoặc bằng** backend. Chiều lệch này
 * an toàn (FE không bao giờ lỏng hơn), nhưng phải biết là nó tồn tại.
 */

/** Độ dài tối thiểu ĐANG ĐƯỢC CƯỠNG CHẾ trên thiết bị.
 *
 *  Đổi số này mà không đổi `validNewPassword` trong Go là làm giao diện nói dối
 *  về thiết bị. Hai chỗ phải đổi cùng nhau. */
export const ENFORCED_MIN_PASSWORD_LENGTH = 6

/** Độ dài KHUYẾN NGHỊ — mục tiêu của `ADR-037` điều 3, chưa được cưỡng chế. */
export const RECOMMENDED_MIN_PASSWORD_LENGTH = 8

/** Danh sách ngắn các mật khẩu tầm thường. Cố ý NGẮN: đây là chỉ báo khuyến
 *  nghị chạy trên trình duyệt của một thiết bị nhúng, không phải một bộ lọc
 *  đầy đủ. Bộ lọc thật phải nằm ở backend (`T57-3.21`). */
const TRIVIAL_PASSWORDS = new Set([
  '123456', '1234567', '12345678', '123456789', 'password', 'admin123',
  'qwerty', 'abc123', 'admin', 'mkddc', 'ddc24', '111111', '000000', 'letmein'
])

export type PasswordStrength = 'unusable' | 'weak' | 'fair' | 'strong'

export interface PasswordAssessment {
  /** Có qua được luật mà THIẾT BỊ đang cưỡng chế không. Đây là thứ duy nhất
   *  được phép chặn nút Tạo/Đặt lại. */
  meetsEnforced: boolean
  /** Mức khuyến nghị — **không** chặn gì. */
  strength: PasswordStrength
  /** Các điểm cần cải thiện, theo thứ tự ảnh hưởng giảm dần. */
  advice: string[]
}

/**
 * Đánh giá mật khẩu.
 *
 * `username` được truyền vào để bắt trường hợp mật khẩu trùng tên đăng nhập —
 * lỗi phổ biến nhất và cũng dễ đoán nhất trên thiết bị hiện trường.
 *
 * Hàm này **thuần** và không chặn gì: nơi gọi dùng `meetsEnforced` để chặn, còn
 * `strength`/`advice` chỉ để hiển thị.
 */
export function assessPassword(password: string, username = ''): PasswordAssessment {
  const advice: string[] = []
  const meetsEnforced = password.length >= ENFORCED_MIN_PASSWORD_LENGTH

  if (!meetsEnforced) {
    return {
      meetsEnforced: false,
      strength: 'unusable',
      advice: [`Cần tối thiểu ${ENFORCED_MIN_PASSWORD_LENGTH} ký tự — đây là luật thiết bị đang cưỡng chế.`]
    }
  }

  const lower = password.toLowerCase()
  const trivial = TRIVIAL_PASSWORDS.has(lower)
  const sameAsUsername = username.trim() !== '' && lower === username.trim().toLowerCase()

  if (sameAsUsername) advice.push('Mật khẩu trùng tên đăng nhập — đây là giá trị bị thử đầu tiên trong mọi cuộc dò.')
  if (trivial) advice.push('Mật khẩu nằm trong danh sách các giá trị bị thử phổ biến nhất.')
  if (password.length < RECOMMENDED_MIN_PASSWORD_LENGTH) {
    advice.push(`Khuyến nghị từ ${RECOMMENDED_MIN_PASSWORD_LENGTH} ký tự trở lên.`)
  }

  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length
  if (classes < 3) advice.push('Khuyến nghị trộn ít nhất ba nhóm: chữ thường, chữ hoa, chữ số, ký tự đặc biệt.')

  let strength: PasswordStrength
  if (sameAsUsername || trivial) {
    strength = 'weak'
  } else if (password.length >= 12 && classes >= 3) {
    strength = 'strong'
  } else if (password.length >= RECOMMENDED_MIN_PASSWORD_LENGTH && classes >= 2) {
    strength = 'fair'
  } else {
    strength = 'weak'
  }

  return { meetsEnforced: true, strength, advice }
}
