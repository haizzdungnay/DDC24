# 07 — Sổ phát hiện và khuyến nghị

Commit `8754a8e` · đo 2026-08-09

Mã phát hiện dạng `SRC-F-nn`. Mức: **P0** = ảnh hưởng an toàn/an ninh hoặc chức
năng cốt lõi; **P1** = ảnh hưởng người dùng hoặc tính đúng đắn; **P2** = rủi ro
bảo trì.

## Bảng tổng hợp

| Mã | Mức | Tóm tắt | Trạng thái |
|---|---|---|---|
| [SRC-F-01](#src-f-01) | P1 | `install.sh` không cài `mkddc-schedule-sim`; endpoint mô phỏng lịch hỏng trên mọi bản cài chính thức | **Đã sửa** |
| [SRC-F-02](#src-f-02) | P1 | Hợp đồng OpenAPI khai 7 endpoint không tồn tại, bỏ sót 2 endpoint có thật | **Đã sửa** |
| [SRC-F-03](#src-f-03) | P1 | `AuxFunctionsPage` chấm PASS/FAIL trên graph demo ở chế độ live | **Đã sửa** |
| [SRC-F-04](#src-f-04) | P1 | `InputsPage` hiển thị điểm demo như dữ liệu thật ở chế độ live | **Đã sửa** |
| [SRC-F-05](#src-f-05) | **P0** | Không có TLS ở bất kỳ đâu trong stack triển khai | Mở — cần quyết định |
| [SRC-F-06](#src-f-06) | **P0** | Tính năng lập trình điều khiển không tới được người dùng | Mở — cần quyết định |
| [SRC-F-07](#src-f-07) | P1 | `graph.json` nằm ngoài mọi cơ chế quản trị cấu hình | Mở — cần quyết định |
| [SRC-F-08](#src-f-08) | P1 | 6.606 dòng engine ST không có điểm gọi lúc chạy | Mở — cần quyết định |
| [SRC-F-09](#src-f-09) | P1 | Gate E2E chỉ phủ 1/8 spec | Mở |
| [SRC-F-10](#src-f-10) | P2 | Validator graph có hai bản cài độc lập (C++ và TypeScript) | Mở |
| [SRC-F-11](#src-f-11) | P2 | `apps/hmi` có độ phủ test thấp nhất trong các thành phần lớn | Mở |
| [SRC-F-12](#src-f-12) | P2 | `DDC_MODE` mặc định là `demo` | Mở |
| [SRC-F-13](#src-f-13) | P2 | `openapi.yaml` có ~409 ký tự mojibake do lỗi mã hoá | Mở |

Bốn phát hiện đã sửa trong phiên này; chín phát hiện còn lại cần quyết định về
phạm vi hoặc khối lượng công việc vượt quá một lần sửa tại chỗ.

---

## Phát hiện đã xử lý

### SRC-F-01
**`install.sh` không cài `mkddc-schedule-sim`** · P1 · **Đã sửa**

**Triệu chứng.** `POST /api/v1/schedules/{id}/simulate` trả lỗi "không tìm thấy
mkddc-schedule-sim" trên mọi thiết bị cài bằng `platform/packaging/install.sh`.

**Nguyên nhân gốc.** `apps/core/CMakeLists.txt` luôn build `mkddc-schedule-sim`,
và BE cố ý gọi binary này thay vì cài lại thuật toán lịch trong Go
([schedulesimulate.go:29-47](../../../apps/web-api/internal/app/schedulesimulate.go#L29-L47)).
Nhưng `install.sh` chỉ cài `mkddc-iobus`, `mkddc-core`, `mkddc-netcfg`,
`mkddc-web` và `dist/`. Binary mô phỏng không nằm trong danh sách.

Lỗi này ẩn được lâu vì `tools/deploy/deploy_board.sh` — đường triển khai lên bo
lab — **có** copy nó (vào `/usr/sbin`). Nên tính năng chạy tốt ở nơi người ta
kiểm và hỏng ở nơi người ta giao hàng. Đây là dạng lỗi mà không bộ test nào bắt
được, vì không test nào chạy trên sản phẩm của `install.sh`.

**Cách sửa.**
- Thêm kiểm tra tiền điều kiện cho `$BUILD/core/mkddc-schedule-sim`.
- Cài vào `/opt/mkddc-web/mkddc-schedule-sim`, **không** vào `/usr/sbin`.
  `scheduleSimBinary()` dò theo thứ tự env → `PATH` → thư mục chứa chính nó; dịch
  vụ chạy `User=mkddc` với `PATH` mặc định của systemd (không có `/usr/sbin`),
  nên chỉ nhánh "cạnh binary" là chắc chắn tìm thấy.
- Thêm vào danh sách chụp snapshot của `install.sh` và vào `rollback.sh`. Bỏ sót
  ở rollback thì bản cũ sẽ chạy lại với engine mô phỏng của bản mới — hai phiên
  bản lệch nhau đúng ở chỗ không ai nghĩ tới khi truy sự cố.
- Đưa binary vào `checksums.sha256` của gói release và
  `runtime-checksums.sha256` sau cả install lẫn rollback; không để một executable
  được chạy nhưng nằm ngoài chuỗi kiểm tra toàn vẹn/provenance.

**Tệp.** `platform/packaging/build-release.sh`, `platform/packaging/install.sh`,
`platform/packaging/rollback.sh`
**Kiểm chứng.** `bash -n` sạch cả ba tệp; binary có mặt tại đường dẫn mà
`install.sh` mong đợi trong thư mục build.

---

### SRC-F-02
**Hợp đồng OpenAPI lệch với mã** · P1 · **Đã sửa**

**Triệu chứng.** `contracts/openapi/openapi.yaml` tự nhận là "nguồn-chuẩn cho
endpoint (D-4)" nhưng khai 7 đường dẫn không có handler, và bỏ sót 2 đường dẫn
có thật.

| Chiều | Đường dẫn |
|---|---|
| Khai mà chưa hiện thực | `/graph/validate`, `/graph/deploy`, `/ota/upload`, `/ota/apply`, `/ota/status`, `/logs/download`, `/bacnet/objects` |
| Hiện thực mà chưa khai | `/modbus/write-test`, `/ws/monitor` |

**Vì sao quan trọng.** Client sinh từ spec sẽ gọi vào đường không tồn tại, và mọi
phép đếm độ phủ API đều sai. Chiều ngược lại nguy hiểm hơn: `/modbus/write-test`
là thao tác **ghi thật xuống thiết bị hiện trường đang chạy** (chỉ admin, giới hạn
2 lệnh/phút), nên nó vắng mặt trong mọi đợt rà soát an ninh làm trên hợp đồng.
`/ws/monitor` cho phép force và override điểm — cùng vấn đề.

**Cách sửa.** Giữ nguyên phần khai của 7 đường dẫn chưa hiện thực (đó là phạm vi
roadmap đã chốt — FE nói rõ canvas lập trình thuộc Rev B) nhưng đánh dấu tường
minh bằng `x-implementation-status: not-implemented` và thêm hậu tố "CHƯA HIỆN
THỰC" vào `summary`, để cả người lẫn tool phân biệt được "đã có" với "sẽ có". Bổ
sung đầy đủ hai đường dẫn còn thiếu, kèm vai trò, giới hạn tần suất và mã lỗi.
Tiện thể sửa mojibake ở các dòng chạm tới.

**Tệp.** `contracts/openapi/openapi.yaml`
**Kiểm chứng.** YAML parse được (`yaml.safe_load`), 80 đường dẫn. Đối chiếu lại
mã: 0 đường dẫn hiện thực còn thiếu trong spec; 7 đường dẫn còn lại đều đã đánh
dấu. `TestOpenAPISeparatesRuntimeRoutesFromRoadmap` khoá hai route runtime và
bảy route roadmap trong gate Go để lớp lệch này không quay lại im lặng.

---

### SRC-F-03
**`AuxFunctionsPage` chấm PASS/FAIL trên graph demo ở chế độ live** · P1 · **Đã sửa**

**Triệu chứng.** Trang `/eng/aux` (sinh cụm khối logic) ghép cụm vừa sinh vào
`getDemoGraph()` — một graph **bịa** — rồi chạy validator TypeScript cục bộ và
hiện huy hiệu PASS/FAIL. Nhánh này chạy cả ở bản live: trang không có gate
`IS_DEMO` và không có gate vai trò.

**Vì sao quan trọng.** Người vận hành đọc dấu PASS xanh như lời bảo đảm rằng cụm
logic vừa cấu hình là an toàn. Thực tế phán quyết đó nói về một graph mà thiết bị
không chạy. Ở bản live, graph thật nằm ở `/data/config/graph.json` trên thiết bị
và trình duyệt không có cách nào đọc được — vì `/graph/validate` không tồn tại
(SRC-F-02).

Đây đúng lớp lỗi FE-DIAG-01 đã sửa cho `ControllerDiagram` ngày 2026-08-06.

**Cách sửa.** Chỉ chấm PASS/FAIL khi `IS_DEMO`. Ở live vẫn sinh bản xem trước JSON
(có ích — kỹ sư nạp tay được) nhưng không trả phán quyết, và nói rõ lý do: cần
endpoint validate phía thiết bị. Không có phán quyết vẫn tốt hơn phán quyết sai chỗ.

**Tệp.** `apps/web-ui/src/features/dashboard/AuxFunctionsPage.tsx`

---

### SRC-F-04
**`InputsPage` hiển thị điểm demo như dữ liệu thật ở chế độ live** · P1 · **Đã sửa**

**Triệu chứng.** `InputsPage.tsx:377` rơi về `getDemoPoints()` khi không tìm thấy
điểm thật cho một kênh, không phân biệt chế độ. Trang khi đó hiện giá trị, đơn
vị, thống kê và biểu đồ xu hướng của điểm demo.

**Vì sao quan trọng.** Điểm thật vắng mặt đúng vào những lúc quan trọng nhất:
core chết, kênh chưa cấu hình, API lỗi. Đó chính là lúc trang chuyển sang bịa ra
một hiện thực bình thường. Kiểu hỏng tệ nhất cho màn hình vận hành không phải là
báo lỗi — mà là hiển thị số liệu trông hợp lý và sai.

**Cách sửa.** `const demoPoint = !livePoint && IS_DEMO ? findAiPoint(...) : undefined`.
Ở live, không có điểm thì `point` để `undefined` và các ô hiện trạng thái trống —
người trực thấy ngay là chưa có dữ liệu.

**Tệp.** `apps/web-ui/src/features/points/InputsPage.tsx`

Rà bằng Chrome DevTools còn phát hiện trang Inputs rộng 478 px trên viewport
mobile 390 px. Grid đã được ép `minmax(0,1fr)`/`min-w-0`, nhóm nút mode được
wrap; regression Playwright khoá đồng thời ranh giới live và cuộn ngang.

**Kiểm chứng cho SRC-F-03 và SRC-F-04.** Sau khi sửa: Vitest **469/469 pass**
(53 tệp), `eslint --max-warnings=0` sạch, `tsc --noEmit && vite build` thành
công; Playwright live mobile 390×844 1/1. Chrome DevTools xác nhận live không có
badge PASS/FAIL giả, Inputs hiện bốn giá trị `--`, thông báo thiếu dữ liệu và
`scrollWidth = clientWidth = 390`.

---

## Phát hiện cần quyết định

### SRC-F-05
**Không có TLS ở bất kỳ đâu trong stack triển khai** · **P0** · Mở

**Bằng chứng.**

```bash
grep -rn 'ListenAndServeTLS\|crypto/tls' apps/web-api/   # rỗng
grep -rni 'nginx\|caddy\|traefik\|stunnel' platform/ scripts/ tools/deploy/  # rỗng
```

Chỉ có `server.ListenAndServe()` tại
[main.go:292](../../../apps/web-api/internal/app/main.go#L292). Dịch vụ chạy
`Environment=PORT=8081`. Không có header bảo mật nào (`grep` cho
`Strict-Transport|X-Frame|Content-Security|SameSite` trả rỗng).

Hợp đồng nói ngược lại: `openapi.yaml` ghi "REST API HTTPS (TLS 1.3) … Cổng 8443".

**Hệ quả.** JWT bearer token, mật khẩu đăng nhập và mọi lệnh ghi điểm đi qua mạng
toà nhà ở dạng rõ. Ai đặt được thiết bị trên cùng đoạn mạng đều đọc được token và
phát lại lệnh ghi. Mạng toà nhà thường phẳng và dùng chung với thiết bị của nhà
thầu khác, nên đây là rủi ro thực tế.

Khoảng trống này **vô hiệu hoá phần lớn công sức an ninh khác** trong mã: giữ
token ngoài `localStorage`, gửi token WS qua `Sec-WebSocket-Protocol` thay vì
query string, thu hồi phiên đang mở — tất cả đều mất ý nghĩa khi token đi qua dây
ai cũng đọc được.

**Vì sao không sửa trong phiên này.** Đây là quyết định hạ tầng, không phải sửa
mã: cần chọn giữa TLS trong tiến trình và reverse proxy, chọn cách sinh và xoay
chứng chỉ, quyết định xử lý cảnh báo chứng chỉ tự ký trên trình duyệt, và đổi
cổng dịch vụ — mỗi lựa chọn kéo theo thay đổi ở systemd unit, script cài, tài
liệu vận hành, và có khả năng làm mất kết nối thiết bị đang chạy nếu làm sai.

**Đề xuất.** TLS trong tiến trình với chứng chỉ tự ký sinh lúc cài là hướng đơn
giản và tự chứa nhất cho thiết bị nhúng: không thêm thành phần, không thêm dịch
vụ phải giám sát. Kèm theo: HSTS, `X-Content-Type-Options`, CSP `frame-ancestors`,
`Referrer-Policy`; cập nhật `mkddc-web-pi.service`; và cho `openapi.yaml` khớp thực tế.

---

### SRC-F-06
**Tính năng lập trình điều khiển không tới được người dùng** · **P0** · Mở

Phát hiện trung tâm của bộ báo cáo. Phân tích đầy đủ ở
[02_TINH_NANG_PROGRAMMING_THEO_SRC.md](02_TINH_NANG_PROGRAMMING_THEO_SRC.md).

Tóm tắt chuỗi bằng chứng: `mkddc-core` chạy `graph_runtime` nạp từ
`/data/config/graph.json` → BE không có endpoint nào chạm `graph` → FE khoá trang
Lập trình sau cờ chỉ bật ở chế độ demo, và ngay cả khi bật cũng chỉ validate cục
bộ → hợp đồng khai `/graph/validate` và `/graph/deploy` nhưng không có handler.

Kết quả: đường duy nhất để đưa logic điều khiển vào thiết bị là SSH, sửa tay JSON,
SIGHUP. Không phân quyền, không audit, không validate, không rollback.

**Vì sao không sửa trong phiên này.** Cần hiện thực mới ở cả ba tầng (CLI validate
C++, endpoint BE, nối FE), tức là phạm vi phát triển tính năng chứ không phải sửa
lỗi. Cần chốt phạm vi trước.

**Lộ trình đề xuất** (theo thứ tự phụ thuộc): đưa `graph.json` thành nhóm cấu
hình BE thứ 9 → thêm CLI `mkddc-graph-validate` bọc `GraphRuntime::validate` →
hiện thực `POST /graph/validate` gọi CLI đó → hiện thực `POST /graph/deploy` →
nối FE, gỡ `validateGraphLocal` và cờ `LEGACY_GRAPH_DEMO_ENABLED`.

---

### SRC-F-07
**`graph.json` nằm ngoài mọi cơ chế quản trị cấu hình** · P1 · Mở

BE quản lý 8 nhóm cấu hình với RBAC, audit, ghi nguyên tử, và điều phối reload
([configapi.go:38-45](../../../apps/web-api/internal/app/configapi.go#L38-L45)).
`graph.json` — tệp định nghĩa logic điều khiển của toàn thiết bị — không nằm
trong danh sách, dù `mkddc-core` nạp lại được nó qua `config_reload` ở ranh giới
scan mà không cần restart.

Nghĩa là mọi cơ chế quản trị thay đổi đã xây cẩn thận cho 8 nhóm kia đều không áp
cho thứ quan trọng nhất.

**Đây là bước rẻ nhất trong lộ trình SRC-F-06** và có giá trị độc lập: kể cả khi
chưa có UI lập trình, việc nạp graph qua API có kiểm soát vẫn hơn hẳn sửa tay
qua SSH.

---

### SRC-F-08
**6.606 dòng engine ST không có điểm gọi lúc chạy** · P1 · Mở

Engine ST/IEC hoàn chỉnh — lexer, parser, kiểm kiểu, IR nhị phân đã ký Ed25519,
máy ảo, scheduler, retain, trace, 220 test, 2 harness fuzz — được biên dịch vào
`core_application` và link vào `mkddc-core`, nhưng **không tiến trình nào gọi**.
Hợp đồng điều khiển `st_control_api` (7 mã lỗi, 34 test) không được `web_ipc`
định tuyến. Hai CLI `mkddc-st-validate`/`mkddc-st-compile` không ai gọi và
`install.sh` không cài.

Trạng thái hiện tại tốn chi phí của cả phương án giữ (bảo trì, thời gian CI, kích
thước nhị phân) lẫn phương án bỏ (không thu được gì), mà không cho lợi ích của
phương án nào. Cần chốt một trong ba: **nối vào**, **đóng băng có ghi nhận**, hoặc
**gỡ bỏ**.

---

### SRC-F-09
**Gate E2E chỉ phủ 1/8 spec** · P1 · Mở

CI chỉ chạy `network-qa.spec.ts`. Bảy spec ngoài gate: `fe-pages-health`,
`pa3-a11y`, `pa3-dashboard`, `point-names`, `scheduler`, `trends`, và bộ
`e2e-board/`.

Quyết định thu hẹp gate là có lý do và được ghi rõ trong workflow:
`point-names.spec.ts` có 14 test hỏng sẵn, đã kiểm chứng bằng cách stash toàn bộ
thay đổi FE — lỗi giữ nguyên, nên không phải hồi quy mới. Thêm một job biết chắc
đỏ thì vô ích.

Nhưng hệ quả là 7/8 spec hiện không được bảo vệ, và chúng sẽ mục dần đúng như
`network-qa` từng mục (F-07). Việc cần làm: sửa 14 test của `point-names` rồi mở
gate cho cả thư mục `e2e/`.

---

### SRC-F-10
**Validator graph có hai bản cài độc lập** · P2 · Mở

Quy tắc hợp lệ của graph được cài hai lần: C++ trong `graph_runtime` (thứ thiết
bị thật dùng) và TypeScript trong `shared/demo/simulator.ts` (thứ FE dùng). Không
có test nào ràng buộc hai bản phải khớp.

Dự án đã tránh đúng cái bẫy này ở chỗ khác — BE gọi `mkddc-schedule-sim` để mô
phỏng lịch bằng đúng engine C++ thay vì cài lại trong Go, và bình luận trong
CMake ghi rõ lý do: *"bản cài lại sẽ đúng cho tới ngày nó lệch khỏi bản C++, và
ngày đó không ai biết."* Cùng nguyên tắc chưa được áp cho validator graph.

Sẽ tự tiêu nếu SRC-F-06 được làm theo lộ trình đề xuất (FE gọi endpoint thật thay
vì validate cục bộ).

---

### SRC-F-11
**`apps/hmi` có độ phủ test thấp nhất** · P2 · Mở

916 dòng test / 4.965 dòng nguồn = 0,18 — thấp nhất trong các thành phần lớn (so
với 0,78 ở `apps/core`, 0,71 ở `netcfg`).

Đây là màn hình TFT tại chỗ: thứ người trực nhìn khi hệ có sự cố **và mạng đã
hỏng**, tức là đúng lúc nó phải đáng tin nhất và cũng là lúc không còn đường dự
phòng nào khác.

Yếu tố làm nặng thêm: CI mới bắt đầu biên dịch HMI từ khi thêm leg `full` (F-14).
Trước đó `mkddc-hmi` chưa bao giờ được CI build và 28 test HMI chưa bao giờ chạy,
nên phần mã này có ít lịch sử được bảo vệ hơn phần còn lại.

---

### SRC-F-12
**`DDC_MODE` mặc định là `demo`** · P2 · Mở

```ts
export const DDC_MODE: DdcMode = import.meta.env.VITE_DDC_MODE === 'live' ? 'live' : 'demo'
```

Bản dựng phải **chủ động** đặt `VITE_DDC_MODE=live`. Quên biến môi trường thì ra
bản demo trong im lặng — và bản demo hiển thị dữ liệu bịa.

Với thiết bị điều khiển, mặc định an toàn là ngược lại: thiếu biến thì build phải
hỏng ồn ào. Ba lần rò rỉ demo → live (FE-DIAG-01, SRC-F-03, SRC-F-04) đều nặng
thêm vì mặc định này.

---

### SRC-F-13
**`openapi.yaml` có ~409 ký tự mojibake** · P2 · Mở

Nhiều phần của tệp chứa UTF-8 bị mã hoá hai lần (`Tráº¡ng thÃ¡i` thay vì
`Trạng thái`), khoảng 409 ký tự hỏng trên 3.600 dòng. Dấu hiệu của một lần chỉnh
sửa từng đọc tệp bằng Latin-1 rồi ghi lại bằng UTF-8.

Chỉ ảnh hưởng phần mô tả, không ảnh hưởng cấu trúc — YAML vẫn parse được và các
đường dẫn/lược đồ vẫn đúng. Đã sửa ở những dòng chạm tới khi xử lý SRC-F-02;
phần còn lại cần một lượt giải mã lại toàn tệp, nên tách ra làm riêng để thay đổi
đó không lẫn vào thay đổi ngữ nghĩa của hợp đồng.

---

## Khuyến nghị theo thứ tự ưu tiên

| # | Việc | Giải quyết | Ghi chú |
|---|---|---|---|
| K1 | Thêm TLS + header bảo mật | SRC-F-05 | Khoảng trống lớn nhất; mở khoá IEC 62443 FR 3/FR 4 |
| K2 | `graph.json` thành nhóm cấu hình BE thứ 9 | SRC-F-07, một phần SRC-F-06 | Rẻ nhất, dùng lại bộ máy đã có, có giá trị độc lập |
| K3 | CLI `mkddc-graph-validate` + endpoint `/graph/validate` + `/graph/deploy` | SRC-F-06, SRC-F-10 | Theo khuôn mẫu `mkddc-schedule-sim` |
| K4 | Chốt số phận engine ST | SRC-F-08 | Ba lựa chọn ở §SRC-F-08; điều tệ nhất là để nguyên |
| K5 | Gate CI kiểm contract ↔ mã | SRC-F-02 | Sinh danh sách đường dẫn từ `http.go`, so với `openapi.yaml` |
| K6 | Sửa `point-names.spec.ts`, mở gate cả `e2e/` | SRC-F-09 | |
| K7 | Luật ESLint chặn import `shared/demo/` ngoài danh sách cho phép | SRC-F-03, SRC-F-04 | Biến gate thủ công thành gate máy kiểm |
| K8 | Đảo mặc định `DDC_MODE` | SRC-F-12 | Thiếu biến ⇒ build hỏng |
| K9 | Nâng độ phủ test HMI | SRC-F-11 | |
| K10 | Tách historian khỏi `internal/app` | — | 6.782 dòng trong một gói |
| K11 | Giải mã lại `openapi.yaml` | SRC-F-13 | Làm riêng, không lẫn thay đổi ngữ nghĩa |

K1 và K2 độc lập với nhau và có thể làm song song. K3 phụ thuộc K2. K4 nên chốt
trước khi bắt đầu K3, vì lựa chọn "nối engine ST vào" sẽ đổi hình dạng của K3.
