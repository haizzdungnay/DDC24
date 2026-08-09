# 05 — Backend (`apps/web-api`)

Commit `8754a8e` · đo 2026-08-09

## 1. Tóm tắt

Go 1.22. 31.089 dòng nguồn, 14.961 dòng test, 505 hàm test trên 11 gói. `go vet`
sạch, toàn bộ test pass.

Đây là thành phần lớn nhất dự án và cũng là thành phần có **rủi ro an ninh cao
nhất**: không có TLS ở bất kỳ đâu trong stack triển khai, và không có header bảo
mật HTTP nào. Phần còn lại — phân quyền, audit, ghi cấu hình nguyên tử, giới hạn
tần suất cho thao tác ghi hiện trường — làm tốt và có chủ đích rõ.

## 2. Phụ thuộc

| Gói | Vai trò |
|---|---|
| `github.com/golang-jwt/jwt/v5` | JWT |
| `golang.org/x/crypto` | bcrypt |
| `github.com/coder/websocket` | WebSocket giám sát |
| `modernc.org/sqlite` | historian (SQLite thuần Go, **không cgo**) |

Bốn phụ thuộc trực tiếp. Chọn `modernc.org/sqlite` thay vì `mattn/go-sqlite3` là
quyết định đúng cho nhúng: không cgo nghĩa là biên dịch chéo sang aarch64 không
cần toolchain C và nhị phân tĩnh hoàn toàn.

## 3. Cấu trúc

```
cmd/mkddc-web/          entrypoint
internal/
├── app/        (~130 tệp) HTTP handler, IPC tới core, historian, scheduler, modbus
├── auth/       JWT, bcrypt, RBAC, audit
├── config/     lưu cấu hình, ghi nguyên tử, đồng bộ thư mục
├── health/     đánh giá sức khoẻ
├── historian/  truy vấn, cache, vòng đời
├── hmi/        kho audit HMI
├── modbusrtu/  miền Modbus RTU, kiểm tra, nhập/xuất, nhật ký
├── network/    client tới mkddc-netcfg
├── points/     danh mục điểm, không gian tên
├── router/     bảng định tuyến kèm ràng buộc vai trò
└── system/     thăm dò tài nguyên hệ thống
```

`internal/app` chiếm phần lớn khối lượng và đang phình — historian một mình đã
6.782 dòng nằm rải trong 25 tệp `historian_*.go` trong cùng gói `app`. Đây là ứng
viên rõ nhất cho việc tách gói.

## 4. Bề mặt API

**101 cặp phương thức + đường dẫn trên 73 đường dẫn**, đăng ký tập trung trong
[internal/app/http.go](../../../apps/web-api/internal/app/http.go). Router bọc
vai trò ngay tại chỗ đăng ký:

```go
webRouter.Protected("PUT /api/v1/modbus/devices/{id}/enabled", RoleAdmin, a.handleModbusDeviceEnabled),
webRouter.Protected("POST /api/v1/modbus/read-test", RoleOperator, a.handleModbusReadTest),
webRouter.Public("GET /api/v1/ws/monitor", a.requireWSAuth(a.handleMonitorWS)),
```

Đọc một dòng là biết endpoint nào cần quyền gì — không phải lần theo middleware.
Đây là lý do ma trận phân quyền của FE suy được trực tiếp từ tệp này.

Nhóm chức năng: xác thực & người dùng, điểm & điểm ảo, Modbus RTU (23 endpoint),
mạng & giao dịch mạng, cấu hình hệ thống (8 nhóm), cảnh báo & lịch sử cảnh báo,
lịch vận hành (14 endpoint), historian/xu hướng, nghiệm thu, WebSocket giám sát.

### Đối chiếu với hợp đồng OpenAPI

| | Trước phiên này | Sau khi sửa |
|---|---|---|
| Có trong mã, thiếu trong spec | 2 (`/modbus/write-test`, `/ws/monitor`) | 0 |
| Có trong spec, không có trong mã | 7 | 7, **đã đánh dấu** `x-implementation-status: not-implemented` |

Bảy đường dẫn khai mà chưa hiện thực: `/graph/validate`, `/graph/deploy`,
`/ota/upload`, `/ota/apply`, `/ota/status`, `/logs/download`, `/bacnet/objects`.
Xem SRC-F-02 trong [07_PHAT_HIEN_VA_KHUYEN_NGHI.md](07_PHAT_HIEN_VA_KHUYEN_NGHI.md).

