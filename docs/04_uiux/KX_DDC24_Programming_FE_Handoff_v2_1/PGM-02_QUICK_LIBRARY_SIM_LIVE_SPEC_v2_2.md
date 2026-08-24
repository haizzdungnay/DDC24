# PGM-02 — Quick Library, SIMULATE và LIVE — đặc tả Target v2.2

**Document ID:** KX-DDC24-FE-SPEC-PGM02-QL-SIM-LIVE-002<br>
**Phiên bản:** 2.3<br>
**Ngày:** 2026-08-24<br>
**Trạng thái:** TARGET APPROVED FOR IMPLEMENTATION — KHÔNG PHẢI AS-BUILT<br>
**Evidence class:** đặc tả thiết kế; không phải bằng chứng runtime, target/HIL hay physical I/O<br>
**Baseline nguồn đã đối soát:** 1bc3d19e96989c1309f838c0acd01d14d8536d5e<br>
**Phạm vi:** PGM-02A ST, PGM-02B FBD, Quick Library, EDIT, LIVE và SIMULATE<br>
**Quyền nội dung:** `AUTH-PROG-2026-08-24-05` exact-pin Candidate `413a043748dce3b44d2c5076412de761760ba17a`; R1/R2/R3 được mở theo dependency bắt buộc<br>
**Detailed Design authority:** [PROGRAMMING_PGM02_WORKSPACE_DETAILED_DESIGN.md](../../02_design/software/PROGRAMMING_PGM02_WORKSPACE_DETAILED_DESIGN.md)<br>
**Machine-readable Target contract:** [pgm02_workspace_v1.json](../../../contracts/programming/pgm02_workspace_v1.json)

> Hồ sơ này là phần bổ sung triển khai FE cho PGM-02 v2.2. Khi có khác biệt,
> Detailed Design chính thức và contract đã được pin có quyền cao hơn. Liên kết
> Detailed Design và contract đã được Owner + System Architect pin để triển
> khai. Việc pin không biến Target thành As-Built và không thay Test Result,
> target/HIL hoặc release evidence.

## 1. Kết luận và ranh giới bằng chứng

PGM-02 v2.2 dùng một workspace chung cho ST/FBD, một Quick Library chung và ba
mode có nguồn dữ liệu khác nhau:

| Mode | Nguồn tài liệu | Quyền ghi | Giá trị hiển thị | Quyền output vật lý |
|---|---|---|---|---|
| EDIT | Saved Draft của Project | admin | không overlay giá trị runtime | không |
| LIVE | sealed Active revision | không ai; chỉ đọc | snapshot runtime đã join nhất quán | không phát sinh từ UI |
| SIMULATE | immutable saved-Draft snapshot | admin điều khiển session | process image ảo của session | không |

Các năng lực trên là **Target**. As-Built tại baseline chưa có route
/eng/programming/programs độc lập Project, chưa có product simulation session,
chưa có capability cho SIMULATE/step/virtual time, và chưa chứng minh đầy đủ
coherent join của source Active với snapshot runtime. Vì vậy:

- R1 chỉ mở EDIT sau khi PGM02-V22-WP-01..PGM02-V22-WP-06 và gate R1 đạt.
- LIVE chỉ mở ở R2 sau khi join tuple, freshness và read-back qua Core đạt.
- SIMULATE chỉ mở ở R3 sau khi worker sandbox, API, RBAC, quota và fault tests đạt.
- Host executable programming_core_sim_main.cpp là integration harness của Core,
  không phải product simulation runtime và không được dùng làm bằng chứng R3.
- Mọi trạng thái thiếu/mismatch/stale/offline phải hiển thị rõ; không thay bằng 0.

## 2. Nguồn và ánh xạ As-Built

### 2.1 Nguồn sản phẩm và contract

- docs/01_product/DDC24_PROGRAMMING_PRODUCT_SPEC.md: Draft, Check, Active,
  runtime, ST/FBD và Control Library.
- docs/02_requirements/PROGRAMMING_REQUIREMENTS_SPEC.md: yêu cầu hệ thống
  Programming.
- docs/02_design/interfaces/PROGRAMMING_INTERFACE_SPEC.md: HTTP/IPC hiện hành.
- docs/02_design/software/PROGRAMMING_UNIFIED_PRODUCT_DETAILED_DESIGN.md:
  Detailed Design thống nhất hiện hành.
