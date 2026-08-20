# Plan 59 — Triển khai Product Programming thống nhất đến Release

| Thuộc tính | Giá trị |
|---|---|
| ID | `PLAN-PROG-059` |
| Phiên bản | 2.0 |
| Trạng thái | **Active — PLAN_READY / IMPLEMENT_READY** |
| Ngày | 2026-08-20 |
| Chủ quản | Product Owner/CTO + System Architect + Dev Lead |
| Authority | Product v3.0; ADR-050; `AUTH-PROG-2026-08-20-04` |
| Detailed Design | [`DDD-SW-PROG-UNIFIED-001`](../02_design/software/PROGRAMMING_UNIFIED_PRODUCT_DETAILED_DESIGN.md) |
| Supersedes | Plan 53, Plan 54, Plan 56 và `PROGRAMMING_IMPLEMENTATION_TRACKER.md` về công việc tương lai |
| Release gate | Chỉ mở bằng fresh CI/target/HIL/physical-I/O/soak/provenance/rollback evidence |

## 0. Mục tiêu và cách đọc

Plan này đưa **một** Product Programming từ As-Built hiện tại tới ứng dụng có thể
release. Không chia Rev A/Rev B và không đẩy capability cốt lõi sang roadmap khác.

Kết quả cuối:

- nhiều Program độc lập, tối đa 16 Enabled;
- `PROGRAM`, `FUNCTION`, `FUNCTION_BLOCK` bằng ST/FBD;
- Control Library chuẩn + user-defined có version;
- Published Signal typed/fresh giữa Program;
- Check/Commission/Enable/Disable/Runtime/LKG/RETAIN/audit hoàn chỉnh;
- Output Candidate đi hết safety path tới I/O vật lý;
- package, fresh install, upgrade, rollback, soak và release evidence có authority.

### 0.1 Trạng thái task

| Trạng thái | Ý nghĩa |
|---|---|
| `DONE` | Code/docs/test/evidence acceptance của task đã có và kiểm lại. |
| `READY` | Đủ design/decision để bắt đầu ngay. |
| `ORDERED` | Đã thiết kế xong; tự chuyển READY khi task dependency DONE, không cần approval mới. |
| `EVIDENCE_QUEUE` | Implementation đã/đang làm; chạy khi có lab/target window. Không chặn task code độc lập. |
| `REVIEW` | Code complete, đang review/fix finding trong cùng task. |

**Không dùng trạng thái `BLOCKED` cho task implementation trong plan.** Thiếu
hardware/credential/CI là resource/evidence queue, không phải lý do dừng các Wave
code còn làm được. `RELEASE_READY` vẫn `NO-GO` tới khi evidence thật đủ.

## 1. Baseline và nguyên tắc thực thi

### 1.1 Baseline

- Source baseline khi lập plan: `49a2ad1`.
- As-Built mạnh: ST/FBD built-in compiler/runtime host; atomic one-Program
  Commission/LKG; RETAIN; 25 route Programming; bốn workspace; host suites.
- Migration gap: profile/check/bootstrap một Program; user POU/library/signal và
  product enable path chưa có; MB_RTU binding bị compiler reject; target output
  physical chưa có verdict.

### 1.2 Luật không thương lượng

1. Contract/generator trước consumer; một nguồn sự thật, exact equality guard.
2. Mỗi task gồm code + positive/negative/fault test + docs/trace/changelog.
3. Không sửa acceptance để biến test fail thành PASS.
4. Không shared writable cross-Program; không direct I/O; không FE/BE làm authority
   runtime/safety.
5. Mỗi output binding có một Program owner; conflict fail Check.
6. Active/LKG không đổi khi Check/stage/activation/enable thất bại.
7. Host/browser mock không thay target/HIL/electrical evidence.
8. Review hậu kiểm phát hiện lỗi thuộc task phải sửa trước merge task đó; không mở
   decision blocker mới khi DDD đã khóa semantics.

## 2. Roadmap và critical path

```text
W0 Contract/Migration foundation
 ├─→ W1 POU + Artifact v2 ─→ W2 Control Library ─┐
 ├─→ W3 Multi-Program Project/Check/Mapping ─────┤
 └───────────────────────────────────────────────┴→ W4 Runtime/Scheduler/Signal
                                                     → W5 Lifecycle + FE/BE E2E
                                                     → W6 Hardening/Packaging
                                                     → W7 Target/HIL/V&V/Release
```

W1/W2/W3 có thể chạy song song theo contract boundary. Critical path release là
`T59-001 → T59-006 → T59-106 → T59-305 → T59-406 → T59-501 → T59-602 → T59-703 → T59-707`.

| Wave | Mục tiêu | Entry | Exit |
|---|---|---|---|
| W0 | Contract/generator/store migration v2 và local gate xanh | Plan này Active | G1/layout/compat/generator/store migration PASS |
| W1 | POU ST/FBD + artifact v2 | W0 contract | PROGRAM/FUNCTION/FB compile/load/runtime host PASS |
| W2 | Control Library end-to-end | W0 + registry W1 | SYSTEM/PROJECT library CRUD/version/use/negative E2E PASS |
| W3 | Multi-Program package/check/mapping | W0 + artifact skeleton | 32/16 boundary, MB_RTU binding, conflict check, package deterministic PASS |
| W4 | Runtime scheduler/signal/enable/output/retain/trace | W1+W3 | 10-Program host fixture + fault/restart/operation tests PASS |
| W5 | Atomic lifecycle + sáu-workspace product flow | W2+W4 | Real-backend E2E Draft→Commission→Enable→Runtime→Disable/Restore PASS |
| W6 | Security/performance/package/release candidate | W5 | RC reproducible; all host gates + install/upgrade/rollback dry-run PASS |
| W7 | Target/HIL/V&V/release | RC W6 | Required Test Result PASS, residual accepted, release GO record |

## 3. Bảng nhiệm vụ master

### W0 — Contract và migration foundation

| Task | Priority | Việc làm / source chính | Dependency | Status | Acceptance |
|---|---|---|---|---|---|
| `T59-001` | P0 | Re-pin `g1_contract_join_v1.json`, bỏ hardcode store schema version | — | **DONE** | `verify_programming_g1_contracts.py` exit 0; `--self-test` 12/12 mutation + 6/6 manifest chain + 5/5 deploy order; `verify-project.sh --component layout` exit 0; `go vet` sạch + `go test ./... -count=1` 18/18 package ok. Chi tiết §3.1. |
| `T59-002` | P0 | Tạo Product profile v2 `32/16/256/1024/512/512`, generator C++/Go/TS | — | **DONE** | `generate_programming_profile.py --check` exact 3/3 tệp sinh; one-over vector C++ 3 trục + Go 6 case + FE 5 case; `ctest` 1055/1055; `go test ./... -count=1` 18/18; FE 112 file / 1066 test; G1 self-test 20/20 mutation; layout exit 0. **Đính chính:** `npm run build` khi merge thực tế FAIL (`tsc --noEmit`), đã sửa trong `T59-003`. Chi tiết §3.1. |
| `T59-003` | P0 | FBD/POU/library registry JSON single-source + generator | — | **DONE** | `generate_programming_library_registry.py --check` 40 entry / 2 tệp sinh; 7 test C++ hai chiều chống entry ma; 5 test FE palette↔registry; G1 self-test 25/25; `ctest` 1063/1063; Go 18/18; FE 112 file / 1071 test; layout exit 0. Chi tiết §3.1. |
| `T59-004` | P0 | Error catalog mới cho POU/library/signal/enable/output owner/PID review | T59-002/003 | **DONE** | catalog v1.6.0 **26 public / 118 detail**, sinh Go/C++/TS + manifest exact. **Đính chính:** sáu mã gộp ở task này tự đặt sai bộ tên `DDD` §5.2 đã khóa; `T59-006` thay bằng đúng mười mã.  guard detail **hai chiều** và catalog được validate theo schema; `ctest` 1064/1064; Go 18/18; FE 113 file / 1073 test; layout exit 0. Chi tiết §3.1. |
| `T59-005` | P0 | Store schema v2 + backup/migration v1→v2 | T59-002 | **DONE** | migration `0006_product_model_v2.sql`, schema v5→v6, 5 bảng mới + 3 cột Revision; atomic ở **3/3** điểm lỗi, idempotent qua **3** vòng restart, 0 hàng Commission/intent sau migration, 5 nhóm bất biến bảng mới; Go 18/18; G1 8/8 + self-test 25/25; layout exit 0. Chi tiết §3.1. |
| `T59-006` | P0 | OpenAPI + IPC v2 + artifact/package schema v2, dual-reader policy | T59-002/004 | **DONE** | artifact v2 schema + dual-reader policy thành contract G1 thứ 9/10; guard action IPC **hai chiều** (self-test 4/4); catalog v1.7.0 **30/120** theo đúng bộ tên DDD §5.2; OpenAPI v1.22; `ctest` 1065/1065; Go 18/18; FE 113 file / 1073 test; G1 10/10 + self-test 28/28; layout exit 0. Chi tiết §3.1. |
| `T59-007` | P1 | Local CI parity wrapper và gate matrix cho từng Wave | T59-001 | **DONE** | `verify-project.sh --wave W0..W7` chạy đúng bộ cổng và in bảng tổng kết; ma trận là contract có schema + self-test 8/8; cổng CI/target/HIL luôn `NOT_RUN` kèm runbook và chủ; W0 **4/4 PASS**, W7 **8 PASS / 4 NOT_RUN**. Chi tiết §3.1. |

### 3.1 Ghi chú thực thi W0

#### `T59-001` — Re-pin join G1 và bỏ hardcode schema version

**Triệu chứng.** `scripts/verify_programming_g1_contracts.py` báo 10 FAIL và giữ
gate `layout` đỏ, trong khi mọi contract bị tố "drift" đều là bản hợp lệ đã merge.

