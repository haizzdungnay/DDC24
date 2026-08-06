import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Chặn một component lỗi làm trắng TOÀN BỘ ứng dụng.
 *
 * Vì sao cần: React unmount cả cây khi có exception chưa bắt trong lúc render.
 * Ngày 2026-08-06 trên board thật, một trường JSON `null` (`config/state.diff`)
 * làm `ConfigStateBanner` ném TypeError, và vì banner nằm ở layout, người dùng
 * nhận được một **trang đen hoàn toàn** — không tiêu đề, không menu, không một
 * dòng chữ nào giải thích. Với một tủ điều khiển đang vận hành, "màn hình trống"
 * là tình huống tệ nhất: không phân biệt được phần mềm hỏng với mất điện.
 *
 * Ranh giới này giữ lại khung ứng dụng và nói rõ trang nào hỏng, để người vận
 * hành còn điều hướng sang trang khác và còn gửi được thông tin cho kỹ thuật.
 * Nó KHÔNG che lỗi: thông điệp và stack vẫn được ghi ra console.
 */
interface Props {
  children: ReactNode
  /** Nhãn trang, dùng trong thông báo. */
  label?: string
  /** Khoá đổi ⇒ thử render lại (ví dụ khi đổi route). */
  resetKey?: string
}

interface State {
  error: Error | null
}

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Ghi nguyên vẹn ra console: ranh giới này để giữ giao diện dùng được, KHÔNG
    // phải để giấu lỗi khỏi người đang gỡ rối.
    console.error('[RouteErrorBoundary] trang lỗi:', error, info.componentStack)
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div
        role="alert"
        data-testid="route-error-boundary"
        className="rounded-[var(--radius)] border border-[var(--c-danger,#c00)]/40 bg-red-500/5 p-5"
      >
        <h2 className="text-lg font-bold text-[var(--c-danger,#c00)]">
          Trang này gặp lỗi và không hiển thị được
        </h2>
        <p className="mt-2 text-sm text-[var(--c-text)]">
          {this.props.label ? `Trang: ${this.props.label}. ` : ''}
          Các trang khác vẫn dùng được — hãy chọn một mục khác trên menu.
        </p>
        <p className="mt-3 font-mono text-xs text-[var(--c-text-dim)]">
          {error.name}: {error.message}
        </p>
        <button
          type="button"
          className="mt-4 h-9 rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] px-4 text-sm font-semibold"
          onClick={() => this.setState({ error: null })}
        >
          Thử hiển thị lại
        </button>
      </div>
    )
  }
}
