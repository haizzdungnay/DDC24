import { createContext, useContext } from 'react'
import type React from 'react'
import { useWebSocket } from './hooks/useWebSocket'

type RealtimeValue = ReturnType<typeof useWebSocket>
const RealtimeContext = createContext<RealtimeValue | null>(null)

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const value = useWebSocket()
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
}

export function useRealtime(): RealtimeValue {
  const ctx = useContext(RealtimeContext)
  if (!ctx) throw new Error('useRealtime must be used inside RealtimeProvider')
  return ctx
}

/**
 * `SW-PGM03-LIVE-001` — biến thể KHÔNG ném lỗi khi thiếu `RealtimeProvider`.
 *
 * Dành cho màn hình coi kênh sống là NGUỒN BỔ SUNG chứ không phải điều kiện để
 * dựng giao diện: workbench Ánh xạ vẫn phải hiển thị đủ danh mục điểm và cho
 * review binding ngay cả khi không có kênh WebSocket, chỉ là giá trị đứng im ở
 * lần đọc danh mục gần nhất.
 *
 * `null` ở đây có đúng một nghĩa: "không có kênh sống nào để đọc". Nơi gọi phải
 * xử lý nó như dữ liệu đứng im, KHÔNG được coi là dữ liệu tươi.
 */
export function useOptionalRealtime(): RealtimeValue | null {
  return useContext(RealtimeContext)
}
