# Repository Layout Boundary Fix — Closeout

**Ngày:** 2026-08-20 · **Baseline:** `ca1495b` → đóng tại `7018b0d` · **Phạm vi:** dependency boundary của `apps/web-ui`
**Trạng thái:** ✅ **CLOSED — VERIFIED** (Owner đóng 2026-08-20)

---

## 1. Baseline

Tái lập trên cây sạch `main` (`ca1495b`), trước mọi thay đổi:

```
$ python3 tools/restructure/verify_repository.py
LỖI: vi phạm dependency boundary:   (10 mục)
VERIFY_EXIT=1
```

`repository-layout` = **FAIL**. CI job này đã đỏ một thời gian mà không ai xử lý;
`project_ci_billing_blocked_20260817` giải thích vì sao không ai thấy.

---

## 2. Root Cause

Hai nguyên nhân độc lập, không liên quan nhau:

### 2.1 — Xung đột thật giữa hai bất biến (8/10 vi phạm)

`verify_repository.py` yêu cầu import chéo feature phải đi qua barrel
(`../features/x`, không phải `../features/x/Foo`).

Nhưng khi **cùng một barrel** vừa được import tĩnh vừa được import động, rollup
gộp chunk và `lazy()` mất tác dụng — nó báo đúng bằng
`INEFFECTIVE_DYNAMIC_IMPORT`. Tác giả trước đã gặp đúng việc này và né bằng cách
deep-import thẳng vào tệp nguồn, **có ghi lý do ngay trong `App.tsx`**:

> *"Trỏ THẲNG vào tệp nguồn, không qua barrel `index.ts`: cùng một barrel vừa
> được import tĩnh (AlarmsPage) vừa import động sẽ khiến bundler gộp lại và
> `lazy` mất tác dụng."*

Cách né đó đúng về bundling nhưng phá ranh giới kiến trúc. **Hai bất biến xung
đột thật, và bất biến kiến trúc là bên thua trong im lặng.**

### 2.2 — Luật đo sai thứ nó tuyên bố đo (1/10 vi phạm)

Luật *"Web UI không chạm contract C/SHM/IOP"* quét **toàn văn tệp**, nên không
phân biệt được phụ thuộc thật với chú thích truy vết.
`features/scheduler/shared.ts:26` chỉ ghi:

```ts
/** Trần kênh theo loại điểm, khớp contracts/shm/mkddc_shm.h. */
```

Đây là thứ `DOC_GOVERNANCE` **khuyến khích**, và nó bị tính là vi phạm. Phần
thưởng ngược: cách "sửa" duy nhất là xoá chú thích, làm mã khó truy vết hơn mà
không an toàn hơn chút nào.

### 2.3 — Vi phạm còn lại (1/10)

`route-menu-contract.test.ts` deep-import `../features/auth/roles` trong khi
`features/auth/index.ts` đã export sẵn `ROUTE_MIN_ROLE`. Thuần tuý bỏ sót.

---

## 3. 10 Violations Found

| # | Source file | Illegal import | Expected boundary | Required fix |
|---|---|---|---|---|
| 1 | `app/App.tsx` | `../features/operations/AlarmsPage` (AlarmsPage) | `../features/operations` | lazy qua barrel |
| 2 | `app/App.tsx` | `../features/operations/AlarmsPage` (AlarmHistoryPage) | `../features/operations` | lazy qua barrel |
| 3 | `app/App.tsx` | `../features/operations/AlarmSettingsPage` | `../features/operations` | lazy qua barrel |
| 4 | `app/App.tsx` | `../features/operations/TrendsPage` | `../features/operations` | lazy qua barrel |
| 5 | `app/App.tsx` | `../features/scheduler/SchedulerLayout` | `../features/scheduler` | lazy qua barrel |
| 6 | `app/App.tsx` | `../features/scheduler/SchedulerGridPage` | `../features/scheduler` | lazy qua barrel |
| 7 | `app/App.tsx` | `../features/scheduler/ScheduleEditorPage` | `../features/scheduler` | lazy qua barrel |
| 8 | `app/App.tsx` | `../features/scheduler/SchedulerRuntimePage` | `../features/scheduler` | lazy qua barrel |
| 9 | `app/route-menu-contract.test.ts` | `../features/auth/roles` | `../features/auth` | đổi sang barrel |
| 10 | `features/scheduler/shared.ts` | *(không có import — chú thích truy vết)* | — | sửa luật để đo code |

