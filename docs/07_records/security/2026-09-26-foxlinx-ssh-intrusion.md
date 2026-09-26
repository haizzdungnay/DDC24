# Sự cố bảo mật: bo lab Foxlinx bị xâm nhập qua SSH

**ID:** `SEC-INC-20260926-FOXLINX`
**Thiết bị:** bo lab Foxlinx OK1126B-S (`OK1126B-buildroot`, `mekong-fac.ddns.net`, SSH cổng WAN 2223). Đây là bo phát triển dùng chung, không phải sản phẩm ở hiện trường.
**Phát hiện:** 2026-09-26 khoảng 10:20 UTC, trong lúc điều tra vi phạm C4 của soak ADR-061 (hồ sơ `EV-PROG-FBD-ST-MB-20260925`, F17).
**Ngăn chặn:** 2026-09-26 10:24–10:45 UTC. Chủ sở hữu duyệt phương án "Ngăn chặn ngay".
**Trạng thái:** đã ngăn chặn; **chưa khắc phục triệt để**. Kẻ tấn công đã có quyền root trong ít nhất 4 ngày, nên chỉ cài lại image mới bảo đảm bo sạch.

## Tóm tắt

Kẻ tấn công đăng nhập `root` bằng mật khẩu qua SSH mở ra Internet. Cấu hình SSH của BSP khi giao đặt `PermitRootLogin yes` và `PermitEmptyPasswords yes`, còn mật khẩu root thì yếu. Journal ghi các đợt dò mật khẩu liên tục từ nhiều IP.

Sau khi vào được, kẻ tấn công đã cài các thành phần sau:
- khoá SSH riêng, rồi đặt cờ bất biến lên `authorized_keys`;
- chương trình đào tiền ảo có cơ chế tự khôi phục mỗi phút;
- một agent quét mạng.

Phiên SSH cuối của kẻ tấn công dùng bo làm điểm trung chuyển kết nối ra ngoài.

## Dòng thời gian (UTC)

| Thời điểm | Sự kiện | Bằng chứng |
|---|---|---|
| 2026-08-12 14:59 | Cài XMRig đổi tên thành `AgentSvr`, bản sao lưu, script khôi phục, timer `agentsvr-check` chạy mỗi phút | mtime `/var/backups/AgentSvr/*`, `/etc/agentsvr-check.restore`, unit |
| 2026-08-19 20:54 | Tạo `masscan-agent.service` chạy `/root/masscan-agent` | mtime unit |
| 2026-09-05 03:09 | `AgentSvr-agent.service` bị mask; ai làm chưa rõ | symlink tới `/dev/null` |
| 2026-09-10 11:54 | Tạo `/.mod`, gọi `/usr/lib/libgdi.so.0.8.2` (ELF `ET_EXEC` đặt tên giả thư viện, mtime giả trùng ngày BSP) | mtime, header ELF |
| 2026-09-22 04:45 | `Accepted password for root` từ `43.110.38.5` và `130.12.180.51` | journal `sshd` |
| 2026-09-22 04:46–04:47 | `/etc/crontab` bị ghi `*/1 * * * * root /.mod`; tạo `/var/tmp/.cache` | mtime |
| 2026-09-22 10:21:59 | Lần đăng nhập root đầu tiên từ `87.251.69.253` (tổng cộng 40 lần) | journal `sshd` |
| 2026-09-22 10:28 | `authorized_keys` được thêm khoá `rsa-key-20230629` và đặt cờ `chattr +ia` | mtime, `lsattr` |
| 2026-09-26 02:54:03 | Lần đăng nhập cuối từ `87.251.69.253`. Phiên `sshd[85869]` mở kết nối ra ngoài (IPv6, cổng 443) trong nhiều giờ | journal `sshd` |
| 2026-09-26 10:20 | Phát hiện, trong lúc tìm nguyên nhân C4 | hồ sơ audit F17 |

Ghi chú:
- `101.99.36.34` là IP công cộng của chính văn phòng (`mekong-fac.ddns.net` phân giải ra IP này). Log "from 101.99.36.34" là máy trong LAN đi vòng qua NAT, **không** phải kẻ tấn công.
- `1.53.70.62` và `192.168.1.42` là máy của nhóm.

## Dấu hiệu nhận dạng (IoC)

