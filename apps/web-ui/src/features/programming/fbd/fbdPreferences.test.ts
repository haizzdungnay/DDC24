import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildFbdPreferencesKey,
  getDefaultFbdPreferences,
  readFbdPreferences,
  resetFbdPreferences,
  writeFbdPreferences,
  type FbdPreferences,
} from './fbdPreferences'

describe('fbdPreferences', () => {
  let mockStorage: Record<string, string>
  let storage: Storage

  beforeEach(() => {
    mockStorage = {}
    storage = {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, value: string) => {
        mockStorage[key] = value
      },
      removeItem: (key: string) => {
        delete mockStorage[key]
      },
      clear: () => {
        mockStorage = {}
      },
      key: (index: number) => Object.keys(mockStorage)[index] ?? null,
      length: 0,
    } as Storage
  })

  describe('getDefaultFbdPreferences', () => {
    it('returns default preferences according to spec', () => {
      const defaults = getDefaultFbdPreferences()
      expect(defaults).toEqual({
        schemaVersion: 1,
        theme: 'FOLLOW_WEB',
        wireStyle: 'ORTHOGONAL',
        flowPreview: 'HOVER',
        gridVisible: true,
        snapEnabled: true,
        snapSize: 8,
        networkView: 'SELECTED',
        dock: {
          explorer: true,
          library: true,
          inspector: true,
          workbench: true,
        },
      })
    })

    it('returns a fresh object on each call', () => {
      const a = getDefaultFbdPreferences()
      const b = getDefaultFbdPreferences()
      expect(a).not.toBe(b)
      expect(a.dock).not.toBe(b.dock)
    })
  })

  describe('buildFbdPreferencesKey', () => {
    it('builds key with default scope and project when omitted', () => {
      expect(buildFbdPreferencesKey()).toBe('mkddc:fbd-preferences:v1:global:default')
    })

    it('builds key with custom userScope and projectId', () => {
      expect(buildFbdPreferencesKey('user123', 'proj456')).toBe(
        'mkddc:fbd-preferences:v1:user123:proj456'
      )
    })

    it('trims scopes and handles empty strings', () => {
      expect(buildFbdPreferencesKey('  ', '')).toBe(
        'mkddc:fbd-preferences:v1:global:default'
      )
    })
  })

  describe('readFbdPreferences', () => {
    it('returns defaults when storage is empty', () => {
      const prefs = readFbdPreferences('user1', 'proj1', storage)
      expect(prefs).toEqual(getDefaultFbdPreferences())
    })

    it('reads and parses valid preferences from storage', () => {
      const custom: FbdPreferences = {
        schemaVersion: 1,
        theme: 'DARK',
        wireStyle: 'BEZIER',
        flowPreview: 'ALL',
        gridVisible: false,
        snapEnabled: false,
        snapSize: 16,
        networkView: 'ALL',
        dock: {
          explorer: false,
          library: true,
          inspector: false,
          workbench: true,
        },
      }
      const key = buildFbdPreferencesKey('user1', 'proj1')
      storage.setItem(key, JSON.stringify(custom))

      const read = readFbdPreferences('user1', 'proj1', storage)
      expect(read).toEqual(custom)
    })

    it('falls back to defaults if JSON is malformed', () => {
      const key = buildFbdPreferencesKey('user1', 'proj1')
      storage.setItem(key, 'not-valid-json{')

      const read = readFbdPreferences('user1', 'proj1', storage)
      expect(read).toEqual(getDefaultFbdPreferences())
    })

    it('falls back to defaults if schemaVersion is unsupported', () => {
      const key = buildFbdPreferencesKey('user1', 'proj1')
      storage.setItem(key, JSON.stringify({ schemaVersion: 99, theme: 'DARK' }))

      const read = readFbdPreferences('user1', 'proj1', storage)
      expect(read).toEqual(getDefaultFbdPreferences())
    })

    it('sanitizes invalid enum values by falling back to defaults', () => {
      const key = buildFbdPreferencesKey('user1', 'proj1')
      storage.setItem(
        key,
        JSON.stringify({
          schemaVersion: 1,
          theme: 'INVALID_THEME',
          wireStyle: 'UNKNOWN',
          snapSize: 12,
          networkView: 'ALL_NODES',
          dock: { explorer: 'yes' },
        })
      )

      const read = readFbdPreferences('user1', 'proj1', storage)
      expect(read.theme).toBe('FOLLOW_WEB')
      expect(read.wireStyle).toBe('ORTHOGONAL')
      expect(read.snapSize).toBe(8)
      expect(read.networkView).toBe('SELECTED')
      expect(read.dock.explorer).toBe(true)
    })

    it('handles storage throwing SecurityError or exception', () => {
      const throwingStorage = {
        getItem: () => {
          throw new Error('SecurityError: access denied')
        },
      } as unknown as Storage

      const read = readFbdPreferences('user1', 'proj1', throwingStorage)
      expect(read).toEqual(getDefaultFbdPreferences())
    })
  })

  describe('writeFbdPreferences', () => {
    it('merges partial preferences and persists to storage', () => {
      const updated = writeFbdPreferences(
        { theme: 'LIGHT', snapSize: 32 },
        'user1',
        'proj1',
        storage
      )

      expect(updated.theme).toBe('LIGHT')
      expect(updated.snapSize).toBe(32)
      expect(updated.wireStyle).toBe('ORTHOGONAL')
      expect(updated.schemaVersion).toBe(1)

      const key = buildFbdPreferencesKey('user1', 'proj1')
      const stored = JSON.parse(storage.getItem(key)!)
      expect(stored).toEqual(updated)
    })

    it('merges nested dock preferences safely', () => {
      writeFbdPreferences(
        { dock: { explorer: false, library: true, inspector: false, workbench: true } },
        'user1',
        'proj1',
        storage
      )
      const secondUpdate = writeFbdPreferences(
        { dock: { explorer: false, library: false, inspector: false, workbench: true } },
        'user1',
        'proj1',
        storage
      )

      expect(secondUpdate.dock.library).toBe(false)
      expect(secondUpdate.dock.workbench).toBe(true)
    })

    it('handles QuotaExceededError gracefully without crashing', () => {
      const throwingStorage = {
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceededError')
        },
      } as unknown as Storage

      const result = writeFbdPreferences({ theme: 'DARK' }, 'user1', 'proj1', throwingStorage)
      expect(result.theme).toBe('DARK')
    })
  })

  describe('resetFbdPreferences', () => {
    it('clears storage item and returns default preferences', () => {
      writeFbdPreferences({ theme: 'DARK' }, 'user1', 'proj1', storage)
      const key = buildFbdPreferencesKey('user1', 'proj1')
      expect(storage.getItem(key)).not.toBeNull()

      const reset = resetFbdPreferences('user1', 'proj1', storage)
      expect(reset).toEqual(getDefaultFbdPreferences())
      expect(storage.getItem(key)).toBeNull()
    })

    it('handles removal exceptions gracefully', () => {
      const throwingStorage = {
        removeItem: () => {
          throw new Error('Storage error')
        },
      } as unknown as Storage

      const reset = resetFbdPreferences('user1', 'proj1', throwingStorage)
      expect(reset).toEqual(getDefaultFbdPreferences())
    })
  })
})
