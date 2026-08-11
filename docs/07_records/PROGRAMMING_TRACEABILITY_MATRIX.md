# Ma trận truy vết Programming MK-DDC-24 Rev A

| Thuộc tính | Giá trị |
|---|---|
| ID | `TRACE-PROG-001` |
| Phiên bản | 3.5 |
| Trạng thái | **APPROVED FOR IMPLEMENTATION** — 60 dòng trace + 8 journey + migration 17 UC; `17 DECIDED/0 OPEN`; truy vết hai chiều `32/32` |
| Cập nhật | 2026-08-11 |
| Chủ quản | Verification Lead |
| Người review | Document Control, Product, Architect và tất cả discipline lead |
| Người phê duyệt | Verification Lead + Document Control |

## 0. Đọc nhanh

| Câu hỏi | Trả lời |
|---|---|
| 1. File này dùng để quyết định hoặc triển khai việc gì? | Nối **yêu cầu → user journey → thiết kế → nơi phải sửa code → kịch bản test → bằng chứng → release** cho cả 60 requirement. Dùng để trả lời hai câu: “yêu cầu này ai lo?” và “cái gì hỏng nếu đổi chỗ này?”. |
| 2. Ai phải đọc file này? | Verification Lead và Document Control (chủ quản); mọi discipline lead khi đổi requirement hoặc contract; Release authority trước khi ký. |
| 3. Hệ thống hiện tại đang có gì? | 60/60 requirement có thiết kế, nơi sửa code và kịch bản. `TASK-PROG-200` đã thêm ST/type/IR/source map; `TASK-PROG-201` tại `52dfb57` thêm FBD canonical contract/validator và FE keyboard component. Tổng vẫn **2/60** dòng `I=Y`: `FE-104/SYS-101/NFR-101` mới partial vì component chưa mount, FBD chưa hạ IR/Check/target. `VS-PROG-001/019` có 2 record `BLOCKED`, 30 scenario `NOT_RUN`, **0/32 PASS**; mọi `T/P/R` vẫn `N`. |
| 4. Thiết kế mới thay đổi điều gì? | Không thay nội dung yêu cầu. Nó chuẩn hóa năm trục `D/I/T/P/R`, quy định **ai được đổi trục nào** và **bằng chứng gì cho phép đổi** (§8), cùng quy tắc khi nào một PASS cũ bị vô hiệu hóa. |
| 5. Team phải sửa module/contract nào? | Cột “Source target” ở §6 là **nơi phải tạo hoặc sửa**, không phải tuyên bố code đã có. Khi merge code, chỉ trục `I` được đổi và phải kèm commit, file và symbol cụ thể. |
| 6. Điều gì còn bị chặn? | **Không còn blocker approval cho implementation.** `BE-110` và `CORE-101 I=Y`; 58 dòng `I=N`. Hai Test Result G1 đang `BLOCKED`; toàn bộ `T/P/R` còn `N` cho tới khi workflow E2E đủ acceptance và reviewer độc lập ký. |
| 7. Test hoặc bằng chứng nào chứng minh hoàn tất? | Với bản thân ma trận: 60/60 dòng giải được về ID canonical, không trùng ID, không có dòng vi phạm `P=Y khi T=N` hay `R=Y khi P=N` — kiểm bằng harness ở [`PROG-REV-2026-08-09`](reviews/PROGRAMMING_DESIGN_SET_REVIEW_2026-08-09.md) §2. |

Đọc `DOCUMENTED` cho đúng: nó chỉ nghĩa là **có link thiết kế và test**, không
nghĩa code tồn tại, cũng không nghĩa test đã PASS.

## 1. Quy tắc đọc

Chuỗi bắt buộc:

```text
Product/Requirement → Architecture/Design → Interface/Data/UI
→ Implementation owner → Scenario → Test Result → Release
```

`DOCUMENTED` chỉ nghĩa có link thiết kế/test; không nghĩa code tồn tại hoặc test
PASS. Không có Test Result mới cho suite v0.1, vì vậy evidence production vẫn
`MISSING/RED`.

## 2. Trace theo nhóm requirement

