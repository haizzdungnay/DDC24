# mkddc-web Go backend (BE-001/B1)

## Operator runbook

Xem [RUNBOOK.md](RUNBOOK.md) de khoi dong backend + frontend trong moi truong dev Windows.

Khuyen nghi: chay `mkddc-web` native Windows khi can CPU/RAM/uptime that cua may dev. Neu chay backend trong Docker, dashboard co the hien metric cua container/WSL thay vi Windows host.

Walking skeleton cho process thứ 3 `mkddc-web` theo ADR-005/ADR-007.

Scope B1:
- `POST /api/v1/auth/login` — đọc `users.conf`, verify bcrypt, phát JWT HS256.
- `POST /api/v1/auth/logout` — revoke token in-memory.
- `GET /api/v1/system/status` — trả `SystemStatus` theo `openapi.yaml`/08_WEB.
- OS metrics (`cpu_percent`, `ram_percent`, `tempC`, `uptime_s`/`uptimeS`) đọc trực tiếp từ OS: Linux dùng `/proc/stat`, `/proc/meminfo`, `/sys/class/thermal/.../temp`, `/proc/uptime`; Windows dùng WinAPI cho CPU/RAM/uptime và WMI best-effort (LibreHardwareMonitor/OpenHardwareMonitor/ACPI) cho nhiệt độ.
- Core/iobus metrics đọc best-effort read-only từ SHM theo `shared/mkddc_shm.h`; nếu core/iobus chưa chạy thì trả degraded/default, không crash.

Hard boundary:
- Web không mở thiết bị I/O, không nói chuyện MCU trực tiếp.
- Core command socket `/run/mkddc/core.sock` để dành cho B2 command path; B1 chỉ probe trạng thái best-effort.

## Dev config

`config/users.conf` có user dev:

- username: `admin`
- password: `admin123`
- role: `admin`

Hash bcrypt cost 12. Production dùng `/data/config/users.conf` theo CONFIG_SCHEMA và đặt quyền file `600`.

## Build/test

```powershell
cd web/backend
go mod tidy
go build ./...
go test ./...
go vet ./...
```

## Run backend

```powershell
cd services/web
$env:JWT_SECRET='dev-secret-change-me-at-least-32-chars'
$env:USERS_CONF='config/users.conf'
$env:CORE_SOCK='/run/mkddc/core.sock'
$env:PORT='8080'
go run .
```

Login + status:

```powershell
$login = Invoke-RestMethod -Method Post http://localhost:8080/api/v1/auth/login `
  -ContentType 'application/json' `
  -Body '{"username":"admin","password":"admin123"}'
Invoke-RestMethod http://localhost:8080/api/v1/system/status `
  -Headers @{ Authorization = "Bearer $($login.token)" }
```

## FE live mode

```powershell
cd src/frontend
$env:VITE_DDC_MODE='live'
$env:VITE_API_ORIGIN='http://localhost:8080'
$env:VITE_AUTH_MODE='jwt'
npm run dev
```

`VITE_AUTH_MODE=jwt` làm AuthProvider gọi `/auth/login` thật thay vì mock/none/apikey. CORS dev mặc định cho `localhost`/`127.0.0.1`; có thể giới hạn bằng `CORS_ORIGIN=http://localhost:5173`.