**Nguyên nhân gốc.** Hai lớp khác nhau bị trộn vào cùng một verifier:

1. *Pin lạc hậu* — `g1_contract_join_v1.json` còn ghim OpenAPI `1.19.0`, error
   catalog 80 componentDetail, store head migration `0004`, golden manifest cũ.
2. *Hardcode trong code kiểm* — `store_manifest["schemaVersion"] == 4`,
   `publicErrorCount == 20`, `componentDetailCount == 80`, `operationCount == 25`.
   Những literal này nhân bản pin vào validator, nên mọi thay đổi contract hợp lệ
   đều làm gate đỏ và buộc sửa code kiểm thay vì sửa dữ liệu ghim.

**Cách sửa.**

- Re-pin toàn bộ 7 contract trong `contracts/programming/g1_contract_join_v1.json`;
  thêm `schemaVersion` và `migrationDir` cho contract `store`.
- Validator lấy mọi số đếm/version từ pin trong join, không còn literal; error
  count so ba chiều catalog ↔ manifest ↔ pin.
- Thêm `validate_migration_chain()`: chuỗi migration phải liên tục `1..N`, mọi file
  khai báo tồn tại đúng SHA-256, head trùng cả pin lẫn `migrationFile`, và thư mục
  không chứa `.sql` nằm ngoài manifest.
- Self-test đổi từ "có bị reject không" sang "bị reject **đúng lý do**" (khoá mảnh
  thông điệp), thêm 7 mutation mới cho đúng các giá trị vừa bỏ hardcode.

**Finding sửa kèm trong task.** `TestProgrammingStoreContractManifest`
(`apps/web-api/internal/programming/store/store_test.go`) hardcode tên head
migration `"0005_operation_coordinator.sql"` và **không** so `schemaVersion` của
manifest với `CurrentSchemaVersion` — cùng lớp lỗi, cho phép contract manifest và
code Go trôi khỏi nhau mà test vẫn xanh. Đã đổi sang suy ra head từ
`embeddedMigrations()` và đối chiếu từng entry manifest với checksum embed.

**Kiểm chứng negative thật (host).** Sửa tạm `schemaVersion` 5 → 4 trong contract
manifest: Go báo `schema version lệch: manifest=4 code=5`, Python báo
`store schema version drift: manifest=4 pin=5` + `schemaVersion 4 không bằng
migration cuối 5`. Đã khôi phục nguyên trạng, `git diff` sạch trên file đó.

**Rollback.** Chỉ chạm contract pin + script kiểm + test; không đổi schema DB,
không migration mới, không chạm Active/LKG. Revert commit là đủ.

**Evidence level.** Host/local. Không phải GitHub CI, không phải target/HIL.

#### `T59-002` — Product profile v2 và generator ba ngôn ngữ

**Triệu chứng.** Capacity sản phẩm bị khoá ở một Program: `kMaxProgramsTotal=1`,
Go `len(programs) != 1`, diagnostic `"limit": 1`, và FE/Go chép tay `profileId`,
`profileSha256`, trần FBD.

**Nguyên nhân gốc.** Profile machine-readable chỉ sinh **một** consumer (C++).
Go và TS đọc cùng contract nhưng bằng literal chép tay, nên ba lớp không có phép
kiểm nào ràng buộc lại với nhau; đồng thời `task.maxTasks/maxProgramsPerTask/
maxProgramsTotal` bị khoá `const 1` ngay trong JSON Schema.

**Cách sửa.**

- `contracts/programming/product_profile_v2.json` + schema thay
  `rev_a_profile_v1.*`: khối `capacity` cấp package `32/16/256/1024/512/512`,
  khối `scheduler` (3 lớp chu kỳ, 32 Program, budget `<20%`), khối `resources`
  giữ trần cấp **một** Program, thêm `targetAbi`.
- `scripts/generate_programming_profile.py` sinh **C++ + Go + TS** từ một nguồn,
  validate JSON Schema, kiểm bất biến ngoài schema (enabled ≤ total, maxTasks =
  số lớp chu kỳ, binding Program ≤ binding package, chu kỳ tăng dần) và chạy
  `gofmt` để `--check` không đối đầu `gofmt -l`.
- Bỏ literal ở consumer: `st_limits.cpp` (constraint text `range=1..1`,
  `enum=...`, `exact=3841`), `st_ir.hpp`/`st_limits.hpp` (`0x00000F01`),
  `st_scheduler.hpp` (budget percent), `runner.go` (`profileId`,
  `profileSha256`, `libraryVersion`, `integrityMode`, ABI, `MaxArtifactBytes`),
  `checks.go` (`limit: 1`, `65536`), FE `fbd/model.ts` (`profileId`, trần FBD,
  danh sách type).
- G1 join: ghim profile v2 + schema hash + `documentMajor/Minor` +
  `maxProgramsTotal/Enabled` + `targetAbi` + `integrityMode`; validator bỏ nốt
  `len(contracts) == 7`, `version == 1.0`, `profileCode == 1`,
  `integrityMode == "HASH_ONLY"` và chuyển sang bộ tên contract bắt buộc.
- Golden ST/FBD build manifest được **sinh lại bằng compiler CLI thật**
  (`mkddc-st-compile`), không sửa tay: chỉ `profile.sha256` và `buildKeySha256`
  đổi, byte `.mkir` giữ nguyên — xác nhận profile hash không nằm trong artifact.

**Ranh giới có chủ ý.** `profileId`, `profileCode` và `targetAbi` **giữ giá trị
v1**. Chúng là discriminator nằm trong artifact/FBD document/build manifest;
xoay chúng ở W0 sẽ vô hiệu hóa mọi golden và phá dual-reader v1/v2 mà DDD §12.1
yêu cầu. Việc rotate thuộc `T59-006`/`T59-106` cùng artifact v2.

**Giới hạn giai đoạn được nêu rõ, không giấu.** Pipeline compiler hiện dựng được
một Program mỗi lần chạy. Sau task này, quá 32 Program bị từ chối bằng **trần
sản phẩm 32**; 2..32 Program bị từ chối bằng **trần pipeline 1** ở nhánh riêng có
chú thích chủ sở hữu `T59-302`/`T59-305`. Hai con số không còn bị gộp làm một, và
test khoá đúng sự phân biệt đó.

**Finding sửa kèm trong task.** Diagnostic `PRG-ERR-SCOPE-001` gắn `limit` cho cả
những từ chối **không** do trần (payload sai dạng), tức là bịa một con số giới hạn
cho người đọc lỗi. Nay `limit` chỉ xuất hiện khi thật sự có trần bị vượt.

**Rollback.** Không đổi schema DB, không thêm migration, không chạm Active/LKG.
Artifact `.mkir` bất biến nên LKG cũ vẫn nạp được. Revert commit là đủ.

**Evidence level.** Host/local. Không phải GitHub CI, không phải target/HIL.

#### `T59-003` — Registry POU/Control Library làm nguồn duy nhất

**Triệu chứng.** Danh sách entry Control Library tồn tại **ba** bản chép tay:
allowlist FBD của Core (`st_fbd_model.cpp`), palette FE (`palette.ts`) và
`coreLibrary.functions` trong profile.

**Nguyên nhân gốc và hai lỗi thật đã tồn tại.** Không có phép kiểm nào ràng buộc
ba bản đó lại với nhau, nên chúng đã trôi khỏi compiler theo **cả hai chiều**:

1. Core cho phép `SCALE`, `DEADBAND`, `CTU`, `PI` — compiler **không có** cả bốn.
   `CTU` lọt qua lớp model rồi mới chết ở lớp semantic; ba cái còn lại chưa có
   test nào chạm tới.
2. Core **từ chối** `SQRT` và bốn conversion `INT_TO_REAL`, `REAL_TO_INT`,
   `TIME_TO_REAL`, `REAL_TO_TIME` — trong khi palette FE vẫn chào người dùng.
   Đây là class lỗi "hợp lệ ở FE, chết ở Core".

**Cách sửa.**

- `contracts/programming/pou_library_registry_v1.json` + schema: 40 entry
  (15 `OPERATOR`, 20 `FUNC_TABLE`, 5 `FB_TYPE`) với port/kiểu/nhãn/`featureState`.
  Trường `dispatch` khai **compiler nhận diện entry ở đâu**, nên entry không có
  đường dispatch thật là entry ma và bị chặn ngay ở schema/verifier.
- `scripts/generate_programming_library_registry.py` sinh allowlist C++ và
  palette TS; `--check` exact và được thêm vào gate `layout`.
- `st_fbd_model.cpp` dùng allowlist sinh; `palette.ts` dựng `FBD_PALETTE` từ
  registry; profile **bỏ hẳn** `coreLibrary.functions` (chỉ còn `version`).
- G1 ghim contract thứ 8 `library-registry` kèm số đếm theo `dispatch`,
  `libraryVersion` và danh sách `REVIEW_REQUIRED`; thêm 5 mutation self-test.

**Chống tái phát theo hai chiều.** `test_st_library_registry.cpp` (7 test) kiểm:
mọi entry registry giải được ở compiler; **và** mọi symbol compiler có mặt trong
registry, kể cả vector một-trên-trần (`kFuncs[]`/FB type không được nhiều hơn
registry). PID giữ `REVIEW_REQUIRED` và G1 từ chối nếu ai đó xoá trạng thái đó.

**Finding sửa kèm trong task.** `npm run build` của FE chạy `tsc --noEmit`, và
bản merge `T59-002` làm nó **đỏ** vì `profile.test.ts` import `node:crypto`/
`node:fs` trong khi tsconfig FE chỉ khai lib DOM và repo cố ý không cài
`@types/node`. Đã sửa: test đọc contract bằng import JSON
(`resolveJsonModule`); phép bằng nhau chính xác của SHA-256 vẫn được ép ở
`generate_programming_profile.py --check` và ở test Go, nên không mất coverage.

