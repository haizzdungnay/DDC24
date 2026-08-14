# Bằng chứng corrective Programming Plan 53 trên Foxlinx

> **ID:** `EV-PROG-P5-510`
> **Task:** `TASK-PROG-508..510`
> **Revision:** 1.2
> **Ngày chạy:** 2026-08-13; tái kiểm UC-PROG-03 ngày 2026-08-14
> **Bo đích:** `SOM-DDC-24-foxlinx`, `aarch64`, Buildroot, Web/API `8081`
> **Source:** cây làm việc tại `59f84c89cb5b...-dirty`; **chưa commit/merge**
> **Quyền bằng chứng:** supporting host/target/browser evidence; không phải
> `TR-PROG-*`, HIL hoặc bằng chứng `RELEASE_READY`.

## 1. Phán quyết

Corrective slice đã được build, kiểm thử, deploy và đọc-ngược trên đúng Foxlinx.
Bốn service vẫn `active`; health Core/IO SHM/IO bus/MCU/PLC SHM/Web đều `ok`;
rollback rehearsal về bản trước và tái deploy đúng artifact corrective đều PASS.
Chrome thật trên target xác nhận bốn workspace ở desktop/mobile, không có lỗi
Console hoặc request Programming thất bại. Tám lượt quét axe theo WCAG A/AA
(bốn workspace × hai viewport) không phát hiện vi phạm.

Phán quyết này **không** biến `TASK-PROG-508/509` thành `DONE`: source còn trong
cây làm việc chưa merge, là điều kiện DoD của Plan §6.1. Fixture active hiện tại
không có `VAR_OUTPUT`/binding nên Monitor trả danh sách rỗng đúng contract và UI
khóa Start Trace; chưa có positive trace với biến ánh xạ trên target. Không chạy
Commission mutation mới, output vật lý, HIL, power-cut hoặc usability người thật.

## 2. Gate host trước deploy

| Gate | Kết quả đo trong phiên |
|---|---|
| C++ Release, Modbus/BACnet/HMI ON | build PASS; **1004/1004 CTest PASS** |
| Go Web API | `go vet ./...` sạch; `go test ./... -count=1` PASS mọi package |
| FE Vitest | **64 file / 521 test PASS** |
| FE lint/typecheck/build | PASS; OpenAPI **25 operation**; catalog lỗi **20 public / 99 detail**; FBD mutation **10/10** |
| Playwright Programming + Network QA | **11/11 PASS**: Programming 10/10 trên desktop/mobile + Network QA 1/1; mock contract có ghi rõ, không thay target evidence |
| Accessibility E2E cục bộ | `VS-PROG-028` **2/2 PASS**; bốn workspace × hai viewport, 0 axe violation |

## 3. Artifact, backup và triển khai

Cross-build ARM64 dùng source dirty nêu ở metadata; chuỗi `-dirty` được giữ trong
version read-back để không giả provenance release.

| Thành phần | SHA-256 |
|---|---|
| `mkddc-core` corrective | `15242e744c33cef657af6be9ffcde8948ffddccd1f7d0af3ffa6598c1794b1f0` |
| `mkddc-st-compile` | `edf65c08a85f3a5d5fb2e6c367e48c27edb1412a6058e54cd2f54864ab473cd4` |
| `mkddc-web` corrective | `693c5d9a900f66ba6a7653c2cc616c9798372ab6da8c8ae32757159bdbc79887` |
| gói static `dist.tar` | `0add41784df06e76da504f8df828fd1a9a39ad534daf522b411cf550dcd317a8` |
| `/opt/mkddc-web/dist/index.html` sau cài | `9ae004e10f2dad7f577c5ca197266bb7f981d48112be19da01bbbf3b43704785` |

Backup trước deploy:
`/data/releases/20260813T140646Z-pre-programming-plan53-corrective`.
Static rollback riêng:
`/opt/mkddc-web/dist.rollback.20260813T140646Z`.
Board còn khoảng 11 GiB trước deploy; cờ Programming đã được cấu hình từ lần
deploy `EV-PROG-P5-507`. Không ghi credential, token hoặc secret vào record này.

### 3.1 Transaction và rollback rehearsal

1. Dừng Web/Core theo thứ tự, cài Core/Web/static đúng hash, khởi động và đọc
   health: PASS.
2. Khôi phục binary/static trước corrective từ backup, khởi động lại, kiểm
   service/health/hash: `ROLLBACK_REHEARSAL_PASS`.
3. Cài lại đúng bộ corrective, kiểm hash và health lần cuối:
   `REDEPLOY_PASS`.
4. Trạng thái cuối: `mkddc-iobus`, `mkddc-core`, `mkddc-netcfg`,
   `mkddc-web-pi` đều `active`.

Rollback rehearsal chỉ chứng minh khả năng quay về artifact trước corrective;
không thay cho power-cut, migration state hoặc rollback release có reviewer độc
lập.

## 4. Read-back runtime và Monitor/Trace

