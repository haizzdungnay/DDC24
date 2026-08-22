# Release Record Programming — quyết định `NO-GO` ngày 2026-08-23

| Thuộc tính | Giá trị |
|---|---|
| ID | `PROG-RELEASE-RECORD-2026-08-23` |
| Phiên bản | 1.0 |
| Trạng thái | Active |
| Task | `T59-707` |
| RC commit | `main@29c59ec` (sau khi merge `T59-607`) |
| Khoá ký đang dùng | Ed25519, fingerprint `fdb9a30eea28b026` — **khoá LAB**, không phải khoá hãng |
| Người ký | Release Owner (vai CTO/Product Owner, theo `PROMPT-PLAN59-CTO-W6W7`) |
| **Verdict** | **NO-GO** |

## 1. Vì sao có bản ghi này

`T59-707` không phải "chạy thêm một bộ test". Nó là chỗ duy nhất tổng hợp mọi
disposition lại và buộc một câu trả lời có/không. Một plan đóng hết task vẫn có
thể là `NO-GO`; và ghi `NO-GO` đúng lúc có giá trị hơn một `GO` dựa trên ô trống.

## 2. Cổng W7 — `scripts/verify-project.sh --wave W7`

| Cổng | Mức | Kết quả | Thời gian |
|---|---|---|---|
| `layout` | HOST | PASS | 3,2 s |
| `cpp` | HOST | PASS — `ctest` 1227/1227 | 104,0 s |
| `go` | HOST | PASS | 37,7 s |
| `frontend` | HOST | PASS | 54,0 s |
| `e2e` | HOST | PASS — 79/79 | 30,7 s |
| `e2e-real` | HOST | PASS — 1/1 | 52,3 s |
| `firmware` | HOST | PASS | 0,1 s |
| `release-package` | HOST | PASS | 76,6 s |
| `docs` | HOST | PASS | 0,1 s |
| `candidate-pin` | HOST | PASS sau khi phát hành manifest 1.42 | 0,0 s |
| `github-ci` | CI | **NOT_RUN** | — |
| `target-soak` | TARGET | **NOT_RUN** | — |
| `physical-io` | HIL | **NOT_RUN** | — |
| `power-retain` | TARGET | **NOT_RUN** | — |

**10 PASS / 0 FAIL / 4 NOT_RUN trên 14 cổng.** Không có `NOT_RUN` im lặng: cả
bốn đều có chủ, runbook và điều kiện mở ghi ở Plan 59 §3 bảng W7.

## 3. Disposition 12 scenario Product (`VS-PROG-U01..U12`)

| Scenario | Nội dung | Disposition | Mức đạt được |
|---|---|---|---|
| `U01` | ST/FBD user FUNCTION, pure equivalence | **PASS** | HOST — corpus 40/40 entry hai chiều (`T59-601`) |
| `U02` | 100 FB instance, state/RETAIN riêng | **PASS** | HOST — unit/loader |
| `U03` | Control Library CRUD/version/DAG/RBAC | **PASS** | HOST — store + REST + import thù địch (`T59-201..204`, `T59-603`) |
| `U04` | Boundary 32 Program / 16 Enabled | **PASS** | HOST — one-over reject ổn định |
| `U05` | 10 Program, 3 chu kỳ, 24 h trên target | **NOT_RUN** | — chặn: `T59-702` |
| `U06` | Published Signal snapshot/freshness | **PASS (một phần)** | HOST — không torn read, stale policy; producer fault trên target thuộc `U05` |
| `U07` | Enable/Disable FE→BE→Core | **PASS** | HOST — RBAC/idempotency/audit/read-back (`T59-405`, `T59-603`) |
| `U08` | Package Commission/LKG/power matrix | **PASS (một phần)** | HOST — barrier chu kỳ đầu và rollback mức gói (`T59-501`); ma trận cắt nguồn thật thuộc `T59-704` |
| `U09` | ST và FBD physical output HIL | **NOT_RUN** | — chặn: `T59-703` |
| `U10` | Six-workspace real-backend E2E | **PASS** | HOST — lane `e2e-real` 1/1, không mock Programming |
| `U11` | Trace/load/soak 24 h, poll gap <200 ms | **NOT_RUN** | — chặn: `T59-702` |
| `U12` | PID Controls/Safety | **NOT_RUN** | — chặn: `T59-706` (và `T59-703`); PID giữ nhãn `REVIEW_REQUIRED` |

## 4. Must của release — bảng quyết định

| Must | Trạng thái | Ghi chú |
|---|---|---|
| SIGNED artifact, không còn đường `HASH_ONLY` | **ĐẠT (HOST + TARGET)** | `T59-607`: profile 2.1 `SIGNATURE_REQUIRED`; trên bo thật compile có khoá cho `SIGNED`, không khoá bị `ST-CLI-KEY-REQUIRED` |
| Provenance | **ĐẠT (HOST)** | `provenance.json` + SBOM 92 component + reproducible build (`T59-606`) |
| Fresh install / upgrade / rollback | **ĐẠT một phần** | dry-run 12/12 và **cài đè thật trên bo 2026-08-23**; thay controller còn thiếu (cần bo thứ hai) |
| Physical AO/DO cho **cả ST và FBD** | **KHÔNG ĐẠT** | `T59-703` — bo chạy `mkddc-fake-mcu`, không có MCU thật và không có thiết bị đo |
| 10-Program 24 h trên target | **KHÔNG ĐẠT** | `T59-702` |
| Power-cut / RETAIN / LKG | **KHÔNG ĐẠT** | `T59-704` — cần nguồn cắt được |

Bốn Must đầu không đủ để bù ba Must sau. Theo `PROMPT-PLAN59-CTO-W6W7` mục
"Giới hạn quyền", nhóm Must này **không được waive** — thiếu là `NO-GO`, không
có ngoại lệ.

## 5. Quyết định

**`NO-GO`.** Ký ngày 2026-08-23, Release Owner.

Sản phẩm đã sẵn sàng ở mức HOST và đã chứng minh được đường ký, đường cài đặt và
vòng đời Programming trên bo thật. Cái còn thiếu **không phải là code**: là ba
lớp bằng chứng cần phần cứng và thời gian thực (I/O vật lý đo bằng instrument,
24 giờ chạy liên tục, và cắt nguồn thật).

## 6. Điều kiện mở `GO`

| # | Điều kiện | Chủ |
|---|---|---|
| 1 | 12 job CI chạy thật và xanh trên RC commit | `T59-701` |
| 2 | Soak 24 h, 3 chu kỳ, không poll gap ≥200 ms trên bo | `T59-702` |
| 3 | AO/DO đo bằng instrument cho **cả** ST và FBD, đủ đường safety | `T59-703` |
| 4 | ≥10 lần cắt nguồn, RETAIN/LKG/enable-intent phục hồi đúng | `T59-704` |
| 5 | Thay controller + backup/restore trên dữ liệu vận hành | `T59-705` |
| 6 | Review Controls/Safety cho PID trên target, có approval token | `T59-706` |
| 7 | Khoá ký **của hãng** thay khoá LAB, giữ trong HSM | Release Owner |

Khi cả bảy mục có evidence được review, bản ghi này được thay bằng một release
record mới — **không** sửa verdict tại chỗ.
