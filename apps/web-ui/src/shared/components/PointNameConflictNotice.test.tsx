import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PointNameConflictNotice } from './PointNameConflictNotice'

afterEach(cleanup)

describe('PointNameConflictNotice', () => {
  it('keeps runtime availability explicit and guides a conflict-reducing rename', () => {
    render(<PointNameConflictNotice pointId="UI-01" conflictIds={['AO-01', 'VP2']} />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('UI-01 also matches AO-01, VP2')
    expect(alert).toHaveTextContent('Runtime data remains available')
    expect(alert).toHaveTextContent('rename this display name to a unique value')
  })

  it('does not add noise for a valid namespace member', () => {
    const { container } = render(<PointNameConflictNotice pointId="UI-01" />)
    expect(container).toBeEmptyDOMElement()
  })
})
