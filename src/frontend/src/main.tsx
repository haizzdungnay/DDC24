import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { AuthProvider } from './auth/AuthProvider'
import { ToastProvider } from './components/Toast'
import { I18nProvider } from './i18n'
import { ThemeProvider } from './theme/ThemeProvider'
import { applyTheme } from './theme/tokens'
import './styles.css'

/* Ghi token màu lên `:root` TRƯỚC khi React render. `ThemeProvider` sẽ ghi lại
   ngay sau đó với theme thật của người dùng, nhưng nếu không đặt gì ở đây thì
   khung hình đầu tiên vẽ với mọi `var(--c-*)` rỗng — nền trong suốt, chữ đen
   trên trắng — và người dùng thấy một nháy trắng mỗi lần tải trang. */
applyTheme('light')

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <I18nProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </I18nProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
)
