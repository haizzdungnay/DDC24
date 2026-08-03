import packageInfo from '../../package.json'

const productCode = import.meta.env.VITE_PRODUCT_CODE || 'DDC24'

export const PRODUCT_INFO = {
  code: productCode,
  model: import.meta.env.VITE_PRODUCT_MODEL || productCode,
  name: import.meta.env.VITE_DEVICE_NAME || productCode,
  firmware: import.meta.env.VITE_FIRMWARE_VERSION || packageInfo.version,
  serial: import.meta.env.VITE_DEVICE_SERIAL || productCode,
  ip: import.meta.env.VITE_DEVICE_IP || '192.168.1.100',
  bacnetDeviceId: import.meta.env.VITE_BACNET_DEVICE_ID || '47808'
} as const