**Rollback.** Không đổi schema DB, không thêm migration, không chạm Active/LKG.
Byte `.mkir` của cả hai golden **không đổi** sau khi sinh lại, nên LKG cũ vẫn nạp
được. Revert commit là đủ.

**Evidence level.** Host/local. Không phải GitHub CI, không phải target/HIL.

#### `T59-004` — Error catalog cho sáu miền mới và guard hai chiều

**Việc chính.** Catalog lên **v1.6.0: 26 public code / 118 detail mapping**. Sáu
public code mới: `PRG-ERR-POU-001`, `PRG-ERR-LIBRARY-001`, `PRG-ERR-SIGNAL-001`,
`PRG-ERR-OUTPUT-OWNER-001`, `PRG-ERR-ENABLE-001`, `PRG-ERR-PID-REVIEW-001`.
14 detail mapping mới (`ST-POU-*`, `ST-LIB-*`, `ST-SIG-*`, `ST-OWN-001`,
`ST-PID-001`, `API-E-008`) khai trong `st_diagnostic.hpp` và `st_control_api.hpp`.

**Contract đi trước consumer.** Emitter của các mã này nằm ở W1..W4. Khai ở W0 là
đúng Plan 59 §1.2 quy tắc 1, và vì guard nay kiểm hai chiều nên **không** emitter
nào có thể xuất hiện sau này mà thiếu ánh xạ public code.

**Hai khoảng hở của gate, phát hiện và đóng trong task.**

1. `error_catalog_v1.schema.json` trước đây chỉ được **băm** chứ chưa bao giờ
   được thi hành. Nó đã drift thật: `statusClass = "NOT_FOUND"` được
   `PRG-ERR-NOT-FOUND-001` dùng nhưng **thiếu trong enum** của schema qua nhiều
   revision. Generator nay validate catalog theo schema; enum được bổ sung.
2. Guard detail chỉ kiểm **một chiều** (source → catalog) và chỉ quét source C++,
   nên `ST-CLI-LIMIT`, `ST-WORKER-CRASH`, `ST-WORKER-TIMEOUT` do BE Go phát nằm
   ngoài tầm quét — thêm mã Go mới mà quên map sẽ không làm build đỏ. Nay guard
   quét thêm `checks.go` và kiểm **hai chiều**: mapping không có emitter nào khai
   cũng làm build fail, trừ khi đánh dấu `contractOnly` tường minh
   (`IPC-CONTRACT-ONLY` là sentinel test codec hai phía).

**Finding sửa kèm.** `programmingErrorCopy` không có test phủ, nên mã public mới
sẽ rơi vào nhánh `default` và hiển thị mã thô cho người dùng — đúng lớp lỗi
`RSK-PROG-014`. Đã thêm copy VI/EN cho cả sáu mã và `errorCopy.test.ts` bắt buộc
**mọi** mã trong catalog có copy riêng ở cả hai ngôn ngữ.

**Consumer cùng boundary.** OpenAPI lên `1.21.0` (enum lỗi + client TS sinh lại),
G1 re-pin `openapi`/`errors`; test đếm ở Go, C++ và TS cập nhật cùng commit.

**Rollback.** Không đổi schema DB, không migration, không chạm Active/LKG. Mã mới
chưa có emitter nên hành vi runtime không đổi. Revert commit là đủ.

**Evidence level.** Host/local. Không phải GitHub CI, không phải target/HIL.

#### `T59-005` — Store schema v2 và migration v5→v6

**Việc chính.** `0006_product_model_v2.sql` tạo năm bảng theo DDD §4.7 —
`pou_objects`, `library_revisions`, `library_entries`, `published_signal_defs`,
`program_runtime_intents` — và thêm ba cột cho `revisions`
(`document_schema_version`, `program_count`, `library_revision_id`).

**Bất biến được đặt vào chính schema, không để lớp application tự giữ.**

- `published_signal_defs`: `UNIQUE(revision_id, name_folded)` khoá **một
  publisher** cho mỗi signal; `CHECK` bắt `USE_FALLBACK` phải có giá trị dự phòng
  và ba chính sách còn lại **không** được mang fallback — chặn đúng lối "im lặng
  thay bằng 0" mà DDD §10 cấm; `freshness_ms BETWEEN 1000 AND 90000`.
- `program_runtime_intents`: `desired_enabled` mặc định **0** vì Program mới sau
  Commission luôn Disabled (DDD §0); trigger buộc `generation` chỉ tăng nên intent
  cũ tới muộn không ghi đè intent mới.
- `library_revisions`: `CHECK` buộc `SYSTEM` không thuộc Project nào và `PROJECT`
  phải có `project_id`; revision đã rời `DRAFT` là bất biến.
- `pou_objects`, `library_entries`: `UNIQUE` theo `name_folded` cho name
  case-folded unique (DDD §4.2).

**Vì sao dùng `ADD COLUMN` thay vì rebuild `revisions`.** `revisions` được sáu
bảng khác tham chiếu; `ALTER TABLE ... RENAME` sẽ viết lại các FK đó sang tên
tạm. Cột mới có `DEFAULT` giữ nguyên nghĩa hàng cũ, và binary v5 bỏ qua cột nó
không biết — rollback an toàn theo DDD §12.4.

**Kiểm chứng đúng acceptance.** `schema_v2_test.go`:

- **Atomic**: bơm lỗi ở cả ba điểm `before_apply` / `after_sql` / `before_commit`;
  mỗi lần `user_version` giữ **5**, không sót bảng mới nào, và chạy lại vẫn lên
  được head — không kẹt vĩnh viễn.
- **Idempotent/restart**: mở lại DB **3 vòng**, mỗi vòng `Applied` rỗng và danh
  sách bảng không đổi.
- **Không tự Commission**: sau migration, `operations`, `commission_records`,
  `program_runtime_intents` và cả bốn bảng mới đều **0 hàng**.
- **Rollback giữ DB**: dữ liệu v1 nguyên vẹn; `DEFAULT` của hai cột mới đúng `1/1`.

**Finding sửa kèm.** `TestMigrationFaultChecksumPartialAndCorruptFailClosed/user-version`
viết cứng `PRAGMA user_version=6` để mô phỏng "schema tương lai". Ngay khi schema
lên đúng 6, test đó trở thành **no-op** — nó không còn kiểm gì. Đã đổi sang
`CurrentSchemaVersion+1`. Tương tự, một nhánh test bất biến ban đầu dùng `UPDATE`
trên bảng rỗng (luôn thành công) nên phải đổi sang `INSERT` thật.

**Rollback.** Migration chỉ thêm bảng/cột, không xoá và không sửa dữ liệu cũ.
Bảng mới rỗng sau migration nên binary v5 chạy lại đọc đủ dữ liệu v1.

**Evidence level.** Host/local. Không phải GitHub CI, không phải target/HIL.
Migration **chưa** chạy trên board thật — điều đó thuộc `T59-705`.

#### `T59-006` — Contract v2, dual-reader và guard action ma

**Đính chính quyết định của `T59-004`.** `DDD-SW-PROG-UNIFIED-001` §5.2 đã khóa
**mười** mã public tối thiểu. `T59-004` lại tự đặt sáu mã gộp
(`PRG-ERR-POU-001`, `PRG-ERR-LIBRARY-001`, `PRG-ERR-SIGNAL-001`,
`PRG-ERR-ENABLE-001`) — tức **chọn lại một quyết định đã chốt**, đúng thứ prompt
cấm. `T59-006` thay chúng bằng đúng bộ tên DDD nêu; catalog lên **v1.7.0
(30 public / 120 detail)**, OpenAPI lên `1.22.0`.

Hai lựa chọn ánh xạ được ghi rõ để không mở nhánh công khai thừa:

- `ST-SIG-002` (type/unit) trỏ `PRG-ERR-MAP-004` sẵn có, không tạo mã signal thứ ba.
- `ST-LIB-003` (vòng phụ thuộc thư viện) trỏ `PRG-ERR-POU-RECURSION-001`, vì vòng
  phụ thuộc **chính là** đệ quy.

`checks.go` nay báo vượt trần package bằng `PRG-ERR-PROGRAM-LIMIT-001` +
`ST-LIM-009` thay vì gộp vào `PRG-ERR-SCOPE-001`.

**Action ma của IPC được biến thành thứ đo được.** `TRACE_START` nằm trong enum
wire, trong codec C++ **và** codec Go, nhưng Core không có nhánh dispatch nào — nó
rơi vào `else` và trả `IPC-ACTION-NOT-IMPLEMENTED`. Không gate nào phát hiện.

- Schema IPC thêm khối `x-mkddc-actions` khai `handlerStatus` từng action; action
  chưa có handler phải ghi `implementedBy`. Enum wire **giữ nguyên** vì gỡ giá trị
  enum là breaking change cho cả hai codec.
- `scripts/verify_programming_ipc_actions.py` kiểm **hai chiều**: `IMPLEMENTED`
  phải có nhánh dispatch thật; `NOT_IMPLEMENTED` **không được** có nhánh (khai
  thấp hơn sự thật cũng sai). Guard cũng kiểm codec Go có đủ hằng và
  `IPC-ACTION-NOT-IMPLEMENTED` được map trong catalog. Self-test 4/4.
- `ProgramIpcServer.NotImplementedActionFailsClosedWithStableDetail` khoá hành vi:
  **không bao giờ** trả `Ok`, detail ổn định, và lặp cùng `requestId` cho đúng byte cũ.

**Contract package v2.** `artifact_v2.schema.json` khóa header/magic `MKDDCIR2`,
12 loại section theo DDD §5.3, `libraryLock` và khối `capacity` chặn trên theo
profile. `package_dual_reader_policy_v1.json` biến chính sách §12.1 thành contract
máy đọc được: đọc `{1,2}`, ghi `{2}`, đúng một package Active, version/magic lạ
`REJECT_NO_MUTATION`, cấm hạ cấp Active. G1 ép **mọi version từng ghi được vẫn
phải đọc được** — nếu không, LKG cũ mất hiệu lực ngay khi nâng cấp.

