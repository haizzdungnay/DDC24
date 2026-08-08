# Evidence — Deploy và E2E trang `settings/network` trên Orange Pi 5B (aarch64)

> **Ngày:** 2026-07-31
> **Target:** Orange Pi 5B, `aarch64`, Debian Bookworm, hostname `orangepi5b`
> **Nội dung:** đóng finding F-01…F-13 của
> `docs/07_records/reviews/archive/KX-DDC24-SETTINGS-NETWORK-IMPLEMENTATION-STATUS-2026-07-31.md`
> **Chế độ board:** lab / no-MCU (`mkddc-fakemcu` + `mkddc-pty` active)
> **Use case tham chiếu:** [KX-DDC24-UC-WEB-NETWORK-001_VI](../../../04_uiux/KX-DDC24-UC-WEB-NETWORK-001_VI.md)

---

## 1. Điều kiện an toàn khi thử nghiệm mạng

| Hạng mục | Giá trị |
|---|---|
| Interface do `mkddc-netcfg` quản lý | `end1` (`NETCFG_INTERFACE=end1`) |
| Đường quản trị khi test | `wlan0` = `192.168.1.18`, default route qua wlan0 |
| Carrier `end1` lúc bắt đầu | `0` (chưa cắm cáp) → sau khi cắm: `1`, `operstate=up` |

**Vì sao an toàn:** mọi thao tác đổi địa chỉ chỉ tác động `end1`, trong khi phiên
SSH và HTTP quản trị đi qua `wlan0`. Kể cả khi `end1` mất địa chỉ giữa chừng thì
đường quản trị không đứt. Đây là điều kiện bắt buộc trước khi chạy nhóm use case
mutation.

## 2. Artifact đã deploy

| Thành phần | Cách dựng | Ghi chú |
|---|---|---|
| `mkddc-web` | Cross-compile x86-64 → arm64, `CGO_ENABLED=0` | ELF aarch64 statically linked, stripped |
| `dist/` (FE) | `npm run build` ở host | |
| `mkddc-iobus` | Build native trên board (`cmake --parallel 6`) | exit 0 |
| `mkddc-netcfg` | Build native trên board | exit 0 |
| `mkddc-reload-helper.service` | Unit mới | `enable --now` |

Backup trước khi cắt: `/opt/mkddc-backup-20260731-114544/` (binary cũ + `dist/` + `users.conf`).

## 3. Kiểm chứng mở rộng SHM

```
Trước deploy:  -rw-r--r-- 1 mkddc mkddc  528 /dev/shm/mkddc_io_shm
Sau deploy:    -rw-r--r-- 1 mkddc mkddc 1304 /dev/shm/mkddc_io_shm
```

`kx_io_shm_t` nối thêm khối telemetry ở CUỐI, **giữ nguyên magic** `0x4B584404`.
Offset cũ bất biến — chốt bằng `static_assert` trong `test_io_cache.cpp` và
`ShmLayout.FieldbusTelemetryIsAppendedWithoutMovingLegacyFields`.

## 4. Kết quả kiểm thử tự động

| Bộ test | Kết quả |
|---|---|
| `ctest` (host x86-64) | **706/706 passed** |
| `go test ./...` (`web/backend`) | **pass** |
| `vitest` (`npm test`) | **152/152 passed**, riêng `NetworkPage.test.tsx` 28/28 |
| `netcfg_tests` (aarch64, trên board) | **49/49 passed** |

### 4.1 Ghi chú về `ctest` chạy trên board

Chạy `ctest` trực tiếp trên board cho **695/700** với 5 test hỏng
(`BacnetObjTable.*`, `StIntegration.*`). Đây **không** phải hồi quy:

- Lỗi thực là `ASSERT_TRUE(t.attach())`, tức không mở được segment SHM.
- Trên board, `/dev/shm/mkddc_{io,plc}_shm` thuộc `mkddc:mkddc` mode `0644`, còn
  test chạy bằng user `orangepi` nên không mở được `O_RDWR`.
- Kiểm chứng: chạy đúng 5 test đó trong mount namespace riêng với `/dev/shm` sạch
  (`unshare -m` + `mount -t tmpfs`) → **11/11 passed**.

## 5. E2E trên phần cứng thật — 38/39 PASS

Không mock, không stub: gọi REST thật `mkddc-web` → `mkddc-netcfg` →
NetworkManager → kernel. Tài khoản `e2e-admin`/`e2e-viewer` được tạo tạm và **đã
xoá** sau khi chạy; secret tạm trên board đã xoá.

