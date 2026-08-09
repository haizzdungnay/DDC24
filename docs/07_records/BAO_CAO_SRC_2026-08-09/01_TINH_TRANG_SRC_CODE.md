# 01 — Tình trạng mã nguồn MK-DDC-24

Commit `8754a8e` · đo 2026-08-09 · nguồn: mã nguồn, không phải tài liệu

## 1. Kết luận ngắn

Mã nguồn ở trạng thái **trưởng thành về kỹ thuật, nhưng lệch về phạm vi**.

Phần đã viết có chất lượng cao và bất thường so với mặt bằng dự án nhúng: biên
kiến trúc được ép ở tầng build chứ không phải bằng quy ước, bất biến an toàn được
kiểm bằng test chứ không phải bằng bình luận, và 100% gate xanh trên cả bốn
ngôn ngữ. Không có một dấu `TODO`/`FIXME`/`HACK` thật nào trong toàn bộ
`apps/` — bảy kết quả khớp đều là mẫu `mkstemp` (`XXXXXX`), không phải nợ kỹ thuật.

Vấn đề nằm ở chỗ khác: **một khối lượng lớn mã đã hoàn thiện không nối được tới
người dùng.** Cụ thể là toàn bộ engine lập trình điều khiển IEC (6.606 dòng,
220 test) không có bất kỳ điểm gọi nào trong tiến trình chạy thật. Chi tiết ở
[02_TINH_NANG_PROGRAMMING_THEO_SRC.md](02_TINH_NANG_PROGRAMMING_THEO_SRC.md).

## 2. Quy mô mã nguồn

Đếm dòng vật lý, tách nguồn và test theo tên tệp:

| Thành phần | Ngôn ngữ | Dòng nguồn | Dòng test | Tỉ lệ test/nguồn |
|---|---|---:|---:|---:|
| `apps/web-api` (BE) | Go | 31.089 | 14.961 | 0,48 |
| `apps/web-ui/src` (FE) | TS/TSX | 27.096 | 7.014 | 0,26 |
| `apps/core` (FW SOM) | C++ | 14.871 | 11.571 | **0,78** |
| `apps/iobus` (FW SOM) | C++ | 10.555 | 5.461 | 0,52 |
| `apps/hmi` | C++ | 4.965 | 916 | 0,18 |
| `apps/netcfg` | C++ | 2.196 | 1.560 | 0,71 |
| `tools` | C/C++/py/sh | 741 | 0 | 0,00 |
| `contracts` | C header/JSON/YAML | 661 | — | — |
| `firmware/stm32` (MCU) | C | 565 | 435 | 0,77 |
| **Tổng** | | **92.739** | **41.918** | 0,45 |

Điểm đáng chú ý: `apps/core` — nơi chứa đường điều khiển thời gian thực — có tỉ
lệ test cao nhất trong các thành phần lớn. Đây là phân bổ đúng: rủi ro tập trung
ở đâu thì test dày ở đó.

Ngược lại, `apps/hmi` (0,18) là thành phần lớn có độ phủ mỏng nhất. Đây là màn
hình vận hành tại chỗ — thứ người trực nhìn khi hệ thống có sự cố và mạng đã hỏng.

## 3. Kết quả kiểm chứng thật

### 3.1 C++ (FW SOM + netcfg + hmi + hostcheck MCU)

Cấu hình bật cả ba tuỳ chọn (`MKDDC_ENABLE_MODBUS/BACNET/HMI=ON`) — bắt buộc, vì
HMI mặc định OFF nên bỏ sót cờ này sẽ không chạy 33 test HMI.

```
configure exit = 0
build     exit = 0
ctest     exit = 0 — 100% tests passed, 0 failed out of 860 (13,44 s)
```

Phân bổ 860 test:

| Thư mục build | Số test |
|---|---:|
| `core` | 487 |
| `iobus` | 275 |
| `netcfg` | 64 |
| `hmi` | 33 |
| `fw_hostcheck` (giao thức MCU chạy trên host) | 1 |

Bộ test lớn nhất theo chủ đề: `ScheduleV*` 67, `StLang` 45, `WebIpc` 40,
`StScheduler` 30, `GraphRuntime` 27, `NetcfgLinuxPlatform` 24, `IoScaling` 23.

### 3.2 Go (BE)

```
go vet ./...            → exit 0, không cảnh báo
go test ./... -count=1  → exit 0
```

11/11 gói pass (`internal/app` 29,0 s là gói nặng nhất; `cmd/mkddc-web` không có
test). 505 hàm `Test*`/`Benchmark*`/`Fuzz*` trên toàn bộ `apps/web-api`.

### 3.3 Frontend

```
npx vitest --run --environment jsdom src → 52 tệp, 465/465 test pass
npm run lint  (eslint src --max-warnings=0) → exit 0
npm run build (tsc --noEmit && vite build)  → exit 0
```

