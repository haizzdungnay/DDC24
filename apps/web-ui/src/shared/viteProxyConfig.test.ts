import { describe, expect, it } from 'vitest'
import { developmentProxy } from '../../vite.config'

describe('developmentProxy', () => {
  it.each([
    ['http://127.0.0.1:8081', 'ws://127.0.0.1:8081'],
    ['https://controller.test', 'wss://controller.test']
  ])('đổi %s sang %s và rewrite Origin cho WebSocket dev', (target, expected) => {
    const proxy = developmentProxy(target)
    expect(Object.keys(proxy)).toEqual(['^/api/v1/ws(?:/|$)', '/api'])
    expect(proxy['^/api/v1/ws(?:/|$)']).toEqual({
      target: expected,
      ws: true,
      changeOrigin: true,
      rewriteWsOrigin: true,
      secure: false
    })
    expect(proxy['/api']).toEqual({ target, ws: true, changeOrigin: true, secure: false })
  })
})