| Requirement | Design owner | Interface/data/UI | Implementation owner | Scenario | Evidence |
|---|---|---|---|---|---|
| `SYS-REQ-PROG-101` | ARCH §3/5; FWSOM §3 | IFSPEC §3/9; DM §3 | BE/Core/FE | VS-003/005/006/007/009/017 | MISSING |
| `SYS-REQ-PROG-102` | ARCH §4 | DM §3.1–3.2; UX §4 | BE/FE | VS-002/019/026 | MISSING |
| `SYS-REQ-PROG-103` | ARCH §4/7 | IFSPEC §6/8; DM §3.9 | BE/Core | VS-004/011 | MISSING |
| `SYS-REQ-PROG-104` | ARCH §8 | OPS §6/7 | BE/Core/Ops | VS-024/030 | MISSING |
| `SYS-REQ-PROG-105` | ARCH §6 | IFSPEC §6/9 | Core/Ops | VS-015 | MISSING |
| `SYS-REQ-PROG-106` | ARCH §9 | IFSPEC §2/3; DM §3.9 | BE/Security | VS-022/023 | MISSING |
| `SYS-REQ-PROG-107` | ARCH §10 | IFSPEC §3; DM §5; OPS §5 | BE/FE/Ops | VS-021/023 | MISSING |
| `SYS-REQ-PROG-108` | ARCH §3 | UX §9 | HMI/FE/QA | VS-028 | MISSING |
| `SWR-REQ-PROG-FE-101..102` | FE §2–3 | UX §3–4 | FE | VS-002/004/008/026/032 | MISSING |
| `SWR-REQ-PROG-FE-103..104` | FE §5 | UX §5 `PGM-02` tab Chương trình | FE/compiler | VS-005/006/028 | MISSING |
| `SWR-REQ-PROG-FE-105..106` | FE §6 | UX §5 `PGM-02` tab Điểm & Ánh xạ và Thực thi; IFSPEC §3 | FE/BE | VS-009/017/018 | MISSING |
| `SWR-REQ-PROG-FE-107..110` | FE §4/7/9 | UX §5 `PGM-03`/`PGM-04`; IFSPEC §6/7 | FE/BE/Core | VS-010/011/019/020/024/026 | MISSING |
| `SWR-REQ-PROG-FE-111..112` | FE §8 | UX §7–10 | FE/QA | VS-022/025/028 | MISSING |
| `SWR-REQ-PROG-FE-113..115` | FE §0.1; UX §5, §16.2–§16.3 | IFSPEC §6.1; UX §22–§24 | FE/BE | VS-011/017/019/022/031 | MISSING |
| `NFR-REQ-PROG-109..110` | UX §14.1; Product Spec §8 | UX §3, §5 | FE/UX/QA | VS-031 | MISSING |
| `SWR-REQ-PROG-BE-101..103` | BE §2–3 | DM §3; IFSPEC §3–5 | BE | VS-001/019/024 | MISSING |
| `SWR-REQ-PROG-BE-104..106` | BE §3–4 | IFSPEC §5–6/8 | BE/Core | VS-004/011/012/013/019 | MISSING |
| `SWR-REQ-PROG-BE-107..110` | BE §5–8 | IFSPEC §2/3/9 | BE/Security | VS-018/021/022/023/024 | MISSING |
| `SWR-REQ-PROG-CORE-101` | FWSOM §2/5 | IFSPEC §8/9 | Core/compiler | VS-005/006/023 | MISSING |
| `SWR-REQ-PROG-CORE-102..103` | FWSOM §4 | ARCH §5 | Core | VS-009/012/016 | MISSING |
| `SWR-REQ-PROG-CORE-104..106` | FWSOM §6–7 | DM §3.10 | Core/Controls | VS-010/014 | MISSING |
| `SWR-REQ-PROG-CORE-107..108` | FWSOM §4 | ARCH §5/8 | Core/Ops | VS-013/015 | MISSING |
| `SWR-REQ-PROG-CORE-109..110` | FWSOM §8–9 | DM §3.10/4 | Core/BE | VS-027/029 | MISSING |
| `FW-REQ-PROG-MCU-101..104` | FWMCU §1–7 | IOP contract; HW §2–5 | FW MCU/iobus | VS-014/030 | MISSING |
| `HW-REQ-PROG-101..103` | HW §2–5 | FWMCU §4–5 | HW/FW/QA | VS-014/030 | MISSING |
| `NFR-REQ-PROG-101..102` | BE §3; FWSOM §3/5 | IFSPEC §5 | Compiler/BE/Core | VS-006/019/023 | MISSING |
| `NFR-REQ-PROG-103` | ARCH §5; FWSOM §4 | OPS §2 | BE/Core/Ops | VS-009/012/013/015 | MISSING |
| `NFR-REQ-PROG-104` | FWSOM §9; FE §4 | IFSPEC §7 | Core/BE/FE | VS-027 | MISSING |
| `NFR-REQ-PROG-105..106` | ARCH §8/9; BE §4/7 | IFSPEC §1/6 | BE/Core/Security | VS-022/024/030 | MISSING |
| `NFR-REQ-PROG-107` | FE §8/10 | UX §8–10 | FE/QA | VS-025/028 | MISSING |
| `NFR-REQ-PROG-108` | ARCH §5/7; FWSOM §7 | FWMCU §4; HW §4–5 | Core/FW/HW/QA | VS-014/030 | MISSING |

## 3. Product/UX proposal crosswalk

| Upstream proposal | Requirement phân bổ | Scenario |
|---|---|---|
| `PRG-BACS-001..005` | SYS-102/103/106/107; FE-101/102 | VS-001/002/004/008/019/021 |
| `PRG-IEC-001..005` | SYS-101; FE-103/104/106; CORE-101/102 | VS-003/005/006/007/009 |
| `PRG-RT-001..010` | SYS-103..105; CORE-102..109; NFR-103/108 | VS-009..016/030 |
| `PRG-PT-001..004` | SYS-101; FE-105; BE-109; CORE-104 | VS-017/018 |
| `PRG-COM-001..006` | SYS-102/103/107; FE-107/108; BE-103/105/106/108 | VS-011/019/020/021 |
| `PRG-SEC-001..005` | SYS-106; BE-102/107/108/110; CORE-101 | VS-022/023/024 |
| `PRG-UX-001..006` | FE-101/102/107/109/111/112 | VS-002/018/025/026/028 |
| `UX-REQ-001..024` | FE-101..112; SYS-108; BE/Core dependencies | VS-002..028 theo UX §6–10 |
| `NFR-PRG-PROP-001..010` | NFR-101..108 | VS-006/009/012/013/014/024/027/028/030 |

