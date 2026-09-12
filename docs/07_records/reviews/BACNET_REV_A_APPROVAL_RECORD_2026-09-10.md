# Biên bản phê duyệt — BACnet Rev A

**ID:** DDC24-BACNET-APPROVAL-2026-09-10
**Ngày phê duyệt:** 2026-09-10
**Người phê duyệt:** CTO (phần kỹ thuật). Ba mã nguồn lực **chưa** có chữ ký — xem §4.
**Phạm vi:** BACnet Rev A
**Nguồn:** [As-Built Review `REV-BACNET-ASBUILT-001`](../../05_verification/BACNET_REV_A_ASBUILT_REVIEW.md) ·
[Plan doc→code→E2E `PLAN-BACNET-D2C-001`](../../03_implementation/BACNET_DOC_TO_CODE_E2E_PLAN.md)
**Cập nhật trạng thái của:** [`OD-BAC-SET-001`](../../00_governance/BACNET_OPEN_DECISIONS.md) §1

> Biên bản này ghi lại **quyết định đã ký** và **số đo CTO tự đo lại**, không phải
> tóm tắt bản review. Nơi số của CTO khác số trong review, số trong biên bản này thắng.

---

## 1. Gate được phê duyệt

```text
BACNET_REV_A_DOC_TRACK_APPROVED   = YES   (WP-01..WP-08 không còn bị chặn bởi quyết định kỹ thuật)
BACNET_REV_A_BUILD_TRACK_APPROVED = NO    (chặn bởi OD-BAC-009 — egress/mirror)
BACNET_REV_A_VERIFY_TRACK_APPROVED= NO    (chặn bởi OD-BAC-007 — thiết bị + người)
BACNET_REV_A_READY                = NO
```

Kết luận `BACNET_REV_A = NOT READY` của review **được giữ nguyên**. CTO không hạ tiêu chí.

---

## 2. CTO tự kiểm chứng — không tin review, đọc mã

Đo trên `main` tại commit `9b5608d`, ngày 2026-09-10. Mọi lệnh chạy tại máy; CI `NOT_RUN (#414)`.

| Mã | Điều review khẳng định | CTO đo được | Kết luận |
|---|---|---|---|
| **G-04** | Không có handler `SUBSCRIBE_COV` ⇒ BMS gửi SubscribeCOV nhận Reject | `grep -n "SUBSCRIBE_COV" apps/iobus/adapters/bacnet/bacnet_server.cpp` → **0 dòng**, exit 1 | ✅ **KHỚP** |
| **G-05** | COV notification chỉ là `fprintf` | `bacnet_server.cpp:285-293`: `std::fprintf(stderr, "INFO  bacnet_cov.notify …")` kèm comment `/* bacnet-stack: Send_COV_Subscribe_Unconfirmed or confirmed COV notification */`. Không một lời gọi gửi gói nào | ✅ **KHỚP** |
| **G-01** | `sync_stack_inputs()` chỉ đẩy AI/BI ⇒ 64/88 object không bao giờ có dữ liệu | `bacnet_server.cpp:228-256`: chỉ `Analog_Input_*` và `Binary_Input_*`. Không có `Analog_Output_Present_Value_Set`, `Analog_Value_*`, `Binary_Value_*`, `Multistate_Value_*` | ✅ **KHỚP** |
| **G-02** | `BacnetPriority` không có caller sản phẩm | ⚠️ **Lệnh kiểm chứng trong hồ sơ SAI** — xem §3.1. Kiểm lại đúng API thì kết luận **đúng**: `BacnetObjects::write_av/bv/msv` có **đúng một** caller trong toàn repo và nó là test (`adapters/bacnet/tests/test_bacnet_object_map.cpp:197`); AO/BO thì `bacnet_server.cpp:46,55` đọc `Analog_Output_Present_Value_Priority()` của bacnet-stack chứ không dùng `BacnetPriority` | ✅ **Kết luận khớp, lệnh kiểm sai** |
| **G-06** | `register_objects()` tạo object vô điều kiện, không capability-gate | `bacnet_server.cpp:214-226`: bảy vòng `for` với hằng số cứng. `board_cap_map` **có thật** (`contracts/shm` → `io_cache.cpp:257-265`, `iop_client.cpp:226`) và `main.cpp:643` có đọc — nhưng `register_objects()` không đọc | ✅ **KHỚP** |
| **G-03** | WriteProperty AV/BV/MSV "không tới core" | ⚠️ **Cơ chế mô tả hơi lệch.** `BacnetObjects::write_av/bv/msv` (`bacnet_objects.cpp:342-375`) **CÓ** gọi `fn("av_setpoint", …, 3)`. Chỗ đứt là `start()` chỉ đăng ký `Analog_Output_Write_Present_Value_Callback_Set` + `Binary_Output_…` (`bacnet_server.cpp:110-111`); **không có** callback AV/BV/MSV nên không ai gọi tới các hàm đó | ✅ **Kết luận (báo thành công sai) đúng** |
| **G-08** | `bmsLink=online` chỉ vì socket bind được | `networkapi.go:300-308` → `online` khi `telemetry.BacnetBound`; `contracts/shm/mkddc_shm.h:211` định nghĩa `bacnet_bound = 1 khi bip_init() thành công`. Không có trường `lastRx` nào trong SHM | ✅ **KHỚP** |

