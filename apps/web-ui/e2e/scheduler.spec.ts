import { expect, test, type Page } from '@playwright/test'

/**
 * E2E cho Lịch vận hành v3.1 (Plan 50 SCHD-263).
 *
 * Vì sao cần E2E chứ không chỉ jsdom: 436 test unit đều render component
 * THẲNG, không đi qua router và không đi qua `SchedulerProvider`. Ba lớp lỗi
 * dưới đây vô hình với chúng:
 *
 *  - route lồng sai ⇒ tab con render rỗng hoặc render nhầm trang;
 *  - `<h1>` lặp giữa layout và trang con (đúng lỗi FE-MB-02 của Modbus RTU);
 *  - provider hỏng sau khi remount ⇒ trang kẹt ở "Đang tải…" vĩnh viễn.
 *
 * Lớp thứ ba là một lỗi THẬT mà bộ test này đã tìm ra: `React.StrictMode` chạy
 * effect hai lần (mount → unmount → mount), và cờ `mounted` chỉ được đặt
 * `false` lúc cleanup chứ không đặt lại `true` lúc mount. Không một test unit
 * nào chạm tới nó.
 *
 * `playwright.config.ts` chạy `VITE_DDC_MODE=live` + `VITE_AUTH_MODE=mock` và
 * KHÔNG dựng backend. Các bài kiểm giao diện vì thế tự giả lập endpoint; riêng
 * bài "không đọc được" thì để nguyên cho backend chết thật.
 */

const SAMPLE_SCHEDULE = {
  schema_version: '3.1',
  schedule_id: 'SCH-001',
  schedule_name: 'HVAC Văn phòng',
  enabled: true,
  status: 'PUBLISHED',
  timezone: 'Asia/Ho_Chi_Minh',
  effective_period: { start_date: null, end_date: null },
  value_type: 'BINARY',
  priority_for_writing: 16,
  core_priority_level: 4,
  schedule_default: { value: 'INACTIVE' },
  weekly_schedule: {
    MON: [{ time: '08:00:00', value: 'ACTIVE' }, { time: '18:00:00', value: 'INACTIVE' }],
    TUE: [{ time: '08:00:00', value: 'ACTIVE' }, { time: '18:00:00', value: 'INACTIVE' }],
    WED: [], THU: [], FRI: [], SAT: [], SUN: []
  },
  exception_schedule: [],
  target_objects: [
    { target_id: 'TGT-001', target_type: 'INTERNAL_POINT', point_kind: 'DO', channel: 1, point_id: 'DO-01' }
  ],
  revision: 3,
  runtime: {
    effective_value: 'ACTIVE',
    value_source: 'WEEKLY',
    source_exception_id: null,
    next_transition_at: null,
    applied_revision: 3,
    last_evaluated_at: null,
    error_code: null,
    targets: [{
      target_id: 'TGT-001', write_result: 'OK', written_value: 'ACTIVE',
      actual_value: 'ACTIVE', overridden_by: null, error_code: null, last_write_at: null
    }]
  }
}

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel(/Tên đăng nhập|Username/i).fill('admin')
  await page.getByLabel(/^Mật khẩu$|^Password$/i).fill('admin')
  await page.getByRole('button', { name: /Đăng nhập|Sign in/i }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 })
}

/* Điều hướng phía client. KHÔNG dùng `page.goto`: phiên đăng nhập chỉ nằm trong
 * React state, nên mọi lần tải lại trang đều rơi về `/login`. */
async function navigate(page: Page, path: string) {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
}

/** Giả lập backend trả về danh sách lịch, để kiểm phần giao diện. */
async function mockSchedules(page: Page, body: unknown = [SAMPLE_SCHEDULE]) {
  await page.route('**/api/v1/schedules', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }))
}

