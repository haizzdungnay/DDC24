# Development and Operations

**ID:** OPS-DEV-001
**Trạng thái:** Active
**Cập nhật:** 2026-09-12

## Repository map

- `apps/core`, `apps/iobus`, `apps/netcfg`, `apps/hmi`: runtime SOM theo process.
- `apps/web-api`, `apps/web-ui`: API và Web UI.
- `firmware/stm32`: firmware MCU.
- `contracts`: authority IOP, SHM, config schema và OpenAPI.
- `platform/cmake`, `platform/packaging`, `platform/systemd`: build và deploy.
- `tests` and service-local test folders: automated evidence sources.

## Build và test

Luôn đọc build files hiện hành thay vì sao chép command cũ. Baseline workflow —
đủ **mười một** component đang tồn tại trong `scripts/verify-project.sh`:

```bash
scripts/verify-project.sh --component layout
scripts/verify-project.sh --component cpp --profile full
scripts/verify-project.sh --component go
scripts/verify-project.sh --component frontend
scripts/verify-project.sh --component e2e
scripts/verify-project.sh --component e2e-real
scripts/verify-project.sh --component firmware
scripts/verify-project.sh --component docs
scripts/verify-project.sh --component workflow
scripts/verify-project.sh --component browser
scripts/verify-project.sh --component release
```

Mười component đầu chạy gộp được bằng `scripts/verify-project.sh --component all`.
**`release` không nằm trong `all`** — lý do kỹ thuật ghi tại nhánh `all` của
script (cần khoá phát hành ngoài repo, dựng cây build thứ hai, không có đường
vòng cache khi thiếu egress). Nên khi cần bằng chứng đầy đủ thì chạy hai lệnh:

```bash
scripts/verify-project.sh --component all
scripts/verify-project.sh --component release
```

Bước release phải gọi qua `--component release`, **không** gõ tay
`platform/packaging/build-release.sh` + `sha256sum --check` như bản trước tài
liệu này hướng dẫn: hai lệnh đó chỉ là hai bước ĐẦU của cổng. Bước thứ ba —
`tests/integration/test_release_dryrun.py`, tức diễn tập CÀI MỚI → NÂNG CẤP →
ROLLBACK (T59-606) — nằm trong `run_release` và sẽ rơi mất với người làm đúng
theo danh sách gõ tay.

HMI: thêm `-DMKDDC_ENABLE_HMI=ON` và xác minh dependency/target. BACnet: dùng option hiện có trong CMake và chạy protocol smoke phù hợp. Không coi build trên host là thay thế HIL/target test.

## Chạy local full-stack no-board (không SSH board)

Đường chạy cho FE/API dev tại `http://127.0.0.1:5173`, dùng chuỗi mô phỏng sẵn có
trong `tools/run_noboard_demo.sh`. **Không viết mock dữ liệu mới** — chuỗi này đã
sinh I/O thật qua PTY ảo.

```
socat PTY ─► fake_mcu ─UART ảo─► mkddc-iobus ─► /dev/shm/mkddc_io_shm
                                                /dev/shm/mkddc_plc_shm
                                                      └─► mkddc-core ─/tmp/mkddc-core.sock─► mkddc-web :8081
                                                                                                  ▲ proxy Vite :5173
```

### Điều kiện bắt buộc

- **Phải chạy trong Linux.** `apps/web-api` dùng `unix.*`, `syscall.Kill`,
  `SysProcAttr.Setpgid/Pdeathsig` nên **không build native trên Windows**
  (`go build` host báo 16 lỗi undefined ở `programming/artifact`,
  `programming/compiler`, `programming/coreipc`, `programming/store`,
  `internal/system/probe.go`). Trên máy Windows dùng WSL:
  `MSYS_NO_PATHCONV=1 wsl -d Ubuntu-24.04 -- bash -lc '<lệnh>'`
  (thiếu `MSYS_NO_PATHCONV=1` thì Git Bash mangle path và báo exit 127).
- Cần `socat`, `go`, `cmake`, `g++`, `node`.

### Trình tự

1. **Build C++** vào đúng layout mà demo script trông đợi
   (`build/release/cpp`, khớp `MKDDC_CPP_BUILD_REL` trong
   `platform/packaging/repository-paths.sh`):

   ```bash
   cmake -S . -B build/release/cpp -DCMAKE_BUILD_TYPE=Release \
     -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON
   cmake --build build/release/cpp -j"$(nproc)"
   ```

   Cần 4 binary: `core/mkddc-core`, `iobus/mkddc-iobus`, `iobus/fake_mcu`,
   `iobus/shm_dump_io`. Override build root bằng `MKDDC_CPP_BUILD_ROOT` nếu dùng
   thư mục khác.