### Luận điểm trung tâm — bộ test host PASS mà không có BACnet

| Bước | Lệnh | Kết quả CTO đo |
|---|---|---|
| Configure `BACNET=ON` | `cmake --fresh -S . -B /tmp/cto_on -DCMAKE_BUILD_TYPE=Release -DMKDDC_ENABLE_MODBUS=ON -DMKDDC_ENABLE_BACNET=ON -DMKDDC_ENABLE_HMI=ON` | **exit 1** — `HTTP/1.1 403 Forbidden` tải `bacnet-stack-1.3.8.tar.gz` từ `github.com` |
| Configure `BACNET=OFF` | cùng lệnh, `-DMKDDC_ENABLE_BACNET=OFF -DMKDDC_ENABLE_HMI=OFF` | **exit 0** |
| Build | `cmake --build /tmp/cto --parallel` | **exit 0** |
| Test | `ctest --test-dir /tmp/cto` | **1440/1440 PASS**, 0 fail, 1 skipped, **22,21 s** |
| Đếm test BACnet | `ctest --test-dir /tmp/cto -N \| grep -ci bacnet` | **81** |

**Kết luận: luận điểm trung tâm của review ĐÚNG.** Toàn bộ 1440 test xanh trong khi
bacnet-stack thậm chí không được biên dịch vào.

---

## 3. Nơi CTO KHÔNG đồng ý với bản review

Bản review buộc tội hồ sơ hiện có là "bằng chứng giả". Đóng dấu lên nó mà không kiểm
là lặp lại đúng lỗi đó ở một tầng cao hơn. Bốn điểm dưới đây là sai lệch tìm được
**trong chính bản review**.

### 3.1 `REV-BACNET-ASBUILT-001` — lệnh kiểm chứng G-02 khớp nhầm hàm không liên quan

Lệnh được đề nghị dùng để chứng minh `BacnetPriority` không có caller là:

```bash
grep -rn "write_ao\|relinquish_ao" apps/ --include=*.cpp | grep -v "bacnet_objects\|/tests/"
```

Lệnh này trả về **4 dòng** và **không dòng nào liên quan tới BACnet**: chúng khớp
`IoCache::write_ao_mode` (`apps/iobus/domain/io/io_cache.cpp:151`) và ba caller của nó
trong `apps/iobus/bootstrap/main.cpp:310,700,828` — đó là chế độ AO của I/O cache, một
hàm khác hoàn toàn. Ai chạy lệnh này rồi đọc kết quả sẽ kết luận **ngược** với review.

Đường kiểm đúng là `BacnetObjects::write_av/write_bv/write_msv` và `BacnetPriority::write/relinquish`.
Kết luận của G-02 vẫn đứng, nhưng lệnh kiểm phải sửa — một finding có lệnh kiểm sai là
một finding không ai xác minh lại được.

### 3.2 Số test BACnet: review ghi 67, CTO đo 81

`ctest -N | grep -ci bacnet` → **81**. Nếu chỉ tính test có suite bắt đầu bằng `Bacnet`
thì **73**. Không cách đếm nào ra 67.

**Số của CTO thắng.** Sai lệch này làm luận điểm của review *yếu đi so với sự thật*,
không mạnh lên — nên nó không đổi verdict, nhưng một bản review buộc tội người khác đo
sai thì không được phép đo sai.

### 3.3 Số mạnh hơn mà review bỏ sót: chỉ **1/1440** test chạm `BacnetServer`

Đếm theo suite: `BacnetObjects` 13 · `BacnetObjtable` 14 · `BacnetReliability` 10 ·
`BacnetScheduleObject` 9 · `BacnetCov` 8 · `BacnetPriority` 8 · `BacnetStatusFlags` 4 ·
`BacnetObjTableAbi` 3 · `BacnetObjTable` 2 · `BacnetCalendarObject` 1 · **`BacnetServer` 1**.

`BacnetServer` là lớp **duy nhất** nói chuyện với bacnet-stack, và nó có đúng một test
(`#151 BacnetServer.OutputCallbackMapsWriteAndReleaseToCore`). Đây là số đo mạnh nhất
cho `OD-BAC-010` và review không nêu.

