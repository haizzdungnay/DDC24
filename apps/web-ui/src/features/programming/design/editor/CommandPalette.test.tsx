import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../../../shared/i18n'
import { CommandPalette } from './CommandPalette'
import type { PaletteEntry } from './quickControl'

afterEach(cleanup)

const entries: PaletteEntry[] = [
  { kind: 'command', commandId: 'save', label: 'Lưu', detail: 'Ctrl+S' },
  { kind: 'program', programId: 'p1', label: 'Program A', detail: 'ST' },
]

function renderPalette(onClose = vi.fn(), onSelect = vi.fn(), paletteEntries = entries) {
  const trigger = document.createElement('button')
  trigger.textContent = 'Mở bảng lệnh'
  document.body.append(trigger)
  trigger.focus()
  function Harness() {
    const [open, setOpen] = useState(true)
    return <I18nProvider><CommandPalette open={open} entries={paletteEntries} onClose={() => { onClose(); setOpen(false) }} onSelect={onSelect} /></I18nProvider>
  }
  render(<Harness />)
  return { trigger, onClose, onSelect }
}

describe('CommandPalette', () => {
  it('traps focus, locks body scroll, and returns focus on Escape', async () => {
    const { trigger } = renderPalette()
    const dialog = screen.getByRole('dialog', { name: /Bảng lệnh nhanh|Command palette/ })
    const input = screen.getByPlaceholderText(/Nhảy tới Program|Jump to a program/)
    await waitFor(() => expect(input).toHaveFocus())
    expect(document.body.style.overflow).toBe('hidden')
    const options = screen.getAllByRole('option')
    options[options.length - 1].focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(input).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(options[options.length - 1]).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: /Bảng lệnh nhanh|Command palette/ })).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
    expect(trigger).toHaveFocus()
  })

  it('đóng qua backdrop và selection, giữ nguyên callback command', () => {
    const first = renderPalette()
    fireEvent.mouseDown(screen.getByRole('presentation'))
    expect(first.onClose).toHaveBeenCalled()
    expect(first.trigger).toHaveFocus()
    first.trigger.remove()
    cleanup()
    const second = renderPalette()
    fireEvent.click(screen.getByRole('option', { name: /Lưu/ }))
    expect(second.onSelect).toHaveBeenCalledWith(entries[0])
    expect(second.onClose).toHaveBeenCalled()
    expect(second.trigger).toHaveFocus()
    second.trigger.remove()
    cleanup()
    const third = renderPalette()
    fireEvent.click(screen.getByRole('button', { name: /Đóng|Close/ }))
    expect(third.onClose).toHaveBeenCalled()
    expect(third.trigger).toHaveFocus()
    third.trigger.remove()
  })

  it('traps focus with empty results', async () => {
    const { trigger } = renderPalette(vi.fn(), vi.fn(), [])
    const dialog = screen.getByRole('dialog', { name: /Bảng lệnh nhanh|Command palette/ })
    const input = screen.getByPlaceholderText(/Nhảy tới Program|Jump to a program/)
    const close = screen.getByRole('button', { name: /Đóng|Close/ })
    await waitFor(() => expect(input).toHaveFocus())
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(close).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(input).toHaveFocus()
    trigger.remove()
  })
})
