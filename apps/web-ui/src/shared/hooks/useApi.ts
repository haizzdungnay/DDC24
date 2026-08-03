import { useCallback, useEffect, useRef, useState } from 'react'
import type { DependencyList } from 'react'

export interface ApiState<T> {
  data: T | null
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

interface UseApiOptions {
  refreshMs?: number
  networkRetryMs?: number | false
}

export function useApi<T>(fetcher: () => Promise<T>, deps: DependencyList = [], options: UseApiOptions = {}): ApiState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const isMounted = useRef(true)
  const requestSequence = useRef(0)
  const fetcherRef = useRef(fetcher)

  useEffect(() => {
    fetcherRef.current = fetcher
  }, [fetcher])

  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
    }
  }, [])

  const fetchNow = useCallback(async (showLoading: boolean) => {
    if (!isMounted.current) return
    const requestId = ++requestSequence.current
    if (showLoading) {
      setLoading(true)
      setError(null)
    }
    try {
      const result = await fetcherRef.current()
      if (isMounted.current && requestId === requestSequence.current) {
        setData(result)
        setError(null)
      }
    } catch (err) {
      if (isMounted.current && requestId === requestSequence.current) {
        setError(err instanceof Error ? err : new Error(String(err)))
      }
    } finally {
      if (isMounted.current && requestId === requestSequence.current && showLoading) {
        setLoading(false)
      }
    }
  }, [])

  const refetch = useCallback(async () => {
    await fetchNow(true)
  }, [fetchNow])

  // Custom hook logic to run fetchNow when deps change
  // We use a ref to track if it's the first render or deps changed
  const depsRef = useRef(deps)
  useEffect(() => {
    let changed = false
    if (deps.length !== depsRef.current.length) {
      changed = true
    } else {
      for (let i = 0; i < deps.length; i++) {
        if (!Object.is(deps[i], depsRef.current[i])) {
          changed = true
          break
        }
      }
    }

    if (changed) {
      depsRef.current = deps
      void fetchNow(true)
    }
  }, [deps, fetchNow])

  // Initial fetch
  useEffect(() => {
    void fetchNow(true)
  }, [fetchNow])

  const networkRetryMs = options.networkRetryMs === false ? 0 : (options.networkRetryMs ?? 2000)
  useEffect(() => {
    if (networkRetryMs <= 0 || !(error instanceof TypeError)) return undefined
    const timerId = window.setTimeout(() => {
      void fetchNow(false)
    }, networkRetryMs)
    return () => window.clearTimeout(timerId)
  }, [error, fetchNow, networkRetryMs])

  useEffect(() => {
    if (!error) return undefined
    const retry = () => { void fetchNow(false) }
    const retryWhenVisible = () => {
      if (document.visibilityState === 'visible') retry()
    }
    window.addEventListener('online', retry)
    document.addEventListener('visibilitychange', retryWhenVisible)
    return () => {
      window.removeEventListener('online', retry)
      document.removeEventListener('visibilitychange', retryWhenVisible)
    }
  }, [error, fetchNow])

  useEffect(() => {
    const refreshMs = options.refreshMs
    if (!refreshMs) return undefined
    let polling = false

    const poll = async () => {
      if (polling) return
      polling = true
      await fetchNow(false)
      polling = false
    }

    const timerId = window.setInterval(poll, refreshMs)

    return () => {
      if (timerId !== undefined) {
        window.clearInterval(timerId)
      }
    }
  }, [fetchNow, options.refreshMs])

  return { data, loading, error, refetch }
}
