# Deploy Foxlinx — Plan 59 W6 (T59-601/602/605)

| Thuộc tính | Giá trị |
|---|---|
| Ngày | 2026-08-21 |
| Board | `SOM-DDC-24-foxlinx` (RV1126B, Buildroot, aarch64) |
| Nguồn | nhánh `feat/t59-w6-hardening`, commit gốc `a35f578` + W6 |
| Mức bằng chứng | **TARGET DEPLOY** — chưa phải soak 24 h, chưa phải I/O vật lý |

## 1. Cách build

Cross-build aarch64 với `-static-libstdc++ -static-libgcc`. Board chỉ có
`libstdc++` tới `GLIBCXX_3.4.30`; link tĩnh làm binary không còn phụ thuộc
phiên bản đó — kiểm lại bằng `strings`: không còn symbol `GLIBCXX_*` nào.

```
cmake -S . -B build/arm64 \
  -DCMAKE_TOOLCHAIN_FILE=platform/cmake/toolchain-aarch64-linux-gnu.cmake \
  -DCMAKE_BUILD_TYPE=Release -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON \
  -DMKDDC_ENABLE_HMI=OFF -DCORE_BUILD_TESTS=OFF -DIOBUS_BUILD_TESTS=OFF \
  -DCMAKE_EXE_LINKER_FLAGS="-static-libstdc++ -static-libgcc"
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build ...   # mkddc-web
npm run build:release                                 # FE, cờ Programming ON
```

## 2. Lỗi tìm thấy TRÊN BOARD trước khi cài

```
$ ls -la /usr/sbin/mkddc-st-package
ls: cannot access '/usr/sbin/mkddc-st-package': No such file or directory
```

BE gọi đúng đường dẫn này ở bước Commission (`ProgrammingPackagerPath`). Đây là
finding của `T59-605`: một bo cài từ gói phát hành đi trọn Draft → Check rồi
hỏng ở Commission. Không cổng nào phía trước bắt được vì build/test/install đều
xanh.

## 3. Trình tự deploy

1. Backup `/data/config` + `/data/mkddc` → `/tmp/mkddc-backup-20260821T141939.tar.gz` (4.4 MB).
2. Snapshot binary + dist đang chạy → `/var/backups/mkddc/w6-20260821T142029/`
   (đường lùi: copy ngược lại rồi `systemctl restart`).
3. `scp` (board Buildroot **không có `rsync`**) 7 artifact vào `/tmp/w6-deploy`.
4. Chạy thử **trên board** trước khi cài: `--version` của cả 4 binary chạy được.
5. Stop `mkddc-web-pi` + `mkddc-core` → `install` binary → thay `dist` → start.
   `mkddc-iobus`/`mkddc-netcfg` **không đụng tới** (ngoài phạm vi W6; thay chúng
   sẽ ngắt poll MCU mà không có lý do).

## 4. Kết quả sau deploy

| Kiểm | Kết quả |
|---|---|
| `systemctl is-active mkddc-iobus mkddc-core mkddc-web-pi` | `active` / `active` / `active` |
| Log core — TTL hold-last (ADR-051) | `INFO core.program_hold_ttl_ms=60000 signed_ms=60000 base_step_ms=1000` |
| Log core — cổng khoá ký (T59-602) | `CRITICAL core.st_public_key=TEST fingerprint=99354613db15918a` |
| `/usr/sbin/mkddc-st-package --version` | `revA-1t-1-5-30` (trước deploy: không tồn tại) |
| IPC Programming | `/run/mkddc/programming-v1.sock` có mặt |
| `GET /api/v1/programming/projects` | **401** (route có, cờ BE ON) — trước đây 404 |
| `GET /` (UI) | 200, bundle có chunk `programming-*.js` |

Dòng `CRITICAL ... st_public_key=TEST` là **đúng như thiết kế**: bản này là bản
lab, chưa có hạ tầng khoá phát hành. Nó hiện ra ở log board chính là điều mà
`T59-602` muốn — trước đó không có đường nào để biết bo đang chạy khoá test.

## 5. Còn nợ

- Soak 24 h, timing 3 chu kỳ, fault injection: `T59-702`.
- I/O vật lý đo bằng thiết bị: `T59-703`.
- Power-cut/RETAIN ma trận: `T59-704`.
- Bật `SIGNATURE_REQUIRED`: chờ Security+Product chốt nơi ký và nơi giữ khoá
  riêng (`T59-602` PARTIAL).
