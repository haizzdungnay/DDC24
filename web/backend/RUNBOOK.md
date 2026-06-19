# mkddc-web runbook

Huong dan nay dung de khoi dong web UI + backend `mkddc-web` trong moi truong dev Windows.

## Cong dich vu

Mac dinh nen dung:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:8081`
- Backend goc API: `http://localhost:8081/api/v1`

Neu port `8080` dang bi ung dung khac chiem, giu nguyen ung dung do va chay `mkddc-web` o `8081`.

## Tai khoan dev

File user dev: `web/backend/config/users.conf`

- username: `admin`
- password: `admin123`
- role: `admin`

## Cach chay dung tren Windows

Chay backend native Windows de metric CPU/RAM/uptime doc tu may that bang WinAPI.

```powershell
cd E:\TuanDuong\INTERN\MK-DDC-24\web\backend
$env:JWT_SECRET='dev-secret-change-me-at-least-32-chars'
$env:USERS_CONF='config/users.conf'
$env:CORE_SOCK='/run/mkddc/core.sock'
$env:PORT='8081'
go run .
```

Mo terminal khac chay frontend live mode:

> **Quan trong:** Vite proxy mac dinh tro ve `http://127.0.0.1:8080`. Neu backend chay `PORT=8081` thi **phai** dat `VITE_PROXY_TARGET=http://127.0.0.1:8081`, neu khong browser se "Failed to fetch". Phai restart Vite sau khi doi bien.

```powershell
cd E:\TuanDuong\INTERN\MK-DDC-24\src\frontend
$env:VITE_DDC_MODE='live'
$env:VITE_PROXY_TARGET='http://127.0.0.1:8081'
npm run dev
```

Mo UI:

```text
http://localhost:5173
```

## Neu Windows chua co Go

Co the build exe bang Docker roi chay exe native Windows. Cach nay van cho metric Windows that, vi backend cuoi cung chay bang `.exe` tren host.

```powershell
$logDir = Join-Path $env:TEMP 'mkddc-24-dev'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

docker run --rm `
  -v 'E:\TuanDuong\INTERN\MK-DDC-24\web\backend:/app' `
  -v "${logDir}:/out" `
  -w /app `
  golang:1.22-bookworm sh -lc '/usr/local/go/bin/go mod download && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 /usr/local/go/bin/go build -o /out/mkddc-web.exe .'

cd E:\TuanDuong\INTERN\MK-DDC-24\web\backend
$env:JWT_SECRET='dev-secret-change-me-at-least-32-chars'
$env:USERS_CONF='config/users.conf'
$env:CORE_SOCK='/run/mkddc/core.sock'
$env:PORT='8081'
& (Join-Path $env:TEMP 'mkddc-24-dev\mkddc-web.exe')
```

Sau do chay frontend nhu muc tren.

## Khong nen dung Docker de chay backend khi can OS metrics

Lenh Docker backend chi dung lam fallback nhanh:

```powershell
docker run --rm --name mkddc-web-dev `
  -p 8081:8081 `
  -e PORT=8081 `
  -e JWT_SECRET='dev-secret-change-me-at-least-32-chars' `
  -e USERS_CONF='config/users.conf' `
  -e CORE_SOCK='/run/mkddc/core.sock' `
  -v 'E:\TuanDuong\INTERN\MK-DDC-24\web\backend:/app' `
  -w /app `
  golang:1.22-bookworm sh -lc '/usr/local/go/bin/go run .'
```

Luu y: khi backend chay trong Docker, CPU/RAM/uptime co the la cua container/WSL, khong phai Windows host. Neu dashboard can RAM/CPU that cua may dev, hay chay native Windows.

## Kiem tra nhanh

Config reload tren Linux gui SIGHUP bang pidfile `/run/mkddc/*.pid`; neu pidfile thieu, web fallback quet `/proc` theo ten tien trinh va chi reload khi tim dung 1 PID. Neu co hon 1 instance cung ten, reload bi tu choi de tranh ban nham.

Login va doc status:

```powershell
$login = Invoke-RestMethod -Method Post http://localhost:8081/api/v1/auth/login `
  -ContentType 'application/json' `
  -Body '{"username":"admin","password":"admin123"}'

Invoke-RestMethod http://localhost:8081/api/v1/system/status `
  -Headers @{ Authorization = "Bearer $($login.token)" }
```

Kiem tra port:

```powershell
Get-NetTCPConnection -LocalPort 8081,5173 -ErrorAction SilentlyContinue |
  Where-Object { $_.State -eq 'Listen' } |
  Select-Object LocalAddress,LocalPort,State,OwningProcess
```

## Dung dich vu

Neu chay foreground trong terminal, bam `Ctrl+C`.

Neu da chay nen bang PowerShell, tim process theo command line:

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like '*mkddc-web*' -or $_.CommandLine -like '*vite*MK-DDC-24*' } |
  Select-Object ProcessId,Name,CommandLine
```

Dung theo PID:

```powershell
Stop-Process -Id <PID>
```

Neu da chay Docker fallback:

```powershell
docker rm -f mkddc-web-dev
```

## Loi thuong gap

- Dashboard RAM dung yen o khoang 40%: backend dang chay trong Docker/WSL. Chuyen sang native Windows.
- `go : The term 'go' is not recognized`: cai Go for Windows hoac build exe bang Docker nhu huong dan tren.
- UI van goi sai backend: reload cung browser bang `Ctrl+F5`, kiem tra `VITE_API_ORIGIN=http://localhost:8081`.
- `core socket unavailable`: binh thuong khi chi chay `mkddc-web` ma chua chay `mkddc-core/iobus`; OS metrics van hoat dong.
- Port `8080` bi chiem: dung `8081` cho `mkddc-web` va dat `$env:VITE_PROXY_TARGET='http://127.0.0.1:8081'` roi restart Vite.
