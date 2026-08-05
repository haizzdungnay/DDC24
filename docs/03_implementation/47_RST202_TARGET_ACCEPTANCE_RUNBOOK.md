# Runbook 47: Nghiệm thu target `RST-202` (install / startup / provenance / rollback)

> **ID:** RUNBOOK-RST202-001
> **Trạng thái:** Draft — chờ owner cấp target window
> **Phiên bản:** 1.0
> **Ngày:** 2026-08-04
> **Plan chủ quản:** [Plan 46 §6 Gate G5](46_REPOSITORY_ARCHITECTURE_RESTRUCTURE_PLAN.md)
> **Quyết định liên quan:** ADR-022 (self-hosted runner trên board), ADR-025 (bounded modules)

## 1. Mục đích và ranh giới

`RST-202` là blocker duy nhất còn lại của Plan 46. Runbook này quy định cách thu
bằng chứng target cho bốn hạng mục: install, startup order, provenance và
rollback.

Runbook **không** mở scope mới. Nó không đóng gate physical I/O HIL, real RS485
hay bất kỳ gate Programming nào; những gate đó giữ nguyên trạng thái hiện hữu.
Board lab chạy fake MCU nên mọi kết quả ở đây là **lab evidence**, không phải
production acceptance của thiết bị có MCU thật.

## 2. Trạng thái target đo được ngày 2026-08-04

Khảo sát read-only qua SSH `SOM-DDC-24` (`orangepi5b`, aarch64, uptime 3 ngày):

> **Lưu ý:** Bo mạch lab Orange Pi 5B đã **ngưng sử dụng từ 2026-08-05**. Target duy nhất hiện tại của dự án là **board Foxlinx SOM-DDC-24**
> (SSH alias `SOM-DDC-24-foxlinx`, port 2223, user `root`, MCU STM32 thật). Mọi nghiệm thu target
> từ thời điểm này đều thực hiện trên board Foxlinx.
> Xem [FOXLINX_DEPLOY_CHECKLIST.md](../08_hardware/foxlinx-som-ddc24/FOXLINX_DEPLOY_CHECKLIST.md) và [27_SOM_BOARD_DEPLOY_NO_MCU_RUNBOOK §1a](27_SOM_BOARD_DEPLOY_NO_MCU_RUNBOOK.md).


| Hạng mục | Đo được | Ý nghĩa cho `RST-202` |
|---|---|---|
| Binary đang chạy | `/usr/sbin/mkddc-{core,iobus,netcfg,hmi}` và `/opt/mkddc-web/mkddc-web` mốc **2026-08-01 15:24:05**; `mkddc-fake-mcu` **2026-07-30 19:38:14** | Target chạy build **trước** restructure (2026-08-03). Cây `apps/` chưa từng được cài lên target. |
| Provenance | `/usr/share/mkddc/` chỉ có `avahi/`; thiếu `provenance.json`, `checksums.sha256`, `runtime-build-info.txt`, `runtime-checksums.sha256` | Gate "truy binary về commit/checksum" hiện **không đóng được**. Logic sinh các file này mới vào repo ở `9c6dc9b` (2026-08-03), sau lần cài cuối. |
| Rollback | `/usr/sbin` có 7 bản sao thủ công: `.bad-20260708-170126`, `.bak-20260708-155445`, `.bak.20260717_144250`, `.bak.20260718_124545`, `.prev-20260703112137`, `.prev-20260703112209`, `.prev-20260703120642` | Rollback hiện là thao tác tay không quy trình. `RST-202` phải thay bằng rollback có diễn tập. |
| Layout cài đặt | core/iobus/netcfg ở `/usr/sbin`; web ở `/opt/mkddc-web/`; còn bản chết `/usr/local/bin/mkddc-{core,iobus,fakemcu}` mốc 2026-07-01/02 không unit nào dùng | Bản `/usr/local/bin` gây nhầm khi chẩn đoán; cần xử lý có chủ đích, không xóa kèm trong bước install. |
| Service | 8 unit `active`: core, iobus, netcfg, web-pi, fakemcu, pty, reload-helper, time-helper. `mkddc-hmi` cài nhưng `disabled` | Baseline để so sánh sau khi cài bản mới. |

## 3. Điều kiện tiên quyết

Không bắt đầu nếu thiếu bất kỳ mục nào:

1. Owner xác nhận cửa sổ bảo trì và chấp nhận service bị restart.
2. Định danh target được ghi rõ (hostname, MAC, serial) trong evidence record.
3. Có đường truy cập vật lý hoặc console dự phòng nếu SSH mất sau khi đổi network.
4. Sao lưu `/data/config`, `/data/mkddc` và bản binary đang chạy ra vị trí có nhãn
   thời gian, tách khỏi `/usr/sbin` để không nối dài đống backup ad-hoc.
5. Cây làm việc sạch (`git status --porcelain` rỗng) để provenance không mang hậu
   tố `-dirty`.

## 4. Đường build

### 4.1. Native trên board — đường được ADR-022 ưu tiên

Board là aarch64 nên `platform/packaging/build-release.sh` chạy trực tiếp được,
không cần sysroot. Đây là đường dùng cho `RST-202`.

```bash
# trên board
git -C ~/MK-DDC-24 fetch origin && git -C ~/MK-DDC-24 checkout <commit>
cd ~/MK-DDC-24
MKDDC_RELEASE_VERSION=<version> platform/packaging/build-release.sh
```

Script sinh sẵn `build/release/provenance.json` và `build/release/checksums.sha256`.

