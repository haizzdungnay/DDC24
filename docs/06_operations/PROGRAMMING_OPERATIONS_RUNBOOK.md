# Runbook vận hành Programming MK-DDC-24

| Thuộc tính | Giá trị |
|---|---|
| ID tài liệu | `OPS-PROG-001` |
| Phiên bản | 0.5 |
| Trạng thái | **M3 — Review Ready** — thủ tục đủ; chưa diễn tập lần nào |
| Ngày | 2026-08-09 |
| Chủ quản | Operations Lead |
| Người review | Core/BE/FW/HW/Security/Verification Leads |
| Người phê duyệt | Operations Lead + Release Authority |
| Nguồn | `DDD-LIFE-PROG-001`, `IFSPEC-PROG-001`, `VVP-PROG-001` |

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Là **cẩm nang thao tác tại hiện trường**: sao lưu, đưa vào vận hành, khôi phục, thay controller, nâng cấp gói và xử lý sự cố. Viết để người trực ca làm theo từng bước, kể cả khi đang căng thẳng. |
| 2. Ai phải đọc file này? | Ops và Release (chủ quản); kỹ thuật viên hiện trường làm theo; Core/BE đối chiếu để bảo đảm thủ tục khớp hành vi thật; QA kiểm bằng diễn tập. |
| 3. Hệ thống hiện tại đang có gì? | Chưa có thao tác Programming nào chạy trên thiết bị thật. Theo báo cáo nguồn, việc triển khai hiện chủ yếu **thủ công qua SSH**, chưa có staged operation do gói quản lý. Nghĩa là các thủ tục dưới đây **chưa từng được diễn tập**. |
| 4. Thiết kế mới thay đổi điều gì? | Thay thao tác tùy ứng bằng thủ tục có kiểm tra trước, có đọc ngược sau mỗi bước, có sao lưu trước khi đổi, và có điều kiện dừng rõ ràng. Bổ sung cây quyết định cho tình huống khó nhất: **timeout và kết quả không xác định** (§14). |
| 5. Team phải sửa module/contract nào? | Không sửa code. Cần chuẩn bị lệnh thu thập baseline (§10), quy trình sao lưu có kiểm chứng (§11) và mẫu bản ghi thao tác (§17.1). |
| 6. Điều gì còn bị chặn? | Chưa có API và runtime Programming nên chưa diễn tập được; đồ gá và thiết bị đo cho phần kiểm chứng vật lý chưa sẵn sàng. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | §16: diễn tập nâng cấp và thay thiết bị, lưu bằng chứng; `VS-PROG-030` (restart toàn hệ) và `VS-PROG-011` (chèn lỗi vòng đời). Chưa diễn tập lần nào. |

Nguyên tắc số một khi gặp `UNKNOWN`: **tra lại trạng thái, không gửi lại lệnh.**
Gửi lại một lệnh Commission mà không biết lệnh trước đã tới đâu là cách nhanh
nhất để tạo ra kích hoạt đôi. Cây quyết định đầy đủ ở §14.

## 1. Phạm vi và guardrail

Runbook mô tả vận hành target sau khi G0–G5 đạt. Hiện chỉ dùng cho review và
diễn tập lab. Không enable `PROGRAM_ONLY`, không xóa graph/LKG/Revision và không
chạy trên production thật nếu chưa có release approval.

## 2. Preflight trước Commission

1. Xác minh controller/SKU/board, software build, compiler/profile/target ABI.
2. Health core/iobus/MCU và IOP freshness; không có restart loop/safe-state.
3. Revision/Check/Artifact cùng identity/hash và Check còn hiệu lực.
4. Backup Project source, active Revision/LKG, graph/config và DB có checksum.
5. Review change manifest, Point/output/RETAIN/cutover impact.
6. Liệt kê mọi manual override actor/value/priority/TTL; xử lý tại Chạy thử.
7. Xác minh watchdog/base-step budget và HIL evidence phù hợp release profile.
8. Xác minh quyền admin, change window, rollback owner và observer vật lý.

Thiếu bất kỳ mục Must nào → `BLOCKED`, không Commission.

## 3. Commission chuẩn

```text
Check → Review readiness/impact → Strong confirm
→ operation REQUESTED/STAGED/APPLYING/VERIFYING
→ core activeRevision/artifact read-back
→ first-cycle/task/IOP/safe-state verification
→ Commission record + audit
```

Không rời màn hình hoặc gửi lại nếu timeout. Query operation/runtime tới khi
terminal; nếu vẫn Unknown, chuyển incident procedure và giữ output observation.

