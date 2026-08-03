# Báo cáo Deployment Provenance DDC-24

**ID:** DDC24-DEPLOYMENT-PROVENANCE-2026-08-03
**Ngày:** 2026-08-03
**Mục tiêu:** binary và target phải truy ngược được về version, Git commit, build time, checksum và toolchain

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
