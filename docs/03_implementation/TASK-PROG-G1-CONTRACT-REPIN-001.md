# TASK-PROG-G1-CONTRACT-REPIN-001 — G1 Contract Compatibility Review & Re-pin

| Thuộc tính | Giá trị |
|---|---|
| ID | `TASK-PROG-G1-CONTRACT-REPIN-001` |
| Bí danh | `PRG-CON-001` (backlog audit `REV-PROG-IMPL-SPEC-ROADMAP-2026-08-20`) · `GAP-C-01` · `F-LAYOUT-01` |
| Loại | Contract governance — **compatibility decision**, không phải cleanup script |
| Mở ngày | 2026-08-20 (quyết định Owner) |
| Nguồn | Chuyển giao từ [`REPOSITORY_LAYOUT_BOUNDARY_FIX_CLOSEOUT`](../07_records/reviews/REPOSITORY_LAYOUT_BOUNDARY_FIX_CLOSEOUT.md) §12 |
| Trạng thái | **OPEN — chờ authority** |
| Owner | Architect + Compiler Lead + BE Lead (**cần chữ ký**) |
| Baseline đo | `7018b0d`, cây làm việc sạch |
| Ưu tiên | **P0** — là nguyên nhân **duy nhất** còn giữ cổng `repository-layout` đỏ trên `main` |

> **Đây KHÔNG phải phần tiếp theo của task dependency-boundary.** Task đó đã
> `CLOSED — VERIFIED`. Việc ở đây là một quyết định compatibility ở cấp contract,
> có owner và evidence riêng.

---

## 1. Vấn đề

`scripts/verify_programming_g1_contracts.py` trả **exit 1** với **10 dòng FAIL**,
ở cả chế độ thường lẫn `--self-test`. Vì `run_layout` dùng `set -euo pipefail`,
nó làm đỏ toàn bộ cổng `repository-layout`.

`contracts/programming/g1_contract_join_v1.json` là **artifact ghim có chữ ký
review** — bản ghi phán quyết compatibility tại
[`PROGRAMMING_G1_CONTRACT_REVIEW_20260811`](../07_records/reviews/PROGRAMMING_G1_CONTRACT_REVIEW_20260811.md).
Nó được ghim lần cuối **2026-08-11** (`3e5281d`). Sau đó **bốn commit đổi contract
mà không re-pin**.

### 1.1 Vì sao không ai thấy suốt 9 ngày

Hai lớp che nhau:

1. `run_layout` dừng ở `verify_repository.py` (10 vi phạm dependency boundary) →
   `set -e` cắt mọi bước phía sau, gồm bước G1.
2. CI GitHub Actions **chết vì billing** từ 2026-08-17 (0/40 run khởi chạy), nên
   ngay cả khi cổng đỏ cũng không ai bị chặn merge.

PR #222 đã gỡ lớp 1. Lớp G1 nay lộ ra và là thứ **duy nhất** còn đỏ.

---

## 2. Ba contract đã đổi sau pin 2026-08-11

| Contract | SHA-256 ghim | SHA-256 thực tế | Trạng thái |
|---|---|---|---|
| `openapi` | `0941b7f11014…` | `a4452d091ee3…` | **DRIFT** |
| `ipc` | `d18702bc1f69…` | `d18702bc1f69…` | ok |
| `profile` | `94c58ffa552f…` | `94c58ffa552f…` | ok |
| `artifact` | `f39ede1fce04…` | `f39ede1fce04…` | ok |
| `errors` | `9b6337a0ed18…` | `a2fc10a8d1e8…` | **DRIFT** |
| `store` | `9eeb7cc0e39e…` | `4381c0c04fe1…` | **DRIFT** |
| `source-bundle` | `ee8545b0c20b…` | `ee8545b0c20b…` | ok |

### 2.1 Drift ngữ nghĩa kèm theo

