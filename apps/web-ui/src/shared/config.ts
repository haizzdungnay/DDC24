import type { DdcMode } from './types'
import { PRODUCT_INFO } from './productInfo'

export const DDC_MODE: DdcMode = import.meta.env.VITE_DDC_MODE === 'live' ? 'live' : 'demo'
export const IS_DEMO = DDC_MODE === 'demo'
export function isLegacyGraphDemoEnabled(mode: DdcMode, flag: string | undefined): boolean {
  return mode === 'demo' && flag === '1'
}
export const LEGACY_GRAPH_DEMO_ENABLED = isLegacyGraphDemoEnabled(DDC_MODE, import.meta.env.VITE_ENABLE_LEGACY_GRAPH_DEMO)
// TASK-PROG-500 (UX-WEB-PROG-001 §28): cờ Programming Rev A, mặc định TẮT.
// Bật cờ chỉ mở route/shell bốn workspace; nó KHÔNG tự mở quyền mutation —
// quyền đó vẫn do server (`PROGRAMMING_REV_A` env của web-api) và RBAC quyết
// định. Không bật ở production tới khi TLS + UX-T-001..006 PASS.
export const PROGRAMMING_REV_A_ENABLED = import.meta.env.VITE_PROGRAMMING_REV_A === '1'
/**
 * PGM-02 R1 (`T59-802`) — cờ rollback riêng cho workspace Programs v2.
 *
 * Mặc định TẮT theo DDD-SW-PGM02-WORKSPACE-001 §11: triển khai FE mới không
 * được tự cut-over route trước khi cùng phiên bản BE/contract được bật. Cờ này
 * chỉ chọn surface/route; backend vẫn là authority cuối của mọi mutation.
 */
export function isProgramsWorkspaceV2Enabled(flag: string | undefined): boolean {
  return flag === '1'
}
export const PROGRAMS_WORKSPACE_V2_ENABLED = isProgramsWorkspaceV2Enabled(import.meta.env.VITE_PROGRAMS_WORKSPACE_V2)
export function isFbdEditEnabled(flag: string | undefined): boolean {
  return flag === '1'
}
export const FBD_EDIT_ENABLED = isFbdEditEnabled(
  import.meta.env.VITE_FBD_EDIT
)
export const API_ORIGIN = import.meta.env.VITE_API_ORIGIN || ''
export const WS_ORIGIN = import.meta.env.VITE_WS_ORIGIN || ''
export const AUTH_MODE = import.meta.env.VITE_AUTH_MODE || (IS_DEMO ? 'mock' : 'jwt')
// Live builds use the activated v2 authority; explicit 0 remains the rollback switch.
export const HISTORIAN_V2_TRENDS_ENABLED = !IS_DEMO && import.meta.env.VITE_HISTORIAN_V2_TRENDS !== '0'
export const DEVICE_DEFAULTS = {
  model: PRODUCT_INFO.model,
  name: PRODUCT_INFO.name,
  ip: PRODUCT_INFO.ip,
  bacnetDeviceId: PRODUCT_INFO.bacnetDeviceId,
  firmware: PRODUCT_INFO.firmware,
  serial: PRODUCT_INFO.serial
}
