# P1_EXIT_REVIEW — Scheduler Engine v3.1

> **Document ID:** DDC24-SCHD-P1-EXIT-2026-08-07
> **Ngày:** 2026-08-07 | **Nhánh:** `feat/scheduler-v3.1`
> **Căn cứ:** Phê duyệt PM/CTO 2026-08-07 — QĐ-7 `PA_1_APPROVED` · QĐ-8 `APPROVED` · QĐ-9 `PA_1_APPROVED`
> **Đầu vào:** [Review P1](SCHEDULER_V3_1_P1_REVIEW_2026-08-07.md) — 10 finding
> **Kết luận:** **9/10 finding đóng.** Cổng `MIGRATION_REAL_FILE` còn mở — chờ bản sao `schedule.conf` từ bo lab.

---

## 1. Trạng thái cổng

```text
P1_FINDINGS_CLOSED        = 9/10  (+ R-01-B phát hiện thêm, đã chặn — xem §4.1)
CPP_TESTS                 = PASS   830/830  (0 fail, 13,48 s)
GO_TESTS                  = PASS   11/11 gói (internal/app 27,8 s)
API_CONTRACT              = PASS   14 endpoint, 0 ref treo
DEPLOY_PACKAGING          = PASS   mkddc-schedule-sim đã vào deploy_board.sh
EXT_INTEGRATION_TEST      = PASS   3 test bắc qua ranh giới core↔SHM
MIGRATION_REAL_FILE       = BLOCKED  ← cần tệp từ bo lab (QĐ-8)

EXT_IMPLEMENTED           = YES
EXT_PHYSICAL_VERIFIED     = NO     ← theo đúng chỉ đạo CTO, tới khi plan 49 đóng HIL RS-485
PHYSICAL_IO_VERIFIED      = NO

P1_MERGE_APPROVED         = ĐỀ NGHỊ CÓ ĐIỀU KIỆN — xem §4
```

---

## 2. Mười finding: đã đóng thế nào

| # | Finding | Cách đóng | Bằng chứng |
|---|---|---|---|
| **P1-01** | Xoá lịch xoá luôn audit | `archiveScheduleState()` **đổi tên** thư mục sang `schedule.d/_deleted/<id>-<ts>/`. Không còn hàm nào xoá được audit — đó là chủ ý. | `TestScheduleDeleteArchivesAuditInsteadOfErasingIt` khẳng định còn đủ `CREATE`/`UPDATE`/`DELETE` sau khi xoá |
| **P1-02** | Target `EXT` không tới thiết bị | **`PointWriter`** — đường ghi dùng chung theo đúng kiến trúc CTO yêu cầu. `ScheduleRuntime` **không còn nhận `PointTable`**; chữ ký đổi thành `PointWriter&` nên compiler chặn mọi đường ghi riêng. | 3 test: `ScheduleWriteReachesModbusSetpointAndDirty`, `ReportsFailureWhenShmUnavailable`, `ReleaseDoesNotCommandTheDevice` |
| **P1-03** | Binary mô phỏng không lên bo | Thêm vào `SBIN_BINS`, bước `install`, và danh sách kiểm chứng sau deploy | `bash -n` sạch; 3 vị trí trong `deploy_board.sh` |
| **P1-04** | `next_transition` bỏ sót ngoại lệ tương lai | `exception_for_offset()` hỏi ngoại lệ cho **từng ngày phía trước**, theo đúng thứ tự exception → weekly | 3 test, gồm ca chọn đúng ngoại lệ priority cao hơn |
| **P1-05** | `POST` trả `null`, `GET` trả `[]` | Tách `normalizeSchedule(*ScheduleObject)` chuẩn hoá **tại chỗ** | `TestScheduleCreateResponseIsNormalizedLikeRead` |
| **P1-06** | `GET` (viewer) ghi tệp | Di trú thành bước khởi động tường minh `MigrateSchedulesOnStartup()`. Đường đọc gặp định dạng cũ trả **409 có giải thích**, không tự ghi | Test khẳng định `GET` trả 409 **trước** khi chạy di trú |
| **P1-07** | Ngủ khi giữ khoá toàn cục | Nhả `scheduleMutex` trước `Sleep`, lấy lại sau | Đọc mã; hành vi publish không đổi (test cũ vẫn xanh) |
| **P1-08** | `appliedCorrelations` rò rỉ | TTL 24 giờ + trần 512, dọn bản cũ nhất khi chạm trần | `TestScheduleCorrelationCacheIsBounded` |
| **P1-09** | Header phi-ASCII | Bỏ hẳn header; giao diện dùng cờ `migrated_from_v1` vốn đã có trong hợp đồng | `TestScheduleResponseHeadersAreAscii` quét **mọi** header |
| **P1-10** | Validate phụ thuộc `time.Now()` ẩn | `validateScheduleObjectAt(obj, now)`; đường HTTP bọc lại | `TestScheduleValidationIsDeterministic` so hai mốc cách nhau ~2 năm |

