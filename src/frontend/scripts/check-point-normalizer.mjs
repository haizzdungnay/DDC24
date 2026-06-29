import assert from 'node:assert/strict'
import { createServer } from 'vite'

const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true }
})

try {
  const { normalizePoint, pointRecordsFrom } = await server.ssrLoadModule('/src/api/pointNormalizer.ts')
  const records = pointRecordsFrom({
    data: {
      points: [
        { point_id: 'AI-1', kind: 'analog_input', present_value: '23.5', q: 'good' },
        { channel: 2, type: 'universal_input', state: 'on', status: 'online' },
        { id: '3', type: 'analog_output', value: '44.2' }
      ]
    }
  })
  const points = records.map(normalizePoint)

  assert.deepEqual(points.map((point) => point.id), ['UI-01', 'UI-02', 'AO-03'])
  assert.equal(points[0].value, 23.5)
  assert.equal(points[1].value, true)
  assert.equal(points[2].kind, 'AO')

  const { apiClient } = await server.ssrLoadModule('/src/api/client.ts')
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: false, status: 401, statusText: 'Unauthorized', text: async () => 'Unauthorized' })
  let fallbackPoints
  try {
    fallbackPoints = await apiClient.getPoints()
  } finally {
    globalThis.fetch = previousFetch
  }

  assert.equal(fallbackPoints.filter((point) => point.kind === 'UI').length, 16)
} finally {
  await server.close()
}