## 4. Baseline Product Capability

Các mapping `PC-PROG-001..012 → PR-PROG-001..014 → SYS/SWR/IF/NFR-REQ-PROG-*`
của phiên bản trước vẫn được bảo toàn qua SRS và bảng §2–3. Việc bổ sung design
không đổi bằng chứng production: `VR-PROG-001..013` vẫn `RED` cho tới khi
scenario tương ứng có Test Result được review.

## 5. Coverage và gate

- SRS v0.5: 8 system + 15 FE + 10 BE + 10 Core + 4 MCU + 3 HW + 10 NFR = 60,
  tất cả có design owner và scenario group.
- Proposal: 7 nhóm `PRG-*`, 24 `UX-REQ-*`, 10 NFR proposal có crosswalk.
- Scenario: `VS-PROG-001..032`, không có ID trùng requirement/error.
- Truy vết **hai chiều** trên đúng bảng máy đọc được: `32/32` kịch bản đều xuất
  hiện ở cột “Scenario” của ít nhất một dòng §6, và mọi kịch bản dẫn ở §6 đều
  tồn tại trong `VVP-PROG-001`. Kiểm bằng lệnh ở §8.1.
- Test Result: `2/32` record (`VS-001/019` đều `BLOCKED`), `0/32 PASS`.
- Release gate: **RED / NO-GO**.

## 6. Trace chi tiết từng requirement

Status dùng năm trục: `D` documented, `I` implemented, `T` tested, `P` passed,
`R` released. Hiện mọi dòng `D=YES`; `BE-110` và `CORE-101 I=YES`, 58 dòng còn lại
`I=NO`; toàn bộ `T/P/R=NO` cho tới khi có Test Result/release hợp lệ.
Source target là vị trí phải tạo/sửa, không phải claim code đã có.

Alias trong cột Requirement được chuẩn hóa như sau: `SYS-nnn` =
`SYS-REQ-PROG-nnn`; `FE/BE/CORE-nnn` = `SWR-REQ-PROG-FE/BE/CORE-nnn`;
`MCU-nnn` = `FW-REQ-PROG-MCU-nnn`; `HW-nnn` = `HW-REQ-PROG-nnn`; `NFR-nnn` =
`NFR-REQ-PROG-nnn`. Alias chỉ giúp bảng gọn; canonical ID trong SRS là authority.