## 4. Restore Previous

- Chỉ Revision compatible/LKG đã biết, qua cùng loader/integrity/transition path.
- Review output/RETAIN/override/cutover impact và strong confirmation.
- Xác minh active revision/hash, first cycle, Task, IOP poll, safe-state và audit.
- Restore fail giữ active đang có; không copy file/DB/retain thủ công khi runtime chạy.

## 5. Thay controller

1. Export source-only bundle + manifest/hash; lưu checksum ngoài controller.
2. Provision target đúng SKU/version/Point Catalog và nhập bundle.
3. Import phải tạo Draft, không active; remap Point identity khi cần.
4. Check/build lại trên target; review artifact mới và RETAIN cold-init impact.
5. Thực hiện HIL/commissioning vật lý qua module Chạy thử.
6. Commission, verify runtime/output, lưu record/handover.

Không mang artifact/IR/native binary/private key từ controller cũ.

## 6. Upgrade và rollback package

Deploy theo thứ tự tương thích: contract/schema → BE read-only → Core capability
→ compiler/Check → FE → Commission feature flag sau evidence. Backup DB/config/
artifact/LKG trước migration. Health check phải gồm API, core/iobus/MCU freshness,
active revision/hash và output continuity, không chỉ service `active`.

Rollback software không xóa dữ liệu schema mới; nếu binary cũ không đọc được,
restore backup vào đường riêng sau khi dừng owner service có kiểm soát. Không
restart iobus/Core mù khi output/Commission operation đang chuyển trạng thái.

## 7. Incident matrix

| Triệu chứng | Hành động đầu | Không được làm |
|---|---|---|
| Commission timeout/Unknown | query operation + core status, giữ correlation | POST lại mù |
| Core unreachable, Web còn | khóa Commission, quan sát stale, kiểm service/IPC | nói controller offline/fake zero |
| MCU safe entry/IOP gap | bảo vệ plant, kiểm iobus/UART/Core load, lưu waveform/log | tiếp tục Commission |
| Task overrun | xác định Task/Program/WCET, tạo Draft fix | tự reset toàn plant/safe-state nếu policy không yêu cầu |
| Artifact integrity reject | giữ LKG, quarantine artifact, audit security | bypass hash/loader |
| RETAIN corrupt/mismatch | cold-init theo policy + acknowledge/record | sửa bytes thủ công |
| Graph/Program conflict | giữ mode/LKG hiện hành, restore config/backup | dual-run để thử |

## 8. Evidence và handover

Mỗi operation lưu operation/commission ID, actor/time, previous/new revision,
artifact/profile, change/retain/override/cutover summary, target/board identity,
runtime/IOP/safe-state result, raw evidence path/checksum và approver. Secret,
token, private key và full payload nhạy cảm không vào handover.

## 9. Vai trò, change window và điều kiện dừng

| Vai trò | Trách nhiệm trong window |
|---|---|
| Change Owner | scope/Revision/impact/approval, quyết định tiếp tục/dừng |
| Operator | chạy đúng runbook, ghi UTC/correlation/actual, không tự đổi plan |
| Controls/Safety Observer | theo dõi physical process/output/override, ra lệnh abort |
| Platform/Core Observer | health/IOP/Task/journal/log và recovery |
| QA Evidence Custodian | lưu raw evidence/checksum, đánh PASS/FAIL/BLOCKED |

Dừng ngay nếu controller/Revision/hash khác plan; active/owner không xác định;
IOP gap/safe counter tăng; output vượt envelope; operation UNKNOWN quá deadline;
backup/rollback không verify; Core/iobus restart loop; hoặc observer yêu cầu abort.
Abort không đồng nghĩa kill service: trước hết giữ/đưa plant về trạng thái do Safety
authority quy định rồi Restore/reconcile qua API.

## 10. Lệnh thu thập baseline và preflight

Các lệnh hiện hữu sau chỉ đọc. Target Programming API/CLI phải được implement và
versioned trước khi dùng production; không thay URL/token thật vào evidence public.

```bash
systemctl --no-pager --plain is-active mkddc-iobus mkddc-core mkddc-web-pi
systemctl show mkddc-iobus mkddc-core mkddc-web-pi -p ActiveState -p SubState -p NRestarts -p MainPID
/usr/sbin/mkddc-core --version
/usr/sbin/mkddc-iobus --version
/opt/mkddc-web/mkddc-web --version
sha256sum /usr/sbin/mkddc-core /usr/sbin/mkddc-iobus /opt/mkddc-web/mkddc-web
journalctl -u mkddc-core -u mkddc-iobus -u mkddc-web-pi --since '-15 min' --no-pager
stat -c '%U:%G %a %n' /data/config /data/mkddc /run/mkddc
```

