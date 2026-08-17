# Review cấu hình UI theo bảng đấu nối AHU — bác bỏ SIG-001/002, vá 6 lỗi FE thật

| Thuộc tính | Giá trị |
|---|---|
| ID | `AHU-WIRING-UI-CONFIG-REVIEW-2026-08-17` |
| Tham chiếu nguồn | Báo cáo QA "Cấu hình UI theo bảng đấu nối AHU" (`FAKE-MCU-AHU-WIRING-2026-08-14`), nhận trực tiếp trong phiên, liệt kê 17 issue |
| Board verify | `http://mekong-fac.ddns.net:8082` (`SOM-DDC-24-foxlinx`), firmware `0.1.0-be-b6c` |
| Ngày | 2026-08-17 |
| Trạng thái | **HOÀN TẤT** — review + vá code + dọn dữ liệu board + deploy + verify lại |

## 1. Vì sao tài liệu này tồn tại

Báo cáo QA gốc liệt kê 17 issue, đứng đầu là **SIG-001** (P0 Critical): "Quality
badge hiển thị ⊘ BAD cho tất cả kênh NTC10K mặc dù giá trị nhiệt độ đọc được
hợp lệ". Trước khi cử Firmware team điều tra `io_scaling.cpp`, review này verify
trực tiếp trên chính board mà báo cáo QA đã test — và phát hiện **claim này
sai**. Tài liệu ghi lại bằng chứng đối chiếu, để không ai lặp lại việc điều tra
một bug không tồn tại.

## 2. SIG-001/SIG-002 — bác bỏ bằng dữ liệu sống

Gọi `POST /api/v1/auth/login` rồi `GET /api/v1/points` nhiều lần liên tiếp trên
board thật (không chỉ đọc code):

| Kênh | Báo cáo QA nói | Đo thật 2026-08-17 06:53 UTC | Đối chiếu công thức `fake_mcu.cpp` |
|---|---|---|---|
| UI-01 SAT | ~29.8°C, ⊘ BAD | **13.89°C, `good`** | `sim_sat_c()` = 14±0.5°C — khớp |
| UI-02 RAT | ~30.3°C, ⊘ BAD | **24.44°C, `good`** | `sim_rat_c()` = 24±0.5°C — khớp |
| UI-03 OAT | ~29.5°C, ⊘ BAD | **29.90°C, `good`** | `sim_oat_c()` = 30±2°C — khớp giá trị, quality GOOD chứ không BAD |
| UI-04 MAT | ~30.0°C, ⊘ BAD | **24.44°C, `good`** | AO-02=0% ⇒ MAT=RAT theo `sim_mat_c()` — khớp |
| UI-05 DSP | ~185 Pa, dao động liên tục | **~0.0000745 Pa, đứng yên qua 5 lần đo/8s** | `dsp_frac=fan_frac²`, AO-01=0% ⇒ hằng số, công thức không có nhiễu |

Tự tính lại round-trip `raw_from_ntc10k_temp()` ↔ `ntc_resolve_temp()/ntc_resistance_from_adc()`
cho baseline 14/24/30°C — toán khớp tuyệt đối, không NaN/saturation trong dải
13–32°C. **Kết luận: SIG-001 và SIG-002 sai, không sửa `io_scaling.cpp`.**

Vấn đề cold-end saturation THẬT (khác SIG-001, dưới +3°C, đã ghi nhận trước ở
`FAKE_MCU_AHU_WIRING_2026-08-14.md` §9) vẫn còn đó — chờ HW xác nhận
`VEXC`/pull-up thật khi PCB Rev A layout xong, không sửa mù được.

## 3. Claim FE sai (báo cáo QA không khớp build đang chạy)