| Requirement | Design/control + risk | Source target | Scenario | D/I/T/P/R |
|---|---|---|---|---|
| `SYS-101` | ARCH; LANG; CTRL; RSK-006/010 | `95585e7`: profile; `52dfb57`: FBD schema/golden/validator + FE reducer/component; FBD→IR, Point/Task, BE/route/runtime E2E còn thiếu | 003/005/006/007/009/017 | Y/N/N/N/N |
| `SYS-102` | DM; UX; FE; BE; RSK-007/008 | `312f357`: Draft/Revision store tách biệt; `TR-PROG-019-20260811-001 BLOCKED`: Check/API/UI và active-output integration còn thiếu | 002/019/026 | Y/N/N/N/N |
| `SYS-103` | LIFE; ART; IFSPEC; RSK-003/007 | `4a1e9f5`: catalog/mapping lỗi lifecycle; Core coordinator + BE operation còn thiếu | 004/011 | Y/N/N/N/N |
| `SYS-104` | ARCH; LIFE; OPS; RSK-002/005 | `51fe515`: Core IPC no-mutation skeleton; `e9707b4`: reconnect/no-replay client; Core runtime + service package còn thiếu | 024/030 | Y/N/N/N/N |
| `SYS-105` | CTRL; LIFE; RSK-001 | `4a1e9f5`: mã lỗi cross-layer; bootstrap/ScanLoop/resolver còn thiếu | 015 | Y/N/N/N/N |
| `SYS-106` | SEC; BE; IFSPEC; RSK-012/015 | `312f357`: audit atomic/hash-chain/sanitize cho store command; mọi API reject và lifecycle terminal audit còn thiếu | 022/023 | Y/N/N/N/N |
| `SYS-107` | SEC; BE; OPS; RSK-011 | bundle service/UI | 021/023 | Y/N/N/N/N |
| `SYS-108` | UX; FE; HMI boundary | Web routes + HMI route inspection | 028 | Y/N/N/N/N |
| `FE-101` | UX; FE | `features/programming/routes/layout` | 002/028/032 | Y/N/N/N/N |
| `FE-102` | UX; FE; LIFE; RSK-007 | ProgrammingContext/overview | 002/004/008/026 | Y/N/N/N/N |
| `FE-103` | LANG; UX; FE | editor/problems | 003/006 | Y/N/N/N/N |
| `FE-104` | LANG; UX; FE | `52dfb57`: `features/programming/fbd` có model/validator, registry 11 command, reducer history 50/read-only và component keyboard; chưa mount `PGM-02`, chưa Draft API/browser E2E | 005/006/028 | Y/N/N/N/N |
| `FE-105` | CTRL; FE; IFSPEC; RSK-010 | mapping/point catalog client | 017/018 | Y/N/N/N/N |
| `FE-106` | CTRL; FE | task UI/API model | 009 | Y/N/N/N/N |
| `FE-107` | LIFE; UX; FE; RSK-007 | `TR-PROG-019-20260811-001 BLOCKED`: check/commission reducer chưa implement | 011/019/024/026 | Y/N/N/N/N |
| `FE-108` | CTRL; UX; FE; RSK-004 | runtime/override view | 010/020 | Y/N/N/N/N |
| `FE-109` | IFSPEC; FE; BE; RSK-010 | runtime/events/freshness | 018/026/027 | Y/N/N/N/N |
| `FE-110` | IFSPEC; FE; BE; RSK-008/014 | `4a1e9f5`: generated error catalog/client sanitize fail-safe; Draft reducer/conflict flow còn thiếu | 024 | Y/N/N/N/N |
| `FE-111` | UX; FE | i18n/a11y/styles | 025/028 | Y/N/N/N/N |
| `FE-112` | UX; FE | Problems vs alarm adapter | 019/028 | Y/N/N/N/N |
| `FE-113` | UX §5 PGM-03; FE; LIFE; RSK-007 | `TR-PROG-019-20260811-001 BLOCKED`: acknowledgement + impact reducer chưa implement | 011/019/031 | Y/N/N/N/N |
| `FE-114` | UX §5 PGM-04, §22 DangerZone; SEC; RSK-012 | `runtime/service` danger zone + RequireRole | 022/031 | Y/N/N/N/N |
| `FE-115` | UX §5 PGM-02, §16.2; DM; IFSPEC | `design/mapping` filter + point catalog client | 017/031 | Y/N/N/N/N |
| `BE-101` | DM; BE | `312f357`: store + migration/backup; `TR-PROG-001-20260811-001 BLOCKED`: tag/import/export/app wiring/restart E2E còn thiếu | 001/019 | Y/N/N/N/N |
| `BE-102` | DM; IFSPEC; BE; RSK-008 | `312f357`: Draft ETag/CAS và operation idempotency; Draft mutation idempotency/API service còn thiếu | 024 | Y/N/N/N/N |
| `BE-103` | LANG; BE; IFSPEC | `TR-PROG-019-20260811-001 BLOCKED`: check/compiler worker chưa implement | 003/006/019 | Y/N/N/N/N |
| `BE-104` | LANG; SEC; BE; RSK-005 | compiler sandbox/queue | 006/012/013 | Y/N/N/N/N |
| `BE-105` | DM; BE | `TR-PROG-019-20260811-001 BLOCKED`: revision diff/manifest/aggregate chưa implement | 019 | Y/N/N/N/N |
| `BE-106` | LIFE; IFSPEC; BE; RSK-007/008 | `e9707b4`: IPC Call/Reconcile; `312f357`: durable operation intent/idempotency/audit; worker, terminal state và stage/activate/read-back còn thiếu | 004/011/024 | Y/N/N/N/N |
| `BE-107` | SEC; BE; RSK-012 | authz handler+service/audit | 022 | Y/N/N/N/N |
| `BE-108` | SEC; BE; RSK-011 | bundle quarantine/import/export | 021/023 | Y/N/N/N/N |
| `BE-109` | CTRL; IFSPEC; BE; RSK-010 | runtime read model/events | 018/020/026 | Y/N/N/N/N |
| `BE-110` | IFSPEC; BE; RSK-014 | `9917e3b`/`81080f8`/`efbed2d`: OpenAPI, handler, generated TS; `51fe515`/`e9707b4`: IPC; `4a1e9f5`: catalog lỗi/HTTP canonicalize/sanitize | 019/024 | Y/Y/N/N/N |
| `CORE-101` | LANG; ART; SEC; RSK-006 | `95585e7`: profile/serializer/loader; `8d58efa` + `a638470`: ST/type/source map; `52dfb57`: FBD canonical validator/golden/manifest/fuzzer non-RT. Core requirement đã I=Y từ foundation; FBD lowering/worker/target evidence còn mở | 005/006/023 | Y/Y/N/N/N |
| `CORE-102` | CTRL; FWSOM; RSK-002 | ScanLoop/task/process image | 009/015/016 | Y/N/N/N/N |
| `CORE-103` | ART; FWSOM; RSK-005/006 | Core build/runtime instrumentation | 012 | Y/N/N/N/N |
| `CORE-104` | CTRL; FWSOM; RSK-001/004 | process image/PriorityResolver | 010/014/020 | Y/N/N/N/N |
| `CORE-105` | CTRL; FWSOM; RSK-004 | PID library/runtime | 010/014 | Y/N/N/N/N |
| `CORE-106` | CTRL; LIFE; RSK-003/004 | output staging/safe swap | 011/014 | Y/N/N/N/N |
| `CORE-107` | CTRL; FWSOM; RSK-005 | Task fault/metrics | 013 | Y/N/N/N/N |
| `CORE-108` | CTRL; FWSOM; RSK-002 | base-step/watchdog health | 009/015 | Y/N/N/N/N |
| `CORE-109` | LIFE; FWSOM; RSK-009 | retain manager/store | 029/030 | Y/N/N/N/N |
| `CORE-110` | FWSOM; FE; IFSPEC | monitor/trace ring/events | 027 | Y/N/N/N/N |
| `MCU-101` | FWMCU; ARCH | MCU app/IOP/BSP | 030 | Y/N/N/N/N |
| `MCU-102` | FWMCU; HW; RSK-003/013 | timeout/safe HAL | 014/030 | Y/N/N/N/N |
| `MCU-103` | FWMCU | IOP sequence/cache | 030 | Y/N/N/N/N |
| `MCU-104` | FWMCU; HW | AO config/actuation/read-back | 014/030 | Y/N/N/N/N |
| `HW-101` | HW; FWMCU; RSK-013 | schematic/BOM/test fixture | 014/030 | Y/N/N/N/N |
| `HW-102` | HW; CTRL; RSK-003/004 | AO/DO safe path | 010/014/030 | Y/N/N/N/N |
| `HW-103` | HW; FWMCU; RSK-002/013 | power/reset/watchdog domain | 015/030 | Y/N/N/N/N |
| `NFR-101` | LANG; ART; DM | `95585e7` + `8d58efa` + `a638470`: profile/source/artifact bounds; `52dfb57`: FBD size/capacity guard, contract mutation và ASan fuzz 50.000 input; BE Check/sandbox, FBD lowering và target OOM acceptance còn thiếu | 006/023 | Y/N/N/N/N |
| `NFR-102` | LANG; BE; RSK-005 | compiler benchmark/sandbox | 006/013/019 | Y/N/N/N/N |
| `NFR-103` | CTRL; FWSOM; RSK-002/005 | base-step/task/load metrics | 009/012/013/015 | Y/N/N/N/N |
| `NFR-104` | FWSOM; FE; IFSPEC | trace/monitor buffers | 027 | Y/N/N/N/N |
| `NFR-105` | LIFE; FE; BE | `e9707b4`: reconnect + reconcile không replay mutation; target continuity/fault injection còn thiếu | 024/026/030 | Y/N/N/N/N |
| `NFR-106` | DM; SEC; BE; RSK-008/012 | `312f357`: single-writer transaction, ETag, idempotency, audit sanitize/hash-chain; route/service authz và latency/target evidence còn thiếu | 022/024 | Y/N/N/N/N |
| `NFR-107` | UX; FE | i18n/a11y/responsive | 025/028 | Y/N/N/N/N |
| `NFR-108` | CTRL; FWSOM; MCU; HW; RSK-003 | nonblocking swap/IOP/HIL | 014/030 | Y/N/N/N/N |
| `NFR-109` | UX §14.1; FE; Product Spec §8.1 | tám journey FE end-to-end | 031 | Y/N/N/N/N |
| `NFR-110` | Product Spec §8.3; UX; VVP | bảng điểm heuristic (kiểm tra thiết kế) | 025/031 | Y/N/N/N/N |

