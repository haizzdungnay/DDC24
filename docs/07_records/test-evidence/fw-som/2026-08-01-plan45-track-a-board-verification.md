# Evidence — Deploy plan 45 Track A và kiểm chứng trên Orange Pi 5B

> **Ngày:** 2026-08-01
> **Target:** Orange Pi 5B, `aarch64`, hostname `orangepi5b`, truy cập qua `SOM-DDC-24`
> **Nội dung:** deploy `WEB-UX-001…012` + `QA-E2E-001`, và kiểm chứng trên phần cứng thật
> **Chế độ board:** lab / no-MCU (`mkddc-fakemcu` + PTY) — **không có I/O vật lý**
> **Plan tham chiếu:** [45_WEB_UX_REMEDIATION_AND_CICD_PLAN](../../../03_implementation/45_WEB_UX_REMEDIATION_AND_CICD_PLAN.md)

---

## 1. Kiểm chứng tự động trước khi cắt (host)

| Bộ test | Lệnh | Kết quả |
|---|---|---|
| Frontend unit | `npx vitest --run --environment jsdom src` | **294/294 passed** |
| Frontend lint | `npm run lint` (`--max-warnings=0`) | **0** |
| Frontend build | `npm run build` (`tsc --noEmit && vite build`) | OK |
| Backend Go | `go vet ./...` | sạch |
| Backend Go | `go test ./... -count=1` | pass |
| C++ | `ctest --test-dir build/fw`, đủ 3 option `MKDDC_ENABLE_MODBUS/BACNET/HMI=ON` | **743/743 passed**, 239 s |

`-count=1` và bật đủ ba option CMake theo đúng `CLAUDE.md`: kết quả cache và
option HMI mặc định OFF là hai cách phổ biến nhất để một hồi quy lọt qua cổng.

## 2. Artifact đã cắt

Chỉ `mkddc-web` (Go) và `dist/` (FE) thay đổi. Binary C++ **không đổi** — đã đối
chiếu SHA-256 giữa `build/fw` trên board và `/usr/sbin` trước khi cắt, cả 6 file
`SAME`, nên deploy không âm thầm hạ cấp thành phần nào.

| Thành phần | Cách dựng |
|---|---|
| `mkddc-web` | Cross-compile x86-64 → arm64, `CGO_ENABLED=0 -trimpath -ldflags="-s -w"`, ELF aarch64 statically linked, stripped |
| `dist/` | `npm run build` ở host, 1.6 MB |

```
[07:30:08] netcfg transaction state = confirmed
[07:30:08] Backup → /opt/mkddc-backups/20260801-073008
[07:30:21] Health check
  web bind sau 19s
  /dev/shm/mkddc_io_shm  size=1304 magic=0x4b584404
  /dev/shm/mkddc_plc_shm size=9280 magic=0x4b584404
[07:30:27] HEALTH OK
[07:30:27] DEPLOY THÀNH CÔNG
```

Guard ADR-022 §2.7 chạy đúng: đọc `/data/mkddc/netcfg-transaction.json` thấy
`confirmed` nên cho phép tiếp. Nếu gặp giao dịch chưa kết thúc thì script đã huỷ
deploy thay vì restart authority giữa cửa sổ rollback 120 giây.

SHA-256 sau khi cắt (trích `DEPLOY_MANIFEST.txt`):

```
4dbb93d0c4e83164da1f689436999b658a54e024d052f66bb2f5084ce55c4132  /opt/mkddc-web/mkddc-web
8c6d603c6e2b12102b4509f45cea4d358b056bbc12ef49bb3207c43f97914e5a  /usr/sbin/mkddc-core
a1b3b16695b66524416119683401e2ea9565e9d9f80cf95cd83048cfe62fec23  /usr/sbin/mkddc-iobus
ded60662ba64907c8549f535224029b6ce18c45441628c9c4c5b9922f075e3b4  /usr/sbin/mkddc-netcfg
```