2. **Dựng chuỗi mô phỏng:** `./tools/run_noboard_demo.sh`
   (dừng: `./tools/run_noboard_demo.sh stop`).

3. **Chạy Web API:** `./run-local.sh` — build `mkddc-web` và trỏ runtime path vào
   `/tmp/mkddc-local-<hash-của-checkout>`. Script bám theo vị trí của chính nó,
   **không hardcode path repo**, nên chạy ở worktree nào thì build và dùng state
   của worktree đó.

4. **Chạy FE:** `cd apps/web-ui && npm run dev` → `http://127.0.0.1:5173`.
   Đăng nhập `admin` / `admin123`.

### Hai điểm nối dễ sai (đã cắn 2026-08-28)

| Triệu chứng | Nguyên nhân | Cách trỏ đúng |
|---|---|---|
| `/api/v1/health` báo `core` = `fault` dù core sống | `CORE_SOCK` trỏ sai chỗ | phải là `/tmp/mkddc-core.sock`, khớp `--sock` của `mkddc-core` trong demo script |
| `core`/`iobus` = `fault` dù `pgrep` thấy tiến trình | `system.ProcessAlive()` đọc **PID file** chứ không quét tiến trình; demo chạy bằng `nohup` nên không ghi PID file nào | `run-local.sh` tự `pgrep` rồi ghi `$ROOT/run/{core,iobus}.pid` **trước khi** start web; chạy demo script trước `run-local.sh` |
| Vite nhảy sang `5174` | đã có instance cũ giữ `5173` | kiểm tra listener cũ trước, đừng chạy đè |
| `127.0.0.1:8081` connection refused nhưng `[::1]:8081` `200` | trên WSL backend đến qua `wslrelay`, chỉ bind IPv6 | không phải lỗi; dev đi qua proxy `5173` không ảnh hưởng |
| Port sai 8080 thay vì 8081 | lệch với `developmentProxy()` trong `apps/web-ui/vite.config.ts` | mọi endpoint 502, trông như hỏng FE — luôn giữ `PORT=8081` |
| `mkddc-web` chết ngay lúc init: `schema Programming mới hơn binary: version N` | nhiều worktree dùng chung `CONFIG_DIR`; `store.CurrentSchemaVersion` khác nhau giữa các nhánh (nhánh này 5, worktree khác 11/12), binary schema thấp gặp DB do binary schema cao tạo | `run-local.sh` đã tách `ROOT` theo hash đường dẫn checkout; nếu vẫn kẹt thì xoá `/tmp/mkddc-local-*` của checkout đó |
| `do1`/`do2` trả `{"result":"rejected","error":"id_conflict"}` từ lần gọi thứ hai | core cache response theo `id` để idempotent; `cmd_do` cũ hardcode `"id":1` nên body khác + id trùng = conflict | đã sửa `cmd_do` sinh `id` theo `time.time_ns()`; **không phải core từ chối ghi** |
| Web API đang chạy tự nhiên báo `core unavailable`, `mkddc-core` thành `<defunct>`, health đảo về `fault` | **checkout khác trên cùng máy cũng chạy demo**, ghi đè `/tmp/mkddc-core.sock` và chiếm `:8081`; `cmd_stop` cũ dùng `pkill -x mkddc-core` nên giết cả core của checkout kia | xem *Chạy song song nhiều checkout* bên dưới |

### Chạy song song nhiều checkout

Máy dev thường có nhiều worktree cùng repo. Bốn tài nguyên dưới đây là **singleton
toàn máy**, hai checkout cùng chạy sẽ giành nhau và tạo triệu chứng giống hệt lỗi
code:

| Tài nguyên | Tách được? | Cách tách |
|---|---|---|
| `CONFIG_DIR`/`STATE_DIR` | có | `run-local.sh` tự hash đường dẫn checkout |
| `/tmp/mkddc-core.sock`, `/tmp/mkddc-iop-{a,b}` | có | đặt `MKDDC_DEMO_SUFFIX=-<tên-checkout>` cho **cả** `run_noboard_demo.sh` và `run-local.sh` |
| Port `8081` | không thực sự | hợp đồng với `developmentProxy()` trong `vite.config.ts`; đổi bằng `MKDDC_WEB_PORT` thì phải đổi `VITE_PROXY_TARGET` tương ứng |
| `/dev/shm/mkddc_io_shm`, `/dev/shm/mkddc_plc_shm` | không | tên do contract SHM quy định — **chỉ một chuỗi demo chạy được tại một thời điểm** |