---

## 3. Kiến trúc EXT sau khi sửa — đúng chỉ đạo CTO

```
Nguồn điều khiển (Lịch · Web/lệnh tay · Logic)
        │
        ▼
   PointWriter          ← đường ghi DÙNG CHUNG, một chỗ duy nhất
        │
        ├──► PointTable                    (mọi point ảo)
        └──► plc_shm.ext[idx].setpoint
             plc_shm.ext[idx].dirty = 1    (chỉ EXT)
                    │
                    ▼
                 IOBus ──► Modbus RTU Device
```

**Không nguồn nào còn đường ghi riêng.** `ScheduleRuntime::evaluate()` đổi tham số từ
`PointTable&` sang `PointWriter&`, nên nếu ai đó thêm một nguồn mới mà quên đi qua đây thì
**không biên dịch được** — bắt ở lúc build thay vì lúc thiết bị không chạy.

`scan_loop` cũng bỏ đoạn ghi `ext[]` cục bộ của nhánh lệnh tay; nó gọi cùng `PointWriter`.
Trước đây chính đoạn đó là nơi duy nhất làm đủ hai bước, và đó là lý do lỗi tồn tại.

**Chưa kiểm chứng được:** đường từ SHM xuống thiết bị RS-485 thật. Plan 49 còn treo `G-C`
(slave RS-485 thật) và `G-D` (điều khiển hướng truyền). Vì vậy `EXT_PHYSICAL_VERIFIED = NO`
đúng như CTO chỉ định, và **không được tuyên bố khác** cho tới khi plan 49 đóng.

---

## 4. Cổng duy nhất còn mở: `MIGRATION_REAL_FILE`

### 4.0 Đã tự tìm đường tới bo — kết luận đã kiểm chứng

Không phải phỏng đoán. Đã thử hết bốn đường:

| Đường thử | Kết quả |
|---|---|
| SSH alias `SOM-DDC-24` (`mekong-fac.ddns.net:2222`, khoá `~/.ssh/mkddc24_som` có tồn tại) | `Connection timed out` sau 15 s |
| Ping bốn IP bo từng dùng (`192.168.1.18`, `.50`, `192.168.50.150`, `.161`) | Không IP nào phản hồi |
| Quét cổng 22 toàn dải `192.168.1.0/24` (máy này ở `192.168.1.200`) | **Chỉ chính máy này** mở SSH; bảng ARP chỉ có router `192.168.1.1` |
| Tìm bản chụp `schedule.conf` trong `archives/`, `audit-handover-2026-07-29/`, `docs/`, `logs/`, `output/` | Không có tệp nào |

Bo **không nằm trên mạng này** và DDNS không tới được — nhiều khả năng bo đang tắt hoặc ở
mạng nhà máy. Không có đường nào khác từ môi trường phát triển.

### 4.1 Phát hiện mới trong lúc phân tích: **R-01-B**

