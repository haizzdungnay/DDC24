import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../../shared/i18n'
import { HelpPage } from './HelpPage'

beforeEach(() => localStorage.setItem('mkddc-lang', 'en'))
afterEach(cleanup)

describe('HelpPage', () => {
  it('presents quick guidance and frequently asked questions', () => {
    render(<I18nProvider><HelpPage /></I18nProvider>)

    expect(screen.getByRole('heading', { name: 'Help' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Point configuration' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Frequently asked questions' })).toBeInTheDocument()
    expect(screen.getByText('How do I view all alarms?')).toBeInTheDocument()
  })
})