- contracts/openapi/openapi.yaml: HTTP contract đã sinh client.
- contracts/programming/pou_library_registry_v1.json: SYSTEM registry hiện hành.
- contracts/programming/pgm02_workspace_v1.json: Target pin cho workspace v2.2.
- reviews/PGM02_ST_FBD_REDESIGN_IMPLEMENTATION_REVIEW.md: quyết định Owner cho
  PGM02-V22-WP-00, thứ tự R1 EDIT → R2 LIVE → R3 SIMULATE và Simulation v1 admin-only.
- reviews/PGM02_ST_FBD_IMPLEMENTATION_PLAN.md: dependency, work package và gate.

### 2.2 Source mapping hiện hành

| Mối quan tâm | File / symbol As-Built | Ý nghĩa đối với Target |
|---|---|---|
| Route | apps/web-ui/src/features/programming/ProgrammingRoutes.tsx :: PROGRAMMING_WORKSPACE_PATHS, ProgrammingRoutes | route hiện hành còn projects/:projectId/programs; PGM02-V22-WP-01 phải canonicalize |
| Draft | apps/web-ui/src/features/programming/design/useDraftWorkspace.ts :: useDraftWorkspace | PATCH dùng ETag, If-Match, idempotency; 409 giữ buffer |
| POU tree | apps/web-ui/src/features/programming/design/PouTree.tsx :: PouTree | phải chọn bằng objectId |
| Editor | apps/web-ui/src/features/programming/design/editor/ProgramsTab.tsx :: ProgramsTab | projection tương thích còn dùng programId ở một số biên |
| Identity | apps/web-ui/src/features/programming/model/types.ts :: ProgrammingProgram | objectId sở hữu source; programId là runtime identity |
| Draft adapter | apps/web-ui/src/features/programming/model/draftV2.ts :: toWorkspaceDocument | adapter chuyển objects/programs sang view model; không phải authority mới |
| Library API | apps/web-ui/src/features/programming/api/queries.ts :: useProgrammingLibrary | nguồn PROJECT library hiện hành |
| SYSTEM registry | contracts/programming/pou_library_registry_v1.json và scripts/generate_programming_library_registry.py | một registry sinh C++/Go/TS; FE không tạo registry riêng |
| Capability | apps/web-ui/src/features/programming/model/types.ts :: ProgrammingCapabilities | chưa có SIMULATE, LIVE join, step hay virtual-input flags |
| Core trace | apps/core/application/programming/program_ipc_server.cpp :: ProgramIpcServer::handle_trace | là nguồn read-back Core; chưa tự chứng minh coherent join UI |
| Host harness | apps/core/application/programming/programming_core_sim_main.cpp :: main | chỉ dùng integration host, không có sandbox/session product |

## 3. Bất biến bắt buộc

1. Draft khác Active và khác Runtime.
2. Save Draft không thay Active; Check thất bại không làm mất Active/LKG.
3. objectId là identity chọn POU/source; programId chỉ dùng khi POU có runtime
   configuration. FE không suy programId bằng objectId.
4. LIVE luôn mở sealed Active source, không mở Draft rồi gắn số runtime lên đó.
5. SIMULATE luôn pin immutable saved-Draft snapshot; dirty Draft phải Save trước.
6. Quick Library không là registry thứ hai và không parse source để đoán signature.
7. Mọi mutation server phải có auth, idempotency/concurrency contract và read-back.
8. Simulation worker không được mở production SHM, device, socket hoặc OutputWriter.
9. Timeout của mutation là UNKNOWN/RECONCILING; không suy thành success.
10. Mobile dưới 768 px chỉ đọc; không insert, edit, wire, Check, Commission hay
    điều khiển session.

## 4. Identity và observation contract

### 4.1 Document identity

| Field | Type | Bắt buộc | Semantics |
|---|---|:---:|---|
| projectId | UUID string | có | Project sở hữu Draft/Revision |
| revisionId | UUID string | có với source bất biến | Draft snapshot, sealed Revision hoặc Active revision |
| objectId | UUID string | có | POU source identity trong objects[] |
| contentHash | SHA-256 lowercase hex | có với immutable source | chống join nhầm nội dung |
| language | ST hoặc FBD | có | chọn editor surface |
| programId | UUID string hoặc null | chỉ khi có runtime config | runtime scheduling identity; null không có nghĩa là objectId |

