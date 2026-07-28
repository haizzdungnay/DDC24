# FW SOM — Hướng dẫn tích hợp cho BE SOM

> **Document ID:** HANDOFF-BEGUIDE-MK-DDC-24-VI
> **Phiên bản:** 1.0 | 2026-07-28
> **Đối tượng:** đội BE SOM

Tài liệu này là **điểm vào**. Đọc hết trang này là đủ để tích hợp; các trang
khác là tra cứu.

## FW SOM chịu trách nhiệm gì

| FW SOM làm | BE làm |
|---|---|
| Compile ST → artifact đã ký | Lưu source, revision, quyền, audit |
| Verify + nạp artifact | Quyết định khi nào deploy |
| Chạy Task/Program đúng chu kỳ | Hiển thị trạng thái, báo động |
| Trọng tài ưu tiên + safe-state | Quản lý vòng đời project |
| Giữ RETAIN qua restart | Lưu trữ artifact và lịch sử |

**FW SOM không có UI, không có auth, không có database.** Nó nhận lệnh và trả
trạng thái.

## Bắt đầu trong 5 phút

```bash
# 1. Build
cmake -S services -B build/services -DCMAKE_BUILD_TYPE=RelWithDebInfo
cmake --build build/services --parallel $(nproc)

# 2. Compile một chương trình mẫu
build/services/core/mkddc-st-compile \
  --source services/core/st/samples/ahu_fan_control.st \
  --out /tmp/ahu.mkir

# 3. Chạy bộ integration test
services/core/st/samples/be_integration_test.sh build/services
```

Bước 3 chạy 18 kiểm tra end-to-end và phải **18/18 pass**. Nếu không, dừng lại
và báo FW trước khi tích hợp tiếp.

## Luồng end-to-end

```
ST source
   │
   ├─► mkddc-st-validate --source p.st        (tuỳ chọn: kiểm nhanh khi user gõ)
   │      └─► JSON: ok, diagnostics[], symbols[]
   │
   ├─► mkddc-st-compile --source p.st         (BẮT BUỘC: sinh artifact)
   │      └─► JSON: artifact (base64), artifactSha256, targetAbi…
   │
   ├─► program_capabilities                   (hỏi TRƯỚC khi compile)
   ├─► program_stage    { artifact }          -> STAGED
   │      (activation áp ở ranh giới tick kế)
   ├─► program_status                         -> ACTIVE
   ├─► program_start                          -> RUNNING
   ├─► program_status                         -> runCount tăng, sha256 khớp
   │
   ├─► (sự cố) program_status                 -> FAULTED + lastFault.line
   ├─► program_reset                          -> STOPPED
   └─► program_rollback                       -> ROLLED_BACK
```

## Bảy điều dễ làm sai

**1. Đừng kết luận "đã chạy" khi `program_stage` trả `ok`.**
Nó trả `appliedAt: "next_tick_boundary"`. Activation áp ở tick kế. Muốn biết
kết quả thật thì gọi `program_status`.

**2. Hỏi `program_capabilities` TRƯỚC khi compile.**
Nó cho biết `compilerProfile`/`targetAbi` mà runtime chấp nhận. Bỏ qua bước
này thì BE compile xong mới nhận `IR-E-003`/`IR-E-004` — một vòng lãng phí.

**3. Map theo MÃ lỗi, không parse `message`.**
`message` là tiếng Anh kỹ thuật và có thể đổi câu chữ bất cứ lúc nào. Bốn họ
mã: `ST-*` (compiler), `IR-E-*` (loader), `RT-RETAIN-*` (retain), `API-E-*`
(interface). Xem [`FW_SOM_ERROR_CODES.md`](FW_SOM_ERROR_CODES.md).

**4. `ST-LIM-006` nghĩa là "còn lỗi chưa hiển thị".**
Nó luôn là phần tử **cuối** của `diagnostics[]`. Thấy nó mà kết luận "hết lỗi"
là sai — người dùng sẽ sửa hết lỗi hiển thị rồi vẫn không compile được.

**5. `stop` KHÔNG đưa đầu ra về safe-state.**
Nó là hành động vận hành có chủ ý. Nếu UI của BE gợi ý "dừng chương trình để
an toàn" thì đang hiểu sai — dừng chương trình chỉ ngừng cập nhật đầu ra, giá
trị cuối vẫn giữ.

**6. So `artifactSha256` để xác minh cái đang chạy.**
`program_status` trả hash của artifact runtime đang chạy. So với hash BE lưu
là cách duy nhất chắc chắn, thay vì tin trạng thái.

**7. Đổi biến RETAIN = mất giá trị retain.**
Đổi tên hoặc đổi kiểu biến `VAR RETAIN` làm bản ghi cũ bị từ chối
(`RT-RETAIN-003`) và chương trình cold-start. Đây là **đúng ý đồ**, nhưng BE
nên cảnh báo người vận hành trước khi deploy bản có sửa vùng RETAIN.

## Điều FW SOM bảo đảm

- **Gói hỏng không bao giờ làm mất điều khiển.** Mọi lỗi load giữ nguyên
  package đang chạy.
- **Chương trình lỗi không làm chết `mkddc-core`.** Nó chuyển `FAULTED`, huỷ
  toàn bộ staging của Task, không commit output nửa vời.
- **Chương trình ST không thể vượt mặt manual/BACnet/safety.** Đầu ra đi qua
  trọng tài ưu tiên ở mức logic, safe-state là quyền cuối.
- **Mọi request đều nhận JSON đúng shape**, kể cả request rác.
- **Build tất định** — cùng source cho cùng byte artifact.

## Điều FW SOM KHÔNG bảo đảm (Rev A.0)

- Không có `CASE`, vòng lặp, POU do người dùng định nghĩa, LD/SFC.
- Không có online change — activate là thay cả package.
- Chưa có evidence trên phần cứng MCU thật.
- Số liệu thời gian thực chưa lấy trên cấu hình có RT (xem
  [`FW_SOM_TEST_EVIDENCE.md`](FW_SOM_TEST_EVIDENCE.md) §Hạn chế).

## Tài liệu liên quan

| Tài liệu | Dùng khi |
|---|---|
| [`FW_SOM_RUNTIME_API_CONTRACT.md`](FW_SOM_RUNTIME_API_CONTRACT.md) | Viết client gọi runtime |
| [`FW_SOM_ARTIFACT_FORMAT.md`](FW_SOM_ARTIFACT_FORMAT.md) | Xử lý/lưu trữ artifact |
| [`FW_SOM_PROGRAM_TASK_MODEL.md`](FW_SOM_PROGRAM_TASK_MODEL.md) | Thiết kế UI cấu hình Task |
| [`FW_SOM_ERROR_CODES.md`](FW_SOM_ERROR_CODES.md) | Map lỗi ra thông báo người dùng |
| [`FW_SOM_TEST_EVIDENCE.md`](FW_SOM_TEST_EVIDENCE.md) | Đánh giá mức tin cậy |
| [`FW_SOM_HANDOFF_CHECKLIST.md`](FW_SOM_HANDOFF_CHECKLIST.md) | Nghiệm thu bàn giao |
| [`ST_SUBSET_SPEC`](../02_design/software/ST_SUBSET_SPEC_MK-DDC-24_VI.md) | Viết editor/highlight ST |
