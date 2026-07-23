import type { DdcMode } from './types'
import { PRODUCT_INFO } from './productInfo'

export const DDC_MODE: DdcMode = import.meta.env.VITE_DDC_MODE === 'live' ? 'live' : 'demo'
export const IS_DEMO = DDC_MODE === 'demo'
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