| Use case | Kết quả | Bằng chứng nổi bật |
|---|---|---|
| UC-WEB-NET-001 | PASS | `carrier=true`, `reason=OK`, `mode=static`, capabilities đúng |
| UC-WEB-NET-002 | PASS | `bmsLink=online` từ cờ bind thật; `firmware=0.1.0-be-b6c`; 0 slave ⇒ bảng rỗng trung thực |
| UC-WEB-NET-003 | PASS | viewer GET=200, POST stage=403, PUT=403 |
| UC-WEB-NET-004 | PASS | 4/4 candidate sai bị chặn, candidate hợp lệ được chấp nhận |
| UC-WEB-NET-005 | PASS | **Kernel nhận `192.168.50.150` thật**, `awaiting_confirmation` còn 120s, Confirm giữ địa chỉ |
| UC-WEB-NET-006 | 1 FAIL | Rollback → `rolled_back` và kernel quay lại last-known-good đều PASS; xem §6 |
| UC-WEB-NET-007 | PASS | `pending.dns` echo `1.1.1.1,8.8.8.8`; `auto`+`static` bị chặn |
| UC-WEB-NET-008 | PASS | Stage/apply DHCP thật; lease thật `192.168.1.52` |
| UC-WEB-NET-009 | PASS | `applied=true`, **`activeBacnetPort` 47808 → 47810** ⇒ F-01 áp dụng thật |
| UC-WEB-NET-010 | PASS | 55 bản ghi audit `network.*`; 0 dòng rò candidate/địa chỉ |

## 6. Lần fail còn lại — nguyên nhân

UC-WEB-NET-006 báo `ip=192.168.50.150 mong đợi 192.168.50.161`.

Nguyên nhân là **trạng thái sót giữa các kịch bản trong chính script E2E**, không
phải lỗi sản phẩm: kịch bản DHCP ở UC-008 chạy trước đó để lại một giao dịch còn ở
`applying`/`awaiting_confirmation`, nên `stage` của UC-006 bị authority từ chối
bằng `TRANSACTION_IN_PROGRESS` — đúng theo thiết kế (không cho ghi đè giao dịch
chưa kết thúc). Chẩn đoán thủ công ngay sau đó cho thấy `end1` khi ấy đang mang
lease DHCP thật `192.168.1.52` do UC-008 để lại.

Cùng đường mã đó đã PASS ở UC-WEB-NET-005 với địa chỉ được kernel nhận thật. Việc
cần làm là bổ sung bước dọn trạng thái sau mỗi kịch bản trong script E2E.

## 7. Ba lỗi FW SOM chỉ lộ ra khi chạy trên phần cứng thật

Đây là giá trị lớn nhất của lần chạy này — cả ba đều **không** bị host test bắt được.

### 7.1 Profile trùng tên khoá cứng thiết bị

NetworkManager cho phép nhiều profile trùng tên; board có **2 profile tên `end1`**.
`netcfg` truyền TÊN vào `nmcli connection show` nên nmcli khớp cả hai và in hai
khối, khiến `-g ipv4.method` trả `"manual\n\nmanual"` → không khớp `"manual"` →
`mode=unknown` → `configured=null` → **mọi lần `stage` sau đó bị từ chối bằng
`PREVIOUS_STATE_NOT_RESTORABLE`**. Hệ quả: thiết bị không còn đổi được mạng qua
giao diện cho tới khi có người vào SSH dọn profile trùng.

Sửa: tra cứu bằng **UUID** (`GENERAL.CON-UUID`) thay vì tên, cộng đọc theo dòng đầu.
Chốt bằng `DuplicateProfileNamesDoNotBreakConfiguredReadback` và
`ActiveProfileIsResolvedByUuidNotByName`.

Quan sát sau khi sửa, trên chính board đó:

```
trước:  active.mode= unknown   configured= null
sau:    active.mode= static    configured= {"interface":"end1","ipv4":"192.168.50.61",
                                            "mode":"static","netmask":"255.255.255.0"}
```

### 7.2 Candidate DHCP sai schema làm hỏng cả trang

`to_json(Candidate)` luôn phát `ipv4`/`netmask`/`gateway` kể cả khi rỗng, trong khi
schema v1 **cấm** ba field này với `mode=dhcp`. Sau khi stage một giao dịch DHCP,
`pending` sai schema nên adapter Go từ chối response ⇒ **mọi lần đọc status trả 502
và trang `settings/network` không dùng được** cho tới khi giao dịch được dọn.

Sửa: bỏ hẳn field rỗng khi serialize. Chốt bằng
`DhcpCandidateOmitsAddressFieldsPerSchema` và
`StaticCandidateKeepsAddressesAndDropsEmptyGateway`.

### 7.3 Không đổi được mỗi DNS

