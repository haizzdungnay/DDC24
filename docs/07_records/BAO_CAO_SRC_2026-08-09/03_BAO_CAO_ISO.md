# 03 — Đánh giá theo chuẩn ISO/IEC

Commit `8754a8e` · đo 2026-08-09

## 0. Phạm vi và giới hạn của bản đánh giá này

Đây là **đánh giá kỹ thuật dựa trên bằng chứng mã nguồn**, không phải audit
chứng nhận. Không có tổ chức chứng nhận nào tham gia, và không kết luận nào ở đây
tương đương một tuyên bố tuân thủ.

Bốn khung tham chiếu được dùng:

| Chuẩn | Dùng để |
|---|---|
| ISO/IEC 25010:2023 | Mô hình chất lượng sản phẩm — 9 đặc tính |
| ISO/IEC/IEEE 12207:2017 | Quy trình vòng đời phần mềm — bằng chứng nào quan sát được từ kho mã |
| IEC 61131-3 | Ngôn ngữ lập trình bộ điều khiển khả trình |
| ISO 16484-5 / IEC 62443 | Truyền thông hệ tự động hoá toà nhà; an ninh hệ điều khiển công nghiệp |

Thang đánh giá dùng trong tài liệu:

- **Mạnh** — có bằng chứng mã trực tiếp, có cơ chế kiểm tự động giữ tính chất đó.
- **Đạt** — có bằng chứng mã, nhưng không có cơ chế chống thoái hoá.
- **Yếu** — có mảnh ghép nhưng thiếu phần thiết yếu.
- **Thiếu** — không tìm thấy bằng chứng trong mã.

## 1. ISO/IEC 25010:2023 — Chất lượng sản phẩm

### Bảng tổng hợp

| # | Đặc tính | Đánh giá | Ràng buộc chính |
|---|---|---|---|
| 1 | Functional Suitability (Phù hợp chức năng) | **Yếu** | Tính năng lập trình điều khiển không tới được người dùng |
| 2 | Performance Efficiency (Hiệu năng) | **Mạnh** | — |
| 3 | Compatibility (Tương thích) | **Đạt** | Hợp đồng OpenAPI từng lệch với mã (đã sửa) |
| 4 | Interaction Capability (Tương tác) | **Đạt** | Gate a11y chưa chạy trong CI |
| 5 | Reliability (Tin cậy) | **Mạnh** | — |
| 6 | Security (An ninh) | **Yếu** | Không có TLS ở bất kỳ đâu trong stack |
| 7 | Maintainability (Bảo trì) | **Mạnh** | — |
| 8 | Flexibility (Linh hoạt) | **Đạt** | — |
| 9 | Safety (An toàn) | **Mạnh** | — |

### 1.1 Functional Suitability — **Yếu**

*Tính đầy đủ, đúng đắn, và phù hợp của chức năng.*

Đúng đắn thì mạnh: 1.830 test tự động, 0 test đỏ, engine lịch có một bản cài duy
nhất được dùng chung giữa runtime và mô phỏng.

Đầy đủ thì không. Một bộ điều khiển DDC mà **không lập trình được từ giao diện**
là thiếu chức năng cốt lõi, không phải thiếu tiện ích. Đường duy nhất hiện có để
đưa logic điều khiển vào thiết bị là SSH, sửa tay `/data/config/graph.json`, rồi
SIGHUP.

Bằng chứng: `/graph/validate` và `/graph/deploy` được khai trong hợp đồng nhưng
không có handler; trang Lập trình của FE bị khoá sau cờ chỉ bật ở chế độ demo;
`graph.json` không nằm trong 8 nhóm cấu hình BE quản lý. Chi tiết ở
[02](02_TINH_NANG_PROGRAMMING_THEO_SRC.md).

### 1.2 Performance Efficiency — **Mạnh**

*Hành vi thời gian, sử dụng tài nguyên, sức chứa.*

