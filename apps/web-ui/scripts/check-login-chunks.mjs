#!/usr/bin/env node
/* T63-109 (PERF-FE-02, Plan 63 §4.2) — trang đăng nhập không được tải thư viện biểu đồ.
 *
 * Đọc CHÍNH bản build: đồ thị tải ban đầu = script entry + mọi `modulepreload`
 * trong `index.html` + import TĨNH (`from"./x.js"`, `import"./x.js"`) của các
 * chunk đó, lần theo bắc cầu. `import()` động không tính: đó là chunk chỉ về khi
 * có trang cần. Trang `/login` nằm trong chunk entry nên đồ thị này đúng là
 * những gì trình duyệt tải khi mở `/login`.
 *
 * Nhận diện thư viện biểu đồ bằng NỘI DUNG, không bằng tên chunk: chuỗi lớp CSS
 * `recharts-wrapper` là literal trong mã recharts và còn nguyên sau minify. Đổi
 * `manualChunks` hay gộp recharts vào chunk khác cũng không qua được cổng này.
 * Cổng cũng đòi dấu đó CÓ MẶT ở đâu đó trong build — nếu không thì dấu nhận
 * diện đã hết hiệu lực và phép kiểm "không có" chẳng chứng minh gì.
 *
 *   node scripts/check-login-chunks.mjs [--dist DIR]   (mặc định build/web-ui/dist)
 *   node scripts/check-login-chunks.mjs --self-test
 */
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

export const CHART_SIGNATURE = 'recharts-wrapper'
const here = dirname(fileURLToPath(import.meta.url))
const DEFAULT_DIST = resolve(here, '../../../build/web-ui/dist')

const ENTRY_RE = /<script[^>]*type="module"[^>]*src="\/?([^"]+\.js)"/g
const PRELOAD_RE = /<link[^>]*rel="modulepreload"[^>]*href="\/?([^"]+\.js)"/g
const STATIC_IMPORT_RE = /(?:\bfrom|\bimport)\s*"(\.\/[^"]+\.js)"/g

/** Tập chunk JS tải ban đầu (đường dẫn tương đối so với dist). */
export function initialChunks(distDir) {
  const html = readFileSync(join(distDir, 'index.html'), 'utf8')
  const queue = [...html.matchAll(ENTRY_RE), ...html.matchAll(PRELOAD_RE)].map((m) => m[1])
  const seen = new Set()
  while (queue.length) {
    const rel = queue.shift()
    if (seen.has(rel)) continue
    seen.add(rel)
    const path = join(distDir, rel)
    if (!existsSync(path)) continue
    for (const m of readFileSync(path, 'utf8').matchAll(STATIC_IMPORT_RE)) {
      queue.push(join(dirname(rel), m[1]).replaceAll('\\', '/'))
    }
  }
  return [...seen].sort()
}

export function checkLoginChunks(distDir) {
  const initial = initialChunks(distDir)
  const problems = []
  if (!initial.length) problems.push('index.html không có script entry nào')
  for (const rel of initial) {
    const path = join(distDir, rel)
    if (!existsSync(path)) problems.push(`${rel}: được index.html tham chiếu nhưng không có trong build`)
    else if (readFileSync(path, 'utf8').includes(CHART_SIGNATURE)) {
      problems.push(`${rel}: chứa thư viện biểu đồ (${CHART_SIGNATURE}) mà nằm trong đồ thị tải ban đầu của /login`)
    }
  }
  const assets = join(distDir, 'assets')
  const signed = existsSync(assets)
    ? readdirSync(assets).filter((name) => name.endsWith('.js') && readFileSync(join(assets, name), 'utf8').includes(CHART_SIGNATURE))
    : []
  if (!signed.length) problems.push(`không chunk nào chứa ${CHART_SIGNATURE}: dấu nhận diện hết hiệu lực, cổng không chứng minh được gì`)
  return { initial, chartChunks: signed.map((name) => `assets/${name}`), problems }
}