| ID | Báo cáo QA nói | Thực tế code (`InputsPage.tsx`, PR #? Phase 1 redesign 2026-08-14) |
|---|---|---|
| FE-003 | Sensor Profile dropdown ẩn, phải scroll/tìm | Tự động hiện ngay dưới radio "Resistance" (`ElectricalModeTab`), không cần scroll — xác nhận cả code lẫn ảnh chụp board 2026-08-14 |
| FE-004 | Thiếu đơn vị Pa/ppm | `engineeringUnitLabel()` đã có Pa/ppm từ lâu; UI-05/UI-07 trên board đang **dùng** hai unit này |
| FE-009 | Không có validation cho Label | `validatePointName()` đã chặn control-char, rỗng, >64 ký tự |

Bảng tiến độ §1.1 báo cáo QA (6/16, AO 0%, DO 0%) cũng thấp hơn thực tế tại
thời điểm review: `io-bundle` revision 16 đã có UI-01..07 cấu hình đầy đủ,
UI-08/09 đúng electrical mode, AO-01..04 đã đúng mode `0-10V` — chỉ thiếu tên
mô tả.

## 4. Lỗi FE thật — đã sửa

| ID | Vấn đề | Sửa | File |
|---|---|---|---|
| FE-001 | `StatusBadge` không tooltip giải thích BAD | Thêm `title` dùng `point.qualityReason` có sẵn từ API | `StatusBadge.tsx`, `InputsPage.tsx` (`ChannelHeader`) |
| FE-002 | Channel list không có status indicator | Thêm `QualityDot` (chấm màu + tooltip) mỗi kênh | `StatusBadge.tsx` (mới), `InputsPage.tsx` |
| FE-005 | Value/Raw/Updated cùng cỡ chữ 1 hàng | Value `text-xl` nổi bật, Raw/Updated `text-xs` | `InputsPage.tsx` (`ChannelHeader`) |
| FE-006 | Nút Save chỉ ở góc trên, xa nội dung | Thêm bản sao Save cố định `fixed bottom-right` | `InputsPage.tsx` |
| FE-008 | Channel list không search/filter | Thêm ô tìm theo tag/label | `InputsPage.tsx` |
| FE-010 | Không cảnh báo rời trang khi chưa lưu | Dirty-guard (`beforeunload` + chặn click link nội bộ + modal Lưu/Bỏ thay đổi), theo đúng pattern `DesignWorkspacePage.tsx` (D-01) | `InputsPage.tsx` |
| MAP-001 | Không có gợi ý mapping SensorType → Electrical Mode | Thêm dòng gợi ý tĩnh trong tab Điện & Cảm biến | `InputsPage.tsx` (`ElectricalModeTab`) |

FE-007 (6 tab) xác nhận thật nhưng **không sửa** — là thiết kế vừa được PM/CTO
duyệt 3 ngày trước (`UX-INPUT-REDESIGN-002`, CHANGELOG 2026-08-14); đảo ngược
cần hỏi lại người đã duyệt, ngoài phạm vi review này.

## 5. Dữ liệu board thật — đã dọn

`PUT /api/v1/system/config/io-bundle` (`base_revision: 16` → áp dụng thành
công lên `revision: 17`, SIGHUP reload không lỗi):

- `DO-01.name`: chuỗi rác `"dsdaasd"` (gõ nhầm còn sót từ lần test trước) →
  `"Supply Fan Enable"`.
- `UI-08`: thêm tên `"Damper Position Feedback"`, unit `percent`.
- `UI-09`: thêm tên `"Filter Dirty Alarm"`.
- `UI-10..13`: gán `type: dry`, tên theo bảng đấu nối (`Freeze Stat Trip`,
  `Smoke Detector Trip`, `Fan Status`, `High Static Trip`), `invert: false`.
- `UI-14`: gán `type: NTC10k`, tên `"CHW Leaving Temp"`, unit `degC`.
- `UI-15/16`: gán `type: 0-10V`, tên theo bảng, unit `percent`.
- `AO-01..04`: tên mô tả (`Supply Fan Speed`/`Economizer Damper`/`Chilled
  Water Valve`/`Hot Water Valve`) — mode `0-10V` đã đúng sẵn, không đổi.
- `DO-02`: tên `"Common Alarm Relay"`. `DO-03/04` giữ nguyên mặc định — đúng
  thiết kế (chưa gán field device theo wiring doc §4).

**Xác nhận sau PUT**: toàn bộ 16 UI + 4 AO + 4 DO quality `good`,
`GET /api/v1/health` → `status: ok` (core/io_shm/iobus/mcu_connection/
plc_shm/web đều `ok`).

## 6. Kiểm chứng (2026-08-17, đo lại thật)

| Bước | Kết quả |
|---|---|
| `npx vitest --run --environment jsdom src` | **677/677 PASS** (75 file; +7 test mới cho FE-001/002/006/008/010/MAP-001) |
| `npm run lint` | sạch, 0 warning |
| `npm run build` (`VITE_PROGRAMMING_REV_A=1`) | PASS, `grep -c REVA_SCOPE_ROADMAP dist/assets/*.js` = 0 |
| `npx playwright test e2e-board/board-page-audit.spec.ts --config=playwright.board.config.ts` (`BOARD_URL=http://mekong-fac.ddns.net:8082` trực tiếp, cổng 8082 đã public nên không cần SSH tunnel) | 2/2 PASS. `/eng/inputs` deeplink + in-app: 0 console/page/HTTP error, heading thật `UI-01 - Supply Air Temperature`. Toàn site: 2 lỗi 503 ở `/monitor`/`/trends` (endpoint `/api/v1/history`, không liên quan thay đổi này — xem §7) |

## 7. Deploy board Foxlinx

`scp -r dist SOM-DDC-24-foxlinx:/tmp/dist-new`, backup `dist.prev`, hoán đổi,
`systemctl restart mkddc-web-pi`. MD5 bundle board (`index-D7JAb9Sb.js`) khớp
bundle build cục bộ. `GET /api/v1/health` sau deploy → `ok`.

SSH board dùng **password** đã tài liệu hoá ở
`docs/03_implementation/27_SOM_BOARD_DEPLOY_NO_MCU_RUNBOOK.md` §33 (board
chính `root@...:2223` dùng password auth tạm, khác key `~/.ssh/mkddc24_som` —
đó là key cho board `SOM-DDC-24` orangepi cũ, không phải Foxlinx). Không ghi
password vào log/file nào trong repo.

## 8. Ngoài phạm vi / chưa sửa

- **`io_scaling.cpp` cold-end saturation (§9, `FAKE_MCU_AHU_WIRING_2026-08-14.md`)**
  — chờ HW xác nhận `VEXC`/pull-up thật khi PCB Rev A layout xong.
- **503 ở `/monitor`/`/trends`** (`GET /api/v1/history`) — phát hiện phụ trong
  lúc audit toàn site, không liên quan InputsPage/StatusBadge, không thuộc
  phạm vi review này. Cần một phiên riêng điều tra endpoint historian.
- **FE-007 gộp 6 tab** — cần hỏi lại người đã duyệt `UX-INPUT-REDESIGN-002`
  trước khi đảo thiết kế vừa chốt 3 ngày trước.

## 9. Tài liệu liên quan

- `docs/07_records/reviews/FAKE_MCU_AHU_WIRING_2026-08-14.md` — bảng đấu nối
  AHU 16 kênh UI + 4 AO + 4 DO mà review này verify theo.
- `apps/iobus/domain/io/io_scaling.cpp`, `tools/fake_mcu/fake_mcu.cpp` — công
  thức raw↔eng đối chiếu SIG-001/002.
- `apps/web-ui/src/features/points/InputsPage.tsx`,
  `apps/web-ui/src/shared/components/StatusBadge.tsx` — code đã sửa.
- `apps/web-ui/src/features/programming/design/DesignWorkspacePage.tsx` —
  pattern dirty-guard tham chiếu cho FE-010.

## 10. Lịch sử sửa đổi

| Revision | Ngày | Nội dung |
|---|---|---|
| 1.0 | 2026-08-17 | Tạo tài liệu: bác bỏ SIG-001/002/FE-003/004/009 bằng dữ liệu sống; vá 6 lỗi FE thật; dọn dữ liệu board revision 16→17; deploy + verify Foxlinx |