Không lấy được tệp, nên tôi đối chiếu **ngữ nghĩa** mô hình cũ với mô hình mới thay vì đối
chiếu dữ liệu. Việc đó lộ ra một khác biệt hành vi mà **so cấu hình trước/sau không nhìn thấy
được** — tức là dù có tệp thật, bài kiểm tra ở §4.2 cũng sẽ bỏ lọt.

Mô hình cũ **nhả quyền** ngoài khoảng giờ (`release_ao`/`release_do` trong `release_missing`,
xem `git show 5fef0b9:.../schedule_runtime.cpp`), nên mức 4 tắt và **logic nội bộ mức 5 điều
khiển được điểm đó**. Mô hình v3.1 luôn ghi một giá trị — weekly hoặc `schedule_default` — nên
mức 4 **giữ điểm suốt ngày và chặn mức 5**.

Đặc tả §10.1 bước 6 cố ý như vậy, nên **đây không phải lỗi**. Nhưng với một điểm đang được
*cả* lịch *lẫn* logic ST điều khiển, hành vi sau nâng cấp **sẽ khác** — và đó đúng là kịch bản
thường gặp ở công trình.

Kiểm chứng bằng test, không phải bằng lập luận:

```
ScheduleV31MigrationSemantics.ScheduleHoldsTargetOutsideHoursUnlikeOldModel   OK
ScheduleV31MigrationSemantics.DisablingRestoresOldOutOfHoursBehaviour         OK
```

Test thứ hai chỉ ra đường thoát: **tắt lịch thì mức 4 nhả ra**, logic mức 5 điều khiển lại được.
Đây chính là lý do bộ di trú đặt `enabled = false` cho mọi lịch — nâng cấp xong **không lịch nào
tự chiếm điểm** cho tới khi người dùng chủ động bật.

Đã bổ sung cảnh báo vào chính đầu ra của bộ di trú, và harness §4.2 nay **fail nếu thiếu cảnh
báo này**:

> LƯU Ý HÀNH VI: mô hình cũ nhả quyền điều khiển ngoài khoảng giờ, mô hình v3.1 giữ điểm ở giá
> trị mặc định suốt ngày. Điểm nào đang được cả lịch lẫn logic nội bộ điều khiển sẽ đổi hành vi
> sau khi bật lại lịch. Mọi lịch đang TẮT nên chưa có gì thay đổi cho tới khi bạn bật.

**Đánh giá lại rủi ro.** R-01 (mất cấu hình) vẫn cần tệp thật để đóng. Nhưng R-01-B (đổi hành
vi âm thầm) — thứ nguy hiểm hơn vì không ai đi tìm — nay đã được chặn bằng ba lớp: mọi lịch tắt
sau di trú, cảnh báo in ra, và test khoá hành vi lại để nó không đổi âm thầm về sau.

### 4.2 Công cụ đối chiếu dữ liệu

QĐ-8 duyệt cách làm: lấy **bản sao** `schedule.conf` từ bo lab, chạy di trú trong môi trường dev,
đối chiếu 100% lịch trước/sau, không đụng bo đang chạy.

**Đã dựng xong công cụ; còn thiếu đúng một thứ là tệp** (lý do ở §4.0).

Chạy khi có tệp — một lệnh:

```bash
MKDDC_REAL_SCHEDULE_CONF=/đường/dẫn/schedule.conf \
  go test ./internal/app/ -run TestMigrationAgainstRealBoardConfig -v
```

Công cụ kiểm 7 điều cho **từng** lịch: không mất lịch nào · trạng thái `DRAFT` + đang tắt ·
có cờ `migrated_from_v1` · target giữ đúng loại và kênh · mỗi ngày có đúng hai mốc (bật + trả
về mặc định) · số ngày khớp `weekdays` cũ · số ngoại lệ khớp số khoảng ngày lễ cũ. Cuối cùng
so **bit-với-bit** bản `.v1.bak` với tệp gốc.

Đã chạy thử trên tệp dựng giống cấu hình bo (2 lịch + 1 khoảng Tết, có cả target `VP`):

