# Deploy lên board Foxlinx (SOM-DDC-24-foxlinx)

## Thông tin kết nối

| Trường | Giá trị |
|---|---|
| Hostname | `192.168.1.16` (LAN) / `mekong-fac.ddns.net` (WAN) |
| Port SSH | `22` (LAN) / `2223` (WAN) |
| User | `root` |
| SSH key | `~/.ssh/mkddc24_som` |
| CPU | Rockchip RV1126B (Quad core Cortex A53) — `aarch64` |
| OS | Buildroot |

```text
# LAN:
ssh -p 22 -i ~/.ssh/mkddc24_som root@192.168.1.16

# WAN (DDNS):
ssh -p 2223 -i ~/.ssh/mkddc24_som root@mekong-fac.ddns.net
```

> **Bảo mật:** SSH dùng key `~/.ssh/mkddc24_som`; không ghi hoặc truyền password
> trong command/runbook. `JWT_SECRET` đã được provision sẵn trên board — không ghi
> giá trị vào repo hoặc command history.

## Cấu trúc trên board

| Đường dẫn | Mô tả |
|---|---|
| `/opt/mkddc-web/mkddc-web` | Binary Go web API |
| `/opt/mkddc-web/dist/` | FE static (Vite build output) |
| `/opt/mkddc-web/mkddc-programming-sim-worker` | Simulation worker binary |
| `/usr/sbin/mkddc-st-compile`, `/usr/sbin/mkddc-st-package`, `/usr/sbin/mkddc-st-validate` | Tool ST mà web gọi khi Check/Commission — **phải cùng profile với web** (bước 2b) |
| `/data/config/` | Config dir (users.conf, fieldbus.conf) |
| `/data/mkddc/state/` | State dir |
| `/data/mkddc/state/programming/` | Programming state |
| `/run/mkddc/core.sock` | Core IPC socket |
| `/run/mkddc/programming-v1.sock` | Programming IPC socket |
| `/usr/share/mkddc/artifact-manifest.json` | Manifest provenance từng artifact (T63-002): tên, sha256, commit, dirty, thời điểm build, toolchain. `install.sh` cài; deploy một phần cập nhật bằng `scripts/artifact_manifest.py deploy-record` |

Process chạy dưới user `mkddc`. Port listen: **8082**.

## Quy trình deploy

### Bước 1: Build Go backend (cross-compile)

```bash
cd apps/web-api
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -o /tmp/mkddc-web-foxlinx ./cmd/mkddc-web
```

Kỳ vọng: binary ~21 MB tại `/tmp/mkddc-web-foxlinx`.

### Bước 2: Build FE

```bash
cd apps/web-ui
VITE_PROGRAMS_WORKSPACE_V2=1 npm run build:release
```

Kỳ vọng: pass (gồm contracts, tsc, vite, bundle budget). Output tại
`build/web-ui/dist/`. Bản cho bo **phải** là `build:release` (bật cờ
Programming lúc build); cờ `VITE_PROGRAMS_WORKSPACE_V2=1` không được
`build:release` tự bật. `npm run build` trơn cho ra bản thiếu Programming.

`build:release` sinh `.gz` cạnh JS/CSS trong `build/web-ui/dist/assets` (T63-104).
Chép NGUYÊN thư mục dist (bước 5 `scp -r`), không lọc bỏ `.gz`. Thiếu `.gz` thì
web vẫn chạy nhưng mỗi cold load kéo lại khoảng 1,2 MiB chưa nén.

### Bước 2b: Đồng bộ tool ST (bắt buộc kiểm mỗi lần deploy web)

Web gọi `/usr/sbin/mkddc-st-compile` và `/usr/sbin/mkddc-st-package` khi
Check/Commission. Hai tool này phải được build cho **cùng** product profile với
web. Lệch bản thì mọi Check thất bại: bản web có `ToolchainProbe` báo ngay
`ST-WORKER-TOOLCHAIN` và log `ERROR programming.toolchain`; bản cũ hơn thì treo
khoảng 30 s rồi báo `ST-WORKER-CRASH`. Sự cố thật: Foxlinx 2026-09-26, web profile
v2.2 chạy cùng compiler v2.1 sau một lượt deploy chỉ có web + FE; và `P5-507-F05`
(2026-08-13), khi compiler chưa được cài.

