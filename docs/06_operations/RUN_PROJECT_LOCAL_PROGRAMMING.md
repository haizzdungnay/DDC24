# Chạy local no-board (Programming)

Luồng này chạy trên PC bằng WSL2 Ubuntu-24.04, không SSH Orange Pi. Cần giữ
đúng các socket và bật Programming ở cả Core, Web API và Vite.

## 1. Build và chạy simulator

```bash
cd /mnt/e/TuanDuong/INTERN/DDC24_project/MK-DDC-24
cmake -S . -B build/release/cpp -DCMAKE_BUILD_TYPE=Release -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON
cmake --build build/release/cpp -j"$(nproc)"
./tools/run_noboard_demo.sh
```

`run_noboard_demo.sh` đã bật `--programming-runtime`, tạo
`/tmp/mkddc-programming-v1.sock` và đặt RETAIN dưới `/tmp`.

## 2. Chạy Web API

Mở terminal WSL khác:

```bash
cd /mnt/e/TuanDuong/INTERN/DDC24_project/MK-DDC-24/apps/web-api
mkdir -p /tmp/mkddc-local-ddc24/{config,state/programming}
go build -o /tmp/mkddc-local-ddc24/mkddc-web ./cmd/mkddc-web
nohup env JWT_SECRET=local-ddc24-secret-at-least-32-bytes \
  USERS_CONF=/mnt/e/TuanDuong/INTERN/DDC24_project/MK-DDC-24/apps/web-api/config/users.conf \
  CONFIG_DIR=/tmp/mkddc-local-ddc24/config STATE_DIR=/tmp/mkddc-local-ddc24/state \
  PROGRAMMING_STATE_DIR=/tmp/mkddc-local-ddc24/state/programming \
  CORE_SOCK=/tmp/mkddc-core.sock PROGRAMMING_REV_A=1 \
  PROGRAMMING_SOCKET=/tmp/mkddc-programming-v1.sock \
  PROGRAMMING_SIM_WORKER=/mnt/e/TuanDuong/INTERN/DDC24_project/MK-DDC-24/build/release/cpp/core/mkddc-programming-sim-worker \
  PROGRAMMING_COMPILER=/mnt/e/TuanDuong/INTERN/DDC24_project/MK-DDC-24/build/release/cpp/core/mkddc-st-compile \
  PROGRAMMING_PACKAGER=/mnt/e/TuanDuong/INTERN/DDC24_project/MK-DDC-24/build/release/cpp/core/mkddc-st-package \
  PORT=8081 /tmp/mkddc-local-ddc24/mkddc-web \
  >/tmp/mkddc-local-ddc24/web.out.log 2>/tmp/mkddc-local-ddc24/web.err.log &
```

## 3. Chạy FE

PowerShell tại `apps/web-ui`:

```powershell
npm ci # chỉ cần lần đầu
$env:VITE_DDC_MODE='live'
$env:VITE_AUTH_MODE='jwt'
$env:VITE_PROGRAMMING_REV_A='1'
$env:VITE_PROXY_TARGET='http://localhost:8081'
npm run dev -- --host 0.0.0.0
```

Mở `http://localhost:5173`, đăng nhập `admin` / `admin123`.

## 4. Kiểm tra Programming

```powershell
$login=Invoke-RestMethod -Method Post 'http://localhost:5173/api/v1/auth/login' -ContentType 'application/json' -Body '{"username":"admin","password":"admin123"}'
$h=@{Authorization="Bearer $($login.token)"}
Invoke-RestMethod 'http://localhost:5173/api/v1/programming/capabilities' -Headers $h
```

Phải thấy `targetState=READY`, `edit=true`, `live=true`, `simulation=true`.

## 5. Kiểm lỗi và chạy thử Program trên host, không cần web

Hai công cụ này dành cho người viết chương trình và CI của dự án ứng dụng
(`REC-DDC-FIELD-USE-20260927` U-16). Chúng chỉ chạy trên máy phát triển và
không được cài lên bo.

**Kiểm lỗi, không cần khoá ký.** `--check-only` biên dịch để báo lỗi, không sinh
artifact. Kết quả có `usage` cho biết Program còn dư bao nhiêu so với trần profile
(lệnh, slot ghi, slot, hằng, instance FB, binding):

```bash
B=build/release/cpp/core
$B/mkddc-st-compile --source PRG_MAIN.st --source-id PRG_MAIN \
  --pou-manifest pou-manifest.json --check-only
```

**Chạy thử theo kịch bản.** `mkddc-st-sim` nạp package đã đóng gói bằng đúng
engine của chế độ SIMULATE, áp các lần ghi input theo thời gian ảo, và ghi CSV
một dòng mỗi lần Program release. Package phải ký bằng khoá phát triển, rồi truyền
khoá công khai tương ứng (64 ký tự hex) bằng `--trusted-key`:

```bash
$B/mkddc-st-compile --source PRG_MAIN.st --source-id PRG_MAIN \
  --pou-manifest pou-manifest.json --key dev.key --out prg.mkir
$B/mkddc-st-package --out package.bin --program PRG_MAIN=prg.mkir --period PRG_MAIN=100
$B/mkddc-st-sim --package package.bin --trusted-key dev.pub \
  --scenario scenario.json --out run.csv
```

`scenario.json`:

```json
{
  "schemaVersion": 1,
  "durationMs": 60000,
  "events": [
    {"atMs": 0, "input": "PRG_MAIN.InPermit", "value": true},
    {"atMs": 5000, "input": "PRG_MAIN.CmdMode", "value": 4}
  ],
  "observe": ["PRG_MAIN.StsMode", "PRG_MAIN.DO01"]
}
```

- `input`/`observe` là `<Program>.<Biến>`, chỉ gồm `VAR_INPUT`/`VAR_OUTPUT`.
  Thiếu `observe` thì ghi mọi ô. BOOL nhận `true`/`false` hoặc `0`/`1`, TIME
  tính bằng ms, số nguyên không nhận phần thập phân.
- stdout là một dòng JSON tóm tắt (`ok`, `steps`, `rows`, `programs`, `inputs`).
  Exit `0` khi chạy hết kịch bản; `1` khi Program fault (kèm `faultAtMs`) hoặc
  kịch bản nhắc tới input/observation không có; `2` khi sai tham số, IO hay nạp
  package.
- Tên input sai được báo trước khi chạy tick đầu, không phải sau nhiều phút ảo.
