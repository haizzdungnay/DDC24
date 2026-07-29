# 09 — mkddc-web Implementation Guide
## MK-DDC-24 — REST API + Web UI + Config + Validator

> **Document ID:** IMPL-WEB-MK-DDC-24-VI
> **Phiên bản:** 1.48 | 2026-07-29 (tích hợp RBAC bốn role với strict Network v1) · 1.47 | 2026-07-27 (offline smoke accounts + feature-authority split) · 1.46 | 2026-07-27 (native Linux race evidence)
> **Cập nhật hiện hành:** RBAC backend/FE/test đã hoàn tất code-local; Network giữ DNS/capability/management contract mới và transaction dành cho Engineer/Admin. Clean CI artifact, target rollout, physical IP handoff và independent security approval vẫn mở.
> **Owner:** Dev 3 (Web/BE)
> **Nguồn-chuẩn:** [REST_API_OPENAPI](../02_design/interfaces/REST_API_OPENAPI_MK-DDC-24_VI.md) ·
> [CONFIG_SCHEMA](../02_design/interfaces/CONFIG_SCHEMA_MK-DDC-24_VI.md) ·
> [GRAPH_SCHEMA](../02_design/interfaces/GRAPH_SCHEMA_MK-DDC-24_VI.md) · [ADR-007](../adr/ADR-007-web-stack-go.md) · [ADR-009](../adr/ADR-009-isa101-hmi-and-nav-restructure.md) · [ADR-017](../adr/ADR-017-settings-network-tabs-and-state-contract.md) · [UX-SYSTEM](../04_uiux/KX-DDC24-UX-SYSTEM-001_VI.md)

> 🎯 Vai trò: giao diện người dùng + API. **Web KHÔNG mở UART, KHÔNG gọi MCU, KHÔNG ghi
> thẳng IO.** Web gửi command/setpoint cho **core** qua IPC; core quyết định. Mọi command
> ghi **audit log**.

---

## 1. Backend module (Go)

```
web/backend/
├── main.go            — HTTP/HTTPS server, router, TLS 1.3, middleware
├── auth.go            — POST login (JWT), bcrypt, capability RBAC 4 role + persisted session version
├── points.go          — GET/PUT points → IPC tới core (đọc snapshot, gửi command)
├── system.go          — GET/PUT system status/config (IOP metrics, sensor type, network)
├── alarms.go          — GET alarms, POST ack (đọc alarm bus / eventlog)
├── commissioning.go   — POST test point → command tới core (nguồn manual — mức 2; role operator+)
├── graph.go           — POST validate (validator lib), POST deploy (ghi graph.json)
├── core_client.go     — IPC client tới mkddc-core (/run/mkddc/core.sock — contract đầy đủ: 07 §8)
├── audit.go           — ghi audit log mọi command/deploy (user, ts, action, result)
└── store.go           — SQLite (config.sqlite, eventlog.sqlite) WAL
```

### 1.1 RBAC Web 4 role (RBAC-BE/FE/TEST code-local done; target release gate pending)

Canonical docs/OpenAPI, backend và frontend hiện đã nhận `viewer|operator|engineer|admin`; packaged
`users.conf` đã dùng schema 2.0 với `session_version`. Bảng dưới là policy owner đã chốt.
Live-stack E2E bốn account đã hoàn tất trong fixture cô lập; rollout target vẫn nằm ngoài
completion claim code-local của `RBAC-BE-001/002/003` + `RBAC-FE-001/002` + `RBAC-TEST-001`. Bảy route authority-pending có authorization đã chứng minh nhưng business implementation được theo dõi riêng bởi `WEB-FEATURE-AUTH-001`. Enum dùng chính xác `engineer` (không dùng `engineering`). Nhãn **Engineering**
trong navigation là tên nhóm chức năng, không phải tên role.

| Capability / action | viewer | operator | engineer | admin |
|---|---:|---:|---:|---:|
| Login/logout, xem `/me`, tự đổi mật khẩu | ✅ | ✅ | ✅ | ✅ |
| Đổi ngôn ngữ/hiển thị cá nhân, không ghi cấu hình thiết bị | ✅ | ✅ | ✅ | ✅ |
| Xem dashboard, points, status, alarms, trends/history và export CSV | ✅ | ✅ | ✅ | ✅ |
| Xem source/revision/build result của Programming | ✅ read-only | ✅ | ✅ | ✅ |
| Manual override/release point, commissioning DO/AO, ACK/suppress/return alarm | — | ✅ | ✅ | ✅ |
| Sửa draft, validate và build chương trình | — | ✅ | ✅ | ✅ |
| Deploy/activate/rollback chương trình | — | — | ✅ | ✅ |
| Đổi Settings hệ thống/phần cứng: device/network/time/I/O/BACnet/fieldbus/safe-state | — | — | ✅ | ✅ |
| Đổi cấu hình vận hành: schedule, alarm threshold/policy, point metadata, virtual point | — | — | ✅ | ✅ |
| Ethernet transaction: validate/stage/apply/confirm/rollback | — | — | ✅ | ✅ |
| Xem trạng thái database logging/policy và dữ liệu đã ghi | ✅ | ✅ | ✅ | ✅ |
| Đổi database logging policy, interval, retention, start time hoặc chạy maintenance | — | — | — | ✅ |
| Xem danh sách Users; tạo/xóa/đổi role/reset mật khẩu user khác | — | — | — | ✅ |
| OTA và download log hệ thống | — | — | ✅ | ✅ |

Ranh giới đã chốt:

- `operator` giữ các quyền vận hành hiện có: manual override/release, commissioning và
  alarm lifecycle. Role này bị chặn nhóm Settings nhưng vẫn được sửa/validate/build
  chương trình; không được deploy/activate/rollback. "Alarm lifecycle" chỉ gồm
  ACK/suppress/return trên alarm runtime; không gồm sửa alarm threshold/policy. Operator
  cũng không được `PUT` schedule, sửa point metadata hoặc CRUD virtual point.
- `engineer` tương đương admin ngoại trừ hai capability nhạy cảm: User management và
  database mutation. Engineer không được xem cả danh sách Users; direct URL/API phải trả
  `403` và không được tạo background request tới Users API.
- "Không thay đổi database" áp cho historian logging policy/interval/retention/start time
  và maintenance. Xem Trends/History, export CSV và xem trạng thái policy vẫn là read-only
  hợp lệ. Việc Settings hợp lệ ghi persistence nội bộ không bị xem là database management.
- `viewer` chỉ read-only đối với dữ liệu và Programming. Hai ngoại lệ cá nhân là đổi mật
  khẩu của chính mình và thay đổi Display/language cục bộ; viewer không được xem Users hay
  vào Settings thiết bị.
- `/settings/display` và `/me` là personal surface cho mọi role; chúng không mở quyền vào
  các route Settings thiết bị còn lại.
- Schedule, alarm settings, point metadata và virtual point là **configuration mutation**,
  không phải operation runtime; backend hiện bắt buộc `engineer+`. Ethernet transaction cũng
  là `engineer+`; negative endpoint tests khóa Operator khỏi các surface này.
- Kết luận independent re-review 2026-07-27: không đổi `PUT /schedules` hoặc
  `PUT /alarm-settings` xuống Operator. Vận hành hằng ngày là ACK/suppress/return và
  override/release; sửa lịch điều khiển hoặc ngưỡng/policy alarm làm thay đổi cấu hình bền
  vững của thiết bị nên tiếp tục thuộc `settings.manage` (`engineer+`). Đây là quyết định
  policy đã chốt, không phải mâu thuẫn giữa guide và OpenAPI.
- CLI bảo trì database chạy bằng tài khoản hệ điều hành nằm ngoài Web-user RBAC. Không tạo
  API raw SQL hoặc cấp quyền Web để sửa trực tiếp file SQLite.
- `admin` có toàn bộ business capability nhưng vẫn chịu invariant an toàn: không xóa chính
  mình, không xóa hoặc hạ quyền admin cuối cùng, và mọi mutation nhạy cảm phải được audit.

#### 1.1.1 Mô hình authorization

- Backend là authority. `RoleEngineer` và permission constants tập trung đã được bổ sung, ví dụ
  `operate`, `program.edit`, `program.activate`, `settings.manage`, `database.manage` và
  `users.manage`; route dùng `RequirePermission(...)`, không suy quyền chỉ từ FE hoặc một
  phép so sánh rank chung.
- Router/handler Web hiện không còn `Require(min Role)`, `RoleAllows` hoặc `roleRank` làm
  authorization policy. Mọi protected route hiện hành đi qua `RequirePermission`; permission
  hoặc role không biết mặc định deny. Local-HMI giữ hierarchy riêng và không chiếu Web Engineer
  thành local-HMI Operator.
