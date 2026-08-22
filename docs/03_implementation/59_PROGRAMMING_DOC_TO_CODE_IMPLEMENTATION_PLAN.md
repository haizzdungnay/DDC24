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
| `T59-203` | P1 | FE PGM-04 library search/filter/detail/create/edit/version/usage | T59-202 | **DONE** | Route `projects/{id}/library` + mục nav desktop; lọc theo scope/kind/từ khoá **tải lại từ server** (không lọc trên trang đã cắt); loading/empty/error/permission tách bạch; `stateLayoutKnown=false` hiện **"chưa biết"** chứ không phải `0 B`; PID hiện cảnh báo review-gate và **không có ô tick duyệt**; ETag Draft mới được dùng lại cho thao tác kế tiếp; 8 test component/a11y; FE 115 file / **1088 test**; `--wave W2` 6/6 PASS. **Còn thiếu:** E2E real-backend thuộc `T59-505`. Chi tiết §3.3. |
| `T59-204` | P1 | Library import/export/signature/version compatibility | T59-201/106 | **DONE** | Control Library đi trong **bundle nguồn có sẵn** (DDD không mở route export library riêng); manifest thêm `systemLibraryVersion` + khối `library`; export tất định (hai lần cùng byte) và **không** mang artifact/IR/cache; import dựng lại library ở `DRAFT` với identity mới, hash entry khớp từng cái; lệch version registry SYSTEM cho **mã lỗi riêng**; corpus thù địch 10 biến thể đều bị từ chối và **0 mutation**; Seal nay publish+pin library trong cùng transaction; `go test ./... -count=1` 18/18; `--wave W2` 6/6 PASS. Chi tiết §3.3. |
| `T59-205` | P0 | PID registry trạng thái `REVIEW_REQUIRED` + policy token | T59-003/004 | **DONE** | `reviewGatedFeatures` vào profile v2 + schema; token suy ra từ chính contract (`featureId`+`libraryVersion`+`evidenceRef`), generator từ chối token bịa; gate ép ở **cả ba** đường Check (`compile_st_source` mặc định BẬT, validate CLI, `compile_fbd_source`) và độc lập producer; 8 test C++ + 1 test Go + 1 test FE + self-test generator 7/7 + G1 ghim `reviewGatedFeatures` và `approvedReviewGatedFeatures` (2 mutation mới); `ctest` 1138/1138; `go test ./... -count=1` 18/18; FE 114 file / 1080 test; `--wave W2` 6/6 PASS. Chi tiết §3.3. |

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

#### `T59-205` — Review gate PID: token từ contract, không từ checkbox

**Nguyên văn DDD §9 là ràng buộc, không phải gợi ý.** "Check blocks Commission
unless profile includes Controls/Safety approval token generated from controlled
contract — **not a UI checkbox**." Ba mệnh đề đó dẫn tới ba quyết định:

1. *Token nằm trong profile contract.* `product_profile_v2.json` thêm
   `reviewGatedFeatures`; mỗi mục có `approvalEvidenceRef` và `approvalToken`,
   **cùng có hoặc cùng rỗng**.
2. *Token phải suy ra được.* Nó là
   `sha256("mkddc-controls-safety-approval:v1" + featureId + libraryVersion + evidenceRef)`.
   Generator tính lại và từ chối mọi token không khớp, nên **không thể bịa** một
   token hợp lệ ở lớp ngoài. `libraryVersion` nằm trong miền băm có chủ ý: đổi
   semantics của entry mà giữ nguyên tên sẽ làm token cũ mất hiệu lực, thay vì
   âm thầm áp phê duyệt của bản cũ cho bản mới.
3. *Không có đường payload.* Không có trường request, header hay cờ CLI nào đặt
   được token. Consumer FE chỉ nhận `PROGRAMMING_REVIEW_GATED_FEATURES` để
   **hiển thị** trạng thái.

**Gate KHÔNG nằm trong typecheck — và đây là điểm dễ làm sai nhất.** Bản đầu đặt
nó trong `typecheck_st_program`, kết quả là 12 test đỏ: toàn bộ bộ conformance
của **chính PID** (`StExec.Pid*`, `StIntegration.Pid*`, `StRetain.*`) không
compile được nữa. Mà bộ đó chính là nơi dựng evidence Controls/Safety
(`VS-PROG-U12`) — thứ duy nhất mở khoá được gate. Đặt gate ở typecheck là **khoá
luôn cái chìa**.

Gate vì vậy là **chính sách sản phẩm ở biên Check**: `st_review_gate_check()`
riêng, được gọi ở `compile_st_source` (mặc định BẬT), ở validate CLI và ở
`compile_fbd_source`. Bộ conformance PID gọi `StCompileOptions{enforce_review_gate=false}`
với chú thích nêu đúng lý do. Mặc định là BẬT có test riêng khoá — mặc định tắt
sẽ làm mọi call site production mất gate trừ khi ai đó "nhớ bật", và nhớ bật
không phải là biện pháp an toàn.

**Ba đường Check, không hai.** Nếu chỉ gate `compile_st_source` thì validate CLI
cho PID "hợp lệ" rồi chết ở compile, còn vẽ PID bằng FBD trở thành đường vòng
hoàn toàn hợp lệ. Cả ba gọi **cùng một hàm**, và có test chứng minh gate độc lập
producer bằng cách dựng AST thẳng tay không qua parser.

**Guard hai chiều giữa profile và registry.** Entry `REVIEW_REQUIRED` trong
registry **phải** được khai trong `reviewGatedFeatures`, và feature đã khai
**phải** thật sự là `REVIEW_REQUIRED`. Bỏ chiều thứ nhất thì một feature gated
mới lọt qua mà không ai chặn; bỏ chiều thứ hai thì một feature đã duyệt bị chặn
vĩnh viễn.

**G1 ghim cả trạng thái đã duyệt.** `reviewGatedFeatures: ["PID"]` và
`approvedReviewGatedFeatures: []`. Mở PID là quyết định Controls/Safety, không
phải một dòng sửa contract lặng lẽ — nên nó làm gate đỏ cho tới khi pin đổi theo.
Test C++/Go/FE đều khoá **sự thật hiện tại**: PID đang bị chặn.

**Golden sinh lại bằng compiler thật, không sửa tay.** Profile đổi nội dung nên
`profile.sha256` và `buildKeySha256` của hai golden build manifest đổi theo. Chúng
được sinh lại bằng `mkddc-st-compile`; byte `.mkir` **không đổi** (`cmp` khớp cả
hai), xác nhận profile hash không nằm trong artifact.

**Ranh giới trung thực.** Đây là **cổng**, không phải phê duyệt. PID vẫn
`REVIEW_REQUIRED` vì `VS-PROG-U12` chưa chạy; task mở nhãn là `T59-706`. UI cảnh
báo PID thuộc `T59-203`/`T59-506`.

**Evidence level.** Host/local. Không phải GitHub CI, không phải target/HIL.

#### `T59-204` — Control Library trong bundle nguồn: hostile corpus và version compatibility

**Không thêm route export/import library.** DDD §5.1 khoá đúng ba route library
và đã có sẵn `/programming/bundles/export|import` cho trao đổi **nguồn**. Control
Library *là* nguồn của Project, nên nó đi trong bundle đó. Dựng một kênh trao đổi
thứ hai sẽ tạo hai định dạng, hai bộ kiểm và hai cách hỏng.

**Bundle mang gì và không mang gì.** `library/entries/<entryId>.json` chứa
source, interface, dependency và — chỉ với FUNCTION_BLOCK có layout
authoritative — khối `stateLayout`. Nó **không** mang `contentSha256` của bên
gửi: hash được tính lại từ nội dung canonical ở phía nhận, nên một bundle khai
hash sai không thể tự hợp thức hoá nội dung của chính nó. FUNCTION không mang
`stateLayout`; khai lại "0" ở đó sẽ biến *0 vì đúng là 0* thành *0 vì bundle nói
thế*.

**Version compatibility là mã lỗi RIÊNG.** `systemLibraryVersion` phải khớp
**chính xác** registry của controller. Bundle không hỏng — nó chỉ được xuất trên
một registry khác — nên gộp vào `ErrInvalidBundle` sẽ bảo người vận hành đi tìm
file hỏng thay vì xuất lại. Entry SYSTEM có thể đổi semantics giữa hai version;
"gần đúng" nghĩa là chạy nguồn cũ trên ngữ nghĩa mới.

**Import cấp identity MỚI cho library.** Giữ nguyên `libraryRevisionId` của bên
gửi sẽ làm hai controller khác nhau có hai nội dung khác nhau dưới **cùng một
identity**, và mọi pin sau đó trỏ mập mờ. Library nhập về ở trạng thái `DRAFT`,
không phải `PUBLISHED`: bundle là nguồn, không phải bằng chứng đã publish.

**Guard hai chiều giữa manifest và file set.** Có `library` thì phải có đúng số
file; **không** có `library` thì không được có file library nào. Bỏ chiều thứ hai
nghĩa là bundle có thể chở theo entry mà manifest không khai — đúng lối giấu nội
dung.

**Corpus thù địch, mỗi biến thể kiểm một luật.** Path traversal, đường dẫn tuyệt
đối, file thực thi, entry không có trong manifest, đổi nội dung giữ hash cũ, tự
dán `REVIEW_REQUIRED`, FUNCTION mang `stateLayout`, `entryCount` lệch, manifest
xoá khối `library` mà vẫn còn file, dependency trỏ version khác. Với các biến thể
nhắm vào luật *sau* phép so hash, test cập nhật lại descriptor để corpus kiểm
đúng luật đang nhắm chứ không dừng sớm. Mỗi lần đều xác nhận **0 Project mới** và
library nguồn không bị đụng.

**Finding thuộc phạm vi, sửa trong task: Seal Revision không đóng băng library.**
Trước task này, `SealRevision` không pin library nào — nghĩa là POU dependency
của một Revision "đã đóng băng" trỏ vào một library **vẫn sửa được**. Nay Seal
tìm Draft library của Project, publish nó và pin, **trong cùng một transaction**
với việc đóng băng Revision (`publishProjectLibraryTx` tách ra cho đúng mục đích
đó). Publish ở transaction riêng cho phép một lần crash để lại library đã publish
mà không Revision nào trỏ tới — version bị tiêu mà không ai dùng.

**Finding thứ hai: phép đếm descriptor.** `validateRevisionManifests` đếm mọi
descriptor mang `revisionId` của Revision. File library cũng mang `revisionId`
của Revision được chọn, nên phép đếm luôn lệch ngay khi bundle có library. Đã sửa
để chỉ đếm object thật của Revision.

**Ranh giới trung thực.** "Signature" ở tên task vẫn là `HASH_ONLY`: bundle có
manifest hash đầy đủ và được xác minh, nhưng **chưa ký**. Artifact/library SIGNED
cùng key custody/rotation thuộc `T59-602`. Seal đa Program (nhiều POU, nhiều
Program) thuộc `T59-301`/`T59-305`; task này chỉ đóng băng library cùng Revision.

**Evidence level.** Host/local. Không phải GitHub CI, không phải target/HIL.

#### `T59-203` — FE PGM-04 Control Library

**Trang chỉ HIỂN THỊ review-gate, không có ô tick duyệt.** PID hiện nhãn "chờ
review Controls/Safety" ở cả danh sách lẫn chi tiết, kèm câu nói thẳng rằng Check
sẽ từ chối mọi Program dùng nó. Không có checkbox, không có nút "đánh dấu đã
duyệt" — token phê duyệt suy ra từ contract profile và chỉ generator dựng được
(`T59-205`). Có test khẳng định **không tồn tại** `role="checkbox"` trên trang.

**`stateLayoutKnown=false` hiển thị là "chưa biết", không phải `0 B`.** Đây là
chỗ dễ nhất để làm hỏng ý nghĩa mà `T59-201` bỏ công tách: hiện `0 B` sẽ làm
người dùng tin một con số chưa ai tính. Test khoá cả hai chiều — thấy "chưa biết"
và **không** thấy `0 B`.

**Đổi bộ lọc là tải lại từ server.** Bộ lọc nằm trong dependency của `load`, nên
`scope/kind/q` đi thẳng vào query. Lọc phía client trên một trang đã bị cắt ở 100
item sẽ cho kết quả *đúng một phần* mà không có gì báo là thiếu.

**ETag mới được dùng lại ngay.** Mutation library đi chung lane concurrency với
tài liệu Draft (`T59-202`), nên hook trả ETag mới và trang giữ nó cho thao tác kế
tiếp. Giữ ETag cũ sẽ làm lần bấm thứ hai bị 409 mà người dùng không hiểu vì sao —
có test khoá đúng chuỗi hai mutation liên tiếp.

**Permission tách khỏi lỗi.** Viewer/operator đọc được danh sách và chi tiết
nhưng không thấy form tạo khối; trang nói rõ lý do thay vì để nút chết hoặc trả
lỗi sau khi bấm. Khối SYSTEM luôn chỉ đọc, kể cả với admin.

**Finding nhỏ, sửa trong task.** Test bản đầu đỏ vì `I18nProvider` chọn ngôn ngữ
theo `navigator.language`, nên một test khoá chuỗi tiếng Việt sẽ xanh hay đỏ tuỳ
locale của máy chạy. Đã ghim `mkddc-lang` trong `beforeEach`.

**Ranh giới trung thực.** E2E real-backend cho vòng đời library thuộc `T59-505`
(không có `page.route` mock). Trang này dùng **client sinh từ OpenAPI**, không tự
viết fetch, nên hợp đồng route/role đã được khoá ở lớp generated.

**Evidence level.** Host/local (vitest + jsdom). Không phải GitHub CI, không phải
target/HIL, và **không phải** E2E trình duyệt thật.

### W3 — Multi-Program Project, Check và Mapping

| Task | Priority | Việc làm / source chính | Dependency | Status | Acceptance |
|---|---|---|---|---|---|
| `T59-301` | P0 | Project Draft/model/API cho 32 Program + POU + signal definitions | T59-005/006 | **DONE** | Document **v2**: POU (`objects`) tách khỏi cấu hình Program, biến vào `locals` của POU, `signals` hạng nhất, bỏ `task.programOrder` theo DDD §4.1; migration v1→v2 **tất định + idempotent + giữ identity**; op mới `upsertObject/removeObject/renameObject/duplicateObject/upsertProgram(v2)/upsertSignal/...` cộng **lớp tương thích op v1** để FE đang chạy không gãy; **Program thứ 33 bị từ chối và Draft giữ đúng 32**; tên POU unique case-folded; không cascade ngầm; 7 test v2 + adapter FE 3 test; `go test ./... -count=1` 18/18; FE 116 file / 1091 test; `--wave W3` 6/6 PASS. Chi tiết §3.4. |
| `T59-302` | P0 | Package Check toàn POU/Program/library/signal/resource | T59-106/201/301 | **DONE** | Check biên dịch **mọi** Program (bỏ trần pipeline 1 của `T59-002`), **gộp** diagnostic của tất cả Program hỏng và gắn `programId` cho từng cái; `mkddc-st-package` mới lắp container v2 bằng **chính** `WritePackageV2()` production (byte-stable, đọc lại bằng loader trước khi ghi); migration `0009` cho artifact `schemaVersion∈{1,2}`; `contentSha256` tất định qua hai lần Check; Check **không** đụng Draft/Active và không sinh hành động triển khai; hai worker chia nhau Check qua lease; 5 test Check + 3 test packager; `go test ./... -count=1` 18/18; `ctest` 1138/1138; `--wave W3` 6/6 PASS. Chi tiết §3.4. |
| `T59-303` | P0 | MB_RTU binding compiler adapter qua canonical Point contract | T59-302 | **DONE** | Point contract thêm `extIndex` (slot EXT 1..256 do Point Catalog phân giải); `resolve_io_bindings` nhận MB_RTU và map thẳng sang `StPointKind::EXT` — compiler **không** tự suy slot nên không tái định nghĩa register/function code/endian/chu kỳ poll; LOCAL và MB_RTU sống chung trong một Program; thiếu `extIndex`, thiếu `deviceId`, vượt trần 256, sai chiều và kiểu `TIME` đều fail-closed; guard Go kiểm **hai chiều** (MB_RTU thiếu slot / category khác lại mang slot); 6 test C++ + 1 test Go; `ctest` **1145/1145**; `--wave W3` 6/6 PASS. Chi tiết §3.4. |
| `T59-304` | P0 | Output owner/conflict + Published Signal publisher/consumer validation | T59-302/303 | **DONE** | Bất biến cấp package kiểm ở **Check** (trước khi biên dịch) chứ không chỉ ở loader: một output binding có đúng một Program owner — nhận diện theo **điểm vật lý** (`deviceId`+`extIndex` với MB_RTU) chứ không theo tên; một signal có đúng một publisher (case-folded); publisher phải là Program có thật; freshness 1000..90000; kiểu trong hệ kiểu ST; `USE_FALLBACK` ghép cứng với giá trị dự phòng. Mọi vi phạm được **gộp** trong một lần Check; đọc chung điểm và ghi điểm riêng vẫn hợp lệ. 7 test; `go test ./... -count=1` 18/18; `--wave W3` 6/6 PASS. Chi tiết §3.4. |
| `T59-305` | P0 | Package manifest/topology/budget cho 32/16; Program mới Disabled | T59-302/304 | **DONE** | Manifest Check thêm `topology` (mỗi Program: id/tên/chu kỳ/`desiredEnabled=false`) và `budget` (32/16/20% + số Program theo từng lớp chu kỳ); topology sắp theo `programId` nên **không phụ thuộc thứ tự tạo** — hai Project cùng nội dung dựng khác thứ tự cho đúng cùng manifest; trần 32 được ép **lại** ở Check (Revision có thể tới từ bundle import) với one-over ổn định; chu kỳ ngoài ba lớp profile bị từ chối; `desiredEnabled` không có đường nào đặt true. 5 test; `go test ./... -count=1` 18/18; `--wave W3` 6/6 PASS. Chi tiết §3.4. |
| `T59-306` | P1 | FE PGM-02/03: POU tree, Program properties, mapping conflicts, signals | T59-301/304 | **DONE** | IA sáu trang đảo chiều: `projects/{id}/programs` và `.../mapping` nay là **route đích** (DDD §8), `/design` thành lối vào cũ và chuyển hướng theo `?tab=` **giữ nguyên** query định vị lỗi; nav trỏ route mới; cây POU gom ba nhóm Programs/Functions/Function Blocks đọc document v2 **trực tiếp**; inspector **ẩn** chu kỳ và trạng thái bật với Function/FB (không hiện rồi xám); Program hiện `Tắt (mặc định cho Program mới)`; 11 test FE mới; FE **118 file / 1102 test**; `--wave W3` 6/6 PASS. **Còn thiếu:** E2E real-backend Draft save/reload thuộc `T59-505`. Chi tiết §3.4. |

