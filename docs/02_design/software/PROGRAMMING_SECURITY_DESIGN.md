# Thiết kế bảo mật Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID | `DDD-SEC-PROG-001` |
| Phiên bản | 0.3 |
| Trạng thái | **M3 — Review Ready** — DD-01..13 đủ; TLS production còn chặn mutation |
| Ngày | 2026-08-09 |
| Chủ quản | Security Lead + Backend Lead |
| Người review | Core Lead, Operations Lead, Verification Lead |
| Người phê duyệt | System Architect + Product Owner |
| Nguồn | `SRS-PROG-001`, `ARCH-PROG-001`, `IFSPEC-PROG-001`, Product Spec v2.2 |
| Phạm vi | Web/BE/compiler/Core/artifact/bundle/audit/operations Programming Rev A |

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Định nghĩa **ai được làm gì, chặn đầu vào độc hại ở đâu, và ghi lại dấu vết ra sao**. Gồm biên tin cậy, RBAC phía server, cách ly compiler, toàn vẹn artifact, kiểm gói import và nhật ký audit. |
| 2. Ai phải đọc file này? | Security và BE (chủ quản); Core đọc §7 (artifact/IPC/filesystem); Ops đọc §12 (xoay chứng chỉ/khóa); QA dựng ca tấn công từ §10 và §15. |
| 3. Hệ thống hiện tại đang có gì? | **Web đang chạy HTTP cổng 8081, chưa có TLS** — đây là gap lớn nhất. Chưa có route Programming nên chưa có RBAC cho nó. Compiler C++ và CLI đã có, có sẵn fuzz harness. Artifact có mã hash + Ed25519 nhưng chưa nối vào tích hợp local. IPC Web/Core có sẵn nhưng chưa có giao thức Programming. Có nền tảng logging nhưng **chưa có chuỗi audit riêng cho Programming**. |
| 4. Thiết kế mới thay đổi điều gì? | Đặt RBAC ở **server**, ở cả tầng handler lẫn tầng service — vì chặn ở UI không phải là chặn. Chạy compiler trong tiến trình cách ly, có hạn ngạch, không mạng, không include theo đường dẫn tùy ý. IPC dùng UDS có kiểm credential của tiến trình đối tác, quyền `0660`, khung có phiên bản và giới hạn kích thước. Audit ghi có cấu trúc và bất biến. |
| 5. Team phải sửa module/contract nào? | §13. BE: middleware authz + audit store; Core: kiểm quyền socket và verify artifact độc lập; Ops/Platform: dựng TLS. **Hệ quả bắt buộc ngay**: vì chưa có TLS, mọi mutation Programming phải **mặc định tắt** trong gói production. |
| 6. Điều gì còn bị chặn? | TLS production (Security + Platform) — chặn bật mutation. Ma trận quyền chờ `OD-PROG-001`. Chính sách provenance/chữ ký artifact chưa ký. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | §14: `VS-PROG-022` (chạy **mọi** thao tác đọc/ghi với viewer/operator/admin và cả role đã bị thu hồi; deny phải không sinh IPC hay ghi DB), `VS-PROG-021` và `VS-PROG-023` (corpus gói độc hại: artifact/native/path traversal/symlink/zip bomb/sai target). `NOT RUN`. |

Một điều **không** được coi là kiểm soát an ninh: “mạng lab kín”. Nó không thay
thế TLS. Tương tự, vai trò hiển thị trên UI không thay thế kiểm quyền ở server —
đó chính là `RSK-PROG-012`.

## 1. Mục tiêu, tài sản và giả định

Mục tiêu là ngăn người không có quyền thay logic/output, ngăn source/artifact độc
hại phá availability/RT, bảo vệ credential/audit và giữ khả năng khôi phục. Thiết
kế không tuyên bố thiết bị an toàn khi host root hoặc supply chain đã compromise;
secure boot/OTA toàn hệ thống nằm ngoài phạm vi nhưng là dependency.

| Tài sản | Tính chất cần bảo vệ |
|---|---|
| Revision/source/mapping/task | integrity, confidentiality theo role, provenance |
| Artifact/active/LKG/RETAIN | integrity, compatibility, availability |
| Physical output/control authority | integrity, freshness, single owner |
| Credential/session/key/certificate | confidentiality, rotation, least privilege |
| Audit/operation/journal | append integrity, attribution, retention |
| Controller CPU/memory/storage/IOP | availability và RT deadline |

