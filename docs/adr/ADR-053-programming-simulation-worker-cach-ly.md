# ADR-053: Programming Simulation dùng worker ephemeral cách ly khỏi control path production

- Ngày: 2026-08-24
- Chủ quản: System Architect + Runtime/Security Leads
- Trạng thái: **Proposed — Product Owner đã duyệt scope R3 và admin-only mutation;
  System Architect exact-revision decision/pin PENDING**
- Liên quan: `CR-PROG-PGM02-V22-001` · `SYS-REQ-PROG-116` ·
  `SWR-REQ-PROG-BE-117` · `SWR-REQ-PROG-CORE-118` · `RSK-PROG-023` ·
  [`DDD-SW-PGM02-WORKSPACE-001`](../02_design/software/PROGRAMMING_PGM02_WORKSPACE_DETAILED_DESIGN.md)
  §3–§6/§8–§12 · `VS-PROG-U15`
- Gate: `T59-801` đang REVIEW; `T59-814..817` chỉ là card Candidate
  `NO EXECUTION AUTHORITY`; R3 production code `NO-GO`

## Vấn đề

PGM-02 cần chạy ST/FBD từ Saved Draft để thử virtual input, Watch/Trace và
Run/Pause/Step mà tuyệt đối không có physical output authority. Chạy mô phỏng
trong browser, trong `mkddc-web` hoặc trong process `mkddc-core` production đều
làm mờ failure boundary: lỗi parser/executor, quota hoặc dependency nhầm có thể
ảnh hưởng control loop, Active/LKG hoặc I/O thật.

## Quyết định Candidate

1. Mỗi Simulation session tạo đúng một executable
   `mkddc-programming-sim-worker` **ephemeral**, có lifetime bằng session. Đây
   không phải service control thường trú và không được auto-restore sau reboot.
2. `mkddc-web` sở hữu session metadata, server RBAC, audit, quota, TTL và worker
   supervisor. Viewer/operator/admin được đọc theo object scope; chỉ admin được
   create/run/pause/step/reset/set-speed/set-input/stop.
3. Worker chỉ nhận immutable artifact sinh từ **Saved Draft snapshot** đã Check.
   Dirty browser buffer không được chạy; lỗi trả `PRG-SIM-SAVE-REQUIRED` và
   không spawn process.
4. Worker dùng virtual process image, virtual input image, virtual output image
   và virtual monotonic clock riêng. Nó được phép reuse pure artifact
   loader/executor semantics nhưng **không** được link hoặc mở production SHM,
   device, iobus/output writer, Core lifecycle IPC, singleton runtime state hay
   RETAIN writer.
5. `STEP_CYCLE` lấy một input snapshot, chạy toàn bộ Program đến hạn theo stable
   order, commit output/observation đúng một lần, tăng virtual time theo GCD của
   period được phép rồi về `PAUSED`. Không có step riêng một Program ở v1.
6. Virtual input chỉ dùng `observationId` có trong manifest allowlist, đúng
   source kind/type/unit/range; `OUTPUT/IN_OUT/RETAIN/INTERNAL/COMMAND/OVERRIDE/
   PRODUCTION_WRITER` bị từ chối fail closed.
7. Capability mặc định false và versioned. Partial deploy, worker thiếu/sai
   version hoặc sandbox policy lỗi giữ SIMULATE ở `UNAVAILABLE`; FE không dựng
   simulator thay thế.

## Ranh giới process và resource

```text
Browser
  └── HTTPS → mkddc-web (RBAC/audit/session supervisor)
                  └── private pipe/UDS + peer credential
                        → sim worker per session
                           ├── immutable artifact
                           ├── virtual input/output/process image
                           └── virtual clock + bounded trace

Production mkddc-core → resolver → iobus → MCU/I/O
           ▲
           └── không có IPC/SHM/device/output edge từ sim worker
```

V1 giới hạn một session/controller, idle TTL 900 s, hard TTL 3.600 s, RSS
64 MiB, CPU 25% một core, 10 action/s, 10.000 trace sample, 256 virtual input và
worker command timeout 2 s. Vượt quota/timeout/crash phải chuyển terminal rõ,
reap process/FD/socket và không đổi Active/LKG/runtime counter.

## Phương án không chọn

| Phương án | Lý do không chọn |
|---|---|
| Chạy trong browser/WebAssembly | Không dùng đúng runtime semantics, khó chứng minh no-fake capability và có nguy cơ tạo source of truth thứ hai |
| Chạy trong `mkddc-web` process | Compiler/executor fault/resource exhaustion có thể làm mất API/audit/reconcile; failure boundary không đủ mạnh |
| Chạy như mode trong `mkddc-core` production | Đặt Draft/untrusted workload cạnh RT path và tạo khả năng nối nhầm process image/output/RETAIN |
| Dùng global Virtual Point production | Simulation input có thể thoát sandbox và tác động consumer/Project/logic thật |
| Daemon simulation thường trú | Tăng attack/resource surface và làm session sống qua reboot ngoài product requirement v1 |

## Hệ quả và compatibility

- Cần binary/CMake target, private protocol, supervisor, sandbox policy và
  negative dependency/link gate mới; không sửa semantics compiler/executor để
  tạo một runtime “gần đúng”.
- Store chỉ giữ bounded reconciliation metadata/audit; process image, source
  plaintext, virtual RETAIN và secret không persist. Session cũ sau BE/controller
  reboot là `EXPIRED`, ID không reuse.
- R1 EDIT và R2 LIVE không phụ thuộc worker binary; R3 có feature flag/capability
  riêng. Rollback R3: capability false → reject create → stop/expire → verified
  reap → gỡ policy/binary; không xóa Draft/Revision/Active/LKG/audit.
- Quyết định này không cho phép online force/override, Commission hoặc bất kỳ
  mutation nào trong LIVE.

## Kiểm chứng bắt buộc trước khi Accepted/enable

1. Static/link inspection chứng minh worker không có forbidden dependency.
2. Role-action matrix: viewer và operator gọi bảy action, tổng 14/14 trả 403,
   zero DB/worker mutation và có security audit.
3. Determinism: cùng artifact/input replay 100 lần ở 1×/10×/60× cho output/trace
   hash giống nhau 100/100.
4. Type/unit/range/NaN/overflow và denied source kind đều 422 stable code, prior
   value/sequence giữ nguyên.
5. Quota/TTL/timeout/crash/restart reap hết worker/FD/socket, không leak.
6. Formal target/HIL Test Result đo create/run/step/input/reset/stop/crash/expiry:
   production handle open bị deny; Active/LKG/hash/counter không đổi; AO/DO/relay
   vật lý không đổi.

Host unit test hoặc simulator không thay mục 6.

## Disposition cần ký

| Vai trò | Trạng thái | Điều kiện |
|---|---|---|
| Product Owner | **APPROVED scope R3 + admin-only mutation** | `CR-PROG-PGM02-V22-001`; không phải approval kỹ thuật exact revision |
| System Architect | **PENDING** | review process/forbidden dependency/protocol/lifecycle/resource và pin exact revision/hash |
| Runtime + Security Leads | **PENDING** | threat/fault/resource review; chấp nhận sandbox policy và negative gates |
| Verification/Controls/Safety | **PENDING** | pin fixture/evidence/pass authority cho `VS-PROG-U15` |

ADR chỉ chuyển `Accepted` sau khi các review Candidate hoàn tất. Trạng thái
`Proposed` không cho phép tạo production worker hoặc mở `IMPLEMENT_READY[R3]`.