```bash
# sha profile mà web sắp deploy đòi:
grep 'ProfileSHA256 ' apps/web-api/internal/programming/domain/profile_generated.go
# sha của tool đang nằm trên bo:
$SSH $FOXLINX '/usr/sbin/mkddc-st-compile --version; /usr/sbin/mkddc-st-package --version'
```

Nếu `profile_sha256` khác nhau, cross-build và cài lại cả ba tool, kèm backup:

```bash
# BẮT BUỘC truyền khoá công khai phát hành. Thiếu cờ này, binary nhúng KHOÁ TEST có
# sẵn trong repo (ai cũng có khoá riêng tương ứng). Đã xảy ra thật: Core deploy tay
# lên Foxlinx sáng 2026-09-27 báo `mode=TEST`, trong khi bản cài chính thức 2026-09-10
# là `RELEASE` fingerprint 2fb77aa42e7fe446 (sửa khi cài sạch bo cùng ngày).
KEY=$(tr -d '[:space:]' < ~/.config/mkddc/release-signing/release.pub)
cmake --fresh -S . -B build/fw-aarch64 \
  -DCMAKE_TOOLCHAIN_FILE=platform/cmake/toolchain-aarch64-linux-gnu.cmake \
  -DCMAKE_BUILD_TYPE=Release -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON \
  -DMKDDC_ST_PUBLIC_KEY_HEX=$KEY \
  -DIOBUS_BUILD_TESTS=OFF -DCORE_BUILD_TESTS=OFF
cmake --build build/fw-aarch64 --parallel \
  --target mkddc-st-compile mkddc-st-package mkddc-st-validate
# board chỉ có libstdc++ tới GLIBCXX_3.4.30: kiểm trước khi chép
aarch64-linux-gnu-objdump -T build/fw-aarch64/core/mkddc-st-compile | grep -o 'GLIBCXX_[0-9.]*' | sort -V | tail -1
# khoá nhúng phải là RELEASE trước khi chép bất kỳ binary nào của core lên bo
qemu-aarch64 -L /usr/aarch64-linux-gnu build/fw-aarch64/core/mkddc-core --st-key-info
```

Chép lên `/tmp` của bo, sao lưu ba file cũ, rồi
`install -m 0755 -o root -g root <tool> /usr/sbin/<tool>`. Chạy lại
`--version` để xác nhận sha khớp.

Profile đổi thì `mkddc-core` cũng phải cùng bản, vì Core nạp artifact theo
profile. Khi đó deploy cả core/iobus (và unit systemd nếu đổi) trong cùng lượt,
đừng chỉ deploy web.

### Bước 3: Backup trên board

```bash
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
FOXLINX="root@192.168.1.16"
SSH="ssh -p 22 -i ~/.ssh/mkddc24_som -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

$SSH $FOXLINX "
  cp /opt/mkddc-web/mkddc-web /opt/mkddc-web/mkddc-web.bak-${TIMESTAMP}
  mv /opt/mkddc-web/dist /opt/mkddc-web/dist.bak-${TIMESTAMP} 2>/dev/null || true
  cp /usr/share/mkddc/artifact-manifest.json /usr/share/mkddc/artifact-manifest.json.bak-${TIMESTAMP} 2>/dev/null || true
"
```

### Bước 4: Dừng web API

```bash
$SSH $FOXLINX "
  systemctl stop mkddc-web-pi mkddc-reload-helper mkddc-time-helper 2>/dev/null || true
  pkill -9 -x mkddc-web 2>/dev/null || true
  sleep 1
  pgrep -x mkddc-web && echo STILL_RUNNING || echo STOPPED
"
```

Kỳ vọng: `STOPPED`.

### Bước 5: Copy artifacts lên board

```bash
SCP="scp -P 22 -i ~/.ssh/mkddc24_som -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

$SCP /tmp/mkddc-web-foxlinx ${FOXLINX}:/opt/mkddc-web/mkddc-web
$SCP -r build/web-ui/dist ${FOXLINX}:/opt/mkddc-web/dist
```

### Bước 6: Phân quyền và khởi động lại

