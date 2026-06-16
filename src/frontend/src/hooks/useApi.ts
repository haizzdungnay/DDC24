import { useCallback, useEffect, useState } from 'react'
import type { DependencyList } from 'react'

export interface ApiState<T> {
  data: T | null
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

export function useApi<T>(fetcher: () => Promise<T>, deps: DependencyList = []): ApiState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const refetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await fetcher())
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setLoading(false)
    }
  }, deps)

  useEffect(() => {
    void refetch()
  }, [refetch])

  return { data, loading, error, refetch }
}
