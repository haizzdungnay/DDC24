/**
 * Hợp đồng hai chiều giữa BẢNG ROUTE (`app/App.tsx` + `ROUTE_MIN_ROLE`) và
 * BẢNG MENU (`shared/components/NavRail.tsx`).
 *
 * Vì sao cần test này — finding `F-UX-17` của `REV-FE-UIUX-UC-2026-08-18`:
 * `/eng/aux` và `/eng/user-parameters` tồn tại thật, có gate quyền, có nhãn
 * i18n, nhưng **không mục nào trong `NavRail` dẫn tới**. Chúng chỉ tới được
 * bằng cách gõ tay URL, và điều đó lọt qua mọi cổng kiểm hiện có suốt nhiều
 * tháng. Đây đúng cơ chế sinh lỗi số 1 ở §7.3 của cùng biên bản: **hợp đồng
 * nội bộ chỉ có test một chiều** — nơi khai báo route có test, nơi khai báo
 * menu thì không, và không ai đối chiếu hai bảng.
 *
 * `ADR-032` đã ghi thành hệ quả: "thêm một route mới ⇒ phải xếp nó vào đúng một
 * trong bốn nhóm… Một route không thuộc nhóm nào là mã người dùng không tới
 * được bằng điều hướng." Một câu trong ADR không tự thi hành được; tệp này là
 * chỗ thi hành nó.
 *
 * ---
 *
 * CÁCH HOẠT ĐỘNG — và vì sao có một bảng chép tay ở đây.
 *
 * `App.tsx` khai báo route bằng JSX lồng nhau, không phải bằng dữ liệu, nên
 * không đọc được bảng route lúc chạy mà không render cả ứng dụng. Thay vì phân
 * tích cú pháp JSX (mong manh, hỏng theo cách khó hiểu), test dùng hai lớp:
 *
 * 1. **Lớp bẫy (`RAW_ROUTE_LITERALS`)** — chụp nguyên văn mọi chuỗi `path="…"`
 *    trong `App.tsx`. Thêm, xoá hay đổi tên bất kỳ route nào cũng làm assert
 *    này đỏ ngay. Đây là thứ bảo đảm bảng chép tay bên dưới không bao giờ trôi
 *    khỏi mã.
 * 2. **Lớp phân loại (`PAGE_ROUTES`)** — mỗi trang người dùng tới được phải
 *    khai báo mình thuộc loại nào: có trong menu, là tab con của một layout, có
 *    lối vào riêng ở chỗ khác, hay bị cách ly. Không có loại "chưa xếp".
 *
 * Nghĩa là người thêm route mới buộc phải trả lời câu hỏi "người dùng tới đây
 * bằng cách nào" ngay trong lần chạy test đầu tiên, chứ không phải sau vài
 * tháng khi có người đọc lại biên bản review.
 */
import { describe, expect, it } from 'vitest'
/* Khối `N-08` ở cuối tệp đọc ~30 tệp nguồn để đếm `<h1>`; liệt kê 30 import
   `?raw` sẽ dài hơn chính phép kiểm. Kiểu của builtin khai ở
   `src/node-builtins.d.ts` (dự án cố ý không cài `@types/node`). */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import appSource from './App.tsx?raw'
import { ROUTE_MIN_ROLE } from '../features/auth/roles'
import { NAV_GROUPS } from '../shared/components/NavRail'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Nguyên văn mọi `path="…"` trong `App.tsx`, đã sắp xếp.
 *
 * `'diagnostics'` xuất hiện HAI lần là đúng: một là route cấp một
 * (`/diagnostics`), một là tab con của `/eng/modbus-rtu`. Giữ trùng lặp thay vì
 * dùng `Set` chính là để không che mất khác biệt kiểu đó.
 */
