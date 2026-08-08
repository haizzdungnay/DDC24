# Báo cáo build, test và deploy HMI → FW SOM — Orange Pi 5B

> **HỒ SƠ LỊCH SỬ — lưu trữ 2026-08-08.** Không dùng làm nguồn chuẩn. Lý do lưu
> trữ và tài liệu thay thế: [`archive/README.md`](README.md). Mọi đường dẫn source
> trong tài liệu này theo cây thư mục **trước** `PLAN-ARCH-RESTRUCT-002`; bảng ánh
> xạ sang vị trí hiện tại ở [chỉ mục hồ sơ rà soát](../README.md).

**Document ID:** KX-DDC24-DEP-HMI-FWSOM-20260722  
**Ngày thực hiện:** 2026-07-22  
**Target:** `orangepi5b`, aarch64, Orange Pi OS 1.0.8 / Debian 12  
**Source baseline:** `aaaa501`, sửa Release portability `df42e2d`, cộng packaging/evidence của working session này  
**Kết luận:** **PASS cho source, package và service integration; RED cho physical HMI/MCU/Ethernet HIL**

## 1. Phạm vi đã triển khai

- `mkddc-hmi` C++/LVGL: five-surface limited-operator client và Service network modal.
- `mkddc-web-pi`: local HMI auth/audit broker và adapter tới network authority.
- `mkddc-netcfg`: authority Ethernet transaction `status/validate/stage/apply/confirm/rollback`.
- `mkddc-iobus`: IOP/SHM và BACnet/IP address watcher/hot-rebind.
- `mkddc-core`: control/priority/alarm IPC hiện hành.
- systemd unit, `end1` allowlist, socket permissions và board-specific Web drop-in.

Không deploy React FE mới trong slice này. Web REST/FE network path cũ vẫn thuộc team
BE/FE và chưa được coi là transaction client. Không thay đổi địa chỉ quản trị `wlan0`.

## 2. Build và automated verification

| Môi trường | Kết quả |
|---|---|
| Host Release + Debug, HMI enabled | CTest 366/366 pass |
| Host BACnet-enabled + netcfg | CTest 10/10 pass |
| Go backend | `go vet ./...` và `go test -count=1 ./...` pass |
| Contract/package | JSON schemas parse; installer `bash -n`; `git diff --check` pass |
| Orange Pi native Release, HMI + BACnet | Build pass với GCC 12 sau sửa bounded point-ID formatting |
| Orange Pi native CTest | 367/367 pass, 0 fail; 3 IoCache test skip vì production SHM đang active |

Target cài thêm build dependencies `libdrm-dev`, `libfreetype6-dev`, `pkg-config`,
`git`, `ca-certificates`, `fonts-noto-core`. Source archive ban đầu dùng trên target có
SHA-256 `a239fbb78f0db3e86d4bccc8bad1904d5552bf360dfbf794569614dc9d504b0c`;
hai delta sau đó (`screen_control.cpp` portability và `netcfg/main.cpp` dedicated
runtime path) được copy riêng, native-rebuild và kiểm tra lại. Web final được
cross-compile trực tiếp từ working tree sau thay đổi runtime path.

## 3. Deploy record

Backup trước deploy: `/var/backups/mkddc-network-20260722T095558Z`, owner root,
mode `0700`, gồm binaries/units/config/state và checksum manifest.

| Artifact target | SHA-256 |
|---|---|
| `/usr/sbin/mkddc-iobus` | `d93fe1a6ce3fcf51deeb4ff02427c82b9410cea40c236261d01ed9aa2724af22` |
| `/usr/sbin/mkddc-core` | `85d64006015405731adf6b2ac507082b735f01f49666eb618c8ec970f6762360` |
| `/usr/sbin/mkddc-netcfg` | `220b8aa67b06df521ba346b17011eb575b05942af9d7a3e85a509b4d6c18d89f` |
| `/usr/sbin/mkddc-hmi` | `2a4336cdf8d65565a44a7c1b1ecbdc4b6c3d8cd87c822ecfc0043a67119d4557` |
| `/opt/mkddc-web/mkddc-web` | `a3356bd0ce9b37ffde9fed3997e62e18f36457bf013db1984d9d02d27677bd78` |

`mkddc-netcfg`, `mkddc-web-pi`, `mkddc-iobus` và `mkddc-core` đều `active` sau
deploy. `mkddc-hmi` được install nhưng giữ `disabled/inactive` vì target không có DRM
connector/panel 240×320/320×240 hoặc FT5436 touch phù hợp; bật service sẽ chỉ tạo
restart loop và không phải verification hợp lệ.

Hai lỗi integration thật được phát hiện và sửa trong phiên deploy: directory
`/run/mkddc` từng là `0750`, làm broker user `mkddc` không tạo được `hmi-api.sock`;
sau khi đổi thành shared `0770`, restart Core/IOBus có thể recursive-chown cả helper
socket. Thiết kế cuối tách authority sang `/run/mkddc-netcfg` `root:mkddc 0750` với
`netcfg.sock` `root:mkddc 0660`; `/run/mkddc` chỉ còn socket ứng dụng và mode `0770`.
`systemd-analyze verify` pass. `systemd-analyze security` cho netcfg báo exposure
`6.3 MEDIUM`; đây chưa phải security approval và cần review riêng các capability mạng.

