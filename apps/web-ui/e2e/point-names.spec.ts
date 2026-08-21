import { expect, test, type Page } from '@playwright/test'
import { createPointNameFixture, installPointNameApiFixture, type FixturePoint, type FixtureVirtualPoint, type PointNameFixtureState } from './point-name-fixtures'

const updatedAt = '2026-07-23T00:00:00.000Z'
const pointKinds = ['UI', 'AO', 'DO', 'VP'] as const
const occupiedName = 'Phòng Áp Suất'
const occupiedDraft = '  PHÒNG   ÁP SUẤT  '

type EditorKind = typeof pointKinds[number]

function physicalPoint(id: FixturePoint['id'], kind: Exclude<FixturePoint['kind'], 'virtual'>, name: string, value: number | boolean): FixturePoint {
  return { id, tag: id, name, kind, value, quality: 'good', source: 'runtime', updatedAt }
}

function virtualPoint(overrides: Partial<FixtureVirtualPoint> = {}): FixtureVirtualPoint {
  return {
    id: 'VP1',
    channel: 25,
    tag: 'ZONE_TEMP',
    name: 'Zone Temperature',
    label: 'Zone Temperature',
    signalType: 'float',
    enabled: true,
    writable: true,
    logEnabled: true,
    logIntervalMs: 15_000,
    value: 22.5,
    unit: 'degC',
    generation: 7,
    updatedAt,
    ...overrides
  }
}

async function login(page: Page) {
  // Spec này kiểm chính xác copy tiếng Anh. Khai báo locale thay vì phụ thuộc
  // ngôn ngữ mặc định của ứng dụng (profile mới hiện mặc định tiếng Việt theo
  // navigator.language — xem playwright.config.ts và network-qa.spec.ts).
  await page.addInitScript(() => window.localStorage.setItem('mkddc-lang', 'en'))
  await page.goto('/login')
  // T59-604: chờ ĐIỀU KIỆN, không đua với dev server. `fill()` tự chờ element
  // editable nhưng tính vào timeout của cả test (30 s); khi máy build song song
  // chiếm hết CPU, vite biên dịch theo yêu cầu lâu hơn ngần ấy và test chết ở
  // `fill` — triệu chứng trông như flake của chính spec, thật ra là đói CPU.
  // Chờ tường minh tách hai thứ đó ra: hết hạn ở đây nói "trang chưa sẵn sàng",
  // không nói "điền không được".
  const username = page.getByLabel('Username', { exact: true })
  await expect(username).toBeEditable({ timeout: 60_000 })
  await username.fill('admin')
  await page.getByLabel('Password', { exact: true }).fill('e2e')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/login$/)
}