const RAW_ROUTE_LITERALS = [
  '*',
  '/login',
  ':id',
  'activity',
  'alarms',
  'alarms/history',
  'commissioning',
  'devices',
  'diagnostics',
  'diagnostics',
  'eng/alarm-settings',
  'eng/aux',
  'eng/commissioning',
  'eng/diagnostics',
  'eng/diagram',
  'eng/inputs',
  'eng/modbus-rtu',
  'eng/outputs',
  'eng/programming/*',
  'eng/scheduler',
  'eng/user-parameters',
  'eng/virtual-io',
  'eng/virtual-points',
  'help',
  'mapping',
  'me',
  'monitor',
  'network',
  'overview',
  'points',
  'ports',
  'runtime',
  'scheduler',
  'settings',
  'settings/device',
  'settings/display',
  'settings/network',
  'settings/time',
  'settings/users',
  'trends',
  'users',
  'validator'
]

type RouteKind =
  /** Có một mục trong `NAV_GROUPS` trỏ thẳng tới. */
  | 'nav'
  /** Tab/màn con nằm trong một layout đã có mục menu; tới qua trang cha. */
  | 'nested'
  /** Không có mục menu, nhưng có lối vào rõ ràng ở chỗ khác trong giao diện. */
  | 'entry-elsewhere'
  /** Chuyển hướng tương thích cho bookmark cũ; không phải trang. */
  | 'redirect'
  /** Route công khai, nằm ngoài khung ứng dụng đã đăng nhập. */
  | 'public'
  /** Cố ý KHÔNG đưa vào điều hướng — phải dẫn quyết định. */
  | 'quarantine'

interface RouteFact {
  kind: RouteKind
  /** Người dùng tới đây bằng cách nào, hoặc vì sao cố ý không tới được. */
  reached: string
}

/**
 * Mọi đường dẫn tuyệt đối mà ứng dụng phục vụ, kèm cách người dùng tới nơi.
 *
 * Cột `reached` không phải chú thích trang trí: nó là câu trả lời bắt buộc cho
 * "người dùng tới trang này bằng cách nào". Một dòng `entry-elsewhere` mà không
 * chỉ ra được lối vào cụ thể thì thực chất là một dòng `quarantine` chưa được
 * gọi đúng tên.
 */
