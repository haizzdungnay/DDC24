import { useMemo } from 'react'
import { useAuth } from '../../auth'
import { API_ORIGIN } from '../../../shared/config'
import { ProgrammingApiClient } from './generated/client'

/**
 * `ProgrammingApiClient` sinh tự động không tự gắn `Authorization` — đây là
 * điểm mở rộng đúng chỗ (constructor nhận `fetchImpl`), không phải lỗ hổng.
 * Hook này bọc đúng một lần để mọi workspace dùng chung một client đã có
 * header thật từ `AuthProvider`, không tự viết fetch riêng (DDD-FE-PROG-001 §1).
 */
export function useProgrammingApiClient(): ProgrammingApiClient {
  const { getAuthHeader } = useAuth()
  return useMemo(() => {
    const authenticatedFetch: typeof fetch = (input, init) => {
      const headers = new Headers(init?.headers)
      for (const [key, value] of Object.entries(getAuthHeader())) headers.set(key, value)
      return fetch(input, { ...init, headers })
    }
    return new ProgrammingApiClient(API_ORIGIN, authenticatedFetch)
  }, [getAuthHeader])
}
