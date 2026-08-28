# Diễn tập cài/nâng cấp/rollback trên bo Foxlinx — `T59-705` (một phần)

| Thuộc tính | Giá trị |
|---|---|
| Ngày | 2026-08-22 |
| Board | `SOM-DDC-24-foxlinx` (RV1126B, Buildroot, aarch64) |
| Nguồn | nhánh `feat/t59-w6-hardening`, commit `70966a4` |
| Mức bằng chứng | **TARGET DRY-RUN** — chạy trên bo thật, ghi vào cây giả, KHÔNG cài đè hệ thống |

## 1. Mục tiêu

`T59-606` đã chứng minh ba kịch bản cài mới → nâng cấp → rollback trên **máy
host**. Điều đó chưa trả lời câu hỏi của `T59-705`: *script có chạy đúng trên
chính môi trường của bo hay không* — Buildroot dùng BusyBox cho `adduser`/
`addgroup`, không có `getent`/`useradd`, và toolchain khác hẳn host.

## 2. Cách dựng

Cross-build aarch64 (`platform/cmake/toolchain-aarch64-linux-gnu.cmake`) cho 6
binary C++ + `GOOS=linux GOARCH=arm64` cho `mkddc-web`, ghép thành cây
`build/release` kèm `checksums.sha256` và `provenance.json`, đẩy sang `/tmp` của
bo (17 MB). Toàn bộ diễn tập ghi dưới `MKDDC_INSTALL_ROOT=/tmp/t59705/target`.

## 3. Kết quả

| Kiểm | Kết quả |
|---|---|
| Binary aarch64 chạy trên bo | `mkddc-core --version`, `mkddc-st-compile --version` OK |
| `install.sh` chạy trọn trên Buildroot | OK — không vướng thiếu `getent`/`useradd` |
| Provisioning khoá thiết bị (ADR-052) | Sinh thành công, `device.key` mode `0600` |
| Nâng cấp không sinh lại khoá | `INFO: khoá thiết bị đã có, giữ nguyên` |
| Rollback khôi phục `mkddc-st-package` | **PASS** — bản vá `T59-606` hoạt động trên bo |
| Cấu hình người vận hành + artifact | Còn nguyên sau nâng cấp và sau rollback |
| Snapshot `pre-rollback-*` | Có |
| **Không service nào bị restart** | **PASS** — mốc `ExecMainStartTimestamp` của `mkddc-iobus`/`mkddc-core`/`mkddc-pty` không đổi |
| Dịch vụ sau diễn tập | `mkddc-iobus` / `mkddc-core` / `mkddc-web-pi` đều `active` |

## 4. Sự cố trong lần chạy ĐẦU, và vì sao nó xảy ra

**Lần chạy đầu đã làm dừng `mkddc-iobus` trên bo thật.** Đây là sự cố do bản
diễn tập gây ra, không phải do bo, và nó được ghi lại đây vì đúng loại lỗi mà một
hồ sơ bằng chứng phải nói ra.

Nguyên nhân có hai tầng, cả hai đều nằm trong bản đầu của chế độ diễn tập:

1. Khi chuyển `systemctl` sang wrapper, phép thay chỉ áp cho lời gọi ở **đầu
   dòng**. Bốn lời gọi nằm sau `&&` giữ nguyên `systemctl` thật.
2. Wrapper trả `0` cho mọi lệnh, gồm `is-enabled`. Vì vậy `sysctl_do is-enabled
   mkddc-pty && systemctl restart mkddc-pty` **luôn** đi vào nhánh phải.

Kết quả: `mkddc-pty` bị restart thật; PTY mà `mkddc-iobus` đang mở
(`--uart /tmp/mkddc-iop-a`) biến mất, và iobus thoát sạch (`iobus.shutdown`,
`status=0/SUCCESS`). Dịch vụ được khởi động lại ngay khi phát hiện (07:39:39
UTC), gián đoạn khoảng 50 giây.

Trong lúc vá còn lộ ra một lỗi nặng hơn cùng nguồn gốc: phép thay tự động đã biến
thân wrapper trong `rollback.sh` thành `sysctl_do "$@"` — tức **hàm gọi chính
nó**. Ở chế độ thật (`DRY=0`) đó là đệ quy vô hạn, nghĩa là `rollback.sh` trên bo
sẽ treo thay vì lùi. Lỗi này chưa bao giờ chạy vì mọi lần chạy trước đều ở chế độ
diễn tập.

**Bản vá:** mọi lời gọi đi qua wrapper (kể cả sau `&&`); wrapper trả **1** cho
truy vấn trạng thái (`is-enabled`/`is-active`/`is-failed`) để không nhánh phụ nào
được kích hoạt, nhưng giữ **0** cho `show` vì dưới `set -e` một phép gán
`pid="$(... show ...)"` trả khác 0 sẽ giết chính script; và thân wrapper gọi
`systemctl` thật. Hai test đọc thẳng mã nguồn khoá cả ba điều kiện
(`test_release_dryrun.py`).

**Kiểm chứng bản vá trên bo:** chạy lại trọn ba kịch bản, so mốc
`ExecMainStartTimestamp` trước/sau — không đổi, tức không dịch vụ nào bị chạm.

## 5. Còn nợ của `T59-705`

- **Cài THẬT lên bo** (không phải cây giả): cố ý chưa làm trong phiên này —
  `install.sh` đầy đủ sẽ thay cả `mkddc-iobus`/`mkddc-netcfg` và restart chúng,
  tức ngắt đường điều khiển đang chạy. Cần cửa sổ bảo trì có người trực.
- **Thay controller** (bo hỏng → bo mới): cần bo thứ hai. Chặn bởi phần cứng.
  Theo ADR-052, quy trình này phải **biên dịch lại từ Revision** chứ không bê
  artifact cũ sang, vì artifact ký bằng khoá thiết bị của bo cũ.
- **Backup/restore + read-back đầy đủ** trên dữ liệu vận hành thật.