**Vì sao chưa có golden artifact v2.** Golden cần một writer thật sinh ra; khai
golden trước khi có writer là bằng chứng giả. Writer/loader thuộc `T59-106`, và
chính sách đã ghi chủ sở hữu ngay trong contract.

**Vì sao chưa thêm route OpenAPI mới.** Acceptance của task là "action khai phải
có handler test". Tám route ở DDD §5.1 chưa có handler, nên khai chúng bây giờ sẽ
tạo đúng lớp lỗi mà task này đang đóng. Chúng đi cùng `T59-202`/`T59-301`/`T59-405`.

**Finding sửa kèm.** Guard IFSPEC §9 quét **toàn bộ** văn xuôi §9, nên một câu
nhắc tên mã đã gỡ cũng làm gate đỏ, và ngược lại một mã chỉ được nhắc trong văn
xuôi vẫn "thỏa" gate mà không có dòng authority nào. Nay chỉ đọc dòng bảng.

**Evidence level.** Host/local. Không phải GitHub CI, không phải target/HIL.

#### `T59-007` — Wrapper cổng cục bộ và ma trận theo Wave

**Ba vấn đề đã cắn thật, và cách đóng từng cái.**

1. `verify-project.sh` dùng `set -e`, nên cổng đầu tiên hỏng làm các cổng sau
   **không bao giờ chạy**. Chính vì thế `test_programming_error_catalog.py` từng
   đếm sai 19/77 rất lâu mà không ai thấy — `verify_repository.py` đỏ trước nó.
   Runner mới chạy **hết** mọi cổng rồi mới kết luận.
2. Không có nơi nào ghi Wave nào cần cổng nào. Nay
   `contracts/ci/wave_gate_matrix_v1.json` + schema là contract: mỗi cổng khai
   `evidenceLevel`, và cổng ngoài HOST bắt buộc có `requiresResource`, `runbook`,
   `owner`. Schema chặn cả hai chiều — cổng HOST không được có
   `requiresResource`, cổng CI/TARGET/HIL không được có `command`.
3. Kết quả cục bộ dễ bị chép vào báo cáo như thể là GitHub CI. Runner **không có
   đường nào** báo PASS cho cổng ngoài HOST: chúng luôn `NOT_RUN` kèm runbook và
   chủ sở hữu, và mỗi lần chạy đều in cảnh báo mức bằng chứng.

**Self-test.** 8 phép kiểm: bốn cổng ngoài HOST đều phải trả `NOT_RUN` kèm lý do,
và bốn ma trận sai (wave trỏ cổng lạ, cổng mồ côi không Wave nào dùng, trùng id,
lệnh không tồn tại) đều phải bị từ chối. Chạy trong gate `layout`.

**Finding phát hiện ngay khi dùng runner.** Lần chạy `--wave W7` đầu tiên, cổng
`cpp` **đỏ một lần** (`Errors while running CTest`) rồi **không tái hiện**: chạy
lại đơn lẻ PASS, xoá `build/verify/cpp-full` dựng lại từ đầu PASS 1065/1065, và
6 lần `ctest` liên tiếp đều 100%. Không đủ cơ sở để kết luận cổng hỏng, cũng
không được kết luận nó ổn định.

Vấn đề thật lộ ra là **bản đầu của runner vứt output đi**, chỉ giữ một dòng cuối
— nên một cổng chập chờn không thể điều tra. Đã sửa: mỗi cổng ghi toàn bộ
stdout/stderr vào `build/wave-gates/<gate>.log` và đường dẫn log được in kèm khi
FAIL. Thêm `--repeat N` để soi cổng chập chờn; PASS chỉ được tính khi **mọi** lần
đều PASS, vì một cổng đỏ 1/5 lần vẫn là cổng hỏng.

**Ranh giới.** Ma trận **không** được ghim vào G1: G1 là join contract của
Programming, còn đây là contract hạ tầng kiểm thử. Nó được canh bằng schema +
self-test trong gate `layout`.

**Evidence level.** Host/local. Chính script này là thứ nói rõ điều đó ở mỗi lần
chạy.

### W1 — POU, compiler và artifact v2

| Task | Priority | Việc làm / source chính | Dependency | Status | Acceptance |
|---|---|---|---|---|---|
| `T59-101` | P0 | Parser/AST cho `FUNCTION` và `FUNCTION_BLOCK`; interface/signature | T59-003/004 | **DONE** | `parse_st_pou()` nhận cả ba loại POU; 12 test (4 positive + 8 negative) khoá kind/name/signature kèm mã lỗi và vị trí; `ctest` 1077/1077; wave W1 **5/5 PASS**. Chi tiết §3.2. |
| `T59-102` | P0 | Symbol/call graph, library resolver, recursion/DAG guard | T59-101 | **DONE** | `st_pou_registry.*` mới; 10 test khoá đệ quy trực tiếp/gián tiếp (chu trình dài 2..4), thiếu entry vs lệch version **khác mã**, trùng/mơ hồ tên, và đồ thị **độc lập thứ tự nạp**; `ctest` 1087/1087; wave W1 **5/5 PASS**. Chi tiết §3.2. |
| `T59-103` | P0 | FUNCTION purity/type/side-effect enforcement | T59-102 | **DONE** | purity ép ở registry (điểm hội tụ mọi producer, không chỉ parser ST); 10 test dựng AST **không qua parser**; cùng lời gọi sai nhưng người gọi khác nhau cho **mã khác nhau**; bảng chữ ký công bố cho lowering; `ctest` 1097/1097; corpus tương đương ST↔FBD PASS; wave W1 **5/5 PASS**. Chi tiết §3.2. |
| `T59-104` | P0 | FUNCTION_BLOCK instance state/layout/RETAIN ownership | T59-102 | **DONE** | `st_fb_instance_layout.*` mới; 13 test: 100 instance trải 2 Program không chồng vùng và identity duy nhất, trần package 1024 chặn dù từng Program dưới trần 64, layout **bất biến khi sắp xếp lại nguồn**, vòng chứa và độ sâu bị chặn; `ctest` 1110/1110; wave W1 **5/5 PASS**. Chi tiết §3.2. |
| `T59-105` | P1 | FBD nodes gọi user Function/FB + inspector/pin generation | T59-103/104 | **DONE** | node FBD gọi user POU lower thành **đúng cùng nút `USER_CALL`** mà ST sinh — có test so trực tiếp hai bên; 7 test C++ + 6 test FE (thứ tự pin, kết nối, undo/redo, chỉ-đọc, a11y announcement); `ctest` 1117/1117; FE 114 file / 1079 test; wave W2 **6/6 PASS**. Chi tiết §3.2. |
| `T59-106` | P0 | Artifact v2 writer/loader: POU/program/library/signal/binding/resource sections | T59-103/104/006 | **DONE** | `st_package_v2.*` + `mkddc-st-package-golden`; golden do **writer production** sinh, byte-stable qua 2 lần chạy, ghim trong G1 (hash + kích thước + số Program); 14 test gồm **fuzz lật từng byte** (1314 biến thể, 0 false-accept), tràn số offset, section lạ, sai profile/ABI, trùng output owner, trùng publisher, và **dual-reader v1**; `ctest` 1131/1131; G1 self-test 31/31; wave W1 **5/5 PASS**. Chi tiết §3.2. |

### 3.2 Ghi chú thực thi W1

#### `T59-101` — Parser/AST cho FUNCTION và FUNCTION_BLOCK

**Quyết định thiết kế.** Ba loại POU dùng **chung** một AST (`StProgram` thêm
`kind`, `has_return_type`, `return_type`, và vị trí tên cho source map). Thân của
chúng là cùng một ngôn ngữ; chỉ chữ ký và quyền hạn khác nhau. Tách thành ba
struct riêng sẽ nhân bản toàn bộ statement/expression grammar — đúng thứ đã sinh
ra drift ở registry library trước đây.

**Hợp đồng cũ giữ nguyên.** `parse_st_program()` vẫn **chỉ** nhận `PROGRAM`, nên
mọi call site hiện có (`st_compile.cpp`, `st_validate_main.cpp`) không đổi hành
vi. Nguồn khai `FUNCTION`/`FUNCTION_BLOCK` bị nó từ chối bằng mã kind kèm thông
điệp nói đúng loại đã gặp — hữu ích hơn "expected PROGRAM". Entry mới là
`parse_st_pou()`.

**Quy tắc chữ ký được ép ở parser, không phải quy ước ngầm.**

- `FUNCTION` **bắt buộc** có kiểu trả về; `PROGRAM`/`FUNCTION_BLOCK` **không được**
  có. Cả hai chiều đều là `ST-POU-001` (→ `PRG-ERR-POU-KIND-001`).
- `FUNCTION` không được khai `VAR_OUTPUT`, `VAR RETAIN` hay FB instance — ba thứ
  đó là kênh ra thứ hai hoặc state. Kiểm **sau** khi đọc hết khối VAR để lỗi trỏ
  đúng khai báo vi phạm chứ không phải khối đầu tiên.
- Kiểu trả về lạ dùng `ST-SEM-005` (unknown type), **không** gộp vào mã kind: hai
  lỗi này dẫn tới hai hành động sửa khác nhau.
- Từ khóa kết thúc phải khớp loại đã mở.

**Finding trong chính task.** Bản đầu có nhánh kiểm độ dài tên POU trong parser.
Nó là **code chết**: lexer đã chặn mọi identifier dài hơn `kMaxIdentifierLength`
bằng `ST-LIM-005`, và trần đó bằng đúng trần tên POU của DDD §4.2. Đã gỡ nhánh và
thay bằng `static_assert` giữ hai con số dính nhau — nếu ai nâng trần lexer lên
trên trần tên POU thì build đỏ ngay, chứ không âm thầm cho tên quá dài lọt qua.
Test khoá đúng hành vi thật (`ST-LIM-005` tại 65 ký tự, PASS tại 64).