### 3.4 `OD-BAC-009` mô tả thiếu phạm vi: googletest cũng bị 403

`OD-BAC-SET-001` mô tả blocker là FetchContent **bacnet-stack**. CTO đo được
`apps/iobus/CMakeLists.txt:182-184` tải googletest từ `github.com` và cũng nhận **403**.
Nó chỉ sống sót nhờ fallback `find_package(GTest QUIET)` khi máy có sẵn `libgtest-dev`.

Thêm nữa, container sạch **không configure được** nếu thiếu `libmodbus-dev`,
`libsodium-dev`, `libgtest-dev` và `jsonschema`. §5.1 của review ghi "configure exit 0"
mà không nêu tiền đề này ⇒ **số đo của review không tái lập được từ trạng thái sạch**.
Với một bản review lấy "bằng chứng phải tái lập được" làm luận điểm chính, đây là
khiếm khuyết phải sửa.

### 3.5 Một quan sát bổ sung — KHÔNG phải finding mới

> **Đính chính (cùng ngày, trước khi biên bản này được merge).** Bản nháp đầu của mục
> này ghi việc `dispatch_cov()` quét thiếu kênh là "finding mới `F-CTO-BAC-01`, review
> không nêu". **Sai.** Review CÓ nêu, ở `REV-BACNET-ASBUILT-001:194` (nằm trong phần
> G-05), và `PLAN-BACNET-D2C-001:184` đã có task riêng cho nó: `T-BAC-034` —
> *"`dispatch_cov()` quét đủ 16 UI (hiện 1..8)"*, `HOST`, P1, Dep 030.
>
> Sai sót là của CTO, do đọc §3 của review mà không đọc hết đoạn văn xuôi của G-05.
> Ghi lại ở đây thay vì xoá lặng: một biên bản dựng lên để chống bằng chứng giả thì
> không được sửa dấu vết sai của chính nó.

Nội dung quan sát, giữ lại vì nó xác nhận độc lập `T-BAC-034` bằng số đo của CTO:

`bacnet_server.cpp:301` quét COV cho AI/BI với `for (uint32_t i = 1; i <= 8; i++)`,
trong khi `KX_N_UI = 16` (`contracts/shm/mkddc_shm.h:67`) và `register_objects()`
(`bacnet_server.cpp:218`) tạo **AI×16**. Hệ quả: AI9…AI16 không bao giờ được kiểm COV,
kể cả sau khi `T-BAC-044..046` nối COV ra mạng thật.

**Phần thật sự chưa ai ghi:** cùng một gốc lệch hằng số còn ở chỗ thứ hai mà cả review
lẫn plan đều không nêu — `sync_stack_inputs()` (`bacnet_server.cpp:232`) lặp BI tới
`KX_N_UI` = 16 trong khi chỉ 8 BI tồn tại. Không gây hại hôm nay (`bacnet_objects.cpp:146`
chặn `instance > N_BI`), nhưng là cùng một hằng số đang được dùng cho hai kích thước khác
nhau, và nó sẽ thành lỗi thật nếu `T-BAC-022` (capability gate) đổi số BI. Ghi vào
`T-BAC-034` khi Issue của task đó được tạo.

---

## 4. Ba mã KHÔNG được ký ở phiên này

`OD-BAC-007`, `OD-BAC-008`, `OD-BAC-009` **không phải quyết định kỹ thuật**. Chúng là
cam kết chi tiêu, hành vi pháp lý với bên thứ ba, và chính sách bảo mật tổ chức.

CTO đánh `CLOSED` cho chúng sẽ tạo ra đúng loại bằng chứng giả mà cả đợt rà soát này
sinh ra để chống: một dòng "đã duyệt" mà không có ai thật đứng sau nó, không có thiết bị
thật xuất hiện, không có đơn nào được nộp.

Chi tiết ai ký / cần gì / hệ quả: [`OD-BAC-SET-001` §4](../../00_governance/BACNET_OPEN_DECISIONS.md).

---

## 5. Quyết định kiến trúc phát sinh

| ADR | Nội dung | Nguồn |
|---|---|---|
| `ADR-057` | Alarm/Event, Schedule, Calendar, Trend Log chuyển V1.1 | `OD-BAC-011` |
| `ADR-058` | Chấp nhận breaking change object set một lần ở Rev A | `OD-BAC-002` |
| `ADR-059` | Mở lại `/bacnet/objects` chỉ đọc ở Rev A (đảo quyết định 2026-08-20) | `OD-BAC-006` |
| `ADR-060` | Thang bằng chứng BACnet: `HOST` không tính; thêm `LOOPBACK`; `VERIFIED` cần `TARGET` | `OD-BAC-010` |

Xem [`ADR-LOG-001`](../../00_governance/DECISIONS.md).

---
**Rev** 1.0 | 2026-09-10