**Suffix không bảo vệ được khỏi checkout chạy bản script cũ.** `cmd_stop` bản cũ
dùng `pkill -x mkddc-core` và `pkill -f "PTY.*mkddc-iop"`; hai pattern đó khớp cả
tiến trình có suffix. Triệu chứng: `socat` của bạn thành `<defunct>`, PTY biến
mất, `iop_status` rơi về `SAFE`, và **mọi lệnh `do*` trả
`{"result":"overridden","active_source":"safety"}`** — đây là safe-state hoạt động
đúng, không phải core từ chối ghi. Chỉ hết khi mọi checkout trên máy đều dùng bản
`cmd_stop` có phạm vi hẹp.

Vì SHM không tách được, thực tế là **mỗi lúc chỉ một checkout chạy được chuỗi
mô phỏng**. Trước khi kết luận backend hỏng, luôn kiểm tra:

```bash
ps -eo pid,ppid,args --forest | grep -E "mkddc|fake_mcu|socat" | grep -v grep
ss -lptn | grep 8081        # ai đang thực sự giữ port
ls -la /tmp/mkddc-core*.sock
```

Nếu `:8081` do binary ở đường dẫn lạ (ví dụ `/tmp/mkddc-check/mkddc-web`) nắm giữ
thì số đo đang đo **checkout khác**, không phải cây đang sửa.

Kiểm tra nhanh xem SHM còn sống hay đã đứng — `age` phải cỡ vài ms, không phải
chục giây:

```bash
build/release/cpp/iobus/shm_dump_io | head -2
# magic=0x4B584406 seq=... (age 1 ms)
# iop_status=NORMAL fault_flags=0x0000
```

### Trạng thái đúng khi chạy được

- `GET /api/v1/health` → `200`, **cả 6 check `ok`**: `core`, `iobus`, `io_shm`,
  `plc_shm`, `mcu_connection`, `web`.
- `GET /api/v1/points` → `200` với giá trị sống;
  `GET /api/v1/programming/point-catalog` → `200`, 24 điểm.
- `history` → `400` khi thiếu query bắt buộc và `network/transaction` → `503`
  khi không có netcfg socket là **fail-closed đúng**, không phải lỗi cài đặt.
- Kiểm chứng vòng ghi: `./tools/run_noboard_demo.sh do1 1` → core trả
  `accepted` / `active_source=manual`, API đọc lại `DO-01=True quality=good`;
  nhớ `do1 0` để trả về trạng thái ban đầu.

Đây là bằng chứng integration trên host, **không thay thế** target/HIL/production
hoặc release gate.

## Configuration và deployment

1. Backup config/data và ghi commit/artifact hash.
2. Build cùng contract trong `contracts/`; ABI change yêu cầu deploy đồng bộ consumer.
3. Validate config trước restart; AO mode change cần restart phối hợp.
4. Kiểm tra unit/package thực tế, dependency order và permissions.
5. Smoke status, points, IOP heartbeat, output safe behavior và logs.

Không mặc định rằng HMI đã nằm trong package chính; xác minh service unit và artifact của build được phát hành.

### Target board

| Board | Vai trò | SSH alias | Host / Port | User | Auth |
|---|---|---|---|---|---|
| Foxlinx SOM-DDC-24 | **Production** (MCU STM32 thật) | `SOM-DDC-24-foxlinx` | `mekong-fac.ddns.net:2223` | `root` | Password (`admin123`) |

> ⚠️ **Orange Pi 5B không còn sử dụng** (từ 2026-08-05). Mọi tham chiếu tới SSH alias
> `SOM-DDC-24` (port 2222), user `orangepi`, hoặc lệnh `apt`/`dpkg` trong các tài liệu cũ
> đều là di sản của board lab đã ngưng. Chỉ deploy lên `SOM-DDC-24-foxlinx`.

Deploy lên board dùng `ssh SOM-DDC-24-foxlinx`. Quy trình chi tiết:
- [Foxlinx Deploy Checklist](../08_hardware/foxlinx-som-ddc24/FOXLINX_DEPLOY_CHECKLIST.md) (mới, ưu tiên)
- [27_SOM_BOARD_DEPLOY_NO_MCU_RUNBOOK §2a](../03_implementation/27_SOM_BOARD_DEPLOY_NO_MCU_RUNBOOK.md) (legacy, có phần Orange Pi đã deprecated)


## Chẩn đoán