**Chưa mở cửa nửa vời.** `compile_st_source()` vẫn đi qua `parse_st_program()`,
nên `FUNCTION`/`FUNCTION_BLOCK` **chưa** compile được. Symbol/call graph là
`T59-102`, purity là `T59-103`, instance state là `T59-104`.

**Evidence level.** Host/local. Không phải GitHub CI, không phải target/HIL.

#### `T59-102` — Registry POU: symbol table, call graph và guard DAG

**Vì sao parser không tự phán.** Parser chỉ ghi `USER_CALL` kèm tên; nó không biết
tập POU của Project hay library đã pin. Tách hai việc này là **điều kiện** để phân
biệt ba tình huống có ba cách sửa hoàn toàn khác nhau: thêm entry
(`ST-LIB-001`), đổi pin version (`ST-LIB-002`), phá vòng gọi (`ST-POU-003`). Gộp
chúng vào một mã là bỏ rơi người vận hành ở đúng chỗ họ cần biết phải làm gì.

**Tính xác định là yêu cầu, không phải may mắn.** Bảng ký hiệu sắp theo tên
case-folded, cạnh sắp theo `(caller, callee, line, column)`, Kahn duyệt theo
`std::set` có thứ tự. Test nạp cùng một tập POU theo **hai thứ tự ngược nhau** và
đòi `pou_order`, `edges` và `topological_order` **giống hệt** — nếu thứ tự nạp làm
đổi diagnostic thì người dùng thấy lỗi "nhảy" giữa hai lần Check cùng nguồn.

**Guard DAG phân biệt chia sẻ với đệ quy.** Sơ đồ kim cương (`Top → Left/Right →
Shared`) **phải được chấp nhận**; nếu guard nhầm nó là chu trình thì mọi thư viện
dùng chung đều bị chặn. Test khoá cả hai chiều: kim cương PASS, chu trình dài
2/3/4 đều bị chặn.

**Gọi chính mình bắt riêng.** Đệ quy trực tiếp báo ngay tại **dòng gọi** thay vì
để Kahn báo một chu trình dài khó đọc.

**Không bỏ sót nhánh.** Lời gọi trong nhánh `IF`/`ELSE` và trong đối số FB đều vào
đồ thị — bỏ sót một nhánh nghĩa là đệ quy lọt qua guard. Có test riêng cho việc này.

**Ranh giới giữ nguyên.** `parse_st_program()` (đường compile hiện tại) vẫn **tắt**
`USER_CALL`, nên hành vi compile không đổi. Hai `switch` ở `st_semantic.cpp` và
`st_compile.cpp` nhận nhánh `USER_CALL` **từ chối tường minh** — `-Wswitch` bắt
buộc chúng phải xử lý, và từ chối rõ ràng tốt hơn `default` im lặng. Lowering thật
thuộc `T59-103`.

**Evidence level.** Host/local. Không phải GitHub CI, không phải target/HIL.

#### `T59-103` — FUNCTION thuần: state, side-effect và chữ ký

**Vì sao kiểm lại thứ parser đã kiểm.** Parser chỉ thấy **nguồn ST**. AST còn đến
từ lowering FBD (`T59-105`), và một producer mới không được phép bỏ qua quy tắc
chỉ vì nó không đi qua parser. Registry là **điểm hội tụ của mọi producer**, nên
purity phải được ép ở đó. Đây không phải kiểm trùng lặp — và test chứng minh điều
đó bằng cách dựng AST **thẳng tay, không qua parser**, rồi đòi registry vẫn chặn.

**Cùng một lời gọi sai, người gọi khác nhau thì mã khác nhau.**

- `FUNCTION` gọi `FUNCTION_BLOCK` → `ST-POU-002` "không thuần". Cách sửa: bỏ FB đi.
- `PROGRAM`/`FUNCTION_BLOCK` gọi `FUNCTION_BLOCK` → `ST-POU-001` kèm chữ
  "instance". Cách sửa: khai instance rồi gọi qua instance.

Dùng chung một mã sẽ **nói sai việc cần làm**. Có test riêng khoá đúng sự phân biệt.

**Gọi `PROGRAM` luôn bị từ chối.** PROGRAM là đơn vị lập lịch, không phải hàm —
gọi nó không có nghĩa ở bất kỳ ngữ cảnh nào.

**Chữ ký công bố, không dựng bảng thứ hai.** Registry xuất `signatures` (tên,
kind, kiểu từng input, kiểu trả về) sắp xếp ổn định, để lớp lowering
`T59-105`/`T59-106` dùng lại. Hai bảng ký hiệu song song là cách drift bắt đầu —
đúng cơ chế đã xảy ra ở registry Control Library.

**Ranh giới trung thực về "type".** Registry kiểm **số đối số** và "callee có kiểu
trả về hay không" — hai thứ suy được thẳng từ chữ ký. Kiểu của **từng biểu thức
đối số** cần suy kiểu biểu thức, việc đó thuộc lớp lowering (`T59-105`) và sẽ dùng
đúng bảng `signatures` này. Không tự dựng một bộ suy kiểu thứ hai trong registry.

**Chiều khẳng định cũng được khoá.** `FUNCTION_BLOCK` **vẫn được** giữ `VAR RETAIN`,
FB instance và gọi FUNCTION thuần — nếu guard purity lan sang FB thì FB mất đúng
khả năng làm nên nó. Corpus tương đương ST↔FBD (`fbd/equivalence_v1.json`) vẫn PASS.

**Evidence level.** Host/local. Không phải GitHub CI, không phải target/HIL.

#### `T59-104` — Layout instance FB, quyền sở hữu RETAIN và identity ổn định

**Bất biến đắt giá nhất: ổn định khi sắp xếp lại nguồn.** Nếu đổi thứ tự khai báo
làm đổi offset hay identity, thì **mỗi lần chỉnh sửa vô hại sẽ gây RETAIN mismatch
và cold-init toàn bộ state đang chạy**. Cách bảo đảm: layout đi theo **thứ tự tên
canonical**, không theo thứ tự xuất hiện trong nguồn. Test đầu tiên nạp cùng tập
instance theo hai thứ tự khai báo ngược nhau và đòi offset + identity + layout
identity giống hệt.

**Mọi state thuộc đúng một Program owner** (DDD §4.4). Chỉ `PROGRAM` là gốc của
cây instance. Hai Program dùng **trùng tên** instance vẫn là hai identity khác
nhau, vì identity tính từ đường dẫn canonical `Program.instance.sub`.

**Đổi tên thì chỉ identity của chính nó đổi**, các instance khác giữ nguyên offset
— nhưng `layout_identity` tổng **phải đổi**, để runtime cold-init đúng phần đã đổi
thay vì đọc nhầm state cũ.

**Parser lại chỉ ghi tên, registry mới phân giải.** Kiểu lạ trong `VAR`/`VAR RETAIN`
ở chế độ POU trở thành instance của FB người dùng (`StFbDecl.user_type_name`).
Cùng lý do với `USER_CALL` ở `T59-102`: chỉ lớp biết cả Project lẫn library mới
phân biệt được "chưa có type" (`ST-LIB-001`), "type là FUNCTION/PROGRAM"
(`ST-POU-001`) và "vòng chứa" (`ST-POU-003`).

**Vòng CHỨA khác vòng GỌI.** `T59-102` bắt vòng gọi; một FB chứa chính mình cần bộ
nhớ vô hạn nên phải chết ở đây, kể cả gián tiếp `Ping→Pong→Ping`. Cây hợp lệ nhưng
sâu quá `kMaxNestingDepth` cũng bị chặn.

**Trần package khác trần Program.** Từng `PROGRAM` đều dưới trần 64 mà tổng vẫn có
thể vượt 1024 — nếu chỉ kiểm cấp Program thì trần package vô nghĩa. Có test riêng
dựng 17 Program × 64 instance.

**Không đoán số cho state library.** Instance của FB đến từ Control Library được
chấp nhận với `state_size = 0` và cờ `is_library_type`; kích thước thật đến cùng
artifact library (`T59-204`). Đoán một con số ở đây sẽ làm **lệch mọi offset phía
sau** — sai lệch im lặng, tệ hơn là chưa biết.

**Ranh giới trung thực.** Đây là **bộ hoạch định layout**, chưa phải runtime cấp
phát. Nối vào prepared image và cold-init thật thuộc `T59-106`/`T59-401`/`T59-407`;
identity mà task này sinh ra chính là thứ hai lane đó dùng để phát hiện mismatch.

**Evidence level.** Host/local. Không phải GitHub CI, không phải target/HIL.

#### `T59-105` — FBD gọi user POU và bằng chứng dùng chung typed IR

**"Dùng chung typed IR" được cho một nghĩa kiểm được.** Cùng một logic viết bằng
ST và vẽ bằng FBD phải sinh ra **đúng cùng một nút AST**: `USER_CALL`, cùng tên,
cùng thứ tự đối số. Test so **trực tiếp** hai nút đó. Nếu hai ngôn ngữ có hai
đường lowering riêng thì sẽ có hai bộ ngữ nghĩa để trôi khỏi nhau — đúng cơ chế
đã sinh ra drift ở registry Control Library.

**Một seam mới, có lý do rõ.** `lower_fbd_source_to_program()` dừng **trước**
typecheck và codegen. Cần nó vì lowering đã đúng nhưng codegen chưa liên kết được
lời gọi POU (`T59-106` mới làm). Có seam này thì chứng minh được bất biến mà
**không phải giả vờ** rằng codegen đã chạy được — và test
`CodegenStillRefusesUnlinkedUserCall` khoá luôn việc nó fail-closed, không sinh
artifact thiếu thân hàm.