Sau khi API TLS được duyệt, operator dùng client chính thức hoặc request read-only
tương đương để lưu `capabilities`, `runtime`, active/LKG/hash/owner/Task/IOP health,
operation non-terminal, overrides và disk status. Không dùng `curl -k`, không ghi
Authorization/cookie ra shell history/log. API snapshot phải có correlation và UTC.

Preflight record có bảng `expected/actual/result` cho 8 mục §2; một `FAIL/UNKNOWN`
→ window `BLOCKED`.

## 11. Backup có kiểm chứng

Backup ID duy nhất, directory mới dưới `/var/backups/mkddc/<release-window>/` theo
packaging authority. Không `cp` SQLite đang chạy. BE Programming phải cung cấp
native SQLite backup/maintenance operation tạo snapshot consistent và manifest:

| Artifact | Bắt buộc | Verify |
|---|---|---|
| Programming DB | có | SQLite `quick_check=ok`, schema/source identity/hash |
| Project source bundle | có | source-only manifest/hash, import dry-run |
| active/LKG/artifact metadata | có | Core read-back ID/hash/profile/ABI |
| graph/config/cutover backup | nếu GRAPH/current migration | canonical hash + parse check |
| RETAIN | theo policy | layout/generation/CRC; quyền service-only |
| release binaries/config | có | `/usr/share/mkddc/runtime-checksums.sha256` + package version |

Manifest cuối được fsync, SHA-256 và review; backup chưa restore rehearsal không
được coi là rollback-ready. Secret/cert backup dùng secure store riêng, không nằm
trong source bundle/handover.

## 12. Commission procedure mức bước/read-back

| # | Action | Expected/read-back | Nếu sai |
|---:|---|---|---|
| 1 | freeze plan + expected active/owner | plan hash và window approval | block |
| 2 | chạy Check pinned Revision/target | PASSED + artifact/hash/profile | fail giữ active |
| 3 | review manifest/output/override/RETAIN/cutover | acknowledgement cho **đúng** các nhóm impact `PRESENT` (có thể `0`) + observer; nhóm `UNAVAILABLE` thì dừng | block |
| 4 | submit một lần với idempotency key | `202` + operation ID | timeout → §14, không replay |
| 5 | theo dõi durable state | monotonic valid lifecycle | invalid → UNKNOWN/reconcile |
| 6 | Core safe swap | actual active ID/hash/owner khớp | rollback/incident |
| 7 | verify first cycle/Task/IOP/safe counter | first-cycle OK; IOP <200 ms; no unexpected safe | abort/Restore |
| 8 | verify physical selected outputs | trong pre-approved envelope và authority đúng | Safety abort |
| 9 | close record/audit/evidence | operation SUCCEEDED + all hashes/logs | không close nếu thiếu |

Không đặt timeout UI làm timeout control. Nếu client đóng, operation vẫn tiếp tục;
operator reconnect và query bằng operation ID.

## 13. Restore/rollback procedure

Restore Previous ưu tiên LKG đã read-back tương thích. Thực hiện preflight/impact/
ack như Commission, dùng new operation ID nhưng target Revision/LKG rõ. PASS khi
Core active/hash/owner/first-cycle và physical output được xác nhận; không chỉ HTTP.

Package rollback chỉ dùng script version-controlled với snapshot rõ:

```bash
sudo platform/packaging/rollback.sh /var/backups/mkddc/<snapshot-id>
```

Lệnh này restart nhiều service, chỉ được chạy sau khi Change/Safety Owner xác nhận
plant state và operation không đang transition. Trước downgrade Core phải Restore
artifact/RETAIN tương thích. Sau rollback chạy lại baseline §10, Core runtime
read-back, IOP/safe counter và physical output. Không dùng glob, snapshot symlink
mơ hồ hoặc sửa DB/file active thủ công.

## 14. Decision tree cho timeout/UNKNOWN

```text
HTTP/IPC timeout
  → có operation ID/idempotency record?
    → có: query operation + Core status/journal read-back
    → không: query by idempotency key/correlation; tuyệt đối chưa POST lại
  → Core xác nhận candidate active + first-cycle?
    → có: reconcile BE/audit rồi close SUCCEEDED
    → không, active cũ/LKG rõ: close FAILED hoặc Restore theo authority
    → Core unreachable/ambiguous: bảo vệ plant, incident, giữ UNKNOWN
```

