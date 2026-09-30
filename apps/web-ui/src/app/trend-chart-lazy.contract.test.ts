import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { execPath } from 'node:process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * T63-109 (PERF-FE-02, Plan 63 §4.2) — trang đăng nhập không tải thư viện biểu đồ.
 *
 * TRIỆU CHỨNG: cold load `/login` tải chunk `charts` (407.319 B thô / 105.076 B
 * gzip, đo Playwright/Chromium trên host) dù trang không có biểu đồ nào.
 *
 * NGUYÊN NHÂN GỐC: `shared/components/TrendChart.tsx` import `recharts` TĨNH, và
 * sáu trang import TrendChart tĩnh vào chunk entry ⇒ `charts` nằm trong đồ thị
 * tĩnh của entry ⇒ `index.html` modulepreload nó cho MỌI trang.
 *
 * Hai cổng bổ sung cho nhau:
 *   - Ở đây: đồ thị import TĨNH của mã nguồn, tính từ entry `src/app/main.tsx`,
 *     không được chạm `recharts` hay `TrendChartPlot.tsx`. Bắt lỗi ngay trong
 *     vitest, trước cả khi build.
 *   - `scripts/check-login-chunks.mjs` (chạy trong `npm run build`): đọc bản build
 *     thật, bắt cả lỗi do cấu hình chunk (`manualChunks`) mà đồ thị nguồn không
 *     thấy. Test dưới đây khoá việc nó được gọi trong `build` và self-test PASS.
 */

const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(here, '..')
const webUi = resolve(src, '..')
const entry = resolve(here, 'main.tsx')
const plot = resolve(src, 'shared/components/TrendChartPlot.tsx')

/* `import … from 'x'`, `import 'x'`, `export … from 'x'` — trừ `import type` /
 * `export type` (bị xoá khi biên dịch). `import()` động KHÔNG khớp: đó đúng là
 * ranh giới tách chunk. */
const STATIC_IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^'"`;]*?\sfrom\s*)?['"]([^'"]+)['"]/gm

/* Chỉ dùng phần Node builtin mà `src/node-builtins.d.ts` khai (dự án cố ý không
 * cài `@types/node` cho `src/`): statSync ném lỗi khi không có tệp. */
function isSourceFile(path: string): boolean {
  try {
    return !statSync(path).isDirectory() && /\.(ts|tsx)$/.test(path)
  } catch {
    return false
  }
}

function resolveLocal(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (isSourceFile(candidate)) return candidate
  }
  return null
}

/** Bao đóng import tĩnh từ `start`: file nguồn cục bộ + tên gói ngoài. */
function staticClosure(start: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>()
  const packages = new Set<string>()
  const queue = [start]
  while (queue.length) {
    const file = queue.pop() as string
    if (files.has(file)) continue
    files.add(file)
    for (const match of readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
      const specifier = match[1]
      if (specifier.startsWith('.')) {
        const target = resolveLocal(file, specifier)
        if (target) queue.push(target)
      } else {
        packages.add(specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0])
      }
    }
  }
  return { files, packages }
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

describe('T63-109 thư viện biểu đồ không nằm trong đồ thị khởi động', () => {
  it('bao đóng import tĩnh từ main.tsx không chạm recharts hay TrendChartPlot', () => {
    const { files, packages } = staticClosure(entry)
    expect(files.size).toBeGreaterThan(50) // phép duyệt thật sự đi qua ứng dụng
    expect(files.has(resolve(src, 'features/auth/LoginPage.tsx'))).toBe(true)
    expect(files.has(resolve(src, 'shared/components/TrendChart.tsx'))).toBe(true)
    expect(packages.has('recharts'), 'recharts bị import tĩnh từ đồ thị khởi động ⇒ /login tải lại chunk charts').toBe(false)
    expect(files.has(plot), 'TrendChartPlot bị import tĩnh ⇒ recharts quay lại đồ thị khởi động').toBe(false)
  })

  it('TrendChartPlot tat animation cua Line de tinh tien khong bien dang', () => {
    const plotSrc = readFileSync(plot, 'utf8')
    expect(plotSrc).toContain('isAnimationActive={false}')
  })

  it('TrendChartPlot là nơi DUY NHẤT import recharts, và chỉ được nạp qua import()', () => {
    const importers = sourceFiles(src)
      .filter((file) => [...readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)].some((m) => m[1] === 'recharts'))
      .map((file) => file.slice(src.length + 1).replace(/\\/g, '/'))
    expect(importers).toEqual(['shared/components/TrendChartPlot.tsx'])
    const chart = readFileSync(resolve(src, 'shared/components/TrendChart.tsx'), 'utf8')
    expect(chart).toContain("import('./TrendChartPlot')")
  })

  it('build chạy check-login-chunks sau vite build, và self-test của nó PASS', () => {
    const scripts = JSON.parse(readFileSync(resolve(webUi, 'package.json'), 'utf8')).scripts as Record<string, string>
    const steps = scripts.build.split('&&').map((step) => step.trim())
    const guard = steps.indexOf('node scripts/check-login-chunks.mjs')
    expect(guard).toBeGreaterThan(steps.indexOf('vite build'))
    const output = execFileSync(execPath, [resolve(webUi, 'scripts/check-login-chunks.mjs'), '--self-test'], { encoding: 'utf8' })
    expect(output).toContain('self-test: PASS (0 lỗi)')
  })
})