Tên rút gọn map: `LANG=DDD-LANG-PROG-001`, `ART=IFSPEC-ART-PROG-001`,
`CTRL=DDD-CTRL-PROG-001`, `LIFE=DDD-LIFE-PROG-001`, `SEC=DDD-SEC-PROG-001`,
`FE/BE/FWSOM/FWMCU/HW/UX/DM/IFSPEC/ARCH/OPS` là ID trong Design Index. Scenario
`001` nghĩa `VS-PROG-001`.

## 7. Coverage, link integrity và evidence update rule

| Coverage | Current |
|---|---:|
| Requirement có design/control | 60/60 = 100% documented |
| Requirement có source target | 60/60 = 100% planned |
| Requirement có scenario | 60/60 = 100% specified |
| Requirement implemented end-to-end | 2/60 confirmed (`BE-110`, `CORE-101`) |
| Scenario có Test Result record | 2/32 (`BLOCKED`); PASS 0/32 |
| Requirement passed/released | 0/60 |

Khi code merge, chỉ cột `I` được đổi và phải có commit/file/class/function. Khi
test chạy, thêm Test Result ID/hash rồi đổi `T`; chỉ reviewer ký PASS mới đổi `P`.
Release manifest/provenance và GO mới đổi `R`. Requirement/design/contract/source/
board change invalidates downstream Test Result theo VVP; không giữ `P` cũ.

Link checker phải xác nhận mọi path/anchor/ID; duplicate ID hoặc missing section
là finding P1. Bảng nhóm §2 vẫn dùng để đọc nhanh, bảng §6 là authority granularity.

## 8. Quy tắc cập nhật một dòng trace