Trong đó `/modbus/write-test` bị bỏ sót khỏi spec là đáng lo nhất về quy trình:
đó là thao tác **ghi thật xuống thiết bị hiện trường đang chạy**, nên nó vắng mặt
trong mọi đợt rà soát an ninh làm trên hợp đồng.

## 5. An ninh

### 5.1 Làm tốt

- **Mật khẩu**: bcrypt qua `golang.org/x/crypto`.
- **RBAC ba mức** `viewer < operator < admin`, so sánh bằng `roleRank`, và FE
  bám theo đúng thang này.
- **Chống tự khoá**: không hạ cấp hoặc xoá được admin cuối cùng
  ([auth/service.go:215, 240](../../../apps/web-api/internal/auth/service.go#L215))
  — nếu không, một endpoint `RoleAdmin` sẽ trả 403 cho tất cả mọi người, kể cả
  chính người vừa gây ra tình trạng đó.
- **Audit có cấu trúc**: 12 loại sự kiện (đăng nhập, đổi cấu hình, ép điểm,
  override, ack/suppress cảnh báo, thao tác HMI, nghiệm thu, sửa metadata điểm),
  có `sanitizeAuditValue` chặn chèn ký tự điều khiển vào bản ghi.
- **Token WebSocket qua `Sec-WebSocket-Protocol`**, không qua query string (F-10)
  — query string lọt vào log truy cập và lịch sử trình duyệt. Nhánh cũ vẫn nhận
  nhưng ghi cảnh báo, đúng cách nghỉ hưu một giao thức.
- **Kiểm phiên đang chạy**: `wsSessionStillValid` đóng kết nối bằng
  `StatusPolicyViolation` khi phiên bị thu hồi giữa chừng — không để một socket
  đã mở sống dai hơn quyền của nó.
- **Giới hạn tần suất ghi hiện trường**: 2 lệnh ghi thử/phút/người dùng
  (`OD-MBRTU-007`). Bình luận tại chỗ nêu rõ hậu quả nếu thiếu: một tab kẹt hoặc
  script vòng lặp sẽ chiếm băng thông RS-485 và đẩy mọi slave khác trên cùng dây
  vào timeout.
- **`JWT_SECRET` sinh ngẫu nhiên lúc cài**, quyền 0600, chủ `root:root`.

### 5.2 Thiếu — mức nghiêm trọng

| Vấn đề | Bằng chứng |
|---|---|
| **Không có TLS ở bất kỳ đâu** | `grep -rn 'ListenAndServeTLS\|crypto/tls' apps/web-api/` → rỗng. Chỉ `server.ListenAndServe()` tại [main.go:292](../../../apps/web-api/internal/app/main.go#L292) |
| **Không có TLS termination phía trước** | không có nginx/caddy/traefik/stunnel trong `platform/`, `scripts/`, `tools/deploy/` |
| Dịch vụ chạy HTTP thuần | `mkddc-web-pi.service`: `Environment=PORT=8081` |
| Hợp đồng nói ngược lại | `openapi.yaml`: "REST API HTTPS (TLS 1.3) … Cổng 8443" |
| **Không có header bảo mật** | `grep -rn 'Strict-Transport\|X-Frame\|Content-Security\|SameSite'` → rỗng |

Hệ quả cụ thể: **JWT bearer token, mật khẩu đăng nhập, và mọi lệnh ghi điểm đều
đi qua mạng toà nhà ở dạng rõ.** Ai đặt được thiết bị trên cùng đoạn mạng đều đọc
được token và phát lại lệnh ghi. Với hệ điều khiển toà nhà — nơi mạng thường
phẳng và dùng chung với thiết bị của nhà thầu khác — đây là rủi ro thực tế, không
phải rủi ro lý thuyết.

Đáng chú ý: phần còn lại của mã cho thấy đội ngũ **hiểu rõ** an ninh — chống tự
khoá admin, token không lưu storage, token WS không qua query string, giới hạn
tần suất ghi. Khoảng trống TLS vì thế nhiều khả năng là hạng mục hạ tầng chưa làm
chứ không phải thiếu nhận thức. Nhưng nó vẫn vô hiệu hoá phần lớn công sức kia:
token không lưu trong `localStorage` không giúp gì khi nó đi qua dây ở dạng rõ.

## 6. Ghi cấu hình

8 nhóm cấu hình ([configapi.go:38-45](../../../apps/web-api/internal/app/configapi.go#L38-L45)),
mỗi nhóm khai rõ tệp đích và cách áp dụng:

| Nhóm | Tệp | Áp dụng |
|---|---|---|
| device | `device.conf` | SIGHUP iobus |
| network | `network.conf` | hệ thống |
| io | `io_config.conf` | SIGHUP iobus |
| safe-state | `io_safe_state.conf` | SIGHUP core |
| virtual-points | `virtual_points.conf` | không cần |
| bacnet | `bacnet.conf` | restart iobus |
| fieldbus | `fieldbus.conf` | restart iobus |
| time | `time.conf` | hệ thống |

Ghi nguyên tử qua tệp tạm + `rename` + `fsync` thư mục (`internal/config/`), giữ
đúng chủ sở hữu tệp. Mọi lần ghi đều qua audit.

**`graph.json` không nằm trong danh sách này** — logic điều khiển của thiết bị là
thứ duy nhất không được quản trị. Xem [02](02_TINH_NANG_PROGRAMMING_THEO_SRC.md) §2.4.

## 7. Điểm thiết kế đáng ghi nhận

**Không cài lại engine trong Go.** `POST /schedules/{id}/simulate` fork binary
`mkddc-schedule-sim` — chính engine C++ của controller — thay vì cài lại thuật
toán đánh giá lịch trong Go. Bình luận trong `apps/core/CMakeLists.txt` ghi rõ lý
do: bản cài lại sẽ đúng cho tới ngày nó lệch khỏi bản C++, và ngày đó không ai
biết.

Nguyên tắc này đúng và nên áp cho cả validator graph (hiện đang có hai bản: C++
trong `graph_runtime` và TypeScript trong `simulator.ts`).

Chính chỗ này cũng là nơi phát sinh SRC-F-01: binary được gọi nhưng bản cài chính
thức không cài nó. Đã sửa trong phiên này.

## 8. Historian

Hệ thống con lớn nhất: 6.782 dòng trên 25 tệp. SQLite (không cgo), có
policy theo điểm, lưu trữ và cắt tỉa theo thời hạn, migration có kiểm chứng,
gói rollback, cache xu hướng 24 h, runtime shadow, và evidence cho việc kích
hoạt. Có benchmark biên truy vấn (`historian_query_boundary_benchmark_test.go`).

Mức độ đầu tư ở đây tương xứng với vai trò: dữ liệu lịch sử là thứ không tái tạo
được nếu mất.

## 9. Kiểm chứng

```
go vet ./...            → exit 0
go test ./... -count=1  → exit 0, 11/11 gói
```

| Gói | Thời gian |
|---|---:|
| `internal/app` | 29,04 s |
| `internal/modbusrtu` | 0,033 s |
| `internal/hmi` | 0,019 s |
| các gói còn lại | < 0,02 s |

`cmd/mkddc-web` không có test — chấp nhận được vì nó chỉ là entrypoint mỏng.

CI chạy Go với hồ sơ `race`, nên tranh chấp dữ liệu được bắt trong pipeline.

## 10. Khuyến nghị

1. **Thêm TLS.** Ưu tiên cao nhất của toàn dự án về an ninh. Hai hướng: bật
   `ListenAndServeTLS` ngay trong `mkddc-web` với chứng chỉ tự ký sinh lúc cài
   (đơn giản, tự chứa), hoặc đặt nginx phía trước. Kèm theo: cập nhật
   `mkddc-web-pi.service` và cho `openapi.yaml` khớp với thực tế.
2. **Thêm header bảo mật**: HSTS (sau khi có TLS), `X-Content-Type-Options`,
   `X-Frame-Options`/CSP `frame-ancestors`, `Referrer-Policy`.
3. **Đưa `graph.json` thành nhóm cấu hình thứ 9** — dùng lại toàn bộ bộ máy
   RBAC/audit/ghi nguyên tử đã có.
4. **Tách historian khỏi `internal/app`** thành gói riêng; 6.782 dòng trong một
   gói đã quá ngưỡng đọc được.
5. **Thêm kiểm tự động contract ↔ mã** trong CI: sinh danh sách đường dẫn từ
   `http.go`, so với `openapi.yaml`, đỏ nếu lệch mà không có
   `x-implementation-status`. Việc này ngăn SRC-F-02 tái diễn.
