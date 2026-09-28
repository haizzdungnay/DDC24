# Báo cáo trình PM — hiện trạng, finding và phương án cải thiện hiệu năng Forlinx

| Thuộc tính | Giá trị |
|---|---|
| ID | `REC-FORLINX-PERF-PM-20260928` |
| Phiên bản | 1.0 |
| Trạng thái | **In Review — chờ PM quyết định phạm vi, nguồn lực và thứ tự triển khai** |
| Ngày lập | 2026-09-28 |
| Người lập / chủ quản | Engineering; PM tiếp nhận quyết định, các owner trong báo cáo là vai trò đề xuất |
| Mục đích | Cung cấp hiện trạng đã đo, finding có bằng chứng, lựa chọn giải pháp và phiếu quyết định để PM giao việc |
| Mốc quan sát | 28/09/2026 02:53–03:01:35 UTC, tương ứng 09:53–10:01:35 giờ Việt Nam; hồi cứu phần journal còn giữ khoảng 21h54 |
| Nguồn | [Audit kỹ thuật §13](PROGRAMMING_RUNTIME_PERFORMANCE_COMPETITIVE_REVIEW_2026-09-04.md#13-audit-hệ-thống-và-phần-mềm-trên-forlinx--2026-09-28), [JSON số đo](../test-evidence/fw-som/forlinx-performance-20260928/audit-summary.json) |
| Thẩm quyền | Hồ sơ trình review/quyết định; không phải Detailed Design, phê duyệt triển khai hoặc bằng chứng release |

## 1. Đề nghị PM xem xét

**Bo còn dư CPU/RAM trong tải đã đo. Điểm cần cải thiện trước là tính ổn định
của nhịp giao tiếp và việc đọc dữ liệu, sau đó là độ trễ API, log và tải trang.**
Không có bằng chứng hiện tại để ưu tiên nâng phần cứng, JIT hoặc chạy Program
song song.

Engineering đề xuất PM chọn hướng triển khai theo ba nhóm:

1. **Sửa độ tin cậy P1:** lỗi snapshot Point, chính sách xử lý tick trễ của IOBus
   và điều tra jitter Core. Riêng thay đổi nhịp IOBus cần chốt thiết kế/tính an
   toàn trước khi triển khai lên bo.
2. **Cải thiện có nguyên nhân rõ và phạm vi nhỏ:** đưa lấy mẫu CPU ra khỏi request
   API, nén sẵn tài nguyên FE và chuẩn hoá hồ sơ phiên bản triển khai.
3. **Giảm tải theo số đo:** xác định caller gây polling, giảm log đọc thành công,
   tách biểu đồ khỏi tải đăng nhập; quyết định kernel/IRQ chỉ sau khi có timeline
   và kết quả A/B.

**Quyết định cần PM ghi ở §7.** Mọi dòng hiện là **CHỜ QUYẾT ĐỊNH**; chưa gán
nhân sự thực, lịch hoàn thành, ngân sách hoặc dấu phê duyệt. Phương án chưa được
triển khai từ đợt audit này. Các ngưỡng nghiệm thu đề xuất cần PM/Engineering/QA
chốt trước khi đưa vào Issue; chúng không thay hợp đồng sản phẩm hiện hành.

## 2. Hiện trạng theo mốc quan sát

### 2.1 Những gì đang hoạt động

| Hạng mục | Kết quả thực đo | Ý nghĩa với PM |
|---|---|---|
| Dịch vụ | Core, IOBus, Web active; `NRestarts=0` tại đầu/cuối đo | Chưa thấy crash trong cửa sổ đo; counter này không chứng minh toàn lịch sử không restart |
| CPU | Core 2,253%; IOBus 5,531%; Web 24,773% **của một CPU core** | Chưa thấy thiếu CPU; Web lớn nhất trong ba process, cần profile trước khi quy nguyên nhân cho một thành phần |
| RAM | Core 24.904 KiB, IOBus 56.100 KiB ổn định; Web 74.472–76.628 KiB; RAM khả dụng khoảng 1,40–1,42 GiB | Chưa thấy áp lực RAM trong hơn 5 phút; chưa kết luận không rò rỉ bộ nhớ dài hạn |
| Nhiệt / lưu trữ | 46,04–50,44°C; tần số 1,296 GHz không giảm trong mẫu; eMMC busy khoảng 0,682% | Chưa thấy nhiệt hoặc eMMC bão hoà trong tải đã đo |
| Programming | Task 10 ms RUNNING/HEALTHY; missed release, missed base step và execution overrun giữ 0 | Logic Program chưa lỡ bước; không đồng nghĩa mọi ngưỡng jitter đều đạt |
| Modbus RS-485 | 4/4 thiết bị online; lỗi timeout/CRC/retry/write-failed/write-dropped đều 0 và không tăng | Đường bus Modbus hoạt động trong cửa sổ; tách biệt với IOP/Fake MCU ở §3 |
| Ghi gộp FC15 | Có giao dịch thật; 7 frame đầu có p95 31,103 ms, tất cả ACK thành công | FC15 đã có trên bo; không lập lại như một tính năng chưa triển khai. Không suy thành thời gian tiếp điểm relay |
| API đo mới | 200 GET thành công: 100 local và 100 WAN, ở 5 route health/status/runtime/monitor/buses, **không gồm `/points`** | Kết quả cửa sổ ngắn; không trực tiếp kiểm availability `/points` hoặc xoá 206 lỗi lịch sử |
| Phiên bản | Core khớp manifest `f86150e3`; IOBus/Web/helper và ba file FE kiểm tra khớp artifact FC15 khác manifest | Chưa đủ hồ sơ để xác nhận toàn bộ bo chạy source mới nhất; cần chuẩn hoá provenance |

### 2.2 Những giới hạn PM cần biết khi dùng số liệu

- Baseline OS **61 mẫu / 323,62 giây**; có tải vận hành, probe GET và thu log.
  Trong phút thu log nặng, Core thêm 5 vi phạm jitter; chưa chứng minh việc thu
  log là nguyên nhân duy nhất. Không gọi đây là tải idle.
- Query log 24 giờ nhưng dữ liệu còn khoảng **21h54**. Đây là hồi cứu log,
  không phải phép thử soak 24 giờ có kiểm soát.
- API: **20 mẫu/route/lane**, p95 nearest-rank là mẫu thứ 19. Năm route đo là
  `/api/v1/health`, `/api/v1/system/status`, `/api/v1/programming/runtime`,
  `/api/v1/programming/runtime/monitor`, `/api/v1/modbus/buses`, không gồm
  `/api/v1/points`. Local gồm chi phí `wget`/shell,
  WAN gồm client/connect/read. Không dùng chênh lệch hai lượt làm RTT chính xác.
- FC15 chỉ có 7 frame trong ring đầu: p95 nearest-rank bằng **max của 7 frame**,
  không phải kết quả tail dài hạn của giao dịch ghi.
- Jitter max/phút, jitter từng wake, execution overrun và missed tick là các số
  khác nhau. IOBus late-wake không được gọi thành Program execution overrun.
- Target dùng **Fake MCU** cho IOP; Modbus có thiết bị thật, nhưng chưa đo điện
  relay. Kết quả này chưa chứng minh HIL MCU/relay hoặc `RELEASE_READY`.
- Browser kiểm login cold/warm, Console/Network và screenshot; chưa kiểm luồng
  UI sau đăng nhập, INP hoặc nhiều client đồng thời.
- Báo cáo được lập từ đợt audit nêu trên và đối chiếu JSON trong phiên lập tài
  liệu; không có lượt đo live mới để cập nhật trạng thái sau mốc quan sát.

## 3. Finding, mức ưu tiên và tác động

**P1:** cần xử lý trước khi mở rộng claim độ tin cậy/chu kỳ hoặc triển khai thay
đổi có ảnh hưởng điều khiển. **P2:** cải thiện hiệu năng/truy xuất có lợi ích rõ,
không thay thế việc xử lý P1. **P3:** bổ sung khả năng đo để quyết định chính xác.
Mức này là ưu tiên Engineering đề xuất cho PM, không phải mức sự cố an toàn vật lý.

| Finding | Mức | Bằng chứng | Tác động / điểm chưa xác định |
|---|---|---|---|
| `PERF-SYS-05` — IOBus trễ nhịp, chạy bù | P1 | Poll 2 ms; late-wake max 16,345 ms trong lịch sử PID hiện tại. Gần baseline tăng 510 wake-overrun / 150.004 wakes. IOP thêm 2 timeout và 127 seq error giữa hai snapshot | Giao tiếp có đuôi trễ và có thể chạy dồn khi deadline quá khứ. Cơ chế tăng deadline từng period được xác định trong code; chưa chứng minh là nguyên nhân duy nhất của timeout/seq error |
| `PERF-SYS-01` — Core vượt ngưỡng jitter | P1 | 9 lần >100 µs trước baseline; thêm 5 trong phút audit, tổng 14. Max trước/lúc audit 124,14/141,19 µs. Missed step/scan overrun vẫn 0 | Không đạt ngưỡng C4 ≤100 µs trong lịch sử mới. WCET max lúc audit 476 µs / base 10 ms, còn dư; chưa ghim IRQ/driver gây trễ |
| `PERF-API-01` — đọc Point lỗi snapshot SHM | P1 | Web PID129416: 162.186 HTTP200 + 206 HTTP503 ở `/points`, tỷ lệ thất bại 0,1269%; 206 WARN snapshot không nhất quán; lỗi cuối 02:50:40Z trước audit | Người dùng có thể mất dữ liệu đọc ngắn hạn dù health xanh. Retry 5 vòng tight loop là cơ chế khả dĩ; chưa profile writer/copy để chốt nguyên nhân duy nhất |
| `PERF-API-02` — API trạng thái chờ lấy mẫu CPU | P2 | Code chờ 100 ms mỗi request. Log server p95 `/system/status` 105 ms, `/overview` 137 ms; probe local status p95 116,145 ms | Có độ trễ tối thiểu do thiết kế handler; tối ưu không cần tăng CPU hoặc thay chu kỳ Program |
| `PERF-SYS-02/03`, `PERF-API-03` — log và polling dày | P2 | Khoảng 95.558 dòng Wi-Fi, 103.824 audit READ alarm_list, 462.893 dòng Web trong phần lịch sử còn giữ; giờ ổn định khoảng 5,2 request/s | Tăng dữ liệu log/công việc đọc, làm khó điều tra. Chưa xác định polling đến từ browser, nhiều tab hay script; chưa định lượng phần CPU có thể tiết kiệm |
| `PERF-FE-01` — tài nguyên chưa nén | P2 | 5 JS/CSS không có Content-Encoding dù client chấp nhận gzip; body 1.253.429 B, nén gzip6 trên host còn 336.327 B | Tiềm năng giảm 73,2% byte body cho 5 tài nguyên; chưa có kết quả tốc độ sau triển khai |
| `PERF-FE-02` — login tải sẵn biểu đồ | P2 | Cold login transfer toàn trang 1.337.637 B, trong đó charts 407.319 B; một mẫu DOMContentLoaded 953,6 ms | Dữ liệu tải trước khi cần biểu đồ; cần đo dashboard/first chart trước khi đổi dependency để tránh chuyển độ trễ sang bước tiếp theo |
| `PERF-PROV-01` — manifest chưa theo artifact | P2 | Core khớp manifest, IOBus/Web/helper và FE là artifact khác; liên kết source qua artifact/lịch sử, thiếu manifest mới/vcs embedded | Khó tái tạo và xác định chính xác bản chạy, ảnh hưởng đánh giá hồi quy/rollback. Không phải bằng chứng malware hoặc nguyên nhân độ trễ |
| `PERF-SYS-04`, `PERF-API-04` — thiếu nhãn/khả năng quan sát | P3 | Thiếu PSI/per-PID I/O; CPU3 procstat không khớp threadstat; latency bus rolling 128 mẫu trộn read/write, counter thiếu nhãn epoch/cửa sổ | Dễ hiểu sai tải CPU hoặc SLA. Cần bổ sung phép đo phù hợp trước khi quyết định thay kernel/hạ tầng |

Mọi finding trong bảng **đang mở** theo đợt audit. Health 6/6 xanh, Programming
không missed step và Modbus không lỗi không thay thế kết quả từng finding.

## 4. Lựa chọn giải pháp và khuyến nghị

Độ phức tạp **nhỏ / vừa / lớn** là so sánh phạm vi và rủi ro kỹ thuật, chưa là
ước lượng ngày công hoặc ngân sách. Engineering cần tách Issue và xác minh
baseline trước khi PM chốt lịch. Phần source mapping chi tiết nằm ở audit §13.5.

### 4.1 IOBus và IOP — cần chốt chính sách tick trễ

| Phương án | Lợi ích | Đánh đổi / điều kiện | Độ phức tạp |
|---|---|---|---|
| A — đo bổ sung và thiết kế bỏ tick quá hạn, thay chạy bù | Làm rõ wake/work/response gap; tránh burst sau block nếu thiết kế được chứng minh phù hợp | Phải giữ watchdog, safe-state, thứ tự output và cơ chế retry/seq; bỏ tick có thể làm giảm số transaction, cần chứng minh freshness. Không hứa hết seq error từ một thay đổi pacer | Vừa–lớn |
| B — giữ pacer, chỉ thêm metric và cảnh báo trước | Có bằng chứng timeline với rủi ro runtime nhỏ hơn | Đuôi trễ và cơ chế chạy bù còn tồn tại; chưa đóng finding P1 | Nhỏ–vừa |
| C — tăng period để giảm tải | Có thể giảm transaction/s trong một số workload | Thay cadence và độ trễ I/O; chưa có dữ liệu chứng minh nên đổi từ 2 ms. Cần quyết định contract riêng | Vừa, phạm vi sản phẩm |

**Khuyến nghị:** A theo hai bước: đo/thiết kế rồi implement/test. Dùng B làm bước
đầu nếu chưa có thiết kế A. Chưa chọn C chỉ từ số liệu audit. Owner đề xuất:
FW-SOM/IOBus và QA giao tiếp; PM cần bố trí fixture Fake MCU có delay/fault,
sau đó fixture MCU/UART vật lý cho claim phần cứng.

### 4.2 Core jitter — đo nguyên nhân trước chỉnh nền tảng

| Phương án | Lợi ích | Đánh đổi / điều kiện | Độ phức tạp |
|---|---|---|---|
| A — histogram/timeline wake + IRQ/softirq, sau đó A/B affinity có mục tiêu | Tách nguyên nhân; đo được phần đuôi >100 µs thay vì chỉ trung bình | Trace cũng có overhead; phải đo khi bật/tắt trace và kiểm mạng/UART sau mỗi chỉnh affinity | Vừa |
| B — chuyển BSP/kernel RT hoặc bổ sung isolation rộng | Có thể cần để đạt ràng buộc độ trễ chặt trên nền tảng hiện tại | Chưa có thử nghiệm chứng minh mức cải thiện; tác động driver/boot/deploy/rollback, cần lane BSP và khả năng phục hồi tại bo | Lớn |
| C — giữ cấu hình và chỉ công bố kết quả hiện có | Không tạo thay đổi runtime mới | Không đạt C4 ở lịch sử đo. Không tự nới ngưỡng hoặc gọi PASS | Nhỏ, không đóng P1 |

**Khuyến nghị:** A trước; B chỉ đưa vào triển khai khi A và thử nghiệm cho thấy
cần thiết. Thay ngưỡng sản phẩm không nằm trong quyền của một quyết định tối ưu
thông thường; nếu đề xuất thì đi qua Product/Architect và authority tương ứng.

### 4.3 Snapshot Point — sửa có giới hạn trước, chia sẻ sampler khi cần

| Phương án | Lợi ích | Đánh đổi / điều kiện | Độ phức tạp |
|---|---|---|---|
| A — instrument odd-seq/copy-time, retry/backoff có deadline | Phạm vi reader nhỏ; có thể giải quyết collision ngắn mà không thay producer | Giữ fail-safe khi writer treo, không retry vô hạn hoặc trả stale thành GOOD; kiểm latency và concurrent readers | Nhỏ–vừa |
| B — sampler snapshot nhất quán dùng chung cho REST/WS | Giảm copy/fan-out nếu nhiều consumer được profile xác nhận | Phải chốt generation, epoch, timestamp/age, unknown/stale và recovery; có nguy cơ phục vụ dữ liệu cũ nếu thiết kế thiếu | Vừa–lớn |
| C — tăng số vòng tight retry đơn thuần | Patch nhỏ | Có thể tăng CPU mà vẫn không đợi writer nhả; chưa có profile để chọn số vòng đúng | Nhỏ, chưa khuyến nghị |

**Khuyến nghị:** A trước; B là bước sau nếu phép đo xác nhận nhu cầu. Owner đề
xuất: Web API + QA IPC; giữ tương thích SHM producer và không chặn luồng RT.

### 4.4 API trạng thái — lấy mẫu CPU nền

**A, khuyến nghị:** một collector nền khoảng 1 s, route đọc snapshot có sampledAt,
age và trạng thái unknown/stale. Lợi ích là bỏ chờ 100 ms khỏi mỗi request;
phải xử lý khởi động, collector lỗi và cancellation. Độ phức tạp nhỏ–vừa, owner
Web API.

**B:** cache theo request với TTL ngắn. Phạm vi có thể nhỏ nhưng request đầu/TTL
hết vẫn có thể chờ 100 ms và nhiều caller phải được gom để tránh lấy mẫu trùng.
Chỉ chọn khi Engineering chứng minh không tạo burst và ngữ nghĩa age đúng.

Không dùng CPU=0 giả khi chưa có mẫu. `/overview` và `/system/status` cần dùng
chung nguồn để tránh nhân đôi công việc.

### 4.5 Log và polling — bảo toàn audit có giá trị

**A, khuyến nghị:** giảm INFO driver bằng cấu hình BSP hợp lệ, aggregate/sample
GET/READ thành công; giữ 100% mutation/security/rejected/error và đếm số dòng
đã aggregate. Trước thay policy, owner tài liệu audit/QA xác nhận vẫn đáp ứng
truy vết. Driver giảm log phải giữ mạng hoạt động và lỗi quan trọng. Phạm vi vừa,
owner phối hợp BSP/Core IPC/Web.

**B:** chỉ giới hạn dung lượng journal hoặc vacuum. Có thể giảm không gian lưu
nhưng không giảm công việc tạo log, còn mất lịch sử điều tra. Dùng làm chính
sách retention bổ sung, không thay thế A.

Sau khi nhận diện caller, thử gom request trùng, pause tab ẩn, cache metadata
Programs theo revision/ETag và live subscription phù hợp. Chưa tự quy toàn bộ
5,2 request/s cho FE hoặc chốt một quy mô client chưa đo. Độ phức tạp vừa;
owner Web/FE cùng QA freshness/offline/reconnect.

### 4.6 FE — nén sẵn trước, tách tải biểu đồ sau

**A, khuyến nghị bước đầu:** build sinh tài nguyên nén sẵn và server thương lượng
encoding đúng; kiểm `Vary`, HEAD, ETag/cache/range và body sau giải nén. Tránh
thêm chi phí nén mỗi request trên bo. Phạm vi nhỏ–vừa, owner packaging/Web/FE.

**B:** nén động trên server. Giảm byte truyền nhưng thêm CPU mỗi request;
chỉ chọn khi benchmark tải HTTP/jitter cho thấy chi phí chấp nhận được.

**C, bước tiếp theo:** tách dependency biểu đồ khỏi login bằng import/route đúng
ranh giới kiến trúc. Không xoá preload bằng tay rồi coi là hoàn tất: cần kiểm
cold login, dashboard và lần mở biểu đồ đầu. Lượt reload warm LCP 308 ms không
chứng minh cold/mobile performance; chưa có số đo để hứa tăng tốc bao nhiêu.

### 4.7 Provenance và telemetry — nền để kiểm hồi quy

**A, khuyến nghị:** manifest cho từng artifact, commit/tree/dirty/toolchain/hash,
read-back `/proc/MainPID/exe` của Web và cả hai helper cùng FE đang phục vụ;
telemetry có producer epoch, cửa sổ/mẫu và read/write latency riêng.

**B:** chỉ cập nhật checksum hiện tại vào manifest. Dễ làm khớp byte nhưng
không khôi phục được source provenance; không đủ để khẳng định bản mới nhất.
Không chọn B để làm gate xanh.

Phạm vi nhỏ–vừa cho packaging/telemetry ứng dụng; bật kernel PSI/accounting
là phạm vi BSP riêng và cần đo overhead. Dữ liệu thiếu/unknown phải được hiển
thị đúng, không thay bằng 0 để làm biểu đồ đẹp.

## 5. Trình tự triển khai đề xuất

| Đợt | Việc giao | Điều kiện bắt đầu | Kết quả để PM/QA review |
|---|---|---|---|
| 0 — khóa baseline và phép đo | Provenance, đối chiếu regression ở đúng artifact; instrument IOBus/Core/SHM/caller có giới hạn | PM giao owner; xác định baseline/package/fixture và overhead phép đo | Baseline tái tạo được; danh sách Issue; nguyên nhân xác nhận/giả thuyết tách rõ; ước lượng công việc và acceptance được chốt |
| 1 — sửa reader và giảm chờ/truyền | Snapshot A, collector CPU nền, nén sẵn; policy log chỉ làm khi đã chốt §7 D05 | Scope/contract/test/rollback của từng Issue đủ; có người review độc lập | Trước–sau từng nhóm thay đổi; không ghép nhiều patch rồi mất khả năng quy nguyên nhân |
| 2 — nhịp giao tiếp và tải nhiều consumer | IOBus late-tick theo thiết kế; A/B Core có mục tiêu; polling/shared sampler/defer charts nếu phép đo xác nhận cần | Chốt watchdog/safe-state/freshness; đủ fixture, đường phục hồi và tiêu chí từng lớp | Nghiệm thu delay/fault/timeout, latency/jitter và freshness; đề xuất kernel hoặc mở rộng kiến trúc nếu vẫn không đạt |

Đợt 0 không phải lý do hoãn vô hạn P1: PM cần giao người và mốc trả lời trong
phiếu quyết định. Công việc độc lập của đợt 1 có thể chạy song song sau khi scope
được chốt. Chưa đặt ngày công/lịch tuần vì chưa có owner và scope Issue xác nhận.

## 6. Tiêu chí thử nghiệm và điều kiện triển khai lên bo

Các target định lượng sau là **đề xuất để PM/Engineering/QA chốt**, ngoại trừ
C4 ≤100 µs đang là ràng buộc được đối chiếu trong audit; báo cáo này không nới C4.

| Nhóm | Phép kiểm đề xuất | Không được đánh đổi |
|---|---|---|
| Snapshot Point | 30 phút tải **tổng** nominal khoảng 5–6 GET/s; PM/QA chốt mix route/client theo baseline, có `/points` và routes giám sát. Đếm riêng `/points`: 0 HTTP503 do snapshot, p95 server ≤20 ms; concurrent-reader, writer treo/restart/seq lẻ và epoch đổi | Writer treo vẫn báo unavailable; stale không thành GOOD; Program missed/overrun không tăng |
| API trạng thái | p95 server status <20 ms, overview <50 ms; age ≤2 s ở tải nominal; startup/fault/cancel test | Không bịa CPU/RAM hoặc dùng mẫu quá tuổi như fresh |
| IOBus | Chốt deadline/gap/watchdog từ hợp đồng trước test; delay/fault/timeout có output ordering đúng; counter late/missed/seq/timeout trước–sau theo epoch; không còn burst chạy bù ngoài policy đã duyệt | Không chỉ giảm counter để gọi PASS; giao tiếp và safe-state/heartbeat phải đúng; Fake MCU không thay HIL UART/MCU |
| Core C4 | Đo lại dưới tải vận hành và thao tác đọc log; histogram/timeline có nhãn; thử bền 24 giờ là phép thử đề xuất riêng, số lần >100 µs phải 0 nếu claim C4 trong cửa sổ đó | Không suy từ trung bình/p95 max-phút; missed step và overrun vẫn phải 0; trace overhead phải được công bố |
| Log/polling | Cùng scenario/client: giảm ≥80% access/read log thành công và ≥50% GET nếu áp dụng gom polling; freshness ≤1 s; đo CPU/eMMC/jitter | Giữ audit mutation/security/error và alarm history; không che lỗi bằng giảm log |
| FE | Body giải nén đúng hash; Content-Type/header/cache/HEAD/encoding đúng, client không hỗ trợ nén nhận identity fallback; cold/warm login/dashboard/first-chart trước–sau cùng viewport/mạng, thêm mobile khi đổi layout/hành vi liên quan | Chưa duyệt mục tiêu tốc độ chỉ từ tiềm năng giảm 73,2% byte; không hồi quy chức năng/Console/Network |
| Provenance/telemetry | Artifact/source/hash/dirty/toolchain có truy xuất; service và hai helper không chạy exe deleted; counter reset/epoch/window và latency fixture đúng | Không tạo provenance giả hoặc ghi số cumulative thành delta/cửa sổ |

Mỗi thay đổi phải có test ở lớp bị ảnh hưởng, Reviewer độc lập theo
[WF-CLEAN-001](../../00_governance/CLEAN_CODE_WORKFLOW.md), gói/backup/rollback và
đọc lại target. Trước thay cấu hình kernel/IRQ/UART, xác nhận đường truy cập và
khả năng phục hồi phù hợp. FE runtime cần Chrome DevTools và các gate FE liên
quan theo AGENTS.md; kiểm tài liệu không thay cho gate mã nguồn.

PM có thể cho phép pilot trên bo lab khi gate của Issue đạt; quyết định đó
không tự nâng [Verification/release](../../05_verification/VERIFICATION.md).

## 7. Phiếu quyết định dành cho PM

PM điền **phương án chọn, người chịu trách nhiệm thực, mốc phản hồi/triển khai và
điều kiện kèm theo**. Nếu hoãn hoặc không triển khai, ghi tác động/rủi ro chấp
nhận và thời điểm xem lại. Ô CHỜ QUYẾT ĐỊNH không phải phê duyệt ngầm.

| Mã | Nội dung cần quyết | Khuyến nghị Engineering | Vai cần tham gia | Kết quả / owner thực / mốc / điều kiện |
|---|---|---|---|---|
| D01 | Cho phép đợt 0 khóa baseline, instrument có giới hạn và lập Issue riêng | Chọn A §4.7; instrument theo §4.1–4.3, đo overhead, giữ cấu hình/Program hiện tại | PM + Tech Lead + QA | **CHỜ QUYẾT ĐỊNH** |
| D02 | Phạm vi sửa snapshot: retry có deadline hay shared sampler | Snapshot A; B chỉ sau profile; giao tiêu chí freshness/fail-safe rõ | PM + Web API + QA IPC | **CHỜ QUYẾT ĐỊNH** |
| D03 | Chính sách tick trễ IOBus và fixture kiểm IOP | IOBus A hai bước; không tự tăng period; chốt watchdog/output trước implement | PM + FW-SOM + Architect + QA giao tiếp | **CHỜ QUYẾT ĐỊNH** |
| D04 | Phạm vi điều tra Core và điều kiện mở lane BSP/kernel | Core A trước, B có điều kiện theo dữ liệu; giữ C4 hiện hành | PM + FW-SOM/BSP + Architect + QA | **CHỜ QUYẾT ĐỊNH** |
| D05 | Cho phép thay chính sách log READ/GET thành công và giảm polling | Log A; giữ 100% audit quan trọng, chốt retention và nhận diện caller | PM + owner audit/Product + Core/Web/FE + QA | **CHỜ QUYẾT ĐỊNH** |
| D06 | Giao nhóm tối ưu API/FE độc lập và thứ tự ưu tiên | Collector nền + nén sẵn trước; defer charts sau đo; không nén động nếu chưa đo CPU | PM + Web/FE/packaging + QA | **CHỜ QUYẾT ĐỊNH** |
| D07 | Nguồn lực/lịch thử bền và HIL, pilot lab, phạm vi claim sau nghiệm thu | Chốt owner/fixture/mốc, gắn từng claim với bằng chứng; không nâng release từ audit | PM + QA + FW-SOM + Product/Release owner | **CHỜ QUYẾT ĐỊNH** |

### Ghi nhận cuộc review

| Trường | Nội dung |
|---|---|
| Ngày review | Chưa ghi nhận |
| PM / Tech Lead / QA tham dự | Chưa ghi nhận |
| Quyết định D01–D07 | Chưa ghi nhận |
| Issue / người được phân công / milestone | Chưa tạo từ báo cáo này |
| Phạm vi cho phép deploy lab | Chưa được xác lập từ báo cáo này |
| Điều kiện chưa đồng thuận | Chưa ghi nhận; các giả thuyết kỹ thuật đang mở nêu ở §3–4 |
| Người ghi biên bản / xác nhận | Chưa ghi nhận |

## 8. Truy xuất bằng chứng và trạng thái kiểm chứng

| Nguồn | Dùng để làm gì |
|---|---|
| [Audit kỹ thuật ngày 28/09 — §13](PROGRAMMING_RUNTIME_PERFORMANCE_COMPETITIVE_REVIEW_2026-09-04.md#13-audit-hệ-thống-và-phần-mềm-trên-forlinx--2026-09-28) | Source mapping, cửa sổ đo, phân biệt metrics và toàn bộ finding gốc |
| [JSON audit](../test-evidence/fw-som/forlinx-performance-20260928/audit-summary.json) | Số tài nguyên, log/counter, latency API, compression và artifact match đã lọc |
| `~/Desktop/DDC-board-audits/forlinx-performance-20260928-0253Z/` | Raw log nén, script, screenshot/trace, JSON riêng; quyền hạn chế, SHA256 manifest 51/51 của đợt audit |
| [Document Governance](../../00_governance/DOC_GOVERNANCE.md) | Phân biệt record, Detailed Design và các gate |

Báo cáo riêng này chỉ bổ sung hồ sơ cho PM. Số đo target lấy từ đợt audit; không
claim có deploy tối ưu, phép đo trước–sau hoặc test code mới trong phiên lập tài
liệu. Hai sub-agent đã đối chiếu số liệu/phương án theo chuyên môn OS/Core/IOP và
API/Modbus/FE; không có finding chặn báo cáo, các giới hạn mẫu/cửa sổ đã bổ
sung. `docs_iso_harness.py --expect`, link/metadata/whitespace và đối chiếu JSON
đã PASS; xem CHANGELOG. Bảng quyết định giữ trạng thái chưa phê duyệt tới khi có
biên bản thực.

## 9. Lịch sử sửa đổi

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-09-28 | Tạo báo cáo riêng theo yêu cầu chủ sở hữu: hiện trạng audit, 9 nhóm finding, các lựa chọn/trade-off, trình tự, tiêu chí đề xuất và D01–D07 để PM review/quyết định; chưa triển khai tối ưu |