Escalate sau deadline operation đã duyệt hoặc ngay khi output/IOP/safety bất
thường. Thu `journalctl` bounded time, status snapshot, operation/audit ID, process
restart count và waveform; không dump secret/full source.

## 15. Incident playbook mở rộng

| Incident | Containment/read-back | Recovery/close criterion |
|---|---|---|
| DB/disk full/corrupt | disable mutation, Core active continues, preserve DB | native backup/quick_check/reconcile; no data deletion blind |
| compiler runaway | stop worker/queue, verify scan/IOP | Check failed, resource normal, runtime unchanged |
| TLS/session/RBAC incident | disable mutation, revoke/rotate, preserve audit | security review + negative test + approved reopen |
| active/LKG hash mismatch | block Commission, quarantine staging, read journal | Restore known-good verified, provenance incident closed |
| RETAIN failure | keep active/hold policy, no byte edit | approved migrate/cold-init/reset op + physical verification |
| graph/program dual owner | freeze transition and inspect generation | exactly one owner restored; VS-015 rerun |
| MCU/IOP safe entry | Safety controls plant, capture 199/200/201 context | comm/output normal, cause fixed, HIL/regression signed |

## 16. Upgrade/replacement rehearsal và evidence

Trước rollout phải rehearsal ít nhất: clean install, compatible upgrade, BE/Core
mixed version capability block, failed migration, binary rollback, DB restore,
LKG Restore, controller replacement source-only, certificate rotation failure,
power cut mỗi lifecycle phase. Mỗi run gắn VS scenario và Test Result.

Evidence directory controlled gồm preflight, manifest, checksums, commands (đã
redact), status before/during/after, operation/audit exports, logs bounded, raw
instrument data và reviewer. Handover ghi residual/waiver/next review; không ghi
“ổn” nếu metric/read-back thiếu.

## 17. Go/Stop/Abort và shift handover record

| Decision | Điều kiện tối thiểu | Action |
|---|---|---|
| `GO-PREFLIGHT` | change/backup/target/role/health/active/LKG/IOP/override/limits đủ và ký | cho phép tạo operation ID |
| `STOP-BEFORE-SIDE-EFFECT` | bất kỳ item preflight UNKNOWN/FAIL; active/hash/profile lệch | không submit; giữ runtime; mở incident/change |
| `ABORT-IF-SUPPORTED` | operation còn phase server công bố cancel-safe | gọi cancel đúng operation, read-back terminal |
| `HOLD-UNKNOWN` | timeout/mất Core sau submit | không replay/rollback mù; bảo vệ plant, reconcile |
| `ROLLBACK` | trigger §13 + Safety/Change authority | Restore LKG/graph, physical read-back, rồi package rollback nếu cần |
| `CLOSE` | terminal + active/hash/owner/IOP/output/audit khớp | ký operation record, cập nhật Trace/Risk/Test Result |

Handover giữa ca phải ghi controller/plant, active/LKG, operation đang mở và
phase, mutation capability, alarms/faults/overrides, backup snapshot, evidence
path, người chịu trách nhiệm tiếp theo và hành động bị cấm. Không bàn giao bằng
ảnh màn hình không có ID/hash/timestamp.

### 17.1 Operation record tối thiểu

```text
Change/operation/correlation ID:
Controller/Project/candidate/active-before/LKG/hash:
Approver/operator/witness:
Preflight result + backup snapshot/checksum:
Start/end; phase timeline:
Core/IOP/MCU/physical read-back before/after:
Result/error/UNKNOWN reconciliation:
Audit/Test Result/Risk/Trace links:
Rollback performed/result or reason not required:
```

## 18. Blocker, revision và phê duyệt

| Blocker | Owner | Điều kiện mở |
|---|---|---|
| Programming API/backup/lifecycle chưa implement | BE + Core | Plan 53 implementation/integration PASS |
| TLS/role/release policy chưa Approved | Security + Product + Release | decision + target security evidence |
| HW/HIL limits/fixture chưa available | HW + Safety + QA | controlled setup và VS-014/030 PASS |

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 0.1 | 2026-08-09 | Preflight/Commission/Restore/replacement/upgrade/incident baseline |
| 0.2 | 2026-08-09 | Bổ sung roles/commands/backup/read-back/unknown/rollback/rehearsal/evidence M3 |
| 0.3 | 2026-08-09 | Bổ sung GO/STOP/ABORT/HOLD/ROLLBACK/CLOSE gates, shift handover và operation record schema; chuyển Detailed Draft chờ rehearsal review |
| 0.4 | 2026-08-09 | Thêm mục Đọc nhanh và phụ lục tự kiểm cổng M3 loại Operations; ghi rõ chưa diễn tập lần nào |
| 0.5 | 2026-08-09 | Amendment A1: thêm §18.1 — số ô xác nhận thay đổi theo ảnh hưởng thật, `Chưa tính được` là điều kiện dừng, và vùng thao tác nguy hiểm tách riêng trên `PGM-04`; ba bước an toàn giữ nguyên |

