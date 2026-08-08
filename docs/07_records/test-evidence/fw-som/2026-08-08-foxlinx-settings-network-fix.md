# Evidence — Sửa trang `/settings/network` trên Foxlinx SOM-DDC-24

> **Ngày:** 2026-08-08 · **Bo:** `SOM-DDC-24-foxlinx` (`OK1126B-buildroot`, aarch64, kernel 6.1.141,
> buildroot + systemd 254 + systemd-networkd, **không có NetworkManager**)
> **Triệu chứng ban đầu:** trang `/settings/network` hiện ACTIVE/KERNEL toàn đỏ
> (`INTERFACE_NOT_FOUND`), "No configured profile", "No editable network candidate",
> hai banner vàng, và nút **Lưu thay đổi khoá vĩnh viễn**.
> **Kết quả:** trang hoạt động đầy đủ; giao dịch `stage → apply → confirm` và
> `stage → apply → rollback` đã chạy thật trên `eth0` của bo.

---

## 1. Trạng thái trước khi sửa (bằng chứng nguyên văn)

Hỏi thẳng authority qua socket `/run/mkddc-netcfg/netcfg.sock` (forward bằng SSH):

```json
{"active":{"adminUp":false,"carrier":false,"dnsServers":[],"gateway":"","interface":"end1",
 "ipv4":"","link":"unknown","mode":"unknown","prefixLength":0,"reasonCode":"INTERFACE_NOT_FOUND"},
 "capabilities":["dns","management-hostname"],
 "management":{"hostname":"OK1126B-buildroot","mdnsName":"OK1126B-buildroot.local","stable":false},
 "reasonCode":"OK","result":"accepted","state":"idle","version":1}
```

Không có khoá `configured`. Khảo sát bo:

```
/sys/class/net:  eth0 (type=1 carrier=1, 192.168.1.110/24)   ← Ethernet thật
                 wlan0 (phy80211, 192.168.1.26/24)           ← đường quản trị, default route
                 p2p0 (phy80211), lo
nmcli:           KHÔNG có
networkctl:      /usr/bin/networkctl, systemd 254, `networkctl reload` chạy được
Network File:    /etc/systemd/network/10-eth0.network  (Address=192.168.0.232/24, Gateway=192.168.0.1)
/etc/mkddc/netcfg.conf: NETCFG_INTERFACE=end1
```

---

## 2. Sáu nguyên nhân độc lập

| Mã | Nguyên nhân | Bằng chứng |
|---|---|---|
| **NC-01** | `NETCFG_INTERFACE=end1` (tên của Orange Pi 5B) trong khi bo đặt tên `eth0` | `reasonCode=INTERFACE_NOT_FOUND`, `ip -br link` không có `end1` |
| **NC-02** | `LinuxPlatform` gắn cứng `nmcli`; bo dùng systemd-networkd | `configured` = null vĩnh viễn; mọi `stage` sẽ chết ở `PREVIOUS_STATE_NOT_RESTORABLE`, `persist` ở `NETWORKMANAGER_UNAVAILABLE` |
| **NC-03** | `valid_management_hostname()` chỉ nhận `[a-z0-9-]` | `OK1126B-buildroot` có chữ hoa ⇒ `stable=false` dù RFC 1123 §2.1 không phân biệt hoa thường |
| **NC-04** | FE đòi `location.hostname === management.mdnsName` mới cho Apply | truy cập qua `mekong-fac.ddns.net:8082` ⇒ không bao giờ khớp ⇒ nút Lưu khoá vĩnh viễn; chặt hơn chính ADR-017 §1 |
| **NC-05** | FE hiện empty state "No editable network candidate" không có lối thoát | bo chưa có profile đọc được ⇒ trang mạng read-only vĩnh viễn |
| **NC-06** | `/data/mkddc` mode `0755 mkddc:mkddc`, netcfg chạy `User=root Group=mkddc` **không có CAP_DAC_OVERRIDE** | `stage` trả `JOURNAL_WRITE_FAILED` — cơ chế giao dịch chết ngay bước đầu |

**Chứng minh NC-06 bằng thí nghiệm phân biệt được** (cùng sandbox với unit thật):

```
chmod 0755 /data/mkddc → touch: cannot touch '/data/mkddc/.p0755': Permission denied → WRITE_FAIL_0755
chmod 0775 /data/mkddc → WRITE_OK_0775
```

`/proc/<pid>/status` của mkddc-netcfg: `Uid: 0`, `Gid: 114 (mkddc)`,
`CapEff: 0000000000003000` = chỉ `CAP_NET_ADMIN|CAP_NET_RAW`. Không có `CAP_DAC_OVERRIDE`
nghĩa là uid 0 vẫn phải tuân thủ DAC như người dùng thường.
`mkddc-time-helper.service` đã xin sẵn `CAP_DAC_OVERRIDE` cho đúng lớp vấn đề này;
netcfg bị bỏ sót.

---

## 3. Trạng thái sau khi sửa