Vi phạm #4 thực chất là hệ quả của #1–#3: chính vì ba trang Cảnh báo được import
**tĩnh** mà `TrendsPage` không thể đi qua barrel.

---

## 4. Architecture Decision

**Quy tắc một chiều cho mỗi feature tại ranh giới `app/`: hoặc TOÀN BỘ tĩnh, hoặc
TOÀN BỘ động — không trộn trên cùng một barrel.**

Lời giải không phải chọn giữa "ranh giới" và "code-splitting" mà là **bỏ điều
kiện gây xung đột**. Khi một feature không còn import tĩnh nào ở `App.tsx`,
barrel chỉ được chạm qua `import()` động, nên rollup giữ nguyên chunk riêng —
`lazy()` hoạt động **và** ranh giới được tôn trọng.

Đây không phải phát minh mới: `modbus-rtu` đã dùng đúng mô hình này từ trước, có
ghi chú ngay trong `App.tsx` (*"Modbus RTU không có import tĩnh nào ở đây nên
barrel dùng được"*). Thay đổi này chỉ mở rộng mô hình đã được chấp nhận sang ba
feature còn lại.

Hệ quả có chủ ý: ba trang Cảnh báo chuyển từ eager sang lazy. Chúng nằm trong
`<Suspense fallback={<RouteLoading />}>` sẵn có nên hành vi điều hướng không đổi,
và chunk chính **nhẹ đi** vì cả feature rời khỏi đồ thị khởi động.

Với §2.2, luật được sửa để **đo đúng thứ nó tuyên bố đo**: bỏ comment trước khi
so khớp. Đây **không phải** nới lỏng — chuỗi ký tự vẫn được giữ nguyên, nên
import động / `fetch` / worker URL trỏ tới contract vẫn bị bắt. Bốn test âm khoá
cả hai chiều (§10).

---

## 5. Files Changed

| File | Loại |
|---|---|
| `apps/web-ui/src/features/programming/index.ts` | **mới** — public API |
| `apps/web-ui/src/app/App.tsx` | rewire import + ghi lại lý do kiến trúc |
| `apps/web-ui/src/app/route-menu-contract.test.ts` | rewire import |
| `tools/restructure/verify_repository.py` | `strip_ts_comments()` + luật đo trên code |
| `tests/integration/test_repository_dependency_guard.py` | +4 test âm |
| `tests/integration/test_programming_error_catalog.py` | sửa 2 số đếm đã cũ |

---

## 6. Public APIs Added

`features/programming/index.ts` — feature duy nhất chưa có barrel.

```ts
export { ProgrammingRoutes } from './ProgrammingRoutes'
```

Chỉ export thứ thật sự dùng ngoài feature. `design/`, `fbd/`, `runtime/`,
`commission/`, `overview/`, `model/`, `api/`, `shared/` ở lại sau ranh giới.
**Cố ý không dùng `export * from`** — re-export toàn bộ biến barrel thành cửa mở
và ranh giới chỉ còn trên giấy.

Ba feature còn lại (`operations`, `scheduler`, `auth`) **đã có** barrel export
đúng thứ cần; không phải sửa, chỉ cần dùng.

---

## 7. App Import Rewiring

```
File: apps/web-ui/src/app/App.tsx
Old dependency: import tĩnh ../features/operations/AlarmsPage
                import tĩnh ../features/operations/AlarmSettingsPage
                import động ../features/operations/TrendsPage
New dependency: import động ../features/operations (cả 4 trang)
Reason:         bỏ import tĩnh để barrel chỉ còn đường động ⇒ lazy giữ nguyên
                tác dụng VÀ ranh giới được tôn trọng
Test/evidence:  build không còn INEFFECTIVE_DYNAMIC_IMPORT (grep = 0);
                operations.js không nằm trong preload của index.html
```

```
File: apps/web-ui/src/app/App.tsx
Old dependency: import động ../features/scheduler/{4 tệp nguồn}
New dependency: import động ../features/scheduler
Reason:         không có import tĩnh nào ⇒ barrel dùng được ngay
Test/evidence:  scheduler.js là chunk riêng, không preload; e2e scheduler 7/7
```

```
File: apps/web-ui/src/app/App.tsx
Old dependency: import động ../features/programming/ProgrammingRoutes
New dependency: import động ../features/programming
Reason:         đi qua public API mới
Test/evidence:  programming.js 200.99 kB (trước 200.97 kB) — không đổi thực chất
```

```
File: apps/web-ui/src/app/route-menu-contract.test.ts
Old dependency: ../features/auth/roles
New dependency: ../features/auth
Reason:         barrel đã export ROUTE_MIN_ROLE
Test/evidence:  vitest 1061/1061
```

---

## 8. scheduler/shared Fix

```
File: tools/restructure/verify_repository.py
Old dependency: re.search(CONTRACT_PATTERN, content)          # toàn văn tệp
New dependency: re.search(CONTRACT_PATTERN, strip_ts_comments(content))
Reason:         luật tuyên bố cấm PHỤ THUỘC, nhưng đang bắt cả CHÚ THÍCH.
                `features/scheduler/shared.ts` không hề import gì từ contracts/ —
                nó chỉ ghi nguồn của hằng số cho người đọc.
Test/evidence:  4 test âm mới; 6 ca kiểm thủ công gồm import động và chuỗi ký tự
```

**Không** sửa `scheduler/shared.ts`: chú thích truy vết được giữ nguyên vì nó có
giá trị thật. **Không** thêm whitelist, **không** thêm exception, **không** di
chuyển tệp để né luật.

Ma trận hành vi của luật sau khi sửa:

| Nội dung tệp | Trước | Sau | Đúng? |
|---|---|---|---|
| `/* khớp contracts/shm/mkddc_shm.h */` | REJECT | accept | ✅ chú thích không phải phụ thuộc |
| `// xem contracts/iop/iop_protocol.h` | REJECT | accept | ✅ |
| `import x from '../contracts/shm/mkddc_shm.h'` | REJECT | **REJECT** | ✅ vẫn bắt |
| `const u = 'contracts/iop/iop_protocol.h'` | REJECT | **REJECT** | ✅ chuỗi vẫn bắt |
| `await import('../contracts/shm/x')` | REJECT | **REJECT** | ✅ import động vẫn bắt |
| chú thích hợp lệ **+** import thật | REJECT | **REJECT** | ✅ không che được code |

---

## 9. run_layout Verification

Thứ tự đã bổ sung ở PR #221 được **giữ nguyên**:

```
packaging guard  →  layout checks
```

Xác nhận trong log: `Ran 3 tests ... OK` (guard đóng gói) xuất hiện **trước**
`PASS: repository manifest hợp lệ`. AC-13 đạt.

Thứ tự này đã chứng minh giá trị ngay trong chính task này: sau khi 10 vi phạm
boundary được sửa, **hai lớp lỗi khác lộ ra** mà trước đó bị `set -e` cắt mất
(§12). Đó đúng là hiện tượng §8 của đề bài cảnh báo.

---

## 10. Tests Executed

| Bộ | Lệnh | Kết quả |
|---|---|---|
| Dependency boundary | `python3 tools/restructure/verify_repository.py` | **PASS** (10 → 0) |
| Guard boundary (âm) | `test_repository_dependency_guard.py` | **9/9 pass** (5 cũ + 4 mới) |
| Guard đóng gói | `test_release_packaging_guard.py` | **3/3 pass** |
| Contract authority | `test_repository_contract_guard.py` | **2/2 pass** |
| Error catalog | `test_programming_error_catalog.py` | **6/6 pass** |
| FE typecheck | `npx tsc --noEmit` | **exit 0** |
| FE unit | `npx vitest --run --environment jsdom src` | **1061/1061**, 111 file |
| FE lint | `npm run lint` | **exit 0** |
| FE production build | `npm run build` | **exit 0**, 0 cảnh báo `INEFFECTIVE_DYNAMIC_IMPORT` |
| E2E trình duyệt thật | `verify-project.sh --component e2e` | **8 spec, 61 passed**, exit 0 |
| Circular dependency | `npx madge --circular` | 1 — **có sẵn**, không phải mới |

**Kiểm chứng lazy-loading (AC-07/§7 của đề bài):** không chunk feature nào nằm
trong preload của `index.html`.

| Chunk | Preloaded? |
|---|---|
| `operations.js` | 0 ✅ |
| `scheduler.js` | 0 ✅ |
| `programming.js` | 0 ✅ |
| `modbus-rtu.js` | 0 ✅ |

---

## 11. Before / After

| Metric | Before | After |
|---|---:|---:|
| Layout violations | 10 | **0** |
| `repository-layout` (dependency boundary) | FAIL | **PASS** |
| `repository-layout` (toàn gate) | FAIL | **FAIL** — chặn khác, xem §12 |
| Illegal App deep imports | 8 | **0** |
| Scheduler boundary violations | 1 | **0** |
| Test deep import (`route-menu-contract`) | 1 | **0** |
| FE typecheck | — | **PASS** |
| FE build | — | **PASS** |
| FE unit | 1061 | **1061** |
| E2E | 61 | **61** |
| Circular dependency | 1 | 1 (không mới) |

**Chunk và code-splitting:**

| Chunk | Before | After |
|---|---:|---:|
| `index.js` (bundle chính) | 573.22 kB | **567.21 kB** ↓ |
| `operations` | *(nằm trong index.js)* + `TrendsPage` 27.58 kB | `operations.js` **93.80 kB** (lazy) |
| `scheduler` | 4 chunk rời (82.99 kB) | `scheduler.js` **89.69 kB** (lazy) |
| `programming` | `ProgrammingRoutes.js` 200.97 kB | `programming.js` **200.99 kB** |

Bundle chính **nhẹ đi 6 kB** vì feature `operations` rời khỏi đồ thị khởi động.

---

## 12. Remaining Findings

> Theo §5 của đề bài: ghi finding → backlog riêng → **không** kéo vào task này.

### F-LAYOUT-01 — `repository-layout` còn một lớp chặn thứ hai *(P1 — ĐÃ CHUYỂN GIAO)*

> **Disposition (Owner, 2026-08-20):** `OUT OF SCOPE` với task boundary. Chuyển
> sang [`TASK-PROG-G1-CONTRACT-REPIN-001`](../../03_implementation/TASK-PROG-G1-CONTRACT-REPIN-001.md).
> Trong báo cáo audit `REV-PROG-IMPL-SPEC-ROADMAP-2026-08-20` cùng hạng mục này
> mang mã `PRG-CON-001` / `GAP-C-01` — **cùng một việc, ba tên gọi**.

Sau khi sửa xong 10 vi phạm boundary, `set -e` chạy tiếp và lộ ra
`verify_programming_g1_contracts.py` **FAIL 10 mục**: SHA-256 drift của
`openapi`/`errors`/`store`, `OpenAPI version drift`, `detail error count lệch`,
`store schema version drift`…

**Đã kiểm chứng là có sẵn hoàn toàn**, không do đợt này gây ra: chạy đúng script
đó trên worktree tại `1abbff6` (trước cả PR #221) cho **y hệt 10 dòng FAIL**.

Nguyên nhân: `contracts/programming/g1_contract_join_v1.json` được ghim ngày
**2026-08-11** (`3e5281d`), sau đó bốn commit đổi contract landed mà không
re-pin:

| Commit | Ngày | Contract bị đổi |
|---|---|---|
| `c2f3189` | 2026-08-13 | store manifest — `schemaVersion` 4→5, migration mới |
| `4b2b877` | 2026-08-14 | `openapi.yaml` → `1.20.0` (pin còn `1.19.0`) |
| `37a9d41` | 2026-08-14 | error catalog, bump 1.4.0→1.5.0 |
| `d118f7a` | 2026-08-15 | error catalog, +4 detail code |

**Vì sao KHÔNG sửa trong task này:**

1. Đây không phải dependency boundary — nó là **contract governance**, ngoài
   phạm vi §5 của đề bài.
2. `g1_contract_join_v1.json` là **artifact có chữ ký review**
   ([`PROGRAMMING_G1_CONTRACT_REVIEW_20260811`](PROGRAMMING_G1_CONTRACT_REVIEW_20260811.md)
   ghi phán quyết compatibility theo từng contract). Re-pin = ra một phán quyết
   compatibility mới, gồm cả việc chấp nhận **store schema 4→5**.
3. Quyết định nhất: `require(store_manifest["schemaVersion"] == 4, ...)` là hằng
   số **nằm trong chính script kiểm**, không phải trong file ghim. Muốn gate
   xanh thì phải **sửa hằng số của luật** — đúng thứ AC-06 và §4 của đề bài cấm
   ("không được sửa rule để hợp thức hoá", "không thêm exception chỉ để gate
   xanh").

**Cần gì để mở khoá:** một vòng G1 contract review có người ký, xác nhận
compatibility cho ba contract đã đổi, rồi re-pin `g1_contract_join_v1.json` **và**
cập nhật hằng số `schemaVersion` trong validator — **trong cùng một change-set**.

**Làm rõ quan trọng (Owner, 2026-08-20):** sau khi compatibility review kết luận
`ACCEPT`, việc đổi `require(store_manifest["schemaVersion"] == 4)` sang schema mới
**không còn là "sửa rule để hợp thức hoá"** — nó là cập nhật validator để phản ánh
**contract baseline mới đã được duyệt**. Điều kiện bắt buộc: re-pin artifact và
đổi validator phải nằm **cùng một PR**, không được đổi riêng một bên.

### F-LAYOUT-02 — Test error catalog dùng số đếm cũ *(đã sửa trong task này)*

`test_programming_error_catalog.py` ghim `19 public / 77 detail` trong khi thực
tế là `20 / 104`. Catalog lớn lên hợp lệ qua `37a9d41` và `d118f7a` nhưng test
không cập nhật kèm. Sửa luôn vì nó chặn ngay bước sau boundary và không mang ý
nghĩa governance (bất biến thật do `generate_programming_errors.py --check`
canh, và bước đó đang PASS).

### F-LAYOUT-03 — Circular dependency có sẵn *(P2, backlog)*

`features/programming/layout/ProgrammingLayout.tsx ↔ ProgrammingContextBar.tsx`.
Đã kiểm chứng tồn tại y hệt trên cây sạch trước mọi thay đổi. Không nằm trong
phạm vi task; ghi lại để xử lý riêng.

---

## 13. Acceptance Criteria

| AC | Nội dung | Trạng thái | Bằng chứng |
|---|---|---|---|
| AC-01 | Baseline gate đỏ tái lập được | ✅ | `VERIFY_EXIT=1`, 10 vi phạm tại `ca1495b` |
| AC-02 | Đủ 10 violation được trace | ✅ | §3 — bảng đầy đủ 10 dòng |
| AC-03 | Feature có public API hợp lệ | ✅ | `programming/index.ts` mới; 3 barrel còn lại đã đúng |
| AC-04 | `App.tsx` hết illegal deep import | ✅ | 8 → 0 |
| AC-05 | `scheduler/shared.ts` hết vi phạm | ✅ | luật nay đo code; chú thích được giữ |
| AC-06 | Không thêm whitelist/exception | ✅ | luật **chặt hơn**; 4 test âm chứng minh vẫn bắt import thật |
| AC-07 | `repository-layout` = PASS | ✅ **cho phạm vi boundary** — phần còn lại **chuyển giao** | Boundary checks PASS. Phần gate còn đỏ thuộc `verify_programming_g1_contracts.py`, đã chuyển sang `TASK-PROG-G1-CONTRACT-REPIN-001` theo quyết định Owner 2026-08-20 |
| AC-08 | FE typecheck = PASS | ✅ | `TSC_EXIT=0` |
| AC-09 | FE production build = PASS | ✅ | `BUILD_EXIT=0` |
| AC-10 | Affected tests = PASS | ✅ | vitest 1061, e2e 61, 20 integration test |
| AC-11 | Không có circular mới | ✅ | madge: 1, có sẵn (`F-LAYOUT-03`) |
| AC-12 | Không đổi behavior ngoài import | ✅ | route không đổi, e2e 61/61, lazy giữ nguyên |
| AC-13 | `run_layout` giữ đúng thứ tự guard | ✅ | guard đóng gói chạy trước trong log |
| AC-14 | Clean tree reproduce toàn bộ PASS | ✅ | §10 chạy trên cây sạch sau cùng |

**14/14 đạt trong phạm vi task.**

AC-07 ban đầu được viết là *"`repository-layout` = PASS"* cho **toàn** gate. Khi
sửa xong boundary, `set -e` chạy tiếp và lộ ra một lớp lỗi thứ hai hoàn toàn độc
lập (`F-LAYOUT-01`) — lỗi contract governance, không phải dependency boundary, và
đã tồn tại từ 2026-08-11.

**Quyết định Owner 2026-08-20:** không giữ một task đã hoàn thành 100 % phạm vi
kỹ thuật ở trạng thái OPEN chỉ vì pipeline phía sau nó vừa lộ thêm một lỗi độc
lập — làm vậy là **trộn hai phạm vi khác nhau**. AC-07 vì thế được đọc theo đúng
phạm vi task: **boundary checks PASS**; phần còn lại **chuyển giao có địa chỉ**
sang `TASK-PROG-G1-CONTRACT-REPIN-001`.

Đây là **chuyển giao**, không phải miễn trừ: blocker vẫn được ghi đầy đủ ở §12,
có owner, có quy trình quyết định, và vẫn chặn `RELEASE_READY`.

---

## 14. Final Status

```text
FINAL STATUS

Repository dependency-boundary scope: CLOSED — VERIFIED
repository-layout boundary checks:    PASS
Violations:                           0
Regression:                           PASS

Downstream pre-existing blocker:
verify_programming_g1_contracts.py — FAIL (10)
Disposition:
OUT OF SCOPE / transferred to TASK-PROG-G1-CONTRACT-REPIN-001
```

### 14.1 Cơ sở của việc đóng

| Tiêu chí | Kết quả |
|---|---|
| Dependency boundary violations | **10 → 0** |
| Illegal deep imports (`App.tsx`) | **8 → 0** |
| Scheduler false-positive / boundary violation | **1 → 0** |
| `verify_repository.py` | **PASS** |
| Boundary guard (`test_repository_dependency_guard.py`) | **9/9** |
| `npx tsc --noEmit` | **PASS** |
| FE production build | **PASS** |
| FE unit | **1061/1061 PASS** |
| E2E | **61/61 PASS** |
| Circular dependency mới | **0** (1 mục có sẵn → `F-LAYOUT-03`) |
| Lazy-loading | **giữ đúng** — không chunk feature nào bị preload |

### 14.2 Bản sửa scanner được GIỮ NGUYÊN

Quyết định Owner 2026-08-20: **không rollback**. Luật cũ quét comment như code và
sinh false positive. Bản sửa strip comment nhưng **vẫn bắt** import tĩnh, import
động, chuỗi ký tự (fetch / worker URL) — và hành vi đó được **khoá bằng test âm**,
gồm ca "chú thích hợp lệ + import thật trong cùng tệp vẫn phải đỏ". Đây là làm
luật **đo đúng thứ nó tuyên bố đo**, không phải nới lỏng.

### 14.3 Ranh giới với task kế tiếp

`verify_programming_g1_contracts.py` **không phải phần tiếp theo của task này**.
Nó là một quyết định **compatibility** (Store contract đã đổi schema 4 → 5), cần
authority ký, và được theo dõi riêng tại
[`TASK-PROG-G1-CONTRACT-REPIN-001`](../../03_implementation/TASK-PROG-G1-CONTRACT-REPIN-001.md).

`F-LAYOUT-03` (circular dependency có sẵn) tiếp tục là **backlog riêng**, không
được kéo vào task G1.