### 3.4 Ghi chú thực thi W3

#### `T59-301` — Document v2: POU, 32 Program và Published Signal

**Ba khác biệt bản chất so với v1, mỗi cái sửa một lỗi mô hình thật.**

1. *POU tách khỏi cấu hình Program.* `objects` giữ mã nguồn và interface;
   `programs` chỉ giữ chu kỳ và trỏ tới một object kind `PROGRAM`. Trộn hai thứ
   như v1 làm "đổi chu kỳ" và "sửa mã" đụng cùng một bản ghi — mọi diff, mọi
   impact và mọi hash đều không phân biệt được hai loại thay đổi đó.
2. *Bỏ `task.programOrder`.* DDD §4.1 cấm expose Task order và §7.1 quy định mỗi
   Program tự release theo deadline riêng. Giữ một mảng thứ tự là **hứa một ngữ
   nghĩa mà runtime không thực hiện**.
3. *`signals` là công dân hạng nhất*, không phải biến toàn cục ẩn, và mang đủ
   publisher/freshness/policy/fallback ngay ở Draft.

**Migration v1→v2 không sinh identity mới.** Chạy hai lần trên cùng document cho
**đúng cùng byte**, và chạy lại trên chính kết quả v2 là no-op. Mọi `programId`,
`variableId`, `bindingId` cũ được giữ nguyên: đổi identity khi migrate sẽ làm mọi
Revision đã seal trỏ vào hư không. Chu kỳ của Task v1 trở thành chu kỳ của từng
Program; biến v1 vào `locals` của đúng POU sở hữu; binding v1 được nối lại với
`programId` + tên biến.

**Lớp tương thích op v1 là bắt buộc, không phải tiện lợi.** FE đang chạy và mọi
bundle/test hiện có nói ngôn ngữ v1. Đổi cả model lẫn toàn bộ consumer trong một
bước là cách chắc chắn để một consumer bị bỏ quên rồi hỏng lặng lẽ. Op v1 giữ
NGUYÊN tên và được dịch sang v2 tại một chỗ; phân biệt v1/v2 theo **hình dạng
payload** (`program.objectId` chỉ có ở v2, `program.document` chỉ có ở v1).
Binding v1 giữ hình dạng **mở** — Mapping tab ghi thêm `point`, `dataType`,
`unit`, `writable`; giải mã chặt ở đây sẽ từ chối đúng dữ liệu mà lớp Check đang
đọc.

**Trần 32 là trần cứng và Draft không nhận nửa vời.** Program thứ 33 bị từ chối
và cả POU đi kèm cũng **không** được ghi — test kiểm cả hai, vì một Draft nhận
POU rồi từ chối Program sẽ để lại rác mà người dùng không thấy.

**Không cascade ngầm.** Xoá POU đang có Program, hoặc xoá Program đang publish
signal, đều **báo lỗi** thay vì xoá kèm. Xoá kèm làm người dùng mất cấu hình mà
không ai nói.

**`USE_FALLBACK` và giá trị dự phòng đi liền nhau.** Bắt buộc có với
`USE_FALLBACK`, cấm có với ba chính sách còn lại — đúng lối "im lặng thay bằng 0"
mà DDD §10 cấm. Dải `freshnessMs` 1000..90000 khớp **chính xác** `CHECK` của
store: hai lớp nói khác nhau nghĩa là lớp trên nhận rồi lớp dưới chối.

**Ba consumer được sửa theo, không nhân bản dữ liệu.**

- `ioMapFromRevision` đọc `locals` của POU thay vì object kind `VARIABLE`. Nhân
  bản biến ra một object thứ hai chỉ để lớp này đọc được là cách hai bản trôi
  khỏi nhau ngay lần sửa sau.
- `revisionChangeCategory` phân loại `RETAIN` từ **tập biến RETAIN** của POU. Bỏ
  nhánh này thì impact RETAIN im lặng biến mất và Commission không còn hỏi
  acknowledgement RETAIN nữa. So cả payload sẽ báo RETAIN cho mọi lần sửa mã, nên
  chỉ so chữ ký của các biến `retain=true`.
- `compilerInput` đọc **cả hai** tên (`objectId`/`source` và `programId`/
  `document`): một Revision seal trước khi nâng model vẫn phải Check lại được.

**Cấu hình Program đi trong payload POU, không thành object riêng.**
`revision_objects` khoá theo `object_id` duy nhất và Program là quan hệ 1:1 với
đúng một PROGRAM POU. Tách thành hai Revision object buộc phải **bịa một UUID
thứ hai cho cùng một thứ**.

**Trần dưới của Revision object hạ từ 2 xuống 1.** v2 bỏ object `TASK`, nên một
Project chưa có POU nào seal ra đúng một object `METADATA` — đó là trạng thái hợp
lệ, không phải bundle hỏng.

**FE: một adapter, không sửa bốn tab.** `toWorkspaceDocument` chiếu v2 về view
model mà bốn tab Design đang dùng. Đường **ghi** vẫn là op v1, nên đổi cả đọc lẫn
ghi cùng lúc sẽ là hai thay đổi lớn chồng nhau. Chuyển tab sang mô hình v2 nguyên
bản thuộc `T59-306`; tới lúc đó adapter biến mất. Chu kỳ lạ rơi về 1000 thay vì
ép kiểu — giao diện không được hiện một chu kỳ mà profile không cho phép.

**Ranh giới trung thực.** Đây là **model + Draft API**. Check đa Program thuộc
`T59-302`; binding MB_RTU thuộc `T59-303`; kiểm output owner/publisher ở cấp
package thuộc `T59-304`; UI PGM-02/03 thuộc `T59-306`.

**Evidence level.** Host/local. Không phải GitHub CI, không phải target/HIL.

#### `T59-302` — Check cấp package: mọi Program, gộp diagnostic, container thật

**Bỏ trần pipeline "một Program mỗi lần chạy".** `T59-002` ghi rõ đây là giới hạn
giai đoạn chứ không phải capacity sản phẩm, và task này gỡ nó: `compilerInputs`
dựng input cho **mọi** Program, sắp theo `objectId` để thứ tự biên dịch — và do
đó thứ tự diagnostic — không phụ thuộc thứ tự đọc DB.

**Gộp diagnostic thay vì dừng ở Program đầu tiên hỏng.** Dừng sớm bắt người dùng
sửa từng lỗi rồi chạy lại Check; với 32 Program đó là 32 vòng. Mỗi diagnostic
được gắn `programId` của chính nó — compiler một-nguồn không biết nó đang ở
Program nào nên luôn trả chuỗi rỗng, và **một mã lỗi không kèm Program là một mã
lỗi không dùng được**: người đọc không biết mở file nào.

**Container v2 do CHÍNH writer production ghi.** `mkddc-st-package` là CLI mới
gọi đúng `WritePackageV2()` mà golden và fuzz của `T59-106` đang canh, rồi **đọc
lại bằng chính loader** trước khi ghi ra đĩa. Cài lại định dạng bằng Go sẽ tạo bản
thứ hai cho cùng một format, và bản thứ hai luôn là bản quên cập nhật. CLI
**không** biên dịch lại gì: nó nhận đúng blob IR v1 mà Check vừa tạo, nên hash
package suy được từ hash các thành phần.

**Vì sao không để Check PASSED mà thiếu artifact.** Store ép bất biến "PASSED ⇒
có Artifact" từ v1, và bất biến đó đúng: một Check báo *sẵn sàng* trong khi không
có gì nạp được là một Check nói dối. Vì vậy multi-Program **phải** có container
thật — đó là lý do packager được làm ngay ở task này thay vì đẩy sang `T59-305`.
Khi không có packager, Check **fail-closed** và nêu đúng thứ còn thiếu.

**Hai con số hash, hai câu hỏi khác nhau.** `contentSha256` băm dãy
`(programId, artifactSha256)` — tất định theo **nội dung**, không phụ thuộc
container. `containerSha256` là hash của chính package đã ghi. Gộp chúng lại sẽ
làm mất khả năng trả lời riêng "nội dung có đổi không" và "byte nạp lên Core là
gì".

**Migration `0009` mở `schema_version ∈ {1,2}` cho `artifacts`.** CHECK cũ viết
cứng `= 1` từ thời mỗi Revision chỉ có một Program; giữ nguyên nó sẽ chặn đúng
thứ Check vừa dựng được, và chặn ở lớp DB nên lỗi hiện ra rất xa nguyên nhân.
Rebuild giữ **nguyên** hình dạng mà migration v3 đã chốt: **không** có UNIQUE trên
content hash (v3 bỏ có chủ ý — hai Check có byte deterministic giống nhau là
chuyện bình thường), và giữ lại index cùng hai trigger bất biến.

**Finding trong chính task.** Bản đầu của `0009` vô tình đưa lại UNIQUE trên
`(sha256, profile, target_abi)` và làm rơi index/trigger, tái tạo đúng lỗi mà
migration v3 đã sửa. Test `TestCheckLeaseIdempotencyAtomicArtifactAndDeterministicDedup`
bắt được ngay — đó là giá trị của việc chạy **toàn bộ** bộ test sau mỗi migration.

**Ba bất biến còn lại được khoá bằng test.** Check **không** đụng Draft (ETag và
content hash không đổi) và **không** sinh hành động triển khai nào trong audit,
kiểm ở **cả hai** chiều đạt/hỏng — chỉ kiểm chiều hỏng sẽ bỏ lọt đúng trường hợp
Check đạt rồi tự ý kích hoạt. Hai worker chạy đồng thời chia nhau Check qua lease
và Program chỉ được biên dịch đúng số lần cần thiết.

**Ranh giới trung thực.** Bảng POU signature trong container hiện chỉ khai
`PROGRAM`; signature đầy đủ (FUNCTION/FB, cổng, kiểu), signal defs, binding
manifest, resource budget và `desiredEnabled=false` cho Program mới thuộc
`T59-305`. Khai thiếu tốt hơn khai bừa: loader kiểm bảng này và một bản khai sai
sẽ được nạp **như thật**.

**Evidence level.** Host/local. Không phải GitHub CI, không phải target/HIL.

#### `T59-303` — MB_RTU đi qua Point contract, compiler không sở hữu giao thức

**Ranh giới quyết định toàn bộ thiết kế.** Compiler **không biết** register,
function code, endian hay chu kỳ poll — và nó không được biết. Ánh xạ một điểm
Modbus sang vị trí trong SHM là việc của hệ Modbus RTU. Vì vậy contract Point
thêm đúng một trường: `extIndex` — slot EXT `1..KX_N_EXT` mà **Point Catalog**
phân giải. Compiler nhận nó nguyên trạng và map thẳng sang `StPointKind::EXT`.

**Vì sao không suy `extIndex` từ `pointId`.** Suy nó ở đây nghĩa là định nghĩa
lại ánh xạ Modbus ở lớp **không sở hữu** nó, và hai định nghĩa sẽ trôi khỏi nhau
— đúng cơ chế đã sinh ra drift ở registry Control Library. Thiếu `extIndex` là
**thiếu dữ liệu**, và câu trả lời đúng là từ chối chứ không đoán.

**IR không cần đổi.** `StPointKind::EXT = 7` và `StPointCategory::MB_RTU` đã có
sẵn từ trước với `st_point_kind_limit(EXT) = KX_N_EXT`; thứ thiếu duy nhất là
`resolve_io_bindings` chặn category này. Container/artifact vì thế
**byte-compatible** với bản cũ.

**Identity là cặp `(deviceId, pointId)`.** Thiếu `deviceId` thì hai thiết bị có
thể dùng cùng tên điểm và identity mất tính duy nhất — bị từ chối.

**Guard hai chiều ở lớp BE.** `extIndex` chỉ có nghĩa với MB_RTU: MB_RTU thiếu
slot bị chặn, và category khác **mang** slot cũng bị chặn. Bỏ chiều thứ hai là mở
một trường vô nghĩa mà lớp sau phải đoán xem có nên tin hay không.

**Hai test cũ được thay vì chúng khoá đúng thứ task này gỡ.**
`RejectsUnsupportedCategoryMbRtu` khoá hành vi "MB_RTU không hỗ trợ" — nay thay
bằng `RejectsMbRtuWithoutResolvedExtIndex` (đúng thứ vẫn phải bị từ chối) và
`RejectsCategoryOutsideAllowlist` (giữ nguyên phép kiểm category cho `BACNET`).
Xoá mà không thay thế sẽ để mất phép kiểm allowlist.

**Ranh giới trung thực.** Point Catalog phía BE **chưa** phát `extIndex` cho
Mapping tab; đường đó cùng UI chọn điểm MB_RTU thuộc `T59-306`. Nghiệm thu I/O
Modbus thật trên board thuộc `T59-703`.

**Evidence level.** Host/local. Không phải GitHub CI, không phải target/HIL.

#### `T59-304` — Bất biến cấp package kiểm ở Check, không chỉ ở loader

**Vì sao kiểm lại thứ loader đã kiểm.** Loader v2 (`T59-106`) kiểm "một output
owner" và "một publisher" vì artifact có thể tới từ nơi khác. Nhưng loader chạy
lúc **Commission** — báo lỗi ở đó nghĩa là báo ở chỗ **xa nguyên nhân nhất**, sau
khi người dùng đã đi qua toàn bộ Check và bấm triển khai. Kiểm ở Check là thứ duy
nhất cho người dùng biết **phải sửa gì**.

**Kiểm TRƯỚC khi biên dịch.** Một package có hai Program cùng ghi một output là
package sai bất kể từng Program compile sạch hay không; biên dịch 32 Program rồi
mới báo là lãng phí đúng thứ người dùng đang chờ.

**Nhận diện theo ĐIỂM VẬT LÝ, không theo chuỗi tên.** Với MB_RTU, hai binding
cùng `(deviceId, extIndex)` là **cùng một thanh ghi** kể cả khi tên điểm viết
khác nhau. So bằng tên sẽ bỏ lọt đúng trường hợp nguy hiểm — và đó là trường hợp
dễ xảy ra nhất khi hai kỹ sư đặt tên khác nhau cho cùng một điểm.