const PAGE_ROUTES: Record<string, RouteFact> = {
  '/login': { kind: 'public', reached: 'Chưa đăng nhập ⇒ `ProtectedShell` chuyển hướng tới đây' },

  '/': { kind: 'nav', reached: 'Nhóm Tổng quan' },
  '/monitor': { kind: 'nav', reached: 'Nhóm Tổng quan' },
  '/alarms': { kind: 'nav', reached: 'Nhóm Tổng quan' },
  '/trends': { kind: 'nav', reached: 'Nhóm Tổng quan' },
  '/activity': { kind: 'nav', reached: 'Nhóm Tổng quan' },
  '/alarms/history': { kind: 'entry-elsewhere', reached: 'Liên kết "Lịch sử" trong `/alarms`' },

  '/eng/scheduler': { kind: 'nav', reached: 'Nhóm Vận hành' },
  '/eng/scheduler/runtime': { kind: 'nested', reached: 'Tab của `SchedulerLayout`' },
  '/eng/scheduler/:id': { kind: 'nested', reached: 'Bấm một lịch trong lưới Scheduler' },
  '/eng/commissioning': { kind: 'nav', reached: 'Nhóm Vận hành' },

  '/eng/inputs': { kind: 'nav', reached: 'Nhóm Kỹ thuật' },
  '/eng/outputs': { kind: 'nav', reached: 'Nhóm Kỹ thuật' },
  '/eng/virtual-points': { kind: 'nav', reached: 'Nhóm Kỹ thuật' },
  '/eng/modbus-rtu': { kind: 'nav', reached: 'Nhóm Kỹ thuật' },
  '/eng/modbus-rtu/overview': { kind: 'nested', reached: 'Tab của `ModbusRtuLayout`' },
  '/eng/modbus-rtu/ports': { kind: 'nested', reached: 'Tab của `ModbusRtuLayout`' },
  '/eng/modbus-rtu/devices': { kind: 'nested', reached: 'Tab của `ModbusRtuLayout`' },
  '/eng/modbus-rtu/points': { kind: 'nested', reached: 'Tab của `ModbusRtuLayout`' },
  '/eng/modbus-rtu/mapping': { kind: 'nested', reached: 'Tab của `ModbusRtuLayout`' },
  '/eng/modbus-rtu/diagnostics': { kind: 'nested', reached: 'Tab của `ModbusRtuLayout`' },
  '/eng/alarm-settings': { kind: 'nav', reached: 'Nhóm Kỹ thuật' },
  '/diagnostics': { kind: 'nav', reached: 'Nhóm Kỹ thuật' },
  '/eng/programming/*': { kind: 'nav', reached: 'Nhóm Kỹ thuật, chỉ khi `VITE_PROGRAMMING_REV_A=1`' },
  '/eng/diagram': { kind: 'entry-elsewhere', reached: 'Nút "Mở rộng" của khối sơ đồ trong `/diagnostics`' },

  '/settings/network': { kind: 'nav', reached: 'Nhóm Hệ thống' },
  '/settings/device': { kind: 'nav', reached: 'Nhóm Hệ thống' },
  '/settings/time': { kind: 'nav', reached: 'Nhóm Hệ thống' },
  '/settings/users': { kind: 'nav', reached: 'Nhóm Hệ thống' },
  '/settings/display': { kind: 'nav', reached: 'Nhóm Hệ thống' },

  '/me': { kind: 'entry-elsewhere', reached: 'Nút người dùng trên `TopBar`' },
  '/help': { kind: 'entry-elsewhere', reached: 'Nút trợ giúp trên `TopBar`' },

  '/eng/user-parameters': {
    kind: 'quarantine',
    reached: 'ADR-033: `apiClient.getUserParams/putUserParams` là mock demo, không có endpoint backend'
  },
  '/eng/aux': {
    kind: 'quarantine',
    reached: 'ADR-033: sinh cụm component graph 28-node — runtime legacy theo ADR-020/ADR-023'
  },

  '/settings': { kind: 'redirect', reached: '→ /settings/device' },
  '/users': { kind: 'redirect', reached: '→ /settings/users' },
  '/network': { kind: 'redirect', reached: '→ /settings/network' },
  '/scheduler': { kind: 'redirect', reached: '→ /eng/scheduler' },
  '/commissioning': { kind: 'redirect', reached: '→ /eng/commissioning' },
  '/validator': { kind: 'redirect', reached: '→ /eng/programming hoặc /' },
  '/eng/diagnostics': { kind: 'redirect', reached: '→ /diagnostics' },
  '/eng/virtual-io': { kind: 'redirect', reached: '→ /eng/virtual-points' },
  '*': { kind: 'redirect', reached: '→ /' }
}

/**
 * Bốn nhóm của `ADR-032`, chép nguyên bảng trong quyết định đó.
 *
 * Chép tay ở đây là CỐ Ý: nếu test lấy dữ liệu từ chính `NAV_GROUPS` thì nó chỉ
 * chứng minh mã bằng chính nó. Bảng này đại diện cho **tài liệu**, và assert
 * bên dưới là chỗ tài liệu với mã gặp nhau.
 */
const ADR_032_GROUPS: Array<{ id: string; items: string[] }> = [
  { id: 'overview', items: ['/', '/monitor', '/alarms', '/trends', '/activity'] },
  { id: 'operation', items: ['/eng/scheduler', '/eng/commissioning'] },
  {
    id: 'engineering',
    items: [
      '/eng/inputs',
      '/eng/outputs',
      '/eng/virtual-points',
      '/eng/modbus-rtu',
      '/eng/alarm-settings',
      '/diagnostics',
      '/eng/programming'
    ]
  },
  {
    id: 'system',
    items: ['/settings/network', '/settings/device', '/settings/time', '/settings/users', '/settings/display']
  }
]

function navTargets(): string[] {
  return NAV_GROUPS.flatMap((group) => group.items.map((item) => item.to))
}

