import { afterEach, describe, expect, it, vi } from 'vitest'
import { bytesToBase64, createUuid, sha256Hex } from './crypto'

const originalCrypto = globalThis.crypto

afterEach(() => {
  vi.unstubAllGlobals()
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto })
})

describe('crypto helpers cho endpoint HTTP', () => {
  it('fallback qua getRandomValues tạo UUID v4 hợp lệ khi randomUUID không có', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
      return bytes
    })
    vi.stubGlobal('crypto', { getRandomValues })

    expect(createUuid()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f')
    expect(getRandomValues).toHaveBeenCalledTimes(1)
  })

  it('không hạ cấp sang Math.random khi browser thiếu nguồn ngẫu nhiên an toàn', () => {
    vi.stubGlobal('crypto', {})
    expect(() => createUuid()).toThrow('nguồn số ngẫu nhiên an toàn')
  })

  it('băm SHA-256 và base64 không phụ thuộc crypto.subtle', () => {
    const bytes = new TextEncoder().encode('MK-DDC-24')
    expect(sha256Hex(bytes)).toBe('3b79d0524c6ec4476430c2c8625994bc5a7da1ef5c02637874dc9fb3b68a1b27')
    expect(bytesToBase64(bytes)).toBe('TUstRERDLTI0')
  })
})