| Bằng chứng | Vị trí |
|---|---|
| `SCHED_FIFO` + `mlockall(MCL_CURRENT\|MCL_FUTURE)` | `apps/iobus/adapters/platform/realtime.cpp` |
| Bất biến không cấp phát heap trong scan path, **đo bằng bộ đếm** | `apps/core/tests/allocation_probe.hpp` |
| Giám sát overrun có ngưỡng và chuỗi phục hồi | `apps/core/domain/safety/overrun_monitor.hpp` |
| Scheduler không preempt ⇒ không priority inversion, không biến động do khoá | `apps/core/application/st/st_scheduler.hpp` |
| Ngôn ngữ ST không có vòng lặp ⇒ thời gian thực thi chặn trên được | `apps/core/application/st/st_parser.cpp` |
| Verify chữ ký in-process, không cấp phát, không I/O | libsodium `crypto_sign_verify_detached` |
| Benchmark biên truy vấn historian | `historian_query_boundary_benchmark_test.go` |

Điểm đáng ghi nhận: đây không phải "tối ưu hoá" mà là **thiết kế để hành vi thời
gian có chặn trên**. Ràng buộc thời gian được đưa vào cấu trúc (bỏ vòng lặp, bỏ
preempt, bỏ khoá) chứ không xử lý bằng cách đo rồi vá.

Điểm trừ nhỏ ngoài đường điều khiển: chunk FE 664 kB chưa tách theo route.

### 1.3 Compatibility — **Đạt**

*Cùng tồn tại và khả năng liên tác.*

Mạnh: hợp đồng tập trung trong `contracts/` — một tệp header SHM cho cả C++ và
Go, một định nghĩa giao thức IOP, 5 lược đồ JSON. Magic SHM mã hoá phiên bản nên
lệch phiên bản bị bắt lúc attach. Hỗ trợ BACnet/IP và Modbus RTU/TCP.

Trừ: hợp đồng OpenAPI từng khai 7 endpoint không tồn tại và bỏ sót 2 endpoint có
thật — nghĩa là "nguồn-chuẩn cho endpoint" không phải nguồn chuẩn. Đã sửa trong
phiên này (SRC-F-02), nhưng **chưa có gate CI** nào ngăn nó lệch lại.

### 1.4 Interaction Capability — **Đạt**

*Nhận biết, học được, vận hành được, chống lỗi người dùng, khả năng tiếp cận.*

Mạnh: song ngữ Việt/Anh; hệ token màu tập trung có test tương phản tự động;
`UnavailableFeaturePage` giải thích lý do thay vì đá người dùng về trang chủ
(WEB-UX-007); phân quyền route ngăn người dùng đi vào trang mà mọi nút đều 403;
59/128 tệp `.tsx` có `aria-*`/`role=`.

Trừ: spec E2E a11y đã viết nhưng **không nằm trong gate CI**, nên tính chất tiếp
cận không được bảo vệ khỏi thoái hoá. Trước khi sửa trong phiên này, hai trang
còn hiển thị dữ liệu bịa như dữ liệu thật ở chế độ live — dạng lỗi tương tác
nặng nhất vì nó không báo lỗi mà dựng lên một hiện thực sai.

### 1.5 Reliability — **Mạnh**

*Trưởng thành, khả dụng, chịu lỗi, phục hồi.*

| Bằng chứng | Vị trí |
|---|---|
| Ma trận safe-state 5 điều kiện kích hoạt (T1/T2/T3/T6/T7/T8) | `safe_state.hpp` |
| Watchdog kick đúng một điểm sau khi scan xong, **kiểm bằng CI** | `main.cpp` + workflow |
| Chất lượng dữ liệu theo từng điểm (3 mức + 5 mức mở rộng có mã lý do) | `mkddc_shm.h` |
| Phát hiện SHM cũ (> 3 chu kỳ scan) | `safe_state.hpp` T3 |
| Giao dịch mạng stage/apply/confirm có tự rollback | `apps/netcfg` |
| Trạng thái bền qua mất điện cho bộ đếm giờ chạy / xung | `graph_runtime.hpp` |
| Rollback cài đặt có chụp bản đang chạy | `install.sh` + `rollback.sh` |
| Last-known-good giữ **byte artifact** để rollback đi lại đường verify | `st_scheduler.hpp` |
| Suy giảm có kiểm soát khi không xin được RT/mlockall | `realtime.cpp` |
| ASan + UBSan + fuzz trong CI | `.github/workflows/build-and-test.yml` |