- I/O stale: kiểm tra UART/IOP heartbeat, response timing, retry/fault và MCU state.
- Consumer không chạy: so SHM magic/size/layout và owner/permissions.
- AO sai: kiểm tra electrical mode đã acknowledge, engineering conversion và V/mA boundary.
- Web lỗi points/config: kiểm tra auth, route/backend log, SHM consumer và config validator.
- HMI blank/input lỗi: kiểm tra DRM `/dev/dri/card0`, DSI panel, FT5436 I²C, GPIO/backlight và build flag.

## Network commissioning status and recovery

Source hiện hành đã có `mkddc-netcfg`, local-HMI broker và Web REST/FE transaction path.
`network.conf.eth` chỉ là compatibility shadow; không dùng toast “Đã lưu” hoặc file config làm
bằng chứng kernel đã đổi địa chỉ. Active/configured/pending, capability, DNS và management
hostname phải lấy từ `GET /api/v1/network/transaction` hoặc `network_status`.

GET status cho session xác thực; mọi POST validate/stage/apply/confirm/rollback chỉ cho Admin.
Local HMI đặt flow trong surface Service nhưng network mutation chỉ cho
role Admin. Protocol v1 strict từ chối unknown field; DNS optional là preserve/auto/manual và
được journal/rollback cùng IPv4.

~~Orange Pi service evidence 2026-07-22 đã xác nhận transaction, process recovery,
120 s rollback và control continuity trên interface dummy tách khỏi management.~~
*(Board Orange Pi 5B đã ngưng sử dụng từ 2026-08-05; evidence trên cần được tái kiểm chứng
trên board Foxlinx production.)*
Đổi IP production trên interface Ethernet (`eth0` trên Foxlinx) vẫn chỉ được chạy trong
commissioning có local/console fallback. Không restart `mkddc-iobus` chỉ để nhận IP mới;
BACnet datalink tự rebind theo address change.

Luồng ADR-017 đã implement code-local:

1. Web Admin hoặc local-HMI Admin tạo transaction; mọi session hợp lệ đọc được status/old/new/rollback deadline theo bề mặt được cấp.
2. Static apply giữ đường cũ tới confirm khi topology cho phép; DHCP chờ lease thật.
3. Web/local HMI hiển thị active/configured/pending; production Web reconnect qua same-origin.
4. Không confirm/health fail trong tối đa 120 s thì helper tự phục hồi last-known-good.
5. BACnet hot-rebind/phát `I-Am`; core/IOP/STM32 tiếp tục hoạt động.

Management hostname trong authority là read-only. Chỉ provision/đổi stable origin bằng
`platform/packaging/configure-web-hostname.sh`; package có thể cài tool/template nhưng không tự apply
hostname. Trước đổi IP target phải xác nhận unique mDNS/DNS resolution và có console hoặc
management path dự phòng.

Config mặc định trên Foxlinx dùng `/etc/mkddc/netcfg.conf` với `NETCFG_INTERFACE=eth0`
(trước đây Orange Pi dùng `end1`, đã deprecated);
journal ở `/data/mkddc/netcfg-transaction.json`, socket đặc quyền ở
`/run/mkddc-netcfg/netcfg.sock`. Directory riêng này là `root:mkddc 0750`; socket là
`root:mkddc 0660`, nên restart core/iobus không được đổi ownership hoặc mode của nó.
Runtime chung `/run/mkddc` cho core/iobus/Web là `0770` để broker tạo `hmi-api.sock`;
các socket ứng dụng vẫn giữ `0660`.
Khi rollback fail, giữ console/rescue access, lưu journal/log và không tiếp tục mutation
cho tới khi phục hồi last-known-good bằng NetworkManager được phê duyệt.

Overall Network gate vẫn RED. Không claim physical commissioning cho tới khi có real `end1`
DHCP/static/DNS, reboot/power-loss/disk fault, stable-hostname IP handoff, browser reconnect,
BACnet packet capture, Modbus TCP reconnect, physical control continuity, connected-panel HMI
và security approval.

## Backup, rollback và tài liệu

Rollback phải khôi phục artifact và config tương thích ABI; không trộn binary dùng SHM version khác nhau. Tài liệu lịch sử được phục hồi từ archive theo [Document Control](../00_governance/CONTROL.md), vào thư mục tạm trước khi chọn lọc nội dung.

Mọi thay đổi code/config/deploy/docs phải cập nhật `CHANGELOG.md`; không tạo README/report Markdown phân tán nếu hồ sơ hiện hành có thể chứa nội dung.