Khởi động qua unit `mkddc-web-pi`, không chạy tay bằng `nohup`: unit đã mang
đủ env (`PORT=8082`, `STATIC_DIR`, `/etc/mkddc-web.env` chứa `JWT_SECRET` và
`PROGRAMMING_REV_A=1`), còn tiến trình chạy tay nằm ngoài systemd thì không được
restart khi chết.

```bash
$SSH $FOXLINX '
  chmod +x /opt/mkddc-web/mkddc-web
  chown mkddc:mkddc /opt/mkddc-web/mkddc-web
  chown -R mkddc:mkddc /opt/mkddc-web/dist

  systemctl start mkddc-reload-helper mkddc-time-helper mkddc-web-pi
  sleep 20   # web cần ~16 s mới listen
  systemctl is-active mkddc-web-pi && echo SYSTEMD_OK || echo SYSTEMD_FAIL
  for u in mkddc-web-pi mkddc-reload-helper mkddc-time-helper; do
    p=$(systemctl show -p MainPID --value $u)
    echo "$u $(readlink /proc/$p/exe) $(sha256sum /proc/$p/exe | cut -c1-16)"
  done
'
```

Kỳ vọng: `SYSTEMD_OK`; cả **ba** unit trỏ `/opt/mkddc-web/mkddc-web` (không có
đuôi `(deleted)`) và cùng sha256 với bản vừa build. `is-active` chưa đủ: tiến
trình mồ côi còn chạy binary cũ vẫn có thể giữ cổng. Hai helper chạy chung binary
với web, nên chỉ restart `mkddc-web-pi` thì chúng vẫn chạy bản cũ (U-21 của
`REC-DDC-FIELD-USE-20260927`).

### Bước 6b: Ghi manifest cho đúng artifact vừa deploy (T63-002)

Chạy từ gốc repo, ngay sau khi chép xong. Script đọc
`/usr/share/mkddc/artifact-manifest.json` trên bo, thay đúng mục của artifact được
liệt kê, giữ nguyên mục khác, ghi nguyên tử rồi đọc lại để xác nhận:

```bash
python3 scripts/artifact_manifest.py deploy-record --ssh "$SSH $FOXLINX" \
  --artifact mkddc-web=/tmp/mkddc-web-foxlinx \
  --artifact web-ui=build/web-ui/dist/index.html
# Có cài tool ST ở bước 2b thì thêm --artifact mkddc-st-compile=…, mkddc-st-package=…,
# mkddc-st-validate=…; có deploy core/iobus thì thêm mkddc-core=…, mkddc-iobus=…
```

Commit, dirty, thời điểm build và toolchain lấy từ **file build trên máy này**
(binary Go/C++ tự mang commit; FE và tool ST phải là output build của worktree).
Không xác định được nguồn build thì script từ chối (exit 2) và không ghi gì.
**Không** điền sha256 đọc từ bo vào manifest và không sửa manifest bằng tay.
Bo cài trước T63-002 chưa có manifest: lần `deploy-record` đầu chỉ tạo mục cho
artifact vừa deploy, bước 7b báo `NO_ENTRY` cho phần còn lại tới khi chúng được
deploy kèm `deploy-record` hoặc cài lại bằng `install.sh`.

### Bước 7: Smoke test

Board Buildroot không có `curl` — dùng `wget` (busybox):

```bash
# LAN:
ssh -p 22 -i ~/.ssh/mkddc24_som root@192.168.1.16 '
  # Health
  wget -q -O - http://127.0.0.1:8082/api/v1/health
  echo ""

  # Login
  wget -q -O /tmp/login.json \
    --post-data="{\"username\":\"admin\",\"password\":\"admin123\"}" \
    --header="Content-Type: application/json" \
    http://127.0.0.1:8082/api/v1/auth/login
  TOKEN=$(sed "s/.*\"token\":\"\([^\"]*\)\".*/\1/" /tmp/login.json)

  # Programming capabilities
  wget -q -O - --header="Authorization: Bearer $TOKEN" \
    http://127.0.0.1:8082/api/v1/programming/capabilities
  echo ""

  # FE static
  wget -q -O - http://127.0.0.1:8082/ | head -c 100
  echo ""

  # Tool ST cùng bản với web (bước 2b)
  journalctl -u mkddc-web-pi -b --no-pager | grep "programming.toolchain" | tail -1
'
```

Kỳ vọng:

- Health: tất cả checks `ok`
- Login: role `admin`, token hợp lệ
- Programming: `targetState: READY`, languages `ST` + `FBD`
- FE: HTML `<html lang="vi">` được serve
- Toolchain: `INFO programming.toolchain ok … profile_sha256=<sha của web>`. Gặp `ERROR programming.toolchain` thì quay lại bước 2b; đừng để người dùng phát hiện qua một Check hỏng.

### Bước 7b: Read-back sha256 với manifest (T63-002, bắt buộc)

Chỉ đọc trên bo: so sha256 `/proc/<MainPID>/exe` của `mkddc-core`, `mkddc-iobus`,
`mkddc-web-pi`, `mkddc-reload-helper`, `mkddc-time-helper`, `index.html` mà web đang
phục vụ (theo `STATIC_DIR` trong `/proc/<pid>/environ`, kèm một `GET /`) và các file
khác trong manifest:

```bash
python3 scripts/artifact_manifest.py readback --ssh "$SSH $FOXLINX" \
  --json /tmp/foxlinx-readback-${TIMESTAMP}.json
```

Kỳ vọng dòng cuối `READBACK: <n> kiểm, 0 lệch`, exit 0. Exit 1 là còn lệch
(`STALE_EXE`: unit còn chạy binary đã bị thay, restart đúng unit gồm cả hai helper;
`SHA_MISMATCH`/`WRONG_PATH`: bo chạy bản khác bản vừa ghi; `NO_ENTRY`: manifest chưa
có mục đó). Exit 2 là lỗi SSH/manifest. Còn lệch thì chưa được báo deploy xong.
Vòng `for u in …` ở bước 6 chỉ là kiểm nhanh; 7b là kiểm chính thức.

## Rollback

Khôi phục từ backup:

```bash
TIMESTAMP="20260911T082831Z"  # thay bằng timestamp backup cần khôi phục
ssh -p 2223 -i ~/.ssh/mkddc24_som root@mekong-fac.ddns.net "
  pkill -x mkddc-web || true
  sleep 1
  cp /opt/mkddc-web/mkddc-web.bak-${TIMESTAMP} /opt/mkddc-web/mkddc-web
  rm -rf /opt/mkddc-web/dist
  mv /opt/mkddc-web/dist.bak-${TIMESTAMP} /opt/mkddc-web/dist
  # Manifest lùi cùng binary; không có bản backup thì gỡ để read-back báo NO_MANIFEST.
  if [ -f /usr/share/mkddc/artifact-manifest.json.bak-${TIMESTAMP} ]; then
    cp /usr/share/mkddc/artifact-manifest.json.bak-${TIMESTAMP} /usr/share/mkddc/artifact-manifest.json
  else
    rm -f /usr/share/mkddc/artifact-manifest.json
  fi
  # Restart theo bước 6, rồi read-back theo bước 7b
"
```

## Cài sạch bo lab (như xuất xưởng)

Dùng khi cần đưa bo về trạng thái mới cài, ví dụ trước khi tổng hợp release. Lần chạy đầu tiên, 2026-09-27: `docs/07_records/test-evidence/fw-som/2026-09-27-foxlinx-factory-reset.md`. Việc này **xoá dữ liệu** (Project Programming, historian, người dùng, cấu hình I/O, …), nên chỉ làm khi chủ sở hữu yêu cầu.

1. **Sao lưu toàn bộ về máy khác, và kiểm bản sao lưu trước khi xoá.** Dùng `tar` busybox trên bo (không có `--warning`). Kiểm lại bằng `gzip -t` và danh sách mục.
2. **Build bản cài từ `main`:**
   - cross-build C++ vào `build/release/cpp`, kèm khoá phát hành (lệnh ở bước 2b), HMI ON, test OFF;
   - web Go `linux/arm64`, FE `VITE_PROGRAMS_WORKSPACE_V2=1 npm run build:release`;
   - `provenance.json`, `sbom.json` và `checksums.sha256` theo đúng định dạng `build-release.sh`;
   - `artifact-manifest.json`: `python3 scripts/artifact_manifest.py record --fresh --origin factory-reset --manifest build/release/artifact-manifest.json --artifact …` với cùng 9 artifact như `build-release.sh`. `install.sh` từ chối gói thiếu file này.