test.describe('Lịch vận hành v3.1', () => {
  test('trang danh sách mở được và có đúng MỘT tiêu đề cấp 1', async ({ page }) => {
    await login(page)
    await mockSchedules(page)
    await navigate(page, '/eng/scheduler')

    const h1 = page.getByRole('heading', { level: 1 })
    await expect(h1).toHaveText(/Lịch vận hành/i)
    await expect(h1).toHaveCount(1)
  })

  test('trang giám sát là route riêng, không phải tab của danh sách', async ({ page }) => {
    await login(page)
    await mockSchedules(page)
    await navigate(page, '/eng/scheduler/runtime')

    const h1 = page.getByRole('heading', { level: 1 })
    await expect(h1).toHaveText(/Giám sát lịch/i)
    await expect(h1).toHaveCount(1)
  })

  test('lịch hiện đúng dữ liệu và KHÔNG còn nhãn thanh ghi nào — acceptance #20', async ({ page }) => {
    await login(page)
    await mockSchedules(page)
    await navigate(page, '/eng/scheduler')

    await expect(page.getByRole('link', { name: 'SCH-001' })).toBeVisible()
    await expect(page.getByText('HVAC Văn phòng')).toBeVisible()

    /* Kiểm trên DOM đã render, mạnh hơn grep mã nguồn: nó kiểm đúng thứ người
     * dùng nhìn thấy. */
    const body = await page.locator('body').innerText()
    expect(body).not.toMatch(/\bTSx\b/)
  })

  test('đồng hồ dung lượng nói số THẬT của phần cứng, không phải trần của đặc tả', async ({ page }) => {
    await login(page)
    await mockSchedules(page)
    await navigate(page, '/eng/scheduler')

    /* 64 điểm ghi nội bộ = 4 AO + 4 DO + 32 AV + 16 BV + 8 MSV. Nếu ai đó đổi
     * thành trần 32 target/lịch của đặc tả thì khẳng định này gãy — đúng ý. */
    await expect(page.getByText('1/64 điểm ghi')).toBeVisible()
    await expect(page.getByText('1/64 lịch')).toBeVisible()
  })

  test('mở được lịch và thấy phép biên dịch Start/End → Time-Value', async ({ page }) => {
    await login(page)
    await mockSchedules(page)
    await navigate(page, '/eng/scheduler')
    await page.getByRole('link', { name: 'SCH-001' }).click()

    await expect(page.getByRole('heading', { level: 1 })).toContainText('HVAC Văn phòng')
    /* Bảng cặp Time-Value phải nằm ngay cạnh lịch, không giấu sau tab — đây là
     * hiện thân của nguyên tắc S4. */
    await expect(page.getByText(/Cặp Time-Value/i)).toBeVisible()
    /* Và ô priority phải giải thích mức core, nếu không "Priority 16" là con số
     * vô nghĩa với người vận hành đứng trước bo. */
    await expect(page.getByText(/Mọi lịch đều ở mức/i)).toBeVisible()
  })

  test('backend không đọc được thì trang NÓI RA, không hiện bảng rỗng', async ({ page }) => {
    /* KHÔNG giả lập: để backend chết thật. Trang phải phân biệt "không đọc
     * được" với "chưa có lịch nào" — đúng finding FE-DATA-02 của đợt
     * 2026-08-05. Bảng rỗng im lặng là câu trả lời SAI ở đây.
     *
     * Chờ dài hơn `defaultRequestTimeoutMs` (15 s) của api client: không có
     * backend thì vite proxy treo tới lúc client tự huỷ. */
    await login(page)
    await navigate(page, '/eng/scheduler')

    await expect(
      page.getByText(/Không tải được danh sách lịch|Cấu hình lịch còn ở định dạng cũ/i)
    ).toBeVisible({ timeout: 25_000 })
    await expect(page.getByText(/Chưa có lịch nào/i)).toHaveCount(0)
  })

  test('lịch không tồn tại thì báo rõ, không hiện trang trắng', async ({ page }) => {
    await login(page)
    await mockSchedules(page, [])
    await navigate(page, '/eng/scheduler/SCH-999')

    await expect(page.getByText(/Không tìm thấy lịch/i)).toBeVisible({ timeout: 25_000 })
  })
})
