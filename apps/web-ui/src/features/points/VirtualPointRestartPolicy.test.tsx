import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../shared/i18n'
import type { VirtualPoint } from '../../shared/types'
import { RestartPolicyField } from './VirtualIoPage'

/**
 * ISS-PIO-14 — chính sách giá trị sau khởi động lại (đề bài §13).
 *
 * Trước bản vá, `value` gánh HAI nghĩa: giá trị khởi tạo do người dùng đặt, và
 * giá trị hiện hành do lệnh ghi cập nhật. Người dùng đặt 20 làm mặc định, một
 * kỹ thuật viên ép 35 để thử, và số 20 biến mất khỏi cấu hình vĩnh viễn.
 */

const base: VirtualPoint = {
  id: 'VP1', tag: 'sp', label: 'Setpoint', signalType: 'float',
  enabled: true, writable: true, logEnabled: false, value: 35
}

function renderFields(item: VirtualPoint, onChange = vi.fn()) {
  render(<I18nProvider><RestartPolicyField item={item} onChange={onChange} /></I18nProvider>)
  return onChange
}

afterEach(cleanup)

describe('ISS-PIO-14 — chính sách khởi động lại của Virtual Point', () => {
  it('mặc định là giữ giá trị cuối — hành vi cũ, không được đổi ngầm', () => {
    renderFields(base)
    const select = screen.getByLabelText(/Restart policy for VP1/i) as HTMLSelectElement
    expect(select.value).toBe('retain')
  })

  it('chọn "về giá trị khởi tạo" phát ra restartPolicy', async () => {
    const user = userEvent.setup()
    const onChange = renderFields(base)
    await user.selectOptions(screen.getByLabelText(/Restart policy for VP1/i), 'initial')
    expect(onChange).toHaveBeenCalledWith({ restartPolicy: 'initial' })
  })

  /* Ô "giá trị khởi tạo" CHỈ hiện khi chọn `initial`. Ở chế độ `retain` không có
     giá trị khởi tạo nào được dùng, và một ô nhập không ai đọc là một lời hứa
     suông — đúng lớp lỗi mà ISS-PIO-25 vừa dọn khỏi AoConfig/DoConfig. */
  it('ô giá trị khởi tạo chỉ hiện ở chế độ initial', () => {
    renderFields(base)
    expect(screen.queryByLabelText(/Initial value for VP1/i)).not.toBeInTheDocument()
    cleanup()
    renderFields({ ...base, restartPolicy: 'initial' })
    expect(screen.getByLabelText(/Initial value for VP1/i)).toBeInTheDocument()
  })

  it('giá trị khởi tạo tách khỏi giá trị hiện hành', () => {
    renderFields({ ...base, restartPolicy: 'initial', value: 35, initialValue: 20 })
    const input = screen.getByLabelText(/Initial value for VP1/i) as HTMLInputElement
    expect(input.value).toBe('20')
  })

  /* Dùng wrapper CÓ STATE THẬT: ô nhập là controlled, nên một `vi.fn()` trần
     không cập nhật gì và mọi lần gõ đều nhìn thấy giá trị cũ — phép kiểm khi ấy
     đo hành vi của test chứ không phải của sản phẩm. */
  it('sửa giá trị khởi tạo KHÔNG đụng vào value', async () => {
    const user = userEvent.setup()
    const patches: Array<Partial<VirtualPoint>> = []

    function Harness() {
      const [item, setItem] = useState<VirtualPoint>({ ...base, restartPolicy: 'initial', value: 35, initialValue: 20 })
      return (
        <I18nProvider>
          <RestartPolicyField
            item={item}
            onChange={(patch) => { patches.push(patch); setItem((current) => ({ ...current, ...patch })) }}
          />
        </I18nProvider>
      )
    }
    render(<Harness />)

    const input = screen.getByLabelText(/Initial value for VP1/i) as HTMLInputElement
    await user.clear(input)
    await user.type(input, '18')

    expect(input.value).toBe('18')
    // Điểm chính: KHÔNG lần nào chạm vào `value` — đó là toàn bộ lý do hai
    // trường được tách ra.
    for (const patch of patches) {
      expect(patch).not.toHaveProperty('value')
    }
    expect(patches[patches.length - 1]).toEqual({ initialValue: 18 })
  })
})
