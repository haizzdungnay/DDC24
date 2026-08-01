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

## 4bis. Nhóm mutation + RBAC trên board — 21 PASS / 3 FAIL

Chạy `MUTATE=1 PROVISION_ACCOUNTS=1`, đổi địa chỉ IPv4 **thật** trên `end1`.
Điều kiện an toàn §1 của evidence 31/07 được script tự kiểm trước mỗi lần chạy.

### 4bis.1. UC-WEB-NET-005 — bản vá F-14 chạy đúng trên phần cứng thật

```
PASS  interface đã THÊM địa chỉ mới 192.168.1.113
PASS  vẫn GIỮ địa chỉ cũ 192.168.1.102 trong cửa sổ chờ xác nhận
PASS  confirm chốt giao dịch
PASS  địa chỉ 192.168.1.113 còn nguyên sau confirm (F-14)
PASS  địa chỉ cũ 192.168.1.102 đã được gỡ sau confirm
PASS  authority báo active.ipv4=192.168.1.113
```

Đây là lần đầu F-14 được chứng minh **đầu-cuối trên board**: sự cố 31/07 là
"đổi 192.168.50.150 → .161 rồi Confirm, interface mất SẠCH địa chỉ IPv4". Nay
`apply` giữ cả hai địa chỉ trong cửa sổ 120 s (đường quản trị không đứt), và
`confirm` gỡ đúng địa chỉ cũ, giữ đúng địa chỉ mới.

### 4bis.2. Ba FAIL — cả ba là finding thật

**N-01 — `mkddc-web` báo 503 cho một thao tác ĐÃ THÀNH CÔNG.**

```
FAIL  UC-WEB-NET-006 rollback — {"code":503,"error":"network configuration service unavailable"}
PASS  UC-WEB-NET-006 rollback trả kernel về địa chỉ cũ 192.168.1.113
```

Hai dòng này mâu thuẫn nhau, và đó chính là finding. Log authority cùng thời điểm:

```
action=rollback result=accepted reason_code=EXPLICIT_ROLLBACK state=rolled_back
```

Nguyên nhân gốc: `web/backend/netcfg_client.go:232` đặt deadline **4 giây** cho
cả một request tới authority. Đo trên board: `stage` mất 2,9 s, `apply` 0,5 s,
còn `rollback` phát ngay sau `apply` vượt 4 s. `mkddc-web` bỏ cuộc và trả
`errNetcfgUnavailable` → HTTP 503, trong khi `mkddc-netcfg` vẫn chạy tiếp và
hoàn tất rollback bình thường.

Hậu quả trên trang Mạng: người vận hành bấm "Hoàn tác ngay" và nhận thông báo
"dịch vụ cấu hình mạng không khả dụng", dù việc hoàn tác đang diễn ra và sẽ
thành công. Họ sẽ bấm lại, hoặc kết luận authority chết.

Đây là mặt trái của đúng loại lỗi mà plan 45 vừa dọn khỏi UI: thay vì **báo
thành công cho việc thất bại**, chỗ này **báo thất bại cho việc thành công**. Cả
hai đều là nói dối người vận hành. Tái hiện được 2/3 lần chạy mutation.

**N-02 — board có 2 profile NetworkManager trùng tên `end1`.**

```
end1  eced7d31-…  ACTIVE=yes  /etc/NetworkManager/system-connections/end1.nmconnection
end1  4ece069b-…  ACTIVE=no   /etc/NetworkManager/system-connections/end1-4ece069b-….nmconnection
```

Đúng điều kiện gây lỗi §7.1 của evidence 31/07. `mkddc-netcfg` đã được vá để tra
theo UUID nên nó vẫn chạy đúng — `configured` đọc được, mọi kịch bản khác PASS.
Nhưng điều kiện rủi ro đang hiện diện trên board.

`netcfg` **không** tạo profile NetworkManager (grep toàn bộ source: hai chỗ dùng
`"add"` đều là `ip address add`), nên profile thứ hai đến từ thao tác tay bên
ngoài. Đây là **vệ sinh cấu hình board**, không phải lỗi sản phẩm — nhưng phải
dọn, và quy trình bringup nên có bước kiểm.

