import { useCallback } from 'react'
import { apiClient } from '../api/client'
import type { HistorianConfig, HistorianConfigUpdate, HistorianInterval } from '../types'
import { useApi } from './useApi'

export interface HistorianPointUpdate {
  pointId: string
  generation: number
  dbLoggingEnabled: boolean
  dbInterval: HistorianInterval
  retentionDays: number
  startAtUtc: string | null
}

export function useHistorianConfig() {
  const state = useApi(apiClient.getHistorianConfig, [], { refreshMs: 10_000 })
  const savePoint = useCallback(async (point: HistorianPointUpdate): Promise<HistorianConfig> => {
    const current = state.data
    if (!current) throw new Error('Historian policy is not loaded')
    const update: HistorianConfigUpdate = {
      baseRevision: current.revision,
      baseNamespaceRevision: current.namespaceRevision,
      points: [{
        pointId: point.pointId,
        generation: point.generation,
        dbLoggingEnabled: point.dbLoggingEnabled,
        dbInterval: point.dbInterval,
        retentionDays: point.retentionDays,
        startAtUtc: point.startAtUtc
      }]
    }
    return apiClient.putHistorianConfig(update)
  }, [state.data])

  return { ...state, savePoint }
}

export function historianPolicyFor(config: HistorianConfig | null, pointId: string) {
  return config?.points.find((point) => point.pointId === pointId)
}
