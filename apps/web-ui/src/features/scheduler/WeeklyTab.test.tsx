import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../shared/i18n'
import type { ScheduleObject } from '../../shared/types'
import { WeeklyTab } from './tabs/WeeklyTab'

const mockDraft: ScheduleObject = {
  schema_version: '3.1',
  schedule_id: 'SCH-001',
  schedule_name: 'Test Schedule',
  description: '',
  enabled: true,
  status: 'DRAFT',
  revision: 1,
  value_type: 'BINARY',
  timezone: 'Asia/Ho_Chi_Minh',
  effective_period: { start_date: '2026-01-01', end_date: '2026-12-31' },
  schedule_default: { value: 'INACTIVE' },
  priority_for_writing: 16,
  core_priority_level: 4,
  weekly_schedule: {
    MON: [
      { time: '08:00:00', value: 'ACTIVE' },
      { time: '17:00:00', value: 'INACTIVE' }
    ],
    TUE: [],
    WED: [],
    THU: [],
    FRI: [],
    SAT: [],
    SUN: []
  },
  exception_schedule: [],
  target_objects: []
}

afterEach(() => {
  cleanup()
})

describe('WeeklyTab Google Calendar interactions', () => {
  it('renders week grid and existing block on Monday', () => {
    const onChange = vi.fn()
    render(
      <I18nProvider>
        <WeeklyTab draft={mockDraft} canEdit={true} onChange={onChange} />
      </I18nProvider>
    )

    expect(screen.getByRole('button', { name: 'T2' })).toBeInTheDocument()
    expect(screen.getByText('08:00 – 17:00')).toBeInTheDocument()
  })

  it('opens context menu on block right-click and allows removing block', () => {
    const onChange = vi.fn()
    render(
      <I18nProvider>
        <WeeklyTab draft={mockDraft} canEdit={true} onChange={onChange} />
      </I18nProvider>
    )

    const block = screen.getByRole('button', { name: /T2 08:00 - 17:00/ })
    fireEvent.contextMenu(block)

    const deleteBtn = screen.getByText('Xóa khoảng này')
    expect(deleteBtn).toBeInTheDocument()

    fireEvent.click(deleteBtn)
    expect(onChange).toHaveBeenCalledWith({
      weekly_schedule: expect.objectContaining({
        MON: []
      })
    })
  })

  it('double clicks on block opens edit modal', () => {
    const onChange = vi.fn()
    render(
      <I18nProvider>
        <WeeklyTab draft={mockDraft} canEdit={true} onChange={onChange} />
      </I18nProvider>
    )

    const block = screen.getByRole('button', { name: /T2 08:00 - 17:00/ })
    fireEvent.doubleClick(block)

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Chỉnh sửa khoảng thời gian (T2)')).toBeInTheDocument()
    expect(within(dialog).getByDisplayValue('08:00')).toBeInTheDocument()
    expect(within(dialog).getByDisplayValue('17:00')).toBeInTheDocument()
  })

  it('handles Delete key on selected block', () => {
    const onChange = vi.fn()
    render(
      <I18nProvider>
        <WeeklyTab draft={mockDraft} canEdit={true} onChange={onChange} />
      </I18nProvider>
    )

    const block = screen.getByRole('button', { name: /T2 08:00 - 17:00/ })
    fireEvent.keyDown(block, { key: 'Delete' })

    expect(onChange).toHaveBeenCalledWith({
      weekly_schedule: expect.objectContaining({
        MON: []
      })
    })
  })

  it('does not render keyboard help details element', () => {
    const onChange = vi.fn()
    render(
      <I18nProvider>
        <WeeklyTab draft={mockDraft} canEdit={true} onChange={onChange} />
      </I18nProvider>
    )

    expect(screen.queryByText(/Thao tác kiểu Google Calendar/i)).not.toBeInTheDocument()
  })

  it('renders single block correctly when defaultValue is ACTIVE', () => {
    const onChange = vi.fn()
    const activeDraft = {
      ...mockDraft,
      schedule_default: { value: 'ACTIVE' },
      weekly_schedule: {
        ...mockDraft.weekly_schedule,
        MON: [
          { time: '01:55:00', value: 'INACTIVE' },
          { time: '20:35:00', value: 'ACTIVE' }
        ]
      }
    }
    render(
      <I18nProvider>
        <WeeklyTab draft={activeDraft} canEdit={true} onChange={onChange} />
      </I18nProvider>
    )

    expect(screen.getByText('01:55 – 20:35')).toBeInTheDocument()
    expect(screen.queryByText('20:35 – 23:59')).not.toBeInTheDocument()
  })
})