- `users.manage` và `database.manage` chỉ map cho admin; `program.activate`,
  `settings.manage` và `system.release` chỉ map cho engineer/admin. Route inventory test khóa
  toàn bộ 55 protected route hiện hành vào permission cụ thể.
- `RBAC-BE-003` đã reconcile exact route set code/OpenAPI v1.11.0: login là operation public;
  61 protected operation có mapping one-to-one và role set khớp permission. WebSocket monitor
  đã có contract; unsupported aggregate `PUT /system/config` bị bỏ khỏi router; bảy operation
  Graph/OTA/log/BACnet authority-pending trả audited `501` sau authorization, không báo success giả.
- FE dùng cùng một permission map/type đã test để lọc navigation, guard direct route, chuyển
  form sang read-only và bỏ background query không được phép. FE guard chỉ phục vụ UX;
  backend vẫn phải trả `403` cho request vượt quyền.
- FE phải thay toàn bộ hardcode `role === 'admin'`/`RequireAdmin` tại `App.tsx`,
  `NavRail.tsx`, `NetworkPage.tsx` và cụm `PointLoggingControl.tsx`,
  `PointLoggingDialog.tsx`, `PointLoggingSection.tsx` bằng capability tương ứng. Chỉ module
  permission mapping và test fixture được phép so sánh role trực tiếp.
- JWT thêm claim `session_version`. `users.conf` persist `session_version` theo từng user;
  schema cũ migrate mặc định `1`. `Validate()` phải đối chiếu username, role và version với
  user map hiện hành trên mọi request. Đổi role, reset/đổi mật khẩu tăng version; xóa user
  làm token cũ trả `401` ngay. Blacklist token in-memory chỉ giữ cho logout từng token, không
  dùng thay cơ chế account-wide này.
- Không đọc `users.conf` từ disk trên mỗi request: `AuthService` giữ snapshot user hiện hành
  trong RAM dưới lock và load snapshot từ store bền vững khi khởi động. Mutation user tạo
  candidate có `session_version` mới, atomic-write + reload/validate thành công rồi mới swap
  snapshot; lỗi persist giữ nguyên snapshot/version cũ và mutation phải fail. `Validate()`
  verify JWT rồi lookup username/role/version trong snapshot này; restart reload đúng version
  đã persist nên token stale không sống lại.
- `SetRole` và `DeleteUser` phải dùng cùng lock + persistence boundary. Khi target hiện là
  Admin và candidate role không còn là Admin, `SetRole` kiểm `countAdmins > 1` trước mutation;
  nếu không thì trả `ErrLastAdmin` và handler map `409`. Hai request demote/delete cạnh tranh
  không được cùng pass; nhiều nhất một mutation làm giảm số Admin có thể commit.
- Denial ở endpoint nhạy cảm phải fail-closed trước handler/side effect và ghi audit tối thiểu
  actor, role, permission, action, target, result, timestamp; không log password/token.

#### 1.1.2 Endpoint/capability map bắt buộc

| Capability | Endpoint/surface target | Role được phép |
|---|---|---|
| `read` | `GET /system/status`, `/network`, `/points*`, `/alarms*`, `/alarm-history`, `/history*`, `/trends/config`, `/schedules`, `/alarm-settings`, `/system/time/status`, `/me` | viewer+ |
| `self.manage` | `POST /me/change-password`; Display/language lưu cục bộ | viewer+; chỉ chính mình |
| `operate` | `PUT /points/{id}`; `POST /commissioning/points/{id}/test`; alarm `ack|suppress|return` | operator+ |
| `program.edit` | Project/source/draft/revision edit, validate và build của Program Runtime | operator+ |
| `program.activate` | Deploy/activate/rollback Program Runtime; HTTP handler và service boundary đều kiểm permission | engineer+ |
| `settings.manage` | `GET/PUT /system/config*`, `PUT /network`, `GET/POST /network/transaction*`, `PUT /points/{id}/config`, virtual-point CRUD, `PUT /schedules`, `PUT /alarm-settings` | engineer+ |
| `database.manage` | **`PUT /trends/config`**; mọi database maintenance/backup/prune mutation API tương lai | admin only |
| `users.manage` | **Toàn bộ `GET/POST/PUT/DELETE /users*`**, kể cả list/reset-password | admin only |
| `system.release` | OTA và download log hệ thống | engineer+ |

`GET /network` và `GET /system/time/status` là operational status nên viewer+; việc FE ẩn
Settings device với viewer/operator không biến các status read này thành mutation. Ngược
lại, `GET /network/transaction` và `GET /system/config*` thuộc surface cấu hình nên
`engineer+`. Không được gộp `PUT /trends/config` vào `settings.manage`.

#### 1.1.3 Work package và thứ tự triển khai

| ID | Phạm vi | Output / gate |
|---|---|---|
| RBAC-DOC-001 | **DONE 2026-07-27** — reconcile baseline/API trước code | Đã cập nhật decision, requirements, detailed specs, OpenAPI v1.10.0 (mọi role enum + `x-rbac`), interfaces, verification và traceability; đã tạo gate `WEB-RBAC-001` riêng. |
| RBAC-BE-001 | **DONE 2026-07-27** — Role + permission engine | Đã thêm `RoleEngineer`, capability map, `RequirePermission` và deny-by-default; Web route không còn phụ thuộc `Require(Role)`/`RoleAllows`/`roleRank`; unknown role/permission fail-closed và denial được audit không lộ token. Inventory hiện hành được khóa exact 61 protected operation tại `RBAC-BE-003`. |
| RBAC-BE-002 | **DONE 2026-07-27** — User/session safety | Đã migrate/persist schema 2.0 `session_version`, dùng durable-before-publish snapshot, invalidate token khi role/password/delete đổi và qua restart; atomic last-admin/self-delete guard trả `409`, kể cả concurrent demote/delete; persist failure không publish candidate. |
| RBAC-BE-003 | **DONE 2026-07-27** — Endpoint mapping | OpenAPI v1.11.0 và backend khớp exact 61 protected operation; WebSocket monitor được contract hóa, aggregate config PUT unsupported bị bỏ, bảy Graph/OTA/log/BACnet route authority-pending được capability-gate và trả audited `501`; `PUT /trends/config` cùng `/users*` vẫn exact-admin. |
| RBAC-FE-001 | **DONE 2026-07-27** — Navigation/route/action/query | Đã mở rộng `UserRole`, tạo permission map deny-by-default + `can(...)`/`RequirePermission`, bỏ hardcode Admin khỏi App/NavRail/Network/PointLogging; route Settings/config, runtime action, Program edit/activate, historian mutation và background query dùng capability tương ứng. |
| RBAC-FE-002 | **DONE 2026-07-27** — Users surface | Đã thay demo bằng `GET/POST/PUT/DELETE /users*` thật; page/list/action chỉ `users.manage`, Engineer/Operator/Viewer không tạo request nền, xử lý `401/403/409`, chỉ render `username/role` và không persist/render password/hash/session version. |
| RBAC-TEST-001 | **DONE code-local 2026-07-27** — Security matrix | Exact 61 protected route × bốn role kiểm `401/403` và positive authorization; browser/API E2E dùng backend + FE live/JWT thật với bốn account cô lập; direct URL/API, hidden query, Users CRUD, database boundary và stale JWT đều pass. Source guard cấm role/rank hardcode; session/persist/restart/concurrency/audit regressions tiếp tục pass. |
| RBAC-ROLLOUT-001 | **READY / target execution pending** — Migration/deploy | Đã có CLI migration/rollback, offline `rbac-smoke-users-provision`/`cleanup`, credential-safe `rbac-target-smoke` và CI gate. Provision chỉ nhận canonical schema 2.0 khi service đã dừng, tạo credential/receipt mới bằng `O_EXCL` + fsync + mode 0600; cleanup xác minh exact role/bcrypt/session ownership và SHA account gốc trước khi xóa, fail-closed nếu store thay đổi. Full smoke còn tự tạo/đổi role/xóa một account random để kiểm stale JWT. Local ARM64 candidate mang `vcs.modified=true` chỉ là preflight; workflow bắt buộc clean revision trước khi upload artifact. Read-only preflight xác nhận target còn schema 1.0/một Admin; chưa mutate target. Phải theo runbook §1.1.5, lưu evidence và không bật FE mới trước backend/OpenAPI tương thích. |
| WEB-FEATURE-AUTH-001 | **RED / separate feature gate** — Business authority | BACnet objects, Graph validate/deploy, OTA upload/apply/status và log download vẫn trả audited `501` cho role đủ capability. `WEB-RBAC-001` chỉ yêu cầu exact permission mapping, `401/403` fail-closed và không side effect trước authorization; feature gate này yêu cầu service/business implementation cùng functional/safety tests riêng trước khi claim các chức năng đó available. |

