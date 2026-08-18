/**
 * Xuất "ảnh chụp trạng thái" và "gói chẩn đoán" — `T57-2.21`.
 *
 * VÌ SAO CẦN
 *
 * Điều tra sự cố từ xa hiện phải hướng dẫn người tại chỗ chụp năm màn hình rồi
 * gửi qua tin nhắn: ảnh mất khả năng tìm kiếm, mất số chính xác, và không mang
 * theo phiên bản phần mềm hay mốc thời gian. Một tệp JSON kèm mốc thời gian
 * đính vào phiếu sự cố thì đọc được, so sánh được giữa hai thời điểm, và tự nói
 * ra nó được chụp từ bản nào.
 *
 * LUẬT AN TOÀN
 *
 * Chỉ đóng gói dữ liệu đã hiển thị trên màn hình cho chính vai trò đang đăng
 * nhập. Không đọc thêm endpoint nào, không kèm token, không kèm cấu hình người
 * dùng. Tệp này sẽ được gửi qua email hoặc dán vào ticket — nơi nó thoát khỏi
 * mọi lớp kiểm soát truy cập của sản phẩm.
 */

/** Khoá bị loại khỏi mọi gói xuất, dù nằm ở tầng nào của đối tượng. */
const REDACTED_KEYS = [
  'token', 'accessToken', 'refreshToken', 'authorization',
  'password', 'pw', 'pwBcrypt', 'pw_bcrypt', 'secret', 'apiKey', 'cookie'
]

function isRedactedKey(key: string): boolean {
  const lower = key.toLowerCase()
  return REDACTED_KEYS.some((needle) => lower.includes(needle.toLowerCase()))
}

/**
 * Loại đệ quy mọi khoá nhạy cảm.
 *
 * Duyệt cả cây thay vì chỉ lọc tầng đầu: payload của `health`/`overview` là dữ
 * liệu lồng nhau do backend định hình, và một trường mới thêm ở tầng sâu sẽ lọt
 * qua bộ lọc nông mà không ai nhận ra cho tới khi tệp đã gửi đi.
 */
export function redactSensitive<T>(value: T, seen = new WeakSet<object>()): T {
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, seen)) as unknown as T
  if (value === null || typeof value !== 'object') return value
  // Cấu trúc vòng sẽ làm hàm này chạy vô hạn; JSON cũng không biểu diễn được.
  if (seen.has(value as object)) return '[circular]' as unknown as T
  seen.add(value as object)
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = isRedactedKey(key) ? '[redacted]' : redactSensitive(item, seen)
  }
  return result as unknown as T
}

export interface SnapshotEnvelope {
  kind: 'status-snapshot' | 'diagnostic-bundle'
  capturedAt: string
  webVersion: string
  note: string
  payload: Record<string, unknown>
}

export function buildSnapshot(kind: SnapshotEnvelope['kind'], webVersion: string, payload: Record<string, unknown>): SnapshotEnvelope {
  return {
    kind,
    capturedAt: new Date().toISOString(),
    webVersion: webVersion || 'unknown',
    note: 'Chỉ chứa dữ liệu đã hiển thị trên màn hình cho vai trò đang đăng nhập; các trường nhạy cảm đã bị loại.',
    payload: redactSensitive(payload)
  }
}

/** Tải tệp JSON về máy người dùng. Không gửi đi đâu. */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function snapshotFilename(kind: SnapshotEnvelope['kind']): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  return `${kind}-${stamp}.json`
}
