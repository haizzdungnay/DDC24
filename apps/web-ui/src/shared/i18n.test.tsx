import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { I18nProvider, useI18n } from './i18n'

function Probe() {
  const { pick } = useI18n()
  return <span>{pick('Tiếng Việt', 'English')}</span>
}

const originalLanguage = window.navigator.language

function setBrowserLanguage(value: string) {
  Object.defineProperty(window.navigator, 'language', { value, configurable: true })
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  setBrowserLanguage(originalLanguage)
})

describe('I18nProvider', () => {
  // BUG-001 — fresh profile trước đây LUÔN mặc định 'vi' bất kể trình duyệt.
  // Nay theo `navigator.language` (W3C i18n Best Practice); localStorage đã
  // lưu vẫn được ưu tiên tuyệt đối, không bị ghi đè bởi browser locale.
  it('fresh profile với trình duyệt tiếng Việt mặc định VI', () => {
    setBrowserLanguage('vi-VN')
    render(<I18nProvider><Probe /></I18nProvider>)
    expect(screen.getByText('Tiếng Việt')).toBeInTheDocument()
  })

  it('fresh profile với trình duyệt tiếng Anh mặc định EN', () => {
    setBrowserLanguage('en-US')
    render(<I18nProvider><Probe /></I18nProvider>)
    expect(screen.getByText('English')).toBeInTheDocument()
  })

  it('fresh profile với locale khác (không phải vi/en) rơi về VI', () => {
    setBrowserLanguage('ja-JP')
    render(<I18nProvider><Probe /></I18nProvider>)
    expect(screen.getByText('Tiếng Việt')).toBeInTheDocument()
  })

  it('tôn trọng lựa chọn tiếng Anh đã lưu dù trình duyệt là tiếng Việt', () => {
    setBrowserLanguage('vi-VN')
    localStorage.setItem('mkddc-lang', 'en')
    render(<I18nProvider><Probe /></I18nProvider>)
    expect(screen.getByText('English')).toBeInTheDocument()
  })

  it('tôn trọng lựa chọn tiếng Việt đã lưu dù trình duyệt là tiếng Anh', () => {
    setBrowserLanguage('en-US')
    localStorage.setItem('mkddc-lang', 'vi')
    render(<I18nProvider><Probe /></I18nProvider>)
    expect(screen.getByText('Tiếng Việt')).toBeInTheDocument()
  })
})
