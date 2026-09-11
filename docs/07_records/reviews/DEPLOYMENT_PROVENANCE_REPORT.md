# Báo cáo Deployment Provenance DDC-24

**ID:** DDC24-DEPLOYMENT-PROVENANCE-2026-08-03
**Phiên bản:** 1.1
**Trạng thái:** Record lịch sử; không phải release authority
**Ngày:** 2026-08-03
**Cập nhật:** 2026-09-11
**Chủ quản:** Project Engineering
**Mục tiêu:** binary và target phải truy ngược được về version, Git commit, build time, checksum và toolchain

## Bản ghi lịch sử 2026-09-05 — Foxlinx `main@d728fa76`

Đây là record của phép đo và deployment đã diễn ra ngày 2026-09-05, không phải
mô tả runtime hiện hành. Source là commit sạch
`d728fa76020efbbb8f7346052d7e6a4020c60193`, gồm
[PR #534](https://github.com/Mekong-HCM/MK-DDC-24/pull/534) và
[PR #535](https://github.com/Mekong-HCM/MK-DDC-24/pull/535). Khi nói về trạng
thái hiện hành, record này đã bị deployment mới hơn `main@9b5608d7` ngày
2026-09-10 (ghi bởi commit `d7c67f67`) **supersede**; phần còn lại chỉ dùng để
truy nguyên sự kiện ngày 2026-09-05.

Manifest 29 raw artifact và các trích đoạn đã làm sạch nằm tại
[evidence deploy 2026-09-05](../evidence/deploy-20260905-d728fa76/README.md).
Raw snapshot local `build/evidence/deploy-20260905-d728fa76/` là đầu vào đối
chiếu, không phải artifact release đã ký.

### Phân lớp bằng chứng

| Lớp | Đối tượng đã đo | Kết quả lịch sử được truy lại | Evidence |
|---|---|---|---|
| SOURCE | Git/PR | `d728fa76…0193`, `dirty=false`; PR #534/#535 đã merge | `final-target.log`, `final-deploy.log`; manifest 29/29 |
| HOST | C++ | 1.477 ca: **1.476 pass / 1 skip memlock / 0 fail** | `final-host.log:3031-3036`; `HOST_GATES_EXCERPT.txt` |
| HOST | Go | **21 package `ok`** trên nền `c253c053`; diff `apps/web-api` tới `d728fa76` rỗng | `go.log`; `GO_GATES_EXCERPT.txt` |
| HOST | FE | **229 file, 2.836/2.836 test**; lint và `build:foxlinx` pass; Programming **137,32/165,00 KiB gzip** | `final-fe.log:49-140`; `FE_GATES_EXCERPT.txt` |
| CROSS-BUILD | ARM64 | configure/generate/build pass; discovery cache đặt `PRE_TEST` | `final-arm64.log`; `ARM64_BUILD_EXCERPT.txt` |
| TARGET | Buildroot/aarch64 | provenance sạch; checksum **13/13**; 5/5 service active, `NRestarts=0`; health **6/6** check `ok` | `final-target.log`, `final-stability.log`; `TARGET_GATES_EXCERPT.txt` |
| FAKE-MCU | Kết nối MCU trong health | `mkddc-fakemcu` active; đây không phải MCU/I/O vật lý | `final-target.log`, `final-stability.log` |
| BROWSER | Chỉ trang login | desktop 1440×900 + mobile 390×844; **14/14 HTTP 200**, 0 Console error/warning, 0 request fail, không tràn ngang | `browser-final.log`; `BROWSER_GATES_EXCERPT.json` |

Go không được mô tả là đã chạy lại trực tiếp toàn bộ tại commit cuối: raw log
thuộc nền `c253c053`, còn phép đối chiếu Git ngày 2026-09-11 chỉ chứng minh
`apps/web-api` không đổi từ nền đó tới `d728fa76`. Tương tự, cross-build chỉ
chứng minh binary ARM64 được build; `PRE_TEST` tránh chạy discovery của binary
ARM64 trên host x86 và không biến kết quả này thành test ARM64.

### Backup, lỗi đã xử lý và rollback

- Backup của cutover cuối:
  `/opt/mkddc-backups/main-d728fa76-20260905T031344Z`. Raw `final-deploy.log`
  ghi `DEPLOY_OK`; checksum runtime và identity được đọc lại sau cài.
- PR #535 chặn tham số CLI sai trước side effect. Trên target, hai ca CLI sai
  trả lỗi trong khi socket/PID giữ nguyên (`TARGET_CLI_GUARD=2/2_PASS`).
- Unit `AgentSvr-agent` sai kiến trúc được mask sau khi giữ bản sao trong backup
  trước đó. Đây là can thiệp vận hành ngoài runtime MK-DDC; không được suy thành
  xác nhận an toàn toàn hệ thống.
- Đường rollback tồn tại trong script và backup tồn tại, nhưng **diễn tập
  rollback = `NOT_RUN`**. Không ghi đường lùi đã thiết kế thành rollback PASS.

### Giới hạn bắt buộc và điểm chưa xác minh

| Hạng mục | Trạng thái | Ý nghĩa |
|---|---|---|
| FakeMCU | TARGET evidence | Có service `mkddc-fakemcu`; không phải physical MCU/HIL |
| HMI inactive theo ghi chú vận hành WIP | `UNVERIFIED` | 29 raw file không ghi trực tiếp trạng thái HMI cuối; script chỉ bảo toàn trạng thái trước deploy, nên không nâng ghi chú WIP thành TARGET PASS |
| Flash firmware STM32 | `NOT_RUN` | Manifest runtime ghi `mcu_firmware=not-included` |
| Physical I/O/HIL | `NOT_RUN` | Không có phép đo vật lý |
| Soak 24 giờ / power-cut | `NOT_RUN` | Không có evidence |
| Rollback exercise | `NOT_RUN` | Có backup/đường rollback, chưa diễn tập |
| Chrome DevTools MCP | `NOT_RUN` | Browser evidence dùng Playwright/Chromium headless |
| Luồng sau đăng nhập | `NOT_RUN` | 14 request chỉ thuộc trang login |
| Signed release / commissioning / `RELEASE_READY` | Không được suy ra | Record này không có thẩm quyền mở release gate |

## As-Built source/package

### Build identity

- C++ core/iobus/netcfg dùng `shared/build_info.h` và CMake-generated definitions.
- Go web dùng linker variables và hỗ trợ `--version`.
- Firmware ELF nhúng version, Git commit, build time và ARM toolchain.
- Worktree dirty tự động thêm hậu tố `-dirty`; không giả binary dirty thành commit sạch.

### Release bundle

`packaging/build-release.sh` tạo lại:

- `mkddc-core`;
- `mkddc-iobus`;
- `mkddc-netcfg`;
- `mkddc-web`;
- frontend production `dist`;
- firmware `firmware.elf`;
- `provenance.json`;
- `checksums.sha256`.

`packaging/install.sh` kiểm tra checksum trước khi install, cài lại core/iobus/netcfg/web/frontend và systemd units, sau đó tạo trên target:

- `/usr/share/mkddc/provenance.json`;
- `/usr/share/mkddc/checksums.sha256`;
- `/usr/share/mkddc/runtime-build-info.txt`;
- `/usr/share/mkddc/runtime-checksums.sha256`.

## Bằng chứng build trong phiên

Firmware ELF có chuỗi:

```text
version=0.1.0
git_commit=5eeb7b9bf95e0c7d7933766ae3bf62e7c6fdb90f-dirty
toolchain=arm-none-eabi-gcc-13.2.1
```

Release script được chạy lại sau thay đổi source cuối cùng; năm artifact trong
manifest đều qua `sha256sum --check`. Bốn binary SOM trả đúng cùng version,
commit-dirty và toolchain qua `--version`; firmware ELF trả cùng identity qua
`strings`. Script không được coi là deployment thành công nếu chưa đối chiếu
target.

| Artifact | SHA-256 của lần build cuối |
|---|---|
| `mkddc-core` | `fbbefad5fb019113c095de5afdc98358d380a1a57abf2ba0b2f0eafce2a2c782` |
| `mkddc-iobus` | `6952cf970e8828a1bf1c03b3ce3ecba5bdfcb6a7e2de7680631818bbbe2dacb4` |
| `mkddc-netcfg` | `6a562d65076e1999b4cafb9616afc5fd992c3d0bc64749ac838083a51be43f58` |
| `mkddc-web` | `09e60699c3442bcc77968335b18864eb7f7a1e740ea1be1ffecd811a99779fdd` |
| `firmware.elf` | `c8ea76c9ab383348073d82602a8e4d6e00a2122f846a71eb66a69a0f3e3139e3` |

## Audit target trước deployment

Target `SOM-DDC-24` đang chạy binary cũ:

| Binary | SHA-256 đang chạy |
|---|---|
| `/usr/sbin/mkddc-core` | `8c6d…14e5a` |
| `/usr/sbin/mkddc-iobus` | `a1b3…fec23` |
| `/opt/mkddc-web/mkddc-web` | `4dbb…4132` |

Target chưa có provenance manifest/runtime-build-info. `/health` của binary cũ trả SPA HTML thay vì health JSON. Vì source hiện chưa được commit, không deploy dirty bundle lên target và không tuyên bố target map đúng commit.

## Trạng thái gate

| Gate | Source/package | Target đang chạy |
|---|---|---|
| version/commit/build time/toolchain trong binary | Có | Chưa chứng minh |
| SHA-256 release manifest | Có | Chưa cài |
| installer cài đủ service/web/frontend | Có trong script | Chưa chạy với bundle mới |
| runtime `--version` tập trung | Có | Chưa có |
| target hash map đúng commit sạch | Chưa thể vì worktree dirty | Không |
| health JSON của binary mới | Test BE đạt | Chưa deploy |

`npm ci` đồng thời báo bốn advisory mức high trong dependency tree. Nhiệm vụ
này không được mở rộng thành security/dependency upgrade nên chưa triage hoặc
chạy auto-fix; đây là finding release riêng, không bị che bởi kết quả build
thành công.

## Điều kiện đóng

1. review và commit toàn bộ thay đổi nền;
2. build từ worktree sạch/CI artifact đã ký;
3. chạy installer trên target với release manifest;
4. đối chiếu `runtime-checksums.sha256`, từng `--version` và `provenance.json` với commit;
5. chạy `/health`, crash/restart, reboot/power-cycle và lưu raw evidence.

## Commit list

- Commit nền: `5eeb7b9bf95e0c7d7933766ae3bf62e7c6fdb90f`.
- Commit chứa các thay đổi báo cáo này: **chưa có**; thay đổi đang ở worktree theo đúng việc chưa được yêu cầu commit.

```text
BUILD_PROVENANCE_EMBEDDED = YES
RELEASE_BUNDLE_COMPLETE = YES
TARGET_PROVENANCE_VERIFIED = NO
DEPLOYMENT_PROVENANCE_READY = NO
```

## Revision history

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-08-03 | Lập record build identity, release bundle và sai khác target ban đầu |
| 1.1 | 2026-09-11 | Baseline hóa record lịch sử deployment `d728fa76` ngày 2026-09-05 cùng manifest 29 raw artifact; phân lớp SOURCE/HOST/CROSS-BUILD/TARGET/FAKE-MCU/BROWSER, ghi rõ đã bị deployment `9b5608d7` supersede về hiện trạng và giữ HIL/rollback/release ở đúng giới hạn |
