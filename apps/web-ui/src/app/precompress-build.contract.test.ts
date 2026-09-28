import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { execPath } from 'node:process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * T63-104 (PERF-FE-01, Plan 63 §4.2) — cổng canh bước nén sẵn JS/CSS.
 *
 * mkddc-web chỉ phục vụ `.gz` khi file đó CÓ trên đĩa (`static_gzip.go`); nó không
 * nén lúc chạy để khỏi tốn CPU của SOM. Nên nếu bước nén rơi khỏi `build`, không
 * gì đỏ cả: trang vẫn chạy, chỉ là mỗi cold load kéo lại ~1,2 MiB thô. Cổng này
 * đọc CHÍNH `package.json` và chạy self-test của script nén.
 */

const here = dirname(fileURLToPath(import.meta.url))
const webUi = resolve(here, '../..')
const script = resolve(webUi, 'scripts/precompress-assets.mjs')

describe('T63-104 nén sẵn tài nguyên FE lúc build', () => {
  it('build chạy precompress sau vite build (trước bundle budget), và build:release đi qua build', () => {
    const scripts = JSON.parse(readFileSync(resolve(webUi, 'package.json'), 'utf8')).scripts as Record<string, string>
    const steps = scripts.build.split('&&').map((step) => step.trim())
    const vite = steps.indexOf('vite build')
    const precompress = steps.indexOf('node scripts/precompress-assets.mjs')
    expect(vite).toBeGreaterThanOrEqual(0)
    expect(precompress).toBeGreaterThan(vite)
    expect(precompress).toBeLessThan(steps.indexOf('npm run check:bundle-budget'))
    expect(scripts['build:release']).toContain('npm run build')
  })

  it('self-test của script nén PASS (nén đúng, bỏ file nhỏ/không nén được, verify bắt .gz lệch)', () => {
    const output = execFileSync(execPath, [script, '--self-test'], { encoding: 'utf8' })
    expect(output).toContain('self-test: PASS (0 lỗi)')
  })
})
