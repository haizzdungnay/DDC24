# Plan 63 — Khắc phục hiệu năng và độ tin cậy nhịp trên Forlinx

| Thuộc tính | Giá trị |
|---|---|
| ID | `PLAN-PERF-FORLINX-063` |
| Phiên bản | 1.2 |
| Trạng thái | **Approved — cổng G0 duyệt 2026-09-28 (chủ sở hữu dự án); READY để implement qua Issue [#809](https://github.com/Mekong-HCM/MK-DDC-24/issues/809). Cổng G-D1…G-D4 còn chờ** |
| Ngày | 2026-09-28 |
| Chủ quản | Tech Lead (điều phối) — owner từng task ghi ở §4 là vai trò đề xuất |
| Người review | PM, Tech Lead, System Architect, QA, FW-SOM, Web/FE |
| Người phê duyệt | Chủ sở hữu dự án — cổng G0, 2026-09-28; các cổng thiết kế G-D1…G-D4 theo §5 |
| Baseline As-Built | `main@cb690dfb` — đã đối chiếu từng finding với mã nguồn tại mốc này |
| Nguồn finding | [Record hiệu năng §6, §13, §14](../07_records/reviews/PROGRAMMING_RUNTIME_PERFORMANCE_COMPETITIVE_REVIEW_2026-09-04.md#14-đối-chiếu-mã-nguồn-tại-maincb690dfb--2026-09-28) · [Báo cáo PM D01–D07](../07_records/reviews/FORLINX_PERFORMANCE_PM_REVIEW_2026-09-28.md) · [JSON số đo](../07_records/test-evidence/fw-som/forlinx-performance-20260928/audit-summary.json) |
| Theo dõi | **Một Issue duy nhất** [#809](https://github.com/Mekong-HCM/MK-DDC-24/issues/809) · **một nhánh** · **một PR** `Closes #809`; trạng thái từng task ở §7 |
| Phạm vi | Core, IOBus, Web API, Web UI, packaging/platform và tài liệu. **Không** gồm HIL vật lý, lane `PARALLEL`, JIT, đổi kernel RT hoặc đổi hợp đồng IOP |

---

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| Plan này làm gì? | Gom **mọi finding hiệu năng còn mở** của hai đợt rà soát (04/09 và 28/09) thành 25 task có ID, source ownership, tiêu chí chấp nhận đo được và cột trạng thái. Toàn bộ được thi hành trong **một Issue và một PR**. |
| Vì sao cần một plan chứ không sửa lẻ? | Hai đợt audit tạo 19 mã finding, lần đối chiếu mã ngày 28/09 thêm 2 (tổng 21); một phần đã được ADR-061 sửa hoặc đổi mức độ. Không có một bảng truy xuất chung thì team sẽ sửa trùng, sửa việc đã xong hoặc bỏ sót việc còn mở. |
| Bằng chứng nào cho thấy finding còn thật? | Mỗi finding đã được đọc lại trong mã tại `main@cb690dfb`, ghi `file:dòng` ở §2. Không có task nào chỉ dựa trên số đo cũ. |
| Việc nào rủi ro nhất? | Đổi nhịp IOBus (T63-201) và thi hành budget từng Program (T63-303). Cả hai có **cổng thiết kế** bắt buộc duyệt trên Issue trước khi viết code. |
| Làm theo thứ tự nào? | W0 đo và khoá baseline → W1 Web/FE (không chạm luồng RT) → W2 luồng RT → W3 budget Program → W4 deploy, đo lại, đóng hồ sơ. |
| Ước lượng? | ≈ **33 người-ngày** (§4.6). Đây là ước lượng Engineering để PM xếp nguồn lực, **chưa chốt**. |
| Bắt đầu ngay được việc gì? | Tách nhánh từ `main`. Làm song song W0 (T63-001…005) và các task W1 không cần cổng (T63-101, 102, 103, 104, 108, 109, 110), cùng T63-202, T63-203, T63-301, T63-302, T63-304. Task có cổng (T63-105/106/107 → G-D3, T63-201 → G-D1, T63-204 → G-D4, T63-303 → G-D2) giữ `BLOCKED` tới khi cổng được duyệt. |
| Khi nào gọi là xong? | Khi đủ Definition of Done ở §10: mọi task `DONE` hoặc `N/A` có lý do, mọi cổng có biên bản, bảng Verification có số đo thật trước và sau trên bo. |

### 0.1 Kết luận quản lý

1. Bo Forlinx **còn dư CPU/RAM**. Vấn đề cần sửa là **tính ổn định nhịp giao tiếp, độ tin cậy đọc dữ liệu, độ trễ API, khối lượng log và dung lượng tải trang**, không phải sức mạnh xử lý.
2. Rủi ro lớn nhất của Programming **không nằm trong §13** của audit 28/09 mà nằm ở `F-PRG-PERF-001`. Sau ADR-061, budget một base step chỉ còn 2.000 µs. Benchmark target 04/09 cho thấy cấu hình tối đa mà profile cho phép (16 Program × 4.095 instruction) chạy trung bình 2,00–2,05 ms. Một package qua được Check vẫn có thể làm **cả Task** chuyển `FAULTED` sau 3 lần vượt budget liên tiếp. Việc này phải được đo lại trên bo sạch (T63-301) trước khi kết luận.
3. Một số finding của snapshot 04/09 **đã được ADR-061 sửa**: EINTR, chính sách bỏ mốc base step, snapshot theo đồng hồ, Program miss lệch pha. Chúng chỉ cần read-back để đóng (T63-001), không cần sửa lại.
4. `F-PRG-PERF-007` là **triệu chứng của sự cố xâm nhập** đã xử lý bằng việc cài sạch bo ngày 27/09; không có việc kỹ thuật hiệu năng nào còn lại cho nó.

---

## 1. Nguồn, thẩm quyền và quy tắc áp dụng

| Loại | Tài liệu | Vai trò trong plan này |
|---|---|---|
| Finding | [Record `REC-PROG-RUNTIME-PERF-COMP-001`](../07_records/reviews/PROGRAMMING_RUNTIME_PERFORMANCE_COMPETITIVE_REVIEW_2026-09-04.md) §6, §13, §14 | Nguồn gốc 20 mã finding và số đo |
| Phương án/PM | [`REC-FORLINX-PERF-PM-20260928`](../07_records/reviews/FORLINX_PERFORMANCE_PM_REVIEW_2026-09-28.md) §4, §6, §7 | Phương án đã so sánh và phiếu D01–D07; plan này chọn phương án khuyến nghị và biến D01–D07 thành cổng ở §5 |
| Kiến trúc chu kỳ | [ADR-061](../adr/ADR-061-programming-chu-ky-10ms-bo-chu-ky-moi.md) | Base step 10 ms, budget 2.000 µs, metric C4 ≤100 µs, luật "lỡ thì bỏ" |
| Quyết định overrun | `OD-PROG-012` ([SRS](../02_requirements/PROGRAMMING_REQUIREMENTS_SPEC.md)) | 3 overrun liên tiếp ⇒ Task FAULT. T63-303 **không** được đổi luật này khi chưa qua G-D2 |
| Hợp đồng SHM | `contracts/shm/mkddc_shm.h` | Pattern seqlock bắt buộc; reader hết lượt thử phải xử lý fail-safe |
| Hợp đồng IOP | `contracts/iop/iop_protocol.h:49-54` | `IOP_RESP_TIMEOUT_MS=3`, `IOP_FAULT_TIMEOUT_MS=20`, `IOP_SAFE_TIMEOUT_MS=200`; plan này **không** đổi các hằng số đó |
| Quy trình | [WF-CLEAN-001](../00_governance/CLEAN_CODE_WORKFLOW.md) | Tách vai N1/N2, truy xuất N3, không PASS khi không có số đo (N4) |
| Deploy | [DEPLOY_FOXLINX](DEPLOY_FOXLINX.md) | Đường deploy, rollback và kiểm `/proc/<MainPID>/exe` |

Plan này là **kế hoạch thi hành**, không phải Detailed Design. Hai task đổi ngữ
nghĩa runtime (T63-201, T63-303) phải có ghi chú thiết kế được duyệt ở cổng
tương ứng trước khi viết code. Plan không nâng `RELEASE_READY` hoặc gate HIL.

---

## 2. Hiện trạng đã đối chiếu tại `main@cb690dfb`

Trạng thái: **OPEN** còn nguyên · **PARTIAL** đã sửa một phần · **FIXED-VERIFY**
mã đã sửa, chờ read-back trên bo để đóng · **CLOSED** không còn việc kỹ thuật ·
**NO-ACTION** giữ nguyên có chủ ý.

### 2.1 Finding của snapshot 04/09

| Finding | Trạng thái | Bằng chứng trong mã | Task |
|---|---|---|---|
| `F-PRG-PERF-001` budget WCET | **PARTIAL, mức độ tăng** | Backend đã chia 2.000 µs theo số Program ([checks_topology.go:96-100](../../apps/web-api/internal/programming/application/checks_topology.go#L96-L100)), nhưng Core đọc `program_budget_us` rồi bỏ: [PackageProgramSlice](../../apps/core/application/programming/programming_runtime_coordinator.hpp#L156-L160) và [StProgramSetEntry](../../apps/core/application/st/st_scheduler.hpp#L386-L392) không có budget. Vượt budget xử lý ở cấp Task: [st_scheduler.cpp:1147-1167](../../apps/core/application/st/st_scheduler.cpp#L1147-L1167) | T63-301/302/303 |
| `F-PRG-PERF-002` I/O chặn trong scan | **PARTIAL** | Đã sửa: EINTR ([scan_loop.cpp:595-601](../../apps/core/application/runtime/scan_loop.cpp#L595-L601)), bỏ mốc quá hạn (`BaseStepPacer`), snapshot 60 s theo đồng hồ. Còn lại: `StateSnapshot::save` (JSON + 2 `fsync`) vẫn chạy trong `after_scan` trên luồng quét FIFO80 ([main.cpp:936-941](../../apps/core/bootstrap/main.cpp#L936-L941)) | T63-203 |
| `F-PRG-PERF-003` multi-core chưa nối | **NO-ACTION** | Target 04/09 chỉ nhanh 1,06–1,18 lần theo mean, tail tới 41,14 ms. Giữ `SEQUENTIAL`, không claim chạy song song | — |
| `F-PRG-PERF-004` compile tuyến tính | **OPEN** | Compile tuần tự từng Program ([checks.go:370-371](../../apps/web-api/internal/programming/application/checks.go#L370-L371)); mỗi lần tạo thư mục tạm + process ([runner.go:313](../../apps/web-api/internal/programming/compiler/runner.go#L313), [runner.go:412](../../apps/web-api/internal/programming/compiler/runner.go#L412)) | T63-304 |
| `F-PRG-PERF-005` Program miss lệch pha | **FIXED-VERIFY** | Release theo Program có dung sai và nhảy mốc ([st_scheduler.cpp:117-162](../../apps/core/application/st/st_scheduler.cpp#L117-L162)); audit 28/09 thấy missed release `0→0` | T63-001 |
| `F-PRG-PERF-006` period hiệu lực ≠ source | **FIXED-VERIFY** | Profile nay cho `10/50/100/500/1000/5000/10000/50000` ms ([product_profile_v2.json:19-31](../../contracts/programming/product_profile_v2.json#L19-L31)); FE hiển thị `periodMs` ở Runtime/Overview; fixture `RelayPattern32` đã mất khi cài sạch bo 27/09 | T63-001 |
| `F-PRG-PERF-007` service lạ tự restart | **CLOSED** | `masscan-agent`/`AgentSvr-agent` là thành phần xâm nhập ([record bảo mật](../07_records/security/2026-09-26-foxlinx-ssh-intrusion.md)); bo cài sạch 27/09 ([evidence](../07_records/test-evidence/fw-som/2026-09-27-foxlinx-factory-reset.md)). Hệ quả: số tail TARGET 04/09 đo trên bo bị xâm nhập | — |

### 2.2 Finding của audit 28/09

| Finding | Trạng thái | Bằng chứng trong mã | Task |
|---|---|---|---|
| `PERF-SYS-05` IOBus chạy bù | **OPEN, xác nhận** | `sleep_until` cộng một chu kỳ vào mốc cũ, không kiểm mốc đã qua ([iobus main.cpp:86-94](../../apps/iobus/bootstrap/main.cpp#L86-L94), gọi ở [dòng 1191](../../apps/iobus/bootstrap/main.cpp#L1191); số dòng sau T63-004, tại `cb690dfb` là 85-93 và 1169). Core đã có chính sách đúng trong `BaseStepPacer`, IOBus không dùng | T63-004/201 |
| `PERF-SYS-07` (mới) biên thời gian IOP | **OPEN** | Giao dịch IOP ≈1,4 ms trong chu kỳ 2 ms; `IOP_RESP_TIMEOUT_MS=3` dài hơn chu kỳ ([iop_protocol.h:49](../../contracts/iop/iop_protocol.h#L49)). Bộ đếm overrun tăng ở **mỗi vòng** chạy bù ([main.cpp:922-924](../../apps/iobus/bootstrap/main.cpp#L922-L924); tại `cb690dfb` là 912-914), nên một lần kẹt 16 ms bị đếm khoảng 7 lần | T63-004/202 |
| `PERF-SYS-01` Core jitter C4 | **OPEN** | 9 lần >100 µs trước audit (không do audit). 5 lần thêm rơi đúng phút thu journal nên không dùng làm bằng chứng nguyên nhân | T63-005/204 |
| `PERF-API-01` `/points` 503 | **OPEN, xác nhận** | Reader thử 5 vòng liền; gặp seq lẻ là thử lại ngay, không nhường CPU ([shm_reader.go:155-173](../../apps/web-api/internal/app/shm_reader.go#L155-L173)). Core ([iobus_reader.cpp:59](../../apps/core/adapters/ipc/iobus_reader.cpp#L59)) và HMI ([shm_reader.cpp:79](../../apps/hmi/data/shm_reader.cpp#L79)) dùng cùng con số 5 | T63-101/102 |
| `PERF-API-02` chờ 100 ms lấy CPU | **OPEN, xác nhận** | [system.go:230-246](../../apps/web-api/internal/app/system.go#L230-L246) | T63-103 |
| `PERF-API-03` log mọi GET | **OPEN, xác nhận** | [http.go:85-93](../../apps/web-api/internal/app/http.go#L85-L93) | T63-105/108 |
| `PERF-SYS-03` audit đọc alarm_list | **OPEN, xác nhận** | [web_ipc.cpp:493](../../apps/core/adapters/ipc/web_ipc.cpp#L493) ghi AUDIT mỗi lần đọc | T63-106 |
| `PERF-SYS-02` log driver Wi-Fi | **OPEN** | `/proc/net/rtl8821cs/log_level=4` trên bo; chưa có cấu hình trong `platform/` | T63-107 |
| `PERF-SYS-06` (mới) khối lượng ghi eMMC | **OPEN, cần định lượng** | 112.785 B/s ngoại suy ≈9,7 GB/ngày ≈3,5 TB/năm. Đây là rủi ro tuổi thọ, chưa biết nguồn ghi | T63-110 |
| `PERF-FE-01` assets không nén | **OPEN, xác nhận** | `handleStatic` chỉ đặt cache header rồi `http.ServeFile` ([http.go:349-379](../../apps/web-api/internal/app/http.go#L349-L379)) | T63-104 |
| `PERF-FE-02` login tải biểu đồ | **OPEN** | `manualChunks` gom `recharts` thành `charts` ([vite.config.ts:57-63](../../apps/web-ui/vite.config.ts#L57-L63)); trang import tĩnh trong `App.tsx` | T63-109 |
| `PERF-PROV-01` manifest lạc hậu | **OPEN** | `provenance.json` chỉ sinh khi dựng gói release ([build-release.sh:132](../../platform/packaging/build-release.sh#L132)); deploy từng thành phần không cập nhật | T63-002 |
| `PERF-SYS-04`, `PERF-API-04` thiếu nhãn đo | **OPEN** | Latency bus rolling trộn đọc/ghi; counter không có epoch/cửa sổ | T63-003 |

---

## 3. Nguyên tắc thi hành

1. **Đo trước, sửa sau, đo lại.** Mọi task có tiêu chí định lượng phải có số trước và sau theo cùng giao thức ở §6.
2. **Không quét journal trong cửa sổ đo.** Thu log **sau** cửa sổ bằng `--since/--until`. Audit 28/09 đã tự gây thêm 5 vi phạm jitter khi đọc journal trong lúc đo.
3. **Fail-safe không được yếu đi.** Reader hết hạn vẫn báo lỗi; dữ liệu cũ không được gắn GOOD; watchdog IOP và safe-state MCU (200 ms) giữ nguyên.
4. **Không đổi hợp đồng ngoài phạm vi.** Chỉ thêm trường (additive). Đổi `KX_SHM_MAGIC` bắt buộc deploy iobus + core + web **cùng lúc**.
5. **Không đổi Active Program của người dùng.** Đọc Active ngay trước khi thử và khôi phục đúng bản đó. Không ghim cứng revision ID.
6. **Một task, một commit (hoặc một nhóm commit liền nhau)**, tiêu đề Conventional Commits có mã `T63-xxx`, thân tiếng Việt theo mẫu triệu chứng → nguyên nhân gốc → cách sửa.
7. **Lỗi trong phạm vi task phát hiện giữa chừng thì sửa luôn**. Lỗi ngoài phạm vi thì mở finding `state:triage`, không tự làm.

---

## 4. Work breakdown

Trạng thái: `TODO` · `IN-PROGRESS` · `BLOCKED(<cổng>)` · `DONE` · `N/A(<lý do>)`.
Ước lượng tính bằng người-ngày (NĐ).

### 4.1 W0 — Khoá baseline và bổ sung khả năng đo

Không đổi hành vi điều khiển. Mở khoá mọi wave sau.

#### T63-001 — Giao thức đo và baseline sạch trên bo

- **Finding:** PERF-SYS-01/05/06/07, PERF-API-01, F-PRG-PERF-005/006 (read-back để đóng).
- **Owner đề xuất:** QA + FW-SOM. **NĐ:** 1,5.
- **Source ownership:** `scripts/forlinx_perf_probe.py` (mới) và thư mục evidence mới `forlinx-perf-remediation-<YYYYMMDD>/` dưới [test-evidence/fw-som](../07_records/test-evidence/fw-som/).
- **Việc:** viết script đọc-chỉ thu counter theo §6. Chạy **2 lượt × 30 phút** trên bo ở trạng thái hiện tại.
- **Tiêu chí chấp nhận:**
  - [ ] JSON baseline có đủ metric ở §6.3, kèm provenance, nhiệt độ, governor, PID/epoch từng service.
  - [ ] Program `missedReleaseCount` và Task missed release đều tăng 0 trong 2 × 30 phút ⇒ đóng `F-PRG-PERF-005` (nếu tăng thì mở lại, ghi số).
  - [ ] Read-back Active: `periodMs` hiệu lực khớp khai báo trong Program ⇒ đóng `F-PRG-PERF-006`.
  - [ ] Ghi `seqlock_fail` của Core (quyết định nhánh của T63-102).
  - [ ] Không chạy `journalctl`/`grep` log trong cửa sổ đo (log lệnh có dấu thời gian).

#### T63-002 — Provenance theo từng artifact (PERF-PROV-01)

- **Owner đề xuất:** DevOps. **NĐ:** 1,5.
- **Source ownership:** `platform/packaging/build-release.sh`, script deploy/read-back trong `scripts/`, [DEPLOY_FOXLINX.md](DEPLOY_FOXLINX.md), `.claude/skills/foxlinx-deploy/`.
- **Tiêu chí chấp nhận:**
  - [ ] Manifest ghi từng artifact: tên, sha256, commit, tree dirty, thời điểm build, toolchain.
  - [ ] Deploy **một phần** (ví dụ chỉ web) cập nhật đúng mục của artifact đó, giữ mục còn lại.
  - [ ] Script read-back so sha256 của `/proc/<MainPID>/exe` (core, iobus, web, hai helper) và `index.html` FE đang phục vụ với manifest: **0 lệch** sau deploy thật trên bo.
  - [ ] Không ghi checksum hiện tại vào manifest khi không có nguồn build tương ứng.

#### T63-003 — Nhãn cửa sổ/epoch cho telemetry (PERF-SYS-04, PERF-API-04)

- **Owner đề xuất:** FW-SOM (iobus) + Web API. **NĐ:** 2,0.
- **Source ownership:** metric bus trong `apps/iobus/adapters/modbus_rtu/`, API `apps/web-api/internal/modbusrtu/`, hợp đồng OpenAPI tương ứng (chỉ **thêm** trường).
- **Tiêu chí chấp nhận:**
  - [ ] Latency bus công bố **riêng** đọc và ghi (p50/p95/max), kèm `sampleCount`, `windowSize`, `sinceEpoch`.
  - [ ] Counter tích luỹ IOP/bus kèm epoch tiến trình để phân biệt reset với giảm.
  - [ ] Trường cũ giữ nguyên nghĩa; test hợp đồng cũ vẫn PASS.
  - [ ] Nếu thêm trường vào SHM thì bump magic và ghi rõ trong PR yêu cầu deploy đồng bộ.

#### T63-004 — Đo tách thời gian vòng IOBus (PERF-SYS-05/07)

- **Owner đề xuất:** FW-SOM/IOBus. **NĐ:** 1,0.
- **Source ownership:** `apps/iobus/bootstrap/main.cpp` (khối thống kê phút), test trong `apps/iobus/`.
- **Tiêu chí chấp nhận:**
  - [ ] Log phút tách: `wake_late_max`, `work_max`, `io_resp_gap_max`, `late_events` (số **sự kiện** trễ, không đếm từng vòng chạy bù), `catchup_iterations`.
  - [ ] Không cấp phát/khoá thêm trong vòng poll; test đồng hồ giả cho một lần kẹt 16 ms ⇒ `late_events=1`.
  - [ ] Chạy 30 phút trên bo; số liệu vào evidence để làm đầu vào G-D1.

#### T63-005 — Histogram đánh thức của Core (PERF-SYS-01)

- **Owner đề xuất:** FW-SOM. **NĐ:** 1,0.
- **Source ownership:** `apps/core/application/runtime/base_step_pacer.hpp`, `scan_loop.cpp` (log phút), test tương ứng.
- **Tiêu chí chấp nhận:**
  - [ ] Histogram cố định (≤25, ≤50, ≤100, ≤200, ≤500, >500 µs), mảng tĩnh, không cấp phát.
  - [ ] Công bố overhead đo (so WCET scan trước/sau).
  - [ ] Đo sạch 2 × 30 phút: nếu **0** vi phạm >100 µs ⇒ T63-204 `N/A`; nếu còn vi phạm ⇒ mở G-D4.

### 4.2 W1 — Web API/FE và log, không chạm luồng RT

#### T63-101 — Reader SHM của Web: retry theo thời gian (PERF-API-01)

- **Owner đề xuất:** Web API + QA IPC. **NĐ:** 1,0.
- **Source ownership:** `apps/web-api/internal/app/shm_reader.go` (+ test), `core_client.go` (metric).
- **Việc:** đổi 5 vòng liền thành retry **giới hạn theo thời gian**; gặp seq lẻ thì nhường CPU (`runtime.Gosched()` hoặc ngủ ngắn) trước khi thử lại.
- **Tiêu chí chấp nhận:**
  - [ ] Hằng số deadline tổng (≤1 ms) có chú thích lý do; hết deadline vẫn trả lỗi fail-safe như cũ.
  - [ ] Counter `retry`/`fail` của reader đọc được qua endpoint metric hiện có.
  - [ ] Unit test writer giả giữ seq lẻ 50 µs / 200 µs ⇒ đọc thành công; giữ lẻ vô hạn ⇒ lỗi trong ≤ deadline.
  - [ ] Trên bo: 30 phút tải §6.2 ⇒ **0** HTTP 503 do snapshot ở `/points`, p95 server `/points` ≤ 20 ms.

#### T63-102 — Reader SHM phía C++ (PERF-API-01, nhánh có điều kiện)

- **Owner đề xuất:** FW-SOM + HMI. **NĐ:** 0,75.
- **Source ownership:** `apps/core/adapters/ipc/iobus_reader.cpp`, `apps/hmi/data/shm_reader.cpp`, test tương ứng.
- **Tiêu chí chấp nhận:**
  - [ ] Core: nếu T63-001 đo `seqlock_fail` **> 0**, áp retry giới hạn **≤ 20 µs** (luồng RT) và công bố counter. Nếu **= 0**, ghi bằng chứng và giữ nguyên mã.
  - [ ] HMI: áp cùng chính sách của T63-101 (không phải luồng RT).
  - [ ] Hết hạn vẫn dùng snapshot cũ + đếm metric như hợp đồng hiện hành.

#### T63-103 — Lấy mẫu CPU nền (PERF-API-02)

- **Owner đề xuất:** Web API. **NĐ:** 1,0.
- **Source ownership:** `apps/web-api/internal/app/system.go` (+ test), phần khởi tạo app.
- **Tiêu chí chấp nhận:**
  - [ ] Một collector 1 s dùng chung cho `/system/status` và `/overview`; response có `sampledAt` và `ageMs`.
  - [ ] Chưa có mẫu hoặc mẫu quá 2 s ⇒ trạng thái `unknown`/`stale`, **không** trả CPU=0.
  - [ ] Test khởi động, collector lỗi, huỷ context khi shutdown.
  - [ ] Trên bo: p95 server `/system/status` < 20 ms, `/overview` < 50 ms.

#### T63-104 — Nén sẵn tài nguyên FE (PERF-FE-01)

- **Owner đề xuất:** Web/FE + packaging. **NĐ:** 1,0.
- **Source ownership:** bước build trong `apps/web-ui/` (`build:release`), `apps/web-api/internal/app/http.go` `handleStatic` (+ test), `platform/packaging/` (đóng gói file `.gz`).
- **Tiêu chí chấp nhận:**
  - [ ] Build sinh `.gz` cho JS/CSS trong `assets/`; `index.html` giữ `no-cache`.
  - [ ] Server trả bản `.gz` **chỉ khi** client chấp nhận gzip **và** request không có `Range`; đặt `Content-Encoding: gzip`, `Vary: Accept-Encoding`, `Content-Type` của file gốc; `Cache-Control` không đổi.
  - [ ] Test Go: HEAD, client không nhận gzip (identity), Range, ETag/If-None-Match; body giải nén trùng hash file gốc.
  - [ ] Chrome DevTools: transfer cold load login trước/sau, cùng mạng và viewport; Console/Network không lỗi.

#### T63-105 — Chính sách access log (PERF-API-03)

- **Owner đề xuất:** Web API. **NĐ:** 1,0. **Cổng:** G-D3.
- **Source ownership:** `apps/web-api/internal/app/http.go` `loggingMiddleware` (+ test).
- **Tiêu chí chấp nhận:**
  - [ ] Ghi 100% request không phải GET/HEAD, status ≥ 400 và request chậm hơn ngưỡng đã duyệt.
  - [ ] GET thành công gộp theo phút (đếm theo nhóm route + dur max).
  - [ ] Cùng scenario §6.2: số dòng access log giảm ≥ 80%.

#### T63-106 — Gộp audit đọc alarm_list (PERF-SYS-03)

- **Owner đề xuất:** Core IPC. **NĐ:** 0,5. **Cổng:** G-D3.
- **Source ownership:** `apps/core/adapters/ipc/web_ipc.cpp` (+ test).
- **Tiêu chí chấp nhận:**
  - [ ] Đọc `alarm_list` thành công không ghi AUDIT từng lần; có dòng tổng hợp theo phút.
  - [ ] Giữ 100% AUDIT cho ack, write, override, rejected, error, security (test khoá từng loại).

#### T63-107 — Mức log driver Wi-Fi (PERF-SYS-02)

- **Owner đề xuất:** BSP. **NĐ:** 0,5. **Cổng:** G-D3.
- **Source ownership:** cấu hình trong `platform/` (systemd/modprobe/udev), [DEPLOY_FOXLINX.md](DEPLOY_FOXLINX.md).
- **Tiêu chí chấp nhận:**
  - [ ] Sau khởi động lại, `log_level` bằng mức đã duyệt; lỗi driver vẫn được log.
  - [ ] Wi-Fi vẫn kết nối; số dòng RTW/giờ giảm ≥ 90%; có bước rollback trong runbook.

#### T63-108 — Xác định nguồn polling và giảm GET (PERF-API-03)

- **Owner đề xuất:** Web/FE + QA. **NĐ:** 2,0. **Phụ thuộc:** T63-105 (số đếm theo route).
- **Source ownership:** hook polling trong `apps/web-ui/src/`, ETag cho route metadata trong `apps/web-api/internal/`.
- **Tiêu chí chấp nhận:**
  - [ ] Bảng caller: route nào chiếm phần lớn khoảng 5,2 request/s và từ màn hình nào.
  - [ ] Dừng polling khi tab ẩn; khử request trùng đang bay; metadata theo revision trả 304 khi không đổi.
  - [ ] Cùng scenario (1 tab dashboard, 30 phút): GET/s giảm ≥ 50%; giá trị live cũ không quá 1 s.
  - [ ] Vitest cho hook; không hồi quy reconnect/offline.

#### T63-109 — Không tải thư viện biểu đồ ở trang đăng nhập (PERF-FE-02)

- **Owner đề xuất:** FE. **NĐ:** 1,0. **Phụ thuộc:** T63-104 (đo sau khi đã nén).
- **Source ownership:** `apps/web-ui/src/app/App.tsx`, `apps/web-ui/vite.config.ts`.
- **Tiêu chí chấp nhận:**
  - [ ] Network trang login không tải chunk `charts`.
  - [ ] Thời gian mở dashboard tới biểu đồ đầu tiên không chậm hơn quá 10% so với trước.
  - [ ] Giữ ranh giới phụ thuộc hiện hành; `npm run build:release` và `verify-project.sh --component layout` PASS.

#### T63-110 — Định lượng nguồn ghi eMMC (PERF-SYS-06)

- **Owner đề xuất:** BSP + DevOps. **NĐ:** 1,0.
- **Source ownership:** chỉ đo; cấu hình journald trong `platform/` nếu số đo chỉ ra.
- **Tiêu chí chấp nhận:**
  - [ ] Đo 24 giờ `/proc/diskstats`; bảng nguồn ghi (journald persistent hay volatile, SQLite Programming/historian, snapshot, khác) theo B/s.
  - [ ] Đối chiếu độ bền ghi của chip eMMC trên bo (datasheet) và ước tuổi thọ trước/sau W1.
  - [ ] Nếu cần đổi cấu hình journald thì nêu rõ retention giữ lại cho điều tra.

### 4.3 W2 — Luồng RT của IOBus và Core

#### T63-201 — IOBus: "lỡ thì bỏ" thay cho chạy bù (PERF-SYS-05)

- **Owner đề xuất:** FW-SOM/IOBus + QA giao tiếp. **NĐ:** 2,0. **Cổng:** G-D1. **Phụ thuộc:** T63-004.
- **Source ownership:** `apps/iobus/bootstrap/main.cpp` (vòng poll), pacer cục bộ trong `apps/iobus/application/` theo mẫu `BaseStepPacer` của Core, test trong `apps/iobus/`.
- **Tiêu chí chấp nhận:**
  - [ ] Sau khi trễ ≥ 1 chu kỳ, vòng kế tiếp căn vào mốc lưới **tương lai**; không có vòng chạy dồn.
  - [ ] Counter `missed_ticks` bằng số mốc bị bỏ; log phút giữ ngữ nghĩa của T63-004.
  - [ ] Test: Fake MCU trả chậm 5/10/50 ms, tiêm kẹt scheduler; thứ tự lệnh output giữ nguyên; safe-timeout MCU 200 ms không bị kích hoạt ở tải bình thường.
  - [ ] Trên bo 30 phút: `catchup_iterations=0`; báo tỉ lệ IOP timeout và seq error trước/sau (**không** cam kết về 0).

#### T63-202 — Phân tích biên thời gian IOP (PERF-SYS-07)

- **Owner đề xuất:** FW-SOM + Architect. **NĐ:** 0,5. **Phụ thuộc:** T63-004.
- **Source ownership:** chỉ tài liệu (phụ lục của Plan này hoặc ghi chú trong Issue).
- **Tiêu chí chấp nhận:**
  - [ ] Phân bố `work` thực đo so với chu kỳ 2 ms và `IOP_RESP_TIMEOUT_MS=3`.
  - [ ] Khuyến nghị giữ hay đổi. Đổi hằng số IOP là đổi hợp đồng ⇒ **mở Issue + ADR riêng**, không làm trong Issue này.

#### T63-203 — Đưa ghi snapshot Core ra khỏi luồng quét (F-PRG-PERF-002)

- **Owner đề xuất:** FW-SOM/Core. **NĐ:** 1,5.
- **Source ownership:** `apps/core/bootstrap/main.cpp` (`after_scan`), `apps/core/adapters/persistence/state_snapshot.{hpp,cpp}`, hạ tầng worker hiện có trong `apps/core/application/runtime/` (`spsc_ring`, `latest_value_buffer`), test tương ứng.
- **Tiêu chí chấp nhận:**
  - [ ] Luồng quét chỉ bàn giao trạng thái cần lưu cho worker non-RT; không `open`/`write`/`fsync`/`rename` trên luồng quét (test khẳng định luồng gọi `save`).
  - [ ] Giữ trình tự `.tmp → fsync → rename → fsync thư mục` và flush khi SIGTERM (COR-010).
  - [ ] Worker chậm/treo không chặn luồng quét; bản mới thay bản chưa ghi.
  - [ ] Trên bo: `missedBaseStepCount` tăng 0, jitter Core ở phút có snapshot không cao hơn baseline.

#### T63-204 — A/B IRQ affinity cho Core (PERF-SYS-01, có điều kiện)

- **Owner đề xuất:** FW-SOM/BSP. **NĐ:** 1,5. **Cổng:** G-D4. **Phụ thuộc:** T63-005 còn vi phạm khi đo sạch.
- **Source ownership:** script/unit trong `platform/systemd/`. Không đổi kernel/governor.
- **Tiêu chí chấp nhận:**
  - [ ] Timeline IRQ/softirq chỉ ra nguồn gây trễ trước khi chỉnh.
  - [ ] Histogram trước/sau; throughput UART và Wi-Fi không giảm.
  - [ ] Chỉ claim C4 khi 24 giờ đo có kiểm soát ra 0 lần >100 µs.

### 4.4 W3 — Budget Program và Check/compile

#### T63-301 — Tái hiện cấu hình tối đa trên bo sạch (F-PRG-PERF-001)

- **Owner đề xuất:** QA + Programming Runtime. **NĐ:** 1,0.
- **Source ownership:** fixture/script trong `scripts/` hoặc `tests/`; evidence trong thư mục của T63-001.
- **Tiêu chí chấp nhận:**
  - [ ] Package 16 Program Enable × gần 4.096 instruction, chu kỳ 10 ms: Check chấp nhận hay không, và `budgetUs` từng Program.
  - [ ] Trên host sim và trên bo: thời gian thực thi Task so với 2.000 µs; thời điểm Task chuyển `FAULTED`.
  - [ ] Đọc Active trước khi thử và khôi phục đúng bản đó sau khi thử (ghi revision trước/sau).

#### T63-302 — Change Request: budget từng Program (F-PRG-PERF-001)

- **Owner đề xuất:** Architect + Programming Runtime. **NĐ:** 1,5. **Cổng:** G-D2.
- **Source ownership:** phụ lục ADR-061 hoặc ADR mới; cập nhật Detailed Design liên quan.
- **Nội dung bắt buộc:** đường đi `budget_us` package → coordinator → instance; đo thực thi từng Program; Program vượt budget bị xử lý thế nào so với luật `OD-PROG-012` (3 overrun ⇒ Task FAULT); Check tính admission theo WCET ước lượng hay chỉ chia trần.

#### T63-303 — Thi hành budget từng Program theo CR đã duyệt

- **Owner đề xuất:** Programming Runtime + BE. **NĐ:** 3,0. **Cổng:** G-D2. **Phụ thuộc:** T63-301, T63-302.
- **Source ownership:** `apps/core/application/programming/programming_runtime_coordinator.{hpp,cpp}`, `apps/core/application/st/st_scheduler.{hpp,cpp}`, `apps/core/application/st/st_package_v2.cpp`, `apps/web-api/internal/programming/application/checks_topology.go`, hợp đồng profile/schema/OpenAPI **trong cùng commit** với validator (luật ADR-061).
- **Tiêu chí chấp nhận:**
  - [ ] `budget_us` có trong `PackageProgramSlice` và `StProgramSetEntry`; test round-trip package → scheduler.
  - [ ] Hành vi vượt budget đúng CR; test chứng minh Program còn lại tiếp tục (nếu CR chọn cô lập).
  - [ ] Chạy lại T63-301 trên bo cho kết quả đúng CR.

#### T63-304 — Cache và giới hạn song song cho compile (F-PRG-PERF-004)

- **Owner đề xuất:** BE. **NĐ:** 2,5.
- **Source ownership:** `apps/web-api/internal/programming/compiler/runner.go`, `apps/web-api/internal/programming/application/checks.go` (+ test).
- **Tiêu chí chấp nhận:**
  - [ ] Khoá cache = hash source + library lock + profile + target ABI + hash binary compiler; cache hit trả artifact trùng byte.
  - [ ] Pool tối đa 2 worker trên SOM, ưu tiên CPU thấp hơn Core/IOBus; diagnostic giữ thứ tự tất định.
  - [ ] Trên bo: thời gian Check 32 Program lần đầu và lần lặp; jitter Core/IOBus trong lúc Check không xấu hơn baseline.

### 4.5 W4 — Deploy, đo lại và đóng hồ sơ

#### T63-401 — Deploy và đo sau thay đổi

- **Owner đề xuất:** DevOps + QA. **NĐ:** 2,0.
- **Tiêu chí chấp nhận:**
  - [ ] Deploy đủ core + iobus + web + tool ST theo DEPLOY_FOXLINX; read-back T63-002 **0 lệch**.
  - [ ] Chạy lại giao thức §6 (2 × 30 phút) và so với baseline T63-001 trong một bảng.
  - [ ] Soak 24 giờ nếu bo được cấp cửa sổ; nếu không, ghi `NOT_RUN` kèm lý do cụ thể.

#### T63-402 — Cập nhật hồ sơ và truy xuất

- **Owner đề xuất:** Tech Lead. **NĐ:** 0,5.
- **Tiêu chí chấp nhận:**
  - [ ] Record hiệu năng §14 và báo cáo PM §7 cập nhật trạng thái từng finding theo số đo mới.
  - [ ] Risk register (`RSK-PROG-001/002/003/005/019`) cập nhật residual có dẫn evidence.
  - [ ] Bảng §7 của Plan này đủ trạng thái cuối; `CHANGELOG.md` có mục tổng hợp.

### 4.6 Tổng hợp ước lượng

| Wave | Task | NĐ |
|---|---|---:|
| W0 | T63-001…005 | 7,0 |
| W1 | T63-101…110 | 9,75 |
| W2 | T63-201…204 | 5,5 |
| W3 | T63-301…304 | 8,0 |
| W4 | T63-401…402 | 2,5 |
| **Tổng** | **25 task** | **≈ 33** |

T63-204 (1,5 NĐ) chỉ phát sinh khi T63-005 còn vi phạm. Có thể chạy song song
W1 với W0 sau T63-001; W2 và W3 chờ cổng tương ứng.

---

## 5. Cổng quyết định trong Issue

Mỗi cổng được ghi bằng **một comment trên Issue** có dòng `GATE <mã>: APPROVED`
hoặc `REJECTED`, người duyệt và điều kiện kèm theo. Không có comment ⇒ task
phụ thuộc giữ `BLOCKED(<cổng>)`.

| Cổng | Trước task | Người duyệt | Đầu vào bắt buộc | Tương ứng phiếu PM |
|---|---|---|---|---|
| **G0** — duyệt Plan | Mọi task | PM + Tech Lead + QA | Plan này; Manager chuyển Issue sang `state:ready` sau G0 | D01, D06, D07 |
| **G-D1** — chính sách tick IOBus | T63-201 | FW-SOM + Architect + QA giao tiếp | Số đo T63-004, ghi chú thiết kế ≤ 1 trang: watchdog, thứ tự output, freshness | D03 |
| **G-D2** — CR budget Program | T63-303 | Product + Architect | T63-301 và bản CR T63-302 | Ngoài D01–D07 (finding 04/09) |
| **G-D3** — chính sách log/audit | T63-105/106/107 | Owner audit/Product + QA | Danh sách sự kiện giữ 100% và sự kiện được gộp | D05 |
| **G-D4** — chỉnh IRQ/BSP | T63-204 | FW-SOM/BSP + Architect | Histogram T63-005 đo sạch còn vi phạm | D04 |

**Trạng thái cổng (2026-09-28):** G0 **APPROVED** — chủ sở hữu dự án duyệt Plan 63
và cho bắt đầu implement, ghi trên Issue #809. G-D1, G-D2, G-D3, G-D4 **CHỜ**: đầu
vào bắt buộc của từng cổng chưa có.

Phương án cho D02 là **A — retry có deadline** (T63-101/102). Phương án B
(sampler dùng chung) chỉ mở Issue mới nếu T63-101 không đạt tiêu chí.

---

## 6. Giao thức đo trên bo

### 6.1 Điều kiện trước khi đo

- Ghi provenance (T63-002), PID và thời điểm khởi động từng service, nhiệt độ, governor, tần số CPU.
- Đọc Active revision **ngay trước** khi đo; không đổi Program/output của người dùng.
- Không chạy `journalctl`, `grep` log hoặc build trên bo trong cửa sổ đo.

### 6.2 Tải chuẩn

- Một trình duyệt mở dashboard suốt cửa sổ.
- Probe `/api/v1/points` 5 GET/s và `/api/v1/system/status` 1 GET/s từ host.
- Hai lượt × 30 phút, nghỉ 5 phút giữa hai lượt.

### 6.3 Metric và nguồn

| Metric | Nguồn |
|---|---|
| Core `jitterViolationCount`, `jitterMaxUs`, `missedBaseStepCount`, WCET, histogram (T63-005) | `/api/v1/programming/runtime`, log phút Core; histogram là dòng `core.wake_hist le25…gt500` — ô rời, theo phút (cộng `sum`), `sum(le200+le500+gt500)` phải bằng delta `core.jitter violations` |
| Core `seqlock_fail` | Log phút `core.jitter`, khoá `seqlock_fail` (tích luỹ theo tiến trình, lấy delta) — công bố từ T63-005 |
| IOBus `late_events`, `catchup_iterations`, `wake_late_max`, `work_max`, `io_resp_gap_max` (T63-004) | Log phút IOBus `iobus.loop_timing` — khoá theo phút: cộng `sum` cho `late_events`/`catchup_iterations`, lấy `max` cho `*_max_us`; `period_us` xác nhận chu kỳ hiệu lực |
| IOP timeout, seq error, CRC | Snapshot API, delta theo epoch |
| `/points` 200/503, p95 server | Log Web tổng hợp (T63-105) sau cửa sổ |
| Program/Task missed release, overrun | `/api/v1/programming/runtime` |
| CPU/RSS từng process, MemAvailable | `/proc` mỗi 5 s |
| eMMC write B/s và IOPS | `/proc/diskstats` |
| Số dòng log/giờ theo nguồn | journal thu sau cửa sổ |

Kết quả lưu JSON trong thư mục mới `forlinx-perf-remediation-<YYYYMMDD>/` dưới
[test-evidence/fw-som](../07_records/test-evidence/fw-som/), kèm script và SHA-256.

---

## 7. Ma trận truy xuất và theo dõi

Cột **Trạng thái** được cập nhật trong **cùng commit** với thay đổi của task.
Cột **Evidence** ghi đường dẫn hoặc số đo thật; để trống khi chưa có.

| Finding | Mức | Task | Kiểm chứng chính | Cổng | Trạng thái | Evidence |
|---|---|---|---|---|---|---|
| `F-PRG-PERF-001` | P0 | T63-301, T63-302, T63-303 | Tái hiện 16 Program @10 ms trên bo; test budget từng Program | G-D2 | T63-301 IN-PROGRESS — HOST: 16 × 4.095 @10 ms bị Check từ chối `ST-WORKER-CRASH` sau 61,8 s vì kết quả Check trần 1 MiB (finding [#815](https://github.com/Mekong-HCM/MK-DDC-24/issues/815)), không phải nhờ admission; lớn nhất còn qua 16 × 301, `budgetUs` 124, thực thi p95 63,4 µs; Active khôi phục đúng; TARGET NOT_RUN. T63-302 DONE — CR [ADR-063](../adr/ADR-063-programming-ngan-sach-tung-program.md) Proposed (khuyến nghị B2 quy lỗi + C2 cảnh báo admission), chờ G-D2. T63-303 BLOCKED(G-D2) | [evidence §6](../07_records/test-evidence/fw-som/forlinx-perf-remediation-20260928/README.md) · [ADR-063](../adr/ADR-063-programming-ngan-sach-tung-program.md) |
| `F-PRG-PERF-002` | P0 | T63-203 | Không I/O file trên luồng quét; missed step 0 | — | TODO | |
| `F-PRG-PERF-003` | — | — | Giữ `SEQUENTIAL` | — | N/A(NO-ACTION) | §2.1 |
| `F-PRG-PERF-004` | P2 | T63-304 | Check 32 Program lần đầu/lặp; jitter không xấu hơn | — | TODO | |
| `F-PRG-PERF-005` | P1 | T63-001 | Missed release +0 trong 2 × 30 phút | — | IN-PROGRESS — probe HOST PASS; đo TARGET NOT_RUN | [evidence](../07_records/test-evidence/fw-som/forlinx-perf-remediation-20260928/README.md) §1 |
| `F-PRG-PERF-006` | P1 | T63-001 | Period hiệu lực khớp khai báo | — | IN-PROGRESS — probe HOST PASS; đo TARGET NOT_RUN | [evidence](../07_records/test-evidence/fw-som/forlinx-perf-remediation-20260928/README.md) §1 |
| `F-PRG-PERF-007` | — | — | Bo cài sạch 27/09 | — | N/A(CLOSED) | §2.1 |
| `PERF-SYS-05` | P1 | T63-004, T63-201 | `catchup_iterations=0`; test Fake MCU trễ | G-D1 | IN-PROGRESS — T63-004 HOST PASS: log phút `iobus.loop_timing`; kẹt 16 ms (đồng hồ giả) ⇒ `late_events=1`, `catchup_iterations=24` (luật `overruns` cũ đếm 21); 0 cấp phát trong vòng poll; đo 30 phút TARGET NOT_RUN; T63-201 BLOCKED(G-D1) | `apps/iobus/tests/test_poll_loop_timing.cpp` |
| `PERF-SYS-07` | P2 | T63-004, T63-202 | Ghi chú biên thời gian IOP | — | IN-PROGRESS — T63-004 tách `work_max_us`/`io_resp_gap_max_us`/`period_us`; T63-202 khuyến nghị **giữ** hằng số IOP, điều kiện mở ADR ở Phụ lục A.4; phân bố `work` trên bo NOT_RUN; finding [#816](https://github.com/Mekong-HCM/MK-DDC-24/issues/816) | `apps/iobus/application/diagnostics/poll_loop_timing.hpp` · [Phụ lục A](#12-phụ-lục-a--biên-thời-gian-iop-t63-202-perf-sys-07) |
| `PERF-SYS-01` | P1 | T63-005, T63-204 | Histogram đo sạch; C4 | G-D4 | IN-PROGRESS — T63-005 HOST PASS: log phút `core.wake_hist le25…gt500` (ô rời, theo phút; tổng = `count`, ba ô trên 100 µs = vi phạm C4) và `seqlock_fail` tích luỹ ở cuối `core.jitter`; 0 cấp phát; overhead ≈ +2 ns/base step, `step()` không đổi; đo sạch 2 × 30 phút TARGET NOT_RUN ⇒ chưa quyết T63-204 N/A hay mở G-D4 | `apps/core/application/runtime/test_scan_loop.cpp` (`T63_005_*`) |
| `PERF-API-01` | P1 | T63-101, T63-102 | 0 × 503 trong 30 phút; p95 ≤ 20 ms | — | T63-101 IN-PROGRESS — reader Web thử lại theo deadline 1 ms, nhường CPU (Gosched rồi `nanosleep` 50 µs), hết hạn vẫn 503; counter `shm_reader` ở `/api/v1/system/status` (OpenAPI 1.48.0); HOST: giữ lẻ 50/200 µs ⇒ đọc được (p95 180/323 µs), giữ lẻ vô hạn ⇒ lỗi ở p50 1,03 ms, reader cũ FAIL 3/3; đo 30 phút TARGET NOT_RUN. T63-102 TODO (Lane FW) | `apps/web-api/internal/app/shm_reader_deadline_test.go`, `shm_reader_metrics_test.go` |
| `PERF-API-02` | P2 | T63-103 | p95 status < 20 ms, overview < 50 ms | — | TODO | |
| `PERF-API-03` | P2 | T63-105, T63-108 | Log −80%; GET −50%; freshness ≤ 1 s | G-D3 | TODO | |
| `PERF-SYS-03` | P2 | T63-106 | Audit read gộp; audit mutation 100% | G-D3 | TODO | |
| `PERF-SYS-02` | P2 | T63-107 | RTW log −90%; Wi-Fi ổn định | G-D3 | TODO | |
| `PERF-SYS-06` | P2 | T63-110 | Bảng nguồn ghi eMMC 24 giờ | — | IN-PROGRESS — lệnh `emmc`/`summarize-emmc` của probe (diskstats + `write_bytes` từng tiến trình 60 s, định danh chip/`life_time`, journald); selftest HOST PASS; đo 24 giờ và đối chiếu datasheet TARGET NOT_RUN | [evidence §7](../07_records/test-evidence/fw-som/forlinx-perf-remediation-20260928/README.md) |
| `PERF-FE-01` | P2 | T63-104 | Transfer cold load trước/sau; test header | — | TODO | |
| `PERF-FE-02` | P2 | T63-109 | Login không tải `charts` | — | TODO | |
| `PERF-PROV-01` | P2 | T63-002 | Read-back 0 lệch | — | IN-PROGRESS — `artifact-manifest.json` từng artifact + `deploy-record` + `readback`; selftest HOST 64/64 (gồm e2e `/proc` thật), `test_release_packaging_guard` 14/14; read-back TARGET NOT_RUN (container implementer không có TCP ra bo) | `python3 scripts/artifact_manifest.py selftest`; DEPLOY_FOXLINX bước 6b/7b |
| `PERF-SYS-04`, `PERF-API-04` | P3 | T63-003 | Trường window/epoch; test hợp đồng | — | TODO | |
| Baseline / đóng | — | T63-001, T63-401, T63-402 | So sánh trước/sau; hồ sơ cập nhật | G0 (APPROVED 2026-09-28) | T63-001 IN-PROGRESS — `scripts/forlinx_perf_probe.py` selftest HOST 34/34; baseline TARGET NOT_RUN (container implementer không có TCP ra bo); `seqlock_fail` Core nay được công bố ở `core.jitter` (T63-005), số trên bo NOT_RUN | [evidence](../07_records/test-evidence/fw-som/forlinx-perf-remediation-20260928/README.md) |

---

## 8. Cách thi hành trong một Issue và một PR

1. Implementer tạo nhánh `perf/forlinx-remediation-809` **từ `main`** (Plan này đã
   ở `main` từ 2026-09-28).
2. Mở PR ở chế độ draft ngay commit đầu, thân có `Closes #<số Issue>`,
   `Implementer-Run` và bảng Verification. PR chỉ chuyển ready khi đủ §10.
3. Commit tách theo task: `feat(iobus): T63-201 ...`, `fix(web-api): T63-101 ...`.
   Mỗi commit cập nhật dòng tương ứng ở §7.
4. Cuối mỗi wave, Implementer comment trên Issue: task đã xong, số đo, cổng
   tiếp theo. Rebase lên `main` sau mỗi wave để giảm xung đột.
5. Theo N1/N2 của WF-CLEAN-001: người tạo Issue không implement; Implementer
   không tự merge; Reviewer merge khi đủ bằng chứng.

---

## 9. Rủi ro và rollback

| Rủi ro | Giảm thiểu |
|---|---|
| PR rất lớn, khó review, dễ xung đột | Commit theo task, checkpoint mỗi wave trên Issue, rebase theo wave |
| Bỏ mốc IOBus làm giảm số giao dịch, dữ liệu cũ hơn | G-D1 chốt freshness; counter `missed_ticks`; test Fake MCU trễ |
| Worker snapshot làm mất trạng thái khi mất điện | Giữ trình tự ghi nguyên tử và flush khi SIGTERM; ghi rõ cửa sổ mất dữ liệu tối đa |
| Giảm log làm mất dấu vết điều tra | G-D3; giữ 100% lỗi/mutation/security; dòng tổng hợp có số đếm |
| Nén sẵn sai `Range`/`ETag` | Chỉ phục vụ `.gz` khi không có `Range`; test header; client không nén nhận identity |
| CR budget đổi ngữ nghĩa runtime | G-D2; không code trước khi duyệt |
| Deploy lệch SHM magic | Deploy iobus + core + web cùng lúc khi magic đổi; kiểm `/api/v1/points` sau deploy |
| Đo trên bo dùng chung | Đọc Active trước, khôi phục sau, không ghim cứng revision |

**Rollback:** theo DEPLOY_FOXLINX từng artifact, đối chiếu manifest T63-002.
Khi rollback Core phải kèm SQLite Programming tương ứng. Sau rollback chạy lại
read-back sha256 và `/api/v1/points`.

---

## 10. Definition of Done của Issue

- [ ] Mọi task ở §4 là `DONE` hoặc `N/A(<lý do có evidence>)`.
- [ ] Mọi cổng ở §5 có comment `GATE … APPROVED/REJECTED` trên Issue.
- [ ] Bảng Verification trong PR có số đo thật:
  - `cmake --fresh -S . -B build/fw -DCMAKE_BUILD_TYPE=Release -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON` → build → `ctest --test-dir build/fw --output-on-failure` (ghi exit code của cả configure và build);
  - `go vet ./...` và `go test ./... -count=1` trong `apps/web-api`;
  - `npx vitest --run --environment jsdom src`, `npm run lint`, `npm run build:release` trong `apps/web-ui`;
  - `scripts/verify-project.sh --component browser` và Chrome DevTools cho T63-104/108/109;
  - bảng trước/sau trên bo theo §6 (T63-001 và T63-401).
- [ ] Record hiệu năng, báo cáo PM, risk register và bảng §7 đã cập nhật.
- [ ] `CHANGELOG.md` `[Unreleased]` có mục tổng hợp kèm số đo.
- [ ] PR được Reviewer độc lập merge; Issue đóng qua `Closes`.

---

## 11. Ngoài phạm vi

| Hạng mục | Lý do |
|---|---|
| Bật lane `PARALLEL` | Target không cho lợi ích ổn định (`F-PRG-PERF-003`) |
| JIT trong Core | Thực thi CPU không phải nút thắt; tăng bề mặt an toàn |
| Kernel PREEMPT_RT, đổi governor | Chưa có số đo chứng minh cần; G-D4 chỉ cho phép IRQ affinity |
| Đổi hằng số IOP, chu kỳ poll 2 ms, baud | Đổi hợp đồng; cần ADR riêng (T63-202 chỉ khuyến nghị) |
| Giảm chi phí kiểm mật khẩu | Không đánh đổi bảo mật để login nhanh |
| HIL MCU/relay vật lý, power-cut | Cần phần cứng (#624); Fake MCU không thay thế |

---

## 12. Phụ lục A — Biên thời gian IOP (T63-202, `PERF-SYS-07`)

Chỉ phân tích và khuyến nghị. Plan này **không** đổi hằng số nào trong
`contracts/iop/iop_protocol.h` (§11).

### A.1 Ngân sách một giao dịch GET_IO theo thiết kế

| Thành phần | Giá trị | Nguồn |
|---|---:|---|
| Tốc độ dây | 921.600 baud, 8N1 = 92.160 B/s | `iop_protocol.h:41-47` |
| `GET_IO` 6 B | 65 µs | như trên |
| `IO_RESP` 80 B (4 + 74 + 2) | 868 µs | như trên, `IOP_IO_RESP_LEN = 74` |
| MCU xử lý (SPI DMA 2× ADS131M08 + dựng frame) | ≈ 500 µs, **ước lượng thiết kế** | như trên |
| **Tổng một giao dịch** | **≈ 1.430 µs** | con số "≈ 1,4 ms" ở record §14 là ước lượng này, không phải số đo |
| Chu kỳ poll `IOP_GET_IO_PERIOD_MS` | 2.000 µs, dư ≈ 570 µs (28,5%) | `iop_protocol.h:48` |
| `IOP_RESP_TIMEOUT_MS` | 3.000 µs, **dài hơn chu kỳ** | `iop_protocol.h:49` |
| Chặn tối đa một giao dịch lỗi | `(IOP_MAX_RETRY + 1) × timeout` = 4 × 3 = **12 ms** = 6 chu kỳ | `iop_client.cpp:168-197` |
| `IOP_FAULT_TIMEOUT_MS` / `IOP_SAFE_TIMEOUT_MS` | 20 ms / 200 ms | `iop_protocol.h:51,54` |

Lệnh output (`SET_DO`/`SET_AO`, mỗi lệnh chờ `ACK`) chạy trong cùng vòng poll nên
cộng thêm thời gian dây và độ trễ ACK của MCU. Vòng có output có thể vượt 2 ms mà
không cần lỗi nào.

### A.2 Số đo hiện có

| Nguồn | Mức | Số đo |
|---|---|---|
| Audit 28/09 (record §13.3) | TARGET, Fake MCU qua PTY | late-wake max 16,345 ms; p95/p99 max theo phút 14,007/15,972 ms; +510 overrun/150.004 wake; IOP timeout 161→163 (+2), **seq error 20.117→20.244 (+127)**, CRC 0; khoảng IO_RESP lớn nhất (lifetime) 22,17 ms |
| T63-004 `iobus.loop_timing` với `fake_mcu` qua PTY, 2 phút | HOST, container không RT | `work_max_us` 6.819–8.445, `io_resp_gap_max_us` 9.586–10.250 theo phút; **không đại diện** cho bo |
| T63-004 trên bo, 30 phút | TARGET | **NOT_RUN** — cần đường tới bo (evidence §3) |

Giới hạn mức bằng chứng: bo lab chạy IOBus với Fake MCU qua PTY (drop-in
`nomcu`), không qua dây UART 921.600 baud. Số TARGET vì vậy đo **đường phần mềm +
PTY**, không đo thời gian dây và xử lý của MCU thật. Muốn đo hai thứ đó cần HIL
(#624, ngoài phạm vi).

### A.3 Phân tích

1. Khi không có lỗi và không có output, dư 28,5% mỗi chu kỳ là đủ nhưng hẹp.
2. Timeout 3 ms dài hơn chu kỳ 2 ms, nên **một** lần timeout chắc chắn làm lỡ ít nhất
   một mốc. Có retry thì vòng poll bị chặn tới 12 ms (6 mốc). Với chính sách chạy bù
   hiện hành (§2.2 `PERF-SYS-05`), sau đó là một loạt `GET_IO` liên tiếp không
   nghỉ.
3. Giả thuyết cho seq error (+127) lớn hơn nhiều timeout (+2): frame trả lời của lần
   thử trước tới muộn, rơi vào lần thử sau hoặc vòng chạy bù kế tiếp, và bị đếm là
   lệch `SEQ` (`iop_client.cpp:84-85`). Kiểm chứng giả thuyết: so seq error/giờ trước
   và sau T63-201 (bỏ chạy bù) trên cùng bo, cùng tải §6.2.
4. Ở hằng số hợp đồng, chặn tối đa 12 ms vẫn < `IOP_FAULT_TIMEOUT_MS` 20 ms, còn safe
   200 ms của MCU cách xa. Nhưng gói release đóng `io_config.conf` với poll 10 ms và
   timeout 10 ms, nên chặn tối đa là 40 ms > 20 ms (finding
   [#816](https://github.com/Mekong-HCM/MK-DDC-24/issues/816), `state:triage`). Khoá
   `period_us` của T63-004 cho biết bo đang chạy chu kỳ nào.

### A.4 Khuyến nghị

1. **Giữ nguyên** mọi hằng số IOP: chu kỳ 2 ms, timeout 3 ms, retry 3, fault 20 ms,
   safe 200 ms. Chưa có số đo nào đòi đổi, và đổi là đổi hợp đồng.
2. Sửa cơ chế chạy bù trước (T63-201 sau G-D1), rồi đo lại seq error và
   `catchup_iterations` theo §6.
3. Điều kiện mở **Issue + ADR riêng** để đổi hằng số IOP, xét sau khi có T63-004 và
   T63-201 trên bo, đo sạch 2 × 30 phút:
   - `work_max_us` > 2.000 µs ở hơn 1% số phút; **hoặc**
   - seq error vẫn tăng sau T63-201; **hoặc**
   - `io_resp_gap_max_us` ≥ 20.000 µs ở bất kỳ phút nào.

   Phương án khi đó phải cân nhắc trong ADR: timeout ≤ chu kỳ, chu kỳ dài hơn, hoặc
   tách lệnh output khỏi lượt `GET_IO`.
4. Chốt giá trị gói release cho `io_config.conf` qua #816. Không làm trong Plan này.

| AC T63-202 | Trạng thái |
|---|---|
| Phân bố `work` thực đo so với 2 ms và `IOP_RESP_TIMEOUT_MS=3` | Công cụ đo có (T63-004); số TARGET **NOT_RUN** |
| Khuyến nghị giữ hay đổi; đổi thì mở Issue + ADR riêng | **Xong**: giữ, kèm điều kiện mở ADR ở A.4 |

## 13. Lịch sử sửa đổi

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 1.0 | 2026-09-28 | Tạo plan từ record hiệu năng §6/§13/§14 và báo cáo PM D01–D07: đối chiếu 21 finding (19 gốc + 2 mới) với mã tại `main@cb690dfb`, 25 task/5 wave, 5 cổng quyết định, giao thức đo, ma trận truy xuất; thi hành bằng một Issue #809 và một PR |
| 1.1 | 2026-09-28 | Chủ sở hữu dự án duyệt cổng G0 và cho bắt đầu implement; Plan đưa thẳng lên `main` theo yêu cầu, nhánh thi hành tách từ `main`; thêm mục "bắt đầu ngay được việc gì"; G-D1…G-D4 vẫn chờ |
| 1.2 | 2026-09-28 | Thi hành Issue #809 (PR #813): cập nhật tracker §7 theo từng commit task; thêm Phụ lục A §12 — biên thời gian IOP (T63-202); §6.3 ghi nguồn log `iobus.loop_timing` (T63-004) |