`preflight` chạy `arping -D` ra đúng interface đang giữ địa chỉ đó, nên nó tự phát
hiện mình và trả `DUPLICATE_ADDRESS`. Hệ quả: không thể stage lại địa chỉ hiện
hành, tức **không thể chỉ đổi DNS mà vẫn giữ nguyên IP** — một thao tác hoàn toàn
hợp lệ.

Sửa: bỏ qua ARP probe khi candidate trùng địa chỉ hiện hành của chính interface;
địa chỉ khác vẫn probe và vẫn chặn khi trùng thật. Chốt bằng
`RestagingTheAddressTheInterfaceAlreadyHoldsIsNotADuplicate` và
`DifferentAddressStillRunsDuplicateDetection`.

## 8. Trạng thái board sau khi kết thúc

| Hạng mục | Trạng thái |
|---|---|
| `mkddc-iobus`, `mkddc-netcfg`, `mkddc-web-pi`, `mkddc-reload-helper` | active |
| Tài khoản E2E tạm | **đã xoá** (`users.conf` còn `admin`, `op1`, `view1`) |
| Secret tạm trên board | đã xoá (`/tmp/e2e.*`) |
| Cổng BACnet | khôi phục `47808` |
| Backup để hoàn tác | `/opt/mkddc-backup-20260731-114544/` |

## 8b. F-14 — Confirm làm interface mất SẠCH địa chỉ IPv4

> **Mức: Cao. ĐÃ SỬA và đã kiểm chứng trên phần cứng thật 2026-07-31.**

### Chẩn đoán cuối cùng

Mô tả ban đầu ("apply không đổi địa chỉ") **chưa đúng**. Điều tra sâu hơn cho thấy
hai điều tách bạch:

1. **Việc giữ cả hai địa chỉ trong `awaiting_confirmation` là CÓ CHỦ ĐÍCH.**
   `LinuxPlatform::apply` cố tình chỉ `ip address add` địa chỉ mới mà giữ nguyên
   địa chỉ cũ, để phiên quản trị không đứt trong cửa sổ 120 giây chờ confirm. Đây
   là thiết kế đúng, không phải lỗi.

2. **Lỗi thật nằm ở `confirm`.** Khi địa chỉ mới CÙNG subnet với địa chỉ cũ, kernel
   gắn nó làm **secondary**. Với `net.ipv4.conf.<if>.promote_secondaries = 0` (mặc
   định trên board này), lệnh xoá địa chỉ **primary** trong `confirm` kéo theo xoá
   luôn mọi secondary cùng subnet ⇒ interface **mất sạch địa chỉ IPv4**.

### Bằng chứng TRƯỚC khi sửa (board thật)

```
--- trong awaiting_confirmation ---
inet 192.168.50.150/24 scope global end1
inet 192.168.50.161/24 scope global secondary end1
confirm: confirmed
--- SAU confirm ---
(không còn dòng inet nào)
authority: active.ipv4 = ''
```

Thiết bị rớt khỏi mạng dù authority đã báo `confirmed`. Trên site thật đây là một
chuyến xe ra hiện trường. Chỉ nhánh static→static **cùng subnet** mới sai; DHCP→static
và static→static khác subnet đều đúng, nên lỗi ẩn rất lâu.

### Cách sửa

Trong `LinuxPlatform::confirm`, sau khi xoá địa chỉ cũ thì **khẳng định lại** địa chỉ
candidate và **fail-closed** nếu không đặt lại được (thà báo lỗi để rollback còn hơn
chốt `confirmed` trên một interface không có địa chỉ). Nhánh DHCP được loại trừ vì
candidate không mang `ipv4`.

Bốn test mới chốt đủ bốn nhánh chuyển đổi, trong đó fake mô phỏng đúng hành vi
`promote_secondaries = 0` của kernel:
`ConfirmKeepsCandidateAddressWhenOldAndNewShareASubnet`,
`ConfirmKeepsCandidateAddressAcrossSubnets`,
`ConfirmSucceedsForDhcpWithoutCandidateAddress`,
`ConfirmWithUnchangedAddressTouchesNothing`.

### Bằng chứng SAU khi sửa (cùng board, cùng kịch bản)

```
--- trong awaiting_confirmation ---
inet 192.168.50.150/24 scope global end1
inet 192.168.50.161/24 scope global secondary end1
confirm: confirmed
--- SAU confirm ---
inet 192.168.50.161/24 scope global end1          ← đúng một địa chỉ, đúng candidate
authority: active.ipv4 = '192.168.50.161' reason = OK
```

`ctest`: **710/710** (host) · `netcfg_tests` trên board aarch64: **53/53**.

## 8c. Ghi nhận — netcfg đơn luồng (không sửa, có chủ đích)

