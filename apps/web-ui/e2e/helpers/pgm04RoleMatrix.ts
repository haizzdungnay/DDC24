import { PROGRAMMING_ENDPOINTS } from '../../src/features/programming/api/generated/client'

/**
 * `T61-503` / `ISS-PGM04-16` — ma trận bốn vai cho PGM-04, ở dạng MÁY ĐỌC ĐƯỢC.
 *
 * ## Vì sao trước lát này không có ma trận nào
 *
 * `build:e2e` đặt `VITE_AUTH_MODE=mock`, và nhánh mock của `AuthProvider` dựng
 * phiên `role: 'admin'` **viết cứng**, bất kể ai đăng nhập. Nên lane e2e không
 * có đường nào dựng một phiên viewer hay operator, và `programming.spec.ts` đã
 * phải ghi thẳng vào mã rằng "ma trận RBAC không kiểm được ở tầng này". Một cổng
 * chỉ chạy vai mạnh nhất không phát hiện được đúng lớp lỗi mà RBAC sinh ra để
 * chặn: một nút ghi bật lên cho người không có quyền ghi.
 *
 * ## Vì sao kỳ vọng được SUY TỪ HỢP ĐỒNG, không viết tay
 *
 * `PROGRAMMING_ENDPOINTS` là bảng **sinh từ `openapi.yaml`**: nó mang đúng danh
 * sách vai mà MÁY CHỦ cho phép trên từng operation. Viết tay `engineer: true` ở
 * đây sẽ tạo ra một bản sao thứ hai của cùng một luật, và hai bản sao thì lệch
 * nhau trong im lặng — đúng lớp lỗi mà cả tệp này sinh ra để bắt. Tệ hơn: nếu ai
 * đó siết cổng FE mà cũng sửa luôn ma trận, test vẫn xanh và không ai biết giao
 * diện vừa chặn một thao tác máy chủ chấp nhận (`T61-201` đã phải sửa đúng lỗi
 * ấy ở đường RBAC).
 *
 * Vì vậy kỳ vọng ghi-thư-viện đọc thẳng `roles` của `upsertProgrammingLibraryEntry`.
 */
export const PGM04_ROLES = ['viewer', 'operator', 'engineer', 'admin'] as const
export type Pgm04Role = (typeof PGM04_ROLES)[number]

function rolesAllowedBy(operationId: keyof typeof PROGRAMMING_ENDPOINTS): ReadonlySet<string> {
  const endpoint = PROGRAMMING_ENDPOINTS[operationId] as { roles: readonly string[] } | undefined
  if (!endpoint) throw new Error(`operation không có trong hợp đồng: ${String(operationId)}`)
  return new Set(endpoint.roles)
}

const LIBRARY_WRITE_ROLES = rolesAllowedBy('upsertProgrammingLibraryEntry')
const LIBRARY_READ_ROLES = rolesAllowedBy('listProgrammingLibraryUsages')

export interface Pgm04RoleExpectation {
  role: Pgm04Role
  /** Đọc được danh sách khối. Mọi vai đều đọc được — PGM-04 không có bí mật. */
  canRead: boolean
  /** Tạo / Sửa / Xoá / Ngừng sử dụng. Suy TỪ HỢP ĐỒNG, không viết tay. */
  canWriteLibrary: boolean
  /**
   * Chèn vào POU. **Không** phải một quyền ghi: PGM-04 chỉ ĐIỀU HƯỚNG
   * (`AUTH-PROG-2026-08-29-PGM04-003`), phép ghi và bước Hoàn tác thuộc PGM-02.
   * Nên nó mở cho mọi vai, và cổng ghi thật nằm ở màn hình bên kia. Ghi rõ ở
   * đây vì "Chèn bật cho viewer" trông như một lỗ hổng nếu không đọc câu này.
   */
  canNavigateInsert: boolean
  /** Câu lý do PHẢI hiện cạnh nút ghi bị khoá. `null` khi không có nút nào khoá. */
  writeBlockReason: RegExp | null
}

export const PGM04_ROLE_MATRIX: readonly Pgm04RoleExpectation[] = PGM04_ROLES.map((role) => {
  const canWriteLibrary = LIBRARY_WRITE_ROLES.has(role)
  return {
    role,
    canRead: LIBRARY_READ_ROLES.has(role),
    canWriteLibrary,
    canNavigateInsert: true,
    writeBlockReason: canWriteLibrary ? null : /Vai hiện tại không sửa được Thư viện điều khiển/,
  }
})

/**
 * Neo chống-tautology: hợp đồng phải THẬT SỰ phân biệt bốn vai.
 *
 * Nếu một ngày `roles` của mọi operation thành `["viewer","operator","engineer",
 * "admin"]` thì mọi kỳ vọng ở trên hoá `true` và ma trận vẫn "xanh" trong khi nó
 * không còn kiểm gì. Hàm này bắt buộc bảng phải chia đôi bốn vai — đúng hình
 * dạng mà `openapi.yaml` đang khai — nên một hợp đồng bị nới lỏng sẽ làm ĐỎ ở
 * đây chứ không im lặng làm rỗng phép kiểm.
 */
export function assertMatrixDiscriminates(): void {
  const writers = PGM04_ROLE_MATRIX.filter((row) => row.canWriteLibrary).map((row) => row.role)
  const readers = PGM04_ROLE_MATRIX.filter((row) => row.canRead).map((row) => row.role)
  if (writers.length === 0 || writers.length === PGM04_ROLES.length) {
    throw new Error(`ma trận không phân biệt được vai ghi: ${writers.join(',')}`)
  }
  if (readers.length !== PGM04_ROLES.length) {
    throw new Error(`PGM-04 phải đọc được với mọi vai; hiện: ${readers.join(',')}`)
  }
}
