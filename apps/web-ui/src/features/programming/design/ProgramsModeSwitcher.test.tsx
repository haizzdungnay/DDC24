import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '../../../shared/i18n'
import { ProgramsModeSwitcher } from './ProgramsModeSwitcher'
import type { ProgramsWorkspaceMode } from '../shared/programsRoute'

function renderSwitcher(options: { mode?: ProgramsWorkspaceMode; draftDirty?: boolean } = {}) {
  const onSwitch = vi.fn()
  render(
    <I18nProvider>
      <ProgramsModeSwitcher
        mode={options.mode ?? 'EDIT'}
        draftDirty={options.draftDirty ?? false}
        onSwitch={onSwitch}
      />
    </I18nProvider>,
  )
  return { onSwitch }
}

beforeEach(() => localStorage.setItem('mkddc-lang', 'vi'))
afterEach(cleanup)

/*
 * `T59-807` — trước lát này `?mode=` chỉ đổi được bằng cách GÕ TAY vào URL, và
 * giao diện không hề nói workspace đang ở chế độ nào.
 */
describe('ProgramsModeSwitcher', () => {
  it('hiện đủ ba chế độ và đánh dấu chế độ đang mở', () => {
    renderSwitcher({ mode: 'EDIT' })
    expect(screen.getByRole('button', { name: 'EDIT' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'LIVE' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'SIMULATE' })).toBeInTheDocument()
  })

  it('chế độ chưa khả dụng vẫn HIỆN và giải thích lý do khi bấm', () => {
    const { onSwitch } = renderSwitcher()
    const live = screen.getByRole('button', { name: 'LIVE' })
    expect(live).toHaveAttribute('aria-disabled', 'true')

    fireEvent.click(live)
    expect(screen.getByText(/capability đó mở ở increment R2/)).toBeInTheDocument()
    // KHÔNG tự hạ cấp: không có lần đổi chế độ nào xảy ra
    expect(onSwitch).not.toHaveBeenCalled()
  })

  it('SIMULATE nói increment khác với LIVE — lý do là thật, không phải câu chung', () => {
    renderSwitcher()
    fireEvent.click(screen.getByRole('button', { name: 'SIMULATE' }))
    expect(screen.getByText(/capability đó mở ở increment R3/)).toBeInTheDocument()
  })

  it('Draft bẩn + đích không khả dụng: báo không khả dụng, KHÔNG hỏi bỏ thay đổi', () => {
    renderSwitcher({ draftDirty: true })
    fireEvent.click(screen.getByRole('button', { name: 'LIVE' }))
    expect(screen.getByText(/capability đó mở ở increment R2/)).toBeInTheDocument()
    expect(screen.queryByText(/Draft còn thay đổi chưa lưu/)).toBeNull()
  })

  it('bấm lại chính chế độ đang mở thì không làm gì', () => {
    const { onSwitch } = renderSwitcher({ mode: 'EDIT', draftDirty: true })
    fireEvent.click(screen.getByRole('button', { name: 'EDIT' }))
    expect(onSwitch).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

/* Nhánh dirty guard cần một capability khả dụng để đi tới — dùng capability
 * bơm vào thay vì chờ R2, đúng chỗ mà máy trạng thái sẽ chạy thật. */
describe('ProgramsModeSwitcher — dirty guard khi đổi mode', () => {
  function renderWithLive(draftDirty: boolean) {
    const onSwitch = vi.fn()
    render(
      <I18nProvider>
        <ProgramsModeSwitcher
          mode="EDIT"
          draftDirty={draftDirty}
          onSwitch={onSwitch}
          capabilities={[
            { mode: 'EDIT', available: true, reason: null },
            { mode: 'LIVE', available: true, reason: null },
            { mode: 'SIMULATE', available: false, reason: 'R3' },
          ]}
        />
      </I18nProvider>,
    )
    return { onSwitch }
  }

  it('Draft bẩn thì HỎI trước, không đổi ngay', () => {
    const { onSwitch } = renderWithLive(true)
    fireEvent.click(screen.getByRole('button', { name: 'LIVE' }))
    expect(screen.getByText(/Đổi chế độ sẽ đổi nguồn tài liệu/)).toBeInTheDocument()
    expect(onSwitch).not.toHaveBeenCalled()
  })

  it('chọn "Ở lại" thì giữ nguyên chế độ và giữ nguyên buffer', () => {
    const { onSwitch } = renderWithLive(true)
    fireEvent.click(screen.getByRole('button', { name: 'LIVE' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ở lại' }))
    expect(onSwitch).not.toHaveBeenCalled()
  })

  it('chọn "Bỏ thay đổi và đổi chế độ" mới thật sự đổi', () => {
    const { onSwitch } = renderWithLive(true)
    fireEvent.click(screen.getByRole('button', { name: 'LIVE' }))
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ thay đổi và đổi chế độ' }))
    expect(onSwitch).toHaveBeenCalledWith('LIVE')
  })

  it('Draft sạch thì đi thẳng, không hỏi', () => {
    const { onSwitch } = renderWithLive(false)
    fireEvent.click(screen.getByRole('button', { name: 'LIVE' }))
    expect(onSwitch).toHaveBeenCalledWith('LIVE')
    expect(screen.queryByText(/Đổi chế độ sẽ đổi nguồn tài liệu/)).toBeNull()
  })
})