| Kiểm tra | Ghim / yêu cầu | Thực tế |
|---|---|---|
| OpenAPI `info.version` | `1.19.0` | **`1.20.0`** |
| `errors.publicErrorCount` | `20` | `20` — **khớp** |
| `errors.componentDetailCount` | `80` | **`104`** |
| `store.migrationPath` | `…/0004_bundle_receipts.sql` | tồn tại **`0005_operation_coordinator.sql`** |
| `store.migrationSha256` | `430a1ea77912…` | manifest ghi `e0e2020afced…` |
| `store_manifest.schemaVersion` (**hardcode trong validator**) | `4` | **`5`** |

### 2.2 Truy nguyên bằng `git log`

| Commit | Ngày | Đổi gì |
|---|---|---|
| `c2f3189` | 2026-08-13 | Commission/Restore bền vững — store manifest `schemaVersion` 4→5, migration `0005` |
| `4b2b877` | 2026-08-14 | Nối Monitor + Trace — `openapi.yaml` lên `1.20.0` |
| `37a9d41` | 2026-08-14 | Thêm `ST-IOMAP-008` vào error catalog, bump `1.4.0`→`1.5.0` |
| `d118f7a` | 2026-08-15 | Đăng ký 4 detail code IPC `RETAIN_RESET` |

Cả bốn đều là commit **đã review và đã merge**. Đây là drift **quy trình** (quên
re-pin), không phải thay đổi lén lút.

### 2.3 Nhân chứng cho thấy "hai nguồn sự thật"

`generate_programming_errors.py --check` in ra:

```text
PASS: error catalog 20 public / 104 detail / SHA-256 a2fc10a8…
```

Trong khi `g1_contract_join_v1.json` vẫn ghim `componentDetailCount: 80` và SHA cũ
`9b6337a0…`. PR #222 đã sửa đúng con số ở `test_programming_error_catalog.py`
(19/77 → 20/104) — **nhưng file ghim thì chưa**. Cùng một con số, hai nguồn, chỉ
một nguồn được cập nhật.

---

## 3. Vì sao KHÔNG được sửa bằng máy trước khi có review

Hai lý do, cả hai đều mang tính nguyên tắc:

1. **`require(store_manifest["schemaVersion"] == 4, …)` là hằng số nằm trong
   chính validator**, không phải trong file ghim. Sửa nó **trước** khi có phán
   quyết compatibility = "sửa rule để hợp thức hoá" — làm gate xanh bằng cách đổi
   thứ đang kiểm.
2. **`g1_contract_join_v1.json` là artifact có chữ ký review.** Re-pin = **ra một
   phán quyết compatibility mới**, gồm việc chấp nhận Store contract đổi schema
   **4 → 5**. Máy không tự phê duyệt được thay đổi contract của chính nó.

> **Làm rõ (Owner, 2026-08-20):** *sau* khi compatibility review kết luận
> `ACCEPT`, việc cập nhật hằng số validator sang schema mới **không còn** là "sửa
> rule để hợp thức hoá" — nó là cập nhật validator để phản ánh **contract baseline
> mới đã được duyệt**. Ràng buộc bắt buộc: **re-pin artifact và đổi validator phải
> nằm cùng một change-set/PR**, không được đổi riêng một bên.

---

## 4. Quy trình bắt buộc

```text
3 changed contracts
        ↓
Diff old pinned vs current
        ↓
Classify compatibility
        ↓
Store schema 4 → 5 review
        ↓
Decision
   ┌────┴─────┐
ACCEPT       REJECT
   ↓            ↓
Re-pin       Restore/fix contract
   ↓
Update validator expectation
   ↓
Regenerate review/hash/signature evidence
   ↓
verify_programming_g1_contracts.py
   ↓
run_layout
   ↓
GREEN
```

### 4.1 Bước chi tiết