Tuple tài liệu chuẩn là
(projectId, revisionId, objectId, contentHash). Thiếu một field khi LIVE hoặc
SIMULATE thì source ở trạng thái UNAVAILABLE.

### 4.2 Value identity

| Field | Type | Bắt buộc | Semantics |
|---|---|:---:|---|
| controllerId | UUID string | LIVE | controller sinh observation |
| activeRevisionId | UUID string | LIVE | Active revision tại lúc lấy snapshot |
| programId | UUID string | LIVE | program runtime |
| sessionId | opaque string | SIMULATE | session sandbox; không tái sử dụng sau stop/expire |
| observationId | stable opaque string | có | identity của biến/port, không dùng display name |
| snapshotSequence | uint64 tăng đơn điệu | có | coherence/freshness ordering |
| observedAt | RFC 3339 UTC | có | wall-clock observation; virtual time tách riêng |
| virtualTimeMs | uint64 | SIMULATE | clock logic của session |
| quality | enum | có | GOOD, UNCERTAIN, BAD, STALE, OFFLINE, UNKNOWN, UNAVAILABLE |
| value | typed JSON hoặc null | có | null khi không có giá trị hợp lệ |
| unit | string hoặc null | tùy type | null nghĩa là type không có unit |

FE chỉ overlay khi toàn bộ tuple nguồn khớp. snapshotSequence cũ hơn sequence đã
render phải bị bỏ. quality khác GOOD không được tô như giá trị điều khiển tốt.

## 5. Quick Library

### 5.1 Ownership và pipeline

SYSTEM:

contracts/programming/pou_library_registry_v1.json
→ scripts/generate_programming_library_registry.py
→ registry sinh C++ / Go / TypeScript
→ LibraryCatalogService

PROJECT:

Programming library API
→ cùng LibraryCatalogService
→ normalized catalog entries

Recent/Favorites chỉ lưu entryId trong preference của chính user. Không copy
signature, source hay metadata library vào localStorage. Khi entry bị xóa hoặc
không tương thích, preference dangling được bỏ khi đọc và không làm hỏng panel.

### 5.2 Normalized entry

| Field | Type | Quy tắc |
|---|---|---|
| entryId | stable string | key duy nhất theo scope + version |
| name | string 1..80 | tên hiển thị/canonical call |
| kind | FUNCTION hoặc FUNCTION_BLOCK | quyết định insertion command; Project là scope/category, không phải kind mới |
| version | semver/string đã pin | không tự lấy latest trong transaction |
| libraryVersion | alias deprecated | phải bằng `version` trong một compatibility major; mismatch fail closed |
| scope | SYSTEM hoặc PROJECT | badge bắt buộc |
| category | enum | Common, HVAC, Logic, Math, Timer, Counter, Signal, Project |
| descriptionKey | i18n key | FE không hardcode mô tả theo entry |
| labelVi / labelEn | string 1..120 | nhãn producer-declared, không suy đoán từ name |
| aliases | string[] | phục vụ search, không dùng làm identity |
| signatureAuthority | SYSTEM_REGISTRY hoặc PROJECT_INTERFACE | producer authority, không phải FE |
| signatureState | VERIFIED, DECLARED hoặc UNAVAILABLE | trust của signature; tách khỏi feature readiness |
| ports | typed ports/arguments với `order` explicit | authority cho ST template và FBD ports; order immutable |
| stateful | boolean | true cần instance ở ST |
| stateLayout | object/null | bắt buộc khi stateful publish; version/size/hash exact |
| supportedLanguages | ST[], FBD[] | entry không phù hợp phải ẩn hoặc giải thích |
| featureState | READY, REVIEW_REQUIRED, UNSUPPORTED, DEPRECATED | fail-closed |
| warningCode | stable string/null | lý do unavailable/review, không lộ chi tiết nội bộ |
| contentSha256 | SHA-256 | pin nội dung |

Search chuẩn hóa Unicode, bỏ khoảng trắng biên và match name trước aliases,
description sau. Với điểm bằng nhau, sort theo category order rồi name
case-insensitive rồi entryId để kết quả ổn định. Recent tối đa 12, Favorites tối
đa 64. Favorites là preference cá nhân; authenticated viewer/operator/admin có
thể đổi preference của chính mình nhưng chỉ admin được insert vào Draft.

### 5.3 Coverage và unsupported policy