function selfTest() {
  const failures = []
  const expect = (label, ok) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`)
    if (!ok) failures.push(label)
  }
  const make = (files) => {
    const dir = mkdtempSync(join(tmpdir(), 'login-chunks-'))
    mkdirSync(join(dir, 'assets'))
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body)
    return dir
  }
  const html = (preloads) => `<script type="module" crossorigin src="/assets/index-A.js"></script>` +
    preloads.map((p) => `<link rel="modulepreload" crossorigin href="/assets/${p}">`).join('')
  const charts = 'var c="recharts-wrapper";export{c}'
  const dirs = []
  try {
    const good = make({
      'index.html': html(['react-B.js']),
      'assets/index-A.js': 'import{a}from"./react-B.js";const p=()=>import("./charts-C.js")',
      'assets/react-B.js': 'export const a=1',
      'assets/charts-C.js': charts
    })
    dirs.push(good)
    const result = checkLoginChunks(good)
    expect('entry + modulepreload được tính', result.initial.join(',') === 'assets/index-A.js,assets/react-B.js')
    expect('import() động không tính vào đồ thị ban đầu', result.problems.length === 0)
    expect('tìm thấy chunk biểu đồ theo nội dung', result.chartChunks.join(',') === 'assets/charts-C.js')

    const preloaded = make({
      'index.html': html(['react-B.js', 'charts-C.js']),
      'assets/index-A.js': 'import{a}from"./react-B.js"',
      'assets/react-B.js': 'export const a=1',
      'assets/charts-C.js': charts
    })
    dirs.push(preloaded)
    expect('bắt biểu đồ trong modulepreload', checkLoginChunks(preloaded).problems.some((p) => p.includes('charts-C.js')))

    const transitive = make({
      'index.html': html([]),
      'assets/index-A.js': 'import"./mid-D.js"',
      'assets/mid-D.js': 'import{c}from"./renamed-E.js"',
      'assets/renamed-E.js': charts
    })
    dirs.push(transitive)
    expect('bắt biểu đồ qua import tĩnh bắc cầu, dù chunk đổi tên', checkLoginChunks(transitive).problems.some((p) => p.includes('renamed-E.js')))

    const merged = make({
      'index.html': html([]),
      'assets/index-A.js': `${charts};export const app=1`
    })
    dirs.push(merged)
    expect('bắt biểu đồ bị gộp thẳng vào entry', checkLoginChunks(merged).problems.some((p) => p.includes('index-A.js')))

    const unsigned = make({
      'index.html': html([]),
      'assets/index-A.js': 'const p=()=>import("./charts-C.js")',
      'assets/charts-C.js': 'export const x=1'
    })
    dirs.push(unsigned)
    expect('không thấy dấu nhận diện ở đâu ⇒ FAIL chứ không PASS rỗng', checkLoginChunks(unsigned).problems.some((p) => p.includes('hết hiệu lực')))
  } finally {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  }
  console.log(`self-test: ${failures.length ? 'FAIL' : 'PASS'} (${failures.length} lỗi)`)
  return failures.length ? 1 : 0
}

function main(argv) {
  if (argv.includes('--self-test')) return selfTest()
  const at = argv.indexOf('--dist')
  const distDir = at >= 0 ? resolve(argv[at + 1]) : DEFAULT_DIST
  if (!existsSync(join(distDir, 'index.html'))) {
    console.error(`check-login-chunks: không thấy ${distDir}/index.html — chạy vite build trước`)
    return 1
  }
  const { initial, chartChunks, problems } = checkLoginChunks(distDir)
  console.log(`check-login-chunks: đồ thị tải ban đầu ${initial.length} chunk (${initial.join(', ')}); ` +
    `thư viện biểu đồ ở ${chartChunks.join(', ') || '(không thấy)'}`)
  for (const problem of problems) console.error(`check-login-chunks: ${problem}`)
  return problems.length ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)))
}