| sha256 | Đường dẫn gốc | Ghi chú |
|---|---|---|
| `dcda1c3b63220e899c13a24e417c47d4a2e41bf85166618c2e2392ddfe0aec06` | `/var/tmp/.cache/AgentSvr`, `/var/backups/AgentSvr/AgentSvr` | XMRig (chuỗi "mining server", "nicehash", "donate-over-proxy"); ELF x86-64, không chạy được trên bo ARM |
| `cdc8b3f343cec9c50dd0caf1a8c994a36136251a928e744c6e1580b5be3e7817` | `…/AgentSvr-updater`, `…/app-updater` | updater |
| `35e3489a6b74d5db130a3b8c2c5600c7b8685605999e3900e79a930152bd1205` | `/etc/agentsvr-check.restore` | script khôi phục |
| `dd28203ade5f840d939e0324758119d2bd658a4906cbcf6ae7c75521f68f3a86` | `/etc/systemd/system/agentsvr-check.service` | |
| `ee03e0a90474d3449ed04541c47a24f6453b080d114a2035bf4a0a717b71dddf` | `/etc/systemd/system/agentsvr-check.timer` | chạy mỗi phút |
| `988e5ad37ae7f4c33e9039309ce7b964055f1c06dd7ff9226d107240463fcccd` | `/etc/systemd/system/masscan-agent.service` | binary `/root/masscan-agent` đã bị xoá trước khi phát hiện |
| `2f34a08d31571167fb11c6ba96496246219e44403a091b7f010b4c5559cb542b` | `/.mod` | |
| `0ed1b127a19c6ddf304bdb75707ae45c06cb4c994456c6c665ceb360d80bf1d0` | `/usr/lib/libgdi.so.0.8.2` | ELF aarch64 `ET_EXEC` giả làm thư viện |
| `ac95234d459aa020883af0a93879c835582cb60d7dd63c68f33993ba2546661f` | `/etc/crontab` | crond của BSP đọc `/etc/mycron/`, nên dòng này **không** được chạy |

- IP đã đăng nhập thành công: `87.251.69.253`, `43.110.38.5`, `130.12.180.51`.
- Khoá SSH lạ: `SHA256:78gkKoLYeUW62etRipAiAw2jImcwCMnvC5BO9+3mOtY` (RSA 2048, comment `rsa-key-20230629`). Trong toàn bộ journal còn giữ (từ 2026-09-21), không IP hợp lệ nào dùng khoá này.

## Việc đã làm (2026-09-26)

Mọi thay đổi đều đảo ngược được. Bản gốc nằm trong `/root/quarantine/2026-09-26T1030Z-incident/` trên bo, gồm:
- `files/payload.tar`, quyền 000;
- `MANIFEST.txt`, chứa sha256 và mtime;
- `orig/`, chứa `sshd_config` và `authorized_keys` gốc.

1. Dừng và gỡ timer `agentsvr-check`. Chuyển toàn bộ file trong bảng IoC vào quarantine rồi xoá khỏi chỗ cũ. Làm rỗng `/etc/crontab`. Gỡ unit `AgentSvr-agent` và `masscan-agent`.
2. SSH chỉ nhận khoá:
   - `PermitRootLogin prohibit-password`;
   - `PermitEmptyPasswords no`;
   - `PasswordAuthentication no`;
   - `KbdInteractiveAuthentication no`.

   Tài khoản `forlinx` có mật khẩu, shell và `sudo ALL`; nếu vẫn cho đăng nhập bằng mật khẩu thì nó là một đường vào root khác. Đã kiểm lại: đăng nhập bằng mật khẩu (root và `forlinx`) đều bị từ chối, đăng nhập bằng khoá chạy được.
3. Gỡ cờ `+ia` khỏi `authorized_keys`, gỡ khoá `rsa-key-20230629`. Giữ khoá `mkddc24-som-opencode`, thêm khoá `mkddc24-som-chuong`. Phiên của kẻ tấn công bị ngắt khi restart sshd.
4. Chặn `87.251.69.253`, `43.110.38.5` và `130.12.180.51` bằng iptables. Unit `mkddc-incident-ipblock.service` đặt lại các luật này sau mỗi lần boot.
5. Không đổi mật khẩu tài khoản web. Không đụng dịch vụ mkddc; Core, iobus và web không restart vì ngăn chặn.

## Việc còn lại

| Việc | Ai quyết | Lý do |
|---|---|---|
| Cài lại image bo từ nguồn tin cậy, rồi cài mkddc bằng `platform/packaging/install.sh` | Chủ sở hữu hoặc IT | Có root trong ≥ 4 ngày nên không thể loại trừ thành phần chưa thấy (module kernel, binary hệ thống bị thay). Đã rà `ld.so.preload`, cron, unit, `authorized_keys`, tiến trình và file map; chưa kiểm được toàn vẹn binary hệ thống |
| Không mở SSH ra Internet, hoặc giới hạn theo IP nguồn tại router | IT văn phòng | Cổng 2223 bị dò liên tục |
| Đồng nghiệp đăng nhập bằng mật khẩu cần gửi khoá công khai để thêm vào `authorized_keys` | Nhóm | Xác thực mật khẩu SSH đã tắt |
| Cấu hình SSH của image sản phẩm | Chủ sở hữu sản phẩm | BSP khi giao đặt `PermitRootLogin yes` và `PermitEmptyPasswords yes`; thiết bị ở hiện trường không được mang cấu hình này |

## Ảnh hưởng tới số đo

- Mọi số đo trên bo từ 2026-09-22 tới 2026-09-26 10:45Z được lấy trên một bo đang bị xâm nhập.
- Thành phần độc chạy được trên ARM chỉ có timer khôi phục: mỗi phút nó chép khoảng 8,7 MB và gọi `systemctl`.
- Tải này chỉ làm số đo lệch nhịp **xấu hơn**, không tốt hơn, nên các kết luận FAIL vẫn đúng. Riêng kết luận PASS C1–C4 trong cửa sổ 600 s thì hợp lệ về chiều bảo thủ.
- Soak 24 h ADR-061 bắt đầu lại lúc 10:46:27Z, sau khi đã ngăn chặn (xem hồ sơ audit, F17).