Attacker xét tới: anonymous LAN client, authenticated viewer/admin bị lạm dụng,
malicious bundle/source, compromised browser session, local low-privilege process,
network MITM khi HTTP, resource exhaustion và power interruption. Không tin FE,
file name, MIME, bundle manifest hay artifact metadata nếu chưa verify.

## 2. As-Built và security gate

| Boundary | As-Built 2026-08-09 | Target / gate |
|---|---|---|
| Web transport | source report ghi HTTP port 8081, chưa TLS | TLS + secure session; Programming mutation feature OFF đến khi PASS |
| Programming API | chưa có route BE/FE production | package server-side RBAC/CSRF/rate limit/audit |
| Compiler | C++ compiler/CLI và fuzz harness có | sandbox process non-RT, quota, no network/path include |
| Artifact | hash + Ed25519 code; local integration chưa wired | policy HASH_ONLY/provenance cần decision, loader verify độc lập |
| IPC | Web/Core IPC hiện hữu; Programming protocol chưa có | UDS peer credential, `0660`, bounded versioned frame |
| Audit | nền tảng có logging nhưng chưa Programming chain | immutable structured audit DB + export/retention |

Do HTTP/TLS gap, mọi mutation Programming phải mặc định disabled trong production
package. Không được lấy mạng lab kín làm security control thay TLS.

## 3. Trust boundary và luồng dữ liệu

```text
[Browser hostile]
  --TLS/session/CSRF/origin--> [Web API privilege boundary]
  --sanitized source--> [Compiler sandbox process]
  --artifact in protected staging + UDS peer creds--> [Core non-RT loader]
  --validated immutable handle--> [RT executor]
  --priority resolver/IOP--> [Physical process]

[Imported bundle hostile] → quarantine → schema/hash/zip limits → Draft only
[Ops package] → filesystem/service policy → Web/Core state and audit
```

BE là policy enforcement point cho user action; Core không tin actor/role do FE
gửi và chỉ chấp nhận local peer/service protocol. Core loader là enforcement point
cuối cho executable artifact. RT executor không có network/file/parser capability.

## 4. RBAC và authorization

| Capability | Viewer | Operator | Programming Admin | System Admin |
|---|:---:|:---:|:---:|:---:|
| xem status/monitor/audit sanitized | ✓ | ✓ | ✓ | ✓ |
| xem source/diff/export source | theo policy | — | ✓ | ✓ |
| sửa Draft/tạo Revision/Check | — | — | ✓ | ✓ |
| Commission/Restore | — | — | ✓ + strong ack | ✓ + strong ack |
| trace bounded | — | ✓ read-only | ✓ | ✓ |
| RETAIN reset/import bundle | — | — | ✓ + re-auth | ✓ + re-auth |
| user/role/TLS/security policy | — | — | — | ✓ |

Role matrix cuối là OPEN decision. Authorization kiểm server-side ở handler và
service method; unit test gọi service trực tiếp để tránh bypass middleware. Object
scope theo controller/project; unauthorized existence trả đồng nhất 404/403 policy.
Commission/Restore/RETAIN reset yêu cầu recent re-auth và confirmation token gắn
actor, operation type, revision/controller/impact hash, one-time, hạn 5 phút.

Separation of duty mục tiêu: người duyệt Revision không tự duyệt policy/security
exception của chính mình; break-glass có lý do, thời hạn, alert và review hậu kiểm.

## 5. Web/session/transport

- TLS 1.2+ với cipher/platform baseline; HTTP redirect không đủ cho API mutation;
  HSTS sau khi certificate lifecycle được vận hành.
- Cookie session `Secure`, `HttpOnly`, `SameSite=Strict/Lax` theo flow; session ID
  rotate sau login/role change, idle/absolute timeout, revoke server-side.
- Mutation cookie-auth yêu cầu CSRF token và strict Origin/Host allowlist. Không
  dùng CORS wildcard/JSONP/query token. WebSocket kiểm session+Origin tại handshake,
  revalidate expiry và đóng khi revoke.
- CSP chặn inline/script ngoài allowlist; source program render dạng text, không
  `innerHTML`; filename/message/diagnostic encode theo context.
- Response `Cache-Control: no-store` cho source/operation/audit; không log cookie,
  Authorization, CSRF, full source/bundle hay secret.

## 6. Input, compiler và DoS