Baseline SYSTEM có logic, compare, math gồm MIN/MAX/LIMIT, timer TON/TOF,
trigger R_TRIG/F_TRIG, conversion và PID ở trạng thái REVIEW_REQUIRED. Target
không được quảng bá TP, CTU, CTD, PI, SCALE, Deadband hay Hysteresis cho tới khi
registry, compile/runtime semantics và tests cùng tồn tại.

- READY + language phù hợp + `signatureState!=UNAVAILABLE`: cho phép insert.
- REVIEW_REQUIRED: hiển thị lý do, không insert ở production profile.
- UNSUPPORTED: ẩn mặc định; search exact có thể hiện hàng disabled và lý do.
- DEPRECATED: cho đọc source cũ, không khuyến nghị mới; cần replacementId nếu có.
- Registry/API/capability không đồng thuận: panel ERROR/UNAVAILABLE, không dùng
  danh sách cached để insert.

### 5.4 Insertion transaction

| Bối cảnh | Command logic | Kết quả atomic |
|---|---|---|
| ST FUNCTION | INSERT_CALL_TEMPLATE | chèn lời gọi tại cursor |
| ST FB đã có instance tương thích | INSERT_FB_INVOCATION | chèn call instance |
| ST FB chưa có instance | CREATE_INSTANCE_AND_INSERT_CALL | tạo declaration + call trong một undo step |
| FBD thả vào canvas | ADD_NODE | thêm node với ports theo signature |
| FBD thả lên edge/port hợp lệ | ADD_NODE_AND_CONNECT | thêm node và nối edge trong một transaction |

Nếu có nhiều instance/overload/điểm nối hợp lệ, mở chooser; cancel gây zero
mutation. Nếu type check, capability, permission hoặc revision guard thất bại,
không phần nào của transaction được lưu. Một thao tác thành công tương ứng một
undo step và ghi Recent sau khi editor xác nhận commit local.

### 5.5 Quick Library states

- LOADING: skeleton, search disabled, không render cached entry như authoritative.
- EMPTY: thông báo không có entry phù hợp, giữ filter visible.
- ERROR: thông điệp người dùng + stable code + Retry.
- PERMISSION: vẫn đọc catalog nếu role cho phép; insert disabled kèm lý do.
- OFFLINE: catalog cached chỉ để tham khảo, insert disabled.
- STALE: badge Stale; yêu cầu refresh trước insert.
- UNKNOWN/UNAVAILABLE: không suy supported.

## 6. Mode state machine

### 6.1 Workspace mode

Các mode hợp lệ: EDIT, LIVE, SIMULATE. Default là EDIT. URL mode chỉ là yêu cầu;
server capability, role và state mới quyết định mode hiệu lực.

| Từ | Sang | Guard | Side effect |
|---|---|---|---|
| EDIT | LIVE | R2 enabled, runtime available, Active tuple resolved | bỏ editor mutation state; fetch Runtime → Active revision → snapshot |
| EDIT | SIMULATE | R3 enabled, admin, Draft saved, capability true | create session từ immutable snapshot |
| LIVE | EDIT | Draft load được | đóng stream/read subscription; load saved Draft |
| LIVE | SIMULATE | quay qua EDIT guard, Draft saved | không tái dùng Active snapshot |
| SIMULATE | EDIT | stop/expire session được xác nhận hoặc force cleanup an toàn | reload saved Draft; không copy virtual outputs |
| SIMULATE | LIVE | stop session rồi thực hiện LIVE join mới | không dùng simulation values |

Dirty Draft khi yêu cầu SIMULATE trả SAVE_REQUIRED. Active đang chuyển revision
khi mở LIVE vào RECONCILING. Mode chưa được increment gate mở phải disabled với
copy cụ thể, không render control giả.

### 6.2 Shared mode payload

Mọi mode view model phải mang:

- projectId, objectId và language;
- document revisionId + contentHash;
- mode + lifecycle state;
- capability source/version;
- role/effective permissions;
- freshness/connection state;
- với LIVE: activeRevisionId, programId, snapshotSequence;
- với SIMULATE: sessionId, session state, virtualTimeMs, speed và sequence.

## 7. EDIT contract

EDIT mở Saved Draft. Chỉ admin được thay source/graph. viewer/operator có thể đọc
source nhưng editor read-only. Save dùng ETag/If-Match + idempotency key; response
server là read-back authority. HTTP 409 giữ buffer local, hiện banner conflict và
cho Reload/Merge; không overwrite im lặng.