Ba chi tiết cho thấy độ chín: (a) rollback không được phép là cửa sau bỏ qua
verify; (b) suy giảm luôn được **nói ra** chứ không im lặng; (c) `install.sh` từ
chối chạy khi `mkddc-netcfg` còn giao dịch dở — tức là biết rằng thao tác nâng
cấp có thể cắt đứt chính đường vào để sửa.

### 1.6 Security — **Yếu**

*Bảo mật, toàn vẹn, chống chối bỏ, trách nhiệm giải trình, xác thực.*

Làm tốt và có chiều sâu:

| Khía cạnh | Bằng chứng |
|---|---|
| Xác thực | JWT + bcrypt |
| Phân quyền | RBAC 3 mức, ràng buộc tại chỗ đăng ký route |
| Trách nhiệm giải trình | 12 loại sự kiện audit, có lọc ký tự điều khiển |
| Toàn vẹn artifact | SHA-256 + Ed25519 (libsodium) cho IR ST |
| Toàn vẹn gói cài | `sha256sum --check` + `provenance.json` |
| Chống tự khoá | không xoá/hạ cấp được admin cuối |
| Vệ sinh token | không lưu `localStorage`; WS dùng `Sec-WebSocket-Protocol` |
| Thu hồi phiên | đóng WS bằng `StatusPolicyViolation` khi phiên bị thu hồi |
| Giới hạn tần suất | 2 lệnh ghi thử/phút/người dùng |
| Quản lý bí mật | `JWT_SECRET` ngẫu nhiên lúc cài, 0600 root:root, có script xoay |
| Quét CI | trivy, grype, gitleaks, CodeQL (`security.yml`) |

**Nhưng thiếu lớp nền:**

- Không có TLS ở bất kỳ đâu — `grep -rn 'ListenAndServeTLS\|crypto/tls'` rỗng.
- Không có TLS termination phía trước — không nginx/caddy/stunnel trong `platform/`.
- Dịch vụ chạy `PORT=8081` HTTP thuần.
- Không có header bảo mật nào (HSTS, CSP, `X-Frame-Options`, `X-Content-Type-Options`).

Hệ quả: token, mật khẩu và lệnh ghi điểm đi qua mạng toà nhà ở dạng rõ. Điều này
**vô hiệu hoá phần lớn công sức ở bảng trên**: giữ token ngoài `localStorage`
không còn ý nghĩa khi token đi qua dây ai cũng đọc được.

Đối chiếu IEC 62443-4-2 (yêu cầu kỹ thuật cho cấu phần hệ điều khiển): các họ
FR 1 (Kiểm soát nhận dạng & xác thực), FR 2 (Kiểm soát sử dụng) và FR 6 (Phản hồi
kịp thời với sự kiện) có nền tảng tốt. FR 3 (Toàn vẹn hệ thống) và FR 4 (Bảo mật
dữ liệu) **không đạt ở phần dữ liệu trên đường truyền**, vì không có mã hoá kênh.

Đánh giá "Yếu" ở đây phản ánh đúng cách an ninh vận hành: một khoảng trống ở lớp
nền quyết định trần của cả hệ, bất kể các lớp trên làm tốt đến đâu.

### 1.7 Maintainability — **Mạnh**

*Mô-đun hoá, tái sử dụng, phân tích được, sửa đổi được, kiểm thử được.*

