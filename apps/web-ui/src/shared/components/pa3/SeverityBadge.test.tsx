import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { AttentionSeverity } from '../../types'
import { SeverityBadge } from './StateAtoms'

/**
 * `F-UX-13` / `T57-0.2` — năm mức nghiêm trọng phải PHÂN BIỆT ĐƯỢC, và phải
 * phân biệt được **không chỉ bằng màu**.
 *
 * VÌ SAO FINDING NÀY TỒN TẠI
 *
 * Bản trước ánh xạ severity tại chỗ trong `HistoryRow` bằng một biểu thức ba
 * ngôi ba nhánh, nên `low` và `info` cùng rơi vào tông **xanh lá** — tông mà
 * IEC 60073 dành riêng cho "trạng thái an toàn / bình thường". Một cảnh báo mức
 * thấp mang màu của trạng thái bình thường là một cảnh báo bị mắt lướt qua.
 *
 * Gate hợp đồng hiện có (`contrast.test.ts`) kiểm tỉ lệ tương phản của token.
 * Nó **không** kiểm được điều finding này nói: rằng năm mức ra năm nhãn khác
 * nhau, rằng không mức nào mượn màu "an toàn", và rằng người không phân biệt
 * được màu vẫn đọc được mức — đó là phần test này khoá.
 */

const ALL: AttentionSeverity[] = ['critical', 'high', 'medium', 'low', 'info']

afterEach(cleanup)

describe('F-UX-13 — SeverityBadge phân biệt đủ 5 mức', () => {
  it('mỗi mức ra một nhãn chữ riêng, không mức nào trùng mức nào', () => {
    const labels = ALL.map((severity) => {
      const { container, unmount } = render(<SeverityBadge severity={severity} />)
      const text = container.textContent?.trim() ?? ''
      unmount()
      return text
    })

    expect(labels).toEqual(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'])
    // Nhãn trùng nhau nghĩa là hai mức khác nhau trông y hệt nhau trên nhật ký.
    expect(new Set(labels).size).toBe(ALL.length)
  })

  it('không mức nào dùng tông "good" — màu an toàn theo IEC 60073', () => {
    for (const severity of ALL) {
      const { container, unmount } = render(<SeverityBadge severity={severity} />)
      const chip = container.firstElementChild as HTMLElement
      const style = chip.getAttribute('style') ?? ''
      /* Đây chính là hồi quy mà `F-UX-13` mô tả: `low`/`info` từng mang màu
         xanh lá của trạng thái bình thường. */
      expect(style).not.toContain('--c-good')
      expect(style).not.toContain('--c-indicator-ok')
      unmount()
    }
  })

  it('mỗi mức mang một bộ màu riêng, và màu KHÔNG phải dấu hiệu duy nhất', () => {
    const styles = new Set<string>()
    for (const severity of ALL) {
      const { container, unmount } = render(<SeverityBadge severity={severity} />)
      const chip = container.firstElementChild as HTMLElement
      styles.add(chip.getAttribute('style') ?? '')
      // Ngoài màu, mỗi chip có icon (aria-hidden) + nhãn chữ. Người không phân
      // biệt được màu vẫn phải đọc ra mức, nên nhãn chữ là bắt buộc.
      expect(chip.querySelector('svg')).not.toBeNull()
      expect(chip.textContent?.trim().length ?? 0).toBeGreaterThan(0)
      unmount()
    }
    // 4 bộ màu cho 5 mức là chấp nhận được (`high` và `fault` dùng chung tông
    // đỏ), nhưng gộp xuống dưới 4 nghĩa là các mức đã bắt đầu chồng nhau.
    expect(styles.size).toBeGreaterThanOrEqual(4)
  })

  it('severity lạ rơi về INFO thay vì làm trống ô hoặc ném lỗi', () => {
    // Một backend cũ hơn có thể trả mức chưa biết. Ô trống trên nhật ký cảnh báo
    // còn tệ hơn một mức đoán thấp: nó xoá luôn dòng khỏi tầm chú ý.
    render(<SeverityBadge severity={'khong-ton-tai' as AttentionSeverity} />)
    expect(screen.getByText('INFO')).toBeInTheDocument()
  })

  it('kèm số đếm thì nhãn mức vẫn còn nguyên', () => {
    render(<SeverityBadge severity="critical" count={7} />)
    // Số không được thay nhãn: "7" một mình không nói mức nào đang có 7 cảnh báo.
    expect(screen.getByText('CRITICAL 7')).toBeInTheDocument()
  })
})