Đo trên board: status lúc rảnh ~0,34 s; trong lúc mutation có ARP preflight, **một**
request lên 2,68 s rồi trở lại bình thường — tất cả đều HTTP 200, không có lỗi.

Không refactor khoá của engine giao dịch: đây là code có rollback fail-closed, và
một độ trễ 2,7 s không gây lỗi thì chưa đủ cơ sở để đánh đổi rủi ro. Ghi nhận là
giới hạn đã biết.

## 8d. Ghi chú lịch sử — mô tả F-14 ban đầu

> **Mức: Cao. Chưa sửa.** Phát hiện ở lần chạy E2E cuối trên bản đã deploy đầy đủ.

**Triệu chứng.** Khi đổi từ IPv4 tĩnh này sang IPv4 tĩnh khác **trong cùng subnet**
(`192.168.50.150` → `192.168.50.161`), authority trả:

```
stage: accepted staged OK
apply: accepted awaiting_confirmation OK
```

nhưng kernel **không** chuyển sang địa chỉ mới, kể cả sau 32 giây:

```
=== TẤT CẢ địa chỉ trên end1 ===
inet 192.168.50.150/24 brd 192.168.50.255 scope global noprefixroute end1
inet 192.168.50.161/24 scope global secondary end1        ← thêm vào, KHÔNG thay thế

=== authority báo gì ===
active.ipv4= 192.168.50.150   state= awaiting_confirmation
```

**Ba vấn đề tách biệt:**

1. **Địa chỉ được THÊM chứ không THAY.** Interface mang đồng thời địa chỉ cũ
   (primary) và địa chỉ mới (secondary). Đường `apply`/`reapply` không gỡ địa chỉ cũ.
2. **Health check bỏ lọt.** `active.ipv4` vẫn đọc ra địa chỉ CŨ (primary) nhưng giao
   dịch vẫn được đưa sang `awaiting_confirmation`. Đây đúng là điều
   **ADR-017 §2.9 cấm**: báo thành công khi kernel chưa ở trạng thái mong muốn.
   Nếu người vận hành bấm Confirm, hệ thống chốt một cấu hình chưa hề có hiệu lực.
3. **Rủi ro tích luỹ địa chỉ.** Lặp lại thao tác sẽ chồng thêm địa chỉ secondary.

**Vì sao trước đó không lộ ra:** UC-005 đổi từ DHCP sang static (NM nhả lease nên
địa chỉ cũ biến mất) và từ static sang static **khác subnet** đều hoạt động. Chỉ
nhánh static→static **cùng subnet** mới sai.

**Tại sao chưa sửa trong lần này:** nằm trong `LinuxPlatform::apply`/`persist` —
code giao dịch an toàn có cơ chế rollback fail-closed. Sửa vội mà không dựng đủ test
cho cả bốn nhánh chuyển đổi (dhcp→static, static→dhcp, static→static cùng subnet,
static→static khác subnet) là rủi ro lớn hơn chính lỗi. Cần một lượt làm riêng.

**Đề xuất hướng sửa:**
- Trong `apply`, sau khi persist thì gỡ tường minh các địa chỉ IPv4 không thuộc
  candidate trên interface, rồi mới reapply.
- Siết health check: chỉ chuyển sang `awaiting_confirmation` khi **địa chỉ primary**
  của interface đúng bằng candidate, không chấp nhận việc candidate chỉ xuất hiện
  như secondary.
- Thêm test cho cả bốn nhánh chuyển đổi ở `test_netcfg.cpp`.

**Đã dọn trên board:** xoá địa chỉ secondary, gỡ profile `end1` trùng tên còn sót
(`03e86aee-…`), đưa `end1` về DHCP.

## 9. Việc còn lại

- **F-07** chưa đóng: bộ `src/frontend/e2e/` vẫn chưa gắn vào CI vì suite đã mục
  sẵn (`network-qa.spec.ts` không vào được `/settings/network`;
  `point-names.spec.ts` hỏng hàng loạt). Đã kiểm chứng bằng cách stash toàn bộ thay
  đổi FE của bản này — lỗi giữ nguyên ⇒ có sẵn, không phải hồi quy. Phải sửa suite
  trước rồi mới bật gate.
- Bổ sung bước dọn trạng thái sau mỗi kịch bản trong script E2E board (§6).
- Gate Network tổng thể vẫn **RED** theo ADR-017 §3: còn thiếu reboot/power-loss,
  handoff mDNS/IP trên target, packet capture BACnet, Modbus reconnect và phê duyệt
  an ninh.

## 10. Lịch sử sửa đổi

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-07-31 | Bản đầu tiên. Deploy + E2E 10 use case trên phần cứng thật; ghi nhận 3 lỗi FW SOM chỉ lộ khi chạy thật. |