**Sai kind khác POU người dùng.** Bản đầu của tôi coi mọi typeRef lạ là POU người
dùng, làm `TON` trên node `FUNCTION` lọt qua lớp model — một test có sẵn bắt được
ngay. Đã sửa: tên **có** trong registry nhưng thuộc kind khác vẫn là
`FBD-SEM-TYPE-REF-001`; chỉ tên registry **hoàn toàn không biết** mới được coi là
POU người dùng.

**Thứ tự đối số theo `order` của cổng, không theo thứ tự dây.** Có test đảo thứ tự
dây và đòi đối số giữ nguyên — nếu ngữ nghĩa bám thứ tự dây thì vẽ lại cùng một sơ
đồ sẽ đổi nghĩa, loại lỗi im lặng tệ nhất trong FBD.

**FB người dùng: chuyển đúng trách nhiệm, không bỏ kiểm.** `validate_fb_ports` đối
chiếu với bảng FB dựng sẵn nên không có gì để đối chiếu với FB người dùng. Đối số
`FB_CALL` đi theo **tên cổng**, để `st_pou_registry` — lớp duy nhất giữ interface —
kiểm với `VAR_INPUT` thật.

**FE: sinh pin từ interface, một phép biến đổi thuần.** `userPou.ts` biến
`UserPouInterface` (gương của `StPouSignature` phía Core) thành pin và entry
palette. Interface mâu thuẫn bị **từ chối** thay vì sinh pin sai: FUNCTION thiếu
kiểu trả về, FB thừa kiểu trả về, trùng tên cổng, dùng `OUT` cho cổng vào.

**Ranh giới trung thực.** Đây là **bộ sinh pin**; UI duyệt/chọn POU người dùng
trong cây Project thuộc `T59-306`. Test FE đi qua **reducer thật** nên kết nối,
undo/redo, chặn chỉ-đọc và announcement cho trình đọc màn hình đều là hành vi thật,
không phải mô phỏng.

**Evidence level.** Host/local. Không phải GitHub CI, không phải target/HIL.

#### `T59-106` — Container package v2: writer, loader và dual-reader

**Vì sao container riêng thay vì mở rộng v1.** Artifact v1 mô tả **một** Program.
Package v2 phải mang nhiều Program cùng bảng POU, khóa thư viện, định nghĩa
signal, manifest binding và ngân sách tài nguyên. Nhồi chúng vào v1 sẽ làm **mọi
loader v1 hiện có đọc sai một cách im lặng**.

**Không viết lại codegen.** Section `CODE_IR` chứa **đúng** các blob v1 do
`serialize_st_ir` sinh ra. Viết lại codegen chỉ để đổi vỏ chứa là cách chắc chắn
nhất để hai bộ ngữ nghĩa trôi khỏi nhau.

**Loader là ranh giới tin cậy cuối trước khi mã lạ vào bộ điều khiển đang chạy.**
Mọi trường độ dài, offset và số đếm trong file đều là dữ liệu **bên ngoài kiểm
soát**, nên bộ test tấn công đúng chỗ đó:

- **Tràn số 32 bit** ở `offset + size`: cộng trên 64 bit rồi mới so, vì cộng trên
  32 bit cho phép một section "vượt biên mà vẫn nằm trong".
- Bảng section phải **tăng dần theo type** — bảng lộn xộn là dấu hiệu artifact bị
  ghép tay, và tính đơn điệu phát hiện điều đó rẻ tiền.
- **Section lạ không được bỏ qua im lặng**: nó có thể mang ngữ nghĩa mà runtime
  này không biết, và bỏ qua nghĩa là chạy thiếu một phần gói.
- Vùng chữ ký reserved phải bằng 0 khi chưa ký.
- **Fuzz lật từng byte**: 1314 biến thể (mỗi byte × 2 mask), **0 lần chấp nhận
  nhầm**, không crash.

**Hai bất biến cấp package kiểm ở loader, không chỉ ở writer.** Một output binding
có đúng một Program owner; một signal có đúng một publisher. Kiểm ở loader vì
artifact có thể tới từ nơi khác chứ **không chỉ** từ writer trong repo này.

**Profile phải khớp chính xác.** "Gần đúng profile" nghĩa là chạy mã biên dịch cho
một trần tài nguyên khác — đúng loại sai lệch không báo lỗi.

**Golden do chính writer production sinh.** `mkddc-st-package-golden` gọi đúng
`WritePackageV2()` mà sản phẩm dùng, rồi **đọc lại bằng chính loader** trước khi
ghi ra đĩa — golden mà loader từ chối là golden vô nghĩa. Viết tay một file rồi gọi
nó là golden chỉ chứng minh ai đó biết định dạng, không chứng minh writer sinh ra
đúng định dạng đó. Byte-stable đã kiểm bằng hai lần sinh liên tiếp; G1 ghim hash,
kích thước và số Program, kèm 3 mutation self-test.

**Dual-reader theo DDD §12.1.** `ProbePackageFormat()` nhận cả v1 lẫn v2. Nếu
probe từ chối v1 thì **một lần nâng cấp là mất bản chạy được cuối cùng** — có test
riêng cho điều đó.

**Ranh giới trung thực.** Đây là **container**: nó mang và kiểm khung. Việc *lắp
nội dung* (chọn Program nào, từ Revision nào) thuộc `T59-305`; nạp vào prepared
image và kích hoạt thuộc `T59-401`. Blob IR trong golden là dữ liệu tất định do
công cụ sinh, **không phải** mã đã biên dịch từ nguồn thật — nó kiểm vỏ chứa, và
điều đó được ghi rõ ngay trong công cụ lẫn test.

**Evidence level.** Host/local. Không phải GitHub CI, không phải target/HIL.

### W2 — Control Library

| Task | Priority | Việc làm / source chính | Dependency | Status | Acceptance |
|---|---|---|---|---|---|
| `T59-201` | P0 | Domain/store SYSTEM+PROJECT library revision/entry/usage | T59-005/102 | **DONE** | SYSTEM là snapshot **virtual** sinh từ registry (0 hàng SQLite, trigger chặn cả SQL trực tiếp); PROJECT có Draft→Publish→Deprecate bất biến ở **hai lớp** store+trigger; migration `0007` schema v6→v7 **dừng fail-closed** khi còn hàng library đời v6; 11 test domain + 10 test store gồm reference guard, clone version re-pin dependency, usage seal nguyên tử, restart và fail-closed SYSTEM provider; `go vet` sạch + `go test ./... -count=1` 18/18 package ok; G1 10/10 + self-test 32/32; `--wave W2` 6/6 PASS. Chi tiết §3.3. |
| `T59-202` | P0 | Library REST/OpenAPI/RBAC/idempotency/audit | T59-201/006 | **DONE** | 3 route DDD §5.1 (`GET /libraries`, `POST|DELETE /projects/{id}/library/entries[/{entryId}]`); OpenAPI `1.23.0` **28 operation** ↔ 28 route Go ↔ client TS sinh lại, cả ba khoá bằng test exact; RBAC kiểm bằng authorizer thật (viewer/operator đọc được, mutation 403); idempotency+audit nằm CÙNG transaction với mutation (migration `0008` mở enum receipt); mutation library dùng chung lane `If-Match` với Draft; 6 test application + 6 test transport gồm cursor ràng buộc filter và regression route-stealing; `go test ./... -count=1` 18/18; G1 10/10; `--wave W2` 6/6 PASS. Chi tiết §3.3. |
| `T59-203` | P1 | FE PGM-04 library search/filter/detail/create/edit/version/usage | T59-202 | ORDERED | Desktop/mobile visual mapping; loading/empty/error/permission; component/a11y/E2E. |
| `T59-204` | P1 | Library import/export/signature/version compatibility | T59-201/106 | ORDERED | Source-only hostile corpus; no executable/cache/path traversal; no Active mutation. |
| `T59-205` | P0 | PID registry trạng thái `REVIEW_REQUIRED` + policy token | T59-003/004 | ORDERED | Commission blocked without controlled approval token; cannot bypass from FE payload. |

### 3.3 Ghi chú thực thi W2

#### `T59-201` — Domain/store Control Library SYSTEM và PROJECT

**Quyết định lớn nhất: SYSTEM Library không nằm trong SQLite.** Nó là snapshot
chỉ đọc sinh từ `pou_library_registry_v1.json` cùng compiler/firmware profile.
Seed nó vào DB sẽ tạo ngay một đường đặc quyền để ghi thêm entry SYSTEM sau khi
DB đã mở — và một khi tồn tại đường đó, mọi lời hứa "SYSTEM là read-only" chỉ còn
là quy ước ở lớp application. Store nạp snapshot lúc mở, **validate** rồi giữ bản
sao; `GetLibraryRevision`/`ListLibraryEntries`/`SearchLibraryEntries` trộn nó với
PROJECT trong DB. Hai trigger `library_revisions_no_system_insert/update` chặn cả
SQL trực tiếp, nên test khoá được cả hai chiều: đọc được, và không tạo được bản
SYSTEM song song.

**Snapshot hỏng thì store không mở.** Provider lỗi hoặc snapshot không hợp lệ đều
làm `OpenProgrammingStore` fail-closed. Mở store rồi phân giải tên bằng dữ liệu
không ai kiểm là cách hỏng tệ nhất — nó im lặng.

**Version mới là revision mới, không phải sửa tại chỗ.**
`CreateProjectLibraryVersion` clone snapshot parent đã publish, **re-pin
dependency nội revision sang version mới** rồi tính lại content hash. Test khoá
đúng hệ quả: entry không có dependency giữ **nguyên** content hash, entry có
dependency **phải đổi** hash, và parent giữ nguyên state/manifest. Nếu clone
không re-pin thì revision mới sẽ mang pin trỏ về version cũ — một tham chiếu chéo
version mà không lớp nào phía sau phát hiện được.

