import type { DdcMode } from './types'

export const DDC_MODE: DdcMode = import.meta.env.VITE_DDC_MODE === 'live' ? 'live' : 'demo'
export const IS_DEMO = DDC_MODE === 'demo'
export const API_ORIGIN = import.meta.env.VITE_API_ORIGIN || ''
export const WS_ORIGIN = import.meta.env.VITE_WS_ORIGIN || ''
export const AUTH_MODE = import.meta.env.VITE_AUTH_MODE || (IS_DEMO ? 'mock' : 'none')
export const DEVICE_DEFAULTS = {
  model: 'MK-DDC-24',
  name: 'DDC24-AC',
  ip: '192.168.1.100',
  bacnetDeviceId: '47808',
  firmware: 'v1.3.7',
  serial: 'DDC24AC2501001'
}