**Chiều khẳng định cũng được khoá.** Hai Program **đọc chung** một điểm là hợp
lệ; mỗi Program ghi một điểm riêng là hợp lệ. Guard chặn tất cả cũng là guard sai
và sẽ "xanh" ở mọi test phủ định.

**Bốn luật của Published Signal.** Đúng một publisher (so **case-folded** — hai
tên khác hoa/thường là một signal ở compiler); publisher phải là Program có thật
(signal mất publisher là signal không ai ghi, consumer chờ vĩnh viễn); freshness
`1000..90000` khớp chính xác dải mà store và runtime cùng dùng; và `USE_FALLBACK`
ghép cứng với giá trị dự phòng — đúng lối "im lặng thay bằng 0" mà DDD §10 cấm.

**Gộp, không dừng sớm.** Cùng lý do với `compilerInputs`: mọi vi phạm của package
hiện ra trong **một** lần Check.

**Đọc được cả hai đời binding.** Binding v1 để identity điểm ở cấp gốc, v2 gom
vào `point`; hàm kiểm đọc cả hai để một Revision seal trước khi nâng model vẫn
kiểm được.

**Ranh giới trung thực.** Đây là kiểm **định nghĩa**. Consumer thật của signal
(đọc giá trị trong ST/FBD), double-buffer, freshness runtime và fallback lúc chạy
thuộc `T59-404`; trọng tài output và candidate withdrawal thuộc `T59-406`.

**Evidence level.** Host/local. Không phải GitHub CI, không phải target/HIL.

#### `T59-305` — Topology và budget: không bám thứ tự tạo, Program mới luôn Disabled

**Thứ tự tạo là dữ liệu của quá khứ, không phải của package.** Topology sắp theo
`programId` chứ không theo thứ tự xuất hiện trong tài liệu. Nếu manifest bám thứ
tự tạo thì hai Project **cùng nội dung** nhưng dựng theo thứ tự khác nhau sẽ cho
hai package khác nhau — và mọi so sánh provenance giữa hai controller mất nghĩa.
Test đảo thứ tự đầu vào và đòi manifest **giống hệt**.

**Program mới LUÔN `desiredEnabled=false`.** Package không được tự bật thứ vừa
được nạp: bật là một quyết định vận hành riêng, có audit riêng, và người vận hành
phải thấy nó **trước khi** nó chạy (DDD §0/§4.3). Không có đường nào đặt cờ này
true ở lớp này, nhưng phép kiểm vẫn giữ — một package tự bật Program là một
package tự triển khai chính nó.

**Trần 32 được ép LẠI ở Check.** `T59-301` đã ép ở Draft, nhưng một Revision có
thể tới từ **bundle import** hoặc từ một Draft cũ hơn. Check là biên cuối trước
khi package thành artifact, nên nó không được tin lớp trước. One-over báo đúng
`ST-LIM-009` với `limit` là trần sản phẩm thật, không phải một con số khác.

**Chu kỳ ngoài ba lớp profile bị từ chối.** Một chu kỳ lạ là một lớp lập lịch
**không tồn tại**; chấp nhận nó ở Check chỉ đẩy lỗi xuống runtime, nơi nó biểu
hiện thành deadline miss chứ không thành một câu trả lời hiểu được.

**Budget đếm theo từng lớp chu kỳ.** Đây là dữ liệu mà scheduler (`T59-402`) dùng
để phân bổ, nên đếm sai ở đây là phân bổ sai ở đó. Trần `32/16/20%` lấy từ profile
sinh, không phải hằng viết trong code.

**Ranh giới trung thực.** Trần **16 Enabled** được *ghi* vào manifest nhưng chưa
được *thi hành* ở đây: nó chỉ có nghĩa khi có intent enable thật, và đường đó là
`T59-405`. Ngân sách thời gian thực (`budgetUs` theo Program, deadline, đo tải)
thuộc `T59-402`. Bảng POU signature đầy đủ trong container vẫn thuộc phần còn lại
của lane compiler.

**Evidence level.** Host/local. Không phải GitHub CI, không phải target/HIL.

#### `T59-306` — IA sáu trang: đảo chiều route và cây POU kind-aware

**Đảo chiều `design` ↔ `programs/mapping`.** DDD §8 khoá sáu route, trong đó
`projects/{id}/programs` (PGM-02) và `.../mapping` (PGM-03) là **route đích**.
Trước task này chúng chỉ là redirect **tới** `/design`; nay ngược lại. Lý do
không giữ nguyên: IA là hợp đồng điều hướng, và để route đích làm redirect nghĩa
là địa chỉ thật của trang không bao giờ xuất hiện trên thanh URL — mọi link chia
sẻ, bookmark và báo lỗi đều trỏ vào lối vào cũ.

**Route thắng query.** `DesignWorkspacePage` nhận `route` cố định tab; nếu query
thắng thì `/mapping?tab=programs` sẽ hiện một trang **không khớp địa chỉ của
chính nó**.

**Lối vào cũ giữ nguyên query định vị lỗi.** Một link báo lỗi cũ mang theo
`program/line/column`; mất chúng nghĩa là mất luôn vị trí lỗi. `tab=execution`
chưa có route đích riêng trong IA sáu trang nên nó đi tiếp dưới dạng query trên
`/programs` — giữ hành vi thay vì im lặng bỏ mất.

**Cây POU đọc document v2 TRỰC TIẾP.** Ba nhóm `Programs`/`Functions`/
`Function Blocks` với số đếm, sắp theo tên. Đây là phần IA mới nên nó không đi
qua adapter tương thích của `T59-301`; editor cũ bên dưới vẫn dùng adapter cho
tới khi lane editor chuyển sang v2.

**Inspector ẨN trường không có nghĩa, không hiện rồi xám.** Một FUNCTION không có
chu kỳ và không có trạng thái bật — nó không phải đơn vị lập lịch. Hiện một ô
"chu kỳ" bị xám vẫn **nói rằng khái niệm đó tồn tại ở đây**, và người dùng sẽ đi
tìm cách bật nó. Thay vào đó trang nói thẳng: POU dùng chung chỉ chạy khi được
Program gọi. Program hiện `Tắt (mặc định cho Program mới)` — khớp đúng
`desiredEnabled=false` mà `T59-305` ghi vào topology.

**Ranh giới trung thực.** E2E real-backend cho Draft save/reload thuộc `T59-505`
(không `page.route` mock). Mapping conflict **hiển thị** trên UI cần diagnostic
của Check đi tới trang Mapping — đường đó gắn với `T59-503`; luật conflict đã
được ép ở BE (`T59-304`) nên không có đường nào tạo được cấu hình xung đột mà
Check bỏ qua.

**Evidence level.** Host/local (vitest + jsdom). Không phải GitHub CI, không phải
target/HIL, và **không phải** E2E trình duyệt thật.

### W4 — Runtime, scheduler, signal, Enable/Disable và output

| Task | Priority | Việc làm / source chính | Dependency | Status | Acceptance |
|---|---|---|---|---|---|
| `T59-401` | P0 | Package coordinator/loader v2 + topology image, bỏ hardcode `program-main` | T59-106/305 | **DONE** | `UnpackPackageV2` dùng **chung một parser** với loader (không bản thứ hai); coordinator probe v1/v2 và dựng topology theo **chính package** — bootstrap không còn phải biết trước tên Program; `instance_id` bỏ hardcode `program-main`, thay bằng validator định dạng; stage/arm/rollback/start chạy trên **toàn bộ** tập instance; gói hỏng để lại **0 mutation** (mọi stage trước đó bị huỷ); `instance_ids()` cho read-back; 4 test mới; `ctest` **1149/1149**; `--wave W4` 5/5 PASS. Chi tiết §3.5. |
| `T59-402` | P0 | Per-Program due queue/state/period/budget/metrics, max 16 | T59-401 | **DONE** | Chu kỳ release theo **từng Program** (`st_program_due`/`st_program_mark_released`), bù trôi theo mốc **lý thuyết**, lỡ chu kỳ thì **đếm và bỏ** chứ không chạy bù; chu kỳ đi **trong PROGRAM_TABLE của package** nên hai controller cùng gói chạy cùng dãy release; writer **và** loader cùng từ chối chu kỳ ngoài ba lớp profile; trần **16 Program chạy đồng thời** ép ở `start()`; thứ tự chạy độc lập thứ tự tạo; đo `last_exec_ns`/`max_exec_ns`/`missed_release_count` theo Program. Sửa kèm: package v2 **không sống sót reboot** (đường restore nạp nguyên container như artifact v1). 11 test mới; `ctest` **1159/1159**; `--wave W4` 5/5 PASS. Chi tiết §3.5. |
| `T59-403` | P0 | Worker lanes/fault isolation/no-allocation RT | T59-402 | **DONE** | Lane là đơn vị song song (`StLaneMode::SEQUENTIAL|PARALLEL`, worker tạo sẵn ngoài chu kỳ, spin+yield không vào kernel); hai chế độ cho **đúng cùng** kết quả trên fixture 10 Program/3 chu kỳ/4 lane, ổn định qua 20 lần lặp; **đảo chiều** chính sách fault — fault của một Program **không** còn dừng cả Task (kiến trúc §8 `isolate Program`); đường quét **0 cấp phát** ở cả hai chế độ; lane vượt số worker vẫn chạy nốt trên luồng gọi. 7 test mới; `ctest` **1166/1166**; TSan 0 cảnh báo. Chi tiết §3.5. |
| `T59-404` | P0 | Published Signal double-buffer/freshness/policy | T59-402/304 | **DONE** | `StSignalBus` double-buffer, commit ở **boundary** nên mọi consumer trong một chu kỳ thấy cùng một ảnh; **0 đọc rách** qua 20.000 vòng publisher/consumer song song trên `StCell` 8 byte; ba chính sách `HOLD_LAST`/`USE_FALLBACK`/`WAIT` cho ba hành vi khác nhau, "chưa ai publish" khác "quá hạn"; producer dừng thì giá trị **quá hạn theo freshness** chứ không biến mất tức thì, hồi phục ngay ở boundary kế. Sửa kèm: signal **chưa từng** đi vào container (bus runtime luôn rỗng) và `stalePolicy` **không phải enum đóng** ở Check. 15 test mới; `ctest` **1179/1179**; `--wave W4` 5/5 PASS. Chi tiết §3.5. |
| `T59-405` | P0 | Product Enable/Disable store→API→IPC→Core→read-back/audit | T59-401/006 | **DONE** | Đường đầy đủ: store (`program_runtime_intents`, migration **v10**) → API (`PUT .../programs/{id}/runtime-intent`, `GET .../programs`, RBAC admin/viewer, idempotency) → IPC (**action mới** `SET_PROGRAM_ENABLED`, protocolMinor 0→1 tương thích ngược) → Core (`set_program_enabled` áp lên đúng một instance) → read-back + audit **cùng một transaction**. Intent và trạng thái là **hai trường riêng**; Core từ chối/không sẵn sàng vẫn giữ intent bền vững. Trần 16 Enabled ép ở **hai** lớp. Sửa kèm: trigger `generation` chặn cả read-back; biên nhận idempotency đòi ETag cho mutation không thuộc Draft. 10 test mới; `ctest` **1180/1180**; `--wave W4` 5/5 PASS. Chi tiết §3.5. |
| `T59-406` | P0 | Candidate registry/withdrawal/output ownership/arbitration/interlock/safe-state | T59-403/405 | **DONE (đóng trọn 2026-08-21)** | `ProgramCandidateRegistry` trả lời **ai đang giữ output nào và vì sao không còn giữ** (enum lý do đóng: `OPERATOR_DISABLE`/`FAULT_TTL_EXPIRED`/`PACKAGE_REPLACED`); bất biến một-output-một-owner ép **lại** ở runtime; rút candidate → trọng tài rơi đúng **mức tiếp theo → default**, không kẹt ở giá trị cuối của Program đã dừng; gói mới xoá sạch quyền sở hữu cũ; luật **không có đường Program→IOP trực tiếp** kiểm bằng đọc chính mã nguồn. 9 test mới; `ctest` **1187/1187**; `--wave W4` 5/5 PASS. **Mục treo cuối cùng đã đóng 2026-08-21 bằng `ADR-051`:** TTL hold-last = **60 s đồng hồ**, đo tuổi của LỆNH (phủ cả `ROLLED_BACK`/Task-bị-disable, không riêng `FAULTED`), mặc định `ScanDeps` là giá trị đã ký thay vì `0`; 5 test mới, `ctest` **1205/1205**. Chi tiết §3.5. |
| `T59-407` | P0 | Per-Program/FB RETAIN namespace/layout/restart/reset | T59-104/401 | **DONE** | Sửa lỗi **reset nửa vời**: reset trên Program đang DỪNG chỉ sạch trong RAM, file bền vững giữ giá trị cũ nên khởi động lại là giá trị cũ quay về. Nay reset công bố ảnh đã reset **ngay tại boundary**, không phụ thuộc trạng thái chạy. Ma trận warm/cold/revision/corrupt/reset đóng đủ; reset **cô lập** giữa Program; file hỏng của một Program **không** làm Program khác cold-init. 3 test mới; test chống hồi quy đã kiểm chứng bằng cách gỡ bản vá (đỏ đúng chỗ); `ctest` **1191/1191**; `--wave W4` 5/5 PASS. Chi tiết §3.5. |
| `T59-408` | P1 | Core trace ring buffer + real `TRACE_START/STOP` | T59-402/006 | **DONE** | `StValueTrace` lấy mẫu tại **ranh giới quét**, bounded 10.000 Ô / 10 phút, **0 cấp phát**; ba action IPC thật `TRACE_START`/`TRACE_STOP`/`TRACE_READ` (protocolMinor 1→2, tương thích ngược); BE gọi **thật** xuống Core; **action ma = 0** — bảng handler không còn `NOT_IMPLEMENTED` nào, có test ở cả Go lẫn verifier. Sửa kèm: self-test verifier IPC bám vào `TRACE_START` nên thành no-op ngay khi nó được hiện thực; luật "`NOT_IMPLEMENTED` phải ghi task" thoát khỏi phép kiểm vì thoát sớm ở phép kiểm khác. 10 test mới; `ctest` **1200/1200**; `--wave W4` 5/5 PASS. Chi tiết §3.5. |

### 3.5 Ghi chú thực thi W4

#### `T59-401` — Coordinator nạp package v2, bỏ hardcode `program-main`

**Một parser, không hai.** `UnpackPackageV2` giữ lại blob IR nhưng dùng **đúng
cùng** hàm parse với `LoadPackageV2` — chỉ khác một tham số `ir_out`. Viết một
parser thứ hai để "chỉ lấy blob" sẽ tạo hai bộ ngữ nghĩa cho một định dạng, và
bản thứ hai luôn là bản quên cập nhật khi format đổi. Parser cũng ép **mỗi
Program đúng một blob IR**: lệch số nghĩa là gói thiếu thân chương trình cho một
Program nào đó, và nạp nó sẽ cho một instance không chạy được mà không ai báo.

**Tên Program là dữ liệu của PACKAGE.** Trước task này, coordinator đòi
`instance_id == "program-main"` và đòi bootstrap khai sẵn instance đó. Nghĩa là
mỗi lần đổi tên Program phải sửa tiến trình khởi động — và chỉ nạp được đúng một
Program mãi mãi. Nay `ensure_topology` **thêm instance còn thiếu** vào scheduler
theo đúng danh sách trong package.

**Bỏ hardcode KHÔNG có nghĩa là nhận mọi chuỗi.** `valid_instance_id` ép ASCII in
được, không dấu phân cách đường dẫn, 1..64 ký tự — instance id đi vào scheduler
và vào journal nên nó phải là identity ổn định. Test khoá bốn chuỗi độc hại
(`../escape`, rỗng, 65 ký tự, có khoảng trắng).

**Vòng đời chạy trên TOÀN BỘ tập instance.** Stage, arm (`commit_staged_activation`),
rollback và `start` đều lặp qua `instance_ids_`. Chỉ xử lý instance chính sẽ để
package ở trạng thái **nửa cũ nửa mới** ngay tại boundary kế tiếp — đúng loại
trạng thái mà không lớp nào phía sau phát hiện được.

**Gói hỏng để lại 0 mutation.** Một Program stage lỗi thì mọi Program đã stage
trước đó bị `abort_staged_activation`. Nạp nửa gói là nạp một cấu hình **chưa
từng được Check**.