Thứ tự bắt buộc: `DOC-001 ✅ → BE-001/002 ✅ → BE-003 ✅ → FE-001/002 ✅ → TEST-001 ✅ → ROLLOUT-001 (target pending)`.
Không release từng nửa trước khi FE, backend/OpenAPI route set và deployment cùng tương thích.

#### 1.1.4 Definition of Done

- Mọi endpoint trong router và OpenAPI có permission owner rõ; không còn endpoint mutation
  chỉ dựa vào việc ẩn button hoặc route FE.
- Ma trận positive/negative pass cho cả bốn role; `401` dành cho session không hợp lệ và
  `403` dành cho session hợp lệ nhưng thiếu permission.
- Operator vẫn vận hành/commission/alarm được nhưng không gọi Settings, Database mutation
  hoặc Program activation; `PUT /schedules`, `PUT /alarm-settings` và virtual-point CRUD
  luôn `403` cho operator. Engineer gọi được Settings/activation nhưng `/users*` và
  `PUT /trends/config` luôn `403`; viewer không tạo device mutation.
- Last admin tự hạ xuống engineer/operator/viewer trả `409`; đổi role, reset/đổi mật khẩu
  hoặc xóa user làm token cũ trả `401` ngay trong test bằng persisted `session_version`.
- Concurrent demote/delete không thể làm số Admin về 0; persist failure không publish role,
  password hoặc version candidate; restart không làm token stale hợp lệ trở lại. `Validate()`
  dùng user snapshot trong RAM, không đọc file trên request path.
- FE không render action bị cấm, direct URL redirect về surface hợp lệ và không poll endpoint
  bị cấm; engineer không phát `GET /users`, và scan không còn hardcode admin ngoài permission
  map/test fixture. Kiểm tra cả demo/mock/live auth mode.
- `WEB-RBAC-001` bao phủ Web 4 role và không thay đổi semantics Viewer/Operator/Service của
  local HMI; Program activation bị guard ở cả HTTP handler và service boundary.
- Bảy route authority-pending phải giữ đúng permission, `401/403` trước handler và audited `501`
  không lộ payload khi business authority chưa có. Việc biến `501` thành functional success thuộc
  `WEB-FEATURE-AUTH-001`, không phải điều kiện chứng minh cơ chế phân quyền.
- Test Go, frontend unit/integration, lint, typecheck/build, OpenAPI parse/assertion và
  `git diff --check` pass; cập nhật `CHANGELOG.md` trong cùng work session.
- Backend deployment candidate phải là `linux/arm64`, `CGO_ENABLED=0`, có SHA-256 và
  `go version -m` khớp exact approved revision với `vcs.modified=false`; local dirty-tree
  artifact chỉ dùng preflight, không dùng làm release binary.

#### 1.1.5 Runbook rollout/rollback bắt buộc

Không chạy migration đồng thời với `mkddc-web`: service phải dừng để loại bỏ race ghi `users.conf`.
Đặt backup trên cùng storage được kiểm soát, tên duy nhất và không có sẵn; CLI từ chối symlink,
file không-regular, schema lạ, bcrypt hỏng, mất Admin hoặc backup đã tồn tại.

Target đã định danh dùng `mkddc-web-pi.service`; image khác phải xác nhận đúng unit trước khi thay thế.
Không dùng password mặc định hoặc đoán password Admin hiện hữu. Binary candidate tự tạo bốn account
smoke có ownership receipt trong maintenance window, sau đó xóa chúng khi service dừng.

```bash
WEB_UNIT=mkddc-web-pi.service
sudo systemctl stop "$WEB_UNIT"
sudo /opt/mkddc-web/mkddc-web rbac-users-migrate \
  --users /data/config/users.conf \
  --backup /data/config/users.conf.pre-rbac-YYYYMMDD-HHMMSS
sudo install -d -m 0700 /run/credentials
sudo /opt/mkddc-web/mkddc-web rbac-smoke-users-provision \
  --users /data/config/users.conf \
  --credentials /run/credentials/mkddc-rbac-smoke.json \
  --state /run/credentials/mkddc-rbac-smoke-state.json \
  --confirm PROVISION-RBAC-SMOKE-USERS
sudo systemctl start "$WEB_UNIT"
```

Output migration/provision JSON chỉ có action/path/schema hoặc user count, không chứa username, hash hoặc password.
Provision từ chối schema 1.0/non-canonical, presence file còn tồn tại, artifact đã có, symlink/file không-private và
khôi phục exact store gốc nếu publish/verify lỗi. Receipt 0600 giữ SHA account gốc và exact hash/session của bốn
account do tool sở hữu; không đọc hoặc in hai file private vào terminal/evidence.

Chạy smoke từ target qua loopback; cleartext HTTP chỉ được opt-in cho đường loopback đã xác nhận. Full mode yêu cầu
exact confirmation vì nó tạo một account tên random, đổi Viewer→Operator để kiểm token cũ `401`, re-login rồi xóa
account đó. Success evidence không xuất username/password/JWT và tool thử cleanup account tạm khi fail:

```bash
sudo /opt/mkddc-web/mkddc-web rbac-target-smoke \
  --base-url http://127.0.0.1:8081 \
  --allow-http \
  --credentials /run/credentials/mkddc-rbac-smoke.json \
  --full \
  --confirm CREATE-CHANGE-DELETE-TEMP-USER \
  > /var/log/mkddc/rbac-target-smoke.json
```

Chỉ tiếp tục nếu JSON có `passed:true`, mode `full`, mọi check đúng status và Users không còn account tạm do full
smoke tạo. Nếu create/cleanup có kết quả không xác định, error chỉ in tên account tạm random (không in account
thật, password hoặc JWT) để operator kiểm tra/xóa đúng account đó trước khi quyết định rollout.
Chỉ sau smoke pass mới bật/deploy FE mới và chạy UI/API smoke. Sau đó dừng service, xóa bốn controlled account,
verify exact account store gốc và khởi động lại:

```bash
sudo systemctl stop "$WEB_UNIT"
sudo /opt/mkddc-web/mkddc-web rbac-smoke-users-cleanup \
  --users /data/config/users.conf \
  --credentials /run/credentials/mkddc-rbac-smoke.json \
  --state /run/credentials/mkddc-rbac-smoke-state.json \
  --confirm REMOVE-RBAC-SMOKE-USERS
sudo systemctl start "$WEB_UNIT"
```

Cleanup kiểm đồng thời username/role/exact bcrypt hash/password ownership/session version và SHA toàn bộ account gốc
trước khi ghi. Nếu có account thật hoặc controlled account thay đổi, lệnh từ chối trước mọi delete; không được ép
rollback file nếu chưa xác định thay đổi hợp lệ phát sinh trong maintenance window.

Nếu smoke fail, dừng service rồi rollback đúng backup đã ghi trong evidence:

```bash
WEB_UNIT=mkddc-web-pi.service
sudo systemctl stop "$WEB_UNIT"
sudo /opt/mkddc-web/mkddc-web rbac-users-rollback \
  --users /data/config/users.conf \
  --backup /data/config/users.conf.pre-rbac-YYYYMMDD-HHMMSS
sudo systemctl start "$WEB_UNIT"
```

Rollback khôi phục byte-for-byte file pre-migration và verify lại account/schema trước khi báo thành công.
Release record phải lưu commit/binary hash, target, thời gian, backup path/quyền file, output JSON đã redact,
bốn smoke result và reviewer approval. Không xóa backup trước khi hết rollback window được phê duyệt.
Read-only target baseline hiện hành nằm tại
[`WEB_RBAC_TARGET_PREFLIGHT_2026-07-27.md`](../00_management/evidence/WEB_RBAC_TARGET_PREFLIGHT_2026-07-27.md).
Local ARM64 packaging preflight và checksum/build metadata nằm tại
[`WEB_RBAC_ARM64_CANDIDATE_2026-07-27.md`](../00_management/evidence/WEB_RBAC_ARM64_CANDIDATE_2026-07-27.md).
Native Linux race result nằm tại
[`WEB_RBAC_LINUX_RACE_2026-07-27.md`](../00_management/evidence/WEB_RBAC_LINUX_RACE_2026-07-27.md).

### 1.2 Priority: web map vào đâu (CHỐT — khớp core 6 mức, PRODUCT_DEFINITION §13)

```
- Web/commissioning command  → nguồn "Local manual"  = mức 2. Client KHÔNG chọn priority.
- BACnet write               → priority array BACnet 1..16 (kx_plc_shm), resolve riêng,
                               kết quả vào core ở mức 3. REST không expose 1..16.
- release=true               → nhả manual (relinquish mức 2); core rơi về nguồn kế.
- Response của core {result, applied_value, active_source} → ghi audit + hiển thị
  "Lệnh bị ghi đè bởi <nguồn>" nếu overridden.
```