| Bằng chứng | Chi tiết |
|---|---|
| Biên mô-đun ép lúc **link** | 5 target theo tầng trong `apps/core/CMakeLists.txt` |
| Bất biến kiến trúc kiểm bằng CI | `nm -C` chặn compiler ST lọt vào runtime |
| Kiểm thử được | tỉ lệ test/nguồn 0,45 toàn dự án; 0,78 ở `apps/core` |
| Không nợ kỹ thuật đánh dấu | 0 `TODO`/`FIXME`/`HACK` thật trong `apps/` |
| Cảnh báo là lỗi | `-Werror` (C++), `--max-warnings=0` (FE) |
| Không cài lại logic | BE gọi engine C++ thay vì viết lại trong Go |
| Tài liệu tại chỗ | header giải thích **vì sao**, kèm hệ quả nếu làm khác |

Đặc điểm nổi bật nhất: bình luận trong mã ghi **quyết định và lý do**, không lặp
lại mã. Ví dụ từ `st_limits.hpp` giải thích vì sao trần token cố ý đặt cao hơn
trần cấu trúc — để input lồng sâu nhận đúng chẩn đoán hữu ích thay vì chẩn đoán
vô nghĩa. Loại tri thức này thường mất khi người viết rời dự án; ở đây nó nằm
trong kho mã.

Điểm trừ: `internal/app` của BE phình to (historian 6.782 dòng trong cùng gói).

### 1.8 Flexibility — **Đạt**

*Thích ứng, khả chuyển, mở rộng, cài đặt được.*

Mạnh: toolchain biên dịch chéo aarch64; cờ tính năng
(`MKDDC_ENABLE_MODBUS/BACNET/HMI`) cho phép cắt SKU; `RepositoryPaths.cmake` tập
trung đường dẫn vật lý nên migration không buộc CI/tool biết bố cục nội bộ;
`capacity_unix.go`/`capacity_windows.go`, `os_default_unix/windows` tách theo nền
tảng; cài đặt idempotent.

Trừ: mã có nhánh Windows nhưng chỉ có mục tiêu triển khai Linux, nên phần đó
không được kiểm chứng trên đường chạy thật.

### 1.9 Safety — **Mạnh**

*Ràng buộc vận hành, giám sát nguy cơ, an toàn khi hỏng, cảnh báo an toàn.*

Đây là đặc tính mới trong bản 2023, và cũng là chỗ dự án làm tốt nhất so với mặt
bằng chung.

| Yêu cầu của chuẩn | Bằng chứng |
|---|---|
| Ràng buộc vận hành | Giới hạn ngân sách task, ngưỡng overrun, kẹp giới hạn AO |
| Giám sát nguy cơ | `OverrunMonitor`, `PointQuality`, phát hiện SHM cũ, `iop_status` |
| An toàn khi hỏng | Hành động safe-state **cố định** (AO→0 V/4 mA, DO→hở), không cấu hình được |
| Cảnh báo an toàn | `AlarmRuntime` với ack/suppress/return có audit |
| Tích hợp an toàn | Node `Interlock` có chốt; `SAFE_STATE` là node hạng nhất trong graph |

Hai quyết định thiết kế đáng ghi nhận:

1. **Hành động safe-state không cấu hình được.** Nó cố định trong mã, tách hẳn
   khỏi `io_safe_state.conf` (tệp đó chỉ đặt mặc định mức ưu tiên 6). Nghĩa là
   một tệp cấu hình sai không thể làm hành vi an toàn sai.
2. **Quyền ép output tập trung tại một chỗ.** `CoreMetrics` đo, `OverrunMonitor`
   đánh giá, chỉ `SafeState` quyết định. Chuỗi này làm chính sách an toàn test
   được độc lập với bộ đếm, và ngăn một thành phần quan trắc nắm quyền thiết yếu.

## 2. ISO/IEC/IEEE 12207:2017 — Quy trình vòng đời

Chỉ đánh giá bằng chứng **quan sát được từ kho mã**. Quy trình có thể tồn tại
ngoài kho mà không để lại dấu vết ở đây; trường hợp đó ghi là "không quan sát được".