Runtime authenticated sau tái deploy:

| Field | Giá trị |
|---|---|
| `controllerId` | `controller-local` |
| `producerState` | `READY` |
| `activeRevisionId` | `1ab7cb9b-b3dc-4744-ab9c-7ac778bb9af7` |
| `taskState` | `RUNNING` |
| `safeState` | `true` |
| Task `main` | period `1000 ms`, budget `199 ms`, `missedDeadline=0`, `overrunCount=0`, `consecutiveOverrun=0` |

`GET /runtime/monitor` trả `200`, `schemaVersion=1.0`, cùng Revision/Task/safe
state và `itemCount=0`. Đây là kết quả đúng: fixture output-free đã Commission ở
`EV-PROG-P5-507` không có Variable Binding, vì vậy UI hiển thị “Revision đang
chạy chưa có biến ánh xạ” và Start Trace bị khóa tại `0/32` biến.

Core log cho thấy lúc khởi động vào `graph_only`, sau đó checkpoint recovery kích
hoạt Task. Revision không có controller/binding nên trigger `no_ctrl=1` giữ
`safeState=true`; Commission UI chặn đúng với thông báo Core chưa READY hoặc đang
ở trạng thái an toàn. Đây là fail-closed mong đợi, không được diễn giải là
Commission sẵn sàng.

Probe Trace selector rỗng trả `400`, xác nhận route và validation trên target.
Positive start/get/stop Trace đã có host test nhưng **chưa chạy trên target** vì
không có biến ánh xạ; không tạo dữ liệu giả để lấp khoảng hở.

## 5. Browser thật trên target

Chrome chạy qua SSH tunnel vào đúng Web/API target có xác thực, không dùng mock:

- viewport desktop `1440×1000` và mobile `390×844`;
- mở Overview, Design với project hiện hữu, Commission deep-link và Runtime /
  Watch;
- mọi request thuộc Programming quan sát được trả `200`; **0 request
  Programming failed**, **0 Console error**, **0 Console warning**, **0 page
  error**;
- axe WCAG A/AA: **8/8 lượt quét, 0 violation**;
- layout desktop/mobile giữ được shell, context bar, editor, readiness cảnh báo,
  Watch empty-state và không render Danger Zone dưới Watch.

Ảnh đã kiểm trực quan:

| Màn hình | Desktop | Mobile 390×844 |
|---|---|---|
| Overview | [ảnh](programming-plan53-corrective/foxlinx-overview-desktop.png) | [ảnh](programming-plan53-corrective/foxlinx-overview-mobile-390x844.png) |
| Design | [ảnh](programming-plan53-corrective/foxlinx-design-desktop.png) | [ảnh](programming-plan53-corrective/foxlinx-design-mobile-390x844.png) |
| Commission | [ảnh](programming-plan53-corrective/foxlinx-commission-desktop.png) | [ảnh](programming-plan53-corrective/foxlinx-commission-mobile-390x844.png) |
| Runtime / Watch | [ảnh](programming-plan53-corrective/foxlinx-watch-desktop.png) | [ảnh](programming-plan53-corrective/foxlinx-watch-mobile-390x844.png) |

Vite dev server trong lượt mock cục bộ có log `ECONNREFUSED` cho API toàn hệ
thống không được mock; chúng không xuất hiện trong lượt target và không được dùng
làm PASS/FAIL cho request Programming.

## 6. Ranh giới release và mục còn mở

| Mục còn mở | Owner | Ảnh hưởng/gate | Điều kiện đóng |
|---|---|---|---|
| Source corrective chưa commit/merge | FE/BE/Core + Dev Lead | `TASK-PROG-508/509` chưa đạt DoD; không nâng `I` | commit/PR/merge thật theo quy trình, chạy lại pin/harness |
| Positive Monitor/Trace có binding trên target | QA + FE/BE/Core | chưa chứng minh row program/actual/owner/priority/quality/freshness và start/get/stop target | tạo fixture có Variable Binding an toàn, read-only; chạy positive/negative và lưu raw output |
| Usability `S5-F` | UX Lead + Product | `VS-PROG-031`, `RELEASE_READY` | ít nhất 5 kỹ thuật viên BMS, fixture chuẩn và đủ `UX-A-01..06` |
| Test Result/HIL/release | Verification + FW/HW/Safety/Release | mọi `T/P/R` vẫn `N`; 0/32 PASS | executor/reviewer độc lập, target/HIL/power/fault đầy đủ và residual acceptance |

Không có blocker SSH/deploy còn lại. Evidence này đóng bước thực thi target của
`TASK-PROG-510`, nhưng Task giữ `VERIFYING` theo dependency/DoD merge và các giới
hạn nêu trên.

## 7. Corrective live audit 1.2 → 1.3

