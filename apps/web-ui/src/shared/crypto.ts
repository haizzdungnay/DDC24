import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

/**
 * Sinh UUID v4 cả trên HTTP của controller. `Crypto.randomUUID()` bị trình
 * duyệt khóa ngoài secure context, còn `getRandomValues()` vẫn là primitive
 * được Web Crypto cho phép trên HTTP. Không dùng `Math.random()` vì các khóa
 * idempotency/correlation không được phép suy giảm entropy âm thầm.
 */
export function createUuid(): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID().toLowerCase()
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') {
    throw new Error('Trình duyệt không cung cấp nguồn số ngẫu nhiên an toàn.')
  }

  const bytes = cryptoApi.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytesToHex(bytes)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** SHA-256 thuần JavaScript để import bundle hoạt động trên endpoint HTTP. */
export function sha256Hex(value: Uint8Array): string {
  return bytesToHex(sha256(value))
}

/** Mã hóa theo khối để không tràn call stack với bundle có kích thước MiB. */
export function bytesToBase64(value: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ''
  for (let offset = 0; offset < value.length; offset += chunkSize) {
    binary += String.fromCharCode(...value.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}