| Quy trình | Bằng chứng trong kho | Đánh giá |
|---|---|---|
| Định nghĩa yêu cầu bên liên quan | `docs/01_requirements/`, `Yeucau.md` | Có |
| Phân tích yêu cầu hệ thống | `docs/02_design/`, tham chiếu SPEC trong header mã | Có |
| Thiết kế kiến trúc | Tầng ép bằng target CMake, ADR có đánh số (ADR-010/013/014/022) | **Mạnh** |
| Thiết kế chi tiết | Header giải thích quyết định và đánh đổi | **Mạnh** |
| Hiện thực | 92.739 dòng, `-Werror`, không nợ kỹ thuật đánh dấu | **Mạnh** |
| Tích hợp | CI 7 job phủ 4 ngôn ngữ + 5 tổ hợp cờ C++ | **Mạnh** |
| Kiểm chứng (verification) | 1.830 test, ASan/UBSan/fuzz, kiểm bất biến bằng bảng ký hiệu | **Mạnh** |
| Hợp thức hoá (validation) | E2E chỉ 1/8 spec trong gate; không có bằng chứng nghiệm thu người dùng | **Yếu** |
| Chuyển giao | `install.sh` + `build-release.sh` + provenance + checksum | Có |
| Vận hành | systemd unit, script soak, đo lường | Có |
| Bảo trì | `CHANGELOG.md`, lịch sử commit chi tiết | Có |
| Quản lý cấu hình | Git, `DOCUMENT_MANIFEST.sha256`, provenance trong nhị phân | **Mạnh** |
| Quản lý chất lượng | Cổng CI, không có cổng nào rỗng | **Mạnh** |
| Quản lý rủi ro | Không quan sát được đăng ký rủi ro trong kho | Không quan sát được |
| Đo lường | Số đo test/build; không có chỉ số quy trình theo thời gian | Yếu |

Khoảng cách rõ nhất giữa **verification** (mạnh) và **validation** (yếu): dự án
kiểm rất kỹ rằng "phần mềm được xây đúng như thiết kế", nhưng ít bằng chứng rằng
"phần mềm làm đúng việc người dùng cần". Phát hiện trung tâm của bộ báo cáo này —
tính năng lập trình không tới được người dùng dù mọi test đều xanh — chính là hệ
quả trực tiếp của khoảng cách đó.

## 3. IEC 61131-3 — Ngôn ngữ lập trình bộ điều khiển

| Yêu cầu | Trạng thái | Ghi chú |
|---|---|---|
| ST (Structured Text) | Tập con | Thiếu `CASE`, `FOR`, `WHILE`, `REPEAT`, FUNCTION/FB người dùng |
| FBD (Function Block Diagram) | Không theo chuẩn | `graph.json` là định dạng riêng, 28 node |
| LD (Ladder Diagram) | Thiếu | |
| IL (Instruction List) | Thiếu | (đã lỗi thời trong bản 3) |
| SFC (Sequential Function Chart) | Thiếu | |
| Kiểu dữ liệu chuẩn | 4 kiểu | `BOOL`, `INT`, `REAL`, `TIME`; thiếu `STRING`, kiểu bit, mảng, struct |
| FB chuẩn | 4 khối | `TON`, `TOF`, `R_TRIG`, `F_TRIG`; thiếu `CTU`/`CTD`/`CTUD`, `SR`/`RS`, `TP` |
| Hàm chuẩn | 10 hàm | `ABS`, `MIN`, `MAX`, `LIMIT`, `SEL`, `SQRT` + 4 hàm chuyển kiểu |
| Biến RETAIN | **Có** | Kèm băm bố cục và kiểm kích thước bản ghi |
| Mô hình task | **Có** | Ưu tiên cố định, không preempt, ngân sách, giám sát overrun |
| Môi trường lập trình cho người dùng | **Thiếu** | Không có công cụ viết/nạp/gỡ lỗi chương trình |

