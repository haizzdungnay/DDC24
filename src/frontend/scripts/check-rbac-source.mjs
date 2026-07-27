import { readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const sourceRoot = join(frontendRoot, 'src')
const permissionModule = join(sourceRoot, 'auth', 'permissions.ts')
const violations = []

for (const file of sourceFiles(sourceRoot)) {
  if (file === permissionModule || /\.test\.[^.]+$/.test(file)) continue
  const source = readFileSync(file, 'utf8')
  check(file, source, /(?:\b\w*role|\.role)\s*(?:===|!==)\s*['"](?:admin|engineer|operator|viewer)['"]/gi, 'direct role comparison')
  check(file, source, /['"](?:admin|engineer|operator|viewer)['"]\s*(?:===|!==)\s*(?:\b\w*role|\.role)/gi, 'reverse direct role comparison')
  check(file, source, /\b(?:roleRank|RoleAllows|RequireRole)\b/g, 'rank-based authorization helper')
}

const backendRouter = join(frontendRoot, '..', '..', 'web', 'backend', 'http.go')
const routerSource = readFileSync(backendRouter, 'utf8')
check(backendRouter, routerSource, /\b(?:roleRank|RoleAllows)\b|\.Require\(Role/g, 'rank/role middleware in HTTP router')

if (violations.length > 0) {
  for (const violation of violations) console.error(violation)
  process.exitCode = 1
} else {
  console.log('RBAC source guard passed: authorization decisions stay capability-based.')
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return ['.ts', '.tsx'].includes(extname(entry.name)) ? [path] : []
  })
}

function check(file, source, pattern, label) {
  for (const match of source.matchAll(pattern)) {
    const line = source.slice(0, match.index).split('\n').length
    violations.push(`${relative(frontendRoot, file)}:${line}: ${label}: ${match[0]}`)
  }
}