**Dual-reader còn sống.** Artifact v1 (một Program) vẫn nạp được qua đúng đường
cũ; test khoá nó. Nếu probe từ chối v1 thì **một lần nâng cấp là mất bản LKG cuối
cùng** (DDD §12.1).

**Ranh giới CMake có chủ ý.** `st_package_v2.cpp` (+ `st_pou_registry`,
`st_fb_instance_layout` mà nó cần) chuyển sang `core_application`; chúng bị **gỡ
khỏi** `st_compiler_lib` vì lib đó link `core_lib`, biên dịch lại sẽ tạo ký hiệu
trùng. Không link cả `st_compiler_lib` vào `mkddc-core`: compiler không có việc
gì trên bộ điều khiển đang chạy.

**Ranh giới trung thực.** Đây là **nạp và dựng topology**. Lập lịch từng Program
theo chu kỳ riêng, hàng đợi due và ngân sách thuộc `T59-402`; `instance_id_` vẫn
được giữ làm instance chính vì journal v1 ghi một id — đổi định dạng journal ở
đây sẽ làm mọi bản ghi cũ không đọc được.

**Evidence level.** Host/local. Không phải GitHub CI, không phải target/HIL.

#### `T59-402` — Chu kỳ, hàng đợi due và ngân sách theo từng Program

**Task đến hạn KHÔNG có nghĩa mọi Program đến hạn.** Một package hợp lệ có ba lớp
chu kỳ (1 s / 5 s / 30 s) chạy trong cùng một Task. Trước task này `run_task`
chạy **mọi** Program mỗi lần Task tới hạn, nên một Program 30 s thực chất chạy
30 lần nhiều hơn thiết kế — sai không phải ở chỗ chậm, mà ở chỗ **kết quả khác**
với thứ người dùng cấu hình. Nay `st_program_due()` quyết định từng Program.

**Bù trôi theo mốc LÝ THUYẾT, không theo thời điểm chạy thật.** `next_release_ns`
cộng từ deadline trước đó chứ không từ `now`. Bám thời điểm thật sẽ làm một tick
trễ 300 ms đẩy **mọi** deadline sau đó trôi theo, và sau vài giờ chu kỳ danh
nghĩa 1 s không còn là 1 s. Test khoá đúng ca này: trễ 300 ms ở tick thứ hai
nhưng deadline kế tiếp vẫn là mốc 2000 ms.

**Lỡ chu kỳ thì ĐẾM và BỎ.** Nhảy từ 0 lên 5,4 s làm lỡ bốn mốc;
`missed_release_count` tăng 4 và Program chạy **một** lần. Chạy bù bốn lần là
cách chắc chắn nhất để một lần quá tải trở thành một chuỗi quá tải.

**Chu kỳ là dữ liệu của PACKAGE.** `PROGRAM_TABLE` nay mang `periodMs` +
`budgetUs` cho từng Program, và coordinator áp chúng lên instance mỗi lần dựng
topology — kể cả khi instance đã tồn tại, vì một gói mới có thể đổi chu kỳ của
Program cũ. Để runtime tự chọn chu kỳ nghĩa là hai controller nạp **cùng một
gói** chạy hai dãy release khác nhau, và mọi tuyên bố "cùng package cho cùng
hành vi" mất nghĩa. Golden v2 được sinh lại bằng chính writer production, mang
**hai chu kỳ khác nhau** để phân biệt "đọc đúng trường" với "đọc trúng may".

**Chu kỳ lạ bị chặn ở CẢ writer lẫn loader.** Loader không được tin writer: gói
tới tay runtime có thể do một writer khác phiên bản sinh. Một lớp lập lịch không
tồn tại chấp nhận ở đây chỉ đẩy lỗi xuống runtime, nơi nó biểu hiện thành
deadline miss chứ không thành một câu trả lời hiểu được.

**Trần 16 ép ở nơi Program THỰC SỰ bắt đầu tác động.** `start()` đếm số Program
đang RUNNING. Ép ở lớp cấu hình chỉ chặn được *ý định*; ép ở đây chặn được *hành
vi*. Trần là trần **động**: dừng một Program giải phóng đúng một suất.

**Thứ tự chạy độc lập với thứ tự tạo.** `add_program` chèn theo `order` (rồi
`instance_id` khi cần tie-break) thay vì nối đuôi. Hai controller nạp cùng một
package theo thứ tự khác nhau phải chạy cùng một dãy. `order` vẫn phải **duy
nhất** trong Task — cho phép trùng sẽ biến thứ tự chạy thành thứ phụ thuộc vào
tie-break, tức là thành thứ có thể đổi khi ai đó sửa tie-break.

**Sửa kèm — package v2 không sống sót reboot.** `load_active_checkpoint` nạp
**nguyên khối** container vào một instance như thể là artifact v1; loader IR v1 từ
chối magic `MKDDCIR2` và thiết bị tỉnh dậy **không có Program nào** — hỏng đúng
vào lúc không ai đang nhìn. Nay đường khôi phục đi qua **đúng** `split_package` +
`ensure_topology` như đường stage. Ma trận fault/power đầy đủ vẫn thuộc `T59-501`;
đây chỉ là bịt lỗ do `T59-401` mở ra.

**Sửa kèm — bảng section golden không được canh.** `verify_programming_g1_contracts.py`
ghim hash golden và `artifactBytes` nhưng **không** đối chiếu bảng section trong
manifest với bảng thật trong file. Nghĩa là một lần đổi bố cục section có thể để
lại manifest mô tả một file không còn tồn tại, trong khi hash vẫn "khớp pin" vì
pin cũng vừa được sửa. Nay có `golden_sections()` + self-test 25 ca sai lệch.

**Ranh giới trung thực.** Đây là **luật release và trần chạy đồng thời**. Worker
lane, cô lập lỗi và ràng buộc không cấp phát trong RT thuộc `T59-403`; đo tải
theo lớp chu kỳ mới chỉ dừng ở `last_exec_ns`/`max_exec_ns` trên từng instance,
chưa có đường công bố ra API.

**Evidence level.** Host/local. Không phải GitHub CI, không phải target/HIL.

#### `T59-403` — Lane, cô lập lỗi và ràng buộc không cấp phát

**Đảo chiều chính sách fault, có chủ ý.** Trước task này, fault của MỘT Program
dừng cả Task (`break` trong vòng chạy). Lý do ghi trong code — "các Program trong
một Task thường phối hợp" — thuộc về thời Task chỉ có một Program và mọi trao đổi
là ngầm. Trong mô hình đa Program, kiến trúc §8 quy định `isolate Program`, và
trao đổi giữa Program đi qua Published Signal có chính sách fallback **khai báo**
cho đúng tình huống producer chết. Giữ hành vi cũ nghĩa là một Program hỏng làm
mọi Program khác — kể cả Program không liên quan gì tới nó — ngừng tác động lên
đầu ra, mà không có mục nào trong hồ sơ nói vì sao. Test cũ
`ProgramFaultStopsRestOfTask` được thay bằng `ProgramFaultIsIsolatedFromRestOfTask`;
`last_dispatch_succeeded()` vẫn `false` — **cô lập không có nghĩa là im lặng**.

**Lane là đơn vị song song, không phải đơn vị cấu hình.** Program cùng lane chạy
tuần tự theo `order`; lane khác nhau độc lập. Lane **không** được mang dữ liệu
dùng chung: chia sẻ ngầm giữa hai lane là thứ làm kết quả phụ thuộc vào lane nào
chạy trước, và đó chính là điều hai chế độ phải không bao giờ khác nhau.

**Trộn theo SỐ HIỆU LANE, không theo thứ tự hoàn thành.** Mỗi lane gom kết quả và
trace vào bộ đệm riêng (cấp phát tĩnh), trộn lại sau khi mọi lane xong. Trộn theo
thứ tự hoàn thành sẽ làm trace và số đếm khác nhau giữa hai lần chạy cùng một cấu
hình — và "single/multicore cùng ngữ nghĩa" mất nghĩa ngay ở chỗ dễ bỏ qua nhất.

**Số đếm phải khớp LÝ THUYẾT, không chỉ khớp nhau.** Fixture kiểm cả hai: hai chế
độ cho cùng dãy, **và** dãy đó bằng dãy release tính tay cho 30 chu kỳ. Hai chế độ
cùng sai một kiểu vẫn cho hai kết quả bằng nhau.

**Worker tạo sẵn, spin + yield, không vào kernel.** Condition variable sẽ đưa
đường quét vào chờ ở kernel. Worker chỉ tồn tại khi `PARALLEL` được bật **tường
minh** — chi phí spin là chi phí người dựng hệ đã chọn, không phải mặc định ai đó
thừa hưởng. Đổi chế độ tạo/huỷ worker **ngoài** chu kỳ quét; destructor dừng
worker trước khi bất cứ thứ gì chúng đọc bị huỷ.

**Thiếu worker làm CHẬM, không làm BỎ SÓT.** Lane vượt số worker chạy nốt trên
luồng gọi. Có test khoá đúng ca `kMaxLanes` lane trên máy ít nhân.

**Không cấp phát trong đường quét.** Phân lane dùng bộ đệm cấp phát một lần của
scheduler. `allocation_probe` đo 0 cấp phát ở **cả hai** chế độ. Bộ đếm là
`thread_local` nên phép đo phủ luồng gọi — phân lane, điều phối, trộn kết quả, và
ở chế độ tuần tự là toàn bộ thân lane; worker chạy **chính** `run_lane` đó nên
phần thân đã được phủ. Nói phép đo phủ cả luồng worker sẽ là nói quá.

**TSan tái lập được, không phải một lần chạy tay.** `scripts/run_core_tsan.sh`
dựng cây build TSan riêng và chạy 54 test lập lịch: **0 cảnh báo**. Nó là script
riêng chứ không phải một cổng của `verify-project.sh` vì instrumentation đổi cả
layout bộ nhớ nên phải là cây build khác — gộp vào cổng mặc định bắt mọi task
không liên quan tới đồng thời trả cái giá đó. Script bọc `setarch -R` quanh **cả**
bước build lẫn bước chạy: kernel mới đặt `vm.mmap_rnd_bits` đủ cao để TSan thoát
với "unexpected memory mapping" ngay ở bước `gtest_discover_tests`.

**Ranh giới trung thực.** Đây là **cấu trúc chạy và chính sách fault**. Chính sách
fallback khi consumer đọc signal của producer vừa fault thuộc `T59-404`; rút
candidate và safe-state khi Program fault thuộc `T59-406`. Số đo TSan là host,
trên fixture của bộ test — không phải 24 h trên target (`T59-702`).

**Evidence level.** Host/local. Không phải GitHub CI, không phải target/HIL.

#### `T59-404` — Published Signal: double-buffer, freshness và ba chính sách

**Double-buffer chứ không phải một ô có khoá.** Publisher ghi trong lúc consumer
đọc là chuyện bình thường khi hai Program ở hai lane khác nhau. Một ô nhớ chung
sẽ cho consumer đọc được **nửa** giá trị mới và nửa giá trị cũ — với `StCell`
8 byte trên bus 32 bit, đó là một số **chưa Program nào từng ghi**. Khoá thì đưa
đường quét vào chờ, thứ mà `T59-403` vừa loại bỏ. Test tấn công thật: 20.000 vòng
publisher/consumer song song, mọi giá trị publish đều là bội của
`0x0001000100010001` nên một giá trị ghép từ hai bản sẽ lộ ra ngay — **0 lần**.

**Commit ở BOUNDARY, không ngay khi publish.** Trong cùng một chu kỳ, hai consumer
chạy ở hai thời điểm khác nhau phải thấy **cùng một** ảnh signal. Cho consumer
thấy giá trị ngay khi publisher ghi sẽ làm kết quả phụ thuộc lane nào chạy trước —
đúng thứ mà "single/multicore cùng ngữ nghĩa" của `T59-403` cấm. Cái giá là độ trễ
một chu kỳ, và nó rẻ hơn nhiều so với kết quả phụ thuộc thứ tự chạy.

**Bản nháp kế thừa bản cũ trước khi đổi.** Một signal chỉ publish mỗi 30 s sẽ
"biến mất" ở chu kỳ kế tiếp nếu bản nháp không được chép từ bản live — và
`HOLD_LAST` sẽ giữ một ô **rỗng** thay vì giá trị cuối, tức là đúng ngược với tên
của nó.

**"Chưa ai publish" KHÁC "quá hạn".** Chỉ `USE_FALLBACK` có câu trả lời khai báo
cho trường hợp chưa có dữ liệu; hai chính sách kia phải nói thẳng `UNAVAILABLE`.
Bịa một giá trị ở đây đúng là lối "im lặng thay bằng 0" mà DDD §10 cấm.

**Producer dừng làm giá trị GIÀ ĐI, không biến mất.** `note_publisher_stopped`
cố ý **không** xoá giá trị: xoá sẽ biến một sự cố có thời hạn thành một sự cố tức
thì, và `HOLD_LAST` mất hết ý nghĩa đúng vào lúc nó cần có nghĩa nhất. Test đi
trọn dừng → còn trong hạn → quá hạn → hồi phục.

**Sửa kèm 1 — signal chưa từng đi vào container.** `mkddc-st-package` không có
đường nhận signal và `ProcessPackager` không truyền, nên **mọi** khai báo Published
Signal đã qua validate ở `T59-304` vẫn không tới được thiết bị: bus ở runtime
luôn rỗng bất kể người dùng cấu hình gì. Nay `SIGNAL_DEFS` mang thêm chính sách +
giá trị dự phòng, CLI nhận `--signals <file JSON>`, và Check truyền danh sách đã
sắp theo tên. Signal đi bằng **file JSON** chứ không bằng argv vì tên signal là
chuỗi người dùng đặt — mọi dấu phân cách ta chọn đều có thể xuất hiện trong chính
dữ liệu. Giá trị dự phòng đi xuống dưới dạng **bit** của `StCell`: mỗi lần đổi
biểu diễn là một lần làm tròn, và làm tròn một giá trị an toàn là đúng thứ không
được phép xảy ra âm thầm.

**Sửa kèm 2 — `stalePolicy` không phải enum đóng.** Check chỉ kiểm cặp
policy↔fallback, nên `"MAGIC"`, chuỗi rỗng, hay `"HOLD_LAST "` thừa khoảng trắng
đều đi lọt và buộc runtime phải **đoán** thiết bị làm gì khi mất dữ liệu. Nay
đóng ở **ba** lớp độc lập: Check (Go), writer và loader package (C++), và
`StSignalBus::declare`. Ba cài đặt của cùng một hợp đồng là ba chỗ cần phép kiểm
riêng — một hằng dùng chung chỉ làm cả ba cùng sai một lúc.

**Ranh giới trung thực.** Đây là **bus và chính sách đọc**. Thân chương trình
chưa có opcode đọc/ghi signal — nối vào lowering thuộc phần còn lại của lane
compiler. Trọng tài output khi consumer nhận `UNAVAILABLE` thuộc `T59-406`. Số đo
"không đọc rách" là host, trên một cặp luồng — không phải 24 h trên target
(`T59-702`).

**Evidence level.** Host/local. Không phải GitHub CI, không phải target/HIL.

#### `T59-405` — Enable/Disable đi trọn đường store → API → IPC → Core → read-back

**Ý định KHÁC trạng thái, và phải nằm cạnh nhau.** "Đã bật" là điều người vận
hành muốn; "đang chạy" là điều thiết bị đang làm. Gộp thành một trường sẽ làm một
Program **bật-nhưng-FAULTED** trông y hệt một Program chưa ai bật — đúng lúc
người vận hành cần phân biệt nhất. Vì vậy `desiredEnabled` và `runtimeState` là
hai trường riêng ở cả store, API lẫn hình chiếu public.

**STORE trước, Core sau.** Intent là thứ bền vững phải sống qua mất điện và qua
việc Core chưa sẵn sàng. Đẩy xuống Core trước rồi mới ghi sẽ để lại một thiết bị
đã đổi hành vi mà không ai biết ai ra lệnh, nếu tiến trình chết ở giữa. Biên nhận
idempotency, audit và bản ghi intent đi trong **cùng một transaction**.

**Core từ chối hay không sẵn sàng KHÔNG xoá intent.** Intent là ý định, không phải
kết quả. Trạng thái ghi lại là `FAULTED` (bị từ chối) hoặc `UNKNOWN` (không liên
lạc được) — **không phải** trạng thái mong muốn. Đoán rằng lệnh đã tới nơi là đúng
thứ làm người vận hành tin nhầm.

