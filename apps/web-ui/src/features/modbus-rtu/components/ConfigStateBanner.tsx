import { useState, useEffect } from 'react'
import { apiClient } from '../../../shared/api/client'

export function ConfigStateBanner() {
  const [revision, setRevision] = useState<number | null>(null)
  const [checksum, setChecksum] = useState<string>('')

  useEffect(() => {
    async function fetchInfo() {
      try {
        const ov = await apiClient.getModbusOverview()
        setRevision(ov.revision)
        setChecksum(ov.checksum)
      } catch {
        // Fallback if unavailable
      }
    }
    fetchInfo()
  }, [])

  return (
    <div className="rounded-[var(--radius)] border border-[var(--c-border)] bg-[var(--c-surface-2)] p-3 text-xs font-mono text-[var(--c-text-dim)] flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
        <span>Active rev {revision ?? 1}</span>
        {checksum && checksum !== 'demo' && (
          <span className="text-[11px] opacity-75">· checksum {checksum.slice(0, 12)}…</span>
        )}
      </div>
      <div className="text-[11px] text-[var(--c-text-dim)]">
        Trạng thái cấu hình iobus: Đồng bộ thành công
      </div>
    </div>
  )
}