Quick Library chỉ insert trong EDIT. Check/Seal là workflow riêng; Save không
đồng nghĩa Check và Check không đồng nghĩa Commission.

## 8. LIVE contract

### 8.1 Trình tự mở

1. Đọc runtime status authoritative.
2. Lấy activeRevisionId và artifactHash đã committed.
3. Đọc immutable Active revision/source bằng revisionId.
4. Mở snapshot/monitor stream.
5. Join document tuple với value tuple.
6. Chỉ render overlay khi tuple khớp và sequence tăng đơn điệu.

LIVE là read-only, kể cả admin. Không có online patch, force value, override,
commission hay output command trong PGM-02.

### 8.2 Join và freshness

Overlay hợp lệ chỉ khi:

- runtime lifecycle là committed/running theo contract;
- controllerId đúng controller context;
- activeRevisionId bằng revision source đang mở;
- artifactHash/content pin phù hợp contract;
- programId map duy nhất tới objectId đang xem;
- snapshotSequence không giảm;
- observedAt nằm trong freshness window;
- quality cho phép hiển thị.

Sai một điều kiện: bỏ overlay cũ và chuyển RECONCILING hoặc UNAVAILABLE. Không
giữ con số cuối rồi đổi nhãn nhỏ khó thấy. Stale có thể hiển thị last value chỉ
khi UI gạch/đánh dấu rõ và cho biết observedAt; Offline/Unknown/Unavailable dùng
—, không dùng 0.

### 8.3 Watch và Trace

Watch/Trace dùng observationId, không dùng text source hoặc display name làm key.
Trace session phải pin activeRevisionId + artifactHash + variable set. Mẫu trace
phải có sequence, timestamp, quality và droppedSamples. Nếu Core/backend không
chứng minh cùng pin, FE báo UNAVAILABLE; không nối trace cũ sang revision mới.

## 9. SIMULATE contract

### 9.1 Kiến trúc và isolation

FE gọi Backend session service. Backend:

1. xác thực admin và capability;
2. xác nhận Draft đã Save, seal immutable simulation snapshot;
3. compile/validate bằng production compiler path;
4. khởi chạy process mkddc-programming-sim-worker theo session;
5. nạp production artifact executor vào private scheduler/clock/Point/Signal/
   RETAIN image;
6. trả read-back session + snapshot sequence.

Worker bị cấm production SHM, device, fieldbus socket và OutputWriter. Cả input
lẫn output đều nằm trong virtual point image. Process crash chỉ làm FAILED
session; không được ảnh hưởng Active runtime.

### 9.2 Capability discovery

Default là unsupported. FE chỉ mở control khi capability response có:

- simulationSupported = true;
- workerProtocolVersion tương thích;
- actions được server cho phép;
- allowedSpeeds;
- limits và expiry;
- supported target profile;
- virtualInputManifestAvailable = true.

Thiếu field, version mismatch hoặc discovery lỗi → SIMULATE UNAVAILABLE. FE
không suy capability từ việc nút/endpoint tồn tại.

### 9.3 Session states

- PREPARING → PAUSED → RUNNING ↔ PAUSED → STOPPED
- PREPARING/RUNNING/PAUSED → FAILED
- PAUSED/RUNNING → EXPIRED
RUNNING → COMPLETED khi scenario hữu hạn kết thúc.

- Create thành công phải read-back PREPARING hoặc PAUSED cùng sessionId.
- RUN chỉ đổi wall pacing; virtual scheduler semantics không đổi.
- PAUSE có hiệu lực tại scheduler safe boundary.
- STOP idempotent; STOPPED/EXPIRED không nhận mutation mới.
- Worker timeout đưa UI tới UNKNOWN/RECONCILING rồi GET read-back; không retry
  mutation không có idempotency key.

### 9.4 Step cycle và virtual time

Reset đặt virtualTimeMs = 0, next release = 0, state PAUSED, clear private
outputs/trace theo manifest và tái khởi tạo RETAIN sandbox; không đọc production
RETAIN.

Một STEP_CYCLE thực hiện đúng một base tick:

1. snapshot toàn bộ eligible virtual inputs một lần;
2. chạy tất cả program đến hạn theo stable order;
3. commit sandbox output batch atomically;
4. ghi Watch/Trace snapshot;
5. tăng virtualTimeMs thêm base tick;
6. quay về PAUSED và tăng snapshotSequence.