```
BẢN CŨ:  3 hàng (2 lịch thường + 1 khoảng ngày lễ)
BẢN MỚI: 2 Schedule Object
  ✓ SCH-001  AHU-01 Fan    BINARY, 1 target, 1 ngoại lệ
  ✓ SCH-002  Setpoint VP   REAL,   1 target, 1 ngoại lệ
Bản sao lưu: schedule.conf.v1.bak (659 byte, khớp bit-với-bit tệp gốc)
```

Không đặt biến môi trường thì test **SKIP** — và **SKIP không phải PASS**. R-01 chỉ đóng khi
lệnh trên chạy thật với tệp của bo.

> **Cần PM:** ai lấy giúp bản sao `/data/config/schedule.conf` từ bo lab. Chỉ cần một thao tác
> đọc, không cần dừng dịch vụ, không cần cửa sổ bảo trì:
>
> ```bash
> ssh SOM-DDC-24 'cat /data/config/schedule.conf' > schedule.conf.bo
> ```
>
> Bo hiện không tới được từ máy phát triển (§4.0) — cần người ở cùng mạng nhà máy, hoặc bật lại
> bo lab.

---

## 5. Số đo cổng ra (chạy 2026-08-07)

```
cmake -S . -B build/fw -DCMAKE_BUILD_TYPE=Release \
      -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON
ctest --test-dir build/fw               → 830/830 passed, 0 failed (13,48 s)
                                           (+8 so với trước review: 6 test ranh giới
                                            + 2 test khoá ngữ nghĩa di trú R-01-B)
core_tests --gtest_filter='ScheduleV31*' → 58/58 passed
[PERF] 64 lịch × 16 target               → 0,133 ms/vòng (ngưỡng đặc tả §21: 100 ms)

go vet ./... && go test ./... -count=1   → 11/11 gói PASS (internal/app 27,8 s)
bash -n tools/deploy/deploy_board.sh     → sạch
```

---

## 6. Đề nghị

**Cho merge P1 và khởi động P2**, với hai ràng buộc ghi thành văn bản:

1. `MIGRATION_REAL_FILE` phải đóng **trước khi deploy xuống bất kỳ bo nào** — kể cả bo lab.
   Merge vào `main` không tạo rủi ro cho cấu hình đang chạy; deploy mới tạo.
2. `EXT_PHYSICAL_VERIFIED = NO` giữ nguyên trong mọi tài liệu trạng thái cho tới khi plan 49
   đóng `G-C`/`G-D`. Không mục nào được viết như thể lập lịch cho điểm Modbus đã chạy trên
   thiết bị thật.
3. **R-01-B phải vào tài liệu bàn giao và runbook nâng cấp** (§4.1): sau nâng cấp, mọi lịch ở
   trạng thái tắt; khi bật lại, điểm nào đang dùng chung với logic ST sẽ đổi hành vi ngoài
   khoảng giờ. Đây là thứ kỹ thuật viên hiện trường phải biết trước, không phải phát hiện sau.

Nếu PM muốn chặt hơn — không merge cho tới khi có tệp từ bo — thì P2 lùi tương ứng; nhánh
`feat/scheduler-v3.1` đứng yên chờ, không phát sinh xung đột vì P2 chạm tầng khác.

---

## 7. Bài học mang sang P2

Ba finding mức Cao đều nằm ở **ranh giới giữa các tầng**, và 822 test cũ không chạm tới ranh
giới nào. Đợt này bổ sung 6 test bắc qua ranh giới (core↔SHM, API↔hệ thống tệp, build↔deploy).
P2 phải giữ đúng nếp đó: mỗi khi một tầng hứa một khả năng, phải có một test đi hết đường xuống
tầng thực hiện nó — không dừng ở biên của tầng mình.

---

## Revision History

| Phiên bản | Ngày | Người | Nội dung |
|---|---|---|---|
| 1.0 | 2026-08-07 | Nhóm Phần mềm | P1_EXIT_REVIEW: 9/10 finding đóng, `MIGRATION_REAL_FILE` chờ tệp từ bo lab |
