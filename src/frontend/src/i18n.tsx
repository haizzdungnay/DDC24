import { createContext, useContext, useMemo, useState } from 'react'
import type React from 'react'
import type { Language } from './types'

const copy = {
  vi: {
    overview: 'Tổng quan',
    engineering: 'Kỹ thuật',
    dashboard: 'Bảng điều khiển',
    monitor: 'Giám sát',
    alarms: 'Cảnh báo',
    'alarm-log': 'Nhật ký cảnh báo',
    trends: 'Xu hướng',
    me: 'Thông tin người dùng',
    display: 'Hiển thị',
    scheduler: 'Lịch vận hành',
    network: 'Mạng',
    users: 'Người dùng',
    settings: 'Cài đặt',
    time: 'Thời gian/Ngày',
    device: 'Thiết bị',
    health: 'Sức khỏe hệ thống',
    commissioning: 'Chạy thử',
    programming: 'Lập trình',
    validator: 'Lập trình',
    'alarm-settings': 'Cấu hình cảnh báo',
    inputs: 'Cấu hình Inputs',
    diagram: 'Sơ đồ điều khiển',
    'diagram-sub': 'Sơ đồ xem trước hệ thống',
    aux: 'Hàm phụ trợ',
    'ai-inputs': 'Cấu hình AI',
    'di-inputs': 'Cấu hình DI',
    terminal: 'Đầu nối',
    signal: 'Tín hiệu',
    quality: 'Chất lượng',
    safestate: 'An toàn',
    currentvalue: 'Giá trị',
    rs485: 'Cổng RS485',
    modbus: 'Modbus',
    bacnet: 'BACnet',
    logout: 'Đăng xuất',
    online: 'ONLINE',
    offline: 'OFFLINE',
    demo: 'DEMO',
    live: 'LIVE',
    all: 'Tất cả',
    loading: 'Đang tải dữ liệu',
    empty: 'Chưa có dữ liệu',
    error: 'Không tải được dữ liệu',
    retry: 'Thử lại',
    reconnecting: 'Mất WebSocket, đang kết nối lại. Dữ liệu đang hiển thị là stale.',
    loginTitle: 'Đăng nhập',
    loginSub: 'Đăng nhập để vận hành hệ thống điều khiển tòa nhà',
    username: 'Tên đăng nhập',
    password: 'Mật khẩu',
    signIn: 'Đăng nhập',
    guest: 'Vào demo',
    rememberMe: 'Ghi nhớ đăng nhập',
    forgotPassword: 'Quên mật khẩu?',
    force: 'Force',
    confirm: 'Xác nhận',
    cancel: 'Hủy',
    save: 'Lưu',
    close: 'Đóng',
    add: 'Thêm',
    filter: 'Lọc',
    search: 'Tìm kiếm',
    system: 'HỆ THỐNG'
  },
  en: {
    overview: 'Overview',
    engineering: 'Engineering',
    dashboard: 'Dashboard',
    monitor: 'Monitoring',
    alarms: 'Alarms',
    'alarm-log': 'Alarm log',
    trends: 'Trends',
    me: 'User info',
    display: 'Display',
    scheduler: 'Scheduler',
    network: 'Network',
    users: 'Users',
    settings: 'Settings',
    time: 'Time/Date',
    device: 'Device',
    health: 'System Health',
    commissioning: 'Commissioning',
    programming: 'Programming',
    validator: 'Programming',
    'alarm-settings': 'Alarm settings',
    inputs: 'Inputs Config',
    diagram: 'Controller Diagram',
    'diagram-sub': 'Read-only commissioning diagram',
    aux: 'Auxiliary Functions',
    'ai-inputs': 'AI Inputs',
    'di-inputs': 'DI Inputs',
    terminal: 'Terminal',
    signal: 'Signal',
    quality: 'Quality',
    safestate: 'Safe State',
    currentvalue: 'Current Value',
    rs485: 'RS485 Port',
    modbus: 'Modbus',
    bacnet: 'BACnet',
    logout: 'Logout',
    online: 'ONLINE',
    offline: 'OFFLINE',
    demo: 'DEMO',
    live: 'LIVE',
    all: 'All',
    loading: 'Loading data',
    empty: 'No data',
    error: 'Could not load data',
    retry: 'Retry',
    reconnecting: 'WebSocket lost. Reconnecting; displayed data is stale.',
    loginTitle: 'Welcome Back',
    loginSub: 'Sign in to access your building control system',
    username: 'Username',
    password: 'Password',
    signIn: 'Sign In',
    guest: 'Guest Access',
    rememberMe: 'Remember me',
    forgotPassword: 'Forgot password?',
    force: 'Force',
    confirm: 'Confirm',
    cancel: 'Cancel',
    save: 'Save',
    close: 'Close',
    add: 'Add',
    filter: 'Filter',
    search: 'Search',
    system: 'SYSTEM'
  }
} as const

type CopyKey = keyof typeof copy.vi

interface I18nValue {
  lang: Language
  locale: 'vi-VN' | 'en-US'
  setLang: (lang: Language) => void
  t: (key: CopyKey) => string
  pick: (vi: string, en: string) => string
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Language>('vi')
  const value = useMemo<I18nValue>(() => ({
    lang,
    locale: lang === 'vi' ? 'vi-VN' : 'en-US',
    setLang,
    t: (key) => copy[lang][key],
    pick: (vi, en) => lang === 'vi' ? vi : en
  }), [lang])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider')
  return ctx
}