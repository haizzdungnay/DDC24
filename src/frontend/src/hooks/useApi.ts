import { useCallback, useEffect, useRef, useState } from 'react'

export interface ApiState<T> {
  data: T | null
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

interface UseApiOptions {
  refreshMs?: number
}

export function useApi<T>(fetcher: () => Promise<T>, _deps: unknown[] = [], options: UseApiOptions = {}): ApiState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const isMounted = useRef(true)
  const fetcherRef = useRef(fetcher)
  const optionsRef = useRef(options)

  useEffect(() => {
    fetcherRef.current = fetcher
  }, [fetcher])

  useEffect(() => {
    optionsRef.current = options
  }, [options])

  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
    }
  }, [])

  const fetchNow = useCallback(async (showLoading: boolean) => {
    if (!isMounted.current) return
    if (showLoading) setLoading(true)
    setError(null)
    try {
      const result = await fetcherRef.current()
      if (isMounted.current) {
        setData(result)
      }
    } catch (err) {
      if (isMounted.current) {
        setError(err instanceof Error ? err : new Error(String(err)))
      }
    } finally {
      if (isMounted.current && showLoading) {
        setLoading(false)
      }
    }
  }, [])

  const refetch = useCallback(async () => {
    await fetchNow(true)
  }, [fetchNow])

  useEffect(() => {
    void fetchNow(true)
  }, [fetchNow])

  useEffect(() => {
    const refreshMs = optionsRef.current.refreshMs
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
  }, [fetchNow])

  return { data, loading, error, refetch }
}