3. **Đóng gói** `platform/packaging`, `platform/systemd`, `apps/hmi/packaging/{hmi.conf,point_db.example.json}`, `build/release/**` và `build/web-ui/dist`. Giải nén vào `/var/tmp/mkddc-release` trên bo, rồi `sha256sum --check build/release/checksums.sha256`.
4. **Chạy `tools/deploy/foxlinx_factory_reset.sh` theo từng pha, kiểm kết quả sau mỗi pha:**
   - `stop`: sau pha này, chụp DB lúc đã dừng;
   - `wipe`;
   - `install`: gồm `install.sh --with-fake-mcu` và drop-in `PORT=8082` của bo lab.
5. **Giữ lại:**
   - cấu hình thiết bị Modbus (`fieldbus.*`, `profiles/*.json`);
   - mạng (`/etc/mkddc/netcfg.conf`, journal netcfg);
   - SSH chỉ nhận khoá;
   - ba unit bảo mật sau sự cố;
   - drop-in iobus `nomcu.conf`. (`pidfile.conf` không còn cần từ `main@3cb08fbc`: iobus tự ghi pidfile.)
6. **Kiểm sau cài:**
   - `/proc/MainPID/exe` khớp `runtime-checksums.sha256`, và `scripts/artifact_manifest.py readback` báo 0 lệch;
   - `mkddc-core --st-key-info` ra `RELEASE`;
   - health 6/6;
   - Programming `READY` với 0 Project;
   - bus Modbus đủ thiết bị online.

Đây chỉ là cài sạch lớp ứng dụng. Nạp lại image hệ điều hành cần truy cập vật lý (USB/maskrom).

## Lưu ý

- Board không có `curl`. `busybox wget` chỉ gửi được GET/POST; cần PUT (ví dụ
  `…/runtime-intent`) thì dùng `perl` (`IO::Socket::INET`) chạy trên bo. sshd của
  bo tắt port-forwarding (`AllowTcpForwarding no`, siết sau sự cố 2026-09-26), nên
  không dựng được tunnel `-L` tới cổng web.
- **Restart `mkddc-core` khi Program có đầu vào Virtual Point (Issue #827).** Bo lab
  chạy Core có bản sửa từ 2026-09-28 12:10Z (`main@265f1a8b`), nên **không cần thao
  tác tay**. Sau restart, Program đi qua `DISABLED` rồi `WAITING` ("Chờ đầu vào"),
  và tự `RUNNING` khi vòng đối chiếu VP của web đẩy VP xuống (≤ 10 s). Đo trên bo:
  Program chạy lại 3,6–10,6 s sau lệnh restart, `faultCount` không tăng
  (`EV-PROG-STARTUP-WAIT-827-TARGET`). Chỉ khi Program `FAULTED ST-RT-008` thật (đầu
  vào xấu liên tục ≥ 60 s) mới cần `PUT …/programs/{programId}/runtime-intent`
  `{"schemaVersion":"1.0","desiredEnabled":false}` rồi `true`, mỗi lệnh một
  `X-Idempotency-Key` mới. Trong khoảng chờ, DO Modbus giữ nguyên trạng thái cuối,
  không về giá trị an toàn (Issue #833).
- Binary Go dựng **trong git worktree** không có `vcs.revision` (Go chỉ nhận `.git`
  là thư mục), nên `artifact_manifest.py deploy-record` exit 2. Dựng `mkddc-web` từ
  một bản clone thường (`git clone --no-checkout <repo> && git checkout <commit>`),
  kiểm bằng `go version -m <binary> | grep vcs`.
- Bo lab có thể có người khác deploy song song (2026-09-28: một máy LAN thay
  `dist` giữa hai bước đo). Chạy bước 7b ngay trước khi báo xong; mục lệch do người
  khác thì báo lại, không ghi đè bản của họ.
- Binary `mkddc-web` đang chạy thì `scp` sẽ thất bại — phải `pkill` trước.
- `scp` dùng `-P` (uppercase) cho port, `ssh` dùng `-p` (lowercase).
- Không sửa `JWT_SECRET` trên board trừ khi có yêu cầu rõ ràng.
- FE static phục vụ qua `WEB_UI_DIR` env var, không qua reverse proxy riêng.