Base tick là GCD của program periods được profile cho phép. Không có step-program
ở v1. Speed 1×/10×/60× chỉ đổi thời gian chờ wall-clock giữa tick; không bỏ tick,
đổi timer semantics hay đổi kết quả logic.

### 9.5 Virtual input

Eligible input chỉ đến từ compiler manifest:

- VAR_INPUT;
- READ binding được đánh dấu simulationWritable.

Bị cấm: OUTPUT, IN_OUT, RETAIN, INTERNAL, COMMAND, OVERRIDE,
PRODUCTION_WRITER. Mỗi input có observationId, IEC type, unit, min/max/enum,
required/null semantics và current value. FE validate tiện ích; server vẫn là
authority và phải reject sai type/unit/range.

SET_INPUT cần sessionId, expected snapshotSequence, observationId, typed value,
idempotency key và correlation ID. Success trả session read-back cùng sequence
mới. Không cho nhập bằng display label.

### 9.6 Resource limits

Target v1:

- tối đa 1 session/controller;
- idle TTL 900 s, hard TTL 3600 s;
- worker RSS tối đa 64 MiB;
- CPU tối đa 25% một core;
- 10 actions/s;
- tối đa 10.000 trace samples;
- tối đa 256 virtual inputs;
- worker command timeout 2.000 ms.

Vượt quota phải dừng/expire fail-closed và trả stable error, không giảm limit âm
thầm.

## 10. RBAC

| Hành động | viewer | operator | admin |
|---|:---:|:---:|:---:|
| Đọc Project/POU/source | có | có | có |
| Đọc Quick Library | có | có | có |
| Đổi Favorites của chính mình | có | có | có |
| Insert Quick Library / edit Draft | không | không | có |
| Mở LIVE/Watch/Trace đọc | có | có | có |
| Đọc SIMULATE session/snapshot hiện hữu | có | có | có |
| Tạo SIMULATE session | không | không | có |
| Run/Pause/Step/Reset/Stop/Set input | không | không | có |
| Commission/override/output | không thuộc PGM-02 | không thuộc PGM-02 | không thuộc PGM-02 |

FE gating chỉ là UX. Backend/Core phải kiểm tra lại. Permission change giữa
session: mutation kế tiếp trả 403, UI chuyển read-only và yêu cầu admin Stop;
TTL vẫn bảo đảm cleanup.

## 11. Stable state và lỗi

### 11.1 Presentation states

| State | Copy/action bắt buộc | Dữ liệu được giữ |
|---|---|---|
| LOADING | skeleton + Đang tải…; không có mutation | chưa render cache authoritative |
| ERROR | thông điệp + stable code + Retry/Details | giữ Draft buffer nếu lỗi save |
| PERMISSION | Không đủ quyền; control disabled | cho đọc dữ liệu được phép |
| UNKNOWN | Chưa xác nhận trạng thái; Refresh | không suy success/value |
| STALE | Stale + observedAt + Refresh | last value chỉ khi đánh dấu rõ |
| OFFLINE | Controller ngoại tuyến | source cached read-only; value là — |
| RECONCILING | Đang đối soát revision… | không overlay |
| UNAVAILABLE | Năng lực/dữ liệu không khả dụng | không fallback sang giả lập local |

### 11.2 Simulation stable errors

| Code | HTTP gợi ý | FE behavior |
|---|---:|---|
| PRG-SIM-UNSUPPORTED | 409 khi capability/profile không hỗ trợ; 503 khi supervisor không khả dụng | disable mode, giải thích capability/profile |
| PRG-SIM-SAVE-REQUIRED | 409 | về EDIT, yêu cầu Save Draft |
| PRG-SIM-FORBIDDEN | 403 | read-only, không retry mutation |
| PRG-SIM-INPUT-NOT-ALLOWED | 422 | đánh dấu input, giữ session |
| PRG-SIM-STALE-SESSION | 409 | GET read-back, không áp optimistic value |
| PRG-SIM-QUOTA | 429/409 | hiện limit/expiry, không loop retry |
| PRG-SIM-WORKER-FAILED | 503 | FAILED, tải diagnostics, Stop/cleanup |
| PRG-SIM-EXPIRED | 410 | clear controls, không tái dùng sessionId |

HTTP cụ thể và envelope do formal Detailed Design + OpenAPI pin. FE không được
tự hardcode endpoint hoặc status chưa có trong generated client.

## 12. Concurrency, timeout và atomicity