/**
 * `App.tsx` khai báo `/eng/programming/*` (route bao trọn bốn workspace) trong
 * khi menu và `ROUTE_MIN_ROLE` dùng `/eng/programming`. Chuẩn hoá về dạng không
 * có `/*` để hai bảng so được với nhau.
 */
function withoutWildcard(path: string): string {
  return path.endsWith('/*') ? path.slice(0, -2) : path
}

const pageRouteKeys = Object.keys(PAGE_ROUTES).map(withoutWildcard)

describe('hợp đồng route ↔ menu', () => {
  it('bảng route trong App.tsx không đổi mà bảng phân loại không đổi theo', () => {
    const literals = [...appSource.matchAll(/path="([^"]*)"/g)].map((match) => match[1]).sort()
    expect(
      literals,
      'Bảng route trong App.tsx đã đổi. Cập nhật RAW_ROUTE_LITERALS, rồi xếp route mới ' +
        'vào PAGE_ROUTES: đưa vào NAV_GROUPS, hoặc khai báo lối vào khác, hoặc cách ly kèm ADR.'
    ).toEqual([...RAW_ROUTE_LITERALS].sort())
  })

  it('mọi mục menu trỏ tới một route có thật', () => {
    for (const target of navTargets()) {
      expect(pageRouteKeys, `Mục menu "${target}" không khớp route nào trong App.tsx`).toContain(target)
    }
  })

  it('mọi route được phân loại `nav` đều có đúng một mục menu, và ngược lại', () => {
    const declaredNav = Object.entries(PAGE_ROUTES)
      .filter(([, fact]) => fact.kind === 'nav')
      .map(([path]) => withoutWildcard(path))
      .sort()
    const actualNav = [...navTargets()].sort()
    expect(actualNav).toEqual(declaredNav)
    expect(new Set(actualNav).size, 'Một route xuất hiện hai lần trong menu').toBe(actualNav.length)
  })

  it('không route nào bị bỏ quên: mọi route đều có loại và có câu trả lời "tới bằng cách nào"', () => {
    for (const [path, fact] of Object.entries(PAGE_ROUTES)) {
      expect(fact.reached.trim().length, `Route ${path} thiếu lý do trong cột reached`).toBeGreaterThan(0)
    }
  })

  it('hai route bị cách ly vẫn nằm ngoài menu (F-UX-17 / ADR-033)', () => {
    const quarantined = Object.entries(PAGE_ROUTES)
      .filter(([, fact]) => fact.kind === 'quarantine')
      .map(([path]) => path)
    expect(quarantined.sort()).toEqual(['/eng/aux', '/eng/user-parameters'])
    for (const path of quarantined) {
      expect(
        navTargets(),
        `${path} bị cách ly theo ADR-033. Đưa nó vào menu là đảo ngược một quyết định: ` +
          'sửa ADR-033 trước, rồi mới sửa NAV_GROUPS và PAGE_ROUTES.'
      ).not.toContain(path)
    }
  })

  it('mọi khoá của ROUTE_MIN_ROLE là một route có thật', () => {
    for (const path of Object.keys(ROUTE_MIN_ROLE)) {
      expect(pageRouteKeys, `ROUTE_MIN_ROLE gác một route không tồn tại: ${path}`).toContain(path)
    }
  })

  it('bốn nhóm điều hướng khớp đúng bảng của ADR-032', () => {
    expect(NAV_GROUPS.map((group) => group.id)).toEqual(ADR_032_GROUPS.map((group) => group.id))
    for (const expected of ADR_032_GROUPS) {
      const actual = NAV_GROUPS.find((group) => group.id === expected.id)
      expect(actual, `ADR-032 khai báo nhóm "${expected.id}" nhưng NavRail không có`).toBeDefined()
      expect(
        actual?.items.map((item) => item.to),
        `Nhóm "${expected.id}" lệch khỏi bảng ADR-032. Đổi cách gom mục là đổi quyết định ` +
          'kiến trúc — cập nhật ADR-032 và UX-SYSTEM-001 §6 trong cùng phiên.'
      ).toEqual(expected.items)
    }
  })

  it('mục menu dùng CHUNG ROUTE_MIN_ROLE với gate route, không dựng bảng quyền thứ hai', () => {
    // ADR-032: "Lọc mục theo vai trò tiếp tục dùng chung ROUTE_MIN_ROLE với gate
    // route; không được dựng bảng thứ hai." Kiểm gián tiếp nhưng đủ chặt: mọi
    // route bị gác quyền mà CÓ mặt trong menu phải lấy ngưỡng từ đúng bảng đó.
    const navSet = new Set(navTargets())
    const guardedNavRoutes = Object.keys(ROUTE_MIN_ROLE).filter((path) => navSet.has(path))
    expect(guardedNavRoutes.length).toBeGreaterThan(0)
    for (const path of guardedNavRoutes) {
      expect(['viewer', 'operator', 'admin']).toContain(ROUTE_MIN_ROLE[path])
    }
  })
})