```
src/frontend/ (React 18 + TS + Vite + Tailwind v4) — app thực tế Rev A, IA theo ADR-009
├── Login `/login` — auth mock/JWT, lưu token in-memory
├── Overview
│   ├── Dashboard `/` — KPI, health services + IOP/scan metrics, trạng thái truyền thông, I/O, sự kiện, trend
│   ├── Monitoring `/monitor` — bảng 24 IO realtime + chi tiết point + DO toggle (commissioning)
│   ├── Alarm log `/alarms` — list + ack
│   ├── Trends `/trends` — object-list + time-range 30m/1h/6h/24h; chart dùng đủ samples + bảng 5 timestamp gần nhất
│   └── User info `/me` — danh tính, role/permission, session demo, đổi mật khẩu demo, đăng xuất
├── Settings
│   ├── Display `/settings/display` — ngôn ngữ vi/en, ghi chú theme ISA-101 Level A, mật độ hiển thị demo
│   ├── Users `/settings/users` — danh sách tài khoản + role
│   ├── Network `/settings/network` — Northbound BACnet/IP + Southbound Modbus RTU master
│   ├── Time/Date `/settings/time` — NTP, server, timezone, đặt giờ thủ công demo
│   └── Device `/settings/device` — tên thiết bị, vị trí, chu kỳ update/scan, About
├── Engineering
│   ├── Scheduler `/eng/scheduler` — BACnet Weekly_Schedule demo
│   ├── Commissioning `/eng/commissioning` — test DO/AO thật (operator+)
│   ├── Programming `/eng/programming` — legacy graph local simulation; hidden unless demo mode + explicit feature flag
│   └── Alarm settings `/eng/alarm-settings` — bảng ngưỡng HH/H/L/LL, delay, priority, enable
├── Redirect tương thích: `/users`, `/network`, `/settings`, `/scheduler`, `/commissioning`, `/validator`
└── `/health` — đã gộp vào Dashboard, không còn route riêng

web/validator/    — Go library (KHÔNG service): kiểm graph.json trước deploy
web/storage/      — schema SQLite, migration
```

> **Trạng thái Rev A (demo UI): ĐÃ làm 2026-06-16** — 4 trang Trends/Scheduler/Network/Validator
> đã chỉnh khớp spec ở mức **demo UI client-side** (dữ liệu qua simulator, **chưa** nối backend):
> Trends bám mô hình BACnet Trend Log do kỹ sư cấu hình object-list (SRS IDE-024/025);
> Scheduler theo BACnet Weekly_Schedule tuần-lặp, bỏ chế độ "Tháng" (PRD FR-004); Network theo
> ARCH-R010 (north BACnet/IP, south Modbus RTU master), bỏ mô hình cây controller; Validator chạy
> đúng 4 check §5 trên `graph.json` (component graph legacy — không phải IEC 61131-3
> Program Runtime; roadmap ST+FBD riêng theo ADR-020, đang C0, xem
> `KX-DDC24-PROGRAM-RUNTIME-IMPLEMENTATION-PLAN-C1-C10.md`). **KHÔNG** thêm/đổi
> endpoint REST hay WebSocket contract — hợp đồng §2 giữ nguyên.

---

## 1.3 ISA-101 Level A P1/3 — frontend theme/status (Approved 2026-06-16)

Nguồn-chuẩn: ADR-009 + UX-SYSTEM §1/§2/§6/§7/§8. P1 chỉ áp design tokens Level A nền xám sáng và logic màu trạng thái trong `src/frontend`; KHÔNG đổi routing, NavRail IA 3 nhóm, trang mới, REST API hay WebSocket contract.

Scope code P1:
- `styles.css`: giữ tên biến `--c-*`, đổi value sang Level A nền `#C8CCD0`, bỏ dark/cyan glow, `color-scheme: light`.
- `utils.statusColor()` giữ normal/good/ok/online/live/connected trung tính cho text/border/surface; `statusIndicatorColor()` dùng riêng cho chấm/icon nhỏ: OK/ONLINE/ON = xanh lá, OFF/OFFLINE/unknown = xám. Warn/degraded = vàng; fault = đỏ; force = tím; critical/safety = magenta. Mọi badge có icon + chữ.
- Form/input/select/textarea và chart grid/tooltip phải đọc tốt trên nền sáng.

Trạng thái: ĐÃ làm 2026-06-16 — P1 áp token ISA-101 Level A vào frontend theme/status; typecheck/build là verification bắt buộc.

---

## 1.4 ISA-101 P2/3 — grouped navigation/routing (Approved 2026-06-16)

Nguồn-chuẩn: ADR-009 Decision #2 + UX-SYSTEM §6. P2 gom NavRail thành 3 nhóm Overview/Settings/Engineering, thêm route mới và redirect path cũ để không vỡ bookmark. P2 KHÔNG đổi REST API, WebSocket contract, design tokens, nội dung thật của trang stub, hoặc việc gộp `/health` vào Dashboard.

Redirect giữ tương thích:
`/users` → `/settings/users`; `/network` → `/settings/network`; `/settings` → `/settings/device`; `/scheduler` → `/eng/scheduler`; `/commissioning` → `/eng/commissioning`; `/validator` → `/eng/programming`.

Trạng thái: ĐÃ làm 2026-06-16 — NavRail 3 nhóm thu gọn được + routing mới P2; typecheck là verification bắt buộc.

## 1.5 ISA-101 P3/3 — real pages + health fold + Programming (Approved 2026-06-16)

Nguồn-chuẩn: ADR-009 Decision #5/#6/#7 + UX-SYSTEM. P3 thay toàn bộ stub P2 bằng trang demo thật, gộp System Health vào Dashboard, đổi Validator thành Programming và giữ nguyên REST API/WebSocket contract.

Scope code P3:
- `/me`, `/settings/display`, `/settings/time`, `/eng/alarm-settings` là trang thật demo client-side; không còn stub route trong cây ADR-009.
- `/settings/device` nâng thành form Device thật; Language chuyển sang Display, Date/Time chuyển sang Time/Date.
- `/eng/programming` dùng `ProgrammingPage` chỉ trong demo mode khi
  `VITE_ENABLE_LEGACY_GRAPH_DEMO=1`: thư viện component legacy, chèn node skeleton vào
  `graph.json` và validate/simulate cục bộ bằng `validateGraphLocal()`. Live/production
  route và navigation không expose trang này; không có nhãn Deploy tới thiết bị.
- Dashboard hiển thị thêm Services + IOP/scan metrics; `/health` không còn route riêng.
- Dọn nền tối còn sót, dùng token Level A `--c-*`; không hardcode nền navy/dark.

Trạng thái: ĐÃ làm 2026-06-16 — hoàn tất tái cấu trúc ISA-101 P3/3 cho frontend demo Rev A; typecheck là verification bắt buộc.
## 1.6 Owner adjustment — compact status indicator dots (2026-06-16)

Nguồn-chuẩn: owner feedback 2026-06-16 + ADR-009 adjustment. Chỉ áp cho chấm/icon nhỏ dùng làm binary indicator trong dashboard/monitor/badge; không đổi REST/WS contract.

Quy ước:
- OK/ONLINE/ON/GOOD indicator dot/icon = xanh lá `--c-indicator-ok`.
- OFF/OFFLINE/unknown indicator dot/icon = xám `--c-indicator-off`.
- Fault/alarm vẫn đỏ, warn vẫn vàng, force vẫn tím; màn hình nhị phân thô (kể cả DI-01) hiển thị ON xanh, OFF xám; alarm/fault riêng mới dùng đỏ.
- Surface/card/border/text trạng thái bình thường vẫn trung tính; màu indicator không được là nghĩa duy nhất, luôn kèm chữ/icon.

Trạng thái: ĐÃ làm 2026-06-16 — cập nhật indicator dot/icon theo feedback owner; typecheck là verification bắt buộc.
## 1.7 Owner adjustment — dashboard dynamic metrics (2026-06-16)

Nguồn-chuẩn: owner feedback 2026-06-16 + ADR-009 adjustment. Áp cho trạng thái chữ/icon/chấm và mọi giá trị biến thiên trên Dashboard; không đổi REST/WS contract.

Quy ước:
- OK/ONLINE/ON/GOOD, uptime và giá trị trong ngưỡng bình thường = xanh lá `--c-good`/`--c-indicator-ok`.
- OFF/OFFLINE/unknown = xám `--c-indicator-off` khi không phải fault.
- CPU/RAM dùng ngưỡng 70% warn, 90% fault; temperature dùng 50°C warn, 65°C fault; scan time dùng 50 ms warn, 100 ms fault.
- Warning/degraded = vàng/cam; fault/alarm/critical = đỏ/magenta. Surface/card/background vẫn Level A xám sáng.