Restart process test còn phát hiện `/data/config/schedule.conf` là dữ liệu UI skeleton
cũ (`cells:null`) nên Core disable scheduler với `schedule_cfg.bad_required`. Hai row
được migrate bảo toàn ID/label thành `enabled=false`, `scheduleType=not_active`; bản cũ
được giữ tại backup dưới tên `schedule.conf.pre-migration`. Core sau restart ghi
`schedule_cfg.loaded ... schedules=2`.

## 4. Target integration evidence

### 4.1 Boundary và negative test

- Peer `orangepi` dù thuộc supplementary group `mkddc` vẫn bị netcfg từ chối bằng
  `SO_PEERCRED`; peer UID service `mkddc` được chấp nhận qua directory/socket riêng.
- HMI-unit-equivalent sandbox test trả `Permission denied` khi UID `mkddc` cố connect
  trực tiếp helper path; HMI chỉ được đi qua broker.
- Candidate `interface=wlan0, mode=dhcp` bị từ chối `INTERFACE_NOT_ALLOWED`.
- Production helper báo authority interface `end1`; `wlan0` vẫn
  `192.168.1.18/24`, default route vẫn qua `192.168.1.1`.
- HMI broker `ping` trả `accepted/OK`; HTTP board trả `200`.

### 4.2 Network transaction thật, tách khỏi management

Trên NetworkManager dummy `mkddctest0`:

1. Active `198.18.0.1/24` → stage/apply `198.18.1.2/24`.
2. Apply trả `awaiting_confirmation`, countdown 120 s; confirm persist địa chỉ mới.
3. Stage/apply `198.18.2.2/24`, dừng helper và start instance mới với cùng journal.
4. Instance mới phục hồi đúng transaction/pending/deadline; explicit rollback trả về
   `198.18.1.2/24`.
5. Giao dịch riêng trên `mkddctime0` không confirm; sau 120 s state tự chuyển
   `rolled_back` và địa chỉ trở về `198.19.0.1/24`.
6. Hai dummy connection/interface và file test đã được xoá sau kiểm tra.

### 4.3 Control continuity và BACnet

- PID production netcfg/Web/IOBus/Core không đổi xuyên suốt network transaction/recovery.
- Restart riêng Core, IOBus và Web đều phục hồi `active`; sau các restart,
  `/run/mkddc-netcfg` và helper socket vẫn `root:mkddc`, chứng minh runtime isolation.
- IOP ở `NORMAL_POLL`, handshake IOP/FW 2.0, capability `0x000D`,
  `fault_flags=0`; SHM age 1 ms và UI/AO/DO đều `GOOD/RELIABLE` tại thời điểm lấy mẫu.
- Core tiếp tục scan và xử lý `alarm_list`; HTTP tiếp tục trả 200.
- BACnet/IP đang bind UDP/47808. Log ghi ba lần `address_change` và
  `bacnet_server.rebound iface=default port=47808` khi add/confirm/rollback địa chỉ;
  iobus/IOP không restart.

Evidence này xác nhận behavior của FW SOM với IOP PTY simulator đang chạy trên board;
nó không thay thế physical STM32/output HIL. Chưa có packet capture để chứng minh
`I-Am` trên switch/BMS thật.

## 5. Gate và phần còn mở

| Gate | Trạng thái | Lý do |
|---|---|---|
| Source/build/unit | PASS | Host + native aarch64 suites pass |
| Package/service boundary | PASS có security follow-up | Units/sockets/UID/allowlist verified; capability review còn mở |
| Network transaction service | PASS một phần | Static confirm/restart/manual/timeout rollback pass trên target dummy |
| Physical Ethernet | RED | `end1` chưa có commissioning link/BMS; DHCP/gateway/reboot/power-loss chưa chạy |
| BACnet continuity | PARTIAL | Hot-rebind logs và PID continuity pass; packet-level `I-Am` chưa capture |
| Physical MCU/I/O | RED | Board dùng IOP PTY simulator, không phải STM32/field-output HIL |
| Physical HMI/usability | RED | Không có connected DRM/touch/button/backlight hardware |
| Web network commissioning | RED | BE/FE chưa migrate khỏi desired-file path |

Vì vậy không được dùng record này để claim IEC conformance, production HMI acceptance
hoặc hardware manufacturing readiness.

## 6. Rollback deployment

Nếu cần rollback release này:

1. dùng console/SSH management hiện còn trên `wlan0`, dừng riêng service cần rollback;
2. đối chiếu checksum manifest trong backup;
3. restore đồng bộ binaries, units, configs và state từ
   `/var/backups/mkddc-network-20260722T095558Z`;
4. `systemctl daemon-reload`, start lại theo thứ tự iobus → core → netcfg → Web;
5. xác minh SHM magic/version, IOP `NORMAL`, sockets, HTTP và management route.

Không restore riêng một binary nếu shared ABI/unit tương ứng không cùng baseline.