| Control | Giá trị/behavior |
|---|---|
| JSON/source size | reject sớm trước decode sâu; 1 MiB request, 64 KiB/ST Program baseline |
| nesting/token/entity | giới hạn compiler/schema; không XML/entity/include/url |
| worker isolation | separate UID/process, no network, read-only binary, private scratch, seccomp/cgroup khi platform hỗ trợ |
| CPU/memory/time | 5 s, 128 MiB/job đề xuất; một worker/controller, bounded global queue |
| parser/loader | fuzz + sanitizer CI; checked arithmetic; deterministic diagnostic cap 64 |
| rate limit | read 120/min, Draft 30/min, Check 6/min, Commission/Restore 2/min per actor/controller |
| logging | rate limit + structured code; không echo entire hostile payload |

Timeout/OOM/crash chỉ làm Check failed; không artifact/stage/runtime side effect.
Cache key/hash được verify trước reuse; temp path random service-owned, xóa sau
close; no shell interpolation. Compiler executable/library version được pin bởi
package manifest, không nhận path từ request.

## 7. Artifact, IPC và filesystem

- Artifact max 1 MiB, loader theo `IFSPEC-ART-PROG-001`; hash kiểm lại trong Core.
- Target HASH_ONLY chỉ an toàn khi source compiler và staging path đều nằm trong
  trusted local boundary; decision thay đổi phải update artifact/security spec.
- UDS mode `0660`, service UID/group cố định, peer `SO_PEERCRED`; systemd sandbox
  `NoNewPrivileges`, hạn capability, filesystem write allowlist.
- Frame length-prefix ≤64 KiB; deadline/request/operation/payload hash bắt buộc.
  Locator mở dưới root fixed bằng `openat2`/no-follow; reject symlink, traversal,
  non-regular file, wrong owner/mode/size/hash.
- Config/state/staging/retain/audit directory tách quyền. Không world writable;
  atomic temp+fsync+rename; backup encryption/access theo Ops policy.
- Core runtime không liên kết parser/compiler và không đọc source/bundle.

## 8. Bundle import/export và replacement

Bundle Rev A chỉ source/config/manifest/hash; cấm artifact executable, credential,
certificate/private key, session, audit raw và RETAIN secret. Export sanitize theo
role và target project selection.

Import vào quarantine, giới hạn compressed/uncompressed count/size/ratio/path;
cấm absolute path, `..`, symlink/hardlink/device, duplicate/confusable path. Verify
manifest/schema/hash rồi tạo Draft mới; không overwrite project, không auto-Check/
Commission. Mapping/controller identity phải review lại trên target replacement.

## 9. Audit, secret và privacy

Audit bắt buộc cho login failure/security denial, Draft/Revision/Check, import/
export, Commission/Restore, trace, RETAIN reset, role/policy change và break-glass.

| Field | Quy tắc |
|---|---|
| `auditId`, UTC timestamp, correlation/operation | immutable, unique |
| actor/session class/source IP | sanitize/retention; không session token |
| action/object/controller/revision/hash | đủ attribution, không full source |
| before/after metadata | chỉ field allowlist; secret redacted |
| result/error/detail | stable code; không stack/path/key |
| active before/after/read-back | bắt buộc cho runtime mutation |

Audit record có hash chain/chunk signature nếu platform decision duyệt; ít nhất DB
transaction và restricted append/export. Clock rollback không được sắp xếp sai:
dùng sequence + monotonic observation bên cạnh UTC. Secret lấy từ system credential
store/file permission, không hard-code/repo/DB Programming/bundle/log.

## 10. Threat/control matrix

| Threat/abuse | Detection/control | Failure/recovery | Test |
|---|---|---|---|
| CSRF commission | token + Origin + re-auth + ack hash | 403, no DB/IPC, audit | `SEC-T-001` |
| viewer/service bypass | handler + service RBAC/object scope | deny uniform, audit | `SEC-T-002` |
| stolen/replayed request | TLS/session rotate/idempotency/expiry | same op or reject | `SEC-T-003` |
| source parser bomb | size/depth/token/process quota | Check failed, worker restart | `SEC-T-004` |
| malicious artifact | hash/loader/limits/profile | reject, LKG keep | `SEC-T-005` |
| bundle zip-slip/bomb | quarantine/path/count/ratio | reject/delete quarantine | `SEC-T-006` |
| local fake BE | UDS mode/peer creds/protocol hash | close/reject/alert | `SEC-T-007` |
| symlink staging race | root FD/no-follow/fstat/hash | reject, no load | `SEC-T-008` |
| API/compile exhaustion | rate/queue/cgroup/backpressure | 429/503, RT unaffected | `SEC-T-009` |
| audit tamper/log injection | structured encoding/access/integrity check | alert/export preserved | `SEC-T-010` |
| HTTP MITM | mutation OFF until TLS | unavailable, not insecure fallback | `SEC-T-011` |
| compromised artifact provenance | DB/file/Core hash reconciliation | block activation + incident | `SEC-T-012` |

