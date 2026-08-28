# Cài đè thật và đường ký trên bo Foxlinx — `T59-705` (cài đè) + `T59-607` (target)

| Thuộc tính | Giá trị |
|---|---|
| Ngày | 2026-08-23 |
| Board | `SOM-DDC-24-foxlinx` (OK1126B, Buildroot, aarch64, kernel 6.1.141) |
| Nguồn | `main` tại `29c59ec` (sau khi merge `T59-607`) |
| Gói | cross-build `aarch64-linux-gnu` + `GOARCH=arm64`, `-static-libstdc++` |
| Mức bằng chứng | **TARGET** — cài đè hệ thống thật, service khởi động lại |

## 1. Vì sao lần này khác lần diễn tập 2026-08-22

Lần trước chạy với `MKDDC_INSTALL_ROOT` (cây giả) và **không** chạm dịch vụ nào.
Nó trả lời được "script chạy đúng trên Buildroot" nhưng chưa trả lời "cài đè
thật có lên được không, và bo có chấp nhận chính sách chữ ký mới không". Lần này
cài đè thật vào `/usr/sbin`, `/opt/mkddc-web`, `/etc/systemd/system` và khởi
động lại toàn bộ.

Tiền đề an toàn đã kiểm trước khi chạy: `/data/mkddc/programming/artifacts` có
**0** file `.mkir` và bo chưa có `device.key`, nên bật `SIGNATURE_REQUIRED`
không làm mất Active/LKG nào. Nếu bo đang có gói Active thì phải đi theo bảng
migration re-commission ở Plan 59 §3.7, không được cài thẳng như lần này.

## 2. GLIBCXX — cái bẫy đã tránh được bằng cách nào

Buildroot của bo chỉ có tới `GLIBCXX_3.4.30`, còn máy build dùng GCC 13. Gói
được dựng với `-static-libstdc++`, và binary chạy được ngay trên bo:

```
/tmp/mkddc-core --st-key-info
st_public_key fingerprint=fdb9a30eea28b026 mode=RELEASE
/tmp/mkddc-st-compile --version
compiler_version=fwsom-st-1.2.0 profile_id=revA-1t-1-5-30
profile_sha256=e4f235a8f994f552a5f76d7678d404f671b648ae47de450f0094c33e87f69bad
artifact_schema=1 target_abi=3841
```

## 3. Kết quả cài đè

| Kiểm | Kết quả |
|---|---|
| `sha256sum --check checksums.sha256` (7 binary) | **OK** |
| `install.sh` chạy trọn trên Buildroot | **OK** |
| Provisioning khoá thiết bị (ADR-052) | `device.key` mode `0600`, `device.pub` sinh mới |
| Core nhúng khoá phát hành | `core.st_public_key=RELEASE fingerprint=fdb9a30eea28b026` |
| Core nạp khoá thiết bị vào tập tin cậy | `core.st_trusted_key=/data/mkddc/keys/device.pub fingerprint=904f7688adbaa24a`, `st_trusted_key_count=1` |
| `mkddc-st-package` được cài | **OK** (bản vá `T59-605` giữ hiệu lực) |
| Dịch vụ sau cài | `mkddc-core` / `mkddc-iobus` / `mkddc-web-pi` / `mkddc-netcfg` đều `active` |
| Dữ liệu người vận hành | `/data/config/users.conf` giữ nguyên (không bị ghi đè) |
| `PROGRAMMING_REV_A=1` trong `/etc/mkddc-web.env` | **OK** |

Mốc khởi động trước khi cài: core `2026-08-21 14:20:42`, iobus
`2026-08-22 07:39:39`, web `2026-08-21 14:20:45`. Sau khi cài, cả bốn dịch vụ
mang mốc `2026-08-22 21:56:30` — đúng như một lần cài đè phải làm, và đây là lý
do thao tác này cần cửa sổ bảo trì.

## 4. Đường ký chạy thật trên bo (`T59-607` mức TARGET)

Biên dịch một Program ngay trên bo bằng chính khoá thiết bị của bo:

| Phép thử | Lệnh | Kết quả |
|---|---|---|
| Có khoá | `mkddc-st-compile --source /tmp/t607.st --source-id t607-target --key /data/mkddc/keys/device.key` | exit **0**; `"integrityMode":"SIGNED"`; `"signaturePresent":true`; artifact **608 byte** |
| Không khoá | `mkddc-st-compile --source /tmp/t607.st --source-id t607-nokey` | exit **2**; `"code":"ST-CLI-KEY-REQUIRED"` |

Đây là chuỗi đầy đủ của `ADR-052` chạy trên phần cứng thật: bo sinh khoá của
chính nó lúc cài, compiler của bo ký bằng khoá đó, và Core của bo tin đúng khoá
đó chứ không tin khoá của bo khác.

## 5. Điều còn thiếu, và điều kiện kỹ thuật để mở

| Hạng mục | Chặn bởi | Cần gì để mở |
|---|---|---|
| Commission 10-Program qua API trên bo (`T59-702`) | không có mật khẩu tài khoản `admin` của bo — `/data/config/users.conf` chỉ chứa bcrypt hash, và đặt lại mật khẩu chỉ có đường `POST /api/v1/users/{username}/reset-password` vốn **đã cần** phiên admin | mật khẩu admin hiện hành của bo, hoặc một tài khoản admin do chủ sở hữu cấp |
| Soak 24 h, 3 chu kỳ (`T59-702`) | phụ thuộc mục trên | sau khi Commission được, chạy fixture 10-Program và thu 24 h |
| Physical AO/DO (`T59-703`) | bo chạy `mkddc-fake-mcu`, không có MCU thật và không có thiết bị đo | MCU STM32 thật trên bo + đồng hồ/scope đo AO/DO |
| Power-cut ≥10 lần (`T59-704`) | không có nguồn cắt được điều khiển từ xa | PDU điều khiển được hoặc người thao tác tại chỗ |
| Thay controller (`T59-705`) | chỉ có một bo | bo thứ hai cùng cấu hình |

## 6. Ranh giới trung thực

Bản ghi này là **TARGET**, không phải HIL, không phải CI, và không phải soak.
Nó chứng minh: gói arm64 cài đè được, đường ký ADR-052 chạy trên phần cứng thật,
và dịch vụ trở lại `active`. Nó **không** chứng minh timing 24 h, không chứng
minh I/O vật lý, và không mở bất kỳ gate release nào.