| Vai trò | Trạng thái | Bằng chứng |
|---|---|---|
| Ops + Core + BE + FW/HW + Security + QA | Chờ review | — |
| Operations Lead + Release Authority | **BLOCKED — chưa phê duyệt** | implementation/TLS/HIL/rehearsal |

## 18.1 Ảnh hưởng của Amendment A1 lên thao tác

Hai điều đổi trong cách người trực ca nhìn màn hình; **không** điều nào giảm
bước an toàn.

1. **Số ô xác nhận thay đổi theo từng lần Commission.** Trước đây luôn có bốn ô.
   Giờ chỉ hiện ô cho ảnh hưởng có thật: có thể là ba ô, một ô, hoặc không ô nào.
   Đây **không** phải lỗi màn hình. Nhưng nếu màn hình báo `Chưa tính được` ở bất
   kỳ nhóm ảnh hưởng nào thì **dừng lại** — theo `IFSPEC-PROG-001` §6.1, trạng
   thái đó chặn Commission và phải báo kỹ thuật, không được tìm cách đi tiếp.
2. **Thao tác nguy hiểm gom vào một vùng riêng trên `PGM-04`.** Khôi phục, Nhập
   gói thay thiết bị và Đặt lại trạng thái lưu nằm trong khối có viền cảnh báo,
   tách khỏi bảng theo dõi. Người trực ca chỉ đọc sẽ thấy khối này ở chế độ đọc.

Ba bước an toàn giữ nguyên tuyệt đối trong mọi trường hợp: **xác thực lại trước
khi gửi**, **đọc ngược từ authority trước khi kết luận thành công**, và **có
đường quay lui**. Nếu một bản phát hành nào đó bỏ bớt một trong ba, đó là lỗi
chặn phát hành, không phải cải tiến trải nghiệm.

## 19. Phụ lục — Tự kiểm cổng M3 (loại: Operations)

| Cổng | Kết quả | Bằng chứng trong file / lý do |
|---|---|---|
| Vai trò và kiểm tra trước | PASS | §9 vai trò, khung giờ thay đổi và điều kiện dừng; §2 preflight trước Commission |
| Lệnh cụ thể | PASS | §10 lệnh thu thập baseline và preflight; §12 thủ tục Commission theo từng bước |
| Kỳ vọng và đọc ngược | PASS | §12 mỗi bước có kết quả kỳ vọng và bước đọc ngược; §3 Commission chuẩn |
| Sao lưu | PASS | §11 sao lưu **có kiểm chứng** — không chấp nhận bản sao chưa verify |
| Quay lui | PASS | §13 thủ tục Restore và rollback; §6 nâng cấp và quay lui gói |
| Sự cố | PASS | §7 ma trận sự cố; §15 playbook mở rộng; §14 cây quyết định cho timeout và `UNKNOWN` |
| Leo thang | PASS | §9 điều kiện dừng và §17 Go/Stop/Abort/Hold/Close |
| Audit và bằng chứng | PASS | §8 bằng chứng và bàn giao; §17.1 bản ghi thao tác tối thiểu |
| Bảo vệ dữ liệu | PASS | §11 và §13 nêu rõ dữ liệu nào phải giữ khi quay lui |
| `BLOCKED` có owner/gate | **BLOCKED** | Chưa diễn tập lần nào. Owner: Ops/Release Lead + Core + BE. Ảnh hưởng: thủ tục chưa được kiểm chứng trên thiết bị thật, nên rủi ro sai thao tác khi Commission lần đầu vẫn cao. Gate: `DOC-G4` cho tài liệu, `G6` cho vận hành. Điều kiện mở: có API và runtime Programming trên target, rồi chạy diễn tập §16 và lưu bằng chứng |

Thủ tục trong file này **chưa từng được thực thi**. Runbook đã viết không đồng
nghĩa runbook đã hoạt động.