Trạng thái: ĐÃ làm 2026-06-16 — Dashboard cards, services, IOP/scan metrics và StatusBadge dùng màu theo ngưỡng ISA-101 owner adjustment; typecheck là verification bắt buộc.
## 1.8 Sticky shell chrome — top status bar + NavRail (Approved 2026-06-16)

Nguồn-chuẩn: owner feedback 2026-06-16 + UX-SYSTEM Level A. Web shell phải giữ vùng điều khiển chính luôn nhìn thấy khi người dùng cuộn nội dung trang; không đổi REST API/WebSocket contract.

Quy ước:
- `TopBar` sticky ở đỉnh content pane, nền `--c-surface`, z-index đủ cao để không bị card/chart đè.
- Banner reconnect sticky ngay dưới `TopBar` (`top-16`) để trạng thái mất kết nối không biến mất khi cuộn.
- `NavRail` sticky `top-0`, cao `100vh`; danh sách trong rail tự cuộn khi dài, logo/nhóm điều hướng vẫn cố định.
- Không dùng glow/overlay tối; trạng thái active giữ dấu hiệu trung tính theo ADR-009.

Trạng thái: ĐÃ làm 2026-06-16 — cố định top status bar/reconnect banner/NavRail khi cuộn; typecheck là verification bắt buộc.
## 1.9 Frontend i18n — VI dấu + English mode (Approved 2026-06-17)

Nguồn-chuẩn: owner feedback 2026-06-17 + Display `/settings/display` chọn ngôn ngữ `vi/en`. UI frontend phải hiển thị tiếng Việt có dấu đầy đủ ở mode VI và đổi được các nhãn/nút/toast chính sang tiếng Anh ở mode EN; không đổi REST API/WebSocket contract.

Quy ước:
- Không dùng chuỗi tiếng Việt không dấu trong UI người dùng thấy (`Binh thuong`, `Da luu`, `Mat khau`... phải sửa thành có dấu).
- `src/frontend/src/i18n.tsx` cung cấp helper chọn copy VI/EN; page/component dùng helper này cho tiêu đề, mô tả, nút, filter, placeholder, toast và trạng thái chính.
- Dữ liệu mô phỏng như `point.name`, `alarm.message`, serial/model/IP được giữ nguyên theo simulator; i18n chỉ áp lên chrome/label/nội dung UI.

Trạng thái: ĐÃ làm 2026-06-17 — chuẩn hóa tiếng Việt có dấu và English mode cho frontend demo; typecheck là verification bắt buộc.

## 1.10 Web dependency security refresh (Approved 2026-06-23)

Nguồn-chuẩn: SEC-PROC CVE gate (High/Critical block merge), security scan PR findings for GHSA-fx2h-pf6j-xcff / Vite <= 6.4.2 and Go module high/critical findings in `golang.org/x/crypto`. Scope is dependency/toolchain only; REST API, WebSocket contract, route tree, UI behavior, and runtime authorization are unchanged.

Scope code:
- Upgrade frontend dev toolchain to `vite@8.0.16` and `@vitejs/plugin-react@6.0.2`.
- Update `vite.config.ts` chunk split config to function-form `manualChunks` compatible with Vite 8/Rolldown typing.
- CI frontend build uses Node.js 22 to satisfy Vite 8 engine requirements.
- Upgrade backend Go security modules to `golang.org/x/crypto v0.53.0` and `golang.org/x/sys v0.46.0`; Go module directive becomes `go 1.25.0` with existing `toolchain go1.26.4`.

Trạng thái: ĐÃ làm 2026-06-23 — npm audit High gate is clean; `npm run build`, `npm run lint`, backend `go test ./...`, `govulncheck ./...`, and local Grype clean archive scan pass. No REST/WS contract change.

## 1.11 Owner adjustment — Trends filters and latest-five table (Approved 2026-07-15)

Nguồn-chuẩn: owner feedback 2026-07-15 và clarification 2026-07-22. `Add trend` mở modal có tìm theo ID/tên và lọc loại `UI/AO/DO/VP`; Apply/Cancel giữ selection rõ ràng. `Auto` và các preset 30 phút/1 giờ/6 giờ/24 giờ gửi `source=cache` và chỉ đọc RAM presentation cache 24 giờ; `Custom` gửi `source=database` và chỉ đọc hot SQLite/archive. Frontend dùng explicit UTC `[from,to)`, generation-aware series, gap/partial metadata, boolean stepped lines và không merge tier. Live build mặc định dùng v2 sau activation; `VITE_HISTORIAN_V2_TRENDS=0` chỉ là explicit rollback switch, demo vẫn dùng generated legacy data. Bảng timestamp dưới chart chỉ render 5 mốc mới nhất theo thứ tự thời gian. Không render VP diagnostic logging như database policy.

Trạng thái: ĐÃ làm 2026-07-15 — khôi phục Add Trend modal + tìm ID/tên + lọc UI/AO/DO/VP + custom From/To; bảng timestamp giữ 5 mốc mới nhất, chart giữ toàn bộ data. Focused lint/test và Vite build pass; current frontend npm test/lint/typecheck/Vite build pass. Do not claim repository-wide typecheck or E2E.

## 1.12 Global technical point tags — Phase A (Approved 2026-07-15)

Nguồn-chuẩn: ADR-019 Accepted + Plan 43 Approved + CONFIG_SCHEMA Rev 1.8 + OpenAPI 1.5.0. Scope Phase A: technical `tag` bắt buộc và unique theo normalized lowercase key trên UI/AO/DO/mọi VP kể cả disabled; tag tách `name`/`label`; canonical ID vẫn là runtime identity.

Backend phải validate final candidate namespace dưới một serialization boundary chung cho IO PUT, VP create/update/full replace/delete và `PUT /points/{id}/config`; malformed/reserved sai owner trả 400, duplicate trả 409 kèm structured field details. Point/list response trả `id + tag + name`. Legacy migration deterministic, không suffix/first-wins. Flat-file authority chỉ bao phủ API writers; generation root validation vẫn là release gate.

Frontend Inputs/Outputs/Virtual Points/Monitor phải edit tag riêng, preserve backend `details`, focus field lỗi đầu tiên và không fallback localStorage cho authoritative live rename. Phase B Programming alias không nằm trong completion claim Phase A.

Trạng thái: ĐÃ làm 2026-07-15 — API-writer scope đã có global namespace validation, `id+tag+name`, deterministic migration helper, Inputs/Outputs/VP/Monitor tag editor và structured field errors; Go test/vet + FE test/lint/typecheck/build pass. Local evidence: backend coverage 59.7%; OpenAPI 1.6.0 parses with 41 paths, 216 local refs, zero decoded C1 controls. Release gates còn mở: race bị Windows CGO 64-bit compiler chặn; E2E/manual và generation-root authority chưa đóng.

## 1.13 Owner amendment — unique display names + shared database Logging Control (Approved 2026-07-15)

Nguồn-chuẩn: ADR-018 v1.2, ADR-019 v1.1, CONFIG_SCHEMA Rev 2.1, OpenAPI 1.7.0, Plans 42/43.

- Scope: UI-01..16, AO-01..04, DO-01..04 và mọi created numeric/boolean VP; optional DI ngoài scope.
- Backend quản lý hai namespace độc lập: technical `tagKey` và display `nameKey`. `name/label` required sau migration, trim/collapse whitespace, 1..64 Unicode code point, cấm control, compare Unicode lowercase. Name có thể giống tag.
- Legacy blank name trở thành canonical ID. Content-duplicate name giữ nguyên/readable, nhưng mọi point mutation ngoài conflict-reducing rename trả `409 point_namespace_conflicted`; không auto-suffix, không fail runtime.
- `GET/PUT /api/v1/trends/config` thay legacy global sampler bằng per-point policy revision. Admin chọn 11 interval và bắt đầu ngay bằng server time hoặc UTC tương lai; viewer/operator chỉ xem `off|scheduled|recording`.
- Admin chọn `retentionDays` từ 1 tới maximum theo interval (`1s=30d`, `15s=180d` và bảng đầy đủ từ backend); viewer/operator thấy selection nhưng không sửa. Fine `1s|3s|5s` chỉ raw trong RAM tail, archive dài hạn là aggregate 15 giây.
- Shared `PointLoggingControl` + one two-step `PointLoggingDialog` dùng trên Inputs/Outputs/Virtual Points. VP `logEnabled/logIntervalMs` phải được ghi nhãn Diagnostic log, không phải DB policy.
- Policy sống qua restart, ghi tới khi tắt; disable/rename/delete không xóa history. Canonical ID+generation giữ identity; recreate VP tăng generation.
- Trends bỏ browser historian buffer và frontend tier merge. Backend merge RAM/hot 48h/archive, trả quality/source/tier/gap; boolean dùng stepped line, missing/BAD ngắt line.
- Implementation status: `WEB-HIST-001..005` code/local and bounded board schema-v5 migration/activation are GREEN. Final ARM64 current/rollback parity, 596,284-row migration evidence, explicit maintenance/restart gaps and live unified query smoke are recorded. Source-routed cache/database Trends is code-local GREEN; its board rollout and soak remain pending. Prune remains disabled. Physical power-cut, target eMMC/endurance, 48-hour boundary, browser/manual E2E, long soak and legacy removal remain open.
- Accessibility: text badge không chỉ màu, modal focus trap/Escape/restore trigger, field error `role=alert`, backend past-time/conflict error giữ dialog mở và focus đúng field.

