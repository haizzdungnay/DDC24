import { pageHidden } from './useApi'

/**
 * `startVisibleInterval` — `setInterval` cho vòng poll, nhưng KHÔNG chạy khi
 * tab ẩn (T63-108, PERF-API-03).
 *
 * Dành cho các vòng poll tự viết bằng `setInterval` (Programming, Frame
 * Monitor…) không đi qua `useApi`/`useSharedPoll`. Hiện lại ⇒ chạy bù NGAY nếu
 * lượt gần nhất đã cũ hơn một nhịp, để màn hình không đứng ở số cũ thêm một
 * nhịp nữa sau khi người dùng quay lại.
 *
 * Trả về hàm dọn dẹp để gọi trong cleanup của effect.
 */
export function startVisibleInterval(tick: () => void, intervalMs: number): () => void {
  let lastRunAt = Date.now()
  const runVisible = () => {
    if (pageHidden()) return
    lastRunAt = Date.now()
    tick()
  }
  const catchUp = () => {
    if (!pageHidden() && Date.now() - lastRunAt >= intervalMs) runVisible()
  }
  const timer = window.setInterval(runVisible, intervalMs)
  document.addEventListener('visibilitychange', catchUp)
  return () => {
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', catchUp)
  }
}