- Save Draft: If-Match/ETag + idempotency key; 409 giữ buffer.
- Insert: một editor transaction/một undo; precondition objectId +
  documentRevisionId.
- LIVE: read-only; sequence monotonic và revision pin.
- Session mutations: idempotency key + expected session sequence.
- Timeout: UNKNOWN/RECONCILING → GET read-back; chỉ retry khi contract xác nhận
  idempotent.
- Activation/rollback runtime chỉ được handoff tại Core safe boundary. Failure
  trước handoff phải zero mutation lên live topology/signal/scheduler.
- Simulation không tham gia Commission, activation hay LKG.

## 13. Rollback và compatibility

| Increment | Feature flag | Rollback |
|---|---|---|
| R1 EDIT | programsWorkspaceV2 | trở về route/workspace cũ, giữ Draft server |
| R2 LIVE | programsLiveV2 | tắt overlay/trace mới, giữ source read-only |
| R3 SIMULATE | programsSimulation | ngăn session mới, stop/expire session cũ, bỏ capability |

Schema phải additive trong thời gian chuyển tiếp. Legacy deep-link
projects/:projectId/programs và projects/:projectId/design phải redirect, giữ
program/pou/mode/line/column/node/port/edge/hash khi hợp lệ. Rollback FE không
xóa Project, Draft, sealed Revision, Active hoặc LKG.

Nếu Core IPC/backend/FE version mismatch, capability false và UI UNAVAILABLE.
Không downgrade ngầm sang path thiếu isolation.

## 14. Responsive, accessibility và visual authority

- ≥1280 px: full shell; editor/canvas là vùng chính.
- 1024–1279 px: Quick Library và Inspector dùng dock/tab.
- 768–1023 px: side panels thành drawer; authoring vẫn chỉ khi đủ viewport và
  capability.
- <768 px: read-only; không hiển thị control mutation.
- Focus ring tối thiểu 2 px; text contrast tối thiểu 4.5:1; keyboard parity;
  reduced-motion; color không là tín hiệu duy nhất.

Visual references:

- [PGM-02 combined desktop + mobile](assets/PGM-02_ST_FBD_combined_reference.svg)
- [PGM-02A ST editor](assets/PGM-02A_ST_editor_reference.svg)
- [PGM-02B FBD editor](assets/PGM-02B_FBD_editor_reference.svg)

Các asset là Target layout có dữ liệu minh họa, không phải screenshot runtime.

## 15. Acceptance và verification

| Test ID | Lớp | Tiền điều kiện / thao tác | Kết quả định lượng |
|---|---|---|---|
| TC-PGM02-ID-01 | unit/contract | objectId khác programId | chọn/xóa/sửa đúng POU; không suy identity |
| TC-PGM02-QL-01 | contract | sinh C++/Go/TS từ SYSTEM registry | cùng entryId/version/signature/hash |
| TC-PGM02-QL-02 | unit | search/rank cùng fixture | thứ tự deterministic qua 20 lần |
| TC-PGM02-QL-03 | editor unit | create FB instance + call | một undo xóa cả declaration và call |
| TC-PGM02-QL-04 | negative | chooser cancel/type mismatch | zero mutation, Recent không đổi |
| TC-PGM02-MODE-01 | route E2E | viewer/operator/admin đổi mode | đúng matrix; server 403 vẫn authoritative |
| TC-PGM02-LIVE-01 | integration | revision/artifact tuple khớp | overlay đúng observationId, ≤10 Hz |
| TC-PGM02-LIVE-02 | fault | đổi Active giữa stream | bỏ overlay trong một render cycle; RECONCILING |
| TC-PGM02-LIVE-03 | fault | missing/stale/offline sample | — hoặc last value marked; không render 0 giả |
| TC-PGM02-SIM-01 | contract | capability absent/version mismatch | mode UNAVAILABLE, không gọi create |
| TC-PGM02-SIM-02 | integration | dirty Draft create session | SAVE_REQUIRED; không worker/session side effect |
| TC-PGM02-SIM-03 | worker | một STEP_CYCLE | một input snapshot, due tasks stable, một output commit, PAUSED |
| TC-PGM02-SIM-04 | determinism | reset + cùng fixture chạy 100 lần | output/trace hash giống nhau |
| TC-PGM02-SIM-05 | isolation | probe SHM/device/socket/writer | mọi production handle bị từ chối; Active output không đổi |
| TC-PGM02-SIM-06 | RBAC | viewer/operator gọi 7 mutation | 403 PRG-SIM-FORBIDDEN, zero side effect |
| TC-PGM02-SIM-07 | input | output/retain/override/type/range sai | 422, sequence/value hợp lệ trước đó giữ nguyên |
| TC-PGM02-SIM-08 | quota/fault | RSS/CPU/TTL/worker crash | FAILED/EXPIRED, cleanup process, Active không đổi |
| TC-PGM02-RESP-01 | browser | 1280×750 và 390 px | desktop đủ panels; mobile không có mutation control |
| TC-PGM02-A11Y-01 | browser | keyboard + axe/contrast | không critical violation; focus luôn thấy |
| TC-PGM02-RB-01 | integration | tắt từng feature flag | rollback đúng bảng; Draft/Active/LKG giữ nguyên |

