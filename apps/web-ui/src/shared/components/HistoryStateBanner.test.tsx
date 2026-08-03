import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HistoryStateBanner, type HistoryGapDetail } from './HistoryStateBanner'

const gaps: HistoryGapDetail[] = [
  {
    pointId: 'AO,1',
    generation: 3,
    fromUtc: '2026-07-20T01:00:00Z',
    toUtc: '2026-07-20T01:00:15Z',
    reason: 'queue_overflow',
    detail: 'Writer queue reached capacity',
  },
  {
    pointId: 'VP,2',
    generation: 1,
    fromUtc: '2026-07-20T02:00:00Z',
    toUtc: '2026-07-20T02:00:30Z',
    reason: 'restart',
  },
]

afterEach(cleanup)

describe('HistoryStateBanner', () => {
  it('announces complete history as a polite status with visible text and icon', () => {
    render(<HistoryStateBanner state="complete" />)

    const banner = screen.getByRole('status')
    expect(banner).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByText('Complete')).toBeInTheDocument()
    expect(screen.getByText('History complete')).toBeInTheDocument()
    expect(screen.getByTestId('history-state-icon')).toHaveAttribute('aria-hidden', 'true')
  })

  it('announces partial history and exposes an explicit gap count and details', () => {
    render(<HistoryStateBanner state="partial" gaps={gaps} />)

    const banner = screen.getByRole('alert')
    expect(banner).toHaveAttribute('aria-live', 'assertive')
    expect(screen.getByText('2 history gaps reported.')).toBeInTheDocument()
    expect(screen.getByText('Gap details (2)')).toBeInTheDocument()
    expect(screen.getByText('AO,1 generation 3')).toBeInTheDocument()
    expect(screen.getByText('VP,2 generation 1')).toBeInTheDocument()
    expect(screen.getByText('queue overflow')).toBeInTheDocument()
    expect(screen.getByText('Writer queue reached capacity')).toBeInTheDocument()
    expect(screen.getByText('2026-07-20T01:00:00Z')).toHaveAttribute('datetime', '2026-07-20T01:00:00Z')
    expect(screen.getByText('2026-07-20T01:00:15Z')).toHaveAttribute('datetime', '2026-07-20T01:00:15Z')
  })

  it('keeps an incomplete result explicit when no gap details were supplied', () => {
    render(<HistoryStateBanner state="partial" />)

    expect(screen.getByRole('alert')).toHaveTextContent('0 history gaps reported.')
    expect(screen.getByText('No gap details were supplied.')).toBeInTheDocument()
  })

  it('renders unavailable history as an alert and offers an accessible retry action', async () => {
    const onRetry = vi.fn()
    const user = userEvent.setup()
    render(<HistoryStateBanner state="unavailable" detail="Historian service is offline." onRetry={onRetry} />)

    expect(screen.getByRole('alert')).toHaveTextContent('History unavailable')
    expect(screen.getByText('Historian service is offline.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry history query' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('distinguishes an empty successful query from an unavailable query', () => {
    render(<HistoryStateBanner state="no-history" />)

    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent('No history')
    expect(banner).toHaveTextContent('No samples exist in the requested range.')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
