export type FbdThemePreference = 'FOLLOW_WEB' | 'LIGHT' | 'DARK'
export type FbdWireStylePreference = 'ORTHOGONAL' | 'BEZIER'
export type FbdFlowPreviewPreference = 'OFF' | 'ALL' | 'SELECTED_BLOCKS' | 'HOVER'
export type FbdSnapSizePreference = 4 | 8 | 16 | 32
export type FbdNetworkViewPreference = 'SELECTED' | 'ALL'

export interface FbdDockPreferences {
  explorer: boolean
  library: boolean
  inspector: boolean
  workbench: boolean
}

export interface FbdPreferences {
  schemaVersion: 1
  theme: FbdThemePreference
  wireStyle: FbdWireStylePreference
  flowPreview: FbdFlowPreviewPreference
  gridVisible: boolean
  snapEnabled: boolean
  snapSize: FbdSnapSizePreference
  networkView: FbdNetworkViewPreference
  dock: FbdDockPreferences
}

const DEFAULT_DOCK_PREFERENCES: FbdDockPreferences = {
  explorer: true,
  library: true,
  inspector: true,
  workbench: true,
}

const DEFAULT_PREFERENCES: FbdPreferences = {
  schemaVersion: 1,
  theme: 'FOLLOW_WEB',
  wireStyle: 'ORTHOGONAL',
  flowPreview: 'HOVER',
  gridVisible: true,
  snapEnabled: true,
  snapSize: 8,
  networkView: 'SELECTED',
  dock: DEFAULT_DOCK_PREFERENCES,
}

const VALID_THEMES = new Set<FbdThemePreference>(['FOLLOW_WEB', 'LIGHT', 'DARK'])
const VALID_WIRE_STYLES = new Set<FbdWireStylePreference>(['ORTHOGONAL', 'BEZIER'])
const VALID_FLOW_PREVIEWS = new Set<FbdFlowPreviewPreference>(['OFF', 'ALL', 'SELECTED_BLOCKS', 'HOVER'])
const VALID_SNAP_SIZES = new Set<FbdSnapSizePreference>([4, 8, 16, 32])
const VALID_NETWORK_VIEWS = new Set<FbdNetworkViewPreference>(['SELECTED', 'ALL'])

export function getDefaultFbdPreferences(): FbdPreferences {
  return {
    ...DEFAULT_PREFERENCES,
    dock: { ...DEFAULT_DOCK_PREFERENCES },
  }
}

export function buildFbdPreferencesKey(userScope?: string, projectId?: string): string {
  const cleanScope = userScope?.trim() || 'global'
  const cleanProject = projectId?.trim() || 'default'
  return `mkddc:fbd-preferences:v1:${cleanScope}:${cleanProject}`
}

function resolveStorage(storage?: Storage): Storage | null {
  if (storage) return storage
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

function sanitizePreferences(raw: unknown): FbdPreferences {
  const defaults = getDefaultFbdPreferences()
  if (typeof raw !== 'object' || raw === null) return defaults

  const bag = raw as Record<string, unknown>
  if (bag.schemaVersion !== 1) return defaults

  const theme: FbdThemePreference =
    typeof bag.theme === 'string' && VALID_THEMES.has(bag.theme as FbdThemePreference)
      ? (bag.theme as FbdThemePreference)
      : defaults.theme

  const wireStyle: FbdWireStylePreference =
    typeof bag.wireStyle === 'string' && VALID_WIRE_STYLES.has(bag.wireStyle as FbdWireStylePreference)
      ? (bag.wireStyle as FbdWireStylePreference)
      : defaults.wireStyle

  const flowPreview: FbdFlowPreviewPreference =
    typeof bag.flowPreview === 'string' && VALID_FLOW_PREVIEWS.has(bag.flowPreview as FbdFlowPreviewPreference)
      ? (bag.flowPreview as FbdFlowPreviewPreference)
      : defaults.flowPreview

  const gridVisible = typeof bag.gridVisible === 'boolean' ? bag.gridVisible : defaults.gridVisible
  const snapEnabled = typeof bag.snapEnabled === 'boolean' ? bag.snapEnabled : defaults.snapEnabled

  const snapSize: FbdSnapSizePreference =
    typeof bag.snapSize === 'number' && VALID_SNAP_SIZES.has(bag.snapSize as FbdSnapSizePreference)
      ? (bag.snapSize as FbdSnapSizePreference)
      : defaults.snapSize

  const networkView: FbdNetworkViewPreference =
    typeof bag.networkView === 'string' && VALID_NETWORK_VIEWS.has(bag.networkView as FbdNetworkViewPreference)
      ? (bag.networkView as FbdNetworkViewPreference)
      : defaults.networkView

  const rawDock = typeof bag.dock === 'object' && bag.dock !== null ? (bag.dock as Record<string, unknown>) : {}
  const dock: FbdDockPreferences = {
    explorer: typeof rawDock.explorer === 'boolean' ? rawDock.explorer : defaults.dock.explorer,
    library: typeof rawDock.library === 'boolean' ? rawDock.library : defaults.dock.library,
    inspector: typeof rawDock.inspector === 'boolean' ? rawDock.inspector : defaults.dock.inspector,
    workbench: typeof rawDock.workbench === 'boolean' ? rawDock.workbench : defaults.dock.workbench,
  }

  return {
    schemaVersion: 1,
    theme,
    wireStyle,
    flowPreview,
    gridVisible,
    snapEnabled,
    snapSize,
    networkView,
    dock,
  }
}

export function readFbdPreferences(
  userScope?: string,
  projectId?: string,
  storage?: Storage
): FbdPreferences {
  const targetStorage = resolveStorage(storage)
  if (!targetStorage) return getDefaultFbdPreferences()

  const key = buildFbdPreferencesKey(userScope, projectId)
  try {
    const raw = targetStorage.getItem(key)
    return raw ? sanitizePreferences(JSON.parse(raw)) : getDefaultFbdPreferences()
  } catch {
    return getDefaultFbdPreferences()
  }
}

export function writeFbdPreferences(
  prefs: Partial<FbdPreferences>,
  userScope?: string,
  projectId?: string,
  storage?: Storage
): FbdPreferences {
  const current = readFbdPreferences(userScope, projectId, storage)
  const merged: FbdPreferences = {
    ...current,
    ...prefs,
    schemaVersion: 1,
    dock: {
      ...current.dock,
      ...(prefs.dock || {}),
    },
  }
  const clean = sanitizePreferences(merged)
  const targetStorage = resolveStorage(storage)
  if (targetStorage) {
    const key = buildFbdPreferencesKey(userScope, projectId)
    try {
      targetStorage.setItem(key, JSON.stringify(clean))
    } catch {
      // Storage unavailable or quota exceeded; return memory object safely
    }
  }
  return clean
}

export function resetFbdPreferences(
  userScope?: string,
  projectId?: string,
  storage?: Storage
): FbdPreferences {
  const targetStorage = resolveStorage(storage)
  if (targetStorage) {
    const key = buildFbdPreferencesKey(userScope, projectId)
    try {
      targetStorage.removeItem(key)
    } catch {
      // Ignore removal failure
    }
  }
  return getDefaultFbdPreferences()
}