Kích thước bundle sinh ra (`build/web-ui/dist`):

| Asset | Thô | gzip |
|---|---:|---:|
| `index-*.js` | 663,90 kB | 166,68 kB |
| `charts-*.js` | 407,31 kB | 106,17 kB |
| `react-*.js` | 172,77 kB | 57,30 kB |
| `index-*.css` | 48,99 kB | 9,63 kB |
| `icons-*.js` | 20,99 kB | 7,06 kB |

Vite cảnh báo hai chunk vượt 500 kB. Trên thiết bị nhúng phục vụ giao diện qua
LAN toà nhà thì con số này chấp nhận được, nhưng chunk chính chưa tách theo route
— mọi trang đều tải chung một khối 664 kB.

## 4. Cấu trúc và biên kiến trúc

`apps/` chia theo tiến trình, mỗi tiến trình theo kiến trúc phân tầng
domain → application → adapters → bootstrap.

Điểm mạnh nổi bật: **biên tầng được ép ở thời điểm link, không phải bằng kỷ luật.**
Trong [apps/core/CMakeLists.txt](../../../apps/core/CMakeLists.txt) mỗi tầng là
một target riêng (`core_domain`, `core_application`, `core_adapters`,
`core_runtime`), nên một phụ thuộc ngược chiều sẽ làm CMake báo lỗi chứ không chỉ
làm người review khó chịu.

