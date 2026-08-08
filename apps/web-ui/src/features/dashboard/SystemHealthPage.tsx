/**
 * PA3-F13 — `SystemHealthPage` từng chỉ là `export { DashboardPage as
 * SystemHealthPage }`, tức "sức khoẻ hệ thống" và "trang chủ" là CÙNG một
 * trang. Đó là lý do gốc khiến Dashboard bị nhồi CPU/RAM/service: nó đang phải
 * đóng cả hai vai.
 *
 * Nay hai vai tách hẳn: Landing trả lời "có ổn không", Diagnostics trả lời
 * "vì sao". Alias này giữ lại để không phá import bên ngoài, và trỏ về đúng
 * trang chẩn đoán.
 */
export { DiagnosticsPage as SystemHealthPage } from './DiagnosticsPage'