async function openVirtualPoints(page: Page) {
  await page.getByRole('link', { name: 'Virtual Points', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Virtual Points' })).toBeVisible()
}

function pointId(kind: EditorKind): string {
  return kind === 'VP' ? 'VP1' : `${kind}-01`
}

function namespaceFixture(origin: EditorKind, owner: EditorKind, legacyDuplicate = false): PointNameFixtureState {
  const names = Object.fromEntries(pointKinds.map((kind) => [kind, `${kind} unique name`])) as Record<EditorKind, string>
  names[owner] = occupiedName
  if (legacyDuplicate) names[origin] = occupiedDraft
  return createPointNameFixture({
    points: [
      physicalPoint('UI-01', 'UI', names.UI, 21),
      physicalPoint('AO-01', 'AO', names.AO, 0),
      physicalPoint('DO-01', 'DO', names.DO, false)
    ],
    virtualPoints: [virtualPoint({ name: names.VP, label: names.VP, enabled: false })]
  })
}

async function openPointEditor(page: Page, kind: EditorKind): Promise<void> {
  const linkName = kind === 'UI' ? 'Inputs Config' : kind === 'VP' ? 'Virtual Points' : 'Outputs Config'
  await page.getByRole('link', { name: linkName, exact: true }).click()
  if (kind === 'UI') await expect(page.getByRole('heading', { name: 'UI Inputs Config' })).toBeVisible()
  if (kind === 'VP') await expect(page.getByRole('heading', { name: 'Virtual Points' })).toBeVisible()
  if (kind === 'AO' || kind === 'DO') {
    await expect(page.getByRole('heading', { name: 'Outputs Config' })).toBeVisible()
    if (kind === 'DO') await page.getByRole('button', { name: /DO-01/ }).click()
  }
}

function displayNameField(page: Page, kind: EditorKind) {
  return page.getByRole('textbox', { name: 'Label' })
}

async function savePointEditor(page: Page, kind: EditorKind): Promise<void> {
  await page.getByRole('button', { name: 'Save', exact: true }).first().click()
  const title = kind === 'UI' ? 'Save UI config?' : kind === 'VP' ? 'Save Virtual Point?' : 'Save Outputs config?'
  await page.getByRole('dialog', { name: title }).getByRole('button', { name: 'OK' }).click()
}

function pointNamePath(kind: EditorKind): string {
  return kind === 'VP' ? 'items[0].label' : `${kind.toLowerCase()}[0].name`
}

for (const origin of pointKinds) {
  for (const owner of pointKinds.filter((kind) => kind !== origin)) {
    test(`${origin} rename rejects the Unicode/case/whitespace name reserved by ${owner}`, async ({ page }) => {
      const state = namespaceFixture(origin, owner)
      await installPointNameApiFixture(page, state)
      await login(page)
      await openPointEditor(page, origin)

      const name = displayNameField(page, origin)
      await name.fill(occupiedDraft)
      if (origin === 'VP') await page.getByRole('textbox', { name: 'Tag' }).fill('UNSAVED_CONFLICT_TAG')
      await savePointEditor(page, origin)

      await expect.poll(() => state.conflictResponses.length).toBe(1)
      expect(state.conflictResponses[0]).toEqual({
        path: pointNamePath(origin),
        reason: 'point_name_conflict',
        message: 'display name is already used',
        pointId: pointId(origin),
        conflictPointId: pointId(owner),
        conflictPath: pointNamePath(owner)
      })
      await expect(page.getByText(`display name is already used (conflicts with ${pointId(owner)})`)).toBeVisible()
      await expect(name).toHaveValue(occupiedDraft)
      await expect(name).toBeFocused()
      if (origin === 'VP') await expect(page.getByRole('textbox', { name: 'Tag' })).toHaveValue('UNSAVED_CONFLICT_TAG')
      expect(state.nameWrites).toHaveLength(0)
      if (origin === 'VP') {
        expect(state.virtualPointWrites).toHaveLength(1)
        expect(state.virtualPointWrites[0].body.name).toBeUndefined()
        expect(state.virtualPointWrites[0].body.label).toBe(occupiedDraft.trim().replace(/\s+/gu, ' '))
        expect(state.ioWrites).toHaveLength(0)
      } else {
        expect(state.ioWrites).toHaveLength(1)
        expect(state.virtualPointWrites).toHaveLength(0)
      }
    })
  }
}

for (const [index, origin] of pointKinds.entries()) {
  const owner = pointKinds[(index + 1) % pointKinds.length]
  test(`${origin} resolves a legacy duplicate with ${owner} through a name-only recovery`, async ({ page }) => {
    const state = namespaceFixture(origin, owner, true)
    await installPointNameApiFixture(page, state)
    await login(page)
    await openPointEditor(page, origin)

    await expect(page.getByRole('alert').filter({ hasText: `${pointId(origin)} also matches ${pointId(owner)}` })).toBeVisible()
    const name = displayNameField(page, origin)
    const recoveredName = `Recovered ${origin} name`
    if (origin === 'UI') await page.getByRole('checkbox', { name: 'Enable Channel' }).uncheck()
    if (origin === 'VP') await page.getByRole('textbox', { name: 'Tag' }).fill('UNSAVED_RECOVERY_TAG')
    await name.fill(recoveredName)
    await savePointEditor(page, origin)

    await expect.poll(() => state.nameWrites.length).toBe(1)
    expect(state.nameWrites[0]).toEqual({ id: pointId(origin), body: { name: recoveredName } })
    expect(state.conflictResponses).toHaveLength(0)
    expect(state.ioWrites).toHaveLength(0)
    expect(state.virtualPointWrites).toHaveLength(0)
    await expect(name).toHaveValue(recoveredName)
    await expect(page.getByRole('alert').filter({ hasText: `${pointId(origin)} also matches ${pointId(owner)}` })).toHaveCount(0)
    if (origin === 'UI') await expect(page.getByRole('checkbox', { name: 'Enable Channel' })).not.toBeChecked()
    if (origin === 'VP') await expect(page.getByRole('textbox', { name: 'Tag' })).toHaveValue('UNSAVED_RECOVERY_TAG')
  })
}

test('shows disabled VP cross-kind conflict and preserves the draft after a structured 409', async ({ page }) => {
  const state = createPointNameFixture({
    points: [
      physicalPoint('AO-01', 'AO', 'Reserved by disabled VP', 0),
      physicalPoint('UI-01', 'UI', 'Occupied Draft', 21)
    ],
    virtualPoints: [virtualPoint({ id: 'VP9', channel: 33, tag: 'DISABLED_VP', name: ' Reserved by   disabled VP ', label: ' Reserved by   disabled VP ', enabled: false, generation: 3 })]
  })
  await installPointNameApiFixture(page, state)
  await login(page)
  await openVirtualPoints(page)

  const name = page.getByRole('textbox', { name: 'Label' })
  const tag = page.getByRole('textbox', { name: 'Tag' })
  await expect(name).toHaveValue('Reserved by disabled VP')
  await expect(page.getByRole('checkbox', { name: 'Enabled' })).not.toBeChecked()
  await expect(page.getByRole('alert').filter({ hasText: 'VP9 also matches AO-01' })).toBeVisible()

  await tag.fill('UNSAVED_TECH_TAG')
  await name.fill('Occupied Draft')
  await savePointEditor(page, 'VP')

  await expect.poll(() => state.nameWrites.length).toBe(1)
  expect(state.nameWrites[0]).toEqual({ id: 'VP9', body: { name: 'Occupied Draft' } })
  expect(state.virtualPointWrites).toHaveLength(0)
  await expect(page.getByText(/display name is already used \(conflicts with UI-01\)/)).toBeVisible()
  await expect(name).toHaveValue('Occupied Draft')
  await expect(tag).toHaveValue('UNSAVED_TECH_TAG')
  await expect(name).toBeFocused()
})

test('keeps canonical history identity through rename, delete, and recreate generations', async ({ page }) => {
  const state = createPointNameFixture({
    points: [physicalPoint('UI-01', 'UI', 'Physical Temperature', 21)],
    virtualPoints: [virtualPoint()],
    nextGeneration: 8
  })
  await installPointNameApiFixture(page, state)
  await login(page)
  await openVirtualPoints(page)

  await expect(page.getByRole('region', { name: /Logging for Zone Temperature/ })).toContainText(/Generation\s*7/)
  const name = page.getByRole('textbox', { name: 'Label' })
  await name.fill('Renamed Zone Temperature')
  await savePointEditor(page, 'VP')
  await expect.poll(() => state.virtualPointWrites.length).toBe(1)
  expect(state.virtualPointWrites[0].id).toBe('VP1')
  await expect(name).toHaveValue('Renamed Zone Temperature')
  await expect(page.getByRole('region', { name: /Logging for Renamed Zone Temperature/ })).toContainText(/Generation\s*7/)

  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  const deleteDialog = page.getByRole('dialog', { name: 'Delete Virtual Point?' })
  await deleteDialog.getByRole('button', { name: 'OK' }).click()
  await expect.poll(() => state.deletedVirtualPointIds).toEqual(['VP1'])
  await expect(page.getByText('No VP created.')).toBeVisible()

  await page.getByRole('button', { name: 'Add VP', exact: true }).click()
  const addDialog = page.getByRole('dialog', { name: 'Add Virtual Point' })
  await addDialog.getByRole('textbox', { name: 'Tag' }).fill('RECREATED_ZONE')
  await addDialog.getByRole('textbox', { name: 'Label' }).fill('Recreated Zone Temperature')
  await addDialog.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('textbox', { name: 'Tag' })).toHaveValue('RECREATED_ZONE')
  await expect(page.getByRole('textbox', { name: 'Label' })).toHaveValue('Recreated Zone Temperature')
  await expect(page.getByRole('region', { name: /Logging for Recreated Zone Temperature/ })).toContainText(/Generation\s*8/)
  expect(state.createdVirtualPoints).toHaveLength(1)
  expect(state.createdVirtualPoints[0]).toMatchObject({ id: 'VP1', generation: 8, tag: 'RECREATED_ZONE' })

  await page.getByRole('link', { name: 'Trends', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Trends' })).toBeVisible()
  await page.getByRole('button', { name: 'Add trend' }).click()
  const trendDialog = page.getByRole('dialog', { name: 'Add trend' })
  await trendDialog.getByRole('checkbox', { name: /RECREATED_ZONE/ }).check()
  await trendDialog.getByRole('button', { name: 'Apply' }).click()

  await expect.poll(() => state.historyRequests.some((url) => (url.searchParams.get('point') ?? '').split(',').includes('VP1'))).toBe(true)
  const historyTable = page.getByRole('table', { name: 'Historical trend data' })
  await expect(historyTable.getByText(/RECREATED_ZONE.*g7/).first()).toBeVisible()
  await expect(historyTable.getByText(/RECREATED_ZONE.*g8/).first()).toBeVisible()
  expect(state.historyRequests.some((url) => (url.searchParams.get('point') ?? '').split(',').includes('VP1'))).toBe(true)
})