**Ghi trạng thái CHUYỂN TIẾP, không ghi thẳng đích.** Core nhận lệnh xong thì
Program mới `STARTING`/`STOPPING`, chưa `RUNNING`/`DISABLED`. Nói nó đã tới đích
khi nó mới lên đường là nói dối.

**Enable và Disable là HAI action riêng ở lớp biên nhận.** Biên nhận khoá theo
`(actor, action, target, key)`. Gộp hai chiều vào một action `PROGRAM_SET_ENABLED`
sẽ làm một lần "bật" và một lần "tắt" **cùng idempotency key** trở thành cùng một
ô — và lần thứ hai replay kết quả của lần thứ nhất thay vì đổi trạng thái. Có test
khoá đúng ca này.

**Replay không gửi lại lệnh xuống Core.** Một lần gửi lại vì mạng không được thành
một lệnh vận hành thứ hai.

**`PUT` chứ không phải `enable`/`disable`.** Intent là một **trạng thái mong
muốn**; hai động từ riêng sẽ làm việc "đặt lại đúng thứ đang có" trở thành hai
request khác nhau tuỳ giá trị hiện tại. Payload thiếu `desiredEnabled` bị từ chối
chứ **không** mặc định `false` — mặc định sẽ biến một payload hỏng thành lệnh TẮT
chương trình.

**IPC: action mới, `protocolMinor` 0→1, `schemaVersion` ĐỨNG YÊN.** Thêm action là
thay đổi tương thích ngược, và `protocolMinor` sinh ra đúng để diễn đạt điều đó.
Đổi `schemaVersion` trên dây sẽ làm **mọi** Core phiên bản cũ từ chối **mọi**
request — hỏng toàn diện thay vì thiếu một tính năng. Vì vậy `version` trong join
G1 mirror hằng trên dây (giữ "1.0") còn `minor` mirror `protocolMinor` (thành 1);
verifier nay khoá `minor` vào golden manifest để hai con số không trôi khỏi nhau.
Có test khoá: client `minor=0` vẫn được nhận, `minor` cao hơn bị chặn ngay ở lớp
mã hoá.

**Trần 16 ép ở HAI lớp, không thừa.** Lớp application chặn **trước khi ghi**:
intent là thứ bền vững, nên một intent vượt trần sẽ sống lại ở mỗi lần khởi động
và bị Core từ chối mãi mãi mà không ai thấy vì sao. Lớp Core ép lại ở `start()` —
nơi Program thực sự bắt đầu tác động lên đầu ra, và là nơi bất biến phải đúng kể
cả khi intent tới từ đường khác.

**Sửa kèm 1 — trigger `generation` siết quá tay.** Trigger v6 đòi `generation`
tăng ở **mọi** UPDATE, nên read-back của Core không ghi được: SQLite trả
"generation must increase" cho một UPDATE chẳng đụng tới `desired_enabled`. Thứ
trigger sinh ra để bảo vệ là "intent cũ tới muộn không ghi đè intent mới", còn ghi
lại một quan sát thì không có generation mới để mang. Migration v10 tách thành hai
luật đúng với hai việc: đổi intent **bắt buộc** tăng generation; generation
**không bao giờ** lùi.

**Sửa kèm 2 — biên nhận idempotency đòi ETag cho mọi mutation.** Phép kiểm
`result.ETag < 1` giả định mọi mutation thuộc một Draft. Intent tác động lên
Project **đang chạy**, không lên Draft, nên nó sẽ phải bịa ra một số phiên bản
Draft — và một số bịa ra thì phép kiểm không còn canh gì. Nay ETag chỉ bắt buộc
khi biên nhận mang `DraftID`.

**Ranh giới trung thực.** Đây là **đường intent và read-back**. Đối chiếu định kỳ
(reconcile) giữa intent bền vững và trạng thái Core thật thuộc `T59-501`; rút
candidate khi Disable thuộc `T59-406`. Trạng thái `RUNNING`/`DISABLED` cuối cùng
chỉ được ghi khi có đường đọc trạng thái Program từ Core — hiện `STATUS` chưa mang
trạng thái theo từng Program, đó là phần còn lại của lane runtime.

**Evidence level.** Host/local. Không phải GitHub CI, không phải target/HIL.

#### `T59-406` — Sổ candidate, rút theo lý do, và đường rơi về

**Vì sao cần một sổ riêng.** `PriorityResolver` chỉ biết "mức 5 đang active",
không biết mức 5 đó là **của Program nào**. Với một Program thì hai câu đó trùng
nhau; với 32 Program thì "ai đang giữ AO-3" trở thành câu hỏi **không có nơi nào
trả lời** — và đó đúng là câu hỏi đầu tiên người vận hành hỏi khi một van không
nghe lệnh. `ProgramCandidateRegistry` là mắt xích `owner registry` của kiến trúc
§7; nó không tự ghi ra điểm nào và không thay resolver làm trọng tài.

**Rút phải mang LÝ DO.** "Đã rút" mà không nói vì sao buộc người vận hành đoán
giữa một **lệnh chủ ý** và một **sự cố** — hai thứ cần hai phản ứng khác nhau.
Enum đóng ba lý do: `OPERATOR_DISABLE` (rút ngay tại safe boundary),
`FAULT_TTL_EXPIRED`, `PACKAGE_REPLACED`.

**Rút KHÔNG xoá bản ghi.** Xoá sẽ làm câu hỏi "vì sao van này về default" mất câu
trả lời đúng vào lúc cần nó nhất. `owner_of()` trả rỗng cho claim đã rút vì nó
trả lời "ai **đang** giữ", còn `find()` vẫn cho biết ai đã giữ và vì sao thôi.

**Một output, một owner — ép LẠI ở runtime.** `T59-304` đã ép ở Check, nhưng gói
có thể tới từ **bundle import** hoặc từ một writer khác phiên bản. Runtime không
được tin lớp trước ở một bất biến an toàn: hai Program cùng giữ một output vật lý
là hai nguồn sự thật cho cùng một van. Đăng ký chạy **trước** khi publish — phát
hiện sau khi đã ghi ra thì đã muộn.

**Chiếm chỗ đã rút vẫn bị từ chối.** Quyền sở hữu thuộc **package**, không thuộc
thứ tự tới trước. Cùng Program claim lại sau khi bị rút là **hồi phục**, không
phải xung đột.

**Đường rơi về là thứ làm việc rút có nghĩa.** Test đi trọn: mức 4 thắng mức 5 →
rút mức 4, rơi xuống mức 5 → rút nốt mức 5, về **DEFAULT**. Rút mà đầu ra kẹt ở
giá trị cuối của Program đã chết thì rút chỉ là một dòng log. Test đầu-cuối chạy
Program thật, publish qua resolver, rồi `stop()` và kiểm AO về `0.0`.

**"Không có đường Program→IOP trực tiếp" kiểm bằng ĐỌC MÃ NGUỒN.** Một test hành
vi không chứng minh được điều này — nó chỉ chứng minh đường hợp lệ chạy đúng,
không chứng minh **không có** đường thứ hai. Test đọc chính
`st_process_image.cpp` và khẳng định không có `plc_shm`/`iop_write`/`shm_write`,
đồng thời khẳng định đường hợp lệ (`PRIO_LOCAL_LOGIC`, `resolver`) **thực sự có
mặt** — nếu không, phép kiểm trên chỉ đang xác nhận một file rỗng.

**TTL hold-last đã ký — `ADR-051`, 2026-08-21.** Mục treo duy nhất của `T59-406`
nay đóng: **60 giây**. Chặn dưới là `2x` chu kỳ Task chậm nhất (2×30 s) — lúc
Program chết, lệnh cuối đã có thể già trọn một chu kỳ, nên TTL nhỏ hơn làm thời
gian giữ THỰC TẾ trôi xuống tận 0; chặn trên là dải fail-safe quen thuộc của thiết
bị BAS (10..60 s) và hằng số thời gian nhiệt của tải. Ràng buộc `2x` không nằm ở
ghi chú mà ở `static_assert` đọc `allowedPeriodMs` của profile: profile mọc thêm
lớp chu kỳ chậm hơn thì gãy build, không gãy ngoài hiện trường.

Ba thứ phải sửa cùng con số, vì nếu không thì con số chỉ đúng trên giấy:

1. **Đo bằng đồng hồ, không đếm base step.** `TASK-PROG-401` đếm base step. Số
   base step chỉ xấp xỉ thời gian khi vòng quét chạy đúng nhịp — soak test của
   chính repo này quay 10.000 vòng trong 90 ms và làm "60 s" co lại thành mili
   giây, không có gì báo. Nay so `last_tick_now_ns()` với `output_commit_now_ns`.
2. **Đo tuổi của LỆNH, không đo trạng thái.** Điều kiện cũ ràng vào riêng
   `FAULTED` nên để lọt đúng những đường im lặng khó thấy nhất: Task bị disable
   trong khi Program vẫn `RUNNING`, và instance đứng ở `ROLLED_BACK`. Cả hai ngừng
   publish mà không bao giờ mang trạng thái `FAULTED`, nghĩa là giữ lệnh cũ vĩnh
   viễn ngay cả sau khi TTL được ký.
3. **Mặc định `ScanDeps` là giá trị đã ký, không phải `0`.** `0` nghĩa "giữ vô
   hạn"; để nó làm mặc định thì mọi đường nối dây quên set field đều âm thầm quay
   lại đúng hành vi vừa đóng, và không test hành vi nào bắt được vì "không rút"
   trông y hệt "chưa tới hạn". `0` chỉ còn dùng cho test/chẩn đoán; bootstrap từ
   chối nó qua `--program-hold-ttl-ms`.

"Khoá TTL theo Point class" (§6 bản cũ) **đóng là KHÔNG làm**, không phải hoãn:
đích rơi về đã theo từng điểm (`default` của chính điểm đó), thêm TTL theo class
là thêm núm thứ hai cho cùng một kết quả. Lý do đầy đủ ở `ADR-051`.

Interlock và SafeState là hai mắt xích đã tồn tại (`safe_state.hpp`, ma trận
trigger T1–T8); task này nối candidate vào đầu chuỗi chứ không viết lại chúng.

**Evidence level.** Host/local. Không phải GitHub CI, không phải target/HIL.

#### `T59-407` — RETAIN theo Program: cô lập, và bịt lỗ "reset nửa vời"

**Lỗi thật đã sửa: reset không bền vững khi Program đang dừng.**
`publish_committed_retain_snapshots()` chỉ công bố ảnh RETAIN cho Program vừa
**chạy** và vừa **commit output** trong base step đó. Nhưng Program hay bị reset
nhất lại là Program đang `STOPPED`/`FAULTED` — đúng những Program không bao giờ
thoả điều kiện đó. Kết quả: `reset_retained_state()` làm sạch RAM, rồi
`flush(true)` ghi lại **ảnh CŨ** (hoặc không ghi gì), và lần khởi động sau giá
trị trước reset quay về. Người vận hành thấy "reset thành công" rồi thấy nó tự
đảo ngược sau lần mất điện đầu tiên.

Nay `apply_pending_retain_resets()` công bố ảnh **đã reset** ngay tại boundary,
không phụ thuộc trạng thái chạy: reset là một sự kiện của **dữ liệu**, không phải
của việc chạy.

**Test chống hồi quy đã được kiểm chứng.** Gỡ bản vá ra và chạy lại:
`T59_407_ResetOnStoppedProgramIsPersistedNotHalfDone` đỏ đúng ở dòng "giá trị
trước reset quay về sau khởi động lại". Một test xanh cả khi có lẫn khi không có
bản vá thì không chứng minh gì.

**Namespace theo instance là thứ làm cô lập có thật.** Mỗi Program có file riêng,
đường dẫn dẫn xuất từ `SHA-256(controller_identity ‖ instance_id)`. Test khoá hai
hệ quả: reset instance-1 **không** chạm instance-2, và làm hỏng file của một
Program chỉ làm **một** Program cold-init — Program còn lại warm-restart bình
thường. Nếu hai Program dùng chung một file thì một lần hỏng là mất trạng thái
của cả hai.

**Ma trận đã đóng đủ.** Cold (thiếu file), warm (khôi phục đúng giá trị), revision
(đổi tên/kiểu biến RETAIN → `layout_identity` đổi → cold-init có lý do), corrupt
(CRC sai, file cụt do mất điện, magic sai, version sai), reset (giá trị reset sống
qua cả autosave tự nhiên lẫn warm restart). Phần lớn ma trận này đã có từ
`TASK-PROG-402`; `T59-407` bổ sung tầng **Program isolation** và bịt lỗ trên.

**Reset là all-or-nothing ở tầng dữ liệu.** `reset_retained_state()` đưa **cả**
biến RETAIN **và** state của FB `retained` về giá trị khởi tạo trong cùng một
lượt, tại safe boundary trước khi Program nào chạy. Không có cửa sổ nào mà biến
đã reset còn FB thì chưa.

**Ranh giới trung thực.** Đây là **cô lập và bền vững của reset**. Ma trận
power-cut thật trên board thuộc `T59-704`; đường IPC `RETAIN_RESET` và ràng buộc
trạng thái Commission đã có từ `WP-12`, task này không đổi chúng.

**Evidence level.** Host/local. Không phải GitHub CI, không phải target/HIL.

#### `T59-408` — Trace giá trị lấy tại ranh giới quét, và diệt action ma

**Vì sao lấy mẫu trong Core chứ không để BE poll.** BE poll ở nhịp riêng của nó,
nên "mẫu tại t" thực chất là "thứ gì đó Core đã công bố quanh khoảng t" — hai
biến trong cùng một mẫu có thể đến từ **hai chu kỳ khác nhau**. Với một đồ thị
chẩn đoán, đó là dữ liệu nói dối theo cách khó thấy nhất: đường cong trông hợp lý
nhưng quan hệ nhân quả giữa hai biến bị xáo. Lấy tại boundary thì mọi biến trong
một mẫu đến từ **đúng một** chu kỳ.

**Hai trần cùng tồn tại, trần nào chặt hơn thì thắng.** Thời lượng (10 phút ở
chu kỳ 100 ms = 6.000 mẫu) và ngân sách Ô (32 biến chỉ được 10.000/32 = 312 mẫu).
Biết rõ điều này là điều kiện để đọc đúng một đồ thị bị cắt cụt — và số mẫu **rơi**
được đếm, vì giấu nó sẽ làm người đọc tưởng mình thấy toàn bộ.

**Kho theo Ô, không theo struct mẫu.** Lưu 10.000 struct mẫu (32 ô + cờ + mốc
thời gian) tốn ~3 MB tĩnh cho một tính năng chẩn đoán — không hợp lý trên một bộ
điều khiển. Lưu theo ô cho ngân sách **cố định ~170 KB** không phụ thuộc số biến,
và đó là một con số nói ra được.

**Biến khai bằng TÊN, không bằng số slot.** Số slot là kết quả của một lần biên
dịch cụ thể và **không tồn tại** ở bất kỳ nơi nào BE nhìn thấy — Revision chỉ có
tên biến. Bắt BE gửi slot nghĩa là phải xuất bảng slot ra khỏi artifact chỉ để
phục vụ chẩn đoán, rồi giữ hai bản đồ tên→slot ở hai bên. Core đã có bảng đó
trong chương trình đang nạp; phân giải ở đó là phân giải ở nơi dữ liệu sống.

**Biến không phân giải được KHÔNG làm hỏng cả phiên.** Nó vẫn được nhận, nhưng
mọi mẫu của nó mang `valid=false`. Từ chối cả phiên vì một biến gõ sai sẽ làm mất
luôn dữ liệu của những biến còn lại. Và `valid=false` khác `0`: "không đo được"
và "đo được giá trị 0" là hai sự thật khác nhau.

**`TRACE_READ` KHÔNG phải mutation.** Xếp một lệnh đọc vào nhóm mutation sẽ buộc
nó mang `operationId` và đi qua kiểm idempotency mà nó không cần.

**Trace không cần coordinator.** Nó đọc trạng thái Program đang chạy, không đụng
vòng đời gói. Bắt nó chờ coordinator sẽ làm chẩn đoán không dùng được đúng lúc
cần nhất — khi chưa có gói nào commission thành công.

**`protocolMinor` 1→2, `schemaVersion` trên dây vẫn "1.0"** — cùng lý do đã ghi ở
`T59-405`.