Audit lại endpoint public phát hiện bundle 1.0 còn vỡ mutation trên HTTP vì
`crypto.randomUUID/subtle`, mất query/hash qua login, Restore/RETAIN fail-open,
safe-state thiếu attention, thiếu Export và sai mobile/i18n. Source được sửa,
build production với `VITE_PROGRAMMING_REV_A=1`, deploy atomic và tái kiểm.

| Bằng chứng | Kết quả |
|---|---|
| Static tar SHA-256 cuối | `5e0d5cb8d57e38e22a6caaf7a7750db1b01803901e2e4899eba23e013c79f672` |
| Target `index.html` SHA-256 cuối | `30ee074329685a801abaf468c6aaa5d1eacfecc515128e3483ebdd9d9cab5dbd` |
| Backup / rollback cuối | `/data/releases/20260813T1531Z-pre-programming-fe-live-fix-final`; `/opt/mkddc-web/dist.rollback.20260813T1531Z` |
| Service / health | Web/Core/IObus/netcfg `active`; Core/IO SHM/IObus/MCU/PLC SHM/Web `ok`; journal priority error sau deploy rỗng |
| HTTP live | `isSecureContext=false`, `randomUUID/subtle=undefined`; deep-link giữ đủ query/hash; Save Draft `200` rồi hoàn nguyên `200`; Export `200`; invalid Import `422` theo chủ đích |
| Safety | Runtime safe-state: Restore disabled/không modal; RETAIN disabled vì impact route contract-only; không gửi mutation runtime |
| Mobile | bottom nav đủ bốn workspace; Operation history dạng card; `scrollWidth <= innerWidth` tại 390×844 |
| Accessibility | Overview/Design/Service × desktop/mobile: **6/6 axe scan, 0 violation**; lượt cuối 0 Console error và 0 request failed |

Lượt swap đầu đã tự rollback vì health probe chạy trước khi Web bind. Một bundle
trung gian thiếu cờ FE bị read-back browser bắt được do route Programming bị ẩn;
artifact đó được thay ngay. Không dùng hai bundle trung gian làm bằng chứng cuối.

Ảnh controlled của lượt cuối: [Overview](programming-plan53-corrective/foxlinx-live-fix-overview-desktop.png),
[Design sau hoàn nguyên](programming-plan53-corrective/foxlinx-live-fix-design-restored-desktop.png),
[Service desktop](programming-plan53-corrective/foxlinx-live-fix-service-desktop.png),
[Service mobile](programming-plan53-corrective/foxlinx-live-fix-service-mobile-390x844.png).

Ranh giới không đổi: import invalid `422` là fault case chủ động nên Chromium
ghi một dòng `Failed to load resource`; lượt axe sạch chạy riêng có 0 Console
error. Positive Monitor/Trace có binding, recommission replacement, usability,
HIL/power/fault và reviewer/Test Result độc lập vẫn chưa có.

## 8. Tái kiểm UC-PROG-03 và hoàn nguyên Draft — 2026-08-14

Lượt tái kiểm hẹp trên endpoint public không dùng mock và không gửi mutation
runtime. Kết quả làm mất hiệu lực tuyên bố “UC-03 partial vì chỉ thiếu fixture”
ở audit 1.3:

1. `ST+` trong source tạo Program ST với `document: ''`; các Program mới quan
   sát trên target bắt đầu không có khung `PROGRAM ... END_PROGRAM`.
2. Program hợp lệ được cố ý thêm một token sai, lưu và Check. Check về `FAILED`,
   Active Revision vẫn `1ab7cb9b-b3dc-4744-ab9c-7ac778bb9af7`.
3. Problems chỉ hiện `PRG-ERR-SCOPE-001`/“Giá trị ngoài phạm vi Rev A”, không có
   dòng/cột cho token ở dòng 8.
4. Sau khi xóa token sai, lần lưu tiếp theo hiện conflict; expected/current đều
   `—`. Source review xác nhận seal đã tăng ETag/đổi base nhưng
   `useCheckWorkflow` chỉ giữ `revisionId`.
5. Dùng luồng tải lại concurrency state rồi lưu lại source hợp lệ; Draft được
   hoàn nguyên và Active không đổi. Không Commission, Restore, RETAIN hay output.

Ảnh:

- [Bước 2 hiện tại](programming-plan53-corrective/uc-prog-03-current-step2-desktop.png)
- [Check FAILED, diagnostic thiếu location](programming-plan53-corrective/uc-prog-03-check-failed-before-fix-desktop.png)
- [Conflict sau khi sửa](programming-plan53-corrective/uc-prog-03-etag-conflict-before-fix-desktop.png)
- [Draft hợp lệ đã phục hồi](programming-plan53-corrective/uc-prog-03-draft-restored-after-repro.png)

Phán quyết: **UC-PROG-03 KHÔNG ĐẠT; solution đang là bản tạm để review**. Báo
cáo nguyên nhân/gap/decision PM/CTO:
[`REV-PROG-ASBUILT-GAP-2026-08-14`](../../reviews/PROGRAMMING_AS_BUILT_GAP_REPORT_2026-08-14.md).