## 11. Error response và incident behavior

Public error theo `IFSPEC-PROG-001`; không tiết lộ object existence, path, UID,
stack, source snippet ngoài quyền, key/cert state chi tiết. Security denial không
retry tự động. Suspicious burst có correlation/audit/metric; không để log storm
làm cạn disk. Disk low watermark chặn mutation tạo dữ liệu mới trước khi ảnh hưởng
Core; runtime active tiếp tục và Ops được alarm.

Incident response tối thiểu: disable Programming mutation feature flag → preserve
audit/journal/hash evidence → read-back active/LKG/output owner → revoke session/
rotate affected credential → Restore known-good qua normal verify path → post-review.
Không xóa evidence hoặc edit DB để “khôi phục trạng thái”.

## 12. Compatibility, certificate/key rotation và rollback

- Security policy/schema versioned; consumer unknown major fail closed.
- Certificate rotation hỗ trợ overlap trust window, health/read-back và rollback;
  private key permission/service reload test. Hết hạn certificate không downgrade
  về HTTP; mutation unavailable có cảnh báo.
- Session/CSRF change deploy BE trước FE với bounded compatibility; rollback không
  mở bypass. UDS protocol minor negotiated; major mismatch disables mutation.
- Security config rollback không phục hồi secret cũ đã compromised; dùng new
  credential. App rollback giữ audit/DB/artifact/RETAIN.

## 13. Repository mapping

| Thành phần | Target path | Kiểm chứng |
|---|---|---|
| RBAC/service policy | `apps/web-api/internal/programming`, auth middleware | direct service/route negative tests |
| session/TLS/CSRF | `apps/web-api/internal`, platform proxy/service config | browser/network/TLS scanner; no secret logs |
| compiler sandbox | `apps/web-api/internal/programming/compiler`, service unit | cgroup/seccomp/timeout/OOM tests |
| bundle | `apps/web-api/internal/programming/bundle` | malicious archive corpus |
| artifact/IPC | `apps/core/application/st`, `application/programming`, `contracts/ipc` | loader fuzz/peer/path/deadline tests |
| filesystem/package | `platform/packaging/` | owner/mode/upgrade/rollback inspection |
| audit | Programming store/service/export | attribution/retention/tamper/restart tests |

## 14. Verification acceptance

Ngoài `SEC-T-001..012`, bắt buộc chạy dependency/static analysis theo CI, secret
scan, fuzz parser/loader, TLS/session browser flow, API authorization matrix,
rate/queue load và target availability. PASS chỉ khi evidence có version/image/
commit/target/time, không P0/P1 mở và không regression IOP/scan.

Security test dùng tài khoản/credential lab riêng; báo cáo không chép token/cookie/
private key. Production penetration/release approval thuộc V&V/release gate.

## 15. Security control handoff và abuse flow

| Control ID | Điểm bắt buộc implement | Fail closed | Log/evidence |
|---|---|---|---|
| `SEC-PROG-C01` | middleware + service method RBAC | `403`, không store/IPC | actor/role/action/target/result |
| `SEC-PROG-C02` | CSRF/session/re-auth cho mutation mạnh | reject trước parse domain | request ID, không token/cookie |
| `SEC-PROG-C03` | compiler sandbox/quota/no-network | kill job, no artifact | limit hit/exit/elapsed/build key |
| `SEC-PROG-C04` | canonical hash + bounded loader + target ABI | LKG giữ | revision/artifact hash, detail code |
| `SEC-PROG-C05` | UDS peer credential/version/frame limit | close/reject frame | peer identity/version/code |
| `SEC-PROG-C06` | bundle quarantine/source-only allowlist | no Project/Active mutation | manifest/rejected entry/reason |
| `SEC-PROG-C07` | audit transaction + retention/export auth | mutation rollback nếu audit required fail | chain/checksum/export actor |
| `SEC-PROG-C08` | TLS/cert/secure headers production gate | mutation capability OFF | scanner/config/cert rotation record |