**Publish dựng manifest từ chính entries trong transaction.** Caller không được
truyền manifest vào; nhờ vậy không thể ký một manifest khác với tập entry thực sự
sắp bị đóng băng. Manifest tất định theo nội dung: dựng lại cùng tập entry theo
thứ tự upsert **ngược lại** cho đúng cùng SHA-256 — có test riêng.

**Trạng thái layout FB: `0 byte authoritative` khác `chưa biết`.**
FUNCTION/CONVERSION có `state_size=0` authoritative. FUNCTION_BLOCK được phép ở
Draft khi chưa biết layout, nhưng **không publish được** nếu thiếu
version/size/hash. Đoán một con số ở đây sẽ **làm lệch mọi offset RETAIN phía
sau** — sai lệch im lặng, tệ hơn hẳn là chưa biết. `CHECK` của schema và
`validateLibraryStateLayout` khoá cùng một bất biến ở hai lớp.

**Reference guard ở hai lớp khác nhau.** Trong Draft: entry đang bị entry khác
khai dependency thì không xoá được (`ErrLibraryReferenced`), còn entry tự do vẫn
xoá được — guard chặn tất cả cũng là guard sai. Sau khi Revision seal:
`library_usages` giữ FK `RESTRICT` và trigger no-update/no-delete, nên usage của
một Revision immutable không xoá được kể cả bằng SQL trực tiếp.

**Migration v6→v7 dừng trước `ALTER` khi còn hàng library đời v6.** Một hàng v6
không mang source, interface hay layout, nên nâng cấp nó là **bịa dữ liệu**.
Preflight `CHECK (legacy_entry_count = 0)` bắt operator phục hồi/điều tra từ
backup thay vì mở DB rồi hỏng muộn ở lần đọc đầu tiên. Test xác nhận migration
thất bại giữ `user_version` ở 6, **không** để lại cột/trigger v7 nào, và dữ liệu
v6 nguyên vẹn.

**Finding sửa kèm trong task.** `normalizeLibraryDependencies` trả `nil` khi entry
không có dependency, nên `json.Marshal` ghi `null` xuống `dependencies_json`
trong khi hash canonical của entry đã dùng mảng rỗng `[]`. Hệ quả: **mọi** PROJECT
library entry không có dependency đều bị `json_type(...)='array'` của schema từ
chối — tức là đường phổ biến nhất của tính năng không chạy được, và không test nào
chạm tới nó trước khi bộ test store này được viết. Đã sửa tại đúng điểm chuẩn hoá
để cả `library_entries` lẫn `pou_objects` cùng ghi `[]`; content hash **không
đổi** vì nó vốn đã canonicalize thành mảng rỗng.

**Contract đi cùng code.** `programming_store_v1.manifest.json` lên `schemaVersion`
7 với migration `0007`; G1 re-pin `store`. `immutableEntities` bỏ `library_entries`
và thêm khối `draftMutableEntities` — sau v7, entry chỉ bất biến khi revision cha
đã rời `DRAFT`, nên khai nó bất biến vô điều kiện là khai sai.

**Ranh giới trung thực.** Đây là **domain + store**. REST/RBAC/audit thuộc
`T59-202`, UI thuộc `T59-203`, import/export nguồn thù địch thuộc `T59-204`, và
layout FB authoritative do compiler sinh vẫn chưa có — store chỉ từ chối những gì
không authoritative chứ không tự tính được.

**Evidence level.** Host/local. Không phải GitHub CI, không phải target/HIL.

#### `T59-202` — REST Control Library, RBAC, idempotency và audit

**Chỉ ba route, đúng bằng DDD §5.1.** `GET /programming/libraries`,
`POST /programming/projects/{id}/library/entries`,
`DELETE .../entries/{entryId}`. Không thêm route "tạo library" hay "publish
library": DDD khoá đúng ba dòng này, và tự thêm route thứ tư là tự chế contract.
Hệ quả kéo theo được xử lý ở dưới.

**Entry đầu tiên tự mở Draft library.** Nếu Project chưa có PROJECT Library nào,
entry đầu tiên mở `1.0.0`; nếu đã có bản publish và chưa có Draft, hệ thống mở
version **minor kế tiếp** clone từ bản publish mới nhất. Đây là hệ quả trực tiếp
của việc chỉ có route entry: bắt người dùng "tạo library" trước khi thêm entry là
dựng một bước không tồn tại trong luồng nào. Version mới chỉ tăng MINOR và bỏ
patch/prerelease — một Draft vừa mở là tập thay đổi chưa biết, đoán PATCH sẽ nói
sai mức tương thích ngay khi chưa có thay đổi nào.

**Mutation library đi CHUNG lane concurrency với tài liệu Draft.** `If-Match` là
ETag Draft của Project, và mutation library **tăng** ETag đó. Hai lane riêng sẽ
cho phép một lần lưu tài liệu và một lần sửa library xen kẽ nhau mà không bên nào
thấy — đúng lớp lỗi mà `If-Match` sinh ra để chặn. Test khoá cả chiều khẳng định
(Project view thấy đúng ETag mới) lẫn chiều phủ định (ETag cũ bị 409).

**Idempotency và audit nằm trong CÙNG transaction với thay đổi.** Migration
`0008` mở enum `mutation_receipts.action` cho `LIBRARY_ENTRY_UPSERT/DELETE`. Enum
đó đóng có chủ ý: nó ngăn một action tự chế lọt vào bảng biên nhận rồi "replay"
một thứ không ai định nghĩa — nên thêm action mới bắt buộc là migration, không
phải sửa hằng ở lớp Go.

**`REVIEW_REQUIRED` không nhận từ payload.** Nó là cờ Controls/Safety của registry
SYSTEM. Cho client tự dán nhãn review lên POU của mình sẽ làm nhoè ý nghĩa cờ đó
ở đúng chỗ nó cần rõ nhất. Schema OpenAPI chỉ cho `AVAILABLE`, và service từ chối
mọi giá trị khác.

**Ba nguyên nhân phân giải giữ ba mã public tới tận HTTP.** `LibraryPublicError`
dịch `ST-LIB-001/002` và `ST-POU-003` qua đúng catalog; reference guard trả
`PRG-ERR-CONFLICT-001`. Gộp chúng vào một mã chung sẽ xoá đúng thông tin người
vận hành cần để biết phải sửa gì.

**Cursor ràng buộc luôn bộ lọc.** Trang sau phải cùng `scope/kind/q/projectId`
với trang đầu; nếu không, một client đổi filter mà giữ cursor sẽ nhận trang có
phạm vi khác mà không hay. Cursor ký HMAC, hết hạn 15 phút, sửa một ký tự là hỏng.

**Hai finding thật, cả hai do test bắt.**

1. *Handler library nuốt route Project khác.* Bản đầu nhận diện route bằng sự có
   mặt của `PathValue("projectId")`. Nhiều route Project khác cũng mang biến đó,
   nên `POST /projects/{id}/draft/revisions` rơi vào handler library và **seal
   Revision trả lỗi request thay vì chạy** — `TestProgrammingProjectDraftRevisionHTTPAndRestart`
   ở `internal/app` bắt được. Đã đổi sang khớp đường dẫn tường minh và thêm test
   hồi quy riêng.
2. *Actor rỗng cho 503 "retryable".* Khi middleware auth chưa gắn principal,
   store từ chối bằng một lỗi không có sentinel và lớp HTTP dịch thành
   `PRG-ERR-UNAVAILABLE-001` retryable — tức **bảo client thử lại một thứ không
   bao giờ thành công**. Service library nay từ chối actor rỗng bằng lỗi REQUEST.
   Các service Project/Check/Operation có cùng khoảng hở này; nó thuộc ma trận
   RBAC/security đầy đủ của `T59-603` và được ghi ở đây để không rơi mất.

**Ranh giới trung thực.** Đây là **BE**. UI PGM-04 thuộc `T59-203`; import/export
nguồn thù địch thuộc `T59-204`; publish library gắn với seal Revision đa Program
thuộc `T59-301`/`T59-305`. Layout FB authoritative vẫn phải do compiler cấp —
API chỉ nhận hoặc từ chối, không tự tính.

**Evidence level.** Host/local. Không phải GitHub CI, không phải target/HIL.

### W3 — Multi-Program Project, Check và Mapping

| Task | Priority | Việc làm / source chính | Dependency | Status | Acceptance |
|---|---|---|---|---|---|
| `T59-301` | P0 | Project Draft/model/API cho 32 Program + POU + signal definitions | T59-005/006 | ORDERED | CRUD/rename/duplicate/search, ETag/idempotency/restart; 33rd Program reject. |
| `T59-302` | P0 | Package Check toàn POU/Program/library/signal/resource | T59-106/201/301 | ORDERED | Aggregate diagnostics, deterministic build, no Active effect, concurrent Check bounded. |
| `T59-303` | P0 | MB_RTU binding compiler adapter qua canonical Point contract | T59-302 | ORDERED | LOCAL/VP/MB_RTU input/output cases; endian/polling không tái định nghĩa; wrong direction reject. |
| `T59-304` | P0 | Output owner/conflict + Published Signal publisher/consumer validation | T59-302/303 | ORDERED | Duplicate output/publisher reject; freshness/fallback/type graph tests. |
| `T59-305` | P0 | Package manifest/topology/budget cho 32/16; Program mới Disabled | T59-302/304 | ORDERED | 32 compile, 16 enabled, one-over stable; manifest không chứa creation-order dependency. |
| `T59-306` | P1 | FE PGM-02/03: POU tree, Program properties, mapping conflicts, signals | T59-301/304 | ORDERED | Sáu route target/legacy redirect; Function/FB hides invalid fields; E2E Draft save/reload. |

### W4 — Runtime, scheduler, signal, Enable/Disable và output