| Trục | Bằng chứng cho phép đổi `N→Y` | Ai xác nhận | Điều kiện hạ lại `Y→N` |
|---|---|---|---|
| D | requirement + design section + risk/scenario link hợp lệ | Document Control + design owner | baseline/design đổi hoặc link đứt |
| I | commit merged, exact file/symbol, build/package hash | code owner + reviewer | revert/feature disabled/incompatible change |
| T | Test Result current đúng requirement/commit/target | executor + QA | result invalidated hoặc coverage thiếu |
| P | mọi acceptance PASS, no open blocking defect/waiver | independent reviewer | regression/finding/risk reopened |
| R | release manifest, rollout scope, GO authority | Release + Product + QA | rollback/withdraw/release revoked |

Update phải trong cùng change set với SRS/design/risk/VVP liên quan. Script/check
phải phát hiện canonical ID thiếu/trùng, scenario ngoài `001..032`, `P=Y` khi
`T=N`, `R=Y` khi `P=N`, evidence path thiếu và alias không giải được. Không sửa
chỉ số tổng bằng tay trước khi **cả 60 dòng** ở §6 được kiểm lại.

### 8.1 Lệnh kiểm truy vết hai chiều

Phép kiểm ở §5 phải chạy lại được, không dựa vào đọc mắt. Lệnh dưới đây giải
alias của §6 về ID canonical trong SRS, rồi đối chiếu tập kịch bản của §6 với
`VVP-PROG-001`:

```bash
python3 scripts/trace_bidirectional_check.py
```

Ba điều kiện `PASS`: `60/60` alias giải được và khớp SRS; `0` requirement thiếu
dòng §6; `0` kịch bản `VS-PROG-*` mồ côi theo cả hai chiều. Lệnh trả exit code,
dùng được trong CI cùng `scripts/docs_iso_harness.py`.

## 9. Blocker, revision và phê duyệt

| Blocker | Owner | Điều kiện mở |
|---|---|---|
| 17 decision `DECIDED`; baseline approved | Product + discipline authority + Document Control | **Không còn blocker implementation** theo `AUTH-PROG-2026-08-11-03` |
| Source Target chưa implement end-to-end | Dev Leads | commit/build mapping per requirement |
| Test Result PASS 0/32; 2 record `BLOCKED` | QA + discipline leads | hoàn tất workflow E2E, rerun và independent review theo VVP |

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| 2.0 | 2026-08-09 | Trace nhóm SRS/proposal tới 30 scenario, evidence RED |
| 2.1 | 2026-08-09 | Thêm 55 dòng requirement-level, 5 design lõi, source target, D/I/T/P/R và evidence rule M3 |
| 2.2 | 2026-08-09 | Bổ sung canonical requirement alias, bằng chứng/authority cho từng trục D/I/T/P/R và rule inconsistency/invalidation; chuyển Detailed Draft chờ review |
| 2.3 | 2026-08-09 | Thêm mục Đọc nhanh và phụ lục tự kiểm cổng M3 loại Traceability; ghi kết quả kiểm máy 0 vi phạm |
| 2.4 | 2026-08-09 | Amendment A1: thêm 5 dòng requirement (`FE-113/114/115`, `NFR-109/110`) nâng tổng lên 60; thêm §10 trace tám journey `UJ-PROG-*` và bảng trạng thái migration 17 `UC-PROG-*`; cập nhật scenario lên 32 |
| 2.5 | 2026-08-10 | Đóng finding consumer review `F-CR-03/07/08`: bổ sung `VS-PROG-032` vào dòng `FE-101` và `VS-PROG-008` vào dòng `FE-102` để chiều xuôi requirement→scenario đủ `32/32`; thêm §8.1 lệnh kiểm hai chiều `scripts/trace_bidirectional_check.py`; sửa số đếm cũ `55 dòng` thành `60 dòng`; đổi phụ lục tự kiểm từ `§10` trùng số sang `§11` |
| 2.6 | 2026-08-10 | Ghi trạng thái authority sau `AUTH-PROG-2026-08-10-01`: `OD-PROG-003/010/013` DECIDED, 14 mục còn OPEN, 0 CLOSED; Product/Architect `ACCEPT` không đổi các trục `I/T/P/R` và không thay Verification/Document Control approval |
| 2.7 | 2026-08-11 | Ghi `AUTH-PROG-2026-08-11-03`: 17/17 decision `DECIDED`, baseline phê duyệt cho implementation, Verification/Document Control/discipline signature `WAIVED FOR IMPLEMENTATION`; giữ trung thực `I/T/P/R=N` và 0/32 Test Result cho tới khi có code/evidence |
| 2.8 | 2026-08-11 | `TASK-PROG-100` hoàn tất source contract: nâng riêng `BE-110` thành `I=Y` với commit/file/symbol và golden payload Go/TS; `FE-110` và `NFR-106` vẫn `I=N` vì Draft reducer, concurrency transaction và audit chưa thuộc lát cắt này. Không tạo Test Result; `T/P/R` giữ `N`, release giữ RED |
| 2.9 | 2026-08-11 | `TASK-PROG-101` hoàn tất IPC v1: bổ sung source commit cho `BE-110`; ghi phần đã có của `SYS-104`, `BE-106`, `NFR-105` nhưng giữ `I=N` vì chưa có operation worker/durable transaction/Core runtime package/target fault injection. Không tạo Test Result; tổng `I=Y` giữ 1/60 và mọi `T/P/R=N` |
| 3.0 | 2026-08-11 | `TASK-PROG-102` hoàn tất profile/artifact/loader foundation: nâng `CORE-101 I=Y` theo commit `95585e7`; ghi partial cho `SYS-101/NFR-101` nhưng giữ `I=N` vì FBD/type target/BE/FE/Check/target acceptance còn thiếu. Không tạo Test Result; tổng `I=Y` thành 2/60 và mọi `T/P/R=N` |
| 3.1 | 2026-08-11 | `TASK-PROG-103` hoàn tất catalog lỗi ba lớp tại `4a1e9f5`: bổ sung source cho `BE-110`, ghi partial `SYS-103/105` và `FE-110` nhưng giữ `I=N` vì lifecycle/ScanLoop/Draft reducer chưa có. Tổng `I=Y` giữ 2/60; không tạo Test Result và mọi `T/P/R=N` |
| 3.2 | 2026-08-11 | `TASK-PROG-104` hoàn tất source store tại `312f357`: ghi partial cho SYS-102/106, BE-101/102/106 và NFR-106 nhưng giữ `I=N` vì chưa wiring/service/compiler/terminal operation/target. Tổng `I=Y` giữ 2/60; 0/32 Test Result và mọi `T/P/R=N` |
| 3.3 | 2026-08-11 | `TASK-PROG-105` khóa join sáu contract/deploy/rollback tại `30a068b`; tạo hai record `VS-001/019` verdict `BLOCKED` để ghi đúng phần E2E còn thiếu. Tổng `I=Y` giữ 2/60, 0/32 PASS và mọi `T/P/R=N` |
| 3.4 | 2026-08-11 | `TASK-PROG-200` hoàn tất ST subset/type/source map host tại `8d58efa` + `a638470`; bổ sung source cho `CORE-101` và partial `NFR-101`. Tổng `I=Y` giữ 2/60 vì FBD/worker/target E2E còn thiếu; không tạo Test Result, 0/32 PASS và mọi `T/P/R=N` |
| 3.5 | 2026-08-11 | `TASK-PROG-201` hoàn tất FBD canonical producer/validator + FE keyboard component tại `52dfb57`; bổ sung source partial cho SYS-101/FE-104/NFR-101 và source FBD cho CORE-101. Tổng `I=Y` giữ 2/60 vì lowering/route/API/target E2E còn thiếu; không tạo Test Result, 0/32 PASS và mọi `T/P/R=N` |