## 3. WEB-UX-001 — định danh thiết bị là THẬT, kiểm trên board

Đây là bằng chứng quan trọng nhất của lần này, vì nó chốt một quyết định thiết
kế cụ thể chứ không chỉ "API có trả field".

`GET /api/v1/system/status` với phiên admin:

```json
{
  "device_ip":    "192.168.1.18",
  "device_mac":   "B8:13:32:73:3E:4E",
  "device_name":  "DDC24-LAB",
  "location":     null,
  "description":  null,
  "system_time":  "2026-08-01T14:37:38+07:00",
  "overall":      "ok",
  "cpu_percent":  10.98,
  "ram_percent":  4.95,
  "uptime_s":     99083
}
```

Đối chiếu với kernel trên chính board:

```
end1:  00:00:a4:ed:6b:ff        (không có địa chỉ IPv4)
wlan0: b8:13:32:73:3e:4e        wlan0 192.168.1.18/24
```

**Bốn điều được chứng minh:**

1. **IP và MAC đến từ CÙNG một interface.** `192.168.1.18` và
   `B8:13:32:73:3E:4E` đều là của `wlan0`. Board này có hai interface và `end1`
   mang MAC hoàn toàn khác (`00:00:a4:ed:6b:ff`) — nếu `primaryInterface()`
   được tách thành hai hàm duyệt độc lập như bản đầu, Dashboard hoàn toàn có thể
   ghép IP của `wlan0` với MAC của `end1` và hiện một cặp định danh **không tồn
   tại**. Đây chính là tình huống hàm đó được viết để chặn.
2. **MAC không còn là `00:0D:18:24:AC:01` gán cứng**, và giờ hệ thống không còn
   là `23/05/2025 14:32:18`. Cả hai nay là giá trị thật của board này.
3. **`device_name` = `DDC24-LAB`** đọc từ `device.conf` thật, không phải giá trị
   dự phòng build-time.
4. **`location` và `description` = `null`** vì `device.conf` trên board chưa có
   hai field đó. Đúng hành vi fail-honest đã thiết kế: `omitempty` ở Go →
   `orDash()` ở FE → hiển thị `—`. Không có gì được bịa ra để lấp chỗ trống.

`cpu_percent` 10.98 và `ram_percent` 4.95 là số đo thật — không còn `?? 23` và
`?? 48` dựng sẵn.

## 4. QA-E2E-001 — script E2E mạng, 8/8 PASS

`tools/qa/network_board_e2e.sh`, chạy trên board, `MUTATE=0` (chỉ nhóm đọc):

```
[07:37:17] đăng nhập admin OK
[07:37:18] ▶ UC-WEB-NET-001
  PASS  active.mode=unknown active.link=up
  PASS  configured đọc được
[07:37:20] ▶ UC-WEB-NET-002
  PASS  /network trả northbound thật
  PASS  không có slave nào báo 0ms/0 poll giả
[07:37:22] ▶ UC-WEB-NET-003   (bỏ qua — chưa có mật khẩu tài khoản viewer)
[07:37:23] ▶ UC-WEB-NET-004
  PASS  candidate #1..#4 bị chặn ở tầng schema (HTTP 400)

== 8 PASS, 0 FAIL ==
[07:37:24] dọn trạng thái trước khi thoát
```

### 4.1. Hai lỗi của chính script, phát hiện nhờ chạy thật

Lần chạy đầu cho **4 PASS / 4 FAIL**. Cả bốn FAIL đều là lỗi của script, không
phải của sản phẩm — và chỉ lộ ra khi gọi API thật:

**(a) Sai hợp đồng body.** Script gửi
`{"version":1,"requestId":"…","candidate":{…}}`. Hợp đồng thật của
`POST /network/transaction/{action}` là `{transactionId?, candidate?}`, và
`decodeNetworkTransactionBody` bật `DisallowUnknownFields`, nên `version` và
`requestId` làm cả request thành `400 invalid json`. Ngoài ra `validate`/`stage`
**cấm** `transactionId`, còn `apply`/`confirm`/`rollback` **bắt buộc** có nó và
cấm `candidate`.

