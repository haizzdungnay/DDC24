# Baseline nghĩa interface Programming DDC-24 Rev A

| Thuộc tính | Giá trị |
|---|---|
| ID | `IFSPEC-PROG-001` |
| Phiên bản | 0.2 |
| Trạng thái | `IN REVIEW — DATA MEANING/AUTHORITY ONLY` |
| Nguồn | IF-REQ-PROG-001, IF-REQ-PROG-002; Product/UX proposal v2.2 |

## Mục lục

1. Ranh giới
2. Project/Draft/Revision
3. Point binding và arbitration
4. Lifecycle/cutover/manifest
5. Monitor/core state
6. Bundle replacement
7. Enforcement và mã lỗi
8. Nội dung chưa phê duyệt
9. Thuật ngữ
10. Lịch sử và phê duyệt

## 1. Ranh giới

IFSPEC khóa **nghĩa dữ liệu và authority**, không khóa URL, transport, JSON/
protobuf/SHM layout, DB schema hoặc package name. Graph/Modbus API snapshot không
phải Programming API. Error namespace `PRG-ERR-*` thuộc duy nhất IFSPEC.

## 2. Project/Draft/Revision

| Trường/khái niệm | Nghĩa bắt buộc |
|---|---|
| project/program identity | Stable identity, không suy từ display name. |
| `base_revision`/ETag | Version mà mutation dựa vào; base cũ phải conflict, không last-write-wins. |
| Draft | Backend store trên controller là authority; browser cache không authority. |
| Revision | Immutable snapshot source/mapping/Task/library/metadata + actor/time. |
| Candidate | Revision Check đạt/staged; chưa Active. |
| Active/LKG | Chỉ runtime/lifecycle authority xác nhận. |

## 3. Point binding và arbitration

| Nhóm | Nghĩa bắt buộc |
|---|---|
| Point identity | Discriminated category; chỉ `LOCAL`, `VP`, `MB-RTU`; RTU dùng `{device_id, point_id}`. |
| Variable identity | Stable identity/name trong Program/Revision, không suy từ Point name. |
| Data contract | IEC type, Point kind, direction, access, unit/range, quality policy. |
| `program_value` | Đóng góp Program/Local logic mức 5 trước resolver. |
| `actual_value` | Giá trị hiệu lực sau resolver/interlock/final limit. |
| `overridden_by` | Nguồn mức 1–4 đang thắng; không được thay bằng copy mơ hồ. |
| `effective_priority` | Priority của nguồn quyết định actual tại sample. |
| Override TTL | Source/actor/requested/actual/priority/start/TTL còn lại từ runtime authority. |
| Quality/freshness | GOOD/UNCERTAIN/BAD/STALE/OFFLINE/UNKNOWN cùng timestamp; không fake zero. |

## 4. Lifecycle, cutover và change manifest

| Trường/khái niệm | Nghĩa bắt buộc |
|---|---|
| `correlation` | Nối request/retry/result/audit; không suy success từ transport. |
| requested action | Check, Commission, Restore là action riêng. |
| authority result | Accepted/rejected/timeout/unknown/active/failed; Unknown phải reconcile. |
| `active_revision` | Revision runtime đang chạy, tách Draft/Candidate. |
| cutover state | `GRAPH_ONLY`, `PROGRAM_ONLY`, `DUAL_INVALID`; dual phải reject/giữ LKG. |
| structured change manifest | Danh sách object đổi: source, binding, Task, library, output impact, RETAIN impact, cutover impact. |
| hold-last state | `previous_program_value`, first program commit/result; không dùng actual làm state seed. |
| watchdog/IOP readiness | Base-step bound, watchdog result và poll-gap readiness cần thiết trước Commission; schema chưa khóa. |

## 5. Monitor/core state

Monitor sample phải có identity, authority, active Revision, value/state,
quality, source timestamp/freshness và arbitration fields khi áp dụng. Core state
chỉ `RUNNING/DEGRADED/UNREACHABLE`; Point `OFFLINE` không phải core state.
Reconnect không được replay mutation. Monitor read-only mặc định.

## 6. Bundle replacement

Export/import meaning bắt buộc:

- bundle source-only gồm source ST/FBD, mapping, một Task, Core Library version,
  Revision metadata, manifest, integrity hash;
- cấm artifact, Typed IR, native binary, build cache, trust material;
- import tạo Draft, validate target, build lại controller đích, không auto-activate;
- corrupt/wrong-target/forbidden content trả stable `PRG-ERR-*` và audit.

## 7. Enforcement và mã lỗi

| Boundary | Phải reject |
|---|---|
| UI/authoring | Capability/Point/cycle ngoài allowlist, mutation trái quyền |
| API/import | Unknown payload, artifact ngoại nhập, legacy graph giả FBD, base stale |
| Validator/compiler | Syntax/semantic/type/mapping/limit invalid |
| Runtime loader | Artifact sai version/ABI/integrity/Revision/scope |
| Cutover/runtime | Dual owner mức 5, watchdog/IOP readiness fail |

Catalog duy nhất: [01_ERROR_CODE_CATALOG.md](01_ERROR_CODE_CATALOG.md). Product/
UX chỉ tham chiếu, không tự định nghĩa mã.

## 8. Nội dung chưa phê duyệt

URL/version/transport/schema/size/rate/idempotency window/monitor retention/write
policy chưa khóa. Chỉ được khóa sau các OD tương ứng và Interface Design review.

## 9. Thuật ngữ

Xem [DICT-PROG-001](../00_document_control/02_TERMS_AND_DATA_DICTIONARY.md).

## 10. Lịch sử và phê duyệt

| Phiên bản | Ngày | Thay đổi |
|---|---|---|
| 0.1 | 2026-08-08 | Interface requirement baseline ban đầu. |
| 0.2 | 2026-08-09 | Thêm arbitration, TTL, concurrency, cutover, manifest, bundle và error ownership. |

Sign-off: Interface Owner `PENDING`; Product `PENDING`; Runtime Architecture `PENDING`; Security `PENDING`; Verification `PENDING`.
