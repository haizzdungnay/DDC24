import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { ApiError } from '../types'
import {
  displayPointName,
  focusPointField,
  normalizePointName,
  pointFieldErrors,
  pointFieldFocusPath,
  pointFieldLocation,
  pointNameConflictState,
  pointNameConflicts,
  pointNameKey,
  validatePointName
} from './pointTags'

afterEach(() => {
  document.body.replaceChildren()
})

describe('point display names', () => {
  it('canonicalizes Unicode whitespace without applying compatibility normalization', () => {
    expect(normalizePointName('  Phòng\t Áp\nSuất  ')).toBe('Phòng Áp Suất')
    expect(pointNameKey('  ĐIỆN  ÁP ')).toBe(pointNameKey('điện\táp'))
    expect(pointNameKey('Ａ')).not.toBe(pointNameKey('A'))
  })

  it('validates Unicode code points, blanks and controls', () => {
    expect(validatePointName('😀'.repeat(64))).toBeUndefined()
    expect(validatePointName('😀'.repeat(65))).toBe('Name must be at most 64 characters')
    expect(validatePointName('   ')).toBe('Name is required')
    expect(validatePointName('Room\u0007Name')).toBe('Name must not contain control characters')
  })

  it('uses canonical ids only as the display fallback for blank legacy names', () => {
    expect(displayPointName(' \t ', 'UI-01')).toBe('UI-01')
    expect(displayPointName(undefined, 'VP7')).toBe('VP7')
    expect(displayPointName('  Room   Setpoint ', 'VP7')).toBe('Room Setpoint')
  })

  it('surfaces case/whitespace collisions across kinds while keeping tag names independent', () => {
    const conflicts = pointNameConflicts([
      { id: 'UI-01', kind: 'UI', name: ' Supply  Air ' },
      { id: 'AO-01', kind: 'AO', name: 'supply air' },
      { id: 'VP1', kind: 'virtual', name: 'VP1' }
    ])

    expect(conflicts.get('UI-01')).toEqual(['AO-01'])
    expect(conflicts.get('AO-01')).toEqual(['UI-01'])
    expect(conflicts.has('VP1')).toBe(false)
    expect(pointNameConflictState([{ id: 'UI-01', name: '' }, { id: 'AO-01', name: '' }])).toBe('valid')
  })
})

describe('structured point metadata errors', () => {
  it('keeps conflict details on both fields and aliases VP label to display name', () => {
    const error = new ApiError('point namespace conflict', 409, [{
      path: 'items[1].label',
      reason: 'point_name_conflict',
      message: 'display name is already used',
      pointId: 'VP2',
      conflictPointId: 'AO-01',
      conflictPath: 'ao[0].name'
    }])

    expect(pointFieldErrors(error)).toMatchObject({
      'items[1].label': 'display name is already used (conflicts with AO-01)',
      'items[1].name': 'display name is already used (conflicts with AO-01)',
      'ao[0].name': 'display name is already used (conflicts with VP2)'
    })
    expect(pointFieldLocation('items[1].label')).toEqual({ collection: 'items', index: 1, field: 'label' })
  })

  it('focuses the display-name input when the backend reports the legacy label path', () => {
    const tag = document.createElement('input')
    tag.dataset.pointField = 'items[1].tag'
    const name = document.createElement('input')
    name.dataset.pointField = 'items[1].name'
    document.body.append(tag, name)

    focusPointField('items[1].label')

    expect(name).toHaveFocus()
  })

  it.each([
    {
      currentId: 'UI-01',
      detail: { path: 'ao[0].name', pointId: 'AO-01', conflictPath: 'ui[0].name', conflictPointId: 'UI-01' },
      expected: 'ui[0].name'
    },
    {
      currentId: 'VP2',
      detail: { path: 'items[1].label', pointId: 'VP2', conflictPath: 'do[0].name', conflictPointId: 'DO-01' },
      expected: 'items[1].label'
    }
  ])('prefers the current point field across canonical cross-kind ordering', ({ currentId, detail, expected }) => {
    const error = new ApiError('point namespace conflict', 409, [{
      ...detail,
      reason: 'point_name_conflict',
      message: 'display name is already used'
    }])

    expect(pointFieldFocusPath(error, currentId)).toBe(expected)
  })

  it('chooses the conflict path in the current page collection when no selected id matches', () => {
    const error = new ApiError('point namespace conflict', 409, [{
      path: 'ao[0].name',
      reason: 'point_name_conflict',
      message: 'display name is already used',
      pointId: 'AO-01',
      conflictPointId: 'UI-08',
      conflictPath: 'ui[7].name'
    }])

    expect(pointFieldFocusPath(error, 'UI-01', ['ui'])).toBe('ui[7].name')
  })

  it('focuses the mounted field even when another kind is ordered first', () => {
    const currentName = document.createElement('input')
    currentName.dataset.pointField = 'ui[0].name'
    document.body.append(currentName)

    focusPointField(['ao[0].name', 'ui[0].name'])

    expect(currentName).toHaveFocus()
  })
})