Trạng thái: DONE code/local 2026-07-21 cho WEB-HIST-005 + retention + physical prune + activation transaction engine; production execution/cutover, target benchmark, browser/manual accessibility và E2E vẫn open.

## 2. API list (tối thiểu — khớp REST_API_OPENAPI)

| Method | Endpoint | Auth | Đi tới | Mô tả |
|--------|----------|------|--------|-------|
| POST | `/api/v1/auth/login` | none | — | Login, trả JWT + role (`viewer|operator|engineer|admin`) |
| GET | `/api/v1/points` | Bearer | core (read) | Danh sách 24 IO |
| GET | `/api/v1/points/{id}` | Bearer | core (read) | 1 point `{id,tag,name,value,quality,...}` bằng canonical ID |
| PUT | `/api/v1/points/{id}` | Bearer operator+ | core (command) | Ghi giá trị → nguồn manual mức 2 (§1.2); body {value} hoặc {release:true} |
| PUT | `/api/v1/points/{id}/config` | Bearer engineer+ | config metadata | Đổi technical tag/display name bằng canonical ID; validate cả hai global namespaces |
| GET/PUT | `/api/v1/trends/config` | Bearer viewer+/admin-only | historian policy | Viewer+ đọc state/capacity/server time/retention maxima; chỉ Admin atomic-update interval + retention + immediate/future UTC start |
| GET | `/api/v1/history` | Bearer viewer+ | historian query | Explicit UTC range; backend merge RAM/hot 48h/archive và trả gaps |
| GET | `/api/v1/system/status` | Bearer | core/iobus metrics | CPU/RAM/IOP |
| GET | `/api/v1/system/config` | Bearer engineer+ | store | Đọc aggregate config; không hỗ trợ aggregate PUT |
| GET/PUT | `/api/v1/system/config/{group}` | Bearer engineer+ | store + core reload | Đọc/cập nhật từng nhóm cấu hình được công bố |
| GET | `/api/v1/network/transaction` | Bearer engineer+ | `mkddc-netcfg` status | Active/configured/pending, capability và management hostname read-only |
| POST | `/api/v1/network/transaction/{action}` | Bearer engineer+ | `mkddc-netcfg` mutation | Validate/stage/apply/confirm/rollback IPv4 + optional DNS |
| GET | `/api/v1/alarms` | Bearer | eventlog/alarm bus | Alarm active |
| POST | `/api/v1/alarms/{id}/ack` | Bearer operator+ | eventlog | Ack alarm |
| POST | `/api/v1/commissioning/points/{id}/test` | Bearer operator+ | core (manual mức 2) | Test DO/AO thật |
| POST | `/api/v1/graph/validate` | Bearer operator+ | validator lib | Kiểm graph.json |
| POST | `/api/v1/graph/deploy` | Bearer engineer+ | validator+core | RBAC mapped; authority chưa triển khai nên caller đủ quyền hiện nhận audited `501` |

---

## 3. Data model (Point response — SW_ARCH §6.2)

```json
{
  "id": "UI1", "type": "AI", "value": 23.5, "unit": "°C",
  "quality": "good", "timestamp": "2026-06-10T10:00:00.123Z",
  "sensor_type": "NTC10k", "fault": false
}
```
System status (versions tách từng thành phần — Contract Freeze; nguồn metrics ghi rõ):
```json
{ "cpu_percent": 12.5, "ram_percent": 35.2, "uptime_s": 86400,
  "versions": { "mcu_fw": "1.0", "iobus": "1.2.0", "core": "1.1.0", "web": "1.0.0" },
  "iop":  { "status": "normal", "crc_errors": 0, "timeouts": 0, "seq_errors": 0,
            "last_io_resp_ms": 12 },
  "scan": { "count": 86400, "overrun": 0 } }
```
> Nguồn: `iop.*` + `versions.mcu_fw/iobus` từ `kx_io_shm` (iobus ghi); `scan.*` +
> `versions.core` từ `kx_plc_shm` (core ghi); web đọc read-only, KHÔNG tự đo lại.

---

## 4. Config model (CONFIG_SCHEMA)

| File | Nội dung |
|------|----------|
| `/data/config/io_config.conf` | sensor type per UI (0-10V/4-20mA/PT100/NTC10k/dry...), AO mode per kênh |
| `/data/config/io_safe_state.conf` | safe-state value per kênh |
| `/data/config/historian.conf` | per-point DB policy, 11 interval, start UTC, capacity và revision |
| `/data/config/network.conf` | BACnet/Wi-Fi/service hostname tương thích; `eth`/DNS chỉ là compatibility shadow read-only, không đổi management hostname |
| `/data/config/device.conf` | BACnet device ID/name |
| `/data/config/users.conf` | user accounts (bcrypt) |

> Web validate input theo schema trước khi ghi; config IO → core/iobus reload (qua signal/IPC).

`network.conf.eth` chỉ là compatibility shadow và REST `PUT /api/v1/network` cũ vẫn được giữ
cho tương thích BACnet/Wi-Fi/service config. Cả endpoint này và `PUT /api/v1/system/config/network` phải giữ
nguyên `eth`; endpoint config từ chối payload cố thay đổi Ethernet/DNS. Luồng lưu BACnet/Wi-Fi
không được sao chép IP/mode/gateway cũ sang authority hoặc đổi WiFi mode. FE không còn cho
sửa Ethernet IPv4 qua form legacy và phải xử lý `ConfigPutResult.applied=false`/warnings,
không báo thành công vô điều kiện.

Field `network.conf.hostname` không phải OS management hostname. Web chỉ hiển thị
`response.management.hostname/mdnsName/stable`; provisioning/đổi stable origin phải chạy
`packaging/configure-web-hostname.sh`, không được gọi từ Network API.

Web adapter authoritative:
- `GET /api/v1/network/transaction` dùng permission `read` và chuyển `status` tới
  `/run/mkddc-netcfg/netcfg.sock`; status read không ghi audit mutation.
- `POST /api/v1/network/transaction/{validate|stage|apply|confirm|rollback}` chỉ cho Admin;
  body tối đa 4 KiB, JSON strict, candidate/transactionId bắt buộc theo action; mỗi POST audit đúng một event.
- Candidate từ chối interface `lo`; DHCP cấm static fields; static chỉ chấp nhận prefix
  `/1..30`, usable unicast host và gateway usable cùng subnet, khác chính candidate IPv4.
- Candidate optional `dns:{mode,servers}`; thiếu DNS là preserve, `auto` chỉ với DHCP/list
  rỗng, `manual` là 1..4 IPv4 canonical duy nhất. Adapter status-preflight capability và fail closed
  nếu response validate/stage không echo đúng capability + pending DNS khi DNS mutation được yêu cầu.
- Response giữ nguyên `result`, `reasonCode`, `state`, `active`, `configured`, `pending`,
  `capabilities`, `management`,
  `rollbackRemainingS`; authority `rejected` không bị đổi thành trạng thái Web tự suy diễn.
- FE poll trạng thái authoritative mỗi giây, tách ACTIVE/KERNEL khỏi PENDING CANDIDATE,
  khóa transition không hợp lệ và hiển thị countdown Confirm/Rollback. Mọi action được audit
  theo user/action/transaction/result nhưng không ghi candidate, DNS hoặc credential.
- Route `/settings/network` và mutation controls chỉ bật cho Admin; GET status vẫn được backend
  cho session xác thực để consumer read-only dùng mà không tạo mutation.

---

## 5. Validator rule (PRODUCT_DEFINITION §14 — Rev A: 4 check cốt lõi)

