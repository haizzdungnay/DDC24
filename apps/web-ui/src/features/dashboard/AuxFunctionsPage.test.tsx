import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../shared/components/Toast'
import { I18nProvider } from '../../shared/i18n'
import { AuxFunctionsPage } from './AuxFunctionsPage'

const mode = vi.hoisted(() => ({ isDemo: false }))
const simulator = vi.hoisted(() => ({
  getDemoGraph: vi.fn(() => ({ nodes: [], links: [] })),
  validateGraphLocal: vi.fn(() => ({ pass: true, errors: [] }))
}))

vi.mock('../../shared/config', () => ({
  get IS_DEMO() { return mode.isDemo }
}))
vi.mock('../../shared/demo/simulator', () => simulator)

function renderPage() {
  return render(
    <I18nProvider>
      <ToastProvider>
        <AuxFunctionsPage />
      </ToastProvider>
    </I18nProvider>
  )
}

async function generateFu1() {
  const user = userEvent.setup()
  await user.click(screen.getByText('FU1 Enable/Disable'))
  await user.type(screen.getByPlaceholderText('Enter enablePt...'), 'UI-01')
  await user.type(screen.getByPlaceholderText('Enter outPt...'), 'DO-01')
  await user.click(screen.getByRole('button', { name: 'Create node cluster' }))
}

describe('AuxFunctionsPage — ranh giới live/demo', () => {
  beforeEach(() => {
    localStorage.setItem('mkddc-lang', 'en')
    mode.isDemo = false
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('live chỉ sinh preview, không chấm PASS bằng graph demo', async () => {
    renderPage()
    await generateFu1()

    expect(await screen.findByText('Generated Nodes & Links')).toBeInTheDocument()
    expect(screen.getByText(/No PASS\/FAIL verdict/)).toBeInTheDocument()
    expect(screen.queryByText('PASS')).not.toBeInTheDocument()
    expect(simulator.getDemoGraph).not.toHaveBeenCalled()
    expect(simulator.validateGraphLocal).not.toHaveBeenCalled()
  })

  it('demo vẫn dùng validator cục bộ và hiện phán quyết', async () => {
    mode.isDemo = true
    renderPage()
    await generateFu1()

    expect(await screen.findByText('Generated Nodes & Links')).toBeInTheDocument()
    expect(screen.getAllByText('PASS').length).toBeGreaterThan(0)
    expect(simulator.getDemoGraph).toHaveBeenCalledOnce()
    expect(simulator.validateGraphLocal).toHaveBeenCalledOnce()
  })
})
