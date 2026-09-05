import { readFileSync } from 'node:fs'
import { expect, test, type APIRequestContext, type APIResponse, type Page } from '@playwright/test'
import { login } from './helpers/session'

type JsonObject = Record<string, unknown>

const PROGRAM_ID = 'a1111111-1111-4111-8111-111111111111'
const TASK_ID = 'a2222222-2222-4222-8222-222222222222'
let sequence = 0

function nextUUID(prefix: string): string {
  sequence += 1
  return `${prefix}-0000-4000-8000-${String(sequence).padStart(12, '0')}`
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Thiếu ${name}; phải chạy qua scripts/gate369-stage-c.sh`)
  return value
}

function cliAuthority(): { source: string; diagnostic: JsonObject } {
  const source = readFileSync(requiredEnv('GATE369_ST_FIXTURE'), 'utf8')
  const payload = JSON.parse(readFileSync(requiredEnv('GATE369_CLI_DIAGNOSTIC_FILE'), 'utf8')) as JsonObject
  const diagnostics = payload.diagnostics as JsonObject[] | undefined
  if (!diagnostics?.length) throw new Error('CLI authority không có diagnostic')
  return { source, diagnostic: diagnostics[0] }
}

async function responseJSON(response: APIResponse, expectedStatus: number): Promise<JsonObject> {
  const text = await response.text()
  expect(response.status(), `${response.url()}\n${text}`).toBe(expectedStatus)
  return JSON.parse(text) as JsonObject
}

function mutationHeaders(authorization: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization,
    'content-type': 'application/json',
    'x-correlation-id': nextUUID('a3000000'),
    'x-idempotency-key': nextUUID('a4000000'),
    ...extra
  }
}

function readHeaders(authorization: string): Record<string, string> {
  return { authorization, 'x-correlation-id': nextUUID('a5000000') }
}

async function captureAuthorization(page: Page): Promise<string> {
  let authorization = ''
  const capture = (request: { url(): string; headers(): Record<string, string> }) => {
    if (!request.url().includes('/api/v1/')) return
    const candidate = request.headers().authorization ?? ''
    if (candidate.startsWith('Bearer ')) authorization = candidate
  }
  page.on('request', capture)
  try {
    await login(page)
    await page.goto('/eng/programming')
    await expect.poll(() => authorization, { timeout: 10_000 }).toMatch(/^Bearer /)
    return authorization
  } finally {
    page.off('request', capture)
  }
}

async function waitForTerminalCheck(
  request: APIRequestContext,
  authorization: string,
  checkID: string
): Promise<JsonObject> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await request.get(`/api/v1/programming/checks/${checkID}`, {
      headers: readHeaders(authorization)
    })
    const check = await responseJSON(response, 200)
    if (['PASSED', 'FAILED', 'TIMED_OUT'].includes(String(check.state))) return check
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Check ${checkID} không kết thúc trong 6 giây`)
}

function uiSeverityLabel(severity: unknown): RegExp {
  switch (String(severity).toUpperCase()) {
    case 'WARNING':
      return /Warning:|Cảnh báo:/i
    case 'INFO':
      return /Info:|Thông tin:/i
    default:
      return /Error:|Lỗi:/i
  }
}

