import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { I18nProvider, useI18n } from './i18n'

function Probe() {
  const { pick } = useI18n()
  return <span>{pick('Tiếng Việt', 'English')}</span>
}

beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe('I18nProvider', () => {
  it('fresh profile mặc định tiếng Việt', () => {
    render(<I18nProvider><Probe /></I18nProvider>)
    expect(screen.getByText('Tiếng Việt')).toBeInTheDocument()
  })

  it('tôn trọng lựa chọn tiếng Anh đã lưu', () => {
    localStorage.setItem('mkddc-lang', 'en')
    render(<I18nProvider><Probe /></I18nProvider>)
    expect(screen.getByText('English')).toBeInTheDocument()
  })
})