Ví dụ rõ nhất là `st_compiler_lib` được tách khỏi `core_lib` có chủ ý: `mkddc-core`
không link thư viện compiler, nên runtime **không thể** vô tình parse mã nguồn ST
kể cả khi lập trình viên muốn. Bất biến này còn được kiểm lại lần hai ở CI bằng
`nm -C` trên nhị phân đã build
([.github/workflows/build-and-test.yml:100-111](../../../.github/workflows/build-and-test.yml#L100-L111)).
Đây là cách xử lý đúng: biến quy tắc kiến trúc thành thứ máy kiểm được.

Hợp đồng liên tiến trình tập trung ở [contracts/](../../../contracts/):
`shm/mkddc_shm.h`, `iop/iop_protocol.h`, 5 lược đồ JSON, và `openapi/openapi.yaml`.
Cả C++ và Go đều đọc cùng một tệp header/lược đồ thay vì mỗi bên khai lại.

## 5. Chất lượng và tín hiệu rủi ro

### 5.1 Tín hiệu tốt

- **Không có nợ kỹ thuật được đánh dấu.** 0 `TODO`/`FIXME`/`HACK` thật trong `apps/`.
- **Cảnh báo là lỗi.** `-Wall -Wextra -Werror` trên toàn bộ mục tiêu C++;
  `eslint --max-warnings=0` trên FE.
- **Sanitizer trong CI.** ASan (kèm `detect_leaks=1`) và UBSan
  (`-fno-sanitize-recover=all`, nên UB làm test đỏ chứ không chỉ in cảnh báo).
- **Fuzz trong CI.** Hai harness libFuzzer (`fuzz_st_parser`, `fuzz_st_loader`)
  chạy smoke 60 s mỗi PR với corpus seed từ mẫu thật.
- **Bất biến không cấp phát kiểm được.** `allocation_probe` ghi đè `new`/`delete`
  toàn cục để test khẳng định "không cấp phát heap trong scan path" thành số đo
  chứ không phải ý định ([apps/core/tests/allocation_probe.hpp](../../../apps/core/tests/allocation_probe.hpp)).
- **Phân tách trách nhiệm an toàn rõ ràng.** `CoreMetrics` chỉ đo, `OverrunMonitor`
  chỉ đánh giá, `SafeState` mới có quyền ép output. Lý do được ghi ngay trong
  header: nếu ngưỡng an toàn nằm trong lớp quan trắc thì một thành phần không
  thiết yếu nắm quyền thiết yếu.
- **Bình luận giải thích *vì sao*, không lặp lại *cái gì*.** Phần lớn header nêu
  đánh đổi thiết kế và hệ quả nếu làm khác — đây là dạng bình luận giữ được giá
  trị sau khi mã đổi.

### 5.2 Tín hiệu rủi ro

| # | Rủi ro | Bằng chứng |
|---|---|---|
| R1 | Engine lập trình IEC không có điểm gọi trong tiến trình chạy | `apps/core/bootstrap/main.cpp` không include header `st/` nào; grep `StCyclicRuntime\|StControlApi\|st::` trong `bootstrap/`, `runtime/`, `adapters/`, `domain/`, `apps/iobus` trả về rỗng |
| R2 | Không có TLS ở bất kỳ đâu trong stack | `grep -rn 'ListenAndServeTLS\|crypto/tls' apps/web-api/` rỗng; chỉ có `ListenAndServe` tại `main.go:292`; không có nginx/caddy/stunnel trong `platform/` |
| R3 | Không có header bảo mật HTTP | `grep -rn 'Strict-Transport\|X-Frame\|Content-Security\|SameSite' apps/web-api/internal/` rỗng |
| R4 | Gate E2E chỉ phủ một spec | CI chỉ chạy `network-qa.spec.ts`; 7 spec còn lại trong `apps/web-ui/e2e/` không gate nào chạy |
| R5 | HMI có độ phủ test thấp nhất trong các thành phần lớn | 916 dòng test / 4.965 dòng nguồn |
| R6 | `tools/` không có test | 741 dòng, gồm `fake_mcu` được dùng làm chỗ dựa cho test tích hợp |

R2 và R3 được phân tích đầy đủ trong [05_BE_BACKEND.md](05_BE_BACKEND.md) §5;
R1 trong [02_TINH_NANG_PROGRAMMING_THEO_SRC.md](02_TINH_NANG_PROGRAMMING_THEO_SRC.md).

## 6. Trạng thái CI

[.github/workflows/build-and-test.yml](../../../.github/workflows/build-and-test.yml)
có 7 job và **không còn gate rỗng nào**. Ba lỗ hổng từng được ghi nhận trong đợt
rà soát 2026-07-30 (BE/FE/HMI không thật sự chạy test) đều đã bịt, và bình luận
trong workflow ghi lại nguyên nhân gốc từng vụ:

- **F-14** — trước đây không leg nào bật `MKDDC_ENABLE_HMI`, nên `mkddc-hmi` chưa
  bao giờ được CI biên dịch và 28 test HMI chưa bao giờ chạy. Nay có leg `full`
  phủ modbus + bacnet + hmi.
- **F-13** — job frontend trước chỉ chạy `npm run build`, nên vitest và eslint
  không chặn được gì. Nay chạy qua `scripts/verify-project.sh --component frontend`.
- **F-07** — thư mục `e2e/` không job nào chạy vì `npm test` chỉ quét `src/`.

Cách CI đóng gate cũng đáng ghi nhận: ngoài build/test, workflow còn kiểm hai bất
biến kiến trúc bằng cách soi mã và soi ký hiệu — watchdog chỉ được kick đúng một
điểm sau khi scan hoàn tất, và `mkddc-core` không được chứa ký hiệu compiler ST.

Hạn chế còn lại của CI: gate E2E cố ý chỉ chạy spec mạng, vì `point-names.spec.ts`
có 14 test hỏng sẵn (bình luận trong workflow ghi rõ đã kiểm chứng bằng cách stash
toàn bộ thay đổi FE — lỗi giữ nguyên, nên không phải hồi quy mới). Quyết định
không thêm một job biết chắc đỏ là hợp lý; nhưng nó có nghĩa là 7/8 spec E2E hiện
không được bảo vệ bởi bất kỳ gate nào.

## 7. Đóng gói và triển khai

[platform/packaging/install.sh](../../../platform/packaging/install.sh) là bản cài
chính thức; [tools/deploy/deploy_board.sh](../../../tools/deploy/deploy_board.sh)
là đường triển khai lên bo lab. **Hai đường này cài tập nhị phân khác nhau** —
đó chính là nguồn gốc phát hiện SRC-F-01 (xem
[07_PHAT_HIEN_VA_KHUYEN_NGHI.md](07_PHAT_HIEN_VA_KHUYEN_NGHI.md)): một tính năng
hỏng trên bản cài chính thức vẫn chạy tốt trên bo lab, nên không ai phát hiện.

Điểm mạnh của `install.sh`: chụp bản đang chạy vào `/var/backups/mkddc/` trước khi
ghi đè, kiểm `sha256sum` gói release, sinh `JWT_SECRET` ngẫu nhiên với quyền 0600
nếu chưa có, và từ chối cài khi `mkddc-netcfg` còn giao dịch mạng dở dang.

Bản release build với `-DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON
-DMKDDC_ENABLE_HMI=ON`, nên nhị phân xuất xưởng có đủ giao thức — khác với mặc
định của CMake (cả ba đều OFF).

## 8. Tóm tắt bằng số

| Chỉ số | Giá trị |
|---|---|
| Tổng dòng nguồn (không tính test) | 92.739 |
| Tổng dòng test | 41.918 |
| Tổng test tự động chạy được | 860 (C++) + 505 (Go) + 465 (FE) = **1.830** |
| Test đỏ | **0** |
| Cảnh báo lint/compile | **0** (mọi cảnh báo đều là lỗi) |
| Dấu nợ kỹ thuật (`TODO`/`FIXME`/`HACK`) | **0** |
| Job CI | 7, không job nào rỗng |
| Endpoint REST hiện thực | 101 cặp phương thức+đường dẫn / 73 đường dẫn |
| Endpoint khai trong contract mà chưa hiện thực | 7 (đã đánh dấu `x-implementation-status`) |
| Mã engine lập trình không có điểm gọi runtime | 6.606 dòng / 220 test |
