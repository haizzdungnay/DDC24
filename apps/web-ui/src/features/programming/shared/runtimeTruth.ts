import type { ProgrammingRuntime, RemoteState } from '../model/types'

export type ProgrammingCoreTruth = 'loading' | 'ready' | 'degraded' | 'unavailable' | 'stale' | 'unknown'

/** Chỉ `READY` từ một lần đọc thành công mới được xem là Core sẵn sàng.
 * Snapshot giữ lại sau lỗi và enum lạ đều fail-closed. */
export function programmingCoreTruth(
  runtime: Pick<RemoteState<ProgrammingRuntime>, 'status' | 'data'>
): ProgrammingCoreTruth {
  if (runtime.status === 'loading') return 'loading'
  if (runtime.status === 'error') return runtime.data ? 'stale' : 'unavailable'
  if (!runtime.data) return 'unknown'

  const producerState = (runtime.data as { producerState?: unknown }).producerState
  if (producerState === 'READY') return 'ready'
  if (producerState === 'DEGRADED') return 'degraded'
  if (producerState === 'UNAVAILABLE') return 'unavailable'
  return 'unknown'
}