**(b) Giả định sai về nơi candidate bị chặn.** Script chỉ chấp nhận
`result: rejected` trong response 200. Thực tế candidate sai bị chặn ở **một
trong hai tầng**: schema/semantic tại `mkddc-web` trả HTTP 400 kèm danh sách lỗi
field, hoặc luật của authority `mkddc-netcfg` trả 200 với `result: rejected`.
Chỉ chấp nhận một tầng sẽ báo fail giả cho tầng còn lại.

Đã sửa cả hai; `reset_transaction` nay đọc `transactionId` từ status và **không
rollback mù** khi không đọc được.

Đây đúng là loại lỗi mà evidence 2026-07-31 §7 đã ghi: có những thứ chỉ lộ ra
khi chạy trên phần cứng thật với API thật.

### 4.2. Bước dọn trạng thái — điều task này sinh ra để làm

`reset_transaction` chạy trước *và* sau mỗi kịch bản, cộng `trap` trên
`EXIT/INT/TERM`. Quan sát trong log: dòng `dọn trạng thái trước khi thoát` xuất
hiện cả ở lần chạy fail lẫn lần chạy pass, tức đường dọn hoạt động ở cả hai
nhánh. Đây là thứ thiếu hôm 31/07 khiến UC-WEB-NET-006 fail vì giao dịch DHCP
của UC-008 còn treo.

Cố ý **rollback** chứ không confirm: confirm sẽ chốt một thay đổi mà kịch bản
trước có thể đã bỏ dở, tức script tự ý đổi cấu hình mạng theo một ý định không
ai xác nhận.

## 5. Khoảng trống còn lại — ghi rõ để không ai đọc nhầm

- **UC-WEB-NET-003 (RBAC) chưa chạy** vì chưa có mật khẩu tài khoản `view1`.
  Script **bỏ qua và ghi rõ là bỏ qua**, không báo PASS giả.
- **Nhóm mutation (UC-005/006/007/008) chưa chạy** trên bản này. Chạy chúng đòi
  `MUTATE=1` và điều kiện an toàn ở §1 của evidence 31/07: đường quản trị phải
  đi lối khác interface bị đổi địa chỉ. Hiện đường quản trị đi qua `wlan0` còn
  `NETCFG_INTERFACE=end1` nên điều kiện đó thoả — nhưng chưa thực hiện.
- **Chưa kiểm bằng trình duyệt thật trên board.** Plan §8.3 đòi kiểm
  `WEB-UX-004`, `WEB-UX-005` và `WEB-UX-009` trong trình duyệt chứ không chỉ
  jsdom. Phần đã chứng minh trên board là backend + bundle đã cắt đúng
  (`--c-on-accent` và `mkddc:theme:v1` có mặt trong `index-*.js` đã deploy);
  phần tương tác người dùng thì chưa.
- **Audit UI/UX chưa chấm lại** (plan §8.5). Con số 3.5 → 6.0 là ước lượng của
  người audit, không phải cam kết — phải đo lại mới biết.
- **`fw/Core/Src/main.c` vẫn là 16 dòng skeleton.** Mọi thứ ở đây chạy trên
  `mkddc-fakemcu` + PTY. **Không một điểm I/O vật lý nào được đọc hay ghi.**
  Milestone A của Rev A — "lõi điều khiển chạy trên HW thật" — vẫn không đạt.

## 6. Revision History

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-08-01 | Bản đầu. Deploy plan 45 Track A; kiểm chứng định danh thiết bị thật; E2E mạng 8/8; ghi hai lỗi của script phát hiện nhờ chạy thật; liệt kê khoảng trống còn lại. |