### 4.2. Cross-compile từ máy x86_64 — đường phụ

Dùng [`platform/cmake/toolchain-aarch64-linux-gnu.cmake`](../../platform/cmake/toolchain-aarch64-linux-gnu.cmake).

Trạng thái đo ngày 2026-08-04: toolchain file **đã kiểm chứng** sinh đúng ELF
`ARM aarch64`, nhưng build đầy đủ **chưa chạy được** trên máy phát triển hiện tại
vì thiếu thư viện arm64 của bên thứ ba — `ld` báo `cannot find -lmodbus`.
Chuẩn bị sysroot một lần trước khi dùng đường này:

```bash
sudo dpkg --add-architecture arm64
sudo apt-get update
sudo apt-get install -y g++-aarch64-linux-gnu libmodbus-dev:arm64 libsodium-dev:arm64
export PKG_CONFIG_LIBDIR=/usr/lib/aarch64-linux-gnu/pkgconfig
```

`MKDDC_ENABLE_HMI=ON` cần thêm `libdrm-dev:arm64` và `libfreetype-dev:arm64`.

Cross-build **không** thay được gate unit/integration: binary aarch64 không chạy
trên host, nên `ctest` vẫn phải chạy ở build native theo Plan 46 §8.

## 5. Trình tự thực hiện

### 5.1. Ghi baseline trước khi đổi

```bash
ssh SOM-DDC-24 'systemctl list-units "mkddc*" --no-legend; \
  sha256sum /usr/sbin/mkddc-core /usr/sbin/mkddc-iobus /usr/sbin/mkddc-netcfg \
            /opt/mkddc-web/mkddc-web; \
  systemctl show mkddc-core mkddc-iobus mkddc-netcfg mkddc-web-pi -p MainPID --value'
```

### 5.2. Install

```bash
sudo platform/packaging/install.sh
```

`install.sh` tự `sha256sum --check build/release/checksums.sha256` trước khi ghi,
và cài provenance vào `/usr/share/mkddc/`. Nếu checksum sai, script dừng — không
được bỏ qua bước này.

### 5.3. Kiểm startup order

Reboot rồi xác nhận thứ tự và trạng thái:

```bash
ssh SOM-DDC-24 'sudo reboot' ; sleep 90
ssh SOM-DDC-24 'systemctl list-units "mkddc*" --no-legend; \
  systemd-analyze critical-chain mkddc-core.service; \
  journalctl -b -u mkddc-iobus -u mkddc-core -u mkddc-web-pi --no-pager | head -60'
```

Acceptance: iobus sẵn sàng SHM trước khi core thoát trạng thái chờ; web không
làm control path phụ thuộc vào nó; không unit nào vào `failed`.

### 5.4. Kiểm crash/restart

Với từng service trong `mkddc-iobus`, `mkddc-core`, `mkddc-web-pi`:

```bash
ssh SOM-DDC-24 'sudo systemctl kill -s SIGKILL <unit>; sleep 15; \
  systemctl is-active <unit>; systemctl show <unit> -p NRestarts --value'
```

Acceptance: unit tự phục hồi theo policy; SHM không kẹt stale; core không xuất
output không kiểm soát trong lúc iobus vắng mặt.

### 5.5. Kiểm provenance

```bash
ssh SOM-DDC-24 'cat /usr/share/mkddc/provenance.json; \
  cat /usr/share/mkddc/runtime-build-info.txt; \
  sha256sum --check /usr/share/mkddc/runtime-checksums.sha256'
```

Acceptance: `git_commit` khớp commit đã build, `dirty=false`, và checksum runtime
khớp binary đang chạy.

### 5.6. Diễn tập rollback

Cài lại bản trước từ bản sao ở bước 3.4 (không dùng đống `.bak`/`.prev` cũ), rồi
lặp 5.3–5.5 để chứng minh bản cũ vẫn khởi động và truy nguyên được.

Acceptance: rollback đưa hệ về trạng thái khởi động được, provenance phản ánh
đúng bản đang chạy, và quy trình lặp lại được từ tài liệu này mà không cần thao
tác ứng biến.

## 6. Evidence phải ghi

Lưu JSON vào `docs/07_records/evidence/restructure/TARGET_RST202_<YYYYMMDD>.json`,
gồm: định danh target, commit, version, toolchain, command đã chạy, output thô
của từng bước 5.1–5.6, thời điểm, người thực hiện và kết luận từng acceptance.

Không dùng host package test thay bằng chứng target. Không chép số đo cũ.

## 7. Việc dọn dẹp tách riêng

Hai hạng mục dưới đây **không** nằm trong `RST-202` và không được gộp vào bước
install; mở task riêng có phê duyệt:

1. Xử lý 7 bản sao ad-hoc trong `/usr/sbin` sau khi rollback đã có quy trình.
2. Xử lý bản chết `/usr/local/bin/mkddc-{core,iobus,fakemcu}` mốc 2026-07-01/02.

## 8. Tiêu chí đóng `RST-202`

```text
TARGET_INSTALL        = PASS khi 5.2 không lỗi checksum và service lên đúng path mới
TARGET_STARTUP_ORDER  = PASS khi 5.3 đạt acceptance sau reboot thật
TARGET_CRASH_RESTART  = PASS khi 5.4 đạt cho cả ba service
TARGET_PROVENANCE     = PASS khi 5.5 truy được binary về commit/checksum
TARGET_ROLLBACK       = PASS khi 5.6 lặp lại được từ runbook
```

Đủ năm mục mới được chuyển `RST-202` sang DONE và mở `RST-205` closure review.