| Vai trò | Trạng thái | Bằng chứng |
|---|---|---|
| Verification + Document Control + discipline leads | **WAIVED FOR IMPLEMENTATION** | review hậu kiểm và evidence theo task |
| Verification Lead + Document Control | **WAIVED FOR IMPLEMENTATION** | không chặn cập nhật trục `I`; Test Result vẫn cần evidence thật |

## 10. Trace lớp user journey và migration 17 use case

Chuỗi đầy đủ sau Amendment A1:

```text
Product Requirement → UJ-PROG-* → Requirement (SRS) → Design/UI → Source target
→ Scenario (VS-PROG-*) → Test Result → Release
```

### 10.1 Tám journey

| Journey | Workspace | Requirement chính | Design | Scenario | Evidence |
|---|---|---|---|---|---|
| `UJ-PROG-01` | `PGM-01` | SYS-108; FE-101/102/109 | UX §3, §5, §16.1; FE §2 | VS-001/002/026/031 | MISSING |
| `UJ-PROG-02` | `PGM-02` tab Chương trình | FE-101/103/104; CORE-101 | UX §5, §16.2; LANG §4–§5 | VS-003/005/006/007/031 | MISSING |
| `UJ-PROG-03` | `PGM-02` tab Điểm & Ánh xạ | FE-105/115; BE-109 | UX §16.2; DM §3.5 | VS-017/018/031 | MISSING |
| `UJ-PROG-04` | `PGM-02` tab Thực thi | FE-106; CORE-102/108 | UX §5; CTRL §3 | VS-009/016/031 | MISSING |
| `UJ-PROG-05` | `PGM-03` giai đoạn Kiểm tra | FE-107/112; BE-103/104/105 | UX §5, §16.3; BE §3 | VS-006/019/031 | MISSING |
| `UJ-PROG-06` | `PGM-03` giai đoạn Vận hành | SYS-103; FE-107/113; BE-106; CORE-106 | UX §16.3; LIFE §5–§7 | VS-004/011/014/015/020/029/031 | MISSING |
| `UJ-PROG-07` | `PGM-04` Runtime, Theo dõi | FE-108/109; BE-109; CORE-110 | UX §16.4; FWSOM §9 | VS-010/013/018/027/031 | MISSING |
| `UJ-PROG-08` | `PGM-04` Phiên bản & Bảo trì | SYS-107; FE-114; BE-108; CORE-109 | UX §16.4; LIFE §8–§9; SEC §8 | VS-011/021/023/029/031 | MISSING |