/**
 * Cây heading theo route — `N-08` (kiểm tra viên độc lập #1).
 *
 * Acceptance criteria gốc của `T57-0.4` đòi "**test tự động duyệt bảng route và
 * assert**" rằng mỗi route render đúng một `<h1>`. Đợt triển khai đầu chỉ sửa mã
 * rồi đối chiếu bằng tay — nghĩa là tính chất này không có gì giữ, và lần
 * refactor layout tới sẽ lặng lẽ phá nó y như `SchedulerGridPage` đã từng.
 *
 * Test đọc TĨNH thay vì render 28 route: render đủ mọi route đòi mock toàn bộ
 * API của từng feature, chi phí bảo trì cao hơn giá trị. Phép kiểm ở đây trả lời
 * đúng câu hỏi cần trả lời — "route này lấy `<h1>` từ đâu" — và bắt được đúng
 * hai chế độ hỏng đã xảy ra thật: trang con tự thêm `<h1>` thứ hai bên trong một
 * layout đã có (lỗi `ModbusRtuPage` cũ), và nhánh trả về sớm làm mất `<h1>`
 * (lỗi `SchedulerGridPage`).
 */
describe('N-08 — mỗi route có đúng một nguồn `<h1>`', () => {
  /** Bỏ chú thích khối và chú thích dòng trước khi đếm.
   *
   *  Repo này viết chú thích rất dày và nhiều chỗ trích dẫn thẳng `<h1>` để giải
   *  thích ai sở hữu tiêu đề. Đếm thô trên nguyên văn sẽ tính cả những dòng đó —
   *  đúng dương tính giả đã làm hỏng lần đo `F-UX-15` đầu tiên. */
  function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  }

  /** Đếm thẻ `<h1>` JSX thật. */
  function countH1(relativePath: string): number {
    const source = stripComments(readFileSync(resolve(SRC, relativePath), 'utf8'))
    return (source.match(/<h1[\s>]/g) ?? []).length
  }

  /** Layout sở hữu `<h1>`; mọi trang con của nó KHÔNG được có thêm cái nào. */
  const LAYOUT_OWNED: Array<{ layout: string; children: string[] }> = [
    {
      layout: 'features/modbus-rtu/ModbusRtuLayout.tsx',
      children: [
        'features/modbus-rtu/pages/OverviewPage.tsx',
        'features/modbus-rtu/pages/PortsPage.tsx',
        'features/modbus-rtu/pages/DevicesPage.tsx',
        'features/modbus-rtu/pages/PointsPage.tsx',
        'features/modbus-rtu/pages/MappingPage.tsx',
        'features/modbus-rtu/pages/DiagnosticsPage.tsx'
      ]
    },
    {
      layout: 'features/programming/layout/ProgrammingHeader.tsx',
      children: [
        'features/programming/overview/OverviewPage.tsx',
        'features/programming/design/DesignWorkspacePage.tsx',
        'features/programming/commission/CheckCommissionPage.tsx',
        'features/programming/runtime/RuntimeServicePage.tsx'
      ]
    },
    {
      layout: 'features/scheduler/ScheduleEditorPage.tsx',
      children: [
        'features/scheduler/tabs/WeeklyTab.tsx',
        'features/scheduler/tabs/ExceptionTab.tsx',
        'features/scheduler/tabs/TargetTab.tsx',
        'features/scheduler/tabs/SimulateTab.tsx',
        'features/scheduler/tabs/HistoryTabs.tsx'
      ]
    }
  ]

  it.each(LAYOUT_OWNED)('layout $layout giữ đúng một <h1>', ({ layout }) => {
    expect(countH1(layout), `${layout} phải là nơi DUY NHẤT khai <h1> cho nhánh route của nó`).toBe(1)
  })

  it.each(LAYOUT_OWNED.flatMap((row) => row.children.map((child) => ({ child, layout: row.layout }))))(
    'trang con $child KHÔNG tự thêm <h1>',
    ({ child, layout }) => {
      expect(
        countH1(child),
        `${child} thêm <h1> thứ hai trong khi ${layout} đã có — route sẽ render hai <h1>, `
        + 'đúng lỗi mà chú thích của chính layout đó cảnh báo.'
      ).toBe(0)
    }
  )

  /** Trang tự đứng: phải có `<h1>`, và phải giữ được nó ở nhánh lỗi. */
  const STANDALONE = [
    'features/dashboard/DashboardPage.tsx',
    'features/dashboard/DiagnosticsPage.tsx',
    'features/dashboard/ActivityPage.tsx',
    'features/points/MonitorPage.tsx',
    'features/points/InputsPage.tsx',
    'features/points/OutputsPage.tsx',
    'features/points/VirtualIoPage.tsx',
    'features/points/UserParametersPage.tsx',
    'features/points/CommissioningPage.tsx',
    'features/operations/AlarmsPage.tsx',
    'features/operations/TrendsPage.tsx',
    'features/operations/AlarmSettingsPage.tsx',
    'features/network/NetworkPage.tsx',
    'features/network/SettingsPage.tsx',
    'features/network/TimeSettingsPage.tsx',
    'features/network/DisplaySettingsPage.tsx',
    'features/auth/UsersPage.tsx',
    'features/auth/UserInfoPage.tsx',
    'features/dashboard/HelpPage.tsx',
    'features/scheduler/SchedulerGridPage.tsx',
    'features/scheduler/SchedulerRuntimePage.tsx'
  ]

  it.each(STANDALONE)('trang tự đứng %s khai <h1>', (page) => {
    expect(countH1(page), `${page} là một route độc lập nên phải tự khai <h1>`).toBeGreaterThanOrEqual(1)
  })

  it('trang có nhánh trả về sớm dùng tiêu đề DÙNG CHUNG, không mất <h1> khi lỗi', () => {
    /* Ba trang này từng hoặc đang có nhánh `return <StateBlock/>` trước phần
       dựng nội dung. Chúng phải rút tiêu đề thành một component dùng chung để
       nhánh lỗi cũng có — nếu không, người dùng trình đọc màn hình nghe thấy
       thông báo lỗi mà không biết đang ở màn hình nào (WCAG 2.2 §2.4.6). */
    for (const [page, heading] of [
      ['features/points/MonitorPage.tsx', 'MonitorHeading'],
      ['features/operations/AlarmsPage.tsx', 'AlarmsHeading'],
      ['features/scheduler/SchedulerGridPage.tsx', 'SchedulerHeading']
    ] as const) {
      const source = readFileSync(resolve(SRC, page), 'utf8')
      expect(source.includes(`function ${heading}`), `${page} phải có component tiêu đề dùng chung ${heading}`).toBe(true)
      const uses = (source.match(new RegExp(`<${heading}\\s*/>`, 'g')) ?? []).length
      expect(uses, `${page} phải dùng <${heading}/> ở CẢ nhánh bình thường lẫn nhánh lỗi`).toBeGreaterThanOrEqual(2)
    }
  })
})