**Action ma = 0.** Bảng handler nay không còn `NOT_IMPLEMENTED` nào. Khoá bằng hai
phép kiểm độc lập: `TestNoGhostActionsInContract` (Go — mọi action khai phải
IMPLEMENTED và phải có hằng ở codec Go, và ngược lại) và
`verify_programming_ipc_actions.py` (đối chiếu schema ↔ enum C++ ↔ nhánh dispatch
↔ codec Go).

**Sửa kèm — self-test của chính verifier đã mục ruỗng.** Hai mutation dùng
`TRACE_START` làm ví dụ "action chưa hiện thực". Ngay khi task này hiện thực nó,
hai mutation trở thành **no-op** và self-test xanh mà không kiểm gì — đúng lớp lỗi
mà self-test sinh ra để chặn. Nay mutation **tự tiêm** một action giả, và ca
"khai IMPLEMENTED nhưng không có nhánh" được dựng bằng cách **tiêm nội dung nguồn
Core đã bị bỏ nhánh** — mutation trên schema không mô phỏng được ca đó.

**Sửa kèm — một luật thoát khỏi phép kiểm vì thoát sớm ở phép kiểm khác.** Luật
"`NOT_IMPLEMENTED` phải ghi task sẽ hiện thực" nằm **sau** phép tra enum C++, nên
một action chưa có enum thoát khỏi luật này. Nay luật thuần schema được kiểm
trước.

**Đường đọc mẫu đã nối trọn (bổ sung trong W5).** Bản đầu của task này để
`TRACE_READ` **không ai gọi**: Core lấy mẫu tại ranh giới quét rồi ghi vào một
ring **không ai đọc**, còn người dùng vẫn xem dãy mẫu poll theo nhịp riêng của
BE. Nghĩa là toàn bộ lý do tồn tại của `T59-408` — "mọi biến trong một mẫu đến từ
đúng một chu kỳ" — **không tới được người dùng**, và dữ liệu Core thu thập là dữ
liệu chết. Nay `runTrace` rút mẫu từ ring; poll monitor chỉ còn là **đường dự
phòng** khi Core không nhận phiên.

Ba điểm đi kèm, mỗi điểm sửa một cách nói dối:

- **Không trộn hai nguồn trong một dãy.** Core nhận phiên thì mẫu đầu KHÔNG lấy
  bằng poll nữa; trộn vào sẽ tạo một đồ thị mà điểm đầu tiên đến từ nơi khác các
  điểm còn lại, và không có gì trên đồ thị nói ra điều đó.
- **`valid=false` không được vẽ thành 0.** Ô không đọc được trả giá trị rỗng kèm
  `quality=BAD`/`freshness=UNAVAILABLE`.
- **Số mẫu rơi của Core hiện ra**, không bị giấu sau một dãy trông liền mạch.

**Thay chứ không nối thêm.** Ring của Core bounded và có thể đã ghi đè mẫu cũ
nhất; nối thêm sẽ tạo ra một dãy vừa trùng lặp vừa thiếu, và số `dropped` không
còn giải thích được khoảng trống nào.

**Ranh giới trung thực.** Lỗi khi gọi Core **không** huỷ phiên — mất trace hoàn
toàn vì Core bận là tệ hơn. Bit thô được diễn giải theo kiểu đã khai trong
package; kiểu không nhận ra trả `nil` thay vì đoán, vì một số sai kiểu trên đồ
thị chẩn đoán tệ hơn một ô trống. Số đo 10k/10 phút là host, không phải 10 phút
thật trên target (`T59-702`).

**Evidence level.** Host/local. Không phải GitHub CI, không phải target/HIL.

### W5 — Lifecycle atomic và sản phẩm FE↔BE↔Core

| Task | Priority | Việc làm / source chính | Dependency | Status | Acceptance |
|---|---|---|---|---|---|
| `T59-501` | P0 | Package Commission/Restore first-cycle barrier, LKG/journal/recovery | T59-401..407 | **DONE** | Barrier chu kỳ đầu và rollback nâng lên mức **GÓI**: trước đó chỉ xét `instance_id_` nên một Program chết vẫn được tuyên bố `FIRST_CYCLE_OK`, và rollback để lại gói **nửa cũ nửa mới**. LKG thăng cấp **all-or-nothing**. Restart ở cả 4 pha không để lại active một nửa. Hai test chống hồi quy **kiểm chứng bằng cách gỡ bản vá** (đỏ đúng dòng lý do). Sửa kèm ở FE (hồi quy W3 lộ ra vì W3 không có cổng `e2e`): thanh tab Thiết kế **bấm không ăn** trên `/programs`+`/mapping` và tab `execution` **mất chỗ hiển thị**; E2E còn ghi IA cũ. `ctest` **1209/1209**; `--wave W5` **7/7 PASS** (lần đầu chạy `frontend`+`e2e` trong Plan 59). Chi tiết §3.6. |
| `T59-502` | P0 | Impact/ack cho multi-Program/library/signal/output/RETAIN/enable intent | T59-501 | **DONE** | Bốn nhóm impact mới: `publishedSignals`/`controlLibrary`/`programSet`/`enableIntent` (trước đó chỉ có 4 nhóm của Rev A một Program). **Lỗi thật:** `SIGNAL` không nằm trong whitelist kind của `revision_objects`, nên `SealRevision` từ chối MỌI Revision có Published Signal — cả lane `T59-304`/`T59-404` chưa từng chạm một Revision thật (migration **v11**). Đổi chính sách stale trước đây rơi vào `SOURCE` nên Commission không hỏi ack. Nhóm vắng mặt = `UNAVAILABLE` (fail-closed), không phải `NONE`. Kiểu TS sinh **từ enum contract** thay vì viết cứng. `--wave W5` **7/7 PASS**. Chi tiết §3.6. |
| `T59-503` | P1 | FE sáu workspace/navigation/context, PGM-05/06 lifecycle | T59-203/306/405/502 | ORDERED | Desktop/mobile, Draft vs Active vs intent/runtime, stale/offline/unknown/a11y. |
| `T59-504` | P1 | Monitor đủ LOCAL/VP/MB_RTU, Program/signal/candidate/actual/priority | T59-303/404/406 | ORDERED | 3 category, programValue vs actual, source/freshness/quality đúng. |
| `T59-505` | P0 | Real-backend E2E Draft→Check→Commission→Enable→Runtime→Disable→Restore | T59-501..504 | ORDERED | Không `page.route` mock Programming; compiler thật + Core simulator authority; CI lane. |
| `T59-506` | P1 | ST editor durable history/runtime overlay + FBD POU UX polish | T59-503/504 | ORDERED | 20 edit undo/redo, cursor; live value quality/stale; browser Console/Network sạch. |

### 3.6 Ghi chú thực thi W5

#### `T59-501` — Vòng đời Commission/Restore ở mức gói

**Barrier chu kỳ đầu chỉ xét một Program.** `on_output_commit` đọc đúng
`instance_id_`. Với gói nhiều Program, một Program hỏng chu kỳ đầu trong khi
Program chính chạy sạch vẫn được tuyên bố `FIRST_CYCLE_OK` — gói đi tiếp với một
Program đã chết. Chiều ngược lại tệ hơn: rollback cũng chỉ quay Program chính về,
để lại gói **nửa cũ nửa mới**, tức đúng thứ "no partial active" cấm.

**LKG thăng cấp theo từng Program.** Với gói trộn ba lớp chu kỳ, tập LKG trở
thành một tổ hợp **chưa từng được Check**: Program 1 s mang bản mới, Program 30 s
còn bản cũ. Rollback từ tập đó khôi phục một thứ chưa ai kiểm, và "old LKG exact"
mất nghĩa. Nay thăng cấp là all-or-nothing trên cả gói.

**Điều kiện là "đã commit ít nhất một lần kể từ activate", không phải "cùng
commit ở một base step".** Đòi điều thứ hai là đòi một thứ **không bao giờ xảy
ra** với gói nhiều chu kỳ — Program 30 s chỉ commit mỗi 30 base step. Vì vậy có
cờ `committed_since_activation`, xoá sạch ở mỗi lần activate: tư cách của gói cũ
không được thừa kế.

**Program không chạy KHÔNG tham gia barrier, nhưng FAULTED thì có.** Đòi một
Program `DISABLED` "chạy sạch một chu kỳ" là đòi một điều không thể xảy ra và sẽ
treo barrier vĩnh viễn. `FAULTED` là **hỏng**, không phải vắng mặt.

**Kiểm TRƯỚC, áp SAU khi rollback.** Quay về được một nửa rồi kẹt ở nửa còn lại
để thiết bị ở một tổ hợp chưa từng được Check. Không instance nào có LKG thì
`FAILED` — không có bản cũ nguyên vẹn để khôi phục.

**Hai test chống hồi quy đã được kiểm chứng.** Gỡ từng bản vá ra và chạy lại: cả
hai đỏ đúng ở dòng lý do ("gói có Program chết vẫn được tuyên bố thành công",
"tập LKG thành nửa gói mới nửa gói cũ"). Một test xanh cả khi có lẫn khi không có
bản vá thì không chứng minh gì.

**Về `PENDING` — vì sao nó khó dựng.** `st_program_due` cho lần release **đầu
tiên** chạy ngay (T59-402), nên mọi Program của gói đều chạy ở base step đầu và
barrier thường qua ngay tại đó. Test khoá chính điều này lại: nếu ai đổi luật
release thì đỏ ở đây chứ không đỏ ở hiện trường bằng một Commission treo. Luật
all-or-nothing vì vậy được kiểm **thẳng** trên `promote_output_committed_artifacts()`
thay vì dựng qua nhiều lớp.

#### Sửa kèm — ba hồi quy FE/E2E của W3 lộ ra ở cổng `e2e`

Ma trận cổng của W2–W4 **không có** `frontend` và `e2e`. W5 là wave đầu tiên gọi
chúng, và ba lỗi đã nằm trong nhánh từ W3 mới hiện ra:

1. **Thanh tab Thiết kế bấm không ăn.** `T59-306` đặt `tab = route ?? fromQuery`
   — `route` **ghi đè** query. Nhưng nút tab chỉ ghi lại `?tab=`, thứ vừa bị ghi
   đè. Trên `/programs` và `/mapping`, người dùng bấm tab và **không có gì xảy
   ra**. Nay nút **điều hướng** sang đúng route của IA.
2. **Tab `execution` mất chỗ hiển thị.** Nó không phải một trong sáu trang IA mà
   là tab con, nên chỉ có địa chỉ dưới dạng `?tab=execution` — và đúng dạng đó bị
   `route` ghi đè. Kết quả: `/task` (lối vào cũ) dẫn tới một trang không hiện thứ
   nó hứa. Nay `execution` là ngoại lệ tường minh, query thắng route **chỉ** cho
   giá trị này.
3. **E2E còn ghi IA cũ.** `VS-PROG-032` kỳ vọng ba route dẫn về `/design`, trong
   khi `T59-306` đã **đảo chiều**: `/programs`/`/mapping` nay là route thật còn
   `/design` là lối vào cũ. Spec được viết lại theo chiều mới, phủ thêm
   `/design?tab=mapping` và `/task`.

**Sửa kèm — dev server E2E không cần watcher.** Playwright không sửa nguồn giữa
lúc chạy, nên watcher chỉ đem lại hai thứ: hàng chục nghìn inotify watch (đủ để
`ENOSPC` trên máy đang mở editor) và nguy cơ Vite rebuild giữa một assertion.
`VITE_E2E_NO_WATCH=1` tắt hẳn cho đường E2E; đường dev thường giữ nguyên HMR.

**Ranh giới trung thực.** Đây là **atomicity mức gói trên host**. Mô phỏng mất
điện thật (cắt nguồn giữa fsync) và số đo phục hồi trên board thuộc `T59-704`;
`e2e` ở đây vẫn dùng mock Programming — đường real-backend là `T59-505`.

**Evidence level.** Host/local. Không phải GitHub CI, không phải target/HIL.

#### `T59-502` — Impact/ack cho mô hình đa Program

**Lỗi thật: Published Signal chưa từng seal được.** `revisionPayload` sinh object
kind `SIGNAL` từ collection `signals` của document v2, nhưng `SIGNAL` **không nằm
trong** whitelist kind của `revision_objects` — danh sách đó viết từ migration v1,
trước khi Published Signal tồn tại, và chưa bao giờ được mở rộng. Hệ quả:
`SealRevision` từ chối **mọi** Revision có signal với "CHECK constraint failed".
Toàn bộ lane signal — validate ở Check (`T59-304`), đóng gói vào container
(`T59-404`), bus ở runtime — **chưa từng chạm một Revision thật**. Không test nào
bắt được vì chưa test nào seal một Revision có signal. Migration **v11** mở
whitelist và khôi phục đúng hai trigger bất biến của bảng.

**Bốn nhóm impact chỉ phủ Rev A một Program.** Với mô hình đa Program, bốn thứ
sau đi qua Commission mà **không hỏi acknowledgement nào**:

- **`publishedSignals`** — đổi freshness / chính sách stale / publisher đổi hành
  vi của **mọi** consumer khi mất dữ liệu, và **không nhìn thấy được** trong diff
  mã nguồn. Trước bản vá `SIGNAL` rơi vào nhánh mặc định `SOURCE`.
- **`controlLibrary`** — đổi library đổi thân của mọi POU tham chiếu nó.
- **`programSet`** — thêm/bớt Program đổi **tập** chương trình chạy trên thiết
  bị; khác hẳn sửa thân một Program đã có, nên nó là một category riêng chứ
  không phải một dòng `SOURCE`.
- **`enableIntent`** — Program **đang Enabled** mà Revision này chạm tới. Đọc
  intent bền vững ở store chứ không suy từ diff: "đang chạy" là trạng thái của
  **thiết bị**, không phải thuộc tính của một Revision.

**Nhóm vắng mặt là `UNAVAILABLE`, không phải `NONE`.** Một BE cũ hơn (hoặc một
nhóm mới chưa nối) gửi thiếu nhóm thì Commission **fail-closed**. Coi "không
thấy" là "không có" đúng là cách để một tác động thật đi qua mà không ai xác
nhận. FE đọc phòng thủ nên trang vẫn sống thay vì trắng màn hình.

**Khoá ack là enum đóng ở một chỗ.** Bản trước liệt kê bốn khoá bằng bốn phép so
`!=` nối nhau — đúng dạng dễ thêm nhóm mà quên sửa phép kiểm.

**Kiểu TS sinh từ enum của contract.** `ProgrammingImpact` trước đây viết cứng
bốn trường trong generator, nên thêm nhóm ở contract mà quên sửa generator sẽ cho
một kiểu **im lặng thiếu trường**. Nay sinh từ `ProgrammingImpactKey`.

**Ack trong test dựng từ chính impact vừa tính**, không viết cứng danh sách: viết
cứng làm mọi lần thêm nhóm phải sửa tay, và lần quên đầu tiên hiện ra dưới dạng
"test hỏng" thay vì "Commission thiếu ack".

**Ranh giới trung thực.** `impactRef` đã băm cả nội dung nhóm nên ack cũ tự thành
stale — điều đó có sẵn từ trước, task này chỉ mở rộng thứ được băm. Thứ tự items
được sắp để thứ tự đọc DB không lọt vào `impactRef`. FE hiện đủ tám nhóm; usability
người thật thuộc `T59-503`.

**Evidence level.** Host/local. Không phải GitHub CI, không phải target/HIL.

#### Sửa kèm W5 — đường trace debug chưa nối tới người dùng

Cổng W5 chạy lần đầu đã lộ thêm một thứ mà không cổng nào của W4 gọi tới: BE
**chưa bao giờ** gọi `TRACE_READ`. Chi tiết và cách sửa ghi ở §3.5 mục
`T59-408`; ở đây chỉ ghi lại bài học lặp lại lần thứ hai trong hai wave liên
tiếp — **một tính năng chỉ được coi là xong khi có người thật đọc được đầu ra
của nó**, không phải khi mã của nó chạy. Cả `T59-408` (ring không ai đọc) và ba
hồi quy FE của W3 (tab bấm không ăn) đều thuộc đúng một lớp lỗi: đường đi tồn
tại, đầu cuối không nối.

Một điểm nữa cùng lớp: test chống hồi quy đầu tiên của đường này **đua** — nó
chờ `readCalls > 0` rồi đọc mẫu, trong khi lệnh đọc tới Core trước lúc mẫu được
ghi vào phiên. Cổng `go` bắt được ở lần chạy thứ hai. Điều kiện chờ nay là **cả
hai** (đã đọc ring **và** mẫu đã ghi); chạy lặp 5 lần đều xanh.