| Task | Priority | Việc làm / source chính | Dependency | Status | Acceptance |
|---|---|---|---|---|---|
| `T59-401` | P0 | Package coordinator/loader v2 + topology image, bỏ hardcode `program-main` | T59-106/305 | ORDERED | v1/v2 prepared image; stage corrupt no mutation; package status/read-back. |
| `T59-402` | P0 | Per-Program due queue/state/period/budget/metrics, max 16 | T59-401 | ORDERED | 10-Program/3-period host fixture; deterministic deadline; creation reorder same result. |
| `T59-403` | P0 | Worker lanes/fault isolation/no-allocation RT | T59-402 | ORDERED | Single/multicore same semantics; TSan/no allocation/blocking; one Program fault isolated. |
| `T59-404` | P0 | Published Signal double-buffer/freshness/policy | T59-402/304 | ORDERED | No torn read; fallback/hold/wait; producer disable/fault/recover tests. |
| `T59-405` | P0 | Product Enable/Disable store→API→IPC→Core→read-back/audit | T59-401/006 | ORDERED | RBAC/idempotency/restart intent; STARTING/RUNNING/STOPPING/DISABLED truth. |
| `T59-406` | P0 | Candidate registry/withdrawal/output ownership/arbitration/interlock/safe-state | T59-403/405 | ORDERED | Disable/fault/TTL withdraw; next priority/default/safe path; no direct IOP. |
| `T59-407` | P0 | Per-Program/FB RETAIN namespace/layout/restart/reset | T59-104/401 | ORDERED | Warm/cold/revision/corrupt/reset matrix; no half reset; Program isolation. |
| `T59-408` | P1 | Core trace ring buffer + real `TRACE_START/STOP` | T59-402/006 | ORDERED | 10k/10 min bounded, no RT allocation; BE caller thật; action ma = 0. |

### W5 — Lifecycle atomic và sản phẩm FE↔BE↔Core

| Task | Priority | Việc làm / source chính | Dependency | Status | Acceptance |
|---|---|---|---|---|---|
| `T59-501` | P0 | Package Commission/Restore first-cycle barrier, LKG/journal/recovery | T59-401..407 | ORDERED | Fault mọi phase/restart/power simulation; no partial active; old LKG exact. |
| `T59-502` | P0 | Impact/ack cho multi-Program/library/signal/output/RETAIN/enable intent | T59-501 | ORDERED | BE authority diff; FE chỉ hiện impact thật; stale ack reject. |
| `T59-503` | P1 | FE sáu workspace/navigation/context, PGM-05/06 lifecycle | T59-203/306/405/502 | ORDERED | Desktop/mobile, Draft vs Active vs intent/runtime, stale/offline/unknown/a11y. |
| `T59-504` | P1 | Monitor đủ LOCAL/VP/MB_RTU, Program/signal/candidate/actual/priority | T59-303/404/406 | ORDERED | 3 category, programValue vs actual, source/freshness/quality đúng. |
| `T59-505` | P0 | Real-backend E2E Draft→Check→Commission→Enable→Runtime→Disable→Restore | T59-501..504 | ORDERED | Không `page.route` mock Programming; compiler thật + Core simulator authority; CI lane. |
| `T59-506` | P1 | ST editor durable history/runtime overlay + FBD POU UX polish | T59-503/504 | ORDERED | 20 edit undo/redo, cursor; live value quality/stale; browser Console/Network sạch. |

### W6 — Hardening, packaging và Release Candidate

| Task | Priority | Việc làm / source chính | Dependency | Status | Acceptance |
|---|---|---|---|---|---|
| `T59-601` | P1 | ST↔FBD corpus mọi registry entry + state traces; 3 fuzz harness CI | T59-105/106 | ORDERED | Registry presence 100%; stateful/conversion vectors; parser/loader/FBD fuzz. |
| `T59-602` | P0 | Artifact/library trust SIGNED + key custody/rotation/rollback | T59-106/204 | ORDERED | Valid/tampered/wrong key/rotation/rollback tests; no `HASH_ONLY` release. |
| `T59-603` | P1 | Security/RBAC/audit/malicious input/concurrency full matrix | T59-202/405/501 | ORDERED | Direct API negative, zero mutation, audit completeness/no secret, rate/resource bounds. |
| `T59-604` | P1 | E2E stability, remove stale quarantine, deterministic workers/retry policy | T59-505 | ORDERED | 5 consecutive full runs; all spec included; retry không che deterministic defect. |
| `T59-605` | P0 | Release packaging: Programming default ON, artifact/compiler/library/systemd/env | T59-501/602 | ORDERED | Fresh install + upgrade package manifest/checksum; services/routes visible; rollback package. |
| `T59-606` | P0 | RC reproducible build/provenance/SBOM/backup/restore/upgrade dry-run | T59-601..605 | ORDERED | Same source reproducible hashes or explained variance; dry-run fresh/upgrade/rollback PASS. |

### W7 — Target/HIL/V&V và quyết định phát hành

| Task | Priority | Việc làm / source chính | Dependency | Status | Acceptance |
|---|---|---|---|---|---|
| `T59-701` | P0 | Khôi phục GitHub Actions account và chạy full RC workflow | RC T59-606 | EVIDENCE_QUEUE | 11 job khởi chạy thật; required checks PASS trên RC commit. |
| `T59-702` | P0 | Deploy target 10-Program fixture, timing/fault/Web-BE loss | T59-606 | EVIDENCE_QUEUE | 24 h; 3 period; no poll gap >=200 ms; fault isolation/signal freshness đúng. |
| `T59-703` | P0 | Physical I/O HIL cho ST và FBD output | T59-606 | EVIDENCE_QUEUE | AO/DO đo bằng instrument; full candidate/safety path; Disable/rollback physical đúng. |
| `T59-704` | P0 | RETAIN/power-cut/reboot/enable-intent/LKG matrix | T59-606 | EVIDENCE_QUEUE | >=10 power cuts; cold-init/recovery exact; no corrupt accepted/partial active. |
| `T59-705` | P0 | Fresh install/upgrade/controller replacement/rollback rehearsal | T59-606 | EVIDENCE_QUEUE | Image/config/hash/backup/restore/read-back; rollback không mất data/audit. |
| `T59-706` | P0 | PID Controls/Safety target review và evidence | T59-602/703 | EVIDENCE_QUEUE | Saturation/anti-windup/override/release pass; approval token; label READY. |
| `T59-707` | P0 | Chạy full V&V unified + trace/risk/release record | T59-701..706 | ORDERED | Mọi Must disposition PASS hoặc waiver có authority; 0 silent NOT_RUN; GO/NO-GO ký. |

## 4. Bảng ownership

| Boundary | R | A | Consumer/reviewer |
|---|---|---|---|
| Product/SRS/DDD/Plan | System Architect | Product Owner/CTO | mọi discipline |
| Registry/compiler/artifact | Compiler Lead | Runtime Architect | FE/Core/Security/QA |
| Store/API/library/operations | BE Lead | System Architect | FE/Core/Ops/Security |
| Scheduler/signal/output/retain/trace | Core Lead | Runtime Architect | Controls/Safety/iobus/QA |
| Six-workspace UI | FE Lead | Product/UX | BE/QA/a11y |
| Packaging/CI/deploy/rollback | Ops | Release Owner | all leads |
| Target/HIL/V&V | Verification Lead | Release Owner | Controls/Safety/HW/FW |

Một người có thể giữ nhiều vai trong team nhỏ; quyền mutable state/process boundary
không đổi theo nhân sự.

## 5. Definition of Ready và Done

### 5.1 DoR task

- Task ID/owner/source target/acceptance/dependency rõ trong §3.
- Product/SRS/DDD/ADR đã Active; không cần approval mới.
- Contract change có producer/consumer/migration/rollback/test list.
- Fixture và lệnh test nhỏ nhất đã xác định.

Tất cả task Plan 59 đạt DoR về tài liệu. `ORDERED` chỉ chờ output code của task
trước, không chờ quyết định.

### 5.2 DoD task

1. Source/contract/generator hoàn chỉnh, không stub/action ma.
2. Positive/boundary/negative/fault/regression test PASS.
3. Consumer cùng boundary compile/test; generated output `--check` sạch.
4. Security/safety/RT rule applicable được kiểm.
5. Docs/SRS/DDD/Trace/Risk/CHANGELOG cập nhật đúng evidence.
6. `git diff --check` và affected/full gate PASS.
7. Commit logic, PR review; finding thuộc scope sửa trước merge.
8. Không nâng target/HIL/release state nếu task chỉ có host evidence.

## 6. Gate release và NO-GO tự động

`RELEASE_READY = GO` chỉ khi:

- W0..W6 DONE trên RC commit;
- T59-701..707 có evidence immutable và verdict có authority;
- physical AO/DO cho cả ST/FBD PASS;
- 10-Program 24 h + power/restart/RETAIN/LKG + signal/fault isolation PASS;
- fresh install/upgrade/rollback/provenance/SIGNED artifact PASS;
- CI required checks PASS; không quarantine im lặng;
- Trace/Risk không còn Must thiếu disposition, P0/P1 release risk chưa accept.

Thiếu một dòng trên → `NO-GO`, nhưng không được dùng để dừng sửa code hoặc làm
các evidence task còn khả thi.

## 7. Tracker cập nhật

Sau mỗi task, sửa **chính bảng §3**: status, commit/PR, lệnh/số đo, evidence path,
finding/rollback. Không tạo tracker thứ hai. Plan 53/54/56/Tracker cũ chỉ dùng
truy nguyên As-Built đến 2026-08-20.

## 8. Lịch sử

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 1.0/1.1 | 2026-08-20 | Bản nháp 37 task chia Rev A/Rev B; superseded. |
| 2.0 | 2026-08-20 | Owner chốt một Product; 51 task/8 Wave từ contract đến release, đủ POU/library/multi-Program/signal/enable/output/HIL; mọi implementation task READY/ORDERED, không còn decision blocker. |
