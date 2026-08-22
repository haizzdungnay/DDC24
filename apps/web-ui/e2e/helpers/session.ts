import { expect, type Page } from '@playwright/test'

/**
 * Đăng nhập dùng chung cho MỌI spec e2e.
 *
 * VÌ SAO PHẢI LÀ MỘT CHỖ DUY NHẤT
 *
 * Helper này từng được chép tay ở bảy spec. Bản vá `T59-604` (chờ điều kiện
 * thay vì đua với dev server) chỉ áp được cho MỘT bản — `point-names.spec.ts` —
 * nên sáu bản còn lại giữ nguyên cuộc đua, và cổng e2e tiếp tục đỏ ngắt quãng ở
 * chỗ khác: lần chạy 2026-08-22 chết ở `pa3-a11y.spec.ts`. Một bản vá đúng nằm
 * ở một trong bảy bản sao thì không phải bản vá, chỉ là một lần may.
 *
 * VÌ SAO CHỜ ĐIỀU KIỆN CHỨ KHÔNG ĐỂ `fill()` TỰ CHỜ
 *
 * `fill()` có chờ element editable, nhưng khi hết hạn nó báo "điền không được"
 * — che mất sự thật là "trang chưa dựng xong". Chờ tường minh tách hai chuyện
 * đó, nên lần đỏ tiếp theo chỉ đúng một cách đọc.
 *
 * Ngân sách ở đây là 20 s vì e2e nay phục vụ BẢN ĐÃ BUILD (`vite preview`,
 * xem `playwright.config.ts`): không còn biên dịch theo yêu cầu, nên trang login
 * chỉ tốn thời gian tải tĩnh. Con số 60 s của bản vá trước là vô nghĩa — test
 * chỉ có 30 s, nên phép chờ ấy không bao giờ chạy hết hạn của chính nó.
 */
export interface LoginOptions {
  /** Ngôn ngữ ép cho hồ sơ trình duyệt. Bỏ trống = để ứng dụng tự quyết. */
  lang?: 'vi' | 'en'
  username?: string
  password?: string
}

export async function login(page: Page, options: LoginOptions = {}) {
  const { lang, username = 'admin', password = 'admin' } = options

  if (lang) {
    // Spec kiểm chính xác copy theo ngôn ngữ phải khai báo, không phụ thuộc
    // mặc định của ứng dụng (profile mới nay theo `navigator.language`).
    await page.addInitScript((value) => {
      window.localStorage.setItem('mkddc-lang', value)
    }, lang)
  }

  await page.goto('/login')

  const usernameField =
    lang === 'en'
      ? page.getByLabel('Username', { exact: true })
      : page.getByLabel(/Tên đăng nhập|Username/i)
  await expect(usernameField).toBeEditable({ timeout: 20_000 })
  await usernameField.fill(username)

  const passwordField =
    lang === 'en'
      ? page.getByLabel('Password', { exact: true })
      : page.getByLabel(/^Mật khẩu$|^Password$/i)
  await passwordField.fill(password)

  const submit =
    lang === 'en'
      ? page.getByRole('button', { name: 'Sign in' })
      : page.getByRole('button', { name: /Đăng nhập|Sign in/i })
  await submit.click()

  await expect(page).not.toHaveURL(/\/login$/, { timeout: 30_000 })
}
