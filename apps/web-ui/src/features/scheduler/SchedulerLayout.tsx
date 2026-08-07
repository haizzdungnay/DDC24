import { Outlet } from 'react-router-dom'
import { SchedulerProvider } from './useScheduler'

/**
 * Khung chung của feature Lịch vận hành.
 *
 * Ba quy ước kế thừa từ `ModbusRtuLayout`, không được vô tình đảo lại:
 *  1. `<h1>` thuộc về từng trang con ở đây (mỗi route là một màn hình độc lập,
 *     khác Modbus RTU vốn là các tab của cùng một màn hình).
 *  2. KHÔNG thêm padding — `AppShell` đã bọc `<main className="p-5">`.
 *  3. KHÔNG mở `<main>` — `AppShell` đã có một cái; `<main>` lồng `<main>` phá
 *     landmark navigation của screen reader.
 *
 * Provider bọc toàn bộ để bản nháp không mất khi chuyển giữa các route.
 */
export function SchedulerLayout() {
  return (
    <SchedulerProvider>
      <Outlet />
    </SchedulerProvider>
  )
}