```
Rev A (bắt buộc):
1. Output có nhiều nguồn ghi mà chưa qua priority → FAIL.
2. AO chưa có limit (min/max) → FAIL.
3. Sensor/IO lỗi chưa có safe-state fallback → FAIL.
4. Input component chưa nối (dangling) → FAIL.
(Đầy đủ: sai kiểu/unit, vòng lặp nguy hiểm, Modbus mất kết nối chưa fallback, graph quá scan
 budget → roadmap.)
Không pass → KHÔNG deploy.
```
**Module format:**
```
Mục tiêu : kiểm graph.json an toàn trước deploy.
Input    : graph.json (GRAPH_SCHEMA).
Output   : {pass: bool, errors: [...]}.
Test     : graph thiếu limit AO → validate FAIL, deploy bị chặn.
Done khi : 4 check chạy đúng; deploy chỉ khi pass.
```

---

## 6. Audit log

```
- Mọi PUT /points, commissioning test, config change, graph deploy → ghi audit:
  {ts, user, action, target, old, new, result, source_ip}.
- result phản ánh kết quả core (accepted / overridden-by-priority / rejected).
- Lưu eventlog.sqlite; không xoá được từ UI thường.
```

---

## 7. Quy tắc bắt buộc (KHÔNG vi phạm)

```
1. Web KHÔNG mở /dev/ttyS2 (không import serial, không gọi IOP).
2. Web KHÔNG gọi thẳng MCU.
3. Web gửi command cho core (qua core_client IPC), core quyết output.
4. Output command phải có audit log.
5. Lỗi hiển thị bằng ngôn ngữ dễ hiểu ("Mất kết nối MCU" thay vì "IOP_FAULT 0x05").
6. Validate mọi input mạng; TLS 1.3; không hardcode secret; JWT hết hạn.
```

---

## 8. Hiển thị lỗi (mapping kỹ thuật → người dùng)

| Kỹ thuật | Hiển thị web |
|----------|--------------|
| iop_status=FAULT | "Mất kết nối với bộ điều khiển IO (MCU)" |
| ui_quality=BAD | "Cảm biến lỗi / mất tín hiệu" |
| RELAY_STUCK | "Relay không phản hồi đúng lệnh" |
| overridden-by-priority | "Lệnh bị ghi đè bởi mức ưu tiên cao hơn (an toàn/fire)" |
| validator FAIL | liệt kê từng lỗi graph bằng tiếng Việt |
| point_name_conflict | "Tên đã được dùng bởi <pointId>"; giữ form mở và focus field tên |
| point_namespace_conflicted | "Cấu hình cũ còn tên trùng; hãy đổi một tên để giảm xung đột" |
| historian_start_in_past | "Thời gian bắt đầu phải từ hiện tại của thiết bị trở đi" |
| historian_storage_unavailable | "Không thể ghi lịch sử; dữ liệu live vẫn tiếp tục" |
| history complete=false | banner partial + khoảng gap; không nối đường giả |

---

## 9. Trace

| Chủ đề | Module | Test |
|--------|--------|------|
| Login/JWT | auth.go | group 5 |
| Point list/detail | points.go | group 5 |
| Commissioning test | commissioning.go | group 5 + group 6 |
| Validator | web/validator | group 5 |
| Không bypass core | core_client.go | group 6 (kiểm không có serial) |