Abuse flow bắt buộc test: viewer gọi Commission; admin replay same/different body;
zip-slip/symlink/decompression bomb; ST/FBD parser bomb; artifact offset overflow;
staging file owner sai; rogue local UDS client; operation flood; event data chứa
source/secret; downgrade loader/profile. Mỗi case phải truy ra control ID, public
error không rò chi tiết và evidence trong V&V.

## 16. Blocker, revision và phê duyệt

| Blocker | Owner | Gate | Điều kiện mở |
|---|---|---|---|
| TLS chưa production-ready | Security + Platform | cấm mutation | certificate/session/CSRF target evidence PASS |
| RBAC/integrity/retention decisions OPEN | Product + Security + Architect | DOC-G2 approval | decision package signed |
| Programming implementation chưa có | BE + Core | Plan 53 | code + negative/fuzz/load/target test |

| Phiên bản | Ngày | Thay đổi | Tác giả |
|---|---|---|---|
| 0.1 | 2026-08-09 | Thiết kế trust/RBAC/web/compiler/artifact/bundle/audit/incident và test | System Engineering |
| 0.2 | 2026-08-09 | Bổ sung control-ID handoff, fail-closed/log requirement và abuse-flow catalog; chuyển Detailed Draft chờ security review | System Engineering |
| 0.3 | 2026-08-09 | Thêm mục Đọc nhanh và bảng tự kiểm `DD-01..DD-13`; nêu rõ hệ quả “chưa có TLS ⇒ tắt mutation” | System Engineering |

| Vai trò | Trạng thái | Bằng chứng |
|---|---|---|
| Security + Backend Lead | Chờ review | — |
| Core + Ops + QA | Chờ review | — |
| System Architect + Product Owner | **BLOCKED — chưa phê duyệt** | TLS + `PROG-OD-001` |

Tự kiểm `DD-01..DD-13`:

| Mã | Kết quả | Mục trong file / lý do |
|---|---|---|
| `DD-01` Metadata | PASS | Bảng đầu file; revision history và bảng ký §16 |
| `DD-02` Mục tiêu/phạm vi | PASS | §1 mục tiêu, tài sản cần bảo vệ và giả định |
| `DD-03` As-Built | PASS | §2 bảng security gate: **HTTP cổng 8081, chưa TLS**; chưa có route Programming; compiler/CLI và fuzz harness có; hash + Ed25519 có mã nhưng chưa nối; IPC Programming chưa có; chưa có chuỗi audit Programming |
| `DD-04` Target ownership | PASS | §3 biên tin cậy và luồng dữ liệu; §7 quyền sở hữu artifact/IPC/filesystem |
| `DD-05` Data từng field | PASS | §9 trường bắt buộc của bản ghi audit, quy tắc secret và quyền riêng tư |
| `DD-06` Interface | PASS | §4 RBAC theo action; §5 web/session/transport; §11 phản hồi lỗi không rò thông tin |
| `DD-07` State/algorithm/timing | PASS | §6 giới hạn đầu vào/compiler/DoS gồm hạn ngạch và timeout; §12 xoay chứng chỉ/khóa |
| `DD-08` Operation flow | PASS | §15 luồng lạm dụng và bàn giao control; §11 hành vi khi có sự cố |
| `DD-09` Error/safety/security | PASS | §10 ma trận threat/control; §8 kiểm gói import; nguyên tắc **fail closed** và RBAC ở cả handler lẫn service chống `RSK-PROG-012` |
| `DD-10` Repository mapping | PASS | §13 middleware, audit store, kiểm quyền socket và verify artifact |
| `DD-11` Verification | PASS | §14 gắn `VS-PROG-021/022/023`; yêu cầu deny phải **không** sinh IPC hay ghi DB |
| `DD-12` Compatibility/deploy/rollback | PASS | §12 tương thích, xoay chứng chỉ/khóa và rollback |
| `DD-13` Trace/risk/decision/sign-off | **BLOCKED** | Owner: Security + Platform (TLS), Product + Security (`OD-PROG-001` ma trận quyền), Product + Security (chính sách provenance artifact). Ảnh hưởng: **chưa có TLS thì mọi mutation Programming phải mặc định tắt trong gói production**; không có ma trận quyền đã ký thì không viết được test âm 403. Gate: `DOC-G2`. Điều kiện mở: TLS/session/CSRF PASS trên target, ký permission matrix, ký `IntegrityMode` |

Một `BLOCKED`, đủ bốn trường. Mạng lab kín **không** được tính là biện pháp thay
TLS. Residual security **không được giảm** trước khi có implementation và bằng
chứng trên target.