Host unit/contract/browser PASS không thay thế target/HIL/physical-I/O evidence.
R2 cần producer → Core IPC → Backend API → FE → read-back. R3 cần worker
isolation và determinism evidence trên target-compatible runtime. RELEASE_READY
mặc định NO-GO cho tới khi formal verification record được ký.

Lệnh kiểm tra dự kiến sau triển khai:

- FE unit: cd apps/web-ui && npx vitest --run --environment jsdom src/features/programming
- FE lint/build: cd apps/web-ui && npm run lint && npm run build
- Route E2E: cd apps/web-ui && npx playwright test e2e/programming.spec.ts e2e/programming-real.spec.ts
- Contract: python3 scripts/verify_programming_pgm02_contract.py
- Registry: python3 scripts/generate_programming_library_registry.py --check
- C++ gate: cmake --fresh -S . -B build/fw -DCMAKE_BUILD_TYPE=Release -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON; cmake --build build/fw --parallel; ctest --test-dir build/fw --output-on-failure

## 16. Gap/dependency bắt buộc trước khi mở mode

| Gap | Owner | Ảnh hưởng | Gate | Điều kiện mở |
|---|---|---|---|---|
| Formal DDD và Target contract | Owner + Architect | mọi increment | **CLOSED — `AUTH-PROG-2026-08-24-05`** | exact Candidate `413a043`; thay đổi sau pin đi qua change control |
| Route/project resolver chưa có | FE + BE | R1 | PGM02-V22-WP-01 | zero/one/many/invalid tests pass |
| objectId/programId còn projection lẫn | FE + BE | R1/R2 | PGM02-V22-WP-02 | contract + migration tests pass |
| Quick Library normalized service/các block thiếu | BE + FE + Core | R1 | PGM02-V22-WP-03 | registry parity + insert atomic tests |
| LIVE coherent tuple/Trace pin chưa chứng minh | Core + BE | R2 | PGM02-V22-WP-09 | lifecycle safe-boundary + end-to-end read-back |
| Simulation capability/API/worker chưa tồn tại | Core + BE | R3 | PGM02-V22-WP-07/08; hardening PGM02-V22-WP-10/11/12 | sandbox, quota, deterministic step, RBAC tests |
| Target/HIL và physical isolation evidence chưa có | QA + Runtime | release | RELEASE_READY | formal record có authority ký |

## 17. Sign-off

| Vai trò | Trạng thái |
|---|---|
| Product Owner/CTO | **APPROVED FOR IMPLEMENTATION** — `AUTH-PROG-2026-08-24-05` |
| System Architect | **APPROVED EXACT REVISION** — Candidate `413a043` |
| FE Lead | `WAIVED FOR IMPLEMENTATION`; finding sửa trong task R1/R2/R3 |
| Backend/Core Lead | `WAIVED FOR IMPLEMENTATION`; contract/evidence hoàn thiện theo dependency |
| QA/Verification | `WAIVED FOR IMPLEMENTATION`; U13–U15 vẫn NOT_RUN và review release không bị waive |

Không được đổi trạng thái tài liệu này thành As-Built chỉ vì UI đã render. Chỉ
đổi sau khi source mapping, generated contract, migration, tests và runtime
read-back tương ứng đã tồn tại và được kiểm chứng.

## 18. Lịch sử

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 2.3 | 2026-08-24 | Ghi AUTH-05/exact pin; tách `featureState` khỏi `signatureState`, bổ sung producer authority/typed ports và giữ release evidence trung thực. |
| 2.2 | 2026-08-24 | Candidate Target cho Quick Library, LIVE và Simulation; chưa có execution authority. |