---
**Rev** 1.48 | 2026-07-29 — Tích hợp Web RBAC bốn role với strict Network v1: giữ offline smoke-account lifecycle, exact 61-route mapping và feature-authority split; đồng thời giữ DNS preserve/auto/manual theo capability, management hostname chỉ đọc và Network transaction Engineer/Admin. Code-local gates pass; target/release gates còn mở. ·
**Rev** 1.47 | 2026-07-27 — Separated seven authorization-complete but business-authority-pending `501` routes into `WEB-FEATURE-AUTH-001`, so feature availability is not conflated with the `WEB-RBAC-001` authorization gate. Added offline four-role smoke-account provision/cleanup commands with stopped-service/schema-2.0/canonical preflight, cryptographic credentials, exclusive durable 0600 credential/receipt files, exact role/bcrypt/session ownership and original-store SHA verification, failure restoration, and provision→real-router full-smoke→cleanup exact-byte tests. Clean staged backend checks + native Linux race, FE 27-file/137-test and Playwright 5/5 passed; clean CI, target execution and independent approval remain open. ·
**Rev** 1.46 | 2026-07-27 — Closed the missing local native-Linux race evidence: the full backend suite passed `go test -race -count=1 ./...` on Ubuntu 24.04 WSL2 with Go 1.26.4 and GCC 13.3.0, with no race finding. The official Linux Go archive checksum, command and result are recorded; clean-checkout CI provenance, target rollout and independent approval remain open. ·
**Rev** 1.45 | 2026-07-27 — Added `rbac-target-smoke` for controlled four-role target evidence. The CLI loads credentials from strict JSON via a race-checked non-symlink 0600 file or stdin, disables HTTP proxy and redirects, and only permits explicitly opted-in cleartext HTTP on loopback. Successful evidence never emits usernames, passwords or JWTs; an ambiguous create/cleanup error identifies only the random temporary account for safe recovery. Full mode requires an exact mutation confirmation, changes a tool-owned Viewer to Operator to prove stale-token `401`, re-authenticates, deletes it and proves post-delete `401`, with cleanup on failure. Real-router full/read-only, unsafe invocation and credential-redaction tests pass. Target execution and approval remain open. ·
**Rev** 1.44 | 2026-07-27 — Cross-built and inspected the local Go backend candidate for `linux/arm64` with `CGO_ENABLED=0`, `-trimpath`, exact SHA-256 and dependency/VCS metadata. Recorded it as non-release-eligible because `vcs.modified=true`; added a clean-checkout CI job that requires the exact CI revision plus `vcs.modified=false`, verifies SHA-256 and uploads the candidate/checksum. No target mutation occurred; maintenance window, four controlled credentials, target migration/smoke/rollback evidence, seven feature authorities and independent approval remain open. ·
**Rev** 1.43 | 2026-07-27 — Closed code-local `RBAC-TEST-001`: added an exact 61-route × four-role direct API matrix, isolated live JWT/backend/frontend Playwright smoke for Viewer/Operator/Engineer/Admin, FE source hardcode guard, editable login identity, and unique JWT `jti` so logout cannot revoke an immediate independent login. Added fail-closed `users.conf` backup/migrate/rollback CLI with account/hash/session preservation and exact rollback tests, plus CI unit/lint/build/E2E and Linux race gates. Full Go test/vet/build/module verification, FE 27-file/146-test + lint/build/source guard, Playwright 5/5 and diff check pass locally. Target rollout, seven authority-pending features and independent approval remain open, so `WEB-RBAC-001` stays RED/Partial. ·
**Rev** 1.42 | 2026-07-27 — Closed code-local `RBAC-FE-001/002`: added the centralized four-role permission map and fail-closed `RequirePermission`; capability-gated navigation, direct routes, runtime/config/program/database actions and hidden polling; replaced the Users demo with the real admin-only API for list/create/role/reset/delete, explicit `401/403/409` handling and credential-safe rendering. Frontend unit/integration tests pass 145/145 across 26 files, with lint and production build passing. E2E four-account, feature authorities, rollout/target and approval remain open, so `WEB-RBAC-001` stays RED/Partial. ·
**Rev** 1.41 | 2026-07-27 — Closed code-local `RBAC-BE-003`: OpenAPI v1.11.0 and the Go router now match exactly at 61 protected operations plus public login. Contracted the implemented monitor WebSocket, removed unsupported aggregate config PUT, and capability-gated seven authority-pending Graph/OTA/log/BACnet routes so unauthorized callers receive `401/403` and authorized callers receive audited `501` without fake success or payload/token leakage. FE/E2E, feature authorities, rollout/target and approval remain open. ·
**Rev** 1.40 | 2026-07-27 — Closed code-local `RBAC-BE-001/002`: implemented four-role capability authorization for 55 protected backend routes, persisted account-wide `session_version`, durable-before-publish user mutation, stale-token and last-admin concurrency safety, denial audit/redaction, and Web/local-HMI role isolation. Full Go test/vet/build/module verification pass; Windows race execution remains unavailable because the installed C compiler lacks 64-bit mode. `WEB-RBAC-001` remains RED; `RBAC-BE-003`, FE/E2E, rollout/target and approval remain open. ·
**Rev** 1.39 | 2026-07-27 — Resolved independent re-review findings: retained Schedule/Alarm Settings as Engineer+ configuration by approved policy; named current `http.go` rank routes and `auth.go` `Require`/`RoleAllows`/`roleRank` as mandatory migration inventory; selected a durable-before-publish in-memory user snapshot for per-request `session_version` validation; and required atomic/concurrent `SetRole`/`DeleteUser` last-admin guards. Documentation only; runtime remains three-role. ·
**Rev** 1.38 | 2026-07-27 — Closed `RBAC-DOC-001`: ADR-022, canonical requirements, detailed SRS/SW requirements, interfaces, OpenAPI v1.10.0 role enums/operation `x-rbac`, `WEB-RBAC-001` and traceability now carry the approved four-role target. Backend, `users.conf` and FE remain three-role; next work is `RBAC-BE-001/002`. ·
**Rev** 1.37 | 2026-07-27 — Hardened the owner-approved RBAC plan after independent review: split runtime operation from engineer-only configuration, mapped concrete endpoints (including exact-admin `PUT /trends/config` and `/users*`), prohibited rank-only route authorization, selected persisted `session_version`, required a full FE admin-hardcode sweep, made OpenAPI a pre-code gate, and added last-admin/stale-token/background-query negative tests. Code/OpenAPI remain on the 3-role baseline until the work packages pass. ·
**Rev** 1.36 | 2026-07-27 — Chốt kế hoạch RBAC Web 4 role `viewer|operator|engineer|admin`: operator giữ quyền vận hành và chỉ edit/validate/build Programming; engineer được Settings/Program activation nhưng bị chặn toàn bộ Users và database mutation; viewer read-only với ngoại lệ mật khẩu/Display cá nhân; bổ sung capability authority, session invalidation, last-admin invariant, security matrix và rollout gates. Code/OpenAPI vẫn là baseline 3 role cho tới khi work package hoàn tất. ·
**Rev** 1.35 | 2026-07-25 — Made legacy Ethernet fields compatibility read-only across both config write paths, aligned Go candidate validation with `mkddc-netcfg`, and restricted Network navigation, route access, and authority polling to admins. · **Rev** 1.34 | 2026-07-24 — Added admin-only strict/bounded Web adapter to `mkddc-netcfg`, authoritative active/pending/countdown FE transaction UX, explicit Confirm/Rollback controls, and fail-aware legacy config toast handling; target/manual disconnect-reconnect evidence remains open. · **Rev** 1.33 | 2026-07-22 — Merged ADR-017 local-HMI broker/network authority handoff with historian v2 guide history; Web network source remains desired/pending until BE/FE uses stage/apply/confirm/rollback and active/pending/reconnect/rollback UX. ·
**Rev** 1.32 | 2026-07-21 — Completed bounded Orange Pi schema-v5 activation with final ARM64 package parity, owner-safe atomic config replacement, first-cycle restart gaps, 596,284-row migration evidence and live v2 query/writer smoke; release gates remain open. **Rev** 1.31 | 2026-07-21 — Closed ARM64 prebuilt-native parity on frozen schema-v5 legacy/active fixtures with native manifest and unchanged artifacts; live schema-v1/SQLITE_BUSY/migration/cutover remain open. **Rev** 1.30 | 2026-07-21 — Recorded ARM64 native preflight fail-closed on board schema-v1 fixture with unchanged SHA. **Rev** 1.29 | 2026-07-21 — Added native `historian-rollback-package` parity gate with independent current/candidate builds, SHA/build metadata, legacy+active fixture execution, DB-family/archive/evidence immutability and atomic manifest output. **Rev** 1.28 | 2026-07-21 — Added read-only `historian-rollback-verify` schema-v5 fixture gate with exact authority/evidence validation, future-schema rejection and no-mutation SHA proof. **Rev** 1.27 | 2026-07-21 — Added offline `historian-maintenance` operator CLI with exact confirmation, stable UTC, service-presence, path containment and manifest/window/fresh-authority preflight. **Rev** 1.26 | 2026-07-21 — Added maintenance-only ordered writer quiesce/final backup/full migration/evidence/gap/activation coordinator and schema-v5 quiesce proof.
**Rev** 1.23 | 2026-07-21 — Physical rolling-prune engine code/local GREEN with fail-closed activation proof, durable queue/retry, checksum validation, all-tier cutoff and frontier rebase; execution, activation/cutover, target and E2E remain open.
**Rev** 1.22 | 2026-07-20 — Added interval-bounded retention contract/UI, selected/max API fields, policy validation/schema migration and capacity projection; physical prune, target benchmark and activation/cutover remain open. · **Rev** 1.21 | 2026-07-20 — Closed WEB-HIST-005 shared Logging Control/unified Trends code-local gates with 50 frontend tests, UTC range/partial/generation/BAD-gap/stepped coverage, default-off v2 authority gate and no VP diagnostic/database conflation; retained legacy authority, activation/cutover, target and release gates as open. · **Rev** 1.20 | 2026-07-20 — Closed WEB-HIST-004 unified query/CSV code-local gates with JSON/CSV shared iteration, generation-aware RAM/hot/archive merge and supported Linux race; retained legacy authority, WEB-HIST-005, activation/cutover, target and release gates as open. · **Rev** 1.19 | 2026-07-20 — Closed the WEB-HIST-003 shadow code-local slice after deterministic scheduler/error-path TDD and supported Linux race; legacy authority, WEB-HIST-004/005, activation/cutover, target and release gates remain open. · **Rev** 1.18 | 2026-07-20 — Reconciled WEB-HIST-001/002 code-local completion and WEB-HIST-003 shadow-scheduler work in progress; WEB-HIST-004/005, activation/cutover, target and release gates remain open. · **Rev** 1.17 | 2026-07-15 — Reconciled WEB-HIST-001..005 and WEB-NAME-001 status, preserved WEB-016 as technical-tag foundation, and aligned legacy custom-range containment wording. · **Rev** 1.16 | 2026-07-15 — Reconciled local historian/name evidence: backend coverage 59.7%; OpenAPI 1.6.0 parses with 41 paths, 216 local refs, zero decoded C1 controls; Windows CGO 64-bit race block and E2E/manual/generation-root gates remain open. · **Rev** 1.15 | 2026-07-15 — ADR-018/019 amendments: independent unique display names, legacy conflict resolution, shared UI/AO/DO/VP Logging Control, immediate/future start, persistent policy states and backend-owned 48-hour/archive Trends merge; implementation remains open. · **Rev** 1.14 | 2026-07-15 — ADR-019 Phase A API-writer implementation verified locally: global validation, `id+tag+name`, FE tag/error surfaces and migration helper; release gates remain explicit. · 1.13 | 2026-07-15 — ADR-019 Phase A global point tags planned: backend aggregate validation, `id+tag+name`, FE field errors, migration/generation gates; Phase B deferred. · 1.12 | 2026-07-15 — Owner-approved FE adjustment: bảng timestamp Trends chỉ render 5 mốc mới nhất; chart giữ toàn bộ samples/range, không đổi REST/WS contract. · 1.11 | 2026-06-23 · DoD: [13_DEFINITION_OF_DONE §5](13_DEFINITION_OF_DONE.md)
- 1.11 (2026-06-23): Go security dependency refresh: `golang.org/x/crypto v0.53.0`, `golang.org/x/sys v0.46.0`; giữ nguyên REST/WS contract.
- 1.10 (2026-06-23): frontend security dependency refresh: Vite 8.0.16 + plugin-react 6.0.2, Node 22 CI, Vite config manualChunks compatibility; giữ nguyên REST/WS contract.
- 1.9 (2026-06-17): chuẩn hóa i18n frontend: tiếng Việt có dấu + English mode cho label/nút/toast chính; giữ nguyên REST/WS contract.
- 1.8 (2026-06-16): thêm sticky top status bar + NavRail cố định khi cuộn; giữ nguyên REST/WS contract.
- 1.7 (2026-06-16): owner adjustment cho dashboard dynamic metrics: normal/in-range xanh lá, warn cam, fault đỏ; giữ nguyên REST/WS contract.
- 1.6 (2026-06-16): owner adjustment cho compact indicator dots/icons: OK/ONLINE xanh lá, OFF/OFFLINE xám; giữ nguyên REST/WS contract.
- 1.5 (2026-06-16): hoàn tất ISA-101 P3/3: trang thật thay stub, gộp System Health vào Dashboard, Programming + Alarm settings demo; giữ nguyên REST/WS contract.
- 1.4 (2026-06-16): áp ISA-101 P2/3, cập nhật cây trang 3 nhóm + routing mới; giữ nguyên REST/WS contract.
- 1.3 (2026-06-16): áp ISA-101 Level A P1/3 cho frontend theme/status; giữ nguyên REST/WS contract.
- 1.2 (2026-06-16): bổ sung danh sách trang frontend Rev A thực tế (§1) + ghi chú trạng thái demo 4 trang Trends/Scheduler/Network/Validator khớp spec; làm rõ KHÔNG đổi REST/WS contract §2.
- 1.1 (2026-06-11): Contract Freeze — RBAC 3 role, web luôn vào mức manual, IPC contract 07 §8, SystemStatus versions.
- 1.0 (2026-06-10): bản đầu.