**Không đủ để tuyên bố tuân thủ IEC 61131-3.** Rào cản không nằm ở phần ngôn ngữ
còn thiếu — tập con hiện có có kỷ luật và phù hợp mục đích — mà ở chỗ chuẩn định
nghĩa một **môi trường lập trình**, và dự án chưa có phần đó.

Cần lưu ý: tập con ST hiện tại **bỏ vòng lặp có chủ ý** để thời gian thực thi có
chặn trên. Nếu sau này bổ sung `FOR`/`WHILE` để tiến gần chuẩn hơn, sẽ **mất**
tính chất này. Đây là đánh đổi thật giữa mức phù hợp chuẩn và khả năng chặn trên
thời gian, cần quyết định có ý thức chứ không nên trôi theo quán tính "cho đủ
chuẩn".

## 4. ISO 16484-5 (BACnet) và IEC 62443

### ISO 16484-5 — Truyền thông hệ tự động hoá toà nhà

Có ngăn xếp BACnet/IP (bacnet-stack) với: bảng object, mảng mức ưu tiên, COV,
báo động, độ tin cậy (reliability), và object Schedule. 1.432 dòng, **73 test**
gồm cả bảng object phía core (18) và ngăn xếp phía iobus (55).

Đây là nền tảng thực chất. Nhưng tuyên bố tuân thủ BACnet đòi hỏi PICS, hồ sơ
thiết bị, và kiểm thử BTL — thuộc quy trình chứng nhận, không suy ra được từ mã.

Một khoảng trống quan sát được: bảng object BACnet **không phơi ra qua REST**.
`/bacnet/objects` được khai trong hợp đồng nhưng không có handler, nên công cụ
nghiệm thu không đọc được bảng object qua API.

### IEC 62443 — An ninh hệ điều khiển công nghiệp

| Họ yêu cầu (FR) | Đánh giá |
|---|---|
| FR 1 — Kiểm soát nhận dạng & xác thực | Đạt (JWT, bcrypt, chống tự khoá admin) |
| FR 2 — Kiểm soát sử dụng | Đạt (RBAC 3 mức, giới hạn tần suất ghi, audit) |
| FR 3 — Toàn vẹn hệ thống | Một phần (artifact/gói cài có ký & checksum; **kênh truyền không có toàn vẹn**) |
| FR 4 — Bảo mật dữ liệu | **Không đạt** (không mã hoá kênh) |
| FR 5 — Luồng dữ liệu hạn chế | Không quan sát được (không có phân đoạn/tường lửa trong mã) |
| FR 6 — Phản hồi kịp thời với sự kiện | Đạt (audit có cấu trúc, cảnh báo, số đo) |
| FR 7 — Sẵn sàng tài nguyên | Đạt (safe-state, watchdog, giám sát overrun, rollback) |

Nút thắt là FR 3/FR 4, và cả hai mở khoá bằng cùng một việc: thêm TLS.

## 5. Ba việc có tác động lớn nhất

Xếp theo mức cải thiện trên mỗi đơn vị công sức, dựa trên bằng chứng ở trên:

1. **Thêm TLS** — nâng Security từ Yếu, và mở khoá FR 3/FR 4 của IEC 62443. Là
   khoảng trống lớn nhất và cũng là việc rõ ràng nhất về mặt kỹ thuật.
2. **Nối tính năng lập trình tới người dùng** — nâng Functional Suitability từ
   Yếu. Bước rẻ nhất là đưa `graph.json` thành nhóm cấu hình thứ 9 ở BE, dùng lại
   nguyên bộ máy RBAC/audit/ghi nguyên tử đã có.
3. **Thêm gate hợp thức hoá** — đưa 7 spec E2E còn lại vào CI và thêm kiểm tự
   động contract ↔ mã. Đây là việc thu hẹp khoảng cách verification/validation đã
   để lọt phát hiện trung tâm của bộ báo cáo này.
