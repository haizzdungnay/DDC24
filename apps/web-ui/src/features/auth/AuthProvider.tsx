import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { API_ORIGIN, AUTH_MODE, IS_DEMO } from '../../shared/config'
import { setAuthHeaderProvider } from '../../shared/api/client'
import { setHistoryAuthHeaderProvider } from '../../shared/api/history'
import { useI18n } from '../../shared/i18n'
import type { UserRole } from '../../shared/types'

interface Session {
  username: string
  role: UserRole
  /** ISO thời điểm phiên này được cấp. Xem WEB-UX-003. */
  loginAt: string
  token?: string
}

interface AuthContextValue {
  session: Session | null
  isAuthenticated: boolean
  login: (password: string, username?: string) => Promise<void>
  logout: () => void
  getAuthHeader: () => Record<string, string>
}

const AuthContext = createContext<AuthContextValue | null>(null)
const base = `${API_ORIGIN.replace(/\/$/, '')}/api/v1`

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const { pick } = useI18n()

  const getAuthHeader = useCallback((): Record<string, string> => {
    if (!session) return {}
    if (session.token) return { Authorization: `Bearer ${session.token}` }
    return {}
  }, [session])

  useEffect(() => {
    setAuthHeaderProvider(getAuthHeader)
    setHistoryAuthHeaderProvider(getAuthHeader)
  }, [getAuthHeader])

  useEffect(() => {
    const handler = () => {
      setAuthHeaderProvider(() => ({}))
      setHistoryAuthHeaderProvider(() => ({}))
      setSession(null)
    }
    window.addEventListener('mkddc:auth-expired', handler)
    return () => window.removeEventListener('mkddc:auth-expired', handler)
  }, [])

  const login = useCallback(async (password: string, username = 'admin') => {
    if (IS_DEMO || AUTH_MODE === 'mock' || AUTH_MODE === 'none') {
      setSession({ username, role: 'admin', loginAt: new Date().toISOString() })
      return
    }

    // `AUTH_MODE=apikey` đã bị GỠ BỎ (REV-FE-03).
    //
    // Nhánh cũ bỏ qua hẳn `/auth/login`, dựng phiên `role:'admin'` viết cứng và
    // gửi header `X-API-Key` — một header mà toàn bộ `apps/web-api` không có
    // tham chiếu nào (`auth.Require` chỉ đọc Bearer token). Mọi request được
    // bảo vệ trả 401, kích hoạt `mkddc:auth-expired` và xoá phiên ngay, nên
    // người dùng bị đá về trang đăng nhập không kèm giải thích. Vai trò 'admin'
    // viết cứng cũng mâu thuẫn trực tiếp với bản vá F-07 vốn cố ý đưa vai trò
    // lạ về `viewer`. Một chế độ đăng nhập luôn 401 tệ hơn không có chế độ đó;
    // muốn tích hợp máy-máy thì phải cài `X-API-Key` ở BE trước.
    if (AUTH_MODE === 'apikey') {
      throw new Error('Chế độ đăng nhập apikey chưa được backend hỗ trợ; dùng VITE_AUTH_MODE=jwt')
    }

    const response = await fetch(`${base}/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
    // TC-L02/TC-L03 (TR-MKDDC24-P1-20260814-01): trước đây hard-code tiếng
    // Việt, nên phiên English vẫn nhận "Đăng nhập thất bại" — dịch theo locale
    // đang chọn thay vì luôn tiếng Việt.
    if (!response.ok) throw new Error(pick('Đăng nhập thất bại', 'Sign in failed'))
    const body = await response.json() as { token?: string; role?: UserRole }
    if (body.token) {
      const provider = () => ({ Authorization: `Bearer ${body.token}` })
      setAuthHeaderProvider(provider)
      setHistoryAuthHeaderProvider(provider)
    }
    // F-07: default phải là quyền THẤP NHẤT. `?? 'admin'` cũ khiến một response
    // login thiếu field `role` (BE cũ, BE đổi hợp đồng, hoặc reverse proxy lọc
    // bớt field) cấp cho user giao diện admin đầy đủ — thấy toàn bộ trang cấu
    // hình hệ thống và quản lý user. Server vẫn chặn 403 nên không leo thang
    // thật, nhưng đó là lộ thông tin cấu trúc + UX sai.
    if (!body.role) {
      console.warn('mkddc: response login thiếu field "role"; mặc định về quyền viewer')
    }
    setSession({ username, role: body.role ?? 'viewer', token: body.token, loginAt: new Date().toISOString() })
  }, [pick])

  const logout = useCallback(() => {
    const revokeToken = session?.token

    // Xoá state local NGAY: người dùng phải được đăng xuất khỏi UI bất kể kết quả
    // của lời gọi thu hồi phía server.
    setAuthHeaderProvider(() => ({}))
    setHistoryAuthHeaderProvider(() => ({}))
    setSession(null)

    // F-04: BE có đầy đủ đường thu hồi (POST /api/v1/auth/logout → handleLogout →
    // AuthService.Revoke) nhưng FE trước đây không gọi bao giờ, nên JWT vừa dùng
    // vẫn hợp lệ tới hết TTL 1 giờ và toàn bộ cơ chế `revoked` phía BE là code
    // chết. Trên HMI web dùng chung ở phòng máy, ai lấy được token đó (lịch sử
    // browser, log proxy, devtools) vẫn ghi/force được point ở quyền operator.
    //
    // Fire-and-forget có chủ đích: một lần thu hồi thất bại không được chặn hay
    // đảo ngược việc đã đăng xuất. `keepalive` để request vẫn đi khi trang bị
    // đóng/điều hướng ngay sau đó.
    if (!revokeToken) return
    void fetch(`${base}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: { Authorization: `Bearer ${revokeToken}` }
    }).catch(() => {
      /* thu hồi là best-effort; token sẽ tự hết hạn theo TTL */
    })
  }, [session?.token])

  const value = useMemo<AuthContextValue>(() => ({
    session,
    isAuthenticated: Boolean(session),
    login,
    logout,
    getAuthHeader
  }), [getAuthHeader, login, logout, session])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