### W6 — Hardening, packaging và Release Candidate

| Task | Priority | Việc làm / source chính | Dependency | Status | Acceptance |
|---|---|---|---|---|---|
| `T59-601` | P1 | ST↔FBD corpus mọi registry entry + state traces; 3 fuzz harness CI | T59-105/106 | **DONE (HOST/LOCAL)** | Corpus phủ **40/40 entry** registry (20→35 cặp stateless + 5 trace nhiều chu kỳ), kiểm phủ **hai chiều** tính từ chính registry sinh máy nên entry mới không có vector sẽ đỏ. **Ba lỗi thật lộ ra ngay khi corpus chạm tới vùng chưa ai chạy:** (1) `compile_fbd_source` không có affordance `enforce_review_gate` như ST ⇒ nhánh lower **PID sang FBD chưa từng được một vector nào chạy**; (2) corpus cũ dựng node `FUNCTION` cho entry chuyển kiểu trong khi model đòi kind `CONVERSION`; (3) verifier hợp đồng FBD thiếu `SQRT` trong danh sách chép tay. Harness fuzz FBD có trong repo nhưng **không job CI nào chạy** — nay chạy cùng parser/loader. `ctest` **1213/1213**; `verify_programming_fbd_contract.py` PASS. Chi tiết §3.7. |
| `T59-602` | P0 | Artifact/library trust SIGNED + key custody/rotation/rollback | T59-106/204 | **PARTIAL — quyết định đã ký, cơ chế đủ; bật mặc định là migration profile riêng (`T59-607`)** | Bộ test tin cậy đi trọn vòng đời (ký hợp lệ, ký lại bằng khoá lạ sau khi tính lại hash, sửa byte, rotation có overlap, rollback về LKG) đã xong ở vòng trước. **Vòng này đóng đúng thứ đang chặn: quyết định.** `ADR-052` chốt mô hình **hai lớp khoá theo nguồn gốc artifact** — khoá hãng ký thứ hãng phát hành; **khoá thiết bị** sinh trên từng bo lúc provisioning ký artifact do chính bo biên dịch. Hai phương án cũ đều không dùng được: (a) ký lúc release giả định Program có trước khi phát hành — sai với sản phẩm cho khách tự viết; (b) service ký từ xa đặt phụ thuộc mạng vào giữa đường Commission và buộc chọn giữa "mất mạng thì chặn điều khiển" hay "mất mạng thì tự hạ mức bảo vệ". **Đã hiện thực:** `mkddc-st-compile --gen-device-key` (khoá riêng `0600` tạo bằng `O_EXCL`, **từ chối ghi đè** vì sinh lại sẽ vô hiệu hoá cả LKG); `mkddc-core --st-trusted-key` nạp khoá bo vào tập tin cậy, khoá thiếu/hỏng là **lỗi cấu hình dừng hẳn** chứ không lặng lẽ chạy với ít khoá hơn; `install.sh` provisioning một lần và unit Core nạp sẵn; 3 test mới khoá bất biến **"bo này không tin khoá của bo khác"** và "khoá hãng + khoá thiết bị cùng sống trong một tập". `ctest` `StArtifactTrust` **10/10**. **Còn lại, có tên và có chủ:** bật `SIGNATURE_REQUIRED` mặc định đổi `integrityMode` trong **profile contract** (v2.0→v2.1) nên kéo theo re-pin G1 + golden manifest và migration cho artifact đang chạy — một task riêng có kế hoạch lùi, không phải một dòng sửa. Xem `T59-607`. |
| `T59-603` | P1 | Security/RBAC/audit/malicious input/concurrency full matrix | T59-202/405/501 | **DONE (HOST/LOCAL)** | Ma trận RBAC **sinh từ `routeDefinitions`**, không chép tay: 30/30 route kiểm chưa-xác-thực → 401 và handler **không được gọi** (zero mutation ở mức mạnh hơn "store không đổi"); 14/14 route mutation kiểm viewer → 403; chiều ngược lại kiểm route đọc không được đòi hơn viewer (siết quá tay cũng là lỗi, và không bao giờ tự lộ trong happy-path). Mutation check: hạ một route xuống viewer thì đỏ đúng dòng. Audit: `VerifyAuditChain` trước đây **chỉ từng chạy trên chuỗi lành** — một hàm luôn trả `nil` cũng qua; nay có test gỡ trigger rồi sửa/xoá và đòi chuỗi phải gãy, cộng test khẳng định trigger DB chặn UPDATE/DELETE. Đồng thời: 8 goroutine cùng idempotency key → đúng 1 Project, 1 dòng audit, chuỗi không gãy. Go `vet` + `test ./... -count=1` PASS. Chi tiết §3.7. |
| `T59-604` | P1 | E2E stability, remove stale quarantine, deterministic workers/retry policy | T59-505 | **DONE (HOST/LOCAL)** | **Chẩn đoán trước đó SAI, và cái sai đó giữ cổng đỏ thêm một vòng.** W6 kết luận flake là "đói CPU" và vá bằng chờ điều kiện 60 s. Hai chỗ hỏng: (1) phép chờ 60 s nằm trong test có ngân sách 30 s nên **không bao giờ chạy hết hạn của chính nó**; (2) helper đăng nhập được chép tay ở **bảy** spec, bản vá chỉ áp cho một — sáu bản còn lại giữ nguyên cuộc đua, và lần chạy kế đỏ ở `pa3-a11y.spec.ts`. **Nguyên nhân thật, có bằng chứng từ trace:** sau khi bấm "Tiếp tục chỉnh sửa", URL thật là `/programs`, còn spec chờ `/design` — mà `design` chính là **lối vào cũ được W5 đổi thành redirect sang `programs`**. Spec đang đua với redirect: máy chậm thì Playwright kịp thấy trạng thái trung gian và test xanh; máy nhanh thì redirect xong trước và test treo tới hết giờ. **Ba bản sửa:** một helper đăng nhập duy nhất (`e2e/helpers/session.ts`) + guard cổng chặn spec định nghĩa lại; e2e phục vụ **bản đã build** (`vite preview`) thay vì dev server, bỏ hẳn lớp biên dịch-theo-yêu-cầu; spec chờ đích cuối của redirect. `retries: 0` giữ nguyên. **Acceptance đạt: 5 lần chạy LIÊN TIẾP 79/79 PASS, exit 0, 28–29 s/lần** (trước: 64/79/79/78+1F/78+1F, 78–88 s). Chi tiết §3.7. |
| `T59-605` | P0 | Release packaging: Programming default ON, artifact/compiler/library/systemd/env | T59-501/602 | **DONE (HOST/LOCAL + TARGET DEPLOY)** | **Lỗi thật, kiểm chứng trên chính board Foxlinx:** `/usr/sbin/mkddc-st-package` **không tồn tại** trên bo — binary được build, có test riêng, nhưng chưa bao giờ được cài, trong khi BE gọi đúng đường dẫn đó ở bước Commission (`ProgrammingPackagerPath`). Cài + đưa vào `checksums.sha256`/`runtime-checksums`. `PROGRAMMING_REV_A=1` nay do `install.sh` ghi, **cả nhánh nâng cấp** (bo cũ có file env sẵn nên khối khởi tạo lần đầu không chạy — thiếu nhánh này thì bo cũ mãi ở trạng thái FE-bật/BE-tắt). 6/6 guard đóng gói PASS. Deploy thật lên board: core/web/st-compile/st-package/dist mới, ba service `active`, `/api/v1/programming/projects` trả **401** (route có, cờ ON) thay vì 404. Chi tiết §3.7. |
| `T59-606` | P0 | RC reproducible build/provenance/SBOM/backup/restore/upgrade dry-run | T59-601..605 | **DONE (HOST/LOCAL)** | Tái lập **7/7** artifact và SBOM 92 component đã xong ở vòng trước (chi tiết §3.7). Vòng này đóng nốt **dry-run cài mới/nâng cấp/rollback**: `install.sh` và `rollback.sh` nhận `MKDDC_INSTALL_ROOT` để ghi vào **cây giả** và bỏ thao tác cần quyền hệ thống, nhờ đó ba thao tác cuối cùng của một bản phát hành kiểm được BẰNG MÁY thay vì bằng cách đọc script rồi tin. **Lỗi thật tìm thấy ngay khi có phép kiểm:** `rollback.sh` **không khôi phục `mkddc-st-package`** — sau khi lùi, bo giữ writer artifact của bản MỚI trong khi compiler/loader/Core đã về bản cũ, và chỗ hỏng chỉ lộ ra ở lần Commission kế tiếp. Đúng lớp lỗi mà `T59-605` vừa vá cho `install.sh` (build nhưng không cài), lần này ở đường lùi. 6 test mới đi trọn ba kịch bản trên gói vừa dựng: cài mới đủ binary/metadata/cờ Programming và checksum khớp file thật; nâng cấp giữ nguyên `JWT_SECRET`, cấu hình đã sửa và artifact đã commission, đồng thời chụp snapshot đúng bản đang chạy; rollback khôi phục **đủ 7 binary** và không mất dữ liệu. **Test được kiểm chứng bằng cách gỡ bản vá:** đỏ đúng dòng `rollback KHÔNG khôi phục mkddc-st-package`. Nối vào cổng `release`. `python3 -m unittest test_release_dryrun` **6/6 OK**. |
| `T59-607` | P0 | Bật `SIGNATURE_REQUIRED`: profile v2.1, re-pin G1/golden, migration artifact đang chạy | T59-602 | ORDERED | `integrityMode` đổi trong profile contract, re-pin cùng PR sau review; artifact đang chạy (gồm LKG) được ký lại hoặc biên dịch lại trước khi bật; có đường lùi về `HASH_ONLY` chứng minh bằng diễn tập. |

### 3.7 Ghi chú thực thi W6

#### `T59-601` — Corpus phủ registry, và ba chỗ nó chạm vào vùng chưa ai chạy

**Vì sao đếm phủ phải tính từ registry, không ghim số.** Bộ 20 cặp cũ khoá đúng
20 entry nó liệt kê. Thêm một entry mới vào Control Library **không làm test nào
đỏ** — entry đó chỉ đơn giản không được ai chạy, trong khi FE vẫn chào nó cho
người dùng cuối. Nay phép kiểm đọc `pou_library_registry_v1.json` và so **hai
chiều**: entry không có vector ⇒ đỏ; vector trỏ tới entry đã gỡ ⇒ cũng đỏ (chiều
sau giữ cho số phủ không đẹp hơn sự thật).

**Entry có state không kiểm được bằng một chu kỳ.** Cái sai điển hình của
TON/TOF/R_TRIG/F_TRIG/PID là **chuyển state giữa các chu kỳ**, không phải công
thức trong một chu kỳ. Vì thế 5 entry này đi bằng trace nhiều chu kỳ, chạy song
song ST và FBD trên **cùng mốc thời gian** và so **từng chu kỳ**: TOF giữ Q thêm
đúng `PT` sau khi IN xuống, R_TRIG chỉ bắn một chu kỳ, PID tích luỹ tích phân
theo `dt` rồi **đóng băng integrator** khi `ACTUAL` lệch khỏi đề xuất trước
(TRACKING lên) — đúng ngữ nghĩa §7 của `DDD-CTRL-PROG-001`.

**Lỗi thật 1 — PID chưa từng được chạy qua đường FBD.** `compile_fbd_source`
không có affordance `enforce_review_gate` mà đường ST đã có, nên bộ conformance
**không thể** dựng PID bằng FBD. Nghĩa là nhánh lower PID sang FBD chưa có một
vector nào chạy, trong khi chính bộ conformance này là thứ dựng evidence để mở
review gate cho PID. Nay có overload nhận `StCompileOptions`; đường production
`compile_fbd_source(source)` giữ mặc định BẬT, và có test khoá đúng điều đó —
cửa hậu vừa mở phải không chạm được từ production.

**Lỗi thật 2 — corpus dựng sai node kind cho chuyển kiểu.** Model FBD có kind
`CONVERSION` riêng và từ chối `INT_TO_REAL` trên node `FUNCTION` bằng
`FBD-SEM-TYPE-REF-001`. Nó từ chối ĐÚNG; harness mới là chỗ sai, và nay lấy kind
từ registry sinh máy thay vì đoán.

**Lỗi thật 3 — verifier hợp đồng thiếu `SQRT`.** Danh sách `PURE_FUNCTIONS` trong
`verify_programming_fbd_contract.py` được chép tay và đã trôi khỏi registry. Cùng
loại lỗi mà `st_fbd_model.cpp` đã sửa trước đó bằng cách sinh từ registry.

**Fuzz: harness thứ ba có trong repo nhưng không ai chạy.** `fuzz_st_fbd_model`
tồn tại từ trước, job CI chỉ build parser + loader. Đồ thị FBD là input thù địch
đến từ BE/FE y hệt source ST và artifact, nên bỏ nó ngoài CI là bỏ trống đúng một
trong ba cửa vào. Nay job chạy cả ba, seed corpus FBD lấy từ golden thật.

**Evidence level.** Host/local. `ctest` 1213/1213, `verify_programming_fbd_contract.py`
PASS, `docs_iso_harness.py --expect` PASS. Chưa phải GitHub CI, chưa phải target.

#### `T59-602` — Tin cậy artifact: cơ chế đã đủ, chữ ký chính sách thì chưa

**Khoảng cách thật không nằm ở crypto.** Cả hai chiều đã có từ lâu: `st_ir.cpp`
ký Ed25519, `st_loader.cpp` verify constant-time. Cái thiếu là **quy trình**, và
hai chỗ nó rò ra thành lỗ thật:

**Lỗ 1 — nguyên tắc không có cổng nào đọc.** `st_public_key.hpp` ghi "build
release PHẢI truyền `-DMKDDC_ST_PUBLIC_KEY_HEX`" và có sẵn
`st_public_key_is_test_key()`, nhưng **không call site nào** gọi nó. Khoá TEST
được cam kết vào repo có chủ ý (ai cũng có khoá riêng tương ứng) nên nó có thể
lặng lẽ đi theo binary ra hiện trường — và khi đó "artifact có chữ ký" không
chứng minh được gì. Nay: `mkddc-core --st-key-info` in fingerprint + TEST/RELEASE,
bootstrap log **CRITICAL** khi đang chạy khoá TEST, `build-release.sh` **chặn**
đóng gói. Bản lab mở bằng `MKDDC_ALLOW_TEST_KEY=1` và cờ đó được **ghi vào
`provenance.json`** — không có bản nào mang khoá test mà hồ sơ không nói.

**Lỗ 2 — rotate khoá sẽ tự chặn đường lùi.** `StLoaderOptions` chỉ nhận MỘT
khoá. Đổi khoá tức thời làm mọi artifact ký bằng khoá cũ bị từ chối ngay lúc
đổi — kể cả **LKG**, tức bản duy nhất để lùi khi bản mới hỏng. Cơ chế bảo vệ khi
đó khoá đúng đường thoát, và đúng vào lúc cần thoát nhất. Nay verify nhận **tập**
khoá tin cậy (trần 4), thử lần lượt; `StLoadedProgram.verified_public_key` ghi lại
**khoá nào đã tin bản này** để audit trả lời được "còn bao nhiêu artifact đang
sống nhờ khoá cũ" — thứ mà một dòng "verify PASS" không nói.

**Vì sao chưa bật `SIGNATURE_REQUIRED` ở production.** `DDD-ARTIFACT-TRUST-PROG-001`
§2/§3 **cố ý để mở** hai câu hỏi và ghi rõ không tự chọn: ký ở khâu build/release
(a) hay ký on-demand sau khi Check PASSED qua một service tách biệt (b), và khoá
riêng nằm ở đâu. Câu trả lời đổi trực tiếp UX "biên dịch ngay trên board" đã cam
kết: mô hình (a) giả định Program cố định lúc phát hành — không đúng với sản phẩm
này; mô hình (b) thêm một phụ thuộc mạng vào đúng đường Commission, nên phải trả
lời trước "mất mạng thì Check chặn hẳn hay rơi về `HASH_ONLY`". Đó là quyết định
threat-model của Security + Product, không phải của lane implementation — và nó
là thứ **duy nhất** còn giữ `T59-602` ở `PARTIAL`. Mã đã sẵn sàng cho cả hai lựa
chọn: bật mode là một tham số, tập khoá đã có, audit đã có trường.

**Evidence level.** Host/local, `ctest` 1220/1220.