Bốn requirement mới của Amendment A1 gắn journey như sau: `FE-113` → `UJ-PROG-06`;
`FE-114` → `UJ-PROG-08`; `FE-115` → `UJ-PROG-03`; `NFR-109` và `NFR-110` phủ cả
tám journey qua `VS-PROG-031`. `VS-PROG-032` phủ chuyển hướng route của `FE-101`.

### 10.2 Trạng thái 17 use case sau migration

Không ID nào bị xóa. Đặc tả chi tiết vẫn ở
[UX §17](../04_uiux/PROGRAMMING_UI_UX_DESIGN.md); bảng dưới đây là trace.

| UC | Trạng thái | Thuộc về | Scenario giữ nguyên |
|---|---|---|---|
| `UC-PROG-01` | MERGED | `UJ-PROG-01` | VS-001/026 |
| `UC-PROG-02` | MERGED | `UJ-PROG-02` | VS-008 |
| `UC-PROG-03` | MERGED | `UJ-PROG-02` | VS-005/006 |
| `UC-PROG-04` | MERGED | `UJ-PROG-02` | VS-005/006/028 |
| `UC-PROG-05` | MERGED | `UJ-PROG-03` | VS-017/018 |
| `UC-PROG-06` | MERGED | `UJ-PROG-05` | VS-006/019 |
| `UC-PROG-07` | MERGED | `UJ-PROG-04` | VS-009 |
| `UC-PROG-08` | MERGED | `UJ-PROG-06` | VS-011/015/019/029 |
| `UC-PROG-09` | SCENARIO `SC-OP-FAILED` | `UJ-PROG-05`, `UJ-PROG-06` | VS-011/019 |
| `UC-PROG-10` | SCENARIO `SC-CORE-DEGRADED` | mọi journey | VS-026/030 |
| `UC-PROG-11` | MERGED | `UJ-PROG-08` | VS-011 |
| `UC-PROG-12` | MERGED | `UJ-PROG-07` | VS-013/014/027 |
| `UC-PROG-13` | SCENARIO `SC-RETAIN-RESET` | `UJ-PROG-06`, `UJ-PROG-08` | VS-015/029 |
| `UC-PROG-14` | ROADMAP | ngoài Rev A, gắn `OD-PROG-017` | VS-003 (kiểm không có đường vào) |
| `UC-PROG-15` | ROADMAP | ngoài Rev A | VS-025 (kiểm không hứa hẹn) |
| `UC-PROG-16` | MERGED | `UJ-PROG-07` | VS-013/027 |
| `UC-PROG-17` | MERGED | `UJ-PROG-08` | VS-021/023 |

Kiểm đếm: 12 `MERGED` + 3 `SCENARIO` + 2 `ROADMAP` = 17. **Không** scenario nào
bị mất trong quá trình gộp: mọi `VS-PROG-*` từng gắn với một UC vẫn còn được gắn
qua journey hoặc qua kịch bản xuyên suốt tương ứng.

## 11. Phụ lục — Tự kiểm cổng M3 (loại: Traceability)

| Cổng | Kết quả | Bằng chứng trong file / lý do |
|---|---|---|
| Mọi link trỏ tới ID hoặc mục có thật | PASS | harness: local link missing `0`, anchor missing `0`; §6 alias giải được về ID canonical trong SRS |
| Không trùng ID | PASS | 60 dòng requirement duy nhất; 8 `UJ-PROG-*`; 17 `UC-PROG-*`; harness `duplicate doc ID = 0` |
| Phân biệt planned/documented/implemented/tested/passed/released | PASS | §6 năm trục `D/I/T/P/R`; §1 nêu rõ `DOCUMENTED` **không** nghĩa code tồn tại |
| Coverage requirement | PASS | §7: 60/60 có thiết kế, 60/60 có source target, 60/60 có kịch bản; §10 phủ 8 journey và 17 UC; §5 và §8.1: `32/32` kịch bản có đường về requirement |
| Bằng chứng cho phép đổi trạng thái | PASS | §8 quy định cho từng trục: ai xác nhận và điều kiện hạ ngược `Y→N` |
| Quy tắc vô hiệu hóa | PASS | §7 và §8: đổi requirement/design/contract/source/board làm mất hiệu lực Test Result phía dưới; không giữ `P` cũ |
| Kiểm tính nhất quán tự động | PASS | §8 liệt kê các phép kiểm; đã chạy: thiếu/trùng ID canonical, kịch bản ngoài `001..032`, `P=Y` khi `T=N`, `R=Y` khi `P=N` — vi phạm `0` |
| Trạng thái bằng chứng trung thực | PASS | §5 và §7: 2/32 record `BLOCKED`, 0/32 PASS, 0/60 passed, release gate `RED / NO-GO` |
| Quyền implementation | **PASS** | §9: baseline approved, 17/17 decision `DECIDED`, chữ ký còn thiếu được miễn cho implementation. Source/Test Result chưa có là công việc cần thực hiện, không phải blocker quyền viết code |

Ma trận này theo dõi trạng thái; nó **không** tạo ra bằng chứng.