| # | Bước | Đầu ra |
|---|---|---|
| 1 | Diff `openapi` / `errors` / `store` giữa bản ghim 2026-08-11 và bản hiện tại | Bảng thay đổi theo từng contract |
| 2 | Phân loại từng thay đổi: `COMPATIBLE` / `BREAKING` / `ADDITIVE` | Ma trận compatibility |
| 3 | **Review riêng Store schema 4 → 5** — có migration `0005_operation_coordinator.sql`; đánh giá đường nâng cấp, rollback, và dữ liệu đang chạy trên bo | Phán quyết Store |
| 4 | Quyết định `ACCEPT` hoặc `REJECT` | Biên bản có chữ ký |
| 5a | Nếu `ACCEPT` → re-pin `g1_contract_join_v1.json` **và** cập nhật hằng số validator trong **cùng PR** | Diff một change-set |
| 5b | Nếu `REJECT` → khôi phục/sửa contract vi phạm | Contract quay về baseline |
| 6 | Sinh lại evidence review/hash | Review record mới |
| 7 | Chạy `verify_programming_g1_contracts.py` (cả `--self-test`) | exit 0 |
| 8 | Chạy `scripts/verify-project.sh --component layout` | exit 0 |

---

## 5. Acceptance Criteria

| AC | Nội dung |
|---|---|
| AC-G1-01 | Có bảng diff đầy đủ cho cả ba contract `openapi` / `errors` / `store` giữa pin 2026-08-11 và hiện tại |
| AC-G1-02 | Mỗi thay đổi được phân loại `COMPATIBLE` / `BREAKING` / `ADDITIVE`, có lý do |
| AC-G1-03 | Store schema 4 → 5 có phán quyết riêng, nêu rõ đường nâng cấp và ảnh hưởng tới dữ liệu đang chạy |
| AC-G1-04 | Quyết định `ACCEPT`/`REJECT` được ghi trong review record **có chữ ký người thật** |
| AC-G1-05 | Nếu `ACCEPT`: `g1_contract_join_v1.json` re-pin **và** hằng số validator cập nhật **trong cùng một PR** |
| AC-G1-06 | `verify_programming_g1_contracts.py` **exit 0** ở cả chế độ thường lẫn `--self-test` |
| AC-G1-07 | `scripts/verify-project.sh --component layout` **exit 0** |
| AC-G1-08 | Không nới lỏng validator để đạt kết quả: mọi drift **chưa được duyệt** vẫn phải làm gate đỏ |
| AC-G1-09 | Review record mới thay thế `PROGRAMMING_G1_CONTRACT_REVIEW_20260811` làm baseline compatibility hiện hành |
| AC-G1-10 | Không kéo `F-LAYOUT-03` (circular dependency có sẵn) hay bất kỳ finding nào khác vào task này |

---

## 6. Ngoài phạm vi

- **`F-LAYOUT-03`** — circular dependency `ProgrammingLayout.tsx ↔ ProgrammingContextBar.tsx`. Backlog riêng (`PRG-FE-036`).
- **Dependency boundary** — đã đóng ở `TASK: REPOSITORY_LAYOUT_BOUNDARY_FIX`, **không** mở lại.
- **Bản sửa scanner comment** trong `verify_repository.py` — Owner đã chốt **không rollback**; không thuộc phạm vi review này.
- **Billing CI** (`PRG-OPS-001`) — blocker hạ tầng riêng.

---

## 7. Chống tái phát

Drift này sinh ra vì **không có gì buộc re-pin cùng lúc với đổi contract**. Sau
khi task đóng, cân nhắc `TD-02`/`TD-03` trong audit:

- Sinh `g1_contract_join_v1.json` **tự động** từ các contract nguồn thay vì ghim tay.
- Bỏ hardcode `schemaVersion` khỏi validator; đọc từ chính file ghim, để chỉ còn
  **một** nguồn sự thật.
- Cân nhắc guard: PR đụng `contracts/programming/*` mà không đụng file ghim thì đỏ.

---

## 8. Lịch sử

| Rev | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-08-20 | Mở task theo quyết định Owner; chuyển giao từ `F-LAYOUT-01`. Ghi đầy đủ dữ liệu drift đo tại `7018b0d`. |