test('GATE369-C: cùng WARNING diagnostic giữ nguyên CLI -> Go -> FE', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 900 })

  const { source, diagnostic: cliDiagnostic } = cliAuthority()
  expect(String(cliDiagnostic.severity).toUpperCase()).toBe('WARNING')

  const authorization = await captureAuthorization(page)
  const request = page.request

  const createdResponse = await request.post('/api/v1/programming/projects', {
    headers: mutationHeaders(authorization),
    data: {
      schemaVersion: '1.0',
      name: `Gate369 CLI-Go-FE ${Date.now()}`,
      description: 'REAL-BACKEND same-diagnostic provenance fixture'
    }
  })
  const created = await responseJSON(createdResponse, 201)
  const createdResource = created.resource as JsonObject
  const projectID = createdResource.projectId as string
  const draftID = createdResource.draftRevisionId as string

  const savedResponse = await request.patch(`/api/v1/programming/projects/${projectID}/draft`, {
    headers: mutationHeaders(authorization, { 'if-match': created.etag as string }),
    data: {
      schemaVersion: '1.0',
      baseRevisionId: draftID,
      operations: [
        {
          op: 'upsertProgram',
          program: {
            programId: PROGRAM_ID,
            name: 'GATE369_WARN',
            kind: 'PROGRAM',
            language: 'ST',
            document: source
          }
        },
        {
          op: 'setTask',
          task: { taskId: TASK_ID, periodMs: 1000, programOrder: [PROGRAM_ID] }
        }
      ]
    }
  })
  const saved = await responseJSON(savedResponse, 200)

  const sealedResponse = await request.post(`/api/v1/programming/projects/${projectID}/draft/revisions`, {
    headers: mutationHeaders(authorization, { 'if-match': saved.etag as string }),
    data: {
      schemaVersion: '1.0',
      baseRevisionId: draftID,
      label: 'Gate369 warning ST',
      comment: 'CLI-Go-FE warning diagnostic provenance E2E'
    }
  })
  const sealed = await responseJSON(sealedResponse, 201)
  const revisionID = (sealed.resource as JsonObject).revisionId as string

  const acceptedResponse = await request.post(`/api/v1/programming/revisions/${revisionID}/checks`, {
    headers: mutationHeaders(authorization),
    data: { schemaVersion: '1.0', targetProfile: 'MK-DDC-24-REV-A' }
  })
  const accepted = await responseJSON(acceptedResponse, 202)
  const checkID = accepted.checkId as string
  const checked = await waitForTerminalCheck(request, authorization, checkID)

  // Cảnh báo là ca quyết định của F-STED-004: Check PHẢI PASSED trong khi vẫn
  // mang diagnostic WARNING. Nếu Go lại đè WARNING thành ERROR, vế này hoặc
  // phép so severity bên dưới sẽ đỏ thay vì cho một false-green.
  expect(checked.state).toBe('PASSED')
  const apiDiagnostics = checked.diagnostics as JsonObject[]
  expect(apiDiagnostics.length).toBeGreaterThan(0)

  const apiDiagnostic = apiDiagnostics.find((item) => item.detailCode === cliDiagnostic.code)
  expect(apiDiagnostic, `Không tìm thấy CLI diagnostic ${String(cliDiagnostic.code)} trong Go API`).toBeTruthy()
  const api = apiDiagnostic as JsonObject
  const location = api.location as JsonObject

  // Đây là biên CLI -> Go thật. `code` compiler đi vào `detailCode` domain;
  // message/severity/span phải giữ nguyên ý nghĩa, không được bị đè, mất hoặc
  // co về một điểm. `sourceId` của CLI validate có thể rỗng vì nó chỉ biết file;
  // tầng orchestration gắn source đó vào PROGRAM_ID nên kiểm anchor riêng.
  expect(api.detailCode).toBe(cliDiagnostic.code)
  expect(api.message).toBe(cliDiagnostic.message)
  expect(String(api.severity).toLowerCase()).toBe(String(cliDiagnostic.severity).toLowerCase())
  expect(location.line).toBe(cliDiagnostic.line)
  expect(location.column).toBe(cliDiagnostic.column)
  expect(location.length).toBe(cliDiagnostic.length)
  expect(location.programId).toBe(PROGRAM_ID)

  await page.goto(
    `/eng/programming/projects/${projectID}/commission?revisionId=${encodeURIComponent(revisionID)}&checkId=${encodeURIComponent(checkID)}`
  )

  await expect(page.getByText('PASSED', { exact: true })).toBeVisible()
  const problems = page.getByRole('region', { name: /Danh sách lỗi|Problems list/i })
  await expect(problems).toBeVisible()

  // Biên Go -> FE: dùng CHÍNH payload API vừa được đối chiếu với CLI authority.
  await expect(problems).toContainText(String(api.code))
  await expect(problems).toContainText(String(api.detailCode))
  await expect(problems).toContainText(String(api.message))
  await expect(problems).toContainText(PROGRAM_ID.slice(0, 8))
  await expect(problems).toContainText(String(location.line))
  await expect(problems).toContainText(String(location.column))
  // Severity trong ProblemsDrawer có kênh screen-reader riêng. Khóa chính nhãn
  // này để WARNING -> ERROR ở FE không thể lọt qua chỉ vì màu/icon vẫn trông hợp lý.
  await expect(problems).toContainText(uiSeverityLabel(api.severity))
})