```json
{"active":{"adminUp":true,"carrier":true,"dnsServers":["114.114.114.114"],"gateway":"",
 "interface":"eth0","ipv4":"192.168.1.110","link":"up","mode":"static","prefixLength":24,
 "reasonCode":"OK"},
 "capabilities":["dns","management-hostname"],
 "configured":{"dns":{"mode":"manual","servers":["114.114.114.114"]},"interface":"eth0",
 "ipv4":"192.168.1.110","mode":"static","netmask":"255.255.255.0"},
 "management":{"hostname":"OK1126B-buildroot","mdnsName":"ok1126b-buildroot.local","stable":true},
 "reasonCode":"OK","result":"accepted","state":"confirmed","version":1}
```

Journal khởi động: `INFO netcfg.start interface=eth0`.

---

## 4. Giao dịch thật trên bo

Đường quản trị đi qua `wlan0` (default route), giao dịch đụng `eth0` — đã kiểm chứng
`eth0` cùng phân đoạn LAN (`arping -I eth0 192.168.1.1` → `14:49:BC:09:A1:58`, đúng MAC
gateway mà `wlan0` đang dùng), nên không có rủi ro cắt phiên.

### 4a. `stage → apply → confirm`

| Bước | Kết quả |
|---|---|
| `stage {eth0, static, 192.168.1.110/24}` | `accepted / OK / staged`, tx `net-1786162605196-133412-1` |
| `apply` | `accepted / OK / awaiting_confirmation`, `rollbackRemainingS=120` |
| `confirm` | `accepted / OK / confirmed` |
| `status` sau confirm | `configured` chuyển từ profile cũ (192.168.0.232) sang **192.168.1.110** — tức đọc từ file netcfg vừa ghi |

File do netcfg sinh ra, `[Match]` **kế thừa nguyên vẹn** từ file nhà sản xuất:

```ini
# Sinh bởi mkddc-netcfg — KHÔNG sửa tay.
# Mọi thay đổi hợp lệ đi qua giao dịch stage/apply/confirm.
[Match]
Name=eth0
KernelCommandLine=!root=/dev/nfs

[Network]
DHCP=no
Address=192.168.1.110/24
DNS=114.114.114.114
```

`networkctl status eth0` → `Network File: /etc/systemd/network/05-mkddc-eth0.network`
(tiền tố `05-` sắp trước `10-eth0.network` nên thắng mà không phải sửa file gốc).

### 4b. `stage → apply → rollback` (đổi địa chỉ THẬT)

| Bước | Địa chỉ eth0 quan sát được |
|---|---|
| trước | `192.168.1.110/24` |
| sau `apply {192.168.1.111/24}` | `192.168.1.110/24` **và** `192.168.1.111/24 secondary` — apply GIỮ địa chỉ cũ đúng như thiết kế |
| sau `rollback` | chỉ còn `192.168.1.110/24`; state `rolled_back`, reason `EXPLICIT_ROLLBACK` |

`ip route` không đổi trong suốt quá trình: `default via 192.168.1.1 dev wlan0`.
Phiên SSH không hề đứt.

---

## 5. Số đo kiểm chứng

| Bộ | Lệnh | Kết quả |
|---|---|---|
| C++ | `cmake --fresh … -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON` + `ctest` | **860/860 pass** (trước: 849, +11 test netcfg mới) |
| Go | `go vet ./...` + `go test ./... -count=1` | sạch, tất cả package `ok` |
| FE unit | `npx vitest --run --environment jsdom src` | **446/446 pass** (51 file) |
| FE lint | `npm run lint` | 0 warning |
| FE build | `npm run build` | thành công |
| E2E | `npx playwright test e2e/network-qa.spec.ts` | **1 passed** |
| Bo | sha256 bundle triển khai | `7db7ad70…a405` — trùng khớp bản build cục bộ |
| Bo | `/api/v1/health` | `status: ok`, 6/6 check ok |
| Bo | `systemctl is-active` 5 service | tất cả `active` |

---

## 6. Đã đổi gì trên bo

```
/usr/sbin/mkddc-netcfg              ← bản mới (bản cũ giữ ở mkddc-netcfg.prev)
/etc/mkddc/netcfg.conf              ← NETCFG_INTERFACE=eth0 (cũ ở .prev)
/etc/systemd/system/mkddc-netcfg.service
    ReadWritePaths=… /etc/systemd/network   (cũ ở .prev)
/data/mkddc                         ← chmod 0775
/opt/mkddc-web/dist                 ← bundle mới (bản cũ ở dist.old)
/etc/systemd/network/05-mkddc-eth0.network   ← do CHÍNH giao dịch netcfg sinh ra
```

Bo được để lại ở trạng thái `confirmed`, cấu hình `eth0 = 192.168.1.110/24` khớp giữa
active và configured. Sau reboot, systemd-networkd áp dụng đúng profile này; `wlan0`
giữ nguyên default route.

## 7. Còn treo

- Chưa chụp được ảnh giao diện sau khi sửa: không có mật khẩu tài khoản Web của bo
  (`CHUONG`, `admin`). Đã kiểm chứng thay thế bằng ba đường: (a) payload thật của
  authority đi qua `validNetcfgResponse` của adapter Go — test hồi quy
  `TestNetcfgClientAcceptsFoxlinxNetworkdAuthorityResponse`; (b) sha256 bundle trên bo
  trùng bản build cục bộ và chứa các chuỗi mới; (c) toàn bộ giao dịch chạy thật ở §4.