#### `T59-605` — Gói phát hành thiếu đúng binary mà bước cuối cần

**Lỗi thật, và nó chỉ lộ ra ở thao tác cuối cùng của người vận hành.**
`mkddc-st-package` là writer artifact v2; BE gọi nó ở bước Commission qua
`ProgrammingPackagerPath` (mặc định `/usr/sbin/mkddc-st-package`). Binary này
được build, có test riêng, có golden — nhưng `install.sh` **chưa bao giờ cài
nó**, và `checksums.sha256` cũng không phủ nó. Kiểm trên chính board Foxlinx:
`ls /usr/sbin/mkddc-st-package` → **No such file or directory**. Nghĩa là một bo
cài từ gói phát hành sẽ đi trọn Draft → Check → và **hỏng ở Commission**, với
thông báo lỗi trỏ vào một đường dẫn không tồn tại. Không cổng nào phía trước bắt
được: build xanh, test xanh, install xanh.

**Nửa còn lại của cùng một tính năng.** FE bật Programming lúc build
(`build:release`), BE bật bằng env `PROGRAMMING_REV_A`. Trước task này chỉ FE
được bật trong gói: bo hiện đủ bốn workspace nhưng mọi endpoint sau lưng trả
404 — triệu chứng giống hệt "backend hỏng" trong khi thật ra chưa ai bật cờ. Nay
`install.sh` ghi cờ, và **có nhánh riêng cho bo nâng cấp**: file env đã tồn tại
từ bản trước nên khối khởi tạo lần đầu không chạy, thiếu nhánh này thì mọi bo cũ
ở lại vĩnh viễn trong trạng thái FE-bật/BE-tắt.

**Guard chống tái phát.** `tests/integration/test_release_packaging_guard.py` thêm
ba phép kiểm: packager có trong `install.sh` và trong checksums; cờ Programming
có ở cả hai nhánh cài mới/nâng cấp; cổng khoá TEST của `T59-602` thực sự `exit 1`
chứ không chỉ cảnh báo.

**Evidence level.** Host/local cho guard; **target deploy thật** cho phần cài đặt
(xem `docs/07_records/test-evidence/fw-som/2026-08-21-foxlinx-w6-deploy.md`).
Chưa phải soak 24 h, chưa phải I/O vật lý.

#### `T59-603` — Ma trận sinh từ bảng khai báo, và một hàm verify chưa từng bị thử

**RBAC phải là ma trận, không phải vài case chọn tay.** Sai quyền ở MỘT route là
đủ mở một đường mutation cho viewer, và route mới thêm vào bảng sẽ không có test
nào phủ nếu danh sách case được chép tay. Bộ test sinh thẳng từ
`routeDefinitions`: 30/30 route kiểm 401-khi-chưa-xác-thực, 14/14 route mutation
kiểm 403-với-viewer. Điều kiện dừng mạnh hơn "store không đổi": handler **không
được gọi**, vì một handler chạy rồi mới lỗi vẫn có thể đã ghi audit, cấp scratch
hoặc chạm Core.

**Chiều ngược lại cũng là lỗi.** Route đọc mà đòi `admin` sẽ làm người vận hành
quyền viewer không xem được trạng thái đúng lúc sự cố — happy-path không bao giờ
lộ ra điều đó, nên nó được kiểm riêng.

**`VerifyAuditChain` chưa từng bị thử bằng một chuỗi HỎNG.** Hàm này được gọi ở
nhiều test, nhưng luôn trên chuỗi lành: một hàm luôn trả `nil` cũng qua hết. Nay
có hai lớp được tách bạch:
- lớp DB: trigger `audit_records_no_update`/`_no_delete` **chặn** sửa/xoá — mạnh
  hơn phát hiện, nhưng chỉ với ai đi qua chính kết nối đó;
- lớp hash chain: gỡ trigger (mô phỏng kẻ có file DB trong tay) rồi sửa actor và
  xoá bản ghi giữa chuỗi — chuỗi phải gãy. Đây mới là lý do chuỗi tồn tại.

**Đồng thời.** Cùng một idempotency key gửi từ 8 goroutine là kịch bản thật
(người bấm hai lần, client retry khi request đầu chưa xong). Kết quả phải là đúng
một Project, đúng một dòng audit, và chuỗi audit không gãy.

**Evidence level.** Host/local: `go vet ./...` + `go test ./... -count=1` PASS.

#### `T59-604` / `T59-606` — Cách ly cũ, và một binary không dựng lại được

**Cách ly cũ giấu một spec đã LÀNH.** `point-names.spec.ts` bị đưa ra ngoài cổng
vì 14 test hỏng sẵn. Chạy lại 2026-08-21: **18/18 PASS**. Nguyên nhân đã được sửa
ở đâu đó trong W5, nhưng cách ly thì không ai gỡ — và đó là dạng mục ruỗng thứ
hai của một cổng: không chỉ giấu spec đang hỏng, nó giữ luôn spec đã lành ở ngoài
để mọi hồi quy sau này trong file ấy không ai bắt. Nay cổng **tự kiểm**: spec còn
trong danh sách cách ly mà chạy PASS thì cổng đỏ kèm yêu cầu gỡ.

**Chẩn đoán "đói CPU" là SAI, và cái sai đó tự nó giữ cổng đỏ thêm một vòng.**
W6 kết luận flake đến từ đói CPU, vá bằng chờ điều kiện `toBeEditable` 60 s. Hai
chỗ hỏng trong chính bản vá đó:

1. **Phép chờ 60 s nằm trong một test có ngân sách 30 s** — nó không bao giờ chạy
   hết hạn của chính nó. Test chết trước, mang theo thông điệp sai.
2. **Helper đăng nhập được chép tay ở BẢY spec**, bản vá chỉ áp cho một
   (`point-names`). Sáu bản còn lại giữ nguyên cuộc đua, nên lần chạy kế tiếp
   không xanh mà chỉ đổi chỗ đỏ, sang `pa3-a11y.spec.ts`. Một bản vá nằm ở một
   trong bảy bản sao không phải bản vá, chỉ là một lần may.

**Nguyên nhân thật, đọc ra từ trace chứ không từ suy đoán.** `frame-snapshot` của
lần đỏ ghi URL sau cú bấm "Tiếp tục chỉnh sửa" là
`/eng/programming/projects/{id}/programs`, trong khi spec chờ `.../design`. Mà
`design` chính là **lối vào cũ mà W5 đã đổi thành redirect sang `programs`** —
bảng redirect ở test ngay phía trên trong cùng file đã ghi đúng điều đó, chỉ có
assertion này là chưa đuổi kịp. Spec đang chờ một **trạng thái trung gian của
redirect**: máy chậm thì Playwright kịp nhìn thấy `design` và test xanh; máy nhanh
thì redirect xong trước khi phép chờ bắt đầu và test treo tới hết giờ. Vì vậy nó
đỏ **ngắt quãng** và đổi chỗ giữa desktop/mobile — dấu hiệu kinh điển bị đọc nhầm
thành "hạ tầng yếu".

**Ba bản sửa, theo đúng thứ tự nguyên nhân:**

- **Một helper đăng nhập duy nhất** (`e2e/helpers/session.ts`), bảy bản sao bị gỡ,
  và cổng e2e **tự kiểm**: spec nào định nghĩa lại `async function login` thì cổng
  đỏ. Bản vá tiếp theo cho đường đăng nhập từ nay chỉ có một chỗ để áp.
- **E2E phục vụ bản ĐÃ BUILD** (`vite preview`) thay vì dev server. Dev server
  biên dịch route theo yêu cầu, và khoản biên dịch ấy tính vào ngân sách thời gian
  của chính test chạm route đầu tiên. Nới timeout chỉ dời ngưỡng vỡ; bỏ hẳn lớp
  biên dịch-theo-yêu-cầu mới là bỏ nguyên nhân. `preview` được cấp cùng proxy với
  dev để hai đường phục vụ không cho ra hai hành vi mạng khác nhau.
- **Spec chờ đích cuối của redirect**, không chờ lối vào cũ.

**Acceptance đạt.** Năm lần chạy LIÊN TIẾP cổng `e2e`: **79/79 PASS, exit 0, mỗi
lần 28–29 s** (trước: 64 / 79 / 79 / 78+1F / 78+1F, 78–88 s mỗi lần). Thời gian
giảm một nửa là hệ quả trực tiếp của việc bỏ dev server và bỏ một test treo 60 s.
`retries` vẫn để `0`: bật retry ở đây sẽ biến đúng lỗi vừa tìm ra thành màu xanh
và xoá luôn tín hiệu — đã có một vòng chẩn đoán sai vì thiếu tín hiệu, không lặp
lại lần nữa.

**`mkddc-iobus` không dựng lại được.** Build hai lần từ cùng một mã nguồn vào hai
thư mục cho ra hai file khác nhau. `strings` chỉ thẳng nguyên nhân: đường dẫn
tuyệt đối của mã `bacnet-stack` kéo về qua FetchContent bị nhúng vào binary
(`__FILE__` trong assert/log của `ports/linux`). Hệ quả nặng hơn "hash lệch": gói
phát hành mang theo đường dẫn máy build của người đóng gói, và **bên thứ ba không
thể dựng lại để đối chiếu** — provenance mất tính kiểm chứng độc lập, đúng thứ mà
`checksums.sha256` được cho là bảo đảm.

Vá bằng `-ffile-prefix-map`. Bản vá ĐẦU vẫn lệch vì đặt sai thứ tự: thư mục build
nằm lồng trong thư mục nguồn, gcc áp map sau đè map trước, nên map nguồn phải
đứng trước map build. Sau khi sửa thứ tự: **7/7 artifact tái lập**.

**SBOM.** `provenance.json` nói bản này build TỪ ĐÂU; SBOM nói nó CHỨA GÌ — không
có SBOM thì câu "bo của tôi có dính CVE này không" phải trả lời bằng cách đọc lại
mã nguồn của đúng commit. 92 component, mỗi dòng ghi `resolvedFrom`: phiên bản
`libsodium`/`libmodbus` là của **máy build**, không phải của Buildroot trên board,
và một SBOM nói dối chỗ đó còn tệ hơn không có.

### W7 — Target/HIL/V&V và quyết định phát hành

| Task | Priority | Việc làm / source chính | Dependency | Status | Acceptance |
|---|---|---|---|---|---|
| `T59-701` | P0 | Khôi phục GitHub Actions account và chạy full RC workflow | RC T59-606 | EVIDENCE_QUEUE | 11 job khởi chạy thật; required checks PASS trên RC commit. |
| `T59-702` | P0 | Deploy target 10-Program fixture, timing/fault/Web-BE loss | T59-606 | EVIDENCE_QUEUE | 24 h; 3 period; no poll gap >=200 ms; fault isolation/signal freshness đúng. |
| `T59-703` | P0 | Physical I/O HIL cho ST và FBD output | T59-606 | EVIDENCE_QUEUE | AO/DO đo bằng instrument; full candidate/safety path; Disable/rollback physical đúng. |
| `T59-704` | P0 | RETAIN/power-cut/reboot/enable-intent/LKG matrix | T59-606 | EVIDENCE_QUEUE | >=10 power cuts; cold-init/recovery exact; no corrupt accepted/partial active. |
| `T59-705` | P0 | Fresh install/upgrade/controller replacement/rollback rehearsal | T59-606 | **PARTIAL — diễn tập trên BO THẬT xong; cài đè thật và thay bo còn lại** | Cross-build aarch64 + `GOARCH=arm64`, dựng cây `build/release` rồi chạy trọn **cài mới → nâng cấp → rollback** trên chính bo Foxlinx với `MKDDC_INSTALL_ROOT` (ghi vào cây giả, không cài đè). Trả lời được câu mà `T59-606` trên host không trả lời được: script chạy đúng trên Buildroot (BusyBox `adduser`/`addgroup`, không có `getent`/`useradd`). Provisioning khoá thiết bị chạy trên bo, `device.key` mode `0600`, nâng cấp không sinh lại; rollback khôi phục `mkddc-st-package`; cấu hình và artifact còn nguyên. **Sự cố lần chạy đầu, đã ghi đầy đủ:** bản diễn tập làm **dừng `mkddc-iobus` thật** ~50 s — wrapper `systemctl` bỏ sót lời gọi sau `&&` và trả `0` cho `is-enabled`, nên nhánh `&& systemctl restart mkddc-pty` chạy thật và PTY biến mất. Vá lộ thêm lỗi nặng hơn: thân wrapper trong `rollback.sh` gọi **chính nó** — rollback THẬT trên bo sẽ đệ quy vô hạn, lỗi chưa bao giờ chạy vì mọi lần trước đều ở chế độ diễn tập. Sau vá, chạy lại trên bo: mốc `ExecMainStartTimestamp` của iobus/core/pty **không đổi** — không dịch vụ nào bị chạm. 2 test đọc mã nguồn khoá cả ba điều kiện. **Còn lại:** cài đè thật (cần cửa sổ bảo trì vì sẽ restart iobus/netcfg), thay controller (cần bo thứ hai), backup/restore trên dữ liệu vận hành thật. Evidence: `docs/07_records/test-evidence/fw-som/2026-08-22-foxlinx-t59705-rehearsal.md`. |
| `T59-706` | P0 | PID Controls/Safety target review và evidence | T59-602/703 | EVIDENCE_QUEUE | Saturation/anti-windup/override/release pass; approval token; label READY. |
| `T59-707` | P0 | Chạy full V&V unified + trace/risk/release record | T59-701..706 | ORDERED | Mọi Must disposition PASS hoặc waiver có authority; 0 silent NOT_RUN; GO/NO-GO ký. |

### 3.8 Ghi chú thực thi W7 — cái gì đã có bằng chứng, cái gì chặn bởi cái gì

**Đã có bằng chứng thật (`T59-705`, một phần).** Diễn tập cài mới → nâng cấp →
rollback chạy trên **chính bo Foxlinx**, không phải trên host. Đó là khác biệt có
nội dung: host không chứng minh được script sống được trên Buildroot, nơi
`getent`/`useradd` không tồn tại và `adduser`/`addgroup` là BusyBox. Chi tiết và
sự cố kèm theo ở `docs/07_records/test-evidence/fw-som/2026-08-22-foxlinx-t59705-rehearsal.md`.

**Bài học rút ra, áp cho cả phần W7 còn lại.** Một bài *diễn tập* đã làm dừng một
dịch vụ *thật* trong 50 giây, vì wrapper chặn `systemctl` bỏ sót các lời gọi sau
`&&` và trả `0` cho truy vấn trạng thái. Khi làm những task W7 còn lại — vốn đều
chạm vào bo đang vận hành — giả định "chế độ an toàn thì không có tác dụng phụ"
phải được **kiểm**, không được **tin**.

**Ranh giới của phần còn lại.** Không task nào dưới đây bị chặn bởi mã nguồn; tất
cả bị chặn bởi tài nguyên vật lý hoặc bởi một cửa sổ thời gian.

| Task | Chặn bởi | Cần gì để mở |
|---|---|---|
| `T59-701` | Chưa chạy được trên GitHub Actions | Một lần chạy thật trên RC commit |
| `T59-702` | Thời gian và cửa sổ bảo trì | Cài đè thật + **24 h** chạy liên tục với fixture 10 Program; không đo được bằng cách rút ngắn |
| `T59-703` | **Thiết bị đo và người tại tủ** | Đồng hồ/scope đo AO/DO thật; không có đường thay thế bằng phần mềm |
| `T59-704` | **Thao tác vật lý** | ≥10 lần cắt nguồn thật; nguồn lập trình được hoặc người trực |
| `T59-705` (phần còn lại) | Cửa sổ bảo trì + phần cứng | Cài đè thật (sẽ restart `iobus`/`netcfg`); bo **thứ hai** cho kịch bản thay controller |
| `T59-706` | `T59-703` | Evidence PID trên target trước, review Controls/Safety sau |
| `T59-707` | `T59-701..706` | Không tổng hợp được một verdict từ các ô còn trống |

**Một điểm của `ADR-052` phải vào runbook thay bo (`T59-705`).** Artifact được ký
bằng khoá của **chính bo**, nên bê artifact từ bo cũ sang bo mới sẽ bị từ chối —
đúng theo thiết kế. Quy trình thay controller phải **biên dịch lại từ Revision**.
Đây là hệ quả trực tiếp của quyết định ký, và nó phải nằm trong runbook trước khi
có người thay bo lần đầu, không phải sau.

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