Bài học kèm theo: chính hàm kiểm này ở bản đầu cũng tra theo TÊN và đọc ra
`"no\n\nno"`. Cùng cái bẫy mà sản phẩm đã vá, công cụ kiểm thử mắc lại.

**N-03 — địa chỉ đã `confirmed` không sống sót qua reboot.**

Profile đang active có `connection.autoconnect: no`. Chuỗi lập luận:

1. `apply()` đặt địa chỉ bằng `ip address add` — chỉ tồn tại trong runtime, mất
   sau reboot.
2. `persist()` ghi cấu hình vào profile bằng `nmcli connection modify` nhưng
   **không bao giờ đặt `connection.autoconnect yes`** (không có chuỗi
   `autoconnect` nào trong toàn bộ `services/netcfg/`).
3. Với `autoconnect: no`, NetworkManager không kích hoạt profile lúc khởi động.
4. `mkddc-netcfg` lúc khởi động chỉ mở socket (`netcfg.listen`), không đối chiếu
   lại kernel với giao dịch đã `confirmed`.

Hậu quả: mất điện bật lại → DDC lên mà cổng trường không có IP, trong khi
authority vẫn báo `state=confirmed`. Một chuyến xe ra hiện trường.

Trạng thái quan sát được lúc bắt đầu phiên đúng như dự đoán của chuỗi trên:
journal ghi `confirmed` với `192.168.1.102`, profile lưu đúng địa chỉ đó, mà
`end1` **không có địa chỉ IPv4 nào**.

**Chưa kiểm bằng reboot thật.** Lập luận dựa trên đọc source + đọc cấu hình
NetworkManager, không phải quan sát một lần khởi động lại. Muốn chốt thì phải
reboot board — chưa làm vì đó là thao tác có rủi ro mất truy cập từ xa.

### 4bis.3. Ba lỗi của chính script, phát hiện nhờ chạy thật

Ngoài hai lỗi hợp đồng ở §4.1, ba lỗi nữa lộ ra ở nhóm mutation:

| Lỗi | Vì sao sai |
|---|---|
| Khẳng định `active.ipv4 == want` NGAY sau `apply` | Sai hợp đồng: `apply` cố ý GIỮ địa chỉ cũ và THÊM địa chỉ mới; `active.ipv4` chỉ trả một giá trị nên vẫn là địa chỉ cũ. Đo được: apply trả về sau 0,5 s và interface mang đồng thời `.113` + `.151`. |
| `>/dev/null` cho phản hồi của lệnh mutation | Khi confirm/rollback hỏng, script chỉ thấy state đứng yên và chẩn đoán sai thành "mất địa chỉ". Chính `>/dev/null` che mất HTTP 503 của N-01 suốt hai lần chạy đầu. |
| Tra `connection.autoconnect` theo TÊN profile | Xem N-02. |

Đã sửa cả ba. Kết quả sau khi sửa: **21 PASS / 3 FAIL**, ba FAIL còn lại đều là
finding thật chứ không phải nhiễu của công cụ.

### 4bis.4. Trạng thái board sau khi chạy

Đã trả `end1` về `192.168.1.102/24` — đúng ý định ghi trong journal trước khi
bắt đầu — qua chính API `stage/apply/confirm`, để journal không lệch với kernel.
Default route trả lại cho `wlan0`. Tài khoản tạm `e2e-viewer` đã bị xoá.

Ghi chú vận hành: trong lúc chạy, `end1` nhận địa chỉ cùng subnet với đường quản
trị **kèm gateway**, nên nó giành default route (metric 100 < wlan0 600) và làm
guard an toàn của script chặn lần chạy kế tiếp. Cổng trường không nên mang
default route; hoặc phải nằm khác subnet với đường quản trị.

## 5. Khoảng trống còn lại — ghi rõ để không ai đọc nhầm

- **UC-WEB-NET-007 (chỉ đổi DNS) và UC-WEB-NET-008 (DHCP) chưa chạy.** UC-008 là
  kịch bản đã gây ra sự cố trạng thái sót hôm 31/07; trên LAN này một lease DHCP
  sẽ đổi địa chỉ `end1` theo cách không đoán trước, nên tạm để ngoài. Cơ chế dọn
  trạng thái nay đã được chứng minh nên có thể thêm hai kịch bản này sau.
- **N-03 chưa được chốt bằng một lần reboot thật** — xem §4bis.2.
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
